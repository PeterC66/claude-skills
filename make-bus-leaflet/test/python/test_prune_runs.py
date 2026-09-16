"""prune_runs.py -- the rules that decide which dated run folders are DELETED.

This module is the one place in the engine whose faults are irreversible. Its
own docstring says so: most of S4/S5 is git-ignored, so `--apply` on those
stages is permanent, and the only other copy is a mirror that is current-state
only. Nothing else here can destroy work.

WHY IT HAD NO TEST UNTIL NOW, AND WHY THAT IS THE WORST CASE. It runs from a
person's hand, occasionally, against a tree no fixture can hold; every other
Python module in `assets/` is at least driven by a monthly refresh or a build.
So the byte gates cannot see it -- there is no output to compare -- and neither
can any harness that starts from a map. It was already IN
`tools/prove-red-python.py` on 2026-09-11, but only as the VICTIM file of two
mutations aimed at other suites: the import-rename case that `test_module_load`
catches, and the undeclared-dependency case that `test_dependencies` catches.
Both ask whether the file loads. Neither asks what it decides.

WHAT IT DECIDES, AND WHAT GETTING IT WRONG HAS ALREADY COST. On 2026-08-27 the
rule "keep only the newest S6 run per town", run estate-wide, named NINE S6
folders for deletion and SEVEN of them held a `redteam.json` -- the blind red
team's answer, 89k-137k tokens each, the one artefact in a run folder that
cannot be rebuilt at any price. `S6-verify` went into `NEVER_PRUNE` that day.
The whole of that fix is one tuple, and until this file nothing anywhere would
have noticed it being edited back.

Every case below is a stub: a list of `(name, version, stamp)` triples for the
planner, or a throwaway directory tree for the three functions that walk a disk.
Not one of them reads the Buses folder, for `prove-red-route-collision.py`'s
reason -- an assertion about a real tree is an assertion about what somebody
happened to build that week.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

import _engine

pr = _engine.load("prune_runs")


def runs(*names):
    """The planner's input shape, derived from the folder names themselves.

    Derived rather than typed a second time: `RUN_RE` is what `main()` uses to
    turn a directory listing into this triple, so a case that hand-built the
    version and stamp would be testing the planner against a parse the tool does
    not perform. A name the real regex rejects raises here rather than quietly
    becoming a case about nothing.
    """
    out = []
    for n in names:
        m = pr.RUN_RE.match(n)
        if not m:
            raise AssertionError("fixture name is not a run folder: %r" % n)
        out.append((n, m.group(1), m.group(2)))
    return out


class NeverPruned(unittest.TestCase):
    """The two stages no rule may reach, and the money is in the second one."""

    def test_every_S6_run_is_kept_however_many_there_are(self):
        """The 2026-08-27 fault, stated as an assertion.

        Seven of the nine folders that rule named held a bought red-team answer.
        Five runs here rather than two, because every other output rule in this
        file keeps at least one -- a fixture of one run would pass under the
        very rule this test exists to refuse.
        """
        plan = pr.plan_stage("S6-verify", runs(
            "2026-08-27_0501", "2026-09-01_0930", "2026-09-06_1122",
            "2026-09-11_0740", "2026-09-13_0518"), 3, 2)
        self.assertEqual(len(plan), 5)
        self.assertEqual({v for v, _ in plan.values()}, {"keep"})

    def test_the_reason_given_for_keeping_S6_names_the_file_that_cannot_be_rebuilt(self):
        """A reader of the dry run has to be told WHY, or the rule looks arbitrary."""
        plan = pr.plan_stage("S6-verify", runs("2026-09-13_0518"), 3, 2)
        self.assertIn("redteam.json", plan["2026-09-13_0518"][1])

    def test_every_S3_run_is_kept(self):
        """S3 is the judgement -- routes.json, the colours, the per-town edits."""
        plan = pr.plan_stage("S3-config", runs(
            "2026-07-02_0900", "2026-08-02_0900", "2026-09-02_0900",
            "2026-09-12_0900"), 3, 2)
        self.assertEqual({v for v, _ in plan.values()}, {"keep"})

    def test_a_versioned_S6_run_is_kept_too(self):
        """S6 folders are unversioned today; the rule must not depend on that."""
        plan = pr.plan_stage("S6-verify", runs(
            "v1.19_2026-09-01_0930", "v1.20_2026-09-13_0518"), 3, 2)
        self.assertEqual({v for v, _ in plan.values()}, {"keep"})

    def test__latest_is_not_a_run_folder(self):
        plan = pr.plan_stage("_latest", runs("2026-09-13_0518"), 3, 2)
        self.assertEqual(plan["2026-09-13_0518"][0], "keep")


class InputStages(unittest.TestCase):
    """S1 and S2 are tracked, so the rule is allowed to be blunt -- but it is counted."""

    def test_the_newest_keep_inputs_runs_survive_and_the_rest_do_not(self):
        plan = pr.plan_stage("S1-services", runs(
            "2026-06-05_1100", "2026-07-12_1100", "2026-08-10_1100",
            "2026-08-20_1100", "2026-09-11_1100"), 3, 2)
        kept = sorted(n for n, (v, _) in plan.items() if v == "keep")
        self.assertEqual(kept, ["2026-08-10_1100", "2026-08-20_1100", "2026-09-11_1100"])
        self.assertEqual(len(plan), 5)

    def test_keep_inputs_is_honoured_rather_than_assumed(self):
        """Two callers pass a non-default value; a hard-coded 3 would be silent."""
        plan = pr.plan_stage("S2-geometry", runs(
            "2026-06-05_1100", "2026-07-12_1100", "2026-08-10_1100"), 1, 2)
        kept = [n for n, (v, _) in plan.items() if v == "keep"]
        self.assertEqual(kept, ["2026-08-10_1100"])

    def test_fewer_runs_than_the_rule_keeps_prunes_nothing(self):
        plan = pr.plan_stage("S1-services", runs("2026-09-11_1100"), 3, 2)
        self.assertEqual(plan["2026-09-11_1100"][0], "keep")


class OutputStages(unittest.TestCase):
    """S4 and S5 are git-ignored, so every verdict here is permanent."""

    def test_the_newest_keep_outputs_VERSIONS_survive_not_the_newest_runs(self):
        """The rule counts versions, not folders -- five runs, three versions, two kept."""
        plan = pr.plan_stage("S4-generate", runs(
            "v1.18_2026-08-01_0900", "v1.19_2026-08-11_0900",
            "v1.19_2026-08-12_0900", "v1.20_2026-09-01_0900",
            "v1.20_2026-09-02_0900"), 3, 2)
        kept = sorted(n for n, (v, _) in plan.items() if v == "keep")
        self.assertEqual(kept, ["v1.19_2026-08-12_0900", "v1.20_2026-09-02_0900"])

    def test_an_older_run_of_a_kept_version_is_pruned_as_a_re_run(self):
        plan = pr.plan_stage("S5-render", runs(
            "v1.20_2026-09-01_0900", "v1.20_2026-09-02_0900"), 3, 2)
        self.assertEqual(plan["v1.20_2026-09-01_0900"][0], "prune")
        self.assertIn("re-run", plan["v1.20_2026-09-01_0900"][1])

    def test_a_dropped_version_says_so_rather_than_calling_itself_a_re_run(self):
        """The two prune reasons are the operator's only clue which rule fired."""
        plan = pr.plan_stage("S4-generate", runs(
            "v1.18_2026-08-01_0900", "v1.19_2026-08-11_0900",
            "v1.20_2026-09-01_0900"), 3, 2)
        self.assertEqual(plan["v1.18_2026-08-01_0900"][0], "prune")
        self.assertIn("older than", plan["v1.18_2026-08-01_0900"][1])

    def test_version_10_is_newer_than_version_9_and_not_older(self):
        """A string sort puts v1.10 before v1.9 and deletes the current sheet.

        The estate is past v1.9 on several maps, so this is live rather than
        hypothetical: St Ives is on v10.x and Ermine Street on v1.20.
        """
        plan = pr.plan_stage("S4-generate", runs(
            "v1.9_2026-08-01_0900", "v1.10_2026-09-01_0900"), 3, 1)
        self.assertEqual(plan["v1.10_2026-09-01_0900"][0], "keep")
        self.assertEqual(plan["v1.9_2026-08-01_0900"][0], "prune")

    def test_unversioned_runs_are_one_version_between_them(self):
        """Place stages write undated-version folders; they must not each count as a version."""
        plan = pr.plan_stage("S4-generate", runs(
            "2026-08-01_0900", "2026-08-02_0900", "2026-08-03_0900"), 3, 2)
        kept = [n for n, (v, _) in plan.items() if v == "keep"]
        self.assertEqual(kept, ["2026-08-03_0900"])


