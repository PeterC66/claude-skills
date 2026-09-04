---
name: stamp-docs
description: Keep the bus-system documents (Markdown and PowerPoint) correctly stamped and correctly formatted — a visible version number and last-updated date that refresh themselves, and Markdown paragraphs kept as whole unwrapped lines. Stamping normally runs by itself from a Stop hook after every turn; invoke this skill to check the current state, backfill newly added documents, force a major-version bump after a rewrite, change which documents are in scope, or unwrap hard-wrapped Markdown. Use when asked to check/fix document versions or dates, "what version is this doc", "did the stamp update", "add the new folder to stamping", "bump that doc to v2", or to fix/unwrap/reflow hard-wrapped paragraphs in .md files.
---

# stamp-docs

Every in-scope document carries a version and a last-updated date that is visible when it is viewed or printed, and that refreshes itself whenever the document changes.

## How it already works without you

A **Stop hook** in `~/.claude/settings.json` runs `scripts/docstamp.py --auto` at the end of every turn. It catches files changed by any means — Edit, Write, or a Python/Node script that wrote a `.pptx`. **You do not need to invoke this skill for the stamps to stay current.** If you have just edited a document in scope, the stamp is already handled; say nothing about it.

## The stamp

Version is `major.minor` starting at **v1.0**. An ordinary edit bumps the **minor**; a rewrite deserves `--major`. Dates read `27 July 2026`.

**Markdown** — two lines just after the H1. The HTML comment is invisible in every renderer and is the machine anchor; the bold line is what a reader sees.

```markdown
# Runbook R1 — Create a new area or place map

<!-- docstamp v1.4 | 2026-07-27 | sha=3f9a1c2b -->
**v1.4** · updated 27 July 2026
```

**PowerPoint** — a 9pt text box on every slide, shape-named `docstamp` so a re-run updates it instead of stacking a second one. Position is whichever candidate band is clear on *every* slide (`top-right` preferred); colour flips light or dark from the slide's background luminance. The record lives in the file's core properties.

## Why it is safe to run every turn

The stamp carries a short hash of the document's **own content with the stamp removed** — for a deck, all slide text plus every embedded media blob, so a swapped image counts as a change. If the hash is unchanged the file is **not rewritten at all**, so mtimes never churn and the hook cannot loop. `--auto` also stat-gates on the last run, so an unchanged tree costs about half a second.

## Commands

Every command on this page runs from `stamp-docs` — this skill's own folder in the `claude-skills` repository, where `scripts/` and `stamp-policy.json` sit beside each other. There are no placeholders except the quoted paths, which are the documents or folders to act on.

```bash
python scripts/docstamp.py --check              # audit; exits 1 if anything is missing or stale
python scripts/docstamp.py --list               # what is in scope
python scripts/docstamp.py --backfill           # stamp new documents at v1.0, dated from git
python scripts/docstamp.py --all                # full hash scan, ignoring the mtime gate
python scripts/docstamp.py --major "path/to/doc.md"   # rewrite: v1.4 -> v2.0
python scripts/docstamp.py --minor "path/to/doc.md"   # force a bump
python scripts/docstamp.py --auto               # what the hook runs; always exits 0
```

Add `--dry-run` to any of them, or `--root buses|portal|ops` to narrow.

## Markdown paragraphs

The house rule (`~/.claude/CLAUDE.md`) is that a newline in Markdown means a semantic break — end of paragraph, next heading, next list item, next table row — and never "the line got long". Hard wrapping is invisible to a reader but corrupts the diff: reflow one sentence and every following line in the paragraph is rewritten, so a one-word change reads as a rewritten section.

`scripts/reflow_md.py` unwraps prose that broke the rule. It is a **manual** tool — no hook runs it, and it has no default scope, so it only looks at the paths you name. Run it from `stamp-docs`, and `<path>` is the document or folder to unwrap.

```bash
python scripts/reflow_md.py "<path>"              # dry run, the default
python scripts/reflow_md.py --apply "<path>"      # rewrite in place
python scripts/reflow_md.py --check "<path>"      # exit 1 if anything would change
```

Run from any folder; a `<path>` may be a file or a directory, and directories are walked for `*.md`. It skips `node_modules`, `.git`, `.venv`, `__pycache__`, `dist` and `build`, and honours the exclusions in `stamp-policy.json` so generated stage output is left alone — walking the Buses root drops from 141 candidate files to 97 because of that. A file named explicitly is always processed, exclusions or not.

Three guards make it safe over documents you have not read, and all three exist because the tool got it wrong first:

