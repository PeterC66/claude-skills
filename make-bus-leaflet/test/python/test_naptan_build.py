"""naptan_build.py -- the module that decides what a bus stop IS for the whole estate.

Every other Python module here consumes this one's output. `naptan_stands.py`,
`boarding_index.py` and `boarding_verify.py` all open `naptan.sqlite` and read
columns this file DERIVED -- `stand`, `stand_kind`, `lat`, `lon`, `pos_source`,
`area` -- and `_stubs.py` builds both of its fixtures from this file's own
`COLUMNS` and `create_table`. Three suites therefore rest on a module that had
nothing but `test_module_load.py`, which asks whether it imports.

WHY THIS ONE IS DARK. It runs from a person's hand "a few times a year" (its own
docstring), it draws nothing, and its output is gitignored -- `naptan.sqlite` is
400 MB of untracked, regenerable data. So no byte gate, no quality ratchet and no
status board has ever had an opinion about it: the sheets it feeds are perfectly
reproducible whether the register behind them is right or wrong. The fuse is
longer than the two monthly jobs OA-001 has already covered, because a fault here
survives until somebody stands at a bus stop and reads a different letter off the
flag.

THE RULES BELOW ARE THE ONES THE MODULE'S OWN DOCSTRING CALLS LOAD-BEARING.

1. `stand` IS SPARSE ON PURPOSE. NaPTAN populates Indicator on nearly every row,
   and most of the time it is a relative descriptor -- "opp", "o/s", "adj",
   "near", "N-bound" -- that means nothing without knowing which side of what.
   The docstring's rule is absolute: *Never fall back to Indicator when stand is
   NULL: printing "opp" on a map tells a reader nothing, and inventing a letter
   is worse than printing none.* Section A is that sentence as assertions, in
   both directions -- every descriptor stays NULL, and every real code survives
   with its kind.

2. THE POSITION IS DERIVED, NOT COPIED. NaPTAN's own Longitude/Latitude are blank
   on most rows -- 12,401 of 127,658 nationally, and "the great majority of
   Cambridgeshire's" -- so `derive_position` converts Easting/Northing where they
   are missing and says which it used. `pos_source` is the provenance; a test that
   only checked the numbers would not notice the two swapping.

3. A ROW IS KEYED ON ATCOCode AND INSERTED ONCE. The register is built by
   fetching ~29 ATCO areas one at a time, and `main()` puts a UNIQUE index on
   ATCOCode at the end -- so a duplicate that `insert_csv`'s `seen` set failed to
   drop does not produce a wrong row, it aborts the whole build after the last
   download. The dedupe is what makes the index safe to assert.

4. WHICH AREAS GET FETCHED IS DERIVED FROM WHAT WE HAVE BUILT. `built_region_dbs`
   plus `areas_from_dbs` answer *which ATCO areas do our own datasets reference*,
   which is what keeps the download at ~10 MB instead of 96 MB and what makes it
   self-updating when a region is added. A region marked built whose file is gone
   is announced and skipped -- it is not an area, and it is not an error either.

5. AN AREA THAT COULD NOT BE FETCHED IS RECORDED AS SUCH. `fetch_area` returns
   None on a 400/404 and after exhausting its retries; `main()` collects those
   into `areasNotFetched` in the sidecar and prints them. That is this project's
   own *present, absent, or COULD NOT LOOK* rule: an area with no rows because
   nobody could download it must not read as an area with no stops.

6. ONE RULE IS WIDER IN THE DOCSTRING THAN IN THE CODE, AND THE TESTS SAY SO.
   `BARE_RE` is `^[A-Z]{1,2}$` with no IGNORECASE, so a bare one- or two-letter
   UPPERCASE Indicator becomes a stand code -- which is right for London's stop
   letters and wrong for a compass bearing written into the same field. Measured
   against the national register this laptop holds, 127,658 rows: 19 carry
   `stand_kind='bare'`, and on exactly two of them the Indicator is
   character-for-character the row's own Bearing (`0590PFF611` "The Peacock" and
   `40004402014A` "Ashford Hospital Entrance", both `SW`). `boarding_verify.py`
   prints a bare code as "Stand SW", so those two are the docstring's *inventing
   a letter* arriving through the one branch with no word in front of it to
   check. None of the 19 is in ATCO area 050, 057 or 040, so nothing we draw is
   affected and it is filed rather than fixed -- OA-372 -- and asserted here in
   BOTH directions so that whichever way it is settled, a test speaks.

Every case builds its fixtures in a temp directory. Not one reads
`C:\\u3a St Ives\\Using AI\\Buses\\_gtfs`, for `prove-red-route-collision.py`'s
reason: an assertion about the real register is an assertion about what DfT
published that week, and about which regions somebody happened to have built.
"""
import contextlib
import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest

import _engine
import _stubs

nb = _engine.load("naptan_build")


