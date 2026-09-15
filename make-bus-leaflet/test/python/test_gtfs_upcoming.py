"""gtfs_upcoming.py -- the monthly look-ahead, and the rules that decide what it raises.

THE SECOND OF OA-001'S TWO LONG FUSES. Like `auto_refresh_month.py` beside it,
this module runs once a month to nobody: it mines the BODS feed for changes
registered to take effect in the future and writes
`_gtfs/upcoming/upcoming-report_<date>.md`, which is then read by a person
adjudicating whether a town needs a rebuild. Unlike its neighbour it does not
ACT -- but its findings are what the adjudications in `refresh-reviews.json` are
written against, and a wrong finding is a rebuild nobody owed or a change nobody
saw.

WHAT IT ALREADY HAD, AND WHY THAT WAS NOT THIS. `tools/prove-red-timetable-
trigger.py` has falsified the [TIMETABLE] *sentence* since OA-269 was fixed on
2026-09-07, and it is a good harness -- but it drives `diff_findings` and
`timetable_message` over route dictionaries typed into the file. Everything that
BUILDS those dictionaries out of a feed was untested, which is most of the
module and all of the part that reads dates.

THE PAIRING IN `TheTwoNumbers` IS THE ONE THAT WOULD HAVE MATTERED. OA-269's
whole finding is that `tripCount` is registration bookkeeping and `routingHash`
is the road -- and that separation is only real if `build_town` actually computes
them that way. The existing harness asserts what the message says when handed a
hash that held and a count that moved; nothing asserted that a feed in which the
operator re-registers the same journeys under more `service_id`s PRODUCES that
pair. A `routingHash` quietly taken over trip ids instead of stop sequences would
make every re-registration read as a road move, and every case in that harness
would still pass.

THE FIXTURES ARE SQLITE, THROUGH `_stubs.gtfs_db`, so the schema comes from
`gtfs_build.TABLES` -- the real loader -- rather than from a second copy kept
here. A county feed is 400 MB, untracked and rebuilt monthly, so an assertion
about one is an assertion about what BODS published that week; the pattern is
the one OA-001 named and `_stubs.py` established.

EVERY DATE IN THIS FILE IS EXPLICIT AND NONE OF THEM IS `today`. `forward_lens`
takes `today` as an argument, so it can be passed -- see *Clock-dependent
artefact* in the glossary, and OA-289, which `main` went red on once a day for
as long as a claim was held. A fixture anchored on the real clock starts failing
one morning because a year rolled over.
"""
import os
import shutil
import sqlite3
import unittest

import _engine
import _stubs

up = _engine.load("gtfs_upcoming")


def feed(routes, trips, stop_times, calendar=(), calendar_dates=(), stops=None,
         agency="Whippet Coaches"):
    """The five tables a look-ahead reads, with the boilerplate filled in."""
    return {
        "agency": [{"agency_id": "A1", "agency_name": agency}],
        "stops": stops if stops is not None else [
            {"stop_id": "0500A", "stop_name": "Bus Station", "stop_lat": "52.3232",
             "stop_lon": "-0.0742"}],
        "routes": [{"route_id": rid, "agency_id": "A1", "route_short_name": sn}
                   for rid, sn in routes],
        "trips": [{"route_id": rid, "service_id": sid, "trip_id": tid}
                  for rid, sid, tid in trips],
        "stop_times": [{"trip_id": tid, "stop_id": sid, "stop_sequence": str(i + 1)}
                       for tid, seq in stop_times for i, sid in enumerate(seq)],
        "calendar": list(calendar),
        "calendar_dates": list(calendar_dates),
    }


def one_route(**kw):
    """A single route 55 calling at one stop, with whatever calendar is passed."""
    return feed([("R1", "55")], [("R1", "S1", "T1")], [("T1", ["0500A"])], **kw)


def dates(service_id, ymds, exception_type="1"):
    return [{"service_id": service_id, "date": d, "exception_type": exception_type}
            for d in ymds]


