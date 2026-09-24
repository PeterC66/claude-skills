"""boarding_verify.py -- the checker that stands in for S6 on every place map, whose own faults can only ever look like a clean bill of health.

WHY THIS MODULE AND NOT ANOTHER OF THE EIGHT. OA-001's measure for the Python
round has been *which fault would nobody ever find*, and this file answers it by
construction rather than by circumstance. Every other module in `assets/`
computes something: a wrong answer there becomes a wrong sheet, and a wrong
sheet can be looked at. This one computes a VERDICT, and the failure mode of a
verdict is silence -- a checker that has stopped checking prints exactly what a
clean sheet prints. `boarding-plan-product_2026-08-22.md` sec 4 put it in the
file's own header: place maps have no S6, so this is the only thing standing
between a reader and a sheet that tells them to wait at a bay no bus leaves
from. Nothing downstream re-asks the question, and no byte gate can: the sheet
it certifies is perfectly reproducible whether the certificate is worth
anything or not.

THE HEADER ALREADY NAMED THE TEST THIS FILE IS. *"PROVE IT CAN GO RED before
trusting it green (the paper's own house rule, and `feedback_prove_the_check_can_fail`)"*,
and it ships a `--self-test` switch for exactly that. What it could not do is
prove the OTHER four checks can go red, and `--self-test` corrupts an S-1 label
and nothing else. So `TheSelfTest` below asserts the switch does what it claims,
and every other class is the same question asked of the check the switch cannot
reach.

EVERY CHECK IS DRIVEN THROUGH `main()`, because all five of them are closures
inside it over two open sqlite connections -- the shape OA-001 has met three
times now (`boarding_index.py`'s rollup, `naptan_stands.py`'s uniqueness rule,
and here). The pattern is the one that action named: stub the data, do not read
a dataset. `_stubs.py` builds both databases from the real builders' own
schemas, so a fixture cannot declare a column `naptan_build.py` does not make.

`--asof` IS PASSED EXPLICITLY, or supplied by the fixture index, and never left
to the clock. A count taken against today is an input nobody declared, which is
what OA-289 retired on -- see *Clock-dependent artefact* in the glossary.

WHAT IS DELIBERATELY NOT ASSERTED. The `checkedAt` field of the durable record
IS today's date, and a test pinning it would be pinning the clock; what is
asserted is that the field is present and is an ISO date, which is the property
the record needs. And nothing here reads `_gtfs/`: the whole point of the stub
is that an assertion about the register is not an assertion about what BODS
published that week.
"""
import contextlib
import io
import json
import os
import re
import shutil
import sys
import unittest

import _engine
import _stubs

bv = _engine.load("boarding_verify")


# --------------------------------------------------------------------------
# The register. Every row is a fault this project has actually printed, or the
# control that stops the fault's absence being satisfied by an empty fixture.
#
# (ATCO, CommonName, Indicator, LocalityName, ParentLocalityName, area)
REGISTER = [
    # The frame itself. Three stands whose labels are DERIVED by
    # `naptan_build.derive_stand` from the Indicator, so a fixture cannot
    # declare a stand code the real builder would not have made.
    ("BAY1", "St Ives Bus Station", "Bay 1", "St Ives", None, "071"),
    ("BAY2", "St Ives Bus Station", "Bay 2", "St Ives", None, "071"),
    ("STOPC", "Market Hill", "C", "St Ives", None, "071"),
    # "opp" is a relative descriptor and not a stand, so this stop's only
    # honest label is its CommonName.
    ("QUAY", "The Quay", "opp", "St Ives", None, "071"),
    # Destinations.
    ("HUNT", "Huntingdon Bus Station", None, "Huntingdon", None, "071"),
    # Two hops up: Orchard Park -> Kings Hedges -> Cambridge. One hop prints a
    # Cambridge housing estate as though it were a town.
    ("ORCH", "Orchard Park", None, "Orchard Park", "Kings Hedges", "071"),
    ("KHED", "Kings Hedges Road", None, "Kings Hedges", "Cambridge", "071"),
    # A joint civil parish: a union of villages that keep their own names, so
    # NaPTAN offers two honest answers and the checker must accept either.
    ("NEED", "Needingworth Green", None, "Needingworth", "Holywell-cum-Needingworth", "071"),
    # ...and a hamlet merely CONTAINED in a compound name is not one of its
    # halves, so it still rolls up. The control for the clause above.
    ("FENT", "Fenton End", None, "Fenton End", "Pidley cum Fenton", "071"),
    # "Church End" carries two DIFFERENT parents, so no single parent may be
    # applied to the one that declares none.
    ("CHUR0", "Church End", None, "Church End", None, "071"),
    ("CHUR1", "Church End, Eltisley", None, "Church End", "Eltisley", "071"),
    ("CHUR2", "Church End, Swavesey", None, "Church End", "Swavesey", "071"),
    # A namesake over a county line. Cambridgeshire's Barton declares no
    # parent, and keying the lookup on the bare name makes it a suburb of
    # Oxford.
    ("BART", "Barton Turn", None, "Barton", None, "071"),
    ("BARTOX", "Barton, Oxon", None, "Barton", "Oxford", "090"),
    ("WARB", "Warboys Clock", None, "Warboys", None, "071"),
]

