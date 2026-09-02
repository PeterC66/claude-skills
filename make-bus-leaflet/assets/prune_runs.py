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

IRREVERSIBILITY, and why this tool asks git rather than assuming. Pruning S1-S3
is safe: git has them. Most of S4/S5 is not - it is git-ignored, so the only other
copy is the SyncBack mirror, which is current-state-only and will drop it at its
next run. Treat --apply on those stages as permanent.

BUT that sentence used to be a hard-coded ASSUMPTION, and on 2026-08-28 it was
briefly false. build-warnings.txt was tracked that morning (OA-046) and untracked
the same day (OA-144); for those hours 161 tracked files sat inside the two folders
this tool exists to delete, and the summary line went on telling the operator, in
words, that nothing being deleted was in git. A tool whose own warning has gone
stale is worse than one with no warning, because the operator has read it and been
reassured. Nothing announced the change to the tool, and nothing would have.

So the accounting below ASKS `git ls-files` which paths are tracked, per FILE,
instead of deriving it from a list of stages kept here. The reversal means the
answer is 0 again today - but it is now a measurement rather than a claim, and it
will stay right through the next re-include without anyone editing this file. An
ignore rule and a prune rule are two lists that must agree, and nothing makes them
agree; the only way not to need them to agree is to stop keeping the second list.

If git cannot be consulted the tool prints the split as UNKNOWN. It does NOT fall
back to the old reassurance: the whole failure being fixed here is a tool asserting
something it had not checked.
"""
import argparse, json, os, re, shutil, subprocess, sys, datetime
import cli   # OA-224 Tier 3.1: --root, then BUSES_DIR, then the laptop

INPUT_STAGES  = ("S1-services", "S2-geometry")
OUTPUT_STAGES = ("S4-generate", "S5-render")
# S3 is the judgement; S6 holds the tracked redteam.json. Neither is ever pruned.
NEVER_PRUNE   = ("S3-config", "S6-verify")
UNTOUCHED     = ("_latest",)

RUN_RE  = re.compile(r"^(?:(v\d+\.\d+)_)?(\d{4}-\d{2}-\d{2}_\d{4})$")


def tracked_paths(root):
    """Every path git tracks under root, normalised, as a set.

    Returns None when git cannot answer - not an empty set. An empty set means
    "git tracks nothing here", which would make the summary claim every byte is
    unrecoverable; None means "we do not know", and the summary says so. The
    difference matters because this function's whole job is to stop the tool
    asserting something it has not checked.
    """
    try:
        out = subprocess.run(["git", "ls-files", "-z"], cwd=root,
                             capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return {os.path.normpath(p) for p in out.stdout.split("\0") if p}


def dir_split(path, root, tracked):
    """(tracked_bytes, untracked_bytes, tracked_file_count) for one run folder.

    With tracked=None every byte is reported as untracked and the caller prints
    the split as UNKNOWN.
    """
    t_bytes = u_bytes = t_files = 0
    for dirpath, _, files in os.walk(path):
        for f in files:
            full = os.path.join(dirpath, f)
            try:
                size = os.path.getsize(full)
            except OSError:
                continue
            rel = os.path.normpath(os.path.relpath(full, root))
            if tracked is not None and rel in tracked:
                t_bytes += size
                t_files += 1
            else:
                u_bytes += size
    return t_bytes, u_bytes, t_files


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
    ap.add_argument("--root", default=None)
    ap.add_argument("--area", help="limit to one area or place folder name")
    ap.add_argument("--keep-outputs", type=int, default=2)
    ap.add_argument("--keep-inputs", type=int, default=3)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    a.root = cli.resolve_buses(a.root)

    root = os.path.abspath(a.root)
    if not os.path.isdir(root):
        sys.exit(f"no such folder: {root}")
    pins = load_pins(root)
    tracked = tracked_paths(root)

    rows, freed, freed_tracked, pinned_hits, tracked_files = [], 0, 0, 0, 0
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
                size = t_files = 0
                if verdict == "prune":
                    t_bytes, u_bytes, t_files = dir_split(
                        os.path.join(sp, name), root, tracked)
                    size = t_bytes + u_bytes
                    freed += size
                    freed_tracked += t_bytes
                    tracked_files += t_files
                rows.append((rel, verdict, reason, size, stage, t_files))

    prune = [r for r in rows if r[1] == "prune"]
    prune.sort(key=lambda r: -r[3])

    print(f"Buses folder : {root}")
    print(f"Rules        : keep newest {a.keep_outputs} versions of S4/S5, "
          f"newest {a.keep_inputs} of S1/S2, all of S3, all of S6")
    print(f"Pins honoured: {pinned_hits}\n")

    if not prune:
        print("Nothing to prune.")
        return

    print(f"{'MB':>7}  {'git':>4}  {'stage':<12}  run")
    print("-" * 96)
    for rel, _, reason, size, stage, t_files in prune:
        print(f"{size/1048576:7.1f}  {t_files or '':>4}  {stage:<12}  {rel}")
        print(f"{'':7}  {'':4}  {'':12}  -> {reason}")
    print("-" * 96)
    if tracked is None:
        print(f"{freed/1048576:7.1f}  MB total. HOW MUCH OF IT IS IN GIT IS UNKNOWN - "
              f"`git ls-files` could not be run in\n{'':9}this folder, so this tool "
              f"cannot tell you what is recoverable. Do not treat that\n{'':9}as "
              f"'nothing is tracked'. Fix git, or treat every byte as permanent.")
    else:
        print(f"{freed/1048576:7.1f}  MB total")
        print(f"{freed_tracked/1048576:7.1f}  MB IS in git ({tracked_files} tracked "
              f"file(s)) - recoverable from history")
        print(f"{(freed - freed_tracked)/1048576:7.1f}  MB is NOT in git - recoverable only "
              f"from the SyncBack mirror, until its next run")
        if tracked_files:
            # The `git` column above says which runs they are in. Naming the count
            # here rather than only in a column is deliberate: the column is easy
            # to skim past, and this is the sentence that used to be false.
            print(f"\n  {tracked_files} TRACKED FILE(S) WILL BE DELETED FROM THE WORKING TREE.")
            print(f"  git will show them as deletions. Commit that deliberately, or put them")
            print(f"  back with:  git restore <path>   (run from {root})")

    if not a.apply:
        print("\nDRY RUN - nothing deleted. Re-run with --apply to delete.")
        print("Run SyncBack FIRST if you want the mirror to keep the pre-prune state.")
        return

    log = os.path.join(root, "prune-log.jsonl")
    stamp = datetime.datetime.now().isoformat(timespec="seconds")
    with open(log, "a", encoding="utf-8") as fh:
        for rel, _, reason, size, stage, t_files in prune:
            shutil.rmtree(os.path.join(root, rel))
            fh.write(json.dumps({"at": stamp, "run": rel, "stage": stage,
                                 "reason": reason, "bytes": size,
                                 "tracked_files": t_files}) + "\n")
            print(f"deleted  {rel}" + (f"  ({t_files} tracked)" if t_files else ""))
    print(f"\nDeleted {len(prune)} runs, {freed/1048576:.1f} MB. Logged to prune-log.jsonl")
    if tracked_files:
        print(f"\n{tracked_files} TRACKED file(s) are now deleted in the working tree. "
              f"`git status` will show them.\nCommit the deletion deliberately, or "
              f"`git restore` them - do NOT leave them uncommitted, because the next\n"
              f"checkout would bring them back as run folders holding nothing else.")


if __name__ == "__main__":
    main()
