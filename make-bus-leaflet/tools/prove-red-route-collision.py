#!/usr/bin/env python3
"""Falsify the route-number collision fix (OA-134).

Run from the skill root (`make-bus-leaflet`), with no arguments and no placeholders:

    python tools/prove-red-route-collision.py

Needs no GTFS dataset, no built map and no second repository: BODS is stubbed and the
shipped service list is synthetic, so this runs on a fresh clone anywhere Python runs.
That is deliberate — the fault it guards lives in `gtfs_refresh_report.py`, whose real
inputs are a 139 MB sqlite that is in no repository, and a harness as local as its
subject is a harness CI cannot run.

WHAT IS BEING FALSIFIED. `diff_town` indexed the shipped service list by route NUMBER:

    shipped = {s["route"]: s for s in vs["services"] ...}

Wisbech ships eleven services and ten distinct numbers, because it runs two route 46s
(Stagecoach East to March, Lynx to King's Lynn). That line therefore built ten entries,
the second 46 overwrote the first, and the monthly change scan had never once diffed the
Stagecoach East 46 against BODS. Nothing threw, nothing was missing, every route appeared
exactly once, and the report looked complete.

Each case below comes in a pair, which is the whole point: QUIET on data that is right,
LOUD on a fault of the same kind. Case 3 is the one that earns the file — it re-runs the
OLD logic against the same mutant and asserts it stays SILENT, so the harness is shown to
distinguish the fixed code from the code that had the bug, rather than merely agreeing
with whatever is in the file today.
"""
import os, sys, json, io, shutil, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
sys.path.insert(0, ASSETS)

import gtfs_refresh_report as rr          # noqa: E402
import index_guard as ig                  # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    print("  %-4s %s%s" % ("ok" if ok else "FAIL", name, ("  -- " + detail) if detail else ""))
    if not ok:
        FAILURES.append(name)


# ----------------------------------------------------------------- the fixture
# Three shipped services on two numbers. The 46s are the collision; the 60 is the
# control row that must behave identically before and after, so a difference in the
# report can never be blamed on the fix in general.
def shipped_services(op46="Stagecoach East", op46l="Lynx"):
    return [
        {"key": "46",  "route": "46", "operator": op46,  "days": "Mon-Sat", "servesTown": True},
        {"key": "46L", "route": "46", "operator": op46l, "days": "Mon-Sat", "servesTown": True},
        {"key": "60",  "route": "60", "operator": "Lynx", "days": "Mon-Sat", "servesTown": True},
    ]


MON_SAT = [1, 1, 1, 1, 1, 1, 0]

# What BODS says: both 46s exist under their real operators, and so does the 60.
BODS = [
    {"route": "46", "operator": "Stagecoach East", "daysFlags": MON_SAT,
     "possibleVariantOf": None, "hasGtfsShape": True},
    {"route": "46", "operator": "Lynx", "daysFlags": MON_SAT,
     "possibleVariantOf": None, "hasGtfsShape": True},
    {"route": "60", "operator": "Lynx", "daysFlags": MON_SAT,
     "possibleVariantOf": None, "hasGtfsShape": True},
]


class StubQuery(object):
    """Stands in for gtfs_query.query, which wants a 139 MB sqlite."""

    def __init__(self, services):
        self.services = services

    def __call__(self, db, prefixes, near, name):
        return {"services": self.services}


def run_current(services, bods=BODS):
    """The diff_town in assets/ today, over a synthetic town."""
    tmp = tempfile.mkdtemp()
    try:
        d = os.path.join(tmp, "S1-services", "2026-01-01_0000")
        os.makedirs(d)
        json.dump({"services": services, "verifiedOn": "2026-01-01"},
                  io.open(os.path.join(d, "verified-services.json"), "w", encoding="utf-8"))
        real = rr.gq.query
        rr.gq.query = StubQuery(bods)
        try:
            return sorted(rr.diff_town("no-db", "Fixtureham", {"prefixes": ["0500FTEST"]}, tmp)["changes"])
        finally:
            rr.gq.query = real
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_pre_fix(services, bods=BODS):
    """`diff_town` as it stood before 2026-08-28: one winner per route NUMBER.

    Kept here on purpose rather than deleted with the bug. A harness that can only
    run the current code cannot show that it would have caught the historical fault,
    and 'the tests pass' is then a statement about today's code agreeing with itself.
    """
    shipped = {s["route"]: s for s in services if s.get("servesTown", True)}
    gtfs = rr.fold_gtfs(bods)
    changes = []
    for r, g in gtfs.items():
        gdays = set(i for i in range(7) if g["flags"][i])
        if r in shipped:
            sh = shipped[r]
            gops = g["operators"]
            shop = sh.get("operator") or ""
            if not any(o in shop or shop in o for o in gops):
                changes.append(("OPERATOR", r, "shipped %r" % shop))
            sd = rr.parse_days(sh.get("days"))
            if sd is not None and sd != gdays:
                changes.append(("DAYS", r, "days differ"))
    return sorted(changes)


