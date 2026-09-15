"""gtfs_regions.py -- the module whose entire job is to REFUSE a confident wrong answer.

Most modules here compute something. This one mostly declines to. Its docstring
names the failure it was written against: Beaconsfield (ATCO 0400, in
`buckinghamshire.sqlite`) was queried against the Cambridgeshire dataset, matched
nothing, and reported all seven of its routes `[WITHDRAWN?]` every month for as
long as nobody looked. Nothing was broken -- every component did exactly what it
was asked, against the wrong dataset -- so there was no error to notice.

WHY IT IS WORTH A SUITE. This module is dark to every instrument the estate owns.
The byte gates, `status.js` and the quality ratchet all ask *does the output still
match*, and all three are asked OF A MAP; nothing here draws one. What it feeds is
the monthly refresh report, which is prose a person reads once a month and has no
reference copy to diff against. So the whole class of fault this file exists to
prevent -- a town joined to a dataset that cannot contain it -- is, by
construction, invisible to everything except a reader who happens to know that
Beaconsfield has buses. Its sibling `gtfs_places.py` got its suite on 2026-09-15
and leans on this module by name: an unrecognised region must come back UNCHANGED
so `plan()` can name it. That join is asserted here from the other side.

THE RULES BELOW ARE THE ONES ITS OWN DOCSTRINGS CALL LOAD-BEARING.

1. THERE IS NO DEFAULT REGION. `DEFAULT_REGION = None`, and its comment says why:
   a default is "a wrong-answer generator, not a convenience". `resolve_db()`
   raises rather than picking, and the message names the built regions so the
   refusal is useful rather than merely correct.

2. NO FALLBACK ON THE FEED SIDECAR. `feed_info()` reads `feed_info_<db>.json` and
   nothing else. It used to fall back to an unsuffixed `feed_info.json` that only
   ever described Cambridgeshire, so a region with no sidecar reported another
   county's build date and validity window as its own -- the same wrong answer one
   level down. `{}` is the honest result.

3. THE PREFIX GUARD. A town whose ATCO prefixes cannot occur in its region's
   dataset is skipped with a reason, because that is the Beaconsfield mistake
   arriving as a missing `"region"` key. Towns located by `near` have no prefixes
   and regions built without a filter have no `keepPrefixes`: both are skipped by
   the guard, which is the hole clause 6 below measures.

4. A TOWN IT CANNOT PLACE IS SKIPPED, NOT GUESSED. An unregistered region, a
   dataset that is not built, a prefix that cannot occur -- each removes the town
   from the plan and states why, and the reason travels with the town's name.

5. `_`-PREFIXED KEYS ARE COMMENTS. `load()` drops them from the registry, so the
   `_example_west_yorkshire` stub that documents how to add a region can never be
   offered as one, and `plan()` drops them from the town list.

6. ONE RULE IS WIDER IN THE DOCSTRING THAN IN THE CODE, AND THE TESTS SAY SO
   RATHER THAN PRETENDING OTHERWISE. The module says "there is no default region";
   `load()` still returns `cfg.get("_default")` if the registry declares one, and
   `plan()` still writes `cfg.get("region") or default`. Today's `regions.json`
   carries no `_default` and all nine towns carry a `"region"`, so nothing takes
   that path -- it is a dormant re-entry point for the exact fault this file
   prevents, and the prefix guard only half covers it. Measured, not reasoned:
   with `_default` restored, a town with ATCO prefixes is still caught by the
   guard, and a `near`-located town is planned against the default in silence.
   Both directions are asserted below so that whichever way somebody settles it,
   a test speaks. Filed as OA-370.

Every case builds a throwaway registry in a temp directory. Not one reads
`C:\\u3a St Ives\\Using AI\\Buses\\_gtfs`, for `prove-red-route-collision.py`'s
reason: an assertion about the real registry is an assertion about which regions
somebody happened to have built that week, and this module's whole subject is what
happens when that set is not what you assumed.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

import _engine

gr = _engine.load("gtfs_regions")

CAMBS_KEEP = ["0500", "0570"]
BUCKS_KEEP = ["0400"]


class RegistryCase(unittest.TestCase):
    """A throwaway `_gtfs` directory, plus the env hygiene these tests need.

    `resolve_db()` and `default_gdir()` read the environment at call time, so a
    stray `$GTFS_DB` in the shell that runs the suite would make half of section D
    pass for the wrong reason. Cleared here rather than in each test, and restored
    afterwards so the mutation harness's own process is left as it was found.
    """

    ENV_KEYS = ("GTFS_DB", "CAMBS_GTFS_DB", "BUSES_GTFS_DIR")

    def setUp(self):
        self.gdir = tempfile.mkdtemp(prefix="gtfs-regions-")
        self.addCleanup(shutil.rmtree, self.gdir, True)
        self._saved = {k: os.environ.get(k) for k in self.ENV_KEYS}
        for k in self.ENV_KEYS:
            os.environ.pop(k, None)
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    # -- fixture builders ---------------------------------------------------

    def db_path(self, name):
        return os.path.join(self.gdir, name + ".sqlite")

    def build_db(self, name):
        """Create the sqlite file itself. `plan()` tests existence on disk, so a
        region registered but not built is a different fixture from one built."""
        path = self.db_path(name)
        open(path, "w").close()
        return path

    def write_registry(self, regions, default=None, raw=None):
        """Write `regions.json`. `raw` writes the bytes verbatim, for the broken case."""
        path = os.path.join(self.gdir, "regions.json")
        with open(path, "w", encoding="utf-8") as fh:
            if raw is not None:
                fh.write(raw)
            else:
                cfg = {"regions": regions}
                if default is not None:
                    cfg["_default"] = default
                json.dump(cfg, fh)
        return path

    def region(self, name, built=True, db=None, keep=None, status=None):
        """One registry entry. `built` writes the file; `status` overrides the word."""
        if built:
            self.build_db(name)
        entry = {"status": status if status is not None else ("built" if built else "planned")}
        if db is not False:
            entry["db"] = db or self.db_path(name)
        if keep is not None:
            entry["keepPrefixes"] = keep
        return entry

    def sidecar(self, db, payload):
        name = "feed_info_%s.json" % os.path.splitext(os.path.basename(db))[0]
        with open(os.path.join(self.gdir, name), "w", encoding="utf-8") as fh:
            json.dump(payload, fh)


# ---------------------------------------------------------------------------
# A. THE REGISTRY. `load()` is the only reader of regions.json, and every refusal
#    below depends on it returning the right SET -- including the entries it must
#    not return.
# ---------------------------------------------------------------------------

class TestLoad(RegistryCase):

    def test_default_region_constant_is_none(self):
        """The constant the module's own comment calls deliberately None.

        Asserted as a bare fact because it is one: every refusal in this file is
        downstream of it, and a single character restores the privileged region
        the 2026-08-21 rule removed."""
        self.assertIsNone(gr.DEFAULT_REGION)

    def test_returns_the_registered_regions(self):
        self.write_registry({"cambridgeshire": self.region("cambridgeshire"),
                             "buckinghamshire": self.region("buckinghamshire")})
        regions, default = gr.load(self.gdir)
        self.assertEqual(sorted(regions), ["buckinghamshire", "cambridgeshire"])
        self.assertIsNone(default)

    def test_underscore_entries_are_comments_not_regions(self):
        """`_example_west_yorkshire` documents how to add a region. If it came back
        as one, `resolve_db()` would offer a dataset nobody has built and `plan()`
        would accept it as a town's region."""
        self.write_registry({"cambridgeshire": self.region("cambridgeshire"),
                             "_example_west_yorkshire": self.region("west_yorkshire", built=False),
                             "_comment": "how to add a region"})
        regions, _ = gr.load(self.gdir)
        self.assertEqual(list(regions), ["cambridgeshire"])

    def test_missing_registry_is_empty_not_an_exception(self):
        """Callers treat an empty registry as "nothing is registered" and refuse
        accordingly. Raising here would turn a refusal into a traceback in the
        middle of the monthly report."""
        regions, default = gr.load(self.gdir)
        self.assertEqual(regions, {})
        self.assertIsNone(default)

    def test_broken_registry_is_empty_not_an_exception(self):
        self.write_registry(None, raw="{not json")
        self.assertEqual(gr.load(self.gdir), ({}, None))

    def test_registry_with_no_regions_key(self):
        self.write_registry(None, raw='{"_comment": "nothing here yet"}')
        self.assertEqual(gr.load(self.gdir), ({}, None))

    def test_a_declared_default_is_still_honoured(self):
        """CLAUSE 6, first direction. The docstring says there is no default region;
        the code still reads `_default` from the registry. This test records what
        the code does today, so that removing the read is a deliberate act with a
        red test to justify it rather than a silent tidy-up."""
        self.write_registry({"cambridgeshire": self.region("cambridgeshire")},
                            default="cambridgeshire")
        _, default = gr.load(self.gdir)
        self.assertEqual(default, "cambridgeshire")


