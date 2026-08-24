#!/usr/bin/env python3
"""Resolve the boardable stops inside a place's frame to what is printed on their flags.

WHY THIS EXISTS. A boarding plan answers one question -- "I have decided to go to
X; which of these stops do I stand at?" -- and it can only answer it by printing
the same identifier the passenger can see on the pole. `naptan_build.py` put that
identifier in reach (`stand`, e.g. "1", "E"); this script decides, for one place,
whether every stop a reader might need actually has one, and refuses the sheet if
any does not.

THE UNIT IS THE FRAME, NOT THE NAME-CLUSTER -- and that is a correction.
`boarding-plan-product_2026-08-22.md` sec 1a measures coverage over "stops sharing a
name within a short walk" and classes each cluster FULL / PARTIAL / NONE. On that
rule St Ives Bus Station is FULL: four bays, `Bay 1`..`Bay 4`, all lettered. The
sheet is not safe to build on that basis, and St Ives is the case that proves it:

    Routes A and B -- the busiest here by an order of magnitude -- split by
    DIRECTION across the cluster boundary. Huntingdon-bound they call at Bay 4.
    Cambridge-bound they never enter the bus station at all: Cromwell Pl ->
    The Busway Station Road -> Park and Ride. Neither of those carries a stand
    code, and neither is named "Bus Station", so the name-cluster rule never
    looked at them.

A sheet built on the FULL verdict would therefore send every Cambridge passenger
-- the commonest journey from this station -- to a bay no Cambridge bus stops at.
So this script considers every SERVED stop inside the frame, whatever it is called.

TWO WAYS TO BE IDENTIFIABLE, AND BOTH ARE HONEST TO THE FLAG. Rule 3 of the paper
is "the letter must match the flag; a letter we invented is worse than no letter."
The corollary is that a flag without a code still carries something the reader can
match -- its NAME -- so:

    class 'stand'  the flag shows a code      -> print the code      ("Bay 4")
    class 'named'  the flag shows a name only -> print the name      ("The Busway,
                                                  Station Road", plus direction)

A stop is UNIDENTIFIABLE only when it has no stand code AND its CommonName is
shared with another stop in the same frame -- then neither device distinguishes it
and there is nothing honest left to print. That, not "PARTIAL", is the real refusal
condition, and it is much narrower.

VERDICTS
    OK          every served stop in frame is identifiable; the sheet can be built
    REFUSE      at least one is not; the sheet would be confidently wrong

Refusal is deliberate and matches the paper's sec 5: an optional device should
decline when it cannot be placed honestly, rather than guess.

USAGE. Run from a stage folder holding the place's geometry (an S2 dir, or an S3/S4
dir after `stage.js pull`). The folder is the current directory unless --dir says
otherwise; it must contain `atco2ll.json`, `routes_full_atco.json` and `place.json`.

    python naptan_stands.py                       report only, writes nothing
    python naptan_stands.py --write               also write stands.json
    python naptan_stands.py --radius-m 250        frame radius; overrides the config below
    python naptan_stands.py --dir <folder>        run against another folder
    python naptan_stands.py --naptan <path>       override the register location

`--naptan` defaults to `_gtfs/naptan.sqlite` found by walking up from --dir, so it
works from any stage folder inside the Buses tree without being told where it is.

THE FRAME RADIUS, most explicit first: `--radius-m`, then `routes.json`'s
`boardingPlan.frameRadiusM`, then `walkshed_cfg.json`'s `radiusM`, then 250 m. Set
it in the config, not on the command line, or the frame is not reproducible from
what is committed. The walkshed is the OTHER two sheets' radius and it is a poor
default here: St Neots town centre walks 450 m, and at 450 m the frame reaches the
unlettered `Church View` pair and this script refuses the sheet. Where the widest
usable radius is not obvious, `Development Docs/measure_frame_coverage_2026-08-23.py`
prints it per anchor as `maxOK` -- but that tool anchors on a NaPTAN STOP and this
one anchors on `place.json`'s centre, so its number is a starting point and not a
value to copy. At High Wycombe High Street the two anchors are ~20 m apart and the
`Station Interchange` cluster falls either side of the frame edge depending on which
you measure from. Take maxOK as an upper bound, then run this tool at the radius you
intend and believe its verdict.

A frame can also clip a name CLUSTER: a name unique in view whose twins sit just
outside. That is not a refusal -- the sheet can still be drawn -- but the printed
instruction may send a reader to the wrong flag, so it is reported as a WARNING
naming every sibling found out to twice the frame radius (added 2026-08-24).

OUTPUT. `stands.json` -- one entry per served stop in the frame, in the order a
sheet should list them (stands by code, then named stops by distance), each with the
printable label, the class, the bearing, the walking distance and the routes calling
there. Never falls back to Indicator: printing "opp" tells a reader nothing.
"""
import argparse
import io
import json
import math
import os
import re
import sqlite3
import sys

