#!/usr/bin/env node
/*
 * prove-red-attribution.js — break the attribution gate on purpose, once per
 * question it claims to answer.
 *
 * WHY. `attribution-gate.js` (OA-068) was green on the day it was written, which
 * is what the row asked for — a gate that is red on day one gets muted — but a
 * gate that has only ever been green is indistinguishable from a gate that
 * cannot fail. That is the whole of this project's standing rule about checks,
 * and it has been paid for repeatedly.
 *
 * ONE MUTATION PER CLAIM, because the gate makes four separate claims and a
 * single red would prove only one of them:
 *
 *   1. a generator that READS an OSM input and does not credit it        (source)
 *   2. a SHIPPED sheet whose SVG lost the credit its generator still has (artefact)
 *   3. a committed sheet kind no generator in the table claims to draw   (coverage)
 *   4. an extraction anchor that no longer matches                       (the gate's own eyesight)
 *
 * Case 4 is the one worth explaining. The source half reads the credit out of
 * the notes block, located by a text anchor. If that anchor silently stops
 * matching — a refactor renames the constant — a naive implementation finds no
 * credit and no inputs and reports "ok". The gate throws instead, and this case
 * is what proves it throws rather than shrugging. A checker whose failure mode is
 * a pass is worse than no checker.
 *
 * Case 3 is the coverage claim, and it is here for the same reason
 * `prove-red-tables.mjs` asserts a ROW COUNT: coverage was the actual bug in two
 * of this project's checkers, and no verdict can express it. A gate that walks a
 * smaller estate than it says still prints a green line.
 *
 * NOTHING UNDER assets/ OR THE BUSES REPO IS TOUCHED. Each case copies the five
 * generators (or a handful of sheets) into a temp dir, mutates the copy, and
 * points the gate at it with --assets / --place-assets / --buses.
 *
 * Run it from make-bus-leaflet (no placeholders beyond the repo path):
 *     npm run test:prove-red-attribution
 *     node tools/prove-red-attribution.js --buses "<path to the Buses repo>"
 *     node tools/prove-red-attribution.js --keep    leave the scratch trees on disk
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');
const { resolveBuses } = require('../assets/cli');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const PLACE_ASSETS = path.join(SK, '..', 'make-place-bus-leaflet', 'assets');
const GATE = path.join(__dirname, 'attribution-gate.js');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
/* --keep means the scratch is EVIDENCE: switch off scratch.js's exit sweep, or
 * the paths printed below would name directories that no longer exist. */
if (KEEP) require('../assets/scratch').keepScratch();
const bi = argv.indexOf('--buses');
const BUSES = resolveBuses({ buses: (bi >= 0 && argv[bi + 1]) ? argv[bi + 1] : undefined });

const GEN_FILES = ['gen_internal.js', 'gen_external_radial.js', 'gen_external_busway.js', 'gen_boarding.js'];
const PLACE_GEN = 'gen_external_places.js';

/* A scratch copy of the five generators, so a mutation cannot reach the vendored
 * originals. Only the five are copied: the gate reads no other file from assets/. */
function scratchAssets() {
  const root = scratchDir('prove-red-attr-');
  const a = path.join(root, 'assets'), pa = path.join(root, 'place-assets');
  fs.mkdirSync(a); fs.mkdirSync(pa);
  for (const f of GEN_FILES) fs.copyFileSync(path.join(ASSETS, f), path.join(a, f));
  fs.copyFileSync(path.join(PLACE_ASSETS, PLACE_GEN), path.join(pa, PLACE_GEN));
  return { root, assets: a, placeAssets: pa };
}

/* A scratch Buses tree holding real shipped sheets — one that owes OSM and one
 * that owes nothing — so the artefact half has something true to be right about
 * before it is made wrong. */
function scratchBuses(extraSheet) {
  const root = scratchDir('prove-red-attr-buses-');
  const dst = path.join(root, 'Areas', 'Wisbech', 'ci-reference');
  fs.mkdirSync(dst, { recursive: true });
  const src = path.join(BUSES, 'Areas', 'Wisbech', 'ci-reference');
  for (const f of ['internal.svg', 'external.svg']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  if (extraSheet) fs.copyFileSync(path.join(src, 'internal.svg'), path.join(dst, extraSheet));
  return { root, dst };
}

/* `find` must appear EXACTLY ONCE, or the mutation did not do what it says and
 * would report a false green as loudly as the fault it hunts. */
function edit(file, find, to) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = src.split(find).length - 1;
  if (hits !== 1) throw new Error(`mutation anchor "${find.slice(0, 40)}" matched ${hits} times in ${path.basename(file)}, wanted 1`);
  fs.writeFileSync(file, src.replace(find, to));
}

