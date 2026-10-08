#!/usr/bin/env python3
"""P1 (place resolution) for make-place-bus-leaflet.

From a plain-English place name + its town/area, geocode the exact feature
(a shop, school, station, park, hospital, town centre...) via Nominatim and
write place.json (the confirmed centre point every later stage builds around).

This is the place analogue of bootstrap_town.py's geocode step, but it resolves
a POINT feature (a named place) rather than a whole town, and surfaces ambiguity
(e.g. two "Tesco Extra" in the same town) for the caller to confirm.

Usage:
  python resolve_place.py "<place>" --town "<Town/area>" --region <Region>
      [--radius-m 500] [--pick N] [--out place.json]
  python resolve_place.py "<place>" --town "<Town/area>" --region <Region>
      --stops <ATCO or NaPTAN code>[,<code>...] [--naptan <naptan.sqlite>] [--radius-m 500]
  python resolve_place.py "<place>" --town "<Town/area>" --region <Region>
      --at <lat>,<lon> [--radius-m 500]

  "<place>"   the feature name as a person would say it, e.g. "Tesco Extra". In the
              --stops and --at modes it is the map's name, e.g. "St Neots East".
  --town      town/area for disambiguation, e.g. "St Neots". Strongly recommended.
  --region    REQUIRED. The registered GTFS region this place sits in, e.g.
              "Cambridgeshire". Used twice, which is why it is not optional: it
              narrows the Nominatim query AND it is written to place.json as the
              dataset a standalone place's monthly change scan reads. Run with no
              --region to be told which regions are registered.
  --pick N    force selection of the Nth candidate (1-based) when auto-pick is wrong.
  --radius-m  walkshed radius stored on place.json (default 500). Overridable later.
  --stops     centre on BUS STOPS rather than a named feature: a comma-separated list
              of ATCO codes or the NaptanCodes printed on the flag (CMBGJWJP). Each
              is looked up in `_gtfs/naptan.sqlite` (found walking up from the cwd,
              or --naptan), and the centre is their midpoint. No network call.
  --at        centre on a coordinate the customer gave, "52.2275,-0.24335". No
              network call. Write it --at=<lat>,<lon> if the first number is
              negative, or argparse reads it as a flag.

BY STOPS (2026-09-28, buses-data OA-451 item 1). A customer who names bus stops
rather than a feature -- St Neots East was "the Loves Way stops" -- used to force a
hand-written place.json, because Nominatim resolves names and a stop pair has none.
--stops writes the same file that build wrote by hand: the midpoint, class
highway/bus_stop, and place-candidates.json holding the NaPTAN rows it came from. An
unknown or inactive code is refused rather than dropped, and so is a stop outside
the walkshed: a map centred on the stops the customer named that does not reach one
of them is not the map they asked for, so raise --radius-m or name fewer stops.

Writes place.json (the chosen feature) + place-candidates.json (all matches, for
the caller to eyeball). Prints the candidate list. It does NOT finalise anything
subjective: the caller confirms the pick and the walkshed before P2.

NO DEFAULT REGION (2026-08-28, OA-025). `--region` defaulted to "Cambridgeshire"
until then, and the value is used TWICE: it goes into the Nominatim query string and
straight into place.json. Forgetting the flag outside Cambridgeshire therefore skewed
the geocode -- the retry-without-region path below only fires when there are NO
candidates, never when there are wrong ones -- and wrote a wrong `region` to disk.
Under an area the parent town's region wins in `gtfs_places.resolve_region()`, so the
field is merely wrong; for a STANDALONE place it is what the monthly change scan
reads, so the place gets scanned against the wrong dataset. Caught by hand on the
2026-08-23 High Street build; the three other Buckinghamshire places have the right
value only because somebody remembered the flag.

Since 2026-08-21 no region is privileged anywhere else in the system (see
`make-bus-leaflet/assets/gtfs_regions.py`, which says why at length). This was the
last one. The value is now required and validated against the registry, and an
unregistered name fails naming the regions that exist rather than being written to
disk for the change scan to trip over three weeks later.
"""
import sys, os, json, math, sqlite3, argparse, urllib.request, urllib.parse

