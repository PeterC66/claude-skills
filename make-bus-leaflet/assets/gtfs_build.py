#!/usr/bin/env python3
"""Build the shared Cambridgeshire GTFS SQLite used by make-bus-leaflet S1.

Source = BODS (Bus Open Data Service) open data, no API key needed.
Download the East Anglia GTFS (covers Cambridgeshire + Peterborough):
  https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/east_anglia/
  -> itm_east_anglia_gtfs.zip  (~28 MB)

Then:
  python gtfs_build.py --zip itm_east_anglia_gtfs.zip \
      --out "C:/u3a St Ives/Using AI/Buses/_gtfs/cambridgeshire.sqlite"

Filters to trips that call at any Cambridgeshire (ATCO 0500*) or Peterborough
(0570*) stop, keeping FULL route chains incl. out-of-county termini. Result ~80 MB.
Refresh = re-download the zip and re-run (the feed is reissued ~weekly).

NB this captures REGISTERED local bus services only. Community / demand-responsive
/ pre-book minibuses (e.g. FACT 33A in March, Villager VL14 at St Ives) are NOT in
BODS -- catch those with the bustimes/operator pass in S1 (see s1-services.md).
"""
import sqlite3, zipfile, csv, io, os, sys, time, argparse, json, tempfile

KEEP_PREFIXES = ("0500", "0570")  # Cambridgeshire, Peterborough

TABLES = {
    "agency":  ["agency_id","agency_name","agency_noc"],
    "stops":   ["stop_id","stop_code","stop_name","stop_lat","stop_lon"],
    "routes":  ["route_id","agency_id","route_short_name","route_long_name","route_type"],
    "trips":   ["route_id","service_id","trip_id","trip_headsign","direction_id","shape_id"],
    "stop_times": ["trip_id","stop_id","stop_sequence","arrival_time","departure_time"],
    "calendar": ["service_id","monday","tuesday","wednesday","thursday","friday","saturday","sunday","start_date","end_date"],
    "calendar_dates": ["service_id","date","exception_type"],
    "shapes": ["shape_id","shape_pt_lat","shape_pt_lon","shape_pt_sequence"],
}

def load_full(zip_path, full_db):
    con=sqlite3.connect(full_db); con.execute("PRAGMA journal_mode=OFF"); con.execute("PRAGMA synchronous=OFF")
    cur=con.cursor(); zf=zipfile.ZipFile(zip_path)
    for tbl,cols in TABLES.items():
        fn=tbl+".txt"
        if fn not in zf.namelist(): print("skip",fn); continue
        cur.execute(f"DROP TABLE IF EXISTS {tbl}")
        cur.execute(f"CREATE TABLE {tbl} ({','.join(c+' TEXT' for c in cols)})")
        with zf.open(fn) as raw:
            rd=csv.reader(io.TextIOWrapper(raw,encoding="utf-8-sig")); hdr=next(rd)
            idx=[hdr.index(c) if c in hdr else None for c in cols]
            ins=f"INSERT INTO {tbl} VALUES ({','.join('?'*len(cols))})"; batch=[]
            for row in rd:
                batch.append(tuple(row[i] if (i is not None and i<len(row)) else None for i in idx))
                if len(batch)>=50000: cur.executemany(ins,batch); batch=[]
            if batch: cur.executemany(ins,batch)
        con.commit()
    cur.execute("CREATE INDEX ix_st_trip ON stop_times(trip_id)")
    cur.execute("CREATE INDEX ix_st_stop ON stop_times(stop_id)")
    con.commit(); con.close()

