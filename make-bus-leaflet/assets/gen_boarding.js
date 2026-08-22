#!/usr/bin/env node
/*
 * gen_boarding.js — the "Where to catch your bus in <place>" sheet.
 *
 * WHY THIS EXISTS. The town and place sheets both answer "where do the buses go".
 * Neither answers the question a passenger standing in a bus station actually has,
 * which is the inverse: "I have decided to go to Bedford — which of these five
 * identically-named stops do I stand at?" This is the third sheet from
 * Development Docs/boarding-plan-product_2026-08-22.md, and its rule 1 is the whole
 * layout brief: two halves, and THE INDEX IS THE PRODUCT. The map is the locator;
 * the index is what answers the question, so the index gets the page and the map
 * gets the corner.
 *
 * WHAT IT IS NOT. Not a route map — no route lines are drawn at all. A reader who
 * already knows their route number does not need this sheet (rule 2), and drawing
 * ribbons here would re-answer the question the other two sheets already answer
 * while crowding out the one this sheet exists for.
 *
 * THE INDEX IS KEYED ON DESTINATION, ALPHABETICALLY (rule 2) — the single biggest
 * differentiator from the published field, and the standing criticism of spider
 * maps: they show where the buses want to go, not where the reader wants to go.
 * `Ramsey -> 301 -> Bay 1` is the row.
 *
 * TWO CLASSES OF BOARDING POINT, both printed verbatim from NaPTAN (rule 3: the
 * letter must match the flag, and a letter we invented is worse than none):
 *   'stand'  the flag carries a code    -> "Bay 4"
 *   'named'  the flag carries a name    -> "The Busway, Station Road"
 * The second class is not a compromise, it is the same rule applied to a BCT flag,
 * and at St Ives it is load-bearing: routes A and B are the busiest services here
 * and their CAMBRIDGE direction never enters the bus station at all. See
 * naptan_stands.py's header for the trace. A sheet that drew only the lettered bays
 * would send every Cambridge passenger to a bay no Cambridge bus stops at.
 *
 * INPUTS, all from the current directory:
 *   routes.json          config; MUST carry a `boardingPlan` block or this declines
 *   stands.json          naptan_stands.py --write
 *   boarding_index.json  boarding_index.py --write
 *   place.json           the anchor
 *   osm.json             POIs for the locator (optional but wanted)
 *   roads_geo.json       street skeleton from pull_roads.js (optional)
 * Output: boarding.svg, A4 landscape at the shared 3508x2480 raster size.
 *
 * DECLINING IS A FEATURE (paper sec 5). No `boardingPlan` key, or a stands verdict
 * other than OK, and this writes nothing and exits non-zero — the same posture the
 * portal's `requiresConfig` gate gives an output whose config key is absent, which
 * is why the portal side of this is a table entry rather than new code.
 *
 * Invariants (changing-the-engine.md sec 1): no network, no Math.random, no Date,
 * no locale-dependent sorting. Same input, same bytes.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FOOTER = require(path.join(__dirname, 'footer.js'));
const ICONS = require(path.join(__dirname, 'icons.js'));
const FM = require(path.join(__dirname, 'font_metrics.js'));

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const DIR = path.resolve(val('--dir', '.'));
const OUT = val('--out', 'boarding.svg');

const rd = (f, optional) => {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) {
    if (optional) return null;
    console.error(`gen_boarding: missing required input ${f} in ${DIR}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

const RJ = rd('routes.json');
const STANDS = rd('stands.json');
const INDEX = rd('boarding_index.json');
const PLACE = rd('place.json');
const OSM = rd('osm.json', true);
const ROADS = rd('roads_geo.json', true);

const BP = RJ.boardingPlan;
if (!BP) {
  console.error('gen_boarding: routes.json has no `boardingPlan` block — declining.');
  console.error('  This is the intended behaviour, not a failure: the sheet is gated on that key');
  console.error('  exactly as the portal gates an output on `requiresConfig`. Add the block to');
  console.error('  offer the sheet for this place.');
  process.exit(3);
}
if (STANDS.verdict !== 'OK') {
  console.error(`gen_boarding: stands.json verdict is ${STANDS.verdict} — declining.`);
  console.error('  At least one boardable stop in the frame can be identified neither by a stand');
  console.error('  code nor by a name unique here, so no honest instruction can be printed.');
  process.exit(3);
}

/* ------------------------------------------------------------------ page */
// Millimetres throughout, as every other generator does; the raster size is the
// shared 3508x2480 (A4 landscape at 300 dpi) so render.js needs no special case.
const W = 297, H = 210;
const SAFE = 8;                       // print-safe margin, matches footer.js
// PRINT LEGIBILITY FLOOR. quality_metrics.js counts EVERY text element below
// 2.4 mm as a hard defect, so a sheet with 84 small labels scores 84 defects
// from one careless default — which is exactly what the first cut of this file
// did (HARD 87 against 3 real faults). Nothing here may be set smaller.
const MIN_TEXT = 2.4;
const parts = [];
const out = (s) => parts.push(s);
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f2 = (n) => (Math.round(n * 100) / 100).toString();

