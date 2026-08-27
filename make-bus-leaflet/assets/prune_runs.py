"""Prune superseded stage runs from the Buses folder.

Dry-run by default. Nothing is deleted unless --apply is given.

  python prune_runs.py [--root "<Buses folder>"] [--area "<Name>"]
                       [--keep-outputs 2] [--keep-inputs 3] [--apply]

What it prunes, and why the rules differ by stage:

  S3-config      never pruned. It is tiny and it is the judgement - routes.json,
                 the colour choices, the per-town generator edits.
  S1-services    keep the newest --keep-inputs runs. Tracked in git, so pruning
  S2-geometry    from disk is recoverable from history.
  S4-generate    keep the newest --keep-outputs VERSIONS, and within a kept
  S5-render      version only its newest run (re-runs of the same version are
                 superseded). NOT tracked in git - see the warning below.
  S6-verify      never pruned, since 2026-08-27. Its redteam.json is now TRACKED
                 (each one is 89k-137k tokens of blind research that cannot be
                 rebuilt), so deleting the folder would delete files git holds,
                 and the rule that kept only the newest run was entitled to
                 destroy the older half of seventeen of them.
  _latest        never touched. It is only copies, refreshed by every build.

Pins in retention-pins.json are never pruned whatever the rules say. Add a pin
whenever something outside the Buses folder starts depending on a dated run -
the portal's FIXTURE_DIR is exactly such a case, and it points two versions
behind the newest St Ives render.

IRREVERSIBILITY. Pruning S1-S3 is safe: git has them. Pruning S4/S5/S6 is not -
they are git-ignored, so the only other copy is the SyncBack mirror, which is
current-state-only and will drop them at its next run. Treat --apply on those
stages as permanent.
"""
import argparse, json, os, re, shutil, sys, datetime

INPUT_STAGES  = ("S1-services", "S2-geometry")
OUTPUT_STAGES = ("S4-generate", "S5-render")
# S3 is the judgement; S6 holds the tracked redteam.json. Neither is ever pruned.
NEVER_PRUNE   = ("S3-config", "S6-verify")
UNTOUCHED     = ("_latest",)

# In git, so pruning would be recoverable. S6 is in NEVER_PRUNE and so never
# reaches the accounting this set feeds, but it belongs here on the facts: since
# 2026-08-27 its redteam.json, verification.docx, README.md and manifest.json are
# all tracked. Its verification.json is not, and is rebuilt by verify_report.js.
TRACKED = set(INPUT_STAGES) | set(NEVER_PRUNE)
RUN_RE  = re.compile(r"^(?:(v\d+\.\d+)_)?(\d{4}-\d{2}-\d{2}_\d{4})$")


def dir_size(path):
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try: total += os.path.getsize(os.path.join(root, f))
            except OSError: pass
    return total


def version_key(v):
    if not v: return (0, 0)
    a, b = v.lstrip("v").split(".")[:2]
    return (int(a), int(b))


def find_builds(root):
    """Every folder holding a manifest.json - areas, nested places, standalone places."""
    out = []
    for base in ("Areas", "Places"):
        b = os.path.join(root, base)
        if not os.path.isdir(b): continue
        for dirpath, dirnames, filenames in os.walk(b):
            if "manifest.json" in filenames:
                out.append(dirpath)
                dirnames[:] = [d for d in dirnames if d == "Places"]
    return sorted(out)


def load_pins(root):
    p = os.path.join(root, "retention-pins.json")
    if not os.path.exists(p): return set()
    data = json.load(open(p, encoding="utf-8"))
    pins = {os.path.normpath(x["path"]) for x in data.get("pins", [])}
    for ed in data.get("printed", {}).get("editions", []):
        if ed.get("path"): pins.add(os.path.normpath(ed["path"]))
    return pins


