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
// GROUND CONTEXT for the locator — pull_locator.js. OPTIONAL, and the fallback is
// the point: absent, everything below is skipped and the sheet renders exactly as
// it did before this file existed, byte for byte. So a place built before the pull
// script existed still re-renders, and an Overpass outage costs context, not a sheet.
const LOC = rd('locator_geo.json', true);

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
// THE LOCATOR/INDEX SPLIT IS A BUDGET LINE, not a fixed one.  104 mm suits a
// sheet whose index is two columns wide; a town whose index needs three has to
// buy the width from somewhere, and the locator is where the slack is (at St
// Ives and St Neots the map box is largely empty grey).  Absent the key this is
// exactly 104, so every sheet built before this change is unmoved.
const MAP_X0 = SAFE, MAP_X1 = (BP.mapRightMm != null) ? +BP.mapRightMm : 104;
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

/* RANKING THE LANDMARKS. A jeweller 55 m away is nearer than the Boots 96 m away
 * and far less use for finding yourself, so the handful of amenity types people
 * genuinely navigate by go first, then named brands, then the rest by distance.
 * Applied to osm.json's entries too: left un-ranked they sorted purely by distance
 * and put "The Spirit of St Ives" — a sculpture, and the one landmark v1.2 printed
 * — ahead of the pub on the corner.
 */
const NAV_AMENITY = new Set(['pharmacy', 'bank', 'post_office', 'library', 'townhall',
  'place_of_worship', 'pub', 'cinema', 'theatre', 'toilets', 'marketplace', 'doctors']);
// A place people EAT AND DRINK in is a landmark; a jeweller the same distance away
// is not. Both are one anonymous `shop`/`amenity` tag to a nearest-first sort, which
// is how a 55 m jeweller kept beating the 62 m restaurant on the corner.
const EAT_DRINK = new Set(['restaurant', 'cafe', 'fast_food', 'bar']);
/* A NAMED THING INSIDE THE PLACE ITSELF OUTRANKS EVERYTHING OUTSIDE IT. "The
 * Octagon" is the shelter in the middle of St Ives bus station: it is the single
 * most useful mark on this sheet, and on rank alone it is a `building=shed` with
 * no function tag and lost its place to a jeweller across the road. Being inside
 * the polygon the sheet is about is a stronger claim than any tag, so it is tested
 * first and wins outright.
 */
