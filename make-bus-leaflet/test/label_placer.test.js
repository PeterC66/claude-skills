/*
 * label_placer — the reserved-box list, and what is allowed to sit where.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3). MEASURED the
 * same day by instrumenting the module and running all 18 maps with an internal
 * sheet, and the headline is stark: THE WHOLE v1 PLACER IS DARK. Every one of
 * the 18 runs the v2 solver, so the eight-candidate greedy search, the manual
 * `lov.offset` path, the second pass that relaxes the icon boxes, and the "give
 * up rather than overlap" return are taken by NO committed map. The byte gate
 * cannot certify a line of it. That is what most of this suite is.
 *
 * What the byte gate does cover: the v2 branch (18 maps), reserve() (18, 31–77
 * calls each), the v2 queue (17 — one map has no point label to place at all),
 * and inkOnWhite (13 maps call it and all 13 darken at least one colour).
 * Nothing feeds inkOnWhite a non-hex colour, so its pass-through is dark too.
 *
 * v1 is not dead code and must not be deleted: `labels.engine` selects it, the
 * key is documented, and the comparison against v1 is how a v2 regression gets
 * diagnosed. It is a live feature today's data does not select.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { labelPlacer } = require('./_engine.js').load('label_placer.js');
const { Labeller } = require('./_engine.js').load('labeller.js');

const FRAME = { MX0: 8, MY0: 8, MX1: 196, MY1: 182 };
const make = (over = {}) => {
  const lines = [];
  const api = labelPlacer(Object.assign({
    out: (x) => lines.push(x),
    esc: (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    Labeller,
    DESIGN: {},
    V2: false,
    IR: { focus: {} },
    FOOTER_PLATE_TOP: 195.16,
  }, FRAME, over));
  return { api, lines };
};
const v2 = (over = {}) => make(Object.assign({ V2: true }, over));

/* ---- whatBlocksInk: naming what a hand-placed thing landed on (OA-148) ----
 *
 * `overlaps` answers yes or no, which is all a placer needs and not enough for a
 * warning a person has to act on: "this note is drawn on something" sends nobody
 * anywhere. reserve() takes a tag; whatBlocksInk() reads it back.
 *
 * THE CHROME EXCLUSION IS THE HALF THAT MATTERS. High Wycombe deliberately draws
 * four map notes inside the services panel column, and a warning that named the
 * panel would have been wrong on its first run — which is how a check gets muted
 * in its first week.
 */
test('reserve records what claimed the box, and whatBlocksInk reads it back', () => {
  const { api } = make();
  api.reserve(10, 10, 30, 20, 'the 5/17 terminus badge');
  assert.deepStrictEqual(api.whatBlocksInk([15, 12, 18, 15]), ['the 5/17 terminus badge']);
  assert.deepStrictEqual(api.whatBlocksInk([80, 80, 90, 90]), [], 'nothing there');
});

test('page chrome is deliberately NOT named — a note inside the panel is a design', () => {
  const { api } = make();
  api.reserve(197, 0, 297, 210, 'the services panel');
  api.reserve(0, 0, 297, 5, 'the print-safe margin');
  assert.deepStrictEqual(api.whatBlocksInk([200, 170, 260, 175]), [],
    'the panel must not produce a warning');
  assert.deepStrictEqual(api.whatBlocksInk([10, 1, 40, 4]), []);
});

test('an untagged claim is still named, by where it is', () => {
  // Anything reserved without a tag is treated as ink, not as furniture: an
  // untagged box is still something a reader will see.
  const { api } = make();
  api.reserve(120.25, 88.4, 140, 95);
  assert.deepStrictEqual(api.whatBlocksInk([125, 90, 130, 92]), ['claimed space at 120.3,88.4']);
});

// ---- the box algebra --------------------------------------------------------

test('hit is inclusive at the edges — boxes that merely touch DO collide', () => {
  const { api } = make();
  assert.strictEqual(api.hit([0, 0, 10, 10], [10, 10, 20, 20]), true, 'corner to corner');
  assert.strictEqual(api.hit([0, 0, 10, 10], [10.001, 0, 20, 10]), false);
  assert.strictEqual(api.hit([0, 0, 10, 10], [4, 4, 6, 6]), true, 'fully contained');
});

test('overlaps skips the box it is told to skip, and only that box', () => {
  const { api } = make();
  const own = [0, 0, 10, 10];
  api.placed.push(own, [5, 5, 15, 15]);
  assert.strictEqual(api.overlaps([1, 1, 2, 2], own), false, 'own box excluded, the other misses');
  assert.strictEqual(api.overlaps([6, 6, 7, 7], own), true, 'the other one still counts');
  assert.strictEqual(api.overlaps([1, 1, 2, 2], null), true, 'without the skip, own box collides');
});

test('overlapsNoIcons ignores every box registered as an icon', () => {
  const { api } = make();
  const iconBox = [0, 0, 10, 10];
  api.placed.push(iconBox);
  api.iconBoxes.add(iconBox);
  assert.strictEqual(api.overlaps([1, 1, 2, 2], null), true);
  assert.strictEqual(api.overlapsNoIcons([1, 1, 2, 2]), false);
});