class TmpCase(unittest.TestCase):
    """A throwaway feed directory, and every connection closed when the case ends.

    `cur` keeps the connection rather than returning a cursor over one nothing
    holds: a leaked handle prints a `ResourceWarning` on every case, and warning
    noise is how a real warning hides -- the same two-line shape OA-001 records
    for `patch_verified_services` and `load_pins`.
    """

    def setUp(self):
        self.tmp = _stubs.scratch("gtfs-upcoming-")
        self.feeds = 0
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def cur(self, tables):
        """A cursor over a throwaway feed holding exactly `tables`."""
        self.feeds += 1
        path = os.path.join(self.tmp, "feed%d.sqlite" % self.feeds)
        _stubs.gtfs_db(path, tables)
        con = sqlite3.connect(path)
        self.addCleanup(con.close)
        con.row_factory = sqlite3.Row
        return con.cursor()


# ------------------------------------------------------------------ the day string

class DayStrings(unittest.TestCase):
    """`fmt_days` prints the day pattern a reader sees beside every finding."""

    def test_every_day_is_Daily(self):
        self.assertEqual(up.fmt_days([1] * 7), "Daily")

    def test_no_day_at_all_is_a_question_mark_not_an_empty_string(self):
        """An empty string would read as "no days printed"; `?` reads as unknown."""
        self.assertEqual(up.fmt_days([0] * 7), "?")

    def test_a_contiguous_run_of_three_or_more_is_a_range(self):
        self.assertEqual(up.fmt_days([1, 1, 1, 1, 1, 0, 0]), "Mon-Fri")

    def test_a_contiguous_PAIR_is_spelled_out_rather_than_ranged(self):
        """`Mon-Tue` is a range naming two days and reads as more than it is."""
        self.assertEqual(up.fmt_days([1, 1, 0, 0, 0, 0, 0]), "Mon & Tue")

    def test_a_single_day_is_just_that_day(self):
        self.assertEqual(up.fmt_days([0, 0, 0, 1, 0, 0, 0]), "Thu")

    def test_a_scattered_pattern_is_listed_rather_than_ranged(self):
        """Sat & Sun is the seasonal-coach shape and must never print as Sat-Sun."""
        self.assertEqual(up.fmt_days([0, 0, 0, 0, 0, 1, 1]), "Sat & Sun")
        self.assertEqual(up.fmt_days([1, 0, 1, 0, 1, 0, 1]), "Mon, Wed, Fri, Sun")


class Dates(unittest.TestCase):

    def test_an_eight_digit_GTFS_date_becomes_an_ISO_date(self):
        self.assertEqual(up.d2iso("20260913"), "2026-09-13")

    def test_anything_that_is_not_one_is_passed_through_rather_than_mangled(self):
        self.assertEqual(up.d2iso("2026"), "2026")

    def test_an_absent_date_reads_as_unknown(self):
        self.assertEqual(up.d2iso(""), "?")
        self.assertEqual(up.d2iso(None), "?")

    def test_days_between_counts_forward_from_today(self):
        self.assertEqual(up.days_between("20260901", "20260913"), 12)

    def test_a_date_it_cannot_parse_is_None_rather_than_zero(self):
        """Zero would print as "0d away" -- an unparseable date read as imminent."""
        self.assertIsNone(up.days_between("20260901", "not a date"))


# -------------------------------------------------------------- the effective window

