"""boarding_index.py -- the helpers that decide WHICH DATA a boarding plan is built from.

`resolve_db` is the one that matters. Its own docstring states the rule as "never
guess a region -- fail listing what is built", and a guess here is not a wrong
pixel: it is a boarding sheet built from another county's timetable, which would
pass every byte gate this project owns because the bytes would be perfectly
reproducible.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

import _engine
import _stubs

bi = _engine.load("boarding_index")


def scratch(prefix):
    root = os.path.join(tempfile.gettempdir(), "busmaps-scratch")
    os.makedirs(root, exist_ok=True)
    return tempfile.mkdtemp(prefix=prefix, dir=root)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh)


class FindUp(unittest.TestCase):

    def setUp(self):
        self.tmp = scratch("boarding-index-findup-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_it_finds_a_file_several_levels_above(self):
        write_json(os.path.join(self.tmp, "_gtfs", "regions.json"), {"regions": {}})
        deep = os.path.join(self.tmp, "Areas", "St Ives", "Places", "Bus Station")
        os.makedirs(deep)
        self.assertEqual(
            os.path.abspath(bi.find_up(deep, "_gtfs", "regions.json")),
            os.path.abspath(os.path.join(self.tmp, "_gtfs", "regions.json")))

    def test_it_stops_at_the_nearest_one(self):
        """A place folder with its own `_gtfs` must win over the estate's."""
        write_json(os.path.join(self.tmp, "_gtfs", "regions.json"), {"regions": {}})
        near = os.path.join(self.tmp, "Areas", "St Ives")
        write_json(os.path.join(near, "_gtfs", "regions.json"), {"regions": {}})
        deep = os.path.join(near, "Places", "Bus Station")
        os.makedirs(deep)
        self.assertEqual(
            os.path.abspath(bi.find_up(deep, "_gtfs", "regions.json")),
            os.path.abspath(os.path.join(near, "_gtfs", "regions.json")))

    def test_it_returns_the_FOUND_PATH_and_not_the_folder_holding_it(self):
        """`resolve_db` feeds the result straight to `read_json`, so this is the
        contract rather than a detail -- the variable it lands in is called
        `gtfs_dir`, which reads like the opposite of what the function returns."""
        target = os.path.join(self.tmp, "_gtfs", "regions.json")
        write_json(target, {"regions": {}})
        self.assertTrue(os.path.isfile(bi.find_up(self.tmp, "_gtfs", "regions.json")))


