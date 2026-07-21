// P4 (internal) — build the tight-zoom close-up map for a PLACE by reusing the
// town skill's gen_internal.js UNCHANGED, the same way schematize_internal.js does.
//
// gen_internal auto-fits to the bounding box of the stops present in
// routes_intown_atco.json, so feeding it a walkshed-clipped routes_intown (from
// derive_walkshed.js) is what produces the close-up — no renderer change. We run it
// in "classic" mode (routes.json has NO internalRoads key), so route lines are drawn
// straight between stops from atco2ll — no OSM road-matching pipeline needed. The
// only thing gen_internal can't express for a place is the TITLE (it hardcodes
// "Buses within <town>"), so this wrapper fixes that one string afterwards, leaving
// the shared town generator untouched.
//
// Requires in the cwd: routes.json (place config), atco2ll.json, atco2name.json,
// routes_intown_atco.json, osm.json, osm2.json, river_geo.json. Writes internal.svg.
//
// Usage: node build_internal_place.js
//   env TSK = the make-bus-leaflet assets dir (defaults to the standard install path).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = process.env.LEAFLET_DIR || process.cwd();
const TSK = process.env.TSK || require('path').resolve(
  __dirname, '..', '..', 'make-bus-leaflet', 'assets');
const RJ = JSON.parse(fs.readFileSync(path.join(DIR, 'routes.json'), 'utf8'));

// gen_internal hard-requires these files; write empty stubs if a caller omitted them.
for (const [f, empty] of [['osm.json', '{"elements":[]}'], ['osm2.json', '{"elements":[]}'],
                          ['river_geo.json', '[]']]) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) fs.writeFileSync(p, empty);
}

const gen = [path.join(DIR, 'gen_internal.js'), path.join(TSK, 'gen_internal.js')]
  .find(f => fs.existsSync(f));
if (!gen) { console.error('build_internal_place: gen_internal.js not found (set env TSK)'); process.exit(1); }

// Run the UNCHANGED town generator with cwd = DIR. Ensure LEAFLET_DIR points at DIR
// (not an inherited town folder) and pass SKILL_ASSETS so icons.js resolves.
const env = Object.assign({}, process.env, { LEAFLET_DIR: DIR, SKILL_ASSETS: TSK });
const res = spawnSync(process.execPath, [gen], { cwd: DIR, env, stdio: 'inherit' });
if (res.status !== 0) process.exit(res.status || 1);

// Fix the title: gen_internal emitted ">Buses within <RJ.town><". Replace with the
// place title. RJ.placeTitle wins; else "Buses serving <RJ.placeShort|place>".
const svgPath = path.join(DIR, 'internal.svg');
let svg = fs.readFileSync(svgPath, 'utf8');
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const emitted = 'Buses within ' + esc(RJ.town);
const title = RJ.placeTitle || ('Buses serving ' + (RJ.placeShort || RJ.place || RJ.town));
if (svg.includes('>' + emitted + '<')) {
  svg = svg.replace('>' + emitted + '<', '>' + esc(title) + '<');
  fs.writeFileSync(svgPath, svg);
  console.log('internal.svg title -> ' + JSON.stringify(title));
} else {
  console.log('internal.svg written (title token not matched; check RJ.town). Title left as-is.');
}
