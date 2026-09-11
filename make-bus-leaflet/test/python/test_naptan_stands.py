"""naptan_stands.py -- the helpers that decide what a boarding sheet PRINTS.

Everything here is reachable only through a place build, so the byte gates cover
it exactly as far as the committed place maps happen to exercise it and no
further. The three properties below are the ones the module's own docstrings call
load-bearing, and each has a recorded cost behind it.
"""
import json
import math
import os
import shutil
import tempfile
import unittest

import _engine

ns = _engine.load("naptan_stands")


class Haversine(unittest.TestCase):
    """The distance every "N min walk" on a boarding sheet is derived from."""

    def test_a_stop_is_no_distance_from_itself(self):
        self.assertEqual(ns.haversine_m(52.3233, -0.0738, 52.3233, -0.0738), 0.0)

    def test_one_degree_of_latitude_is_about_111_km(self):
        d = ns.haversine_m(52.0, 0.0, 53.0, 0.0)
        self.assertAlmostEqual(d, 111195.0, delta=50.0)

    def test_it_is_symmetric(self):
        a = ns.haversine_m(52.3233, -0.0738, 52.3301, -0.0699)
        b = ns.haversine_m(52.3301, -0.0699, 52.3233, -0.0738)
        self.assertAlmostEqual(a, b, places=9)

    def test_a_short_east_west_gap_shrinks_with_latitude(self):
        """Longitude degrees narrow towards the pole -- the cos(lat) term is live."""
        here = ns.haversine_m(52.0, 0.0, 52.0, 0.01)
        equator = ns.haversine_m(0.0, 0.0, 0.0, 0.01)
        self.assertLess(here, equator * 0.65)
        self.assertAlmostEqual(here, equator * math.cos(math.radians(52.0)), delta=1.0)


class CompassWord(unittest.TestCase):
    """A compass word is the one NaPTAN Indicator a reader can act on."""

    def test_the_hyphenated_form_is_kept(self):
        self.assertEqual(ns.compass_word("S-bound"), "S-bound")

    def test_the_spaced_form_normalises_to_the_hyphenated_one(self):
        self.assertEqual(ns.compass_word("S bound"), "S-bound")

    def test_case_is_normalised_in_both_halves(self):
        self.assertEqual(ns.compass_word("n-BOUND"), "N-bound")
        self.assertEqual(ns.compass_word("sw bound"), "SW-bound")

    def test_a_positional_hint_is_not_a_compass_word(self):
        """"opp", "adj", "near", "outside" are relative to a landmark the reader
        cannot see named, which is the whole reason this function is a filter
        rather than a formatter."""
        for hint in ("opp", "adj", "near", "outside", "Stop A", "Bay 4"):
            self.assertIsNone(ns.compass_word(hint), hint)

    def test_an_absent_indicator_is_not_an_error(self):
        self.assertIsNone(ns.compass_word(None))
        self.assertIsNone(ns.compass_word(""))
        self.assertIsNone(ns.compass_word("   "))

    def test_it_must_be_the_WHOLE_indicator(self):
        """`fullmatch`, not `search` -- "Northbound side of X" is prose, not a flag."""
        self.assertIsNone(ns.compass_word("S-bound side"))
        self.assertIsNone(ns.compass_word("towards S-bound"))

    def test_THE_WRITTEN_OUT_FORM_IS_NOT_RECOGNISED_and_the_docstring_says_it_is(self):
        """Asserted as it BEHAVES, and the behaviour contradicts the docstring above it.

        `compass_word`'s own docstring says "S-bound", "S bound" and "Southbound"
        "cannot be mistaken for three different flags". The third one is not true:
        the pattern is an ABBREVIATION followed by "bound", so "Southbound" fails
        `fullmatch` and the stop prints with no qualifier at all.

        Measured against `_gtfs/naptan.sqlite` on 2026-09-11 rather than argued:
        127,658 stops carry 12,165 abbreviated compass indicators and **1,125
        written-out ones** -- Northbound 262, Southbound 259, Westbound 206,
        Eastbound 204, plus lower-case variants -- of which 40 are in Cambridgeshire
        (ATCO 0500) and 922 in the two Buckinghamshire blocks (0400, 0490). The pair
        that states the fault exactly is `0500SBARN007 New Road Eastbound` and
        `0500SBARN003 New Road Westbound`: same CommonName, opposite directions, and
        `tidy_name(disambiguate=True)` prints both as a bare "New Road" because
        neither indicator is recognised -- on a sheet whose entire subject is
        direction.

        This test is deliberately GREEN on today's behaviour. Widening the pattern
        moves ink on any place sheet carrying such a stop, so it is a build and a
        crop rather than an edit, and it is filed as its own action. The test is
        here so the day somebody widens it, this file says what it was.
        """
        for written in ("Northbound", "Southbound", "Eastbound", "Westbound", "southbound"):
            self.assertIsNone(ns.compass_word(written), written)


