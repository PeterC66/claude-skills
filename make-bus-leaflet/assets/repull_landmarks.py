#!/usr/bin/env python3
"""repull_landmarks.py -- re-run ONE map's landmark pull into a new S2 run, keeping its geometry (buses-data OA-499).

WHY THIS EXISTS. OA-500 (2026-09-28) widened what a map draws -- pubs, cinemas,
colleges, post offices, stations and more -- and changed the landmark QUERY that
`draft_town.py`'s `pois_query()` sends to Overpass. It did not change a single stored
pull. A rebuild row runs `rollout.js`, which reads the stored S2 and fetches nothing,
so every map rebuilt after OA-500 still draws from a pull that predates the new
categories: the rebuild shows only what the old pull happened to hold. This file is
the missing step the rebuild row names first: ask Overpass the CURRENT question over
the town's OWN box, and commit the answer as a new S2 run through `stage.js`.

    Run it from anywhere. There are no placeholders except <Town>, <Place> and <who>:

      python repull_landmarks.py --town "<Town>"
      python repull_landmarks.py --town "<Town>" --apply --by <who>
      python repull_landmarks.py --place "<Place>" --apply --by <who>

    --town    the town's folder name under Areas/, e.g. "March"
    --place   a place map's folder name, e.g. "Ely Co-op", found under Areas/<Town>/Places/,
              Places/ or Places/<bucket>/; give exactly one of --town and --place
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
  2. for a PLACE, otherwise its `walkshed_cfg.json` box (centre +/- radiusM) joined
     with the extent of its `osm.json` -- the box its first bbox MCP pull was asked
     over, and never smaller than what that pull held;
  3. otherwise the extent of the elements in its `osm.json`. That is at most the box
     it was asked over, never larger, and bus stops are dense enough that it is close;
     the report says which source was used so a reader can judge.

THE ANSWER MUST BE CURRENT, NOT ONLY COMPLETE (OA-528). On 2026-09-29 March's first
`--apply` was answered by the overpass.kumi.systems mirror from older data: 159 elements
and no Budgens, where overpass-api.de had 160. `overpass_fetch.fetch()` judged it
complete, which it was. So now: the fetch refuses data older than the S2 it would
replace; an answer from a mirror is compared with the MAIN host's data date, and an
older one is asked again, accepting only data at least that new; when the main host
cannot be asked its date, a mirror's answer is REFUSED rather than stored unchecked.
Which host answered, and the data date of its answer, are written beside the query
as `overpass-source.json`, so a later reader can see what data the map was drawn from.

A PLACE IS THE SAME QUESTION OVER ITS OWN BOX (OA-499 item 2, 2026-09-30). A place's
first landmark pull is the bbox MCP `search_overpass` over its walkshed box, which
records no query, and this tool used to refuse a place as a different question. It is
not one: Ely Co-op's full rebuild of 2026-09-29 (OA-508) asked today's `pois_query()`
over the extent of its old `osm.json` by hand (97 elements became 124) and recorded
the query, and both Godmanchester places did the same. So `--place` finds the place's
folder by name and then runs the town path: the box rule below (with one step of its
own), the currency rule, osm2.json kept. A name found in two folders is refused rather than guessed,
because the two places would have different boxes.

Exit codes follow references/conventions.md: 0 done (or a dry run that ran), 1 a
refusal with its remedy printed, 2 a usage error.
"""
import argparse
import json
import math
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
SOURCE = "overpass-source.json"
WALKSHED = "walkshed_cfg.json"
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


def box_from_walkshed(s2_dir):
    """The square of side 2*radiusM round a place's walkshed centre, or None."""
    path = os.path.join(s2_dir, WALKSHED)
    if not os.path.isfile(path):
        return None
    cfg = read_json(path)
    try:
        lat, lon = (float(v) for v in cfg["center"])
        r = float(cfg["radiusM"])
    except (KeyError, TypeError, ValueError):
        return None
    dlat = r / 111320.0
    dlon = r / (111320.0 * math.cos(math.radians(lat)))
    return {"s": lat - dlat, "w": lon - dlon, "n": lat + dlat, "e": lon + dlon}


