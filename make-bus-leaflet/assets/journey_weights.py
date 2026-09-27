#!/usr/bin/env python3
"""S2 helper -- weigh each drawn stop by the journeys that call at it (buses-data OA-452).

WHY. `pull_routes_full.js` stores a direction as the stop rows of bustimes'
timetable grid, which is the UNION of every stop any journey calls at on the
pulled dates, and `derive_intown.js` clipped that union to the town without ever
asking how many buses call at each stop. So a loop three journeys a day run was
drawn as the route: St Neots' 18 westbound ran by the station (Railway Station,
Eagle Court, Heron Court, Princes Drive) on the sheet on the Loves Way shelter,
while 36 journeys go direct and 3 take the loop. High Wycombe's 32 drew the 32A's
Hennerton Way loop, which no 32 journey runs. Peter's ruling of 2026-09-25: the
engine draws each direction from the stop pattern MOST journeys run, and names
the minority workings.

WHAT IT DROPS, AND WHAT IT DELIBERATELY DOES NOT. A stop is dropped only when it
is a DEVIATION: of the journeys that PASS it -- call at a chain stop before it
and a chain stop after it -- fewer than `--share` (default a half) call at it,
and at least `--min-passing` journeys pass. A stop beyond the point where most
journeys END is not a deviation and is kept: a short working is not a detour, and
dropping the stops past it would move a terminus, which is a different decision
from taking a loop off a line. A stop the GTFS does not know at all is kept and
listed as `unknown`, because a feed that has never heard of a stop is not
evidence that buses skip it (High Wycombe's White Close is on the 29's path and
absent from the BODS stops table).

Journeys are GTFS trips of the route's number that call at two or more stops of
one of its drawn directions, each assigned to the direction whose stop order its
calls follow. A trip is one timetabled working, not one per operating day.

Usage, from the S2 folder of the town, with no placeholders beyond the two below:

    python "<engine>/assets/journey_weights.py" routes_full_atco.json --db "<sqlite>" --out journey_weights.json

`<engine>` is the make-bus-leaflet folder; `<sqlite>` is the region's GTFS
database under `<buses-root>/_gtfs/`, and several may be given comma-separated
for a town on a region boundary. `derive_intown.js` reads `journey_weights.json`
from beside `routes_full_atco.json` when it is there; an S2 folder without one
derives exactly as before.

NAMING THE MINORITY WORKINGS. Each minority run also carries `localities`, the
NaPTAN locality of its stops in chain order with repeats removed ("Caxton",
"Longstowe", ... "Eynesbury"), read from `naptan.sqlite` -- by default the one
beside the first `--db`, which is where `_gtfs/` keeps it; `--naptan ""` turns
it off. `minority_note.js` turns those into the Services panel's "some journeys
via ..." (buses-data OA-452 item 1), because a stop name alone ("Fox Road") says
nothing to a reader about where the bus goes.

Exit 0 on success, 2 on a usage or input fault (references/conventions.md).
"""
import argparse
import json
import os
import sqlite3
import sys

SHARE = 0.5
MIN_PASSING = 3


def assign(directions, calls):
    """The index of the direction whose stop order `calls` follows, or None.

    A trip belongs to the direction it shares at least two stops with in
    ascending chain order; the most ascending steps wins, and a trip that runs
    against every chain is nobody's.
    """
    best, best_up = None, 0
    for i, chain in enumerate(directions):
        pos = {a: k for k, a in enumerate(chain)}
        idx = [pos[a] for a in calls if a in pos]
        up = sum(1 for x, y in zip(idx, idx[1:]) if y > x)
        down = sum(1 for x, y in zip(idx, idx[1:]) if y < x)
        if len(idx) >= 2 and up > down and up > best_up:
            best, best_up = i, up
    return best


def classify(chain, trips, known, share=SHARE, min_passing=MIN_PASSING):
    """Weigh every stop of one drawn direction by the trips assigned to it.

    `trips` is a list of stop-id lists; `known` the set of stop ids the feed has.
    Returns passing and calling counts per stop, the stops to drop, the minority
    workings (runs of adjacent dropped stops) and the stops the feed does not know.
    """
    pos = {a: k for k, a in enumerate(chain)}
    passing = {a: 0 for a in chain}
    calling = {a: 0 for a in chain}
    for calls in trips:
        idx = sorted(pos[a] for a in set(calls) if a in pos)
        if not idx:
            continue
        lo, hi = idx[0], idx[-1]
        at = set(idx)
        for k in range(lo, hi + 1):
            passing[chain[k]] += 1
            if k in at:
                calling[chain[k]] += 1
    drop = [a for a in chain
            if a in known and passing[a] >= min_passing and calling[a] < share * passing[a]]
    minority, run = [], []
    for a in chain + [None]:
        if a is not None and a in drop:
            run.append(a)
            continue
        if run:
            minority.append({"stops": run,
                             "journeys": max(calling[x] for x in run),
                             "of": min(passing[x] for x in run)})
            run = []
    return {"journeys": len(trips), "passing": passing, "calling": calling,
            "drop": drop, "minority": minority,
            "unknown": [a for a in chain if a not in known]}


