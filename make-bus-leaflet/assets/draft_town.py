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
    """Reverse-geocode a stop to its SETTLEMENT name, cached per ATCO locality.

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

    def __init__(self, delay=1.1):
        self.cache = {}
        self.delay = delay
        self._last = 0.0

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
def build_verified_services(gtfs_services_path, out_path):
    facts = json.load(open(gtfs_services_path, encoding="utf-8"))
    services = facts["services"] if "services" in facts else facts
    verified = [{**s, "verified": False,
                 "verifySource": "GTFS only (Tier-2 auto-draft) -- NOT cross-checked against "
                                 "bustimes.org or the operator's own timetable; community/DRT "
                                 "services absent from BODS are NOT included"}
                for s in services]
    json.dump({"services": verified}, open(out_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
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
def spoke_for_route(chain, ll, prefix, anchor_ll, namer):
    """Derive one external spoke from a route's canonical chain.

    Picks the direction whose far end is farthest from the anchor, then walks
    OUTWARD from the last in-town stop collecting distinct settlement names --
    giving the ordered intermediate places ... terminus list gen_external_radial.js
    draws, and that gtfs_duration.py --fill matches its destination on (it uses
    the LAST name in "stops").
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
    last_in_town = max((i for i, a in enumerate(stops) if a.startswith(prefix)), default=-1)
    outward = stops[last_in_town + 1:] if last_in_town >= 0 else stops
    if not outward:
        return None
    places, seen = [], set()
    for a in outward:
        nm, ok = namer.name(a, ll[a][0], ll[a][1])
        if nm and nm not in seen:
            seen.add(nm); places.append(nm if ok else f"{nm} <check>")
    if not places:
        return None
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
    return {"label": places[-1], "stops": places, "bearing": round(bearing),
            "far_km": round(dist, 1)}


def variant_families(services):
    """Group a route with its GTFS-declared variants -> {lead: [members...]}.

    Uses ONLY gtfs_query.py's own `possibleVariantOf` field, i.e. the dataset's
    declaration that 301S/301V/301X are patterns of 301. That is a much narrower
    claim than the general rung-1 "these different services co-run" (which
    complexity-triage.md rightly insists a human confirms): here the operator has
    registered them under one route number. Drawing them as four identically-routed
    coloured lines is what put four overprinted spokes and duplicated place labels
    on the first Ramsey draft.

    Merging is still only a PROPOSAL until gen_internal.js's corridors_report.json
    confirms the members really do overlap (it warns below 0.6) -- that report is
    surfaced in DRAFT-REVIEW.md.
    """
    fam = {}
    known = {s["route"] for s in services}
    for s in services:
        base = s.get("possibleVariantOf")
        if base and base in known and base != s["route"]:
            fam.setdefault(base, []).append(s["route"])
    return {lead: sorted(members) for lead, members in fam.items()}


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


