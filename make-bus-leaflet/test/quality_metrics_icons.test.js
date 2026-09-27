/*
 * quality_metrics.js — where a map SYMBOL is, and what a label over one is.
 *
 * icons.js changed its symbol form on 2026-08-16 (b379206) to a 24-unit grid,
 * `translate(x y) scale(s/10) translate(-12 -12)`, and parseSvg() went on
 * reading the older `translate(x y) scale(s)`. Every symbol was placed 2.4 mm up
 * and left of where it is drawn, at a tenth of its size, and the
 * labelIconCollisions FAIL read almost nothing for six weeks with every test here
 * green, because no test asked where a symbol was (buses-data OA-477).
 *
 * So the symbol below is drawn by icons.js itself, not typed: if the engine
 * changes its form again, this suite is where it shows.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analyse, parseSvg } = require('./_engine.js').load('quality_metrics.js');
const { icon } = require('./_engine.js').load('icons.js');
const { scratchDir } = require('../assets/scratch');

const wrap = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
  + inner + '</svg>';

let seq = 0;
function sheet(inner) {
  const p = path.join(scratchDir('qm-icon-' + (seq++) + '-'), 'internal.svg');
  fs.writeFileSync(p, wrap(inner));
  return p;
}

test('a grid-set symbol is read at the point it is drawn, at its drawn size', () => {
  const P = parseSvg(wrap(icon('school', 100, 80, 2.2, undefined, 'grid')));
  assert.strictEqual(P.icons.length, 1);
  const ic = P.icons[0];
  assert.ok(Math.abs(ic.cx - 100) < 1e-6 && Math.abs(ic.cy - 80) < 1e-6, `centre read at ${ic.cx},${ic.cy}`);
  assert.ok(Math.abs(ic.r - 2.2) < 1e-6, `radius read as ${ic.r}`);
});

test('the older symbol form is still read about its own origin', () => {
  const P = parseSvg(wrap(icon('school', 100, 80, 2.2)));
  assert.strictEqual(P.icons.length, 1);
  assert.ok(Math.abs(P.icons[0].cx - 100) < 1e-6 && Math.abs(P.icons[0].cy - 80) < 1e-6);
});

// A second symbol is the label's OWN, placed beside its anchor as the engine
// does, so the one under the label is foreign and must be counted.
const own = icon('library', 60, 99, 2.2, undefined, 'grid');

test('a label printed across a foreign grid-set symbol is counted', () => {
  const m = analyse(sheet(own + icon('school', 70, 100, 2.2, undefined, 'grid')
    + '<text x="62" y="100.8" font-size="2.5">Somewhere Lane</text>')).metrics;
  assert.strictEqual(m.labelIconCollisions, 1);
});

test('CONTROL: the same label clear of the symbol counts nothing', () => {
  const m = analyse(sheet(own + icon('school', 70, 110, 2.2, undefined, 'grid')
    + '<text x="62" y="100.8" font-size="2.5">Somewhere Lane</text>')).metrics;
  assert.strictEqual(m.labelIconCollisions, 0);
});

// A diagonal road name's axis-aligned box covers the corner where this symbol
// sits; the text itself passes well clear of it.
test('a diagonal name is tested as its rotated box, not the box around it', () => {
  const m = analyse(sheet(own + icon('school', 78, 99, 2.2, undefined, 'grid')
    + '<text x="62" y="100.8" font-size="2.5" transform="rotate(-45 62 100.8)">Somewhere Long Lane</text>')).metrics;
  assert.strictEqual(m.labelIconCollisions, 0);
});

/* ---- iconOverBadge: a symbol printed on a route badge (OA-477 item 2) ------
 *
 * Found by eye on Ramsey (OA-153: the pharmacy on the RH2 disc) and computable by
 * nothing, because lbl/ic asks about a label and badgeOverBadge about two badges.
 * A badge is only a badge when its fill is a route colour, so these sheets carry
 * a routes.json; the one that does not proves "could not tell" reads null, not 0.
 */
