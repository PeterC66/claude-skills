/*
 * lane_normals.js — one consistent "which way is along this corridor" answer,
 * shared by every route drawn in it.
 *
 * WHY THIS EXISTS
 *
 * gen_internal.js draws co-running routes as parallel lanes: each member of a
 * bundle takes offset (k - (n-1)/2) * gap along a normal, and the normal comes
 * from a reference heading. Getting that heading from each route's OWN segment
 * is wrong — two routes digitised in opposite directions along one street would
 * take opposite normals and swap sides — so refDir() took it from ONE member of
 * the bundle instead, by nearest segment.
 *
 * That fixed the swap between routes and left a worse one in place, because
 * "nearest segment" is a discontinuous selector with nothing to say about
 * direction. Measured across all eighteen built maps on 2026-08-26: 111 distinct
 * in-frame sites where the reference heading reverses between two consecutive
 * segments while the route itself carries straight on, mirroring the whole
 * bundle around its centreline. The two causes are equally common:
 *
 *   - the reference route traverses the corridor TWICE, out and back (104 of
 *     233 flips). Its two legs are near-coincident, so which one is "nearest"
 *     changes wherever they stop overlapping. St Neots Town Centre's crossing
 *     of 61EY and 18, the one a reader reported, is this.
 *   - the bundle's membership changes, so its lowest-order member — the
 *     reference — becomes a DIFFERENT ROUTE mid-corridor (129 of 233), and the
 *     new one is digitised the other way. Ely Co-op and High Wycombe Aldi are
 *     entirely this.
 *
 * Both are the same missing property: the corridor has no agreed direction, so
 * every consumer invents one. This module supplies it once.
 *
 * WHAT IT DOES
 *
 * Segments that are near-parallel and spatially overlapping form a corridor
 * COMPONENT. Within a component every segment is given a sign, +1 or -1, such
 * that flipping each segment's heading by its sign makes all of them point the
 * same way along the corridor. Signs come from a parity union-find over the
 * adjacency, anchored so the component's lowest-index segment is +1 —
 * deterministic given the generator's segment order, per the engine's
 * no-locale-no-filesystem-order invariant.
 *
 * IT IS OPT-IN, behind design.laneOrientation, and the honest reason is in
 * gen_internal.js beside the key: it repairs the site a reader reported on St
 * Neots Town Centre, proven on a rendered crop, and across the other 110
 * measured sites nothing can yet say whether the redrawn sheet is better or
 * worse, because quality_metrics.js cannot see a lane mirror at all.
 *
 * The orientation is a property of the CORRIDOR, not of any polyline's
 * digitisation direction and not of any one route, which is what makes it
 * survive both causes above. It is also continuous around curves: a corridor
 * that bends through 170 degrees keeps one sign the whole way, because sign is
 * propagated between neighbours rather than measured against a fixed axis. A
 * rule of the "always point east" kind would flip exactly where such a corridor
 * crossed the axis, reintroducing the hemisphere flip refDir was built to stop.
 *
 * A corridor whose routes are all digitised the same way — the common case —
 * gets sign +1 throughout and the drawn output does not move at all.
 */
'use strict';

// Distance from a point to a segment, clamped to the segment's ends. Same
// helper gen_internal.js calls pSeg(); duplicated rather than imported because
// this module must stay loadable on its own (test/_engine.js loads it with no
// generator present, and the portal vendors it as a leaf).
function pointSegDist(px, py, s) {
  let t = (px - s.ax) * s.ux + (py - s.ay) * s.uy;
  if (t < 0) t = 0; else if (t > s.L) t = s.L;
  const cx = s.ax + s.ux * t, cy = s.ay + s.uy * t;
  return Math.hypot(px - cx, py - cy);
}

/*
 * Are these two segments part of one corridor?
 *
 * Deliberately the SAME predicate gen_internal.js uses to decide lane-bundle
 * membership — near-parallel within `cosAngle`, and each one's midpoint within
 * `dist` of the other — with one difference that matters: membership skips
 * pairs belonging to the same route (a route cannot co-run with itself), and
 * orientation must NOT, because a route doubling back on itself is half of what
 * this module exists to fix.
 *
 * `Math.abs` on the dot product is the point: two segments pointing OPPOSITE
 * ways along one street are the same corridor. Deciding which of them to flip
 * is the caller's job, below.
 */
function corridorNeighbours(a, b, { dist, cosAngle }) {
  if (Math.abs(a.ux * b.ux + a.uy * b.uy) < cosAngle) return false;
  if (pointSegDist(a.mx, a.my, b) > dist) return false;
  if (pointSegDist(b.mx, b.my, a) > dist) return false;
  return true;
}

