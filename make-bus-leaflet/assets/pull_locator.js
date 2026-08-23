// S2/S4 asset: pull the OSM GROUND CONTEXT for a boarding plan's locator map
// -> locator_geo.json.  Consumed by gen_boarding.js; nothing else reads it.
//
// WHY THIS EXISTS. The first boarding plan (St Ives Bus Station v1.2) drew the
// locator as a grey street skeleton, four numbered bay markers and one landmark.
// Peter's verdict, 2026-08-23: "I find it hard to envisage it on the ground at
// the moment ... the one POI on the plan is not well-known at all." He is right,
// and the cause is a data gap rather than a drawing one. At the ~130 m frame a
// boarding plan needs, the town-scale POI pull (overpass-pois.txt: supermarkets,
// libraries, schools, surgeries) has almost nothing inside the frame -- those are
// the landmarks of a TOWN map. What is inside the frame is the built fabric:
// building footprints, the bus-station apron itself, the car park next door, the
// shopfronts on the corner, and the signalled crossing you walk over. None of it
// was ever fetched, so none of it could be drawn.
//
// WHAT IT FETCHES, and why each earns its place on a sheet whose subject is four
// bay markers:
//   buildings  the single biggest gain. A street skeleton with no buildings reads
//              as a diagram; the same streets with footprints read as a place. The
//              shapes are what let a reader match the sheet to what they can see.
//   areas      the bus-station polygon, car parks, pedestrian areas. The station's
//              own outline is the "you are here" the sheet was missing: the bays
//              are inside a shape the reader is standing in.
//   signals    signal-controlled junctions and crossings. Asked for by name, and
//              genuinely load-bearing on a walking instruction -- "cross at the
//              lights" is how people give directions.
//   places     named shops and amenities as points. At this scale a shopfront IS
//              the landmark; the town pull's categories are all too far away.
//
// Run from inside the run dir (needs place.json). Usage:
//   node pull_locator.js [radiusM]
// radiusM default 300, which comfortably covers any locator frame gen_boarding.js
// can compute (it fits to the stands and grows to the panel aspect, ~130-200 m).
//
// Output: locator_geo.json
//   { center:[lat,lon], radiusM, bbox:[s,w,n,e],
//     buildings:[{id, geometry:[[lat,lon]...], tags:{name,building,amenity,shop}}],
//     areas:    [{id, kind, name, geometry:[[lat,lon]...]}],
//     signals:  [{lat, lon, kind}],
//     places:   [{lat, lon, name, tags}] }
//
// gen_boarding.js treats the whole file as OPTIONAL: absent, it draws exactly what
// it drew before, byte for byte. So an existing place can be re-rendered without
// this having been run, and a place whose Overpass pull failed still produces a
// sheet.
//
// Overpass etiquette: GET with an explicit User-Agent (Node fetch sends none and
// gets 406 -- see gotchas), retry across mirrors. Same shape as pull_roads.js.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.env.LEAFLET_DIR || process.cwd();
const radiusM = parseFloat(process.argv[2] || '300');

const PLACE = JSON.parse(fs.readFileSync(path.join(DIR, 'place.json'), 'utf8'));
const LAT = PLACE.lat, LON = PLACE.lon;
if (typeof LAT !== 'number' || typeof LON !== 'number') {
  throw new Error('place.json has no numeric lat/lon');
}
const KY = 111320, KX = 111320 * Math.cos(LAT * Math.PI / 180);
const dLat = radiusM / KY, dLon = radiusM / KX;
const bbox = [LAT - dLat, LON - dLon, LAT + dLat, LON + dLon].map(v => +v.toFixed(6));
const B = bbox.join(',');

