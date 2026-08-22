---
name: check-interest-groups
description: Compare a supplied version of the St Ives (Cambs) u3a "Interest Groups by Interest Area" handout against the live u3a website and report every way it is out of date — as a findings list in the chat, writing nothing. Use when asked to check, review, compare, proofread or "see what's changed in" an interest groups handout/sheet, to say whether a groups list is still current, or when handed a copy of the handout and asked what needs updating. Read-only: it never edits a document and never produces a new one. To actually apply the changes to the .docx, use update-interest-groups instead.
---

# Check the Interest Groups handout against the website

## What this produces
A **findings list in the chat** — every way the supplied version differs from the live site, with what the document says, what the website says, and what would need to change. **Nothing is written.** No document is created, edited, saved or overwritten, and no page-count, font or layout rules apply, because there is no output document to constrain. If the user then wants the changes applied, that is `update-interest-groups`, a separate invocation they ask for.

## The version being checked
The user supplies it — a `.docx` path, a file they upload or paste, or pasted text/images of the handout. Take whatever they give and check that, rather than hunting for the current month's file: this skill compares *a supplied version*, which may deliberately be an old or draft one.

Read it **read-only**. For a `.docx`, the cell fills (`w:shd`) are only visible in the raw XML, so unpack a copy to a scratch folder and read `word/document.xml` there; never pack, never write back to the original. If the version arrives as images or plain text instead, the group names, days, times and areas are still checkable, but **the colour checks are not** — say so explicitly in the findings rather than guessing a status from context.

## The single source of truth
The **live website overrides the document** in every case. Two pages to read:
- **Groups (with days/times/status):** `https://stivescambs.u3asite.uk/groups/?sort=cat#list_button_anchor`
  - **"Display as New" is NOT a real Interest Area — ignore it.** It's a pseudo-category the site injects to highlight recently-added groups. Every group under it also appears under its genuine Interest Area further down the page; use that genuine area for placement. Don't report a group as misplaced because it also appears under "Display as New".
- **Homepage** `https://stivescambs.u3asite.uk/` — two boxes matter:
  - **Possible Groups** (top-right) → the document's "Possible Groups" box should match it verbatim.
  - **New Groups** (bottom-right) → defines which groups are **amber** (see colour key).

Scrape with WebFetch. Because WebFetch summarises, **cross-check any group you intend to report as changed with a second targeted WebFetch before it goes in the findings list.** There is no confirmation step here to catch a bad reading — the findings list is the deliverable, so a wrong finding ships. One unverified difference reported as fact is worse than five verified ones.

## The colour key (defined in the document header)
| Fill | Hex | Meaning |
|------|-----|---------|
| White / no fill | (no `w:shd`, or `FFFFFF`) | Active – no wait list |
| Grey | `BFBFBF` | Wait list **or** Full **or** Closed / "no longer meeting" |
| Amber | `FFC700` | Listed in the homepage **"New Groups"** box — **overrides every other colour** |

- Amber is driven **only** by the homepage "New Groups" box — NOT the site's "Display as New" category.
- Closed / "no longer meeting" groups belong in the list, in grey. A closed group present and grey is correct, not a finding.

## The five checks
1. Every current website group is present in the supplied version, with the correct day/time.
2. No groups appear that aren't on the website.
3. Each cell's colour matches its status per the key.
4. Each group sits under the correct Interest Area. If the site lists a group under several areas, say so and name them rather than picking one silently.
5. The "Possible Groups" box matches the homepage top-right box.

Also note the document's own "As at" footer date if it is visible, as context for how stale the version is — but a stale date is an observation, not one of the five findings.

## Process
1. **Take the supplied version** and confirm back which version is being checked (filename or a one-line description) so the user knows what was compared.
2. **Read it read-only**: group names, days/times, Interest Area placement, the `w:shd` fill of every cell, the "Possible Groups" box, and the footer date.
3. **Scrape the website**: the groups page and both homepage boxes.
4. **Diff** against the five checks, cross-checking each intended finding with a second targeted WebFetch.
5. **Report the findings list** (see below). Stop there.

## The findings list
Group the findings under the five checks, in that order, and within each give one line per group: the group name, what the version says, what the site says, and the change that would be needed. Keep it scannable — this is a worklist someone reads, not prose.

Two rules about what to say when there is nothing to say:
- **State a clean check explicitly.** "Check 2 — no extra groups" is a result worth reporting; silence reads as "not looked at".
- **Say what could not be checked and why** — colour checks on an image-only version, a group the site lists ambiguously, a day/time the site doesn't give. An unchecked item silently omitted looks identical to a passed one.

Finish with a one-line count: how many changes the version needs, and whether any are judgement calls rather than plain corrections.

## What this skill does not do
- It does not edit, save, overwrite or create any document — if asked to apply what it found, point at `update-interest-groups` and let the user invoke it.
- It has no two-page rule, no font floor and no styling constraints; those exist to protect a printed handout, and nothing here is printed.
- It does not run under `update-all-handouts`, and it carries no monthly-cadence or site-issue-watch step.

## Mechanics (Windows, read-only)
Only needed for a `.docx` version, and only to *read* the cell shading.

- **Python deps:** `defusedxml` and `lxml` (`python3 -m pip install defusedxml lxml`). Usually already present. Run from any folder.
- **Long-path workaround:** the `docx` skill lives under a very long Roaming path that Windows Python can't open directly. Copy its `scripts` folder to a short path first — run from any folder: `cp -r "<docx-skill>/scripts" "C:/Claude/_skill"`, where `<docx-skill>` is the installed docx skill's own directory.
- **Scratch dir:** bash `/tmp` is not Windows Python's `/tmp`. Unpack under a real `C:\` path.
- **Unpack to read** — run from any folder: `python3 C:/Claude/_skill/office/unpack.py "<doc>" C:/Claude/_chk`, where `<doc>` is the full path of the supplied `.docx` and `C:/Claude/_chk` is a scratch folder that this skill only ever reads from. Then read `C:/Claude/_chk/word/document.xml` for the groups and cell fills, and `C:/Claude/_chk/word/footer2.xml` for the "As at" date. **There is no pack step.** Delete the scratch folder when done.
- **Ordinals** ("1st", "3rd") are **superscript runs** — the digit and its suffix are separate `<w:r>`, so a day like "1st Tuesday" appears split across runs when you read the XML. Reassemble before comparing, or a correct day reads as a mismatch.
