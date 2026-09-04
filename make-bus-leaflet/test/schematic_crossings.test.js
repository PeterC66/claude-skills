/*
 * schematic_crossings.test.js — the detector for a route the schematizer draws
 * crossing itself where the ground does not (buses-data OA-240, 2026-09-04).
 *
 * WHAT IS ACTUALLY WORTH ASSERTING HERE. That a crossing detector detects a
 * crossing is the easy half and the half that was never in doubt. The three
 * things this check can get wrong, and which would each make it useless in a
 * different direction, are:
 *
 *   1. IT MUST NOT COUNT A CROSSING THE GEOGRAPHY ALREADY MADE. The claim is a
 *      SET DIFFERENCE, and a detector that reported the schematic's crossings
 *      outright would accuse the schematizer of every genuine flyover in the
 *      town. That is the whole reason the two files are compared rather than one
 *      being measured.
 *   2. IT MUST NOT COUNT A BUS DOUBLING BACK. Every schematic on the estate has
 *      dozens of those and none of them says anything false; a check that
 *      reported them would be muted in its first week. The instrument is the
 *      GROUND separation, so the separation has to be measured on the geographic
 *      path and not on the schematic one.
 *   3. IT MUST NOT REPORT ONE X AS THIRTY-ONE FINDINGS. Clustering is not
 *      cosmetic here: an unclustered count says Beaconsfield's sheet is far
 *      worse than a reader would call it, and a number nobody believes is a
 *      number nobody acts on.
 *
 * And the line the last test holds: this file stays OUT of the engine hash
 * closure. The whole point of writing the detector standalone was that it costs
 * no rollout — the day a generator requires it, every map on the board goes
 * STALE for a change that moved no ink, and nothing else would say so.
 *
 * THE FIXTURES ARE SYNTHETIC ON PURPOSE, and not because the real thing is
 * awkward to reach. `ci-reference/` mirrors an S4 run but does NOT carry the
 * `schematic/` workspace — no `schematic/routes_paths.json` is tracked anywhere
 * in buses-data — so a test that read the estate would pass on this laptop and
 * find nothing at all in a fresh clone, which is the shape of a green check that
 * has never been able to go red.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load, ENGINE_DIR } = require('./_engine');

const SC = load('schematic_crossings.js');
const { selfCrossings, properCross, newCrossings, segSepM, excursionMM, pageScale,
  cluster, analyseRun, roadName } = SC;
const TOOL = path.join(ENGINE_DIR, 'schematic_crossings.js');

/* A clean rectangle-and-tail: out east, north, back west, then north again.
 * Nothing crosses anything. Steps are 0.005 deg, which is ~343 m of longitude
 * and ~556 m of latitude at 52 N — the scale a real town corridor is drawn at. */
const CLEAN = [
  [52.000, 0.000],
  [52.000, 0.010],
  [52.005, 0.010],
  [52.005, 0.000],
  [52.010, 0.000],
];
/* The same path with ONE vertex moved south past the outbound leg — which is
 * exactly what an octant re-assignment at a junction does. Segment 2 now sweeps
 * across segment 0. */
const CROSSED = CLEAN.map((p, i) => (i === 3 ? [51.998, 0.000] : p));
/* The same fault, but where the two limbs are 0.0005 deg (~56 m) apart on the
 * ground rather than 0.005 — a bus doubling back at a turning point. */
const NEAR_CLEAN = [
  [52.000, 0.000],
  [52.000, 0.010],
  [52.0005, 0.010],
  [52.0005, 0.000],
  [52.001, 0.000],
];
const NEAR_CROSSED = NEAR_CLEAN.map((p, i) => (i === 3 ? [51.9995, 0.000] : p));
/* THE CASE THE FIRST THRESHOLD ALONE GOT WRONG. A route that runs the length of
 * one street and comes back down it — out east, back west — with the return pass off
 * the outbound line by 1e-8 of a degree, which is the order of the arc-length
 * interpolation error the schematizer's step 6 leaves behind. `properCross` means
 * to exclude this ("a route that retraces a street has not crossed itself, it has
 * repeated itself") and cannot, because the determinant comes out at 1e-20 rather
 * than at 0. The two stretches ARE hundreds of metres apart on the ground, so the
 * ground threshold passes it straight through; only the wedge it opens on the page
 * says what it is. */
