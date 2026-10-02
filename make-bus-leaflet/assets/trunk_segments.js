/*
 * trunk_segments.js — draw the streets carried by many lanes as ONE neutral trunk,
 * with a badge stack at each place the lanes go in or fan out.
 *
 * WHY THIS EXISTS (buses-data OA-549, 2026-10-02)
 *
 * High Wycombe Town Centre draws 23 routes as 14 lanes, and every one of them runs
 * the same few hundred metres from the bus station along Oxford Street before
 * splitting. Bundling families (internalCorridors) and sharing hues
 * (corridorPalette) cannot reach that spine, because the cross-town routes that
 * crowd it belong to no family. The options paper (buses-data Development Docs/
 * high-wycombe-centre-sheet-options_2026-10-02.md, option 4) found that every
 * professional answer to this density boxes the centre, lists its stops, or draws
 * the centre's lines as a few trunks. This is the third.
 *
 * WHAT A TRUNK IS. Start from the generator's own lane-bundle membership (MEM: each
 * internalCorridors family is one lane), so a trunk agrees by construction with the
 * lane offsets drawn everywhere else. Every stretch on which MORE than `minLanes`
 * lanes run together, with one set of lanes over its length and at least
 * `minLength` mm long, is a candidate. Candidates whose bundles touch are ONE
 * trunk: on High Wycombe the two sides of the one-way loop are two candidates ten
 * lanes wide, overlapping, and drawing a stack for each would put four grids of
 * nineteen badges round one junction. A trunk therefore has a set of polylines,
 * the union of their routes, and as many stacks as it has free ends after ends
 * closer than `endMerge` mm are pooled.
 *
 * WHAT IS DRAWN. Inside a trunk no lane is drawn in its colour. The trunk is a
 * `width` mm ribbon in `color` on a white casing; each lane's last `fan` mm before
 * it is replaced by a straight run into the ribbon's end, its offset scaled down to
 * the ribbon's, so the lanes visibly gather into the trunk and spread out of it.
 * Stops inside a trunk are squeezed onto the ribbon the same way, and so is the
 * grey road casing under it.
 *
 * WHO A STACK NAMES. A route whose line comes out of the trunk in its own colour
 * is a THROUGH route: the reader follows the colour across the grey, and its arm
 * carries its own badges. Naming it again at both ends is what made the first High
 * Wycombe build draw two grids of nineteen badges, which Peter judged not worth it
 * (2026-10-02). So a stack names only the routes NOT seen leaving the trunk — the
 * ones a reader could otherwise not know are on it — and a trunk whose routes all
 * come out draws no stack. That is the promise S6 (verify_report.js, trunkFindings
 * below) checks against trunks[] in corridors_report.json, which records the routes
 * seen leaving and what each stack actually drew.
 *
 * OPT-IN. `internalRoads.trunkSegments` absent ⇒ nothing here runs and the sheet is
 * byte-identical (invariant 2). `true` takes DEFAULTS.
 */
'use strict';

const DEFAULTS = Object.freeze({ minLanes: 5, minLength: 8, width: 4.5, color: '#7d7d7d', casing: 0.5,
  fan: 5, endMerge: 14, badgeRadius: 2.0, maxCols: 7 });

function trunkConfig(v) {
  if (!v) return null;
  return Object.assign({}, DEFAULTS, v === true ? {} : v);
}

const keyOf = a => a.join('|');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function foot(M, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  let t = L2 ? ((M[0] - a[0]) * dx + (M[1] - a[1]) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + dx * t, a[1] + dy * t];
}
/* the nearest point to M on any of the polylines, and its distance */
function nearest(M, polys) {
  let best = null, bd = Infinity;
  for (const P of polys) for (let j = 0; j < P.length - 1; j++) {
    const f = foot(M, P[j], P[j + 1]), d = dist(M, f); if (d < bd) { bd = d; best = f; } }
  return { at: best, d: bd };
}
const polyLen = P => { let s = 0; for (let j = 0; j < P.length - 1; j++) s += dist(P[j], P[j + 1]); return s; };

