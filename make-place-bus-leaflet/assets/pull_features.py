#!/usr/bin/env python3
"""P2 helper -- the linear features a place map draws (today: the railway), pulled
into `features_geo.json` the way a town's S2 pulls them (buses-data OA-453 item 1).

Why: gen_internal.js draws a railway, a river, a canal or a main road from a
`features[]` entry in routes.json and the geometry under the same key in S2's
`features_geo.json`. A town's S2 writes that file through draft_town.py; a place's
P2 had no step for it, so the two place maps that draw a railway (Beaconsfield
Waitrose and High Wycombe Aldi) got theirs by hand -- Waitrose's README says the
Chiltern Main Line was copied out of the town's S2 and clipped, because Overpass
was timing out. Every other place near a line simply has none, and St Neots East
names its station with a hand-pinned note because nothing drew the track.

This script asks the SAME question draft_town.py asks -- its own `feature_query`,
imported rather than copied, so a place and its town can never disagree about
what counts as a railway -- over a square around the walkshed centre, through
`overpass_fetch.fetch` (retries, three hosts, and an unanswered question is never
written as an empty answer). It clips each way to that square, keeping one point
beyond the edge so the line still reaches the frame, and writes the result under
the feature's key in the draft_town shape: {key: [[[lat, lon], ...], ...]}.

It merges into an existing features_geo.json and refuses to replace a key already
there unless --force, because a hand-kept geometry is the only record of itself.
No railway inside the square is an ANSWER: the key is not written, it says so and
exits 0. No Overpass host answering is NOT one: nothing is written and it exits 2,
as does a refused key; a walkshed with no center exits 3.

It prints the `features[]` entry to paste into P3's routes.json, labelled with the
most common `name` the ways carry (else "Railway"). Drawing it is then P3's usual
choice: `style: {"rail": "chequer"}` is what all six railway sheets take.

Usage, from the P2 run folder (where walkshed_cfg.json is):
  python pull_features.py walkshed_cfg.json [--km 0.9] [--types railway] [--out features_geo.json] [--force]
"""
import argparse, json, math, os, sys
from collections import Counter

# The town engine's assets: sibling-relative first, the absolute path only as a
# fallback -- the rule gtfs_chains.py and stop_localities.py follow (OA-232 F10).
HERE = os.path.dirname(os.path.abspath(__file__))
for _cand in (r"C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets",
              os.path.join(HERE, "..", "..", "make-bus-leaflet", "assets")):
    if os.path.isdir(_cand):
        sys.path.insert(0, _cand)
sys.path.insert(0, HERE)

TYPES = ("railway",)   # the one feature draft_town.py queries without a label to match


def square(center, km):
    """A bbox dict (s, w, n, e) `km` either side of center=[lat, lon]."""
    lat, lon = center
    dlat = km / 111.32
    dlon = km / (111.32 * math.cos(math.radians(lat)))
    return {"s": lat - dlat, "n": lat + dlat, "w": lon - dlon, "e": lon + dlon}


def inside(box, p):
    return box["s"] <= p[0] <= box["n"] and box["w"] <= p[1] <= box["e"]


def clip(pts, box):
    """The runs of `pts` inside `box`, each carrying one point beyond either end."""
    runs, cur = [], None
    for i, p in enumerate(pts):
        if inside(box, p):
            if cur is None:
                cur = [pts[i - 1]] if i > 0 else []
            cur.append(p)
        elif cur is not None:
            cur.append(p)
            runs.append(cur)
            cur = None
    if cur is not None:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def segments(reply, box):
    """draft_town's features_geo shape from an Overpass `out geom` reply, clipped."""
    segs = []
    for el in reply.get("elements", []):
        pts = [[g["lat"], g["lon"]] for g in (el.get("geometry") or [])]
        segs.extend(clip(pts, box))
    return segs


def label_of(reply, default="Railway"):
    """The name most of the ways carry, or `default` when none carries one."""
    names = Counter((el.get("tags") or {}).get("name") for el in reply.get("elements", []))
    names.pop(None, None)
    return names.most_common(1)[0][0] if names else default


def refuse(code, why):
    """Say why on stderr and hand back the exit code (references/conventions.md)."""
    sys.stderr.write(why + "\n")
    return code


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("walkshed", help="walkshed_cfg.json (P2), for its center")
    ap.add_argument("--km", type=float, default=0.9,
                    help="half-width of the square pulled, in km (default 0.9, what Waitrose was clipped to)")
    ap.add_argument("--types", default="railway", help="comma list; supported: " + ", ".join(TYPES))
    ap.add_argument("--out", default="features_geo.json")
    ap.add_argument("--force", action="store_true", help="replace a key the file already holds")
    a = ap.parse_args(argv)

    types = [t.strip() for t in a.types.split(",") if t.strip()]
    bad = [t for t in types if t not in TYPES]
    if bad:
        ap.error("unsupported --types %s (supported: %s)" % (", ".join(bad), ", ".join(TYPES)))
    with open(a.walkshed, encoding="utf-8") as f:
        center = json.load(f).get("center")
    if not center or len(center) != 2:
        return refuse(3, "pull_features: %s has no center [lat, lon]" % a.walkshed)

    existing = {}
    if os.path.exists(a.out):
        with open(a.out, encoding="utf-8") as f:
            existing = json.load(f)
    clash = [t for t in types if t in existing and not a.force]
    if clash:
        return refuse(2, "pull_features: %s already holds %s -- a hand-kept geometry is its own only "
                         "record; pass --force to replace it" % (a.out, ", ".join(clash)))

    import overpass_fetch                   # imported late: they load the town engine's modules
    from draft_town import feature_query
    box = square(center, a.km)
    out, entries = dict(existing), []
    for t in types:
        try:
            reply = overpass_fetch.fetch(feature_query(box, {"type": t, "label": ""}), label="pull_features " + t)
        except overpass_fetch.OverpassUnreachable as exc:
            return refuse(2, "%s\n%s was NOT written: an unanswered question is not an empty answer." % (exc, a.out))
        segs = segments(reply, box)
        if not segs:
            print("pull_features: no %s within %.1f km of the centre -- nothing to draw, key not written" % (t, a.km))
            continue
        out[t] = segs
        entries.append({"key": t, "type": t, "label": label_of(reply), "style": {"rail": "chequer"}})
        print("pull_features: %s -- %d segment(s), %d point(s)" % (t, len(segs), sum(len(s) for s in segs)))
    if entries:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False)
        print("wrote %s. For P3's routes.json, features[] gains:" % a.out)
        print(json.dumps(entries, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
