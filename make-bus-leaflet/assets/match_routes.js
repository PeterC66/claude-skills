// S2 asset: map-match each bus route's stop chain onto the OSM road graph
// -> routes_paths.json (road-following polyline per route).
// Part of the internalRoads drawing model. Generic for any town.
//
// Method: build a node graph from roads_geo.json (pull_roads.js), snap each
// route's CANONICAL-direction full-chain stops (within bbox) to the nearest
// graph node, shortest-path (Dijkstra) between consecutive stops, concatenate.
// The displayed (in-town) stops are then PROJECTED onto the matched polyline,
// so one clean line per route carries all its stop ticks (the in-town chains
// merge both travel directions and would zigzag if drawn directly).
//
// Sanity: a leg whose road path exceeds max(2.5 x crow-fly, crow + 0.6 km)
// falls back to a straight chord and is reported. (Generous on purpose:
// winding estate roads legitimately run 2-3.5x crow-fly between close stops —
// St Ives' Constable Road taught us that.) One-way restrictions are
// IGNORED on purpose (schematic map wants the corridor; bus gates/loops would
// otherwise force visual detours); service roads are length-penalised x1.6.
//
// Run from the town's S2 dir:  node match_routes.js
// Needs: roads_geo.json, atco2ll.json, routes_full_atco.json,
//        routes_intown_atco.json (the drawn subset).
// Output: routes_paths.json {
//   routes: { r: { pts:[[lat,lon]..], edges:[key|null per segment],
//                  stopT:{ATCO:{i,t,d}}, fallbacks:[{from,to,why}] } },
//   edgeWay: { "nodeA|nodeB": {way,name,highway} } }
const fs = require('fs');
const DIR = process.env.LEAFLET_DIR || process.cwd();
const SNAP_M = 120, SERVICE_PEN = 1.6, LIVING_PEN = 1.3;

const RG = JSON.parse(fs.readFileSync(DIR + '/roads_geo.json', 'utf8'));
const atco2ll = JSON.parse(fs.readFileSync(DIR + '/atco2ll.json', 'utf8'));
const FULL = JSON.parse(fs.readFileSync(DIR + '/routes_full_atco.json', 'utf8'));
const INTOWN = JSON.parse(fs.readFileSync(DIR + '/routes_intown_atco.json', 'utf8'));
// optional match_cfg.json: { viaPrefixes:{route:[ATCO prefixes]}, viaExclude:{route:[ATCOs]} }
// viaPrefixes restricts a route's via stops to the listed prefixes — use it to
// drop variant-journey detours baked into the canonical chain (e.g. St Ives 9's
// Hilton/Elsworth village loop) so the drawn line follows the MAIN journey.
const MCFG = (function(){ try{ return JSON.parse(fs.readFileSync(DIR + '/match_cfg.json','utf8')); }catch(e){ return {}; } })();
const [BS, BW, BN, BE] = RG.bbox;
const inBbox = ll => ll[0] >= BS && ll[0] <= BN && ll[1] >= BW && ll[1] <= BE;

// ---- graph ----------------------------------------------------------------
const k0 = Math.cos(((BS + BN) / 2) * Math.PI / 180);
const kmLL = (a, b) => Math.hypot((a[0] - b[0]) * 111.32, (a[1] - b[1]) * 111.32 * k0);
const nodeLL = new Map();            // nodeId -> [lat,lon]
const adj = new Map();               // nodeId -> [{to,cost,key}]
const edgeWay = {};                  // "a|b" -> {way,name,highway}
const ekey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
for (const w of RG.ways) {
  const pen = w.tags.highway === 'service' ? SERVICE_PEN
    : w.tags.highway === 'living_street' ? LIVING_PEN : 1;
  for (let i = 0; i < w.nodes.length; i++) nodeLL.set(w.nodes[i], w.geometry[i]);
  for (let i = 0; i < w.nodes.length - 1; i++) {
    const a = w.nodes[i], b = w.nodes[i + 1];
    const d = kmLL(w.geometry[i], w.geometry[i + 1]) * pen;
    if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, cost: d, key: ekey(a, b) });
    adj.get(b).push({ to: a, cost: d, key: ekey(a, b) });
    const k = ekey(a, b);
    if (!edgeWay[k]) edgeWay[k] = { way: w.id, name: w.tags.name || null, highway: w.tags.highway };
  }
}
// spatial grid for snapping
const CELL = 0.004;
const grid = new Map();
for (const [id, ll] of nodeLL) {
  const gk = Math.floor(ll[0] / CELL) + ':' + Math.floor(ll[1] / CELL);
  if (!grid.has(gk)) grid.set(gk, []); grid.get(gk).push(id);
}
function snap(ll) {
  const gi = Math.floor(ll[0] / CELL), gj = Math.floor(ll[1] / CELL);
  let best = null, bd = 1e9;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    for (const id of (grid.get((gi + di) + ':' + (gj + dj)) || [])) {
      const d = kmLL(ll, nodeLL.get(id));
      if (d < bd) { bd = d; best = id; }
    }
  }
  return (best != null && bd * 1000 <= SNAP_M) ? best : null;
}
// binary-heap Dijkstra with early exit
function dijkstra(src, dst) {
  if (src === dst) return [src];
  const dist = new Map(), prev = new Map();
  const heap = [[0, src]]; dist.set(src, 0);
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const down = (i) => { for (;;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } };
  while (heap.length) {
    const [d, u] = heap[0];
    const last = heap.pop(); if (heap.length) { heap[0] = last; down(0); }
    if (u === dst) break;
    if (d > (dist.get(u) ?? 1e18)) continue;
    for (const e of (adj.get(u) || [])) {
      const nd = d + e.cost;
      if (nd < (dist.get(e.to) ?? 1e18)) { dist.set(e.to, nd); prev.set(e.to, u); heap.push([nd, e.to]); up(heap.length - 1); }
    }
  }
  if (!prev.has(dst)) return null;
  const path = [dst]; let u = dst;
  while (u !== src) { u = prev.get(u); path.push(u); }
  return path.reverse();
}