/*
 * findTrunks — the trunks on this sheet, and which route segments they hide.
 *
 *   order  routes in draw order          RPP   r -> { P } projected matched polyline
 *   MEM    r -> { i: [lane keys] }        MEMR  r -> { i: [routes] }   (zero-length i absent)
 *   cfg    trunkConfig()                 CD    the corridor distance, mm     gap  lane pitch, mm
 *
 * A candidate follows its LEAD lane's polyline over a run of segments on which the
 * lead's lane set is exactly the candidate's. A route's segment is hidden when its
 * own set is one of its trunk's sets AND it lies along one of the trunk's
 * polylines, so a lane whose membership flickers for one segment at a junction is
 * not hidden where no ribbon is drawn. A run lying wholly along an earlier run of
 * the same set is the same street traced twice and is dropped.
 */
function findTrunks({ order, RPP, MEM, MEMR, cfg, CD, gap }) {
  const setAt = (r, i) => { const m = MEM[r] || {}; for (let k = i; k >= 0; k--) if (m[k]) return m[k]; return null; };
  const keys = new Map();
  for (const r of order) { const o = RPP[r]; if (!o) continue;
    for (let i = 0; i < o.P.length - 1; i++) { const a = setAt(r, i);
      if (a && a.length > cfg.minLanes && !keys.has(keyOf(a))) keys.set(keyOf(a), a); } }
  const cand = [];
  for (const [k, lanes] of keys) {
    const r0 = lanes[0], o = RPP[r0]; if (!o) continue;
    const span = (lanes.length - 1) * gap;
    for (let i = 0; i < o.P.length - 1;) {
      const s = setAt(r0, i); if (!(s && keyOf(s) === k)) { i++; continue; }
      let j = i; while (j + 1 < o.P.length - 1 && setAt(r0, j + 1) && keyOf(setAt(r0, j + 1)) === k) j++;
      const pts = o.P.slice(i, j + 2); i = j + 1;
      if (polyLen(pts) < cfg.minLength) continue;
      if (cand.some(c => c.key === k && pts.every(p => nearest(p, [c.pts]).d <= CD))) continue;
      cand.push({ key: k, lanes, pts, span });
    }
  }
  // candidates whose bundles touch are one trunk (single link, in discovery order)
  const touch = (a, b) => a.pts.some(p => nearest(p, [b.pts]).d <= (a.span + b.span) / 2 + CD)
                       || b.pts.some(p => nearest(p, [a.pts]).d <= (a.span + b.span) / 2 + CD);
  const groups = [];
  for (const c of cand) {
    const hit = groups.filter(g => g.some(m => touch(m, c)));
    const g = hit.length ? hit[0] : []; if (!hit.length) groups.push(g);
    for (const h of hit.slice(1)) { g.push(...h); groups.splice(groups.indexOf(h), 1); }
    g.push(c);
  }
  const rank = {}; order.forEach((r, n) => { rank[r] = n; });
  const byRank = (a, b) => rank[a] - rank[b];
  const trunks = groups.map((g, n) => ({ id: 'T' + (n + 1), keys: new Set(g.map(c => c.key)), polys: g.map(c => c.pts),
    span: Math.max(...g.map(c => c.span)), lanes: [...new Set([].concat(...g.map(c => c.lanes)))].sort(byRank), routes: [] }));
  const hidden = {};
  for (const r of order) { const o = RPP[r]; if (!o) continue;
    for (let i = 0; i < o.P.length - 1; i++) { const a = setAt(r, i); if (!a) continue;
      const k = keyOf(a), M = [(o.P[i][0] + o.P[i + 1][0]) / 2, (o.P[i][1] + o.P[i + 1][1]) / 2];
      const t = trunks.find(t2 => t2.keys.has(k) && nearest(M, t2.polys).d <= CD + t2.span / 2);
      if (!t) continue;
      (hidden[r] = hidden[r] || {})[i] = t;
      for (const m of ((MEMR[r] || {})[i] || [r])) if (!t.routes.includes(m)) t.routes.push(m);
    } }
  for (const t of trunks) t.routes.sort(byRank);
  return { trunks, hidden };
}

