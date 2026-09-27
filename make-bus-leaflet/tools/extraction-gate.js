#!/usr/bin/env node
/*
 * extraction-gate.js — the byte gate for an in-progress refactor.
 *
 *   node tools/extraction-gate.js --baseline    record the current state
 *   node tools/extraction-gate.js               compare against it
 *   node tools/extraction-gate.js --show        print the baseline and exit
 *
 * Run from `make-bus-leaflet/`. --buses and --portal override the two paths
 * below. Two more exist for the prove-red harness and are not needed by hand:
 * --file <path> keeps the baseline somewhere other than tools/, and
 * --swap <generator>=<path> runs that generator from <path> instead of assets/.
 *
 * IT ASKS TWO QUESTIONS, and the second is the one a refactor needs.
 *
 *   1. SHEET VERDICTS. `status.js --json` reduced to its sheet verdicts (every
 *      map sheet plus the portal fixtures), diffed against the baseline. This is
 *      what the gate was until 2026-09-27.
 *   2. TEMPLATE OUTPUT. Every sheet the board gates is redrawn by the WORKING
 *      generators — assets/ as it is on disk now — from that map's latest S4
 *      data, and a hash of what they draw is diffed against the baseline. So the
 *      question is "does the engine I am editing still draw every sheet exactly as
 *      it did before I started?", whatever engine drew the committed artwork.
 *
 * WHY THE SECOND ONE EXISTS (buses-data OA-486). Since OA-430, `status.js` gates
 * a map against the engine commit that DREW it whenever the live template does
 * not reproduce it. Every map carries an engine-rebuild row, so every map is
 * behind, so every map verdict falls through to the map's own engine and the
 * working template is never the one that answers. The portal fixtures use the
 * portal's vendored engine. So the first question alone could not move for any
 * edit in assets/: with gen_internal.js forced to smooth every casing, it printed
 * "all 119 sheet verdicts identical" while gate.js on High Wycombe turned a
 * 39.4 mm casing segment into 5.8 mm. At least one run that day reported that
 * green as evidence. `npm run test:prove-red-extraction-gate` now watches an
 * ink-moving mutation turn this red.
 *
 * THE SHEET LIST IS JOINED TO THE BOARD'S, NOT TRUSTED. Which generator draws
 * which sheet, and with which options, is written out below from status.js's
 * gateTown() and gatePlace(). A second enumeration is a silent filter waiting to
 * happen (gate_lib's findSheets() header counts four), so every run checks that
 * the sheets redrawn here are exactly the sheets the board gave a verdict, and
 * refuses with exit 2 if not. A sheet the board gates and this does not redraw
 * would otherwise be the one place an edit could hide.
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
 * harness; the try/catch below is the fix.
 *
 * PORTAL DRIFT IS REPORTED, NEVER GATED. Between an engine change and the
 * re-vendor that closes it, the portal's copy is EXPECTED to differ, and a gate
 * that goes red for that teaches you to ignore it. It prints as a note instead.
 */
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveBuses } = require('../assets/cli');
const G = require('../assets/gate_lib');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const PSK = path.join(SK, '..', 'make-place-bus-leaflet', 'assets');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BUSES = resolveBuses({ buses: arg('buses') });
const PORTAL = arg('portal', 'C:/Claude/community-bus-maps');
const BASE = path.resolve(arg('file', path.join(SK, 'tools', '.extraction-gate-baseline.json')));
const SWAP = {};
argv.forEach((a, i) => {
  if (a !== '--swap') return;
  const m = /^([^=]+)=(.+)$/.exec(argv[i + 1] || '');
  if (!m) { console.error('--swap takes <generator>=<path>, for example gen_internal.js=C:/tmp/gen_internal.js'); process.exit(2); }
  SWAP[m[1]] = path.resolve(m[2]);
});

if (argv.includes('--show')) {
  if (!fs.existsSync(BASE)) { console.error('no baseline recorded'); process.exit(2); }
  console.log(fs.readFileSync(BASE, 'utf8'));
  process.exit(0);
}

// A compare with no usable baseline is refused BEFORE the minute of work below.
let base = null;
if (!argv.includes('--baseline')) {
  if (!fs.existsSync(BASE)) {
    console.error('no baseline: run `node tools/extraction-gate.js --baseline` BEFORE the first extraction.');
    process.exit(2);
  }
  base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  if (!base.templates || !base.verdicts) {
    console.error('this baseline predates the template comparison (OA-486) and holds verdicts only — take it again with --baseline, from the engine you started from.');
    process.exit(2);
  }
}

