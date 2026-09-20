"""gtfs_build.py -- the module every service on every sheet is read out of, and the schema every GTFS fixture in this folder is built from.

THE SECOND HALF OF A PAIR. `_stubs.py` loads exactly two engine modules:
`naptan_build` for the stop register and `gtfs_build` for the bus feed. The first
got its suite on 2026-09-15 under the heading *the module three other suites were
already standing on*; this is the other one, and it is standing under more. Every
GTFS fixture in `test_gtfs_query.py`, `test_gtfs_places.py`, `test_gtfs_upcoming.py`,
`test_gtfs_duration.py`, `test_gtfs_regions.py` and `test_boarding_verify.py` is
created by `_stubs.gtfs_db`, whose tables and columns come from this file's
`TABLES` and from nowhere else. So `TABLES` has been the declared shape of the
whole Python suite's world while nothing asked whether it was the shape
`load_full` actually writes -- and if the two ever parted, every one of those
fixtures would be a correct assertion about a table the builder does not make.
Section A is that join, and it is the case this file exists for.

WHY IT IS DARK, WHICH IS THE SAME REASON AS ITS SIBLING'S AND WORSE. It runs from
a person's hand when the feed is reissued, it draws nothing, and its output --
`_gtfs/cambridgeshire.sqlite`, ~80 MB -- is gitignored, so no byte gate, no
quality ratchet and no board has ever had an opinion about it. A sheet built from
a wrongly filtered feed is perfectly reproducible and gates green everywhere. The
difference from `naptan_build.py` is what a fault looks like: a wrong stand code
is visible to a passenger standing at the flag, whereas a route this filter
silently dropped is a bus that simply never appears on the map, and nothing on
the sheet says it is missing.

THE FOUR RULES BELOW ARE THE ONES THE MODULE'S OWN DOCSTRING CALLS LOAD-BEARING.

1. THE COLUMNS ARE MATCHED BY NAME, NEVER BY POSITION. `load_full` reads each
   member's real header and builds `idx` from it, so a feed that reorders its
   columns, adds new ones, or omits one of ours still lands in the right place.
   BODS reissues this feed about weekly and nothing anywhere pins its column
   order. A positional read would not fail -- it would put `stop_lat` in
   `stop_name` and draw the estate at the wrong coordinates.

2. FULL CHAINS ARE KEPT, INCLUDING OUT-OF-COUNTY TERMINI. The file's headline
   claim: *Filters to trips that call at any Cambridgeshire (ATCO 0500*) or
   Peterborough (0570*) stop, keeping FULL route chains incl. out-of-county
   termini.* `keep_trips` is chosen by the prefix, and then every table is taken
   by what the KEPT TRIPS reference rather than by the prefix again. That is what
   puts Norwich on a St Ives external sheet. Filtering `stops` by prefix a second
   time is the plausible wrong version, and it would quietly truncate every route
   at the county boundary -- which is exactly what an external map is for.

3. A PREFIX IS ANCHORED AT THE START OF THE ATCO CODE. `LIKE '0500%'`, not
   `LIKE '%0500%'`. Stop ids elsewhere in the country contain our digits --
   `2500XYZ0500` is the fixture -- and an unanchored match would pull in trips
   from another region entirely, which on this feed means tens of thousands of
   them.

4. ONE SIDECAR PER DATASET, NAMED FOR THE DATASET. `feed_info_<dbstem>.json`,
   never a bare `feed_info.json`. The module carries eight lines of comment about
   why, and they record a real fault: until 2026-08-21 it wrote BOTH, and
   `gtfs_regions.feed_info()` fell back to the unsuffixed one, so any region whose
   own sidecar was missing silently reported Cambridgeshire's build date and
   validity window as its own -- "a wrong answer indistinguishable from a right
   one". Section D asserts both halves, because only the second of them says the
   fallback cannot come back.

HOW THE `__main__` BLOCK IS REACHED. Unlike `naptan_build.py` this file has no
`main()`: the prefix parsing, the temp-file handling and the sidecar all live
inside `if __name__=="__main__":`, so `_engine.load` cannot execute any of it --
the module is loaded under a private name, which is the whole point of that
indirection. Section D runs the file through `runpy.run_path(..., run_name=
"__main__")` with `sys.argv` patched, which is stdlib, in-process, and takes its
path from `_engine.ENGINE_DIR` so a mutation run gets the mutated copy like every
other case here. A subprocess would work too and nothing else in this folder
spawns one; in-process keeps the captured stdout and the coverage of a mutated
copy in one mechanism.

WHAT IS DELIBERATELY NOT ASSERTED, so the next reader does not take the silence
for an oversight. The 50,000-row batch flush in `load_full` has NO observable
effect on content -- the trailing `if batch` flushes the remainder, so any batch
size loads exactly the same rows and only peak memory differs. Asserting a row
count across the boundary would need a 50,001-row fixture and would prove nothing
the small ones do not. For the same reason it carries no mutation: a harness case
for it would be reported SURVIVED for ever, which is the wrong signal about a line
that is correct. The `finally` that removes the temp full-feed database is not
asserted either -- its name is chosen inside the block and never printed, so
nothing outside can name the file to look for.

WHAT WRITING THE SUITE FIXED. Three file handles in the module were never closed
-- the `ZipFile` in `load_full`, and the `ZipFile` and the sidecar's bare `open()`
in the `__main__` block -- so the first green run printed nine `ResourceWarning`s
naming `gtfs_build.py:117` from wherever the collector happened to fire. That is
the shape OA-001 has now met three times, in `prune_runs.py` and
`auto_refresh_month.py` before this, and it is worth fixing rather than
suppressing for the reason those two recorded: warning noise is precisely how a
real warning hides, and a suite that arrives shouting is one whose next genuine
warning nobody reads. The sidecar write also gained an explicit `encoding="utf-8"`
-- `json.dump` defaults to `ensure_ascii=True` so not a byte of any existing
sidecar moves, but a sidecar is read back by `gtfs_regions.feed_info()` and had
been written in whatever the machine's locale happened to be.

Every case builds its feed in a temp directory and not one opens
`C:\\u3a St Ives\\Using AI\\Buses\\_gtfs`: an assertion about the real database is
an assertion about what BODS published that week.
"""
import contextlib
import csv
import io
import json
import os
import runpy
import shutil
import sqlite3
import sys
import tempfile
import unittest
import zipfile