/* --------------------------------------------------------------- palette */
const INK = '#1d2125';
const INK_SOFT = '#5a6169';
const RULE = '#c9cfd5';
const PLATE = '#f2f4f6';
const STAND_INK = '#14304f';          // lettered bay marker
const NAMED_INK = '#7a4a12';          // named on-street stop marker — deliberately a
                                      // different hue, because they are different things

const PAL = RJ.palette || {};
const TEXT_ON = RJ.textOn || {};
const colourOf = (r) => PAL[r] || '#66707a';
const textOnOf = (r) => TEXT_ON[r] || '#ffffff';

/* ----------------------------------------------------- route group display */
// The 301 family (301/301S/301V/301X) is one service to a reader; printing four
// near-identical numbers in a 14mm column is noise. routeGroups collapses them for
// DISPLAY only — the underlying index keeps every variant, so the verifier still
// checks each one against NaPTAN.
const GROUPS = BP.routeGroups || {};
const groupOf = {};
for (const [parent, kids] of Object.entries(GROUPS)) for (const k of kids) groupOf[k] = parent;
function displayRoutes(routes) {
  const seen = [];
  for (const r of routes) {
    const g = groupOf[r] || r;
    if (!seen.includes(g)) seen.push(g);
  }
  return seen;
}

/* --------------------------------------------------------------- the data */
const HIDE_EMPTY = BP.hideStandsWithNoDestinations !== false;
// A stop that is never the best boarding point for anything is not a boarding point.
// At St Ives that is Cromwell Pl: every bus calling there also calls somewhere nearer
// the anchor, so sending a reader 182 m up the road would be actively worse advice.
const standsAll = INDEX.stands || [];
const stands = HIDE_EMPTY ? standsAll.filter(s => (s.destinations || []).length) : standsAll;
const dests = (INDEX.destinations || []).slice()
  .sort((a, b) => (a.destination.toLowerCase() < b.destination.toLowerCase() ? -1
                 : a.destination.toLowerCase() > b.destination.toLowerCase() ? 1 : 0));

if (!stands.length) { console.error('gen_boarding: no stands with destinations — nothing to draw.'); process.exit(1); }
if (!dests.length) { console.error('gen_boarding: the index is empty — nothing to draw.'); process.exit(1); }

/* ------------------------------------------------------------------ title */
const TITLE = BP.title || `Where to catch your bus in ${PLACE.name || ''}`.trim();
const SUBTITLE = BP.subtitle || '';

