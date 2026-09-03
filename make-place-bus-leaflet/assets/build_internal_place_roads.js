// P4 (internal, ROAD-FOLLOWING) — build the tight-zoom close-up for a PLACE with
// route lines that follow the actual street network, instead of straight chords.
//
// This is the Phase-2 internal variant. It reuses the TOWN skill's internalRoads
// pipeline UNCHANGED — pull_roads.js (OSM road graph over the walkshed bbox) +
// match_routes.js (map-match each route's canonical chain onto that graph) — then
// runs the same gen_internal.js the classic build uses. Since 2026-08-29 the
// pull half is REUSED rather than re-fetched by default; see step 2. gen_internal draws
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
//   env ROADS_REPULL=1 = re-fetch the OSM road graph from Overpass. OFF by
//     default since 2026-08-29 (OA-159): the graph is seeded forward from the
//     previous S4, the way an engine rollout already does, so a config-only
//     rebuild does not silently take an OSM delta with it. Set it when you
//     actually mean to refresh the roads, and give that its own diff.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = process.env.LEAFLET_DIR || process.cwd();
// TSK through place_engine.js — see build_internal_place.js's note (OA-232 Tier 3.1).
const { TOWN_ASSETS } = require('./place_engine.js');
const TSK = process.env.TSK || TOWN_ASSETS;
const PSK = __dirname;
const roadMarginKm = process.argv[2] || process.env.ROADS_MARGIN_KM || '0.6';

function run(label, script, args, extraEnv) {
  const env = Object.assign({}, process.env, { LEAFLET_DIR: DIR, SKILL_ASSETS: TSK }, extraEnv || {});
  const res = spawnSync(process.execPath, [script].concat(args || []), { cwd: DIR, env, stdio: 'inherit' });
  if (res.status !== 0) { console.error('build_internal_place_roads: ' + label + ' failed'); process.exit(res.status || 1); }
}

// Find the previous committed S4 for this place and copy its roads_geo.json in.
// The manifest is the index of record (see make-bus-leaflet/SKILL.md); walk up
// from the run dir to find it, the same way stage.js does. roads_geo.json is
// one of the files a build stage writes back into its own run folder and never
// registers as a stage output, which is exactly why `stage.js pull` does not
// bring it forward and why this has to reach for it explicitly.
function seedRoadsFromPrevS4(dir) {
  let d = path.resolve(dir);
  for (let i = 0; i < 8; i++) {
    const mp = path.join(d, 'manifest.json');
    if (fs.existsSync(mp)) {
      let m; try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) { return null; }
      const s4 = m.stages && m.stages.S4;
      if (!s4 || !s4.latest) return null;
      const rec = (s4.runs || []).find(r => r.id === s4.latest);
      if (!rec) return null;
      const src = path.join(d, rec.dir, 'roads_geo.json');
      if (!fs.existsSync(src)) return null;
      fs.copyFileSync(src, path.join(dir, 'roads_geo.json'));
      return rec.id;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
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
//
// THE ROAD GRAPH IS SEEDED FORWARD, NOT RE-FETCHED (OA-159, 2026-08-29).
// Until this changed, the two ways of rebuilding a place map were not
// equivalent and the difference was a network call. An ENGINE ROLLOUT goes
// through rollout_places.js, which seeds roads_geo.json and routes_paths.json
// forward from the previous S4 (seed_prev_s4.js) and is therefore
// deterministic. A CONFIG change follows the documented P4 path -- this file --
// which ran pull_roads.js unconditionally, and pull_roads had no cache, no skip
// and no offline mode. So every config round on the place estate re-pulled OSM
// for every place it touched, at the exact moment it was trying to attribute a
// config change, and an OSM delta is in no commit and readable from no diff of
// our own files.
//
// The skip is now the DEFAULT and the re-pull is the OPT-IN, because the old
// default was the surprising one: a road graph is an input, and re-fetching an
// input is a decision rather than housekeeping. This mirrors what OA-019 item
// (e) decided about pull_locator.js on 2026-08-24 -- roads deserved the same
// treatment and never got it.
//
// Two safeguards keep this from being a blind cache. pull_roads --reuse checks
// CONTAINMENT, not existence: a graph is only kept if its stored bbox covers
// the box this run needs, so a config change that adds a stop or widens the fit
// re-pulls rather than drawing routes off the end of the road network. And the
// seed says where the graph came from, every time, on stdout.
//
// To refresh the roads deliberately -- which is a real thing to want, and this
// is not an argument for never pulling -- set ROADS_REPULL=1. Then it is its
// own change with its own diff, which is the whole point.
const REPULL = /^(1|true|yes)$/i.test(String(process.env.ROADS_REPULL || ''));
if (!REPULL && !fs.existsSync(path.join(DIR, 'roads_geo.json'))) {
  const seeded = seedRoadsFromPrevS4(DIR);
  if (seeded) console.log('roads_geo.json <- previous S4 (' + seeded + ') — no Overpass call unless the bbox grew.');
  else console.log('roads_geo.json: none here and none in a previous S4 — pull_roads will fetch it.');
}
if (REPULL) console.log('ROADS_REPULL=1 — re-fetching the OSM road graph deliberately. Expect an unattributable geometry delta; give it its own diff.');
run('pull_roads', path.join(TSK, 'pull_roads.js'), REPULL ? [roadMarginKm] : [roadMarginKm, '--reuse']);
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
