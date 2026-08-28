// P4 (internal, ROAD-FOLLOWING) — build the tight-zoom close-up for a PLACE with
// route lines that follow the actual street network, instead of straight chords.
//
// This is the Phase-2 internal variant. It reuses the TOWN skill's internalRoads
// pipeline UNCHANGED — pull_roads.js (OSM road graph over the walkshed bbox) +
// match_routes.js (map-match each route's canonical chain onto that graph) — then
// runs the same gen_internal.js the classic build uses. gen_internal draws
// road-following lines whenever routes.json carries an `internalRoads` key and
// finds roads_geo.json + routes_paths.json in the run dir; this wrapper produces
// both and ensures the key is set. Everything else (title fix, POI stubs) is
// delegated to build_internal_place.js so the two internal variants stay DRY.
//
// Why a place can reuse the town road model verbatim: match_routes reads
// full.canonical[0].stops (line ~115), which is exactly the shape gtfs_chains.py
// writes for a place; pull_roads sizes its bbox from routes_intown_atco.json (the
// walkshed clip), so the road graph is already scoped to the close-up. No town-
// specific assumptions — see references/internal-reuse.md (Phase-2 item 1).
//
// Requires in the cwd (pulled from S2 in the pipeline): routes.json (place
// config), atco2ll.json, atco2name.json, routes_intown_atco.json,
// routes_full_atco.json, plus osm.json/osm2.json/river_geo.json (stubs ok).
// Writes: roads_geo.json, routes_paths.json, internal.svg.
//
// Usage: node build_internal_place_roads.js [roadMarginKm]
//   env TSK = make-bus-leaflet assets dir (defaults to the standard install path).
//   roadMarginKm (default 0.6) = extra box around the drawn stops for pull_roads.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = process.env.LEAFLET_DIR || process.cwd();
const TSK = process.env.TSK || path.resolve(__dirname, '..', '..', 'make-bus-leaflet', 'assets');
const PSK = __dirname;
const roadMarginKm = process.argv[2] || process.env.ROADS_MARGIN_KM || '0.6';

function run(label, script, args, extraEnv) {
  const env = Object.assign({}, process.env, { LEAFLET_DIR: DIR, SKILL_ASSETS: TSK }, extraEnv || {});
  const res = spawnSync(process.execPath, [script].concat(args || []), { cwd: DIR, env, stdio: 'inherit' });
  if (res.status !== 0) { console.error('build_internal_place_roads: ' + label + ' failed'); process.exit(res.status || 1); }
}

// 1) ensure the config opts into road-following. Prefer a declared internalRoads
//    block in routes.json (config-driven / portal-friendly); if the place config
//    hasn't declared one, default it to {} so the wrapper still works ad hoc.
const rjPath = path.join(DIR, 'routes.json');
const RJ = JSON.parse(fs.readFileSync(rjPath, 'utf8'));
const ir = (RJ.internalRoads == null || RJ.internalRoads === true) ? {} : RJ.internalRoads;
// PLACE FIT FIX: gen_internal's internalRoads fit set is the stops sharing the
// ANCHOR's ATCO locality prefix (town engine assumption: fit the town core, let
// out-of-core tails run off the frame). A place walkshed routinely spans MORE than
// one locality — St Neots Tesco sits on the Eynesbury/St Neots boundary
// (0500HEYNE* + 0500HSTNS*) — so the prefix fit lands on a fraction of the drawn
// stops and the map fits to that fraction (routes clip at the frame, composition
// off-centre). The walkshed clip already scoped routes_intown to the close-up, so
// the right fit for a place is ALL drawn stops: inject them as fitExtra.
if (ir.fitExtra == null) {
  const it = JSON.parse(fs.readFileSync(path.join(DIR, 'routes_intown_atco.json'), 'utf8'));
  const s = new Set(); for (const r in it) for (const a of it[r]) s.add(a);
  ir.fitExtra = [...s];
  console.log('fitExtra <- all ' + ir.fitExtra.length + ' drawn stops (place spans localities).');
}
if (ir.fitMargin == null) ir.fitMargin = 8;   // room for road tails / terminus arrows
RJ.internalRoads = ir;
fs.writeFileSync(rjPath, JSON.stringify(RJ, null, 2));

// 2) OSM road graph over the walkshed bbox (+margin), then map-match the routes.
run('pull_roads', path.join(TSK, 'pull_roads.js'), [roadMarginKm]);
run('match_routes', path.join(TSK, 'match_routes.js'), []);

// 3) gen_internal + title fix, via the shared classic wrapper. Passes the build
//    version with any leading "v" stripped - the place convention stores "v1.0"
//    and gen_internal used to prefix its own "v", giving "vv1.0". INERT since
//    2026-08-10: the engine build number is no longer printed on the sheet, so
//    nothing renders either form. Kept for provenance; see gen_internal_place.js.
const ver = String(process.env.LEAFLET_VERSION || RJ.version || '').replace(/^v/i, '');
run('build_internal_place', path.join(PSK, 'build_internal_place.js'), [],
    ver ? { LEAFLET_VERSION: ver } : {});

console.log('road-following internal.svg written (internalRoads).');