class TidyName(unittest.TestCase):
    """The compass word is appended only where it is doing work."""

    def test_a_unique_flag_prints_bare(self):
        self.assertEqual(ns.tidy_name("The Busway, Station Road", "E-bound"), "The Busway, Station Road")

    def test_it_is_appended_only_when_disambiguating(self):
        self.assertEqual(
            ns.tidy_name("The Busway, Station Road", "E-bound", disambiguate=True),
            "The Busway, Station Road (E-bound)")

    def test_disambiguating_with_nothing_to_say_adds_nothing(self):
        """A positional hint must not be promoted just because two flags collide."""
        self.assertEqual(ns.tidy_name("Bus Station", "opp", disambiguate=True), "Bus Station")

    def test_the_name_is_trimmed_either_way(self):
        self.assertEqual(ns.tidy_name("  Market Hill  ", None), "Market Hill")
        self.assertEqual(ns.tidy_name("  Market Hill  ", "N-bound", disambiguate=True), "Market Hill (N-bound)")

    def test_a_missing_name_does_not_become_None(self):
        """A stop with no CommonName prints as an empty string, never as "None".

        The disambiguating arm is asserted as it BEHAVES rather than as it ought
        to: it returns " (N-bound)", a qualifier with nothing to qualify. No stop
        in NaPTAN has an empty CommonName, so this is unreachable today and is
        recorded rather than fixed -- changing it would move ink for no reader.
        """
        self.assertEqual(ns.tidy_name(None, "N-bound"), "")
        self.assertEqual(ns.tidy_name(None, "N-bound", disambiguate=True), " (N-bound)")