// ---- question 1: the board's sheet verdicts ---------------------------------
// status.js exits 1 whenever anything on the board is red. Take its stdout
// either way: see the header.
let out;
try {
  out = execFileSync(process.execPath, [
    path.join(ASSETS, 'status.js'), '--json', '--buses', BUSES, '--portal', PORTAL,
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
const SHEETS = ['internal', 'external', 'schematic', 'diagram', 'boarding'];
const verdicts = {};
const take = (row, prefix, keys) => {
  for (const k of keys) if (row[k] !== undefined) verdicts[`${prefix}/${k}`] = row[k];
};
for (const t of j.towns || []) take(t, t.name, SHEETS);
for (const p of j.places || []) take(p, p.name, SHEETS);
for (const f of j.portalFixtures || []) take(f, `fixture:${f.name}`, ['internal', 'external', 'boarding']);

const drift = (j.portalDrift || []).filter((d) => !d.same).map((d) => d.file);
if (drift.length) console.log(`(portal drift, expected until the re-vendor: ${drift.join(', ')})`);

// ---- question 2: what the working templates draw -----------------------------
// Mirrors status.js gateTown() / gatePlace(): the same generator, options and
// "declared or present" test for each sheet. The join below is what keeps it so.
const declaresOrHas = (rec, dir, file) =>
  !!(rec && Array.isArray(rec.outputs) && rec.outputs.includes(file)) || fs.existsSync(path.join(dir, file));

function jobsFor(unit, isPlace) {
  const m = G.readJson(path.join(unit.dir, 'manifest.json'));
  const s4 = G.latestRunDir(m, unit.dir, 'S4');
  if (!s4) return [];
  let routes = {};
  try { routes = G.readJson(path.join(s4.dir, 'routes.json')); } catch (e) {}
  const ign = isPlace ? { ignoreLineRe: G.PLACE_IGNORE } : {};
  const jobs = [
    ['internal', ASSETS, 'gen_internal.js', 'internal.svg', ign, true],
    ['external', isPlace ? PSK : ASSETS, isPlace ? 'gen_external_places.js' : G.EXTERNAL_GENERATOR, 'external.svg', {}, true],
    ['schematic', ASSETS, 'schematize_internal.js', 'internal-schematic.svg', { ...ign, overridesFromWorkspace: true }, !!routes.internalSchematic],
    ['diagram', ASSETS, 'diagram_internal.js', 'internal-diagram.svg', ign, !!routes.internalDiagram],
    ['boarding', ASSETS, 'gen_boarding.js', 'boarding.svg', {}, isPlace && !!routes.boardingPlan],
  ];
  return jobs
    .filter(([, , , file, , on]) => on && declaresOrHas(s4.rec, s4.dir, file))
    .map(([sheet, dir, gen, file, opts]) => ({ key: `${unit.name}/${sheet}`, gen: SWAP[gen] || path.join(dir, gen), data: s4.dir, file, opts }));
}

function drawHash(job) {
  const run = G.runGenerator(job.gen, job.data, { overridesFromWorkspace: !!job.opts.overridesFromWorkspace });
  const outPath = path.join(run.tmpDir, job.file);
  let h = 'FAIL';
  if (run.ok && fs.existsSync(outPath)) {
    let lines = fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
    if (job.opts.ignoreLineRe) lines = lines.filter((l) => !job.opts.ignoreLineRe.test(l));
    h = crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
  }
  G.rmTmp(run.tmpDir);
  return h;
}

const towns = G.findTowns(BUSES);
const jobs = [
  ...towns.flatMap((t) => jobsFor(t, false)),
  ...G.findPlaces(towns, BUSES).flatMap((p) => jobsFor(p, true)),
];
const templates = {};
for (const job of jobs) templates[job.key] = drawHash(job);

// THE JOIN. Every map sheet the board gave a verdict must have been redrawn here,
// and nothing redrawn here may be a sheet the board does not know.
const boardKeys = Object.entries(verdicts)
  .filter(([k, v]) => !k.startsWith('fixture:') && !['-', 'NO-BUILD', 'no-gen'].includes(v))
  .map(([k]) => k);
const onlyBoard = boardKeys.filter((k) => !(k in templates));
const onlyHere = Object.keys(templates).filter((k) => !boardKeys.includes(k));
if (onlyBoard.length || onlyHere.length) {
  console.error('the sheets redrawn here are not the sheets status.js gates — refusing rather than answering a smaller question:');
  for (const k of onlyBoard) console.error(`  gated by the board, not redrawn here: ${k} (${verdicts[k]})`);
  for (const k of onlyHere) console.error(`  redrawn here, unknown to the board: ${k}`);
  console.error('bring jobsFor() back into line with status.js gateTown()/gatePlace().');
  process.exit(2);
}

const nV = Object.keys(verdicts).length;
const nT = Object.keys(templates).length;
const failed = Object.entries(templates).filter(([, h]) => h === 'FAIL').map(([k]) => k);

if (argv.includes('--baseline')) {
  fs.writeFileSync(BASE, JSON.stringify({ verdicts, templates }, null, 1) + '\n');
  const bad = Object.entries(verdicts).filter(([, v]) => v !== 'PASS' && v !== '-');
  console.log(`baseline written: ${nV} sheet verdicts, ${nT} sheets drawn by the working templates`);
  // A baseline recorded off a board that is already red will happily stay green
  // through an extraction that keeps it red, so say so out loud.
  console.log(bad.length
    ? `⚠ the verdicts are NOT all green — ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}. Fix that first, or this gate can only prove you did not make it worse.`
    : 'every sheet verdict PASS or n/a — a clean baseline');
  if (failed.length) console.log(`⚠ the working templates could not draw ${failed.join(', ')} — an extraction that keeps them failing will read green.`);
  process.exit(0);
}

const moved = (a, b) => {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] !== b[k]) out.push(`${k}: ${a[k] ?? '(absent)'} -> ${b[k] ?? '(absent)'}`);
  }
  return out;
};
const vMoved = moved(base.verdicts, verdicts);
const tMoved = moved(base.templates, templates);
if (vMoved.length || tMoved.length) {
  console.log(`GATE RED — ${vMoved.length} of ${nV} sheet verdicts moved, and the working templates draw ${tMoved.length} of ${nT} sheets differently:`);
  for (const c of vMoved) console.log('  verdict  ' + c);
  for (const c of tMoved) console.log('  drawn    ' + c);
  if (tMoved.length) console.log('A drawn sheet that moved is ink: gate.js on that map\'s data prints the lines.');
  process.exit(1);
}
console.log(`GATE GREEN — all ${nV} sheet verdicts identical, and the working templates draw all ${nT} sheets exactly as at the baseline`);
