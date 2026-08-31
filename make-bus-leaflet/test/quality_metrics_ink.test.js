/*
 * quality_metrics.js — the two measures added on 2026-08-28: ink printed ON ink.
 *
 * OA-021 (a label printed over a route badge, and a badge over a badge) and
 * OA-118 (a lane mirror — a co-running bundle flipped around its own centreline
 * so its members swap sides). Both are things a reader sees the instant the
 * sheet is in front of them and every other measure in the file scored as zero:
 * a badge is not a label (its glyph is `dominant-baseline="central"` and is
 * excluded by construction), not an icon (icons.js emits a SCALED <g>; a badge
 * translates only), and a filled disc is not a stroke, so the occupancy grid
 * never hears about it either.
 *
 * SYNTHETIC SHEETS, DELIBERATELY. A real town proves the measure returns a
 * number; only a sheet built to contain exactly one defect proves it returns the
 * RIGHT number, and only a near-miss beside it proves the measure is not simply
 * firing on everything. Both measures are defined by the route palette, so every
 * fixture here carries its own routes.json.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyse } = require('./_engine.js').load('quality_metrics.js');
const { scratchDir } = require('../assets/scratch');

const PAL = { A: '#4477aa', B: '#ee6677', C: '#228833' };

let seq = 0;
// Wrap `body` in the frame an internal sheet has: a clipPath the tool reads as
// the map frame, so the panel column and the footer band are where analyse()
// expects them and nothing here is excluded for sitting outside the map.
function sheet(body, palette = PAL) {
  const dir = scratchDir('qm-ink-' + (seq++) + '-');
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify({ palette }));
  fs.writeFileSync(path.join(dir, 'internal.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
    + '<clipPath id="map"><rect x="6" y="30" width="190" height="155"/></clipPath>'
    + body + '</svg>');
  return path.join(dir, 'internal.svg');
}
const badge = (x, y, col, key, r = 4.6) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" stroke="#fff" stroke-width="0.7"/>`
  + `<text x="${x}" y="${y}" font-family="Arial" font-weight="bold" font-size="${r}" fill="#fff"`
  + ` text-anchor="middle" dominant-baseline="central">${key}</text>`;
// A stadium badge: what svg_primitives.js draws when the key is too wide for the
// disc. It is a BOX, and treating its half-width as a radius is the bug the first
// cut of this measure had.
const stadium = (x, y, col, key, hw = 9, r = 4.6) =>
  `<rect x="${x - hw}" y="${y - r}" width="${2 * hw}" height="${2 * r}" rx="${r}" fill="${col}" stroke="#fff" stroke-width="0.7"/>`
  + `<text x="${x}" y="${y}" font-weight="bold" font-size="${r}" fill="#fff"`
  + ` text-anchor="middle" dominant-baseline="central">${key}</text>`;
const label = (x, y, t) => `<text x="${x}" y="${y}" font-size="3" fill="#111">${t}</text>`;
const ribbon = (pts, col) =>
  `<g clip-path="url(#map)"><path d="M${pts.map(p => p.join(' ')).join('L')}" stroke="${col}" stroke-width="2.6" fill="none"/></g>`;

// ------------------------------------------------------------- OA-021, labels
test('a label sitting on a route badge is counted, and one clear of it is not', () => {
  const on = analyse(sheet(badge(60, 100, '#4477aa', '5') + label(56, 101, 'Market Hill'))).metrics;
  assert.strictEqual(on.labelsOverBadge, 1);
  const off = analyse(sheet(badge(60, 100, '#4477aa', '5') + label(90, 140, 'Market Hill'))).metrics;
  assert.strictEqual(off.labelsOverBadge, 0);
});

/* ---- OA-148: the two populations inside labelsOverBadge -------------------
 *
 * The measure's own comment used to assert that a "to X" terminus caption could
 * never land here, because termBadge() reserves its box. Measured on 2026-08-29
 * across all 52 sheets, **31 of the 44 hits were exactly that** — so the whole
 * number read as placer-attributable when two thirds of it is a caption sitting
 * beside the frame exit it names. `exitCaptionOverBadge` splits them, the same
 * correction `exitTailOverInk` already applies to the sibling pt/ink measure.
 *
 * The name test is the same `^to\s` one, with the same limitation: it tells a
 * caption from a place name, and it does NOT tell a caption on its own badge
 * from one on a neighbour's.
 */