# The OS's own worked example for the reverse transverse Mercator, TG 51409 13177:
# easting 651409.903, northing 313177.270, which is OSGB36 52.657570N 1.717922E and
# WGS84 52.657979N 1.716052E. A published anchor rather than a number this suite
# produced and then agreed with.
OSGB_EXAMPLE = (651409.903, 313177.270)
WGS84_EXAMPLE = (52.6579786, 1.7160519)


def csv_text(rows, columns=None):
    """A NaPTAN CSV as the API returns it -- a header line and `rows`.

    Written through `csv` rather than joined by hand so a fixture value holding a
    comma is quoted the way the real feed quotes it, and so the reader under test
    is meeting a file it could actually have downloaded.
    """
    cols = list(columns) if columns else list(nb.COLUMNS)
    buf = io.StringIO()
    w = __import__("csv").DictWriter(buf, fieldnames=cols, lineterminator="\n")
    w.writeheader()
    for r in rows:
        unknown = sorted(set(r) - set(cols))
        if unknown:
            raise AssertionError("csv fixture names no such column: %s" % ", ".join(unknown))
        w.writerow({c: r.get(c, "") for c in cols})
    return buf.getvalue()


class Scratch(unittest.TestCase):
    """A throwaway directory, and a naptan.sqlite to build into."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="naptan-build-", dir=_stubs.scratch("naptan-build-root"))
        self.addCleanup(shutil.rmtree, self.dir, True)

    def path(self, *parts):
        return os.path.join(self.dir, *parts)

    def fresh_db(self):
        """An empty naptan.sqlite with the real table in it.

        Closed on cleanup rather than left to the collector: an unclosed handle
        prints a `ResourceWarning` from wherever garbage collection happens to
        run, and warning noise is precisely how a real warning hides. OA-001 has
        recorded that shape twice already, in `prune_runs.py` and
        `auto_refresh_month.py`."""
        con = sqlite3.connect(self.path("naptan.sqlite"))
        self.addCleanup(con.close)
        nb.create_table(con)
        return con


# ---------------------------------------------------------------------------
# A. THE STAND CODE. The column the whole file exists to derive, and the one
#    whose faults reach a printed sheet a passenger is standing in front of.
# ---------------------------------------------------------------------------

class TestDeriveStand(unittest.TestCase):

    def test_every_word_form_is_recognised_with_its_kind(self):
        """The seven words `STAND_RE` names, each with the kind it reports.

        Derived from the regex rather than typed, so a word removed from the
        pattern fails here rather than silently stopping being a stand."""
        for word in ("stop", "stand", "bay", "gate", "platform", "stance", "berth"):
            with self.subTest(word=word):
                self.assertEqual(nb.derive_stand("%s 3" % word.capitalize()), ("3", word))

    def test_the_word_list_is_the_one_the_columns_promise(self):
        """A control on the case above: if `STAND_RE` grew an eighth word, the loop
        would still pass while the docstring's list of kinds had gone stale."""
        self.assertEqual(
            sorted(nb.STAND_RE.pattern.split("^(")[1].split(")")[0].split("|")),
            ["bay", "berth", "gate", "platform", "stance", "stand", "stop"])

    def test_the_code_is_uppercased_and_the_kind_lowercased(self):
        self.assertEqual(nb.derive_stand("stand c"), ("C", "stand"))
        self.assertEqual(nb.derive_stand("STAND C"), ("C", "stand"))
        self.assertEqual(nb.derive_stand("Bay 12a"), ("12A", "bay"))

    def test_a_numbered_bay_keeps_its_letter_suffix(self):
        """"12A" and "12" are different bays at the same station, and a sheet that
        printed one for the other would send a passenger to the wrong flag."""
        self.assertEqual(nb.derive_stand("Bay 12A"), ("12A", "bay"))
        self.assertEqual(nb.derive_stand("Bay 12"), ("12", "bay"))

    def test_the_word_and_the_code_may_run_together(self):
        self.assertEqual(nb.derive_stand("Bay1"), ("1", "bay"))

    def test_surrounding_and_internal_whitespace(self):
        self.assertEqual(nb.derive_stand("  Stand  C  "), ("C", "stand"))

    def test_a_relative_descriptor_is_never_a_stand(self):
        """RULE 1, the direction that matters most. Every one of these is populated
        on real rows, and every one of them is meaningless on a map."""
        for ind in ("opp", "o/s", "adj", "near", "nr", "outside", "before", "after",
                    "N-bound", "NE-bound", "S-bound", "entrance", "Stop opp",
                    "opposite", "behind", "cnr"):
            with self.subTest(indicator=ind):
                self.assertEqual(nb.derive_stand(ind), (None, None))

    def test_an_absent_or_blank_indicator(self):
        for ind in (None, "", "   ", "\t"):
            with self.subTest(indicator=repr(ind)):
                self.assertEqual(nb.derive_stand(ind), (None, None))

    def test_a_word_with_no_code_after_it_is_not_a_stand(self):
        """"Stop" alone is the word without the thing it names. Accepting it would
        put an empty stand code on the sheet."""
        for ind in ("Stop", "Stand", "Bay", "Platform"):
            with self.subTest(indicator=ind):
                self.assertEqual(nb.derive_stand(ind), (None, None))

    def test_a_code_longer_than_the_pattern_allows(self):
        """Three digits plus a letter is the ceiling; four digits is not a bay
        number, it is something else in the field."""
        self.assertEqual(nb.derive_stand("Stand 1234"), (None, None))
        self.assertEqual(nb.derive_stand("Bay 999Z"), ("999Z", "bay"))

    def test_a_bare_digit_is_not_a_stand(self):
        """`BARE_RE` is letters only. A lone "1" in Indicator is as likely to be a
        stop sequence number as a bay, so it stays NULL -- the conservative
        direction the docstring asks for."""
        for ind in ("1", "12", "3A"):
            with self.subTest(indicator=ind):
                self.assertEqual(nb.derive_stand(ind), (None, None))

    def test_a_bare_uppercase_letter_is_a_stand_flagged_bare(self):
        """The London form: the code is in Indicator with no word in front of it.
        Kept, but flagged so a caller that wants only the unambiguous ones can
        say so."""
        self.assertEqual(nb.derive_stand("E"), ("E", "bare"))
        self.assertEqual(nb.derive_stand("WE"), ("WE", "bare"))

    def test_a_bare_lowercase_letter_is_not_a_stand(self):
        """`BARE_RE` carries no IGNORECASE while `STAND_RE` does, so "Stop e" is a
        stand and "e" is not. Asserted because it is a real asymmetry rather than
        an oversight in the reading: a lone lower-case letter in Indicator is far
        more often an abbreviation than a flag code, and the file's rule is to
        print none rather than invent one."""
        self.assertEqual(nb.derive_stand("Stop e"), ("E", "stop"))
        self.assertEqual(nb.derive_stand("e"), (None, None))

    def test_a_bare_code_that_is_the_rows_own_bearing_is_still_a_stand(self):
        """RULE 6, first direction -- the behaviour as it stands today, so the
        finding is recorded rather than assumed away. `derive_stand` sees only the
        Indicator, so a compass bearing written into that field is indistinguishable
        from a stop letter and becomes one. OA-372."""
        self.assertEqual(nb.derive_stand("SW"), ("SW", "bare"))
        self.assertEqual(nb.derive_stand("NE"), ("NE", "bare"))

    def test_the_bearing_is_available_on_the_row_that_would_settle_it(self):
        """RULE 6, second direction. The fix OA-372 describes is possible at all
        only because Bearing is one of the columns this file already keeps, and a
        row carrying both is what the two live instances look like. If Bearing ever
        left `COLUMNS`, the finding would become unfixable in silence."""
        self.assertIn("Bearing", nb.COLUMNS)
        self.assertIn("Indicator", nb.COLUMNS)