# ---------------------------------------------------------------------------
# B. THE FEED SIDECAR. The rule is NO FALLBACK: the wrong build date is worse than
#    no build date, because a report that names one looks checked.
# ---------------------------------------------------------------------------

class TestFeedInfo(RegistryCase):

    def test_reads_the_sidecar_named_for_this_db(self):
        db = self.build_db("buckinghamshire")
        self.sidecar(db, {"built": "2026-09-01", "feed_info": {"feed_start_date": "20260801"}})
        self.assertEqual(gr.feed_info(self.gdir, db)["built"], "2026-09-01")

    def test_does_not_fall_back_to_an_unsuffixed_sidecar(self):
        """The named fault, restaged. An unsuffixed `feed_info.json` is left lying
        beside a region that has no sidecar of its own; the honest answer is {},
        and the answer that reads exactly like a right one is Cambridgeshire's."""
        with open(os.path.join(self.gdir, "feed_info.json"), "w", encoding="utf-8") as fh:
            json.dump({"built": "2026-01-01", "feed_info": {"feed_start_date": "20260101"}}, fh)
        db = self.build_db("bedfordshire")
        self.assertEqual(gr.feed_info(self.gdir, db), {})

    def test_does_not_read_another_regions_sidecar(self):
        cambs = self.build_db("cambridgeshire")
        self.sidecar(cambs, {"built": "2026-09-01"})
        bucks = self.build_db("buckinghamshire")
        self.assertEqual(gr.feed_info(self.gdir, bucks), {})

    def test_no_db_is_empty_without_touching_the_disk(self):
        """Called with no dataset at all -- the shape a caller reaches when the
        registry is empty. It must answer, not raise."""
        self.assertEqual(gr.feed_info(self.gdir, None), {})
        self.assertEqual(gr.feed_info(self.gdir, ""), {})

    def test_missing_sidecar_is_empty(self):
        self.assertEqual(gr.feed_info(self.gdir, self.build_db("cambridgeshire")), {})

    def test_broken_sidecar_is_empty(self):
        db = self.build_db("cambridgeshire")
        name = "feed_info_%s.json" % os.path.splitext(os.path.basename(db))[0]
        with open(os.path.join(self.gdir, name), "w", encoding="utf-8") as fh:
            fh.write("{ truncated")
        self.assertEqual(gr.feed_info(self.gdir, db), {})

    def test_the_sidecar_name_follows_the_db_basename_not_the_region(self):
        """A region whose `db` is named something other than `<region>.sqlite` --
        legal, and the reason the name is derived from the path rather than the key."""
        db = os.path.join(self.gdir, "bucks-2026-09.sqlite")
        open(db, "w").close()
        self.sidecar(db, {"built": "2026-09-14"})
        self.assertEqual(gr.feed_info(self.gdir, db)["built"], "2026-09-14")


