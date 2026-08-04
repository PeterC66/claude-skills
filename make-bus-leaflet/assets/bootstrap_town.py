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
import sqlite3, sys, json, argparse, os, urllib.request, urllib.parse, math, time

HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gtfs_query  # reuse the BODS facts query

TOL_BRIGHT=["#4477AA","#EE6677","#228833","#CCBB44","#66CCEE","#AA3377","#EE7733","#BBBBBB"]
LIGHT={"#CCBB44","#66CCEE","#BBBBBB","#EE7733"}   # need dark badge text
UA={"User-Agent":"make-bus-leaflet/1.0 (bootstrap_town)"}

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

def overpass_features(bbox):
    s,w,n,e=bbox["s"],bbox["w"],bbox["n"],bbox["e"]
    box=f"{s},{w},{n},{e}"
    ql=f"""[out:json][timeout:40];(
      way["waterway"="river"]({box});
      way["waterway"="canal"]({box});
      way["railway"="rail"]({box});
      way["highway"~"^(trunk|primary)$"]["ref"]({box});
    );out tags 60;"""
    for host in ("https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"):
        try:
            req=urllib.request.Request(host,data=urllib.parse.urlencode({"data":ql}).encode(),headers=UA)
            d=json.load(urllib.request.urlopen(req,timeout=60)); break
        except Exception: d=None; time.sleep(1)
    feats={}
    if not d: return []
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
    return ranked[:6]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("town")
    ap.add_argument("--region",default="Cambridgeshire")
    ap.add_argument("--centre",help="override geocode: 'lat,lon'")
    ap.add_argument("--radius-km",type=float,default=1.6)
    DEFAULT_DB=os.environ.get("CAMBS_GTFS_DB", r"C:\u3a St Ives\Using AI\Buses\_gtfs\cambridgeshire.sqlite")
    ap.add_argument("--db",default=DEFAULT_DB)
    ap.add_argument("--out",default=".")
    ap.add_argument("--no-osm",action="store_true",help="skip the Overpass feature suggestion")
    a=ap.parse_args()
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
    services=facts["services"]

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
    feats=[] if a.no_osm else overpass_features(geo["bbox"])

    # ---- DRAFT routes.json ----
    draft={
      "town":a.town,
      "validFrom":"DRAFT - set month/year",
      "version":"DRAFT 0",
      "_bootstrap":"Auto-drafted by bootstrap_town.py. REVIEW everything marked DRAFT/<...>: confirm services vs bustimes (community/DRT buses are NOT in BODS), choose & lock the palette (watch the river-blue clash), curate external stop chains + bearings/sides, pick the 1-3 linear features, set internalDesc. Then this becomes the S3 routes.json.",
      "anchor":anchor["atco"] if anchor else "<no anchor found>",
      "anchorLabel":(anchor["name"] if anchor else "<bus station>"),
      "atcoPrefix":prefixes[0],
      "titleColor":palette.get(order[0],"#4477AA") if order else "#4477AA",
      "internalZoom":{"corePct":0.55,"comp":0.22},
      "palette":palette,
      "textOn":textOn,
      "routeOrder":order,
      "panelOrder":order,
      "orientationRoute":order[0] if order else "",
      "internalDesc":{r:[f"{a.town} - <dest>","<days, via ...>"] for r in order},
      "poi":{"industrialKeep":"none","excludeName":[],"tidy":[[" School$",""]],"canon":[]},
      "operators":operators,
      # Stagger labelPos down the left margin: all three used to share {40,200},
      # which overprints them into an unreadable smear the moment a town has more
      # than one feature (Ramsey drew "Bevill's Leam" on top of "River Nene (Old
      # Course)"). Still a draft position for a human to place properly.
      "features":[{"key":f["key"],"type":f["type"],"label":f["label"],
                   "labelPos":{"x":40,"y":200-i*7},"labelColor":"#7fb0d8"}
                  for i,f in enumerate(feats[:3])],
      "external":ext
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
    R.append(f"\n## Draft external spokes (radial seed -- refine stop chains, side, bearing)")
    for e in ext:
        R.append(f"- {e['route']} -> {e['label']}  bearing≈{e['bearing']}°  ({e['_far_km']} km out)")
    R.append(f"\n## Candidate linear features (OSM) -- pick 1-3 and lock")
    for f in feats: R.append(f"- {f['type']}: {f['label']}  (key `{f['key']}`, {f['n']} ways)")
    if not feats: R.append("- (none found / skipped)")
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
