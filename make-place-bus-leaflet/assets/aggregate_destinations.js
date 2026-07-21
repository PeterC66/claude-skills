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
//   3. Each cluster becomes a destination: label = its most common stop name,
//      bearing = true bearing from the place to the cluster centroid, routes = every
//      route reaching it, distKm = distance. Pure local loops (both ends in the
//      walkshed) are reported separately, not drawn as spokes.
// The result is a DRAFT for human review (per the skill's "suggest, then confirm"
// rule) — merge/relabel clusters, then paste into routes.json `destinations`.
//
// Usage: node aggregate_destinations.js <routes_full.json> <atco2ll.json> <atco2name.json> <place.json> [clusterKm] [out]
const fs = require('fs');
const full = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ll = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const nm = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const place = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));
const CLUSTER_KM = parseFloat(process.argv[6] || '1.2');
const OUT = process.argv[7] || 'destinations.draft.json';

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
    reached.push({ route, atco: end, lat: la, lon: lo, name: nm[end] || end, distKm: dk });
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
const dests = Object.values(groups).map(g => {
  const clat = g.reduce((s, e) => s + e.lat, 0) / g.length;
  const clon = g.reduce((s, e) => s + e.lon, 0) / g.length;
  const cnt = {};
  g.forEach(e => { cnt[e.name] = (cnt[e.name] || 0) + 1; });
  const label = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
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
  clusterKm: CLUSTER_KM, destinations: dests, localLoops }, null, 1));

console.log(`# Destination aggregation — ${place.name}  (clusterKm ${CLUSTER_KM})`);
console.log(`${dests.length} destination(s):`);
for (const d of dests)
  console.log(`  ${d.name.padEnd(26)} ${String(d.bearing).padStart(3)}°  ${String(d.distKm).padStart(5)}km  routes ${d.routes.join(', ')}`);
if (localLoops.length) console.log(`Local loops (no outside destination): ${localLoops.join(', ')}`);
console.log(`Wrote ${OUT}`);
