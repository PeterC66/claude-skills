#!/usr/bin/env node
/*
 * place_verified_services.js — S6 adapter for places.
 *
 * verify_report.js (the shared S1..S6 engine's stage) hard-requires a town-shaped
 * `verified-services.json` (route/operator/termini/days + a `servesTown` flag). Places
 * never produce that file — their S1 output is `gtfs-services.json`, a raw BODS pull
 * near the point, with different field names and no servesTown flag. Without this
 * adapter S6 fails immediately with "missing required input verified-services.json"
 * for every place (this was true of ALL places, not just one — S6 had never been run
 * on any of them before 2026-08-08).
 *
 * This reads gtfs-services.json (+ place.json, routes.json for context) from the CWD
 * and writes a verified-services.json the existing engine can consume unmodified,
 * reinterpreting "servesTown" as "calls at the place" (P1's --near radius filter
 * already limits gtfs-services.json to routes with a stop inside the walkshed, so
 * true is the correct default for every entry it lists).
 *
 * Usage: node place_verified_services.js   (run from the S6 run dir, after
 *        `stage.js pull S1 .` has landed gtfs-services.json + place.json there)
 */
const fs = require('fs');

function readJSON(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

const gtfs = readJSON('gtfs-services.json');
const place = fs.existsSync('place.json') ? readJSON('place.json') : null;
const routes = fs.existsSync('routes.json') ? readJSON('routes.json') : {};

function normRoute(r) { return String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/*
 * Termini, and why they are stamped rather than trusted.
 *
 * gtfs-services.json carries RAW BODS HEADSIGNS ("Market Square", "Tesco", "Bus
 * Station"). S6's S-4 check compares a declared terminus against the NaPTAN locality
 * code at the end of the drawn chain, so a headsign scores zero every time and every
 * route of every place went HARD — 10 of St Neots Town Centre's 13 hard findings on
 * 2026-08-21 were this artefact and nothing else.
 *
 * Two things are done about it here, and a third in verify_report.js:
 *
 * 1. Where routes.json's curated `destinations[]` names a place this route reaches, use
 *    those names instead — they are settlement-ish and S3-curated, so they are the same
 *    KIND of input a town's hand-verified verified-services.json supplies. Split on "/"
 *    because a place destination is often a pair ("Tesco / Eynesbury"), and the
 *    settlement half is the half that can match.
 * 2. Stamp `terminiSource` so the checker knows what it was handed. It is NOT free to
 *    treat a machine-derived headsign as a human-verified assertion.
 *
 * What is deliberately NOT done: resolving a headsign to a locality via the drawn chain
 * itself. routes_full_atco.json's direction `name` IS the headsign pair, so that would
 * check the chain against itself and pass by construction — a check that cannot fail.
 * The independent terminus signal for a place is the red-team, and verify_report.js
 * makes that comparison work instead.
 */
const destinations = Array.isArray(routes.destinations) ? routes.destinations : [];
function destinationTermini(route) {
  const key = normRoute(route);
  const names = destinations
    .filter(d => (d.routes || []).some(r => normRoute(r) === key))
    .map(d => d.name);
  const parts = [];
  for (const n of names) {
    for (const p of String(n).split('/')) {
      const t = p.trim().replace(/^the\s+/i, '');
      if (t && !parts.includes(t)) parts.push(t);
    }
  }
  return parts;
}

const out = {
  town: routes.place || (place ? `${place.name}, ${place.town}` : gtfs.town),
  verifiedOn: new Date().toISOString().slice(0, 10),
  note: 'Adapted from gtfs-services.json by place_verified_services.js — a place has no ' +
    'human-curated verified-services.json like a town does; every entry here is a BODS ' +
    'service with a stop inside the P1 walkshed radius, so servesTown:true (read as ' +
    '"calls at the place") is the correct default unless a later stage excluded it.',
  anchor: routes.anchor || null,
  anchorLabel: routes.anchorLabel || (place ? place.name : null),
  services: (gtfs.services || []).map(s => {
    const dest = destinationTermini(s.route);
    const raw = s.termini || [];
    return {
      route: s.route,
      operator: s.operator,
      days: s.days,
      status: 'live',
      servesTown: true,
      termini: dest.length ? dest : raw,
      // 'destinations' = S3-curated place names; 'gtfs-headsign' = raw BODS headsign,
      // which is NOT a settlement and must never be scored as a hard terminus mismatch.
      terminiSource: dest.length ? 'destinations' : 'gtfs-headsign',
      terminiRaw: raw,
      source: 'gtfs',
    };
  }),
};

fs.writeFileSync('verified-services.json', JSON.stringify(out, null, 2) + '\n');
console.log(`wrote verified-services.json (${out.services.length} service(s), adapted from gtfs-services.json)`);