# ---------------------------------------------------------------------------
# C. WHERE THE REGISTRY LIVES. Hardcoding the registry's location is fine;
#    hardcoding a region is not. The distinction is the module's own.
# ---------------------------------------------------------------------------

class TestDefaultGdir(RegistryCase):

    def test_env_override(self):
        os.environ["BUSES_GTFS_DIR"] = self.gdir
        self.assertEqual(gr.default_gdir(), self.gdir)

    def test_unset_points_at_the_buses_gtfs_folder(self):
        """Asserted on the tail rather than the whole path: the drive and the folder
        above it are this laptop's, and pinning them would make the suite fail in
        the one place it most needs to run, which is somebody else's checkout."""
        self.assertEqual(os.path.basename(gr.default_gdir()), "_gtfs")


# ---------------------------------------------------------------------------
# D. RESOLVING A DATASET. The precedence chain, and the refusal at the end of it.
# ---------------------------------------------------------------------------

class TestResolveDb(RegistryCase):

    def test_explicit_wins(self):
        os.environ["GTFS_DB"] = "env.sqlite"
        os.environ["CAMBS_GTFS_DB"] = "legacy.sqlite"
        self.assertEqual(gr.resolve_db("explicit.sqlite", self.gdir), "explicit.sqlite")

    def test_env_used_when_no_explicit(self):
        os.environ["GTFS_DB"] = "env.sqlite"
        self.assertEqual(gr.resolve_db(None, self.gdir), "env.sqlite")

    def test_current_env_beats_the_legacy_name(self):
        os.environ["GTFS_DB"] = "env.sqlite"
        os.environ["CAMBS_GTFS_DB"] = "legacy.sqlite"
        self.assertEqual(gr.resolve_db(None, self.gdir), "env.sqlite")

    def test_legacy_env_is_honoured_and_says_so(self):
        """$CAMBS_GTFS_DB still works so existing shells keep working, but it is
        misnamed for a multi-region system and the note is the only thing that will
        ever tell anybody."""
        os.environ["CAMBS_GTFS_DB"] = "legacy.sqlite"
        err = io.StringIO()
        saved, sys.stderr = sys.stderr, err
        try:
            got = gr.resolve_db(None, self.gdir)
        finally:
            sys.stderr = saved
        self.assertEqual(got, "legacy.sqlite")
        self.assertIn("deprecated", err.getvalue())
        self.assertIn("GTFS_DB", err.getvalue())

    def test_the_deprecation_note_is_ascii(self):
        """Its own comment says why: this goes to a Windows console whose stderr is
        cp1252, where an em dash is not merely ugly -- `print` raises
        UnicodeEncodeError and takes the run with it. A test, because the edit that
        breaks it is somebody tidying a hyphen into a dash."""
        os.environ["CAMBS_GTFS_DB"] = "legacy.sqlite"
        err = io.StringIO()
        saved, sys.stderr = sys.stderr, err
        try:
            gr.resolve_db(None, self.gdir)
        finally:
            sys.stderr = saved
        note = err.getvalue()
        self.assertTrue(note.strip())
        self.assertTrue(note.isascii(), "not ASCII: %r" % note)
        note.encode("cp1252")

    def test_nothing_set_refuses(self):
        """The whole point of the module. Not None, not a guess -- SystemExit."""
        self.write_registry({"cambridgeshire": self.region("cambridgeshire")})
        with self.assertRaises(SystemExit) as caught:
            gr.resolve_db(None, self.gdir)
        self.assertIn("no default region", str(caught.exception))

    def test_the_refusal_says_why_a_default_would_be_worse(self):
        """A refusal a reader does not understand gets worked around. The message
        carries the Beaconsfield reasoning, which is the argument for the refusal
        rather than a restatement of it."""
        self.write_registry({"cambridgeshire": self.region("cambridgeshire")})
        with self.assertRaises(SystemExit) as caught:
            gr.resolve_db(None, self.gdir)
        self.assertIn("withdrawn", str(caught.exception))

    def test_the_refusal_names_the_built_regions_and_the_registry(self):
        self.write_registry({"cambridgeshire": self.region("cambridgeshire"),
                             "buckinghamshire": self.region("buckinghamshire")})
        with self.assertRaises(SystemExit) as caught:
            gr.resolve_db(None, self.gdir)
        msg = str(caught.exception)
        self.assertIn("Built regions:", msg)
        self.assertIn("cambridgeshire", msg)
        self.assertIn("buckinghamshire", msg)
        self.assertIn(os.path.join(self.gdir, "regions.json"), msg)

    def test_built_regions_are_listed_in_name_order(self):
        """Deterministic so the message is the same every time somebody hits it."""
        self.write_registry({"cambridgeshire": self.region("cambridgeshire"),
                             "bedfordshire": self.region("bedfordshire"),
                             "buckinghamshire": self.region("buckinghamshire")})
        with self.assertRaises(SystemExit) as caught:
            gr.resolve_db(None, self.gdir)
        msg = str(caught.exception)
        self.assertLess(msg.index("bedfordshire"), msg.index("buckinghamshire"))
        self.assertLess(msg.index("buckinghamshire"), msg.index("cambridgeshire"))

    def test_unbuilt_regions_are_not_offered(self):
        """Offering one produces the next wrong answer: a `--db` line naming a file
        that is not there."""
        self.write_registry({"cambridgeshire": self.region("cambridgeshire"),
                             "westyorkshire": self.region("westyorkshire", built=False)})
        with self.assertRaises(SystemExit) as caught:
            gr.resolve_db(None, self.gdir)
        self.assertNotIn("westyorkshire", str(caught.exception))

    def test_a_region_with_no_db_is_not_offered(self):
        self.write_registry({"cambridgeshire": self.region("cambridgeshire"),
                             "nodb": {"status": "built"}})
        with self.assertRaises(SystemExit) as caught:
            gr.resolve_db(None, self.gdir)
        self.assertNotIn("nodb", str(caught.exception))

    def test_refuses_even_with_no_registry_at_all(self):
        """The registry is what makes the refusal helpful, not what makes it happen."""
        with self.assertRaises(SystemExit) as caught:
            gr.resolve_db(None, self.gdir)
        self.assertNotIn("Built regions:", str(caught.exception))

    def test_refuses_when_the_registry_cannot_be_read(self):
        self.write_registry(None, raw="{ broken")
        with self.assertRaises(SystemExit):
            gr.resolve_db(None, self.gdir)


