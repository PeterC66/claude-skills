/*
 * redteam_rejected.test.js — `routes.json redteamRejected[]` read by claim
 * (buses-data OA-654). The S6 end of it, a terminus HARD becoming a SOFT on a
 * real run, is case 6 of tools/prove-s6-checks.js; this file holds the rules.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_engine');

const { readRejections, rejectionFor, terminiCovered, claimKey, terminusVerdict, uncontestedText } = load('redteam_rejected.js');

const GOOD = { route: '65', decidedOn: '2026-10-22', decidedBy: 'Peter', why: 'checked' };
const TERM = { ...GOOD, claim: 'terminus', termini: ['Nowhere In Particular', 'Elsewhere'] };

test('an entry with no claim is a serves-town rejection, as every entry before OA-654 was', () => {
  const { byKey, bad } = readRejections([GOOD]);
  assert.deepStrictEqual(bad, []);
  assert.ok(rejectionFor(byKey, '65', 'serves-town', '2026-10-22'));
  assert.strictEqual(rejectionFor(byKey, '65', 'terminus', '2026-10-22'), null);
});

test('a terminus rejection answers a terminus claim and never a serves-town one', () => {
  const { byKey } = readRejections([TERM]);
  assert.ok(rejectionFor(byKey, '65', 'terminus', '2026-10-22'));
  assert.strictEqual(rejectionFor(byKey, '65', 'serves-town', '2026-10-22'), null);
});

test('both kinds for one route are kept apart', () => {
  const { byKey } = readRejections([GOOD, TERM]);
  assert.strictEqual(byKey.size, 2);
  assert.notStrictEqual(claimKey('65', 'terminus'), claimKey('65', 'serves-town'));
});

test('a terminus entry with no termini silences nothing, and says what it lacks', () => {
  const { byKey, bad } = readRejections([{ ...GOOD, claim: 'terminus' }]);
  assert.strictEqual(byKey.size, 0);
  assert.deepStrictEqual(bad, [{ route: '65', claim: 'terminus', missing: ['termini'] }]);
});

test('an entry with no reason silences nothing, whatever its claim', () => {
  const { why, ...noWhy } = TERM;
  const { byKey, bad } = readRejections([noWhy]);
  assert.strictEqual(byKey.size, 0);
  assert.deepStrictEqual(bad[0].missing, ['why']);
});

test('a claim S6 does not know silences nothing', () => {
  const { byKey, bad } = readRejections([{ ...GOOD, claim: 'operator' }]);
  assert.strictEqual(byKey.size, 0);
  assert.strictEqual(bad[0].unknownClaim, true);
});

test('a recheckBy in the past is expired', () => {
  const { byKey } = readRejections([{ ...TERM, recheckBy: '2026-10-01' }]);
  assert.strictEqual(rejectionFor(byKey, '65', 'terminus', '2026-10-22').expired, true);
  assert.strictEqual(rejectionFor(byKey, '65', 'terminus', '2026-09-30').expired, false);
});

test('the entry must name every red-team terminus the claim gives, folded for case and punctuation', () => {
  assert.strictEqual(terminiCovered(TERM, ['nowhere in particular', 'ELSEWHERE.']), true);
  assert.strictEqual(terminiCovered(TERM, ['Nowhere In Particular']), true);
  assert.strictEqual(terminiCovered(TERM, ['Nowhere In Particular', 'Somewhere New']), false);
  assert.strictEqual(terminiCovered(TERM, []), false);
});

test('an honoured terminus rejection is a SOFT that carries the adjudication, never silence', () => {
  const { byKey } = readRejections([TERM]);
  const t = terminusVerdict(byKey, '65', TERM.termini, 'Route 65: NEITHER red-team terminus.', '2026-10-22');
  assert.strictEqual(t.severity, 'soft');
  assert.strictEqual(t.category, 'redteam-rejected');
  assert.match(t.text, /^Route 65: NEITHER .* REJECTED on 2026-10-22 by Peter: checked/);
  assert.strictEqual(t.key, claimKey('65', 'terminus'));
});

test('an expired one keeps the finding at its own severity and names the date', () => {
  const { byKey } = readRejections([{ ...TERM, recheckBy: '2026-10-01' }]);
  const t = terminusVerdict(byKey, '65', TERM.termini, 'Route 65.', '2026-10-22');
  assert.strictEqual(t.severity, null);
  assert.strictEqual(t.category, 'terminus');
  assert.match(t.text, /re-checked by 2026-10-01/);
});

test('no entry, or one naming other termini, leaves the finding as it was', () => {
  assert.strictEqual(terminusVerdict(readRejections([]).byKey, '65', TERM.termini, 'x', '2026-10-22'), null);
  assert.strictEqual(terminusVerdict(readRejections([TERM]).byKey, '65', ['Somewhere New'], 'x', '2026-10-22'), null);
});

test('the stale wording says which claim nobody made', () => {
  assert.match(uncontestedText(TERM), /that route 65 ends at Nowhere In Particular, Elsewhere/);
  assert.match(uncontestedText(GOOD), /that route 65 does not serve the town/);
});
