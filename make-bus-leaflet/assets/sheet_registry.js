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
 */
const SHEETS = [
  { key: 'internal',  base: 'internal',           optIn: null,                level: 'both' },
  { key: 'external',  base: 'external',           optIn: null,                level: 'both' },
  { key: 'schematic', base: 'internal-schematic', optIn: 'internalSchematic', level: 'both' },
  { key: 'diagram',   base: 'internal-diagram',   optIn: 'internalDiagram',   level: 'both' },
  { key: 'boarding',  base: 'boarding',           optIn: 'boardingPlan',      level: 'place' },
];

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
  const args = process.argv.slice(2);
  const i = args.indexOf('--basenames');
  const c = args.indexOf('--check-consumers');
  if (c !== -1) {
    const p = args[c + 1];
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
  if (i !== -1) console.log(basenames(args[i + 1] || 'svg').join('\n'));
  else for (const s of SHEETS) console.log(`${s.key.padEnd(10)} ${s.base.padEnd(20)} ${s.optIn ? 'opt-in via routes.json "' + s.optIn + '"' : 'always'}`);
}

module.exports = { SHEETS, basenames, declaredBy, optional, checkPowershellConsumer };
