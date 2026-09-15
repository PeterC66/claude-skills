"""gtfs_duration.py -- the module that writes a number onto a printed spoke.

WHY THIS MODULE AND NOT ANOTHER OF THE TEN LEFT. `--fill` and `--fill-place`
WRITE INTO a map's own `routes.json`, so this is one of the two untested Python
modules that can put a wrong value into tracked map data rather than merely
report one (`prune_runs.py`, tested on 2026-09-15, is the other and it deletes
rather than writes). The number it writes is printed on the external sheet as
"~N min" beside a spoke, and nothing downstream can contradict it: the byte gates
ask whether the sheet still reproduces, and a sheet built from a wrong minute
figure reproduces perfectly for ever.

THE FOUR RULES BELOW EACH HAVE A COST RECORDED IN THE MODULE'S OWN DOCSTRINGS,
and none of them is reachable from any gate in the estate.

* **The earliest arrival at the terminus.** Route 9 out of Godmanchester reaches
  St Ives Bus Station at 09:15, carries on round through Fenstanton and returns
  to the same bus station at 10:13. Timing to the trip's last stop called that
  20-minute ride 78 minutes. The pairing is SAME NaPTAN LOCALITY AND SAME STOP
  NAME, because the two visits are different stands (`0500HSTIV025` and
  `0500HSTIV002`); a plain distance rule was tried and rejected for shaving a
  minute off 13 of 44 town spokes.
* **The LAST origin stop.** A town has several stops on one trip, and the
  journey a rider makes starts at the last of them.
* **The majority-terminus fallback is opt-in.** GTFS names termini after POIs
  ("Drummer St Bus Station"), not towns, so name matching fails on a single-arm
  route; the fallback rescues that case and would silently blend two arms of a
  split route into one wrong number if the caller set it wrongly.
* **Three trips minimum, and the MEDIAN of them.** A thin sample is returned as
  no answer rather than as a confident one.

THE FIXTURES ARE STUBS, NOT A FEED, following `_stubs.py`'s reasoning: the real
sqlite is 80 MB, untracked, rebuilt monthly, and an assertion about what it
contains is an assertion about what BODS published that week.
"""
import os
import sqlite3
import unittest

import _engine
import _stubs

gd = _engine.load("gtfs_duration")


def _stops(*rows):
    """(stop_id, stop_name, lat, lon) tuples as GTFS stop rows."""
    return [{"stop_id": sid, "stop_name": name,
             "stop_lat": str(lat), "stop_lon": str(lon)}
            for sid, name, lat, lon in rows]


def _trip(trip_id, route_id, headsign, calls):
    """One trip plus its stop_times. `calls` is [(stop_id, "HH:MM:SS"), ...].

    Arrival and departure are written to the same value, which is what a
    timetabled bus stop row looks like in the real feed for all but a handful of
    timing points; the two are read separately by the module and tested apart in
    `ATripThatCannotBeTimed`.
    """
    trip = {"trip_id": trip_id, "route_id": route_id,
            "service_id": "SVC", "trip_headsign": headsign}
    times = [{"trip_id": trip_id, "stop_id": sid, "stop_sequence": str(i),
              "arrival_time": t, "departure_time": t}
             for i, (sid, t) in enumerate(calls)]
    return trip, times


def _db(testcase, stops, trips, route_short_name="46", route_id="R1"):
    """A GTFS sqlite holding one named route, `trips`, and `stops`.

    Returns an open cursor with `sqlite3.Row`, which `journey_minutes` requires:
    it reads its columns by name.
    """
    all_trips, all_times = [], []
    for t, times in trips:
        all_trips.append(t)
        all_times.extend(times)
    path = os.path.join(_stubs.scratch("gtfs-duration-"), "gtfs.sqlite")
    _stubs.gtfs_db(path, {
        "stops": stops,
        "routes": [{"route_id": route_id, "route_short_name": route_short_name}],
        "trips": all_trips,
        "stop_times": all_times,
        "calendar": [_stubs.every_day("SVC")],
    })
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    testcase.addCleanup(con.close)
    return con.cursor()