# (trip_id, route_short_name, [stop sequence], service_id)
TRIPS = [
    ("T1", "1", ["BAY1", "HUNT"], "S1"),
    ("T2", "2", ["BAY2", "KHED"], "S1"),
    ("T3", "3", ["BAY1", "NEED"], "S1"),
    # DEPARTURES ONLY. Route 4's journey TERMINATES in the frame, so Warboys is
    # somewhere Bay 2 is reached FROM and not somewhere it goes.
    ("T4", "4", ["WARB", "BAY2"], "S1"),
    ("T5", "5", ["STOPC", "HUNT"], "S1"),
    ("T6", "6", ["BAY1", "FENT"], "S1"),
    # The High Wycombe 654: a school working the sheet's config excludes, which
    # made one stop look like a better boarding point than the bay for three
    # villages the sheet does not claim it serves.
    ("T7", "654", ["STOPC", "WARB"], "S1"),
    # A registration that has expired, for S-5. It must produce a NOTE and
    # never a failure -- a checker that fails on a date is one that gets muted.
    ("T8", "8", ["BAY2", "WARB"], "S_OLD"),
    # A service carrying no calendar row AT ALL. Absent is not expired, and
    # this checker stays the more permissive of the two files on purpose.
    ("T9", "9", ["STOPC", "ORCH"], "S_NONE"),
    ("T10", "10", ["BAY1", "CHUR0"], "S1"),
    ("T11", "11", ["BAY1", "BART"], "S1"),
]

ASOF = "2026-09-01"

STANDS = [
    {"atco": "BAY1", "label": "Bay 1", "walkMin": 1, "distM": 20},
    {"atco": "BAY2", "label": "Bay 2", "walkMin": 2, "distM": 60},
    {"atco": "STOPC", "label": "Stand C", "walkMin": 3, "distM": 120},
]

DESTS = [
    {"destination": "Huntingdon", "boardAt": "Bay 1", "boardAtAtco": "BAY1"},
    {"destination": "Cambridge", "boardAt": "Bay 2", "boardAtAtco": "BAY2"},
    {"destination": "Pidley cum Fenton", "boardAt": "Bay 1", "boardAtAtco": "BAY1"},
]


def sheet(names, glyphs=("1", "2")):
    """A boarding.svg printing `names` as destinations and `glyphs` as bay codes.

    The glyphs carry `class="bstand"` because that is what S-4 matches on: a
    first cut of that check looked for any short <text> and duly reported the
    north arrow's "N" as an unsanctioned bay.
    """
    out = ['<svg xmlns="http://www.w3.org/2000/svg">']
    for g in glyphs:
        out.append('<text class="bstand" x="10" y="10">%s</text>' % g)
    for n in names:
        out.append("<text x=\"10\" y=\"20\">%s</text>" % n)
    out.append("</svg>")
    return "\n".join(out)


class Fixture(unittest.TestCase):
    """Lay the two databases and the stage folder out, and run `main()`."""

    def run_verify(self, dests=None, stands=None, svg="DEFAULT", routes_json=None,
                   index_extra=None, extra_trips=(), argv_extra=(), asof=ASOF,
                   pass_db=True, write_index=True, routes_raw=None, region_as=None):
        folder = _stubs.scratch("boarding-verify-")
        self.addCleanup(shutil.rmtree, folder, True)

        nap_rows = []
        for i, (atco, common, ind, loc, parent, area) in enumerate(REGISTER):
            nap_rows.append({"ATCOCode": atco, "CommonName": common, "Indicator": ind,
                             "StopType": "BCT", "LocalityName": loc,
                             "ParentLocalityName": parent,
                             "AdministrativeAreaCode": area,
                             "lat": 52.32 + i * 0.01, "lon": -0.07})
        napath = _stubs.naptan_db(os.path.join(folder, "naptan.sqlite"), nap_rows)

        routes, trips, stop_times = {}, [], []
        for tid, rname, seq, sid in list(TRIPS) + list(extra_trips):
            routes[rname] = {"route_id": "R" + rname, "route_short_name": rname,
                             "route_type": "3"}
            trips.append({"trip_id": tid, "route_id": "R" + rname, "service_id": sid})
            for n, atco in enumerate(seq, 1):
                stop_times.append({"trip_id": tid, "stop_id": atco, "stop_sequence": str(n)})
        db = _stubs.gtfs_db(os.path.join(folder, "region.sqlite"), {
            "routes": list(routes.values()),
            "trips": trips,
            "stop_times": stop_times,
            # S_NONE is deliberately absent from this table.
            "calendar": [_stubs.every_day("S1"),
                         {"service_id": "S_OLD", "start_date": "20200101",
                          "end_date": "20201231", "monday": "1", "tuesday": "1",
                          "wednesday": "1", "thursday": "1", "friday": "1",
                          "saturday": "1", "sunday": "1"}],
        })

        _stubs.write_json(os.path.join(folder, "place.json"),
                          {"name": "A Frame With One Verdict In It"})
        if write_index:
            index = {"destinations": list(DESTS if dests is None else dests),
                     "stands": list(STANDS if stands is None else stands)}
            index.update(index_extra or {})
            _stubs.write_json(os.path.join(folder, "boarding_index.json"), index)
        if routes_json is not None:
            _stubs.write_json(os.path.join(folder, "routes.json"), routes_json)
        if routes_raw is not None:
            with io.open(os.path.join(folder, "routes.json"), "w", encoding="utf-8") as fh:
                fh.write(routes_raw)
        if region_as:
            # Where the estate really keeps them: `_gtfs/<region>` above the
            # stage folder, which is what `find_up` climbs to.
            os.makedirs(os.path.join(folder, "_gtfs"), exist_ok=True)
            shutil.copyfile(db, os.path.join(folder, "_gtfs", region_as))
        if svg == "DEFAULT":
            svg = sheet([d["destination"] for d in (DESTS if dests is None else dests)])
        if svg is not None:
            with io.open(os.path.join(folder, "boarding.svg"), "w", encoding="utf-8") as fh:
                fh.write(svg)

        argv = ["boarding_verify.py", "--dir", folder, "--naptan", napath]
        if pass_db:
            argv += ["--db", db]
        if asof:
            argv += ["--asof", asof]
        argv += list(argv_extra)

        saved = sys.argv
        sys.argv = argv
        buf, err = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
                rc = bv.main()
        finally:
            sys.argv = saved
        self.folder = folder
        self.err = err.getvalue()
        return rc, buf.getvalue()

    # -- readers over the printed report ------------------------------------
    def findings(self, out, severity=None, check=None):
        got = re.findall(r"^  \[(HARD|SOFT) (S-\d)\] (.*)$", out, re.M)
        return [(s, c, m) for s, c, m in got
                if (severity is None or s == severity) and (check is None or c == check)]

    def assertClean(self, rc, out):
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.findings(out), [], out)
        self.assertIn("all checks pass", out)

    def record(self, name="boarding-verify.json"):
        with io.open(os.path.join(self.folder, name), encoding="utf-8") as fh:
            return json.load(fh)


