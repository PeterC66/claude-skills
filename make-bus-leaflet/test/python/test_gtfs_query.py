"""gtfs_query.py -- the module that decides what a town's bus network IS.

WHY THIS MODULE AND NOT ANOTHER OF THE ELEVEN LEFT. The two that write a number
into tracked map data were taken first (`gtfs_duration.py` on 2026-09-15,
`prune_runs.py` the same morning). This one writes the FILE: S1 runs it and its
output becomes the town's `verified-services.json`, which is tracked, which every
later stage reads, and which no other instrument can contradict. A route it
misses is a route the sheet never draws; a day string it gets wrong is printed
under a route number; and the five frequency fields it computes are what
`frequency_tiers` turns into the LINE WEIGHT of every lane on every map in the
estate. A sheet built from a wrong number here reproduces byte-for-byte for
ever, so every byte gate in the estate is green over it, and the only reader left
is somebody standing at a stop.

THE FOUR RULES BELOW EACH COST SOMETHING TO LEARN, each is recorded in the
module's own docstrings, and not one is reachable from any gate.

* **calendar_dates overrides calendar, and the days are RESOLVED rather than
  declared** (OA-204, fixed 2026-08-31). High Wycombe's 300 is filed Mon-Fri and
  adds 263 individual weekend dates; read from the `calendar` row it printed "no
  Sunday bus" onto a sheet where 12 Sunday journeys run. `daysBasis` is the field
  that says which claim you are reading, and the declared fallback exists only
  for a route sampled out of its season.
* **A journey filed twice is one journey.** High Wycombe's M40 files each working
  under up to four service_ids, stop-for-stop identical, which alone dragged its
  median headway to 0 minutes. The identity is the WHOLE stop sequence, because
  St Ives' 5A has two different journeys leaving at 11:40 in the same direction
  and they must stay two.
* **The gap, not the count and not the span.** St Ives' 69 runs four journeys
  over an 11h10 span -- wider than the all-day 5A -- and what identifies it as a
  commuter shuttle is the ten-hour hole in the middle. Endpoints cannot see a
  hole.
* **The median gap in the busier direction, over DISTINCT minutes.** The worst
  gap of a day is set by the thinnest hour and demotes every turn-up-and-go
  route; two buses leaving in the same minute are one wait, not a zero one.

THE FIXTURES ARE STUBS, NOT A FEED, following `_stubs.py`'s reasoning: the real
sqlite is hundreds of megabytes, untracked and rebuilt monthly, so an assertion
about what it contains is an assertion about what BODS published that week.
Every end-to-end case passes `--asof`, because `query()` otherwise samples from
`date.today()` and a suite whose fixtures move with the calendar is the
clock-dependent artefact this project has already been red on.
"""
import datetime
import os
import unittest

import _engine
import _stubs

gq = _engine.load("gtfs_query")

TOWN = "0500HSTIV"
# A Monday, so the sampled window starts on the day the fixtures are written for.
ASOF = "20260105"
MON = datetime.date(2026, 1, 5)


def _cal(sid, days, start="20260101", end="20271231"):
    """A calendar row running on `days` -- indices into gtfs_query.DOW."""
    row = {"service_id": sid, "start_date": start, "end_date": end}
    for i, name in enumerate(gq.DOW):
        row[name] = "1" if i in days else "0"
    return row


def _stop(sid, name, lat="52.3231", lon="-0.0709"):
    return {"stop_id": sid, "stop_name": name, "stop_lat": lat, "stop_lon": lon}


def _trip(trip_id, service_id, calls, route_id="R1", direction="0", headsign="Cambridge"):
    """One trip and its stop_times. `calls` is [(stop_id, "HH:MM:SS"), ...]."""
    trip = {"trip_id": trip_id, "route_id": route_id, "service_id": service_id,
            "trip_headsign": headsign, "direction_id": direction}
    times = [{"trip_id": trip_id, "stop_id": sid, "stop_sequence": str(i),
              "arrival_time": t, "departure_time": t}
             for i, (sid, t) in enumerate(calls)]
    return trip, times


