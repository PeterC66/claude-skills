/*
 * `commit S4` refuses an AREA S4 that drew a sheet without carrying its generator
 * (buses-data OA-318, the last item).
 *
 * The portal re-draws an area map on the host from the payload's own `gen_internal.js`
 * and `gen_external.js`. St Neots v4.0 was assembled by hand on 2026-09-11 with the
 * generators run in place: identical bytes on the laptop, and `Cannot find module
 * '…/gen_external.js'` at the host's pre-flight verify. `build_s4.js` copies them in;
 * this is the boundary half, for the build that did not go through it.
 *
 * Every fixture satisfies the OTHER S4 guards — stamps, orientation record, build log —
 * so a verdict here is this guard's and nobody else's. stage.js is a CLI with main() at
 * the bottom, so every case spawns it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

// ENGINE_DIR, so `tools/prove-red.js` can point this file at its mutated copy of assets/.
const ENGINE = process.env.ENGINE_DIR
  ? path.resolve(process.env.ENGINE_DIR)
  : path.join(__dirname, '..', 'assets');
const STAGE = process.env.STAGE_JS || path.join(ENGINE, 'stage.js');
const RUN_ID = 'v4.0_2026-09-11_1200';

/* A town (or, with `place`, a place under Areas/<town>/Places/) holding one S4 run
 * folder with the sheets and generators named. */
function s4(files, { place = false } = {}) {
  const root = scratchDir('stage-s4-gens-');
  const mapDir = place ? path.join(root, 'Areas', 'Testton', 'Places', 'Testton Co-op') : root;
  fs.mkdirSync(mapDir, { recursive: true });
  const r = spawnSync(process.execPath, [STAGE, 'init', mapDir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  const d = path.join(mapDir, 'S4-generate', RUN_ID);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'routes.json'), JSON.stringify({
    version: '4.0', town: 'Testton', engine: 'deadbeef01',
    design: { sheetVersion: 'build 4.0 · 11 Sep 2026' } }));
  fs.writeFileSync(path.join(d, 'build-meta.json'), JSON.stringify({
    generator: 'gen_internal.js', sheet: 'internal', builtAt: '2026-09-11T12:00:00.000Z',
    rotationDeg: 0, orientationSource: 'auto', fixedOrientation: null }));
  fs.writeFileSync(path.join(d, 'build-warnings.txt'), 'OK  nothing to report\n');
  for (const f of files) fs.writeFileSync(path.join(d, f), f.endsWith('.svg') ? '<svg/>' : '');
  return { mapDir, d };
}

function commit({ mapDir, d }, outputs, ...extra) {
  return spawnSync(process.execPath, [STAGE, 'commit', 'S4', d, '--outputs', outputs, ...extra],
    { cwd: mapDir, encoding: 'utf8' });
}
function s4Latest({ mapDir }) {
  return JSON.parse(fs.readFileSync(path.join(mapDir, 'manifest.json'), 'utf8')).stages.S4.latest;
}
const BOTH = 'internal.svg,external.svg';

test('CONTROL — an area S4 carrying both generators commits', () => {
  const t = s4(['internal.svg', 'external.svg', 'gen_internal.js', 'gen_external.js']);
  const r = commit(t, BOTH);
  assert.strictEqual(r.status, 0, 'the control must pass: ' + r.stderr);
  assert.strictEqual(s4Latest(t), RUN_ID);
});

test('REFUSE — an area S4 drawn in place, carrying neither generator', () => {
  const t = s4(['internal.svg', 'external.svg']);
  const r = commit(t, BOTH);
  assert.notStrictEqual(r.status, 0, 'a payload the host cannot re-draw must not commit');
  assert.match(r.stderr, /drew internal\.svg and external\.svg but does not carry gen_internal\.js or gen_external\.js/);
  assert.strictEqual(s4Latest(t), null, 'nothing may be recorded for a refused run');
});

test('REFUSE — only gen_external.js missing (the St Neots v4.0 shape)', () => {
  const t = s4(['internal.svg', 'external.svg', 'gen_internal.js']);
  const r = commit(t, BOTH);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /drew external\.svg but does not carry gen_external\.js/);
});

test('OVERRIDE — --force-nogen commits and says so', () => {
  const t = s4(['internal.svg', 'external.svg']);
  const r = commit(t, BOTH, '--force-nogen');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /WARNING: committing an area S4 without gen_internal\.js or gen_external\.js/);
});

test('CONTROL — a place S4 needs no generators, because the portal stages it with its own', () => {
  const t = s4(['internal.svg', 'external.svg'], { place: true });
  const r = commit(t, BOTH);
  assert.strictEqual(r.status, 0, 'a place must not be asked for area generators: ' + r.stderr);
});
