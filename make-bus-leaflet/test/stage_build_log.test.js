/*
 * stage.js commit S4 — an S4 run folder has a build-warnings log (OA-310 item 2).
 *
 * `build_log.js` writes `build-warnings.txt` into the S4 run folder, and it is the
 * only record that a generator REFUSED to draw something: three of gen_internal.js's
 * feature-label guards decline and still exit 0. Until 2026-09-12 only the two
 * rollouts called it, and both rollouts refuse a data change by design — so an S4
 * built through the documented stage order, the only path left for a config change,
 * produced no log at all. `build_s4.js` fixed the producing half; this is the
 * boundary half, because `commit` is the one chokepoint every S4 passes through
 * however it was built.
 *
 * THE SCOPING WAS THE SUBJECT OF THIS FILE UNTIL 2026-09-14 AND IS NOW GONE. The
 * rule used to ask only whether the PREVIOUS run declared a log and this one has
 * none, because three maps' latest S4 legitimately had none — Huntingdon v5.0,
 * Wisbech v4.1 and St Neots v4.0 — and a flat rule would have been red on their
 * next commit for a history they could not change. All three were rebuilt in place
 * and re-committed on 2026-09-13, byte-identical across all nine sheets, so the
 * estate is 20 of 20 and the scoping protects nobody. It is retired here, and the
 * Huntingdon control it existed for is retired with it: under the flat rule a map
 * whose predecessor declared no log is exactly the map that needs the guard, and
 * leaving it exempt is how those three came to be in that state.
 *
 * WHAT THE WIDENING CHANGES IN THIS FILE, stated so nobody re-derives it. The first
 * S4 a map ever commits used to be exempt for want of a predecessor and is now
 * refused, which turns that case from a CONTROL into a mechanism test. And
 * re-committing the SAME run dir is still a CONTROL, but of a narrower thing: it
 * asserts the re-commit REPLACES rather than appends, and its fixture keeps its log
 * rather than having it deleted, because deleting it now tests the guard instead.
 *
 * TWO OF THE CONTROLS CANNOT BE FALSIFIED BY REMOVING THE GUARD, and that is worth
 * stating rather than hiding. Re-committing the same run dir, and an S2 that drops
 * an output, both PASS with the guard cut out — they are assertions that the guard
 * stays out of a case. The harness requires every non-CONTROL test to fail without
 * the guard, so a test that cannot fail must not claim to be one.
 *
 * stage.js is a CLI with main() at the bottom, so every case here spawns it.
 * Requiring it would run main() on import and prove nothing about the CLI.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');
const LOG = 'build-warnings.txt';

function newTown() {
  const dir = scratchDir('stage-build-log-');
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Logton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}

/* An S4 run dir that satisfies every OTHER commit guard — the stamps (OA-161) and
 * the orientation record (OA-206) — because a fixture that trips a different guard
 * cannot tell this one's verdict from that one's. `withLog` decides the only thing
 * this file is about. */
function s4(town, id, withLog) {
  const d = path.join(town, 'S4-generate', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'internal.svg'), '<svg/>');
  const ver = (id.match(/^v([0-9]+\.[0-9]+)_/) || [, '9.9'])[1];
  fs.writeFileSync(path.join(d, 'routes.json'), JSON.stringify({
    version: ver, town: 'Logton', engine: 'deadbeef01',
    design: { sheetVersion: 'build ' + ver + ' · 12 Sep 2026' } }));
  fs.writeFileSync(path.join(d, 'build-meta.json'), JSON.stringify({
    generator: 'gen_internal.js', sheet: 'internal',
    builtAt: (id.match(/_(\d{4}-\d{2}-\d{2})_/) || [, '2026-09-12'])[1] + 'T12:00:00.000Z',
    rotationDeg: 0, orientationSource: 'auto', fixedOrientation: null }));
  if (withLog) fs.writeFileSync(path.join(d, LOG), 'OK  nothing to report\n');
  return d;
}

function commit(town, args) {
  return spawnSync(process.execPath, [STAGE, 'commit'].concat(args), { cwd: town, encoding: 'utf8' });
}
function manifest(town) {
  return JSON.parse(fs.readFileSync(path.join(town, 'manifest.json'), 'utf8'));
}
const OUTS = (withLog) => ['--outputs', withLog ? 'internal.svg,' + LOG : 'internal.svg'];

test('the FIRST S4 a map ever commits is refused when it has no log — there is no starting exemption', () => {
  const town = newTown();
  const d = s4(town, 'v1.0_2026-09-12_1200', false);
  const r = commit(town, ['S4', d].concat(OUTS(false)));
  assert.notStrictEqual(r.status, 0, 'a first S4 with no log must not commit');
  assert.match(r.stderr, /v1\.0_2026-09-12_1200 has no build-warnings\.txt/);
  assert.doesNotMatch(r.stderr, /the run before it/, 'the flat rule must not talk about a predecessor');
  assert.strictEqual(manifest(town).stages.S4.runs.length, 0,
    'the refused run must not reach the manifest');
});

