#!/usr/bin/env node
/*
 * complexity_score.js — the town-complexity triage gate (end of S2).
 *
 * Answers the question the pipeline never used to ask: "should we be drawing
 * this town at all, on one sheet, the standard way?"
 *
 * High Wycombe (2026-07-28) built cleanly through every existing gate and still
 * produced an unusable internal map: 31 drawn lines against a ~12-hue
 * colour-blind-safe palette, 320 drawn stops, and a 6.2 km trunk corridor where
 * 6-19 services share the same tarmac. Nothing measured that until it was drawn.
 *
 * This script measures it from data S2 already owns, before a single line is
 * styled. It writes complexity.json and prints a verdict plus a remedy ladder
 * with PREDICTED post-remedy scores, so the decision is made on numbers rather
 * than on how the first draft happened to look.
 *
 * Zero dependencies (Node core only). Run it in an S2 run dir:
 *
 *   node "%SK%\complexity_score.js"                 # score the CWD
 *   node "%SK%\complexity_score.js" --dir <S2dir>   # score elsewhere
 *   node "%SK%\complexity_score.js" --json          # machine output only
 *   node "%SK%\complexity_score.js" --no-fail       # never exit non-zero
 *   node "%SK%\complexity_score.js" --core-radius 800   # rung-2 probe radius, m
 *
 * Exit codes:  0 = GREEN or AMBER (build continues)
 *              2 = RED  (stop and choose a strategy; suppress with --no-fail)
 *              1 = could not score (missing inputs)
 *
 * THE FOUR METRICS (see references/complexity-triage.md for the reasoning)
 *   R  drawn lines  - the number of lines the internal map will draw. The
 *                     colour-blind-safe palettes hold ~12 usable hues, so R is
 *                     the dominant term: past ~12 the palette repeats and colour
 *                     stops carrying information.
 *   S  drawn stops  - distinct stops in routes_intown_atco.json (label load).
 *   K5 congested km2- area of ~111 m cells carrying >= 5 distinct routes.
 *   D5 congestion   - diagonal of the LARGEST CONNECTED cluster of those cells.
 *      extent (km)    Distinguishes a knot at the bus station (a fisheye lens
 *                     fixes it) from a trunk corridor (a lens cannot).
 *
 * INPUTS (all written by S2; the first is optional with a fallback)
 *   routes_paths.json       road-matched polylines  {routes:{key:{pts:[[lat,lon]..]}}}
 *                           - absent? falls back to straight stop-to-stop lines
 *                             built from routes_intown_atco.json + atco2ll.json
 *   routes_intown_atco.json the drawn display subset  {key:[ATCO,..]}
 *   atco2ll.json            {ATCO:[lat,lon]}
 *   intown_cfg.json         optional; `anchor` used for the rung-2 core probe
 *   verified-services.json  optional (S1); tripsPerWeek/category drive rung 0
 *   palette.json            optional; reports the real colour-ambiguity ratio
 *   routes.json             optional (S3); honours internalCorridors when it
 *                           exists so a bundled town re-scores correctly
 */

'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- constants
const CELL_DEG = 0.001;              // ~111 m of latitude
const CELL_KM = 0.111;               // cell side, km
const CELL_AREA = CELL_KM * CELL_KM; // km2 per cell
const CONGESTED_AT = 5;              // routes per cell that counts as congested
const BURIED_AT = 4;                 // routes per cell that counts as "buried"
const PALETTE_HUES = 12;             // usable colour-blind-safe hues

// Bands, calibrated on the seven towns built to 2026-07-28 (see the reference).
// "any one metric trips it" - deliberately NOT a blended index, because which
// metric fails determines which remedy to reach for.
const BANDS = {
  amber: { R: 12, S: 120, K5: 0.50, D5: 1.6 },
  red:   { R: 18, S: 200, K5: 0.80, D5: 3.5 }
};

// ---------------------------------------------------------------- utilities
function die(msg) { console.error('complexity_score: ' + msg); process.exit(1); }

function readJson(dir, name, required) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) {
    if (required) die('missing required input ' + name + ' in ' + dir);
    return null;
  }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die('could not parse ' + name + ': ' + e.message); }
}

/*
 * Some inputs are owned by a different stage than the one we run in:
 * verified-services.json is S1's, routes.json is S3's. Rather than force the
 * caller to `pull` them first, walk up to the town's manifest and read that
 * stage's latest run. Returns null when it genuinely isn't there.
 */
