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

const out = {
  town: routes.place || (place ? `${place.name}, ${place.town}` : gtfs.town),
  verifiedOn: new Date().toISOString().slice(0, 10),
  note: 'Adapted from gtfs-services.json by place_verified_services.js — a place has no ' +
    'human-curated verified-services.json like a town does; every entry here is a BODS ' +
    'service with a stop inside the P1 walkshed radius, so servesTown:true (read as ' +
    '"calls at the place") is the correct default unless a later stage excluded it.',
  anchor: routes.anchor || null,
  anchorLabel: routes.anchorLabel || (place ? place.name : null),
  services: (gtfs.services || []).map(s => ({
    route: s.route,
    operator: s.operator,
    days: s.days,
    status: 'live',
    servesTown: true,
    termini: s.termini || [],
    source: 'gtfs',
  })),
};

fs.writeFileSync('verified-services.json', JSON.stringify(out, null, 2) + '\n');
console.log(`wrote verified-services.json (${out.services.length} service(s), adapted from gtfs-services.json)`);