def plan_stage(stage, runs, keep_inputs, keep_outputs):
    """runs: list of (name, version, stamp). Returns {name: (verdict, reason)}."""
    if stage in NEVER_PRUNE:
        why = ("S3 config is never pruned" if stage == "S3-config"
               else "S6 holds the tracked redteam.json and is never pruned")
        return {r[0]: ("keep", why) for r in runs}
    if stage in UNTOUCHED:
        return {r[0]: ("keep", "not a run folder") for r in runs}

    ordered = sorted(runs, key=lambda r: (version_key(r[1]), r[2]), reverse=True)

    if stage in INPUT_STAGES:
        return {r[0]: (("keep", f"newest {keep_inputs}") if i < keep_inputs
                       else ("prune", "superseded input run"))
                for i, r in enumerate(ordered)}

    # output stages: keep the newest N *versions*, and only the newest run of each
    verdicts, kept_versions, seen = {}, [], set()
    for r in ordered:
        name, ver, _ = r
        v = ver or "(unversioned)"
        if v not in seen:
            seen.add(v)
            if len(kept_versions) < keep_outputs:
                kept_versions.append(v)
                verdicts[name] = ("keep", f"newest run of {v}")
                continue
        if v in kept_versions:
            verdicts[name] = ("prune", f"superseded re-run of {v}")
        else:
            verdicts[name] = ("prune", f"older than the newest {keep_outputs} versions")
    return verdicts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=r"C:\u3a St Ives\Using AI\Buses")
    ap.add_argument("--area", help="limit to one area or place folder name")
    ap.add_argument("--keep-outputs", type=int, default=2)
    ap.add_argument("--keep-inputs", type=int, default=3)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    root = os.path.abspath(a.root)
    if not os.path.isdir(root):
        sys.exit(f"no such folder: {root}")
    pins = load_pins(root)

    rows, freed, freed_perm, pinned_hits = [], 0, 0, 0
    for build in find_builds(root):
        rel_build = os.path.relpath(build, root)
        if a.area and a.area.lower() not in os.path.basename(build).lower():
            continue
        for stage in os.listdir(build):
            sp = os.path.join(build, stage)
            if not os.path.isdir(sp) or stage in UNTOUCHED or stage.startswith("_"):
                continue
            runs = []
            for name in os.listdir(sp):
                if not os.path.isdir(os.path.join(sp, name)): continue
                m = RUN_RE.match(name)
                if m: runs.append((name, m.group(1), m.group(2)))
            if not runs: continue

            for name, (verdict, reason) in plan_stage(
                    stage, runs, a.keep_inputs, a.keep_outputs).items():
                rel = os.path.normpath(os.path.join(rel_build, stage, name))
                if rel in pins:
                    verdict, reason, = "keep", "PINNED - " + next(
                        (p["why"] for p in json.load(open(
                            os.path.join(root, "retention-pins.json"), encoding="utf-8"))["pins"]
                         if os.path.normpath(p["path"]) == rel), "see retention-pins.json")
                    pinned_hits += 1
                size = dir_size(os.path.join(sp, name)) if verdict == "prune" else 0
                if verdict == "prune":
                    freed += size
                    if stage not in TRACKED: freed_perm += size
                rows.append((rel, verdict, reason, size, stage))

    prune = [r for r in rows if r[1] == "prune"]
    prune.sort(key=lambda r: -r[3])

    print(f"Buses folder : {root}")
    print(f"Rules        : keep newest {a.keep_outputs} versions of S4/S5, "
          f"newest {a.keep_inputs} of S1/S2, all of S3, all of S6")
    print(f"Pins honoured: {pinned_hits}\n")

    if not prune:
        print("Nothing to prune.")
        return

    print(f"{'MB':>7}  {'stage':<12}  run")
    print("-" * 96)
    for rel, _, reason, size, stage in prune:
        print(f"{size/1048576:7.1f}  {stage:<12}  {rel}")
        print(f"{'':7}  {'':12}  -> {reason}")
    print("-" * 96)
    print(f"{freed/1048576:7.1f}  MB total, of which {freed_perm/1048576:.1f} MB is "
          f"NOT in git (S4/S5/S6) and recoverable only from the SyncBack mirror,\n"
          f"{'':9}until its next run.")

    if not a.apply:
        print("\nDRY RUN - nothing deleted. Re-run with --apply to delete.")
        print("Run SyncBack FIRST if you want the mirror to keep the pre-prune state.")
        return

    log = os.path.join(root, "prune-log.jsonl")
    stamp = datetime.datetime.now().isoformat(timespec="seconds")
    with open(log, "a", encoding="utf-8") as fh:
        for rel, _, reason, size, stage in prune:
            shutil.rmtree(os.path.join(root, rel))
            fh.write(json.dumps({"at": stamp, "run": rel, "stage": stage,
                                 "reason": reason, "bytes": size}) + "\n")
            print(f"deleted  {rel}")
    print(f"\nDeleted {len(prune)} runs, {freed/1048576:.1f} MB. Logged to prune-log.jsonl")


if __name__ == "__main__":
    main()