def _db(tables):
    path = os.path.join(_stubs.scratch("gtfs-query-"), "gtfs.sqlite")
    return _stubs.gtfs_db(path, tables)


def _town_db(trips, calendar, calendar_dates=None, routes=None, agency=None, stops=None):
    """A feed holding one town stop, one out-of-town stop and `trips`."""
    all_trips, all_times = [], []
    for t, times in trips:
        all_trips.append(t)
        all_times.extend(times)
    return _db({
        "agency": agency or [{"agency_id": "A1", "agency_name": "Whippet"}],
        "stops": stops or [_stop(TOWN + "001", "St Ives, Bus Station"),
                           _stop("0500CCITY001", "Cambridge, Drummer Street")],
        "routes": routes or [{"route_id": "R1", "agency_id": "A1",
                              "route_short_name": "300",
                              "route_long_name": "St Ives - Cambridge"}],
        "trips": all_trips,
        "stop_times": all_times,
        "calendar": calendar,
        "calendar_dates": calendar_dates or [],
    })


def _one(res):
    """The single service a fixture is expected to yield."""
    assert len(res["services"]) == 1, "fixture yielded %d services" % len(res["services"])
    return res["services"][0]


class TheDayString(unittest.TestCase):
    """`days` is printed under the route number on every internal sheet."""

    def test_no_day_at_all_is_a_question_mark_not_an_empty_string(self):
        """An empty string would print as a blank and read as "no restriction"."""
        self.assertEqual(gq.fmt_days([0] * 7), "?")

    def test_all_seven_is_Daily(self):
        self.assertEqual(gq.fmt_days([1] * 7), "Daily")

    def test_a_run_of_three_or_more_is_hyphenated(self):
        self.assertEqual(gq.fmt_days([1, 1, 1, 1, 1, 0, 0]), "Mon-Fri")
        self.assertEqual(gq.fmt_days([0, 0, 0, 0, 0, 1, 1]), "Sat & Sun")

    def test_two_adjacent_days_are_spelled_out_rather_than_hyphenated(self):
        """"Mon-Tue" is the same width as "Mon & Tue" and says less."""
        self.assertEqual(gq.fmt_days([1, 1, 0, 0, 0, 0, 0]), "Mon & Tue")

    def test_up_to_three_scattered_days_are_ampersanded(self):
        self.assertEqual(gq.fmt_days([1, 0, 1, 0, 1, 0, 0]), "Mon & Wed & Fri")

    def test_four_or_more_scattered_days_are_comma_separated(self):
        """Three ampersands in one panel cell is what the comma form avoids."""
        self.assertEqual(gq.fmt_days([1, 1, 0, 1, 1, 0, 0]), "Mon, Tue, Thu, Fri")

    def test_a_single_day_is_its_own_name(self):
        self.assertEqual(gq.fmt_days([0, 0, 0, 0, 0, 0, 1]), "Sun")


