/*
 * pre_stages — diagram_internal.js and schematize_internal.js on the real
 * projection (OA-230, 2026-09-02; engine F4 and F5 of the codebase review).
 *
 * Both pre-stages carried a 40-line copy of gen_internal.js's projection,
 * commented "EXACT copy", and the copy had drifted from projection.js: a flat
 * 205 mm frame bottom, no design.fixedOrientation, no overrides rotation, no
 * detail lenses. The extraction hands the real module the inputs that reproduce
 * the copy EXACTLY, so the 13 schematic and diagram sheets did not move, and the
 * adoption of the module's real behaviour is a separate drawing change.
 *
 * Neither pre-stage can be required — each runs top to bottom on load — so this
 * suite works at two levels. The FUNCTIONAL half keeps the old copy here as a
 * fixture and asserts that projection.js, called the way the pre-stages now call
 * it, returns the same numbers: that is the claim the byte gate proved once on
 * the estate, held here for configs the estate does not have (a lens present, a
 * rotation set). The SOURCE half pins what the files say: that they call the
 * module, that the PCA line exists in only one file, and that LEGACY_FRAME still
 * says footerSafe:false — because flipping it is the one-line adoption, and it
 * must be a deliberate change to this test rather than a quiet edit.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, ENGINE_DIR } = require('./_engine.js');
const { projection } = load('projection.js');
const { internalRoadsConfig } = load('internal_roads_config.js');

/* The copy as it stood in both pre-stages until 2026-09-02, character for
 * character in its arithmetic. It is the FIXTURE, not the subject. */
function legacyProjection({ stopPts, atco2ll, ANCHOR, IR }) {
  const lat0 = stopPts.reduce((s, p) => s + p[0], 0) / stopPts.length;
  const k = Math.cos(lat0 * Math.PI / 180);
  const planar = ([lat, lon]) => [lon * k, -lat];
  const P = stopPts.map(planar);
  const mx = P.reduce((s, p) => s + p[0], 0) / P.length, my = P.reduce((s, p) => s + p[1], 0) / P.length;
  let sxx = 0, sxy = 0, syy = 0; for (const [x, y] of P) { const dx = x - mx, dy = y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  let theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (IR.rotationDeg != null) theta = -IR.rotationDeg * Math.PI / 180;
  const cosT = Math.cos(-theta), sinT = Math.sin(-theta);
  const rot = ([x, y]) => { const dx = x - mx, dy = y - my; return [dx * cosT - dy * sinT, dx * sinT + dy * cosT]; };
  const tform0 = ll => rot(planar(ll));
  const O = (function () {
    const fc = IR.focus.center;
    if (Array.isArray(fc)) return tform0(fc);
    if (fc !== 'centroid' && atco2ll[ANCHOR]) return tform0(atco2ll[ANCHOR]);
    const t = stopPts.map(tform0); return [t.reduce((s, p) => s + p[0], 0) / t.length, t.reduce((s, p) => s + p[1], 0) / t.length];
  })();
  const R0 = IR.focus.coreKm / 111.32;
  const CPF = IR.focus.comp;
  const R1 = (IR.focus.midKm != null) ? IR.focus.midKm / 111.32 : null;
  const CPF2 = (IR.focus.outerComp != null) ? IR.focus.outerComp : CPF;
  function compress([x, y]) {
    if (CPF >= 1 && R1 === null) return [x, y];
    const dx = x - O[0], dy = y - O[1], r = Math.hypot(dx, dy);
    if (r <= R0 || r === 0) return [x, y];
    const nr = (R1 !== null && r > R1) ? R0 + (R1 - R0) * CPF + (r - R1) * CPF2 : R0 + (r - R0) * CPF;
    return [O[0] + dx / r * nr, O[1] + dy / r * nr];
  }
  const tform = ll => compress(tform0(ll));
  const MX0 = 6, MX1 = 196, MY0 = 30, MY1 = 205;
  const allT = stopPts.map(tform);
  let minX = Math.min(...allT.map(p => p[0])), maxX = Math.max(...allT.map(p => p[0]));
  let minY = Math.min(...allT.map(p => p[1])), maxY = Math.max(...allT.map(p => p[1]));
  const pad = 0.0006; minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const FM = IR.fitMargin != null ? IR.fitMargin : 4;
  const sc = Math.min((MX1 - MX0 - 2 * FM) / (maxX - minX), (MY1 - MY0 - 2 * FM) / (maxY - minY));
  const offX = (MX1 - MX0 - (maxX - minX) * sc) / 2, offY = (MY1 - MY0 - (maxY - minY) * sc) / 2;
  const XY = ll => { const [x, y] = tform(ll); return [MX0 + offX + (x - minX) * sc, MY0 + offY + (y - minY) * sc]; };
  const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc];
  return { XY, INV, MX0, MX1, MY0, MY1, theta, minX, minY, sc, offX, offY };
}

/* What the pre-stages now do, line for line (diagram_internal.js / schematize_internal.js). */
function preStageProjection({ stopPts, atco2ll, ANCHOR, IR }) {
  const LEGACY_FRAME = { OV: {}, FIXED_ORIENTATION: null, FOOTER_SAFE: false, FOOTER_PLATE_TOP: null, DESIGN: {} };
  const _proj = projection(Object.assign({ stopPts, atco2ll, ANCHOR,
    IR: Object.assign({}, IR, { lenses: undefined }),
    ZOOM: { corePct: 1.0, comp: 1.0 } }, LEGACY_FRAME));
  const { XY, MX0, MX1, MY0, MY1, theta } = _proj;
  const { minX, minY, sc, offX, offY } = _proj.viewport;
  const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc];
  return { XY, INV, MX0, MX1, MY0, MY1, theta, minX, minY, sc, offX, offY };
}

