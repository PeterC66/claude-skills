"""overpass_fetch.py -- the one place the town engine's Python asks Overpass anything.

THE FAULT (OA-339). `draft_town.py` tried two hosts once each and, when both
failed, wrote `{"elements": []}` to disk as though Overpass had answered. That is
a town with no river, and nothing downstream can tell. The module's three rules
-- retry properly, raise rather than substitute, say what it got -- are each
pinned below, and each has a mutation in `tools/prove-red-python.py` that
restores the fault it guards against.

NO TEST HERE REACHES THE NETWORK. `urlopen` is replaced for the duration of each
case and `sleep` is passed in, so a case asserts what the module does with an
answer, not what a server said this morning, and the full twelve-try failure
path costs no wall-clock time.
"""
import io
import json
import unittest
import urllib.request

import _engine

of = _engine.load("overpass_fetch")

ENVELOPE = {"version": 0.6, "generator": "Overpass API 0.7.62.11",
            "osm3s": {"timestamp_osm_base": "2026-09-23T12:00:00Z"}}


def reply(elements, **extra):
    return dict(ENVELOPE, elements=elements, **extra)


class _Harness(unittest.TestCase):
    """Each case scripts its answers; `self.calls` records the hosts asked."""

    def script(self, *answers):
        """One answer per try: a dict is returned as JSON, an exception is raised."""
        self.calls, self.slept, self.log = [], [], io.StringIO()
        answers = list(answers)
        real = urllib.request.urlopen

        def fake(req, timeout=None):
            self.calls.append(req.full_url)
            a = answers.pop(0) if answers else IOError("504 Gateway Timeout")
            if isinstance(a, Exception):
                raise a
            return io.BytesIO(json.dumps(a).encode("utf-8"))

        urllib.request.urlopen = fake
        self.addCleanup(lambda: setattr(urllib.request, "urlopen", real))

    def fetch(self, **kw):
        return of.fetch("[out:json];node(1);out;", sleep=self.slept.append,
                        label="osm.json", log=self.log, **kw)


class ItReturnsARealAnswer(_Harness):

    def test_the_first_answer_is_returned_and_counted(self):
        self.script(reply([{"type": "node", "id": 1}, {"type": "node", "id": 2}]))
        d = self.fetch()
        self.assertEqual(len(d["elements"]), 2)
        self.assertEqual(len(self.calls), 1)
        self.assertIn("osm.json: 2 elements", self.log.getvalue())

    def test_a_genuine_empty_answer_is_an_answer_and_is_not_retried(self):
        # Ramsey's canal: the server answered, and the bbox holds none. Retrying
        # that would spend two minutes asking a question already answered.
        self.script(reply([]))
        d = self.fetch()
        self.assertEqual(d["elements"], [])
        self.assertEqual(len(self.calls), 1)
        self.assertIn("osm.json: 0 elements", self.log.getvalue())


class ItRetriesProperly(_Harness):

    def test_it_keeps_going_past_two_failures(self):
        # Two tries is what lost seven towns in eight on 2026-09-13.
        self.script(IOError("504"), IOError("504"), IOError("504"), IOError("504"),
                    IOError("504"), reply([{"type": "way", "id": 9}]))
        d = self.fetch()
        self.assertEqual(len(d["elements"]), 1)
        self.assertEqual(len(self.calls), 6)

    def test_it_cycles_the_hosts(self):
        self.script(IOError("504"), IOError("504"), IOError("504"), reply([]))
        self.fetch()
        self.assertEqual(len(set(self.calls[:3])), 3, self.calls)
        self.assertEqual(self.calls[3], self.calls[0])

    def test_the_wait_grows_after_each_failure(self):
        self.script(IOError("504"), IOError("504"), IOError("504"), reply([]))
        self.fetch()
        self.assertEqual(self.slept, [of.BACKOFF_S * 1, of.BACKOFF_S * 2, of.BACKOFF_S * 3])

    def test_a_reply_that_timed_out_on_the_server_is_retried(self):
        # 200, parseable, and not an answer: Overpass stopped collecting.
        self.script(reply([], remark="runtime error: Query timed out in \"query\" at line 3"),
                    reply([{"type": "node", "id": 1}]))
        d = self.fetch()
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(len(d["elements"]), 1)
        self.assertIn("incomplete reply", self.log.getvalue())

    def test_a_reply_with_no_elements_list_is_retried(self):
        self.script({"error": "rate limited"}, reply([]))
        self.fetch()
        self.assertEqual(len(self.calls), 2)


class ItRaisesRatherThanSubstitutes(_Harness):

    def test_every_try_failing_raises(self):
        self.script()                                     # every call: 504
        with self.assertRaises(of.OverpassUnreachable) as cm:
            self.fetch()
        self.assertEqual(len(self.calls), of.TRIES)
        self.assertIn("osm.json", str(cm.exception))
        self.assertIn("504", str(cm.exception))

    def test_the_last_try_is_not_followed_by_a_pointless_wait(self):
        self.script()
        with self.assertRaises(of.OverpassUnreachable):
            self.fetch(tries=3)
        self.assertEqual(len(self.slept), 2)


if __name__ == "__main__":
    unittest.main()
