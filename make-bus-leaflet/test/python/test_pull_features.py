"""pull_features.py -- the place skill's P2 step that pulls a railway into
features_geo.json (buses-data OA-453 item 1).

The module lives in `make-place-bus-leaflet/assets`, so it is loaded by path from
there, as test_derive_stops.py loads its neighbour. Overpass is never asked: a stub
`overpass_fetch` is put in sys.modules for the length of each call to `main`, so
what is tested is the script's own three promises -- the clip keeps the line
reaching the frame, a hand-kept key is never replaced without --force, and an
unanswered question is never written down as an empty answer.
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
PLACE_ASSETS = os.path.abspath(os.path.join(HERE, "..", "..", "..", "make-place-bus-leaflet", "assets"))


def load_pull_features():
    path = os.path.join(PLACE_ASSETS, "pull_features.py")
    spec = importlib.util.spec_from_file_location("place_pull_features_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pf = load_pull_features()

CENTER = [52.2275, -0.24335]
BOX = pf.square(CENTER, 0.9)


def way(pts, name=None):
    el = {"type": "way", "geometry": [{"lat": a, "lon": b} for a, b in pts]}
    if name:
        el["tags"] = {"name": name}
    return el


# A line running south to north straight through the centre, starting and ending
# well outside the 0.9 km square, plus a stub wholly outside it.
THROUGH = [(52.20, -0.2433), (52.2150, -0.2433), (52.2275, -0.2433), (52.2400, -0.2433), (52.26, -0.2433)]
OUTSIDE = [(52.30, -0.30), (52.31, -0.30)]


class FakeUnreachable(RuntimeError):
    pass


def fake_overpass(reply=None, fail=False):
    mod = types.SimpleNamespace(OverpassUnreachable=FakeUnreachable, calls=[])

    def fetch(query, **kw):
        mod.calls.append(query)
        if fail:
            raise FakeUnreachable("no host answered")
        return reply
    mod.fetch = fetch
    return mod


class Clip(unittest.TestCase):
    def test_a_through_line_keeps_one_point_beyond_each_edge(self):
        segs = pf.segments({"elements": [way(THROUGH)]}, BOX)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0][0], [52.2150, -0.2433])      # the point just outside, south
        self.assertEqual(segs[0][-1], [52.2400, -0.2433])       # and the one just outside, north
        self.assertNotIn([52.20, -0.2433], segs[0])           # but nothing further out
        self.assertNotIn([52.26, -0.2433], segs[0])

    def test_a_way_wholly_outside_is_dropped(self):
        self.assertEqual(pf.segments({"elements": [way(OUTSIDE)]}, BOX), [])

    def test_the_label_is_the_commonest_name_or_railway(self):
        reply = {"elements": [way(THROUGH, "East Coast Main Line"), way(THROUGH, "East Coast Main Line"),
                              way(THROUGH, "Siding"), way(THROUGH)]}
        self.assertEqual(pf.label_of(reply), "East Coast Main Line")
        self.assertEqual(pf.label_of({"elements": [way(THROUGH)]}), "Railway")


class Main(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.walk = os.path.join(self.dir, "walkshed_cfg.json")
        self.out = os.path.join(self.dir, "features_geo.json")
        with open(self.walk, "w", encoding="utf-8") as f:
            json.dump({"center": CENTER, "radiusM": 900}, f)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def run_main(self, overpass, *extra):
        stub_town = types.SimpleNamespace(feature_query=lambda box, feat: "Q " + feat["type"])
        err, out = io.StringIO(), io.StringIO()
        with mock.patch.dict(sys.modules, {"overpass_fetch": overpass, "draft_town": stub_town}), \
                contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            code = pf.main([self.walk, "--out", self.out, *extra])
        return code, out.getvalue(), err.getvalue()

    def test_a_railway_is_written_under_its_key_with_a_features_entry(self):
        code, out, _ = self.run_main(fake_overpass({"elements": [way(THROUGH, "East Coast Main Line")]}))
        self.assertEqual(code, 0)
        with open(self.out, encoding="utf-8") as f:
            geo = json.load(f)
        self.assertEqual(list(geo), ["railway"])
        self.assertIn('"label": "East Coast Main Line"', out)

    def test_no_railway_is_an_answer_and_writes_nothing(self):
        code, out, _ = self.run_main(fake_overpass({"elements": [way(OUTSIDE)]}))
        self.assertEqual(code, 0)
        self.assertFalse(os.path.exists(self.out))
        self.assertIn("no railway", out)

    def test_an_unanswered_question_writes_nothing_and_exits_2(self):
        code, _, err = self.run_main(fake_overpass(fail=True))
        self.assertEqual(code, 2)
        self.assertFalse(os.path.exists(self.out))
        self.assertIn("NOT written", err)

    def test_a_hand_kept_key_is_refused_without_force_and_other_keys_survive(self):
        with open(self.out, "w", encoding="utf-8") as f:
            json.dump({"railway": [[[1, 2], [3, 4]]], "river": [[[5, 6], [7, 8]]]}, f)
        ov = fake_overpass({"elements": [way(THROUGH)]})
        code, _, err = self.run_main(ov)
        self.assertEqual(code, 2)
        self.assertEqual(ov.calls, [], "refused before asking Overpass")
        self.assertIn("--force", err)
        code, _, _ = self.run_main(ov, "--force")
        self.assertEqual(code, 0)
        with open(self.out, encoding="utf-8") as f:
            geo = json.load(f)
        self.assertEqual(geo["river"], [[[5, 6], [7, 8]]])
        self.assertNotEqual(geo["railway"], [[[1, 2], [3, 4]]])

    def test_a_walkshed_with_no_center_exits_3(self):
        with open(self.walk, "w", encoding="utf-8") as f:
            json.dump({"radiusM": 900}, f)
        code, _, _ = self.run_main(fake_overpass({"elements": []}))
        self.assertEqual(code, 3)


if __name__ == "__main__":
    unittest.main()
