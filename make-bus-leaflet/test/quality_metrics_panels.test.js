/*
 * quality_metrics.js — WHAT EVERY PINNED PAGE DEVICE BURIES, not just the legend.
 *
 * OA-207. `symbolsUnderLegend` and `routeLinesUnderLegend` were written in August
 * 2026 for the operators legend, after previewing `design.spokeSpread` hid 62
 * pieces of artwork behind legends while every defect total went DOWN. The fix
 * covered that box. `gen_external_radial.js` pins THREE opaque page-coordinate
 * blocks — the legend, the `design.howToUse` help panel (added later, with the
 * IDENTICAL rect signature) and the opt-in `stamp` note — and the detector used
 * `P.rects.find()`, so it stopped at the first one and never saw the other two.
 *
 * Wisbech's teal 60 spoke to Downham Market runs under the help panel on the
 * shipped v2.7 and on v3.1, and both sheets measured `routeLinesUnderLegend 0`.
 * The mutation that matters here is therefore the SECOND panel: before the widening
 * every test below passed except that one, which is the whole point of writing it.
 *
 * Everything is synthetic. A real sheet would prove the number and not the reason,
 * and the reason is that the panel a symbol is under was one this function could
 * not see.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analyse } = require('./_engine.js').load('quality_metrics.js');
const { scratchDir } = require('../assets/scratch');

// The two signatures gen_external_radial.js emits, copied from the generator
// rather than paraphrased: a divergence here would make this file agree with
// itself and with nothing else.
const device = (x, y, w, h) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#ffffff" fill-opacity="0.94" stroke="#ccc" stroke-width="0.4"/>`;
const stamp = (x, y, w, h) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.4" fill="#fff" fill-opacity="0.9" stroke="#b30000" stroke-width="0.4"/>`;
// A route ribbon: dark, and wide enough that isRouteInk() calls it a route on a
// sheet with no routes.json palette to match against.
// A `<path>`, which is what the generators actually emit for a spoke. It is NOT a
// `<line>` on purpose: `<line>` was broken for a second, unrelated reason (the
// attribute-name regex could not match `x1`), and a fixture that depends on two
// fixes at once cannot say which one it is proving.
const spoke = (x1, y1, x2, y2) =>
  `<path d="M${x1} ${y1} L${x2} ${y2}" fill="none" stroke="#009988" stroke-width="2.5"/>`;
// ...and the `<line>` form, kept for the one test that IS about the parser.
const spokeLine = (x1, y1, x2, y2) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#009988" stroke-width="2.5"/>`;
// A terminus lozenge — a filled box, which is what "the reader loses a place" is.
const lozenge = (x, y) =>
  `<rect x="${x}" y="${y}" width="18" height="6" rx="3" fill="#ffffff" stroke="#333" stroke-width="0.3"/>`;

let seq = 0;
/** An external sheet: `art` first, then the page devices, in document order. */
function sheet(art, devices) {
  const dir = scratchDir('qm-panels-' + (seq++) + '-');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
    + art.join('') + devices.join('') + '</svg>';
  const p = path.join(dir, 'external.svg');
  fs.writeFileSync(p, svg);
  const r = analyse(p);
  return Object.assign({}, r.metrics, { detail: r.detail });
}

// Three positions that do not overlap each other, so each test moves exactly one
// thing. The legend is top-left, the help panel bottom-left, the stamp bottom-right
// — which is roughly where the generator puts all three.
const LEGEND = [10, 40, 80, 50];
const HELP   = [10, 140, 98, 45];
const STAMP  = [200, 180, 60, 14];
const ALL = [device(...LEGEND), device(...HELP), stamp(...STAMP)];

// --------------------------------------------------------------- the control
// A control that has never been seen to differ from the findings is not a control.
// This sheet carries all three devices and a spoke clear of every one of them.
test('CONTROL: a spoke clear of all three page devices buries nothing', () => {
  const m = sheet([spoke(120, 100, 180, 110), lozenge(150, 95)], ALL);
  assert.strictEqual(m.routeLinesUnderLegend, 0, 'no route line is under anything');
  assert.strictEqual(m.symbolsUnderLegend, 0, 'no symbol is under anything');
});

// ------------------------------------------------------- one device at a time
// The COUNT here was already right before the widening; what was not there was the
// name, so this test goes red on the old code for the second assertion only. Said
// explicitly, because "it fails on the old code" is worth nothing unless you know
// which half of it failed.
test('a spoke under the LEGEND is counted AND named', () => {
  const m = sheet([spoke(20, 60, 70, 70)], ALL);
  assert.strictEqual(m.routeLinesUnderLegend, 1, 'the count was never the problem here');
  assert.strictEqual(m.detail.routeUnderLegend[0].under, 'legend', 'which box buried it');
});

// THE MUTATION. Before the widening this asserted 0, and Wisbech shipped that way.
test('a spoke under the HELP PANEL is named too', () => {
  const m = sheet([spoke(20, 155, 100, 165)], ALL);
  assert.strictEqual(m.routeLinesUnderLegend, 1, 'the second panel with the legend\'s own signature');
  assert.strictEqual(m.detail.routeUnderLegend[0].under, 'panel');
});

test('a spoke under the STAMP note is named too', () => {
  const m = sheet([spoke(205, 185, 255, 188)], ALL);
  assert.strictEqual(m.routeLinesUnderLegend, 1, 'a different signature: 0.9 opacity, a #b30000 hairline');
  assert.strictEqual(m.detail.routeUnderLegend[0].under, 'stamp');
});

