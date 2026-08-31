#!/usr/bin/env python3
"""Falsify the operating-days resolution in gtfs_query.py (OA-204).

Run from the skill root (`make-bus-leaflet`), with no arguments and no placeholders:

    python tools/prove-red-days-resolution.py

Needs no real GTFS dataset, no built map and no second repository: every case builds a
tiny in-memory SQLite feed with exactly the rows the case is about, so this runs on a
fresh clone anywhere Python runs. That matters here, because the real subject is a 139 MB
sqlite that is in no repository.

WHAT IS BEING FALSIFIED. `days`/`daysFlags` used to be read from the `calendar` row:

    for c in rows:
        for i,dn in enumerate(DOW):
            if c[dn]=="1": flags[i]=1

with calendar_dates additions folded in only when the service had NO calendar row. GTFS
lets both tables define the answer, so a service filed Mon-Fri that adds every Saturday
and Sunday as exceptions reported **Mon-Fri**. High Wycombe route 300 is that shape: a
Mon-Fri base plus 263 additions covering every weekend of a nine-month registration, while
the operator runs 25 journeys on Sat 12 Sept 2026 and 12 on Sun 13 Sept. Nothing threw,
every route appeared, the day string looked ordinary, and the byte gate could not see it
because the gate compares the drawing with ci-reference, not with the world.

Each case comes in a PAIR: the right answer on data that is right, and a visibly different
answer on data carrying a fault of the same kind. Case 5 is the one that earns the file --
it re-implements the OLD calendar-only derivation against the SAME fixture and asserts it
still says Mon-Fri, so the harness is shown to tell the fixed code from the code that had
the bug, rather than merely agreeing with whatever is in the file today.
"""
import os, sys, sqlite3, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
sys.path.insert(0, ASSETS)

import gtfs_query as gq                    # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    print("  %-4s %s%s" % ("ok" if ok else "FAIL", name, ("  -- " + detail) if detail else ""))
    if not ok:
        FAILURES.append(name)


# --------------------------------------------------------------------- the fixture
# One town stop, one route, one service. Two journeys a day so a "duplicate filing"
# cannot be what makes a day appear. Dates are pinned, never derived from today, so the
# harness gives the same answer on any day it is ever run -- the whole sampled window
# sits inside the service's validity.
BASE = datetime.date(2026, 9, 7)           # a Monday
WINDOW_END = BASE + datetime.timedelta(weeks=13)


def build(cal_days, adds=(), removes=(), *, with_calendar=True):
    """A feed with one route at one town stop. `cal_days` is a 7-char MTWTFSS mask of the
    calendar row; `adds`/`removes` are calendar_dates offsets in days from BASE."""
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    c = con.cursor()
    c.execute("CREATE TABLE agency(agency_id TEXT, agency_name TEXT, agency_noc TEXT)")
    c.execute("CREATE TABLE routes(route_id TEXT, route_short_name TEXT, route_long_name TEXT, agency_id TEXT)")
    c.execute("CREATE TABLE trips(trip_id TEXT, route_id TEXT, service_id TEXT, direction_id TEXT, "
              "trip_headsign TEXT, shape_id TEXT)")
    c.execute("CREATE TABLE stop_times(trip_id TEXT, stop_id TEXT, stop_sequence TEXT, "
              "departure_time TEXT, arrival_time TEXT)")
    c.execute("CREATE TABLE stops(stop_id TEXT, stop_name TEXT, stop_lat TEXT, stop_lon TEXT)")
    c.execute("CREATE TABLE calendar(service_id TEXT, monday TEXT, tuesday TEXT, wednesday TEXT, "
              "thursday TEXT, friday TEXT, saturday TEXT, sunday TEXT, start_date TEXT, end_date TEXT)")
    c.execute("CREATE TABLE calendar_dates(service_id TEXT, date TEXT, exception_type TEXT)")
    c.execute("CREATE TABLE shapes(shape_id TEXT)")

    c.execute("INSERT INTO agency VALUES('OP1','Test Coaches','TSTC')")
    c.execute("INSERT INTO routes VALUES('r1','300','','OP1')")
    c.execute("INSERT INTO stops VALUES('0400TOWN01','Town Centre','51.6','-0.7')")
    for i, dep in enumerate(("09:00:00", "17:00:00")):
        c.execute("INSERT INTO trips VALUES(?,'r1','s1',?,'Town Centre','')", ("t%d" % i, str(i)))
        c.execute("INSERT INTO stop_times VALUES(?,'0400TOWN01','1',?,?)", ("t%d" % i, dep, dep))
    if with_calendar:
        c.execute("INSERT INTO calendar VALUES('s1',?,?,?,?,?,?,?,?,?)",
                  tuple("1" if ch != "." else "0" for ch in cal_days)
                  + (BASE.strftime("%Y%m%d"), WINDOW_END.strftime("%Y%m%d")))
    for off in adds:
        c.execute("INSERT INTO calendar_dates VALUES('s1',?, '1')",
                  ((BASE + datetime.timedelta(off)).strftime("%Y%m%d"),))
    for off in removes:
        c.execute("INSERT INTO calendar_dates VALUES('s1',?, '2')",
                  ((BASE + datetime.timedelta(off)).strftime("%Y%m%d"),))
    con.commit()
    return con


