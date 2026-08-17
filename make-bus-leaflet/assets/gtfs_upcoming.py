#!/usr/bin/env python3
"""Phase 1 "get ahead of the game" step: surface UPCOMING bus changes for each built town.

Bus operators must register a new/changed/withdrawn local service with the Traffic
Commissioner -- and publish it to BODS -- at least 42 days BEFORE it takes effect. So the
BODS GTFS feed we already download every month ALREADY contains the future-dated timetables.
The monthly `gtfs_refresh_report.py` only compares today's BODS state with our shipped
leaflets; this script instead mines the SAME feed for what is going to change soon, so we
can pre-draft leaflet updates before the change goes live.

Two lenses, both from the current feed plus last month's snapshot:

  FORWARD (from the current feed alone)
    [CHANGE]   a route already running gains a service registered to start on a FUTURE date
               (start_date after the feed's own start date) -> its timetable changes then.
    [NEW]      a route not currently running has a service starting on a future date.
    [ENDS?]    a route whose registered service currently runs out within the look-ahead
               window, with nothing registered beyond -> may withdraw / be seasonal /
               simply not re-registered yet. Verify (lower confidence).

  MONTH-OVER-MONTH (this snapshot vs the previous one in _gtfs/upcoming/)
    [APPEARED]/[WITHDRAWN]/[OPERATOR]/[DAYS]/[TIMETABLE] as the route set or a route's
    signature changes between snapshots -- catches changes registered at short notice or
    already in effect (which the forward lens can't see), and flags [NEW THIS MONTH] when a
    future change is newly registered since last time.

Both lenses read `calendar` AND `calendar_dates`: many town services (e.g. March 46, the
50/56/66 group, Wisbech 52) are calendar_dates-only and are invisible to a calendar-only
read -- exactly the services with the nearest-term dates.

NOT covered (documented limitations):
  * Community / demand-responsive / pre-book services (Villager VL14, FACT 33A) are not in
    BODS at all -- unchanged from the rest of the pipeline.
  * Minute-level retimes with the same stops/days/trip-count aren't detected: the shared
    DB doesn't store departure times (add departure_time to gtfs_build to get that).

Multi-region: each town is mined from its own region's dataset, resolved through
`_gtfs/town_prefixes.json` -> `_gtfs/regions.json` (see gtfs_regions.py). A town
whose dataset isn't built is reported as NOT CHECKED rather than mined from a
dataset that cannot contain it.

PLACES as well as towns. Towns are registered by hand in town_prefixes.json;
place maps are DISCOVERED from their manifests by gtfs_places.py and scanned
against their OWN service radius. A place used to be covered only as a side
effect of its parent town, which missed any place whose town isn't registered,
and missed routes serving a place from outside the town's radius (a place's
0.8 km circle is not a subset of its town's). Both kinds share one loop: a place
is just an entry located by `near` instead of `prefixes`, which make_town_stops
has handled since Beaconsfield and High Wycombe needed it.

Usage:
  python gtfs_upcoming.py [--root "<Buses folder>"] [--ahead 90]
                          [--town "<Town>" | --place "<Place>"] [--list-units]
                          [--no-places] [--db <one dataset for every unit>]
Writes _gtfs/upcoming/snapshot_<date>.json, upcoming-report_<date>.md, upcoming-summary.txt.
"""
import os, sys, json, glob, argparse, datetime, hashlib, sqlite3
import gtfs_regions as greg
import gtfs_places as gplaces

DOW = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
ABBR = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]


def fmt_days(flags):
    on = [i for i, f in enumerate(flags) if f]
    if not on:
        return "?"
    if on == list(range(7)):
        return "Daily"
    if on == list(range(on[0], on[-1] + 1)):
        return f"{ABBR[on[0]]}-{ABBR[on[-1]]}" if len(on) > 2 else " & ".join(ABBR[i] for i in on)
    return " & ".join(ABBR[i] for i in on) if len(on) <= 3 else ", ".join(ABBR[i] for i in on)


def d2iso(d):
    return f"{d[0:4]}-{d[4:6]}-{d[6:8]}" if d and len(d) == 8 else (d or "?")


