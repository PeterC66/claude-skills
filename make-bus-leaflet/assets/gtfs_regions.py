#!/usr/bin/env python3
"""Which GTFS dataset does each built town's facts come from?

The pipeline is multi-region. `_gtfs/regions.json` registers each BODS region and
the sqlite built from it; `_gtfs/town_prefixes.json` gives each built town a
`"region"`. The monthly tooling (`gtfs_refresh_report.py`, `gtfs_upcoming.py`)
uses this to diff every town against ITS OWN dataset.

Why this exists: both scripts took a single `--db` and ran every town against it.
Beaconsfield (ATCO 0400, in `buckinghamshire.sqlite`) was therefore queried
against the Cambridgeshire dataset, matched nothing, and had all seven of its
routes reported `[WITHDRAWN?]` every month. Diffing a town against a dataset that
cannot contain it is never a useful answer, so `plan()` refuses to do it and says
why instead.

EVERY REGION IS TREATED THE SAME (rule adopted 2026-08-21). There is no default
region and no privileged dataset. Cambridgeshire used to be both: `regions.json`
carried `_default: "cambridgeshire"`, five scripts fell back to a hardcoded
`cambridgeshire.sqlite`, the env var was named `$CAMBS_GTFS_DB`, and `gtfs_build.py`
wrote an extra unsuffixed `feed_info.json` that this module fell back to reading.

Each of those was a way to get a CONFIDENT WRONG ANSWER rather than an error: a
Bedfordshire town scaffolded without `--db` would silently be queried against
Cambridgeshire and report every one of its routes as withdrawn — which is exactly
the Beaconsfield failure this file was written to prevent, arriving through the
front door instead. The feed_info fallback was the same shape one level down: a
region whose sidecar was missing reported CAMBRIDGESHIRE's feed dates as its own.

So: no default, and `resolve_db()` fails with a message naming the built regions
rather than picking one for you.
"""
import os, json

# Deliberately None. See the module docstring — a default region is a wrong-answer
# generator, not a convenience.
DEFAULT_REGION = None


def load(gdir):
    """-> (regions dict, default region name). Missing/broken registry => empty + default."""
    try:
        cfg = json.load(open(os.path.join(gdir, "regions.json"), encoding="utf-8"))
    except Exception:
        return {}, DEFAULT_REGION
    regions = {k: v for k, v in (cfg.get("regions") or {}).items() if not k.startswith("_")}
    return regions, (cfg.get("_default") or DEFAULT_REGION)


def feed_info(gdir, db):
    """The per-dataset sidecar written by gtfs_build.py, or {} if there isn't one.

    NO FALLBACK, deliberately (2026-08-21). This used to fall back to an unsuffixed
    `feed_info.json` that only ever described CAMBRIDGESHIRE, so any region whose
    sidecar was missing silently reported Cambridgeshire's build date and validity
    window as its own — a wrong answer that looks exactly like a right one. An empty
    dict is the honest result: callers already treat it as "unknown".
    """
    if not db:
        return {}
    name = f"feed_info_{os.path.splitext(os.path.basename(db))[0]}.json"
    try:
        return json.load(open(os.path.join(gdir, name), encoding="utf-8"))
    except Exception:
        return {}


def default_gdir():
    """Where regions.json lives. Overridable with $BUSES_GTFS_DIR.

    Hardcoding the REGISTRY's location is fine; hardcoding a default REGION is not.
    The registry is the thing that tells you which regions exist — looking it up is
    the opposite of assuming which one you meant.
    """
    return os.environ.get("BUSES_GTFS_DIR", os.path.join(
        r"C:\u3a St Ives", "Using AI", "Buses", "_gtfs"))


def resolve_db(explicit=None, gdir=None):
    """The dataset to query — from --db, or $GTFS_DB, or a fatal error.

    Never guesses. Every ad-hoc entry point (gtfs_query, gtfs_duration,
    scaffold_town, bootstrap_town, draft_town) used to fall back to a hardcoded
    cambridgeshire.sqlite, so running any of them for an out-of-region town without
    remembering --db produced a plausible, empty, wrong answer.

    $CAMBS_GTFS_DB is still honoured so existing shells keep working, but it is
    misnamed for a multi-region system and says so when used.
    """
    if explicit:
        return explicit
    env = os.environ.get("GTFS_DB")
    if env:
        return env
    legacy = os.environ.get("CAMBS_GTFS_DB")
    if legacy:
        import sys
        # ASCII only: this goes to a Windows console whose stderr is cp1252, where an
        # em-dash renders as a replacement character.
        print("note: $CAMBS_GTFS_DB is deprecated (the pipeline is multi-region and no "
              "region is the default) - rename it to $GTFS_DB.", file=sys.stderr)
        return legacy
    known = ""
    gdir = gdir or default_gdir()
    if gdir:
        try:
            regions, _ = load(gdir)
            built = [f"    --db \"{r['db']}\"   # {n}"
                     for n, r in sorted(regions.items()) if r.get("status") == "built" and r.get("db")]
            if built:
                known = "\n\nBuilt regions:\n" + "\n".join(built)
            reg = os.path.join(gdir, "regions.json")
            known += f"\n\nRegistry: {reg}"
        except Exception:
            pass
    raise SystemExit(
        "No GTFS dataset given, and there is no default region.\n"
        "Pass --db <path to a region's .sqlite>, or set $GTFS_DB.\n"
        "\n"
        "There is deliberately no default: querying a town against the wrong region's\n"
        "dataset matches nothing and reports every one of its routes as withdrawn,\n"
        "which reads exactly like a real answer." + known)


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
