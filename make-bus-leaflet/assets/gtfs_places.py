#!/usr/bin/env python3
"""Which place maps have we built, and what radius does each one care about?

`town_prefixes.json` registers every built TOWN by hand, and drifts: a town only
gets monthly change-detection if somebody remembered to add it when S1 ran. Place
maps are added far more often than towns and would drift faster, so they are not
registered at all — they are DISCOVERED here, from the manifests the build
already writes.

A place is anchored to a point, not to a NaPTAN block: its `gtfs-services.json`
carries `"near": [lat, lon, km]` and `"atcoPrefixes": null`, written by the same
`gtfs_query.query()` that writes a town's. `gtfs_upcoming.make_town_stops()` has
supported `near` since Beaconsfield and High Wycombe needed it (their ATCO blocks
are far too broad), so a discovered place drops straight into the existing scan
with no new selection code.

Why this matters: without it a place is only ever scanned as a side effect of its
parent town. That misses two things — a place whose town is not itself registered
is never scanned at all, and a place's own 0.8 km service radius is not a subset
of its town's (High Wycombe's is 3.5 km around a centre 2.6 km away), so routes
serving the place from outside the town radius are invisible.

The `walkshedM` in `place.json` is NOT the service radius — it decides which stops
are DRAWN on the close-up. The service radius only ever comes from
`gtfs-services.json`.
"""
import os
import json
import glob

# Stage dirs a place's facts files may live in, in the order we trust them. The
# facts stages come first: S1/S2 are where gtfs-services.json is originally
# written (which of the two varies by place — Tesco Extra has it in S1, Aldi in
# S2), and S4/S5 only carry copies made at generate/render time.
STAGE_PREFERENCE = ("S2", "S1", "S5", "S4")
STAGE_GLOB = "S[1245]-*"

# Fallback service radius, in km, if a place somehow has no `near` recorded.
# Matches the make-place-bus-leaflet default ("Two radii" in its SKILL.md).
DEFAULT_SERVICE_KM = 0.8

# The frozen byte-identical copy the portal's CI gate reproduces. It is a
# fixture, not a live map, and scanning it would double-count High Wycombe Aldi.
EXCLUDED_DIRS = ("_portal-fixture",)


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _stage_dirs(place_dir, manifest):
    """Candidate dirs holding a place's facts files, best first.

    Manifest `latest` run per stage in STAGE_PREFERENCE order, then `_latest/`,
    then any stage run dir newest-first, then `ci-reference/`. The manifest's
    `outputs` list is only a hint — it is not exhaustive (Aldi's S5 run lists
    place.json but not gtfs-services.json, though both are on disk) — so
    existence on disk is what decides.
    """
    out = []
    stages = (manifest or {}).get("stages") or {}
    for name in STAGE_PREFERENCE:
        st = stages.get(name) or {}
        run = next((r for r in (st.get("runs") or []) if r.get("id") == st.get("latest")), None)
        if run and run.get("dir"):
            out.append(os.path.join(place_dir, run["dir"].replace("/", os.sep)))
    out.append(os.path.join(place_dir, "_latest"))
    out += sorted(glob.glob(os.path.join(place_dir, STAGE_GLOB, "*")), key=os.path.getmtime, reverse=True)
    out.append(os.path.join(place_dir, "ci-reference"))
    return out


def resolve_output(place_dir, manifest, filename):
    """-> (path, note) for a place's facts file, or (None, reason) if absent.

    `note` is None for a clean hit and a short caveat otherwise, so a place read
    from the CI reference mirror says so in the report rather than silently
    scanning coordinates that may be stale.
    """
    for d in _stage_dirs(place_dir, manifest):
        p = os.path.join(d, filename)
        if os.path.isfile(p):
            note = "read from ci-reference (no stage run has it)" if os.path.basename(d) == "ci-reference" else None
            return p, note
    return None, f"no {filename} found in any stage run, _latest or ci-reference"


def _norm(s):
    return "".join(ch for ch in str(s or "").lower() if ch.isalnum())


