"""auto_refresh_month.py -- the rules that decide which towns are rebuilt and
proposed to a customer with nobody watching.

WHY THIS MODULE AND WHY NOW. OA-001 in `buses-data` named it as one of two with
the longest fuse: it runs monthly, to nobody, and its whole purpose is to act
without a human. `classify()` is the gate -- SAFE means run S1/S3/S4/S5 for that
town and stage a portal "proposed update" for the customer to accept; ESCALATE
means leave it alone and put it in front of a person. Until this file the module
had nothing but `test_module_load.py` asking whether it imports.

WHAT THE FIRST RUN OF THESE CASES FOUND, and it is the reason the suite is worth
more than its green. `classify()` carried TWO second homes for rules that are
written down elsewhere:

  * The non-actionable tag set. `gtfs_refresh_report.py` keeps it as the module
    constant `NON_ACTIONABLE = ("COMMUNITY", "NOT-IN-BODS")`, with a comment
    saying it is a constant so that nothing re-implements the filter and then
    agrees with itself. `classify()` re-implemented it as the bare literal
    "COMMUNITY", so a town whose only change was NOT-IN-BODS -- absent from BODS
    AND the town's own file already says so -- was left OFF the report's
    towns-to-review list and classified SAFE by the automation at the same time.

  * The SAFE set itself, as the COMPLEMENT of a blocking list. Its own docstring
    said "SAFE = only OPERATOR/DAYS"; the code said "not ADD?/WITHDRAWN?/RE-EVAL",
    which is not the same sentence and is unsafe in the direction that matters --
    every tag the report has ever grown became SAFE on the day it was added, with
    nothing here edited. `NOT-IN-BODS?` (a stale `notInBods` declaration over a
    route the feed does carry, whose fix is a person deleting a field) was being
    auto-applied as though it were an operator rename.

Both were measured by calling the function, not by reading it, and both are now
assertions below. The join in `TagsTheReportCanEmit` is the one that matters
longest: it DERIVES every tag from `gtfs_refresh_report.py`'s own source and
requires each to be decided deliberately, so the next tag somebody adds to the
report arrives here as a red test rather than as a silent SAFE.

Nothing here reads the Buses folder, for `test_prune_runs.py`'s reason: an
assertion about a real tree is an assertion about what somebody happened to build
that week. The fixtures are the tuples `diff_town` returns and dictionaries shaped
like a `routes.json`.
"""
import copy
import io
import json
import os
import re
import tempfile
import unittest

import _engine

ar = _engine.load("auto_refresh_month")
rr = _engine.load("gtfs_refresh_report")


def change(tag, route="7", msg="a change"):
    """One row of `diff_town`'s `changes` list, in the shape it really returns."""
    return (tag, route, msg)