UA = {"User-Agent": "make-place-bus-leaflet/1.0 (resolve_place)"}
# Nominatim classes that plausibly are a "place you would centre a leaflet on".
PLACE_CLASSES = {"shop", "amenity", "leisure", "railway", "public_transport",
                 "building", "tourism", "office", "healthcare", "highway", "place"}


def geocode(query, limit):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": limit, "addressdetails": 1,
         "extratags": 1, "namedetails": 1})
    req = urllib.request.Request(url, headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=30))


def registered_regions():
    """Every region in the registry, plus the human names each one answers to.

    Read from `_gtfs/regions.json` through the town engine's own `gtfs_regions`
    module -- the registry is the thing that knows which regions exist, and looking
    it up is the opposite of assuming which one was meant. Sibling-relative first;
    the absolute path is a fallback for an install that is not laid out the standard
    way, not the primary route.
    """
    import os.path
    here = os.path.dirname(os.path.abspath(__file__))
    sibling = os.path.join(here, "..", "..", "make-bus-leaflet", "assets")
    for cand in (sibling, r"C:/Buses/claude-skills/make-bus-leaflet/assets"):
        if os.path.isdir(cand):
            sys.path.insert(0, cand)
            break
    try:
        import gtfs_regions
    except ImportError:
        return None, None
    gdir = gtfs_regions.default_gdir()
    regions, _default = gtfs_regions.load(gdir)
    names = {}
    for key, reg in (regions or {}).items():
        for n in [key, reg.get("bodsRegion")] + list((reg.get("atcoAreas") or {}).values()):
            if n:
                names[str(n).strip().lower()] = key
    return regions, names


def require_registered_region(a):
    """Fail naming the registered regions rather than picking one. See OA-025."""
    regions, names = registered_regions()
    if regions is None:
        if not a.region:
            raise SystemExit(
                "--region is required (it is written to place.json as the dataset this "
                "place is scanned against), and the region registry could not be read to "
                "list the valid values. Pass the county name, e.g. --region Cambridgeshire.")
        return
    listed = ", ".join(sorted(regions)) or "(none built)"
    if not a.region:
        raise SystemExit(
            "--region is required. It narrows the geocode AND becomes place.json's "
            "`region`, which is the dataset a standalone place's monthly change scan "
            "reads -- so a wrong one is scanned against a feed that cannot contain it.\n"
            f"Registered regions: {listed}")
    if a.region.strip().lower() not in names:
        raise SystemExit(
            f"--region {a.region!r} is not registered, so nothing would ever diff this "
            f"place against a real dataset.\nRegistered regions: {listed}\n"
            "Add it to _gtfs/regions.json and build its sqlite, or use one of the above.")