out(`<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 ${W} ${H}">`);
out(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
out(`<g font-family="Arial, Helvetica, sans-serif">`);

let y = SAFE + 6.6;
out(`<text x="${SAFE}" y="${f2(y)}" font-size="8.4" font-weight="bold" fill="${INK}">${esc(TITLE)}</text>`);
if (SUBTITLE) {
  y += 5.0;
  out(`<text x="${SAFE}" y="${f2(y)}" font-size="3.9" fill="${INK_SOFT}">${esc(SUBTITLE)}</text>`);
}
const HEAD_Y = y + 3.4;
out(`<line x1="${SAFE}" y1="${f2(HEAD_Y)}" x2="${W - SAFE}" y2="${f2(HEAD_Y)}" stroke="${RULE}" stroke-width="0.5"/>`);

/* =========================================================== LOCATOR MAP */
// Left column. Deliberately the smaller half: it exists to get the reader from
// "Bay 4" on the page to Bay 4 in the street, and nothing more.
const MAP_X0 = SAFE, MAP_X1 = 104;
const MAP_Y0 = HEAD_Y + 4, MAP_Y1 = 150;

// Projection: equirectangular about the anchor, which is exact enough over 250 m
// and keeps the maths auditable. Fit to the stands plus the POIs actually drawn.
const PLAT = PLACE.lat, PLON = PLACE.lon;
const KX = 111320 * Math.cos(PLAT * Math.PI / 180), KY = 111320;
const distM = (la, lo) => Math.hypot((la - PLAT) * KY, (lo - PLON) * KX);

// FIT TO THE STANDS, NOT TO THE POIs — the mistake the first cut made. The bays
// here are 11 to 22 m from the anchor and the landmarks are up to 190 m away, so
// fitting the landmarks squashed all four boarding points into one illegible blob:
// the sheet's whole subject rendered as a smudge so that a hotel 190 m away could
// be on the page. The frame is therefore driven by the stands, grown to a stated
// minimum so a single-bay place does not zoom to absurdity, and the landmarks are
// guests: drawn if they fall inside, dropped if they do not.
const MIN_SPAN_M = 118;
let minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
for (const s of stands) {
  if (!s.pos) continue;
  const [la, lo] = s.pos;
  if (la < minLa) minLa = la; if (la > maxLa) maxLa = la;
  if (lo < minLo) minLo = lo; if (lo > maxLo) maxLo = lo;
}
if (!isFinite(minLa)) { minLa = maxLa = PLAT; minLo = maxLo = PLON; }
minLa = Math.min(minLa, PLAT); maxLa = Math.max(maxLa, PLAT);
minLo = Math.min(minLo, PLON); maxLo = Math.max(maxLo, PLON);
// grow to the minimum span, about the centre of what we have
{
  const cLa = (minLa + maxLa) / 2, cLo = (minLo + maxLo) / 2;
  const halfLa = Math.max((maxLa - minLa) / 2, (MIN_SPAN_M / 2) / KY);
  const halfLo = Math.max((maxLo - minLo) / 2, (MIN_SPAN_M / 2) / KX);
  minLa = cLa - halfLa * 1.18; maxLa = cLa + halfLa * 1.18;
  minLo = cLo - halfLo * 1.18; maxLo = cLo + halfLo * 1.18;
}
// Match the frame's aspect to the box's, by GROWING the under-used axis. Fitting
// by the tighter axis alone left the map 139 m wide and 139 m tall inside a box
// that is 96 x 125 mm, so a third of the panel was blank while context sat just
// off the top and bottom edges. Growing never changes the scale the bays are
// drawn at, which is the one thing that must not move.
{
  const boxAR = ((MAP_X1 - MAP_X0)) / ((MAP_Y1 - MAP_Y0));
  const sx = (maxLo - minLo) * KX, sy = (maxLa - minLa) * KY;
  if (sx / sy > boxAR) {
    const want = sx / boxAR, grow = (want - sy) / 2 / KY;
    minLa -= grow; maxLa += grow;
  } else {
    const want = sy * boxAR, grow = (want - sx) / 2 / KX;
    minLo -= grow; maxLo += grow;
  }
}
const inFrame = (la, lo) => la >= minLa && la <= maxLa && lo >= minLo && lo <= maxLo;

const poi = [];
if (OSM && Array.isArray(OSM.elements)) {
  for (const e of OSM.elements) {
    if (e.lat == null || !e.tags || !e.tags.name) continue;
    if (!inFrame(e.lat, e.lon)) continue;
    poi.push({ lat: e.lat, lon: e.lon, name: e.tags.name, tags: e.tags, d: distM(e.lat, e.lon) });
  }
}
poi.sort((a, b) => a.d - b.d);

const spanX = (maxLo - minLo) * KX, spanY = (maxLa - minLa) * KY;
const boxW = MAP_X1 - MAP_X0, boxH = MAP_Y1 - MAP_Y0;
const scale = Math.min(boxW / spanX, boxH / spanY);
const cx = (minLo + maxLo) / 2, cy = (minLa + maxLa) / 2;
const px = (lon) => (MAP_X0 + boxW / 2) + (lon - cx) * KX * scale;
const py = (lat) => (MAP_Y0 + boxH / 2) - (lat - cy) * KY * scale;

out(`<rect x="${f2(MAP_X0)}" y="${f2(MAP_Y0)}" width="${f2(boxW)}" height="${f2(boxH)}" fill="${PLATE}" stroke="${RULE}" stroke-width="0.4" rx="1.5"/>`);
out(`<clipPath id="mapclip"><rect x="${f2(MAP_X0)}" y="${f2(MAP_Y0)}" width="${f2(boxW)}" height="${f2(boxH)}" rx="1.5"/></clipPath>`);
out(`<g clip-path="url(#mapclip)">`);

// Streets, if pull_roads.js has run — context only, so they stay very quiet.
// roads_geo.json is {bbox, ways:[{geometry:[[lat,lon],…], tags}]}, NOT a bare
// array: the first cut assumed the latter, found nothing iterable and silently
// drew no streets at all, which on a locator map reads as "this place has no
// roads" rather than as a bug.
const ROAD_WAYS = (ROADS && Array.isArray(ROADS.ways)) ? ROADS.ways : [];
function roadPath(w) {
  const line = w && w.geometry;
  if (!Array.isArray(line) || line.length < 2) return '';
  let any = false;
  const d = line.map((pt, i) => {
    const la = Array.isArray(pt) ? pt[0] : pt.lat, lo = Array.isArray(pt) ? pt[1] : pt.lon;
    if (la == null || lo == null) return '';
    if (inFrame(la, lo)) any = true;
    return `${i ? 'L' : 'M'}${f2(px(lo))} ${f2(py(la))}`;
  }).join(' ');
  return any ? d : '';
}
const drawnRoads = ROAD_WAYS.map(roadPath).filter(Boolean);
for (const d of drawnRoads) out(`<path d="${d}" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`);
for (const d of drawnRoads) out(`<path d="${d}" fill="none" stroke="#e3e8ed" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`);

// POIs — landmarks are how people navigate at this scale (rule 6)
const ICON_FOR = { supermarket: 'shop', library: 'library', townhall: 'townhall',
                   place_of_worship: 'community', parking: 'community', pharmacy: 'pharmacy',
                   pub: 'community', hotel: 'community', memorial: 'museum' };
// Landmark labels are placed with a simple occupancy check rather than dropped on
// top of one another. The stand markers are stamped in FIRST and are immovable —
// a landmark name over a bay number would obscure the one thing the sheet exists
// to show — and any landmark whose name cannot find clear air is drawn as an
// unlabelled pictogram rather than not drawn at all.
const taken = [];
const hits = (b) => taken.some(t => !(b.x1 < t.x0 || b.x0 > t.x1 || b.y1 < t.y0 || b.y0 > t.y1));
const claim = (b) => taken.push(b);
for (const s of stands) {
  if (!s.pos) continue;
  const X = px(s.pos[1]), Y = py(s.pos[0]), r = (s.class === 'stand' ? 4.2 : 3.0);
  claim({ x0: X - r, x1: X + r, y0: Y - r, y1: Y + r });
}
// STREET NAMES ARE THE CONTEXT AT THIS SCALE, not distant shops. The frame here is
// about 130 m across, chosen so that two bays 7.5 m apart are separately legible —
// and at that zoom the nearest supermarket is off the page. Naming the streets is
// what actually helps: "Bay 4, on Market Road" is a findable instruction, and
// NaPTAN already gives every stop its Street. Drawn before the landmarks so that
// where the two compete the street wins.
const streetSeen = new Set();
for (const w of ROAD_WAYS) {
  const nm = w && w.tags && w.tags.name;
  if (!nm || streetSeen.has(nm)) continue;
  const line = w.geometry;
  if (!Array.isArray(line) || line.length < 2) continue;
  // the segment midpoint that is furthest inside the frame
  let best = null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const mla = (a[0] + b[0]) / 2, mlo = (a[1] + b[1]) / 2;
    if (!inFrame(mla, mlo)) continue;
    const edge = Math.min(mla - minLa, maxLa - mla) / (maxLa - minLa)
               + Math.min(mlo - minLo, maxLo - mlo) / (maxLo - minLo);
    let ang = Math.atan2(-(b[0] - a[0]) * KY, (b[1] - a[1]) * KX) * 180 / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    if (!best || edge > best.edge) best = { mla, mlo, ang, edge };
  }
  if (!best) continue;
  const X = px(best.mlo), Y = py(best.mla);
  const size = MIN_TEXT, tw = FM.textWidth(nm, size, false);
  const rad = best.ang * Math.PI / 180;
  const hw = Math.abs(Math.cos(rad)) * tw / 2 + Math.abs(Math.sin(rad)) * size / 2;
  const hh = Math.abs(Math.sin(rad)) * tw / 2 + Math.abs(Math.cos(rad)) * size / 2;
  const box = { x0: X - hw, x1: X + hw, y0: Y - hh, y1: Y + hh };
  if (box.x0 < MAP_X0 + 0.5 || box.x1 > MAP_X1 - 0.5) continue;
  if (box.y0 < MAP_Y0 + 0.5 || box.y1 > MAP_Y1 - 0.5) continue;
  if (hits(box)) continue;
  claim(box);
  streetSeen.add(nm);
  out(`<g transform="translate(${f2(X)} ${f2(Y)}) rotate(${f2(best.ang)})">`
    + `<text x="0" y="0.7" font-size="${size}" fill="#8d959c" text-anchor="middle">${esc(nm)}</text></g>`);
}