class Classify(unittest.TestCase):
    """The gate: does this town get rebuilt and proposed without a human?"""

    def test_an_operator_rename_alone_is_SAFE(self):
        verdict, reasons = ar.classify([change("OPERATOR", "5", "shipped 'A' vs BODS 'B'")])
        self.assertEqual(verdict, "SAFE")
        self.assertEqual([c[1] for c in reasons], ["5"])

    def test_a_days_change_alone_is_SAFE(self):
        verdict, reasons = ar.classify([change("DAYS", "5", "shipped 'Mon-Fri' vs BODS 'Mon-Sat'")])
        self.assertEqual(verdict, "SAFE")
        self.assertEqual([c[1] for c in reasons], ["5"])

    def test_a_new_route_ESCALATES_because_somebody_has_to_choose_a_colour(self):
        verdict, reasons = ar.classify([change("ADD?", "X5", "new in BODS")])
        self.assertEqual(verdict, "ESCALATE")
        self.assertEqual([c[1] for c in reasons], ["X5"])

    def test_a_vanished_route_ESCALATES(self):
        self.assertEqual(ar.classify([change("WITHDRAWN?", "66")])[0], "ESCALATE")

    def test_a_serves_town_re_evaluation_ESCALATES(self):
        self.assertEqual(ar.classify([change("RE-EVAL", "303")])[0], "ESCALATE")

    def test_nothing_at_all_is_NOTHING(self):
        self.assertEqual(ar.classify([]), ("NOTHING", []))

    def test_a_community_only_town_is_NOTHING(self):
        self.assertEqual(ar.classify([change("COMMUNITY", "V1")]), ("NOTHING", []))

    def test_an_expected_absence_is_NOTHING_and_the_set_is_the_REPORTs(self):
        """NOT-IN-BODS: absent from BODS, and the town's own file says so.

        The verdict has to agree with the report a person reads. The report
        leaves such a town off its towns-to-review list -- `NON_ACTIONABLE` is
        what does that -- and this function said SAFE, which is the verdict that
        rebuilds four stages and puts a proposed update in front of the customer.
        Asserted against `rr.NON_ACTIONABLE` rather than against the string, so a
        tag leaving that constant cannot leave this test green.
        """
        for tag in rr.NON_ACTIONABLE:
            self.assertEqual(ar.classify([change(tag, "56")]), ("NOTHING", []), tag)

    def test_a_stale_notInBods_declaration_ESCALATES_rather_than_auto_applying(self):
        """`NOT-IN-BODS?` is actionable and is NOT mechanical.

        Its own message in the report is *the declaration is stale, delete it* --
        a person editing a field. Under the blocking-list version this was SAFE,
        so the monthly run would rebuild the town, propose the update, and leave
        the stale declaration exactly where it was.
        """
        verdict, reasons = ar.classify([change("NOT-IN-BODS?", "401")])
        self.assertEqual(verdict, "ESCALATE")
        self.assertEqual([c[0] for c in reasons], ["NOT-IN-BODS?"])

    def test_a_tag_nobody_has_written_yet_ESCALATES(self):
        """The default is the direction that costs a person five minutes.

        This is the whole value of an allowlist here: the alternative default is
        a sheet rebuilt and offered to a customer over a change no code in this
        file has ever been shown.
        """
        self.assertEqual(ar.classify([change("SOMETHING-NEW", "9")])[0], "ESCALATE")

    def test_one_blocking_change_ESCALATES_the_whole_town(self):
        verdict, reasons = ar.classify([change("OPERATOR", "5"), change("ADD?", "X5")])
        self.assertEqual(verdict, "ESCALATE")
        self.assertEqual([c[1] for c in reasons], ["X5"],
                         "only the blocking rows are reasons -- main() marks exactly these "
                         "'<- blocking' in the report")

    def test_a_non_actionable_row_does_not_make_a_mechanical_town_unsafe(self):
        verdict, reasons = ar.classify([change("COMMUNITY", "V1"), change("DAYS", "5")])
        self.assertEqual(verdict, "SAFE")
        self.assertEqual([c[1] for c in reasons], ["5"],
                         "the community row must not reach refresh_one_safe_town's safe_routes")

    def test_the_reasons_are_the_rows_themselves_not_a_summary(self):
        """`main()` unpacks them as `for tag, r, msg in reasons`, and
        `refresh_one_safe_town` takes `c[1]` as a route. A reason that were a
        string, or a pair, would fail there and not here."""
        rows = [change("OPERATOR", "5", "shipped 'A' vs BODS 'B'")]
        self.assertEqual(ar.classify(rows)[1], rows)


class TagsTheReportCanEmit(unittest.TestCase):
    """The join: every tag the report can produce is DECIDED, not defaulted.

    Derived from `gtfs_refresh_report.py`'s own source rather than typed here,
    for the reason `_engine.module_names()` is derived: a hand-kept list cannot
    notice the tag nobody listed, which is the only tag this test exists for.
    """

    def tags(self):
        path = os.path.join(_engine.ENGINE_DIR, "gtfs_refresh_report.py")
        with io.open(path, encoding="utf-8") as fh:
            src = fh.read()
        found = set(re.findall(r'changes\.append\(\(\s*"([A-Z?\-]+)"', src))
        self.assertTrue(found, "no tags found -- the regex has stopped matching the report")
        return found

    def test_the_report_still_emits_the_tags_this_module_reasons_about(self):
        """A control on the instrument above. If this ever shrinks to a handful,
        the regex has drifted and every verdict below is about nothing."""
        self.assertLessEqual({"OPERATOR", "DAYS", "ADD?", "WITHDRAWN?", "RE-EVAL",
                              "COMMUNITY", "NOT-IN-BODS"}, self.tags())

    def test_every_tag_is_either_non_actionable_mechanical_or_escalates(self):
        for tag in sorted(self.tags()):
            verdict, _ = ar.classify([change(tag, "7")])
            if tag in rr.NON_ACTIONABLE:
                self.assertEqual(verdict, "NOTHING", tag)
            elif tag in ar.MECHANICAL:
                self.assertEqual(verdict, "SAFE", tag)
            else:
                self.assertEqual(verdict, "ESCALATE", tag)

    def test_only_the_two_mechanical_tags_can_be_SAFE(self):
        """Stated the other way round, because the assertion above is satisfied
        by a MECHANICAL that has quietly grown a third member."""
        safe = {t for t in self.tags() if ar.classify([change(t, "7")])[0] == "SAFE"}
        self.assertEqual(safe, {"OPERATOR", "DAYS"})


