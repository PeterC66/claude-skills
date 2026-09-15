/*
 * road_graph.test.js — the graph the two internal pre-stages share.
 *
 * OA-232 Tier 3.3. `diagram_internal.js` and `schematize_internal.js` built the
 * same road graph twice, and the extraction itself is proved by the thirteen
 * diagram and schematic byte gates: all 98 sheet verdicts were identical before
 * and after. What is tested HERE is the five things those gates cannot see.
 *
 *   1. THAT THE SHAPE FLAGS ARE SHAPE, NOT CONTENT. `withLatLon` and `withName`
 *      pick a whole object literal rather than adding a key, because these
 *      pre-stages serialise nodes and `{ll: undefined}` is not an absent `ll`.
 *      An estate where both callers happen to agree cannot say this; only a test
 *      that asks for the KEYS can.
 *   2. THAT `lsq` STILL TOLERATES A RANK-DEFICIENT SYSTEM. Its near-zero-pivot
 *      `continue` is the line that lets a corridor nothing constrains sit at
 *      zero instead of producing an infinity that flies the sheet apart. No
 *      committed map reaches it — every town's system is well posed — so the
 *      byte gate certifies the branch not at all. This is also the function the
 *      first draft of the module RETYPED, as a dense Gauss-Jordan, which would
 *      have returned plausible numbers for every well-posed system on the estate.
 *   3. THAT `dpTol` KEEPS ITS DEGENERATE-SEGMENT BRANCH — the `L < 1e-9` arm,
 *      which is what stops a zero-length span dividing by zero. Also retyped
 *      away in the first draft, and also unreachable from any fixture.
 *   4. THAT CONTRACTION IS A FIXPOINT AND ITS `REP` CHAINS ARE FLATTENED. A
 *      two-hop chain (a -> b -> c) is exactly what the flatten pass exists for
 *      and is invisible in a graph that contracts in one pass.
 *   5. THAT NEITHER PRE-STAGE HAS GROWN ITS OWN COPY BACK. This is the check the
 *      2026-09-03 review says every extraction needs and eight of ten did not
 *      get: a helper that lands with a test of itself and none of its callers is
 *      adopted exactly as far as its author carried it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ENGINE_DIR, load } = require('./_engine');

const RG = load('road_graph.js');
const { key6, dpTol, dpPinned, angdist, lsq, makeWarp, deg, walk, graphOps } = RG;

/** A projection stand-in: lat/lon straight through as mm, so a hand-built graph
 *  has coordinates that can be reasoned about. The module never builds one. */
const XY = ([lat, lon]) => [lon, lat];

/* ---- 1. the two flags are SHAPE ------------------------------------------ */

test('withLatLon and withName choose the whole object, so a node has exactly the keys its caller had', () => {
  const rich = graphOps({ XY, withLatLon: true, withName: true });
  const lean = graphOps({ XY, withLatLon: false, withName: false });

  const Nr = new Map(), Er = [];
  const a = rich.node(Nr, [52, 0]), b = rich.node(Nr, [53, 1]);
  rich.addEdge(Nr, Er, a, b, 'Bridge Street');
  const Nl = new Map(), El = [];
  const c = lean.node(Nl, [52, 0]), d = lean.node(Nl, [53, 1]);
  lean.addEdge(Nl, El, c, d, 'Bridge Street');

  assert.deepStrictEqual(Object.keys(Nr.get(a)), ['mm', 'll', 'adj'],
    'the diagram keeps ll, and it keeps it in that position');
  assert.deepStrictEqual(Object.keys(Nl.get(c)), ['mm', 'adj'],
    'the schematic has NO ll — not an ll set to undefined');
  assert.ok(!('ll' in Nl.get(c)), 'absent, not undefined: these objects get serialised');
  assert.deepStrictEqual(Object.keys(Er[0]), ['a', 'b', 'name']);
  assert.deepStrictEqual(Object.keys(El[0]), ['a', 'b']);
  assert.ok(!('name' in El[0]));
  assert.strictEqual(Er[0].name, 'Bridge Street');
  // withName but no name given is null, never undefined — same reason. A fresh
  // graph, because a and b are already adjacent in Nr and the duplicate guard
  // would (correctly) refuse to add a second edge between them.
  const N2 = new Map(), E2 = [];
  const p = rich.node(N2, [52, 0]), q = rich.node(N2, [53, 1]);
  rich.addEdge(N2, E2, p, q);
  assert.strictEqual(E2[0].name, null, 'null, not undefined — an absent name still serialises');
});