def days_of(con):
    """Run the real query() against this feed and return (days string, basis)."""
    path = os.path.join(TMPDIR, "feed.sqlite")
    disk = sqlite3.connect(path)
    con.backup(disk)
    disk.close()
    res = gq.query(path, prefixes=["0400TOWN"], town="Testville",
                   asof=BASE.strftime("%Y%m%d"))
    svc = res["services"][0]
    return svc["days"], svc.get("daysBasis", ""), svc["daysFlags"]


def old_calendar_only_days(con):
    """The derivation as it stood BEFORE the fix, reproduced here so case 5 can show the
    harness distinguishes the two. Reads the calendar row and nothing else."""
    flags = [0] * 7
    for row in con.execute("SELECT * FROM calendar WHERE service_id='s1'"):
        for i, dn in enumerate(gq.DOW):
            if row[dn] == "1":
                flags[i] = 1
    return gq.fmt_days(flags)


import tempfile                                                        # noqa: E402
TMPDIR = tempfile.mkdtemp(prefix="prove-red-days-")

print("Falsifying the operating-days resolution (OA-204)\n")

# ---------------------------------------------------------------- 1. the control
# A plain Mon-Fri service with no exceptions must still read Mon-Fri. If this moves,
# every other case below is measuring the fix breaking ordinary data.
d, basis, _ = days_of(build("MTWTF.."))
check("control: Mon-Fri calendar, no exceptions -> Mon-Fri", d == "Mon-Fri", "got %r" % d)
check("control: reports a resolved basis", basis.startswith("resolved"), basis)

# ------------------------------------------------- 2. THE BUG: weekends added as exceptions
# Mon-Fri base plus every Saturday and Sunday of the window as additions. This is High
# Wycombe route 300, and it is the case the old code got wrong.
weekend_offsets = [w * 7 + d for w in range(13) for d in (5, 6)]
d, basis, flags = days_of(build("MTWTF..", adds=weekend_offsets))
check("Mon-Fri base + weekend calendar_dates additions -> Daily", d == "Daily", "got %r" % d)
check("  and both weekend flags are set", flags[5] == 1 and flags[6] == 1, str(flags))

# --------------------------------------------- 3. the other direction: days REMOVED
# A service declaring Daily whose every Saturday and Sunday is removed runs Mon-Fri.
# The old code read Daily. Note this is the direction that OVER-promises, which is the
# one a reader is stranded by.
d, _, _ = days_of(build("MTWTFSS", removes=weekend_offsets))
check("Daily base - weekend calendar_dates removals -> Mon-Fri", d == "Mon-Fri", "got %r" % d)

# --------------------------------------------- 4. calendar-less service still works
# A service with no calendar row at all, running only on Tuesdays via additions. This
# case the old code handled, and it must not regress. The additions start the week BEFORE
# the sampled window: --asof selects services whose added-date span straddles the date, so
# a span that opens after it is (correctly) not yet in effect.
d, _, _ = days_of(build("", adds=[w * 7 + 1 for w in range(-1, 13)], with_calendar=False))
check("calendar_dates-only service, Tuesdays -> Tue", d == "Tue", "got %r" % d)

# ------------------------------------- 5. the harness can tell the fix from the bug
# Re-run the OLD derivation over the SAME fixture as case 2 and assert it still gets it
# wrong. Without this, every check above would pass just as well against the buggy code
# if the fixture happened to suit it, and the file would prove nothing.
con = build("MTWTF..", adds=weekend_offsets)
old = old_calendar_only_days(con)
new, _, _ = days_of(con)
check("OLD calendar-only derivation still reads Mon-Fri on case 2's data", old == "Mon-Fri", "got %r" % old)
check("  and the fixed derivation disagrees with it", new != old, "old=%r new=%r" % (old, new))

# ------------------------------------------- 6. the fallback, and that it is labelled
# A service that IS in effect -- its window spans the date, so --asof keeps it -- but whose
# every date in the sampled window is removed: a registration suspended for a period. The
# resolved answer is empty, so the declared calendar pattern is used, and the basis must say
# so, because "declared" and "observed" are different claims and a day string cannot carry
# the difference. Without the fallback this route would report "?" and read as broken data.
d, basis, _ = days_of(build("MTWTF..", removes=range(0, 7 * 13)))
check("suspended service falls back to the declared pattern", d == "Mon-Fri", "got %r" % d)
check("  and the fallback is labelled 'declared'", basis.startswith("declared"), basis)

# --------------------------------------------------------- 7. the region label (in passing)
# `source` was the literal string "BODS GTFS (east_anglia)" whatever dataset was read, so
# every Buckinghamshire and Bedfordshire pull recorded the wrong feed.
path = os.path.join(TMPDIR, "buckinghamshire.sqlite")
disk = sqlite3.connect(path); build("MTWTF..").backup(disk); disk.close()
res = gq.query(path, prefixes=["0400TOWN"], town="Testville", asof=BASE.strftime("%Y%m%d"))
check("source names the dataset actually read", "buckinghamshire" in res["source"], res["source"])

print()
if FAILURES:
    print("%d FAILURE(S): %s" % (len(FAILURES), ", ".join(FAILURES)))
    sys.exit(1)
print("All cases behaved: the resolution reports what runs, the old derivation does not,")
print("and the fallback says which claim it is making.")
