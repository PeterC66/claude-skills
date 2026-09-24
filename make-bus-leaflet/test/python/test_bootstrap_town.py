"""bootstrap_town.py -- the module that derives a brand-new town's whole starting
position, and whose output is the thing every later reviewer reviews.

WHY IT HAD NO TEST, AND WHY THAT IS THE SAME BAD CASE `test_scaffold_town.py`
DESCRIBES. `scaffold_town.py` is the command a person runs; this is the module
that command shells out to, and it is where the derivation actually happens --
the ATCO prefix, the anchor stop, the palette, the draft external spokes, the
candidate linear features. It runs once per town, before S1's human gate, before
the palette decision at S3, before any byte gate exists to compare against. No
gate downstream can see a fault here, because there is nothing yet to compare
the output to: an error arrives looking like the starting position rather than
like a mistake. It has had `test_module_load.py` since 2026-09-11, which asks
whether it imports, and nothing else.

WHAT IS TESTED HERE AND WHAT IS NOT. The derivation helpers take arguments and
return values, so every one of them is driven directly: `_km`, `_bearing`,
`in_town_stops`, `dominant_prefixes`, `pick_anchor`, `route_far_stop`,
`overpass_features` and `osm_note`. `main()` is not driven. It geocodes over the
network, opens a real region sqlite, calls `gtfs_query.query` and writes two
files, and a test that stubbed all four would be asserting the arrangement of
the stubs rather than anything about the module -- which is the objection
`_stubs.py` records against reading a real dataset, one level up. The GTFS
fixtures below are built through `_stubs.gtfs_db`, so their schema is
`gtfs_build.TABLES` rather than a second copy of it.

THE FAULT THIS SUITE WAS WRITTEN AROUND IS THE SIBLING OF THE ONE
`test_scaffold_town.py` WAS. That module conflated an absence with a refusal in
its registration message; this one conflated THREE answers in its report. The
candidate-features section printed `- (none found / skipped)` whether OSM had
answered and the bounding box holds no river, whether `--no-osm` meant OSM was
never asked, or whether both Overpass endpoints had failed and the question
could not be put at all. The third is the one that costs something: an empty
`features[]` is a real finding about the town in the first case and says nothing
whatever in the third, and the reviewer cannot tell which they are holding. So
`overpass_features` now returns `(ranked, reached)` and `osm_note` turns a
three-valued state into three different sentences. Both halves are pinned below
and restored as mutations in `tools/prove-red-python.py`.

TWO THINGS ARE DELIBERATELY ASSERTED ABOUT THE DERIVATION AND ARE WORTH SAYING
OUT LOUD. `dominant_prefixes` picks the dominant ATCO *area* first and only then
the dominant 9-character block *within it*, so a town whose radius clips a
neighbouring county cannot have its prefix decided by the foreign block --
`test_area_wins_before_block` is built so that the old all-stops rule and the
current one give different answers, because an assertion both rules satisfy
would say nothing. And `pick_anchor`'s preference for a stop NAMED like a bus
station is gated on `n >= max(2, nmax*0.5)`; the case below drives a named stop
on both sides of that gate, since a preference that always wins is not a
preference.

ONE THING IS OBSERVED AND NOT ASSERTED. `in_town_stops` issues `SELECT ... FROM
stops` with no `ORDER BY`, so the list it returns is in whatever order sqlite
produced, and `dominant_prefixes` breaks a tie between two equally common ATCO
areas on `Counter.most_common`'s insertion order. A town split exactly evenly
across a county boundary would therefore get its prefix from row order. No test
here pins that, because pinning it would pin the wrong answer: the fixtures
below all pass an explicit list, which is what the function actually sees. It is
recorded in the row rather than papered over with an assertion.
"""
import json
import os
import sqlite3
import sys
import unittest

import _engine
import _stubs

bt = _engine.load("bootstrap_town")


def _stops_db(path, stops, routes=(), trips=(), stop_times=()):
    """A GTFS sqlite holding the four tables these helpers join."""
    return _stubs.gtfs_db(path, {
        "stops": list(stops),
        "routes": list(routes),
        "trips": list(trips),
        "stop_times": list(stop_times),
    })


