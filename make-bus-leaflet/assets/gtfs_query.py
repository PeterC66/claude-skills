#!/usr/bin/env python3
"""Query the Cambridgeshire GTFS SQLite for the bus services that serve a town.

Usage:
  python gtfs_query.py <ATCO_PREFIX> [<ATCO_PREFIX> ...] [--town NAME] [--db PATH] [--out FILE]

ATCO_PREFIX = the town's NaPTAN locality prefix(es), e.g. 0500HSTIV for St Ives,
0500FMARC for March. Stops are matched by stop_id LIKE '<prefix>%'.

Emits the facts the make-bus-leaflet S1 stage needs (routes / operators / days /
termini), straight from BODS open data. Geometry and community/pre-book (DRT)
services are NOT covered here -- keep the bustimes/OSM pass for those.
"""
import sqlite3, sys, json, argparse, os

DOW=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
ABBR=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

def fmt_days(flags):
    on=[i for i,f in enumerate(flags) if f]
    if not on: return "?"
    if on==list(range(7)): return "Daily"
    # contiguous run?
    if on==list(range(on[0],on[-1]+1)):
        return f"{ABBR[on[0]]}-{ABBR[on[-1]]}" if len(on)>2 else " & ".join(ABBR[i] for i in on)
    return " & ".join(ABBR[i] for i in on) if len(on)<=3 else ", ".join(ABBR[i] for i in on)

def _haversine_km(la1,lo1,la2,lo2):
    from math import radians,sin,cos,asin,sqrt
    dla=radians(la2-la1); dlo=radians(lo2-lo1)
    a=sin(dla/2)**2+cos(radians(la1))*cos(radians(la2))*sin(dlo/2)**2
    return 6371*2*asin(sqrt(a))

def _make_town_stops(cur, prefixes=None, near=None):
    """Populate temp table town_stops(stop_id) by ATCO prefix(es) or a (lat,lon,km) radius."""
    cur.execute("CREATE TEMP TABLE town_stops(stop_id TEXT PRIMARY KEY)")
    if prefixes:
        for p in prefixes:
            cur.execute("INSERT OR IGNORE INTO town_stops SELECT stop_id FROM stops WHERE stop_id LIKE ?",(p+"%",))
    if near:
        la,lo,km=near
        rows=cur.execute("SELECT stop_id,stop_lat,stop_lon FROM stops WHERE stop_lat<>'' AND stop_lon<>''").fetchall()
        hit=[]
        for r in rows:
            try:
                if _haversine_km(la,lo,float(r[1]),float(r[2]))<=km: hit.append((r[0],))
            except ValueError: pass
        cur.executemany("INSERT OR IGNORE INTO town_stops VALUES (?)",hit)

