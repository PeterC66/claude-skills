"""gen_disagreements.py -- the audit document, and the second artefact here whose only reader is a person.

THE SEVENTEENTH OF THE TWENTY, and the sibling `test_gen_verification.py`'s own
header named it: "`gen_disagreements.py` is the other one and it is still
uncovered." This module turns a stage's `disagreements.json` into the
`disagreements.docx` that records what every route was checked against -- the
file `stage.js commit S1` and `commit S6` track, that `_latest/` mirrors, and
that nothing whatever downstream parses. A wrong number in a data file
eventually contradicts something; a sentence missing from a Word document is
simply never read.

WHAT THE ESTATE'S OWN AUDITS SAID WHILE THIS FILE DID NOT EXIST. All three were
measured on the committed tree on 2026-09-16, over 49 `disagreements.json` and
1,441 rows, and all three had SHIPPED -- none is latent.

  * **The audit's own qualification never reached its document.** 20 of the 49
    carry a top-level `note`, and this module never read the key. They are not
    decoration: High Wycombe's says that only 130, 300, WW1 and BHS01 "were
    re-checked against live sources this round" and the other 34 rows are
    "carried forward unchanged", directly under a standing paragraph the reader
    meets as *every route checked is listed below (full audit trail)*. 20 of the
    20 committed documents were opened and read back: the note is in none of
    them.

  * **107 clarifications were dropped for being on rows that AGREE.** `res` was
    read only when `agree` was false, so "Drawn to Windsor as principal
    terminus; Slough/Langley journeys noted" was written into the JSON and
    printed nowhere. It spans 27 of the 49 files and five towns -- and March's
    own note points the reader at exactly these: "two rows carry clarifying
    notes where a heading could mislead". The document that note is attached to
    dropped the note AND both clarifications.

  * **A source that is not one of the two named keys was discarded.** The cell
    was built from `srcs.get("bustimes")` and `srcs.get("operator")` by name, so
    the two rows carrying `sources.press` lost it -- and those two rows are the
    High Wycombe route 20 reversal, where the press article IS the evidence for
    the exclusion the row records.

AND ONE THAT IS LATENT, STATED AS SUCH. With no rows at all the module printed
"No disagreements found -- bustimes.org and every operator site agreed", which
reports the absence of checks as a clean result. No committed audit has zero
rows, so nothing has been believed on this account yet.

WHY NO EXISTING CHECK COULD SEE ANY OF THEM. It is the sibling's answer and it
is the same answer: the byte gates compare SVG, the quality ratchet reads
metrics, `latest-mirror-gate.js` hashes this docx against the run folder's copy
of the same docx and says nothing about what is inside it, and `check-s6-claims`
reads the JSON. A .docx is the one artefact class in this estate whose
correctness has only ever been asserted by somebody opening it.

WHAT IS ASSERTED IS THE RENDERED DOCUMENT, NEVER THE CODE PATH. Every case
writes a real .docx to a temp directory through `main()` with `sys.argv`
patched, reopens it with python-docx, and reads paragraphs, table cells and cell
SHADING back. Two of this module's helpers manipulate XML directly (`w:shd`,
`w:tblGrid`), so a test asserting on the objects the module assembles would be
asserting on the mental model that produced the bug.

TWO THINGS ARE DELIBERATELY NOT ASSERTED, for the reasons the sibling gives.
The column WIDTHS have no correct value, so what is checked is that the grid and
the cells AGREE -- the property `set_col_widths`' own comment says was the bug.
And the created/modified stamps are checked only to be later than python-docx's
2013 template default: `datetime.now()` is an input nobody declares, and an
assertion on one is a clock-dependent artefact of the kind that has reddened
`main` here before.

ONE BEHAVIOUR IS PINNED RATHER THAN CHANGED, and saying which way is the point.
A row carrying no `agree` key at all is treated as a DISAGREEMENT. Both defaults
assert something the data does not say; this one is the loud direction, it is
what every version of this module has done, and all 1,441 committed rows carry
the key, so nothing has ever taken it. It is pinned here so that changing it is
a decision somebody makes rather than a line somebody edits.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

from docx import Document
from docx.oxml.ns import qn

import _engine

GD = _engine.load("gen_disagreements")


def a_row(route="32", agree=True, **kw):
    """A row in the shape all 1,441 committed rows have: every key present."""
    r = {"route": route,
         "operator": kw.get("operator", "Dews Coaches"),
         "field": kw.get("field", "operating days"),
         "bustimes": kw.get("bustimes", "Mon-Sat"),
         "operator_says": kw.get("operator_says", "Mon-Sat"),
         "agree": agree,
         "resolution": kw.get("resolution", "-"),
         "sources": kw.get("sources", {"bustimes": "https://bustimes.org/services/32",
                                       "operator": "https://dews.example/32"})}
    for drop in kw.get("without", ()):
        r.pop(drop, None)
    return r


def an_audit(rows=None, **kw):
    d = {"town": kw.get("town", "March"),
         "validFrom": kw.get("validFrom", "June 2026"),
         "generatedAt": kw.get("generatedAt", "2026-06-05T16:30"),
         "rows": [a_row()] if rows is None else rows}
    if "note" in kw:
        d["note"] = kw["note"]
    for drop in kw.get("without", ()):
        d.pop(drop, None)
    return d


def fill_of(cell):
    """The shading a reader sees, read back off the XML the helper wrote."""
    tcPr = cell._tc.tcPr
    if tcPr is None:
        return None
    shd = tcPr.find(qn("w:shd"))
    return None if shd is None else shd.get(qn("w:fill"))


class Rendered(object):
    """A written .docx, read back as the reader meets it."""

    def __init__(self, path):
        self.path = path
        self.doc = Document(path)
        self.paragraphs = [p.text for p in self.doc.paragraphs if p.text.strip()]
        self.table = self.doc.tables[0]
        self.grid = [[c.text for c in r.cells] for r in self.table.rows]

    @property
    def subtitle(self):
        return self.paragraphs[1]

    @property
    def body_rows(self):
        return self.grid[1:]

    def cell(self, row, col):
        return self.table.rows[row + 1].cells[col]

    @property
    def whole(self):
        return "\n".join(self.paragraphs + [c for r in self.grid for c in r])


class GenDisagreementsCase(unittest.TestCase):

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="gd-")
        self.addCleanup(shutil.rmtree, self.dir, True)

    def render(self, data, out_name=None, argv_out=True, sub=""):
        """Write `data` as a disagreements.json and drive main() over it.

        The PDF pass is STUBBED, and that is a decision rather than a shortcut.
        `main()` ends by asking LibreOffice to convert what it wrote, which on
        this laptop is installed and costs 1.5 seconds a render -- 55 seconds
        for this file and a quarter of an hour under the mutation harness, which
        runs it once per mutation. Worse, it is installed HERE and absent on a
        CI runner, so leaving it in would mean the suite exercised a different
        path in the two places it runs. What the module promises is that the
        conversion is best-effort and never blocks the .docx; the call itself is
        asserted in `TheCustomerFacingPdf` below, with a spy rather than soffice.
        """
        folder = os.path.join(self.dir, sub) if sub else self.dir
        if not os.path.isdir(folder):
            os.makedirs(folder)
        src = os.path.join(folder, "disagreements.json")
        with open(src, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        out = os.path.join(self.dir, out_name or "out.docx")
        argv = ["gen_disagreements.py", src] + ([out] if argv_out else [])
        saved = sys.argv[:]
        sys.argv[:] = argv
        self.converted = []
        saved_convert = GD.convert_to_pdf
        GD.convert_to_pdf = self.converted.append
        self.addCleanup(setattr, GD, "convert_to_pdf", saved_convert)
        try:
            # main() prints a confirmation line and, where LibreOffice is
            # installed, a PDF note; swallowed so a 30-case run does not bury
            # the runner's own output.
            with contextlib.redirect_stdout(io.StringIO()):
                GD.main()
        finally:
            sys.argv[:] = saved
            GD.convert_to_pdf = saved_convert
        return Rendered(out if argv_out else os.path.join(folder, "disagreements.docx"))


# =====================================================================
# 1. THE NOTE -- the audit's own qualification, written 20 times and printed 0
# =====================================================================
class TheAuditsOwnQualification(GenDisagreementsCase):

    def test_a_note_reaches_the_reader(self):
        """THE FAULT. 20 committed audits carry one and 20 committed documents
        drop it, under a paragraph saying every route checked is listed below."""
        r = self.render(an_audit(note="Only 130, 300, WW1 and BHS01 were re-checked "
                                      "this round; the other 34 rows are carried forward."))
        self.assertIn("Only 130, 300, WW1 and BHS01 were re-checked", r.whole)

    def test_the_note_is_labelled_so_it_is_not_read_as_our_own_prose(self):
        r = self.render(an_audit(note="Carried forward from the 2026-07-27 build."))
        self.assertIn("Note on this audit:", r.whole)

    def test_the_note_sits_between_the_standing_prose_and_the_table(self):
        """A qualification a reader meets after the rows it qualifies has
        already failed. It has to land under the paragraph it qualifies -- the
        one promising a full audit trail -- and before the first row."""
        r = self.render(an_audit(note="A qualification."))
        intro = next(i for i, p in enumerate(r.paragraphs)
                     if p.startswith("Every route checked is listed below"))
        noted = next(i for i, p in enumerate(r.paragraphs)
                     if p.startswith("Note on this audit:"))
        self.assertEqual(noted, intro + 1)
        self.assertEqual(r.paragraphs[noted],
                         "Note on this audit: A qualification.")

    def test_an_audit_with_no_note_is_not_given_one(self):
        """The other direction, and the one that would put the fault back
        invisibly: a sentence printed on every report is a sentence nobody
        reads, and the 20 qualified audits would be indistinguishable again.
        29 of the 49 committed audits carry no note."""
        r = self.render(an_audit())
        self.assertNotIn("Note on this audit", r.whole)

    def test_an_empty_note_is_not_a_note(self):
        r = self.render(an_audit(note="   "))
        self.assertNotIn("Note on this audit", r.whole)


# =====================================================================
# 2. THE RESOLUTION COLUMN -- 107 clarifications dropped for agreeing
# =====================================================================
class TheResolutionColumn(GenDisagreementsCase):

    def test_a_clarification_on_an_agreeing_row_is_printed(self):
        """THE SECOND FAULT. `res` was read only when the row disagreed, so 107
        notes across 27 committed audits were written and never shown -- among
        them the two March's own note points the reader at."""
        r = self.render(an_audit([a_row(agree=True, resolution=(
            "Drawn to Windsor as principal terminus; Slough/Langley journeys noted"))]))
        self.assertIn("Drawn to Windsor as principal terminus", r.body_rows[0][6])

    def test_a_placeholder_dash_on_an_agreeing_row_is_still_dropped(self):
        """The reason the fix is not simply `print res`: 1,334 of the 1,441 rows
        carry a dash meaning nothing to resolve, and a column of dashes is how a
        real clarification stops being noticed."""
        r = self.render(an_audit([a_row(agree=True, resolution="-")]))
        self.assertNotIn("-\n", r.body_rows[0][6])
        self.assertTrue(r.body_rows[0][6].startswith("bt: "))

    def test_a_resolution_on_a_disagreeing_row_is_printed_as_it_always_was(self):
        r = self.render(an_audit([a_row(agree=False, resolution="EXCLUDED, and the "
                                        "2026-07-27 exclusion STANDS.")]))
        self.assertIn("EXCLUDED, and the 2026-07-27 exclusion STANDS.", r.body_rows[0][6])

    def test_a_placeholder_on_a_DISAGREEING_row_is_left_alone(self):
        """Deliberately asymmetric. A dash beside a DISAGREE is a row whose
        resolution nobody has written, and blanking it would hide that."""
        r = self.render(an_audit([a_row(agree=False, resolution="-")]))
        self.assertTrue(r.body_rows[0][6].startswith("-"))

    def test_a_row_with_no_resolution_key_at_all_does_not_crash(self):
        r = self.render(an_audit([a_row(agree=True, without=("resolution",))]))
        self.assertIn("bt: ", r.body_rows[0][6])


