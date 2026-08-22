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

For each single-route destination: pick the route's direction GEOMETRICALLY --
project the destination's own bearing/distKm to a target point and take the
direction whose downstream stops actually pass near it (see pick_direction);
find the chain stop nearest the place
coordinate as "where our rider boards"; take every stop AFTER that point,
de-duplicate consecutive same-named stops (timing-point re-announcements),
and keep at most `--max-stops` intermediate names plus the terminus itself
as the last element -- matching gen_external_radial.js's stops[] convention
(intermediate ... terminus last). Evenly samples when the chain has more
stops than the cap, so a 20-stop run to Cambridge doesn't dump 20 ticks on
one spoke.

Only ever ADDS a "stops" array to a destination lacking one -- re-run safely.

NOTE: gtfs_duration.py's journey_minutes still matches destinations by name
substring, which is the same failure this script's pick_direction was changed
to stop relying on. It is a separate fix and has not been made.

Usage:
  python derive_stops.py routes.json --dir . [--max-stops 4]
"""
import json, os, argparse, math

# Two directions whose closest approach to the target differs by less than this
# are not meaningfully distinguished by geometry -- see pick_direction().
TIE_KM = 1.5


def _clean_dest(label):
    return str(label).split('(')[0].strip()


def _haversine_km(la1, lo1, la2, lo2):
    dla = math.radians(la2 - la1); dlo = math.radians(lo2 - lo1)
    x = math.sin(dla / 2) ** 2 + math.cos(math.radians(la1)) * math.cos(math.radians(la2)) * math.sin(dlo / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(x))


def _project(lat, lon, bearing_deg, dist_km):
    """Where you land starting at (lat,lon), going bearing_deg for dist_km."""
    R = 6371.0
    d = dist_km / R
    th = math.radians(bearing_deg)
    la1, lo1 = math.radians(lat), math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(th))
    lo2 = lo1 + math.atan2(math.sin(th) * math.sin(d) * math.cos(la1),
                           math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), math.degrees(lo2)


def pick_direction(chain, dest_clean, dest=None, plat=None, plon=None, atco2ll=None):
    """Choose which of a route's GTFS directions actually goes to this destination.

    The name match alone is not enough and never was. A direction's GTFS label
    is whatever the operator registered, so "Cambridge" routinely fails to
    appear in the label of the direction that goes to Cambridge -- and the old
    fallback, dirs[0], is a coin flip. On the 2026-08-21 Co-op batch that coin
    came up wrong for 7 of 26 single-route spokes, and two of them shipped.

    So match on GEOMETRY, which cannot be worded differently: the destination
    already carries `bearing` and `distKm` from the place, so project that to a
    target point and pick whichever direction's downstream stops actually pass
    near it. The name match is kept, but only to CONFIRM a geometric winner or
    to break a genuine tie -- never as the sole evidence.

    Falls back to the old name-only behaviour when the caller has no geometry
    to offer (dest/plat/plon/atco2ll omitted), so existing callers still work.
    """
    dirs = chain.get('directions', [])
    if not dirs:
        return None
    dl = (dest_clean or '').lower()
    named = [d for d in dirs if dl and dl in (d.get('name', '') or '').lower()]

    have_geo = (dest is not None and plat is not None and plon is not None
                and atco2ll and dest.get('distKm') and dest.get('bearing') is not None)
    if not have_geo:
        # No geometry available -- old behaviour, including its coin-flip tail.
        return named[0] if named else dirs[0]

    tlat, tlon = _project(plat, plon, float(dest['bearing']), float(dest['distKm']))

    scored = []
    for d in dirs:
        stops = d.get('stops') or []
        i0 = nearest_index(stops, atco2ll, plat, plon)
        if i0 is None:
            continue
        best = None
        for sid in stops[i0 + 1:]:
            ll = atco2ll.get(sid)
            if not ll:
                continue
            km = _haversine_km(tlat, tlon, ll[0], ll[1])
            if best is None or km < best:
                best = km
        if best is not None:
            scored.append((best, d))
    if not scored:
        return named[0] if named else dirs[0]

    scored.sort(key=lambda t: t[0])
    best_km, best_dir = scored[0]

    # A tie is when two directions approach the target about equally well --
    # a loop route with both termini on one chain does this. Let the name
    # break it, since geometry genuinely cannot.
    if len(scored) > 1 and named:
        runner_km = scored[1][0]
        if runner_km - best_km < TIE_KM and scored[1][1] in named and best_dir not in named:
            return scored[1][1]
    return best_dir


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


def _locality(atco):
    """NaPTAN locality of a stop -- "0500HSTIV025" -> "0500HSTIV". None if the
    stop_id is not in that coded form (cross-border stops often are not)."""
    s = str(atco or '')
    return s[:9] if len(s) >= 10 and s[:4].isdigit() and s[4:9].isalpha() else None


def _truncate_at_destination(downstream, atco2name):
    """Cut the chain at the first stop that IS the destination -- same NaPTAN
    locality and same name as the chain's final stop. Returns the list unchanged
    when the destination is only reached once, which is the ordinary case."""
    last = downstream[-1]
    loc, nm = _locality(last), atco2name.get(last)
    if not loc or not nm:
        return downstream
    for i, sid in enumerate(downstream[:-1]):
        if _locality(sid) == loc and atco2name.get(sid) == nm:
            return downstream[:i + 1]
    return downstream


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
        direction = pick_direction(chain, _clean_dest(b.get('name', '')), b, plat, plon, atco2ll)
        if not direction or not direction.get('stops'):
            noroute += 1; continue
        stops = direction['stops']
        i0 = nearest_index(stops, atco2ll, plat, plon)
        if i0 is None:
            noroute += 1; continue
        downstream = stops[i0 + 1:]
        if not downstream:
            noroute += 1; continue
        # Stop at the FIRST arrival at the destination. A looping route reaches it and
        # carries on: route 9 out of Godmanchester calls at St Ives Bus Station
        # (0500HSTIV025), runs the loop through Boxworth, and ends back at St Ives Bus
        # Station (0500HSTIV002), which sampled as
        # "Church Lane / Bus Station / Elsworth Road / Bus Station" -- reading as though
        # the bus leaves St Ives and comes back. It does, but not on any journey a rider
        # making THIS trip takes. Match on locality + name, not stop_id, because those
        # two ATCOs are separate stands of the one bus station.
        downstream = _truncate_at_destination(downstream, atco2name)
        # Then keep the terminus's name out of the intermediates. What survives that is
        # a same-named stop in a DIFFERENT town -- Ely -> Huntingdon on route 101 passes
        # St Ives Bus Station (0500HSTIV002) on its way to Huntingdon Bus Station
        # (0500HHUNT027) and sampled as
        # "Windmill Lane / Bus Station / Baumgartner / Bus Station", where the first
        # "Bus Station" reads as if the bus had already arrived. An unqualified repeat
        # is worse than a shorter list, and the sampler has plenty of other stops.
        term_name = atco2name.get(downstream[-1])
        names = []
        for k, sid in enumerate(downstream):
            nm = atco2name.get(sid)
            if not nm or (names and names[-1] == nm):
                continue
            if nm == term_name and k != len(downstream) - 1:
                continue
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