def tags(changes, *labels):
    return sorted((t, lab) for t, lab, _ in changes if lab in labels)


print(__doc__.strip().splitlines()[0])
print("")

# --------------------------------------------------------- 0. the fixture itself
# The row count IS the property under test here: a fixture that quietly lost its
# second 46 would make every case below pass for the wrong reason.
svc = shipped_services()
print("0. the fixture")
check("three shipped services on two distinct numbers",
      len(svc) == 3 and len({s["route"] for s in svc}) == 2,
      "%d services, %d numbers" % (len(svc), len({s["route"] for s in svc})))
check("BODS stub carries both 46 operators",
      len([s for s in BODS if s["route"] == "46"]) == 2)

# ------------------------------------------------------------ 1. the guard alone
print("")
print("1. index_guard refuses to lose a row")
try:
    ig.index_unique(svc, key=lambda s: str(s["route"]), what="fixture by route number")
    check("indexing by route NUMBER raises", False, "it did not raise")
except ValueError as e:
    check("indexing by route NUMBER raises", True, str(e).split(" -- ")[0])
try:
    m = ig.index_unique(svc, what="fixture by key")
    check("indexing by `key` succeeds and keeps all three", len(m) == 3, "%d entries" % len(m))
except ValueError as e:
    check("indexing by `key` succeeds and keeps all three", False, str(e))
check("group_by keeps both 46s under one number",
      len(ig.group_by(svc, key=lambda s: str(s["route"]))["46"]) == 2)

# ------------------------------------------------------------------ 2. CONTROLS
print("")
print("2. control -- correct data must stay quiet")
ctl = run_current(svc)
check("current code reports nothing about 46/46L/60", not tags(ctl, "46", "46L", "60"),
      str(ctl) if ctl else "")
check("pre-fix code also reports nothing", not run_pre_fix(svc))

# ------------------------------------------------- 3. THE ONE THAT EARNS THE FILE
print("")
print("3. mutant -- the operator of the FIRST 46 changes (the entry the old index dropped)")
mut_a = shipped_services(op46="Whippet Coaches")
now = run_current(mut_a)
before = run_pre_fix(mut_a)
check("current code reports OPERATOR for 46", ("OPERATOR", "46") in tags(now, "46", "46L"), str(now))
check("current code does NOT also fire for 46L", ("OPERATOR", "46L") not in tags(now, "46", "46L"))
check("PRE-FIX code is SILENT -- this is the bug, reproduced", not before,
      "the old index kept the Lynx entry and never checked this one")

# ---------------------------------------------------------- 4. the other direction
print("")
print("4. mutant -- the operator of 46L changes (the entry the old index kept)")
mut_b = shipped_services(op46l="Whippet Coaches")
now = run_current(mut_b)
before = run_pre_fix(mut_b)
check("current code reports OPERATOR for 46L", ("OPERATOR", "46L") in tags(now, "46", "46L"), str(now))
check("pre-fix code fires but MISLABELS it '46'",
      before and before[0][1] == "46", str(before))

# ------------------------------------------------------- 5. days, per operator
print("")
print("5. mutant -- one operator's days shrink; the folded union must not hide it")
bods_shrunk = [dict(s) for s in BODS]
for s in bods_shrunk:
    if s["route"] == "46" and s["operator"] == "Stagecoach East":
        s["daysFlags"] = [1, 1, 1, 1, 1, 0, 0]        # Mon-Fri now, shipped says Mon-Sat
now = run_current(svc, bods_shrunk)
before = run_pre_fix(svc, bods_shrunk)
check("current code reports DAYS for 46", ("DAYS", "46") in tags(now, "46", "46L"), str(now))
check("current code leaves 46L alone", ("DAYS", "46L") not in tags(now, "46", "46L"))
check("PRE-FIX code is SILENT -- the union of both operators still spans Mon-Sat",
      not before, str(before))

# ------------------------------------------- 6. the single-operator town is inert
print("")
print("6. inertness -- a town with no colliding number is byte-identical either way")
plain = [{"key": "60", "route": "60", "operator": "Lynx", "days": "Mon-Sat", "servesTown": True}]
plain_bods = [s for s in BODS if s["route"] == "60"]
check("current and pre-fix agree exactly",
      run_current(plain, plain_bods) == run_pre_fix(plain, plain_bods),
      "%r vs %r" % (run_current(plain, plain_bods), run_pre_fix(plain, plain_bods)))

print("")
if FAILURES:
    print("FAILED: %d check(s) -- %s" % (len(FAILURES), "; ".join(FAILURES)))
    sys.exit(1)
print("All checks passed: the fix fires where the old code was silent, and is inert "
      "on a town with no colliding route number.")