class TheHappyPath(Fixture):
    """A sheet that is right must be SILENT, and this is the case the other
    classes are measured against.

    Written first on purpose. A checker whose green case has never been seen is
    one that goes red on its first real town and gets muted in a week -- this
    project's own rule, and the reason S-3 stopped measuring metres.
    """

    def test_a_correct_sheet_passes_with_nothing_to_say(self):
        rc, out = self.run_verify()
        self.assertClean(rc, out)

    def test_it_says_how_much_it_looked_at(self):
        """The counts are the difference between 'all checks pass' and 'there
        was nothing to check'. A frame with no destinations passes identically."""
        rc, out = self.run_verify()
        self.assertIn("3 destination row(s), 3 boarding point(s)", out)
        self.assertIn("3 label(s) matched NaPTAN", out)

    def test_the_verdict_line_is_printed(self):
        rc, out = self.run_verify()
        self.assertIn("RESULT: PASS", out)


class Labels(Fixture):
    """S-1: every label the sheet prints must be what NaPTAN says for that ATCO.

    Rule 3 of the product paper is that a letter we invented is worse than no
    letter, because a reader standing in a bus station can only act on a code
    that is on the flag in front of them.
    """

    def test_a_label_naptan_does_not_say_is_HARD(self):
        dests = [dict(DESTS[0], boardAt="Bay 9")]
        rc, out = self.run_verify(dests=dests, svg=sheet(["Huntingdon"]))
        self.assertEqual(rc, 1)
        self.assertEqual(len(self.findings(out, "HARD", "S-1")), 1)
        self.assertIn("NaPTAN says 'Bay 1'", out)

    def test_the_comparison_is_against_NAPTAN_and_not_against_the_index(self):
        """The header's own reason for existing: `stands.json` was written by
        the same pipeline that drew the sheet, so scoring our output against
        our output would certify the bug. A stand entry that AGREES with the
        wrong label must not rescue it."""
        dests = [dict(DESTS[0], boardAt="Bay 9")]
        stands = [dict(STANDS[0], label="Bay 9"), STANDS[1], STANDS[2]]
        rc, out = self.run_verify(dests=dests, stands=stands, svg=sheet(["Huntingdon"]))
        self.assertEqual(rc, 1)
        self.assertEqual(len(self.findings(out, "HARD", "S-1")), 1)

    def test_a_boarding_point_with_no_naptan_row_at_all_is_HARD(self):
        """Not a skip. An ATCO the register has never heard of is the one case
        where the checker has nothing to compare against, and saying nothing
        there is indistinguishable from saying the label is right."""
        dests = [{"destination": "Huntingdon", "boardAt": "Bay 1", "boardAtAtco": "NOSUCH"}]
        stands = [{"atco": "NOSUCH", "label": "Bay 1", "walkMin": 1, "distM": 20}]
        rc, out = self.run_verify(dests=dests, stands=stands, svg=sheet(["Huntingdon"], glyphs=()))
        self.assertEqual(rc, 1)
        self.assertTrue(any("no NaPTAN row at all" in m
                            for _, _, m in self.findings(out, "HARD", "S-1")), out)

    def test_the_word_in_front_of_the_code_comes_from_the_register(self):
        """`derive_stand` keeps the authority's own word -- a bay is not a
        stand and a gate is not a bay -- so the sheet must print the one the
        register carries, not a house default."""
        dests = [dict(DESTS[0], boardAt="Stand 1")]
        rc, out = self.run_verify(dests=dests, svg=sheet(["Huntingdon"]))
        self.assertEqual(rc, 1)
        self.assertIn("NaPTAN says 'Bay 1'", out)

    def test_a_bare_code_is_printed_as_a_STAND(self):
        """Some authorities put the bare code in Indicator with no word in
        front, and `derive_stand` flags it 'bare'. There is no word to keep, so
        the sheet says Stand -- which is why 'bare' is special-cased rather
        than capitalised like every other kind."""
        dests = [{"destination": "Huntingdon", "boardAt": "Stand C", "boardAtAtco": "STOPC"}]
        stands = [STANDS[2]]
        rc, out = self.run_verify(dests=dests, stands=stands,
                                  svg=sheet(["Huntingdon"], glyphs=("C",)))
        self.assertEqual(self.findings(out, "HARD", "S-1"), [], out)

    def test_a_stop_that_is_not_a_stand_is_printed_under_its_common_name(self):
        """'opp' is a relative descriptor, so there is no code to print and the
        only honest label is the name on the flag."""
        dests = [{"destination": "Huntingdon", "boardAt": "The Quay", "boardAtAtco": "QUAY"}]
        stands = [{"atco": "QUAY", "label": "The Quay", "walkMin": 1, "distM": 10}]
        rc, out = self.run_verify(dests=dests, stands=stands, svg=None)
        self.assertEqual(self.findings(out, "HARD", "S-1"), [], out)
        # ...and the same stop under a code nobody gave it is still HARD.
        dests = [dict(dests[0], boardAt="Stand Q")]
        rc, out = self.run_verify(dests=dests, stands=stands, svg=None)
        self.assertEqual(len(self.findings(out, "HARD", "S-1")), 1, out)

    def test_every_destination_row_is_checked_and_not_just_the_first(self):
        dests = [dict(DESTS[0], boardAt="Bay 9"), dict(DESTS[1], boardAt="Bay 8")]
        rc, out = self.run_verify(dests=dests, svg=sheet(["Huntingdon", "Cambridge"]))
        self.assertEqual(len(self.findings(out, "HARD", "S-1")), 2, out)


