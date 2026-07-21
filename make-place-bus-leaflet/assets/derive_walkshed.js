// P2 helper — derive routes_intown_atco.json (the DISPLAY subset the internal
// close-up map draws) from routes_full_atco.json, clipped to a WALKSHED around a
// point instead of a town's ATCO locality prefix.
//
// This is the place analogue of the town skill's derive_intown.js. "Core" here is
// "within radiusM metres of the place centre" (not "shares the locality prefix");
// everything else is identical — keep each route's core stops plus a directional
// BUFFER of `buf` stops just beyond the walkshed edge so a route that passes the
// place traces out in the correct direction(s) rather than collapsing to a stub.
//
// Usage: node derive_walkshed.js <routes_full.json> <atco2ll.json> <walkshed_cfg.json> <out routes_intown.json>
//   walkshed_cfg.json = { "center":[lat,lon], "radiusM":500, "buf":1,
//                         "circular":["61EY"], "maxEdgeKm":2.0, "keepRoutes":[], "skipRoutes":[] }
//   maxEdgeKm: drop a buffer (non-core) stop farther than this from the centre, so a
//              through route doesn't draw a long spoke to a distant village on the
//              close-up. Core (in-walkshed) stops are always kept.
//   skipRoutes: routes to omit from the close-up entirely (still valid on the external map).
const fs = require('fs');
const full = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ll = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const cfg = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const OUT = process.argv[5];

const [CLAT, CLON] = cfg.center;
const RAD = cfg.radiusM == null ? 500 : cfg.radiusM;
const BUF = cfg.buf == null ? 1 : cfg.buf;
const CIRC = new Set(cfg.circular || []);
const SKIP = new Set(cfg.skipRoutes || []);
const MAXM = (cfg.maxEdgeKm || 0) * 1000;
const kc = Math.cos(CLAT * Math.PI / 180);
const distM = a => { const p = ll[a]; if (!p) return Infinity;
  return Math.hypot((p[0] - CLAT) * 111320, (p[1] - CLON) * 111320 * kc); };
const isCore = a => distM(a) <= RAD;
const farFromCentre = a => MAXM ? distM(a) > MAXM : false;

function clipDir(stops) {                     // core stops + buf-neighbourhood, in chain order
  const chain = stops.filter(a => ll[a]); const n = chain.length;
  const keep = new Array(n).fill(false);
  for (let i = 0; i < n; i++) if (isCore(chain[i]))
    for (let j = Math.max(0, i - BUF); j <= Math.min(n - 1, i + BUF); j++) keep[j] = true;
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i] && (isCore(chain[i]) || !farFromCentre(chain[i]))) out.push(chain[i]);
  return out;
}

const intown = {};
for (const route in full) {
  if (SKIP.has(route)) continue;
  // Use BOTH directions for a close-up: a route may only call near the place one way
  // (one-way loops), and we want every stop-near-the-place drawn.
  const dirs = full[route].directions || full[route].canonical;
  const seen = new Set(), list = [];
  for (const d of dirs) for (const a of clipDir(d.stops)) if (!seen.has(a)) { seen.add(a); list.push(a); }
  if (CIRC.has(route) && list.length && list[0] !== list[list.length - 1]) list.push(list[0]);
  if (list.length) intown[route] = list;
}
fs.writeFileSync(OUT, JSON.stringify(intown, null, 1));
for (const r in intown) {
  const core = intown[r].filter(isCore).length;
  console.error(r.padEnd(6), 'walkshed', String(intown[r].length).padStart(3),
    '(core', core, '+edge', intown[r].length - core + ')');
}
