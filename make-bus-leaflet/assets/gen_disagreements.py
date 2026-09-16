#!/usr/bin/env python
"""gen_disagreements.py — build the bustimes-vs-operator audit document (Stage S1).

Reads a disagreements.json audit file and writes a Word .docx listing EVERY route
that was checked against both bustimes.org and the operator's own website — a full
audit trail, not only the conflicts. Rows where the two sources agree are marked
"agree"; rows where they differ are shaded and the resolution taken is recorded.

Usage:  python gen_disagreements.py <disagreements.json> [<out.docx>]
        (out.docx defaults to disagreements.docx beside the json)

disagreements.json schema:
{
  "town": "March",
  "validFrom": "June 2026",          # optional
  "generatedAt": "2026-06-05T16:30",  # optional; filled if absent
  "note": "Refresh audit ...",        # optional; what THIS round re-checked, printed under the intro
  "rows": [
    { "route": "32",
      "operator": "Dews Coaches",
      "field": "operating days",      # what was compared (status / days / terminus / stops / number / fare ...)
      "bustimes": "Mon-Sat",          # what bustimes.org says
      "operator_says": "Mon-Sat",     # what the operator's site says
      "agree": true,                  # true => audit-only row; false => conflict
      "resolution": "-",              # what was done (only meaningful when agree=false)
      "sources": { "bustimes": "https://...", "operator": "https://..." }
    }
  ]
}
"""
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime

from docx import Document
from docx.shared import Pt, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

CONFLICT_FILL = "FCE4E4"   # pale red for conflict rows
AGREE_FILL = "E8F4E8"      # pale green for agree rows
HEADER_FILL = "2F2F2F"

# The two sources every row carries, in the order a reader expects them, and the
# short labels they print under. Anything ELSE a row cites — `press`, which two
# rows of the High Wycombe route 20 reversal carry and which is the evidence for
# that exclusion — is listed after them under its own key rather than dropped for
# not being one of the two.
SOURCE_ORDER = ["bustimes", "operator"]
SOURCE_LABELS = {"bustimes": "bt", "operator": "op"}

# What a row writes in `resolution` when it means "nothing to resolve". Dropped
# on an agreeing row; a real sentence there is a clarification and is printed.
PLACEHOLDER_RESOLUTIONS = {"-", "--", "n/a", "N/A", "none", "None"}


# The .docx is the internal editable source of truth (kept forever); customers
# in the portal only ever see a converted PDF, so their copy is finalised and
# non-editable. Call soffice DIRECTLY here — the office skills' soffice.py
# wrapper is known to fail on Windows (see the Buses README "how to enhance").
SOFFICE_CANDIDATES = [r"C:\Program Files\LibreOffice\program\soffice.exe", "soffice"]


def convert_to_pdf(docx_path):
    """Best-effort docx -> sibling PDF via LibreOffice headless. Never blocks:
    if soffice isn't found or conversion fails, the .docx is still written and
    we just skip the PDF (there is no customer-facing PDF this run)."""
    soffice = next((p for p in SOFFICE_CANDIDATES if os.path.exists(p) or shutil.which(p)), None)
    if not soffice:
        print("note: soffice not found — skipped PDF conversion (docx still written)")
        return None
    outdir = os.path.dirname(os.path.abspath(docx_path))
    try:
        subprocess.run(
            [soffice, "--headless", "--convert-to", "pdf", "--outdir", outdir, docx_path],
            check=True, capture_output=True, timeout=60,
        )
    except Exception as e:
        print(f"note: PDF conversion failed ({e}) — docx still written")
        return None
    pdf_path = os.path.splitext(docx_path)[0] + ".pdf"
    if os.path.exists(pdf_path):
        print(f"wrote {pdf_path}")
        return pdf_path
    print("note: soffice ran but no PDF appeared — skipped")
    return None


def shade(cell, hex_fill):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:color"), "auto")
    sh.set(qn("w:fill"), hex_fill)
    tcPr.append(sh)


def set_cell(cell, text, *, bold=False, color=None, size=9, align=None):
    cell.text = ""
    p = cell.paragraphs[0]
    if align is not None:
        p.alignment = align
    run = p.add_run("" if text is None else str(text))
    run.bold = bold
    run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = RGBColor.from_string(color)


