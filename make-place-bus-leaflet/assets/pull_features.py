#!/usr/bin/env python3
"""P2 helper -- the linear features a place map draws (a railway, a river, a canal,
a main road), pulled into `features_geo.json` the way a town's S2 pulls them
(buses-data OA-453 item 1 for the railway, OA-514 for the rest).

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

A river, a canal or a main road is a NAMED feature: draft_town's query for one
matches a name (for a road, a ref), so it has to be named first. Two places say
which, in this order:

  1. --town-routes, the S3 routes.json of the mapped town the place sits in: a
     `features[]` entry of that type is used as it stands, key and label, so the
     place draws the river its town draws, under the same key (OA-514).
  2. Otherwise bootstrap_town.py's own `overpass_features` -- the candidate list a
     town's draft is built from, imported rather than copied -- asked over the
     same square; the commonest NAMED candidate of the type wins and the others
     are printed. --pick TYPE=LABEL names a different one.

A railway needs no name: draft_town asks for every `railway=rail` way.

It prints the `features[]` entries to paste into P3's routes.json. A railway is
labelled with the most common `name` its ways carry (else "Railway") and takes
`style: {"rail": "chequer"}`, as all six railway sheets do; a river, canal or
road takes its label from the step above and `labelPos: "auto"`.

Usage, from the P2 run folder (where walkshed_cfg.json is):
  python pull_features.py walkshed_cfg.json [--km 0.9] [--types railway,river,canal]
      [--town-routes <town S3 routes.json>] [--pick river="River Great Ouse"]
      [--out features_geo.json] [--force]
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

TYPES = ("railway", "river", "canal", "road")   # every type draft_town.feature_query asks
NAMED = ("river", "canal", "road")              # ...and the ones it asks by name or ref
DEFAULT_TYPES = "railway,river,canal"           # a road is opt-in: a close-up draws its streets anyway
PLACEHOLDER = {"river": "River", "canal": "Canal", "road": "A-road"}   # bootstrap_town's label for "no name"


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


def town_features(path):
    """{type: features[] entry} from a town's S3 routes.json -- the first of each named type."""
    with open(path, encoding="utf-8") as f:
        feats = json.load(f).get("features") or []
    got = {}
    for ft in feats:
        if ft.get("type") in NAMED and ft.get("key") and ft.get("label"):
            got.setdefault(ft["type"], {"key": ft["key"], "type": ft["type"], "label": ft["label"]})
    return got


def road_key(ref):
    """bootstrap_town's key for a road: its ref, spaces out, lower case ("A 1123" -> "a1123")."""
    return ref.replace(" ", "").lower()


def choose(t, ranked, picks):
    """The feature of type `t` to pull: --pick's label if given, else the commonest
    candidate. Returns (feat or None, the other candidates' labels).

    A candidate carrying bootstrap_town's stand-in label -- "River" for a way with
    no name -- is never chosen: draft_town asks for a river BY its name, so it
    would match nothing. At Ely Co-op the unnamed fragments outnumber the Great
    Ouse's named ones, and the first real pull (2026-09-29) chose "River" and drew
    nothing."""
    of_type = [c for c in ranked if c["type"] == t and c["label"] != PLACEHOLDER.get(t)]
    labels = [c["label"] for c in of_type]
    if t in picks:
        want = picks[t]
        hit = next((c for c in of_type if c["label"] == want), None)
        if hit is None:                       # named by hand: trust the name, draft_town's key rule
            hit = {"key": road_key(want) if t == "road" else t, "type": t, "label": want}
        return hit, [x for x in labels if x != want]
    if not of_type:
        return None, []
    return of_type[0], labels[1:]


def entry_for(feat, reply):
    """The features[] entry P3's routes.json gains for one pulled feature."""
    if feat["type"] == "railway":
        return {"key": feat["key"], "type": "railway", "label": label_of(reply), "style": {"rail": "chequer"}}
    return {"key": feat["key"], "type": feat["type"], "label": feat["label"], "labelPos": "auto"}


