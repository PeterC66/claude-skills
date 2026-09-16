"""gtfs_places.py -- the module that decides WHICH PLACE MAPS EXIST at all.

Every other module in the monthly path is handed the thing it works on. This one
goes and finds them. `town_prefixes.json` registers towns by hand and everybody
knows it drifts; places are not registered anywhere, by design, so what
`gtfs_upcoming.py` scans each month is exactly what `discover()` returns from a
walk of the disk -- no more, and, which is the whole point of this file, no less.

WHY IT IS WORTH A SUITE, AND WHY IT IS THE WORST OF THE TEN LEFT. Its failure is
SILENCE. A module that returns a wrong number puts a wrong number in a report
somebody reads; a module that fails to find a place produces a report with one
fewer section in it, and nothing anywhere counts the sections. The place simply
stops being change-detected, and the first evidence is a sheet that has been
wrong for months. Every instrument this estate owns asks *does the output still
match* -- the byte gates, `status.js`, the quality ratchet -- and every one of
them is asked OF A MAP. None of them can be asked of a map nobody enumerated.
That is `gen_external_busway.js`'s shape (the dark file that threw for a day with
every gate green) turned one level outward: not a file no map runs, but a map no
run reaches.

THE FOUR RULES BELOW ARE THE ONES ITS OWN DOCSTRINGS CALL LOAD-BEARING.

1. THE THREE LAYOUTS AND THE ONE EXCLUSION. A place lives in one of three shapes
   and `_portal-fixture` is a frozen byte-identical copy that must never be
   scanned. The exclusion's stated reason is that scanning it would "double-count
   High Wycombe Aldi", and on this disk that is literally true: the real Aldi is
   `Areas/High Wycombe/Places/High Wycombe Aldi` and the fixture copy is
   `Places/_portal-fixture/High Wycombe Aldi`, the same NAME twice.

2. THE STAGE ORDER. `STAGE_PREFERENCE = ("S2", "S1", "S5", "S4")` -- facts stages
   before copies -- and existence on disk, never the manifest's `outputs` list,
   decides what is there.

3. THE REGION JOIN. A place inside a registered town takes that town's dataset
   and nothing else; a standalone one matches its human region name three ways;
   an unrecognised name comes back UNCHANGED so `gtfs_regions.plan()` can name it
   in "Not checked" rather than silently drop it.

4. THE RADIUS. `near` comes from the place's own `gtfs-services.json`, because a
   place's service radius is NOT a subset of its town's -- High Wycombe's centre
   is 2.6 km from the Aldi and its radius is 3.5 km. Only if there is no recorded
   radius at all does `DEFAULT_SERVICE_KM` apply, and then the entry must SAY so.

Every case is a throwaway directory tree built here. Not one reads the Buses
folder, for `prove-red-route-collision.py`'s reason: an assertion about a real
tree is an assertion about what somebody happened to build that week. The names
in the fixtures are the real ones only where the real ones are the fault --
"High Wycombe Aldi" appears twice on purpose, and the test that uses it would
pass on any other pair of names, which is exactly why it does not use one.
"""
import json
import os
import shutil
import tempfile
import unittest

import _engine

gp = _engine.load("gtfs_places")