test('node interns by 6dp, and addEdge refuses a self-loop and a duplicate', () => {
  const ops = graphOps({ XY });
  const N = new Map(), E = [];
  const a = ops.node(N, [52.1234567, 0.1]);      // rounds to 6dp
  const again = ops.node(N, [52.1234569, 0.1]);
  assert.strictEqual(a, again, '7th decimal place is not identity');
  assert.strictEqual(N.size, 1);
  const b = ops.node(N, [52.2, 0.2]);
  ops.addEdge(N, E, a, a);                        // self-loop
  assert.strictEqual(E.length, 0);
  ops.addEdge(N, E, a, b);
  ops.addEdge(N, E, b, a);                        // the same edge, the other way
  assert.strictEqual(E.length, 1, 'insertion is idempotent — the callers add route by route');
  assert.strictEqual(deg(N, a), 1);
});

test('key6 is the identity the callers rely on: 6dp of the OSM coordinate', () => {
  assert.strictEqual(key6([52.5, -0.25]), '52.500000,-0.250000');
  assert.strictEqual(key6(['52.5', '-0.25']), '52.500000,-0.250000', 'strings coerce');
});

/* ---- 2. lsq, including the branch no map reaches ------------------------- */

test('lsq solves a well-posed weighted system', () => {
  // x0 = 3, x1 = 5, stated twice each at different weights.
  const R = lsq(2, [
    { cs: [[0, 1]], t: 3, w: 1 },
    { cs: [[1, 1]], t: 5, w: 1 },
    { cs: [[0, 1], [1, 1]], t: 8, w: 2 },
  ]);
  assert.ok(Math.abs(R[0] - 3) < 1e-9, `x0 ${R[0]}`);
  assert.ok(Math.abs(R[1] - 5) < 1e-9, `x1 ${R[1]}`);
});

test('lsq weights actually weigh: the heavier statement wins', () => {
  const light = lsq(1, [{ cs: [[0, 1]], t: 0, w: 1 }, { cs: [[0, 1]], t: 10, w: 1 }]);
  const heavy = lsq(1, [{ cs: [[0, 1]], t: 0, w: 1 }, { cs: [[0, 1]], t: 10, w: 99 }]);
  assert.ok(Math.abs(light[0] - 5) < 1e-9, `equal weights average: ${light[0]}`);
  assert.ok(heavy[0] > 9.8, `the 99x statement dominates: ${heavy[0]}`);
});

test('lsq leaves an UNCONSTRAINED variable at zero rather than at infinity', () => {
  // x1 appears in no row. The BACK-SUBSTITUTION guard is what answers here: a
  // zero pivot on the diagonal would be 0/0. No committed map has a corridor
  // this loose, so the byte gates certify none of it.
  const R = lsq(2, [{ cs: [[0, 1]], t: 4, w: 1 }]);
  assert.ok(Math.abs(R[0] - 4) < 1e-9, `the constrained one still solves: ${R[0]}`);
  assert.ok(Number.isFinite(R[1]), `the free one must be finite, got ${R[1]}`);
  assert.strictEqual(R[1], 0, 'and specifically zero');
});

test('a barely-constrained variable does not put the ANSWER on the wrong variable', () => {
  /* The FORWARD-elimination guard, and the fixture below is found rather than
   * invented — the same method as the multi-pass contraction case further down.
   *
   * The first version of this test reasoned that skipping a near-zero pivot must
   * be harmless, because the normal-equations matrix is a Gram matrix and
   * Cauchy-Schwarz bounds what a tiny column can inject. The mutation harness
   * said otherwise: over 20,000 random systems the guarded and unguarded lsq
   * differ by a relative 9.2e+5 at worst. The argument was wrong and the
   * measurement settled it; the case below is that worst case, reduced.
   *
   * x1 appears once, with a 2.5e-10 coefficient — a corridor almost nothing
   * constrains. Its column pivots at ~1e-23, and eliminating THROUGH it destroys
   * the coupling between x0 and x2, which are perfectly well determined. The
   * failure is not a wobble: the answer 5 moves from x2 to x0. On a sheet that
   * is a corridor drawn at another corridor's position.
   */
  const rows = [
    { cs: [[2, 1], [0, 1]], t: 5, w: 1 },
    { cs: [[2, -1], [1, 2.49e-10]], t: -5, w: 0.001 },
  ];
  const R = lsq(3, rows);
  assert.ok(Math.abs(R[2] - 5) < 1e-6, `x2 is the constrained one and must be 5, got ${R[2]}`);
  assert.ok(Math.abs(R[0]) < 1e-6, `x0 must stay at 0, got ${R[0]} — the answer has moved variable`);
});

