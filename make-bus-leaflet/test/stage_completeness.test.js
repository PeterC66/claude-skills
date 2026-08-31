/*
 * stage.js `commit S4` — DID THE BUILD PRODUCE EVERYTHING IT SAID IT WOULD?
 *
 * OA-206. Two files exist only when something other than the generators puts them
 * there, and until 2026-08-31 neither absence was reported anywhere.
 *
 *   `internal-schematic.svg`  a town whose routes.json sets `internalSchematic`
 *                             ships three sheets. `schematize_internal.js` is a
 *                             separate command; rollout.js runs it, a hand-built
 *                             S4 does not.
 *   `build-meta.json`         `gen_internal.js` writes it only when BUILD_META_DIR
 *                             is set, and only rollout.js sets it. It records the
 *                             rotation the build chose, which PCA re-derives every
 *                             time, and freeze_orientation.js reads it to pin a
 *                             sheet.
 *
 * Wisbech v3.1 was built the documented hand way on 2026-08-31 and committed with
 * both missing. `stage.js commit` accepted it and so did every byte gate — for the
 * OA-161 reason: `ci-reference/` is seeded from the same run, so a file absent from
 * both sides of the comparison agrees perfectly. The only thing that said a word was
 * `sync_ci_reference.js` printing a DELETION against the golden master, and only
 * because somebody read it. The stage boundary is the one place every route to an S4
 * passes through, which is why the check is here.
 *
 * The CONTROLS are the load-bearing half of this file. Three of them, and each one
 * is a shape that must NOT be refused: a map that never asked for the sheet, a PLACE
 * (whose engine has no build-meta path at all), and the three real maps that ship
 * deliberately without an internal or external sheet.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scratchDir } = require('../assets/scratch');

// ENGINE_DIR, so `tools/prove-red.js` can point this file at its mutated copy of
// assets/ — a spawned script does not go through _engine.js's require() the way an
// imported module does, and a test that always spawns the REAL stage.js reports a
// mutation as SURVIVED. Both mutations for this file did exactly that on the first
// run. (`STAGE_JS` is the older env var stage_stamps.test.js reads; honour both.)
const ENGINE = process.env.ENGINE_DIR
  ? path.resolve(process.env.ENGINE_DIR)
  : path.join(__dirname, '..', 'assets');
const STAGE = process.env.STAGE_JS || path.join(ENGINE, 'stage.js');
const RUN_ID = 'v9.9_2026-08-29_1200';
const STAMPED = { engine: 'deadbeef01', design: { sheetVersion: 'build 9.9 · 29 Aug 2026' } };

function newMap(prefix, town) {
  const dir = scratchDir(prefix);
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, town], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}

/** An S4 run dir. `files` is what the build actually produced; `rj` what it declared. */
function s4(mapDir, rj, files) {
  const d = path.join(mapDir, 'S4-generate', RUN_ID);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'routes.json'),
    JSON.stringify(Object.assign({ version: '9.9' }, STAMPED, rj)));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
  return d;
}
const META = JSON.stringify({ generator: 'gen_internal.js', sheet: 'internal',
  builtAt: '2026-08-29T12:00:00.000Z', rotationDeg: 47.6, orientationSource: 'auto', fixedOrientation: null });

function commit(mapDir, runDir, outputs, extra) {
  return spawnSync(process.execPath,
    [STAGE, 'commit', 'S4', runDir, '--outputs', outputs].concat(extra || []),
    { cwd: mapDir, encoding: 'utf8' });
}

// ------------------------------------------------------------------ the sheet

test('a town that declares internalSchematic and did not draw one is REFUSED', () => {
  const m = newMap('stage-complete-a-', 'Wisbechish');
  const d = s4(m, { internalSchematic: true },
    { 'internal.svg': '<svg/>', 'external.svg': '<svg/>', 'build-meta.json': META });
  const r = commit(m, d, 'internal.svg,external.svg');
  assert.notStrictEqual(r.status, 0, 'the commit must not be accepted');
  assert.match(r.stderr, /internal-schematic\.svg/, 'the refusal names the missing sheet');
  assert.match(r.stderr, /internalSchematic/, 'and the routes.json key that asked for it');
});

test('the refusal names the command that draws it', () => {
  const m = newMap('stage-complete-b-', 'Wisbechish');
  const d = s4(m, { internalSchematic: true },
    { 'internal.svg': '<svg/>', 'build-meta.json': META });
  const r = commit(m, d, 'internal.svg');
  assert.match(r.stderr, /schematize_internal\.js/,
    'a refusal that does not say how to satisfy it is a wall, not a guard');
});

test('the refused commit leaves the manifest untouched', () => {
  const m = newMap('stage-complete-c-', 'Wisbechish');
  const d = s4(m, { internalSchematic: true }, { 'internal.svg': '<svg/>', 'build-meta.json': META });
  commit(m, d, 'internal.svg');
  const mf = JSON.parse(fs.readFileSync(path.join(m, 'manifest.json'), 'utf8'));
  assert.strictEqual(mf.stages.S4.latest, null, 'no half-record of a refused build');
});

test('--force-missing records it and says out loud what it recorded', () => {
  const m = newMap('stage-complete-d-', 'Wisbechish');
  const d = s4(m, { internalSchematic: true }, { 'internal.svg': '<svg/>', 'build-meta.json': META });
  const r = commit(m, d, 'internal.svg', ['--force-missing']);
  assert.strictEqual(r.status, 0, 'the override must work: ' + r.stderr);
  assert.match(r.stdout, /WARNING[\s\S]*internal-schematic\.svg/);
});

