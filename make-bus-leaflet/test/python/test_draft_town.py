"""draft_town.py -- the module that builds a whole town's draft with nobody watching.

WHY THIS MODULE AND NOT ANOTHER. It is the last Python file in `assets/` with no
suite of its own, and it is the one whose output a human is invited to TRUST: the
Tier-2 draft exists so a new town can be taken to a v1.0 sheet with no subjective
input, and DRAFT-REVIEW.md then tells a reviewer what still needs a person. A
reviewer reads that document for the things it says are uncertain, which means
anything this module gets confidently wrong is the half nobody is looking at.

THE COST IS RECORDED AND IT WAS PAID IN PUBLIC. On 2026-08-28 a member of the
public -- the first genuine report this project ever had -- found Whittlesey on
Ramsey's published external sheet, on the X31, which does not go there. Nominatim
at zoom=14 answers `town=Whittlesey` for Pondersbridge, Turves, Coates and
Eastrea alike, so five settlements resolved to one name. The fix was to ask
NaPTAN first, and the class docstring records both directions of the ordering
mistakes made getting there. Nothing in this repository can see that fault: the
sheet reproduces byte-for-byte for ever, every gate is green over it, and the
only reader who can tell is somebody standing at the stop.

WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT. Every case here drives a real
`PlaceNamer` over a stub NaPTAN sqlite rather than a hand-written double, because
the NaPTAN-first rule IS the collaboration between the class and that table and a
double would assert it against itself -- `_stubs.naptan_db` builds its schema from
`naptan_build.py`'s own `COLUMNS` and `create_table`, so a fixture cannot declare
a column the real builder does not make. **No test here reaches the network**:
`_lookup` is the only function that would, and the two cases that exercise it
replace the module's own `urllib` handle for the duration. `NoStopGetsGeocodedTwice`
asserts the reverse-geocode is never called at all when NaPTAN knows the stop,
which is the property that keeps a draft build offline and deterministic.

`main()` is not driven. It chains eleven subprocesses -- gtfs_query.py,
derive_intown.js, pull_roads.js, match_routes.js, complexity_score.js,
gen_internal.js, gen_external_radial.js, gtfs_duration.py, render.js -- against a
real feed and the Overpass API, so a test of it would be a test of those, and
the deciding functions it calls between them are every one of them reachable from
here. `overpass` is driven only for what it does with an answer or a refusal
(OA-339), through a replaced `overpass_fetch.fetch`; the retrying itself is
`test_overpass_fetch.py`'s. `pois_query` and `feature_query` build a query string for a
remote service and are left with `test_module_load.py`, for the same reason
`test_gen_verification.py` leaves the created/modified stamps alone: an assertion
on them would be an assertion on somebody else's server.
"""
import io
import json
import shutil
import tempfile
import math
import os
import types
import unittest
import urllib.parse
import urllib.request

import _engine
import _stubs

dt = _engine.load("draft_town")


# The anchor every fixture below is measured from, and a longitude step that is
# roughly 2 km at this latitude -- chosen so the 1.0 km "never leaves town" floor
# sits well inside one step rather than on it.
ANCHOR = (52.4500, -0.1100)


def _at(east_steps):
    """A coordinate `east_steps` * ~2.05 km due east of the anchor."""
    return (ANCHOR[0], ANCHOR[1] + 0.03 * east_steps)


def _stop(atco, locality, parent=None, name=None):
    """One NaPTAN row, keyed by the real column names `_stubs` checks against."""
    row = {"ATCOCode": atco, "LocalityName": locality,
           "CommonName": name or locality}
    if parent:
        row["ParentLocalityName"] = parent
    return row


def _namer(testcase, stops):
    """A real PlaceNamer over a throwaway NaPTAN sqlite holding exactly `stops`.

    `delay=0` so the Nominatim rate limiter never sleeps; nothing here calls it
    in any case, and `NoStopGetsGeocodedTwice` is the assertion that says so.
    """
    path = os.path.join(_stubs.scratch("draft-town-"), "naptan.sqlite")
    _stubs.naptan_db(path, stops)
    return dt.PlaceNamer(naptan_db=path, delay=0)


def _chain(*directions):
    """A route chain in the shape `gtfs_full_chains` returns."""
    return {"canonical": [{"stops": list(d)} for d in directions]}


# --------------------------------------------------------------------------
# The settlement name a stop gets, and where it comes from
# --------------------------------------------------------------------------
class NaptanIsAskedFirst(unittest.TestCase):
    """The rule the 2026-08-28 public report bought."""

    def setUp(self):
        self.namer = _namer(self, [
            _stop("0500HRAMS001", "Ramsey"),
            _stop("0500HPOND001", "Pondersbridge"),
            _stop("0500HTURV001", "Turves"),
        ])
        self.calls = []
        self.namer._lookup = lambda lat, lon: (self.calls.append((lat, lon))
                                               or ("Whittlesey", True))

    def test_a_known_stop_takes_naptans_answer(self):
        self.assertEqual(self.namer.name("0500HPOND001", *_at(3)), ("Pondersbridge", True))
        self.assertEqual(self.namer.name("0500HTURV001", *_at(4)), ("Turves", True))

    def test_no_stop_naptan_knows_is_geocoded_at_all(self):
        # The five-settlements-one-name fault can only come back through a call
        # that should not have happened, so the absence is the assertion.
        for atco in ("0500HRAMS001", "0500HPOND001", "0500HTURV001"):
            self.namer.name(atco, *_at(1))
        self.assertEqual(self.calls, [])

    def test_a_stop_naptan_does_not_know_falls_back(self):
        nm, ok = self.namer.name("9100UNKNOWN1", *_at(2))
        self.assertEqual((nm, ok), ("Whittlesey", True))
        self.assertEqual(len(self.calls), 1)

    def test_the_fallback_is_cached_per_atco_locality_block(self):
        # One reverse-geocode per 9-character prefix names every stop in that
        # locality; the class docstring's whole cost argument rests on it.
        self.namer.name("9100UNKNOWNa", *_at(2))
        self.namer.name("9100UNKNOWNb", *_at(2))
        self.assertEqual(len(self.calls), 1)

    def test_an_unresolved_stop_keeps_its_own_identity_rather_than_none(self):
        self.namer._lookup = lambda lat, lon: (None, False)
        nm, ok = self.namer.name("9100NOWHERE1", *_at(2))
        self.assertFalse(ok)
        self.assertEqual(nm, "9100NOWHE")     # the 9-char key, so the draft still renders

    def test_tidy_unpoints_the_british_form(self):
        self.assertEqual(dt.PlaceNamer.tidy("St. Ives"), "St Ives")
        self.assertEqual(dt.PlaceNamer.tidy("St. Neots "), "St Neots")
        self.assertEqual(dt.PlaceNamer.tidy("Ramsey"), "Ramsey")

    def test_a_label_carries_the_doubt_rather_than_hiding_it(self):
        self.namer._lookup = lambda lat, lon: ("Somewhere", False)
        self.assertEqual(self.namer.label("0500HRAMS001", *_at(0)), "Ramsey")
        self.assertEqual(self.namer.label("9100UNKNOWN1", *_at(2)), "Somewhere <check>")