def _cur(path):
    con = sqlite3.connect(path)
    return con, con.cursor()


class Geometry(unittest.TestCase):
    """`_km` and `_bearing` -- the two functions every later number rests on."""

    def test_km_is_zero_for_a_point_against_itself(self):
        self.assertEqual(bt._km(52.3233, -0.0738, 52.3233, -0.0738), 0.0)

    def test_km_measures_a_degree_of_latitude(self):
        # One degree of latitude is 111.19 km on a 6371 km sphere, which is the
        # radius the module uses. A wrong radius or a swapped argument moves this.
        self.assertAlmostEqual(bt._km(52.0, 0.0, 53.0, 0.0), 111.19, places=1)

    def test_km_is_symmetric(self):
        there = bt._km(52.3233, -0.0738, 52.3302, -0.1802)
        back = bt._km(52.3302, -0.1802, 52.3233, -0.0738)
        self.assertAlmostEqual(there, back, places=9)

    def test_bearing_due_north_and_due_south(self):
        self.assertAlmostEqual(bt._bearing(52.0, 0.0, 53.0, 0.0), 0.0, places=6)
        self.assertAlmostEqual(bt._bearing(53.0, 0.0, 52.0, 0.0), 180.0, places=6)

    def test_bearing_east_and_west_are_normalised_into_the_circle(self):
        east = bt._bearing(52.0, 0.0, 52.0, 1.0)
        west = bt._bearing(52.0, 0.0, 52.0, -1.0)
        # Great-circle initial bearings, so a due-east leg in the northern
        # hemisphere reads a little under 90 rather than exactly 90.
        self.assertAlmostEqual(east, 90.0, delta=0.5)
        self.assertAlmostEqual(west, 270.0, delta=0.5)
        for b in (east, west):
            self.assertTrue(0 <= b < 360, "bearing outside [0,360): %r" % b)


class InTownStops(unittest.TestCase):
    """The radius filter, and the two ways a stop disappears from it."""

    def setUp(self):
        self.dir = _stubs.scratch("bootstrap-stops-")
        self.path = _stops_db(os.path.join(self.dir, "g.sqlite"), [
            {"stop_id": "0500AAAAA01", "stop_name": "Bus Station",
             "stop_lat": "52.3233", "stop_lon": "-0.0738"},
            {"stop_id": "0500AAAAA02", "stop_name": "Far Village",
             "stop_lat": "52.5000", "stop_lon": "-0.0738"},
            {"stop_id": "0500AAAAA03", "stop_name": "No Coordinates",
             "stop_lat": "", "stop_lon": ""},
            {"stop_id": "0500AAAAA04", "stop_name": "Unparseable",
             "stop_lat": "n/a", "stop_lon": "n/a"},
        ])
        self.con, self.cur = _cur(self.path)

    def tearDown(self):
        self.con.close()

    def test_keeps_only_stops_inside_the_radius(self):
        got = bt.in_town_stops(self.cur, 52.3233, -0.0738, 1.6)
        self.assertEqual([s[0] for s in got], ["0500AAAAA01"])

    def test_widening_the_radius_reaches_the_far_stop(self):
        got = bt.in_town_stops(self.cur, 52.3233, -0.0738, 25.0)
        self.assertEqual(sorted(s[0] for s in got), ["0500AAAAA01", "0500AAAAA02"])

    def test_a_stop_with_unusable_coordinates_is_dropped_rather_than_fatal(self):
        # The empty pair is excluded by the SQL, the unparseable pair by the
        # ValueError arm. Both are SILENT: a feed whose coordinates were all
        # unusable would report "no stops within the radius", which blames the
        # radius. Asserted so that a later reader knows it is a decision.
        got = bt.in_town_stops(self.cur, 52.3233, -0.0738, 500.0)
        self.assertNotIn("0500AAAAA03", [s[0] for s in got])
        self.assertNotIn("0500AAAAA04", [s[0] for s in got])

    def test_returns_name_and_floats_not_strings(self):
        sid, name, lat, lon = bt.in_town_stops(self.cur, 52.3233, -0.0738, 1.6)[0]
        self.assertEqual(name, "Bus Station")
        self.assertIsInstance(lat, float)
        self.assertIsInstance(lon, float)


