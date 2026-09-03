/*
 * index_guard.test.js — the guard that tells "indexed" from "silently deduplicated".
 *
 * The fault it exists for: `for (const s of services) byRoute[s.route] = s;` over a
 * town that runs two route 46s. Nothing throws, nothing is missing, every route
 * appears exactly once, and one operator's facts are wearing the other's name.
 * See OA-134 and assets/index_guard.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const { serviceKey, indexUnique, indexUniqueObj, assertNoCollision } =
  require('./_engine.js').load('index_guard.js');

// Wisbech, reduced to the part that matters.
const WISBECH = [
  { key: '46', route: '46', operator: 'Stagecoach East' },
  { key: '46L', route: '46', operator: 'Lynx' },
  { key: '60', route: '60', operator: 'Lynx' },
];

test('serviceKey prefers the key field', () => {
  assert.strictEqual(serviceKey(WISBECH[0]), '46');
  assert.strictEqual(serviceKey(WISBECH[1]), '46L');
});

test('serviceKey falls back to the route number when there is no key', () => {
  // 4 of 8 towns and 0 of 12 places carry `key` (measured 2026-08-28), so this
  // fallback is the live path on most of the estate. It must be exactly the old
  // behaviour, or the guard would change what unaffected maps produce.
  assert.strictEqual(serviceKey({ route: '9' }), '9');
  assert.strictEqual(serviceKey({ route: 9 }), '9');
  assert.strictEqual(serviceKey({ route: 'A', key: '' }), 'A');
  assert.strictEqual(serviceKey({ route: 'A', key: null }), 'A');
});

test('indexUnique keeps every row when the key is genuinely unique', () => {
  const m = indexUnique(WISBECH, serviceKey, 'wisbech by key');
  assert.strictEqual(m.size, WISBECH.length);
  assert.strictEqual(m.get('46').operator, 'Stagecoach East');
  assert.strictEqual(m.get('46L').operator, 'Lynx');
});

test('indexUnique throws rather than let a row overwrite another', () => {
  assert.throws(
    () => indexUnique(WISBECH, s => String(s.route), 'wisbech by route number'),
    (e) => {
      // The message has to be readable by someone who has never seen the file:
      // it must name the source, the colliding key, and both operators.
      assert.match(e.message, /wisbech by route number/);
      assert.match(e.message, /'46'/);
      assert.match(e.message, /Stagecoach East/);
      assert.match(e.message, /Lynx/);
      assert.match(e.message, /OA-134/);
      return true;
    });
});

test('a three-way collision is reported once, naming all three', () => {
  const three = [{ route: '5' }, { route: '5' }, { route: '5' }];
  assert.throws(() => indexUnique(three, s => String(s.route), 'three'),
    (e) => {
      assert.match(e.message, /1 colliding key/);
      assert.strictEqual((e.message.match(/#\d/g) || []).length, 3);
      return true;
    });
});

test('indexUniqueObj returns a prototype-less object', () => {
  const o = indexUniqueObj(WISBECH, serviceKey, 'x');
  assert.strictEqual(Object.getPrototypeOf(o), null);   // 'constructor' cannot be a route
  assert.strictEqual(Object.keys(o).length, 3);
});

test('empty and non-array inputs do not throw', () => {
  assert.strictEqual(indexUnique([], serviceKey, 'x').size, 0);
  assert.strictEqual(indexUnique(null, serviceKey, 'x').size, 0);
  assert.strictEqual(indexUnique(undefined, serviceKey, 'x').size, 0);
});

test('assertNoCollision passes on a map somebody else built correctly', () => {
  const m = new Map(WISBECH.map(s => [serviceKey(s), s]));
  assert.doesNotThrow(() => assertNoCollision(m, WISBECH, 'x'));
});

test('assertNoCollision fires on a map that lost a row, and says how many', () => {
  const bad = new Map(WISBECH.map(s => [String(s.route), s]));   // the historical bug
  assert.strictEqual(bad.size, 2);
  assert.throws(() => assertNoCollision(bad, WISBECH, 'wisbech'),
    (e) => {
      assert.match(e.message, /indexed 3 row\(s\) into 2 entries/);
      assert.match(e.message, /1 were silently overwritten/);
      return true;
    });
});

test('assertNoCollision works on a plain object as well as a Map', () => {
  const bad = {};
  for (const s of WISBECH) bad[String(s.route)] = s;
  assert.throws(() => assertNoCollision(bad, WISBECH, 'wisbech obj'), /into 2 entries/);
});
