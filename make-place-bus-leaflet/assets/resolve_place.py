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

  "<place>"   the feature name as a person would say it, e.g. "Tesco Extra".
  --town      town/area for disambiguation, e.g. "St Neots". Strongly recommended.
  --region    REQUIRED. The registered GTFS region this place sits in, e.g.
              "Cambridgeshire". Used twice, which is why it is not optional: it
              narrows the Nominatim query AND it is written to place.json as the
              dataset a standalone place's monthly change scan reads. Run with no
              --region to be told which regions are registered.
  --pick N    force selection of the Nth candidate (1-based) when auto-pick is wrong.
  --radius-m  walkshed radius stored on place.json (default 500). Overridable later.

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
import sys, json, argparse, urllib.request, urllib.parse

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
    for cand in (sibling, r"C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets"):
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
    a = ap.parse_args()
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

    require_registered_region(a)

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