function pointInRing(la, lo, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    if ((yi > la) !== (yj > la) && lo < (xj - xi) * (la - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
// THE ANCHOR IS NOT ALWAYS INSIDE ITS OWN PLACE. At a bus station it is: the
// geocoder returns the `amenity=bus_station` way and the anchor is its centroid.
// At St Neots, "Market Square" resolved to OSM way 26125963 — `highway=unclassified`,
// the ROAD of that name — while the square itself is way 301086229,
// `highway=pedestrian` + `area`, and the road runs along its southern edge. The
// anchor therefore sits 40 m OUTSIDE the precinct it is named after, and a
// point-in-polygon test alone finds the place has no shape at all.
//
// So an area is the place's if the anchor stands in it OR if it carries the place's
// own name. The name is ours — it comes from the config and place.json, not from a
// guess about the ground — and it is exact where a distance threshold would be a
// judgement call at precisely the wrong moment.
const PLACE_NAMES = new Set([PLACE.place, PLACE.name, RJ.placeShort, RJ.anchorLabel]
  .filter(Boolean).map(s => String(s).trim().toLowerCase()));
const ANCHOR_AREAS = (LOC && Array.isArray(LOC.areas))
  ? LOC.areas.filter(a => (a.kind === 'bus_station' || a.kind === 'pedestrian')
                          && (pointInRing(PLAT, PLON, a.geometry)
                              || PLACE_NAMES.has(String(a.name || '').trim().toLowerCase())))
  : [];
/* ...and being CLOSE ENOUGH TO SEE counts the same way, because OSM's polygons do
 * not honour the idea. "The Octagon" is the shelter people wait under, 24 m from
 * the anchor and plainly part of the bus station — and it is mapped as a separate
 * shed just OUTSIDE the bus_station way, so point-in-polygon alone still lost it
 * to a jeweller across the road. 40 m is the inner third of a ~130 m frame: near
 * enough that a reader standing at the bays can see the thing without walking.
 */
const NEAR_LANDMARK_M = (BP.locatorNearM != null) ? +BP.locatorNearM : 40;
const insideAnchorArea = (la, lo) =>
  distM(la, lo) <= NEAR_LANDMARK_M || ANCHOR_AREAS.some(a => pointInRing(la, lo, a.geometry));

const landmarkRankOf = (t) => {
  if (t.tourism === 'hotel' || t.tourism === 'museum') return 1;
  if (NAV_AMENITY.has(t.amenity)) return 1;
  if (t.shop === 'supermarket' || t.shop === 'convenience' || t.shop === 'department_store') return 1;
  if (EAT_DRINK.has(t.amenity)) return 2;
  if (t.brand) return 2;
  if (t.amenity || t.shop || t.tourism) return 3;
  // A named building with no function tag — "The Octagon" — is a pointable thing,
  // and often the best landmark of the lot; it is also where an OSM name that means
  // nothing to a passenger ends up, so it sits below the trading frontages.
  return 4;
};
const poi = [];
const poiSeen = new Set();
const addPoi = (lat, lon, name, tags, rank) => {
  if (lat == null || lon == null || !name) return;
  if (!inFrame(lat, lon)) return;
  const k = name.toLowerCase();
  if (poiSeen.has(k)) return;               // osm.json and locator_geo.json overlap
  poiSeen.add(k);
  poi.push({ lat, lon, name, tags: tags || {}, rank, d: distM(lat, lon) });
};
if (OSM && Array.isArray(OSM.elements)) {
  for (const e of OSM.elements) {
    if (!e.tags || !e.tags.name) continue;
    addPoi(e.lat, e.lon, e.tags.name, e.tags, landmarkRankOf(e.tags));
  }
}
/* NAMED SHOPFRONTS AND NAMED BUILDINGS ARE THE LANDMARKS AT THIS SCALE, and the
 * town-scale pull has none of them. overpass-pois.txt asks for supermarkets,
 * libraries, schools and surgeries — the landmarks of a TOWN map, and at St Ives
 * Bus Station the nearest one is 138 m away, off the frame. What is actually in
 * the frame is a parade of shops, a pub and the station's own octagon, and until
 * pull_locator.js none of it was fetched. That is why v1.2 printed exactly one
 * landmark, and why it was a sculpture nobody could name.
 *
 * `boardingPlan.locatorLandmarks` caps how many are even OFFERED to the placer
 * (default 6); the occupancy check then drops any that cannot find clear air, so
 * the printed number is usually smaller.
 */
if (LOC) {
  for (const p of (LOC.places || [])) addPoi(p.lat, p.lon, p.name, p.tags || {},
    insideAnchorArea(p.lat, p.lon) ? 0 : landmarkRankOf(p.tags || {}));
  // A named building is a landmark you can point at — "The Octagon" is the shelter
  // in the middle of this very bus station. Placed at the footprint's centroid.
  for (const b of (LOC.buildings || [])) {
    const t = b.tags || {}; if (!t.name) continue;
    const g = b.geometry; if (!Array.isArray(g) || !g.length) continue;
    let la = 0, lo = 0;
    for (const pt of g) { la += pt[0]; lo += pt[1]; }
    la /= g.length; lo /= g.length;
    addPoi(la, lo, t.name, t, insideAnchorArea(la, lo) ? 0 : landmarkRankOf(t));
  }
}
poi.sort((a, b) => (a.rank - b.rank) || (a.d - b.d));
const POI_MAX = (BP.locatorLandmarks != null) ? +BP.locatorLandmarks : 6;
if (poi.length > POI_MAX) poi.length = POI_MAX;

const spanX = (maxLo - minLo) * KX, spanY = (maxLa - minLa) * KY;
const boxW = MAP_X1 - MAP_X0, boxH = MAP_Y1 - MAP_Y0;
const scale = Math.min(boxW / spanX, boxH / spanY);
const cx = (minLo + maxLo) / 2, cy = (minLa + maxLa) / 2;
const px = (lon) => (MAP_X0 + boxW / 2) + (lon - cx) * KX * scale;
const py = (lat) => (MAP_Y0 + boxH / 2) - (lat - cy) * KY * scale;

out(`<rect x="${f2(MAP_X0)}" y="${f2(MAP_Y0)}" width="${f2(boxW)}" height="${f2(boxH)}" fill="${PLATE}" stroke="${RULE}" stroke-width="0.4" rx="1.5"/>`);
out(`<clipPath id="mapclip"><rect x="${f2(MAP_X0)}" y="${f2(MAP_Y0)}" width="${f2(boxW)}" height="${f2(boxH)}" rx="1.5"/></clipPath>`);
out(`<g clip-path="url(#mapclip)">`);

/* --------------------------------------------------- ground context (rule 6)
 * "I find it hard to envisage it on the ground at the moment" — Peter, on the
 * v1.2 sheet, 2026-08-23. The locator drew streets, four bay markers and one
 * landmark; it did not draw the place. At a ~130 m frame the thing that says
 * WHERE YOU ARE is the built fabric — the shape of the bus station you are
 * standing in, the buildings across the road, the car park behind you — and none
 * of it was in the data. pull_locator.js fetches it; this draws it.
 *
 * Everything here is BACKGROUND and is toned to stay background. The subject of
 * this sheet is four numbered discs, and a building layer that competes with them
 * has made the sheet worse, not better. Order is areas, then buildings, then the
 * streets on top — a street drawn under a footprint reads as a road going through
 * a building.
 */
const AREA_STYLE = {
  bus_station: { fill: '#e6ddcb', stroke: '#cbbb9d' },   // the apron: warm, so the
                                                        // place the sheet is about
                                                        // is the one shape that is
                                                        // not neutral grey
  parking:     { fill: '#eaedf0', stroke: '#d8dee4' },
  pedestrian:  { fill: '#edeff1', stroke: '#dde1e5' },
  green:       { fill: '#e4ebe2', stroke: '#d2ded0' },
};
// THE WARM TINT BELONGS TO THE PLACE, NOT TO THE TAG. It was keyed on
// `kind === 'bus_station'`, which is the same thing only for as long as every
// boarding plan is drawn at a bus station. St Neots Market Square is OSM way
// 301086229, `highway=pedestrian` + `area`, and it took the ordinary pedestrian
// grey — so the square the whole sheet is about was the one shape on the page with
// nothing to say it was there, while a car park two streets away read the same.
// ANCHOR_AREAS is already exactly "the area the anchor stands in", so use it.
const PLACE_STYLE = AREA_STYLE.bus_station;
const ANCHOR_AREA_IDS = new Set(ANCHOR_AREAS.map(a => a.id));
function polyD(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 3) return '';
  let any = false;
  const d = geometry.map((pt, i) => {
    const la = pt[0], lo = pt[1];
    if (la == null || lo == null) return '';
    if (inFrame(la, lo)) any = true;
    return `${i ? 'L' : 'M'}${f2(px(lo))} ${f2(py(la))}`;
  }).join(' ');
  return any ? d + ' Z' : '';
}
let drewAreas = 0, drewBuildings = 0;
if (LOC && Array.isArray(LOC.areas)) {
  // Largest first, so a car park inside a pedestrian precinct still shows.
  const ordered = LOC.areas.slice().sort((a, b) => b.geometry.length - a.geometry.length);
  for (const a of ordered) {
    const st = ANCHOR_AREA_IDS.has(a.id) ? PLACE_STYLE : AREA_STYLE[a.kind];
    if (!st) continue;
    const d = polyD(a.geometry); if (!d) continue;
    out(`<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="0.3"/>`);
    drewAreas++;
  }
}
if (LOC && Array.isArray(LOC.buildings)) {
  for (const b of LOC.buildings) {
    const d = polyD(b.geometry); if (!d) continue;
    out(`<path d="${d}" fill="#dfe3e8" stroke="#ccd3da" stroke-width="0.25"/>`);
    drewBuildings++;
  }
}

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
// A PICTOGRAM ONLY WHERE THERE IS A REAL ONE. The first cut mapped everything it
// did not recognise onto `community` (two figures), so a jeweller, a bookmaker, a
// building society, a pet charity and a bus shelter all printed the identical
// symbol six times on one small map — six marks that carried no information and
// competed with the four that carry all of it. Anything without a true glyph now
// gets a plain dot and lets its NAME do the work, which is what a reader reads
// anyway.
const ICON_FOR = { supermarket: 'shop', library: 'library', townhall: 'townhall',
                   place_of_worship: 'community', pharmacy: 'pharmacy',
                   doctors: 'gp', dentist: 'gp', school: 'school',
                   museum: 'museum', memorial: 'museum', park: 'park' };
// Landmark labels are placed with a simple occupancy check rather than dropped on
// top of one another. The stand markers are stamped in FIRST and are immovable —
// a landmark name over a bay number would obscure the one thing the sheet exists
// to show — and any landmark whose name cannot find clear air is drawn as an
// unlabelled pictogram rather than not drawn at all.
const taken = [];
const hits = (b) => taken.some(t => !(b.x1 < t.x0 || b.x0 > t.x1 || b.y1 < t.y0 || b.y0 > t.y1));
const claim = (b) => taken.push(b);

/* MARKERS THAT COLLIDE WITH EACH OTHER. The occupancy map below is stamped FROM the
 * markers, so it can say "no label over a bay number" and cannot say "no bay number
 * over a bay number". At St Ives the four bays are 11-47 m apart in a 130 m frame and
 * nothing touches; at St Neots two of the five discs touch (recorded, left open); at
 * High Wycombe the frame is 240 m wide because the two boarding areas are 230 m
 * apart, and Bays 15 and 18 - 12 m apart, so 4.4 mm on the page - printed one over
 * the other with "Bay 15" reading as "Bay 1".
 *
 * Deterministic relaxation: repeatedly push overlapping pairs apart along the line
 * between them, in the stands' own order, a fixed number of passes. A marker that
 * ends up more than a third of a millimetre from its true position draws a hairline
 * back to a dot there, so a moved marker still says where the stop actually is
 * rather than quietly relocating it. Absent any overlap nothing moves.
 */
const MK_R = (s) => (s.class === 'stand' ? 3.7 : 3.0);
const MPOS = new Map();
let markerMoveMax = { mm: 0, label: null };
{
  const items = stands.filter(s => s.pos).map(s => ({
    s, x: px(s.pos[1]), y: py(s.pos[0]), x0: px(s.pos[1]), y0: py(s.pos[0]), r: MK_R(s),
  }));
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const need = a.r + b.r;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= need - 1e-6) continue;
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; }        // exactly coincident: split on x
        const push = (need - d) / 2, ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const it of items) {
    it.x = Math.min(Math.max(it.x, MAP_X0 + it.r), MAP_X1 - it.r);
    it.y = Math.min(Math.max(it.y, MAP_Y0 + it.r), MAP_Y1 - it.r);
    MPOS.set(it.s.atco, it);
  }
  // A push smaller than the marker's own radius leaves the stop's true position under
  // its own disc, so the sheet is not claiming the wrong side of the street and no
  // leader is warranted. Past that it would be, so say so rather than move silently.
  for (const it of items) {
    const moved = Math.hypot(it.x - it.x0, it.y - it.y0);
    if (moved > MK_R(it.s)) {
      console.error(`gen_boarding: ${it.s.label} was moved ${moved.toFixed(1)} mm to stay legible,`);
      console.error('  which is further than its own marker; the locator frame is too wide for these stops.');
    }
    if (moved > markerMoveMax.mm) markerMoveMax = { mm: moved, label: it.s.label };
  }
}
for (const s of stands) {
  if (!s.pos) continue;
  const m = MPOS.get(s.atco);
  const X = m ? m.x : px(s.pos[1]), Y = m ? m.y : py(s.pos[0]), r = (s.class === 'stand' ? 4.2 : 3.0);
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
  // the segment midpoints, ranked by how far inside the frame they sit
  const cands = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const mla = (a[0] + b[0]) / 2, mlo = (a[1] + b[1]) / 2;
    if (!inFrame(mla, mlo)) continue;
    const edge = Math.min(mla - minLa, maxLa - mla) / (maxLa - minLa)
               + Math.min(mlo - minLo, maxLo - mlo) / (maxLo - minLo);
    let ang = Math.atan2(-(b[0] - a[0]) * KY, (b[1] - a[1]) * KX) * 180 / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    cands.push({ mla, mlo, ang, edge });
  }
  // Try the candidates best-first instead of giving up on the best one. Oxford
  // Street's most-inboard midpoint is the pavement between Stops J and K, whose
  // markers are claimed first, so the one street this sheet's subtitle names was the
  // one street it did not label. Every other street keeps its old position: the first
  // candidate is unchanged, and the rest are reached only where it failed.
  cands.sort((a, b) => b.edge - a.edge || a.mla - b.mla || a.mlo - b.mlo);
  const size = MIN_TEXT, tw = FM.textWidth(nm, size, false);
  for (const best of cands) {
    const X = px(best.mlo), Y = py(best.mla);
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
    break;
  }
}

