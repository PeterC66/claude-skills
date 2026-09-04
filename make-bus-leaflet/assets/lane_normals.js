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
function corridorNeighbours(a, b, { dist, cosAngle, alongside }) {
  if (Math.abs(a.ux * b.ux + a.uy * b.uy) < cosAngle) return false;
  if (pointSegDist(a.mx, a.my, b) <= dist && pointSegDist(b.mx, b.my, a) <= dist) return true;
  return !!alongside && (liesAlongside(a, b, dist) || liesAlongside(b, a, dist));
}

/*
 * Does the whole of segment `s` lie beside segment `u` — both of its ends
 * projecting INSIDE u's extent, each within `dist` of u's line?
 *
 * THE MIDPOINT TEST CANNOT PAIR A SHORT SEGMENT WITH A LONG ONE, and that is a
 * property of the test rather than of any street. The reciprocal half asks
 * whether u's midpoint is within `dist` of s; when s is 0.1 mm long beside the
 * middle of a 6 mm u, that distance is measured to s's nearest END and is the
 * along-track distance, ~3 mm, so the pair is refused. The short segment then
 * belongs to no bundle for its 0.1 mm, every lane in the bundle steps inward by
 * half a gap to fill the space it left, and steps back out one vertex later — a
 * spike the width of a stroke. Measured 2026-09-04 over the 18 internal sheets:
 * 160 such one-segment blips, 72 of them on High Wycombe, where a fourteen-lane
 * bundle at x≈98 drops the 850 for one segment and every other lane jumps.
 *
 * This predicate can only ADD pairs: a pair the midpoint test accepts is not
 * consulted here. It is asked in both directions by the caller, and it is opt-in
 * (`alongside`), because widening bundle membership moves casing widths and lane
 * offsets on every sheet, and that has to be judged on the artwork.
 */
