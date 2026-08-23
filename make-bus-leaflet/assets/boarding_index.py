#!/usr/bin/env python3
"""Build the "you board here for X" index that is the point of a boarding plan.

WHY THIS EXISTS. `boarding-plan-product_2026-08-22.md` rule 2: index by
DESTINATION, alphabetically, not by route number -- "a reader who already knows
their route number does not need this sheet at all". That inverts every other file
the engine produces, all of which are keyed by route. Nothing existing can be
reshaped into it, because the fact the index needs -- "which stop does the bus to
Ramsey LEAVE from" -- is not in any of them.

DEPARTURES ONLY, AND THAT IS THE WHOLE SUBTLETY. A stop where a route merely
TERMINATES is not a boarding point for anywhere. St Ives route 9 makes the case:
its Huntingdon journeys depart from Bay 2, but its inbound journeys terminate at
Bay 1. An index built from "which routes call at this stop" -- the shape every
other file has -- would print "Huntingdon: Bay 1 or Bay 2", and half of that is
wrong. So this reads TRIPS, and a stop earns a destination only from the stops that
come AFTER it on the same trip. A trip's final stop contributes nothing, which is
the correct treatment of an arrival bay and falls out for free.

WHY TRIPS AND NOT THE DIRECTION CHAINS. routes_full_atco.json's `directions` are
canonicalised -- one representative stop list per direction. Real journeys vary
(short workings, school days, a Sunday variant that misses a village), and the
variation is exactly what decides whether a destination is "every 20 minutes" or
"one bus on Thursdays". Trip-level counting also lets a genuinely marginal
destination be marked `limited` instead of being printed as if it were routine.

LOCALITIES, NOT HEADSIGNS. A headsign is what the operator painted on the bus
("Bus Station", "New Road", "Superstore") and is useless as a destination name --
sec 2 of the paper found ten of thirteen S6 findings at one place were this
artefact alone. NaPTAN carries a real `LocalityName` for essentially every stop, so
each onward stop resolves to the settlement a reader would actually name. That is
the cross-check on reverse-geocoding the paper's sec 6 calls out as a benefit of the
register in its own right.

CHOOSING BETWEEN TWO STOPS THAT BOTH WORK. In a real town centre a bus often calls
at several in-frame stops on its way out -- at St Ives the Cambridge-bound A calls
at Cromwell Pl AND The Busway Station Road, both valid. The reader wants the one
that costs them the shortest walk, so ties are broken on distance from the anchor,
then on trip count. Every alternative is still recorded in `alsoFrom`, so a later
sheet can say "or from ..." without recomputing.

USAGE. Run from a stage folder holding the place's geometry (an S2 dir, or S3/S4
after `stage.js pull`). Needs `place.json` and `stands.json` (run `naptan_stands.py
--write` first); finds the GTFS and NaPTAN databases by walking up to `_gtfs/`.

    python boarding_index.py                        report only
    python boarding_index.py --write                also write boarding_index.json
    python boarding_index.py --db <path.sqlite>     pick the GTFS region explicitly
    python boarding_index.py --min-trips 2          hide destinations below N trips/week
    python boarding_index.py --limited-below 6      mark, not hide, below N trips/week

There is deliberately NO default region: `regions.json` removed `_default` on
2026-08-21 because a silently-wrong dataset reports every route as withdrawn. If
--db is absent this reads the parent town's region from `_gtfs/town_prefixes.json`,
and fails listing the built regions rather than guessing.

OUTPUT. `boarding_index.json`: `destinations[]` sorted alphabetically, each naming
the stand to board at, the routes, the weekly trip count and any alternative stops;
plus `stands[]` carrying the reverse view for the map's own labels.
"""
import argparse
import io
import json
import math
import os
import re
import sqlite3
import sys
from collections import defaultdict

SCRIPT_VERSION = "1.1"