/* ---- 3. dpTol, including its degenerate arm ----------------------------- */

test('dpTol keeps the vertex that deviates and drops the ones that do not', () => {
  const pts = [[0, 0], [1, 0.01], [2, 5], [3, 0.01], [4, 0]];
  const keep = [];
  dpTol(pts, 0, 4, 1, keep);
  assert.deepStrictEqual(keep, [2], 'only the 5mm spike survives a 1mm tolerance');
  const none = [];
  dpTol(pts, 0, 4, 10, none);
  assert.deepStrictEqual(none, [], 'a tolerance above every deviation keeps nothing');
});

test('dpTol survives a zero-length span — the branch no fixture reaches', () => {
  // i0 and i1 the same point: L is 0, and the perpendicular formula would be
  // 0/0. The `L < 1e-9` arm measures straight-line distance instead.
  const pts = [[7, 7], [7, 9], [7, 7]];
  const keep = [];
  assert.doesNotThrow(() => dpTol(pts, 0, 2, 1, keep));
  assert.deepStrictEqual(keep, [1], 'and it still finds the vertex 2mm away');
});

/* ---- 3b. dpPinned — never simplify across a pin -------------------------- */

// THE FAULT THIS IS ABOUT. `dpTol` measures every vertex against the chord
// between the two ends of the range it is given, so a longer range discards more.
// OA-059 welded a linear feature's OSM ways into ONE chain before mapping and
// left the simplification running once over the welded result — so a chord that
// had spanned one OSM way came to span a whole river. On St Ives the diagram
// river fell from 30 control points to 12 and stopped matching the schematic
// sheet. No byte gate could see it: they compare a build against itself.

test('dpPinned keeps every pin, and dpTol over the same range drops them', () => {
  // Two shallow bumps 3mm off the long chord, one either side of the middle.
  // Against the full 0..8 chord both are inside a 4mm tolerance and die; pinned
  // at the vertex between them, each is measured against its own short chord.
  const pts = [[0, 0], [10, 3], [20, 0], [30, -3], [40, 0], [50, 3], [60, 0], [70, -3], [80, 0]];

  const unpinned = [0]; dpTol(pts, 0, 8, 4, unpinned); unpinned.push(8);
  assert.deepStrictEqual([...new Set(unpinned)].sort((a, b) => a - b), [0, 8],
    'CONTROL — with one 0..8 chord a 4mm tolerance flattens the whole line');

  const pinned = dpPinned(pts, [4], 4);
  assert.ok(pinned.includes(4), 'the pin survives');
  assert.ok(pinned.length > 2, `pinning recovers control points, got ${JSON.stringify(pinned)}`);
});

test('dpPinned with NO pins is exactly dpTol — the whole blast radius of the change', () => {
  // A feature crossing no route has nothing known about it but its ends, so it
  // must keep the behaviour it has today. Asserted rather than reasoned about:
  // every map with no crossings rides on this equivalence, and a fix that
  // quietly moved those sheets would be caught only by 20 red byte gates.
  const pts = [[0, 0], [1, 0.01], [2, 5], [3, 0.01], [4, 0], [5, 2], [6, 0]];
  for (const tol of [0.5, 1, 2, 10]) {
    const old = [0]; dpTol(pts, 0, pts.length - 1, tol, old); old.push(pts.length - 1);
    const oldSorted = [...new Set(old)].sort((a, b) => a - b);
    assert.deepStrictEqual(dpPinned(pts, [], tol), oldSorted, `tol ${tol}: no pins must not change the answer`);
    assert.deepStrictEqual(dpPinned(pts, undefined, tol), oldSorted, `tol ${tol}: an absent pins array is not a crash`);
  }
});