class VersionKey(unittest.TestCase):
    """The comparison the rule above rests on, asked directly."""

    def test_it_is_numeric_and_not_lexical(self):
        self.assertGreater(pr.version_key("v1.10"), pr.version_key("v1.9"))
        self.assertGreater(pr.version_key("v2.0"), pr.version_key("v1.99"))
        self.assertGreater(pr.version_key("v10.1"), pr.version_key("v9.9"))

    def test_an_unversioned_run_sorts_below_every_version(self):
        self.assertEqual(pr.version_key(None), (0, 0))
        self.assertLess(pr.version_key(None), pr.version_key("v1.0"))


class RunFolderNames(unittest.TestCase):
    """What `main()` will and will not treat as a run, before any rule is applied."""

    def test_a_versioned_run_folder_yields_its_version_and_stamp(self):
        m = pr.RUN_RE.match("v1.20_2026-09-14_1020")
        self.assertEqual((m.group(1), m.group(2)), ("v1.20", "2026-09-14_1020"))

    def test_an_unversioned_run_folder_yields_no_version(self):
        m = pr.RUN_RE.match("2026-09-14_1020")
        self.assertIsNone(m.group(1))
        self.assertEqual(m.group(2), "2026-09-14_1020")

    def test_folders_that_are_not_runs_are_not_matched(self):
        """Anything unmatched is skipped entirely, which is the safe direction."""
        for name in ("_latest", "S4-generate", "2026-09-14", "notes",
                     "v1.20_2026-09-14_1020_old", "ci-reference"):
            self.assertIsNone(pr.RUN_RE.match(name), name)