function readStageJson(startDir, name, stages) {
  const local = readJson(startDir, name, false);
  if (local) return local;
  let d = startDir;
  for (let i = 0; i < 6; i++) {
    const mf = path.join(d, 'manifest.json');
    if (fs.existsSync(mf)) {
      let man;
      try { man = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { return null; }
      for (const st of stages) {
        const s = man.stages && man.stages[st];
        if (!s || !s.latest) continue;
        const run = (s.runs || []).find(r => r.id === s.latest);
        const rd = run && run.dir ? path.join(d, run.dir) : null;
        if (rd && fs.existsSync(path.join(rd, name))) return readJson(rd, name, false);
      }
      return null;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

function havKm(a, b) {
  const R = 6371.0, rad = Math.PI / 180;
  const la1 = a[0] * rad, la2 = b[0] * rad;
  const dla = (b[0] - a[0]) * rad, dlo = (b[1] - a[1]) * rad;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }

// ---------------------------------------------------------------- the metrics
/*
 * Score a set of polylines. `paths` is {key: {pts:[[lat,lon],..]}}.
 * Everything downstream (the ladder predictions included) goes through here, so
 * a predicted score is computed exactly the same way as the real one.
 */
function scorePaths(paths, stopCount) {
  const keys = Object.keys(paths);
  if (!keys.length) return null;

  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
  for (const k of keys) for (const p of paths[k].pts) {
    if (p[0] < minLa) minLa = p[0];
    if (p[0] > maxLa) maxLa = p[0];
    if (p[1] < minLo) minLo = p[1];
    if (p[1] > maxLo) maxLo = p[1];
  }
  const midLa = (minLa + maxLa) / 2;
  const lonScale = Math.cos(midLa * Math.PI / 180);
  const cellLo = CELL_DEG / lonScale;   // keep cells ~square on the ground

  // bin every sampled point; a cell records the distinct routes touching it
  const cells = new Map();
  let totalKm = 0;
  for (const k of keys) {
    const pts = paths[k].pts;
    for (let i = 0; i < pts.length - 1; i++) totalKm += havKm(pts[i], pts[i + 1]);
    for (const p of pts) {
      const key = Math.floor(p[0] / CELL_DEG) + ',' + Math.floor(p[1] / cellLo);
      let s = cells.get(key);
      if (!s) { s = new Set(); cells.set(key, s); }
      s.add(k);
    }
  }

  // K5 - how much of the map is congested
  const hot = [];
  let maxLoad = 0;
  for (const [key, s] of cells) {
    if (s.size > maxLoad) maxLoad = s.size;
    if (s.size >= CONGESTED_AT) hot.push(key);
  }
  const K5 = hot.length * CELL_AREA;

  // D5 - is the congestion one compact knot, or a long connected trunk?
  let D5 = 0, clusters = 0, biggest = 0;
  if (hot.length) {
    const hotSet = new Set(hot), seen = new Set();
    let best = null;
    for (const c of hot) {
      if (seen.has(c)) continue;
      const stack = [c], comp = [];
      seen.add(c);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        const [cx, cy] = cur.split(',').map(Number);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const n = (cx + dx) + ',' + (cy + dy);
          if (hotSet.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
      clusters++;
      if (!best || comp.length > best.length) best = comp;
    }
    biggest = best.length;
    let bMinLa = 90, bMaxLa = -90, bMinLo = 180, bMaxLo = -180;
    for (const c of best) {
      const [cx, cy] = c.split(',').map(Number);
      const la = cx * CELL_DEG, lo = cy * cellLo;
      if (la < bMinLa) bMinLa = la;
      if (la > bMaxLa) bMaxLa = la;
      if (lo < bMinLo) bMinLo = lo;
      if (lo > bMaxLo) bMaxLo = lo;
    }
    const w = havKm([midLa, bMinLo], [midLa, bMaxLo]);
    const h = havKm([bMinLa, bMinLo], [bMaxLa, bMinLo]);
    D5 = Math.sqrt(w * w + h * h);
  }

  // diagnostics: how much of each route is drawn inside a crowded cell
  const buried = {};
  for (const k of keys) {
    const pts = paths[k].pts;
    let n = 0;
    for (const p of pts) {
      const key = Math.floor(p[0] / CELL_DEG) + ',' + Math.floor(p[1] / cellLo);
      if (cells.get(key).size >= BURIED_AT) n++;
    }
    buried[k] = pts.length ? n / pts.length : 0;
  }
  const bv = Object.values(buried).sort((a, b) => a - b);
  const medBuried = bv.length ? bv[Math.floor(bv.length / 2)] : 0;

  const extentW = havKm([midLa, minLo], [midLa, maxLo]);
  const extentH = havKm([minLa, minLo], [maxLa, minLo]);
  const area = extentW * extentH;

  return {
    R: keys.length,
    S: stopCount === null || stopCount === undefined ? null : stopCount,
    K5: round(K5, 2),
    D5: round(D5, 2),
    maxLoad,
    congestedClusters: clusters,
    largestClusterCells: biggest,
    routeKm: round(totalKm, 1),
    extentKm: [round(extentW, 2), round(extentH, 2)],
    inkDensity: area > 0 ? round(totalKm / area, 2) : null,
    medianBuried: round(medBuried, 3),
    routesOverHalfBuried: bv.filter(x => x >= 0.5).length,
    buried
  };
}

function band(m) {
  const fails = (limits) => {
    const f = [];
    if (m.R > limits.R) f.push('R=' + m.R + ' > ' + limits.R);
    if (m.S !== null && m.S > limits.S) f.push('S=' + m.S + ' > ' + limits.S);
    if (m.K5 > limits.K5) f.push('K5=' + m.K5 + ' > ' + limits.K5);
    if (m.D5 > limits.D5) f.push('D5=' + m.D5 + ' > ' + limits.D5);
    return f;
  };
  const red = fails(BANDS.red);
  if (red.length) return { band: 'RED', failed: red };
  const amber = fails(BANDS.amber);
  if (amber.length) return { band: 'AMBER', failed: amber };
  return { band: 'GREEN', failed: [] };
}

// ---------------------------------------------------------------- the ladder
/*
 * Rung 0 - curate the service set at the FREQUENCY CLIFF.
 * Don't impose a fixed trips-per-week number; most towns hand you a natural
 * break. High Wycombe's services run 1-8 trips/week and then jump straight to
 * 46 with nothing in between, and those 8 are exactly its school/works/
 * match-day/market-day services. Find the largest multiplicative gap in the
 * lower half of the distribution and cut there.
 */
function findFrequencyCliff(paths, services) {
  if (!services) return null;
  const meta = {};
  for (const s of services) meta[s.route] = s;
  const rows = Object.keys(paths)
    .map(r => ({ r, n: (meta[r] && meta[r].tripsPerWeek) || 0 }))
    .filter(x => x.n > 0)
    .sort((a, b) => a.n - b.n);
  if (rows.length < 6) return null;

  let best = null;
  // only consider a cut in the lower half - a cliff at the top is not curation
  for (let i = 0; i < Math.floor(rows.length / 2); i++) {
    const lo = rows[i].n, hi = rows[i + 1].n;
    const ratio = hi / lo;
    if (ratio >= 3 && (!best || ratio > best.ratio)) {
      best = { ratio, below: rows.slice(0, i + 1).map(x => x.r), at: lo, next: hi };
    }
  }
  if (!best || best.below.length < 2) return null;
  return best;
}

/*
 * Rung 1 - bundle co-running route families into one drawn line.
 *
 * Detected from geometry, not from route numbers, so it works for a town whose
 * co-runners aren't numbered alike. Two rules keep it honest:
 *
 *  - MUTUAL overlap. Route a must be mostly drawn on top of b AND b mostly on
 *    top of a. One-directional overlap would bundle a short shuttle into a long
 *    trunk route it merely shares a mile with.
 *  - CLIQUES, not connected components. The first cut used union-find and on
 *    High Wycombe chained 32 -> 102 -> M40 -> ... into one bogus ten-route
 *    "family" purely because consecutive pairs shared the A40. Every member of
 *    a family must co-run with every other member.
 *
 * Even then these are CANDIDATES. Bundling asserts that the routes run together
 * over the drawn extent; if they diverge, the bundled line states something
 * false. Confirm each family before configuring it.
 */
function detectFamilies(paths, overlapMin) {
  const keys = Object.keys(paths);
  if (keys.length < 2) return [];
  let minLa = 90, maxLa = -90;
  for (const k of keys) for (const p of paths[k].pts) {
    if (p[0] < minLa) minLa = p[0];
    if (p[0] > maxLa) maxLa = p[0];
  }
  const lonScale = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180);
  const cellLo = CELL_DEG / lonScale;

  const cs = {};
  for (const k of keys) {
    const s = new Set();
    for (const p of paths[k].pts) s.add(Math.floor(p[0] / CELL_DEG) + ',' + Math.floor(p[1] / cellLo));
    cs[k] = s;
  }
  const overlaps = (a, b) => {
    const A = cs[a], B = cs[b];
    let inter = 0;
    const [small, big] = A.size <= B.size ? [A, B] : [B, A];
    for (const c of small) if (big.has(c)) inter++;
    return (inter / A.size) >= overlapMin && (inter / B.size) >= overlapMin;
  };

  // greedy maximal cliques, largest routes first (a long trunk route is the
  // natural family lead, and gives the badge stack a sensible primary)
  const order = keys.slice().sort((a, b) => cs[b].size - cs[a].size);
  const taken = new Set();
  const families = [];
  for (const seed of order) {
    if (taken.has(seed)) continue;
    const fam = [seed];
    for (const cand of order) {
      if (cand === seed || taken.has(cand)) continue;
      if (fam.every(m => overlaps(m, cand))) fam.push(cand);
    }
    if (fam.length > 1) { fam.forEach(m => taken.add(m)); families.push(fam); }
  }
  return families;
}

function bundlePaths(paths, families, members) {
  const out = {}, outMembers = {}, used = new Set();
  for (const fam of families) {
    const lead = fam[0];
    let pts = [], mem = [];
    for (const m of fam) {
      pts = pts.concat(paths[m].pts);
      mem = mem.concat((members && members[m]) || [m]);
      used.add(m);
    }
    out[lead + '+'] = { pts };
    outMembers[lead + '+'] = mem;
  }
  for (const k of Object.keys(paths)) if (!used.has(k)) {
    out[k] = paths[k];
    outMembers[k] = (members && members[k]) || [k];
  }
  return { paths: out, members: outMembers };
}

function suppressCore(paths, anchor, radiusKm) {
  const out = {};
  for (const k of Object.keys(paths)) {
    const pts = paths[k].pts.filter(p => havKm(p, anchor) > radiusKm);
    if (pts.length >= 5) out[k] = { pts };
  }
  return out;
}

// ---------------------------------------------------------------- main
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const has = name => argv.includes('--' + name);

const dir = path.resolve(opt('dir', process.cwd()));
const jsonOnly = has('json');
const noFail = has('no-fail');
const coreRadiusKm = Number(opt('core-radius', 600)) / 1000;
const overlapMin = Number(opt('overlap', 0.6));

if (!fs.existsSync(dir)) die('no such directory: ' + dir);

const intown = readJson(dir, 'routes_intown_atco.json', false) || readJson(dir, 'routes_atco.json', false);
const atco2ll = readJson(dir, 'atco2ll.json', false);
let pathsFile = readJson(dir, 'routes_paths.json', false);
const cfg = readJson(dir, 'intown_cfg.json', false);
const palette = readJson(dir, 'palette.json', false);
const routesJson = readStageJson(dir, 'routes.json', ['S3']);
let services = null;
const vs = readStageJson(dir, 'verified-services.json', ['S1']);
if (vs && Array.isArray(vs.services)) services = vs.services;

// Build the polylines. Prefer the road-matched paths; fall back to straight
// stop-to-stop lines so a town built before routes_paths.json still scores.
let paths = null, geomSource = null;
if (pathsFile && pathsFile.routes && Object.keys(pathsFile.routes).length) {
  paths = pathsFile.routes;
  geomSource = 'routes_paths.json (road-matched)';
} else if (intown && atco2ll) {
  paths = {};
  for (const r of Object.keys(intown)) {
    const pts = intown[r].map(a => atco2ll[a]).filter(Boolean);
    if (pts.length >= 2) paths[r] = { pts };
  }
  geomSource = 'straight stop-to-stop lines (routes_paths.json absent)';
} else {
  die('need routes_paths.json, or routes_intown_atco.json + atco2ll.json, in ' + dir);
}

// Honour the ladder remedies this town has ALREADY configured, so a town that
// has been through the ladder re-scores as it is drawn rather than being
// penalised for services it no longer draws separately. Each mirrors exactly
// what gen_internal.js does with the same key.
//
// The config KEY is always the lead route (it keys colour and overrides), so put
// it first regardless of how the member list happens to be ordered.
const cfgFamilies = key => {
  if (!routesJson || !routesJson[key]) return [];
  return Object.keys(routesJson[key])
    .map(lead => {
      const v = routesJson[key][lead];
      const members = Array.isArray(v) ? v : (v && v.routes) || [];
      return [lead].concat(members.filter(r => r !== lead));
    })
    .filter(g => g.length > 1 && g.every(r => paths[r]));
};

// rung 1 — internalCorridors: members become ONE drawn line.
const cfgCorr = cfgFamilies('internalCorridors');
if (cfgCorr.length) {
  paths = bundlePaths(paths, cfgCorr, null).paths;
  geomSource += ' + configured internalCorridors';
}

// rung 3 — corridorPalette: members keep separate lines but share ONE colour.
// R exists to police the ~12-hue palette, so for a town that colours by corridor
// the honest R is the number of distinct COLOURS, not of lines. Recorded
// separately below rather than folded into `paths`, because K5/D5 must still be
// measured on every drawn line — the ink does not go away when the colour does.
const cfgPal = cfgFamilies('corridorPalette');
let colourGroups = null;
if (cfgPal.length) {
  const lead = {};
  for (const g of cfgPal) for (const m of g) lead[m] = g[0];
  colourGroups = new Set(Object.keys(paths).map(r => lead[r] || r)).size;
  geomSource += ' + configured corridorPalette';
}

// rung 2 — coreBox: the centre is not drawn at all, so nothing inside it counts
// towards congestion. Same geographic circle the generator projects into a box.
let cfgCore = 0;
if (routesJson && routesJson.coreBox && cfg && cfg.anchor && atco2ll && atco2ll[cfg.anchor]) {
  const cb = routesJson.coreBox === true ? {} : routesJson.coreBox;
  cfgCore = (cb.radius != null ? cb.radius : 600) / 1000;
  paths = suppressCore(paths, atco2ll[cfg.anchor], cfgCore);
  geomSource += ' + configured coreBox';
}

// A configured coreBox does not draw the stops inside it either, so they must
// not count towards the label-load metric.
const anchorLL0 = (cfg && cfg.anchor && atco2ll && atco2ll[cfg.anchor]) ? atco2ll[cfg.anchor] : null;
// rung 2b - a configured stopThinning draws only the stops that earn their
// place. Same rule gen_internal.js applies: served by >= minLines DRAWN LINES
// (a bundled family counts once), plus each line's two end stops.
const cfgThin = (routesJson && routesJson.stopThinning)
  ? (routesJson.stopThinning === true ? {} : routesJson.stopThinning) : null;
const thinKeep = (function () {
  if (!cfgThin || !intown) return null;
  const minLines = cfgThin.minLines != null ? cfgThin.minLines : 2;
  const keep = new Set(cfgThin.keep || []);
  if (cfg && cfg.anchor) keep.add(cfg.anchor);
  const leadOf = {};
  for (const g of cfgCorr) for (const m of g) leadOf[m] = g[0];
  const lanes = {};
  for (const r of Object.keys(intown)) {
    const chain = intown[r] || [];
    if (!chain.length) continue;
    if (cfgThin.termini !== false) { keep.add(chain[0]); keep.add(chain[chain.length - 1]); }
    const lane = leadOf[r] || r;
    for (const a of new Set(chain)) (lanes[a] = lanes[a] || new Set()).add(lane);
  }
  for (const a of Object.keys(lanes)) if (lanes[a].size >= minLines) keep.add(a);
  for (const a of (cfgThin.drop || [])) keep.delete(a);
  return keep;
})();
if (cfgThin) geomSource += ' + configured stopThinning';
const stopCount = intown
  ? new Set([].concat(...Object.values(intown))
      .filter(a => !(cfgCore && anchorLL0 && atco2ll[a] && havKm(atco2ll[a], anchorLL0) <= cfgCore))
      .filter(a => !thinKeep || thinKeep.has(a))).size
  : null;
const metrics = scorePaths(paths, stopCount);
if (!metrics) die('no drawable routes found in ' + dir);
// rung 3 redefines R as distinct colours (see cfgPal above). Do it after
// scorePaths so K5/D5/ink stay measured on every drawn line.
if (colourGroups !== null) { metrics.linesDrawn = metrics.R; metrics.R = colourGroups; }
const verdict = band(metrics);

// colour ambiguity - the sharpest single fact about a big town
let colours = null;
if (palette && palette.palette) {
  const distinct = new Set(Object.values(palette.palette)).size;
  colours = {
    routes: Object.keys(palette.palette).length,
    distinct,
    ambiguity: round(Object.keys(palette.palette).length / distinct, 2)
  };
}

// ---- the remedy ladder, applied cumulatively, each rung re-scored for real
//
// S must be recomputed at every rung, not carried forward: dropping a service
// also drops the stops only it served, and suppressing the core removes every
// stop inside the box. Carrying the original S forward would leave a town
// stuck in RED on label load no matter what the ladder achieved.
let anchorLL = null;
if (cfg && cfg.anchor && atco2ll && atco2ll[cfg.anchor]) anchorLL = atco2ll[cfg.anchor];

function stopsFor(members, coreKm) {
  if (!intown) return null;
  // a coreBox / stopThinning the town has ALREADY configured is in force at
  // every rung, or the ladder's S would contradict the headline S above
  const core = coreKm || cfgCore;
  const s = new Set();
  for (const line of Object.keys(members)) {
    for (const orig of members[line]) {
      for (const a of (intown[orig] || [])) {
        if (core && anchorLL && atco2ll && atco2ll[a] && havKm(atco2ll[a], anchorLL) <= core) continue;
        if (thinKeep && !thinKeep.has(a)) continue;
        s.add(a);
      }
    }
  }
  return s.size;
}

const ladder = [];
let cur = paths;
let curMembers = {};
for (const k of Object.keys(paths)) curMembers[k] = [k];
let curCore = 0;

// `data` carries the rung's proposal in MACHINE-READABLE form alongside the
// prose. curate_services.js consumes it (rung 0 -> skipRoutes, rung 1 ->
// internalCorridors), so no tool has to parse the printed sentence.
function pushRung(rung, action, detail, data) {
  const m = scorePaths(cur, stopsFor(curMembers, curCore));
  const b = band(m);
  ladder.push({
    rung, action, detail,
    data: data || null,
    after: { R: m.R, S: m.S, K5: m.K5, D5: m.D5 },
    band: b.band,
    stillFailing: b.failed
  });
}

const cliff = findFrequencyCliff(cur, services);
if (cliff) {
  const kept = {}, keptMem = {};
  for (const k of Object.keys(cur)) if (!cliff.below.includes(k)) { kept[k] = cur[k]; keptMem[k] = curMembers[k]; }
  if (Object.keys(kept).length) {
    cur = kept; curMembers = keptMem;
    pushRung(0,
      'curate: move ' + cliff.below.length + ' infrequent services to the text list',
      'frequency cliff at ' + cliff.at + ' -> ' + cliff.next + ' trips/week: ' + cliff.below.join(', '),
      { below: cliff.below, cliffAt: cliff.at, cliffNext: cliff.next, ratio: round(cliff.ratio, 2) });
  }
}

// Detected on what is drawn NOW, so an already-bundled town is told what MORE
// could be bundled rather than being re-told about the families it already has.
const fams = detectFamilies(cur, overlapMin);
if (fams.length) {
  const b = bundlePaths(cur, fams, curMembers);
  cur = b.paths; curMembers = b.members;
  pushRung(1,
    'bundle ' + fams.length + ' co-running route famil' + (fams.length === 1 ? 'y' : 'ies') +
      ' into single lines (CANDIDATES - confirm each really co-runs)',
    fams.map(f => f.join('/')).join('  |  '),
    { families: fams, overlapMin,
      internalCorridors: fams.reduce((o, f) => (o[f[0]] = f.slice(1), o), {}) });
}

// Skipped when the town already HAS a coreBox — re-proposing a remedy that is
// already in the config reads as "do it again" and hides what is really left.
if (anchorLL && !cfgCore) {
  const sup = suppressCore(cur, anchorLL, coreRadiusKm);
  if (Object.keys(sup).length) {
    const supMem = {};
    for (const k of Object.keys(sup)) supMem[k] = curMembers[k];
    cur = sup; curMembers = supMem; curCore = coreRadiusKm;
    pushRung(2,
      'suppress the core: draw a "town centre" box of radius ' + Math.round(coreRadiusKm * 1000) + ' m',
      'routes terminate at the box edge instead of crossing the knot');
  }
}

/*
 * Rung 2b - thin the drawn stops.
 * Label load is independent of route count: a town can clear R, K5 and D5 and
 * still be unreadable because 300 stop ticks and their names fight for the same
 * square centimetre. Modelled as "keep the stops that earn their place" -
 * interchanges (served by 2+ drawn lines) plus every line's two end stops.
 */
// Skipped when the town already HAS stopThinning — S is then already measured
// on the thinned set, so re-modelling it would predict a saving twice over.
if (intown && !cfgThin && ladder.length && ladder[ladder.length - 1].after.S !== null &&
    ladder[ladder.length - 1].after.S > BANDS.amber.S) {
  const count = {};
  const enders = new Set();
  for (const line of Object.keys(curMembers)) {
    const seen = new Set();
    for (const orig of curMembers[line]) {
      const chain = intown[orig] || [];
      if (chain.length) { enders.add(chain[0]); enders.add(chain[chain.length - 1]); }
      for (const a of chain) seen.add(a);
    }
    for (const a of seen) count[a] = (count[a] || 0) + 1;
  }
  let kept = 0;
  for (const a of Object.keys(count)) {
    if (curCore && anchorLL && atco2ll && atco2ll[a] && havKm(atco2ll[a], anchorLL) <= curCore) continue;
    if (count[a] >= 2 || enders.has(a)) kept++;
  }
  const m = scorePaths(cur, kept);
  const b = band(m);
  ladder.push({
    rung: '2b',
    action: 'thin drawn stops to interchanges + termini',
    detail: 'keep stops served by 2+ drawn lines, plus each line\'s end stops'
          + ' — routes.json "stopThinning": true',
    data: { stopThinning: true },
    after: { R: m.R, S: m.S, K5: m.K5, D5: m.D5 },
    band: b.band,
    stillFailing: b.failed
  });
}

const finalBand = ladder.length ? ladder[ladder.length - 1].band : verdict.band;
if (finalBand !== 'GREEN' && metrics.R > PALETTE_HUES && !cfgPal.length) {
  ladder.push({
    rung: 3,
    action: 'colour by corridor instead of by route (needs sign-off)',
    detail: 'R is still above the ~' + PALETTE_HUES + '-hue palette; badges carry route identity'
          + ' — routes.json "corridorPalette"',
    data: { corridorPalette: true },
    after: null,
    band: 'predicted GREEN on R'
  });
}

const out = {
  scoredAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  dir,
  geometrySource: geomSource,
  geometryApproximate: /straight stop-to-stop/.test(geomSource),
  metrics: {
    R: metrics.R, S: metrics.S, K5: metrics.K5, D5: metrics.D5,
    // present only when corridorPalette is configured: R is then distinct
    // COLOURS, and this is how many separate lines are actually drawn
    linesDrawn: metrics.linesDrawn !== undefined ? metrics.linesDrawn : undefined,
    maxRoutesPerCell: metrics.maxLoad,
    congestedClusters: metrics.congestedClusters,
    largestClusterCells: metrics.largestClusterCells,
    routeKm: metrics.routeKm,
    extentKm: metrics.extentKm,
    inkDensity: metrics.inkDensity,
    medianBuriedFraction: metrics.medianBuried,
    routesOverHalfBuried: metrics.routesOverHalfBuried
  },
  bands: BANDS,
  // ladder rungs this town has ALREADY configured — the score above is measured
  // with them applied, and the ladder below does not re-propose them
  applied: {
    internalCorridors: cfgCorr.length ? cfgCorr : null,
    corridorPalette: cfgPal.length ? cfgPal : null,
    coreBox: cfgCore ? { radiusM: Math.round(cfgCore * 1000) } : null,
    stopThinning: cfgThin || null
  },
  band: verdict.band,
  failedThresholds: verdict.failed,
  colours,
  congestionShape: metrics.D5 >= 3.0 ? 'trunk corridor (a fisheye lens will not fix this)'
    : metrics.D5 >= 1.0 ? 'linear - one busy street'
    : 'compact knot (a fisheye lens is the right tool)',
  ladder,
  perRouteBuried: metrics.buried
};

fs.writeFileSync(path.join(dir, 'complexity.json'), JSON.stringify(out, null, 2));

// ---------------------------------------------------------------- report
if (jsonOnly) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const m = out.metrics;
  const mark = (v, lim) => v === null ? '   ' : (v > BANDS.red[lim] ? ' !!' : v > BANDS.amber[lim] ? ' ! ' : '   ');
  console.log('');
  console.log('COMPLEXITY TRIAGE  ' + out.band + (out.band === 'GREEN' ? '' : '   <- ' + verdict.failed.join('; ')));
  console.log('  geometry: ' + geomSource);
  {
    const ap = Object.keys(out.applied).filter(k => out.applied[k]);
    if (ap.length) console.log('  already applied: ' + ap.join(', ') + ' (not re-proposed below)');
  }
  if (out.geometryApproximate) {
    console.log('  WARNING: straight stop-to-stop geometry samples far fewer points than');
    console.log('           road-matched paths, so K5 and D5 UNDER-report. The published');
    console.log('           calibration assumes routes_paths.json. Treat a GREEN with');
    console.log('           caution; run pull_roads/match_routes first for a real score.');
  }
  console.log('');
  console.log('  R  ' + (m.linesDrawn !== undefined ? 'colour groups     ' : 'drawn lines       ') +
              String(m.R).padStart(6) + mark(m.R, 'R') + '  green <=' + BANDS.amber.R + '  red >' + BANDS.red.R +
              (m.linesDrawn !== undefined ? '   (corridorPalette: ' + m.linesDrawn + ' lines drawn)' : ''));
  console.log('  S  drawn stops        ' + String(m.S === null ? '-' : m.S).padStart(6) + mark(m.S, 'S') + '  green <=' + BANDS.amber.S + '  red >' + BANDS.red.S);
  console.log('  K5 congested km2      ' + String(m.K5).padStart(6) + mark(m.K5, 'K5') + '  green <=' + BANDS.amber.K5 + '  red >' + BANDS.red.K5);
  console.log('  D5 congestion extent  ' + String(m.D5).padStart(6) + mark(m.D5, 'D5') + '  green <=' + BANDS.amber.D5 + '  red >' + BANDS.red.D5);
  console.log('');
  console.log('  worst cell carries ' + m.maxRoutesPerCell + ' routes; ' + m.congestedClusters +
              ' congested cluster(s), largest ' + m.largestClusterCells + ' cells');
  console.log('  congestion shape: ' + out.congestionShape);
  if (colours) {
    console.log('  palette: ' + colours.distinct + ' distinct colours for ' + colours.routes +
                ' routes (ambiguity ' + colours.ambiguity + 'x' +
                (colours.ambiguity > 1 ? ' - COLOUR NO LONGER IDENTIFIES A ROUTE' : '') + ')');
  }
  if (out.band === 'GREEN') {
    console.log('');
    console.log('  Build normally. No remedies needed.');
  } else {
    console.log('');
    console.log('  REMEDY LADDER (cumulative, each rung re-scored on the real geometry):');
    if (!ladder.length) {
      console.log('    (none auto-detected - see references/complexity-triage.md and choose by hand)');
    }
    for (const l of ladder) {
      const a = l.after
        ? ('R=' + l.after.R + '  S=' + (l.after.S === null ? '-' : l.after.S) +
           '  K5=' + l.after.K5 + '  D5=' + l.after.D5)
        : '(not modelled)';
      console.log('    rung ' + l.rung + '  ' + l.action);
      console.log('             ' + l.detail);
      console.log('             -> ' + a + '   ' + l.band +
        (l.stillFailing && l.stillFailing.length ? '  (' + l.stillFailing.join('; ') + ')' : ''));
    }
    console.log('');
    if (out.band === 'RED') {
      console.log('  RED: do NOT build the standard single sheet. Choose a strategy first.');
      console.log('  If the ladder does not reach GREEN, the honest answers are a route-family');
      console.log('  split (never a geographic one - see the reference) or place-centred leaflets.');
    } else {
      console.log('  AMBER: apply the ladder, note it in the S2 commit, and continue.');
    }
  }
  console.log('');
  console.log('  written: ' + path.join(dir, 'complexity.json'));
  console.log('');
}

if (out.band === 'RED' && !noFail) process.exit(2);
process.exit(0);
