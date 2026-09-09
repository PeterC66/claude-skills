'use strict';
/*
 * rollout_seed_parity.test.js — a rollout's dry run and its --apply assemble the
 * SAME build directory, even when S2 has moved since the last S4 (OA-239).
 *
 * THE FAULT THIS IS WRITTEN DOWN FROM. The dry run — which is the entire safety
 * mechanism, and the thing `--apply` is supposed to be a confirmation of — built in
 * a scratch workspace seeded from the previous S4's frozen `*.json`. The real apply
 * built in a fresh run directory seeded by `stage.js pull S2` then `pull S3`, and
 * `pull` takes the stage's `latest`. So when a town's S2 had moved since its last
 * S4, the label diff the operator reads, the GAIN/LOST verdict the tool blocks on
 * and the sheets that actually ship were three statements about two different
 * builds. `rollout_places.js` had half of it fixed by OA-013 — the two halves
 * picked the same WINNER where both held a file — and still did not read the same
 * FILES: its scratch never pulled the stages at all.
 *
 * IT IS A UNIT TEST BECAUSE IT CANNOT BE A DATA ONE, and that is the same reason
 * seed_prev_s4.test.js gives. Measured on 2026-09-09: all twenty maps on the estate
 * have an S4 at least as new as their S2 and S3, so both halves read identical
 * bytes on every one of them and the live tree reports the fix working exactly as
 * loudly as it reported the bug working. The fixture below is the disagreement,
 * built by hand.
 *
 * WHAT STOPS THIS BEING A TAUTOLOGY. Both halves now call assembleS4Inputs, so
 * asserting that two identical calls agree proves nothing about the fixture. The
 * `old behaviour` test replays the two pre-fix algorithms against the SAME fixture
 * and asserts they DISAGREE — so if the fixture ever stops discriminating, that
 * test goes red and says so, rather than the parity test going quietly green over
 * a fixture with nothing in it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load, ENGINE_DIR } = require('./_engine');
const { scratchDir } = require('../assets/scratch');
const { assembleS4Inputs } = load('seed_prev_s4.js');

const STAGE_JS = path.join(ENGINE_DIR, 'stage.js');
const w = (dir, name, text) => fs.writeFileSync(path.join(dir, name), text);
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };

/*
 * A synthetic town whose S2 HAS MOVED since its S4 — the state the estate cannot
 * currently provide. `geo.json` is a declared S2 output and its bytes differ
 * between the two S2 runs; `extra.json` is the undeclared kind a build stage writes
 * back into its own run folder (roads_geo.json, routes_paths.json, boarding_index.json)
 * and only the previous S4 holds it.
 */
function fixture() {
  const root = scratchDir('rollout-parity-');
  const dir = mk(root, 'Town');
  const s2old = mk(dir, 'S2-geometry', '2026-01-01_0000');
  const s2new = mk(dir, 'S2-geometry', '2026-06-01_0000');
  const s3 = mk(dir, 'S3-config', '2026-02-01_0000');
  const s4 = mk(dir, 'S4-generate', 'v1.0_2026-03-01_0000');

  w(s2old, 'geo.json', '{"geometry":"as the S4 was built"}');
  w(s2new, 'geo.json', '{"geometry":"MOVED since that S4"}');
  w(s3, 'routes.json', '{"version":"1.0","from":"S3"}');
  w(s3, 'overrides.json', '{"from":"S3"}');
  // The previous S4 holds the OLD geometry, its own stamped routes.json, and an
  // undeclared extra no stage declares.
  w(s4, 'geo.json', '{"geometry":"as the S4 was built"}');
  w(s4, 'routes.json', '{"version":"1.0","from":"the previous S4 — stamped"}');
  w(s4, 'overrides.json', '{"from":"the previous S4"}');
  w(s4, 'extra.json', '{"undeclared":"written back by the build"}');

  const run = (id, d, outputs, at) => ({ id, dir: d, at, outputs });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    town: 'Town',
    created: '2026-01-01',
    stages: {
      S2: { name: 'geometry', latest: '2026-06-01_0000', runs: [
        run('2026-01-01_0000', 'S2-geometry/2026-01-01_0000', ['geo.json'], '2026-01-01T00:00'),
        run('2026-06-01_0000', 'S2-geometry/2026-06-01_0000', ['geo.json'], '2026-06-01T00:00'),
      ] },
      S3: { name: 'config', latest: '2026-02-01_0000', runs: [
        run('2026-02-01_0000', 'S3-config/2026-02-01_0000', ['routes.json', 'overrides.json'], '2026-02-01T00:00'),
      ] },
      S4: { name: 'generate', latest: 'v1.0_2026-03-01_0000', runs: [
        Object.assign(run('v1.0_2026-03-01_0000', 'S4-generate/v1.0_2026-03-01_0000', ['internal.svg'], '2026-03-01T00:00'), { version: '1.0' }),
      ] },
    },
  }, null, 2));
  return { root, dir, prevS4Dir: s4, prevS3Dir: s3, s2newDir: s2new };
}

