/*
 * place_pointer — design.placePointer, the red arrow at a place map's marker
 * (buses-data OA-509, 2026-10-01).
 *
 * Every place internal sheet takes this module, so the byte gate certifies the
 * bearing each one chose. What it cannot certify is WHY that bearing won, and
 * the costs are the part a later edit is most likely to unbalance: the head was
 * first tested against the name's padded reserved box, which every bearing
 * touches, and the arrow came in from the wrong side on Ely Co-op; a tie-break
 * of 1 let a westward arrow win there and push a pub's name onto a route. So
 * these cases pin each cost on a blank page, one at a time, plus the default.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { placePointer, pointerOn, arrowSvg, arrowAt, RED } = require('./_engine.js').load('place_pointer.js');

const SQ = [100, 100];
const FRAME = { x0: 6, y0: 30, x1: 196, y1: 185 };
const hit = (b, o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]);

// A blank page with optional reserved boxes, ink and symbols; records what it reserves.
function run(opt = {}) {
  const reserved = [], placed = (opt.reserved || []).slice(), warnings = [];
  const got = placePointer({
    on: opt.on !== false, sq: 'sq' in opt ? opt.sq : SQ, nameBox: opt.nameBox || null,
    symbols: opt.symbols || [], inkCover: opt.inkCover || (() => 0),
    overlaps: (b) => placed.some((o) => hit(b, o)),
    reserve: (x0, y0, x1, y1, tag) => reserved.push({ b: [x0, y0, x1, y1], tag }),
    frame: opt.frame || FRAME, footerTop: opt.footerTop || 195, warn: (m) => warnings.push(m),
  });
  return { got, reserved, warnings };
}
const tailOf = (svg) => { const m = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)"/); return [+m[1], +m[2]]; };

// ---------------------------------------------------------------- on and off
test('absent the key, a place map draws the pointer and a town does not', () => {
  assert.strictEqual(pointerOn({}, { place: 'Co-op Food, Ely' }), true);
  assert.strictEqual(pointerOn({}, { town: 'Ely' }), false);
  assert.strictEqual(pointerOn(undefined, { place: 'x' }), true);
});

test('false declines it on a place; true asks for it on a town', () => {
  assert.strictEqual(pointerOn({ placePointer: false }, { place: 'x' }), false);
  assert.strictEqual(pointerOn({ placePointer: true }, { town: 'Ely' }), true);
});

test('no marker, or the key off, means no arrow and no claim', () => {
  for (const r of [run({ sq: null }), run({ on: false })]) {
    assert.strictEqual(r.got, null);
    assert.strictEqual(r.reserved.length, 0);
  }
});

// ---------------------------------------------------------------- the glyph
test('the glyph is the one Peter chose: red over a white edge, and no polygon', () => {
  const svg = arrowSvg(arrowAt(SQ, -Math.PI / 4));
  assert.strictEqual(RED, '#d62728');
  assert.match(svg, /stroke="#d62728" stroke-width="0.9"/);
  assert.match(svg, /stroke="#fff" stroke-width="1.7"/);
  assert.match(svg, /<path d="M[\d.,]+ L[\d.,]+ L[\d.,]+ Z" fill="#d62728"\/>/);
  assert.doesNotMatch(svg, /polygon/, 'the portal SVG allowlist drops <polygon>');
});

test('the tip sits just off the marker and the arrow is about 16 mm long', () => {
  const a = arrowAt(SQ, -Math.PI / 4);
  assert.ok(Math.abs(Math.hypot(a.tip[0] - SQ[0], a.tip[1] - SQ[1]) - 2.85) < 1e-9);
  assert.ok(Math.abs(Math.hypot(a.tail[0] - a.tip[0], a.tail[1] - a.tip[1]) - 15.95) < 1e-9);
});

// ---------------------------------------------------------------- the bearing
test('on a blank page it comes in from the upper right, and claims its length', () => {
  const { got, reserved } = run();
  assert.strictEqual(got.bearing, -45);
  const t = tailOf(got.svg);
  assert.ok(t[0] > SQ[0] + 10 && t[1] < SQ[1] - 10, 'tail up and to the right: ' + t);
  assert.ok(reserved.length > 10 && reserved.every((r) => r.tag === 'the place pointer'));
});

test('reserved space on the upper right sends it elsewhere', () => {
  const { got } = run({ reserved: [[100, 60, 140, 99]] });
  assert.notStrictEqual(got.bearing, -45);
  assert.ok(tailOf(got.svg)[0] <= SQ[0] + 1 || tailOf(got.svg)[1] >= SQ[1] - 1);
});

test('route ink is costed, so a clear bearing beats one along a ribbon', () => {
  const { got } = run({ inkCover: (b) => (b[2] > SQ[0] + 1 ? 1 : 0) });
  assert.ok(tailOf(got.svg)[0] <= SQ[0] + 1, 'tail should leave the inked right half');
});

test('route ink is only costed, so a page inked everywhere still gets an arrow', () => {
  const { got } = run({ inkCover: () => 1 });
  assert.strictEqual(got.bearing, -45);
});

test("the head is tested against the marker's own NAME as drawn", () => {
  // A name box across the upper-right head steps; the padded reservation is not passed.
  const { got } = run({ nameBox: [101, 95, 106, 99.5] });
  assert.notStrictEqual(got.bearing, -45);
  // A real name as gen_internal measures it: x+2.6, cap height above y+1.0, descender below.
  const clear = run({ nameBox: [102.6, 101 - 3 * 0.716, 130, 101 + 3 * 0.212] });
  assert.strictEqual(clear.got.bearing, -45);
});

test('a symbol beside the shaft is crowded, and its own marker is not', () => {
  assert.notStrictEqual(run({ symbols: [[108, 90]] }).got.bearing, -45);
  assert.strictEqual(run({ symbols: [[100, 100]] }).got.bearing, -45);
});

test('the upper-right preference is worth less than one step on reserved space', () => {
  // Everything is reserved except the lower left — the one bearing that pays the WHOLE
  // preference — and the upper right is blocked by a single step. A neighbouring
  // bearing pays only a fraction of it, so only this shape can tell 3 from 30.
  const bearing = (b) => Math.atan2((b[1] + b[3]) / 2 - SQ[1], (b[0] + b[2]) / 2 - SQ[0]) * 180 / Math.PI;
  const d = (b) => Math.hypot((b[0] + b[2]) / 2 - SQ[0], (b[1] + b[3]) / 2 - SQ[1]);
  const overlaps = (b) => {
    const a = bearing(b);
    if (Math.abs(a - 135) < 5) return false;
    if (Math.abs(a + 45) < 5) return Math.abs(d(b) - 10.35) < 0.5;
    return true;
  };
  const reserved = [];
  const got = placePointer({ on: true, sq: SQ, nameBox: null, symbols: [], inkCover: () => 0, overlaps,
    reserve: (...b) => reserved.push(b), frame: FRAME, footerTop: 195, warn: () => {} });
  assert.strictEqual(got.bearing, 135);
});

test('a tail outside the frame is refused, and with nowhere left it says so', () => {
  const corner = run({ sq: [190, 35] });
  assert.ok(corner.got, 'some bearing fits');
  const t = tailOf(corner.got.svg);
  assert.ok(t[0] <= FRAME.x1 - 2 && t[1] >= FRAME.y0 + 2);
  const none = run({ frame: { x0: 95, y0: 95, x1: 105, y1: 105 } });
  assert.strictEqual(none.got, null);
  assert.match(none.warnings[0], /no bearing keeps the arrow inside the map frame/);
});
