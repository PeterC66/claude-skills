'use strict';
/*
 * poi_shortlist.js — the pure half: who is on the list, in what order (buses-data OA-568).
 *
 * From make-bus-leaflet/:  node --test test/poi_shortlist.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const S = require('./_engine.js').load('poi_shortlist.js');
const { AUTO_NAMED_CATS } = require('./_engine.js').load('poi_select.js');

const named = AUTO_NAMED_CATS[0];
const seen = (d, i) => ({ dropped: new Set(d), indexed: new Set(i) });
const poi = (cat, name) => ({ cat, name });

test('a name that did not fit outranks a numbered one, which outranks a named one; ties go by key', () => {
  const pois = [poi(named, 'Zed'), poi(named, 'Alpha'), poi(named, 'Mid'), poi(named, 'Lost')];
  const list = S.rank(pois, seen([named + ':Lost'], [named + ':Mid']), {}, 40);
  assert.deepStrictEqual(list.map(r => r.name), ['Lost', 'Mid', 'Alpha', 'Zed']);
  assert.deepStrictEqual(list.map(r => r.n), [1, 2, 3, 4]);
});

test('a place the customer has already answered is not asked again', () => {
  const pois = [poi(named, 'Done'), poi(named, 'Open')];
  const list = S.rank(pois, seen([], []), { [named + ':Done']: 'must' }, 40);
  assert.deepStrictEqual(list.map(r => r.name), ['Open']);
});

test('a kind the map never names is left off, because "must show" would change nothing', () => {
  const mute = ['pharmacy', 'library', 'gp'].find(c => !AUTO_NAMED_CATS.includes(c));
  const list = S.rank([poi(mute, 'Boots'), poi(named, 'Tesco')], seen([], []), {}, 40);
  assert.deepStrictEqual(list.map(r => r.name), ['Tesco']);
});

test('the list is cut at the limit and the same input gives the same numbers', () => {
  const pois = Array.from({ length: 60 }, (_, i) => poi(named, 'P' + String(i).padStart(2, '0')));
  const a = S.rank(pois, seen([], []), {}, 40), b = S.rank(pois.slice().reverse(), seen([], []), {}, 40);
  assert.strictEqual(a.length, 40);
  assert.deepStrictEqual(a, b);
});

test('the markdown tells the customer unmarked means unchanged, and numbers every row', () => {
  const list = S.rank([poi(named, 'A|B')], seen([], []), {}, 40);
  const md = S.markdown('Town', list, 9, false);
  assert.match(md, /Everything you do not mention stays as it is/);
  assert.match(md, /\| 1 \| A\\\|B \|/);
  assert.doesNotMatch(md, /In the draft/);
});
