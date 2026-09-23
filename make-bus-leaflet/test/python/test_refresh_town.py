"""refresh_town.py -- every way the SAFE monthly refresh REFUSES, and what it leaves behind.

WHY THIS FILE, WHEN `tools/prove-red-refresh-town.py` ALREADY EXISTS. That harness
proves the DECISIONS -- what is SAFE, what may be patched, what a label may change --
by calling the helper functions directly. It says in its own docstring that the
S1-S3-S4-S5 chain in `main()` is not in it, because driving the chain needs the feed
and a town tree. But `main()` is where every refusal is raised, and it is the part a
scheduled tick runs with nobody watching (buses-data OA-426, OA-457). A refusal that
stopped refusing would not fail loudly: it would commit a patched service list over a
sheet that disagrees with it, which is the state the whole module is written to
prevent. So this file drives `main()` end to end with the stage engine, the build, the
renderer and the label diff STUBBED, and asserts two things of each refusal: that it
is raised, and that nothing was committed before it.

THE ORDER IS PART OF THE CONTRACT. `main()` builds S4 first and commits S1, S3, S4 and
S5 only after the sheets have been read, because the first version committed S1 and
S3 and then refused on labels, leaving a map whose data and sheets disagreed. Every
refusal below that happens after the build therefore asserts that no `commit` call was
made, and the happy path asserts the commit order.

Nothing here reads the Buses folder or a GTFS dataset. Every case builds a throwaway
town tree in its own scratch directory under `busmaps-scratch`, for claude-skills
#59's reason: a test that wrote beside the engine left files that the next test run
then read as part of it.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

import _engine

rt = _engine.load("refresh_town")

TOWN = "Testtown"
OLD_OP = "Old Buses Ltd"
NEW_OP = "New Buses Ltd"


def scratch(prefix):
    root = os.path.join(tempfile.gettempdir(), "busmaps-scratch")
    os.makedirs(root, exist_ok=True)
    return tempfile.mkdtemp(prefix=prefix, dir=root)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


class FakeStage(object):
    """stage.js, as the calls `main()` makes of it, recorded in order.

    `new` makes a real folder, because `main()` writes routes.json and
    verified-services.json into what it is given. `latest` answers from the fixture.
    Everything else is recorded and succeeds.
    """

    def __init__(self, town_dir, latest):
        self.town_dir = town_dir
        self.latest = latest
        self.calls = []
        self.n = 0

    def __call__(self, town_dir, *args):
        self.calls.append(tuple(args))
        verb = args[0]
        if verb == "latest":
            return self.latest[args[1]]
        if verb == "new":
            self.n += 1
            d = os.path.join(town_dir, "new-%s-%d" % (args[1], self.n))
            os.makedirs(d)
            return d
        return ""

    def verbs(self, verb):
        return [c for c in self.calls if c[0] == verb]

    def committed(self):
        return [c[1] for c in self.verbs("commit")]


class Town(unittest.TestCase):
    """A town with one route, 32, whose operator the feed has renamed.

    The shipped service list, the S3 routes.json and the previous S4 all say OLD_OP,
    which is what the feed said at the last verification -- so the value is OURS and a
    SAFE refresh may change it. A case that needs a person's wording in the config
    layer overwrites one field.
    """

    def setUp(self):
        self.root = scratch("refresh-town-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.town_dir = os.path.join(self.root, "Areas", TOWN)
        self.vs_path = os.path.join(self.town_dir, "S1-services", "2026-09-01_0900",
                                    "verified-services.json")
        write_json(self.vs_path, {"services": [
            {"route": "32", "operator": OLD_OP, "days": "Mon-Sat"},
            {"route": "9", "operator": "Somebody Else", "days": "Sun"},
        ]})
        self.prev_s3 = os.path.join(self.town_dir, "S3-config", "2026-09-01_0910")
        write_json(os.path.join(self.prev_s3, "routes.json"), {
            "routeOrder": ["9", "32"],
            "operators": [{"name": OLD_OP, "routes": ["32"]},
                          {"name": "Somebody Else", "routes": ["9"]}],
            "external": [{"route": "32", "days": "Mon-Sat"}],
        })
        self.prev_s4 = os.path.join(self.town_dir, "S4-generate", "2026-09-01_0920")
        write_json(os.path.join(self.prev_s4, "routes.json"), {"engine": {"hash": "eng-1"}})
        self.prev_s2 = os.path.join(self.town_dir, "S2-geometry", "2026-09-01_0905")
        os.makedirs(self.prev_s2)

        self.stage = FakeStage(self.town_dir, {"S2": self.prev_s2, "S3": self.prev_s3,
                                               "S4": self.prev_s4})
        self.changes = [("OPERATOR", "32", "operator %s -> %s" % (OLD_OP, NEW_OP))]
        self.feed = {"32": (NEW_OP, "Mon-Sat"), "9": ("Somebody Else", "Sun")}
        self.build_rc = 0
        self.render_fails = set()
        self.label = {"missing": [], "lost": ["32  " + OLD_OP], "gained": ["32  " + NEW_OP],
                      "rewrapped": []}
        self.engine_now = "eng-1"
        self.ran = []
        self.no_shipped_list = False

    # ------------------------------------------------------------------ the stubs
    def fake_run(self, cmd, *a, **k):
        script = os.path.basename(cmd[1]) if len(cmd) > 1 else ""
        self.ran.append(script)
        if script == "build_s4.js":
            return subprocess.CompletedProcess(cmd, self.build_rc,
                                               stdout="--outputs internal.svg,external.svg\n",
                                               stderr="blocked" if self.build_rc else "")
        if script == "render.js":
            svg = os.path.basename(cmd[2])
            rc = 1 if svg in self.render_fails else 0
            return subprocess.CompletedProcess(cmd, rc, stdout="", stderr="render broke" if rc else "")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    def fake_locate(self, root, town, db_override=None):
        return {"db": "fixture.sqlite", "region": "fixture"}, TOWN, {"prefixes": []}

    def run_main(self, *extra, locate=True):
        argv = ["--town", TOWN, "--root", self.root] + list(extra)
        patches = [
            mock.patch.object(rt, "stage", self.stage),
            mock.patch.object(rt.rr, "diff_town",
                              lambda *a, **k: None if self.no_shipped_list else {"changes": self.changes}),
            mock.patch.object(rt, "gtfs_operator_and_days", lambda *a, **k: self.feed),
            mock.patch.object(rt, "current_engine_hash", lambda: self.engine_now),
            mock.patch.object(rt, "label_diff", lambda old, new: self.label),
            mock.patch.object(rt.subprocess, "run", self.fake_run),
        ]
        if locate:
            patches.append(mock.patch.object(rt, "locate_town", self.fake_locate))
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        return rt.main(argv)

    def assertRefused(self, *extra, says=(), locate=True):
        with self.assertRaises(rt.Refused) as cm:
            self.run_main(*extra, locate=locate)
        msg = str(cm.exception)
        for phrase in says:
            self.assertIn(phrase, msg)
        return msg

    def assertNothingCommitted(self):
        self.assertEqual(self.stage.committed(), [],
                         "a refusal after a commit leaves the town half-refreshed")
        self.assertEqual(read_json(self.vs_path)["services"][0]["operator"], OLD_OP,
                         "the shipped service list was rewritten in place")

    def write_sidecar(self, date, towns=None, not_checked=None, schema=None):
        write_json(os.path.join(self.root, "_gtfs", "refresh-grades_%s.json" % date), {
            "schema": rt.GRADES_SCHEMA if schema is None else schema,
            "towns": towns or {},
            "notChecked": not_checked or [],
        })


class BeforeTheFeed(Town):
    """Refusals that happen before anything is diffed."""

    def test_a_town_with_no_Areas_folder_is_refused_and_pointed_at_draft_town(self):
        shutil.rmtree(self.town_dir)
        self.assertRefused(says=("no Areas/%s" % TOWN, "draft_town.py"), locate=False)

    def test_a_town_the_scan_could_not_check_is_refused_by_name(self):
        write_json(os.path.join(self.root, "_gtfs", "town_prefixes.json"), {})
        with mock.patch.object(rt.greg, "plan", lambda *a: ([], [(TOWN, "no sqlite")])):
            self.assertRefused(says=("NOT CHECKED", "no sqlite"), locate=False)

    def test_a_town_no_group_knows_is_refused_rather_than_guessed(self):
        write_json(os.path.join(self.root, "_gtfs", "town_prefixes.json"), {})
        other = {"db": "x", "towns": [("Elsewhere", {})]}
        with mock.patch.object(rt.greg, "plan", lambda *a: ([other], [])):
            self.assertRefused(says=("in no group",), locate=False)

    def test_a_town_with_no_shipped_service_list_is_refused(self):
        self.no_shipped_list = True
        self.assertRefused(says=("no shipped verified-services.json",))


class TheGrade(Town):
    """SAFE is the only grade this applies, and the board's grade is checked, not trusted."""

    def test_an_ESCALATE_town_is_refused_before_the_stage_engine_is_touched(self):
        self.changes.append(("ADD?", "99", "a new route"))
        self.assertRefused(says=("grades ESCALATE", "by hand"))
        self.assertEqual(self.stage.calls, [])

    def test_a_town_with_nothing_actionable_returns_NOTHING_and_writes_nothing(self):
        self.changes = []
        res = self.run_main("--apply")
        self.assertEqual(res["status"], "NOTHING")
        self.assertEqual(self.stage.calls, [])

    def test_a_sidecar_that_graded_the_town_otherwise_is_a_refusal(self):
        self.write_sidecar("2026-10-01", towns={TOWN: {"grade": "ESCALATE"}})
        self.assertRefused("--apply", "--scan", "2026-10-01", says=("says %s is ESCALATE" % TOWN,))
        self.assertNothingCommitted()

    def test_a_sidecar_that_could_not_check_the_town_is_a_refusal(self):
        self.write_sidecar("2026-10-01", not_checked=[{"town": TOWN, "reason": "feed missing"}])
        self.assertRefused("--apply", "--scan", "2026-10-01", says=("could not check", "feed missing"))
        self.assertNothingCommitted()

    def test_a_sidecar_from_another_scan_is_reported_and_not_obeyed(self):
        """An older grading says nothing about today's changes, in either direction."""
        self.write_sidecar("2026-09-01", towns={TOWN: {"grade": "ESCALATE"}})
        res = self.run_main("--scan", "2026-10-01")
        self.assertEqual(res["status"], "WOULD-APPLY")
        self.assertEqual(res["sidecar"], "none")

    def test_a_sidecar_that_agrees_lets_the_run_through(self):
        self.write_sidecar("2026-10-01", towns={TOWN: {"grade": "SAFE"}})
        res = self.run_main("--scan", "2026-10-01")
        self.assertEqual(res["status"], "WOULD-APPLY")
        self.assertEqual(res["sidecarGrade"], "SAFE")