def resolve_region(place_meta, parent_cfg, regions, default):
    """Which registered dataset holds this place's services?

    A place inside a registered town must use that town's dataset — anything else
    would diff it against a feed that cannot contain it, the mistake `plan()`
    exists to refuse. Standalone places (no parent, or a parent we have not
    registered) fall back to the human region name in place.json, matched against
    each region's key, its atcoAreas names, then its bodsRegion.

    An unrecognised name is returned UNCHANGED on purpose: `gtfs_regions.plan()`
    then reports it as "region '<name>' is not registered in regions.json" and
    skips the place, which is the same NOT CHECKED path a misconfigured town
    takes. Better a named refusal than a silent miss.
    """
    if parent_cfg is not None:
        return parent_cfg.get("region") or default
    human = (place_meta or {}).get("region")
    if not human:
        return default
    want = _norm(human)
    for key, reg in (regions or {}).items():
        if want == _norm(key):
            return key
        if any(want == _norm(v) for v in (reg.get("atcoAreas") or {}).values()):
            return key
        if want == _norm(reg.get("bodsRegion")):
            return key
    return human


def _place_dirs(root):
    """Every built place map: (name, dir, parent_town_or_None).

    Three layouts, all carrying the same manifest: `Areas/<Town>/Places/<Place>/`
    (a place inside an area we map), `Places/<Place>/` (flat — a place with no
    parent area), and `Places/<Bucket>/<Place>/` (today's documented
    `Places/_standalone/<Place>/`). Keyed on manifest.json, so a directory that
    is not a built map is never picked up.
    """
    found, seen = [], set()
    for pattern, has_parent in (
        (os.path.join(root, "Areas", "*", "Places", "*", "manifest.json"), True),
        (os.path.join(root, "Places", "*", "manifest.json"), False),
        (os.path.join(root, "Places", "*", "*", "manifest.json"), False),
    ):
        for mf in sorted(glob.glob(pattern)):
            d = os.path.dirname(mf)
            if d in seen or any(x in d.split(os.sep) for x in EXCLUDED_DIRS):
                continue
            seen.add(d)
            parent = os.path.basename(os.path.dirname(os.path.dirname(d))) if has_parent else None
            found.append((os.path.basename(d), d, parent))
    return found


def discover(root, regions=None, default="cambridgeshire", prefixes_cfg=None):
    """Built place maps as scan entries -> (entries, problems).

    entries  — {name: cfg} in exactly the shape gtfs_regions.plan() and
               gtfs_upcoming.build_town() already consume, plus `_`-prefixed
               metadata the report uses. `near` comes from the place's own
               gtfs-services.json.
    problems — [(name, reason)] for places that cannot be scanned, merged into
               the report's "Not checked" section alongside skipped towns.

    A place whose name collides with a registered town is refused rather than
    silently shadowing it; folder names keep their town prefix ("High Wycombe
    Aldi") precisely so this cannot normally happen.
    """
    entries, problems = {}, []
    prefixes_cfg = prefixes_cfg or {}
    for name, place_dir, parent in _place_dirs(root):
        if name in prefixes_cfg:
            problems.append((name, "a town of this name is already registered in town_prefixes.json"))
            continue
        manifest = _read_json(os.path.join(place_dir, "manifest.json"))
        gs_path, gs_note = resolve_output(place_dir, manifest, "gtfs-services.json")
        if not gs_path:
            problems.append((name, gs_note))
            continue
        gs = _read_json(gs_path) or {}
        place_meta = _read_json(resolve_output(place_dir, manifest, "place.json")[0] or "") or {}
        near = gs.get("near")
        note = gs_note
        if not near:
            lat, lon = place_meta.get("lat"), place_meta.get("lon")
            if lat is None or lon is None:
                problems.append((name, "no service radius in gtfs-services.json and no lat/lon in place.json"))
                continue
            near = [lat, lon, DEFAULT_SERVICE_KM]
            note = "; ".join(x for x in (note, f"no recorded radius — assumed {DEFAULT_SERVICE_KM} km") if x)
        parent_cfg = prefixes_cfg.get(parent) if parent else None
        entries[name] = {
            "near": list(near),
            "region": resolve_region(place_meta, parent_cfg, regions, default),
            "_kind": "place",
            "_town": parent or place_meta.get("town"),
            "_dir": place_dir,
            "_src": os.path.relpath(gs_path, place_dir).replace(os.sep, "/"),
            "_note": note,
        }
    return entries, problems