class Seconds(unittest.TestCase):
    """Every duration on an external sheet is a difference of two of these."""

    def test_a_timetabled_time_is_its_seconds(self):
        self.assertEqual(gd._to_seconds("09:20:00"), 9 * 3600 + 20 * 60)

    def test_a_time_after_midnight_keeps_counting(self):
        """GTFS writes 25:10:00 for a 01:10 arrival on the previous day's
        service, and a clock-modulo reading of it would make the journey
        negative."""
        self.assertEqual(gd._to_seconds("25:10:00"), 25 * 3600 + 10 * 60)

    def test_a_two_field_time_is_not_a_time(self):
        self.assertIsNone(gd._to_seconds("09:20"))

    def test_a_non_numeric_time_is_not_a_time(self):
        self.assertIsNone(gd._to_seconds("ab:cd:ef"))

    def test_an_absent_time_is_not_an_error(self):
        self.assertIsNone(gd._to_seconds(None))
        self.assertIsNone(gd._to_seconds(""))


class Locality(unittest.TestCase):
    """The key that pairs two stands of one bus station and nothing else."""

    def test_a_coded_atco_yields_its_locality(self):
        self.assertEqual(gd._locality("0500HSTIV025"), "0500HSTIV")
        self.assertEqual(gd._locality("0500HSTIV002"), "0500HSTIV")

    def test_a_bare_locality_is_too_short_to_be_a_stop(self):
        """Nine characters is the locality itself, not a stop within it -- and
        the rule needs a stop, or every stop in a town would pair with the
        terminus."""
        self.assertIsNone(gd._locality("0500HSTIV"))

    def test_a_numeric_block_is_not_a_locality(self):
        """Cross-border stops are often coded numerically, which is the case the
        module's own docstring says the rule must decline rather than guess."""
        self.assertIsNone(gd._locality("049004120001"))

    def test_an_absent_code_is_not_an_error(self):
        self.assertIsNone(gd._locality(None))
        self.assertIsNone(gd._locality(""))


class StopNames(unittest.TestCase):
    """The other half of the pairing key."""

    def test_case_and_runs_of_whitespace_are_normalised(self):
        self.assertEqual(gd._norm_stop_name("  St Ives   BUS  Station "),
                         "st ives bus station")

    def test_an_absent_name_is_the_empty_string(self):
        self.assertEqual(gd._norm_stop_name(None), "")


class CleanDest(unittest.TestCase):
    """routes.json labels are written for a reader, not for a GTFS match."""

    def test_a_trailing_qualifier_is_stripped(self):
        self.assertEqual(gd._clean_dest("Cambridge (Drummer St)"), "Cambridge")

    def test_a_plain_label_is_unchanged(self):
        self.assertEqual(gd._clean_dest("Wisbech"), "Wisbech")

    def test_surrounding_whitespace_goes(self):
        self.assertEqual(gd._clean_dest("  St Ives  "), "St Ives")


class Haversine(unittest.TestCase):
    """--near is the origin rule for a town with no clean ATCO prefix."""

    def test_a_stop_is_no_distance_from_itself(self):
        self.assertEqual(gd._haversine_km(52.3233, -0.0738, 52.3233, -0.0738), 0.0)

    def test_one_degree_of_latitude_is_about_111_km(self):
        self.assertAlmostEqual(gd._haversine_km(52.0, 0.0, 53.0, 0.0),
                               111.195, delta=0.05)


