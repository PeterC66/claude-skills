// road_graph.js — the road graph the two internal PRE-STAGES both build
// (OA-232 Tier 3.3, codebase review 2026-09-03 engine F4/M6).
//
// `diagram_internal.js` and `schematize_internal.js` are both geometry
// pre-stages: each reduces the S2 geometry to a graph of corridors, solves that
// graph, and re-emits the SAME file formats into a workspace for an unchanged
// `gen_internal.js` to draw. They arrived at that shape independently and ended
// up with one algorithm written twice.
//
// WHAT IS ACTUALLY SHARED, AND WHY THE REVIEW'S NUMBER WAS NOT IT. The finding
// that produced this file measured "246 shared lines" with `comm` over sorted,
// whitespace-stripped lines. That is a SET intersection: it says the two files
// contain the same 246 strings somewhere, and nothing about whether they are
// contiguous or even in the same order. Measured again as runs, there was
// exactly ONE stretch of 12 consecutive shared lines in 233 — most of the
// "shared" lines are `for (const ...)` and `if (...) continue;` matching by
// coincidence. Read as FUNCTIONS instead, the real overlap is the nine things
// below, and it is genuine. A line count over a sorted set is a bound on
// nothing; the unit of a duplication is the function, and that is what this
// file is.
//
// THE DIFFERENCES ARE THREE, AND THEY ARE PARAMETERS — which is the shape
// `external_primitives.js` already established for the two external generators:
//
//   1. the diagram carries `ll` on every node and the schematic does not,
//   2. the diagram carries `name` on every edge and the schematic does not,
//   3. the schematic calls its Douglas-Peucker `dp` and the diagram `dpTol`.
//
// SHAPE IS PASSED AS WHOLE OBJECT LITERALS, NOT AS A SPREAD, and that is the one
// decision here worth arguing with. `{ mm, ...(ll ? { ll } : {}), adj }` would be
// shorter and would build a DIFFERENT object: the key ORDER changes, and an
// `ll: undefined` is not an absent `ll` the moment anything serialises a node.
// These pre-stages write JSON for a living. Two literals, chosen once per run,
// cost four lines and make the move provably inert.
//
// EVERY BODY BELOW IS THE ONE THAT WAS IN `diagram_internal.js`, SPLICED RATHER
// THAN RETYPED, and that is not fussiness. The first draft of this file had
// `lsq` and `dpTol` written out from their shape, and both were a different
// algorithm — a dense Gauss-Jordan instead of the flat Float64Array forward
// elimination with a rank-deficiency `continue`, and a Douglas-Peucker missing
// the degenerate-segment branch. Both would have compiled, both would have
// returned plausible numbers, and the byte gates would have caught them only
// after thirteen sheets had moved. A "pure move" that retypes anything is not
// one.
//
// NOTHING HERE READS A CONFIG, A FILE OR AN ENVIRONMENT VARIABLE. `mergeJn` and
// `mergeEdge` arrive as numbers because one caller reads them from `DG` and the
// other from `SCH`, and `contract()` RETURNS its merge count instead of logging
// it, because the two callers' log lines differ and that wording is theirs.
//
// It is required by both pre-stages, so it is inside `engineFiles()` by closure
// and a change here moves the town engine hash. `test/road_graph.test.js` holds
// its arithmetic; the 13 diagram and schematic byte gates hold the rest.
'use strict';

/** Node identity = OSM node coordinates at 6dp. routes_paths points were written
 *  at 6dp from the same roads_geo geometry, so keys match exactly. */
const key6 = ll => (+ll[0]).toFixed(6) + ',' + (+ll[1]).toFixed(6);

/** Douglas-Peucker by perpendicular tolerance; pushes kept indices into `keep`.
 *  `schematize_internal.js` calls this `dp` and `diagram_internal.js` `dpTol`,
 *  which is difference 3 and the whole of it. */
function dpTol(pts, i0, i1, tol, keep) {
  let bi = -1, bd = 0;
  const a = pts[i0], b = pts[i1];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  for (let i = i0 + 1; i < i1; i++) {
    const d = L < 1e-9 ? Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1])
      : Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L;
    if (d > bd) { bd = d; bi = i; }
  }
  if (bd > tol && bi > 0) { dpTol(pts, i0, bi, tol, keep); keep.push(bi); dpTol(pts, bi, i1, tol, keep); }
}