const stopPts = [[52.320, -0.075], [52.324, -0.070], [52.328, -0.064], [52.332, -0.060], [52.322, -0.068], [52.340, -0.090]];
const ANCHOR = '0500HSTIV002';
const atco2ll = { [ANCHOR]: [52.326, -0.067], X: [52.331, -0.061], Y: [52.319, -0.080] };
const probes = [...stopPts, atco2ll.X, atco2ll.Y, [52.3305, -0.0655]];

const CONFIGS = {
  'PCA orientation, the two-band fisheye': { internalRoads: {} },
  'internalRoads.rotationDeg, as St Ives sets it': { internalRoads: { rotationDeg: -66 } },
  'a detail lens, as Beaconsfield and St Neots carry one': { internalRoads: { lenses: [{ center: [52.326, -0.067], radiusKm: 0.6, mag: 1.8 }] } },
  'the three-zone fisheye and a fit margin': { internalRoads: { focus: { midKm: 1.5, outerComp: 0.3 }, fitMargin: 6 } },
  'focus.center on the centroid': { internalRoads: { focus: { center: 'centroid', comp: 0.6 } } },
};

for (const [name, RJ] of Object.entries(CONFIGS)) {
  test('the real projection reproduces the old copy EXACTLY — ' + name, () => {
    const IR = internalRoadsConfig(RJ);
    const a = legacyProjection({ stopPts, atco2ll, ANCHOR, IR });
    const b = preStageProjection({ stopPts, atco2ll, ANCHOR, IR });
    for (const k of ['MX0', 'MX1', 'MY0', 'MY1', 'theta', 'minX', 'minY', 'sc', 'offX', 'offY']) {
      assert.strictEqual(b[k], a[k], k + ' differs');
    }
    for (const ll of probes) {
      assert.deepStrictEqual(b.XY(ll), a.XY(ll), 'XY differs at ' + ll);
      assert.deepStrictEqual(b.INV(b.XY(ll)), a.INV(a.XY(ll)), 'INV differs at ' + ll);
    }
    assert.strictEqual(b.MY1, 205, 'the legacy frame bottom is 205 mm — adopting the footer-safe frame is OA-230 part two');
  });
}

test('and the lens IS stripped: with lenses honoured the numbers move, which is what part two would ship', () => {
  const IR = internalRoadsConfig(CONFIGS['a detail lens, as Beaconsfield and St Neots carry one']);
  const legacy = legacyProjection({ stopPts, atco2ll, ANCHOR, IR });
  const honoured = projection({ stopPts, atco2ll, ANCHOR, IR, ZOOM: { corePct: 1, comp: 1 },
    OV: {}, FIXED_ORIENTATION: null, FOOTER_SAFE: false, FOOTER_PLATE_TOP: null, DESIGN: {} });
  const inside = [52.3265, -0.0672];   // 60 m from the lens centre
  assert.notDeepStrictEqual(honoured.XY(inside), legacy.XY(inside), 'a lens that changes nothing is not a lens');
});

/* ---- source-level ----------------------------------------------------------- */

const PRE_STAGES = ['diagram_internal.js', 'schematize_internal.js'];
const read = (f) => fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8').replace(/\r\n/g, '\n');

test('both pre-stages take the projection from projection.js, resolved through the engine bootstrap', () => {
  for (const f of PRE_STAGES) {
    const src = read(f);
    assert.ok(src.includes("const { projection } = require(_dep('projection.js'));"), f + ' does not require projection.js');
    assert.ok(src.includes("const { esc } = require(_dep('svg_primitives.js'));"), f + ' does not take esc from svg_primitives.js');
    assert.ok(src.includes('const _proj = projection(Object.assign({ stopPts, atco2ll, ANCHOR,'), f + ' does not call projection()');
  }
});

test('the PCA line lives in projection.js and nowhere else', () => {
  const PCA = 'Math.atan2(2 * sxy, sxx - syy)';
  // Whitespace-blind: projection.js writes it without spaces, the copies wrote it with.
  const squash = (t) => t.replace(/\s+/g, '');
  const carriers = fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js') && squash(read(f)).includes(squash(PCA)));
  assert.deepStrictEqual(carriers, ['projection.js'], 'a second copy of the projection has appeared');
});

test('LEGACY_FRAME still says footerSafe:false and no lenses — flipping it is part two, and a test change', () => {
  for (const f of PRE_STAGES) {
    const src = read(f);
    assert.ok(src.includes('const LEGACY_FRAME = { OV: {}, FIXED_ORIENTATION: null, FOOTER_SAFE: false, FOOTER_PLATE_TOP: null, DESIGN: {} };'),
      f + ': LEGACY_FRAME has changed — if that is the adoption, it needs its version bumps and this assertion rewritten');
    assert.ok(src.includes('IR: Object.assign({}, IR, { lenses: undefined }),'), f + ' has started honouring lenses');
    assert.ok(!/MY1 = 205/.test(src), f + ' carries its own 205 again');
  }
});

test('the guard is the generator\'s: false refuses, absent does not', () => {
  for (const f of PRE_STAGES) {
    const src = read(f);
    assert.ok(src.includes('const IR = internalRoadsConfig(RJ);\nif (!IR) {'), f + ' does not refuse the classic model through the shared reading');
    assert.ok(!src.includes('if (!RJ.internalRoads)'), f + ' still refuses an absent internalRoads key');
  }
});

test('both pre-stages are in the town engine hash (OA-230, Tier 4.3)', () => {
  const { engineFiles, ENGINE_FILES } = load('engine_version.js');
  for (const f of PRE_STAGES) {
    assert.ok(ENGINE_FILES.includes(f), f + ' is not an entry point');
    assert.ok(engineFiles(ENGINE_DIR).includes(f), f + ' is not hashed');
  }
});