test('a "to X" caption on a badge is counted separately from a place name on one', () => {
  const cap = analyse(sheet(badge(60, 100, '#4477aa', '5') + label(56, 101, 'to Newmarket'))).metrics;
  assert.strictEqual(cap.labelsOverBadge, 1, 'still counted in the raw total');
  assert.strictEqual(cap.exitCaptionOverBadge, 1);
  assert.strictEqual(cap.labelsOverBadgeNet, 0, 'and worth nothing against the placer');

  const name = analyse(sheet(badge(60, 100, '#4477aa', '5') + label(56, 101, 'Market Hill'))).metrics;
  assert.strictEqual(name.labelsOverBadge, 1);
  assert.strictEqual(name.exitCaptionOverBadge, 0);
  assert.strictEqual(name.labelsOverBadgeNet, 1, 'this is the one the placer owns');
});

test('the raw total is left alone, so the frozen scorecard stays comparable', () => {
  const m = analyse(sheet(badge(60, 100, '#4477aa', '5') + label(56, 101, 'to Newmarket')
    + badge(60, 140, '#ee6677', '9') + label(56, 141, 'Market Hill'))).metrics;
  assert.strictEqual(m.labelsOverBadge, 2, 'the number the ledger has tracked all along');
  assert.strictEqual(m.exitCaptionOverBadge, 1);
  assert.strictEqual(m.labelsOverBadgeNet, 1);
});

/* ---- OA-148: the measure's own box, 2026-08-30 ---------------------------
 *
 * A road name is drawn ALONG its road, so at 40 degrees its axis-aligned box is
 * a rectangle most of which the glyphs are nowhere near. This measure tested
 * that box, so a badge parked in a corner of it was reported as ink under the
 * name. Two of the thirteen placer-attributable hits on the board were exactly
 * that, and neither is a defect.
 *
 * The two fixtures below are ONE label at ONE angle with the badge in two
 * places, because that is what separates "the measure is exact" from "the
 * measure stopped firing": the corner case must go, and the one genuinely under
 * the glyphs must stay.
 */
const road = (x, y, t, deg) =>
  `<text x="${x}" y="${y}" font-size="2.5" fill="#666" text-anchor="middle"`
  + ` transform="rotate(${deg} ${x} ${y})">${t}</text>`;

test('a badge in the CORNER of a rotated road name bounding box is not under it', () => {
  // "Somersham Road" at 40 degrees spans (53.4,92.2)-(68.9,105.1); its bounding
  // box reaches down to y=106.9 at x=51.9, which is 11mm of empty paper.
  const m = analyse(sheet(badge(52.5, 105.5, '#4477aa', '5') + road(60, 100, 'Somersham Road', 40))).metrics;
  assert.strictEqual(m.labelsOverBadge, 0, 'the glyphs are nowhere near it');
});

test('...and a badge genuinely under the same rotated name still counts', () => {
  const m = analyse(sheet(badge(60.4, 99.5, '#4477aa', '5') + road(60, 100, 'Somersham Road', 40))).metrics;
  assert.strictEqual(m.labelsOverBadge, 1, 'the exact test must not simply stop firing');
});

test('a label merely STARTING with the letters "to" is not a caption', () => {
  // "Tower Road" must not be excused by a prefix match. The sibling measure uses
  // /^to\s/ for the same reason and this fixture is what keeps the two honest.
  const m = analyse(sheet(badge(60, 100, '#4477aa', '5') + label(56, 101, 'Tower Road'))).metrics;
  assert.strictEqual(m.exitCaptionOverBadge, 0);
  assert.strictEqual(m.labelsOverBadgeNet, 1);
});