# ---------------------------------------------------------------------------
# E. THE PREFIX GUARD. The second line of defence, and the one that caught
#    Beaconsfield.
# ---------------------------------------------------------------------------

class TestPrefixMismatch(RegistryCase):

    def test_a_prefix_that_cannot_occur_is_reported(self):
        msg = gr.prefix_mismatch({"prefixes": ["0400"]}, "cambridgeshire",
                                 {"keepPrefixes": CAMBS_KEEP})
        self.assertIsNotNone(msg)
        self.assertIn("0400", msg)
        self.assertIn("cambridgeshire", msg)
        self.assertIn("0500", msg)

    def test_the_message_names_the_missing_region_key_as_a_cause(self):
        """A guard that says only "wrong region" sends the reader to the dataset.
        The cause is usually a town added to town_prefixes.json without its key,
        and saying so is the difference between a five-minute fix and an afternoon."""
        msg = gr.prefix_mismatch({"prefixes": ["0400"]}, "cambridgeshire",
                                 {"keepPrefixes": CAMBS_KEEP})
        self.assertIn("region", msg)

    def test_a_prefix_that_can_occur_passes(self):
        self.assertIsNone(gr.prefix_mismatch({"prefixes": ["0500"]}, "cambridgeshire",
                                             {"keepPrefixes": CAMBS_KEEP}))

    def test_any_one_prefix_matching_is_enough(self):
        """A town straddling a boundary carries prefixes from both sides."""
        self.assertIsNone(gr.prefix_mismatch({"prefixes": ["0400", "0500"]}, "cambridgeshire",
                                             {"keepPrefixes": CAMBS_KEEP}))

    def test_matching_is_by_stem_not_equality(self):
        """ATCO codes are longer than the filter; `0500` keeps `0500...` stops."""
        self.assertIsNone(gr.prefix_mismatch({"prefixes": ["050012345"]}, "cambridgeshire",
                                             {"keepPrefixes": CAMBS_KEEP}))

    def test_a_region_with_no_filter_is_not_checked(self):
        """A dataset built without a prefix filter can contain anything, so there is
        nothing to check -- and a guard that fired here would be a false refusal."""
        self.assertIsNone(gr.prefix_mismatch({"prefixes": ["0400"]}, "anywhere", {}))

    def test_a_town_with_no_prefixes_is_not_checked(self):
        """A `near`-located town. Nothing to check -- and clause 6's hole."""
        self.assertIsNone(gr.prefix_mismatch({"near": [52.3, -0.07]}, "cambridgeshire",
                                             {"keepPrefixes": CAMBS_KEEP}))

    def test_empty_lists_are_not_checked(self):
        self.assertIsNone(gr.prefix_mismatch({"prefixes": []}, "cambridgeshire",
                                             {"keepPrefixes": CAMBS_KEEP}))
        self.assertIsNone(gr.prefix_mismatch({"prefixes": ["0400"]}, "cambridgeshire",
                                             {"keepPrefixes": []}))