class TheTownAndItsOutskirts(unittest.TestCase):
    """`in_town` and `of_town` are LOCALITY questions, never string ones.

    Both directions are recorded faults. Testing `stop_id.startswith(atcoPrefix)`
    made Ramsey Heights, Ramsey St Marys, Ramsey Mereside and Ramsey Forty Foot
    read as "in town" -- and because the X31 loops out through Bury, Wistow and
    Upwood and comes BACK through the Ramsey ATCO block before leaving for good,
    "everything after the last in-town stop" then threw those three villages
    away. Ramsey End is the check on the other side: it reads like Ramsey and its
    NaPTAN parent is Warboys, so a name-prefix rule would have wrongly swallowed
    it.
    """

    def setUp(self):
        self.namer = _namer(self, [
            _stop("0500HRAMS001", "Ramsey"),
            _stop("0500HRAMS900", "Ramsey Heights", parent="Ramsey"),
            _stop("0500HRAMS901", "Ramsey St Marys", parent="Ramsey"),
            _stop("0500HRAME001", "Ramsey End", parent="Warboys"),
            _stop("0500HBURY001", "Bury"),
        ])

    def test_the_town_proper_is_in_town(self):
        self.assertIs(self.namer.in_town("0500HRAMS001", "Ramsey"), True)

    def test_the_towns_own_outlying_parts_are_not_in_town(self):
        # They share the ATCO block; the prefix test called all four "Ramsey".
        self.assertIs(self.namer.in_town("0500HRAMS900", "Ramsey"), False)
        self.assertIs(self.namer.in_town("0500HRAMS901", "Ramsey"), False)

    def test_those_parts_are_of_town_and_so_not_destinations(self):
        self.assertTrue(self.namer.of_town("0500HRAMS900", "Ramsey"))
        self.assertTrue(self.namer.of_town("0500HRAMS901", "Ramsey"))

    def test_the_town_itself_is_not_one_of_its_own_outskirts(self):
        self.assertFalse(self.namer.of_town("0500HRAMS001", "Ramsey"))

    def test_ramsey_end_reads_like_ramsey_and_belongs_to_warboys(self):
        self.assertIs(self.namer.in_town("0500HRAME001", "Ramsey"), False)
        self.assertFalse(self.namer.of_town("0500HRAME001", "Ramsey"))

    def test_an_unknown_stop_answers_none_so_the_caller_keeps_the_old_test(self):
        # None is not False here: `spoke_for_route` reads it as "NaPTAN cannot
        # say" and falls back to the ATCO prefix, which is the only reason a
        # town with a gappy register still gets a draft at all.
        self.assertIsNone(self.namer.in_town("9100UNKNOWN1", "Ramsey"))


class WhatNominatimIsAllowedToAnswer(unittest.TestCase):
    """The two ordering mistakes the class docstring records, both directions.

    `_lookup` is the one function here that talks to a remote service, so the
    module's own `urllib` handle is replaced for the duration rather than the
    real one being patched -- a test that reached the network would be an
    assertion about what OpenStreetMap answered this morning.
    """

    def setUp(self):
        self.namer = _namer(self, [])
        self.payload = {}
        self.saved = dt.urllib
        fake = types.SimpleNamespace(
            parse=urllib.parse,
            request=types.SimpleNamespace(
                Request=urllib.request.Request,
                urlopen=lambda req, timeout=None: io.BytesIO(
                    json.dumps(self.payload).encode("utf-8"))))
        dt.urllib = fake

    def tearDown(self):
        dt.urllib = self.saved

    def _answer(self, address):
        self.payload = {"address": address}
        return self.namer._lookup(52.45, -0.11)

    def test_a_district_is_no_answer_rather_than_a_confident_one(self):
        # A rural stop between Ramsey and Warboys returns city="Huntingdonshire"
        # and nothing else usable. Refusing it costs the stop its name -- it
        # comes back as its own ATCO key, flagged "<check>" -- and that is the
        # trade: a reviewer chases a key, where a district printed as a
        # destination is a confident wrong answer nobody chases.
        self.assertEqual(self._answer({"city": "Huntingdonshire"}), (None, False))

    def test_every_admin_word_is_rejected(self):
        for admin in ("Huntingdonshire", "Peterborough District",
                      "Wycombe Borough", "Cambridgeshire County",
                      "Fenland District Council"):
            self.assertEqual(self._answer({"city": admin}), (None, False), admin)

    def test_a_district_in_an_earlier_slot_does_not_shut_out_a_real_place(self):
        # THE HARNESS CAUGHT THIS SUITE, and the survival is written in rather
        # than tidied out. The first version of the two cases above read
        # {"city": "Huntingdonshire", "village": "Bury"} and
        # {"city": <admin>, "town": "Ramsey"}, and the mutation that deletes the
        # ADMIN guard SURVIVED both: SETTLEMENT is ("town", "village", "city",
        # ...), so `village` and `town` are consulted BEFORE `city` and the
        # guard never fired. What it alone decides is the case where the admin
        # word sits in the EARLIER slot -- and the case where it is all there is.
        self.assertEqual(self._answer({"town": "Fenland District", "village": "Coates"}),
                         ("Coates", True))

    def test_a_suburb_never_outranks_its_own_town(self):
        # village/suburb first turned Peterborough's Queensgate into "Millfield"
        # and Huntingdon bus station into "Hartford".
        self.assertEqual(self._answer({"town": "Peterborough", "suburb": "Millfield"}),
                         ("Peterborough", True))
        self.assertEqual(self._answer({"city": "Huntingdon", "suburb": "Hartford"}),
                         ("Huntingdon", True))

    def test_a_suburb_is_still_better_than_nothing(self):
        self.assertEqual(self._answer({"suburb": "Millfield"}), ("Millfield", True))

    def test_a_wider_answer_comes_back_not_confident(self):
        # Too coarse to print as a destination, so it is labelled "<check>".
        self.assertEqual(self._answer({"county": "Cambridgeshire"}),
                         ("Cambridgeshire", False))

    def test_an_answer_naming_nothing_we_can_use_is_no_answer(self):
        self.assertEqual(self._answer({"road": "Grandford Drove"}), (None, False))

    def test_the_point_is_unpointed_on_the_way_through(self):
        self.assertEqual(self._answer({"town": "St. Ives"}), ("St Ives", True))

    def test_a_failed_call_is_no_answer_rather_than_an_exception(self):
        dt.urllib = types.SimpleNamespace(
            parse=urllib.parse,
            request=types.SimpleNamespace(
                Request=urllib.request.Request,
                urlopen=lambda req, timeout=None: (_ for _ in ()).throw(OSError("down"))))
        self.assertEqual(self.namer._lookup(52.45, -0.11), (None, False))