/*
 * A route's own polyline is, trivially, one corridor running along itself.
 *
 * This is not a refinement — without it the whole thing fails. corridorNeighbours
 * measures LATERAL proximity, because that is what bundle membership needs, and
 * whether two CONSECUTIVE segments of one polyline fall inside `dist` of each
 * other is an accident of how long they are: the midpoint of a 4.3 mm segment is
 * 2.15 mm from its neighbour, which passes a 2.4 mm test, and a 5 mm one does
 * not. So corridors fragmented along their own length, each fragment got its own
 * seed, and the reference flip simply moved to whichever segment the fragment
 * boundary landed on. Measured on St Neots Town Centre 2026-08-26: the flip at
 * the reported vertex was repaired and an identical one appeared one segment
 * west.
 *
 * Segments are grouped BY ROUTE and paired within each group, rather than by
 * looking at neighbouring array positions. Array adjacency was the first
 * implementation and it fails SILENTLY: hand it segments interleaved by route
 * and it returns an empty list, no error, and the field quietly loses every
 * bridge it should have had. gen_internal.js does build SEG route by route, so
 * the two behave identically there — which is exactly why the weaker one would
 * never have been caught by a gate; it was caught by a unit test whose fixture
 * happened to interleave. Grouping also survives the skipped zero-length
 * segments that make a route's own `i` values jump.
 *
 * THE ANGLE TEST IS A PARAMETER AND gen_internal.js PASSES -1, WHICH ACCEPTS
 * EVERYTHING. That looks careless and it is measured. Filtering chain edges by
 * the same 22 degree tolerance the lateral test uses reads as the principled
 * choice — "a corridor ends where the road turns" — and on the board it made
 * things WORSE, 66 mirror sites against 114. The edges it discards are the ones
 * that reach round a bend to the fragments the lateral test cannot see, and
 * because a chain edge can only ever BRIDGE (see orientSegments), letting it
 * run through a corner costs nothing: it can never contradict the lateral
 * structure. The parameter stays because the tolerance is the caller's to set
 * and because the test suite pins both behaviours.
 *
 * `Math.abs`, as in corridorNeighbours: a hairpin joins two segments that are
 * antiparallel and unmistakably the same street, so it stays one corridor whose
 * direction reverses through the turn — which the sign then expresses.
 */
function chainPairs(segs, { cosAngle }) {
  const byRoute = new Map();
  for (let i = 0; i < segs.length; i++) {
    const r = segs[i].r;
    if (!byRoute.has(r)) byRoute.set(r, []);
    byRoute.get(r).push(i);
  }
  const out = [];
  for (const idx of byRoute.values()) {
    for (let k = 1; k < idx.length; k++) {
      const a = segs[idx[k - 1]], b = segs[idx[k]];
      if (Math.abs(a.ux * b.ux + a.uy * b.uy) < cosAngle) continue;
      out.push([idx[k - 1], idx[k]]);
    }
  }
  return out;
}

/*
 * Give every segment a sign, so that heading * sign points one agreed way along
 * its corridor.
 *
 * The two kinds of edge are NOT equal, and that is the whole design.
 *
 * `lateral` — pairs from corridorNeighbours — is the structure that matters: two
 * segments running alongside each other are the ones that will be asked for a
 * shared normal. The caller supplies these because gen_internal.js already runs
 * the O(n^2) pass that finds them when it computes bundle membership, and asking
 * for them here would mean repeating the most expensive pass in the generator.
 *
 * `chain` — pairs from chainPairs — is used ONLY TO BRIDGE. A chain edge is
 * applied when it joins two components that nothing else connects, and dropped
 * when both ends already share a component. The first attempt at this treated
 * both kinds alike and it made things worse, not better: a route that leaves a
 * corridor, goes round a block and rejoins closes a cycle, and a cycle can
 * demand that one segment be both +1 and -1. Whichever edge lost that argument
 * planted an arbitrary disagreement in the middle of a corridor, which is the
 * very defect being repaired — Beaconsfield Simpson Centre went from zero flips
 * to two, and High Wycombe's rose. As a bridge a chain edge can never close a
 * cycle, so it can never contradict the lateral structure; it only reaches the
 * fragments the lateral test cannot see, which is exactly what it is for.
 *
 * Conflicts among LATERAL edges are still possible (two streets meeting at both
 * ends inside the angle tolerance) and cannot be resolved, only counted: such a
 * corridor has no consistent orientation to find. First union wins, `conflicts`
 * reports how many edges disagreed, and DBG_LANES prints it. Silently re-seeding
 * would hide a real property of the geometry.
 *
 * ANCHORING. A component's absolute sign is arbitrary — only relative signs
 * remove flips — so it is chosen to make the component's LOWEST-INDEX segment
 * +1, i.e. as digitised. That is what keeps the common case (a corridor whose
 * routes all run the same way) byte-identical to the behaviour before any of
 * this existed, instead of mirroring every lane bundle on the board for nothing.
 */
