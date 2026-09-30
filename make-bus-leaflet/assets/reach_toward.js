// reach_toward.js — the aim point for match_cfg.json's `reachToward` (buses-data OA-451 item 5).
//
// WHY THIS EXISTS. `reachExtend` carries a truncated tail out to the frame by adding
// the route's next REAL stops to the road pull, and that is right whenever the next
// stop is near. A non-stop continuation breaks it: St Neots East's 905 leaves Loves
// Way and calls nowhere until Cambridge, 22 km away, so `reachExtend` either adds
// nothing or pulls a road graph the size of a county — and without it the "to
// Cambridge" arrow sits at Loves Way, about 25 mm short of the frame.
//
// `reachToward: { "<route>": { "start": <km>, "end": <km> } }` is the bounded
// alternative. On the named side, a point <km> kilometres from the route's last
// in-box stop, on the straight line toward its next stop along the chain, is added
// to the pull box (pull_roads.js) and the matched line is carried along the ROAD
// GRAPH from that stop to the node nearest the point (match_routes.js). The stop
// list, the ticks and contStart/contEnd are untouched: the extension is ink beyond
// the last stop, which the frame cut then trims where the sheet ends. The km is the
// bound, so the pull grows by a known amount whatever the next stop's distance.
//
// Both callers must agree on the point, which is why it is computed here once.
'use strict';

// A point `km` along the straight line from `from` toward `toward` ([lat, lon]),
// never past `toward` itself. Local equirectangular, as kmLL in match_routes.js —
// exact enough over the few kilometres this is used for.
function aimPoint(from, toward, km) {
  const kx = 111.32 * Math.cos(from[0] * Math.PI / 180), ky = 111.32;
  const dx = (toward[1] - from[1]) * kx, dy = (toward[0] - from[0]) * ky;
  const d = Math.hypot(dx, dy);
  if (!(d > 0) || !(km > 0)) return null;
  const f = Math.min(1, km / d);
  return [from[0] + (toward[0] - from[0]) * f, from[1] + (toward[1] - from[1]) * f];
}

// The aim points for one route, given its FILTERED chain (the same stops the
// matcher would use) and a predicate saying which stops are inside the box.
// Returns { start: [lat,lon]|null, end: [lat,lon]|null }.
function aimsFor(spec, chain, ll, inBox) {
  const out = { start: null, end: null };
  if (!spec || !chain || !chain.length) return out;
  const idx = []; chain.forEach((a, i) => { if (ll[a] && inBox(ll[a])) idx.push(i); });
  if (!idx.length) return out;
  const f0 = idx[0], l0 = idx[idx.length - 1];
  if (+spec.start > 0 && f0 > 0 && ll[chain[f0 - 1]]) out.start = aimPoint(ll[chain[f0]], ll[chain[f0 - 1]], +spec.start);
  if (+spec.end > 0 && l0 < chain.length - 1 && ll[chain[l0 + 1]]) out.end = aimPoint(ll[chain[l0]], ll[chain[l0 + 1]], +spec.end);
  return out;
}

module.exports = { aimPoint, aimsFor };
