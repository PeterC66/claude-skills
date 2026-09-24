#!/usr/bin/env python3
"""One-command scaffold for a NEW town: init the town folder + manifest, pull the
GTFS service facts, bootstrap a draft routes.json + candidate features, and
register the town in town_prefixes.json -- i.e. run the deterministic part of
S1->S3 up to the first human review gate, in one invocation.

It deliberately STOPS at the review gate (it does not commit S1 or run S2): the
human must confirm the displayed service set (incl. community/DRT buses that
BODS omits), lock the palette, and curate the external chains/features before
geometry is pulled. Everything it produces is a draft.

Usage:
  python scaffold_town.py "Huntingdon" [--region Cambridgeshire] [--centre LAT,LON]
        [--radius-km 1.6] [--buses-root "C:\\u3a St Ives\\Using AI\\Buses"] [--db PATH]

Region-agnostic: --db / $CAMBS_GTFS_DB picks the dataset; --buses-root picks where
town folders live; --region only tunes the geocode + report.
"""
import argparse, os, sys, subprocess, json, shutil
import cli   # OA-224 Tier 3.1: --buses-root, then BUSES_DIR, then the laptop
import gtfs_regions as greg

HERE=os.path.dirname(os.path.abspath(__file__))

def run(cmd, **kw):
    p=subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", **kw)
    if p.returncode!=0:
        sys.stderr.write(p.stdout+"\n"+p.stderr+"\n"); raise SystemExit(f"command failed: {' '.join(cmd)}")
    return p.stdout.strip()

