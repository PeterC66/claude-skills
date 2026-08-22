#!/usr/bin/env python3
"""Approximate journey-time minutes from a town/place's own stops to a named
destination, for a given route, from the shared GTFS SQLite -- feeds the
opt-in `minutesToDestination` field read by gen_external_radial.js
(town external[] entries) and gen_external_places.js (place destinations[]
entries). Absent field => no change to either generator's output.

Needs gtfs_build.py's stop_times table to include arrival_time/departure_time
(added 2026-08-03) -- rebuild the sqlite first if it predates that change.

Usage (single lookup):
  python gtfs_duration.py <ATCO_PREFIX> [<ATCO_PREFIX> ...] --route 46 --dest Wisbech [--db PATH]
  python gtfs_duration.py --near lat,lon,km --route 46 --dest Wisbech [--db PATH]

Usage (fill every external[] spoke in a town's routes.json that has none yet):
  python gtfs_duration.py <ATCO_PREFIX> [<ATCO_PREFIX> ...] --fill routes.json [--db PATH]
  python gtfs_duration.py --near lat,lon,km --fill routes.json [--db PATH]
  (matches each external[] entry's "route" + the LAST name in its "stops"
  list as the destination; only ever ADDS minutesToDestination, never
  overwrites a value already present -- re-run safely after edits)

Usage (fill every destinations[] spoke in a PLACE's routes.json that has none
yet -- the place skill's equivalent of --fill, run at P3):
  python gtfs_duration.py <ATCO_PREFIX> [<ATCO_PREFIX> ...] --fill-place routes.json [--db PATH]
  python gtfs_duration.py --near lat,lon,km --fill-place routes.json [--db PATH]
  (a place destination can be reached by several routes at once -- tries every
  route in that destination's "routes" list against the destination "name"
  and keeps the FASTEST that returns a confident answer, since that's the
  journey a rider would actually choose; only ever ADDS minutesToDestination,
  never overwrites a value already present -- re-run safely after edits)

--near is for a town with no clean ATCO prefix (an over-broad NaPTAN block --
same trap documented in s1-services.md / town_prefixes.json for Beaconsfield
and High Wycombe): give the same lat,lon,km used for that town's S1 query.
"""
import sqlite3, argparse, os, json, statistics
from math import radians, sin, cos, asin, sqrt
from collections import Counter
import gtfs_regions

def _to_seconds(hms):
    if not hms: return None
    try:
        h, m, s = hms.split(':')
        return int(h) * 3600 + int(m) * 60 + int(s)
    except ValueError:
        return None

def _haversine_km(la1, lo1, la2, lo2):
    dla = radians(la2 - la1); dlo = radians(lo2 - lo1)
    x = sin(dla / 2) ** 2 + cos(radians(la1)) * cos(radians(la2)) * sin(dlo / 2) ** 2
    return 6371 * 2 * asin(sqrt(x))

def _norm_stop_name(s):
    return ' '.join(str(s or '').lower().split())

def _locality(atco):
    """NaPTAN locality of a stop -- "0500HSTIV025" -> "0500HSTIV". None if the
    stop_id is not in that coded form (cross-border stops often are not)."""
    s = str(atco or '')
    return s[:9] if len(s) >= 10 and s[:4].isdigit() and s[4:9].isalpha() else None

def resolve_origin_stop_ids(cur, prefixes=None, near=None):
    """Exact stop_ids for the origin, from ATCO prefix(es) or a (lat,lon,km)
    radius -- mirrors gtfs_query.py's _make_town_stops. Returns a set."""
    ids = set()
    if prefixes:
        for p in prefixes:
            ids.update(r[0] for r in cur.execute(
                "SELECT stop_id FROM stops WHERE stop_id LIKE ?", (p + '%',)))
    if near:
        la, lo, km = near
        for sid, slat, slon in cur.execute(
                "SELECT stop_id, stop_lat, stop_lon FROM stops WHERE stop_lat<>'' AND stop_lon<>''"):
            try:
                if _haversine_km(la, lo, float(slat), float(slon)) <= km: ids.add(sid)
            except ValueError:
                pass
    return ids

