#!/usr/bin/env node
/*
 * s1_drawn_check.js — every service S1 decided into a map has a home on the sheet,
 * asked at S4 so a decided route that S3 forgot fails the build (buses-data OA-655,
 * 2026-10-21).
 *
 *   node assets/s1_drawn_check.js --dir "<an S4 run folder>"
 *   node assets/s1_drawn_check.js --dir "<an S4 run folder>" --map "<the map's folder>"
 *
 * Run from `make-bus-leaflet/`. `--dir` is an S4 run folder holding routes.json;
 * `--map` is the map folder whose manifest.json names the S1 runs and whose
 * `ci-reference/` is the published config, and defaults to the folder two above
 * `--dir`, as via_build_check.js does. It reads and never writes. stdout carries one
 * message per line; exit 0 when no gap is new, 1 when one is, 2 on a usage error.
 *
 * WHY. Huntingdon's X1, RH3 and VL14 were added in S1 on 6 September and were absent
 * from S3 until v7.0 on 12 October, while four S6 runs passed over them; five maps in
 * all (class 3 of buses-data's s6-lessons-for-s1-to-s4_2026-10-17.md). Before this
 * file the only things comparing S1's services with S3's routes were S6 and the
 * monthly refresh grade, both after the sheet had shipped.
 *
 * A HOME IS ONE OF FOUR, and each is a declaration somebody wrote: `routeOrder` (a
 * line), `panelOrder` (a Services row), `notShown` (a row with no line), or the
 * known-off set read through known_off.js — `notOnLeaflet[]` in the S1 file for a
 * town, in S3's routes.json for a place. Where routes.json has a `boardingPlan`, the
 * routes its boarding_index.json stands list and its `excludeRoutes` are homes too
 * (OA-660). Not the whole pull: the index leaves off services by its own rule, and
 * St Neots Town Centre's 18A is on no part of its sheets. A service is matched by its
 * `key` where it has one and by its route number otherwise (index_guard.js: one
 * number can be two services). Two S1 entries need no home: `servesTown: false`, which S6 pairs with
 * the red team, and `drawn: false`, S1 saying so itself.
 *
 * NOT `hasGtfsShape: false`, though a demand-responsive zone carries it and has no line
 * to draw. Huntingdon's X1, RH3 and VL14, the case this file exists for, carry it too
 * (no BODS shape, `notInBods`), and in a place's raw gtfs-services.json it is on most
 * services; exempting it would have silenced the fault. A Dial-a-Ride the sheet
 * carries in a `mapNotes` line is tied to the claims register by `fact`, not to a
 * route, so it still wants `notOnLeaflet[]` saying the note carries it.
 *
 * NEW BLOCKS, ALREADY SHIPPED WARNS, the split via_build_check.js makes and for the
 * same reason. Measured on 2026-10-21 over every committed map's newest S4, none is
 * refused and thirteen publish a service with no home (the Dial-a-Rides carried in a
 * note, High Wycombe's limited and coach services, the place maps' raw-pull variants
 * and school runs). Blocking those would refuse the unattended
 * refresh of each for a gap the refresh did not make. So the gap is compared with
 * the PUBLISHED build: a service missing now that the published routes.json also
 * lacked, and that the S1 the published build came from already listed, shipped
 * that way and is WARN. Anything else is this build's doing and BLOCKING — a service
 * S1 has gained since the published build (Huntingdon's case), or one the published
 * sheet carried and this build dropped. The published S1 is found through the
 * manifest: S4's latest run, its `basedOn.S3`, that run's `basedOn.S1`. Where that
 * chain is broken the published routes.json alone is the baseline. A map with no
 * `ci-reference/` has published nothing, so every gap is new.
 *
 * A PLACE'S SERVICES ARE IN S2. Five place maps keep only place.json in S1 and pull
 * gtfs-services.json into S2, so where an S1 run has no services file the S2 run of
 * the same build answers: for this build, the S2 its S4 run names (S2's latest before
 * the manifest holds it); for the published one, the newest S4's `basedOn.S2`
 * (buses-data OA-660).
 *
 * NO MANIFEST, NO FINDING. CI's fixtures carry no S1 runs, so there the check says
 * nothing rather than change every log build_s4.test.js compares.
 *
 * Outside every engine hash: `build_s4.js` calls it and no generator requires it, so
 * a change here re-stamps no map and needs no portal re-vendor.
 *
 * Zero dependencies (Node core only).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { knownOff } = require('./known_off');
const { normRoute } = require('./redteam_agree');
const { mapDirOf } = require('./via_build_check');

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const S1_FILES = ['verified-services.json', 'gtfs-services.json'];

const runOf = (manifest, stage, id) => {
  const s = manifest && manifest.stages && manifest.stages[stage];
  return (s && id && (s.runs || []).find(r => r.id === id)) || null;
};

// One stage run's services file, by run id; null when the run or the file is missing.
function servicesOf(map, manifest, stage, id) {
  const run = runOf(manifest, stage, id);
  if (!run) return null;
  for (const name of S1_FILES) {
    const v = readJSON(path.join(map, run.dir, name));
    if (v) return { id, stage, name, verified: v };
  }
  return null;
}

// The services S1 decided, by S1 run id. A place map keeps only place.json in S1 and
// pulls its services into S2, so where the S1 run has none the S2 run `s2Id` answers
// (buses-data OA-660: five place maps read "not checked" until this fallback).
function s1Of(map, manifest, id, s2Id = null) {
  return servicesOf(map, manifest, 'S1', id) || servicesOf(map, manifest, 'S2', s2Id);
}

// The S1 run the published build came from: S4 latest -> basedOn.S3 -> basedOn.S1.
function publishedS1Id(manifest) {
  const st = (manifest && manifest.stages) || {};
  const s4 = runOf(manifest, 'S4', st.S4 && st.S4.latest);
  const s3 = runOf(manifest, 'S3', s4 && s4.basedOn && s4.basedOn.S3);
  return (s3 && s3.basedOn && s3.basedOn.S1) || null;
}

// The S2 run the published build came from: S4 latest -> basedOn.S2, else its S3's.
function publishedS2Id(manifest) {
  const st = (manifest && manifest.stages) || {};
  const s4 = runOf(manifest, 'S4', st.S4 && st.S4.latest);
  const s3 = runOf(manifest, 'S3', s4 && s4.basedOn && s4.basedOn.S3);
  return (s4 && s4.basedOn && s4.basedOn.S2) || (s3 && s3.basedOn && s3.basedOn.S2) || null;
}

// The S2 run this build is drawn from: the one its own S4 run names once the manifest
// holds it, else S2's latest, which is what stage.js pulls into a new S4.
function currentS2Id(manifest, dir) {
  const st = (manifest && manifest.stages) || {};
  const s4 = runOf(manifest, 'S4', path.basename(dir));
  return (s4 && s4.basedOn && s4.basedOn.S2) || (st.S2 && st.S2.latest) || null;
}

const needsHome = s => s && s.servesTown !== false && s.drawn !== false;
const idOf = s => normRoute(String(s.key || s.route || ''));

// Every route or key routes.json gives a home, plus the known-off set of both files.
// A boarding sheet is a home too: the routes its stands list in `folder`'s
// boarding_index.json, and the ones boardingPlan.excludeRoutes declares off it. High
// Wycombe High Street has no routeOrder at all, only a boarding sheet (OA-660).
function homes(routes, verified, folder) {
  const set = new Set();
  const bp = routes && routes.boardingPlan;
  if (bp) {
    const ix = folder ? readJSON(path.join(folder, 'boarding_index.json')) : null;
    for (const r of bp.excludeRoutes || []) set.add(normRoute(String(r)));
    for (const st of (ix && ix.stands) || []) for (const r of st.routes || []) set.add(normRoute(String(r)));
  }
  for (const f of ['routeOrder', 'panelOrder', 'notShown']) for (const r of (routes && routes[f]) || []) set.add(normRoute(String(r)));
  for (const src of [verified, routes]) for (const r of knownOff(src || {}).found.keys()) set.add(normRoute(r));
  return set;
}
const housed = (set, s) => set.has(idOf(s)) || set.has(normRoute(String(s.route || '')));

/**
 * Check one S4 run folder. Returns `{ messages, fresh, shipped, notRun }`: `messages`
 * are build_log lines, one per service with no home, BLOCKING for `fresh` and WARN
 * for `shipped`. `mapDir` is for a rollout's scratch dry run, as in via_build_check.
 */
