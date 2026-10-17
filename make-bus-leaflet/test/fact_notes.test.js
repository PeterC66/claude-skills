/*
 * fact_notes — the demand-responsive lines a map's mapNotes take from the register (buses-data OA-437, C4).
 *
 * Held on a three-fact register, because the real one changes: only drt facts with a sheetLine that scope the
 * map, one line per distinct sentence, each tagged so --check can join it back; and --check says missing, drifted
 * and clean in that order.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { factsFor, blockFor, checkConfig } = require('./_engine.js').load('fact_notes.js');

const REG = { facts: [
  { id: 'SF-1', class: 'drt', scope: ['Alpha', 'Beta'], sheetLine: 'Ring-a-Ride: 01 111' },
  { id: 'SF-2', class: 'drt', scope: ['Alpha'], sheetLine: 'Tiger: 02 222' },
  { id: 'SF-3', class: 'drt', scope: ['Beta'], sheetLine: 'Tiger: 02 222' },
  { id: 'SF-4', class: 'other', scope: ['Alpha'], sheetLine: 'not a demand-responsive fact' },
  { id: 'SF-5', class: 'drt', scope: ['Alpha'] },
] };

test('only drt facts with a sheetLine that scope the map are used', () => {
  assert.deepStrictEqual(factsFor(REG, 'Alpha').map(f => f.id), ['SF-1', 'SF-2']);
  assert.deepStrictEqual(factsFor(REG, 'Gamma'), []);
});

test('the block is one searched note: no x, y or at, a heading, and a tagged paragraph per fact', () => {
  const b = blockFor(REG, 'Alpha');
  assert.strictEqual(b.text, 'Also serving Alpha, not on this map:');
  for (const k of ['x', 'y', 'at']) assert.ok(!(k in b), k + ' would make it a hand-placed note');
  assert.deepStrictEqual(b.then.map(p => [p.fact, p.text]), [['SF-1', 'Ring-a-Ride: 01 111'], ['SF-2', 'Tiger: 02 222']]);
});

test('two facts that share a sentence print it once', () => {
  assert.strictEqual(blockFor({ facts: [REG.facts[1], { ...REG.facts[2], scope: ['Alpha'] }] }, 'Alpha').then.length, 1);
});

test('a map no fact scopes has no block, and a heading can be overridden', () => {
  assert.strictEqual(blockFor(REG, 'Gamma'), null);
  assert.strictEqual(blockFor(REG, 'Beta', 'Also in Beta:').text, 'Also in Beta:');
});

test('--check: missing, drifted, then clean', () => {
  assert.strictEqual(checkConfig({ mapNotes: [] }, REG, 'Alpha').length, 2);
  const drift = { mapNotes: [{ text: 'h', then: [{ fact: 'SF-1', text: 'Ring-a-Ride: 01 999' }, { fact: 'SF-2', text: 'Tiger: 02 222' }] }] };
  const p = checkConfig(drift, REG, 'Alpha');
  assert.strictEqual(p.length, 1);
  assert.match(p[0], /SF-1 has drifted/);
  assert.deepStrictEqual(checkConfig({ mapNotes: [blockFor(REG, 'Alpha')] }, REG, 'Alpha'), []);
});

test('a hand-typed line with no tag is not judged', () => {
  const hand = { mapNotes: [{ text: 'Dial-a-Ride, typed by hand' }] };
  assert.strictEqual(checkConfig(hand, { facts: [] }, 'Alpha').length, 0);
});

test('typed notes tagged `fact` carry it when their lines, joined in order, are the sheet line (Ely Co-op)', () => {
  const split = (a, b) => ({ mapNotes: [
    { text: 'Ring-a-Ride:', fact: 'SF-1', x: 140, y: 17.8, handPlaced: 'title band' },
    { text: a, fact: 'SF-1', x: 140, y: 21.6, handPlaced: 'title band' },
    { text: b, fact: 'SF-2', x: 140, y: 25.4, handPlaced: 'title band' },
  ] });
  assert.deepStrictEqual(checkConfig(split('01 111', 'Tiger: 02 222'), REG, 'Alpha'), []);
  const p = checkConfig(split('01 999', 'Tiger: 02 222'), REG, 'Alpha');
  assert.strictEqual(p.length, 1);
  assert.match(p[0], /SF-1 has drifted: the sheet says "Ring-a-Ride: 01 999"/);
});

test('a line in its own words is carried when it says why in factWords, and drifts without one (OA-648, Godmanchester Co-op)', () => {
  const own = (extra) => ({ mapNotes: [
    { text: 'Ring-a-Ride: picked up at home,', fact: 'SF-1', x: 45, y: 156, handPlaced: 'kept' },
    { text: 'ring 01 111', fact: 'SF-1', x: 45, y: 160, handPlaced: 'kept', ...extra },
    { text: 'h', then: [{ fact: 'SF-2', text: 'Tiger: 02 222' }] },
  ] });
  assert.deepStrictEqual(checkConfig(own({ factWords: 'says it is a pickup area' }), REG, 'Alpha'), []);
  for (const bad of [{}, { factWords: ' ' }, { factWords: true }]) {
    const p = checkConfig(own(bad), REG, 'Alpha');
    assert.strictEqual(p.length, 1, JSON.stringify(bad));
    assert.match(p[0], /SF-1 has drifted: .*factWords: "<why>"/);
  }
  const para = (extra) => ({ mapNotes: [{ text: 'h', then: [{ fact: 'SF-1', text: 'Ring-a-Ride, door to door: 01 111', ...extra }, { fact: 'SF-2', text: 'Tiger: 02 222' }] }] });
  assert.deepStrictEqual(checkConfig(para({ factWords: 'door to door' }), REG, 'Alpha'), []);
  assert.strictEqual(checkConfig(para({}), REG, 'Alpha').length, 1);
  // A reason never stands in for a missing line: SF-2 has none here.
  assert.match(checkConfig({ mapNotes: [{ text: 'x', fact: 'SF-1', factWords: 'why' }] }, REG, 'Alpha')[0], /SF-2 is in scope/);
});
