#!/usr/bin/env python3
"""Query the Cambridgeshire GTFS SQLite for the bus services that serve a town.

Usage:
  python gtfs_query.py <ATCO_PREFIX> [<ATCO_PREFIX> ...] [--town NAME] [--db PATH] [--out FILE]

ATCO_PREFIX = the town's NaPTAN locality prefix(es), e.g. 0500HSTIV for St Ives,
0500FMARC for March. Stops are matched by stop_id LIKE '<prefix>%'.

Emits the facts the make-bus-leaflet S1 stage needs (routes / operators / days /
termini), straight from BODS open data. Geometry and community/pre-book (DRT)
services are NOT covered here -- keep the bustimes/OSM pass for those.

HOW OFTEN A ROUTE RUNS -- read this before using any number below
  `journeysPerWeek` is the honest one: real journeys calling at the town in a
  week, obtained by expanding each trip's calendar (and its calendar_dates
  exceptions) over actual dates.

  `tripPatternsAtTown` is NOT a rate. It counts rows in trips.txt -- timetable
  patterns -- and a journey running Mon-Fri is ONE row carrying five day-flags.
  It was called `tripsAtTownPerWeekSample` until 2026-08-17 and that name was
  wrong in both halves: not per-week, not a sample. Verified against four towns,
  it understates by x2.0 to x5.7, and the multiplier is set by how many
  service_ids the operator split their timetable into -- a modelling choice in
  somebody else's export -- so it is not correctable by a constant and it gets
  the RANKING of routes wrong. Wisbech's two busiest routes came out in the
  wrong order. Do not tier, weight, sort or draw anything from it.
  Full account: Buses repo, Development Docs/publisher-benchmark-plan_2026-08-17.md.

  Span matters as much as count in a market town: St Ives' 300 runs 5 journeys,
  all 09:50-13:50 (a shopping bus), and the 69 runs 4, at 07:00/07:10 and
  17:30/18:10 (a commuter shuttle). Equal-looking counts, opposite products --
  hence `firstDeparture`/`lastDeparture` alongside the totals.

WHICH FIELD TO TIER A LINE WEIGHT FROM -- not `journeysPerWeek`
  Added 2026-08-17 for the frequency-tier model, and the reason they exist is that
  `journeysPerWeek` is an honest field that is still the wrong thing to DRAW from.
  It is a volume, and volume rises with route length and operating hours, neither
  of which is what a reader wants a line weight to tell them: tiering on it
  misplaces 11 of the 78 drawn lanes on the board, in both directions. Nor is span
  the missing measure -- the 69's span is wider than the all-day 5A's.

    weeksActive          how many of the sampled weeks the service runs AT ALL.
                         A service below half the sample cannot hold a weekly rate:
                         High Wycombe's 130, 300 and WW1 hold only bank-holiday
                         trips and `journeysPerWeek` reports them at 24, 24 and 8.
    typicalDayJourneys   journeys on the busiest WEEKDAY of the sampled weeks
    typicalDayWindow     [first, last] that day, both directions
    coreHeadwayMinutes   median gap between DISTINCT departure minutes 09:00-15:00,
                         busier direction; null when that window holds under 3
    longestDaytimeGap    largest gap 07:00-19:00, both directions -- the measure
                         that separates a shopping bus from a commuter shuttle
    typicalDayDuplicates on the profiled day, how many trip records were the same
                         journey filed again -- same departure minute, direction and
                         stop sequence -- and so were counted once. Normally 0.
                         High Wycombe's M40 files each journey up to FOUR times.
                         Counted on the DAY rather than over the whole feed on
                         purpose: St Ives' B has 60 trip records that duplicate
                         another on paper, under calendars that never coincide, so
                         no count of it was ever inflated and the honest answer is
                         zero. Since 2026-08-17 every count above is of distinct
                         journeys; this is the audit trail of what was collapsed.

  `firstDeparture`/`lastDeparture` are the FIRST SAMPLED WEEK's extremes and stay
  that way; `typicalDayWindow` is the profiled day's and is the one to reason from.
  Full argument, the eight-town evidence and the proposed thresholds: Buses repo,
  Development Docs/frequency-tier-model_2026-08-17.md.
"""
import sqlite3, sys, json, argparse, os, datetime, statistics
import gtfs_regions