test('reserve puts the box in `placed`, and under v2 blocks it in the solver too', () => {
  const one = make();
  one.api.reserve(1, 2, 3, 4);
  assert.deepStrictEqual(one.api.placed, [[1, 2, 3, 4]]);
  assert.strictEqual(one.api.LAB, null, 'v1 has no solver');
  const two = v2();
  two.api.reserve(1, 2, 3, 4);
  assert.deepStrictEqual(two.api.placed, [[1, 2, 3, 4]]);
  assert.ok(two.api.LAB, 'v2 builds a Labeller');
  // Assert the SOLVER was told, not just that a solver exists. Asserting only
  // the latter left a mutation that deletes the LAB.block() call alive: the two
  // bookkeeping lists exist so that nothing has to be remembered twice, and
  // silently remembering it once is exactly the failure that guards against.
  assert.deepStrictEqual(two.api.LAB.blocks.map((x) => x.b), [[1, 2, 3, 4]]);
});

// ---- v1: the greedy placer, DARK on every committed map ---------------------

test('v1 takes the first clear candidate, which puts the name right of the point', () => {
  const { api, lines } = make();
  assert.strictEqual(api.placeLabel(100, 50, 'Market Hill'), true);
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /x="102.60" y="50.90"/, 'candidate 1: +2.6 right, +0.9 down');
  assert.match(lines[0], /text-anchor="start"/);
  assert.match(lines[0], /stroke="#fff" stroke-width="0.7" paint-order="stroke"/, 'the white halo');
});

test('v1 walks on to the next candidate when the first collides', () => {
  const { api, lines } = make();
  api.reserve(101, 45, 130, 52);              // sits on the right-hand candidate
  api.placeLabel(100, 50, 'Market Hill');
  assert.match(lines[0], /text-anchor="end"/, 'candidate 2: to the LEFT of the point');
});

test("v1 excludes the label's OWN icon box, so a symbol 2.6mm away is not a collision", () => {
  const own = [98, 48, 102, 52];
  const withOwn = make();
  withOwn.api.placed.push(own);
  assert.strictEqual(withOwn.api.placeLabel(100, 50, 'Hill', 2.6, '#222', false, null, own), true);
  assert.match(withOwn.lines[0], /text-anchor="start"/, 'first candidate still wins');
  const without = make();
  without.api.placed.push([98, 48, 104, 52]);
  without.api.placeLabel(100, 50, 'Hill');
  assert.doesNotMatch(without.lines[0], /x="102.60"/, 'the same box, not excluded, does collide');
});

test('v1 with a manual offset skips de-collision entirely and will overprint', () => {
  const { api, lines } = make();
  api.reserve(0, 0, 297, 210);                // the whole page is claimed
  assert.strictEqual(api.placeLabel(100, 50, 'Hill', 2.6, '#222', false, { offset: { dx: 4, dy: 1 }, anchor: 'middle' }), true);
  assert.match(lines[0], /x="104.00" y="51.00"/);
  assert.match(lines[0], /text-anchor="middle"/);
});

test('v1 falls back to a second pass that ignores the icon boxes rather than drop a label', () => {
  const { api, lines } = make();
  // Claim every candidate with ICON boxes only. The first pass finds nowhere;
  // the second ignores them and prints the label exactly where it used to go.
  const iconBox = [80, 40, 120, 60];
  api.placed.push(iconBox);
  api.iconBoxes.add(iconBox);
  assert.strictEqual(api.placeLabel(100, 50, 'Hill'), true);
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /x="102.60"/, 'back to the first candidate, as before reserveIcons');
});

test('v1 gives up rather than overlap when the blocking boxes are TEXT, not icons', () => {
  const { api, lines } = make();
  api.reserve(80, 40, 120, 60);               // ordinary reserved text, not an icon
  assert.strictEqual(api.placeLabel(100, 50, 'Hill'), false);
  assert.deepStrictEqual(lines, [], 'nothing is drawn — the caller decides what to do instead');
});

test('at the right-hand edge the name flips LEFT rather than running into the panel', () => {
  // The first premise here was that a point beside the panel simply fails. It
  // does not, and that is the point of the guard: candidate 1 runs past MX1+2
  // and is rejected, candidate 2 is the mirror of it, and the label prints to
  // the left of its point with its right edge still inside the page.
  const { api, lines } = make();
  assert.strictEqual(api.placeLabel(FRAME.MX1 + 1, 50, 'Long enough to reach the panel'), true);
  assert.match(lines[0], /text-anchor="end"/);
  const x = Number(/x="([-0-9.]+)"/.exec(lines[0])[1]);
  assert.ok(x < FRAME.MX1 + 1, 'the anchor is left of the point, so the text runs back into the map');
});

test('v1 refuses a label that fits NOWHERE on the page, and only under internalRoads', () => {
  // 150 characters is 202mm of type against a 197mm-wide allowance, so all eight
  // candidates are off the page whichever way they are anchored.
  const huge = 'x'.repeat(150);
  const ir = make();
  assert.strictEqual(ir.api.placeLabel(100, 50, huge), false);
  assert.deepStrictEqual(ir.lines, []);
  const classic = make({ IR: null });
  assert.strictEqual(classic.api.placeLabel(100, 50, huge), true,
    'the classic model never had the page test, and keeping it that way is what makes the extraction inert');
});

