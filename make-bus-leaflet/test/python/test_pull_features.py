"""pull_features.py -- the place skill's P2 step that pulls a railway, a river, a
canal or a main road into features_geo.json (buses-data OA-453 item 1, OA-514).

The module lives in `make-place-bus-leaflet/assets`, so it is loaded by path from
there, as test_derive_stops.py loads its neighbour. Overpass is never asked: stub
`overpass_fetch`, `draft_town` and `bootstrap_town` modules are put in sys.modules
for the length of each call to `main`, so what is tested is the script's own
promises -- the clip keeps the line reaching the frame, a hand-kept key is never
replaced without --force, an unanswered question is never written down as an empty
answer, and a named feature is named by the town's routes.json before the
candidate list.
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


class Run(unittest.TestCase):
    """A temp P2 folder, and main() run against stubs of everything it imports."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.walk = os.path.join(self.dir, "walkshed_cfg.json")
        self.out = os.path.join(self.dir, "features_geo.json")
        with open(self.walk, "w", encoding="utf-8") as f:
            json.dump({"center": CENTER, "radiusM": 900}, f)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def run_main(self, overpass, *extra, candidates=(), reached=True):
        self.feats = []
        stub_town = types.SimpleNamespace(
            feature_query=lambda box, feat: self.feats.append(feat) or "Q " + feat["type"])
        self.asked = []

        def overpass_features(box):
            self.asked.append(box)
            return list(candidates), reached
        stub_boot = types.SimpleNamespace(overpass_features=overpass_features)
        err, out = io.StringIO(), io.StringIO()
        with mock.patch.dict(sys.modules, {"overpass_fetch": overpass, "draft_town": stub_town,
                                           "bootstrap_town": stub_boot}), \
                contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            code = pf.main([self.walk, "--out", self.out, *extra])
        return code, out.getvalue(), err.getvalue()


class Main(Run):
    def test_a_railway_is_written_under_its_key_with_a_features_entry(self):
        code, out, _ = self.run_main(fake_overpass({"elements": [way(THROUGH, "East Coast Main Line")]}))
        self.assertEqual(code, 0)
        with open(self.out, encoding="utf-8") as f:
            geo = json.load(f)
        self.assertEqual(list(geo), ["railway"])
        self.assertIn('"label": "East Coast Main Line"', out)

    def test_a_kept_way_reaches_the_railway_query(self):
        """OA-520: the one opt-in past the no-sidings rule is --keep-way."""
        code, _, _ = self.run_main(fake_overpass({"elements": [way(THROUGH, "East Coast Main Line")]}),
                                   "--keep-way", "4242", "--keep-way", "77")
        self.assertEqual(code, 0)
        rail = [f for f in self.feats if f["type"] == "railway"]
        self.assertEqual([f.get("keepWays") for f in rail], [[4242, 77]])

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


OUSE = {"key": "river", "type": "river", "label": "River Great Ouse", "n": 9}
HIDDEN = {"key": "river", "type": "river", "label": "River Hidden", "n": 2}
A1123 = {"key": "a1123", "type": "road", "label": "A1123", "n": 5}


class NamedFeatures(Run):
    """OA-514: a river, a canal or a main road, each named before it is pulled."""

    def geo(self):
        with open(self.out, encoding="utf-8") as f:
            return json.load(f)

    def test_the_commonest_river_candidate_is_pulled_and_the_others_are_named(self):
        ov = fake_overpass({"elements": [way(THROUGH)]})
        code, out, _ = self.run_main(ov, "--types", "river", candidates=[A1123, OUSE, HIDDEN])
        self.assertEqual(code, 0)
        self.assertEqual(list(self.geo()), ["river"])
        self.assertIn('"label": "River Great Ouse"', out)
        self.assertIn('"labelPos": "auto"', out)
        self.assertIn("'River Hidden'", out, "the candidates passed over are printed")
        self.assertEqual(ov.calls, ["Q river"])

    def test_an_unnamed_river_is_never_chosen_even_when_commonest(self):
        # Ely Co-op, 2026-09-29: unnamed fragments outnumbered the Great Ouse's ways.
        unnamed = {"key": "river", "type": "river", "label": "River", "n": 20}
        ov = fake_overpass({"elements": [way(THROUGH)]})
        code, out, _ = self.run_main(ov, "--types", "river", candidates=[unnamed, OUSE])
        self.assertEqual(code, 0)
        self.assertIn('"label": "River Great Ouse"', out)
        self.assertNotIn("'River'", out)

    def test_the_default_asks_railway_river_and_canal_but_never_a_road(self):
        ov = fake_overpass({"elements": [way(THROUGH)]})
        code, _, _ = self.run_main(ov, candidates=[A1123, OUSE])
        self.assertEqual(code, 0)
        self.assertEqual(sorted(self.geo()), ["railway", "river"])
        self.assertEqual(ov.calls, ["Q railway", "Q river"])
        self.assertEqual(len(self.asked), 1, "the candidate question is asked once")

    def test_the_towns_routes_json_names_the_river_and_the_candidates_are_not_asked(self):
        town = os.path.join(self.dir, "routes.json")
        with open(town, "w", encoding="utf-8") as f:
            json.dump({"features": [{"key": "ouse", "type": "river", "label": "Great Ouse", "labelItalic": True}]}, f)
        code, out, _ = self.run_main(fake_overpass({"elements": [way(THROUGH)]}),
                                     "--types", "river", "--town-routes", town, candidates=[HIDDEN])
        self.assertEqual(code, 0)
        self.assertEqual(list(self.geo()), ["ouse"], "the town's key, so place and town agree")
        self.assertIn('"label": "Great Ouse"', out)
        self.assertEqual(self.asked, [])

    def test_a_picked_road_takes_bootstrap_towns_key_rule(self):
        code, out, _ = self.run_main(fake_overpass({"elements": [way(THROUGH)]}),
                                     "--types", "road", "--pick", "road=A 14", candidates=[A1123])
        self.assertEqual(code, 0)
        self.assertEqual(list(self.geo()), ["a14"])
        self.assertIn('"label": "A 14"', out)

    def test_no_candidate_of_the_type_is_an_answer(self):
        code, out, _ = self.run_main(fake_overpass({"elements": [way(THROUGH)]}),
                                     "--types", "river,canal", candidates=[A1123])
        self.assertEqual(code, 0)
        self.assertFalse(os.path.exists(self.out))
        self.assertIn("no named river", out)
        self.assertIn("no named canal", out)

    def test_an_unanswered_candidate_question_writes_nothing_and_exits_2(self):
        code, _, err = self.run_main(fake_overpass({"elements": [way(THROUGH)]}), candidates=[OUSE], reached=False)
        self.assertEqual(code, 2)
        self.assertFalse(os.path.exists(self.out))
        self.assertIn("NOT written", err)

    def test_a_hand_kept_river_is_refused_before_anything_is_asked(self):
        with open(self.out, "w", encoding="utf-8") as f:
            json.dump({"river": [[[5, 6], [7, 8]]]}, f)
        ov = fake_overpass({"elements": [way(THROUGH)]})
        code, _, err = self.run_main(ov, "--types", "river", candidates=[OUSE])
        self.assertEqual(code, 2)
        self.assertEqual((ov.calls, self.asked), ([], []))
        self.assertIn("--force", err)

    def test_a_bad_pick_is_a_usage_error(self):
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stderr(io.StringIO()):
            pf.main([self.walk, "--pick", "railway=West Coast"])
        self.assertEqual(cm.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