# --------------------------------------------------------------------------
# The external spoke: which places are printed, in what order, under what label
# --------------------------------------------------------------------------
class TheSpokeAndWhereItSaysItGoes(unittest.TestCase):

    def setUp(self):
        self.namer = _namer(self, [
            _stop("0500HRAMS001", "Ramsey"),
            _stop("0500HRAMS002", "Ramsey"),
            _stop("0500HRAMS900", "Ramsey Heights", parent="Ramsey"),
            _stop("0500HBURY001", "Bury"),
            _stop("0500HWIST001", "Wistow"),
            _stop("0500HUPWD001", "Upwood"),
            _stop("0500HWARB001", "Warboys"),
            _stop("0500HHUNT001", "Huntingdon"),
            _stop("0500HHUNT002", "Huntingdon"),
            _stop("0500HHART001", "Hartford", parent="Huntingdon"),
            _stop("0500HSAPL001", "Sapley", parent="Huntingdon"),
            _stop("0500HCHAT001", "Chatteris"),
            _stop("0500HSOME001", "Somersham"),
            _stop("0500HPIDL001", "Pidley"),
            _stop("0500HOLDH001", "Old Hurst"),
            _stop("0500HWOOD001", "Woodhurst"),
        ])
        self.ll = {
            "0500HRAMS001": _at(0), "0500HRAMS002": _at(0.05),
            "0500HRAMS900": _at(0.3),
            "0500HBURY001": _at(1), "0500HWIST001": _at(2),
            "0500HUPWD001": _at(3), "0500HWARB001": _at(4),
            "0500HHUNT001": _at(5), "0500HHUNT002": _at(7),
            "0500HHART001": _at(4.5), "0500HSAPL001": _at(4.8),
            "0500HCHAT001": (ANCHOR[0], ANCHOR[1] - 0.09),
            "0500HSOME001": _at(1.5), "0500HPIDL001": _at(2.5),
            "0500HOLDH001": _at(3.5), "0500HWOOD001": _at(4.2),
        }

    def _spoke(self, *directions):
        return dt.spoke_for_route(_chain(*directions), self.ll, "0500HRAMS",
                                  ANCHOR, self.namer, town="Ramsey")

    def test_the_farthest_direction_is_the_one_drawn(self):
        near = ["0500HRAMS001", "0500HBURY001"]
        far = ["0500HRAMS001", "0500HBURY001", "0500HWARB001"]
        self.assertEqual(self._spoke(near, far)["label"], "Warboys")
        self.assertEqual(self._spoke(far, near)["label"], "Warboys")

    def test_a_route_that_never_leaves_town_draws_no_spoke(self):
        self.assertIsNone(self._spoke(["0500HRAMS001", "0500HRAMS002"]))

    def test_a_direction_with_one_known_stop_is_not_a_direction(self):
        self.assertIsNone(self._spoke(["0500HRAMS001", "9100NOTINLL"]))

    def test_the_towns_own_outskirts_are_not_destinations(self):
        # Ramsey Heights carries ParentLocalityName=Ramsey, so it is an edge of
        # the town rather than somewhere the bus goes.
        sp = self._spoke(["0500HRAMS001", "0500HRAMS900", "0500HBURY001", "0500HWARB001"])
        self.assertEqual(sp["stops"], ["Bury", "Warboys"])

    def test_the_loop_out_through_the_villages_survives(self):
        # The X31 shape: the chain re-enters the Ramsey ATCO block at Ramsey
        # Heights AFTER Bury and Wistow. Under the ATCO-prefix test the last
        # "in town" stop was that one and both villages were thrown away.
        sp = self._spoke(["0500HRAMS001", "0500HBURY001", "0500HWIST001",
                          "0500HRAMS900", "0500HWARB001"])
        self.assertEqual(sp["stops"], ["Bury", "Wistow", "Warboys"])

    def test_the_terminus_is_where_the_chain_ends_not_the_last_new_name(self):
        # Recorded as Hartford -> Huntingdon -> Newtown -> Huntingdon: the
        # terminus is met early, so dedup-by-first-sighting labelled the spoke
        # with the place before it. Villages stand in for the suburbs here so
        # this case turns on the re-ordering alone.
        sp = self._spoke(["0500HRAMS001", "0500HBURY001", "0500HHUNT001",
                          "0500HWIST001", "0500HHUNT002"])
        self.assertEqual(sp["label"], "Huntingdon")
        self.assertEqual(sp["stops"], ["Bury", "Wistow", "Huntingdon"])

    def test_the_terminus_absorbs_its_own_suburbs(self):
        # Three suburbs before the town read as four separate destinations.
        sp = self._spoke(["0500HRAMS001", "0500HHART001", "0500HSAPL001", "0500HHUNT001"])
        self.assertEqual(sp["stops"], ["Huntingdon"])

    def test_a_suburb_of_somewhere_else_is_left_alone(self):
        sp = self._spoke(["0500HRAMS001", "0500HHART001", "0500HWARB001"])
        self.assertEqual(sp["stops"], ["Hartford", "Warboys"])

    def test_the_intermediates_are_thinned_to_the_drawn_maximum(self):
        # A GTFS chain passes through every hamlet on the road; Ramsey->St Ives
        # listed ten, which overflows the spoke and collides with its neighbour.
        sp = self._spoke(["0500HRAMS001", "0500HBURY001", "0500HSOME001",
                          "0500HWIST001", "0500HPIDL001", "0500HUPWD001",
                          "0500HOLDH001", "0500HWOOD001", "0500HWARB001"])
        self.assertEqual(len(sp["stops"]), dt.MAX_INTERMEDIATE + 1)
        self.assertEqual(sp["stops"][-1], "Warboys")

    def test_a_short_chain_is_not_thinned(self):
        sp = self._spoke(["0500HRAMS001", "0500HBURY001", "0500HWIST001", "0500HWARB001"])
        self.assertEqual(sp["stops"], ["Bury", "Wistow", "Warboys"])

    def test_a_through_service_reports_the_end_this_spoke_cannot_express(self):
        # Dropping it silently lost Chatteris off Ramsey's 303.
        sp = self._spoke(["0500HCHAT001", "0500HRAMS001", "0500HWARB001"])
        self.assertEqual(sp["label"], "Warboys")
        self.assertEqual(sp["otherEnd"], "Chatteris")

    def test_a_route_that_starts_in_town_reports_no_other_end(self):
        sp = self._spoke(["0500HRAMS001", "0500HBURY001", "0500HWARB001"])
        self.assertIsNone(sp["otherEnd"])

    def test_the_bearing_and_distance_describe_the_far_end(self):
        sp = self._spoke(["0500HRAMS001", "0500HWARB001"])
        self.assertIsInstance(sp["bearing"], int)
        self.assertTrue(80 <= sp["bearing"] <= 100, sp["bearing"])
        self.assertAlmostEqual(sp["far_km"], round(
            dt.km_between(ANCHOR[0], ANCHOR[1], *self.ll["0500HWARB001"]), 1))

    def test_an_unresolved_name_is_flagged_on_the_drawn_spoke(self):
        self.namer._lookup = lambda lat, lon: (None, False)
        self.ll["9100UNKNOWN1"] = _at(4)
        sp = self._spoke(["0500HRAMS001", "9100UNKNOWN1"])
        self.assertTrue(sp["label"].endswith(" <check>"), sp["label"])

    def test_with_no_town_the_atco_prefix_is_the_fallback_test(self):
        sp = dt.spoke_for_route(_chain(["0500HRAMS001", "0500HRAMS900", "0500HWARB001"]),
                                self.ll, "0500HRAMS", ANCHOR, self.namer, town=None)
        self.assertEqual(sp["stops"], ["Warboys"])


