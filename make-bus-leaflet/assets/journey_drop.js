/*
 * journey_drop.js — the stops journey_weights.json says to take off a route's LINE
 * (buses-data OA-452).
 *
 * `journey_weights.py` (S2 step 3b) lists, per route and per direction, the stops
 * fewer than half of the journeys passing them call at. `derive_intown.js` drops
 * them from the displayed chain, which moves the TICKS. But `match_routes.js`
 * builds the LINE from the canonical direction in `routes_full_atco.json`, and so
 * does `pull_roads.js`'s reachExtend — neither read the file, so on St Neots v5.0
 * the ticks followed the 18's majority pattern while the line still ran the
 * 7-of-25 Eynesbury working and the 3-of-25 station loop. The build needed
 * `match_cfg.json viaExclude["18"]` set by hand to the same 24 stops (buses-data
 * a4d3cc3e). This module is what both of them now read instead.
 *
 * The rule is the one derive_intown.js applies: the file sits beside
 * routes_full_atco.json, and `"journeyWeights": false` in intown_cfg.json turns it
 * off for a town. An S2 folder without the file returns an empty set for every
 * route, so every map built without one is byte-identical.
 *
 * It is applied to the CANONICAL direction only, by that direction's name. The
 * `viaChain: "intown"` chain is already derive_intown's output, and subtracting one
 * direction's minority stops from a chain that merges both would take off a stop
 * the other direction's majority calls at.
 */
const fs = require('fs');
const path = require('path');

function loadJourneyDrops(dir) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'intown_cfg.json'), 'utf8')); } catch (e) { /* absent: on */ }
  let jw = null;
  if (cfg.journeyWeights !== false) {
    try { jw = JSON.parse(fs.readFileSync(path.join(dir, 'journey_weights.json'), 'utf8')); } catch (e) { jw = null; }
  }
  return (route, dirName) => new Set((((jw || {})[route] || {})[dirName] || {}).drop || []);
}

module.exports = { loadJourneyDrops };