class OriginStops(unittest.TestCase):
    """Which stops count as "the town", before any timing happens."""

    def setUp(self):
        self.cur = _db(self, _stops(
            ("0500HSTIV025", "St Ives Bus Station", 52.3233, -0.0738),
            ("0500HSTIV002", "St Ives Bus Station", 52.3234, -0.0739),
            ("0500HWISB001", "Wisbech Horsefair", 52.6640, 0.1600),
            ("0500HBROK001", "Broken Coordinates", "x", "y"),
        ), [])

    def test_a_prefix_selects_that_localitys_stops_and_no_others(self):
        self.assertEqual(gd.resolve_origin_stop_ids(self.cur, prefixes=["0500HSTIV"]),
                         {"0500HSTIV025", "0500HSTIV002"})

    def test_near_selects_by_radius(self):
        got = gd.resolve_origin_stop_ids(self.cur, near=(52.3233, -0.0738, 1.0))
        self.assertEqual(got, {"0500HSTIV025", "0500HSTIV002"})

    def test_near_excludes_what_lies_outside_the_radius(self):
        got = gd.resolve_origin_stop_ids(self.cur, near=(52.3233, -0.0738, 1.0))
        self.assertNotIn("0500HWISB001", got)

    def test_a_stop_with_unparseable_coordinates_is_skipped_not_fatal(self):
        """The real feed carries them; a raise here would take out the whole
        origin set for one bad row."""
        got = gd.resolve_origin_stop_ids(self.cur, near=(52.3233, -0.0738, 500.0))
        self.assertNotIn("0500HBROK001", got)
        self.assertIn("0500HWISB001", got)

    def test_prefixes_and_near_are_a_union(self):
        got = gd.resolve_origin_stop_ids(self.cur, prefixes=["0500HWISB"],
                                         near=(52.3233, -0.0738, 1.0))
        self.assertEqual(got, {"0500HWISB001", "0500HSTIV025", "0500HSTIV002"})

    def test_no_prefix_and_no_radius_is_an_empty_origin(self):
        self.assertEqual(gd.resolve_origin_stop_ids(self.cur), set())


ST_IVES = ("0500HSTIV025", "St Ives Bus Station", 52.3233, -0.0738)
ST_IVES_B = ("0500HSTIV002", "St Ives Bus Station", 52.3234, -0.0739)
BROADWAY = ("0500HSTIV009", "The Broadway", 52.3250, -0.0700)
FENSTANTON = ("0500HFENS001", "Fenstanton Church", 52.2980, -0.0450)
WISBECH = ("0500HWISB001", "Wisbech Horsefair", 52.6640, 0.1600)
MANEA = ("0500HMANE001", "Manea Station Road", 52.4880, 0.1690)
DRUMMER = ("0590HCAMB001", "Drummer St Bus Station", 52.2050, 0.1240)
GODMAN = ("0500HGODM001", "Godmanchester Post Office", 52.3190, -0.1720)


class JourneyMinutes(unittest.TestCase):
    """The number that reaches the sheet."""

    def test_a_route_nobody_runs_is_no_answer_and_no_sample(self):
        cur = _db(self, _stops(ST_IVES, WISBECH), [])
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "999", "Wisbech"),
                         (None, 0))

    def test_three_trips_give_the_median_not_the_mean(self):
        """20, 22 and 30 -- the mean is 24, and one slow school-holiday working
        must not move a printed figure by four minutes."""
        trips = [
            _trip("T1", "R1", "Wisbech", [("0500HSTIV025", "09:00:00"),
                                          ("0500HWISB001", "09:20:00")]),
            _trip("T2", "R1", "Wisbech", [("0500HSTIV025", "10:00:00"),
                                          ("0500HWISB001", "10:22:00")]),
            _trip("T3", "R1", "Wisbech", [("0500HSTIV025", "11:00:00"),
                                          ("0500HWISB001", "11:30:00")]),
        ]
        cur = _db(self, _stops(ST_IVES, WISBECH), trips)
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Wisbech"),
                         (22, 3))

    def test_two_trips_are_too_thin_a_sample_to_trust(self):
        trips = [
            _trip("T1", "R1", "Wisbech", [("0500HSTIV025", "09:00:00"),
                                          ("0500HWISB001", "09:20:00")]),
            _trip("T2", "R1", "Wisbech", [("0500HSTIV025", "10:00:00"),
                                          ("0500HWISB001", "10:22:00")]),
        ]
        cur = _db(self, _stops(ST_IVES, WISBECH), trips)
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Wisbech"),
                         (None, 2))

    def test_the_journey_starts_at_the_LAST_town_stop_the_trip_calls_at(self):
        """A rider boarding in town boards once, and the bus may call three
        times on its way out. Timing from the first call adds the town leg to
        every spoke on the sheet."""
        trips = []
        for i, hh in enumerate(("09", "10", "11")):
            trips.append(_trip("T%d" % i, "R1", "Wisbech", [
                ("0500HSTIV025", hh + ":00:00"),
                ("0500HSTIV009", hh + ":05:00"),
                ("0500HSTIV002", hh + ":10:00"),
                ("0500HWISB001", hh + ":30:00")]))
        cur = _db(self, _stops(ST_IVES, BROADWAY, ST_IVES_B, WISBECH), trips)
        origin = {"0500HSTIV025", "0500HSTIV009", "0500HSTIV002"}
        self.assertEqual(gd.journey_minutes(cur, origin, "46", "Wisbech"), (20, 3))

    def test_a_trip_that_only_arrives_in_town_is_not_a_journey_out_of_it(self):
        """The inbound half of the same service calls at the town LAST, and
        there is nothing after it to time to."""
        trips = []
        for i, hh in enumerate(("09", "10", "11")):
            trips.append(_trip("T%d" % i, "R1", "St Ives", [
                ("0500HWISB001", hh + ":00:00"),
                ("0500HSTIV025", hh + ":20:00")]))
        cur = _db(self, _stops(ST_IVES, WISBECH), trips)
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Wisbech"),
                         (None, 0))