class WhetherAServiceRunsOnADate(unittest.TestCase):
    """`_runs` is the only place calendar_dates is honoured, and every count,
    day flag and frequency field in the module is resolved through it."""

    def setUp(self):
        self.cal = {"S": _cal("S", [0, 1, 2, 3, 4])}

    def test_a_declared_weekday_inside_the_window_runs(self):
        self.assertTrue(gq._runs(self.cal, {}, "S", "20260105", "monday"))

    def test_a_weekday_the_calendar_does_not_declare_does_not_run(self):
        self.assertFalse(gq._runs(self.cal, {}, "S", "20260110", "saturday"))

    def test_a_date_outside_the_window_does_not_run(self):
        self.assertFalse(gq._runs({"S": _cal("S", [0], "20260201", "20260228")},
                                  {}, "S", "20260105", "monday"))

    def test_a_removal_beats_a_declared_weekday(self):
        """A bank holiday is an exception row, not a different calendar."""
        exc = {"S": {"20260105": "2"}}
        self.assertFalse(gq._runs(self.cal, exc, "S", "20260105", "monday"))

    def test_an_addition_beats_a_weekday_the_calendar_turns_off(self):
        """This is OA-204 in one assertion: High Wycombe's 300 is filed Mon-Fri
        and adds every weekend of a nine-month registration."""
        exc = {"S": {"20260110": "1"}}
        self.assertTrue(gq._runs(self.cal, exc, "S", "20260110", "saturday"))

    def test_an_addition_beats_the_declared_window_as_well(self):
        """The window is checked only after the exceptions, which is what lets a
        calendar_dates-only service exist at all."""
        cal = {"S": _cal("S", [0], "20260201", "20260228")}
        self.assertTrue(gq._runs(cal, {"S": {"20260105": "1"}}, "S", "20260105", "monday"))

    def test_a_service_with_no_calendar_row_and_no_addition_does_not_run(self):
        self.assertFalse(gq._runs({}, {}, "S", "20260105", "monday"))


class TheSampledWeeks(unittest.TestCase):
    """The window every frequency field is measured over. Deterministic by
    construction: same feed plus same reference date gives the same weeks."""

    def setUp(self):
        self.cal = {"S": _cal("S", [0])}

    def test_the_window_starts_on_the_Monday_of_the_reference_week(self):
        """A Thursday reference must not produce a four-day first week, or the
        first week's journey count is short and the range is wrong."""
        weeks = gq._sample_mondays(self.cal, datetime.date(2026, 1, 8), n=2)
        self.assertEqual(weeks[0], MON)

    def test_the_weeks_are_consecutive_rather_than_spread(self):
        """Consecutive so the window straddles a school holiday boundary and the
        range SHOWS term-time variation instead of averaging it away."""
        weeks = gq._sample_mondays(self.cal, MON, n=3)
        self.assertEqual(weeks, [MON, MON + datetime.timedelta(weeks=1),
                                 MON + datetime.timedelta(weeks=2)])

    def test_the_window_stops_at_the_last_date_the_feed_covers(self):
        """Sampling past the end of the feed counts real weeks as empty ones and
        drags weeksActive down for every route in the town."""
        cal = {"S": _cal("S", [0], "20260101", "20260120")}
        self.assertEqual(gq._sample_mondays(cal, MON, n=12),
                         [MON, MON + datetime.timedelta(weeks=1),
                          MON + datetime.timedelta(weeks=2)])

    def test_a_feed_that_ended_before_the_reference_still_yields_one_week(self):
        """An empty week list would divide by zero downstream; the honest answer
        is one week that turns out to hold nothing."""
        cal = {"S": _cal("S", [0], "20250101", "20250201")}
        self.assertEqual(gq._sample_mondays(cal, MON, n=12), [MON])

    def test_a_feed_with_no_calendar_at_all_is_not_treated_as_ended(self):
        self.assertEqual(len(gq._sample_mondays({}, MON, n=4)), 4)


class ClockTimes(unittest.TestCase):

    def test_a_timetabled_time_is_minutes_after_midnight(self):
        self.assertEqual(gq._mins("09:20:00"), 9 * 60 + 20)

    def test_an_hour_past_midnight_is_not_clamped(self):
        """GTFS writes 25:10 for a 01:10 journey belonging to the previous
        service day; clamping it would put a night bus at the head of the day and
        make every gap on that day wrong."""
        self.assertEqual(gq._mins("25:10:00"), 25 * 60 + 10)

    def test_the_clock_form_round_trips(self):
        self.assertEqual(gq._clock(gq._mins("07:05:00")), "07:05")

    def test_the_clock_form_keeps_the_hour_past_midnight_too(self):
        self.assertEqual(gq._clock(25 * 60 + 10), "25:10")


