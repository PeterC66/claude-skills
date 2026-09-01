/*
 * redteam_source.js — OA-166: reuse is decided by the SERVICE FACTS, not by when
 * the inputs happened to be pulled.
 *
 * WHAT WENT WRONG, three times, each costing about 100k tokens. The tool asked
 * "has S1 or S2 been re-pulled since this answer was derived?" and treated yes as
 * "the thing being diffed has changed". It is not the same question:
 *
 *   Wisbech, 2026-08-29        a new S1 written only to ADJUDICATE the red team's
 *                              own claim about X46. It said BUY — re-buying a
 *                              blind answer to re-ask a question we had just agreed
 *                              with.
 *   High Wycombe Aldi, 08-29   an S1 re-derived so it would carry frequency fields.
 *                              All 12 services identical on route, operator, days,
 *                              termini and headsigns; only the registration window
 *                              moved, and it LENGTHENED. It said BUY.
 *   Ramsey, 2026-08-31         an S2 that rebuilt routes_paths.json and nothing
 *                              else — drawn geometry, not a service fact. BUY.
 *
 * All three were overridden by hand in a commit note, and all three were right to
 * be. An override that lives in a commit message is not a mechanism, which is the
 * other half of this row: `--reuse-anyway "<reason>"`.
 *
 * redteam_source.js is a CLI with no exports, so every case here spawns it.
 *
 * THE FIXTURE DATES ARE RELATIVE TO TODAY, deliberately. The tool's other rule is
 * a 60-day age window, so a fixture pinned to a literal date would have decided
 * these cases correctly for eight weeks and then started failing for a reason
 * that has nothing to do with what is under test.
 *
 * The two CONTROL tests must stay green. This guard sits in front of the single
 * most expensive thing in the skill, so it has to be shown to PERMIT as well as
 * to refuse — and it has to be shown still to refuse a genuinely stale answer,
 * because a fingerprint that always matches would be worse than the timestamp.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

// tools/prove-red-redteam-fingerprint.js points this at a copy with the OA-166
// changes reverted, so the suite can be watched failing against the code as it
// stood on the three days it was wrong.
const SRC = process.env.REDTEAM_SOURCE_JS
  || path.join(__dirname, '..', 'assets', 'redteam_source.js');

const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/* The smallest thing that is a service to this tool: route, operator, days,
 * termini, headsigns. Everything else a real gtfs-services.json carries is
 * passed in by the caller precisely so a test can prove it does NOT count. */
const svc = (route, operator, days, extra = {}) => Object.assign({
  route, operator, days,
  termini: ['Bus Station', 'High Street'],
  headsigns: ['Town Centre'],
}, extra);

/*
 * A build with two S1 runs and one red-team answer between them:
 *
 *      r1 ............ answer ............ r2
 *   (10d ago)         (5d ago)          (2d ago)
 *
 * so the answer's inputs HAVE been re-pulled since it was derived, which is the
 * precondition for every case here. Whether that re-pull moved anything is the
 * only variable, and it is what `then`/`now` say.
 */
function estate(opts = {}) {
  const root = scratchDir('redteam-fp-');
  const dir = path.join(root, 'Testton');
  const runs = [{ id: 'r1', at: day(10) }];
  // A second S1 run exists exactly when the case describes a `now` side — including
  // `now: null`, which is the case where the run exists and carries no services file.
  if ('now' in opts) runs.push({ id: 'r2', at: day(2) });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    town: 'Testton',
    stages: {
      S1: { latest: runs[runs.length - 1].id, runs: runs.map(r => ({ id: r.id, dir: 'S1-services/' + r.id, at: r.at + 'T09:00' })) },
      S2: { latest: 'g1', runs: [{ id: 'g1', dir: 'S2-geometry/g1', at: day(10) + 'T09:00' }] },
    },
  }, null, 1));
  for (const [id, services] of [['r1', opts.then], ['r2', opts.now]]) {
    if (!services) continue;
    const rd = path.join(dir, 'S1-services', id);
    fs.mkdirSync(rd, { recursive: true });
    fs.writeFileSync(path.join(rd, 'gtfs-services.json'),
      JSON.stringify({ town: 'Testton', services }, null, 1));
  }
  const runId = day(opts.answerAgeDays === undefined ? 5 : opts.answerAgeDays) + '_1000';
  const answerDir = path.join(dir, 'S6-verify', runId);
  fs.mkdirSync(answerDir, { recursive: true });
  fs.writeFileSync(path.join(answerDir, 'redteam.json'), JSON.stringify({
    derivedAt: day(opts.answerAgeDays === undefined ? 5 : opts.answerAgeDays),
    services: [{ ref: '1' }, { ref: '2' }],
  }));
  return { root, build: dir, answerDir };
}

