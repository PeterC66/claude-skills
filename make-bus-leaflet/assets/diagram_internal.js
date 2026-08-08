// S3/S4 asset: TUBE-MAP DIAGRAM generator for the internal map (2026-07-10).
// The THIRD internal image: a fully topology-driven diagram in the style of the
// hand-drawn St Ives leaflet — each corridor collapsed to one (or few) straight
// octolinear runs, tube-map length normalisation (short legs grow, long legs
// shrink), no road skeleton, curated stops. Unlike schematize_internal.js
// (which preserves the real route SHAPE), this preserves only the TOPOLOGY:
// the sequence of junctions/stops/POIs and which routes share corridors.
//
// OPT-IN + NON-DESTRUCTIVE: requires routes.json "internalDiagram":{...}.
// Absent => exits without writing anything. Same pre-stage architecture as the
// schematizer: emits a workspace ("diagram/") of pseudo lat/lon S2 files, runs
// the shared gen_internal.js there (rotationDeg:0, comp:1), copies the result
// out as internal-diagram.svg.
//
// HAND-TUNING THAT SURVIVES REFRESHES: diagram-layout.json (S3-owned, optional)
//   { "pins": { "<nodeKey>": {"x":mm, "y":mm, "ll":[lat,lon]} } }
// Pins are strong solver springs on junction nodes (page-mm in the PRE-SOLVE
// projection frame = what the diagram editor shows). If a data refresh changes
// a node key, the pin re-resolves to the nearest junction within pinResolveM
// metres of its stored ll (logged); unresolvable pins are reported and skipped.
//
// internalDiagram config (all optional):
//   bendTurn:50      corridor keeps a bend only where its net turn >= this (deg)
//   maxBends:3       max bends per corridor
//   edgeMin:8        min solved leg length, mm
//   edgeMax:55       max solved leg length, mm
//   gamma:0.55       length compression exponent (1 = keep arc lengths)
//   dirW:30 lenW:1.2 anchorW:0.03 pinW:50    solver weights
//   mergeJn:5 mergeEdge:6 dropLoop:12 weldLeg:1.6   graph cleanup (mm)
//   featureTol:2     linear-feature point thinning, mm (river keeps its winding)
//   workDir:"diagram"
//   stops:{ include:[ATCO...], exclude:[ATCO...], junctionDist:3, poiStopDist:8 }
//   interchanges:[{atco,label?,w?}]        station lozenges (render, ID-gated)
//   loopArrows:["300"]                     one-way loop direction arrows (render)
//   roadNames:{ minLeg:16, max:14, exclude:[..], rename:[[re,to]..] }  along-line labels
//   internalRoads:{...}  overrides merged into the WORKSPACE internalRoads
//   features:{ "<key>": {labelPos,labelReserve,...} }  per-feature workspace overrides
const fs = require('fs');
const path = require('path');
const DIR = process.env.LEAFLET_DIR || process.cwd();
const RJ = JSON.parse(fs.readFileSync(DIR + '/routes.json', 'utf8'));
if (!RJ.internalDiagram) { console.log('no internalDiagram config — nothing to do'); process.exit(0); }
if (!RJ.internalRoads) { console.error('internalDiagram needs internalRoads (route-path model) too'); process.exit(1); }
const DG = Object.assign({ bendTurn: 50, maxBends: 3, edgeMin: 8, edgeMax: 55, gamma: 0.55,
  dirW: 30, lenW: 1.2, anchorW: 0.03, pinW: 50,
  mergeJn: 5, mergeEdge: 6, dropLoop: 12, weldLeg: 1.6, featureTol: 2,
  poiSnapDist: 22, featureDamp: 0.35, workDir: 'diagram' },
  RJ.internalDiagram === true ? {} : RJ.internalDiagram);
DG.stops = Object.assign({ junctionDist: 3, poiStopDist: 8, include: [], exclude: [] }, DG.stops || {});

