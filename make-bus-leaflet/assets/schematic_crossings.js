#!/usr/bin/env node
/*
 * schematic_crossings.js — did the OCTOLINEAR SCHEMATIZER draw a route crossing
 * itself where the ground does not?
 *
 *   node assets/schematic_crossings.js --buses "<Buses dir>"    (or $BUSES_DIR)
 *   node assets/schematic_crossings.js --buses "<dir>" --town "Wisbech"
 *   node assets/schematic_crossings.js --dir "<an S4 run folder>"
 *   node assets/schematic_crossings.js --buses "<dir>" --json
 *   node assets/schematic_crossings.js --buses "<dir>" --sep 150 --all
 *
 * Run from `make-bus-leaflet/`. `--sep` is the ground-separation threshold in
 * METRES (default 150, see THE THRESHOLD below); `--all` prints the sub-threshold
 * findings too; `--town`/`--place` repeat and narrow the sweep; `--dir` points at
 * one S4 run folder instead of an estate. There are no other parameters.
 *
 * Exit 0 when no route crosses itself above the threshold, 1 when one does,
 * 2 on a usage error. stdout carries the answer; stderr carries refusals.
 *
 * WHY THIS EXISTS (buses-data OA-240, 2026-09-04). Peter read the published
 * Wisbech simplified street map and saw route 66 — the town's circular service —
 * cross itself where the geographic sheet draws a clean loop. `schematize_
 * internal.js` solves junction and bend positions by weighted least squares over
 * three terms: an octant direction constraint, a leg-length spring and an
 * anchor-to-geography spring. NONE of them is a planarity constraint and there is
 * no post-solve check for one, so a leg re-assigned to a distinct octant at a
 * junction may sweep across another leg of the same route and nothing objects.
 * The authors already knew the shape and fixed it in the one place they looked:
 * the `features_geo.json` block deliberately does not octolinearise the river,
 * because doing so "distorted it enough to cross routes it never meets in
 * reality". That is this fault, diagnosed for the river and never asked of the
 * road network.
 *
 * WHY NO EXISTING CHECK COULD SEE IT. Every gate on this estate asks *does the
 * output still match* — `status.js`, the byte gates and `ci-reference/` all
 * compare a sheet to a stored copy of ITSELF, so they are stable under a defect
 * that has been there since the sheet was first generated. `quality_metrics.js`
 * measures legibility, contrast, label collisions and coverage and has no notion
 * of route topology. S6 red-teams the SERVICE CONTENT, not the drawing. A
 * property nothing asks about is a property nothing can report.
 *
 * WHY THE COMPARISON IS EXACT RATHER THAN AN IMPRESSION. Step 6 of the
 * schematizer maps every graph node onto the solved legs by arc-length fraction,
 * so each route's `pts` array keeps its exact shape and its exact INDICES: the
 * schematic workspace's `routes_paths.json` and the geographic one are the same
 * length and index-for-index comparable. So "did the schematizer introduce a
 * crossing?" is a set difference, not a judgement. Both frames are reached by
 * homeomorphisms of the plane (rotation, radial fisheye, fit), and neither can
 * create or destroy a crossing, so enumerating in each file's own source
 * coordinates is sound. THE LENGTH IS ASSERTED, not assumed: a route whose two
 * arrays differ in length is reported as a fault of its own rather than skipped,
 * because that would mean the premise above had quietly stopped holding.
 *
 * THE THRESHOLD, and why there is one at all. Two stretches of the same route
 * hundreds of metres apart, drawn touching, is a topological falsehood: in one
 * colour at one width it does not read as a crossing, it reads as a four-way
 * junction, and the reader cannot tell which way the bus goes. Two stretches
 * METRES apart — a bus doubling back at a turning circle or a terminus — cross
 * at or below the lane offset and say nothing false. Both are "a new crossing",
 * and only the first is worth anybody's time; a check that reported the second
 * would be muted inside a week. So each new crossing is scored by how far apart
 * the two strands REALLY ARE, measured on the geographic path in metres, and
 * only the far ones are a finding.
 *
 * WHERE 150 CAME FROM — measured on the estate on 2026-09-04, not chosen. All 9
 * maps with a schematic, every one of which gained at least one crossing: 384
 * new segment pairs falling into 98 clusters over 38 routes. Rounded to the
 * metre, a cluster's separation takes these values and no others:
 *
 *      0  5  9  18  19  21  76  87   |   272  403  409  456
 *
 * A gap from 87 m to 272 m with nothing in it, and the two sides of it are the
 * two faults rather than two halves of one. 150 sits in the gap. The eyeball
 * agrees: the 456 m and 409 m ones are plainly visible in the rendered JPG at
 * 300 dpi, and the 9 m one could not be found on the sheet at all. Re-measure
 * before moving this number, and move it for a reason from the artwork.
 *
 * THE NINTH MAP. OA-240's own sweep said eight, because it walked `Areas/` and
 * `Places/` from the disk. This walks `findTowns` + `findPlaces` from gate_lib,
 * which is the estate's one enumeration, and it finds `High Wycombe/High Wycombe
 * Aldi` as well — a place map with a schematic and two sub-threshold crossings.
 * An enumeration is a silent filter: it does not fail, it answers a smaller
 * question and looks exactly like an answer to the whole one.
 *
 * SEPARATION IS SEGMENT-TO-SEGMENT MINIMUM, not vertex-to-vertex. On Wisbech 66
 * the vertex distance is 469 m and the minimum distance between the two segments
 * is 456 m; the minimum is the conservative reading of "how close do these two
 * strands actually come", so this UNDER-reports rather than over-reports, which
 * is the safe direction for something that is allowed to fail a build.
 *
 * CROSSINGS ARE CLUSTERED BEFORE THEY ARE COUNTED. One visible X between two
 * simplified legs shows up as many index pairs — Beaconsfield 380 raises 71 of
 * them, and 29 of those are the two crossings a reader can actually point at.
 * Reporting 71 would say the sheet is far worse than it is, and reporting the
 * two would be the only honest count. Pairs whose indices are within `CLUSTER`
 * of each other on BOTH strands are one finding, scored by the widest separation
 * in the cluster; the pair count rides along so the raw number is never lost.
 *
 * IT IS NOT WIRED INTO status.js, and that is deliberate as at 2026-09-04: three
 * of the nine schematics carry a crossing above the threshold — Wisbech,
 * High Wycombe and Beaconsfield, 7 crossings between them — and all three are
 * PUBLISHED. A board that failed on them would be red on the day it was written,
 * which is the surest way to get a check muted. The wiring belongs in the same
 * change as the solver fix. Until then this is run by hand and by its own test.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, die, resolveBuses } = require('./cli');
const { findTowns, findPlaces, latestRunDir, readJson } = require('./gate_lib');
const { loadManifest } = require('./stage.js');

/** Index pairs within this of each other on BOTH strands are one crossing. */
const CLUSTER = 12;
/** Default ground separation, in metres, above which a new crossing is a finding. */
const DEFAULT_SEP_M = 150;

