/*
 * projection — lat/lon to page millimetres for the internal map.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3). MEASURED across
 * the 20 committed maps on the same day, six of this module's branches are taken
 * by NO map at all, so the byte gate certifies none of them: overrides.json
 * rotationDeg (0 maps), design.fixedOrientation (0), design.footerSafe:false and
 * its 205 mm frame (0), the three-zone fisheye focus.midKm (0), a frozen
 * viewport (0 — 8 maps carry an overrides.json and not one freezes the fit), and
 * the CLASSIC model itself (0 — every live map is internalRoads, which the file
 * documents as intended, the classic path being an escape hatch). What the maps
 * do exercise: PCA orientation on 18 and internalRoads.rotationDeg on 2,
 * focus.comp below 1 on 9, and detail lenses on 2.
 *
 * The round-trip assertion is the one that would have caught a real recorded
 * fault: APPLIED_ROTATION_DEG is published so that design.fixedOrientation set to
 * that number reproduces the sheet, and -66 and 294 degrees are the same bearing
 * and not the same float. Publishing a number nobody feeds back is how that goes
 * unnoticed.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { projection } = require('./_engine.js').load('projection.js');

// A small town: a north-east trending line of stops, so PCA has a clear answer.
const stopPts = [[52.320, -0.075], [52.324, -0.070], [52.328, -0.064], [52.332, -0.060], [52.322, -0.068]];
const ANCHOR = '0500HSTIV002';
const atco2ll = { [ANCHOR]: [52.326, -0.067] };
const DESIGN = {};
const base = {
  stopPts, atco2ll, ANCHOR,
  IR: { focus: { coreKm: 1.1, comp: 0.5 } },
  ZOOM: { corePct: 1.0, comp: 1.0 },
  OV: {}, FIXED_ORIENTATION: null,
  FOOTER_SAFE: true, FOOTER_PLATE_TOP: 195.16, DESIGN,
};
const run = (over) => projection({ ...base, ...over });

test('the frame is the fixed left/top edges and a bottom edge derived from the footer plate', () => {
  const p = run({});
  assert.deepStrictEqual([p.MX0, p.MX1, p.MY0], [6, 196, 30]);
  assert.strictEqual(p.MY1, 192.16, '195.16 plate top less the 3.0 mm default footerGap');
});

test('design.footerGap moves the frame bottom, and is rounded to 2 dp', () => {
  assert.strictEqual(run({ DESIGN: { footerGap: 1.5 } }).MY1, 193.66);
});

test('footerSafe:false restores the flat 205 mm bottom edge — dark to all 20 maps', () => {
  assert.strictEqual(run({ FOOTER_SAFE: false }).MY1, 205);
});

test('every fitted stop lands inside the frame', () => {
  const p = run({});
  for (const s of stopPts) {
    const [x, y] = p.XY(s);
    assert.ok(x >= p.MX0 && x <= p.MX1, `x ${x} inside [${p.MX0}, ${p.MX1}]`);
    assert.ok(y >= p.MY0 && y <= p.MY1, `y ${y} inside [${p.MY0}, ${p.MY1}]`);
  }
});

test('orientation precedence: overrides beats design.fixedOrientation beats internalRoads', () => {
  const ir = { focus: { coreKm: 1.1, comp: 0.5 }, rotationDeg: 10 };
  assert.strictEqual(run({ IR: ir }).APPLIED_ROTATION_DEG, 10);
  assert.strictEqual(run({ IR: ir, FIXED_ORIENTATION: 25 }).APPLIED_ROTATION_DEG, 25);
  assert.strictEqual(run({ IR: ir, FIXED_ORIENTATION: 25, OV: { rotationDeg: 40 } }).APPLIED_ROTATION_DEG, 40);
});

test('with no orientation configured at all, PCA decides — and that is what 18 maps do', () => {
  const p = run({});
  assert.ok(Number.isFinite(p.APPLIED_ROTATION_DEG));
  assert.notStrictEqual(p.APPLIED_ROTATION_DEG, 0, 'these stops trend north-east, so the answer is not "north up"');
});

test('APPLIED_ROTATION_DEG round-trips: fed back as fixedOrientation it reproduces the sheet', () => {
  const pca = run({});
  const fixed = run({ FIXED_ORIENTATION: pca.APPLIED_ROTATION_DEG });
  assert.strictEqual(fixed.APPLIED_ROTATION_DEG, pca.APPLIED_ROTATION_DEG);
  assert.strictEqual(fixed.theta, pca.theta, 'the same bearing must also be the same float');
  for (const s of stopPts) assert.deepStrictEqual(fixed.XY(s), pca.XY(s));
});

test('a frozen viewport replaces the computed fit outright — dark to all 20 maps', () => {
  const free = run({});
  const halved = { ...free.viewport, sc: free.viewport.sc / 2 };
  const frozen = run({ OV: { viewport: halved } });
  assert.strictEqual(frozen.viewport.sc, halved.sc, 'the frozen block is used, not merged with the computed one');
  // XY is MX0 + offX + (x - minX) * sc, so halving sc halves the distance from
  // the frame origin. This is what keeps hand-placed stops valid across a data
  // refresh: new stops project into the SAME frame rather than a refitted one.
  const originX = free.MX0 + free.viewport.offX, originY = free.MY0 + free.viewport.offY;
  for (const s of stopPts) {
    const [fx, fy] = free.XY(s), [zx, zy] = frozen.XY(s);
    assert.ok(Math.abs((zx - originX) - (fx - originX) / 2) < 1e-9, 'x scales with the frozen sc');
    assert.ok(Math.abs((zy - originY) - (fy - originY) / 2) < 1e-9, 'y scales with the frozen sc');
  }
});

test('the classic model with default zoom is a plain fit, no fisheye — dark to all 20 maps', () => {
  const p = run({ IR: null });
  assert.strictEqual(p.CPF, 1, 'ZOOM.comp defaults to 1, i.e. identity');
  assert.strictEqual(p.R1, null);
  assert.deepStrictEqual(p.LENSES, []);
  for (const s of stopPts) { const [x, y] = p.XY(s); assert.ok(x >= p.MX0 && x <= p.MX1 && y >= p.MY0 && y <= p.MY1); }
});

// A town with a real tail: four stops in a core cluster, and one 9 km out. With
// every stop inside coreKm the fisheye has nothing to act on, which is a fine way
// to write two assertions that pass for the wrong reason.
const tailTown = [[52.320, -0.075], [52.322, -0.073], [52.324, -0.071], [52.326, -0.069], [52.400, -0.010]];
const tailBase = { ...base, stopPts: tailTown, atco2ll: { [ANCHOR]: [52.323, -0.072] } };
// how far apart two core stops are drawn, against how far the tail is drawn
const coreSpread = (p) => { const a = p.XY(tailTown[0]), b = p.XY(tailTown[3]); return Math.hypot(a[0]-b[0], a[1]-b[1]); };
const farRatio = (p) => { const a = p.XY(tailTown[0]), f = p.XY(tailTown[4]); return Math.hypot(a[0]-f[0], a[1]-f[1]) / coreSpread(p); };

test('a stronger centre fisheye magnifies the core, because the fitted extent shrinks', () => {
  const none = projection({ ...tailBase, IR: { focus: { coreKm: 1.1, comp: 1.0 } } });
  const soft = projection({ ...tailBase, IR: { focus: { coreKm: 1.1, comp: 0.9 } } });
  const hard = projection({ ...tailBase, IR: { focus: { coreKm: 1.1, comp: 0.2 } } });
  assert.ok(coreSpread(hard) > coreSpread(soft) && coreSpread(soft) > coreSpread(none),
    'compressing the tail harder leaves more page for the true-scale core');
  assert.ok(farRatio(hard) < farRatio(soft) && farRatio(soft) < farRatio(none),
    'and the tail is drawn nearer, relative to the core, the harder it is compressed');
});

test('the three-zone fisheye compresses beyond midKm harder than the middle band — dark to all 20 maps', () => {
  const single = projection({ ...tailBase, IR: { focus: { coreKm: 0.5, comp: 0.8 } } });
  const three  = projection({ ...tailBase, IR: { focus: { coreKm: 0.5, comp: 0.8, midKm: 2.0, outerComp: 0.1 } } });
  assert.strictEqual(single.R1, null, 'no midKm is single-band, and must stay byte-identical');
  assert.strictEqual(three.R1, 2.0 / 111.32);
  assert.ok(coreSpread(three) > coreSpread(single),
    'squeezing the far tail leaves more page for the core than one band at the same comp');
});

test('a detail lens is bounded: it is declared with the radius and magnification given', () => {
  const p = run({ IR: { focus: { coreKm: 1.1, comp: 0.5 }, lenses: [{ center: [52.326, -0.067], radiusKm: 0.4, mag: 2.2 }] } });
  assert.strictEqual(p.LENSES.length, 1);
  assert.strictEqual(p.LENSES[0].R, 0.4 / 111.32);
  assert.strictEqual(p.LENSES[0].mag, 2.2);
});

test('a lens defaults to 0.5 km and 1.8x when the town gives neither', () => {
  const p = run({ IR: { focus: { coreKm: 1.1, comp: 0.5 }, lenses: [{ center: [52.326, -0.067] }] } });
  assert.strictEqual(p.LENSES[0].R, 0.5 / 111.32);
  assert.strictEqual(p.LENSES[0].mag, 1.8);
});

test('sc is page mm per unit of the planar projection, i.e. per degree of latitude', () => {
  const p = run({});
  const a = p.XY([52.320, -0.075]), b = p.XY([52.321, -0.075]);
  assert.ok(Math.hypot(a[0]-b[0], a[1]-b[1]) > 0, 'a thousandth of a degree is a visible distance on the page');
  assert.ok(p.sc > 0);
});