def days_between(today_ymd, d):
    try:
        a = datetime.datetime.strptime(today_ymd, "%Y%m%d").date()
        b = datetime.datetime.strptime(d, "%Y%m%d").date()
        return (b - a).days
    except Exception:
        return None


def make_town_stops(cur, prefixes=None, near=None):
    cur.execute("DROP TABLE IF EXISTS town_stops")
    cur.execute("CREATE TEMP TABLE town_stops(stop_id TEXT PRIMARY KEY)")
    if prefixes:
        for p in prefixes:
            cur.execute("INSERT OR IGNORE INTO town_stops SELECT stop_id FROM stops WHERE stop_id LIKE ?", (p + "%",))
    if near:
        from math import radians, sin, cos, asin, sqrt
        la, lo, km = near
        for r in cur.execute("SELECT stop_id,stop_lat,stop_lon FROM stops WHERE stop_lat<>'' AND stop_lon<>''").fetchall():
            try:
                dla = radians(float(r[1]) - la); dlo = radians(float(r[2]) - lo)
                a = sin(dla / 2) ** 2 + cos(radians(la)) * cos(radians(float(r[1]))) * sin(dlo / 2) ** 2
                if 6371 * 2 * asin(sqrt(a)) <= km:
                    cur.execute("INSERT OR IGNORE INTO town_stops VALUES (?)", (r[0],))
            except ValueError:
                pass


# A calendar_dates-only service is treated as an ongoing registered service (whose future
# start therefore signals a real change) only if it has at least this many running dates.
# Below it, a future first-date is almost always a bank-holiday extra or a one-off occasional
# working, not a timetable change -- so it must not raise a [NEW]/[CHANGE] flag.
MIN_ONGOING_DATES = 10


def service_window(cur, service_id, cal_row):
    """Effective window + weekday flags for a service, unioning calendar + calendar_dates.

    Returns (eff_start, eff_end, flags[7], had_calendar_row, added_date_count). Dates are
    YYYYMMDD strings; on no data returns (None,None,[0]*7,False,0). calendar_dates additions
    (exception_type='1') extend the window and, for calendar-less services, define which
    weekdays run; removals (type '2') are ignored for the window.
    """
    starts, ends, flags = [], [], [0] * 7
    had_cal = cal_row is not None
    if had_cal:
        for i, dn in enumerate(DOW):
            if cal_row[dn] == "1":
                flags[i] = 1
        starts.append(cal_row["start_date"]); ends.append(cal_row["end_date"])
    adds = [r[0] for r in cur.execute(
        "SELECT date FROM calendar_dates WHERE service_id=? AND exception_type='1'", (service_id,)).fetchall()]
    if adds:
        # calendar_dates additions extend the window; the weekdays they fall on are days the
        # service runs (this is the only day info for calendar-less services).
        starts.append(min(adds)); ends.append(max(adds))
        for d in adds:
            try:
                flags[datetime.datetime.strptime(d, "%Y%m%d").weekday()] = 1
            except Exception:
                pass
    if not starts:
        return None, None, flags, had_cal, len(adds)
    return min(starts), max(ends), flags, had_cal, len(adds)


