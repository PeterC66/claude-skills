/*
 * An S6 red-team answer must carry the decision that put it there (OA-427).
 *
 * `redteam_budget.js` counts a month's red-team spend from the
 * `redteam-source.json` records `redteam_source.js` writes, and from nothing
 * else. Until this, the ration could be evaded by not running the tool: spawn
 * the agent, commit the S6, and the purchase never reached the count. Two
 * halves close it, and each is asserted here:
 *
 *   stage.js commit S6   refuses a redteam.json with no decision beside it, or
 *                        beside a WAIT — the month said no and it was bought anyway.
 *   redteam_source.js    decides a run dir ONCE. Without that, the refusal's
 *                        natural remedy — run the tool after the answer is in
 *                        place — finds the run dir's own answer on disk and
 *                        records a free REUSE of what was just paid for.
 *
 * Both are CLIs with main() at the bottom, so every case spawns them.
 *
 * CONTROL means "green whether or not the guard is present": an S6 with no
 * answer at all (sanity-only mode, and what a rationed month looks like), an
 * answer with a BUY or REUSE record, a WAIT with no answer deciding afresh, and
 * a fresh run dir deciding normally. A guard only ever seen to refuse has not
 * been shown to permit, and this one sits in front of every S6 in the estate.
 * tools/prove-red-stage-s6-decision.js cuts each half out of a copy and requires
 * its own tests to go red while every CONTROL holds.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');
const SOURCE = process.env.REDTEAM_SOURCE_JS || path.join(__dirname, '..', 'assets', 'redteam_source.js');
const REC = 'redteam-source.json';
const ANSWER = JSON.stringify({ derivedAt: '2026-09-20', services: [{ ref: '1' }] });

function newMap(label) {
  const dir = scratchDir(label);
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}

/* An S6 run dir holding a report, and optionally an answer and a decision. */
function s6Run(map, id, { answer, decision } = {}) {
  const d = path.join(map, 'S6-verify', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'verification.json'), '{}');
  if (answer) fs.writeFileSync(path.join(d, 'redteam.json'), ANSWER);
  if (decision !== undefined) fs.writeFileSync(path.join(d, REC),
    typeof decision === 'string' && !/^[A-Z]+$/.test(decision) ? decision
      : JSON.stringify({ schema: 1, decision, at: '2026-09-23', why: 'test' }));
  return d;
}