// ---- inputs ----------------------------------------------------------------
const IR = (function () {   // same defaulting as gen_internal
  const u = (RJ.internalRoads === true) ? {} : RJ.internalRoads;
  const o = Object.assign({ stroke: 1.7, gap: 2.8 }, u);
  o.focus = Object.assign({ coreKm: 1.1, comp: 0.5 }, u.focus || {});
  return o;
})();
const atco2ll = JSON.parse(fs.readFileSync(DIR + '/atco2ll.json', 'utf8'));
const routes = (function () {
  for (const f of ['routes_intown_atco.json', 'routes_atco.json']) {
    try { return JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8')); } catch (e) { }
  }
  throw new Error('no routes_intown_atco.json in ' + DIR);
})();
const RG = JSON.parse(fs.readFileSync(DIR + '/roads_geo.json', 'utf8'));
const RP = JSON.parse(fs.readFileSync(DIR + '/routes_paths.json', 'utf8'));
let ICFG = {}; try { ICFG = JSON.parse(fs.readFileSync(DIR + '/intown_cfg.json', 'utf8')); } catch (e) { }
const ANCHOR = RJ.anchor || '0500HSTIV002';
const PREFIX = RJ.atcoPrefix || String(ANCHOR).replace(/\d+$/, '');
const order = RJ.routeOrder || Object.keys(RJ.palette);

// ---- projection: EXACT copy of gen_internal's internalRoads path -----------
// (planar -> config rotation -> fisheye compress -> fit). Rotation + fisheye
// are baked into the diagram coordinates; the workspace runs gen_internal with
// rotationDeg:0 + comp:1 so 45-deg legs stay exactly 45 deg.
const stopPts = [];
{
  const xc = new Set(IR.fitExtra || ICFG.extraCore || []); const fseen = new Set();
  for (const r in routes) for (const a of routes[r]) {
    if (fseen.has(a) || !atco2ll[a]) continue; fseen.add(a);
    if (a.startsWith(PREFIX) || xc.has(a)) stopPts.push(atco2ll[a]);
  }
}
const lat0 = stopPts.reduce((s, p) => s + p[0], 0) / stopPts.length;
const k = Math.cos(lat0 * Math.PI / 180);
const planar = ([lat, lon]) => [lon * k, -lat];
const P = stopPts.map(planar);
const mx = P.reduce((s, p) => s + p[0], 0) / P.length, my = P.reduce((s, p) => s + p[1], 0) / P.length;
let sxx = 0, sxy = 0, syy = 0; for (const [x, y] of P) { const dx = x - mx, dy = y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
let theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
if (IR.rotationDeg != null) theta = -IR.rotationDeg * Math.PI / 180;
const cosT = Math.cos(-theta), sinT = Math.sin(-theta);
const rot = ([x, y]) => { const dx = x - mx, dy = y - my; return [dx * cosT - dy * sinT, dx * sinT + dy * cosT]; };
const tform0 = ll => rot(planar(ll));
const O = (function () {
  const fc = IR.focus.center;
  if (Array.isArray(fc)) return tform0(fc);
  if (fc !== 'centroid' && atco2ll[ANCHOR]) return tform0(atco2ll[ANCHOR]);
  const t = stopPts.map(tform0); return [t.reduce((s, p) => s + p[0], 0) / t.length, t.reduce((s, p) => s + p[1], 0) / t.length];
})();
const R0 = IR.focus.coreKm / 111.32;
const CPF = IR.focus.comp;
const R1 = (IR.focus.midKm != null) ? IR.focus.midKm / 111.32 : null;
const CPF2 = (IR.focus.outerComp != null) ? IR.focus.outerComp : CPF;
function compress([x, y]) {
  if (CPF >= 1 && R1 === null) return [x, y];
  const dx = x - O[0], dy = y - O[1], r = Math.hypot(dx, dy);
  if (r <= R0 || r === 0) return [x, y];
  const nr = (R1 !== null && r > R1) ? R0 + (R1 - R0) * CPF + (r - R1) * CPF2 : R0 + (r - R0) * CPF;
  return [O[0] + dx / r * nr, O[1] + dy / r * nr];
}
const tform = ll => compress(tform0(ll));
const MX0 = 6, MX1 = 196, MY0 = 30, MY1 = 205;
const allT = stopPts.map(tform);
let minX = Math.min(...allT.map(p => p[0])), maxX = Math.max(...allT.map(p => p[0]));
let minY = Math.min(...allT.map(p => p[1])), maxY = Math.max(...allT.map(p => p[1]));
const pad = 0.0006; minX -= pad; maxX += pad; minY -= pad; maxY += pad;
const FM = IR.fitMargin != null ? IR.fitMargin : 4;
const sc = Math.min((MX1 - MX0 - 2 * FM) / (maxX - minX), (MY1 - MY0 - 2 * FM) / (maxY - minY));
const offX = (MX1 - MX0 - (maxX - minX) * sc) / 2, offY = (MY1 - MY0 - (maxY - minY) * sc) / 2;
const XY = ll => { const [x, y] = tform(ll); return [MX0 + offX + (x - minX) * sc, MY0 + offY + (y - minY) * sc]; };
const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc];
const rll = v => +v.toFixed(8);

// ---- route-only graph (NO keyRoads — the diagram draws no road skeleton) ----
const key6 = ll => (+ll[0]).toFixed(6) + ',' + (+ll[1]).toFixed(6);
let N = new Map();                         // key -> {mm:[x,y], ll:[lat,lon], adj:Map(key->edgeId)}
let E = [];                                // edgeId -> {a,b,name}
function node(ll) {
  const kk = key6(ll); let n = N.get(kk);
  if (!n) { n = { mm: XY(ll), ll: [+ll[0], +ll[1]], adj: new Map() }; N.set(kk, n); }
  return kk;
}
function addEdge(ka, kb, name) {
  if (ka === kb) return;
  const na = N.get(ka);
  if (na.adj.has(kb)) return;
  const id = E.length; E.push({ a: ka, b: kb, name: name || null });
  na.adj.set(kb, id); N.get(kb).adj.set(ka, id);
}
// per-segment road names from routes_paths edges ("nodeIdA>nodeIdB") + edgeWay
const wayName = (eid) => {
  if (!eid) return null;
  const [a, b] = eid.split('>');
  const kk = (+a < +b) ? a + '|' + b : b + '|' + a;
  const w = RP.edgeWay && RP.edgeWay[kk];
  return w && w.name || null;
};
for (const r of order) {
  const o = RP.routes[r]; if (!o || !o.pts || o.pts.length < 2) continue;
  let prev = node(o.pts[0]);
  for (let i = 1; i < o.pts.length; i++) {
    const kk = node(o.pts[i]);
    addEdge(prev, kk, wayName(o.edges && o.edges[i - 1]));
    prev = kk;
  }
}
console.log('graph: ' + N.size + ' nodes, ' + E.length + ' edges (routes only)');

// ---- junction-cluster contraction (fixpoint; same as the schematizer) -------
let REP = new Map();
if (DG.mergeJn > 0 || DG.mergeEdge > 0) {
  let totalMerged = 0;
  for (let pass = 0; pass < 6; pass++) {
    const jk = [...N.entries()].filter(([k, n]) => n.adj.size !== 2).map(([k]) => k);
    const uf = new Map(jk.map(k => [k, k]));
    const find = k => { let r = k; while (uf.get(r) !== r) r = uf.get(r); uf.set(k, r); return r; };
    for (let i = 0; i < jk.length; i++) for (let j = i + 1; j < jk.length; j++) {
      const a = N.get(jk[i]).mm, b = N.get(jk[j]).mm;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < DG.mergeJn) {
        const ra = find(jk[i]), rb = find(jk[j]); if (ra !== rb) uf.set(ra, rb);
      }
    }
    if (DG.mergeEdge > 0) for (const e of E) {
      const A = N.get(e.a), B = N.get(e.b);
      if (A.adj.size === 2 || B.adj.size === 2) continue;
      if (Math.hypot(A.mm[0] - B.mm[0], A.mm[1] - B.mm[1]) < DG.mergeEdge) {
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
    const rep = k => localRep.has(k) ? localRep.get(k) : k;
    const N2 = new Map(), E2 = [];
    for (const [k, n] of N) if (rep(k) === k) N2.set(k, { mm: n.mm, ll: n.ll, adj: new Map() });
    for (const e of E) {
      const a = rep(e.a), b = rep(e.b);
      if (a === b || N2.get(a).adj.has(b)) continue;
      const id = E2.length; E2.push({ a, b, name: e.name });
      N2.get(a).adj.set(b, id); N2.get(b).adj.set(a, id);
    }
    N = N2; E = E2;
  }
  const resolve = k => { let r = k; while (REP.has(r)) r = REP.get(r); return r; };
  for (const k of [...REP.keys()]) REP.set(k, resolve(k));
  if (totalMerged) console.log('contracted ' + totalMerged + ' junction node(s); graph now ' + N.size + ' nodes, ' + E.length + ' edges');
}

// ---- corridors (degree-2 chains between junctions) --------------------------
const deg = kk => N.get(kk).adj.size;
const corridors = [];
const eSeen = new Set();
function walk(k0, k1) {
  const chain = [k0, k1];
  eSeen.add(N.get(k0).adj.get(k1));
  let prev = k0, cur = k1;
  while (deg(cur) === 2) {
    const nxt = [...N.get(cur).adj.keys()].find(x => x !== prev);
    if (nxt == null) break;
    const eid = N.get(cur).adj.get(nxt);
    if (eSeen.has(eid)) break;
    eSeen.add(eid); chain.push(nxt); prev = cur; cur = nxt;
  }
  return chain;
}
for (const [kk, n] of N) {
  if (deg(kk) === 2) continue;
  for (const nb of n.adj.keys()) {
    if (eSeen.has(n.adj.get(nb))) continue;
    corridors.push({ chain: walk(kk, nb) });
  }
}
for (let id = 0; id < E.length; id++) {
  if (eSeen.has(id)) continue;
  corridors.push({ chain: walk(E[id].a, E[id].b) });
}
for (const c of corridors) c.mm = c.chain.map(kk => N.get(kk).mm);
// closed loops: drop tiny rings, split big ones at the farthest vertex
const splitCorr = [];
const ORPH = new Map();
for (const c of corridors) {
  if (c.chain[0] === c.chain[c.chain.length - 1] && c.chain.length > 3) {
    let arc = 0;
    for (let i = 0; i < c.mm.length - 1; i++) arc += Math.hypot(c.mm[i + 1][0] - c.mm[i][0], c.mm[i + 1][1] - c.mm[i][1]);
    if (arc < DG.dropLoop) {
      for (let i = 1; i < c.chain.length - 1; i++) ORPH.set(c.chain[i], c.chain[0]);
      continue;
    }
    const p0 = c.mm[0]; let bi = 1, bd = -1;
    for (let i = 1; i < c.mm.length - 1; i++) { const d = Math.hypot(c.mm[i][0] - p0[0], c.mm[i][1] - p0[1]); if (d > bd) { bd = d; bi = i; } }
    splitCorr.push({ chain: c.chain.slice(0, bi + 1), mm: c.mm.slice(0, bi + 1) });
    splitCorr.push({ chain: c.chain.slice(bi), mm: c.mm.slice(bi) });
  } else splitCorr.push(c);
}
let CORS = splitCorr.filter(c => c.chain.length >= 2);
// twin corridors between one junction pair: drop near-coincident duplicates,
// force a bend on genuinely-separated block loops (same as the schematizer)
const DUP = [];
{
  const arcOf = c => { let a = 0; for (let i = 0; i < c.mm.length - 1; i++) a += Math.hypot(c.mm[i + 1][0] - c.mm[i][0], c.mm[i + 1][1] - c.mm[i][1]); return a; };
  const byPair = new Map();
  for (const c of CORS) {
    const a = c.chain[0], b = c.chain[c.chain.length - 1]; const kk = a < b ? a + '~' + b : b + '~' + a;
    (byPair.get(kk) || byPair.set(kk, []).get(kk)).push(c);
  }
  const distToPoly = (p, poly) => {
    let best = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      const ax = poly[i][0], ay = poly[i][1], dx = poly[i + 1][0] - ax, dy = poly[i + 1][1] - ay;
      const L2 = dx * dx + dy * dy; let t = L2 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(p[0] - ax - dx * t, p[1] - ay - dy * t); if (d < best) best = d;
    }
    return best;
  };
  for (const [kk, cs] of byPair) {
    if (cs.length < 2) continue;
    cs.sort((x, y) => arcOf(y) - arcOf(x));
    for (let i = 1; i < cs.length; i++) {
      const c = cs[i], mid = c.mm[Math.floor(c.mm.length / 2)];
      if (distToPoly(mid, cs[0].mm) < 2.5) { c.dupOf = cs[0]; DUP.push(c); }
      else c.forceBend = true;
    }
  }
  CORS = CORS.filter(c => !c.dupOf);
  if (DUP.length) console.log('dropped ' + DUP.length + ' twin corridor(s)');
}
console.log('corridors: ' + CORS.length);

// ---- corridor collapse: ONE chord unless the net turn demands a bend --------
// THE key difference from the schematizer: shape detail is discarded entirely.
// A corridor becomes a single straight leg; a bend survives only where the
// route genuinely turns (net turn at the max-deviation vertex >= bendTurn deg),
// recursively, capped at maxBends. This is what turns wiggly streets into the
// hand-drawn leaflet's long straight runs.
const bearDeg = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
const angdist = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
for (const c of CORS) {
  const anchors = [0, c.mm.length - 1];
  const trySplit = (i0, i1, depth) => {
    if (depth >= DG.maxBends || i1 - i0 < 2) return;
    const a = c.mm[i0], b = c.mm[i1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    let bi = -1, bd = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = L < 1e-9 ? Math.hypot(c.mm[i][0] - a[0], c.mm[i][1] - a[1])
        : Math.abs((c.mm[i][0] - a[0]) * dy - (c.mm[i][1] - a[1]) * dx) / L;
      if (d > bd) { bd = d; bi = i; }
    }
    if (bi < 0) return;
    const turn = angdist(bearDeg(a, c.mm[bi]), bearDeg(c.mm[bi], b));
    if (turn >= DG.bendTurn && bd >= DG.edgeMin / 3) {
      anchors.push(bi);
      trySplit(i0, bi, depth + 1); trySplit(bi, i1, depth + 1);
    }
  };
  trySplit(0, c.mm.length - 1, 0);
  anchors.sort((x, y) => x - y);
  c.anchors = [...new Set(anchors)];
  if (c.forceBend && c.anchors.length === 2) {
    const a = c.mm[0], b = c.mm[c.mm.length - 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    let bi = -1, bd = -1;
    for (let i = 1; i < c.mm.length - 1; i++) {
      const d = Math.abs((c.mm[i][0] - a[0]) * dy - (c.mm[i][1] - a[1]) * dx) / L;
      if (d > bd) { bd = d; bi = i; }
    }
    if (bi > 0) c.anchors = [...new Set([0, bi, c.mm.length - 1])].sort((x, y) => x - y);
  }
  // dominant road name by accumulated length (for along-line labels)
  const nameLen = new Map();
  for (let i = 0; i < c.chain.length - 1; i++) {
    const eid = N.get(c.chain[i]) && N.get(c.chain[i]).adj.get(c.chain[i + 1]);
    const nm = (eid != null && E[eid]) ? E[eid].name : null;
    if (!nm) continue;
    const L = Math.hypot(c.mm[i + 1][0] - c.mm[i][0], c.mm[i + 1][1] - c.mm[i][1]);
    nameLen.set(nm, (nameLen.get(nm) || 0) + L);
  }
  let best = null, bl = 0;
  for (const [nm, L] of nameLen) if (L > bl) { bl = L; best = nm; }
  c.roadName = best;
}

// ---- solver nodes + legs -----------------------------------------------------
const SN = new Map();
const LEGS = [];
function solverNode(c, idx) {
  const kk = c.chain[idx];
  const isJn = (idx === 0 || idx === c.chain.length - 1);
  const id = isJn ? 'J:' + kk : 'B:' + CORS.indexOf(c) + ':' + idx;
  if (!SN.has(id)) SN.set(id, { mm0: c.mm[idx].slice(), ll: N.get(kk) ? N.get(kk).ll : null });
  return id;
}
for (const c of CORS) {
  for (let a = 0; a < c.anchors.length - 1; a++) {
    const i0 = c.anchors[a], i1 = c.anchors[a + 1];
    const u = solverNode(c, i0), v = solverNode(c, i1);
    const pu = c.mm[i0], pv = c.mm[i1];
    const dx = pv[0] - pu[0], dy = pv[1] - pu[1];
    const chord = Math.hypot(dx, dy); if (chord < 1e-6) continue;
    let arc = 0;
    for (let i = i0; i < i1; i++) arc += Math.hypot(c.mm[i + 1][0] - c.mm[i][0], c.mm[i + 1][1] - c.mm[i][1]);
    const bear = Math.atan2(dy, dx) * 180 / Math.PI;
    LEGS.push({ u, v, c, i0, i1, arc, bear, oct: ((Math.round(bear / 45)) % 8 + 8) % 8 });
  }
}
// tube-map length normalisation: median-preserving power compression + clamp.
// gamma < 1 grows short legs and shrinks long ones => even, legible spacing.
{
  const arcs = LEGS.map(l => l.arc).sort((a, b) => a - b);
  const med = arcs.length ? arcs[Math.floor(arcs.length / 2)] : 20;
  for (const lg of LEGS) {
    const t = med * Math.pow(lg.arc / med, DG.gamma);
    lg.len = Math.min(DG.edgeMax, Math.max(DG.edgeMin, t));
  }
  console.log('solver: ' + SN.size + ' nodes, ' + LEGS.length + ' legs (median arc '
    + med.toFixed(1) + 'mm, gamma ' + DG.gamma + ')');
}

// ---- direction-conflict resolution (verbatim from the schematizer) -----------
const incid = new Map();
for (const lg of LEGS) {
  (incid.get(lg.u) || incid.set(lg.u, []).get(lg.u)).push({ leg: lg, atU: true });
  (incid.get(lg.v) || incid.set(lg.v, []).get(lg.v)).push({ leg: lg, atU: false });
}
const outOct = it => it.atU ? it.leg.oct : (it.leg.oct + 4) % 8;
const outBear = it => it.atU ? it.leg.bear : (it.leg.bear + 180) % 360;
let conflictsLeft = 0;
for (let pass = 0; pass < 8; pass++) {
  let changed = false;
  for (const [nid, list] of incid) {
    if (list.length < 2 || list.length > 8) continue;
    const octs = list.map(outOct);
    if (new Set(octs).size === octs.length) continue;
    const L2 = list.slice().sort((a, b) => ((outBear(a) + 360) % 360) - ((outBear(b) + 360) % 360));
    const kk = L2.length;
    let best = null;
    for (let s0 = 0; s0 < 8; s0++) {
      const INF = 1e18;
      const D = Array.from({ length: kk + 1 }, () => new Array(9).fill(INF));
      const CH = Array.from({ length: kk + 1 }, () => new Array(9).fill(-1));
      D[0][0] = 0;
      for (let i = 0; i < kk; i++) for (let s = i; s <= 8 - (kk - i); s++) {
        if (D[i][s] >= INF) continue;
        for (let t = s; t <= 8 - (kk - i - 1) - 1; t++) {
          const oct = (s0 + t) % 8;
          const cst = D[i][s] + L2[i].leg.len * angdist((outBear(L2[i]) + 360) % 360, oct * 45);
          if (cst < D[i + 1][t + 1]) { D[i + 1][t + 1] = cst; CH[i + 1][t + 1] = s; }
        }
      }
      let bs = -1, bc = INF;
      for (let s = kk; s <= 8; s++) if (D[kk][s] < bc) { bc = D[kk][s]; bs = s; }
      if (bs >= 0 && (best === null || bc < best.cost)) {
        const slots = []; let s = bs;
        for (let i = kk; i > 0; i--) { slots.unshift(s - 1); s = CH[i][s]; }
        best = { cost: bc, slots: slots.map(t => (s0 + t) % 8) };
      }
    }
    if (!best) continue;
    L2.forEach((it, i) => {
      const want = best.slots[i];
      const cur = outOct(it);
      if (cur !== want) { it.leg.oct = it.atU ? want : (want + 4) % 8; changed = true; }
    });
  }
  if (!changed) break;
}
for (const [nid, list] of incid) {
  const octs = list.map(outOct);
  if (new Set(octs).size !== octs.length) conflictsLeft++;
}
console.log('direction conflicts remaining: ' + conflictsLeft + ' node(s)');

// ---- pins (diagram-layout.json — the persistent hand-tuning) -----------------
const PINS = [];
{
  let layout = null;
  const lf = process.env.DIAGRAM_LAYOUT || path.join(DIR, 'diagram-layout.json');
  try { layout = JSON.parse(fs.readFileSync(lf, 'utf8')); } catch (e) { }
  if (layout && layout.pins) {
    const geoDist = (a, b) => { // metres, small-angle
      const dy = (a[0] - b[0]) * 111320, dx = (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180);
      return Math.hypot(dx, dy);
    };
    const resolveM = layout.pinResolveM || 60;
    for (const kk in layout.pins) {
      const p = layout.pins[kk];
      let id = SN.has('J:' + kk) ? 'J:' + kk : null;
      if (!id && p.ll) { // key changed after a refresh: nearest junction to stored ll
        let bd = Infinity, bid = null;
        for (const [sid, n] of SN) {
          if (!sid.startsWith('J:') || !n.ll) continue;
          const d = geoDist(p.ll, n.ll);
          if (d < bd) { bd = d; bid = sid; }
        }
        if (bid && bd <= resolveM) { id = bid; console.log('pin ' + kk + ' re-resolved to ' + bid + ' (' + bd.toFixed(0) + ' m)'); }
      }
      if (id) PINS.push({ id, x: p.x, y: p.y });
      else console.log('pin ' + kk + ' NOT resolved — skipped');
    }
    if (PINS.length) console.log('pins: ' + PINS.length + ' applied');
  }
}

// ---- weighted least-squares position solve ------------------------------------
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
{
  const ids = [...SN.keys()]; const idx = new Map(ids.map((d, i) => [d, i]));
  const rows = [];
  for (const lg of LEGS) {
    const ui = idx.get(lg.u) * 2, vi = idx.get(lg.v) * 2;
    const a = lg.oct * 45 * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    rows.push({ cs: [[ui, dy], [ui + 1, -dx], [vi, -dy], [vi + 1, dx]], t: 0, w: DG.dirW });
    rows.push({ cs: [[ui, -dx], [ui + 1, -dy], [vi, dx], [vi + 1, dy]], t: lg.len, w: DG.lenW });
  }
  for (const [id, n] of SN) {
    const i = idx.get(id) * 2;
    rows.push({ cs: [[i, 1]], t: n.mm0[0], w: DG.anchorW });
    rows.push({ cs: [[i + 1, 1]], t: n.mm0[1], w: DG.anchorW });
  }
  // NOTE: pins are NOT applied here — they are in FRAME mm (what the editor
  // shows), and this solve runs pre-refit. They get their own frame-space
  // solve after the refit below, so a pin lands exactly where it was dropped.
  const R = lsq(ids.length * 2, rows);
  for (const [id, n] of SN) { const i = idx.get(id) * 2; n.mm = [R[i], R[i + 1]]; }
}
// weld degenerate short legs (same rationale as the schematizer)
if (DG.weldLeg > 0) {
  let weldedTot = 0;
  for (let pass = 0; pass < 5; pass++) {
    let welded = 0;
    for (const lg of LEGS) {
      const a = SN.get(lg.u).mm, b = SN.get(lg.v).mm;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 1e-9 && L < DG.weldLeg) {
        const mx2 = (a[0] + b[0]) / 2, my2 = (a[1] + b[1]) / 2;
        SN.get(lg.u).mm = [mx2, my2]; SN.get(lg.v).mm = [mx2, my2]; welded++;
      }
    }
    weldedTot += welded; if (!welded) break;
  }
  if (weldedTot) console.log('welded ' + weldedTot + ' degenerate short leg(s)');
}
if (process.env.DBG_NODE) {
  const t = process.env.DBG_NODE;
  for (const [id, n] of SN) {
    if (!id.includes(t)) continue;
    console.error('NODE ' + id + ' solved ' + n.mm.map(v => v.toFixed(1)));
    for (const lg of LEGS) {
      if (lg.u !== id && lg.v !== id) continue;
      const other = lg.u === id ? lg.v : lg.u, om = SN.get(other).mm;
      const bear = (Math.atan2(om[1] - n.mm[1], om[0] - n.mm[0]) * 180 / Math.PI + 360) % 360;
      console.error('  -> ' + other.slice(0, 24) + ' oct=' + lg.oct + ' solvedBear=' + bear.toFixed(0) + ' len=' + lg.len.toFixed(1));
    }
  }
}
let worst = 0;
for (const lg of LEGS) {
  const pu = SN.get(lg.u).mm, pv = SN.get(lg.v).mm;
  const solvedLen = Math.hypot(pv[0] - pu[0], pv[1] - pu[1]);
  const b = Math.atan2(pv[1] - pu[1], pv[0] - pu[0]) * 180 / Math.PI;
  const dev = angdist(b, lg.oct * 45);
  if (dev > 3 && solvedLen > 1.5)
    console.log('  off-octant leg: dev ' + dev.toFixed(1) + ' deg, solved ' + solvedLen.toFixed(1) + ' mm at ' + lg.u + ' -> ' + lg.v);
  worst = Math.max(worst, dev);
}
console.log('solved; worst octant deviation ' + worst.toFixed(3) + ' deg');

// ---- refit the solved layout to the frame -------------------------------------
// Tube-map length targets can grow or shrink the drawing overall; refit
// uniformly so the diagram fills the map area the way the geographic map does.
{
  let nx0 = Infinity, nx1 = -Infinity, ny0 = Infinity, ny1 = -Infinity;
  for (const [, n] of SN) { nx0 = Math.min(nx0, n.mm[0]); nx1 = Math.max(nx1, n.mm[0]); ny0 = Math.min(ny0, n.mm[1]); ny1 = Math.max(ny1, n.mm[1]); }
  const fm = 6;
  const s2 = Math.min((MX1 - MX0 - 2 * fm) / (nx1 - nx0), (MY1 - MY0 - 2 * fm) / (ny1 - ny0));
  const ox = MX0 + (MX1 - MX0 - (nx1 - nx0) * s2) / 2, oy = MY0 + (MY1 - MY0 - (ny1 - ny0) * s2) / 2;
  for (const [, n] of SN) n.mm = [ox + (n.mm[0] - nx0) * s2, oy + (n.mm[1] - ny0) * s2];
  console.log('refit: scale ' + s2.toFixed(3) + ' onto frame');
}

// ---- pinned second solve (FRAME space) -----------------------------------------
// Pins live in frame mm — the coordinates the editor (and the final page) use.
// Re-solve in frame space: same octants, length targets = the refitted solved
// lengths, anchors hold the unpinned parts near the auto layout, pins are
// strong springs at their exact dropped positions. The refit is NOT re-run
// afterwards (WYSIWYG — a pin lands where it was dropped).
if (PINS.length) {
  const ids = [...SN.keys()]; const idx = new Map(ids.map((d, i) => [d, i]));
  const rows = [];
  for (const lg of LEGS) {
    const ui = idx.get(lg.u) * 2, vi = idx.get(lg.v) * 2;
    const pu = SN.get(lg.u).mm, pv = SN.get(lg.v).mm;
    const a = lg.oct * 45 * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    rows.push({ cs: [[ui, dy], [ui + 1, -dx], [vi, -dy], [vi + 1, dx]], t: 0, w: DG.dirW });
    rows.push({ cs: [[ui, -dx], [ui + 1, -dy], [vi, dx], [vi + 1, dy]],
      t: (pv[0] - pu[0]) * dx + (pv[1] - pu[1]) * dy, w: DG.lenW });
  }
  const AW2 = DG.anchorW2 != null ? DG.anchorW2 : 0.08;
  for (const [id, n] of SN) {
    const i = idx.get(id) * 2;
    rows.push({ cs: [[i, 1]], t: n.mm[0], w: AW2 });
    rows.push({ cs: [[i + 1, 1]], t: n.mm[1], w: AW2 });
  }
  for (const p of PINS) {
    const i = idx.get(p.id) * 2;
    rows.push({ cs: [[i, 1]], t: p.x, w: DG.pinW });
    rows.push({ cs: [[i + 1, 1]], t: p.y, w: DG.pinW });
  }
  const R = lsq(ids.length * 2, rows);
  for (const [id, n] of SN) { const i = idx.get(id) * 2; n.mm = [R[i], R[i + 1]]; }
  if (DG.weldLeg > 0) for (let pass = 0; pass < 5; pass++) {
    let welded = 0;
    for (const lg of LEGS) {
      const a = SN.get(lg.u).mm, b = SN.get(lg.v).mm;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 1e-9 && L < DG.weldLeg) {
        const mx2 = (a[0] + b[0]) / 2, my2 = (a[1] + b[1]) / 2;
        SN.get(lg.u).mm = [mx2, my2]; SN.get(lg.v).mm = [mx2, my2]; welded++;
      }
    }
    if (!welded) break;
  }
  console.log('pinned frame-space solve applied (' + PINS.length + ' pin(s))');
}