class DominantPrefixes(unittest.TestCase):
    """The ATCO prefix the whole town registration is keyed on."""

    @staticmethod
    def _stops(*ids):
        return [(i, "Stop", 52.0, 0.0) for i in ids]

    def test_area_wins_before_block(self):
        # Six stops in ATCO area 0500, split evenly across two 9-char blocks,
        # and four in area 0400 sharing one block. The dominant AREA is 0500;
        # the dominant BLOCK over all stops would be 0400CCCCC with four. The
        # old all-stops rule and the current one therefore disagree here, which
        # is the only reason this fixture is shaped the way it is.
        stops = self._stops("0500AAAAA1", "0500AAAAA2", "0500AAAAA3",
                            "0500BBBBB1", "0500BBBBB2", "0500BBBBB3",
                            "0400CCCCC1", "0400CCCCC2", "0400CCCCC3", "0400CCCCC4")
        keep, counts = bt.dominant_prefixes(stops)
        self.assertEqual(sorted(keep), ["0500AAAAA", "0500BBBBB"])
        self.assertNotIn("0400CCCCC", keep)
        self.assertNotIn("0400CCCCC", [p for p, _ in counts])

    def test_a_minority_block_inside_the_area_is_dropped_at_twelve_percent(self):
        stops = self._stops(*(["0500AAAAA%d" % i for i in range(10)] + ["0500BBBBB0"]))
        keep, _ = bt.dominant_prefixes(stops)
        self.assertEqual(keep, ["0500AAAAA"])  # 1/11 = 9.1%, under the 12% bar

    def test_a_block_over_the_bar_is_kept_alongside_the_dominant_one(self):
        stops = self._stops(*(["0500AAAAA%d" % i for i in range(7)]
                              + ["0500BBBBB%d" % i for i in range(2)]))
        keep, _ = bt.dominant_prefixes(stops)          # 2/9 = 22%, over the bar
        self.assertEqual(sorted(keep), ["0500AAAAA", "0500BBBBB"])

    def test_the_reported_counts_stop_at_eight(self):
        stops = self._stops(*["0500%05d1" % i for i in range(12)])
        _, counts = bt.dominant_prefixes(stops)
        self.assertEqual(len(counts), 8)

    def test_a_single_stop_still_yields_its_prefix(self):
        keep, counts = bt.dominant_prefixes(self._stops("0500AAAAA1"))
        self.assertEqual(keep, ["0500AAAAA"])
        self.assertEqual(counts, [("0500AAAAA", 1)])


