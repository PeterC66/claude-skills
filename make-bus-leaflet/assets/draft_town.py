#!/usr/bin/env python3
"""Tier-2 automation (process-efficiency-plan item 8): unattended DRAFT build for a
new town, GREEN-band only, through to a v1.0 draft for human correction.

Chains the existing deterministic pieces (scaffold_town.py / bootstrap_town.py /
gtfs_query.py / derive_intown.js / pull_roads.js / match_routes.js /
complexity_score.js / gen_internal.js / gen_external_radial.js /
gtfs_duration.py / render.js) with NO subjective human input, then STOPS and
writes a DRAFT-REVIEW.md explaining exactly what still needs a person before this
can ship as a real leaflet. This is NOT Tier-3 (item 9, deliberately not
recommended): every output is watermarked as an unreviewed draft, and a non-GREEN
town escalates rather than building anyway.

TARGET: a draft of the CURRENT standard map, not a v1-era one. Every built town
(St Ives, March, Huntingdon, Wisbech, St Neots, Beaconsfield, High Wycombe) uses
`internalRoads`, real external stop chains and `minutesToDestination`, so this
script produces all three. The v1 of this script (2026-08-04, superseded same day)
skipped internalRoads "to stay deterministic" -- wrong reasoning, since
pull_roads.js/match_routes.js are as deterministic as anything else here, and the
resulting draft lost route badges, "to X" terminus arrows, road names, the north
arrow, the version stamp and the focus compression ALL AT ONCE, because
gen_internal.js gates every one of them behind `IR`.

Where it still differs from a human-run S1/S2, and why:
  - S1: skips the bustimes cross-check / operator-PDF disagreement audit
    entirely. verified-services.json is built straight from the GTFS dataset
    and every route is flagged "unverified" -- community/DRT services that
    BODS omits are NOT found (a known, documented gap, not a bug).
  - S2: full route chains + stop coordinates come directly from the GTFS
    sqlite (trips/stop_times/stops), not from a bustimes scrape -- avoids the
    per-date truncation trap the manual flow works around with --dates, at the
    cost of only ever drawing the dataset's own picture of each route.
    POIs/features/roads still use live Overpass.
  - PLACE NAMES: GTFS carries no locality column and this region's operators
    publish street-level headsigns ("Bus Station", "New Road"), so GTFS alone
    cannot name a terminus -- exactly the trap s3-config.md warns about. Place
    names are therefore REVERSE-GEOCODED from each stop's coordinates via
    Nominatim, cached per ATCO locality prefix (every 0500HDODD stop is
    Doddington, so one lookup serves the whole locality). A lookup that returns
    no settlement-level name is labelled "<name> <check>" rather than shipped as
    a confident guess.
  - Complexity gate: AMBER also stops here (not just RED) -- item 8 is
    explicitly scoped to GREEN-band towns; a town needing the remedy ladder
    is real per-town judgement, out of scope for an unattended draft.

Usage:
  python draft_town.py "<Town>" [--region Cambridgeshire] [--centre lat,lon]
      [--radius-km 1.6] [--buses-root "C:\\u3a St Ives\\Using AI\\Buses"] [--db PATH]
      [--max-edge-km 2.5]
"""
import argparse, json, math, os, re, shutil, sqlite3, subprocess, sys, time
import cli   # OA-224 Tier 3.1: --buses-root, then BUSES_DIR, then the laptop
import urllib.parse, urllib.request
from datetime import date
import gtfs_regions
import index_guard

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "make-bus-leaflet/1.0 (draft_town Tier-2)"}
MAX_INTERMEDIATE = 4     # places drawn along a spoke before the terminus


def run(cmd, cwd=None, check=True):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if check and p.returncode != 0:
        sys.stderr.write(p.stdout + "\n" + p.stderr + "\n")
        raise SystemExit(f"command failed ({p.returncode}): {' '.join(str(c) for c in cmd)}")
    return p.stdout.strip()


def node(*args, cwd=None, check=True):
    exe = shutil.which("node") or "node"
    argv = [os.path.join(HERE, a) if i == 0 else a for i, a in enumerate(args)]
    return run([exe, *argv], cwd=cwd, check=check)


