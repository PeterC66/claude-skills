// P3 helper — the destination-aggregation module (the genuinely new logic in the
// place skill). Turns "every route through the place, drawn to its terminus" (the
// town skill's external model) into "the places you can REACH from here", one
// spoke per destination with all the routes that get you there.
//
// Method:
//   1. For each route, find its reachable end-points (the terminus stop of each
//      direction). If that end is inside the place walkshed (the route TERMINATES at
//      the place, e.g. 150/61EY at Tesco), use the other end instead.
//   2. Cluster those end-points geographically (union within clusterKm) so that
//      several stops that are really the same destination — "Bus Station",
//      "Market Square" both = St Neots town centre — collapse into ONE spoke.
//   3. Each cluster becomes a destination: label = the settlement most of its
//      end-points are in (see placeName below), else its most common stop name,
//      bearing = true bearing from the place to the cluster centroid, routes = every
//      route reaching it, distKm = distance. Pure local loops (both ends in the
//      walkshed) are reported separately, not drawn as spokes.
// The result is a DRAFT for human review (per the skill's "suggest, then confirm"
// rule) — merge/relabel clusters, then paste into routes.json `destinations`.
//
// Naming (OA-438): with --localities <atco2locality.json>, written by
// stop_localities.py from NaPTAN through the town drafter's own PlaceNamer, a
// cluster is named after its SETTLEMENT and not its stop. Before that, 7 of 87
// drafted names across ten places survived review: the drafter wrote "Bus
// Station", "Market Square", "Newlands Cottages" and a person rewrote nearly every
// one to the town the stop is in. Without the flag the old stop-name behaviour is
// unchanged.
//
// Usage: node aggregate_destinations.js <routes_full.json> <atco2ll.json> <atco2name.json> <place.json> [clusterKm] [out] [--localities <atco2locality.json>]
const fs = require('fs');
// Positional, through the one parser: cli.parseArgs puts positionals in `_`, so
// the six arguments below are unchanged and a `--flag` can be added later without
// a second parser appearing here (OA-232 Tier 3.1, satellite F8). readJson names
// the file it could not read, which `JSON.parse(fs.readFileSync(...))` does not.
const { cli } = require('./place_engine.js');

// ---- naming ---------------------------------------------------------------
// NaPTAN makes every Greater London locality a child of "London" -- Uxbridge and
// Heathrow Airport among them -- and London is a region, not a place a bus sheet
// sends anyone to, so a locality is never climbed to it. Measured on the first run
// of this rule, where Beaconsfield's Uxbridge and Heathrow spokes both came out as
// "London".
const NOT_A_DESTINATION = new Set(['London']);

// The settlement a reader would call a stop, from NaPTAN's [locality, parent]:
//   * the place's own town proper        -> the town (labelClusters decides whether
//     that spoke is "the town centre");
//   * a district of the place's own town -> the district (Eynesbury, Micklefield),
//     because inside your own town the district is the useful answer;
//   * a district of any other town       -> that town (Newnham -> Cambridge), because
//     from outside it the town is.
// null when NaPTAN does not know the stop; the caller then uses the stop name.
function placeName(atco, loc, town) {
  const l = loc && loc[atco];
  if (!l || !l[0]) return null;
  const [name, parent] = l;
  if (parent && parent !== town && !NOT_A_DESTINATION.has(parent)) return parent;
  return name;
}

// The most common value, ties to the first seen.
function modal(xs) {
  const cnt = new Map();
  for (const x of xs) cnt.set(x, (cnt.get(x) || 0) + 1);
  let best = null, n = 0;
  for (const [x, c] of cnt) if (c > n) { best = x; n = c; }
  return best;
}

// Label each cluster: its modal settlement, else its modal stop name. Where several
// spokes land on one settlement, the one most routes reach (ties to the first found)
// keeps the bare name and the rest are told apart by their stop -- Godmanchester
// ships "Huntingdon" beside "Hinchingbrooke Hospital", Ely ships one "Cambridge". A
// spoke into the place's OWN town is "<Town> town centre" only when it is the only
// one; High Wycombe's places reach five corners of their own town, and calling
// Orchard Road and Adams Park the town centre would be wrong.
function labelClusters(groups, town) {
  const out = groups.map(g => {
    const named = g.map(e => e.place).filter(Boolean);
    return { label: named.length ? modal(named) : modal(g.map(e => e.name)),
      stop: modal(g.map(e => e.name)), routes: new Set(g.map(e => e.route)).size };
  });
  const by = {};
  out.forEach((o, i) => { (by[o.label] = by[o.label] || []).push(i); });
  const names = out.map(o => o.label);
  for (const [label, idx] of Object.entries(by)) {
    if (idx.length === 1) { if (town && label === town) names[idx[0]] = `${town} town centre`; continue; }
    const keep = town && label === town ? -1
      : idx.reduce((b, i) => out[i].routes > out[b].routes ? i : b, idx[0]);
    for (const i of idx) if (i !== keep && out[i].stop !== label) names[i] = `${label} (${out[i].stop})`;
  }
  return names;
}