// ---- geometry ---------------------------------------------------------------

/* A PROPER crossing of two open segments: they meet at an interior point of
 * each. Strictly interior on purpose — a shared endpoint is how a path is
 * built, and a closed loop's first and last segment always share one. Parallel
 * and collinear pairs are NOT a crossing: an out-and-back over the same road
 * gives a degenerate determinant, and a route that retraces a street has not
 * crossed itself, it has repeated itself. */
function properCross(a, b, c, d) {
  const ax = a[1], ay = a[0], bx = b[1], by = b[0], cx = c[1], cy = c[0], dx = d[1], dy = d[0];
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (den === 0) return false;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/** Every non-adjacent segment pair of `pts` that properly crosses, as `i:j` with i<j. */
function selfCrossings(pts) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let j = i + 2; j + 1 < pts.length; j++) {
      if (properCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) out.push(i + ':' + j);
    }
  }
  return out;
}

/* Metres, on an equirectangular plane taken at the local latitude. Over the
 * hundreds of metres this measures, inside one town, that is within a metre of
 * the great-circle distance, and it lets the segment-to-segment minimum be plain
 * planar arithmetic. */
function toM(p, lat0) { const k = Math.cos(lat0 * Math.PI / 180); return [p[1] * k * 111320, p[0] * 111320]; }
function ptSegM(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1];
  const L = vx * vx + vy * vy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / L));
  return Math.hypot(wx - t * vx, wy - t * vy);
}
/* The minimum distance in metres between geographic segments a-b and c-d.
 *
 * THE FOUR ENDPOINT DISTANCES ARE THE ANSWER ONLY FOR SEGMENTS THAT DO NOT MEET.
 * For two disjoint segments the closest approach is always at an endpoint of one
 * of them, which is exactly the case this is called in — the pairs measured here
 * cross on the SCHEMATIC and not on the geography. Off that domain the four
 * distances are all positive while the true answer is zero, so the crossing case
 * is answered first rather than left as a trap for the next caller. */
function segSepM(a, b, c, d) {
  if (properCross(a, b, c, d)) return 0;
  const lat0 = (a[0] + c[0]) / 2;
  const [A, B, C, D] = [a, b, c, d].map((p) => toM(p, lat0));
  return Math.min(ptSegM(A, C, D), ptSegM(B, C, D), ptSegM(C, A, B), ptSegM(D, A, B));
}

// ---- the finding ------------------------------------------------------------

/* One visible X is many index pairs. Single-link on both indices at once: a pair
 * joins a cluster when it is within CLUSTER of a member on the i strand AND on
 * the j strand. Requiring both is what keeps two genuinely different crossings
 * along one long leg apart. */