test('dpPinned refuses to let a bad pin widen a span', () => {
  // The SAME line as the case above, deliberately: on it a 4mm tolerance drops
  // index 4 unless it is pinned, so the anchor below can actually fail. The
  // first fixture here was a zigzag whose middle vertex plain Douglas-Peucker
  // kept anyway, which left every assertion in this test passing on an
  // implementation that ignored pins entirely — proved by a mutation run.
  const pts = [[0, 0], [10, 3], [20, 0], [30, -3], [40, 0], [50, 3], [60, 0], [70, -3], [80, 0]];
  // Out of range, negative, non-integer and duplicate pins are all discarded
  // rather than trusted. A pin index that is not ON the line cannot be honoured,
  // and honouring it as a bound would silently merge two spans into one — which
  // is the exact failure this function exists to prevent.
  const clean = dpPinned(pts, [4], 4);
  // ANCHOR THE BASELINE FIRST. Without this line every assertion below compares
  // dpPinned against dpPinned and passes on an implementation that ignores pins.
  // A consistency test whose reference is the function under test is not a test
  // of that function.
  assert.ok(clean.includes(4), 'the baseline must actually honour its pin');
  for (const junk of [[4, 99], [4, -1], [4, 1.5], [4, 4, 4], [4, null], [4, '4']]) {
    assert.deepStrictEqual(dpPinned(pts, junk, 4), clean, `junk pins ${JSON.stringify(junk)} must not change the answer`);
  }
  assert.deepStrictEqual(dpPinned(pts, [0, 4, 8], 4), clean, 'pinning the endpoints is a no-op — they are always kept');
});

test('dpPinned returns every index for a line too short to simplify', () => {
  assert.deepStrictEqual(dpPinned([[0, 0], [1, 1]], [], 1), [0, 1]);
  assert.deepStrictEqual(dpPinned([[0, 0]], [], 1), [0]);
  assert.deepStrictEqual(dpPinned([], [], 1), []);
});

test('dpPinned is monotone in pins — more pins never keeps fewer points', () => {
  // The property the caller actually relies on: adding a crossing to a feature
  // cannot make its drawn line coarser. Stated as a property because the St Ives
  // failure was a COUNT collapsing, and a single hand-built case would have been
  // satisfied by a fix that happened to work on that shape.
  const pts = Array.from({ length: 41 }, (_, i) => [i, Math.sin(i / 3) * 4]);
  let prev = dpPinned(pts, [], 3).length;
  for (const pins of [[20], [10, 20], [10, 20, 30], [5, 10, 20, 30, 35]]) {
    const n = dpPinned(pts, pins, 3).length;
    assert.ok(n >= prev, `pins ${JSON.stringify(pins)} kept ${n}, fewer than the ${prev} before them`);
    for (const p of pins) assert.ok(dpPinned(pts, pins, 3).includes(p), `pin ${p} was dropped`);
    prev = n;
  }
});

test('angdist is the SHORT way round, both directions', () => {
  assert.strictEqual(angdist(10, 350), 20);
  assert.strictEqual(angdist(350, 10), 20);
  assert.strictEqual(angdist(0, 180), 180);
  assert.strictEqual(angdist(0, 181), 179, 'never more than 180');
});

/* ---- 4. contraction is a fixpoint, and REP is flattened ------------------ */

test('contract merges a cluster to a fixpoint and flattens the REP chain', () => {
  const ops = graphOps({ XY });
  const N = new Map(), E = [];
  // Four junctions in a line, each 1mm from the next, plus a spur on each so
  // none is degree 2 (contraction only ever considers non-degree-2 nodes).
  const keys = [[0, 0], [0, 1], [0, 2], [0, 3]].map((ll) => ops.node(N, ll));
  keys.forEach((k, i) => {
    const spur = ops.node(N, [10 + i, 50]);
    ops.addEdge(N, E, k, spur);
  });
  for (let i = 0; i < keys.length - 1; i++) ops.addEdge(N, E, keys[i], keys[i + 1]);

  const r = ops.contract(N, E, { mergeJn: 1.5, mergeEdge: 0 });
  assert.ok(r.totalMerged >= 3, `the four collapse into one: merged ${r.totalMerged}`);
  assert.ok(r.N.size < N.size + 4, 'the graph really shrank');
  for (const [from, to] of r.REP) {
    assert.ok(r.N.has(to), `REP ${from} -> ${to}, which is not in the contracted graph`);
  }
});

