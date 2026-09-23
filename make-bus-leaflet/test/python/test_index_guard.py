"""index_guard.py -- the guard that tells "indexed" from "silently deduplicated".

WHY THIS FILE EXISTS, AND IT IS NOT "one more module without a test". This module
has a TWIN. `assets/index_guard.js` and `assets/index_guard.py` are the same rule
written twice, for the same reason and against the same fault, and one of them has
had `test/index_guard.test.js` since the day it was written while the other has had
nothing but `test_module_load.py` asking whether it imports. That is the shape this
project has named *the invariant beside the un-asserted twin*: the checked half
reads as the whole rule, so the next person to touch either one believes both are
covered. Measured 2026-09-15 -- the JS half carried ten tests, the Python half zero.

WHAT THE RULE IS. `{s["route"]: s for s in services}` is not an index; it is an
index AND a silent de-duplication, and nothing afterwards distinguishes the two.
Wisbech runs two route 46s -- Stagecoach East to March and Lynx to King's Lynn --
so on that one town the comprehension turns eleven services into ten entries and
the survivor wears the other's facts. `gtfs_refresh_report.py` had been diffing the
LYNX 46 against BODS every month and had never once checked the Stagecoach one. See
OA-134.

WHY THE PYTHON HALF BEING THE UNTESTED ONE IS THE WORSE WAY ROUND. `group_by` is
the function the monthly refresh report actually calls (`gtfs_refresh_report.py`
line 318) and it is the function the JS half DOES NOT HAVE -- so it is covered by
no test in either language, in the one path that runs unattended to nobody once a
month. `service_key` is what labels every change row that report prints, which is
the difference between a reader being told about `46` and `46L` and being told
about `46` twice.

EVERY CASE HERE IS A STUB. Three dicts standing for the part of Wisbech that
matters. Not one reads the Buses folder, for `prove-red-route-collision.py`'s
reason: an assertion about a real tree is an assertion about what somebody happened
to build that week.
"""
import os
import re
import unittest

import _engine

ig = _engine.load("index_guard")

# Wisbech, reduced to the part that matters. The same three rows the JS twin's test
# uses, deliberately, so the two suites can be read against each other.
WISBECH = [
    {"key": "46", "route": "46", "operator": "Stagecoach East"},
    {"key": "46L", "route": "46", "operator": "Lynx"},
    {"key": "60", "route": "60", "operator": "Lynx"},
]


class TheFaultTheModuleExistsFor(unittest.TestCase):
    """Wisbech's two 46s, put through each of the three entry points."""

    def test_index_unique_on_the_route_NUMBER_refuses_rather_than_losing_a_row(self):
        with self.assertRaises(ValueError) as caught:
            ig.index_unique(WISBECH, key=lambda s: str(s["route"]),
                            what="wisbech by route number")
        msg = str(caught.exception)
        # The message has to be readable by someone who has never seen the file: it
        # must name the source, the colliding key, BOTH operators -- which is the
        # only thing that tells the two apart -- and where the reasoning lives.
        self.assertIn("wisbech by route number", msg)
        self.assertIn("'46'", msg)
        self.assertIn("Stagecoach East", msg)
        self.assertIn("Lynx", msg)
        self.assertIn("OA-134", msg)

    def test_index_unique_on_the_key_field_keeps_every_row(self):
        out = ig.index_unique(WISBECH, what="wisbech by key")
        self.assertEqual(len(out), len(WISBECH))
        self.assertEqual(out["46"]["operator"], "Stagecoach East")
        self.assertEqual(out["46L"]["operator"], "Lynx")

    def test_group_by_the_route_NUMBER_keeps_BOTH_46s(self):
        """The live path in the monthly refresh report, and the whole point of it.

        `gtfs_refresh_report.py` groups on the route number on purpose -- BODS gives
        it a route number and nothing else -- so the guard there is not a refusal but
        a LIST. The comprehension this replaced returned one 46; this returns two.
        """
        g = ig.group_by(WISBECH, key=lambda s: str(s["route"]))
        self.assertEqual(sorted(g), ["46", "60"])
        self.assertEqual(len(g["46"]), 2)
        self.assertEqual([s["operator"] for s in g["46"]],
                         ["Stagecoach East", "Lynx"])

    def test_group_by_conserves_every_row_which_is_the_arithmetic_that_IS_the_guard(self):
        g = ig.group_by(WISBECH, key=lambda s: str(s["route"]))
        self.assertEqual(sum(len(v) for v in g.values()), len(WISBECH))