class TheSelfTest(Fixture):
    """`--self-test` is the switch the module's own header offers in place of
    hand-editing a committed file, and until now nothing asserted it works.

    It is the only part of this module whose whole job is to FAIL, so a
    regression in it reads as a sheet that is fine.
    """

    def test_it_relabels_a_row_and_S1_must_object(self):
        rc, out = self.run_verify(argv_extra=["--self-test"])
        self.assertEqual(rc, 1, out)
        self.assertIn("[self-test]", out)
        self.assertTrue(any("Bay 99" in m for _, _, m in self.findings(out, "HARD", "S-1")), out)

    def test_it_refuses_rather_than_passing_when_there_is_nothing_to_corrupt(self):
        """A frame with no destinations would otherwise let --self-test print a
        clean bill of health, which is the exact inversion of what it is for."""
        rc, out = self.run_verify(dests=[], svg=sheet([], glyphs=("1", "2")),
                                  argv_extra=["--self-test"])
        self.assertEqual(rc, 2)
        self.assertIn("needs at least one destination", self.err)


class Departures(Fixture):
    """S-2: some trip must call at the stand and LATER reach the destination.

    Re-derived from `stop_times` rather than read back from
    `boarding_index.json`, so a bug in the index cannot pass by agreeing with
    itself. This is the check that makes the file worth running at all -- the
    two files share their locality rollup and are independent only about this.
    """

    def test_a_pair_no_trip_supports_is_HARD(self):
        dests = [{"destination": "Warboys", "boardAt": "Bay 1", "boardAtAtco": "BAY1"}]
        rc, out = self.run_verify(dests=dests, svg=sheet(["Warboys"]))
        self.assertEqual(rc, 1)
        self.assertEqual(len(self.findings(out, "HARD", "S-2")), 1, out)
        self.assertIn("no trip departs", out)

    def test_a_place_the_stand_is_reached_FROM_is_not_a_place_it_goes(self):
        """Route 4 terminates in the frame. An index built from 'which routes
        call here' prints Warboys against Bay 2 anyway, and a reader waits at a
        bay for a bus that only ever arrives there."""
        dests = [{"destination": "Warboys", "boardAt": "Bay 2", "boardAtAtco": "BAY2"}]
        stands = [STANDS[1]]
        rc, out = self.run_verify(dests=dests, stands=stands,
                                  svg=sheet(["Warboys"], glyphs=("2",)),
                                  asof=ASOF)
        # T8 reaches Warboys from Bay 2 but its registration has expired, so
        # S-2 (which is undated on purpose) passes and S-5 notes it.
        self.assertEqual(self.findings(out, "HARD", "S-2"), [], out)
        # ...and with that trip's route excluded there is nothing left at all.
        rc, out = self.run_verify(dests=dests, stands=stands,
                                  svg=sheet(["Warboys"], glyphs=("2",)),
                                  routes_json={"boardingPlan": {"excludeRoutes": ["8"]}})
        self.assertEqual(len(self.findings(out, "HARD", "S-2")), 1, out)

    def test_the_sheets_own_excluded_routes_govern_what_the_checker_counts(self):
        """The High Wycombe 654. `boardingPlan.excludeRoutes` decides which
        services the SHEET indexes, so it has to decide what the checker
        compares it against, or the two are describing different sheets."""
        dests = [{"destination": "Warboys", "boardAt": "Stand C", "boardAtAtco": "STOPC"}]
        stands = [STANDS[2]]
        svg = sheet(["Warboys"], glyphs=("C",))
        rc, out = self.run_verify(dests=dests, stands=stands, svg=svg)
        self.assertEqual(self.findings(out, "HARD", "S-2"), [], out)
        rc, out = self.run_verify(dests=dests, stands=stands, svg=svg,
                                  routes_json={"boardingPlan": {"excludeRoutes": ["654"]}})
        self.assertEqual(len(self.findings(out, "HARD", "S-2")), 1, out)

    def test_an_unreadable_routes_json_does_not_stop_the_run(self):
        """The exclusion list is an optimisation of the comparison, not a
        precondition of it. A checker that refuses to run because one optional
        file will not parse is a checker that gets skipped -- and then it is
        not watching the bays either. The file here is genuinely malformed, so
        the `except` around the read is what is being exercised."""
        rc, out = self.run_verify(routes_raw="{ this is not json")
        self.assertClean(rc, out)