DOW=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
ABBR=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
WEEKS_SAMPLED=12   # consecutive weeks expanded from the reference Monday
DAY_LO,DAY_HI=7*60,19*60      # the working day: where a hole in the service counts
CORE_LO,CORE_HI=9*60,15*60    # the core day: where a headway means what it says

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

def _make_active_svc(cur, asof):
    """Populate temp table active_svc(service_id) with services in effect on date `asof`
    (YYYYMMDD): a calendar row whose [start,end] window spans it, or a calendar_dates
    addition span that does. Used only when --asof is given."""
    cur.execute("DROP TABLE IF EXISTS active_svc")
    cur.execute("CREATE TEMP TABLE active_svc(service_id TEXT PRIMARY KEY)")
    cur.execute("INSERT OR IGNORE INTO active_svc SELECT service_id FROM calendar "
                "WHERE start_date<=? AND end_date>=?", (asof, asof))
    cur.execute("INSERT OR IGNORE INTO active_svc SELECT service_id FROM calendar_dates "
                "WHERE exception_type='1' GROUP BY service_id HAVING MIN(date)<=? AND MAX(date)>=?",
                (asof, asof))


def _load_calendar(cur):
    """calendar + calendar_dates into memory once; per-date lookups are far too
    many to push back into SQL per route."""
    cal={r["service_id"]:dict(r) for r in cur.execute("SELECT * FROM calendar")}
    exc={}
    for r in cur.execute("SELECT service_id,date,exception_type FROM calendar_dates"):
        exc.setdefault(r["service_id"],{})[r["date"]]=str(r["exception_type"])
    return cal,exc

def _runs(cal, exc, sid, ds, dow):
    """Does service `sid` operate on the date whose YYYYMMDD is `ds` and whose
    weekday column is `dow`? calendar_dates overrides calendar, which is the whole
    point of it -- a bank holiday or a school-term break is an exception row, not a
    different calendar.

    Takes the formatted date rather than the date, because the caller loops days
    outside trips and `strftime` for every (trip, date) pair was the single most
    expensive thing this module did -- 265,000 calls and 1.8 s on High Wycombe."""
    e=exc.get(sid,{}).get(ds)
    if e=="2": return False
    if e=="1": return True
    c=cal.get(sid)
    if not c or not (c["start_date"]<=ds<=c["end_date"]): return False
    return str(c[dow])=="1"

def _sample_mondays(cal, ref, n=WEEKS_SAMPLED):
    """`n` consecutive Mondays from the Monday of `ref`, stopping at the feed's
    last end_date. Consecutive rather than spread so the window straddles a school
    holiday boundary and the min/max range shows term-time variation instead of
    hiding it. Deterministic: same feed + same reference date => same weeks."""
    monday=ref-datetime.timedelta(ref.weekday())
    ends=[c["end_date"] for c in cal.values() if c.get("end_date")]
    last=max(ends) if ends else None
    out=[]
    for i in range(n):
        m=monday+datetime.timedelta(weeks=i)
        if last and m.strftime("%Y%m%d")>last: break
        out.append(m)
    return out or [monday]

def _mins(t):
    """GTFS clock time to minutes after midnight. Hours run past 24 for journeys
    belonging to the previous service day, and that is not an error to clamp."""
    p=t.split(":"); return int(p[0])*60+int(p[1])

def _clock(m): return f"{m//60:02d}:{m%60:02d}"