/* SIGNAL-CONTROLLED CROSSINGS AND JUNCTIONS — asked for by name, and they earn
 * their place: "cross at the lights" is how a person gives directions, and this
 * sheet's whole job is a walking instruction. Drawn AFTER the streets and before
 * the bay markers, and claimed in the occupancy map so no label lands on one.
 *
 * Kept honest about how little there usually is. St Ives Bus Station has exactly
 * ONE inside the frame (a puffin crossing on Station Road, 56 m west); there is no
 * signalled junction anywhere within 300 m. A symbol drawn for each is truthful
 * and useful; inventing a network of them would not be.
 */
// boardingPlan.locatorSignalNearM: keep only signals within N metres of a stand the
// sheet names.  A signal is on the sheet to support "cross at the lights" on the
// walk to a flag; one 200 m away on a ring road supports nothing and, where there
// are 28 of them, hides the flags.  Absent the key nothing is filtered.
const SIG_NEAR_M = (BP.locatorSignalNearM != null) ? +BP.locatorSignalNearM : null;
function nearAStand(lat, lon) {
  if (SIG_NEAR_M == null) return true;
  for (const s of stands) {
    if (!s.pos) continue;
    if (Math.hypot((lat - s.pos[0]) * KY, (lon - s.pos[1]) * KX) <= SIG_NEAR_M) return true;
  }
  return false;
}
let drewSignals = 0, skippedSignals = 0;
if (LOC && Array.isArray(LOC.signals)) {
  for (const g of LOC.signals) {
    if (!inFrame(g.lat, g.lon)) continue;
    if (!nearAStand(g.lat, g.lon)) { skippedSignals++; continue; }
    const X = px(g.lon), Y = py(g.lat);
    if (X < MAP_X0 + 1 || X > MAP_X1 - 1 || Y < MAP_Y0 + 1 || Y > MAP_Y1 - 1) continue;
    // A traffic light: white-cased body so it reads on the road band it sits on,
    // three lamps, short mast. 2.9 mm tall — small, but it is a symbol not a label,
    // so the MIN_TEXT floor (which governs TEXT) does not apply to it.
    out(`<g transform="translate(${f2(X)} ${f2(Y)})">`
      + `<rect x="-1.35" y="-2.35" width="2.7" height="4.0" rx="0.6" fill="#ffffff"/>`
      + `<rect x="-0.95" y="-1.95" width="1.9" height="3.2" rx="0.45" fill="${INK}"/>`
      + `<circle cx="0" cy="-1.15" r="0.42" fill="#e05a4d"/>`
      + `<circle cx="0" cy="-0.35" r="0.42" fill="#e0a63d"/>`
      + `<circle cx="0" cy="0.45" r="0.42" fill="#5aab63"/>`
      + `<rect x="-0.3" y="1.25" width="0.6" height="1.5" fill="${INK}"/>`
      + `</g>`);
    claim({ x0: X - 1.6, x1: X + 1.6, y0: Y - 2.6, y1: Y + 3.0 });
    drewSignals++;
  }
}

