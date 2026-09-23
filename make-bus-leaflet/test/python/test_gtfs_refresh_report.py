"""gtfs_refresh_report.py -- the monthly diff, and the day strings a person typed.

THE THIRD OF OA-001'S MONTHLY JOBS, and since 2026-09-18 it owns the whole tag
taxonomy: `auto_refresh_month.py` used to import `diff_town`, `fold_gtfs`, `fmt`
and `latest_verified` from here by name and grade each town with its own copy of
`classify()`. That module was retired (buses-data OA-091) and the grading moved
here, bringing its two classes with it -- `Classify` and `TagsTheReportCanEmit`
at the foot of this file. This module runs after every BODS refresh, classifies
each town's differences, and writes `_gtfs/refresh-report_<date>.md` -- the
document every `refresh-reviews.json` adjudication is written against, and the
one whose towns-to-review list decides whether a sheet gets rebuilt.

WHAT IT ALREADY HAD. Four harnesses drive `diff_town` end to end over a real
SQLite feed and a real town folder -- `prove-red-not-in-bods.py`,
`prove-red-consolidation.py`, `prove-red-variant-fold.py` and
`prove-red-route-collision.py` -- and they are good. Each was written around one
classification (a declaration, a brand standing for sub-services, a variant that
folded, two routes sharing a number), and each carries day strings only as
scenery: every fixture in all four uses "Mon-Sat", "Mon-Fri" or "Daily", the
three shapes that always worked.

SO THE PART NOBODY HAD DRIVEN WAS THE PART A PERSON TYPES. `parse_days` turns
freeform prose out of a town file into a set of weekdays, and `diff_town` prints
[DAYS] whenever that set differs from the feed's. Its real specification is
therefore not a grammar anybody designed -- it is the strings eight towns
actually wrote -- and on 2026-09-15 three of the fifteen distinct strings on the
estate were read wrongly. One was LIVE: Beaconsfield's X74 ships
"Daily (reduced Sun)", which parsed as SUNDAY ONLY because a `len(toks)==1` arm
took the day token inside a parenthetical aside for the service's week. The
consequence is in the artefact rather than in the reasoning --
`- **[DAYS] X74** - shipped 'Daily (reduced Sun)' vs BODS 'Daily'` stands in
`_gtfs/refresh-report_2026-08-21.md`, `_2026-08-31.md` and `_2026-09-01.md`, an
actionable finding on all three, putting Beaconsfield on the towns-to-review list
over a bus that had not changed. This file's own module docstring calls that out
about a different check: a recurring alarm that is factually wrong is the kind
that teaches you to skim the section which will one day carry a real withdrawal.

THE FIXTURE LIST IS A MEASUREMENT AND IT WILL AGE. The estate is another
repository -- private, and not checked out where this suite runs -- so the
sixteen strings below are copied here, which is *the fixture written by the
parser's author* unless somebody keeps measuring. `tools/days-vocabulary.py` is
that measurement as a command; run it from the buses-data root and reconcile.
The counts in `VOCABULARY` are the 2026-09-15 reading and are recorded so a later
reader can see how far it has drifted, not so anything can assert on them.

EVERY DATE HERE IS EXPLICIT AND NONE OF THEM IS `today`. `diff_town` takes
`today` as an argument for exactly that reason -- see *Clock-dependent artefact*
in the glossary and OA-289, which reddened `main` once a day for as long as a
claim was held.
"""
import io
import json
import os
import re
import shutil
import unittest

import _engine
import _stubs

rr = _engine.load("gtfs_refresh_report")

DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
ALL = set(range(7))


def days(*names):
    return {DOW.index(n) for n in names}


