#!/usr/bin/env python3
"""Build the shared NaPTAN stop register used alongside the per-region GTFS datasets.

WHY THIS EXISTS. BODS GTFS gives us five stop columns (stop_id, stop_code,
stop_name, stop_lat, stop_lon) and no way to tell one stop from the next when
they share a name. Cambridge's Drummer Street is ten rows all called
"Drummer St Bus Station"; St Neots' Market Square is five rows all called
"Market Square". NaPTAN -- the DfT register the ATCO codes themselves come
from -- carries the Indicator ("Stop E", "Bay 1", "opp", "o/s"), the Bearing,
the Street and the Landmark for every one of them. Same key, no join table
needed: GTFS `stop_id` IS the NaPTAN `ATCOCode`.

Source = NaPTAN open data, Open Government Licence v3.0, no API key needed:
  https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv&atcoAreaCodes=<AAA>
Rate limit is 200 requests/hour; this script makes one request per ATCO area.

USAGE. Run from anywhere; --out is the only required argument.

  python naptan_build.py --out "C:/u3a St Ives/Using AI/Buses/_gtfs/naptan.sqlite"

By default it fetches exactly the ATCO areas our built GTFS datasets actually
reference -- it opens every `db` in _gtfs/regions.json whose status is "built"
and takes the distinct first three characters of every stop_id. That is ~29
areas and ~10 MB, versus 96 MB for the national file, and it self-updates when
a region is added. Override with either of:

  --areas 050,057,040        only these ATCO area codes (3 digits, comma-separated)
  --all                      the whole national register in one request

Other options:
  --root <dir>   the Buses folder holding _gtfs/ (default: inferred from --out)
  --keep-cache   also write each area's raw CSV beside --out, for inspection

OUTPUT. `naptan.sqlite` (git-ignored, regenerable) with one table, `naptan`,
keyed on ATCOCode, plus `feed_info_naptan.json` beside it (committed -- it is
the provenance, matching the per-region feed_info sidecars).

THE `stand` COLUMN IS THE POINT, AND IT IS SPARSE. NaPTAN's Indicator is
populated on essentially every row, but most of the time it is a relative
descriptor ("opp", "near", "o/s") that is meaningless without knowing which
side of what. Only a minority are a real stand code a passenger can read off
the flag. So this script derives two extra columns -- `stand` (the bare code,
uppercased: "E", "1", "12A") and `stand_kind` ("stop"/"bay"/"stand"/"gate"/
"platform"/"stance"/"berth"/"bare") -- and leaves them NULL for everything
else. Never fall back to Indicator when stand is NULL: printing "opp" on a map
tells a reader nothing, and inventing a letter is worse than printing none.

The coverage report this prints (and stores in the sidecar) is the number that
decides whether a boarding plan is possible at a given place. See
`Development Docs/boarding-plan-product_2026-08-22.md`.

REFRESH. NaPTAN changes slowly -- a stop's ModificationDateTime is typically
years old -- so this does not need the monthly GTFS cadence. Re-run it when a
town reports a stop we have no row for, or a few times a year. Rebuilding is
idempotent: the table is dropped and recreated.
"""
import argparse
import csv
import io
import json
import math
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

SCRIPT_VERSION = "1.0"
API = "https://naptan.api.dft.gov.uk/v1/access-nodes"
LICENCE = "Open Government Licence v3.0"

# The columns kept, in table order. NaPTAN publishes 43; these are the ones
# anything downstream has a use for. Adding one is a one-line edit here plus a
# rebuild -- the CSV reader tolerates a column that is absent from a feed.
COLUMNS = [
    "ATCOCode", "NaptanCode", "PlateCode",
    "CommonName", "ShortCommonName",
    "Landmark", "Street", "Crossing", "Indicator", "Bearing",
    "NptgLocalityCode", "LocalityName", "ParentLocalityName", "Town", "Suburb",
    "Easting", "Northing", "Longitude", "Latitude",
    "StopType", "BusStopType", "TimingStatus",
    "AdministrativeAreaCode", "CreationDateTime", "ModificationDateTime",
    "RevisionNumber", "Status",
]