def query(db, prefixes=None, near=None, town=None):
    con=sqlite3.connect(db); con.row_factory=sqlite3.Row; cur=con.cursor()
    _make_town_stops(cur, prefixes, near)
    IN="st.stop_id IN (SELECT stop_id FROM town_stops)"
    # all (route, agency) calling at the town
    routes=list(cur.execute(f"""
      SELECT DISTINCT r.route_id, r.route_short_name sn, r.route_long_name ln, a.agency_name op
      FROM stop_times st JOIN trips t ON t.trip_id=st.trip_id
      JOIN routes r ON r.route_id=t.route_id JOIN agency a ON a.agency_id=r.agency_id
      WHERE {IN}"""))
    # group by short_name (a short_name may span >1 route_id)
    by={}
    for r in routes:
        by.setdefault(r["sn"],{"sn":r["sn"],"ops":set(),"long":set(),"route_ids":set()})
        d=by[r["sn"]]; d["ops"].add(r["op"]); d["route_ids"].add(r["route_id"])
        if r["ln"]: d["long"].add(r["ln"])
    out=[]
    for sn,d in by.items():
        rids=list(d["route_ids"]); ph=','.join('?'*len(rids))
        # service_ids of THIS route's trips that stop at the town (avoids region-wide day pollution)
        svc=[x[0] for x in cur.execute(f"""
          SELECT DISTINCT t.service_id FROM trips t
          JOIN stop_times st ON st.trip_id=t.trip_id
          WHERE t.route_id IN ({ph}) AND {IN}""", rids)]
        flags=[0]*7; sd=set(); ed=set()
        for s in svc:
            for c in cur.execute("SELECT * FROM calendar WHERE service_id=?",(s,)):
                for i,dn in enumerate(DOW):
                    if c[dn]=="1": flags[i]=1
                sd.add(c["start_date"]); ed.add(c["end_date"])
        # headsigns (operator destination labels) of town-serving trips
        heads=[x[0] for x in cur.execute(f"""
          SELECT t.trip_headsign FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id
          WHERE t.route_id IN ({ph}) AND {IN} AND t.trip_headsign<>''
          GROUP BY t.trip_headsign ORDER BY COUNT(*) DESC""", rids)]
        # geographic termini: first & last stop names of town-serving trips
        ends=set()
        for tid in [x[0] for x in cur.execute(f"""
            SELECT DISTINCT t.trip_id FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id
            WHERE t.route_id IN ({ph}) AND {IN} LIMIT 60""", rids)]:
            seq=list(cur.execute("""SELECT s.stop_name FROM stop_times st JOIN stops s ON s.stop_id=st.stop_id
              WHERE st.trip_id=? ORDER BY CAST(st.stop_sequence AS INT)""",(tid,)))
            if seq: ends.add(seq[0]["stop_name"]); ends.add(seq[-1]["stop_name"])
        # shape coverage
        hasshape=list(cur.execute(f"""SELECT COUNT(*) FROM trips t
          WHERE t.route_id IN ({ph}) AND t.shape_id IN (SELECT shape_id FROM shapes)""",rids))[0][0]>0
        ntrips=list(cur.execute(f"""SELECT COUNT(DISTINCT t.trip_id) FROM trips t
          JOIN stop_times st ON st.trip_id=t.trip_id
          WHERE t.route_id IN ({ph}) AND {IN}""", rids))[0][0]
        out.append({"route":sn,"operator":" / ".join(sorted(d["ops"])),
          "days":fmt_days(flags),"daysFlags":flags,
          "validFrom":min(sd) if sd else None,"validTo":max(ed) if ed else None,
          "longName":" / ".join(sorted(d["long"])) if d["long"] else "",
          "headsigns":heads,"termini":sorted(ends),
          "tripsAtTownPerWeekSample":ntrips,"hasGtfsShape":hasshape})
    # variant hints: short route name whose name starts with another present route name
    names=set(by)
    for s in out:
        base=[n for n in names if n!=s["route"] and s["route"].startswith(n) and s["route"][len(n):].isalpha()]
        s["possibleVariantOf"]=base[0] if base else None
    out.sort(key=lambda s:(len(s["route"]),s["route"]))
    con.close()
    return {"town":town,"atcoPrefixes":prefixes,"near":near,"source":"BODS GTFS (east_anglia)","services":out}

if __name__=="__main__":
    ap=argparse.ArgumentParser(description="Bus services serving a town, from BODS GTFS.")
    ap.add_argument("prefixes",nargs="*",help="ATCO locality prefix(es), e.g. 0500HSTIV (St Ives)")
    ap.add_argument("--town")
    ap.add_argument("--near",help="geographic radius instead of/with prefixes: 'lat,lon,km' e.g. 52.3231,-0.0709,1.2")
    DEFAULT_DB=os.environ.get("CAMBS_GTFS_DB", r"C:\u3a St Ives\Using AI\Buses\_gtfs\cambridgeshire.sqlite")
    ap.add_argument("--db",default=DEFAULT_DB)
    ap.add_argument("--out")
    a=ap.parse_args()
    near=None
    if a.near:
        la,lo,km=[float(x) for x in a.near.split(",")]; near=(la,lo,km)
    if not a.prefixes and not near:
        ap.error("give one or more ATCO prefixes, or --near lat,lon,km")
    res=query(a.db, a.prefixes or None, near, a.town)
    for s in res["services"]:
        v=f"  (variant of {s['possibleVariantOf']})" if s["possibleVariantOf"] else ""
        sh="shape" if s["hasGtfsShape"] else "no-shape"
        print(f"  {s['route']:6s} {s['operator']:28s} {s['days']:10s} {sh:8s} -> {', '.join(s['headsigns'][:3])}{v}")
    if a.out:
        json.dump(res,open(a.out,"w",encoding="utf-8"),indent=1,ensure_ascii=False)
        print("wrote",a.out)
