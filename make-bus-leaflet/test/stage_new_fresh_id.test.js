/*
 * stage.js `new` — never hand back a run folder that already exists.
 *
 * A run id is the LOCAL minute (`ts()`), so two `new` calls on the same stage inside
 * one minute used to compute the same id, `mkdirSync(..., { recursive: true })`
 * accepted the folder that was already there, and `new` set `pending` on it. On
 * 2026-09-30 that handed a Godmanchester Co-op Ermine Street build the ALREADY-
 * COMMITTED `S3-config/2026-09-30_0032` (buses-data loop run 2026-09-30_0015-adhoc):
 * whatever the caller wrote next would have landed in a folder the manifest says is
 * finished. Nothing was overwritten only because the session noticed and waited.
 *
 * `new` now moves on to the next free minute. The id keeps its `YYYY-MM-DD_HHMM`
 * shape because prune_runs.py, ink_review.mjs and stage_refresh.mjs all anchor on
 * it; the true start is still `pending.startedAt`, in UTC.
 *
 * Both cases run their two calls milliseconds apart, so they are inside one minute
 * on all but one run in thousands — and on that run they pass for the wrong reason
 * rather than fail, which cannot hide the defect for long.
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
  const dir = scratchDir('stage-fresh-id-');
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed:\n' + r.stdout + r.stderr);
  return dir;
}
function started(town, st = 'S1') {
  const r = run(town, ['new', st]);
  assert.strictEqual(r.status, 0, 'new failed:\n' + r.stdout + r.stderr);
  return r.stdout.trim().split('\n').pop().trim();
}

test('new straight after a commit does not reopen the committed run folder', () => {
  const town = newTown();
  const first = started(town);
  fs.writeFileSync(path.join(first, 'verified-services.json'), '{"ok":1}\n');
  const c = run(town, ['commit', 'S1', first, '--outputs', 'verified-services.json']);
  assert.strictEqual(c.status, 0, 'commit failed:\n' + c.stdout + c.stderr);
  const committedId = manifest(town).stages.S1.latest;

  const second = started(town);
  assert.notStrictEqual(path.resolve(second), path.resolve(first),
    'new returned the folder of committed run ' + committedId);
  const m = manifest(town).stages.S1;
  assert.notStrictEqual(m.pending.id, committedId, 'pending was set on the committed run');
  assert.match(m.pending.id, /^\d{4}-\d{2}-\d{2}_\d{4}$/, 'the fresh id lost the YYYY-MM-DD_HHMM shape');
  assert.ok(m.pending.id > committedId, 'the fresh id ' + m.pending.id + ' does not sort after ' + committedId);
  assert.deepStrictEqual(fs.readdirSync(second), [], 'the fresh run folder is not empty');
});

test('two new calls in a row get two folders, so an abandoned start is not reused either', () => {
  const town = newTown();
  const first = started(town, 'S2');
  fs.writeFileSync(path.join(first, 'left-behind.txt'), 'from the abandoned start\n');
  const second = started(town, 'S2');
  assert.notStrictEqual(path.resolve(second), path.resolve(first), 'new reused the abandoned folder');
  assert.ok(!fs.existsSync(path.join(second, 'left-behind.txt')), 'the abandoned start\'s file is in the new run');
  assert.strictEqual(manifest(town).stages.S2.pending.id, path.basename(second));
});