def read_json(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def find_up(start_dir, *rel):
    d = os.path.abspath(start_dir)
    while True:
        cand = os.path.join(d, *rel)
        if os.path.exists(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def resolve_db(folder, explicit, place):
    """Pick the GTFS sqlite. Never guess a region -- fail listing what is built."""
    if explicit:
        return explicit
    gtfs_dir = find_up(folder, "_gtfs", "regions.json")
    if not gtfs_dir:
        return None
    regions = read_json(gtfs_dir).get("regions", {})
    built = {k: v for k, v in regions.items() if v.get("status") == "built"}

    # The parent town's registered region, if this place sits under an area we map.
    tp_path = find_up(folder, "_gtfs", "town_prefixes.json")
    town = (place or {}).get("town") or ""
    if tp_path and town:
        tp = read_json(tp_path)
        entries = tp.get("towns", tp) if isinstance(tp, dict) else {}
        for name, cfg in (entries.items() if isinstance(entries, dict) else []):
            if not isinstance(cfg, dict):
                continue
            if name.lower() in town.lower() or town.lower() in name.lower():
                region = cfg.get("region")
                if region in built:
                    return built[region]["db"]

    sys.stderr.write("boarding_index: no --db given and the parent town's region could not be read.\n")
    sys.stderr.write("  built regions: %s\n" % ", ".join(sorted(built)) or "(none)")
    sys.stderr.write("  re-run with --db <path to that region's .sqlite>\n")
    return None


def main():
    ap = argparse.ArgumentParser(description="Build a boarding plan's destination index.")
    ap.add_argument("--dir", default=".")
    ap.add_argument("--db", default=None, help="GTFS sqlite for the region")
    ap.add_argument("--naptan", default=None)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--min-trips", type=int, default=1,
                    help="drop destinations with fewer than N trips in the feed week")
    ap.add_argument("--limited-below", type=int, default=6,
                    help="mark (not hide) destinations below N trips in the feed week")
    args = ap.parse_args()

    folder = os.path.abspath(args.dir)

    # boardingPlan.excludeRoutes -- services to leave OFF the sheet even though the
    # feed still carries them. The case it was built for: Whippet's 101 to Hunstanton
    # is a summer seaside service whose calendar ends 13 Sep 2026, so a sheet printed
    # in August and read in October would send a reader to Bay 2 for a bus that has
    # stopped running (Peter, 2026-08-23). Filtered HERE, at the index, and never in
    # stands.json -- that file records what NaPTAN and the feed say about a stop, and
    # this is an editorial decision about a sheet. Absent key => byte-identical output.
    exclude = set()
    try:
        _rj = read_json(os.path.join(folder, "routes.json"))
        exclude = {str(r) for r in ((_rj.get("boardingPlan") or {}).get("excludeRoutes") or [])}
    except (OSError, ValueError):
        pass

    try:
        place = read_json(os.path.join(folder, "place.json"))
        stands = read_json(os.path.join(folder, "stands.json"))
    except OSError as exc:
        sys.stderr.write("boarding_index: %s\n" % exc)
        sys.stderr.write("  needs place.json and stands.json in %s\n" % folder)
        sys.stderr.write("  run `python naptan_stands.py --write` there first\n")
        return 2

    if stands.get("verdict") != "OK":
        sys.stderr.write("boarding_index: stands.json verdict is %r, refusing to build an index.\n"
                         % stands.get("verdict"))
        return 1

    dbpath = resolve_db(folder, args.db, place)
    if not dbpath or not os.path.exists(dbpath):
        return 2
    napath = args.naptan or find_up(folder, "_gtfs", "naptan.sqlite")
    if not napath:
        sys.stderr.write("boarding_index: no naptan.sqlite found\n")
        return 2

    db = sqlite3.connect(dbpath)
    nap = sqlite3.connect(napath)

    # atco -> the stand record a reader is sent to
    inframe = {s["atco"]: s for s in stands["stops"] if s.get("label")}
    if not inframe:
        sys.stderr.write("boarding_index: stands.json lists no printable stops\n")
        return 2

    # ---- locality lookup, cached -------------------------------------------
    # ROLLED UP TO THE PARENT LOCALITY, and that is a deliberate choice rather
    # than a tidy-up. NaPTAN's LocalityName is often a hamlet or a quarter --
    # "Fenton End", "Ramsey End", "Boxworth End", "Newtown", "Arbury",
    # "Kings Hedges" -- and none of those is a word a passenger would use to say
    # where they are going. ParentLocalityName is: Pidley cum Fenton, Warboys,
    # Swavesey, Huntingdon, Cambridge, Cambridge. Rolling up collapses the
    # Cambridge suburbs into "Cambridge", which is exactly what rule 2 asks for.
    #
    # The rollup MUST be done per ATCO code and never by name: "Church End"
    # alone has five different parents in the register (Eltisley, Parson Drove,
    # Swavesey, London, Finchley), so a name-keyed table would silently merge
    # villages 80 miles apart.
    #
    # The register is not internally consistent about this, so there is a second
    # pass. "Kings Hedges" carries parent "Cambridge" on its 0500CCITY* rows but
    # NO parent at all on the two 0500SORCH* busway rows -- which are precisely
    # the ones route A calls at, so the per-ATCO rollup alone left a Cambridge
    # suburb sitting in the index as if it were a separate town. The fallback
    # applies a locality's parent from elsewhere in the register, but ONLY where
    # the whole register agrees on a single parent for that name. "Church End"
    # has five, so it is left alone and its per-ATCO parent stands.
    # THE ROLLUP MUST STOP AT A JOINT CIVIL PARISH. Reported by Peter, 2026-08-23:
    # route 301 serves Needingworth and the index printed "Holywell-cum-Needingworth",
    # so a reader looking for the village they were going to could not find it. That
    # is not an unfamiliar spelling, it is a wrong answer: EVERY stop the 301 family
    # calls at in that parish is in Needingworth, and Holywell -- the other half of
    # the name -- has one stop (0500HHOLY009) that no service calls at at all. The
    # printed name therefore advertised a village the bus does not reach.
    #
    # A joint parish ("Holywell-cum-Needingworth", "Bythorn and Keyston") is an
    # ADMINISTRATIVE union of villages that keep their own names, which is a
    # different relationship from the hamlet-to-town one the rollup exists for. The
    # test is narrow on purpose: the child must be a whole COMPONENT of the
    # compound, not merely contained in it. "Fenton End" is not a component of
    # "Pidley cum Fenton", so it still rolls up -- and it must, because most stops
    # in that parish carry "Pidley cum Fenton" directly and un-rolling the other two
    # would print one village under two names.
    #
    # Measured over the whole NaPTAN register (127,658 stops) this fires on exactly
    # six locality names, and every one is a village a passenger would name:
    # Bythorn, Keyston, Caldecote, Folksworth, Washingley, Needingworth.
    JOINT = re.compile(r"\s*(?:-cum-|\scum\s|-with-|\swith\s|-and-|\sand\s|\s&\s)\s*",
                       re.IGNORECASE)

    def _norm(v):
        return re.sub(r"[^a-z0-9]", "", (v or "").lower())

    def joint_parish(child, parent):
        """True when `parent` is a joint parish and `child` is one of its halves."""
        parts = JOINT.split(parent or "")
        if len(parts) < 2:
            return False
        c = _norm(child)
        return bool(c) and any(_norm(x) == c for x in parts)

    parent_of = {}
    ambiguous = set()
    for child, parent in nap.execute(
            "SELECT DISTINCT LocalityName, ParentLocalityName FROM naptan "
            "WHERE LocalityName IS NOT NULL AND TRIM(COALESCE(ParentLocalityName,'')) <> ''"):
        c, p = (child or "").strip(), (parent or "").strip()
        if not c:
            continue
        if c in parent_of and parent_of[c] != p:
            ambiguous.add(c)
        parent_of[c] = p
    for c in ambiguous:
        parent_of.pop(c, None)

    # THE HIERARCHY IS MORE THAN ONE LEVEL DEEP, which is the trap here. Route A
    # calls at 0500SORCH010, whose LocalityName is "Orchard Park" and whose parent
    # is "Kings Hedges" -- and Kings Hedges is itself a child of Cambridge. A
    # single hop up therefore lands on a Cambridge housing estate and prints it in
    # the index as though it were a separate town. So climb to the top of the
    # chain, with a visited-set because a register this size cannot be assumed
    # acyclic.
    def climb(name):
        seen_names = set()
        cur = name
        while cur and cur not in seen_names:
            seen_names.add(cur)
            nxt = parent_of.get(cur)
            if not nxt or nxt == cur:
                break
            if joint_parish(cur, nxt):
                break
            cur = nxt
        return cur

    loc_cache = {}

    def locality(atco):
        if atco in loc_cache:
            return loc_cache[atco]
        r = nap.execute(
            "SELECT LocalityName, ParentLocalityName FROM naptan WHERE ATCOCode=?",
            (atco,)).fetchone()
        val = None
        if r:
            child, parent = (r[0] or "").strip(), (r[1] or "").strip()
            if parent and child and joint_parish(child, parent):
                val = child                      # a half of a joint parish keeps its own name
            else:
                val = climb(parent or child) or None
        loc_cache[atco] = val
        return val

    home = None
    counts = defaultdict(int)
    for a in inframe:
        l = locality(a)
        if l:
            counts[l] += 1
    if counts:
        home = max(counts, key=lambda k: counts[k])

    # ---- how often a trip actually runs -------------------------------------
    # A raw count of matching rows in the feed is NOT a frequency: it counts
    # timetable patterns, not journeys, and the place skill's own gotchas record
    # a "7" that meant seven journeys EVERY weekday and a "Daily" service that
    # was really Sunday-only. So each trip is weighted by the number of days its
    # calendar entry actually operates, giving journeys per week. (calendar_dates
    # exceptions -- bank holidays, one-off cancellations -- are not applied; they
    # move individual dates rather than the weekly shape.)
    week_of = {}
    for sid, *flags in db.execute(
            "SELECT service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday "
            "FROM calendar"):
        week_of[sid] = sum(1 for f in flags if str(f) == "1")

    # ---- walk every trip touching an in-frame stop --------------------------
    ph = ",".join("?" * len(inframe))
    trip_ids = [r[0] for r in db.execute(
        "SELECT DISTINCT trip_id FROM stop_times WHERE stop_id IN (%s)" % ph, list(inframe))]

    # dest -> atco -> {routes:set, trips:int}
    reach = defaultdict(lambda: defaultdict(lambda: {"routes": set(), "trips": 0}))
    route_of = {}
    for tid in trip_ids:
        row = db.execute(
            "SELECT r.route_short_name, t.service_id FROM trips t JOIN routes r ON r.route_id=t.route_id "
            "WHERE t.trip_id=?", (tid,)).fetchone()
        if not row:
            continue
        rname, svc = row[0], row[1]
        if rname in exclude:
            continue          # boardingPlan.excludeRoutes
        per_week = week_of.get(svc, 0)
        if per_week == 0:
            continue  # no operating day in the feed week -- not a service a reader can catch
        seq = [r[0] for r in db.execute(
            "SELECT stop_id FROM stop_times WHERE trip_id=? ORDER BY CAST(stop_sequence AS INTEGER)",
            (tid,))]
        for i, sid in enumerate(seq):
            if sid not in inframe:
                continue
            onward = seq[i + 1:]
            if not onward:
                continue  # terminates here -- not a boarding point for anywhere
            seen = set()
            for nxt in onward:
                l = locality(nxt)
                if not l or l == home or l in seen:
                    continue
                seen.add(l)
                cell = reach[l][sid]
                cell["routes"].add(rname)
                cell["trips"] += per_week
            route_of.setdefault(rname, True)

    if exclude:
        print("  boardingPlan.excludeRoutes: left off the sheet -- %s"
              % ", ".join(sorted(exclude)))

    if not reach:
        sys.stderr.write("boarding_index: no onward destinations found\n")
        return 1

    # ---- pick the stand for each destination --------------------------------
    dests = []
    for dest, bystop in reach.items():
        options = []
        for sid, cell in bystop.items():
            st = inframe[sid]
            options.append({
                "atco": sid,
                "label": st["label"],
                "class": st["class"],
                "distM": st["distM"],
                "walkMin": st["walkMin"],
                "routes": sorted(cell["routes"]),
                "trips": cell["trips"],
            })
        # shortest walk wins; more trips breaks a tie; label for determinism
        options.sort(key=lambda o: (o["distM"], -o["trips"], o["label"]))
        best = options[0]
        total = sum(o["trips"] for o in options)
        if total < args.min_trips:
            continue
        dests.append({
            "destination": dest,
            "boardAt": best["label"],
            "boardAtAtco": best["atco"],
            "boardClass": best["class"],
            "walkMin": best["walkMin"],
            "routes": best["routes"],
            "trips": best["trips"],
            "limited": best["trips"] < args.limited_below,
            "alsoFrom": [o for o in options[1:]],
        })

    dests.sort(key=lambda d: d["destination"].lower())

    # ---- reverse view, for the map's stand labels ---------------------------
    per_stand = defaultdict(lambda: {"destinations": [], "routes": set()})
    for d in dests:
        per_stand[d["boardAtAtco"]]["destinations"].append(d["destination"])
        per_stand[d["boardAtAtco"]]["routes"].update(d["routes"])
    stand_view = []
    for s in stands["stops"]:
        if not s.get("label"):
            continue
        v = per_stand.get(s["atco"], {"destinations": [], "routes": set()})
        stand_view.append({
            "atco": s["atco"], "label": s["label"], "class": s["class"],
            "distM": s["distM"], "walkMin": s["walkMin"], "facing": s.get("facing"),
            "name": s.get("name"), "pos": s.get("gtfsPos"),
            "routes": sorted(v["routes"]), "destinations": sorted(v["destinations"]),
        })

    # ---- report -------------------------------------------------------------
    print("# boarding_index v%s — %s" % (SCRIPT_VERSION, place.get("name")))
    print("  region db: %s   home locality: %s" % (os.path.basename(dbpath), home))
    print("  %d trip(s) touch the frame; %d destination(s) reachable" % (len(trip_ids), len(dests)))
    print()
    for sv in stand_view:
        print("  %-26s %-9s %3d m  %2d route(s)  %3d destination(s)"
              % (sv["label"], "[" + sv["class"] + "]", sv["distM"],
                 len(sv["routes"]), len(sv["destinations"])))
    print()
    print("  %-30s %-26s %-18s %s" % ("DESTINATION", "BOARD AT", "ROUTES", "TRIPS/wk"))
    for d in dests:
        mark = " (limited)" if d["limited"] else ""
        alt = ("   also: " + ", ".join(o["label"] for o in d["alsoFrom"])) if d["alsoFrom"] else ""
        print("  %-30s %-26s %-18s %4d%s%s"
              % (d["destination"][:30], d["boardAt"][:26],
                 ", ".join(d["routes"])[:18], d["trips"], mark, alt))

    if args.write:
        out = {
            "place": place.get("name"),
            "homeLocality": home,
            "generatedBy": "boarding_index.py v%s" % SCRIPT_VERSION,
            "region": os.path.basename(dbpath),
            "stands": stand_view,
            "destinations": dests,
        }
        path = os.path.join(folder, "boarding_index.json")
        with io.open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(out, indent=1, ensure_ascii=False))
        print("\n  wrote %s" % path)

    return 0


if __name__ == "__main__":
    sys.exit(main())
