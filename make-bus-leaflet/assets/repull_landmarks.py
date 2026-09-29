#!/usr/bin/env python3
"""repull_landmarks.py -- re-run ONE town's landmark pull into a new S2 run, keeping its geometry (buses-data OA-499).

WHY THIS EXISTS. OA-500 (2026-09-28) widened what a map draws -- pubs, cinemas,
colleges, post offices, stations and more -- and changed the landmark QUERY that
`draft_town.py`'s `pois_query()` sends to Overpass. It did not change a single stored
pull. A rebuild row runs `rollout.js`, which reads the stored S2 and fetches nothing,
so every map rebuilt after OA-500 still draws from a pull that predates the new
categories: the rebuild shows only what the old pull happened to hold. This file is
the missing step the rebuild row names first: ask Overpass the CURRENT question over
the town's OWN box, and commit the answer as a new S2 run through `stage.js`.

    Run it from anywhere. There are no placeholders except <Town> and <who>:

      python repull_landmarks.py --town "<Town>"
      python repull_landmarks.py --town "<Town>" --apply --by <who>

    --town    the town's folder name under Areas/, e.g. "March"
    --apply   actually write the new S2 run: without it this is a DRY RUN, which asks
              Overpass (a read) and prints what would change, and writes nothing
    --by      who is performing the stage -- `sched-HHMM` for a loop tick, the
              session's own name otherwise; forwarded to stage.js, which validates it
    --root    the Buses directory, if not this laptop's (see cli.resolve_buses)
    --answer  a stored Overpass answer (JSON) to use instead of asking Overpass --
              for the tests, and for re-committing an answer already fetched
    --note    extra text appended to the note recorded on the S2 run
    --json    print one JSON object on stdout instead of prose

WHAT IT KEEPS AND WHAT IT REPLACES. `stage.js pull S2` copies every declared output of
the latest S2 run into the new one -- the stop chains, the coordinates, the river, the
roads, and `osm2.json`. Only `osm.json` is replaced, and the query that produced it is
written beside it as `overpass-pois.txt`, the name older runs already used for it. The
geometry is untouched because no route moved; this is a landmark question only.

`osm2.json` IS KEPT, ON PURPOSE. On some towns it is a second pull whose elements are
now also in the widened `osm.json`, and a landmark present in both is drawn twice or
de-duplicated depending on the generator. Whether a given town's `osm2.json` can be
emptied is OA-478's check, which does not exist yet; emptying it here without that
check could delete a hand-added landmark, and keeping it can at worst duplicate one,
which the rebuild's crops will show. So the default is the one that loses nothing.

THE BOX IS THE TOWN'S OWN, NEVER A NEW ONE. A fresh pull over a different box would
change which landmarks are in reach and dress that up as a category change. The box
comes from, in order:
  1. the latest S2 run's own `overpass-pois.txt`, when it recorded its query -- the
     exact box that run asked about;
  2. otherwise the extent of the elements in its `osm.json`. That is at most the box
     it was asked over, never larger, and bus stops are dense enough that it is close;
     the report says which source was used so a reader can judge.

PLACES ARE NOT HANDLED YET. A place's landmark pull is its walkshed
`search_overpass` with every category's tags, a different question from a town's box.
Given a place folder this refuses and says so rather than asking the wrong question.

Exit codes follow references/conventions.md: 0 done (or a dry run that ran), 1 a
refusal with its remedy printed, 2 a usage error.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import cli              # noqa: E402  --root, then BUSES_DIR, then the laptop
import overpass_fetch   # noqa: E402
from draft_town import pois_query   # noqa: E402  ONE query, owned by draft_town

SK = HERE
POIS = "osm.json"
QUERY = "overpass-pois.txt"
BOX_RE = re.compile(r"\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)")


class Refused(Exception):
    """A refusal with a remedy: the message is what the caller prints."""


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def stage(town_dir, *args):
    """stage.js with the town as its cwd -- the stage engine's cwd-as-subject convention."""
    res = subprocess.run(["node", os.path.join(SK, "stage.js"), *args],
                         cwd=town_dir, capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise Refused("stage.js %s failed:\n%s" % (" ".join(args), (res.stderr or res.stdout).strip()))
    return res.stdout.strip()


def box_from_query(text):
    """The first (s,w,n,e) box in a recorded Overpass query, or None."""
    m = BOX_RE.search(text or "")
    if not m:
        return None
    s, w, n, e = (float(v) for v in m.groups())
    if not (s < n and w < e):
        return None
    return {"s": s, "w": w, "n": n, "e": e}


def box_from_elements(doc):
    """The extent of every located element in an Overpass answer, or None."""
    lats, lons = [], []
    for el in (doc or {}).get("elements", []):
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        lon = el.get("lon", (el.get("center") or {}).get("lon"))
        if lat is None or lon is None:
            continue
        lats.append(float(lat))
        lons.append(float(lon))
    if len(lats) < 2 or min(lats) == max(lats) or min(lons) == max(lons):
        return None
    return {"s": min(lats), "w": min(lons), "n": max(lats), "e": max(lons)}


def town_box(s2_dir):
    """(box, source) for the latest S2 run -- see THE BOX IS THE TOWN'S OWN."""
    qpath = os.path.join(s2_dir, QUERY)
    if os.path.isfile(qpath):
        with open(qpath, encoding="utf-8") as fh:
            box = box_from_query(fh.read())
        if box:
            return box, "recorded query (%s)" % QUERY
    box = box_from_elements(read_json(os.path.join(s2_dir, POIS)))
    if box:
        return box, "extent of the stored %s" % POIS
    raise Refused("cannot tell which box %s was pulled over: it has no readable %s and its %s "
                  "has fewer than two located elements. Re-pull it by hand with draft_town.py's "
                  "pois_query() over a box you choose, and record the query as %s."
                  % (s2_dir, QUERY, POIS, QUERY))


def category(tags):
    """The landmark category an element counts under in the report."""
    for k in ("amenity", "shop", "leisure", "railway", "tourism", "landuse", "highway"):
        if tags.get(k):
            return "%s=%s" % (k, tags[k])
    return "other"


def census(doc):
    out = {}
    for el in (doc or {}).get("elements", []):
        c = category(el.get("tags") or {})
        out[c] = out.get(c, 0) + 1
    return out


def compare(old, new):
    """{category: [old, new]} for every category whose count moved."""
    a, b = census(old), census(new)
    return {k: [a.get(k, 0), b.get(k, 0)] for k in sorted(set(a) | set(b)) if a.get(k, 0) != b.get(k, 0)}


def s2_outputs(manifest, run_id):
    for r in (manifest.get("stages", {}).get("S2", {}).get("runs") or []):
        if r.get("id") == run_id:
            return list(r.get("outputs") or [])
    return []


def run(argv=None, fetch=None, stage_fn=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--town", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--by")
    ap.add_argument("--root")
    ap.add_argument("--answer")
    ap.add_argument("--note", default="")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    fetch = fetch or (lambda q: overpass_fetch.fetch(q, timeout=90, label=POIS))
    stage_fn = stage_fn or stage

    parts = re.split(r"[\\/]+", a.town.strip())
    if "Places" in parts or ".." in parts:
        # A place's manifest looks like a town's (it carries no marker), so the
        # PATH is the only thing that says it is one.
        raise Refused("%s names a PLACE map; this tool re-pulls a town's box only (see PLACES "
                      "ARE NOT HANDLED YET)." % a.town)
    root = cli.resolve_buses(a.root)
    town_dir = os.path.join(root, "Areas", a.town)
    mpath = os.path.join(town_dir, "manifest.json")
    if not os.path.isfile(mpath):
        raise Refused("%s has no manifest.json. A place map's landmark pull is its walkshed "
                      "search, which this tool does not ask yet (see PLACES ARE NOT HANDLED YET); "
                      "a town is named as its folder under Areas/." % town_dir)
    manifest = read_json(mpath)
    prev = (manifest.get("stages", {}).get("S2") or {}).get("latest")
    if not prev:
        raise Refused("%s has no committed S2 run to carry the geometry from." % a.town)
    prev_dir = os.path.join(town_dir, "S2-geometry", prev)
    if not os.path.isfile(os.path.join(prev_dir, POIS)):
        raise Refused("S2 %s has no %s, so there is no landmark pull to replace." % (prev, POIS))

    box, source = town_box(prev_dir)
    query = pois_query(box)
    old = read_json(os.path.join(prev_dir, POIS))
    if a.answer:
        new = read_json(a.answer)
    else:
        try:
            new = fetch(query)
        except overpass_fetch.OverpassUnreachable as exc:
            raise Refused("%s\nNothing was written: an unanswered question is not an empty answer. "
                          "Re-run when Overpass is answering." % exc)
    if not isinstance(new, dict) or not new.get("elements"):
        raise Refused("Overpass answered with no elements over %s. A town box always holds bus "
                      "stops, so this is a failed pull, not an empty town; nothing was written." % box)

    result = {"town": a.town, "from": prev, "box": box, "boxSource": source,
              "before": len(old.get("elements", [])), "after": len(new["elements"]),
              "moved": compare(old, new), "applied": False, "run": None}
    if not a.apply:
        return result

    by = ["--by", a.by] if a.by else []
    new_dir = stage_fn(town_dir, "new", "S2", *by).splitlines()[-1].strip()
    stage_fn(town_dir, "pull", "S2", new_dir)
    with open(os.path.join(new_dir, POIS), "w", encoding="utf-8") as fh:
        json.dump(new, fh, ensure_ascii=False)
    with open(os.path.join(new_dir, QUERY), "w", encoding="utf-8") as fh:
        fh.write(query + "\n")
    outputs = s2_outputs(manifest, prev)
    for f in (POIS, QUERY):
        if f not in outputs:
            outputs.append(f)
    note = ("fresh landmark pull (OA-499): %s re-asked with today's pois_query() over the box from "
            "the %s, %d -> %d elements; geometry and osm2.json carried unchanged from S2 %s"
            % (POIS, source, result["before"], result["after"], prev))
    if a.note:
        note += "; " + a.note
    stage_fn(town_dir, "commit", "S2", new_dir, "--outputs", ",".join(outputs),
             "--based-on", "S2=%s" % prev, "--note", note, *by)
    result["applied"] = True
    result["run"] = os.path.basename(new_dir)
    return result


def report(r):
    lines = ["%s: landmark pull %s S2 %s" % (r["town"], "COMMITTED as" if r["applied"] else "would replace",
                                              r["run"] if r["applied"] else r["from"]),
             "  box %.4f,%.4f,%.4f,%.4f from the %s" % (r["box"]["s"], r["box"]["w"], r["box"]["n"], r["box"]["e"], r["boxSource"]),
             "  elements %d -> %d" % (r["before"], r["after"])]
    if r["moved"]:
        for k, (o, n) in r["moved"].items():
            lines.append("    %-32s %3d -> %3d" % (k, o, n))
    else:
        lines.append("    no category's count moved")
    if not r["applied"]:
        lines.append("  DRY RUN: nothing written. --apply commits it as a new S2 run; the map's next "
                     "rebuild then draws from it.")
    return "\n".join(lines)


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        r = run(argv)
    except Refused as exc:
        print("REFUSED: %s" % exc, file=sys.stderr)
        return 1
    as_json = "--json" in (argv if argv is not None else sys.argv[1:])
    print(json.dumps(r, indent=2) if as_json else report(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