def build_town(cur, feed_start, prefixes, near):
    """Return {route_short_name: {...signature...}} for services calling at the town."""
    make_town_stops(cur, prefixes, near)
    IN = "st.stop_id IN (SELECT stop_id FROM town_stops)"
    pairs = cur.execute(f"""
        SELECT DISTINCT rt.route_short_name sn, a.agency_name op, t.service_id sid
        FROM trips t
        JOIN stop_times st ON st.trip_id=t.trip_id AND {IN}
        JOIN routes rt ON rt.route_id=t.route_id
        JOIN agency a ON a.agency_id=rt.agency_id""").fetchall()
    cal_cache = {r["service_id"]: r for r in cur.execute("SELECT * FROM calendar").fetchall()}
    routes = {}
    for pr in pairs:
        sn = pr["sn"]
        R = routes.setdefault(sn, {"route": sn, "operators": set(), "flags": [0] * 7,
                                   "start": None, "end": None, "future": [], "services": set()})
        R["operators"].add(pr["op"]); R["services"].add(pr["sid"])
        es, ee, fl, had_cal, addn = service_window(cur, pr["sid"], cal_cache.get(pr["sid"]))
        if es is None:
            continue
        for i in range(7):
            R["flags"][i] |= fl[i]
        R["start"] = es if R["start"] is None else min(R["start"], es)
        R["end"] = ee if R["end"] is None else max(R["end"], ee)
        # A future start signals a real change only for a proper registered timetable: a
        # calendar row, or a dense calendar_dates pattern -- not a bank-holiday/one-off extra.
        ongoing = had_cal or addn >= MIN_ONGOING_DATES
        if es > feed_start and ongoing:  # a registration boundary in the future
            R["future"].append({"service": pr["sid"], "start": es, "end": ee, "days": fmt_days(fl), "flags": fl})
    # per-route routing fingerprint + trip count (town-serving trips), for month-over-month diff
    for sn, R in routes.items():
        rids = [x[0] for x in cur.execute(
            "SELECT DISTINCT route_id FROM routes WHERE route_short_name=?", (sn,)).fetchall()]
        ph = ",".join("?" * len(rids))
        tids = [x[0] for x in cur.execute(
            f"""SELECT DISTINCT t.trip_id FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id AND {IN}
                WHERE t.route_id IN ({ph})""", rids).fetchall()]
        seqs = set()
        for tid in tids:
            seq = tuple(x[0] for x in cur.execute(
                "SELECT stop_id FROM stop_times WHERE trip_id=? ORDER BY CAST(stop_sequence AS INT)", (tid,)).fetchall())
            seqs.add(seq)
        R["tripCount"] = len(tids)
        R["routingHash"] = hashlib.sha1(("|".join("/".join(s) for s in sorted(seqs))).encode()).hexdigest()[:12]
        R["operators"] = sorted(R["operators"])
        R["days"] = fmt_days(R["flags"])
        R["future"].sort(key=lambda f: f["start"])
        if R["future"]:
            uf = [0] * 7  # union of days across the future-dated services = the new day pattern
            for f in R["future"]:
                for i in range(7):
                    uf[i] |= f["flags"][i]
            R["futureStart"] = R["future"][0]["start"]
            R["futureDays"] = fmt_days(uf)
        for f in R["future"]:
            f.pop("flags", None)
        del R["services"]
    return routes


def prev_snapshot(updir, today_iso):
    cands = sorted(glob.glob(os.path.join(updir, "snapshot_*.json")))
    cands = [c for c in cands if os.path.basename(c) < f"snapshot_{today_iso}.json"]
    if not cands:
        return None, None
    return cands[-1], json.load(open(cands[-1], encoding="utf-8"))


def forward_findings(routes, prev_routes, feed_start, today, ahead):
    """[CHANGE]/[NEW]/[ENDS?] tuples for one town from the current feed.

    prev_routes (last month's snapshot for this town, or None) is used only to annotate a
    change as newly registered since last time -- the essence of getting ahead.
    """
    out = []
    horizon = (datetime.datetime.strptime(today, "%Y%m%d") + datetime.timedelta(days=ahead)).strftime("%Y%m%d")
    for sn, R in sorted(routes.items()):
        # runs now = the route has service covering today (min start <= today <= max end)
        runs_now = bool(R["start"] and R["start"] <= today and R["end"] and R["end"] >= today)
        if R["future"]:
            f0 = R["future"][0]
            lead = days_between(today, f0["start"])
            if lead is not None and lead < 0:
                continue
            # a future-dated service on a route that already runs => timetable CHANGE; else NEW route
            tag = "CHANGE" if runs_now else "NEW"
            newdays = R.get("futureDays", f0["days"])
            # newly registered since last snapshot? (this future start wasn't there last month)
            fresh = ""
            if prev_routes is not None:
                pf = {f["start"] for f in prev_routes.get(sn, {}).get("future", [])}
                if f0["start"] not in pf:
                    fresh = " (newly registered this month)"
            msg = (f"service registered to start {d2iso(f0['start'])} ({lead}d away) "
                   f"[{newdays}], {' / '.join(R['operators'])}")
            if tag == "CHANGE":
                msg = "already running; " + msg + " -> timetable changes then, re-check" + fresh
            else:
                msg = "not currently running; " + msg + " -> new service, prepare leaflet" + fresh
            out.append((tag, sn, f0["start"], msg))
        elif R["end"] and today <= R["end"] <= horizon:
            # ends within look-ahead, nothing registered beyond -> verify
            lead = days_between(today, R["end"])
            note = "may withdraw / be seasonal / not yet re-registered - verify"
            out.append(("ENDS?", sn, R["end"],
                        f"registered only to {d2iso(R['end'])} ({lead}d), {' / '.join(R['operators'])} [{R['days']}] - {note}"))
    return out


