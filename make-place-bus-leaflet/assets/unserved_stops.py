#!/usr/bin/env python3
"""P2 helper -- list the active NaPTAN bus stops inside a place's walkshed that no
GTFS feed serves, so the question "is there a stop here with no timetabled bus?"
is asked on every place build rather than only when somebody thinks to
(buses-data OA-456).

Why: on St Neots East (buses-data OA-356 step 2, 2026-09-23) four active stops on
Love's Farm -- Alsop Way, Kester Way, School Drive, Whiston Way -- turned out to be
served by no feed, and they were found only by a hand query against
`_gtfs/naptan.sqlite` and the three feeds. The agreed approach is that such a stop
is NEVER DRAWN (a demand-responsive or school bus outside the feed may still use
it, so any mark claims too much or too little), is named in one map note only
where the stops are the sheet's own subject, and gets a `local-decisions.json`
entry either way. This script does the finding; the SKILL says what to do next.

A stop is SERVED when its ATCO code appears in `stop_times` of any built region
dataset listed in `_gtfs/regions.json`. A stop whose ATCO area no built dataset
keeps (`keepPrefixes`) is NOT JUDGED and is listed apart, because the feeds were
never asked about it -- calling it unserved would be the empty-answer fault.

Offline only. Refuses (exit 1) without a NaPTAN register, a region registry, or at
least one built dataset on disk, rather than writing a list that says every stop
is unserved. Otherwise exits 0, including when the list is empty.

Usage, from the P2 run folder that holds walkshed_cfg.json (no placeholders):
  python unserved_stops.py walkshed_cfg.json [--radius-m M] [--out unserved_stops.json]
                           [--naptan <naptan.sqlite>] [--regions <regions.json>]
"""
import argparse, json, math, os, sqlite3, sys

# NaPTAN StopType codes that are a place a bus stops: on-street (BCT), bus station
# bay (BCS), bus/coach variable bay (BCQ), bus/coach entrance (BCE), and a
# bus/coach station access area (BST). Rail, tram, ferry and taxi are left out.
BUS_STOP_TYPES = ("BCT", "BCS", "BCQ", "BCE", "BST")