// ---- match each drawn route ------------------------------------------------
const OUT = { routes: {}, edgeWay: {} };
for (const r in INTOWN) {
  const full = FULL[r];
  const can = (full && ((full.canonical && full.canonical[0]) || full.directions[0])) || null;
  if (!can) { console.log(r + ': no full chain, skipped'); continue; }
  let vias = can.stops.filter(a => atco2ll[a] && inBbox(atco2ll[a]));
  const vp = (MCFG.viaPrefixes || {})[r];
  if (vp) vias = vias.filter(a => vp.some(p => a.startsWith(p)));
  const vx = (MCFG.viaExclude || {})[r];
  if (vx) vias = vias.filter(a => !vx.includes(a));
  // circular route (drawn chain closes on itself): close the matched loop too
  const it = INTOWN[r];
  let closedLoop = false;
  if (it.length > 2 && it[0] === it[it.length - 1] && vias.length > 2) {
    closedLoop = true;
    if (vias[0] !== vias[vias.length - 1]) vias = vias.concat([vias[0]]);
  }
  if (vias.length < 2) { console.log(r + ': <2 in-bbox stops, skipped'); continue; }

  const snapped = vias.map(a => ({ a, n: snap(atco2ll[a]) }));
  const pts = [], edges = [], fallbacks = [];
  const push = (ll) => { const p = pts[pts.length - 1]; if (!p || p[0] !== ll[0] || p[1] !== ll[1]) return pts.push(ll); return pts.length; };
  push(snapped[0].n != null ? nodeLL.get(snapped[0].n) : atco2ll[snapped[0].a]);
  for (let i = 0; i < snapped.length - 1; i++) {
    const A = snapped[i], B = snapped[i + 1];
    const crow = kmLL(atco2ll[A.a], atco2ll[B.a]);
    let path = (A.n != null && B.n != null) ? dijkstra(A.n, B.n) : null;
    if (path && path.length >= 2) {
      let plen = 0; for (let j = 0; j < path.length - 1; j++) plen += kmLL(nodeLL.get(path[j]), nodeLL.get(path[j + 1]));
      if (plen > Math.max(2.5 * crow, crow + 0.6)) { fallbacks.push({ from: A.a, to: B.a, why: 'ratio ' + (plen / (crow || 0.001)).toFixed(2) }); path = null; }
    } else if (A.n == null || B.n == null) { fallbacks.push({ from: A.a, to: B.a, why: 'unsnapped' }); path = null; }
    else if (!path) { fallbacks.push({ from: A.a, to: B.a, why: 'no path' }); }
    if (path && path.length >= 2) {
      for (let j = 1; j < path.length; j++) {
        const n = push(nodeLL.get(path[j]));
        // ordered token "from>to" — gen_internal derives the canonical corridor
        // key AND the traversal direction (for consistent lane sides) from it
        edges[n - 2] = path[j - 1] + '>' + path[j];
        const ck = ekey(path[j - 1], path[j]);
        OUT.edgeWay[ck] = edgeWay[ck];
      }
    } else {                                            // chord fallback
      const n = push(B.n != null ? nodeLL.get(B.n) : atco2ll[B.a]);
      if (n >= 2) edges[n - 2] = null;
    }
  }
  // project every DISPLAYED stop onto the polyline (ticks sit on the line)
  const stopT = {};
  for (const a of it) {
    const ll = atco2ll[a]; if (!ll) continue;
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][1] * k0, ay = pts[i][0], bx = pts[i + 1][1] * k0, by = pts[i + 1][0];
      const px = ll[1] * k0, py = ll[0];
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
      const qx = ax + vx * t, qy = ay + vy * t;
      const d = Math.hypot(px - qx, py - qy) * 111.32;     // km
      if (!best || d < best.dk) best = { i, t: +t.toFixed(4), dk: d };
    }
    if (best) stopT[a] = { i: best.i, t: best.t, d: +(best.dk * 1000).toFixed(1) };
  }
  // does the full chain continue beyond the matched portion at either end?
  // (gen_internal draws an off-map continuation arrow at such ends even when
  // the path finishes inside the frame, e.g. a neighbouring village)
  const contStart = !closedLoop && vias[0] !== can.stops[0];
  const contEnd = !closedLoop && vias[vias.length - 1] !== can.stops[can.stops.length - 1];
  OUT.routes[r] = { pts: pts.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]), edges, stopT, fallbacks, contStart, contEnd };
  const km = pts.reduce((s, p, i) => i ? s + kmLL(pts[i - 1], p) : 0, 0);
  console.log(r + ': vias ' + vias.length + ', pts ' + pts.length + ', ' + km.toFixed(2) + ' km, fallbacks ' + fallbacks.length + (fallbacks.length ? ' [' + fallbacks.map(f => f.why).join('; ') + ']' : ''));
}
fs.writeFileSync(DIR + '/routes_paths.json', JSON.stringify(OUT));
console.log('routes_paths.json written: ' + Object.keys(OUT.routes).length + ' routes, ' + Object.keys(OUT.edgeWay).length + ' road edges used');