class PickAnchor(unittest.TestCase):
    """The interchange the whole internal sheet is centred and oriented on."""

    def _db(self, stop_times):
        d = _stubs.scratch("bootstrap-anchor-")
        stops = [
            {"stop_id": "S1", "stop_name": "High Street", "stop_lat": "52.32", "stop_lon": "-0.07"},
            {"stop_id": "S2", "stop_name": "St Ives Bus Station", "stop_lat": "52.33", "stop_lon": "-0.08"},
            {"stop_id": "S3", "stop_name": "Market Square", "stop_lat": "52.34", "stop_lon": "-0.09"},
        ]
        routes = [{"route_id": "r%d" % i, "route_short_name": str(i)} for i in (1, 2, 3, 4)]
        trips = [{"trip_id": "t%d" % i, "route_id": "r%d" % i} for i in (1, 2, 3, 4)]
        path = _stops_db(os.path.join(d, "g.sqlite"), stops, routes, trips, stop_times)
        con, cur = _cur(path)
        self.addCleanup(con.close)
        return cur, [(s["stop_id"], s["stop_name"], float(s["stop_lat"]), float(s["stop_lon"]))
                     for s in stops]

    @staticmethod
    def _times(pairs):
        return [{"trip_id": t, "stop_id": s, "stop_sequence": str(n)}
                for n, (t, s) in enumerate(pairs, start=1)]

    def test_the_named_station_wins_when_it_clears_half_the_maximum(self):
        cur, stops = self._db(self._times(
            [("t1", "S1"), ("t2", "S1"), ("t3", "S1"), ("t4", "S1"),
             ("t1", "S2"), ("t2", "S2"),
             ("t3", "S3")]))
        got = bt.pick_anchor(cur, stops)
        self.assertEqual(got["atco"], "S2")          # 2 routes, against S1's 4
        self.assertEqual(got["routes"], 2)
        self.assertTrue(got["namedStation"])
        self.assertEqual(got["name"], "St Ives Bus Station")

    def test_the_named_station_loses_when_it_is_under_the_gate(self):
        # S2 now carries one route against S1's four, so max(2, 4*0.5) = 2
        # refuses it and the busiest stop is taken instead. A preference that
        # always won would make the gate unobservable.
        cur, stops = self._db(self._times(
            [("t1", "S1"), ("t2", "S1"), ("t3", "S1"), ("t4", "S1"),
             ("t1", "S2")]))
        got = bt.pick_anchor(cur, stops)
        self.assertEqual(got["atco"], "S1")
        self.assertEqual(got["routes"], 4)
        self.assertFalse(got["namedStation"])

    def test_the_two_route_floor_applies_when_every_stop_is_quiet(self):
        # nmax is 1, so half of it is 0.5 and only the floor of 2 stands between
        # a one-route "bus station" and the anchor of the whole sheet.
        cur, stops = self._db(self._times([("t1", "S1"), ("t2", "S2")]))
        got = bt.pick_anchor(cur, stops)
        self.assertFalse(got["namedStation"])
        self.assertEqual(got["routes"], 1)

    def test_it_carries_the_stop_position_through(self):
        cur, stops = self._db(self._times([("t1", "S2"), ("t2", "S2")]))
        got = bt.pick_anchor(cur, stops)
        self.assertEqual((got["lat"], got["lon"]), (52.33, -0.08))

    def test_no_stop_time_anywhere_is_None_rather_than_a_guess(self):
        cur, stops = self._db([])
        self.assertIsNone(bt.pick_anchor(cur, stops))


class RouteFarStop(unittest.TestCase):
    """The draft external spoke: the far end of a route that actually calls here."""

    def setUp(self):
        d = _stubs.scratch("bootstrap-far-")
        stops = [
            {"stop_id": "T1", "stop_name": "Town Centre", "stop_lat": "52.32", "stop_lon": "-0.07"},
            {"stop_id": "F1", "stop_name": "Far Place", "stop_lat": "52.60", "stop_lon": "-0.07"},
            {"stop_id": "N1", "stop_name": "Near Village", "stop_lat": "52.38", "stop_lon": "-0.07"},
            {"stop_id": "X1", "stop_name": "Somewhere Else", "stop_lat": "53.50", "stop_lon": "-0.07"},
        ]
        routes = [{"route_id": "rA", "route_short_name": "A"},
                  {"route_id": "rB", "route_short_name": "B"}]
        trips = [{"trip_id": "tA1", "route_id": "rA"},
                 {"trip_id": "tA2", "route_id": "rA"},
                 {"trip_id": "tB1", "route_id": "rB"}]
        times = [
            {"trip_id": "tA1", "stop_id": "T1", "stop_sequence": "1"},
            {"trip_id": "tA1", "stop_id": "N1", "stop_sequence": "2"},
            {"trip_id": "tA2", "stop_id": "T1", "stop_sequence": "1"},
            {"trip_id": "tA2", "stop_id": "F1", "stop_sequence": "2"},
            # Route B never calls in town, and its far stop is farther than A's.
            {"trip_id": "tB1", "stop_id": "X1", "stop_sequence": "1"},
        ]
        self.path = _stops_db(os.path.join(d, "g.sqlite"), stops, routes, trips, times)
        self.con, self.cur = _cur(self.path)
        self.addCleanup(self.con.close)

    def test_it_takes_the_farthest_stop_across_every_town_serving_trip(self):
        far = bt.route_far_stop(self.cur, ["rA"], ["T1"], 52.32, -0.07)
        self.assertEqual(far[1], "Far Place")
        self.assertAlmostEqual(far[0], bt._km(52.32, -0.07, 52.60, -0.07), places=6)
        self.assertEqual((far[2], far[3]), (52.60, -0.07))

    def test_a_route_that_never_calls_in_town_yields_nothing(self):
        self.assertIsNone(bt.route_far_stop(self.cur, ["rB"], ["T1"], 52.32, -0.07))

    def test_a_route_with_no_ids_at_all_yields_nothing(self):
        self.assertIsNone(bt.route_far_stop(self.cur, ["rZ"], ["T1"], 52.32, -0.07))