class ServiceWindow(TmpCase):
    """`service_window` unions `calendar` with `calendar_dates`.

    The module header names this as the reason it exists: March 46, the 50/56/66
    group and Wisbech 52 are registered through `calendar_dates` alone and are
    invisible to a calendar-only read -- and those are exactly the services
    whose dates are nearest.
    """

    def test_calendar_dates_alone_give_both_the_window_and_the_days(self):
        # 2026-01-05 is a Monday and 2026-01-10 a Saturday.
        cur = self.cur({"calendar_dates": dates("S1", ["20260105", "20260110"])})
        start, end, flags, had_cal, added = up.service_window(cur, "S1", None)
        self.assertEqual((start, end), ("20260105", "20260110"))
        self.assertEqual(up.fmt_days(flags), "Mon & Sat")
        self.assertFalse(had_cal)
        self.assertEqual(added, 2)

    def test_a_calendar_row_supplies_the_days_and_is_reported_as_present(self):
        cur = self.cur({"calendar": [_stubs.every_day("S1", "20260101", "20261231")]})
        start, end, flags, had_cal, added = up.service_window(
            cur, "S1", next(iter(cur.execute("SELECT * FROM calendar").fetchall())))
        self.assertEqual((start, end), ("20260101", "20261231"))
        self.assertEqual(up.fmt_days(flags), "Daily")
        self.assertTrue(had_cal)
        self.assertEqual(added, 0)

    def test_a_REMOVAL_does_not_extend_the_window(self):
        """exception_type 2 is a day the service does NOT run.

        Counted as an addition it would push the end date out to whatever the
        operator excluded -- a Christmas Day removal would silently register the
        service as running until Christmas.
        """
        cur = self.cur({"calendar_dates": dates("S1", ["20260105"])
                        + dates("S1", ["20301231"], exception_type="2")})
        start, end, _, _, added = up.service_window(cur, "S1", None)
        self.assertEqual((start, end), ("20260105", "20260105"))
        self.assertEqual(added, 1)

    def test_a_service_with_no_data_at_all_returns_None_rather_than_a_window(self):
        """None is "we could not look"; a window would be a measurement."""
        cur = self.cur({})
        self.assertEqual(up.service_window(cur, "MISSING", None),
                         (None, None, [0] * 7, False, 0))


# ------------------------------------------------------- the bank-holiday-extra gate

class TheOngoingGate(TmpCase):
    """`MIN_ONGOING_DATES` is what stops a one-off working reading as a change.

    A calendar_dates-only service with a handful of future dates is almost
    always a bank-holiday extra or an occasional working. Without the gate every
    one of those raises [NEW] or [CHANGE] against a town, and the monthly report
    -- which a person reads and adjudicates one row at a time -- fills with them.
    """

    FUTURE_START = "20261001"   # a Thursday, two months after the feed starts
    FEED_START = "20260801"

    def future_dates(self, n):
        """`n` consecutive running dates from FUTURE_START."""
        return ["202610%02d" % d for d in range(1, n + 1)]

    def test_a_handful_of_future_dates_raises_nothing(self):
        cur = self.cur(one_route(calendar_dates=dates("S1", self.future_dates(3))))
        routes = up.build_town(cur, self.FEED_START, ["0500"], None)
        self.assertEqual(routes["55"]["future"], [])

    def test_a_dense_run_of_future_dates_DOES_raise(self):
        """The control: "raises nothing" above must not be "the route vanished"."""
        cur = self.cur(one_route(calendar_dates=dates("S1", self.future_dates(12))))
        routes = up.build_town(cur, self.FEED_START, ["0500"], None)
        self.assertEqual([f["start"] for f in routes["55"]["future"]], [self.FUTURE_START])

    def test_the_boundary_is_MIN_ONGOING_DATES_itself_and_not_one_either_side(self):
        """Asserted against the constant rather than against 10.

        A test naming the number would keep passing if somebody moved the
        constant and reads as agreeing with whatever is in the file.
        """
        n = up.MIN_ONGOING_DATES
        below = self.cur(one_route(calendar_dates=dates("S1", self.future_dates(n - 1))))
        at = self.cur(one_route(calendar_dates=dates("S1", self.future_dates(n))))
        self.assertEqual(up.build_town(below, self.FEED_START, ["0500"], None)["55"]["future"], [])
        self.assertTrue(up.build_town(at, self.FEED_START, ["0500"], None)["55"]["future"])

    def test_a_proper_calendar_registration_raises_however_few_dates_it_has(self):
        """The gate is about calendar-less services; a calendar row IS the timetable."""
        cal = [dict(_stubs.every_day("S1", self.FUTURE_START, "20261003"))]
        cur = self.cur(one_route(calendar=cal))
        routes = up.build_town(cur, self.FEED_START, ["0500"], None)
        self.assertEqual([f["start"] for f in routes["55"]["future"]], [self.FUTURE_START])

    def test_a_service_that_started_BEFORE_the_feed_is_not_a_future_change(self):
        cal = [dict(_stubs.every_day("S1", "20260701", "20271231"))]
        cur = self.cur(one_route(calendar=cal))
        self.assertEqual(up.build_town(cur, self.FEED_START, ["0500"], None)["55"]["future"], [])


