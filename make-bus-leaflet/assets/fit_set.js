/*
 * fit_set.js — which stops the internal map is scaled to fit.
 *
 * CONTRACT. `fitSet({ routes, atco2ll, ir, intownCfg, routePaths, prefix })`
 * returns `{ stopPts, excluded, limit }`: the [lat,lon] list the caller fits the
 * frame to, how many stops the off-path rule removed (0 when it did not act),
 * and the distance it used. It reads no files and writes nothing — the caller
 * owns the warning, so its wording stays next to the other build messages.
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3).
 *
 * TWO MODELS. Classic (`ir` null) fits ALL drawn stops. internalRoads fits only
 * the town-core stops — locality prefix plus extraCore — so out-of-town tails
 * run off the frame edge, clipped with "to X" arrows, instead of shrinking the
 * town to fit them in.
 *
 * FIT TO WHAT YOU DRAW (plan sec 4.2, 2026-08-15), which is the whole reason
 * this is more than two loops. Membership of the core set is decided by ATCO
 * prefix — by which parish a stop is in — and that is not the same question as
 * "does this map draw anything there?". Under internalRoads the route line comes
 * from the matched road graph, and where the graph stops, the line stops; a
 * served stop beyond that end is in the fit and has no ink.
 *
 * Ramsey shipped six of them: Middle Drove, Ugg Mere Court Road, Fisher Close,
 * Ashbeach Drove, Lion Close and Daintree Road, all on X31 out to Ramsey St
 * Mary's, all 2.7–3.6 km from any drawn line. They stretched the fit box from
 * 75 mm wide to 141 mm, so the map was scaled down and pushed right: the whole
 * LEFT THIRD of the frame held no route ink at all, and the town was drawn 8%
 * smaller than it needed to be, to make room for six stops nobody can see.
 *
 * Measured on all eight towns, the separation is not close. Six have every core
 * stop within 79 m of a drawn line; High Wycombe's worst is 929 m, because its
 * corridor bundling and coreBox move lines away from stops ON PURPOSE (see
 * complexity-triage.md, and do not "fix" that); Ramsey's six sit at 2.7 km
 * upwards with nothing in between. 1500 m is the middle of that gap.
 *
 * AND THE RULE REFUSES TO EMPTY THE FIT. If almost everything is off-path the
 * road match is broken, and shrinking the fit to the survivors would hide that
 * behind a map that still looks plausible. Fewer than three survivors and the
 * rule declines to act at all.
 */
'use strict';

/** Metres from point p to the segment a→b, on a local equirectangular plane. */
function offMetres(p, a, b) {
  const kx = 111320 * Math.cos(a[0] * Math.PI / 180);
  const bx = (b[1]-a[1])*kx, by = (b[0]-a[0])*111320, px = (p[1]-a[1])*kx, py = (p[0]-a[0])*111320;
  const L2 = bx*bx + by*by;
  if (!L2) return Math.hypot(px, py);
  let t = (px*bx + py*by) / L2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t*bx, py - t*by);
}

function fitSet({ routes, atco2ll, ir, intownCfg, routePaths, prefix }) {
  const ICFG = intownCfg || {};
  const stopPts = [];
  if (!ir) {
    // Classic model: every drawn stop, duplicates and all — the fit only ever
    // looks at the extremes, so de-duplicating here would be work for nothing.
    for (const r in routes) for (const a of routes[r]) if (atco2ll[a]) stopPts.push(atco2ll[a]);
    return { stopPts, excluded: 0, limit: 0 };
  }
  const xc = new Set(ir.fitExtra || ICFG.extraCore || []);
  const fseen = new Set();
  for (const r in routes) for (const a of routes[r]) {
    if (fseen.has(a) || !atco2ll[a]) continue;
    fseen.add(a);
    if (a.startsWith(prefix) || xc.has(a)) stopPts.push(atco2ll[a]);
  }
  const OFFPATH = ir.fitMaxOffPath != null ? ir.fitMaxOffPath : 1500;
  const psegs = [];
  for (const r in ((routePaths && routePaths.routes) || {})) {
    const p = routePaths.routes[r].pts || [];
    for (let i = 1; i < p.length; i++) psegs.push([p[i-1], p[i]]);
  }
  if (OFFPATH > 0 && psegs.length) {
    const near = [], far = [];
    for (const s of stopPts) {
      let d = Infinity;
      for (const g of psegs) { const x = offMetres(s, g[0], g[1]); if (x < d) { d = x; if (d <= OFFPATH) break; } }
      (d <= OFFPATH ? near : far).push(s);
    }
    if (far.length && near.length >= 3) {
      stopPts.length = 0; stopPts.push(...near);
      return { stopPts, excluded: far.length, limit: OFFPATH };
    }
  }
  return { stopPts, excluded: 0, limit: OFFPATH };
}

module.exports = { fitSet, offMetres };
