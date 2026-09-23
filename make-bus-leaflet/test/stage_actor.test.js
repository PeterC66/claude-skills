/*
 * stage.js — WHO performed a stage (OA-427, item 3 of R9 of the process review).
 *
 * `manifest.json` recorded when a stage was committed, how long it took and what
 * it spent, and never who did it — so *human touches per map-month*, the number
 * R9's whole recommendation is judged on, could not be computed and
 * `routine_numbers.mjs` printed a refusal in its place.
 *
 * GIT WAS THE WRONG INSTRUMENT AND THAT IS WHY THIS IS IN THE MANIFEST. It says
 * "Peter Cooper" for a commit Peter made and for one a session made in his name,
 * across all 103 sessions in the review's window — and S4, S5 and S6 are
 * gitignored, so most of a map's work never reaches git to be attributed at all.
 * A stage is one span of work with one performer, which is where the answer is
 * known at the moment it is true.
 *
 * stage.js is a CLI with main() at the bottom, so every case here spawns it.
 *
 * THE CONTROL IS THE LAST CASE AND IT MUST STAY GREEN: a run committed with no
 * `--by` carries NO `by` field at all. An empty string or a default of "unknown"
 * would be indistinguishable, to `stage_actors.mjs`, from a real attribution, and
 * the count built on it would be confidently wrong rather than honestly absent.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');

const run = (cwd, args) => spawnSync(process.execPath, [STAGE, ...args], { cwd, encoding: 'utf8' });
const manifest = town => JSON.parse(fs.readFileSync(path.join(town, 'manifest.json'), 'utf8'));

function newTown() {
  const dir = scratchDir('stage-actor-');
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed:\n' + r.stdout + r.stderr);
  return dir;
}
/* Start a stage and put its one declared output in place. Returns the run dir the
 * CLI printed, never a path this file composed — the id is the CLI's to choose. */
function started(town, extra = []) {
  const r = run(town, ['new', 'S1', ...extra]);
  assert.strictEqual(r.status, 0, 'new failed:\n' + r.stdout + r.stderr);
  const dir = r.stdout.trim().split('\n').pop().trim();
  fs.writeFileSync(path.join(dir, 'verified-services.json'), '{"ok":1}\n');
  return dir;
}
const commit = (town, dir, extra = []) =>
  run(town, ['commit', 'S1', dir, '--outputs', 'verified-services.json', ...extra]);
const latestRun = town => {
  const s = manifest(town).stages.S1;
  return s.runs.find(r => r.id === s.latest);
};

test('a commit records the actor it is given', () => {
  const town = newTown();
  const r = commit(town, started(town), ['--by', 'sched-1252']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(latestRun(town).by, 'sched-1252');
  assert.match(r.stdout, /by sched-1252/, 'the commit line says who, so it is visible without opening the manifest');
});

test('the actor `new` was given is inherited by a commit that is not told', () => {
  const town = newTown();
  const dir = started(town, ['--by', 'buses-29']);
  assert.strictEqual(manifest(town).stages.S1.pending.by, 'buses-29',
    'an OPEN stage says who started it, so an abandoned one is not anonymous');
  assert.strictEqual(commit(town, dir).status, 0);
  assert.strictEqual(latestRun(town).by, 'buses-29');
});

test('an explicit actor on the commit beats the one `new` recorded', () => {
  /* The case that matters: a stage opened by one session and finished by another.
   * The committer is the honest answer, because it is the one that did the work
   * being recorded. */
  const town = newTown();
  const dir = started(town, ['--by', 'buses-29']);
  assert.strictEqual(commit(town, dir, ['--by', 'sched-0614']).status, 0);
  assert.strictEqual(latestRun(town).by, 'sched-0614');
});

test('a pending actor from a DIFFERENT run is not inherited', () => {
  /* The same condition the clock is trusted under, for the same reason: a stage
   * started, abandoned and started again must not report the first one's session
   * any more than it reports the first one's clock. */
  const town = newTown();
  const dir = started(town, ['--by', 'buses-29']);
  /* THE PENDING ID IS REPOINTED BY HAND rather than by starting a second stage,
   * because run ids are minute-resolution: two `new` calls in the same minute
   * produce the SAME id, so a test that started two runs back to back would pass
   * without this rule ever being consulted. */
  const m = manifest(town);
  m.stages.S1.pending.id = 'some-other-run';
  fs.writeFileSync(path.join(town, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  assert.strictEqual(commit(town, dir).status, 0);
  assert.strictEqual(latestRun(town).by, undefined,
    'a pending record naming another run must not be attributed to this one');
});

test('the actor is cleared with the pending record, so it cannot leak into the next run', () => {
  const town = newTown();
  commit(town, started(town, ['--by', 'buses-29']));
  assert.strictEqual(manifest(town).stages.S1.pending, undefined,
    'the pending record, and the actor on it, go together');
  const next = started(town);                    // a fresh run, started with no actor
  assert.strictEqual(commit(town, next).status, 0);
  assert.strictEqual(latestRun(town).by, undefined,
    'the run committed without an actor carries none, whatever the previous one carried');
});

test('a name that cannot be used is refused, not quietly dropped', () => {
  const town = newTown();
  for (const [bad, why] of [
    ['   ', 'blank'],
    ['x'.repeat(65), 'longer than the cap'],
    ['two\nlines', 'more than one line'],
  ]) {
    const r = commit(town, started(town), ['--by', bad]);
    assert.strictEqual(r.status, 2, `a ${why} actor should be a usage error: ` + r.stdout + r.stderr);
    assert.match(r.stderr, /--by/, 'the refusal names the flag');
  }
});

test('CONTROL — no --by anywhere leaves NO `by` field, which is not an actor of "unknown"', () => {
  const town = newTown();
  assert.strictEqual(commit(town, started(town)).status, 0);
  const rec = latestRun(town);
  assert.ok(!('by' in rec), 'an unattributed run must be absent from the record, not present and empty');
  assert.ok(rec.at, 'and the rest of the record is unaffected');
});
