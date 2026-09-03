/*
 * stage.js — what a stage COST (OA-105).
 *
 * `manifest.json` recorded when a stage was committed and never how long it took
 * or what it spent, so the one question anybody asks about a build — is this
 * cheaper than it was — had no data behind it at all.
 *
 * THE TWO OBVIOUS SOURCES ARE BOTH WRONG, which is why `new` writes the start
 * down rather than something inferring it later. A run folder's mtime moves every
 * time a generator writes into it. And the run ID's timestamp is LOCAL (`ts()`)
 * while `at` is UTC (`isoNow()`), so subtracting one from the other is a
 * daylight-saving bug waiting for a March morning: on St Ives' 2026-06-05 S1 the
 * id says 1830 and `at` says 17:38, which is eight minutes and looks like minus
 * fifty-two.
 *
 * stage.js is a CLI with main() at the bottom, so every case here spawns it.
 *
 * The CONTROL is the third case and it must stay green: an absent duration has to
 * read as "not recorded" and never as zero, or every run committed before
 * 2026-09-01 and every folder assembled by hand acquires a cost of nothing.
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
  const dir = scratchDir('stage-cost-');
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed:\n' + r.stdout + r.stderr);
  return dir;
}
/* Start a stage and put its one declared output in place. Returns the run dir the
 * CLI printed, never a path this file composed — the id is the CLI's to choose. */
function started(town, st = 'S1') {
  const r = run(town, ['new', st]);
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

test('a committed stage records how long it took, and what the caller says it spent', () => {
  const town = newTown();
  const dir = started(town);
  // Reach into the pending record and put the start 92 minutes back. Nothing else
  // can make a measurable duration inside a test that runs in under a second, and
  // the field being writable from outside is exactly what a resumed build needs.
  const m = manifest(town);
  m.stages.S1.pending.startedAt = '2026-09-01T03:35';
  fs.writeFileSync(path.join(town, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');

  const r = commit(town, dir, ['--tokens', '137_000']);
  assert.strictEqual(r.status, 0, 'commit failed:\n' + r.stdout + r.stderr);
  const rec = latestRun(town);
  assert.strictEqual(rec.startedAt, '2026-09-01T03:35');
  assert.ok(rec.elapsedMin >= 90, 'elapsedMin was ' + rec.elapsedMin + ', expected about 92');
  assert.strictEqual(rec.tokens, 137000, 'underscores in --tokens were not stripped');
  assert.match(r.stdout, /137,000 tokens/, 'the cost is not in the commit line:\n' + r.stdout);
});

test('the pending record is cleared, so it cannot lend its clock to the next run', () => {
  const town = newTown();
  const dir = started(town);
  assert.ok(manifest(town).stages.S1.pending, 'new did not record a start at all');
  assert.strictEqual(commit(town, dir).status, 0);
  assert.strictEqual(manifest(town).stages.S1.pending, undefined,
    'the pending record outlived its commit');
});

test('CONTROL: a run folder assembled by hand records no timing, rather than zero', () => {
  const town = newTown();
  // No `new`, so no pending record — which is every run committed before this
  // landed, and every folder a session made with mkdir.
  const dir = path.join(town, 'S1-services', '2026-09-01_9999');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'verified-services.json'), '{"ok":1}\n');
  const r = commit(town, dir);
  assert.strictEqual(r.status, 0, 'commit refused a hand-made folder:\n' + r.stdout + r.stderr);
  const rec = latestRun(town);
  assert.strictEqual(rec.elapsedMin, undefined, 'an unknown duration was recorded as a number');
  assert.strictEqual(rec.startedAt, undefined, 'an unknown start was recorded');
  assert.ok(!/min/.test(r.stdout), 'the commit line claimed a duration it does not have:\n' + r.stdout);
});

test('a pending record naming a DIFFERENT run is not used', () => {
  const town = newTown();
  const dir = started(town);
  const m = manifest(town);
  m.stages.S1.pending = { id: 'SOME-OTHER-RUN', startedAt: '2026-09-01T01:00' };
  fs.writeFileSync(path.join(town, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  assert.strictEqual(commit(town, dir).status, 0);
  assert.strictEqual(latestRun(town).elapsedMin, undefined,
    'an abandoned stage lent its clock to a run that is not its own');
});

test('--tokens with no number is refused rather than recorded as true', () => {
  const town = newTown();
  const dir = started(town);
  const r = commit(town, dir, ['--tokens']);
  // EXIT 2, not 1. `references/conventions.md` says 2 is "the SCRIPT was used
  // wrongly" and 1 is "the thing being checked FAILED"; a valueless --tokens is
  // the first. This asserted 1 until 2026-09-03, when stage.js's `die` moved onto
  // `cli.die` and its five usage sites were separated from its fifteen refusals
  // (OA-232 Tier 2.4). A caller that treats every non-zero as a build failure
  // would otherwise report a typo as a broken map.
  assert.strictEqual(r.status, 2, 'a valueless --tokens was not refused as a usage error:\n' + r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /--tokens must be a non-negative number/);
});
