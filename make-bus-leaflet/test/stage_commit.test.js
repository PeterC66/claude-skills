/*
 * stage.js commit — the output-existence guard (OA-106).
 *
 * `commit` took --outputs on trust, so a stage could be committed over an empty
 * folder and the manifest then advertised a version with no map in it. That
 * happened on 2026-08-21 and again on 2026-08-23, which is what made it a
 * recurring cost rather than a one-off. status.js reports the resulting state as
 * MISSING — it detects the symptom, it does not stop the symptom being created.
 *
 * stage.js is a CLI with main() at the bottom, so every case here spawns it.
 * Requiring it would run main() on import and prove nothing about the CLI.
 *
 * The first test is the CONTROL and it must stay green: a guard that has only
 * ever been seen to refuse has not been shown to permit.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

// tools/prove-red-stage-commit.js points this at a copy with the guard removed,
// so the suite can be watched failing against the code as it was before OA-106.
const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');

function newTown() {
  const dir = scratchDir('stage-commit-');
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}

function runDir(town, stage, id) {
  const d = path.join(town, stage, id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function commit(town, args) {
  return spawnSync(process.execPath, [STAGE, 'commit', ...args], { cwd: town, encoding: 'utf8' });
}

function manifest(town) {
  return JSON.parse(fs.readFileSync(path.join(town, 'manifest.json'), 'utf8'));
}

test('CONTROL — a commit whose declared outputs all exist still succeeds', () => {
  const town = newTown();
  const d = runDir(town, 'S2-geometry', '2026-08-28_1200');
  fs.writeFileSync(path.join(d, 'roads_geo.json'), '{}');
  fs.writeFileSync(path.join(d, 'osm.json'), '{}');

  const r = commit(town, ['S2', d, '--outputs', 'roads_geo.json,osm.json']);
  assert.strictEqual(r.status, 0, 'the control must pass: ' + r.stderr);
  assert.strictEqual(manifest(town).stages.S2.latest, '2026-08-28_1200');
});

test('CONTROL — a commit that declares no outputs at all is still allowed', () => {
  const town = newTown();
  const d = runDir(town, 'S2-geometry', '2026-08-28_1201');
  const r = commit(town, ['S2', d]);
  assert.strictEqual(r.status, 0, 'no --outputs is not an error: ' + r.stderr);
});

test('a declared output that is not there refuses the commit', () => {
  const town = newTown();
  const d = runDir(town, 'S2-geometry', '2026-08-28_1202');
  fs.writeFileSync(path.join(d, 'roads_geo.json'), '{}');

  const r = commit(town, ['S2', d, '--outputs', 'roads_geo.json,osm.json']);
  assert.notStrictEqual(r.status, 0, 'a missing output must refuse');
  assert.match(r.stderr, /osm\.json/, 'the refusal must name the file that is absent');
  assert.doesNotMatch(r.stderr, /roads_geo\.json/, 'it must not name the file that is present');
});

test('the refused commit leaves the manifest untouched — no half-record', () => {
  const town = newTown();
  const d = runDir(town, 'S2-geometry', '2026-08-28_1203');
  const before = fs.readFileSync(path.join(town, 'manifest.json'), 'utf8');

  const r = commit(town, ['S2', d, '--outputs', 'osm.json']);
  assert.notStrictEqual(r.status, 0);
  assert.strictEqual(fs.readFileSync(path.join(town, 'manifest.json'), 'utf8'), before,
    'a refused commit must not write the manifest');
  assert.strictEqual(manifest(town).stages.S2.latest, null);
});

test('an S4 committed over a wholly empty folder refuses — the 2026-08-23 case', () => {
  const town = newTown();
  const d = runDir(town, 'S4-generate', 'v1.0_2026-08-28_1204');

  const r = commit(town, ['S4', d, '--outputs', 'internal.svg,external.svg']);
  assert.notStrictEqual(r.status, 0, 'an empty S4 must refuse');
  assert.match(r.stderr, /internal\.svg/);
  assert.match(r.stderr, /external\.svg/);
  assert.strictEqual(manifest(town).stages.S4.latest, null,
    'the manifest must not advertise a version with no map in it');
});

test('a run dir that does not exist at all refuses, and says so plainly', () => {
  const town = newTown();
  const d = path.join(town, 'S2-geometry', '2026-08-28_9999');

  const r = commit(town, ['S2', d, '--outputs', 'osm.json']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /no such run dir/);
});

test('a directory does not count as an output — outputs are flat files', () => {
  const town = newTown();
  const d = runDir(town, 'S2-geometry', '2026-08-28_1205');
  fs.mkdirSync(path.join(d, 'osm.json'));

  const r = commit(town, ['S2', d, '--outputs', 'osm.json']);
  assert.notStrictEqual(r.status, 0, 'stage.js pull skips directories, so a directory is not an output');
});

test('--force-missing still records it, but says out loud what it recorded', () => {
  const town = newTown();
  const d = runDir(town, 'S2-geometry', '2026-08-28_1206');

  const r = commit(town, ['S2', d, '--outputs', 'osm.json', '--force-missing']);
  assert.strictEqual(r.status, 0, 'the override must work: ' + r.stderr);
  assert.match(r.stdout, /WARNING/, 'the override must not be silent');
  assert.match(r.stdout, /osm\.json/);
  assert.strictEqual(manifest(town).stages.S2.latest, '2026-08-28_1206');
});
