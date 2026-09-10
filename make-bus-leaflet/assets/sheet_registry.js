#!/usr/bin/env node
/*
 * sheet_registry.js — the one list of sheets this engine can draw (OA-098).
 *
 * WHY THIS EXISTS. Every step of the delivery path used to name the sheet
 * basenames by hand, and nothing warned when one fell behind. `boarding.jpg` was
 * rendered, committed to S5 and verified on 2026-08-22, and still never reached
 * `_latest` — purely because `refresh_latest.js` held an array of four entries and
 * the engine had started making five. Nothing was red. `_latest` simply held one
 * fewer file than the build had produced, which looks exactly like a map that has
 * no boarding sheet. `rollout_places.js` was a third instance of the same fault,
 * fixed on 2026-08-23.
 *
 * MEASURED 2026-08-28, across every consumer that names a sheet:
 *
 *   render_sweep.js     5 sheets, DERIVED from routes.json — the one that was right
 *   refresh_latest.js   5 basenames, hand-written, currently complete
 *   collect-maps.ps1    5 in its ValidateSet; its -All path runs 4 for an area and
 *                       5 for a place, so an AREA boarding plan would be skipped
 *   preview_design.js   2 opt-in sheets — boarding is ABSENT, and four maps have one
 *
 * So the list was not merely duplicated, it had already diverged in two places at
 * once, in different directions, with every gate green. The shape is *two lists
 * that must agree*: each consumer is complete and correct on its own terms.
 *
 * The derivation below is render_sweep.js's, lifted unchanged: a sheet is part of
 * a map when it is unconditional, or when routes.json carries its opt-in key.
 * That is the whole contract, and it is deliberately about the map's DECLARATION
 * rather than about which files happen to be on disk — a file that is missing
 * because a build failed must not read as a sheet the map never wanted, which is
 * the distinction status.js spells out as MISSING vs '-'.
 *
 * Usage (from anywhere; no arguments take a placeholder):
 *   node sheet_registry.js                       list every sheet, one per line
 *   node sheet_registry.js --basenames jpg       just the .jpg basenames
 *   node sheet_registry.js --basenames svg       just the .svg basenames
 *   node sheet_registry.js --check-consumers <path to collect-maps.ps1>
 *                                                verify that script's own lists
 *                                                still match this one
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
'use strict';
const fs = require('fs');

/*
 * The sheets, in delivery order. `optIn` is the routes.json key that asks for the
 * sheet; a sheet with no `optIn` is drawn for every map.
 *
 * ADDING A SHEET MEANS ADDING IT HERE, AND ONLY HERE. If you find yourself typing
 * a basename into a second file, that second file is the bug this module exists to
 * prevent — import from here, or add a row to --check-consumers for a file that
 * genuinely cannot import (collect-maps.ps1 is the only one today, being
 * PowerShell in a different repository).
 *
 * `sidecar` is the unplaced-label file that sheet's generator writes BESIDE it in
 * the run folder, and it is declared rather than derived because it is not a
 * function of the basename: `internal` writes `unplaced.json` and
 * `internal-schematic` writes `unplaced-schematic.json`. It joined the row on
 * 2026-09-10, when the same five names were found typed out a second time in
 * quality_metrics.js — the exact shape the header above says this module exists to
 * prevent — and when the rollout was found carrying a dropped sheet's sidecar
 * forward for ever (see seed_prev_s4.js).
 */
const SHEETS = [
  { key: 'internal',  base: 'internal',           optIn: null,                level: 'both',  sidecar: 'unplaced.json' },
  { key: 'external',  base: 'external',           optIn: null,                level: 'both',  sidecar: 'unplaced-external.json' },
  { key: 'schematic', base: 'internal-schematic', optIn: 'internalSchematic', level: 'both',  sidecar: 'unplaced-schematic.json' },
  { key: 'diagram',   base: 'internal-diagram',   optIn: 'internalDiagram',   level: 'both',  sidecar: 'unplaced-diagram.json' },
  { key: 'boarding',  base: 'boarding',           optIn: 'boardingPlan',      level: 'place', sidecar: 'unplaced-boarding.json' },
];

/*
 * THE SIDECAR CONTRACT, stated once so both readers can quote it: every generator
 * writes its sidecar when it dropped a label and UNLINKS it when it dropped none,
 * so an ABSENT sidecar means zero and a PRESENT one is this build's answer. That
 * contract is kept by a generator that runs. It says nothing about a sheet that is
 * no longer built at all — and on 2026-09-10, when the tube-map diagram was parked
 * (buses-data OA-297 P0-B), `unplaced-diagram.json` sat in the new Beaconsfield and
 * High Wycombe S4 runs carrying the PREVIOUS run's mtime, because the rollout seeds
 * a new build from the previous S4's `.json` files and nothing was left to unlink
 * it. It had to be deleted by hand before `sync_ci_reference.js` wrote it into the
 * tracked golden master, where it would have been gated against for ever as though
 * something had produced it.
 */
const SIDECARS = new Set(SHEETS.map(s => s.sidecar).filter(Boolean));

/** The sidecar the sheet with this BASENAME writes, or null for a basename this engine does not draw. */
function sidecarFor(base) {
  const s = SHEETS.find(x => x.base === base);
  return (s && s.sidecar) || null;
}