class TheShapeOfADay(unittest.TestCase):
    """`_day_shape` computes three of the five fields a line weight is tiered
    from. Nothing downstream can contradict any of them."""

    def test_a_day_with_no_departures_is_zero_and_nulls_rather_than_an_error(self):
        shape = gq._day_shape([])
        self.assertEqual(shape["typicalDayJourneys"], 0)
        self.assertIsNone(shape["typicalDayWindow"])
        self.assertIsNone(shape["coreHeadwayMinutes"])
        self.assertIsNone(shape["longestDaytimeGap"])

    def test_the_gap_is_what_separates_a_commuter_shuttle_from_an_all_day_bus(self):
        """St Ives' 69: 07:00, 07:10, 17:30, 18:10. Four journeys over a span of
        11h10, wider than the all-day 5A, and the ten-hour hole is the only
        measure that tells the two apart."""
        profile = [(420, "0"), (430, "0"), (1050, "1"), (1090, "1")]
        shape = gq._day_shape(profile)
        self.assertEqual(shape["typicalDayJourneys"], 4)
        self.assertEqual(shape["typicalDayWindow"], ["07:00", "18:10"])
        self.assertEqual(shape["longestDaytimeGap"], 620)

    def test_the_gap_is_taken_across_BOTH_directions(self):
        """A hole in the service is a hole whichever way you are travelling, so
        an inbound journey closes an outbound gap."""
        both = gq._day_shape([(420, "0"), (700, "1"), (1100, "0")])
        self.assertEqual(both["longestDaytimeGap"], 400)

    def test_the_gap_ignores_departures_outside_the_working_day(self):
        """07:00-19:00 is the working day: a 05:50 school working and a 20:00
        night bus must not open a hole inside it. The fixture is chosen so that
        including them ENLARGES the answer rather than merely splitting it --
        an out-of-day departure between two in-day ones could only subdivide a
        gap, and a test built that way passes whether the filter is there or
        not."""
        shape = gq._day_shape([(350, "0"), (420, "0"), (500, "0"), (1200, "0")])
        self.assertEqual(shape["longestDaytimeGap"], 80)

    def test_the_window_however_is_the_whole_day_rather_than_the_working_day(self):
        """typicalDayWindow is what a reader is told the bus runs between, so it
        must include the early and late workings the gap measure excludes."""
        shape = gq._day_shape([(350, "0"), (420, "0"), (500, "0"), (1200, "0")])
        self.assertEqual(shape["typicalDayWindow"], ["05:50", "20:00"])

    def test_the_core_headway_is_the_MEDIAN_gap_not_the_worst(self):
        """The worst gap of a day is set by its thinnest hour and would demote
        every turn-up-and-go route there is."""
        profile = [(540, "0"), (570, "0"), (600, "0"), (780, "0")]
        self.assertEqual(gq._day_shape(profile)["coreHeadwayMinutes"], 30)

    def test_a_repeated_minute_does_not_contribute_a_gap_of_zero(self):
        """Two buses leaving at the same minute are one moment to wait for. High
        Wycombe's M40 files every journey up to four times, which alone dragged
        its median headway to 0."""
        profile = [(540, "0"), (540, "0"), (545, "0"), (600, "0")]
        self.assertEqual(gq._day_shape(profile)["coreHeadwayMinutes"], 30)

    def test_the_headway_is_taken_in_the_busier_direction(self):
        """That is the wait a passenger going one way actually has; splitting a
        small service by direction is what this avoids."""
        profile = [(540, "0"), (600, "0"), (660, "0"), (720, "0"),
                   (545, "1"), (785, "1")]
        self.assertEqual(gq._day_shape(profile)["coreHeadwayMinutes"], 60)

    def test_a_core_day_holding_fewer_than_three_departures_has_no_headway(self):
        """Two departures give one gap, and one gap is not a headway. Null says
        so; a number would be quoted."""
        profile = [(540, "0"), (600, "0"), (1100, "0")]
        self.assertIsNone(gq._day_shape(profile)["coreHeadwayMinutes"])

    def test_departures_outside_the_core_day_do_not_set_the_headway(self):
        """09:00-15:00 is where a headway means what it says."""
        profile = [(420, "0"), (540, "0"), (600, "0"), (1100, "0")]
        self.assertIsNone(gq._day_shape(profile)["coreHeadwayMinutes"])


