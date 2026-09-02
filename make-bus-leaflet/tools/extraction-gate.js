#!/usr/bin/env node
/*
 * extraction-gate.js — the 27-second byte gate for an in-progress refactor.
 *
 *   node tools/extraction-gate.js --baseline    record the current verdicts
 *   node tools/extraction-gate.js               compare against them
 *   node tools/extraction-gate.js --show        print the baseline and exit
 *
 * Run from `make-bus-leaflet/`. --buses and --portal override the two paths
 * below; there are no other parameters.
 *
 * WHY, given `status.js` already exists. The full board prints twenty maps'
 * worth of rows plus the quality ratchet, the vendoring table, S6 staleness and
 * a live-site fetch, and a human reads it. During an extraction the only
 * question is "did any sheet move?", asked after EVERY extraction rather than
 * at the end — so this reduces `status.js --json` to its 74 sheet verdicts (68
 * map sheets plus the two portal fixtures), diffs them against a stored
 * baseline, and prints only what changed. 27 seconds, which is what makes it
 * affordable per extraction instead of per session.
 *
 * THE BASELINE IS TAKEN BEFORE THE FIRST EXTRACTION, not after each one. A
 * baseline refreshed as you go can only ever say "nothing moved since the last
 * thing that moved", which is the question nobody asked.
 *
 * IT WAS FALSIFIED BEFORE IT WAS TRUSTED, AND THE FALSIFICATION FOUND A FAULT
 * IN IT. The first cut called execFileSync and let it throw — and `status.js`
 * exits 1 whenever anything on the board is red, which is precisely the case
 * this exists to see. An anchored mutation to gen_internal.js's badge() turned
 * 30 of the 74 DIFF, and this script died with a Node stack trace instead of
 * naming them. A harness that only works while everything passes is not a
 * harness; the try/catch below is the fix, and it is the point of the file.
 *
 * PORTAL DRIFT IS REPORTED, NEVER GATED. Between an engine change and the
 * re-vendor that closes it, the portal's copy is EXPECTED to differ, and a gate
 * that goes red for that teaches you to ignore it. It prints as a note instead.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveBuses } = require('../assets/cli');

const SK = path.join(__dirname, '..');
const BASE = path.join(SK, 'tools', '.extraction-gate-baseline.json');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const BUSES = resolveBuses({ buses: arg('buses') });
const PORTAL = arg('portal', 'C:/Claude/community-bus-maps');

if (process.argv.includes('--show')) {
  if (!fs.existsSync(BASE)) { console.error('no baseline recorded'); process.exit(2); }
  console.log(fs.readFileSync(BASE, 'utf8'));
  process.exit(0);
}

// status.js exits 1 whenever anything on the board is red. Take its stdout
// either way: see the header.
let out;
try {
  out = execFileSync(process.execPath, [
    path.join(SK, 'assets/status.js'), '--json', '--buses', BUSES, '--portal', PORTAL,
  ], { cwd: SK, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  out = e.stdout;
  if (!out) {
    console.error('status.js produced no stdout at all — this is not a red board, it is a broken run:');
    console.error(e.stderr || e.message);
    process.exit(2);
  }
}

const j = JSON.parse(out);
const verdicts = {};
const take = (row, prefix, keys) => {
  for (const k of keys) if (row[k] !== undefined) verdicts[`${prefix}/${k}`] = row[k];
};
for (const t of j.towns || []) take(t, t.name, ['internal', 'external', 'schematic', 'diagram', 'boarding']);
for (const p of j.places || []) take(p, p.name, ['internal', 'external', 'schematic', 'diagram', 'boarding']);
for (const f of j.portalFixtures || []) take(f, `fixture:${f.name}`, ['internal', 'external', 'boarding']);

const drift = (j.portalDrift || []).filter((d) => !d.same).map((d) => d.file);
if (drift.length) console.log(`(portal drift, expected until the re-vendor: ${drift.join(', ')})`);

const n = Object.keys(verdicts).length;

if (process.argv.includes('--baseline')) {
  fs.writeFileSync(BASE, JSON.stringify(verdicts, null, 1) + '\n');
  const bad = Object.entries(verdicts).filter(([, v]) => v !== 'PASS' && v !== '-');
  console.log(`baseline written: ${n} sheet verdicts`);
  // A baseline recorded off a board that is already red will happily stay green
  // through an extraction that keeps it red, so say so out loud.
  console.log(bad.length
    ? `⚠ the baseline is NOT all green — ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}. Fix that first, or this gate can only prove you did not make it worse.`
    : 'every sheet PASS or n/a — a clean baseline');
  process.exit(0);
}

if (!fs.existsSync(BASE)) {
  console.error('no baseline: run `node tools/extraction-gate.js --baseline` BEFORE the first extraction.');
  process.exit(2);
}
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const changed = [];
for (const k of new Set([...Object.keys(base), ...Object.keys(verdicts)])) {
  if (base[k] !== verdicts[k]) changed.push(`${k}: ${base[k] ?? '(absent)'} -> ${verdicts[k] ?? '(absent)'}`);
}
if (changed.length) {
  console.log(`GATE RED — ${changed.length} of ${n} sheet verdicts moved:`);
  for (const c of changed) console.log('  ' + c);
  process.exit(1);
}
console.log(`GATE GREEN — all ${n} sheet verdicts identical to the baseline`);