# --------------------------------------------------------------- the new day pattern

class TheNewDayPattern(TmpCase):
    """`futureDays` is the pattern the route CHANGES TO, and only that.

    WRITTEN BECAUSE THE HARNESS CAUGHT THE SUITE RATHER THAN THE ENGINE. The
    mutation `R["futureDays"] = fmt_days(R["flags"])` -- print today's days as
    the new ones, so the reader is told nothing has changed -- SURVIVED the first
    version of this file. `ForwardLens` below hands `futureDays` in already
    computed, because that is what `forward_findings` takes; nothing exercised
    the line in `build_town` that derives it. A mutation is a claim about
    coverage, and that one was true.

    The fixture is one route with three registrations: a Monday service running
    now, a Saturday one starting in November and a Tuesday one starting in
    December. So today's pattern, the union of the future ones, and the first
    future one are three different answers, and a case can only pass by picking
    the right one.
    """

    def setUp(self):
        TmpCase.setUp(self)
        def cal(sid, day, start):
            row = dict(service_id=sid, start_date=start, end_date="20271231")
            for d in ("monday", "tuesday", "wednesday", "thursday", "friday",
                      "saturday", "sunday"):
                row[d] = "1" if d == day else "0"
            return row
        tables = feed(
            [("R1", "55")],
            [("R1", "NOW", "T0"), ("R1", "NOV", "T1"), ("R1", "DEC", "T2")],
            [("T0", ["0500A"]), ("T1", ["0500A"]), ("T2", ["0500A"])],
            calendar=[cal("NOW", "monday", "20260101"),
                      cal("NOV", "saturday", "20261101"),
                      cal("DEC", "tuesday", "20261201")])
        self.R = up.build_town(self.cur(tables), "20260801", ["0500"], None)["55"]

    def test_todays_pattern_is_the_union_of_everything_registered(self):
        self.assertEqual(self.R["days"], "Mon & Tue & Sat")

    def test_the_future_pattern_is_the_union_of_the_FUTURE_services_only(self):
        """Monday is absent: it is what the route does now, not what it becomes."""
        self.assertEqual(self.R["futureDays"], "Tue & Sat")

    def test_the_future_start_is_the_EARLIEST_of_them(self):
        """The date the reader has to act by is the first one, not the last."""
        self.assertEqual(self.R["futureStart"], "20261101")

    def test_the_future_registrations_are_ordered_by_start_date(self):
        self.assertEqual([f["start"] for f in self.R["future"]], ["20261101", "20261201"])

    def test_the_raw_day_flags_do_not_travel_into_the_snapshot(self):
        """`future[].flags` is working state; the snapshot is a committed record
        and every field in it is one a later diff can be read against."""
        self.assertTrue(all("flags" not in f for f in self.R["future"]))


# ------------------------------------------------- the two numbers OA-269 separated