# ---------------------------------------------------------------------------
# F. THE PLAN. Which town is read from which dataset -- and which towns are
#    refused, with what said about them.
# ---------------------------------------------------------------------------

class TestPlan(RegistryCase):

    def registry_of_three(self):
        self.write_registry({
            "cambridgeshire": self.region("cambridgeshire", keep=CAMBS_KEEP),
            "buckinghamshire": self.region("buckinghamshire", keep=BUCKS_KEEP),
        })

    def test_towns_are_grouped_by_dataset(self):
        self.registry_of_three()
        groups, skipped = gr.plan(self.gdir, {
            "St Ives": {"region": "cambridgeshire", "prefixes": ["0500"]},
            "Beaconsfield": {"region": "buckinghamshire", "prefixes": ["0400"]},
            "Ramsey": {"region": "cambridgeshire", "prefixes": ["0500"]},
        })
        self.assertEqual(skipped, [])
        self.assertEqual([g["region"] for g in groups], ["cambridgeshire", "buckinghamshire"])
        self.assertEqual([t for t, _ in groups[0]["towns"]], ["St Ives", "Ramsey"])
        self.assertEqual([t for t, _ in groups[1]["towns"]], ["Beaconsfield"])

    def test_group_order_is_first_appearance(self):
        """Stated in the docstring as the reason report output is deterministic. A
        sorted order would also be deterministic, so the assertion is that it
        follows the town list -- which is what a reader of the report is reading."""
        self.registry_of_three()
        groups, _ = gr.plan(self.gdir, {
            "Beaconsfield": {"region": "buckinghamshire", "prefixes": ["0400"]},
            "St Ives": {"region": "cambridgeshire", "prefixes": ["0500"]},
        })
        self.assertEqual([g["region"] for g in groups], ["buckinghamshire", "cambridgeshire"])

    def test_underscore_towns_are_comments(self):
        """Not planned and not skipped -- they are not towns, so they must not appear
        in the "Not checked" list either, where a reader would go looking for one."""
        self.registry_of_three()
        groups, skipped = gr.plan(self.gdir, {
            "_comment": {"region": "cambridgeshire"},
            "St Ives": {"region": "cambridgeshire", "prefixes": ["0500"]},
        })
        self.assertEqual(skipped, [])
        self.assertEqual([t for t, _ in groups[0]["towns"]], ["St Ives"])

    def test_an_unregistered_region_is_skipped_by_name(self):
        """The join `gtfs_places.py` depends on: the name comes back UNCHANGED so
        the report can print it. Dropping the town instead, or normalising the name
        to something the reader does not recognise, both hide the typo that caused it."""
        self.registry_of_three()
        groups, skipped = gr.plan(self.gdir, {
            "Somewhere": {"region": "lincolnshire", "prefixes": ["0250"]},
        })
        self.assertEqual(groups, [])
        self.assertEqual(len(skipped), 1)
        town, reason = skipped[0]
        self.assertEqual(town, "Somewhere")
        self.assertIn("lincolnshire", reason)
        self.assertIn("regions.json", reason)

    def test_a_town_with_no_region_key_and_no_default_is_skipped(self):
        """CLAUSE 6, the safe direction, and the shape that started all this: a town
        added to town_prefixes.json without its `"region"`. With no default declared
        there is nothing to guess with, so it is refused rather than joined."""
        self.registry_of_three()
        groups, skipped = gr.plan(self.gdir, {"Beaconsfield": {"prefixes": ["0400"]}})
        self.assertEqual(groups, [])
        self.assertEqual(len(skipped), 1)
        self.assertIn("not registered", skipped[0][1])

    def test_an_unbuilt_dataset_is_skipped_naming_the_file(self):
        self.write_registry({"westyorkshire": self.region("westyorkshire", built=False)})
        groups, skipped = gr.plan(self.gdir, {"Leeds": {"region": "westyorkshire"}})
        self.assertEqual(groups, [])
        self.assertIn("not built", skipped[0][1])
        self.assertIn("westyorkshire.sqlite", skipped[0][1])

    def test_the_beaconsfield_case_end_to_end(self):
        """The fault the module was written for, as a plan rather than as a unit:
        a Buckinghamshire town pointed at the Cambridgeshire dataset is skipped with
        a reason, not diffed into seven false withdrawals."""
        self.registry_of_three()
        groups, skipped = gr.plan(self.gdir, {
            "Beaconsfield": {"region": "cambridgeshire", "prefixes": ["0400"]},
        })
        self.assertEqual(groups, [])
        self.assertIn("cannot occur", skipped[0][1])

    def test_a_good_town_survives_a_neighbours_refusal(self):
        """One bad entry must not take the whole report down with it."""
        self.registry_of_three()
        groups, skipped = gr.plan(self.gdir, {
            "Beaconsfield": {"region": "cambridgeshire", "prefixes": ["0400"]},
            "St Ives": {"region": "cambridgeshire", "prefixes": ["0500"]},
        })
        self.assertEqual(len(skipped), 1)
        self.assertEqual([t for t, _ in groups[0]["towns"]], ["St Ives"])

    def test_db_defaults_to_the_region_name_beside_the_registry(self):
        """A region registered without an explicit `db`. This is a path convention,
        not a region default -- the region was still named by the town."""
        self.build_db("cambridgeshire")
        self.write_registry({"cambridgeshire": {"status": "built"}})
        groups, skipped = gr.plan(self.gdir, {"St Ives": {"region": "cambridgeshire"}})
        self.assertEqual(skipped, [])
        self.assertEqual(groups[0]["db"], self.db_path("cambridgeshire"))

    def test_the_feed_sidecar_is_attached_to_its_group(self):
        self.registry_of_three()
        self.sidecar(self.db_path("cambridgeshire"), {"built": "2026-09-01"})
        groups, _ = gr.plan(self.gdir, {"St Ives": {"region": "cambridgeshire", "prefixes": ["0500"]}})
        self.assertEqual(groups[0]["feed"]["built"], "2026-09-01")

    def test_each_group_gets_its_own_feed(self):
        """Two groups, one sidecar. The group without one must read {} rather than
        its neighbour's -- rule 2, arriving through `plan()` rather than directly."""
        self.registry_of_three()
        self.sidecar(self.db_path("cambridgeshire"), {"built": "2026-09-01"})
        groups, _ = gr.plan(self.gdir, {
            "St Ives": {"region": "cambridgeshire", "prefixes": ["0500"]},
            "Beaconsfield": {"region": "buckinghamshire", "prefixes": ["0400"]},
        })
        self.assertEqual(groups[0]["feed"]["built"], "2026-09-01")
        self.assertEqual(groups[1]["feed"], {})

    # -- the override -------------------------------------------------------

    def test_db_override_takes_every_town(self):
        """Single-dataset and testing use. It overrides the registry ENTIRELY, which
        is why nothing is skipped -- including a town whose region is unregistered."""
        self.registry_of_three()
        forced = self.build_db("forced")
        groups, skipped = gr.plan(self.gdir, {
            "St Ives": {"region": "cambridgeshire", "prefixes": ["0500"]},
            "Nowhere": {"region": "lincolnshire", "prefixes": ["0250"]},
        }, db_override=forced)
        self.assertEqual(skipped, [])
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["db"], forced)
        self.assertEqual([t for t, _ in groups[0]["towns"]], ["St Ives", "Nowhere"])

    def test_db_override_suspends_the_prefix_guard(self):
        """Deliberate, and worth pinning: under an override the operator has said
        which dataset they mean, so the guard's question no longer applies."""
        self.registry_of_three()
        forced = self.build_db("forced")
        groups, skipped = gr.plan(self.gdir, {
            "Beaconsfield": {"region": "cambridgeshire", "prefixes": ["0400"]},
        }, db_override=forced)
        self.assertEqual(skipped, [])
        self.assertEqual(len(groups[0]["towns"]), 1)

    def test_db_override_still_drops_underscore_towns(self):
        self.registry_of_three()
        forced = self.build_db("forced")
        groups, skipped = gr.plan(self.gdir, {"_comment": {}, "St Ives": {"region": "cambridgeshire"}},
                                  db_override=forced)
        self.assertEqual(skipped, [])
        self.assertEqual([t for t, _ in groups[0]["towns"]], ["St Ives"])

    def test_db_override_works_with_no_registry_at_all(self):
        forced = self.build_db("forced")
        groups, skipped = gr.plan(self.gdir, {"St Ives": {"prefixes": ["0500"]}}, db_override=forced)
        self.assertEqual(skipped, [])
        self.assertEqual(groups[0]["db"], forced)

    # -- clause 6, the dormant re-entry point -------------------------------

    def test_a_declared_default_catches_a_prefixed_town_on_the_guard(self):
        """CLAUSE 6, measured. With `_default` restored, a town missing its region
        key is joined to the default -- and the prefix guard is what stops it. This
        is the half that is covered."""
        self.registry_of_three()
        groups, skipped = gr.plan(self.gdir, {"Beaconsfield": {"prefixes": ["0400"]}})
        self.assertIn("not registered", skipped[0][1])

        self.write_registry({
            "cambridgeshire": self.region("cambridgeshire", keep=CAMBS_KEEP),
            "buckinghamshire": self.region("buckinghamshire", keep=BUCKS_KEEP),
        }, default="cambridgeshire")
        groups, skipped = gr.plan(self.gdir, {"Beaconsfield": {"prefixes": ["0400"]}})
        self.assertEqual(groups, [])
        self.assertIn("cannot occur", skipped[0][1])

    def test_a_declared_default_silently_takes_a_near_located_town(self):
        """CLAUSE 6, the hole, asserted rather than described. A town with no
        prefixes gives the guard nothing to check, so with `_default` declared it is
        planned against that region in silence -- no skip, no note, and a monthly
        diff against a dataset nobody chose for it. Nothing takes this path today
        (`regions.json` declares no `_default`), which is exactly why only a test
        can hold it. OA-370."""
        self.write_registry({
            "cambridgeshire": self.region("cambridgeshire", keep=CAMBS_KEEP),
        }, default="cambridgeshire")
        groups, skipped = gr.plan(self.gdir, {"Somewhere": {"near": [52.3, -0.07]}})
        self.assertEqual(skipped, [])
        self.assertEqual(groups[0]["region"], "cambridgeshire")
        self.assertEqual([t for t, _ in groups[0]["towns"]], ["Somewhere"])