let poiLabelled = 0, poiBare = 0;
for (const p of poi) {
  const kind = p.tags.shop || p.tags.amenity || p.tags.tourism || p.tags.historic || '';
  const cat = ICON_FOR[kind] || 'community';
  const X = px(p.lon), Y = py(p.lat);
  if (X < MAP_X0 + 1 || X > MAP_X1 - 1 || Y < MAP_Y0 + 1 || Y > MAP_Y1 - 1) continue;
  const icoBox = { x0: X - 2, x1: X + 2, y0: Y - 2, y1: Y + 2 };
  if (hits(icoBox)) continue;               // symbol itself has nowhere to sit
  out(ICONS.icon(cat, X, Y, 1.7, 'charcoal'));
  claim(icoBox);
  const size = MIN_TEXT, tw = FM.textWidth(p.name, size, false);
  const cands = [
    { x: X + 2.6, a: 'start', y: Y + 0.8 },
    { x: X - 2.6, a: 'end', y: Y + 0.8 },
    { x: X, a: 'middle', y: Y - 3.0 },
    { x: X, a: 'middle', y: Y + 4.4 },
  ];
  let placed = null;
  for (const c of cands) {
    const x0 = c.a === 'start' ? c.x : c.a === 'end' ? c.x - tw : c.x - tw / 2;
    const b = { x0, x1: x0 + tw, y0: c.y - size, y1: c.y + 0.8 };
    if (b.x0 < MAP_X0 + 0.5 || b.x1 > MAP_X1 - 0.5) continue;
    if (hits(b)) continue;
    placed = { c, b }; break;
  }
  if (placed) {
    claim(placed.b);
    out(`<text x="${f2(placed.c.x)}" y="${f2(placed.c.y)}" font-size="${size}" fill="#4a5158" text-anchor="${placed.c.a}">${esc(p.name)}</text>`);
    poiLabelled++;
  } else {
    poiBare++;
  }
}

