// P3 helper — derive `internalRoads.termini` (the "to X" labels at the frame exits)
// for a PLACE internal map, from the curated `destinations[]` the external map
// already uses.
//
// WHY THIS EXISTS
// gen_internal draws a "to <label>" beside each frame-exit arrow, but only where
// routes.json supplies `internalRoads.termini[route] = {start:…, end:…}`. That key
// is hand-authored, and the TOWN pipeline drafts it — the PLACE pipeline never did,
// so every place map except the hand-tuned High Wycombe Aldi fixture shipped with
// bare arrows and no destinations (found 2026-08-21). The engine was never at
// fault: feed it the key and a place map labels its exits exactly like a town map.
//
// WHICH SIDE IS "start" AND WHICH IS "end" — the one thing worth getting right.
// match_routes.js builds each route's polyline from its CANONICAL direction's stop
// list (`full.canonical[0]`, falling back to `full.directions[0]`), in that order.
// gen_internal then finds `startCut` by walking the polyline BACK toward index 0 and
// `endCut` by walking FORWARD toward the last index. So:
//
//     start  <->  canonical.stops[0]        (where the canonical direction came FROM)
//     end    <->  canonical.stops[last]     (where it is going TO)
//
// That is a fact about the engine, not a guess, which is why this derivation can be
// deterministic rather than trial-and-error. Get the side wrong and the engine
// simply drops the label on a cut that does not exist — a miss, never a lie — but
// the point is to not miss.
//
// MATCHING an end-stop to a CURATED destination
// `destinations[]` carries human labels ("Cambridge"), not GTFS terminus names
// ("Drummer St Bus Station"), so names cannot be compared. Match on GEOMETRY the
// same way references/gotchas.md says to resolve an ambiguous terminus: take the
// true bearing + distance from the place to the end stop and score it against each
// destination's stored `bearing`/`distKm`, restricted to destinations that list this
// route. Bearing is the discriminator; distance only breaks ties.
//
// An end that lies INSIDE the walkshed means the route terminates at the place, so
// there is no outward destination on that side: emitted as `false`, which gen_internal
// reads as "suppress this side" (as opposed to an absent key, which lets it re-route a
// single label to whichever cut exists).
//
// Usage — run from the stage folder that holds routes.json (P3's S3 dir, or an S4
// dir after `pull`):
//     node derive_termini.js                 report only, writes nothing
//     node derive_termini.js --write         merge into routes.json
//     node derive_termini.js --write --force overwrite hand-set entries too
//     node derive_termini.js --max-bearing 45   widen the match tolerance (default 35 deg)
// Reads routes.json, routes_full_atco.json, atco2ll.json, atco2name.json, place.json
// from the CURRENT directory. Never hits the network.
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const WRITE = has('--write'), FORCE = has('--force');
const MAXB = parseFloat(val('--max-bearing', '35'));
const DIR = path.resolve(val('--dir', '.'));

const rd = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
let RJ, FULL, LL, NM, PLACE;
try {
  RJ = rd('routes.json'); FULL = rd('routes_full_atco.json');
  LL = rd('atco2ll.json'); NM = rd('atco2name.json'); PLACE = rd('place.json');
} catch (e) {
  console.error('derive_termini: ' + e.message);
  console.error('  needs routes.json, routes_full_atco.json, atco2ll.json, atco2name.json, place.json in ' + DIR);
  process.exit(1);
}

