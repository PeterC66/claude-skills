#!/usr/bin/env python3
"""Falsify the shared exclusion baseline, and ask the question that actually bites.

Run from `stamp-docs` — this skill's own folder in the `claude-skills` repository.
No placeholders:

    python scripts/prove_policy.py

WHY THIS EXISTS (buses-data OA-235). `baselineExcludeDirNames` is a scope rule,
and a scope rule that goes wrong goes wrong SILENTLY: the tools keep working and
quietly cover a different set of files. That is this project's most-repeated
failure shape — a confident total over a population nobody checked — and
`check-tables.mjs` has produced it twice.

THE CASE WORTH HAVING IS THE LAST ONE. Three scripts read these exclusions:
docstamp.py stamps, check_committed_stamps.py audits what is committed, and
reflow_md.py unwraps. If two of them fold the baseline in and the third does not,
the stamper skips a worktree the auditor then reports as unstamped — and the
disagreement shows up as a puzzling CI finding rather than as an error. A claim
that three readers agree is a claim about a JOIN, and only the JOIN can check it.
So case 5 asks all three for their resolved exclusions and insists they match.

Exits non-zero and names the case that failed.
"""

import json
import os
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import policy as sp                       # noqa: E402
# IMPORTED AT THE TOP, AND THAT IS NOT TIDINESS. `reflow_md` replaces sys.stdout
# with a fresh utf-8 TextIOWrapper over the same buffer at import time, so
# importing it half way down this file ORPHANS everything already written and not
# yet flushed -- the first four cases printed nothing at all, while still being
# run and still counted. A harness that loses its own output is the shape it
# exists to catch.
import docstamp                           # noqa: E402
import check_committed_stamps as audit    # noqa: E402
import reflow_md                          # noqa: E402

failed = 0


def report(ok, line):
    global failed
    if not ok:
        failed += 1
    print("  {} {}".format("OK  " if ok else "MISS", line))


def write_policy(doc):
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh)
    return path


def root(name, excludes=None, path="C:/nowhere"):
    return {"name": name, "path": path, "extensions": [".md"],
            "excludeDirNames": list(excludes) if excludes is not None else [],
            "excludeDirPatterns": [], "excludeGlobs": []}


print("The baseline, broken on purpose and asserted in both directions:\n")

# 1. A root that names nothing still inherits the baseline. This is the `ops`
#    root, which excluded only .git and was one `npm install` from the fault.
p = write_policy({"baselineExcludeDirNames": [".git", "node_modules"], "roots": [root("bare")]})
got = sp.load_policy(p)["roots"][0]["excludeDirNames"]
os.unlink(p)
report(got == [".git", "node_modules"], "a root that names nothing inherits the baseline — got {}".format(got))

# 2. A root's own entry survives, and is not replaced by the baseline.
p = write_policy({"baselineExcludeDirNames": [".git"], "roots": [root("local", ["open-actions"])]})
got = sp.load_policy(p)["roots"][0]["excludeDirNames"]
os.unlink(p)
report(got == [".git", "open-actions"], "a root's own entry survives beside the baseline — got {}".format(got))

# 3. An entry in both is not doubled. Harmless to a set, but the list is printed
#    and read by people, and a duplicate reads as a mistake.
p = write_policy({"baselineExcludeDirNames": [".git", "node_modules"],
                  "roots": [root("dup", ["node_modules", "data"])]})
got = sp.load_policy(p)["roots"][0]["excludeDirNames"]
os.unlink(p)
report(got == [".git", "node_modules", "data"], "an entry in both lists appears once — got {}".format(got))

# 4. NO baseline key at all leaves every root exactly as written. A policy file
#    from before 2026-09-04, or one written by hand, must not change meaning.
p = write_policy({"roots": [root("old", [".git", "_archive"])]})
got = sp.load_policy(p)["roots"][0]["excludeDirNames"]
os.unlink(p)
report(got == [".git", "_archive"], "a policy with no baseline is unchanged — got {}".format(got))

# 5. THE ONE THAT MATTERS. All three readers must resolve the same exclusions for
#    the same root, on the REAL policy file. Asked of each tool through its own
#    code path rather than by reading the JSON again here, which would prove
#    nothing about what the tools do.
print("\nThe three readers, asked the same question:\n")
real = sp.DEFAULT_POLICY
by_name = {}
by_name["policy.py"] = {r["name"]: sorted(r["excludeDirNames"]) for r in sp.load_policy(real)["roots"]}
by_name["docstamp.py"] = {r["name"]: sorted(r["excludeDirNames"]) for r in docstamp.load_policy(real)["roots"]}
by_name["check_committed_stamps.py"] = {
    cfg.get("name"): sorted(cfg.get("excludeDirNames", [])) for _, cfg in audit.repos_from_policy()}
by_name["reflow_md.py"] = {
    r["name"]: sorted(r.get("excludeDirNames", []))
    for r in sp.load_policy(str(reflow_md.POLICY))["roots"]}