import _engine
import _stubs

gb = _engine.load("gtfs_build")


# --------------------------------------------------------------------------
# The fixture feed. Four stops, three trips, two routes, two operators -- small
# enough to write the expected answer out in full, and shaped so that every
# clause of `filter_cambs` has one row that must survive it and one that must
# not.
#
#   0500SIVE001  St Ives        kept prefix, Cambridgeshire
#   0570PBRO001  Peterborough   kept prefix, the second one
#   0590NORW001  Norwich        NOT a kept prefix -- the out-of-county terminus
#                               that rule 2 says must survive anyway
#   2500XYZ0500  Wigan          contains "0500" and does not start with it --
#                               rule 3's fixture, and the only stop that must
#                               disappear
# --------------------------------------------------------------------------

STOPS = [
    {"stop_id": "0500SIVE001", "stop_code": "CMBDWJPG", "stop_name": "St Ives Bus Station",
     "stop_lat": "52.3234", "stop_lon": "-0.0724"},
    {"stop_id": "0570PBRO001", "stop_code": "PBROGATE", "stop_name": "Peterborough Queensgate",
     "stop_lat": "52.5736", "stop_lon": "-0.2478"},
    {"stop_id": "0590NORW001", "stop_code": "NORWSTAT", "stop_name": "Norwich Bus Station",
     "stop_lat": "52.6221", "stop_lon": "1.2905"},
    {"stop_id": "2500XYZ0500", "stop_code": "WIGANBUS", "stop_name": "Wigan, not Cambridgeshire",
     "stop_lat": "53.5450", "stop_lon": "-2.6318"},
]

# agency.txt is written WITHOUT `agency_noc`. It is a BODS extension rather than a
# GTFS column, and a feed that omits it is the case rule 1's `else None` branch
# exists for -- so the default fixture exercises it rather than a special one.
AGENCY = [
    {"agency_id": "OP1", "agency_name": "Whippet Coaches"},
    {"agency_id": "OP2", "agency_name": "Somebody Else"},
]

ROUTES = [
    {"route_id": "r-1", "agency_id": "OP1", "route_short_name": "A",
     "route_long_name": "St Ives - Norwich", "route_type": "3"},
    {"route_id": "r-2", "agency_id": "OP2", "route_short_name": "X99",
     "route_long_name": "Wigan - Norwich", "route_type": "3"},
]

