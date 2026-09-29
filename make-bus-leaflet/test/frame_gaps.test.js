/*
 * frame_gaps — design.gapExits (buses-data OA-515).
 *
 * OPT-IN, absent => byte-identical, so the byte gates run only the OFF path, and
 * neither estate fixture has a route that leaves the frame between two of its
 * in-frame stops. What is held here is the rule: a break is found only inside the
 * drawn span, each is recorded pointing OUT of the frame, breaks become events in
 * exit/re-entry pairs with a pair closer than the cluster distance dropped, and
 * gen_internal.js looks for them only when the key is exactly true.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, ENGINE_DIR } = require('./_engine.js');
const { findGapCuts, gapEvents } = load('frame_gaps.js');

// A 0..100 square frame and gen_internal's own two helpers, restated.
const inFrame = (p) => p[0] >= 0 && p[0] <= 100 && p[1] >= 0 && p[1] <= 100;
const frameCut = (p, q) => { let t = 1;
  if (q[0] < 0 && q[0] !== p[0]) t = Math.min(t, (0 - p[0]) / (q[0] - p[0]));
  if (q[0] > 100 && q[0] !== p[0]) t = Math.min(t, (100 - p[0]) / (q[0] - p[0]));
  if (q[1] < 0 && q[1] !== p[1]) t = Math.min(t, (0 - p[1]) / (q[1] - p[1]));
  if (q[1] > 100 && q[1] !== p[1]) t = Math.min(t, (100 - p[1]) / (q[1] - p[1]));
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
const unit = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };

// In at the left, down through the bottom edge at x=20, back in at x=60, on to the right.
const dip = [[10, 50], [20, 90], [20, 110], [60, 110], [60, 90], [90, 50]];

test('a stretch that leaves the frame between in-frame stops gives an exit and a re-entry, each pointing out', () => {
  const cuts = findGapCuts(dip, 0, dip.length - 1, inFrame, frameCut, unit);
  assert.strictEqual(cuts.length, 2);
  assert.deepStrictEqual(cuts[0].p, [20, 100]);
  assert.deepStrictEqual(cuts[1].p, [60, 100]);
  assert.deepStrictEqual(cuts[0].d, [0, 1]);   // both point down, off the sheet
  assert.deepStrictEqual(cuts[1].d, [0, 1]);
});

test('nothing outside the drawn span [s0, e] is looked at', () => {
  assert.deepStrictEqual(findGapCuts(dip, 3, 5, inFrame, frameCut, unit).length, 1);
  assert.deepStrictEqual(findGapCuts([[10, 10], [20, 20], [30, 30]], 0, 2, inFrame, frameCut, unit), []);
});

test('breaks become unlabelled gap events in pairs, and a pair closer than the cluster distance is dropped', () => {
  const cuts = findGapCuts(dip, 0, dip.length - 1, inFrame, frameCut, unit);
  const ev = gapEvents('9', cuts, 7);
  assert.strictEqual(ev.length, 2);
  assert.deepStrictEqual(ev.map(e => [e.r, e.label, e.gap]), [['9', null, true], ['9', null, true]]);
  assert.deepStrictEqual(gapEvents('9', cuts, 41), []);   // 40 mm apart: under a 41 mm threshold
  const touch = findGapCuts([[10, 50], [20, 99], [21, 100.01], [22, 99], [90, 50]], 0, 4, inFrame, frameCut, unit);
  assert.strictEqual(touch.length, 2);
  assert.deepStrictEqual(gapEvents('9', touch, 7), []);   // a vertex a hair past the edge is not a journey
});

test('gen_internal.js looks for breaks only when design.gapExits is exactly true, and adds none twice', () => {
  const src = fs.readFileSync(path.join(ENGINE_DIR, 'gen_internal.js'), 'utf8');
  assert.match(src, /require\(_dep\('frame_gaps\.js'\)\)/);
  assert.match(src, /const gapCuts=DESIGN\.gapExits===true \? findGapCuts\(sh,s0,e,inFrame,frameCut,unit\) : \[\];/);
  assert.match(src, /events\.push\(\.\.\.gapEvents\(r,tr\.gapCuts,CLD\)\)/);
  assert.match(src, /if\(cl && e\.gap && cl\.some\(m=>m\.r===e\.r\)\) continue;/);
});
