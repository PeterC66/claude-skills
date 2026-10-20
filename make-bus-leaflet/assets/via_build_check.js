#!/usr/bin/env node
/*
 * via_build_check.js — S6's via-on-chain check, asked at S4 so a borrowed village
 * fails the build before the sheet ships (buses-data OA-650, 2026-10-20).
 *
 *   node assets/via_build_check.js --dir "<an S4 run folder>"
 *   node assets/via_build_check.js --dir "<an S4 run folder>" --map "<the map's folder>"
 *
 * Run from `make-bus-leaflet/`. `--dir` is an S4 run folder holding routes.json and
 * S2's routes_full_atco.json; `--map` is the map folder whose `ci-reference/` is the
 * published config, and defaults to the folder two above `--dir`, which is where the
 * stage layout puts it. It reads and never writes. stdout carries one message per
 * line; exit 0 when no via is new, 1 when one is, 2 on a usage error.
 *
 * WHY. The commonest error S6 has ever corrected is a village borrowed from a
 * neighbouring route: 24 via places on eight sheets (OA-636), Huntingdon's route 9
 * (OA-631). `via_on_chain.js` catches it from S2's chains, S3's routes.json and the
 * NaPTAN register, all of which exist before S4, yet until this file it was called
 * only from `verify_report.js` — one bought or reused S6 after the sheet had shipped.
 * `build_s4.js` now asks it of every build and files what it says in
 * `build-warnings.txt`.
 *
 * NEW BLOCKS, ALREADY SHIPPED WARNS, and that split is the whole design. Measured on
 * 2026-10-20 over every committed `ci-reference/`, five maps still publish 17
 * off-chain vias that OA-636 owes (High Wycombe, Huntingdon, St Ives, The Shelfords,
 * Wisbech). Blocking those would refuse the unattended monthly refresh of all five
 * (`refresh_town.py` stops on build_s4.js's exit 3) for text the refresh did not
 * write, and OA-650 says in as many words not to do that. So a via is compared with
 * the map's published config: one this build INTRODUCED is BLOCKING, because its
 * message says the bus "never calls at" it (build_log.js's OFF_CHAIN); one already
 * in `ci-reference/` is WARN and names OA-636. A map with no `ci-reference/` yet has
 * published nothing, so everything it says is new.
 *
 * THE BASELINE IS THE CLAIM'S TEXT, NOT THE OLD CHAIN. The published routes.json is
 * read through the current S2 chain, so "was this via already on the sheet" is
 * asked of the words, which is what a reader saw. A route and a place are one key
 * whichever field carries them: a via already owed on the spoke is the same error
 * when it also appears in the Services panel.
 *
 * NO REGISTER, NO FINDING. The register is gitignored and CI's Node has no
 * node:sqlite, so there `viaOnChain` returns `notRun` and this file says nothing —
 * a WARN on every CI build would change every log `build_s4.test.js` compares. The
 * CLI prints the reason instead, and S6 still reports `via-unverifiable`.
 *
 * Outside every engine hash: `build_s4.js` calls it and no generator requires it,
 * so a change here re-stamps no map and needs no portal re-vendor.
 *
 * Zero dependencies (Node core only).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { viaOnChain, normPlace, openRegister } = require('./via_on_chain');
const { displayedRoutes } = require('./displayed_routes');
const { normRoute } = require('./redteam_agree');

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function findUp(startDir, ...rel) {
  let d = path.resolve(startDir);
  for (;;) {
    const cand = path.join(d, ...rel);
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

// The stage layout is <map>/S4-generate/<run>/, and a map folder holds manifest.json.
function mapDirOf(dir) {
  const m = path.resolve(dir, '..', '..');
  return fs.existsSync(path.join(m, 'manifest.json')) ? m : null;
}

// Every stop on a route's S2 chain, as verify_report.js's fullAllStops reads it.
function chainOfFrom(full) {
  return route => {
    const key = Object.keys(full || {}).find(k => normRoute(k) === normRoute(route));
    const fe = key ? full[key] : null;
    if (!fe) return [];
    if (Array.isArray(fe.all)) return fe.all;
    const s = new Set();
    for (const d of Object.values(fe.directions || {})) for (const a of (d && d.stops) || []) s.add(a);
    for (const d of fe.canonical || []) for (const a of (d && d.stops) || []) s.add(a);
    return [...s];
  };
}

const keyOf = o => normRoute(o.route) + '|' + normPlace(o.name);
const few = xs => xs.length > 8 ? xs.slice(0, 8).join(', ') + `, and ${xs.length - 8} more` : xs.join(', ');

/**
 * Check one S4 run folder. Returns `{ messages, fresh, shipped, notRun }`: `messages`
 * are build_log lines, one per off-chain via, BLOCKING for `fresh` and WARN for
 * `shipped`. `register` may be passed (tests do); undefined opens the NaPTAN register
 * found above the map, and null means there is none.
 */