/* ------------------------------------------------- the stand markers */
// The whole point of the locator. Big, high contrast, and carrying the SAME string
// the index prints and the flag in the street shows.
function standMarker(s) {
  if (!s.pos) return;
  const X = px(s.pos[1]), Y = py(s.pos[0]);
  const isStand = s.class === 'stand';
  const fill = isStand ? STAND_INK : NAMED_INK;
  // A lettered bay gets the code alone in a disc; a named stop gets a smaller disc
  // and its name beside it, because the name is too long to sit inside one.
  const short = isStand ? String(s.label).replace(/^(Bay|Stand|Stop|Gate|Platform|Stance|Berth)\s+/i, '') : '';
  if (isStand) {
    const r = 3.0;
    out(`<circle cx="${f2(X)}" cy="${f2(Y)}" r="${f2(r + 0.7)}" fill="#ffffff"/>`);
    out(`<circle cx="${f2(X)}" cy="${f2(Y)}" r="${f2(r)}" fill="${fill}"/>`);
    out(`<text class="bstand" x="${f2(X)}" y="${f2(Y + 1.55)}" font-size="4.4" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(short)}</text>`);
  } else {
    const r = 2.3;
    out(`<circle cx="${f2(X)}" cy="${f2(Y)}" r="${f2(r + 0.7)}" fill="#ffffff"/>`);
    out(`<circle cx="${f2(X)}" cy="${f2(Y)}" r="${f2(r)}" fill="${fill}"/>`);
    out(`<circle cx="${f2(X)}" cy="${f2(Y)}" r="1.0" fill="#ffffff"/>`);
  }
}
for (const s of stands) standMarker(s);