class Pins(unittest.TestCase):
    """A pin is how something OUTSIDE this folder says "do not delete that"."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="prune-pins-")
        self.addCleanup(shutil.rmtree, self.root, True)

    def write_pins(self, data):
        with io.open(os.path.join(self.root, "retention-pins.json"), "w",
                     encoding="utf-8") as fh:
            fh.write(json.dumps(data))

    def make(self, rel):
        os.makedirs(os.path.join(self.root, rel))

    def test_no_pins_file_is_not_an_error(self):
        self.assertEqual(pr.load_pins(self.root), set())

    def test_a_pin_that_names_a_run_that_exists_is_returned(self):
        self.make(os.path.join("Areas", "St Ives", "S5-render", "v6.21_2026-08-08_0508"))
        self.write_pins({"pins": [{"path": "Areas/St Ives/S5-render/v6.21_2026-08-08_0508",
                                   "why": "the portal FIXTURE_DIR"}]})
        pins = pr.load_pins(self.root)
        self.assertEqual(
            pins, {os.path.normpath("Areas/St Ives/S5-render/v6.21_2026-08-08_0508")})

    def test_a_pin_that_names_a_run_that_is_GONE_stops_the_run(self):
        """The 2026-09-02 fault: a stale pin protects nothing and says nothing.

        The pin named an August render while the portal's FIXTURE_DIR had moved
        twice and become a list of three, so the two beside it were guarded by
        nobody. Exiting is the whole fix -- a warning here would be read past.
        """
        self.write_pins({"pins": [{"path": "Areas/St Ives/S5-render/v6.21_2026-08-08_0508",
                                   "why": "the portal FIXTURE_DIR"}]})
        err = io.StringIO()
        saved, sys.stderr = sys.stderr, err
        try:
            with self.assertRaises(SystemExit) as ctx:
                pr.load_pins(self.root)
        finally:
            sys.stderr = saved
        self.assertEqual(ctx.exception.code, 1)
        self.assertIn("not there", err.getvalue())

    def test_a_printed_edition_is_pinned_as_firmly_as_a_pin(self):
        """`printed.editions` is a second list in the same file and is easy to miss."""
        self.make(os.path.join("Areas", "March", "S5-render", "v2.0_2026-06-05_1100"))
        self.write_pins({"pins": [],
                         "printed": {"editions": [
                             {"path": "Areas/March/S5-render/v2.0_2026-06-05_1100"}]}})
        self.assertIn(os.path.normpath("Areas/March/S5-render/v2.0_2026-06-05_1100"),
                      pr.load_pins(self.root))


class WhatGitKnows(unittest.TestCase):
    """The accounting that tells the operator what is recoverable.

    Its whole reason for existing is that the sentence it prints used to be a
    hard-coded claim, and for a few hours on 2026-08-28 it was false while 161
    tracked files sat inside the folders this tool deletes.
    """

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="prune-git-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.run_dir = os.path.join(self.root, "Areas", "Ely", "S6-verify", "2026-09-13_0518")
        os.makedirs(self.run_dir)
        self.write("redteam.json", "x" * 400)
        self.write("verification.json", "y" * 100)

    def write(self, name, body):
        with io.open(os.path.join(self.run_dir, name), "w", encoding="utf-8") as fh:
            fh.write(body)

    def rel(self, name):
        return os.path.normpath(os.path.join("Areas", "Ely", "S6-verify",
                                             "2026-09-13_0518", name))

    def test_a_tracked_file_is_counted_as_recoverable(self):
        t_bytes, u_bytes, t_files = pr.dir_split(
            self.run_dir, self.root, {self.rel("redteam.json")})
        self.assertEqual((t_bytes, u_bytes, t_files), (400, 100, 1))

    def test_could_not_look_is_not_the_same_as_nothing_is_tracked(self):
        """`tracked=None` must report every byte as UNRECOVERABLE, never as safe.

        The caller prints UNKNOWN off this, so the direction matters: the honest
        failure is to overstate the loss, and the fault being guarded against is
        a tool reassuring an operator about something it never checked.
        """
        t_bytes, u_bytes, t_files = pr.dir_split(self.run_dir, self.root, None)
        self.assertEqual((t_bytes, t_files), (0, 0))
        self.assertEqual(u_bytes, 500)

    def test_git_that_cannot_answer_returns_None_rather_than_an_empty_set(self):
        """A temporary folder is in no repository, which is the refusal case.

        An empty set would mean "git tracks nothing here" and would make the
        summary claim every byte is unrecoverable as a MEASUREMENT rather than
        as an admission -- the same sentence, with the caveat gone.
        """
        self.assertIsNone(pr.tracked_paths(self.root))


class Builds(unittest.TestCase):
    """Which folders are subjects at all -- the walk that finds the maps."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="prune-builds-")
        self.addCleanup(shutil.rmtree, self.root, True)

    def build(self, *parts):
        d = os.path.join(self.root, *parts)
        os.makedirs(d)
        with io.open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as fh:
            fh.write("{}")
        return d

    def test_a_town_a_nested_place_and_a_standalone_place_are_all_found(self):
        """Twelve of the estate's place maps are nested under a town, three are not."""
        self.build("Areas", "St Neots")
        self.build("Areas", "St Neots", "Places", "St Neots Co-op")
        self.build("Places", "_standalone", "High Wycombe Aldi")
        found = {os.path.relpath(p, self.root) for p in pr.find_builds(self.root)}
        self.assertEqual(found, {
            os.path.join("Areas", "St Neots"),
            os.path.join("Areas", "St Neots", "Places", "St Neots Co-op"),
            os.path.join("Places", "_standalone", "High Wycombe Aldi")})

    def test_the_walk_does_not_descend_into_a_found_build_except_for_Places(self):
        """A run folder that happens to hold a manifest must not become a build."""
        town = self.build("Areas", "March")
        stray = os.path.join(town, "S4-generate", "v2.0_2026-06-05_1100")
        os.makedirs(stray)
        with io.open(os.path.join(stray, "manifest.json"), "w", encoding="utf-8") as fh:
            fh.write("{}")
        found = {os.path.relpath(p, self.root) for p in pr.find_builds(self.root)}
        self.assertEqual(found, {os.path.join("Areas", "March")})

    def test_a_tree_with_no_maps_finds_none_and_does_not_raise(self):
        self.assertEqual(pr.find_builds(self.root), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
