---
name: update-interest-groups
description: Update the monthly "Interest Groups by Interest Area" handout for the St Ives (Cambs) u3a Members' Open Meeting by reconciling it against the live u3a website. Use when asked to update or check the interest groups handout/sheet, prepare the groups handout for the next Open Meeting, or refresh group days/times/colours/statuses. It verifies that every current group is present (and none extra), that days/times are correct, that each cell colour matches the status key, that groups sit under the right Interest Area, and that the "Possible Groups" box matches the homepage — while keeping the document to exactly two pages.
---

# Update the monthly Interest Groups handout

## What this produces
A refreshed `.docx` handout listing every St Ives (Cambs) u3a interest group under its Interest Area, colour-coded by status, fitting **exactly two pages** (one double-sided sheet) for printing at the Members' Open Meeting.

## The single source of truth
The **live website overrides the document** in every case. Two pages to read:
- **Groups (with days/times/status):** `https://stivescambs.u3asite.uk/groups/?sort=cat#list_button_anchor`
  - **"Display as New" is NOT a real Interest Area — ignore it.** It's a pseudo-category the site injects to highlight recently-added groups. Every group under it also appears under its genuine Interest Area further down the page; use that genuine area for placement. Don't create a "Display as New" section, and don't treat it as an area-placement mismatch.
- **Homepage** `https://stivescambs.u3asite.uk/` — two boxes matter:
  - **Possible Groups** (top-right) → must match the document's "Possible Groups" box verbatim.
  - **New Groups** (bottom-right) → defines which groups are **amber** (see colour key).

Scrape with WebFetch. Because WebFetch summarises, cross-check any group whose day/time/status you intend to change with a second targeted WebFetch before proposing it. The user confirms everything before any edit, which is the final safety net.

## The colour key (defined in the document header)
| Fill | Hex | Meaning |
|------|-----|---------|
| White / no fill | (remove the `w:shd`, or `FFFFFF`) | Active – no wait list |
| Grey | `BFBFBF` | Wait list **or** Full **or** Closed / "no longer meeting" |
| Amber | `FFC700` | Listed in the homepage **"New Groups"** box — **overrides every other colour** |

