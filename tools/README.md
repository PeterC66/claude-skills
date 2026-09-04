# `tools/` — checks that belong to no single skill

Everything else in this repository is a skill. This folder is for a check that **three repositories run against themselves**, which is why it cannot live inside one of them and why it cannot live in the repository it was written in.

## What is here

| File | What it does |
|---|---|
| [`check-file-hygiene.mjs`](check-file-hygiene.mjs) | Finds layout faults that confound an *edit* rather than a reader: a byte-order mark, a file carrying two kinds of line ending, trailing whitespace, a missing final newline, a run of blank lines |
| [`prove-red-file-hygiene.mjs`](prove-red-file-hygiene.mjs) | Breaks each of those on purpose and insists the checker notices — and breaks each **exemption** on purpose and insists it does not. 24 cases |

## Why it lives here and not where it was written

It was written in **buses-data**, which is **private**. `community-bus-maps` and this repository are **public**. A private checker cannot be run by a public repository's CI without a cross-repo token — and hanging a hygiene check off `CROSS_REPO_PAT2` is exactly what buses-data's `docs` job was separated out to avoid, since a token expiry must not take the documentation checks down with the byte gates. Moved here (buses-data OA-241, 2026-09-04) all three fetch it with **no secret at all**.

The direction is the point: **a shared rule belongs in the repository anyone can read.** Note what this does *not* yet fix — this repository's `docs` job still checks out buses-data for `check-tables.mjs` and `check-doc-links.mjs`, so those two remain token-dependent. Moving them is the same move again and has not been done.

## The rule travels; the exemptions stay home

A checker three repositories run must not carry one repository's exclusion list — that is the shape OA-222 named, *a copy is a checker owning someone else's rule*, arrived at from the other side. So each repository declares its own exemptions in a **`.file-hygiene.json` at its root**:

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

## Two tiers, and why the split is not softness

**Tier 1 — a BOM, and mixed line endings — applies to every tracked text file** and cannot be exempted except by `neverRead`. Neither is ever the content somebody meant. The one carve-out is a **PowerShell script**, where a BOM is load-bearing: Windows PowerShell 5.1 reads a BOM-less file as ANSI, so the first em dash added to a message string would be mangled at run time. That is a fact about PowerShell rather than a repository's preference, so it is in the checker.

**Tier 2 — trailing whitespace, blank runs, a final newline — applies only to what a repository claims as its own.** A gate that is red on day one about files nobody may touch is a gate somebody mutes in its first week.

## The half that CI cannot run, and must not be deleted for it

`--staged` narrows the check to the files in the commit in front of you, and it is a **pre-commit hook's** flag. **Mixed line endings are a property of a working tree and of nothing else**: with `core.autocrlf=true` and `text=auto`, the index normalises to LF the moment a file is staged, so a file with CRLF at the top and LF at the bottom produces a *clean diff* — and `actions/checkout` then builds a uniform tree, so CI sees nothing either. In CI that check cannot fire and is not meant to. **Do not delete it on noticing CI never reports it**; it is the check the whole thing was opened about.

One rule comes with `--staged`: anything asserting a property of the whole **corpus** must not run under it. The stale-exemption error is gated off for exactly that reason — written without the gate, the hook refused every commit in any repository but the checker's own.

## Running it

Run it from the repository root of whichever repository you are checking — the path below is a real path on this machine, not a placeholder:

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-file-hygiene.mjs"
```

Falsify it first, which is the order to use because a checker pointed at a new corpus is exactly when one that has quietly stopped objecting looks identical to a clean tree. Run this from the repository root (`C:\u3a St Ives\.claude\skills`), with no placeholders:

```bash
node tools/prove-red-file-hygiene.mjs
```

`--root <dir>` points it at another checkout. `--staged` is the hook's form. An unknown flag is refused by name with exit 2, never ignored. Exit `0` clean, `1` findings, `2` used wrongly or its own preconditions unmet.
