'use strict';
/*
 * poi_tiers_sync.js — the pure half: normalise, compare, merge, and the one
 * pre-tier cull the compare must know about (buses-data OA-233).
 *
 * From make-bus-leaflet/:  node --test test/poi_tiers_sync.test.js
 *
 * Nothing here touches a portal or a town folder; the fetch and the S3 write are
 * exercised by hand against a town (the header of the script says how) and by
 * bus-work's prove-red-landmark-answers.mjs, which drives the worklist wire.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const S = require(path.join(__dirname, '..', 'assets', 'poi_tiers_sync.js'));

test('a bare string and an object with no `as` are the same rule, and denorm gives the string back', () => {
  assert.deepStrictEqual(S.normRule('must'), { tier: 'must', as: null });
  assert.deepStrictEqual(S.normRule({ tier: 'must' }), { tier: 'must', as: null });
  assert.deepStrictEqual(S.normRule({ tier: 'may', as: 'The Hive' }), { tier: 'may', as: 'The Hive' });
  assert.strictEqual(S.denormRule({ tier: 'miss', as: null }), 'miss');
  assert.deepStrictEqual(S.denormRule({ tier: 'may', as: 'X' }), { tier: 'may', as: 'X' });
});

test('compare: added, changed, same, sourceOnly — and a bare-string source equals an object portal answer', () => {
  const source = { 'community:The Hive': 'must', 'shop:Asda': 'must', 'community:B': { tier: 'may', as: 'Bee' } };
  const portal = { 'shop:Asda': { tier: 'may' }, 'community:B': { tier: 'may', as: 'Bee' }, 'school:New': { tier: 'must' } };
  const c = S.compareTiers(source, portal, {});
  assert.deepStrictEqual(c.added, ['school:New']);
  assert.deepStrictEqual(c.changed.map((x) => x.key), ['shop:Asda']);
  assert.deepStrictEqual(c.changed[0].from, { tier: 'must', as: null });
  assert.deepStrictEqual(c.changed[0].to, { tier: 'may', as: null });
  assert.deepStrictEqual(c.same, ['community:B']);
  assert.deepStrictEqual(c.sourceOnly, ['community:The Hive']);
  assert.strictEqual(c.owed, true);
});

test('compare: a source that already carries the answer is owed nothing', () => {
  const block = { 'a:A': 'must', 'b:B': { tier: 'may', as: 'Bee' } };
  const c = S.compareTiers(block, { 'a:A': { tier: 'must' }, 'b:B': { tier: 'may', as: 'Bee' } }, {});
  assert.strictEqual(c.owed, false);
  assert.deepStrictEqual(c.added, []);
  assert.deepStrictEqual(c.changed, []);
});

test('an `as` that differs is a change even when the tier agrees — a rename is part of the answer', () => {
  const c = S.compareTiers({ 'b:B': { tier: 'may', as: 'Old' } }, { 'b:B': { tier: 'may', as: 'New' } }, {});
  assert.strictEqual(c.changed.length, 1);
  assert.strictEqual(c.owed, true);
});

test('industrial keys are UNREACHABLE under industrialKeep "none" and reachable otherwise', () => {
  const portal = { 'industrial:Cressex': { tier: 'miss' }, 'shop:Asda': { tier: 'must' } };
  assert.deepStrictEqual(S.unreachableKeys(portal, { industrialKeep: 'none' }), ['industrial:Cressex']);
  assert.deepStrictEqual(S.unreachableKeys(portal, { industrialKeep: 'named' }), []);
  assert.deepStrictEqual(S.unreachableKeys(portal, {}), []);
  const none = S.compareTiers({}, portal, { industrialKeep: 'none' });
  assert.deepStrictEqual(none.added, ['shop:Asda']);
  assert.deepStrictEqual(none.unreachable, ['industrial:Cressex']);
  const named = S.compareTiers({}, portal, { industrialKeep: 'named' });
  assert.deepStrictEqual(named.added.sort(), ['industrial:Cressex', 'shop:Asda']);
  assert.deepStrictEqual(named.unreachable, []);
});

test('an unreachable key alone is owed nothing — the row a worklist could never clear', () => {
  const c = S.compareTiers({}, { 'industrial:Only': { tier: 'miss' } }, { industrialKeep: 'none' });
  assert.strictEqual(c.owed, false);
});

test('merge keeps source-only keys, takes the portal on conflict, skips unreachable, sorts, and writes routes.json spelling', () => {
  const source = { 'community:The Hive': 'must', 'shop:Asda': 'must' };
  const portal = { 'shop:Asda': { tier: 'may' }, 'school:New': { tier: 'must', as: 'New School' }, 'industrial:X': { tier: 'miss' } };
  const m = S.mergeTiers(source, portal, { industrialKeep: 'none' });
  assert.deepStrictEqual(Object.keys(m), ['community:The Hive', 'school:New', 'shop:Asda']);
  assert.strictEqual(m['community:The Hive'], 'must');
  assert.strictEqual(m['shop:Asda'], 'may');
  assert.deepStrictEqual(m['school:New'], { tier: 'must', as: 'New School' });
  assert.ok(!('industrial:X' in m));
});

test('the town -> map rule: one AREA map by name, case-insensitively; none or two is a refusal', () => {
  const maps = [
    { id: 3, kind: 'area', name: 'High Wycombe' },
    { id: 11, kind: 'place', name: 'High Wycombe Aldi' },
    { id: 4, kind: 'area', name: 'Huntingdon' },
  ];
  assert.strictEqual(S.findPortalMap(maps, 'high wycombe').map.id, 3);
  assert.strictEqual(S.findPortalMap(maps, 'Ely').map, null);
  assert.strictEqual(S.findPortalMap(maps, 'Ely').hits.length, 0);
  const two = S.findPortalMap([...maps, { id: 9, kind: 'area', name: 'Huntingdon' }], 'Huntingdon');
  assert.strictEqual(two.map, null);
  assert.strictEqual(two.hits.length, 2);
});

test('requiring the module draws nothing and fetches nothing — the dark-file rule', () => {
  // The CLI sits behind require.main === module; the require above is the test.
  assert.strictEqual(typeof S.fetchPortalBlock, 'function');
  assert.strictEqual(typeof S.compareTiers, 'function');
});