// the anchor itself, drawn last and small — "you are here"
out(`<circle cx="${f2(px(PLON))}" cy="${f2(py(PLAT))}" r="1.1" fill="none" stroke="${INK}" stroke-width="0.5"/>`);
out(`</g>`);

// north arrow — a plan that is north-up must say so (rule 7's other half)
const NX = MAP_X1 - 6, NY = MAP_Y0 + 8;
out(`<g stroke="${INK}" stroke-width="0.45" fill="${INK}">`);
out(`<line x1="${f2(NX)}" y1="${f2(NY)}" x2="${f2(NX)}" y2="${f2(NY - 5)}"/>`);
out(`<path d="M${f2(NX)} ${f2(NY - 6.4)} l1.5 2.2 l-3 0 z" stroke="none"/>`);
out(`</g>`);
out(`<text x="${f2(NX)}" y="${f2(NY + 2.9)}" font-size="2.5" fill="${INK}" text-anchor="middle">N</text>`);

/* ------------------------------------------- the stand key under the map */
let ky = MAP_Y1 + 5.0;
out(`<text x="${SAFE}" y="${f2(ky)}" font-size="3.4" font-weight="bold" fill="${INK}">The stops</text>`);
ky += 4.2;
for (const s of stands) {
  const isStand = s.class === 'stand';
  const short = isStand ? String(s.label).replace(/^(Bay|Stand|Stop|Gate|Platform|Stance|Berth)\s+/i, '') : '';
  const cxk = SAFE + 2.6;
  if (isStand) {
    out(`<circle cx="${f2(cxk)}" cy="${f2(ky - 1.0)}" r="2.6" fill="${STAND_INK}"/>`);
    out(`<text class="bstand" x="${f2(cxk)}" y="${f2(ky + 0.15)}" font-size="3.3" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(short)}</text>`);
  } else {
    out(`<circle cx="${f2(cxk)}" cy="${f2(ky - 1.0)}" r="1.9" fill="${NAMED_INK}"/>`);
    out(`<circle cx="${f2(cxk)}" cy="${f2(ky - 1.0)}" r="0.8" fill="#ffffff"/>`);
  }
  // "here" was wrong for the one stop it mattered most for: The Busway Station Road
  // is 47 m away and OUTSIDE the bus station, and telling a Cambridge passenger they
  // are already there is the specific error this sheet exists to prevent. Print the
  // measured distance and let the reader judge.
  const walk = s.distM <= 30 ? 'in the bus station'
             : `${s.distM} m walk, about ${s.walkMin} min`;
  const facing = s.facing ? `, buses face ${s.facing}` : '';
  out(`<text x="${f2(cxk + 4.6)}" y="${f2(ky)}" font-size="3.1" fill="${INK}">${esc(s.label)}</text>`);
  out(`<text x="${f2(cxk + 4.6)}" y="${f2(ky + 3.4)}" font-size="2.5" fill="${INK_SOFT}">${esc(walk + facing)}</text>`);
  ky += 8.2;
}

/* ================================================================= INDEX */
// The product. Alphabetical by destination, three columns.
const IX0 = MAP_X1 + 6, IX1 = W - SAFE;
const IY0 = HEAD_Y + 4;
const IY1 = 186;

out(`<text x="${f2(IX0)}" y="${f2(IY0 + 3.2)}" font-size="4.0" font-weight="bold" fill="${INK}">${esc(BP.indexHeading || 'Where to board, by destination')}</text>`);

// TWO COLUMNS, not three, and the reason is the BOARD AT cell. Three columns left
// it 10.8 mm wide, which is fine for "4" and useless for "The Busway Station Road"
// — it rendered as "The Buswa.", i.e. the sheet's one genuinely novel instruction
// truncated into nonsense. A boarding point that cannot be printed in full is not
// a boarding point, so the column count follows from the longest flag name rather
// than from how many rows would fit.
const COLS = 2;
const COL_GAP = 6.0;
const colW = ((IX1 - IX0) - COL_GAP * (COLS - 1)) / COLS;
const HDR_H = 5.8;
const bodyTop = IY0 + 8.6;
// Balance the columns instead of filling the first one to the floor: 44 rows over
// three columns had filled column 1 with 33, column 2 with 11 and left column 3
// entirely blank.
const capacity = Math.floor((IY1 - bodyTop - HDR_H) / 4.35);
const perCol = Math.max(1, Math.ceil(dests.length / COLS));
const ROW_H = Math.min(6.4, Math.max(4.15, (IY1 - bodyTop - HDR_H) / Math.max(perCol, 1)));

