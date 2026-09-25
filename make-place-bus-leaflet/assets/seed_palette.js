// P3 helper — give a NEW place map its parent town's route colours.
//
// WHY THIS EXISTS (buses-data OA-082)
// Each map allocates its palette at S3, in its own route order, so one bus could
// wear a different colour on every sheet in the same town. Measured 2026-09-24 from
// the committed ci-reference/routes.json of each: St Ives Bus Station agreed with
// St Ives on 0 of 8 shared routes, and St Neots' three place sheets on 3 of 10. The
// consistency that did exist had been copied by hand. Peter ruled on 2026-09-25:
// seed a NEW place map from its town, and repaint nothing already built — the five
// delivered place sheets are aligned at their own next refresh, by running this then.
//
// WHAT IT DOES, in order, to the routes.json in --dir (the place's S3 folder):
//   1. a route the town also draws takes the town's colour and the town's textOn;
//   2. a route the town does not draw, but which wore the SAME colour as one that it
//      does (a variant family — St Ives Bus Station's 301S wears 301's colour), follows
//      that route to its new colour, so a family stays one colour;
//   3. any other route keeps its colour — unless that colour is now too close to one
//      the town just supplied, in which case it is given the unused pool colour whose
//      worst separation from everything else on the sheet is largest;
//   4. titleColor, where it was taken from a route's colour, follows that route.
// Nothing else in routes.json is touched.
//
// WHERE THE TOWN'S COLOURS COME FROM. The town's ci-reference/routes.json — the
// colours on the sheet that ships, which are the ones a reader will compare against —
// and, where a town has none yet, its manifest's latest S3. The source is printed.
// The parent town is found from the folder: a place lives at
// Areas/<Town>/Places/<Place>/, so the town is the folder above `Places`. A place
// under Places/_standalone/ has no parent town and nothing to seed; that is exit 0.
//
// Usage — from the P3 stage folder that holds routes.json:
//   node seed_palette.js [--dir <S3 folder>] [--town-routes <town routes.json>] [--apply] [--json]
// Reports by default and writes only with --apply (references/conventions.md). Run it
// after the palette is assembled and BEFORE the gen_internal PALETTE WARNING check:
// a colour the town chose to avoid its own river is not thereby clear of this sheet's.
'use strict';
const fs = require('fs');
const path = require('path');
const { dep, cli } = require('./place_engine.js');
const { lab, relLum } = require(dep('wcag.js'));

/* A route the town does not draw keeps its own colour unless a seeded one lands
 * within this CIE76 distance of it. 10 is below every separation pick_route_colour.js
 * has recommended on a shipped sheet, and far above an exact repeat (0), which is
 * the case that matters most: the hand-assembled palette and the town's are drawn
 * from the same Tol sets, so a clash is usually the SAME hex on two routes. */
const CLASH_DE = 10;

/* The pool a displaced route is re-coloured from: Tol Bright first, the skill's
 * documented default, then the wider set pick_route_colour.js offers. */
const POOL = [
  '#4477AA', '#66CCEE', '#228833', '#CCBB44', '#EE6677', '#AA3377', '#BBBBBB',
  '#332288', '#117733', '#44AA99', '#009988', '#88CCEE', '#DDCC77', '#CC6677',
  '#AA4499', '#882255', '#CC3311', '#EE3377', '#999933', '#EE7733', '#BB5566',
  '#004488', '#0072B2', '#56B4E9', '#009E73', '#E69F00', '#D55E00', '#CC79A7',
];

const up = (c) => String(c || '').toUpperCase();
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** The text colour a badge of this fill needs: whichever of #fff and #111 reads better. */
const textFor = (fill) => (contrast(fill, '#ffffff') >= contrast(fill, '#111111') ? '#fff' : '#111');

/**
 * seedPalette(place, town) -> { palette, textOn, titleColor, changes }
 * Pure: reads two routes.json objects and returns the place's new colour keys and one
 * change row per route whose colour or text colour moved. Nothing is written.
 */