TRIPS = [
    # Calls at St Ives, then runs out of the county. KEPT, and its Norwich leg
    # and Norwich stop must come with it.
    {"route_id": "r-1", "service_id": "s-1", "trip_id": "t-1",
     "trip_headsign": "Norwich", "direction_id": "0", "shape_id": "sh-1"},
    # Calls at neither kept prefix. DROPPED -- and with it route r-2, operator
    # OP2, calendar s-2, its calendar_dates row, shape sh-2 and the Wigan stop.
    {"route_id": "r-2", "service_id": "s-2", "trip_id": "t-2",
     "trip_headsign": "Wigan", "direction_id": "0", "shape_id": "sh-2"},
    # Peterborough, and no shape at all. KEPT, and the empty shape_id must not
    # be used to select anything.
    {"route_id": "r-1", "service_id": "s-3", "trip_id": "t-3",
     "trip_headsign": "Peterborough", "direction_id": "1", "shape_id": ""},
]

STOP_TIMES = [
    {"trip_id": "t-1", "stop_id": "0500SIVE001", "stop_sequence": "1",
     "arrival_time": "09:00:00", "departure_time": "09:00:00"},
    {"trip_id": "t-1", "stop_id": "0590NORW001", "stop_sequence": "2",
     "arrival_time": "11:20:00", "departure_time": "11:20:00"},
    {"trip_id": "t-2", "stop_id": "2500XYZ0500", "stop_sequence": "1",
     "arrival_time": "07:15:00", "departure_time": "07:15:00"},
    {"trip_id": "t-2", "stop_id": "0590NORW001", "stop_sequence": "2",
     "arrival_time": "13:40:00", "departure_time": "13:40:00"},
    {"trip_id": "t-3", "stop_id": "0570PBRO001", "stop_sequence": "1",
     "arrival_time": "10:05:00", "departure_time": "10:05:00"},
]


def _calendar_row(service_id):
    row = {"service_id": service_id, "start_date": "20260101", "end_date": "20271231"}
    for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
        row[d] = "1"
    return row


CALENDAR = [_calendar_row("s-1"), _calendar_row("s-2"), _calendar_row("s-3")]

CALENDAR_DATES = [
    {"service_id": "s-1", "date": "20261225", "exception_type": "2"},
    {"service_id": "s-2", "date": "20261225", "exception_type": "2"},
]

SHAPES = [
    {"shape_id": "sh-1", "shape_pt_lat": "52.3234", "shape_pt_lon": "-0.0724", "shape_pt_sequence": "1"},
    {"shape_id": "sh-1", "shape_pt_lat": "52.6221", "shape_pt_lon": "1.2905", "shape_pt_sequence": "2"},
    {"shape_id": "sh-2", "shape_pt_lat": "53.5450", "shape_pt_lon": "-2.6318", "shape_pt_sequence": "1"},
    # A shape row whose id is the empty string. Trip t-3 carries shape_id "" and
    # the module excludes it explicitly; without that exclusion this row would be
    # selected by a trip that has no shape.
    {"shape_id": "", "shape_pt_lat": "0", "shape_pt_lon": "0", "shape_pt_sequence": "1"},
]


def csv_member(cols, rows):
    """A GTFS .txt member as the feed ships it -- a header line and `rows`.

    Written through `csv` rather than joined by hand so a value holding a comma
    is quoted the way the real feed quotes it, and so the reader under test is
    meeting a file it could actually have been handed. A fixture key naming no
    column in `cols` is an error rather than a silently dropped cell, which is
    `_stubs.py`'s rule and for its reason.
    """
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(cols), lineterminator="\n", extrasaction="raise")
    w.writeheader()
    for r in rows:
        unknown = sorted(set(r) - set(cols))
        if unknown:
            raise AssertionError("gtfs fixture names no such column: %s" % ", ".join(unknown))
        w.writerow({c: r.get(c, "") for c in cols})
    return buf.getvalue()


def feed_members(**overrides):
    """The whole fixture feed as {member name: text}, with per-member overrides.

    Each member's header is the module's own column list for that table, so the
    default feed is the easy case -- exactly our columns, in our order. The cases
    that matter override one member with a header the feed might really ship.
    """
    members = {
        "agency.txt": csv_member(["agency_id", "agency_name"], AGENCY),
        "stops.txt": csv_member(gb.TABLES["stops"], STOPS),
        "routes.txt": csv_member(gb.TABLES["routes"], ROUTES),
        "trips.txt": csv_member(gb.TABLES["trips"], TRIPS),
        "stop_times.txt": csv_member(gb.TABLES["stop_times"], STOP_TIMES),
        "calendar.txt": csv_member(gb.TABLES["calendar"], CALENDAR),
        "calendar_dates.txt": csv_member(gb.TABLES["calendar_dates"], CALENDAR_DATES),
        "shapes.txt": csv_member(gb.TABLES["shapes"], SHAPES),
        "feed_info.txt": csv_member(
            ["feed_publisher_name", "feed_start_date", "feed_end_date", "feed_version"],
            [{"feed_publisher_name": "Department for Transport", "feed_start_date": "20260901",
              "feed_end_date": "20270301", "feed_version": "itm_east_anglia 2026-09-01"}]),
    }
    for name, text in overrides.items():
        member = name.replace("__", ".")
        if text is None:
            members.pop(member, None)
        else:
            members[member] = text
    return members


