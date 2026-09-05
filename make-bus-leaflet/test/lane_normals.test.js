/*
 * lane_normals — the corridor orientation field behind design.laneOrientation.
 *
 * The fault these record: gen_internal.js took its lane normal from the nearest
 * segment of the bundle's reference route and used that segment's heading sign
 * unexamined. Nearest-by-midpoint says nothing about direction, so wherever the
 * reference doubled back on itself, or wherever a change of bundle membership
 * made a differently-digitised route the reference, the normal reversed and the
 * whole bundle mirrored around its centreline — its lanes crossing for no reason
 * a reader could see. Measured 2026-08-26: 111 in-frame sites over 18 maps.
 *
 * Every assertion below is a property of that repair, and three of them are
 * properties of repairs that FAILED first and had to be measured on the board
 * before the fault was understood:
 *
 *   - a chain edge must be able to continue through a bend, because restricting
 *     it to near-parallel pairs put the flip count UP (66 sites -> 114);
 *   - a chain edge must never close a cycle, because letting it do so made
 *     Beaconsfield Simpson Centre go from zero flips to two;
 *   - a component's absolute sign must be anchored on its lowest-index member,
 *     or every corridor whose seed happened to point the other way is mirrored
 *     for nothing, and the key-off path stops being byte-identical.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const LN = require('./_engine.js').load('lane_normals.js');

// a segment as gen_internal.js builds it: unit heading, midpoint, length
function seg(r, i, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  return { r, i, ax, ay, ux: dx / L, uy: dy / L, L, mx: (ax + bx) / 2, my: (ay + by) / 2 };
}
const CFG = { dist: 2.4, cosAngle: Math.cos(22 * Math.PI / 180) };

test('two segments running alongside each other are one corridor; two streets apart are not', () => {
  const a = seg('A', 0, 0, 0, 10, 0);
  const near = seg('B', 0, 0, 1.5, 10, 1.5);
  const far = seg('C', 0, 0, 6, 10, 6);
  assert.strictEqual(LN.corridorNeighbours(a, near, CFG), true);
  assert.strictEqual(LN.corridorNeighbours(a, far, CFG), false);
});

test('a corridor is the same corridor when the two lines point OPPOSITE ways', () => {
  // the out-and-back case: one street, one route, two legs. If this returned
  // false the doubling-back half of the defect would be invisible to the field.
  const out = seg('A', 0, 0, 0, 10, 0);
  const back = seg('A', 9, 10, 0.5, 0, 0.5);
  assert.strictEqual(LN.corridorNeighbours(out, back, CFG), true);
});

test('a route doubling back gets its return leg oriented to agree with its outward leg', () => {
  const segs = [seg('A', 0, 0, 0, 10, 0), seg('A', 1, 10, 0.4, 0, 0.4)];
  const { sign } = LN.orientSegments(segs, [[0, 1]], []);
  const o0 = [segs[0].ux * sign[0], segs[0].uy * sign[0]];
  const o1 = [segs[1].ux * sign[1], segs[1].uy * sign[1]];
  assert.ok(o0[0] * o1[0] + o0[1] * o1[1] > 0.9, 'the two legs must end up pointing the same way');
});

test('a corridor whose lines all run the same way is left alone: every sign +1', () => {
  // This is what keeps design.laneOrientation OFF byte-identical, and ON a no-op
  // wherever there was nothing wrong. A field that mirrored a clean corridor
  // would move ink on every map for no defect.
  const segs = [seg('A', 0, 0, 0, 10, 0), seg('B', 0, 0, 1.2, 10, 1.2), seg('C', 0, 0, 2.2, 10, 2.2)];
  const pairs = [[0, 1], [1, 2], [0, 2]];
  const { sign } = LN.orientSegments(segs, pairs, []);
  assert.deepStrictEqual([...sign], [1, 1, 1]);
});

test('the absolute sign is anchored on the component\'s LOWEST-index segment', () => {
  // Seeded anywhere else, a component can come out globally inverted: no lanes
  // cross, but every one of them has swapped side for nothing.
  const segs = [seg('A', 0, 0, 0, 10, 0), seg('B', 0, 10, 1, 0, 1)];
  const { sign } = LN.orientSegments(segs, [[0, 1]], []);
  assert.strictEqual(sign[0], 1, 'the first segment defines the direction');
  assert.strictEqual(sign[1], -1, 'the one facing the other way is the one that flips');
});

test('anchoring holds even when the union-find root is NOT the lowest-index segment', () => {
  // The two-segment version of this test cannot fail: with one union the root
  // IS segment 0, so anchoring on the root and anchoring on the lowest index
  // are the same thing, and a mutation that replaced one with the other
  // survived the whole suite. Three segments, unioned so that rank promotes
  // segment 1 to root, is the smallest case that can tell them apart.
  const segs = [seg('A', 0, 10, 0, 0, 0), seg('B', 0, 0, 1, 10, 1), seg('C', 0, 0, 2, 10, 2)];
  const { sign } = LN.orientSegments(segs, [[1, 2], [0, 1]], []);
  assert.strictEqual(sign[0], 1, 'the lowest-index segment defines the direction, whoever the root is');
  assert.strictEqual(sign[1], -1);
  assert.strictEqual(sign[2], -1);
});
test('chainPairs links consecutive segments of ONE route, and never two different routes', () => {
  const segs = [seg('A', 0, 0, 0, 5, 0), seg('A', 1, 5, 0, 10, 0), seg('B', 0, 10, 0, 15, 0)];
  const pairs = LN.chainPairs(segs, { cosAngle: -1 });
  assert.deepStrictEqual(pairs, [[0, 1]]);
});

test('chainPairs groups by route, so interleaved segments still chain', () => {
  // The first implementation walked neighbouring ARRAY positions, which returns
  // an empty list for this input — no error, just an orientation with none of
  // the bridges it needed. gen_internal.js happens to build SEG route by route,
  // so no gate could ever have shown the difference.
  const segs = [seg('A', 0, 0, 0, 5, 0), seg('B', 0, 0, 9, 5, 9), seg('A', 1, 5, 0, 10, 0)];
  assert.deepStrictEqual(LN.chainPairs(segs, { cosAngle: -1 }), [[0, 2]]);
});

test('a chain edge continues through a bend', () => {
  // The failed repair: filtering chain edges by the same 22 degree tolerance the
  // lateral test uses. It reads as principled — "a corridor ends where the road
  // turns" — and measured on the board it made things worse, 66 sites to 114,
  // because it is the through-the-bend edges that reach the fragments the
  // lateral test cannot see. cosAngle -1 accepts everything, which is what
  // gen_internal.js passes.
  const segs = [seg('A', 0, 0, 0, 5, 0), seg('A', 1, 5, 0, 8, 4)];   // ~53 degree bend
  assert.strictEqual(LN.chainPairs(segs, { cosAngle: -1 }).length, 1);
  assert.strictEqual(LN.chainPairs(segs, { cosAngle: Math.cos(22 * Math.PI / 180) }).length, 0);
});

test('a chain edge that would close a cycle is dropped, not applied', () => {
  // Applying it plants an arbitrary disagreement inside a corridor, which is the
  // very defect being repaired. Here the lateral edges already fix 0 and 1 as
  // agreeing; the chain edge between them claims the opposite. The lateral
  // structure must win, and the field must stay consistent.
  const segs = [seg('A', 0, 0, 0, 10, 0), seg('A', 1, 10, 0.5, 0, 0.5)];
  const r = LN.orientSegments(segs, [[0, 1]], [[0, 1]]);
  assert.strictEqual(r.bridges, 0, 'both ends already share a component, so nothing is bridged');
  assert.strictEqual(r.conflicts, 0, 'and a dropped chain edge is not a conflict');
});

test('a chain edge DOES bridge two components nothing else connects', () => {
  // The case the lateral test misses: consecutive segments of one polyline whose
  // midpoints are further apart than the bundling distance. Without the bridge
  // they are separate corridors and the flip just moves to the boundary.
  const segs = [
    seg('A', 0, 0, 0, 10, 0),      // corridor 1, with a companion
    seg('A', 1, 10, 0, 24, 0),     // same route continuing; too far to pair laterally
    seg('B', 0, 0, 1.2, 10, 1.2),
  ];
  const r = LN.orientSegments(segs, [[0, 2]], LN.chainPairs(segs, { cosAngle: -1 }));
  assert.strictEqual(r.bridges, 1);
  assert.strictEqual(r.components, 1, 'the bridge makes one corridor of the two');
});

test('headings drawn from one axis can always be oriented consistently', () => {
  // Worth pinning, because it was written as a CONFLICT test and it is not one.
  // Three near-collinear segments, one of them reversed, is a two-colouring and
  // always has a solution: reversals around such a loop necessarily come in
  // pairs. A "conflicts" count that fired here would be reporting noise.
  const segs = [seg('A', 0, 0, 0, 10, 0), seg('B', 0, 0, 1, 10, 1), seg('C', 0, 10, 2, 0, 2)];
  const r = LN.orientSegments(segs, [[0, 1], [1, 2], [0, 2]], []);
  assert.strictEqual(r.conflicts, 0);
  assert.deepStrictEqual([...r.sign], [1, 1, -1]);
});

test('a loop that turns through more than a right angle CAN be inconsistent, and says so', () => {
  // A real conflict needs the headings to span wide enough that the sign of the
  // dot product disagrees around the cycle — a corridor curving through 120
  // degrees. Nothing can orient it; counting it is the honest answer, and
  // re-seeding to make the number zero would hide a property of the geometry.
  const at = (deg) => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)];
  const mk = (r, deg) => { const [dx, dy] = at(deg); return seg(r, 0, 0, 0, dx * 10, dy * 10); };
  const segs = [mk('A', 0), mk('B', 60), mk('C', 120)];
  const r = LN.orientSegments(segs, [[0, 1], [1, 2], [0, 2]], []);
  assert.strictEqual(r.conflicts, 1);
});

test('makeRefDir with no orientation returns the raw nearest heading', () => {
  // The key-off path. It must be indistinguishable from the code that shipped
  // before the module existed, or every built map moves the day it lands.
  const segs = [seg('A', 0, 0, 0, 10, 0), seg('A', 1, 10, 0.4, 0, 0.4)];
  const refDir = LN.makeRefDir(segs, { A: [0, 1] }, null);
  const [ux, uy] = refDir('A', 9, 0.4, 0, 0);
  assert.ok(ux < 0, 'the return leg is nearest here, and its raw heading points back');
});

test('makeRefDir applies the orientation, and reports which segment it used', () => {
  const segs = [seg('A', 0, 0, 0, 10, 0), seg('A', 1, 10, 0.4, 0, 0.4)];
  const { sign } = LN.orientSegments(segs, [[0, 1]], []);
  const refDir = LN.makeRefDir(segs, { A: [0, 1] }, sign);
  const [ux] = refDir('A', 9, 0.4, 0, 0);
  assert.ok(ux > 0, 'oriented, the return leg agrees with the outward one');
  assert.strictEqual(refDir.last.at, 1, 'and it says which segment supplied it');
  assert.strictEqual(refDir.last.sign, -1);
});

test('makeRefDir hands back the caller\'s fallback for a route it has no segments for', () => {
  const refDir = LN.makeRefDir([], {}, null);
  assert.deepStrictEqual(refDir('Z', 0, 0, 0.6, 0.8), [0.6, 0.8]);
});

// ---------------------------------------------------------------------------
// design.laneRibbon (OA-176 4.21, 2026-09-04) — the ribbon-cable lane order.
// Five behaviours, each opt-in, each a property the census of 2026-09-04
// measured before it was built: 693 off-axis normals, 160 one-segment blips,
// and a bundle mirroring at every bridged corner sharper than a right angle.

test('a chain edge under "continue" keeps a route on its side through a sharp corner; "heading" mirrors it', () => {
  // A route turning 120 degrees at a corner nothing else touches. The chain
  // edge is the only thing joining the two segments. Under the old relation the
  // sign of the dot product is negative and the second segment is flipped —
  // which for a lane means the whole bundle swaps sides at the corner. High
  // Wycombe's 32 and 34 do exactly that at x=158, y=112 (107 degrees).
  const segs = [seg('A', 0, 0, 0, 10, 0), seg('A', 1, 10, 0, 5, 8.66)];
  const chain = LN.chainPairs(segs, { cosAngle: -1 });
  const heading = LN.orientSegments(segs, [], chain);
  const cont = LN.orientSegments(segs, [], chain, { chainRel: 'continue' });
  assert.deepStrictEqual([...heading.sign], [1, -1], 'the old relation flips at a sharp corner');
  assert.deepStrictEqual([...cont.sign], [1, 1], 'the ribbon keeps its side');
});

test('under "continue" the lateral structure still wins: a route beside itself is with AND against its corridor', () => {
  // The out-and-back case. Lateral pairs say the two legs share a corridor and
  // face opposite ways; the chain edge is a bridge only and cannot override
  // that. A ribbon that ignored the lateral pair would draw the two legs in
  // mirror-image order, which is the 111-site defect laneOrientation removed.
  const segs = [seg('A', 0, 0, 0, 10, 0), seg('A', 1, 10, 0.4, 0, 0.4)];
  const r = LN.orientSegments(segs, [[0, 1]], LN.chainPairs(segs, { cosAngle: -1 }), { chainRel: 'continue' });
  assert.deepStrictEqual([...r.sign], [1, -1]);
  assert.strictEqual(r.bridges, 0, 'the chain edge was dropped, not applied');
});

test('makeRefDir with cosAngle takes the reference segment that runs ALONGSIDE, not the nearest one', () => {
  // r0 has a segment heading east right beside the asking point and a segment
  // heading north a little further off. The asking segment heads north. The
  // nearest-by-midpoint choice is the east one, and its normal would put a lane
  // offset along the route rather than across it.
  const segs = [seg('R', 0, 0, 0, 10, 0), seg('R', 1, 12, 0, 12, 10)];
  const plain = LN.makeRefDir(segs, { R: [0, 1] }, null);
  const ribbon = LN.makeRefDir(segs, { R: [0, 1] }, null, { cosAngle: CFG.cosAngle });
  const [px, py] = plain('R', 5, 1, 0, 1);
  const [rx, ry] = ribbon('R', 5, 1, 0, 1);
  assert.ok(Math.abs(px) > 0.9 && Math.abs(py) < 0.1, 'unfiltered: the nearest, heading east');
  assert.ok(Math.abs(rx) < 0.1 && Math.abs(ry) > 0.9, 'filtered: the one alongside, heading north');
  assert.strictEqual(ribbon.last.parallel, true);
  assert.strictEqual(ribbon.last.at, 1);
});

test('makeRefDir with cosAngle says when nothing alongside exists, and then returns the nearest as before', () => {
  const segs = [seg('R', 0, 0, 0, 10, 0)];
  const ribbon = LN.makeRefDir(segs, { R: [0] }, null, { cosAngle: CFG.cosAngle });
  const [rx] = ribbon('R', 5, 1, 0, 1);
  assert.strictEqual(ribbon.last.parallel, false, 'the caller is told, so it can use its own heading');
  assert.ok(Math.abs(rx) > 0.9, 'and the answer is the old one, not a fabricated vector');
});

test('a short segment lying wholly beside a long one is a corridor neighbour under `alongside`', () => {
  // The reciprocal midpoint test refuses this pair: the long segment's midpoint
  // is 4 mm along from the short one, measured to its nearest end. 160
  // one-segment blips on the estate were counted before smoothing was found to
  // be the larger cause; this closes the length half of it.
  const long = seg('A', 0, 0, 0, 10, 0);
  const short = seg('B', 0, 9, 1, 9.3, 1);
  assert.strictEqual(LN.corridorNeighbours(long, short, CFG), false, 'the midpoint test alone refuses it');
  assert.strictEqual(LN.corridorNeighbours(long, short, { ...CFG, alongside: true }), true);
  assert.strictEqual(LN.liesAlongside(short, long, CFG.dist), true);
  const past = seg('C', 0, 10.5, 1, 11, 1);            // beyond the long one's end
  assert.strictEqual(LN.corridorNeighbours(long, past, { ...CFG, alongside: true }), false, 'end to end is not alongside');
});

test('laneVertex is the mitre point at a corner, so lanes keep their gap, and the average where the sides agree', () => {
  // A right-angle turn with the lane 2 mm off both segments: the mitre sits
  // 2·√2 mm along the bisector, and is 2 mm from each offset line. The average
  // is √2 mm along the bisector and only 1.41 mm from each line — every lane in
  // the bundle closing up by the same 71%.
  const v = LN.laneVertex([0, -2], [2, 0]);
  assert.ok(Math.abs(Math.hypot(v[0], v[1]) - 2 * Math.SQRT2) < 1e-9, 'mitre length');
  assert.ok(Math.abs(v[0] - 2) < 1e-9 && Math.abs(v[1] + 2) < 1e-9, 'and it is 2 mm from each offset line');
  assert.deepStrictEqual(LN.laneVertex([0, -2], [0, -2]), [0, -2], 'the same offset on both sides is left alone');
  assert.deepStrictEqual(LN.laneVertex([0, -2], [0, 2]), [0, 0], 'opposing offsets (a mirror) fall back to the average');
});

test('laneVertex holds the mitre to the segments it sits between, so a short segment cannot fold', () => {
  // The right-angle mitre above reaches 2 mm along each segment. Between a
  // 10 mm segment and a 1 mm one that reach is 2x the short segment's length:
  // its two vertices would cross and the lane would draw a notch. The reach is
  // held to half the short segment, and never below the plain average.
  const free = LN.laneVertex([0, -2], [2, 0], { la: 10, lb: 10 });
  const part = LN.laneVertex([0, -2], [2, 0], { la: 10, lb: 3 });
  const held = LN.laneVertex([0, -2], [2, 0], { la: 10, lb: 1 });
  assert.ok(Math.abs(Math.hypot(free[0], free[1]) - 2 * Math.SQRT2) < 1e-9, 'room enough: the full mitre');
  const reach = (v) => Math.hypot(v[0], v[1]) * Math.sin(Math.PI / 4);   // along either segment
  assert.ok(Math.abs(reach(part) - 1.5) < 1e-9, 'a 3 mm segment: the reach is held to half of it');
  assert.ok(Math.abs(reach(held) - 1) < 1e-9, 'a 1 mm segment: the plain average, which reaches 1 mm, is the floor');
  assert.deepStrictEqual(held, [1, -1], 'never shorter than the average');
});

test('smoothHeadings reads a segment over ±w mm of the polyline, so a junction node\'s jitter is the street\'s heading', () => {
  // Three points then a 0.1 mm wobble then a straight run: the raw heading of
  // the wobble segment is 45 degrees off; over ±1 mm it is the street's.
  const pts = [[0, 0], [5, 0], [5.07, 0.07], [10, 0.07]];
  const raw = Math.atan2(0.07, 0.07) * 180 / Math.PI;
  assert.ok(Math.abs(raw - 45) < 1e-6, 'the raw wobble really is 45 degrees');
  const H = LN.smoothHeadings(pts, 1.0);
  assert.strictEqual(H.length, 3);
  assert.ok(Math.abs(H[1][1]) < 0.05, 'the wobble now reads as the street, within 3 degrees');
  assert.ok(Math.abs(H[0][0] - 1) < 1e-9 && Math.abs(H[0][1]) < 1e-9, 'a segment longer than 2w reads exactly its own heading');
  assert.strictEqual(LN.smoothHeadings([[0, 0]], 1.0), null);
});

// ---------------------------------------------------------------------------
// design.laneRibbon, second half (OA-176 4.24, 2026-09-05) — a route's own
// out-and-back drawn once. Each case is a shape High Wycombe's 34 has, and two
// of them are the wrong folds it produced first: the out leg dragged onto the
// arrival road because a junction vertex vouched for the run, and a route
// dragged onto a corner it merely passed.
const FOLD = { dist: 2.4, cosAngle: CFG.cosAngle };
const near = (p, q, tol = 1e-6) => Math.abs(p[0] - q[0]) < tol && Math.abs(p[1] - q[1]) < tol;

test('a return leg beside its own out leg is folded onto it, tip and rejoin included, with the vertex count kept', () => {
  // out east along y=0, a 1.5 mm turning loop, back west along y=1.5
  const pts = [[0, 0], [4, 0], [8, 0], [12, 0], [13, 0.75], [12, 1.5], [8, 1.5], [4, 1.5], [0, 1.5], [0, 6]];
  const { points, moved } = LN.foldRetrace(pts, FOLD);
  assert.strictEqual(points.length, pts.length, 'stopT indices survive');
  for (let k = 0; k <= 3; k++) assert.ok(near(points[k], pts[k]), 'the out leg does not move');
  assert.ok(near(points[4], pts[4]), 'the loop vertex heads ACROSS the leg and is not part of it');
  assert.ok(near(points[5], [12, 0]), 'the first return vertex, level with the tip, snaps onto the tip');
  for (let k = 6; k <= 7; k++) assert.ok(near(points[k], [pts[k][0], 0]), `return vertex ${k} lies on the out leg`);
  assert.ok(near(points[8], [0, 0]), 'the rejoin snaps onto the corner the out leg began at');
  assert.ok(near(points[9], [0, 6]), 'the road onward is left alone');
  assert.strictEqual(moved.length, 4);
  assert.strictEqual(moved[0].k, 5);
});

test('two streets 4 mm apart are not a retrace, and a leg running the SAME way beside an earlier one is not either', () => {
  const streets = [[0, 0], [10, 0], [10, 4], [0, 4]];               // out east, back west, 4 mm apart: within reach, never within dist
  assert.strictEqual(LN.foldRetrace(streets, FOLD).moved.length, 0);
  const parallel = [[0, 0], [10, 0], [10, 8], [0, 8], [0, 1.5], [3, 1.5], [7, 1.5], [10, 1.5]];   // the second east leg is beside the first, same direction
  const r = LN.foldRetrace(parallel, FOLD);
  assert.ok(near(r.points[5], [3, 1.5]) && near(r.points[6], [7, 1.5]), 'parallel is not antiparallel: nothing folds');
  assert.strictEqual(r.moved.length, 0);
});

test('a retrace that opens out past the bundling distance is folded to the reach, not cut off at the distance', () => {
  // out east along y=0; back west, 1.5 mm off at the foot widening to 3.5 mm
  const pts = [[0, 0], [5, 0], [10, 0], [10, 1.5], [7, 2.2], [4, 2.9], [1, 3.5]];
  const full = LN.foldRetrace(pts, FOLD);
  for (let k = 3; k <= 6; k++) assert.ok(Math.abs(full.points[k][1]) < 1e-6, `vertex ${k} at ${pts[k][1]} mm is folded`);
  const tight = LN.foldRetrace(pts, { ...FOLD, reach: FOLD.dist });
  assert.ok(Math.abs(tight.points[3][1]) < 1e-6 && Math.abs(tight.points[4][1]) < 1e-6, 'within dist: folded');
  assert.ok(near(tight.points[5], pts[5]) && near(tight.points[6], pts[6]), 'beyond it: left, when reach is the distance');
});

test('a run must be vouched for by a vertex within the distance of a leg INTERIOR, not by a junction it starts near', () => {
  // arrival north along x=4 to the junction (4,10); a jog west; the out leg
  // south along x=0, antiparallel to the arrival and 4 mm from it. Its first
  // vertex is 2 mm from the junction, the arrival's end — that must not fold
  // the out leg onto the arrival road.
  const pts = [[4, 0], [4, 5], [4, 10], [0.5, 11], [0, 9], [0, 6], [0, 3], [0, 0]];
  const r = LN.foldRetrace(pts, FOLD);
  assert.strictEqual(r.moved.length, 0, 'the out leg stays on its own street');
});

test('a route passing a corner it once turned, heading back, is not dragged onto the corner', () => {
  // north along x=0 to (0,10), east to (10,10); later south along x=1.5 from
  // (1.5, 16) to (1.5, 11): every vertex clamps to the corner (0,10), none
  // projects onto a leg. High Wycombe's 34 at x=100.7, y=107.
  const pts = [[0, 0], [0, 10], [10, 10], [10, 20], [1.5, 20], [1.5, 16], [1.5, 13], [1.5, 11]];
  const r = LN.foldRetrace(pts, FOLD);
  assert.strictEqual(r.moved.length, 0);
  // ...whereas turning west at (1.5, 11) IS running back along the east leg,
  // 1 mm off it, and that one vertex folds onto the leg's interior
  const back = LN.foldRetrace(pts.concat([[-5, 11]]), FOLD);
  assert.strictEqual(back.moved.length, 1);
  assert.ok(near(back.points[7], [1.5, 10]));
});

test('a third pass lands on the one line, because the target is the fold so far and not the original', () => {
  // out east y=0, back west y=1.5, out east again y=3: the third leg is 1.5 mm
  // from the second leg's ORIGINAL position and 3 mm from the first.
  const pts = [[0, 0], [5, 0], [10, 0], [9, 1.5], [4, 1.5], [1, 1.5], [1, 3], [4, 3], [9, 3]];
  const r = LN.foldRetrace(pts, FOLD);
  for (let k = 3; k <= 8; k++) assert.ok(Math.abs(r.points[k][1]) < 1e-6, `vertex ${k} is on y=0, not y=1.5`);
  assert.strictEqual(r.moved.length, 6);
});

test('foldRetrace with fewer than two segments, or nothing to fold, returns a copy and no moves', () => {
  const one = LN.foldRetrace([[0, 0], [5, 0]], FOLD);
  assert.deepStrictEqual(one.points, [[0, 0], [5, 0]]); assert.strictEqual(one.moved.length, 0);
  const straight = [[0, 0], [5, 0], [10, 0], [15, 3]];
  const r = LN.foldRetrace(straight, { ...FOLD, w: 1.0 });
  assert.deepStrictEqual(r.points, straight); assert.notStrictEqual(r.points, straight);
});

// ------------------------------------------------ the shared section drawn once (OA-176 4.24)
// Three pieces gen_internal.js composes for a styled internalCorridors family.
// No committed map carries a style, so these are the only thing under the code.
test('sharedRuns: consecutive segments with the same group are one run; a change of group starts another', () => {
  const groups = [null, ['303', '305'], ['303', '305'], ['303', '305', '301'], null, ['303', '305']];
  const runs = LN.sharedRuns(groups.length, i => groups[i]);
  assert.deepStrictEqual(runs.map(r => [r.i0, r.i1, r.group.join('/')]),
    [[1, 2, '303/305'], [3, 3, '303/305/301'], [5, 5, '303/305']],
    'a family of three that drops to two restarts the run, so the dash period restarts');
});

test('sharedRuns: nothing shared is no runs at all', () => {
  assert.deepStrictEqual(LN.sharedRuns(4, () => null), []);
});

test('offsetPolyline moves a straight line by d to the LEFT of travel, and keeps every vertex', () => {
  const pts = [[0, 0], [10, 0], [20, 0]];                       // travelling +x; page y runs down
  const left = LN.offsetPolyline(pts, 1.5);
  assert.deepStrictEqual(left.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]), [[0, 1.5], [10, 1.5], [20, 1.5]],
    'left of +x on a y-down page is +y, the same normal the lane offsetter uses');
  const right = LN.offsetPolyline(pts, -1.5);
  assert.deepStrictEqual(right.map(p => p[1]), [-1.5, -1.5, -1.5]);
  assert.strictEqual(left.length, pts.length);
});

test('offsetPolyline mitres a right-angle corner so the parallel keeps its gap round the bend', () => {
  const pts = [[0, 0], [10, 0], [10, 10]];
  const o = LN.offsetPolyline(pts, 1);
  // the corner vertex of a line 1 mm to the left of +x then +y is at (9, 1)
  assert.deepStrictEqual(o[1].map(v => +v.toFixed(6)), [9, 1]);
  assert.deepStrictEqual(o[0].map(v => +v.toFixed(6)), [0, 1]);
  assert.deepStrictEqual(o[2].map(v => +v.toFixed(6)), [9, 10]);
});

test('alternation: the n members’ dash arrays tile one period exactly once, and the phase is in the array', () => {
  // render each member's pattern over one period and check every point is
  // painted by exactly one member — the property a dropped stroke-dashoffset
  // would break, which is why the phase is written into the array instead
  const n = 3, block = 3, P = n * block;
  const painted = new Array(P * 10).fill(0);
  for (let j = 0; j < n; j++) {
    const arr = LN.alternation(n, j, block).split(' ').map(Number);
    assert.ok(arr.length % 2 === 0, 'an even-length array, so the pattern is not doubled by the renderer');
    assert.strictEqual(+arr.reduce((a, b) => a + b, 0).toFixed(6), P, 'each member’s array sums to the period');
    let at = 0, on = true;
    for (const len of arr) { if (on) for (let x = at * 10; x < (at + len) * 10; x++) painted[x]++; at += len; on = !on; }
  }
  assert.ok(painted.every(c => c === 1), 'every point of the period is painted by exactly one member');
  assert.strictEqual(LN.alternation(2, 0, 3), '3 3', 'the leader needs no phase');
  assert.strictEqual(LN.alternation(2, 1, 3), '0 3 3 0', 'the second member’s phase is a zero-length dash then a gap of one block');
});