/** Smallest absolute angle between two bearings, in degrees. */
const angdist = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Weighted least squares by normal equations, partial-pivot forward elimination
 *  and back substitution, on ONE flat Float64Array. `rows` is
 *  [{ cs: [[var, coef], ...], t, w }]; the returned Float64Array is NV long.
 *  The `continue` on a near-zero pivot is what lets a rank-deficient system
 *  (a corridor nothing constrains) leave its variables at zero rather than
 *  producing an infinity that would fly the sheet apart. */
function lsq(NV, rows) {
  const M = new Float64Array(NV * NV), R = new Float64Array(NV);
  for (const { cs, t, w } of rows)
    for (const [i, ci] of cs) { R[i] += w * ci * t; for (const [j, cj] of cs) M[i * NV + j] += w * ci * cj; }
  for (let c = 0; c < NV; c++) {
    let p = c; for (let r2 = c + 1; r2 < NV; r2++) if (Math.abs(M[r2 * NV + c]) > Math.abs(M[p * NV + c])) p = r2;
    if (Math.abs(M[p * NV + c]) < 1e-12) continue;
    if (p !== c) { for (let j = c; j < NV; j++) { const t = M[c * NV + j]; M[c * NV + j] = M[p * NV + j]; M[p * NV + j] = t; } const t = R[c]; R[c] = R[p]; R[p] = t; }
    const pv = M[c * NV + c];
    for (let r2 = c + 1; r2 < NV; r2++) {
      const f = M[r2 * NV + c] / pv; if (!f) continue;
      for (let j = c; j < NV; j++) M[r2 * NV + j] -= f * M[c * NV + j];
      R[r2] -= f * R[c];
    }
  }
  for (let c = NV - 1; c >= 0; c--) {
    let s = R[c];
    for (let j = c + 1; j < NV; j++) s -= M[c * NV + j] * R[j];
    R[c] = Math.abs(M[c * NV + c]) < 1e-12 ? 0 : s / M[c * NV + c];
  }
  return R;
}

/** Inverse-distance displacement field from the SOLVED solver nodes, used to
 *  carry everything the solver did not move — POIs, the river, features — along
 *  with the roads. Both pre-stages built `samples` from `SN` in the same line,
 *  so it is built here and closed over. */
function makeWarp(SN) {
  const samples = [];
  for (const [id, n] of SN) samples.push({ o: n.mm0, d: [n.mm[0] - n.mm0[0], n.mm[1] - n.mm0[1]] });
  return function warp(mm) {
    let sw = 0, sx = 0, sy = 0;
    for (const s of samples) {
      const d2 = (mm[0] - s.o[0]) ** 2 + (mm[1] - s.o[1]) ** 2;
      const w = 1 / (d2 + 9);
      sw += w; sx += w * s.d[0]; sy += w * s.d[1];
    }
    return sw ? [mm[0] + sx / sw, mm[1] + sy / sw] : mm.slice();
  };
}

/** Node degree. */
const deg = (N, kk) => N.get(kk).adj.size;

/** Follow a degree-2 chain from junction `k0` towards `k1`, marking every edge it
 *  consumes in `eSeen` so the caller's enumeration visits each corridor once. */
function walk(N, eSeen, k0, k1) {
  const chain = [k0, k1];
  eSeen.add(N.get(k0).adj.get(k1));
  let prev = k0, cur = k1;
  while (deg(N, cur) === 2) {
    const nxt = [...N.get(cur).adj.keys()].find(x => x !== prev);
    if (nxt == null) break;
    const eid = N.get(cur).adj.get(nxt);
    if (eSeen.has(eid)) break;
    eSeen.add(eid); chain.push(nxt); prev = cur; cur = nxt;
  }
  return chain;
}

/**
 * The three operations that touch a caller's node and edge SHAPE, bound once.
 *
 * `XY` is that caller's projection (planar -> rotation -> fisheye -> fit); this
 * file never builds one. `withLatLon` and `withName` are differences 1 and 2 in
 * the header, and each selects a whole object literal rather than adding a key.
 */
