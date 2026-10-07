/*
 * redteam_source.js — buses-data OA-575, item A2 of the 2026-10-06 review: a move
 * TOWARD the stored blind answer does not re-buy it, and a move against it does.
 *
 * tools/prove-red-redteam-toward.js runs this file against a copy with the rule
 * reverted (every move buys, and our own file's operator and days are not asked)
 * and names which cases must go red and which must stay green.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { svc, estate, run, freshRun } = require('./redteam_fixture');

const TWO = [svc('1', 'Whippet', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Daily')];
const TWO_PLUS_DECIDED = TWO.concat([svc('DIAL-A-RIDE', 'FACT Community Transport', 'Mon-Fri')]);

/* ---------------------------------------------------------------------------
 * MOVED TOWARD THE ANSWER (buses-data OA-575, A2 of the 2026-10-06 review).
 *
 * The answer below is what a blind red team would write for TWO after the
 * operator of route 1 changed hands and route 55 dropped its Sunday service.
 * A move of ours that lands ON those values cannot have staled it; a move
 * that lands anywhere else may have, and must buy. Each "against" case is the
 * prove-red half of its "toward" twin: same fixture, one string different.
 */
const ANSWER = [
  { route: '1', operator: 'Stagecoach East', days: 'Mon-Sat', servesTown: true },
  { route: '55', operator: 'Stagecoach East', days: 'Mon-Sat only', servesTown: true },
];

test('a days string that moved TO the answer is reused (OA-575)', () => {
  const e = estate({ then: TWO, now: [svc('1', 'Whippet', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Mon-Sat')], answer: ANSWER });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0, `a move onto the answer's own value bought an answer (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /CHANGED/, 'the fingerprint must still say it moved:\n' + r.out);
  assert.match(r.out, /toward the answer/);
});

test('a days string that moved AWAY from the answer still buys (OA-575 prove-red)', () => {
  const e = estate({ then: TWO, now: [svc('1', 'Whippet', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Mon-Fri')], answer: ANSWER });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 10, `a day string moved against the answer and it reused (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /not toward it\s+: route 55 now days "Mon-Fri", and the answer says days "Mon-Sat only"/,
    'the BUY has to name the value and what the answer says instead:\n' + r.out);
});

test('an operator that moved to the answer is reused; one that moved elsewhere buys (OA-575)', () => {
  const toward = estate({ then: TWO, now: [svc('1', 'Stagecoach East', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Daily')],
    answer: [{ route: '1', operator: 'Stagecoach', days: 'Mon-Sat' }, { route: '55', operator: 'Stagecoach East', days: 'Daily' }] });
  const a = run(freshRun(toward.build), ['--dry-run', '--build', toward.build]);
  assert.strictEqual(a.code, 0, `operator moved onto the answer and it bought (exit ${a.code}):\n${a.out}`);
  const away = estate({ then: TWO, now: [svc('1', 'Dews Coaches', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Daily')],
    answer: [{ route: '1', operator: 'Stagecoach', days: 'Mon-Sat' }, { route: '55', operator: 'Stagecoach East', days: 'Daily' }] });
  const b = run(freshRun(away.build), ['--dry-run', '--build', away.build]);
  assert.strictEqual(b.code, 10, `operator moved away from the answer and it reused (exit ${b.code}):\n${b.out}`);
});

test('agreement licenses operator and days ONLY — a terminus riding along buys (OA-575)', () => {
  const e = estate({ then: TWO,
    now: [svc('1', 'Stagecoach East', 'Mon-Sat', { termini: ['Bus Station', 'Hospital'] }), svc('55', 'Stagecoach East', 'Daily')],
    answer: ANSWER });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 10, `a terminus moved with the operator and it reused (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /moved termini, which agreement cannot license/);
});

test('a route the answer does not mention cannot agree, and a qualified day is not agreement (OA-575)', () => {
  const missing = estate({ then: TWO, now: [svc('1', 'Stagecoach East', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Daily')],
    answer: [{ route: '55', operator: 'Stagecoach East', days: 'Daily' }] });
  const a = run(freshRun(missing.build), ['--dry-run', '--build', missing.build]);
  assert.strictEqual(a.code, 10, `agreement with an entry that does not exist (exit ${a.code}):\n${a.out}`);
  assert.match(a.out, /no entry for route 1/);
  const qualified = estate({ then: TWO, now: [svc('1', 'Whippet', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Mon-Sat')],
    answer: [{ route: '1', operator: 'Whippet', days: 'Mon-Sat' }, { route: '55', operator: 'Stagecoach East', days: 'Mon-Sat (possibly limited Sun)' }] });
  const b = run(freshRun(qualified.build), ['--dry-run', '--build', qualified.build]);
  assert.strictEqual(b.code, 10, `a qualified day string was read as agreement (exit ${b.code}):\n${b.out}`);
});

/* THE HOLE THIS ROW FOUND. refresh_town.py's S1 carries the patched
 * verified-services.json and no feed derivation, so OA-332's in-force rule
 * compared the old gtfs-services.json with itself. Before OA-575 the
 * "against" case below printed UNCHANGED and reused. */
test('a SAFE refresh S1 that moved a day string AGAINST the answer buys (OA-575 prove-red)', () => {
  const e = estate({ then: TWO, thenVerified: TWO, now: null,
    nowVerified: [svc('1', 'Whippet', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Mon-Fri')], answer: ANSWER });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 10, `the refresh moved route 55 to Mon-Fri, the answer says Mon-Sat, and it reused (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /ours, not toward it: route 55 now days "Mon-Fri"/);
});

test('a SAFE refresh S1 that moved a day string TO the answer is reused (OA-575)', () => {
  const e = estate({ then: TWO, thenVerified: TWO, now: null,
    nowVerified: [svc('1', 'Whippet', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Mon-Sat')], answer: ANSWER });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0, `the refresh moved onto the answer's value and it bought (exit ${r.code}):\n${r.out}`);
});

test('a decided include in our file is still our reply, not a move (OA-332 under OA-575)', () => {
  // The added DIAL-A-RIDE row is in no answer; the ours-check ignores added rows.
  const e = estate({ then: TWO, now: null, thenVerified: TWO, nowVerified: TWO_PLUS_DECIDED, answer: ANSWER });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0, `a decided include bought an answer (exit ${r.code}):\n${r.out}`);
});