function cluster(pairs) {
  const parent = pairs.map((_, n) => n);
  const find = (n) => { while (parent[n] !== n) { parent[n] = parent[parent[n]]; n = parent[n]; } return n; };
  for (let a = 0; a < pairs.length; a++) {
    for (let b = a + 1; b < pairs.length; b++) {
      if (Math.abs(pairs[a].i - pairs[b].i) <= CLUSTER && Math.abs(pairs[a].j - pairs[b].j) <= CLUSTER) {
        parent[find(a)] = find(b);
      }
    }
  }
  const by = new Map();
  pairs.forEach((p, n) => { const r = find(n); if (!by.has(r)) by.set(r, []); by.get(r).push(p); });
  return [...by.values()].map((g) => {
    const worst = g.reduce((m, p) => (p.sepM > m.sepM ? p : m), g[0]);
    return { i: worst.i, j: worst.j, sepM: worst.sepM, pairs: g.length };
  }).sort((a, b) => b.sepM - a.sepM);
}

/* Crossings the SCHEMATIC has and the GEOGRAPHY does not, clustered, each scored
 * by the widest ground separation in its cluster. `geo` and `sch` are the two
 * `pts` arrays; they must be the same length and the caller checks that.
 * Returns [] when the schematizer introduced nothing. */
function newCrossings(geo, sch) {
  const had = new Set(selfCrossings(geo));
  const fresh = selfCrossings(sch).filter((k) => !had.has(k))
    .map((k) => {
      const [i, j] = k.split(':').map(Number);
      return { i, j, sepM: segSepM(geo[i], geo[i + 1], geo[j], geo[j + 1]) };
    });
  return cluster(fresh);
}

/* The road each segment is on, for a person reading the finding. `edges[i]` is
 * the OSM node pair of segment i as `a>b`; `edgeWay` is keyed `a|b` in whichever
 * order the way was read, so both are tried. A name we cannot resolve prints as
 * the highway class or `?` — this is context, never a reason to skip a finding. */
function roadName(route, edgeWay, i) {
  const e = route.edges && route.edges[i];
  if (!e || !edgeWay) return '?';
  const [a, b] = e.split('>');
  const w = edgeWay[a + '|' + b] || edgeWay[b + '|' + a];
  return w ? (w.name || '(' + w.highway + ')') : '?';
}

/*
 * One S4 run folder. Returns null when it has no schematic — that is the normal
 * case for a map that never asked for one, not a finding. Otherwise
 * { routes: [...] } with one entry per route that gained a crossing, each
 * carrying EVERY cluster, so the CALLER applies the threshold. A function that
 * filtered here could not be asked what it had thrown away.
 */
function analyseRun(runDir) {
  const geoF = path.join(runDir, 'routes_paths.json');
  const schF = path.join(runDir, 'schematic', 'routes_paths.json');
  if (!fs.existsSync(schF) || !fs.existsSync(geoF)) return null;
  const G = readJson(geoF), S = readJson(schF);
  const out = [];
  for (const r of Object.keys(S.routes || {})) {
    const g = G.routes && G.routes[r], s = S.routes[r];
    if (!g) { out.push({ route: r, error: 'the schematic has this route and the geography does not' }); continue; }
    if (g.pts.length !== s.pts.length) {
      out.push({ route: r, error: `index-for-index comparison is off: geographic ${g.pts.length} points, schematic ${s.pts.length}` });
      continue;
    }
    const found = newCrossings(g.pts, s.pts);
    if (!found.length) continue;
    out.push({
      route: r,
      crossings: found.map((c) => Object.assign({}, c, {
        atI: roadName(g, G.edgeWay, c.i), atJ: roadName(g, G.edgeWay, c.j),
      })),
    });
  }
  return { routes: out };
}

/*
 * The same finding, phrased for `build_log.js` — one line per crossing over the
 * threshold, ready to be handed to `BUILDLOG.collect()` as a generator's stderr.
 * Empty when there is nothing to say, which is what a clean run must produce.
 *
 * BOTH ROLLOUT TOOLS CALL THIS, and neither has its own copy: the unit of an
 * extraction on this project is the module PLUS a check on its callers, and
 * `rollout_crossings.test.js`'s census is that check. A rollout is the only place
 * this question can be asked at all — the schematic workspace exists in an S4 run
 * folder and nowhere else, so CI's clone cannot see it.
 *
 * IT IS DELIBERATELY PHRASED SO THAT `severity()` READS IT AS `WARN`. The words
 * that make an entry BLOCKING are "not drawn", "names nothing", "has no geometry"
 * and the overflow and crash shapes, and this says none of them. As at 2026-09-04
 * three published maps carry a Class A crossing; a blocking warning would stop
 * their next build the day it was written, including the rollout this rides on.
 * Promoting it is one word in this string, and it belongs in the change that
 * fixes the solver.
 */