class Distance(unittest.TestCase):
    """`--near` selects a town's stops by radius when its ATCO prefix does not
    describe the place -- every standalone place map is built this way."""

    def test_a_stop_is_no_distance_from_itself(self):
        self.assertAlmostEqual(gq._haversine_km(52.3231, -0.0709, 52.3231, -0.0709), 0.0)

    def test_a_hundredth_of_a_degree_of_latitude_is_about_1_1_km(self):
        self.assertAlmostEqual(
            gq._haversine_km(52.3231, -0.0709, 52.3331, -0.0709), 1.112, places=3)


class WhichDaysTheRouteActuallyRuns(unittest.TestCase):
    """OA-204 end to end, through `query()` and the file S1 writes."""

    def _res(self, calendar_dates):
        trip = _trip("T1", "WKDY", [(TOWN + "001", "09:00:00"),
                                    ("0500CCITY001", "09:40:00")])
        db = _town_db([trip], [_cal("WKDY", [0, 1, 2, 3, 4])], calendar_dates)
        return gq.query(db, prefixes=[TOWN], town="St Ives", asof=ASOF)

    def test_a_Mon_to_Fri_calendar_with_no_exceptions_reads_Mon_to_Fri(self):
        """The control. Without it the test below cannot tell the resolver from a
        function that always answers Daily."""
        svc = _one(self._res([]))
        self.assertEqual(svc["days"], "Mon-Fri")
        self.assertEqual(svc["daysFlags"], [1, 1, 1, 1, 1, 0, 0])

    def test_weekend_dates_added_by_calendar_dates_reach_the_day_string(self):
        """High Wycombe's 300: filed Mon-Fri, adds every weekend. Read from the
        calendar row it printed "no Sunday bus" onto a sheet with 12 Sunday
        journeys, and no byte gate could see it -- the gate compares the drawing
        with ci-reference, not with the world."""
        svc = _one(self._res([{"service_id": "WKDY", "date": "20260110", "exception_type": "1"},
                              {"service_id": "WKDY", "date": "20260111", "exception_type": "1"}]))
        self.assertEqual(svc["daysFlags"], [1, 1, 1, 1, 1, 1, 1])
        self.assertEqual(svc["days"], "Daily")

    def test_the_resolved_answer_says_it_is_resolved(self):
        """"declared" and "observed" are two different claims and a reader cannot
        tell them apart from a day string alone."""
        self.assertTrue(_one(self._res([]))["daysBasis"].startswith("resolved"))

    def test_a_date_REMOVED_from_a_weekday_takes_that_day_off_the_sheet(self):
        """The other direction of the same rule, and the one a school-term break
        takes. Every Monday of the one sampled week is removed."""
        cal = [_cal("TERM", [0, 1], "20260101", "20260110")]
        trip = _trip("T1", "TERM", [(TOWN + "001", "09:00:00"),
                                    ("0500CCITY001", "09:40:00")])
        db = _town_db([trip], cal,
                      [{"service_id": "TERM", "date": "20260105", "exception_type": "2"}])
        svc = _one(gq.query(db, prefixes=[TOWN], town="St Ives", asof=ASOF))
        self.assertEqual(svc["daysFlags"], [0, 1, 0, 0, 0, 0, 0])

    def test_a_route_with_no_journey_in_the_window_falls_back_and_SAYS_SO(self):
        """A seasonal route sampled out of season still reports something rather
        than "?", but the claim is weaker and is labelled as one."""
        cal = [_cal("SEAS", [0, 1, 2, 3, 4], "20260101", "20260110")]
        dates = [{"service_id": "SEAS", "date": d, "exception_type": "2"}
                 for d in ("20260105", "20260106", "20260107", "20260108", "20260109")]
        trip = _trip("T1", "SEAS", [(TOWN + "001", "09:00:00"),
                                    ("0500CCITY001", "09:40:00")])
        db = _town_db([trip], cal, dates)
        svc = _one(gq.query(db, prefixes=[TOWN], town="St Ives", asof=ASOF))
        self.assertEqual(svc["days"], "Mon-Fri")
        self.assertTrue(svc["daysBasis"].startswith("declared"))
        self.assertEqual(svc["journeysPerWeek"], 0)
        self.assertEqual(svc["weeksActive"], 0)