class _Resp(object):
    """What `urllib.request.urlopen` hands `json.load`."""

    def __init__(self, payload):
        self._b = json.dumps(payload).encode("utf-8")
        self._i = 0

    def read(self, n=-1):
        if n is None or n < 0:
            out, self._i = self._b[self._i:], len(self._b)
            return out
        out = self._b[self._i:self._i + n]
        self._i += len(out)
        return out


class OverpassFeatures(unittest.TestCase):
    """The candidate linear features, and the three answers the report can give."""

    BBOX = {"s": 52.30, "n": 52.35, "w": -0.12, "e": -0.02}

    def _urlopen(self, behaviour):
        """Replace urlopen for the duration of one test, restoring it after."""
        calls = []
        real = bt.urllib.request.urlopen

        def fake(req, timeout=None):
            calls.append(req.full_url)
            return behaviour(len(calls))

        bt.urllib.request.urlopen = fake
        self.addCleanup(lambda: setattr(bt.urllib.request, "urlopen", real))
        # OA-339: the shared helper backs off between tries; a test waits for nothing.
        real_sleep = bt.time.sleep
        bt.time.sleep = lambda _s: None
        self.addCleanup(lambda: setattr(bt.time, "sleep", real_sleep))
        return calls

    @staticmethod
    def _ways(*tagsets):
        return {"elements": [{"type": "way", "tags": t} for t in tagsets]}

    def test_it_classifies_and_counts_the_four_kinds(self):
        payload = self._ways(
            {"waterway": "river", "name": "River Great Ouse"},
            {"waterway": "river", "name": "River Great Ouse"},
            {"waterway": "canal", "name": "Old Canal"},
            {"railway": "rail"},
            {"highway": "primary", "ref": "A 14"},
            {"leisure": "park", "name": "Not A Feature"},
        )
        self._urlopen(lambda _n: _Resp(payload))
        feats, reached = bt.overpass_features(self.BBOX)
        self.assertTrue(reached)
        by_label = {f["label"]: f for f in feats}
        self.assertEqual(by_label["River Great Ouse"]["n"], 2)
        self.assertEqual(by_label["River Great Ouse"]["type"], "river")
        self.assertEqual(by_label["Old Canal"]["key"], "canal")
        self.assertEqual(by_label["Railway"]["type"], "railway")   # unnamed -> the type's word
        self.assertEqual(by_label["A 14"]["key"], "a14")           # key loses the space, label keeps it
        self.assertNotIn("Not A Feature", by_label)

    def test_the_commonest_way_count_ranks_first(self):
        payload = self._ways(
            {"railway": "rail", "name": "East Coast Main Line"},
            {"waterway": "river", "name": "River Great Ouse"},
            {"waterway": "river", "name": "River Great Ouse"},
            {"waterway": "river", "name": "River Great Ouse"},
        )
        self._urlopen(lambda _n: _Resp(payload))
        feats, _ = bt.overpass_features(self.BBOX)
        self.assertEqual(feats[0]["label"], "River Great Ouse")

    def test_it_reports_at_most_six_candidates(self):
        payload = self._ways(*[{"waterway": "river", "name": "River %d" % i} for i in range(9)])
        self._urlopen(lambda _n: _Resp(payload))
        feats, reached = bt.overpass_features(self.BBOX)
        self.assertTrue(reached)
        self.assertEqual(len(feats), 6)

    def test_the_second_host_is_tried_when_the_first_fails(self):
        def behaviour(n):
            if n == 1:
                raise IOError("overpass-api.de is down")
            return _Resp(self._ways({"waterway": "river", "name": "River Nene"}))

        calls = self._urlopen(behaviour)
        feats, reached = bt.overpass_features(self.BBOX)
        self.assertEqual(len(calls), 2)
        self.assertTrue(reached)
        self.assertEqual(feats[0]["label"], "River Nene")

    def test_every_try_failing_is_a_REFUSAL_and_says_so(self):
        # The fault this suite was written around. Before 2026-09-17 this
        # returned a bare [], which the caller could not tell from a town with
        # no river in it. Since OA-339 it is more than two tries before it
        # gives up, because two lost seven towns in eight on 2026-09-13.
        def behaviour(_n):
            raise IOError("no route to host")

        calls = self._urlopen(behaviour)
        feats, reached = bt.overpass_features(self.BBOX)
        self.assertEqual(feats, [])
        self.assertFalse(reached)
        self.assertGreater(len(calls), 2)

    def test_an_empty_answer_is_an_ABSENCE_and_is_distinguishable_from_it(self):
        self._urlopen(lambda _n: _Resp({"elements": []}))
        feats, reached = bt.overpass_features(self.BBOX)
        self.assertEqual(feats, [])
        self.assertTrue(reached)      # the whole point: same list, different answer