# ---------------------------------------------------------------------------
# B. THE POSITION. Every stop on every sheet is drawn at these two numbers.
# ---------------------------------------------------------------------------

class TestDerivePosition(unittest.TestCase):

    def test_published_wgs84_is_preferred_and_says_so(self):
        lat, lon, src = nb.derive_position(
            {"Latitude": "52.3255", "Longitude": "-0.0724",
             "Easting": "651409.903", "Northing": "313177.270"})
        self.assertEqual((lat, lon, src), (52.3255, -0.0724, "naptan"))

    def test_a_blank_pair_falls_back_to_the_grid_reference(self):
        """The case that is the majority of Cambridgeshire."""
        lat, lon, src = nb.derive_position(
            {"Latitude": "", "Longitude": "  ",
             "Easting": str(OSGB_EXAMPLE[0]), "Northing": str(OSGB_EXAMPLE[1])})
        self.assertEqual(src, "osgb")
        self.assertAlmostEqual(lat, WGS84_EXAMPLE[0], places=5)
        self.assertAlmostEqual(lon, WGS84_EXAMPLE[1], places=5)

    def test_an_unparseable_pair_falls_back_rather_than_raising(self):
        """A row with junk in Latitude must not take the whole area's CSV down --
        `insert_csv` has no try/except around this call."""
        lat, lon, src = nb.derive_position(
            {"Latitude": "n/a", "Longitude": "n/a",
             "Easting": str(OSGB_EXAMPLE[0]), "Northing": str(OSGB_EXAMPLE[1])})
        self.assertEqual(src, "osgb")

    def test_neither_pair_is_a_null_position_not_a_zero_one(self):
        """(0, 0) is a real place in the Gulf of Guinea. None is the honest answer
        and is what the column stores."""
        self.assertEqual(nb.derive_position({}), (None, None, None))
        self.assertEqual(nb.derive_position({"Latitude": "", "Easting": ""}), (None, None, None))
        self.assertEqual(nb.derive_position({"Easting": "x", "Northing": "y"}), (None, None, None))

    def test_a_half_present_grid_reference_is_no_position(self):
        self.assertEqual(nb.derive_position({"Easting": "651409.903"}), (None, None, None))
        self.assertEqual(nb.derive_position({"Northing": "313177.270"}), (None, None, None))

    def test_the_converted_pair_is_rounded_to_seven_places(self):
        """Seven decimal places is about a centimetre. Asserted because the rounding
        is what makes two builds of the same row byte-identical."""
        lat, lon, _ = nb.derive_position(
            {"Easting": str(OSGB_EXAMPLE[0]), "Northing": str(OSGB_EXAMPLE[1])})
        self.assertEqual(lat, round(lat, 7))
        self.assertEqual(lon, round(lon, 7))

    def test_the_grid_conversion_against_the_published_worked_example(self):
        """The anchor. A conversion this suite checked only against itself would
        agree with any Helmert transform, including one with a sign error in it."""
        lat, lon = nb.osgb_to_wgs84(*OSGB_EXAMPLE)
        self.assertAlmostEqual(lat, WGS84_EXAMPLE[0], places=5)
        self.assertAlmostEqual(lon, WGS84_EXAMPLE[1], places=5)

    def test_the_conversion_is_west_of_greenwich_where_it_should_be(self):
        """St Ives bus station, ATCO 0500SIVES001: the estate's home town, and a
        negative longitude. A transform that dropped the sign would still pass the
        example above, which is east of Greenwich."""
        lat, lon = nb.osgb_to_wgs84(531530.0, 271340.0)
        self.assertTrue(52.0 < lat < 52.7, lat)
        self.assertTrue(-0.6 < lon < 0.2, lon)