function orientSegments(segs, lateral, chain) {
  const n = segs.length;
  const parent = new Int32Array(n);
  const rank = new Int32Array(n);
  const parity = new Int8Array(n); // sign relative to parent
  for (let i = 0; i < n; i++) { parent[i] = i; parity[i] = 1; }

  // find with path compression, accumulating parity to the root. Iterative
  // rather than recursive: a component can hold every segment on the sheet.
  function find(x) {
    let root = x, p = 1;
    while (parent[root] !== root) { p *= parity[root]; root = parent[root]; }
    let cur = x, curP = p;
    while (parent[cur] !== cur) {
      const next = parent[cur], nextP = curP * parity[cur];
      parent[cur] = root; parity[cur] = curP;
      cur = next; curP = nextP;
    }
    return { root, parity: p };
  }
  // rel: +1 if i and j should share a sign, -1 if they should oppose.
  // Returns 'merged' | 'agreed' | 'conflict'.
  function union(i, j, rel) {
    const a = find(i), b = find(j);
    if (a.root === b.root) return (a.parity * b.parity === rel) ? 'agreed' : 'conflict';
    // want: parity[i]*sign(rootA) related to parity[j]*sign(rootB) by rel
    const rootRel = rel * a.parity * b.parity;
    let lo = a.root, hi = b.root;
    if (rank[lo] < rank[hi] || (rank[lo] === rank[hi] && lo > hi)) { lo = b.root; hi = a.root; }
    parent[hi] = lo; parity[hi] = rootRel;
    if (rank[lo] === rank[hi]) rank[lo]++;
    return 'merged';
  }
  const rel = (a, b) => ((a.ux * b.ux + a.uy * b.uy) >= 0 ? 1 : -1);

  let conflicts = 0, bridges = 0;
  for (let p = 0; p < lateral.length; p++) {
    const i = lateral[p][0], j = lateral[p][1];
    if (union(i, j, rel(segs[i], segs[j])) === 'conflict') conflicts++;
  }
  for (let p = 0; p < chain.length; p++) {
    const i = chain[p][0], j = chain[p][1];
    if (find(i).root === find(j).root) continue;      // bridges only, never a cycle
    union(i, j, rel(segs[i], segs[j]));
    bridges++;
  }

  // anchor each component on its lowest-index member, then read the signs off
  const anchorParity = new Map();
  const sign = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const f = find(i);
    if (!anchorParity.has(f.root)) anchorParity.set(f.root, f.parity);
    sign[i] = f.parity * anchorParity.get(f.root);
  }
  return { sign, components: anchorParity.size, conflicts, bridges };
}

/*
 * The replacement for refDir(): the local heading of route r0, oriented to its
 * corridor.
 *
 * Selection is unchanged — r0's own segment whose midpoint is nearest — because
 * that part was never the bug. Only the sign is now governed. `fx, fy` is the
 * caller's fallback for a route with no segments of its own, returned as given.
 *
 * The returned vector is NOT normalised, exactly as refDir's was not: callers
 * divide by its length themselves, and segment headings are already unit
 * vectors, so this is a distinction without a difference. Kept identical so
 * that a corridor with no flips in it reproduces byte-for-byte.
 */
function makeRefDir(segs, indexByRoute, sign) {
  const last = { r0: null, at: -1, ux: 0, uy: 0, dist: 0, sign: 1 };
  const refDir = (r0, mx, my, fx, fy) => {
    const idx = indexByRoute[r0];
    if (!idx || !idx.length) { last.at = -1; return [fx, fy]; }
    let best = Infinity, bux = fx, buy = fy, bAt = -1, bSeg = -1;
    for (let k = 0; k < idx.length; k++) {
      const s = segs[idx[k]];
      const dd = (s.mx - mx) * (s.mx - mx) + (s.my - my) * (s.my - my);
      if (dd < best) { best = dd; bux = s.ux; buy = s.uy; bAt = s.i; bSeg = idx[k]; }
    }
    // sign === null is the key-off path: no orientation, raw heading, which is
    // byte-for-byte what refDir did before this module existed.
    const sg = (sign && bSeg >= 0) ? (sign[bSeg] || 1) : 1;
    last.r0 = r0; last.at = bAt; last.ux = bux * sg; last.uy = buy * sg;
    last.dist = Math.sqrt(best); last.sign = sg;
    return [bux * sg, buy * sg];
  };
  refDir.last = last;
  return refDir;
}

module.exports = { pointSegDist, corridorNeighbours, chainPairs, orientSegments, makeRefDir };