# A stand code is a code a passenger can read off the flag and match on the map.
# Anything else -- "opp", "near", "o/s", "adj", "N-bound", "entrance" -- is a
# relative descriptor and is deliberately NOT a stand.
STAND_RE = re.compile(
    r"^(stop|stand|bay|gate|platform|stance|berth)\s*([0-9]{1,3}[a-z]?|[a-z]{1,2})$",
    re.IGNORECASE,
)
# Some authorities put the bare code in Indicator with no word in front. Kept,
# but flagged 'bare' so a caller that wants only the unambiguous ones can say so.
BARE_RE = re.compile(r"^[A-Z]{1,2}$")


# ---------------------------------------------------------------- position
# NaPTAN's own Longitude/Latitude columns are BLANK on most rows -- 12,401 of
# 127,658 nationally when this was written, and the great majority of
# Cambridgeshire's. Easting/Northing (OSGB36 National Grid) are always there.
# So the derived `lat`/`lon` prefer NaPTAN's WGS84 pair where it exists and
# convert the grid reference where it does not, rather than shipping a column
# that is silently null for most of our home county.
#
# Standard reverse transverse Mercator onto Airy 1830, then the OSGB36->WGS84
# Helmert transform. Accurate to a few metres, which is well inside the width of
# a bus stop. Deterministic, no dependencies.
_AIRY_A, _AIRY_B = 6377563.396, 6356256.909
_F0, _LAT0, _LON0, _E0, _N0 = 0.9996012717, math.radians(49.0), math.radians(-2.0), 400000.0, -100000.0
_WGS_A, _WGS_F = 6378137.0, 1 / 298.257223563


def osgb_to_wgs84(easting, northing):
    """(lat, lon) in WGS84 degrees from an OSGB36 National Grid reference in metres."""
    a, b, f0, lat0, lon0, e0, n0 = _AIRY_A, _AIRY_B, _F0, _LAT0, _LON0, _E0, _N0
    e2 = 1 - (b * b) / (a * a)
    n = (a - b) / (a + b)
    lat, m = lat0, 0.0
    for _ in range(100):
        lat = (northing - n0 - m) / (a * f0) + lat
        dl, sl = lat - lat0, lat + lat0
        ma = (1 + n + 1.25 * n * n + 1.25 * n ** 3) * dl
        mb = (3 * n + 3 * n * n + 2.625 * n ** 3) * math.sin(dl) * math.cos(sl)
        mc = (1.875 * n * n + 1.875 * n ** 3) * math.sin(2 * dl) * math.cos(2 * sl)
        md = (35.0 / 24.0) * n ** 3 * math.sin(3 * dl) * math.cos(3 * sl)
        m = b * f0 * (ma - mb + mc - md)
        if abs(northing - n0 - m) < 1e-5:
            break
    sin_lat, tan_lat = math.sin(lat), math.tan(lat)
    nu = a * f0 / math.sqrt(1 - e2 * sin_lat ** 2)
    rho = a * f0 * (1 - e2) / (1 - e2 * sin_lat ** 2) ** 1.5
    eta2 = nu / rho - 1
    t2, t4, t6 = tan_lat ** 2, tan_lat ** 4, tan_lat ** 6
    sec = 1.0 / math.cos(lat)
    vii = tan_lat / (2 * rho * nu)
    viii = tan_lat / (24 * rho * nu ** 3) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2)
    ix = tan_lat / (720 * rho * nu ** 5) * (61 + 90 * t2 + 45 * t4)
    x = sec / nu
    xi = sec / (6 * nu ** 3) * (nu / rho + 2 * t2)
    xii = sec / (120 * nu ** 5) * (5 + 28 * t2 + 24 * t4)
    xiia = sec / (5040 * nu ** 7) * (61 + 662 * t2 + 1320 * t4 + 720 * t6)
    de = easting - e0
    lat_a = lat - vii * de ** 2 + viii * de ** 4 - ix * de ** 6
    lon_a = lon0 + x * de - xi * de ** 3 + xii * de ** 5 - xiia * de ** 7
    # OSGB36 (Airy) -> WGS84 (GRS80), Helmert
    e2a = e2
    sa, ca = math.sin(lat_a), math.cos(lat_a)
    nu_a = a / math.sqrt(1 - e2a * sa * sa)
    x1 = nu_a * ca * math.cos(lon_a)
    y1 = nu_a * ca * math.sin(lon_a)
    z1 = (1 - e2a) * nu_a * sa
    tx, ty, tz = 446.448, -125.157, 542.060
    s = -20.4894e-6
    rx, ry, rz = (math.radians(v / 3600.0) for v in (0.1502, 0.2470, 0.8421))
    x2 = tx + x1 * (1 + s) - y1 * rz + z1 * ry
    y2 = ty + x1 * rz + y1 * (1 + s) - z1 * rx
    z2 = tz - x1 * ry + y1 * rx + z1 * (1 + s)
    a2 = _WGS_A
    e2b = 2 * _WGS_F - _WGS_F * _WGS_F
    p = math.sqrt(x2 * x2 + y2 * y2)
    lat_b = math.atan2(z2, p * (1 - e2b))
    for _ in range(10):
        nu_b = a2 / math.sqrt(1 - e2b * math.sin(lat_b) ** 2)
        lat_b = math.atan2(z2 + e2b * nu_b * math.sin(lat_b), p)
    return math.degrees(lat_b), math.degrees(math.atan2(y2, x2))