class ThePatch(Town):
    """What the patch may touch, and the dry run that touches nothing."""

    def test_a_persons_wording_in_routes_json_is_a_conflict_and_nothing_is_written(self):
        routes = read_json(os.path.join(self.prev_s3, "routes.json"))
        routes["operators"][0]["name"] = "Old Buses (as the town writes it)"
        write_json(os.path.join(self.prev_s3, "routes.json"), routes)
        self.assertRefused("--apply", says=("written by a person", "Old Buses (as the town writes it)"))
        self.assertEqual(self.stage.verbs("new"), [])
        self.assertNothingCommitted()

    def test_files_already_carrying_the_feeds_values_are_NOTHING_TO_PATCH(self):
        self.feed["32"] = (OLD_OP, "Mon-Sat")
        res = self.run_main("--apply")
        self.assertEqual(res["status"], "NOTHING-TO-PATCH")
        self.assertEqual(self.stage.verbs("new"), [])

    def test_without_apply_it_is_a_dry_run_that_creates_and_commits_nothing(self):
        res = self.run_main()
        self.assertEqual(res["status"], "WOULD-APPLY")
        self.assertFalse(res["applied"])
        self.assertEqual(self.stage.verbs("new"), [])
        self.assertNotIn("build_s4.js", self.ran)
        self.assertNothingCommitted()


