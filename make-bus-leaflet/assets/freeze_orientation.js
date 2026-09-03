#!/usr/bin/env node
/*
 * freeze_orientation.js — pin a map's orientation to the way it is drawn NOW.
 *
 *   node freeze_orientation.js --town "St Neots"            (dry run — prints only)
 *   node freeze_orientation.js --town "St Neots" --apply
 *   node freeze_orientation.js --place "St Neots Tesco Extra" --apply
 *   node freeze_orientation.js --town "March" --north --apply
 *   node freeze_orientation.js --town "March" --deg 12.5 --apply
 *   node freeze_orientation.js --town "March" --release --apply
 *
 * RUN IT FROM: anywhere. Paths are resolved from --buses, which defaults to
 *   C:\u3a St Ives\Using AI\Buses
 * (override with --buses "<path to the buses-data repo>").
 *
 * WHAT PROBLEM THIS SOLVES. By default a town's internal sheet is rotated by PCA
 * onto the principal axis of its own stop cloud, so it fills A4. That angle is
 * RE-DERIVED FROM THE DATA ON EVERY BUILD. Add a route next month, or withdraw
 * one, and the whole sheet can swing several degrees. No gate notices, because the
 * sheet is correct either way — but someone holding last month's printed copy
 * beside this month's sees a map that has visibly turned, and every hand-placed
 * label position quietly means something slightly different.
 *
 * `design.fixedOrientation` in routes.json stops that. This script is the honest
 * way to set it to "however it looks right now": it reads the angle the last real
 * build actually used, out of the build-meta.json that build wrote, and writes
 * that number into routes.json. The config then STATES the angle rather than
 * referring to a sheet that lives somewhere else.
 *
 * WHY NOT A "as-published" MAGIC VALUE. Because the generator would then have to
 * ask the portal which way up the published sheet is, at build time, over the
 * network — fragile, untestable offline, and it would make the same routes.json
 * produce different artwork depending on what happened to be published that day.
 * Resolving it ONCE, here, and writing down the answer is the version that can be
 * read, reviewed and reverted.
 *
 * WHAT IT DOES NOT DO. It does not rebuild or re-deliver anything. Freezing an
 * orientation is inert until the map's next build: the current sheets keep the
 * angle they already have (which is the whole point — the number came from them).
 */
'use strict';
const fs = require('fs');
const path = require('path');

// The one parser and the one estate resolver (OA-232 Tier 2.5, the review's
// engine-pipeline N26 and F6). This file held the LAST hard laptop default in
// the engine -- `DEFAULT_BUSES`, with no `BUSES_DIR` read in front of it -- so on
// any other machine `--buses` was the only way in and forgetting it failed
// somewhere confusing rather than saying where it had looked. `resolveBuses`
// asks the flag, then the environment, then the one named laptop path.
const { parseArgs, resolveBuses } = require('./cli.js');
const FLAGS = parseArgs(process.argv.slice(2));
const arg = (name, fallback) => (typeof FLAGS[name] === 'string' ? FLAGS[name] : fallback);
const has = (name) => name in FLAGS;

const BUSES = resolveBuses(FLAGS);
const town = arg('town', null);
const place = arg('place', null);
const APPLY = has('apply');

if (!town && !place) {
  console.error('Need --town "<Town>" or --place "<Place>". See the header of this file.');
  process.exit(2);
}
const mapDir = path.join(BUSES, town ? 'Areas' : 'Places', town || place);
if (!fs.existsSync(mapDir)) {
  console.error(`No such map directory:\n  ${mapDir}\nCheck the name, or pass --buses.`);
  process.exit(2);
}

// ---- work out the angle to write -------------------------------------------
// Three sources, in the order a person would mean them.
let deg = null;
let provenance = '';