def derive_position(row):
    """(lat, lon, source) for a NaPTAN row: 'naptan' if it published WGS84, 'osgb' if converted."""
    lat, lon = (row.get("Latitude") or "").strip(), (row.get("Longitude") or "").strip()
    if lat and lon:
        try:
            return float(lat), float(lon), "naptan"
        except ValueError:
            pass
    e, nn = (row.get("Easting") or "").strip(), (row.get("Northing") or "").strip()
    if e and nn:
        try:
            la, lo = osgb_to_wgs84(float(e), float(nn))
            return round(la, 7), round(lo, 7), "osgb"
        except ValueError:
            pass
    return None, None, None


def derive_stand(indicator):
    """(stand, stand_kind) for an Indicator, or (None, None) if it is not a stand code."""
    ind = (indicator or "").strip()
    if not ind:
        return None, None
    m = STAND_RE.match(ind)
    if m:
        return m.group(2).upper(), m.group(1).lower()
    if BARE_RE.match(ind):
        return ind.upper(), "bare"
    return None, None


def built_region_dbs(root):
    """[(region_name, db_path)] for every region in regions.json marked built and present on disk."""
    reg_path = os.path.join(root, "_gtfs", "regions.json")
    if not os.path.exists(reg_path):
        sys.exit(f"regions.json not found at {reg_path} -- pass --root or --areas")
    with open(reg_path, encoding="utf-8") as fh:
        reg = json.load(fh)
    out = []
    for name, r in reg.get("regions", {}).items():
        if name.startswith("_"):
            continue
        if r.get("status") != "built":
            continue
        db = r.get("db")
        if db and os.path.exists(db):
            out.append((name, db))
        else:
            print(f"  region {name}: marked built but its db is missing ({db}) -- NOT SCANNED")
    return out


def areas_from_dbs(dbs):
    """The distinct ATCO area codes (first 3 chars of stop_id) our datasets reference."""
    areas = {}
    for name, db in dbs:
        con = sqlite3.connect(db)
        try:
            rows = con.execute(
                "SELECT substr(stop_id,1,3) a, COUNT(*) n FROM stops GROUP BY 1"
            ).fetchall()
        finally:
            con.close()
        for a, n in rows:
            areas[a] = areas.get(a, 0) + n
        print(f"  {name}: {sum(n for _, n in rows)} stops across {len(rows)} ATCO areas")
    return areas