- **YAML frontmatter is passed through untouched.** An earlier version folded a memory file's `description:` line into `metadata:`, silently corrupting the frontmatter. It was caught by the second guard, on a real file, which is the only reason we know that guard works.
- **A file is written only if the word sequence is identical before and after**, bare `>` blockquote markers excepted since folding a quote drops them. If a join would lose or reorder a word the file is left alone and the failure reported, and `--check` exits 1.
- **Table rows are never joined** — `NEW_BLOCK` matches a leading `|`, and a line whose predecessor *ends* in `|` is not joinable either. This guard is load-bearing and its absence is invisible: an early pass collapsed the whole "Where everything lives" table in two `Buses\Documentation\` READMEs onto one line each, and because the word sequence was preserved the second guard saw nothing wrong. Neither had rendered as a table for weeks, and nobody noticed, because nothing in the workflow opens these files in a renderer. **The word-sequence guard checks that no text was lost; only this one checks that no structure was.** Repaired 2026-08-21.

Two things it does not do: it will not re-wrap (there is no way back), and it does not know a deliberate short line from a wrapped one below 60 characters — signatures, one-line answers and `Hello,` all survive because of that floor, but a genuinely short wrapped line would too.

**Archived documents are out of scope**, as of 17 August 2026 — `_archive` is in the `excludeDirNames` of both the Buses and the portal root (the portal gained a `docs/_archive` on 18 August 2026, and without the exclusion its three superseded docs would be re-stamped forever, a PR each). Neither tool touches superseded plans. Name such a file explicitly if you ever do want it reflowed.

## Scope

`stamp-policy.json` holds it — edit that, not the code. Three roots today: the Buses working folder (`.md` + `.pptx`), the `community-bus-maps` repo (`.md`), and the local-only ops notes (`.md`).

**Exclusions come in two layers, and the top one is shared** (buses-data OA-235, 4 September 2026). `baselineExcludeDirNames` names the directories that are never a document in ANY repository — `.git`, `node_modules`, `worktrees`, `scratch`, `dist`, `coverage`, `build` — and every root inherits it; a root’s own `excludeDirNames` now holds only what is local to it (`_latest` and `open-actions` in Buses, `data`, `staged`, `_archive` and `CHANGELOG.d` in the portal). Before that the three lists were maintained separately and had drifted to sharing only `.git`: `worktrees` was in ONE of them, so **60 of the 90 markdown files the portal root walked were inside `.claude/worktrees/`** — a second and third checkout of the same repository. The measured effect of adding the baseline was 185 in-scope documents down to 155, and all 30 that left were worktree copies, checked one by one rather than assumed.

**The cost was never the wasted work — it is that a stamp is an EDIT.** Two sessions could not both run `--all`: on 3 September 2026 each bumped stamps on documents inside the other’s worktree, neither having touched the other’s files, and the standing rule is *re-stamp a document you edited BEFORE you commit it*, so a stamp arriving from elsewhere is exactly what gets swept into a commit describing something else.

**Two kinds of reason live in that baseline** and it matters which when adding to it: `.git`, `node_modules`, `dist`, `coverage` and `build` are excluded because they are **not documents**; `worktrees` and `scratch` because they are **not ours to write to** — a worktree is full of real documents and the objection is ownership. A directory excluded for a reason peculiar to one repository stays on that root.

**All three tools read the baseline through `scripts/policy.py`, and that is deliberate.** A baseline each of them unioned for itself would be the same write-it-once-per-place fault one level down, with a worse failure mode — two agreeing and the third stamping what the others skip. `scripts/prove_policy.py` asserts the four resolution rules and then asks all three readers for their resolved exclusions and insists they match, with a control that the comparison can notice a disagreement at all. Run it from `stamp-docs`; there are no placeholders:

```bash
python scripts/prove_policy.py
```

**Never stamp generated output.** The stage pipeline already versions its own files by folder name (`S4-generate/v1.3_2026-07-19_0517`) and stamps its reports in the body; the portal's rendered sheets sit under a byte-identical gate that stamping would break. The policy excludes `S[1-6]-*`, `_latest`, `node_modules`, `data/`, and the dated `_gtfs` reports. Adding a root means adding exclusions for whatever it generates.

**A generated report can also exclude ITSELF, and since 2026-08-28 that is the preferred way** (open action OA-096, now closed). Any markdown file whose first 40 lines contain `<!-- generated by ` is skipped, wherever it lives — `generatedMarker` in `stamp-policy.json`. This exists because the path-based rules only ever caught the generated files somebody remembered to name: `stand-coverage_2026-08-22.md` and `frame-coverage_2026-08-23.md` churned in every diff for weeks, the hook inserting a stamp and the next run of their generator deleting it, over a version number that described nothing. Naming those two would have fixed those two — nothing about writing a *third* generator reminds anybody that a policy file in another repository has to learn a new filename. **So when you write a script that emits a markdown report, have it print that marker as its second line.** The report is then excluded on the day it is written, by the person already thinking about it. It is read from the head only, so a document that merely discusses generated reports does not exclude itself by quoting one.

## Committing a stamped document

**When you edit a stamped document, run `docstamp.py --all` and commit the stamp in the same commit as the content.**

The hook fires at **Stop**, i.e. after the turn. Commit mid-turn and the stamp lands afterwards as a separate working-tree change — which you then have to notice, and in `community-bus-maps` ship as its own PR. That is the single real cost of the whole mechanism, and this one habit removes it.

It is less rare than that line used to claim. Measured at one stamp-only commit (`1ac847b`) in the portal’s last 60 as at 2026-08-18 — and it happened twice more on 2026-08-25 alone, both times because a change edited documents inside a PR: the content merged, the hook bumped the stamps seconds later, and `main` was left carrying stamps describing the pre-edit content until a second PR (#98) cleared them. **If your change touches a stamped document, expect a stamp-only commit and land it before you merge** — or run `docstamp.py --all` before the first commit so there is nothing left over.

## The stamp can be correct on disk and wrong in git

`--check` audits the **working tree**. Nothing gates the **commit**, so the hash is content-gated only at *write* time: edit a doc and commit it before the Stop hook next fires, and it goes into git carrying the previous version, date and sha. Anyone reading that file out of the repo — a cold start, a clone, a PR review — sees a stamp that does not describe what they are reading, and it looks exactly as authoritative as a correct one. `--check` cannot see this by construction, because by the time it runs the working tree has already been fixed.

Found 2026-08-17: three of the 44 stamped `.md` in the Buses repo were stale in `HEAD`, one of them (`README - How to enhance the system.md`) claiming *v1.12 · 9 August* over a body that had moved on. Two were hook corrections that had simply never been committed; the third was self-inflicted, by hand-editing a version line without recomputing the hash. All three are fixed.

To audit what is actually committed, hash `HEAD`'s blobs rather than the files on disk:

```bash
python scripts/check_committed_stamps.py            # every stamped .md in HEAD, per repo
```

Read it back rather than assuming: on 2026-08-25 the portal briefly went **3 STALE of 29** in `main` this exact way, and reads 32/32 once the follow-up landed. The checker exits 1 on findings, and **since 2026-08-27 it runs in CI**: the `status` job of `buses-data`'s `.github/workflows/gates.yml` checks out a fourth repository (`claude-skills-personal`, where this skill lives) and runs it over `buses-data` and `community-bus-maps`, naming those two roots explicitly. `CROSS_REPO_PAT2` was widened that day to see the fourth repo; the workflow's preflight now names all three, so a narrowing says so in one line. The third policy root, `community-bus-maps-ops`, is deliberately NOT passed — it is never pushed, a runner has no copy of it, and it holds the estate's one genuinely stale stamp, so judging it from CI would make the step red on day one for a reason nobody could fix. Proven both ways on 2026-08-27: exit 0 on the real corpus (Buses 82/82, portal 32/32 by explicit root), exit 1 on a scratch repository holding one deliberately wrong sha.

### The 16 stale portal docs that were never stale

This file previously recorded, as known-outstanding, that *"`community-bus-maps` has 16 of its 31 stamped `.md` stale in `HEAD`"*, and guessed at squash-merges compounding over many PRs. **That was a bug in the audit tool, not in the stamps.** `check_committed_stamps.py` decoded `HEAD`'s blobs as `utf-8`, keeping the BOM; `docstamp.py`'s `read_text()` strips it before hashing. `str.strip()` does **not** treat `﻿` as whitespace, so the BOM stayed in the hashed body and every BOM-carrying file reported stale. The 16 "stale" files were exactly the repo's 16 BOM'd files; the 15 "correct" were exactly the 15 without.

Fixed 2026-08-18 by decoding `utf-8-sig`. Proof, on `docs/DEPLOY.md` at `HEAD` — which the tool called stale minutes after its stamp was committed in PR #42:

```
BOM stripped (docstamp)  -> 80ce1414   stamp says 80ce1414   correct
BOM kept (old audit)     -> c873552a   stamp says 80ce1414   "stale"
```

The lesson is the expensive part: the tool reported a real-looking failure with per-file hashes attached, and the recommended fix was 16 version bumps pushed to a public repo. **A red audit is a claim about the tool as much as about the data** — reproduce one failing case by hand before acting on a batch.

The audit now also honours the policy's exclusions, so `_archive` and other out-of-scope trees are counted (`N out of policy scope`) rather than judged; previously it graded files the stamper had deliberately stopped maintaining, which would have drifted into fresh false alarms.

**`--staged` did not honour them until 2026-08-31, and the docstring said it did.** The exclusions were applied on the HEAD path and not on the index path, and nothing revealed it for two days because **the only way to reach the bug is to EDIT an archived document** — archiving has always been a pure `git mv`, which changes no content, so a stale stamp never arose there. Then a documentation round in `buses-data` repointed the links inside nine files it was archiving, and the pre-commit hook refused the commit over nine documents this stamper deliberately refuses to stamp. **An unsatisfiable refusal is worse than no check**: it names a fix that cannot be carried out, and the only way past it is `--no-verify`, which is a habit that does not come back. Both halves were proved after the fix — an in-scope document with a stale stamp is still refused, and an out-of-policy one is skipped.

**And the same bug was one level out, in CI, where the fix above does not reach.** `gates.yml` audits by NAMED path — `check_committed_stamps.py "$GITHUB_WORKSPACE/buses-data" …` — and a named repo was documented as *audited without exclusions*, because the policy config travels with the policy ROOTS and a CI checkout is at a path no root has. So the local hook went quiet and CI went red about the same nine files, on the same push. Policy roots now carry **`checkoutDirNames`**: the names the same repository goes by when it is checked out elsewhere (`buses-data`, `community-bus-maps`). A named path matches on the absolute path first, then on that list. **A repo matching nothing is still audited with no exclusions and now SAYS so on its summary line**, because a silent filter is the worse of the two failures — that is the half worth keeping if this is ever rewritten. Falsified in a throwaway repo with one stale `_archive/` file and one stale `Documentation/` file: named `buses-data` it reports 1 STALE and 1 out of policy scope, and renamed to anything else it reports 2 STALE and prints the warning.

## Gotchas

- **Decks are git-ignored** (`*.pptx` in the Buses `.gitignore`), so git is no safety net and a git-status trigger would not see them at all. Copy them somewhere before a first stamp of a new deck, and verify afterwards that slide count, text blocks and media parts are unchanged.
- **A stamped deck's exported PDF goes stale**, and there is no LibreOffice or pandoc on this machine to regenerate it. Re-exporting is manual in PowerPoint.
- **`--backfill` dates from git**, not today, so a first stamp tells the truth about when the document last actually changed. **It only does this for documents with no stamp yet** — that restriction was missing until 2026-08-21, and a backfill run for one new README re-dated four documents edited the same morning to the day before, because an already-stamped file only reaches the stamping code when its content just changed and its git date is therefore the *previous* commit. If you are backfilling in a session where you have also edited stamped documents, `--check` afterwards will not catch it (the sha is still correct — only the date is wrong); read the visible dates.
- **The stamp says a document changed; it cannot say the documents pointing AT it are still true.** Found 2026-08-22: `Development Docs/open-actions.md` was deliberately cut from 400 lines to 81 on 2026-08-20, and five places still sent a reader there for narrative and section headings it no longer carried — three other Development Docs, `community-bus-maps/CLAUDE.md`, and the project memory index. **Every one of those links still resolved**, so a link checker would have passed all five; only the content behind them had gone. When you cut content out of a document, grep the doc sets and both memory stores for its filename *and* for the headings you are removing, and repoint each hit. Where the content went to git history, name the commit SHA rather than "the version before the tidy-up" — open-actions.md now cites `546cd62` with the exact `git show` command and the folder to run it from. **A link checker over these doc sets now exists** — built 2026-08-27, and not here: it is `Documentation/check-doc-links.mjs` in `buses-data`, run from that repository's root and wired into the `docs` job of its `gates.yml`. It covers three of the four classes: a dead path, a dead `#anchor`, and a `§n` the named target does not have — plus a link that climbs OUT of the repository, which resolves on the machine that wrote it and 404s for every other reader. It deliberately does NOT judge a citation by phrase, because there is no syntax to anchor that on; that residue is `open-actions` **OA-139**, and the mitigation stays the paragraph above this one. Its first run found **79** dead links, 77 of them from a document split made the same morning.
- Existing metadata lines such as `**Last reviewed:** … **Against:** 0.8.1` mean something different (reviewed against a code version). Leave them; the stamp sits above and both coexist.