let poiLabelled = 0, poiBare = 0;
for (const p of poi) {
  const kind = p.tags.shop || p.tags.amenity || p.tags.tourism || p.tags.historic || '';
  const cat = ICON_FOR[kind] || null;
  const X = px(p.lon), Y = py(p.lat);
  if (X < MAP_X0 + 1 || X > MAP_X1 - 1 || Y < MAP_Y0 + 1 || Y > MAP_Y1 - 1) continue;
  const half = cat ? 2 : 1.1;
  const icoBox = { x0: X - half, x1: X + half, y0: Y - half, y1: Y + half };
  if (hits(icoBox)) continue;               // symbol itself has nowhere to sit
  if (cat) {
    out(ICONS.icon(cat, X, Y, 1.7, 'charcoal'));
  } else {
    out(`<circle cx="${f2(X)}" cy="${f2(Y)}" r="0.95" fill="#ffffff"/>`);
    out(`<circle cx="${f2(X)}" cy="${f2(Y)}" r="0.62" fill="#6b737b"/>`);
  }
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
  const m = MPOS.get(s.atco);
  const X = m ? m.x : px(s.pos[1]), Y = m ? m.y : py(s.pos[0]);
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
    // A LETTERED BAY CARRIES ITS OWN NAME; A NAMED STOP DOES NOT. The ring alone is
    // anonymous on the map — the reader has to go to the key to find out which of
    // the four marks it is, and this is the one that matters most here: it is where
    // every Cambridge passenger boards. Printed VERBATIM, never shortened, because
    // rule 3 is that the printed string must match the flag.
    const size = MIN_TEXT, tw = FM.textWidth(s.label, size, false);
    const cands = [
      { x: X + 3.4, a: 'start', y: Y + 0.9 },
      { x: X - 3.4, a: 'end', y: Y + 0.9 },
      { x: X, a: 'middle', y: Y + 5.4 },
      { x: X, a: 'middle', y: Y - 3.8 },
    ];
    for (const c of cands) {
      const x0 = c.a === 'start' ? c.x : c.a === 'end' ? c.x - tw : c.x - tw / 2;
      const b = { x0, x1: x0 + tw, y0: c.y - size, y1: c.y + 0.8 };
      if (b.x0 < MAP_X0 + 0.5 || b.x1 > MAP_X1 - 0.5) continue;
      if (b.y0 < MAP_Y0 + 0.5 || b.y1 > MAP_Y1 - 0.5) continue;
      if (hits(b)) continue;
      claim(b);
      out(`<text x="${f2(c.x)}" y="${f2(c.y)}" font-size="${size}" font-weight="bold"`
        + ` fill="${NAMED_INK}" text-anchor="${c.a}">${esc(s.label)}</text>`);
      break;
    }
  }
}
for (const s of stands) standMarker(s);

