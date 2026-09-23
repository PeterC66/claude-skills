#!/usr/bin/env python3
"""Bootstrap a NEW town for make-bus-leaflet: from just a town name, derive the
setup that today is hand-found, and emit a DRAFT routes.json + a town_prefixes
entry + a human-readable report for approval.

What it derives (deterministically, no guessing where avoidable):
  * centre lat/lon + bbox        -- Nominatim geocode (override with --centre lat,lon)
  * ATCO locality prefix(es)     -- dominant stop_id[:9] among in-town GTFS stops
  * anchor + anchorLabel         -- the in-town stop served by the most routes
                                    (the interchange / bus station)
  * services (routes/operators/days/termini/variants/shape) -- gtfs_query (BODS)
  * a Tol-Bright palette + textOn assigned one colour per route
  * DRAFT external[] spokes      -- per route, the farthest in-town-trip stop +
                                    a real bearing from the anchor (radial seed)
  * candidate linear features    -- river/canal/railway/primary-road names from OSM

It does NOT finalise anything subjective (palette choice, external stop chains,
which features/POIs to include). Those stay human-approved, as the skill requires.
The draft is a starting point for S1->S3, not a shipped config.

Usage:
  python bootstrap_town.py "Huntingdon" [--region Cambridgeshire] [--centre LAT,LON]
       [--radius-km 1.6] [--db PATH] [--out DIR]
Region-agnostic: --db / $CAMBS_GTFS_DB selects the dataset; --region only tunes
the geocode string + report. Any town whose stops are in the dataset works.
"""
import sqlite3, sys, json, argparse, os, re, urllib.request, urllib.parse, math, time

HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gtfs_query  # reuse the BODS facts query
import gtfs_regions
import overpass_fetch

TOL_BRIGHT=["#4477AA","#EE6677","#228833","#CCBB44","#66CCEE","#AA3377","#EE7733","#BBBBBB"]
LIGHT={"#CCBB44","#66CCEE","#BBBBBB","#EE7733"}   # need dark badge text
UA={"User-Agent":"make-bus-leaflet/1.0 (bootstrap_town)"}

# A15 -- poi.tidy PROMOTED FROM THE ESTATE, not invented here. Counted over the ten
# shipped S3 configs on 2026-09-22: " School$" 9 towns, " Primary School$" 6,
# " Junior School$" 6, " Church of England Primary School$" 5, " Academy$" 4,
# " Infant School$" 3. Every rule below is one at least three towns had already
# written out by hand; the tail of one-town rules (" Interchurch Academy$",
# " Combined School$", …) stays per-town, because it is a local name and not a
# convergence. The drafter used to write the last rule only, so five towns had to
# re-type the other five. ORDER IS LOAD-BEARING: poi_select.js applies these in
# array order, each replace mutating the name, so the long patterns must precede
# the short ones. Put " School$" first and "Hartford Church of England Primary
# School" comes out as "Hartford Church of England Primary" -- the later, better
# rule can no longer match what the earlier one already ate. OA-436.
POI_TIDY=[[" Church of England Primary School$"," C of E Primary"],
          [" Primary School$"," Primary"],
          [" Junior School$"," Junior"],
          [" Infant School$"," Infants"],
          [" Academy$",""],
          [" School$",""]]

# A15 -- the anchor's name, town-qualified. NaPTAN calls St Ives' interchange
# "Bus Station" and March's "Town Centre": true of a hundred towns, and printed on
# the sheet as the name of THIS one's. Huntingdon and March both had the town typed
# in by hand. Qualify only a BARE generic -- Wisbech's "Horse Fair Bus Station" and
# Beaconsfield's "Old Town" already say which place they are, and prefixing those
# would produce "Wisbech Horse Fair Bus Station", which no sign in Wisbech says.
_GENERIC_ANCHOR=re.compile(
    r"^(?:the\s+)?(?:bus\s*st(?:atio)?n|bus\s*stn|interchange|bus\s*interchange"
    r"|town\s*centre|city\s*centre|railway\s*station|train\s*station|station)$", re.I)

def qualify_anchor(name, town):
    """"Bus Station" -> "St Ives Bus Station"; anything already distinctive, unchanged."""
    if not name or not town:
        return name
    if not _GENERIC_ANCHOR.match(name.strip()):
        return name
    if town.lower() in name.lower():
        return name
    return f"{town} {name.strip()}"

