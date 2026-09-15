#!/usr/bin/env python3
"""prove-red-python.py -- break the engine's Python half on purpose, and check the tests notice.

Run it from the skill root (`make-bus-leaflet`), with no arguments and no placeholders:

    npm run test:prove-red-python

WHY THIS FILE EXISTS. "A green check that has never been seen to go red proves
nothing" is this project's own rule, and a brand-new suite is exactly the thing
that looks like proof and is not. `test/python/` was written on 2026-09-11 and was
green from its first run; this is what earns it. It is the Python sibling of
`tools/prove-red.js` and follows it exactly: copy `assets/` to a scratch copy,
apply ONE deliberate edit per case, run ONE test file against the mutated copy via
ENGINE_DIR, and require that run to FAIL. A mutation the suite does not notice is
reported as SURVIVED and the harness exits 1.

Nothing under `assets/` is touched. Every file there is vendored into the portal
and compared by `status.js`, so an edit in place would surface as portal drift.

THE CONTROL IS NOT DECORATION. Case 0 runs the whole suite against an UNMUTATED
copy and requires it green. Without it, a harness whose scratch copy was empty, or
whose ENGINE_DIR never reached the tests, would report every mutation as caught --
each run failing for the same reason that has nothing to do with the mutation. The
same control found a real bug in `check-tables.mjs` on the day it was written, and
none of that checker's broken fixtures could have.

EVERY ANCHOR MUST MATCH EXACTLY ONCE. An anchor that matches twice, or not at all,
is a mutation that did not do what it says -- and that reports a false green just
as loudly as the bug it is hunting. The count is asserted before the edit is made.

    python3 tools/prove-red-python.py --keep     leave the scratch copy for inspection
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SK = os.path.dirname(HERE)
ASSETS = os.path.join(SK, "assets")
TESTS = os.path.join(SK, "test", "python")
KEEP = "--keep" in sys.argv

# Each mutation names the file it breaks, what the break MEANS to a reader of a
# sheet, the exact text it replaces, what it replaces it with, and the test file
# that is supposed to object.
MUTATIONS = [
    # ---------------------------------------------------------------- naptan_stands.py
    # The fault this module's own docstring is written about: at St Ives the
    # canonical chain for routes A and B is the inbound one, so preferring it
    # reported four stops, missed the outbound Cambridge stop entirely, and still
    # printed VERDICT: OK. No byte gate can see it -- the sheet is reproducible,
    # it is just wrong.
    {"suite": "test_naptan_stands.py", "file": "naptan_stands.py",
     "what": "routes_by_stop prefers `canonical`, so a boarding sheet loses every outbound stop",
     "find": '        dirs = v.get("directions")',
     "to": '        dirs = v.get("canonical") or v.get("directions")'},

    {"suite": "test_naptan_stands.py", "file": "naptan_stands.py",
     "what": "compass_word searches instead of full-matching, so 'Northbound side of the green' becomes a flag",
     "find": '    m = COMPASS_INDICATOR.fullmatch((indicator or "").strip())',
     "to": '    m = COMPASS_INDICATOR.search((indicator or "").strip())'},

    {"suite": "test_naptan_stands.py", "file": "naptan_stands.py",
     "what": "tidy_name appends the compass word everywhere, so every unique flag gains a qualifier the reader must check for nothing",
     "find": "    if not disambiguate:\n        return nm",
     "to": "    if False:\n        return nm"},

    {"suite": "test_naptan_stands.py", "file": "naptan_stands.py",
     "what": "haversine_m drops the cos(lat) term, so east-west walking times are overstated by 39% at this latitude",
     "find": "    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2",
     "to": "    a = math.sin(dp / 2) ** 2 + math.sin(dl / 2) ** 2"},

    {"suite": "test_naptan_stands.py", "file": "naptan_stands.py",
     "what": "find_naptan looks only in the folder it was given, so a place build one level down finds no stop database",
     "find": '        cand = os.path.join(d, "_gtfs", "naptan.sqlite")\n        if os.path.exists(cand):\n            return cand\n        parent = os.path.dirname(d)\n        if parent == d:\n            return None',
     "to": '        cand = os.path.join(d, "_gtfs", "naptan.sqlite")\n        if os.path.exists(cand):\n            return cand\n        parent = os.path.dirname(d)\n        if True:\n            return None'},

    # ---------------------------------------------------------------- boarding_index.py
    # "Never guess a region -- fail listing what is built" is resolve_db's own
    # docstring. A guess here is not a wrong pixel: it is a boarding sheet built
    # from another county's timetable, perfectly reproducible and perfectly wrong.
    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "resolve_db matches any registered town, so a place in an unregistered town silently borrows another county's feed",
     "find": "            if name.lower() in town.lower() or town.lower() in name.lower():",
     "to": "            if True:"},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "resolve_db offers a region that was never built, so the build dies on a database that is not there",
     "find": '    built = {k: v for k, v in regions.items() if v.get("status") == "built"}',
     "to": "    built = {k: v for k, v in regions.items()}"},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "resolve_db second-guesses an explicit --db, so the escape hatch stops being one",
     "find": "    if explicit:\n        return explicit",
     "to": "    if False:\n        return explicit"},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "_feed_version invents a version when the sidecar is missing, so a report records a fact nobody has",
     "find": "    except Exception:\n        return None",
     "to": '    except Exception:\n        return "unknown"'},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "find_up stops at the folder it was given, so nothing under Areas/ can reach the estate's _gtfs",
     "find": "        parent = os.path.dirname(d)\n        if parent == d:\n            return None\n        d = parent",
     "to": "        parent = os.path.dirname(d)\n        if True:\n            return None\n        d = parent"},

    # ------------------------------------------- boarding_index.py, the locality rollup
    # Every one of these was a real sheet saying something wrong, and until
    # 2026-09-12 not one of them could be broken on purpose: the rollup is a set
    # of closures inside `main()` over two sqlite connections, so the only way to
    # reach it was a full place build against the 127,658-stop register. The
    # fixture that makes these gradeable is `test/python/_stubs.py`.
    # THE FIRST WORDING OF THIS ONE SURVIVED, AND THAT IS WHY IT IS WRITTEN LIKE
    # THIS. It said "climbs one hop only" and broke the loop's SECOND iteration,
    # which the recorded case does not need: `locality()` starts the climb at the
    # stop's own ParentLocalityName, so Orchard Park -> Kings Hedges -> Cambridge
    # is already at the top after one ascent. The fault the file's own comment
    # describes is the climb not happening at all -- "a single hop up therefore
    # lands on a Cambridge housing estate" -- which is this edit.
    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "the rollup takes the stop's own parent and never ascends, so Orchard Park prints as Kings Hedges -- a Cambridge housing estate offered as a destination",
     "find": "    def climb(area, name):\n        seen_names = set()",
     "to": "    def climb(area, name):\n        return name\n        seen_names = set()"},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "a locality name with two different parents is no longer left alone, so Church End takes whichever village the register mentioned last",
     "find": "    for key in ambiguous:\n        parent_of.pop(key, None)",
     "to": "    for key in ambiguous:\n        pass"},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "the parent fallback stops being scoped to the stop's own area, so a Cambridgeshire village inherits an Oxfordshire namesake's parent -- the St Neots sheet that offered London and Oxford",
     "find": '            "SELECT DISTINCT AdministrativeAreaCode, LocalityName, ParentLocalityName FROM naptan "',
     "to": '            "SELECT DISTINCT \'071\' AS AdministrativeAreaCode, LocalityName, ParentLocalityName FROM naptan "'},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "a half of a joint parish loses its own name, so the 301 advertises Holywell-cum-Needingworth and a reader cannot find the village they are going to",
     "find": "            if parent and child and joint_parish(child, parent):",
     "to": "            if False:"},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "a stop earns a destination from the whole trip rather than from what comes AFTER it, so an arrival bay is printed as the place to board for where the bus came from",
     "find": "            onward = seq[i + 1:]",
     "to": "            onward = seq[:i] + seq[i + 1:]"},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "the home locality is indexed as a destination, so the sheet offers a bus to the town the reader is standing in",
     "find": "                if not l or l == home:",
     "to": "                if not l:"},

    {"suite": "test_boarding_index.py", "file": "boarding_index.py",
     "what": "boardingPlan.excludeRoutes is ignored, so a summer seaside coach whose calendar has ended is still printed on an autumn sheet",
     "find": "        if rname in exclude:",
     "to": "        if False:"},

    # ------------------------------------- naptan_stands.py, the frame uniqueness rule
    # The decision that stops a sheet being generated at all. Same shape as the
    # rollup above: inside `main()`, reachable only with a stubbed register.
    {"suite": "test_naptan_stands.py", "file": "naptan_stands.py",
     "what": "the compass rescue no longer requires EVERY flag in the cluster to carry a word, so a reader sent to the one that says 'opp' gets a name matching all three",
     "find": "        if all(words) and len(set(words)) == len(words):",
     "to": "        if any(words) and len(set(words)) == len(words):"},

    {"suite": "test_naptan_stands.py", "file": "naptan_stands.py",
     "what": "a name is printed whether or not it is unique in the frame, so the sheet never refuses and sends readers to one of two identical flags",
     "find": "        elif common and name_counts.get(common.lower(), 0) == 1:",
     "to": "        elif common:"},

    # ---------------------------------------------------------------- cli.py
    # OA-224 Tier 3.1. The order is the flag, then the environment variable, then
    # the laptop -- and the laptop beating the variable is precisely the state the
    # resolver was written to end.
    {"suite": "test_cli.py", "file": "cli.py",
     "what": "resolve_buses forgets BUSES_DIR, so every machine that is not this laptop is back where Tier 3.1 started",
     "find": '    env = os.environ if env is None else env\n    return os.path.abspath(value or env.get("BUSES_DIR") or LAPTOP_BUSES)',
     "to": "    env = os.environ if env is None else env\n    return os.path.abspath(value or LAPTOP_BUSES)"},

    {"suite": "test_cli.py", "file": "cli.py",
     "what": "resolve_portal reads the estate's variable, so BUSMAPS_PORTAL does nothing and BUSES_DIR points at the wrong checkout",
     "find": '    return os.path.abspath(value or env.get("BUSMAPS_PORTAL") or LAPTOP_PORTAL)',
     "to": '    return os.path.abspath(value or env.get("BUSES_DIR") or LAPTOP_PORTAL)'},

    {"suite": "test_cli.py", "file": "cli.py",
     "what": "resolve_buses ignores os.environ when no env is passed, so the middle step is skipped by every real caller",
     "find": '    env = os.environ if env is None else env\n    return os.path.abspath(value or env.get("BUSES_DIR") or LAPTOP_BUSES)',
     "to": '    env = {} if env is None else env\n    return os.path.abspath(value or env.get("BUSES_DIR") or LAPTOP_BUSES)'},

    # ---------------------------------------------------------------- prune_runs.py
    # The only module in this half whose faults are IRREVERSIBLE. Its verdicts
    # delete git-ignored run folders, so there is no output for a byte gate to
    # compare and no build that exercises it -- it runs from a person's hand.
    # The first case is the 2026-08-27 fault re-enacted: that rule named nine S6
    # folders and seven held a bought redteam.json.
    {"suite": "test_prune_runs.py", "file": "prune_runs.py",
     "what": "S6 comes out of NEVER_PRUNE, so the newest-versions rule reaches the one file that cannot be rebuilt at any price",
     "find": 'NEVER_PRUNE   = ("S3-config", "S6-verify")',
     "to": 'NEVER_PRUNE   = ("S3-config",)'},

    {"suite": "test_prune_runs.py", "file": "prune_runs.py",
     "what": "version_key compares version numbers as text, so v1.10 sorts below v1.9 and the CURRENT sheet is the one deleted",
     "find": "    return (int(a), int(b))",
     "to": "    return (a, b)"},

    {"suite": "test_prune_runs.py", "file": "prune_runs.py",
     "what": "the output rule keeps one version more than it was asked for, so --keep-outputs means nothing and the prune frees less than it reports",
     "find": "            if len(kept_versions) < keep_outputs:",
     "to": "            if len(kept_versions) <= keep_outputs:"},

    {"suite": "test_prune_runs.py", "file": "prune_runs.py",
     "what": "the input rule keeps one run whatever --keep-inputs says, so a town loses the S1 history its refresh diff is read against",
     "find": "if i < keep_inputs",
     "to": "if i < 1"},

    # A pin is the only way something OUTSIDE the Buses folder can say "not that
    # one". The 2026-09-02 measurement is what makes a warning insufficient:
    # the stale pin was the visible half, and two unprotected portal fixtures
    # were the half nobody could see.
    {"suite": "test_prune_runs.py", "file": "prune_runs.py",
     "what": "a pin naming a run that is gone warns and carries on, so a pin file can rot until it protects nothing and still reads as protection",
     "find": "        sys.exit(1)",
     "to": "        pass   # carry on, the operator has been told"},

    # The accounting, whose whole reason for existing is that the sentence it
    # prints used to be a hard-coded claim and was briefly false.
    {"suite": "test_prune_runs.py", "file": "prune_runs.py",
     "what": "git failing to answer is recorded as 'nothing is tracked', so the summary states as a measurement what it could not check",
     "find": "    if out.returncode != 0:\n        return None",
     "to": "    if out.returncode != 0:\n        return set()"},

    {"suite": "test_prune_runs.py", "file": "prune_runs.py",
     "what": "the walk stops at the first manifest it meets, so every place map nested under a town is invisible to the pruner",
     "find": '                dirnames[:] = [d for d in dirnames if d == "Places"]',
     "to": "                dirnames[:] = []"},

    # ------------------------------------------------------------ auto_refresh_month.py
    # The other module that runs to nobody, and the only one in this half that
    # ACTS: a SAFE verdict rebuilds four stages for that town and stages a
    # proposed update for the customer to accept. Its two second homes are the
    # first two cases -- both were the live behaviour until 2026-09-15, and both
    # were found by calling the function rather than by reading it.
    {"suite": "test_auto_refresh_month.py", "file": "auto_refresh_month.py",
     "what": "classify re-spells the non-actionable set as the bare literal COMMUNITY, so an expected absence the report leaves off its review list is auto-applied as SAFE",
     "find": "    actionable = [c for c in changes if c[0] not in rr.NON_ACTIONABLE]",
     "to": '    actionable = [c for c in changes if c[0] != "COMMUNITY"]'},

    {"suite": "test_auto_refresh_month.py", "file": "auto_refresh_month.py",
     "what": "SAFE goes back to being the complement of a blocking list, so every tag the report grows is auto-applied on the day it is added",
     "find": "    escalating = [c for c in actionable if c[0] not in MECHANICAL]",
     "to": '    escalating = [c for c in actionable if c[0] in ("ADD?", "WITHDRAWN?", "RE-EVAL")]'},

    {"suite": "test_auto_refresh_month.py", "file": "auto_refresh_month.py",
     "what": "MECHANICAL quietly grows a third member, so a change whose fix is a person editing a field is applied as though it were an operator rename",
     "find": 'MECHANICAL = ("OPERATOR", "DAYS")',
     "to": 'MECHANICAL = ("OPERATOR", "DAYS", "NOT-IN-BODS?")'},

    {"suite": "test_auto_refresh_month.py", "file": "auto_refresh_month.py",
     "what": "patch_verified_services patches every route the fresh pull carries, so a town's whole service file is rewritten from BODS on the strength of one safe change",
     # Anchored on the line above as well, because the guard in `patch_routes_json`
     # is the same text four spaces further in and CONTAINS this one as a
     # substring -- the anchor-matched-twice check caught it, which is what that
     # check is for.
     "find": '        r = svc.get("route")\n        if r in safe_routes and r in new_values:',
     "to": '        r = svc.get("route")\n        if r in new_values:'},

    {"suite": "test_auto_refresh_month.py", "file": "auto_refresh_month.py",
     "what": "patch_routes_json rewrites external[].days for every route, so a route nobody adjudicated gets BODS's days printed against it",
     "find": "            if r in safe_routes and r in new_values:",
     "to": "            if r in new_values:"},

    {"suite": "test_auto_refresh_month.py", "file": "auto_refresh_month.py",
     "what": "an operator entry emptied by a reassignment is left in routes.json, so the Key prints an operator with no routes under it",
     "find": '        routes["operators"] = [o for o in ops if o.get("routes")]  # drop emptied entries',
     "to": '        routes["operators"] = ops  # drop emptied entries'},

    # ---------------------------------------------------------------- the load test
    # The cheapest check there is, and the one that was missing for a year. This
    # is the `gen_external_busway.js` shape in Python: a module nothing on the
    # monthly path imports until the monthly path runs.
    {"suite": "test_module_load.py", "file": "prune_runs.py",
     "what": "a module's import is renamed and nothing that runs daily touches it, so it throws at load for as long as nobody prunes",
     "find": "import cli   # OA-224 Tier 3.1: --root, then BUSES_DIR, then the laptop",
     "to": "import cli_renamed_by_a_refactor   # OA-224 Tier 3.1"},

    # ------------------------------------------------------------- the look-ahead
    # OA-001's second long fuse. gtfs_upcoming.py runs once a month to nobody and
    # writes the report a person adjudicates a rebuild from, so a wrong finding
    # here is either a rebuild nobody owed or a change nobody saw.
    #
    # THE FIRST TWO ARE THE BANK-HOLIDAY-EXTRA GATE. A calendar_dates-only
    # service with a few future dates is an occasional working, not a timetable
    # change; without the gate every one of them raises [NEW] or [CHANGE] and the
    # monthly report fills with rows a person has to adjudicate one at a time.
    {"suite": "test_gtfs_upcoming.py", "file": "gtfs_upcoming.py",
     "what": "MIN_ONGOING_DATES drops to 1, so a single bank-holiday extra registered for a future date raises a timetable change against the town",
     "find": "MIN_ONGOING_DATES = 10",
     "to": "MIN_ONGOING_DATES = 1"},

    {"suite": "test_gtfs_upcoming.py", "file": "gtfs_upcoming.py",
     "what": "the ongoing gate is removed outright, so any future-dated registration counts however sparse it is",
     "find": "        ongoing = had_cal or addn >= MIN_ONGOING_DATES",
     "to": "        ongoing = True"},

    # THE ONE OA-269 WOULD HAVE WANTED. `routingHash` is a SHA-1 over the set of
    # DISTINCT stop sequences and `tripCount` is len(distinct trip_id): that is
    # the whole separation between the road moving and the operator splitting the
    # same journeys across more service_ids. Taken over trip ids the hash moves
    # whenever the count does, so every re-registration reads as a road move --
    # and tools/prove-red-timetable-trigger.py cannot see it, because its
    # fixtures are the dictionaries this line builds.
    {"suite": "test_gtfs_upcoming.py", "file": "gtfs_upcoming.py",
     "what": "routingHash is taken over trip ids rather than stop sequences, so a re-registration that moves no road reads as one that does",
     "find": '        R["routingHash"] = hashlib.sha1(("|".join("/".join(s) for s in sorted(seqs))).encode()).hexdigest()[:12]',
     "to": '        R["routingHash"] = hashlib.sha1(("|".join(sorted(tids))).encode()).hexdigest()[:12]'},

    {"suite": "test_gtfs_upcoming.py", "file": "gtfs_upcoming.py",
     "what": "calendar_dates REMOVALS are unioned in as though they were additions, so a Christmas Day exclusion registers the service as running until Christmas",
     "find": '        "SELECT date FROM calendar_dates WHERE service_id=? AND exception_type=\'1\'", (service_id,)).fetchall()]',
     "to": '        "SELECT date FROM calendar_dates WHERE service_id=?", (service_id,)).fetchall()]'},

    {"suite": "test_gtfs_upcoming.py", "file": "gtfs_upcoming.py",
     "what": "the finding prints the day pattern the route runs TODAY instead of the one it changes to, so the reader is told nothing has changed",
     "find": '            R["futureDays"] = fmt_days(uf)',
     "to": '            R["futureDays"] = fmt_days(R["flags"])'},

    {"suite": "test_gtfs_upcoming.py", "file": "gtfs_upcoming.py",
     "what": "prev_snapshot stops excluding today's own file, so a re-run the same day diffs the feed against itself and reports a quiet month",
     "find": '    cands = [c for c in cands if os.path.basename(c) < f"snapshot_{today_iso}.json"]',
     "to": "    cands = list(cands)"},

    {"suite": "test_gtfs_upcoming.py", "file": "gtfs_upcoming.py",
     "what": "a contiguous PAIR of days prints as a range, so the seasonal Sat & Sun coach reads as Sat-Sun and a two-day service looks like a span",
     "find": '        return f"{ABBR[on[0]]}-{ABBR[on[-1]]}" if len(on) > 2 else " & ".join(ABBR[i] for i in on)',
     "to": '        return f"{ABBR[on[0]]}-{ABBR[on[-1]]}" if len(on) >= 2 else " & ".join(ABBR[i] for i in on)'},

    # ---------------------------------------------------------------- the declaration
    # THE FAULT THAT PUT test_dependencies.py THERE, RE-ENACTED. python-docx was
    # imported by two generators for a year, installed on the laptop, declared
    # nowhere -- so the suite was green here and red on its first CI run, and the
    # control failing stopped every mutation below from being asked at all. The
    # mutation is the next one of those: a third-party import added by somebody
    # who already has it installed.
    {"suite": "test_dependencies.py", "file": "prune_runs.py",
     "what": "a new third-party import is added and declared nowhere, so it works on the author's laptop and dies on every other machine",
     "find": "import argparse, json, os, re, shutil, subprocess, sys, datetime",
     "to": "import argparse, json, os, re, shutil, subprocess, sys, datetime\nimport requests   # nobody declared this"},

    # ---------------------------------------------------------- gtfs_refresh_report.py
    # THE FIRST OF THESE IS NOT A HYPOTHETICAL MUTATION -- it is the code that
    # shipped until 2026-09-15, restored. `parse_days` scanned for a day token
    # anywhere in the string and took a lone one as the service's week, so
    # Beaconsfield's X74 "Daily (reduced Sun)" read as SUNDAY ONLY and
    # `[DAYS] X74 - shipped 'Daily (reduced Sun)' vs BODS 'Daily'` stood on the
    # monthly reports of 21 and 31 August and 1 September, actionable every time,
    # over a bus that had not changed. A mutation that re-enacts a real fault is
    # the only kind that can show a new suite would have caught it.
    {"suite": "test_gtfs_refresh_report.py", "file": "gtfs_refresh_report.py",
     "what": "parse_days takes a lone day token from anywhere in the string, so 'Daily (reduced Sun)' is Sunday-only again and the monthly report cries [DAYS] about a bus that runs all week",
     "find": '    if re.fullmatch(DAY_ONE,p): return {DAY_IDX[p[:3]]}',
     "to": '    _m=re.search(DAY_ONE,p)\n    if _m: return {DAY_IDX[_m.group(0)[:3]]}'},

    {"suite": "test_gtfs_refresh_report.py", "file": "gtfs_refresh_report.py",
     "what": "a day range is matched anywhere in the piece rather than as the whole of it, so 'Mon-Sat 06:30-19:00' becomes a comparable week and a timetable note starts raising findings",
     "find": '    m=re.fullmatch(r"("+DAY_ONE+r")(?:\\s*[-–—]\\s*|\\s+to\\s+)("+DAY_ONE+r")",p)',
     "to": '    m=re.search(r"("+DAY_ONE+r")(?:\\s*[-–—]\\s*|\\s+to\\s+)("+DAY_ONE+r")",p)'},

    {"suite": "test_gtfs_refresh_report.py", "file": "gtfs_refresh_report.py",
     "what": "a backwards range returns the EMPTY SET again, which `is not None` and so travels as a real answer that differs from every feed there is",
     "find": '        return set(range(a,b+1)) if b>=a else None',
     "to": '        return set(range(a,b+1))'},

    {"suite": "test_gtfs_refresh_report.py", "file": "gtfs_refresh_report.py",
     "what": "the days string is no longer split on & or a comma, so 'Mon & Fri' stops being readable and five services on the estate go silently unchecked",
     "find": '    for part in re.split(r"[&,]|\\band\\b",t):',
     "to": '    for part in [t]:'},

    # fmt writes the FEED's half of a [DAYS] line, so a fault here prints two
    # spellings of one week side by side and calls them a change.
    {"suite": "test_gtfs_refresh_report.py", "file": "gtfs_refresh_report.py",
     "what": "fmt spells any week as a range, so Mon & Wed & Fri prints as 'Mon-Fri' and a real difference is hidden behind a tidier sentence",
     "find": '    if o==list(range(o[0],o[-1]+1)): return f"{DOW[o[0]]}-{DOW[o[-1]]}" if len(o)>2 else " & ".join(DOW[i] for i in o)',
     "to": '    if True: return f"{DOW[o[0]]}-{DOW[o[-1]]}" if len(o)>2 else " & ".join(DOW[i] for i in o)'},

    # The whole monthly diff is taken against whatever this returns.
    {"suite": "test_gtfs_refresh_report.py", "file": "gtfs_refresh_report.py",
     "what": "latest_verified returns the OLDEST S1 run, so every town is diffed against the service list it shipped first rather than the one it ships",
     "find": '    return cands[-1] if cands else None',
     "to": '    return cands[0] if cands else None'},

    # ---------------------------------------------------------------- index_guard.py
    # The module whose JS twin has had a unit test since the day it was written and
    # whose Python half had none until 2026-09-15. Every case below re-enacts OA-134:
    # Wisbech runs two route 46s, and a fault here moves no drawn byte -- it quietly
    # halves what the monthly refresh report looks at.
    {"suite": "test_index_guard.py", "file": "index_guard.py",
     "what": "group_by INDEXES instead of grouping, which is OA-134 exactly -- Stagecoach East's 46 disappears and the monthly report diffs only the Lynx one, as it did every month until 2026-08-28",
     "find": '        out.setdefault(key(row), []).append(row)',
     "to": '        out[key(row)] = [row]'},

    {"suite": "test_index_guard.py", "file": "index_guard.py",
     "what": "service_key ignores the `key` field, so both of Wisbech's 46s are labelled '46' and a reader of the refresh report is told about one bus twice instead of two buses once",
     "find": '    k = s.get("key")',
     "to": '    k = s.get("route")'},

    {"suite": "test_index_guard.py", "file": "index_guard.py",
     "what": "index_unique stops refusing a collision, so draft_town silently keeps whichever same-numbered service happened to be last in the file",
     "find": '    if clashes:',
     "to": '    if False:'},

    {"suite": "test_index_guard.py", "file": "index_guard.py",
     "what": "assert_no_collision never fires, so the after-the-fact check that a dict somebody else built lost nothing always passes",
     "find": '    if len(mapping) != n:',
     "to": '    if len(mapping) != n and False:'},

    # The two below are caught by the TWIN CENSUS and by nothing else in the estate.
    # index_guard.js and index_guard.py are one rule written twice, neither half moves
    # a drawn byte, and until this suite nothing anywhere held them together. The
    # second mutates a .js file from the PYTHON harness on purpose: the census is a
    # Python test whose subject is the other language's copy, so this is the only
    # place that case can be run at all.
    {"suite": "test_index_guard.py", "file": "index_guard.py",
     "what": "the Python half grows a function the JS half does not have and nobody declares the divergence -- the drift this census exists to refuse",
     "find": 'def assert_no_collision(mapping, items, what):',
     "to": 'def sort_services(rows):\n    return sorted(rows or [], key=service_key)\n\n\ndef assert_no_collision(mapping, items, what):'},

    {"suite": "test_index_guard.py", "file": "index_guard.js",
     "what": "the JS half stops exporting indexUniqueObj, so the declared JS_ONLY exemption for it is stale -- the exemption retiring itself, watched rather than claimed",
     "find": 'module.exports = { serviceKey, indexUnique, indexUniqueObj, assertNoCollision };',
     "to": 'module.exports = { serviceKey, indexUnique, assertNoCollision };'},

    # ---------------------------------------------------------------- gtfs_duration.py
    # The module that WRITES into a map's own routes.json, so every case below is a
    # wrong number printed on a published sheet as "~N min" beside a spoke. No gate in
    # the estate can see one: a sheet built from a wrong minute figure reproduces
    # byte-for-byte for ever, and the only other reader is a rider at a bus stop.
    {"suite": "test_gtfs_duration.py", "file": "gtfs_duration.py",
     "what": "_locality accepts a bare 9-character locality as a stop, so every stop in the destination town pairs with the terminus and a spoke is timed to whichever the bus reached first",
     "find": '    return s[:9] if len(s) >= 10 and s[:4].isdigit() and s[4:9].isalpha() else None',
     "to": '    return s[:9] if len(s) >= 9 and s[:4].isdigit() and s[4:9].isalpha() else None'},

    {"suite": "test_gtfs_duration.py", "file": "gtfs_duration.py",
     "what": "the terminus pairing goes, so a looping route is timed to the last stop it calls at -- route 9's 20-minute ride to St Ives reads 78 again, which is the fault this module's longest docstring is about",
     "find": "            if eloc and ename and _locality(rows[j]['stop_id']) == eloc \\\n                    and _norm_stop_name(rows[j]['stop_name']) == ename:\n                return j",
     "to": "            if False:\n                return j"},

    {"suite": "test_gtfs_duration.py", "file": "gtfs_duration.py",
     "what": "the journey is timed from the FIRST town stop rather than the last, so every spoke on the sheet carries the town leg as well as the journey",
     "find": '                origin_i = i  # keep the LAST matching stop (town may have several)',
     "to": '                origin_i = i if origin_i is None else origin_i  # keep the FIRST'},

    {"suite": "test_gtfs_duration.py", "file": "gtfs_duration.py",
     "what": "the mean replaces the median, so one slow school-holiday working moves a printed figure",
     "find": '    return round(statistics.median(durations)), len(durations)',
     "to": '    return round(statistics.mean(durations)), len(durations)'},

    {"suite": "test_gtfs_duration.py", "file": "gtfs_duration.py",
     "what": "two trips become a trustworthy sample, so a spoke can be timed off one timetabled pair and prints as confidently as one timed off forty",
     "find": '    if len(durations) < 3: return None, len(durations)  # too thin a sample to trust',
     "to": '    if len(durations) < 2: return None, len(durations)  # too thin a sample to trust'},

    {"suite": "test_gtfs_duration.py", "file": "gtfs_duration.py",
     "what": "the majority-terminus fallback stops asking the caller, so a route that splits to two places blends both arms into one number that describes neither",
     "find": '    if len(durations) < 3 and allow_majority_fallback and terminus_counts:',
     "to": '    if len(durations) < 3 and terminus_counts:'},

    {"suite": "test_gtfs_duration.py", "file": "gtfs_duration.py",
     "what": "the fallback's own three-trip floor drops to two, so the rescue fires on a sample the ordinary path would refuse",
     "find": '        if majority_n >= 3:',
     "to": '        if majority_n >= 2:'},

    {"suite": "test_gtfs_duration.py", "file": "gtfs_duration.py",
     "what": "_clean_dest keeps the human qualifier, so 'Cambridge (Drummer St)' matches no GTFS name and --fill silently leaves that spoke blank",
     "find": "    return label.split('(')[0].strip()",
     "to": "    return label.strip()"},

    # ---------------------------------------------------------------- gtfs_query.py
    # S1 runs this module and its output IS the town's verified-services.json, so
    # every break below reaches a printed sheet and none of them can be seen by a
    # byte gate: the sheet built from a wrong answer reproduces for ever.
    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "two adjacent days hyphenate, so a Mon & Tue shopping bus prints as 'Mon-Tue' -- the same width, saying less",
     "find": '        return f"{ABBR[on[0]]}-{ABBR[on[-1]]}" if len(on)>2 else " & ".join(ABBR[i] for i in on)',
     "to": '        return f"{ABBR[on[0]]}-{ABBR[on[-1]]}" if len(on)>1 else " & ".join(ABBR[i] for i in on)'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "calendar_dates ADDITIONS stop counting, which is OA-204 exactly: High Wycombe's 300 files Mon-Fri and adds 263 weekend dates, so the sheet says 'no Sunday bus' on a day 12 journeys run",
     "find": '    if e=="1": return True',
     "to": '    if e=="1": pass'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "calendar_dates REMOVALS stop counting, so a school-term break or a bank holiday still reads as a running day and the frequency fields count journeys nobody can catch",
     "find": '    if e=="2": return False',
     "to": '    if e=="2": pass'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the sampled window starts on the reference DAY rather than its Monday, so the first week is short, its journey count is low and journeysPerWeekRange opens with a week that never happened",
     "find": '    monday=ref-datetime.timedelta(ref.weekday())',
     "to": '    monday=ref'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "sampling runs past the end of the feed, so weeks the data does not cover are counted as weeks with no service and weeksActive falls for every route in the town",
     "find": '        if last and m.strftime("%Y%m%d")>last: break',
     "to": '        if False: break'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "a 25:10 night journey is clamped to 01:10, which puts it at the head of the day: the window opens at 01:10 and the longest daytime gap is measured from the wrong end",
     "find": '    p=t.split(":"); return int(p[0])*60+int(p[1])',
     "to": '    p=t.split(":"); return (int(p[0])%24)*60+int(p[1])'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the longest gap is measured over the whole day rather than 07:00-19:00, so a school working at 05:50 and a night bus at 20:00 decide the number that is supposed to describe the working day",
     "find": '    inday=sorted({m for m in allt if DAY_LO<=m<=DAY_HI})',
     "to": '    inday=sorted({m for m in allt})'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the core headway is taken over the whole day instead of 09:00-15:00, so a route with two morning journeys and two evening ones reports a headway and is drawn as if you could turn up for it",
     "find": '    core=[m for m in dom if CORE_LO<=m<=CORE_HI]',
     "to": '    core=[m for m in dom]'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the core headway becomes the WORST gap rather than the median, which is set by the thinnest hour of the day and demotes the line weight of every turn-up-and-go route there is",
     "find": '    head=int(statistics.median(b-a for a,b in zip(core,core[1:]))) if len(core)>=3 else None',
     "to": '    head=int(max(b-a for a,b in zip(core,core[1:]))) if len(core)>=3 else None'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "two departures in the core day become a headway, and one gap is not a headway -- it would be quoted as one all the same",
     "find": '    head=int(statistics.median(b-a for a,b in zip(core,core[1:]))) if len(core)>=3 else None',
     "to": '    head=int(statistics.median(b-a for a,b in zip(core,core[1:]))) if len(core)>=2 else None'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "a repeated departure minute contributes a gap of ZERO, which is what dragged High Wycombe's M40 to a median headway of 0 minutes and drew it as the busiest line on the sheet",
     "find": '    for m,dr in profile: bydir.setdefault(dr,set()).add(m)',
     "to": '    for m,dr in profile: bydir.setdefault(dr,[]).append(m)'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the headway is taken in the QUIETER direction, so the wait a passenger actually has is replaced by the wait in the direction fewest buses go",
     "find": '    dom=sorted(max(bydir.values(), key=len))',
     "to": '    dom=sorted(min(bydir.values(), key=len))'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "journeysPerWeek becomes the BUSIEST week rather than the lower median, so one bank-holiday week or one week of rail replacement sets the weight of a lane for the year",
     "find": '    typical=sorted(live)[len(live)//2] if live else 0',
     "to": '    typical=max(live) if live else 0'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "weeksActive counts every sampled week rather than the weeks the service runs at all, which removes the only floor that stops a bank-holiday-only route being tiered as a weekly service",
     "find": '      "weeksActive":len(live),',
     "to": '      "weeksActive":len(weekly),'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the de-duplicator stops firing, so a journey filed under four service_ids is four journeys: High Wycombe's M40 quadruples and is drawn four times heavier than it runs",
     "find": '                if key in seen:            # the same journey, filed again',
     "to": '                if False:            # the same journey, filed again'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "a journey's identity becomes its two ENDS rather than its whole stop sequence, so two real journeys leaving at the same minute for the same place by different roads are collapsed into one and the route is drawn at half its frequency",
     "find": '    return {k:tuple(v) for k,v in seqs.items()}',
     "to": '    return {k:(v[0],v[-1]) for k,v in seqs.items()}'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the RESOLVED days are discarded for the operator's declared calendar pattern, so every route in the estate reports what its calendar row says rather than what it runs -- and daysBasis says 'declared' while nothing else changes",
     "find": '        if any(served): flags, basis = served, "resolved from calendar + calendar_dates over the sampled window"',
     "to": '        if False: flags, basis = served, "resolved from calendar + calendar_dates over the sampled window"'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "only the far end of a trip is recorded as a terminus, so every route through the town loses the place it came FROM and the external sheet draws a one-armed spoke",
     "find": '            if seq: ends.add(seq[0]["stop_name"]); ends.add(seq[-1]["stop_name"])',
     "to": '            if seq: ends.add(seq[-1]["stop_name"])'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "services are grouped by route_id rather than by the number on the bus, so a route registered once per direction or once per operator is listed twice in the Services panel",
     "find": '        by.setdefault(r["sn"],{"sn":r["sn"],"ops":set(),"long":set(),"route_ids":set()})',
     "to": '        by.setdefault(r["route_id"],{"sn":r["sn"],"ops":set(),"long":set(),"route_ids":set()})'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the variant hint reads its prefix rule backwards, so 5A is no longer offered as a variant of 5 and the curation step loses the prompt it exists to give",
     "find": '        base=[n for n in names if n!=s["route"] and s["route"].startswith(n) and s["route"][len(n):].isalpha()]',
     "to": '        base=[n for n in names if n!=s["route"] and n.startswith(s["route"]) and s["route"][len(n):].isalpha()]'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the earth gets bigger, so every --near radius reaches further than asked and a place map picks up stops in the next village",
     "find": '    return 6371*2*asin(sqrt(a))',
     "to": '    return 6400*2*asin(sqrt(a))'},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the region is hardcoded again, which is the fault that field was fixed for: every Buckinghamshire and Bedfordshire pull records east_anglia as its source, in the one field a later reader uses to check which feed a fact came from",
     "find": '         "source":"BODS GTFS (%s)"%os.path.splitext(os.path.basename(db))[0],',
     "to": '         "source":"BODS GTFS (east_anglia)",'},

    # ------------------------------------------------------- the map nobody enumerated
    # OA-001's third long fuse, and the only one whose fault is an ABSENCE.
    # gtfs_places.discover() decides which place maps exist; every other
    # instrument this estate owns is asked OF a map, so a place it fails to
    # return is not scanned, not reported and not counted anywhere. Each
    # mutation below leaves a green byte gate, a green status.js, and a report
    # that simply has less in it.
    #
    # THE FIRST HAS THE SMALLEST DIFF AND THE WORST OUTCOME. The `_portal-fixture`
    # tree is a frozen copy of two High Wycombe places carrying the same NAMES as
    # the live maps, and entries are keyed on the name with the fixture globbed
    # LAST -- so emptying this tuple does not ADD an entry, it silently replaces a
    # live place's directory with the fixture's and the count does not move.
    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "the portal fixture stops being excluded, so the frozen copy of High Wycombe Aldi overwrites the live map's entry under the same name and the monthly scan reads a fixture's coordinates",
     "find": 'EXCLUDED_DIRS = ("_portal-fixture",)',
     "to": 'EXCLUDED_DIRS = ()'},

    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "the exclusion matches a path SUBSTRING rather than a whole component, so a real place in any folder whose name merely contains the fixture's stops being scanned",
     "find": '            if d in seen or any(x in d.split(os.sep) for x in EXCLUDED_DIRS):',
     "to": '            if d in seen or any(x in d for x in EXCLUDED_DIRS):'},

    # THE THREE LAYOUTS. Each pattern is a whole class of place map, and dropping
    # one removes every place of that shape from the scan with no error anywhere.
    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "places bucketed under Places/<Bucket>/<Place>/ stop being discovered, so every standalone map -- Ely Co-op and both Godmanchester branches -- silently leaves the monthly scan",
     "find": '        (os.path.join(root, "Places", "*", "*", "manifest.json"), False),',
     "to": '        (os.path.join(root, "Places", "*", "*", "no-such-file.json"), False),'},

    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "places inside a mapped area stop being discovered, which is the largest of the three classes and the one every town's own place maps belong to",
     "find": '        (os.path.join(root, "Areas", "*", "Places", "*", "manifest.json"), True),',
     "to": '        (os.path.join(root, "Areas", "*", "Places", "*", "no-such-file.json"), True),'},

    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "a place inside a mapped area loses its parent town, so it no longer inherits that town's dataset and is diffed against whatever its own place.json happens to name",
     "find": '            parent = os.path.basename(os.path.dirname(os.path.dirname(d))) if has_parent else None',
     "to": '            parent = None'},

    # THE STAGE ORDER. S4/S5 hold copies made at generate and render time; S1/S2
    # are where the facts are written. Reversed, a place whose services were
    # re-pulled but not yet re-rendered is scanned against the radius its last
    # picture was drawn with.
    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "the render-time copies are trusted ahead of the facts stages, so a place re-pulled since its last render is scanned against a stale radius",
     "find": 'STAGE_PREFERENCE = ("S2", "S1", "S5", "S4")',
     "to": 'STAGE_PREFERENCE = ("S5", "S4", "S2", "S1")'},

    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "the CI reference mirror is consulted FIRST, so every place is scanned against the frozen gate copy rather than against its own latest run",
     "find": '    out.append(os.path.join(place_dir, "ci-reference"))',
     "to": '    out.insert(0, os.path.join(place_dir, "ci-reference"))'},

    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "a place read from the mirror no longer says so, so a report quoting coordinates that are current-state-only reads exactly like one quoting a live run",
     "find": '            note = "read from ci-reference (no stage run has it)" if os.path.basename(d) == "ci-reference" else None',
     "to": '            note = None'},

    # THE REGION JOIN, at the end that produces a CONFIDENT WRONG ANSWER rather
    # than a refusal -- the Beaconsfield shape, arriving through a place instead
    # of a town.
    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "a place's own region name is preferred to its parent town's, so a place is diffed against a dataset its town is not in and reports its routes withdrawn",
     "find": '    if parent_cfg is not None:',
     "to": '    if parent_cfg is not None and not (place_meta or {}).get("region"):'},

    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "an unrecognised region name falls back to the default dataset instead of being returned for gtfs_regions.plan() to name, so a misconfigured place is quietly scanned against a feed that cannot contain it and found to serve nothing",
     "find": "    return human\n\n\ndef _place_dirs(root):",
     "to": "    return default\n\n\ndef _place_dirs(root):"},

    # THE RADIUS AND THE COLLISION.
    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "a place whose name collides with a registered town is scanned instead of refused, so it takes the TOWN's slot in the entries dict and the town stops being scanned at all",
     "find": '            problems.append((name, "a town of this name is already registered in town_prefixes.json"))\n            continue',
     "to": "            pass"},

    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "the assumed-radius caveat is dropped, so a place with no recorded radius is reported with the same confidence as one that has one",
     "find": '            note = "; ".join(x for x in (note, f"no recorded radius — assumed {DEFAULT_SERVICE_KM} km") if x)',
     "to": '            note = note'},

    {"suite": "test_gtfs_places.py", "file": "gtfs_places.py",
     "what": "the fallback service radius becomes the walkshed-sized 0.4 km, so a place with no recorded radius is scanned over half the ground and loses the routes between the two circles",
     "find": 'DEFAULT_SERVICE_KM = 0.8',
     "to": 'DEFAULT_SERVICE_KM = 0.4'},

]


def read(path):
    with io.open(path, encoding="utf-8") as fh:
        return fh.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def run_suite(engine_dir, suite):
    """Run one test file against `engine_dir`. True when it PASSED."""
    env = dict(os.environ)
    env["ENGINE_DIR"] = engine_dir
    env["PYTHONPATH"] = TESTS + os.pathsep + env.get("PYTHONPATH", "")
    proc = subprocess.run(
        [sys.executable, os.path.join(TESTS, suite)],
        cwd=TESTS, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return proc.returncode == 0, proc.stdout.decode("utf-8", "replace")


def main():
    root = os.path.join(tempfile.gettempdir(), "busmaps-scratch")
    os.makedirs(root, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="prove-red-python-", dir=root)
    engine = os.path.join(tmp, "assets")
    shutil.copytree(ASSETS, engine, ignore=shutil.ignore_patterns("__pycache__"))

    failures = []

    print("0. THE CONTROL -- the unmutated copy must be green, or every verdict below is about something else")
    control_ok = True
    for suite in sorted({m["suite"] for m in MUTATIONS}):
        ok, out = run_suite(engine, suite)
        print("  %-4s %s" % ("ok" if ok else "FAIL", suite))
        if not ok:
            control_ok = False
            failures.append("CONTROL %s" % suite)
            print(out)
    if not control_ok:
        print("\nThe control failed, so no mutation below would mean anything. Stopping.")
        print("  scratch copy: %s" % tmp)
        return 1

    print("\n%d mutation(s), each applied alone" % len(MUTATIONS))
    for i, m in enumerate(MUTATIONS, 1):
        target = os.path.join(engine, m["file"])
        original = read(target)
        n = original.count(m["find"])
        if n != 1:
            print("  FAIL %2d. anchor matched %d times in %s (expected exactly 1)" % (i, n, m["file"]))
            failures.append("%s: anchor" % m["file"])
            continue
        write(target, original.replace(m["find"], m["to"]))
        try:
            ok, out = run_suite(engine, m["suite"])
        finally:
            write(target, original)
        caught = not ok
        print("  %-9s %2d. %s" % ("caught" if caught else "SURVIVED", i, m["what"]))
        print("            %s -> %s" % (m["file"], m["suite"]))
        if not caught:
            failures.append("%s: %s" % (m["file"], m["what"]))

    if KEEP:
        print("\nscratch copy kept at %s" % tmp)
    else:
        shutil.rmtree(tmp, True)

    print("\n" + "=" * 78)
    if failures:
        print("FAILED -- %d mutation(s) or control(s) did not hold:" % len(failures))
        for f in failures:
            print("  - %s" % f)
        return 1
    print("OK -- the control is green and all %d mutations were caught" % len(MUTATIONS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
