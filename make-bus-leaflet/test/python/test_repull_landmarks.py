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

    def fetch(self, answer, host=None, base="2026-09-29T18:31:28Z"):
        """A stub Overpass. `answer` may be a list, one reply per call, each a
        (reply, host, base) tuple; a lone reply answers from the main host."""
        replies = list(answer) if isinstance(answer, list) else [(answer, host or rl.overpass_fetch.HOSTS[0], base)]

        def f(q, not_before=None, source=None):
            self.asked.append(q)
            self.floors.append(not_before)
            reply, h, b = replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            if source is not None:
                source.update(host=h, osmBase=b)
            return reply
        return f

    def main_base(self, base):
        def m():
            self.main_asked += 1
            if isinstance(base, Exception):
                raise base
            return base
        return m

    def go(self, extra=(), answer=NEW, main="2026-09-29T18:31:28Z", **kw):
        st = FakeStage(self.town)
        self.floors, self.main_asked = [], 0
        r = rl.run(["--town", TOWN, "--root", self.root, *extra], fetch=self.fetch(answer, **kw),
                   stage_fn=st, main_base=self.main_base(main))
        return r, st

    # -- OA-528: an answer must be current, not only complete ---------------------

    MIRROR = "https://overpass.kumi.systems/api/interpreter"

    def test_a_stale_mirror_answer_is_asked_again_and_only_the_current_one_stored(self):
        # March, 2026-09-29: the mirror had 159 and no Budgens; the main host had 160.
        stale = {"elements": NEW["elements"][:-1]}
        r, st = self.go(["--apply", "--by", "sched-0303"],
                        answer=[(stale, self.MIRROR, "2026-09-20T00:00:00Z"),
                                (NEW, rl.overpass_fetch.HOSTS[0], "2026-09-29T18:31:28Z")])
        self.assertEqual(self.floors[1], "2026-09-29T18:31:28Z", "the second ask must refuse data older than the main host's")
        new_dir = os.path.join(self.town, "S2-geometry", r["run"])
        with open(os.path.join(new_dir, "osm.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh), NEW)
        with open(os.path.join(new_dir, "overpass-source.json"), encoding="utf-8") as fh:
            src = json.load(fh)
        self.assertEqual(src["host"], rl.overpass_fetch.HOSTS[0])
        self.assertEqual(src["staleAnswer"], {"host": self.MIRROR, "osmBase": "2026-09-20T00:00:00Z"})
        commit = st.calls[2]
        self.assertIn("overpass-source.json", commit[commit.index("--outputs") + 1].split(","))

    def test_a_stale_mirror_with_no_current_host_is_refused_and_nothing_is_written(self):
        with self.assertRaises(rl.Refused):
            self.go(["--apply"], answer=[({"elements": NEW["elements"][:-1]}, self.MIRROR, "2026-09-20T00:00:00Z"),
                                         (rl.overpass_fetch.OverpassUnreachable("no host that new"), None, None)])
        self.assertEqual(sorted(os.listdir(os.path.join(self.town, "S2-geometry"))), [PREV])

    def test_a_mirror_answer_is_refused_when_the_main_host_cannot_be_asked_its_date(self):
        with self.assertRaises(rl.Refused) as cm:
            self.go(["--apply"], host=self.MIRROR, main=rl.overpass_fetch.OverpassUnreachable("504"))
        self.assertIn("cannot be shown current", str(cm.exception))
        self.assertEqual(sorted(os.listdir(os.path.join(self.town, "S2-geometry"))), [PREV])

    def test_a_current_mirror_answer_is_kept_and_its_check_recorded(self):
        r, _ = self.go(host=self.MIRROR, base="2026-09-29T18:31:28Z")
        self.assertEqual(len(self.asked), 1)
        self.assertEqual(r["source"]["mainOsmBase"], "2026-09-29T18:31:28Z")

    def test_the_main_host_answer_needs_no_second_question(self):
        r, _ = self.go()
        self.assertEqual(self.main_asked, 0)
        self.assertEqual(r["source"]["host"], rl.overpass_fetch.HOSTS[0])

    def test_the_fetch_refuses_data_older_than_the_pull_it_replaces(self):
        write_json(os.path.join(self.prev, "osm.json"), dict(OLD, osm3s={"timestamp_osm_base": "2026-07-01T09:00:00Z"}))
        self.go()
        self.assertEqual(self.floors[0], "2026-07-01T09:00:00Z")

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
        self.assertEqual(outs, ["routes_atco.json", "osm.json", "osm2.json", "overpass-pois.txt", "overpass-source.json"])
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

    # -- OA-499 item 2: a place is the same question over its own box --------------

    def make_place(self, *where):
        """Move the fixture's S2 into a place folder at `where` under the root."""
        d = os.path.join(self.root, *where)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copytree(self.town, d, ignore=shutil.ignore_patterns("Places"))
        return d

    def go_place(self, name, extra=()):
        self.floors, self.main_asked = [], 0
        st = FakeStage(None)
        r = rl.run(["--place", name, "--root", self.root, *extra], fetch=self.fetch(NEW),
                   stage_fn=st, main_base=self.main_base("2026-09-29T18:31:28Z"))
        return r, st

    def test_a_nested_place_is_found_by_name_and_committed_in_its_own_folder(self):
        place = self.make_place("Areas", TOWN, "Places", "Test Co-op")
        r, st = self.go_place("Test Co-op", ["--apply", "--by", "sched-1842"])
        self.assertEqual((r["town"], r["kind"]), ("Test Co-op", "place"))
        self.assertTrue(os.path.isfile(os.path.join(place, "S2-geometry", r["run"], "overpass-pois.txt")))
        self.assertFalse(os.path.isdir(os.path.join(self.town, "S2-geometry", r["run"])),
                         "the town's own S2 must not move when its place is re-pulled")
        self.assertIn("(52.1,0.1,52.2,0.3)", self.asked[0])

    def test_a_place_asks_over_its_walkshed_joined_with_its_extent(self):
        # St Neots Co-op, 2026-09-30: 4 stored elements spanned about 300 m of a 650 m walkshed.
        place = self.make_place("Areas", TOWN, "Places", "Wide Co-op")
        write_json(os.path.join(place, "S2-geometry", PREV, "walkshed_cfg.json"),
                   {"center": [52.15, 0.20], "radiusM": 11132})
        r, _ = self.go_place("Wide Co-op")
        self.assertIn("walkshed", r["boxSource"])
        self.assertAlmostEqual(r["box"]["s"], 52.05, places=3)   # the walkshed reaches further south
        self.assertAlmostEqual(r["box"]["n"], 52.25, places=3)
        self.assertLessEqual(r["box"]["w"], 0.10)                # never inside the stored extent
        self.assertGreaterEqual(r["box"]["e"], 0.30)

    def test_a_town_never_reads_a_walkshed(self):
        write_json(os.path.join(self.prev, "walkshed_cfg.json"), {"center": [52.15, 0.20], "radiusM": 50000})
        r, _ = self.go()
        self.assertEqual(r["box"], {"s": 52.10, "w": 0.10, "n": 52.20, "e": 0.30})

    def test_a_standalone_place_in_a_bucket_is_found(self):
        place = self.make_place("Places", "_standalone", "Lone Co-op")
        r, _ = self.go_place("Lone Co-op", ["--apply"])
        self.assertTrue(os.path.isfile(os.path.join(place, "S2-geometry", r["run"], "osm.json")))

    def test_a_place_name_in_two_folders_is_refused_not_guessed(self):
        self.make_place("Areas", TOWN, "Places", "Twin")
        self.make_place("Places", "_standalone", "Twin")
        with self.assertRaises(rl.Refused) as cm:
            self.go_place("Twin")
        self.assertIn("more than one", str(cm.exception))
        self.assertEqual(self.asked, [])

    def test_an_unknown_place_is_refused(self):
        with self.assertRaises(rl.Refused):
            self.go_place("Nowhere Co-op")
        self.assertEqual(self.asked, [])

    def test_a_town_is_never_read_as_a_place(self):
        with self.assertRaises(rl.Refused):
            self.go_place(TOWN)

    def test_town_and_place_together_is_a_usage_error(self):
        with self.assertRaises(SystemExit):
            rl.run(["--town", TOWN, "--place", "X", "--root", self.root], fetch=self.fetch(NEW),
                   stage_fn=FakeStage(self.town))

    def test_no_manifest_is_refused(self):
        with self.assertRaises(rl.Refused):
            rl.run(["--town", "Nowhere", "--root", self.root], fetch=self.fetch(NEW), stage_fn=FakeStage(self.town))


if __name__ == "__main__":
    unittest.main()