// Column geometry: destination name, then route badges, then the boarding point.
// Sized from the longest flag name at the 2.4 mm floor, not from taste. Raising
// the type floor to clear the legibility check re-truncated 'The Busway Station
// Road' to 'The Busway Station Ro.' — the same fault the two-column layout was
// chosen to fix, reintroduced from the other direction. If a longer stop name
// ever appears, this widens again; it does not get to abbreviate.
const C_BOARD = colW - 33.0;   // the bay disc / stop name
const C_ROUTE = C_BOARD - 21.0;

function badge(x, yb, label, route, size) {
  const w = Math.max(4.6, FM.textWidth(label, size, true) + 2.0);
  const h = size + 1.3;
  out(`<rect x="${f2(x)}" y="${f2(yb - h + 1.1)}" width="${f2(w)}" height="${f2(h)}" rx="${f2(h / 2)}" fill="${colourOf(route)}"/>`);
  out(`<text x="${f2(x + w / 2)}" y="${f2(yb)}" font-size="${size}" font-weight="bold" fill="${textOnOf(route)}" text-anchor="middle">${esc(label)}</text>`);
  return w;
}

let overflow = 0;
for (let c = 0; c < COLS; c++) {
  const x0 = IX0 + c * (colW + COL_GAP);
  let ry = bodyTop;
  // column header
  out(`<text x="${f2(x0)}" y="${f2(ry)}" font-size="2.5" font-weight="bold" fill="${INK_SOFT}">TO</text>`);
  out(`<text x="${f2(x0 + C_ROUTE)}" y="${f2(ry)}" font-size="2.5" font-weight="bold" fill="${INK_SOFT}">BUS</text>`);
  out(`<text x="${f2(x0 + C_BOARD)}" y="${f2(ry)}" font-size="2.5" font-weight="bold" fill="${INK_SOFT}">BOARD AT</text>`);
  out(`<line x1="${f2(x0)}" y1="${f2(ry + 1.2)}" x2="${f2(x0 + colW)}" y2="${f2(ry + 1.2)}" stroke="${RULE}" stroke-width="0.4"/>`);
  ry += HDR_H;

  for (let i = 0; i < perCol; i++) {
    const idx = c * perCol + i;
    if (idx >= dests.length) break;
    const d = dests[idx];
    if (i % 2 === 1) {
      out(`<rect x="${f2(x0 - 0.8)}" y="${f2(ry - 3.1)}" width="${f2(colW + 1.0)}" height="${f2(ROW_H)}" fill="#f7f8fa"/>`);
    }
    // destination
    let name = d.destination;
    const maxNameW = C_ROUTE - 1.5;
    let ns = 2.95;
    while (FM.textWidth(name, ns, false) > maxNameW && ns - 0.05 >= MIN_TEXT - 1e-9) ns = Math.max(MIN_TEXT, +(ns - 0.05).toFixed(2));
    if (FM.textWidth(name, ns, false) > maxNameW) {
      while (name.length > 4 && FM.textWidth(name + '.', ns, false) > maxNameW) name = name.slice(0, -1);
      name += '.';
    }
    out(`<text x="${f2(x0)}" y="${f2(ry)}" font-size="${f2(ns)}" fill="${INK}">${esc(name)}</text>`);
    if (d.limited) {
      const lw = FM.textWidth(name, ns, false);
      out(`<text x="${f2(x0 + lw + 1.0)}" y="${f2(ry)}" font-size="${MIN_TEXT}" fill="${INK_SOFT}">ltd</text>`);
    }
    // route badges (grouped)
    let bx = x0 + C_ROUTE;
    const shown = displayRoutes(d.routes);
    for (const r of shown) {
      if (bx + 5.2 > x0 + C_BOARD - 1.0) {
        out(`<text x="${f2(bx)}" y="${f2(ry)}" font-size="${MIN_TEXT}" fill="${INK_SOFT}">+</text>`);
        break;
      }
      bx += badge(bx, ry, r, r, MIN_TEXT) + 0.8;
    }
    // boarding point
    const st = (INDEX.stands || []).find(s => s.atco === d.boardAtAtco);
    const isStand = st && st.class === 'stand';
    const short = isStand ? String(d.boardAt).replace(/^(Bay|Stand|Stop|Gate|Platform|Stance|Berth)\s+/i, '') : d.boardAt;
    if (isStand) {
      const bxc = x0 + C_BOARD + 2.2;
      out(`<circle cx="${f2(bxc)}" cy="${f2(ry - 1.0)}" r="2.3" fill="${STAND_INK}"/>`);
      out(`<text class="bstand" x="${f2(bxc)}" y="${f2(ry + 0.1)}" font-size="3.0" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(short)}</text>`);
    } else {
      const bxc = x0 + C_BOARD;
      out(`<circle cx="${f2(bxc + 1.6)}" cy="${f2(ry - 1.0)}" r="1.6" fill="${NAMED_INK}"/>`);
      out(`<circle cx="${f2(bxc + 1.6)}" cy="${f2(ry - 1.0)}" r="0.65" fill="#ffffff"/>`);
      let t = short, ts = 2.6;
      const room = colW - C_BOARD - 4.2;
      while (FM.textWidth(t, ts, false) > room && ts - 0.05 >= MIN_TEXT - 1e-9) ts = Math.max(MIN_TEXT, +(ts - 0.05).toFixed(2));
      if (FM.textWidth(t, ts, false) > room) {
        while (t.length > 3 && FM.textWidth(t + '.', ts, false) > room) t = t.slice(0, -1);
        t += '.';
      }
      out(`<text x="${f2(bxc + 3.8)}" y="${f2(ry)}" font-size="${f2(ts)}" fill="${INK}">${esc(t)}</text>`);
    }
    ry += ROW_H;
  }
}
overflow = Math.max(0, dests.length - COLS * perCol);
if (overflow > 0) {
  console.error(`gen_boarding: ${overflow} destination(s) did not fit and are NOT on the sheet.`);
  console.error('  An index that silently drops rows is the one failure this sheet cannot have.');
  console.error('  Widen the columns, drop a column, or set an explicit selection rule in');
  console.error('  boardingPlan (paper §5: "selected destinations" needs a stated rule).');
}

