/*
 * fit_set — which stops the internal map is scaled to fit.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3). Of the 20
 * committed maps, exactly ONE — Ramsey — reaches the off-path rule at all, and
 * it is the map the rule was written for. So the 20-map byte diff certifies this
 * block on a single data point, and every branch below except that one is dark
 * to it: a change that broke the fitExtra path, or the three-survivor floor, or
 * the fitMaxOffPath:0 escape hatch, would leave all twenty sheets byte-identical.
 *
 * The floor is the assertion that matters most and is the least obvious. If
 * almost every core stop is off-path the road match is broken; shrinking the fit
 * to the survivors would hide that behind a map that still looks plausible. So
 * the rule declines to act rather than acting on three points.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fitSet, offMetres } = require('./_engine.js').load('fit_set.js');

// A tidy grid near Ramsey: 0.01 deg of latitude is about 1.11 km.
const LL = { A1: [52.45, -0.10], A2: [52.46, -0.10], A3: [52.47, -0.10], A4: [52.48, -0.10],
             FAR: [52.90, -0.10], X1: [52.45, -0.20] };
const atco2ll = { '0500RAM001': LL.A1, '0500RAM002': LL.A2, '0500RAM003': LL.A3,
                  '0500RAM004': LL.A4, '0500RAM009': LL.FAR, '0500OTH001': LL.X1 };
// a drawn line running up the A-column, nowhere near FAR or X1
const routePaths = { routes: { r1: { pts: [LL.A1, LL.A4] } } };
const base = { atco2ll, prefix: '0500RAM', intownCfg: {}, routePaths };

test('the classic model fits every drawn stop, ignoring the prefix entirely', () => {
  const { stopPts } = fitSet({ ...base, ir: null, routes: { r1: ['0500RAM001', '0500OTH001'] } });
  assert.deepStrictEqual(stopPts, [LL.A1, LL.X1]);
});

test('the classic model keeps duplicates — the fit only reads the extremes', () => {
  const { stopPts } = fitSet({ ...base, ir: null, routes: { r1: ['0500RAM001'], r2: ['0500RAM001'] } });
  assert.strictEqual(stopPts.length, 2);
});

test('internalRoads fits the town core only, so out-of-town tails run off the frame', () => {
  const { stopPts } = fitSet({ ...base, ir: {}, routes: { r1: ['0500RAM001', '0500RAM002', '0500RAM003', '0500OTH001'] } });
  assert.deepStrictEqual(stopPts, [LL.A1, LL.A2, LL.A3], 'the other-parish stop is not fitted');
});

test('fitExtra and intown_cfg extraCore each pull a named out-of-parish stop back in', () => {
  const routes = { r1: ['0500RAM001', '0500RAM002', '0500RAM003', '0500OTH001'] };
  const viaIr = fitSet({ ...base, ir: { fitExtra: ['0500OTH001'], fitMaxOffPath: 0 }, routes });
  assert.ok(viaIr.stopPts.includes(LL.X1));
  const viaCfg = fitSet({ ...base, intownCfg: { extraCore: ['0500OTH001'] }, ir: { fitMaxOffPath: 0 }, routes });
  assert.ok(viaCfg.stopPts.includes(LL.X1));
});

test('fitExtra WINS over extraCore when a town sets both', () => {
  const routes = { r1: ['0500RAM001', '0500RAM002', '0500RAM003', '0500OTH001'] };
  const out = fitSet({ ...base, intownCfg: { extraCore: ['0500OTH001'] },
    ir: { fitExtra: [], fitMaxOffPath: 0 }, routes });
  assert.ok(!out.stopPts.includes(LL.X1), 'an explicit empty fitExtra is a decision, not an absence');
});

test('a core stop far from every drawn line is dropped from the fit, and counted', () => {
  const out = fitSet({ ...base, ir: {},
    routes: { r1: ['0500RAM001', '0500RAM002', '0500RAM003', '0500RAM004', '0500RAM009'] } });
  assert.deepStrictEqual(out.stopPts, [LL.A1, LL.A2, LL.A3, LL.A4]);
  assert.strictEqual(out.excluded, 1);
  assert.strictEqual(out.limit, 1500, 'the default distance, and it is reported so the caller can name it');
});

test('the rule refuses to act with fewer than three survivors — a broken road match must stay visible', () => {
  const out = fitSet({ ...base, ir: {},
    routes: { r1: ['0500RAM001', '0500RAM002', '0500RAM009'] } });
  assert.strictEqual(out.excluded, 0, 'two survivors is not enough to trust');
  assert.ok(out.stopPts.includes(LL.FAR), 'so the far stop stays in the fit and the map looks wrong');
});

test('fitMaxOffPath raises the distance, and 0 disables the rule outright', () => {
  const routes = { r1: ['0500RAM001', '0500RAM002', '0500RAM003', '0500RAM004', '0500RAM009'] };
  assert.strictEqual(fitSet({ ...base, ir: { fitMaxOffPath: 100000 }, routes }).excluded, 0);
  const off = fitSet({ ...base, ir: { fitMaxOffPath: 0 }, routes });
  assert.strictEqual(off.excluded, 0);
  assert.ok(off.stopPts.includes(LL.FAR));
});

test('with no matched road geometry at all there is nothing to be off-path from', () => {
  const out = fitSet({ ...base, routePaths: { routes: {} }, ir: {},
    routes: { r1: ['0500RAM001', '0500RAM002', '0500RAM003', '0500RAM009'] } });
  assert.strictEqual(out.excluded, 0);
  assert.strictEqual(out.stopPts.length, 4);
});

test('a stop is measured to the nearest point ON a segment, not to its ends', () => {
  const a = [52.45, -0.10], b = [52.48, -0.10];
  const beside = [52.465, -0.1005];   // alongside the middle of the segment
  assert.ok(offMetres(beside, a, b) < 60, 'a few dozen metres from the line it runs beside');
  assert.ok(Math.hypot((beside[0] - a[0]) * 111320) > 1000, 'and over a kilometre from either end');
});

test('a zero-length segment is a point, and does not divide by zero', () => {
  const p = [52.46, -0.10];
  assert.ok(Number.isFinite(offMetres(p, [52.45, -0.10], [52.45, -0.10])));
});