def diff_findings(cur_routes, prev_routes):
    """Month-over-month [APPEARED]/[WITHDRAWN]/[OPERATOR]/[DAYS]/[TIMETABLE]/[NEW THIS MONTH]."""
    out = []
    cur_set, prev_set = set(cur_routes), set(prev_routes or {})
    for sn in sorted(cur_set - prev_set):
        # a brand-new route that is also future-dated is already reported as [NEW] by the
        # forward lens -- only surface [APPEARED] for routes that turned up running already.
        if cur_routes[sn].get("future"):
            continue
        out.append(("APPEARED", sn, f"route now serves the town (wasn't in last snapshot); {' / '.join(cur_routes[sn]['operators'])} [{cur_routes[sn]['days']}]"))
    for sn in sorted(prev_set - cur_set):
        p = prev_routes[sn]
        out.append(("WITHDRAWN", sn, f"route no longer serves the town (was {' / '.join(p.get('operators', []))} [{p.get('days','?')}]) - verify"))
    for sn in sorted(cur_set & prev_set):
        c, p = cur_routes[sn], prev_routes[sn]
        if sorted(c["operators"]) != sorted(p.get("operators", [])):
            out.append(("OPERATOR", sn, f"'{' / '.join(p.get('operators', []))}' -> '{' / '.join(c['operators'])}'"))
        if c["days"] != p.get("days"):
            out.append(("DAYS", sn, f"'{p.get('days','?')}' -> '{c['days']}'"))
        if c.get("routingHash") != p.get("routingHash") or c.get("tripCount") != p.get("tripCount"):
            out.append(("TIMETABLE", sn, f"stops/frequency changed (trips {p.get('tripCount','?')} -> {c['tripCount']}) - re-check routing & times"))
    return out


