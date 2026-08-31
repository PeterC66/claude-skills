#!/usr/bin/env python3
"""Build the "you board here for X" index that is the point of a boarding plan.

WHY THIS EXISTS. `boarding-plan-product_2026-08-22.md` rule 2: index by
DESTINATION, alphabetically, not by route number -- "a reader who already knows
their route number does not need this sheet at all". That inverts every other file
the engine produces, all of which are keyed by route. Nothing existing can be
reshaped into it, because the fact the index needs -- "which stop does the bus to
Ramsey LEAVE from" -- is not in any of them.

DEPARTURES ONLY, AND THAT IS THE WHOLE SUBTLETY. A stop where a route merely
TERMINATES is not a boarding point for anywhere. St Ives route 9 makes the case:
its Huntingdon journeys depart from Bay 2, but its inbound journeys terminate at
Bay 1. An index built from "which routes call at this stop" -- the shape every
other file has -- would print "Huntingdon: Bay 1 or Bay 2", and half of that is
wrong. So this reads TRIPS, and a stop earns a destination only from the stops that
come AFTER it on the same trip. A trip's final stop contributes nothing, which is
the correct treatment of an arrival bay and falls out for free.

WHY TRIPS AND NOT THE DIRECTION CHAINS. routes_full_atco.json's `directions` are
canonicalised -- one representative stop list per direction. Real journeys vary
(short workings, school days, a Sunday variant that misses a village), and the
variation is exactly what decides whether a destination is "every 20 minutes" or
"one bus on Thursdays". Trip-level counting also lets a genuinely marginal
destination be marked `limited` instead of being printed as if it were routine.

LOCALITIES, NOT HEADSIGNS. A headsign is what the operator painted on the bus
("Bus Station", "New Road", "Superstore") and is useless as a destination name --
sec 2 of the paper found ten of thirteen S6 findings at one place were this
artefact alone. NaPTAN carries a real `LocalityName` for essentially every stop, so
each onward stop resolves to the settlement a reader would actually name. That is
the cross-check on reverse-geocoding the paper's sec 6 calls out as a benefit of the
register in its own right.

CHOOSING BETWEEN TWO STOPS THAT BOTH WORK. In a real town centre a bus often calls
at several in-frame stops on its way out -- at St Ives the Cambridge-bound A calls
at Cromwell Pl AND The Busway Station Road, both valid. The reader wants the one
that costs them the shortest walk, so ties are broken on distance from the anchor,
then on trip count. Every alternative is still recorded in `alsoFrom`, so a later
sheet can say "or from ..." without recomputing.

...EXCEPT WHERE THE SHORTEST WALK IS A BAD TRADE. Shortest-walk-first is right until
the difference is one printed minute and the service behind it is many times larger,
at which point the sheet is quietly sending a reader to the wrong flag: High Wycombe
Town Centre offered Marlow from a bay with five journeys a week over one with 317.
A stand at most one minute further that gets NO FURTHER from the destination and
carries more than three times the service is promoted over the nearer one. The
arrival guard is what stops the same rule sending a Swavesey passenger to the Busway.
See PROMOTE_MIN_RATIO below for the measurement (OA-028, 2026-08-30).

USAGE. Run from a stage folder holding the place's geometry (an S2 dir, or S3/S4
after `stage.js pull`). Needs `place.json` and `stands.json` (run `naptan_stands.py
--write` first); finds the GTFS and NaPTAN databases by walking up to `_gtfs/`.

    python boarding_index.py                        report only
    python boarding_index.py --write                also write boarding_index.json
    python boarding_index.py --db <path.sqlite>     pick the GTFS region explicitly
    python boarding_index.py --min-trips 2          hide destinations below N trips/week
    python boarding_index.py --limited-below 6      mark, not hide, below N trips/week
    python boarding_index.py --asof 2026-09-06     count the registrations live that day

There is deliberately NO default region: `regions.json` removed `_default` on
2026-08-21 because a silently-wrong dataset reports every route as withdrawn. If
--db is absent this reads the parent town's region from `_gtfs/town_prefixes.json`,
and fails listing the built regions rather than guessing.

OUTPUT. `boarding_index.json`: `destinations[]` sorted alphabetically, each naming
the stand to board at, the routes, the weekly trip count and any alternative stops;
plus `stands[]` carrying the reverse view for the map's own labels.
"""
import argparse
import datetime
import io
import json
import math
import os
import re
import sqlite3
import sys
from collections import defaultdict

SCRIPT_VERSION = "1.4"