class Feed(unittest.TestCase):
    """A throwaway directory, a zip to read and somewhere to build into."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="gtfs-build-", dir=_stubs.scratch("gtfs-build-root"))
        self.addCleanup(shutil.rmtree, self.dir, True)

    def path(self, *parts):
        return os.path.join(self.dir, *parts)

    def zip_of(self, members=None, name="feed.zip"):
        path = self.path(name)
        with zipfile.ZipFile(path, "w") as zf:
            for member, text in (members if members is not None else feed_members()).items():
                zf.writestr(member, text)
        return path

    def loaded(self, members=None):
        """The full feed, as `load_full` writes it. Returns the database path."""
        db = self.path("full.sqlite")
        with contextlib.redirect_stdout(io.StringIO()):
            gb.load_full(self.zip_of(members), db)
        return db

    def filtered(self, members=None, prefixes=None):
        """Load, then filter. Returns (out path, counts)."""
        full = self.loaded(members)
        out = self.path("out.sqlite")
        if prefixes is None:
            counts = gb.filter_cambs(full, out)
        else:
            counts = gb.filter_cambs(full, out, prefixes)
        return out, counts

    def rows(self, db, sql):
        con = sqlite3.connect(db)
        try:
            return [tuple(r) for r in con.execute(sql)]
        finally:
            con.close()

    def column(self, db, table, col):
        return sorted(r[0] for r in self.rows(db, "SELECT %s FROM %s" % (col, table)))


# ---------------------------------------------------------------------------
# A. THE SCHEMA THE WHOLE PYTHON SUITE IS BUILT FROM. `_stubs.gtfs_db` creates
#    its tables from `gb.TABLES`; `load_full` creates the real ones from the same
#    dict. Nothing has ever held the two against each other, or against a feed.
# ---------------------------------------------------------------------------

class TestTheDeclaredSchema(Feed):

    def test_the_stub_builder_and_the_real_builder_make_the_same_tables(self):
        """The join this file exists for.

        Every GTFS fixture in this folder is `_stubs.gtfs_db`'s output, and every
        assertion made against one is only about the real thing to the extent
        that the two databases have the same shape. Compared through
        `PRAGMA table_info`, so a column renamed, reordered or dropped on either
        side is a failure here rather than a fixture that is quietly about
        nothing."""
        real = self.loaded()
        stub = _stubs.gtfs_db(self.path("stub.sqlite"), {})
        for table in gb.TABLES:
            with self.subTest(table=table):
                shape = lambda db: [(r[1], r[2]) for r in self.rows(db, "PRAGMA table_info(%s)" % table)]
                self.assertEqual(shape(real), shape(stub))

    def test_every_declared_table_is_created_with_its_declared_columns(self):
        """A control on the case above, which would pass if BOTH were empty.

        It asserts the columns against `TABLES` itself, so the pair being equal
        to each other and equal to nothing is not a green run."""
        db = self.loaded()
        for table, cols in gb.TABLES.items():
            with self.subTest(table=table):
                got = [r[1] for r in self.rows(db, "PRAGMA table_info(%s)" % table)]
                self.assertEqual(got, list(cols))
                self.assertTrue(got, "%s was created with no columns" % table)

    def test_the_declared_tables_are_the_eight_gtfs_members_we_read(self):
        """A table quietly added to or removed from `TABLES` changes what every
        fixture in this folder contains, so the list is held rather than assumed."""
        self.assertEqual(sorted(gb.TABLES), [
            "agency", "calendar", "calendar_dates", "routes",
            "shapes", "stop_times", "stops", "trips"])

    def test_the_default_prefixes_are_cambridgeshire_and_peterborough(self):
        """0500 and 0570 are what makes this dataset the Cambridgeshire one; the
        name of the file says so and nothing else asserts it."""
        self.assertEqual(gb.KEEP_PREFIXES, ("0500", "0570"))


# ---------------------------------------------------------------------------
# B. READING THE ZIP. What a downloaded feed becomes once it is in sqlite --
#    rule 1, and the three shapes of malformed member a weekly reissue can hand
#    us without anybody being told.
# ---------------------------------------------------------------------------

class TestLoadFull(Feed):

    def test_every_row_of_every_member_is_loaded(self):
        db = self.loaded()
        self.assertEqual(self.rows(db, "SELECT COUNT(*) FROM stops"), [(4,)])
        self.assertEqual(self.rows(db, "SELECT COUNT(*) FROM trips"), [(3,)])
        self.assertEqual(self.rows(db, "SELECT COUNT(*) FROM stop_times"), [(5,)])
        self.assertEqual(self.rows(db, "SELECT COUNT(*) FROM shapes"), [(4,)])
        self.assertEqual(self.rows(db, "SELECT COUNT(*) FROM calendar"), [(3,)])
        self.assertEqual(self.rows(db, "SELECT COUNT(*) FROM calendar_dates"), [(2,)])

    def test_a_reordered_header_still_lands_in_the_right_columns(self):
        """Rule 1. BODS reissues this feed about weekly and pins no column order.

        A positional read would not fail -- it would put the latitude in
        `stop_name` and draw every stop on the estate somewhere else."""
        reversed_cols = list(reversed(gb.TABLES["stops"]))
        db = self.loaded(feed_members(stops__txt=csv_member(reversed_cols, STOPS)))
        self.assertEqual(
            self.rows(db, "SELECT stop_name, stop_lat FROM stops WHERE stop_id='0500SIVE001'"),
            [("St Ives Bus Station", "52.3234")])

    def test_a_column_the_feed_does_not_ship_lands_NULL(self):
        """`agency_noc` is a BODS extension, so a feed without it is ordinary.

        NULL rather than a shifted neighbour: the wrong version of this line puts
        the agency's ID in its NOC, which reads as a plausible operator code."""
        db = self.loaded()
        self.assertEqual(
            self.rows(db, "SELECT agency_id, agency_noc FROM agency WHERE agency_id='OP1'"),
            [("OP1", None)])

    def test_columns_the_feed_ships_and_we_do_not_read_are_ignored(self):
        """A feed that grows a column must not disturb the ones beside it."""
        cols = ["stop_id", "wheelchair_boarding", "stop_code", "platform_code",
                "stop_name", "stop_lat", "stop_lon", "zone_id"]
        rows = [dict(s, wheelchair_boarding="1", platform_code="B", zone_id="Z") for s in STOPS]
        db = self.loaded(feed_members(stops__txt=csv_member(cols, rows)))
        self.assertEqual(
            self.rows(db, "SELECT stop_code, stop_name FROM stops WHERE stop_id='0570PBRO001'"),
            [("PBROGATE", "Peterborough Queensgate")])

    def test_a_row_with_fewer_cells_than_the_header_is_read_without_failing(self):
        """Real feeds ship ragged rows. The guard is `i<len(row)`, and without it
        the whole build dies on one short line halfway through stop_times."""
        text = ",".join(gb.TABLES["stops"]) + "\n0500SIVE001,CMBDWJPG,St Ives Bus Station\n"
        db = self.loaded(feed_members(stops__txt=text))
        self.assertEqual(
            self.rows(db, "SELECT stop_name, stop_lat, stop_lon FROM stops"),
            [("St Ives Bus Station", None, None)])

    def test_a_byte_order_mark_does_not_become_part_of_the_first_column_name(self):
        """The feed is read as utf-8-sig. Without that the first header cell is
        `\\ufeffstop_id`, `hdr.index("stop_id")` misses, and every stop id in the
        database is NULL -- which joins to nothing and empties the estate."""
        db = self.loaded(feed_members(stops__txt="\ufeff" + csv_member(gb.TABLES["stops"], STOPS)))
        self.assertEqual(self.column(db, "stops", "stop_id"),
                         ["0500SIVE001", "0570PBRO001", "0590NORW001", "2500XYZ0500"])

    def test_a_member_the_zip_does_not_hold_is_announced_and_skipped(self):
        """GTFS makes `shapes.txt` optional and some operators ship none.

        Announced rather than silent, and skipped rather than fatal -- the third
        value this project insists on, `COULD NOT LOOK`, is the printed line."""
        out = io.StringIO()
        db = self.path("nofeed.sqlite")
        with contextlib.redirect_stdout(out):
            gb.load_full(self.zip_of(feed_members(shapes__txt=None)), db)
        self.assertIn("skip shapes.txt", out.getvalue())
        self.assertEqual(self.rows(db, "SELECT COUNT(*) FROM sqlite_master WHERE name='shapes'"), [(0,)])

    def test_the_two_stop_times_indexes_are_built_on_the_columns_the_filter_joins(self):
        """`filter_cambs` joins stop_times on trip_id and scans it on stop_id.
        Without these two the filter is a pair of full scans over ~9 million rows,
        which is the difference between a two-minute rebuild and an abandoned one."""
        db = self.loaded()
        got = {name: sql for name, sql in self.rows(
            db, "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='stop_times'")}
        self.assertIn("ix_st_trip", got)
        self.assertIn("ix_st_stop", got)
        self.assertIn("(trip_id)", got["ix_st_trip"].replace(" ", ""))
        self.assertIn("(stop_id)", got["ix_st_stop"].replace(" ", ""))


