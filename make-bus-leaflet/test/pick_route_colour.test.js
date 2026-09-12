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

/* ---------------------------------------------------------------------------
 * OA-304: the pool is every DRAWN LINEAR FEATURE, not only the wet ones.
 *
 * A GREEN RUN OF A COLOUR PICKER PROVES NOTHING — it always returns a ranking, so
 * a test that only asserts "it printed some candidates" passes on a tool that has
 * stopped measuring anything at all. What has to exist is a BEFORE/AFTER on the
 * ranking itself: the same town, the same route, one field different, and a
 * candidate that appears in one and not the other. The control is the half that
 * makes the finding mean something, and it is written first.
 *
 * The fixture is the real case, reduced: Wisbech draws the A47 as a `road`, the
 * engine strokes a road #e6a532, and #E69F00 — in the default pool for every town
 * — was the tool's top answer for route 68 on 2026-09-11.
 */
/* The palette is BLUE AND GREEN on purpose: it leaves the warm end of the pool
 * unconstrained, so #E69F00 is a live answer before the road is drawn and is not
 * one after. A fixture where the candidate was never competitive would let the
 * "after" assertion pass on a tool that had stopped ranking at all. */
function featureFixture(features, extra = {}) {
  const root = scratchDir('pick-colour-feat-');
  const town = path.join(root, 'Areas', 'Testbury');
  const ci = path.join(town, 'ci-reference');
  fs.mkdirSync(ci, { recursive: true });
  fs.writeFileSync(path.join(ci, 'routes.json'), JSON.stringify({
    routeOrder: ['1', '2'], palette: { 1: '#4477AA', 2: '#228833' }, features,
  }));
  // Every feature named above is DRAWN — geometry is what makes it able to clash.
  const geo = {}; for (const f of features) geo[f.key] = [[[52.5, 0.1], [52.6, 0.2]]];
  fs.writeFileSync(path.join(ci, 'features_geo.json'), JSON.stringify(Object.assign(geo, extra.geo || {})));
  return root;
}

test('CONTROL: with the road feature REMOVED, #E69F00 is offered in the top eight', () => {
  /* Without this the test below passes on a tool that returns an empty ranking, on
   * a pool that never held #E69F00, or — the way it actually failed when first
   * written — on a fixture where that hue was outside the printed eight anyway. */
  const root = featureFixture([]);
  const r = run(root, '--route', '9');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /#E69F00 {2}worst dE 76\.7 {2}vs 2 #228833/);
  assert.match(r.stdout, /no drawn linear feature/);
});

