#!/usr/bin/env python3
"""Falsify the SAFE monthly refresh in refresh_town.py (buses-data OA-426).

Run from the skill root (`make-bus-leaflet`), with no arguments and no placeholders:

    python tools/prove-red-refresh-town.py

Needs no GTFS dataset, no built map and no second repository. Every case builds the
exact structures the function under test takes, so this runs on a fresh clone anywhere
Python runs -- which matters, because the real subject is a 139 MB sqlite and a 200 MB
town tree, and neither is in any repository.

WHAT THIS CAN AND CANNOT SEE, SAID BEFORE THE CASES RATHER THAN DISCOVERED AFTER. The
decisions refresh_town.py makes are all here: what is SAFE, what may be patched, what
must not be overwritten, what a label is allowed to change, and what the grading sidecar
is allowed to say. What is NOT here is the S1-S3-S4-S5 chain itself, because driving it
needs the feed and the town tree. That half was proved on the laptop on 2026-09-22
against a scratch copy of Ramsey, and the proof is recorded in the round: the refreshed
external sheet came out BYTE-IDENTICAL to the real shipped one apart from its build
stamp, the label check refused an unexplained change and left S1 and S3 uncommitted, and
`--by` reached all four stage records. `actions/checkout` cannot reproduce any of that,
so putting it in CI would be putting a check somewhere it is green for ever.

THREE CASES EARN THE FILE, and each re-implements the behaviour this code HAD before a
real defect was found, then asserts the current code disagrees with it:

  * case 6  the appending that made a map's key read as four badges with no operator
  * case 8  the empty string that, allowed through, explains every label there is
  * case 10 the older grading that would have been attached to a newer scan

Without those, the rest would pass just as well against the code that had the bug.
"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
sys.path.insert(0, ASSETS)

import gtfs_refresh_report as rr    # noqa: E402
import refresh_town as rt           # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    print("  %-4s %s%s" % ("ok" if ok else "FAIL", name, ("  -- " + detail) if detail else ""))
    if not ok:
        FAILURES.append(name)


# ------------------------------------------------- 1. the grade is rr's, not a copy
print("\n1. SAFE is `classify()`'s answer, and this file does not have a second one")

check("OPERATOR and DAYS alone -> SAFE",
      rr.classify([("OPERATOR", "32", "m"), ("DAYS", "32", "m")])[0] == "SAFE")
check("one other actionable tag escalates the whole town",
      rr.classify([("OPERATOR", "32", "m"), ("ADD?", "9", "m")])[0] == "ESCALATE")
check("a tag classify() has never heard of escalates",
      rr.classify([("SOMETHING-NEW", "9", "m")])[0] == "ESCALATE")
check("nothing actionable -> NOTHING",
      rr.classify([("COMMUNITY", "RH2", "m")])[0] == "NOTHING")
check("refresh_town imports that function rather than defining one",
      not hasattr(rt, "classify"), "a `classify` here would be the second copy")


# ------------------------------------- 2. the service list is patched per shipped ENTRY
print("\n2. verified-services.json: every entry carrying the route, never the first one")

vs = {"services": [
    {"route": "46", "operator": "Old A", "days": "Mon-Fri"},        # the OA-134 pair:
    {"route": "46", "operator": "Old B", "days": "Mon-Fri"},        # two entries, one number
    {"route": "9", "operator": "Untouched", "days": "Sun"},
]}
touched = rt.patch_verified_services(vs, {"46"}, {"46": ("New Op", "Mon-Sat")})
check("both entries numbered 46 were patched, not just the first",
      [s["operator"] for s in vs["services"][:2]] == ["New Op", "New Op"],
      repr([s["operator"] for s in vs["services"][:2]]))
check("the route nobody flagged is untouched",
      vs["services"][2] == {"route": "9", "operator": "Untouched", "days": "Sun"})
check("every change is reported, four of them", len(touched) == 4, repr(touched))
check("a value already correct is not reported as a change",
      rt.patch_verified_services({"services": [{"route": "1", "operator": "X", "days": "Sun"}]},
                                 {"1"}, {"1": ("X", "Sun")}) == [])


# ---------------------------------- 3. the config layer: ours is corrected, theirs is not
print("\n3. routes.json: a value the machine wrote is corrected, a person's is a conflict")

def routes_fixture(op_name="Old Op", days="Mon-Fri"):
    return {"routeOrder": ["32", "301", "303"],
            "operators": [{"name": op_name, "routes": ["32"]},
                          {"name": "Other", "routes": ["301", "303"]}],
            "external": [{"route": "32", "days": days}]}

r = routes_fixture()
touched, conflicts = rt.patch_routes_json(r, {"32"}, {"32": ("Other", "Mon-Sat")},
                                          {"32": ("Old Op", "Mon-Fri")})
check("the route is re-filed under the operator the feed names",
      [o["name"] for o in r["operators"] if "32" in o["routes"]] == ["Other"],
      repr(r["operators"]))
check("the emptied operator entry is dropped rather than left blank",
      [o["name"] for o in r["operators"]] == ["Other"], repr(r["operators"]))
check("no second entry was appended for a name that already exists",
      len(r["operators"]) == 1, repr(r["operators"]))
check("the spoke's days were updated too", r["external"][0]["days"] == "Mon-Sat")
check("nothing was reported as a conflict", conflicts == [], repr(conflicts))

# the Ramsey shape: routes.json says `&`, the feed says `and`
r = routes_fixture(op_name="Dews & Sons")
touched, conflicts = rt.patch_routes_json(r, {"32"}, {"32": ("Dews and Sons Ltd", "Mon-Fri")},
                                          {"32": ("Dews and Sons", "Mon-Fri")})
check("an operator name a person wrote is a CONFLICT, not an overwrite",
      [c[1] for c in conflicts] == ["operators[].name"], repr(conflicts))
check("  and the structure was not touched on the way to refusing",
      r["operators"][0] == {"name": "Dews & Sons", "routes": ["32"]}, repr(r["operators"]))
check("  and the conflict names the sheet's string, the old one and the new one",
      conflicts[0][2:] == ("Dews & Sons", "Dews and Sons", "Dews and Sons Ltd"), repr(conflicts))

# the other Ramsey shape: a spoke saying "Fri only" where the feed says "Fri"
r = routes_fixture(days="Mon-Sat (305 Mon-Fri)")
touched, conflicts = rt.patch_routes_json(r, {"32"}, {"32": ("Old Op", "Mon-Sun")},
                                          {"32": ("Old Op", "Mon-Sat")})
check("an editorial day string is a CONFLICT, not flattened into fmt()'s form",
      [c[1] for c in conflicts] == ["external[].days"], repr(conflicts))
check("  and the sentence about two routes survives",
      r["external"][0]["days"] == "Mon-Sat (305 Mon-Fri)")

# a route routes.json does not file at all is not an error
r = {"operators": [{"name": "Other", "routes": ["301"]}], "external": []}
touched, conflicts = rt.patch_routes_json(r, {"32"}, {"32": ("New", "Sun")}, {"32": ("Old", "Mon")})
check("a route the config does not file is skipped, and is not a conflict",
      (touched, conflicts) == ([], []), repr((touched, conflicts)))


# ---------------------------------------------- 4. an unchanged field is not rewritten
print("\n4. a field the feed did not move is left alone")

r = routes_fixture()
touched, conflicts = rt.patch_routes_json(r, {"32"}, {"32": ("Old Op", "Mon-Fri")},
                                          {"32": ("Old Op", "Mon-Fri")})
check("nothing to do means nothing done", (touched, conflicts) == ([], []), repr(touched))


# ------------------------------------------------------ 5 & 6. the town's own order
print("\n5. the declared route order is restored, and 6. the appending that broke a key")

check("a re-filed route lands where routeOrder puts it, not at the end",
      rt.in_route_order(["301", "303", "305", "X31", "32"],
                        ["32", "301", "303", "305", "X31"]) == ["32", "301", "303", "305", "X31"])
check("a route the order does not mention goes after the ones it does",
      rt.in_route_order(["ZZ", "32"], ["32", "301"]) == ["32", "ZZ"])
check("no declared order means the order is left as it is",
      rt.in_route_order(["301", "32"], None) == ["301", "32"])
check("an empty declared order is the same answer",
      rt.in_route_order(["301", "32"], []) == ["301", "32"])

# 6. THE ARM THAT EARNS THE CASE. Re-implement the append this code did until the sheet
# was looked at, and assert the current function disagrees with it on Ramsey's own data.
def old_append(entries, _route_order):
    return list(entries)

ramsey_order = ["32", "301", "303", "305", "X31", "RH2", "RH5"]
moved = ["301", "303", "305", "X31", "32"]
check("the OLD appending still puts 32 last on Ramsey's data",
      old_append(moved, ramsey_order) == ["301", "303", "305", "X31", "32"])
check("  and the fixed ordering disagrees with it",
      rt.in_route_order(moved, ramsey_order) != old_append(moved, ramsey_order))
check("  giving the order Ramsey's routes.json actually ships",
      rt.in_route_order(moved, ramsey_order) == ["32", "301", "303", "305", "X31"])


# ------------------------------------------- 7 & 8. what a label is allowed to mention
print("\n7. a label must mention something the patch touched, and 8. the empty string")

patch = [("32", "operator", "Old Coaches Ltd", "Dews Coaches"),
         ("32", "days", "Mon-Fri", "Mon-Sat")]
allowed = rt.touched_strings(patch)
check("every old and new value is allowed",
      allowed == {"Old Coaches Ltd", "Dews Coaches", "Mon-Fri", "Mon-Sat"}, repr(allowed))

diff = {"lost": ["Old Coaches Ltd"], "gained": [], "rewrapped": []}
check("a lost label naming an old value is explained",
      rt.unexplained_labels(diff, allowed) == [])
diff = {"lost": [], "gained": ["Ramsey Zebra Crossing Notice"], "rewrapped": []}
check("a gained label naming nothing the patch touched is NOT explained",
      rt.unexplained_labels(diff, allowed) == [("gained", "Ramsey Zebra Crossing Notice")])
diff = {"lost": [], "gained": [], "rewrapped": [{"label": "A long note", "as": ["A long", "note"]}]}
check("a rewrapped label is not asked to explain itself",
      rt.unexplained_labels(diff, allowed) == [], "same words, different lines")
check("a label CONTAINING a touched value is explained",
      rt.unexplained_labels({"lost": ["32 Dews Coaches Mon-Sat"], "gained": [], "rewrapped": []},
                            allowed) == [])

# 8. THE ARM THAT EARNS THE CASE. `"" in anything` is True, so one empty string in the
# allowed set turns the whole check off and says nothing. Prove the filter is what stops it.
check("an empty old value is dropped from the allowed set",
      rt.touched_strings([("9", "operator", "", "New")]) == {"New"})
check("a None is dropped too",
      rt.touched_strings([("9", "operator", None, "New")]) == {"New"})
check("  and a whitespace-only value is dropped",
      rt.touched_strings([("9", "operator", "   ", "New")]) == {"New"})
unfiltered = {"", "Dews Coaches"}
check("WITH an empty string allowed, every label on earth is explained",
      rt.unexplained_labels({"lost": ["anything at all"], "gained": ["and this"], "rewrapped": []},
                            unfiltered) == [])
check("  and the filtered set refuses the same labels",
      len(rt.unexplained_labels({"lost": ["anything at all"], "gained": ["and this"],
                                 "rewrapped": []}, allowed)) == 2)


# --------------------------------------------------- 9 & 10. what the sidecar may say
print("\n9. the grading sidecar, and 10. the stale grading it must not lend")

def sidecar(tmp, name, payload):
    g = os.path.join(tmp, "_gtfs")
    os.makedirs(g, exist_ok=True)
    with open(os.path.join(g, name), "w", encoding="utf-8") as fh:
        json.dump(payload, fh)

def payload(date, towns=None, not_checked=()):
    return {"schema": 1, "date": date,
            "towns": towns if towns is not None else {"Ramsey": {"grade": "SAFE", "actionable": 2,
                                                                 "reasons": ["DAYS", "OPERATOR"]}},
            "notChecked": list(not_checked)}

tmp = tempfile.mkdtemp(prefix="oa426-")
try:
    check("no _gtfs at all is 'none', not a crash",
          rt.sidecar_says(tmp, "Ramsey", None)[0] == "none")

    sidecar(tmp, "refresh-grades_2026-10-01.json", payload("2026-10-01"))
    status, said = rt.sidecar_says(tmp, "Ramsey", "2026-10-01")
    check("the grading for this scan is read", (status, said["grade"]) == ("ok", "SAFE"), repr(said))
    check("  matched case-insensitively, as every other join on this board is",
          rt.sidecar_says(tmp, "RAMSEY", "2026-10-01")[0] == "ok")
    check("a town the sidecar does not mention is 'absent'",
          rt.sidecar_says(tmp, "March", "2026-10-01")[0] == "absent")

    # 10. THE ARM THAT EARNS THE CASE. An OLDER grading must not be lent to a NEWER scan:
    # that is a machine saying "no person needed" about changes it has not seen.
    status, why = rt.sidecar_says(tmp, "Ramsey", "2026-11-01")
    check("an older grading is NOT offered for a newer scan", status == "none", repr(status))
    check("  and it says which two dates disagree",
          "2026-10-01" in why and "2026-11-01" in why, why)
    check("  where taking the older answer WOULD have said SAFE",
          rt.sidecar_says(tmp, "Ramsey", None)[1]["grade"] == "SAFE",
          "so the refusal is a decision, not an absence")

    sidecar(tmp, "refresh-grades_2026-10-02.json", payload("2026-10-02", towns={},
            not_checked=[{"town": "Ramsey", "reason": "dataset not built"}]))
    check("the newest file wins, not the first one read",
          rt.sidecar_says(tmp, "Ramsey", "2026-10-02")[0] == "not-checked")

    sidecar(tmp, "refresh-grades_2026-10-03.json", {"schema": 99, "date": "2026-10-03", "towns": {}})
    check("a schema this reader does not understand is 'none', not a guess",
          rt.sidecar_says(tmp, "Ramsey", "2026-10-03")[0] == "none")
    check("  and the schema constant matches the one refresh_grades.mjs declares",
          rt.GRADES_SCHEMA == 1, "bump both or neither")
finally:
    shutil.rmtree(tmp, ignore_errors=True)


print()
if FAILURES:
    print("%d FAILURE(S): %s" % (len(FAILURES), ", ".join(FAILURES)))
    sys.exit(1)
print("All cases behaved: SAFE is classify()'s answer and not a copy, only the machine's own")
print("values are corrected, the town's route order survives, a label must name something the")
print("patch touched, and a grading is never lent to a scan it is not about.")