const PAL = { A: '#4477aa', B: '#ee6677' };
function paletteSheet(inner, palette = PAL) {
  const dir = scratchDir('qm-icon-badge-' + (seq++) + '-');
  if (palette) fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify({ palette }));
  fs.writeFileSync(path.join(dir, 'internal.svg'), wrap(inner));
  return path.join(dir, 'internal.svg');
}
const disc = (x, y, col, r = 2.6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" stroke="#fff" stroke-width="0.7"/>`;
const stadium = (x, y, col, hw = 6, r = 2.6) =>
  `<rect x="${x - hw}" y="${y - r}" width="${2 * hw}" height="${2 * r}" rx="${r}" fill="${col}" stroke="#fff" stroke-width="0.7"/>`;

test('a symbol printed on a route badge is counted, where it is and how deep', () => {
  const r = analyse(paletteSheet(disc(100, 80, '#4477aa') + icon('pharmacy', 102, 81, 2.2, undefined, 'grid')));
  assert.strictEqual(r.metrics.iconOverBadge, 1);
  assert.deepStrictEqual(r.detail.iconOverBadge[0].at, [102, 81]);
  assert.deepStrictEqual(r.detail.iconOverBadge[0].badge, [100, 80]);
  assert.ok(r.warns.some(w => /map symbol printed on a route badge/.test(w)), r.warns.join(' | '));
});

test('CONTROL: the same symbol clear of the badge counts nothing', () => {
  // 2.6 + 2.2 = 4.8 mm of radii; 5 mm apart is daylight.
  const m = analyse(paletteSheet(disc(100, 80, '#4477aa') + icon('pharmacy', 105, 80, 2.2, undefined, 'grid'))).metrics;
  assert.strictEqual(m.iconOverBadge, 0);
});

test('a symbol on two badges is ONE symbol on a badge, charged to the deeper', () => {
  const r = analyse(paletteSheet(disc(100, 80, '#4477aa') + disc(104, 80, '#ee6677')
    + icon('pharmacy', 103, 80, 2.2, undefined, 'grid')));
  assert.strictEqual(r.metrics.iconOverBadge, 1);
  assert.deepStrictEqual(r.detail.iconOverBadge[0].badge, [104, 80]);
});

test('a stadium badge is measured as its box, not as a disc its half-width wide', () => {
  // Above the stadium's straight core by 5 mm: clear of a 2.6 mm-radius stadium,
  // though a disc of radius 6 (its half-width) would swallow the symbol.
  const clear = analyse(paletteSheet(stadium(100, 80, '#4477aa') + icon('pharmacy', 103, 75, 2.2, undefined, 'grid'))).metrics;
  assert.strictEqual(clear.iconOverBadge, 0);
  const on = analyse(paletteSheet(stadium(100, 80, '#4477aa') + icon('pharmacy', 105, 81, 2.2, undefined, 'grid'))).metrics;
  assert.strictEqual(on.iconOverBadge, 1);
});

test('a symbol on a disc that is NOT a route colour is not on a badge', () => {
  const m = analyse(paletteSheet(disc(100, 80, '#999999') + icon('pharmacy', 101, 80, 2.2, undefined, 'grid'))).metrics;
  assert.strictEqual(m.iconOverBadge, 0);
});

test('no routes.json: the measure answers null, "could not tell", never 0', () => {
  const m = analyse(paletteSheet(disc(100, 80, '#4477aa') + icon('pharmacy', 101, 80, 2.2, undefined, 'grid'), null)).metrics;
  assert.strictEqual(m.iconOverBadge, null);
});

test('reported, NOT scored: the hit moves neither hard nor soft, so the ledger stays put', () => {
  const clean = analyse(paletteSheet(disc(100, 80, '#4477aa') + icon('pharmacy', 110, 80, 2.2, undefined, 'grid'))).metrics;
  const hit = analyse(paletteSheet(disc(100, 80, '#4477aa') + icon('pharmacy', 101, 80, 2.2, undefined, 'grid'))).metrics;
  assert.strictEqual(hit.iconOverBadge, 1);
  assert.strictEqual(hit.hard, clean.hard);
  assert.strictEqual(hit.soft, clean.soft);
});