class CountingJourneysRatherThanRows(unittest.TestCase):
    """Every count in the output is of DISTINCT journeys. The de-duplicator is
    invisible to every gate in the estate: a route counted twice draws a heavier
    lane, and the heavier lane reproduces byte-for-byte."""

    def _db_two(self, second_calls):
        first = _trip("D1", "DUPA", [(TOWN + "001", "08:00:00"),
                                     ("0500CCITY001", "08:30:00")])
        second = _trip("D2", "DUPB", second_calls)
        return _town_db([first, second],
                        [_stubs.every_day("DUPA"), _stubs.every_day("DUPB")],
                        stops=[_stop(TOWN + "001", "St Ives, Bus Station"),
                               _stop("0500CCITY001", "Cambridge, Drummer Street"),
                               _stop("0500HOLY001", "Holywell, The Ferry Boat")])

    def test_the_same_journey_filed_under_two_service_ids_is_counted_once(self):
        """High Wycombe's M40 files each working up to four times -- same
        headsign, same 18 stops, different service_id."""
        db = self._db_two([(TOWN + "001", "08:00:00"), ("0500CCITY001", "08:30:00")])
        svc = _one(gq.query(db, prefixes=[TOWN], town="St Ives", asof=ASOF))
        self.assertEqual(svc["journeysPerWeek"], 7)

    def test_and_the_collapse_is_recorded_rather_than_silent(self):
        """typicalDayDuplicates is the audit trail of what was collapsed; a
        de-duplicator that said nothing could not be checked against the feed."""
        db = self._db_two([(TOWN + "001", "08:00:00"), ("0500CCITY001", "08:30:00")])
        svc = _one(gq.query(db, prefixes=[TOWN], town="St Ives", asof=ASOF))
        self.assertEqual(svc["typicalDayDuplicates"], 1)

    def test_two_journeys_leaving_together_on_different_runs_stay_two(self):
        """St Ives' 5A leaves Bar Hill twice at 11:40 in the same direction -- one
        of 41 stops terminating at St Ives, one of 42 running on to Holywell.
        Same origin, same minute, two journeys, and collapsing them would halve a
        real route.

        THE FIXTURE IS THE HARDER VERSION OF THAT PAIR: the two journeys share
        their first AND last stop and differ only in the middle, because that is
        the case the whole-sequence rule exists for. The 5A's own pair ends at
        different places, so an endpoint signature would happen to keep those two
        apart and a test built on it would prove nothing about the rule."""
        db = self._db_two([(TOWN + "001", "08:00:00"), ("0500HOLY001", "08:20:00"),
                           ("0500CCITY001", "08:50:00")])
        svc = _one(gq.query(db, prefixes=[TOWN], town="St Ives", asof=ASOF))
        self.assertEqual(svc["journeysPerWeek"], 14)
        self.assertEqual(svc["typicalDayDuplicates"], 0)


