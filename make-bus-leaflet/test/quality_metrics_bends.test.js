/*
 * quality_metrics.js measure 9 — bends per route against Cerović's budget of
 * five, on the octilinear schematic only (OA-081).
 *
 * SYNTHETIC SHEETS, for the reason its siblings give: a real town proves the
 * measure returns a number, and only a sheet built to hold exactly one case
 * proves it returns the RIGHT one.
 *
 * THE FIRST TEST IS THE ONE THAT MATTERS MOST. The schematic rounds every corner
 * into short chords, and the obvious measure — count the vertices that turn —
 * counted one corner three or four times. The fixture draws its corners the same
 * way, so a regression to a vertex count fails here and not on somebody's sheet.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analyse } = require('./_engine.js').load('quality_metrics.js');
const { scratchDir } = require('../assets/scratch');

let seq = 0;
function sheet(body, base = 'internal-schematic') {
  const dir = scratchDir('qm-bend-' + (seq++) + '-');
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify({ palette: { A: '#4477aa', B: '#ee6677' } }));
  fs.writeFileSync(path.join(dir, base + '.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
    + '<clipPath id="map"><rect x="6" y="30" width="190" height="155"/></clipPath>'
    + body + '</svg>');
  return path.join(dir, base + '.svg');
}

/* A polyline through `corners`, each corner rounded into three chords of about
 * 1mm the way the schematic draws it: the chords turn 22.5 degrees at a time, so
 * a vertex count sees three or four turns where the reader sees one bend. */
function rounded(corners, r = 1.5) {
  const pts = [corners[0]];
  for (let i = 1; i < corners.length - 1; i++) {
    const [px, py] = corners[i - 1], [cx, cy] = corners[i], [nx, ny] = corners[i + 1];
    const la = Math.hypot(cx - px, cy - py), lb = Math.hypot(nx - cx, ny - cy);
    const a = [cx - (cx - px) / la * r, cy - (cy - py) / la * r];
    const b = [cx + (nx - cx) / lb * r, cy + (ny - cy) / lb * r];
    pts.push(a, [(a[0] + 2 * cx) / 3 * 0.75 + (a[0] + b[0]) / 2 * 0.25, (a[1] + 2 * cy) / 3 * 0.75 + (a[1] + b[1]) / 2 * 0.25],
      [(b[0] + 2 * cx) / 3 * 0.75 + (a[0] + b[0]) / 2 * 0.25, (b[1] + 2 * cy) / 3 * 0.75 + (a[1] + b[1]) / 2 * 0.25], b);
  }
  pts.push(corners[corners.length - 1]);
  return 'M' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L');
}
const route = (d, c = '#4477aa') => `<path d="${d}" stroke="${c}" stroke-width="1.6" fill="none"/>`;

// A staircase: n right-angle corners, legs 12mm long, well inside the frame.
const stairs = (n, x0 = 20, y0 = 40) => {
  const c = [[x0, y0]];
  for (let i = 0; i < n + 1; i++) {
    const [x, y] = c[c.length - 1];
    c.push(i % 2 ? [x, y + 12] : [x + 12, y]);
  }
  return c;
};

test('a rounded corner is ONE bend, not one per chord', () => {
  const r = analyse(sheet(route(rounded(stairs(3)))));
  assert.deepStrictEqual(r.detail.routeBends.map(b => b.bends), [3]);
  assert.strictEqual(r.metrics.routesOverBendBudget, 0);
  assert.strictEqual(r.metrics.maxRouteBends, 3);
  assert.ok(!r.warns.some(w => /bend budget/.test(w)), 'three bends is within budget');
});

test('a route with more than five bends is over budget and named in the warnings', () => {
  const r = analyse(sheet(route(rounded(stairs(7))) + route(rounded(stairs(2, 20, 120)), '#ee6677')));
  assert.strictEqual(r.metrics.routesOverBendBudget, 1);
  assert.strictEqual(r.metrics.maxRouteBends, 7);
  assert.ok(r.warns.some(w => /^1 route over the 5-bend budget \(worst 7\)$/.test(w)), r.warns.join(' | '));
});

test('exactly five bends is within budget', () => {
  const r = analyse(sheet(route(rounded(stairs(5)))));
  assert.strictEqual(r.metrics.maxRouteBends, 5);
  assert.strictEqual(r.metrics.routesOverBendBudget, 0);
});

test('an out-and-back is not a bend, and nor is a wobble under the threshold', () => {
  // Out 40mm, straight back along itself: a terminus loop drawn in one stroke.
  const back = route('M30 60 L70 60 L30 60.5');
  // A 10-degree kink between two long legs: one line to the reader.
  const kink = route('M30 100 L70 100 L110 107', '#ee6677');
  const r = analyse(sheet(back + kink));
  assert.deepStrictEqual(r.detail.routeBends.map(b => b.bends), [0, 0]);
});

test('the measure is scoped to the schematic: null on a geographic internal and on an external', () => {
  const body = route(rounded(stairs(7)));
  for (const base of ['internal', 'external']) {
    const m = analyse(sheet(body, base)).metrics;
    assert.strictEqual(m.routesOverBendBudget, null, base);
    assert.strictEqual(m.maxRouteBends, null, base);
  }
});

test('it is reported, not scored: hard and soft do not move with it', () => {
  const few = analyse(sheet(route(rounded(stairs(2))))).metrics;
  const many = analyse(sheet(route(rounded(stairs(9))))).metrics;
  assert.ok(many.routesOverBendBudget > few.routesOverBendBudget);
  assert.strictEqual(many.hard, few.hard);
  assert.strictEqual(many.soft, few.soft);
});
