#!/usr/bin/env python3
"""refresh_town.py — one town's SAFE monthly refresh, as ONE unit of work (buses-data OA-426).

R9 of the 2026-09-17 process review asks for a monthly refresh nobody starts by hand.
`gtfs_refresh_report.py` grades each town SAFE, ESCALATE or NOTHING and, since OA-426's
first half, writes that grade into `_gtfs/refresh-grades_<date>.json` so a machine can
read it. `refresh_grades.mjs` puts it on the worklist's refresh row. What was missing is
the half this file is: something that takes a SAFE town through S1 to S5 in one command,
so that "work this row" is a thing a scheduled tick can finish rather than a skill a
person has to drive.

    Run it from anywhere. Every path below is real; there are no placeholders except
    the ones written as <angle brackets>, and each of those is explained:

      python refresh_town.py --town "<Town>"
      python refresh_town.py --town "<Town>" --apply --by <who>

    --town   the town's name as `Areas/<Town>` and `_gtfs/town_prefixes.json` spell it
    --apply  actually write: without it this is a DRY RUN that touches nothing
    --by     who is performing the stages -- `sched-HHMM` for a loop tick, the
             session's own name otherwise (OA-427). Left off, nobody is recorded,
             which is honest and is what every run before 2026-09-22 did
    --root   the Buses directory, if not this laptop's (see cli.resolve_buses)
    --db     a single-region sqlite, for testing against a fixture feed
    --scan   the scan date this refresh is FOR, e.g. 2026-10-01; the grades sidecar
             must be that same run or the refresh refuses (see THE SIDECAR below)
    --note   the note recorded on every stage this run commits
    --json   print one JSON object on stdout instead of prose, for a caller

WHY THIS IS NOT `rollout.js`. That tool refuses a data change on purpose -- `staleInputs()`
stops it with STALE-INPUTS -- because it seeds geometry from the previous S4, so it would
lay new configuration over old geometry. Its own refusal names the remedy: go through the
documented stage order, pull S2 then pull S3. That is what this file does. `--force` on
rollout.js means "I have reviewed the lost labels", never "use stale geometry", and using
it here would be exactly the misreading that refusal exists to prevent.

WHY THIS IS NOT `auto_refresh_month.py` COMING BACK. That script was the WHOLE MONTH's
applier with its own report, its own grading and its own trigger: the scheduled task ran
it and it swept every changed town. Peter retired it on 2026-09-18 and chose R9's shape
instead -- the loop works a refresh ROW, one town per tick, under the loop's lock, run
record, commit and push discipline. So the actor here is the tick and this file is its
instrument: one town, named on the command line, and no discovery of its own. The grading
it retired is the grading this reads, in the module it was moved into.

WHAT "SAFE" BUYS AND WHAT IT DOES NOT. SAFE means every actionable change the scan found
is an operator NAME or a set of DAYS -- fields that decide no colour and move no line. So
this patches exactly those two fields and nothing else, S2 is untouched because no route
set changed, and the rebuild is the same generators over the same geometry. SAFE is not
permission: it does not say the rebuild will succeed, that the sheets will gate, or that
the map may be delivered. Those are the build's own gates and this file does not relax
one of them.

THE GRADE IS DERIVED HERE, NOT READ. `classify()` is asked again, from `diff_town()`, at
the moment of applying -- because what this writes is a patch of the feed as it is now,
not as it was on scan day. The sidecar is then cross-checked rather than trusted: if the
board showed SAFE and the feed now says otherwise, the row's reason is stale and this
refuses, naming the remedy. That is the same rule `refresh_grades.mjs` states for dates,
one step further down.

THE LABEL CHECK, WHICH IS THE PART WORTH HAVING. A SAFE refresh changes an operator name
or a day string, and both are printed on the sheets -- so it will ROUTINELY lose and gain
labels. `rollout.js`'s guard, which blocks on any lost label, would therefore fire on
every refresh, and the only way past it is `--force`, which turns the guard off for the
one class of build that always trips it. A guard nobody can satisfy is one everybody
learns to bypass. So this computes what the patch is ENTITLED to change -- the old and
new operator strings, the old and new day strings -- and requires every lost and gained
label to mention one of them. Anything else stops the run before S4 is committed. That is
a gate that stays green on an ordinary refresh and can still go red on the day something
else moved, which is the property `rollout.js`'s cannot have here.

    Its limit, said out loud: a label that merely CONTAINS a touched string is accepted,
    so a change that happens to ride along inside such a label is not distinguished. The
    check bounds the diff to text that mentions something the patch touched; it does not
    prove the sheet is right. Reading the sheet is still a person's job, and R9 gives
    them one batched review of the sheets whose ink moved (OA-429) for exactly that.

AND IT WILL TELL YOU WHEN THE ENGINE IS THE REASON. If the previous S4 was drawn by a
different engine build, a rebuild picks up every engine change too, and those labels are
not the patch's. Rather than let that read as a mysterious refusal, the report names the
two engine hashes and says to roll the engine out first.

FORMATTING: THE JSON FILES ARE RE-EMITTED, NOT TEXT-PATCHED. `verified-services.json`
carries some hand-written compact arrays which `json.dumps(indent=2)` expands, so a
refreshed file is formatted rather than byte-preserved. That is deliberate: a text
patcher that hits the right `"operator":` and misses a second one is a worse failure than
a tidy file, and the run folder is new anyway so there is no diff to keep quiet. What
matters instead is asserted in the harness: everything except the patched values is the
SAME PARSED OBJECT afterwards, which is a stronger claim than matching whitespace.

Zero third-party dependencies -- stdlib plus the sibling modules already in assets/.
"""
import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import cli                          # noqa: E402  --root, then BUSES_DIR, then the laptop
import gtfs_query as gq             # noqa: E402
import gtfs_regions as greg         # noqa: E402
import gtfs_refresh_report as rr    # noqa: E402  diff_town / classify / fold_gtfs / fmt

