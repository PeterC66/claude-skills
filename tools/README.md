# `tools/` — checks that belong to no single skill

Everything else in this repository is a skill. This folder is for a check that **three repositories run against themselves**, which is why it cannot live inside one of them and why it cannot live in the repository it was written in.

## What is here

| File | What it does |
|---|---|
| [`check-file-hygiene.mjs`](check-file-hygiene.mjs) | Finds layout faults that confound an *edit* rather than a reader: a byte-order mark, a file carrying two kinds of line ending, trailing whitespace, a missing final newline, a run of blank lines |
| [`check-tables.mjs`](check-tables.mjs) | Every markdown table is still a table — a row that ran on into its neighbour, a row with the wrong number of cells for its header, a row stranded past the end of the table it belongs to |
| [`check-doc-links.mjs`](check-doc-links.mjs) | Dead paths, dead `#anchors`, `§n` citations into a document that has no such section, and whether every documented command says which folder to run it from and names a script that exists |
| [`lib/tracked-docs.mjs`](lib/tracked-docs.mjs) | Asks `git ls-files` which markdown a repository actually tracks, so neither checker's corpus has to be written down — and **throws rather than returning an empty list**, because a check that cannot find its subject must not report clear |
| [`prove-red-file-hygiene.mjs`](prove-red-file-hygiene.mjs) | Breaks each hygiene fault on purpose and insists the checker notices — and breaks each **exemption** on purpose and insists it does not. 24 cases |
| [`prove-red-tables.mjs`](prove-red-tables.mjs) | Glues rows together, strands one past its table, and asserts WHICH test objected — plus the row and document COUNTS, because coverage was that checker's own bug twice |
| [`prove-red-doc-links.mjs`](prove-red-doc-links.mjs) | Breaks each of the five link checks on purpose, with a control that exercises every one correctly and must stay green |

## Why it lives here and not where it was written

All of them were written in **buses-data**, which is **private**. `community-bus-maps` and this repository are **public**. A private checker cannot be run by a public repository's CI without a cross-repo token — and hanging a shared check off `CROSS_REPO_PAT2`, which expires on **22 November 2026**, means one date on which the same check stops in two repositories at once. `check-file-hygiene.mjs` moved first (buses-data OA-241, 2026-09-04); `check-tables.mjs`, `check-doc-links.mjs` and their harnesses followed the same day (buses-data OA-246). All three repositories now run all three checkers with **no secret at all**, and nothing in this folder is fetched across a token.

The direction is the point: **a shared rule belongs in the repository anyone can read.**

## The rule travels; the exemptions stay home

A checker three repositories run must not carry one repository's exclusion list — nor its folder names — which is the shape OA-222 named, *a copy is a checker owning someone else's rule*, arrived at from the other side. So each repository declares its own at a **dotfile at its root**, and each checker resolves that root from the repository it is RUN FROM (`process.cwd()`, or the `--root` it was given) rather than from where the checker itself sits.

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

**And whatever git knows about is added on top, declared or not.** Every directory or file holding a tracked `.md` that the declaration does not already reach joins the scan, so **a repository that declares nothing gets the WIDEST scope, not the narrowest** — its whole tracked corpus. That is deliberate rather than convenient: `check-tables.mjs`'s own bug, twice, was COVERAGE — a confident total over a population smaller than the truth — and a scope that can only be got wrong by ADDING a folder is the one shape that fault cannot take.

**`--root` names a TREE, not a scope.** It scans exactly that tree and ignores `dirs`/`files` — but it still reads that tree's own declaration, and getting that wrong is the one fault the move produced. Read as *this is a fixture, not a repository*, it dropped the portal's `resolveFromRoot` and reported 24 live links dead, with every harness case green because their fixtures genuinely have no declaration. There is now a case where the tree named by the flag DOES carry one.

## Two tiers, and why the split is not softness

**Tier 1 — a BOM, and mixed line endings — applies to every tracked text file** and cannot be exempted except by `neverRead`. Neither is ever the content somebody meant. The one carve-out is a **PowerShell script**, where a BOM is load-bearing: Windows PowerShell 5.1 reads a BOM-less file as ANSI, so the first em dash added to a message string would be mangled at run time. That is a fact about PowerShell rather than a repository's preference, so it is in the checker.

**Tier 2 — trailing whitespace, blank runs, a final newline — applies only to what a repository claims as its own.** A gate that is red on day one about files nobody may touch is a gate somebody mutes in its first week.

## The half that CI cannot run, and must not be deleted for it

`--staged` narrows the check to the files in the commit in front of you, and it is a **pre-commit hook's** flag. **Mixed line endings are a property of a working tree and of nothing else**: with `core.autocrlf=true` and `text=auto`, the index normalises to LF the moment a file is staged, so a file with CRLF at the top and LF at the bottom produces a *clean diff* — and `actions/checkout` then builds a uniform tree, so CI sees nothing either. In CI that check cannot fire and is not meant to. **Do not delete it on noticing CI never reports it**; it is the check the whole thing was opened about.

One rule comes with `--staged`: anything asserting a property of the whole **corpus** must not run under it. The stale-exemption error is gated off for exactly that reason — written without the gate, the hook refused every commit in any repository but the checker's own.

## Running them

Run each from the repository root of whichever repository you are checking — **the folder you run it in is what decides what it reads** — and the paths below are real paths on this machine, not placeholders:

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-file-hygiene.mjs"
```

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-tables.mjs"
```

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-doc-links.mjs"
```

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

`--root <dir>` points it at another checkout. `--staged` is the hook's form. An unknown flag is refused by name with exit 2, never ignored. Exit `0` clean, `1` findings, `2` used wrongly or its own preconditions unmet.