test('a drawn ROAD is in the pool, so the hue that IS the road stops being offered', () => {
  /* The road carries NO explicit stroke, which is the whole point: Wisbech's A47
   * does not either, so a fix reading only `f.style.stroke` would not have touched
   * the case this was filed for. #e6a532 comes from the type default.
   *
   * Both halves of the before/after are asserted. #E69F00 leaves the eight an
   * operator actually reads, and in the full ranking its worst separation collapses
   * from 76.7 against a route to 10.2 against the A47 — which is the number the
   * tool was silently not computing. */
  const root = featureFixture([{ key: 'A47', type: 'road' }]);
  const r = run(root, '--route', '9');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /#E69F00/);
  assert.match(r.stdout, /1 drawn linear feature\(s\): A47 #e6a532/);

  const full = run(root, '--route', '9', '--top', '30');
  assert.strictEqual(full.status, 0, full.stderr);
  assert.match(full.stdout, /#E69F00 {2}worst dE 10\.2 {2}vs A47 #e6a532/);
  // 5th of 26 becomes 24th of 26. Asserted as a RANK rather than as "it is last",
  // which is what this line first claimed and is not true: #117733 ties it at 10.2
  // against the green route and #0072B2 sits below both at 9.5 against the blue.
  const order = [...full.stdout.matchAll(/^ {2}(#[0-9A-F]{6}) {2}worst/gm)].map((m) => m[1]);
  assert.strictEqual(order.length, 26);
  assert.strictEqual(order.indexOf('#E69F00'), 23);
});

test('the summary line says linear FEATURES, not watercourses', () => {
  /* Item 2 of the action. The old line said "1 drawn watercourse(s)" while looking
   * at a road, which is a report naming a thing it did not measure. */
  const root = featureFixture([{ key: 'Great Ouse', type: 'river' }]);
  const r = run(root, '--route', '9');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /drawn linear feature\(s\)/);
  assert.doesNotMatch(r.stdout, /watercourse/);
});

test('a NEAR-NEUTRAL feature is skipped, and the run says it was skipped rather than going quiet', () => {
  /* A #333333 railway casing would otherwise knock out half the palette on
   * lightness alone, which is why the engine's §5.2 excludes near-neutrals too. An
   * exclusion that prints nothing is indistinguishable from never having looked. */
  const root = featureFixture([{ key: 'ECML', type: 'railway' }]);
  const r = run(root, '--route', '9');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /no drawn linear feature/);
  assert.match(r.stdout, /1 more drawn feature\(s\) skipped as near-neutral furniture: ECML #333333/);
});

test('a feature with NO geometry is not in the pool — declared is not drawn', () => {
  const root = scratchDir('pick-colour-nogeo-');
  const ci = path.join(root, 'Areas', 'Testbury', 'ci-reference');
  fs.mkdirSync(ci, { recursive: true });
  fs.writeFileSync(path.join(ci, 'routes.json'), JSON.stringify({
    routeOrder: ['1'], palette: { 1: '#CE1111' }, features: [{ key: 'A47', type: 'road' }],
  }));
  fs.writeFileSync(path.join(ci, 'features_geo.json'), JSON.stringify({}));
  const r = run(root, '--route', '9', '--top', '30');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /no drawn linear feature/);
  // and the undrawn road therefore constrains nothing: no candidate is scored against it
  assert.doesNotMatch(r.stdout, /vs A47/);
  assert.match(r.stdout, /#E69F00/);
});

test('the legacy river fallback fires on NO features block, and not merely on a dry one', () => {
  /* March and St Ives declare no `features[]` and gen_internal.js synthesises one
   * river from river_geo.json, so the fallback is load-bearing and stays. What
   * changed is its condition: it used to fire whenever the pool came back empty, so
   * a town declaring a road and no river got a phantom river in the pool as well as
   * its real road left out of it. */
  const root = scratchDir('pick-colour-legacy-');
  const town = path.join(root, 'Areas', 'Testbury');
  const s2 = path.join(town, 'S2-geometry', '2026-09-03_1100');
  const s3 = path.join(town, 'S3-config', '2026-09-03_1200');
  for (const d of [s2, s3]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(s2, 'river_geo.json'), JSON.stringify([[[52.5, 0.1], [52.6, 0.2]]]));
  fs.writeFileSync(path.join(s2, 'features_geo.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(town, 'manifest.json'), JSON.stringify({
    town: 'Testbury',
    stages: {
      S2: { latest: '2026-09-03_1100', runs: [{ id: '2026-09-03_1100', dir: 'S2-geometry/2026-09-03_1100' }] },
      S3: { latest: '2026-09-03_1200', runs: [{ id: '2026-09-03_1200', dir: 'S3-config/2026-09-03_1200' }] },
    },
  }));

  // No features block at all: the fallback fires and the river is in the pool.
  fs.writeFileSync(path.join(s3, 'routes.json'), JSON.stringify({ routeOrder: ['1'], palette: { 1: '#CE1111' } }));
  const withNone = run(root, '--route', '9', '--stage');
  assert.strictEqual(withNone.status, 0, withNone.stderr);
  assert.match(withNone.stdout, /river \(legacy fallback\) #9ec9e8/);

  // A features block that happens to be dry: no phantom river, and the road is in.
  fs.writeFileSync(path.join(s3, 'routes.json'), JSON.stringify({
    routeOrder: ['1'], palette: { 1: '#CE1111' }, features: [{ key: 'A47', type: 'road' }],
  }));
  fs.writeFileSync(path.join(s2, 'features_geo.json'), JSON.stringify({ A47: [[[52.5, 0.1], [52.6, 0.2]]] }));
  const withRoad = run(root, '--route', '9', '--stage');
  assert.strictEqual(withRoad.status, 0, withRoad.stderr);
  assert.doesNotMatch(withRoad.stdout, /legacy fallback/);
  assert.match(withRoad.stdout, /A47 #e6a532/);

  /* THE CASE THAT SEPARATES THE TWO CONDITIONS, and it is here because the mutation
   * harness found it missing: with only the two assertions above, replacing
   * `!(RJ.features||[]).length` with `!features.length` SURVIVED — both readings
   * agree on a town with no features and on a town with a chromatic one, so neither
   * assertion can tell them apart. A railway is the discriminator: it is DECLARED
   * and DRAWN, so the features block is not empty, but it is near-neutral so the
   * pool is. The old condition reads that empty pool and invents a river the sheet
   * does not draw. */
  fs.writeFileSync(path.join(s3, 'routes.json'), JSON.stringify({
    routeOrder: ['1'], palette: { 1: '#CE1111' }, features: [{ key: 'ECML', type: 'railway' }],
  }));
  fs.writeFileSync(path.join(s2, 'features_geo.json'), JSON.stringify({ ECML: [[[52.5, 0.1], [52.6, 0.2]]] }));
  const withRail = run(root, '--route', '9', '--stage');
  assert.strictEqual(withRail.status, 0, withRail.stderr);
  assert.doesNotMatch(withRail.stdout, /legacy fallback/);
  assert.match(withRail.stdout, /no drawn linear feature/);
  assert.match(withRail.stdout, /skipped as near-neutral furniture: ECML #333333/);
});

test('the copied stroke table still matches gen_internal.js\'s FEATURE_STYLES', () => {
  /* pick_route_colour.js carries its own copy of the per-type default strokes,
   * because FEATURE_STYLES is a const inside a VENDORED generator and exporting it
   * would owe a re-vendor. A copy is only defensible if something joins it to its
   * source: this is that join, and it is the check that was missing when the copy
   * held two of the five types and the tool measured against two of five features.
   *
   * Both tables are read out of the files rather than retyped here — a third copy
   * in a test would be the same fault with a green tick on it. */
  const strokes = (src, block) => {
    const m = src.match(new RegExp(block + '\\s*=\\s*\\{([\\s\\S]*?)\\n\\};'));
    assert.ok(m, `could not find ${block} — if it has moved, this join has to move with it`);
    const out = {};
    for (const line of m[1].split('\n')) {
      const e = line.match(/^\s*(\w+)\s*:\s*\{[^}]*stroke\s*:\s*'(#[0-9a-fA-F]{6})'/);
      if (e) out[e[1]] = e[2].toLowerCase();
    }
    return out;
  };
  const engine = strokes(fs.readFileSync(path.join(ENGINE_DIR, 'gen_internal.js'), 'utf8'), 'const FEATURE_STYLES');
  assert.ok(Object.keys(engine).length >= 5, `parsed only ${Object.keys(engine).length} FEATURE_STYLES entries`);

  const toolSrc = fs.readFileSync(SCRIPT, 'utf8');
  const tm = toolSrc.match(/const FEATURE_STROKE = \{([^}]*)\};/);
  assert.ok(tm, 'could not find FEATURE_STROKE in pick_route_colour.js');
  const tool = {};
  for (const e of tm[1].matchAll(/(\w+)\s*:\s*'(#[0-9a-fA-F]{6})'/g)) tool[e[1]] = e[2].toLowerCase();

  assert.deepStrictEqual(tool, engine,
    'the copied stroke table has drifted from gen_internal.js — re-copy it, and read the OA-304 comment above it');
});

test('a missing routes.json fails loudly, and points at --stage when the default was used', () => {
  const { root, ci } = fixture();
  fs.rmSync(path.join(ci, 'routes.json'));
  const r = run(root, '--route', '1');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /no routes\.json at/);
  assert.match(r.stderr, /add --stage/);
});