def fetch_area(area, retries=3):
    """The CSV text for one ATCO area, or None with the reason printed."""
    url = f"{API}?dataFormat=csv&atcoAreaCodes={area}"
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=180) as resp:
                return resp.read().decode("utf-8-sig")
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                print(f"  area {area}: NOT FETCHED -- HTTP {e.code} (not a valid NaPTAN area)")
                return None
            print(f"  area {area}: HTTP {e.code}, attempt {attempt}/{retries}")
        except Exception as e:                                  # noqa: BLE001
            print(f"  area {area}: {type(e).__name__}: {e}, attempt {attempt}/{retries}")
        if attempt < retries:
            time.sleep(3 * attempt)
    print(f"  area {area}: NOT FETCHED -- gave up after {retries} attempts")
    return None


def fetch_national(retries=3):
    url = f"{API}?dataFormat=csv"
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=900) as resp:
                return resp.read().decode("utf-8-sig")
        except Exception as e:                                  # noqa: BLE001
            print(f"  national: {type(e).__name__}: {e}, attempt {attempt}/{retries}")
            if attempt < retries:
                time.sleep(5 * attempt)
    sys.exit("national NaPTAN download failed")


def create_table(con):
    con.execute("DROP TABLE IF EXISTS naptan")
    cols = ", ".join(f"{c} TEXT" for c in COLUMNS)
    con.execute(f"CREATE TABLE naptan ({cols}, stand TEXT, stand_kind TEXT, area TEXT, "
                f"lat REAL, lon REAL, pos_source TEXT)")


def insert_csv(con, text, seen):
    """Insert the rows of one CSV, skipping ATCOCodes already inserted. Returns rows added."""
    rd = csv.DictReader(io.StringIO(text))
    ins = (
        f"INSERT INTO naptan ({','.join(COLUMNS)}, stand, stand_kind, area, lat, lon, pos_source) "
        f"VALUES ({','.join('?' * (len(COLUMNS) + 6))})"
    )
    batch, added = [], 0
    for row in rd:
        atco = (row.get("ATCOCode") or "").strip()
        if not atco or atco in seen:
            continue
        seen.add(atco)
        stand, kind = derive_stand(row.get("Indicator"))
        lat, lon, src = derive_position(row)
        vals = [(row.get(c) or "").strip() or None for c in COLUMNS]
        batch.append(tuple(vals) + (stand, kind, atco[:3], lat, lon, src))
        added += 1
        if len(batch) >= 20000:
            con.executemany(ins, batch)
            batch = []
    if batch:
        con.executemany(ins, batch)
    con.commit()
    return added


def coverage(con, dbs):
    """Per-region: how many of our GTFS stops NaPTAN knows, and how many carry a stand code."""
    out = []
    for name, db in dbs:
        con.execute("ATTACH DATABASE ? AS g", (db,))
        try:
            total = con.execute("SELECT COUNT(*) FROM g.stops").fetchone()[0]
            matched = con.execute(
                "SELECT COUNT(*) FROM g.stops s JOIN naptan n ON n.ATCOCode = s.stop_id"
            ).fetchone()[0]
            standed = con.execute(
                "SELECT COUNT(*) FROM g.stops s JOIN naptan n ON n.ATCOCode = s.stop_id "
                "WHERE n.stand IS NOT NULL"
            ).fetchone()[0]
            bearing = con.execute(
                "SELECT COUNT(*) FROM g.stops s JOIN naptan n ON n.ATCOCode = s.stop_id "
                "WHERE n.Bearing IS NOT NULL"
            ).fetchone()[0]
        finally:
            con.execute("DETACH DATABASE g")
        out.append({
            "region": name,
            "gtfsStops": total,
            "matchedInNaptan": matched,
            "withStandCode": standed,
            "withBearing": bearing,
        })
    return out


