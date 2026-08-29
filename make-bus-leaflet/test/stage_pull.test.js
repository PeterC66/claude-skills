/*
 * stage.js pull — an undeclared file may not clobber one already there (OA-164).
 *
 * `pull` copies the whole run FOLDER; `commit` and the manifest speak only of the
 * outputs a stage DECLARED. Any other file left lying in a run folder therefore
 * rides along on every pull, and whether it does damage depends on nothing but the
 * order the pulls happen to be written in.
 *
 * It fired on 2026-08-29. Beaconsfield Waitrose's S2 folder from 21 July holds a
 * routes.json it never declared -- the July draft -- and the documented P3 order is
 * `pull S3` then `pull S2`, so the S2 copy landed on top of five weeks of curated
 * config. The rebuild was clean, the byte gate said PASS, and the external sheet
 * quietly lost its intermediate stop names, its journey times, its QR code and its
 * checkedAt. The byte gate could not see it because ci-reference is re-synced from
 * the same run, so the sheet was compared against itself.
 *
 * The first three tests are CONTROLS and must stay green: a guard that has only
 * ever been seen to refuse has not been shown to permit.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// tools/prove-red-stage-pull.js points this at a copy with the guard removed.
const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');

function newTown() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-pull-'));
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}
function run(town, args) {
  return spawnSync(process.execPath, [STAGE, ...args], { cwd: town, encoding: 'utf8' });
}
function stageRun(town, stage, dirName, id, files, outputs) {
  const d = path.join(town, dirName, id);
  fs.mkdirSync(d, { recursive: true });
  for (const [n, body] of Object.entries(files)) fs.writeFileSync(path.join(d, n), body);
  const r = run(town, ['commit', stage, d, '--outputs', outputs.join(',')]);
  assert.strictEqual(r.status, 0, `commit ${stage} failed: ` + r.stderr);
  return d;
}

// The estate's own shape: an S2 that declares geometry and also holds a stale,
// undeclared routes.json, and an S3 that declares the real one.
function townWithStray() {
  const town = newTown();
  stageRun(town, 'S2', 'S2-geometry', '2026-07-21_1654',
    { 'atco2ll.json': '{"s2":true}', 'routes.json': '{"whose":"the July draft"}' },
    ['atco2ll.json']);
  stageRun(town, 'S3', 'S3-config', '2026-08-28_1941',
    { 'routes.json': '{"whose":"the curated config"}' },
    ['routes.json']);
  return town;
}
function whose(dest) {
  return JSON.parse(fs.readFileSync(path.join(dest, 'routes.json'), 'utf8')).whose;
}
function dest(town, name) {
  const d = path.join(town, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

test('CONTROL — pulling one stage into an empty folder brings its declared output', () => {
  const town = townWithStray();
  const d = dest(town, 'work');
  assert.strictEqual(run(town, ['pull', 'S3', d]).status, 0);
  assert.strictEqual(whose(d), 'the curated config');
});

test('CONTROL — an undeclared extra is still copied when the destination has no such file', () => {
  const town = townWithStray();
  const d = dest(town, 'work');
  assert.strictEqual(run(town, ['pull', 'S2', d]).status, 0);
  assert.ok(fs.existsSync(path.join(d, 'routes.json')),
    'older run folders are full of harmless upstream copies and something may rely on them');
  assert.strictEqual(whose(d), 'the July draft');
});

test('CONTROL — a DECLARED output still overwrites, because that is what pulling a stage means', () => {
  const town = townWithStray();
  const d = dest(town, 'work');
  fs.writeFileSync(path.join(d, 'routes.json'), '{"whose":"something stale"}');
  assert.strictEqual(run(town, ['pull', 'S3', d]).status, 0);
  assert.strictEqual(whose(d), 'the curated config');
});

test('an undeclared file does not overwrite one the destination already holds', () => {
  const town = townWithStray();
  const d = dest(town, 'work');
  assert.strictEqual(run(town, ['pull', 'S3', d]).status, 0);
  assert.strictEqual(run(town, ['pull', 'S2', d]).status, 0);
  assert.strictEqual(whose(d), 'the curated config',
    "S2's undeclared routes.json must not land on top of S3's declared one");
});

test('the pull says which file it kept, because silence was the whole defect', () => {
  const town = townWithStray();
  const d = dest(town, 'work');
  run(town, ['pull', 'S3', d]);
  const out = run(town, ['pull', 'S2', d]).stdout;
  assert.match(out, /undeclared "routes\.json"/,
    'the skip has to be visible in the build log or nobody learns the folder is dirty');
});

test('CONTROL — the guard is keyed on the DECLARED set, not on the file name', () => {
  const town = newTown();
  // Here S2 DECLARES routes.json, so it is that stage's own output and must win.
  stageRun(town, 'S2', 'S2-geometry', '2026-07-21_1654',
    { 'routes.json': '{"whose":"S2 declared this one"}' }, ['routes.json']);
  const d = dest(town, 'work');
  fs.writeFileSync(path.join(d, 'routes.json'), '{"whose":"something stale"}');
  assert.strictEqual(run(town, ['pull', 'S2', d]).status, 0);
  assert.strictEqual(whose(d), 'S2 declared this one');
});
