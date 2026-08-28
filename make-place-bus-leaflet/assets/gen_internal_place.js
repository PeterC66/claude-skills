// gen_internal_place.js — the PLACE internal generator (portal-vendored).
//
// A place's internal map ("Buses serving <place>") is drawn by the SAME town
// generator as an area map (gen_internal.js) — road-following when routes.json
// carries `internalRoads` and roads_geo.json + routes_paths.json are present, all
// of which are baked into the map payload, so there is NO network here. The town
// generator can express everything a place needs EXCEPT two things, which this
// thin wrapper supplies (mirroring the skill's build_internal_place.js /
// build_internal_place_roads.js, minus the build-time OSM pulls):
//
//   1. TITLE — gen_internal hardcodes "Buses within <town>"; a place wants
//      "Buses serving <place>". We string-replace that one token afterwards.
//   2. VERSION STAMP — INERT since 2026-08-10, kept for provenance only. The
//      place convention stores version:"v1.0" (leading v) and gen_internal USED
//      to render "Map v" + version, doubling to "Map vv1.0"; the leading-v strip
//      below is the fix for that doubling. Nothing renders it any more - the
//      engine build number was dropped from the public sheet (see footer.js) and
//      no place sheet has ever carried one. Do not delete the strip to "simplify"
//      it, and do not re-derive the doubling bug: neither is reachable today.
//
// It is a strict S4/S5 (deterministic) citizen: reads LEAFLET_DIR + OVERRIDES_FILE
// + EDITOR_KEYS from the env (all inherited by the child), writes internal.svg,
// never hits the network, and never mutates overrides.json. The river-hide /
// frozen-viewport expert framing some places need is NOT applied here — it lives
// in the map's base-overrides.json and is merged into OVERRIDES_FILE by the portal
// before this runs (see src/maps/engine.js).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = process.env.LEAFLET_DIR || process.cwd();
const gen = path.join(DIR, 'gen_internal.js');
if (!fs.existsSync(gen)) {
  console.error('gen_internal_place: gen_internal.js is not vendored beside the payload');
  process.exit(1);
}
const RJ = JSON.parse(fs.readFileSync(path.join(DIR, 'routes.json'), 'utf8'));

// Pass the version through with any leading "v" stripped (unless the caller set one).
const env = { ...process.env };
if (env.LEAFLET_VERSION == null) env.LEAFLET_VERSION = String(RJ.version || '').replace(/^v/i, '');

// Run the UNCHANGED town generator; the inherited env carries LEAFLET_DIR,
// SKILL_ASSETS, OVERRIDES_FILE and EDITOR_KEYS straight through to it.
const res = spawnSync(process.execPath, [gen], { cwd: DIR, env, stdio: 'inherit' });
if (res.status !== 0) process.exit(res.status || 1);

// Swap the title token. Same precedence as build_internal_place.js.
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const emitted = 'Buses within ' + esc(RJ.town);
const title = RJ.internalTitle || RJ.placeTitle || ('Buses serving ' + (RJ.placeShort || RJ.place || RJ.town));
const svgPath = path.join(DIR, 'internal.svg');
let svg = fs.readFileSync(svgPath, 'utf8');
if (svg.includes('>' + emitted + '<')) {
  svg = svg.replace('>' + emitted + '<', '>' + esc(title) + '<');
  fs.writeFileSync(svgPath, svg);
  console.log('internal.svg title -> ' + JSON.stringify(title));
} else {
  console.log('internal.svg written (title token not matched; RJ.town=' + JSON.stringify(RJ.town) + ').');
}