/* THE WARNING MUST CARRY THE SPLIT EVEN WHEN THERE ARE NO CAPTIONS (2026-08-30).
 *
 * The metrics were right from the day the split landed; the REPORT was not. The
 * warning printed its parenthetical only when `exitCaptionOverBadge` was truthy,
 * so a sheet whose hits were ALL placer-attributable — the worst case, and the
 * only one worth acting on — printed the bare total and no split at all. Eight
 * of the nine sheets carrying a net hit on 2026-08-30 were exactly that shape,
 * so reading the estate figures off `--detail` gave 38/36/2 where the truth was
 * 49/36/13. The suppression hid the number precisely where it was highest, and
 * it did it silently: a missing parenthetical looks like a sheet with nothing to
 * split, not like a sheet that is entirely the thing you are hunting.
 *
 * A measure can be correct and still lie in its report. This asserts the string,
 * because the string is what anybody actually reads.
 */
test('the warning names the split even when NONE of the hits is a caption', () => {
  const worst = analyse(sheet(badge(60, 100, '#4477aa', '5') + label(56, 101, 'Market Hill')));
  const w = worst.warns.find((x) => /labels? printed over a route badge/.test(x));
  assert.ok(w, 'the badge warning did not appear at all');
  assert.match(w, /0 of them frame-exit captions, 1 placer-attributable/,
    'a sheet with no captions must still say so — suppressing the split hides the all-placer case');

  // The control: the mixed sheet still reports the same way, so this is a
  // widening of the report and not a swap of one silence for another.
  const mixed = analyse(sheet(badge(60, 100, '#4477aa', '5') + label(56, 101, 'to Newmarket')
    + badge(60, 140, '#ee6677', '9') + label(56, 141, 'Market Hill')));
  assert.match(mixed.warns.find((x) => /route badge/.test(x)),
    /2 labels printed over a route badge \(1 of them frame-exit captions, 1 placer-attributable\)/);
});