// the anchor itself, drawn last and small — "you are here".
//
// Only where the place is a LANDMARK the stops sit near — a shop, a school, a
// hospital. At an interchange the stands ARE the place, so this draws a fifth
// point that is not a stop and cannot be boarded: on St Ives Bus Station it fell
// 8 mm from Bay 2, clear of every marker, and read as a stop we had failed to
// label (Peter, 2026-08-23). It is the OSM centroid of the bus-station polygon,
// not any stop's NaPTAN position, which is why no marker-overlap test catches it.
// Off by default for an interchange, on for everything else; boardingPlan
// .anchorTick overrides either way.
const INTERCHANGE = new Set(['bus_station', 'ferry_terminal']);
// The stand key's 'you are already there' caption. Only an interchange anchor has
// one by default; boardingPlan.hereLabel names it for any other place that does.
const HERE_PHRASE = (BP.hereLabel != null) ? (BP.hereLabel || null)
                  : (INTERCHANGE.has(PLACE.type) ? 'in the bus station' : null);
const ANCHOR_TICK = (BP.anchorTick != null) ? !!BP.anchorTick
  : !INTERCHANGE.has(String(PLACE.type || ''));
if (ANCHOR_TICK) {
  out(`<circle cx="${f2(px(PLON))}" cy="${f2(py(PLAT))}" r="1.1" fill="none" stroke="${INK}" stroke-width="0.5"/>`);
}
out(`</g>`);

// north arrow — a plan that is north-up must say so (rule 7's other half)
const NX = MAP_X1 - 6, NY = MAP_Y0 + 8;
out(`<g stroke="${INK}" stroke-width="0.45" fill="${INK}">`);
out(`<line x1="${f2(NX)}" y1="${f2(NY)}" x2="${f2(NX)}" y2="${f2(NY - 5)}"/>`);
out(`<path d="M${f2(NX)} ${f2(NY - 6.4)} l1.5 2.2 l-3 0 z" stroke="none"/>`);
out(`</g>`);
out(`<text x="${f2(NX)}" y="${f2(NY + 2.9)}" font-size="2.5" fill="${INK}" text-anchor="middle">N</text>`);

