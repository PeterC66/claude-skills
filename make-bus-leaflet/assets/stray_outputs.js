#!/usr/bin/env node
/*
 * stray_outputs.js — find a run folder holding a file that a LATER stage declares.
 *
 * WHY THIS EXISTS (OA-164, 2026-08-29). `stage.js pull` copies the whole run
 * FOLDER; `commit` and `manifest.json` speak only of the outputs a stage
 * DECLARED. So any other file left lying in a run folder rides along on every
 * pull, and whether it does damage depends on nothing but the order the pulls
 * happen to be written in.
 *
 * It fired once. Beaconsfield Waitrose's S2 folder from 21 July holds a
 * `routes.json` it never declared -- the July draft -- and the documented P3
 * order is `pull S3` then `pull S2`, so the July draft landed on top of five
 * weeks of curated config. The sheet rebuilt clean, the byte gate said PASS, and
 * the external quietly lost every intermediate stop name, every journey time,
 * its QR code and its `checkedAt`. **The byte gate is structurally unable to see
 * this**: `ci-reference` is re-synced from the same run, so the sheet is
 * compared against itself.
 *
 * `stage.js` now refuses to let an undeclared file overwrite one already in the
 * destination, which makes these harmless. This says where they still are, so
 * "harmless" is a fact somebody has looked at rather than an assumption.
 *
 * THE SHAPE IT LOOKS FOR is narrow on purpose. A DOWNSTREAM folder holding an
 * upstream file is ordinary and everywhere -- every S4 holds the S2 geometry it
 * was built from. The dangerous direction is the other one: an EARLY stage's
 * folder holding a file that a LATER stage declares, because the documented pull
 * orders put the early stage second. Reporting the ordinary case would bury the
 * dangerous one in 700 lines of noise, which is how a check gets muted.
 *
 * REPORTED, NOT GATED, and that is a contract rather than an omission: eight such
 * files exist today across three places, the guard already stops them doing harm,
 * and a check that is red on the day it lands gets muted within the week. It
 * exits 0 unless it cannot read the estate at all. `--strict` exits 1 on any
 * find, for whoever wants that after the estate is clean.
 *
 * Run from anywhere; there are no placeholders:
 *   node stray_outputs.js --buses "<Buses dir>"      (or $BUSES_DIR — see cli.js)
 *   node stray_outputs.js --buses "<dir>" --json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, resolveBuses } = require('./cli');

const DIRN = { S1: 'S1-services', S2: 'S2-geometry', S3: 'S3-config', S4: 'S4-generate', S5: 'S5-render', S6: 'S6-verify' };
const ORDER = Object.keys(DIRN);


/* Every map on the board, found the way status.js finds them: a folder holding a
 * manifest.json. Deliberately NOT a list of known towns -- an enumeration that
 * walks past a map is this project's most-repeated bug. */
function findUnits(root) {
  const out = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (fs.existsSync(path.join(p, 'manifest.json'))) out.push(p);
      // Do not descend into a run folder or a versioned build dir.
      if (!/^S[1-6]-/.test(e.name) && !/^v\d/.test(e.name)) walk(p);
    }
  })(root);
  return out;
}

function strays(unitDir) {
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(unitDir, 'manifest.json'), 'utf8')); } catch (e) { return []; }
  const declared = {}, dirs = {};
  for (const st of ORDER) {
    const s = m.stages && m.stages[st];
    if (!s || !s.latest) continue;
    const r = (s.runs || []).find((x) => x.id === s.latest);
    if (!r) continue;
    declared[st] = new Set(r.outputs || []);
    dirs[st] = path.join(unitDir, r.dir);
  }
  const found = [];
  for (const st of Object.keys(dirs)) {
    let names;
    try { names = fs.readdirSync(dirs[st]); } catch (e) { continue; }
    for (const name of names) {
      let isFile;
      try { isFile = fs.statSync(path.join(dirs[st], name)).isFile(); } catch (e) { continue; }
      if (!isFile || declared[st].has(name)) continue;
      const later = Object.keys(declared).filter((o) => ORDER.indexOf(o) > ORDER.indexOf(st) && declared[o].has(name));
      if (later.length) found.push({ stage: st, file: name, declaredBy: later, dir: dirs[st] });
    }
  }
  return found;
}

const args = parseArgs(process.argv.slice(2));
const BUSES = resolveBuses(args);
if (!fs.existsSync(BUSES)) { console.error('stray_outputs: no such folder: ' + BUSES); process.exit(2); }

const rows = [];
for (const root of ['Areas', 'Places']) {
  const r = path.join(BUSES, root);
  if (!fs.existsSync(r)) continue;
  for (const u of findUnits(r)) for (const s of strays(u)) rows.push({ unit: path.relative(BUSES, u), ...s });
}

if (args.json) { console.log(JSON.stringify(rows, null, 1)); process.exit(args.strict && rows.length ? 1 : 0); }

if (!rows.length) {
  console.log('stray_outputs: no run folder holds a file that a later stage declares.');
  process.exit(0);
}
console.log('stray_outputs (OA-164, reported not gated) — ' + rows.length + ' file(s) a pull would have shadowed before the guard:');
for (const r of rows) console.log('  ' + r.unit.padEnd(50) + r.stage + ' holds undeclared ' + r.file + ' — declared by ' + r.declaredBy.join('/'));
console.log('\n  `stage.js pull` now refuses to let these overwrite a file already in the destination and names each skip.');
console.log('  They are listed so that "harmless" is something somebody looked at. Deleting one rewrites nothing the');
console.log('  manifest says -- an undeclared file was never that run\'s output -- but it is still a decision, not a tidy-up.');
process.exit(args.strict ? 1 : 0);