# ---------------------------------------------------------------------------
# G. THE PROVENANCE LINE. What the reader of the monthly report is shown about
#    where the answer came from.
# ---------------------------------------------------------------------------

class TestFeedLine(RegistryCase):

    def group(self, feed):
        return {"region": "cambridgeshire",
                "db": os.path.join(self.gdir, "cambridgeshire.sqlite"),
                "feed": feed, "towns": []}

    def test_names_region_dataset_build_and_validity(self):
        line = gr.feed_line(self.group({
            "built": "2026-09-01",
            "feed_info": {"feed_start_date": "20260801", "feed_end_date": "20261231"},
        }))
        self.assertIn("cambridgeshire", line)
        self.assertIn("cambridgeshire.sqlite", line)
        self.assertIn("2026-09-01", line)
        self.assertIn("20260801", line)
        self.assertIn("20261231", line)

    def test_the_basename_not_the_whole_path(self):
        """The report is read by a person; the absolute path is this laptop's."""
        self.assertNotIn(self.gdir, gr.feed_line(self.group({})))

    def test_unknown_feed_shows_question_marks_rather_than_failing(self):
        """An empty feed is the honest result of rule 2, so this is the line that
        rule produces. It must still render -- a KeyError here would take down the
        report of every town in the group.

        Asserted on the three placeholders INDIVIDUALLY rather than on "is there a
        question mark anywhere". Written the loose way it passes while two of the
        three have been replaced by a fabricated date, which is the fault: a
        report that states a build date nobody built reads exactly like a checked
        one. Found by mutating it, not by reading it."""
        line = gr.feed_line(self.group({}))
        self.assertIn("built ?,", line)
        self.assertIn("valid ?–?", line)
        self.assertIn("cambridgeshire", line)

    def test_a_missing_feed_key_is_the_same(self):
        """No `feed` key at all, not merely an empty one -- the shape a group built
        by hand in a caller has."""
        line = gr.feed_line({"region": "r", "db": "r.sqlite", "towns": []})
        self.assertIn("built ?,", line)
        self.assertIn("valid ?–?", line)

    def test_a_half_filled_feed_shows_what_it_has(self):
        line = gr.feed_line(self.group({"built": "2026-09-01", "feed_info": {}}))
        self.assertIn("built 2026-09-01,", line)
        self.assertIn("valid ?–?", line)


if __name__ == "__main__":
    unittest.main()