def geocode(name, region):
    q=", ".join([p for p in [name, region, "UK"] if p])
    url="https://nominatim.openstreetmap.org/search?"+urllib.parse.urlencode(
        {"q":q,"format":"json","limit":1,"addressdetails":1})
    req=urllib.request.Request(url, headers=UA)
    d=json.load(urllib.request.urlopen(req, timeout=30))
    if not d: raise SystemExit(f"Nominatim found nothing for {q!r}")
    r=d[0]; bb=[float(x) for x in r["boundingbox"]]  # [south, north, west, east]
    return {"lat":float(r["lat"]),"lon":float(r["lon"]),
            "bbox":{"s":bb[0],"n":bb[1],"w":bb[2],"e":bb[3]},
            "display":r.get("display_name","")}

def _km(la1,lo1,la2,lo2):
    dla=math.radians(la2-la1); dlo=math.radians(lo2-lo1)
    a=math.sin(dla/2)**2+math.cos(math.radians(la1))*math.cos(math.radians(la2))*math.sin(dlo/2)**2
    return 6371*2*math.asin(math.sqrt(a))

def _bearing(la1,lo1,la2,lo2):
    y=math.sin(math.radians(lo2-lo1))*math.cos(math.radians(la2))
    x=(math.cos(math.radians(la1))*math.sin(math.radians(la2))
       -math.sin(math.radians(la1))*math.cos(math.radians(la2))*math.cos(math.radians(lo2-lo1)))
    return (math.degrees(math.atan2(y,x))+360)%360

def in_town_stops(cur, lat, lon, km):
    rows=cur.execute("SELECT stop_id,stop_name,stop_lat,stop_lon FROM stops WHERE stop_lat<>'' AND stop_lon<>''").fetchall()
    out=[]
    for sid,nm,la,lo in rows:
        try:
            if _km(lat,lon,float(la),float(lo))<=km: out.append((sid,nm,float(la),float(lo)))
        except ValueError: pass
    return out

def dominant_prefixes(stops):
    from collections import Counter
    # Region-agnostic: pick the dominant NaPTAN ATCO AREA (first 4 chars) among the
    # in-radius stops, then the dominant 9-char block within it — so a town in ANY
    # county works (Cambs 0500/0570, Bucks 0400, …) and a few cross-border minority
    # stops don't skew the prefix. (Was hardcoded to 0500/0570 with an all-stops
    # fallback; that only worked out-of-county by luck of the fallback.)
    top_area=Counter(s[0][:4] for s in stops).most_common(1)[0][0]
    c=Counter(s[0][:9] for s in stops if s[0].startswith(top_area))
    if not c: c=Counter(s[0][:9] for s in stops)
    tot=sum(c.values()); keep=[p for p,n in c.most_common() if n/tot>=0.12]
    return keep or [c.most_common(1)[0][0]], c.most_common(8)

def pick_anchor(cur, stops):
    """The interchange / bus station: prefer an in-town stop NAMED like a bus
    station/interchange with many routes; else the stop hit by the most routes."""
    import re
    ids=[s[0] for s in stops]; ph=",".join("?"*len(ids))
    rows=cur.execute(f"""SELECT st.stop_id, COUNT(DISTINCT r.route_short_name) n
        FROM stop_times st JOIN trips t ON t.trip_id=st.trip_id
        JOIN routes r ON r.route_id=t.route_id
        WHERE st.stop_id IN ({ph}) GROUP BY st.stop_id ORDER BY n DESC""", ids).fetchall()
    if not rows: return None
    nm_by={s[0]:s[1] for s in stops}
    STN=re.compile(r"bus\s*st(?:atio)?n|interchange|bus\s*stn", re.I)
    # candidates named like a station, with at least half the max route count
    nmax=rows[0][1]
    named=[(sid,n) for sid,n in rows if STN.search(nm_by.get(sid,"") or "") and n>=max(2,nmax*0.5)]
    sid,n=(named[0] if named else rows[0])
    meta=next(s for s in stops if s[0]==sid)
    return {"atco":sid,"name":meta[1],"routes":n,"lat":meta[2],"lon":meta[3],
            "namedStation":bool(named)}