# ---------------------------------------------------------------------------
# C. THE FILTER. Rules 2 and 3, and the six tables that are taken by what the
#    kept trips reference rather than by the prefix.
# ---------------------------------------------------------------------------

class TestFilter(Feed):

    def test_a_trip_calling_at_a_kept_stop_is_kept_and_one_that_does_not_is_dropped(self):
        out, _ = self.filtered()
        self.assertEqual(self.column(out, "trips", "trip_id"), ["t-1", "t-3"])

    def test_the_whole_chain_of_a_kept_trip_survives_including_the_leg_outside_the_county(self):
        """Rule 2, and the reason an external sheet can name Norwich at all.

        The plausible wrong version keeps only the stop_times rows whose own stop
        carries the prefix, which truncates every route at the county boundary --
        a sheet that is reproducible, gates green, and has lost its terminus."""
        out, _ = self.filtered()
        self.assertEqual(
            self.rows(out, "SELECT stop_id FROM stop_times WHERE trip_id='t-1' ORDER BY stop_sequence"),
            [("0500SIVE001",), ("0590NORW001",)])

    def test_the_out_of_county_stop_itself_is_kept(self):
        """`stops` is taken from what the surviving stop_times reference, not from
        the prefix. Filtering by prefix a second time would leave a stop_times row
        pointing at a stop the database does not hold."""
        out, _ = self.filtered()
        self.assertIn("0590NORW001", self.column(out, "stops", "stop_id"))

    def test_no_stop_time_points_at_a_stop_the_output_does_not_hold(self):
        """The general form of the case above, asserted as the invariant rather
        than as the one row that shows it."""
        out, _ = self.filtered()
        self.assertEqual(
            self.rows(out, "SELECT COUNT(*) FROM stop_times st "
                           "LEFT JOIN stops s ON s.stop_id=st.stop_id WHERE s.stop_id IS NULL"),
            [(0,)])

    def test_a_stop_id_that_merely_contains_a_prefix_is_not_a_match(self):
        """Rule 3. `2500XYZ0500` ends with our digits; `LIKE '%0500%'` would keep
        its trip, its route, its operator and its stop, and on the real feed that
        is another region's worth of buses arriving in Cambridgeshire's dataset."""
        out, _ = self.filtered()
        self.assertNotIn("2500XYZ0500", self.column(out, "stops", "stop_id"))
        self.assertNotIn("t-2", self.column(out, "trips", "trip_id"))

    def test_the_peterborough_prefix_is_kept_as_well_as_the_cambridgeshire_one(self):
        """t-3 calls only at 0570PBRO001, so it survives on the second prefix
        alone -- the half of the default a one-prefix build would silently lose."""
        out, _ = self.filtered()
        self.assertIn("t-3", self.column(out, "trips", "trip_id"))

    def test_a_route_survives_only_if_one_of_its_trips_does(self):
        out, _ = self.filtered()
        self.assertEqual(self.column(out, "routes", "route_id"), ["r-1"])

    def test_an_operator_survives_only_if_one_of_its_routes_does(self):
        out, _ = self.filtered()
        self.assertEqual(self.column(out, "agency", "agency_id"), ["OP1"])

    def test_a_calendar_survives_only_if_a_kept_trip_runs_on_it(self):
        out, _ = self.filtered()
        self.assertEqual(self.column(out, "calendar", "service_id"), ["s-1", "s-3"])

    def test_calendar_dates_are_filtered_by_the_same_service_ids(self):
        """The exceptions table decides whether a bus runs on Christmas Day, and a
        row kept for a dropped service is a rule about a service nothing holds."""
        out, _ = self.filtered()
        self.assertEqual(self.column(out, "calendar_dates", "service_id"), ["s-1"])

    def test_only_the_shapes_the_kept_trips_draw_are_carried(self):
        out, _ = self.filtered()
        self.assertEqual(sorted(set(self.column(out, "shapes", "shape_id"))), ["sh-1"])

    def test_a_trip_with_no_shape_does_not_select_the_empty_shape_id(self):
        """t-3's `shape_id` is the empty string, and the source holds a shapes row
        whose id is also empty. Without the explicit exclusion that row would be
        drawn as a line at 0N 0E."""
        out, _ = self.filtered()
        self.assertNotIn("", self.column(out, "shapes", "shape_id"))

    def test_a_different_prefix_tuple_builds_a_different_region(self):
        """The `--keep-prefixes` promise in the module's own help text: this is how
        a second region's dataset is cut from its own BODS zip."""
        out, _ = self.filtered(prefixes=("0590",))
        self.assertEqual(self.column(out, "trips", "trip_id"), ["t-1", "t-2"])
        self.assertEqual(self.column(out, "agency", "agency_id"), ["OP1", "OP2"])

    def test_a_prefix_no_stop_carries_produces_an_empty_dataset_rather_than_an_error(self):
        """An empty answer is a legitimate one -- it is what a wrong ATCO prefix
        looks like -- and it must be reported as zero rows rather than as a crash,
        because the two get read very differently by whoever is rebuilding."""
        out, counts = self.filtered(prefixes=("9999",))
        self.assertEqual(counts["trips"], 0)
        self.assertEqual(counts["stops"], 0)
        self.assertEqual(self.column(out, "routes", "route_id"), [])

    def test_the_working_table_is_not_left_in_the_output(self):
        """`keep_trips` is scaffolding. Left behind it would be indistinguishable
        to a reader from a table the feed ships."""
        out, _ = self.filtered()
        self.assertEqual(
            self.rows(out, "SELECT COUNT(*) FROM sqlite_master WHERE name='keep_trips'"), [(0,)])

    def test_an_existing_output_is_replaced_rather_than_added_to(self):
        """The same shape as `naptan_build`'s `os.remove`, and the same reason:
        what the removal alone decides is whether anything ELSE in the old file
        survives -- a table an older version of this script wrote, under a name
        the current one has never heard of and would therefore never drop. The
        row counts cannot tell the two apart, so the case seeds a stray table."""
        out = self.path("out.sqlite")
        con = sqlite3.connect(out)
        con.execute("CREATE TABLE cambridgeshire_v0 (x TEXT)")
        con.commit()
        con.close()
        gb.filter_cambs(self.loaded(), out)
        self.assertEqual(
            self.rows(out, "SELECT COUNT(*) FROM sqlite_master WHERE name='cambridgeshire_v0'"), [(0,)])

    def test_the_counts_returned_are_the_rows_actually_written(self):
        """The counts are what the rebuild prints and what the sidecar records, so
        they are the only number anybody reads about a build. Checked against the
        database rather than against a figure typed here."""
        out, counts = self.filtered()
        self.assertEqual(sorted(counts), sorted(gb.TABLES))
        for table, n in counts.items():
            with self.subTest(table=table):
                self.assertEqual(self.rows(out, "SELECT COUNT(*) FROM %s" % table), [(n,)])
        self.assertEqual(counts["trips"], 2)
        self.assertEqual(counts["stop_times"], 3)
        self.assertEqual(counts["stops"], 3)


