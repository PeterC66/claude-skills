"""resolve_place.py -- the place skill's P1, and its --stops and --at modes.

The module lives in `make-place-bus-leaflet/assets`, so it is loaded by path, as
`test_derive_stops.py` loads its neighbour. What is tested is the stop half
(buses-data OA-451 item 1): a customer who names bus stops rather than a feature
used to force a hand-written place.json. The fixture is the St Neots East pair that
was written by hand on 2026-09-23 -- the two Loves Way stops, 225 m apart -- so the
midpoint asserted here is the one that build worked out on paper.

Nominatim is replaced by a function that fails the test, because neither mode may
make a network call.
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import unittest

import _stubs

HERE = os.path.dirname(os.path.abspath(__file__))
PLACE_ASSETS = os.path.abspath(os.path.join(HERE, "..", "..", "..", "make-place-bus-leaflet", "assets"))


def load_resolve_place():
    path = os.path.join(PLACE_ASSETS, "resolve_place.py")
    spec = importlib.util.spec_from_file_location("place_resolve_place_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


rp = load_resolve_place()

LOVES_WAY = [
    {"ATCOCode": "0500HSTNS113", "NaptanCode": "CMBGJWJP", "CommonName": "Loves Way",
     "Indicator": "near", "Bearing": "E", "LocalityName": "Loves Farm",
     "lat": 52.2276277, "lon": -0.244992},
    {"ATCOCode": "0500HSTNS114", "NaptanCode": "CMBGJWJT", "CommonName": "Loves Way",
     "Indicator": "opp", "Bearing": "W", "LocalityName": "Loves Farm",
     "lat": 52.227381, "lon": -0.2417072},
    {"ATCOCode": "0500HSTNS999", "NaptanCode": "CMBGGONE", "CommonName": "Old Stop",
     "Indicator": "o/s", "Bearing": "N", "LocalityName": "Loves Farm", "Status": "inactive",
     "lat": 52.2280, "lon": -0.2430},
    {"ATCOCode": "0500HSTNS200", "NaptanCode": "CMBGFAR", "CommonName": "Far Stop",
     "Indicator": "opp", "Bearing": "S", "LocalityName": "Eaton Socon",
     "lat": 52.2150, "lon": -0.2900},
]


class ResolvePlaceByStops(unittest.TestCase):

    def setUp(self):
        self.root = _stubs.scratch("resolve-place-")
        gtfs = os.path.join(self.root, "_gtfs")
        os.makedirs(gtfs)
        _stubs.write_json(os.path.join(gtfs, "regions.json"), {"regions": {"Cambridgeshire": {}}})
        _stubs.naptan_db(os.path.join(gtfs, "naptan.sqlite"), LOVES_WAY)
        # A map folder two levels down, so the walk up to _gtfs/ is exercised.
        self.run_dir = os.path.join(self.root, "Places", "St Neots East", "S1")
        os.makedirs(self.run_dir)
        self._env = os.environ.get("BUSES_GTFS_DIR")
        os.environ["BUSES_GTFS_DIR"] = gtfs
        self._cwd = os.getcwd()
        os.chdir(self.run_dir)
        self._geocode = rp.geocode

        def no_network(*_a, **_k):
            raise AssertionError("resolve_place called Nominatim in a mode that must not")
        rp.geocode = no_network

    def tearDown(self):
        rp.geocode = self._geocode
        os.chdir(self._cwd)
        if self._env is None:
            os.environ.pop("BUSES_GTFS_DIR", None)
        else:
            os.environ["BUSES_GTFS_DIR"] = self._env
        shutil.rmtree(self.root, ignore_errors=True)

    def run_main(self, *args):
        argv = ["resolve_place.py", "St Neots East", "--town", "St Neots",
                "--region", "Cambridgeshire"] + list(args)
        out, err = io.StringIO(), io.StringIO()
        old = sys.argv
        sys.argv = argv
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rp.main()
            code = 0
        except SystemExit as e:
            code, err = 1, io.StringIO(str(e))
        finally:
            sys.argv = old
        return code, out.getvalue(), err.getvalue()

    def read(self, name):
        with open(os.path.join(self.run_dir, name), encoding="utf-8") as fh:
            return json.load(fh)

    def test_a_stop_pair_is_centred_on_its_midpoint(self):
        # One flag code and one ATCO code: both spellings a customer might send.
        code, out, err = self.run_main("--stops", "CMBGJWJP, 0500HSTNS114", "--radius-m", "900")
        self.assertEqual(code, 0, err)
        place = self.read("place.json")
        self.assertAlmostEqual(place["lat"], 52.2275, places=4)
        self.assertAlmostEqual(place["lon"], -0.24335, places=4)
        self.assertEqual((place["class"], place["type"]), ("highway", "bus_stop"))
        self.assertEqual(place["name"], "St Neots East")
        self.assertEqual(place["region"], "Cambridgeshire")
        self.assertEqual(place["walkshedM"], 900.0)
        self.assertIn("225 m apart", place["display"])
        cands = self.read("place-candidates.json")
        self.assertEqual([c["atco"] for c in cands["candidates"]], ["0500HSTNS113", "0500HSTNS114"])
        self.assertIn("--stops", cands["resolvedBy"])

    def test_an_unknown_stop_is_refused_and_nothing_is_written(self):
        code, _out, err = self.run_main("--stops", "CMBGJWJP,CMBGNOPE")
        self.assertEqual(code, 1)
        self.assertIn("CMBGNOPE: not in NaPTAN", err)
        self.assertFalse(os.path.exists(os.path.join(self.run_dir, "place.json")))

    def test_an_inactive_stop_is_refused(self):
        code, _out, err = self.run_main("--stops", "CMBGJWJP,CMBGGONE")
        self.assertEqual(code, 1)
        self.assertIn("CMBGGONE", err)
        self.assertIn("not active", err)

    def test_a_stop_outside_the_walkshed_is_refused(self):
        code, _out, err = self.run_main("--stops", "CMBGJWJP,CMBGFAR", "--radius-m", "500")
        self.assertEqual(code, 1)
        self.assertIn("outside the 500 m walkshed", err)
        self.assertIn("0500HSTNS200", err)
        self.assertFalse(os.path.exists(os.path.join(self.run_dir, "place.json")))

    def test_the_region_is_still_checked(self):
        code, _out, err = self.run_main("--stops", "CMBGJWJP", "--region", "Narnia")
        self.assertEqual(code, 1)
        self.assertIn("not registered", err)

    def test_at_centres_on_the_coordinate(self):
        code, _out, err = self.run_main("--at", "52.2275,-0.24335")
        self.assertEqual(code, 0, err)
        place = self.read("place.json")
        self.assertEqual((place["lat"], place["lon"]), (52.2275, -0.24335))

    def test_at_the_wrong_way_round_is_refused(self):
        # `=` because argparse reads a separate "-0.2..." as a flag.
        code, _out, err = self.run_main("--at=-0.24335,52.2275")
        self.assertEqual(code, 1)
        self.assertIn("not in Great Britain", err)


if __name__ == "__main__":
    unittest.main()
