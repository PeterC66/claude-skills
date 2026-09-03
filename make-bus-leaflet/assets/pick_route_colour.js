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
 *   node pick_route_colour.js --town "High Wycombe" --route 20 --stage
 *
 * THE RULE IT ENCODES: score every candidate against EVERY OTHER COLOUR ON THE
 * SHEET **plus the water**, and take the one whose WORST separation is largest —
 * not the one that is furthest from the colour you are replacing. A hue can be
 * numerically far from the river and still land next to the route it now has to
 * be told apart from. Ramsey is exactly that case: teal scored 39.1 and its worst
 * neighbour was the green 303, which X31 runs beside for the length of Wood Lane,
 * so indigo (49.3) was the right answer. **Then render it and look.**
 *
 * WHERE THE INPUTS COME FROM, AND WHY THERE IS NOW A CHOICE (OA-226). This read
 * `Areas/<Town>/ci-reference/` and nothing else, and `ci-reference` is the golden
 * mirror of the latest COMMITTED S4 — so the tool refused the question for any
 * route the sheet does not already draw, which is precisely the moment a hue has
 * to be chosen at all. Asked for route 20 on High Wycombe on 2026-09-01 it exited
 * 2 with "route 20 is not in High Wycombe's palette". The workaround on the day
 * was a scratch tree holding two files copied out of the uncommitted S3 and S2,
 * pointed at with `--buses`; that works, and a tool whose documented usage cannot
 * answer its own headline question gets reached for once and then not again.
 *
 * So the source is now a flag, and the DEFAULT IS UNCHANGED. `ci-reference` stays
 * the default because scoring against the artwork that actually ships is a good
 * reason, not an accident, and `test/pick_route_colour.test.js` holds a control on
 * it. `--stage` resolves the same files from the manifest's current S3 (config)
 * and S2 (geometry) instead, which is the pair a build in progress has;
 * `--routes-json` and `--features-geo` name them outright.
 *
 * AND A ROUTE THAT IS NOT IN THE PALETTE IS NOW A QUESTION, NOT AN ERROR. It is
 * scored as a new route with no current colour, which is what "what colour should
 * this route be" means when the answer is not already on the page.
 *
 * ADJACENCY, WHICH THE NUMBERS ALONE CANNOT SEE. The closing advice used to be
 * that a hue can be numerically distant and still run alongside the line it must
 * be told apart from — true, and there is a cheap measurement for it this tool was
 * not making: shared road EDGES in `routes_paths.json`. Route 20 runs beside 36
 * for 49% of its drawn line, 850 for 33%, and 34, 33 and 32/32A for 12% each;
 * everything else it never touches. The ranking is deliberately NOT changed by
 * this — it stays the conservative worst-case over every colour on the sheet — but
 * each candidate now also carries its worst separation among the routes it is
 * actually drawn next to, and where the two disagree the tool says so instead of
 * hiding it behind a flag nobody turns on.
 *
 * Read-only: prints a table, writes nothing. Zero dependencies (Node core only).
 * The Lab maths is wcag.js's lab() — see OA-135.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, resolveBuses } = require('./cli');

const args = parseArgs(process.argv.slice(2));
const BUSES = resolveBuses(args);
if (!args.town || !args.route) {
  console.error('usage: node pick_route_colour.js --town "<Town>" --route <key> [--pool "#hex,#hex,…"]');
  console.error('       [--stage] [--routes-json <path>] [--features-geo <path>] [--routes-paths <path>] [--buses <dir>]');
  console.error('  default sources are Areas/<Town>/ci-reference/ — the latest COMMITTED sheet.');
  console.error('  --stage reads the manifest\'s current S3 (routes.json) and S2 (geometry) instead,');
  console.error('  which is what a build in progress has and ci-reference does not.');
  process.exit(2);
}
const TOWN = String(args.town);
const townDir = path.join(BUSES, 'Areas', TOWN);
const ciRef = path.join(townDir, 'ci-reference');

/* Resolve one input, most specific first: an explicit path, then --stage's run
 * folder, then ci-reference. Each returns the path AND where it came from, because
 * the one thing worse than reading the wrong file is not saying which file. */
function stageDir(stage) {
  const mf = path.join(townDir, 'manifest.json');
  if (!fs.existsSync(mf)) return null;
  let m; try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { return null; }
  const s = m.stages && m.stages[stage];
  if (!s || !s.latest) return null;
  const r = (s.runs || []).find((x) => x.id === s.latest);
  return r ? { dir: path.join(townDir, r.dir), id: r.id } : null;
}
const S3 = args.stage ? stageDir('S3') : null;
const S2 = args.stage ? stageDir('S2') : null;
if (args.stage && !S3) { console.error(`--stage: no committed S3 run in ${TOWN}'s manifest`); process.exit(2); }