def write(path, payload):
    """Create `path`'s parents and write `payload` -- JSON if it is not a string."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(payload if isinstance(payload, str) else json.dumps(payload))
    return path


def read(path):
    """Read a JSON file and CLOSE it -- these run on Windows, where a leaked
    handle on a temp tree makes `shutil.rmtree` fail and the failure lands in
    whichever test runs next."""
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def manifest_for(**stages):
    """A manifest in the shape the real ones have.

    Derived from the real file rather than invented: each stage carries `runs`
    with an `id` and a `dir`, and a `latest` naming one of them. Built from the
    dirs themselves so a fixture cannot name a run it did not create -- which is
    the mistake that would turn a test of the manifest path into a test of the
    `_latest` fallback without saying so.
    """
    out = {}
    for stage, dirs in stages.items():
        runs = [{"id": os.path.basename(d), "dir": d} for d in dirs]
        out[stage] = {"latest": runs[-1]["id"], "runs": runs}
    return {"stages": out}


class Tree(unittest.TestCase):
    """Base for the cases that need a disk. One tree per test, removed after."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="gtfs_places_")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def place(self, rel, near=None, facts=True, manifest=None, place_json=None,
              stage="S1-services/2026-09-11_0559"):
        """A built place map at `<root>/<rel>`, with a gtfs-services.json in `stage`.

        `near` and `facts` are SEPARATE because the module distinguishes three
        states and the first version of this helper collapsed two of them: a
        facts file carrying a radius, a facts file carrying none (which is what
        sends `discover()` to the place.json fallback), and no facts file at all
        (which is a problem before the fallback is reached). Written as one flag
        it silently turned every fallback case into a no-file case, and three
        tests passed their own assertions against the wrong branch.
        """
        d = os.path.join(self.root, rel.replace("/", os.sep))
        write(os.path.join(d, "manifest.json"),
              manifest if manifest is not None else manifest_for(S1=[stage]))
        if facts:
            gs = {"atcoPrefixes": None}
            if near is not None:
                gs["near"] = near
            write(os.path.join(d, stage.replace("/", os.sep), "gtfs-services.json"), gs)
        if place_json is not None:
            write(os.path.join(d, stage.replace("/", os.sep), "place.json"), place_json)
        return d


class Layouts(Tree):
    """Rule 1 -- which directories on this disk are places, and which is not."""

    def test_a_place_inside_an_area_is_found_and_carries_its_parent_town(self):
        self.place("Areas/St Neots/Places/St Neots Tesco Extra", near=[52.2, -0.26, 0.8])
        found = gp._place_dirs(self.root)
        self.assertEqual([(n, p) for n, _, p in found],
                         [("St Neots Tesco Extra", "St Neots")])

    def test_a_flat_place_has_no_parent(self):
        self.place("Places/Ely Co-op", near=[52.4, 0.26, 0.8])
        self.assertEqual([(n, p) for n, _, p in gp._place_dirs(self.root)],
                         [("Ely Co-op", None)])

    def test_a_bucketed_place_has_no_parent_either(self):
        """`Places/_standalone/<Place>/` is today's documented shape for these."""
        self.place("Places/_standalone/Godmanchester Co-op Ermine Street", near=[52.3, -0.18, 0.8])
        self.assertEqual([(n, p) for n, _, p in gp._place_dirs(self.root)],
                         [("Godmanchester Co-op Ermine Street", None)])

    def test_all_three_layouts_are_found_in_one_walk(self):
        """A pattern silently dropped would leave the other two passing."""
        self.place("Areas/St Neots/Places/St Neots Co-op", near=[52.2, -0.26, 0.8])
        self.place("Places/Ely Co-op", near=[52.4, 0.26, 0.8])
        self.place("Places/_standalone/Godmanchester Co-op Ermine Street", near=[52.3, -0.18, 0.8])
        self.assertEqual(sorted(n for n, _, _ in gp._place_dirs(self.root)),
                         ["Ely Co-op", "Godmanchester Co-op Ermine Street", "St Neots Co-op"])

    def test_a_directory_with_no_manifest_is_not_a_place(self):
        """Keyed on manifest.json so scratch folders beside a map are never picked up."""
        os.makedirs(os.path.join(self.root, "Places", "Not A Map", "S1-services"))
        write(os.path.join(self.root, "Places", "Not A Map", "notes.md"), "scratch")
        self.assertEqual(gp._place_dirs(self.root), [])

    def test_an_empty_tree_is_no_places_rather_than_an_error(self):
        self.assertEqual(gp._place_dirs(self.root), [])

    def test_the_portal_fixture_copy_does_not_displace_the_real_map(self):
        """Rule 1's money case, and the one an obvious fixture would get wrong.

        The exclusion's own stated reason is double-counting High Wycombe Aldi,
        so both copies here carry that NAME. `discover()` keys its entries on the
        name, and `Places/*/*` is globbed AFTER `Areas/*/Places/*`, so with
        EXCLUDED_DIRS emptied the fixture copy does not appear as a twelfth
        entry -- it OVERWRITES the real one, and the count does not move. A test
        asserting `len(entries)`, or asserting the fixture name is absent, passes
        under the fault. The directory the surviving entry points at is the only
        thing that changes, so that is what is asserted.
        """
        real = self.place("Areas/High Wycombe/Places/High Wycombe Aldi", near=[51.63, -0.75, 0.8])
        self.place("Places/_portal-fixture/High Wycombe Aldi", near=[51.63, -0.75, 0.8])
        entries, problems = gp.discover(self.root)
        self.assertEqual(list(entries), ["High Wycombe Aldi"])
        self.assertEqual(entries["High Wycombe Aldi"]["_dir"], real)
        self.assertEqual(problems, [])

    def test_a_fixture_under_areas_is_excluded_too(self):
        """`Areas/_portal-fixture/` exists on this disk beside `Places/_portal-fixture/`."""
        self.place("Areas/_portal-fixture/Places/High Wycombe High Street", near=[51.63, -0.75, 0.8])
        self.assertEqual(gp._place_dirs(self.root), [])

    def test_the_exclusion_matches_a_whole_path_component_not_a_substring(self):
        """A real place whose folder merely CONTAINS the word must still be scanned."""
        self.place("Places/_portal-fixture-notes/Ely Co-op", near=[52.4, 0.26, 0.8])
        self.assertEqual([n for n, _, _ in gp._place_dirs(self.root)], ["Ely Co-op"])