function seedPalette(place, town) {
  const P = place.palette || {}, PT = place.textOn || {};
  const T = town.palette || {}, TT = town.textOn || {};
  const order = [...new Set([...(place.routeOrder || []), ...Object.keys(P)])].filter((k) => k in P);
  const palette = {}, textOn = {}, why = {};

  // 1. shared routes take the town's colour
  for (const k of order) if (k in T) { palette[k] = T[k]; textOn[k] = TT[k] || textFor(T[k]); why[k] = 'town'; }

  // 2. a variant family follows its member the town draws
  for (const k of order) {
    if (k in palette) continue;
    const lead = order.find((s) => s in T && up(P[s]) === up(P[k]));
    if (lead) { palette[k] = palette[lead]; textOn[k] = textOn[lead]; why[k] = 'follows ' + lead; }
  }

  // 3. everything else keeps its colour unless the town's now crowds it
  for (const k of order) {
    if (k in palette) continue;
    const others = Object.entries(palette).filter(([r]) => r !== k);
    const near = others.map(([r, c]) => ({ r, d: dE(P[k], c) })).sort((a, b) => a.d - b.d)[0];
    if (!near || near.d >= CLASH_DE) {
      palette[k] = P[k]; textOn[k] = PT[k] || textFor(P[k]); why[k] = 'kept'; continue;
    }
    // Every colour still to be placed counts as taken too, so two displaced routes
    // cannot be handed the same answer.
    const used = new Set(Object.values(palette).map(up).concat(order.filter((r) => !(r in palette) && r !== k).map((r) => up(P[r]))));
    const against = [...used];
    const best = POOL.filter((c) => !used.has(c))
      .map((c) => ({ c, w: Math.min(...against.map((o) => dE(c, o))) }))
      .sort((a, b) => b.w - a.w)[0];
    if (!best) { palette[k] = P[k]; textOn[k] = PT[k] || textFor(P[k]); why[k] = 'kept (pool exhausted)'; continue; }
    palette[k] = best.c; textOn[k] = textFor(best.c);
    why[k] = `re-coloured: was dE ${near.d.toFixed(1)} from ${near.r}`;
  }

  // 4. titleColor follows the route it was taken from, first in route order
  let titleColor = place.titleColor;
  if (titleColor) {
    const src = order.find((k) => up(P[k]) === up(titleColor));
    if (src) titleColor = palette[src];
  }

  const changes = order
    .filter((k) => up(P[k]) !== up(palette[k]) || up(PT[k]) !== up(textOn[k]))
    .map((k) => ({ route: k, from: P[k], to: palette[k], textFrom: PT[k] || null, textTo: textOn[k], why: why[k] }));
  const unchanged = order.filter((k) => !changes.some((c) => c.route === k)).map((k) => ({ route: k, colour: palette[k], why: why[k] }));
  return { palette, textOn, titleColor, changes, unchanged };
}

/** The parent town's folder for a place folder, or null for a standalone place. */
function parentTownDir(dir) {
  let d = path.resolve(dir);
  for (;;) {
    const up1 = path.dirname(d);
    if (up1 === d) return null;
    if (path.basename(d) === 'Places') {
      const town = path.dirname(d);
      return fs.existsSync(path.join(town, 'manifest.json')) ? town : null;
    }
    d = up1;
  }
}

/** The town's routes.json: ci-reference first, then the manifest's latest S3. */
function townRoutesPath(townDir) {
  const ci = path.join(townDir, 'ci-reference', 'routes.json');
  if (fs.existsSync(ci)) return { path: ci, from: 'ci-reference' };
  const m = cli.readJson(path.join(townDir, 'manifest.json'), null);
  const s = m && m.stages && m.stages.S3;
  const r = s && (s.runs || []).find((x) => x.id === s.latest);
  if (r) {
    const p = path.join(townDir, r.dir, 'routes.json');
    if (fs.existsSync(p)) return { path: p, from: 'S3 ' + r.id };
  }
  return null;
}

function main() {
  const args = cli.parseArgs(process.argv.slice(2));
  const DIR = path.resolve(typeof args.dir === 'string' ? args.dir : '.');
  const rjPath = path.join(DIR, 'routes.json');
  if (!fs.existsSync(rjPath)) cli.die('seed_palette: no routes.json in ' + DIR);
  const RJ = JSON.parse(fs.readFileSync(rjPath, 'utf8'));
  if (!RJ.palette || !Object.keys(RJ.palette).length) cli.die('seed_palette: routes.json has no palette to seed');

  let src;
  if (typeof args['town-routes'] === 'string') {
    src = { path: path.resolve(args['town-routes']), from: 'given' };
    if (!fs.existsSync(src.path)) cli.die('seed_palette: no file at ' + src.path);
  } else {
    const townDir = parentTownDir(DIR);
    if (!townDir) {
      console.log('seed_palette: this place has no parent town (it is not under Areas/<Town>/Places/) — nothing to seed.');
      return;
    }
    src = townRoutesPath(townDir);
    if (!src) cli.die('seed_palette: ' + path.basename(townDir) + ' has neither ci-reference/routes.json nor a committed S3 — nothing to seed from', 1);
  }
  const TOWN = JSON.parse(fs.readFileSync(src.path, 'utf8'));
  const out = seedPalette(RJ, TOWN);

  if (args.json) {
    console.log(JSON.stringify({ source: src, changes: out.changes, unchanged: out.unchanged, titleColor: out.titleColor }, null, 2));
  } else {
    const townName = TOWN.town || path.basename(path.dirname(path.dirname(src.path)));
    console.log(`seed_palette: town colours from ${townName} (${src.from}: ${src.path})`);
    for (const c of out.changes) console.log(`  ${c.route.padEnd(6)} ${c.from} -> ${c.to}  text ${c.textFrom || '-'} -> ${c.textTo}  (${c.why})`);
    for (const u of out.unchanged) console.log(`  ${u.route.padEnd(6)} ${u.colour}  unchanged  (${u.why})`);
    if (out.titleColor !== RJ.titleColor) console.log(`  titleColor ${RJ.titleColor} -> ${out.titleColor}`);
    console.log(`${out.changes.length} route(s) to change` + (args.apply ? ', written.' : ' — report only; --apply writes routes.json.'));
  }
  if (args.apply && (out.changes.length || out.titleColor !== RJ.titleColor)) {
    RJ.palette = out.palette; RJ.textOn = out.textOn;
    if (RJ.titleColor !== undefined) RJ.titleColor = out.titleColor;
    fs.writeFileSync(rjPath, JSON.stringify(RJ, null, 2) + '\n');
  }
}

if (require.main === module) main();
module.exports = { seedPalette, parentTownDir, townRoutesPath, textFor, CLASH_DE };
