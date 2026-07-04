// S2 asset: pull the OSM ROAD GRAPH for a town -> roads_geo.json
// Used by the internalRoads drawing model (road-skeleton internal map):
// match_routes.js routes each bus line along these ways, and gen_internal.js
// draws/labels the used roads. Generic for any town.
//
// Run from inside the town's S2 working dir (needs atco2ll.json + a routes
// stop-list file). Usage:  node pull_roads.js [marginKm]
//   bbox = extent of the DRAWN stops (routes_intown_atco.json, falling back to
//   routes_atco.json) + marginKm (default 0.6).
// Output: roads_geo.json  { bbox:[s,w,n,e], ways:[{id,nodes,geometry,tags}] }
//   tags kept: name, highway, oneway, ref.
//
// Overpass etiquette: GET with an explicit User-Agent (Node fetch sends none
// and gets 406 — see gotchas), retry across mirrors.
const fs = require('fs');
const DIR = process.env.LEAFLET_DIR || process.cwd();
const marginKm = parseFloat(process.argv[2] || '0.6');

const atco2ll = JSON.parse(fs.readFileSync(DIR + '/atco2ll.json', 'utf8'));
const routes = (function () {
  for (const f of ['routes_intown_atco.json', 'routes_atco.json']) {
    try { return JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8')); } catch (e) { }
  }
  throw new Error('no routes_intown_atco.json or routes_atco.json in ' + DIR);
})();

let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180, n = 0;
for (const r in routes) for (const a of routes[r]) {
  const ll = atco2ll[a]; if (!ll) continue; n++;
  if (ll[0] < minLat) minLat = ll[0]; if (ll[0] > maxLat) maxLat = ll[0];
  if (ll[1] < minLon) minLon = ll[1]; if (ll[1] > maxLon) maxLon = ll[1];
}
if (!n) throw new Error('no stop coords found');

// --- reach extension (item-3 truncated-tails fix) --------------------------
// The display bbox above is sized from the DRAWN stops, so a route whose next
// real stop sits just outside town has no road geometry past its last in-box
// stop — match_routes then stops there and gen_internal draws the "to X"
// continuation arrow at an interior junction instead of the frame edge.
// For each route listed in match_cfg.json's reachExtend, union a few more of
// its real full-chain stops into the bbox so the pull (and match_routes) reach
// out past where the fisheye + frame actually cut the tail. This feeds EXTRA
// geometry only; routes_intown_atco.json (which stops get ticks/badges) is
// untouched. Candidate stops are filtered through the SAME viaPrefixes/
// viaExclude rules match_routes applies, so an excluded variant-loop (e.g. St
// Ives 9's Hilton/Elsworth village detour) is never silently reintroduced.
// Config: match_cfg.json "reachExtend":{ "<route>":{ "start":N, "end":N } }
//   start/end = how many extra filtered-chain stops to add beyond the current
//   in-bbox portion at the chain's start / end (matching contStart / contEnd).
const dispBox = [minLat, minLon, maxLat, maxLon];  // pre-extension display extent
try {
  const MCFG = JSON.parse(fs.readFileSync(DIR + '/match_cfg.json', 'utf8'));
  const RE = MCFG.reachExtend;
  if (RE) {
    const FULL = JSON.parse(fs.readFileSync(DIR + '/routes_full_atco.json', 'utf8'));
    const inDisp = ll => ll[0] >= dispBox[0] && ll[0] <= dispBox[2] && ll[1] >= dispBox[1] && ll[1] <= dispBox[3];
    for (const r in RE) {
      const f = FULL[r]; if (!f) continue;
      const can = (f.canonical && f.canonical[0]) || (f.directions && f.directions[0]); if (!can) continue;
      let chain = can.stops.filter(a => atco2ll[a]);
      const vp = (MCFG.viaPrefixes || {})[r]; if (vp) chain = chain.filter(a => vp.some(p => a.startsWith(p)));
      const vx = (MCFG.viaExclude || {})[r]; if (vx) chain = chain.filter(a => !vx.includes(a));
      const inIdx = []; chain.forEach((a, i) => { if (inDisp(atco2ll[a])) inIdx.push(i); });
      if (!inIdx.length) continue;
      const add = [], sN = RE[r].start | 0, eN = RE[r].end | 0;
      if (sN) { const f0 = inIdx[0]; for (let i = f0 - 1; i >= Math.max(0, f0 - sN); i--) add.push(chain[i]); }
      if (eN) { const l0 = inIdx[inIdx.length - 1]; for (let i = l0 + 1; i <= Math.min(chain.length - 1, l0 + eN); i++) add.push(chain[i]); }
      for (const a of add) {
        const ll = atco2ll[a]; if (!ll) continue;
        if (ll[0] < minLat) minLat = ll[0]; if (ll[0] > maxLat) maxLat = ll[0];
        if (ll[1] < minLon) minLon = ll[1]; if (ll[1] > maxLon) maxLon = ll[1];
      }
      if (add.length) console.log('reachExtend ' + r + ': +' + add.length + ' stops (' + add.join(',') + ')');
    }
  }
} catch (e) { /* no match_cfg / reachExtend -> unchanged behaviour */ }

const latM = marginKm / 111.32, lonM = marginKm / (111.32 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180));
const bbox = [minLat - latM, minLon - lonM, maxLat + latM, maxLon + lonM];

// Highways a bus (or its road context) can plausibly use. service is included
// for bus-station / supermarket loops; match_routes.js penalises it so paths
// prefer real roads.
const HW = '^(motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|busway|bus_guideway|service)$';
const q = `[out:json][timeout:90];way["highway"~"${HW}"](${bbox.join(',')});out geom;`;

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
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

  const ways = [];
  for (const e of j.elements) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) continue;
    const t = e.tags || {};
    ways.push({
      id: e.id,
      nodes: e.nodes,
      geometry: e.geometry.map(p => [p.lat, p.lon]),
      tags: { name: t.name, highway: t.highway, oneway: t.oneway, ref: t.ref }
    });
  }
  const named = new Set(ways.filter(w => w.tags.name).map(w => w.tags.name));
  fs.writeFileSync(DIR + '/roads_geo.json', JSON.stringify({ bbox, ways }));
  console.log('roads_geo.json: ' + ways.length + ' ways, ' +
    ways.reduce((s, w) => s + w.geometry.length, 0) + ' points, ' +
    named.size + ' named roads; bbox ' + bbox.map(x => x.toFixed(4)).join(','));
})();