def journey_minutes(cur, origin_stop_ids, route_short_name, dest_substr, allow_majority_fallback=False, sample=300):
    """Median scheduled minutes from the last stop matching `prefixes` to the
    destination, across up to `sample` trips of `route_short_name` that call
    at the origin. GTFS stop names are POI/street names ("Superstore"), not
    village names, so route destinations are rarely named `dest_substr`
    literally -- primarily use each trip's ACTUAL LAST STOP (its real
    terminus, matching what the external map draws a spoke to). Where a
    route has more than one arm (e.g. "56" splits to Manea and to Wisbech),
    disambiguate by preferring trips whose last-stop name contains
    `dest_substr`. When `allow_majority_fallback` is True (the caller's
    responsibility to set only when it KNOWS this route has just one spoke in
    this town -- multiple external[] entries sharing a route number must
    never set it, or two different arms silently blend into one wrong
    number), also try every trip whose terminus matches the MAJORITY terminus
    across all sampled trips (not literally every terminus -- one outlier
    trip ending at a different timing point, e.g. an early-turnback working,
    must not block the fallback that would otherwise correctly handle the
    common single-arm case where name-matching fails because GTFS uses POI
    names, not village names).
    Returns (minutes_or_None, n_trips_sampled)."""
    route_ids = [r[0] for r in cur.execute(
        "SELECT DISTINCT route_id FROM routes WHERE route_short_name=?", (route_short_name,))]
    if not route_ids: return None, 0
    ph = ','.join('?' * len(route_ids))
    # route_short_name collides across operators/regions in national GTFS, so
    # restrict to trips of THIS short_name that actually call at the origin
    # (same discipline gtfs_query.py uses), not every trip on any same-named route.
    oph = ','.join('?' * len(origin_stop_ids))
    trip_rows = cur.execute(
        f"SELECT DISTINCT t.trip_id, t.trip_headsign FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id "
        f"WHERE t.route_id IN ({ph}) AND st.stop_id IN ({oph}) LIMIT ?",
        route_ids + list(origin_stop_ids) + [sample]).fetchall()
    dest_l = dest_substr.lower()
    trips = []  # (origin_i, rows, headsign) per trip that clears the origin stop
    terminus_counts = Counter()
    for tid, headsign in trip_rows:
        rows = list(cur.execute(
            "SELECT st.stop_id, st.departure_time, st.arrival_time, s.stop_name, "
            "s.stop_lat, s.stop_lon "
            "FROM stop_times st JOIN stops s ON s.stop_id=st.stop_id "
            "WHERE st.trip_id=? ORDER BY CAST(st.stop_sequence AS INT)", (tid,)))
        if not rows: continue
        origin_i = None
        for i, r in enumerate(rows):
            if r['stop_id'] in origin_stop_ids:
                origin_i = i  # keep the LAST matching stop (town may have several)
        if origin_i is None or origin_i >= len(rows) - 1: continue
        trips.append((origin_i, rows, headsign or ''))
        terminus_counts[(rows[-1]['stop_name'] or '').lower()] += 1

    def _matches(headsign, last_name):
        # trip_headsign usually names the destination TOWN literally ("Cambridge
        # Drummer St Bus Station"); the final stop's own name is often just the
        # POI ("Drummer St Bus Station") with no town in it, so check both.
        return dest_l in headsign.lower() or dest_l in (last_name or '').lower()

    def _arrival_index(origin_i, rows):
        """Which stop to time the journey TO.

        Every path here identifies the destination as the trip's LAST stop, which is
        right for a route that ends there and wrong for one that loops: route 9 out of
        Godmanchester reaches St Ives Bus Station at 09:15, carries on round through
        Fenstanton, Boxworth and Conington, and returns to the SAME bus station at
        10:13, where the trip ends. Timing to the last stop called that 20-minute ride
        78 minutes. A rider gets off the first time the bus arrives, so return the
        EARLIEST arrival at the terminus. Matching on stop_id alone is not enough: the
        two visits above are 0500HSTIV025 and 0500HSTIV002, separate stands of the one
        bus station. Match instead on SAME NaPTAN LOCALITY AND SAME STOP NAME, which
        pairs those two and nothing else. A plain distance rule was tried and rejected
        -- a 400 m radius also swallowed the ordinary approach stop before a terminus
        and quietly shaved a minute off 13 of 44 town spokes.

        Deliberately no more than this. `bearing`/`distKm` in routes.json look like a
        better handle but are SCHEMATIC -- the radial diagram spreads its spokes apart
        to stay legible, so High Wycombe town centre is drawn at 270 degrees where it
        really lies at about 295, and projecting that lands 1.3 km away on an unrelated
        stop. Measured 2026-08-22; see open-actions."""
        end = len(rows) - 1
        eloc = _locality(rows[end]['stop_id'])
        ename = _norm_stop_name(rows[end]['stop_name'])
        for j in range(origin_i + 1, end):
            if rows[j]['stop_id'] == rows[end]['stop_id']:
                return j
            if eloc and ename and _locality(rows[j]['stop_id']) == eloc \
                    and _norm_stop_name(rows[j]['stop_name']) == ename:
                return j
        return end

    def _durations(filter_fn):
        out = []
        for origin_i, rows, headsign in trips:
            if filter_fn and not filter_fn(headsign, rows[-1]['stop_name']):
                continue
            end_i = _arrival_index(origin_i, rows)
            t0 = _to_seconds(rows[origin_i]['departure_time'] or rows[origin_i]['arrival_time'])
            t1 = _to_seconds(rows[end_i]['arrival_time'] or rows[end_i]['departure_time'])
            if t0 is None or t1 is None or t1 < t0: continue
            out.append((t1 - t0) / 60)
        return out

    durations = _durations(_matches)
    if len(durations) < 3 and allow_majority_fallback and terminus_counts:
        majority_terminus, majority_n = terminus_counts.most_common(1)[0]
        if majority_n >= 3:
            wider = _durations(lambda h, l: (l or '').lower() == majority_terminus)
            if len(wider) > len(durations): durations = wider
    if len(durations) < 3: return None, len(durations)  # too thin a sample to trust
    return round(statistics.median(durations)), len(durations)

