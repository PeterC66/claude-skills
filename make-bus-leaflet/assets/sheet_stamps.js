'use strict';
/*
 * sheet_stamps.js — the printed sheet version (`design.sheetVersion`), in ONE
 * place, so that every route into an S4 can reach it and the stage boundary can
 * enforce it.
 *
 * WHY THIS IS A MODULE AND NOT A PRIVATE FUNCTION IN rollout_places.js (OA-161).
 *
 * It lived there, and that is precisely how a build lost it. `rollout_places.js`
 * writes two stamps into the run's own `routes.json` between seeding and
 * generating — `stampEngine()` (the engine hash) and `stampSheetVersion()` (the
 * `build N.N · date` the footer prints). A build assembled BY HAND — `stage.js
 * new S4`, `pull`, then the generators — runs neither, and nothing anywhere said
 * so at the time. St Neots Town Centre v2.13 shipped with no engine hash and no
 * footer stamp; v2.12 had `build 2.12 · 28 Aug 2026`.
 *
 * It was caught only because the v2.13→v2.14 label diff came back TOO clean: the
 * build stamp is a text element, it should have changed between two versions,
 * and it had not changed because neither version had one. The byte gate cannot
 * catch this and the reason is worth stating precisely — `sync_ci_reference.js`
 * mirrors the S4 run into `ci-reference/`, and the gate reproduces the sheet
 * from `ci-reference` and compares. Both sides come from the same unstamped
 * inputs, agree exactly, and the gate goes green. A gate that regenerates an
 * artefact from its own committed inputs can never notice an input missing from
 * both; that is the named shape *seeded from what it polices*.
 *
 * ---- what the stamp IS ----------------------------------------------------
 *
 * Peter, 2026-08-19: a sheet needs a version he can quote back when something on
 * it looks wrong, and the three places a sheet can come from need three
 * different answers. This is the FIRST of them — a map built here, before it has
 * ever reached the portal — and it says so in as many words, so it can never be
 * mistaken for the portal's customer-facing number. The other two (a portal
 * draft, and a published version) are the portal's to stamp, via
 * LEAFLET_SHEET_VERSION. Measured on delivery 2026-08-29: the portal's override
 * does work, so this stamp's blast radius is a sheet held locally, printed or
 * sent to somebody directly, plus every stage record in between.
 *
 * Written into the RUN'S OWN routes.json rather than passed as an environment
 * variable, and that is the whole reason it works: gate.sh reproduces a sheet
 * from its data folder and nothing else, so a value in routes.json is
 * reproducible and a value in the environment would make every gate DIFF for
 * ever.
 *
 * The date comes from the run folder's NAME, not from the clock — same reason
 * the generators may not read the clock at all (invariant 5, deterministic
 * output).
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
const fs = require('fs');

const _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `build 2.14 · 29 Aug 2026` from a run dir named `v2.14_2026-08-29_1530`, or null. */
function buildStamp(runDirName) {
  const m = /v([\d.]+)_(\d{4})-(\d{2})-(\d{2})/.exec(String(runDirName || ''));
  if (!m) return null;
  return `build ${m[1]} \u00b7 ${+m[4]} ${_MON[+m[3] - 1]} ${m[2]}`;
}

/** Write `design.sheetVersion` into routesPath from the run dir's name. Returns the stamp, or null. */
function stampSheetVersion(routesPath, runDirName) {
  const stamp = buildStamp(runDirName);
  if (!stamp) return null;
  let rj;
  try { rj = JSON.parse(fs.readFileSync(routesPath, 'utf8')); } catch (e) { return null; }
  rj.design = rj.design || {};
  rj.design.sheetVersion = stamp;
  fs.writeFileSync(routesPath, JSON.stringify(rj, null, 2) + '\n');
  return stamp;
}

/**
 * Which of the two S4 stamps a routes.json is missing.
 * @returns {string[]} some of ['engine', 'design.sheetVersion'] — empty means stamped.
 */
function missingStamps(routesJson) {
  const miss = [];
  if (!routesJson || typeof routesJson.engine !== 'string' || !routesJson.engine) miss.push('engine');
  const sv = routesJson && routesJson.design && routesJson.design.sheetVersion;
  if (typeof sv !== 'string' || !sv) miss.push('design.sheetVersion');
  return miss;
}

module.exports = { buildStamp, stampSheetVersion, missingStamps };
