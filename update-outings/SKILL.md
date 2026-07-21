---
name: update-outings
description: Update the "Our upcoming Outings / Theatre Trips / Events" handout (MOM Outings etc.docx) for the St Ives (Cambs) u3a Members' Open Meeting by reconciling its three tables against the live u3a website. Use when asked to update or refresh the Outings/Theatre Trips/Events handout, prepare the outings sheet for the next Open Meeting, or roll it forward after a meeting. It deletes every entry dated on or before the meeting date, appends newer outings/trips/events from the website (looking up detail pages for full text and images), keeps "Waiting list only" entries compact, leaves the Booking Procedure / More Information text and the headers/footers untouched, and keeps the document to a maximum of two pages.
---

# Update the monthly Outings / Theatre Trips / Events handout

## What this produces
A refreshed `.docx` handout with three sections — **Outings**, **Theatre Trips**, **Events** — each a two-column table that lists the upcoming items for that category, for printing/handing out at the Members' Open Meeting. The handout is an extract of the live website and must print to a **maximum of two pages**.

## The single source of truth
The **live website overrides the document** in every case. Three list pages, one per section:
- **Outings:** `https://stivescambs.u3asite.uk/u3a_groups/outings/`
- **Theatre Trips:** `https://stivescambs.u3asite.uk/u3a_groups/theatre-trips/`
- **Events:** `https://stivescambs.u3asite.uk/u3a_groups/events/`

Each item usually links to its own **detail page** (e.g. `…/u3a_events/<slug>/`) with the full description, venue, cost and an image. Scrape the list page with WebFetch for the set + dates + status; fetch each **new/changed** item's detail page for the fuller wording and to find its image URL. The user confirms everything before any edit — the final safety net.

## The rules (do not break)
1. **Cut-off = the meeting date** (the folder/file date, `YYYYMMDD` → e.g. 11 June 2026). **Delete every entry dated on or before that date**, in all three sections. Then **append** any item on the website dated after the cut-off that isn't already present.
2. **Any outing/trip/event that is waiting-list-only must say so** — the text must include "(Waiting list only)" somewhere in its entry. This is mandatory regardless of layout.
   - The **image is optional** for a waiting-list entry: drop it to save space if you need to (typically paired as a compact two-per-row entry, no image), but you don't have to — a waiting-list item can keep its full image treatment (image + title + date/cost + short lines) with "(Waiting list only)" simply appended as an extra line, if there's room.
   - **Status is per-item and can change month to month independently of layout.** An item that had a full image treatment last month may have gone waiting-list-only this month (or vice versa) — its current status must always come from a fresh check of the live site this run, never carried over from how the existing doc presents it.