def set_col_widths(table, usable_width, weights):
    """Fix each column to a proportional share of the page's usable width
    instead of leaving `table.autofit` to divide it evenly. Word applies its
    own content-based autofit when a reader opens the .docx, but the
    headless LibreOffice pass that makes the customer-facing PDF does not —
    it renders the equal-width grid, so a column that is mostly short codes
    (Route, Agree?) got the same width as one that carries a URL and a
    resolution note, and the prose column wrapped to a tall, cramped strip
    while the short columns sat mostly empty. Setting explicit weighted
    widths fixes the PDF regardless of which engine renders it."""
    widths = [Emu(int(usable_width * w / sum(weights))) for w in weights]
    table.autofit = False
    table.allow_autofit = False
    for row in table.rows:
        for cell, w in zip(row.cells, widths):
            cell.width = w
    # Per-cell tcW alone isn't enough: python-docx leaves tblGrid at the
    # equal-width columns it created the table with, and that's what decides
    # layout wherever no cell in a column happens to override it. Rewrite it
    # to match.
    grid = table._tbl.find(qn("w:tblGrid"))
    for gridcol, w in zip(grid.findall(qn("w:gridCol")), widths):
        gridcol.set(qn("w:w"), str(w.twips))


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: gen_disagreements.py <disagreements.json> [out.docx]")
    src = sys.argv[1]
    # Default beside the json rather than in whatever directory the caller
    # happened to be standing in, which for a stage engine is the run folder
    # of some other stage.
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(src)), "disagreements.docx")

    with open(src, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    town = data.get("town", "this town")
    rows = data.get("rows", [])
    gen_at = data.get("generatedAt") or datetime.now().strftime("%Y-%m-%dT%H:%M")
    valid = data.get("validFrom", "")

    conflicts = [r for r in rows if not r.get("agree", False)]

    doc = Document()
    for section in doc.sections:
        section.left_margin = section.right_margin = Pt(36)

    h = doc.add_heading(f"Bus services — bustimes.org vs operator audit: {town}", level=0)
    sub = doc.add_paragraph()
    sub.add_run(
        f"Generated {gen_at}"
        + (f"   ·   service data valid from {valid}" if valid else "")
        + f"   ·   {len(rows)} check(s), {len(conflicts)} disagreement(s)."
    ).italic = True

    doc.add_paragraph(
        "Every route checked is listed below (full audit trail). Rows shaded green agree "
        "between bustimes.org and the operator's own website. Rows shaded red disagree; the "
        "operator's site is treated as authoritative and the resolution taken is shown."
    )

    # The audit's own qualification. `note` is where the writer says what this
    # round actually re-checked — "only 130, 300, WW1 and BHS01 were re-checked
    # against live sources this round; the other 34 rows are carried forward
    # unchanged" — which is the one thing that stops the standing paragraph
    # above being read as a claim that every row was checked today. It was
    # written into the JSON of 20 committed audits and reached none of their
    # documents. Printed only when it is there: a qualification on every report
    # is a qualification nobody reads.
    note = (data.get("note") or "").strip()
    if note:
        np = doc.add_paragraph()
        np.add_run("Note on this audit: ").bold = True
        np.add_run(note)

    cols = ["Route", "Operator", "Field", "bustimes.org says", "Operator says", "Agree?", "Resolution / source"]
    table = doc.add_table(rows=1, cols=len(cols))
    table.style = "Table Grid"
    table.autofit = True
    for i, name in enumerate(cols):
        c = table.rows[0].cells[i]
        set_cell(c, name, bold=True, color="FFFFFF", size=9)
        shade(c, HEADER_FILL)

    for r in rows:
        agree = bool(r.get("agree", False))
        cells = table.add_row().cells
        set_cell(cells[0], r.get("route", ""), bold=True, size=9)
        set_cell(cells[1], r.get("operator", ""), size=9)
        set_cell(cells[2], r.get("field", ""), size=9)
        set_cell(cells[3], r.get("bustimes", ""), size=9)
        set_cell(cells[4], r.get("operator_says", ""), size=9)
        set_cell(cells[5], "agree" if agree else "DISAGREE", bold=not agree, size=9,
                 align=WD_ALIGN_PARAGRAPH.CENTER)
        srcs = r.get("sources", {}) or {}
        # An agreeing row's `resolution` is a CLARIFICATION rather than a
        # resolution — "Drawn to Windsor as principal terminus; Slough/Langley
        # journeys noted" — and dropping it threw away 107 of them across 27
        # committed audits, including the two March's own note points the reader
        # at. A placeholder dash is not one and is still dropped.
        res = (r.get("resolution") or "").strip()
        if agree and res in PLACEHOLDER_RESOLUTIONS:
            res = ""
        tail = res
        link_bits = []
        for key in SOURCE_ORDER + sorted(k for k in srcs if k not in SOURCE_ORDER):
            if srcs.get(key):
                link_bits.append(SOURCE_LABELS.get(key, key) + ": " + srcs[key])
        if link_bits:
            tail = (res + "\n" if res else "") + "\n".join(link_bits)
        set_cell(cells[6], tail, size=8)
        fill = AGREE_FILL if agree else CONFLICT_FILL
        for c in cells:
            shade(c, fill)

    section = doc.sections[0]
    usable = section.page_width - section.left_margin - section.right_margin
    # Route / Agree? are short codes; Resolution / source carries a prose
    # note plus two URLs, so it gets the largest share.
    set_col_widths(table, usable, [0.7, 1.3, 1.0, 1.5, 1.5, 0.7, 2.0])

    if conflicts:
        doc.add_heading("Disagreements summary", level=1)
        for r in conflicts:
            p = doc.add_paragraph(style="List Bullet")
            p.add_run(f"{r.get('route','')} ({r.get('operator','')}) — {r.get('field','')}: ").bold = True
            p.add_run(f"bustimes.org: {r.get('bustimes','')}; operator: {r.get('operator_says','')}. ")
            p.add_run(f"Resolution: {r.get('resolution','')}.").italic = True
    elif rows:
        doc.add_paragraph("No disagreements found — bustimes.org and every operator site agreed.")
    else:
        # An audit with no rows has not found agreement; it has found nothing.
        # The sentence above would report the absence of checks as a clean
        # result, in the document that is the only record anybody reads.
        doc.add_paragraph(
            "No checks are recorded in this audit — nothing was compared, so this document "
            "says nothing about whether bustimes.org and the operators agree."
        )

    # Stamp real created/modified dates — python-docx's blank template otherwise
    # leaves its baked-in 2013-12-23 date, which Windows Explorer shows in its
    # "Date" column and reads as "clearly wrong".
    _now = datetime.now()
    doc.core_properties.created = _now
    doc.core_properties.modified = _now
    doc.save(out)
    print(f"wrote {out}  ({len(rows)} rows, {len(conflicts)} disagreement(s))")
    convert_to_pdf(out)


if __name__ == "__main__":
    main()