/* ---------------------------------------------------------------- legend */
const LGY = IY1 + 3.6;
out(`<text x="${f2(IX0)}" y="${f2(LGY)}" font-size="2.4" fill="${INK_SOFT}">${esc('ltd = a limited service, fewer than ' + (BP.limitedBelowPerWeek || 6) + ' journeys a week.')}</text>`);
if (BP.note) out(`<text x="${f2(IX0)}" y="${f2(LGY + 3.2)}" font-size="2.4" fill="${INK_SOFT}">${esc(BP.note)}</text>`);

/* ---------------------------------------------------------------- footer */
// `safe` is opt-in on footerBand and defaults to null, which leaves the credit
// 3 mm from the right trim — the exact fault the 2026-08-16 printSafe work fixed
// on all 21 town sheets. Omitting it here put this sheet's nearest ink at 3.41 mm
// and failed the quality metric's 5 mm edge rule on its first measurement.
const PRINT_SAFE = (RJ.design && RJ.design.printSafe != null) ? +RJ.design.printSafe : 5;
out(FOOTER.footerBand({
  notes: ['Service data from the Bus Open Data Service; stop names, bay numbers and bearings from NaPTAN (Open Government Licence v3.0).'],
  version: RJ.version || 'v1.0',
  validFrom: RJ.validFrom || 'Summer 2026',
  x0: SAFE, x1: W - SAFE, safe: PRINT_SAFE,
}));

out(`</g></svg>`);

fs.writeFileSync(path.join(DIR, OUT), parts.join('\n'));
console.log(`gen_boarding: wrote ${OUT} — ${dests.length} destination(s), ${stands.length} boarding point(s)`);
if (HIDE_EMPTY && standsAll.length !== stands.length) {
  const dropped = standsAll.filter(s => !(s.destinations || []).length).map(s => s.label);
  console.log(`  not drawn (never the nearest boarding point for anything): ${dropped.join(', ')}`);
}
process.exit(overflow > 0 ? 1 : 0);