class StageOrder(Tree):
    """Rule 2 -- which copy of a facts file is believed."""

    def services_in(self, place_dir, stage_dir, near):
        return write(os.path.join(place_dir, stage_dir.replace("/", os.sep), "gtfs-services.json"),
                     {"near": near})

    def test_S2_is_preferred_to_S1(self):
        """Both present with DIFFERENT contents.

        A fixture with the file in S2 alone would pass with the tuple reversed,
        so each of these three puts a distinguishable radius in both stages and
        asserts which one came back.
        """
        d = os.path.join(self.root, "p")
        self.services_in(d, "S1-services/2026-09-01_0100", [1, 1, 1.0])
        self.services_in(d, "S2-geometry/2026-09-01_0200", [2, 2, 2.0])
        mf = manifest_for(S1=["S1-services/2026-09-01_0100"], S2=["S2-geometry/2026-09-01_0200"])
        path, note = gp.resolve_output(d, mf, "gtfs-services.json")
        self.assertEqual(read(path)["near"], [2, 2, 2.0])
        self.assertIsNone(note)

    def test_S1_is_preferred_to_S5(self):
        d = os.path.join(self.root, "p")
        self.services_in(d, "S1-services/2026-09-01_0100", [1, 1, 1.0])
        self.services_in(d, "S5-render/v1.0_2026-09-01_0500", [5, 5, 5.0])
        mf = manifest_for(S1=["S1-services/2026-09-01_0100"], S5=["S5-render/v1.0_2026-09-01_0500"])
        path, _ = gp.resolve_output(d, mf, "gtfs-services.json")
        self.assertEqual(read(path)["near"], [1, 1, 1.0])

    def test_S5_is_preferred_to_S4(self):
        d = os.path.join(self.root, "p")
        self.services_in(d, "S4-generate/v1.0_2026-09-01_0400", [4, 4, 4.0])
        self.services_in(d, "S5-render/v1.0_2026-09-01_0500", [5, 5, 5.0])
        mf = manifest_for(S4=["S4-generate/v1.0_2026-09-01_0400"], S5=["S5-render/v1.0_2026-09-01_0500"])
        path, _ = gp.resolve_output(d, mf, "gtfs-services.json")
        self.assertEqual(read(path)["near"], [5, 5, 5.0])

    def test_only_the_latest_run_of_a_stage_is_consulted_through_the_manifest(self):
        """`latest` picks the run; an older S2 run must not win on stage rank alone."""
        d = os.path.join(self.root, "p")
        self.services_in(d, "S2-geometry/2026-08-01_0200", [8, 8, 8.0])
        self.services_in(d, "S1-services/2026-09-01_0100", [1, 1, 1.0])
        mf = {"stages": {
            "S2": {"latest": "2026-09-01_0200",
                   "runs": [{"id": "2026-08-01_0200", "dir": "S2-geometry/2026-08-01_0200"},
                            {"id": "2026-09-01_0200", "dir": "S2-geometry/2026-09-01_0200"}]},
            "S1": {"latest": "2026-09-01_0100",
                   "runs": [{"id": "2026-09-01_0100", "dir": "S1-services/2026-09-01_0100"}]}}}
        path, _ = gp.resolve_output(d, mf, "gtfs-services.json")
        self.assertEqual(read(path)["near"], [1, 1, 1.0])

    def test_existence_on_disk_decides_rather_than_the_manifests_outputs_list(self):
        """The Aldi case, stated as an assertion.

        Its S5 run lists `place.json` in `outputs` and not `gtfs-services.json`,
        though both are on disk -- so the list is a hint and the module must never
        consult it. Here the inversion: S2's run DECLARES the file and does not
        have it, S1 has it and declares nothing. Reading `outputs` would return a
        path that is not there.
        """
        d = os.path.join(self.root, "p")
        self.services_in(d, "S1-services/2026-09-01_0100", [1, 1, 1.0])
        os.makedirs(os.path.join(d, "S2-geometry", "2026-09-01_0200"))
        mf = {"stages": {
            "S2": {"latest": "2026-09-01_0200",
                   "runs": [{"id": "2026-09-01_0200", "dir": "S2-geometry/2026-09-01_0200",
                             "outputs": ["gtfs-services.json"]}]},
            "S1": {"latest": "2026-09-01_0100",
                   "runs": [{"id": "2026-09-01_0100", "dir": "S1-services/2026-09-01_0100",
                             "outputs": []}]}}}
        path, note = gp.resolve_output(d, mf, "gtfs-services.json")
        self.assertTrue(os.path.isfile(path))
        self.assertEqual(read(path)["near"], [1, 1, 1.0])
        self.assertIsNone(note)

    def test__latest_is_read_when_the_manifest_names_no_run(self):
        d = os.path.join(self.root, "p")
        self.services_in(d, "_latest", [9, 9, 9.0])
        path, note = gp.resolve_output(d, {"stages": {}}, "gtfs-services.json")
        self.assertEqual(read(path)["near"], [9, 9, 9.0])
        self.assertIsNone(note)

    def test_a_missing_manifest_still_finds_a_stage_run_on_disk(self):
        """`_read_json` returns None for an unreadable manifest; the walk must survive it."""
        d = os.path.join(self.root, "p")
        self.services_in(d, "S1-services/2026-09-01_0100", [1, 1, 1.0])
        path, _ = gp.resolve_output(d, None, "gtfs-services.json")
        self.assertEqual(read(path)["near"], [1, 1, 1.0])

    def test_ci_reference_is_read_last_and_the_note_says_the_coordinates_may_be_stale(self):
        """The caveat is the point: a mirror is current-state only.

        Both the stage run and the mirror exist, so this also asserts the mirror
        does not win when a real run has the file -- the note being None is what
        says which was read.
        """
        d = os.path.join(self.root, "p")
        self.services_in(d, "ci-reference", [7, 7, 7.0])
        path, note = gp.resolve_output(d, {"stages": {}}, "gtfs-services.json")
        self.assertEqual(read(path)["near"], [7, 7, 7.0])
        self.assertIn("ci-reference", note)

        self.services_in(d, "S1-services/2026-09-01_0100", [1, 1, 1.0])
        mf = manifest_for(S1=["S1-services/2026-09-01_0100"])
        path, note = gp.resolve_output(d, mf, "gtfs-services.json")
        self.assertEqual(read(path)["near"], [1, 1, 1.0])
        self.assertIsNone(note)

    def test_a_file_absent_everywhere_names_the_file_it_looked_for(self):
        """The reason is printed in the report's "Not checked" section verbatim."""
        d = os.path.join(self.root, "p")
        os.makedirs(d)
        path, reason = gp.resolve_output(d, {"stages": {}}, "gtfs-services.json")
        self.assertIsNone(path)
        self.assertIn("gtfs-services.json", reason)


