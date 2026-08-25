/*
 * textQuad — the box the quality metrics believe a piece of text occupies.
 *
 * Every collision number the ratchet reports is built out of this function, so a
 * quad that is wrong by a millimetre is a defect count that is wrong everywhere
 * at once, in the same direction, silently.
 *
 * The rotation test is here for a specific reason. gen_internal.js writes
 * design.fixedOrientation through UNNORMALISED, and freeze_orientation.js repeats
 * the rule in a comment: "-66 and 294 are the same bearing but not the same
 * floating point, so rewriting one as the other would move the artwork very
 * slightly". That claim had never been executed. It is true, and the difference
 * is large enough to change a rounded SVG coordinate and turn a byte-identical
 * gate red for no visible reason.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('./_engine.js');
const { textQuad } = E.load('quality_metrics.js');
const FM = E.load('font_metrics.js');

const quad = (o) => textQuad(Object.assign({ text: 'Ramsey Road', size: 3, x: 50, y: 50, anchor: 'start' }, o));
const box = (q) => ({
  x0: Math.min(...q.map(p => p[0])), x1: Math.max(...q.map(p => p[0])),
  y0: Math.min(...q.map(p => p[1])), y1: Math.max(...q.map(p => p[1])),
});

test('an unrotated quad starts at the anchor and is as wide as the text measures', () => {
  const b = box(quad({}));
  assert.ok(Math.abs(b.x0 - 50) < 1e-9, `start-anchored text should begin at x, began at ${b.x0}`);
  assert.ok(Math.abs((b.x1 - b.x0) - FM.textWidth('Ramsey Road', 3, false)) < 1e-9);
});

test('the three text anchors put the box on the right side of the point', () => {
  const w = FM.textWidth('Ramsey Road', 3, false);
  assert.ok(Math.abs(box(quad({ anchor: 'start' })).x0 - 50) < 1e-9);
  assert.ok(Math.abs(box(quad({ anchor: 'end' })).x1 - 50) < 1e-9);
  const mid = box(quad({ anchor: 'middle' }));
  assert.ok(Math.abs((mid.x0 + mid.x1) / 2 - 50) < 1e-9, 'middle-anchored text was not centred on its point');
  assert.ok(Math.abs((mid.x1 - mid.x0) - w) < 1e-9);
});

test('the box hugs the ink: cap height above the baseline, descender below', () => {
  const b = box(quad({}));
  assert.ok(Math.abs((50 - b.y0) - 3 * FM.CAP_HEIGHT) < 1e-9, 'the box used the em square, not the cap height');
  assert.ok(Math.abs((b.y1 - 50) - 3 * FM.DESCENDER) < 1e-9);
});

test('a centrally-anchored label is split evenly about its baseline', () => {
  // dominant-baseline="central" text — badges, bay discs — sits on its middle,
  // not on its baseline, and a quad that ignores that reads half a line high.
  const b = box(quad({ central: true }));
  assert.ok(Math.abs((50 - b.y0) - (b.y1 - 50)) < 1e-9);
});

test('rotation turns the box, it does not merely stretch its bounds', () => {
  const flat = box(quad({}));
  const turned = box(quad({ rot: 45 }));
  assert.ok(turned.y1 - turned.y0 > (flat.y1 - flat.y0) * 2,
    'a 45° road name occupied the same vertical extent as a flat one');
  // ...and the rotation is about the anchor point, which is what keeps the quad
  // attached to the road it names.
  const q = quad({ rot: 90 });
  assert.ok(q.some(p => Math.abs(p[0] - 50) < 3 && Math.abs(p[1] - 50) < 3),
    'the rotated quad left its own anchor behind');
});

test('a full turn returns the same box', () => {
  const a = box(quad({ rot: 0 })), b = box(quad({ rot: 360 }));
  for (const k of ['x0', 'x1', 'y0', 'y1']) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, k);
});

test('-66 and 294 are the same bearing and NOT the same floating point', () => {
  // The premise behind writing design.fixedOrientation through unnormalised.
  // Same geometry to 1e-12; not the same bits — so normalising the value on the
  // way into routes.json would move the artwork, and a byte gate would say so.
  const a = quad({ rot: -66 }), b = quad({ rot: 294 });
  const delta = Math.max(...a.map((p, i) => Math.max(Math.abs(p[0] - b[i][0]), Math.abs(p[1] - b[i][1]))));
  assert.ok(delta < 1e-9, `the two forms disagree by ${delta} mm — more than rounding`);
  assert.notStrictEqual(JSON.stringify(a), JSON.stringify(b),
    'the two forms are now bit-identical: the comment in freeze_orientation.js explaining '
    + 'why fixedOrientation is written unnormalised no longer describes this engine');
});

test('the same request measures the same twice', () => {
  assert.deepStrictEqual(quad({ rot: 17.5 }), quad({ rot: 17.5 }));
});
