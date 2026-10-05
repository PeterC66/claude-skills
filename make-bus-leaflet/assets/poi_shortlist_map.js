#!/usr/bin/env node
/*
 * poi_shortlist_map.js — the picture that goes with the numbered landmark list
 * (buses-data OA-568, slice 2 of 3), so a customer can FIND place 7 before saying
 * "must show: 7".
 *
 * WHAT IT DRAWS. A plain street picture from the S2 geometry already on disk
 * (`roads_geo.json`, `river_geo.json`) with one numbered disc per listed place, at
 * the place's own coordinates. No network, no tiles, no generator. It is a map for
 * FINDING places, not a bus map: no routes, no icons, nothing to confuse it with
 * the sheet. The numbers are the ones in `poi-shortlist.json`, which
 * `poi_shortlist.js` wrote, so the two files cannot disagree: this tool re-reads
 * that list and looks each key up in the same candidate set.
 *
 * WHY SVG FROM OUR OWN GEOMETRY and not a static tile render: the geometry is on
 * disk for every built map, needs no key, no licence question and no fetch, and
 * the picture stays byte-stable for the same inputs. The cost is that it shows
 * streets and the river only; a customer who cannot find a place can still use the
 * name in the table.
 *
 * CROWDING. Places in one parade of shops sit a few metres apart. A disc whose
 * centre falls within one diameter of an earlier disc is moved outward on a ring
 * and joined to its true position by a thin leader line, so every number stays
 * readable and the true spot is still marked by a dot. The order is the list's own
 * order, so the same input draws the same picture.
 *
 * Usage — every path is a real path, not a placeholder; --map is relative to --buses:
 *   node poi_shortlist_map.js --map "Areas/March"
 *   node poi_shortlist_map.js --map "Areas/March" --out "<a path ending .svg>"
 *   --map    <dir>   the map folder, relative to --buses; its poi-shortlist.json is read
 *   --buses  <dir>   the buses-data checkout; then $BUSES_DIR, then the laptop (cli.js)
 *   --list   <path>  the shortlist json (default <map>/poi-shortlist.json)
 *   --out    <path>  the svg to write (default <map>/poi-shortlist.svg)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveBuses } = require('./cli');

const W = 1400, H = 990, MARGIN = 60, R = 15;   // page 1400 x 990 (A4 landscape ratio), disc radius 15
const ROAD = { trunk: 3.2, primary: 3.2, secondary: 2.6, tertiary: 2.0, unclassified: 1.5, residential: 1.2, living_street: 1.0 };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = n => (Math.round(n * 10) / 10).toString();

/* The frame: the listed places' bounding box, padded, then widened to the page ratio
 * so nothing is stretched. Longitude is scaled by cos(latitude): a degree of
 * longitude is shorter than a degree of latitude, and a circle on the ground must
 * stay a circle. Returns the projector and the ground bbox it covers. */
function frame(lls) {
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  for (const [la, lo] of lls) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const k = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  let gw = Math.max((lo1 - lo0) * k, 1e-4), gh = Math.max(la1 - la0, 1e-4);
  const innerW = W - 2 * MARGIN, innerH = H - 2 * MARGIN;
  const s = Math.min(innerW / gw, innerH / gh) * 0.92;   // 8% air round the outermost places
  const cx = ((lo0 + lo1) / 2) * k, cy = (la0 + la1) / 2;
  const project = ([la, lo]) => [W / 2 + (lo * k - cx) * s, H / 2 - (la - cy) * s];
  const unproject = ([x, y]) => [cy - (y - H / 2) / s, (cx + (x - W / 2) / s) / k];
  return { project, unproject };
}

/* Move a crowded disc out. `placed` is the discs already drawn ([x,y]); returns the
 * disc centre for a point at `p`. A point with room is left where it is. Otherwise
 * ring after ring of eight candidate angles is tried, starting one diameter out, and
 * the first clear one wins. Pure and deterministic. */
function nudge(p, placed, r = R) {
  const clear = c => placed.every(q => Math.hypot(q[0] - c[0], q[1] - c[1]) >= 2 * r + 2);
  if (clear(p)) return p;
  for (let ring = 1; ring <= 12; ring++) {
    const d = ring * (2 * r + 2);
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * 2 * Math.PI + (ring % 2 ? 0 : Math.PI / 8);
      const c = [p[0] + d * Math.cos(th), p[1] + d * Math.sin(th)];
      if (c[0] > r && c[0] < W - r && c[1] > r && c[1] < H - r && clear(c)) return c;
    }
  }
  return p;
}

/* The streets and the river as paths, clipped to the page. Only a way with a
 * point on the page is drawn. */