class RegionJoin(unittest.TestCase):
    """Rule 3 -- which dataset a place is diffed against.

    The mistake at the other end of this join is the Beaconsfield one:
    a town queried against a feed that cannot contain it reports every route
    withdrawn, every month, confidently.
    """

    REGIONS = {
        "cambridgeshire": {"atcoAreas": {"050": "Cambridgeshire", "054": "Peterborough"},
                           "bodsRegion": "East Anglia"},
        "buckinghamshire": {"atcoAreas": {"040": "Buckinghamshire"},
                            "bodsRegion": "South East"},
    }

    def test_a_place_in_a_registered_town_uses_that_towns_dataset(self):
        self.assertEqual(
            gp.resolve_region({}, {"region": "buckinghamshire"}, self.REGIONS, None),
            "buckinghamshire")

    def test_the_parent_town_wins_over_the_places_own_region_name(self):
        """Both are present and they disagree, so the precedence is what is asserted.

        A fixture giving the place no region of its own would pass with the
        branches swapped.
        """
        self.assertEqual(
            gp.resolve_region({"region": "Cambridgeshire"}, {"region": "buckinghamshire"},
                              self.REGIONS, None),
            "buckinghamshire")

    def test_a_registered_parent_with_no_region_falls_back_to_the_default(self):
        self.assertEqual(gp.resolve_region({}, {}, self.REGIONS, "cambridgeshire"),
                         "cambridgeshire")

    def test_a_standalone_place_matches_a_region_key_ignoring_case_and_punctuation(self):
        self.assertEqual(
            gp.resolve_region({"region": "Cambridge-shire "}, None, self.REGIONS, None),
            "cambridgeshire")

    def test_a_standalone_place_matches_an_atco_area_name(self):
        """"Peterborough" is an area inside the Cambridgeshire dataset, not a key."""
        self.assertEqual(
            gp.resolve_region({"region": "Peterborough"}, None, self.REGIONS, None),
            "cambridgeshire")

    def test_a_standalone_place_matches_a_bods_region(self):
        self.assertEqual(
            gp.resolve_region({"region": "South East"}, None, self.REGIONS, None),
            "buckinghamshire")

    def test_an_unrecognised_region_name_comes_back_unchanged_so_it_can_be_named(self):
        """Deliberate, and the docstring says so: a named refusal beats a silent miss.

        `gtfs_regions.plan()` prints "region '<name>' is not registered" and skips
        the place. Returning the default instead would scan it against a feed that
        cannot contain it, which is the Beaconsfield fault through the front door.
        """
        self.assertEqual(
            gp.resolve_region({"region": "Norfolk"}, None, self.REGIONS, "cambridgeshire"),
            "Norfolk")

    def test_a_standalone_place_with_no_region_at_all_takes_the_default(self):
        self.assertIsNone(gp.resolve_region({}, None, self.REGIONS, None))
        self.assertEqual(gp.resolve_region(None, None, self.REGIONS, "x"), "x")

    def test_no_registry_is_not_an_error(self):
        self.assertEqual(gp.resolve_region({"region": "Norfolk"}, None, None, None), "Norfolk")