class OsmNote(unittest.TestCase):
    """Three states, three sentences, and no two of them alike."""

    def test_each_state_gets_its_own_sentence(self):
        notes = {s: bt.osm_note(s) for s in ("skipped", "refused", "read")}
        self.assertEqual(len(set(notes.values())), 3)

    def test_the_refusal_says_it_could_not_look(self):
        note = bt.osm_note("refused")
        self.assertIn("COULD NOT LOOK", note)
        self.assertIn("refusal, not an absence", note)

    def test_the_absence_says_osm_answered(self):
        self.assertIn("OSM answered", bt.osm_note("read"))

    def test_skipped_names_the_flag_that_caused_it(self):
        self.assertIn("--no-osm", bt.osm_note("skipped"))

    def test_an_unknown_state_reads_as_the_absence_rather_than_the_refusal(self):
        # There is no fourth state; this pins which way the fall-through goes, so
        # that adding one cannot silently start claiming OSM was unreachable.
        self.assertEqual(bt.osm_note("anything else"), bt.osm_note("read"))


def _naptan_db(path, stops):
    """A NaPTAN sqlite holding the four columns boundary_areas reads, derived
    lat/lon as the real register carries them (never Latitude/Longitude)."""
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE naptan (ATCOCode TEXT, LocalityName TEXT, lat REAL, lon REAL)")
    con.executemany("INSERT INTO naptan VALUES (?,?,?,?)", stops)
    con.commit()
    con.close()
    return path