function graphOps({ XY, withLatLon = false, withName = false }) {
  const mkNode = withLatLon
    ? ll => ({ mm: XY(ll), ll: [+ll[0], +ll[1]], adj: new Map() })
    : ll => ({ mm: XY(ll), adj: new Map() });
  const reNode = withLatLon
    ? n => ({ mm: n.mm, ll: n.ll, adj: new Map() })
    : n => ({ mm: n.mm, adj: new Map() });
  const mkEdge = withName
    ? (a, b, name) => ({ a, b, name: name || null })
    : (a, b) => ({ a, b });
  const reEdge = withName
    ? (e, a, b) => ({ a, b, name: e.name })
    : (e, a, b) => ({ a, b });

  /** Intern one lat/lon as a node; returns its key. */
  function node(N, ll) {
    const kk = key6(ll); let n = N.get(kk);
    if (!n) { n = mkNode(ll); N.set(kk, n); }
    return kk;
  }

  /** Add an undirected edge between two interned keys. A self-loop and a
   *  duplicate are both no-ops, which is what makes the callers' route-by-route
   *  insertion idempotent. `name` is ignored unless `withName`. */
  function addEdge(N, E, ka, kb, name) {
    if (ka === kb) return;
    const na = N.get(ka);
    if (na.adj.has(kb)) return;
    const id = E.length; E.push(mkEdge(ka, kb, name));
    na.adj.set(kb, id); N.get(kb).adj.set(ka, id);
  }

  /**
   * Junction-cluster contraction to a fixpoint, six passes as both callers had.
   * Two reaches: `mergeJn` merges non-degree-2 nodes that are merely close, and
   * `mergeEdge` merges the pairs a real edge confirms are one place, which also
   * cleans up the stubs the first reach leaves behind.
   *
   * Returns the REBUILT graph rather than mutating the caller's bindings, and
   * returns `totalMerged` rather than logging it — the two callers' log lines
   * differ, one naming its thresholds and the other not, and that wording is
   * theirs. `REP` maps every absorbed original key to its final representative,
   * chains already flattened. Six is kept as a literal rather than becoming a
   * parameter nobody passes: this is a move, not a generalisation.
   */
  function contract(N, E, { mergeJn, mergeEdge }) {
    const REP = new Map();
    let totalMerged = 0;
    if (!(mergeJn > 0 || mergeEdge > 0)) return { N, E, REP, totalMerged };
    for (let pass = 0; pass < 6; pass++) {
      const jk = [...N.entries()].filter(([k, n]) => n.adj.size !== 2).map(([k]) => k);
      const uf = new Map(jk.map(k => [k, k]));
      const find = k => { let r = k; while (uf.get(r) !== r) r = uf.get(r); uf.set(k, r); return r; };
      for (let i = 0; i < jk.length; i++) for (let j = i + 1; j < jk.length; j++) {
        const a = N.get(jk[i]).mm, b = N.get(jk[j]).mm;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < mergeJn) {
          const ra = find(jk[i]), rb = find(jk[j]); if (ra !== rb) uf.set(ra, rb);
        }
      }
      if (mergeEdge > 0) for (const e of E) {
        const A = N.get(e.a), B = N.get(e.b);
        if (A.adj.size === 2 || B.adj.size === 2) continue;     // both ends junction/stub
        if (Math.hypot(A.mm[0] - B.mm[0], A.mm[1] - B.mm[1]) < mergeEdge) {
          const ra = find(e.a), rb = find(e.b); if (ra !== rb) uf.set(ra, rb);
        }
      }
      const clusters = new Map();
      for (const k of jk) { const r = find(k); (clusters.get(r) || clusters.set(r, []).get(r)).push(k); }
      const localRep = new Map(); let merged = 0;
      for (const [r, ms] of clusters) if (ms.length > 1) {
        merged += ms.length - 1;
        const cx = ms.reduce((s, k) => s + N.get(k).mm[0], 0) / ms.length;
        const cy = ms.reduce((s, k) => s + N.get(k).mm[1], 0) / ms.length;
        for (const k of ms) if (k !== r) { REP.set(k, r); localRep.set(k, r); }
        N.get(r).mm = [cx, cy];
      }
      if (!merged) break;
      totalMerged += merged;
      const rep = k => localRep.has(k) ? localRep.get(k) : k;   // this pass only
      const N2 = new Map(), E2 = [];
      for (const [k, n] of N) if (rep(k) === k) N2.set(k, reNode(n));
      for (const e of E) {
        const a = rep(e.a), b = rep(e.b);
        if (a === b || N2.get(a).adj.has(b)) continue;
        const id = E2.length; E2.push(reEdge(e, a, b));
        N2.get(a).adj.set(b, id); N2.get(b).adj.set(a, id);
      }
      N = N2; E = E2;
    }
    // flatten REP chains (orig -> rep1 -> rep2 ...) to a single final rep in N
    const resolve = k => { let r = k; while (REP.has(r)) r = REP.get(r); return r; };
    for (const k of [...REP.keys()]) REP.set(k, resolve(k));
    return { N, E, REP, totalMerged };
  }

  return { node, addEdge, contract };
}

module.exports = { key6, dpTol, angdist, lsq, makeWarp, deg, walk, graphOps };
