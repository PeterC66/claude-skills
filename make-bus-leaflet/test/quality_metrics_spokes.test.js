/*
 * quality_metrics.js — a name repeated on a DIFFERENT SPOKE is the design, not a
 * defect (OA-169, decided by Peter 2026-08-30).
 *
 * WHY THE MEASURE WAS WRONG. On a radial sheet a spoke is drawn to a destination,
 * and a stop several routes genuinely call at is named on each spoke it appears
 * on. Beaconsfield Waitrose prints `St Mary's School` on five spokes — Amersham,
 * Seer Green, Loudwater, Uxbridge and Heathrow — because five routes really do
 * call there, and Wisbech prints `March` at the ends of two spokes that both
 * terminate at March. `duplicateLabels` scored both as hard defects. It was
 * counting the design, the same way `labelsOverBadge` counted `to X` captions
 * before OA-148 split them out.
 *
 * SYNTHETIC SHEETS, DELIBERATELY, and the same argument as its sibling file: a
 * real town proves the measure returns a number, and only a sheet built to hold
 * exactly one case proves it returns the RIGHT one. Each fixture below differs
 * from its neighbour in one thing.
 *
 * THE FOURTH TEST IS THE ONE THAT MATTERS MOST. The split is scoped to `external`
 * basenames, and the fixture proves the scope rather than trusting it: identical
 * geometry saved as `internal.svg` must still be scored, because on a geographic
 * map a name printed twice is a defect whatever line it happens to sit near.
 * Measured 2026-08-30, that is not a stylistic preference — an external sheet
 * carries 9 to 73 ink segments and the nearest-line assignment is decisive by
 * 9-17mm, while a town internal carries up to 14,745 and every assignment came
 * back with a margin of 0.0-0.4mm, which is noise.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyse } = require('./_engine.js').load('quality_metrics.js');
const { scratchDir } = require('../assets/scratch');

let seq = 0;
/* `base` is the whole discriminator, so it is a parameter here rather than a
 * constant: the same body is written as external.svg and as internal.svg. */
function sheet(body, base = 'external') {
  const dir = scratchDir('qm-spoke-' + (seq++) + '-');
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify({ palette: { A: '#4477aa', B: '#ee6677' } }));
  fs.writeFileSync(path.join(dir, base + '.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
    + '<clipPath id="map"><rect x="6" y="30" width="190" height="155"/></clipPath>'
    + body + '</svg>');
  return path.join(dir, base + '.svg');
}

const spoke = (d, c) => `<path d="${d}" stroke="${c}" stroke-width="3.4" fill="none"/>`;
const name = (x, y, t) => `<text x="${x}" y="${y}" font-family="Arial" font-size="2.9" fill="#222">${t}</text>`;

/* Two spokes leaving a hub at (100,120), one to the north-west and one to the
 * north-east, with the same village named on each. 24mm apart, so the pair is
 * inside the 30mm the measure calls a duplicate — the point being that the
 * distance test still fires and the SPOKE test is what excuses it. */
const TWO_SPOKES = spoke('M100 120 L70 60', '#4477aa') + spoke('M100 120 L130 60', '#ee6677');
const ON_BOTH = TWO_SPOKES + name(82, 96, 'Fenstanton') + name(106, 96, 'Fenstanton');

test('a name repeated on a DIFFERENT spoke is reported and not scored', () => {
  const m = analyse(sheet(ON_BOTH)).metrics;
  assert.strictEqual(m.duplicateLabels, 1, 'the raw measure is untouched, so the frozen scorecard stays comparable');
  assert.strictEqual(m.duplicateAcrossSpokes, 1, 'and the split says this one is the design');
  assert.strictEqual(m.duplicateLabelsNet, 0, 'so nothing is scored');
});

test('a name repeated on the SAME spoke is still a defect', () => {
  /* Beaconsfield's real case: `Chesham` once at its spoke's terminus and once at
   * an intermediate stop on the way to it. One route, one line, two labels. */
  const m = analyse(sheet(TWO_SPOKES + name(88, 104, 'Chesham') + name(76, 80, 'Chesham'))).metrics;
  assert.strictEqual(m.duplicateLabels, 1);
  assert.strictEqual(m.duplicateAcrossSpokes, 0, 'both copies belong to the same spoke');
  assert.strictEqual(m.duplicateLabelsNet, 1, 'so it is still scored');
});

test('a copy a READER could not attribute to either spoke is scored', () => {
  /* The threshold is the artwork's own cap-height, and the argument is not
   * arithmetic: a label whose second-nearest line is closer than one cap-height
   * cannot be attributed to a spoke by a reader either, so it is a defect on its
   * own terms. St Ives' second `Boxworth` sits 0.1mm from being assigned the
   * other way and stays scored because of this.
   *
   * THE COORDINATES ARE LOAD-BEARING AND WERE GOT WRONG FIRST TIME. The obvious
   * fixture puts the second copy at x=100, on the hub's axis of symmetry — and
   * that passes whether the guard is there or not, because a tie resolves to
   * whichever spoke was drawn first, which is the SAME spoke the first copy is
   * on, so the pair is not "across" for a reason that has nothing to do with
   * ambiguity. The mutation that deletes the guard survived, and only that said
   * so. At x=100.5 the nearest spoke is genuinely the OTHER one (12.97mm vs
   * 13.86mm) and the margin is 0.89mm, under one 2.9mm cap-height: delete the
   * guard and this pair is wrongly forgiven, which is what the mutation now
   * proves. */
  const m = analyse(sheet(TWO_SPOKES + name(82, 96, 'Fenstanton') + name(100.5, 90, 'Fenstanton'))).metrics;
  assert.strictEqual(m.duplicateLabels, 1);
  assert.strictEqual(m.duplicateAcrossSpokes, 0, 'equidistant is not "on a different spoke"');
  assert.strictEqual(m.duplicateLabelsNet, 1);
});

test('the same geometry on an INTERNAL sheet is scored, because a spoke is a radial idea', () => {
  const m = analyse(sheet(ON_BOTH, 'internal')).metrics;
  assert.strictEqual(m.duplicateLabels, 1);
  assert.strictEqual(m.duplicateAcrossSpokes, null, 'null is "could not tell", not zero — there are no spokes to tell about');
  assert.strictEqual(m.duplicateLabelsNet, 1, 'a name printed twice on a geographic map is a defect whatever it sits near');
});

test('a sheet with no repeat at all reports zero, not null', () => {
  /* The control. A green case is also what a measure that never ran returns, so
   * assert the sheet was actually looked at. */
  const m = analyse(sheet(TWO_SPOKES + name(82, 96, 'Fenstanton') + name(106, 96, 'Swavesey'))).metrics;
  assert.strictEqual(m.duplicateLabels, 0);
  assert.strictEqual(m.duplicateAcrossSpokes, 0);
  assert.strictEqual(m.duplicateLabelsNet, 0);
});
