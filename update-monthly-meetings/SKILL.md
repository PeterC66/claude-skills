---
name: update-monthly-meetings
description: Update the "Monthly Meetings" (Members Open Meeting / MOM) handout for the St Ives (Cambs) u3a by reconciling its table against the live u3a website. Use when asked to update or refresh the monthly meetings handout/sheet, prepare the Open Meetings list for the next meeting, or roll the table forward after a meeting. It removes the meeting just held, keeps exactly four upcoming meetings in date order, and refreshes each row's date, image, title, speaker byline and summary from the website — leaving the heading, footer and the paragraph below the table unchanged.
---

# Update the monthly Monthly Meetings handout

## What this produces
A refreshed `.docx` handout whose table lists the **next four** St Ives (Cambs) u3a Members Open Meetings in date order — each with its date, image (if any), title, a "by <Speaker>" byline, and a short summary — for printing/handing out at the Open Meeting. The table is an extract of the live website.

## The single source of truth
The **live website overrides the document** in every case.
- **List page:** `https://stivescambs.u3asite.uk/monthly-meetings/` — gives the full ordered list of meetings (date, title, image, short blurb). This is the page the table is "an extract" of.
- **Per-meeting detail page:** each meeting's title links to its own event page (e.g. `…/u3a_events/<slug>/`). The detail page holds the **full** description and a clean `Speaker:` line — richer than the list-page blurb. **Use the detail page for each row's text and speaker.**

Scrape with WebFetch for the overview, but WebFetch truncates quotes to ~125 chars and summarises — so to get **complete** summary text and exact image URLs, download the raw HTML directly (PowerShell `Invoke-WebRequest … -OutFile`) and read the event blocks / `wp-block-paragraph` / `Speaker:` headings. The user confirms everything before any edit, which is the final safety net.