// ---- main() ---------------------------------------------------------------
// OA-323, Tier 4.1 for the place skill: the body below runs only when this file is
// RUN, never when it is required, so make-bus-leaflet/test/place_assets_load.test.js
// can ask the cheapest question there is — does it LOAD. Nothing inside is
// re-indented; the diff has to read as "a scope was added".
function main() {

const args = cli.parseArgs(process.argv.slice(2));
const a = args._;
const LOC = args.localities ? cli.readJson(args.localities) : null;
const full = cli.readJson(a[0]);
const ll = cli.readJson(a[1]);
const nm = cli.readJson(a[2]);
const place = cli.readJson(a[3]);
const CLUSTER_KM = parseFloat(a[4] || '1.2');
const OUT = a[5] || 'destinations.draft.json';

const PLAT = place.lat, PLON = place.lon;
const WALK = (place.walkshedM || 500) / 1000;   // km — an end inside this is "the place itself"
const kc = Math.cos(PLAT * Math.PI / 180);
function km(la1, lo1, la2, lo2) {
  return Math.hypot((la2 - la1) * 111.320, (lo2 - lo1) * 111.320 * kc);
}
function bearing(la1, lo1, la2, lo2) {
  const y = Math.sin((lo2 - lo1) * Math.PI / 180) * Math.cos(la2 * Math.PI / 180);
  const x = Math.cos(la1 * Math.PI / 180) * Math.sin(la2 * Math.PI / 180) -
    Math.sin(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.cos((lo2 - lo1) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// 1. reachable end-points, one per (route, direction)
const eps = [];        // {route, atco, lat, lon, name, distKm}
const localLoops = [];
for (const route in full) {
  const dirs = full[route].directions || [];
  const reached = [];
  for (const d of dirs) {
    const chain = d.stops.filter(a => ll[a]);
    if (!chain.length) continue;
    let end = chain[chain.length - 1];
    if (km(PLAT, PLON, ll[end][0], ll[end][1]) <= WALK) end = chain[0];  // route ends AT the place
    const [la, lo] = ll[end];
    const dk = km(PLAT, PLON, la, lo);
    if (dk <= WALK) continue;    // still inside the walkshed => not a real destination
    reached.push({ route, atco: end, lat: la, lon: lo, name: nm[end] || end,
      place: placeName(end, LOC, place.town), distKm: dk });
  }
  if (!reached.length) { localLoops.push(route); continue; }
  // dedup identical ends within a route
  const seen = new Set();
  for (const r of reached) { if (seen.has(r.atco)) continue; seen.add(r.atco); eps.push(r); }
}

// 2. geographic clustering (simple union by proximity)
const parent = eps.map((_, i) => i);
const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
const union = (a, b) => { parent[find(a)] = find(b); };
for (let i = 0; i < eps.length; i++)
  for (let j = i + 1; j < eps.length; j++)
    if (km(eps[i].lat, eps[i].lon, eps[j].lat, eps[j].lon) <= CLUSTER_KM) union(i, j);

const groups = {};
eps.forEach((e, i) => { (groups[find(i)] = groups[find(i)] || []).push(e); });

// 3. build destinations
const glist = Object.values(groups);
const labels = labelClusters(glist, LOC && place.town);
const dests = glist.map((g, gi) => {
  const clat = g.reduce((s, e) => s + e.lat, 0) / g.length;
  const clon = g.reduce((s, e) => s + e.lon, 0) / g.length;
  const label = labels[gi];
  const routes = [...new Set(g.map(e => e.route))].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  return {
    name: label,
    routes,
    bearing: Math.round(bearing(PLAT, PLON, clat, clon)),
    distKm: Math.round(km(PLAT, PLON, clat, clon) * 10) / 10,
    side: "up",
    _members: g.map(e => `${e.route}:${e.name}`),
  };
}).sort((a, b) => a.distKm - b.distKm);

fs.writeFileSync(OUT, JSON.stringify({ place: place.name, center: [PLAT, PLON],
  clusterKm: CLUSTER_KM, ...(LOC ? { naming: 'locality' } : {}), destinations: dests, localLoops }, null, 1));

console.log(`# Destination aggregation — ${place.name}  (clusterKm ${CLUSTER_KM})`);
console.log(`${dests.length} destination(s):`);
for (const d of dests)
  console.log(`  ${d.name.padEnd(26)} ${String(d.bearing).padStart(3)}°  ${String(d.distKm).padStart(5)}km  routes ${d.routes.join(', ')}`);
if (localLoops.length) console.log(`Local loops (no outside destination): ${localLoops.join(', ')}`);
console.log(`Wrote ${OUT}`);
}

if (require.main === module) main();
module.exports = { main, placeName, labelClusters };