class TheTailsUnderInternalRoads(unittest.TestCase):
    """`termini_for_route` -- the place each drawn tail heads towards."""

    def setUp(self):
        self.namer = _namer(self, [
            _stop("0500HRAMS001", "Ramsey"),
            _stop("0500HWARB001", "Warboys"),
            _stop("0500HCHAT001", "Chatteris"),
            _stop("0500HHUNT001", "Huntingdon"),
            _stop("0500HHUNT002", "Huntingdon"),
        ])
        self.ll = {"0500HRAMS001": _at(0), "0500HWARB001": _at(4),
                   "0500HCHAT001": (ANCHOR[0], ANCHOR[1] - 0.09),
                   "0500HHUNT001": _at(5), "0500HHUNT002": _at(6)}

    def _termini(self, *stops):
        return dt.termini_for_route(_chain(list(stops)), self.ll, "0500HRAMS",
                                    self.namer, town="Ramsey")

    def test_both_out_of_town_ends_are_named(self):
        self.assertEqual(self._termini("0500HCHAT001", "0500HRAMS001", "0500HWARB001"),
                         {"start": "Chatteris", "end": "Warboys"})

    def test_a_tail_terminating_in_town_needs_no_key(self):
        self.assertEqual(self._termini("0500HRAMS001", "0500HWARB001"), {"end": "Warboys"})

    def test_two_ends_with_one_name_are_labelled_once(self):
        self.assertEqual(self._termini("0500HHUNT001", "0500HRAMS001", "0500HHUNT002"),
                         {"end": "Huntingdon"})

    def test_a_route_that_never_leaves_town_has_no_termini(self):
        self.assertIsNone(self._termini("0500HRAMS001"))

    def test_no_directions_at_all_is_none_rather_than_an_error(self):
        self.assertIsNone(dt.termini_for_route({}, self.ll, "0500HRAMS", self.namer, "Ramsey"))