if (has('release')) {
  deg = '__RELEASE__';
  provenance = 'releasing the pin — the map goes back to auto (PCA) orientation';
} else if (has('north')) {
  deg = 'north';
  provenance = 'north up, asked for explicitly';
} else if (arg('deg', null) != null) {
  const d = Number(arg('deg', null));
  if (!Number.isFinite(d)) { console.error(`--deg ${arg('deg', null)} is not a number.`); process.exit(2); }
  // Written through unnormalised, for the reason gen_internal.js gives at
  // FIXED_ORIENTATION: -66 and 294 are the same bearing but not the same floating
  // point, so rewriting one as the other would move the artwork very slightly.
  deg = d;
  provenance = `${deg}°, asked for explicitly`;
} else {
  // The default and the interesting case: read what the last real build used.
  const meta = findLatestBuildMeta(mapDir);
  if (!meta) {
    console.error(
      'No build-meta.json found under this map\'s S4-generate runs.\n'
      + '\n'
      + 'That file is written by gen_internal.js when rollout.js sets BUILD_META_DIR,\n'
      + 'which it has done since 2026-08-21 — so a map whose last build predates that\n'
      + 'has no recorded angle and there is nothing here to read.\n'
      + '\n'
      + 'Either rebuild the map once (the next build records it), or set the angle\n'
      + 'explicitly with --north or --deg <n>.');
    process.exit(1);
  }
  deg = meta.rotationDeg;
  provenance = `${deg}° — the angle the ${meta.builtAt.slice(0, 10)} build actually used`
    + ` (source: ${meta.orientationSource}, from ${path.relative(mapDir, meta.file)})`;
  if (meta.orientationSource === 'fixedOrientation') {
    console.log('Note: this map is ALREADY pinned — re-writing the same value is a no-op.');
  }
}

// ---- read, patch, write ------------------------------------------------------
const routesPath = path.join(mapDir, 'ci-reference', 'routes.json');
if (!fs.existsSync(routesPath)) {
  console.error(`No routes.json at:\n  ${routesPath}`);
  process.exit(2);
}
const raw = fs.readFileSync(routesPath, 'utf8');
const rj = JSON.parse(raw);
const before = (rj.design || {}).fixedOrientation;

console.log(`Map:      ${town || place}`);
console.log(`Config:   ${routesPath}`);
console.log(`Current:  design.fixedOrientation = ${before === undefined ? '(absent — auto)' : JSON.stringify(before)}`);
console.log(`Proposed: ${deg === '__RELEASE__' ? '(remove it — back to auto)' : JSON.stringify(deg)}`);
console.log(`Because:  ${provenance}`);

rj.design = rj.design || {};
if (deg === '__RELEASE__') delete rj.design.fixedOrientation;
else rj.design.fixedOrientation = deg;

const after = JSON.stringify(rj, null, 2) + '\n';
if (after === raw) { console.log('\nNo change — already exactly this.'); process.exit(0); }

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to write it.');
  console.log('The change takes effect at the map\'s NEXT build; current sheets are untouched.');
  process.exit(0);
}
fs.writeFileSync(routesPath, after);
console.log('\nWritten. It takes effect at the next build (S3 → S4 → S5) — nothing is rebuilt here.');

// ---- helpers ----------------------------------------------------------------
/**
 * Newest build-meta.json under <mapDir>/S4-generate/<run>/. Run folders are named
 * with a sortable date stamp, but mtime is used as the tie-break rather than the
 * name, so a hand-copied folder cannot masquerade as the newest build.
 */
function findLatestBuildMeta(dir) {
  const s4 = path.join(dir, 'S4-generate');
  if (!fs.existsSync(s4)) return null;
  const found = [];
  for (const run of fs.readdirSync(s4)) {
    const f = path.join(s4, run, 'build-meta.json');
    if (!fs.existsSync(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (typeof j.rotationDeg !== 'number') continue;
      found.push({ ...j, file: f, mtime: fs.statSync(f).mtimeMs });
    } catch { /* a corrupt sidecar is not worth failing the whole run over */ }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0];
}
