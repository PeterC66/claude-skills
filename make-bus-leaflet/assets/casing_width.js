/*
 * casing_width.js — narrow a road-casing segment that is wider than the road
 * around it, so a knot of short wide segments stops fusing into a grey lobe.
 *
 * WHY THIS EXISTS (buses-data OA-064, 2026-09-27)
 *
 * gen_internal.js sizes each casing segment by every bundle member whose line
 * passes within corridor.dist of the segment's MIDPOINT. Where many routes
 * converge on a junction they are all credited, although they are converging
 * rather than running parallel, so a segment a millimetre or two long gets the
 * full width of the stack and a ROUND cap — a disc — and a cluster of discs
 * fuses into one lobe. `internalRoads.skeletonMaxW` hides it by clamping every
 * segment, which also narrows a real five-to-seven-lane street elsewhere; four
 * other ways out were measured and ruled out (OA-064's row names the commits).
 *
 * What works, measured on all 23 committed internal sheets (buses-data
 * 1e867743): replace each segment's width by the SMALLER of its own width and
 * the length-weighted median width of the casing within k x its own width of its
 * midpoint, walking along the casing graph. A lobe is a few short wide segments
 * among long narrower ones, so its median is the road's width; a real wide
 * street is long runs of the same width, so its median is itself. k = 1 took
 * exactly High Wycombe's and Huntingdon's centre discs and halved Wisbech's and
 * March's knots while leaving Ely Co-op's main road untouched; k = 2 starts to
 * cut street width at junctions. A PLAIN median (which may widen) is rejected:
 * it put 25% more grey into a crop at High Wycombe's centre.
 *
 * One change from that measurement, made when this was built: a neighbour
 * counts for the length of it inside the window, not its whole length, because
 * whole lengths narrowed the last segment of a wide street wherever a long
 * narrow road met it. Re-measured on the same 23 sheets the day it was built;
 * the numbers are in the pull request that added this file.
 *
 * CONTRACT. `smoothCasingWidths(segs, k)` takes [{x0,y0,x1,y1,w}] in drawing
 * order and returns a new array of widths, one per segment, each <= its input.
 * Segments are joined where their endpoints agree to 0.01 mm — the precision the
 * SVG prints them at, and what the measurement joined on. Deterministic: no
 * clock, no randomness, ties broken by drawing order. Reads and writes nothing.
 */
'use strict';

const key = (x, y) => x.toFixed(2) + ',' + y.toFixed(2);

function smoothCasingWidths(segs, k) {
  const n = segs.length;
  const node = new Map();                 // endpoint key -> node index
  const adj = [];                         // node -> [segment index]
  const ends = new Array(n);              // segment -> [nodeA, nodeB]
  const len = new Array(n);
  const nodeOf = (x, y) => { const s = key(x, y); let i = node.get(s);
    if (i === undefined) { i = adj.length; node.set(s, i); adj.push([]); } return i; };
  for (let i = 0; i < n; i++) {
    const g = segs[i], a = nodeOf(g.x0, g.y0), b = nodeOf(g.x1, g.y1);
    ends[i] = [a, b]; len[i] = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    adj[a].push(i); if (b !== a) adj[b].push(i);
  }
  const out = new Array(n);
  for (let s = 0; s < n; s++) {
    const R = k * segs[s].w;
    // Dijkstra from the segment's midpoint, out to R along the casing graph.
    const dist = new Map(), done = new Set(), seen = new Set([s]);
    const half = len[s] / 2;
    for (const v of ends[s]) if (!dist.has(v) || dist.get(v) > half) dist.set(v, half);
    for (;;) {
      let u = -1, du = Infinity;
      for (const [v, d] of dist) if (!done.has(v) && d < du) { du = d; u = v; }
      if (u < 0 || du > R) break;
      done.add(u);
      for (const t of adj[u]) {
        seen.add(t);                      // any part of t lies within R
        const [a, b] = ends[t], o = a === u ? b : a, d2 = du + len[t];
        if (d2 <= R && (!dist.has(o) || dist.get(o) > d2)) dist.set(o, d2);
      }
    }
    // Weight = the length of each segment that lies WITHIN R, not its whole length:
    // a long narrow road meeting the end of a wide street would otherwise outvote
    // the street and narrow its last segment. Then the weighted median; ties by
    // drawing order.
    const wt = new Map([[s, Math.min(len[s], 2 * R)]]);
    for (const t of seen) { if (t === s) continue; let c = 0;
      for (const v of new Set(ends[t])) if (done.has(v)) c += R - dist.get(v);
      wt.set(t, Math.min(len[t], c)); }
    const got = [...seen].sort((p, q) => segs[p].w - segs[q].w || p - q);
    let total = 0; for (const t of got) total += wt.get(t);
    let med = segs[s].w;
    if (total > 0) { let acc = 0;
      for (const t of got) { acc += wt.get(t); if (acc >= total / 2) { med = segs[t].w; break; } } }
    out[s] = Math.min(segs[s].w, med);
  }
  return out;
}

module.exports = { smoothCasingWidths };