names = sorted(set().union(*[set(v) for v in by_name.values()]))
for name in names:
    seen = {tool: v.get(name) for tool, v in by_name.items() if name in v}
    values = list(seen.values())
    agree = all(v == values[0] for v in values)
    report(agree, "root '{}' — {} reader(s) agree{}".format(
        name, len(seen), "" if agree else ": " + json.dumps(seen)))

# And the control: the join must be capable of noticing a disagreement at all.
faked = {t: dict(v) for t, v in by_name.items()}
first = names[0]
faked["docstamp.py"][first] = sorted(faked["docstamp.py"][first] + ["a-directory-nobody-declared"])
vals = [v[first] for v in faked.values() if first in v]
report(not all(v == vals[0] for v in vals),
       "the comparison above notices a reader that disagrees — the control")

# --------------------------------------------------------------------------- checkout
# `--checkout` retargets ONE root at the tree you are standing in, which is how a
# session in a worktree stamps its own documents without a hand-rolled policy copy.
# It is the one feature here that deliberately points a WRITER at a path the policy
# does not name, so the case that matters is the REFUSAL: an unmatched directory
# must stop, not get stamped with no exclusions. `check_committed_stamps.py` takes
# the opposite default on purpose because it only reads -- see resolve_checkout().
print("\nWhere --checkout will let a stamp land:\n")


def git(*args, cwd=None):
    subprocess.run(["git"] + list(args), cwd=cwd, check=True,
                   capture_output=True, text=True)


def real_repo(tmp, name):
    """A REAL git repository, not a directory shaped like one.

    The first version of this fixture wrote a `.git` file by hand with the right
    `gitdir:` line in it, and `git rev-parse --git-common-dir` refused it — a linked
    worktree is also an entry under the main checkout's `.git/worktrees/`, which no
    amount of writing the leaf file creates. It failed the case it was written to
    prove, which is the fixture being honest; `git worktree add` is used below.
    """
    d = pathlib.Path(tmp) / name
    d.mkdir(parents=True)
    git("init", "-q", ".", cwd=d)
    (d / "seed.txt").write_text("seed\n", encoding="utf-8")
    git("add", "-A", cwd=d)
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init", cwd=d)
    return d


with tempfile.TemporaryDirectory() as tmp:
    main = real_repo(tmp, "known-repo")
    wt = pathlib.Path(tmp) / "oddly-named-tree"
    git("worktree", "add", "-q", "--detach", str(wt), cwd=main)
    stranger = real_repo(tmp, "stranger")
    pol = {"baselineExcludeDirNames": [".git"],
           "roots": [root("known", ["local-only"], path=str(main))]}

    # 1. The ordinary case: the checkout IS the configured root.
    p = docstamp.load_policy(write_policy(pol))
    name, how = docstamp.resolve_checkout(p, str(main))
    report(name == "known" and how == "configured path",
           "a configured root resolves to itself — got {!r} via {!r}".format(name, how))

    # 2. The case this was built for: a worktree whose NAME nothing could have
    #    guessed, resolved through git rather than through a list.
    p = docstamp.load_policy(write_policy(pol))
    name, how = docstamp.resolve_checkout(p, str(wt))
    retargeted = next(r["path"] for r in p["roots"] if r["name"] == "known")
    report(name == "known" and how.startswith("worktree of")
           and os.path.normcase(retargeted) == os.path.normcase(str(wt)),
           "a worktree resolves by git common-dir and retargets the root — got {!r}".format(how))

    # 3. It inherits that root's exclusions rather than running with none — the
    #    whole reason an unmatched tree is refused below.
    excl = next(r["excludeDirNames"] for r in p["roots"] if r["name"] == "known")
    report(".git" in excl and "local-only" in excl,
           "the retargeted root keeps baseline + its own exclusions — got {}".format(sorted(excl)))

    # 4. THE CONTROL. An unmatched tree must REFUSE. Without this the feature is a
    #    licence to stamp any directory on the disk with no exclusions at all.
    p = docstamp.load_policy(write_policy(pol))
    try:
        docstamp.resolve_checkout(p, str(stranger))
        report(False, "an unmatched checkout is REFUSED — the control (it was accepted)")
    except SystemExit as e:
        report("Refusing" in str(e), "an unmatched checkout is REFUSED — the control")

    # 5. ...and --root is the way past it, so the refusal is a prompt and not a wall.
    p = docstamp.load_policy(write_policy(pol))
    name, _how = docstamp.resolve_checkout(p, str(stranger), only_root="known")
    report(name == "known", "--root names the policy for an unmatched tree — got {!r}".format(name))

print("\n{}".format("{} CASE(S) FAILED".format(failed) if failed
                    else "The baseline behaves in both directions, all readers agree, "
                         "and --checkout refuses what it cannot place."))
sys.exit(1 if failed else 0)
