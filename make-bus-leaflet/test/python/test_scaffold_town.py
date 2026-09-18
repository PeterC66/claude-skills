"""scaffold_town.py -- the one command that sets a BRAND-NEW town up, and the one
module whose faults nobody is in a position to notice.

WHY IT HAD NO TEST, AND WHY THAT IS THE BAD CASE. It runs once per town, from a
person's hand, at the moment that person knows least about the town. Everything
afterwards is reviewed: S1 has a human gate, S3 has a palette decision, S4 and S5
are byte-gated, S6 is red-teamed. This runs BEFORE all of that and its output is
the thing the reviewer reviews, so an error here arrives disguised as the
starting position rather than as a fault. The byte gates cannot see it -- it
draws nothing -- and neither can any harness that starts from a built map, which
is `test_prune_runs.py`'s argument in a different module. It has had
`test_module_load.py` since 2026-09-11, which asks whether it imports.

WHAT IT ACTUALLY DOES is shell out four times -- `stage.js init`, `stage.js new
S1`, `bootstrap_town.py`, `gtfs_query.py` -- write one line into
`_gtfs/town_prefixes.json`, and write a review checklist. So every case below
stubs `subprocess` and asserts the COMMANDS, in the same shape
`test_boarding_index.py` drives `main()` through `sys.argv`. Nothing here runs
node, reads a GTFS database or touches the map estate: an assertion about a real
scaffold would be an assertion about whichever town somebody last created.

THE FAULT THIS SUITE WAS WRITTEN AROUND, and it is a three-state one. Step 3
pulls the service facts only `if prefix`, with no `else`; step 4 registered the
town only `if a.town not in tp and prefix`, with a single `else` reading
`"{town} already in town_prefixes.json (or no prefix)"`. So a bootstrap that
found no ATCO prefix -- the one outcome that costs the run its central artefact,
because `gtfs-services.json` is what the S1 review gate is a review OF -- printed
the sentence that a town needing nothing prints. An absence and a refusal shared
one message, which is the shape `check-doc-acronyms.mjs` and the `dirt age`
instrument in `bus-work` are both written about. Split into three here, and both
halves are pinned by `tools/prove-red-python.py`.

ONE LINE IS DELIBERATELY NOT ASSERTED, and the reason is worth more than the
assertion would be. `os.makedirs(town_dir, exist_ok=True)` in step 1 is
redundant: `stage.js` line 345 is `fs.mkdirSync(townDir, {recursive: true})`, so
`init` creates the folder it is given. A test asserting the folder exists before
`init` is called would therefore pin a requirement that does not exist, and the
stub would satisfy it by accident anyway -- `stage.js new` makes the run folder,
which makes the town folder on the way. Measured in `assets/stage.js` rather than
assumed. It is harmless belt-and-braces and left alone.

THE REGISTRATION HALF IS THE BEACONSFIELD FAULT'S GUARD. `region` is written on
the entry whenever the dataset is not the default one, and a dataset in no
registry at all is WARNED about rather than registered silently -- because a town
registered without its region is diffed against the wrong dataset every month and
reports all seven of its routes withdrawn, which is what happened to Beaconsfield
for a month. Three branches, and all three are asserted below.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

import _engine

st = _engine.load("scaffold_town")


class Proc(object):
    """What `subprocess.run(capture_output=True, text=True)` hands back."""

    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class Commands(object):
    """A stand-in for `subprocess`, recording what was asked and faking the effects.

    The effects are the point rather than the recording: `main()` reads
    `routes.draft.json` back off the disk after calling `bootstrap_town.py`, and
    takes the S1 directory from `stage.js new`'s single line of stdout. A stub
    that only recorded would make the module fail at its first read, so each
    fake command writes what the real one would have written -- and nothing else,
    so a test asserting a file exists is asserting that this module asked for it.
    """

    def __init__(self, root, s1dir, draft, fail_on=None, stage_stdout=None):
        self.calls = []
        self.root = root
        self.s1dir = s1dir
        self.draft = draft
        self.fail_on = fail_on
        self.stage_stdout = stage_stdout

    def _inside(self, path):
        """Refuse a path outside this case's own scratch tree.

        Not defensive tidiness: under a mutation run the module can hand the
        stub a directory built from a failed command's STDOUT rather than from
        `stage.js`'s answer, and a stub that obeyed would create
        `test/python/the command's own stdout/` in the repository on every
        `prove-red-python` run -- which is the untracked-sibling litter the
        pre-commit hook warns about, arriving from the harness rather than from
        a person. Raising fails the mutated run exactly as loudly and leaves
        nothing behind.
        """
        full = os.path.abspath(path)
        if not full.startswith(os.path.abspath(self.root) + os.sep):
            raise AssertionError(
                "the module asked the stub to write outside the case's scratch tree: %r" % path)
        return full

    def run(self, cmd, **kw):
        cmd = list(cmd)
        self.calls.append({"cmd": cmd, "cwd": kw.get("cwd")})
        if self.fail_on and any(self.fail_on in str(c) for c in cmd):
            return Proc(2, "the command's own stdout", "the command's own stderr")
        if self._is(cmd, "stage.js") and "init" in cmd:
            return Proc(0, "manifest written")
        if self._is(cmd, "stage.js") and "new" in cmd:
            os.makedirs(self.s1dir, exist_ok=True)
            return Proc(0, self.stage_stdout if self.stage_stdout is not None else self.s1dir)
        if self._is(cmd, "bootstrap_town.py"):
            out = self._inside(self._flag(cmd, "--out"))
            os.makedirs(out, exist_ok=True)
            with io.open(os.path.join(out, "routes.draft.json"), "w", encoding="utf-8") as fh:
                json.dump(self.draft, fh)
            return Proc(0, "bootstrap report written")
        if self._is(cmd, "gtfs_query.py"):
            out = self._inside(self._flag(cmd, "--out"))
            with io.open(out, "w", encoding="utf-8") as fh:
                json.dump({"services": []}, fh)
            return Proc(0, "services written")
        raise AssertionError("the stub was asked for a command it does not know: %r" % (cmd,))

    @staticmethod
    def _is(cmd, name):
        return any(str(c).endswith(name) for c in cmd)

    @staticmethod
    def _flag(cmd, flag):
        return cmd[cmd.index(flag) + 1]

    def named(self, name):
        """Every call whose command names `name`, in the order they were made."""
        return [c for c in self.calls if self._is(c["cmd"], name)]

    def one(self, name):
        got = self.named(name)
        if len(got) != 1:
            raise AssertionError("expected exactly one %s call, got %d" % (name, len(got)))
        return got[0]


class Scaffold(unittest.TestCase):
    """A scratch estate, a scratch `_gtfs/`, and `main()` driven through argv."""

    TOWN = "Newtown"
    PREFIX = "0400"

    def setUp(self):
        root = os.path.join(tempfile.gettempdir(), "busmaps-scratch")
        os.makedirs(root, exist_ok=True)
        self.root = tempfile.mkdtemp(prefix="scaffold-town-", dir=root)
        self.addCleanup(shutil.rmtree, self.root, True)
        self.buses = os.path.join(self.root, "Buses")
        self.gdir = os.path.join(self.buses, "_gtfs")
        os.makedirs(self.gdir)
        self.db = os.path.join(self.gdir, "buckinghamshire.sqlite")
        self.tp_path = os.path.join(self.gdir, "town_prefixes.json")
        self.town_dir = os.path.join(self.buses, self.TOWN)
        self.s1 = os.path.join(self.town_dir, "S1-services", "2026-09-17_1115")

    # -- fixtures -----------------------------------------------------------

    def regions(self, cfg):
        with io.open(os.path.join(self.gdir, "regions.json"), "w", encoding="utf-8") as fh:
            json.dump(cfg, fh)

    def two_regions(self, default="cambridgeshire"):
        self.regions({"_default": default, "regions": {
            "cambridgeshire": {"db": os.path.join(self.gdir, "cambridgeshire.sqlite"),
                               "status": "built"},
            "buckinghamshire": {"db": self.db, "status": "built"}}})

    def prefixes(self, obj):
        with io.open(self.tp_path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh)

    def registered(self):
        with io.open(self.tp_path, encoding="utf-8") as fh:
            return json.load(fh)

    # -- the run ------------------------------------------------------------

    def scaffold(self, draft=None, extra=(), **kw):
        """Run `main()` once. Returns (the recorder, stdout, stderr)."""
        cmds = Commands(self.root, self.s1, {"atcoPrefix": self.PREFIX} if draft is None else draft, **kw)
        argv, sub = sys.argv, st.subprocess
        sys.argv = ["scaffold_town.py", self.TOWN, "--buses-root", self.buses,
                    "--db", self.db] + list(extra)
        st.subprocess = cmds
        out, err = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                st.main()
        finally:
            sys.argv, st.subprocess = argv, sub
        return cmds, out.getvalue(), err.getvalue()


class TheOrderOfOperations(Scaffold):
    """Four commands, and each one needs the one before it to have happened."""

    def setUp(self):
        Scaffold.setUp(self)
        self.two_regions()
        self.prefixes({"St Ives": {"prefixes": ["050"]}})
        self.cmds, self.out, self.err = self.scaffold()

    def test_it_runs_the_four_commands_in_the_only_order_that_works(self):
        """Asserted as the whole sequence rather than four memberships.

        Every dependency here is a real one -- `stage.js new` needs the manifest
        `init` wrote, `bootstrap_town.py` needs the run folder `new` printed, and
        `gtfs_query.py` needs the prefix the bootstrap derived -- so a test that
        only asked whether each was called would pass on a run that made them in
        an order that cannot work.
        """
        order = []
        for c in self.cmds.calls:
            for name in ("stage.js", "bootstrap_town.py", "gtfs_query.py"):
                if Commands._is(c["cmd"], name):
                    order.append(name + (":" + c["cmd"][2] if name == "stage.js" else ""))
        self.assertEqual(order, ["stage.js:init", "stage.js:new",
                                 "bootstrap_town.py", "gtfs_query.py"])

    def test_stage_init_is_told_both_the_folder_and_the_town_name(self):
        cmd = self.cmds.named("stage.js")[0]["cmd"]
        self.assertEqual(cmd[2:], ["init", self.town_dir, self.TOWN])

    def test_stage_new_runs_INSIDE_the_town_folder(self):
        """`stage.js` finds the manifest by walking up from its cwd, so this is
        not tidiness: run from anywhere else it either finds no manifest or finds
        a different town's, and the S1 folder lands in the wrong map."""
        self.assertEqual(self.cmds.named("stage.js")[1]["cwd"], self.town_dir)

    def test_the_s1_folder_is_the_one_stage_printed_and_is_not_reconstructed(self):
        """The path is taken from stdout rather than composed from a date, which
        is what lets `stage.js` own the naming. The bootstrap is handed the same
        string, so the two cannot disagree about where the run is."""
        self.assertEqual(self.cmds.one("bootstrap_town.py")["cmd"][-1], self.s1)

    def test_the_review_checklist_names_the_town_and_the_run_it_belongs_to(self):
        nxt = os.path.join(self.s1, "SCAFFOLD-NEXT.md")
        self.assertTrue(os.path.isfile(nxt))
        with io.open(nxt, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn(self.TOWN, text)
        self.assertIn(self.s1, text)

    def test_the_checklist_still_says_nothing_is_committed(self):
        """The whole contract of this tool: it stops at the review gate. A
        checklist that stopped saying so would be the one thing a person reads
        before deciding whether S1 is done."""
        with io.open(os.path.join(self.s1, "SCAFFOLD-NEXT.md"), encoding="utf-8") as fh:
            self.assertIn("NOTHING is committed yet", fh.read())


class WhatBootstrapIsAsked(Scaffold):
    """The three tunable inputs, and the one that is optional."""

    def setUp(self):
        Scaffold.setUp(self)
        self.two_regions()
        self.prefixes({})

    def test_region_radius_and_database_all_reach_the_bootstrap(self):
        cmds, _, _ = self.scaffold(extra=["--region", "Buckinghamshire", "--radius-km", "2.4"])
        cmd = cmds.one("bootstrap_town.py")["cmd"]
        self.assertEqual(Commands._flag(cmd, "--region"), "Buckinghamshire")
        self.assertEqual(Commands._flag(cmd, "--radius-km"), "2.4")
        self.assertEqual(Commands._flag(cmd, "--db"), self.db)

    def test_a_centre_is_passed_on_when_it_is_given(self):
        cmds, _, _ = self.scaffold(extra=["--centre", "51.6,-0.6"])
        self.assertEqual(Commands._flag(cmds.one("bootstrap_town.py")["cmd"], "--centre"),
                         "51.6,-0.6")

    def test_no_centre_means_no_flag_at_all_rather_than_an_empty_one(self):
        """An empty `--centre ''` would be a geocode of nowhere, which is a
        different thing from letting the bootstrap geocode the name."""
        cmds, _, _ = self.scaffold()
        self.assertNotIn("--centre", cmds.one("bootstrap_town.py")["cmd"])

    def test_gtfs_query_is_asked_for_the_prefix_the_bootstrap_found(self):
        """Not the town name, and not a prefix from anywhere else: the ATCO
        prefix is derived by the bootstrap from the stops it actually saw."""
        cmds, _, _ = self.scaffold(draft={"atcoPrefix": "049"})
        cmd = cmds.one("gtfs_query.py")["cmd"]
        self.assertEqual(cmd[2], "049")
        self.assertEqual(Commands._flag(cmd, "--town"), self.TOWN)
        self.assertEqual(Commands._flag(cmd, "--out"),
                         os.path.join(self.s1, "gtfs-services.json"))


class WhenACommandFails(Scaffold):
    """Four subprocesses, any of which can fail, and the run is worth nothing
    after the first one does -- the S1 folder would be reviewed as if it were
    complete."""

    def setUp(self):
        Scaffold.setUp(self)
        self.two_regions()
        self.prefixes({})

    def test_a_failing_command_stops_the_scaffold_rather_than_carrying_on(self):
        with self.assertRaises(SystemExit) as caught:
            self.scaffold(fail_on="bootstrap_town.py")
        self.assertIn("command failed", str(caught.exception))

    def test_it_stops_at_the_failure_and_does_not_run_the_commands_after_it(self):
        cmds = Commands(self.root, self.s1, {"atcoPrefix": self.PREFIX}, fail_on="bootstrap_town.py")
        argv, sub = sys.argv, st.subprocess
        sys.argv = ["scaffold_town.py", self.TOWN, "--buses-root", self.buses, "--db", self.db]
        st.subprocess = cmds
        try:
            with contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()):
                self.assertRaises(SystemExit, st.main)
        finally:
            sys.argv, st.subprocess = argv, sub
        self.assertEqual(cmds.named("gtfs_query.py"), [])
        self.assertFalse(os.path.exists(os.path.join(self.s1, "SCAFFOLD-NEXT.md")))

    def test_the_failing_command_s_OWN_output_is_what_the_reader_is_shown(self):
        """The message this tool composes says only which command failed. The
        reason is in the child's stdout and stderr, and if those are dropped the
        person is left with `command failed: node .../stage.js new S1` and
        nothing to act on."""
        err = io.StringIO()
        cmds = Commands(self.root, self.s1, {"atcoPrefix": self.PREFIX}, fail_on="stage.js")
        argv, sub = sys.argv, st.subprocess
        sys.argv = ["scaffold_town.py", self.TOWN, "--buses-root", self.buses, "--db", self.db]
        st.subprocess = cmds
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                self.assertRaises(SystemExit, st.main)
        finally:
            sys.argv, st.subprocess = argv, sub
        self.assertIn("the command's own stdout", err.getvalue())
        self.assertIn("the command's own stderr", err.getvalue())