# Every distinct `days` string on the estate's LATEST S1 run per town, measured
# 2026-09-15 by tools/days-vocabulary.py: 8 towns, 104 services, 15 distinct.
# `None` means NOT COMPARABLE, which is a real answer here and not a failure --
# it is what stops the report inventing a difference it cannot see.
VOCABULARY = [
    # (the string as a town wrote it, uses on 2026-09-15, the week it means)
    ("Daily", 31, ALL),
    ("Mon–Sat", 21, days("Mon", "Tue", "Wed", "Thu", "Fri", "Sat")),
    ("Mon–Fri", 16, days("Mon", "Tue", "Wed", "Thu", "Fri")),
    ("Mon-Sat", 13, days("Mon", "Tue", "Wed", "Thu", "Fri", "Sat")),
    ("Thu", 5, days("Thu")),
    ("Mon-Fri", 4, days("Mon", "Tue", "Wed", "Thu", "Fri")),
    ("Tue & Fri", 3, days("Tue", "Fri")),
    ("Mon & Fri", 2, days("Mon", "Fri")),
    ("Limited (pre-book)", 2, None),
    ("Fri", 2, days("Fri")),
    ("Daily (reduced Sun)", 1, None),
    ("Matchdays only", 1, None),
    ("Mon-Sat (not public holidays)", 1, None),
    ("Mon–Sat 06:30–19:00", 1, None),
    ("Mon–Fri (school/college term)", 1, None),
]


class TheEstatesVocabulary(unittest.TestCase):
    """Every string eight towns actually wrote, and what it must mean."""

    def test_every_measured_string_reads_as_its_prose_says(self):
        for text, _uses, expected in VOCABULARY:
            with self.subTest(text=text):
                self.assertEqual(rr.parse_days(text), expected)

    def test_the_en_dash_is_not_an_exotic_case(self):
        """38 of the 104, the commonest separator on the estate after none at all.

        It is a hyphen to a reader and a different codepoint to a regex, and a
        day range that silently stopped parsing would not fail -- it would go
        quiet, which is the direction nothing notices.
        """
        self.assertEqual(rr.parse_days("Mon–Sat"), rr.parse_days("Mon-Sat"))
        self.assertEqual(rr.parse_days("Mon—Sat"), rr.parse_days("Mon-Sat"))

    def test_a_qualified_string_is_not_comparable_rather_than_half_read(self):
        """The three parenthetical shapes must agree with each other.

        Two of them already returned None and the third did not, so the estate's
        own vocabulary disagreed with itself for as long as X74 has shipped.
        """
        for text in ("Daily (reduced Sun)",
                     "Mon–Fri (school/college term)",
                     "Mon-Sat (not public holidays)",
                     "Mon–Sat 06:30–19:00"):
            with self.subTest(text=text):
                self.assertIsNone(rr.parse_days(text))


class TheThreeStringsThatWereReadWrongly(unittest.TestCase):
    """One case per fault of 2026-09-15, each named after what it did.

    Separate from the vocabulary table above deliberately: a row in a table is
    read as data and deleted when it looks redundant, and these three are the
    reason the table exists.
    """

    def test_a_parenthetical_aside_is_not_the_services_week(self):
        """"Daily (reduced Sun)" read as {Sun}: Beaconsfield X74, three reports."""
        self.assertIsNone(rr.parse_days("Daily (reduced Sun)"))
        self.assertNotEqual(rr.parse_days("Daily (reduced Sun)"), days("Sun"))

    def test_a_range_beside_a_day_keeps_the_range(self):
        """"Mon-Fri & Sat" read as {Mon, Fri, Sat} -- three days out of six.

        Not on the estate on the day this was written, which is the only reason
        it was not a second live false alarm. It is the obvious way to write six
        days, so it is one town file away from being one.
        """
        self.assertEqual(rr.parse_days("Mon-Fri & Sat"),
                         days("Mon", "Tue", "Wed", "Thu", "Fri", "Sat"))
        self.assertEqual(rr.parse_days("Mon-Thu, Sat & Sun"),
                         days("Mon", "Tue", "Wed", "Thu", "Sat", "Sun"))

    def test_a_backwards_range_is_no_answer_rather_than_an_empty_one(self):
        """"Sun-Thu" produced set(), which `is not None` and so counted as an answer.

        An empty set differs from every week a feed can report, so it would have
        cried [DAYS] for ever. The distinction this asserts is exactly the one
        `is not None` makes at the call site.

        THE THIRD LINE IS THE ONLY ONE OF THE THREE THAT DISCRIMINATES, and the
        harness said so rather than the author. The first version of this test
        stopped at the two single-piece strings, and mutation 47 of
        `tools/prove-red-python.py` -- remove the `b>=a` guard, so a backwards
        range is the empty set again -- SURVIVED it. `parse_days` ends
        `return out or None`, which turns an empty union into None all by itself,
        so a string that is nothing BUT a backwards range comes back None either
        way. What the guard actually protects is the compound: beside a day it
        can read, an unreadable piece would be quietly dropped and the string
        would report a week narrower than its prose. That survival is recorded
        here rather than tidied away, because a mutation nobody sees survive is
        a test nobody knows the shape of.
        """
        self.assertIsNone(rr.parse_days("Sun-Thu"))
        self.assertIsNone(rr.parse_days("Sat-Mon"))
        self.assertIsNone(rr.parse_days("Mon & Sun-Thu"))