/* Record that route r is drawn in its own colour out of each trunk it runs in: one of
 * its drawn runs (after the coreBox cut) ends on that trunk's ribbon. */
function markExits(trunks, r, runs, cfg) {
  for (const t of trunks) {
    if (!t.routes.includes(r)) continue;
    if (runs.some(rn => rn.length > 1 && [rn[0], rn[rn.length - 1]].some(p => nearest(p, t.polys).d <= cfg.width)))
      (t.exits = t.exits || new Set()).add(r);
  }
}

/* The routes a trunk's stacks must name: those not seen leaving it in their colour. */
const unseen = t => t.routes.filter(r => !(t.exits && t.exits.has(r)));

/* Scale a point's offset from the trunk's centreline down to the ribbon's: a lane at
 * the edge of the span lands at the edge of the ribbon. */
function squeeze(p, t, cfg, stroke) {
  const n = nearest(p, t.polys), k = t.span > 0 ? Math.max(0, cfg.width - stroke) / t.span : 0;
  return [n.at[0] + (p[0] - n.at[0]) * k, n.at[1] + (p[1] - n.at[1]) * k];
}

/* Cut `n` mm off the end of a polyline (keeping at least its first point). */
function cutBack(P, n) {
  const out = P.slice(); let left = n;
  while (out.length > 1 && left > 0) {
    const a = out[out.length - 2], b = out[out.length - 1], L = dist(a, b);
    if (L > left) { out[out.length - 1] = [b[0] + (a[0] - b[0]) * left / L, b[1] + (a[1] - b[1]) * left / L]; break; }
    out.pop(); left -= L;
  }
  return out;
}

/*
 * laneRuns — a drawn lane polyline as the runs OUTSIDE every trunk, each end that
 * meets a trunk fanned into its ribbon. `trunkAt(i)` returns the trunk segment i of
 * `pts` lies inside, or null. No segment inside a trunk ⇒ [pts] itself.
 */
function laneRuns(pts, trunkAt, cfg, stroke) {
  const runs = []; let cur = null, prevT = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const t = trunkAt(i);
    if (t) { if (cur) cur.tail = t; cur = null; prevT = t; continue; }
    if (!cur) { cur = { pts: [pts[i]], head: prevT }; runs.push(cur); }
    cur.pts.push(pts[i + 1]); prevT = null;
  }
  if (runs.length === 1 && !runs[0].head && !runs[0].tail) return [pts];
  return runs.map(rn => {
    let P = rn.pts;
    if (rn.tail) { const e = P[P.length - 1]; P = cutBack(P, cfg.fan); P.push(squeeze(e, rn.tail, cfg, stroke)); }
    if (rn.head) { const e = P[0]; P = cutBack(P.slice().reverse(), cfg.fan); P.push(squeeze(e, rn.head, cfg, stroke)); P.reverse(); }
    return P;
  }).filter(P => P.length > 1);
}

/* A trunk's free ends as drawn — `runs` is every ribbon polyline after the coreBox
 * cut — each with the unit vector pointing INTO the trunk. An end lying on another
 * of the trunk's ribbons is a junction inside it, not an end; ends closer than
 * cfg.endMerge pool into one stack at their mean. */
