/*
 * fixture_donor.js — is this town the source of the portal's AREA fixture, and so
 * judged against engine.lock.json's pin rather than against the live template?
 * (buses-data OA-532, 2026-09-30)
 *
 * `Areas/_portal-fixture/<Town>` is a copy of one town's newest S5 render, vendored
 * into the portal and asked about by status.js's `area-fixture` row and the push
 * preflight. The town it copies moves only together with a pin bump: rebuilt onto an
 * engine the pin has not adopted, its render no longer matches the fixture and the
 * preflight finds the fixture files BEHIND. Nothing in the tools knew that. On
 * 2026-09-30 the worklist offered St Ives an ordinary `engine-rebuild` row against
 * the live template, `rollout.js --town "St Ives" --apply --rebuild-stale` rebuilt it
 * on claude-skills 1c5bd5e without a word, and the preflight found the area fixture
 * six files behind (buses-data 7a8d6925, reverted in af074f30).
 *
 * DERIVED, NOT NAMED. The donor is whichever town has a folder under
 * `Areas/_portal-fixture/`, so a fixture recut from another town moves the rule with
 * it — a name typed here is the trap prove-red-status.js's pickDonor() describes.
 *
 * Pure reads of two paths; no git, no network.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/* The pinned town-template hash, or null when the estate has no readable pin — a
 * fixture repository, a scratch estate. Null means "no pin to judge against", and
 * every caller then treats the town as it treats any other. */
function pinnedEngine(buses) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(buses, 'engine.lock.json'), 'utf8'));
    return typeof lock.engine === 'string' && lock.engine ? lock.engine : null;
  } catch { return null; }
}

function isFixtureDonor(buses, town) {
  if (!town || town.startsWith('_')) return false;
  try { return fs.statSync(path.join(buses, 'Areas', '_portal-fixture', town)).isDirectory(); }
  catch { return false; }
}

/* { donor, pin } for a town: `pin` is set only when the town IS the donor AND the
 * estate pins an engine, which is the one case the callers change behaviour for. */
function fixtureDonor(buses, town) {
  if (!isFixtureDonor(buses, town)) return { donor: false, pin: null };
  return { donor: true, pin: pinnedEngine(buses) };
}

module.exports = { pinnedEngine, isFixtureDonor, fixtureDonor };