- Amber is driven **only** by the homepage "New Groups" box — NOT the site's "Display as New" category.
- Closed / "no longer meeting" groups stay listed, in grey (don't delete them).

## Hard rules (do not break)
1. **Exactly two pages.** This overrides completeness — it is better to drop days/times than to spill onto a third page.
2. **Never reduce the font size** (older readers must be able to read it).
3. **Preserve** colours, font, headers, footers, and the u3a logo. Only change group content and the "As at" date.
4. **Condensations are allowed** to save space: merge "1/2" variants into one cell (e.g. "Table Tennis 1/2", "Tai Chi Friday/Tuesday", "French Intermed 1/2"); full groups may be listed with **no** day/time.
5. **Interest Area order:** keep the document's existing order — Literature is deliberately placed **before** Languages to keep an area's groups together on one page.
6. **Outings, Theatre Trips, Events** and **Support Teams** are intentionally NOT sections; they appear only in the footer note. Don't add them as sections.

## The five checks each month
1. Every current website group is present, with correct day/time.
2. No groups appear that aren't on the website.
3. Each cell's colour matches its status per the key.
4. Each group sits under the correct Interest Area. **New groups** go under the area the **webpage specifies**; if the site lists a group under several areas, pick one and flag it in the confirmation table.
5. The document's "Possible Groups" box matches the homepage top-right box.

## Process
1. **Locate the target doc.** It's `…\By month\<YYYYMMDD> <Month> Members Open Meeting\<YYYYMMDD> Interest Groups by interest area.docx` — usually a renamed copy of last month's file. If unsure, ask the user for the path or which meeting date.
2. **Check it isn't open in Word.** A `~$…docx` lock file next to it means it's open → ask the user to close it (the final overwrite will fail otherwise).
3. **Read the current doc**: group names, days/times, the `w:shd` fill of every cell, and the colour key in `header2.xml`.
4. **Scrape the website** (groups page + both homepage boxes). While scraping, separately note anything that looks like a genuine **site problem** rather than an ordinary month-to-month data change — a broken/stale link, a mismatched name, an editorial/internal-looking note published in visible text, inconsistent wording vs. the rest of the site. Keep a short list (or "nothing found") to report back at the end — see "Site-issue watch" below.
5. **Diff** against the five checks. Build a proposed-changes table: colour changes, day/time corrections, additions/removals, placement, and the footer date → today.
6. **Always pause and present the table for confirmation.** Never edit before the user approves. Surface judgement calls (e.g. stale date ranges, multi-area placement) explicitly.
7. **If adding a group would push past two pages**, present condensation/removal **options** and let the user choose — don't decide silently.
8. **Edit the doc in place** (see Mechanics) and update the footer date.
9. **Verify exactly two pages** via Word. Produce a PDF proof **only if something looks risky** (large content change, possible overflow).
10. **Overwrite the original** `.docx`.

## Site-issue watch
This handout is an extract of the live site, but scraping it also surfaces genuine site problems that have nothing to do with this month's data (a stale link, an internal note accidentally published, a naming mismatch). Don't fold these into the doc edit or silently ignore them — mention them in the final hand-off to the user (or, when running under `update-all-handouts`, hand them to the orchestrator so they end up in one combined note) so they can be passed on to the web manager. If nothing was found, say so explicitly rather than leaving it unstated — a clean pass is worth confirming, not just implying.

## Mechanics (Windows)
Edit the raw XML (don't regenerate the document — that would lose the colours, header key, footer and logo). The `docx` skill's `unpack.py`/`pack.py` merge runs and pretty-print, which makes editing reliable.

- **Python deps:** `defusedxml` and `lxml` must be installed (`python3 -m pip install defusedxml lxml`). Usually already present.
- **Long-path workaround:** the docx skill lives under a very long Roaming path that Windows Python can't open directly. Copy its `scripts` folder to a short path first, e.g. `cp -r "<docx-skill>/scripts" "C:/Claude/_skill"`, then run `python3 "C:/Claude/_skill/office/unpack.py" …`.
- **Scratch dir:** bash `/tmp` ≠ Windows Python `/tmp`. Work under a real `C:\` path (e.g. `C:\Claude\_un`).
- **Unpack → edit → pack:**
  - `python3 C:/Claude/_skill/office/unpack.py "<doc>" C:/Claude/_un`
  - Edit `C:/Claude/_un/word/document.xml` (groups) and `footer2.xml` (date).
  - `PYTHONUTF8=1 python3 C:/Claude/_skill/office/pack.py C:/Claude/_un C:/Claude/_out.docx --original "<doc>"` (the `PYTHONUTF8=1` avoids a Windows cp1252 logging crash).
- **Cell shading:** amber = `<w:shd w:val="clear" w:color="auto" w:fill="FFC700"/>`; white = delete the cell's `w:shd` element; grey = `BFBFBF`.
- **Ordinals** ("1st", "3rd") are **superscript runs** — the digit and its suffix are separate `<w:r>`. Anchor edits on surrounding unique text, not on the bare suffix.
- **Footer date** (`footer2.xml`) is a `SAVEDATE` field with cached display text. Update the cached day run (e.g. `18th`→`2nd`) and month/year run (e.g. `May 2026`→`June 2026`) so the placeholder is roughly right. **Word only recalculates a `SAVEDATE` field when the document is actually saved with a change** — opening and closing an unchanged doc leaves the old cached date. So the user must make a *minor edit* (e.g. type and delete a space) and then save for the footer to refresh to the true save date. Tell them this in the hand-off (it's why the cached value still matters, and why "just open and save" isn't enough).
- **Page count + PDF proof — use Microsoft Word** (the skill's `soffice` converter is Linux-only):
  - Pages: PowerShell COM, open read-only, `$doc.ComputeStatistics(2)`.
  - PDF: `$doc.SaveAs([ref]"C:\Claude\_out.pdf", [ref]17)`.
- **Confirm exactly 2 pages**, then `cp C:/Claude/_out.docx "<doc>"` to overwrite. Clean up scratch files.

## What the user must do each month
Tell the user these steps (they own them):
1. **Create this month's file**: copy last month's `Interest Groups by interest area.docx` into the new `<YYYYMMDD> … Members Open Meeting` folder and rename it with the new date (or point Claude at the file to use).
2. **Close it in Word** (close Word entirely is safest) before starting — otherwise the final overwrite is blocked.
3. **Run the Claude session from inside `C:\u3a St Ives\`** so this skill and the folder's `.claude/settings.json` load, and file operations don't prompt as "outside the working folder".
4. **Invoke** `/update-interest-groups` (or just ask to "update the interest groups handout").
5. **Review the proposed-changes table** and confirm or redirect. If overflow options are offered, pick one.
6. **Afterwards, open the updated doc in Word, make a tiny change (e.g. type a space and delete it) so the file is "dirty", then save** — this is what forces the footer "As at" `SAVEDATE` field to refresh to today. Simply opening and closing won't update it. Then give it a final eyeball.

