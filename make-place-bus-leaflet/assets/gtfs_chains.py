#!/usr/bin/env python3
"""P2 data engine for make-place-bus-leaflet — build route chains STANDALONE from
the GTFS database, no bustimes scrape required.

The town skill pulls stop order from bustimes because GTFS *shapes* (road geometry)
are only published by big operators. But stop ORDER lives in GTFS stop_times for
EVERY operator's trips, so for a place leaflet (point-native, no locality slug) we
can derive each route's full both-direction stop chain directly and offline.

Given a centre point + service radius, for every route that stops within the radius
it emits, into --out DIR:
  * routes_full_atco.json  { "<route>": { directions:[{name,stops:[ATCO...]}],
                             canonical:[same first dir], all:[ATCO...] } }
                           (shape matches the town skill's S2 output, so
                            derive_walkshed.js / gen_internal.js consume it directly)
  * atco2ll.json           { "<ATCO>": [lat, lon] }   (every stop in every chain)
  * atco2name.json         { "<ATCO>": "Stop name" }
  * gtfs-services.json     the gtfs_query facts (operators/days/termini/headsigns)

Caveat (documented, same as the town skill): community / demand-responsive /
pre-book minibuses are NOT in BODS, so they won't appear here — note them by hand
if the place is served by one.

Usage:
  python gtfs_chains.py --near "lat,lon,km" [--db PATH] [--out DIR]
  (km = the SERVICE radius: a route counts as serving the place if it stops within
   it. The tighter internal-map walkshed is applied later by derive_walkshed.js.)
"""
import sqlite3, sys, json, argparse, os

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, r"C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets")
import gtfs_query  # reuse the BODS facts query + haversine


def town_stop_ids(cur, la, lo, km):
    ids = []
    for sid, sla, slo in cur.execute(
            "SELECT stop_id,stop_lat,stop_lon FROM stops WHERE stop_lat<>'' AND stop_lon<>''"):
        try:
            if gtfs_query._haversine_km(la, lo, float(sla), float(slo)) <= km:
                ids.append(sid)
        except ValueError:
            pass
    return ids


def longest_trip_per_direction(cur, route_ids, tset):
    """Return {direction_id: (nstops, trip_id, [ordered stop_ids], headsign)} picking,
    per GTFS direction_id, the fullest trip THAT ACTUALLY SERVES THE PLACE (visits a
    stop in tset). Restricting to place-serving trips is essential: a route_short_name
    can span unrelated route_ids (two operators' "69"), and the globally-longest trip
    may be a different pattern that never comes near the place."""
    ph = ",".join("?" * len(route_ids))
    trips = cur.execute(
        f"SELECT trip_id,direction_id,trip_headsign FROM trips WHERE route_id IN ({ph})",
        route_ids).fetchall()
    best = {}   # dir -> (nstops, trip_id, stops, headsign)
    for tid, did, head in trips:
        seq = [r[0] for r in cur.execute(
            "SELECT stop_id FROM stop_times WHERE trip_id=? ORDER BY CAST(stop_sequence AS INT)",
            (tid,))]
        if len(seq) < 2:
            continue
        if not any(s in tset for s in seq):     # trip must pass through the place
            continue
        key = did if did not in (None, "") else "0"
        if key not in best or len(seq) > best[key][0]:
            best[key] = (len(seq), tid, seq, head or "")
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--near", required=True, help="lat,lon,km service radius")
    DEFAULT_DB = os.environ.get("CAMBS_GTFS_DB",
                                r"C:\u3a St Ives\Using AI\Buses\_gtfs\cambridgeshire.sqlite")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--out", default=".")
    ap.add_argument("--town", default="")
    a = ap.parse_args()
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    la, lo, km = [float(x) for x in a.near.split(",")]
    os.makedirs(a.out, exist_ok=True)

    con = sqlite3.connect(a.db); con.row_factory = None; cur = con.cursor()
    tset = set(town_stop_ids(cur, la, lo, km))
    if not tset:
        raise SystemExit(f"No GTFS stops within {km} km of {la},{lo} — widen --near or check --db region.")
    tph = ",".join("?" * len(tset))
    tlist = list(tset)

    # route_short_name -> its route_ids, restricted to routes that stop in the radius
    rn_ids = {}
    for sn, rid in cur.execute(f"""
        SELECT DISTINCT r.route_short_name, r.route_id
        FROM routes r JOIN trips t ON t.route_id=r.route_id
        JOIN stop_times st ON st.trip_id=t.trip_id
        WHERE st.stop_id IN ({tph})""", tlist):
        rn_ids.setdefault(sn, []).append(rid)

    routes_full = {}
    atco = set()
    for sn, rids in rn_ids.items():
        best = longest_trip_per_direction(cur, rids, tset)
        dirs = []
        for key in sorted(best):
            _, _tid, stops, head = best[key]
            a2n = {}  # local first/last name for the direction label
            first = stops[0]; last = stops[-1]
            nm = cur.execute("SELECT stop_id,stop_name FROM stops WHERE stop_id IN (?,?)",
                             (first, last)).fetchall()
            for sid, name in nm: a2n[sid] = name
            label = f"{a2n.get(first, first)} - {a2n.get(last, last)}"
            if head: label = head if len(best) == 1 else label
            dirs.append({"name": label, "stops": stops})
            atco.update(stops)
        if not dirs:
            continue
        allset = []
        seen = set()
        for d in dirs:
            for s in d["stops"]:
                if s not in seen: seen.add(s); allset.append(s)
        routes_full[sn] = {"directions": dirs, "canonical": [dirs[0]], "all": allset}

    # coords + names for every atco in the chains
    a2ll = {}; a2nm = {}
    aph_all = list(atco)
    for i in range(0, len(aph_all), 900):   # chunk to keep the IN() list sane
        chunk = aph_all[i:i+900]; ph = ",".join("?" * len(chunk))
        for sid, name, sla, slo in cur.execute(
                f"SELECT stop_id,stop_name,stop_lat,stop_lon FROM stops WHERE stop_id IN ({ph})", chunk):
            try:
                a2ll[sid] = [float(sla), float(slo)]
            except (ValueError, TypeError):
                pass
            a2nm[sid] = name

    facts = gtfs_query.query(a.db, near=(la, lo, km), town=a.town)

    def w(name, obj): json.dump(obj, open(os.path.join(a.out, name), "w", encoding="utf-8"),
                                indent=1, ensure_ascii=False)
    w("routes_full_atco.json", routes_full)
    w("atco2ll.json", a2ll)
    w("atco2name.json", a2nm)
    w("gtfs-services.json", facts)

    con.close()
    print(f"# gtfs_chains — {len(tset)} stops within {km} km; {len(routes_full)} routes")
    for sn in sorted(routes_full, key=lambda s: (len(s), s)):
        ds = routes_full[sn]["directions"]
        print(f"  {sn:6s} {len(ds)} dir(s), {len(routes_full[sn]['all'])} stops"
              f"   [{' | '.join(d['name'][:34] for d in ds)}]")
    print(f"Wrote routes_full_atco.json, atco2ll.json, atco2name.json, gtfs-services.json to {a.out}")


if __name__ == "__main__":
    main()
