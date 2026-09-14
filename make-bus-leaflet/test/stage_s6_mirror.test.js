/*
 * stage.js commit S6 — the `_latest` mirror refresh (OA-329 fault A).
 *
 * `<map>/_latest/` is the folder a PERSON opens to find a map's current
 * deliverables, and nothing in the S6 path ever wrote to it: `refresh_latest.js`
 * was a tool somebody remembered to run, and `grep -c '_latest' stage.js` found
 * nothing at all. Measured across the estate on 2026-09-13: **thirteen of twenty
 * maps carried a superseded verification report**, and one of the thirteen was
 * re-stranded within the hour by an S6 run that happened while the action was
 * being written. A remembered driver is what produced that, so the refresh moved
 * into `commit`, the one chokepoint every S6 passes through.
 *
 * WHY IT NEEDED A TEST AT ALL, given `tools/latest-mirror-gate.js` already gates
 * the mirrors: the gate asserts the ESTATE is in step and says nothing about what
 * put it there. It went green on 13 September over an estate a backfill had just
 * corrected BY HAND, and it would have stayed green for exactly as long as nobody
 * ran an S6. This suite asserts the mechanism instead of the state.
 *
 * stage.js is a CLI with main() at the bottom, so every case spawns it —
 * requiring it would prove nothing about the CLI.
 *
 * CONTROL here means "green whether or not the refresh is present": a commit that
 * still succeeds and still records its run, the S5 stage this deliberately does
 * NOT touch, and `refresh_latest.js --no-collect` answering for itself.
 * tools/prove-red-stage-s6-mirror.js cuts the call out of a copy of stage.js and
 * requires every non-CONTROL test below to go red and every CONTROL to stay green.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scratchDir } = require('../assets/scratch');

// tools/prove-red-stage-s6-mirror.js points this at a copy with the refresh
// removed, so the suite can be watched failing against the code as it was.
const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');
const REFRESH = path.join(__dirname, '..', 'assets', 'refresh_latest.js');

function newMap(label, name) {
  const dir = scratchDir(label);
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, name || 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}

function s6Run(map, id, body) {
  const d = path.join(map, 'S6-verify', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'verification.docx'), body);
  return d;
}

function commitS6(map, runDir) {
  return spawnSync(process.execPath, [STAGE, 'commit', 'S6', runDir, '--outputs', 'verification.docx'],
    { cwd: map, encoding: 'utf8' });
}

const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const mirror = (map) => path.join(map, '_latest', 'verification.docx');

test('a committed S6 leaves _latest/verification.docx byte-identical to the run it just committed', () => {
  const map = newMap('s6-mirror-new-');
  const run = s6Run(map, '2026-09-13_1000', 'THE-REPORT-THIS-RUN-WROTE');

  const r = commitS6(map, run);
  assert.strictEqual(r.status, 0, 'the commit itself must succeed: ' + r.stderr);
  assert.ok(fs.existsSync(mirror(map)), 'no _latest/verification.docx was written at all');
  assert.strictEqual(sha(mirror(map)), sha(path.join(run, 'verification.docx')),
    'the mirror is not this run\'s report');
});

test('a committed S6 REPLACES a superseded mirror — the estate fault, verbatim', () => {
  // This is the shape thirteen maps were in: a real mirror, holding a real
  // report, of a run that is no longer the latest. A test that started from an
  // EMPTY _latest could not tell a refresh from a first write.
  const map = newMap('s6-mirror-stale-');
  const old = s6Run(map, '2026-09-01_0900', 'THE-OLD-REPORT');
  assert.strictEqual(commitS6(map, old).status, 0);
  fs.mkdirSync(path.join(map, '_latest'), { recursive: true });
  fs.copyFileSync(path.join(old, 'verification.docx'), mirror(map));

  const fresh = s6Run(map, '2026-09-13_1100', 'THE-NEW-REPORT');
  const r = commitS6(map, fresh);
  assert.strictEqual(r.status, 0, 'the commit itself must succeed: ' + r.stderr);
  assert.strictEqual(fs.readFileSync(mirror(map), 'utf8'), 'THE-NEW-REPORT',
    'the mirror still holds the superseded report');
});

test('committing a PLACE\'s S6 refreshes that place\'s own mirror and leaves its town\'s alone', () => {
  // Fault B's shape from the other side. A place nested under a town is a map in
  // its own right (it has its own manifest.json), so its commit must write its
  // own mirror — and must not reach up into the town's, which describes a
  // different sheet entirely.
  const town = newMap('s6-mirror-town-', 'Towncastle');
  const townRun = s6Run(town, '2026-09-10_0800', 'TOWN-OWN-REPORT');
  assert.strictEqual(commitS6(town, townRun).status, 0);
  const townMirrorBefore = fs.readFileSync(mirror(town), 'utf8');

  const place = path.join(town, 'Places', 'Testton Co-op');
  fs.mkdirSync(place, { recursive: true });
  assert.strictEqual(spawnSync(process.execPath, [STAGE, 'init', place, 'Testton Co-op'],
    { encoding: 'utf8' }).status, 0);
  const placeRun = s6Run(place, '2026-09-13_1200', 'PLACE-OWN-REPORT');

  const r = commitS6(place, placeRun);
  assert.strictEqual(r.status, 0, 'the commit itself must succeed: ' + r.stderr);
  assert.strictEqual(fs.readFileSync(mirror(place), 'utf8'), 'PLACE-OWN-REPORT',
    'the place did not get its own report');
  assert.strictEqual(fs.readFileSync(mirror(town), 'utf8'), townMirrorBefore,
    'the town\'s mirror moved when a place inside it was committed');
});

test('the commit SAYS the mirror was refreshed, so a person driving it by hand can see it happen', () => {
  const map = newMap('s6-mirror-says-');
  const run = s6Run(map, '2026-09-13_1300', 'REPORT');
  const r = commitS6(map, run);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /_latest refreshed:.*verification\.docx/,
    'the commit printed nothing about the mirror: ' + JSON.stringify(r.stdout));
});

test('CONTROL — an S6 commit still exits 0 and still records the run in the manifest', () => {
  const map = newMap('s6-mirror-ctl-manifest-');
  const run = s6Run(map, '2026-09-13_1400', 'REPORT');
  const r = commitS6(map, run);
  assert.strictEqual(r.status, 0, 'the commit must succeed: ' + r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(map, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.stages.S6.latest, '2026-09-13_1400');
});

test('CONTROL — committing S5 does not write a mirror, because the rollout already does', () => {
  // The scope is S6 alone and this is what pins it: rollout.js and
  // rollout_places.js each call refresh_latest.js immediately after their own
  // `commit S5`, so a second call here would duplicate rather than fix.
  const map = newMap('s6-mirror-ctl-s5-');
  const d = path.join(map, 'S5-render', 'v1.0_2026-09-13_1500');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'internal.jpg'), 'JPG');
  const r = spawnSync(process.execPath, [STAGE, 'commit', 'S5', d, '--outputs', 'internal.jpg'],
    { cwd: map, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'the S5 commit must succeed: ' + r.stderr);
  assert.ok(!fs.existsSync(path.join(map, '_latest')),
    'commit S5 wrote a _latest folder — the S6 refresh is reaching a stage it should not');
});

test('CONTROL — refresh_latest.js --no-collect copies the mirror and says the sweep was skipped', () => {
  // The flag the commit boundary uses, asked of the tool directly: the copy is
  // this map's business and the estate-wide Collected_latests sweep is not.
  const map = newMap('s6-mirror-ctl-flag-');
  const run = s6Run(map, '2026-09-13_1600', 'FLAG-REPORT');
  assert.strictEqual(spawnSync(process.execPath, [STAGE, 'commit', 'S6', run, '--outputs', 'verification.docx'],
    { cwd: map, encoding: 'utf8' }).status, 0);
  const r = spawnSync(process.execPath, [REFRESH, map, '--no-collect'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'refresh_latest.js failed: ' + r.stderr);
  assert.match(r.stdout, /_latest refreshed:.*verification\.docx/);
  assert.match(r.stdout, /Collected_latests NOT refreshed \(--no-collect\)/);
  assert.strictEqual(fs.readFileSync(mirror(map), 'utf8'), 'FLAG-REPORT');
});
