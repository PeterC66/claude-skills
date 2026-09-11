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

    # ---------------------------------------------------------------- the load test
    # The cheapest check there is, and the one that was missing for a year. This
    # is the `gen_external_busway.js` shape in Python: a module nothing on the
    # monthly path imports until the monthly path runs.
    {"suite": "test_module_load.py", "file": "prune_runs.py",
     "what": "a module's import is renamed and nothing that runs daily touches it, so it throws at load for as long as nobody prunes",
     "find": "import cli   # OA-224 Tier 3.1: --root, then BUSES_DIR, then the laptop",
     "to": "import cli_renamed_by_a_refactor   # OA-224 Tier 3.1"},
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