function trunkEnds(runs, cfg) {
  const u = (a, b) => { const L = dist(a, b) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  const raw = [];
  runs.forEach((R, n) => {
    const others = runs.filter((_, m) => m !== n);
    for (const [at, nx] of [[R[0], R[1]], [R[R.length - 1], R[R.length - 2]]])
      if (!others.length || nearest(at, others).d > cfg.width) raw.push({ at, into: u(at, nx) });
  });
  const pools = [];
  for (const e of raw) { const p = pools.find(q => q.some(m => dist(m.at, e.at) < cfg.endMerge)); if (p) p.push(e); else pools.push([e]); }
  return pools.map(p => {
    const at = [p.reduce((s, e) => s + e.at[0], 0) / p.length, p.reduce((s, e) => s + e.at[1], 0) / p.length];
    let ix = p.reduce((s, e) => s + e.into[0], 0), iy = p.reduce((s, e) => s + e.into[1], 0); const L = Math.hypot(ix, iy) || 1;
    return { at, into: [ix / L, iy / L] };
  });
}

/* Where a stack may sit, best first: just BEYOND the end, where the lanes fan out
 * (or come in) — then further out, then to either side. g is stackGrid()'s block. */
function stackCentres(e, g, cfg) {
  const [ux, uy] = e.into, nx = -uy, ny = ux;
  const along = Math.abs(ux) * g.hw + Math.abs(uy) * g.hh, side = Math.abs(nx) * g.hw + Math.abs(ny) * g.hh;
  const out = [];
  for (const d of [0, 3, 6, 10, 15]) out.push([e.at[0] - ux * (along + cfg.fan + 1 + d), e.at[1] - uy * (along + cfg.fan + 1 + d)]);
  for (const s of [1, -1]) for (const d of [-8, -4, 0, 4, 8, 12, 16, 20, 24]) {
    const o = cfg.width / 2 + side + 1;
    out.push([e.at[0] + ux * d + nx * s * o, e.at[1] + uy * d + ny * s * o]);
  }
  // then a ring, for a centre with no room beside the end: the stack stands off on a leader
  for (const R of [12, 18, 24, 30]) for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8; out.push([e.at[0] + Math.cos(a) * (R + Math.max(g.hw, g.hh)), e.at[1] + Math.sin(a) * (R + Math.max(g.hw, g.hh))]);
  }
  return out;
}

/* The leader from a stood-off stack to its trunk end: from the end to the nearest
 * point of the stack's box, or null when the box is within `gap` mm of the end. */
function leader(e, c, g, gap) {
  const qx = Math.max(c[0] - g.hw, Math.min(e.at[0], c[0] + g.hw)), qy = Math.max(c[1] - g.hh, Math.min(e.at[1], c[1] + g.hh));
  return Math.hypot(qx - e.at[0], qy - e.at[1]) > gap ? [e.at, [qx, qy]] : null;
}

/* The candidate with the lowest cost; the first of equals, so the order above is the tie-break. */
function cheapest(cands, cost) {
  let best = cands[0], bc = Infinity;
  for (const q of cands) { const c = cost(q); if (c < bc) { bc = c; best = q; } }
  return best;
}

/* A grid of badges centred on (0,0), its long side along the street: up to maxCols
 * across a street that runs across the page, up to maxCols down one that runs down
 * it, a short last row centred. The centres, and the whole block's half-extents. */
function stackGrid(n, rad, maxCols, xw, into) {
  const across = !into || Math.abs(into[0]) >= Math.abs(into[1]);
  const cols = across ? Math.min(maxCols, n) : Math.ceil(n / Math.min(maxCols, n)), rows = Math.ceil(n / cols);
  const px = 2 * (rad + xw) + 0.5, py = 2 * rad + 0.5, at = [];
  for (let k = 0; k < n; k++) { const row = Math.floor(k / cols), inRow = Math.min(cols, n - row * cols), c = k - row * cols;
    at.push([(c - (inRow - 1) / 2) * px, (row - (rows - 1) / 2) * py]); }
  return { at, hw: ((Math.min(cols, n) - 1) / 2) * px + rad + xw, hh: ((rows - 1) / 2) * py + rad };
}

/*
 * placeStacks — draw each trunk's stacks and record what they name. `k` carries the
 * generator's own closures: the frame and coreBox tests, the badge register, the
 * reserved boxes, the place symbols as boxes and the ink stamp (labeller.js).
 *
 * The cost is the whole placement rule. Off the page or in the coreBox is out; on
 * another badge, then on a place symbol or a reserved box, then on ink, in that
 * order of weight; and every millimetre from the end costs, so a stack stands off
 * only as far as it must. Measured on High Wycombe Town Centre, where every spot
 * within 16 mm of the Castle Street end covered a symbol: the ring finds clear
 * paper 30 mm north, on a leader. A stack that still covers a symbol says so.
 */