def find_naptan(start_dir):
    """Walk up from start_dir looking for _gtfs/naptan.sqlite."""
    d = os.path.abspath(start_dir)
    while True:
        cand = os.path.join(d, "_gtfs", "naptan.sqlite")
        if os.path.exists(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def metres(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(a))


def lookup_stops(db, codes):
    """The NaPTAN row for each code, in the order given; refuse a code it cannot place.

    A code may be the ATCOCode or the NaptanCode on the flag. A code NaPTAN does not
    know, or knows only as inactive, stops the run: dropping it would centre the map
    on the stops that are left and say nothing.
    """
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    rows, bad = [], []
    for code in codes:
        r = con.execute(
            "SELECT * FROM naptan WHERE ATCOCode = ? COLLATE NOCASE OR NaptanCode = ? COLLATE NOCASE",
            (code, code)).fetchone()
        if r is None:
            bad.append(f"{code}: not in NaPTAN")
        elif (r["Status"] or "").lower() != "active":
            bad.append(f"{code}: NaPTAN marks it {r['Status']!r}, not active")
        elif r["lat"] is None or r["lon"] is None:
            bad.append(f"{code}: NaPTAN has no position for it")
        else:
            rows.append(r)
    con.close()
    if bad:
        raise SystemExit("--stops: cannot place every stop named, so nothing was written.\n  "
                         + "\n  ".join(bad))
    return rows


def resolve_by_stops(a):
    """(place, candidates) centred on the midpoint of the named stops. See BY STOPS."""
    codes = [c.strip() for c in a.stops.split(",") if c.strip()]
    if not codes:
        raise SystemExit("--stops names no stop.")
    db = a.naptan or find_naptan(os.getcwd())
    if not db or not os.path.exists(db):
        raise SystemExit("--stops: no _gtfs/naptan.sqlite above the current folder; pass "
                         "--naptan, or build it with make-bus-leaflet/assets/naptan_build.py.")
    rows = lookup_stops(db, codes)
    lat = sum(r["lat"] for r in rows) / len(rows)
    lon = sum(r["lon"] for r in rows) / len(rows)
    far = [(r["ATCOCode"], metres(lat, lon, r["lat"], r["lon"])) for r in rows]
    outside = [f"{atco} is {m:.0f} m from the centre" for atco, m in far if m > a.radius_m]
    if outside:
        raise SystemExit(f"--stops: a named stop falls outside the {a.radius_m:.0f} m walkshed, "
                         "so the map would not reach it:\n  " + "\n  ".join(outside)
                         + "\nRaise --radius-m, or name fewer stops.")
    names = sorted({r["CommonName"] for r in rows})
    loc = rows[0]["LocalityName"] or rows[0]["ParentLocalityName"] or ""
    spread = max(metres(r1["lat"], r1["lon"], r2["lat"], r2["lon"]) for r1 in rows for r2 in rows)
    listed = " and ".join(f"{r['NaptanCode'] or r['ATCOCode']} ({r['ATCOCode']}, {r['Indicator'] or '-'})"
                          for r in rows)
    what = "midpoint of" if len(rows) > 1 else "the stop"
    display = f"{' / '.join(names)} stop{'s' if len(rows) > 1 else ''}, {loc} — {what} {listed}"
    if len(rows) > 1:
        display += f", {spread:.0f} m apart"
    place = {
        "place": a.place, "town": a.town, "region": a.region,
        "name": a.place, "display": display,
        "lat": round(lat, 7), "lon": round(lon, 7),
        "osm_type": None, "osm_id": None,
        "class": "highway", "type": "bus_stop",
        "walkshedM": a.radius_m, "ambiguous": False,
    }
    cands = {
        "query": a.place,
        "resolvedBy": f"--stops {','.join(codes)}: the midpoint of the NaPTAN rows below, "
                      f"read from {os.path.basename(db)}; no geocode.",
        "candidates": [{"atco": r["ATCOCode"], "naptanCode": r["NaptanCode"], "name": r["CommonName"],
                        "indicator": r["Indicator"], "bearing": r["Bearing"],
                        "locality": r["LocalityName"], "lat": r["lat"], "lon": r["lon"]} for r in rows],
        "ambiguous": False,
    }
    return place, cands


def resolve_at(a):
    """(place, candidates) centred on a coordinate the customer gave."""
    try:
        lat, lon = (float(x) for x in a.at.split(","))
    except ValueError:
        raise SystemExit(f"--at {a.at!r}: expected <lat>,<lon>, e.g. 52.2275,-0.24335")
    if not (49 <= lat <= 61 and -9 <= lon <= 2.5):
        raise SystemExit(f"--at {a.at!r} is not in Great Britain -- is it <lat>,<lon> the right way round?")
    place = {
        "place": a.place, "town": a.town, "region": a.region,
        "name": a.place, "display": f"{a.place} — the point {lat},{lon} given with --at",
        "lat": lat, "lon": lon, "osm_type": None, "osm_id": None,
        "class": None, "type": None, "walkshedM": a.radius_m, "ambiguous": False,
    }
    cands = {"query": a.place, "resolvedBy": f"--at {lat},{lon}; no geocode.",
             "candidates": [], "ambiguous": False}
    return place, cands


def write_direct(a, place, cands):
    json.dump(cands, open("place-candidates.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    json.dump(place, open(a.out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"# Place resolution — {a.place!r} in {a.town or '(no town given)'}, {cands['resolvedBy']}")
    for c in cands["candidates"]:
        print(f"  {c['atco']}  {c['naptanCode']}  {c['name']} ({c['indicator']}, {c['bearing']})"
              f"  {c['lat']:.5f},{c['lon']:.5f}")
    print(f"\nChosen centre: {place['lat']:.6f}, {place['lon']:.6f}   walkshed {a.radius_m:.0f} m")
    print(f"Wrote {a.out} and place-candidates.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("place")
    ap.add_argument("--town", default="")
    ap.add_argument("--region", default=None,
                    help="REQUIRED: the registered GTFS region, e.g. Cambridgeshire. "
                         "No default -- see the module docstring and OA-025.")
    ap.add_argument("--radius-m", type=float, default=500)
    ap.add_argument("--limit", type=int, default=8)
    ap.add_argument("--pick", type=int, default=0, help="1-based candidate to force")
    ap.add_argument("--out", default="place.json")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--stops", help="centre on these bus stops: ATCO or NaPTAN codes, comma-separated")
    mode.add_argument("--at", help="centre on this point: <lat>,<lon>")
    ap.add_argument("--naptan", help="--stops: naptan.sqlite (default: _gtfs/naptan.sqlite above the cwd)")
    a = ap.parse_args()
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

    require_registered_region(a)

    if a.stops or a.at:
        place, cands = resolve_by_stops(a) if a.stops else resolve_at(a)
        write_direct(a, place, cands)
        return

    q = ", ".join([p for p in [a.place, a.town, a.region, "UK"] if p])
    cands = geocode(q, a.limit)
    if not cands and a.region:
        # retry without the region in case it over-constrained
        q2 = ", ".join([p for p in [a.place, a.town, "UK"] if p])
        cands = geocode(q2, a.limit)
    if not cands:
        raise SystemExit(f"Nominatim found nothing for {q!r}. Try a fuller name or add --town.")

    rows = []
    for r in cands:
        rows.append({
            "display": r.get("display_name", ""),
            "lat": float(r["lat"]), "lon": float(r["lon"]),
            "osm_type": r.get("osm_type"), "osm_id": r.get("osm_id"),
            "class": r.get("class"), "type": r.get("type"),
            "name": (r.get("namedetails") or {}).get("name") or r.get("display_name", "").split(",")[0],
            "importance": r.get("importance"),
        })
    json.dump(rows, open("place-candidates.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    # auto-pick: forced --pick, else the first candidate whose class is place-like.
    if a.pick:
        idx = a.pick - 1
    else:
        idx = next((i for i, r in enumerate(rows) if r["class"] in PLACE_CLASSES), 0)
    chosen = rows[idx]

    # ambiguity flag: another candidate shares the (case-insensitive) leading name.
    nm = chosen["name"].lower()
    same = [r for j, r in enumerate(rows) if j != idx and r["name"].lower() == nm]
    ambiguous = bool(same)

    place = {
        "place": a.place, "town": a.town, "region": a.region,
        "name": chosen["name"], "display": chosen["display"],
        "lat": chosen["lat"], "lon": chosen["lon"],
        "osm_type": chosen["osm_type"], "osm_id": chosen["osm_id"],
        "class": chosen["class"], "type": chosen["type"],
        "walkshedM": a.radius_m, "ambiguous": ambiguous,
    }
    json.dump(place, open(a.out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    print(f"# Place resolution — {a.place!r} in {a.town or '(no town given)'}")
    print(f"Candidates ({len(rows)}):")
    for i, r in enumerate(rows):
        mark = " <== chosen" if i == idx else ""
        print(f"  {i+1}. {r['name']}  [{r['class']}/{r['type']}]  {r['lat']:.5f},{r['lon']:.5f}{mark}")
        print(f"       {r['display'][:96]}")
    if ambiguous:
        print(f"\n!! AMBIGUOUS: {len(same)} other candidate(s) share the name {chosen['name']!r}."
              f" Confirm the pick (use --pick N) before proceeding.")
    print(f"\nChosen centre: {chosen['lat']:.6f}, {chosen['lon']:.6f}   walkshed {a.radius_m:.0f} m")
    print(f"Wrote {a.out} and place-candidates.json")


if __name__ == "__main__":
    main()