def main():
    try:  # the report text uses ≥ and — ; the Windows console is cp1252 by default
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=r"C:\u3a St Ives\Using AI\Buses")
    ap.add_argument("--db")
    ap.add_argument("--ahead", type=int, default=90, help="look-ahead window in days for [ENDS?] (default 90)")
    ap.add_argument("--town", help="ad-hoc gate check: print just this town's upcoming changes to the "
                                   "console and do NOT write/overwrite the monthly snapshot or report. "
                                   "Use at the start of a leaflet build to decide print-now/wait/annotate.")
    ap.add_argument("--place", help="the same ad-hoc gate check for a discovered place map "
                                    "(e.g. \"High Wycombe Aldi\"). Prints only; writes nothing.")
    ap.add_argument("--list-units", action="store_true",
                    help="list every town and discovered place with its resolved region, radius and "
                         "facts-file source, then exit. Writes nothing.")
    ap.add_argument("--no-places", action="store_true",
                    help="scan registered towns only, skipping discovered place maps (escape hatch).")
    a = ap.parse_args()
    if a.town and a.place:
        ap.error("--town and --place are mutually exclusive")
    single = a.town or a.place
    gdir = os.path.join(a.root, "_gtfs")
    updir = os.path.join(gdir, "upcoming"); os.makedirs(updir, exist_ok=True)
    prefixes_cfg = json.load(open(os.path.join(gdir, "town_prefixes.json"), encoding="utf-8"))

    # Towns come from the hand-maintained registry, places from their manifests. Both end up
    # in one dict keyed by name, which greg.plan() groups by dataset without caring which is
    # which -- place folder names keep their town prefix ("High Wycombe Aldi"), so the two
    # namespaces don't collide (gplaces.discover refuses the entry if they ever do).
    scan_cfg = {k: v for k, v in prefixes_cfg.items() if not k.startswith("_")}
    kinds = {k: "town" for k in scan_cfg}
    place_problems = []
    if not a.no_places:
        regions, default = greg.load(gdir)
        places, place_problems = gplaces.discover(a.root, regions, default, prefixes_cfg)
        scan_cfg.update(places)
        kinds.update({k: "place" for k in places})

    if a.list_units:
        for name, cfg in sorted(scan_cfg.items()):
            where = f"near {cfg['near']}" if cfg.get("near") else f"prefixes {cfg.get('prefixes')}"
            print(f"{kinds[name]:5} {name:32} region={cfg.get('region') or '(default)':16} {where}"
                  + (f"  src={cfg['_src']}" if cfg.get("_src") else "")
                  + (f"  [{cfg['_note']}]" if cfg.get("_note") else ""))
        for name, reason in place_problems:
            print(f"place {name:32} NOT CHECKED — {reason}")
        return

    groups, skipped = greg.plan(gdir, scan_cfg, a.db)
    skipped = list(skipped) + place_problems
    today = datetime.date.today().strftime("%Y%m%d")
    today_iso = datetime.date.today().isoformat()

    prev_path, prev = prev_snapshot(updir, today_iso)

    snapshot = {"generated": today_iso, "ahead_days": a.ahead, "regions": {}, "towns": {}, "places": {}}
    lines = ["# Upcoming bus changes — get ahead of the game",
             f"_Report {today_iso}; look-ahead {a.ahead}d; "
             f"{'compared with ' + os.path.basename(prev_path) if prev_path else 'first run — no previous snapshot to diff'}. "
             f"Datasets used:_", ""]
    for g in groups:
        lines.append(f"- {greg.feed_line(g)}")
    lines += ["",
             "Mined from the BODS feed we already download. Operators must publish changes ≥42 days "
             "ahead, so future-dated services here are advance notice. Community/pre-book services "
             "(VL14, FACT…) are not in BODS. See the script header for what isn't detected.", ""]
    summary = []
    total = 0
    towns_hit = []
    places_hit = []

    for g in groups:
        gfi = (g["feed"] or {}).get("feed_info", {})
        feed_start = gfi.get("feed_start_date") or "00000000"
        snapshot["regions"][g["region"]] = {
            "db": os.path.basename(g["db"]), "feed_built": (g["feed"] or {}).get("built"),
            "feed_start": feed_start, "feed_end": gfi.get("feed_end_date") or "99999999"}
        con = sqlite3.connect(g["db"]); con.row_factory = sqlite3.Row; cur = con.cursor()
        try:
            for town, cfg in g["towns"]:
                if single and town.lower() != single.lower():
                    continue
                is_place = kinds.get(town) == "place"
                # Existence gate only -- nothing is read from this dir. A town must have an
                # Areas/<Town> folder to be worth scanning; a discovered place carries the
                # dir it was found in, wherever that layout put it.
                unit_dir = cfg.get("_dir") or os.path.join(a.root, "Areas", town)
                if not os.path.isdir(unit_dir):
                    continue
                prefixes = cfg.get("prefixes")
                near = tuple(cfg["near"]) if cfg.get("near") else None
                routes = build_town(cur, feed_start, prefixes, near)
                bucket = "places" if is_place else "towns"
                snapshot[bucket][town] = routes
                # An older snapshot has no "places" key at all, so a place's first run finds
                # no baseline, skips the month-over-month lens and reports forward findings
                # only -- rather than declaring every route [APPEARED].
                prev_routes = (prev or {}).get(bucket, {}).get(town) if prev else None
                fwd = forward_findings(routes, prev_routes, feed_start, today, a.ahead)
                dif = diff_findings(routes, prev_routes) if prev_routes is not None else []
                # actionable = firm upcoming changes; ENDS? is lower-confidence "verify"
                findings = fwd + dif
                actionable = [f for f in findings if f[0] not in ("ENDS?",)]
                if actionable:
                    (places_hit if is_place else towns_hit).append(town); total += len(actionable)
                nverify = len([x for x in fwd if x[0] == "ENDS?"])
                nact = len(actionable)
                verdict = "nothing upcoming" if (nact == 0 and nverify == 0) else \
                    (", ".join(([f"{nact} upcoming"] if nact else []) + ([f"{nverify} to verify"] if nverify else [])))
                summary.append(f"  {town}{' [place]' if is_place else ''}: {verdict}")
                lines.append(f"## {town} — {verdict}")
                if is_place:
                    # The portal reads this line to tell a place section from a town one, so it
                    # can join to the right map instead of substring-matching map.subject.
                    parent = cfg.get("_town")
                    lines.append(f"_kind place · region {g['region']}"
                                 + (f" · town {parent}" if parent else "")
                                 + f" · radius {cfg['near'][2]} km_")
                else:
                    lines.append(f"_region {g['region']}_")
                if not findings:
                    lines.append("- No upcoming changes detected in the current feed.")
                order = {"NEW": 0, "CHANGE": 1, "APPEARED": 2, "WITHDRAWN": 3,
                         "OPERATOR": 4, "DAYS": 5, "TIMETABLE": 6, "ENDS?": 7}
                for f in sorted(findings, key=lambda x: (order.get(x[0], 9), x[1])):
                    if len(f) == 4:
                        tag, sn, _dt, msg = f
                    else:
                        tag, sn, msg = f
                    lines.append(f"- **[{tag}] {sn}** — {msg}")
                lines.append("")
        finally:
            con.close()

    # Units deliberately not mined, rather than mined from a dataset that cannot contain them.
    if skipped and not single:
        lines.append("## Not checked — dataset unavailable")
        for town, reason in skipped:
            lines.append(f"- **{town}** — {reason}")
            summary.append(f"  {town}: NOT CHECKED ({reason})")
        lines.append("")

    if single:
        # Ad-hoc gate check: print this unit's section, write nothing (don't disturb the monthly
        # snapshot cadence or the diff baseline).
        noun = "Place" if a.place else "Town"
        blocked = [r for t, r in skipped if t.lower() == single.lower()]
        if blocked:
            print(f"{noun} '{single}' could not be checked: {blocked[0]}")
            return
        if not any(name.lower() == single.lower() for name in scan_cfg):
            print(f"{noun} '{single}' is not "
                  + ("a discovered place map (looked for a manifest.json under Areas/*/Places/ and Places/)."
                     if a.place else "in town_prefixes.json - nothing to check."))
            return
        print("\n".join(lines[1:]).strip())  # drop the H1 title; keep feed context + the town section
        return

    snap_path = os.path.join(updir, f"snapshot_{today_iso}.json")
    json.dump(snapshot, open(snap_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    rep_path = os.path.join(updir, f"upcoming-report_{today_iso}.md")
    open(rep_path, "w", encoding="utf-8").write("\n".join(lines))

    if total == 0:
        headline = "Upcoming bus changes: nothing to prepare."
    else:
        where = "; ".join(x for x in (", ".join(towns_hit),
                                      ", ".join(f"{p} (place)" for p in places_hit)) if x)
        headline = f"Upcoming bus changes: {total} item(s) coming in {where}."
    if skipped:
        headline += f" {len(skipped)} unit(s) NOT checked ({', '.join(t for t, _ in skipped)})."
    with open(os.path.join(updir, "upcoming-summary.txt"), "w", encoding="utf-8") as f:
        f.write(headline + "\n" + "\n".join(s.strip() for s in summary) + "\nREPORT=" + rep_path + "\n")
    print("Upcoming changes per town and place:")
    print("\n".join(summary))
    print("\n" + headline)
    print("Snapshot:", snap_path)
    print("Report:", rep_path)


if __name__ == "__main__":
    main()
