/*
 * dash_fit.test.js — the dashed-spoke pattern (OA-167).
 *
 * WHAT THIS SUITE IS FOR THAT THE BYTE GATE IS NOT. The byte gate compares a
 * generator's output against its own previous output, so it cannot object to a
 * dash pattern that has been wrong since the day it was written — and this one
 * was, on every area external, for eleven days after the fix existed in another
 * copy of the same primitive. Three generators carried that primitive; a comment
 * in each said "change one, change all three"; the fix was made in one and not the
 * others, TWICE. This file is the test the comment could not be.
 *
 * The property under test is about the pattern AS EMITTED — rounded to 3dp — and
 * not about the exact arithmetic. That distinction is the whole finding: the first
 * attempt at this fix was correct in exact arithmetic (end on a cycle boundary) and
 * took the estate from 2 slivers to SIX, because a boundary is the most fragile
 * place to end when coordinates round to 2dp. The negative control below asserts
 * that, so the rejected design cannot quietly come back.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const DF = require('./_engine.js').load('dash_fit.js');

/* The rejected design, kept here and nowhere else: fit a WHOLE number of cycles. */
const wholeCycle = (len) => {
  const n = Math.max(1, Math.round(len / DF.DASH_CYCLE));
  const k = len / (n * DF.DASH_CYCLE);
  return `${(DF.DASH_ON * k).toFixed(3)} ${(DF.DASH_OFF * k).toFixed(3)}`;
};

const sweep = (step = 0.01, from = 5, to = 200) => {
  const out = [];
  for (let L = from; L <= to + 1e-9; L += step) out.push(Math.round(L * 100) / 100);
  return out;
};

test('the nominal pattern is 2.6mm on, 2.4mm off, and the target is mid-gap', () => {
  assert.strictEqual(DF.DASH_ON, 2.6);
  assert.strictEqual(DF.DASH_OFF, 2.4);
  assert.strictEqual(DF.DASH_CYCLE, 5);
  assert.ok(Math.abs(DF.DASH_TARGET - 0.76) < 1e-12,
    'the target is a complete dash plus HALF a gap into the final cycle');
});

test('a fitted line never ends in ink, across every length an external sheet draws', () => {
  const bad = sweep().filter(L => DF.tailInk(L, DF.dashFit(L)) !== 0);
  assert.deepStrictEqual(bad, [],
    'every one of these lengths ends inside a dash, which is the sliver this exists to prevent');
});

test('and it ends comfortably clear of the ink either side, not just barely', () => {
  const worst = sweep().reduce((m, L) => Math.min(m, DF.gapClearance(L, DF.dashFit(L))), Infinity);
  assert.ok(worst > 0.8, `the tightest clearance over 5..200mm is ${worst.toFixed(4)}mm, expected > 0.8`);
});

test('THE REJECTED DESIGN FAILS THIS TEST, which is why it is written down', () => {
  // Ending on a cycle boundary. Correct in exact arithmetic; 9,826 sliver lengths
  // once the pattern is rounded to 3dp the way it is written into the SVG.
  const slivers = sweep().filter(L => {
    const t = DF.tailInk(L, wholeCycle(L));
    return t > 0 && t < 0.1;
  });
  assert.ok(slivers.length > 1000,
    'the whole-cycle target should produce thousands of slivers; if this goes green, '
    + 'either tailInk stopped measuring or dashFit has been reverted to the boundary target');
});

test('the flat 2.6 2.4 pattern is what put a sliver on a PUBLISHED sheet', () => {
  // St Ives external.svg, a 115.09mm dashed polyline, measured 2026-08-29.
  const flat = DF.tailInk(115.09, '2.6 2.4');
  assert.ok(flat > 0 && flat < 0.1, `expected a sub-0.1mm sliver, got ${flat}`);
  assert.strictEqual(DF.tailInk(115.09, DF.dashFit(115.09)), 0, 'the fit removes it');
});

test('both phases scale by the same factor, so the duty ratio survives the fit', () => {
  for (const L of [7, 31.4, 88, 115.09, 199.5]) {
    const [on, off] = DF.dashFit(L).split(' ').map(Number);
    // 3dp rounding is the only thing allowed to move the ratio.
    assert.ok(Math.abs(on / off - DF.DASH_ON / DF.DASH_OFF) < 2e-3,
      `duty ratio drifted at ${L}mm: ${on}/${off}`);
  }
});

test('a line shorter than one cycle still gets a whole dash and a gap, not a stub', () => {
  for (const L of [0.4, 1.2, 3, 4.9]) {
    const dash = DF.dashFit(L);
    const [on, off] = dash.split(' ').map(Number);
    assert.ok(on > 0 && off > 0, `degenerate pattern at ${L}mm: ${dash}`);
    assert.strictEqual(DF.tailInk(L, dash), 0);
  }
});

test('polylineLength measures the DRAWN length, not the straight line between the ends', () => {
  // A two-point spoke and a multi-point polyline are the same case. Treating them
  // as different is how the 2026-08-29 sweep counted 14 dashed spokes and missed
  // the 34 polylines — and the third sliver was in the half it did not look at.
  assert.strictEqual(DF.polylineLength([[0, 0], [3, 4]]), 5);
  assert.strictEqual(DF.polylineLength([[0, 0], [3, 4], [3, 9]]), 10);
  assert.strictEqual(DF.polylineLength([[0, 0], [0, 0]]), 0);
  assert.strictEqual(DF.polylineLength([[7, 7]]), 0, 'a single point has no length');
});

test('tailInk and gapClearance are complementary, and one of them is always zero', () => {
  for (const L of [12, 37.5, 115.09]) {
    for (const dash of [DF.dashFit(L), '2.6 2.4', wholeCycle(L)]) {
      const ink = DF.tailInk(L, dash), clear = DF.gapClearance(L, dash);
      assert.ok(ink === 0 || clear === 0,
        'a line ends either inside a dash or inside a gap, never both');
    }
  }
});