# --------------------------------------------------------------------------
# What is merged, and what is only moved apart
# --------------------------------------------------------------------------
class OnlyTheVariantsThatReallyAreOneLine(unittest.TestCase):
    """`variant_families` proposes on the route NUMBER and decides on the MAP.

    Drawing 301/301S/301V/301X as four identically-routed coloured lines put four
    overprinted spokes and duplicated place labels on the first Ramsey draft, so
    they are grouped. But the operator's registration is a claim about paperwork,
    not about the road: at St Ives the feed declares 301S a pattern of 301 while
    the map draws 32 stops for 301S of which 3 are 301's. Accepting that and
    dropping 301S from the palette would have erased twenty-nine stops of real ink.
    So a proposal survives only if the town's own drawn stops and both spokes'
    destinations agree with it. Measured 2026-09-22; OA-436.
    """

    SPOKE = staticmethod(lambda label, stops=(): {"label": label, "stops": list(stops)})

    @staticmethod
    def PATHS(**routes):
        """{route: [cell index...]} -> routes_paths.json. One point per 0.001-degree
        cell, so a route's cell set is exactly the indices named."""
        return {"routes": {r: {"pts": [[52.0 + i * 0.001, 0.0] for i in idx]}
                           for r, idx in routes.items()}}

    # ---- what the route number is allowed to propose (no map given: all accepted)
    def test_declared_variants_group_under_their_lead(self):
        fam, rej = dt.variant_families([
            {"route": "301"},
            {"route": "301V", "possibleVariantOf": "301"},
            {"route": "301S", "possibleVariantOf": "301"},
        ])
        self.assertEqual(fam, {"301": ["301S", "301V"]})
        self.assertEqual(rej, [])

    def test_a_lead_the_town_does_not_run_groups_nothing(self):
        self.assertEqual(dt.variant_families([
            {"route": "9", "possibleVariantOf": "X9"}])[0], {})

    def test_a_route_is_not_a_variant_of_itself(self):
        self.assertEqual(dt.variant_families([
            {"route": "7", "possibleVariantOf": "7"}])[0], {})

    def test_no_declaration_merges_nothing(self):
        self.assertEqual(dt.variant_families([{"route": "46"}, {"route": "47"}])[0], {})

    def test_variants_group_even_though_the_feed_declares_nothing(self):
        """Chatteris carries ZIP2 and ZIP3 and no ZIP, so `possibleVariantOf` is
        empty and both drafted as separate routes. A human put them on one spoke."""
        self.assertEqual(dt.variant_families(
            [{"route": "ZIP2"}, {"route": "ZIP3"}, {"route": "302"}])[0],
            {"ZIP2": ["ZIP3"]})

    def test_variants_group_when_their_base_route_is_absent(self):
        self.assertEqual(dt.variant_families(
            [{"route": "301S"}, {"route": "301V"}, {"route": "301X"}])[0],
            {"301S": ["301V", "301X"]})

    # ---- and what it must NEVER propose, because the tail is the next number
    def test_two_numbers_in_a_range_are_not_a_family(self):
        """Ramsey's 303 and 305 share the stem "30", cover identical in-town stops
        AND both end at Huntingdon, so neither later test would catch them. They
        are distinct services: decollide_bearings spreads them, nothing merges
        them. The guard is that a digit after a digit is not a variant marker."""
        self.assertEqual(dt.variant_families([{"route": "303"}, {"route": "305"}])[0], {})
        self.assertEqual(dt.variant_families(
            [{"route": "400"}, {"route": "401"}])[0], {})

    def test_a_longer_number_is_not_a_variant_of_a_shorter_one(self):
        self.assertEqual(dt.variant_families([{"route": "9"}, {"route": "904"}])[0], {})

    # ---- the map decides
    def test_a_variant_whose_drawn_line_diverges_is_refused(self):
        """St Ives' 301S: 7% of its path is 301's and 36% of 301's is its."""
        fam, rej = dt.variant_families(
            [{"route": "301"}, {"route": "301S", "possibleVariantOf": "301"}],
            paths=self.PATHS(**{"301": range(0, 10), "301S": range(8, 30)}),
            dest={"301": self.SPOKE("Ramsey"), "301S": self.SPOKE("Ramsey")})
        self.assertEqual(fam, {})
        self.assertEqual(len(rej), 1)
        self.assertEqual(rej[0][1], "301S")
        self.assertIn("60%", rej[0][2])

    def test_a_variant_drawn_on_the_same_line_is_kept(self):
        fam, rej = dt.variant_families(
            [{"route": "301"}, {"route": "301V", "possibleVariantOf": "301"}],
            paths=self.PATHS(**{"301": range(0, 10), "301V": range(0, 10)}),
            dest={"301": self.SPOKE("Ramsey"), "301V": self.SPOKE("Ramsey")})
        self.assertEqual(fam, {"301": ["301V"]})
        self.assertEqual(rej, [])

    def test_the_overlap_must_hold_BOTH_ways(self):
        """Chatteris' ZIP3 is drawn entirely inside ZIP2 and ZIP2 runs on twice as
        far: 1.00 one way, 0.53 the other. complexity_score.js insists on mutual
        overlap so a short shuttle is not bundled into the trunk it shares a mile
        with -- and the live Chatteris sheet does draw ZIP2 and ZIP3 as two lines."""
        fam, rej = dt.variant_families(
            [{"route": "ZIP2"}, {"route": "ZIP3"}],
            paths=self.PATHS(ZIP2=range(0, 20), ZIP3=range(0, 10)),
            dest={"ZIP2": self.SPOKE("Ely"), "ZIP3": self.SPOKE("Ely")})
        self.assertEqual(fam, {})
        self.assertIn("BOTH ways", rej[0][2])

    def test_a_route_with_no_matched_path_is_left_alone_rather_than_bundled(self):
        fam, rej = dt.variant_families(
            [{"route": "301"}, {"route": "301V", "possibleVariantOf": "301"}],
            paths=self.PATHS(**{"301": range(0, 10)}),
            dest={"301": self.SPOKE("Ramsey"), "301V": self.SPOKE("Ramsey")})
        self.assertEqual(fam, {})
        self.assertIn("nothing", rej[0][2])

    def test_a_variant_heading_somewhere_else_is_refused(self):
        fam, rej = dt.variant_families(
            [{"route": "301"}, {"route": "301V", "possibleVariantOf": "301"}],
            paths=self.PATHS(**{"301": range(0, 10), "301V": range(0, 10)}),
            dest={"301": self.SPOKE("Ramsey", ["Warboys", "Ramsey"]),
                  "301V": self.SPOKE("March", ["Chatteris", "March"])})
        self.assertEqual(fam, {})
        self.assertIn("different service", rej[0][2])

    def test_a_short_working_of_the_lead_is_kept(self):
        """301X stops at Warboys and 301 calls at Warboys on its way to Ramsey, so
        301X is a short working of one line rather than a second one. Requiring the
        two labels to match outright refused this and left 301X its own colour."""
        fam, rej = dt.variant_families(
            [{"route": "301"}, {"route": "301X", "possibleVariantOf": "301"}],
            paths=self.PATHS(**{"301": range(0, 10), "301X": range(0, 10)}),
            dest={"301": self.SPOKE("Ramsey", ["Pidley", "Warboys", "Ramsey"]),
                  "301X": self.SPOKE("Warboys", ["Old Hurst", "Warboys"])})
        self.assertEqual(fam, {"301": ["301X"]})
        self.assertEqual(rej, [])

    def test_a_refusal_says_which_member_and_why(self):
        _, rej = dt.variant_families(
            [{"route": "301"}, {"route": "301S", "possibleVariantOf": "301"}],
            paths=self.PATHS(**{"301": range(0, 10), "301S": range(20, 30)}),
            dest={"301": self.SPOKE("Ramsey"), "301S": self.SPOKE("Ramsey")})
        lead, member, why = rej[0]
        self.assertEqual((lead, member), ("301", "301S"))
        self.assertTrue(why and len(why) > 20)


