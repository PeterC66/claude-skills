/*
 * north_arrow — the compass on an internalRoads internal sheet.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3). Measured the
 * same day with `npm run gate:branch-coverage -- tools/branch-coverage.north_arrow.js`
 * across the 18 maps that draw an internal sheet, this is the best-covered
 * module of the phase: 12 of its 17 labelled branches are exercised, 13 maps
 * have their arrow moved off the configured spot by the blank-space search and
 * 5 keep it. The byte gate really does certify the placement.
 *
 * AND ONE "DARK" BRANCH IS NOT DARK — it is outside the probe's population, which
 * is a different thing and the more dangerous one to write down wrongly. The
 * probe renders `internal.svg` only. `northArrow.angle` shows as taken by no map,
 * yet TWELVE committed sheets take it: schematize_internal.js and
 * diagram_internal.js inject an explicit angle before re-running this generator,
 * because their coordinates are pre-rotated and run at rotationDeg 0, so theta
 * cannot say which way north is. Deleting the branch would leave every schematic
 * and diagram pointing north straight up, on maps that are not north-up — and
 * the internal-sheet gate would stay green.
 *
 * So the assertions below cover: the genuinely dark branches (off, the `true`
 * shorthand, a hand `len`, and the no-clear-spot refusal), the angle path that
 * only the derived sheets reach, and the geometry of the footprint — which every
 * map takes, but only ever at one angle each.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { northArrow } = require('./_engine.js').load('north_arrow.js');

const D = (deg) => deg * Math.PI / 180;

// ------------------------------------------------------------------ on and off
test('no internalRoads at all: the device is off', () => {
  assert.strictEqual(northArrow({ IR: null, theta: 0 }).on, false);
  assert.strictEqual(northArrow({ IR: undefined, theta: 0 }).on, false);
});

test('northArrow:false suppresses it; every other value leaves it on', () => {
  assert.strictEqual(northArrow({ IR: { northArrow: false }, theta: 0 }).on, false);
  assert.strictEqual(northArrow({ IR: {}, theta: 0 }).on, true, 'ON by default — Peter, 2026-07-20');
  assert.strictEqual(northArrow({ IR: { northArrow: true }, theta: 0 }).on, true);
  assert.strictEqual(northArrow({ IR: { northArrow: { x: 5 } }, theta: 0 }).on, true);
});

test('northArrow:true is the shorthand for "on, with every default"', () => {
  const a = northArrow({ IR: { northArrow: true }, theta: 0 });
  const b = northArrow({ IR: {}, theta: 0 });
  assert.strictEqual(a.len, b.len);
  assert.strictEqual(a.angle, b.angle);
  assert.deepStrictEqual(a.at, b.at);
});

// ------------------------------------------------------------------ angle
test('the angle is derived from theta, and it swings AGAINST the rotation', () => {
  // theta 0 is an unrotated sheet: north is up, and up is -y.
  const a = northArrow({ IR: {}, theta: 0 });
  assert.ok(Math.abs(a.angle - D(-90)) < 1e-9, 'unrotated, the arrow points up the page');
  // Turn the SHEET by +30 and north on the PAGE turns by -30, because the ink
  // rotated under a compass that did not. Written down with its sign because
  // getting it backwards mirrors the arrow on every rotated town at once, and
  // -66 and 294 are the same bearing while +30 and -30 are not.
  const b = northArrow({ IR: {}, theta: D(30) });
  assert.ok(Math.abs((b.angle - a.angle) - D(-30)) < 1e-9,
    'north moved by ' + ((b.angle - a.angle) * 180 / Math.PI).toFixed(3) + ' degrees, expected -30');
});

test('a given angle wins over theta, and it is DEGREES', () => {
  // The path the schematic and the diagram take: their coords are pre-rotated and
  // run at rotationDeg 0, so theta cannot say which way north is. Twelve committed
  // sheets reach this branch and the internal-sheet gate cannot see one of them.
  const a = northArrow({ IR: { northArrow: { angle: 45 } }, theta: D(123) });
  assert.ok(Math.abs(a.angle - D(45)) < 1e-9, 'the given angle is used, and converted from degrees');
  assert.notStrictEqual(a.angle, 45, 'a raw radian value would be a 2578° error');
});

test('angle:0 is honoured rather than falling back to theta', () => {
  const a = northArrow({ IR: { northArrow: { angle: 0 } }, theta: D(90) });
  assert.strictEqual(a.angle, 0);
});

// ------------------------------------------------------------------ the footprint
test('the box holds the whole device — line, arrowhead and the N — not just the line', () => {
  const a = northArrow({ IR: {}, theta: 0 });          // pointing up: from (50,50) to (50,42)
  const b = a.box(50, 50);
  assert.deepStrictEqual(b, [50 - 3.4, 42 - 4.6, 50 + 3.4, 50 + 4.6]);
  assert.ok(b[2] - b[0] > 0 && b[3] - b[1] > a.len, 'the footprint is taller than the shaft');
});

test('the box follows the angle, so a rotated sheet reserves a different rectangle', () => {
  const up = northArrow({ IR: {}, theta: 0 }).box(50, 50);
  const right = northArrow({ IR: { northArrow: { angle: 0 } }, theta: 0 }).box(50, 50);
  assert.notDeepStrictEqual(up, right);
  assert.ok(right[2] - right[0] > right[3] - right[1], 'pointing east, the box is wider than it is tall');
});

test('a hand len makes the device longer, and the box grows with it', () => {
  const a = northArrow({ IR: { northArrow: { len: 20 } }, theta: 0 });
  assert.strictEqual(a.len, 20);
  const b = a.box(50, 50);
  assert.ok(Math.abs((b[3] - b[1]) - (20 + 9.2)) < 1e-9);
});

// ------------------------------------------------------------------ siting
const spot = (result) => (boxOf, wantX, wantY, tol) => { spot.asked = { wantX, wantY, tol, boxOf }; return result; };

test('a clear configured spot is kept, silently, and reserved', () => {
  const a = northArrow({ IR: { northArrow: { x: 30, y: 40 } }, theta: 0 });
  const said = [], boxes = [];
  a.site(spot({ x: 30, y: 40, auto: false, want: 0 }), (...b) => boxes.push(b), m => said.push(m));
  assert.deepStrictEqual(said, [], 'a device that lands where it was told says nothing');
  assert.deepStrictEqual(a.at, { x: 30, y: 40, auto: false });
  assert.deepStrictEqual(boxes, [a.box(30, 40)], 'and the labels are told to avoid it');
});

test('an automatic placement moves the device, says why, and reserves the NEW spot', () => {
  const a = northArrow({ IR: {}, theta: 0 });
  const said = [], boxes = [];
  a.site(spot({ x: 100, y: 20, auto: true, want: 0.37 }), (...b) => boxes.push(b), m => said.push(m));
  assert.deepStrictEqual(a.at, { x: 100, y: 20, auto: true });
  assert.match(said[0], /placed automatically at 100,20/);
  assert.match(said[0], /37% covered by ink/, 'the percentage is the coverage, not the fraction');
  assert.deepStrictEqual(boxes, [a.box(100, 20)], 'reserving the OLD spot would leave the arrow unprotected');
});

test('a blocked spot and a covered one are reported differently', () => {
  const said = [];
  northArrow({ IR: {}, theta: 0 })
    .site(spot({ x: 1, y: 1, auto: true, want: null }), () => {}, m => said.push(m));
  assert.match(said[0], /the configured spot is blocked/,
    'want:null means off-frame or hard-reserved — there is no percentage to quote');
});

test('a sheet with no clear spot keeps the configured position and says so', () => {
  // Dark to all 18 maps: every one of them has somewhere to put a compass.
  const a = northArrow({ IR: { northArrow: { x: 14, y: 150 } }, theta: 0 });
  const said = [], boxes = [];
  a.site(spot({ x: null, y: null, auto: false, want: 0.9 }), (...b) => boxes.push(b), m => said.push(m));
  assert.deepStrictEqual(a.at, { x: 14, y: 150, auto: false }, 'it does not move to null');
  assert.match(said[0], /no clear spot found on this sheet; left at the configured 14,150/);
  assert.match(said[0], /northArrow:false/, 'and it says what to do about it');
  assert.strictEqual(boxes.length, 1, 'the spot it is stuck on is still reserved');
});

test('the search is asked for the configured spot, with a hard tolerance', () => {
  const a = northArrow({ IR: { northArrow: { x: 7, y: 8 } }, theta: 0 });
  a.site(spot({ x: 7, y: 8, auto: false, want: 0 }), () => {}, () => {});
  assert.strictEqual(spot.asked.wantX, 7);
  assert.strictEqual(spot.asked.wantY, 8);
  assert.strictEqual(spot.asked.tol, 0.02, '2% is the whole tolerance — a compass on ink is unreadable');
  assert.strictEqual(spot.asked.boxOf, a.box, 'the search must measure the WHOLE device');
});

// ------------------------------------------------------------------ drawing
const drawn = (a) => { const o = []; a.draw(l => o.push(l)); return o.join('\n'); };

test('the device is one line, one filled arrowhead and one N', () => {
  const a = northArrow({ IR: { northArrow: { x: 50, y: 50 } }, theta: 0 });
  const svg = drawn(a);
  assert.strictEqual((svg.match(/<line /g) || []).length, 1);
  assert.strictEqual((svg.match(/<path /g) || []).length, 1);
  assert.match(svg, />N<\/text>/);
  assert.match(svg, /stroke="#666"/, 'grey is furniture — a compass must not read as a route');
  assert.ok(!/fill="none"/.test(svg), 'the arrowhead is solid, not an outline');
});

test('it draws where site() left it, not where the config put it', () => {
  const a = northArrow({ IR: { northArrow: { x: 14, y: 150 } }, theta: 0 });
  a.site(spot({ x: 200, y: 30, auto: true, want: null }), () => {}, () => {});
  assert.match(drawn(a), /x1="200.00" y1="30.00"/);
});

test('the N sits beyond the tip, on the far side from the base', () => {
  const a = northArrow({ IR: { northArrow: { x: 50, y: 50, angle: 0 } }, theta: 0 });  // pointing east
  const tx = Number(/<text x="([\d.]+)"/.exec(drawn(a))[1]);
  assert.ok(tx > 50 + a.len, 'the letter is past the arrowhead, not inside it');
});

test('every coordinate is written to 2dp, so the sheet is byte-stable', () => {
  const svg = drawn(northArrow({ IR: { northArrow: { x: 1 / 3, y: 2 / 3 } }, theta: 0.1234567 }));
  assert.ok(!/\d\.\d{3}/.test(svg), 'an unrounded float here would move bytes on every re-render');
});
