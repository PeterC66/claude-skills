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

print("\n{}".format("{} CASE(S) FAILED".format(failed) if failed
                    else "The baseline behaves in both directions and all readers agree."))
sys.exit(1 if failed else 0)
