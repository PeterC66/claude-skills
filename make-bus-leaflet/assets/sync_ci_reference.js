#!/usr/bin/env node
/*
 * sync_ci_reference.js — mirror each town/place's LATEST S4-generate run into
 * a small tracked `ci-reference/` folder beside it.
 *
 * Areas/**\/S4-generate/** (and Places/**\/S4-generate/**) are gitignored —
 * they're the 88%-of-repo-bulk rebuildable output, kept locally but never
 * pushed (see the .gitignore header). That's correct for repo size, but it
 * means a fresh CI clone has nothing to gate a fresh regeneration against —
 * status.js's whole point is catching "engine changed, town wasn't
 * re-rendered", which needs the last-published SVG + the JSON snapshot that
 * produced it.
 *
 * ci-reference/ is the fix: a full copy of just the LATEST run's files (not
 * the history of older runs S4-generate keeps), small enough to track in git
 * (~30MB total across all towns+places today, vs ~167MB for the full
 * S4-generate history) and NOT covered by any existing gitignore rule, so it
 * commits normally. gate_lib.js's latestRunDir() falls back to this folder
 * when the real S4-generate run dir isn't present on disk (the CI case) —
 * locally, where S4-generate is real, this file is never consulted by the
 * gates themselves; only THIS script writes to it.
 *
 * Run after any real S4 commit (rollout.js's --apply path calls this
 * automatically). Safe to re-run any time — it just overwrites the folder
 * with whatever the manifest currently calls "latest".
 *
 * Usage: node sync_ci_reference.js [--buses "<Buses dir>"] [--town "<Name>"]
 * (no --town: sync every town + every place)
 */
const fs = require('fs');
const path = require('path');
const { findTowns, findPlaces, readJson, latestRunDir } = require('./gate_lib');

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) f[argv[i].slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
  return f;
}
const args = parseArgs(process.argv.slice(2));
const BUSES = path.resolve(args.buses || 'C:/u3a St Ives/Using AI/Buses');

function syncOne(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { status: 'SKIP', detail: 'no manifest.json' };
  const m = readJson(manifestPath);
  const s4 = latestRunDir(m, dir, 'S4');
  if (!s4) return { status: 'SKIP', detail: 'no S4 run committed yet' };
  if (path.basename(s4.dir) === 'ci-reference') return { status: 'SKIP', detail: 'S4-generate missing on disk, already reading ci-reference (nothing to sync FROM)' };
  if (!fs.existsSync(s4.dir)) return { status: 'SKIP', detail: 'latest S4 run dir missing on disk: ' + s4.dir };

  const dest = path.join(dir, 'ci-reference');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  // Only *.json (generator inputs, via gate_lib's copyJsonsAndIcons) and
  // *.svg (the reference output gate() diffs against) are ever read from
  // this folder — everything else an S4 run dir accumulates (saved bustimes
  // HTML pages, .ql overpass queries, stray scripts) is debug residue with
  // no role in the gate, so leave it out of what gets tracked in git.
  for (const name of fs.readdirSync(s4.dir)) {
    const p = path.join(s4.dir, name);
    if (fs.statSync(p).isDirectory()) continue;
    if (!/\.(json|svg)$/i.test(name)) continue;
    fs.copyFileSync(p, path.join(dest, name));
    n++;
  }
  return { status: 'OK', detail: `${n} files from ${s4.rec.id} (v${s4.rec.version})` };
}

const allTowns = findTowns(BUSES);
const allPlaces = findPlaces(allTowns);
const targetTownName = args.town;
const towns = targetTownName ? allTowns.filter(t => t.name === targetTownName) : allTowns;
const places = targetTownName ? allPlaces.filter(p => p.town === targetTownName) : allPlaces;

if (targetTownName && !towns.length) {
  console.error('No town named "' + targetTownName + '". Known: ' + allTowns.map(t => t.name).join(', '));
  process.exit(2);
}

let bad = false;
for (const t of towns) {
  const r = syncOne(t.dir);
  console.log(`${t.name}: ${r.status} — ${r.detail}`);
  if (r.status === 'SKIP' && r.detail.startsWith('latest S4')) bad = true;
}
for (const p of places) {
  const r = syncOne(p.dir);
  console.log(`${p.town} / ${p.name}: ${r.status} — ${r.detail}`);
  if (r.status === 'SKIP' && r.detail.startsWith('latest S4')) bad = true;
}
process.exit(bad ? 1 : 0);
