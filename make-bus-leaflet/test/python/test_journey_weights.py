"""journey_weights.py -- which drawn stops are a minority deviation (buses-data OA-452).

The St Neots map drew the 18 westbound round a station loop that 3 of 25
passing journeys run, because a bustimes direction is the union of every stop
any journey calls at. This module counts, for each drawn stop, the journeys that
PASS it and the journeys that CALL at it, and lists the stops fewer than half of
the passers call at. Three things it must NOT drop each have a test below,
because each would redraw a real map wrongly at its next rebuild:

* **a short working's far end** -- stops past where most journeys terminate are
  not passed by those journeys, so a short working never makes a terminus vanish;
* **a stop the feed has never heard of** -- High Wycombe's White Close is on the
  29's path and absent from the BODS stops table;
* **a thin sample** -- fewer than `--min-passing` passers decides nothing.

THE FIXTURES ARE STUBS, NOT A FEED, following `_stubs.py`'s reasoning.
"""
import json
import os
import unittest

import _engine
import _stubs

jw = _engine.load("journey_weights")

CHAIN = ["T1", "L1", "L2", "T2", "T3"]
KNOWN = set(CHAIN)


def trips(n, calls):
    return [list(calls) for _ in range(n)]


class Classify(unittest.TestCase):

    def test_a_loop_most_passing_journeys_skip_is_dropped(self):
        r = jw.classify(CHAIN, trips(8, ["T1", "T2", "T3"]) + trips(2, CHAIN), KNOWN)
        self.assertEqual(r["drop"], ["L1", "L2"])
        self.assertEqual(r["minority"], [{"stops": ["L1", "L2"], "journeys": 2, "of": 10}])

    def test_a_loop_most_journeys_run_is_kept(self):
        r = jw.classify(CHAIN, trips(8, CHAIN) + trips(2, ["T1", "T2", "T3"]), KNOWN)
        self.assertEqual(r["drop"], [])

    def test_a_short_workings_far_end_is_NOT_dropped(self):
        r = jw.classify(CHAIN, trips(9, ["T1", "L1", "L2", "T2"]) + trips(3, CHAIN), KNOWN)
        self.assertEqual(r["drop"], [])
        self.assertEqual(r["passing"]["T3"], 3)

    def test_a_stop_the_feed_does_not_know_is_kept_and_listed(self):
        r = jw.classify(CHAIN, trips(8, ["T1", "T2", "T3"]), KNOWN - {"L1"})
        self.assertEqual(r["drop"], ["L2"])
        self.assertEqual(r["unknown"], ["L1"])

    def test_a_thin_sample_decides_nothing(self):
        r = jw.classify(CHAIN, trips(2, ["T1", "T2", "T3"]), KNOWN)
        self.assertEqual(r["drop"], [])


class Assign(unittest.TestCase):

    def test_a_trip_goes_to_the_direction_whose_order_it_follows(self):
        out, back = ["A", "B", "C"], ["C", "B", "A"]
        self.assertEqual(jw.assign([out, back], ["A", "X", "C"]), 0)
        self.assertEqual(jw.assign([out, back], ["C", "B"]), 1)

    def test_one_shared_stop_is_nobodys(self):
        self.assertIsNone(jw.assign([["A", "B", "C"]], ["B", "Z"]))


class EndToEnd(unittest.TestCase):

    def test_the_file_derive_intown_reads(self):
        d = _stubs.scratch("journey-weights-")
        db = os.path.join(d, "gtfs.sqlite")
        stops = [{"stop_id": s, "stop_name": s} for s in CHAIN]
        tr, st = [], []
        for i, calls in enumerate(trips(6, ["T1", "T2", "T3"]) + trips(2, CHAIN)):
            tid = "t%d" % i
            tr.append({"trip_id": tid, "route_id": "R1", "service_id": "S"})
            st += [{"trip_id": tid, "stop_id": s, "stop_sequence": str(k)} for k, s in enumerate(calls)]
        _stubs.gtfs_db(db, {"routes": [{"route_id": "R1", "route_short_name": "18a"}],
                            "stops": stops, "trips": tr, "stop_times": st})
        full = os.path.join(d, "routes_full_atco.json")
        _stubs.write_json(full, {"18A": {"canonical": [{"name": "A to B", "stops": CHAIN}]}})
        out = os.path.join(d, "journey_weights.json")
        self.assertEqual(jw.main([full, "--db", db, "--out", out]), 0)
        with open(out, encoding="utf-8") as fh:
            res = json.load(fh)
        self.assertEqual(res["18A"]["A to B"]["drop"], ["L1", "L2"])
        self.assertEqual(res["18A"]["A to B"]["journeys"], 8)

    def test_a_missing_database_is_a_usage_fault(self):
        d = _stubs.scratch("journey-weights-")
        full = os.path.join(d, "routes_full_atco.json")
        _stubs.write_json(full, {})
        self.assertEqual(jw.main([full, "--db", os.path.join(d, "nope.sqlite"),
                                  "--out", os.path.join(d, "o.json")]), 2)


if __name__ == "__main__":
    unittest.main()
