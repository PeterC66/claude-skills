/*
 * linear_features — how a river, main road, railway or canal becomes ink.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3). MEASURED the
 * same day by instrumenting every branch and running all 18 maps that have an
 * internal sheet through it, rather than by reading their config — the first
 * attempt read config, and it got the answer wrong, because a town with no
 * features[] still gets a river from the legacy fallback.
 *
 * WHAT THE BYTE GATE COVERS: the projected-geometry path (11 maps), a feature
 * hidden by override (7 — every place map carries features.river.hide against
 * the fallback river), railStitch, railMerge and the chequer symbol (6 each),
 * a plain stroke (10), and the RAIL_CHEQUER layering (6).
 *
 * WHAT IS DARK — no committed map takes it, so only this suite says anything:
 *   - overrides segments / points / move: 0 maps. The whole hand-adjust path
 *     for a linear feature has never been used on a shipped sheet.
 *   - minSegLen: 0. The railway type default sets 3.5, and every railway map
 *     opts into rail:chequer, which sets it back to 0. The comment beside it
 *     says the chequer "retires the minSegLen stub hack"; the measurement
 *     agrees, and nothing exercises it any more.
 *   - a dashed feature: 0. Only `canal` carries a dash by default and no town
 *     has a canal.
 *   - ties: 0. Same reason as minSegLen — RAIL_CHEQUER sets ties:false and all
 *     six railway maps, the two place maps included, take it.
 *
 * The eight polyline helpers are pure, unexported and not reachable from
 * outside, so they are asserted THROUGH drawFeature's output. Two of them carry
 * a fault found on real data — stitchSegs' maxTurn (St Neots' four parallel
 * tracks chaining into one path that doubled back four times) and mergeSegs'
 * trimming rather than dropping a partly-coincident siding — and those two are
 * what this suite is really for.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { linearFeatures } = require('./_engine.js').load('linear_features.js');

const FEATURE_STYLES = {
  river: { stroke: '#9ec9e8', width: 3.4, dash: null },
  canal: { stroke: '#7fb0d8', width: 2.4, dash: '3 1.6' },
  railway: { stroke: '#333333', width: 1.5, dash: null, ties: true, tieEvery: 2.6, tieLen: 1.6, tieWidth: 0.7, minSegLen: 3.5 },
  road: { stroke: '#e6a532', width: 2.8, dash: null },
  generic: { stroke: '#999999', width: 2.2, dash: null },
};
const RAIL_CHEQUER = {
  width: 1.6, ties: false, dash: null, minSegLen: 0, stroke: '#4a4a4a',
  coreWidth: 0.88, coreColor: '#ffffff', chequer: '2.3 2.3',
  railStitch: 0.5, railStitchTurn: 60, railMerge: 1.5, railMinRun: 6,
};

// The identity projection, so a test can write page millimetres directly and
// read them back out of the path data.
const make = (OV = {}) => {
  const lines = [];
  const api = linearFeatures({
    out: (x) => lines.push(x),
    gk: (kind, key, inner) => inner,
    OV, FEATURE_STYLES, RAIL_CHEQUER,
    XY: (p) => [p[0], p[1]],
  });
  return { api, lines };
};
// Every path's `d`, as arrays of [x,y] rounded the way drawFeature prints them.
const paths = (lines) => lines.join('\n').split('\n').filter((l) => l.startsWith('<path'))
  .map((l) => /d="([^"]+)"/.exec(l)[1]);
const pts = (d) => d.split(/(?=[ML])/).map((s) => s.slice(1).trim().split(' ').map(Number));

const feat = (over) => Object.assign({ key: 'river', type: 'river', geo: [[[0, 0], [10, 0]]] }, over);

test('featStyle layers type default, then the chequer preset, then the town — town last', () => {
  const { api } = make();
  const plain = api.featStyle(feat({ type: 'railway' }));
  assert.strictEqual(plain.stroke, '#333333');
  assert.strictEqual(plain.ties, true);
  const chq = api.featStyle(feat({ type: 'railway', style: { rail: 'chequer' } }));
  assert.strictEqual(chq.stroke, '#4a4a4a', 'the preset overrides the type default');
  assert.strictEqual(chq.ties, false);
  const own = api.featStyle(feat({ type: 'railway', style: { rail: 'chequer', stroke: '#000' } }));
  assert.strictEqual(own.stroke, '#000', 'the town keeps the last word on any individual key');
  assert.strictEqual(own.chequer, '2.3 2.3', 'and inherits the rest of the preset');
});

test('an unknown feature type falls back to the generic style', () => {
  const { api } = make();
  assert.strictEqual(api.featStyle(feat({ type: 'ha-ha' })).stroke, '#999999');
});

test('an override style can turn the chequer ON for a type that has no rail default', () => {
  const { api } = make({ features: { river: { style: { rail: 'chequer' } } } });
  assert.strictEqual(api.featStyle(feat({})).chequer, '2.3 2.3');
});

// ---- featSegs: three sources of geometry, two of them dark ------------------

test('with no override the geometry is projected — the path all 11 drawing maps take', () => {
  const { api } = make();
  assert.deepStrictEqual(api.featSegs(feat({ geo: [[[1, 2], [3, 4]]] })), [[[1, 2], [3, 4]]]);
});

test('overrides.segments replaces the geometry outright, in page mm — DARK, 0 maps', () => {
  const { api } = make({ features: { river: { segments: [[[5, 5], [6, 6]], [[7, 7], [8, 8]]] } } });
  assert.deepStrictEqual(api.featSegs(feat({})), [[[5, 5], [6, 6]], [[7, 7], [8, 8]]]);
});

test('overrides.points is the same thing as ONE segment — DARK, 0 maps', () => {
  const { api } = make({ features: { river: { points: [[5, 5], [6, 6]] } } });
  assert.deepStrictEqual(api.featSegs(feat({})), [[[5, 5], [6, 6]]]);
});

test('overrides.move nudges whatever the source was, projected or not — DARK, 0 maps', () => {
  const geo = make({ features: { river: { move: { dx: 1, dy: -2 } } } });
  assert.deepStrictEqual(geo.api.featSegs(feat({ geo: [[[0, 0], [10, 0]]] })), [[[1, -2], [11, -2]]]);
  const both = make({ features: { river: { points: [[0, 0]], move: { dx: 1, dy: 1 } } } });
  assert.deepStrictEqual(both.api.featSegs(feat({})), [[[1, 1]]], 'the nudge applies after the override too');
});

test('featSegs copies the points it is given, so a nudge cannot write back into routes.json', () => {
  const { api } = make({ features: { river: { move: { dx: 1, dy: 1 } } } });
  const geo = [[[0, 0], [10, 0]]];
  api.featSegs(feat({ geo }));
  assert.deepStrictEqual(geo, [[[0, 0], [10, 0]]]);
});

// ---- drawFeature ------------------------------------------------------------

test('a hidden feature draws nothing at all — 7 maps, every place sheet', () => {
  const { api, lines } = make({ features: { river: { hide: true } } });
  api.drawFeature(feat({}));
  assert.deepStrictEqual(lines, []);
});

test('a plain feature is one round-capped stroke — 10 maps', () => {
  const { api, lines } = make();
  api.drawFeature(feat({ geo: [[[0, 0], [10, 5]]] }));
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^<path d="M0.00 0.00 L10.00 5.00" fill="none" stroke="#9ec9e8" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"\/>$/);
});

test('a chequer railway is a casing and a white core, both round-joined — 6 maps', () => {
  const { api, lines } = make();
  api.drawFeature(feat({ type: 'railway', style: { rail: 'chequer' }, geo: [[[0, 0], [20, 0]]] }));
  assert.strictEqual(lines.length, 1, 'both paths go out in ONE gk() group');
  const [casing, core] = lines[0].split('\n');
  assert.match(casing, /stroke="#4a4a4a" stroke-width="1.6" stroke-linecap="butt" stroke-linejoin="round"/);
  assert.match(core, /stroke="#ffffff" stroke-width="0.88" stroke-dasharray="2.3 2.3" stroke-linecap="butt" stroke-linejoin="round"/);
  // The core's linejoin is the recorded fault: without it SVG's default miter
  // threw a 3.2mm spike past a 1.6mm casing at the diagram engine's 148-degree
  // turns, and High Wycombe shipped white blocks bursting out of the band.
  assert.strictEqual((core.match(/stroke-linejoin="round"/g) || []).length, 1);
});

test('a dashed feature takes a BUTT cap, or its gaps fuse shut — DARK, 0 maps (no town has a canal)', () => {
  const { api, lines } = make();
  api.drawFeature(feat({ type: 'canal', geo: [[[0, 0], [10, 0]]] }));
  assert.match(lines[0], /stroke-dasharray="3 1.6"/);
  assert.match(lines[0], /stroke-linecap="butt"/);
});

test('ties are perpendicular bars pitched along each segment — DARK, 0 maps', () => {
  const { api, lines } = make();
  // A plain railway: the type default carries ties:true, but every railway map
  // opts into the chequer, which turns them off. 20mm at tieEvery 2.6 puts the
  // first bar at 1.3 and then every 2.6 to just short of 20.
  api.drawFeature(feat({ type: 'railway', geo: [[[0, 0], [20, 0]]] }));
  const ties = paths(lines).slice(1);
  assert.strictEqual(ties.length, Math.ceil((20 - 1.3) / 2.6));
  const first = pts(ties[0]);
  assert.deepStrictEqual(first, [[1.3, -1.6], [1.3, 1.6]], 'centred on the line, tieLen either side');
  assert.match(lines[0].split('\n')[1], /stroke-width="0.7"/);
});

test('minSegLen drops the short crossover stubs before drawing — DARK, 0 maps', () => {
  const { api, lines } = make();
  api.drawFeature(feat({
    type: 'railway',
    style: { ties: false },
    geo: [[[0, 0], [20, 0]], [[0, 5], [2, 5]]],   // 20mm through-line, 2mm stub
  }));
  const d = paths(lines);
  assert.strictEqual(d.length, 1, 'the 2mm stub is under the 3.5mm floor');
  assert.deepStrictEqual(pts(d[0]), [[0, 0], [20, 0]]);
});

// ---- the polyline helpers, asserted through drawFeature ---------------------

test('railStitch joins ways whose endpoints meet, so the chequer phase runs on', () => {
  const { api, lines } = make();
  api.drawFeature(feat({
    type: 'railway', style: { rail: 'chequer' },
    geo: [[[0, 0], [10, 0]], [[10, 0], [20, 0]]],
  }));
  const casings = lines[0].split('\n').filter((l) => l.includes('#4a4a4a'));
  assert.strictEqual(casings.length, 1, 'two ways became one path');
  assert.deepStrictEqual(pts(paths(lines)[0]), [[0, 0], [10, 0], [20, 0]]);
});

test('railStitch REFUSES a join that doubles back — the St Neots station throat', () => {
  const { api, lines } = make();
  // Two ways that share an endpoint and run back along each other: exactly the
  // shape four parallel tracks made at St Neots, where chaining them produced
  // one path doubling back four times and the dash phases rendered as a solid
  // white core. The turn at the join is 180 degrees, well past maxTurn 60.
  //
  // railMerge is off here on purpose. With it on, the returning way lies inside
  // its 1.5mm tolerance for its whole length and is absorbed — so the sheet
  // comes out right for a completely different reason, and a test that left it
  // on would pass with the stitch guard deleted.
  api.drawFeature(feat({
    type: 'railway', style: { rail: 'chequer', railMerge: 0 },
    geo: [[[0, 0], [10, 0]], [[10, 0], [0, 0.2]]],
  }));
  const casings = lines[0].split('\n').filter((l) => l.includes('#4a4a4a'));
  assert.strictEqual(casings.length, 2, 'left as two paths rather than chained into a fold');
});

test('railMerge keeps the longest line and TRIMS a parallel one, rather than dropping it whole', () => {
  const { api, lines } = make();
  // A siding 0.5mm alongside for the first 20mm — inside railMerge's 1.5mm
  // tolerance — that then diverges. Dropping it whole would lose the divergence;
  // keeping it whole would re-double the main line and interleave the dash
  // phases into a solid core, which is what the first cut of this did.
  // Lengths matter here and it is easy to get wrong: the order is by TOTAL
  // length, so the siding has to be shorter overall than the main line, not
  // just shorter where it runs alongside.
  api.drawFeature(feat({
    type: 'railway', style: { rail: 'chequer', railStitch: 0 },
    geo: [[[0, 0], [60, 0]], [[0, 0.5], [20, 0.5], [20, 15]]],
  }));
  const casings = lines[0].split('\n').filter((l) => l.includes('#4a4a4a')).map((l) => pts(/d="([^"]+)"/.exec(l)[1]));
  assert.strictEqual(casings.length, 2);
  assert.deepStrictEqual(casings[0], [[0, 0], [60, 0]], 'the longest line is kept first and whole');
  const kept = casings[1];
  assert.ok(kept.every((p) => p[1] > 1.5), 'every surviving point is clear of the line already kept');
  assert.ok(kept[kept.length - 1][1] > 13, 'and the divergence itself survives');
});

test('railMerge drops a trimmed stretch shorter than railMinRun as a floating fragment', () => {
  const { api, lines } = make();
  // The siding leaves the main line for 3mm — under the 6mm minRun — and comes
  // back. That stub is a fragment nobody can read, so it goes.
  api.drawFeature(feat({
    type: 'railway', style: { rail: 'chequer', railStitch: 0 },
    geo: [[[0, 0], [40, 0]], [[0, 0.5], [18, 0.5], [19.5, 3], [21, 0.5], [40, 0.5]]],
  }));
  const casings = lines[0].split('\n').filter((l) => l.includes('#4a4a4a'));
  assert.strictEqual(casings.length, 1, 'the whole siding is absorbed, stub included');
});

test('a feature with no geometry draws nothing and does not throw', () => {
  const { api, lines } = make();
  api.drawFeature(feat({ geo: [] }));
  assert.deepStrictEqual(lines, ['']);
});
