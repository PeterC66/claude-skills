r"""Unwrap hard-wrapped Markdown prose so each paragraph is one continuous line.

The house rule (see ~/.claude/CLAUDE.md) is that a newline in Markdown means a
semantic break -- end of paragraph, next heading, next list item, next table row
-- and never "the line got long". Hard wrapping is invisible to a reader but
corrupts the diff: reflowing one sentence rewrites every following line in the
paragraph, so a one-word change looks like a rewritten section.

Two guards make this safe to run over documents you have not read:

  * YAML frontmatter is passed through untouched. Every line break in it is
    structural, and folding `description:` into `metadata:` silently corrupts the
    file -- which is exactly what an earlier version of this script did to a
    memory file before the guard existed.
  * A file is written only if the word sequence is identical before and after
    (bare `>` blockquote markers excepted, since folding a quote drops them). If
    a join would lose or reorder a word, the file is left alone and the failure
    reported.

Fenced code blocks, tables, headings and two-space hard breaks are never joined.

Usage
-----
    python scripts/reflow_md.py <path> [<path> ...]        # dry run, the default
    python scripts/reflow_md.py --apply <path> [...]       # rewrite in place
    python scripts/reflow_md.py --check <path> [...]       # exit 1 if any file would change

A <path> may be a file or a directory; directories are walked for `*.md`.

Run it from anywhere -- paths are taken as given, relative to your shell's cwd.
Unlike docstamp.py there is no default scope: this is a manual tool and it only
ever looks at the paths you name.

When walking a directory it skips `node_modules`, `.git`, `.venv`, `__pycache__`,
`dist` and `build`, and it also honours the exclusions in `stamp-policy.json` --
so generated stage output and `_latest` are left alone, the same as for stamping.
A file named explicitly on the command line is always processed, exclusions or
not: that is your call to make.

Archived plans and git worktrees are excluded too, via the policy rather than via
this code: `_archive` because a superseded plan is a record with nothing for a
stamp to describe, and `worktrees` because a worktree is a second copy of the
whole repo. Name such a file explicitly if you do want it reflowed.
"""

from __future__ import annotations

import fnmatch
import io
import json
import pathlib
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# A line this long that is followed by more prose was wrapped at a column rather
# than ended deliberately. Below the floor it is a short deliberate line (a
# signature, a one-line answer); above the ceiling it is already unwrapped.
WRAP_LO, WRAP_HI = 60, 112

# starts a new block element, so it is never folded onto the line above
NEW_BLOCK = re.compile(r"^\s*(?:[-*+]\s|\d+[.)]\s|\||#|>|<!--|```|---\s*$|===)")

# Never reformat somebody else's prose when walking a directory. A first run over
# ~/.claude/skills offered to rewrite four node_modules READMEs, semver's by 153
# lines. Name such a file explicitly if you really mean it.
EXCLUDE_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build"}

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import policy as _shared_policy  # noqa: E402

POLICY = pathlib.Path(__file__).resolve().parent.parent / "stamp-policy.json"


def policy_excludes(f: pathlib.Path) -> bool:
    """True if stamp-policy.json says this file is not one of ours to maintain.

    Scope belongs in the policy, not in this code -- the same rule docstamp.py
    follows. Without this, walking the Buses root offers to rewrite generated
    stage reports and archived plans: 41 files where only 3 were live documents.
    """
    if not POLICY.exists():
        return False
    try:
        # Through policy.py, so this tool skips exactly what the stamper skips.
        roots = _shared_policy.load_policy(str(POLICY)).get("roots", [])
    except (json.JSONDecodeError, OSError):
        return False
    for root in roots:
        base = pathlib.Path(root["path"])
        try:
            rel = f.resolve().relative_to(base.resolve())
        except (ValueError, OSError):
            continue
        parts = rel.parts[:-1]
        if set(parts) & set(root.get("excludeDirNames", [])):
            return True
        if any(
            fnmatch.fnmatch(part, pat)
            for part in parts
            for pat in root.get("excludeDirPatterns", [])
        ):
            return True
        if any(
            fnmatch.fnmatch(rel.as_posix(), pat) for pat in root.get("excludeGlobs", [])
        ):
            return True
    return False


