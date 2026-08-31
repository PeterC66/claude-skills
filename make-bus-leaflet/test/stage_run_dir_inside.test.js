/*
 * stage.js commit — the run dir must stay INSIDE the map folder.
 *
 * The manifest records each run as a path relative to the map's own directory.
 * `path.relative` answers "how do I get there from here", and a `..` chain is a
 * perfectly good answer, so `commit` used to record one without complaint.
 *
 * FOUND IN THE DATA on 2026-08-30. High Wycombe Aldi's manifest carried
 *   "dir": "../../../../../Users/Peter/AppData/Local/Programs/Git/v1.1_2026-07-30_0359"
 * for its S5 v1.1 run, written 2026-07-30 — MSYS path mangling, where a bare
 * `/v1.1_2026-07-30_0359` argument in Git Bash is rewritten with the Git install
 * prefix before node sees it. One row in 1,654 across all 20 manifests.
 *
 * WHY A SEPARATE FILE from stage_commit.test.js. That file is the OA-106
 * output-existence guard and its harness classifies every non-CONTROL test as
 * one that MUST go red when OA-106 is cut out. These tests stay green under that
 * cut, because they are about a different guard — putting them there would make
 * prove-red-stage-commit.js report a false failure.
 *
 * stage.js is a CLI with main() at the bottom, so every case spawns it.
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

// tools/prove-red-stage-run-dir.js points this at a copy with the guard removed.
const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');

function newTown() {
  const dir = scratchDir('stage-rundir-');
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}

function commit(town, args) {
  return spawnSync(process.execPath, [STAGE, 'commit', ...args], { cwd: town, encoding: 'utf8' });
}

function manifest(town) {
  return JSON.parse(fs.readFileSync(path.join(town, 'manifest.json'), 'utf8'));
}

test('CONTROL — an ordinary run dir inside the map folder still commits', () => {
  const town = newTown();
  const d = path.join(town, 'S2-geometry', '2026-08-30_1200');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'osm.json'), '{}');

  const r = commit(town, ['S2', d, '--outputs', 'osm.json']);
  assert.strictEqual(r.status, 0, 'the control must pass: ' + r.stderr);
  assert.strictEqual(manifest(town).stages.S2.latest, '2026-08-30_1200');
  assert.strictEqual(manifest(town).stages.S2.runs[0].dir, 'S2-geometry/2026-08-30_1200',
    'the recorded dir must be the plain relative form');
});

// The run dir EXISTS, so this is not the OA-106 existence check firing. Without
// the containment guard the commit succeeds and writes a `..` dir — which is
// precisely what happened to High Wycombe Aldi.
test('a run dir outside the map folder is refused', () => {
  const town = newTown();
  const outside = scratchDir('stage-outside-');
  const d = path.join(outside, 'v1.1_2026-07-30_0359');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'internal.jpg'), 'x');

  const r = commit(town, ['S5', d, '--outputs', 'internal.jpg']);
  assert.notStrictEqual(r.status, 0, 'commit accepted a run dir outside the map folder');
  assert.match(r.stderr, /outside the map folder/);
});

test('the refusal happens before the manifest is written', () => {
  const town = newTown();
  const outside = scratchDir('stage-outside-');
  const d = path.join(outside, 'v1.2_2026-07-30_0400');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'internal.jpg'), 'x');

  commit(town, ['S5', d, '--outputs', 'internal.jpg']);
  const s5 = manifest(town).stages.S5;
  assert.strictEqual(s5.latest, null, 'a refused commit must not move `latest`');
  assert.strictEqual(s5.runs.length, 0, 'a refused commit must not leave a run behind');
});

test('the map folder itself is not a run dir', () => {
  const town = newTown();
  const r = commit(town, ['S2', town, '--outputs', 'manifest.json']);
  assert.notStrictEqual(r.status, 0, 'the map folder is not a run within itself');
  assert.match(r.stderr, /outside the map folder/);
});