// ---- map every graph node onto the solved legs --------------------------------
const nodePos = new Map();
for (const c of CORS) {
  for (let a = 0; a < c.anchors.length - 1; a++) {
    const i0 = c.anchors[a], i1 = c.anchors[a + 1];
    const u = solverNode(c, i0), v = solverNode(c, i1);
    const pu = SN.get(u).mm, pv = SN.get(v).mm;
    let arc = 0; const cum = [0];
    for (let i = i0; i < i1; i++) { arc += Math.hypot(c.mm[i + 1][0] - c.mm[i][0], c.mm[i + 1][1] - c.mm[i][1]); cum.push(arc); }
    for (let i = i0; i <= i1; i++) {
      const f = arc > 0 ? cum[i - i0] / arc : 0;
      const p = [pu[0] + (pv[0] - pu[0]) * f, pu[1] + (pv[1] - pu[1]) * f];
      if (!nodePos.has(c.chain[i])) nodePos.set(c.chain[i], p);
    }
  }
}
for (const [kk, r] of REP) if (!nodePos.has(kk) && nodePos.has(r)) nodePos.set(kk, nodePos.get(r));
for (const [kk, e] of ORPH) if (!nodePos.has(kk)) {
  const t = nodePos.get(e) || (REP.has(e) && nodePos.get(REP.get(e)));
  if (t) nodePos.set(kk, t);
}
for (const c of DUP) {
  const keep = c.dupOf;
  const kc = (c.chain[0] === keep.chain[0]) ? keep.chain : keep.chain.slice().reverse();
  const kp = kc.map(kk => nodePos.get(kk)).filter(Boolean);
  if (kp.length < 2) continue;
  const cumK = [0]; for (let i = 0; i < kp.length - 1; i++) cumK.push(cumK[i] + Math.hypot(kp[i + 1][0] - kp[i][0], kp[i + 1][1] - kp[i][1]));
  const totK = cumK[cumK.length - 1] || 1;
  const cumC = [0]; for (let i = 0; i < c.mm.length - 1; i++) cumC.push(cumC[i] + Math.hypot(c.mm[i + 1][0] - c.mm[i][0], c.mm[i + 1][1] - c.mm[i][1]));
  const totC = cumC[cumC.length - 1] || 1;
  for (let i = 1; i < c.chain.length - 1; i++) {
    if (nodePos.has(c.chain[i])) continue;
    const target = cumC[i] / totC * totK;
    let j = 1; while (j < cumK.length - 1 && cumK[j] < target) j++;
    const f = (cumK[j] - cumK[j - 1]) > 0 ? (target - cumK[j - 1]) / (cumK[j] - cumK[j - 1]) : 0;
    nodePos.set(c.chain[i], [kp[j - 1][0] + (kp[j][0] - kp[j - 1][0]) * f, kp[j - 1][1] + (kp[j][1] - kp[j - 1][1]) * f]);
  }
}

