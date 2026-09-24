#!/usr/bin/env python
"""gen_verification.py — render the S6 independent-verification report to .docx.

Reads a verification.json (produced by verify_report.js — the antagonistic
verification pass: a blind red-team re-derivation diffed against our pipeline,
plus structural/geographic sanity checks) and writes a Word .docx reliability
report. Every finding is listed and classified HARD (blocks the build) or SOFT
(logged only). Style mirrors gen_disagreements.py.

Usage:  python gen_verification.py <verification.json> [<out.docx>]
        (out.docx defaults to verification.docx beside the json)

verification.json schema (see verify_report.js):
{
  "town": "St Ives",
  "generatedAt": "2026-06-07T15:01",
  "redteamPresent": true,
  "redteamSources": ["https://..."],
  "uncuratedS1": true|null,
  "inputs": {"verifiedOn": "...", "routesVersion": "4.0", "displayedRoutes": [...]},
  "summary": {"checks": N, "hard": N, "soft": N, "pass": true,
              "verdict": "pass|blocked|not-verified-uncurated-s1",
              "borrowedRedteam": {"map": "...", "run": "...", "derivedAt": "..."} | null,
              "downgradedFromHard": ["F007", ...]},
  "findings": [
    {"id": "F001", "severity": "hard|soft", "category": "...", "route": "301",
     "message": "...", "evidence": {...}, "source": "sanity|redteam"}
  ]
}
"""
import json
import os
import sys
from datetime import datetime

from docx import Document
from docx.shared import Pt, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

HARD_FILL = "FCE4E4"     # pale red for hard findings
SOFT_FILL = "FFF4D6"     # pale amber for soft findings
HEADER_FILL = "2F2F2F"
PASS_FILL = "E8F4E8"     # pale green banner
BLOCK_FILL = "F4C7C7"    # stronger red banner


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
    """Fix each column to a proportional share of the page's usable width —
    see gen_disagreements.py's copy of this helper for why `table.autofit`
    alone isn't enough (it only autofits when Word itself opens the file;
    the PDF is rendered by headless LibreOffice, which just splits the grid
    evenly, cramping Finding/Evidence against ID/Severity/Route)."""
    widths = [Emu(int(usable_width * w / sum(weights))) for w in weights]
    table.autofit = False
    table.allow_autofit = False
    for row in table.rows:
        for cell, w in zip(row.cells, widths):
            cell.width = w
    # Per-cell tcW alone isn't enough: python-docx leaves tblGrid at the
    # equal-width columns it created the table with, and that's what decides
    # layout wherever no cell in a column happens to override it (e.g. a
    # short table with fewer rows than columns wide). Rewrite it to match.
    grid = table._tbl.find(qn("w:tblGrid"))
    for gridcol, w in zip(grid.findall(qn("w:gridCol")), widths):
        gridcol.set(qn("w:w"), str(w.twips))


def evidence_str(ev):
    if not ev:
        return ""
    bits = []
    for k, v in ev.items():
        if isinstance(v, (dict, list)):
            v = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        bits.append(f"{k}: {v}")
    return "\n".join(bits)