def union(a, b):
    if not (a and b):
        return a or b
    return {"s": min(a["s"], b["s"]), "w": min(a["w"], b["w"]), "n": max(a["n"], b["n"]), "e": max(a["e"], b["e"])}


def town_box(s2_dir, is_place=False):
    """(box, source) for the latest S2 run -- see THE BOX IS THE TOWN'S OWN."""
    qpath = os.path.join(s2_dir, QUERY)
    if os.path.isfile(qpath):
        with open(qpath, encoding="utf-8") as fh:
            box = box_from_query(fh.read())
        if box:
            return box, "recorded query (%s)" % QUERY
    if is_place:
        # A place's first pull was the bbox MCP over its WALKSHED box and recorded no
        # query; a sparse answer's extent is far smaller than that box (St Neots
        # Co-op: 4 elements, about 300 m wide, against a 650 m walkshed). The union
        # asks the documented question and cannot lose anything the old pull reached.
        walk = box_from_walkshed(s2_dir)
        if walk:
            return (union(walk, box_from_elements(read_json(os.path.join(s2_dir, POIS)))),
                    "walkshed box in %s joined with the extent of the stored %s" % (WALKSHED, POIS))
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


def current_answer(query, new, src, fetch, main_base):
    """(answer, source) once the answer is shown current -- see THE ANSWER MUST BE CURRENT.

    `src` is the {host, osmBase} the fetch filled in. An answer from the main host is
    current by definition; one from a mirror is checked against the main host's date."""
    main = overpass_fetch.HOSTS[0]
    if src.get("host") == main:
        return new, src
    try:
        mb = main_base()
    except overpass_fetch.OverpassUnreachable as exc:
        raise Refused("%s was answered by %s from data of %s, and the main host %s could not be "
                      "asked the date of its own data (%s), so the answer cannot be shown current. "
                      "Nothing was written: re-run when %s is answering."
                      % (POIS, src.get("host"), src.get("osmBase") or "no stated date", main, exc, main))
    if src.get("osmBase") and src["osmBase"] >= mb:
        return new, dict(src, mainOsmBase=mb)
    again = {}
    try:
        new = fetch(query, not_before=mb, source=again)
    except overpass_fetch.OverpassUnreachable as exc:
        raise Refused("%s was answered by %s from data of %s, older than the main host's %s, and "
                      "asking again found no host with data that new (%s). Nothing was written."
                      % (POIS, src.get("host"), src.get("osmBase") or "no stated date", mb, exc))
    return new, dict(again, mainOsmBase=mb,
                     staleAnswer={"host": src.get("host"), "osmBase": src.get("osmBase")})


def place_dir(root, name):
    """The one folder holding place map `name`, searched where gate_lib.findPlaces looks."""
    cands = []
    areas = os.path.join(root, "Areas")
    if os.path.isdir(areas):
        cands += [os.path.join(areas, t, "Places", name) for t in sorted(os.listdir(areas))]
    places = os.path.join(root, "Places")
    cands.append(os.path.join(places, name))
    if os.path.isdir(places):
        cands += [os.path.join(places, b, name) for b in sorted(os.listdir(places))]
    hits = [d for d in cands if os.path.isfile(os.path.join(d, "manifest.json"))]
    if len(hits) != 1:
        raise Refused("%s place map is named %r under %s%s. Name a place by its folder, as "
                      "status.js prints it." % ("no" if not hits else "more than one", name, root,
                                                "" if not hits else ": " + "; ".join(hits)))
    return hits[0]


def s2_outputs(manifest, run_id):
    for r in (manifest.get("stages", {}).get("S2", {}).get("runs") or []):
        if r.get("id") == run_id:
            return list(r.get("outputs") or [])
    return []


