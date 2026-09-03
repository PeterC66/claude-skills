/*
 * pick_route_colour.js — where it reads its inputs from, and what it does with a
 * route the sheet does not draw yet (OA-226).
 *
 * The tool exists to answer "what colour should this route be", and it refused the
 * question for any route not already in the palette — which is precisely the moment
 * a hue has to be chosen. It resolved `Areas/<Town>/ci-reference/`, the golden
 * mirror of the latest COMMITTED S4, and exited 2.
 *
 * THE FIRST TEST IS THE CONTROL THE ROW ASKED FOR AND IT MUST STAY GREEN: the
 * DEFAULT still reads ci-reference. The reason it reads the golden master — scoring
 * against the artwork that actually ships — is a good one, and a fix that quietly
 * moved the default to whatever is half-built in a run folder would lose it.
 *
 * These spawn the real script rather than requiring it, because where a file is
 * read from is exactly the behaviour under test and a stubbed fs would assume the
 * answer.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine');
const { scratchDir } = require(path.join(ENGINE_DIR, 'scratch.js'));

const SCRIPT = path.join(ENGINE_DIR, 'pick_route_colour.js');

/* A minimal estate: one town, whose ci-reference and whose current S3/S2 disagree
 * about the palette on purpose, so every test below can tell which was read. */
function fixture() {
  const root = scratchDir('pick-colour-');
  const town = path.join(root, 'Areas', 'Testbury');
  const ci = path.join(town, 'ci-reference');
  const s3 = path.join(town, 'S3-config', '2026-09-03_1200');
  const s2 = path.join(town, 'S2-geometry', '2026-09-03_1100');
  for (const d of [ci, s3, s2]) fs.mkdirSync(d, { recursive: true });

  // ci-reference: the SHIPPED sheet. Route 7 is not on it.
  fs.writeFileSync(path.join(ci, 'routes.json'), JSON.stringify({
    routeOrder: ['1', '2'],
    palette: { 1: '#CE1111', 2: '#11CE11' },
  }));
  fs.writeFileSync(path.join(ci, 'features_geo.json'), JSON.stringify({}));

  // S3: the build in progress. Route 7 has been added, and route 2 recoloured, so
  // a run that reads this one cannot be mistaken for a run that read ci-reference.
  fs.writeFileSync(path.join(s3, 'routes.json'), JSON.stringify({
    routeOrder: ['1', '2', '7'],
    palette: { 1: '#CE1111', 2: '#1111CE', 7: '#888888' },
  }));
  fs.writeFileSync(path.join(s2, 'features_geo.json'), JSON.stringify({}));
  /* Adjacency: route 7 shares two of its four edges with route 1 and one with
   * route 2, and route 2's shared edge is written the other way round — a route
   * running the other way down a street still shares the street. */
  fs.writeFileSync(path.join(s2, 'routes_paths.json'), JSON.stringify({
    routes: {
      1: { edges: ['a>b', 'b>c', 'z>y'] },
      2: { edges: ['d>c', 'q>r'] },
      7: { edges: ['a>b', 'b>c', 'c>d', 'm>n'] },
    },
    edgeWay: {},
  }));

  fs.writeFileSync(path.join(town, 'manifest.json'), JSON.stringify({
    town: 'Testbury',
    stages: {
      S2: { latest: '2026-09-03_1100', runs: [{ id: '2026-09-03_1100', dir: 'S2-geometry/2026-09-03_1100' }] },
      S3: { latest: '2026-09-03_1200', runs: [{ id: '2026-09-03_1200', dir: 'S3-config/2026-09-03_1200' }] },
    },
  }));
  return { root, s3, ci };
}

const run = (root, ...extra) => spawnSync(process.execPath,
  [SCRIPT, '--town', 'Testbury', '--buses', root, ...extra], { encoding: 'utf8' });

test('CONTROL: with no flags it still reads ci-reference — the artwork that ships', () => {
  const { root } = fixture();
  const r = run(root, '--route', '2');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /sources: routes\.json ci-reference/);
  // ci-reference says route 2 is green; the S3 next door says blue. Naming the
  // green is the only evidence that says WHICH file was opened.
  assert.match(r.stdout, /route 2 is #11CE11/);
  assert.doesNotMatch(r.stdout, /#1111CE/);
});

test('CONTROL: a route absent from ci-reference still names ci-reference as the source', () => {
  /* The fix must not turn "not shipped yet" into a silent fallback to a run folder.
   * The tool says what it read and reports the route as new; it does not go looking. */
  const { root } = fixture();
  const r = run(root, '--route', '7');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /sources: routes\.json ci-reference/);
  assert.match(r.stdout, /route 7 has NO colour in this palette/);
});

test('a route the sheet does not draw is scored as NEW, not refused', () => {
  /* This is the headline. Before OA-226 it exited 2 with "route 7 is not in
   * Testbury's palette" — the one case anybody needs the tool for. */
  const { root } = fixture();
  // Route 9 is in neither the shipped palette nor the staged one, so this is the
  // real case: a hue being chosen before anything has been written down for it.
  const r = run(root, '--route', '9', '--stage');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /scoring it as a NEW route/);
  assert.match(r.stdout, /candidates, best worst-case first/);
  // and it says what the sheet DOES draw, so a typo in --route is distinguishable
  assert.match(r.stdout, /this sheet draws 1, 2, 7/);
});

test('--stage reads the manifest\'s current S3 and S2, not ci-reference', () => {
  const { root } = fixture();
  const r = run(root, '--route', '2', '--stage');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /sources: routes\.json S3 2026-09-03_1200 · geometry S2 2026-09-03_1100/);
  assert.match(r.stdout, /route 2 is #1111CE/);      // the staged colour, not the shipped one
});

test('--routes-json names the file outright and outranks --stage', () => {
  const { root, s3 } = fixture();
  const explicit = path.join(s3, 'other.json');
  fs.writeFileSync(explicit, JSON.stringify({ routeOrder: ['1'], palette: { 1: '#ABCDEF' } }));
  const r = run(root, '--route', '1', '--stage', '--routes-json', explicit);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /sources: routes\.json given/);
  assert.match(r.stdout, /route 1 is #ABCDEF/);
});

test('adjacency is measured by SHARED ROAD EDGE, as a fraction of this route\'s own line', () => {
  /* Route 7 has four edges; two are also route 1's and one is also route 2's, so
   * 50% and 25%. Route 2's shared edge is stored as d>c against route 7's c>d —
   * if direction were not normalised, route 2 would not appear at all. */
  const { root } = fixture();
  const r = run(root, '--route', '7', '--stage');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /drawn BESIDE 2 of them, by shared road edge: 1 50%, 2 25%/);
});

test('a route with no geometry says so rather than reporting a silent zero', () => {
  /* ci-reference in this fixture has no routes_paths.json at all. The distinction
   * that matters is "measured, and it touches nothing" versus "never measured" —
   * the second is the shape that made gen_external_busway.js invisible for a day. */
  const { root } = fixture();
  const r = run(root, '--route', '2');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /adjacency none on disk/);
  assert.doesNotMatch(r.stdout, /drawn BESIDE/);
});

test('a missing routes.json fails loudly, and points at --stage when the default was used', () => {
  const { root, ci } = fixture();
  fs.rmSync(path.join(ci, 'routes.json'));
  const r = run(root, '--route', '1');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /no routes\.json at/);
  assert.match(r.stderr, /add --stage/);
});