class TheWeeklyRate(unittest.TestCase):
    """`journeysPerWeek` is the LOWER MEDIAN of the sampled weeks, and the range
    beside it is what shows term-time variation instead of hiding it."""

    def setUp(self):
        trip = _trip("T1", "WKDY", [(TOWN + "001", "09:00:00"),
                                    ("0500CCITY001", "09:40:00")])
        self.db = _town_db(
            [trip], [_cal("WKDY", [0, 1, 2, 3, 4])],
            [{"service_id": "WKDY", "date": "20260110", "exception_type": "1"},
             {"service_id": "WKDY", "date": "20260111", "exception_type": "1"}])
        self.svc = _one(gq.query(self.db, prefixes=[TOWN], town="St Ives", asof=ASOF))

    def test_one_unusually_busy_week_does_not_move_the_headline_rate(self):
        """The fixture runs five weekdays every week and adds one weekend, so
        eleven weeks hold 5 and one holds 7. A mean would print 5.2 and a
        one-off bank-holiday week would raise the weight of the lane."""
        self.assertEqual(self.svc["journeysPerWeek"], 5)

    def test_but_the_busy_week_is_still_visible_in_the_range(self):
        self.assertEqual(self.svc["journeysPerWeekRange"], [5, 7])

    def test_weeksActive_counts_the_weeks_the_service_runs_at_all(self):
        """A service below half the sample cannot hold a weekly rate: High
        Wycombe's 130, 300 and WW1 hold only bank-holiday trips and
        journeysPerWeek reports them at 24, 24 and 8."""
        self.assertEqual(self.svc["weeksActive"], 12)

    def test_the_sampled_window_is_declared_in_the_output(self):
        """A frequency figure whose window is not written down cannot be checked
        against the feed it came from."""
        basis = gq.query(self.db, prefixes=[TOWN], town="St Ives",
                         asof=ASOF)["frequencyBasis"]
        self.assertEqual(basis["weeksSampled"], 12)
        self.assertEqual(basis["from"], "2026-01-05")


class WhichRoutesAreOneRoute(unittest.TestCase):
    """Grouping and the variant hint. Both decide what the Services panel lists,
    and a wrong answer prints a route twice or loses one."""

    def _res(self, routes, agency, trips):
        db = _town_db(trips, [_stubs.every_day("SVC")], routes=routes, agency=agency)
        return gq.query(db, prefixes=[TOWN], town="St Ives", asof=ASOF)

    def test_two_route_ids_sharing_a_short_name_are_one_service(self):
        """A short_name routinely spans several route_ids -- one per direction,
        per operator, or per registration -- and listing each would print "7"
        twice in the panel."""
        res = self._res(
            [{"route_id": "Ra", "agency_id": "A1", "route_short_name": "7"},
             {"route_id": "Rb", "agency_id": "A2", "route_short_name": "7"}],
            [{"agency_id": "A1", "agency_name": "Whippet"},
             {"agency_id": "A2", "agency_name": "Stagecoach"}],
            [_trip("Ta", "SVC", [(TOWN + "001", "09:00:00"), ("0500CCITY001", "09:40:00")],
                   route_id="Ra"),
             _trip("Tb", "SVC", [(TOWN + "001", "10:00:00"), ("0500CCITY001", "10:40:00")],
                   route_id="Rb")])
        self.assertEqual(_one(res)["route"], "7")

    def test_and_both_operators_are_named_in_a_stable_order(self):
        """Sorted rather than feed order, or the printed operator string changes
        when BODS reorders its export and a sheet stops reproducing."""
        res = self._res(
            [{"route_id": "Ra", "agency_id": "A1", "route_short_name": "7"},
             {"route_id": "Rb", "agency_id": "A2", "route_short_name": "7"}],
            [{"agency_id": "A1", "agency_name": "Whippet"},
             {"agency_id": "A2", "agency_name": "Stagecoach"}],
            [_trip("Ta", "SVC", [(TOWN + "001", "09:00:00"), ("0500CCITY001", "09:40:00")],
                   route_id="Ra"),
             _trip("Tb", "SVC", [(TOWN + "001", "10:00:00"), ("0500CCITY001", "10:40:00")],
                   route_id="Rb")])
        self.assertEqual(_one(res)["operator"], "Stagecoach / Whippet")

    def test_a_lettered_route_is_flagged_as_a_possible_variant_of_its_base(self):
        res = self._res(
            [{"route_id": "R5", "agency_id": "A1", "route_short_name": "5"},
             {"route_id": "R5A", "agency_id": "A1", "route_short_name": "5A"}],
            [{"agency_id": "A1", "agency_name": "Whippet"}],
            [_trip("T5", "SVC", [(TOWN + "001", "09:00:00"), ("0500CCITY001", "09:40:00")],
                   route_id="R5"),
             _trip("T5A", "SVC", [(TOWN + "001", "10:00:00"), ("0500CCITY001", "10:40:00")],
                   route_id="R5A")])
        hint = {s["route"]: s["possibleVariantOf"] for s in res["services"]}
        self.assertEqual(hint["5A"], "5")

    def test_and_the_base_route_is_not_a_variant_of_the_lettered_one(self):
        """The rule is a prefix rule, so it must not run both ways or every pair
        would point at each other and the panel would have no parent."""
        res = self._res(
            [{"route_id": "R5", "agency_id": "A1", "route_short_name": "5"},
             {"route_id": "R5A", "agency_id": "A1", "route_short_name": "5A"}],
            [{"agency_id": "A1", "agency_name": "Whippet"}],
            [_trip("T5", "SVC", [(TOWN + "001", "09:00:00"), ("0500CCITY001", "09:40:00")],
                   route_id="R5"),
             _trip("T5A", "SVC", [(TOWN + "001", "10:00:00"), ("0500CCITY001", "10:40:00")],
                   route_id="R5A")])
        hint = {s["route"]: s["possibleVariantOf"] for s in res["services"]}
        self.assertIsNone(hint["5"])