# ---------------------------------------------------------------------------
# D. THE BUILD END TO END, AND THE SIDECAR. Rule 4, run through the `__main__`
#    block, which is the only place the sidecar, the prefix parsing and the
#    temp-file handling exist.
# ---------------------------------------------------------------------------

class TestMain(Feed):

    def build(self, *args):
        """Run the file as a script, the way a person rebuilding the feed does.

        `runpy` with `run_name="__main__"` so the block at the foot of the file
        executes, and the path from `_engine.ENGINE_DIR` so a mutation run drives
        the mutated copy like every other case in this folder."""
        out = io.StringIO()
        argv = [os.path.join(_engine.ENGINE_DIR, "gtfs_build.py")] + list(args)
        saved = sys.argv[:]
        sys.argv = argv
        try:
            with contextlib.redirect_stdout(out):
                runpy.run_path(argv[0], run_name="__main__")
        finally:
            sys.argv = saved
        return out.getvalue()

    def sidecar(self, name):
        with io.open(self.path(name), encoding="utf-8") as fh:
            return json.load(fh)

    def test_the_sidecar_is_named_for_the_dataset_it_describes(self):
        """Rule 4's first half."""
        self.build("--zip", self.zip_of(), "--out", self.path("cambridgeshire.sqlite"))
        self.assertTrue(os.path.exists(self.path("feed_info_cambridgeshire.json")))

    def test_no_unsuffixed_sidecar_is_written(self):
        """Rule 4's second half, and the only one that says the 2026-08-21 fault
        cannot come back: while a bare `feed_info.json` existed,
        `gtfs_regions.feed_info()` fell back to it, so every region whose own
        sidecar was missing reported Cambridgeshire's build date and validity
        window as its own. The first half of this pair passes either way."""
        self.build("--zip", self.zip_of(), "--out", self.path("cambridgeshire.sqlite"))
        self.assertFalse(os.path.exists(self.path("feed_info.json")))

    def test_a_second_region_gets_its_own_sidecar_and_does_not_touch_the_first(self):
        """The generalisation of the case above, asserted with two datasets in one
        directory -- which is how `_gtfs/` actually looks."""
        self.build("--zip", self.zip_of(), "--out", self.path("cambridgeshire.sqlite"))
        self.build("--zip", self.zip_of(), "--out", self.path("norfolk.sqlite"),
                   "--keep-prefixes", "0590")
        self.assertEqual(self.sidecar("feed_info_cambridgeshire.json")["keep_prefixes"],
                         ["0500", "0570"])
        self.assertEqual(self.sidecar("feed_info_norfolk.json")["keep_prefixes"], ["0590"])

    def test_the_sidecar_records_the_prefixes_this_build_was_asked_for(self):
        """Not the module's default. A sidecar reporting `KEEP_PREFIXES` for a
        regional build is a record of what the code usually does rather than of
        what it did, which is the class of fault rule 4 is already about."""
        self.build("--zip", self.zip_of(), "--out", self.path("norfolk.sqlite"),
                   "--keep-prefixes", "0590")
        self.assertEqual(self.sidecar("feed_info_norfolk.json")["keep_prefixes"], ["0590"])

    def test_spaces_in_the_prefix_list_are_tolerated(self):
        """`--keep-prefixes "0500, 0570"` is what a person types. Untrimmed, the
        second prefix becomes " 0570", matches no stop id, and the build silently
        produces a Cambridgeshire-only dataset under a name that says otherwise."""
        self.build("--zip", self.zip_of(), "--out", self.path("two.sqlite"),
                   "--keep-prefixes", "0500, 0570")
        self.assertEqual(self.sidecar("feed_info_two.json")["keep_prefixes"], ["0500", "0570"])
        self.assertEqual(self.sidecar("feed_info_two.json")["counts"]["trips"], 2)

    def test_the_sidecar_carries_the_feed_publisher_and_validity_window(self):
        """`gtfs_regions.feed_info()` reads these to answer how old a dataset is,
        and that answer reaches the board."""
        self.build("--zip", self.zip_of(), "--out", self.path("cambridgeshire.sqlite"))
        info = self.sidecar("feed_info_cambridgeshire.json")["feed_info"]
        self.assertEqual(info["feed_publisher_name"], "Department for Transport")
        self.assertEqual(info["feed_start_date"], "20260901")
        self.assertEqual(info["feed_end_date"], "20270301")

    def test_a_feed_with_no_feed_info_member_still_builds_and_says_so_with_an_empty_map(self):
        """The `except Exception: pass` around the sidecar read. A feed without
        `feed_info.txt` is a real feed; losing the whole 80 MB build over its
        absence would not be."""
        self.build("--zip", self.zip_of(feed_members(feed_info__txt=None)),
                   "--out", self.path("cambridgeshire.sqlite"))
        side = self.sidecar("feed_info_cambridgeshire.json")
        self.assertEqual(side["feed_info"], {})
        self.assertEqual(side["counts"]["trips"], 2)

    def test_the_sidecar_names_the_zip_it_was_built_from(self):
        """The provenance line. `source_zip` is the basename, so a sidecar copied
        between machines still says which download it describes."""
        self.build("--zip", self.zip_of(name="itm_east_anglia_gtfs.zip"),
                   "--out", self.path("cambridgeshire.sqlite"))
        self.assertEqual(self.sidecar("feed_info_cambridgeshire.json")["source_zip"],
                         "itm_east_anglia_gtfs.zip")

    def test_the_build_writes_the_database_the_out_path_names(self):
        printed = self.build("--zip", self.zip_of(), "--out", self.path("cambridgeshire.sqlite"))
        self.assertTrue(os.path.exists(self.path("cambridgeshire.sqlite")))
        self.assertEqual(self.column(self.path("cambridgeshire.sqlite"), "trips", "trip_id"),
                         ["t-1", "t-3"])
        self.assertIn("counts:", printed)


if __name__ == "__main__":
    unittest.main()