# =====================================================================
# 3. THE SOURCES -- every citation, not the two the code happened to name
# =====================================================================
class TheSourcesCited(GenDisagreementsCase):

    def test_the_two_ordinary_sources_print_in_their_settled_order(self):
        r = self.render(an_audit([a_row()]))
        tail = r.body_rows[0][6]
        self.assertLess(tail.index("bt: "), tail.index("op: "))

    def test_a_press_source_reaches_the_document(self):
        """THE THIRD FAULT. Two committed rows cite `press`, and both are the
        High Wycombe route 20 reversal, where the article IS the evidence for
        the exclusion. The cell was assembled from two named keys, so it went."""
        r = self.render(an_audit([a_row(agree=False, sources={
            "bustimes": "https://bustimes.org/services/20",
            "operator": "https://arriva.example/20",
            "press": "https://www.maidenhead-advertiser.co.uk/news/706719/"})]))
        self.assertIn("press: https://www.maidenhead-advertiser.co.uk/news/706719/",
                      r.body_rows[0][6])

    def test_an_unknown_source_keeps_the_two_known_ones_first(self):
        """So that widening the set cannot reorder the 1,439 rows that carry
        only the two -- the property that makes this change invisible on every
        committed audit but the two."""
        r = self.render(an_audit([a_row(sources={"press": "https://p.example/",
                                                 "operator": "https://o.example/",
                                                 "bustimes": "https://b.example/"})]))
        tail = r.body_rows[0][6]
        self.assertLess(tail.index("bt: "), tail.index("op: "))
        self.assertLess(tail.index("op: "), tail.index("press: "))

    def test_a_row_citing_nothing_prints_only_its_resolution(self):
        r = self.render(an_audit([a_row(agree=False, resolution="Operator site wins.",
                                        sources={})]))
        self.assertEqual(r.body_rows[0][6], "Operator site wins.")

    def test_a_row_with_no_sources_key_at_all_does_not_crash(self):
        r = self.render(an_audit([a_row(without=("sources",))]))
        self.assertEqual(r.body_rows[0][6], "")