class TheLabelTheMonthlyReportPrints(unittest.TestCase):
    """`service_key` decides what a reader of the refresh report is told a row is about."""

    def test_the_key_field_wins_over_the_route_number(self):
        self.assertEqual(ig.service_key(WISBECH[0]), "46")
        self.assertEqual(ig.service_key(WISBECH[1]), "46L")

    def test_it_falls_back_to_the_route_number_when_there_is_no_key(self):
        # `key` is present on 4 of 8 towns and 0 of 12 places (measured 2026-08-28),
        # so on most of the estate this IS the route number and the behaviour must be
        # exactly what it was before the guard existed, or unaffected maps change.
        self.assertEqual(ig.service_key({"route": "9"}), "9")
        self.assertEqual(ig.service_key({"route": 9}), "9")
        self.assertEqual(ig.service_key({"route": "A", "key": ""}), "A")
        self.assertEqual(ig.service_key({"route": "A", "key": None}), "A")

    def test_the_answer_is_always_a_string_because_it_is_used_as_a_dict_key(self):
        # A row carrying the integer 9 and one carrying "9" are the same service, and
        # a dict would file them apart. This is the line that stops that.
        self.assertIsInstance(ig.service_key({"route": 9}), str)
        self.assertEqual(ig.service_key({"route": 9}), ig.service_key({"route": "9"}))


class GroupByIsTheOneWithNoTwin(unittest.TestCase):
    """`group_by` exists only in the Python half, so no JS test reaches this behaviour."""

    def test_order_within_a_group_is_the_order_the_rows_arrived_in(self):
        """The report iterates `rows` and emits one change line per shipped entry, so
        this ordering is the order a person reads them in."""
        rows = [{"route": "5", "operator": "A"}, {"route": "5", "operator": "B"},
                {"route": "5", "operator": "C"}]
        self.assertEqual([s["operator"] for s in ig.group_by(rows, key=lambda s: s["route"])["5"]],
                         ["A", "B", "C"])

    def test_every_value_is_a_LIST_even_when_the_key_is_unique(self):
        # The caller does `for sh in rows`. A bare row where a list belongs would
        # iterate its dict keys and report nonsense rather than fail.
        g = ig.group_by([{"route": "60"}], key=lambda s: s["route"])
        self.assertIsInstance(g["60"], list)
        self.assertEqual(len(g["60"]), 1)

    def test_its_default_key_is_service_key_not_the_route_number(self):
        g = ig.group_by(WISBECH)
        self.assertEqual(sorted(g), ["46", "46L", "60"])

    def test_empty_and_None_give_an_empty_dict_rather_than_raising(self):
        # A town whose file has no `services` array must produce an empty report, not
        # a traceback in a job that runs unattended once a month.
        self.assertEqual(ig.group_by([]), {})
        self.assertEqual(ig.group_by(None), {})


class IndexUniqueOnTheEdges(unittest.TestCase):

    def test_a_three_way_collision_is_reported_once_naming_all_three(self):
        three = [{"route": "5"}, {"route": "5"}, {"route": "5"}]
        with self.assertRaises(ValueError) as caught:
            ig.index_unique(three, key=lambda s: str(s["route"]), what="three")
        msg = str(caught.exception)
        self.assertIn("1 colliding key(s)", msg)
        self.assertEqual(len(re.findall(r"#\d", msg)), 3)

    def test_empty_and_None_do_not_raise(self):
        self.assertEqual(ig.index_unique([], what="x"), {})
        self.assertEqual(ig.index_unique(None, what="x"), {})

    def test_the_values_are_the_rows_themselves_not_copies(self):
        out = ig.index_unique(WISBECH, what="x")
        self.assertIs(out["46L"], WISBECH[1])


class AssertNoCollision(unittest.TestCase):
    """The assertion on its own, for a dict somebody else built."""

    def test_it_passes_on_a_dict_built_correctly(self):
        good = {ig.service_key(s): s for s in WISBECH}
        ig.assert_no_collision(good, WISBECH, "wisbech")   # must not raise

    def test_it_fires_on_the_historical_bug_and_says_how_many_were_lost(self):
        bad = {str(s["route"]): s for s in WISBECH}        # the line from OA-134
        self.assertEqual(len(bad), 2)
        with self.assertRaises(ValueError) as caught:
            ig.assert_no_collision(bad, WISBECH, "wisbech")
        msg = str(caught.exception)
        self.assertIn("indexed 3 row(s) into 2 entries", msg)
        self.assertIn("1 were silently overwritten", msg)
        self.assertIn("OA-134", msg)

    def test_an_empty_source_list_against_an_empty_dict_passes(self):
        ig.assert_no_collision({}, [], "x")
        ig.assert_no_collision({}, None, "x")


