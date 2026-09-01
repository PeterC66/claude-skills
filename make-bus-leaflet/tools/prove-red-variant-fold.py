#!/usr/bin/env python3
"""Falsify the variant fold in gtfs_refresh_report.py (OA-223).

Run from the skill root (`make-bus-leaflet`), with no arguments and no placeholders:

    python tools/prove-red-variant-fold.py

Needs no real GTFS dataset, no built map and no second repository: every case builds a
tiny on-disk SQLite feed and a tiny town folder holding one `verified-services.json`, so
this runs on a fresh clone anywhere Python runs. That matters here, because the real
subject is a 139 MB sqlite that is in no repository and a town tree that is in another one.

WHAT IS BEING FALSIFIED. `fold_gtfs()` collapses variant suffixes into their base route --
1A, 1B and 1S become 1; 32A becomes 32 -- which is right, and is what stops the monthly
report proposing 301S as a new service every month. It recorded what it had folded in
`b["variants"]`, and nothing ever read that set. Two consequences, both of them wrong
answers rather than crashes:

  * The shipped-side loop asked `if r not in gtfs`, and `gtfs` is keyed by base route
    alone. A town that ships a variant as a displayed service in its own right -- its own
    palette colour, its own panel row, its own line -- was told the service had been
    WITHDRAWN. High Wycombe had been told that about 1A, 1B and 32A every month since it
    was built, while all three were running.
  * The base's week became the union of services the town separates, so 32 (Mon-Sat)
    together with 32A (Daily) produced a [DAYS] finding about a route that had not changed.

The dangerous half is not the noise. A false [WITHDRAWN?] that fires every month is a row
nobody can act on, so it gets read past -- and a REAL withdrawal of 1A would arrive as the
same words in the same place. Case 5 is the one that earns this file: it re-implements the
OLD unfolded matching against the SAME fixture and asserts it still cries withdrawal, so
the harness is shown to tell the fixed code from the code that had the bug rather than
merely agreeing with whatever is in the file today. Case 6 is its complement, and it is
the case the fix must not buy with a blind spot: a variant that really HAS gone must still
be reported.
"""
import os, sys, json, sqlite3, shutil, tempfile, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
sys.path.insert(0, ASSETS)

import gtfs_refresh_report as rr           # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    print("  %-4s %s%s" % ("ok" if ok else "FAIL", name, ("  -- " + detail) if detail else ""))
    if not ok:
        FAILURES.append(name)


# --------------------------------------------------------------------- the fixture
# Dates are pinned, never derived from today, so the harness gives the same answer on any
# day it is ever run: the whole sampled window sits inside the services' validity.
BASE = datetime.date(2026, 9, 7)           # a Monday
END = BASE + datetime.timedelta(weeks=13)
TMP = tempfile.mkdtemp(prefix="prove-red-variant-fold-")

# route number -> (operator, 7-char MTWTFSS mask). '32' and '32A' are the real High
# Wycombe shape: a base and a variant, on different weeks, both shipped.
FEED = {
    "1":   ("Carousel Buses", "MTWTFSS"),
    "1A":  ("Carousel Buses", "MTWTFSS"),
    "1B":  ("Carousel Buses", "MTWTFS."),
    "1S":  ("Carousel Buses", "MTWTF.."),
    "32":  ("Carousel Buses", "MTWTFS."),
    "32A": ("Carousel Buses", "MTWTFSS"),
    "33":  ("Carousel Buses", "MTWTFSS"),
}


