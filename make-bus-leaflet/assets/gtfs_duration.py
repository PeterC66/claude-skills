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

Usage (fill every external[] spoke in a town's routes.json that has none yet):
  python gtfs_duration.py <ATCO_PREFIX> [<ATCO_PREFIX> ...] --fill routes.json [--db PATH]
  (matches each external[] entry's "route" + the LAST name in its "stops"
  list as the destination; only ever ADDS minutesToDestination, never
  overwrites a value already present -- re-run safely after edits)
"""
import sqlite3, argparse, os, json, statistics
from collections import Counter

def _to_seconds(hms):
    if not hms: return None
    try:
        h, m, s = hms.split(':')
        return int(h) * 3600 + int(m) * 60 + int(s)
    except ValueError:
        return None

def journey_minutes(cur, prefixes, route_short_name, dest_substr, allow_majority_fallback=False, sample=300):
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
    origin_cond = ' OR '.join('st.stop_id LIKE ?' for _ in prefixes)
    trip_rows = cur.execute(
        f"SELECT DISTINCT t.trip_id, t.trip_headsign FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id "
        f"WHERE t.route_id IN ({ph}) AND ({origin_cond}) LIMIT ?",
        route_ids + [p + '%' for p in prefixes] + [sample]).fetchall()
    dest_l = dest_substr.lower()
    trips = []  # (origin_i, rows, headsign) per trip that clears the origin stop
    terminus_counts = Counter()
    for tid, headsign in trip_rows:
        rows = list(cur.execute(
            "SELECT st.stop_id, st.departure_time, st.arrival_time, s.stop_name "
            "FROM stop_times st JOIN stops s ON s.stop_id=st.stop_id "
            "WHERE st.trip_id=? ORDER BY CAST(st.stop_sequence AS INT)", (tid,)))
        if not rows: continue
        origin_i = None
        for i, r in enumerate(rows):
            if any(r['stop_id'].startswith(p) for p in prefixes):
                origin_i = i  # keep the LAST matching stop (town may have several)
        if origin_i is None or origin_i >= len(rows) - 1: continue
        trips.append((origin_i, rows, headsign or ''))
        terminus_counts[(rows[-1]['stop_name'] or '').lower()] += 1

    def _matches(headsign, last_name):
        # trip_headsign usually names the destination TOWN literally ("Cambridge
        # Drummer St Bus Station"); the final stop's own name is often just the
        # POI ("Drummer St Bus Station") with no town in it, so check both.
        return dest_l in headsign.lower() or dest_l in (last_name or '').lower()

    def _durations(filter_fn):
        out = []
        for origin_i, rows, headsign in trips:
            if filter_fn and not filter_fn(headsign, rows[-1]['stop_name']):
                continue
            t0 = _to_seconds(rows[origin_i]['departure_time'] or rows[origin_i]['arrival_time'])
            t1 = _to_seconds(rows[-1]['arrival_time'] or rows[-1]['departure_time'])
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
    ap.add_argument("prefixes", nargs="+", help="ATCO locality prefix(es) of the origin, e.g. 0500HSTIV")
    ap.add_argument("--route", help="route_short_name, e.g. 46 (single-lookup mode)")
    ap.add_argument("--dest", help="destination name substring, e.g. Wisbech (single-lookup mode)")
    ap.add_argument("--fill", help="routes.json path: fill every external[] entry lacking minutesToDestination")
    DEFAULT_DB = os.environ.get("CAMBS_GTFS_DB", r"C:\u3a St Ives\Using AI\Buses\_gtfs\cambridgeshire.sqlite")
    ap.add_argument("--db", default=DEFAULT_DB)
    a = ap.parse_args()
    con = sqlite3.connect(a.db); con.row_factory = sqlite3.Row; cur = con.cursor()

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
            mins, n = journey_minutes(cur, a.prefixes, b["route"], _clean_dest(dest_raw), allow_majority_fallback=single_arm)
            if mins is not None:
                b["minutesToDestination"] = mins
                filled += 1
                print(f"  {b['route']:6s} -> {b['label']:20s} ~{mins} min  (n={n})")
            else:
                print(f"  {b['route']:6s} -> {b['label']:20s} no match found")
        with open(a.fill, "w", encoding="utf-8") as f:
            json.dump(D, f, indent=1, ensure_ascii=False)
        print(f"filled {filled}, left {skipped} (already set), wrote {a.fill}")
    else:
        if not a.route or not a.dest:
            ap.error("give --route and --dest, or --fill routes.json")
        mins, n = journey_minutes(cur, a.prefixes, a.route, a.dest)
        if mins is None:
            print("no matching trips found")
        else:
            print(f"~{mins} min (median of {n} scheduled trips)")
    con.close()
