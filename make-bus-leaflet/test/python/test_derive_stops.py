"""derive_stops.py -- the place skill's P3 filler, and the stopLocalities it writes.

The module lives in `make-place-bus-leaflet/assets`, not in this engine, so it is
loaded by path from there rather than through `_engine.load`. What is tested is
the locality half (buses-data OA-311): the /maps search needs to know which
SETTLEMENT a stop is in, a stop's name cannot say -- "York Road (UB8)" is one of
60 York Roads -- and the ATCO code that can is only in hand here, at build time.

The fixture is built so that a name-only join would get it wrong: two stops both
called "Bus Station" in two different towns on one chain. The ATCO join must
tell them apart, and the by-name join for a hand-kept list must refuse to guess.
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PLACE_ASSETS = os.path.abspath(os.path.join(HERE, "..", "..", "..", "make-place-bus-leaflet", "assets"))


def load_derive_stops():
    path = os.path.join(PLACE_ASSETS, "derive_stops.py")
    spec = importlib.util.spec_from_file_location("place_derive_stops_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ds = load_derive_stops()

# One route, one direction, running north from the place through two towns.
# A1 is the place's own stop; B1 and C1 are both called "Bus Station".
CHAIN = {"7": {"directions": [{"name": "to Northtown",
                               "stops": ["A1", "B1", "B2", "C1"]}]}}
LL = {"A1": [52.00, 0.0], "B1": [52.05, 0.0], "B2": [52.08, 0.0], "C1": [52.10, 0.0]}
NAMES = {"A1": "Place Stop", "B1": "Bus Station", "B2": "Mill Lane", "C1": "Bus Station"}
LOCALITY = {"A1": "Placeton", "B1": "Midtown", "B2": "Midtown", "C1": "Northtown"}


class Harness(unittest.TestCase):

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="derive_stops_")
        self.p2 = os.path.join(self.root, "Areas", "Placeton", "S2-geometry", "run")
        os.makedirs(self.p2)
        for name, obj in (("routes_full_atco.json", CHAIN), ("atco2ll.json", LL),
                          ("atco2name.json", NAMES), ("place.json", {"lat": 52.0, "lon": 0.0})):
            with open(os.path.join(self.p2, name), "w", encoding="utf-8") as f:
                json.dump(obj, f)
        self.naptan = os.path.join(self.root, "_gtfs", "naptan.sqlite")
        os.makedirs(os.path.dirname(self.naptan))
        con = sqlite3.connect(self.naptan)
        con.execute("CREATE TABLE naptan (ATCOCode TEXT, LocalityName TEXT, ParentLocalityName TEXT)")
        con.executemany("INSERT INTO naptan VALUES (?,?,NULL)", sorted(LOCALITY.items()))
        con.commit()
        con.close()
        self.routes = os.path.join(self.root, "routes.json")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def run_main(self, destinations, *extra):
        with open(self.routes, "w", encoding="utf-8") as f:
            json.dump({"destinations": destinations}, f)
        argv, sys.argv = sys.argv, ["derive_stops.py", self.routes, "--dir", self.p2] + list(extra)
        err = io.StringIO()
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                ds.main()
        finally:
            sys.argv = argv
        with open(self.routes, encoding="utf-8") as f:
            return json.load(f)["destinations"], err.getvalue()


class FreshStops(Harness):

    def test_each_picked_stop_carries_the_locality_of_its_own_atco(self):
        dests, _ = self.run_main([{"name": "Northtown", "routes": ["7"], "bearing": 0, "distKm": 11}])
        # B1 is dropped as a same-named intermediate; the terminus is C1, the
        # "Bus Station" in Northtown -- not B1's Midtown, which a name join could pick.
        self.assertEqual(dests[0]["stops"], ["Mill Lane", "Bus Station"])
        self.assertEqual(dests[0]["stopLocalities"], ["Midtown", "Northtown"])

    def test_the_naptan_register_is_found_by_walking_up_from_dir(self):
        dests, err = self.run_main([{"name": "Northtown", "routes": ["7"], "bearing": 0, "distKm": 11}])
        self.assertIn("stopLocalities", dests[0])
        self.assertEqual(err, "")


class HandKeptStops(Harness):

    def test_a_name_that_is_one_locality_on_the_chain_is_resolved(self):
        dests, _ = self.run_main([{"name": "Northtown", "routes": ["7"], "stops": ["Mill Lane"]}])
        self.assertEqual(dests[0]["stopLocalities"], ["Midtown"])

    def test_a_name_in_two_localities_on_the_chain_is_null_not_a_guess(self):
        dests, _ = self.run_main([{"name": "Northtown", "routes": ["7"],
                                   "stops": ["Mill Lane", "Bus Station", "Nowhere Green"]}])
        self.assertEqual(dests[0]["stopLocalities"], ["Midtown", None, None])

    def test_an_existing_stop_localities_is_never_rewritten(self):
        dests, _ = self.run_main([{"name": "Northtown", "routes": ["7"], "stops": ["Mill Lane"],
                                   "stopLocalities": ["Kept By Hand"]}])
        self.assertEqual(dests[0]["stopLocalities"], ["Kept By Hand"])

    def test_a_destination_with_no_stops_gets_no_localities(self):
        dests, _ = self.run_main([{"name": "Everywhere", "routes": ["7", "8"]}])
        self.assertNotIn("stopLocalities", dests[0])


class NoRegister(Harness):

    def test_without_naptan_nothing_is_written_and_stderr_says_so(self):
        os.remove(self.naptan)
        dests, err = self.run_main([{"name": "Northtown", "routes": ["7"], "stops": ["Mill Lane"]}])
        self.assertNotIn("stopLocalities", dests[0])
        self.assertIn("NO stopLocalities", err)

    def test_a_named_register_that_does_not_exist_is_refused(self):
        with self.assertRaises(SystemExit):
            self.run_main([{"name": "Northtown", "routes": ["7"]}],
                          "--naptan", os.path.join(self.root, "missing.sqlite"))


if __name__ == "__main__":
    unittest.main()