def build_feed(routes):
    """A feed with one town stop and one service per named route."""
    path = os.path.join(TMP, "feed-%d.sqlite" % build_feed.n)
    build_feed.n += 1
    con = sqlite3.connect(path)
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
    c.execute("INSERT INTO agency VALUES('OP1','Carousel Buses','CRSL')")
    c.execute("INSERT INTO stops VALUES('0400TOWN01','Town Centre','51.6','-0.7')")
    for n, name in enumerate(routes):
        op, mask = FEED[name]
        rid, sid = "r%d" % n, "s%d" % n
        c.execute("INSERT INTO routes VALUES(?,?,'',?)", (rid, name, "OP1"))
        c.execute("INSERT INTO calendar VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (sid,) + tuple("1" if ch != "." else "0" for ch in mask)
                  + (BASE.strftime("%Y%m%d"), END.strftime("%Y%m%d")))
        for d, dep in enumerate(("09:00:00", "17:00:00")):
            tid = "t%d_%d" % (n, d)
            c.execute("INSERT INTO trips VALUES(?,?,?,?,?,'')", (tid, rid, sid, str(d), "Town Centre"))
            c.execute("INSERT INTO stop_times VALUES(?,'0400TOWN01','1',?,?)", (tid, dep, dep))
    con.commit()
    con.close()
    return path


build_feed.n = 0


# What the TOWN ships, snapshotted from the feed before any case perturbs it. The two
# must be separate tables: a case that moves a service's days in the feed by editing FEED
# would move the shipped side with it, and the finding it is looking for could never fire.
# That is exactly what the first draft of this file did, and cases 7a/7b caught it.
SHIPPED_DAYS = {r: mask for r, (_op, mask) in FEED.items()}


def town_dir(shipped):
    """A town folder holding one S1 run whose verified-services.json ships `shipped`."""
    d = os.path.join(TMP, "town-%d" % town_dir.n, "S1-services", "2026-09-01_0000")
    town_dir.n += 1
    os.makedirs(d)
    services = [{"route": r, "key": r, "operator": FEED[r][0],
                 "days": rr.fmt({i for i, ch in enumerate(SHIPPED_DAYS[r]) if ch != "."}),
                 "status": "live", "servesTown": True, "source": "gtfs"} for r in shipped]
    with open(os.path.join(d, "verified-services.json"), "w", encoding="utf-8") as f:
        json.dump({"town": "Testville", "verifiedOn": "2026-09-01", "services": services}, f)
    return os.path.dirname(os.path.dirname(d))


town_dir.n = 0

CFG = {"region": "testshire", "prefixes": ["0400TOWN"]}


def run(feed_routes, shipped):
    """The real diff_town() over a purpose-built feed and town. Returns [(kind, label, why)]."""
    res = rr.diff_town(build_feed(feed_routes), "Testville", CFG, town_dir(shipped))
    return res["changes"]


def kinds(changes, kind):
    return sorted(lbl for k, lbl, _ in changes if k == kind)


def old_unfolded_missing(feed_routes, shipped):
    """The shipped-side test as it stood BEFORE the fix, reproduced so case 5 can show the
    harness distinguishes the two. Asks only whether the shipped name is a key of the
    folded dict, which is what `variants` being unread amounted to."""
    import gtfs_query as gq
    gtfs = rr.fold_gtfs(gq.query(build_feed(feed_routes), ["0400TOWN"], None, "Testville")["services"])
    return sorted(r for r in shipped if r not in gtfs)


print("Falsifying the variant fold in the monthly refresh report (OA-223)\n")

ALL = ["1", "1A", "1B", "1S", "32", "32A", "33"]
SHIPPED = ["1", "1A", "1B", "32", "32A", "33"]        # 1S is a school variant, not shipped

# ---------------------------------------------------------------- 1. the control
# Nothing has changed between feed and town, so the report must say nothing at all. If
# this goes red, every case below is measuring the fix breaking ordinary data.
ch = run(ALL, SHIPPED)
check("control: feed and shipped set agree -> no findings", ch == [], repr(ch))

# ------------------------------------------- 2. THE BUG: a shipped variant read as gone
# The case that has been wrong every month since High Wycombe was registered.
check("no shipped variant is reported withdrawn", kinds(ch, "WITHDRAWN?") == [], repr(kinds(ch, "WITHDRAWN?")))

