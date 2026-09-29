/*
 * frame_gaps — design.gapExits (buses-data OA-515, OA-519).
 *
 * OPT-IN, absent => byte-identical, so the byte gates run only the OFF path, and
 * neither estate fixture has a route that leaves the frame between two of its
 * in-frame stops. What is held here is the rule: a break is found only inside the
 * drawn span, each is recorded pointing OUT of the frame, breaks become events in
 * exit/re-entry pairs with a pair closer than the cluster distance dropped, and
 * gen_internal.js looks for them only when the key is exactly true. OA-519 adds
 * the three cases Ely Co-op got wrong: a sliver between a re-entry and the next
 * exit merges its two pairs, an out-and-back to one point is kept when the
 * stretch it hides is long, and an event carries the label it is given.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, ENGINE_DIR } = require('./_engine.js');
const { findGapCuts, gapEvents, gapLabel } = load('frame_gaps.js');

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

test('breaks become gap events in pairs, and a pair closer than the cluster distance is dropped', () => {
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
  assert.match(src, /events\.push\(\.\.\.gapEvents\(r,tr\.gapCuts,CLD,\{label:gapLabel\(lt,tr,TL\[r\]\),stops:tr\.stopParams\}\)\)/);
  assert.match(src, /if\(cl && e\.gap && cl\.some\(m=>m\.r===e\.r\)\) continue;/);
});

// OA-519. Down through the bottom edge at x=20, back in at x=60, a 1 mm sliver
// inside at x=61, out again, back in at x=90: Ely's 10 on its top edge.
const sliver = [[10, 50], [20, 90], [20, 110], [60, 110], [60, 99.5], [61, 99.5], [61, 110], [90, 110], [90, 90], [95, 50]];

test('OA-519 case 1: a re-entry and the next exit within the cluster distance, no stop between, are one excursion', () => {
  const cuts = findGapCuts(sliver, 0, sliver.length - 1, inFrame, frameCut, unit);
  assert.strictEqual(cuts.length, 4);
  const ev = gapEvents('10', cuts, 7);
  assert.deepStrictEqual(ev.map(e => e.cut.p), [[20, 100], [90, 100]]);   // no device on the sliver
});

test('OA-519 case 1: a stop on the sliver keeps it a place the route calls, so the pairs stay apart', () => {
  const cuts = findGapCuts(sliver, 0, sliver.length - 1, inFrame, frameCut, unit);
  const ev = gapEvents('10', cuts, 7, { stops: [0.5, 4.5, 8.5] });   // 4.5: on the sliver
  assert.deepStrictEqual(ev.map(e => e.cut.p), [[20, 100], [60, 100], [61, 100], [90, 100]]);
});

test('OA-519 case 2: out and back through one point is kept when the stretch off the sheet is long, and a hair is not', () => {
  const excursion = [[10, 50], [20, 90], [20, 150], [21, 150], [21, 90], [95, 50]];   // 100 mm off, back 1 mm along
  const cuts = findGapCuts(excursion, 0, excursion.length - 1, inFrame, frameCut, unit);
  assert.strictEqual(cuts.length, 2);
  assert.strictEqual(gapEvents('ZIP', cuts, 7).length, 2);
  const touch = findGapCuts([[10, 50], [20, 99], [21, 100.01], [22, 99], [90, 50]], 0, 4, inFrame, frameCut, unit);
  assert.deepStrictEqual(gapEvents('ZIP', touch, 7), []);
});

test('OA-519 case 3: a gap event carries the label it is given', () => {
  const cuts = findGapCuts(dip, 0, dip.length - 1, inFrame, frameCut, unit);
  assert.deepStrictEqual(gapEvents('10', cuts, 7, { label: 'Little Downham' }).map(e => e.label), ['Little Downham', 'Little Downham']);
});

test('OA-519 case 3: the label is the route\'s own "to X" only where no terminus cut carries it', () => {
  const none = {}, cut = { endCut: { p: [0, 0] } };
  assert.strictEqual(gapLabel({ start: 'Little Downham', end: false }, none, null), 'Little Downham');   // Ely's 10
  assert.strictEqual(gapLabel({ start: 'Cambridge', end: 'Littleport' }, cut, null), null);            // Ely's 9: its cuts say it
  assert.strictEqual(gapLabel({ start: false, end: false }, none, 'Ely'), 'Ely');                      // terminiLabels behind it
  assert.strictEqual(gapLabel({ start: false, end: false, gap: false }, none, 'Ely'), null);
  assert.strictEqual(gapLabel({ gap: 'Witchford' }, cut, null), 'Witchford');
});
