// S3/S4 asset: OCTOLINEAR SCHEMATIZER for the internal map (item 6, 2026-07-04).
// Produces the tube-map-style second deliverable: every road corridor reduced to
// a few straight legs snapped to 0/45/90/135 deg, junctions re-solved so legs
// still meet cleanly, stops/POIs/river carried through coherently.
//
// OPT-IN + NON-DESTRUCTIVE: requires routes.json "internalSchematic":{...}.
// When the key is absent this script exits without writing anything, and the
// normal pipeline never invokes it — the geographic internal/external outputs
// are untouched (no shared code is modified).
//
// ARCHITECTURE — a GEOMETRY PRE-STAGE, not a second renderer: this script
// schematizes the S2 geometry and re-emits the SAME file formats
// (routes_paths.json, roads_geo.json, atco2ll.json, features_geo.json,
// osm*.json) into a workspace subfolder, with coordinates replaced by
// "pseudo lat/lon" that project octolinearly. The EXISTING gen_internal.js
// then runs UNCHANGED in that workspace (rotationDeg:0, fisheye comp:1 —
// rotation + fisheye are baked in here so straight legs stay straight), so
// badges, labels, corridor bundling, termini clusters, the Services panel and
// POI icons are all reused verbatim. Only geometry generation is new.
//
// Method:
//  1. Project everything to page-mm with the exact projection gen_internal
//     uses (planar -> config rotation -> fisheye -> fit).
//  2. Rebuild the shared road graph from routes_paths.json points (OSM node
//     coords = stable identities across routes) + keyRoads ways.
//  3. Collapse degree-2 chains into corridors between junctions; simplify
//     each corridor to straight legs (Douglas-Peucker, `tol` mm).
//  4. Snap each leg's bearing to the nearest of 8 directions; resolve
//     same-direction conflicts at each junction by re-assigning distinct
//     octants in cyclic bearing order (weighted by leg length).
//  5. Solve all junction/bend positions by weighted least squares:
//     hard-ish perpendicular ("stay on your octant line") constraints,
//     soft leg-length preservation, soft anchor-to-geography springs.
//  6. Map every graph node onto the solved legs by arc-length fraction —
//     so each route's pts array keeps ITS EXACT SHAPE (same indices) and
//     the existing stopT {i,t} projections stay valid with no re-projection.
//  7. Everything off the network (POIs, unused roads, leftover stops) maps
//     through an inverse-distance-weighted warp field built from the solved
//     node displacements; linear features (river) are independently
//     simplified + 45deg-snapped, then fitted back over their warped course.
//
// Run from the town's data folder (or LEAFLET_DIR): node schematize_internal.js
// Needs: routes.json (with internalRoads + internalSchematic), roads_geo.json,
//        routes_paths.json, atco2ll.json, atco2name.json,
//        routes_intown_atco.json, features_geo.json, river_geo.json,
//        osm.json, osm2.json, intown_cfg.json.
// Writes: <dir>/<workDir>/ (default "schematic/") — a complete gen_internal
//         workspace + debug-skeleton.svg (bare solved corridors, for eyeballing
//         the layout without badges/labels) — then RUNS gen_internal.js in the
//         workspace (the run dir's copy if present, else the skill asset) and
//         copies the result out as <dir>/internal-schematic.svg. Set
//         SCHEMATIZE_ONLY=1 to skip that render step (dev/debugging).
// Render to print JPG afterwards as usual:
//   node <assets>/render.js internal-schematic.svg internal-schematic.jpg
//
// internalSchematic config (all optional):
//   tol:3.5          corridor simplification tolerance, mm (higher = fewer bends)
//   minLeg:4         minimum solved leg length, mm (stops short stubs vanishing)
//   dirW:30          weight of the octolinear direction constraint
//   lenW:1           weight of leg-length preservation
//   anchorW:0.04     weight of the stay-near-geography spring
//   featureTol:6     simplification tolerance for linear features (river), mm
//   clipMargin:15    keyRoad-only geometry kept within frame+margin, mm
//   contextRoads:false  faint side-street layer in the schematic (default off:
//                       the tube-map style shows bus corridors only)
//   workDir:"schematic" workspace subfolder name
//   internalRoads:{...} overrides merged into the WORKSPACE internalRoads
//                       (e.g. a different gap/stroke for the schematic look)
const fs = require('fs');
const path = require('path');
const _EP = (() => { const local = path.join(__dirname, 'engine_paths.js');
  try { if (fs.existsSync(local)) return local; } catch (e) {}
  if (process.env.SKILL_ASSETS) return path.join(process.env.SKILL_ASSETS, 'engine_paths.js');
  const across = path.join(__dirname, '..', '..', 'make-bus-leaflet', 'assets', 'engine_paths.js');
  try { if (fs.existsSync(across)) return across; } catch (e) {}
  return 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/engine_paths.js'; })();
const { engineDep, spawnTarget } = require(_EP);
const _dep = engineDep(__dirname);
// The projection, the internalRoads reading and esc are the ENGINE's, not copies
// (OA-230, 2026-09-02); resolved the way every entry point resolves a sibling.
const { projection } = require(_dep('projection.js'));
const { internalRoadsConfig } = require(_dep('internal_roads_config.js'));
// page.js — the sheet's own size, and how an SVG for it opens. The debug skeleton
// below typed the root element out in full, which is the twelfth copy page.js was
// written to end (engine N28); svgOpen() returns that string character for
// character.
const { svgOpen } = require(_dep('page.js'));
const { esc } = require(_dep('svg_primitives.js'));
// The road graph both internal pre-stages build (OA-232 Tier 3.3) — this file
// and diagram_internal.js are one algorithm written twice. This one keeps
// neither the lat/lon on a node nor the name on an edge, which is what the two
// `false`s below say, and it calls its Douglas-Peucker `dp`, which is the whole
// of the third difference.
//
// `roadGraph`, not `RG`: this file already has an `RG` — the parsed
// roads_geo.json — declared INSIDE main(), where every one of these calls also
// lives. The short alias was tried first and every call silently reached the
// road data instead; `node --check` is quiet about it, because shadowing is
// legal, and only the byte gate said so.
const roadGraph = require(_dep('road_graph.js'));
const { key6, angdist, lsq, dpTol: dp } = roadGraph;

// ---- main() ---------------------------------------------------------------
// OA-224 Tier 4.1: the body below runs only when this file is RUN, never when it
// is required, so a test can ask whether it LOADS without asking it to draw a
// map. Nothing inside is re-indented -- the diff has to read as "a scope was
// added". Why it was worth a hash move, and the fault that proves it:
// make-bus-leaflet/test/generator_load.test.js.
function main() {
const DIR = process.env.LEAFLET_DIR || process.cwd();
const RJ = JSON.parse(fs.readFileSync(DIR + '/routes.json', 'utf8'));
if (!RJ.internalSchematic) { console.log('no internalSchematic config — nothing to do'); process.exit(0); }
const SCH = Object.assign({ tol: 5, minLeg: 5, dirW: 30, lenW: 1, anchorW: 0.08,
  featureTol: 2, clipMargin: 15, mergeJn: 2.2, mergeEdge: 3.5, dropLoop: 8, weldLeg: 1.6,
  contextRoads: false, workDir: 'schematic' },
  RJ.internalSchematic === true ? {} : RJ.internalSchematic);

// ---- inputs ----------------------------------------------------------------
// internalRoads, defaulted by the SAME function gen_internal.js uses (OA-230). The
// copy here defaulted three keys where the generator defaults nine, and refused an
// ABSENT key that the generator has treated as "on" since 2026-08-04. `false` is
// the classic model and still refuses: there is no road graph to schematize.
const IR = internalRoadsConfig(RJ);
if (!IR) { console.error('internalSchematic needs the roads model (road-skeleton); internalRoads:false is the classic model and has none'); process.exit(1); }
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

// ---- projection: the engine's own, projection.js (OA-230) -----------------
// (planar -> config rotation -> fisheye compress -> fit to frame). We bake the
// rotation AND the fisheye into the schematized coordinates; the workspace
// then runs gen_internal with rotationDeg:0 + comp:1 so its own projection is
// a pure uniform fit and 45-deg legs stay exactly 45 deg.
const stopPts = [];
{
  const xc = new Set(IR.fitExtra || ICFG.extraCore || []); const fseen = new Set();
  for (const r in routes) for (const a of routes[r]) {
    if (fseen.has(a) || !atco2ll[a]) continue; fseen.add(a);
    if (a.startsWith(PREFIX) || xc.has(a)) stopPts.push(atco2ll[a]);
  }
}
// THE FRAME THE SOLVER LAYS OUT IN, AND IT IS A DECIDED RULE (OA-230, closed
// 2026-09-02 by Peter on the measurement; reworded 2026-09-02, OA-224 Tier 4.1).
//
// Until 2026-09-02 the forty lines here were a copy of gen_internal.js's
// projection, commented "EXACT copy", and the copy had drifted from projection.js
// in four ways: a flat 205 mm frame bottom where every geographic sheet has run
// the footer-safe frame since 2026-08-15, no design.fixedOrientation, no
// overrides.json rotation and no detail lenses (engine F5, codebase review
// 2026-09-01). This call hands the real module exactly what the copy computed, so
// the extraction moved no byte on any of the 13 schematic and diagram sheets.
//
// THE ADOPTION WAS BUILT AND REJECTED, so this is not a deferral. The three sheets
// it would move (High Wycombe's schematic and diagram, Ramsey's schematic) were
// built in scratch against the town's real footer-safe frame -- plate top 188.10
// mm, a 12.8% scale change on a height-bound fit -- each beside a control that
// reproduced the committed sheet byte-for-byte. THE READER SEES THE SAME LAYOUT
// EITHER WAY: the workspace gen_internal.js refits these pseudo-coordinates into
// its own frame regardless, so the frame here changes only the SCALE at which the
// solver's millimetre thresholds and the label placer's decisions are taken. That
// showed up as a label reshuffle on the two High Wycombe sheets (6 lost / 5
// gained; 2 lost / 1 gained) and nothing at all on Ramsey. Not worth three version
// bumps, three re-renders, three S6 runs and a portal hand-off.
//
// So LEGACY_FRAME is what the pre-stage MEANS, not what it is stuck with: hand the
// solver a stable frame of its own and let the workspace do the fitting. Passing
// the town's fixedOrientation and overrides rotation through would be inert today
// -- no schematic town sets either -- and that is the reason NOT to do it: an
// inert pass-through is a silent behaviour change waiting for the first town that
// does set one. pre_stages.test.js asserts these values, so the rule has an
// instrument rather than a comment.
const LEGACY_FRAME = { OV: {}, FIXED_ORIENTATION: null, FOOTER_SAFE: false, FOOTER_PLATE_TOP: null, DESIGN: {} };
const _proj = projection(Object.assign({ stopPts, atco2ll, ANCHOR,
  IR: Object.assign({}, IR, { lenses: undefined }),      // the copy had no lens support
  ZOOM: { corePct: 1.0, comp: 1.0 } }, LEGACY_FRAME));   // ZOOM is the classic model's; unread with IR set
const { XY, MX0, MX1, MY0, MY1, theta } = _proj;
const { minX, minY, sc, offX, offY } = _proj.viewport;
// inverse: page-mm -> pseudo [lat,lon]. Rotation + fisheye stay baked in; the
// pseudo coords are the ROTATED planar frame re-read as lat/lon (lat=-y,lon=x),
// centred near 0 so the workspace gen_internal's k=cos(lat0)≈1 (isotropic —
// angle-exact to ~1e-8).
const INV = ([x, y]) => [-(minY + (y - MY0 - offY) / sc), minX + (x - MX0 - offX) / sc];
const rll = v => +v.toFixed(8);

// ---- shared road graph from the matched routes (+ keyRoads) ----------------
// Node identity = OSM node coordinates rounded to 6dp (routes_paths pts were
// written at 6dp from the same roads_geo geometry, so keys match exactly).
let N = new Map();                         // key -> {mm:[x,y], adj:Map(key->edgeId)}
let E = [];                                // edgeId -> {a,b} (a,b = node keys)
const roadOps = roadGraph.graphOps({ XY, withLatLon: false, withName: false });
const node = ll => roadOps.node(N, ll);
const addEdge = (ka, kb) => roadOps.addEdge(N, E, ka, kb);
for (const r of order) {
  const o = RP.routes[r]; if (!o || !o.pts || o.pts.length < 2) continue;
  let prev = node(o.pts[0]);
  for (let i = 1; i < o.pts.length; i++) { const kk = node(o.pts[i]); addEdge(prev, kk); prev = kk; }
}
// keyRoads: schematize them IN the graph so they land exactly on (and join
// cleanly with) the solved corridors, instead of being warped alongside them.
// keyRoad-only geometry is clipped to frame+clipMargin (an OSM way can run
// kilometres past the map); route geometry is never clipped (tails must still
// cross the frame so gen_internal's TRIM/arrows work).
const inClip = mm => mm[0] >= MX0 - SCH.clipMargin && mm[0] <= MX1 + SCH.clipMargin
  && mm[1] >= MY0 - SCH.clipMargin && mm[1] <= MY1 + SCH.clipMargin;
for (const nm of (IR.keyRoads || [])) {
  for (const w of RG.ways) {
    if (w.tags.name !== nm) continue;
    for (let i = 0; i < w.geometry.length - 1; i++) {
      const pa = XY(w.geometry[i]), pb = XY(w.geometry[i + 1]);
      if (!inClip(pa) && !inClip(pb)) continue;
      addEdge(node(w.geometry[i]), node(w.geometry[i + 1]));
    }
  }
}
console.log('graph: ' + N.size + ' nodes, ' + E.length + ' edges');

// ---- junction-cluster contraction -------------------------------------------
// OSM micro-geometry (roundabouts, dual-carriageway splits, staggered T-pairs)
// creates 1-3mm cycles between junctions. Those cannot close octolinearly
// (they keep visible 4-45deg residuals however hard the solver pushes) and
// they clutter the interchange. A block that small cannot be drawn legibly
// anyway, so junctions closer than `mergeJn` mm contract to one node (their
// centroid) before corridor extraction; every merged/orphaned original node
// later inherits its representative's solved position.
//
// Runs to a FIXPOINT: one merge pass can turn a through-node into a degree-1
// dead-end stub (both its neighbours land in the same cluster) — that stub then
// makes a route fold in-and-out of it = a visible spike. A second pass sees the
// new stub and absorbs it. Two rules per pass: (a) any two junctions within
// `mergeJn` mm; (b) any short (< `mergeEdge` mm) edge whose endpoints are both
// non-degree-2 (junction or dead-end stub) — a real edge confirms they're one
// place, so it merges at a slightly longer reach and cleans up the stubs (a)
// leaves behind. REP maps every absorbed original key to its final rep.
// road_graph.js does the contraction (OA-232 Tier 3.3). The LOG LINE stays here
// rather than moving with it: this one names its two thresholds and the
// diagram's does not, and that wording belongs to whoever reads the output.
const _con = roadOps.contract(N, E, { mergeJn: SCH.mergeJn, mergeEdge: SCH.mergeEdge });
N = _con.N; E = _con.E;
const REP = _con.REP;                      // original key -> representative key
if (_con.totalMerged) console.log('contracted ' + _con.totalMerged + ' junction node(s) (mergeJn '
  + SCH.mergeJn + ' / mergeEdge ' + SCH.mergeEdge + 'mm); graph now ' + N.size + ' nodes, ' + E.length + ' edges');

if (process.env.DBG_PAIR) {                 // "keyA|keyB" — inspect two nodes post-contraction
  const [ka, kb] = process.env.DBG_PAIR.split('|');
  for (const k of [ka, kb]) { const n = N.get(k);
    console.error('PAIR node ' + k + ' present=' + !!n + (n ? ' deg=' + n.adj.size + ' mm=' + n.mm.map(v => v.toFixed(2)) + ' nbrs=' + [...n.adj.keys()].join(';') : '')); }
  if (N.get(ka) && N.get(kb)) console.error('  connected=' + N.get(ka).adj.has(kb) + ' dist=' + Math.hypot(N.get(ka).mm[0] - N.get(kb).mm[0], N.get(ka).mm[1] - N.get(kb).mm[1]).toFixed(3) + 'mm');
}
// ---- corridors: collapse degree-2 chains between junctions -----------------
const deg = kk => roadGraph.deg(N, kk);
const corridors = [];                       // {chain:[key...], mm:[[x,y]...]}
const eSeen = new Set();
// follow chain from junction k0 towards k1
const walk = (k0, k1) => roadGraph.walk(N, eSeen, k0, k1);
for (const [kk, n] of N) {
  if (deg(kk) === 2) continue;              // start walks at junctions/ends only
  for (const nb of n.adj.keys()) {
    if (eSeen.has(n.adj.get(nb))) continue;
    corridors.push({ chain: walk(kk, nb) });
  }
}
{ // any untouched edges = junction-free loops: walk them from an arbitrary node
  for (let id = 0; id < E.length; id++) {
    if (eSeen.has(id)) continue;
    const e = E[id];
    corridors.push({ chain: walk(e.a, e.b) });
  }
}
for (const c of corridors) c.mm = c.chain.map(kk => N.get(kk).mm);
// closed corridor (loop back to start): drop it entirely when it is tiny
// (< dropLoop mm around — junction contraction leaves such rings when a
// cluster's connecting lanes survive; unreadable at page scale), otherwise
// force a split at the farthest vertex so each half has distinct endpoints.
const splitCorr = [];
const ORPH = new Map();                    // dropped-loop interior key -> endpoint key
for (const c of corridors) {
  if (c.chain[0] === c.chain[c.chain.length - 1] && c.chain.length > 3) {
    let arc = 0;
    for (let i = 0; i < c.mm.length - 1; i++) arc += Math.hypot(c.mm[i + 1][0] - c.mm[i][0], c.mm[i + 1][1] - c.mm[i][1]);
    if (arc < SCH.dropLoop) {
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
// ---- parallel corridors between one junction pair ---------------------------
// Junction contraction can leave 2+ corridors joining the SAME two nodes:
// a dual carriageway's twin ways (near-coincident) or a genuine block loop
// (well separated). Twins would collapse the solver — two different octants
// demanded between one point pair squeeze the pair towards zero length — so
// near-coincident duplicates are dropped (their nodes later ride the kept
// corridor by arc fraction) and separated ones get a forced mid bend so the
// loop can bow around.
const DUP = [];
{
  const arcOf = c => { let a = 0; for (let i = 0; i < c.mm.length - 1; i++) a += Math.hypot(c.mm[i + 1][0] - c.mm[i][0], c.mm[i + 1][1] - c.mm[i][1]); return a; };
  const byPair = new Map();
  for (const c of CORS) {
    const a = c.chain[0], b = c.chain[c.chain.length - 1]; const k = a < b ? a + '~' + b : b + '~' + a;
    (byPair.get(k) || byPair.set(k, []).get(k)).push(c);
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
  for (const [k, cs] of byPair) {
    if (cs.length < 2) continue;
    cs.sort((x, y) => arcOf(y) - arcOf(x));
    for (let i = 1; i < cs.length; i++) {
      const c = cs[i], mid = c.mm[Math.floor(c.mm.length / 2)];
      if (distToPoly(mid, cs[0].mm) < 2.5) { c.dupOf = cs[0]; DUP.push(c); }
      else c.forceBend = true;
    }
  }
  CORS = CORS.filter(c => !c.dupOf);
  if (DUP.length) console.log('dropped ' + DUP.length + ' twin (dual-carriageway) corridor(s)');
}
console.log('corridors: ' + CORS.length);

// ---- simplify each corridor to straight legs (Douglas-Peucker) -------------
for (const c of CORS) {
  const keep = [0];
  dp(c.mm, 0, c.mm.length - 1, SCH.tol, keep);
  keep.push(c.mm.length - 1);
  keep.sort((a, b) => a - b);
  // drop bend points that leave a leg shorter than minLeg (keep endpoints)
  const pruned = [keep[0]];
  for (let i = 1; i < keep.length - 1; i++) {
    const p = c.mm[keep[i]], q = c.mm[pruned[pruned.length - 1]];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= SCH.minLeg) pruned.push(keep[i]);
  }
  pruned.push(keep[keep.length - 1]);
  c.anchors = [...new Set(pruned)];
  // block-loop halves sharing both endpoints with a sibling corridor need at
  // least one bend to bow around it — force one at the farthest-off-chord vertex
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
}

// ---- solver nodes + legs ----------------------------------------------------
const SN = new Map();                       // solver node id -> {mm0:[x,y]}
const snid = new Map();                     // "corr:idx" or node-key -> solver id
function solverNode(c, idx) {
  const kk = c.chain[idx];
  const isJn = (idx === 0 || idx === c.chain.length - 1);
  const id = isJn ? 'J:' + kk : 'B:' + CORS.indexOf(c) + ':' + idx;
  if (!SN.has(id)) SN.set(id, { mm0: c.mm[idx].slice() });
  return id;
}
const LEGS = [];                            // {u,v,c,i0,i1,len,bear,oct}
for (const c of CORS) {
  for (let a = 0; a < c.anchors.length - 1; a++) {
    const i0 = c.anchors[a], i1 = c.anchors[a + 1];
    const u = solverNode(c, i0), v = solverNode(c, i1);
    const pu = c.mm[i0], pv = c.mm[i1];
    const dx = pv[0] - pu[0], dy = pv[1] - pu[1];
    const chord = Math.hypot(dx, dy); if (chord < 1e-6) continue;
    // length target = ARC length, not chord: straightening a windy corridor
    // must not shrink it (chord targets contracted the whole town centre) —
    // keeping travelled length spreads junctions/stops out, tube-map style.
    let arc = 0;
    for (let i = i0; i < i1; i++) arc += Math.hypot(c.mm[i + 1][0] - c.mm[i][0], c.mm[i + 1][1] - c.mm[i][1]);
    const bear = Math.atan2(dy, dx) * 180 / Math.PI;
    LEGS.push({ u, v, c, i0, i1, len: arc, bear, oct: ((Math.round(bear / 45)) % 8 + 8) % 8 });
  }
}
console.log('solver: ' + SN.size + ' nodes, ' + LEGS.length + ' legs');

// ---- direction-conflict resolution at each node -----------------------------
// Two legs leaving one node on the SAME octant would draw on top of each other.
// Re-assign distinct octants in cyclic bearing order, minimising length-weighted
// angular deviation (long legs resist being pushed off their natural bearing).
const incid = new Map();                    // solver node -> [{leg, atU}]
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
    // sort by outward bearing, then find the min-cost strictly-cyclic slot assignment
    const L2 = list.slice().sort((a, b) => ((outBear(a) + 360) % 360) - ((outBear(b) + 360) % 360));
    const kk = L2.length;
    let best = null;
    for (let s0 = 0; s0 < 8; s0++) {
      // DP: slots strictly increasing from s0 within s0..s0+7
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

// ---- weighted least-squares position solve ----------------------------------
// Rows: perpendicular-to-octant (weight dirW, target 0), leg length along octant
// (weight lenW, target max(len,minLeg)), anchor springs to geography (anchorW).
{
  const ids = [...SN.keys()]; const idx = new Map(ids.map((d, i) => [d, i]));
  const rows = [];
  for (const lg of LEGS) {
    const ui = idx.get(lg.u) * 2, vi = idx.get(lg.v) * 2;
    const a = lg.oct * 45 * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    rows.push({ cs: [[ui, dy], [ui + 1, -dx], [vi, -dy], [vi + 1, dx]], t: 0, w: SCH.dirW });                      // n·(pv-pu)=0
    rows.push({ cs: [[ui, -dx], [ui + 1, -dy], [vi, dx], [vi + 1, dy]], t: Math.max(lg.len, SCH.minLeg), w: SCH.lenW }); // d·(pv-pu)=L
  }
  for (const [id, n] of SN) {
    const i = idx.get(id) * 2;
    rows.push({ cs: [[i, 1]], t: n.mm0[0], w: SCH.anchorW });
    rows.push({ cs: [[i + 1, 1]], t: n.mm0[1], w: SCH.anchorW });
  }
  const R = lsq(ids.length * 2, rows);
  for (const [id, n] of SN) { const i = idx.get(id) * 2; n.mm = [R[i], R[i + 1]]; }
}
// ---- weld degenerate short legs ---------------------------------------------
// A leg the graph forced to a few tenths of a mm — typically where a keyRoad
// junction lands a few metres from a route junction, splitting off a tiny stub
// corridor whose snapped octant points the wrong way — draws as a visible
// spike/kink even though it carries no real distance. Co-locate its endpoints
// at their midpoint so the excursion vanishes; because nodePos (and hence the
// route lines AND the grey casing) are all derived from these solved
// positions, everything follows with no separate fix and stopT is untouched.
// Endpoints move by at most weldLeg/2, so adjacent legs are unperturbed.
if (SCH.weldLeg > 0) {
  let weldedTot = 0;
  for (let pass = 0; pass < 5; pass++) {
    let welded = 0;
    for (const lg of LEGS) {
      const a = SN.get(lg.u).mm, b = SN.get(lg.v).mm;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 1e-9 && L < SCH.weldLeg) {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        SN.get(lg.u).mm = [mx, my]; SN.get(lg.v).mm = [mx, my]; welded++;
      }
    }
    weldedTot += welded; if (!welded) break;
  }
  if (weldedTot) console.log('welded ' + weldedTot + ' degenerate short leg(s) (<' + SCH.weldLeg + 'mm)');
}
if (process.env.DBG_NODE) {                 // dump a node's incident legs (solved)
  const t = process.env.DBG_NODE;
  for (const [id, n] of SN) {
    if (!id.includes(t)) continue;
    console.error('NODE ' + id + ' solved ' + n.mm.map(v => v.toFixed(1)));
    for (const lg of LEGS) {
      if (lg.u !== id && lg.v !== id) continue;
      const other = lg.u === id ? lg.v : lg.u, om = SN.get(other).mm;
      const bear = (Math.atan2(om[1] - n.mm[1], om[0] - n.mm[0]) * 180 / Math.PI + 360) % 360;
      console.error('  -> ' + other.slice(0, 24) + ' oct=' + lg.oct + ' solvedBear=' + bear.toFixed(0) + ' len=' + lg.len.toFixed(1) + ' corr=' + CORS.indexOf(lg.c));
    }
  }
}
// residual check: angular deviation from the assigned octant. Tiny legs inside
// unsatisfiable micro-cycles (roundabout fragments) may keep a big deviation —
// report length too so a visually-relevant one stands out.
let worst = 0;
for (const lg of LEGS) {
  const pu = SN.get(lg.u).mm, pv = SN.get(lg.v).mm;
  const solvedLen = Math.hypot(pv[0] - pu[0], pv[1] - pu[1]);
  const b = Math.atan2(pv[1] - pu[1], pv[0] - pu[0]) * 180 / Math.PI;
  const dev = angdist(b, lg.oct * 45);
  if (dev > 3 && solvedLen > 1.5)
    console.log('  off-octant leg: dev ' + dev.toFixed(1) + ' deg, solved ' + solvedLen.toFixed(1)
      + ' mm (orig ' + lg.len.toFixed(1) + ' mm) at ' + lg.u + ' -> ' + lg.v);
  worst = Math.max(worst, dev);
}
console.log('solved; worst octant deviation ' + worst.toFixed(3) + ' deg (see any off-octant legs above)');

// ---- map every graph node onto the solved legs ------------------------------
const nodePos = new Map();                  // node key -> solved mm
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
// merged junctions + dropped-loop interiors inherit their representative's spot
for (const [k, r] of REP) if (!nodePos.has(k) && nodePos.has(r)) nodePos.set(k, nodePos.get(r));
for (const [k, e] of ORPH) if (!nodePos.has(k)) {
  const t = nodePos.get(e) || (REP.has(e) && nodePos.get(REP.get(e)));
  if (t) nodePos.set(k, t);
}
// twin-corridor (dual carriageway) nodes ride the kept corridor by arc fraction
for (const c of DUP) {
  const keep = c.dupOf;
  const kc = (c.chain[0] === keep.chain[0]) ? keep.chain : keep.chain.slice().reverse();
  const kp = kc.map(k => nodePos.get(k)).filter(Boolean);
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

// ---- warp field for everything off the network ------------------------------
const warp = roadGraph.makeWarp(SN);   // samples the SOLVED SN, so it is built here, not earlier

// ---- write the workspace -----------------------------------------------------
const WD = path.join(DIR, SCH.workDir);
fs.mkdirSync(WD, { recursive: true });
const wjson = (f, o) => fs.writeFileSync(path.join(WD, f), JSON.stringify(o));

// routes_paths.json: same shape, pts mapped through the solved graph
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
// atco2ll.json: stops ON drawn routes -> exact position via their stopT {i,t}
// evaluated on the schematized polyline (identical indices — stopT untouched);
// everything else through the warp.
{
  const out = {};
  const done = new Set();
  const schemPts = {};                       // r -> mapped mm pts
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
// roads_geo.json: network vertices exact, the rest warped (only matters for
// keyRoads/roadLabelInclude lookups and the optional context layer)
{
  const out = { bbox: RG.bbox, ways: RG.ways.map(w => ({
    id: w.id, nodes: w.nodes, tags: w.tags,
    geometry: w.geometry.map(g => { const q = nodePos.get(key6(g)) || warp(XY(g)); return INV(q).map(rll); })
  })) };
  wjson('roads_geo.json', out);
}
// features_geo.json: each linear feature (river etc.) is simplified and
// 45deg-snapped in the same visual language as the roads, but PINNED at the
// exact points where it crosses the solved road network — a river that drifts
// off its bridges reads as wrong, so the crossings are hard anchors and the
// rest of the course follows via the same LSQ solve the roads use.
// Approach: keep the river's real WINDING shape (do NOT octolinearise it — a
// river drawn as 45deg legs reads as a road, and forcing crossings + octant
// snapping distorted it enough to cross routes it never meets in reality). Just
// push every original vertex through the same displacement `warp()` the roads
// use, so the river follows the routes' movement and stays on the correct side
// of them. featureTol thins the point count without changing the shape.
{
  let fgeo = {}; try { fgeo = JSON.parse(fs.readFileSync(DIR + '/features_geo.json', 'utf8')); } catch (e) { }
  const out = {};
  for (const kf in fgeo) {
    out[kf] = fgeo[kf].map(seg => {
      const mm = seg.map(p => XY(p));
      if (mm.length < 3) return mm.map(p => INV(warp(p)).map(rll));
      const keep = [0]; dp(mm, 0, mm.length - 1, SCH.featureTol, keep); keep.push(mm.length - 1);
      return [...new Set(keep)].sort((a, b) => a - b).map(i => INV(warp(mm[i])).map(rll));
    });
  }
  wjson('features_geo.json', out);
}
// river_geo.json: the LEGACY single-river fallback (towns with no features[] of
// their own, e.g. March) — same shape as one features_geo.json entry (an array
// of polyline segments of [lat,lon]), so it needs the identical warp treatment
// above, not the straight copy below. Found 2026-08-19: March was the straight
// copy's only internalSchematic town, so nothing had exercised this path before.
// Un-warped, gen_internal's legacy fallback (which reads this file directly, see
// its own FEATURES synthesis) drew the river from raw lat/lon values on a page
// scaled in mm — hundreds of thousands of units off the frame, so the river (and
// therefore its label, however short) had no ink anywhere near the visible page
// for labelPos:"auto" to land on. Absent or empty file ⇒ untouched, same as before.
{
  let rgeo = []; try { rgeo = JSON.parse(fs.readFileSync(DIR + '/river_geo.json', 'utf8')); } catch (e) { }
  if (rgeo.length) {
    const out = rgeo.map(seg => {
      const mm = seg.map(p => XY(p));
      if (mm.length < 3) return mm.map(p => INV(warp(p)).map(rll));
      const keep = [0]; dp(mm, 0, mm.length - 1, SCH.featureTol, keep); keep.push(mm.length - 1);
      return [...new Set(keep)].sort((a, b) => a - b).map(i => INV(warp(mm[i])).map(rll));
    });
    wjson('river_geo.json', out);
  }
}
// osm POI coords through the warp
for (const f of ['osm.json', 'osm2.json']) {
  const o = JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8'));
  for (const e of o.elements) {
    if (e.lat != null) { const q = INV(warp(XY([e.lat, e.lon]))); e.lat = rll(q[0]); e.lon = rll(q[1]); }
    if (e.center) { const q = INV(warp(XY([e.center.lat, e.center.lon]))); e.center.lat = rll(q[0]); e.center.lon = rll(q[1]); }
  }
  wjson(f, o);
}
// straight copies (river_geo.json handled above — it needs the warp, not this)
for (const f of ['atco2name.json', 'routes_intown_atco.json', 'intown_cfg.json']) {
  try { fs.copyFileSync(path.join(DIR, f), path.join(WD, f)); } catch (e) { }
}
// workspace routes.json: rotation + fisheye are baked into the coordinates, so
// neutralise both; context roads default OFF for the tube-map look; then any
// internalSchematic.internalRoads overrides win.
{
  const rj = JSON.parse(JSON.stringify(RJ));
  // corridor bundling: schematized shared legs are EXACTLY coincident (same
  // solved nodes), while distinct streets can end up much closer together than
  // in reality — so the workspace bundles far tighter than the geographic
  // default (dist 2.4mm would fuse separate streets and blow the casing up).
  // tube-map styling defaults: the hand-made leaflet draws NO grey road casing
  // (coloured lines straight onto white), so the workspace casing goes near-
  // white — it survives only as a subtle separator where corridors cross.
  rj.internalRoads = Object.assign({}, RJ.internalRoads,
    { rotationDeg: 0, focus: { coreKm: 1.1, comp: 1 }, contextRoads: SCH.contextRoads,
      skeleton: '#f6f6f6', gap: 2.4 },
    SCH.internalRoads || {});
  rj.internalRoads.corridor = Object.assign({ dist: 0.6, angle: 12 },
    (SCH.internalRoads || {}).corridor || {});
  // north arrow: the schematic's coords are pre-rotated and run at rotationDeg
  // 0, so gen_internal can't re-derive north from theta — precompute the SCREEN
  // bearing of north here (same orientation as the geographic map, which the
  // schematic preserves) and pass it as an explicit `angle`.
  const naCfg = (SCH.internalRoads && SCH.internalRoads.northArrow) || (RJ.internalRoads||{}).northArrow;
  // `!== false`, not truthiness: the arrow is DRAWN BY DEFAULT when the town has
  // no northArrow key at all, so the injection has to fire by default too. It used
  // to test the key's truthiness, which meant a town that let the engine own the
  // arrow (the norm since it started auto-placing itself, 2026-08-15) got no angle
  // injected here and its schematic pointed north at the workspace's own rotation
  // of zero — i.e. straight up, on a map that is not north-up.
  if (naCfg !== false) {
    const base = (!naCfg || naCfg === true) ? {} : naCfg;
    rj.internalRoads.northArrow = Object.assign({}, base,
      { angle: Math.atan2(-Math.cos(-theta), Math.sin(-theta)) * 180 / Math.PI });
  }
  // per-feature overrides (schematized rivers move, so their label position /
  // reserve box usually needs its own schematic spot): internalSchematic.
  // features = { "<key>": { labelPos, labelReserve, ... } } merged by key.
  if (SCH.features && rj.features)
    rj.features = rj.features.map(f => SCH.features[f.key] ? Object.assign({}, f, SCH.features[f.key]) : f);
  // Schematized coordinates are solved onto a grid — topology, not distance. The
  // workspace even sets focus.comp:1, so gen_internal's projection looks perfectly
  // uniform and would print a confident, meaningless scale bar. Say so instead.
  // Inert without design.scaleBar, so nothing moves.
  //
  // 'schematic', not `true`: the value now says WHICH kind of not-to-scale sheet this is,
  // because the schematic and the tube-map diagram were printing the same words. Both said
  // "Diagram — not to scale", so the two expert sheets claimed to be the same thing and the
  // straightened street map called itself a diagram (Peter's item 13). gen_internal.js reads
  // the string; `true` still means the old wording, so nothing else has to change at once.
  rj.notToScale = 'schematic';
  wjson('routes.json', rj);
}

// ---- debug skeleton SVG (bare solved corridors, junction dots) --------------
{
  let s = svgOpen();
  s += `<rect width="297" height="210" fill="#fff"/>`;
  s += `<rect x="${MX0}" y="${MY0}" width="${MX1 - MX0}" height="${MY1 - MY0}" fill="none" stroke="#ddd" stroke-width="0.3"/>`;
  for (const c of CORS)                     // original geography, light grey
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

// ---- run the (unmodified) internal generator on the workspace ----------------
// gen_internal.js reads LEAFLET_DIR || cwd, so run it with cwd = the workspace;
// the generator template itself is taken from the town run dir when present
// (the S3/S4 convention — the committed copy), falling back to the skill assets.
//
// PLACE maps (DIR carries gen_internal_place.js) need the same two fixes that
// wrapper applies for the ordinary geographic output: the version stamp (via
// LEAFLET_VERSION, set BEFORE the run - inert since 2026-08-10, when the engine
// build number stopped being printed, but reproduced here so that this path and
// gen_internal_place.js cannot drift) and the title token (a post-hoc swap, since
// gen_internal itself has no place concept).
// We reproduce gen_internal_place.js's own logic here rather than running it,
// because it resolves gen_internal.js and internal.svg relative to DIR/cwd —
// assumptions that don't hold once the workspace subfolder is in play.
if (process.env.SCHEMATIZE_ONLY !== '1') {
  const { spawnSync } = require('child_process');
  // Run dir, then SKILL_ASSETS, then this script's folder — engine_paths.js's
  // spawnTarget(), which is where that search now lives; both pre-stages wrote it
  // out (engine N24). It is a THIRD rule, not dep(): see the header there.
  const gen = spawnTarget(DIR, __dirname)('gen_internal.js');
  if (!gen) { console.error('gen_internal.js not found (looked in run dir / SKILL_ASSETS / script dir)'); process.exit(1); }
  const isPlace = fs.existsSync(path.join(DIR, 'gen_internal_place.js'));
  const env = { ...process.env };
  if (isPlace && env.LEAFLET_VERSION == null) env.LEAFLET_VERSION = String(RJ.version || '').replace(/^v/i, '');
  const res = spawnSync(process.execPath, [gen], { cwd: WD, env, stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status || 1);
  const OUT = path.join(DIR, 'internal-schematic.svg');
  fs.copyFileSync(path.join(WD, 'internal.svg'), OUT);
  // CARRY THE DROP REPORT OUT WITH THE SHEET. gen_internal.js writes unplaced.json
  // into its own cwd -- which here is the WORKSPACE, a subfolder -- while the sheet
  // itself is copied up to DIR. sync_ci_reference.js copies files and skips
  // directories, so every label this schematic gave up on stayed in the workspace
  // where no gate, ledger or report could ever see it: 165 dropped labels across the
  // 13 schematic and diagram sheets, on disk and uncounted, until 2026-08-27.
  // Same unlink-when-empty idiom as every other writer, so an ABSENT sidecar means
  // zero and quality_metrics.js can read it with no special case.
  const UN_OUT = path.join(DIR, 'unplaced-schematic.json');
  const UN_IN = path.join(WD, 'unplaced.json');
  if (fs.existsSync(UN_IN)) {
    fs.copyFileSync(UN_IN, UN_OUT);
    const nDropped = JSON.parse(fs.readFileSync(UN_IN, 'utf8')).length;
    process.stderr.write('schematic labels: ' + nDropped + ' could not be placed -> unplaced-schematic.json\n');
  } else { try { fs.unlinkSync(UN_OUT); } catch (e) {} }
  if (isPlace) {
    const emitted = 'Buses within ' + esc(RJ.town);
    const title = RJ.internalTitle || RJ.placeTitle || ('Buses serving ' + (RJ.placeShort || RJ.place || RJ.town));
    let svg = fs.readFileSync(OUT, 'utf8');
    if (svg.includes('>' + emitted + '<')) {
      svg = svg.replace('>' + emitted + '<', '>' + esc(title) + '<');
      fs.writeFileSync(OUT, svg);
      console.log('internal-schematic.svg title -> ' + JSON.stringify(title));
    } else {
      console.log('internal-schematic.svg written (title token not matched; RJ.town=' + JSON.stringify(RJ.town) + ').');
    }
  } else {
    console.log('internal-schematic.svg written (render with render.js for the print JPG)');
  }
}
}

if (require.main === module) main();
module.exports = { main };