test('CONTROL — a run that carries the log commits after one that also did', () => {
  const town = newTown();
  commit(town, ['S4', s4(town, 'v1.0_2026-09-12_1200', true)].concat(OUTS(true)));
  const r = commit(town, ['S4', s4(town, 'v1.1_2026-09-12_1300', true)].concat(OUTS(true)));
  assert.strictEqual(r.status, 0, 'the ordinary case must pass: ' + r.stderr);
  assert.strictEqual(manifest(town).stages.S4.latest, 'v1.1_2026-09-12_1300');
});

test('the retired Huntingdon case: a predecessor with no log is now the map that MOST needs the guard', () => {
  const town = newTown();
  // The first run is forced through exactly as a pre-`build_s4.js` map's would have to be.
  const first = commit(town, ['S4', s4(town, 'v5.0_2026-09-12_1200', false)]
    .concat(OUTS(false), ['--force-nolog']));
  assert.strictEqual(first.status, 0, 'the override must still let a legacy run in: ' + first.stderr);
  const r = commit(town, ['S4', s4(town, 'v5.1_2026-09-12_1300', false)].concat(OUTS(false)));
  assert.notStrictEqual(r.status, 0,
    'under the old scoping this committed silently, which is how three maps stayed logless');
  assert.match(r.stderr, /v5\.1_2026-09-12_1300 has no build-warnings\.txt/);
  assert.strictEqual(manifest(town).stages.S4.latest, 'v5.0_2026-09-12_1200');
});

test('a run whose PREDECESSOR declared a log and which has none is refused', () => {
  const town = newTown();
  commit(town, ['S4', s4(town, 'v1.0_2026-09-12_1200', true)].concat(OUTS(true)));
  const r = commit(town, ['S4', s4(town, 'v1.1_2026-09-12_1300', false)].concat(OUTS(false)));
  assert.notStrictEqual(r.status, 0, 'a lost log must not commit');
  assert.match(r.stderr, /v1\.1_2026-09-12_1300 has no build-warnings\.txt/);
  assert.match(r.stderr, /build_s4\.js/, 'the refusal must print the command that writes it');
  assert.strictEqual(manifest(town).stages.S4.latest, 'v1.0_2026-09-12_1200',
    'the refused run must not reach the manifest');
});

test('--force-nolog turns the refusal into a warning and lets the commit through', () => {
  const town = newTown();
  commit(town, ['S4', s4(town, 'v1.0_2026-09-12_1200', true)].concat(OUTS(true)));
  const r = commit(town, ['S4', s4(town, 'v1.1_2026-09-12_1300', false)]
    .concat(OUTS(false), ['--force-nolog']));
  assert.strictEqual(r.status, 0, 'the override must work: ' + r.stderr);
  assert.match(r.stdout, /WARNING: committing an S4 with no build-warnings\.txt \(--force-nolog\)/);
  assert.strictEqual(manifest(town).stages.S4.latest, 'v1.1_2026-09-12_1300');
});

test('CONTROL — re-committing the SAME run dir replaces the record rather than appending', () => {
  const town = newTown();
  const d = s4(town, 'v1.0_2026-09-12_1200', true);
  assert.strictEqual(commit(town, ['S4', d].concat(OUTS(true))).status, 0);
  // The log stays: under the flat rule deleting it would test the guard, not this.
  const r = commit(town, ['S4', d].concat(OUTS(true)));
  assert.strictEqual(r.status, 0, 'a re-commit of a run that has its log must pass: ' + r.stderr);
  assert.strictEqual(manifest(town).stages.S4.runs.length, 1, 're-commit replaces rather than appends');
});

test('CONTROL — the guard is S4-only: an S2 that declared outputs and then declares fewer still commits', () => {
  const town = newTown();
  const a = path.join(town, 'S2-geometry', '2026-09-12_1200');
  fs.mkdirSync(a, { recursive: true });
  fs.writeFileSync(path.join(a, 'roads_geo.json'), '{}');
  fs.writeFileSync(path.join(a, LOG), 'OK\n');
  assert.strictEqual(commit(town, ['S2', a, '--outputs', 'roads_geo.json,' + LOG]).status, 0);
  const b = path.join(town, 'S2-geometry', '2026-09-12_1300');
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, 'roads_geo.json'), '{}');
  const r = commit(town, ['S2', b, '--outputs', 'roads_geo.json']);
  assert.strictEqual(r.status, 0, 'no stage but S4 draws sheets: ' + r.stderr);
});