const RETRACE_GEO = [
  [52.000, 0.000],
  [52.000, 0.010],
  [52.004, 0.010],
  [52.004, 0.000],
];
const RETRACE_SCH = [
  [52.000, 0.000],
  [52.000, 0.010],
  [52.00000001, 0.010],
  [51.99999999, 0.000],
];

test('properCross: an X crosses, and nothing that merely touches does', () => {
  const A = [0, 0], B = [1, 1], C = [0, 1], D = [1, 0];
  assert.ok(properCross(A, B, C, D), 'two diagonals of a square cross');
  // A shared endpoint is how a path is BUILT. Every closed loop shares one
  // between its first and last segment; counting it would report every circular
  // service in the estate as self-crossing.
  assert.ok(!properCross(A, B, B, [2, 0]), 'a shared endpoint is not a crossing');
  assert.ok(!properCross(A, B, [0.5, 0.5], [2, 0]), 'a T meeting the interior at an endpoint is not a crossing');
  assert.ok(!properCross(A, B, [0, 1], [1, 2]), 'parallel segments do not cross');
  // The out-and-back over one street. Collinear overlap has a zero determinant
  // and must stay silent: a route that retraces a road has repeated itself, not
  // crossed itself.
  assert.ok(!properCross(A, B, [0.25, 0.25], [0.75, 0.75]), 'a collinear retrace is not a crossing');
});

test('selfCrossings: a clean path has none, a figure-of-eight has one', () => {
  assert.deepStrictEqual(selfCrossings(CLEAN), []);
  assert.deepStrictEqual(selfCrossings(CROSSED), ['0:2']);
  // Adjacency is excluded by construction: a two-segment path cannot cross
  // itself however sharp the turn.
  assert.deepStrictEqual(selfCrossings([[0, 0], [1, 1], [0, 0.0001]]), []);
});

test('newCrossings is a SET DIFFERENCE — a crossing the geography already made is not the schematizer\'s', () => {
  // The geography crosses and the schematic crosses in the same place. That is a
  // real flyover, drawn faithfully, and it is not a finding.
  assert.deepStrictEqual(newCrossings(CROSSED, CROSSED), []);
  // Geography clean, schematic crossed: the finding.
  const found = newCrossings(CLEAN, CROSSED);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].i, 0);
  assert.strictEqual(found[0].j, 2);
  // And the schematizer STRAIGHTENING a genuine crossing out is not a finding
  // either — this asks one question, in one direction.
  assert.deepStrictEqual(newCrossings(CROSSED, CLEAN), []);
});

test('the separation is measured on the GEOGRAPHY, not on the schematic', () => {
  // THE TEST THAT MATTERS FOR THE THRESHOLD. Both fixtures below produce the
  // same crossing at the same indices; only the geographic path differs. If the
  // separation were read off the schematic, these two would score the same and
  // the whole Class A / Class B distinction would collapse.
  const far = newCrossings(CLEAN, CROSSED)[0];
  const near = newCrossings(NEAR_CLEAN, NEAR_CROSSED)[0];
  assert.ok(far.sepM > 500, `two limbs 0.005 deg apart should be over 500 m, got ${far.sepM.toFixed(0)}`);
  assert.ok(near.sepM > 40 && near.sepM < 70, `two limbs 0.0005 deg apart should be about 56 m, got ${near.sepM.toFixed(0)}`);
  assert.strictEqual(far.i, near.i);
  assert.strictEqual(far.j, near.j);
  // The default threshold has to put these two on opposite sides of it, or it
  // is not separating the two faults it was measured to separate.
  assert.ok(far.sepM > SC.DEFAULT_SEP_M && near.sepM < SC.DEFAULT_SEP_M);
});

test('segSepM is the MINIMUM distance between the segments, not between their first vertices', () => {
  // Two parallel east-west segments 0.001 deg of latitude apart: ~111 m,
  // wherever along them you measure.
  const d = segSepM([52.000, 0.000], [52.000, 0.010], [52.001, 0.010], [52.001, 0.000]);
  assert.ok(Math.abs(d - 111.3) < 2, `expected about 111 m, got ${d.toFixed(1)}`);
  // Segments that MEET score zero. The four-endpoint minimum is the answer only
  // for segments that miss each other; for two that cross, all four endpoint
  // distances are positive while the true answer is nothing at all. This pair is
  // outside the domain the detector calls it on, and it is asserted anyway so
  // the next caller does not have to know that.
  assert.strictEqual(segSepM([0, 0], [0, 1], [-0.5, 0.5], [0.5, 0.5]), 0);
});