function run(cwd, args = []) {
  const r = spawnSync(process.execPath, [SRC, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// Every case stands in a FRESH S6 run dir inside the build, which is the
// documented cwd and keeps the OA-141 ambiguity guard out of the way.
function freshRun(build) {
  const d = path.join(build, 'S6-verify', day(0) + '_1200');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const TWO = [svc('1', 'Whippet', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Daily')];

test('CONTROL: an answer whose S1 has not moved at all is reused', () => {
  const e = estate({ then: TWO });                       // one S1 run, nothing after it
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0, `expected REUSE (0), got ${r.code}\n${r.out}`);
  assert.match(r.out, /REUSE/);
});

test('CONTROL: an answer past the age window is still bought', () => {
  const e = estate({ then: TWO, answerAgeDays: 400 });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 10, `expected BUY (10), got ${r.code}\n${r.out}`);
  assert.match(r.out, /day window/, 'the age window is what should have bought it:\n' + r.out);
});

test('an S1 re-pull that moved no service fact is reused, not re-bought', () => {
  const e = estate({ then: TWO, now: TWO });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0,
    `the inputs were re-pulled and nothing about the answer changed, and it still bought (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /UNCHANGED/);
  assert.match(r.out, /service facts\s+: gtfs-services\.json/);
});

test('a lengthened registration window and a new frequency field are not service facts', () => {
  // Exactly the High Wycombe Aldi case: OA-158 re-derived the file to carry
  // frequency, and the windows moved OUT rather than in, so nothing expires sooner.
  const before = [svc('1', 'Whippet', 'Mon-Sat', { validFrom: '20260721', validTo: '20270421' })];
  const after = [svc('1', 'Whippet', 'Mon-Sat', { validFrom: '20260803', validTo: '20270503', tripsAtTownPerWeekSample: 42 })];
  const e = estate({ then: before, now: after });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0, `a registration window bought a red team (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /UNCHANGED/);
});

test('a changed operator IS a service fact, and the BUY names both S1 runs', () => {
  const e = estate({ then: TWO, now: [svc('1', 'Stagecoach East', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Daily')] });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 10, `expected BUY (10), got ${r.code}\n${r.out}`);
  assert.match(r.out, /CHANGED/);
  assert.match(r.out, /service facts moved between S1 r1 and S1 r2/,
    'the BUY has to name what moved and where, or it is the timestamp rule wearing a new message:\n' + r.out);
});

test('with no services file on either side it says CANNOT TELL and falls back', () => {
  // An absent fingerprint must read as "cannot tell", never as "unchanged" —
  // the expensive answer is the safe one, and the output has to say which rule ran.
  const e = estate({ then: null, now: null });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.match(r.out, /CANNOT TELL/, 'it did not say it was guessing:\n' + r.out);
  assert.match(r.out, /falling back to the S1\/S2 pull timestamp/);
  assert.strictEqual(r.code, 10, `a fingerprint it could not take must not become a REUSE (exit ${r.code}):\n${r.out}`);
});

test('--reuse-anyway overrides a BUY, and the stamp travels with the run', () => {
  const e = estate({ then: TWO, now: [svc('1', 'Stagecoach East', 'Mon-Sat')] });
  const into = freshRun(e.build);
  const r = run(into, ['--build', e.build, '--reuse-anyway', 'the operator change is a rebrand, not a new service']);
  assert.strictEqual(r.code, 0, `--reuse-anyway did not lift the BUY (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /REUSE ANYWAY/);
  assert.match(r.out, /service facts moved between S1 r1 and S1 r2/,
    'an override that hides what it overrode is a bypass:\n' + r.out);
  const j = JSON.parse(fs.readFileSync(path.join(into, 'redteam.json'), 'utf8'));
  assert.match(j._reuseOverride.reason, /rebrand/);
  assert.strictEqual(j._reuseOverride.overrode.length, 1);
  // ...and never into the answer in its own build.
  const own = JSON.parse(fs.readFileSync(path.join(e.answerDir, 'redteam.json'), 'utf8'));
  assert.strictEqual(own._reuseOverride, undefined, 'it stamped the original answer, not the copy');
});

test('--reuse-anyway with no reason is refused', () => {
  const e = estate({ then: TWO, now: [svc('1', 'Stagecoach East', 'Mon-Sat')] });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build, '--reuse-anyway']);
  assert.strictEqual(r.code, 2, `a blank override was accepted (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /needs a reason/);
});