def _day_shape(profile):
    """Describe one weekday's departures: the window, how long you wait in the core
    of the day, and the largest hole in the working day.

    The three exist because a count cannot tell a shopping bus from a commuter
    shuttle and neither can a span. St Ives' 69 runs 07:00, 07:10, 17:30, 18:10 --
    a span of 11h10, wider than the all-day 5A -- and what identifies it is the
    ten-hour GAP. Endpoints cannot see a hole. Full argument: Buses repo,
    Development Docs/frequency-tier-model_2026-08-17.md.

    coreHeadway is the MEDIAN gap, not the worst: the worst gap of a day is set by
    the thinnest hour at 05:00 and demotes every turn-up-and-go route there is. It
    is taken in the BUSIER DIRECTION, because that is the wait a passenger going one
    way actually has; longestDaytimeGap is taken across both, because a hole in the
    service is a hole whichever way you are travelling. direction_id is not safe to
    split a small service by -- by direction the 69's four journeys become two.

    BOTH GAP MEASURES USE DISTINCT DEPARTURE MINUTES, and that is not tidying up.
    Two buses leaving at the same minute are one moment to wait for, so a repeated
    minute must not contribute a zero gap. It happens for two unrelated reasons and
    the fix is right for both: operators register the same journey under several
    overlapping service_ids (High Wycombe's M40 files every journey up to four times
    -- same headsign, same 18 stops, different service_id -- which alone dragged its
    median headway to 0 minutes), and a linked working can put two legs with
    different headsigns at one stop in the same minute (St Ives' 5A, 11:40). The
    Since 2026-08-17 the journey counts are themselves de-duplicated (see
    _trip_signatures), so a repeated minute reaching here is a genuine second
    departure -- two different journeys leaving together, as St Ives' 5A does at
    11:40 -- and distinct minutes is still the right basis for a wait."""
    if not profile: return {"typicalDayJourneys":0,"typicalDayWindow":None,
                            "coreHeadwayMinutes":None,"longestDaytimeGap":None}
    allt=sorted(m for m,_ in profile)
    inday=sorted({m for m in allt if DAY_LO<=m<=DAY_HI})
    gap=max((b-a for a,b in zip(inday,inday[1:])), default=None) if len(inday)>=2 else None
    bydir={}
    for m,dr in profile: bydir.setdefault(dr,set()).add(m)
    dom=sorted(max(bydir.values(), key=len))
    core=[m for m in dom if CORE_LO<=m<=CORE_HI]
    head=int(statistics.median(b-a for a,b in zip(core,core[1:]))) if len(core)>=3 else None
    return {
      "typicalDayJourneys":len(allt),
      "typicalDayWindow":[_clock(allt[0]),_clock(allt[-1])],
      "coreHeadwayMinutes":head,
      "longestDaytimeGap":gap,
    }

def _trip_signatures(cur, tids):
    """trip_id -> its full ordered stop list, the identity of a JOURNEY.

    Needed because the same journey is often in the feed several times over. High
    Wycombe's M40 files each one up to four times -- four `service_id`s with
    overlapping calendars, two live on any given weekday -- and they are stop-for-stop
    identical, so every count of that route came out inflated. Signature is the whole
    stop sequence rather than the endpoints, because the near-misses must NOT be
    collapsed: St Ives' 5A has two trips leaving Bar Hill at 11:40 in the same
    direction, one of 41 stops terminating at St Ives and one of 42 running on to
    Holywell. Same origin and minute, different journeys, and they stay two.

    Only trips that TIE with another on departure minute and direction can possibly
    be duplicates, so only those need a sequence fetched; the rest are their own
    identity. That matters -- fetching every town-serving trip's stop_times took High
    Wycombe from 1 s to 10 s, and its stop set is most of the feed's trips. Passed a
    temp table rather than an IN list because a route can have more trips than SQLite
    takes bound variables."""
    cur.execute("DROP TABLE IF EXISTS sig_trips")
    cur.execute("CREATE TEMP TABLE sig_trips(trip_id TEXT PRIMARY KEY)")
    cur.executemany("INSERT OR IGNORE INTO sig_trips VALUES (?)", [(t,) for t in tids])
    seqs={}
    for tid,sid in cur.execute("""
        SELECT st.trip_id, st.stop_id FROM stop_times st
         WHERE st.trip_id IN (SELECT trip_id FROM sig_trips)
         ORDER BY st.trip_id, CAST(st.stop_sequence AS INT)"""):
        seqs.setdefault(tid,[]).append(sid)
    return {k:tuple(v) for k,v in seqs.items()}