class TheTwoNumbers(TmpCase):
    """`tripCount` is bookkeeping and `routingHash` is the road, AT SOURCE.

    `tools/prove-red-timetable-trigger.py` asserts what the [TIMETABLE] sentence
    says when it is HANDED a held hash and a moved count. This asserts that a
    feed in which the operator re-registers the same journeys actually produces
    that pair -- the half that harness cannot reach, because its fixtures are
    the dictionaries this function builds.

    St Neots Co-op was adjudicated `rebuild-needed` on 2026-08-31 off "trips
    161 -> 126" and re-measured on 2026-09-07 with `journeysPerWeek` unmoved at
    326. That is this shape.
    """

    ROAD = ["0500A", "0500B", "0500C"]
    DETOUR = ["0500A", "0500D", "0500C"]
    STOPS = [{"stop_id": s, "stop_name": s, "stop_lat": "52.3232", "stop_lon": "-0.0742"}
             for s in ("0500A", "0500B", "0500C", "0500D")]

    def build(self, journeys):
        """`journeys` is a list of (service_id, stop sequence)."""
        trips = [("R1", sid, "T%d" % i) for i, (sid, _) in enumerate(journeys)]
        times = [("T%d" % i, seq) for i, (_, seq) in enumerate(journeys)]
        cal = [_stubs.every_day(sid) for sid in sorted({s for s, _ in journeys})]
        tables = feed([("R1", "55")], trips, times, calendar=cal, stops=self.STOPS)
        return up.build_town(self.cur(tables), "20260801", ["0500"], None)["55"]

    def test_the_same_road_driven_twice_moves_the_count_and_not_the_hash(self):
        once = self.build([("S1", self.ROAD)])
        twice = self.build([("S1", self.ROAD), ("S2", self.ROAD)])
        self.assertEqual((once["tripCount"], twice["tripCount"]), (1, 2))
        self.assertEqual(once["routingHash"], twice["routingHash"])

    def test_a_different_road_moves_the_hash(self):
        """The control: "the hash held" above must not be "the hash never moves"."""
        road = self.build([("S1", self.ROAD)])
        detour = self.build([("S1", self.DETOUR)])
        self.assertEqual((road["tripCount"], detour["tripCount"]), (1, 1))
        self.assertNotEqual(road["routingHash"], detour["routingHash"])

    def test_the_pair_is_what_diff_findings_then_reads(self):
        """End to end: a re-registration must say so, not claim the road moved.

        Asserted through the real `diff_findings` rather than by inspecting the
        two fields, because the fields are only worth having if the finding
        they produce is the honest one.
        """
        prev = self.build([("S1", self.ROAD), ("S2", self.ROAD)])
        cur = self.build([("S1", self.ROAD)])
        found = up.diff_findings({"55": cur}, {"55": prev})
        self.assertEqual([k for k, *_ in found], ["TIMETABLE"])
        self.assertIn("stop sequences UNCHANGED", found[0][2])
        self.assertIn("not a rate", found[0][2])


# ---------------------------------------------------------- which stops are the town