// The real stage.js, not a stand-in: copyInto's declared/undeclared rule is half of
// what the two paths have to agree about, and a hand-written pull would be a third
// implementation of exactly the thing this file exists to stop.
function pullWith(townDir) {
  return (st, dest) => {
    const res = spawnSync(process.execPath, [STAGE_JS, 'pull', st, dest], { cwd: townDir, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`stage.js pull ${st} failed:\n${res.stderr || res.stdout}`);
  };
}

const snapshot = (d) => fs.readdirSync(d).sort()
  .filter(n => !fs.statSync(path.join(d, n)).isDirectory())
  .map(n => n + ' ' + fs.readFileSync(path.join(d, n), 'utf8')).join('');

const TOWN_STAGES = ['S2', 'S3'];
const TOWN_CARRY = ['routes.json', 'overrides.json'];

function assembleBoth(f) {
  const dry = mk(f.root, 'scratch', 'S4');       // the dry run's scratch workspace
  const apply = mk(f.root, 'real', 'S4');        // what `stage.js new S4` leaves behind: empty
  const args = { prevS4Dir: f.prevS4Dir, s3Carry: TOWN_CARRY, stages: TOWN_STAGES, pull: pullWith(f.dir) };
  assembleS4Inputs(Object.assign({ dest: dry }, args));
  assembleS4Inputs(Object.assign({ dest: apply }, args));
  return { dry, apply };
}

test('with S2 moved, the dry run and the apply assemble byte-identical inputs', () => {
  const f = fixture();
  const { dry, apply } = assembleBoth(f);
  assert.strictEqual(snapshot(dry), snapshot(apply),
    'the scratch build and the real S4 must be assembled from the same bytes — that is the whole of OA-239');
});

test('the rollout rule survives: the previous S4 geometry wins over a moved S2', () => {
  const f = fixture();
  const { apply } = assembleBoth(f);
  // rollout.js's own STALE-INPUTS refusal tells the operator that --force will
  // "roll the OLD geometry forward anyway". This is that promise, asserted.
  assert.strictEqual(fs.readFileSync(path.join(apply, 'geo.json'), 'utf8'),
    '{"geometry":"as the S4 was built"}');
});

test('an undeclared extra in the previous S4 is carried, not dropped', () => {
  const f = fixture();
  const { dry, apply } = assembleBoth(f);
  // "the S4 may hold a *.json that neither stage declares, and dropping it silently
  // would be a new fault of the same family" — OA-239. rollout.js's apply used to
  // drop exactly this, which is how a place's real run once crashed on roads_geo.json.
  for (const d of [dry, apply]) assert.ok(fs.existsSync(path.join(d, 'extra.json')));
});

test('S3 owns routes.json and overrides.json — never taken from the previous S4', () => {
  const f = fixture();
  const { apply } = assembleBoth(f);
  assert.match(fs.readFileSync(path.join(apply, 'routes.json'), 'utf8'), /"from":"S3"/);
  assert.match(fs.readFileSync(path.join(apply, 'overrides.json'), 'utf8'), /"from":"S3"/);
});

test('the fixture really does discriminate: the two OLD algorithms disagree on it', () => {
  const f = fixture();
  // The pre-fix dry run: prevS3's routes.json/overrides.json, then every other
  // .json from the previous S4. Verbatim from rollout.js before 2026-09-09.
  const oldDry = mk(f.root, 'old-dry');
  for (const n of TOWN_CARRY) fs.copyFileSync(path.join(f.prevS3Dir, n), path.join(oldDry, n));
  for (const n of fs.readdirSync(f.prevS4Dir)) {
    if (fs.statSync(path.join(f.prevS4Dir, n)).isDirectory()) continue;
    if (n.endsWith('.json') && !TOWN_CARRY.includes(n)) fs.copyFileSync(path.join(f.prevS4Dir, n), path.join(oldDry, n));
  }
  // The pre-fix apply: pull S2, pull S3, and no seed from the previous S4 at all.
  const oldApply = mk(f.root, 'old-apply');
  const pull = pullWith(f.dir);
  for (const st of TOWN_STAGES) pull(st, oldApply);

  assert.notStrictEqual(snapshot(oldDry), snapshot(oldApply),
    'if these agree the fixture proves nothing and every other test in this file is vacuous');
  // And name the two ways they disagreed, so a fixture that starts differing for
  // some third reason cannot quietly stand in for the fault this is about.
  assert.notStrictEqual(fs.readFileSync(path.join(oldDry, 'geo.json'), 'utf8'),
    fs.readFileSync(path.join(oldApply, 'geo.json'), 'utf8'), 'the moved S2 geometry');
  assert.ok(fs.existsSync(path.join(oldDry, 'extra.json')) && !fs.existsSync(path.join(oldApply, 'extra.json')),
    'the undeclared extra the old apply dropped');
});