class NotComparableIsAnAnswer(unittest.TestCase):
    """The silences, and the control that they are not silence everywhere."""

    def test_prose_that_is_not_a_week_stays_unread(self):
        for text in ("Limited (pre-book)", "Matchdays only", "By arrangement",
                     "School days only", "", "   ", None):
            with self.subTest(text=text):
                self.assertIsNone(rr.parse_days(text))

    def test_but_a_plain_week_still_reads(self):
        """The control. Without it, a parse_days that returned None for
        everything would pass every test above and silence the [DAYS] check
        across the whole estate -- which is the quietest possible way for this
        module to stop working."""
        self.assertEqual(rr.parse_days("Mon-Fri"), days("Mon", "Tue", "Wed", "Thu", "Fri"))
        self.assertEqual(rr.parse_days("Daily"), ALL)
        self.assertEqual(rr.parse_days("Sat"), days("Sat"))

    def test_the_long_spellings_and_the_plural_read_too(self):
        self.assertEqual(rr.parse_days("Monday to Friday"),
                         days("Mon", "Tue", "Wed", "Thu", "Fri"))
        self.assertEqual(rr.parse_days("Sundays"), days("Sun"))
        self.assertEqual(rr.parse_days("Tuesdays and Fridays"), days("Tue", "Fri"))


class TheRoundTripWithFmt(unittest.TestCase):
    """`fmt` writes the feed's side of a [DAYS] line and `parse_days` reads the
    town's, so the two are the halves of one sentence a reader compares.

    EXHAUSTIVE OVER ALL 127 NON-EMPTY WEEKS, because there are only 127 and a
    sampled property test is an anecdote about the samples. If this ever fails,
    the report is capable of printing two spellings of the same week side by side
    and calling them a change.
    """

    def test_every_week_survives_being_written_down_and_read_back(self):
        for mask in range(1, 128):
            d = {i for i in range(7) if mask & (1 << i)}
            with self.subTest(week=rr.fmt(d)):
                self.assertEqual(rr.parse_days(rr.fmt(d)), d)

    def test_the_empty_week_is_the_one_asymmetry_and_it_is_deliberate(self):
        """`fmt(set())` is "?" -- unknown, not a week -- and "?" reads back as
        NOT COMPARABLE rather than as the empty set it came from. That is the
        right way round: the empty set must never travel as an answer."""
        self.assertEqual(rr.fmt(set()), "?")
        self.assertIsNone(rr.parse_days("?"))


class Fmt(unittest.TestCase):
    def test_it_spells_a_week_the_way_the_estate_writes_one(self):
        self.assertEqual(rr.fmt(ALL), "Daily")
        self.assertEqual(rr.fmt(days("Mon", "Tue", "Wed", "Thu", "Fri")), "Mon-Fri")
        self.assertEqual(rr.fmt(days("Mon", "Tue", "Wed", "Thu", "Fri", "Sat")), "Mon-Sat")
        self.assertEqual(rr.fmt(days("Thu")), "Thu")
        self.assertEqual(rr.fmt(days("Mon", "Tue")), "Mon & Tue")
        self.assertEqual(rr.fmt(days("Tue", "Fri")), "Tue & Fri")
        self.assertEqual(rr.fmt(days("Mon", "Wed", "Fri")), "Mon & Wed & Fri")