SCRIPT_VERSION = "1.1"

# Compass points NaPTAN uses in `Bearing`, to the words a sheet prints.
COMPASS = {
    "N": "north", "NE": "north-east", "E": "east", "SE": "south-east",
    "S": "south", "SW": "south-west", "W": "west", "NW": "north-west",
}

# Walking speed for the "N min walk" the paper's rule 5 asks for (metres/minute).
# 80 m/min is the conventional slow-pedestrian figure used by wayfinding schemes.
WALK_M_PER_MIN = 80.0


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def find_naptan(start_dir):
    """Walk up from start_dir looking for _gtfs/naptan.sqlite."""
    d = os.path.abspath(start_dir)
    while True:
        cand = os.path.join(d, "_gtfs", "naptan.sqlite")
        if os.path.exists(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def read_json(folder, name):
    with io.open(os.path.join(folder, name), encoding="utf-8") as fh:
        return json.load(fh)


def routes_by_stop(full):
    """atco -> {route -> [direction names]} for every stop any direction calls at.

    READS `directions`, NEVER `canonical` -- and that distinction is the whole
    correctness of this file. routes_full_atco.json carries a one-direction
    `canonical` chain (what the map draws) alongside the full `directions` list.
    Every other consumer wants `canonical`, so the obvious `canonical or directions`
    is the natural thing to write; here it is a bug, because a boarding plan is a
    statement ABOUT direction.

    At St Ives the canonical chain for routes A and B is the inbound one, which
    calls at Bay 4 and never at The Busway Station Road -- so a version of this
    script that preferred `canonical` reported four stops, missed the outbound
    Cambridge stop entirely, and still printed VERDICT: OK. The gate was blind in
    exactly the direction the sheet exists to explain.
    """
    out = {}
    for route, v in (full or {}).items():
        dirs = v.get("directions")
        if not isinstance(dirs, list) or not dirs:
            dirs = v.get("canonical") or []
        if not isinstance(dirs, list):
            continue
        for d in dirs:
            dname = d.get("name") or ""
            for atco in (d.get("stops") or []):
                out.setdefault(atco, {}).setdefault(route, [])
                if dname and dname not in out[atco][route]:
                    out[atco][route].append(dname)
    return out


def tidy_name(common, indicator):
    """The printable name for a stop with no stand code.

    NaPTAN's CommonName is what is on the flag. The Indicator is appended only when
    it says something a reader can act on -- a compass bearing does, "opp"/"near" do
    not, because they are relative to a landmark the reader cannot see named.
    """
    nm = (common or "").strip()
    ind = (indicator or "").strip()
    if re.fullmatch(r"(N|NE|E|SE|S|SW|W|NW)[- ]?bound", ind, re.IGNORECASE):
        return nm
    return nm


def main():
    ap = argparse.ArgumentParser(description="Resolve a place frame's boardable stops to their flags.")
    ap.add_argument("--dir", default=".", help="stage folder holding the geometry (default: .)")
    ap.add_argument("--radius-m", type=float, default=None, help="frame radius in metres")
    ap.add_argument("--naptan", default=None, help="path to naptan.sqlite")
    ap.add_argument("--write", action="store_true", help="write stands.json")
    args = ap.parse_args()

    folder = os.path.abspath(args.dir)
    try:
        ll = read_json(folder, "atco2ll.json")
        full = read_json(folder, "routes_full_atco.json")
        place = read_json(folder, "place.json")
    except OSError as exc:
        sys.stderr.write("naptan_stands: %s\n" % exc)
        sys.stderr.write("  needs atco2ll.json, routes_full_atco.json and place.json in %s\n" % folder)
        return 2

    # Frame radius, most explicit first. routes.json comes BEFORE walkshed_cfg.json
    # because the walkshed is the OTHER two sheets' radius and has no reason to suit
    # this one: St Neots town centre walks 450 m, and at 450 m the frame reaches the
    # unlettered Church View pair and this script correctly REFUSES the sheet. St Ives
    # never showed the problem -- its walkshed happens to be 250 m -- so the fallback
    # looked right for as long as there was one place. A frame that the committed
    # config cannot reproduce is a frame that depends on someone remembering a flag.
    radius = args.radius_m
    if radius is None:
        try:
            bp = read_json(folder, "routes.json").get("boardingPlan") or {}
            if bp.get("frameRadiusM") is not None:
                radius = float(bp["frameRadiusM"])
        except (OSError, ValueError, AttributeError):
            pass
    if radius is None:
        try:
            radius = float(read_json(folder, "walkshed_cfg.json").get("radiusM", 250))
        except OSError:
            radius = 250.0

    napath = args.naptan or find_naptan(folder)
    if not napath or not os.path.exists(napath):
        sys.stderr.write("naptan_stands: no naptan.sqlite found (looked up from %s)\n" % folder)
        sys.stderr.write("  build it with: python naptan_build.py --out <Buses>/_gtfs/naptan.sqlite\n")
        return 2

    plat, plon = float(place["lat"]), float(place["lon"])
    served = routes_by_stop(full)

    nap = sqlite3.connect(napath)
    nap.row_factory = sqlite3.Row

    rows = []
    for atco, pos in (ll or {}).items():
        if atco not in served:
            continue  # in the geometry file but no route calls there
        try:
            slat, slon = float(pos[0]), float(pos[1])
        except (TypeError, ValueError, IndexError):
            continue
        dist = haversine_m(plat, plon, slat, slon)
        if dist > radius:
            continue
        n = nap.execute(
            "SELECT CommonName, Indicator, stand, stand_kind, Bearing, Street, Landmark, "
            "       StopType, Status, lat, lon "
            "FROM naptan WHERE ATCOCode=?", (atco,)).fetchone()
        rows.append({
            "atco": atco,
            "distM": round(dist),
            "walkMin": max(1, int(round(dist / WALK_M_PER_MIN))),
            "routes": sorted(served[atco]),
            "routeDirections": served[atco],
            "gtfsPos": [slat, slon],
            "naptan": dict(n) if n else None,
        })

    if not rows:
        sys.stderr.write("naptan_stands: no served stops inside %d m of the place centre\n" % radius)
        return 2

    # ---- classify ------------------------------------------------------------
    # A name is only a usable identifier if it is unique inside the frame.
    name_counts = {}
    for r in rows:
        nm = ((r["naptan"] or {}).get("CommonName") or "").strip().lower()
        name_counts[nm] = name_counts.get(nm, 0) + 1

    for r in rows:
        nap_row = r["naptan"] or {}
        stand = (nap_row.get("stand") or "").strip()
        common = (nap_row.get("CommonName") or "").strip()
        kind = (nap_row.get("stand_kind") or "").strip()
        bearing = (nap_row.get("Bearing") or "").strip().upper()
        if not nap_row:
            r["class"] = "unknown"
            r["label"] = None
            r["why"] = "no NaPTAN row for this ATCO code"
        elif stand:
            r["class"] = "stand"
            word = kind.capitalize() if kind and kind != "bare" else "Stand"
            r["label"] = ("%s %s" % (word, stand)).strip()
            r["standCode"] = stand
            r["why"] = "NaPTAN Indicator %r" % (nap_row.get("Indicator") or "")
        elif common and name_counts.get(common.lower(), 0) == 1:
            r["class"] = "named"
            r["label"] = tidy_name(common, nap_row.get("Indicator"))
            r["why"] = "no stand code; CommonName is unique inside the frame"
        else:
            r["class"] = "unidentifiable"
            r["label"] = None
            r["why"] = ("no stand code and the name %r is shared with %d other stop(s) in frame"
                        % (common, name_counts.get(common.lower(), 1) - 1))
        r["facing"] = COMPASS.get(bearing) if bearing else None
        r["street"] = nap_row.get("Street")
        r["landmark"] = nap_row.get("Landmark")
        r["stopType"] = nap_row.get("StopType")
        r["name"] = common or None

    # stands first (by code, numerically where possible), then named stops by distance
    def stand_key(r):
        c = r.get("standCode") or ""
        m = re.match(r"^(\d+)", c)
        return (0, int(m.group(1)), c) if m else (1, 0, c)

    stands = sorted([r for r in rows if r["class"] == "stand"], key=stand_key)
    named = sorted([r for r in rows if r["class"] == "named"], key=lambda r: r["distM"])
    bad = [r for r in rows if r["class"] in ("unidentifiable", "unknown")]
    ordered = stands + named + bad

    verdict = "REFUSE" if bad else "OK"

    # ---- names accepted as unique that are NOT unique on the pavement ---------
    # "Unique inside the frame" is the rule this tool applies, and the frame edge is
    # an arbitrary line drawn through a street. A name can be the only one of its kind
    # in view and still be one of three identical flags 20 m further on, at which point
    # the sheet prints a boarding instruction the reader cannot follow.
    #
    # Measured at High Wycombe High Street 2026-08-23: `frame-coverage` reported maxOK
    # 252 m, and at that radius this tool accepted a stop called plain `Station
    # Interchange` whose two same-named siblings sit 0.4 m and 13 m OUTSIDE the frame,
    # neither carrying a stand code. `measure_frame_coverage_2026-08-23.py` now stops
    # before a name cluster is clipped; this is the same fault caught at build time,
    # for a frame radius somebody set by hand.
    #
    # The search looks out to TWICE the frame radius -- the frame again -- and every
    # sibling found is NAMED with its distance rather than tested against a threshold.
    # Whether it matters is a judgement about that street, and the person building the
    # sheet is the one who can make it.
    outside = []
    for r in [x for x in rows if x["class"] == "named"]:
        common = ((r["naptan"] or {}).get("CommonName") or "").strip()
        if not common:
            continue
        sibs = []
        for s in nap.execute(
                "SELECT ATCOCode, stand, lat, lon FROM naptan "
                "WHERE Status='active' AND lower(CommonName)=? AND lat IS NOT NULL",
                (common.lower(),)):
            if s["ATCOCode"] == r["atco"]:
                continue
            d = haversine_m(plat, plon, float(s["lat"]), float(s["lon"]))
            if radius < d <= radius * 2:
                sibs.append((round(d), s["ATCOCode"], (s["stand"] or "").strip()))
        if sibs:
            outside.append((r, sorted(sibs)))

    # ---- report --------------------------------------------------------------
    print("# naptan_stands v%s — %s" % (SCRIPT_VERSION, place.get("name") or folder))
    print("  frame: %.6f,%.6f  radius %d m   register: %s"
          % (plat, plon, radius, os.path.basename(napath)))
    print("  %d served stop(s) in frame — %d lettered, %d named-only, %d unidentifiable"
          % (len(rows), len(stands), len(named), len(bad)))
    print()
    for r in ordered:
        cls = r["class"]
        lab = r["label"] or "(cannot be printed)"
        face = ("  facing %s" % r["facing"]) if r["facing"] else ""
        print("  [%-14s] %-28s %s  %4d m (%d min)%s"
              % (cls, lab, r["atco"], r["distM"], r["walkMin"], face))
        print("      %-24s routes: %s" % (r["name"] or "?", ", ".join(r["routes"])))
        print("      %s" % r["why"])
    print()
    if outside:
        print("  WARNING — %d name(s) accepted as unique here are NOT unique just outside the frame:"
              % len(outside))
        for r, sibs in outside:
            print("    %-26s %s at %d m, accepted because nothing IN frame shares the name."
                  % (r["label"] or r["name"], r["atco"], r["distM"]))
            for d, atco, st in sibs:
                print("        also %-24s %s at %d m%s"
                      % (r["name"], atco, d, (" (stand %s)" % st) if st else " — no stand code"))
        print("    A reader sent to this stop by name may be standing at the wrong flag. Either")
        print("    shrink the frame below the cluster, or give the stand key something the reader")
        print("    can check from the pavement. Searched to %d m (twice the frame radius)."
              % (radius * 2))
        sys.stderr.write("naptan_stands: %d accepted name(s) have same-named stops just outside "
                         "the frame — see the report\n" % len(outside))
        print()
    print("  VERDICT: %s" % verdict)
    if verdict == "REFUSE":
        print("  A boarding plan MUST NOT be generated for this frame: the stop(s) above")
        print("  carry neither a stand code nor a name that is unique here, so nothing")
        print("  honest can be printed to send a reader to them.")

    if args.write:
        out = {
            "place": place.get("name"),
            "center": [plat, plon],
            "radiusM": radius,
            "register": os.path.basename(napath),
            "generatedBy": "naptan_stands.py v%s" % SCRIPT_VERSION,
            "verdict": verdict,
            "counts": {"stand": len(stands), "named": len(named), "unidentifiable": len(bad)},
            "stops": ordered,
        }
        path = os.path.join(folder, "stands.json")
        with io.open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(out, indent=1, ensure_ascii=False))
        print("  wrote %s" % path)

    return 0 if verdict == "OK" else 1


if __name__ == "__main__":
    sys.exit(main())