def drop_undrawable(cur, services, stops, expiring_days, radius_km):
    """A5 -- the two services a draft should never have carried, both read off GTFS.

    Returns (kept, [(route, why), ...]); draft_town.py writes both into the S1
    record, the kept as `services[]` and the dropped as `notOnLeaflet[]`.

    NOTHING here is a judgement about whether a route is WORTH drawing. Huntingdon's
    400 is a real Dews Mon-Fri service calling at the bus station nine ways with a
    registration good to June 2027, and Wisbech's X46 runs to May 2027; the live
    sheets carry neither, and no rule reading GTFS can say why. Those are decisions
    a person makes and writes into `notOnLeaflet[]` with a reason (Peter, 2026-09-22).
    These two are the cases where the FEED ITSELF says the route does not belong on
    a sheet for this town.

    1. THE REGISTRATION HAS RUN OUT, or is about to. `validTo` is the last date any
       calendar row of this route's town-serving trips covers. Whippet's 101 was
       drafted onto St Ives and Huntingdon (and three places, and St Ives Bus
       Station) on 2026-09-22 with a `validTo` of 2026-09-13 -- nine days in the
       PAST. A leaflet is printed and lives on a noticeboard for months; a service
       whose registration ends inside the next four weeks is not one a reader can
       use. The margin is wide because the gap is wide: measured across the three
       towns drafted that day, every route anybody kept had 252 days left and the
       only two dropped had -9. There is no case anywhere near the line.

    2. NO STOP INSIDE THE TOWN RADIUS. gtfs_query selects on the ATCO prefix, which
       is a NaPTAN administrative block and not a circle -- so a route can qualify
       on a stop the town's own radius excludes. The place drafter's 18A is the
       measured case (nearest stop 12.9 km from the place, drafted onto two St
       Neots places); the town half of it is this guard, and on a town whose
       prefix block sits inside its radius it is expected to drop nothing at all.
       That is the correct outcome for a guard, not a reason to leave it out.
    """
    today=time.strftime("%Y%m%d")
    horizon=(None if expiring_days<0
             else time.strftime("%Y%m%d", time.localtime(time.time()+expiring_days*86400)))
    in_radius={s[0] for s in stops}
    kept,dropped=[],[]
    for s in services:
        vt=s.get("validTo")
        if horizon and vt and str(vt)<horizon:
            when="ran out on" if str(vt)<today else "runs out on"
            dropped.append((s["route"],
                f"its registration {when} {vt} -- inside the {expiring_days}-day horizon "
                f"from today ({today}). Use --expiring-days -1 to draft it anyway."))
            continue
        rids=[x[0] for x in cur.execute(
            "SELECT route_id FROM routes WHERE route_short_name=?",(s["route"],)).fetchall()]
        if rids:
            ph=",".join("?"*len(rids))
            # the town's in-radius stop list runs to hundreds, so pull the route's
            # own stop set once and intersect in Python rather than build that IN-list
            called={x[0] for x in cur.execute(
                f"SELECT DISTINCT st.stop_id FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id "
                f"WHERE t.route_id IN ({ph})",rids).fetchall()}
            if not (called & in_radius):
                dropped.append((s["route"],
                    f"no stop within {radius_km} km of the centre -- it qualified on the "
                    f"ATCO prefix alone. Widen --radius-km if the town really reaches it."))
                continue
        kept.append(s)
    return kept,dropped


def route_far_stop(cur, route_ids, town_ids, clat, clon):
    """Farthest in-town-serving-trip stop from centre, for a draft external spoke."""
    ph=",".join("?"*len(route_ids)); tph=",".join("?"*len(town_ids))
    tids=[x[0] for x in cur.execute(f"""SELECT DISTINCT t.trip_id FROM trips t
        JOIN stop_times st ON st.trip_id=t.trip_id
        WHERE t.route_id IN ({ph}) AND st.stop_id IN ({tph}) LIMIT 40""", route_ids+town_ids)]
    far=None
    for tid in tids:
        for nm,la,lo in cur.execute("""SELECT s.stop_name,s.stop_lat,s.stop_lon
            FROM stop_times st JOIN stops s ON s.stop_id=st.stop_id WHERE st.trip_id=?
            ORDER BY CAST(st.stop_sequence AS INT)""",(tid,)):
            try: d=_km(clat,clon,float(la),float(lo))
            except (ValueError,TypeError): continue
            if not far or d>far[0]: far=(d,nm,float(la),float(lo))
    return far

