'use strict';
/*
 * poi_shortlist_import.js — reply text to tiers (buses-data OA-568, slice 3).
 *
 * From make-bus-leaflet/:  node --test test/poi_shortlist_import.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const I = require('./_engine.js').load('poi_shortlist_import.js');

const list = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, key: 'shop:P' + (i + 1) }));

test('the plain two-list reply', () => {
  assert.deepStrictEqual(I.parseReply('Must show: 3, 7, 12. Drop: 5, 9.'), { must: [3, 7, 12], drop: [5, 9] });
});

test('ranges, "and", other words and capitals', () => {
  const r = I.interpret(list, 'KEEP 2 and 4-6\nPlease remove: 9 - 10, 12');
  assert.deepStrictEqual(r.must.map(x => x.n), [2, 4, 5, 6]);
  assert.deepStrictEqual(r.drop.map(x => x.n), [9, 10, 12]);
});

test('a reply with only one list is fine; one with neither parses to nothing', () => {
  assert.deepStrictEqual(I.parseReply('Drop: 5'), { must: [], drop: [5] });
  assert.deepStrictEqual(I.parseReply('thanks, looks lovely'), { must: [], drop: [] });
});

test('must becomes must, drop becomes miss, and unmarked places are not mentioned', () => {
  const r = I.interpret(list, 'Must show: 3. Drop: 5');
  assert.deepStrictEqual(r.tiers, { 'shop:P3': 'must', 'shop:P5': 'miss' });
});

test('a number the list does not have is reported and skipped', () => {
  const r = I.interpret(list, 'Must show: 3, 99');
  assert.deepStrictEqual(r.tiers, { 'shop:P3': 'must' });
  assert.deepStrictEqual(r.unknown, [99]);
});

test('a number on both lists is refused, not guessed', () => {
  const r = I.interpret(list, 'Must show: 3, 4. Drop: 4');
  assert.deepStrictEqual(r.conflict, [4]);
  assert.deepStrictEqual(r.tiers, { 'shop:P3': 'must' });
});

test('more than a dozen must-show marks warns and still imports them', () => {
  const r = I.interpret(list, 'Must show: 1-' + (I.MUST_WARN + 1));
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(Object.keys(r.tiers).length, I.MUST_WARN + 1);
  assert.strictEqual(I.interpret(list, 'Must show: 1-' + I.MUST_WARN).warnings.length, 0);
});

test('the report names every place it understood', () => {
  const t = I.report(I.interpret(list, 'Must show: 3. Drop: 5, 99'));
  assert.match(t, /1 must show, 1 drop/);
  assert.match(t, /shop:P3/);
  assert.match(t, /NOT ON THE LIST, skipped: 99/);
});