test('a MULTI-PASS contraction flattens its REP chain', () => {
  /* This fixture is not invented, it is FOUND, and the search is the point.
   *
   * The flatten pass (`REP.set(k, resolve(k))`) only has work to do when a node
   * absorbed in one pass is itself absorbed in a later one — a -> b -> c. The
   * obvious fixture, four junctions in a line, cannot produce that: they all
   * merge in a single pass into one cluster, so every REP entry already points
   * at the survivor. Removing the flatten line was mutated in and SURVIVED the
   * first version of this suite for exactly that reason.
   *
   * So the geometry below was searched for: 4,000 random graphs, of which TWO
   * produced a chain, both needing `mergeEdge` on a BRANCHING graph — the second
   * reach acting on adjacency the first reach had just created. That rarity is
   * the finding. This is a live line of a live algorithm that a hand-written
   * fixture will not reach, and a chain left unflattened points a stop at a node
   * that is no longer in the graph.
   */
  const ops = graphOps({ XY });
  const N = new Map(), E = [];
  const pts = [
    [3.574488, 0.034920], [4.985093, 1.649418], [5.764218, 1.987917], [3.060031, 0.267624],
    [5.986566, 5.877748], [0.306456, 1.959360], [5.147120, 1.567216],
  ];
  const ks = pts.map((p) => ops.node(N, p));
  // A spur on each, so none is degree 2 — contraction only considers the rest.
  ks.forEach((k, i) => ops.addEdge(N, E, k, ops.node(N, [50 + i, 91])));
  for (const [a, b] of [[5, 3], [1, 1], [1, 4], [2, 2], [6, 2], [2, 3], [1, 0],
    [5, 0], [2, 5], [6, 0], [0, 4], [0, 1], [1, 0], [3, 2]]) ops.addEdge(N, E, ks[a], ks[b]);

  const r = ops.contract(N, E, { mergeJn: 0.4539695263625912, mergeEdge: 2.986279417335186 });
  assert.strictEqual(r.totalMerged, 4, 'premise: this geometry contracts over more than one pass');
  assert.ok(r.REP.size > 0, 'premise: something was absorbed');
  for (const [from, to] of r.REP) {
    assert.ok(!r.REP.has(to),
      `REP ${from} -> ${to} -> ${r.REP.get(to)}: the chain was not flattened`);
    assert.ok(r.N.has(to), `REP ${from} -> ${to}, which is not in the contracted graph`);
  }
});

test('contract with both thresholds off is a no-op that returns the same graph', () => {
  const ops = graphOps({ XY });
  const N = new Map(), E = [];
  const a = ops.node(N, [0, 0]), b = ops.node(N, [0, 0.0001]);
  ops.addEdge(N, E, a, b);
  const r = ops.contract(N, E, { mergeJn: 0, mergeEdge: 0 });
  assert.strictEqual(r.N, N, 'the very same Map, not a copy');
  assert.strictEqual(r.E, E);
  assert.strictEqual(r.totalMerged, 0);
  assert.strictEqual(r.REP.size, 0);
});

test('contract REPORTS its merge count rather than logging it', () => {
  // The two callers' log lines differ — the schematizer names its thresholds and
  // the diagram does not — so the wording stayed with them. If this ever starts
  // logging, one of those two lines is about to be printed twice.
  const src = fs.readFileSync(path.join(ENGINE_DIR, 'road_graph.js'), 'utf8');
  assert.ok(!/console\./.test(src), 'road_graph.js must print nothing at all');
  assert.ok(!/process\.env/.test(src), '…and read no environment');
  assert.ok(!/readFileSync|writeFileSync/.test(src), '…and touch no file');
});

/* ---- walk, and the warp field ------------------------------------------- */