class TheNameAPlaceIsPrintedUnder(Fixture):
    """Which names S-2 will ACCEPT for a stop.

    The rollup itself belongs to `boarding_index.py` and is tested there. What
    is tested here is the half this file owns: it re-derives the name
    independently, so a difference of NAMING between the two files must not be
    reported as a bus that does not run.
    """

    def test_the_climb_does_not_stop_at_the_first_parent(self):
        """Orchard Park -> Kings Hedges -> Cambridge. One hop accepts a
        Cambridge housing estate as the destination and rejects Cambridge."""
        dests = [{"destination": "Cambridge", "boardAt": "Stand C", "boardAtAtco": "STOPC"}]
        stands = [STANDS[2]]
        rc, out = self.run_verify(dests=dests, stands=stands,
                                  svg=sheet(["Cambridge"], glyphs=("C",)))
        self.assertEqual(self.findings(out, "HARD", "S-2"), [], out)

    def test_an_un_rolled_child_name_is_NOT_accepted(self):
        """Deliberately not 'any un-rolled name will do'. That would let the
        sheet print Kings Hedges for Cambridge and still pass, because a bus
        does reach Kings Hedges."""
        dests = [{"destination": "Kings Hedges", "boardAt": "Bay 2", "boardAtAtco": "BAY2"}]
        stands = [STANDS[1]]
        rc, out = self.run_verify(dests=dests, stands=stands,
                                  svg=sheet(["Kings Hedges"], glyphs=("2",)))
        self.assertEqual(len(self.findings(out, "HARD", "S-2")), 1, out)

    def test_either_half_of_a_joint_parish_is_an_honest_name(self):
        """Route 301's Needingworth stops print 'Needingworth' rather than the
        parish name, because the parish name sent a reader looking for a
        village that was not in the index. Both must pass."""
        for name in ("Needingworth", "Holywell-cum-Needingworth"):
            dests = [{"destination": name, "boardAt": "Bay 1", "boardAtAtco": "BAY1"}]
            rc, out = self.run_verify(dests=dests, stands=[STANDS[0]],
                                      svg=sheet([name], glyphs=("1",)))
            self.assertEqual(self.findings(out, "HARD", "S-2"), [], "%s: %s" % (name, out))

    def test_a_hamlet_merely_CONTAINED_in_a_compound_name_still_rolls_up(self):
        """Fenton End is not a half of 'Pidley cum Fenton'. Most stops in that
        parish carry the parish name directly, so un-rolling this one would
        print one village under two names."""
        dests = [{"destination": "Fenton End", "boardAt": "Bay 1", "boardAtAtco": "BAY1"}]
        rc, out = self.run_verify(dests=dests, stands=[STANDS[0]],
                                  svg=sheet(["Fenton End"], glyphs=("1",)))
        self.assertEqual(len(self.findings(out, "HARD", "S-2")), 1, out)

    def test_a_name_carrying_two_different_parents_is_given_none(self):
        """'Church End' has five parents in the real register. Applying any one
        of them to the row that declares none moves a village 80 miles."""
        dests = [{"destination": "Church End", "boardAt": "Bay 1", "boardAtAtco": "BAY1"}]
        rc, out = self.run_verify(dests=dests, stands=[STANDS[0]],
                                  svg=sheet(["Church End"], glyphs=("1",)))
        self.assertEqual(self.findings(out, "HARD", "S-2"), [], out)

    def test_the_parent_lookup_is_scoped_to_one_administrative_area(self):
        """Cambridgeshire's Barton declares no parent and inherits Oxford's the
        moment the key drops the area. The `ambiguous` guard cannot catch it,
        because a namesake carrying NO parent reads as agreement."""
        dests = [{"destination": "Barton", "boardAt": "Bay 1", "boardAtAtco": "BAY1"}]
        rc, out = self.run_verify(dests=dests, stands=[STANDS[0]],
                                  svg=sheet(["Barton"], glyphs=("1",)))
        self.assertEqual(self.findings(out, "HARD", "S-2"), [], out)


