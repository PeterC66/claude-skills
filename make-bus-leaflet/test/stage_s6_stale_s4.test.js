/*
 * An S6 must verify the S2 and S3 the latest S4 was drawn from (buses-data 60358500).
 *
 * buses-data 60358500 committed St Ives S2 2026-10-22_2322 and an S6 against it while
 * S4 v7.1 — basedOn S2 2026-07-04_0133 — stood, because the re-cut moved no ink. The
 * manifest then said the published sheets came from an S2 the S6 no longer verified,
 * gates.yml went red on stale_inputs.test.js (run 39879913992), and 8a8bddae cleared it
 * with the v8.0 rebuild that should have come first. `commit S6` now asks gate_lib's
 * staleInputs() of the S6's own view of S2/S3 and refuses, naming that rebuild.
 *
 * The first case is that manifest's shape, ids and all. CONTROL means "green whether or
 * not the guard is present": an S6 whose inputs match the S4's, one that names the OLD
 * S2 explicitly although a newer one is latest (which is why this is the S6's view and
 * not plain staleInputs(manifest)), and a map with no S4. A guard only ever seen to
 * refuse has not been shown to permit, and this one sits in front of every S6.
 *
 * stage.js is a CLI with main() at the bottom, so every case spawns it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

// ENGINE_DIR, so `tools/prove-red.js` can point this file at its mutated copy of assets/ —
// a spawned stage.js does not go through _engine.js (see stage_s5_config.test.js).
const ENGINE = process.env.ENGINE_DIR
  ? path.resolve(process.env.ENGINE_DIR)
  : path.join(__dirname, '..', 'assets');
const STAGE = process.env.STAGE_JS || path.join(ENGINE, 'stage.js');
const OLD_S2 = '2026-07-04_0133', NEW_S2 = '2026-10-22_2322', S3 = '2026-10-20_2332', S4 = 'v7.1_2026-10-20_2332';

/* A map whose S2 has moved past the S4, as St Ives stood after 60358500's S2 commit. */
function newMap(label, { s4 = true } = {}) {
  const dir = scratchDir(label);
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  const mf = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const rec = (id, stage, at, extra = {}) => ({ id, dir: `${stage}/${id}`, at, outputs: [], ...extra });
  m.stages.S2.runs = [rec(OLD_S2, 'S2-geometry', '2026-07-04T00:33'), rec(NEW_S2, 'S2-geometry', '2026-10-22T22:22')];
  m.stages.S2.latest = NEW_S2;
  m.stages.S3.runs = [rec(S3, 'S3-config', '2026-10-20T22:32')];
  m.stages.S3.latest = S3;
  if (s4) {
    m.stages.S4.runs = [rec(S4, 'S4-generate', '2026-10-20T22:40', { version: '7.1', basedOn: { S2: OLD_S2, S3 } })];
    m.stages.S4.latest = S4;
  }
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  return dir;
}

function s6Run(map, id) {
  const d = path.join(map, 'S6-verify', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'verification.json'), '{}');
  return d;
}

function commitS6(map, runDir, extra = []) {
  const r = spawnSync(process.execPath, [STAGE, 'commit', 'S6', runDir, '--outputs', 'verification.json', ...extra],
    { cwd: map, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const latestS6 = (map) => {
  const s6 = JSON.parse(fs.readFileSync(path.join(map, 'manifest.json'), 'utf8')).stages.S6;
  return s6.latest ? s6.runs.find(r => r.id === s6.latest) : null;
};

test('REFUSED: the 60358500 shape — S6 based on the new S2, S4 drawn from the old one', () => {
  const map = newMap('s6stale-60358500-');
  const r = commitS6(map, s6Run(map, '2026-10-22_2323'), ['--based-on', `S2=${NEW_S2};S3=${S3};S4=${S4}`]);
  assert.notStrictEqual(r.code, 0, 'an S6 verifying an S2 the sheets were not drawn from must not commit:\n' + r.out);
  assert.match(r.out, new RegExp(`S2 ${NEW_S2} \\(S4 ${S4.replace('.', '\\.')} was drawn from ${OLD_S2}`));
  assert.match(r.out, /Rebuild S4 and S5/, 'the refusal names the rebuild as the fix');
  assert.strictEqual(latestS6(map), null, 'nothing was recorded');
});

test('REFUSED: an S6 naming no inputs audits the latest, and the latest S2 has moved', () => {
  const map = newMap('s6stale-nobasedon-');
  const r = commitS6(map, s6Run(map, '2026-10-22_2323'));
  assert.notStrictEqual(r.code, 0, r.out);
  assert.strictEqual(latestS6(map), null);
});

test('REFUSED: an S3 the S4 was not drawn from is refused the same way', () => {
  const map = newMap('s6stale-s3-');
  const r = commitS6(map, s6Run(map, '2026-10-22_2323'), ['--based-on', `S2=${OLD_S2};S3=2026-10-22_0900`]);
  assert.notStrictEqual(r.code, 0, r.out);
  assert.match(r.out, /S3 2026-10-22_0900/);
});

test('CONTROL: an S6 based on exactly what the S4 was drawn from commits', () => {
  const map = newMap('s6stale-match-');
  const r = commitS6(map, s6Run(map, '2026-10-22_2323'), ['--based-on', `S2=${OLD_S2};S3=${S3};S4=${S4}`]);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(latestS6(map).id, '2026-10-22_2323');
  assert.strictEqual(latestS6(map).staleS4, undefined, 'nothing to record when nothing moved');
});

test('CONTROL: a map with no S4 has nothing to compare and commits', () => {
  const map = newMap('s6stale-nos4-', { s4: false });
  const r = commitS6(map, s6Run(map, '2026-10-22_2323'), ['--based-on', `S2=${NEW_S2};S3=${S3}`]);
  assert.strictEqual(r.code, 0, r.out);
});

test('OVERRIDE: --force-stale-s4 commits, says what it recorded, and records it', () => {
  const map = newMap('s6stale-force-');
  const why = 'ink unchanged; v8.0 rebuild follows';
  const r = commitS6(map, s6Run(map, '2026-10-22_2323'), ['--based-on', `S2=${NEW_S2};S3=${S3}`, '--force-stale-s4', why]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /WARNING: recorded S6 2026-10-22_2323 as verifying S2 2026-10-22_2322/);
  assert.ok(r.out.includes(why), 'the warning repeats the reason it recorded');
  const rec = latestS6(map);
  assert.deepStrictEqual(rec.staleS4, { s4: S4, why,
    moved: [{ stage: 'S2', was: OLD_S2, now: NEW_S2, how: 'basedOn' }] });
});