def main():
    ap = argparse.ArgumentParser(description="Build the NaPTAN stop register (naptan.sqlite).")
    ap.add_argument("--out", required=True, help="path to naptan.sqlite to (re)build")
    ap.add_argument("--root", help="the Buses folder holding _gtfs/ (default: parent of --out's folder)")
    ap.add_argument("--areas", help="comma-separated 3-digit ATCO area codes instead of scanning the datasets")
    ap.add_argument("--all", action="store_true", help="fetch the whole national register in one request")
    ap.add_argument("--keep-cache", action="store_true", help="write each area's CSV beside --out for inspection")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    root = args.root or os.path.dirname(os.path.dirname(out))
    started = datetime.now(timezone.utc)

    print(f"NaPTAN build v{SCRIPT_VERSION}")
    print(f"  out  : {out}")
    print(f"  root : {root}")

    dbs = built_region_dbs(root)

    if args.all:
        mode, area_counts = "national", {}
    elif args.areas:
        mode = "areas (given)"
        area_counts = {a.strip(): None for a in args.areas.split(",") if a.strip()}
    else:
        mode = "areas (from built datasets)"
        print("Scanning built datasets for the ATCO areas they reference:")
        area_counts = areas_from_dbs(dbs)

    os.makedirs(os.path.dirname(out), exist_ok=True)
    if os.path.exists(out):
        os.remove(out)
    con = sqlite3.connect(out)
    con.execute("PRAGMA journal_mode=OFF")
    con.execute("PRAGMA synchronous=OFF")
    create_table(con)

    seen = set()
    fetched, failed = [], []
    if args.all:
        print("Fetching the national register (this is the 96 MB one)...")
        added = insert_csv(con, fetch_national(), seen)
        fetched.append({"area": "ALL", "rows": added})
        print(f"  national: {added} rows")
    else:
        order = sorted(area_counts, key=lambda a: (-(area_counts.get(a) or 0), a))
        print(f"Fetching {len(order)} ATCO areas...")
        for area in order:
            text = fetch_area(area)
            if text is None:
                failed.append(area)
                continue
            added = insert_csv(con, text, seen)
            fetched.append({"area": area, "rows": added, "gtfsStopsHere": area_counts.get(area)})
            print(f"  area {area}: {added} rows")
            if args.keep_cache:
                with open(os.path.join(os.path.dirname(out), f"naptan_{area}.csv"), "w", encoding="utf-8") as fh:
                    fh.write(text)

    for stmt in (
        "CREATE UNIQUE INDEX ix_naptan_atco ON naptan(ATCOCode)",
        "CREATE INDEX ix_naptan_name ON naptan(CommonName)",
        "CREATE INDEX ix_naptan_locality ON naptan(NptgLocalityCode)",
        "CREATE INDEX ix_naptan_stand ON naptan(stand) WHERE stand IS NOT NULL",
    ):
        con.execute(stmt)
    con.commit()
    con.execute("VACUUM")

    rows = con.execute("SELECT COUNT(*) FROM naptan").fetchone()[0]
    stands = con.execute("SELECT COUNT(*) FROM naptan WHERE stand IS NOT NULL").fetchone()[0]
    active = con.execute("SELECT COUNT(*) FROM naptan WHERE Status='active'").fetchone()[0]
    cov = coverage(con, dbs)
    con.close()

    print()
    print(f"Built {rows} stops ({active} active), {stands} carrying a stand code.")
    if failed:
        print(f"NOT FETCHED: {', '.join(failed)} -- these areas have no rows in the register below.")
    print()
    print(f"{'region':<18}{'gtfs stops':>11}{'in naptan':>11}{'bearing':>9}{'stand code':>12}")
    for c in cov:
        print(f"{c['region']:<18}{c['gtfsStops']:>11}{c['matchedInNaptan']:>11}"
              f"{c['withBearing']:>9}{c['withStandCode']:>12}")

    sidecar = os.path.join(os.path.dirname(out), "feed_info_naptan.json")
    with open(sidecar, "w", encoding="utf-8") as fh:
        json.dump({
            "source": "NaPTAN (DfT)",
            "api": API,
            "licence": LICENCE,
            "scriptVersion": SCRIPT_VERSION,
            "mode": mode,
            "builtAt": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "buildSeconds": round((datetime.now(timezone.utc) - started).total_seconds(), 1),
            "stops": rows,
            "activeStops": active,
            "withStandCode": stands,
            "areasFetched": fetched,
            "areasNotFetched": failed,
            "coverage": cov,
        }, fh, indent=1)
    print(f"\nProvenance written to {sidecar}")


if __name__ == "__main__":
    main()