class TheBuild(Town):
    """Everything after S4 is built and BEFORE it is committed."""

    def test_blocking_build_warnings_refuse_and_commit_nothing(self):
        self.build_rc = 3
        self.assertRefused("--apply", says=("blocking warnings", "build-warnings.txt", "NOT committed"))
        self.assertNothingCommitted()

    def test_a_failed_build_refuses_and_commits_nothing(self):
        self.build_rc = 1
        self.assertRefused("--apply", says=("build_s4.js failed",))
        self.assertNothingCommitted()

    def test_a_sheet_the_label_diff_could_not_read_is_a_refusal_not_an_empty_diff(self):
        self.label = {"missing": ["old.svg"], "lost": [], "gained": [], "rewrapped": []}
        self.assertRefused("--apply", says=("cannot compare labels", "old.svg"))
        self.assertNothingCommitted()

    def test_a_label_the_patch_does_not_explain_is_a_refusal(self):
        self.label["gained"].append("Hospital")
        msg = self.assertRefused("--apply", says=("does not account for", "'Hospital'"))
        self.assertNotIn("rollout.js", msg, "the engine did not move, so it must not be blamed")
        self.assertNothingCommitted()

    def test_when_the_engine_moved_the_refusal_says_to_roll_it_out_first(self):
        self.label["gained"].append("Hospital")
        self.engine_now = "eng-2"
        self.assertRefused("--apply", says=("eng-1 -> eng-2", "rollout.js"))
        self.assertNothingCommitted()