/*
 * `level` is not a preference, it is a structural fact, and it was measured rather
 * than assumed. The first version of the consumer check below had no `level` and
 * duly reported that collect-maps.ps1's -All path "never collects boarding for
 * level area" -- which is true, and correct, and not a fault. gen_boarding.js
 * reads place.json on its way in, which only a place build has, and rollout.js
 * (the AREA rollout) contains the string "boarding" zero times. An area cannot
 * have a boarding plan, so a consumer that does not look for one on an area is
 * right and the checker was about to cry wolf about the only real-looking finding
 * it had. Establish which side owns the claim before making the other side agree.
 *
 * One consequence worth knowing and NOT fixed here: render_sweep.js derives
 * boarding from routes.json's `boardingPlan` with no level test, so an AREA whose
 * routes.json carried that key would be handed to gen_boarding.js, which would
 * fail on the missing place.json. No area carries the key, so this is latent.
 */

/** Every sheet basename, with the extension asked for ('svg' | 'jpg'). */
function basenames(ext = 'svg') {
  return SHEETS.map(s => `${s.base}.${ext}`);
}

/** The sheets a map DECLARES, from its routes.json object. */
function declaredBy(routesJson, ext = 'svg') {
  const rj = routesJson || {};
  return SHEETS.filter(s => !s.optIn || rj[s.optIn])
    .map(s => ({ ...s, out: `${s.base}.${ext}` }));
}

/** The opt-in sheets only — the three a map has to ask for. */
function optional(ext = 'svg') {
  return SHEETS.filter(s => s.optIn).map(s => ({ ...s, out: `${s.base}.${ext}` }));
}

/*
 * collect-maps.ps1 lives in the buses-data repository and is PowerShell, so it
 * cannot require() this file and should not shell out to node on every run just to
 * learn five strings. It keeps its own literal lists; this reads them back and
 * refuses to agree that they are fine when they are not. A local check, not a CI
 * gate — the two repositories are not checked out together in CI, and saying so is
 * better than wiring it to something that always passes.
 */
function checkPowershellConsumer(ps1Path) {
  const src = fs.readFileSync(ps1Path, 'utf8');
  const findings = [];
  const keys = SHEETS.map(s => s.base);

  // Anchor on the ValidateSet that decorates $Type. The script has two, and an
  // earlier version of this check took the first one it found -- the -Level set of
  // 'area','place' -- and reported all five sheets missing plus two invented ones.
  // A checker that names the wrong list is worse than none: seven of its eight
  // findings were noise, and the one real finding was the last line of the eight.
  const vs = src.match(/\[ValidateSet\(([^)]*)\)\]\s*\[string\]\$Type\b/);
  if (!vs) {
    findings.push('no [ValidateSet(...)] decorating $Type found — this check can no longer see the list it is meant to compare');
  } else {
    const listed = [...vs[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    for (const k of keys) if (!listed.includes(k)) findings.push(`ValidateSet is missing "${k}"`);
    for (const l of listed) if (!keys.includes(l)) findings.push(`ValidateSet has "${l}", which this engine does not draw`);
  }

  // The -All convenience path: one Sync-MapSet line per level per sheet.
  for (const level of ['area', 'place']) {
    const re = new RegExp(`Sync-MapSet\\s+-Level\\s+${level}\\s+-Type\\s+([\\w-]+)`, 'g');
    const ran = [...src.matchAll(re)].map(m => m[1]);
    if (!ran.length) { findings.push(`the -All path runs nothing for level "${level}"`); continue; }
    for (const s of SHEETS) {
      const applies = s.level === 'both' || s.level === level;
      if (applies && !ran.includes(s.base)) {
        findings.push(`the -All path never collects "${s.base}" for level "${level}"`);
      }
      if (!applies && ran.includes(s.base)) {
        findings.push(`the -All path collects "${s.base}" for level "${level}", which cannot have one`);
      }
    }
  }
  return findings;
}

if (require.main === module) {
  // The one parser (OA-232 Tier 2.5, the review's engine-pipeline N29). A flag
  // given with no value arrives as `true` rather than as `undefined`, which is
  // why each read below asks for a string before using it.
  const { parseArgs } = require('./cli.js');
  const args = parseArgs(process.argv.slice(2));
  const i = args.basenames;
  const c = args['check-consumers'];
  if (c !== undefined) {
    const p = typeof c === 'string' ? c : '';
    if (!p) { console.error('sheet_registry.js: --check-consumers needs a path to collect-maps.ps1'); process.exit(1); }
    if (!fs.existsSync(p)) { console.error('sheet_registry.js: no such file: ' + p); process.exit(1); }
    const findings = checkPowershellConsumer(p);
    console.log(`${SHEETS.length} sheets in the registry: ${SHEETS.map(s => s.key).join(', ')}`);
    if (!findings.length) { console.log(`${p} agrees with it.`); process.exit(0); }
    for (const f of findings) console.error('  ' + f);
    console.error(`\n${findings.length} FINDING(S). A sheet this engine draws that a consumer does not know about`);
    console.error('does not go missing loudly — it goes missing the way boarding.jpg did, by looking');
    console.error('exactly like a map that never had one.');
    process.exit(1);
  }
  if (i !== undefined) console.log(basenames(typeof i === 'string' ? i : 'svg').join('\n'));
  else for (const s of SHEETS) console.log(`${s.key.padEnd(10)} ${s.base.padEnd(20)} ${s.optIn ? 'opt-in via routes.json "' + s.optIn + '"' : 'always'}`);
}

module.exports = { SHEETS, SIDECARS, sidecarFor, basenames, declaredBy, optional, checkPowershellConsumer };