def filter_cambs(full_db, out_db, prefixes=KEEP_PREFIXES):
    if os.path.exists(out_db): os.remove(out_db)
    con=sqlite3.connect(out_db); con.execute("PRAGMA journal_mode=OFF"); con.execute("PRAGMA synchronous=OFF")
    con.execute(f"ATTACH DATABASE '{full_db}' AS src"); cur=con.cursor()
    cond=" OR ".join(f"st.stop_id LIKE '{p}%'" for p in prefixes)
    cur.execute(f"""CREATE TABLE keep_trips AS SELECT DISTINCT t.trip_id FROM src.trips t
      JOIN src.stop_times st ON st.trip_id=t.trip_id WHERE {cond}""")
    cur.execute("CREATE INDEX ix_kt ON keep_trips(trip_id)")
    cur.execute("CREATE TABLE trips AS SELECT t.* FROM src.trips t JOIN keep_trips k ON k.trip_id=t.trip_id")
    cur.execute("CREATE TABLE stop_times AS SELECT st.* FROM src.stop_times st JOIN keep_trips k ON k.trip_id=st.trip_id")
    cur.execute("CREATE TABLE routes AS SELECT * FROM src.routes WHERE route_id IN (SELECT DISTINCT route_id FROM trips)")
    cur.execute("CREATE TABLE agency AS SELECT * FROM src.agency WHERE agency_id IN (SELECT DISTINCT agency_id FROM routes)")
    cur.execute("CREATE TABLE calendar AS SELECT * FROM src.calendar WHERE service_id IN (SELECT DISTINCT service_id FROM trips)")
    cur.execute("CREATE TABLE calendar_dates AS SELECT * FROM src.calendar_dates WHERE service_id IN (SELECT DISTINCT service_id FROM trips)")
    cur.execute("CREATE TABLE stops AS SELECT * FROM src.stops WHERE stop_id IN (SELECT DISTINCT stop_id FROM stop_times)")
    cur.execute("CREATE TABLE shapes AS SELECT s.* FROM src.shapes s WHERE s.shape_id IN (SELECT DISTINCT shape_id FROM trips WHERE shape_id IS NOT NULL AND shape_id<>'')")
    con.commit(); cur.execute("DROP TABLE keep_trips")
    for stmt in ["CREATE INDEX ix_st_stop ON stop_times(stop_id)","CREATE INDEX ix_st_trip ON stop_times(trip_id)",
      "CREATE INDEX ix_trips_route ON trips(route_id)","CREATE INDEX ix_trips_shape ON trips(shape_id)",
      "CREATE INDEX ix_trips_svc ON trips(service_id)","CREATE INDEX ix_shapes_id ON shapes(shape_id)",
      "CREATE INDEX ix_stops_id ON stops(stop_id)","CREATE INDEX ix_routes_id ON routes(route_id)",
      "CREATE INDEX ix_cal_svc ON calendar(service_id)"]:
        cur.execute(stmt)
    con.commit(); con.execute("VACUUM")
    counts={tb:list(cur.execute(f"SELECT COUNT(*) FROM {tb}"))[0][0] for tb in TABLES}
    con.close(); return counts

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--zip",required=True,help="path to the BODS GTFS zip (e.g. itm_east_anglia_gtfs.zip)")
    ap.add_argument("--out",required=True,help="output sqlite path (e.g. cambridgeshire.sqlite)")
    ap.add_argument("--keep-prefixes",default=",".join(KEEP_PREFIXES),
                    help="comma-separated ATCO area prefixes to keep (default %(default)s). "
                         "Set this to build a different region's dataset from its BODS zip.")
    a=ap.parse_args(); t0=time.time()
    prefixes=tuple(p.strip() for p in a.keep_prefixes.split(",") if p.strip())
    tmp=tempfile.NamedTemporaryFile(suffix=".sqlite",delete=False); tmp.close()
    try:
        print("loading full feed ..."); load_full(a.zip, tmp.name)
        print(f"filtering to ATCO prefixes {prefixes} ..."); counts=filter_cambs(tmp.name, a.out, prefixes)
    finally:
        if os.path.exists(tmp.name): os.remove(tmp.name)
    # feed_info sidecar
    info={}
    try:
        zf=zipfile.ZipFile(a.zip); rd=csv.DictReader(io.TextIOWrapper(zf.open("feed_info.txt"),encoding="utf-8-sig"))
        info=next(rd)
    except Exception: pass
    side={"built": time.strftime("%Y-%m-%d %H:%M"), "source_zip": os.path.basename(a.zip),
          "feed_info": info, "keep_prefixes": list(prefixes), "counts": counts,
          "size_mb": round(os.path.getsize(a.out)/1e6,1)}
    # ONE sidecar per dataset, feed_info_<dbstem>.json, for every region alike.
    #
    # This used to ALSO write an unsuffixed feed_info.json whenever the dataset was
    # cambridgeshire, and gtfs_regions.feed_info() fell back to reading it. So any
    # region whose own sidecar was missing silently reported CAMBRIDGESHIRE's build
    # date and validity window as its own -- a wrong answer indistinguishable from a
    # right one. Both halves went on 2026-08-21 when every region became equal; a
    # missing sidecar now reads as unknown, which is the truth.
    outdir=os.path.dirname(a.out); stem=os.path.splitext(os.path.basename(a.out))[0]
    json.dump(side, open(os.path.join(outdir,f"feed_info_{stem}.json"),"w"), indent=1)
    print("counts:", counts)
    print("size MB:", side["size_mb"], "in", round(time.time()-t0,1),"s")
