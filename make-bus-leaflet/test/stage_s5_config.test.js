/*
 * `commit S5` refuses a routes.json that is not the one its S4 rendered (buses-data OA-318 item 3).
 *
 * St Neots v4.0: a corrected S3 was pulled into the same S4 folder and the build re-run, then a
 * second `pull S4` into the same S5 folder refreshed the three SVGs and kept the superseded
 * routes.json. Every laptop gate PASSed, because ci-reference/ is mirrored from S4 and S4 was
 * right; the portal's pre-flight verify caught it on the host. `pull` now refreshes that copy
 * (stage_pull.test.js). This file asks the same question at `commit S5`, which is where a folder
 * assembled any other way arrives unexamined.
 *
 * The S4 is written into the manifest by hand rather than committed, because committing an S4
 * must satisfy three unrelated guards (engine hash, sheet-version stamp, build log), and a case
 * that fails for a reason other than its subject is a case nobody trusts. stage.js is a CLI with
 * main() at the bottom, so every case spawns it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

// ENGINE_DIR, so `tools/prove-red.js` can point this file at its mutated copy of assets/ —
// a spawned stage.js does not go through _engine.js, and without it both mutations for this
// file SURVIVED on the first run, exactly as stage_completeness.test.js records.
const ENGINE = process.env.ENGINE_DIR
  ? path.resolve(process.env.ENGINE_DIR)
  : path.join(__dirname, '..', 'assets');
const STAGE = process.env.STAGE_JS || path.join(ENGINE, 'stage.js');

const CONFIG = { version: 'v4.0', town: 'Testton', mapNotes: [{ x: 56, y: 20, text: 'note' }] };

/* A town whose manifest records one S4 run, `S4-generate/<s4Id>`, holding CONFIG. */
function townWithS4(s4Id = 'v4.0_2026-09-11_1200') {
  const town = scratchDir('stage-s5-config-');
  const r = spawnSync(process.execPath, [STAGE, 'init', town, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  const dir = path.join('S4-generate', s4Id);
  fs.mkdirSync(path.join(town, dir), { recursive: true });
  fs.writeFileSync(path.join(town, dir, 'routes.json'), JSON.stringify(CONFIG, null, 2));
  const mf = path.join(town, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.stages.S4.runs.push({ id: s4Id, dir: dir.split(path.sep).join('/'), at: '2026-09-11T12:00Z', outputs: ['internal.svg'] });
  m.stages.S4.latest = s4Id;
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  return town;
}

/* An S5 run folder holding a rendered sheet and the routes.json given. */
function s5With(town, config, id = 'v4.0_2026-09-11_1300') {
  const d = path.join(town, 'S5-render', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'internal.jpg'), 'jpg');
  if (config) fs.writeFileSync(path.join(d, 'routes.json'), JSON.stringify(config, null, 2));
  return d;
}

function commitS5(town, d, ...extra) {
  return spawnSync(process.execPath, [STAGE, 'commit', 'S5', d, '--outputs', 'internal.jpg', ...extra],
    { cwd: town, encoding: 'utf8' });
}

function s5Latest(town) {
  return JSON.parse(fs.readFileSync(path.join(town, 'manifest.json'), 'utf8')).stages.S5.latest;
}

test('CONTROL — an S5 carrying its S4’s routes.json commits', () => {
  const town = townWithS4();
  const r = commitS5(town, s5With(town, CONFIG));
  assert.strictEqual(r.status, 0, 'the control must pass: ' + r.stderr);
  assert.ok(s5Latest(town), 'the run is recorded');
});

test('CONTROL — a routes.json differing only in "version" commits, because pull re-stamps it', () => {
  const town = townWithS4();
  // The S5 side must match its own run dir (a separate guard), so vary the S4 side.
  fs.writeFileSync(path.join(town, 'S4-generate', 'v4.0_2026-09-11_1200', 'routes.json'),
    JSON.stringify({ ...CONFIG, version: 'v3.9' }, null, 2));
  const r = commitS5(town, s5With(town, CONFIG));
  assert.strictEqual(r.status, 0, 'a re-stamped version is not a stale config: ' + r.stderr);
});

test('REFUSE — an S5 holding the superseded config of its S4 (the St Neots v4.0 shape)', () => {
  const town = townWithS4();
  const stale = { ...CONFIG, mapNotes: [{ x: 40, y: 20, text: 'note' }] };
  const r = commitS5(town, s5With(town, stale));
  assert.notStrictEqual(r.status, 0, 'a stale config must not commit');
  assert.match(r.stderr + r.stdout, /routes\.json differs from the one in S4/);
  assert.strictEqual(s5Latest(town), null, 'nothing may be recorded for a refused run');
});

test('REFUSE — the S4 named in --based-on is the one compared, not the latest', () => {
  const town = townWithS4('v4.0_2026-09-11_1200');
  // A newer S4 becomes latest with a different config; the S5 says it renders the older one.
  const newer = path.join('S4-generate', 'v4.1_2026-09-12_0900');
  fs.mkdirSync(path.join(town, newer), { recursive: true });
  fs.writeFileSync(path.join(town, newer, 'routes.json'), JSON.stringify({ ...CONFIG, town: 'Other' }, null, 2));
  const mf = path.join(town, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.stages.S4.runs.push({ id: 'v4.1_2026-09-12_0900', dir: newer.split(path.sep).join('/'), at: '2026-09-12T09:00Z', outputs: [] });
  m.stages.S4.latest = 'v4.1_2026-09-12_0900';
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));

  const ok = commitS5(town, s5With(town, CONFIG), '--based-on', 'S4=v4.0_2026-09-11_1200');
  assert.strictEqual(ok.status, 0, 'matching the named S4 must pass even though latest differs: ' + ok.stderr);
  const bad = commitS5(town, s5With(town, { ...CONFIG, version: 'v4.1' }, 'v4.1_2026-09-12_1000'));
  assert.notStrictEqual(bad.status, 0, 'with no --based-on, the latest S4 is the one compared');
  assert.match(bad.stderr + bad.stdout, /differs from the one in S4 v4\.1_2026-09-12_0900/);
});

test('OVERRIDE — --force-stale-config commits and says so', () => {
  const town = townWithS4();
  const r = commitS5(town, s5With(town, { ...CONFIG, town: 'Elsewhere' }), '--force-stale-config');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /WARNING: committing an S5 whose routes\.json differs/);
});

test('CONTROL — an S4 folder that has been pruned is noted, not refused', () => {
  const town = townWithS4();
  fs.rmSync(path.join(town, 'S4-generate'), { recursive: true, force: true });
  const r = commitS5(town, s5With(town, { ...CONFIG, town: 'Elsewhere' }));
  assert.strictEqual(r.status, 0, 'nothing on disk to compare is not a refusal: ' + r.stderr);
  assert.match(r.stdout, /not compared with S4/);
});