class TheS1RecordSaysWhatItWillNotDraw(unittest.TestCase):
    """`build_verified_services` moves an A5 drop into `notOnLeaflet[]` (OA-436).

    A route that is merely ABSENT from the S1 record is indistinguishable from one
    the feed never carried: the monthly refresh proposes it again every month and
    the reviewer has nothing to disagree with. `notOnLeaflet[]` is the estate's one
    spelling for "we know about this and deliberately do not draw it" -- the other
    three (verifiedNotDisplayed, notDisplayed, excluded) are read for ever and
    written never, which check-exclusion-fields.mjs enforces at commit time.
    """

    FEED = {"services": [{"route": "9", "operator": "Dews", "days": "Mon-Fri",
                          "termini": ["Bus Station"]},
                         {"route": "101", "operator": "Whippet", "days": "Sat & Sun",
                          "longName": "St Ives - Hunstanton", "termini": ["Travel Hub"]}]}
    DROP = [{"route": "101", "operator": "Whippet", "days": "Sat & Sun",
             "longName": "St Ives - Hunstanton",
             "reason": "its registration ran out on 20260913"}]

    def build(self, dropped):
        d = tempfile.mkdtemp()
        try:
            src = os.path.join(d, "gtfs-services.json")
            out = os.path.join(d, "verified-services.json")
            with open(src, "w", encoding="utf-8") as fh:
                json.dump(self.FEED, fh)
            kept = dt.build_verified_services(src, out, dropped)
            with open(out, encoding="utf-8") as fh:
                return kept, json.load(fh)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_a_dropped_route_leaves_services_and_lands_in_notOnLeaflet(self):
        kept, rec = self.build(self.DROP)
        self.assertEqual(kept, ["9"])
        self.assertEqual([s["route"] for s in rec["services"]], ["9"])
        self.assertEqual([s["route"] for s in rec["notOnLeaflet"]], ["101"])

    def test_the_entry_carries_the_reason_it_was_dropped(self):
        _, rec = self.build(self.DROP)
        self.assertIn("20260913", rec["notOnLeaflet"][0]["reason"])
        self.assertTrue(rec["notOnLeaflet"][0]["servesTown"])
        self.assertEqual(rec["notOnLeaflet"][0]["source"], "gtfs")

    def test_nothing_dropped_writes_no_notOnLeaflet_key_at_all(self):
        kept, rec = self.build([])
        self.assertEqual(kept, ["9", "101"])
        self.assertNotIn("notOnLeaflet", rec)

    def test_no_deprecated_spelling_is_ever_written(self):
        _, rec = self.build(self.DROP)
        for old in ("verifiedNotDisplayed", "notDisplayed", "excluded"):
            self.assertNotIn(old, rec)


class TheOverlapReportTheReviewQuotes(unittest.TestCase):
    """`weak_family_rows` reads corridors_report.json's ACTUAL shape (OA-436).

    DRAFT-REVIEW.md item 14 promises "the engine's corridors_report.json flags
    these as weakly-overlapping". The code behind that sentence looked for
    `corridors[].overlap` and `corridors[].fraction`. The file has always carried
    `families[].members[].sharedFraction` and `families[].weakMembers[]`, so the
    lookup found nothing and the review printed "raised no warnings" next to a
    report flagging all three members of St Ives' 301 family. The fixture below is
    that real file, trimmed.
    """

    REAL = {"town": "St Ives", "sharedMin": 0.6,
            "families": [{"lead": "301", "routes": ["301", "301V", "301X"],
                          "members": [{"route": "301", "sharedFraction": 0.328,
                                       "weakestAgainst": "301V"},
                                      {"route": "301V", "sharedFraction": 0.075,
                                       "weakestAgainst": "301"},
                                      {"route": "301X", "sharedFraction": 0.337,
                                       "weakestAgainst": "301"}],
                          "weakMembers": ["301", "301V", "301X"]}]}

    def test_the_real_report_shape_produces_a_row_per_weak_member(self):
        rows = dt.weak_family_rows(self.REAL)
        self.assertEqual(len(rows), 3)
        self.assertTrue(all("301" in r for r in rows))
        self.assertIn("0.07", " ".join(rows))

    def test_a_family_that_really_co_runs_says_nothing(self):
        rows = dt.weak_family_rows(
            {"sharedMin": 0.6,
             "families": [{"lead": "AW1",
                           "members": [{"route": "AW1", "sharedFraction": 0.89},
                                       {"route": "AW1X", "sharedFraction": 1.0}],
                           "weakMembers": []}]})
        self.assertEqual(rows, [])

    def test_the_threshold_comes_from_the_report_not_from_a_copy_of_it(self):
        strict = dt.weak_family_rows(
            {"sharedMin": 0.95,
             "families": [{"lead": "A", "members": [{"route": "B",
                                                     "sharedFraction": 0.9}]}]})
        self.assertEqual(len(strict), 1)

    def test_an_empty_report_is_not_an_error(self):
        self.assertEqual(dt.weak_family_rows({}), [])
        self.assertEqual(dt.weak_family_rows({"families": []}), [])

    def test_a_member_flagged_only_in_weakMembers_is_still_reported(self):
        rows = dt.weak_family_rows(
            {"sharedMin": 0.6,
             "families": [{"lead": "301", "members": [], "weakMembers": ["301V"]}]})
        self.assertEqual(len(rows), 1)
        self.assertIn("301V", rows[0])


class TheEngineMeasureComputedEarly(unittest.TestCase):
    """`path_cells` reproduces complexity_score.js's cells, in S3 rather than S4.

    The report that measures a bundle is written in S4, after the bundle has been
    configured and drawn -- so it could only ever describe a bad bundle, never stop
    one. These numbers were checked against St Ives' own corridors_report.json on
    2026-09-22: 0.328 for 301 against 301V and 0.337 for 301 against 301X, out of
    both this code and the engine's.
    """

    @staticmethod
    def paths(**routes):
        return {"routes": {r: {"pts": [[52.0 + i * 0.001, 0.0] for i in idx]}
                           for r, idx in routes.items()}}

    def test_one_point_per_cell_gives_one_cell_each(self):
        cells = dt.path_cells(self.paths(A=range(0, 5)))
        self.assertEqual(len(cells["A"]), 5)

    def test_points_inside_one_cell_collapse_to_one(self):
        cells = dt.path_cells({"routes": {"A": {"pts": [[52.0, 0.0], [52.00001, 0.0],
                                                        [52.00002, 0.0]]}}})
        self.assertEqual(len(cells["A"]), 1)

    def test_an_empty_file_is_not_an_error(self):
        self.assertEqual(dt.path_cells({}), {})
        self.assertEqual(dt.path_cells({"routes": {}}), {})

    def test_overlap_is_reported_both_ways_round(self):
        cells = dt.path_cells(self.paths(A=range(0, 10), B=range(0, 5)))
        share = dt._co_run(cells, "B", "A")
        self.assertEqual(share, (1.0, 0.5))

    def test_a_route_with_no_path_has_no_overlap_to_report(self):
        cells = dt.path_cells(self.paths(A=range(0, 10)))
        self.assertIsNone(dt._co_run(cells, "B", "A"))