class LatestVerified(unittest.TestCase):
    """Which S1 run the whole monthly diff is taken against."""

    def setUp(self):
        self.dir = _stubs.scratch("refresh-latest-")
        self.addCleanup(shutil.rmtree, self.dir, True)

    def run_dir(self, stamp):
        p = os.path.join(self.dir, "S1-services", stamp, "verified-services.json")
        _stubs.write_json(p, {"verifiedOn": stamp[:10], "services": []})
        return p

    def test_it_picks_the_newest_dated_run(self):
        self.run_dir("2026-07-21_1534")
        self.run_dir("2026-09-06_0644")
        self.run_dir("2026-08-10_0912")
        self.assertEqual(os.path.basename(os.path.dirname(rr.latest_verified(self.dir))),
                         "2026-09-06_0644")

    def test_it_is_a_date_order_and_not_an_order_of_arrival(self):
        """Written newest-first, so a walk that trusted directory order would
        answer the July one. `sorted()` over an ISO-dated name is a date sort;
        that equality is what makes the lexical pick legitimate here, and it is
        the whole reason *the version sorted as text* does not bite -- these
        folders are dated, not versioned."""
        self.run_dir("2026-09-06_0644")
        self.run_dir("2026-07-21_1534")
        self.assertIn("2026-09-06_0644", rr.latest_verified(self.dir))

    def test_no_run_at_all_is_None_rather_than_a_crash(self):
        self.assertIsNone(rr.latest_verified(self.dir))


class StubFeed(object):
    """Stands in for `gtfs_query`, which needs a 400 MB county SQLite.

    `diff_town`'s sqlite path is already driven end to end by the four
    prove-red harnesses named at the top of this file; what is stubbed here is
    the DATA, not the logic -- `fold_gtfs`, the shipped/feed set algebra and the
    classification all run for real. This is the pattern OA-001 named for the
    parts of the Python half that need a feed: stub the data, do not read a
    dataset.
    """

    def __init__(self, services):
        self.services = services

    def query(self, db, prefixes, near, name):
        return {"services": self.services}


def bods(route, operator, week, variant_of=None):
    flags = [1 if i in week else 0 for i in range(7)]
    return {"route": route, "operator": operator, "daysFlags": flags,
            "possibleVariantOf": variant_of, "hasGtfsShape": False}