function viaBuildCheck({ dir, routesJson = null, mapDir, register } = {}) {
  const rj = routesJson || readJSON(path.join(dir, 'routes.json'));
  const full = readJSON(path.join(dir, 'routes_full_atco.json'));
  const none = why => ({ messages: [], fresh: [], shipped: [], notRun: why });
  if (!rj) return none('no routes.json');
  if (!full) return none('no routes_full_atco.json in the run folder');
  const map = mapDir === undefined ? mapDirOf(dir) : mapDir;
  const reg = register !== undefined ? register
    : openRegister(process.env.VERIFY_NAPTAN || findUp(map || dir, '_gtfs', 'naptan.sqlite'));
  const intown = readJSON(path.join(dir, 'routes_intown_atco.json')) || {};
  const { displayed } = displayedRoutes({ routes: rj, intown, norm: normRoute });
  const chainOf = chainOfFrom(full);
  const now = viaOnChain({ routes: rj, displayed, norm: normRoute, chainOf, register: reg });
  if (now.notRun) return none(now.notRun);

  const published = map ? readJSON(path.join(map, 'ci-reference', 'routes.json')) : null;
  const before = published
    ? new Set(viaOnChain({ routes: published, displayed, norm: normRoute, chainOf, register: reg }).offChain.map(keyOf))
    : new Set();

  const fresh = [], shipped = [], messages = [];
  for (const o of now.offChain) {
    const where = `${o.where}; its chain's localities are ${few(o.chainLocalities)}`;
    if (before.has(keyOf(o))) {
      shipped.push(o);
      messages.push(`via: route ${o.route} is sent through ${o.name} (${where}), which is on none of its own chain's stops. `
        + 'It is already on the published sheet, so it is owed by buses-data OA-636 and does not stop this build.');
    } else {
      fresh.push(o);
      messages.push(`via: route ${o.route} is sent through ${o.name} (${where}), a NaPTAN locality the bus never calls at. `
        + 'This build introduced it (buses-data OA-650): fix the spoke stops or the Services text in routes.json.');
    }
  }
  return { messages, fresh, shipped, notRun: null };
}

if (require.main === module) {
  const { parseArgs } = require('./cli.js');
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.dir !== 'string') {
    console.error('via_build_check.js: --dir "<an S4 run folder>" is required');
    process.exit(2);
  }
  const dir = path.resolve(args.dir);
  const r = viaBuildCheck({ dir, mapDir: typeof args.map === 'string' ? path.resolve(args.map) : undefined });
  if (r.notRun) console.log(`via: not checked — ${r.notRun}`);
  for (const m of r.messages) console.log(m);
  console.log(`via: ${r.fresh.length} new, ${r.shipped.length} already published`);
  process.exit(r.fresh.length ? 1 : 0);
}

module.exports = { viaBuildCheck, mapDirOf, chainOfFrom };
