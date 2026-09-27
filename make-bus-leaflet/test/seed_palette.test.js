/*
 * seed_palette.test.js — a new place map takes its parent town's route colours
 * (buses-data OA-082, Peter's ruling of 2026-09-25).
 *
 * The fixture is St Ives Bus Station against St Ives as both stood in their
 * committed ci-reference on 2026-09-25, cut to the keys that matter: the two sheets
 * agreed on 0 of 8 shared routes, and 301S wears 301's colour as a variant family.
 * Every case is stated as the sheet a reader would see, because "the palette
 * changed" is not the property — "the 9 is the same colour on both sheets" is.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');
const { load } = require('./_engine');

const SCRIPT = process.env.SEED_PALETTE_JS ||
  path.join(__dirname, '..', '..', 'make-place-bus-leaflet', 'assets', 'seed_palette.js');
const { seedPalette, parentTownDir, CLASH_DE } = require(SCRIPT);

const TOWN = {
  town: 'St Ives',
  palette: { 9: '#009988', 69: '#EE7733', 300: '#228833', 301: '#EE6677', 302: '#CCBB44', A: '#AA3377', B: '#4477AA', VL14: '#E69F00', '5A': '#1A3A8F' },
  textOn: { 9: '#fff', 69: '#111', 300: '#fff', 301: '#fff', 302: '#111', A: '#fff', B: '#fff', VL14: '#111', '5A': '#fff' },
};
const PLACE = () => ({
  place: 'St Ives Bus Station',
  titleColor: '#4477AA',
  palette: { 9: '#CCBB44', 69: '#EE6677', 300: '#EE7733', 301: '#882255', 302: '#009988', A: '#4477AA', B: '#66CCEE', '5A': '#228833', '301S': '#882255' },
  textOn: { 9: '#111', 69: '#fff', 300: '#111', 301: '#fff', 302: '#fff', A: '#fff', B: '#111', '5A': '#fff', '301S': '#fff' },
  routeOrder: ['A', 'B', '5A', '9', '69', '300', '301', '301S', '302'],
});

test('every route the town also draws wears the town\'s colour and text colour', () => {
  const out = seedPalette(PLACE(), TOWN);
  for (const r of ['A', 'B', '5A', '9', '69', '300', '301', '302']) {
    assert.strictEqual(out.palette[r], TOWN.palette[r], `route ${r}`);
    assert.strictEqual(out.textOn[r], TOWN.textOn[r], `route ${r} text`);
  }
});

test('a variant family stays one colour: 301S follows 301', () => {
  const out = seedPalette(PLACE(), TOWN);
  assert.strictEqual(out.palette['301S'], out.palette['301']);
  assert.match(out.changes.find((c) => c.route === '301S').why, /follows 301/);
});

test('titleColor follows the route it was taken from', () => {
  // #4477AA was A's colour on the place sheet; A is now the town's #AA3377.
  assert.strictEqual(seedPalette(PLACE(), TOWN).titleColor, '#AA3377');
});

test('a route the town does not draw keeps its colour when nothing crowds it', () => {
  const p = PLACE();
  p.palette.W9 = '#CC6677'; p.textOn.W9 = '#fff'; p.routeOrder.push('W9');
  const out = seedPalette(p, TOWN);
  assert.strictEqual(out.palette.W9, '#CC6677');
  assert.ok(!out.changes.some((c) => c.route === 'W9'), 'an uncrowded route is not a change');
});

test('a route the town does not draw is RE-COLOURED when the town\'s colours land on it', () => {
  // X wears #AA3377 on the place sheet, which no other place route wears (so it is
  // not a family) and which is the town's colour for the A. A fixture that gave X
  // a colour another place route wears would test the family rule instead.
  const p = PLACE();
  p.palette.X = '#AA3377'; p.textOn.X = '#fff'; p.routeOrder.push('X');
  const out = seedPalette(p, TOWN);
  assert.notStrictEqual(out.palette.X.toUpperCase(), '#AA3377');
  const all = Object.entries(out.palette).filter(([r]) => r !== 'X' && r !== '301S');
  const { lab } = load('wcag.js');
  const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
  for (const [r, c] of all) assert.ok(dE(out.palette.X, c) >= CLASH_DE, `X's new colour is within ${CLASH_DE} of ${r}`);
  assert.match(out.changes.find((c) => c.route === 'X').why, /re-coloured/);
});

test('seeding is idempotent: a seeded palette seeds to itself', () => {
  const p = PLACE();
  const once = seedPalette(p, TOWN);
  Object.assign(p, { palette: once.palette, textOn: once.textOn, titleColor: once.titleColor });
  assert.deepStrictEqual(seedPalette(p, TOWN).changes, []);
});

test('the parent town is the folder above Places, and a standalone place has none', () => {
  const root = scratchDir('seed-palette-tree-');
  const town = path.join(root, 'Areas', 'Fixton');
  const placeS3 = path.join(town, 'Places', 'Fixton Co-op', 'S3-config', 'run1');
  const alone = path.join(root, 'Places', '_standalone', 'Lone Co-op', 'S3-config', 'run1');
  fs.mkdirSync(placeS3, { recursive: true });
  fs.mkdirSync(alone, { recursive: true });
  fs.writeFileSync(path.join(town, 'manifest.json'), '{}');
  assert.strictEqual(parentTownDir(placeS3), town);
  assert.strictEqual(parentTownDir(alone), null);
});

function tree() {
  const root = scratchDir('seed-palette-run-');
  const town = path.join(root, 'Areas', 'St Ives');
  const dir = path.join(town, 'Places', 'St Ives Bus Station', 'S3-config', 'run1');
  fs.mkdirSync(path.join(town, 'ci-reference'), { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(town, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(town, 'ci-reference', 'routes.json'), JSON.stringify(TOWN));
  const before = JSON.stringify(PLACE(), null, 2) + '\n';
  fs.writeFileSync(path.join(dir, 'routes.json'), before);
  return { dir, before };
}
const run = (dir, argv) => spawnSync(process.execPath, [SCRIPT, '--dir', dir].concat(argv || []), { encoding: 'utf8' });

test('by default it REPORTS and writes nothing', () => {
  const { dir, before } = tree();
  const r = run(dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /9 route\(s\) to change/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'), before);
});

test('--apply writes the seeded colours and leaves every other key alone', () => {
  const { dir } = tree();
  const r = run(dir, ['--apply']);
  assert.strictEqual(r.status, 0, r.stderr);
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
  assert.strictEqual(after.palette['9'], '#009988');
  assert.strictEqual(after.titleColor, '#AA3377');
  assert.deepStrictEqual(after.routeOrder, PLACE().routeOrder);
  assert.strictEqual(after.place, 'St Ives Bus Station');
  assert.match(run(dir).stdout, /0 route\(s\) to change/);
});