function commitS6(map, runDir, extra = []) {
  const r = spawnSync(process.execPath, [STAGE, 'commit', 'S6', runDir, '--outputs', 'verification.json', ...extra],
    { cwd: map, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function source(runDir, args = []) {
  const r = spawnSync(process.execPath, [SOURCE, ...args], { cwd: runDir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const latestS6 = (map) => JSON.parse(fs.readFileSync(path.join(map, 'manifest.json'), 'utf8')).stages.S6.latest || null;
const read = (f) => fs.readFileSync(f, 'utf8');

// ---- stage.js commit S6 -----------------------------------------------------

test('CONTROL: an S6 with no red-team answer at all commits', () => {
  const map = newMap('s6dec-none-');
  const run = s6Run(map, '2026-09-23_1000');
  const r = commitS6(map, run);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(latestS6(map), '2026-09-23_1000');
});

test('CONTROL: an answer with a BUY record commits', () => {
  const map = newMap('s6dec-buy-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true, decision: 'BUY' });
  const r = commitS6(map, run);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(latestS6(map), '2026-09-23_1000');
});

test('CONTROL: an answer with a REUSE record commits', () => {
  const map = newMap('s6dec-reuse-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true, decision: 'REUSE' });
  const r = commitS6(map, run);
  assert.strictEqual(r.code, 0, r.out);
});

test('an answer with no decision record is refused, and the manifest is not moved', () => {
  const map = newMap('s6dec-bare-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true });
  const r = commitS6(map, run);
  assert.notStrictEqual(r.code, 0, 'an unrecorded purchase was committed:\n' + r.out);
  assert.match(r.out, /redteam-source\.json/);
  assert.match(r.out, /--already-bought/, 'the refusal does not name the remedy:\n' + r.out);
  assert.strictEqual(latestS6(map), null, 'the refused run was recorded anyway');
});

test('an answer beside a WAIT record is refused — it was bought against the ration', () => {
  const map = newMap('s6dec-wait-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true, decision: 'WAIT' });
  const r = commitS6(map, run);
  assert.notStrictEqual(r.code, 0, 'an answer bought after a WAIT was committed:\n' + r.out);
  assert.match(r.out, /WAIT/);
});

test('an answer beside an unreadable record is refused', () => {
  const map = newMap('s6dec-junk-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true, decision: 'not json {' });
  const r = commitS6(map, run);
  assert.notStrictEqual(r.code, 0, 'a record nobody can read was accepted:\n' + r.out);
});

test('--force-decision commits the bare answer, and says so', () => {
  const map = newMap('s6dec-force-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true });
  const r = commitS6(map, run, ['--force-decision']);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /WARNING: committing an S6 whose red-team answer has no decision/);
});

// ---- redteam_source.js decides a run dir once -------------------------------

test('an answer already in the run dir with no record is refused, and nothing is written', () => {
  const map = newMap('s6dec-src-bare-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true });
  const r = source(run);
  assert.strictEqual(r.code, 2, 'it decided over an unaccounted answer:\n' + r.out);
  assert.ok(!fs.existsSync(path.join(run, REC)), 'a decision was recorded for an answer nobody decided to buy');
  assert.strictEqual(read(path.join(run, 'redteam.json')), ANSWER, 'the answer was touched');
});

test('--already-bought records the answer as a BUY and leaves it untouched, and the commit then passes', () => {
  const map = newMap('s6dec-src-already-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true });
  const r = source(run, ['--already-bought', 'spawned before the refusal existed']);
  assert.strictEqual(r.code, 10, r.out);
  const rec = JSON.parse(read(path.join(run, REC)));
  assert.strictEqual(rec.decision, 'BUY');
  assert.strictEqual(rec.alreadyBought, true);
  assert.match(rec.why, /spawned before the refusal existed/);
  assert.strictEqual(read(path.join(run, 'redteam.json')), ANSWER, 'the answer was touched');
  assert.strictEqual(commitS6(map, run).code, 0, 'the commit still refused a recorded buy');
});

test('a run dir already decided BUY is not decided again', () => {
  const map = newMap('s6dec-src-buy-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true, decision: 'BUY' });
  const before = read(path.join(run, REC));
  const r = source(run);
  assert.strictEqual(r.code, 10, r.out);
  assert.match(r.out, /ALREADY DECIDED/);
  assert.strictEqual(read(path.join(run, REC)), before, 'the BUY record was rewritten — the month under-counts');
});

test('a run dir already decided REUSE is not decided again', () => {
  const map = newMap('s6dec-src-reuse-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true, decision: 'REUSE' });
  const before = read(path.join(run, REC));
  const r = source(run);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(read(path.join(run, REC)), before);
});

test('an answer beside a WAIT record is refused by the tool too', () => {
  const map = newMap('s6dec-src-wait-');
  const run = s6Run(map, '2026-09-23_1000', { answer: true, decision: 'WAIT' });
  const r = source(run);
  assert.strictEqual(r.code, 2, r.out);
});

test('CONTROL: a WAIT with no answer decides afresh — the month may have turned', () => {
  const map = newMap('s6dec-src-rewait-');
  const run = s6Run(map, '2026-09-23_1000', { decision: 'WAIT' });
  const r = source(run);
  assert.strictEqual(r.code, 10, 'expected a fresh BUY (no budget stated here):\n' + r.out);
  assert.strictEqual(JSON.parse(read(path.join(run, REC))).decision, 'BUY');
});

test('CONTROL: a fresh run dir beside an older answer decides and records it', () => {
  const map = newMap('s6dec-src-fresh-');
  s6Run(map, '2026-09-20_0900', { answer: true, decision: 'BUY' });
  const run = s6Run(map, '2026-09-23_1000');
  const r = source(run);
  assert.ok(r.code === 0 || r.code === 10, `expected a decision, got ${r.code}:\n${r.out}`);
  assert.ok(fs.existsSync(path.join(run, REC)), 'no decision was recorded');
});
