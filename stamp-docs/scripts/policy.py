"""Load stamp-policy.json, with the shared exclusion baseline already folded in.

WHY THIS FILE EXISTS (buses-data OA-235, 2026-09-03/04). Every root in
stamp-policy.json used to carry its OWN complete `excludeDirNames`, and the three
lists had drifted apart in exactly the way three hand-maintained copies of one
idea always do:

    buses   .git  _archive  _latest  node_modules  open-actions  worktrees
    portal  .git  CHANGELOG.d  _archive  coverage  data  dist  node_modules  staged
    ops     .git

`node_modules` was in two of the three and `_archive` in two of the three;
`worktrees` was in ONE. So of the 90 markdown files the portal root walked, 60
were inside `.claude/worktrees/` -- a second and third checkout of the same
repository, each document stamped three times.

AND THE COST IS NOT THE WASTED WORK, IT IS THAT A STAMP IS AN EDIT. Two sessions
cannot both run `--all`. On 2026-09-03 `buses-62` ran it from its worktree and
bumped the stamp on another session's in-flight `CLAUDE.md`; that session ran it
from the main checkout and bumped four documents inside buses-62's worktree.
Neither had touched the other's files. The standing rule in this system is
"re-stamp a document you edited BEFORE you commit it", so a stamp arriving from
elsewhere is precisely the change that gets swept into a commit describing
something else. `ops` excludes nothing but `.git` and is one `npm install` away
from the same fault.

THE FIX IS A BASELINE, NOT A LONGER LIST. Adding `worktrees` and `scratch` to the
portal root takes ten seconds and fixes today; it does not fix the reason the list
was wrong, which is that the same class of directory has to be named once per
root. `baselineExcludeDirNames` is the list of directories that are never a
document in ANY repository, and every root inherits it. A root's own
`excludeDirNames` now holds only what is genuinely local to it -- `_latest` and
`open-actions` in buses, `CHANGELOG.d`, `data` and `staged` in the portal.

TWO KINDS OF REASON LIVE IN THAT BASELINE, and it is worth knowing which is which
when adding to it. `.git`, `node_modules`, `dist`, `coverage` and `build` are
excluded because they are NOT DOCUMENTS. `worktrees` and `scratch` are excluded
because they are NOT OURS TO WRITE TO -- a worktree is full of real documents and
the objection is ownership. Both belong here because both are true of every
repository; a directory excluded for a reason peculiar to one repository does not.

`git check-ignore` was considered as an automatic rule -- refuse to touch any path
git ignores, which would have caught `scratch/` without anybody listing it -- and
rejected. It would stop the stamper working in a fresh clone before its first
commit, and it costs a subprocess per path. `scratch` is in the baseline instead,
which covers the case that prompted the idea.

AND WHY A MODULE RATHER THAN A KEY THE CALLERS EACH REMEMBER TO READ. Three
scripts read these exclusions -- docstamp.py, check_committed_stamps.py and
reflow_md.py -- and a baseline that each one has to union for itself is the same
"written once per place" fault one level down, with a worse failure mode: two of
them would agree and the third would stamp what the others skip. They all call
load_policy() here, so the union happens once.
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_POLICY = os.path.join(os.path.dirname(HERE), "stamp-policy.json")


def load_policy(path=None):
    """Return the policy with every root's excludeDirNames unioned with the
    shared baseline. Order is preserved (baseline first, then the root's own)
    so that a printed list reads the way the file does."""
    path = path or DEFAULT_POLICY
    with open(path, "r", encoding="utf-8") as fh:
        policy = json.load(fh)
    baseline = list(policy.get("baselineExcludeDirNames", []))
    for root in policy.get("roots", []):
        own = [n for n in root.get("excludeDirNames", []) if n not in baseline]
        root["excludeDirNames"] = baseline + own
    return policy
