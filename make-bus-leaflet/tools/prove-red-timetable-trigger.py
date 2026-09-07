#!/usr/bin/env python3
"""Falsify the [TIMETABLE] trigger message in gtfs_upcoming.py (OA-269, 2026-09-07).

Run from the skill root (`make-bus-leaflet`), with no arguments and no placeholders:

    python tools/prove-red-timetable-trigger.py

`diff_findings` is a pure function over two route dictionaries, so unlike its siblings
tools/prove-red-consolidation.py and tools/prove-red-variant-fold.py this harness needs no
SQLite fixture, no town folder and no built map -- the route dicts ARE the fixture.

WHAT IS BEING FALSIFIED. [TIMETABLE] fires when `routingHash` differs OR `tripCount`
differs, and until 2026-09-07 it printed the same sentence for both: "stops/frequency
changed (trips P -> C) - re-check routing & times". The two triggers are not of equal
worth. `routingHash` is a SHA-1 over the distinct stop sequences, so a move means the road
moved. `tripCount` is `len(distinct trip_id)`, the quantity gtfs_query.py exports as
`tripPatternsAtTown` and whose own docstring bans tiering, weighting, sorting or drawing
from it -- it is not a rate, and it understates by x2.0 to x5.7 according to how many
`service_id`s the operator split their timetable into.

It cost a wrong verdict. St Neots Co-op was adjudicated `rebuild-needed` on 2026-08-31 off
"trips 161 -> 126", read as a 22% service cut on a sheet drawing 905 as `frequent` at a
boundary headway of exactly 30 minutes. Re-measured on 2026-09-07 at that place's own
frame, `journeysPerWeek` had held at 326 and `coreHeadwayMinutes` at 30; the operator had
re-registered the same service under fewer `service_id`s. Case 3 is that route.

The other direction is case 1, and it is what makes the message uninformative on its own
terms rather than merely imprecise: 7 of the 21 findings on the 2026-08-31 scan printed an
UNCHANGED count as their evidence -- 201 -> 201, 199 -> 199, 75 -> 75, 53 -> 53 and three
at 2 -> 2. Those fired on the routing hash alone and the number printed beside them had
not moved.

Case 5 is the one that earns this file. It re-implements the OLD undifferentiated sentence
against the SAME fixtures and asserts it cannot tell cases 1 and 3 apart, so the harness is
shown to distinguish the fixed code from the code that had the bug rather than agreeing
with whatever is in the file today.

Cases 6 and 7 are the two blind spots the fix must NOT buy, and both are named in OA-269
as wrong fixes: the count trigger must still raise a finding when the routing hash holds
(dropping it would hide a real re-registration), and a route with nothing moving at all
must still raise nothing.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
sys.path.insert(0, ASSETS)

import gtfs_upcoming as up                   # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    print("  %-4s %s%s" % ("ok" if ok else "FAIL", name, ("  -- " + detail) if detail else ""))
    if not ok:
        FAILURES.append(name)


def route(trips, routing, operators=("Whippet Coaches",), days="Mon-Sat"):
    """One entry of the dict diff_findings compares. Only the four keys it reads."""
    return {"tripCount": trips, "routingHash": routing,
            "operators": list(operators), "days": days}


def timetable(cur, prev):
    """The [TIMETABLE] messages diff_findings raises for these two snapshots, by route."""
    return {sn: msg for kind, sn, *rest in up.diff_findings(cur, prev)
            for msg in [rest[-1]] if kind == "TIMETABLE"}


def old_message(prev_trips, cur_trips):
    """The sentence as it stood BEFORE the fix, reproduced verbatim from the line this
    change replaced, so case 5 can show the harness tells the two apart."""
    return f"stops/frequency changed (trips {prev_trips} -> {cur_trips}) - re-check routing & times"


print("Falsifying the [TIMETABLE] trigger message in the monthly upcoming scan\n")

# --------------------------------------------------------------------- the fixtures
# The three shapes a [TIMETABLE] finding can have, plus the two that must raise nothing.
# Trip counts are the real ones off the 2026-08-31 scan.
HASH_A, HASH_B = "aaaaaaaaaaaa", "bbbbbbbbbbbb"

# 1. routing moved, count held -- 7 of the 21 findings on the 2026-08-31 scan
ROUTING_ONLY_PREV = {"52": route(201, HASH_A)}
ROUTING_ONLY_CUR = {"52": route(201, HASH_B)}

# 2. both moved -- the unambiguous case, where the old sentence was already right
BOTH_PREV = {"43A": route(80, HASH_A)}
BOTH_CUR = {"43A": route(64, HASH_B)}

# 3. count moved, routing held -- St Neots Co-op's 905, the wrong verdict
COUNT_ONLY_PREV = {"905": route(161, HASH_A)}
COUNT_ONLY_CUR = {"905": route(126, HASH_A)}

# ---------------------------------- 1. routing alone: no unmoved number as its evidence
m1 = timetable(ROUTING_ONLY_CUR, ROUTING_ONLY_PREV)
check("routing alone raises a finding", list(m1) == ["52"], repr(m1))
check("...it says the stop sequences changed", "stop sequences changed" in m1.get("52", ""), repr(m1))
check("...it keeps the re-check instruction", "re-check routing" in m1.get("52", ""), repr(m1))
check("...and it does NOT print '201 -> 201' as its evidence",
      "201 -> 201" not in m1.get("52", ""), repr(m1))

# ------------------------------------------------- 2. both moved: routing still leads
m2 = timetable(BOTH_CUR, BOTH_PREV)
check("both triggers raise a finding", list(m2) == ["43A"], repr(m2))
check("...routing leads, because it is the trigger worth acting on",
      "stop sequences changed" in m2.get("43A", ""), repr(m2))
check("...the count is carried as detail", "80 -> 64" in m2.get("43A", ""), repr(m2))
check("...and the re-check instruction stands", "re-check routing" in m2.get("43A", ""), repr(m2))

# ------------------------------------------- 3. count alone: the St Neots Co-op verdict
m3 = timetable(COUNT_ONLY_CUR, COUNT_ONLY_PREV)
check("count alone still raises a finding (the trigger is KEPT)", list(m3) == ["905"], repr(m3))
check("...it says the stop sequences did NOT change",
      "stop sequences UNCHANGED" in m3.get("905", ""), repr(m3))
check("...it names the count as registration bookkeeping, not service",
      "service_ids" in m3.get("905", ""), repr(m3))
check("...it warns the count is not a rate", "not a rate" in m3.get("905", ""), repr(m3))
check("...it names what to measure instead",
      "journeysPerWeek" in m3.get("905", "") and "coreHeadwayMinutes" in m3.get("905", ""), repr(m3))
check("...and it does NOT tell the reader to re-check routing",
      "re-check routing" not in m3.get("905", ""), repr(m3))

# ---------------------- 4. the three messages are distinguishable from each other
# .get with a per-case sentinel rather than [], so a mutation that SILENCES one of the
# three fails this case with a readable line instead of a KeyError traceback that hides
# every case after it. Dropping the count trigger -- the wrong fix OA-269 names -- is
# exactly that mutation, and case 6 is the one that must report it.
msgs = [m1.get("52", "<52 silent>"), m2.get("43A", "<43A silent>"), m3.get("905", "<905 silent>")]
check("all three shapes produce different sentences", len(set(msgs)) == 3, repr(msgs))

# ------------------- 5. the harness tells the FIXED code from the code that had the bug
# The old sentence could not separate cases 1 and 3: strip the numbers and it is one
# string for both, which is exactly the complaint OA-269 makes.
old1 = old_message(201, 201)
old3 = old_message(161, 126)
check("OLD sentence claims 'stops/frequency changed' for a routing-only move",
      "stops/frequency changed" in old1, old1)
check("OLD sentence claims the same for a count-only move",
      "stops/frequency changed" in old3, old3)
check("OLD sentence gives both the same re-check instruction",
      old1.split("(")[0] == old3.split("(")[0], "%r vs %r" % (old1, old3))
check("OLD sentence printed an unmoved number as evidence", "201 -> 201" in old1, old1)
check("the FIXED messages are not the old sentence",
      old1 not in msgs and old3 not in msgs, repr(msgs))

# ------- 6. the blind spot named in OA-269: do not drop the count trigger
# A route whose trips genuinely halve while its stop sequences hold is a real change the
# routing hash cannot see. Case 3 already proves it raises; this states it as the rule.
check("a count-only move is never silent", timetable(COUNT_ONLY_CUR, COUNT_ONLY_PREV) != {},
      "dropping the tripCount trigger would hide a re-registration entirely")

# ------------------------- 7. the other blind spot: nothing moving raises nothing
quiet = timetable(COUNT_ONLY_PREV, COUNT_ONLY_PREV)
check("an unchanged route raises no [TIMETABLE] at all", quiet == {}, repr(quiet))

# ------- 8. a route absent from the previous snapshot is APPEARED, not [TIMETABLE]
# `.get(sn)` on a missing route would make both triggers fire against None and print
# "? -> N", which reads as a timetable change on a route that has none yet.
appeared = up.diff_findings({"X1": route(12, HASH_A)}, {})
check("a brand-new route is APPEARED and raises no [TIMETABLE]",
      [k for k, *_ in appeared] == ["APPEARED"], repr(appeared))

# ------- 9. the other findings are untouched by this change
mixed = up.diff_findings({"66": route(40, HASH_B, operators=("Stagecoach East",), days="Daily")},
                         {"66": route(40, HASH_A, operators=("Whippet Coaches",), days="Mon-Sat")})
kinds = sorted(k for k, *_ in mixed)
check("OPERATOR and DAYS still raise alongside TIMETABLE",
      kinds == ["DAYS", "OPERATOR", "TIMETABLE"], repr(kinds))

print()
if FAILURES:
    print("%d FAILURE(S): %s" % (len(FAILURES), ", ".join(FAILURES)))
    sys.exit(1)
print("All cases behaved: a [TIMETABLE] finding now names which of its two triggers fired,")
print("a routing-only move no longer prints an unmoved count as its evidence, a count-only")
print("move says so and points at the fields that ARE rates, and the pre-fix sentence is")
print("shown to be unable to tell those two apart.")