class TheWalk(Fixture):
    """S-3: never send the reader further than the sheet's own arithmetic says
    they need to go. A SOFT finding, and it must stay one.

    Every clause here is a widening made after the check fired on a correct
    sheet. A soft note that cries wolf on its first real town is muted within a
    week, and then it is not watching the bays either.
    """

    HUNT_FROM_C = [{"destination": "Huntingdon", "boardAt": "Stand C", "boardAtAtco": "STOPC"}]

    def test_a_nearer_stand_reaching_the_same_place_is_a_note(self):
        rc, out = self.run_verify(dests=self.HUNT_FROM_C, svg=sheet(["Huntingdon"]))
        self.assertEqual(len(self.findings(out, "SOFT", "S-3")), 1, out)

    def test_a_note_never_fails_the_run(self):
        """The exit code is what a stage gate reads. S-3 is an editorial
        observation and cannot be allowed to block a build."""
        rc, out = self.run_verify(dests=self.HUNT_FROM_C, svg=sheet(["Huntingdon"]))
        self.assertEqual(rc, 0, out)
        self.assertIn("PASS with 1 note(s)", out)

    def test_the_unit_is_the_printed_MINUTE_and_not_the_metre(self):
        """Measured in metres this fired seven times at St Neots, every one of
        them noise: five stands 46-55 m out, all printed '1 min'. Two stands
        the same walk away is the sheet's editorial call, not this file's."""
        stands = [dict(STANDS[0], walkMin=1, distM=20),
                  dict(STANDS[2], walkMin=1, distM=120)]
        rc, out = self.run_verify(dests=self.HUNT_FROM_C, stands=stands,
                                  svg=sheet(["Huntingdon"], glyphs=("1", "C")))
        self.assertEqual(self.findings(out, "SOFT", "S-3"), [], out)

    def test_one_more_minute_bought_with_more_than_three_times_the_service_is_not_a_finding(self):
        """OA-028. `boarding_index.py` promotes a stand at most one printed
        minute further when it carries more than three times the service; left
        alone this check fired on all three promotions the day they shipped."""
        dests = [{"destination": "Huntingdon", "boardAt": "Bay 2", "boardAtAtco": "BAY2"}]
        extra = [("X%d" % i, "1", ["BAY2", "HUNT"], "S1") for i in range(1, 5)]
        rc, out = self.run_verify(dests=dests, extra_trips=extra,
                                  svg=sheet(["Huntingdon"]))
        self.assertEqual(self.findings(out, "SOFT", "S-3"), [], out)

    def test_three_times_is_not_MORE_than_three_times(self):
        """The control for the clause above, and the reason it is a fixture
        rather than an inequality read off the source: a rule with no case
        either side of its boundary is a rule nobody has tested."""
        dests = [{"destination": "Huntingdon", "boardAt": "Bay 2", "boardAtAtco": "BAY2"}]
        extra = [("X%d" % i, "1", ["BAY2", "HUNT"], "S1") for i in range(1, 4)]
        rc, out = self.run_verify(dests=dests, extra_trips=extra,
                                  svg=sheet(["Huntingdon"]))
        self.assertEqual(len(self.findings(out, "SOFT", "S-3")), 1, out)

    def test_the_acceptance_is_not_granted_for_a_walk_two_minutes_longer(self):
        """However much service the further stand carries. The trade the
        generator is allowed to make is one printed minute."""
        extra = [("X%d" % i, "5", ["STOPC", "HUNT"], "S1") for i in range(1, 9)]
        rc, out = self.run_verify(dests=self.HUNT_FROM_C, extra_trips=extra,
                                  svg=sheet(["Huntingdon"]))
        self.assertEqual(len(self.findings(out, "SOFT", "S-3")), 1, out)

    def test_the_trip_count_is_this_files_own_and_not_the_indexs(self):
        """The acceptance must not be grantable by the thing under test. The
        index carries no counts at all in this fixture, and the OA-028 clause
        still fires."""
        dests = [{"destination": "Huntingdon", "boardAt": "Bay 2", "boardAtAtco": "BAY2"}]
        extra = [("X%d" % i, "1", ["BAY2", "HUNT"], "S1") for i in range(1, 5)]
        rc, out = self.run_verify(dests=dests, extra_trips=extra, svg=sheet(["Huntingdon"]))
        self.assertEqual(self.findings(out, "SOFT", "S-3"), [], out)
        self.assertNotIn("journeysPerWeek", out)