def run(argv=None, fetch=None, stage_fn=None, main_base=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    which = ap.add_mutually_exclusive_group(required=True)
    which.add_argument("--town")
    which.add_argument("--place")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--by")
    ap.add_argument("--root")
    ap.add_argument("--answer")
    ap.add_argument("--note", default="")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    fetch = fetch or (lambda q, not_before=None, source=None: overpass_fetch.fetch(
        q, timeout=90, label=POIS, not_before=not_before, source=source))
    main_base = main_base or overpass_fetch.main_host_base
    stage_fn = stage_fn or stage

    is_place = a.place is not None
    name = (a.place if is_place else a.town).strip()
    if len(re.split(r"[\\/]+", name)) > 1 or name in ("", ".", ".."):
        # A place's manifest looks like a town's (it carries no marker), so a PATH
        # under --town could pass a place off as a town: both flags take a NAME only.
        raise Refused("%r is not a folder name: name a town with --town and a place with "
                      "--place, never a path." % name)
    root = cli.resolve_buses(a.root)
    town_dir = place_dir(root, name) if is_place else os.path.join(root, "Areas", name)
    mpath = os.path.join(town_dir, "manifest.json")
    if not os.path.isfile(mpath):
        raise Refused("%s has no manifest.json. A town is named as its folder under Areas/, and "
                      "a place map with --place." % town_dir)
    manifest = read_json(mpath)
    prev = (manifest.get("stages", {}).get("S2") or {}).get("latest")
    if not prev:
        raise Refused("%s has no committed S2 run to carry the geometry from." % name)
    prev_dir = os.path.join(town_dir, "S2-geometry", prev)
    if not os.path.isfile(os.path.join(prev_dir, POIS)):
        raise Refused("S2 %s has no %s, so there is no landmark pull to replace." % (prev, POIS))

    box, source = town_box(prev_dir, is_place)
    query = pois_query(box)
    old = read_json(os.path.join(prev_dir, POIS))
    if a.answer:
        new = read_json(a.answer)
        src = {"host": "stored answer (--answer)", "osmBase": overpass_fetch.osm_base(new)}
    else:
        src = {}
        try:
            # Never older than the pull it replaces: a re-pull that goes backwards is no re-pull.
            new = fetch(query, not_before=overpass_fetch.osm_base(old), source=src)
        except overpass_fetch.OverpassUnreachable as exc:
            raise Refused("%s\nNothing was written: an unanswered question is not an empty answer. "
                          "Re-run when Overpass is answering." % exc)
        new, src = current_answer(query, new, src, fetch, main_base)
    if not isinstance(new, dict) or not new.get("elements"):
        raise Refused("Overpass answered with no elements over %s. A map's box always holds bus "
                      "stops, so this is a failed pull, not an empty map; nothing was written." % box)

    result = {"town": name, "kind": "place" if is_place else "town", "from": prev, "box": box, "boxSource": source,
              "before": len(old.get("elements", [])), "after": len(new["elements"]),
              "moved": compare(old, new), "source": src, "applied": False, "run": None}
    if not a.apply:
        return result

    by = ["--by", a.by] if a.by else []
    new_dir = stage_fn(town_dir, "new", "S2", *by).splitlines()[-1].strip()
    stage_fn(town_dir, "pull", "S2", new_dir)
    with open(os.path.join(new_dir, POIS), "w", encoding="utf-8") as fh:
        json.dump(new, fh, ensure_ascii=False)
    with open(os.path.join(new_dir, QUERY), "w", encoding="utf-8") as fh:
        fh.write(query + "\n")
    with open(os.path.join(new_dir, SOURCE), "w", encoding="utf-8") as fh:
        json.dump(src, fh, indent=2, sort_keys=True)
        fh.write("\n")
    outputs = s2_outputs(manifest, prev)
    for f in (POIS, QUERY, SOURCE):
        if f not in outputs:
            outputs.append(f)
    note = ("fresh landmark pull (OA-499): %s re-asked with today's pois_query() over the box from "
            "the %s, %d -> %d elements, answered by %s from OSM data of %s; geometry and osm2.json "
            "carried unchanged from S2 %s"
            % (POIS, source, result["before"], result["after"], src.get("host"),
               src.get("osmBase") or "no stated date", prev))
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
             "  elements %d -> %d" % (r["before"], r["after"]),
             "  answered by %s from OSM data of %s" % (r["source"].get("host"),
                                                       r["source"].get("osmBase") or "no stated date")]
    if r["source"].get("staleAnswer"):
        st = r["source"]["staleAnswer"]
        lines.append("  (asked again: %s first answered from older data of %s)" % (st["host"], st["osmBase"]))
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