const PLAT = PLACE.lat, PLON = PLACE.lon;
const WALK = (PLACE.walkshedM || 500) / 1000;
const kc = Math.cos(PLAT * Math.PI / 180);
const km = (la1, lo1, la2, lo2) => Math.hypot((la2 - la1) * 111.320, (lo2 - lo1) * 111.320 * kc);
const bearing = (la1, lo1, la2, lo2) => {
  const y = Math.sin((lo2 - lo1) * Math.PI / 180) * Math.cos(la2 * Math.PI / 180);
  const x = Math.cos(la1 * Math.PI / 180) * Math.sin(la2 * Math.PI / 180) -
    Math.sin(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.cos((lo2 - lo1) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};
// Smallest absolute angle between two bearings. -66 and 294 are the SAME bearing;
// comparing them as raw floats is the mistake that moves artwork (Buses memory
// `normalising-a-value-can-move-the-artwork`), so always go through this.
const dBear = (a, b) => { let d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

const DESTS = Array.isArray(RJ.destinations) ? RJ.destinations : [];
if (!DESTS.length) { console.error('derive_termini: routes.json has no destinations[] to label from.'); process.exit(1); }
// localLoops entries are objects {route,label} on a place map, plain strings on the draft.
const LOOPS = new Set((RJ.localLoops || []).map(x => (x && x.route) ? x.route : x));

// canonical direction EXACTLY as match_routes.js picks it — same expression, same
// fallback — because the whole start/end mapping rests on it being the same list.
const canonOf = (r) => {
  const f = FULL[r]; if (!f) return null;
  return (f.canonical && f.canonical[0]) || (f.directions && f.directions[0]) || null;
};

function matchDest(route, atco) {
  const p = LL[atco]; if (!p) return { why: 'no coords for ' + atco };
  const b = bearing(PLAT, PLON, p[0], p[1]), d = km(PLAT, PLON, p[0], p[1]);
  if (d <= WALK) return { inside: true, bearing: b, distKm: d };
  const mine = DESTS.filter(x => (x.routes || []).includes(route));
  const pool = mine.length ? mine : DESTS;
  let best = null;
  for (const x of pool) {
    if (x.bearing == null) continue;
    const db = dBear(b, x.bearing);
    const dd = x.distKm != null ? Math.abs(x.distKm - d) : 0;
    if (!best || db < best.db - 1e-9 || (Math.abs(db - best.db) < 1e-9 && dd < best.dd)) best = { x, db, dd };
  }
  if (!best) return { why: 'no destination carries a bearing', bearing: b, distKm: d };
  if (best.db > MAXB) return { why: 'nearest destination "' + best.x.name + '" is ' + best.db.toFixed(0) + ' deg away (>' + MAXB + ')', bearing: b, distKm: d };
  return { label: shorten(best.x.name), full: best.x.name, db: best.db, dd: best.dd, bearing: b, distKm: d, borrowed: !mine.length };
}

// The EXTERNAL map needs "Ely Leisure Village" — it sits among spokes to other
// towns, so the town name earns its place. The INTERNAL map is entirely inside
// that one town, so the prefix is dead weight, and dead weight is expensive here:
// gen_internal queues a destination label as `mustPlace:true` and exempts it from
// its own cluster's badges, so an over-long label does not get dropped or nudged —
// it prints straight over its own badges (caught on Ely: "to Ely Leisure Village"
// covered ZIP2). Strip the town prefix and the same label fits.
function shorten(name) {
  const town = (PLACE.town || '').trim();
  if (!town) return name;
  const re = new RegExp('^' + town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(?=\\S)', 'i');
  const s = name.replace(re, '');
  // Never shorten to nothing, and never to something so generic it stops naming a
  // place ("Ely Station" -> "Station"); a single bare word is usually that case.
  return (s && s !== name && /\s/.test(s)) ? s : name;
}

const IRold = (RJ.internalRoads && RJ.internalRoads !== true) ? RJ.internalRoads : {};
const existing = IRold.termini || {};
const order = (RJ.routeOrder && RJ.routeOrder.length) ? RJ.routeOrder : Object.keys(FULL);

const out = {}, notes = [];
console.log('# Terminus derivation — ' + (PLACE.name || RJ.place || RJ.town));
console.log('  place ' + PLAT.toFixed(5) + ',' + PLON.toFixed(5) + '  walkshed ' + (WALK * 1000).toFixed(0) + ' m'
  + '  destinations ' + DESTS.length + '  bearing tolerance ' + MAXB + ' deg');
console.log('');
console.log('  route  side   end stop                        bearing   dist    -> label');

for (const r of order) {
  if (existing[r] !== undefined && !FORCE) { notes.push(r + ': kept the hand-set entry (use --force to replace)'); out[r] = existing[r]; continue; }
  const can = canonOf(r);
  if (!can || !can.stops || can.stops.length < 2) { notes.push(r + ': no canonical chain in routes_full_atco.json — skipped'); continue; }
  if (LOOPS.has(r)) { out[r] = { start: false, end: false }; notes.push(r + ': local loop — both sides suppressed'); continue; }
  const ends = { start: can.stops[0], end: can.stops[can.stops.length - 1] };
  const rec = {};
  for (const side of ['start', 'end']) {
    const a = ends[side], m = matchDest(r, a);
    const nm = (NM[a] || a);
    if (m.inside) {
      rec[side] = false;
      console.log('  ' + r.padEnd(6) + ' ' + side.padEnd(6) + ' ' + nm.slice(0, 30).padEnd(30) + ' ' +
        m.bearing.toFixed(0).padStart(4) + ' deg ' + m.distKm.toFixed(1).padStart(5) + 'km  -> (terminates at the place)');
    } else if (m.label) {
      rec[side] = m.label;
      console.log('  ' + r.padEnd(6) + ' ' + side.padEnd(6) + ' ' + nm.slice(0, 30).padEnd(30) + ' ' +
        m.bearing.toFixed(0).padStart(4) + ' deg ' + m.distKm.toFixed(1).padStart(5) + 'km  -> "' + m.label + '"'
        + (m.label !== m.full ? '   [shortened from "' + m.full + '"]' : '')
        + (m.db > 12 ? '   [bearing off by ' + m.db.toFixed(0) + ' deg — check]' : '')
        + (m.borrowed ? '   [destination does not list this route — check]' : ''));
      if (m.db > 12 || m.borrowed) notes.push(r + '/' + side + ': matched "' + m.label + '" on a weak signal — confirm against the render.');
    } else {
      console.log('  ' + r.padEnd(6) + ' ' + side.padEnd(6) + ' ' + nm.slice(0, 30).padEnd(30) + ' ' +
        (m.bearing != null ? m.bearing.toFixed(0).padStart(4) + ' deg ' + m.distKm.toFixed(1).padStart(5) + 'km' : '   -      -  ') + '  -> UNMATCHED');
      notes.push(r + '/' + side + ': ' + m.why + ' — left unset, so no "to" label draws on that side.');
    }
  }
  if (Object.keys(rec).length) out[r] = rec;
}

const labelled = Object.values(out).filter(v => v && (v.start || v.end)).length;
console.log('');
console.log('  ' + labelled + ' of ' + order.length + ' service(s) got at least one destination label.');
if (notes.length) { console.log(''); for (const n of notes) console.log('  ! ' + n); }

if (!WRITE) { console.log(''); console.log('  Report only. Re-run with --write to merge into routes.json.'); process.exit(0); }

const IR = Object.assign({}, IRold, { termini: out });
RJ.internalRoads = IR;
fs.writeFileSync(path.join(DIR, 'routes.json'), JSON.stringify(RJ, null, 1) + '\n');
console.log('');
console.log('  routes.json updated: internalRoads.termini now covers ' + Object.keys(out).length + ' service(s).');
console.log('  Re-run P4 (build_internal_place_roads.js) and CHECK THE RENDER — a side that came out');
console.log('  backwards shows as a missing label, not a wrong one, so it is easy to miss on the numbers.');