class TheSheetItself(Fixture):
    """S-4: the one check that reads the ARTEFACT rather than the data behind it.

    A generator that silently drops rows -- an index too long for its columns
    -- fails here and nowhere else, because every other check is satisfied by
    the index the generator was given.
    """

    def test_a_destination_that_never_reaches_the_sheet_is_HARD(self):
        rc, out = self.run_verify(svg=sheet(["Huntingdon", "Cambridge"]))
        self.assertEqual(rc, 1)
        self.assertTrue(any("never reach the sheet" in m
                            for _, _, m in self.findings(out, "HARD", "S-4")), out)
        self.assertIn("Pidley cum Fenton", out)

    def test_an_abbreviation_the_generator_made_is_accepted(self):
        """A name that will not fit is truncated with a trailing stop, and a
        checker that called that a dropped row would be red on every crowded
        sheet."""
        rc, out = self.run_verify(svg=sheet(["Huntingdon", "Cambridge", "Pidley cum Fent."]))
        self.assertEqual(self.findings(out, "HARD", "S-4"), [], out)

    def test_an_abbreviation_does_not_excuse_a_name_it_is_not_a_prefix_of(self):
        """The control. Accepting any trailing stop anywhere on the sheet would
        make S-4 green for a generator that dropped every row but one."""
        rc, out = self.run_verify(svg=sheet(["Huntingdon", "Cambridge", "Somersh."]))
        self.assertEqual(len(self.findings(out, "HARD", "S-4")), 1, out)
        self.assertIn("Pidley cum Fenton", out)

    def test_a_bay_glyph_naptan_does_not_sanction_is_HARD(self):
        rc, out = self.run_verify(svg=sheet([d["destination"] for d in DESTS],
                                            glyphs=("1", "7")))
        self.assertEqual(rc, 1)
        self.assertTrue(any("bay glyph '7'" in m
                            for _, _, m in self.findings(out, "HARD", "S-4")), out)

    def test_the_full_label_is_sanctioned_as_well_as_the_bare_code(self):
        """The generator draws either, depending on how much room the bay has."""
        rc, out = self.run_verify(svg=sheet([d["destination"] for d in DESTS],
                                            glyphs=("Bay 1", "2")))
        self.assertEqual(self.findings(out, "HARD", "S-4"), [], out)

    def test_a_sheet_with_no_tagged_glyphs_at_all_is_HARD(self):
        """The check that catches this check going blind. If the generator
        stops tagging bay glyphs, every other assertion in S-4 passes over an
        empty set and reports nothing -- which looks exactly like a sheet whose
        bays are all correct."""
        rc, out = self.run_verify(svg=sheet([d["destination"] for d in DESTS], glyphs=()))
        self.assertEqual(rc, 1)
        self.assertTrue(any("this check is blind" in m
                            for _, _, m in self.findings(out, "HARD", "S-4")), out)

    def test_a_frame_with_no_stand_codes_draws_no_glyphs_and_that_is_not_blindness(self):
        """OA-371. A frame of roadside stops has no bay code to draw, so the
        generator tags nothing and the empty set is the right answer. The
        control is the test above: one lettered stand in the frame and the
        same empty sheet is HARD."""
        rc, out = self.run_verify(
            stands=[{"atco": "QUAY", "label": "The Quay", "walkMin": 1, "distM": 20}],
            dests=[{"destination": "Huntingdon", "boardAt": "The Quay", "boardAtAtco": "QUAY"}],
            extra_trips=[("T12", "12", ["QUAY", "HUNT"], "S1")],
            svg=sheet(["Huntingdon"], glyphs=()))
        self.assertClean(rc, out)

    def test_an_absent_sheet_is_reported_as_skipped_rather_than_passed(self):
        """A run with no artefact to read must not print the same thing as a
        run that read one and liked it."""
        rc, out = self.run_verify(svg=None)
        self.assertEqual(rc, 0, out)
        self.assertIn("NOT FOUND (S-4 skipped)", out)


class WhichDayTheSheetIsAbout(Fixture):
    """OA-189: the checker must describe the same population of registrations
    the sheet was built from, and the only file that knows which that was is
    the index itself.

    The whole of S-5 is a NOTE. A checker that fails on a date is a checker
    that gets `--no-verify`d, and then it is not checking the labels either.
    """

    def test_the_date_is_read_from_the_index_by_default(self):
        rc, out = self.run_verify(asof=None, index_extra={"asof": "2026-09-01"},
                                  argv_extra=["--json", "rec.json"])
        self.assertIn("counted as of 2026-09-01 (boarding_index.json)", out)
        self.assertEqual(self.record("rec.json")["asofFrom"], "boarding_index.json")

    def test_an_explicit_asof_wins_over_the_index(self):
        rc, out = self.run_verify(asof="2026-08-01", index_extra={"asof": "2026-09-01"},
                                  argv_extra=["--json", "rec.json"])
        self.assertIn("counted as of 2026-08-01 (--asof)", out)
        self.assertEqual(self.record("rec.json")["asofFrom"], "--asof")

    def test_an_index_recording_no_date_gets_a_NOTE_and_not_a_guess(self):
        """An index written before boarding_index.py v1.4 carries no date, and
        the build date of the run folder is not the same fact -- a sheet can be
        built with --asof set to the day it goes on a wall."""
        rc, out = self.run_verify(asof=None)
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(self.findings(out, "SOFT", "S-5")), 1, out)
        self.assertIn("UNDATED", out)

    def test_a_pair_supported_only_by_a_dead_registration_is_a_NOTE(self):
        """Not a failure, and this is the clause the whole check is shaped
        around. S-2's reachability stays undated on purpose so that no sheet
        can ever be failed by a calendar."""
        dests = [{"destination": "Warboys", "boardAt": "Bay 2", "boardAtAtco": "BAY2"}]
        rc, out = self.run_verify(dests=dests, stands=[STANDS[1]],
                                  svg=sheet(["Warboys"], glyphs=("2",)))
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.findings(out, "HARD"), [], out)
        self.assertEqual(len(self.findings(out, "SOFT", "S-5")), 1, out)
        self.assertIn("not running on 2026-09-01", out)

    def test_a_service_with_no_calendar_row_is_counted_LIVE(self):
        """Absent is not expired. This checker staying the more permissive of
        the two files is the safe direction -- the alternative reports a note
        against every trip whose registration the feed happens not to carry."""
        dests = [{"destination": "Cambridge", "boardAt": "Stand C", "boardAtAtco": "STOPC"}]
        rc, out = self.run_verify(dests=dests, stands=[STANDS[2]],
                                  svg=sheet(["Cambridge"], glyphs=("C",)))
        self.assertClean(rc, out)

    def test_a_malformed_date_stops_the_run_rather_than_becoming_no_date(self):
        """Falling back to undated would turn a typo into a silently weaker
        check, reported as a pass."""
        rc, out = self.run_verify(asof="1st September")
        self.assertEqual(rc, 2)
        self.assertIn("must be YYYY-MM-DD", self.err)