# =====================================================================
# 4. THE VERDICT COLUMN AND ITS SHADING -- what a reader scans for
# =====================================================================
class TheAgreeColumn(GenDisagreementsCase):

    def test_an_agreeing_row_says_agree_and_is_shaded_green(self):
        r = self.render(an_audit([a_row(agree=True)]))
        self.assertEqual(r.body_rows[0][5], "agree")
        self.assertEqual(fill_of(r.cell(0, 5)), GD.AGREE_FILL)

    def test_a_disagreeing_row_shouts_and_is_shaded_red(self):
        r = self.render(an_audit([a_row(agree=False)]))
        self.assertEqual(r.body_rows[0][5], "DISAGREE")
        self.assertEqual(fill_of(r.cell(0, 5)), GD.CONFLICT_FILL)

    def test_the_whole_row_is_shaded_not_only_the_verdict_cell(self):
        """The shading is how the eye finds a conflict in a 60-row table; one
        coloured cell in seven would not."""
        r = self.render(an_audit([a_row(agree=False)]))
        self.assertEqual({fill_of(r.cell(0, i)) for i in range(7)}, {GD.CONFLICT_FILL})

    def test_a_row_that_says_nothing_about_agreement_is_treated_as_a_disagreement(self):
        """PINNED, NOT CHOSEN TODAY. Both defaults assert something the data
        does not say. This is the loud one, it is what every version of this
        module has done, and no committed row omits the key."""
        r = self.render(an_audit([a_row(without=("agree",))]))
        self.assertEqual(r.body_rows[0][5], "DISAGREE")

    def test_the_conflict_count_in_the_subtitle_is_the_count_of_red_rows(self):
        r = self.render(an_audit([a_row("1", True), a_row("2", False), a_row("3", False)]))
        self.assertIn("3 check(s), 2 disagreement(s)", r.subtitle)


