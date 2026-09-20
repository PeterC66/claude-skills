/*
 * displayed_routes.test.js — the denominator every S6 coverage percentage is struck over.
 *
 * The fault it exists for (OA-048): `displayed` was narrowed to what the config draws and
 * the line below the narrowing unioned the whole palette back in, so a route dropped from
 * `routeOrder` stayed in the denominator — and it is dropped while KEEPING its palette
 * entry precisely because the colour is what its legend badge is drawn with. High Wycombe
 * reported `displayed: 34` for a sheet drawing 22.
 *
 * `prove-s6-checks.js` section 21 holds the same two properties end to end, through a real
 * verify_report.js run against real map data. This file holds them at the unit, where the
 * cases that have no instance in the estate — no `routeOrder` at all, a busway entry, an
 * empty config — can be asserted at all. See assets/displayed_routes.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const { displayedRoutes, spokeBadges } = require('./_engine.js').load('displayed_routes.js');

const norm = r => String(r).trim().toUpperCase().replace(/\s+/g, '');
const of = (routes, intown) => [...displayedRoutes({ routes, intown: intown || {}, norm }).displayed].sort();

/* High Wycombe reduced to the shape that matters: a palette wider than the draw order,
 * a spoke carrying a second badge, and in-town geometry for a route nothing draws. */
const WYCOMBE = {
  palette: { 102: '#1', 37: '#2', 27: '#3', WW1: '#4', 275: '#5', LHR: '#6', OXF: '#7' },
  routeOrder: ['102', '37'],
  external: [
    { route: '102', routes: ['102', 'LHR'], label: 'Heathrow' },
    { route: '275', routes: ['275', 'OXF'], label: 'Oxford' },
  ],
};

test('a route dropped from routeOrder is NOT displayed, though it keeps its palette entry', () => {
  const d = of(WYCOMBE, { 27: ['a', 'b'], WW1: ['c'] });
  assert.ok(!d.includes('27'), `27 has a legend badge and no line: ${d.join(',')}`);
  assert.ok(!d.includes('WW1'), `WW1 has a legend badge and no line: ${d.join(',')}`);
});

test('a service riding on another route\'s spoke IS displayed', () => {
  // The half that keeps the one above honest: LHR and OXF are in neither routeOrder nor
  // any `route` key, and both are drawn — as extra badges on the 102 and 275 spokes.
  const d = of(WYCOMBE);
  assert.ok(d.includes('LHR'), `LHR rides on the 102 spoke: ${d.join(',')}`);
  assert.ok(d.includes('OXF'), `OXF rides on the 275 spoke: ${d.join(',')}`);
});

test('the whole set is exactly what the two sheets draw', () => {
  assert.deepStrictEqual(of(WYCOMBE, { 27: ['a', 'b'], WW1: ['c'], 102: ['d'] }),
    ['102', '275', '37', 'LHR', 'OXF']);
});

test('routeOrder is an EITHER/OR with the palette, never a union', () => {
  /* gen_internal.js draws `RJ.routeOrder || Object.keys(C)`. Unioning them is the bug
   * this module replaces, and the two spellings differ only when they disagree. */
  const union = of({ palette: { 1: '#1', 2: '#2' }, routeOrder: ['1'] });
  assert.deepStrictEqual(union, ['1'], 'the palette must not be added back');
});

test('with no routeOrder the palette IS the draw order, which is what gen_internal falls back to', () => {
  assert.deepStrictEqual(of({ palette: { 1: '#1', 2: '#2' } }), ['1', '2']);
  assert.deepStrictEqual(of({ palette: { 1: '#1', 2: '#2' }, routeOrder: [] }), ['1', '2'],
    'an empty routeOrder is an absent one, not a config that draws nothing');
});

test('a route with in-town geometry that no sheet draws stays out', () => {
  const d = of({ palette: { 1: '#1' }, routeOrder: ['1'] }, { 1: ['a'], 99: ['b', 'c'] });
  assert.deepStrictEqual(d, ['1'], 'S2 geometry is not a decision to draw');
});

test('a config that names nothing falls back to the geometry rather than to silence', () => {
  // `!drawnInternal.size` — with no palette and no routeOrder there is nothing to filter
  // BY, and reporting on none of the routes would be worse than reporting on all of them.
  assert.deepStrictEqual(of({}, { 5: ['a'], 6: ['b'] }), ['5', '6']);
});

test('busway entries get the same spoke treatment as external ones', () => {
  const d = of({ palette: {}, routeOrder: [], busway: [{ route: 'A', routes: ['A', 'B'] }] });
  assert.deepStrictEqual(d, ['A', 'B']);
});

test('route keys are normalised on every arm, so one spelling cannot enter twice', () => {
  const d = of({ palette: { ' vl14 ': '#1' }, external: [{ route: 'VL14' }] }, { 'VL 14': ['a'] });
  assert.deepStrictEqual(d, ['VL14']);
});

test('spokeBadges is gen_external_radial\'s _badges and falls back to the entry key', () => {
  assert.deepStrictEqual(spokeBadges({ route: '9', routes: ['9', '9A'] }), ['9', '9A']);
  assert.deepStrictEqual(spokeBadges({ route: '9' }), ['9']);
  assert.deepStrictEqual(spokeBadges({ route: '9', routes: [] }), ['9'],
    'an empty routes[] is an absent one — the generator reads it the same way');
});