function ground(roads, river, project) {
  const onPage = pts => pts.some(([x, y]) => x > -50 && x < W + 50 && y > -50 && y < H + 50);
  const d = pts => 'M' + pts.map(([x, y]) => f1(x) + ' ' + f1(y)).join('L');
  const out = [];
  const rank = w => ROAD[(w.tags || {}).highway];
  const ways = (roads && roads.ways ? roads.ways : []).filter(w => w.geometry && rank(w)).sort((a, b) => rank(a) - rank(b));
  for (const w of ways) {
    const pts = w.geometry.map(project);
    if (onPage(pts)) out.push('<path d="' + d(pts) + '" fill="none" stroke="#b9b9b9" stroke-width="' + rank(w) + '" stroke-linecap="round" stroke-linejoin="round"/>');
  }
  for (const line of (river || [])) {
    const pts = line.map(project);
    if (onPage(pts)) out.push('<path d="' + d(pts) + '" fill="none" stroke="#8fc1e3" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>');
  }
  return out;
}

/* The pure half: the numbered list and the ground in, an SVG string out.
 * `list` is poi-shortlist.json's `list` ({n, key, name, ll}); a row with no `ll` is
 * reported in `missing` and left off the picture. */
function render(title, list, roads, river) {
  const rows = list.filter(r => Array.isArray(r.ll));
  const missing = list.filter(r => !Array.isArray(r.ll)).map(r => r.n);
  if (!rows.length) return { svg: null, missing };
  const { project } = frame(rows.map(r => r.ll));
  const out = [];
  out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" font-family="Arial, Helvetica, sans-serif">');
  out.push('<title>' + esc(title) + '</title>');
  out.push('<defs><clipPath id="page"><rect width="' + W + '" height="' + H + '"/></clipPath></defs>');
  out.push('<rect width="' + W + '" height="' + H + '" fill="#f7f5f0"/>');
  out.push('<g clip-path="url(#page)">');
  out.push(...ground(roads, river, project));
  const placed = [], dots = [], leaders = [], discs = [];
  for (const r of rows) {
    const p = project(r.ll), c = nudge(p, placed);
    placed.push(c);
    dots.push('<circle cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="3" fill="#c0392b"/>');
    if (c !== p) leaders.push('<line x1="' + f1(p[0]) + '" y1="' + f1(p[1]) + '" x2="' + f1(c[0]) + '" y2="' + f1(c[1]) + '" stroke="#c0392b" stroke-width="1.2"/>');
    discs.push('<g><circle cx="' + f1(c[0]) + '" cy="' + f1(c[1]) + '" r="' + R + '" fill="#c0392b" stroke="#fff" stroke-width="2"/>'
      + '<text x="' + f1(c[0]) + '" y="' + f1(c[1] + 5.5) + '" text-anchor="middle" font-size="' + (r.n > 99 ? 11 : 15) + '" font-weight="bold" fill="#fff">' + r.n + '</text></g>');
  }
  out.push(...leaders, ...dots, ...discs);
  out.push('</g>');
  out.push('<text x="' + MARGIN / 2 + '" y="' + (H - 16) + '" font-size="14" fill="#555">' + esc(title)
    + ' — the red dot is the place; the numbers match the list. Streets and river from OpenStreetMap.</text>');
  out.push('</svg>');
  return { svg: out.join('\n') + '\n', missing };
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function main() {   // OA-344: the body is guarded, not re-indented — see test/asset_load.test.js
  const F = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) F[argv[i].slice(2)] = argv[++i];
  if (!F.map) { console.error('poi_shortlist_map: --map "<folder under the buses checkout>" is required'); process.exit(1); }
  const BUSES = resolveBuses(F);
  const mapDir = path.isAbsolute(F.map) ? F.map : path.join(BUSES, F.map);
  const listPath = F.list || path.join(mapDir, 'poi-shortlist.json');
  const doc = readJson(listPath);
  if (!doc || !Array.isArray(doc.list)) { console.error('poi_shortlist_map: no shortlist at ' + listPath + ' — run poi_shortlist.js on this map first'); process.exit(1); }
  const { load } = require('./poi_shortlist.js');
  const M = load(mapDir);
  if (!M) { console.error('poi_shortlist_map: no osm.json under ' + mapDir); process.exit(1); }
  const byKey = new Map(M.pois.map(p => [p.cat + ':' + p.name, p.ll]));
  const list = doc.list.map(r => Object.assign({}, r, { ll: byKey.get(r.key) }));
  const geo = path.join(mapDir, 'ci-reference');
  const roads = readJson(path.join(geo, 'roads_geo.json')) || readJson(path.join(mapDir, 'S2-geometry', 'roads_geo.json'));
  const river = readJson(path.join(geo, 'river_geo.json')) || readJson(path.join(mapDir, 'S2-geometry', 'river_geo.json'));
  const R_ = render(doc.map || path.basename(mapDir), list, roads, river);
  if (!R_.svg) { console.error('poi_shortlist_map: no listed place has a coordinate'); process.exit(1); }
  const out = F.out || path.join(mapDir, 'poi-shortlist.svg');
  fs.writeFileSync(out, R_.svg);
  console.log('poi_shortlist_map: ' + (list.length - R_.missing.length) + ' of ' + list.length + ' places drawn'
    + (roads ? '' : ' (no roads_geo.json: places on a blank page)'));
  if (R_.missing.length) console.log('  no coordinate for number(s): ' + R_.missing.join(', '));
  console.log('  written   : ' + out);
}

if (require.main === module) main();
module.exports = { main, render, frame, nudge };