3. **Combine repeat items into one entry with one image** (e.g. the AI workshops on different dates → a single entry listing both dates, one picture).
4. **Cancelled items are excluded** (don't list them).
5. **Maximum two pages.** Verify in Word. **If adding everything would exceed two pages, stop and present the user options** (drop images, compress entries, drop an item) and let them choose — never decide silently. (Adding images is the user's stated preference, but two pages wins.)
6. **Leave unchanged:** the "Booking Procedure for Outings, Theatre Trips & Events" block, the "More Information…" block at the end, the three "Our upcoming …" title rows, and the page header/footer.
7. **Order within each section: by date, earliest first.**

## Document anatomy
- Three `<w:tbl>` tables in document order: **Outings**, **Theatre Trips**, **Events**. Each opens with a full-width title row ("Our upcoming **X**", X highlighted yellow).
- **Full row** = image in the left cell (inline drawing, right-justified) + text in the right cell. Text = bold **title** / date line ("Tue 15th September   £39", ordinal as a superscript run, cost appended) / one–three short lines.
- **Waiting-list pair row** = a compact entry in *each* cell (no image), each ending "(Waiting list only)".
- Page 1 = Outings + the Booking Procedure block (there is an explicit page break after it). Page 2 = Theatre Trips + Events + the More Information block.
- No cell shading (`w:shd`) is used — borders only. Don't add shading.

## Process
1. **Locate the target doc:** `…\By month\<YYYYMMDD> Members Open Meeting\TODO\<YYYYMMDD> MOM Outings etc.docx`. If unsure, ask for the path / meeting date.
2. **Check it isn't open in Word** — a `~$…docx` lock file next to it means it's open → ask the user to close it (the final overwrite fails otherwise).
3. **Ask clarifying questions one by one** until ~95% sure (images yes/no, how to handle multi-date or borderline items), then **read the current doc** (the three tables, each row's title/date/status, which rows have images, the rIds in `word\_rels\document.xml.rels`).
4. **Scrape the three list pages**; for each new item fetch its detail page for full text + the image URL.
5. **Reconcile — check the status of every item still in scope, not just new ones.** For every entry that will remain after the cut-off (kept items *and* new items), confirm from the live site whether it currently reads Waiting list only / Full / Cancelled / bookable. Don't infer an item's current status from how it's presented in the existing doc — a "full image" entry from last month may have flipped to waiting-list-only this month, and vice versa. WebFetch's summary of a list page can under-report how many items carry a status flag (e.g. it may surface only one "Waiting list only" and silently drop others) — when a list page mentions any waiting-list status, pull the raw HTML (`Invoke-WebRequest -OutFile`) and grep the text immediately around **each individual item's title**, not just a page-wide count, to see which ones actually carry it.
6. **Decide layout:** mark each entry remove / keep / append per the cut-off; for anything waiting-list-only, add "(Waiting list only)" to its text (image optional, see rule 2) — for everything else, full treatment as usual. Decide which items combine.
7. **Build a proposed-changes table and pause for confirmation. Never edit before the user approves.** Surface judgement calls (cost TBA, cancelled, combined entries, anything that risks the two-page limit).
8. **Edit the XML in place** (see Mechanics): remove rows, append new full rows with images, tweak kept rows.
9. **Verify in Word: exactly ≤ 2 pages, and the file actually opens** (see the 8-hex-digit trap below). Produce a PNG/PDF proof and eyeball that images sit neatly.
10. **Overwrite the original** `.docx`. Clean up scratch files.

## Mechanics (Windows)
Edit the raw XML (don't regenerate — that loses the header, footer, logo, borders and existing images). Use the `docx` skill's `unpack.py`/`pack.py`.

- **Scripts are already copied to a short path:** `C:\Claude\docx_scripts` (the docx skill itself lives under a very long `AppData\Roaming\Claude\…` path that the Windows Store Python **cannot open**, even though `Test-Path` succeeds). If that folder is missing, re-copy the docx skill's `scripts` dir there first.
- **Scratch dir:** work under a real `C:\` path (e.g. `C:\Claude\outings_unpacked`).
- **Unpack → edit → pack:**
  - `python "C:\Claude\docx_scripts\office\unpack.py" "<doc>" "C:\Claude\outings_unpacked"`
  - Edit `…\word\document.xml` (and `…\word\_rels\document.xml.rels` for new images).
  - `PYTHONUTF8=1 python "C:\Claude\docx_scripts\office\pack.py" "C:\Claude\outings_unpacked" "C:\Claude\outings_test.docx" --original "<doc>" --validate false` — pack to a **test file first**, never straight over the original. `PYTHONUTF8=1` avoids a cp1252 crash; `--validate false` skips a harmless pre-existing template/encoding validation failure.
- **⚠️ The 8-hex-digit trap (most important lesson):** every `w14:paraId`, `wp14:anchorId` and `wp14:editId` you add **must be exactly 8 hex digits**. lxml/`unpack.py` happily parse longer values, so a clean re-unpack is **not** proof — but **Word will refuse to open the file** ("Word experienced an error trying to open the file"). Always **test-open in Word** as the real check, not just re-unpack.
- **Removing a row:** delete the whole `<w:tr …paraId="XXXXXXXX"…>…</w:tr>`; a DOTALL regex `r'<w:tr [^>]*w14:paraId="<PID>".*?</w:tr>'` removes it cleanly (rows aren't nested).
- **Adding a full row with image:** mirror an existing full row — inline `<w:drawing>` (right-justified) in the left cell, text in the right cell. Insert before the correct `</w:tbl>` (1st = Outings, 2nd = Theatre, 3rd = Events).
- **Images:**
  - Find the URL in the page's raw HTML (`Invoke-WebRequest … ; regex https://…\.(jpg|jpeg|png)`); strip the `-WIDTHxHEIGHT` suffix for the full-size original.
  - Download to `word\media\imageN.jpeg` (next free N). Add `<Relationship Id="rIdNN" Type="…/image" Target="media/imageN.jpeg"/>` to `document.xml.rels` (use a free rId past the highest — read the rels, don't hardcode; jpeg/png are already in `[Content_Types].xml`).
  - **Re-unpacking the original wipes `media\` and resets `document.xml.rels`** — if you re-unpack to start over, copy your downloaded images aside first and re-add them + the rels afterwards.
  - Size: get pixel W×H via `System.Drawing.Image::FromFile`. Set `<wp:extent>`/`<a:ext>` width `cx` ≈ 2,000,000–2,200,000 EMU (~2"), `cy = round(cx * H / W)` to keep aspect.
- **Quotes/ampersand:** escape `&` as `&amp;` in `<w:t>`; a curly apostrophe is `&#8217;` (the doc mixes plain and curly — either is fine).
- **Page count + proof — use Microsoft Word** (the skill's `soffice` converter is Linux-only and no `pdftoppm`/Ghostscript/ImageMagick is installed):
  - Open read-only via COM: `$doc = $word.Documents.Open(path,$false,$true)`; pages = `$doc.ComputeStatistics(2)`. **A successful open here is also your proof the 8-hex IDs are valid.**
  - PDF proof: `$doc.SaveAs([ref]"…\out.pdf",[ref]17)`.
  - **Render PDF → PNG with PyMuPDF** (install once: `python -m pip install pymupdf`): `fitz.open(pdf); page.get_pixmap(dpi=110).save("p1.png")` — then read the PNGs to eyeball layout/images.
- **Overwrite** only after confirmation and once the `~$` lock is gone: `cp C:\Claude\outings_test.docx "<doc>"`. Clean up scratch files (keep the test docx as a backup if useful).

## What the user must do each month
1. **Create this month's file**: put `<YYYYMMDD> MOM Outings etc.docx` in its `…\<YYYYMMDD> Members Open Meeting\TODO\` folder (usually a renamed copy of last month's).
2. **Close it in Word** before starting — otherwise the final overwrite is blocked.
3. **Run the Claude session from inside `C:\u3a St Ives\`** so this skill and the folder's `.claude/settings.json` load.
4. **Invoke** `/update-outings` (or ask to "update the outings handout").
5. **Review the proposed-changes table** and confirm or redirect; if two-page-overflow options are offered, pick one.
6. **Afterwards, open the updated doc in Word and save once** (refreshes the footer date) and give it a final eyeball.