# =====================================================================
# 5. THE SUMMARY -- the block a reader who reads nothing else reads
# =====================================================================
class TheDisagreementsSummary(GenDisagreementsCase):

    def test_every_conflict_gets_a_bullet_naming_both_sides_and_the_resolution(self):
        r = self.render(an_audit([a_row("55", False, operator="Whippet",
                                        field="terminus", bustimes="Huntingdon",
                                        operator_says="St Ives",
                                        resolution="Operator site wins")]))
        whole = r.whole
        self.assertIn("55 (Whippet) — terminus:", whole)
        self.assertIn("bustimes.org: Huntingdon; operator: St Ives.", whole)
        self.assertIn("Resolution: Operator site wins.", whole)

    def test_an_audit_with_no_conflicts_says_the_sources_agreed(self):
        r = self.render(an_audit([a_row("1", True), a_row("2", True)]))
        self.assertIn("No disagreements found", r.whole)
        self.assertNotIn("Disagreements summary", r.whole)

    def test_an_audit_with_no_rows_does_not_report_agreement(self):
        """LATENT, and the one fault here that has never shipped: with nothing
        checked, the sentence above claimed every operator site agreed. An
        audit with no rows has not found agreement, it has found nothing."""
        r = self.render(an_audit([]))
        self.assertNotIn("No disagreements found", r.whole)
        self.assertIn("No checks are recorded in this audit", r.whole)

    def test_an_audit_with_no_rows_key_at_all_is_the_same_case(self):
        r = self.render(an_audit(without=("rows",)))
        self.assertIn("No checks are recorded in this audit", r.whole)
        self.assertIn("0 check(s), 0 disagreement(s)", r.subtitle)


