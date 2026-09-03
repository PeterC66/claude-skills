#!/usr/bin/env python3
"""Falsify the SHIPPED-side consolidation in gtfs_refresh_report.py (2026-09-03).

Run from the skill root (`make-bus-leaflet`), with no arguments and no placeholders:

    python tools/prove-red-consolidation.py

Builds its own tiny SQLite feed and its own town folder for every case, like its sibling
tools/prove-red-variant-fold.py, so it needs no real dataset, no built map and no second
repository.

WHAT IS BEING FALSIFIED, and it is the mirror image of the variant fold. That fix taught
the report about variants the FEED folds together (301S into 301). This one is about the
opposite direction: a consolidation the TOWN declares, where one drawn route stands for
several GTFS route names. Wisbech draws First's `excel` and records
`variants.subServices: [A, B, C, D]`, because bustimes presents them as the single service
"A, B, C, D - excel" and the public brand is `excel`. Nothing read that field until
2026-09-03, so the diff compared route names literally and produced the same four-item lie
every month: [ADD?] A, [ADD?] B, [ADD?] C -- routes the sheet already draws -- alongside
[WITHDRAWN?] excel, a route that runs.

Those four items are individually plausible and together they are worse than noise: they
read exactly like a rebrand, an operator retiring `excel` and replacing it with A/B/C. On
2026-09-03 that is precisely how they WERE read, and the reading survived long enough to
reach a recommendation to rebuild the town, because the feed was believed and the town's
own verified-services.json was not opened. Nothing in the report could have corrected it;
the evidence lives in a field the report did not read.

The second subject is the same failure in a smaller way. A town can record "known, and
deliberately not drawn" in either of two places -- `notOnLeaflet`, or an ordinary
`services` entry carrying `servesTown: false` -- and only the first was read. The second
is worse than unread, because the `shipped` comprehension DROPS a `servesTown: false`
entry, so the route fell out of both sets and returned as "[ADD?] new in BODS" about a
service ruled on twice. Wisbech's X46 note predicted it: "the monthly scan will keep
flagging it as [NEW]".

Case 2 is the one that earns this file: it re-implements the OLD literal matching against
the SAME fixture and asserts it still cries ADD?/WITHDRAWN?, so the harness is shown to
tell the fixed code from the code that had the bug rather than agreeing with whatever is
in the file today. Case 3 is its complement and the blind spot the fix must not buy: when
the sub-services really DO go, the withdrawal must still be reported.
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
# Dates pinned, never derived from today, so the harness answers the same on any day it is
# run: the whole sampled window sits inside the services' validity.
BASE = datetime.date(2026, 9, 7)           # a Monday
END = BASE + datetime.timedelta(weeks=13)
TMP = tempfile.mkdtemp(prefix="prove-red-consolidation-")

# The real Wisbech shape: the excel journey-letters, the two operators' 46s, and X46.
FEED = {
    "A":   ("First Norfolk & Suffolk", "MTWTFSS"),
    "B":   ("First Norfolk & Suffolk", "MTWTFS."),
    "C":   ("First Norfolk & Suffolk", "MTWTFS."),
    "46":  ("Stagecoach East", "MTWTFS."),
    "X46": ("Lynx", "MTWTF.."),
    "60":  ("Lynx", "MTWTFS."),
}


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
    c.execute("INSERT INTO stops VALUES('0500FWISH01','Wisbech Bus Station','52.66','0.16')")
    for n, name in enumerate(routes):
        op, mask = FEED[name]
        rid, sid = "r%d" % n, "s%d" % n
        c.execute("INSERT INTO routes VALUES(?,?,'',?)", (rid, name, ops[op]))
        c.execute("INSERT INTO calendar VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (sid,) + tuple("1" if ch != "." else "0" for ch in mask)
                  + (BASE.strftime("%Y%m%d"), END.strftime("%Y%m%d")))
        for d, dep in enumerate(("09:00:00", "17:00:00")):
            tid = "t%d_%d" % (n, d)
            c.execute("INSERT INTO trips VALUES(?,?,?,?,?,'')", (tid, rid, sid, str(d), "Wisbech,Bus Station"))
            c.execute("INSERT INTO stop_times VALUES(?,'0500FWISH01','1',?,?)", (tid, dep, dep))
    con.commit()
    con.close()
    return path


build_feed.n = 0
CFG = {"region": "testshire", "prefixes": ["0500FWISH"]}


def town_dir(services):
    """A town folder holding one S1 run shipping exactly `services` (already-built dicts)."""
    d = os.path.join(TMP, "town-%d" % town_dir.n, "S1-services", "2026-09-01_0000")
    town_dir.n += 1
    os.makedirs(d)
    with open(os.path.join(d, "verified-services.json"), "w", encoding="utf-8") as f:
        json.dump({"town": "Wisbech", "verifiedOn": "2026-09-01", "services": services}, f)
    return os.path.dirname(os.path.dirname(d))


town_dir.n = 0


def svc(route, operator, mask, **kw):
    s = {"route": route, "key": route, "operator": operator,
         "days": rr.fmt({i for i, ch in enumerate(mask) if ch != "."}),
         "status": "live", "servesTown": True, "source": "gtfs"}
    s.update(kw)
    return s


def excel(subs, shape="dict"):
    """The shipped `excel` entry, in either variants shape the estate actually uses."""
    v = {"subServices": list(subs), "note": "public brand = excel"}
    return svc("excel", "First Norfolk & Suffolk", "MTWTFSS",
               variants=(v if shape == "dict" else [v]))


def run(feed_routes, services):
    res = rr.diff_town(build_feed(feed_routes), "Wisbech", CFG, town_dir(services))
    return res["changes"]


def kinds(changes, kind):
    return sorted(lbl for k, lbl, _ in changes if k == kind)


def old_literal(feed_routes, services):
    """The matching as it stood BEFORE the fix, reproduced so case 2 can show the harness
    distinguishes the two: shipped keyed by route name alone, subServices unread, and a
    `servesTown: false` entry dropped from the shipped set entirely."""
    import gtfs_query as gq
    gtfs = rr.fold_gtfs(gq.query(build_feed(feed_routes), ["0500FWISH"], None, "Wisbech")["services"])
    shipped = {str(s["route"]) for s in services if s.get("servesTown", True)}
    return sorted(r for r in gtfs if r not in shipped), sorted(r for r in shipped if r not in gtfs)


print("Falsifying the shipped-side consolidation in the monthly refresh report\n")

FULL = ["A", "B", "C", "46", "X46", "60"]
SHIPPED = [excel(["A", "B", "C", "D"]), svc("46", "Stagecoach East", "MTWTFS."),
           svc("60", "Lynx", "MTWTFS."),
           svc("X46", "Lynx", "MTWTF..", status="withdrawn", servesTown=False)]

# ------------------------------------------------------------------- 1. the control
ctl = run(FULL, SHIPPED)
check("a consolidated brand is not proposed as new routes", kinds(ctl, "ADD?") == [], repr(ctl))
check("a consolidated brand is not reported withdrawn", kinds(ctl, "WITHDRAWN?") == [], repr(ctl))
check("a servesTown:false service reads RE-EVAL, not ADD?", kinds(ctl, "RE-EVAL") == ["X46"], repr(ctl))

# --------------------------------------- 2. the harness can tell the fix from the bug
added, gone = old_literal(FULL, SHIPPED)
check("OLD matching cries ADD? for the journey-letters and X46",
      added == ["A", "B", "C", "X46"], repr(added))
check("OLD matching cries WITHDRAWN? for the brand", gone == ["excel"], repr(gone))

# ---------------------------- 3. the blind spot the fix must NOT buy: a real withdrawal
really_gone = run(["46", "60"], SHIPPED)
check("when every sub-service goes, the brand IS reported withdrawn",
      kinds(really_gone, "WITHDRAWN?") == ["excel"], repr(really_gone))

# --------------------------------- 4. covered, not verified -- the documented trade-off
# One letter left in the feed still covers the brand. This is the same trade fold_gtfs
# makes for 32/32A and is pinned here so a future reader sees it was chosen, not missed.
partial = run(["A", "46", "60"], SHIPPED)
check("one surviving sub-service still covers the brand (covered != verified)",
      kinds(partial, "WITHDRAWN?") == [] and kinds(partial, "ADD?") == [], repr(partial))

# ------------------------------------------------- 5. the LIST shape of `variants` too
list_shape = [excel(["A", "B", "C", "D"], shape="list"), svc("46", "Stagecoach East", "MTWTFS."),
              svc("60", "Lynx", "MTWTFS.")]
lst = run(["A", "B", "C", "46", "60"], list_shape)
check("variants declared as a LIST is honoured as well as a dict",
      kinds(lst, "ADD?") == [] and kinds(lst, "WITHDRAWN?") == [], repr(lst))

# --------------------------------------------- 6. the fix must not swallow a real new one
newone = run(FULL, [excel(["A", "B", "C", "D"]), svc("46", "Stagecoach East", "MTWTFS."),
                    svc("X46", "Lynx", "MTWTF..", status="withdrawn", servesTown=False)])
check("a genuinely undrawn route is still proposed", kinds(newone, "ADD?") == ["60"], repr(newone))

# ------------------------------------- 7. an empty subServices list swallows nothing
empty = run(FULL, [excel([]), svc("46", "Stagecoach East", "MTWTFS."), svc("60", "Lynx", "MTWTFS.")])
check("empty subServices consolidates nothing and the brand still reports withdrawn",
      kinds(empty, "ADD?") == ["A", "B", "C", "X46"] and kinds(empty, "WITHDRAWN?") == ["excel"],
      repr(empty))

# ------- 8. verifiedNotDisplayed: the convention that fooled us on route 20
# High Wycombe files 18 entries this way, {route, note}, sixteen of them "school" and one
# "withdrawn" — route 20, whose exclusion is argued from the operator's own network review.
# It reported [ADD?] every month anyway, and on 2026-09-03 that row was read as a real
# service missing from a sheet awaiting publication.
VND = [excel(["A", "B", "C", "D"]), svc("46", "Stagecoach East", "MTWTFS.")]


def town_with(extra):
    d = os.path.join(TMP, "town-x-%d" % town_with.n, "S1-services", "2026-09-01_0000")
    town_with.n += 1
    os.makedirs(d)
    doc = {"town": "Wisbech", "verifiedOn": "2026-09-01", "services": VND}
    doc.update(extra)
    with open(os.path.join(d, "verified-services.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f)
    return os.path.dirname(os.path.dirname(d))


town_with.n = 0

vnd = rr.diff_town(build_feed(["A", "B", "C", "46", "60", "X46"]), "Wisbech", CFG,
                   town_with({"verifiedNotDisplayed": [{"route": "60", "note": "school"},
                                                       {"route": "X46", "note": "withdrawn"}]}))["changes"]
check("verifiedNotDisplayed is not reported as new", kinds(vnd, "ADD?") == [], repr(vnd))
check("...it is RE-EVAL, carrying the town's own recorded reason",
      sorted(kinds(vnd, "RE-EVAL")) == ["60", "X46"]
      and any("school" in why for k, l, why in vnd if l == "60")
      and any("withdrawn" in why for k, l, why in vnd if l == "X46"), repr(vnd))
check("...and it says plainly that the route is NOT new",
      all("NOT new" in why for k, l, why in vnd if k == "RE-EVAL"), repr(vnd))

# --------------------- 9. notDisplayed: Huntingdon's older bare-string form
nd = rr.diff_town(build_feed(["A", "B", "C", "46", "60"]), "Wisbech", CFG,
                  town_with({"notDisplayed": ["60"]}))["changes"]
check("a bare notDisplayed string is not reported as new",
      kinds(nd, "ADD?") == [] and kinds(nd, "RE-EVAL") == ["60"], repr(nd))

# -------------------------- 10. the harness still tells the fix from the bug
# Membership, not equality: this fixture ALSO ships `excel` with subServices, so the old
# matching cries ADD? for A/B/C too — that is case 2's subject, not this one. What this
# case must show is that the two NEW conventions were among the false positives before.
added_v, _ = old_literal(["A", "B", "C", "46", "60", "X46"], VND)
check("OLD matching cries ADD? for both new conventions",
      "60" in added_v and "X46" in added_v, repr(added_v))

# ------- 11. the blind spot: a recorded exclusion must not invent a row when absent
absent = rr.diff_town(build_feed(["A", "B", "C", "46"]), "Wisbech", CFG,
                      town_with({"verifiedNotDisplayed": [{"route": "60", "note": "school"}]}))["changes"]
check("a not-drawn route absent from the feed produces no row at all",
      kinds(absent, "RE-EVAL") == [] and kinds(absent, "ADD?") == [], repr(absent))

shutil.rmtree(TMP, ignore_errors=True)

print()
if FAILURES:
    print("%d FAILURE(S): %s" % (len(FAILURES), ", ".join(FAILURES)))
    sys.exit(1)
print("All cases behaved: a declared consolidation is honoured in both shapes, a")
print("servesTown:false service is known rather than new, a real withdrawal still")
print("reports, and the pre-fix matching is shown to get this fixture wrong.")