class TheEndOfASpokeIsAChoice(unittest.TestCase):
    """`_end_candidates` names what the label was chosen BETWEEN (OA-436, for A13).

    The audit asked the drafter to name "the end most journeys reach, or the larger
    locality". Measured on the six spokes it was filed for, both rules write the
    label the drafter already produces and the live sheet carries the other one --
    Cambridge where St Ives' B says Hinchingbrooke, Cambridge where St Neots' 905
    says Bedford. And on St Ives' 9 and 69 every stop pattern is a single trip, so
    there is nothing for "most journeys" to count. Which end of a through route to
    draw is a decision about the whole sheet, so the drafter surfaces it instead.
    """

    class Namer:
        def name(self, atco, lat, lon):
            return {"a": "Town", "b": "Hinchingbrooke", "c": "Cambridge",
                    "d": "Hamlet"}.get(atco, atco), True

    LL = {"a": (52.30, 0.00), "b": (52.38, 0.00), "c": (52.52, 0.00), "d": (52.42, 0.00)}
    ANCHOR = (52.30, 0.00)

    def candidates(self, chain, chosen):
        return dt._end_candidates(chain, self.LL, self.ANCHOR, self.Namer(), chosen)

    def test_a_through_route_offers_both_its_ends(self):
        out = self.candidates({"canonical": [{"stops": ["c", "a", "b"]},
                                             {"stops": ["b", "a", "c"]}]}, "Cambridge")
        self.assertIn("Hinchingbrooke", [c["place"] for c in out])

    def test_the_end_already_chosen_is_not_offered_again(self):
        out = self.candidates({"canonical": [{"stops": ["a", "c"]}]}, "Cambridge")
        self.assertEqual([c["place"] for c in out], [])

    def test_a_circular_offers_the_farthest_place_it_reaches(self):
        """St Ives' 9 is a 35-stop loop back to the bus station, so its LAST stop is
        the anchor and the drafter silently took the other direction instead."""
        out = self.candidates({"canonical": [{"stops": ["a", "d", "a"]}]}, "Hemingford")
        self.assertEqual([c["place"] for c in out], ["Hamlet"])

    def test_a_candidate_carries_its_distance_and_how_long_its_pattern_is(self):
        out = self.candidates({"canonical": [{"stops": ["a", "d", "c"]}]}, "Town")
        self.assertTrue(out)
        self.assertGreater(out[0]["km"], 1.0)
        self.assertEqual(out[0]["onPattern"], 3)

    def test_a_place_in_the_town_is_never_a_candidate(self):
        out = self.candidates({"canonical": [{"stops": ["a", "a"]}]}, "Somewhere")
        self.assertEqual(out, [])

    def test_a_route_with_no_spoke_yet_still_offers_its_ends(self):
        """Called with chosen=None for a route spoke_for_route() gave nothing.
        Huntingdon's AW1 is a circular back to the bus station, so it read as
        never leaving town -- and the live sheet draws it to The Alconburys."""
        out = self.candidates({"canonical": [{"stops": ["a", "c", "a"]}]}, None)
        self.assertEqual([c["place"] for c in out], ["Cambridge"])

    def test_a_route_that_really_stays_in_town_offers_nothing(self):
        self.assertEqual(self.candidates({"canonical": [{"stops": ["a", "a"]}]}, None), [])


class SpokesThatWouldOverprint(unittest.TestCase):
    """`decollide_bearings` spreads, and never merges.

    Ramsey's 303 and 305 both reach Huntingdon on bearing 201, and the radial
    generator drops or overlaps the colliding lozenge -- which made them one
    unreadable stack. They are genuinely distinct services, so merging them
    would be an unfounded claim about the real world; spreading them is not.
    """

    def test_two_spokes_on_one_bearing_are_pushed_apart(self):
        out = dt.decollide_bearings([{"bearing": 201}, {"bearing": 201}], min_gap=20)
        bearings = sorted(s["bearing"] for s in out)
        self.assertGreaterEqual(bearings[1] - bearings[0], 20)

    def test_both_spokes_survive_rather_than_one(self):
        out = dt.decollide_bearings([{"bearing": 201, "label": "a"},
                                     {"bearing": 201, "label": "b"}], min_gap=20)
        self.assertEqual(sorted(s["label"] for s in out), ["a", "b"])

    def test_spokes_already_clear_of_each_other_are_left_alone(self):
        out = dt.decollide_bearings([{"bearing": 10}, {"bearing": 90},
                                     {"bearing": 200}], min_gap=20)
        self.assertEqual(sorted(s["bearing"] for s in out), [10, 90, 200])

    def test_three_on_one_bearing_all_end_up_clear(self):
        out = dt.decollide_bearings([{"bearing": 180}, {"bearing": 180},
                                     {"bearing": 180}], min_gap=20)
        bearings = sorted(s["bearing"] for s in out)
        self.assertGreaterEqual(bearings[1] - bearings[0], 20)
        self.assertGreaterEqual(bearings[2] - bearings[1], 20)

    def test_every_bearing_comes_back_a_whole_number_on_the_compass(self):
        out = dt.decollide_bearings([{"bearing": 5}, {"bearing": 5}], min_gap=20)
        for s in out:
            self.assertIsInstance(s["bearing"], int)
            self.assertTrue(0 <= s["bearing"] < 360, s["bearing"])


