/*
 * casing_width — internalRoads.casingSmooth (buses-data OA-064).
 *
 * The estate cannot certify this key: no committed map sets it, so every byte
 * gate runs the OFF path. What is held here is the rule the measurement chose —
 * NARROWING ONLY, a length-weighted median, along the casing graph, within
 * k x the segment's own width — and that gen_internal.js leaves the casing alone
 * when the key is absent.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, ENGINE_DIR } = require('./_engine.js');
const { smoothCasingWidths } = load('casing_width.js');

// A straight road along y = 0 from x = 0, one segment per [len, w].
function road(spec, y = 0) {
  let x = 0;
  return spec.map(([len, w]) => { const s = { x0: x, y0: y, x1: x + len, y1: y, w }; x += len; return s; });
}

test('a knot of short wide segments on a narrow road is narrowed to the road', () => {
  const segs = road([[20, 6], [20, 6], [1, 24], [1, 24], [1, 24], [20, 6], [20, 6]]);
  const w = smoothCasingWidths(segs, 1);
  assert.deepStrictEqual(w.slice(2, 5), [6, 6, 6], 'the disc segments should take the road width');
  assert.deepStrictEqual([w[0], w[1], w[5], w[6]], [6, 6, 6, 6], 'the road itself is unchanged');
});

test('a long wide street keeps its width — its median is itself', () => {
  const segs = road([[30, 6], [15, 20], [15, 20], [15, 20], [15, 20], [30, 6]]);
  const w = smoothCasingWidths(segs, 1);
  assert.deepStrictEqual(w.slice(1, 5), [20, 20, 20, 20]);
});

test('NARROWING ONLY: a narrow segment beside wide ones is never widened', () => {
  // A plain median would lift the 3 mm stub to 20; the measurement rejected that.
  const segs = road([[15, 20], [15, 20], [2, 3], [15, 20], [15, 20]]);
  const w = smoothCasingWidths(segs, 1);
  assert.strictEqual(w[2], 3);
  w.forEach((v, i) => assert.ok(v <= segs[i].w, 'segment ' + i + ' widened'));
});

test('the walk is ALONG THE GRAPH: a disjoint narrow road nearby does not count', () => {
  const knot = road([[1, 24], [1, 24], [1, 24]]);
  const other = road([[40, 4], [40, 4]], 2);   // 2 mm away, but not joined
  const w = smoothCasingWidths(knot.concat(other), 1);
  assert.deepStrictEqual(w.slice(0, 3), [24, 24, 24]);
});

test('segments join where their endpoints agree to 0.01 mm, as the SVG prints them', () => {
  const segs = road([[20, 6], [1, 24], [20, 6]]);
  segs[1].x0 += 0.001; segs[1].x1 -= 0.001;    // same printed endpoint
  assert.strictEqual(smoothCasingWidths(segs, 1)[1], 6);
});

test('k widens the window: at k = 0.01 a disc sees only itself', () => {
  const segs = road([[20, 6], [1, 24], [20, 6]]);
  assert.strictEqual(smoothCasingWidths(segs, 0.01)[1], 24);
});

test('deterministic and pure: the same input gives the same widths, and the input is untouched', () => {
  const segs = road([[20, 6], [1, 24], [1, 24], [20, 6]]);
  const before = JSON.stringify(segs);
  assert.deepStrictEqual(smoothCasingWidths(segs, 1), smoothCasingWidths(segs, 1));
  assert.strictEqual(JSON.stringify(segs), before);
});

test('gen_internal.js smooths only when internalRoads.casingSmooth asks', () => {
  const src = fs.readFileSync(path.join(ENGINE_DIR, 'gen_internal.js'), 'utf8');
  assert.match(src, /require\(_dep\('casing_width\.js'\)\)/);
  assert.match(src, /const _ks = IR\.casingSmooth===true \? 1 : \+IR\.casingSmooth;/);
  assert.match(src, /_ks>0 \? smoothCasingWidths\(CAS, _ks\) : CAS\.map\(g=>g\.w\)/);
});