class PatchVerifiedServices(unittest.TestCase):
    """What the SAFE path is allowed to write into a town's own service file."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="auto-refresh-test-")
        self.path = os.path.join(self.dir, "verified-services.json")
        self.doc = {
            "verifiedOn": "2026-08-01",
            "services": [
                {"route": "5", "operator": "Old Buses", "days": "Mon-Fri", "termini": ["A", "B"]},
                {"route": "66", "operator": "Other Buses", "days": "Mon-Sat"},
                {"route": "V1", "operator": "Villager Community Bus", "days": "Tue"},
            ],
        }
        with io.open(self.path, "w", encoding="utf-8") as fh:
            json.dump(self.doc, fh)

    def patch(self, safe_routes, new_values):
        return ar.patch_verified_services(self.path, safe_routes, new_values)

    def test_it_patches_operator_and_days_for_a_safe_route(self):
        vs, touched = self.patch({"5"}, {"5": ("New Buses", "Mon-Sat")})
        svc = vs["services"][0]
        self.assertEqual((svc["operator"], svc["days"]), ("New Buses", "Mon-Sat"))
        self.assertEqual(touched, [("5", "operator"), ("5", "days")])

    def test_it_reports_only_the_field_that_actually_moved(self):
        _, touched = self.patch({"5"}, {"5": ("Old Buses", "Mon-Sat")})
        self.assertEqual(touched, [("5", "days")],
                         "an unchanged operator must not be reported as touched -- the note "
                         "written into the S1 commit is built from this list")

    def test_a_route_outside_safe_routes_is_untouched(self):
        vs, touched = self.patch({"5"}, {"5": ("New Buses", "Mon-Fri"),
                                         "66": ("Someone Else", "Daily")})
        self.assertEqual(vs["services"][1], self.doc["services"][1])
        self.assertEqual(touched, [("5", "operator")])

    def test_a_safe_route_the_fresh_pull_does_not_carry_is_skipped(self):
        """The NOT-IN-BODS shape: a route can reach `safe_routes` and have no new
        value at all, because `gtfs_operator_and_days` only knows routes the feed
        still carries. Skipped, never patched with a blank."""
        vs, touched = self.patch({"66"}, {"5": ("New Buses", "Mon-Fri")})
        self.assertEqual(touched, [])
        self.assertEqual(vs["services"], self.doc["services"])

    def test_nothing_but_operator_and_days_is_ever_written(self):
        vs, _ = self.patch({"5"}, {"5": ("New Buses", "Daily")})
        before = dict(self.doc["services"][0])
        after = dict(vs["services"][0])
        for k in set(before) | set(after):
            if k in ("operator", "days"):
                continue
            self.assertEqual(after.get(k), before.get(k), k)

    def test_the_file_on_disk_is_not_written(self):
        """It returns the patched document; `refresh_one_safe_town` writes it into
        a NEW dated S1 folder. A function that wrote in place would edit a
        committed run."""
        self.patch({"5"}, {"5": ("New Buses", "Daily")})
        with io.open(self.path, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh), self.doc)


class PatchRoutesJson(unittest.TestCase):
    """What the SAFE path is allowed to write into a committed S3 config.

    Its own docstring says "mechanical only -- never touches palette/layout/
    geometry keys, so this can't move a line, add a colour, or change what's
    drawn". That sentence is the assertion in `test_no_drawing_key_is_touched`.
    """

    def routes(self):
        return {
            "town": "March",
            "palette": ["#111111", "#222222"],
            "routeOrder": ["5", "66", "V1"],
            "externalLayout": "radial",
            "frequency": {"5": "frequent"},
            "operators": [
                {"name": "Old Buses", "routes": ["5", "66"]},
                {"name": "Third Buses", "routes": ["9"]},
            ],
            "external": [
                {"route": "5", "days": "Mon-Fri"},
                {"route": "66", "days": "Mon-Sat"},
            ],
        }

    def test_a_route_moves_to_an_existing_operator_entry(self):
        r = self.routes()
        touched = ar.patch_routes_json(r, {"5"}, {"5": ("Third Buses", "Mon-Fri")})
        names = {o["name"]: o["routes"] for o in r["operators"]}
        self.assertEqual(names["Old Buses"], ["66"])
        self.assertEqual(names["Third Buses"], ["9", "5"])
        self.assertIn(("5", "operators[]", "Third Buses"), touched)

    def test_an_operator_nobody_has_yet_is_created(self):
        r = self.routes()
        ar.patch_routes_json(r, {"5"}, {"5": ("Brand New Buses", "Mon-Fri")})
        names = {o["name"]: o["routes"] for o in r["operators"]}
        self.assertEqual(names["Brand New Buses"], ["5"])

    def test_an_operator_left_with_no_routes_is_dropped(self):
        r = self.routes()
        ar.patch_routes_json(r, {"9"}, {"9": ("Old Buses", "Mon-Fri")})
        names = [o["name"] for o in r["operators"]]
        self.assertNotIn("Third Buses", names,
                         "an operator entry with an empty routes[] prints an empty Key row")

    def test_a_route_already_under_the_right_operator_is_left_alone(self):
        r = self.routes()
        before = copy.deepcopy(r)
        touched = ar.patch_routes_json(r, {"5"}, {"5": ("Old Buses", "Mon-Fri")})
        self.assertEqual([t for t in touched if t[1] == "operators[]"], [])
        self.assertEqual(r["operators"], before["operators"])

    def test_external_days_are_updated_for_a_safe_route_only(self):
        r = self.routes()
        touched = ar.patch_routes_json(r, {"5"}, {"5": ("Old Buses", "Daily"),
                                                  "66": ("Other", "Daily")})
        days = {e["route"]: e["days"] for e in r["external"]}
        self.assertEqual(days, {"5": "Daily", "66": "Mon-Sat"})
        self.assertIn(("5", "external[].days", "Daily"), touched)

    def test_a_safe_route_the_fresh_pull_does_not_carry_is_skipped(self):
        r = self.routes()
        before = copy.deepcopy(r)
        self.assertEqual(ar.patch_routes_json(r, {"66"}, {}), [])
        self.assertEqual(r, before)

    def test_no_drawing_key_is_touched(self):
        r = self.routes()
        before = copy.deepcopy(r)
        ar.patch_routes_json(r, {"5"}, {"5": ("Third Buses", "Daily")})
        for k in before:
            if k in ("operators", "external"):
                continue
            self.assertEqual(r[k], before[k], k)

    def test_a_config_with_no_operators_or_external_does_not_raise(self):
        """Both keys are optional in a real routes.json, and a place config has
        neither. A crash here would abort a refresh half-way through S3."""
        r = {"town": "Somewhere"}
        self.assertEqual(ar.patch_routes_json(r, {"5"}, {"5": ("A", "Daily")}), [])


class Slugify(unittest.TestCase):
    """The town name -> portal map slug join. A wrong slug points
    `propose-update.mjs` at another customer's map, or at none."""

    def test_the_shapes_the_estate_actually_holds(self):
        self.assertEqual(ar.slugify("March"), "march")
        self.assertEqual(ar.slugify("St Ives"), "st-ives")
        self.assertEqual(ar.slugify("High Wycombe"), "high-wycombe")

    def test_it_never_returns_a_leading_or_trailing_separator(self):
        for name in ("March", "St Ives", " Ramsey ", "Ely Co-op"):
            s = ar.slugify(name)
            self.assertFalse(s.startswith("-") or s.endswith("-"), name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