test('clustering: one X is one finding, two X\'s are two', () => {
  // Twelve index pairs walking together, as one visible crossing between two
  // simplified legs actually produces.
  const walk = Array.from({ length: 12 }, (_, n) => ({ i: 100 + n, j: 200 - n, sepM: 300 + n, excMM: n }));
  const one = cluster(walk);
  assert.strictEqual(one.length, 1, 'a walking run of pairs is one crossing');
  assert.strictEqual(one[0].pairs, 12, 'the raw pair count is kept, not thrown away');
  assert.strictEqual(one[0].sepM, 311, 'a cluster is scored by its WIDEST separation');
  // And by its widest WEDGE, which need not be the same pair. One X drawn
  // between two long legs raises pairs at its shallow tips as well as at its
  // middle, and a retraced corridor raises a dozen that open nothing at all; a
  // cluster scored by whichever happened to come first would hide a real
  // crossing behind the retraces lying beside it.
  assert.strictEqual(one[0].excMM, 11, 'a cluster is scored by its WIDEST wedge');
  // Two runs far apart on both strands stay two.
  const two = cluster(walk.concat(walk.map((p) => ({ i: p.i + 400, j: p.j + 400, sepM: 50, excMM: 0 }))));
  assert.strictEqual(two.length, 2);
  assert.deepStrictEqual(two.map((c) => c.pairs), [12, 12]);
  assert.ok(two[0].sepM > two[1].sepM, 'clusters come back worst first');
  // Near on ONE strand and far on the other is still two crossings: a long leg
  // can be crossed twice by two quite different stretches of the same route.
  const split = cluster([{ i: 100, j: 200, sepM: 400, excMM: 1 }, { i: 101, j: 900, sepM: 400, excMM: 1 }]);
  assert.strictEqual(split.length, 2, 'closeness on both strands is required, not either');
});

/* ---- a whole run folder ------------------------------------------------- */