def osm_note(state):
    """The line the report prints when no linear feature was suggested. THREE states.

    Until 2026-09-17 this was one string -- `- (none found / skipped)` -- printed
    identically whether OSM answered and the bbox holds no river, whether
    --no-osm meant OSM was never asked, or whether both Overpass endpoints
    failed and the question could not be put at all. A refusal read as an
    absence measures the instrument instead of the subject, and here it costs
    the reviewer the one fact that would make them re-run: an empty features[]
    is a finding about the town in the first case and says nothing at all in
    the third.
    """
    if state=="skipped":
        return "- (skipped: --no-osm was given, so OSM was never asked about this town)"
    if state=="refused":
        return ("- COULD NOT LOOK: every Overpass try failed, so OSM has NOT been asked "
                "-- a refusal, not an absence. Re-run before treating an empty features[] as "
                "a finding about this town.")
    return "- (none found: OSM answered, and the bbox holds no river, canal, railway or A-road)"

def overpass_features(bbox):
    """Returns (ranked, reached). `reached` is False when no endpoint answered.

    The second value is what `osm_note` turns into a sentence: without it the
    caller cannot tell an empty list from an unanswered question.
    """
    s,w,n,e=bbox["s"],bbox["w"],bbox["n"],bbox["e"]
    box=f"{s},{w},{n},{e}"
    ql=f"""[out:json][timeout:40];(
      way["waterway"="river"]({box});
      way["waterway"="canal"]({box});
      way["railway"="rail"]({box});
      way["highway"~"^(trunk|primary)$"]["ref"]({box});
    );out tags 60;"""
    # OA-339: two tries lost seven towns in eight on a bad afternoon; the shared
    # helper retries across three hosts. The refusal stays a refusal, not a raise:
    # this list is a SUGGESTION for a reviewer, and osm_note says it could not look.
    try: d=overpass_fetch.fetch(ql,timeout=60,label="candidate features")
    except overpass_fetch.OverpassUnreachable: return [], False
    feats={}
    for el in d.get("elements",[]):
        t=el.get("tags",{})
        if t.get("waterway")=="river": k,typ,lab=("river","river",t.get("name","River"))
        elif t.get("waterway")=="canal": k,typ,lab=("canal","canal",t.get("name","Canal"))
        elif t.get("railway")=="rail": k,typ,lab=("railway","railway",t.get("name","Railway"))
        elif t.get("highway") in ("trunk","primary"): k,typ,lab=(t.get("ref","road").replace(" ","").lower(),"road",t.get("ref","A-road"))
        else: continue
        feats.setdefault((typ,lab),{"key":k,"type":typ,"label":lab,"n":0})
        feats[(typ,lab)]["n"]+=1
    ranked=sorted(feats.values(),key=lambda f:-f["n"])
    return ranked[:6], True

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("town")
    ap.add_argument("--region",default="Cambridgeshire")
    ap.add_argument("--centre",help="override geocode: 'lat,lon'")
    ap.add_argument("--radius-km",type=float,default=1.6)
    ap.add_argument("--expiring-days",type=int,default=28,
                    help="A5: drop a service whose GTFS registration ends within this "
                         "many days of today. 0 drops only the ones that have already "
                         "run out; a negative number turns the rule off and drafts "
                         "every service the feed carries.")
    ap.add_argument("--db", default=None,
                   help="this region's sqlite. NO DEFAULT - every region is treated the same (see _gtfs/regions.json); $GTFS_DB also works.")
    ap.add_argument("--out",default=".")
    ap.add_argument("--no-osm",action="store_true",help="skip the Overpass feature suggestion")
    a=ap.parse_args()
    # No default region: resolve --db / $GTFS_DB, or fail listing the built regions.
    a.db = gtfs_regions.resolve_db(a.db)
    try: sys.stdout.reconfigure(encoding="utf-8")   # Windows console is cp1252 by default
    except Exception: pass
    os.makedirs(a.out,exist_ok=True)

    if a.centre:
        la,lo=[float(x) for x in a.centre.split(",")]
        geo={"lat":la,"lon":lo,"bbox":{"s":la-0.02,"n":la+0.02,"w":lo-0.03,"e":lo+0.03},"display":"(manual centre)"}
    else:
        geo=geocode(a.town,a.region)
    con=sqlite3.connect(a.db); cur=con.cursor()
    stops=in_town_stops(cur,geo["lat"],geo["lon"],a.radius_km)
    if not stops: raise SystemExit(f"No GTFS stops within {a.radius_km} km of {geo['lat']},{geo['lon']} -- widen --radius-km or check --db region.")
    prefixes,prefix_counts=dominant_prefixes(stops)
    anchor=pick_anchor(cur,stops)
    facts=gtfs_query.query(a.db, prefixes=prefixes, town=a.town)
    services,dropped=drop_undrawable(cur, facts["services"], stops, a.expiring_days, a.radius_km)
    for route,why in dropped:
        print(f"  DROPPED {route}: {why}")

    # palette + textOn (one colour per route, in service order)
    order=[s["route"] for s in services]
    palette={r:TOL_BRIGHT[i%len(TOL_BRIGHT)] for i,r in enumerate(order)}
    textOn={r:("#111" if palette[r] in LIGHT else "#fff") for r in order}
    # operators
    opmap={}
    for s in services: opmap.setdefault(s["operator"],[]).append(s["route"])
    operators=[{"name":k,"routes":v} for k,v in opmap.items()]
    # draft external spokes (radial seed): farthest stop + real bearing from anchor
    ext=[]
    by_routeids={}
    # map short_name -> its route_ids (re-query; gtfs_query collapsed them)
    for sn,rid in cur.execute("SELECT route_short_name, route_id FROM routes"):
        by_routeids.setdefault(sn,[]).append(rid)
    town_ids=[s[0] for s in stops]
    aclat=anchor["lat"] if anchor else geo["lat"]; aclon=anchor["lon"] if anchor else geo["lon"]
    for s in services:
        rids=by_routeids.get(s["route"],[])
        far=route_far_stop(cur,rids,town_ids,aclat,aclon) if rids else None
        if far:
            ext.append({"route":s["route"],"label":far[1],"days":s["days"],
                        "bearing":round(_bearing(aclat,aclon,far[2],far[3])),
                        "side":"up","_far_km":round(far[0],1),
                        "stops":["<fill ordered intermediate places to %s>"%far[1]]})
    if a.no_osm:
        feats,osm_state=[],"skipped"
    else:
        feats,reached=overpass_features(geo["bbox"])
        osm_state="read" if reached else "refused"

    # ---- DRAFT routes.json ----
    draft={
      "town":a.town,
      "validFrom":"DRAFT - set month/year",
      "version":"DRAFT 0",
      "_bootstrap":"Auto-drafted by bootstrap_town.py. REVIEW everything marked DRAFT/<...>: confirm services vs bustimes (community/DRT buses are NOT in BODS), choose & lock the palette (watch the river-blue clash), curate external stop chains + bearings/sides, pick the 1-3 linear features, set internalDesc. Then this becomes the S3 routes.json.",
      "anchor":anchor["atco"] if anchor else "<no anchor found>",
      "anchorLabel":qualify_anchor(anchor["name"] if anchor else "<bus station>", a.town),
      "atcoPrefix":prefixes[0],
      "titleColor":palette.get(order[0],"#4477AA") if order else "#4477AA",
      # A15: the estate's own answer, not the drafter's first guess. Measured across
      # the ten shipped configs on 2026-09-22: four towns carry comp 0.3 with core
      # 0.8-0.85 (Huntingdon, St Neots, Wisbech, The Shelfords) and the three still
      # on 0.55/0.22 are the ones nobody ever tuned -- including Chatteris, which
      # this drafter itself wrote. A default three towns have to overwrite is not a
      # default. See OA-436.
      "internalZoom":{"corePct":0.8,"comp":0.3},
      "palette":palette,
      "textOn":textOn,
      "routeOrder":order,
      "panelOrder":order,
      "orientationRoute":order[0] if order else "",
      "internalDesc":{r:[f"{a.town} - <dest>","<days, via ...>"] for r in order},
      "poi":{"industrialKeep":"none","excludeName":[],"tidy":list(POI_TIDY),"canon":[]},
      "operators":operators,
      # A2: "auto" sites the label on the feature's own ink (gen_internal.js's
      # AUTOPOS pass) instead of pinning it in page mm. The staggered left-margin
      # draft this replaces put every label at x=40, y=200 downwards -- and the
      # footer plate's top is about 188 mm, so the first one landed UNDER the plate
      # and the rest sat in the panel. Five town histories carry a run whose whole
      # purpose was moving a drafted feature label back onto the map. A hand-set
      # constant cannot survive a moving projection; the placer can. See OA-436.
      "features":[{"key":f["key"],"type":f["type"],"label":f["label"],
                   "labelPos":"auto","labelColor":"#7fb0d8"}
                  for f in feats[:3]],
      "external":ext,
      # A5 -- WHAT WAS DROPPED, carried forward so draft_town.py can put it in the
      # S1 record's `notOnLeaflet[]`, which is where this estate says "we know about
      # this route and deliberately do not draw it" and the only spelling anything
      # new may write. A route that is merely ABSENT from the config is
      # indistinguishable from one the feed never carried, and the monthly refresh
      # then re-proposes it every month. Underscored because it is scaffolding for
      # the S1 record and not a key of the shipped config. OA-436.
      "_droppedServices":[{**next((s for s in facts["services"] if s["route"]==r), {"route":r}),
                           "reason":why} for r,why in dropped]
    }
    rp=os.path.join(a.out,"routes.draft.json")
    json.dump(draft,open(rp,"w",encoding="utf-8"),indent=2,ensure_ascii=False)

    # ---- town_prefixes entry (suggested) ----
    tp_entry={a.town:{"prefixes":prefixes}}

    # ---- report ----
    R=[]
    R.append(f"# Bootstrap draft - {a.town}\n")
    R.append(f"- Geocode: {geo['display']}  ->  centre {geo['lat']:.5f}, {geo['lon']:.5f}")
    R.append(f"- In-town GTFS stops within {a.radius_km} km: {len(stops)}")
    R.append(f"- ATCO prefix(es): {', '.join(prefixes)}   (top: "+
             ", ".join(f"{p}×{n}" for p,n in prefix_counts)+")")
    if anchor:
        R.append(f"- Anchor (interchange): {anchor['atco']} = {anchor['name']}  ({anchor['routes']} routes)")
    R.append(f"\n## Services from BODS GTFS ({len(services)})  -- confirm vs bustimes; community/DRT buses are NOT here")
    for s in services:
        v=f" (variant of {s['possibleVariantOf']})" if s.get("possibleVariantOf") else ""
        R.append(f"- **{s['route']}** {palette.get(s['route'],'')}  {s['operator']}  · {s['days']}  · "
                 f"-> {', '.join(s['headsigns'][:2]) or ', '.join(s['termini'][:2])}{v}"
                 f"  {'[has GTFS shape]' if s['hasGtfsShape'] else ''}")
    # A5: say what was NOT drafted and why, in the report a human reads. A service
    # dropped silently is indistinguishable from one the feed never carried, and the
    # reviewer has no way to disagree with a decision nothing wrote down. OA-436.
    if dropped:
        R.append(f"\n## Services the feed carries and this draft DROPPED ({len(dropped)})")
        R.append("Both rules read GTFS and neither is a judgement about whether the route "
                 "is worth drawing -- that decision belongs in the town's `notOnLeaflet[]`. "
                 "If one of these is wrong, the flag to override it is in the reason.")
        for route,why in dropped:
            R.append(f"- **{route}** -- {why}")
    R.append(f"\n## Draft external spokes (radial seed -- refine stop chains, side, bearing)")
    for e in ext:
        R.append(f"- {e['route']} -> {e['label']}  bearing≈{e['bearing']}°  ({e['_far_km']} km out)")
    R.append(f"\n## Candidate linear features (OSM) -- pick 1-3 and lock")
    for f in feats: R.append(f"- {f['type']}: {f['label']}  (key `{f['key']}`, {f['n']} ways)")
    if not feats: R.append(osm_note(osm_state))
    R.append(f"\n## town_prefixes.json entry to add\n```json\n{json.dumps(tp_entry,indent=1,ensure_ascii=False)}\n```")
    R.append(f"\n## Next\n1. Review services vs bustimes (catch community/DRT).  2. Lock palette (river clash!).  "
             f"3. Curate external stops/bearings/sides.  4. Pick features.  5. Fill internalDesc.  "
             f"6. Move `routes.draft.json` -> S3 `routes.json` and run S2->S5.")
    rep=os.path.join(a.out,"bootstrap-report.md")
    open(rep,"w",encoding="utf-8").write("\n".join(R)+"\n")

    con.close()
    print("\n".join(R))
    print(f"\nWrote {rp}\nWrote {rep}")

if __name__=="__main__":
    main()