def refuse(code, why):
    """Say why on stderr and hand back the exit code (references/conventions.md)."""
    sys.stderr.write(why + "\n")
    return code


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("walkshed", help="walkshed_cfg.json (P2), for its center")
    ap.add_argument("--km", type=float, default=0.9,
                    help="half-width of the square pulled, in km (default 0.9, what Waitrose was clipped to)")
    ap.add_argument("--types", default=DEFAULT_TYPES,
                    help="comma list (default %s); supported: %s" % (DEFAULT_TYPES, ", ".join(TYPES)))
    ap.add_argument("--town-routes", help="the S3 routes.json of the town the place sits in; its "
                                          "features[] names the river, canal or road, key and label")
    ap.add_argument("--pick", action="append", default=[], metavar="TYPE=LABEL",
                    help="the river, canal or road (by ref) to pull instead of the commonest candidate")
    ap.add_argument("--out", default="features_geo.json")
    ap.add_argument("--force", action="store_true", help="replace a key the file already holds")
    a = ap.parse_args(argv)

    types = [t.strip() for t in a.types.split(",") if t.strip()]
    bad = [t for t in types if t not in TYPES]
    if bad:
        ap.error("unsupported --types %s (supported: %s)" % (", ".join(bad), ", ".join(TYPES)))
    picks = {}
    for p in a.pick:
        t, _, lab = p.partition("=")
        if t not in NAMED or not lab:
            ap.error("--pick wants TYPE=LABEL with TYPE one of %s, not %r" % (", ".join(NAMED), p))
        picks[t] = lab
    with open(a.walkshed, encoding="utf-8") as f:
        center = json.load(f).get("center")
    if not center or len(center) != 2:
        return refuse(3, "pull_features: %s has no center [lat, lon]" % a.walkshed)

    existing = {}
    if os.path.exists(a.out):
        with open(a.out, encoding="utf-8") as f:
            existing = json.load(f)

    # A hand-kept key is refused before Overpass is asked anything. Every key is
    # known up front except a road's that is still to be named, checked below.
    town = town_features(a.town_routes) if a.town_routes else {}

    def known_key(t):
        if t in town and t not in picks:
            return town[t]["key"]
        if t == "road":
            return road_key(picks[t]) if t in picks else None
        return t
    clash = [k for k in (known_key(t) for t in types) if k and k in existing and not a.force]
    if clash:
        return refuse(2, "pull_features: %s already holds %s -- a hand-kept geometry is its own only "
                         "record; pass --force to replace it" % (a.out, ", ".join(clash)))

    import overpass_fetch                   # imported late: they load the town engine's modules
    from draft_town import feature_query
    box = square(center, a.km)

    # Name each named type -- from the town's routes.json, else from the
    # candidates bootstrap_town would offer a town's draft for this square.
    feats, ranked = [], None
    for t in types:
        if t == "railway":
            feats.append({"key": "railway", "type": "railway", "label": ""})
            continue
        if t in town and t not in picks:
            feats.append(town[t])
            print("pull_features: %s -- %r under key %r, from %s" % (t, town[t]["label"], town[t]["key"], a.town_routes))
            continue
        if ranked is None and t not in picks:
            from bootstrap_town import overpass_features
            ranked, reached = overpass_features(box)
            if not reached:
                return refuse(2, "pull_features: no Overpass host answered the candidate question\n"
                                 "%s was NOT written: an unanswered question is not an empty answer." % a.out)
        feat, others = choose(t, ranked or [], picks)
        if feat is None:
            print("pull_features: no named %s within %.1f km of the centre -- nothing to draw, key not written" % (t, a.km))
            continue
        if others:
            print("pull_features: %s -- took %r; also in the square: %s (--pick %s=<label> to change)"
                  % (t, feat["label"], ", ".join(repr(o) for o in others), t))
        feats.append(feat)

    clash = [f["key"] for f in feats if f["key"] in existing and not a.force]
    if clash:
        return refuse(2, "pull_features: %s already holds %s -- a hand-kept geometry is its own only "
                         "record; pass --force to replace it" % (a.out, ", ".join(clash)))

    out, entries = dict(existing), []
    for feat in feats:
        t = feat["type"]
        try:
            reply = overpass_fetch.fetch(feature_query(box, feat), label="pull_features " + t)
        except overpass_fetch.OverpassUnreachable as exc:
            return refuse(2, "%s\n%s was NOT written: an unanswered question is not an empty answer." % (exc, a.out))
        segs = segments(reply, box)
        if not segs:
            what = t if t == "railway" else "%s %r" % (t, feat["label"])
            print("pull_features: no %s within %.1f km of the centre -- nothing to draw, key not written" % (what, a.km))
            continue
        out[feat["key"]] = segs
        entries.append(entry_for(feat, reply))
        print("pull_features: %s -- %d segment(s), %d point(s)" % (feat["key"], len(segs), sum(len(s) for s in segs)))
    if entries:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False)
        print("wrote %s. For P3's routes.json, features[] gains:" % a.out)
        print(json.dumps(entries, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