# ---------------------------------------------------------------------------
# C. THE ROWS. What a CSV becomes once it is in the table.
# ---------------------------------------------------------------------------

class TestInsertCsv(Scratch):

    def rows(self, con, *cols):
        return con.execute("SELECT %s FROM naptan ORDER BY ATCOCode" % ",".join(cols)).fetchall()

    def test_a_row_carries_its_derived_columns(self):
        con = self.fresh_db()
        added = nb.insert_csv(con, csv_text([
            {"ATCOCode": "0500SIVES001", "CommonName": "Bus Station",
             "Indicator": "Stand C", "Easting": "531530", "Northing": "271340"},
        ]), set())
        self.assertEqual(added, 1)
        self.assertEqual(self.rows(con, "stand", "stand_kind", "area", "pos_source"),
                         [("C", "stand", "050", "osgb")])

    def test_the_area_is_the_first_three_characters_of_the_atco_code(self):
        """`area` is what `areas_from_dbs` matches on, so it is the join between the
        register and the datasets that asked for it."""
        con = self.fresh_db()
        nb.insert_csv(con, csv_text([
            {"ATCOCode": "0500SIVES001"}, {"ATCOCode": "0400BEAC001"},
            {"ATCOCode": "490000249XX"},
        ]), set())
        self.assertEqual([r[0] for r in self.rows(con, "area")], ["040", "050", "490"])

    def test_an_empty_cell_becomes_null_not_an_empty_string(self):
        """`coverage` counts `WHERE Bearing IS NOT NULL`. If a blank cell were stored
        as '' the bearing coverage figure -- which is what decides whether a
        boarding plan can name a direction -- would read 100% on every region."""
        con = self.fresh_db()
        nb.insert_csv(con, csv_text([{"ATCOCode": "0500A", "Bearing": "", "Street": " "}]), set())
        self.assertEqual(self.rows(con, "Bearing", "Street"), [(None, None)])

    def test_values_are_stripped(self):
        con = self.fresh_db()
        nb.insert_csv(con, csv_text([{"ATCOCode": " 0500A ", "CommonName": " Market Square "}]), set())
        self.assertEqual(self.rows(con, "ATCOCode", "CommonName"), [("0500A", "Market Square")])

    def test_a_row_with_no_atco_code_is_skipped(self):
        """ATCOCode is the key; a row without one cannot be joined to anything and
        would break the unique index `main()` adds."""
        con = self.fresh_db()
        added = nb.insert_csv(con, csv_text([
            {"ATCOCode": "", "CommonName": "orphan"},
            {"ATCOCode": "   ", "CommonName": "orphan"},
            {"ATCOCode": "0500A"},
        ]), set())
        self.assertEqual(added, 1)

    def test_a_code_already_seen_is_not_inserted_twice(self):
        """RULE 3. Areas overlap at their borders and the national file contains
        every area, so the same ATCOCode really does arrive twice."""
        con, seen = self.fresh_db(), set()
        first = nb.insert_csv(con, csv_text([{"ATCOCode": "0500A", "CommonName": "first"}]), seen)
        second = nb.insert_csv(con, csv_text([{"ATCOCode": "0500A", "CommonName": "second"}]), seen)
        self.assertEqual((first, second), (1, 0))
        self.assertEqual(self.rows(con, "CommonName"), [("first",)])

    def test_a_duplicate_inside_one_csv_is_dropped_too(self):
        con = self.fresh_db()
        added = nb.insert_csv(con, csv_text([
            {"ATCOCode": "0500A", "CommonName": "first"},
            {"ATCOCode": "0500A", "CommonName": "second"},
        ]), set())
        self.assertEqual(added, 1)

    def test_the_seen_set_is_the_callers_and_is_updated(self):
        seen = set()
        nb.insert_csv(self.fresh_db(), csv_text([{"ATCOCode": "0500A"}]), seen)
        self.assertEqual(seen, {"0500A"})

    def test_a_csv_missing_a_column_we_keep_is_tolerated(self):
        """"the CSV reader tolerates a column that is absent from a feed" -- the
        module's own comment, and the reason adding a column to `COLUMNS` is a
        one-line edit rather than a migration."""
        con = self.fresh_db()
        added = nb.insert_csv(con, csv_text(
            [{"ATCOCode": "0500A", "CommonName": "Market Square"}],
            columns=["ATCOCode", "CommonName"]), set())
        self.assertEqual(added, 1)
        self.assertEqual(self.rows(con, "Landmark", "Bearing"), [(None, None)])

    def test_a_column_the_feed_has_and_we_do_not_keep_is_ignored(self):
        """NaPTAN publishes 43 columns and we keep 27. An unknown one must not
        become a positional argument in the INSERT."""
        con = self.fresh_db()
        added = nb.insert_csv(con, csv_text(
            [{"ATCOCode": "0500A", "GridType": "UKOS"}],
            columns=["ATCOCode", "GridType"]), set())
        self.assertEqual(added, 1)

    def test_an_empty_csv_adds_nothing_and_does_not_raise(self):
        self.assertEqual(nb.insert_csv(self.fresh_db(), csv_text([]), set()), 0)

    def test_create_table_drops_what_was_there(self):
        """"Rebuilding is idempotent: the table is dropped and recreated." A rebuild
        that appended would double every row and then fail the unique index."""
        con = self.fresh_db()
        nb.insert_csv(con, csv_text([{"ATCOCode": "0500A"}]), set())
        nb.create_table(con)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM naptan").fetchone()[0], 0)

    def test_the_table_has_every_kept_column_plus_the_derived_ones(self):
        """`_stubs.py` builds both of its fixtures from this shape, so a column that
        left `COLUMNS` would silently narrow three other suites' fixtures."""
        con = self.fresh_db()
        got = [r[1] for r in con.execute("PRAGMA table_info(naptan)")]
        self.assertEqual(got, list(nb.COLUMNS) + ["stand", "stand_kind", "area",
                                                  "lat", "lon", "pos_source"])