/* ------------------------------------------- the stand key under the map */
// THE FOOTER PLATE IS COMPUTED HERE, BEFORE ANYTHING HAS TO DODGE IT.
// (Was computed just before the index legend; it is the same object and the same
// call, only earlier, because the stand key needs it too.)
//
// ONE options object, passed to BOTH footerPlateTop and footerBand — the rule
// gen_internal.js follows for the same reason, so the plate the legend dodges can
// never be a different plate from the one that gets drawn.
const PRINT_SAFE = (RJ.design && RJ.design.printSafe != null) ? +RJ.design.printSafe : 5;
const DESIGN = RJ.design || {};
const FOOTER_OPTS = {
  notes: ['Service data from the Bus Open Data Service; stop names, bay numbers and bearings from NaPTAN (Open Government Licence v3.0).'],
  url: DESIGN.sheetUrl || null,
  qr: DESIGN.sheetQr || null,
  sheetVersion: DESIGN.sheetVersion || null,
  ...(DESIGN.sheetUrlLabel !== undefined ? { urlLabel: DESIGN.sheetUrlLabel } : {}),
  x0: SAFE, x1: W - SAFE, safe: PRINT_SAFE,
};
const PLATE_TOP = FOOTER.footerPlateTop(FOOTER_OPTS);

// THE STAND KEY CAN OUTGROW ITS COLUMN, and nothing said so. It stepped a fixed
// 8.2 mm per stand from the bottom of the map with no bound, which fits the four
// bays at St Ives and does not fit the five lettered stands on St Neots Market
// Square: Stop E — the busiest of the five, seventeen destinations — was written at
// y=192 mm under a footer plate whose top is 188.1 mm, so the sheet's most-used
// stand was painted out. The destination index already counts what it cannot fit
// and says so; this column did not, which is the whole of why it went unnoticed.
//
// Two rows per stand where they fit; one compact row per stand where they do not;
// and if even that overruns, say so and fail, the way the index does.
const KEY_TOP = MAP_Y1 + 5.0;
const KEY_LIMIT = PLATE_TOP - 0.8;      // St Ives's fourth sub-line sits 0.9 mm clear
const KEY_ROW_1 = KEY_TOP + 4.2;        // baseline of the first stand's label
const KEY_TWO_LINE = (KEY_ROW_1 + (stands.length - 1) * 8.2 + 3.4) <= KEY_LIMIT;
const KEY_PITCH = KEY_TWO_LINE ? 8.2 : 5.2;
const KEY_FITS = Math.max(0, Math.floor((KEY_LIMIT - KEY_ROW_1) / KEY_PITCH) + 1);
const keyOverflow = Math.max(0, stands.length - KEY_FITS);

let ky = KEY_TOP;
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
  // 'in the bus station' was a town literal wearing a phrase (invariant 1). It is
  // true only where the anchor IS a bus station, and it is the worst possible thing
  // to be wrong about: at High Wycombe the anchor is Oxford Street and Stops J and K
  // are ON Oxford Street, 14 m and 28 m away, yet both were captioned 'in the bus
  // station' -- sending a reader 200 m up the road, past the flag they wanted, for
  // every one of the 60 destinations those two stops serve. Off a bus-station anchor
  // the sheet prints the measured walk instead, which is never wrong.
  const walk = (HERE_PHRASE && s.distM <= 30) ? HERE_PHRASE
             : `${s.distM} m walk, about ${s.walkMin} min`;
  const facing = s.facing ? `, buses face ${s.facing}` : '';
  out(`<text x="${f2(cxk + 4.6)}" y="${f2(ky)}" font-size="3.1" fill="${INK}">${esc(s.label)}</text>`);
  if (KEY_TWO_LINE) {
    out(`<text x="${f2(cxk + 4.6)}" y="${f2(ky + 3.4)}" font-size="2.5" fill="${INK_SOFT}">${esc(walk + facing)}</text>`);
  } else {
    // One line. The label is set in FM's measured width so the grey half starts
    // clear of it rather than at a guessed offset.
    const lw = FM.textWidth(s.label, 3.1, false);
    out(`<text x="${f2(cxk + 4.6 + lw + 2.0)}" y="${f2(ky)}" font-size="2.5" fill="${INK_SOFT}">${esc(walk + facing)}</text>`);
  }
  ky += KEY_PITCH;
}
if (keyOverflow > 0) {
  console.error(`gen_boarding: ${keyOverflow} stand(s) do not fit under the map and are NOT on the sheet.`);
}

/* ================================================================= INDEX */
// The product. Alphabetical by destination, three columns.
const IX0 = MAP_X1 + 6, IX1 = W - SAFE;
const IX1_TEXT = W - Math.max(SAFE, PRINT_SAFE);   // where a note line must stop
const IY0 = HEAD_Y + 4;
// THE INDEX'S FLOOR IS WHATEVER THE LEGEND LEAVES IT.  186 mm was written when the
// legend was one line; it grows upward from the footer plate, a line per
// boardingPlan.note, and at three notes it starts at 176.5 mm.  High Wycombe's
// columns ran to 185.9 and printed their last two rows through it -- undetected,
// because the rows were inside IY1 and the legend tests nothing.  Inert on any
// sheet whose columns stop short of the floor.
const LG_GAP = 3.2;
const LG_NOTES = BP.note == null ? [] : (Array.isArray(BP.note) ? BP.note.filter(Boolean) : [BP.note]);
const LG_LINES = 1 + LG_NOTES.length;
const LG_TOP = PLATE_TOP - 2.0 - LG_GAP * (LG_LINES - 1);
const IY1 = Math.min(186, LG_TOP - 3.6);

out(`<text x="${f2(IX0)}" y="${f2(IY0 + 3.2)}" font-size="4.0" font-weight="bold" fill="${INK}">${esc(BP.indexHeading || 'Where to board, by destination')}</text>`);