class Discover(Tree):
    """Rule 4 and the shape of the result -- entries a scan can consume."""

    def test_the_entry_carries_the_places_own_radius_rather_than_its_towns(self):
        """The High Wycombe case: a place radius is not a subset of its town's."""
        self.place("Areas/High Wycombe/Places/High Wycombe Aldi", near=[51.6289, -0.7533, 0.8])
        entries, problems = gp.discover(
            self.root, regions=RegionJoin.REGIONS, default=None,
            prefixes_cfg={"High Wycombe": {"region": "buckinghamshire", "near": [51.6285, -0.7488, 3.5]}})
        e = entries["High Wycombe Aldi"]
        self.assertEqual(e["near"], [51.6289, -0.7533, 0.8])
        self.assertEqual(e["region"], "buckinghamshire")
        self.assertEqual(e["_kind"], "place")
        self.assertEqual(e["_town"], "High Wycombe")
        self.assertIsNone(e["_note"])
        self.assertEqual(problems, [])

    def test_a_place_whose_name_collides_with_a_registered_town_is_refused_not_shadowed(self):
        """Entries are keyed on the name and are merged into the town scan.

        A place called "St Ives" would take the town's slot and the town would
        stop being scanned -- a silent substitution, which is why this is a
        problem rather than a rename.
        """
        self.place("Places/St Ives", near=[52.32, -0.07, 0.8])
        entries, problems = gp.discover(self.root, prefixes_cfg={"St Ives": {"region": "cambridgeshire"}})
        self.assertEqual(entries, {})
        self.assertEqual([n for n, _ in problems], ["St Ives"])
        self.assertIn("already registered", problems[0][1])

    def test_a_place_with_no_recorded_radius_falls_back_to_lat_lon_and_says_so(self):
        """The fallback is allowed, but it must never be silent."""
        self.place("Places/Ely Co-op", near=None,
                   place_json={"lat": 52.399, "lon": 0.262, "walkshedM": 400})
        entries, problems = gp.discover(self.root)
        e = entries["Ely Co-op"]
        self.assertEqual(e["near"], [52.399, 0.262, gp.DEFAULT_SERVICE_KM])
        self.assertIn("assumed", e["_note"])
        self.assertIn(str(gp.DEFAULT_SERVICE_KM), e["_note"])
        self.assertEqual(problems, [])

    def test_the_walkshed_is_not_used_as_a_service_radius(self):
        """Its own docstring's warning, asserted.

        `walkshedM` decides which stops are DRAWN; taking it as the service radius
        would scan a 400 m circle instead of 800 m and quietly lose routes.
        """
        self.place("Places/Ely Co-op", near=None,
                   place_json={"lat": 52.399, "lon": 0.262, "walkshedM": 400})
        entries, _ = gp.discover(self.root)
        self.assertEqual(entries["Ely Co-op"]["near"][2], gp.DEFAULT_SERVICE_KM)

    def test_a_place_with_neither_a_radius_nor_a_lat_lon_is_a_problem(self):
        self.place("Places/Ely Co-op", near=None, place_json={"town": "Ely"})
        entries, problems = gp.discover(self.root)
        self.assertEqual(entries, {})
        self.assertEqual(problems[0][0], "Ely Co-op")
        self.assertIn("lat/lon", problems[0][1])

    def test_a_place_with_no_facts_file_is_a_problem_naming_the_file(self):
        self.place("Places/Ely Co-op", facts=False)
        entries, problems = gp.discover(self.root)
        self.assertEqual(entries, {})
        self.assertIn("gtfs-services.json", problems[0][1])

    def test_a_place_read_from_the_mirror_carries_the_caveat_into_its_entry(self):
        """The note has to survive as far as the report, not stop at resolve_output."""
        d = self.place("Places/Ely Co-op", facts=False)
        write(os.path.join(d, "ci-reference", "gtfs-services.json"), {"near": [52.4, 0.26, 0.8]})
        entries, _ = gp.discover(self.root)
        self.assertIn("ci-reference", entries["Ely Co-op"]["_note"])

    def test_both_caveats_are_carried_when_both_apply(self):
        """A mirror read AND an assumed radius -- the join is a "; " not a replacement."""
        d = self.place("Places/Ely Co-op", facts=False)
        write(os.path.join(d, "ci-reference", "gtfs-services.json"), {"atcoPrefixes": None})
        write(os.path.join(d, "ci-reference", "place.json"), {"lat": 52.399, "lon": 0.262})
        entries, _ = gp.discover(self.root)
        note = entries["Ely Co-op"]["_note"]
        self.assertIn("ci-reference", note)
        self.assertIn("assumed", note)

    def test_src_is_relative_to_the_place_and_uses_forward_slashes_on_every_platform(self):
        """It is printed in the report, which is read on a laptop and in CI."""
        self.place("Places/Ely Co-op", near=[52.4, 0.26, 0.8],
                   stage="S2-geometry/2026-09-01_0200")
        entries, _ = gp.discover(self.root)
        self.assertEqual(entries["Ely Co-op"]["_src"],
                         "S2-geometry/2026-09-01_0200/gtfs-services.json")

    def test_a_standalone_places_town_comes_from_its_place_json(self):
        """No parent directory to read it from, so `_town` has to come from the file."""
        self.place("Places/_standalone/Ely Co-op", near=[52.4, 0.26, 0.8],
                   place_json={"town": "Ely", "region": "Cambridgeshire"})
        entries, _ = gp.discover(self.root, regions=RegionJoin.REGIONS)
        self.assertEqual(entries["Ely Co-op"]["_town"], "Ely")
        self.assertEqual(entries["Ely Co-op"]["region"], "cambridgeshire")

    def test_every_place_lands_in_exactly_one_of_entries_or_problems(self):
        """The two lists are what the report prints; a place in neither vanishes.

        Four places, one good and three failing for the three different reasons,
        so a `continue` that fell through would show up as a fifth outcome.
        """
        self.place("Places/Good", near=[52.4, 0.26, 0.8])
        self.place("Places/NoFacts", facts=False)
        self.place("Places/NoRadius", near=None, place_json={"town": "X"})
        self.place("Places/Collides", near=[52.4, 0.26, 0.8])
        entries, problems = gp.discover(self.root, prefixes_cfg={"Collides": {"region": "cambridgeshire"}})
        self.assertEqual(sorted(list(entries) + [n for n, _ in problems]),
                         ["Collides", "Good", "NoFacts", "NoRadius"])
        self.assertEqual(list(entries), ["Good"])

    def test_an_empty_tree_discovers_nothing_and_complains_about_nothing(self):
        self.assertEqual(gp.discover(self.root), ({}, []))


class Defaults(unittest.TestCase):
    """The two constants whose VALUES are decisions, not conveniences."""

    def test_the_stage_preference_puts_the_facts_stages_before_the_copies(self):
        """S4/S5 hold copies made at generate time; S1/S2 are where facts are written."""
        self.assertEqual(gp.STAGE_PREFERENCE, ("S2", "S1", "S5", "S4"))

    def test_the_stage_glob_reaches_every_stage_the_preference_names(self):
        """A glob narrower than the preference would make the tail unreachable.

        Derived from the preference rather than typed, so adding a stage to one
        and not the other is a failure here rather than a silent hole.
        """
        for stage in gp.STAGE_PREFERENCE:
            self.assertIn(stage[1], gp.STAGE_GLOB,
                          "%s is preferred but %s cannot match it" % (stage, gp.STAGE_GLOB))

    def test_the_default_radius_matches_the_place_skills_documented_default(self):
        self.assertEqual(gp.DEFAULT_SERVICE_KM, 0.8)

    def test_the_portal_fixture_is_excluded(self):
        self.assertIn("_portal-fixture", gp.EXCLUDED_DIRS)


if __name__ == "__main__":
    unittest.main()