## The rules (do not break)
1. **Exactly four meetings** in the table, **in date order** (earliest first), matching the website's order.
2. **Remove the meeting just held** — i.e. the one whose date the new handout has now passed (normally the meeting this handout's folder is named for). Then append later meetings from the website until four remain.
3. **Refresh all four rows** from each meeting's **detail page, trimmed**: keep long write-ups (e.g. a five-paragraph talk) to roughly one paragraph; short ones can stay as-is.
4. **Row layout** (match the existing rows): bold **title**, a line break, then a bold **"by <Speaker>"** byline, then the summary paragraph(s) in normal weight. The date cell holds the bold date (with superscript ordinal) and the meeting's image.
5. **Speaker byline on every row, including the AGM.** The AGM has its own talk + speaker; render it like `AGM, followed by <talk title>` / `by <Speaker>` — the AGM itself is the lesser detail.
6. **Images:** include each meeting's image where the website shows one (download it and embed it); meetings with no image (e.g. an AGM) get none.
7. **Alternating row shading**, cream `FFF4CC` / blue `E6F2FF`. Which colour starts doesn't matter, but it must alternate; both cells in a row share the colour.
8. **Leave unchanged:** the header row (`Date` / `Subject and Speaker`), the page header/footer, and the "All Members Open Meetings are held at the Corn Exchange…" paragraph below the table.

## Process
1. **Locate the target doc.** It's `…\By month\<YYYYMMDD> Members Open Meeting\<YYYYMMDD> MOM Open Meetings .docx` — in the **meeting folder itself**, alongside the other two handouts (note the space before `.docx`). The folder's `TODO\` subfolder is the user's own "still outstanding" tray for *other* MOM documents (the Checklist, the Open-Close script); the handout is not in there. Folder date = that month's meeting. If unsure, ask the user for the path or meeting date.
2. **Check it isn't open in Word** (a `~$…docx` lock file next to it means it's open → ask the user to close it, or the final overwrite fails).
3. **Read the current doc**: the existing rows (dates, titles, bylines, summaries), each cell's `w:shd` fill, and which rows have images.
4. **Scrape the website**: the list page for order + dates + image URLs, then each remaining/added meeting's detail page for full text and speaker.
5. **Work out the four**: drop the held meeting; the next four by date become the table. Confirm which colour each row gets so shading still alternates.
6. **Build a proposed-changes table** (remove / keep-refresh / append, with the trimmed summary wording for each) and **always pause for confirmation. Never edit before the user approves.** Surface judgement calls (e.g. how to phrase the AGM row, how aggressively to trim a long talk).
7. **Edit the XML in place** (see Mechanics): remove the held row, refresh the kept rows, append the new row(s), embed any new image(s).
8. **Pack to a test file, then test-open it in Word** (see Mechanics). That open is what proves the added `w14:paraId`s are valid 8-hex and the file isn't corrupt — a clean re-unpack proves nothing.
9. **Overwrite the original** `.docx` from the test file, once the `~$` lock is gone. Then ask the user to eyeball it in Word. Clean up scratch files.

## Mechanics (Windows)
Edit the raw XML (don't regenerate the document — that would lose the header, footer, logo, borders and existing images). Use the `docx` skill's `unpack.py`/`pack.py`.

- **Long-path workaround:** the `docx` skill lives under a very long `AppData\Roaming\Claude\…` path that the Windows Store Python **cannot open** (`Test-Path` succeeds but `python` reports "No such file"). Copy its `scripts` folder to a short path first: `Copy-Item -Recurse "<docx-skill>\scripts" "C:\Claude\docx_scripts"`, then run `python "C:\Claude\docx_scripts\office\unpack.py" …`.
- **Scratch dir:** work under a real `C:\` path (e.g. `C:\Claude\mom_unpacked`).
- **Unpack → edit → pack:**
  - `python "C:\Claude\docx_scripts\office\unpack.py" "<doc>" "C:\Claude\mom_unpacked"`
  - Edit `C:\Claude\mom_unpacked\word\document.xml`.
  - `PYTHONUTF8=1 python "C:\Claude\docx_scripts\office\pack.py" "C:\Claude\mom_unpacked" "C:\Claude\mom_test.docx" --original "<doc>" --validate false` — pack to a **test file first, never straight over the original**. The original is the only copy of a document you may have half-edited; overwrite it (process step 9) only once the test-open below succeeds.
  - **Use `--validate false`**: validation fails on a *pre-existing* broken `attachedTemplate` reference (`C:\Templates\Word\u3a\…dotx`) and on a cp1252 crash printing a "→" char. Both are harmless and unrelated to the edits. `PYTHONUTF8=1` avoids the encoding crash.
- **Removing a row:** delete the whole `<w:tr …>…</w:tr>`. Each row carries a unique `w14:paraId`, so a regex like `\s*<w:tr [^>]*<paraId>.*?</w:tr>` (DOTALL) removes it cleanly via a one-line `python -c`.
- **Date cell:** bold "Thursday N", then the ordinal ("th"/"st"/"rd") as a **superscript** `<w:r>` (`<w:vertAlign w:val="superscript"/>`), then " Month". The image follows as an inline `<w:drawing>` in the same paragraph.
- **Images:** save to `word\media\imageN.jpeg` (or `.png`); add `<Relationship Id="rIdNN" Type="…/image" Target="media/imageN.jpeg"/>` to `word\_rels\document.xml.rels` (use a free rId, e.g. one past the highest); `jpeg`/`png` are already declared in `[Content_Types].xml`. Size the inline `<wp:extent>`/`<a:ext>` ~`cx="1856740"` (≈2") wide with `cy` = width × (imageHeight/imageWidth) to keep aspect. Download via PowerShell `Invoke-WebRequest -OutFile`.
- **Cell shading:** `<w:shd w:val="clear" w:color="auto" w:fill="FFF4CC"/>` (cream) or `…fill="E6F2FF"/>` (blue), on both `<w:tc>` of a row.
- **Quotes/ampersand:** match the existing rows' plain ASCII quotes; escape `&` as `&amp;` in `<w:t>`.
- **⚠️ The 8-hex-digit trap:** every `w14:paraId`, `wp14:anchorId` and `wp14:editId` you add **must be exactly 8 hex digits**. lxml/`unpack.py` parse longer values happily, so a clean re-unpack is **not** proof — but **Word will refuse to open the file** ("Word experienced an error trying to open the file"). This skill appends rows and embeds images on every run, which is exactly when it bites. (Same trap, same wording, in `update-outings`.)
- **Test-open in Word is the real check.** LibreOffice isn't installed and the skill's `soffice` wrapper is Unix-only, so there's no PDF/image proof from the packed file alone. Open the **test** docx read-only over COM:
  `$word = New-Object -ComObject Word.Application; $doc = $word.Documents.Open("C:\Claude\mom_test.docx",$false,$true)` — **a successful open is your proof the 8-hex IDs are valid**; `$doc.ComputeStatistics(2)` gives the page count. `$doc.Close()` then `$word.Quit()` afterwards, or the lock blocks the overwrite. Only then copy the test file over the original, and still ask the user to eyeball it in Word (especially that images sit neatly in their cells).

## What the user must do each month
Tell the user these steps (they own them):
1. **Create this month's file**: put the MOM Open Meetings `.docx` for the upcoming meeting in its `…\<YYYYMMDD> Members Open Meeting\` folder, beside the other two handouts (or point Claude at the file to use).
2. **Close it in Word** before starting — otherwise the final overwrite is blocked.
3. **Run the Claude session from inside `C:\u3a St Ives\`** so this skill and the folder's `.claude/settings.json` load and file operations don't prompt as "outside the working folder".
4. **Invoke** `/update-monthly-meetings` (or just ask to "update the monthly meetings handout").
5. **Review the proposed-changes table** and confirm or redirect.
6. **Afterwards, open the updated doc in Word**, eyeball the layout/images, and save.