function liesAlongside(s, u, dist) {
  for (const [px, py] of [[s.ax, s.ay], [s.ax + s.ux * s.L, s.ay + s.uy * s.L]]) {
    const t = (px - u.ax) * u.ux + (py - u.ay) * u.uy;
    if (t < 0 || t > u.L) return false;
    if (Math.hypot(px - (u.ax + u.ux * t), py - (u.ay + u.uy * t)) > dist) return false;
  }
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
 *
 * WHAT A CHAIN EDGE SAYS, and the two answers (`chainRel`).
 *
 * A segment's sign is whether the route travels WITH the corridor direction or
 * against it, and the lane normal is the corridor's, so the sign is also which
 * side of its own travel a route's lane sits on. A chain edge joins two
 * consecutive segments of one route, and until 2026-09-04 it related them by
 * the sign of their dot product — 'heading': agree through a turn of less than
 * a right angle, oppose through anything sharper. That is the right relation
 * for a LATERAL pair, where opposite headings really are opposite directions
 * along one street; for a chain edge it means every bridged corner sharper than
 * 90 degrees mirrors the whole bundle, because the normal turns 180 minus the
 * corner's angle the OTHER way while the route turns the corner. High Wycombe's
 * 32 and 34 turn 107 degrees together at x=158, y=112 and swap sides there; the
 * exact right angle is a coin toss on the fourth decimal, and Beaconsfield's
 * five-route bundle at x=87, y=63 landed on the wrong side of it (dot -0.011).
 *
 * 'continue' says what a ribbon cable says: a route keeps its side of travel
 * through every turn. The only thing that may reverse a route's side is the
 * lateral structure — a route doubling back beside itself is both with and
 * against its corridor, unavoidably — and a chain edge is applied only as a
 * bridge, so the lateral structure still wins wherever it has an opinion.
 * Default 'heading', so a caller that does not ask gets the field as it was.
 */
function orientSegments(segs, lateral, chain, { chainRel = 'heading' } = {}) {
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
    union(i, j, chainRel === 'continue' ? 1 : rel(segs[i], segs[j]));
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
 *
 * NEAREST IS NOT ALONGSIDE (`cosAngle`, 2026-09-04). Bundle membership was
 * decided by a segment of r0 that runs near-parallel to the asking segment and
 * within the bundling distance of it — and then the normal was taken from
 * whichever segment of r0 has the nearest MIDPOINT, which at a junction is
 * routinely the one where r0 turns off. High Wycombe's 34 heads north at x=158,
 * y=131 beside the 102, whose nearest segment there heads EAST: the 34's
 * 4.2 mm lane offset was applied along its own line instead of across it.
 * Measured 2026-09-04: 693 in-frame bundled segments on the estate took their
 * normal from a reference segment more than 22 degrees off their own heading,
 * 271 of them on High Wycombe. With `cosAngle` given, `fx, fy` is read as the
 * asking segment's own heading and only r0's segments within that angle of it
 * are candidates; `last.parallel` says whether one was found, and when none
 * was the nearest of all is returned as before so the caller can decide.
 */
function makeRefDir(segs, indexByRoute, sign, { cosAngle } = {}) {
  const last = { r0: null, at: -1, ux: 0, uy: 0, dist: 0, sign: 1, parallel: true };
  const refDir = (r0, mx, my, fx, fy) => {
    const idx = indexByRoute[r0];
    if (!idx || !idx.length) { last.at = -1; last.parallel = false; return [fx, fy]; }
    const fL = Math.hypot(fx, fy) || 1, ox = fx / fL, oy = fy / fL;
    const filter = cosAngle != null;
    let best = Infinity, bux = fx, buy = fy, bAt = -1, bSeg = -1;
    let anyBest = Infinity, aux = fx, auy = fy, aAt = -1, aSeg = -1;
    for (let k = 0; k < idx.length; k++) {
      const s = segs[idx[k]];
      const dd = (s.mx - mx) * (s.mx - mx) + (s.my - my) * (s.my - my);
      if (dd < anyBest) { anyBest = dd; aux = s.ux; auy = s.uy; aAt = s.i; aSeg = idx[k]; }
      if (filter && Math.abs(s.ux * ox + s.uy * oy) < cosAngle) continue;
      if (dd < best) { best = dd; bux = s.ux; buy = s.uy; bAt = s.i; bSeg = idx[k]; }
    }
    last.parallel = bSeg >= 0;
    if (bSeg < 0) { best = anyBest; bux = aux; buy = auy; bAt = aAt; bSeg = aSeg; }
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

/*
 * The offset to apply at a polyline VERTEX, given the offsets applied to the two
 * segments that meet there.
 *
 * gen_internal.js averaged them — `(v[i-1] + v[i]) / 2` — and for a ribbon that
 * holds its side through a corner the average is the wrong point: it lies on
 * the bisector at cos(θ/2) times the lane offset, so every lane in a bundle is
 * pulled toward the raw corner by the same FACTOR, and the lanes close up. At a
 * right angle they sit at 71% of their spacing; at 120 degrees, 50%, which with
 * a 2.8 mm gap and a 1.7 mm stroke is a corner where the colours touch. The
 * mitre point, `(a + b) / (1 + n1·n2)`, is where two lines each offset by the
 * same distance actually meet, so the lanes stay their full gap apart through
 * the turn. `limit` caps the factor for a very sharp corner, the way an SVG
 * miterlimit does; past it the vertex is still on the bisector, just short.
 *
 * Two degenerate cases keep this safe under the old field. A vertex whose two
 * sides have the SAME offset (a route doubling back beside itself, both legs
 * overlaid) has n1·n2 = 1 and the mitre IS the average. A vertex where the
 * sides oppose (a mirror, which the 'continue' field removes and the 'heading'
 * field cannot) has a + b = 0, and the answer is the average again — nothing
 * here can make a mirror worse than it was.
 *
 * AND THE MITRE MUST FIT THE SEGMENTS IT SITS BETWEEN. The mitre point reaches
 * d·tan(θ/2) along each segment from the raw corner; a segment shorter than
 * that has its two vertices thrown past each other and the lane folds into a
 * notch — seen on High Wycombe's 36 at x=160, y=133 the first time this ran.
 * `la`, `lb` are the raw lengths of the two segments; the reach along either is
 * held to half its length, which is the point past which the other end's own
 * mitre would meet it. A vertex given no lengths is capped by `limit` alone.
 */
function laneVertex(a, b, { limit = 3, la, lb } = {}) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1];
  const La = Math.hypot(ax, ay), Lb = Math.hypot(bx, by);
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  if (La < 1e-9 || Lb < 1e-9) return [mx, my];
  const c = (ax * bx + ay * by) / (La * Lb);
  let f = (1 + c) <= 1e-9 ? limit : Math.min(limit, 2 / (1 + c));
  // reach of the averaged vertex along a segment is |avg|·sin(θ/2); scaled by f
  const reach = Math.hypot(mx, my) * Math.sqrt(Math.max(0, (1 - c) / 2));
  const room = Math.min(la == null ? Infinity : la, lb == null ? Infinity : lb) / 2;
  if (reach > 1e-9 && reach * f > room) f = Math.max(1, room / reach);
  return [mx * f, my * f];
}

/*
 * One unit heading per segment of a polyline, each read over a window of
 * ±`w` mm of arc length around the segment's midpoint rather than from the
 * segment alone.
 *
 * A map-matched polyline carries segments a tenth of a millimetre long at every
 * junction node, and their headings are noise: High Wycombe's 34 at x=157.7,
 * y=132.7 runs 0.008,-1.000 then -0.563,-0.827 then 0.073,-0.997 over 0.2 mm.
 * The middle one is 35 degrees off the street, fails the 22 degree bundling
 * test against every other route on it, and the bundle loses a lane for one
 * segment — the "blip" the 2026-09-04 census counted 160 of. Every route on
 * that street shares the vertex, so every one of them blips at the same spot.
 * Length is not the cure: the same segment also takes its lane normal from a
 * reference segment parallel to its NOISE, and swings the normal 25 degrees
 * for 0.1 mm. The chord over ±1 mm is the street's heading, and a segment
 * longer than 2w reads exactly its own heading, so nothing moves elsewhere.
 * Returns null for a polyline with fewer than two points.
 */
function smoothHeadings(points, w) {
  const n = points.length - 1;
  if (n < 1) return null;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  const total = cum[n];
  const at = (s) => {                       // the point at arc length s, clamped to the ends
    if (s <= 0) return points[0];
    if (s >= total) return points[n];
    let i = 0; while (i < n - 1 && cum[i + 1] < s) i++;
    const L = cum[i + 1] - cum[i]; const t = L > 0 ? (s - cum[i]) / L : 0;
    return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
  };
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const m = (cum[i] + cum[i + 1]) / 2;
    const a = at(m - w), b = at(m + w);
    let dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-9) { dx = points[i + 1][0] - points[i][0]; dy = points[i + 1][1] - points[i][1]; L = Math.hypot(dx, dy) || 1; }
    out[i] = [dx / L, dy / L];
  }
  return out;
}

module.exports = { pointSegDist, corridorNeighbours, liesAlongside, chainPairs, orientSegments, makeRefDir, laneVertex, smoothHeadings };
