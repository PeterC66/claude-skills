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

const PAL = { A: '#4477aa', B: '#ee6677', C: '#228833' };

let seq = 0;
// Wrap `body` in the frame an internal sheet has: a clipPath the tool reads as
// the map frame, so the panel column and the footer band are where analyse()
// expects them and nothing here is excluded for sitting outside the map.
function sheet(body, palette = PAL) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-ink-' + (seq++) + '-'));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-ink-nopal-'));
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
test('two ribbons crossing shallowly at the same spacing either side is a MIRROR', () => {
  // A swaps from 2mm above B to 2mm below it, over a short run, while both carry
  // straight on — the bundle flipped around its own centreline.
  const m = analyse(sheet(
    ribbon([[40, 98], [70, 98], [100, 102]], '#4477aa') +
    ribbon([[40, 102], [70, 102], [100, 98]], '#ee6677'))).metrics;
  assert.strictEqual(m.laneCrossings, 1);
  assert.strictEqual(m.laneMirrors, 1);
});

test('two ribbons that part company cross shallowly and are NOT a mirror', () => {
  // Same crossing angle; the gap after it keeps growing, which is a fork.
  const m = analyse(sheet(
    ribbon([[40, 97], [70, 100], [140, 100]], '#4477aa') +
    ribbon([[40, 103], [70, 100], [140, 60]], '#ee6677'))).metrics;
  assert.strictEqual(m.laneMirrors, 0);
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

test('the two measures are reported, never folded into the scored totals', () => {
  // Deliberate, and dated: both are non-zero across the board today (OA-023,
  // OA-060), so folding them into `hard` would fail the quality ratchet on every
  // affected sheet on their first run — a check that is red on the day it is
  // written gets muted within the week. The fold-in is a separate step once the
  // sheets they name are clean.
  const r = analyse(sheet(badge(60, 100, '#4477aa', '301') + badge(61, 100.5, '#ee6677', '302')
    + label(56, 101, 'Market Hill')));
  assert.ok(r.metrics.badgeOverBadge > 0 && r.metrics.labelsOverBadge > 0);
  const clean = analyse(sheet(label(56, 101, 'Market Hill')));
  assert.strictEqual(r.metrics.hard, clean.metrics.hard);
  assert.strictEqual(r.metrics.soft, clean.metrics.soft);
  assert.strictEqual(r.metrics.defects, clean.metrics.defects);
  // ...but they are NAMED, so a reader of the report is not left to guess.
  assert.ok(r.warns.some(w => /over a route badge/.test(w)));
  assert.ok(r.warns.some(w => /printed on each other/.test(w)));
});
