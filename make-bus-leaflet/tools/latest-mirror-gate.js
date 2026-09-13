#!/usr/bin/env node
/*
 * latest-mirror-gate.js — a map's `_latest/verification.docx` must be the report
 * of the S6 run that map's own manifest calls current (OA-329).
 *
 * Run from make-bus-leaflet:  node tools/latest-mirror-gate.js
 * Optional: --buses "<dir>" to point at a different buses-data checkout, and
 * --json to print the payload instead of the board. There are no other
 * arguments and no placeholders; the default is the real checkout on this
 * machine, and an unknown flag is refused by name with exit 2.
 *
 * WHY THIS EXISTS, and why it could only be added once the estate was clean.
 * `<map>/_latest/` is the folder a PERSON opens to find a map's current
 * deliverables; `refresh_latest.js` fills it and is a tool somebody runs by
 * hand, so nothing in the S6 path refreshes it. On 2026-09-13 thirteen of the
 * twenty maps carried a superseded verification report there and two towns
 * carried the report of a PLACE inside them — a current, true statement about a
 * different map, in the folder that means *this one*. Every instrument in the
 * estate looked at the run folder: `status.js` reads S6 staleness off the
 * manifest, the byte gates compare `ci-reference/`, `check-s6-claims.mjs` reads
 * `verification.json` from the newest run. The folder a person opens was the one
 * nothing read.
 *
 * THE SUBJECT SURVIVES `actions/checkout`, WHICH IS WHY THIS RUNS IN CI.
 * `.gitignore` re-includes `*.docx` from inside the stage folders, so both sides
 * of the comparison — the S6 run's `verification.docx` and the mirror's — are
 * tracked. That is the question `CLAUDE.md` says to ask before writing any
 * check, and here the answer is yes, unlike `staleInputs()` whose subject is a
 * working tree.
 *
 * IT COMPARES HASHES, NEVER SIZES. March's mirror and March's current report
 * were both 38,590 bytes and were different files on the day the fault was
 * measured, so a check written on size would have called that row clean — the
 * same trap as *the diff that called them binary*.
 *
 * A WRONG MAP IS REPORTED AS A WRONG MAP, not as a stale one. Every
 * `verification.docx` under every map is hashed once, so when a mirror matches
 * no run of its own map the gate can say whose report it actually is. The two
 * faults want different fixes — a stale mirror is a refresh, a foreign one was
 * `newestUnder()` descending into `Places/` — and a single verdict covering both
 * would hide the worse one inside the commoner one.
 *
 * WHAT IS DELIBERATELY NOT A FINDING, each for a stated reason.
 *   - A map with no S6 run at all. Godmanchester Co-op Ermine Street has never
 *     had one and may not buy one this round (Peter, 2026-09-07). Whether a map
 *     owes an S6 is the `s6-stale-places` worklist row's question, not this
 *     one's, and answering it here would redden the estate over a decision
 *     somebody has already taken.
 *   - `disagreements.docx`. It has TWO lineages under a map — the S1 run that
 *     writes it and the S6 run that copies it — and six of the seven mirrors
 *     that carry one hold a file from an older S1 than the manifest's current
 *     run, simply because the current run wrote none. Whether a mirror should
 *     carry a stage's output when the current run produced none is an open
 *     question (OA-329), and a gate must not answer a question by failing.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveBuses } = require('../assets/cli');
const { readJson } = require('../assets/cli');
const G = require('../assets/gate_lib');

const KNOWN = new Set(['--buses', '--json']);
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  if (!KNOWN.has(a)) {
    console.error(`latest-mirror-gate: unknown flag ${a}. Known flags: ${[...KNOWN].join(', ')}`);
    process.exit(2);
  }
  if (a === '--buses') i++;
}
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const JSON_OUT = argv.includes('--json');
const BUSES = resolveBuses({ buses: argOf('buses') });

const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

/* Every map, by the one enumeration (gate_lib), so a place under a town, a place
 * at Places/<Place>/ and a place under a bucket are all in the population. The
 * first version of the sweep that found this fault stopped descending at the
 * first manifest.json and measured 10 maps of 20. */