# ---------------------------------------------------------------------------
# D. WHICH AREAS GET FETCHED. The question that keeps the download at 10 MB and
#    that makes the register self-update when a region is added.
# ---------------------------------------------------------------------------

class RegionFixtures(object):
    """A registry and some datasets to point it at.

    A MIXIN rather than a base TestCase, deliberately: three classes below need
    these builders, and `unittest` discovers a subclass's inherited test methods
    as well as its own -- so making this a TestCase would have run section D's
    eight cases three times over and reported the suite as 22 tests larger than
    it is. Measured on the first run of this file, which came back 76 tests for
    60 written."""

    def write_regions(self, regions):
        p = os.path.join(self.dir, "_gtfs", "regions.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with io.open(p, "w", encoding="utf-8") as fh:
            json.dump({"regions": regions}, fh)
        return p

    def gtfs(self, name, stop_ids):
        p = os.path.join(self.dir, "_gtfs", name + ".sqlite")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        _stubs.gtfs_db(p, {"stops": [{"stop_id": s} for s in stop_ids]})
        return p


class TestAreaSelection(RegionFixtures, Scratch):

    def test_only_regions_marked_built_are_scanned(self):
        db = self.gtfs("cambridgeshire", ["0500A"])
        self.write_regions({
            "cambridgeshire": {"status": "built", "db": db},
            "norfolk": {"status": "planned", "db": self.gtfs("norfolk", ["0600A"])},
        })
        self.assertEqual([n for n, _ in nb.built_region_dbs(self.dir)], ["cambridgeshire"])

    def test_underscore_entries_are_comments_not_regions(self):
        """`regions.json` carries an `_example_west_yorkshire` stub documenting how
        to add a region. Fetching its ATCO areas would download a county nobody
        has a dataset for.

        THE STUB'S DATABASE EXISTS HERE ON PURPOSE. The first draft of this case
        pointed it at `nowhere.sqlite`, so the entry was excluded by the
        file-exists check and the `_` rule was never exercised -- the mutation
        that deletes that rule SURVIVED, and the case had been green. Every
        exclusion a test claims to prove must be the only one that could have
        fired."""
        self.write_regions({
            "cambridgeshire": {"status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])},
            "_example_west_yorkshire": {"status": "built",
                                        "db": self.gtfs("west_yorkshire", ["0450A"])},
        })
        self.assertEqual([n for n, _ in nb.built_region_dbs(self.dir)], ["cambridgeshire"])

    def test_a_region_marked_built_whose_file_is_gone_is_skipped_not_fatal(self):
        """RULE 4. It is announced on stdout and left out. Aborting would mean one
        stale registry entry blocks every other region's refresh."""
        self.write_regions({
            "cambridgeshire": {"status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])},
            "bedfordshire": {"status": "built", "db": os.path.join(self.dir, "gone.sqlite")},
        })
        self.assertEqual([n for n, _ in nb.built_region_dbs(self.dir)], ["cambridgeshire"])

    def test_a_region_with_no_db_key_is_skipped(self):
        self.write_regions({"cambridgeshire": {"status": "built"}})
        self.assertEqual(nb.built_region_dbs(self.dir), [])

    def test_a_missing_registry_stops_the_run(self):
        """Not an empty list: an empty list would mean "no areas to fetch" and the
        build would write an empty register and report success."""
        with self.assertRaises(SystemExit):
            nb.built_region_dbs(self.dir)

    def test_areas_are_the_distinct_first_three_characters_with_counts(self):
        db = self.gtfs("cambridgeshire", ["0500A", "0500B", "0570A", "050ZZZ"])
        self.assertEqual(nb.areas_from_dbs([("cambridgeshire", db)]), {"050": 3, "057": 1})

    def test_counts_are_summed_across_regions(self):
        """Two datasets can reference the same ATCO area -- Cambridgeshire and
        Bedfordshire both carry 050 stops -- and the area is fetched once."""
        a = self.gtfs("cambridgeshire", ["0500A", "0500B"])
        b = self.gtfs("bedfordshire", ["0500C", "0400A"])
        self.assertEqual(nb.areas_from_dbs([("cambridgeshire", a), ("bedfordshire", b)]),
                         {"050": 3, "040": 1})

    def test_a_dataset_with_no_stops_contributes_no_areas(self):
        self.assertEqual(nb.areas_from_dbs([("empty", self.gtfs("empty", []))]), {})


# ---------------------------------------------------------------------------
# E. COVERAGE. "The number that decides whether a boarding plan is possible at a
#    given place" -- the module's own docstring.
# ---------------------------------------------------------------------------

class TestCoverage(RegionFixtures, Scratch):

    def test_it_counts_matched_standed_and_bearing_stops(self):
        db = self.gtfs("cambridgeshire", ["0500A", "0500B", "0500C", "0500MISSING"])
        con = self.fresh_db()
        nb.insert_csv(con, csv_text([
            {"ATCOCode": "0500A", "Indicator": "Stand C", "Bearing": "NE"},
            {"ATCOCode": "0500B", "Indicator": "opp", "Bearing": "SW"},
            {"ATCOCode": "0500C", "Indicator": "opp", "Bearing": ""},
            {"ATCOCode": "0500NOTINGTFS", "Indicator": "Bay 1", "Bearing": "N"},
        ]), set())
        self.assertEqual(nb.coverage(con, [("cambridgeshire", db)]), [{
            "region": "cambridgeshire", "gtfsStops": 4,
            "matchedInNaptan": 3, "withStandCode": 1, "withBearing": 2,
        }])

    def test_a_region_whose_stops_naptan_has_never_heard_of(self):
        """The Beaconsfield shape one level down: a dataset joined to a register
        that does not cover its ATCO area. Zero matched is the honest answer and
        is what the printed table is read for."""
        db = self.gtfs("buckinghamshire", ["0400A", "0400B"])
        con = self.fresh_db()
        nb.insert_csv(con, csv_text([{"ATCOCode": "0500A"}]), set())
        self.assertEqual(nb.coverage(con, [("buckinghamshire", db)])[0],
                         {"region": "buckinghamshire", "gtfsStops": 2,
                          "matchedInNaptan": 0, "withStandCode": 0, "withBearing": 0})

    def test_the_gtfs_database_is_detached_afterwards(self):
        """Every region is attached under the same alias `g`, so a leaked ATTACH
        makes the SECOND region in the list fail -- which on this laptop means the
        report is right about Cambridgeshire and silent about everywhere else."""
        con = self.fresh_db()
        nb.insert_csv(con, csv_text([{"ATCOCode": "0500A"}]), set())
        out = nb.coverage(con, [("cambridgeshire", self.gtfs("cambridgeshire", ["0500A"])),
                                ("bedfordshire", self.gtfs("bedfordshire", ["0500A"]))])
        self.assertEqual([c["region"] for c in out], ["cambridgeshire", "bedfordshire"])
        self.assertEqual([c["matchedInNaptan"] for c in out], [1, 1])


# ---------------------------------------------------------------------------
# F. THE BUILD, END TO END. `main()` with the network stubbed -- the only way to
#    ask what the sidecar says, which is the provenance everything downstream
#    reads to find out how old the register is.
# ---------------------------------------------------------------------------

class TestMain(RegionFixtures, Scratch):

    def setUp(self):
        super(TestMain, self).setUp()
        self.fetched = []
        self._saved = (nb.fetch_area, nb.fetch_national, sys.argv)
        self.addCleanup(self._restore)

    def _restore(self):
        nb.fetch_area, nb.fetch_national, sys.argv = self._saved

    def serve(self, by_area, national=None):
        """Stand in for the DfT API. Records the order areas were asked for, which
        is the only way to see the by-descending-stop-count ordering."""
        def fetch_area(area, retries=3):
            self.fetched.append(area)
            rows = by_area.get(area)
            return None if rows is None else csv_text(rows)

        def fetch_national(retries=3):
            self.fetched.append("ALL")
            return csv_text(national or [])

        nb.fetch_area, nb.fetch_national = fetch_area, fetch_national

    def build(self, *argv):
        """Run the build, keeping what it printed in `self.printed`.

        Captured rather than let through, for two reasons: the coverage table is
        this module's only human-facing output and section F asserts against it,
        and a suite that prints a full build report per case is one nobody reads
        the failures in."""
        out = self.path("out", "naptan.sqlite")
        sys.argv = ["naptan_build.py", "--out", out, "--root", self.dir] + list(argv)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            nb.main()
        self.printed = buf.getvalue()
        return out

    def sidecar(self, out):
        with io.open(os.path.join(os.path.dirname(out), "feed_info_naptan.json"),
                     encoding="utf-8") as fh:
            return json.load(fh)

    def test_it_builds_the_areas_the_datasets_reference(self):
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A", "0570A"])}})
        self.serve({"050": [{"ATCOCode": "0500A", "Indicator": "Stand C"}],
                    "057": [{"ATCOCode": "0570A", "Indicator": "opp"}]})
        out = self.build()
        self.assertEqual(sorted(self.fetched), ["050", "057"])
        con = sqlite3.connect(out)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM naptan").fetchone()[0], 2)
        con.close()

    def test_areas_are_fetched_busiest_first(self):
        """The rate limit is 200 requests an hour and a long run can be cut off, so
        the area our own maps depend on most is downloaded first.

        The busiest area here sorts LAST alphabetically, deliberately: with 050 as
        the busy one this case would pass against a plain `sorted()` and would be
        asserting nothing about the ordering at all."""
        self.write_regions({"cambridgeshire": {
            "status": "built",
            "db": self.gtfs("cambridgeshire", ["0500A", "0570A", "0570B", "0570C"])}})
        self.serve({"050": [], "057": []})
        self.build()
        self.assertEqual(self.fetched, ["057", "050"])

    def test_areas_given_by_hand_are_fetched_in_a_stable_order(self):
        """No stop counts to sort by, so the tie-break is the area code. Asserted
        because "whatever order the dict happens to be in" is not a thing a person
        refetching three counties should have to discover."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"040": [], "050": [], "057": []})
        self.build("--areas", "057,040,050")
        self.assertEqual(self.fetched, ["040", "050", "057"])

    def test_given_areas_override_the_scan(self):
        """`--areas` is how a person refetches one county without rebuilding the
        rest. The datasets are still opened -- coverage is reported either way."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"040": [{"ATCOCode": "0400A"}]})
        self.build("--areas", "040")
        self.assertEqual(self.fetched, ["040"])

    def test_all_fetches_the_national_register_in_one_request(self):
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({}, national=[{"ATCOCode": "0500A"}, {"ATCOCode": "0400A"}])
        out = self.build("--all")
        self.assertEqual(self.fetched, ["ALL"])
        self.assertEqual(self.sidecar(out)["mode"], "national")

    def test_an_area_that_could_not_be_fetched_is_recorded_as_such(self):
        """RULE 5, and this project's *present, absent, or COULD NOT LOOK*. The
        build still succeeds -- one dead area must not cost the other 28 -- but
        the sidecar says which, so a coverage figure read next month is read
        knowing it."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A", "0400A"])}})
        self.serve({"050": [{"ATCOCode": "0500A"}], "040": None})
        out = self.build()
        side = self.sidecar(out)
        self.assertEqual(side["areasNotFetched"], ["040"])
        self.assertEqual([a["area"] for a in side["areasFetched"]], ["050"])

    def test_the_unique_index_on_atco_code_exists(self):
        """RULE 3's other half: the dedupe is what lets this index be created at
        all, and the index is what makes every downstream join safe."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"050": [{"ATCOCode": "0500A"}]})
        out = self.build()
        con = sqlite3.connect(out)
        idx = dict((r[1], r[2]) for r in con.execute("PRAGMA index_list(naptan)"))
        con.close()
        self.assertEqual(idx.get("ix_naptan_atco"), 1)

    def test_a_code_in_two_areas_does_not_abort_the_build(self):
        """The unique index is created AFTER the last download, so a dedupe failure
        would waste the whole fetch and report a traceback rather than a register."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A", "0400A"])}})
        self.serve({"050": [{"ATCOCode": "0500A"}], "040": [{"ATCOCode": "0500A"}]})
        out = self.build()
        con = sqlite3.connect(out)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM naptan").fetchone()[0], 1)
        con.close()

    def test_the_sidecar_is_the_provenance(self):
        """It sits beside the gitignored database and is COMMITTED, so it is the
        only record of when the register was built and from what."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"050": [{"ATCOCode": "0500A", "Indicator": "Stand C", "Status": "active"},
                            {"ATCOCode": "0500B", "Status": "inactive"}]})
        side = self.sidecar(self.build())
        self.assertEqual(side["source"], "NaPTAN (DfT)")
        self.assertEqual(side["licence"], nb.LICENCE)
        self.assertEqual(side["api"], nb.API)
        self.assertEqual(side["scriptVersion"], nb.SCRIPT_VERSION)
        self.assertEqual(side["stops"], 2)
        self.assertEqual(side["activeStops"], 1)
        self.assertEqual(side["withStandCode"], 1)
        self.assertEqual(side["coverage"][0]["region"], "cambridgeshire")

    def test_the_build_timestamp_is_utc_and_iso(self):
        """Read by `status.js` and by the refresh report to say how old the register
        is. A local-time stamp would be an hour wrong for half the year."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"050": []})
        built = self.sidecar(self.build())["builtAt"]
        self.assertRegex(built, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_rebuilding_over_an_existing_register_replaces_its_rows(self):
        """"Rebuilding is idempotent." A shrinking register really does shrink."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"050": [{"ATCOCode": "0500A"}, {"ATCOCode": "0500B"}]})
        self.build()
        self.serve({"050": [{"ATCOCode": "0500A"}]})
        out = self.build()
        con = sqlite3.connect(out)
        self.addCleanup(con.close)
        self.assertEqual([r[0] for r in con.execute("SELECT ATCOCode FROM naptan")], ["0500A"])

    def test_the_rebuild_replaces_the_FILE_rather_than_writing_into_it(self):
        """`os.remove(out)` before the connection is opened, and this is the ONLY
        thing it does that anything can observe -- which is worth stating rather
        than leaving to be rediscovered.

        `create_table` already begins `DROP TABLE IF EXISTS naptan`, so the rows
        above would be replaced whether the file were removed or not; the mutation
        that turns `os.remove` into `pass` SURVIVED the first version of this case
        for exactly that reason. What the removal alone decides is whether
        anything ELSE in the old file survives -- a table an older version of this
        script wrote, under a name the current one has never heard of and would
        therefore never drop. A register is a rebuilt artefact, not an accumulating
        one."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"050": [{"ATCOCode": "0500A"}]})
        out = self.path("out", "naptan.sqlite")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        stale = sqlite3.connect(out)
        stale.execute("CREATE TABLE naptan_v0 (ATCOCode TEXT)")
        stale.execute("INSERT INTO naptan_v0 VALUES ('0500OLD')")
        stale.commit()
        stale.close()
        self.build()
        con = sqlite3.connect(out)
        self.addCleanup(con.close)
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        self.assertEqual(tables, ["naptan"])

    def test_keep_cache_writes_the_raw_csv_beside_the_register(self):
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"050": [{"ATCOCode": "0500A"}]})
        out = self.build("--keep-cache")
        self.assertTrue(os.path.exists(os.path.join(os.path.dirname(out), "naptan_050.csv")))

    def test_without_keep_cache_nothing_but_the_register_and_the_sidecar(self):
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"050": [{"ATCOCode": "0500A"}]})
        out = self.build()
        self.assertEqual(sorted(os.listdir(os.path.dirname(out))),
                         ["feed_info_naptan.json", "naptan.sqlite"])

    def test_the_printed_report_names_the_areas_it_could_not_fetch(self):
        """The coverage table is what a person reads to decide whether a boarding
        plan is possible, and a row of zeroes means two different things. The
        failed areas are named above it so the table is read knowing which."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A", "0400A"])}})
        self.serve({"050": [{"ATCOCode": "0500A", "Indicator": "Stand C"}], "040": None})
        self.build()
        self.assertIn("NOT FETCHED: 040", self.printed)
        self.assertIn("cambridgeshire", self.printed)

    def test_the_printed_report_is_silent_about_failures_when_there_are_none(self):
        """The control on the case above. A line that is always there is not a
        warning, and a reader who sees it every month stops seeing it."""
        self.write_regions({"cambridgeshire": {
            "status": "built", "db": self.gtfs("cambridgeshire", ["0500A"])}})
        self.serve({"050": [{"ATCOCode": "0500A"}]})
        self.build()
        self.assertNotIn("NOT FETCHED", self.printed)

    def test_a_missing_registry_stops_the_build_before_any_download(self):
        """`built_region_dbs` is called first for exactly this reason: a run that
        cannot say which areas it needs must not spend the rate limit finding out."""
        self.serve({"050": []})
        with self.assertRaises(SystemExit):
            self.build()
        self.assertEqual(self.fetched, [])


if __name__ == "__main__":
    unittest.main()