def _journey_stats(cur, rids, ph, IN, SVCF, cal, exc, mondays):
    """Real journeys per week for one route, by expanding the calendar.

    Immune to the SVCF trap by construction: every journey is counted against a
    real date, so an expired or not-yet-started timetable contributes nothing
    whether or not the caller passed --asof.

    Every count here is of DISTINCT journeys -- (departure minute at the town,
    direction, stop sequence) -- not of trip records. See _trip_signatures."""
    trips=list(cur.execute(f"""
      SELECT t.trip_id, t.service_id, t.direction_id dir, MIN(st.departure_time) dep
        FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id
       WHERE t.route_id IN ({ph}) AND {IN}{SVCF}
       GROUP BY t.trip_id""", rids))
    # only trips tying on (departure, direction) can be duplicates of one another
    tied={}
    for t in trips: tied.setdefault((t["dep"],str(t["dir"])),[]).append(t["trip_id"])
    contested=[tid for ids in tied.values() if len(ids)>1 for tid in ids]
    sigs=_trip_signatures(cur, contested) if contested else {}
    weekly=[]; best_day=0; out_n=back_n=0; deps=[]; dupday={}
    # (week, weekday) -> [(minutes, direction)], for the day-shape fields below.
    # Weekdays only: a Saturday timetable is a different product, not a thin Tuesday.
    profiles={}
    for wi,m in enumerate(mondays):
        days=[m+datetime.timedelta(i) for i in range(7)]
        n=0; per_day=[0]*7
        for j,d in enumerate(days):
            seen=set(); ds=d.strftime("%Y%m%d"); dow=DOW[d.weekday()]
            for t in trips:
                if not _runs(cal,exc,t["service_id"],ds,dow): continue
                key=(t["dep"],str(t["dir"]),sigs.get(t["trip_id"]))
                if key in seen:            # the same journey, filed again
                    dupday[(wi,j)]=dupday.get((wi,j),0)+1; continue
                seen.add(key)
                n+=1; per_day[j]+=1
                if j<5 and t["dep"]: profiles.setdefault((wi,j),[]).append((_mins(t["dep"]),str(t["dir"])))
                if m is mondays[0]:
                    if str(t["dir"])=="1": back_n+=1
                    else: out_n+=1
                    if t["dep"]: deps.append(t["dep"])
        weekly.append(n); best_day=max(best_day,max(per_day) if per_day else 0)
    live=[w for w in weekly if w]
    # lower median: an integer, and stable when the sample is even-length
    typical=sorted(live)[len(live)//2] if live else 0
    deps.sort()
    # The day profiled is the BUSIEST WEEKDAY of the sampled weeks, ties going to the
    # earliest. Deterministic, and it lands on a term-time day by itself for anything
    # school-term-heavy -- profiling "this week" would read those routes as absent
    # through August. Nothing to configure, which is the point.
    best=max(profiles, key=lambda k:(len(profiles[k]),-k[0],-k[1])) if profiles else None
    return {
      "journeysPerWeek":typical,
      "journeysPerWeekRange":[min(weekly),max(weekly)] if weekly else [0,0],
      "weeksActive":len(live),
      "busiestDayJourneys":best_day,
      "journeysOutBack":[out_n,back_n],
      "firstDeparture":deps[0][:5] if deps else None,
      "lastDeparture":deps[-1][:5] if deps else None,
      "typicalDayDuplicates":dupday.get(best,0) if best else 0,
      **_day_shape(profiles.get(best) if best else None),
    }

def query(db, prefixes=None, near=None, town=None, asof=None):
    con=sqlite3.connect(db); con.row_factory=sqlite3.Row; cur=con.cursor()
    _make_town_stops(cur, prefixes, near)
    IN="st.stop_id IN (SELECT stop_id FROM town_stops)"
    # When rendering a future/other date, restrict to services in effect then. Empty when
    # asof is None, so every query below is identical to the legacy behaviour (gates safe).
    if asof:
        _make_active_svc(cur, asof)
    SVCF = " AND t.service_id IN (SELECT service_id FROM active_svc)" if asof else ""
    # frequency is expanded over real dates, so it needs the calendar in memory and a
    # reference week. --asof moves that week; otherwise it is the week containing today.
    cal,exc=_load_calendar(cur)
    ref=datetime.datetime.strptime(asof,"%Y%m%d").date() if asof else datetime.date.today()
    mondays=_sample_mondays(cal, ref)
    # all (route, agency) calling at the town
    routes=list(cur.execute(f"""
      SELECT DISTINCT r.route_id, r.route_short_name sn, r.route_long_name ln, a.agency_name op
      FROM stop_times st JOIN trips t ON t.trip_id=st.trip_id
      JOIN routes r ON r.route_id=t.route_id JOIN agency a ON a.agency_id=r.agency_id
      WHERE {IN}{SVCF}"""))
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
          WHERE t.route_id IN ({ph}) AND {IN}{SVCF}""", rids)]
        flags=[0]*7; sd=set(); ed=set()
        for s in svc:
            rows=list(cur.execute("SELECT * FROM calendar WHERE service_id=?",(s,)))
            for c in rows:
                for i,dn in enumerate(DOW):
                    if c[dn]=="1": flags[i]=1
                sd.add(c["start_date"]); ed.add(c["end_date"])
            if not rows and asof:
                # calendar_dates-only service (common for future/new routes): derive the running
                # weekdays + window from its added dates. Only in --asof mode, to keep the default
                # output byte-identical for the gated towns.
                adds=[x[0] for x in cur.execute(
                    "SELECT date FROM calendar_dates WHERE service_id=? AND exception_type='1'",(s,))]
                for dt in adds:
                    try: flags[datetime.datetime.strptime(dt,"%Y%m%d").weekday()]=1
                    except ValueError: pass
                if adds: sd.add(min(adds)); ed.add(max(adds))
        # headsigns (operator destination labels) of town-serving trips
        heads=[x[0] for x in cur.execute(f"""
          SELECT t.trip_headsign FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id
          WHERE t.route_id IN ({ph}) AND {IN}{SVCF} AND t.trip_headsign<>''
          GROUP BY t.trip_headsign ORDER BY COUNT(*) DESC""", rids)]
        # geographic termini: first & last stop names of town-serving trips
        ends=set()
        for tid in [x[0] for x in cur.execute(f"""
            SELECT DISTINCT t.trip_id FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id
            WHERE t.route_id IN ({ph}) AND {IN}{SVCF} LIMIT 60""", rids)]:
            seq=list(cur.execute("""SELECT s.stop_name FROM stop_times st JOIN stops s ON s.stop_id=st.stop_id
              WHERE st.trip_id=? ORDER BY CAST(st.stop_sequence AS INT)""",(tid,)))
            if seq: ends.add(seq[0]["stop_name"]); ends.add(seq[-1]["stop_name"])
        # shape coverage
        hasshape=list(cur.execute(f"""SELECT COUNT(*) FROM trips t
          WHERE t.route_id IN ({ph}) AND t.shape_id IN (SELECT shape_id FROM shapes)""",rids))[0][0]>0
        # raw pattern count -- kept because it is cheap and occasionally useful for
        # spotting a route with many timing variants, but it is NOT a rate. See module docstring.
        npatterns=list(cur.execute(f"""SELECT COUNT(DISTINCT t.trip_id) FROM trips t
          JOIN stop_times st ON st.trip_id=t.trip_id
          WHERE t.route_id IN ({ph}) AND {IN}{SVCF}""", rids))[0][0]
        freq=_journey_stats(cur, rids, ph, IN, SVCF, cal, exc, mondays)
        out.append({"route":sn,"operator":" / ".join(sorted(d["ops"])),
          "days":fmt_days(flags),"daysFlags":flags,
          "validFrom":min(sd) if sd else None,"validTo":max(ed) if ed else None,
          "longName":" / ".join(sorted(d["long"])) if d["long"] else "",
          "headsigns":heads,"termini":sorted(ends),
          **freq,
          "tripPatternsAtTown":npatterns,"hasGtfsShape":hasshape})
    # variant hints: short route name whose name starts with another present route name
    names=set(by)
    for s in out:
        base=[n for n in names if n!=s["route"] and s["route"].startswith(n) and s["route"][len(n):].isalpha()]
        s["possibleVariantOf"]=base[0] if base else None
    out.sort(key=lambda s:(len(s["route"]),s["route"]))
    con.close()
    res={"town":town,"atcoPrefixes":prefixes,"near":near,"source":"BODS GTFS (east_anglia)",
         "frequencyBasis":{
             "weeksSampled":len(mondays),
             "from":mondays[0].isoformat(),"to":(mondays[-1]+datetime.timedelta(6)).isoformat(),
             "note":"journeysPerWeek is the lower median of the sampled weeks; the range shows "
                    "term-time/holiday variation. tripPatternsAtTown counts trips.txt rows and is "
                    "NOT a rate -- never rank or draw from it. To tier a line weight, use "
                    "coreHeadwayMinutes and longestDaytimeGap with a weeksActive floor, not "
                    "journeysPerWeek: a weekly total is a volume, not availability.",
             "dayProfile":"the busiest weekday of the sampled weeks; 07:00-19:00 is the working "
                    "day and 09:00-15:00 the core day"},
         "services":out}
    if asof: res["asOf"]=asof
    return res

if __name__=="__main__":
    ap=argparse.ArgumentParser(description="Bus services serving a town, from BODS GTFS.")
    ap.add_argument("prefixes",nargs="*",help="ATCO locality prefix(es), e.g. 0500HSTIV (St Ives)")
    ap.add_argument("--town")
    ap.add_argument("--near",help="geographic radius instead of/with prefixes: 'lat,lon,km' e.g. 52.3231,-0.0709,1.2")
    ap.add_argument("--asof",help="render the network as it will be on this date (YYYYMMDD or YYYY-MM-DD): "
                                  "only services in effect then are returned. Omit for today's live network.")
    ap.add_argument("--db", default=None,
                   help="this region's sqlite. NO DEFAULT - every region is treated the same (see _gtfs/regions.json); $GTFS_DB also works.")
    ap.add_argument("--out")
    a=ap.parse_args()
    # No default region: resolve --db / $GTFS_DB, or fail listing the built regions.
    a.db = gtfs_regions.resolve_db(a.db)
    near=None
    if a.near:
        la,lo,km=[float(x) for x in a.near.split(",")]; near=(la,lo,km)
    if not a.prefixes and not near:
        ap.error("give one or more ATCO prefixes, or --near lat,lon,km")
    asof=a.asof.replace("-","") if a.asof else None
    if asof and (len(asof)!=8 or not asof.isdigit()):
        ap.error("--asof must be YYYYMMDD or YYYY-MM-DD")
    res=query(a.db, a.prefixes or None, near, a.town, asof)
    fb=res["frequencyBasis"]
    print(f"  frequency basis: {fb['weeksSampled']} weeks, {fb['from']} to {fb['to']}")
    for s in sorted(res["services"], key=lambda x:-x["journeysPerWeek"]):
        v=f"  (variant of {s['possibleVariantOf']})" if s["possibleVariantOf"] else ""
        sh="shape" if s["hasGtfsShape"] else "no-shape"
        lo,hi=s["journeysPerWeekRange"]
        rng=f"({lo}-{hi})" if lo!=hi else ""
        span=("-".join(s["typicalDayWindow"]) if s["typicalDayWindow"]
              else f"{s['firstDeparture']}-{s['lastDeparture']}" if s["firstDeparture"] else "--")
        # the two tier measures, and a warning when the weekly rate is one week's worth
        hd=f"~{s['coreHeadwayMinutes']}m" if s["coreHeadwayMinutes"] is not None else "--"
        gp=f"gap {s['longestDaytimeGap']}m" if s["longestDaytimeGap"] is not None else ""
        wa="" if s["weeksActive"]>=fb["weeksSampled"] else f" [runs {s['weeksActive']}/{fb['weeksSampled']} wks]"
        print(f"  {s['route']:6s} {s['operator']:26s} {s['days']:9s} "
              f"{s['journeysPerWeek']:>4}/wk {rng:>10s} {span:>12s} {hd:>5s} {gp:>9s} {sh:8s}"
              f" -> {', '.join(s['headsigns'][:2])}{v}{wa}")
    if a.out:
        json.dump(res,open(a.out,"w",encoding="utf-8"),indent=1,ensure_ascii=False)
        print("wrote",a.out)