test('an unreadable palette makes the split null too, not a clean zero', () => {
  const dir = scratchDir('qm-ink-nopal-split-');
  fs.writeFileSync(path.join(dir, 'internal.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
    + '<clipPath id="map"><rect x="6" y="30" width="190" height="155"/></clipPath>'
    + badge(60, 100, '#4477aa', '5') + label(56, 101, 'to Newmarket') + '</svg>');
  const m = analyse(path.join(dir, 'internal.svg')).metrics;
  assert.strictEqual(m.labelsOverBadge, null);
  assert.strictEqual(m.exitCaptionOverBadge, null);
  assert.strictEqual(m.labelsOverBadgeNet, null, '"could not tell" must not read as clean');
});

test('a label over TWO badges is one defect, not one per badge under it', () => {
  const m = analyse(sheet(badge(60, 100, '#4477aa', '5') + badge(70, 100, '#ee6677', '9')
    + label(56, 101, 'A very long street name indeed'))).metrics;
  assert.strictEqual(m.labelsOverBadge, 1);
});

test('the badge\'s OWN glyph is never counted against it', () => {
  // The key inside the roundel is dominant-baseline="central" and excluded from
  // mapLabels by construction; if that ever stopped being true every badge on
  // every sheet would report itself as a defect.
  // The radius must be small enough that the glyph is not skipped by the
  // 4.5mm title rule instead — at the default 4.6mm radius this fixture passed
  // for the wrong reason and the mutation run said so.
  const m = analyse(sheet(badge(60, 100, '#4477aa', '5', 2.4))).metrics;
  assert.strictEqual(m.labelsOverBadge, 0);
});

test('a disc that is not a route colour is not a badge', () => {
  // A stop tick, a POI dot, the hub. The palette is the whole discriminator.
  const m = analyse(sheet('<circle cx="60" cy="100" r="4.6" fill="#888888"/>' + label(56, 101, 'Market Hill'))).metrics;
  assert.strictEqual(m.labelsOverBadge, 0);
});

test('a sheet with no readable palette reports null, not a clean zero', () => {
  const dir = scratchDir('qm-ink-nopal-');
  fs.writeFileSync(path.join(dir, 'internal.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 210">'
    + '<clipPath id="map"><rect x="6" y="30" width="190" height="155"/></clipPath>'
    + badge(60, 100, '#4477aa', '5') + label(56, 101, 'Market Hill') + '</svg>');
  const m = analyse(path.join(dir, 'internal.svg')).metrics;
  assert.strictEqual(m.labelsOverBadge, null);
  assert.strictEqual(m.badgeOverBadge, null);
  assert.strictEqual(m.laneCrossings, null);
});

// ------------------------------------------------------------ OA-021, badges
test('two badges printed on each other are counted', () => {
  const m = analyse(sheet(badge(60, 100, '#4477aa', '301') + badge(61, 100.5, '#ee6677', '302'))).metrics;
  assert.strictEqual(m.badgeOverBadge, 1);
});

test('a legitimate badge STACK clears itself and is never counted', () => {
  // badgeStack() pitches its members at 2r + 0.5, so a bundled corridor's stack
  // has a 0.5mm gap by construction. If this fired, every bundled town would
  // report defects for drawing exactly what it was asked to draw.
  const r = 2.4, pitch = 2 * r + 0.5;
  const m = analyse(sheet(badge(60, 100, '#4477aa', '1', r)
    + badge(60, 100 + pitch, '#ee6677', '2', r)
    + badge(60, 100 + 2 * pitch, '#228833', '3', r))).metrics;
  assert.strictEqual(m.badgeOverBadge, 0);
});

test('two STADIUM badges side by side do not overlap, though their half-widths do', () => {
  // The first cut of this measure tested centre distance against max(rx, ry) and
  // read a 9mm half-width as a 9mm radius in both directions — reporting nine
  // overprints on High Wycombe internal, of which most were tidy neighbours.
  // Stacked, not side by side: a stadium's rx IS its max, so the two rules agree
  // along x and differ only along y. Side by side, this fixture could not tell
  // them apart at all — which the mutation run found the day it was written.
  const clear = analyse(sheet(stadium(60, 100, '#4477aa', 'X31') + stadium(60, 110, '#ee6677', 'X32'))).metrics;
  assert.strictEqual(clear.badgeOverBadge, 0);
  // ...but a real overlap of two stadia is still caught.
  const over = analyse(sheet(stadium(60, 100, '#4477aa', 'X31') + stadium(64, 101, '#ee6677', 'X32'))).metrics;
  assert.strictEqual(over.badgeOverBadge, 1);
});

test('a badge in the Services panel is not on the map', () => {
  // The panel key draws one badge per service, in a column, and it is furniture.
  const m = analyse(sheet(badge(210, 100, '#4477aa', '5') + badge(210, 104, '#ee6677', '9'))).metrics;
  assert.strictEqual(m.badgeOverBadge, 0);
});

// -------------------------------------------------------------------- OA-118
test('two ribbons that cross shallowly are counted as one crossing', () => {
  const m = analyse(sheet(
    ribbon([[40, 98], [70, 98], [100, 102]], '#4477aa') +
    ribbon([[40, 102], [70, 102], [100, 98]], '#ee6677'))).metrics;
  assert.strictEqual(m.laneCrossings, 1);
});

test('the measure does NOT claim to find a lane mirror, and that is the point', () => {
  // WITHDRAWN 2026-08-28, the day it was written, on the evidence of the
  // artwork. `laneMirrors` classified a crossing as a mirror when the lane
  // spacing was the same either side of it. The first site anybody LOOKED at
  // disproved it in both directions: High Wycombe internal, the street at
  // x≈156 — with laneOrientation OFF the 32/32A and 34 ribbons swap sides
  // between y=126 and y=128 at a near-constant 2.9mm gap, a textbook mirror,
  // and the measure scored it ZERO, because that swap happens as a JUMP
  // between vertices and a crossing-based test cannot see a mirror that does
  // not cross. With the fix ON the ribbons keep their order and it reported
  // one. This assertion is what stops the field coming back without the
  // evidence that it works.
  const m = analyse(sheet(
    ribbon([[40, 98], [70, 98], [100, 102]], '#4477aa') +
    ribbon([[40, 102], [70, 102], [100, 98]], '#ee6677'))).metrics;
  assert.strictEqual(m.laneMirrors, undefined);
  assert.ok(!('laneMirrors' in m));
});

test('a route crossing ITSELF is the town, not the placer', () => {
  // An out-and-back leg is one colour twice, and never a lane mirror.
  const m = analyse(sheet(
    ribbon([[40, 98], [100, 102]], '#4477aa') +
    ribbon([[40, 102], [100, 98]], '#4477aa'))).metrics;
  assert.strictEqual(m.laneCrossings, 0);
});

test('a steep crossing is a junction and is not counted at all', () => {
  const m = analyse(sheet(
    ribbon([[40, 100], [140, 100]], '#4477aa') +
    ribbon([[90, 60], [90, 150]], '#ee6677'))).metrics;
  assert.strictEqual(m.laneCrossings, 0);
});

test('one visual crossing is one site, however many segments make it', () => {
  // A polyline is hundreds of segments and two ribbons interleave through a
  // swap, so without clustering a single crossing reports as dozens.
  const zig = (y0, y1, col) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push([60 + i * 0.5, y0 + (y1 - y0) * i / 20]);
    return ribbon(pts, col);
  };
  const m = analyse(sheet(zig(99, 101, '#4477aa') + zig(101, 99, '#ee6677'))).metrics;
  assert.strictEqual(m.laneCrossings, 1);
});

test('a badge printed on a badge is a HARD defect and a failure', () => {
  // FOLDED IN 2026-08-28, once OA-060 and OA-147 had emptied the board. Both
  // measures were reported and unscored for exactly as long as they were
  // non-zero, because a check that is red on the day it lands gets muted within
  // the week; the fold-in was gated on the sheets, not on an opinion.
  const clean = analyse(sheet(label(56, 101, 'Market Hill'))).metrics;
  const r = analyse(sheet(badge(60, 100, '#4477aa', '301') + badge(61, 100.5, '#ee6677', '302')
    + label(56, 101, 'Market Hill')));
  assert.strictEqual(r.metrics.badgeOverBadge, 1);
  assert.strictEqual(r.metrics.hard, clean.hard + 1);
  assert.ok(r.fails.some(f => /printed on each other/.test(f)));
});

test('a destination lozenge printed on another is a HARD defect and a failure', () => {
  const r = analyse(extSheet(loz(80, 100, 30, 11, 'Cambridge') + loz(105, 100, 30, 11, 'Ely')));
  const clean = analyse(extSheet(loz(80, 100, 30, 11, 'Cambridge'))).metrics;
  assert.strictEqual(r.metrics.lozengeOverlap, 1);
  assert.strictEqual(r.metrics.hard, clean.hard + 1);
  assert.ok(r.fails.some(f => /lozenges printed on each other/.test(f)));
});

test('labelsOverBadge is still REPORTED and not scored, and that is not an oversight', () => {
  // It stands at 47 across the board, so scoring it today would fail the ratchet
  // on every affected sheet at once — the outcome the whole convention exists to
  // avoid. Same rule as the other two, applied honestly to a different number.
  // This test is what stops it being folded in by tidiness rather than by
  // measurement: it will fail the day somebody does it, and the fix is to empty
  // the board first.
  const clean = analyse(sheet(badge(60, 100, '#4477aa', '5'))).metrics;
  const r = analyse(sheet(badge(60, 100, '#4477aa', '5') + label(56, 101, 'Market Hill')));
  assert.strictEqual(r.metrics.labelsOverBadge, 1);
  assert.strictEqual(r.metrics.hard, clean.hard);
  assert.ok(r.warns.some(w => /over a route badge/.test(w)));
});

test('a sheet that cannot measure either is not charged for one', () => {
  // null means "could not tell" — an unreadable routes.json, or a sheet type
  // with no lozenges at all. Charging a hard defect for an absent measurement
  // would make an unmeasurable sheet look like a defective one.
  const r = analyse(sheet(badge(60, 100, '#4477aa', '301') + badge(61, 100.5, '#ee6677', '302'), {}));
  assert.strictEqual(r.metrics.badgeOverBadge, null);
  assert.strictEqual(r.metrics.lozengeOverlap, null);
  const bare = analyse(sheet(label(56, 101, 'Market Hill'), {})).metrics;
  assert.strictEqual(r.metrics.hard, bare.hard);
  // ...and it must not be REPORTED as failing either. A null compared with !== 0
  // is true, so the obvious spelling of this guard announces "null route badges
  // printed on each other" on every sheet whose palette would not parse.
  assert.ok(!r.fails.some(f => /printed on each other/.test(f)), r.fails.join(" | "));
});

// ------------------------------------ OA-060, the badge rule made exact
/*
 * THE BOX RULE WAS RIGHT ABOUT STADIUMS AND WRONG ABOUT DISCS. OA-021's first cut
 * was radial and invented defects on stadiums; the box test that replaced it
 * invented them on discs instead, wherever two sat on a diagonal. Measured across
 * the committed board on 2026-08-28: of 30 reported badge overprints, SEVENTEEN
 * were pairs with real daylight between them -- the shape a badge row makes on any
 * diagonal spoke, where consecutive members sit at a pitch barely over a diameter.
 * The honest board was 13.
 */
test('two discs on a diagonal with daylight between them are not an overprint', () => {
  // r=3.4 discs 7.22mm apart: 0.42mm of clear paper. Their bounding boxes overlap
  // 3.10 x 0.60mm, which is what the box rule called a defect on real sheets.
  // 4.8 x 5.2mm apart => centres 7.08mm, radii sum 6.8mm, 0.28mm of clear paper.
  // The box rule sees 2.0 x 1.6mm of overlap and calls it a defect; both figures
  // are well clear of the 0.6mm tolerance, so this fixture cannot pass by luck.
  const m = analyse(sheet(badge(80, 100, '#4477aa', '9', 3.4)
    + badge(84.8, 105.2, '#ee6677', '12', 3.4))).metrics;
  assert.strictEqual(m.badgeOverBadge, 0);
  // ...and the genuinely overlapping pair right beside it still counts.
  const over = analyse(sheet(badge(80, 100, '#4477aa', '9', 3.4)
    + badge(82.5, 102.5, '#ee6677', '12', 3.4))).metrics;
  assert.strictEqual(over.badgeOverBadge, 1);
});

test('two stadium badges side by side are still measured across their width', () => {
  // The case the box rule existed for, and the exact rule must not lose it: a
  // stadium's half-width is not a radius, so a radial test would call these clear.
  const clear = analyse(sheet(stadium(70, 100, '#4477aa', 'X31')
    + stadium(89, 100, '#ee6677', 'X32'))).metrics;
  assert.strictEqual(clear.badgeOverBadge, 0);
  const r = analyse(sheet(stadium(70, 100, '#4477aa', 'X31')
    + stadium(85, 100, '#ee6677', 'X32')));
  assert.strictEqual(r.metrics.badgeOverBadge, 1);
  // The PRINTED pair, not just the verdict. These two stadiums share a centreline,
  // so the y figure is the full height they have in common -- 2 x 4.6mm. Reading a
  // stadium's half-width as its radius here would print 2 x 9mm and tell a reader
  // the clash is twice as deep as it is.
  assert.deepStrictEqual(r.detail.badgeOverBadge[0].over, [3, 9.2]);
});

test('the detail reports how deep two badges actually interpenetrate', () => {
  // A per-axis pair cannot be compared between a disc and a stadium; one number can.
  const r = analyse(sheet(badge(80, 100, '#4477aa', '9', 3.4) + badge(82, 100, '#ee6677', '12', 3.4)));
  assert.strictEqual(r.detail.badgeOverBadge.length, 1);
  assert.strictEqual(r.detail.badgeOverBadge[0].deep, 4.8);   // 6.8 - 2.0
});

// -------------------------------------------------------- OA-060, lozenges
/*
 * A terminus lozenge is the WIDEST box on any sheet — 18 mm at its floor and
 * often 40 — and until 2026-08-28 nothing measured it. The row that wanted it
 * fixed had been quoting one hand-measured overlap since 2026-08-24 and saying
 * outright that the real population was "an unknown number".
 *
 * These fixtures write external.svg, not internal.svg, because the measure is
 * scoped by sheet type: a lozenge cannot appear on an internal sheet, and a
 * measure that answered 0 there would be claiming to have checked something it
 * cannot see.
 */
function extSheet(body) {
  const dir = scratchDir('qm-loz-' + (seq++) + '-');
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify({ palette: PAL }));
  fs.writeFileSync(path.join(dir, 'external.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
    + '<clipPath id="map"><rect x="6" y="30" width="190" height="155"/></clipPath>'
    + body + '</svg>');
  return path.join(dir, 'external.svg');
}
// The mark exactly as both external generators emit it. The fill/stroke pair is
// the identity the measure keys on; rx is incidental and deliberately not tested.
const loz = (x, y, w, h, t) =>
  `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2.4" fill="#2e8b57" stroke="#1d5f3a" stroke-width="0.5"/>`
  + `<text x="${x}" y="${y}" font-family="Arial" font-weight="bold" font-size="3.4" fill="#fff"`
  + ` text-anchor="middle" dominant-baseline="central">${t}</text>`;

test('two destination lozenges printed on each other are counted, and neighbours are not', () => {
  const over = analyse(extSheet(loz(80, 100, 30, 11, 'Cambridge') + loz(105, 100, 30, 11, 'Ely'))).metrics;
  assert.strictEqual(over.lozengeOverlap, 1);
  assert.strictEqual(over.lozengeOverlapState, 'counted');
  assert.strictEqual(over.lozenges, 2);
  // 30mm apart on x, so the boxes touch at exactly 0mm and never overlap.
  const clear = analyse(extSheet(loz(80, 100, 30, 11, 'Cambridge') + loz(110, 100, 30, 11, 'Ely'))).metrics;
  assert.strictEqual(clear.lozengeOverlap, 0);
});

test('a lozenge overlap must clear the tolerance on BOTH axes, not either one', () => {
  // THE FAULT THIS GUARDS is a radial or single-axis test on a box that is three
  // times wider than it is tall. These two share 20mm of x and are 11mm apart on
  // y: they line up in a column and do not touch. An x-only rule calls it a
  // defect; a centre-distance rule reads the 15mm half-width as a radius in both
  // directions and does the same. Both were real first cuts on this project.
  const stacked = analyse(extSheet(loz(80, 100, 30, 11, 'Cambridge') + loz(80, 111.5, 30, 11, 'Ely'))).metrics;
  assert.strictEqual(stacked.lozengeOverlap, 0);
  // ...and the genuine diagonal case, which a radial test MISSES: overlapping on
  // both axes while the centres sit far enough apart to pass any sane radius.
  const diag = analyse(extSheet(loz(80, 100, 30, 11, 'Cambridge') + loz(100, 108, 30, 11, 'Ely'))).metrics;
  assert.strictEqual(diag.lozengeOverlap, 1);
});

test('the detail names both destinations, because a count sends the fix the wrong way', () => {
  // OA-060 guessed overlapping lozenges would be one place reached two ways and
  // should be MERGED. Named, all seven on the board were distinct destinations.
  const r = analyse(extSheet(loz(80, 100, 30, 11, 'Addenbrookes') + loz(90, 100, 30, 11, 'Cambridge')));
  const d = r.detail.lozengeOverlap[0];
  assert.match(d.text, /Addenbrookes/);
  assert.match(d.under, /Cambridge/);
});

test('an external sheet with no lozenge at all is UNKNOWN, not clean', () => {
  // The false-zero guard. Every external sheet draws at least one destination —
  // the fewest on the board is four — so finding none means the fill/stroke
  // signature has stopped matching what the generator emits, not that the sheet
  // is tidy. Reporting that as 0 is how a measure goes blind and keeps its tick.
  const m = analyse(extSheet(loz(80, 100, 30, 11, 'Cambridge').replace('#2e8b57', '#2e8b58'))).metrics;
  assert.strictEqual(m.lozengeOverlap, null);
  assert.strictEqual(m.lozengeOverlapState, 'signature-lost');
});

test('the measure does not apply to a sheet type that has no lozenges', () => {
  // null, not 0: an internal sheet has no terminus lozenges by construction, and
  // answering 0 would claim a check that never ran.
  const m = analyse(sheet(badge(60, 100, '#4477aa', '5'))).metrics;
  assert.strictEqual(m.lozengeOverlap, null);
  assert.strictEqual(m.lozengeOverlapState, 'not-external');
});