function runGate(assets, placeAssets, buses) {
  const args = [GATE, '--assets', assets, '--place-assets', placeAssets, '--buses', buses];
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    if (typeof e.status !== 'number') throw e;
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const CASES = [
  {
    label: 'control: nothing mutated',
    expect: 0,
    expectSays: null,
    what: 'a green control, or every red below proves nothing',
    run(a, b) { return runGate(a.assets, a.placeAssets, b.root); },
  },
  {
    label: 'source: gen_internal reads OSM, credits nobody',
    expect: 1,
    expectSays: /gen_internal\.js reads .* but its footer notes never say "OSM"/,
    what: 'THE 2026-08-25 FAULT, in the source, before any sheet is built',
    run(a, b) {
      edit(path.join(a.assets, 'gen_internal.js'),
        "'Places: © OpenStreetMap contributors (ODbL).",
        "'Places: nobody in particular.");
      return runGate(a.assets, a.placeAssets, b.root);
    },
  },
  {
    label: 'artefact: a SHIPPED sheet loses the credit',
    expect: 1,
    expectSays: /internal\.svg draws OSM data and the shipped sheet credits no OSM/,
    what: 'THE 2026-08-25 FAULT AS IT ACTUALLY HAPPENED - the source was fine and the artwork was not',
    run(a, b) {
      const f = path.join(b.dst, 'internal.svg');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('OpenStreetMap').join('Somewhere'));
      return runGate(a.assets, a.placeAssets, b.root);
    },
  },
  {
    label: 'coverage: a committed sheet kind nothing claims to draw',
    expect: 1,
    expectSays: /drawn by no generator in this file's table/,
    what: 'a sixth sheet kind must not pass by being invisible',
    extraSheet: 'internal-inset.svg',
    run(a, b) { return runGate(a.assets, a.placeAssets, b.root); },
  },
  {
    label: "eyesight: the extraction anchor no longer matches",
    expect: 1,
    expectSays: /notes anchor .* matched 0 times/,
    what: 'a checker whose failure mode is a PASS is worse than no checker',
    run(a, b) {
      edit(path.join(a.assets, 'gen_boarding.js'), 'const FOOTER_OPTS = {', 'const FOOTER_OPTIONS = {');
      return runGate(a.assets, a.placeAssets, b.root);
    },
  },
];

const rows = [];
const kept = [];
let failed = 0;
for (const c of CASES) {
  const a = scratchAssets();
  const b = scratchBuses(c.extraSheet);
  kept.push(a.root, b.root);
  let res;
  try { res = c.run(a, b); }
  catch (e) { res = { code: -1, out: 'harness error: ' + e.message }; }
  const wantRed = c.expect !== 0;
  const colourOk = (res.code !== 0) === wantRed;
  /* The message is checked as well as the colour. Four of these cases would all
   * go red if the gate simply threw on startup, and a harness that scored that
   * as four passes would be reporting a false green about a gate that had
   * stopped working entirely. "It went red" and "it went red for this reason"
   * are different claims. */
  const causeOk = c.expectSays ? c.expectSays.test(res.out) : !/FAIL/.test(res.out);
  const ok = colourOk && causeOk;
  if (!ok) failed++;
  rows.push([
    !colourOk ? (wantRed ? 'SURVIVED' : 'CONTROL RED') : !causeOk ? 'RED, WRONG CAUSE' : (wantRed ? 'caught' : 'green'),
    c.label, 'exit ' + res.code, c.what,
  ]);
  if (!KEEP) { fs.rmSync(a.root, { recursive: true, force: true }); fs.rmSync(b.root, { recursive: true, force: true }); }
}

const w = [18, 54, 10];
for (const r of rows) console.log(r[0].padEnd(w[0]) + r[1].padEnd(w[1]) + r[2].padEnd(w[2]) + r[3]);
if (KEEP) for (const k of kept) console.log('kept  ' + k);

if (failed) {
  console.error('\n' + failed + ' of ' + CASES.length + ' cases did not behave as claimed - the attribution gate is not what it says it is.');
  process.exitCode = 1;
} else {
  console.log('\nall ' + CASES.length + ' cases behaved as claimed: the gate can go red on the source, on the artwork, on a sheet kind it has never heard of, and on its own eyesight.');
}