class DiffTownReadsTheDaysItIsGiven(unittest.TestCase):
    """The end the report is printed from, with the feed stubbed.

    Three cases, and the SECOND is the one that makes the other two mean
    anything: a [DAYS] check that had simply stopped running would produce the
    same silence as a [DAYS] check that correctly found nothing.
    """

    def setUp(self):
        self.dir = _stubs.scratch("refresh-diff-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.saved = rr.gq
        self.addCleanup(setattr, rr, "gq", self.saved)

    def ship(self, services):
        _stubs.write_json(
            os.path.join(self.dir, "S1-services", "2026-09-06_0644", "verified-services.json"),
            {"verifiedOn": "2026-09-06", "services": services})

    def diff(self, feed):
        rr.gq = StubFeed(feed)
        d = rr.diff_town("unused.sqlite", "Testbury", {"prefixes": ["0500"]},
                         self.dir, today="2026-09-15")
        return [(tag, label) for tag, label, _msg in d["changes"]]

    def test_the_X74_shape_raises_nothing(self):
        """Beaconsfield's live case: shipped "Daily (reduced Sun)", feed Daily."""
        self.ship([{"route": "X74", "operator": "First Berkshire & The Thames Valley",
                    "days": "Daily (reduced Sun)"}])
        self.assertEqual(
            self.diff([bods("X74", "First Berkshire & The Thames Valley", ALL)]), [])

    def test_a_week_that_really_moved_still_raises_DAYS(self):
        """The control. Same fixture, same code path, a genuine difference."""
        self.ship([{"route": "5", "operator": "Whippet Coaches", "days": "Mon-Fri"}])
        self.assertEqual(self.diff([bods("5", "Whippet Coaches", ALL)]), [("DAYS", "5")])

    def test_a_range_beside_a_day_raises_nothing_either(self):
        self.ship([{"route": "7", "operator": "Stagecoach East", "days": "Mon-Fri & Sat"}])
        self.assertEqual(
            self.diff([bods("7", "Stagecoach East",
                            days("Mon", "Tue", "Wed", "Thu", "Fri", "Sat"))]), [])


def change(tag, route="7", msg="a change"):
    """One row of `diff_town`'s `changes` list, in the shape it really returns."""
    return (tag, route, msg)


class Classify(unittest.TestCase):
    """The grade: does any of this town's change need a person?

    MOVED HERE FROM `test_auto_refresh_month.py` ON 2026-09-18 (buses-data OA-091)
    WITH THE FUNCTION IT TESTS. There it guarded an unattended applier, where SAFE
    meant rebuild four stages and stage a proposed update to the customer; that
    applier was retired on a measurement -- its SAFE path fired once in 24
    town-months and that once was wrong. The grading itself is the judgement worth
    keeping, and what it now decides is what the report PRINTS beside each town, so
    a wrong verdict costs a misleading heading rather than a wrong sheet. The cases
    are unchanged, because the question they ask has not.

    What their first run found, and the reason the class is worth more than its
    green: `classify()` carried two second homes for rules written down elsewhere --
    the non-actionable set, re-spelled as the bare literal "COMMUNITY", and SAFE
    itself as the COMPLEMENT of a blocking list. Both are assertions below.
    """

    def test_an_operator_rename_alone_is_SAFE(self):
        verdict, reasons = rr.classify([change("OPERATOR", "5", "shipped 'A' vs BODS 'B'")])
        self.assertEqual(verdict, "SAFE")
        self.assertEqual([c[1] for c in reasons], ["5"])

    def test_a_days_change_alone_is_SAFE(self):
        verdict, reasons = rr.classify([change("DAYS", "5", "shipped 'Mon-Fri' vs BODS 'Mon-Sat'")])
        self.assertEqual(verdict, "SAFE")
        self.assertEqual([c[1] for c in reasons], ["5"])

    def test_a_new_route_ESCALATES_because_somebody_has_to_choose_a_colour(self):
        verdict, reasons = rr.classify([change("ADD?", "X5", "new in BODS")])
        self.assertEqual(verdict, "ESCALATE")
        self.assertEqual([c[1] for c in reasons], ["X5"])

    def test_a_vanished_route_ESCALATES(self):
        self.assertEqual(rr.classify([change("WITHDRAWN?", "66")])[0], "ESCALATE")

    def test_a_serves_town_re_evaluation_ESCALATES(self):
        self.assertEqual(rr.classify([change("RE-EVAL", "303")])[0], "ESCALATE")

    def test_nothing_at_all_is_NOTHING(self):
        self.assertEqual(rr.classify([]), ("NOTHING", []))

    def test_a_community_only_town_is_NOTHING(self):
        self.assertEqual(rr.classify([change("COMMUNITY", "V1")]), ("NOTHING", []))

    def test_an_expected_absence_is_NOTHING_and_the_set_is_the_REPORTs(self):
        """NOT-IN-BODS: absent from BODS, and the town's own file says so.

        The grade has to agree with the list the same `main()` builds a few lines
        away. The report leaves such a town off its towns-to-review list --
        `NON_ACTIONABLE` is what does that -- and this function said SAFE. Asserted
        against `rr.NON_ACTIONABLE` rather than against the string, so a tag leaving
        that constant cannot leave this test green.
        """
        for tag in rr.NON_ACTIONABLE:
            self.assertEqual(rr.classify([change(tag, "56")]), ("NOTHING", []), tag)

    def test_a_stale_notInBods_declaration_ESCALATES_rather_than_reading_mechanical(self):
        """`NOT-IN-BODS?` is actionable and is NOT mechanical.

        Its own message in the report is *the declaration is stale, delete it* -- a
        person editing a field. Under the blocking-list version this graded SAFE.
        """
        verdict, reasons = rr.classify([change("NOT-IN-BODS?", "401")])
        self.assertEqual(verdict, "ESCALATE")
        self.assertEqual([c[0] for c in reasons], ["NOT-IN-BODS?"])

    def test_a_tag_nobody_has_written_yet_ESCALATES(self):
        """The default is the direction that costs a person five minutes, rather
        than the one that tells them a change needs nobody."""
        self.assertEqual(rr.classify([change("SOMETHING-NEW", "9")])[0], "ESCALATE")

    def test_one_blocking_change_ESCALATES_the_whole_town(self):
        verdict, reasons = rr.classify([change("OPERATOR", "5"), change("ADD?", "X5")])
        self.assertEqual(verdict, "ESCALATE")
        self.assertEqual([c[1] for c in reasons], ["X5"],
                         "only the blocking rows are reasons -- the grade is the town's, "
                         "because a rebuild is")

    def test_a_non_actionable_row_does_not_make_a_mechanical_town_unsafe(self):
        verdict, reasons = rr.classify([change("COMMUNITY", "V1"), change("DAYS", "5")])
        self.assertEqual(verdict, "SAFE")
        self.assertEqual([c[1] for c in reasons], ["5"])

    def test_the_reasons_are_the_rows_themselves_not_a_summary(self):
        """Callers unpack them as `for tag, r, msg in reasons`. A reason that were
        a string, or a pair, would fail there and not here."""
        rows = [change("OPERATOR", "5", "shipped 'A' vs BODS 'B'")]
        self.assertEqual(rr.classify(rows)[1], rows)


class TagsTheReportCanEmit(unittest.TestCase):
    """The join: every tag the report can produce is DECIDED, not defaulted.

    Derived from this module's own source rather than typed here, for the reason
    `_engine.module_names()` is derived: a hand-kept list cannot notice the tag
    nobody listed, which is the only tag this class exists for. Now that the
    grading lives in the module that emits the tags, this is a join within one
    file -- which makes it cheaper to keep true and no less necessary, because the
    two halves are still fifty lines and four hundred apart.
    """

    def tags(self):
        path = os.path.join(_engine.ENGINE_DIR, "gtfs_refresh_report.py")
        with io.open(path, encoding="utf-8") as fh:
            src = fh.read()
        found = set(re.findall(r'changes\.append\(\(\s*"([A-Z?\-]+)"', src))
        self.assertTrue(found, "no tags found -- the regex has stopped matching the report")
        return found

    def test_the_report_still_emits_the_tags_this_module_reasons_about(self):
        """A control on the instrument above. If this ever shrinks to a handful,
        the regex has drifted and every verdict below is about nothing."""
        self.assertLessEqual({"OPERATOR", "DAYS", "ADD?", "WITHDRAWN?", "RE-EVAL",
                              "COMMUNITY", "NOT-IN-BODS"}, self.tags())

    def test_every_tag_is_either_non_actionable_mechanical_or_escalates(self):
        for tag in sorted(self.tags()):
            verdict, _ = rr.classify([change(tag, "7")])
            if tag in rr.NON_ACTIONABLE:
                self.assertEqual(verdict, "NOTHING", tag)
            elif tag in rr.MECHANICAL:
                self.assertEqual(verdict, "SAFE", tag)
            else:
                self.assertEqual(verdict, "ESCALATE", tag)

    def test_only_the_two_mechanical_tags_can_be_SAFE(self):
        """Stated the other way round, because the assertion above is satisfied by
        a MECHANICAL that has quietly grown a third member."""
        safe = {t for t in self.tags() if rr.classify([change(t, "7")])[0] == "SAFE"}
        self.assertEqual(safe, {"OPERATOR", "DAYS"})


class GradeRecordAndSidecar(unittest.TestCase):
    """The grade as DATA -- `town_grade_record` and `grades_payload` (buses-data OA-426).

    WHY THESE EXIST AT ALL. Until OA-426 the grade was written only into the
    report's own heading, so the only way to ask "does this town's refresh need a
    person?" was to parse generated prose. The sidecar answers it as data. What
    these cases protect is not the JSON's shape but the property the sidecar is
    worth nothing without: THE RECORD AND THE HEADING ARE ONE COMPUTATION. `main()`
    builds the heading out of the same record it writes to the file, so a reader
    that trusts the file is trusting what the report says.

    WHAT THEY DO NOT COVER, said out loud. `main()` is a `__main__` block rather
    than a function, so nothing here imports the WRITE -- the filename, the
    directory and the trailing newline are uncovered by this suite, and the thing
    standing under them is that the line sits two lines below the report's own
    write and shares its `gdir` and `today`. The CONTENT is covered here, through
    a real `json.dumps`/`json.loads` round trip, because a payload that cannot be
    serialised is a monthly job that dies after writing the prose.
    """

    def rec(self, changes, town="March"):
        return rr.town_grade_record(town, changes)

    def test_the_grade_is_classify_s_and_not_a_second_rule(self):
        """Over every tag the report can emit, and both grades of mixture."""
        cases = [[change(t, "7")] for t in rr.NON_ACTIONABLE + rr.MECHANICAL + ("ADD?", "WITHDRAWN?", "RE-EVAL", "NOT-IN-BODS?")]
        cases += [[], [change("OPERATOR"), change("ADD?")], [change("COMMUNITY"), change("DAYS")]]
        for changes in cases:
            self.assertEqual(self.rec(changes)["grade"], rr.classify(changes)[0], changes)

    def test_the_count_is_the_one_the_heading_prints(self):
        changes = [change("COMMUNITY", "V1"), change("DAYS", "5"), change("OPERATOR", "6")]
        self.assertEqual(self.rec(changes)["actionable"], 2)

    def test_a_town_with_a_grade_always_has_something_to_review(self):
        """The heading cannot say "3 to review" beside "NOTHING", and it cannot say
        "NO CHANGE" beside "SAFE" either -- which is one property, in both
        directions, over the same record."""
        for changes in ([], [change("COMMUNITY")], [change("NOT-IN-BODS")],
                        [change("DAYS")], [change("ADD?")], [change("COMMUNITY"), change("ADD?")]):
            r = self.rec(changes)
            self.assertEqual(r["grade"] == "NOTHING", r["actionable"] == 0, changes)

    def test_reasons_are_the_deciding_tags_deduplicated_and_sorted(self):
        r = self.rec([change("WITHDRAWN?", "66"), change("ADD?", "X5"), change("WITHDRAWN?", "67")])
        self.assertEqual(r["reasons"], ["ADD?", "WITHDRAWN?"])
        self.assertEqual(self.rec([])["reasons"], [])

    def test_the_payload_keys_towns_by_name_and_does_not_repeat_it(self):
        p = rr.grades_payload("2026-10-01", [self.rec([change("DAYS")], "March")], [])
        self.assertEqual(list(p["towns"]), ["March"])
        self.assertNotIn("town", p["towns"]["March"])
        self.assertEqual(p["towns"]["March"]["grade"], "SAFE")
        self.assertEqual((p["date"], p["schema"]), ("2026-10-01", 1))

    def test_a_town_that_could_not_be_checked_is_absent_from_towns_and_named(self):
        """The failure this arm is about is a reader taking an absence for "no
        changes" -- the shape a month of clean empty reports already cost us."""
        p = rr.grades_payload("2026-10-01", [self.rec([change("DAYS")], "March")],
                              [("Wisbech", "dataset not built")])
        self.assertNotIn("Wisbech", p["towns"])
        self.assertEqual(p["notChecked"], [{"town": "Wisbech", "reason": "dataset not built"}])

    def test_the_payload_survives_the_round_trip_the_monthly_job_makes(self):
        p = rr.grades_payload("2026-10-01",
                              [self.rec([change("ADD?")], "Ely"), self.rec([], "St Ives")],
                              [("Wisbech", "dataset not built")])
        self.assertEqual(json.loads(json.dumps(p, ensure_ascii=False)), p)


if __name__ == "__main__":
    unittest.main()