function s1DrawnCheck({ dir, routesJson = null, mapDir } = {}) {
  const none = why => ({ messages: [], fresh: [], shipped: [], notRun: why });
  const rj = routesJson || readJSON(path.join(dir, 'routes.json'));
  if (!rj) return none('no routes.json');
  const map = mapDir === undefined ? mapDirOf(dir) : mapDir;
  if (!map) return none('no map folder above the run folder');
  const manifest = readJSON(path.join(map, 'manifest.json'));
  const s1 = manifest && manifest.stages && manifest.stages.S1;
  const now = s1Of(map, manifest, s1 && s1.latest, currentS2Id(manifest, dir));
  if (!now) return none('no services file in the map\'s newest S1 run, nor in the S2 run this build is drawn from');

  const here = homes(rj, now.verified, dir);
  const published = readJSON(path.join(map, 'ci-reference', 'routes.json'));
  // Like for like: S2's list is a baseline only for a build that read S2's list, since a
  // map with services in S1 and a broken chain has a different list in S2 (St Neots
  // Tesco Extra's 18A read as new until this test).
  const pubS2 = now.stage === 'S2' ? publishedS2Id(manifest) : null;
  const pubS1 = published ? s1Of(map, manifest, publishedS1Id(manifest), pubS2) : null;
  const before = published ? homes(published, pubS1 ? pubS1.verified : now.verified, path.join(map, 'ci-reference')) : null;
  const listedBefore = pubS1 ? new Set((pubS1.verified.services || []).filter(needsHome).map(idOf)) : null;

  const fresh = [], shipped = [], messages = [];
  for (const s of now.verified.services || []) {
    if (!needsHome(s) || !idOf(s) || housed(here, s)) continue;
    const label = s.key && s.key !== s.route ? `${s.route} (key ${s.key})` : String(s.route);
    const wasShipped = before && !housed(before, s) && (!listedBefore || listedBefore.has(idOf(s)));
    if (wasShipped) {
      shipped.push(s);
      messages.push(`s1: route ${label} is in S1's services (${now.name}, ${now.id}) and on no part of the published sheet either, `
        + 'so it shipped that way and does not stop this build. Give it a home: routeOrder, notShown, or notOnLeaflet[] with a reason (buses-data OA-655).');
    } else {
      fresh.push(s);
      messages.push(`s1: route ${label} is in S1's services (${now.name}, ${now.id}) but not drawn: it is in none of routes.json `
        + 'routeOrder, panelOrder or notShown, nor in notOnLeaflet[]. This build introduced the gap (buses-data OA-655): '
        + 'add it to routeOrder, declare it notShown, or record it in notOnLeaflet[] with a reason.');
    }
  }
  return { messages, fresh, shipped, notRun: null };
}

if (require.main === module) {
  const { parseArgs } = require('./cli.js');
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.dir !== 'string') {
    console.error('s1_drawn_check.js: --dir "<an S4 run folder>" is required');
    process.exit(2);
  }
  const dir = path.resolve(args.dir);
  const r = s1DrawnCheck({ dir, mapDir: typeof args.map === 'string' ? path.resolve(args.map) : undefined });
  if (r.notRun) console.log(`s1: not checked — ${r.notRun}`);
  for (const m of r.messages) console.log(m);
  console.log(`s1: ${r.fresh.length} new, ${r.shipped.length} already published`);
  process.exit(r.fresh.length ? 1 : 0);
}

module.exports = { s1DrawnCheck, publishedS1Id, publishedS2Id };