class ExitCodes(Fixture):
    """0 all checks pass · 1 at least one HARD finding · 2 could not run.

    The three are what a stage gate reads, and 2 must never be reachable by
    confusing it with 0: a run that could not look is not a run that looked and
    approved.
    """

    def test_a_hard_finding_exits_1(self):
        dests = [dict(DESTS[0], boardAt="Bay 9")]
        rc, _ = self.run_verify(dests=dests, svg=sheet(["Huntingdon"]))
        self.assertEqual(rc, 1)

    def test_a_soft_finding_alone_exits_0(self):
        rc, _ = self.run_verify(dests=TheWalk.HUNT_FROM_C, svg=sheet(["Huntingdon"]))
        self.assertEqual(rc, 0)

    def test_a_missing_index_exits_2(self):
        rc, _ = self.run_verify(write_index=False)
        self.assertEqual(rc, 2)
        self.assertIn("boarding_verify:", self.err)

    def test_a_gtfs_db_that_cannot_be_located_exits_2(self):
        """Never a guess. A boarding sheet built from another county's
        timetable is perfectly reproducible and perfectly wrong."""
        rc, _ = self.run_verify(pass_db=False)
        self.assertEqual(rc, 2)
        self.assertIn("pass --db explicitly", self.err)

    def test_the_region_named_in_the_index_is_found_without_being_passed(self):
        """The control for the case above, and it has to be a PASS: without
        one, 'exits 2 when the db is missing' is equally satisfied by a
        resolver that never finds anything at all, which would make every run
        on this estate a silent 2."""
        rc, out = self.run_verify(pass_db=False, region_as="cambridgeshire.sqlite",
                                  index_extra={"region": "cambridgeshire.sqlite"},
                                  argv_extra=["--json", "rec.json"])
        self.assertClean(rc, out)
        self.assertEqual(self.record("rec.json")["region"], "cambridgeshire.sqlite")

    def test_an_index_naming_no_region_is_not_given_a_guess(self):
        """A boarding sheet built from another county's timetable is perfectly
        reproducible and perfectly wrong, so there is no default to fall to."""
        rc, out = self.run_verify(pass_db=False, region_as="cambridgeshire.sqlite")
        self.assertEqual(rc, 2)
        self.assertIn("GTFS db not found", self.err)


class TheDurableRecord(Fixture):
    """`--json` writes what a reader needs to judge the verdict LATER.

    It used to carry the place, the findings and the verdict and nothing else,
    so the durable record of a run had to be finished by hand -- and a
    hand-written record can say PASS about a build it never saw.
    """

    def test_it_says_which_checker_reached_the_verdict(self):
        rc, out = self.run_verify(argv_extra=["--json", "rec.json"])
        rec = self.record("rec.json")
        self.assertEqual(rec["verifier"], "boarding_verify.py v%s" % bv.SCRIPT_VERSION)

    def test_it_says_which_two_databases_it_read(self):
        rc, out = self.run_verify(argv_extra=["--json", "rec.json"])
        rec = self.record("rec.json")
        self.assertEqual(rec["register"], "naptan.sqlite")
        self.assertEqual(rec["region"], "region.sqlite")

    def test_it_says_how_much_it_looked_at(self):
        """A record saying PASS over zero rows and one saying PASS over forty
        are different facts, and the verdict alone cannot tell them apart."""
        rc, out = self.run_verify(argv_extra=["--json", "rec.json"])
        self.assertEqual(self.record("rec.json")["checked"],
                         {"labels": 3, "destinations": 3, "boardingPoints": 3,
                          "sheetRead": True})

    def test_it_records_that_the_sheet_was_NOT_read_when_there_was_none(self):
        rc, out = self.run_verify(svg=None, argv_extra=["--json", "rec.json"])
        self.assertFalse(self.record("rec.json")["checked"]["sheetRead"])

    def test_it_carries_the_findings_and_not_only_the_verdict(self):
        dests = [dict(DESTS[0], boardAt="Bay 9")]
        rc, out = self.run_verify(dests=dests, svg=sheet(["Huntingdon"]),
                                  argv_extra=["--json", "rec.json"])
        rec = self.record("rec.json")
        self.assertEqual(rec["result"], "FAIL")
        self.assertEqual([f["check"] for f in rec["findings"]], ["S-1"])
        self.assertEqual(rec["findings"][0]["severity"], "HARD")

    def test_a_soft_finding_alone_is_recorded_as_a_PASS(self):
        rc, out = self.run_verify(dests=TheWalk.HUNT_FROM_C, svg=sheet(["Huntingdon"]),
                                  argv_extra=["--json", "rec.json"])
        rec = self.record("rec.json")
        self.assertEqual(rec["result"], "PASS")
        self.assertEqual([f["severity"] for f in rec["findings"]], ["SOFT"])

    def test_it_is_stamped_with_a_date_it_did_not_have_to_be_told(self):
        """Asserted as a shape rather than as a value. Pinning it would pin the
        clock, which is the fault OA-289 retired on."""
        rc, out = self.run_verify(argv_extra=["--json", "rec.json"])
        self.assertRegex(self.record("rec.json")["checkedAt"], r"^\d{4}-\d{2}-\d{2}$")

    def test_it_carries_the_sheet_version_when_routes_json_has_one(self):
        rc, out = self.run_verify(routes_json={"version": "v2.1"},
                                  argv_extra=["--json", "rec.json"])
        self.assertEqual(self.record("rec.json")["version"], "v2.1")

    def test_an_absent_routes_json_leaves_the_version_null_rather_than_failing(self):
        rc, out = self.run_verify(argv_extra=["--json", "rec.json"])
        self.assertIsNone(self.record("rec.json")["version"])


if __name__ == "__main__":
    unittest.main()