class TheTwoHalvesOfTheSameRule(unittest.TestCase):
    """A census of the twin, because the divergence is the thing nothing could see.

    This module and `index_guard.js` are the same rule in two languages, and the
    only reason a reader believes both are right is that they look alike. Nothing
    holds them together: a fix applied to one and not the other is invisible to
    every gate in the estate, because neither half moves a drawn byte. So the join
    is asserted here, from the only place that can ask it -- and the two genuine
    divergences are DECLARED, with a reason, rather than filtered away.

    Both exemptions retire themselves in BOTH directions: red if the divergence is
    closed (delete the entry), red if it disappears from the half that has it (the
    exemption is stale). That is OA-321's pattern, so a fix cannot land and leave a
    stale excuse standing behind it.
    """

    # Declared divergence, with the reason, not an exclusion list.
    PY_ONLY = {
        # The honest answer when a key genuinely is not unique. The JS callers all
        # want a refusal; the monthly refresh report wants every row kept, because
        # BODS hands it a route number and nothing finer.
        "group_by": "no JS caller needs it -- gtfs_refresh_report.py is its only user",
    }
    JS_ONLY = {
        # A prototype-less object so that 'constructor' cannot be a route number.
        # A Python dict has no prototype, so index_unique already IS this.
        "indexUniqueObj": "a Python dict needs no prototype-less variant",
    }

    @staticmethod
    def _camel(name):
        head, *rest = name.split("_")
        return head + "".join(w[:1].upper() + w[1:] for w in rest)

    def _sources(self):
        py = os.path.join(_engine.ENGINE_DIR, "index_guard.py")
        js = os.path.join(_engine.ENGINE_DIR, "index_guard.js")
        # A missing file must FAIL rather than read as "nothing to compare" -- the
        # refusal read as an absence is a shape this project has already paid for.
        for p in (py, js):
            self.assertTrue(os.path.isfile(p), "%s is not on disk" % p)
        out = []
        for p in (py, js):
            with open(p, encoding="utf-8") as fh:
                out.append(fh.read())
        return tuple(out)

    def test_every_public_function_here_has_its_twin_over_there(self):
        py_src, js_src = self._sources()
        py_names = set(re.findall(r"^def ([a-z][a-z0-9_]*)\(", py_src, re.M))
        self.assertTrue(py_names, "found no public functions -- the census is measuring itself")
        m = re.search(r"module\.exports\s*=\s*\{([^}]*)\}", js_src)
        self.assertIsNotNone(m, "index_guard.js exports nothing this census can read")
        js_names = set(n.strip() for n in m.group(1).split(",") if n.strip())

        missing = {n for n in py_names if self._camel(n) not in js_names} - set(self.PY_ONLY)
        self.assertEqual(missing, set(),
                         "index_guard.py has function(s) the JS half does not, and they are "
                         "not declared in PY_ONLY: %s" % sorted(missing))

        extra = {n for n in js_names if self._to_snake(n) not in py_names} - set(self.JS_ONLY)
        self.assertEqual(extra, set(),
                         "index_guard.js exports function(s) the Python half does not, and they "
                         "are not declared in JS_ONLY: %s" % sorted(extra))

    @staticmethod
    def _to_snake(name):
        return re.sub(r"(?<!^)([A-Z])", lambda m: "_" + m.group(1).lower(), name)

    def test_each_declared_divergence_still_exists_in_the_half_that_has_it(self):
        """The half that retires the exemption. If group_by gains a JS twin, or
        indexUniqueObj gains a Python one, this goes red saying so."""
        py_src, js_src = self._sources()
        py_names = set(re.findall(r"^def ([a-z][a-z0-9_]*)\(", py_src, re.M))
        m = re.search(r"module\.exports\s*=\s*\{([^}]*)\}", js_src)
        js_names = set(n.strip() for n in m.group(1).split(",") if n.strip())

        for name, why in self.PY_ONLY.items():
            self.assertIn(name, py_names,
                          "PY_ONLY names %s (%s) and index_guard.py no longer defines it -- "
                          "the exemption is stale, delete it" % (name, why))
            self.assertNotIn(self._camel(name), js_names,
                             "index_guard.js now exports %s, so the PY_ONLY entry for %s is "
                             "stale -- delete it" % (self._camel(name), name))
        for name, why in self.JS_ONLY.items():
            self.assertIn(name, js_names,
                          "JS_ONLY names %s (%s) and index_guard.js no longer exports it -- "
                          "the exemption is stale, delete it" % (name, why))
            self.assertNotIn(self._to_snake(name), py_names,
                             "index_guard.py now defines %s, so the JS_ONLY entry for %s is "
                             "stale -- delete it" % (self._to_snake(name), name))

    def test_both_halves_still_cite_the_action_the_rule_comes_from(self):
        """A guard whose message does not say where the reasoning lives is one the
        next reader deletes. Both halves print OA-134 today."""
        py_src, js_src = self._sources()
        self.assertIn("OA-134", py_src)
        self.assertIn("OA-134", js_src)


