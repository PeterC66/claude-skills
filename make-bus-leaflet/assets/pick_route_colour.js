#!/usr/bin/env node
/*
 * pick_route_colour.js — suggest a replacement hue for one route on one town.
 *
 * The other half of the §5.2 check. `gen_internal.js` says at build time that a
 * route is wearing the water's colour (PALETTE WARNING); this says what to move it
 * to, and shows its work, because "pick another colour" on a sheet that already
 * carries 8–12 of them is not a judgement anyone should make by eye.
 *
 *   node pick_route_colour.js --town "St Ives" --route 9
 *   node pick_route_colour.js --town Ramsey --route X31 --pool "#009988,#332288"
 *
 * THE RULE IT ENCODES: score every candidate against EVERY OTHER COLOUR ON THE
 * SHEET **plus the water**, and take the one whose WORST separation is largest —
 * not the one that is furthest from the colour you are replacing. A hue can be
 * numerically far from the river and still land next to the route it now has to
 * be told apart from. Ramsey is exactly that case: teal scored 39.1 and its worst
 * neighbour was the green 303, which X31 runs beside for the length of Wood Lane,
 * so indigo (49.3) was the right answer. **Then render it and look** — "runs
 * beside" is not in these numbers.
 *
 * Read-only: prints a table, writes nothing. Zero dependencies (Node core only).
 * The Lab maths is a deliberate copy of the block in `gen_internal.js` rather than
 * a shared module: a new shared module adds a row to the portal vendoring table
 * (`changing-the-engine.md` §4), which is not worth it for fifteen lines.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, resolveBuses } = require('./cli');

const args = parseArgs(process.argv.slice(2));
const BUSES = resolveBuses(args);
if (!args.town || !args.route) {
  console.error('usage: node pick_route_colour.js --town "<Town>" --route <key> [--pool "#hex,#hex,…"] [--buses <dir>]');
  process.exit(2);
}
const dir = path.join(BUSES, 'Areas', String(args.town), 'ci-reference');
const rjPath = path.join(dir, 'routes.json');
if (!fs.existsSync(rjPath)) { console.error('no ci-reference routes.json for ' + args.town + ' at ' + dir); process.exit(2); }
const RJ = JSON.parse(fs.readFileSync(rjPath, 'utf8'));
const route = String(args.route);
if (!RJ.palette || !(route in RJ.palette)) { console.error('route ' + route + ' is not in ' + args.town + "'s palette"); process.exit(2); }

// --- CIE76 over sRGB->Lab -----------------------------------------------------
// The conversion is wcag.js's lab(): it WAS "the same maths as gen_internal.js's
// §5.2 check", written out again here and a third time in quality_metrics.js, and
// a comment saying so is not the same as sharing it (OA-135).
const { lab } = require('./wcag.js');
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

// --- what else is on this sheet ----------------------------------------------
// Drawn water first: a river with no geometry cannot clash with anything.
const WATER_DEFAULT = { river: '#9ec9e8', canal: '#7fb0d8' };
let geo = {}; try { geo = JSON.parse(fs.readFileSync(path.join(dir, 'features_geo.json'), 'utf8')); } catch (e) {}
let water = (RJ.features || [])
  .filter(f => (f.type === 'river' || f.type === 'canal') && (geo[f.key] || []).length)
  .map(f => ({ name: f.key, colour: (f.style && f.style.stroke) || WATER_DEFAULT[f.type] }));
// A town with no `features[]` still draws a river: `gen_internal.js` falls back to
// river_geo.json and builds a single river feature itself (March, St Ives). Miss
// this and the tool cheerfully offers a hue that is the river — the engine's own
// §5.2 check does not have the hole, because it reads the built FEATURES list.
if (!water.length) {
  let legacy = []; try { legacy = JSON.parse(fs.readFileSync(path.join(dir, 'river_geo.json'), 'utf8')); } catch (e) {}
  if (legacy.length) water = [{ name: 'river (legacy fallback)', colour: WATER_DEFAULT.river }];
}
// Every other route the sheet draws, deduplicated by colour (a bundled family or a
// corridorPalette group is ONE colour on the page, however many keys wear it).
const drawn = (RJ.routeOrder || Object.keys(RJ.palette)).filter(r => r !== route && RJ.palette[r]);
const others = drawn.map(r => ({ name: r, colour: RJ.palette[r] })).concat(water);

const POOL = (typeof args.pool === 'string' ? args.pool.split(',') : [
  // the documented colour-blind-safe palettes (SKILL.md) plus the Tol-vibrant
  // extras the eight towns actually use
  '#4477AA', '#66CCEE', '#228833', '#CCBB44', '#EE6677', '#AA3377', '#BBBBBB',
  '#332288', '#117733', '#44AA99', '#009988', '#88CCEE', '#DDCC77', '#CC6677',
  '#AA4499', '#882255', '#CC3311', '#EE3377', '#999933', '#EE7733', '#BB5566',
  '#004488', '#0072B2', '#56B4E9', '#009E73', '#E69F00', '#D55E00', '#CC79A7'
]).map(c => c.trim().toUpperCase());

const worstFor = c => others.reduce((acc, o) => {
  const d = dE(c, o.colour); return d < acc.d ? { d, with: o.name + ' ' + o.colour } : acc;
}, { d: Infinity, with: null });

const now = RJ.palette[route], nowWorst = worstFor(now);
console.log(`${args.town} route ${route} is ${now}; its worst separation on this sheet is `
  + `dE ${nowWorst.d.toFixed(1)} against ${nowWorst.with}`);
console.log(`  measured against ${drawn.length} other route colour(s)`
  + (water.length ? ` and ${water.length} drawn watercourse(s): ${water.map(w => w.name + ' ' + w.colour).join(', ')}` : ' (no drawn watercourse)'));
console.log('\ncandidates, best worst-case first:');
const used = new Set(others.map(o => o.colour.toUpperCase()));
POOL.filter(c => !used.has(c) && c !== now.toUpperCase())
  .map(c => ({ c, w: worstFor(c) }))
  .sort((a, b) => b.w.d - a.w.d)
  .slice(0, +(args.top || 8))
  .forEach(x => console.log(`  ${x.c}  worst dE ${x.w.d.toFixed(1)}  vs ${x.w.with}`));
console.log('\nTake the largest worst-case, set textOn to #fff on a dark fill and #111 on a light one,'
  + '\nthen RENDER IT: a hue can be numerically distant and still run alongside the line it must be'
  + '\ntold apart from (Ramsey X31 vs the green 303, 2026-08-16).');
