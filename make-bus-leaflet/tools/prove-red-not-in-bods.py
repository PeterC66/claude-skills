#!/usr/bin/env python3
"""Falsify the `notInBods` declaration in gtfs_refresh_report.py (OA-259, 2026-09-06).

Run from the skill root (`make-bus-leaflet`), with no arguments and no placeholders:

    python tools/prove-red-not-in-bods.py

Builds its own tiny SQLite feed and its own town folder for every case, like its siblings
tools/prove-red-consolidation.py and tools/prove-red-variant-fold.py, so it needs no real
dataset, no built map and no second repository.

WHAT IS BEING FALSIFIED. Until 2026-09-06 the only escape from [WITHDRAWN?] for a shipped
route missing from the feed was `is_community()`, which matches `source` beginning
`bustimes-community` or one of nine substrings in the OPERATOR'S NAME -- villager,
community, minibus, dial, demand and so on. That is an inference from a brand, and it
fails on the first counterexample. The counterexample arrived that day: Whippet's X1
"Blue Arrow", Cambridge Parkside to Peterborough Westgate with Huntingdon Bus Station its
only intermediate stop, Mon-Sat, five journeys each way since 26 January 2026, is absent
from the ITM East Anglia extract while NINE other Whippet routes are in it. Plain
commercial operator, no hint fires, so Huntingdon would have appeared on the monthly
towns-to-review list for ever over a service that is running fine -- and a recurring alarm
that is factually wrong is the kind that teaches you to skim the section which will one day
carry a real withdrawal.

WHY THE CASES ARE SHAPED THIS WAY. A declaration that can only ever quieten a row is a
mute button, and this repository has a name for those. So the quiet arm is one case and
the loud arms are five: no reason recorded, a `notInBods` that is not an object at all, a
`recheckBy` that has passed, the same date still in the future, and the stale direction --
declared absent from a feed that carries it. Case 1 is the CONTROL that earns the file:
the same fixture with the declaration removed must still cry [WITHDRAWN?], so the harness
is shown to tell the fixed code from code that simply stopped reporting. Case 3 is the
blind spot the fix must not buy: the operator-name fallback still has to work for the
community services it was written for, because nothing has declared anything on them.

Case 9 asserts against `rr.NON_ACTIONABLE` rather than a copy of the tag list, because a
harness that re-implements the filter it is testing agrees with itself.
"""
import os, sys, json, sqlite3, tempfile, datetime

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
# Dates pinned, never derived from today, so the harness answers the same on any day it is
# run -- except TODAY itself, which is passed explicitly to diff_town for the recheckBy
# cases: a harness that let the real clock decide whether a date has passed would flip
# from green to red on one morning in 2027 for a reason unrelated to the code.
BASE = datetime.date(2026, 9, 7)           # a Monday
END = BASE + datetime.timedelta(weeks=13)
TODAY = "2026-09-06"
TMP = tempfile.mkdtemp(prefix="prove-red-not-in-bods-")

# Huntingdon's real shape, reduced: one route the feed carries, and the three it does not.
FEED = {
    "X2":   ("Whippet Coaches", "MTWTFS."),
    "X1":   ("Whippet Coaches", "MTWTFS."),
    "VL14": ("Villager Minibus Sharnbrook", "M......"),
}
CFG = {"region": "testshire", "prefixes": ["0500HHUNT"]}


def build_feed(routes):
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
    ops = {}
    for name in routes:
        op = FEED[name][0]
        if op not in ops:
            ops[op] = "OP%d" % len(ops)
            c.execute("INSERT INTO agency VALUES(?,?,'')", (ops[op], op))
    c.execute("INSERT INTO stops VALUES('0500HHUNT079','Huntingdon Bus Station','52.33','-0.18')")
    for n, name in enumerate(routes):
        op, mask = FEED[name]
        rid, sid = "r%d" % n, "s%d" % n
        c.execute("INSERT INTO routes VALUES(?,?,'',?)", (rid, name, ops[op]))
        c.execute("INSERT INTO calendar VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (sid,) + tuple("1" if ch != "." else "0" for ch in mask)
                  + (BASE.strftime("%Y%m%d"), END.strftime("%Y%m%d")))
        for d, dep in enumerate(("09:00:00", "17:00:00")):
            tid = "t%d_%d" % (n, d)
            c.execute("INSERT INTO trips VALUES(?,?,?,?,?,'')", (tid, rid, sid, str(d), "Huntingdon,Bus Station"))
            c.execute("INSERT INTO stop_times VALUES(?,'0500HHUNT079','1',?,?)", (tid, dep, dep))
    con.commit()
    con.close()
    return path


build_feed.n = 0


def town_dir(services):
    """A town folder holding one S1 run shipping exactly `services`."""
    d = os.path.join(TMP, "town-%d" % town_dir.n, "S1-services", "2026-09-01_0000")
    town_dir.n += 1
    os.makedirs(d)
    with open(os.path.join(d, "verified-services.json"), "w", encoding="utf-8") as f:
        json.dump({"town": "Huntingdon", "verifiedOn": "2026-09-01", "services": services}, f)
    return os.path.dirname(os.path.dirname(d))


town_dir.n = 0


def svc(route, operator, mask, **kw):
    s = {"route": route, "key": route, "operator": operator,
         "days": rr.fmt({i for i, ch in enumerate(mask) if ch != "."}),
         "status": "live", "servesTown": True, "source": "gtfs"}
    s.update(kw)
    return s