class TheRegistration(Scaffold):
    """`town_prefixes.json` is what the monthly refresh joins a town to its
    dataset on, so every branch here decides whether that town is checked at all,
    and against what."""

    def setUp(self):
        Scaffold.setUp(self)
        self.prefixes({"St Ives": {"prefixes": ["050"]}})

    def test_a_new_town_is_registered_with_the_prefix_that_was_found(self):
        self.two_regions()
        self.scaffold()
        self.assertEqual(self.registered()[self.TOWN]["prefixes"], [self.PREFIX])

    def test_registering_leaves_every_other_town_exactly_as_it_was(self):
        self.two_regions()
        self.scaffold()
        self.assertEqual(self.registered()["St Ives"], {"prefixes": ["050"]})

    def test_a_NON_DEFAULT_dataset_records_its_region_on_the_entry(self):
        """The Beaconsfield fault, stated as an assertion. Without `region` the
        monthly refresh diffs this town against the default region's data,
        matches nothing, and reports every one of its routes as withdrawn."""
        self.two_regions(default="cambridgeshire")
        _, out, _ = self.scaffold()
        self.assertEqual(self.registered()[self.TOWN].get("region"), "buckinghamshire")
        self.assertIn("non-default dataset", out)

    def test_a_town_on_the_DEFAULT_dataset_records_no_region(self):
        """The other direction, and it has to be asserted or the rule above
        would be satisfied by writing `region` on everything -- at which point
        the field stops carrying any information about which towns are unusual."""
        self.two_regions(default="buckinghamshire")
        self.scaffold()
        self.assertNotIn("region", self.registered()[self.TOWN])

    def test_a_dataset_in_NO_registry_warns_and_says_what_to_do(self):
        """A third state, not a second. The town is still registered -- the
        prefix is known and useful -- but nothing can say which dataset to check
        it against, and a silent registration here is the Beaconsfield month
        arriving through the front door."""
        self.regions({"_default": "cambridgeshire", "regions": {
            "cambridgeshire": {"db": os.path.join(self.gdir, "cambridgeshire.sqlite"),
                               "status": "built"}}})
        _, out, _ = self.scaffold()
        self.assertIn("WARNING", out)
        self.assertIn("not registered in regions.json", out)
        self.assertIn(self.TOWN, self.registered())

    def test_a_missing_regions_file_is_the_same_warning_and_not_a_crash(self):
        _, out, _ = self.scaffold()
        self.assertIn("not registered in regions.json", out)
        self.assertIn(self.TOWN, self.registered())

    def test_a_town_already_registered_is_left_exactly_as_it_stands(self):
        """Never overwritten: the committed entry may carry a hand-set `region`
        or a second prefix that this run's single derived one would destroy."""
        self.two_regions()
        self.prefixes({self.TOWN: {"prefixes": ["049", "050"], "region": "cambridgeshire"}})
        _, out, _ = self.scaffold()
        self.assertEqual(self.registered()[self.TOWN],
                         {"prefixes": ["049", "050"], "region": "cambridgeshire"})
        self.assertIn("already in town_prefixes.json", out)

    def test_no_town_prefixes_file_is_reported_and_the_run_still_finishes(self):
        """A region built on a machine that has never scaffolded a town has no
        such file. The scaffold is still worth having; it just cannot register."""
        self.two_regions()
        os.remove(self.tp_path)
        _, out, _ = self.scaffold()
        self.assertIn("no town_prefixes.json", out)
        self.assertFalse(os.path.exists(self.tp_path))
        self.assertTrue(os.path.isfile(os.path.join(self.s1, "SCAFFOLD-NEXT.md")))