def _bare_version(v):
    """`4.0` and `v1.0` both print as ONE v, because both are written.

    A town's routes.json carries `"version": "4.0"` and a place's carries
    `"version": "v1.0"`, and this line printed `routes v` in front of whichever
    it was handed. 24 of the 79 tracked verification.docx in the estate on
    2026-09-15 therefore read `routes vv1.0` -- every one of them a place map,
    every one of them committed, and nothing had ever looked because nothing
    but a person reads this document and no test existed.
    """
    s = str(v)
    return s[1:] if s[:1] in ("v", "V") else s


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: gen_verification.py <verification.json> [out.docx]")
    src = sys.argv[1]
    if len(sys.argv) > 2:
        out = sys.argv[2]
    else:
        out = os.path.join(os.path.dirname(os.path.abspath(src)), "verification.docx")

    with open(src, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    town = data.get("town", "this town")
    findings = data.get("findings", [])
    summary = data.get("summary", {})
    inputs = data.get("inputs", {})
    gen_at = data.get("generatedAt") or datetime.now().strftime("%Y-%m-%dT%H:%M")
    n_hard = summary.get("hard", sum(1 for f in findings if f.get("severity") == "hard"))
    n_soft = summary.get("soft", sum(1 for f in findings if f.get("severity") != "hard"))
    rt = data.get("redteamPresent", False)

    # HARD and everything-else, rather than HARD and the literal string "soft",
    # so the two lists are a PARTITION of findings and none can fall between
    # them. They could before: a finding whose severity was neither word was in
    # neither list, so it appeared in no row of the table, in no bullet, and in
    # no count -- while `if not findings:` stayed False, so the "no findings"
    # row that would have looked odd was suppressed too. verify_report.js emits
    # only the two words, so nothing has ever been lost this way; a silent drop
    # is worth one line to make impossible rather than worth watching.
    hard = [f for f in findings if f.get("severity") == "hard"]
    soft = [f for f in findings if f.get("severity") != "hard"]

    # THE VERDICT HAS THREE VALUES AND THIS FILE READ TWO. `summary.verdict` is
    # what verify_report.js writes -- `pass`, `blocked`, or
    # `not-verified-uncurated-s1` -- and `summary.pass` is FALSE for the third,
    # so reading `pass` alone printed "BLOCKED: hard findings must be resolved"
    # over a run with no hard findings at all, where verify_report.js's own
    # console says NOT VERIFIED. `pass` is still the fallback, for a file
    # written before the field existed; 19 of the 86 S6 runs on the estate on
    # 2026-09-15 carry no `verdict`.
    verdict = summary.get("verdict")
    if not verdict:
        if data.get("uncuratedS1"):
            verdict = "not-verified-uncurated-s1"
        else:
            verdict = "pass" if summary.get("pass", n_hard == 0) else "blocked"
    passed = verdict == "pass"
    uncurated = verdict == "not-verified-uncurated-s1"

    doc = Document()
    for section in doc.sections:
        section.left_margin = section.right_margin = Pt(36)

    doc.add_heading(f"Bus services — independent verification report: {town}", level=0)

    sub = doc.add_paragraph()
    sub.add_run(
        f"Generated {gen_at}"
        + (f"   ·   routes v{_bare_version(inputs.get('routesVersion'))}" if inputs.get("routesVersion") else "")
        + (f"   ·   services verified {inputs.get('verifiedOn')}" if inputs.get("verifiedOn") else "")
        + f"   ·   {n_hard} hard, {n_soft} soft finding(s)."
    ).italic = True

    # PASS / BLOCKED / NOT VERIFIED banner
    if passed:
        banner_text = "RESULT: PASS — no blocking findings; the stored data is safe to build/rely on."
        banner_colour, banner_fill = "1E5E2E", PASS_FILL
    elif uncurated:
        banner_text = ("RESULT: NOT VERIFIED — the S1 this was checked against is uncurated, so the "
                       "terminus checks could not run. This is neither a pass nor a block: curate "
                       "the S1 and verify again.")
        banner_colour, banner_fill = "8A5A1C", SOFT_FILL
    else:
        banner_text = "RESULT: BLOCKED — hard findings must be resolved before this build can be trusted."
        banner_colour, banner_fill = "8A1C1C", BLOCK_FILL
    banner = doc.add_table(rows=1, cols=1)
    banner.style = "Table Grid"
    bc = banner.rows[0].cells[0]
    set_cell(bc, banner_text, bold=True, size=12, align=WD_ALIGN_PARAGRAPH.CENTER,
             color=banner_colour)
    shade(bc, banner_fill)

    # WHAT QUALIFIES THAT VERDICT, IN THE DOCUMENT AND NOT ONLY IN THE JSON.
    # verify_report.js records `borrowedRedteam` with the comment that "the
    # console banner that qualified it does not outlive the JSON" -- and then
    # the qualification died here anyway, in the one artefact a person reads and
    # the only one that is committed. 15 S6 runs across nine place maps carry a
    # borrowed answer, every one of them verdict `pass`, and every one of their
    # reports said "safe to build/rely on" with nothing beside it; five of those
    # reached that pass only because a HARD was restated as a soft.
    borrowed = summary.get("borrowedRedteam")
    downgraded = summary.get("downgradedFromHard") or []
    if borrowed or uncurated:
        p = doc.add_paragraph()
        p.add_run("This verdict is qualified. ").bold = True
        if uncurated:
            p.add_run(
                "The stored services this was checked against are an uncurated S1 pull, so the "
                "terminus and coverage checks were downgraded rather than run. A verdict cannot "
                "be reached from it either way. "
            )
        if borrowed:
            src_map = borrowed.get("map") or "another map"
            when = borrowed.get("derivedAt")
            p.add_run(
                f"The red-team answer used here was not derived for this map: it was derived for "
                f"{src_map}"
                + (f" on {when}" if when else "")
                + ", and borrowed. It is scoped to the services serving that map, so it cannot "
                "settle a question about these stops on its own — read it, do not be blocked by "
                "it, and buy this map its own answer to restore a blocking verdict. "
            )
            if downgraded:
                p.add_run(
                    f"{len(downgraded)} finding(s) it raised as HARD are listed below as soft for "
                    f"that reason ({', '.join(str(d) for d in downgraded)}), so the result above is "
                    "a weaker pass than an unqualified one."
                ).bold = True

    doc.add_paragraph(
        "This is the antagonistic / independent verification pass (Stage S6). "
        + (("An independent blind red-team agent re-derived "
            + ("that map's" if borrowed else "the town's")
            + " services from scratch "
            "(operator, termini, operating days, and whether each route serves the town) from "
            "at least two independent sources, as its prompt requires: a primary source other "
            "than bustimes.org (council pages, Traveline, BODS or the operator's own timetables), "
            "with bustimes.org allowed only as a cross-check. It had no sight of our stored "
            "data; its findings were then diffed against our pipeline. ") if rt else
           "NOTE: no red-team file was present, so only the structural / geographic sanity "
           "checks ran. ")
        + "In addition, structural and geographic sanity checks were run against the stored "
        "geometry. Findings are classified HARD (would make the leaflet wrong or undrawable — "
        "these block the build) or SOFT (naming, day variants, off-by-one, inclusion candidates "
        "— logged for review only)."
    )
    if rt and data.get("redteamSources"):
        p = doc.add_paragraph()
        p.add_run("Red-team sources: ").bold = True
        p.add_run("; ".join(data["redteamSources"])).italic = True
    if inputs.get("displayedRoutes"):
        p = doc.add_paragraph()
        p.add_run("Routes drawn on the leaflet: ").bold = True
        p.add_run(", ".join(inputs["displayedRoutes"]))

    # findings table (hard first, then soft)
    cols = ["ID", "Severity", "Category", "Route", "Finding", "Evidence / source"]
    table = doc.add_table(rows=1, cols=len(cols))
    table.style = "Table Grid"
    table.autofit = True
    for i, name in enumerate(cols):
        c = table.rows[0].cells[i]
        set_cell(c, name, bold=True, color="FFFFFF", size=9)
        shade(c, HEADER_FILL)

    if not findings:
        cells = table.add_row().cells
        set_cell(cells[0], "—", size=9)
        set_cell(cells[4], "No findings — every check was clean.", size=9)
        for c in cells:
            # The banner's own fill, not PASS_FILL: an uncurated run can have no
            # findings precisely BECAUSE its checks could not run, and a green
            # row under an amber banner reads as the reassurance the banner is
            # refusing to give.
            shade(c, banner_fill)

    for f in hard + soft:
        is_hard = f.get("severity") == "hard"
        cells = table.add_row().cells
        set_cell(cells[0], f.get("id", ""), bold=True, size=9)
        set_cell(cells[1], "HARD" if is_hard else "soft", bold=is_hard, size=9,
                 align=WD_ALIGN_PARAGRAPH.CENTER,
                 color=("8A1C1C" if is_hard else None))
        set_cell(cells[2], f.get("category", ""), size=9)
        set_cell(cells[3], f.get("route") or "", bold=True, size=9,
                 align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell(cells[4], f.get("message", ""), size=9)
        tail = evidence_str(f.get("evidence"))
        srctag = f.get("source", "")
        tail = (f"[{srctag}]\n" if srctag else "") + tail
        set_cell(cells[5], tail, size=7)
        fill = HARD_FILL if is_hard else SOFT_FILL
        for c in cells:
            shade(c, fill)

    section = doc.sections[0]
    usable = section.page_width - section.left_margin - section.right_margin
    # ID / Severity / Route are short codes; Finding is the prose message
    # and Evidence/source carries raw JSON, so they take the largest shares.
    set_col_widths(table, usable, [0.5, 0.8, 1.0, 0.6, 2.6, 2.0])

    # summary sections
    if hard:
        doc.add_heading("Hard findings — must resolve before relying on this build", level=1)
        for f in hard:
            p = doc.add_paragraph(style="List Bullet")
            p.add_run(f"[{f.get('id','')}] {f.get('category','')}"
                      + (f" {f.get('route')}" if f.get("route") else "") + ": ").bold = True
            p.add_run(f.get("message", ""))
    if soft:
        doc.add_heading("Soft findings — review (not blocking)", level=1)
        for f in soft:
            p = doc.add_paragraph(style="List Bullet")
            p.add_run(f"[{f.get('id','')}] {f.get('category','')}"
                      + (f" {f.get('route')}" if f.get("route") else "") + ": ").bold = True
            p.add_run(f.get("message", ""))
    if not findings:
        doc.add_paragraph("No findings — the independent pass and the sanity checks all agreed "
                          "with the stored data.")

    # Stamp real created/modified dates (python-docx's blank template otherwise
    # leaves its 2013-12-23 date, which Explorer shows and reads as wrong).
    _now = datetime.now()
    doc.core_properties.created = _now
    doc.core_properties.modified = _now
    doc.save(out)
    banner_word = "PASS" if passed else ("NOT VERIFIED" if uncurated else "BLOCKED")
    print(f"wrote {out}  ({n_hard} hard, {n_soft} soft, {banner_word})")


if __name__ == "__main__":
    main()
