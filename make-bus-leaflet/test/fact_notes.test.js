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
