#!/usr/bin/env python3
"""Which GTFS dataset does each built town's facts come from?

The pipeline is multi-region. `_gtfs/regions.json` registers each BODS region and
the sqlite built from it; `_gtfs/town_prefixes.json` gives each built town an
optional `"region"` (absent => the registry's `_default`). The monthly tooling
(`gtfs_refresh_report.py`, `gtfs_upcoming.py`) uses this to diff every town
against ITS OWN dataset.

Why this exists: both scripts took a single `--db` and ran every town against it.
Beaconsfield (ATCO 0400, in `buckinghamshire.sqlite`) was therefore queried
against the Cambridgeshire dataset, matched nothing, and had all seven of its
routes reported `[WITHDRAWN?]` every month. Diffing a town against a dataset that
cannot contain it is never a useful answer, so `plan()` refuses to do it and says
why instead.
"""
import os, json

DEFAULT_REGION = "cambridgeshire"


def load(gdir):
    """-> (regions dict, default region name). Missing/broken registry => empty + default."""
    try:
        cfg = json.load(open(os.path.join(gdir, "regions.json"), encoding="utf-8"))
    except Exception:
        return {}, DEFAULT_REGION
    regions = {k: v for k, v in (cfg.get("regions") or {}).items() if not k.startswith("_")}
    return regions, (cfg.get("_default") or DEFAULT_REGION)


def feed_info(gdir, db):
    """Per-dataset sidecar written by gtfs_build.py, falling back to the legacy shared one.

    gtfs_build writes feed_info_<dbstem>.json for every dataset and also keeps
    feed_info.json for cambridgeshire. Datasets built before that change have only
    the shared file, hence the fallback.
    """
    for name in ([f"feed_info_{os.path.splitext(os.path.basename(db))[0]}.json"] if db else []) + ["feed_info.json"]:
        try:
            return json.load(open(os.path.join(gdir, name), encoding="utf-8"))
        except Exception:
            continue
    return {}


def prefix_mismatch(cfg, region_name, region):
    """Guard: a town whose ATCO prefixes cannot occur in this region's dataset.

    Catches a town added to town_prefixes.json without its `"region"` key — the
    exact mistake that made Beaconsfield report as fully withdrawn. Towns located
    by `near` (no prefixes) and regions built without a prefix filter are skipped:
    there is nothing to check.
    """
    keep = region.get("keepPrefixes") or []
    pref = cfg.get("prefixes") or []
    if not keep or not pref:
        return None
    if any(p.startswith(k) for p in pref for k in keep):
        return None
    return (f"ATCO prefix {', '.join(pref)} cannot occur in region '{region_name}' "
            f"(that dataset keeps {', '.join(keep)}) — wrong region, or a missing \"region\" key")


def plan(gdir, prefixes_cfg, db_override=None):
    """Group the built towns by the dataset they must be read from.

    Returns (groups, skipped):
      groups  — [{"region","db","feed","towns":[(town,cfg),…]}], in first-appearance
                order so report output stays deterministic.
      skipped — [(town, reason)] for towns that cannot be diffed safely.

    An explicit --db overrides the registry entirely (single-dataset and testing use);
    every town is then read from it and nothing is skipped.
    """
    regions, default = load(gdir)
    order, groups, skipped = [], {}, []
    for town, cfg in prefixes_cfg.items():
        if town.startswith("_"):
            continue
        name = cfg.get("region") or default
        if db_override:
            db, reason = db_override, None
        else:
            r = regions.get(name)
            if not r:
                skipped.append((town, f"region '{name}' is not registered in regions.json"))
                continue
            db = r.get("db") or os.path.join(gdir, f"{name}.sqlite")
            reason = None if os.path.isfile(db) else \
                f"dataset for region '{name}' is not built ({os.path.basename(db)} missing)"
            if not reason:
                reason = prefix_mismatch(cfg, name, r)
        if reason:
            skipped.append((town, reason))
            continue
        if db not in groups:
            groups[db] = {"region": name, "db": db, "feed": feed_info(gdir, db), "towns": []}
            order.append(db)
        groups[db]["towns"].append((town, cfg))
    return [groups[d] for d in order], skipped


def feed_line(g):
    """One-line provenance for a group, for report headers."""
    fi = (g.get("feed") or {}).get("feed_info", {})
    return (f"**{g['region']}** (`{os.path.basename(g['db'])}`) — built {(g.get('feed') or {}).get('built','?')}, "
            f"feed valid {fi.get('feed_start_date','?')}–{fi.get('feed_end_date','?')}")
