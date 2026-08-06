#!/usr/bin/env python3
"""P3 helper for make-place-bus-leaflet -- fill destinations[].stops (the
intermediate-stop names gen_external_places.js needs to draw ticks along a
spoke, mirroring the town skill's external[].stops) from the P2 chain data.

Only single-route spokes get stops: a spoke with several routes.routes[]
riding it has no one unambiguous stop sequence (see gen_external_places.js's
comment on why it originally had none at all), so this script leaves
multi-route destinations untouched.

Reads (all already on disk from P2/P3, none re-fetched):
  routes_full_atco.json  -- {route: {directions:[{name,stops:[ATCO...]}], ...}}
  atco2ll.json            -- {ATCO: [lat,lon]}
  atco2name.json          -- {ATCO: "Stop name"}
  place.json               -- {lat, lon, ...}  (the place's own coordinate)
  routes.json               -- destinations[] to fill (curated, P3)

For each single-route destination: pick the route's direction whose LAST stop
name contains the destination name (same substring match discipline as
gtfs_duration.py's journey_minutes); find the chain stop nearest the place
coordinate as "where our rider boards"; take every stop AFTER that point,
de-duplicate consecutive same-named stops (timing-point re-announcements),
and keep at most `--max-stops` intermediate names plus the terminus itself
as the last element -- matching gen_external_radial.js's stops[] convention
(intermediate ... terminus last). Evenly samples when the chain has more
stops than the cap, so a 20-stop run to Cambridge doesn't dump 20 ticks on
one spoke.

Only ever ADDS a "stops" array to a destination lacking one -- re-run safely.

Usage:
  python derive_stops.py routes.json --dir . [--max-stops 4]
"""
import json, os, argparse, math


def _clean_dest(label):
    return str(label).split('(')[0].strip()


def _haversine_km(la1, lo1, la2, lo2):
    dla = math.radians(la2 - la1); dlo = math.radians(lo2 - lo1)
    x = math.sin(dla / 2) ** 2 + math.cos(math.radians(la1)) * math.cos(math.radians(la2)) * math.sin(dlo / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(x))


def pick_direction(chain, dest_clean):
    dirs = chain.get('directions', [])
    dl = dest_clean.lower()
    matches = [d for d in dirs if dl in (d.get('name', '') or '').lower()]
    return matches[0] if matches else (dirs[0] if dirs else None)


def nearest_index(stops, atco2ll, plat, plon):
    best_i, best_d = None, None
    for i, sid in enumerate(stops):
        ll = atco2ll.get(sid)
        if not ll:
            continue
        d = _haversine_km(plat, plon, ll[0], ll[1])
        if best_d is None or d < best_d:
            best_d, best_i = d, i
    return best_i


def sample_names(names, max_stops):
    """Keep the terminus (last) always; evenly sample the intermediates down
    to max_stops-1 if there are more than that."""
    if len(names) <= max_stops:
        return names
    terminus = names[-1]
    body = names[:-1]
    keep_n = max_stops - 1
    if keep_n <= 0:
        return [terminus]
    step = len(body) / keep_n
    picked = [body[int(i * step)] for i in range(keep_n)]
    return picked + [terminus]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('routes_json')
    ap.add_argument('--dir', default='.', help='directory holding the P2 chain files')
    ap.add_argument('--max-stops', type=int, default=4)
    a = ap.parse_args()

    def load(name):
        with open(os.path.join(a.dir, name), encoding='utf-8') as f:
            return json.load(f)

    D = json.load(open(a.routes_json, encoding='utf-8'))
    chains = load('routes_full_atco.json')
    atco2ll = load('atco2ll.json')
    atco2name = load('atco2name.json')
    place = load('place.json')
    plat, plon = place['lat'], place['lon']

    filled = 0; skipped = 0; noroute = 0
    for b in D.get('destinations', []):
        if b.get('stops'):
            skipped += 1; continue
        routes = b.get('routes') or []
        if len(routes) != 1:
            continue  # ambiguous multi-route spoke -- leave alone
        chain = chains.get(routes[0])
        if not chain:
            noroute += 1; continue
        direction = pick_direction(chain, _clean_dest(b.get('name', '')))
        if not direction or not direction.get('stops'):
            noroute += 1; continue
        stops = direction['stops']
        i0 = nearest_index(stops, atco2ll, plat, plon)
        if i0 is None:
            noroute += 1; continue
        downstream = stops[i0 + 1:]
        if not downstream:
            noroute += 1; continue
        names = []
        for sid in downstream:
            nm = atco2name.get(sid)
            if nm and (not names or names[-1] != nm):
                names.append(nm)
        if not names:
            noroute += 1; continue
        b['stops'] = sample_names(names, a.max_stops)
        filled += 1
        print(f"  {routes[0]:6s} -> {b.get('name',''):20s} {' / '.join(b['stops'])}")

    with open(a.routes_json, 'w', encoding='utf-8') as f:
        json.dump(D, f, indent=1, ensure_ascii=False)
    print(f"filled {filled}, left {skipped} (already set), {noroute} had no usable chain, wrote {a.routes_json}")


if __name__ == '__main__':
    main()