def find_up(start_dir, *rel):
    """The first `<ancestor>/<rel...>` that exists, walking up from start_dir."""
    d = os.path.abspath(start_dir)
    while True:
        cand = os.path.join(d, *rel)
        if os.path.exists(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def dist_m(a, b):
    """Great-circle distance in metres between two [lat, lon] points."""
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def built_datasets(regions_path):
    """[(region name, sqlite path, keepPrefixes)] for every region whose dataset is on disk.

    The registry's `db` is an absolute path on the machine that built it; a file of
    the same name beside regions.json is tried as well, so a moved `_gtfs/` still works.
    """
    with open(regions_path, encoding="utf-8") as f:
        reg = json.load(f).get("regions", {})
    here = os.path.dirname(os.path.abspath(regions_path))
    out = []
    for name, r in sorted(reg.items()):
        if name.startswith("_") or r.get("status") != "built":
            continue
        for cand in (r.get("db"), os.path.join(here, os.path.basename(r.get("db") or ""))):
            if cand and os.path.isfile(cand):
                out.append((name, cand, list(r.get("keepPrefixes") or [])))
                break
    return out


def stops_in_radius(naptan_db, center, radius_m):
    """Active NaPTAN bus stops within radius_m of center, nearest first."""
    dlat = radius_m / 111320.0
    dlon = radius_m / (111320.0 * max(0.01, math.cos(math.radians(center[0]))))
    con = sqlite3.connect(naptan_db)
    try:
        rows = con.execute(
            "SELECT ATCOCode, CommonName, Indicator, LocalityName, lat, lon FROM naptan "
            "WHERE Status = 'active' AND StopType IN (%s) AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?"
            % ",".join("?" * len(BUS_STOP_TYPES)),
            (*BUS_STOP_TYPES, center[0] - dlat, center[0] + dlat, center[1] - dlon, center[1] + dlon),
        ).fetchall()
    finally:
        con.close()
    out = []
    for atco, name, ind, loc, lat, lon in rows:
        if lat is None or lon is None:
            continue
        d = dist_m(center, [lat, lon])
        if d <= radius_m:
            out.append({"atco": atco, "name": name, "indicator": ind, "locality": loc, "distM": round(d)})
    out.sort(key=lambda s: (s["distM"], s["atco"]))
    return out


def served_atcos(datasets, atcos):
    """The subset of atcos that appear in stop_times of any dataset."""
    served = set()
    for _name, db, _keep in datasets:
        con = sqlite3.connect(db)
        try:
            for a in atcos:
                if a not in served and con.execute(
                        "SELECT 1 FROM stop_times WHERE stop_id = ? LIMIT 1", (a,)).fetchone():
                    served.add(a)
        finally:
            con.close()
    return served


def classify(stops, datasets, served):
    """Split the stops into unserved, not judged, and a served count."""
    prefixes = [p for _n, _db, keep in datasets for p in keep]
    unserved, not_judged, n_served = [], [], 0
    for s in stops:
        if s["atco"] in served:
            n_served += 1
        elif not any(s["atco"].startswith(p) for p in prefixes):
            not_judged.append(dict(s, why="no built dataset keeps this stop's area (%s)" % s["atco"][:4]))
        else:
            unserved.append(s)
    return unserved, not_judged, n_served


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("walkshed_cfg", help="walkshed_cfg.json (P2) -- its center and radiusM")
    ap.add_argument("--radius-m", type=float, help="override the walkshed radius")
    ap.add_argument("--out", default="unserved_stops.json")
    ap.add_argument("--naptan", help="naptan.sqlite (default: _gtfs/naptan.sqlite, found walking up)")
    ap.add_argument("--regions", help="regions.json (default: _gtfs/regions.json, found walking up)")
    a = ap.parse_args(argv)

    with open(a.walkshed_cfg, encoding="utf-8") as f:
        cfg = json.load(f)
    center = cfg.get("center")
    radius = a.radius_m or cfg.get("radiusM")
    if not center or not radius:
        print("unserved_stops: %s has no center or radiusM" % a.walkshed_cfg, file=sys.stderr)
        return 1
    start = os.path.dirname(os.path.abspath(a.walkshed_cfg))
    naptan_db = a.naptan or find_up(start, "_gtfs", "naptan.sqlite")
    if not naptan_db or not os.path.isfile(naptan_db):
        print("unserved_stops: no naptan.sqlite (looked for _gtfs/naptan.sqlite above %s; "
              "build it with make-bus-leaflet/assets/naptan_build.py, or pass --naptan)" % start, file=sys.stderr)
        return 1
    regions = a.regions or find_up(start, "_gtfs", "regions.json")
    if not regions or not os.path.isfile(regions):
        print("unserved_stops: no regions.json (looked for _gtfs/regions.json above %s, or pass --regions)"
              % start, file=sys.stderr)
        return 1
    datasets = built_datasets(regions)
    if not datasets:
        print("unserved_stops: %s lists no built dataset that is on disk, so no stop can be judged; "
              "nothing written" % regions, file=sys.stderr)
        return 1

    stops = stops_in_radius(naptan_db, center, radius)
    served = served_atcos(datasets, [s["atco"] for s in stops])
    unserved, not_judged, n_served = classify(stops, datasets, served)
    out = {
        "center": center,
        "radiusM": radius,
        "datasets": [n for n, _db, _k in datasets],
        "stops": len(stops),
        "served": n_served,
        "unserved": unserved,
        "notJudged": not_judged,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")

    print("unserved_stops: %d active NaPTAN bus stops within %g m; %d served, %d served by NO feed, "
          "%d not judged -> %s" % (len(stops), radius, n_served, len(unserved), len(not_judged), a.out))
    for s in unserved:
        print("  UNSERVED  %-14s %4d m  %s%s  (%s)" % (
            s["atco"], s["distM"], s["name"], " (%s)" % s["indicator"] if s["indicator"] else "", s["locality"] or "?"))
    for s in not_judged:
        print("  NOT JUDGED %-13s %4d m  %s  -- %s" % (s["atco"], s["distM"], s["name"], s["why"]))
    if unserved:
        print("Draw none of them. Name them in one mapNotes line only if they are this sheet's own subject, "
              "and record the choice in local-decisions.json either way (SKILL.md, P2 step 5).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