def read_json(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def find_up(start_dir, *rel):
    d = os.path.abspath(start_dir)
    while True:
        cand = os.path.join(d, *rel)
        if os.path.exists(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def resolve_db(folder, explicit, place):
    """Pick the GTFS sqlite. Never guess a region -- fail listing what is built."""
    if explicit:
        return explicit
    gtfs_dir = find_up(folder, "_gtfs", "regions.json")
    if not gtfs_dir:
        return None
    regions = read_json(gtfs_dir).get("regions", {})
    built = {k: v for k, v in regions.items() if v.get("status") == "built"}

    # The parent town's registered region, if this place sits under an area we map.
    tp_path = find_up(folder, "_gtfs", "town_prefixes.json")
    town = (place or {}).get("town") or ""
    if tp_path and town:
        tp = read_json(tp_path)
        entries = tp.get("towns", tp) if isinstance(tp, dict) else {}
        for name, cfg in (entries.items() if isinstance(entries, dict) else []):
            if not isinstance(cfg, dict):
                continue
            if name.lower() in town.lower() or town.lower() in name.lower():
                region = cfg.get("region")
                if region in built:
                    return built[region]["db"]

    sys.stderr.write("boarding_index: no --db given and the parent town's region could not be read.\n")
    sys.stderr.write("  built regions: %s\n" % ", ".join(sorted(built)) or "(none)")
    sys.stderr.write("  re-run with --db <path to that region's .sqlite>\n")
    return None


def _feed_version(dbpath):
    """The BODS feed_version behind a region database, or None.

    `gtfs_build.py` writes `_gtfs/feed_info_<region>.json` beside every database it
    builds. Read it rather than the database: the version is a property of the
    published feed, and nothing inside the sqlite carries it. Absent file, unreadable
    file or a feed with no version all give None -- this records a fact when one is
    available and never invents one.
    """
    try:
        d = os.path.dirname(os.path.abspath(dbpath))
        stem = os.path.splitext(os.path.basename(dbpath))[0]
        info = read_json(os.path.join(d, "feed_info_%s.json" % stem))
        return ((info.get("feed_info") or {}).get("feed_version")
                or info.get("built") or None)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser(description="Build a boarding plan's destination index.")
    ap.add_argument("--dir", default=".")
    ap.add_argument("--db", default=None, help="GTFS sqlite for the region")
    ap.add_argument("--naptan", default=None)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--min-trips", type=int, default=1,
                    help="drop destinations with fewer than N trips in the feed week")
    ap.add_argument("--limited-below", type=int, default=6,
                    help="mark (not hide) destinations below N trips in the feed week")
    ap.add_argument("--asof", default=None, metavar="YYYY-MM-DD",
                    help="count only registrations running on this date (default: today)")
    args = ap.parse_args()

    args.asof = (args.asof or datetime.date.today().isoformat()).replace("-", "")
    if len(args.asof) != 8 or not args.asof.isdigit():
        sys.exit("--asof must be YYYY-MM-DD")

    folder = os.path.abspath(args.dir)

    # boardingPlan.excludeRoutes -- services to leave OFF the sheet even though the
    # feed still carries them. The case it was built for: Whippet's 101 to Hunstanton
    # is a summer seaside service whose calendar ends 13 Sep 2026, so a sheet printed
    # in August and read in October would send a reader to Bay 2 for a bus that has
    # stopped running (Peter, 2026-08-23). Filtered HERE, at the index, and never in
    # stands.json -- that file records what NaPTAN and the feed say about a stop, and
    # this is an editorial decision about a sheet. Absent key => byte-identical output.
    exclude = set()
    try:
        _rj = read_json(os.path.join(folder, "routes.json"))
        exclude = {str(r) for r in ((_rj.get("boardingPlan") or {}).get("excludeRoutes") or [])}
    except (OSError, ValueError):
        pass

    try:
        place = read_json(os.path.join(folder, "place.json"))
        stands = read_json(os.path.join(folder, "stands.json"))
    except OSError as exc:
        sys.stderr.write("boarding_index: %s\n" % exc)
        sys.stderr.write("  needs place.json and stands.json in %s\n" % folder)
        sys.stderr.write("  run `python naptan_stands.py --write` there first\n")
        return 2

    if stands.get("verdict") != "OK":
        sys.stderr.write("boarding_index: stands.json verdict is %r, refusing to build an index.\n"
                         % stands.get("verdict"))
        return 1

    dbpath = resolve_db(folder, args.db, place)
    if not dbpath or not os.path.exists(dbpath):
        return 2
    napath = args.naptan or find_up(folder, "_gtfs", "naptan.sqlite")
    if not napath:
        sys.stderr.write("boarding_index: no naptan.sqlite found\n")
        return 2

    db = sqlite3.connect(dbpath)
    nap = sqlite3.connect(napath)

    # atco -> the stand record a reader is sent to
    inframe = {s["atco"]: s for s in stands["stops"] if s.get("label")}
    if not inframe:
        sys.stderr.write("boarding_index: stands.json lists no printable stops\n")
        return 2

    # ---- locality lookup, cached -------------------------------------------
    # ROLLED UP TO THE PARENT LOCALITY, and that is a deliberate choice rather
    # than a tidy-up. NaPTAN's LocalityName is often a hamlet or a quarter --
    # "Fenton End", "Ramsey End", "Boxworth End", "Newtown", "Arbury",
    # "Kings Hedges" -- and none of those is a word a passenger would use to say
    # where they are going. ParentLocalityName is: Pidley cum Fenton, Warboys,
    # Swavesey, Huntingdon, Cambridge, Cambridge. Rolling up collapses the
    # Cambridge suburbs into "Cambridge", which is exactly what rule 2 asks for.
    #
    # The rollup MUST be done per ATCO code and never by name: "Church End"
    # alone has five different parents in the register (Eltisley, Parson Drove,
    # Swavesey, London, Finchley), so a name-keyed table would silently merge
    # villages 80 miles apart.
    #
    # The register is not internally consistent about this, so there is a second
    # pass. "Kings Hedges" carries parent "Cambridge" on its 0500CCITY* rows but
    # NO parent at all on the two 0500SORCH* busway rows -- which are precisely
    # the ones route A calls at, so the per-ATCO rollup alone left a Cambridge
    # suburb sitting in the index as if it were a separate town. The fallback
    # applies a locality's parent from elsewhere in the register, but ONLY where
    # the whole register agrees on a single parent for that name. "Church End"
    # has five, so it is left alone and its per-ATCO parent stands.
    # THE ROLLUP MUST STOP AT A JOINT CIVIL PARISH. Reported by Peter, 2026-08-23:
    # route 301 serves Needingworth and the index printed "Holywell-cum-Needingworth",
    # so a reader looking for the village they were going to could not find it. That
    # is not an unfamiliar spelling, it is a wrong answer: EVERY stop the 301 family
    # calls at in that parish is in Needingworth, and Holywell -- the other half of
    # the name -- has one stop (0500HHOLY009) that no service calls at at all. The
    # printed name therefore advertised a village the bus does not reach.
    #
    # A joint parish ("Holywell-cum-Needingworth", "Bythorn and Keyston") is an
    # ADMINISTRATIVE union of villages that keep their own names, which is a
    # different relationship from the hamlet-to-town one the rollup exists for. The
    # test is narrow on purpose: the child must be a whole COMPONENT of the
    # compound, not merely contained in it. "Fenton End" is not a component of
    # "Pidley cum Fenton", so it still rolls up -- and it must, because most stops
    # in that parish carry "Pidley cum Fenton" directly and un-rolling the other two
    # would print one village under two names.
    #
    # Measured over the whole NaPTAN register (127,658 stops) this fires on exactly
    # six locality names, and every one is a village a passenger would name:
    # Bythorn, Keyston, Caldecote, Folksworth, Washingley, Needingworth.
    JOINT = re.compile(r"\s*(?:-cum-|\scum\s|-with-|\swith\s|-and-|\sand\s|\s&\s)\s*",
                       re.IGNORECASE)

    def _norm(v):
        return re.sub(r"[^a-z0-9]", "", (v or "").lower())

    def joint_parish(child, parent):
        """True when `parent` is a joint parish and `child` is one of its halves."""
        parts = JOINT.split(parent or "")
        if len(parts) < 2:
            return False
        c = _norm(child)
        return bool(c) and any(_norm(x) == c for x in parts)

    # AND THE FALLBACK MUST BE SCOPED TO THE STOP'S OWN ADMINISTRATIVE AREA.
    # Found on the St Neots prototype, 2026-08-23. The "only where the whole
    # register agrees on a single parent" guard is not enough, because it only
    # fires on a name carrying TWO DIFFERENT parents -- and a name whose only
    # parent anywhere is in another county reads as unanimous. Cambridgeshire's
    # Barton, Croxton, Kingston, Tilbrook and Croydon all carry NO parent of their
    # own, so they inherited one from a namesake: the index printed **Oxford,
    # Thetford, Milton Keynes and London** as destinations of a St Neots town bus,
    # and "London -- Stop A" would have gone to print. Keying the fallback on
    # (AdministrativeAreaCode, LocalityName) kills all five, and costs nothing that
    # worked before: every relationship the rollup relies on -- Orchard Park ->
    # Kings Hedges -> Cambridge, Needingworth's joint parish, Fenton End -> Pidley
    # cum Fenton -- is attested inside area 071 already. The register has no parent
    # LOCALITY CODE column, so the area is the narrowest scope available; a village
    # whose real parent town is over a county line will now keep its own name,
    # which is the safe direction to be wrong in.
    parent_of = {}
    ambiguous = set()
    for area, child, parent in nap.execute(
            "SELECT DISTINCT AdministrativeAreaCode, LocalityName, ParentLocalityName FROM naptan "
            "WHERE LocalityName IS NOT NULL AND TRIM(COALESCE(ParentLocalityName,'')) <> ''"):
        c, p = (child or "").strip(), (parent or "").strip()
        if not c:
            continue
        key = ((area or "").strip(), c)
        if key in parent_of and parent_of[key] != p:
            ambiguous.add(key)
        parent_of[key] = p
    for key in ambiguous:
        parent_of.pop(key, None)

    # THE HIERARCHY IS MORE THAN ONE LEVEL DEEP, which is the trap here. Route A
    # calls at 0500SORCH010, whose LocalityName is "Orchard Park" and whose parent
    # is "Kings Hedges" -- and Kings Hedges is itself a child of Cambridge. A
    # single hop up therefore lands on a Cambridge housing estate and prints it in
    # the index as though it were a separate town. So climb to the top of the
    # chain, with a visited-set because a register this size cannot be assumed
    # acyclic.
    def climb(area, name):
        seen_names = set()
        cur = name
        while cur and cur not in seen_names:
            seen_names.add(cur)
            nxt = parent_of.get((area, cur))
            if not nxt or nxt == cur:
                break
            if joint_parish(cur, nxt):
                break
            cur = nxt
        return cur

    loc_cache = {}

    def locality(atco):
        if atco in loc_cache:
            return loc_cache[atco]
        r = nap.execute(
            "SELECT LocalityName, ParentLocalityName, AdministrativeAreaCode "
            "FROM naptan WHERE ATCOCode=?",
            (atco,)).fetchone()
        val = None
        if r:
            child, parent = (r[0] or "").strip(), (r[1] or "").strip()
            area = (r[2] or "").strip()
            if parent and child and joint_parish(child, parent):
                val = child                      # a half of a joint parish keeps its own name
            else:
                val = climb(area, parent or child) or None
        loc_cache[atco] = val
        return val

    home = None
    counts = defaultdict(int)
    for a in inframe:
        l = locality(a)
        if l:
            counts[l] += 1
    if counts:
        home = max(counts, key=lambda k: counts[k])

    # ---- how often a trip actually runs -------------------------------------
    # A raw count of matching rows in the feed is NOT a frequency: it counts
    # timetable patterns, not journeys, and the place skill's own gotchas record
    # a "7" that meant seven journeys EVERY weekday and a "Daily" service that
    # was really Sunday-only. So each trip is weighted by the number of days its
    # calendar entry actually operates, giving journeys per week. (calendar_dates
    # exceptions -- bank holidays, one-off cancellations -- are not applied; they
    # move individual dates rather than the weekly shape.)
    no_week = {}          # route -> trips dropped for having no operating week
    n_offwindow = {}      # route -> trips dropped for not running on `asof`
    n_superseded = {}     # route -> trips dropped as a re-registration counted twice
    cal = {}
    for sid, *flags in db.execute(
            "SELECT service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, "
            "start_date, end_date FROM calendar"):
        days = "".join("1" if str(f) == "1" else "0" for f in flags[:7])
        cal[sid] = {"days": days,
                    "week": days.count("1"),
                    "start": str(flags[7] or ""),
                    "end": str(flags[8] or "")}

    # ---- which registrations are LIVE on the sheet's date --------------------
    # A feed carries every registration it has been given, including ones that have
    # not started. Counted together they double a route's journeys-per-week, which
    # is the picker's third tie-break and what feeds `limitedBelowPerWeek`. Measured
    # in `buckinghamshire.sqlite` 2026-08-24: M40 and X74 each carry two COMPLETE
    # registrations -- 3 Aug 2026 to 3 May 2027, and 6 Sep 2026 to 6 Jun 2027 -- with
    # identical day patterns and near-identical trip counts on both sides.
    asof = args.asof
    off_window = {}       # service_id -> (start, end) for anything outside the window
    for sid, c in cal.items():
        if c["start"] and c["end"] and not (c["start"] <= asof <= c["end"]):
            off_window[sid] = (c["start"], c["end"])
    week_of = {sid: c["week"] for sid, c in cal.items() if sid not in off_window}

    # ---- walk every trip touching an in-frame stop --------------------------
    ph = ",".join("?" * len(inframe))
    trip_ids = [r[0] for r in db.execute(
        "SELECT DISTINCT trip_id FROM stop_times WHERE stop_id IN (%s)" % ph, list(inframe))]

    # ---- and which of the LIVE ones supersede each other ---------------------
    # A date window alone does not settle it: the two Buckinghamshire registrations
    # above OVERLAP for eight months, so from 6 Sep 2026 both are live and the double
    # count returns.
    #
    # A STOP-SET comparison is what settled the 905 at St Neots on 2026-08-23, and it
    # is NOT enough on its own here. Tried first and it produced a false positive:
    # route 102's services 12722 and 401 are both Sunday, both 3 Aug 2026 to 3 May
    # 2027, and of course share a stop set -- they are the same route. They are two
    # journey groups inside ONE registration (3 trips and 65), and halving them would
    # have been silent and wrong. Two services with the same start date are never a
    # supersession, and comparing route coverage cannot tell journey groups apart.
    #
    # The test that DOES work is the stop set plus a strictly LATER start date, which
    # is what separates a re-registration from a journey group. Matching the journeys
    # exactly was tried and is too strict: M40's two filings are identical except that
    # the last stop departs 05:50 instead of 05:51, one minute earlier on one stop of
    # a 36-stop route. That is a re-registration by any reading, and an exact-times
    # test called it a different service.
    #
    # So: same route, same operating days, a strictly later start date, overlapping
    # spans, and an identical stop set. Trip counts are PRINTED rather than tested --
    # they are evidence a reader should see (M40 53 v 53, X74 72 v 73), not a
    # threshold to invent. Anything failing any test is left alone and counted.
    svc_by_route = defaultdict(set)
    for rn, sv in db.execute(
            "SELECT DISTINCT r.route_short_name, t.service_id FROM stop_times st "
            "JOIN trips t ON t.trip_id=st.trip_id JOIN routes r ON r.route_id=t.route_id "
            "WHERE st.stop_id IN (%s)" % ph, list(inframe)):
        if sv in week_of:
            svc_by_route[rn].add(sv)

    _shape_cache = {}

    def _shape(rname, sid):
        """(set of stops, number of trips) for this service on this route."""
        key = (rname, sid)
        if key not in _shape_cache:
            rows = db.execute(
                "SELECT COUNT(DISTINCT st.trip_id), COUNT(DISTINCT st.stop_id) "
                "FROM stop_times st JOIN trips t ON t.trip_id=st.trip_id "
                "JOIN routes r ON r.route_id=t.route_id "
                "WHERE r.route_short_name=? AND t.service_id=?", (rname, sid)).fetchone()
            stops = frozenset(r[0] for r in db.execute(
                "SELECT DISTINCT st.stop_id FROM stop_times st JOIN trips t ON t.trip_id=st.trip_id "
                "JOIN routes r ON r.route_id=t.route_id "
                "WHERE r.route_short_name=? AND t.service_id=?", (rname, sid)))
            _shape_cache[key] = (stops, rows[0] if rows else 0)
        return _shape_cache[key]

    superseded = {}       # service_id -> (route, winning service_id)
    for rname, svcs in svc_by_route.items():
        by_days = defaultdict(list)
        for sv in svcs:
            by_days[cal[sv]["days"]].append(sv)
        for _days, group in by_days.items():
            if len(group) < 2:
                continue
            group.sort(key=lambda s: (cal[s]["start"], str(s)))
            keep = group[-1]
            for sv in group[:-1]:
                if cal[sv]["start"] >= cal[keep]["start"]:
                    continue      # same registration, two journey groups -- not a supersession
                if cal[sv]["end"] < cal[keep]["start"]:
                    continue      # no overlap: the old one has already finished
                old, new = _shape(rname, sv), _shape(rname, keep)
                if old[0] == new[0]:
                    superseded[sv] = (rname, keep, old[1], new[1])

    # dest -> atco -> {routes:set, trips:int, arr:set}
    # `arr` is where the journey SETS THE READER DOWN in that destination, and it is
    # kept because "this bus reaches Swavesey" turns out not to mean the same thing
    # from every stand -- see the arrival-band note under the picker below.
    reach = defaultdict(lambda: defaultdict(lambda: {"routes": set(), "trips": 0, "arr": set()}))
    route_of = {}
    for tid in trip_ids:
        row = db.execute(
            "SELECT r.route_short_name, t.service_id FROM trips t JOIN routes r ON r.route_id=t.route_id "
            "WHERE t.trip_id=?", (tid,)).fetchone()
        if not row:
            continue
        rname, svc = row[0], row[1]
        if rname in exclude:
            continue          # boardingPlan.excludeRoutes
        if svc in superseded:
            n_superseded[rname] = n_superseded.get(rname, 0) + 1
            continue          # re-registration of the same timetable; counted once
        if svc in off_window:
            n_offwindow[rname] = n_offwindow.get(rname, 0) + 1
            continue          # registration not running on the sheet's date
        per_week = week_of.get(svc, 0)
        if per_week == 0:
            # No row in `calendar` at all, or a row with no operating day: not a
            # service a reader can turn up and catch. Correct to drop, and NOT correct
            # to drop in silence -- a service registered wholly through
            # `calendar_dates` (a bank-holiday timetable, a match-day shuttle, a
            # school working) looks exactly like this, and so would a daily service
            # filed the same way. At High Wycombe it removed eight of the frame's 37
            # routes including the 130 and 300, the town's Aylesbury link, and nothing
            # said so. Reported below.
            no_week[rname] = no_week.get(rname, 0) + 1
            continue
        seq = [r[0] for r in db.execute(
            "SELECT stop_id FROM stop_times WHERE trip_id=? ORDER BY CAST(stop_sequence AS INTEGER)",
            (tid,))]
        for i, sid in enumerate(seq):
            if sid not in inframe:
                continue
            onward = seq[i + 1:]
            if not onward:
                continue  # terminates here -- not a boarding point for anywhere
            # `seen` stops a trip counting the same destination twice -- a bus calling
            # at nine stops in Huntingdon is still one journey to Huntingdon. It must
            # NOT also gate `arr`: the first stop a trip makes in a settlement is
            # wherever the road happens to enter it, and taking that as "how near this
            # bus gets" said route B reaches Huntingdon 2,171 m out, at a Hartford
            # estate, when the same journey goes on to the bus station.
            seen = set()
            for nxt in onward:
                l = locality(nxt)
                if not l or l == home:
                    continue
                cell = reach[l][sid]
                cell["arr"].add(nxt)
                if l in seen:
                    continue
                seen.add(l)
                cell["routes"].add(rname)
                cell["trips"] += per_week
            route_of.setdefault(rname, True)

    if exclude:
        print("  boardingPlan.excludeRoutes: left off the sheet -- %s"
              % ", ".join(sorted(exclude)))
    print("  counting registrations running on %s-%s-%s (--asof)"
          % (args.asof[:4], args.asof[4:6], args.asof[6:]))
    if n_offwindow:
        print("  not running on that date, so not counted -- %s"
              % ", ".join("%s (%d trip%s)" % (r, n, "" if n == 1 else "s")
                          for r, n in sorted(n_offwindow.items())))
        # A PRINTED SHEET OUTLIVES ITS BUILD DATE, so an excluded registration is not
        # simply noise -- it is the sheet's shelf life, and it is named rather than
        # counted against a threshold nobody argued. Measured at St Ives Bus Station
        # 2026-08-24: route B reaches Histon from The Busway Station Road on the
        # registration starting 30 AUGUST and on no current one, so a sheet built
        # strictly for today drops a destination that is true six days later and for
        # the nine months after that. Build with --asof set to the date the sheet goes
        # into use, and read this list before choosing it.
        upcoming = sorted({cal[sv]["start"] for sv in off_window if cal[sv]["start"] > asof})
        if upcoming:
            print("     registrations in this feed that START after %s-%s-%s: %s"
                  % (asof[:4], asof[4:6], asof[6:],
                     ", ".join("%s-%s-%s" % (d[:4], d[4:6], d[6:]) for d in upcoming)))
            print("     A sheet printed now will be read past those dates. Re-run with --asof <date>")
            print("     to see what the sheet says then, and build on whichever registration it will live on.")
        ended = sorted({cal[sv]["end"] for sv in off_window if cal[sv]["end"] < asof})
        if ended:
            print("     and registrations that ENDED before it: %s"
                  % ", ".join("%s-%s-%s" % (d[:4], d[4:6], d[6:]) for d in ended[-3:]))
    if n_superseded:
        print("  re-registration of a timetable already counted, so counted ONCE -- %s"
              % ", ".join("%s (%d trip%s)" % (r, n, "" if n == 1 else "s")
                          for r, n in sorted(n_superseded.items())))
        print("     Same route, same operating days, overlapping dates, an IDENTICAL stop set and a")
        print("     strictly later start. Trip counts are shown so the pair can be judged, not tested.")
        for sv, (rn, keep, n_old, n_new) in sorted(superseded.items(), key=lambda kv: (kv[1][0], str(kv[0]))):
            print("     %-5s service %s (%s..%s, %d trips) superseded by %s (%s..%s, %d trips)"
                  % (rn, sv, cal[sv]["start"], cal[sv]["end"], n_old,
                     keep, cal[keep]["start"], cal[keep]["end"], n_new))
    if no_week:
        print("  no operating week in `calendar`, so not indexed -- %s"
              % ", ".join("%s (%d trip%s)" % (r, n, "" if n == 1 else "s")
                          for r, n in sorted(no_week.items())))
        print("     Registered through `calendar_dates` only: a named set of dates rather than a")
        print("     weekly pattern. Check each before accepting the drop -- gtfs_query.py reports")
        print("     them as days '?' with weeksActive 1.")

    if not reach:
        sys.stderr.write("boarding_index: no onward destinations found\n")
        return 1

    # ---- how near the destination does each option actually get? ------------
    # HOW FAR THE BUS GETS INTO THE PLACE IT NAMES. Found on the St Neots
    # prototype, 2026-08-23, from the other end: at St Ives, routes A and B reach
    # "Swavesey" 1,393 m from the middle of Swavesey, because the Busway halt is
    # out on the guided track, while the 5A calls at School Lane in the village
    # itself. Both are true statements that the reader can reach Swavesey; only one
    # of them puts them in it. Frequency alone would send them to the halt (1,102
    # journeys a week against 60), so it has to be measured rather than assumed.
    #
    # The measure is the distance from the arrival stop to the CENTROID of that
    # locality's own stops, banded at 400 m -- roughly five minutes on foot, which
    # is the granularity a difference of this kind matters at. Options in the same
    # band are treated as arriving equally well and frequency then decides, which
    # is the St Neots case: the 18 and the C2 call at the very same four stops in
    # Abbotsley, so the eleven-a-week service should win over the one-a-week.
    ARRIVAL_BAND_M = 400.0

    # WHEN A BETTER-SERVED STAND IS ONE PRINTED MINUTE FURTHER, IT WINS (OA-028).
    # The sort below puts `walkMin` first, so a nearer stand beat a better-served one
    # however lopsided the trade. Measured over all four built sheets on 2026-08-30:
    # High Wycombe High Street sent an Amersham passenger to Stop R (72 journeys a
    # week) over Stop V (418, x5.8) and a Chesham one to Stop R (66) over Stop V (352,
    # x5.3); High Wycombe Town Centre sent a Marlow passenger to Bay 15 -- FIVE
    # journeys a week -- over Bay 9's 317, a factor of 63. All three cost one printed
    # minute. That is the whole population: nothing else on any sheet trades a minute
    # for more than double.
    #
    # THE ARRIVAL GUARD IS NOT OPTIONAL, and St Ives is why. Fen Drayton, Longstanton
    # and Swavesey all show the same shape -- Bay 2 at 60 journeys a week against
    # Cromwell Pl at 551, x9.2 -- and promoting them would be WRONG: Cromwell Pl is the
    # Busway, which sets a passenger down 998 m, 816 m and 1,393 m from those villages
    # (arrival bands 2, 2 and 3). The file's own note above already said frequency alone
    # sends a Swavesey passenger to a halt a mile outside the village; this rule would
    # have done exactly that had it looked only at trips. So a promoted option must get
    # NO FURTHER from the destination than the one it displaces.
    #
    # THE RATIO SITS IN A GAP RATHER THAN ON A BOUNDARY. Ranked, the one-minute trades
    # on the estate are x1.29, x1.29, x1.29, x2.00, x2.00, then x5.33, x5.81, x9.18 and
    # x63.40. A threshold of 3 has nothing within a factor of 1.5 on either side, so it
    # is not a number a single new stop can tip.
    PROMOTE_MIN_RATIO = 3.0   # the further stand must carry MORE than this much service
    PROMOTE_MAX_EXTRA_MIN = 1  # ...and be at most this many printed minutes further

    R_EARTH = 6371000.0

    def _metres(lat1, lon1, lat2, lon2):
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * R_EARTH * math.asin(math.sqrt(a))

    pos_cache = {}

    def stop_pos(atco):
        if atco not in pos_cache:
            r = nap.execute("SELECT lat, lon, AdministrativeAreaCode FROM naptan WHERE ATCOCode=?",
                            (atco,)).fetchone()
            pos_cache[atco] = (r[0], r[1], (r[2] or "").strip()) if r else (None, None, "")
        return pos_cache[atco]

    centre_cache = {}

    def locality_centre(dest, area):
        """Centroid of the destination's own stops, scoped to one administrative
        area so a namesake in another county cannot drag it across the map."""
        key = (dest, area)
        if key not in centre_cache:
            rows = nap.execute(
                "SELECT lat, lon FROM naptan WHERE LocalityName=? AND AdministrativeAreaCode=? "
                "AND Status='active' AND lat IS NOT NULL", (dest, area)).fetchall()
            centre_cache[key] = ((sum(r[0] for r in rows) / len(rows),
                                  sum(r[1] for r in rows) / len(rows)) if rows else None)
        return centre_cache[key]

    def arrival_metres(dest, arr):
        """Metres from the nearest arrival stop to the middle of the destination,
        or None where the register gives the destination no stops of its own (a
        rollup target such as a parish name), in which case every option is equal
        and this term drops out."""
        best = None
        for atco in arr:
            lat, lon, area = stop_pos(atco)
            if lat is None:
                continue
            centre = locality_centre(dest, area)
            if not centre:
                continue
            d = _metres(centre[0], centre[1], lat, lon)
            best = d if best is None else min(best, d)
        return best

    # ---- pick the stand for each destination --------------------------------
    dests = []
    for dest, bystop in reach.items():
        options = []
        for sid, cell in bystop.items():
            st = inframe[sid]
            arr_m = arrival_metres(dest, cell["arr"])
            options.append({
                "atco": sid,
                "label": st["label"],
                "class": st["class"],
                "distM": st["distM"],
                "walkMin": st["walkMin"],
                "routes": sorted(cell["routes"]),
                "trips": cell["trips"],
                "arrivalM": None if arr_m is None else round(arr_m),
                "arrivalBand": 0 if arr_m is None else int(arr_m // ARRIVAL_BAND_M),
            })
        # SHORTEST WALK WINS, BUT THE UNIT IS THE MINUTE THE SHEET PRINTS, NOT THE
        # METRE. Sorting on raw distance made sense while the only place was a bus
        # station, where the stands are 11-47 m out and the far option is 182 m. At
        # St Neots the five Market Square stands are 46-55 m from the centre, so a
        # 4 m difference -- noise to a walker, and identical on the sheet, which
        # says "1 min" for all five -- was deciding the answer: "Abbotsley: Stop A,
        # C2, ltd" beat Stop E's eleven journeys a week on the 18 because Stop A is
        # four metres nearer.
        #
        # Then how near the bus gets to the destination, then how often it runs.
        # That order is deliberate and both halves were needed: frequency alone
        # sends a Swavesey passenger to the Busway halt a mile outside the village,
        # and distance-from-the-anchor alone sends an Abbotsley passenger to a
        # once-a-week bus. Raw distance breaks a tie inside the minute, then the
        # label, so the output is deterministic.
        options.sort(key=lambda o: (o["walkMin"], o["arrivalBand"], -o["trips"],
                                    o["distM"], o["label"]))
        best = options[0]
        # ...then let a MUCH better-served stand one minute further take it (OA-028).
        # Ordered by the same key inside the promoted set, so the answer stays
        # deterministic and a second qualifying stand cannot depend on dict order.
        promoted = sorted(
            (o for o in options[1:]
             if o["walkMin"] <= best["walkMin"] + PROMOTE_MAX_EXTRA_MIN
             and o["arrivalBand"] <= best["arrivalBand"]
             and best["trips"] > 0
             and o["trips"] > best["trips"] * PROMOTE_MIN_RATIO),
            key=lambda o: (o["arrivalBand"], -o["trips"], o["walkMin"], o["distM"], o["label"]))
        if promoted:
            best = promoted[0]
            options = [best] + [o for o in options if o is not best]
        total = sum(o["trips"] for o in options)
        if total < args.min_trips:
            continue
        dests.append({
            "destination": dest,
            "boardAt": best["label"],
            "boardAtAtco": best["atco"],
            "boardClass": best["class"],
            "walkMin": best["walkMin"],
            "routes": best["routes"],
            "trips": best["trips"],
            "limited": best["trips"] < args.limited_below,
            "alsoFrom": [o for o in options[1:]],
        })

    dests.sort(key=lambda d: d["destination"].lower())

    # ---- reverse view, for the map's stand labels ---------------------------
    per_stand = defaultdict(lambda: {"destinations": [], "routes": set()})
    for d in dests:
        per_stand[d["boardAtAtco"]]["destinations"].append(d["destination"])
        per_stand[d["boardAtAtco"]]["routes"].update(d["routes"])
    stand_view = []
    for s in stands["stops"]:
        if not s.get("label"):
            continue
        v = per_stand.get(s["atco"], {"destinations": [], "routes": set()})
        stand_view.append({
            "atco": s["atco"], "label": s["label"], "class": s["class"],
            "distM": s["distM"], "walkMin": s["walkMin"], "facing": s.get("facing"),
            "name": s.get("name"), "pos": s.get("gtfsPos"),
            # THE STREET, CARRIED THROUGH RATHER THAN LOOKED UP TWICE (OA-034, v1.4).
            # `naptan_stands.py` has written a full NaPTAN block per stop since the
            # file was first written, `Street` included, and the sheet has never been
            # able to print it: `gen_boarding.js` draws its key from THIS file, not
            # from stands.json, and this view dropped every NaPTAN field but the
            # CommonName. The alternative -- teaching the generator to open stands.json
            # as well -- would give one drawing two sources, which is the shape that
            # has cost this project a round before. One input, one drawing.
            "street": ((s.get("naptan") or {}).get("Street") or None),
            "routes": sorted(v["routes"]), "destinations": sorted(v["destinations"]),
        })

    # ---- report -------------------------------------------------------------
    print("# boarding_index v%s — %s" % (SCRIPT_VERSION, place.get("name")))
    print("  region db: %s   home locality: %s" % (os.path.basename(dbpath), home))
    print("  %d trip(s) touch the frame; %d destination(s) reachable" % (len(trip_ids), len(dests)))
    print()
    for sv in stand_view:
        print("  %-26s %-9s %3d m  %2d route(s)  %3d destination(s)"
              % (sv["label"], "[" + sv["class"] + "]", sv["distM"],
                 len(sv["routes"]), len(sv["destinations"])))
    print()
    print("  %-30s %-26s %-18s %s" % ("DESTINATION", "BOARD AT", "ROUTES", "TRIPS/wk"))
    for d in dests:
        mark = " (limited)" if d["limited"] else ""
        alt = ("   also: " + ", ".join(o["label"] for o in d["alsoFrom"])) if d["alsoFrom"] else ""
        print("  %-30s %-26s %-18s %4d%s%s"
              % (d["destination"][:30], d["boardAt"][:26],
                 ", ".join(d["routes"])[:18], d["trips"], mark, alt))

    if args.write:
        out = {
            "place": place.get("name"),
            "homeLocality": home,
            "generatedBy": "boarding_index.py v%s" % SCRIPT_VERSION,
            # THE DATE THIS INDEX IS ABOUT, WRITTEN DOWN (OA-189, v1.4).
            # --asof has governed every count in this file since it was written, and
            # until now the file did not say which date that was -- so `boarding_verify.py`,
            # which re-derives the same reachability from `stop_times`, had no way to
            # describe the same population and ran undated. The two were answering
            # questions about different sets of registrations, invisibly, because the
            # checker was the more permissive of the two and nothing had gone wrong yet.
            # The build date of the run folder is NOT this fact: a sheet may be, and has
            # been, built with --asof set to the day it goes on a wall rather than the
            # day it was drawn. So it is recorded rather than inferred.
            "asof": "%s-%s-%s" % (args.asof[:4], args.asof[4:6], args.asof[6:]),
            # ...AND WHICH FEED IT COUNTED, WHICH `region` DOES NOT SAY (v1.4).
            # `region` names a FILE, and that file is rebuilt in place every refresh.
            # Measured on the day this was written: three of the four boarding indexes
            # in the estate were built at 05:07 and the Buckinghamshire feed was rebuilt
            # at 10:01, so High Wycombe High Street was shipping eleven destinations
            # whose trip counts today's feed does not reproduce -- and every check in
            # the estate was correctly green, because `generatedBy` was v1.3 on both
            # sides and the byte gate redraws the sheet from the stored index however
            # old it is. The fact was invisible for want of anybody writing it down.
            # Recorded here, not gated here: the gate is OA-210.
            "feed": _feed_version(dbpath),
            "region": os.path.basename(dbpath),
            "stands": stand_view,
            "destinations": dests,
        }
        path = os.path.join(folder, "boarding_index.json")
        with io.open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(out, indent=1, ensure_ascii=False))
        print("\n  wrote %s" % path)

    return 0


if __name__ == "__main__":
    sys.exit(main())