function source(explicit, staged, name) {
  if (typeof explicit === 'string') return { path: path.resolve(explicit), from: 'given' };
  if (staged) return { path: path.join(staged.dir, name), from: `${args.stage ? (staged === S3 ? 'S3' : 'S2') : ''} ${staged.id}`.trim() };
  return { path: path.join(ciRef, name), from: 'ci-reference' };
}
const SRC = {
  routes: source(args['routes-json'], S3, 'routes.json'),
  geo: source(args['features-geo'], S2, 'features_geo.json'),
  paths: source(args['routes-paths'], S2, 'routes_paths.json'),
  river: source(null, S2, 'river_geo.json'),
};

if (!fs.existsSync(SRC.routes.path)) {
  console.error(`no routes.json at ${SRC.routes.path}`);
  if (!args.stage && !args['routes-json'])
    console.error('  ci-reference mirrors the latest COMMITTED S4. For a route that is not shipped yet, add --stage.');
  process.exit(2);
}
const RJ = JSON.parse(fs.readFileSync(SRC.routes.path, 'utf8'));
const route = String(args.route);
const PALETTE = RJ.palette || {};
/* A route with no colour yet is the case this tool exists for, and it used to be
 * the case it refused. It is reported loudly rather than silently accepted: a typo
 * in --route lands here too, and the operator has to be able to tell them apart. */
const isNew = !(route in PALETTE);

// --- CIE76 over sRGB->Lab -----------------------------------------------------
const { lab } = require('./wcag.js');
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

// --- what else is on this sheet ----------------------------------------------
// Drawn water first: a river with no geometry cannot clash with anything.
const WATER_DEFAULT = { river: '#9ec9e8', canal: '#7fb0d8' };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const geo = readJson(SRC.geo.path) || {};
let water = (RJ.features || [])
  .filter((f) => (f.type === 'river' || f.type === 'canal') && (geo[f.key] || []).length)
  .map((f) => ({ name: f.key, colour: (f.style && f.style.stroke) || WATER_DEFAULT[f.type] }));
// A town with no `features[]` still draws a river: `gen_internal.js` falls back to
// river_geo.json and builds a single river feature itself (March, St Ives). Miss
// this and the tool cheerfully offers a hue that is the river — the engine's own
// §5.2 check does not have the hole, because it reads the built FEATURES list.
if (!water.length) {
  const legacy = readJson(SRC.river.path) || [];
  if (legacy.length) water = [{ name: 'river (legacy fallback)', colour: WATER_DEFAULT.river }];
}
// Every other route the sheet draws, deduplicated by colour (a bundled family or a
// corridorPalette group is ONE colour on the page, however many keys wear it).
const drawn = (RJ.routeOrder || Object.keys(PALETTE)).filter((r) => r !== route && PALETTE[r]);
const others = drawn.map((r) => ({ name: r, colour: PALETTE[r] })).concat(water);

/* --- which of those the route is actually DRAWN BESIDE -----------------------
 * A shared road edge is the cheapest honest proxy for "runs alongside": both lines
 * are laid on the same stretch of the same way, so they are separated on the page
 * by a lane offset and nothing else. Direction is normalised — a route running the
 * other way down a street shares the street. The fraction is of THIS route's own
 * edges, which is what makes "49% of its drawn line" a sentence about route 20. */
const edgeKey = (e) => { const [a, b] = String(e).split('>'); return a < b ? a + '|' + b : b + '|' + a; };
const RP = readJson(SRC.paths.path);
const neighbours = new Map();          // route key -> fraction of THIS route's edges shared
if (RP && RP.routes && RP.routes[route] && Array.isArray(RP.routes[route].edges)) {
  const mine = new Set(RP.routes[route].edges.map(edgeKey));
  if (mine.size) {
    for (const [k, v] of Object.entries(RP.routes)) {
      if (k === route || !Array.isArray(v.edges)) continue;
      const theirs = new Set(v.edges.map(edgeKey));
      let shared = 0;
      for (const e of mine) if (theirs.has(e)) shared++;
      if (shared) neighbours.set(k, shared / mine.size);
    }
  }
}
/* The neighbour set for scoring: the routes it is drawn beside, PLUS the water,
 * which is adjacent to everything it runs along and is the clash that started this
 * tool. A route with no geometry on disk has no neighbour set and gets no column. */