const towns = G.findTowns(BUSES);
const maps = [
  ...towns.map(t => ({ name: t.name, kind: 'town', dir: t.dir })),
  ...G.findPlaces(towns, BUSES).map(p => ({ name: p.name, kind: 'place', dir: p.dir })),
].sort((a, b) => a.name.localeCompare(b.name));

/* Hash every verification.docx in the estate ONCE, so a mirror that belongs to
 * another map can be named rather than merely called different. */
const owners = new Map();   // sha1 -> [ 'Map (run id)' ]
for (const m of maps) {
  const s6 = path.join(m.dir, 'S6-verify');
  let runs = [];
  try { runs = fs.readdirSync(s6, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { continue; }
  for (const r of runs) {
    const f = path.join(s6, r, 'verification.docx');
    if (!fs.existsSync(f)) continue;
    const h = sha1(f);
    if (!owners.has(h)) owners.set(h, []);
    owners.get(h).push(`${m.name} (${r})`);
  }
}

const rows = [];
for (const m of maps) {
  const manifest = readJson(path.join(m.dir, 'manifest.json'), null);
  const row = { map: m.name, kind: m.kind, verdict: null, detail: '' };
  if (!manifest) { row.verdict = 'NO-MANIFEST'; rows.push(row); continue; }
  const latest = G.latestRunDir(manifest, m.dir, 'S6');   // { dir, rec }, or null
  if (!latest) { row.verdict = 'NO-S6'; rows.push(row); continue; }
  const runDir = latest.dir;
  row.run = latest.rec.id;
  const report = path.join(runDir, 'verification.docx');
  if (!fs.existsSync(report)) {
    row.verdict = 'NO-REPORT';
    row.detail = `the current S6 run ${row.run} holds no verification.docx`;
    rows.push(row); continue;
  }
  const mirror = path.join(m.dir, '_latest', 'verification.docx');
  if (!fs.existsSync(mirror)) {
    row.verdict = 'MISSING';
    row.detail = `_latest/ carries no verification.docx, while S6 run ${row.run} has one`;
    rows.push(row); continue;
  }
  const want = sha1(report), got = sha1(mirror);
  if (want === got) { row.verdict = 'MATCH'; rows.push(row); continue; }
  const who = (owners.get(got) || []).filter(x => !x.startsWith(m.name + ' ('));
  if (who.length) {
    row.verdict = 'WRONG-MAP';
    row.detail = `_latest/verification.docx is ${who.join(', ')}, not this map's own S6 run ${row.run}`;
  } else {
    row.verdict = 'STALE';
    const mine = (owners.get(got) || []);
    row.detail = mine.length
      ? `_latest/verification.docx is this map's ${mine.join(', ')}, superseded by S6 run ${row.run}`
      : `_latest/verification.docx matches no S6 run of this map; the current run is ${row.run}`;
  }
  rows.push(row);
}

const findings = rows.filter(r => !['MATCH', 'NO-S6'].includes(r.verdict));
if (JSON_OUT) {
  console.log(JSON.stringify({ buses: BUSES, maps: rows.length, findings: findings.length, rows }, null, 2));
} else {
  console.log(`_latest mirror gate — ${rows.length} map(s) under ${BUSES}`);
  for (const r of rows) {
    if (r.verdict === 'MATCH') continue;
    if (r.verdict === 'NO-S6') { console.log(`  ----  ${r.map} — no S6 run, so no mirror is owed`); continue; }
    console.log(`  FAIL  ${r.map} — ${r.verdict}: ${r.detail}`);
  }
  const match = rows.filter(r => r.verdict === 'MATCH').length;
  const noS6 = rows.filter(r => r.verdict === 'NO-S6').length;
  console.log(`  ${match} mirror(s) current, ${noS6} map(s) with no S6, ${findings.length} finding(s)`);
}
process.exit(findings.length ? 1 : 0);