class RoutesByStop(unittest.TestCase):
    """READS `directions`, NEVER `canonical` -- the correctness of the whole file.

    `routes_full_atco.json` carries a one-direction `canonical` chain (what the map
    draws) alongside the full `directions` list. Every other consumer wants
    `canonical`, so `canonical or directions` is the natural thing to write; here it
    is a bug, because a boarding plan is a statement ABOUT direction. At St Ives the
    canonical chain for routes A and B is the inbound one, so a version that
    preferred it reported four stops, missed the outbound Cambridge stop entirely,
    and still printed VERDICT: OK.
    """

    FULL = {
        "A": {
            "canonical": [{"name": "to St Ives", "stops": ["0500SIVE001", "0500SIVE004"]}],
            "directions": [
                {"name": "to St Ives", "stops": ["0500SIVE001", "0500SIVE004"]},
                {"name": "to Cambridge", "stops": ["0500SIVE009"]},
            ],
        },
    }

    def test_the_outbound_stop_is_not_lost(self):
        out = ns.routes_by_stop(self.FULL)
        self.assertIn("0500SIVE009", out, "the direction canonical does not carry went missing")
        self.assertEqual(out["0500SIVE009"], {"A": ["to Cambridge"]})

    def test_every_direction_that_calls_at_a_stop_is_named_there(self):
        full = {"A": {"directions": [
            {"name": "to St Ives", "stops": ["X1"]},
            {"name": "to Cambridge", "stops": ["X1"]},
        ]}}
        self.assertEqual(ns.routes_by_stop(full)["X1"], {"A": ["to St Ives", "to Cambridge"]})

    def test_a_direction_name_is_recorded_once(self):
        full = {"A": {"directions": [
            {"name": "to Cambridge", "stops": ["X1"]},
            {"name": "to Cambridge", "stops": ["X1"]},
        ]}}
        self.assertEqual(ns.routes_by_stop(full)["X1"]["A"], ["to Cambridge"])

    def test_canonical_is_the_FALLBACK_and_only_that(self):
        """A route with no `directions` still has to appear -- silently dropping it
        would be the same blindness in the other direction."""
        full = {"B": {"canonical": [{"name": "to Huntingdon", "stops": ["Y1"]}]}}
        self.assertEqual(ns.routes_by_stop(full)["Y1"], {"B": ["to Huntingdon"]})

    def test_an_empty_directions_list_falls_back_too(self):
        full = {"B": {"directions": [], "canonical": [{"name": "to Huntingdon", "stops": ["Y1"]}]}}
        self.assertEqual(ns.routes_by_stop(full)["Y1"], {"B": ["to Huntingdon"]})

    def test_an_unnamed_direction_still_registers_the_stop(self):
        """The stop is the fact; the direction name is the annotation."""
        out = ns.routes_by_stop({"C": {"directions": [{"stops": ["Z1"]}]}})
        self.assertEqual(out["Z1"], {"C": []})

    def test_nothing_in_gives_nothing_out(self):
        self.assertEqual(ns.routes_by_stop(None), {})
        self.assertEqual(ns.routes_by_stop({}), {})


class FindNaptan(unittest.TestCase):
    """The walk up to `_gtfs/naptan.sqlite`, which every place build starts with."""

    def setUp(self):
        root = os.path.join(tempfile.gettempdir(), "busmaps-scratch")
        os.makedirs(root, exist_ok=True)
        self.tmp = tempfile.mkdtemp(prefix="naptan-stands-", dir=root)
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_it_is_found_from_a_folder_far_below(self):
        os.makedirs(os.path.join(self.tmp, "_gtfs"))
        with open(os.path.join(self.tmp, "_gtfs", "naptan.sqlite"), "w") as fh:
            fh.write("")
        deep = os.path.join(self.tmp, "Areas", "St Ives", "Places", "Bus Station", "S2-geometry")
        os.makedirs(deep)
        self.assertEqual(
            os.path.abspath(ns.find_naptan(deep)),
            os.path.abspath(os.path.join(self.tmp, "_gtfs", "naptan.sqlite")))

    def test_absent_is_None_rather_than_a_guess(self):
        deep = os.path.join(self.tmp, "Areas", "Nowhere")
        os.makedirs(deep)
        # The walk ends at the filesystem root, so this only says "not under the
        # scratch tree" if nothing above it has one either -- which is why the
        # assertion is on the value being falsy or outside the scratch tree.
        found = ns.find_naptan(deep)
        self.assertTrue(found is None or not os.path.abspath(found).startswith(os.path.abspath(self.tmp)))


class ReadJson(unittest.TestCase):

    def test_it_reads_utf8_by_name_from_a_folder(self):
        root = os.path.join(tempfile.gettempdir(), "busmaps-scratch")
        os.makedirs(root, exist_ok=True)
        tmp = tempfile.mkdtemp(prefix="naptan-stands-json-", dir=root)
        self.addCleanup(shutil.rmtree, tmp, True)
        with open(os.path.join(tmp, "place.json"), "w", encoding="utf-8") as fh:
            json.dump({"name": "St Ives Bus Station", "note": "café"}, fh)
        self.assertEqual(ns.read_json(tmp, "place.json")["note"], "café")


if __name__ == "__main__":
    unittest.main()