class ALoopingRoute(unittest.TestCase):
    """Route 9's 20-minute ride that timed as 78. The module's costliest rule."""

    def test_it_times_to_the_FIRST_arrival_at_the_terminus(self):
        """08:55 -> 09:15 is 20 minutes. The trip's last stop is the same bus
        station again at 10:13, which would read as 78."""
        trips = []
        for i, h in enumerate((8, 9, 10)):
            trips.append(_trip("T%d" % i, "R1", "St Ives", [
                ("0500HGODM001", "%02d:55:00" % h),
                ("0500HSTIV025", "%02d:15:00" % (h + 1)),
                ("0500HFENS001", "%02d:40:00" % (h + 1)),
                ("0500HSTIV002", "%02d:13:00" % (h + 2))]))
        cur = _db(self, _stops(GODMAN, ST_IVES, FENSTANTON, ST_IVES_B), trips)
        self.assertEqual(gd.journey_minutes(cur, {"0500HGODM001"}, "46", "St Ives"),
                         (20, 3))

    def test_the_same_locality_under_a_DIFFERENT_name_is_not_the_terminus(self):
        """Matching on locality alone would pair The Broadway with the bus
        station and cut every St Ives spoke short."""
        trips = []
        for i, hh in enumerate((8, 9, 10)):
            trips.append(_trip("T%d" % i, "R1", "St Ives", [
                ("0500HGODM001", "%02d:55:00" % hh),
                ("0500HSTIV009", "%02d:05:00" % (hh + 1)),
                ("0500HSTIV002", "%02d:30:00" % (hh + 1))]))
        cur = _db(self, _stops(GODMAN, BROADWAY, ST_IVES_B), trips)
        self.assertEqual(gd.journey_minutes(cur, {"0500HGODM001"}, "46", "St Ives"),
                         (35, 3))


class ATripThatCannotBeTimed(unittest.TestCase):
    """What the sample drops, and what the returned count then means."""

    def test_an_arrival_before_the_departure_is_dropped_from_the_sample(self):
        """Real feeds carry them. A negative duration in the median is worse
        than a smaller sample, and the returned n is what says the sample
        shrank."""
        trips = [
            _trip("T1", "R1", "Wisbech", [("0500HSTIV025", "09:00:00"),
                                          ("0500HWISB001", "09:20:00")]),
            _trip("T2", "R1", "Wisbech", [("0500HSTIV025", "10:00:00"),
                                          ("0500HWISB001", "10:20:00")]),
            _trip("T3", "R1", "Wisbech", [("0500HSTIV025", "11:00:00"),
                                          ("0500HWISB001", "11:20:00")]),
            _trip("T4", "R1", "Wisbech", [("0500HSTIV025", "12:00:00"),
                                          ("0500HWISB001", "11:00:00")]),
        ]
        cur = _db(self, _stops(ST_IVES, WISBECH), trips)
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Wisbech"),
                         (20, 3))

    def test_a_call_with_no_time_at_all_is_dropped(self):
        trips = [
            _trip("T1", "R1", "Wisbech", [("0500HSTIV025", "09:00:00"),
                                          ("0500HWISB001", "09:20:00")]),
            _trip("T2", "R1", "Wisbech", [("0500HSTIV025", "10:00:00"),
                                          ("0500HWISB001", "10:20:00")]),
            _trip("T3", "R1", "Wisbech", [("0500HSTIV025", "11:00:00"),
                                          ("0500HWISB001", "11:20:00")]),
            _trip("T4", "R1", "Wisbech", [("0500HSTIV025", ""),
                                          ("0500HWISB001", "12:20:00")]),
        ]
        cur = _db(self, _stops(ST_IVES, WISBECH), trips)
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Wisbech"),
                         (20, 3))