class WhenTheBootstrapFoundNoPrefix(Scaffold):
    """The state this suite was written around: the run completes, exits 0, and
    is missing the artefact the review gate exists to review."""

    def setUp(self):
        Scaffold.setUp(self)
        self.two_regions()
        self.prefixes({"St Ives": {"prefixes": ["050"]}})
        self.cmds, self.out, self.err = self.scaffold(draft={"town": self.TOWN})

    def test_no_service_facts_are_pulled_at_all(self):
        self.assertEqual(self.cmds.named("gtfs_query.py"), [])
        self.assertFalse(os.path.exists(os.path.join(self.s1, "gtfs-services.json")))

    def test_it_SAYS_the_service_facts_were_not_pulled(self):
        """The half that was silent. `gtfs-services.json` is what step 1 of the
        review checklist tells the reader to open, so its absence has to be
        announced by the run that decided not to write it -- the checklist itself
        is written either way and says the same thing."""
        self.assertIn("WARNING", self.out)
        self.assertIn("no atcoPrefix", self.out)
        self.assertIn("NOT pulled", self.out)

    def test_it_does_NOT_report_the_town_as_already_registered(self):
        """The conflation itself. One sentence covered both `nothing to do` and
        `nothing could be done`, and the second is the one that needs a person."""
        self.assertNotIn("already in town_prefixes.json", self.out)
        self.assertIn("NOT registered", self.out)

    def test_nothing_is_written_into_town_prefixes(self):
        """An entry with no prefix would be worse than no entry: the monthly
        refresh would join on it, match nothing, and report the town's routes as
        withdrawn -- Beaconsfield again, from a different direction."""
        self.assertNotIn(self.TOWN, self.registered())
        self.assertEqual(self.registered()["St Ives"], {"prefixes": ["050"]})

    def test_the_review_checklist_is_still_written(self):
        """Deliberately pinned rather than changed. The S1 folder exists and the
        human gate is still where the run stops; what changed is that the reader
        is told what is missing from it."""
        self.assertTrue(os.path.isfile(os.path.join(self.s1, "SCAFFOLD-NEXT.md")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