def write_like_before(path, text):
    """Rewrite a committed file in the line endings and final newline it already has.

    Text-mode open() on Windows turns every \\n into \\r\\n, and json.dump writes no
    final newline, so registering Soham on 2026-09-24 rewrote the whole of buses-data's
    LF town_prefixes.json (.gitattributes eol=lf) as CRLF with no newline at the end,
    and every scaffold dirtied every line of it. Match the bytes that were there."""
    with open(path, "rb") as fh:
        raw = fh.read()
    eol = "\r\n" if b"\r\n" in raw else "\n"
    if raw.endswith(b"\n"):
        text += "\n"
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text.replace("\n", eol))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("town")
    ap.add_argument("--region",default="Cambridgeshire")
    ap.add_argument("--centre")
    ap.add_argument("--radius-km",type=float,default=1.6)
    ap.add_argument("--expiring-days",type=int,default=28,
                    help="passed to bootstrap_town.py (A5): drop a service whose GTFS "
                         "registration ends within this many days. Negative turns it off.")
    ap.add_argument("--buses-root",default=None)
    ap.add_argument("--db", default=None,
                   help="this region's sqlite. NO DEFAULT - every region is treated the same (see _gtfs/regions.json); $GTFS_DB also works.")
    a=ap.parse_args()
    a.buses_root = cli.resolve_buses(a.buses_root)
    # No default region: resolve --db / $GTFS_DB, or fail listing the built regions.
    a.db = greg.resolve_db(a.db)
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

    node=shutil.which("node") or "node"
    py=sys.executable
    town_dir=os.path.join(a.buses_root, a.town)
    stage=os.path.join(HERE,"stage.js")

    # 1. init manifest
    os.makedirs(town_dir, exist_ok=True)
    print(run([node, stage, "init", town_dir, a.town]))
    # 2. new S1 run dir (sole stdout line = abs path). stage.js finds the manifest
    #    by walking up from CWD, so run it inside the town dir.
    s1=run([node, stage, "new", "S1"], cwd=town_dir)
    print("S1 dir:", s1)

    # 3. GTFS facts -> gtfs-services.json (need the prefix; bootstrap derives it,
    #    so run bootstrap first, then gtfs_query with the prefix it found)
    boot=[py, os.path.join(HERE,"bootstrap_town.py"), a.town,
          "--region", a.region, "--radius-km", str(a.radius_km),
          "--expiring-days", str(a.expiring_days), "--db", a.db, "--out", s1]
    if a.centre: boot += ["--centre", a.centre]
    print(run(boot))
    draft=json.load(open(os.path.join(s1,"routes.draft.json"),encoding="utf-8"))
    prefix=draft.get("atcoPrefix")
    if prefix:
        run([py, os.path.join(HERE,"gtfs_query.py"), prefix, "--town", a.town,
             "--db", a.db, "--out", os.path.join(s1,"gtfs-services.json")])
    else:
        # A draft with no atcoPrefix is a REFUSAL, not an absence, and it silently costs
        # this run its central artefact: there is no gtfs-services.json to review at the
        # gate, and step 4 cannot register the town either. Until this line existed the
        # only trace was step 4's "(or no prefix)", which reads as "already registered".
        print(f"  WARNING: bootstrap found no atcoPrefix for {a.town}, so "
              f"gtfs-services.json was NOT pulled. Check routes.draft.json, then run "
              f"gtfs_query.py by hand before reviewing S1.")

    # 4. register the town in town_prefixes.json (for the monthly refresh report)
    tp_path=os.path.join(os.path.dirname(a.db),"town_prefixes.json")
    try:
        tp=json.load(open(tp_path,encoding="utf-8"))
        if a.town not in tp and prefix:
            entry={"prefixes":[prefix]}
            # Record the region whenever this town's dataset is NOT the default one. Without it
            # the monthly refresh diffs the town against the default region's data, matches
            # nothing, and reports every one of its routes as withdrawn - which is exactly what
            # happened to Beaconsfield for a month.
            gdir=os.path.dirname(a.db)
            regions,default=greg.load(gdir)
            here=os.path.normcase(os.path.abspath(a.db))
            match=[n for n,r in regions.items()
                   if r.get("db") and os.path.normcase(os.path.abspath(r["db"]))==here]
            if match and match[0]!=default:
                entry["region"]=match[0]
                print(f"  region: {match[0]} (non-default dataset)")
            elif not match:
                print(f"  WARNING: {os.path.basename(a.db)} is not registered in regions.json. "
                      f"Add it there and set \"region\" on {a.town} in town_prefixes.json, or the "
                      f"monthly refresh cannot check this town.")
            tp[a.town]=entry
            write_like_before(tp_path, json.dumps(tp,indent=1,ensure_ascii=False))
            print(f"registered {a.town} in {tp_path}")
        elif a.town in tp:
            print(f"{a.town} already in town_prefixes.json - left as it stands")
        else:
            # The other half of the same conflation: nothing was registered, and the
            # reason is the missing prefix rather than a row that already existed.
            print(f"NOT registered: {a.town} has no atcoPrefix, so the monthly refresh "
                  f"cannot check this town until one is added by hand")
    except FileNotFoundError:
        print(f"(no town_prefixes.json at {tp_path} — skipped registration)")

    # 5. next-steps note
    nxt=os.path.join(s1,"SCAFFOLD-NEXT.md")
    open(nxt,"w",encoding="utf-8").write(f"""# {a.town} — scaffold complete, REVIEW then continue

Scaffolded by scaffold_town.py. The deterministic S1 facts are drafted; the
human gates remain. NOTHING is committed yet.

## Review (S1)
1. Open `gtfs-services.json` and `bootstrap-report.md`. Confirm the service set
   against bustimes.org — **add community / demand-responsive / pre-book buses**
   that BODS (GTFS) omits, and drop routes that don't really serve the town.
2. Build `verified-services.json` (+ the disagreements audit) — see
   `references/s1-services.md`. Then `stage.js commit S1 "{s1}" --outputs verified-services.json,...`.

## Config (S3)
3. Open `routes.draft.json`. Lock the **palette** (watch the river-blue clash),
   curate the **external** stop chains / bearings / sides, pick the **1–3 linear
   features**, and fill **internalDesc**. Move it to a new S3 as `routes.json`.
   The generators run **UNCHANGED** from the skill — no per-town code edits.

## Geometry (S2) then Build (S4/S5) then Verify (S6)
4. `stage.js new S2`; pull the full chains + coords + features (see
   `references/s2-geometry.md`).
5. `stage.js new S4 --bump major`; pull S2+S3; run the **template** generators
   in place (`node "%SK%\\gen_internal.js"`, `node "%SK%\\gen_external_radial.js"`
   as `gen_external.js`) with the run dir as CWD; render S5; verify S6.
""")
    print(f"\nScaffold done. Draft config: {os.path.join(s1,'routes.draft.json')}")
    print(f"Review checklist: {nxt}")

if __name__=="__main__":
    main()