// ---- v2: queue, never drop --------------------------------------------------

test('v2 queues the label and returns true even where v1 would have given up', () => {
  const { api, lines } = v2();
  api.reserve(0, 0, 297, 210);
  assert.strictEqual(api.placeLabel(100, 50, 'Hill'), true);
  assert.deepStrictEqual(lines, [], 'nothing is drawn yet — v2 solves and draws at the end');
});

test('a queued label carries its own icon box through as `own`, and a manual offset as `fixed`', () => {
  const { api } = v2();
  const own = [98, 48, 102, 52];
  api.placeLabel(100, 50, 'Hill', 2.6, '#222', false, { offset: { dx: 4, dy: 1 }, anchor: 'middle' }, own);
  const q = api.LAB.items[api.LAB.items.length - 1];
  assert.deepStrictEqual(q.own, own);
  assert.deepStrictEqual(q.fixed, { x: 104, y: 51, anchor: 'middle' });
  assert.deepStrictEqual(q.at, [100, 50]);
});

test('a queued label gets an id derived from its text and place unless the caller names one', () => {
  const { api } = v2();
  api.placeLabel(100, 50, 'Hill');
  assert.strictEqual(api.LAB.items[api.LAB.items.length - 1].id, 'LHill@100.0,50.0');
  api.placeLabel(100, 50, 'Hill', 2.6, '#222', false, null, null, { id: 'mine' });
  assert.strictEqual(api.LAB.items[api.LAB.items.length - 1].id, 'mine');
});

// ---- inkOnWhite -------------------------------------------------------------

const contrast = (hex) => {
  const srgb = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const c = [1, 3, 5].map((i) => srgb(parseInt(hex.substr(i, 2), 16) / 255));
  return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05);
};

test("Ely Co-op's route 129 really is unreadable as ink — the recorded fault", () => {
  assert.strictEqual(Number(contrast('#DDCC77').toFixed(2)), 1.62,
    'the figure quoted in the module comment, reproduced');
  assert.ok(contrast('#DDCC77') < 3, 'below even the large-text floor');
});

test('a pale colour is darkened until it clears the floor, and no further', () => {
  const { api } = make();
  const out = api.inkOnWhite('#DDCC77');
  assert.notStrictEqual(out, '#DDCC77');
  assert.ok(contrast(out) >= 3.5, `got ${contrast(out).toFixed(2)}`);
  // One more step of the same 0.93 factor would overshoot: the loop stops the
  // first time the floor is met, so the colour stays as light as it can be.
  const step = '#' + [1, 3, 5].map((i) => Math.round(parseInt(out.substr(i, 2), 16) / 0.93).toString(16).padStart(2, '0')).join('');
  assert.ok(contrast(step) < 3.5, 'the previous step was still below the floor');
});

test('darkening scales every channel by the same factor, so the hue survives', () => {
  const { api } = make();
  const src = '#66CCEE', out = api.inkOnWhite(src);
  const ratio = (i) => parseInt(out.substr(i, 2), 16) / parseInt(src.substr(i, 2), 16);
  const r = ratio(1);
  for (const i of [3, 5]) assert.ok(Math.abs(ratio(i) - r) < 0.02, `channel at ${i} scaled by ${ratio(i)} against ${r}`);
});

test('a colour already above the floor is returned BYTE-IDENTICAL, not merely equivalent', () => {
  const { api } = make();
  for (const hex of ['#AA3377', '#4477AA', '#117733', '#332288', '#222222', '#000000']) {
    assert.strictEqual(api.inkOnWhite(hex), hex);
  }
});

test('design.labelInkMinContrast moves the floor in both directions', () => {
  const strict = make({ DESIGN: { labelInkMinContrast: 7 } });
  assert.ok(contrast(strict.api.inkOnWhite('#AA3377')) >= 7, 'a colour that passes at 3.5 is darkened at 7');
  const lax = make({ DESIGN: { labelInkMinContrast: 1 } });
  assert.strictEqual(lax.api.inkOnWhite('#DDCC77'), '#DDCC77', 'and nothing is touched at 1');
  const perCall = make();
  assert.strictEqual(perCall.api.inkOnWhite('#DDCC77', 1), '#DDCC77', 'the per-call floor wins over the design key');
});

test('anything that is not a six-digit hex colour is passed straight through — DARK, 0 maps', () => {
  const { api } = make();
  for (const v of ['none', '#fff', 'rgb(1,2,3)', '', null, undefined]) {
    assert.strictEqual(api.inkOnWhite(v), v);
  }
});

test('the darkening loop is bounded, so a colour it cannot fix returns rather than hangs', () => {
  // 40 iterations of 0.93 takes every channel to zero, and black clears any
  // floor at or below 21 — but the bound is what guarantees it terminates.
  const { api } = make({ DESIGN: { labelInkMinContrast: 99 } });
  assert.strictEqual(api.inkOnWhite('#DDCC77'), '#0c0b07');
});