# =====================================================================
# 6. THE HEADING AND SUBTITLE -- what the document says it is about
# =====================================================================
class TheHeadingAndSubtitle(GenDisagreementsCase):

    def test_the_town_is_named_in_the_title(self):
        r = self.render(an_audit(town="Wisbech"))
        self.assertIn("Wisbech", r.paragraphs[0])
        self.assertIn("bustimes.org vs operator audit", r.paragraphs[0])

    def test_the_valid_from_date_is_printed_when_there_is_one(self):
        r = self.render(an_audit(validFrom="September 2026"))
        self.assertIn("service data valid from September 2026", r.subtitle)

    def test_no_valid_from_leaves_no_dangling_phrase(self):
        r = self.render(an_audit(without=("validFrom",)))
        self.assertNotIn("valid from", r.subtitle)

    def test_the_generated_stamp_is_the_one_the_json_recorded(self):
        """26 of the 49 committed audits carry no generatedAt and get today's
        date; where the JSON has one it is the audit's date, not the render's."""
        r = self.render(an_audit(generatedAt="2026-06-05T16:30"))
        self.assertIn("Generated 2026-06-05T16:30", r.subtitle)

    def test_a_missing_generated_stamp_is_filled_rather_than_left_blank(self):
        r = self.render(an_audit(without=("generatedAt",)))
        self.assertNotIn("Generated   ", r.subtitle)
        self.assertRegex(r.subtitle, r"Generated 20\d\d-")

    def test_a_missing_town_does_not_print_the_word_none(self):
        r = self.render(an_audit(without=("town",)))
        self.assertNotIn("None", r.paragraphs[0])


# =====================================================================
# 7. THE TABLE GEOMETRY -- the helper whose own comment says what the bug was
# =====================================================================
class TheTableGeometry(GenDisagreementsCase):

    def test_the_grid_and_the_cells_agree(self):
        """`table.autofit` alone is not enough: the customer-facing PDF is
        rendered by headless LibreOffice, and python-docx leaves `tblGrid` at
        the equal widths it created the table with. That the two AGREE is the
        property; no particular width is."""
        r = self.render(an_audit([a_row()]))
        grid = [int(gc.get(qn("w:w"))) for gc in
                r.table._tbl.find(qn("w:tblGrid")).findall(qn("w:gridCol"))]
        self.assertEqual(len(grid), 7)
        self.assertEqual(grid, [c.width.twips for c in r.table.rows[0].cells])
        self.assertGreater(grid[6], grid[0])   # Resolution / source beats Route

    def test_every_row_has_the_seven_columns_the_header_declares(self):
        r = self.render(an_audit([a_row(str(i), i % 2 == 0) for i in range(6)]))
        self.assertTrue(all(len(row) == 7 for row in r.grid))
        self.assertEqual(len(r.body_rows), 6)

    def test_the_header_row_is_the_column_names_in_order(self):
        r = self.render(an_audit([a_row()]))
        self.assertEqual(r.grid[0], ["Route", "Operator", "Field", "bustimes.org says",
                                     "Operator says", "Agree?", "Resolution / source"])