class WhichStopsAreTheTown(TmpCase):
    """`make_town_stops` decides the frame every other answer is measured in.

    A radius quietly too wide is a town sheet reporting changes to buses that do
    not call there, and nothing downstream could tell.
    """

    CENTRE = (52.3232, -0.0742)      # St Ives bus station
    STOPS = [
        {"stop_id": "0500NEAR", "stop_name": "Near", "stop_lat": "52.3240", "stop_lon": "-0.0742"},
        {"stop_id": "0500FAR", "stop_name": "Far", "stop_lat": "52.3732", "stop_lon": "-0.0742"},
        {"stop_id": "0500BLANK", "stop_name": "No position", "stop_lat": "", "stop_lon": ""},
    ]

    def two_routes(self):
        return feed([("R1", "55"), ("R2", "99"), ("R3", "12")],
                    [("R1", "S1", "T1"), ("R2", "S1", "T2"), ("R3", "S1", "T3")],
                    [("T1", ["0500NEAR"]), ("T2", ["0500FAR"]), ("T3", ["0500BLANK"])],
                    calendar=[_stubs.every_day("S1")], stops=self.STOPS)

    def test_a_radius_takes_the_stop_inside_it_and_leaves_the_one_outside(self):
        near = up.build_town(self.cur(self.two_routes()), "20260801", None,
                             (self.CENTRE[0], self.CENTRE[1], 1.0))
        self.assertEqual(sorted(near), ["55"])

    def test_a_wider_radius_reaches_both(self):
        """The control: the route excluded above is in the feed and reachable."""
        wide = up.build_town(self.cur(self.two_routes()), "20260801", None,
                             (self.CENTRE[0], self.CENTRE[1], 20.0))
        self.assertEqual(sorted(wide), ["55", "99"])

    def test_a_stop_with_no_position_is_skipped_rather_than_crashing_the_scan(self):
        """One unpositioned stop in a county feed must not take the town with it."""
        wide = up.build_town(self.cur(self.two_routes()), "20260801", None,
                             (self.CENTRE[0], self.CENTRE[1], 20.0))
        self.assertNotIn("12", wide)

    def test_prefixes_select_by_ATCO_code(self):
        """The registered-town lens: `town_prefixes.json` names code prefixes."""
        got = up.build_town(self.cur(self.two_routes()), "20260801", ["0500F"], None)
        self.assertEqual(sorted(got), ["99"])

    def test_the_operator_and_the_day_pattern_are_unioned_over_the_route(self):
        tables = feed([("R1", "55")], [("R1", "MON", "T1"), ("R1", "SAT", "T2")],
                      [("T1", ["0500A"]), ("T2", ["0500A"])],
                      calendar=[
                          dict(service_id="MON", monday="1", tuesday="0", wednesday="0",
                               thursday="0", friday="0", saturday="0", sunday="0",
                               start_date="20260101", end_date="20271231"),
                          dict(service_id="SAT", monday="0", tuesday="0", wednesday="0",
                               thursday="0", friday="0", saturday="1", sunday="0",
                               start_date="20260101", end_date="20271231")])
        R = up.build_town(self.cur(tables), "20260801", ["0500"], None)["55"]
        self.assertEqual(R["days"], "Mon & Sat")
        self.assertEqual(R["operators"], ["Whippet Coaches"])


# ------------------------------------------------------------------- the forward lens