def km_between(la1, lo1, la2, lo2):
    dla = math.radians(la2 - la1); dlo = math.radians(lo2 - lo1)
    a = math.sin(dla / 2) ** 2 + math.cos(math.radians(la1)) * math.cos(math.radians(la2)) * math.sin(dlo / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


# --------------------------------------------------------------- place naming
class PlaceNamer:
    """Name a stop's SETTLEMENT -- from NaPTAN where it can, Nominatim otherwise.

    NaPTAN carries `LocalityName` per stop and it is authoritative, offline, free
    and deterministic, so it is consulted FIRST and answers almost everything
    (253/253 stops on Ramsey's chains). Reverse-geocoding remains only as the
    fallback for a stop NaPTAN does not know.

    It used to be the other way round, and a member of the public found what that
    cost (2026-08-28, first genuine public report): Ramsey's published external
    sheet showed Whittlesey on the X31, which does not go there. Nominatim at
    zoom=14 returns `town=Whittlesey` for Pondersbridge, Turves, Coates and
    Eastrea alike -- they are all in Whittlesey's civil parish -- so FIVE distinct
    settlements answered to one name. Raising the zoom does not fix it (`town`
    still outranks `village`), and preferring the most specific instead turns
    Peterborough's Queensgate into "New Fletton", which is the regression the
    SETTLEMENT comment below already records. NaPTAN simply knows.

    GTFS has no locality column (schema: stop_id/stop_code/stop_name/lat/lon) and
    stop_name is a street or POI ("Bus Station", "Station Road", "Grandford
    Drove"), which is useless and often actively misleading as a terminus label --
    three different Ramsey routes all terminate at a stop called "Bus Station",
    meaning Huntingdon, St Ives and Peterborough respectively.

    NaPTAN ATCO codes are locality-blocked (0500HRAMS... = Ramsey), so one
    reverse-geocode per 9-char prefix names every stop in that locality. That
    keeps the Nominatim call count to roughly the number of places a route passes
    through, not the number of stops.
    """
    # Order matters, in BOTH directions -- both mistakes were made and caught:
    #  * `city` must not outrank `village`/`town` blindly, because UK Nominatim puts
    #    the DISTRICT there: a rural stop between Ramsey and Warboys returns
    #    city="Huntingdonshire". Hence ADMIN below rejects it, rather than reordering.
    #  * but `suburb` must stay BELOW town/city, or a destination degrades to a
    #    district of itself -- putting village/suburb first turned Peterborough's
    #    Queensgate into "Millfield" and Huntingdon bus station into "Hartford".
    # A bus destination wants the town, so: town, village, city (non-admin), then
    # the sub-town fallbacks.
    SETTLEMENT = ("town", "village", "city", "suburb", "hamlet")
    WIDER = ("municipality", "county", "state_district")
    ADMIN = re.compile(r"(shire|\bDistrict\b|\bBorough\b|\bCounty\b|\bCouncil\b)\s*$", re.I)

    def __init__(self, naptan_db=None, delay=1.1):
        self.cache = {}
        self.delay = delay
        self._last = 0.0
        self.naptan = {}
        if naptan_db and os.path.exists(naptan_db):
            con = sqlite3.connect(naptan_db)
            for atco, loc, par in con.execute(
                    "SELECT ATCOCode, LocalityName, ParentLocalityName FROM naptan "
                    "WHERE LocalityName IS NOT NULL AND LocalityName <> ''"):
                self.naptan[atco] = (self.tidy(loc), self.tidy(par) if par else None)
            con.close()
        if self.naptan:
            print(f"  PlaceNamer: {len(self.naptan):,} NaPTAN stop localities loaded")
        else:
            print("  PlaceNamer: NO NaPTAN DB -- falling back to reverse-geocoding for "
                  "every place name. Expect parish-level names (see the class docstring).")

    def locality(self, stop_id):
        """NaPTAN's own answer: (settlement, parent settlement or None)."""
        return self.naptan.get(stop_id, (None, None))

    def in_town(self, stop_id, town):
        """Is this stop in the town PROPER? (Not its outlying parts -- see of_town.)

        Strict on purpose. Folding the outlying parts in here re-creates the very
        bug this replaced: Ramsey Heights and Ramsey St Marys sit AFTER Bury,
        Wistow and Upwood in the X31's chain, so counting them as "in town" puts
        the last in-town stop back beyond the villages and drops them again. That
        was caught by prove_ramsey_spokes.py, not by reading the code.

        The test this replaces was `stop_id.startswith(atcoPrefix)`, and the ATCO
        block is an ADMINISTRATIVE grouping, not a settlement: 0500HRAMS covers
        Ramsey Heights, Ramsey St Marys, Ramsey Mereside and Ramsey Forty Foot as
        well as Ramsey. That is what dropped Bury, Wistow and Upwood off the 32 and
        X31 spokes -- both routes loop out through those villages and come BACK
        through the Ramsey ATCO block before leaving for good, so "everything after
        the last in-town stop" threw the villages away. By LOCALITY the loop is
        outside the town and survives. Ramsey End is the check on the other side:
        it reads like Ramsey and its NaPTAN parent is Warboys, so a name-prefix
        rule would have wrongly swallowed it.
        """
        loc, _par = self.locality(stop_id)
        if not loc:
            return None                       # unknown -- caller keeps the old test
        return loc == town

    def of_town(self, stop_id, town):
        """Is this stop one of the town's own outlying parts (NaPTAN parent)?

        Ramsey Forty Foot, Ramsey Heights, Ramsey Mereside and Ramsey St Marys all
        carry ParentLocalityName=Ramsey, so they are the town's own edges rather
        than destinations from it. Ramsey End is the counter-example that makes
        this a NaPTAN question and not a string one: it reads like Ramsey and its
        parent is Warboys.
        """
        loc, par = self.locality(stop_id)
        return bool(loc) and par == town and loc != town

    @staticmethod
    def tidy(name):
        # Nominatim returns "St. Ives"/"St. Neots"; every existing town config and
        # the leaflets themselves use the unpointed British form.
        return re.sub(r"\bSt\.\s+", "St ", name).strip()

    def _lookup(self, lat, lon):
        gap = self.delay - (time.time() - self._last)
        if gap > 0:
            time.sleep(gap)
        url = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode(
            {"lat": lat, "lon": lon, "format": "json", "zoom": 14, "addressdetails": 1})
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception:
            return None, False
        finally:
            self._last = time.time()
        addr = r.get("address", {})
        for k in self.SETTLEMENT:
            v = addr.get(k)
            if v and not self.ADMIN.search(v):
                return self.tidy(v), True
        for k in self.WIDER:                       # too coarse to trust as a place
            if addr.get(k):
                return self.tidy(addr[k]), False
        return None, False

    def name(self, stop_id, lat, lon):
        """-> (name, confident). name is never None; an unresolved stop keeps its
        own stop-level identity so the draft still renders, flagged not-confident."""
        loc, _parent = self.locality(stop_id)
        if loc:
            return loc, True                  # NaPTAN is authoritative; no call needed
        key = stop_id[:9]
        if key not in self.cache:
            self.cache[key] = self._lookup(lat, lon)
        nm, ok = self.cache[key]
        return (nm or key), ok

    def label(self, stop_id, lat, lon, fallback=""):
        """A human-facing label; appends ' <check>' when the name isn't a
        confident settlement, so a reviewer sees the doubt rather than a
        confident-looking wrong name."""
        nm, ok = self.name(stop_id, lat, lon)
        if ok:
            return nm
        return f"{nm or fallback or '?'} <check>"


# ---------------------------------------------------------------- S1: services
def build_verified_services(gtfs_services_path, out_path, dropped=()):
    """The S1 record: what this town runs, and what it knows about and will not draw.

    `dropped` is bootstrap_town.py's A5 list. Those services are moved OUT of
    `services[]` and into `notOnLeaflet[]`, which is the estate's one spelling for
    "we know about this route and deliberately do not draw it" -- the other three
    are read for ever and written never (check-exclusion-fields.mjs). Recording it
    matters more than it looks: a route merely MISSING from the S1 record is
    indistinguishable from one the feed never carried, so the monthly refresh
    proposes it again every month, and the reviewer has no way to disagree with a
    decision nothing wrote down. OA-436.
    """
    facts = json.load(open(gtfs_services_path, encoding="utf-8"))
    services = facts["services"] if "services" in facts else facts
    by_route = {str(d.get("route")): d for d in (dropped or ())}
    services = [s for s in services if str(s["route"]) not in by_route]
    # gtfs_query.py's "termini" is raw BODS trip_headsign stop-name text ("Bus
    # Station", "Grays Lane"), never a settlement -- so it is stamped the same way
    # place_verified_services.js already stamps a headsign-sourced termini:
    # terminiSource: "gtfs-headsign" tells verify_report.js's terminus check
    # (place-termini-are-headsigns) not to score a non-match as a HARD fault.
    # Chatteris's first S6 was BLOCKED with six terminus HARDs for exactly this
    # reason -- unstamped, the check read raw stop names as settlement claims.
    verified = [{**s, "verified": False,
                 "verifySource": "GTFS only (Tier-2 auto-draft) -- NOT cross-checked against "
                                 "bustimes.org or the operator's own timetable; community/DRT "
                                 "services absent from BODS are NOT included",
                 **({"terminiSource": "gtfs-headsign"} if s.get("termini") else {})}
                for s in services]
    not_on = [{"route": d.get("route"), "operator": d.get("operator", ""),
               "days": d.get("days", ""), "name": d.get("longName", ""),
               "servesTown": True, "source": "gtfs",
               "reason": d.get("reason", "")} for d in (dropped or ())]
    out = {"services": verified}
    if not_on:
        out["notOnLeaflet"] = not_on
    json.dump(out, open(out_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    return [s["route"] for s in verified]


# ------------------------------------------- S2: chains + coords direct from GTFS
def gtfs_full_chains(db, routes, prefix):
    """Per route: the modal (most-frequent) stop pattern per direction_id -- the
    route's canonical journey, not every timing variation.

    SCOPED TO THE TOWN. `route_short_name` is not unique within a BODS region, and
    this function's output becomes `routes_full_atco.json` -- the drawn geometry.
    Until 2026-08-28 it pulled every trip on every route with that number ANYWHERE
    in the region, so a town drafting its route 9 could be handed a different
    operator's route 9 from sixty miles away and draw it. Measured 2026-08-22: six
    of our eight towns carry at least one colliding number (St Ives four -- `A`, `B`
    Stagecoach East vs First Norfolk & Suffolk, `9` Dews vs A2B, `5A` Stagecoach
    East vs Stephensons). Nothing shipped is known to be wrong because Ramsey is the
    only town ever auto-drafted and it has no collision; the next one would have been.

    The restriction is the one `gtfs_duration.py` already applies and comments: keep
    only trips of that short_name which actually CALL AT a stop in this town. Trips
    dropped by it are counted and printed, so the scoping is visible rather than
    silent. See OA-097.
    """
    con = sqlite3.connect(db); cur = con.cursor()
    out = {}
    dropped_total = 0
    for route in routes:
        route_ids = [r[0] for r in cur.execute(
            "SELECT route_id FROM routes WHERE route_short_name=?", (route,))]
        if not route_ids:
            out[route] = {"directions": [], "canonical": [], "all": []}
            continue
        ph = ",".join("?" * len(route_ids))
        in_town = {r[0] for r in cur.execute(
            "SELECT DISTINCT t.trip_id FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id "
            "JOIN stops s ON s.stop_id=st.stop_id "
            "WHERE t.route_id IN (%s) AND s.stop_id LIKE ?" % ph,
            route_ids + [prefix + "%"])}
        groups = {}
        for rid in route_ids:
            for tid, headsign, did in cur.execute(
                    "SELECT trip_id, trip_headsign, direction_id FROM trips WHERE route_id=?", (rid,)).fetchall():
                if tid not in in_town:
                    dropped_total += 1
                    continue
                stops = [row[0] for row in cur.execute(
                    "SELECT stop_id FROM stop_times WHERE trip_id=? "
                    "ORDER BY CAST(stop_sequence AS INT)", (tid,))]
                if len(stops) < 2:
                    continue
                g = groups.setdefault((did, tuple(stops)),
                                      {"name": headsign or f"direction {did}", "stops": stops, "n": 0})
                g["n"] += 1
        best = {}
        for (did, _s), g in groups.items():
            if did not in best or g["n"] > best[did]["n"]:
                best[did] = g
        dirs = [{"name": g["name"], "stops": g["stops"]} for g in best.values()]
        out[route] = {"directions": dirs, "canonical": dirs,
                      "all": sorted(set(a for d in dirs for a in d["stops"]))}
        # AND SAY WHICH IN-TOWN STOPS THE MODAL RULE JUST THREW AWAY (OA-175).
        #
        # One pattern per direction_id is right for the drawn line -- a minority
        # timing variation should not put a detour on the map. But the docstring
        # above says "not every timing variation", and a pattern that calls
        # somewhere the modal one does not is not a timing variation at all: it is
        # a STOP the town's map will not show. Ramsey's 32 has two Mon-Fri
        # term-time trips into Abbey College, 08:30 in and 15:30 out, and the
        # college was already on the sheet as a landmark -- so the sheet named the
        # school and hid its bus, and a member of the public noticed.
        #
        # This does not add the stop, because adding it silently is the worse
        # error: a tick on the line says "the bus calls here", and twice a day on
        # school days is not what a reader takes from that. It NAMES it, with the
        # trip count, so somebody decides. Measured on Ramsey, the whole town
        # yields exactly one such stop on one of five routes, so this is a line or
        # two of output and not a wall of it.
        kept = set(a for d in dirs for a in d["stops"])
        missed = {}
        for tid in in_town:
            for (sid,) in cur.execute(
                    "SELECT stop_id FROM stop_times WHERE trip_id=?", (tid,)):
                if sid.startswith(prefix) and sid not in kept:
                    missed[sid] = missed.get(sid, 0) + 1
        for sid, n in sorted(missed.items(), key=lambda kv: -kv[1]):
            nm = cur.execute("SELECT stop_name FROM stops WHERE stop_id=?", (sid,)).fetchone()
            print(f"  {route}: {nm[0] if nm else sid} ({sid}) is called at by {n} trip(s) in this "
                  f"town but is on NO modal pattern, so it will not appear on the map. "
                  f"Decide whether it should -- see OA-175.")
    con.close()
    if dropped_total:
        print(f"  chains scoped to {prefix}*: dropped {dropped_total} trip(s) on same-numbered "
              f"routes that never call at this town (see OA-097)")
    return out


def gtfs_coords(db, atcos):
    con = sqlite3.connect(db); cur = con.cursor()
    ll, nm = {}, {}
    for a in atcos:
        row = cur.execute("SELECT stop_name, stop_lat, stop_lon FROM stops WHERE stop_id=?", (a,)).fetchone()
        if row and row[1] not in ("", None) and row[2] not in ("", None):
            nm[a] = row[0]
            ll[a] = [float(row[1]), float(row[2])]
    con.close()
    return ll, nm


# ------------------------------------------------- external spokes + termini
def spoke_for_route(chain, ll, prefix, anchor_ll, namer, town=None):
    """Derive one external spoke from a route's canonical chain.

    Picks the direction whose far end is farthest from the anchor, then walks
    OUTWARD from the last in-town stop collecting distinct settlement names --
    giving the ordered intermediate places ... terminus list gen_external_radial.js
    draws, and that gtfs_duration.py --fill matches its destination on (it uses
    the LAST name in "stops").

    "In town" is a NaPTAN LOCALITY test, not an ATCO-prefix one -- see
    PlaceNamer.in_town for why, and for the public report that found the
    difference. Also returns `otherEnd`: a route running THROUGH the town reaches
    a second destination this spoke cannot express, and dropping it silently lost
    Chatteris off Ramsey's 303. It is reported, not drawn -- a second spoke is a
    bearing/collision decision a human should make.
    """
    best = None
    for d in chain.get("canonical") or chain.get("directions") or []:
        stops = [a for a in d["stops"] if a in ll]
        if len(stops) < 2:
            continue
        end = stops[-1]
        dist = km_between(anchor_ll[0], anchor_ll[1], ll[end][0], ll[end][1])
        if best is None or dist > best[0]:
            best = (dist, stops)
    if not best or best[0] < 1.0:            # never leaves town -> no spoke
        return None
    dist, stops = best

    def _in_town(a):
        v = namer.in_town(a, town) if town else None
        return a.startswith(prefix) if v is None else v

    last_in_town = max((i for i, a in enumerate(stops) if _in_town(a)), default=-1)
    outward = stops[last_in_town + 1:] if last_in_town >= 0 else stops
    if not outward:
        return None
    places, parents, seen = [], {}, set()
    for a in outward:
        if town and namer.of_town(a, town):
            continue                          # the town's own outskirts, not a destination
        nm, ok = namer.name(a, ll[a][0], ll[a][1])
        if nm and nm not in seen:
            seen.add(nm); places.append(nm if ok else f"{nm} <check>")
            parents[nm] = namer.locality(a)[1]
    if not places:
        return None
    # The terminus is where the chain ENDS, not the last new name on it. A route
    # that runs Hartford -> Huntingdon -> Newtown -> Huntingdon meets Huntingdon
    # early, so dedup-by-first-sighting left the spoke labelled "Newtown" -- a
    # suburb standing in for the town, which is the same class of error as
    # "Whittlesey" standing in for Pondersbridge.
    term, _ok = namer.name(outward[-1], ll[outward[-1]][0], ll[outward[-1]][1])
    if term in places:
        places = [p for p in places if p != term] + [term]
    # Fold the terminus's own suburbs into it. NaPTAN's ParentLocalityName makes
    # Stanground and Fletton parts of Peterborough, Hartford and Sapley parts of
    # Huntingdon, Westry part of March -- and a spoke naming three suburbs before
    # the town reads as four separate destinations.
    if len(places) > 1:
        places = [p for p in places[:-1] if parents.get(p) != places[-1]] + [places[-1]]
    # Thin the intermediates. A GTFS chain passes through every hamlet on the road
    # (Ramsey->St Ives listed ten), which overflows the spoke and collides with the
    # neighbouring one; s3-config.md's crowded-radial recipe explicitly includes
    # "thin the intermediate stops". Keep the terminus plus an even sample.
    if len(places) > MAX_INTERMEDIATE + 1:
        mids = places[:-1]
        step = len(mids) / MAX_INTERMEDIATE
        places = [mids[int(i * step)] for i in range(MAX_INTERMEDIATE)] + [places[-1]]
    end = outward[-1]
    bearing = _bearing(anchor_ll[0], anchor_ll[1], ll[end][0], ll[end][1])
    # A through service reaches a second place the chosen direction never names.
    other = None
    for d in chain.get("canonical") or chain.get("directions") or []:
        ds = [x for x in d["stops"] if x in ll]
        if len(ds) < 2:
            continue
        for x in (ds[0], ds[-1]):
            if _in_town(x):
                continue
            nm, _ok = namer.name(x, ll[x][0], ll[x][1])
            if nm and nm not in places and km_between(
                    anchor_ll[0], anchor_ll[1], ll[x][0], ll[x][1]) >= 1.0:
                other = nm
    return {"label": places[-1], "stops": places, "bearing": round(bearing),
            "far_km": round(dist, 1), "otherEnd": other,
            "endChoice": _end_candidates(chain, ll, anchor_ll, namer, places[-1])}


def _end_candidates(chain, ll, anchor_ll, namer, chosen):
    """Every place this route could defensibly have been labelled, and its distance.

    OA-436, in place of A13. The audit asked the drafter to "name the end most
    journeys reach, or the larger locality". Measured on the six spokes it was
    filed for, BOTH of those rules pick the label the drafter already writes, and
    the live map's label is the other one:

      * St Ives B, Wisbech 60 and St Neots 905 are THROUGH routes. The live sheets
        name Hinchingbrooke, Downham Market and Bedford; the farther end -- and the
        larger locality -- is Cambridge, Three Holes' far side, and Cambridge
        again. "The larger locality" writes the draft's answer, not the map's.
      * St Ives 9 is a 35-stop circular that ends back at the bus station, so it
        has no far end at all and the drafter silently took the other direction's
        3 km out-and-back to Hemingford Abbots. Its farthest stop is a village on
        the loop, not the Huntingdon the sheet names -- Huntingdon is one of the
        twelve localities the loop passes through and nothing in the feed ranks it
        above the other eleven.
      * Route 9 carries 6 trips at the town and 69 carries 4, and EVERY stop
        pattern on both is a single trip -- so "the end most journeys reach" has
        nothing to count.

    Which end of a through route to draw is a decision about the whole sheet (St
    Ives already draws Cambridge on route A, so B's Cambridge end would duplicate
    it), and which of a circular's twelve localities is "the" destination is not in
    the feed. So this stops the drafter presenting a guess as a fact and hands the
    reviewer the alternatives it chose between -- the house move everywhere else
    here, as in gtfs_full_chains()'s report of the stops the modal rule threw away.
    """
    seen, out = {chosen}, []
    for d in chain.get("canonical") or chain.get("directions") or []:
        stops = [a for a in d["stops"] if a in ll]
        if len(stops) < 2:
            continue
        far = max(stops, key=lambda a: km_between(anchor_ll[0], anchor_ll[1], ll[a][0], ll[a][1]))
        for a in (stops[-1], far):
            km = km_between(anchor_ll[0], anchor_ll[1], ll[a][0], ll[a][1])
            if km < 1.0:
                continue
            nm, _ok = namer.name(a, ll[a][0], ll[a][1])
            if nm and nm not in seen:
                seen.add(nm); out.append({"place": nm, "km": round(km, 1),
                                          "onPattern": len(stops)})
    return out


MIN_CORUN = 0.6          # the engine's own corridors_report.json threshold


def _sibling_pairs(routes):
    """Route numbers that LOOK like variants of one service -> [(base, member)].

    Two shapes, and the second is the one GTFS's own declaration cannot reach:
      * a route that EXTENDS another present route by one or two characters --
        301S of 301, AW1X of AW1. gtfs_query.py already calls this
        `possibleVariantOf`, and this reproduces it so the caller has one list.
      * a set of routes that share a stem of two or more characters once a one- or
        two-character tail is stripped, where the stem is NOT itself a route --
        Chatteris' ZIP2 and ZIP3, and 301S/301V/301X in a town whose feed carries
        no plain 301. `possibleVariantOf` requires the base to be PRESENT, so in
        those towns it declares nothing and all three drafted as separate routes.

    This only PROPOSES. Whether a pair is one line is decided by the co-run and
    destination tests in variant_families(), because the shape of a route number is
    not evidence about the road. _variant_tail() is what keeps the proposals narrow
    enough for those tests to be meaningful rather than a sieve.
    """
    rs = sorted(routes)
    pairs, claimed = [], set()
    for r in rs:
        for b in rs:
            if r != b and r.startswith(b) and _variant_tail(b, r[len(b):]):
                pairs.append((b, r)); claimed.add(r); break
    stems = {}
    for r in rs:
        if r in claimed:
            continue
        for cut in (1, 2):
            stem, tail = r[:-cut], r[-cut:]
            if len(stem) >= 2 and stem not in routes and _variant_tail(stem, tail):
                stems.setdefault(stem, []).append(r); break
    for stem, members in stems.items():
        if len(members) < 2:
            continue
        lead, rest = members[0], members[1:]
        pairs += [(lead, m) for m in rest]
    return pairs


def _variant_tail(stem, tail):
    """Is `tail` a VARIANT MARKER on `stem`, rather than the next route number?

    It is when it changes character class: a letter after a number (301 -> 301S,
    AW1 -> AW1X) or a number after a letter (ZIP -> ZIP2). Both are how an operator
    writes "this is a pattern of that service", and both are what the estate's real
    families look like.

    It is NOT when the tail continues the class, because then the two names are
    simply adjacent numbers in a range and nothing about them says one is the
    other's variant. This is the whole guard: without it "303" and "305" share the
    stem "30", "9" and "904" share the stem "9", and "400" and "401" share "40" --
    and Ramsey's 303 and 305 BOTH go to Huntingdon, so the destination test would
    not have caught them either. decollide_bearings() says why that merge would be
    wrong: they are genuinely distinct services, and spreading their spokes apart
    is the remedy, not claiming they are one line.
    """
    if not tail or not stem or not tail.isalnum():
        return False
    return stem[-1].isdigit() != tail[0].isdigit()


CELL_DEG = 0.001         # complexity_score.js's own cell, about 111 m


def path_cells(routes_paths):
    """{route: set(cell)} over the MATCHED paths -- complexity_score.js's measure.

    Deliberately the same arithmetic as that file's detectFamilies(), on the same
    `routes_paths.json`, so the drafter proposes only what the engine's own
    corridors_report.json would go on to confirm. Reproduced rather than imported
    because complexity_score.js is a CLI that wants a built S4, and the merge has
    to be decided in S3 -- which is the whole reason the after-the-fact report was
    never able to stop a bad bundle, only describe one. Checked against St Ives'
    report on 2026-09-22: 0.328 and 0.337 out of this, 0.328 and 0.337 out of it.
    """
    pts = {k: v.get("pts") or [] for k, v in (routes_paths.get("routes") or {}).items()}
    las = [p[0] for v in pts.values() for p in v]
    if not las:
        return {}
    lon_scale = math.cos(((min(las) + max(las)) / 2) * math.pi / 180) or 1.0
    cell_lo = CELL_DEG / lon_scale
    return {k: {(math.floor(p[0] / CELL_DEG), math.floor(p[1] / cell_lo)) for p in v}
            for k, v in pts.items()}


def _co_run(cells, member, lead):
    """MUTUAL overlap, as complexity_score.js insists and for its reason: a
    one-directional test bundles a short shuttle into the long trunk route it
    merely shares a mile with. Returns (shared_of_member, shared_of_lead)."""
    a, b = cells.get(member) or set(), cells.get(lead) or set()
    if not a or not b:
        return None
    inter = len(a & b)
    return inter / len(a), inter / len(b)


def weak_family_rows(cr):
    """corridors_report.json -> the lines the review should print, or [].

    THIS IS A CHECK THAT LIED, and the shape is why it is now a function with its
    own tests rather than four lines inside main(). It read `corridors[].overlap`
    and `corridors[].fraction`; the file has carried `families[].members[]
    .sharedFraction` and `families[].weakMembers[]` throughout. Neither key it
    looked for has ever existed, so it found nothing, and DRAFT-REVIEW.md printed
    "The engine's overlap report raised no warnings" beside a report flagging every
    member of St Ives' 301 family. A sentence asserting a finding about a file it
    never read is worse than no sentence: the reviewer stops looking.

    `sharedMin` comes from the report rather than from a constant here, because the
    engine owns that threshold and a second copy of it drifts.
    """
    floor = cr.get("sharedMin", MIN_CORUN)
    rows = []
    for fam in (cr.get("families") or cr.get("corridors") or []):
        lead = fam.get("lead", "?")
        seen = set()
        for mem in (fam.get("members") or []):
            frac = mem.get("sharedFraction", mem.get("overlap", mem.get("fraction")))
            if isinstance(frac, (int, float)) and frac < floor:
                route = mem.get("route", "?")
                seen.add(route)
                rows.append(f"{lead}/{route} shares {frac:.2f} of its drawn line "
                            f"(weakest against {mem.get('weakestAgainst', '?')})")
        for route in (fam.get("weakMembers") or []):
            if route not in seen:
                rows.append(f"{lead}/{route} flagged weak by the engine")
    return rows


def _dest_name(spoke):
    return (spoke or {}).get("label") or "(nowhere out of town)"


def _same_road(member_spoke, lead_spoke):
    """Do two spokes describe one service's road out of town?

    Yes when they name the same destination, and ALSO when one terminates at a
    place the other calls AT: 301 runs St Ives - Pidley - Warboys - Ramsey and
    301X stops at Warboys, so 301X is a short working of 301 and not a separate
    line. Requiring the labels to match outright refused that merge and left 301X
    in the palette with its own colour for a stretch of road already drawn.

    A shared destination is NOT on its own enough to merge -- Ramsey's 303 and 305
    both end at Huntingdon by different roads -- which is why this is only ever the
    second of two tests, behind the in-town co-run one.

    ONE SPOKE AND NO SPOKE IS A REFUSAL, both ways round, and Huntingdon's AW1 and
    AW1X are the measured case: every stop the map draws for AW1X is AW1's, but
    AW1X runs on to Alconbury Weald and AW1 stays in town. Fold them and the town
    loses the only line that reaches Alconbury Weald -- which reads to a passenger
    as "you cannot get there from here", the exact fault DRAFT-REVIEW.md item 15
    exists to stop. The other way round is no better: a member that never leaves
    town, badged onto the lead's spoke, claims a journey it does not run.
    """
    if not member_spoke or not lead_spoke:
        return member_spoke == lead_spoke        # both absent = both stay in town
    a, b = member_spoke.get("label"), lead_spoke.get("label")
    return a == b or a in (lead_spoke.get("stops") or []) or b in (member_spoke.get("stops") or [])


def variant_families(services, paths=None, dest=None):
    """Group a route with the variants that really are one line -> {lead:[members]}.

    Returns (families, rejected), rejected being [(lead, member, why)] so the draft
    review can print what was proposed and turned down.

    WHAT CHANGED IN OA-436, and why it cuts both ways. This used to read ONLY
    gtfs_query.py's `possibleVariantOf` and accept every declaration unexamined.
    That was wrong in both directions, and both were measured on 2026-09-22:

      TOO NARROW. `possibleVariantOf` needs the BASE ROUTE to be in the feed at
      this town. Chatteris carries ZIP2 and ZIP3 and no ZIP, so the feed declared
      nothing and a human put them on one spoke by hand. _sibling_pairs() now
      proposes those too.

      TOO WIDE, and this is the expensive half. The feed declares 301S a pattern of
      301 at St Ives, and on the drawn lines 301S shares 7% of its path with 301
      while 301 shares 36% of its with 301S: 301S runs right round the town by
      Burleigh Centre, Burrel Road, Cambridge Drive and Chestnut Road, and 301 does
      not go near any of them. Accepting that declaration and taking 301S out of
      the palette would have deleted a line of real ink and left the sheet claiming
      301 covers ground it never sees.

    SO THE TEST IS THE ENGINE'S OWN, RUN EARLY. corridors_report.json already
    measures exactly this -- mutual 111m-cell overlap of the matched paths -- but it
    is written in S4, after the bundle has been configured and drawn, so it could
    only ever describe a bad bundle and never prevent one. path_cells() computes
    the same number in S3 off the same S2 file, so the draft proposes only what the
    report would confirm.

    A SECOND MEASURE WAS TRIED FIRST AND WAS WRONG, which is why this says which.
    Counting shared IN-TOWN STOPS instead accepted St Ives' 301V and 301X (their
    three drawn stops are 301's) and Chatteris' ZIP3 (all nine are ZIP2's). The
    matched paths refuse all three, and on Chatteris the refusal is checkable: the
    live sheet draws ZIP2 and ZIP3 as two lines sharing one spoke, which is what
    0.534 mutual overlap should produce. A stop list is not the ink.

    Then the destinations, because geometry alone still bundles Huntingdon's 303
    and 305 (identical in town) and 301 with 302 at St Ives (mutual overlap 1.000,
    one going to Ramsey and the other to March).

    THE NUMBER IS NOT STABLE BETWEEN RUNS, and a draft is the right place for that
    to be true. The matched path comes from pull_roads.js's LIVE Overpass query, so
    two drafts of the same town on the same feed can disagree: St Ives' 301S
    against 301 measured 0.069/0.358 on one run and 0.18/0.54 on the next, the
    route set being identical both times. Far from the threshold that changes
    nothing -- every member of that family was refused both times -- but a pair
    sitting near 0.6 could merge on one draft and not the next, so the answer is
    reported and never assumed: every merge AND every refusal is printed with its
    own number, to stdout and into DRAFT-REVIEW.md, for somebody to agree with.

    `paths` is routes_paths.json, S2's matched geometry. `dest` is {route: spoke}
    taken BEFORE the merge, each spoke carrying its `label` and ordered `stops`.
    Called with neither, every proposal is accepted and the behaviour is the old
    one, which is what keeps the unit tests honest about the difference.
    """
    known = {s["route"] for s in services}
    cells = path_cells(paths) if paths else None
    fam, rejected = {}, []
    for lead, member in _sibling_pairs(known):
        if cells:
            share = _co_run(cells, member, lead)
            if share is None:
                rejected.append((lead, member,
                    f"{member} or {lead} has no matched path in this town, so there is nothing "
                    f"to compare -- left as its own route rather than bundled on trust"))
                continue
            if min(share) < MIN_CORUN:
                rejected.append((lead, member,
                    f"the drawn lines share {share[0]:.0%} of {member} and {share[1]:.0%} of "
                    f"{lead} (the engine's own corridor threshold is {MIN_CORUN:.0%} BOTH ways) "
                    f"-- bundling them would draw one line where the map has two"))
                continue
        if dest is not None and not _same_road(dest.get(member), dest.get(lead)):
            dm, dl = dest.get(member), dest.get(lead)
            if bool(dm) != bool(dl):
                out, stays = (member, lead) if dm else (lead, member)
                why = (f"{out} leaves town for {_dest_name(dm or dl)} and {stays} does not, so "
                       f"folding them would put {stays} on a spoke it never runs, or drop "
                       f"{out}'s destination off the map altogether")
            else:
                why = (f"{member} goes to {_dest_name(dm)} and {lead} to {_dest_name(dl)}, and "
                       f"neither terminus is a place the other calls at -- same stem, "
                       f"different service")
            rejected.append((lead, member, why))
            continue
        fam.setdefault(lead, []).append(member)
    return {lead: sorted(m) for lead, m in fam.items()}, rejected


def decollide_bearings(spokes, min_gap=20):
    """Nudge spokes apart so two destinations don't overprint.

    gen_external_radial.js drops or overlaps a lozenge that collides with another,
    which is how Ramsey's 303 and 305 (both Huntingdon, both bearing 201) became
    one unreadable stack. These are genuinely distinct services, so merging them
    would be an unfounded real-world claim -- spreading them is not.
    """
    for _ in range(40):
        order = sorted(spokes, key=lambda s: s["bearing"])
        moved = False
        for i in range(len(order) - 1):
            gap = order[i + 1]["bearing"] - order[i]["bearing"]
            if gap < min_gap:
                shift = (min_gap - gap) / 2 + 0.5
                order[i]["bearing"] = (order[i]["bearing"] - shift) % 360
                order[i + 1]["bearing"] = (order[i + 1]["bearing"] + shift) % 360
                moved = True
        if not moved:
            break
    for s in spokes:
        s["bearing"] = round(s["bearing"]) % 360
    return spokes


def _bearing(la1, lo1, la2, lo2):
    y = math.sin(math.radians(lo2 - lo1)) * math.cos(math.radians(la2))
    x = (math.cos(math.radians(la1)) * math.sin(math.radians(la2))
         - math.sin(math.radians(la1)) * math.cos(math.radians(la2)) * math.cos(math.radians(lo2 - lo1)))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def termini_for_route(chain, ll, prefix, namer, town=None):
    """internalRoads.termini entry: the place each drawn tail heads towards.

    Under internalRoads a single-ended destination auto-routes to whichever
    frame-cut tail exists (see the s2-geometry gotcha), so a route with one
    out-of-town end needs only one key. Both ends are given when they differ.
    """
    dirs = chain.get("canonical") or chain.get("directions") or []
    if not dirs:
        return None
    stops = [a for a in dirs[0]["stops"] if a in ll]
    if len(stops) < 2:
        return None
    ends = {}
    for key, a in (("start", stops[0]), ("end", stops[-1])):
        _v = namer.in_town(a, town) if town else None
        if (a.startswith(prefix) if _v is None else _v):
            continue                                  # that tail terminates in town
        nm, ok = namer.name(a, ll[a][0], ll[a][1])
        if nm:
            ends[key] = nm if ok else f"{nm} <check>"
    if len(set(ends.values())) == 1 and len(ends) == 2:
        ends.pop("start")                             # circular-ish: one label is enough
    return ends or None


# ------------------------------------------------------------------ Overpass
def overpass(query, dest):
    d = None
    for host in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
        try:
            req = urllib.request.Request(host, data=urllib.parse.urlencode({"data": query}).encode(), headers=UA)
            d = json.load(urllib.request.urlopen(req, timeout=90))
            break
        except Exception:
            d = None
            time.sleep(1)
    if d is None:
        d = {"elements": []}
    json.dump(d, open(dest, "w", encoding="utf-8"), ensure_ascii=False)
    return d


def pois_query(bbox):
    box = f'{bbox["s"]},{bbox["w"]},{bbox["n"]},{bbox["e"]}'
    return f"""[out:json][timeout:90];
(
  node["highway"="bus_stop"]({box});
  node["amenity"~"^(pharmacy|doctors|hospital|library|school|museum|community_centre|theatre|townhall)$"]({box});
  way["amenity"~"^(pharmacy|doctors|hospital|library|school|museum|community_centre|theatre|townhall)$"]({box});
  node["shop"="supermarket"]({box});
  way["shop"="supermarket"]({box});
  node["leisure"~"^(sports_centre|fitness_centre|park|recreation_ground)$"]({box});
  way["leisure"~"^(sports_centre|fitness_centre|park|recreation_ground)$"]({box});
)
;
out center tags;"""


def feature_query(bbox, feat):
    box = f'{bbox["s"]},{bbox["w"]},{bbox["n"]},{bbox["e"]}'
    t, lab = feat["type"], feat["label"]
    if t == "river":
        sel = f'way["waterway"="river"]["name"="{lab}"]({box})'
    elif t == "canal":
        sel = f'way["waterway"="canal"]["name"="{lab}"]({box})'
    elif t == "railway":
        sel = f'way["railway"="rail"]({box})'
    else:
        sel = f'way["highway"~"^(trunk|primary)$"]["ref"="{lab}"]({box})'
    return f"[out:json][timeout:60];({sel};);out geom;"


# ---------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("town")
    ap.add_argument("--region", default="Cambridgeshire")
    ap.add_argument("--centre")
    ap.add_argument("--radius-km", type=float, default=1.6)
    ap.add_argument("--expiring-days", type=int, default=28,
                    help="A5: drop a service whose GTFS registration ends within this many "
                         "days of the build. Negative turns the rule off. See "
                         "bootstrap_town.py's drop_undrawable().")
    ap.add_argument("--max-edge-km", type=float, default=2.5,
                    help="town-edge cap for the drawn buffer stops (derive_intown)")
    ap.add_argument("--buses-root", default=None)
    ap.add_argument("--naptan", default=None,
                    help="NaPTAN stop register; defaults to "
                         "<buses-root>/_gtfs/naptan.sqlite. It is what makes place "
                         "names authoritative rather than reverse-geocoded.")
    ap.add_argument("--db", default=None,
                   help="this region's sqlite. NO DEFAULT - every region is treated the same (see _gtfs/regions.json); $GTFS_DB also works.")
    a = ap.parse_args()
    a.buses_root = cli.resolve_buses(a.buses_root)
    # No default region: resolve --db / $GTFS_DB, or fail listing the built regions.
    a.db = gtfs_regions.resolve_db(a.db)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    town_dir = os.path.join(a.buses_root, "Areas", a.town)
    py = sys.executable
    namer = PlaceNamer(a.naptan or os.path.join(a.buses_root, "_gtfs", "naptan.sqlite"))

    # ---- scaffold: init + S1 + bootstrap draft + town_prefixes registration
    scaffold = [py, os.path.join(HERE, "scaffold_town.py"), a.town,
                "--region", a.region, "--radius-km", str(a.radius_km),
                "--buses-root", os.path.join(a.buses_root, "Areas"), "--db", a.db,
                "--expiring-days", str(a.expiring_days)]
    if a.centre:
        scaffold += ["--centre", a.centre]
    out = run(scaffold)
    print(out)
    m = re.search(r"^S1 dir: (.+)$", out, re.M)
    if not m:
        raise SystemExit("could not find S1 dir in scaffold_town.py output")
    s1 = m.group(1).strip()
    draft = json.load(open(os.path.join(s1, "routes.draft.json"), encoding="utf-8"))
    prefix = draft["atcoPrefix"]

    # ---- S1: GTFS-only verified-services.json (no bustimes/operator cross-check)
    # A5: bootstrap's drops travel in routes.draft.json and land in the S1 record's
    # notOnLeaflet[], so the S1 record and the config agree about what is drawn.
    routes = build_verified_services(os.path.join(s1, "gtfs-services.json"),
                                     os.path.join(s1, "verified-services.json"),
                                     draft.pop("_droppedServices", []))
    node("stage.js", "commit", "S1", s1,
         "--outputs", "verified-services.json,routes.draft.json,gtfs-services.json,bootstrap-report.md",
         "--note", "Tier-2 auto-draft (item 8): GTFS-only, not cross-checked vs bustimes/operator",
         cwd=town_dir)

    # ---- S2: geometry
    s2 = node("stage.js", "new", "S2", cwd=town_dir)
    print("S2 dir:", s2)

    chains = gtfs_full_chains(a.db, routes, prefix)
    json.dump(chains, open(os.path.join(s2, "routes_full_atco.json"), "w", encoding="utf-8"), ensure_ascii=False)
    all_atco = sorted(set(x for r in chains.values() for x in r["all"]))
    ll, nm = gtfs_coords(a.db, all_atco)
    json.dump(ll, open(os.path.join(s2, "atco2ll.json"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(nm, open(os.path.join(s2, "atco2name.json"), "w", encoding="utf-8"), ensure_ascii=False)
    missing_coords = [x for x in all_atco if x not in ll]
    if missing_coords:
        print(f"WARNING: {len(missing_coords)}/{len(all_atco)} stops have no GTFS lat/lon")

    intown_cfg = {"prefix": prefix, "buf": 1, "anchor": draft["anchor"], "maxEdgeKm": a.max_edge_km}
    json.dump(intown_cfg, open(os.path.join(s2, "intown_cfg.json"), "w", encoding="utf-8"), ensure_ascii=False)
    node("derive_intown.js", os.path.join(s2, "routes_full_atco.json"), os.path.join(s2, "atco2ll.json"),
         os.path.join(s2, "intown_cfg.json"), os.path.join(s2, "routes_intown_atco.json"))
    shutil.copy(os.path.join(s2, "routes_intown_atco.json"), os.path.join(s2, "routes_atco.json"))

    if a.centre:
        clat, clon = [float(x) for x in a.centre.split(",")]
    else:
        clat, clon = ll.get(draft["anchor"], (None, None))
    if clat is None:
        raise SystemExit("no centre available for POI/feature bbox")
    pad = 0.02
    bbox = {"s": clat - pad, "n": clat + pad, "w": clon - pad * 1.4, "e": clon + pad * 1.4}
    overpass(pois_query(bbox), os.path.join(s2, "osm.json"))
    json.dump({"elements": []}, open(os.path.join(s2, "osm2.json"), "w", encoding="utf-8"))

    # features_geo.json[key] = list of segments, each a list of [lat,lon] pairs
    # (drawFeature draws each segment as a polyline) -- NOT raw Overpass elements.
    features_geo = {}
    for feat in draft.get("features", []):
        d = overpass(feature_query(bbox, feat), os.path.join(s2, f"_feat_{feat['key']}.json"))
        features_geo[feat["key"]] = [[[p["lat"], p["lon"]] for p in el["geometry"]]
                                     for el in d.get("elements", []) if el.get("geometry")]
    json.dump(features_geo, open(os.path.join(s2, "features_geo.json"), "w", encoding="utf-8"), ensure_ascii=False)

    # reachExtend for every route: without it (and with --max-edge-km's tight
    # default), pull_roads.js/match_routes.js never reach past the last in-town
    # stop, so every exit arrow stops at an interior junction instead of the frame
    # edge. Chatteris v1.1 shipped that way; v1.2 fixed it by hand.
    match_cfg = {"reachExtend": {r: {"start": 1, "end": 1} for r in routes}}
    json.dump(match_cfg, open(os.path.join(s2, "match_cfg.json"), "w", encoding="utf-8"), ensure_ascii=False)

    # ---- the ROAD SKELETON: what internalRoads draws its lines along. Both of
    #      these are fully deterministic; skipping them (v1 of this script) is
    #      what cost the draft its road names, badges, arrows and north arrow.
    # Overpass fails transiently under repeated use (it 429s/times out, then works
    # on the next attempt). Unattended, a single blip would otherwise strand a
    # half-built town, so retry with a backoff before giving up.
    print("pulling road graph (Overpass)...")
    for attempt in range(4):
        if node("pull_roads.js", cwd=s2, check=(attempt == 3)) is not None and \
                os.path.exists(os.path.join(s2, "roads_geo.json")):
            break
        print(f"  Overpass attempt {attempt + 1} failed; retrying...")
        time.sleep(15 * (attempt + 1))
    print("map-matching routes onto roads...")
    node("match_routes.js", cwd=s2)

    def score():
        try:
            return json.loads(node("complexity_score.js", "--dir", s2, "--json", "--no-fail", check=False))
        except Exception:
            return {"band": "UNKNOWN"}

    complexity = score()
    band = complexity.get("band", "UNKNOWN")
    print(f"complexity band: {band}")

    # AMBER policy follows the skill's own rule (s2-geometry.md step 7): apply the
    # mechanical remedies and KEEP GOING -- "do not pause; an amber that interrupts
    # an ordinary town will get ignored". Only RED stops. Rung 0 (skipRoutes for a
    # service that barely touches the town) is the only rung curate_services.js
    # auto-applies; rungs 1+ are claims about the real world and stay human, so
    # they are reported in DRAFT-REVIEW.md instead of guessed at.
    curated = []
    if band == "AMBER":
        print("AMBER -- applying rung 0 (curate_services.js --apply), then re-scoring...")
        node("curate_services.js", "--apply", cwd=s2, check=False)
        node("match_routes.js", cwd=s2)                  # rung 0 changes the geometry
        complexity = score()
        newband = complexity.get("band", "UNKNOWN")
        curated.append(f"rung 0 auto-applied; band {band} -> {newband}")
        print(f"  after rung 0: {newband}")
        band = newband
    ladder = [f"rung {l.get('rung')}: {l.get('action')} -> predicted {l.get('band')}"
              for l in complexity.get("ladder", [])]

    node("stage.js", "commit", "S2", s2,
         "--outputs", "atco2ll.json,atco2name.json,osm.json,osm2.json,features_geo.json,"
                      "routes_full_atco.json,routes_intown_atco.json,routes_atco.json,"
                      "roads_geo.json,routes_paths.json,complexity.json,match_cfg.json",
         "--note", f"Tier-2 auto-draft: GTFS-only chains/coords, live Overpass POIs/features/roads, "
                   f"map-matched. Complexity: {band}."
                   + (" Remedies: " + "; ".join(curated) if curated else ""),
         cwd=town_dir)

    if band == "RED":
        review = os.path.join(town_dir, "DRAFT-REVIEW.md")
        rungs = "\n".join(f"- {r}" for r in ladder) or "- (no ladder offered)"
        open(review, "w", encoding="utf-8").write(
            f"# {a.town} -- Tier-2 auto-draft STOPPED (complexity RED)\n\n"
            f"The complexity gate came back **RED**: do not build the standard single sheet "
            f"without choosing a strategy first (`references/complexity-triage.md`). That is a "
            f"real per-town design decision -- which route families are genuinely one corridor, "
            f"whether to colour by corridor, or whether to decline the whole-town map and ship "
            f"place-centred leaflets instead -- and is not something this script should guess.\n\n"
            f"Metrics: `{json.dumps(complexity.get('metrics', {}))}`\n\n"
            f"Remedy ladder offered:\n{rungs}\n\n"
            f"S1 (GTFS-only services) and S2 (geometry, roads, complexity.json) are committed and "
            f"reusable -- pick a strategy, then continue manually from S3.\n")
        print(f"STOPPED (RED) -- see {review}")
        return

    # ---- S3: routes.json -- the CURRENT-standard config, not a v1 one
    anchor_ll = ll[draft["anchor"]]
    print("naming places (reverse-geocode, cached per ATCO locality)...")
    # S1's GTFS facts carry NO `key` field -- that is added later, by curation -- so
    # this genuinely is keyed on the route number, and a town with two same-numbered
    # routes would silently give one operator's days and headsigns to the other's
    # spoke. Refuse instead: an auto-draft that cannot tell two routes apart should
    # stop and say so, not guess. See OA-134.
    facts_by_route = index_guard.index_unique(
        json.load(open(os.path.join(s1, "gtfs-services.json"), encoding="utf-8")).get("services", []),
        key=lambda s: str(s["route"]),
        what="draft_town S1 gtfs-services.json")
    externals, termini, unnamed, through, end_choices = [], {}, [], [], []
    for r in draft.get("routeOrder", routes):
        ch = chains.get(r)
        if not ch:
            continue
        sp = spoke_for_route(ch, ll, prefix, anchor_ll, namer, a.town)
        if sp:
            svc = facts_by_route.get(r, {})
            externals.append({"route": r, "label": sp["label"], "days": svc.get("days", ""),
                              "bearing": sp["bearing"], "side": "up", "stops": sp["stops"]})
            if "<check>" in sp["label"]:
                unnamed.append(f"external spoke {r} -> {sp['label']}")
            if sp.get("otherEnd"):
                through.append(f"{r} also reaches {sp['otherEnd']} (it runs THROUGH "
                               f"the town; only {sp['label']} gets a spoke)")
            # OA-436, in place of A13: the label is a CHOICE wherever the route's
            # own patterns offer more than one end. See _end_candidates().
            if sp.get("endChoice"):
                alts = ", ".join(f"{c['place']} ({c['km']} km, on a {c['onPattern']}-stop pattern)"
                                 for c in sp["endChoice"])
                end_choices.append(f"**{r}** is labelled **{sp['label']}** "
                                   f"({sp['far_km']} km) -- it could also have been {alts}")
        t = termini_for_route(ch, ll, prefix, namer, a.town)
        if t:
            termini[r] = t
            for v in t.values():
                if "<check>" in v:
                    unnamed.append(f"terminus label {r} -> {v}")

    # ---- merge GTFS-declared route variants onto ONE spoke / ONE internal line.
    #      s3-config.md: "Pick the same lead as external[].routes" so a family keeps
    #      the same colour on both sheets.
    all_services = list(facts_by_route.values())
    # A12: the test is the MATCHED PATH the sheet will draw (S2's routes_paths.json,
    # measured exactly as corridors_report.json measures it), and where each route
    # goes, taken from the spokes before the merge removes the members' own
    # entries. See variant_families() for why the stop list was not enough.
    paths = json.load(open(os.path.join(s2, "routes_paths.json"), encoding="utf-8"))
    spoke_dest = {e["route"]: e for e in externals}
    families, fam_rejected = variant_families(all_services, paths, spoke_dest)
    for lead, member, why in fam_rejected:
        print(f"  NOT merged onto {lead}: {member} -- {why}")
    merged_away = {m for members in families.values() for m in members}
    kept = []
    for e in externals:
        if e["route"] in merged_away:
            continue
        members = families.get(e["route"])
        if members:
            e["routes"] = [e["route"], *members]
        kept.append(e)
    externals = decollide_bearings(kept)
    draft["external"] = externals
    # A12 -- AND TAKE THE MERGED MEMBERS OUT OF EVERY ROUTE-KEYED MAP, which until
    # OA-436 the merge did not do. It removed 301S/301V/301X from external[] and
    # recorded the family in internalCorridors, but bootstrap_town.py had already
    # given each of them its own palette colour, its own routeOrder and panelOrder
    # slot, its own internalDesc line and its own row under the operator -- so the
    # draft still shipped twelve routes where the live St Ives map has nine, and the
    # Services panel listed three variants that no line on either sheet draws. A
    # route merged onto another's line is not a route this map has; it is a member
    # of one. The internalCorridors entry below is where it still exists.
    if merged_away:
        for key in ("palette", "textOn", "internalDesc"):
            if isinstance(draft.get(key), dict):
                draft[key] = {r: v for r, v in draft[key].items() if r not in merged_away}
        for key in ("routeOrder", "panelOrder"):
            if isinstance(draft.get(key), list):
                draft[key] = [r for r in draft[key] if r not in merged_away]
        draft["operators"] = [o for o in ({**o, "routes": [r for r in o.get("routes", [])
                                                           if r not in merged_away]}
                                          for o in draft.get("operators", []))
                              if o["routes"]]
        if draft.get("orientationRoute") in merged_away:
            draft["orientationRoute"] = (draft["routeOrder"] or [""])[0]
        if draft.get("routeOrder"):
            draft["titleColor"] = draft["palette"].get(draft["routeOrder"][0], draft["titleColor"])
        print(f"  merged variants removed from palette/order/desc/operators: "
              f"{', '.join(sorted(merged_away))}")
    # internalRoads: THE standard drawing model -- all 7 built towns use it. Gates
    # route badges, "to X" terminus arrows, road names/labels, the north arrow, the
    # version stamp and the focus compression (see gen_internal.js `IR`).
    draft["internalRoads"] = {"focus": {"coreKm": 0.9, "comp": 0.3},
                              "roadLabelMax": 16, "badgeEvery": 70,
                              "termini": {r: t for r, t in termini.items() if r not in merged_away}}
    if families:
        draft["internalCorridors"] = families
    if not draft.get("features"):
        # gen_internal.js's no-features fallback ALWAYS synthesizes a "River Great
        # Ouse" label at a fixed position regardless of whether the town has one --
        # correct for St Ives/March (gated), a false claim anywhere else. An
        # explicit placeholder with labelPos:null suppresses it without touching
        # the shared engine (which would need the full byte-identical re-gate).
        draft["features"] = [{"key": "_none", "type": "generic", "label": "", "labelPos": None}]
    lead_of = {m: lead for lead, members in families.items() for m in members}
    for r in list(draft.get("internalDesc", {})):
        f = facts_by_route.get(r, {})
        # A variant merged onto its family's spoke has no external[] entry of its
        # own, so look up the LEAD's destination -- otherwise it falls back to the
        # GTFS headsign, which is the street-name trap all over again ("Ramsey -
        # Bus Station" for 301S/301V/301X).
        key = r if any(e["route"] == r for e in externals) else lead_of.get(r, r)
        dest = next((e["label"] for e in externals if e["route"] == key), None)
        if not dest:
            dest = (f.get("headsigns") or f.get("termini") or ["<dest>"])[0]
        draft["internalDesc"][r] = [f"{a.town} - {dest}", f.get("days", "")]
    draft["validFrom"] = date.today().strftime("%B %Y")
    draft["version"] = "1.0"
    draft["_bootstrap"] = ("Tier-2 auto-draft (process-efficiency-plan item 8, "
                           + date.today().isoformat() + "): unattended, unreviewed. See "
                           "DRAFT-REVIEW.md before treating this as a real leaflet.")

    s3 = node("stage.js", "new", "S3", cwd=town_dir)
    rj = os.path.join(s3, "routes.json")
    json.dump(draft, open(rj, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    # approximate journey times -- every built town carries these
    print("filling minutesToDestination...")
    run([py, os.path.join(HERE, "gtfs_duration.py"), prefix, "--fill", rj, "--db", a.db], check=False)
    draft = json.load(open(rj, encoding="utf-8"))
    filled = sum(1 for e in draft.get("external", []) if "minutesToDestination" in e)
    print(f"  {filled}/{len(draft.get('external', []))} spokes have a journey time")

    node("stage.js", "commit", "S3", s3, "--outputs", "routes.json",
         "--note", "Tier-2 auto-draft: internalRoads + reverse-geocoded place names + GTFS durations",
         cwd=town_dir)

    # ---- S4: generate, routed through build_s4.js (OA-431) -- a bare copy-and-run
    #      of the two generators sets no SKILL_ASSETS, which engine_paths.js (OA-342)
    #      refuses: "no engine to resolve ... from". build_s4.js is the one place an
    #      S4's sheets are drawn (buses-data OA-310) and sets SKILL_ASSETS itself.
    s4 = node("stage.js", "new", "S4", "--bump", "major", cwd=town_dir)
    node("stage.js", "pull", "S2", s4, cwd=town_dir)
    node("stage.js", "pull", "S3", s4, cwd=town_dir)
    # both footer stamps (engine hash + design.sheetVersion) BEFORE generation, or
    # the sheets are drawn without them -- Chatteris v1.1 stamped after and both
    # footers read no "build 1.0" until the sheets were redrawn.
    node("stage.js", "stamps", s4, cwd=town_dir)
    node("build_s4.js", cwd=s4)
    # corridors_report.json is the engine's own confirmation of the bundles the
    # merge above proposed. s4-s5-build-and-render.md: "a family that warns should
    # be dropped, not shipped" -- so it is surfaced rather than silently accepted.
    # weak_family_rows() says what it used to read instead, and what that cost.
    weak_families = []
    cr_path = os.path.join(s4, "corridors_report.json")
    if os.path.exists(cr_path):
        try:
            weak_families = weak_family_rows(json.load(open(cr_path, encoding="utf-8")))
        except Exception:
            pass
    outputs = "internal.svg,external.svg,build-warnings.txt" + (",corridors_report.json" if os.path.exists(cr_path) else "")
    node("stage.js", "commit", "S4", s4, "--outputs", outputs,
         "--based-on", f"S2={os.path.basename(s2)};S3={os.path.basename(s3)}",
         "--note", "Tier-2 auto-draft build", cwd=town_dir)

    # ---- S5: render
    s5 = node("stage.js", "new", "S5", cwd=town_dir)
    node("stage.js", "pull", "S4", s5, cwd=town_dir)
    node("render.js", os.path.join(s5, "internal.svg"), os.path.join(s5, "internal.jpg"))
    node("render.js", os.path.join(s5, "external.svg"), os.path.join(s5, "external.jpg"))
    node("stage.js", "commit", "S5", s5, "--outputs", "internal.jpg,external.jpg", cwd=town_dir)
    node("refresh_latest.js", town_dir)

    nocheck = "\n".join(f"   - {u}" for u in unnamed) or "   - (none -- every place name resolved confidently)"
    # A12: the proposals that were TURNED DOWN are the half a reviewer cannot
    # reconstruct. "No variants were bundled" reads as "the feed declared none";
    # naming the refusals says a merge was considered and why the map refused it.
    rejected_block = ("\n".join(f"    - **{m}** was NOT bundled onto {lead}: {why}"
                                for lead, m, why in fam_rejected)
                      if fam_rejected else
                      "    - (no bundle was proposed and turned down)")
    end_choice_block = ("\n".join(f"    - {c}" for c in end_choices)
                        if end_choices else
                        "    - (every spoke had exactly one candidate end)")
    through_block = ("\n".join(f"    - {t}" for t in through)
                     or "    - (none -- every route ends in this town)")
    if band == "GREEN":
        amber_block = ""
    else:
        rungs = "\n".join(f"- {r}" for r in ladder) or "- (no ladder offered)"
        amber_block = (
            f"\n> **This town scored {band}, not GREEN, after the road match.** The draft was still\n"
            f"> built (the skill's rule for AMBER is apply-the-mechanical-remedies-and-continue), but\n"
            f"> the map is carrying more overlap than the standard comfortably takes. The gate's\n"
            f"> remaining ladder, which needs a HUMAN decision because each rung is a claim about the\n"
            f"> real world, not a mechanical edit:\n>\n"
            + "\n".join(f"> {r}" for r in rungs.splitlines())
            + f"\n>\n> Metrics: `{json.dumps(complexity.get('metrics', {}))}`\n")
    review = os.path.join(town_dir, "DRAFT-REVIEW.md")
    open(review, "w", encoding="utf-8").write(f"""# {a.town} -- Tier-2 auto-draft, NOT reviewed

Built unattended by `draft_town.py` (process-efficiency-plan item 8, {date.today().isoformat()}).
Complexity: **{band}**{(" (" + "; ".join(curated) + ")") if curated else ""}. Images are in `_latest\\`.
{amber_block}
Before this ships as a real leaflet:

1. **Services (S1) were never cross-checked.** `verified-services.json` is straight
   GTFS/BODS with no bustimes.org pass and no operator-timetable check -- every route
   is flagged `"verified": false`. **Community / demand-responsive / pre-book services
   are NOT included** (BODS doesn't carry them) -- check bustimes.org's locality page
   by hand for anything missing. No `disagreements.docx` was produced.
2. **Route geometry came from the GTFS dataset's own trip patterns**, not a bustimes
   stop-order scrape -- it only ever draws what BODS itself thinks the route does; a
   route with no GTFS trips (pure DRT) is missing from the map entirely.
3. **{"No stops are missing coordinates." if not missing_coords else f"{len(missing_coords)} stop(s) had no GTFS lat/lon and were dropped from the drawn chains -- check for a route that looks truncated."}**
4. **Place names are REVERSE-GEOCODED, not authoritative.** GTFS has no locality
   column and this region's operators publish street-level headsigns, so every
   terminus/intermediate place name came from Nominatim (cached per ATCO locality).
   Anything it could not resolve to a settlement is labelled `<check>`:
{nocheck}
   Search the config and both maps for `<check>` and replace by hand.
5. **{"No linear feature (river/canal/railway/road) was found or drawn -- add one by hand once you've confirmed a candidate." if draft["features"][0].get("key") == "_none" else "Linear feature(s) were auto-picked by bootstrap_town.py (top OSM ranked candidates) and never confirmed -- check they're right and watch the river-blue palette clash."}**
6. **POIs are un-approved** -- the full auto OSM set was drawn without the normal
   human "does this list look right" pass.
7. **Palette is the untouched Tol-Bright default** -- not a deliberate choice, and not
   checked against the river-blue clash rule.
8. **`internalRoads` was configured with generic defaults**
   (`focus.coreKm 0.9 / comp 0.3`, `roadLabelMax 16`, `badgeEvery 70`, `maxEdgeKm
   {a.max_edge_km}`) -- these are March's values, not tuned to this town. Expect to
   adjust the zoom/compression so the town core fills the page, and check every
   "to X" terminus arrow landed on the right arm.
9. **No S6 verification (red-team) was run.** Run `stage.js new S6` and follow
   `references/s6-verify.md` before treating this as trustworthy.
10. **`internalDesc` subtitles are auto-generated** from the derived terminus and
    GTFS days -- proofread the Services panel text.
11. **The footer credits "bustimes.org (operator-verified)"** -- the engine's generic
    default, and **not true** for this draft (see point 1). Left as-is rather than
    editing the shared generator; override it by hand once the real S1 pass is done.
12. **{filled}/{len(draft.get("external", []))} external spokes have a journey time.**
    `gtfs_duration.py --fill` skips round-trip/circular services and anything with
    fewer than 3 sampled trips -- fill the rest by hand or leave them absent.
13. **Check the external map's spoke count against the Services legend** --
    `gen_external_radial.js` drops a spoke whose label box collides with another;
    fix `side`/`bearing` for any route that went missing. Spoke bearings were
    auto-spread to keep destination lozenges apart, so they are no longer the true
    compass bearings derived from the stops.
14. **{f"Route variants were bundled into one line/spoke: {json.dumps(families)}" if families else "No route variants were bundled."}**
    A bundled member has been taken out of the palette, the route order, the Services
    panel and the operator list: it is a badge on the lead's spoke and its stops are
    already on the lead's line. It was only bundled because at least
    {int(MIN_CORUN*100)}% of the stops this map draws for it are the lead's AND both
    ends name the same destination -- but that is still a claim worth eyeballing.
{rejected_block}
    {"**The engine's corridors_report.json flags these as weakly-overlapping (<0.6) -- s4-s5-build-and-render.md says drop a family that warns: " + "; ".join(weak_families) + "**" if weak_families else "The engine's overlap report raised no warnings." if families else ""}
15. **Routes running THROUGH the town reach a second destination that has no spoke.**
    A spoke is one direction of travel, so a through service can only draw one of its
    two ends and the other is silently absent from "Buses from {a.town} to nearby
    places" -- which reads to a passenger as "you cannot get there from here". Decide
    for each whether to add a second spoke (pick a `bearing` and re-check collisions)
    or to accept the omission:
{through_block}
16. **Where a spoke's label was a CHOICE, these are the ends it was chosen between.**
    The drafter picks the farthest end of the route's own stop patterns, which is a
    rule and not a fact: on the six spokes measured for this on 2026-09-22 the live
    sheet named the OTHER end every time -- Hinchingbrooke rather than Cambridge on
    St Ives' B, Bedford rather than Cambridge on St Neots' 905, Downham Market
    rather than Three Holes on Wisbech's 60. Which end a through route draws is a
    decision about the whole sheet, and a circular has no far end at all, so this
    lists the alternatives rather than guessing between them. Check each one:
{end_choice_block}

Recommended next step: work through `references/s1-services.md` for a real S1 pass
(replacing the auto-drafted `verified-services.json`), then re-run S2 onward normally.
""")
    print(f"\nDraft complete: {a.town}")
    print(f"  Images: {os.path.join(town_dir, '_latest')}")
    print(f"  Review checklist: {review}")
    if unnamed:
        print(f"  {len(unnamed)} place name(s) flagged <check>")
    if through:
        print(f"  {len(through)} through-route destination(s) with no spoke -- see DRAFT-REVIEW item 15")


if __name__ == "__main__":
    main()
