"""unserved_stops.py -- the place skill's P2 step that lists the active NaPTAN bus
stops in a walkshed that no GTFS feed serves (buses-data OA-456).

The module lives in `make-place-bus-leaflet/assets`, so it is loaded by path from
there, as test_pull_features.py loads its neighbour. Every register is a tiny
sqlite built in a temp folder, so what is tested is the script's own promises: a
stop in any feed's stop_times is served, a stop in a kept area with no stop_times
is unserved, a stop in an area no dataset keeps is NOT JUDGED rather than called
unserved, only active bus stops inside the radius are asked about, and with no
dataset to ask it refuses rather than writing a list in which every stop is unserved.
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sqlite3
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PLACE_ASSETS = os.path.abspath(os.path.join(HERE, "..", "..", "..", "make-place-bus-leaflet", "assets"))


def load_unserved_stops():
    path = os.path.join(PLACE_ASSETS, "unserved_stops.py")
    spec = importlib.util.spec_from_file_location("place_unserved_stops_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


us = load_unserved_stops()

CENTER = [52.2275, -0.24335]
# About 111 m per 0.001 degree of latitude.
NAPTAN_ROWS = [
    # atco,          name,            stoptype, status,     lat,             lon
    ("0500SERVED1", "Served Road",    "BCT", "active",   CENTER[0] + 0.001, CENTER[1]),
    ("0210SERVED2", "Other Feed",     "BCT", "active",   CENTER[0] - 0.001, CENTER[1]),
    ("0500LONELY1", "Lonely Lane",    "BCT", "active",   CENTER[0] + 0.002, CENTER[1]),
    ("0290FOREIGN", "Far Shire Stop", "BCT", "active",   CENTER[0] + 0.003, CENTER[1]),
    ("0500GONE001", "Closed Stop",    "BCT", "inactive", CENTER[0] + 0.001, CENTER[1] + 0.001),
    ("0500RAIL001", "Station Entr",   "RSE", "active",   CENTER[0],         CENTER[1] + 0.001),
    ("0500FARAWAY", "Beyond Radius",  "BCT", "active",   CENTER[0] + 0.02,  CENTER[1]),
]


def make_naptan(path):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE naptan (ATCOCode TEXT, CommonName TEXT, Indicator TEXT, LocalityName TEXT, "
                "StopType TEXT, Status TEXT, lat REAL, lon REAL)")
    for atco, name, st, status, lat, lon in NAPTAN_ROWS:
        con.execute("INSERT INTO naptan VALUES (?,?,?,?,?,?,?,?)", (atco, name, "nr", "Testville", st, status, lat, lon))
    con.commit()
    con.close()


def make_feed(path, stop_ids):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE stop_times (trip_id TEXT, stop_id TEXT, stop_sequence TEXT, "
                "arrival_time TEXT, departure_time TEXT)")
    for i, s in enumerate(stop_ids):
        con.execute("INSERT INTO stop_times VALUES (?,?,?,?,?)", ("t%d" % i, s, "1", "08:00:00", "08:00:00"))
    con.commit()
    con.close()


class UnservedStops(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="unserved_stops_")
        gtfs = os.path.join(self.root, "_gtfs")
        os.makedirs(gtfs)
        make_naptan(os.path.join(gtfs, "naptan.sqlite"))
        make_feed(os.path.join(gtfs, "cambs.sqlite"), ["0500SERVED1"])
        make_feed(os.path.join(gtfs, "beds.sqlite"), ["0210SERVED2"])
        self.regions = {
            "regions": {
                # The registry's db path is from another machine; the file beside it is what is found.
                "cambs": {"db": "Z:/nowhere/cambs.sqlite", "keepPrefixes": ["0500"], "status": "built"},
                "beds": {"db": os.path.join(gtfs, "beds.sqlite"), "keepPrefixes": ["0200", "0210"], "status": "built"},
                "_example": {"db": "x.sqlite", "keepPrefixes": ["0290"], "status": "built"},
                "stub": {"db": "stub.sqlite", "keepPrefixes": ["0290"], "status": "stub"},
            }
        }
        self.write_regions()
        self.run_dir = os.path.join(self.root, "Places", "Somewhere", "S2-geometry", "run")
        os.makedirs(self.run_dir)
        self.cfg = os.path.join(self.run_dir, "walkshed_cfg.json")
        with open(self.cfg, "w", encoding="utf-8") as f:
            json.dump({"center": CENTER, "radiusM": 500}, f)
        self.out = os.path.join(self.run_dir, "unserved_stops.json")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write_regions(self):
        with open(os.path.join(self.root, "_gtfs", "regions.json"), "w", encoding="utf-8") as f:
            json.dump(self.regions, f)

    def run_main(self, *extra):
        buf_out, buf_err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buf_out), contextlib.redirect_stderr(buf_err):
            code = us.main([self.cfg, "--out", self.out, *extra])
        return code, buf_out.getvalue(), buf_err.getvalue()

    def test_sorts_served_unserved_and_not_judged(self):
        code, out, _err = self.run_main()
        self.assertEqual(code, 0)
        with open(self.out, encoding="utf-8") as f:
            got = json.load(f)
        self.assertEqual(got["datasets"], ["beds", "cambs"])
        self.assertEqual(got["stops"], 4)          # inactive, rail and out-of-radius are not asked about
        self.assertEqual(got["served"], 2)         # one from each feed
        self.assertEqual([s["atco"] for s in got["unserved"]], ["0500LONELY1"])
        self.assertEqual([s["atco"] for s in got["notJudged"]], ["0290FOREIGN"])
        self.assertIn("UNSERVED  0500LONELY1", out)
        self.assertIn("Lonely Lane", out)

    def test_radius_override_widens_the_question(self):
        code, _out, _err = self.run_main("--radius-m", "3000")
        self.assertEqual(code, 0)
        with open(self.out, encoding="utf-8") as f:
            got = json.load(f)
        self.assertIn("0500FARAWAY", [s["atco"] for s in got["unserved"]])

    def test_no_dataset_on_disk_refuses_and_writes_nothing(self):
        self.regions["regions"] = {"stub": {"db": "stub.sqlite", "keepPrefixes": ["0500"], "status": "stub"}}
        self.write_regions()
        code, _out, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("no built dataset", err)
        self.assertFalse(os.path.exists(self.out))

    def test_no_naptan_refuses(self):
        os.remove(os.path.join(self.root, "_gtfs", "naptan.sqlite"))
        code, _out, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("no naptan.sqlite", err)
        self.assertFalse(os.path.exists(self.out))


if __name__ == "__main__":
    unittest.main()