class ForwardLens(unittest.TestCase):
    """[CHANGE] / [NEW] / [ENDS?] -- the three the report leads with.

    Route dictionaries are written out here rather than built from a feed: this
    function takes them as its argument, and the classes above already prove
    `build_town` produces this shape.
    """

    TODAY = "20261001"
    FEED_START = "20260801"

    def route(self, runs_now=True, future_start="20261101", future_days="Mon-Fri",
              end="20271231", operators=("Whippet Coaches",), days="Daily"):
        R = {"route": "55", "operators": list(operators), "days": days,
             "start": "20260101" if runs_now else future_start, "end": end, "future": []}
        if future_start:
            R["future"] = [{"service": "S2", "start": future_start, "end": end,
                            "days": future_days}]
            R["futureStart"] = future_start
            R["futureDays"] = future_days
        return {"55": R}

    def only(self, routes, prev=None, ahead=90):
        found = up.forward_findings(routes, prev, self.FEED_START, self.TODAY, ahead)
        return found[0] if found else None

    def test_a_route_already_running_gains_a_future_service_and_that_is_a_CHANGE(self):
        tag, sn, when, msg = self.only(self.route(runs_now=True))
        self.assertEqual((tag, sn, when), ("CHANGE", "55", "20261101"))
        self.assertIn("already running", msg)
        self.assertIn("timetable changes then", msg)

    def test_a_route_not_running_yet_is_a_NEW_service_rather_than_a_change(self):
        tag, sn, _, msg = self.only(self.route(runs_now=False))
        self.assertEqual((tag, sn), ("NEW", "55"))
        self.assertIn("not currently running", msg)
        self.assertIn("prepare leaflet", msg)

    def test_the_days_printed_are_the_FUTURE_pattern_not_todays(self):
        """The reader is being told what the timetable becomes, not what it is."""
        _, _, _, msg = self.only(self.route(days="Daily", future_days="Mon-Fri"))
        self.assertIn("[Mon-Fri]", msg)
        self.assertNotIn("[Daily]", msg)

    def test_the_lead_time_is_counted_from_today(self):
        _, _, _, msg = self.only(self.route(future_start="20261101"))
        self.assertIn("(31d away)", msg)

    def test_a_start_that_is_new_since_last_month_says_so(self):
        """"Getting ahead" is the point: what arrived since the last scan."""
        _, _, _, msg = self.only(self.route(), prev={})
        self.assertIn("newly registered this month", msg)

    def test_a_start_that_was_already_there_last_month_does_not(self):
        prev = {"55": {"future": [{"start": "20261101"}]}}
        _, _, _, msg = self.only(self.route(), prev=prev)
        self.assertNotIn("newly registered", msg)

    def test_a_FIRST_run_annotates_nothing_rather_than_calling_everything_new(self):
        """prev is None when there is no previous snapshot at all.

        `{}` means "last month had no such route" and `None` means "there was no
        last month"; treating the second as the first would mark every finding
        on a first run as newly registered.
        """
        _, _, _, msg = self.only(self.route(), prev=None)
        self.assertNotIn("newly registered", msg)

    def test_a_registration_running_out_inside_the_window_is_an_ENDS_query(self):
        tag, sn, when, msg = self.only(self.route(future_start=None, end="20261101"))
        self.assertEqual((tag, sn, when), ("ENDS?", "55", "20261101"))
        self.assertIn("verify", msg)

    def test_a_registration_running_out_beyond_the_window_is_not_raised(self):
        self.assertIsNone(self.only(self.route(future_start=None, end="20261101"), ahead=10))

    def test_a_route_with_a_future_service_is_never_also_an_ENDS(self):
        """Something IS registered beyond, which is the whole ENDS? question."""
        tag, _, _, _ = self.only(self.route(future_start="20261101", end="20261101"))
        self.assertEqual(tag, "CHANGE")

    def test_a_future_start_that_has_already_passed_raises_nothing_at_all(self):
        """A stale snapshot's "future" is history, and history is not a finding."""
        self.assertIsNone(self.only(self.route(future_start="20260901")))


# ------------------------------------------------------------ last month's snapshot

class PreviousSnapshot(TmpCase):
    """`prev_snapshot` picks what this month is compared against."""

    def snapshots(self, isos):
        updir = os.path.join(self.tmp, "upcoming")
        for iso in isos:
            _stubs.write_json(os.path.join(updir, "snapshot_%s.json" % iso), {"generated": iso})
        return updir

    def test_it_picks_the_newest_one_BEFORE_today(self):
        updir = self.snapshots(["2026-07-01", "2026-08-01", "2026-09-01"])
        path, data = up.prev_snapshot(updir, "2026-09-01")
        self.assertEqual(os.path.basename(path), "snapshot_2026-08-01.json")
        self.assertEqual(data["generated"], "2026-08-01")

    def test_it_never_picks_TODAYS_own_snapshot(self):
        """A re-run the same day would otherwise diff the feed against itself and
        report a month of quiet -- the worst possible answer, because it is the
        same answer a month with no changes gives."""
        updir = self.snapshots(["2026-09-01"])
        self.assertEqual(up.prev_snapshot(updir, "2026-09-01"), (None, None))

    def test_no_previous_snapshot_at_all_is_None_rather_than_an_empty_dict(self):
        """`{}` would mean "last month had no routes", so every route in every
        town would read as [APPEARED] on a first run."""
        updir = self.snapshots([])
        self.assertEqual(up.prev_snapshot(updir, "2026-09-01"), (None, None))


if __name__ == "__main__":
    unittest.main()