class ResolveDb(unittest.TestCase):

    def setUp(self):
        self.tmp = scratch("boarding-index-resolvedb-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.place_dir = os.path.join(self.tmp, "Areas", "St Ives", "Places", "Bus Station")
        os.makedirs(self.place_dir)

    def estate(self, regions, towns):
        write_json(os.path.join(self.tmp, "_gtfs", "regions.json"), {"regions": regions})
        write_json(os.path.join(self.tmp, "_gtfs", "town_prefixes.json"), {"towns": towns})

    BUILT = {
        "cambridgeshire": {"status": "built", "db": "/feeds/cambridgeshire.sqlite"},
        "buckinghamshire": {"status": "built", "db": "/feeds/buckinghamshire.sqlite"},
    }

    def test_an_explicit_db_wins_outright(self):
        """--db is the escape hatch, and it must not be second-guessed by a lookup."""
        self.estate(self.BUILT, {"St Ives": {"region": "cambridgeshire"}})
        self.assertEqual(bi.resolve_db(self.place_dir, "/somewhere/else.sqlite", {"town": "St Ives"}),
                         "/somewhere/else.sqlite")

    def test_it_is_resolved_through_the_parent_town(self):
        self.estate(self.BUILT, {"St Ives": {"region": "cambridgeshire"}})
        self.assertEqual(bi.resolve_db(self.place_dir, None, {"town": "St Ives"}),
                         "/feeds/cambridgeshire.sqlite")

    def test_a_region_that_is_NOT_BUILT_is_not_offered(self):
        """The status field is the whole point of the `built` filter: a region we
        have registered and never built has no database to read."""
        self.estate({"cambridgeshire": {"status": "planned", "db": "/feeds/cambridgeshire.sqlite"}},
                    {"St Ives": {"region": "cambridgeshire"}})
        self.assertIsNone(bi.resolve_db(self.place_dir, None, {"town": "St Ives"}))

    def test_an_unregistered_town_gets_NOTHING_rather_than_the_only_built_region(self):
        """THE PROPERTY THIS FILE EXISTS FOR. One built region and an unknown town
        is exactly the shape where "just use the one we have" is tempting and
        wrong: it would silently build a Buckinghamshire sheet from a
        Cambridgeshire feed and every byte gate would still pass."""
        self.estate({"cambridgeshire": {"status": "built", "db": "/feeds/cambridgeshire.sqlite"}},
                    {"St Ives": {"region": "cambridgeshire"}})
        self.assertIsNone(bi.resolve_db(self.place_dir, None, {"town": "Beaconsfield"}))

    def test_no_place_and_no_town_resolves_to_nothing(self):
        self.estate(self.BUILT, {"St Ives": {"region": "cambridgeshire"}})
        self.assertIsNone(bi.resolve_db(self.place_dir, None, None))
        self.assertIsNone(bi.resolve_db(self.place_dir, None, {}))

    def test_no_regions_file_at_all_resolves_to_nothing(self):
        self.assertIsNone(bi.resolve_db(self.place_dir, None, {"town": "St Ives"}))

    def test_the_town_match_is_case_insensitive_and_partial_both_ways(self):
        """`town_prefixes.json` says "High Wycombe" where a place says "High
        Wycombe, Bucks" -- the containment test runs in both directions, and that
        is deliberate rather than sloppy."""
        self.estate(self.BUILT, {"High Wycombe": {"region": "buckinghamshire"}})
        deep = os.path.join(self.tmp, "Areas", "High Wycombe", "Places", "Aldi")
        os.makedirs(deep)
        self.assertEqual(bi.resolve_db(deep, None, {"town": "high wycombe, bucks"}),
                         "/feeds/buckinghamshire.sqlite")

    def test_a_town_registered_to_an_UNBUILT_region_falls_through_rather_than_borrowing(self):
        self.estate(self.BUILT, {"St Ives": {"region": "norfolk"}})
        self.assertIsNone(bi.resolve_db(self.place_dir, None, {"town": "St Ives"}))

    def test_a_malformed_town_entry_is_skipped_rather_than_crashing(self):
        self.estate(self.BUILT, {"Broken": "not an object", "St Ives": {"region": "cambridgeshire"}})
        self.assertEqual(bi.resolve_db(self.place_dir, None, {"town": "St Ives"}),
                         "/feeds/cambridgeshire.sqlite")

    def test_town_prefixes_without_a_towns_wrapper_is_read_too(self):
        """The file has been written both ways; the reader accepts both."""
        write_json(os.path.join(self.tmp, "_gtfs", "regions.json"), {"regions": self.BUILT})
        write_json(os.path.join(self.tmp, "_gtfs", "town_prefixes.json"),
                   {"St Ives": {"region": "cambridgeshire"}})
        self.assertEqual(bi.resolve_db(self.place_dir, None, {"town": "St Ives"}),
                         "/feeds/cambridgeshire.sqlite")


class FeedVersion(unittest.TestCase):
    """"records a fact when one is available and never invents one" -- its docstring."""

    def setUp(self):
        self.tmp = scratch("boarding-index-feedversion-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.db = os.path.join(self.tmp, "cambridgeshire.sqlite")

    def info(self, obj):
        write_json(os.path.join(self.tmp, "feed_info_cambridgeshire.json"), obj)

    def test_the_feed_version_is_read_from_the_sidecar(self):
        self.info({"feed_info": {"feed_version": "2026-09-01-itm-east-anglia"}})
        self.assertEqual(bi._feed_version(self.db), "2026-09-01-itm-east-anglia")

    def test_the_build_date_is_the_fallback(self):
        self.info({"built": "2026-09-01T10:03:00Z"})
        self.assertEqual(bi._feed_version(self.db), "2026-09-01T10:03:00Z")

    def test_an_absent_sidecar_is_None_and_not_an_exception(self):
        self.assertIsNone(bi._feed_version(self.db))

    def test_an_unreadable_sidecar_is_None(self):
        with io.open(os.path.join(self.tmp, "feed_info_cambridgeshire.json"), "w", encoding="utf-8") as fh:
            fh.write("{not json")
        self.assertIsNone(bi._feed_version(self.db))

    def test_a_sidecar_with_no_version_at_all_is_None(self):
        self.info({"feed_info": {}})
        self.assertIsNone(bi._feed_version(self.db))

    def test_the_sidecar_is_named_after_the_DATABASE_stem(self):
        """`feed_info_<stem>.json`, so a second region's file cannot answer for the first."""
        self.info({"feed_info": {"feed_version": "cambs"}})
        self.assertIsNone(bi._feed_version(os.path.join(self.tmp, "buckinghamshire.sqlite")))


class ScriptVersion(unittest.TestCase):

    def test_it_is_a_string_the_report_can_print(self):
        self.assertIsInstance(bi.SCRIPT_VERSION, str)
        self.assertRegex(bi.SCRIPT_VERSION, r"^\d+\.\d+$")


class LocalityRollup(unittest.TestCase):
    """THE NAME A DESTINATION IS PRINTED UNDER, which is what the sheet is for.

    Rule 2 of `boarding-plan-product_2026-08-22.md` is that the index is keyed by
    where a reader is GOING, so the one thing this file must get right is the
    word it puts there. NaPTAN's own `LocalityName` is frequently a hamlet or a
    quarter -- "Orchard Park", "Fenton End", "Kings Hedges" -- and none of those
    is a word a passenger would use, so the rollup climbs to the parent. Every
    guard below was added after a real sheet said something wrong, and until now
    none of them could be tested: the rollup is a closure inside `main()` over
    two sqlite connections, so the only way to exercise it was a full place build
    against the 127,658-stop register. OA-001 named it, with
    `naptan_stands.py`'s uniqueness rule, as what the Python half still could not
    reach.

    `--asof` IS PASSED EXPLICITLY AND THAT IS DELIBERATE. Every count in this
    file is made against a date, and taking that date from the clock would make
    the fixture's calendar window an input nobody declared -- a test that starts
    failing one morning because a year rolled over. Same rule as OA-289: a stored
    answer must not be re-derived against today.
    """

    ASOF = "2026-09-01"
    LAT, LON = 52.3233, -0.0738

    # (ATCO, LocalityName, ParentLocalityName, AdministrativeAreaCode)
    REGISTER = [
        ("BAY1", "St Ives", None, "071"),
        ("BAY2", "St Ives", None, "071"),
        ("STIVES2", "St Ives", None, "071"),
        # Two hops up: Orchard Park -> Kings Hedges -> Cambridge. One hop lands on
        # a Cambridge housing estate and prints it as though it were a town.
        ("ORCH", "Orchard Park", "Kings Hedges", "071"),
        ("KHED", "Kings Hedges", "Cambridge", "071"),
        # The same locality on a busway row that carries NO parent of its own --
        # and these are precisely the rows route A calls at, which is why the
        # per-ATCO rollup alone left a Cambridge suburb in the index.
        ("KBUS", "Kings Hedges", None, "071"),
        # "Church End" has five different parents in the real register, so no
        # single parent may be applied to the one that declares none.
        ("CHUR0", "Church End", None, "071"),
        ("CHUR1", "Church End", "Eltisley", "071"),
        ("CHUR2", "Church End", "Swavesey", "071"),
        # A namesake over a county line: Cambridgeshire's Barton declares no
        # parent, and the index printed Oxford as a destination of a St Neots
        # town bus until the fallback was scoped to the administrative area.
        ("BART", "Barton", None, "071"),
        ("BARTOX", "Barton", "Oxford", "090"),
        # A joint civil parish is a union of villages that keep their own names.
        ("NEED", "Needingworth", "Holywell-cum-Needingworth", "071"),
        # ...and a hamlet merely CONTAINED in a compound name is not one of its
        # halves, so it still rolls up. Most stops in that parish carry the
        # parish name directly, and un-rolling this one would print one village
        # under two names.
        ("FENT", "Fenton End", "Pidley cum Fenton", "071"),
        ("SOMER", "Somersham", None, "071"),
        ("WARB", "Warboys", None, "071"),
    ]

    TRIPS = [
        # (trip_id, route_short_name, [stop sequence])
        ("T1", "1", ["BAY1", "ORCH", "CHUR0", "NEED"]),
        ("T2", "2", ["BAY2", "KBUS", "BART", "FENT", "STIVES2"]),
        # DEPARTURES ONLY. Route 9's inbound journey TERMINATES in the frame, so
        # Somersham is somewhere this stand is reached FROM and not somewhere it
        # goes. An index built from "which routes call here" prints it anyway.
        ("T9in", "9", ["SOMER", "BAY1"]),
        # ...and the same route's outbound journey, which is the control: without
        # it, "Somersham is absent" would also be satisfied by a fixture where
        # route 9 never ran at all.
        ("T9out", "9", ["BAY1", "WARB"]),
    ]

    def build(self, routes_json=None, **kw):
        """Lay the fixture out and run `main --write`. Returns (rc, boarding_index.json)."""
        folder = _stubs.scratch("boarding-index-rollup-")
        self.addCleanup(shutil.rmtree, folder, True)
        nap_rows = []
        for i, (atco, loc, parent, area) in enumerate(self.REGISTER):
            nap_rows.append({"ATCOCode": atco, "CommonName": atco, "StopType": "BCT",
                             "LocalityName": loc, "ParentLocalityName": parent,
                             "AdministrativeAreaCode": area,
                             "lat": self.LAT + i * 0.01, "lon": self.LON})
        napath = _stubs.naptan_db(os.path.join(folder, "naptan.sqlite"), nap_rows)

        routes, trips, stop_times = {}, [], []
        for tid, rname, seq in self.TRIPS:
            routes[rname] = {"route_id": "R" + rname, "route_short_name": rname,
                             "route_type": "3"}
            trips.append({"trip_id": tid, "route_id": "R" + rname, "service_id": "S1"})
            for n, atco in enumerate(seq, 1):
                stop_times.append({"trip_id": tid, "stop_id": atco, "stop_sequence": str(n)})
        db = _stubs.gtfs_db(os.path.join(folder, "region.sqlite"), {
            "routes": list(routes.values()),
            "trips": trips,
            "stop_times": stop_times,
            "calendar": [_stubs.every_day("S1")],
        })

        _stubs.write_json(os.path.join(folder, "place.json"),
                          {"name": "A Frame With One Question In It", "town": "St Ives",
                           "lat": self.LAT, "lon": self.LON})
        _stubs.write_json(os.path.join(folder, "stands.json"), {
            "verdict": "OK",
            "stops": [
                {"atco": "BAY1", "label": "Bay 1", "class": "stand", "distM": 20, "walkMin": 1},
                {"atco": "BAY2", "label": "Bay 2", "class": "stand", "distM": 25, "walkMin": 1},
            ]})
        if routes_json is not None:
            _stubs.write_json(os.path.join(folder, "routes.json"), routes_json)

        argv = sys.argv
        sys.argv = ["boarding_index.py", "--dir", folder, "--db", db, "--naptan", napath,
                    "--write", "--asof", kw.get("asof", self.ASOF)]
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                rc = bi.main()
        finally:
            sys.argv = argv
        with io.open(os.path.join(folder, "boarding_index.json"), encoding="utf-8") as fh:
            return rc, json.load(fh)

    def setUp(self):
        self.rc, self.out = self.build()
        self.dests = [d["destination"] for d in self.out["destinations"]]

    def test_the_whole_index_is_the_six_places_this_frame_can_reach(self):
        """Asserted as a set rather than one membership at a time: the faults
        this rollup exists for all show as an EXTRA destination -- Kings Hedges,
        Orchard Park, Oxford, Holywell-cum-Needingworth -- and a test that only
        asked whether Cambridge was present would pass beside every one of them."""
        self.assertEqual(self.rc, 0)
        self.assertEqual(self.dests,
                         ["Barton", "Cambridge", "Church End", "Needingworth",
                          "Pidley cum Fenton", "Warboys"])

    def test_the_climb_does_not_stop_at_the_first_parent(self):
        """Orchard Park's parent is Kings Hedges, which is itself a child of
        Cambridge. One hop prints a housing estate as a destination."""
        self.assertIn("Cambridge", self.dests)
        self.assertNotIn("Kings Hedges", self.dests)
        self.assertNotIn("Orchard Park", self.dests)

    def test_a_locality_with_no_parent_of_its_own_borrows_one_from_the_register(self):
        """The register is not internally consistent: "Kings Hedges" carries its
        parent on the city rows and not on the busway rows. Both stops here reach
        Cambridge, so the destination is offered from both stands."""
        cambridge = [d for d in self.out["destinations"] if d["destination"] == "Cambridge"][0]
        self.assertEqual(sorted([cambridge["boardAt"]] + [o["label"] for o in cambridge["alsoFrom"]]),
                         ["Bay 1", "Bay 2"])

    def test_a_name_with_two_parents_in_the_register_keeps_its_own(self):
        """Five different villages are called Church End. A name-keyed table with
        no agreement test would merge villages 80 miles apart."""
        self.assertIn("Church End", self.dests)
        self.assertNotIn("Eltisley", self.dests)
        self.assertNotIn("Swavesey", self.dests)

    def test_a_namesake_in_ANOTHER_administrative_area_lends_nothing(self):
        """Barton declares no parent in 071 and its Oxfordshire namesake declares
        one. Unanimity is not enough on its own -- a name whose only parent
        anywhere is in another county reads as unanimous."""
        self.assertIn("Barton", self.dests)
        self.assertNotIn("Oxford", self.dests)

    def test_a_half_of_a_joint_parish_keeps_its_own_name(self):
        """Reported by Peter, 2026-08-23: route 301 serves Needingworth and the
        index printed "Holywell-cum-Needingworth", advertising a village the bus
        does not reach."""
        self.assertIn("Needingworth", self.dests)
        self.assertNotIn("Holywell-cum-Needingworth", self.dests)

    def test_a_hamlet_merely_CONTAINED_in_a_compound_name_still_rolls_up(self):
        """The joint-parish test is narrow on purpose: the child must be a whole
        component of the compound. "Fenton End" is not one of Pidley cum
        Fenton's halves, and must not be rescued by a looser test."""
        self.assertIn("Pidley cum Fenton", self.dests)
        self.assertNotIn("Fenton End", self.dests)

    def test_the_home_locality_is_not_a_destination(self):
        self.assertEqual(self.out["homeLocality"], "St Ives")
        self.assertNotIn("St Ives", self.dests)

    def test_a_journey_that_TERMINATES_here_is_not_a_way_of_getting_anywhere(self):
        """Route 9's inbound journey ends at Bay 1 and its outbound leaves from
        it. Somersham is behind the reader; Warboys is in front. The two are
        asserted together because the absence alone would also be satisfied by a
        fixture in which route 9 did not run."""
        self.assertNotIn("Somersham", self.dests)
        warboys = [d for d in self.out["destinations"] if d["destination"] == "Warboys"][0]
        self.assertEqual(warboys["boardAt"], "Bay 1")
        self.assertIn("9", warboys["routes"])

    def test_excludeRoutes_takes_a_service_off_the_sheet_and_nothing_else(self):
        """The seasonal-coach case (Peter, 2026-08-23): filtered at the index,
        because it is an editorial decision about a sheet rather than a fact
        about a stop. Dropping route 9 takes Warboys with it and leaves every
        other destination standing."""
        rc, out = self.build(routes_json={"boardingPlan": {"excludeRoutes": ["9"]}})
        self.assertEqual(rc, 0)
        dests = [d["destination"] for d in out["destinations"]]
        self.assertNotIn("Warboys", dests)
        self.assertEqual(dests, [d for d in self.dests if d != "Warboys"])

    def test_the_date_the_counts_are_about_is_written_into_the_file(self):
        """OA-189: `--asof` has governed every count since it was written, and
        the file did not say which date that was, so `boarding_verify.py` could
        not describe the same population."""
        self.assertEqual(self.out["asof"], self.ASOF)


if __name__ == "__main__":
    unittest.main()