SK = HERE

# The sidecar schema `refresh_grades.mjs` reads. Named here so a bump is a refusal on
# both sides at once rather than a reader silently taking an older shape.
GRADES_SCHEMA = 1


class Refused(Exception):
    """A refusal with a remedy. The message is what the caller prints and what a tick
    puts in its run record, so it names what to do and never only what went wrong."""


# --------------------------------------------------------------------------- helpers

def by_args(who):
    """`--by` forwarded the way `cli.byArgs` forwards it, and for the same reason.

    IT VALIDATES NOTHING. `stage.js` owns the rules -- empty, multi-line, over-length --
    and says so in messages naming OA-427; a second copy of those rules here would be
    the drift that function exists to stop. The one thing this must never do is invent a
    name: absent is the honest answer when nobody said, and a guess would be
    indistinguishable from a statement the moment it reached the manifest.
    """
    return ["--by", str(who)] if who else []


def stage(town_dir, *args):
    """Run stage.js with the town as its cwd -- the stage engine's cwd-as-subject
    convention. Raises Refused with stage.js's own message, which already names what it
    wanted."""
    res = subprocess.run(["node", os.path.join(SK, "stage.js"), *args],
                         cwd=town_dir, capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise Refused("stage.js %s failed:\n%s" % (" ".join(args), (res.stderr or res.stdout).strip()))
    return res.stdout.strip()


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, obj):
    """indent=2, ensure_ascii=False, trailing newline -- the shape `routes.json` already
    round-trips to exactly, and the shape check-file-hygiene.mjs wants."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def engine_hash_of(routes):
    """The engine build recorded on an S4's routes.json, or None. `stamp` is written by
    `engine_version.js`; a map built before the field existed has none, which is a
    different question from disagreeing and is reported as such."""
    e = routes.get("engine")
    if isinstance(e, dict):
        return e.get("hash") or e.get("version") or None
    return e or None


def current_engine_hash():
    res = subprocess.run(["node", os.path.join(SK, "engine_version.js")],
                         capture_output=True, text=True, encoding="utf-8")
    return res.stdout.strip() or None if res.returncode == 0 else None


def label_diff(old_svg, new_svg):
    """gate_lib's labelDiff, through its command, because the label set is not a thing to
    re-derive in a second language -- see label_diff.js."""
    res = subprocess.run(["node", os.path.join(SK, "label_diff.js"), old_svg, new_svg],
                         capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise Refused("label_diff.js failed: %s" % (res.stderr or res.stdout).strip())
    return json.loads(res.stdout)


# ------------------------------------------------------------------ the town's feed

def locate_town(root, town, db_override=None):
    """The (db, cfg) this town's diff is taken against, chosen by the SAME planner the
    monthly report uses, so the two cannot end up on different datasets."""
    gdir = os.path.join(root, "_gtfs")
    prefixes = read_json(os.path.join(gdir, "town_prefixes.json"))
    groups, skipped = greg.plan(gdir, prefixes, db_override)
    for g in groups:
        for name, cfg in g["towns"]:
            if name.lower() == town.lower():
                return g, name, cfg
    for name, reason in skipped:
        if name.lower() == town.lower():
            raise Refused("%s was NOT CHECKED by the scan (%s), so it has no grade and nothing "
                          "to refresh from. Build the region's sqlite or fix the town's "
                          "\"region\" key in _gtfs/town_prefixes.json." % (name, reason))
    raise Refused("%s is in no group the region planner built from _gtfs/town_prefixes.json. "
                  "Check the spelling against that file and against Areas/." % town)


def gtfs_operator_and_days(db, cfg, town):
    """Fresh GTFS pull for one town -> {route: (operator_str, days_str)}.

    The same fold and format `diff_town` uses internally, asked here because that
    function returns human-readable messages and the patch needs the VALUES. Asking the
    same two functions is what keeps the message and the patch talking about one thing.
    """
    res = gq.query(db, cfg.get("prefixes"), tuple(cfg["near"]) if cfg.get("near") else None, town)
    out = {}
    for route, g in rr.fold_gtfs(res["services"]).items():
        days = set(i for i in range(7) if g["flags"][i])
        out[route] = (" / ".join(sorted(g["operators"])), rr.fmt(days))
    return out


# ------------------------------------------------------------------------ the sidecar

def sidecar_says(root, town, scan_date):
    """What `_gtfs/refresh-grades_<date>.json` says about this town, as
    (status, record_or_reason).

    The statuses are 'none' (no sidecar at all -- every scan on this disk predates
    OA-426), 'not-checked', 'absent' (the sidecar exists and does not mention the town)
    and 'ok'. A sidecar whose date is not the scan this refresh is for is 'none' as far
    as this town goes, and the caller says so: `refresh_grades.mjs` spends a paragraph on
    why a stale grade attached to today's changes is a machine claiming no person is
    needed about a diff it has not seen, and the rule does not weaken one step further
    down the pipe.
    """
    gdir = os.path.join(root, "_gtfs")
    if not os.path.isdir(gdir):
        return "none", "there is no _gtfs folder in %s" % root
    files = sorted(f for f in os.listdir(gdir)
                   if f.startswith("refresh-grades_") and f.endswith(".json"))
    if not files:
        return "none", "no _gtfs/refresh-grades_<date>.json exists yet"
    newest = files[-1]
    date = newest[len("refresh-grades_"):-len(".json")]
    if scan_date and date != scan_date:
        return "none", ("the newest grading is %s and this refresh is for the %s scan -- "
                        "different runs, so it says nothing about these changes. Re-run "
                        "the monthly job so both are written in one pass." % (date, scan_date))
    payload = read_json(os.path.join(gdir, newest))
    if payload.get("schema") != GRADES_SCHEMA:
        return "none", ("%s carries schema %r and this reads %d"
                        % (newest, payload.get("schema"), GRADES_SCHEMA))
    for nc in payload.get("notChecked") or []:
        if str(nc.get("town", "")).lower() == town.lower():
            return "not-checked", nc.get("reason", "no reason recorded")
    for name, rec in (payload.get("towns") or {}).items():
        if name.lower() == town.lower():
            rec = dict(rec)
            rec["date"] = date
            return "ok", rec
    return "absent", "%s does not mention %s" % (newest, town)


# -------------------------------------------------------------------------- the patch

def patch_verified_services(vs, safe_routes, new_values):
    """Set operator/days on the shipped entries of the SAFE routes, and nothing else.

    PER SHIPPED ENTRY, never per route number. `diff_town` groups rather than indexes,
    for the reason OA-134 records: Wisbech ships eleven services and two of them are
    numbered 46, so a dict keyed by route silently dropped one and the Stagecoach East 46
    had never once been diffed. Every entry carrying a patched route number is updated
    here for the same reason.
    """
    touched = []
    for svc in vs.get("services", []):
        route = str(svc.get("route"))
        if route not in safe_routes or route not in new_values:
            continue
        new_op, new_days = new_values[route]
        if svc.get("operator") != new_op:
            touched.append((route, "operator", svc.get("operator"), new_op))
            svc["operator"] = new_op
        if svc.get("days") != new_days:
            touched.append((route, "days", svc.get("days"), new_days))
            svc["days"] = new_days
    return touched


def in_route_order(entries, route_order):
    """Put an operator's routes back in the order the TOWN declares, not the order this
    script happened to move them in.

    FOUND BY LOOKING AT THE SHEET, WHICH NO CHECK HERE COULD HAVE DONE. The first working
    version appended a re-filed route to the end of its new operator's list. Ramsey's
    `routes.json` files that operator as ["32","301","303","305","X31"], matching its own
    `routeOrder`, and appending made it ["301","303","305","X31","32"]. The label SET did
    not change by one character, so `labelDiff` saw nothing and the run was accepted --
    but the key draws an operator's badges in list order and prints the name after the
    last one, so the panel came out as a row of four badges with no operator beside them
    and a second row reading "32  Dews Coaches". A reader would have taken 301, 303, 305
    and X31 to be run by nobody.

    The general shape is worth more than the instance: a LABEL-SET check cannot see
    ORDER, because a set has none. It is the reason the label check is not the only thing
    standing between this and a published sheet, and the reason R9 ends in a person
    looking at the maps whose ink moved (OA-429).

    A town with no `routeOrder` keeps the appended order, which is the honest answer: no
    order is declared, so there is none to restore.
    """
    if not isinstance(route_order, list) or not route_order:
        return list(entries)
    rank = {str(r): i for i, r in enumerate(route_order)}
    tail = len(rank)
    return sorted(entries, key=lambda r: (rank.get(str(r), tail), str(r)))


def patch_routes_json(routes, safe_routes, new_values, shipped):
    """Re-file a route under its new operator, and refresh the days printed on a spoke --
    but ONLY where the value standing there is one WE wrote from the feed.

    MECHANICAL ONLY. It touches `operators[].routes` and `external[].days` and nothing
    else, so it cannot move a line, add a colour or change what is drawn -- which is the
    whole basis on which SAFE means no person is needed.

    AND IT NEVER OVERWRITES AN EDITORIAL STRING, which Ramsey proves is not a hypothetical.
    Its shipped service list says `Ramsey and District Community Bus Association` and its
    `routes.json` says `Ramsey & District Community Bus Association`; its spokes carry
    `Fri only` where the feed says `Fri`, and `Mon-Sat (305 Mon-Fri)`, which is a sentence
    about two routes that no `fmt()` will ever produce. A patch that matched the feed's
    name against `operators[].name` would have found no entry and APPENDED a second
    operator beside the first; one that assigned `fmt(days)` over a spoke would have
    flattened a hand-written string into the machine's. Both are the same mistake: the
    config layer is where a person's wording lives, and a refresh may only correct what
    the machine itself put there.

    So the test is against `shipped` -- what the feed said at the last verification,
    which is exactly what we would have written. Equal means ours, and it is updated;
    different means somebody wrote it, and it becomes a CONFLICT the caller refuses on,
    naming both strings. Refusing rather than half-applying is deliberate: a refresh that
    silently updated the service list and left the sheet saying something else would be a
    map disagreeing with its own data, which is worse than a town a person has to look at.
    """
    touched, conflicts = [], []
    ops = routes.get("operators")
    if isinstance(ops, list):
        for route in sorted(safe_routes):
            if route not in new_values or route not in shipped:
                continue
            old_op, new_op = shipped[route][0], new_values[route][0]
            if old_op == new_op:
                continue                      # this route's operator did not move
            current = next((o for o in ops if route in (o.get("routes") or [])), None)
            if current is None:
                continue                      # routes.json does not file this route at all
            if current.get("name") != old_op:
                conflicts.append((route, "operators[].name", current.get("name"), old_op, new_op))
                continue
            current["routes"] = [r for r in current["routes"] if r != route]
            target = next((o for o in ops if o.get("name") == new_op), None)
            if not target:
                target = {"name": new_op, "routes": []}
                ops.append(target)
            target["routes"] = in_route_order(target["routes"] + [route], routes.get("routeOrder"))
            touched.append((route, "operators[]", old_op, new_op))
        routes["operators"] = [o for o in ops if o.get("routes")]  # drop emptied entries
    ext = routes.get("external")
    if isinstance(ext, list):
        for e in ext:
            route = str(e.get("route"))
            if route not in safe_routes or route not in new_values or route not in shipped:
                continue
            old_days, new_days = shipped[route][1], new_values[route][1]
            if old_days == new_days:
                continue                      # this route's days did not move
            if e.get("days") != old_days:
                conflicts.append((route, "external[].days", e.get("days"), old_days, new_days))
                continue
            touched.append((route, "external[].days", e.get("days"), new_days))
            e["days"] = new_days
    return touched, conflicts


def touched_strings(touched):
    """Every old and new VALUE the patch moved, as the set of strings a label is entitled
    to mention. Empty strings and None are dropped: a label cannot be explained by the
    absence of a value, and `"" in label` is true of every label there is -- which would
    turn the whole check off without saying so."""
    out = set()
    for _route, _field, old, new in touched:
        for v in (old, new):
            if isinstance(v, str) and v.strip():
                out.add(v.strip())
    return out


def unexplained_labels(diff, allowed):
    """The lost and gained labels that mention nothing the patch touched.

    Rewrapped labels are not a change of text at all -- `labelDiff` separates them
    precisely because the same words across two lines is a layout difference -- so they
    are not asked to be explained.
    """
    bad = []
    for kind in ("lost", "gained"):
        for label in diff.get(kind, []):
            if not any(v in label for v in allowed):
                bad.append((kind, label))
    return bad


# ----------------------------------------------------------------------------- report

def describe(touched):
    return ["%s %s: %r -> %r" % (r, f, o, n) for r, f, o, n in touched]


# ------------------------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description="One town's SAFE monthly refresh, S1 to S5 (OA-426).")
    ap.add_argument("--town", required=True)
    ap.add_argument("--root", default=None, help="the Buses directory")
    ap.add_argument("--db", default=None, help="a single-region sqlite (testing)")
    ap.add_argument("--scan", default=None, help="the scan date this refresh is for, YYYY-MM-DD")
    ap.add_argument("--by", default=None, help="who is performing the stages (OA-427)")
    ap.add_argument("--note", default=None)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    root = cli.resolve_buses(a.root)
    town_dir = os.path.join(root, "Areas", a.town)
    result = {"town": a.town, "root": root, "applied": False, "status": None}

    if not os.path.isdir(town_dir):
        raise Refused("there is no Areas/%s in %s -- this refreshes a town that already has a "
                      "map, and a new one is draft_town.py's job." % (a.town, root))

    group, town, cfg = locate_town(root, a.town, a.db)
    today = datetime.date.today().isoformat()
    result["town"] = town
    result["region"] = group.get("region")

    # ---- the grade, derived now, from the feed this is about to patch from ----------
    d = rr.diff_town(group["db"], town, cfg, town_dir, today)
    if d is None:
        raise Refused("%s has no shipped verified-services.json to refresh from." % town)
    grade, rows = rr.classify(d["changes"])
    result["grade"] = grade
    result["reasons"] = sorted({r[0] for r in rows})
    result["actionable"] = len(rr.actionable_rows(d["changes"]))

    if grade == "NOTHING":
        result["status"] = "NOTHING"
        result["detail"] = ("the feed and the shipped service list agree on everything "
                            "actionable, so there is nothing to refresh.")
        return result
    if grade != "SAFE":
        raise Refused(
            "%s grades %s on %s, so a person decides what the sheet should say before it is "
            "rebuilt. This tool applies SAFE towns only -- an operator name or a set of days "
            "and nothing else. Read the town's section of the newest _gtfs/refresh-report_*.md "
            "and work it as a refresh by hand."
            % (town, grade, ", ".join(sorted({r[0] for r in rows}))))

    # ---- and cross-checked against what the board was showing ----------------------
    status, said = sidecar_says(root, town, a.scan)
    result["sidecar"] = status
    if status == "ok":
        result["sidecarGrade"] = said.get("grade")
        result["sidecarDate"] = said.get("date")
        if said.get("grade") != "SAFE":
            raise Refused(
                "the %s grading says %s is %s and the feed now grades it SAFE. The board's "
                "reason for this row and the change this would apply are not the same thing, "
                "so nothing is written. Re-run the monthly report so the two are one pass:\n"
                "    python gtfs_refresh_report.py"
                % (said.get("date"), town, said.get("grade")))
    elif status == "not-checked":
        raise Refused("the scan could not check %s (%s), so no grading stands behind this row." % (town, said))
    else:
        result["sidecarWhy"] = said  # 'none' or 'absent': reported, and not a refusal

    # ---- what the patch would be ----------------------------------------------------
    safe_routes = {str(r[1]) for r in rows}
    new_values = gtfs_operator_and_days(group["db"], cfg, town)
    result["routes"] = sorted(safe_routes)

    vf = rr.latest_verified(town_dir)
    vs = read_json(vf)
    # WHAT THE FEED SAID LAST TIME, captured BEFORE the patch, because it is the test for
    # whether a value in the config layer is ours to correct -- see patch_routes_json.
    shipped = {str(s.get("route")): (s.get("operator"), s.get("days"))
               for s in vs.get("services", []) if s.get("servesTown", True)}
    vs_touched = patch_verified_services(vs, safe_routes, new_values)

    prev_s3 = stage(town_dir, "latest", "S3")
    routes = read_json(os.path.join(prev_s3, "routes.json"))
    rj_touched, conflicts = patch_routes_json(routes, safe_routes, new_values, shipped)

    result["verifiedServices"] = describe(vs_touched)
    result["routesJson"] = describe(rj_touched)
    result["conflicts"] = ["%s %s: the sheet says %r, the feed last said %r and now says %r"
                           % (r, f, sheet, was, now_) for r, f, sheet, was, now_ in conflicts]

    if conflicts:
        raise Refused(
            "%d value(s) this refresh would have to change were written by a person, not by the "
            "feed, so a machine must not overwrite them. Nothing has been written. Work %s as a "
            "refresh by hand and decide what each should say:\n  %s"
            % (len(conflicts), town, "\n  ".join(result["conflicts"])))

    if not vs_touched and not rj_touched:
        result["status"] = "NOTHING-TO-PATCH"
        result["detail"] = ("the scan reported %d change(s) and the shipped files already carry "
                            "the feed's values -- nothing to write." % len(rows))
        return result

    # ---- what the sheets are entitled to change -------------------------------------
    allowed = touched_strings(vs_touched + rj_touched)
    result["allowedLabelStrings"] = sorted(allowed)

    prev_s4 = stage(town_dir, "latest", "S4")
    prev_routes = read_json(os.path.join(prev_s4, "routes.json"))
    was, now = engine_hash_of(prev_routes), current_engine_hash()
    result["engine"] = {"drewTheLastS4": was, "current": now, "moved": bool(was and now and was != now)}

    if not a.apply:
        result["status"] = "WOULD-APPLY"
        result["s4"] = prev_s4
        return result

    # ---- S4 FIRST: draw the sheets, and commit NOTHING until they have been read ----
    #
    # THE ORDER IS THE WHOLE POINT, AND IT WAS MEASURED THE OTHER WAY ROUND. The obvious
    # sequence -- commit S1, commit S3, then build S4 from them -- was written first, and
    # the label check then refused a Ramsey build that had already committed a patched
    # service list and a patched config. That leaves a map whose data says one thing and
    # whose sheets say another: the exact state `patch_routes_json` above refuses to
    # create, arrived at by a different road. A refusal must leave the town as it found
    # it, so the build happens first and the three commits are the last thing that
    # happens before S5.
    #
    # The run folder carries the patched routes.json directly rather than pulling it,
    # because `pull S3` reads the COMMITTED latest S3 and the point is not to have
    # committed one yet. That is not a liberty: `rollout.js` writes a stamped routes.json
    # into its run folder too, and the S4 folder is the build's own working copy.
    note = a.note or ("SAFE monthly refresh (%s)" % (a.scan or today))
    s2_latest = os.path.basename(stage(town_dir, "latest", "S2"))
    s4 = stage(town_dir, "new", "S4", "--bump", "minor", *by_args(a.by))
    stage(town_dir, "pull", "S2", s4)
    stage(town_dir, "pull", "S3", s4)          # overrides.json and the rest of the layer
    write_json(os.path.join(s4, "routes.json"), routes)
    result["s4"] = s4
    # `pull` keeps the printed map version in step with the run dir it landed in, and
    # overwriting routes.json afterwards undoes that, so ask for it again by name --
    # `commit S4` refuses a version that does not match its own folder.
    stage(town_dir, "stampver", s4)
    # THE TWO S4 PROVENANCE STAMPS, BEFORE the generators run and not after. `commit S4`
    # refuses a routes.json carrying no `engine` hash or no `design.sheetVersion`, and it
    # is right to: the first says which build drew the map and the second is the footer a
    # reader quotes when a sheet looks wrong. Stamping afterwards would mean re-running
    # every generator to get the new footer into the artwork, which is what `stage.js
    # stamps` tells you in as many words. This is the engine's own primitive rather than
    # a third copy of the two stamp calls -- the fault `sheet_stamps.js` was made for.
    stage(town_dir, "stamps", s4)
    built = subprocess.run(["node", os.path.join(SK, "build_s4.js"), "--dir", s4],
                           capture_output=True, text=True, encoding="utf-8")
    sheet_outputs = []
    for line in (built.stdout or "").splitlines():
        if line.strip().startswith("--outputs "):
            sheet_outputs = [x for x in line.strip()[len("--outputs "):].split(",") if x]
    result["sheets"] = sheet_outputs
    if built.returncode == 3:
        raise Refused(
            "the build produced blocking warnings -- the engine refused to draw something, or "
            "drew a label that names nothing. S4 %s is built and NOT committed, so nothing has "
            "moved. Read %s and fix the config it names.\n%s"
            % (os.path.basename(s4), os.path.join(s4, "build-warnings.txt"),
               (built.stderr or "").strip()))
    if built.returncode != 0:
        raise Refused("build_s4.js failed in %s:\n%s" % (s4, (built.stderr or built.stdout).strip()))

    # ---- the label check, BEFORE the S4 is committed --------------------------------
    diffs, unexplained = {}, []
    for svg in [s for s in sheet_outputs if s.endswith(".svg")]:
        old, new = os.path.join(prev_s4, svg), os.path.join(s4, svg)
        d2 = label_diff(old, new)
        if d2["missing"]:
            raise Refused("cannot compare labels for %s: %s is missing, so an empty diff would "
                          "read as a sheet that did not change." % (svg, ", ".join(d2["missing"])))
        diffs[svg] = {"lost": d2["lost"], "gained": d2["gained"],
                      "rewrapped": [x["label"] for x in d2["rewrapped"]]}
        unexplained += [(svg, kind, label) for kind, label in unexplained_labels(d2, allowed)]
    result["labels"] = diffs
    if unexplained:
        lines = ["%s: %s %r" % (s, k, l) for s, k, l in unexplained]
        engine_note = ""
        if result["engine"]["moved"]:
            engine_note = ("\n  The engine has ALSO moved since that S4 was drawn (%s -> %s), so "
                           "these may be its doing rather than the feed's. Roll the engine out "
                           "first:\n      node rollout.js --town \"%s\" --apply"
                           % (was, now, town))
        raise Refused(
            "%d label(s) changed that this patch does not account for. S4 %s is built and NOT "
            "committed, so nothing has moved. A SAFE refresh may only change text that mentions "
            "an operator name or a day string it is replacing:\n  %s%s"
            % (len(unexplained), os.path.basename(s4), "\n  ".join(lines), engine_note))

    # ---- the sheets are read and sound, so now the three commits, upstream first ----
    s1 = stage(town_dir, "new", "S1", *by_args(a.by))
    write_json(os.path.join(s1, "verified-services.json"), vs)
    outputs = ["verified-services.json"]
    # The disagreements audit is carried forward unchanged: this is a data-only sync of
    # two fields, not a re-verification pass, so there is nothing new to audit against
    # and dropping the file would read as an audit that found nothing.
    for name in ("disagreements.docx", "disagreements.json", "disagreements.pdf"):
        src = os.path.join(os.path.dirname(vf), name)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(s1, name))
            outputs.append(name)
    stage(town_dir, "commit", "S1", s1, "--outputs", ",".join(outputs),
          "--note", "%s -- %s" % (note, "; ".join(describe(vs_touched)) or "no service change"),
          *by_args(a.by))
    result["s1"] = s1

    s3 = stage(town_dir, "new", "S3", *by_args(a.by))
    write_json(os.path.join(s3, "routes.json"), routes)
    outputs = ["routes.json"]
    ov = os.path.join(prev_s3, "overrides.json")
    if os.path.exists(ov):
        shutil.copy(ov, os.path.join(s3, "overrides.json"))
        outputs.append("overrides.json")
    stage(town_dir, "commit", "S3", s3, "--outputs", ",".join(outputs),
          "--note", "%s -- %s" % (note, "; ".join(describe(rj_touched)) or "no routes.json change needed"),
          *by_args(a.by))
    result["s3"] = s3

    # `--based-on` rides the COMMIT, because commit is what writes the run record, and it
    # names the S2 and the S3 this build actually used. Without it `staleInputs()` cannot
    # tell a later engine rollout that the data has moved under it, which is the OA-225
    # fault: new configuration laid over old geometry, with a GAIN-only label diff that
    # nothing blocks on.
    stage(town_dir, "commit", "S4", s4, "--outputs", ",".join(sheet_outputs), "--note", note,
          "--based-on", "S2=%s;S3=%s" % (s2_latest, os.path.basename(s3)), *by_args(a.by))

    # ---- S5: render, collect, and keep the tracked golden master in step ------------
    s5 = stage(town_dir, "new", "S5", *by_args(a.by))
    stage(town_dir, "pull", "S4", s5)
    # EVERY SHEET OR NONE, which is not what the rollouts do. Both of them push a JPG only
    # when render.js exits 0 and say nothing when it does not, so a sheet that failed to
    # render is simply absent from the S5 commit -- and an absent sheet is indistinguishable
    # from a map that never had one, which is precisely the `boarding.jpg` fault
    # `sheet_registry.js` was written for: rendered, committed, verified and never in
    # `_latest`, with nothing red. The S4 declares what this map draws, so anything it drew
    # and this cannot render is a refusal that names the sheet.
    jpgs, failed = [], []
    for svg in [s for s in sheet_outputs if s.endswith(".svg")]:
        jpg = svg[:-len(".svg")] + ".jpg"
        res = subprocess.run(["node", os.path.join(SK, "render.js"),
                              os.path.join(s5, svg), os.path.join(s5, jpg)],
                             capture_output=True, text=True, encoding="utf-8")
        if res.returncode == 0:
            jpgs.append(jpg)
        else:
            failed.append("%s: %s" % (svg, ((res.stderr or res.stdout).strip().splitlines() or [""])[-1]))
    if failed:
        raise Refused(
            "%d of %d sheet(s) did not render, so S5 %s is open and uncommitted rather than "
            "committed one sheet short. S4 is committed and inert until an S5 pulls it.\n  %s"
            % (len(failed), len(failed) + len(jpgs), os.path.basename(s5), "\n  ".join(failed)))
    stage(town_dir, "commit", "S5", s5, "--outputs", ",".join(jpgs), "--note", note, *by_args(a.by))
    result["s5"] = s5
    result["rendered"] = jpgs

    subprocess.run(["node", os.path.join(SK, "refresh_latest.js"), town_dir],
                   capture_output=True, text=True, encoding="utf-8")
    # ci-reference is the tracked golden master and only sync_ci_reference.js writes it;
    # a refresh that moved ink and left it alone reddens the byte gate on the next run.
    subprocess.run(["node", os.path.join(SK, "sync_ci_reference.js"), "--buses", root, "--town", town],
                   capture_output=True, text=True, encoding="utf-8")

    result["applied"] = True
    result["status"] = "APPLIED"
    return result


def report(result):
    out = []
    out.append("refresh_town: %s (%s)" % (result["town"], result.get("region") or "region unknown"))
    out.append("  grade: %s%s" % (result.get("grade"),
               ("  [%s]" % ", ".join(result["reasons"])) if result.get("reasons") else ""))
    if result.get("sidecar"):
        out.append("  sidecar: %s%s" % (result["sidecar"],
                   ("  " + result["sidecarWhy"]) if result.get("sidecarWhy") else ""))
    for key, label in (("verifiedServices", "verified-services.json"), ("routesJson", "routes.json")):
        for line in result.get(key) or []:
            out.append("  %s  %s" % (label, line))
    eng = result.get("engine") or {}
    if eng.get("moved"):
        out.append("  NOTE the engine has moved since the last S4 (%s -> %s); a rebuild picks that "
                   "up too." % (eng.get("drewTheLastS4"), eng.get("current")))
    for sheet, d in (result.get("labels") or {}).items():
        out.append("  %s  -%d +%d labels%s" % (sheet, len(d["lost"]), len(d["gained"]),
                   (", %d rewrapped" % len(d["rewrapped"])) if d["rewrapped"] else ""))
    out.append("  status: %s%s" % (result.get("status"),
               ("  -- " + result["detail"]) if result.get("detail") else ""))
    if result.get("status") == "WOULD-APPLY":
        out.append("  DRY RUN -- nothing written. Re-run with --apply to commit S1, S3, S4 and S5.")
    if result.get("applied"):
        out.append("  committed: S1 %s, S3 %s, S4 %s, S5 %s"
                   % tuple(os.path.basename(result[k]) for k in ("s1", "s3", "s4", "s5")))
    return "\n".join(out)


if __name__ == "__main__":
    try:
        r = main()
    except Refused as e:
        sys.stderr.write("refresh_town: %s\n" % e)
        raise SystemExit(2)
    if "--json" in sys.argv:
        print(json.dumps(r, indent=2, ensure_ascii=False))
    else:
        print(report(r))
