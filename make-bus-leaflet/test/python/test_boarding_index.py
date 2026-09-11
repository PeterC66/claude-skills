"""boarding_index.py -- the helpers that decide WHICH DATA a boarding plan is built from.

`resolve_db` is the one that matters. Its own docstring states the rule as "never
guess a region -- fail listing what is built", and a guess here is not a wrong
pixel: it is a boarding sheet built from another county's timetable, which would
pass every byte gate this project owns because the bytes would be perfectly
reproducible.
"""
import io
import json
import os
import shutil
import tempfile
import unittest

import _engine

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


if __name__ == "__main__":
    unittest.main()