# ------------------------------- 3. the same fold's other wrong answer: a false [DAYS]
# 32 runs Mon-Sat and 32A runs Daily. Union them and 32 reads Daily.
check("no false [DAYS] on a base whose variant is shipped separately",
      kinds(ch, "DAYS") == [], repr(kinds(ch, "DAYS")))

# ------------------------------------- 4. the fold still WORKS: an unshipped variant is
# not proposed as a new route. This is what folding is for, and the fix must not undo it.
check("an unshipped variant (1S) is not proposed as new", "1S" not in kinds(ch, "ADD?"), repr(kinds(ch, "ADD?")))
check("  and nothing at all is proposed as new", kinds(ch, "ADD?") == [], repr(kinds(ch, "ADD?")))

# --------------------------------- 5. the harness can tell the fix from the bug
# Re-run the OLD unfolded matching over the SAME fixture and assert it still gets it wrong.
# Without this every check above would pass just as well against the buggy code if the
# fixture happened to suit it, and the file would prove nothing.
old = old_unfolded_missing(ALL, SHIPPED)
check("OLD matching still calls 1A, 1B and 32A missing on this data",
      old == ["1A", "1B", "32A"], repr(old))
check("  and the fixed report disagrees with it", kinds(ch, "WITHDRAWN?") != old,
      "old=%r new=%r" % (old, kinds(ch, "WITHDRAWN?")))

# ------------------------------- 6. THE COMPLEMENT: a variant that really HAS gone
# The fix must not be bought by never looking. Drop 1A from the feed and keep shipping it.
gone = run([r for r in ALL if r != "1A"], SHIPPED)
check("a variant genuinely absent from the feed IS reported withdrawn",
      kinds(gone, "WITHDRAWN?") == ["1A"], repr(kinds(gone, "WITHDRAWN?")))

# ------------------------------- 7. a variant whose DAYS really changed is still caught
# 1B ships as Mon-Sat. Give the FEED a Mon-Fri 1B -- and only the feed, which is what
# SHIPPED_DAYS is for -- and the finding must fire on 1B's own flags, not be swallowed by
# the base's Daily union.
saved = FEED["1B"]
FEED["1B"] = ("Carousel Buses", "MTWTF..")
moved = run(ALL, SHIPPED)
FEED["1B"] = saved
check("a real days change on a shipped variant is reported", "1B" in kinds(moved, "DAYS"),
      repr([(k, l, w) for k, l, w in moved]))
check("  and it names the variant's own week, not the family's",
      any(k == "DAYS" and l == "1B" and "Mon-Fri" in w for k, l, w in moved),
      repr([(k, l, w) for k, l, w in moved if k == "DAYS"]))

# ------------------------------- 8. a genuinely new route is still proposed
# The fold must not swallow a base number the town does not ship at all.
FEED["44"] = ("Carousel Buses", "MTWTFS.")
added = run(ALL + ["44"], SHIPPED)
check("a genuinely new base route is still proposed", kinds(added, "ADD?") == ["44"],
      repr(kinds(added, "ADD?")))

# ------------------------------- 9. a base that exists ONLY through shipped variants
# If the feed carries 1A and 1B but no plain 1, and the town ships both variants, there is
# no route "1" to propose -- inventing one would be a finding about a bus that does not run.
onlyvar = run(["1A", "1B", "33"], ["1A", "1B", "33"])
check("a base present only through shipped variants is not proposed as new",
      kinds(onlyvar, "ADD?") == [], repr(onlyvar))

shutil.rmtree(TMP, ignore_errors=True)

print()
if FAILURES:
    print("%d FAILURE(S): %s" % (len(FAILURES), ", ".join(FAILURES)))
    sys.exit(1)
print("All cases behaved: a shipped variant is found, a vanished one is still reported,")
print("the fold still folds, and the old matching is shown to get this fixture wrong.")
