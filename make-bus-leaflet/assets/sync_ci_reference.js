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
 *                                   [--place "<Place name>"]
 * (no --town/--place: sync every town + every place). `--town` takes a town and its
 * own nested places; `--place` takes one place by name and is the only way to reach
 * a STANDALONE place, which has no parent town to be named by.
 */
const fs = require('fs');
const path = require('path');
const { parseArgs, resolveBuses } = require('./cli');
const { findTowns, findPlaces, readJson, latestRunDir } = require('./gate_lib');
const { lfBytes } = require('./line_endings');

const args = parseArgs(process.argv.slice(2));
const BUSES = resolveBuses(args);

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
  // Only *.json (generator inputs, via gate_lib's copyJsons) and
  // *.svg (the reference output gate() diffs against) are ever read from
  // this folder — everything else an S4 run dir accumulates (saved bustimes
  // HTML pages, .ql overpass queries, stray scripts) is debug residue with
  // no role in the gate, so leave it out of what gets tracked in git.
  for (const name of fs.readdirSync(s4.dir)) {
    const p = path.join(s4.dir, name);
    if (fs.statSync(p).isDirectory()) continue;
    if (!/\.(json|svg)$/i.test(name)) continue;
    // WRITTEN WITH LF, WHATEVER WROTE THE S4 RUN (2026-08-28, the other half of
    // OA-146). ci-reference/ is a tracked BYTE FIXTURE, and buses-data now covers
    // it with `-text` so that a checkout cannot translate it — which is the fix
    // for the twenty maps that read DIFF in a fresh clone on Windows. But `-text`
    // also switches off the normalising `core.autocrlf` was doing on the way IN,
    // and an S4 run dir is not all node's work: the Python tools write their JSON
    // in text mode, so on Windows those files carry CRLF. A plain copyFileSync
    // then puts CRLF into the fixture, and the first sync after the attribute
    // landed produced 75 files of pure line-ending churn against 7 real changes.
    //
    // Normalising here makes the stored bytes a property of the CONTENT rather
    // than of the platform that generated the run — the same lesson as the engine
    // hash (OA-073). It is inert for the artefacts the gate actually diffs: every
    // S4 SVG is written by node and already carries no CR at all, measured across
    // March, St Ives and Huntingdon on the day this was added.
    fs.writeFileSync(path.join(dest, name), lfBytes(fs.readFileSync(p)));
    n++;
  }
  return { status: 'OK', detail: `${n} files from ${s4.rec.id} (v${s4.rec.version})` };
}

const allTowns = findTowns(BUSES);
const allPlaces = findPlaces(allTowns, BUSES);
const targetTownName = args.town;
// `--place` exists because a STANDALONE place has no parent town to be named by, so
// `--town` cannot reach it at all. rollout_places.js used to sync with `--town
// p.town`, which is null for such a place; it now passes `--place p.name`, which
// works for both layouts.
const targetPlaceName = typeof args.place === 'string' ? args.place : null;
let towns, places;
if (targetPlaceName) {
  towns = [];
  places = allPlaces.filter(p => p.name === targetPlaceName);
  if (!places.length) {
    console.error('No place named "' + targetPlaceName + '". Known: ' + allPlaces.map(p => p.name).join(', '));
    process.exit(2);
  }
} else {
  towns = targetTownName ? allTowns.filter(t => t.name === targetTownName) : allTowns;
  places = targetTownName ? allPlaces.filter(p => p.town === targetTownName) : allPlaces;
  if (targetTownName && !towns.length) {
    console.error('No town named "' + targetTownName + '". Known: ' + allTowns.map(t => t.name).join(', '));
    process.exit(2);
  }
}

let bad = false;
for (const t of towns) {
  const r = syncOne(t.dir);
  console.log(`${t.name}: ${r.status} — ${r.detail}`);
  if (r.status === 'SKIP' && r.detail.startsWith('latest S4')) bad = true;
}
for (const p of places) {
  const r = syncOne(p.dir);
  console.log(`${p.town || '(standalone)'} / ${p.name}: ${r.status} — ${r.detail}`);
  if (r.status === 'SKIP' && r.detail.startsWith('latest S4')) bad = true;
}
process.exit(bad ? 1 : 0);
