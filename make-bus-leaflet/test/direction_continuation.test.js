'use strict';
// direction_continuation.js — which way the chain goes next, past the drawn edge (OA-416).
const test = require('node:test');
const assert = require('node:assert');

const { continuationBearing } = require('./_engine.js').load('direction_continuation.js');

// Flat-earth helpers are enough for a unit test, in km.
const geo = (ll) => ({
  ll, anchorLL: [0, 0],
  haversineKm: (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]),
  bearing: (a, b) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 360) % 360,
  angleDiff: (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; },
});
// ll here is [northing, easting] so bearing() reads like a compass: atan2(east, north).
const ll = {
  T0: [0, 0], T1: [0.3, 0],                     // in town, drawn
  E: [-1.5, 1.5],                                // the edge stop, south-east
  C1: [-2.5, 1.8], C2: [-3.5, 1.5], C3: [-4.5, 0.5], C4: [-6, -1],  // turns south, then south-west
};

test('it walks OUTWARD from the edge, away from the drawn stops, and stops a kilometre out', () => {
  const dirs = [{ stops: ['T1', 'T0', 'E', 'C1', 'C2', 'C3', 'C4'] }];
  const r = continuationBearing(dirs, 'E', new Set(['T1', 'T0', 'E']), 135, geo(ll));
  assert.deepStrictEqual(r.stops, ['C1', 'C2', 'C3']);
  assert.ok(r.bearing > 170 && r.bearing < 180, `bearing ${r.bearing}`);
});

test('the direction running the other way is read from its own side, and the closer bearing is kept', () => {
  const dirs = [{ stops: ['C4', 'C3', 'C2', 'C1', 'E', 'T0', 'T1'] }, { stops: ['T1', 'T0', 'E', 'C1', 'C2', 'C3', 'C4'] }];
  const r = continuationBearing(dirs, 'E', new Set(['T1', 'T0', 'E']), 135, geo(ll));
  assert.deepStrictEqual(r.stops, ['C1', 'C2', 'C3']);
});

test('null when the edge is the end of the chain, or on no direction at all', () => {
  const g = geo(ll);
  assert.strictEqual(continuationBearing([{ stops: ['T1', 'T0', 'E'] }], 'E', new Set(['T1', 'T0', 'E']), 135, g), null);
  assert.strictEqual(continuationBearing([{ stops: ['T1', 'T0', 'C1'] }], 'E', new Set(['T1', 'T0']), 135, g), null);
});

test('a drawn stop or one without coordinates is never counted as the continuation', () => {
  const dirs = [{ stops: ['T0', 'E', 'X', 'C1', 'C2', 'C3'] }];
  const r = continuationBearing(dirs, 'E', new Set(['T0', 'E', 'C1']), 135, geo(ll));
  assert.deepStrictEqual(r.stops, ['C2', 'C3']);
});