// ---- warp field for everything off the network --------------------------------
const samples = [];
for (const [id, n] of SN) samples.push({ o: n.mm0, d: [n.mm[0] - n.mm0[0], n.mm[1] - n.mm0[1]] });
function warp(mm) {
  let sw = 0, sx = 0, sy = 0;
  for (const s of samples) {
    const d2 = (mm[0] - s.o[0]) ** 2 + (mm[1] - s.o[1]) ** 2;
    const w = 1 / (d2 + 9);
    sw += w; sx += w * s.d[0]; sy += w * s.d[1];
  }
  return sw ? [mm[0] + sx / sw, mm[1] + sy / sw] : mm.slice();
}

// ---- network segments with solved endpoints (POI snap + river crossings) ------
// The diagram's displacements are far too large for pure IDW warp (it folded
// the river and stranded POIs in emptied space). Instead: anything close to the
// network keeps its RELATIONSHIP to the nearest route segment (offset rotated
// with the segment); the river is pinned exactly where it crosses route lines.
const NETSEG = [];
for (const c of CORS) {
  for (let i = 0; i < c.chain.length - 1; i++) {
    const a = c.mm[i], b = c.mm[i + 1];
    const A = nodePos.get(c.chain[i]), B = nodePos.get(c.chain[i + 1]);
    if (!A || !B) continue;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) continue;
    NETSEG.push({ a, b, A, B });
  }
}
function poiPlace(mm) {           // nearest-segment snap (falls back to warp)
  let best = null, bd = Infinity;
  for (const s of NETSEG) {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    const L2 = dx * dx + dy * dy; let t = L2 ? ((mm[0] - s.a[0]) * dx + (mm[1] - s.a[1]) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = s.a[0] + dx * t, cy = s.a[1] + dy * t;
    const d = Math.hypot(mm[0] - cx, mm[1] - cy);
    if (d < bd) { bd = d; best = { s, t, cx, cy }; }
  }
  if (!best || bd > DG.poiSnapDist) return warp(mm);
  const { s, t } = best;
  const sl = Math.hypot(s.B[0] - s.A[0], s.B[1] - s.A[1]);
  let dth = 0;
  if (sl > 1e-6) dth = Math.atan2(s.B[1] - s.A[1], s.B[0] - s.A[0]) - Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
  const cd = Math.cos(dth), sd = Math.sin(dth);
  const ox = mm[0] - best.cx, oy = mm[1] - best.cy;
  const q = [s.A[0] + (s.B[0] - s.A[0]) * t, s.A[1] + (s.B[1] - s.A[1]) * t];
  return [q[0] + ox * cd - oy * sd, q[1] + ox * sd + oy * cd];
}
const segInt = (p1, p2, a, b) => {
  const r = [p2[0] - p1[0], p2[1] - p1[1]], s = [b[0] - a[0], b[1] - a[1]];
  const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null;
  const t = ((a[0] - p1[0]) * s[1] - (a[1] - p1[1]) * s[0]) / den;
  const u = ((a[0] - p1[0]) * r[1] - (a[1] - p1[1]) * r[0]) / den;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? { t, u } : null;
};
// crossing-preserving mapping for a linear feature polyline: pin it exactly
// where it crosses the solved network, similarity-transform each span between
// consecutive crossings (keeps the real winding shape locally), warp fallback
// when it never crosses a route.
function mapFeatureSeg(mmSeg) {
  const cum = [0];
  for (let j = 0; j < mmSeg.length - 1; j++) cum.push(cum[j] + Math.hypot(mmSeg[j + 1][0] - mmSeg[j][0], mmSeg[j + 1][1] - mmSeg[j][1]));
  const crossings = [];
  for (let j = 0; j < mmSeg.length - 1; j++) {
    const p1 = mmSeg[j], p2 = mmSeg[j + 1];
    const sl = cum[j + 1] - cum[j]; if (sl < 1e-9) continue;
    for (const s of NETSEG) {
      const hit = segInt(p1, p2, s.a, s.b);
      if (!hit) continue;
      crossings.push({
        arc: cum[j] + hit.t * sl,
        P: [p1[0] + (p2[0] - p1[0]) * hit.t, p1[1] + (p2[1] - p1[1]) * hit.t],
        Q: [s.A[0] + (s.B[0] - s.A[0]) * hit.u, s.A[1] + (s.B[1] - s.A[1]) * hit.u]
      });
    }
  }
  if (!crossings.length) return mmSeg.map(warp);
  crossings.sort((x, y) => x.arc - y.arc);
  const CR = [];      // dedupe crossings from bundled/parallel net segments
  for (const c of crossings) if (!CR.length || c.arc - CR[CR.length - 1].arc > 2) CR.push(c);
  const sim = (P0, P1, Q0, Q1) => {
    const vx = P1[0] - P0[0], vy = P1[1] - P0[1];
    const wx = Q1[0] - Q0[0], wy = Q1[1] - Q0[1];
    const d2 = vx * vx + vy * vy || 1e-12;
    const a = (vx * wx + vy * wy) / d2, b = (vx * wy - vy * wx) / d2;
    return p => [Q0[0] + a * (p[0] - P0[0]) - b * (p[1] - P0[1]),
                 Q0[1] + b * (p[0] - P0[0]) + a * (p[1] - P0[1])];
  };
  const shift = (P0, Q0) => p => [p[0] + Q0[0] - P0[0], p[1] + Q0[1] - P0[1]];
  // damp a vertex's perpendicular excursion from the span chord P0->P1: the
  // similarity alone keeps the river's full winding amplitude, which after the
  // big diagram displacements can swing a long span right across the town —
  // the tube-map river is a CALM band, so squeeze it toward the chord.
  const damp = (P0, P1) => {
    const ux = P1[0] - P0[0], uy = P1[1] - P0[1];
    const L = Math.hypot(ux, uy);
    if (L < 1e-9) return p => p;
    const ex = ux / L, ey = uy / L;
    return p => {
      const rx = p[0] - P0[0], ry = p[1] - P0[1];
      const a = rx * ex + ry * ey, d = -rx * ey + ry * ex;
      return [P0[0] + ex * a - ey * d * DG.featureDamp, P0[1] + ey * a + ex * d * DG.featureDamp];
    };
  };
  const spanF = [];   // vertex mapper per span k = vertices with CR[k-1].arc < arc <= CR[k].arc
  for (let k = 0; k <= CR.length; k++) {
    let P0, P1, T;
    if (k === 0)              { P0 = mmSeg[0]; P1 = CR[0].P; T = CR.length > 1 ? sim(CR[0].P, CR[1].P, CR[0].Q, CR[1].Q) : shift(CR[0].P, CR[0].Q); }
    else if (k === CR.length) { P0 = CR[k - 1].P; P1 = mmSeg[mmSeg.length - 1]; T = CR.length > 1 ? sim(CR[k - 2].P, CR[k - 1].P, CR[k - 2].Q, CR[k - 1].Q) : shift(CR[0].P, CR[0].Q); }
    else                      { P0 = CR[k - 1].P; P1 = CR[k].P; T = sim(P0, P1, CR[k - 1].Q, CR[k].Q); }
    const D = damp(P0, P1);
    spanF.push(p => T(D(p)));
  }
  const outPts = [];
  let k = 0;
  for (let j = 0; j < mmSeg.length; j++) {
    while (k < CR.length && cum[j] > CR[k].arc) { outPts.push(CR[k].Q.slice()); k++; }
    outPts.push(spanF[k](mmSeg[j]));
  }
  while (k < CR.length) { outPts.push(CR[k].Q.slice()); k++; }
  return outPts;
}

// ---- curated stop set ----------------------------------------------------------
// Termini (each route's chain ends), junction stops (solved position within
// stops.junctionDist of a junction node), config include; config exclude wins.
// POI-proximity keeps happen at RENDER time (gen_internal knows the drawn POIs)
// via internalDiagram.stops.poiStopDist.
const keepStops = new Set(DG.stops.include);
{
  const jns = [...SN.entries()].filter(([id]) => id.startsWith('J:')).map(([, n]) => n.mm);
  const schemPts = {};
  for (const r of order) {
    const o = RP.routes[r]; if (!o) continue;
    schemPts[r] = o.pts.map(p => nodePos.get(key6(p)) || warp(XY(p)));
  }
  for (const r of order) {
    const o = RP.routes[r]; if (!o) continue;
    const chain = routes[r] || [];
    if (chain.length) { keepStops.add(chain[0]); keepStops.add(chain[chain.length - 1]); }
    for (const a in o.stopT) {
      const st = o.stopT[a], pp = schemPts[r];
      if (st.i >= pp.length - 1) continue;
      const p = [pp[st.i][0] + (pp[st.i + 1][0] - pp[st.i][0]) * st.t,
                 pp[st.i][1] + (pp[st.i + 1][1] - pp[st.i][1]) * st.t];
      for (const j of jns) if (Math.hypot(p[0] - j[0], p[1] - j[1]) <= DG.stops.junctionDist) { keepStops.add(a); break; }
    }
  }
  for (const a of DG.stops.exclude || []) keepStops.delete(a);
  console.log('curated stops: ' + keepStops.size + ' kept (+POI-proximity at render)');
}

// ---- write the workspace --------------------------------------------------------
const WD = path.join(DIR, DG.workDir);
fs.mkdirSync(WD, { recursive: true });
const wjson = (f, o) => fs.writeFileSync(path.join(WD, f), JSON.stringify(o));

{
  const out = { routes: {}, edgeWay: RP.edgeWay };
  for (const r in RP.routes) {
    const o = RP.routes[r];
    const pts = o.pts.map(p => {
      const q = nodePos.get(key6(p)) || warp(XY(p));
      return INV(q).map(rll);
    });
    out.routes[r] = { pts, edges: o.edges, stopT: o.stopT, fallbacks: o.fallbacks, contStart: o.contStart, contEnd: o.contEnd };
  }
  wjson('routes_paths.json', out);
}
{
  const out = {};
  const done = new Set();
  const schemPts = {};
  for (const r of order) {
    const o = RP.routes[r]; if (!o) continue;
    schemPts[r] = o.pts.map(p => nodePos.get(key6(p)) || warp(XY(p)));
  }
  for (const r of order) {
    const o = RP.routes[r]; if (!o) continue;
    for (const a in o.stopT) {
      if (done.has(a)) continue; done.add(a);
      const st = o.stopT[a], pp = schemPts[r];
      if (st.i < pp.length - 1) {
        const p = [pp[st.i][0] + (pp[st.i + 1][0] - pp[st.i][0]) * st.t,
                   pp[st.i][1] + (pp[st.i + 1][1] - pp[st.i][1]) * st.t];
        out[a] = INV(p).map(rll);
      }
    }
  }
  for (const a in atco2ll) if (!out[a]) out[a] = INV(warp(XY(atco2ll[a]))).map(rll);
  wjson('atco2ll.json', out);
}
{
  const out = { bbox: RG.bbox, ways: RG.ways.map(w => ({
    id: w.id, nodes: w.nodes, tags: w.tags,
    geometry: w.geometry.map(g => { const q = nodePos.get(key6(g)) || warp(XY(g)); return INV(q).map(rll); })
  })) };
  wjson('roads_geo.json', out);
}
{
  let fgeo = {}; try { fgeo = JSON.parse(fs.readFileSync(DIR + '/features_geo.json', 'utf8')); } catch (e) { }
  const out = {};
  for (const kf in fgeo) {
    out[kf] = fgeo[kf].map(seg => {
      const mm = seg.map(p => XY(p));
      const mapped = mm.length < 2 ? mm.map(warp) : mapFeatureSeg(mm);
      if (mapped.length < 3) return mapped.map(p => INV(p).map(rll));
      const keep = [0]; dpTol(mapped, 0, mapped.length - 1, DG.featureTol, keep); keep.push(mapped.length - 1);
      return [...new Set(keep)].sort((a, b) => a - b).map(i => INV(mapped[i]).map(rll));
    });
  }
  wjson('features_geo.json', out);
}
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
for (const f of ['osm.json', 'osm2.json']) {
  const o = JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8'));
  for (const e of o.elements) {
    if (e.lat != null) { const q = INV(poiPlace(XY([e.lat, e.lon]))); e.lat = rll(q[0]); e.lon = rll(q[1]); }
    if (e.center) { const q = INV(poiPlace(XY([e.center.lat, e.center.lon]))); e.center.lat = rll(q[0]); e.center.lon = rll(q[1]); }
  }
  wjson(f, o);
}
for (const f of ['atco2name.json', 'routes_intown_atco.json', 'intown_cfg.json', 'river_geo.json']) {
  try { fs.copyFileSync(path.join(DIR, f), path.join(WD, f)); } catch (e) { }
}
// diagram-overrides.json (S3-owned, optional) -> the WORKSPACE overrides.json:
// Tier-1 hand layout for the DIAGRAM only (POI nudges, label moves, hides) in
// diagram page-mm — kept separate from the geographic map's overrides.json,
// whose coordinates would be meaningless here. Same schema, same editor.
try { fs.copyFileSync(path.join(DIR, 'diagram-overrides.json'), path.join(WD, 'overrides.json')); console.log('diagram-overrides.json applied'); } catch (e) { }
// (Road names along the lines come from gen_internal's existing road-label
// pass — its SKEL geometry is the solved route geometry here, so the labels
// land along the straightened runs with no extra code.)
// workspace routes.json: rotation + fisheye baked in => neutralise; no road
// skeleton (tube-map: coloured lines on white); pass the render-side diagram
// config (curated stops, lozenges, loop arrows, road names) through.
{
  const rj = JSON.parse(JSON.stringify(RJ));
  rj.internalRoads = Object.assign({}, RJ.internalRoads,
    { rotationDeg: 0, focus: { coreKm: 1.1, comp: 1 }, contextRoads: false,
      skeleton: '#ffffff', gap: 2.4 },
    DG.internalRoads || {});
  rj.internalRoads.corridor = Object.assign({ dist: 0.6, angle: 12 },
    (DG.internalRoads || {}).corridor || {});
  const naCfg = (DG.internalRoads && DG.internalRoads.northArrow) || RJ.internalRoads.northArrow;
  if (naCfg) {
    const base = naCfg === true ? {} : naCfg;
    rj.internalRoads.northArrow = Object.assign({}, base,
      { angle: Math.atan2(-Math.cos(-theta), Math.sin(-theta)) * 180 / Math.PI });
  }
  if (DG.features && rj.features)
    rj.features = rj.features.map(f => DG.features[f.key] ? Object.assign({}, f, DG.features[f.key]) : f);
  if (DG.mapNotes) rj.mapNotes = (rj.mapNotes || []).concat(DG.mapNotes);
  // render config under its own WORKSPACE-ONLY key (see gen_internal.js: the
  // town's `internalDiagram` key must stay inert in the other two builds)
  rj.internalDiagramRender = {
    keepStops: [...keepStops],
    poiStopDist: DG.stops.poiStopDist,
    interchanges: DG.interchanges || [],
    loopArrows: DG.loopArrows || [],
    loopArrowEvery: DG.loopArrowEvery
  };
  wjson('routes.json', rj);
}

// ---- solved junction nodes (consumed by the diagram pin editor) ---------------
// x/y are page-mm in THIS (pre-solve) frame — the frame a pin is stored in. They
// are NOT where the junction lands on the finished sheet: gen_internal re-projects
// the workspace below and applies its own fit, so the two frames differ by a
// scale and an offset. `wll` is the workspace lat/lon this junction was written
// out as (exactly as the stops in atco2ll.json are), which is what lets the pin
// editor line its handles up with the sheet — see src/expert/index.js.
{
  const out = {};
  for (const [id, n] of SN) {
    if (!id.startsWith('J:')) continue;
    out[id.slice(2)] = {
      x: +n.mm[0].toFixed(2), y: +n.mm[1].toFixed(2), ll: n.ll,
      wll: INV(n.mm).map(rll),
    };
  }
  wjson('solved-nodes.json', out);
}

// ---- debug skeleton SVG ---------------------------------------------------------
{
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 297 210">`;
  s += `<rect width="297" height="210" fill="#fff"/>`;
  s += `<rect x="${MX0}" y="${MY0}" width="${MX1 - MX0}" height="${MY1 - MY0}" fill="none" stroke="#ddd" stroke-width="0.3"/>`;
  for (const c of CORS)
    s += `<path d="${c.mm.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('')}" fill="none" stroke="#eee" stroke-width="0.8"/>`;
  for (const lg of LEGS) {
    const pu = SN.get(lg.u).mm, pv = SN.get(lg.v).mm;
    s += `<path d="M${pu[0].toFixed(2)} ${pu[1].toFixed(2)}L${pv[0].toFixed(2)} ${pv[1].toFixed(2)}" fill="none" stroke="#333" stroke-width="0.9" stroke-linecap="round"/>`;
  }
  for (const [id, n] of SN) if (id.startsWith('J:'))
    s += `<circle cx="${n.mm[0].toFixed(2)}" cy="${n.mm[1].toFixed(2)}" r="1.1" fill="#c00"/>`;
  s += `</svg>`;
  fs.writeFileSync(path.join(WD, 'debug-skeleton.svg'), s);
}
console.log('workspace written: ' + WD);

// ---- run the shared internal generator on the workspace ---------------------------
// PLACE maps (DIR carries gen_internal_place.js) need the same version-stamp +
// title fixes that wrapper applies for the ordinary geographic output — see the
// matching comment in schematize_internal.js for why we reproduce its logic here
// rather than running it (it resolves gen_internal.js/internal.svg relative to
// DIR/cwd, which don't hold once the workspace subfolder is in play).
if (process.env.DIAGRAM_ONLY !== '1') {
  const { spawnSync } = require('child_process');
  const cand = [path.join(DIR, 'gen_internal.js'),
    process.env.SKILL_ASSETS && path.join(process.env.SKILL_ASSETS, 'gen_internal.js'),
    path.join(__dirname, 'gen_internal.js')].filter(Boolean);
  const gen = cand.find(f => { try { return fs.existsSync(f); } catch (e) { return false; } });
  if (!gen) { console.error('gen_internal.js not found'); process.exit(1); }
  const isPlace = fs.existsSync(path.join(DIR, 'gen_internal_place.js'));
  const env = { ...process.env };
  if (isPlace && env.LEAFLET_VERSION == null) env.LEAFLET_VERSION = String(RJ.version || '').replace(/^v/i, '');
  const res = spawnSync(process.execPath, [gen], { cwd: WD, env, stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status || 1);
  const OUT = path.join(DIR, 'internal-diagram.svg');
  fs.copyFileSync(path.join(WD, 'internal.svg'), OUT);
  if (isPlace) {
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const emitted = 'Buses within ' + esc(RJ.town);
    const title = RJ.internalTitle || RJ.placeTitle || ('Buses serving ' + (RJ.placeShort || RJ.place || RJ.town));
    let svg = fs.readFileSync(OUT, 'utf8');
    if (svg.includes('>' + emitted + '<')) {
      svg = svg.replace('>' + emitted + '<', '>' + esc(title) + '<');
      fs.writeFileSync(OUT, svg);
      console.log('internal-diagram.svg title -> ' + JSON.stringify(title));
    } else {
      console.log('internal-diagram.svg written (title token not matched; RJ.town=' + JSON.stringify(RJ.town) + ').');
    }
  } else {
    console.log('internal-diagram.svg written (render with render.js for the print JPG)');
  }
}