function crossingWarnings(runDir, { sepM = DEFAULT_SEP_M } = {}) {
  let res;
  try { res = analyseRun(runDir); } catch (e) { return ['crossings: the self-crossing check could not read this run — ' + e.message]; }
  if (!res) return [];
  const out = [];
  for (const r of res.routes) {
    if (r.error) { out.push(`crossings: route ${r.route} — ${r.error}`); continue; }
    for (const c of r.crossings) {
      if (c.sepM <= sepM) continue;
      out.push(`crossings: route ${r.route} is drawn crossing itself at ${c.atI} x ${c.atJ}, `
        + `where the two stretches are ${c.sepM.toFixed(0)} m apart on the ground (OA-240). `
        + `The geographic sheet does not cross there; in one colour at one width this reads as a junction.`);
    }
  }
  return out;
}

// ---- the sweep --------------------------------------------------------------

/** Every map on the estate with a manifest, town and place alike, as {name, dir}. */
function everyMap(buses) {
  const towns = findTowns(buses);
  return towns.concat(findPlaces(towns, buses).map((p) => ({
    name: p.town ? `${p.town}/${p.name}` : p.name, dir: p.dir,
  })));
}

function main() {
  const args = parseArgs(process.argv.slice(2), { repeat: ['town', 'place'] });
  const sepM = args.sep === undefined ? DEFAULT_SEP_M : Number(args.sep);
  if (!Number.isFinite(sepM) || sepM < 0) die('--sep needs a distance in metres', 2);

  let maps;
  if (args.dir) {
    if (args.dir === true) die('--dir needs a path to an S4 run folder', 2);
    maps = [{ name: path.basename(path.resolve(args.dir)), dir: null, run: path.resolve(args.dir) }];
  } else {
    const buses = resolveBuses(args, process.env);
    if (!fs.existsSync(buses)) die('no such folder: ' + buses, 2);
    const want = new Set([].concat(args.town, args.place).filter((x) => typeof x === 'string'));
    maps = everyMap(buses)
      .filter((m) => !want.size || want.has(m.name) || want.has(path.basename(m.name)))
      .map((m) => {
        if (!fs.existsSync(path.join(m.dir, 'manifest.json'))) return null;
        const at = latestRunDir(loadManifest(m.dir), m.dir, 'S4');
        return at ? { name: m.name, dir: m.dir, run: at.dir } : null;
      }).filter(Boolean);
    if (want.size && !maps.length) die('no map on the estate is called: ' + [...want].join(', '), 2);
  }

  const report = [];
  for (const m of maps) {
    const res = analyseRun(m.run);
    if (!res) continue;                       // no schematic — not a finding
    for (const r of res.routes) report.push(Object.assign({ map: m.name, run: m.run }, r));
  }

  const errors = report.filter((r) => r.error);
  const over = [], under = [];
  for (const r of report) {
    if (r.error) continue;
    for (const c of r.crossings) (c.sepM > sepM ? over : under).push(Object.assign({ map: r.map, route: r.route }, c));
  }
  over.sort((a, b) => b.sepM - a.sepM);
  under.sort((a, b) => b.sepM - a.sepM);

  if (args.json) {
    console.log(JSON.stringify({ sepM, maps: maps.length, over, under, errors }, null, 2));
  } else {
    const line = (c) => `  ${c.map} ${c.route}: ${c.sepM.toFixed(0)} m apart on the ground, `
      + `drawn crossing at index ${c.i} (${c.atI}) x ${c.j} (${c.atJ})`
      + (c.pairs > 1 ? ` [${c.pairs} segment pairs]` : '');
    for (const e of errors) console.error(`schematic_crossings: ${e.map} ${e.route}: ${e.error}`);
    if (!over.length) {
      console.log(`schematic_crossings: no route is drawn crossing itself more than ${sepM} m from itself.`);
    } else {
      console.log(`schematic_crossings (OA-240) — ${over.length} crossing(s) the geography does not make, `
        + `over ${sepM} m apart on the ground:`);
      over.forEach((c) => console.log(line(c)));
    }
    if (args.all) {
      console.log(`\nBelow the threshold — a bus doubling back, not a falsehood (${under.length}):`);
      under.forEach((c) => console.log(line(c)));
    } else if (under.length) {
      console.log(`(${under.length} more within ${sepM} m — doubling back at a turn or terminus; --all to see them.)`);
    }
  }
  process.exit(errors.length || over.length ? 1 : 0);
}

module.exports = {
  selfCrossings, properCross, newCrossings, segSepM, cluster,
  analyseRun, roadName, everyMap, crossingWarnings, CLUSTER, DEFAULT_SEP_M,
};

if (require.main === module) main();
