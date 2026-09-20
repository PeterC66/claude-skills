/*
 * `--based-on` — the run record's provenance field, and the command that writes it (OA-352).
 *
 * `stage.js` reads `--based-on` in its COMMIT handler and nowhere else, because `commit` is
 * what writes a run record and `new` only makes a folder. From 2026-09-03 to 2026-09-17 both
 * rollouts passed the flag on their `new` call and never again, so every S4 either of them
 * built carries no `basedOn` — and `staleInputs()` in gate_lib.js, which exists to prefer
 * that exact signal, has been falling back to its weaker "did the latest S2/S3 finish after
 * this S4 started?" inference on all of them. Nothing went red. The argument was accepted,
 * ignored and discarded, and a clean answer from the fallback reads exactly like a clean
 * answer from the exact signal.
 *
 * SO THESE CASES DRIVE THE REAL stage.js AND ASK WHETHER THE FIELD LANDS. A test that
 * asserted the rollouts pass the argument would have been green throughout the fortnight —
 * they did pass it. That is `the subject you named yourself`: a check on the call site
 * cannot report that the callee ignores it. The only question worth asking is of the
 * manifest afterwards.
 *
 * THE CASES USE S2 RATHER THAN S4 ON PURPOSE. The flag's handling is stage-agnostic — it is
 * parsed once, above every S4-specific rule, and written once at the end — while committing
 * an S4 must also satisfy three unrelated guards (an engine hash, a sheet-version stamp and
 * a build log). Using S4 here would test those instead, and a case that fails for a reason
 * other than its subject is a case nobody trusts.
 *
 * stage.js is a CLI with main() at the bottom, so every case spawns it. Requiring it would
 * run main() on import and prove nothing about the CLI.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');

function newTown() {
  const dir = scratchDir('stage-based-on-');
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}

function run(town, args) {
  return spawnSync(process.execPath, [STAGE, ...args], { cwd: town, encoding: 'utf8' });
}

function runDir(town, stage, id) {
  const d = path.join(town, stage, id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'osm.json'), '{}');
  return d;
}

function latestRecord(town, stage) {
  const m = JSON.parse(fs.readFileSync(path.join(town, 'manifest.json'), 'utf8'));
  const sx = m.stages[stage];
  return sx.runs.find(r => r.id === sx.latest);
}

// ---- the field lands -------------------------------------------------------

test('CONTROL — `commit --based-on` records both ids on the run', () => {
  const town = newTown();
  const d = runDir(town, 'S2-geometry', '2026-09-17_1200');

  const r = run(town, ['commit', 'S2', d, '--outputs', 'osm.json',
                       '--based-on', 'S2=2026-08-21_0521;S3=2026-09-13_1730']);
  assert.strictEqual(r.status, 0, 'the control must pass: ' + r.stderr);

  const rec = latestRecord(town, 'S2');
  assert.deepStrictEqual(rec.basedOn, { S2: '2026-08-21_0521', S3: '2026-09-13_1730' },
    'the exact signal staleInputs() prefers has to be ON THE RECORD, not merely passed');
});

test('CONTROL — the rollouts’ own sequence lands it: new, then commit carrying the flag', () => {
  const town = newTown();

  // This is what rollout.js and rollout_places.js now do, in order: ask for a run dir,
  // fill it, then commit it naming the S2/S3 `latest` the pulls resolved. Before OA-352
  // the flag rode the FIRST of these two calls and the manifest came out with no basedOn.
  const made = run(town, ['new', 'S2']);
  assert.strictEqual(made.status, 0, 'new failed: ' + made.stderr);
  const dir = made.stdout.trim();
  fs.writeFileSync(path.join(dir, 'osm.json'), '{}');

  const r = run(town, ['commit', 'S2', dir, '--outputs', 'osm.json',
                       '--based-on', 'S2=2026-08-21_0521;S3=2026-09-13_1730', '--note', 'rollout']);
  assert.strictEqual(r.status, 0, 'commit failed: ' + r.stderr);
  assert.deepStrictEqual(latestRecord(town, 'S2').basedOn,
    { S2: '2026-08-21_0521', S3: '2026-09-13_1730' });
});

test('CONTROL — a commit with no --based-on records no basedOn, so its absence means something', () => {
  const town = newTown();
  const d = runDir(town, 'S2-geometry', '2026-09-17_1202');

  const r = run(town, ['commit', 'S2', d, '--outputs', 'osm.json']);
  assert.strictEqual(r.status, 0, 'the control must pass: ' + r.stderr);
  assert.strictEqual('basedOn' in latestRecord(town, 'S2'), false,
    'an absent field is what sends staleInputs() to its timestamp fallback — it must not be invented');
});

// ---- and the command that cannot honour it refuses it ----------------------

test('guard: `new --based-on` is REFUSED rather than silently ignored', () => {
  const town = newTown();

  const r = run(town, ['new', 'S2', '--based-on', 'S2=2026-08-21_0521;S3=2026-09-13_1730']);
  assert.notStrictEqual(r.status, 0,
    'accepting a flag it does not read is how a fortnight of S4s lost their provenance');
  assert.match(r.stderr + r.stdout, /commit/,
    'the refusal has to name the command that DOES read it — the fix is one word away');
});

test('guard: the refusal happens BEFORE the run folder is made, so nothing is left behind', () => {
  const town = newTown();

  const before = fs.existsSync(path.join(town, 'S2-geometry'))
    ? fs.readdirSync(path.join(town, 'S2-geometry')) : [];
  run(town, ['new', 'S2', '--based-on', 'S2=2026-08-21_0521']);
  const after = fs.existsSync(path.join(town, 'S2-geometry'))
    ? fs.readdirSync(path.join(town, 'S2-geometry')) : [];

  assert.deepStrictEqual(after, before,
    'a refused `new` that had already made its folder would leave an orphan run dir and a pending clock');
});
