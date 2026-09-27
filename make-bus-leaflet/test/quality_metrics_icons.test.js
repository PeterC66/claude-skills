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
