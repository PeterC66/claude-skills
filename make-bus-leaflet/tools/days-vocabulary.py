#!/usr/bin/env python3
"""days-vocabulary.py -- every distinct `days` string the estate ships, and what
`gtfs_refresh_report.parse_days` makes of each one.

Run it from the buses-data repository root (`C:\\u3a St Ives\\Using AI\\Buses`),
with no arguments and no placeholders:

    python "C:/u3a St Ives/.claude/skills/make-bus-leaflet/tools/days-vocabulary.py"

Pass `--root "<some other Buses folder>"` to read a different estate.

WHY IT EXISTS. `parse_days` turns prose a person typed into a set of weekdays, and
its only caller prints [DAYS] when that set differs from the feed's. So the
function's real specification is not a grammar anybody designed -- it is the
sixteen strings eight towns and twelve places actually wrote, and that list is
somewhere this engine cannot see: the estate is a different repository, private,
and not checked out where the unit suite runs. `test/python/test_gtfs_refresh_report.py`
therefore carries those strings as a FIXTURE, which is the shape this project has
a name for (*the fixture written by the parser's author*, in the failure-shapes
list) -- a fixture is only as honest as its last measurement.

This is that measurement, as a command rather than as a paragraph. Run it when a
town file gains a service, and reconcile what it prints against the fixture list
in that test file. A string this prints as NOT COMPARABLE is not necessarily
wrong -- "Limited (pre-book)" should be exactly that -- but a string whose answer
looks nothing like its prose is the fault of 2026-09-15 recurring.

It reads only, writes nothing, and needs no database.
"""
import argparse
import collections
import glob
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def load_report_module():
    """Import the engine's own copy, by path, so this cannot drift from it."""
    path = os.path.join(ASSETS, "gtfs_refresh_report.py")
    spec = importlib.util.spec_from_file_location("days_vocabulary_subject", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    saved = sys.path[:]
    sys.path.insert(0, ASSETS)
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.path[:] = saved
    return mod


def shipped_days(root):
    """-> (Counter of `days` strings, towns read, map folders that had none).

    LATEST RUN ONLY, because that is the run every reader reads: `latest_verified`
    picks the last dated S1 folder and the monthly report diffs against that
    alone. A superseded run is a dated record, and counting one reports vocabulary
    the estate stopped using -- which is how the first draft of this measurement
    came out at 528 services over 20 maps when the answer is 104 over 8.

    THE THIRD RETURN VALUE IS THE POINT OF THE THIRD RETURN VALUE. `Places/*/*`
    is walked and every place is expected to come back empty: a place's S1 writes
    `place.json` and carries no `services` at all, because its buses are the
    parent town's. Counting the silence as nothing to see would make this
    measurement unable to tell "places ship no day strings" from "the glob missed
    them", and *the refusal read as an absence* is a named shape here.
    """
    counts = collections.Counter()
    maps = sorted(glob.glob(os.path.join(root, "Areas", "*"))
                  + glob.glob(os.path.join(root, "Places", "*", "*")))
    read, silent = 0, []
    for d in maps:
        if not os.path.isdir(d):
            continue
        runs = sorted(glob.glob(os.path.join(d, "S1-services", "*", "verified-services.json")))
        if not runs:
            silent.append(os.path.relpath(d, root))
            continue
        read += 1
        try:
            vs = json.load(open(runs[-1], encoding="utf-8"))
        except (OSError, ValueError) as e:
            print("  could not read %s: %s" % (runs[-1], e), file=sys.stderr)
            continue
        for s in vs.get("services", []) or []:
            d2 = s.get("days")
            if d2:
                counts[str(d2)] += 1
    return counts, read, silent


def spell(dayset):
    if dayset is None:
        return "NOT COMPARABLE"
    if not dayset:
        return "EMPTY SET"
    return " ".join(DOW[i] for i in sorted(dayset))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.getcwd(),
                    help="the Buses folder to read (default: the current directory)")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    if not os.path.isdir(os.path.join(root, "Areas")):
        print("no Areas/ under %s -- run this from the buses-data repository root, "
              "or pass --root" % root, file=sys.stderr)
        return 2
    rr = load_report_module()
    counts, read, silent = shipped_days(root)
    if not counts:
        print("no shipped `days` strings found under %s" % root, file=sys.stderr)
        return 1
    width = max(len(k) for k in counts)
    print("%d map folder(s) carry a shipped service list - %d service(s) with a "
          "`days` string - %d distinct" % (read, sum(counts.values()), len(counts)))
    print("")
    for text, n in counts.most_common():
        print("  %4d  %-*s  ->  %s" % (n, width, text, spell(rr.parse_days(text))))
    print("")
    print("Read each line as a claim about a bus: the right-hand side is the week "
          "the monthly report will compare against the feed.")
    if silent:
        print("")
        print("%d map folder(s) carry no `verified-services.json` and were NOT read. "
              "A place is expected here -- its S1 writes place.json and its buses are "
              "the parent town's -- so a TOWN in this list is the finding:" % len(silent))
        for d in silent:
            print("  %s" % d)
    return 0


if __name__ == "__main__":
    sys.exit(main())