def _clean_dest(label):
    """routes.json labels are human-friendly ("Cambridge (Drummer St)"), not
    exact GTFS stop names -- strip a trailing parenthetical/qualifier so the
    substring match in journey_minutes has a real chance of hitting."""
    return label.split('(')[0].strip()

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Approx GTFS journey minutes town/place -> named destination.")
    ap.add_argument("prefixes", nargs="*", help="ATCO locality prefix(es) of the origin, e.g. 0500HSTIV (omit if using --near)")
    ap.add_argument("--near", help="'lat,lon,km' instead of prefixes, for a town with no clean ATCO prefix (e.g. '51.601601,-0.637726,2.5')")
    ap.add_argument("--route", help="route_short_name, e.g. 46 (single-lookup mode)")
    ap.add_argument("--dest", help="destination name substring, e.g. Wisbech (single-lookup mode)")
    ap.add_argument("--fill", help="routes.json path: fill every external[] entry lacking minutesToDestination")
    ap.add_argument("--fill-place", help="routes.json path (place skill): fill every destinations[] entry lacking minutesToDestination")
    ap.add_argument("--db", default=None,
                   help="this region's sqlite. NO DEFAULT - every region is treated the same (see _gtfs/regions.json); $GTFS_DB also works.")
    a = ap.parse_args()
    # No default region: resolve --db / $GTFS_DB, or fail listing the built regions.
    a.db = gtfs_regions.resolve_db(a.db)
    if not a.prefixes and not a.near:
        ap.error("give one or more ATCO prefixes, or --near lat,lon,km")
    near = None
    if a.near:
        la, lo, km = [float(x) for x in a.near.split(',')]; near = (la, lo, km)
    con = sqlite3.connect(a.db); con.row_factory = sqlite3.Row; cur = con.cursor()
    origin_stop_ids = resolve_origin_stop_ids(cur, a.prefixes or None, near)
    if not origin_stop_ids:
        ap.error("no stops matched the given prefixes/--near")

    if a.fill:
        with open(a.fill, encoding="utf-8") as f:
            D = json.load(f)
        route_spoke_count = Counter(b["route"] for b in D.get("external", []))
        filled = 0; skipped = 0
        for b in D.get("external", []):
            if b.get("minutesToDestination") is not None:
                skipped += 1; continue
            dest_raw = b["stops"][-1] if b.get("stops") else b.get("label")
            single_arm = route_spoke_count[b["route"]] == 1
            mins, n = journey_minutes(cur, origin_stop_ids, b["route"], _clean_dest(dest_raw), allow_majority_fallback=single_arm)
            if mins is not None:
                b["minutesToDestination"] = mins
                filled += 1
                print(f"  {b['route']:6s} -> {b['label']:20s} ~{mins} min  (n={n})")
            else:
                print(f"  {b['route']:6s} -> {b['label']:20s} no match found")
        with open(a.fill, "w", encoding="utf-8") as f:
            json.dump(D, f, indent=1, ensure_ascii=False)
        print(f"filled {filled}, left {skipped} (already set), wrote {a.fill}")
    elif a.fill_place:
        with open(a.fill_place, encoding="utf-8") as f:
            D = json.load(f)
        dests = D.get("destinations", [])
        # a route serving more than one destination spoke is ambiguous the same way a
        # town's split route is (see journey_minutes' allow_majority_fallback doc) --
        # only trust the terminus-name fallback when this route names exactly one spoke.
        route_dest_count = Counter(r for b in dests for r in (b.get("routes") or []))
        filled = 0; skipped = 0
        for b in dests:
            if b.get("minutesToDestination") is not None:
                skipped += 1; continue
            dest_clean = _clean_dest(b.get("name", ""))
            best = None; best_n = 0
            for r in (b.get("routes") or []):
                single_arm = route_dest_count[r] == 1
                mins, n = journey_minutes(cur, origin_stop_ids, r, dest_clean, allow_majority_fallback=single_arm)
                if mins is not None and (best is None or mins < best):
                    best = mins; best_n = n
            if best is not None:
                b["minutesToDestination"] = best
                filled += 1
                print(f"  {b.get('name',''):20s} ~{best} min  (n={best_n})")
            else:
                print(f"  {b.get('name',''):20s} no match found")
        with open(a.fill_place, "w", encoding="utf-8") as f:
            json.dump(D, f, indent=1, ensure_ascii=False)
        print(f"filled {filled}, left {skipped} (already set), wrote {a.fill_place}")
    else:
        if not a.route or not a.dest:
            ap.error("give --route and --dest, or --fill routes.json, or --fill-place routes.json")
        mins, n = journey_minutes(cur, origin_stop_ids, a.route, a.dest)
        if mins is None:
            print("no matching trips found")
        else:
            print(f"~{mins} min (median of {n} scheduled trips)")
    con.close()