// TWO COLUMNS, not three, and the reason is the BOARD AT cell. Three columns left
// it 10.8 mm wide, which is fine for "4" and useless for "The Busway Station Road"
// — it rendered as "The Buswa.", i.e. the sheet's one genuinely novel instruction
// truncated into nonsense. A boarding point that cannot be printed in full is not
// a boarding point, so the column count follows from the longest flag name rather
// than from how many rows would fit.
const COLS = Math.max(1, Math.min(4, Math.round((BP.indexCols != null) ? +BP.indexCols : 2)));
const COL_GAP = 6.0;
const colW = ((IX1 - IX0) - COL_GAP * (COLS - 1)) / COLS;
const HDR_H = 5.8;
const bodyTop = IY0 + 8.6;
// Balance the columns instead of filling the first one to the floor: 44 rows over
// three columns had filled column 1 with 33, column 2 with 11 and left column 3
// entirely blank.
// HOW MANY ROWS A COLUMN CAN ACTUALLY HOLD.  This was computed here and then
// never used: `overflow` below compared dests.length against COLS*perCol, and
// perCol is itself ceil(dests.length/COLS), so the difference is 0 for every
// input the generator can be given.  The guard could not fire, and the comment
// over the stand key ("the destination index already counts what it cannot fit
// and says so") recorded the opposite belief.  High Wycombe town centre is where
// it mattered: 87 destinations, a capacity of 64, exit code 0, and 23 rows drawn
// past the foot of the page and over the footer plate.
const capacity = Math.max(1, Math.floor((IY1 - bodyTop - HDR_H) / 4.35));
const perCol = Math.min(capacity, Math.max(1, Math.ceil(dests.length / COLS)));
const ROW_H = Math.min(6.4, Math.max(4.15, (IY1 - bodyTop - HDR_H) / Math.max(perCol, 1)));

// Column geometry: destination name, then route badges, then the boarding point.
// Sized from the longest flag name at the 2.4 mm floor, not from taste. Raising
// the type floor to clear the legibility check re-truncated 'The Busway Station
// Road' to 'The Busway Station Ro.' — the same fault the two-column layout was
// chosen to fix, reintroduced from the other direction. If a longer stop name
// ever appears, this widens again; it does not get to abbreviate.
// The 33 mm and 21 mm below are the widths ONE sheet needed: St Ives, whose
// longest flag name is 'The Busway Station Road' and whose busiest row carries
// four badges.  They are kept verbatim as the default so every sheet built
// against them is unmoved.  Where the config asks for a different column count
// the reservations are instead MEASURED off this sheet's own rows -- the widest
// board-at label it will really print, and the widest badge run it will really
// draw -- because at three columns a guessed 54 mm leaves nothing for the name.
const BOARD_MAX_BADGES = Math.max(1, Math.round((BP.indexMaxBadges != null) ? +BP.indexMaxBadges : 3));
function boardCellW(d) {
  const st = (INDEX.stands || []).find(s => s.atco === d.boardAtAtco);
  if (st && st.class === 'stand') return 5.0;                       // disc at +2.2, r 2.3
  return 3.8 + FM.textWidth(String(d.boardAt), 2.6, false) + 0.6;   // named stop, spelled out
}
function routeCellW(d) {
  const shown = displayRoutes(d.routes);
  let w = 0;
  for (const r of shown.slice(0, BOARD_MAX_BADGES)) w += Math.max(4.6, FM.textWidth(r, MIN_TEXT, true) + 2.0) + 0.8;
  return w + (shown.length > BOARD_MAX_BADGES ? 2.6 : 0);
}
let C_BOARD, C_ROUTE;
if (BP.indexCols == null) {
  C_BOARD = colW - 33.0;   // the bay disc / stop name
  C_ROUTE = C_BOARD - 21.0;
} else {
  const boardW = dests.reduce((m, d) => Math.max(m, boardCellW(d)), 0);
  const routeW = dests.reduce((m, d) => Math.max(m, routeCellW(d)), 0);
  const nameW = dests.reduce((m, d) => Math.max(m, FM.textWidth(d.destination, MIN_TEXT, false)), 0) + 1.5;
  C_BOARD = colW - boardW;
  C_ROUTE = C_BOARD - routeW;
  if (C_ROUTE < nameW) {
    console.error(`gen_boarding: ${COLS} index column(s) leave ${C_ROUTE.toFixed(1)} mm for the destination name;`);
    console.error(`  the longest one needs ${nameW.toFixed(1)} mm even at the ${MIN_TEXT} mm type floor, so names would be`);
    console.error('  truncated. Use fewer columns, or move the map edge left with boardingPlan.mapRightMm.');
    process.exit(2);
  }
}

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
  // Left-aligned at C_BOARD this header is 11 mm wide in a cell that, once measured
  // rather than reserved, is 5 mm: it ran into the next column's 'TO' and off the
  // right trim. Flush right against the column clears both, and clears the 'BUS'
  // header too because the badge cell never reaches within 6 mm of C_BOARD.
  if (BP.indexCols == null) {
    out(`<text x="${f2(x0 + C_BOARD)}" y="${f2(ry)}" font-size="2.5" font-weight="bold" fill="${INK_SOFT}">BOARD AT</text>`);
  } else {
    out(`<text x="${f2(x0 + colW)}" y="${f2(ry)}" font-size="2.5" font-weight="bold" fill="${INK_SOFT}" text-anchor="end">BOARD AT</text>`);
  }
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
overflow = Math.max(0, dests.length - COLS * perCol);   // perCol is now capped at capacity
if (overflow > 0) {
  console.error(`gen_boarding: ${overflow} destination(s) did not fit and are NOT on the sheet.`);
  console.error('  An index that silently drops rows is the one failure this sheet cannot have.');
  console.error('  Widen the columns, drop a column, or set an explicit selection rule in');
  console.error('  boardingPlan (paper §5: "selected destinations" needs a stated rule).');
}