class TheCommits(Town):
    """The one path that writes, and the order it writes in."""

    def test_a_sheet_that_fails_to_render_leaves_S5_uncommitted(self):
        self.render_fails = {"external.svg"}
        self.assertRefused("--apply", says=("did not render", "external.svg"))
        self.assertEqual(self.stage.committed(), ["S1", "S3", "S4"])

    def test_a_clean_run_commits_S1_S3_S4_S5_in_that_order_after_the_build(self):
        res = self.run_main("--apply", "--by", "sched-0000")
        self.assertEqual(res["status"], "APPLIED")
        self.assertEqual(self.stage.committed(), ["S1", "S3", "S4", "S5"])
        first_commit = next(i for i, c in enumerate(self.stage.calls) if c[0] == "commit")
        s4_new = next(i for i, c in enumerate(self.stage.calls) if c[:2] == ("new", "S4"))
        self.assertLess(s4_new, first_commit, "S4 must be built before anything is committed")
        self.assertIn("build_s4.js", self.ran)

    def test_the_patched_values_land_in_the_new_runs_and_not_in_the_shipped_ones(self):
        res = self.run_main("--apply")
        vs = read_json(os.path.join(res["s1"], "verified-services.json"))
        self.assertEqual(vs["services"][0]["operator"], NEW_OP)
        self.assertEqual(vs["services"][1]["operator"], "Somebody Else")
        routes = read_json(os.path.join(res["s3"], "routes.json"))
        self.assertEqual([o["name"] for o in routes["operators"]], ["Somebody Else", NEW_OP])
        self.assertEqual(read_json(self.vs_path)["services"][0]["operator"], OLD_OP)

    def test_by_reaches_every_stage_record(self):
        self.run_main("--apply", "--by", "sched-0000")
        for c in self.stage.verbs("new") + self.stage.verbs("commit"):
            self.assertIn("sched-0000", c, "--by missing from %r" % (c,))

    def test_S4_is_committed_with_the_inputs_it_was_built_from(self):
        self.run_main("--apply")
        s4 = [c for c in self.stage.verbs("commit") if c[1] == "S4"][0]
        based = s4[s4.index("--based-on") + 1]
        self.assertTrue(based.startswith("S2=%s;S3=" % os.path.basename(self.prev_s2)), based)


if __name__ == "__main__":
    unittest.main()