class TheGeometryUnderAllOfIt(unittest.TestCase):
    """Both functions are checked against analytic values, not against
    themselves: 6371 km * pi/180 is 111.1949 km per degree of latitude, and a
    degree of longitude is that times cos(latitude). A test anchored on a number
    this module produced would agree with whatever it now does."""

    def test_a_degree_of_latitude(self):
        self.assertAlmostEqual(dt.km_between(52.0, 0.0, 53.0, 0.0), 111.1949, places=3)

    def test_a_degree_of_longitude_shrinks_with_the_cosine(self):
        # The term a haversine written without cos(lat) drops; at 52N that is a
        # 62% overstatement of every east-west distance on the draft.
        self.assertAlmostEqual(dt.km_between(52.0, 0.0, 52.0, 1.0),
                               111.1949 * math.cos(math.radians(52.0)), places=2)

    def test_a_stop_is_no_distance_from_itself(self):
        self.assertAlmostEqual(dt.km_between(52.45, -0.11, 52.45, -0.11), 0.0, places=9)

    def test_the_compass(self):
        self.assertAlmostEqual(dt._bearing(52.0, 0.0, 53.0, 0.0), 0.0, places=6)
        self.assertAlmostEqual(dt._bearing(53.0, 0.0, 52.0, 0.0), 180.0, places=6)
        self.assertAlmostEqual(dt._bearing(52.0, 0.0, 52.0, 1.0), 90.0, delta=1.0)
        self.assertAlmostEqual(dt._bearing(52.0, 0.0, 52.0, -1.0), 270.0, delta=1.0)


# --------------------------------------------------------------------------
# What the draft says about its own evidence
# --------------------------------------------------------------------------
class EveryDraftedServiceSaysItIsUnverified(unittest.TestCase):
    """`build_verified_services` writes the S1 file a Tier-2 draft ships with.

    The whole safety of an unattended draft rests on this flag: S1 here skips
    the bustimes cross-check and the operator-PDF disagreement audit entirely,
    so community and DRT services BODS omits are simply absent. A service that
    came through this path and read `verified: true` would be a claim nobody
    made, on the file every later stage and every reviewer trusts.
    """

    def setUp(self):
        self.dir = _stubs.scratch("draft-town-s1-")
        self.out = os.path.join(self.dir, "verified-services.json")

    def _build(self, facts):
        src = _stubs.write_json(os.path.join(self.dir, "gtfs-services.json"), facts)
        routes = dt.build_verified_services(src, self.out)
        with io.open(self.out, encoding="utf-8") as fh:
            return routes, json.load(fh)

    def test_nothing_that_came_through_here_is_marked_verified(self):
        routes, out = self._build({"services": [
            {"route": "46", "operator": "Whippet"},
            {"route": "X31", "operator": "Stagecoach East"}]})
        self.assertEqual(routes, ["46", "X31"])
        self.assertEqual([s["verified"] for s in out["services"]], [False, False])

    def test_the_source_names_what_was_not_checked(self):
        _routes, out = self._build({"services": [{"route": "46"}]})
        src = out["services"][0]["verifySource"]
        for phrase in ("GTFS only", "NOT cross-checked", "bustimes.org",
                       "community/DRT", "NOT included"):
            self.assertIn(phrase, src)

    def test_every_field_the_pull_carried_survives(self):
        _routes, out = self._build({"services": [
            {"route": "46", "operator": "Whippet", "days": "Mon-Sat",
             "termini": ["St Ives", "Huntingdon"]}]})
        s = out["services"][0]
        self.assertEqual(s["operator"], "Whippet")
        self.assertEqual(s["days"], "Mon-Sat")
        self.assertEqual(s["termini"], ["St Ives", "Huntingdon"])

    def test_a_bare_list_is_read_as_the_services(self):
        routes, out = self._build([{"route": "9"}])
        self.assertEqual(routes, ["9"])
        self.assertEqual(out["services"][0]["verified"], False)

    def test_the_file_it_read_is_not_the_file_it_wrote(self):
        src = _stubs.write_json(os.path.join(self.dir, "gtfs-services.json"),
                                {"services": [{"route": "46"}]})
        dt.build_verified_services(src, self.out)
        with io.open(src, encoding="utf-8") as fh:
            self.assertNotIn("verified", json.load(fh)["services"][0])


class AnUnansweredPullIsNotAnEmptyOne(unittest.TestCase):
    """OA-339: `overpass()` used to write {"elements": []} when two tries failed.

    The helper it now calls is replaced for the duration, so these ask what
    draft_town DOES with an answer or a refusal, and reach no server.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.dest = os.path.join(self.tmp, "osm.json")
        self.saved = dt.overpass_fetch.fetch
        self.addCleanup(setattr, dt.overpass_fetch, "fetch", self.saved)

    def test_a_refusal_stops_the_stage_and_writes_nothing(self):
        def refuse(*_a, **_k):
            raise dt.overpass_fetch.OverpassUnreachable("osm.json: no Overpass host answered")
        dt.overpass_fetch.fetch = refuse
        with self.assertRaises(SystemExit) as cm:
            dt.overpass("q", self.dest)
        self.assertFalse(os.path.exists(self.dest), "a refusal was written to disk as an answer")
        self.assertIn("NOT written", str(cm.exception.code))

    def test_an_answer_is_written_as_it_came(self):
        answer = {"version": 0.6, "elements": [{"type": "node", "id": 7}]}
        dt.overpass_fetch.fetch = lambda *_a, **_k: answer
        self.assertEqual(dt.overpass("q", self.dest), answer)
        with open(self.dest, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh), answer)


class ANewMapIsDrawnNorthUp(unittest.TestCase):
    """buses-data OA-454: the drafter pins north, and never over a person's angle."""

    def test_a_draft_with_no_design_block_is_pinned_north(self):
        self.assertEqual(dt.pin_north({})["design"], {"fixedOrientation": "north"})

    def test_the_rest_of_an_existing_design_block_is_kept(self):
        draft = dt.pin_north({"design": {"footerSafe": True}})
        self.assertEqual(draft["design"], {"footerSafe": True, "fixedOrientation": "north"})

    def test_an_angle_somebody_chose_is_left_alone(self):
        for chosen in (-35, "auto", 0):
            with self.subTest(chosen=chosen):
                draft = dt.pin_north({"design": {"fixedOrientation": chosen}})
                self.assertEqual(draft["design"]["fixedOrientation"], chosen)


if __name__ == "__main__":
    unittest.main()