// ------------------------------------------------------------- the hard half
// A route line is a warning; a buried PLACE is a defect that scores. The widening
// has to reach both, or the half that matters stays behind the panel it was under.
test('a terminus lozenge under the help panel is a HARD defect, not a warning', () => {
  const m = sheet([lozenge(30, 150)], ALL);
  assert.strictEqual(m.symbolsUnderLegend, 1);
  assert.strictEqual(m.detail.underLegend[0].under, 'panel');
  assert.ok(m.hard >= 1, 'symbolsUnderLegend folds into the hard total');
});

// ------------------------------------------------------------ not double-counted
test('a spoke crossing two devices is ONE buried line, not two', () => {
  // Long enough to pass under the legend and the help panel both.
  const m = sheet([spoke(20, 60, 20, 160)], ALL);
  assert.strictEqual(m.routeLinesUnderLegend, 1, 'deduped on what was buried, not on what buried it');
});

// -------------------------------------------------- a device is not artwork
test('the devices do not report each other', () => {
  // The stamp is drawn last, so both earlier devices precede it in document order.
  const m = sheet([], ALL);
  assert.strictEqual(m.symbolsUnderLegend, 0, 'furniture overlapping furniture is a layout question');
});

test('a page device\'s OWN text is not artwork a later device buried', () => {
  // The help panel's bullets are emitted before the stamp note. Put the stamp
  // directly over them: the bullets are the panel's own contents and belong to it.
  const bullets = ['<text x="14" y="150" font-size="3.2" fill="#333">Find where you want to go.</text>',
                   '<text x="14" y="155" font-size="3.2" fill="#333">Follow its coloured line in.</text>'];
  const m = sheet([], [device(...HELP), ...bullets, stamp(12, 145, 60, 14)]);
  assert.strictEqual(m.symbolsUnderLegend, 0, 'containment, not intersection: furniture sits inside its own box');
});

// ------------------------------------------- the exclusion, facing the other way
test('a help panel\'s own bullets are not counted as MAP labels', () => {
  const bullets = ['<text x="14" y="150" font-size="3.2" fill="#333">Find where you want to go.</text>',
                   '<text x="14" y="155" font-size="3.2" fill="#333">Follow its coloured line in.</text>'];
  // ALL three devices, so the help panel is the SECOND one. With the help panel
  // alone it would be `panels[0]` and the old single-legend code would have
  // excluded its text for the wrong reason — a fixture that passes either way.
  const withPanel = sheet(['<text x="150" y="100" font-size="3.2" fill="#333">Somewhere</text>'],
                          [device(...LEGEND), device(...HELP), ...bullets, stamp(...STAMP)]);
  assert.strictEqual(withPanel.mapLabels, 1,
    'only the real map label counts; the panel\'s prose is furniture');
  // ...and the legend's own text was already excluded, so the two agree now.
  const legendText = ['<text x="14" y="50" font-size="3.2" fill="#333">Operators and services</text>'];
  const withLegend = sheet(['<text x="150" y="100" font-size="3.2" fill="#333">Somewhere</text>'],
                           [device(...LEGEND), ...legendText]);
  assert.strictEqual(withLegend.mapLabels, 1, 'the legend half has always behaved this way');
});

// --------------------------------------------------- the fallback still works
test('a sheet drawn by an older engine still finds its legend by the loose rule', () => {
  // No 0.94/#ccc signature anywhere: a big pale bordered box in the top half.
  const old = '<rect x="10" y="40" width="80" height="50" fill="#ffffff" stroke="#999" stroke-width="0.4"/>';
  const m = sheet([spoke(20, 60, 70, 70)], [old]);
  assert.strictEqual(m.routeLinesUnderLegend, 1, 'the pre-signature fallback is not lost');
});

// ------------------------------------------------------------ internal sheets
test('an internal sheet, which has a reserved panel column, still reports null', () => {
  const dir = scratchDir('qm-panels-int-');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
    + '<clipPath id="map"><rect x="6" y="30" width="200" height="150"/></clipPath>'
    + '<g clip-path="url(#map)">' + spoke(20, 60, 70, 70) + '</g>' + device(...LEGEND) + '</svg>';
  const p = path.join(dir, 'internal.svg');
  fs.writeFileSync(p, svg);
  const m = analyse(p).metrics;
  assert.strictEqual(m.symbolsUnderLegend, null, 'the panel test does not apply to a sheet with a panel column');
  assert.strictEqual(m.routeLinesUnderLegend, null);
});

// ------------------------------------------------- the parser, on its own terms
/*
 * SEPARATE FROM EVERYTHING ABOVE. `attrs()` matched attribute names with
 * `[a-zA-Z-]+`, which cannot match `x1`, so a `<line>` parsed as a zero-length
 * segment at the origin — on every sheet this tool has ever read. It was inert on
 * the estate (the only `<line>` on any committed sheet is the north arrow's tail,
 * which is not route ink) and it is asserted here because the thing it hid is a
 * route line, which is exactly what the panel tests above are about.
 */
test('a <line> spoke is read at its own coordinates, not at the origin', () => {
  const m = sheet([spokeLine(20, 60, 70, 70)], ALL);
  assert.strictEqual(m.routeLinesUnderLegend, 1,
    'an attribute name with a digit in it must parse');
});

test('CONTROL: a <line> spoke clear of every device still buries nothing', () => {
  const m = sheet([spokeLine(120, 100, 180, 110)], ALL);
  assert.strictEqual(m.routeLinesUnderLegend, 0,
    'the parser fix must not make every line report itself as buried');
});