class WhichArm(unittest.TestCase):
    """A route that splits, and the fallback that must not blend it."""

    def _split_route(self):
        """Four trips to Wisbech (30 min) and three to Manea (12 min)."""
        trips = []
        for i, hh in enumerate((6, 7, 8, 9)):
            trips.append(_trip("W%d" % i, "R1", "Service 56", [
                ("0500HSTIV025", "%02d:00:00" % hh),
                ("0500HWISB001", "%02d:30:00" % hh)]))
        for i, hh in enumerate((13, 14, 15)):
            trips.append(_trip("M%d" % i, "R1", "Service 56", [
                ("0500HSTIV025", "%02d:00:00" % hh),
                ("0500HMANE001", "%02d:12:00" % hh)]))
        return trips

    def test_naming_the_arm_picks_only_that_arms_trips(self):
        cur = _db(self, _stops(ST_IVES, WISBECH, MANEA), self._split_route())
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Manea"),
                         (12, 3))

    def test_with_no_arm_named_and_no_fallback_there_is_no_answer(self):
        """The headsigns name the service rather than the destination, which is
        the ordinary case in this feed."""
        cur = _db(self, _stops(ST_IVES, WISBECH, MANEA), self._split_route())
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Ely"),
                         (None, 0))

    def test_the_fallback_takes_the_MAJORITY_terminus_and_not_every_trip(self):
        """n is what discriminates: blending both arms would sample seven trips.
        The caller sets this only when it knows the route has one spoke here."""
        cur = _db(self, _stops(ST_IVES, WISBECH, MANEA), self._split_route())
        self.assertEqual(
            gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Ely",
                               allow_majority_fallback=True),
            (30, 4))

    def test_the_fallback_rescues_a_terminus_named_after_a_POI(self):
        """"Drummer St Bus Station" carries no town, which is why matching on
        the name alone fails on a perfectly ordinary single-arm route."""
        trips = []
        for i, hh in enumerate((9, 10, 11)):
            trips.append(_trip("T%d" % i, "R1", "Service 905", [
                ("0500HSTIV025", "%02d:00:00" % hh),
                ("0590HCAMB001", "%02d:50:00" % hh)]))
        cur = _db(self, _stops(ST_IVES, DRUMMER), trips)
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Cambridge"),
                         (None, 0))
        self.assertEqual(
            gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Cambridge",
                               allow_majority_fallback=True),
            (50, 3))

    def test_the_fallback_needs_three_trips_of_its_own(self):
        """Two trips sharing a terminus are not a majority anybody should trust,
        and the answer stays None rather than becoming a two-trip guess."""
        trips = []
        for i, hh in enumerate((9, 10)):
            trips.append(_trip("T%d" % i, "R1", "Service 905", [
                ("0500HSTIV025", "%02d:00:00" % hh),
                ("0590HCAMB001", "%02d:50:00" % hh)]))
        cur = _db(self, _stops(ST_IVES, DRUMMER), trips)
        self.assertEqual(
            gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Cambridge",
                               allow_majority_fallback=True),
            (None, 0))

    def test_the_headsign_names_the_town_where_the_last_stop_does_not(self):
        """Both sides are checked, and this is the half that makes the fallback
        unnecessary on a well-signed route."""
        trips = []
        for i, hh in enumerate((9, 10, 11)):
            trips.append(_trip("T%d" % i, "R1", "Cambridge Drummer St", [
                ("0500HSTIV025", "%02d:00:00" % hh),
                ("0590HCAMB001", "%02d:50:00" % hh)]))
        cur = _db(self, _stops(ST_IVES, DRUMMER), trips)
        self.assertEqual(gd.journey_minutes(cur, {"0500HSTIV025"}, "46", "Cambridge"),
                         (50, 3))


if __name__ == "__main__":
    unittest.main()
