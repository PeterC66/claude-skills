'use strict';
/* WHICH ROUTES DO THE TWO SHEETS ACTUALLY DRAW? (OA-048, 2026-09-19.)
 *
 * `displayed` is the population every coverage percentage in verification.json is
 * struck over, so a route in it that no sheet draws makes every one of those figures
 * wrong — and a coverage figure is an arithmetic identity over a population, which is
 * the one kind of error no amount of care inside the checks can absorb.
 *
 * A MODULE, NOT LINES IN verify_report.js, for the same two reasons window_contiguity.js
 * is one: the OA-001 rule is logic in a module and wiring in the caller, and the
 * explanation this needs put that file over its line-ratchet ceiling. verify_report.js
 * is outside the engine-hash closure and so is this, so moving it costs no map its stamp.
 *
 * THE FAULT IT REPLACES. `displayed` was narrowed under OA-004 so that dropping a route
 * from the config would clear findings about it, and the narrowing could not bite:
 * `drawnByConfig` was `palette + routeOrder`, and the palette was unioned back in
 * unconditionally two lines later. A route is dropped from `routeOrder` while KEEPING
 * its palette entry precisely because the colour is what its legend badge is drawn
 * with, so the very case the narrowing existed for was the case that defeated it. Same
 * shape as `the comment wider than its code`, one turn further round: the guard is
 * narrower than its comment claims and the line below it puts back what it removed.
 *
 * WHAT IS AUTHORITATIVE IS THE GENERATORS, so both halves below are taken from them
 * rather than restated here:
 *   - the internal sheet draws `dropHidden(RJ.routeOrder || Object.keys(C))`
 *     (gen_internal.js) — an EITHER/OR, never a union, so `routeOrder` is the whole
 *     answer whenever the config states one;
 *   - an external spoke draws `_badges = b.routes?.length ? b.routes : [b.route]`
 *     (gen_external_radial.js), because several services can share one spoke to a
 *     destination and each gets its own badge drawn on it.
 *
 * THE SECOND HALF IS LOAD-BEARING, AND THAT WAS MEASURED RATHER THAN ASSUMED. Doing the
 * first alone — the obvious fix — reads only `external[].route` and drops every service
 * riding on another's spoke: on High Wycombe that is 334, LHR and OXF, all three drawn.
 * With both halves that town goes 34 -> 30, losing exactly the four routes that have a
 * line on neither sheet and exist only as a legend badge and a line of prose in a map
 * note; without the second it goes to 27 and the fix has traded one wrong denominator
 * for another. Every other town in the estate is a no-op, palette and routeOrder being
 * the same size in each. The full measurement is claude-skills#58.
 *
 * NOT HONOURED HERE: `dropHidden`'s hidden-operator filter. No town in the estate sets
 * `hiddenOperators`, and a filter with no instance cannot be falsified against real
 * data; a town that set one would over-count by that operator's routes. Said here
 * rather than left for the next reader to re-derive from the generators.
 */

/* The badges one external or busway entry draws — gen_external_radial.js `_badges`. */
function spokeBadges(entry) {
  return (Array.isArray(entry.routes) && entry.routes.length) ? entry.routes : [entry.route];
}

/*
 * `routes`  — the S3 routes.json (palette, routeOrder, external[], busway[])
 * `intown`  — the S2 routes_intown_atco.json, keyed by route
 * `norm`    — the caller's route-key normaliser, injected rather than duplicated here
 *             so that one spelling of it governs the whole report.
 */
function displayedRoutes({ routes, intown, norm }) {
  const palette = routes.palette || {};
  const drawnInternal = new Set(
    ((routes.routeOrder && routes.routeOrder.length) ? routes.routeOrder : Object.keys(palette)).map(norm));
  const displayed = new Set();
  // A route with in-town geometry is displayed only where the internal sheet draws it.
  for (const r of Object.keys(intown || {})) if (!drawnInternal.size || drawnInternal.has(norm(r))) displayed.add(norm(r));
  // Every badge on every spoke — a line on the external sheet is a line.
  for (const e of (routes.external || [])) for (const r of spokeBadges(e)) displayed.add(norm(r));
  for (const e of (routes.busway || [])) for (const r of spokeBadges(e)) displayed.add(norm(r));
  // And the internal draw order itself, so a route the config draws is displayed even
  // where S2 gave it no in-town chain; that is a different fault, and the no-full-chain
  // check is the one that reports it.
  for (const r of drawnInternal) displayed.add(r);
  return { displayed, drawnInternal };
}

module.exports = { displayedRoutes, spokeBadges };
