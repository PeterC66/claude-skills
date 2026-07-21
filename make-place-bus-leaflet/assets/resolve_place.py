#!/usr/bin/env python3
"""P1 (place resolution) for make-place-bus-leaflet.

From a plain-English place name + its town/area, geocode the exact feature
(a shop, school, station, park, hospital, town centre...) via Nominatim and
write place.json (the confirmed centre point every later stage builds around).

This is the place analogue of bootstrap_town.py's geocode step, but it resolves
a POINT feature (a named place) rather than a whole town, and surfaces ambiguity
(e.g. two "Tesco Extra" in the same town) for the caller to confirm.

Usage:
  python resolve_place.py "<place>" --town "<Town/area>" [--region Cambridgeshire]
      [--radius-m 500] [--pick N] [--out place.json]

  "<place>"   the feature name as a person would say it, e.g. "Tesco Extra".
  --town      town/area for disambiguation, e.g. "St Neots". Strongly recommended.
  --pick N    force selection of the Nth candidate (1-based) when auto-pick is wrong.
  --radius-m  walkshed radius stored on place.json (default 500). Overridable later.

Writes place.json (the chosen feature) + place-candidates.json (all matches, for
the caller to eyeball). Prints the candidate list. It does NOT finalise anything
subjective: the caller confirms the pick and the walkshed before P2.
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("place")
    ap.add_argument("--town", default="")
    ap.add_argument("--region", default="Cambridgeshire")
    ap.add_argument("--radius-m", type=float, default=500)
    ap.add_argument("--limit", type=int, default=8)
    ap.add_argument("--pick", type=int, default=0, help="1-based candidate to force")
    ap.add_argument("--out", default="place.json")
    a = ap.parse_args()
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

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