def route_trips(cursors, route):
    """Every trip of that route number in every database, as stop-id lists."""
    out = []
    for cur in cursors:
        ids = [r[0] for r in cur.execute(
            "SELECT route_id FROM routes WHERE UPPER(route_short_name)=UPPER(?)", (route,))]
        for rid in ids:
            for (tid,) in cur.execute("SELECT trip_id FROM trips WHERE route_id=?", (rid,)).fetchall():
                out.append([row[0] for row in cur.execute(
                    "SELECT stop_id FROM stop_times WHERE trip_id=? "
                    "ORDER BY CAST(stop_sequence AS INT)", (tid,))])
    return out


def weigh(full, cursors, share=SHARE, min_passing=MIN_PASSING):
    """journey_weights.json for a whole routes_full_atco.json."""
    known = set()
    for cur in cursors:
        known.update(r[0] for r in cur.execute("SELECT stop_id FROM stops"))
    out = {}
    for route, rec in full.items():
        if not isinstance(rec, dict):
            continue                     # the pre-2026-06-07 flat shape has no directions
        dirs = rec.get("canonical") or rec.get("directions") or []
        chains = [d["stops"] for d in dirs]
        per = [[] for _ in chains]
        for calls in route_trips(cursors, route):
            i = assign(chains, calls)
            if i is not None:
                per[i].append(calls)
        out[route] = {d["name"]: classify(d["stops"], per[i], known, share, min_passing)
                      for i, d in enumerate(dirs)}
    return out


def add_localities(res, cur):
    """Give every minority run its NaPTAN localities, and every direction the
    localities of the stops it KEEPS, each in chain order with repeats removed.

    `cur` is a cursor on naptan.sqlite. A stop NaPTAN does not know, or one with no
    locality, contributes nothing. The kept list is what lets services_panel.js name
    a working only by the places the drawn line does NOT already reach: St Neots'
    station loop is all in St Neots, so it is named by its stop instead.
    """
    def locs_of(stops):
        out = []
        for a in stops:
            row = cur.execute("SELECT LocalityName FROM naptan WHERE ATCOCode=?", (a,)).fetchone()
            if row and row[0] and row[0] not in out:
                out.append(row[0])
        return out
    for dirs in res.values():
        for d in dirs.values():
            dropped = set(d.get("drop", []))
            d["localities"] = locs_of([a for a in d.get("passing", {}) if a not in dropped])
            for m in d["minority"]:
                m["localities"] = locs_of(m["stops"])
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description="Weigh each drawn stop by the journeys that call at it (OA-452).")
    ap.add_argument("routes_full", help="routes_full_atco.json")
    ap.add_argument("--db", required=True, help="GTFS sqlite, or several comma-separated")
    ap.add_argument("--out", required=True, help="journey_weights.json to write")
    ap.add_argument("--share", type=float, default=SHARE)
    ap.add_argument("--min-passing", type=int, default=MIN_PASSING)
    ap.add_argument("--naptan", default=None,
                    help="naptan.sqlite for the minority runs' localities; default: the one beside the first --db, if any; \"\" for none")
    a = ap.parse_args(argv)
    dbs = [p for p in a.db.split(",") if p]
    for p in dbs + [a.routes_full]:
        if not os.path.isfile(p):
            print("journey_weights: no such file: %s" % p, file=sys.stderr)
            return 2
    naptan = a.naptan
    if naptan is None and dbs:
        near = os.path.join(os.path.dirname(os.path.abspath(dbs[0])), "naptan.sqlite")
        naptan = near if os.path.isfile(near) else ""
    if naptan and not os.path.isfile(naptan):
        print("journey_weights: no such file: %s" % naptan, file=sys.stderr)
        return 2
    with open(a.routes_full, encoding="utf-8") as fh:
        full = json.load(fh)
    cons = [sqlite3.connect(p) for p in dbs]
    try:
        res = weigh(full, [c.cursor() for c in cons], a.share, a.min_passing)
    finally:
        for c in cons:
            c.close()
    if naptan:
        nc = sqlite3.connect(naptan)
        try:
            add_localities(res, nc.cursor())
        finally:
            nc.close()
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(res, fh, indent=1, ensure_ascii=False)
    for route, dirs in res.items():
        for name, d in dirs.items():
            for m in d["minority"]:
                print("  %s %s: %d stop(s) called at by %d of %d passing journeys -- off the drawn line: %s"
                      % (route, name, len(m["stops"]), m["journeys"], m["of"], " ".join(m["stops"])),
                      file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
