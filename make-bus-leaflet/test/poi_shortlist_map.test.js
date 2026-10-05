'use strict';
/*
 * poi_shortlist_map.js — the picture half of the landmark shortlist (buses-data OA-568, slice 2).
 *
 * From make-bus-leaflet/:  node --test test/poi_shortlist_map.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const M = require('./_engine.js').load('poi_shortlist_map.js');

const row = (n, la, lo) => ({ n, key: 'x:P' + n, name: 'P' + n, ll: [la, lo] });

test('every listed place gets a numbered disc and a dot at its true position', () => {
  const list = [row(1, 52.50, 0.05), row(2, 52.55, 0.10), row(3, 52.52, 0.08)];
  const { svg, missing } = M.render('Town', list, { ways: [] }, []);
  assert.deepStrictEqual(missing, []);
  assert.strictEqual((svg.match(/r="15"/g) || []).length, 3);
  assert.strictEqual((svg.match(/r="3" fill="#c0392b"/g) || []).length, 3);
  for (const n of [1, 2, 3]) assert.match(svg, new RegExp('>' + n + '</text>'));
});

test('a row with no coordinate is reported, not drawn, and an empty list draws nothing', () => {
  const r = M.render('Town', [row(1, 52.5, 0.05), { n: 2, key: 'x:Q', name: 'Q' }], null, null);
  assert.deepStrictEqual(r.missing, [2]);
  assert.doesNotMatch(r.svg, />2<\/text>/);
  assert.strictEqual(M.render('Town', [{ n: 1, key: 'x:Q', name: 'Q' }], null, null).svg, null);
});

test('crowded places are pushed apart, joined to their true spot by a leader, and none overlap', () => {
  const list = Array.from({ length: 6 }, (_, i) => row(i + 1, 52.5 + i * 1e-6, 0.05));   // metres apart
  list.push(row(7, 52.6, 0.2));                                                           // gives the frame a size
  const { svg } = M.render('Town', list, null, null);
  const discs = [...svg.matchAll(/<g><circle cx="([\d.]+)" cy="([\d.]+)" r="15"/g)].map(m => [+m[1], +m[2]]);
  assert.strictEqual(discs.length, 7);
  for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++)
    assert.ok(Math.hypot(discs[i][0] - discs[j][0], discs[i][1] - discs[j][1]) >= 30, 'discs ' + i + ' and ' + j + ' overlap');
  assert.ok((svg.match(/<line /g) || []).length >= 5, 'a moved disc has a leader to its dot');
});

test('a place with room is not moved', () => {
  assert.deepStrictEqual(M.nudge([500, 400], [[100, 100]]), [500, 400]);
  assert.notDeepStrictEqual(M.nudge([500, 400], [[500, 400]]), [500, 400]);
});

test('the same input draws the same bytes, and streets off the page are not written', () => {
  const list = [row(1, 52.50, 0.05), row(2, 52.51, 0.06)];
  const roads = { ways: [
    { geometry: [[52.505, 0.052], [52.506, 0.058]], tags: { highway: 'residential' } },
    { geometry: [[10, 10], [10.1, 10.1]], tags: { highway: 'residential' } },
    { geometry: [[52.505, 0.052], [52.506, 0.058]], tags: { highway: 'footway' } },
  ] };
  const a = M.render('Town', list, roads, []).svg, b = M.render('Town', list, roads, []).svg;
  assert.strictEqual(a, b);
  assert.strictEqual((a.match(/stroke="#b9b9b9"/g) || []).length, 1);
});

test('the title is escaped', () => {
  const { svg } = M.render('A & <B>', [row(1, 52.5, 0.05)], null, null);
  assert.match(svg, /A &amp; &lt;B&gt;/);
});
