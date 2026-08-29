#!/usr/bin/env node
/*
 * prove-red-stage-stamps.js — falsify the OA-161 guard.
 *
 * Copies assets/stage.js, cuts the S4 provenance-stamp guard out of the copy,
 * and runs test/stage_stamps.test.js against it. The seven guard tests must
 * FAIL (they are the guard) and the four named CONTROL must still PASS — the
 * ordinary stamped commit, the non-S4 stage, and the two `stage.js stamps`
 * cases, none of which the guard is involved in. A run where everything goes
 * red proves the harness broke the file, not that the guard works, so both
 * halves are asserted rather than just the failures.
 *
 * THE COUNTS ARE ASSERTED, not just the verdicts. Coverage was the actual bug in
 * a sibling checker on 2026-08-28 (`check-tables.mjs` had never looked at three
 * whole documents while reporting a confident row count), and a verdict alone
 * cannot express "it did not look at this one".
 *
 * Run from make-bus-leaflet:  node tools/prove-red-stage-stamps.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'stage.js');
const TEST = path.join(ROOT, 'test', 'stage_stamps.test.js');

const src = fs.readFileSync(SRC, 'utf8');
const START = '    // Guard (OA-161)';
const END = '    if (Object.keys(basedOn).length) rec.basedOn = basedOn;';
const a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('prove-red-stage-stamps: could not find the guard in assets/stage.js.');
  console.error('  If the guard was deliberately removed, delete this harness with it.');
  process.exit(1);
}
const broken = src.slice(0, a) + src.slice(b);
// Not 'OA-161' — that string is also in stage.js's own header, which the cut
// leaves alone and should. The refusal's own words are what has to be gone.
if (broken.includes('S4 provenance stamps missing')) {
  console.error('prove-red-stage-stamps: the refusal survived the cut — the fixture is not broken.');
  process.exit(1);
}
// The `stamps` COMMAND must survive the cut — it is what three controls exercise,
// and a harness that removed it too would prove nothing about the guard.
if (!broken.includes("cmd === 'stamps'")) {
  console.error('prove-red-stage-stamps: the cut also removed the `stamps` command — widen the END anchor.');
  process.exit(1);
}

// THE COPY GOES IN assets/, NOT IN A TEMP DIR. stage.js gained two relative
// requires with the OA-161 work — ./sheet_stamps and ./engine_version — and a
// copy anywhere else cannot resolve them, so it dies in the module loader
// before main() runs and EVERY test goes red including the controls. That reads
// as a spectacular falsification and proves nothing at all; the sibling harness
// prove-red-stage-commit.js predates the requires and has never had to care.
const copy = path.join(ROOT, 'assets', '.stage.prove-red-stamps.js');
fs.writeFileSync(copy, broken);
const cleanup = () => { try { fs.unlinkSync(copy); } catch (e) { } };
process.on('exit', cleanup);

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
  { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { STAGE_JS: copy }) });
const out = r.stdout + r.stderr;

/* BOTH REPORTER FORMATS ARE READ. `node --test` defaults to `spec` from Node 22
 * and to `tap` before it; this laptop is on Node 24 and the CI runner is pinned
 * to Node 20. A spec-only parser reads zero tests in CI and says nothing about
 * it — which is how the sibling harness prove-red-redteam-source.js failed on
 * its first CI run. */
const failed = new Set(), passed = new Set();
for (const line of out.split('\n')) {
  // The trailing duration is what distinguishes a test line from the summary
  // heading "✖ failing tests:".
  const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
  if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
  const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
  if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
}

const all = [...passed, ...failed];
const controls = all.filter(n => n.startsWith('CONTROL'));
const guards = all.filter(n => !n.startsWith('CONTROL'));
const controlsRed = controls.filter(n => failed.has(n));
const guardsGreen = guards.filter(n => passed.has(n));

console.log('fixture      : assets/stage.js with the OA-161 stamp guard cut out');
console.log(`tests seen   : ${all.length}  (must be 11 — a parser that reads none says nothing)`);
console.log(`controls     : ${controls.length}  (must all PASS)`);
console.log(`guard tests  : ${guards.length}  (must all FAIL)`);

let bad = false;
if (all.length !== 11) { console.error(`FAIL: expected 11 tests, parsed ${all.length} — the reporter format changed or the suite did`); bad = true; }
if (controls.length !== 4) { console.error(`FAIL: expected 4 CONTROL tests, found ${controls.length}`); bad = true; }
if (guards.length !== 7) { console.error(`FAIL: expected 7 guard tests, found ${guards.length}`); bad = true; }
if (controlsRed.length) { console.error('FAIL: a control went red — the harness broke the file, it did not falsify the guard:\n  ' + controlsRed.join('\n  ')); bad = true; }
if (guardsGreen.length) { console.error('FAIL: these guard tests still PASS without the guard, so they do not test it:\n  ' + guardsGreen.join('\n  ')); bad = true; }

cleanup();

if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nPROVEN RED: all 7 guard tests fail without the guard, all 4 controls stay green.');