def split_frontmatter(lines: list[str]) -> tuple[list[str], list[str]]:
    """Return (frontmatter_inclusive_of_fences, body). Frontmatter is structural."""
    if not lines or lines[0].strip() != "---":
        return [], lines
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return lines[: i + 1], lines[i + 1 :]
    return [], lines  # unterminated: treat the whole file as body


def reflow(text: str) -> str:
    front, lines = split_frontmatter(text.split("\n"))
    out: list[str] = list(front)
    fenced = False
    # The accumulated line grows past WRAP_HI as joins land, so the band has to be
    # judged on the last SOURCE line folded in, not on out[-1]. Getting this wrong
    # leaves long paragraphs folded only part-way.
    src_len = 0

    for raw in lines:
        if raw.lstrip().startswith("```"):
            fenced = not fenced
            out.append(raw)
            src_len = len(raw)
            continue
        if fenced:
            out.append(raw)
            src_len = len(raw)
            continue

        prev = out[-1] if out else ""
        in_band = bool(prev.strip()) and WRAP_LO <= src_len <= WRAP_HI
        unbroken = not prev.endswith("  ") and not prev.rstrip().endswith("|")
        both_quotes = prev.lstrip().startswith(">") and raw.lstrip().startswith(">")

        joinable = (
            raw.strip()
            and in_band
            and unbroken
            and (
                both_quotes
                or (
                    not prev.lstrip().startswith(("|", "#", ">", "<!--"))
                    and not NEW_BLOCK.match(raw)
                )
            )
        )
        if joinable:
            tail = re.sub(r"^\s*>\s*", "", raw) if both_quotes else raw
            out[-1] = prev.rstrip() + " " + tail.strip()
        else:
            out.append(raw)
        src_len = len(raw)

    return "\n".join(out)


def words(text: str) -> list[str]:
    """Word sequence for the conservation check; bare '>' is markup, not a word."""
    return [w for w in text.split() if w != ">"]


def targets(args: list[str]) -> list[pathlib.Path]:
    found: list[pathlib.Path] = []
    skipped = 0
    for a in args:
        p = pathlib.Path(a)
        if p.is_dir():
            for f in sorted(p.rglob("*.md")):
                if set(f.parts) & EXCLUDE_DIRS or policy_excludes(f):
                    skipped += 1
                    continue
                found.append(f)
        elif p.exists():
            found.append(p)  # named explicitly: your call, even inside an excluded dir
        else:
            print(f"SKIP  {a}: no such file or directory")
    if skipped:
        print(f"(skipped {skipped} file(s) in {'/'.join(sorted(EXCLUDE_DIRS))})")
    return found


def main() -> int:
    argv = sys.argv[1:]
    apply = "--apply" in argv
    check = "--check" in argv
    paths = targets([a for a in argv if not a.startswith("--")])
    if not paths:
        print(__doc__.strip().split("Usage")[1])
        return 2

    changed = failed = 0
    for p in paths:
        before = p.read_text(encoding="utf-8")
        after = reflow(before)
        if after == before:
            continue
        nb, na = len(before.split("\n")), len(after.split("\n"))
        if words(before) != words(after):
            failed += 1
            print(f"FAIL  {p}: would lose content -- left untouched")
            for i, (x, y) in enumerate(zip(words(before), words(after))):
                if x != y:
                    print(f"        first divergence at word {i}: {x!r} vs {y!r}")
                    break
            continue
        changed += 1
        print(f"{'REFLOW' if apply else 'would'}  {p}: {nb} -> {na} lines ({nb - na} joins)")
        if apply:
            p.write_text(after, encoding="utf-8", newline="\n")

    print(
        f"---- {len(paths)} file(s): {changed} "
        f"{'reflowed' if apply else 'would change'}, {failed} refused"
    )
    if failed:
        return 1
    return 1 if (check and changed) else 0


if __name__ == "__main__":
    sys.exit(main())
