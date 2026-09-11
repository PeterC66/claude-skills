# `tools/` — checks that belong to no single skill

Everything else in this repository is a skill. This folder is for a check that **three repositories run against themselves**, which is why it cannot live inside one of them and why it cannot live in the repository it was written in.

## What is here

| File | What it does |
|---|---|
| [`check-file-hygiene.mjs`](check-file-hygiene.mjs) | Finds layout faults that confound an *edit* rather than a reader: a byte-order mark, a file carrying two kinds of line ending, trailing whitespace, a missing final newline, a run of blank lines |
| [`check-tables.mjs`](check-tables.mjs) | Every markdown table is still a table — a row that ran on into its neighbour, a row with the wrong number of cells for its header, a row stranded past the end of the table it belongs to |
| [`check-doc-links.mjs`](check-doc-links.mjs) | Dead paths, dead `#anchors`, `§n` citations into a document that has no such section, links whose target git IGNORES — on this disk and in no checkout — and whether every documented command says which folder to run it from and names a script that exists |
| [`check-doc-acronyms.mjs`](check-doc-acronyms.mjs) | Every short form a reader MEETS is one they can look up — in a declared definitions document, in a bracketed expansion in the document that uses it, or in the repository's own `.doc-acronyms.json`. The only check here that is about **comprehension** rather than structure, and the one no widening of the other two could ever have reached. buses-data OA-300 |
| [`prove-red-doc-acronyms.mjs`](prove-red-doc-acronyms.mjs) | 21 cases. Each of the three recognisers is watched ACCEPT a real definition and REFUSE a near miss, because widening what counts as *already defined* silences the finding that should have fired. Case 2 is the design that almost shipped: with no threshold on the word rule, a single lower-case `ep` in the estate made `EP` an ordinary English word |
| [`lib/tracked-docs.mjs`](lib/tracked-docs.mjs) | Asks `git ls-files` which markdown a repository actually tracks, so neither checker's corpus has to be written down — and **throws rather than returning an empty list**, because a check that cannot find its subject must not report clear |
| [`lib/repo-root.mjs`](lib/repo-root.mjs) | Which repository a checker is ABOUT, asked of `git rev-parse --show-toplevel` rather than read off `process.cwd()`. Every checker here used to take the folder it was started in, which is the same thing only when you happen to be standing at the root — see [Which repository a checker is about](#which-repository-a-checker-is-about) |
| [`prove-red-file-hygiene.mjs`](prove-red-file-hygiene.mjs) | Breaks each hygiene fault on purpose and insists the checker notices — and breaks each **exemption** on purpose and insists it does not. 26 cases |
| [`prove-red-tables.mjs`](prove-red-tables.mjs) | Glues rows together, strands one past its table, and asserts WHICH test objected — plus the row and document COUNTS, because coverage was that checker's own bug twice |
| [`prove-red-doc-links.mjs`](prove-red-doc-links.mjs) | Breaks each of the five link checks on purpose, with a control that exercises every one correctly and must stay green |
| [`check-exclusion-fields.mjs`](check-exclusion-fields.mjs) | A town says *we know about this route and deliberately do not draw it* in `notOnLeaflet[]`. Three older spellings are still READ for ever and may no longer be WRITTEN; this fails a repository whose town files still write one, at the LATEST S1 run of each map only |
| [`prove-red-exclusion-fields.mjs`](prove-red-exclusion-fields.mjs) | Builds a throwaway git repository per case and breaks the gate on purpose. Its load-bearing case is that a SUPERSEDED S1 run is left alone: an older run is a dated record, and a gate demanding it be rewritten would argue with the reason the aliases are read at all. 26 assertions |
| [`check-s6-claims.mjs`](check-s6-claims.mjs) | Every S6 **claim** — a red-team claim about a SERVICE rather than artwork — has a home: the map's own `notOnLeaflet[]` or `redteamRejected[]`, its parent town's file, an entry in `service-facts.json` at the repository root, or — last — the map's own `badgeLabels`, which joins the badge a sheet PRINTS to the key an operator REGISTERED and reports the claim ALIASED rather than uncovered; and the register contradicts no map — a decided fact whose scope names a map that is silent about the route is red, unless that same join says the map carries it under the other spelling. The coverage half reads `verification.json`, which is gitignored, so it runs on the laptop (`status.js`, and the `bus-work` worklist with `--require-reports`); CI runs `--register-only` and says so. buses-data OA-273 |
| [`prove-red-s6-claims.mjs`](prove-red-s6-claims.mjs) | Builds a throwaway estate per case. Its load-bearing cases are that a place's claim about a route its PARENT TOWN already decided is covered — what turned 100 claims into 20 the day it was measured — and that a decided register entry over a SILENT map is red even when every claim has a home. Also proves the split: a tree with no S6 report is green under `--register-only` and red under `--require-reports`, and a tree that is no repository answers `notARepository` under `--json` so a board can tell it from a crash. The badge-alias case added on 2026-09-11 carries three controls before its first positive, because its dangerous direction is real: Wisbech prints "46" for `46L` and also carries a genuine `46`, so a label can be a live key on the same map. Read the assertion count off the run |

**The fourth checker is not about documents at all**, and that is deliberate rather than untidy. `check-exclusion-fields.mjs` reads `verified-services.json` — bus data, in `buses-data` — and lives here for the same reason as the other three: this repository is public, so nothing has to fetch it across a token. Its rule is shared (both engine readers agree on which field is canonical) while its subject belongs to one repository, so the CHECKER runs from buses-data's own `gates.yml` and the HARNESS from this one's. That split is buses-data OA-218's rule applied twice in one change: a check belongs in the suite that fires when its subject changes.

## Why it lives here and not where it was written

All of them were written in **buses-data**, which is **private**. `community-bus-maps` and this repository are **public**. A private checker cannot be run by a public repository's CI without a cross-repo token — and hanging a shared check off `CROSS_REPO_PAT2`, which expires on **22 November 2026**, means one date on which the same check stops in two repositories at once. `check-file-hygiene.mjs` moved first (buses-data OA-241, 2026-09-04); `check-tables.mjs`, `check-doc-links.mjs` and their harnesses followed the same day (buses-data OA-246). All three repositories now run all three checkers with **no secret at all**, and nothing in this folder is fetched across a token.

The direction is the point: **a shared rule belongs in the repository anyone can read.**

## The rule travels; the exemptions stay home

A checker three repositories run must not carry one repository's exclusion list — nor its folder names — which is the shape OA-222 named, *a copy is a checker owning someone else's rule*, arrived at from the other side. So each repository declares its own at a **dotfile at its root**, and each checker resolves that root from the repository it is RUN FROM (the one ENCLOSING the folder it was started in, or the `--root` it was given) rather than from where the checker itself sits.

`check-file-hygiene.mjs` reads `.file-hygiene.json`:

```json
{
  "neverRead": ["(^|/)ci-reference/"],
  "notAuthored": [["/S[1-6]-[a-z]+/", "generated stage output"]],
  "notOurs": { "docs/imported.md": "a converted PDF kept verbatim" }
}
```

- **`neverRead`** — byte-exact corpora, out of scope *entirely* rather than merely exempt. Reading them at all invites a later session to "fix" a fixture whose whole purpose is to be compared byte for byte.
- **`notAuthored`** — regular expressions. Lifts the house-style tier only. Generated output belongs to its generator and an edit here would be undone by the next run; an archived plan or a correspondence message is a *record*, where tidying is worse than the untidiness.
- **`notOurs`** — named file by file, with a reason each. **A stale entry is a hard error**, so a document that leaves cannot leave an exemption behind.

A repository with no such file gets the bare rules, which is the right default for one nobody has thought about yet. It is deliberately not "everything is exempt", and the harness asserts that.

`check-tables.mjs` reads **`.doc-tables.json`** and `check-doc-links.mjs` reads **`.doc-links.json`**, in the same spirit:

```json
{ "dirs": ["Documentation", "Development Docs"],
  "enumerate": [{ "dir": "Correspondence", "subdirs": "^CORR-\\d+$" }],
  "excluded": { "imported/converted.md": "a converted PDF kept verbatim" } }
```

```json
{ "dirs": ["Documentation", "BusMapsUK"], "files": ["CLAUDE.md"],
  "resolveFromRoot": ["CHANGELOG.d"] }
```

- **`dirs`** — the folders to scan. `check-tables.mjs` scans each flat; `check-doc-links.mjs` walks each, reading any `_archive` beneath one for LINKS ONLY, because an archived plan's claims are a record of what was said rather than something to re-litigate.
- **`enumerate`** — a folder plus a pattern for its immediate subfolders. It exists for the shape a list cannot describe: buses-data's `Correspondence/` grows a `CORR-nnn/` whenever somebody answers an email, and nobody would remember to add one to a checker.
- **`excluded`** / **`resolveFromRoot`** — one imported document that is not ours to fix, and the paths whose links resolve from the repository ROOT because that is where the assembled page renders.

`check-doc-acronyms.mjs` reads **`.doc-acronyms.json`**, which is the same shape with two fields the others have no use for:

```json
{ "dirs": ["Documentation", "BusMapsUK"],
  "definitions": ["Documentation/README - Glossary of terms.md"],
  "defined": { "SSE": "School for Social Entrepreneurs" },
  "notAbbreviations": [{ "reason": "standard computing vocabulary", "tokens": ["JSON", "HTML"] }] }
```

- **`definitions`** — the documents whose TABLE ROWS define a short form: first cell the form, second what it stands for. A row with an empty second cell defines nothing, because naming a term is not expanding it.
- **`defined`** — a short form with no natural document home, given one here. buses-data uses it for a term expanded in two live documents and used bare in an archived one, since an archived plan is a record of what was said rather than something to re-edit.
- **`notAbbreviations`** — **the load-bearing half**, and the reason it is a list of GROUPS rather than a map of tokens. A token listed here vanishes from the count, so a group states the judgement once and lists what it covers; eighty separate one-line reasons would be eighty copies of ten sentences, and a reader should be able to disagree with a judgement rather than with a token. A token in two groups is a hard error, because two different reasons for the same exclusion means one of them is wrong.

**And whatever git knows about is added on top, declared or not.** Every directory or file holding a tracked `.md` that the declaration does not already reach joins the scan, so **a repository that declares nothing gets the WIDEST scope, not the narrowest** — its whole tracked corpus. That is deliberate rather than convenient: `check-tables.mjs`'s own bug, twice, was COVERAGE — a confident total over a population smaller than the truth — and a scope that can only be got wrong by ADDING a folder is the one shape that fault cannot take.

**`--root` names a TREE, not a scope.** It scans exactly that tree and ignores `dirs`/`files` — but it still reads that tree's own declaration, and getting that wrong is the one fault the move produced. Read as *this is a fixture, not a repository*, it dropped the portal's `resolveFromRoot` and reported 24 live links dead, with every harness case green because their fixtures genuinely have no declaration. There is now a case where the tree named by the flag DOES carry one.

## Which repository a checker is about

**It is the repository ENCLOSING the folder you started it in, not that folder** (buses-data OA-275 step 2, 2026-09-08). Until then all five checkers took `ROOT = process.cwd()`, which reads as *the repository I am standing in* and is only the same thing at the root. Standing one folder down, `git ls-files` answers about that folder alone — and a corpus that quietly shrank is this family of checkers' own recorded bug, arrived at here through the shell instead of through a scope list.

**It was found by accident and every verdict it produced was plausible.** Run from `Areas/Beaconsfield`, `check-s6-claims.mjs` reported *2 map(s) tracked; register: ABSENT; 11 claim(s) — UNCOVERED 11*; run from the repository root, on the same commit, minutes apart, *20 map(s) tracked … every claim has a home*. Nothing in the first says you are looking at one map out of twenty. Run from `make-bus-leaflet/`, `check-doc-links.mjs` reported ten findings that did not exist; it now reports this repository's 45 documents and none of them. And `check-exclusion-fields.mjs` — the gate about a whole map estate — exited **0 over zero maps**, which is the same fault pointing the other way and the more dangerous one.

**The collision is guaranteed rather than unlucky.** `stage.js`, `redteam_source.js`, `verify_report.js` and `gen_verification_docx.py` take their cwd as their SUBJECT and have no directory argument, so every S1–S6 call is made from a map or a run folder and leaves the shell there. Any session that runs a stage and then a checker was reading a narrowed corpus.

`git rev-parse --show-toplevel` rather than a walk looking for `.git`: it is the same question `git ls-files` answers moments later, so the two cannot disagree; it is right about a worktree, where `.git` is a file; and it honours `GIT_DIR`, which is set for every command a git hook runs. With no enclosing repository the subject falls back to the cwd exactly as before, and each checker's own precondition then speaks — `lib/tracked-docs.mjs` throws rather than reporting clear, and `check-s6-claims.mjs` exits 2 saying `notARepository`.

**`--root` and `--tree` are untouched.** They name a TREE rather than a repository, they are what the harnesses drive over a temp folder that is no repository at all, and a flag that quietly resolved somewhere else would be the same fault in a new place.

**Every harness gained a case, and the point of each is that it starts somewhere else.** Every case written before this ran at the repository root, where the two readings cannot differ — so the whole suite was blind to it, and being blind is not the same as being green. Each new case was watched go red against the old one-line behaviour before the fix was believed: `prove-red-tables` and `prove-red-doc-links` fall to a clean pass over one document, `prove-red-file-hygiene` to a clean pass over one file, `prove-red-s6-claims` to *0 map(s) tracked; register: ABSENT*, and `prove-red-exclusion-fields` to **exit 0 over an empty estate**.

## Two tiers, and why the split is not softness

**Tier 1 — a BOM, and mixed line endings — applies to every tracked text file** and cannot be exempted except by `neverRead`. Neither is ever the content somebody meant. The one carve-out is a **PowerShell script**, where a BOM is load-bearing: Windows PowerShell 5.1 reads a BOM-less file as ANSI, so the first em dash added to a message string would be mangled at run time. That is a fact about PowerShell rather than a repository's preference, so it is in the checker.

**Tier 2 — trailing whitespace, blank runs, a final newline — applies only to what a repository claims as its own.** A gate that is red on day one about files nobody may touch is a gate somebody mutes in its first week.

## The half that CI cannot run, and must not be deleted for it

`--staged` narrows the check to the files in the commit in front of you, and it is a **pre-commit hook's** flag. **Mixed line endings are a property of a working tree and of nothing else**: with `core.autocrlf=true` and `text=auto`, the index normalises to LF the moment a file is staged, so a file with CRLF at the top and LF at the bottom produces a *clean diff* — and `actions/checkout` then builds a uniform tree, so CI sees nothing either. In CI that check cannot fire and is not meant to. **Do not delete it on noticing CI never reports it**; it is the check the whole thing was opened about.

One rule comes with `--staged`: anything asserting a property of the whole **corpus** must not run under it. The stale-exemption error is gated off for exactly that reason — written without the gate, the hook refused every commit in any repository but the checker's own.

## Running them

Run each from anywhere inside whichever repository you are checking — **the repository enclosing the folder you run it in is what decides what it reads**, which since OA-275 is no longer the same as that folder — and the paths below are real paths on this machine, not placeholders:

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-file-hygiene.mjs"
```

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-tables.mjs"
```

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-doc-links.mjs"
```

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-doc-acronyms.mjs"
```

**That last one is now a gate in TWO repositories and one remains.** It was green in buses-data and run by hand everywhere else until 2026-09-11, when this repository's own round cleaned or excused its corpus and the two steps went into [`gates.yml`](../.github/workflows/gates.yml)'s `unit` job — the harness first, the check after `check-doc-links.mjs`, both under the `if: ${{ !cancelled() }}` every documentation step here carries. The 69 short forms with nowhere to look across these 45 documents are now 24 definitions in [`.doc-acronyms.json`](../.doc-acronyms.json) and six judgement groups; **it declares no `dirs`, which is the widest scope and not an omission**, exactly as this repository declares no `.doc-tables.json` and no `.doc-links.json`. **The portal is the one left** — 66 short forms across its 153 documents, no glossary and no declaration — and it is a round of its own, because the corpus is cleaned or excused BEFORE the gate lands, never after, since a gate that is red on day one is one somebody mutes in its first week.

`check-tables.mjs` also takes `--tree <dir>`, which walks and checks each folder it finds, each one flat. That is how this repository is checked, because it nests its documents two deep and grows a folder whenever a skill is added; `--root` stays flat because `prove-red-tables.mjs` drives it and asserts an exact row count.

Falsify them first, which is the order to use because a checker pointed at a new corpus is exactly when one that has quietly stopped objecting looks identical to a clean tree. Run these from the repository root (`C:\u3a St Ives\.claude\skills`), with no placeholders:

```bash
node tools/prove-red-file-hygiene.mjs
```

```bash
node tools/prove-red-tables.mjs
```

```bash
node tools/prove-red-doc-links.mjs
```

```bash
node tools/prove-red-doc-acronyms.mjs
```

`--root <dir>` points it at another checkout. `--staged` is the hook's form. An unknown flag is refused by name with exit 2, never ignored. Exit `0` clean, `1` findings, `2` used wrongly or its own preconditions unmet.