class TheErrorPathNOWWalked(unittest.TestCase):
    """The error path that used to crash, FIXED under OA-369 on 2026-09-20.

    `service_key` opens with `if not isinstance(s, dict): return str(s)` -- an
    explicit decision that a row need not be a dict. `_message`, the error path,
    then did `(rows[i] or {}).get("route", "?")`, which defends against None, 0
    and "" and against nothing else, so a bare route string reached `.get` and
    raised AttributeError. The one shape the key function goes out of its way to
    support was the one shape the refusal could not report, and a caller got a
    traceback from inside the guard instead of the ValueError the module's whole
    contract is about.

    The predecessor of this class pinned that behaviour on purpose and went red
    the moment the fix landed, which is how the change was told it was arriving.
    These cases replace it, and they are the reason it could retire: the refusal
    now REPORTS the shape rather than dying on it.

    `_route_of` carries the rule and mirrors `collisionMessage` in the JS twin --
    `rows[i] || {}` followed by `r.route != null ? r.route : '?'`. Both halves of
    that expression are asserted below, because the second half was a divergence
    of its own that nothing had named: `.get("route", "?")` applies its default
    only when the KEY is absent, so a dict carrying an explicit `route: None`
    printed the word "None" where the twin prints "?".

    Still no live caller reaches any of this -- `gtfs_refresh_report.py` and
    `draft_town.py` both pass dicts out of a town's own JSON -- so these cases and
    the twin census above are the only things standing under it.
    """

    def test_a_collision_between_two_non_dict_rows_raises_ValueError_naming_both(self):
        with self.assertRaises(ValueError) as caught:
            ig.index_unique(["46", "46"], what="bare strings")
        msg = str(caught.exception)
        self.assertIn("bare strings: 1 colliding key(s)", msg)
        self.assertIn("'46' <- #0 ? vs #1 ?", msg)
        self.assertIn("OA-134", msg)

    def test_a_non_dict_row_is_the_only_thing_that_changed_a_dict_still_reads_its_route(self):
        with self.assertRaises(ValueError) as caught:
            ig.index_unique([{"route": "46", "operator": "Lynx"},
                             {"route": "46", "operator": "Stagecoach East"}], what="two 46s")
        self.assertIn("'46' <- #0 46 (Lynx) vs #1 46 (Stagecoach East)", str(caught.exception))

    def test_an_explicit_route_of_None_prints_the_same_question_mark_the_twin_prints(self):
        with self.assertRaises(ValueError) as caught:
            ig.index_unique([{"key": "x", "route": None}, {"key": "x", "route": None}],
                            what="null route")
        self.assertIn("'x' <- #0 ? vs #1 ?", str(caught.exception))
        self.assertNotIn("None", str(caught.exception))

    def test_route_of_answers_the_three_shapes_directly(self):
        self.assertEqual(ig._route_of("46"), "?")
        self.assertEqual(ig._route_of(None), "?")
        self.assertEqual(ig._route_of({}), "?")
        self.assertEqual(ig._route_of({"route": None}), "?")
        self.assertEqual(ig._route_of({"route": "46"}), "46")

    def test_service_key_itself_accepts_a_non_dict_which_is_what_made_it_a_fault(self):
        self.assertEqual(ig.service_key("46"), "46")
        self.assertEqual(ig.service_key(None), "None")


if __name__ == "__main__":
    unittest.main(verbosity=2)