class WhatCountsAsServingTheTown(unittest.TestCase):
    """The town stop set is the whole premise of the query: a route that passes
    through without calling is not this town's route."""

    def test_a_route_that_does_not_call_at_the_town_is_not_returned(self):
        db = _town_db(
            [_trip("T1", "SVC", [("0500CCITY001", "09:00:00"), ("0500HOLY001", "09:40:00")])],
            [_stubs.every_day("SVC")],
            stops=[_stop(TOWN + "001", "St Ives, Bus Station"),
                   _stop("0500CCITY001", "Cambridge, Drummer Street"),
                   _stop("0500HOLY001", "Holywell, The Ferry Boat")])
        self.assertEqual(gq.query(db, prefixes=[TOWN], town="St Ives",
                                  asof=ASOF)["services"], [])

    def test_the_termini_are_the_ends_of_the_whole_trip_not_of_the_town_leg(self):
        """The external sheet draws a spoke to a terminus, so trimming the trip
        at the town boundary would draw every route as ending here."""
        db = _town_db(
            [_trip("T1", "SVC", [("0500HOLY001", "08:40:00"), (TOWN + "001", "09:00:00"),
                                 ("0500CCITY001", "09:40:00")])],
            [_stubs.every_day("SVC")],
            stops=[_stop(TOWN + "001", "St Ives, Bus Station"),
                   _stop("0500CCITY001", "Cambridge, Drummer Street"),
                   _stop("0500HOLY001", "Holywell, The Ferry Boat")])
        svc = _one(gq.query(db, prefixes=[TOWN], town="St Ives", asof=ASOF))
        self.assertEqual(svc["termini"],
                         ["Cambridge, Drummer Street", "Holywell, The Ferry Boat"])

    def test_the_dataset_actually_read_is_named_in_the_output(self):
        """This field said "(east_anglia)" unconditionally, so every
        Buckinghamshire and Bedfordshire pull ever written recorded the wrong
        region in the one field a later reader would use to check it."""
        db = _town_db([_trip("T1", "SVC", [(TOWN + "001", "09:00:00"),
                                           ("0500CCITY001", "09:40:00")])],
                      [_stubs.every_day("SVC")])
        res = gq.query(db, prefixes=[TOWN], town="St Ives", asof=ASOF)
        self.assertEqual(res["source"], "BODS GTFS (gtfs)")


if __name__ == "__main__":
    unittest.main()