test('walk follows a degree-2 chain to the next junction and stops', () => {
  const ops = graphOps({ XY });
  const N = new Map(), E = [];
  const ks = [[0, 0], [0, 1], [0, 2], [0, 3]].map((ll) => ops.node(N, ll));
  for (let i = 0; i < ks.length - 1; i++) ops.addEdge(N, E, ks[i], ks[i + 1]);
  const spur = ops.node(N, [5, 3]);
  ops.addEdge(N, E, ks[3], spur);       // makes ks[3] degree 2 as well
  const branch = ops.node(N, [5, 1]);
  ops.addEdge(N, E, ks[1], branch);     // ks[1] is degree 3 — a junction

  const chain = walk(N, new Set(), ks[0], ks[1]);
  assert.deepStrictEqual(chain, [ks[0], ks[1]], 'stops AT the junction');
  const long = walk(N, new Set(), ks[1], ks[2]);
  assert.deepStrictEqual(long, [ks[1], ks[2], ks[3], spur], 'runs through the degree-2 nodes');
});

test('walk will not re-consume an edge another walk already took', () => {
  const ops = graphOps({ XY });
  const N = new Map(), E = [];
  const ks = [[0, 0], [0, 1], [0, 2]].map((ll) => ops.node(N, ll));
  ops.addEdge(N, E, ks[0], ks[1]); ops.addEdge(N, E, ks[1], ks[2]);
  const seen = new Set();
  walk(N, seen, ks[0], ks[1]);
  assert.ok(seen.size >= 2, 'the whole chain is marked, not just the first edge');
});

test('makeWarp is inverse-distance and samples the SOLVED positions', () => {
  const SN = new Map([
    ['a', { mm0: [0, 0], mm: [10, 0] }],     // moved 10mm east
    ['b', { mm0: [100, 0], mm: [100, 0] }],  // did not move
  ]);
  const warp = makeWarp(SN);
  const near = warp([0, 0]);
  assert.ok(near[0] > 9, `a point on top of the moved sample follows it: ${near[0]}`);
  const far = warp([100, 0]);
  assert.ok(far[0] < 101 && far[0] > 99, `a point on the fixed sample barely moves: ${far[0]}`);
  assert.deepStrictEqual(makeWarp(new Map())([3, 4]), [3, 4], 'no samples is the identity');
  const src = [3, 4];
  assert.notStrictEqual(makeWarp(new Map())(src), src, '…and a copy, never the caller’s array');
});

/* ---- 5. the adoption check --------------------------------------------- */

test('neither pre-stage has grown its own copy of the graph back', () => {
  // The 2026-09-03 review's central finding: the two Tier 3 helpers that came
  // with a test asserting their CALLERS use them are the two that stayed
  // adopted. This is that test. A re-declared `function lsq` in either file
  // would pass every other assertion in this file and every byte gate, because
  // it would be the same arithmetic — right up until one copy is fixed.
  const files = ['diagram_internal.js', 'schematize_internal.js'];
  const OWNED = ['key6', 'lsq', 'angdist', 'dpTol', 'dp', 'node', 'addEdge', 'walk', 'warp', 'deg'];
  const offenders = [];
  for (const f of files) {
    const p = path.join(ENGINE_DIR, f);
    assert.ok(fs.existsSync(p), `a pre-stage this test is about has moved or gone: ${f}`);
    const src = fs.readFileSync(p, 'utf8');
    assert.match(src, /require\(_dep\('road_graph\.js'\)\)/,
      `${f} must load the shared graph`);
    for (const name of OWNED) {
      // A `function <name>(` at the start of a line is a re-declaration. The
      // callers' own one-line `const <name> = roadGraph...` wrappers are the
      // adopted form and are deliberately not matched.
      const re = new RegExp(`^\\s*function ${name}\\s*\\(`, 'm');
      if (re.test(src)) offenders.push(`${f}: function ${name}(`);
    }
    // The contraction is the biggest shared block and has no function of its own
    // to look for, so it is named by its own idiom instead.
    if (/N = N2; E = E2;/.test(src)) offenders.push(`${f}: its own junction contraction`);
  }
  assert.deepStrictEqual(offenders, []);
});

test('road_graph.js is inside the town engine hash, so a change here re-stamps the estate', () => {
  // Not decoration: it is required by two ENGINE_FILES, so requireClosure pulls
  // it in. If that ever stops being true, a change to the graph would ship to
  // the portal without a re-stamp and the maps would claim an engine they were
  // not drawn by.
  const { engineFiles } = load('engine_version.js');
  const inClosure = engineFiles().map((f) => path.basename(f));
  assert.ok(inClosure.includes('road_graph.js'),
    `road_graph.js is not in engineFiles(): ${inClosure.join(', ')}`);
});