def termini_for_route(chain, ll, prefix, namer):
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
        if a.startswith(prefix):
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
    ap.add_argument("--max-edge-km", type=float, default=2.5,
                    help="town-edge cap for the drawn buffer stops (derive_intown)")
    ap.add_argument("--buses-root", default=r"C:\u3a St Ives\Using AI\Buses")
    ap.add_argument("--db", default=None,
                   help="this region's sqlite. NO DEFAULT - every region is treated the same (see _gtfs/regions.json); $GTFS_DB also works.")
    a = ap.parse_args()
    # No default region: resolve --db / $GTFS_DB, or fail listing the built regions.
    a.db = gtfs_regions.resolve_db(a.db)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    town_dir = os.path.join(a.buses_root, "Areas", a.town)
    py = sys.executable
    namer = PlaceNamer()

    # ---- scaffold: init + S1 + bootstrap draft + town_prefixes registration
    scaffold = [py, os.path.join(HERE, "scaffold_town.py"), a.town,
                "--region", a.region, "--radius-km", str(a.radius_km),
                "--buses-root", os.path.join(a.buses_root, "Areas"), "--db", a.db]
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
    routes = build_verified_services(os.path.join(s1, "gtfs-services.json"),
                                     os.path.join(s1, "verified-services.json"))
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
                      "roads_geo.json,routes_paths.json,complexity.json",
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
    externals, termini, unnamed = [], {}, []
    for r in draft.get("routeOrder", routes):
        ch = chains.get(r)
        if not ch:
            continue
        sp = spoke_for_route(ch, ll, prefix, anchor_ll, namer)
        if sp:
            svc = facts_by_route.get(r, {})
            externals.append({"route": r, "label": sp["label"], "days": svc.get("days", ""),
                              "bearing": sp["bearing"], "side": "up", "stops": sp["stops"]})
            if "<check>" in sp["label"]:
                unnamed.append(f"external spoke {r} -> {sp['label']}")
        t = termini_for_route(ch, ll, prefix, namer)
        if t:
            termini[r] = t
            for v in t.values():
                if "<check>" in v:
                    unnamed.append(f"terminus label {r} -> {v}")

    # ---- merge GTFS-declared route variants onto ONE spoke / ONE internal line.
    #      s3-config.md: "Pick the same lead as external[].routes" so a family keeps
    #      the same colour on both sheets.
    all_services = list(facts_by_route.values())
    families = variant_families(all_services)
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

    # ---- S4: generate (unmodified template generators)
    s4 = node("stage.js", "new", "S4", "--bump", "major", cwd=town_dir)
    node("stage.js", "pull", "S2", s4, cwd=town_dir)
    node("stage.js", "pull", "S3", s4, cwd=town_dir)
    shutil.copy(os.path.join(HERE, "gen_internal.js"), os.path.join(s4, "gen_internal.js"))
    shutil.copy(os.path.join(HERE, "gen_external_radial.js"), os.path.join(s4, "gen_external.js"))
    node("engine_version.js", "--stamp", os.path.join(s4, "routes.json"))
    run([shutil.which("node") or "node", "gen_internal.js"], cwd=s4)
    run([shutil.which("node") or "node", "gen_external.js"], cwd=s4)
    # corridors_report.json is the engine's own check on whether a bundled family
    # REALLY co-runs (it warns below 0.6 overlap). s4-s5-build-and-render.md: "a
    # family that warns should be dropped, not shipped" -- surfaced, not silently
    # accepted, since the merge here is a proposal from GTFS's variant declaration.
    weak_families = []
    cr_path = os.path.join(s4, "corridors_report.json")
    if os.path.exists(cr_path):
        try:
            cr = json.load(open(cr_path, encoding="utf-8"))
            for row in (cr.get("corridors") or cr.get("families") or []):
                frac = row.get("overlap", row.get("fraction"))
                if isinstance(frac, (int, float)) and frac < 0.6:
                    weak_families.append(f"{row.get('lead', '?')}/{row.get('route', '?')} overlap {frac:.2f}")
        except Exception:
            pass
    outputs = "internal.svg,external.svg" + (",corridors_report.json" if os.path.exists(cr_path) else "")
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
    This uses GTFS's own `possibleVariantOf` declaration (301S/301V/301X are patterns
    of 301), not a judgement that different services co-run -- but it is still a claim
    worth eyeballing on the map.
    {"**The engine's corridors_report.json flags these as weakly-overlapping (<0.6) -- s4-s5-build-and-render.md says drop a family that warns: " + "; ".join(weak_families) + "**" if weak_families else "The engine's overlap report raised no warnings." if families else ""}

Recommended next step: work through `references/s1-services.md` for a real S1 pass
(replacing the auto-drafted `verified-services.json`), then re-run S2 onward normally.
""")
    print(f"\nDraft complete: {a.town}")
    print(f"  Images: {os.path.join(town_dir, '_latest')}")
    print(f"  Review checklist: {review}")
    if unnamed:
        print(f"  {len(unnamed)} place name(s) flagged <check>")


if __name__ == "__main__":
    main()