// One query, four concerns. `out geom` gives ways their coordinates inline (the
// same form pull_roads.js consumes) and `out center tags` would NOT -- a footprint
// drawn from its centroid is a dot, which is the bug this file exists to avoid.
const q = `[out:json][timeout:90];
(
  way["building"](${B});
  way["amenity"="bus_station"](${B});
  way["amenity"="parking"](${B});
  way["highway"="pedestrian"]["area"="yes"](${B});
  way["leisure"~"^(park|garden|pitch|playground)$"](${B});
  node["highway"="traffic_signals"](${B});
  node["highway"="crossing"]["crossing"~"traffic_signals|signals"](${B});
  node["shop"]["name"](${B});
  node["amenity"~"^(pharmacy|bank|cafe|restaurant|fast_food|pub|bar|post_office|library|townhall|place_of_worship|toilets|doctors|dentist|cinema|theatre|marketplace)$"]["name"](${B});
  node["tourism"~"^(hotel|museum|attraction|information)$"]["name"](${B});
);
out geom;`;

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Which polygon layer a way belongs to. Order matters: a building tagged
// amenity=parking (a multi-storey) is a building first -- it has walls and a roof
// and the reader can see it -- so `building` is tested before the area kinds.
function areaKind(t) {
  if (t.amenity === 'bus_station') return 'bus_station';
  if (t.amenity === 'parking') return 'parking';
  if (t.highway === 'pedestrian') return 'pedestrian';
  if (t.leisure) return 'green';
  return null;
}

(async () => {
  let j = null, lastErr = null;
  for (const base of MIRRORS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(base + '?data=' + encodeURIComponent(q), {
          headers: { 'User-Agent': 'make-bus-leaflet/1.0', 'Accept': 'application/json' }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + base);
        j = await res.json(); break;
      } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 3000)); }
    }
    if (j) break;
  }
  if (!j) throw lastErr || new Error('Overpass failed');

  const buildings = [], areas = [], signals = [], places = [];
  for (const e of j.elements || []) {
    const t = e.tags || {};
    if (e.type === 'node') {
      if (t.highway === 'traffic_signals' || t.highway === 'crossing') {
        signals.push({
          lat: e.lat, lon: e.lon,
          kind: t.highway === 'traffic_signals' ? 'signals' : 'crossing'
        });
      } else if (t.name) {
        places.push({
          lat: e.lat, lon: e.lon, name: t.name,
          tags: { shop: t.shop, amenity: t.amenity, tourism: t.tourism, brand: t.brand }
        });
      }
      continue;
    }
    if (e.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 3) continue;
    const geometry = e.geometry.map(p => [p.lat, p.lon]);
    if (t.building) {
      buildings.push({
        id: e.id, geometry,
        tags: { name: t.name, building: t.building, amenity: t.amenity, shop: t.shop }
      });
      continue;
    }
    const kind = areaKind(t);
    if (kind) areas.push({ id: e.id, kind, name: t.name || null, geometry });
  }

  // Deterministic order, so a re-pull that returns the same features writes the
  // same bytes (changing-the-engine.md sec 1 applies to the pull scripts too --
  // they are the reason a "no change" rebuild can still produce a diff).
  buildings.sort((a, b) => a.id - b.id);
  areas.sort((a, b) => a.id - b.id);
  signals.sort((a, b) => a.lat - b.lat || a.lon - b.lon);
  places.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.lat - b.lat);

  const outPath = path.join(DIR, 'locator_geo.json');
  fs.writeFileSync(outPath, JSON.stringify({
    center: [LAT, LON], radiusM, bbox, buildings, areas, signals, places
  }));
  const named = buildings.filter(b => b.tags.name).length;
  console.log('locator_geo.json: ' + buildings.length + ' buildings (' + named + ' named), '
    + areas.length + ' areas, ' + signals.length + ' signal nodes, '
    + places.length + ' named places; r=' + radiusM + ' m');
  if (!signals.length) {
    console.log('  no signal-controlled junction or crossing within ' + radiusM
      + ' m — the sheet will simply have no lights symbol, which is the truth here.');
  }
})();