const adjacent = neighbours.size
  ? drawn.filter((r) => neighbours.has(r)).map((r) => ({ name: r, colour: PALETTE[r] })).concat(water)
  : null;

const POOL = (typeof args.pool === 'string' ? args.pool.split(',') : [
  // the documented colour-blind-safe palettes (SKILL.md) plus the Tol-vibrant
  // extras the eight towns actually use
  '#4477AA', '#66CCEE', '#228833', '#CCBB44', '#EE6677', '#AA3377', '#BBBBBB',
  '#332288', '#117733', '#44AA99', '#009988', '#88CCEE', '#DDCC77', '#CC6677',
  '#AA4499', '#882255', '#CC3311', '#EE3377', '#999933', '#EE7733', '#BB5566',
  '#004488', '#0072B2', '#56B4E9', '#009E73', '#E69F00', '#D55E00', '#CC79A7',
]).map((c) => c.trim().toUpperCase());

const worstIn = (set) => (c) => set.reduce((acc, o) => {
  const d = dE(c, o.colour); return d < acc.d ? { d, with: o.name + ' ' + o.colour } : acc;
}, { d: Infinity, with: null });
const worstFor = worstIn(others);
const worstNear = adjacent && adjacent.length ? worstIn(adjacent) : null;

// --- report -------------------------------------------------------------------
console.log(`sources: routes.json ${SRC.routes.from} · geometry ${SRC.geo.from}`
  + (RP ? ` · adjacency ${SRC.paths.from}` : ' · adjacency none on disk'));
if (isNew) {
  console.log(`${TOWN} route ${route} has NO colour in this palette — scoring it as a NEW route.`);
  console.log(`  (if that is a surprise, check the key: this sheet draws ${drawn.join(', ')})`);
} else {
  const now = PALETTE[route], nowWorst = worstFor(now);
  console.log(`${TOWN} route ${route} is ${now}; its worst separation on this sheet is `
    + `dE ${nowWorst.d.toFixed(1)} against ${nowWorst.with}`);
}
console.log(`  measured against ${drawn.length} other route colour(s)`
  + (water.length ? ` and ${water.length} drawn watercourse(s): ${water.map((w) => w.name + ' ' + w.colour).join(', ')}` : ' (no drawn watercourse)'));
if (neighbours.size) {
  const rank = [...neighbours.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  drawn BESIDE ${rank.length} of them, by shared road edge: `
    + rank.map(([k, f]) => `${k} ${Math.round(f * 100)}%`).join(', '));
} else if (RP) {
  console.log('  no shared road edges with any other route on this sheet (or it has no geometry yet)');
}

const used = new Set(others.map((o) => o.colour.toUpperCase()));
const now = isNew ? null : PALETTE[route].toUpperCase();
const ranked = POOL.filter((c) => !used.has(c) && c !== now)
  .map((c) => ({ c, w: worstFor(c), n: worstNear ? worstNear(c) : null }))
  .sort((a, b) => b.w.d - a.w.d);

console.log('\ncandidates, best worst-case first:');
ranked.slice(0, +(args.top || 8)).forEach((x) => console.log(
  `  ${x.c}  worst dE ${x.w.d.toFixed(1)}  vs ${x.w.with}`
  + (x.n ? `   | beside it: dE ${x.n.d.toFixed(1)} vs ${x.n.with}` : '')));

/* Where the two orderings disagree, SAY SO. The whole point of the adjacency
 * column is that the flat worst-case treats a route on the far side of the town as
 * an equal constraint; if the best hue among the lines this one is actually drawn
 * next to is not the top of the list, that is the sentence the operator needs, and
 * burying it behind a flag is how a measurement gets built and never used. */
if (worstNear && ranked.length) {
  const byNear = [...ranked].sort((a, b) => b.n.d - a.n.d)[0];
  if (byNear.c !== ranked[0].c) console.log(
    `\nNote: ranked against only the routes it is drawn BESIDE, the best is ${byNear.c} `
    + `(dE ${byNear.n.d.toFixed(1)}), not ${ranked[0].c} (dE ${ranked[0].n.d.toFixed(1)} beside it). `
    + `The list above is the conservative answer — far from everything on the sheet. Look at both.`);
}
console.log('\nTake the largest worst-case, set textOn to #fff on a dark fill and #111 on a light one,'
  + '\nthen RENDER IT: adjacency by shared edge is a proxy, and two lines can crowd each other'
  + '\nat a junction they do not share (Ramsey X31 vs the green 303, 2026-08-16).');