class Boundary(unittest.TestCase):
    """The boundary question (buses-data OA-416, Soham, 2026-09-24): which other
    council areas are within reach, and whether the report tells the reviewer to
    read them. Centre 52.0, 0.0; 0.01 deg of latitude is about 1.1 km."""

    def setUp(self):
        self.dir = _stubs.scratch("bootstrap-boundary-")

    def _db(self, stops):
        return _naptan_db(os.path.join(self.dir, "n.sqlite"), stops)

    def test_a_missing_register_is_a_refusal_and_says_so(self):
        state, rows = bt.boundary_areas(os.path.join(self.dir, "absent.sqlite"), 52.0, 0.0, 1.6)
        self.assertEqual((state, rows), ("no-register", []))
        text = "\n".join(bt.boundary_section(state, rows, 1.6, naptan_db="absent.sqlite"))
        self.assertIn("NOT CHECKED", text)
        self.assertNotIn("No other council", text)

    def test_one_council_only_says_there_is_nothing_more_to_ask(self):
        db = self._db([("0500AAA01", "Town", 52.0, 0.0), ("0500AAA02", "Village", 52.05, 0.0)])
        state, rows = bt.boundary_areas(db, 52.0, 0.0, 1.6)
        self.assertEqual([r["area"] for r in rows], ["050"])
        text = "\n".join(bt.boundary_section(state, rows, 1.6))
        self.assertIn("No other council area", text)
        self.assertNotIn("Before S1 is done", text)

    def test_a_neighbour_within_reach_is_named_with_its_nearest_places_first(self):
        db = self._db([
            ("0500AAA01", "Town", 52.0, 0.0),
            ("3900BBB01", "Far Suffolk", 52.08, 0.0),   # ~8.9 km
            ("3900BBB02", "Near Suffolk", 52.04, 0.0),  # ~4.4 km
            ("2900CCC01", "Beyond reach", 52.2, 0.0),   # ~22 km, outside 10 km
        ])
        state, rows = bt.boundary_areas(db, 52.0, 0.0, 1.6)
        self.assertEqual([r["area"] for r in rows], ["050", "390"])
        self.assertEqual(rows[1]["places"], ["Near Suffolk", "Far Suffolk"])
        self.assertEqual((rows[1]["inTown"], rows[1]["near"]), (0, 2))
        text = "\n".join(bt.boundary_section(state, rows, 1.6))
        self.assertIn("Area 390 (Near Suffolk, Far Suffolk)", text)
        self.assertIn("Before S1 is done", text)
        self.assertNotIn("290", text)

    def test_a_town_whose_own_stops_span_two_councils_is_flagged(self):
        db = self._db([
            ("0500AAA01", "Town", 52.0, 0.0), ("0500AAA02", "Town", 52.001, 0.0),
            ("3900BBB01", "Town edge", 52.005, 0.0),    # ~0.6 km: inside the town radius
        ])
        state, rows = bt.boundary_areas(db, 52.0, 0.0, 1.6)
        text = "\n".join(bt.boundary_section(state, rows, 1.6))
        self.assertIn("!! 1 of this town's OWN stops are coded in area 390", text)
        self.assertIn("not area 050", text)

    def test_the_feed_count_separates_an_area_the_dataset_holds_from_one_it_does_not(self):
        db = self._db([("0500AAA01", "Town", 52.0, 0.0), ("3900BBB01", "Suffolk", 52.04, 0.0),
                       ("2900CCC01", "Essex", 51.96, 0.0)])
        g = _stops_db(os.path.join(self.dir, "g.sqlite"), [
            {"stop_id": "0500AAA01", "stop_name": "Town", "stop_lat": "52.0", "stop_lon": "0.0"},
            {"stop_id": "3900BBB01", "stop_name": "Suffolk", "stop_lat": "52.04", "stop_lon": "0.0"}])
        con, cur = _cur(g)
        try:
            state, rows = bt.boundary_areas(db, 52.0, 0.0, 1.6, gtfs_cur=cur)
        finally:
            con.close()
        feed = {r["area"]: r["inFeed"] for r in rows}
        self.assertEqual((feed["390"], feed["290"]), (1, 0))
        text = "\n".join(bt.boundary_section(state, rows, 1.6))
        self.assertIn("1 of its stops are in this region's feed", text)
        self.assertIn("NONE of its stops are in this region's feed", text)


class Palette(unittest.TestCase):
    """The badge colours, and the one invariant that decides whether text is legible."""

    def test_every_light_colour_is_one_the_palette_can_actually_assign(self):
        # `LIGHT` exists only to flip a route's badge text to #111. A colour
        # misspelled there is not an error: it simply never matches, and that
        # route prints white text on a pale badge. Nothing else would notice.
        self.assertTrue(set(bt.LIGHT) <= set(bt.TOL_BRIGHT),
                        "LIGHT names a colour TOL_BRIGHT does not hold: %s"
                        % sorted(set(bt.LIGHT) - set(bt.TOL_BRIGHT)))

    def test_the_palette_has_no_duplicate_colours(self):
        # Routes are assigned `TOL_BRIGHT[i % len]`, so a duplicated entry gives
        # two routes the same colour before the palette has even wrapped.
        self.assertEqual(len(bt.TOL_BRIGHT), len(set(bt.TOL_BRIGHT)))


if __name__ == "__main__":
    unittest.main()
