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

// Through _engine.js, never a direct path: a prove-red scratch copy of assets/ is
// what must run here, or this suite is green about code it never loaded (the rule
// engine_indirection.test.js enforces — and its census did not see the
// path.join form this file first used, which is why that census now looks for it).
const S = require('./_engine.js').load('poi_tiers_sync.js');

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

test('a portal answer with NO `as` keeps the source’s rename — an absent rename is no opinion, not a removal (found live, 2026-09-05)', () => {
  const source = { 'community:Bellfield': { tier: 'may', as: 'Bellfield House Community Centre' } };
  // The same tier, no rename: nothing is owed and the correction survives.
  const same = S.compareTiers(source, { 'community:Bellfield': { tier: 'may' } }, {});
  assert.strictEqual(same.owed, false);
  assert.deepStrictEqual(same.same, ['community:Bellfield']);
  // A new tier, no rename: the tier is owed and the merge carries the rename with it.
  const promoted = S.compareTiers(source, { 'community:Bellfield': { tier: 'must' } }, {});
  assert.deepStrictEqual(promoted.changed[0].to, { tier: 'must', as: 'Bellfield House Community Centre' });
  const m = S.mergeTiers(source, { 'community:Bellfield': { tier: 'must' } }, {});
  assert.deepStrictEqual(m['community:Bellfield'], { tier: 'must', as: 'Bellfield House Community Centre' });
  // A portal rename that differs still wins — the portal HAS an opinion.
  const renamed = S.mergeTiers(source, { 'community:Bellfield': { tier: 'may', as: 'Bellfield Hub' } }, {});
  assert.deepStrictEqual(renamed['community:Bellfield'], { tier: 'may', as: 'Bellfield Hub' });
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

/*
 * OA-354, and High Wycombe's real shape in both directions. The town answered on
 * 2026-08-31 against one unnamed library and one unnamed museum, wearing the
 * fallback names classify() gives them; the OpenStreetMap pull on 2026-09-02
 * named five libraries and three museums, and the stored answer has named
 * nothing since. BOTH directions are asserted deliberately: a narrowing that
 * only ever says "not owed" would clear every row on the board, so the same
 * candidate list must still raise a key that DOES name a POI the town has.
 */
const HW_CANDIDATES = [
  'library:High Wycombe Library', 'library:Hazlemere Library', 'library:Micklefield Library',
  'museum:Wycombe Museum', 'museum:Chair Making Museum', 'shop:Eden Shopping Centre',
];

test('a stored answer whose POI has since been NAMED is ORPHANED, not owed, and says what the town does have', () => {
  const portal = { 'library:Library': { tier: 'must' }, 'museum:Museum': { tier: 'must' } };
  const c = S.compareTiers({}, portal, {}, HW_CANDIDATES);
  assert.deepStrictEqual(c.added, []);
  assert.strictEqual(c.owed, false, 'a row nothing can clear must not be raised');
  assert.strictEqual(c.narrowed, true);
  assert.deepStrictEqual(c.orphaned.map((o) => o.key), ['library:Library', 'museum:Museum']);
  assert.deepStrictEqual(c.orphaned[0].have, ['library:High Wycombe Library', 'library:Hazlemere Library', 'library:Micklefield Library']);
  assert.deepStrictEqual(c.orphaned[1].cat, 'museum');
  // ...and --apply must never write one: that is the unknownTierKeys state.
  const m = S.mergeTiers({}, portal, {}, HW_CANDIDATES);
  assert.deepStrictEqual(Object.keys(m), []);
});

test('the SAME candidate list still raises a real debt — the narrowing has not blinded the check', () => {
  const portal = { 'library:Library': 'must', 'shop:Eden Shopping Centre': { tier: 'must' } };
  const c = S.compareTiers({}, portal, {}, HW_CANDIDATES);
  assert.deepStrictEqual(c.added, ['shop:Eden Shopping Centre']);
  assert.strictEqual(c.owed, true);
  const m = S.mergeTiers({}, portal, {}, HW_CANDIDATES);
  assert.deepStrictEqual(Object.keys(m), ['shop:Eden Shopping Centre']);
});

test('a CHANGED key can be orphaned too — a stale identity on both sides is still a dead key', () => {
  const c = S.compareTiers({ 'library:Library': 'may' }, { 'library:Library': 'must' }, {}, HW_CANDIDATES);
  assert.deepStrictEqual(c.changed, []);
  assert.strictEqual(c.owed, false);
  assert.deepStrictEqual(c.orphaned.map((o) => o.key), ['library:Library']);
});

test('NO candidate list fails OPEN: the comparison is exactly what it was, and says it was not narrowed', () => {
  const portal = { 'library:Library': { tier: 'must' } };
  const c = S.compareTiers({}, portal, {});
  assert.deepStrictEqual(c.added, ['library:Library']);
  assert.strictEqual(c.owed, true, 'a tree with no geometry must not be able to clear a real debt');
  assert.strictEqual(c.narrowed, false);
  assert.deepStrictEqual(c.orphaned, []);
  assert.strictEqual(S.townCandidateKeys('C:/no/such/map/folder'), null);
});

test('both reasons a key reaches nothing come from ONE place, and unreachableKeys is their union', () => {
  const tiers = { 'industrial:Cressex': 'miss', 'library:Library': 'must', 'museum:Wycombe Museum': 'must' };
  const cands = ['library:High Wycombe Library', 'museum:Wycombe Museum'];
  const r = S.unreachableReasons(tiers, { industrialKeep: 'none' }, cands);
  assert.deepStrictEqual(r.culled, ['industrial:Cressex']);
  assert.deepStrictEqual(r.orphaned.map((o) => o.key), ['library:Library']);
  assert.deepStrictEqual(S.unreachableKeys(tiers, { industrialKeep: 'none' }, cands), ['industrial:Cressex', 'library:Library']);
  // A culled key is never ALSO reported as an orphan, however few candidates there are.
  assert.deepStrictEqual(S.unreachableReasons({ 'industrial:X': 'miss' }, { industrialKeep: 'none' }, []).orphaned, []);
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