function placeStacks(trunks, cfg, k) {
  const rad = cfg.badgeRadius;
  for (const t of trunks) {
    t.drawnEnds = []; const names = unseen(t); if (!t.runs || !t.runs.length || !names.length) continue;
    for (const e of trunkEnds(t.runs, cfg)) {
      const g = stackGrid(names.length, rad, cfg.maxCols, k.badgeXWs(names, rad), e.into);
      const box = q => [q[0] - g.hw, q[1] - g.hh, q[0] + g.hw, q[1] + g.hh];
      const syms = b => k.symbols.filter(o => k.hit(b, o)).length;
      const c = cheapest(stackCentres(e, g, cfg), q => { const b = box(q);
        return (k.inFrame([b[0], b[1]]) && k.inFrame([b[2], b[3]]) && !k.inCore(q) ? 0 : 1e6) + (k.badgeClash(q[0], q[1], g.hw, g.hh, rad) ? 1e3 : 0)
          + (k.overlaps(b) ? 300 : 0) + 300 * syms(b) + 100 * k.ink.cover(b) + 3 * dist(q, e.at); });
      const ld = leader(e, c, g, cfg.fan + 2);
      if (ld) k.out(`<path d="M${ld[0][0].toFixed(2)} ${ld[0][1].toFixed(2)}L${ld[1][0].toFixed(2)} ${ld[1][1].toFixed(2)}" stroke="${cfg.color}" stroke-width="0.5" fill="none"/>`);
      const n = syms(box(c));
      if (n) process.stderr.write(`trunkSegments: ${t.id}'s badge stack at ${c.map(v => v.toFixed(0)).join(',')} covers ${n} place symbol(s): there is no clear spot within 30 mm of that end of the trunk.
`);
      names.forEach((r, j) => k.badge(c[0] + g.at[j][0], c[1] + g.at[j][1], r, rad));
      k.noteBadge(c[0], c[1], g.hw, g.hh, rad);
      k.reserve(c[0] - g.hw - 0.2, c[1] - g.hh - 0.2, c[0] + g.hw + 0.2, c[1] + g.hh + 0.2, 'the ' + t.id + ' trunk badges');
      t.drawnEnds.push({ at: c, names: names.slice() });
    }
  }
}

/* What corridors_report.json records about each trunk. `names` per end is what the
 * badge pass DREW, so S6 checks the artwork and not the intention. */
function trunkReport(trunks, laneOf) {
  return trunks.map(t => ({ id: t.id, lanes: t.lanes, routes: t.routes, exits: t.routes.filter(r => t.exits && t.exits.has(r)),
    routesByLane: Object.fromEntries(t.lanes.map(l => [l, t.routes.filter(r => laneOf(r) === l)])),
    lengthMm: +t.polys.reduce((s, P) => s + polyLen(P), 0).toFixed(1),
    ends: (t.drawnEnds || []).map(e => ({ at: e.at.map(v => +v.toFixed(2)), names: e.names })) }));
}

/* The S6 question, pure so the test and verify_report.js share it: every route in a
 * trunk is either seen leaving it in its own colour or named in BOTH of its stacks, so
 * no lane disappears into the grey without a word. */
function trunkFindings(report) {
  const out = [];
  for (const t of (report || [])) {
    const ends = t.ends || [], exits = t.exits || [], routes = (t.routes || []).filter(r => !exits.includes(r));
    if (!routes.length) continue;
    if (ends.length < 2) out.push({ id: t.id, problem: `drew ${ends.length} badge stack(s), and a trunk needs one where its lanes go in and one where they fan out`, missing: [], lanes: [] });
    ends.forEach((e, k) => {
      const missing = routes.filter(r => !(e.names || []).includes(r));
      if (!missing.length) return;
      const lanes = (t.lanes || []).filter(l => ((t.routesByLane || {})[l] || [l]).some(r => missing.includes(r)));
      out.push({ id: t.id, end: k, problem: `stack ${k + 1} does not name ${missing.join(', ')}`, missing, lanes });
    });
  }
  return out;
}

module.exports = { DEFAULTS, trunkConfig, findTrunks, markExits, squeeze, laneRuns, trunkEnds, stackCentres, leader, cheapest, stackGrid, placeStacks, trunkReport, trunkFindings };