function makeRun(geo, sch, { edges = null, edgeWay = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-run-'));
  fs.mkdirSync(path.join(dir, 'schematic'));
  const route = (pts) => ({ pts, edges: edges || [] });
  fs.writeFileSync(path.join(dir, 'routes_paths.json'),
    JSON.stringify({ routes: { 9: route(geo) }, edgeWay: edgeWay || {} }));
  fs.writeFileSync(path.join(dir, 'schematic', 'routes_paths.json'),
    JSON.stringify({ routes: { 9: route(sch) } }));
  return dir;
}

test('analyseRun: a run with no schematic is not a finding, it is the normal case', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-run-'));
  fs.writeFileSync(path.join(dir, 'routes_paths.json'), JSON.stringify({ routes: {} }));
  assert.strictEqual(analyseRun(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyseRun reports EVERY cluster and applies no threshold of its own', () => {
  // The caller owns the threshold. A function that filtered here could not be
  // asked what it had thrown away, and `--all` and `--sep` would both be lies.
  const dir = makeRun(NEAR_CLEAN, NEAR_CROSSED);
  const res = analyseRun(dir);
  assert.strictEqual(res.routes.length, 1);
  assert.strictEqual(res.routes[0].route, '9');
  assert.strictEqual(res.routes[0].crossings.length, 1);
  assert.ok(res.routes[0].crossings[0].sepM < SC.DEFAULT_SEP_M,
    'a sub-threshold crossing still comes back from analyseRun');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyseRun refuses to compare arrays of different lengths — the premise, asserted', () => {
  // Step 6 of the schematizer keeps each route's pts array index-for-index. That
  // is what makes the set difference meaningful, and it is a property of the
  // schematizer, not a law. If it ever stops holding, this must say so rather
  // than compare index 96 of one path with a different place on the other.
  const dir = makeRun(CLEAN, CROSSED.slice(0, 4));
  const res = analyseRun(dir);
  assert.strictEqual(res.routes.length, 1);
  assert.match(res.routes[0].error, /index-for-index/);
  assert.strictEqual(res.routes[0].crossings, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('roadName resolves an edge either way round, and never throws on a missing one', () => {
  const route = { edges: ['111>222', '222>333'] };
  const ways = { '111|222': { way: 1, name: 'Bath Road', highway: 'residential' },
    '333|222': { way: 2, name: null, highway: 'service' } };
  assert.strictEqual(roadName(route, ways, 0), 'Bath Road');
  // Written in the other order in edgeWay, which is how the file really is.
  assert.strictEqual(roadName(route, ways, 1), '(service)', 'an unnamed way falls back to its class');
  assert.strictEqual(roadName(route, ways, 9), '?', 'a segment past the end is unknown, not a crash');
  assert.strictEqual(roadName({}, ways, 0), '?');
  assert.strictEqual(roadName(route, null, 0), '?');
});

/* ---- the CLI ------------------------------------------------------------ */

const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

test('the CLI exits 1 on a finding and 0 on a clean run', () => {
  const dirty = makeRun(CLEAN, CROSSED,
    { edges: ['1>2', '2>3', '3>4', '4>5'], edgeWay: { '1|2': { name: 'Bath Road' }, '3|4': { name: 'Cherry Road' } } });
  const bad = run(['--dir', dirty]);
  assert.strictEqual(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /apart on the ground/);
  assert.match(bad.stdout, /Bath Road/, 'the finding names the road a person can go and look at');
  assert.match(bad.stdout, /Cherry Road/);

  // The same fault at 56 m is below the threshold: no failure, but it is
  // COUNTED, so nobody has to wonder whether the sweep found nothing or the
  // sweep ran on nothing.
  const near = makeRun(NEAR_CLEAN, NEAR_CROSSED);
  const ok = run(['--dir', near]);
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /1 more within 150 m/);
  // ...and --all prints it.
  assert.match(run(['--dir', near, '--all']).stdout, /Below the threshold/);
  // ...and --sep re-asks the question with the threshold moved under it.
  assert.strictEqual(run(['--dir', near, '--sep', '10']).status, 1);

  for (const d of [dirty, near]) fs.rmSync(d, { recursive: true, force: true });
});

test('the CLI: --json carries both sides of the threshold, and a usage error exits 2', () => {
  const dirty = makeRun(CLEAN, CROSSED);
  const j = JSON.parse(run(['--dir', dirty, '--json']).stdout);
  assert.strictEqual(j.sepM, 150);
  assert.strictEqual(j.over.length, 1);
  assert.deepStrictEqual(j.under, []);
  assert.deepStrictEqual(j.errors, []);
  fs.rmSync(dirty, { recursive: true, force: true });

  const usage = run(['--dir', dirty, '--sep', 'wide']);
  assert.strictEqual(usage.status, 2);
  assert.match(usage.stderr, /--sep needs a distance in metres/);
  assert.strictEqual(run(['--dir']).status, 2, '--dir with nothing after it is a usage error');
});

test('excursionMM: how wide the wedge opens, not how far apart the roads are', () => {
  // 1 mm per unit, so the numbers below read as millimetres directly.
  // A square's two diagonals: a 90 deg X, and each strand's ends stand a long
  // way off the other's line.
  const X = excursionMM([0, 0], [10, 10], [0, 10], [10, 0], 1);
  assert.ok(Math.abs(X - 10 / Math.SQRT2) < 1e-9,
    `a 90 deg X across a 10-unit square opens 10/root2, got ${X}`);
  // The same crossing, but one strand is a stub: it darts across and is gone
  // before it has parted from the other by anything a printer could resolve.
  // A wedge is only as wide as its SHALLOWER side, which is why the minimum of
  // the two is taken rather than the maximum.
  const stub = excursionMM([0, 0], [10, 10], [4.9, 5.1], [5.1, 4.9], 1);
  assert.ok(stub < 0.2, `a stub crossing a long leg opens almost nothing, got ${stub}`);
  // ASYMMETRY IS THE POINT, and a square cannot show it. This strand starts a
  // whisker on one side of the other and finishes a long way past it: read at
  // its NEAR end the crossing measures nothing, read at its far end it is the
  // width of the page. The wedge a reader sees is the far one, so the larger of
  // the two ends is the answer and the smaller is the bug.
  const lop = excursionMM([0, 0], [0, 10], [-0.1, 5], [9, 6], 1);
  assert.ok(lop > 4, `a lopsided crossing is as wide as its FAR end, got ${lop}`);
  // Near-collinear: the retrace. Two segments 0.001 deg from parallel are one
  // line as far as any sheet is concerned.
  const flat = excursionMM([0, 0], [10, 0], [8, 0.0001], [2, -0.0001], 1);
  assert.ok(flat < 0.01, `a retrace opens nothing, got ${flat}`);
  // A degenerate segment cannot define a direction, and must not throw or
  // produce a NaN that would compare false against every threshold and so
  // silently drop the finding.
  assert.strictEqual(excursionMM([0, 0], [0, 0], [1, 1], [2, 2], 1), 0);
});

test('pageScale reads the whole sheet, not one route', () => {
  // The fit that put the ink on the page saw every route at once. Scaling a
  // short route by its own span would magnify its wedges by however much of the
  // sheet it happens to miss, which is the shape of a check that fires on the
  // shortest route in the town and nowhere else.
  const routes = { 9: { pts: [[0, 0], [0, 1]] }, 10: { pts: [[0, 0], [0, 4]] } };
  assert.strictEqual(pageScale(routes), SC.FRAME_MM / 4);
  assert.strictEqual(pageScale({ 9: { pts: [[0, 2], [1, 2]] } }), 0, 'a sheet with no width scores nothing');
});

test('THE RETRACE IS NOT A CROSSING, however far apart the two stretches are on the ground', () => {
  // The whole of the second threshold, in one fixture. Both passes are the same
  // street; the ground separation between the two named segments is hundreds of
  // metres, because that is what running a street twice means, and it sails over
  // the 150 m mark. The wedge is what says it is not a crossing.
  const dir = makeRun(RETRACE_GEO, RETRACE_SCH);
  const c = analyseRun(dir).routes[0].crossings[0];
  assert.ok(c.sepM > SC.DEFAULT_SEP_M,
    `a retrace clears the GROUND threshold, which is the point (got ${c.sepM.toFixed(0)} m)`);
  assert.ok(c.excMM < SC.DEFAULT_EXC_MM,
    `and opens no wedge worth drawing (got ${c.excMM.toFixed(4)} mm)`);
  assert.deepStrictEqual(SC.crossingWarnings(dir), [], 'so it reaches no build log');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a REAL X still clears both thresholds — the second one only ever removes findings', () => {
  // The guard on the guard. A threshold that can only subtract has exactly one
  // way of being wrong, and it is the way that leaves nothing behind to notice
  // it: dropping the fault it was written for. CLEAN/CROSSED is the transversal
  // crossing an octant re-assignment makes, and it has to survive.
  const dir = makeRun(CLEAN, CROSSED);
  const c = analyseRun(dir).routes[0].crossings[0];
  assert.ok(c.sepM > SC.DEFAULT_SEP_M, `over the ground threshold (got ${c.sepM.toFixed(0)} m)`);
  assert.ok(c.excMM >= SC.DEFAULT_EXC_MM, `and over the wedge threshold (got ${c.excMM.toFixed(3)} mm)`);
  assert.strictEqual(SC.crossingWarnings(dir).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the wedge threshold is half the thinnest line any route is drawn with', () => {
  // Not a number fitted to the cases in front of it. Every schematic on the
  // estate draws its routes at 1.2, 1.7 or 2.2 mm; a wedge narrower than half
  // the thinnest of those leaves the two strands' ink overlapping across the
  // whole crossing. Pinned so that moving it has to be a decision.
  assert.strictEqual(SC.THINNEST_ROUTE_MM, 1.2);
  assert.strictEqual(SC.DEFAULT_EXC_MM, 0.6);
  assert.strictEqual(SC.FRAME_MM, 190);
});

test('schematic_crossings.js is outside the engine hash closure', () => {
  // THE LINE THIS TEST HOLDS, and the reason the detector was written standalone
  // rather than inside schematize_internal.js. A pre-stage that required it
  // would put every map on the board STALE for a check that moves no ink, and
  // the cost would not appear until somebody ran a rollout.
  const { engineFiles, placeEngineFiles, boardingEngineFiles } = load('engine_version.js');
  for (const [what, list] of [['town', engineFiles()], ['place', placeEngineFiles()], ['boarding', boardingEngineFiles()]]) {
    assert.ok(!list.includes('schematic_crossings.js'),
      `the ${what} engine closure now reaches schematic_crossings.js — that is a rollout for a checker`);
  }
});

test('the detector requires the shared parser rather than reading argv itself', () => {
  // The census in cli.test.js asks this of every file under assets/; this says
  // it about the one file this suite owns, so a failure here names the subject
  // instead of a list.
  const src = fs.readFileSync(TOOL, 'utf8');
  assert.match(src, /require\('\.\/cli'\)/);
  assert.ok(!/function parseArgs\s*\(/.test(src));
});