test('CONTROL: a town that never asked for the sheet commits normally', () => {
  const m = newMap('stage-complete-e-', 'Plainton');
  const d = s4(m, {}, { 'internal.svg': '<svg/>', 'external.svg': '<svg/>', 'build-meta.json': META });
  const r = commit(m, d, 'internal.svg,external.svg');
  assert.strictEqual(r.status, 0, 'no opt-in key, nothing to require: ' + r.stderr);
});

/*
 * THE CONTROL THIS GUARD WAS NARROWED FOR. `sheet_registry.js` calls internal and
 * external unconditional, and requiring them would have refused the next commit of
 * three REAL maps for doing exactly what they were designed to do: High Wycombe
 * High Street and Town Centre carry a boarding plan and nothing else (OA-035), and
 * St Ives Bus Station has no external radial yet (OA-037). Measured on the estate
 * before the guard was written, not reasoned about afterwards.
 */
test('CONTROL: a boarding-only place with no internal or external sheet commits', () => {
  const m = newMap('stage-complete-f-', 'Somewhere Bus Station');
  const placeDir = path.join(m, 'Places', 'Somewhere Bus Station');
  fs.mkdirSync(placeDir, { recursive: true });
  const r0 = spawnSync(process.execPath, [STAGE, 'init', placeDir, 'Somewhere Bus Station'], { encoding: 'utf8' });
  assert.strictEqual(r0.status, 0, 'init failed: ' + r0.stderr);
  const d = s4(placeDir, { boardingPlan: true },
    { 'boarding.svg': '<svg/>', 'place.json': '{}' });
  const r = commit(placeDir, d, 'boarding.svg,place.json');
  assert.strictEqual(r.status, 0, 'a deliberate absence is not a failed build: ' + r.stderr);
});

// ------------------------------------------------------- the orientation record

test('an AREA S4 with no build-meta.json is REFUSED', () => {
  const m = newMap('stage-complete-g-', 'Plainton');
  const d = s4(m, {}, { 'internal.svg': '<svg/>' });
  const r = commit(m, d, 'internal.svg');
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /orientation record/);
  assert.match(r.stderr, /BUILD_META_DIR/, 'the refusal names the variable that fixes it');
});

/*
 * PRESENCE IS NOT FRESHNESS. `seedPrevS4` copies every .json from the previous S4
 * forward, build-meta.json included, and gen_internal.js overwrites it only when
 * BUILD_META_DIR is set — so a carried-forward copy satisfies a presence test while
 * describing a rotation from a different build. Both dates are written down, so
 * nothing here is inferred from an mtime.
 */
test('a build-meta.json carried forward from an earlier DAY is REFUSED', () => {
  const m = newMap('stage-complete-h-', 'Plainton');
  const stale = JSON.stringify({ generator: 'gen_internal.js', sheet: 'internal',
    builtAt: '2026-08-01T09:00:00.000Z', rotationDeg: 12.3 });
  const d = s4(m, {}, { 'internal.svg': '<svg/>', 'build-meta.json': stale });
  const r = commit(m, d, 'internal.svg');
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /carried forward by seedPrevS4/);
});

test('CONTROL: build-meta.json dated the same day as the run commits', () => {
  const m = newMap('stage-complete-i-', 'Plainton');
  const d = s4(m, {}, { 'internal.svg': '<svg/>', 'build-meta.json': META });
  const r = commit(m, d, 'internal.svg');
  assert.strictEqual(r.status, 0, 'the control must pass: ' + r.stderr);
});

/*
 * PLACES ARE EXCLUDED STRUCTURALLY, not as a let-off: rollout_places.js contains
 * the string BUILD_META_DIR zero times, so the place engine has no build-meta path
 * at all and a place without one has lost nothing. A guard that reddened all twelve
 * places would be muted inside a week.
 */
test('CONTROL: a PLACE S4 with no build-meta.json commits', () => {
  const m = newMap('stage-complete-j-', 'Townish');
  const placeDir = path.join(m, 'Places', 'Townish Co-op');
  fs.mkdirSync(placeDir, { recursive: true });
  spawnSync(process.execPath, [STAGE, 'init', placeDir, 'Townish Co-op'], { encoding: 'utf8' });
  const d = s4(placeDir, {}, { 'internal.svg': '<svg/>', 'external.svg': '<svg/>' });
  const r = commit(placeDir, d, 'internal.svg,external.svg');
  assert.strictEqual(r.status, 0, 'places have no orientation record to lose: ' + r.stderr);
});

test('--force-meta records it and says out loud what it recorded', () => {
  const m = newMap('stage-complete-k-', 'Plainton');
  const d = s4(m, {}, { 'internal.svg': '<svg/>' });
  const r = commit(m, d, 'internal.svg', ['--force-meta']);
  assert.strictEqual(r.status, 0, 'the override must work: ' + r.stderr);
  assert.match(r.stdout, /WARNING[\s\S]*orientation record/);
});

test('CONTROL: the guard is S4-only — an S2 with neither file still commits', () => {
  const m = newMap('stage-complete-l-', 'Plainton');
  const d = path.join(m, 'S2-geometry', '2026-08-29_1200');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'roads_geo.json'), '{}');
  const r = spawnSync(process.execPath,
    [STAGE, 'commit', 'S2', d, '--outputs', 'roads_geo.json'], { cwd: m, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'S2 has no sheets and no orientation: ' + r.stderr);
});