# =====================================================================
# 8. THE COMMAND LINE -- where the file lands, and what it stamps
# =====================================================================
class TheCommandLine(GenDisagreementsCase):

    def test_no_arguments_exits_with_the_usage_rather_than_a_traceback(self):
        saved = sys.argv[:]
        sys.argv[:] = ["gen_disagreements.py"]
        try:
            with self.assertRaises(SystemExit) as caught:
                GD.main()
        finally:
            sys.argv[:] = saved
        self.assertIn("usage:", str(caught.exception))

    def test_with_no_out_path_the_document_lands_beside_its_json(self):
        """Not beside the caller's cwd, which for a stage engine is some other
        stage's run folder. The sub-directory is what makes the two differ.

        Run from a THIRD directory, neither the run folder nor the repository,
        exactly as the twin case in `test_gen_verification.py` is -- and for the
        reason that twin's comment gives. The mutation this case exists for
        replaces the joined path with a bare filename, which resolves against
        the cwd: standing in the run folder would make the mutant PASS, and
        standing in the checkout makes the mutant WRITE A 37 KB .docx INTO
        `test/python/` before this case fails it. `prove-red-python.py` runs
        every suite with `cwd=TESTS`, so the checkout is where it stood, and
        that litter -- untracked, invisible to CI because `actions/checkout`
        throws the tree away -- is what OA-001 recorded on 2026-09-18 and
        blamed on the fixture. It was never the fixture; it was this missing
        line, which the twin has had since it was written."""
        elsewhere = tempfile.mkdtemp(prefix="gd-cwd-")
        self.addCleanup(shutil.rmtree, elsewhere, True)
        here = os.getcwd()
        os.chdir(elsewhere)
        self.addCleanup(os.chdir, here)
        r = self.render(an_audit(), argv_out=False, sub="S1-services/2026-09-16_1115")
        self.assertTrue(r.path.endswith(os.path.join("2026-09-16_1115", "disagreements.docx")))
        self.assertTrue(os.path.exists(r.path))
        self.assertEqual(os.path.dirname(os.path.abspath(r.path)),
                         os.path.abspath(os.path.join(self.dir, "S1-services", "2026-09-16_1115")))

    def test_an_explicit_output_path_is_honoured(self):
        r = self.render(an_audit(), out_name="named.docx")
        self.assertTrue(r.path.endswith("named.docx"))
        self.assertTrue(os.path.exists(r.path))

    def test_the_created_stamp_is_not_python_docxs_own_2013_default(self):
        """Why it is stamped at all: Explorer shows the template's 2013-12-23
        in its Date column and a reader takes it for the date of the audit."""
        r = self.render(an_audit())
        created = r.doc.core_properties.created
        self.assertIsNotNone(created)
        # By YEAR: python-docx hands these back timezone-aware, and a naive
        # literal beside one is a TypeError rather than a failure.
        self.assertGreaterEqual(created.year, 2020)


# =====================================================================
# 9. THE CUSTOMER-FACING PDF -- the one step that is allowed to fail
# =====================================================================
class TheCustomerFacingPdf(GenDisagreementsCase):

    def test_the_document_written_is_the_document_offered_for_conversion(self):
        """The .docx is the editable source of truth and the PDF is what a
        customer sees, so the two must be the same file. Asserted with a spy:
        soffice is installed on this laptop and absent on a CI runner, and a
        suite whose path depends on that is a suite measuring the machine."""
        r = self.render(an_audit(), out_name="named.docx")
        self.assertEqual(self.converted, [r.path])

    def test_a_machine_with_no_libreoffice_still_gets_its_docx(self):
        """The module's own promise -- best effort, never blocks. CI is that
        machine, so this is the path that actually runs in the gate."""
        saved = GD.SOFFICE_CANDIDATES[:]
        GD.SOFFICE_CANDIDATES[:] = []
        self.addCleanup(lambda: GD.SOFFICE_CANDIDATES.__setitem__(slice(None), saved))
        out = os.path.join(self.dir, "no-soffice.docx")
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            self.assertIsNone(GD.convert_to_pdf(out))
        self.assertIn("skipped PDF conversion", printed.getvalue())


if __name__ == "__main__":
    unittest.main()
