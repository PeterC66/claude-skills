"""_stubs.py -- the two databases a boarding plan is built from, small enough to reason about.

WHY A STUB RATHER THAN THE REAL REGISTER. The helpers these suites could already
reach were the ones that take arguments and return values. Everything else in
`boarding_index.py` and `naptan_stands.py` lives inside `main()` and reads
sqlite, so the only way to ask a question of it was to run a real place build
against `_gtfs/naptan.sqlite` (127,658 stops) and a county feed. That is not a
test: it is untracked, it is 400 MB, it changes every month, and an assertion
about what it contains is an assertion about what BODS published that week.
OA-001 named the pattern to use instead -- *stub the data, do not read a
dataset* -- which `tools/prove-red-route-collision.py` established.

THE SCHEMA IS DERIVED FROM THE BUILDERS, NOT TYPED HERE. `naptan_build.py` and
`gtfs_build.py` are the two files that create these tables for real, so the stub
asks them for their column lists rather than keeping a second copy. A column
added there reaches the fixtures for free, and a stub that had drifted from the
real shape would be a fixture proving something about a table nothing builds.
Both are loaded through `_engine`, so a mutation run gets the mutated copy's
schema as well as its logic.

A FIXTURE KEY THAT NAMES NO COLUMN IS AN ERROR RATHER THAN A NO-OP. A misspelled
`ParentLocality` would otherwise insert nothing, leave the row's parent NULL, and
the rollup test would then be asserting something true about a fixture nobody
meant to write.
"""
import io
import json
import os
import sqlite3
import tempfile

import _engine

nb = _engine.load("naptan_build")
gb = _engine.load("gtfs_build")

# The derived columns `naptan_build.create_table` adds after the CSV's own.
NAPTAN_EXTRA = ["stand", "stand_kind", "area", "lat", "lon", "pos_source"]


def scratch(prefix):
    """A throwaway directory under the project's usual scratch root."""
    root = os.path.join(tempfile.gettempdir(), "busmaps-scratch")
    os.makedirs(root, exist_ok=True)
    return tempfile.mkdtemp(prefix=prefix, dir=root)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh)
    return path


def naptan_db(path, stops):
    """Write a NaPTAN sqlite holding exactly `stops`.

    Each stop is a dict keyed by real column names. `Status` defaults to
    `active` (every query in the engine filters on it), `area` to the ATCO
    code's first three characters, and `stand`/`stand_kind` are DERIVED from the
    Indicator by `naptan_build.derive_stand` -- the same function the real
    builder uses, so a fixture cannot declare a stand the builder would not have
    made.
    """
    cols = list(nb.COLUMNS) + NAPTAN_EXTRA
    known = set(cols)
    con = sqlite3.connect(path)
    nb.create_table(con)
    for s in stops:
        unknown = sorted(set(s) - known)
        if unknown:
            raise AssertionError("naptan fixture names no such column: %s" % ", ".join(unknown))
        row = dict(s)
        row.setdefault("Status", "active")
        atco = row.get("ATCOCode") or ""
        row.setdefault("area", atco[:3])
        stand, kind = nb.derive_stand(row.get("Indicator"))
        row.setdefault("stand", stand)
        row.setdefault("stand_kind", kind)
        con.execute(
            "INSERT INTO naptan (%s) VALUES (%s)" % (",".join(cols), ",".join("?" * len(cols))),
            tuple(row.get(c) for c in cols))
    con.commit()
    con.close()
    return path


def gtfs_db(path, tables):
    """Write a GTFS sqlite holding `tables` -- {table: [row dicts]}.

    Columns come from `gtfs_build.TABLES`, which is what the real loader writes,
    and every table in it is created even when the fixture leaves it empty: the
    module under test joins `routes`, `trips`, `stop_times` and `calendar`
    together, and a missing table would fail as a sqlite error rather than as the
    absence the fixture meant.
    """
    con = sqlite3.connect(path)
    for tbl, cols in gb.TABLES.items():
        con.execute("CREATE TABLE %s (%s)" % (tbl, ",".join(c + " TEXT" for c in cols)))
    for tbl, rows in (tables or {}).items():
        if tbl not in gb.TABLES:
            raise AssertionError("gtfs fixture names no such table: %s" % tbl)
        cols = gb.TABLES[tbl]
        for r in rows:
            unknown = sorted(set(r) - set(cols))
            if unknown:
                raise AssertionError("gtfs fixture: %s has no column %s" % (tbl, ", ".join(unknown)))
            con.execute(
                "INSERT INTO %s (%s) VALUES (%s)" % (tbl, ",".join(cols), ",".join("?" * len(cols))),
                tuple(r.get(c) for c in cols))
    con.commit()
    con.close()
    return path


def every_day(service_id, start="20260101", end="20271231"):
    """A calendar row that operates seven days a week inside a wide window."""
    row = {"service_id": service_id, "start_date": start, "end_date": end}
    for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
        row[d] = "1"
    return row