/* ----------------------------------------------------------- footer options */
// Built HERE, above the legend, because the legend has to know where the footer
// plate starts. `safe` is opt-in on footerBand and defaults to null, which leaves
// the credit 3 mm from the right trim — the exact fault the 2026-08-16 printSafe
// work fixed on all 21 town sheets. Omitting it here put this sheet's nearest ink
// at 3.41 mm and failed the quality metric's 5 mm edge rule on its first measurement.
//
// design.sheetUrl / sheetQr / sheetUrlLabel / sheetVersion — the QR and the printed
// build stamp. footerBand has taken all four since 2026-08-18 and gen_internal.js has
// passed them since; this sheet never did, so it shipped with no QR and no version a
// reader could quote back (Peter, 2026-08-23). Every key is opt-in and null-safe: a
// routes.json with no design block renders byte-identically.
//
// ONE options object, passed to BOTH footerPlateTop and footerBand — the rule
// gen_internal.js follows for the same reason, so the plate the legend dodges can
// never be a different plate from the one that gets drawn.
/* ---------------------------------------------------------------- legend */
// Under the index where there is room, but never under the footer plate: the QR
// raised the plate top from 197.17 mm to 188.10 mm and both lines, pinned to the
// index bottom at 189.6 and 192.8, were painted over (Peter, 2026-08-23 — the
// first render of this sheet carrying a QR). 2 mm of air above the plate.
// `boardingPlan.note` takes a string or an array of them. A place can need more than
// one line: St Neots has to say both where the letters come from AND that two of the
// services calling at Stand A are community routes outside the national dataset, and
// the second sentence is exactly the kind a sheet must not swallow. A single string
// still renders byte-identically to before. LG_GAP / LG_NOTES / LG_LINES / LG_TOP are
// declared with IY1 above, because the index's floor has to know how tall this is.
const LGY = Math.min(IY1 + 3.6, LG_TOP);
out(`<text x="${f2(IX0)}" y="${f2(LGY)}" font-size="2.4" fill="${INK_SOFT}">${esc('ltd = a limited service, fewer than ' + (BP.limitedBelowPerWeek || 6) + ' journeys a week.')}</text>`);
LG_NOTES.forEach((n, i) => out(`<text x="${f2(IX0)}" y="${f2(LGY + LG_GAP * (i + 1))}" font-size="2.4" fill="${INK_SOFT}">${esc(n)}</text>`));
// A note is drawn as one unwrapped line, so a long one walks off the right of the
// index and into the print-safe margin without anything saying so. quality_metrics
// caught High Wycombe's third note at 4.62 mm from the trim; the generator that
// wrote it should be the one to complain.
for (const n of LG_NOTES) {
  const w = FM.textWidth(n, 2.4, false);
  if (IX0 + w > IX1_TEXT) {
    console.error(`gen_boarding: a boardingPlan.note is ${(IX0 + w - IX1_TEXT).toFixed(1)} mm too long and runs into the print-safe margin:`);
    console.error(`  "${n.slice(0, 72)}${n.length > 72 ? '...' : ''}"`);
  }
}

/* ---------------------------------------------------------------- footer */
out(FOOTER.footerBand({ ...FOOTER_OPTS,
  version: RJ.version || 'v1.0',
  validFrom: RJ.validFrom || 'Summer 2026',
}));

out(`</g></svg>`);

fs.writeFileSync(path.join(DIR, OUT), parts.join('\n'));
console.log(`gen_boarding: wrote ${OUT} — ${dests.length} destination(s), ${stands.length} boarding point(s)`);
if (LOC) {
  console.log(`  locator context: ${drewBuildings} building(s), ${drewAreas} area(s), `
    + `${drewSignals} signal(s), ${poiLabelled} landmark label(s), ${poiBare} unlabelled`);
} else {
  console.log('  locator context: locator_geo.json absent — streets only.'
    + ' Run pull_locator.js in this directory to draw buildings, the station apron and the lights.');
}
if (markerMoveMax.mm > 0.05) {
  console.log(`  markers spread to stay legible: furthest move ${markerMoveMax.mm.toFixed(1)} mm (${markerMoveMax.label})`);
}
if (HIDE_EMPTY && standsAll.length !== stands.length) {
  const dropped = standsAll.filter(s => !(s.destinations || []).length).map(s => s.label);
  console.log(`  not drawn (never the nearest boarding point for anything): ${dropped.join(', ')}`);
}
process.exit(overflow > 0 ? 1 : 0);