def run(feed_routes, services, today=TODAY):
    res = rr.diff_town(build_feed(feed_routes), "Huntingdon", CFG, town_dir(services), today)
    return res["changes"]


def tag_of(changes, route):
    """The tag this route was given, or None. One route never earns two."""
    got = [k for k, lbl, _ in changes if str(lbl).split(" ")[0] == route or str(lbl) == route]
    return got[0] if len(got) == 1 else (got or [None])[0]


def msg_of(changes, route):
    return " ".join(m for k, lbl, m in changes if str(lbl) == route)


# The three shipped services. The feed will be given X2 only, so X1 and VL14 are absent.
def ship(x1_extra=None):
    x1 = svc("X1", "Whippet Coaches", "MTWTFS.")
    if x1_extra is not None:
        x1["notInBods"] = x1_extra
    return [svc("X2", "Whippet Coaches", "MTWTFS."), x1,
            svc("VL14", "Villager Minibus Sharnbrook", "M......")]


print("Falsifying the notInBods declaration in the monthly refresh report\n")

print("1. CONTROL — with no declaration the alarm still fires")
c1 = run(["X2"], ship())
check("a shipped commercial route absent from the feed is [WITHDRAWN?]",
      tag_of(c1, "X1") == "WITHDRAWN?", "got %s" % tag_of(c1, "X1"))
check("and the town would therefore be on the towns-to-review list",
      "WITHDRAWN?" not in rr.NON_ACTIONABLE)

print("\n2. THE QUIET ARM — a declaration with a reason is honoured, and quotes the town")
c2 = run(["X2"], ship({"why": "not in the ITM East Anglia extract while nine other Whippet routes are",
                       "since": "2026-09-06"}))
check("the tag becomes [NOT-IN-BODS]", tag_of(c2, "X1") == "NOT-IN-BODS", "got %s" % tag_of(c2, "X1"))
check("and the row carries the town's own words, not ours",
      "nine other Whippet routes" in msg_of(c2, "X1"), msg_of(c2, "X1")[:90])

print("\n3. THE FALLBACK IS NOT REMOVED — the community guess still works, undeclared")
check("VL14 is still [COMMUNITY] on its operator name alone",
      tag_of(c2, "VL14") == "COMMUNITY", "got %s" % tag_of(c2, "VL14"))
check("and a declared route and an inferred one are told apart",
      tag_of(c2, "X1") != tag_of(c2, "VL14"))

print("\n4. LOUD — a declaration with no reason silences nothing")
c4 = run(["X2"], ship({"since": "2026-09-06"}))
check("[WITHDRAWN?] still fires", tag_of(c4, "X1") == "WITHDRAWN?", "got %s" % tag_of(c4, "X1"))
check("and the row says which field is missing", "`why`" in msg_of(c4, "X1"), msg_of(c4, "X1")[:90])

print("\n5. LOUD — a declaration that is not an object at all silences nothing")
c5 = run(["X2"], ship(True))
check("[WITHDRAWN?] still fires", tag_of(c5, "X1") == "WITHDRAWN?", "got %s" % tag_of(c5, "X1"))
check("and the row says what the field should be", "object" in msg_of(c5, "X1"), msg_of(c5, "X1")[:90])

print("\n6. LOUD — a recheckBy that has passed stops silencing, and names the date")
c6 = run(["X2"], ship({"why": "absent from the extract", "recheckBy": "2026-01-01"}))
check("[WITHDRAWN?] returns", tag_of(c6, "X1") == "WITHDRAWN?", "got %s" % tag_of(c6, "X1"))
check("and the expiry is named", "2026-01-01" in msg_of(c6, "X1"), msg_of(c6, "X1")[:110])

print("\n7. THE COMPLEMENT — a recheckBy still in the future is honoured")
c7 = run(["X2"], ship({"why": "absent from the extract", "recheckBy": "2027-03-01"}))
check("[NOT-IN-BODS] holds", tag_of(c7, "X1") == "NOT-IN-BODS", "got %s" % tag_of(c7, "X1"))
check("and the row tells the reader when to look again",
      "2027-03-01" in msg_of(c7, "X1"), msg_of(c7, "X1")[:110])

print("\n8. LOUD — the stale direction: declared absent from a feed that carries it")
c8 = run(["X2", "X1"], ship({"why": "absent from the extract"}))
check("the declaration is reported as stale", tag_of(c8, "X1") == "NOT-IN-BODS?", "got %s" % tag_of(c8, "X1"))
check("and it is actionable, because the fix is to delete the field",
      "NOT-IN-BODS?" not in rr.NON_ACTIONABLE)
check("no [NOT-IN-BODS] is raised alongside it",
      not [k for k, lbl, _ in c8 if k == "NOT-IN-BODS"], str([k for k, lbl, _ in c8]))

print("\n9. THE JOIN — main's actionable filter reads the same constant this asserts on")
check("[NOT-IN-BODS] is expected-and-explained", "NOT-IN-BODS" in rr.NON_ACTIONABLE)
check("[COMMUNITY] still is too, unchanged", "COMMUNITY" in rr.NON_ACTIONABLE)
check("and nothing else was quietly added", set(rr.NON_ACTIONABLE) == {"COMMUNITY", "NOT-IN-BODS"},
      str(rr.NON_ACTIONABLE))

print("\n" + "=" * 78)
if FAILURES:
    print("FAILED — %d check(s) did not hold: %s" % (len(FAILURES), "; ".join(FAILURES)))
    sys.exit(1)
print("OK — the declaration is honoured only when it says why, only until its date, and never over a route the feed carries")
