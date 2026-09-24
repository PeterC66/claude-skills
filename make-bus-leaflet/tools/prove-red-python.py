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

    # ------------------------------ gtfs_refresh_report.py, the tag grading
    # THESE THREE CAME FROM auto_refresh_month.py, WHICH WAS RETIRED ON 2026-09-18
    # (buses-data OA-091). That module was the monthly auto-applier -- a SAFE
    # verdict rebuilt four stages for the town and staged a proposed update for
    # the customer to accept -- and it went on a measurement: its SAFE path fired
    # once in 24 town-months and that once was wrong. The GRADING moved into the
    # module that emits the tags, and these mutations moved with it, because what
    # they falsify has not changed: the grade now decides what the report PRINTS
    # beside each town, so a survivor here is a heading that tells a person a
    # change needs nobody. The first two were the live behaviour until 2026-09-15
    # and both were found by calling the function rather than by reading it.
    # Their three siblings, which mutated the patch functions, were deleted with
    # them -- there is no applier left for them to be about.
    {"suite": "test_gtfs_refresh_report.py", "file": "gtfs_refresh_report.py",
     "what": "the actionable filter re-spells the non-actionable set as the bare literal COMMUNITY, so an expected absence the report leaves off its review list is graded SAFE -- and since OA-426 this one line is asked by the grade AND by the sidecar, so a survivor here is wrong in two artefacts",
     "find": "    return [c for c in changes if c[0] not in NON_ACTIONABLE]",
     "to": '    return [c for c in changes if c[0]!="COMMUNITY"]'},

    {"suite": "test_gtfs_refresh_report.py", "file": "gtfs_refresh_report.py",
     "what": "SAFE goes back to being the complement of a blocking list, so every tag the report grows is auto-applied on the day it is added",
     "find": "    escalating=[c for c in actionable if c[0] not in MECHANICAL]",
     "to": '    escalating=[c for c in actionable if c[0] in ("ADD?","WITHDRAWN?","RE-EVAL")]'},

    {"suite": "test_gtfs_refresh_report.py", "file": "gtfs_refresh_report.py",
     "what": "MECHANICAL quietly grows a third member, so a change whose fix is a person editing a field is applied as though it were an operator rename",
     "find": 'MECHANICAL=("OPERATOR","DAYS")',
     "to": 'MECHANICAL=("OPERATOR","DAYS","NOT-IN-BODS?")'},


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

    # The two below put OA-369 back, one per half of `_route_of`. Both restore a
    # real shipped behaviour rather than inventing one: the first is the exact
    # expression the module carried from 2026-08-28 to 2026-09-20, and it is the
    # only mutation in this file whose fault is that the GUARD ITSELF dies -- the
    # caller gets an AttributeError traceback in place of the ValueError the whole
    # module is about, on the one row shape `service_key` accepts by name.
    {"suite": "test_index_guard.py", "file": "index_guard.py",
     "what": "a non-dict row reaches .get again, so a bare route string makes the refusal raise AttributeError from inside the guard instead of reporting the collision -- OA-369, which stood for 23 days because no live caller passes a non-dict and neither half moves a drawn byte",
     "find": '    if not isinstance(row, dict):\n        return "?"',
     "to": '    if False:\n        return "?"'},

    {"suite": "test_index_guard.py", "file": "index_guard.py",
     "what": "the route falls back to `.get`'s default, which applies only when the KEY is absent -- so a dict carrying an explicit `route: None` prints the word 'None' where the JS twin prints '?', the second divergence in the same expression and the one nothing had named",
     "find": '    r = row.get("route")\n    return "?" if r is None else r',
     "to": '    return row.get("route", "?")'},

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
     # Re-anchored on 2026-09-18: OA-410 rewrote this line to carry the window length
     # and the fraction. The mutation is unchanged in what it falsifies.
     "find": '        if any(served):',
     "to": '        if False:'},

    # ---- OA-410, the fraction that separates a pattern from an occurrence -------------
    # Three mutations, because the rule has three parts and each fails differently: the
    # counting, the fraction, and the exemption for a weekday the operator declared.
    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "a weekday counts as soon as ONE journey is found on it anywhere in the sampled window, so a single calendar_dates addition -- a bank holiday, a rail replacement -- becomes a running day on the printed sheet. This is the OA-410 bug exactly: St Neots C2 read 'Tue & Thu' off one added Tuesday",
     "find": '''      "servedFlags":[1 if (n and (declared[j] or n>len(mondays)*EXCEPTION_DAY_MIN_FRACTION))
                     else 0 for j,n in enumerate(servedWeeks)],''',
     "to": '''      "servedFlags":[1 if n else 0 for j,n in enumerate(servedWeeks)],'''},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the fraction becomes a COUNT, so the rule stops being relative to the sampled window -- three bank-holiday Mondays in twelve weeks and three in a four-week window at the end of a registration are then the same answer, and one of them is wrong whichever number is chosen",
     "find": "n>len(mondays)*EXCEPTION_DAY_MIN_FRACTION",
     "to": "n>2"},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "the fraction is applied to EVERY weekday rather than only to the ones no calendar row declares, so a Mon-Fri service that manages one Friday in the window loses the Friday its operator declared -- trading OA-410's fault for the opposite one",
     "find": "declared[j] or n>len(mondays)*EXCEPTION_DAY_MIN_FRACTION",
     "to": "n>len(mondays)*EXCEPTION_DAY_MIN_FRACTION"},

    {"suite": "test_gtfs_query.py", "file": "gtfs_query.py",
     "what": "servedWeeks counts JOURNEYS rather than weeks, so a route with forty journeys on one Tuesday scores that Tuesday forty times and clears any fraction -- the count stops measuring how often the day recurs and starts measuring how busy it is",
     "find": "                if per_day[j]==1: servedWeeks[j]+=1",
     "to": "                servedWeeks[j]+=1"},

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

    # ---------------------------------------------------------------- gtfs_regions.py
    # The module that refuses. Every mutation below turns a refusal into an
    # answer, which is the only failure mode it has: the monthly report is prose
    # nobody diffs, so a town read from the wrong dataset comes out as a list of
    # withdrawn routes that looks exactly like a list of withdrawn routes.

    # RULE 1 -- THERE IS NO DEFAULT REGION.
    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "the privileged region comes back, so every town whose region key is missing is silently read from Cambridgeshire -- the 2026-08-21 rule undone by one word",
     "find": 'DEFAULT_REGION = None',
     "to": 'DEFAULT_REGION = "cambridgeshire"'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "resolve_db guesses instead of refusing, so any ad-hoc query run without --db is answered from a dataset nobody chose and reports an out-of-region town as entirely withdrawn",
     "find": '    raise SystemExit(',
     "to": '    return "cambridgeshire.sqlite" or SystemExit('},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "an explicit --db is ignored in favour of the environment, so a session that names its dataset is silently overridden by whatever the shell was last set to",
     "find": '    if explicit:',
     "to": '    if False:'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "the deprecated $CAMBS_GTFS_DB is read in place of $GTFS_DB, so the misnamed single-region variable quietly becomes the live one again",
     "find": '    env = os.environ.get("GTFS_DB")',
     "to": '    env = os.environ.get("CAMBS_GTFS_DB")'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "the refusal offers regions that have not been built, so the reader is told to pass a --db naming a sqlite file that is not there",
     "find": 'if r.get("status") == "built" and r.get("db")]',
     "to": 'if r.get("db")]'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "the built regions are listed in registry order rather than by name, so the refusal message reads differently every time somebody adds a region",
     "find": 'sorted(regions.items())',
     "to": 'list(regions.items())'},

    # RULE 5 -- `_`-PREFIXED KEYS ARE COMMENTS.
    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "the _example_west_yorkshire stub that documents how to add a region becomes a region, offerable by resolve_db and acceptable as a town's own",
     "find": '    regions = {k: v for k, v in (cfg.get("regions") or {}).items() if not k.startswith("_")}',
     "to": '    regions = dict(cfg.get("regions") or {})'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "a `_comment` entry in town_prefixes.json is planned as though it were a town, so the monthly report carries a section for a line of documentation",
     "find": '        if town.startswith("_"):',
     "to": '        if False:'},

    # RULE 2 -- NO FALLBACK ON THE FEED SIDECAR.
    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "the per-dataset sidecar name loses its suffix, so every region reads the unsuffixed feed_info.json -- which only ever described Cambridgeshire -- and reports another county's build date and validity window as its own",
     "find": '    name = f"feed_info_{os.path.splitext(os.path.basename(db))[0]}.json"',
     "to": '    name = "feed_info.json"'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "feed_info stops guarding against having no dataset at all, so a caller reaching it with an empty registry raises inside the monthly report instead of answering",
     "find": '    if not db:',
     "to": '    if False:'},

    # RULE 3 -- THE PREFIX GUARD, which is what caught Beaconsfield.
    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "the guard passes everything, so a town whose ATCO prefixes cannot occur in its region's dataset is diffed against it anyway and reports every route withdrawn",
     "find": '    if not keep or not pref:',
     "to": '    if True:'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "the guard demands that EVERY prefix match EVERY filter, so a town straddling two areas -- or any town at all in a region keeping two prefixes -- is refused as out of region",
     "find": '    if any(p.startswith(k) for p in pref for k in keep):',
     "to": '    if all(p.startswith(k) for p in pref for k in keep):'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "prefix matching becomes equality, so the ATCO stop codes in a town file -- longer than the filter they start with -- match no region and every town is refused",
     "find": 'if any(p.startswith(k) for p in pref for k in keep):',
     "to": 'if any(p == k for p in pref for k in keep):'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "plan stops consulting the guard, so the registry's word is final and the missing-region-key mistake passes straight through to a wrong-dataset diff",
     "find": '                reason = prefix_mismatch(cfg, name, r)',
     "to": '                reason = None'},

    # RULE 4 -- A TOWN IT CANNOT PLACE IS SKIPPED, NOT GUESSED.
    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "an unregistered region falls back to whichever region happens to be first in the file, so a typo in a town's region key is answered rather than reported",
     "find": '            r = regions.get(name)',
     "to": '            r = regions.get(name) or (list(regions.values())[0] if regions else None)'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "a region whose dataset has never been built is planned anyway, so the month's diff runs against a sqlite file that is not there",
     "find": '            reason = None if os.path.isfile(db) else \\',
     "to": '            reason = None if True else \\'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "a region registered without an explicit db no longer falls back to <region>.sqlite beside the registry, so adding a region the documented short way breaks the plan",
     "find": '            db = r.get("db") or os.path.join(gdir, f"{name}.sqlite")',
     "to": '            db = r.get("db")'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "a town's own region key is ignored in favour of the registry's declared default, which is the Beaconsfield failure arriving through the registry rather than through a missing key",
     "find": '        name = cfg.get("region") or default',
     "to": '        name = cfg.get("region")'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "--db stops overriding the registry, so the single-dataset and testing path starts skipping the very towns it was passed to force through",
     "find": '        if db_override:',
     "to": '        if False:'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "each group loses its provenance, so the report header cannot say which build of which feed the section beneath it came from",
     "find": '"feed": feed_info(gdir, db)',
     "to": '"feed": {}'},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "group order stops following the town list, so the monthly report's sections move about between runs for no reason a reader can see",
     "find": '    return [groups[d] for d in order], skipped',
     "to": '    return [groups[d] for d in reversed(order)], skipped'},

    # THE PROVENANCE LINE.
    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "an unknown build date is printed as a plausible one, so a section whose feed sidecar is missing claims to have been built on a date nobody built it",
     "find": "(g.get('feed') or {}).get('built','?')",
     "to": "(g.get('feed') or {}).get('built','2026-01-01')"},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "the report header carries this laptop's absolute path instead of the dataset's name",
     "find": "os.path.basename(g['db'])",
     "to": "g['db']"},

    {"suite": "test_gtfs_regions.py", "file": "gtfs_regions.py",
     "what": "feed_line stops tolerating a group with no feed key, so one hand-built group raises and takes the whole report with it",
     "find": '    fi = (g.get("feed") or {}).get("feed_info", {})',
     "to": '    fi = g.get("feed").get("feed_info", {})'},

    # ---------------------------------------------------------------- boarding_verify.py
    # THE CHECKER THAT STANDS IN FOR S6 ON EVERY PLACE MAP. Almost every mutation
    # below makes it say LESS, because that is the failure mode a verdict has: a
    # check that has stopped checking prints exactly what a clean sheet prints,
    # and nothing downstream re-asks the question. The sheet it wrongly certifies
    # is perfectly reproducible, so no byte gate, no quality ratchet and no
    # status board can tell the two apart. The three that make it say MORE are
    # here for the other half of the same rule: a soft note that fires on a
    # correct sheet is muted within a week, and then it is not watching the bays.

    # S-1 -- LABEL TRUTH. A letter we invented is worse than no letter: a reader
    # standing in a bus station can only act on a code that is on the flag.
    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "S-1 reads a lettered bay's CommonName instead of its stand code, so every bay in the frame is checked against the name of the bus station and any bay number the sheet invents passes",
     "find": '        if stand:',
     "to": '        if False:'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a bare code loses its 'Stand' word and is expected as 'Bare C', so every authority that puts the code in Indicator with no word in front fails S-1 on a correct sheet",
     "find": '            word = kind.capitalize() if kind and kind != "bare" else "Stand"',
     "to": '            word = kind.capitalize() if kind else "Stand"'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a boarding point NaPTAN has never heard of is downgraded to a note, so the one case where the checker has nothing to compare against stops failing the run",
     "find": '            hard("S-1", "%s: boarding stop %s has no NaPTAN row at all"',
     "to": '            soft("S-1", "%s: boarding stop %s has no NaPTAN row at all"'},

    # S-2 -- DEPARTURE TRUTH, re-derived from stop_times so a bug in the index
    # cannot pass by agreeing with itself.
    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a trip that ARRIVES at a stand from a place counts as departing to it, so a reader is sent to wait at a bay for a bus that only ever terminates there",
     "find": '                for nxt in seq[i + 1:]:',
     "to": '                for nxt in seq:'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "the sheet's own excludeRoutes are ignored, so the checker measures a sheet nobody asked for -- at High Wycombe a school working made one stop look like a better boarding point for three villages the sheet does not claim it serves",
     "find": '        excluded = {str(r) for r in (_bp.get("excludeRoutes") or [])}',
     "to": '        excluded = set()'},

    # THE NAME A PLACE IS PRINTED UNDER. Re-derived here, so a difference of
    # NAMING between this file and the generator must not read as a bus that
    # does not run -- and an over-wide rule must not let a suburb stand for a city.
    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "any child name is accepted as a name for its parent, so the sheet may print 'Kings Hedges' for Cambridge and pass, because a bus does reach Kings Hedges",
     "find": '        return bool(c) and any(_norm(x) == c for x in parts)',
     "to": '        return bool(c)'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "the locality rollup stops at the first parent, so a Cambridge housing estate is the only name S-2 will accept for a bus to Cambridge and the correct sheet is failed",
     "find": '            top = climb((r[2] or "").strip(), parent or child)',
     "to": '            top = (parent or child)'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a locality name carrying two DIFFERENT parents keeps whichever the register listed last, so 'Church End' is moved to whichever village sorted last and the sheet naming it plainly is failed",
     "find": '        if key in parent_of and parent_of[key] != p:',
     "to": '        if False:'},

    # S-3 -- NEVER A LONGER WALK THAN THE SHEET'S OWN ARITHMETIC NEEDS. A SOFT
    # note, and every clause is a widening made after it fired on a correct sheet.
    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a stand with barely more service buys a longer walk, so a reader genuinely sent out of their way is never reported",
     "find": '            bought = (extra_min <= 1 and theirs > 0 and mine > theirs * 3)',
     "to": '            bought = (extra_min <= 1 and theirs > 0 and mine > theirs)'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a stand the SAME walk away is reported as nearer, which is the metres fault that fired seven times at St Neots over six-metre differences the sheet itself prints as one minute",
     "find": '                  if a in by_atco and by_atco[a]["walkMin"] < by_atco[atco]["walkMin"]]',
     "to": '                  if a in by_atco and by_atco[a]["walkMin"] <= by_atco[atco]["walkMin"]]'},

    # S-4 -- THE ONLY CHECK THAT READS THE ARTEFACT. A generator that silently
    # drops rows fails here and nowhere else.
    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "the generator can stop tagging bay glyphs and S-4 goes silently blind -- every remaining assertion then passes over an empty set, which reads exactly like a sheet whose bays are all correct",
     "find": '        if not glyphs and coded:',
     "to": '        if False:'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "no stand in the frame is ever counted as coded, so the blindness question is never asked on a bus station either and a generator that stopped tagging its bays passes",
     "find": '            if why == "stand code":',
     "to": '            if False:'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "the blindness question is asked of a frame with no stand codes, so a correct sheet for a pair of roadside stops fails HARD because there was no bay to tag (OA-371)",
     "find": '        if not glyphs and coded:',
     "to": '        if not glyphs:'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "any abbreviation anywhere on the sheet excuses every missing destination, so a generator that dropped all but one row is green",
     "find": '            if any(t.endswith(".") and name.startswith(t[:-1]) and len(t) > 4 for t in blob):',
     "to": '            if any(t.endswith(".") for t in blob):'},

    # S-5 -- WHICH DAY THE SHEET IS ABOUT (OA-189). A note in both directions,
    # on purpose.
    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a sheet is FAILED by a calendar, which is what gets a checker --no-verify'd -- and then it is not checking the labels either",
     "find": '                soft("S-5", "%s: %s (%s) reaches it only on trips whose registration is not "',
     "to": '                hard("S-5", "%s: %s (%s) reaches it only on trips whose registration is not "'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "an index recording no --asof passes with nothing said, so nobody learns the sheet and the check are describing different sets of registrations",
     "find": '    if asof is None:\n        soft("S-5", "this index records no --asof date',
     "to": '    if False:\n        soft("S-5", "this index records no --asof date'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a service carrying no calendar row at all is treated as EXPIRED rather than live, which turns the safe direction into the unsafe one and notes every trip whose registration the feed happens not to carry",
     "find": '                live = (row is None) or (row[0] in live_sid) or (\n                    db.execute("SELECT 1 FROM calendar WHERE service_id=?", (row[0],)).fetchone() is None)',
     "to": '                live = (row is None) or (row[0] in live_sid)'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a malformed --asof silently becomes no date, so a typo turns the whole check quietly weaker and reports it as a pass",
     "find": '    if asof and (len(asof) != 8 or not asof.isdigit()):',
     "to": '    if False:'},

    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "the durable record says the date came from --asof when it came from the index, so a reader cannot tell a run that was told which day from one that read it off the sheet's own build",
     "find": '        asof_src = "boarding_index.json" if asof else None',
     "to": '        asof_src = "--asof"'},

    # THE EXIT CODE IS WHAT A STAGE GATE READS.
    {"suite": "test_boarding_verify.py", "file": "boarding_verify.py",
     "what": "a sheet with a HARD finding exits 0, so every caller of this checker passes it -- the findings are still printed, to a log nobody reads",
     "find": '    return 1 if hards else 0',
     "to": '    return 0'},

    # ---------------------------------------------------------------- naptan_build.py
    # THE MODULE THAT DECIDES WHAT A STOP IS. Nothing downstream re-derives any of
    # this: `naptan_stands.py`, `boarding_index.py` and `boarding_verify.py` all
    # read the columns it wrote, and `_stubs.py` builds both of its fixtures from
    # its schema. Its output is gitignored and rebuilt by hand a few times a year,
    # so no byte gate, no ratchet and no board has ever had an opinion about it --
    # a wrong register produces perfectly reproducible sheets.

    # THE STAND CODE. "Never fall back to Indicator when stand is NULL: printing
    # 'opp' on a map tells a reader nothing, and inventing a letter is worse than
    # printing none" -- the module's own docstring, and the only rule here whose
    # breach a passenger standing at the stop would see.
    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "derive_stand falls back to the raw Indicator, so every 'opp', 'o/s' and 'N-bound' in the register becomes a stand code and is printed on a boarding sheet as one",
     "find": '        return code, "bare"\n    return None, None',
     "to": '        return code, "bare"\n    return ind.upper(), "indicator"'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the bearing check on a bare code is removed, so a compass bearing that leaked into Indicator is invented as a stand again -- OA-372, reverted",
     "find": '        brg = (bearing or "").strip().upper()\n        if brg and code == brg:\n            return None, None\n        return code, "bare"',
     "to": '        return code, "bare"'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the bare-code pattern gains IGNORECASE, so a lone lower-case letter -- far more often an abbreviation than a flag code -- becomes an invented bay letter",
     "find": 'BARE_RE = re.compile(r"^[A-Z]{1,2}$")',
     "to": 'BARE_RE = re.compile(r"^[A-Z]{1,2}$", re.IGNORECASE)'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "'stance' leaves the word list, so every Scottish-style stance code silently stops being a stand and those stops lose their letter",
     "find": '(stop|stand|bay|gate|platform|stance|berth)',
     "to": '(stop|stand|bay|gate|platform|berth)'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the stand code keeps the feed's own case, so 'Bay 12a' and 'Bay 12A' become two different bays and a sheet matches neither",
     "find": '        return m.group(2).upper(), m.group(1).lower()',
     "to": '        return m.group(2), m.group(1).lower()'},

    # THE POSITION. Every stop on every sheet is drawn at these two numbers.
    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "a published WGS84 pair is recorded as having been converted from the grid, so the provenance column says every position was derived and nobody can tell which half was measured",
     "find": '            return float(lat), float(lon), "naptan"',
     "to": '            return float(lat), float(lon), "osgb"'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "a stop with neither a lat/lon nor a grid reference is placed at 0N 0E -- a real point in the Gulf of Guinea -- instead of being left without a position",
     "find": '    return None, None, None',
     "to": '    return 0.0, 0.0, None'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the converted position is rounded to three decimal places, moving every Cambridgeshire stop by up to 70 metres -- several stops' worth, on a sheet with no reference copy to diff against",
     "find": '            return round(la, 7), round(lo, 7), "osgb"',
     "to": '            return round(la, 3), round(lo, 3), "osgb"'},

    # THE ROWS. What a downloaded CSV becomes once it is in the table.
    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the dedupe is dropped, so a stop appearing in two ATCO areas' downloads is inserted twice and the UNIQUE index at the end aborts the whole build after the last one",
     "find": '        if not atco or atco in seen:',
     "to": '        if not atco:'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "a blank cell is stored as an empty string rather than NULL, so the bearing coverage figure -- which is what says whether a boarding plan can name a direction -- reads 100% for every region",
     "find": '        vals = [(row.get(c) or "").strip() or None for c in COLUMNS]',
     "to": '        vals = [(row.get(c) or "").strip() for c in COLUMNS]'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the area column takes four characters of the ATCO code instead of three, so the register can no longer be joined back to the area request that fetched it",
     "find": 'atco[:3], lat, lon, src',
     "to": 'atco[:4], lat, lon, src'},

    # WHICH AREAS GET FETCHED. What keeps the download at 10 MB rather than 96.
    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "a region that is registered but not built is scanned anyway, so a stale entry can point the area scan at a file that is not a GTFS build",
     "find": '        if r.get("status") != "built":',
     "to": '        if False:'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the `_example_west_yorkshire` comment entry is treated as a region, so the stub documenting how to add one becomes one and the scan opens a dataset nobody has built",
     "find": '        if name.startswith("_"):',
     "to": '        if False:'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "a missing regions.json returns no regions instead of stopping, so the build fetches nothing, writes an empty register over the real one and reports success",
     "find": '        sys.exit(f"regions.json not found at {reg_path} -- pass --root or --areas")',
     "to": '        return []'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the area scan takes four characters of stop_id, so it asks the DfT for areas that do not exist and never asks for the ones our own datasets use",
     "find": '"SELECT substr(stop_id,1,3) a, COUNT(*) n FROM stops GROUP BY 1"',
     "to": '"SELECT substr(stop_id,1,4) a, COUNT(*) n FROM stops GROUP BY 1"'},

    # COVERAGE -- "the number that decides whether a boarding plan is possible at
    # a given place", and the only figure anybody reads off this run.
    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the attached GTFS database is never detached, so the FIRST region reports correctly and every region after it fails -- on this laptop, a report that is right about Cambridgeshire and silent about everywhere else",
     "find": '            con.execute("DETACH DATABASE g")',
     "to": '            pass'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "every matched stop is counted as carrying a stand code, so the coverage table says a boarding plan is possible everywhere and the first one built discovers otherwise",
     "find": '                "WHERE n.stand IS NOT NULL"',
     "to": '                "WHERE 1"'},

    # THE BUILD ITSELF.
    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "areas are fetched alphabetically rather than busiest first, so a run cut off by the 200-per-hour rate limit loses the areas our own maps depend on most",
     "find": '        order = sorted(area_counts, key=lambda a: (-(area_counts.get(a) or 0), a))',
     "to": '        order = sorted(area_counts)'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the ATCOCode index stops being UNIQUE, so a dedupe failure no longer aborts the build -- it ships a register with duplicate stops and every downstream join silently doubles",
     "find": '        "CREATE UNIQUE INDEX ix_naptan_atco ON naptan(ATCOCode)",',
     "to": '        "CREATE INDEX ix_naptan_atco ON naptan(ATCOCode)",'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "an area nobody could download is recorded as fetched with zero rows, so COULD NOT LOOK becomes a measurement and a county nobody could reach looks like a county with no buses",
     "find": '                failed.append(area)',
     "to": '                fetched.append({"area": area, "rows": 0})'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "an existing register is not removed before the rebuild, so a rebuild that should have shrunk the table keeps every row the last one had",
     "find": '        os.remove(out)',
     "to": '        pass'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the provenance timestamp loses its ISO UTC shape, so everything that reads how old the register is -- the board and the refresh report -- gets a string it cannot parse",
     "find": '"builtAt": started.strftime("%Y-%m-%dT%H:%M:%SZ"),',
     "to": '"builtAt": started.strftime("%d/%m/%Y %H:%M"),'},

    {"suite": "test_naptan_build.py", "file": "naptan_build.py",
     "what": "the active-stop count includes the withdrawn rows, so the sidecar overstates the register and a shrinking network reads as a stable one",
     "find": '"SELECT COUNT(*) FROM naptan WHERE Status=\'active\'"',
     "to": '"SELECT COUNT(*) FROM naptan"'},

    # ---------------------------------------------------------------- gtfs_build.py
    # THE OTHER HALF OF THE PAIR `_stubs.py` LOADS. `naptan_build.py` above decides
    # what a STOP is; this one decides what a BUS is, and its `TABLES` is the schema
    # every GTFS fixture in test/python/ is created from. Its output is gitignored
    # and rebuilt by hand when BODS reissues the feed, so no byte gate, ratchet or
    # board has ever had an opinion about it -- and unlike a wrong stand code, a
    # route this filter silently dropped is a bus that never appears on the sheet
    # at all, with nothing on the sheet to say so.

    # THE SCHEMA. What `TABLES` says is what `_stubs.gtfs_db` builds, so the two
    # parting makes every GTFS fixture in this folder a correct assertion about a
    # table the real builder does not make.
    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "`stops` loses `stop_code` from the declared schema, so the real database and every fixture in test/python/ stop having the same shape",
     "find": '    "stops":   ["stop_id","stop_code","stop_name","stop_lat","stop_lon"],',
     "to": '    "stops":   ["stop_id","stop_name","stop_lat","stop_lon"],'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "`shapes` leaves the declared tables, so no route in the estate can be drawn along its own shape and every fixture naming one is rejected",
     "find": '    "shapes": ["shape_id","shape_pt_lat","shape_pt_lon","shape_pt_sequence"],',
     "to": ''},

    # READING THE ZIP. BODS reissues this feed about weekly and pins no column
    # order; nothing anywhere would notice a positional read until a map was drawn.
    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the CSV is read by column POSITION rather than by name, so a feed that reorders its columns puts the latitude in the stop name and draws the whole estate somewhere else",
     "find": '            idx=[hdr.index(c) if c in hdr else None for c in cols]',
     "to": '            idx=[i if i<len(hdr) else None for i,c in enumerate(cols)]'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the short-row guard goes, so one ragged line anywhere in a nine-million-row stop_times kills the whole rebuild",
     "find": 'batch.append(tuple(row[i] if (i is not None and i<len(row)) else None for i in idx))',
     "to": 'batch.append(tuple(row[i] if i is not None else None for i in idx))'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the byte-order mark is no longer stripped, so the first header cell is never matched, every stop_id in the database is NULL, and the dataset joins to nothing",
     "find": '            rd=csv.reader(io.TextIOWrapper(raw,encoding="utf-8-sig")); hdr=next(rd)',
     "to": '            rd=csv.reader(io.TextIOWrapper(raw,encoding="utf-8")); hdr=next(rd)'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "a member the zip does not hold is opened anyway rather than skipped, so a feed shipping no shapes.txt -- which GTFS permits -- dies instead of building",
     "find": '        if fn not in zf.namelist(): print("skip",fn); continue',
     "to": '        if fn not in zf.namelist(): print("skip",fn)'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the stop_times trip index is built on the wrong column, so the filter's join over nine million rows becomes a full scan and the rebuild is abandoned rather than slow",
     "find": '    cur.execute("CREATE INDEX ix_st_trip ON stop_times(trip_id)")',
     "to": '    cur.execute("CREATE INDEX ix_st_trip ON stop_times(stop_sequence)")'},

    # THE FILTER. The file's headline claim, and the one whose breach produces a
    # sheet that is reproducible, gates green, and has lost its terminus.
    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the ATCO prefix match stops being anchored, so every stop id in the country that merely CONTAINS 0500 or 0570 drags its trips into Cambridgeshire's dataset",
     "find": '''    cond=" OR ".join(f"st.stop_id LIKE '{p}%'" for p in prefixes)''',
     "to": '''    cond=" OR ".join(f"st.stop_id LIKE '%{p}%'" for p in prefixes)'''},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "Peterborough leaves the default prefixes, so every route that touches this area only at a 0570 stop vanishes from the dataset the file is named after",
     "find": 'KEEP_PREFIXES = ("0500", "0570")',
     "to": 'KEEP_PREFIXES = ("0500",)'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "only the in-county calls of a kept trip are carried, so every route is truncated at the county boundary and an external sheet -- whose whole job is where the bus GOES -- loses its terminus",
     "find": '    cur.execute("CREATE TABLE stop_times AS SELECT st.* FROM src.stop_times st JOIN keep_trips k ON k.trip_id=st.trip_id")',
     "to": '    cur.execute(f"CREATE TABLE stop_times AS SELECT st.* FROM src.stop_times st JOIN keep_trips k ON k.trip_id=st.trip_id WHERE {cond}")'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "`stops` is filtered by the prefix a second time instead of by what the kept calls reference, so the out-of-county stops a route runs to are absent and every such stop_times row points at nothing",
     "find": '    cur.execute("CREATE TABLE stops AS SELECT * FROM src.stops WHERE stop_id IN (SELECT DISTINCT stop_id FROM stop_times)")',
     "to": '    cur.execute(f"CREATE TABLE stops AS SELECT * FROM src.stops WHERE {cond}".replace("st.stop_id","stop_id"))'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "`routes` stops being filtered, so the dataset carries every route in East Anglia and anything counting routes at a town counts a region",
     "find": '    cur.execute("CREATE TABLE routes AS SELECT * FROM src.routes WHERE route_id IN (SELECT DISTINCT route_id FROM trips)")',
     "to": '    cur.execute("CREATE TABLE routes AS SELECT * FROM src.routes")'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "`agency` stops being filtered, so operators who run nothing here appear in the dataset and can be printed beside a service they do not work",
     "find": '    cur.execute("CREATE TABLE agency AS SELECT * FROM src.agency WHERE agency_id IN (SELECT DISTINCT agency_id FROM routes)")',
     "to": '    cur.execute("CREATE TABLE agency AS SELECT * FROM src.agency")'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "`calendar` stops being filtered, so the dataset carries operating patterns for services it does not hold",
     "find": '    cur.execute("CREATE TABLE calendar AS SELECT * FROM src.calendar WHERE service_id IN (SELECT DISTINCT service_id FROM trips)")',
     "to": '    cur.execute("CREATE TABLE calendar AS SELECT * FROM src.calendar")'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "`calendar_dates` stops being filtered, so the exceptions table carries rules for services the dataset does not hold and a bank-holiday question is answered about the wrong bus",
     "find": '    cur.execute("CREATE TABLE calendar_dates AS SELECT * FROM src.calendar_dates WHERE service_id IN (SELECT DISTINCT service_id FROM trips)")',
     "to": '    cur.execute("CREATE TABLE calendar_dates AS SELECT * FROM src.calendar_dates")'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the empty shape_id stops being excluded, so a trip that carries no shape selects the shapes rows whose id is blank and draws a line to 0N 0E",
     "find": """WHERE s.shape_id IN (SELECT DISTINCT shape_id FROM trips WHERE shape_id IS NOT NULL AND shape_id<>'')""",
     "to": """WHERE s.shape_id IN (SELECT DISTINCT shape_id FROM trips)"""},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "an existing output database is added to rather than replaced, so a table an older version of this script wrote survives every rebuild under a name nothing now drops",
     "find": '    if os.path.exists(out_db): os.remove(out_db)',
     "to": '    if False: os.remove(out_db)'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the working table is left in the output, where a reader cannot tell it from a table the feed ships",
     "find": '    con.commit(); cur.execute("DROP TABLE keep_trips")',
     "to": '    con.commit()'},

    # THE SIDECAR. The only mutation here that restores a fault this project
    # actually shipped: while a bare feed_info.json existed,
    # `gtfs_regions.feed_info()` fell back to it, so every region whose own sidecar
    # was missing reported Cambridgeshire's build date and validity window as its
    # own -- a wrong answer indistinguishable from a right one.
    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the sidecar loses the dataset's name and is written as a bare feed_info.json again, so every region without one reports Cambridgeshire's build date and validity window as its own",
     "find": '    with open(os.path.join(outdir,f"feed_info_{stem}.json"),"w",encoding="utf-8") as fh:',
     "to": '    with open(os.path.join(outdir,"feed_info.json"),"w",encoding="utf-8") as fh:'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the sidecar records the module's default prefixes instead of the ones this build was asked for, so a regional dataset's record says what the code usually does rather than what it did",
     "find": '"keep_prefixes": list(prefixes), "counts": counts,',
     "to": '"keep_prefixes": list(KEEP_PREFIXES), "counts": counts,'},

    {"suite": "test_gtfs_build.py", "file": "gtfs_build.py",
     "what": "the --keep-prefixes list is no longer trimmed, so `0500, 0570` typed with the space a person types silently builds a Cambridgeshire-only dataset under a name that says otherwise",
     "find": '    prefixes=tuple(p.strip() for p in a.keep_prefixes.split(",") if p.strip())',
     "to": '    prefixes=tuple(a.keep_prefixes.split(","))'},
    # ---------------------------------------------------------------- gen_verification.py
    # THE ONE ARTEFACT HERE WHOSE ONLY READER IS A PERSON. This module turns
    # verification.json into the verification.docx that Peter opens, that
    # `stage.js commit S6` mirrors into `_latest/`, and that git tracks. Nothing
    # downstream parses it, so every mutation below produces a document that is
    # well-formed, opens cleanly, and is wrong in a sentence.
    #
    # The first three are the faults the suite was written on, restored verbatim.
    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "an uncurated S1 prints the red BLOCKED banner -- 'hard findings must be resolved' over a run with no hard findings, two lines under a subtitle saying 0 hard",
     "find": '    uncurated = verdict == "not-verified-uncurated-s1"',
     "to": '    uncurated = False'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "a borrowed red team is never named, so the fifteen shipped reports that reached PASS on another map's answer say only 'the stored data is safe to build/rely on'",
     "find": '    if borrowed or uncurated:',
     "to": '    if False:'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "the subtitle prints the routes version raw, so a place map reads 'routes vv1.0' -- the form 24 of the 79 tracked reports carry",
     "find": "_bare_version(inputs.get('routesVersion'))",
     "to": "inputs.get('routesVersion')"},

    # The other direction on the qualification, which is the one that would put
    # the fault back invisibly: a sentence printed on every report is a sentence
    # nobody reads, and the fifteen would be indistinguishable again.
    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "every report is qualified, so the qualification stops meaning anything and an unqualified pass cannot be told from a borrowed one",
     "find": '    if borrowed or uncurated:',
     "to": '    if True:'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "the downgraded HARDs are not counted beside the verdict, so a pass that exists only because a blocking finding was restated reads as an ordinary one",
     "find": '            if downgraded:',
     "to": '            if False:'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "the standing prose claims THIS map's services were re-derived from scratch when the answer was borrowed from another map's",
     "find": '            + ("that map\'s" if borrowed else "the town\'s")',
     "to": '            + "the town\'s"'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "uncuratedS1 is read only through summary.verdict, so the 19 S6 runs on the estate that predate that field lose the qualification entirely",
     "find": '        if data.get("uncuratedS1"):',
     "to": '        if False:'},

    # HARD and the literal word "soft" as two filters rather than a partition.
    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "a finding whose severity is neither word appears in no row, no bullet and no count, and the 'no findings' row that would have looked odd is suppressed with it",
     "find": '    soft = [f for f in findings if f.get("severity") != "hard"]',
     "to": '    soft = [f for f in findings if f.get("severity") == "soft"]'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "_bare_version strips every leading v rather than one, so a version somebody wrote as vv1.0 is silently corrected instead of shown",
     "find": '    return s[1:] if s[:1] in ("v", "V") else s',
     "to": '    return s.lstrip("vV")'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "the findings table is printed in file order, so the blocking ones are scattered among the soft ones in the table a reader scans first",
     "find": '    for f in hard + soft:',
     "to": '    for f in findings:'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "the evidence cell loses its [sanity]/[redteam] tag, so nothing on the row says whether the finding came from our own checks or from the independent pass",
     "find": '        tail = (f"[{srctag}]\\n" if srctag else "") + tail',
     "to": '        tail = tail'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "red-team sources are listed even when no red team ran, so a sanity-checks-only report cites evidence nobody consulted",
     "find": '    if rt and data.get("redteamSources"):',
     "to": '    if data.get("redteamSources"):'},

    # The helper's own comment says what this one is: tblGrid left at the equal
    # widths python-docx created the table with is what headless LibreOffice
    # lays the PDF out from, whatever the cells say.
    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "tblGrid is left at equal widths, so the PDF crams Finding and Evidence against the three short code columns",
     "find": '    for gridcol, w in zip(grid.findall(qn("w:gridCol")), widths):',
     "to": '    for gridcol, w in zip([], widths):'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "the default output is a bare filename, so a report written with no out path lands in whatever directory the caller happened to be standing in rather than beside its run",
     "find": '        out = os.path.join(os.path.dirname(os.path.abspath(src)), "verification.docx")',
     "to": '        out = "verification.docx"'},

    {"suite": "test_gen_verification.py", "file": "gen_verification.py",
     "what": "the created date is left at python-docx's 2013-12-23 template default, which Explorer shows and a reader takes for the date of the check",
     "find": '    doc.core_properties.created = _now',
     "to": '    _now = _now'},

    # ---------------------------------------------------------------- gen_disagreements.py
    # THE SECOND ARTEFACT HERE WHOSE ONLY READER IS A PERSON, and the one the
    # block above named as still uncovered. This module turns a stage's
    # disagreements.json into the disagreements.docx that git tracks and that
    # nothing downstream parses. The first three mutations are the faults the
    # suite was written on, restored verbatim -- all three had SHIPPED, measured
    # over 49 committed audits and 1,441 rows on 2026-09-16.
    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "the audit's own note is dropped, so 20 committed audits say which routes were actually re-checked this round and none of their documents does",
     "find": '    note = (data.get("note") or "").strip()',
     "to": '    note = ""'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "a clarification on an agreeing row is thrown away -- the 107 notes across 27 audits, including the two March's own note points the reader at",
     "find": '        if agree and res in PLACEHOLDER_RESOLUTIONS:',
     "to": '        if agree:'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "sources are read by their two known names, so the press article that is the evidence for the High Wycombe route 20 exclusion is cited nowhere",
     "find": '        for key in SOURCE_ORDER + sorted(k for k in srcs if k not in SOURCE_ORDER):',
     "to": '        for key in SOURCE_ORDER:'},

    # The other direction on each of the first two, which is the direction that
    # would put the fault back invisibly: a qualification printed on every
    # report is one nobody reads, and a column of dashes is how a real
    # clarification stops being noticed.
    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "every audit is given a Note line whether or not it has one, so the 20 that carry a real qualification stop being distinguishable",
     "find": '    if note:',
     "to": '    if True:'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "the placeholder dash is printed on agreeing rows too, so 1,334 rows gain a dash and the 107 real clarifications are lost in it",
     "find": '        if agree and res in PLACEHOLDER_RESOLUTIONS:',
     "to": '        if agree and res in ():'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "the settled bustimes-then-operator order becomes whatever sorting gives, so every row in every audit reorders around an unknown key",
     "find": '        for key in SOURCE_ORDER + sorted(k for k in srcs if k not in SOURCE_ORDER):',
     "to": '        for key in sorted(srcs, reverse=True):'},

    # An audit with no rows has not found agreement; it has found nothing.
    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "an audit with no rows reports that every operator site agreed, which is the absence of checks printed as a clean result",
     "find": '    elif rows:',
     "to": '    elif True:'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "a row that says nothing about agreement is silently counted as agreeing, so an unrecorded check prints green",
     "find": '        agree = bool(r.get("agree", False))',
     "to": '        agree = bool(r.get("agree", True))'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "the conflict set is inverted, so the subtitle's disagreement count and the summary bullets describe the rows that agree",
     "find": '    conflicts = [r for r in rows if not r.get("agree", False)]',
     "to": '    conflicts = [r for r in rows if r.get("agree", False)]'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "every row says agree, so a disagreement is invisible in the one column a reader scans",
     "find": '        set_cell(cells[5], "agree" if agree else "DISAGREE", bold=not agree, size=9,',
     "to": '        set_cell(cells[5], "agree", bold=not agree, size=9,'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "the red and green fills are swapped, so a 60-row table points the eye at every row except the conflicts",
     "find": '        fill = AGREE_FILL if agree else CONFLICT_FILL',
     "to": '        fill = CONFLICT_FILL if agree else AGREE_FILL'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "no row is shaded at all, so the document loses the only signal that finds a conflict without reading every cell",
     "find": '            shade(c, fill)',
     "to": '            pass'},

    # The helper's own comment says what this one is, and it is the sibling's
    # mutation in this file: tblGrid left at the equal widths python-docx made
    # the table with is what headless LibreOffice lays the customer PDF out from.
    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "tblGrid is left at equal widths, so the PDF crams the resolution and both URLs into the same width as the route code",
     "find": '    for gridcol, w in zip(grid.findall(qn("w:gridCol")), widths):',
     "to": '    for gridcol, w in zip([], widths):'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "the default output is a bare filename, so an audit written with no out path lands in whatever directory the stage engine was standing in",
     "find": '        os.path.dirname(os.path.abspath(src)), "disagreements.docx")',
     "to": '        "", "disagreements.docx")'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "the created date is left at python-docx's 2013-12-23 template default, which Explorer shows and a reader takes for the date of the audit",
     "find": '    doc.core_properties.created = _now',
     "to": '    _now = _now'},

    {"suite": "test_gen_disagreements.py", "file": "gen_disagreements.py",
     "what": "no PDF is asked for, so the customer-facing copy silently stays at whatever the last run left beside the docx",
     "find": '    convert_to_pdf(out)',
     "to": '    pass'},

    # ---------------------------------------------------------------- draft_town.py
    # The first four are the 2026-08-28 public report as mutations: a member of
    # the public found Whittlesey on Ramsey's published X31 spoke, because
    # Nominatim at zoom=14 answers town=Whittlesey for Pondersbridge, Turves,
    # Coates and Eastrea alike. Nothing in this estate can see that fault -- the
    # sheet reproduces byte-for-byte for ever and every gate is green over it.
    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "PlaceNamer.name reverse-geocodes before consulting NaPTAN, which is the ordering that put Whittlesey on a published sheet",
     "find": '        loc, _parent = self.locality(stop_id)\n        if loc:\n            return loc, True                  # NaPTAN is authoritative; no call needed',
     "to": '        loc, _parent = self.locality(stop_id)\n        if False:\n            return loc, True                  # NaPTAN is authoritative; no call needed'},

    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "in_town folds the town's own outlying parts in, which re-creates the fault it replaced: Ramsey Heights then sits after Bury and Wistow and both villages are thrown off the spoke",
     "find": '        loc, _par = self.locality(stop_id)\n        if not loc:\n            return None                       # unknown -- caller keeps the old test\n        return loc == town',
     "to": '        loc, _par = self.locality(stop_id)\n        if not loc:\n            return None                       # unknown -- caller keeps the old test\n        return loc == town or self.locality(stop_id)[1] == town'},

    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "of_town asks the NAME instead of NaPTAN's parent, so Ramsey End -- which belongs to Warboys -- is swallowed as one of Ramsey's own edges",
     "find": '        loc, par = self.locality(stop_id)\n        return bool(loc) and par == town and loc != town',
     "to": '        loc, par = self.locality(stop_id)\n        return bool(loc) and loc.startswith(town) and loc != town'},

    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "a district in Nominatim's city slot is accepted, so a rural stop between Ramsey and Warboys is labelled Huntingdonshire",
     "find": '            if v and not self.ADMIN.search(v):',
     "to": '            if v:'},

    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "suburb outranks town, which turned Peterborough's Queensgate into Millfield and Huntingdon bus station into Hartford",
     "find": '    SETTLEMENT = ("town", "village", "city", "suburb", "hamlet")',
     "to": '    SETTLEMENT = ("suburb", "town", "village", "city", "hamlet")'},

    # The spoke's own three rules. Each decides what a rider reads at the end of
    # a printed line, and none of them is reachable from any gate in the estate.
    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "the spoke is labelled by the last NEW name rather than by where the chain ends, so Hartford -> Huntingdon -> Newtown -> Huntingdon reads as a bus to Newtown",
     "find": '    if term in places:\n        places = [p for p in places if p != term] + [term]',
     "to": '    if False:\n        places = [p for p in places if p != term] + [term]'},

    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "the terminus stops absorbing its own suburbs, so a spoke naming Stanground and Fletton before Peterborough reads as three separate destinations",
     "find": '    if len(places) > 1:\n        places = [p for p in places[:-1] if parents.get(p) != places[-1]] + [places[-1]]',
     "to": '    if False:\n        places = [p for p in places[:-1] if parents.get(p) != places[-1]] + [places[-1]]'},

    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "the intermediates are never thinned, so the ten hamlets between Ramsey and St Ives overflow the spoke and collide with its neighbour",
     "find": '    if len(places) > MAX_INTERMEDIATE + 1:',
     "to": '    if False:'},

    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "colliding spokes are left where they are, so Ramsey's 303 and 305 -- both Huntingdon, both bearing 201 -- print as one unreadable stack",
     "find": '            if gap < min_gap:',
     "to": '            if gap < 0:'},

    # The two that are not about the artwork at all.
    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "an unattended Tier-2 draft writes verified: true, so a route BODS alone declared is indistinguishable from one a person checked against the operator's own timetable",
     "find": '    verified = [{**s, "verified": False,',
     "to": '    verified = [{**s, "verified": True,'},

    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "km_between drops the cos(lat) term, so every east-west distance on the draft -- the 1 km 'never leaves town' floor included -- is overstated by 62% at this latitude",
     "find": '    a = math.sin(dla / 2) ** 2 + math.cos(math.radians(la1)) * math.cos(math.radians(la2)) * math.sin(dlo / 2) ** 2',
     "to": '    a = math.sin(dla / 2) ** 2 + math.sin(dlo / 2) ** 2'},

    # ---------------------------------------------------------------- scaffold_town.py
    # The one module that runs BEFORE every human gate in the pipeline, once per
    # town, from a person's hand. Its output is what the S1 reviewer reviews, so
    # a fault here arrives disguised as the starting position rather than as a
    # fault, and no byte gate can see it because it draws nothing.
    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "`stage.js new` no longer runs inside the town folder, so it walks up from the engine's own cwd and the S1 run lands in whichever map it finds first",
     "find": '    s1=run([node, stage, "new", "S1"], cwd=town_dir)',
     "to": '    s1=run([node, stage, "new", "S1"])'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "a failing subprocess is ignored, so the scaffold finishes and writes a review checklist for a run that has no service facts in it",
     "find": '    if p.returncode!=0:',
     "to": '    if p.returncode<0:'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "the failing command's own stdout and stderr are dropped, leaving the reader `command failed: node .../stage.js new S1` and nothing to act on",
     "find": '        sys.stderr.write(p.stdout+"\\n"+p.stderr+"\\n"); raise SystemExit(f"command failed: {\' \'.join(cmd)}")',
     "to": '        raise SystemExit(f"command failed: {\' \'.join(cmd)}")'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "`--centre` is never passed on, so a town the geocoder places wrongly is scaffolded there and the person who supplied the coordinates is not told they were dropped",
     "find": '    if a.centre: boot += ["--centre", a.centre]',
     "to": '    if False: boot += ["--centre", a.centre]'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "gtfs_query is asked for the TOWN NAME rather than the ATCO prefix the bootstrap derived, which matches no stop and produces an empty, plausible service set",
     "find": '        run([py, os.path.join(HERE,"gtfs_query.py"), prefix, "--town", a.town,',
     "to": '        run([py, os.path.join(HERE,"gtfs_query.py"), a.town, "--town", a.town,'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "a town with no ATCO prefix is registered anyway, so the monthly refresh joins on nothing and reports every one of its routes as withdrawn -- the Beaconsfield month, from a different direction",
     "find": '        if a.town not in tp and prefix:',
     "to": '        if a.town not in tp:'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "a town already in town_prefixes.json is overwritten, destroying a hand-set region or a second prefix that this run's single derived one cannot know about",
     "find": '        if a.town not in tp and prefix:',
     "to": '        if prefix:'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "`region` is written on every town including the default region's own, so the field stops distinguishing the towns the monthly refresh must treat specially",
     "find": '            if match and match[0]!=default:',
     "to": '            if match:'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "a dataset registered in no regions.json is registered silently, which is exactly how Beaconsfield spent a month being diffed against Cambridgeshire",
     "find": '            elif not match:',
     "to": '            elif False:'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "the registry is never written, so the scaffold prints `registered <town>` about a file it did not change",
     "find": '            json.dump(tp,open(tp_path,"w",encoding="utf-8"),indent=1,ensure_ascii=False)',
     "to": '            pass'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "the review checklist is written under a different name, so the path the run prints is not the file it wrote",
     "find": '    nxt=os.path.join(s1,"SCAFFOLD-NEXT.md")',
     "to": '    nxt=os.path.join(s1,"NEXT.md")'},

    # The last two restore what the module did BEFORE 2026-09-17 rather than
    # inventing a fault. A fix is only held by a suite if the suite has been seen
    # to go red against the code it replaced.
    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "a bootstrap that found no ATCO prefix goes back to saying nothing at all, so the run exits 0 without the gtfs-services.json the S1 review gate exists to review",
     "find": '''        print(f"  WARNING: bootstrap found no atcoPrefix for {a.town}, so "
              f"gtfs-services.json was NOT pulled. Check routes.draft.json, then run "
              f"gtfs_query.py by hand before reviewing S1.")''',
     "to": '        pass'},

    {"suite": "test_scaffold_town.py", "file": "scaffold_town.py",
     "what": "the registration message goes back to `(or no prefix)`, so a town that COULD NOT be registered prints the sentence a town needing nothing prints",
     "find": '''        elif a.town in tp:
            print(f"{a.town} already in town_prefixes.json - left as it stands")
        else:
            # The other half of the same conflation: nothing was registered, and the
            # reason is the missing prefix rather than a row that already existed.
            print(f"NOT registered: {a.town} has no atcoPrefix, so the monthly refresh "
                  f"cannot check this town until one is added by hand")''',
     "to": '''        else:
            print(f"{a.town} already in town_prefixes.json (or no prefix)")'''},

    # ---------------------------------------------------------------- bootstrap_town.py
    # The module scaffold_town.py shells out to, and where the derivation
    # actually happens: the ATCO prefix the town is registered under, the anchor
    # the internal sheet is centred on, the draft spokes and the candidate linear
    # features. It runs before S1's human gate, so there is nothing yet to
    # compare its output against and no gate downstream can see a fault in it.
    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "the haversine loses its factor of two, so every distance is half what it is -- a far stop reads as in-town and the draft spokes are drawn to the wrong places",
     "find": '    return 6371*2*math.asin(math.sqrt(a))',
     "to": '    return 6371*math.asin(math.sqrt(a))'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "the bearing's longitude difference is taken backwards, so every draft external spoke is mirrored east-for-west around the anchor",
     "find": '    y=math.sin(math.radians(lo2-lo1))*math.cos(math.radians(la2))',
     "to": '    y=math.sin(math.radians(lo1-lo2))*math.cos(math.radians(la2))'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "the radius test is inverted, so the town's stops are exactly the ones NOT in the town and the prefix, anchor and services all come from somewhere else",
     "find": '            if _km(lat,lon,float(la),float(lo))<=km: out.append((sid,nm,float(la),float(lo)))',
     "to": '            if _km(lat,lon,float(la),float(lo))>=km: out.append((sid,nm,float(la),float(lo)))'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "the 9-char block is counted over ALL stops again rather than within the dominant ATCO area -- the pre-region-agnostic rule, under which a town whose radius clips a neighbouring county can be registered under the neighbour's prefix",
     "find": '    c=Counter(s[0][:9] for s in stops if s[0].startswith(top_area))',
     "to": '    c=Counter(s[0][:9] for s in stops)'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "every 9-char block is kept however few stops it holds, so one stray stop from the next locality is registered as one of the town's prefixes and the monthly refresh diffs against it for ever",
     "find": '    tot=sum(c.values()); keep=[p for p,n in c.most_common() if n/tot>=0.12]',
     "to": '    tot=sum(c.values()); keep=[p for p,n in c.most_common() if n/tot>=0.0]'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "a stop merely NAMED like a bus station becomes the anchor however few routes call there, so a one-route layby outranks the real interchange and the whole internal sheet is centred on it",
     "find": '    named=[(sid,n) for sid,n in rows if STN.search(nm_by.get(sid,"") or "") and n>=max(2,nmax*0.5)]',
     "to": '    named=[(sid,n) for sid,n in rows if STN.search(nm_by.get(sid,"") or "")]'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "the anchor candidates are ordered quietest-first, so the fallback picks the least-served stop in town and `nmax` -- which the naming gate is measured against -- becomes the minimum",
     "find": '        WHERE st.stop_id IN ({ph}) GROUP BY st.stop_id ORDER BY n DESC""", ids).fetchall()',
     "to": '        WHERE st.stop_id IN ({ph}) GROUP BY st.stop_id ORDER BY n ASC""", ids).fetchall()'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "the draft spoke is taken from trips that do NOT call in the town, so a route passing nearby gets an external spoke drawn for it and the reviewer is shown a destination this town cannot reach",
     "find": '        WHERE t.route_id IN ({ph}) AND st.stop_id IN ({tph}) LIMIT 40""", route_ids+town_ids)]',
     "to": '        WHERE t.route_id IN ({ph}) AND st.stop_id NOT IN ({tph}) LIMIT 40""", route_ids+town_ids)]'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "the spoke keeps the NEAREST stop instead of the farthest, so every external radial is seeded with the stop next to the bus station",
     "find": '            if not far or d>far[0]: far=(d,nm,float(la),float(lo))',
     "to": '            if not far or d<far[0]: far=(d,nm,float(la),float(lo))'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "more than six candidate features are reported, so the draft's `features[]` takes three from an unranked tail rather than from the top of the ranking",
     "find": '    return ranked[:6], True',
     "to": '    return ranked, True'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "a colour in LIGHT names no colour the palette can assign, so that route prints white badge text on a pale badge and nothing anywhere objects",
     "find": 'LIGHT={"#CCBB44","#66CCEE","#BBBBBB","#EE7733"}',
     "to": 'LIGHT={"#CCBB44","#66CCEE","#BBBBBB","#EE7734"}'},

    # The last three restore what the module did BEFORE 2026-09-17 rather than
    # inventing a fault. A fix is only held by a suite if the suite has been seen
    # to go red against the code it replaced.
    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "both Overpass endpoints failing goes back to reporting as though OSM had answered, so an unasked question is indistinguishable from a town with no river in it",
     "find": '    except overpass_fetch.OverpassUnreachable: return [], False',
     "to": '    except overpass_fetch.OverpassUnreachable: return [], True'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "a successful Overpass read reports as unreachable, which is the same conflation pointing the other way -- every town would carry the COULD NOT LOOK sentence and the reviewer would stop reading it",
     "find": '    return ranked[:6], True',
     "to": '    return ranked[:6], False'},

    {"suite": "test_bootstrap_town.py", "file": "bootstrap_town.py",
     "what": "the refusal loses its own sentence and falls through to the absence's, which is `- (none found / skipped)` restored in everything but wording",
     "find": '''    if state=="refused":
        return ("- COULD NOT LOOK: every Overpass try failed, so OSM has NOT been asked "
                "-- a refusal, not an absence. Re-run before treating an empty features[] as "
                "a finding about this town.")''',
     "to": '''    if False:
        return ""'''},

    # ---------------------------------------------------------------- overpass_fetch.py
    # OA-339. The first restores what draft_town.py did before 2026-09-23: a pull
    # that never got an answer is stored as an empty one, which on disk is a town
    # with no river. The rest are the three rules the module's docstring names.
    {"suite": "test_overpass_fetch.py", "file": "overpass_fetch.py",
     "what": "every try failing returns an empty answer instead of raising, so a bad afternoon is stored as `this town has no river`",
     "find": '    raise OverpassUnreachable("%s: no Overpass host answered in %d tries; last: %s" % (label, tries, last))',
     "to": '    return {"elements": []}'},

    {"suite": "test_overpass_fetch.py", "file": "overpass_fetch.py",
     "what": "one try and no retry, which is the rate that lost seven towns in eight on 2026-09-13",
     "find": '    for n in range(1, tries + 1):',
     "to": '    for n in range(1, 2):'},

    {"suite": "test_overpass_fetch.py", "file": "overpass_fetch.py",
     "what": "only the first host is ever tried, so the fallback that exists because that host is regularly busy is gone",
     "find": '        host = hosts[(n - 1) % len(hosts)]',
     "to": '        host = hosts[0]'},

    {"suite": "test_overpass_fetch.py", "file": "overpass_fetch.py",
     "what": "a 200 whose remark says the query timed out is taken as the answer, so a half-collected reply is stored as the whole one",
     "find": '            if remark:',
     "to": '            if False:'},

    {"suite": "test_draft_town.py", "file": "draft_town.py",
     "what": "draft_town writes an empty osm.json when Overpass never answered, which is the OA-339 fault restored at its original call site",
     "find": '''        raise SystemExit(f"{exc}\\n{dest} was NOT written: an unanswered question is not "
                         f"an empty answer. Re-run when Overpass is answering.")''',
     "to": '''        d = {"elements": []}'''},

    # ---------------------------------------------------------------- refresh_town.py
    # OA-457. The one module a scheduled tick runs with nobody watching, and every
    # refusal in it is raised from `main()`, which `prove-red-refresh-town.py` does not
    # drive. Each edit below turns one refusal off; the fault it restores is a patched
    # service list committed over sheets that say something else, or committed at all
    # for a town a person should have looked at.
    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "a town with no Areas folder is not refused, so a new town is 'refreshed' instead of drafted",
     "find": "    if not os.path.isdir(town_dir):",
     "to": "    if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "a town the scan could not check is reported as unknown rather than as not checked, so the remedy named is the wrong one",
     "find": "    for name, reason in skipped:",
     "to": "    for name, reason in []:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "a town with no shipped service list is not refused, so the refresh dies somewhere later with a stack trace",
     "find": "    if d is None:",
     "to": "    if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "an ESCALATE town is applied as if SAFE, so a new route or a changed line is committed with no person looking",
     "find": '    if grade != "SAFE":',
     "to": '    if grade not in ("SAFE", "ESCALATE"):'},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "the board's grade is trusted rather than cross-checked, so a row graded ESCALATE on scan day is applied today",
     "find": '        if said.get("grade") != "SAFE":',
     "to": "        if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "a town the scan could not check is applied anyway, with no grading behind it",
     "find": '    elif status == "not-checked":',
     "to": "    elif False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "a person's wording in routes.json no longer stops the run, so the service list and the sheet disagree",
     "find": "    if conflicts:",
     "to": "    if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "files that already carry the feed's values are rebuilt anyway, so a refresh with nothing to write mints a new version",
     "find": "    if not vs_touched and not rj_touched:",
     "to": "    if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "the dry run writes, so looking at a refresh is the same as doing it",
     "find": "    if not a.apply:",
     "to": "    if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "S1 is committed before the sheets are built -- the order this module was first written in, which left Ramsey's data and sheets disagreeing",
     "find": '    stage(town_dir, "stamps", s4)',
     "to": '    stage(town_dir, "commit", "S1", "too-early")\n    stage(town_dir, "stamps", s4)'},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "blocking build warnings are reported as a generic build failure, so the refusal no longer names build-warnings.txt",
     "find": "    if built.returncode == 3:",
     "to": "    if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "a sheet the label diff could not read counts as a sheet with no changed labels",
     "find": '        if d2["missing"]:',
     "to": "        if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "a label the patch does not explain no longer stops the run, which is the one gate between a SAFE refresh and a changed sheet",
     "find": "    if unexplained:",
     "to": "    if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "when the engine has moved the refusal no longer says so, so an engine change reads as a mystery about the feed",
     "find": '        if result["engine"]["moved"]:',
     "to": "        if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "a sheet that failed to render is left out of a committed S5, so the map is one sheet short with nothing red",
     "find": "    if failed:",
     "to": "    if False:"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "--by is dropped, so a tick's stage records name nobody",
     "find": '    return ["--by", str(who)] if who else []',
     "to": "    return []"},

    {"suite": "test_refresh_town.py", "file": "refresh_town.py",
     "what": "S4 is committed without --based-on, so a later rollout cannot see that its data moved (OA-225)",
     "find": '"--based-on", "S2=%s;S3=%s" % (s2_latest, os.path.basename(s3))',
     "to": '"--note", note'},

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
