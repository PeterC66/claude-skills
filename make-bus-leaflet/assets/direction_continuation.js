/*
 * direction_continuation.js — which way does a route's chain go NEXT, past the last
 * stop the sheet draws? Read by verify_report.js's S-5 direction check.
 *
 * WHY IT EXISTS (buses-data OA-416, 2026-09-24). S-5 compares the edge stop's bearing
 * from the town anchor with the bearing to the nearest chain end, and calls more than
 * 90 degrees a route "drawn the wrong way". That assumes a route leaves town roughly
 * toward where it ends, and a real road need not: Soham's T5 leaves south-east to
 * Fordham (127) and swings south-west through Burwell to Cambridge (228), 101 apart,
 * on a sheet that draws exactly the road the bus takes. So a terminus disagreement is
 * now HARD only when this continuation disagrees too. Its stops are a few km out, not
 * twenty, so a road's curvature cannot swallow the signal the way it did for both
 * instruments measured on 2026-08-29 (references/s6-verify.md), and a buffer stop
 * that sits where the route does not go still fails both.
 *
 * NEITHER INSTRUMENT IS ENOUGH ALONE, measured over eleven towns: the continuation by
 * itself reads 153 degrees on Wisbech's EXCEL, a chain cut short to local stops, whose
 * terminus comparison reads 46. The caller asks this only after the terminus says > 90.
 *
 * THE RULE. For every direction of the full chain that calls at the edge stop, walk
 * OUTWARD from it — toward the side holding fewer drawn stops, which is the side the
 * sheet stops drawing (both sides when they tie) — and take the next stops the bus
 * calls at: at least three, on until the last is a kilometre past the edge, six at
 * most. The bearing from the anchor to the last of them is where the route goes once
 * it has left town. Of all directions the one closest to the edge bearing is kept,
 * the same "closest end" leniency the terminus check has always had, because a
 * through route's other direction heads the other way. null when the edge is a chain
 * end or sits on no direction: there is nothing beyond it to ask.
 */
'use strict';

/**
 * @param {Array<{stops:string[]}>} dirs  every direction of the route's full chain
 * @param {string} edge                   the edge stop S-5 picked
 * @param {Set<string>} drawn             the stops the sheet draws for this route
 * @param {number} bEdge                  the edge stop's bearing from the anchor
 * @param {{ll:Object, anchorLL:number[], haversineKm:Function, bearing:Function, angleDiff:Function}} geo
 * @returns {{stops:string[], bearing:number}|null}
 */
function continuationBearing(dirs, edge, drawn, bEdge, geo) {
  const { ll, anchorLL, haversineKm, bearing, angleDiff } = geo;
  let best = null;
  for (const d of dirs) {
    const i = d.stops.indexOf(edge);
    if (i < 0) continue;
    let before = 0, after = 0;
    for (let j = 0; j < d.stops.length; j++) if (j !== i && drawn.has(d.stops[j])) (j < i ? before++ : after++);
    const steps = before === after ? [1, -1] : [after < before ? 1 : -1];
    for (const step of steps) {
      const got = [];
      for (let j = i + step; j >= 0 && j < d.stops.length && got.length < 6; j += step) {
        const a = d.stops[j];
        if (!ll[a] || drawn.has(a)) continue;
        got.push(a);
        if (got.length >= 3 && haversineKm(ll[edge], ll[a]) >= 1) break;
      }
      if (!got.length) continue;
      const b = bearing(anchorLL, ll[got[got.length - 1]]);
      if (!best || angleDiff(bEdge, b) < angleDiff(bEdge, best.bearing)) best = { stops: got, bearing: b };
    }
  }
  return best;
}

module.exports = { continuationBearing };
