'use strict';
// via_on_chain.js — every "via" place and spoke stop lies on the route's own chain (buses-data OA-631).
const test = require('node:test');
const assert = require('node:assert');

const { viaOnChain, viaPlaces, samePlace, GATES } = require('./_engine.js').load('via_on_chain.js');

// A register in memory: ATCO -> [LocalityName, Parent], and the set of names it knows.
// Huntingdon's route 9 as it really is, and the Hartford the v6.0 sheet sent it through.
const STOPS = {
  H1: ['Huntingdon'], G1: ['Godmanchester'], HA: ['Hemingford Abbots'], HG: ['Hemingford Grey'], S1: ['St Ives'],
  HX: ['Hartford', 'Huntingdon'],   // a Hartford stop filed under Huntingdon's token: NOT on route 9
};
const KNOWN = ['Huntingdon', 'Godmanchester', 'Hemingford Abbots', 'Hemingford Grey', 'St Ives', 'Hartford'];
const register = {
  localitiesOf: (a) => STOPS[a] || [],
  isLocality: (n) => KNOWN.some(k => k.toLowerCase() === String(n).toLowerCase()),
};
const norm = (r) => String(r).toUpperCase();
const chain = { '9': ['H1', 'G1', 'HA', 'HG', 'S1'], '303': ['H1'] };   // 303 has a chain but is not displayed
const run = (routes, reg = register) => viaOnChain({ routes, displayed: new Set(['9']), norm, chainOf: r => chain[r] || null, register: reg });

const V60 = {   // Huntingdon S3 2026-10-11_0703, route 9 only
  internalDesc: { '9': ['Huntingdon – St Ives', 'Mon & Fri · via Hartford & Wyton · morning & evening only'] },
  external: [{ route: '9', label: 'St Ives', stops: ['Hartford', 'Wyton', 'St Ives'] }],
};
const V61 = {
  internalDesc: { '9': ['Huntingdon – St Ives', 'Mon & Fri · via Godmanchester & the Hemingfords'] },
  external: [{ route: '9', label: 'St Ives', stops: ['Godmanchester', 'Hemingford Grey', 'St Ives'] }],
};

test('v6.0: Hartford is off route 9\'s chain, in the panel AND on the spoke', () => {
  const r = run(V60);
  assert.deepStrictEqual(r.offChain.map(o => `${o.where} ${o.name}`).sort(), ['external[0].stops Hartford', 'internalDesc["9"] Hartford']);
});

test('Wyton is not a register locality, so it is unverifiable rather than HARD', () => {
  const r = run(V60);
  assert.ok(r.unverifiable.some(u => u.name === 'Wyton' && /not a NaPTAN locality/.test(u.why)));
  assert.ok(!r.offChain.some(o => o.name === 'Wyton'));
});

test('v6.1: the corrected sheet is quiet, the Hemingfords plural included', () => {
  const r = run(V61);
  assert.deepStrictEqual(r.offChain, []);
  assert.deepStrictEqual(r.unverifiable, []);
  assert.ok(r.checked >= 4);
});

test('the spoke\'s own destination is the terminus check\'s, not this one\'s', () => {
  const r = run({ external: [{ route: '9', label: 'Hartford', stops: ['Godmanchester', 'Hartford'] }] });
  assert.deepStrictEqual(r.offChain, []);
});

test('a route not on the sheet is not asked about', () => {
  const r = run({ internalDesc: { '303': ['x', 'via Hartford'] } });
  assert.deepStrictEqual(r.offChain, []);
  assert.strictEqual(r.checked, 0);
});

test('with no register nothing is called off-chain, and it says it did not run', () => {
  const r = run(V60, null);
  assert.deepStrictEqual(r.offChain, []);
  assert.match(r.notRun, /no NaPTAN register/);
});

test('a gate: an off-chain place is HARD (buses-data OA-636)', () => {
  assert.strictEqual(GATES, true);
  assert.strictEqual(run(V60).severity, 'hard');
});

test('viaPlaces reads the panel\'s own grammar', () => {
  assert.deepStrictEqual(viaPlaces('Mon & Fri · via Hartford & Wyton · morning & evening only'), ['Hartford', 'Wyton']);
  assert.deepStrictEqual(viaPlaces('daily · via Fenstanton (busway)'), ['Fenstanton']);
  assert.deepStrictEqual(viaPlaces('Mon–Sat (some via Gransden)'), []);
  assert.deepStrictEqual(viaPlaces('circular via RAF Alconbury & the Alconburys'), ['RAF Alconbury', 'Alconburys']);
  assert.deepStrictEqual(viaPlaces('Huntingdon – St Ives'), []);
});

test('samePlace is loose in the safe direction only', () => {
  assert.ok(samePlace('Hemingfords', 'Hemingford Grey'));
  assert.ok(samePlace('Saint Ives', 'St Ives'));
  assert.ok(samePlace('Alconbury', 'Alconbury Weston'));
  assert.ok(!samePlace('Hartford', 'Huntingdon'));
  assert.ok(!samePlace('Wyton', 'Wistow'));
});
