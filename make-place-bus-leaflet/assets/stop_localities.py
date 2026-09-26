#!/usr/bin/env python3
"""P2 helper -- the NaPTAN locality of every stop a place's routes call at, so
aggregate_destinations.js can name a spoke after the SETTLEMENT it reaches rather
than after the stop it happens to end at (buses-data OA-438).

Why: the aggregator used to label a cluster by its most common stop name, and a
stop name is a street or a building -- "Bus Station", "Tesco Store", "Market
Square", "Newlands Cottages". On 2026-09-22 the config tailoring audit found that
of 87 drafted destination names across ten places only 7 survived contact with a
person; the rest were rewritten by hand, almost always to the town the stop is in.
The town drafter solved exactly this problem in draft_town.py's PlaceNamer, which
reads NaPTAN's LocalityName and its parent, and this script REUSES that class
rather than writing a second namer. It is offline only: a stop NaPTAN does not know
is left out of the output, and the aggregator falls back to its stop name, which
is the old behaviour -- never a reverse-geocoded guess.

Writes {ATCO: [locality, parent locality or null]} for every stop in the chains.
The register is `_gtfs/naptan.sqlite`, found by walking up from the chains file
unless --naptan names it; without one the script refuses (exit 1) rather than
writing an empty file that would silently switch the naming back off.

Usage:
  python stop_localities.py <routes_full_atco.json> [--out atco2locality.json] [--naptan <naptan.sqlite>]
"""
import argparse, json, os, sys

# The town engine's assets: sibling-relative first, the absolute path only as a
# fallback -- the rule gtfs_chains.py and resolve_place.py follow (OA-232 F10).
HERE = os.path.dirname(os.path.abspath(__file__))
for _cand in (r"C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets",
              os.path.join(HERE, "..", "..", "make-bus-leaflet", "assets")):
    if os.path.isdir(_cand):
        sys.path.insert(0, _cand)
sys.path.insert(0, HERE)


def find_up(start_dir, *rel):
    """The first `<ancestor>/<rel...>` that exists, walking up from start_dir."""
    d = os.path.abspath(start_dir)
    while True:
        cand = os.path.join(d, *rel)
        if os.path.exists(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def chain_atcos(full):
    """Every ATCO on every direction of every route, in first-seen order."""
    seen = {}
    for r in full.values():
        for d in (r.get("directions") or []):
            for a in d.get("stops") or []:
                seen.setdefault(a, None)
    return list(seen)


def localities(namer, atcos):
    out = {}
    for a in atcos:
        loc, par = namer.locality(a)
        if loc:
            out[a] = [loc, par]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("chains", help="routes_full_atco.json (S1/S2)")
    ap.add_argument("--out", default="atco2locality.json")
    ap.add_argument("--naptan", help="naptan.sqlite (default: _gtfs/naptan.sqlite, found walking up from the chains file)")
    a = ap.parse_args(argv)

    naptan_db = a.naptan or find_up(os.path.dirname(os.path.abspath(a.chains)), "_gtfs", "naptan.sqlite")
    if not naptan_db or not os.path.exists(naptan_db):
        sys.exit("stop_localities: no naptan.sqlite (looked for _gtfs/naptan.sqlite above the chains file; "
                 "build it with make-bus-leaflet/assets/naptan_build.py, or pass --naptan)")
    from draft_town import PlaceNamer   # imported late: it loads the town engine's modules
    with open(a.chains, encoding="utf-8") as f:
        full = json.load(f)
    atcos = chain_atcos(full)
    namer = PlaceNamer(naptan_db)
    out = localities(namer, atcos)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"stop_localities: {len(out)} of {len(atcos)} stops located -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
