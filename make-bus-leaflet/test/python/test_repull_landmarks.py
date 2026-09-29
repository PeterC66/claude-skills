"""repull_landmarks.py -- the box it asks over, what it keeps, and every refusal (buses-data OA-499).

The tool's one promise is that a fresh landmark pull changes the QUESTION'S ANSWER and
nothing else: the same box the town was pulled over, the geometry and osm2.json carried
unchanged, and nothing written on a dry run or a failed pull. Each case below builds a
throwaway town under `busmaps-scratch` and stubs Overpass and stage.js, so nothing here
reads the Buses folder or the network.
"""
import json
import os
import shutil
import tempfile
import unittest

import _engine

rl = _engine.load("repull_landmarks")

TOWN = "Testtown"
PREV = "2026-07-01_1200"


def scratch():
    root = os.path.join(tempfile.gettempdir(), "busmaps-scratch")
    os.makedirs(root, exist_ok=True)
    return tempfile.mkdtemp(prefix="repull-", dir=root)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh)


def stop(i, lat, lon):
    return {"type": "node", "id": i, "lat": lat, "lon": lon, "tags": {"highway": "bus_stop"}}


OLD = {"elements": [stop(1, 52.10, 0.10), stop(2, 52.20, 0.30),
                    {"type": "way", "id": 3, "center": {"lat": 52.15, "lon": 0.20}, "tags": {"amenity": "school"}}]}
NEW = {"elements": OLD["elements"] + [{"type": "node", "id": 9, "lat": 52.16, "lon": 0.21, "tags": {"amenity": "pub"}}]}


class FakeStage(object):
    def __init__(self, town_dir):
        self.town_dir = town_dir
        self.calls = []

    def __call__(self, town_dir, *args):
        self.calls.append(tuple(args))
        if args[0] == "new":
            d = os.path.join(town_dir, "S2-geometry", "2026-09-29_0300")
            os.makedirs(d)
            return d
        if args[0] == "pull":
            src = os.path.join(town_dir, "S2-geometry", PREV)
            for f in os.listdir(src):
                shutil.copy(os.path.join(src, f), args[2])
        return ""


class RepullLandmarks(unittest.TestCase):
    def setUp(self):
        self.root = scratch()
        self.town = os.path.join(self.root, "Areas", TOWN)
        self.prev = os.path.join(self.town, "S2-geometry", PREV)
        write_json(os.path.join(self.town, "manifest.json"), {"town": TOWN, "stages": {"S2": {
            "latest": PREV, "runs": [{"id": PREV, "outputs": ["routes_atco.json", "osm.json", "osm2.json"]}]}}})
        write_json(os.path.join(self.prev, "osm.json"), OLD)
        write_json(os.path.join(self.prev, "osm2.json"), {"elements": [{"id": 77}]})
        write_json(os.path.join(self.prev, "routes_atco.json"), {"1": ["a"]})
        self.asked = []

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def fetch(self, answer):
        def f(q):
            self.asked.append(q)
            if isinstance(answer, Exception):
                raise answer
            return answer
        return f

    def go(self, extra=(), answer=NEW):
        st = FakeStage(self.town)
        r = rl.run(["--town", TOWN, "--root", self.root, *extra], fetch=self.fetch(answer), stage_fn=st)
        return r, st

    def test_box_is_the_element_extent_when_no_query_was_recorded(self):
        r, _ = self.go()
        self.assertEqual(r["box"], {"s": 52.10, "w": 0.10, "n": 52.20, "e": 0.30})
        self.assertIn("extent", r["boxSource"])
        self.assertIn("(52.1,0.1,52.2,0.3)", self.asked[0])

    def test_a_recorded_query_box_wins(self):
        with open(os.path.join(self.prev, "overpass-pois.txt"), "w") as fh:
            fh.write('node["highway"="bus_stop"](52.000,0.050,52.300,0.400);')
        r, _ = self.go()
        self.assertEqual(r["box"], {"s": 52.0, "w": 0.05, "n": 52.3, "e": 0.4})
        self.assertIn("recorded query", r["boxSource"])

    def test_dry_run_writes_nothing_and_reports_the_moved_category(self):
        r, st = self.go()
        self.assertFalse(r["applied"])
        self.assertEqual(st.calls, [])
        self.assertEqual(r["moved"], {"amenity=pub": [0, 1]})
        self.assertEqual(sorted(os.listdir(os.path.join(self.town, "S2-geometry"))), [PREV])

    def test_apply_replaces_osm_json_only_and_commits_through_stage(self):
        r, st = self.go(["--apply", "--by", "sched-0303"])
        self.assertTrue(r["applied"])
        self.assertEqual([c[0] for c in st.calls], ["new", "pull", "commit"])
        self.assertEqual(st.calls[0], ("new", "S2", "--by", "sched-0303"))
        new_dir = os.path.join(self.town, "S2-geometry", r["run"])
        with open(os.path.join(new_dir, "osm.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh), NEW)
        with open(os.path.join(new_dir, "osm2.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh), {"elements": [{"id": 77}]}, "osm2.json must be carried, not emptied")
        self.assertTrue(os.path.isfile(os.path.join(new_dir, "overpass-pois.txt")))
        commit = st.calls[2]
        outs = commit[commit.index("--outputs") + 1].split(",")
        self.assertEqual(outs, ["routes_atco.json", "osm.json", "osm2.json", "overpass-pois.txt"])
        self.assertEqual(commit[commit.index("--based-on") + 1], "S2=" + PREV)
        self.assertEqual(commit[-2:], ("--by", "sched-0303"))

    def test_an_empty_answer_is_refused_and_nothing_is_written(self):
        with self.assertRaises(rl.Refused):
            self.go(["--apply"], answer={"elements": []})
        self.assertEqual(sorted(os.listdir(os.path.join(self.town, "S2-geometry"))), [PREV])

    def test_an_unreachable_overpass_is_refused(self):
        with self.assertRaises(rl.Refused):
            self.go(["--apply"], answer=rl.overpass_fetch.OverpassUnreachable("all hosts failed"))

    def test_no_committed_s2_is_refused(self):
        write_json(os.path.join(self.town, "manifest.json"), {"town": TOWN, "stages": {}})
        with self.assertRaises(rl.Refused):
            self.go()

    def test_a_place_path_is_refused_before_anything_is_read(self):
        with self.assertRaises(rl.Refused):
            rl.run(["--town", TOWN + "/Places/Somewhere", "--root", self.root],
                   fetch=self.fetch(NEW), stage_fn=FakeStage(self.town))
        self.assertEqual(self.asked, [])

    def test_no_manifest_is_refused(self):
        with self.assertRaises(rl.Refused):
            rl.run(["--town", "Nowhere", "--root", self.root], fetch=self.fetch(NEW), stage_fn=FakeStage(self.town))


if __name__ == "__main__":
    unittest.main()
