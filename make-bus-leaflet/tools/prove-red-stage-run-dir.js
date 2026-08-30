#!/usr/bin/env node
/*
 * prove-red-stage-run-dir.js — falsify the run-dir containment guard.
 *
 * Copies assets/stage.js, cuts the containment guard out of the copy, and runs
 * test/stage_run_dir_inside.test.js against it. The three guard tests must FAIL
 * and the one named CONTROL must still PASS. A run where everything goes red
 * proves the harness broke the file, not that the guard works — so both halves
 * are asserted, not just the failures.
 *
 * SEPARATE FROM prove-red-stage-commit.js on purpose. That one cuts the OA-106
 * output-existence guard, which sits further down the same function; these are
 * two guards answering two questions, and a harness that cut both could not say
 * which one a red test was about.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-stage-run-dir.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'stage.js');
const TEST = path.join(ROOT, 'test', 'stage_run_dir_inside.test.js');

const src = fs.readFileSync(SRC, 'utf8');
const START = "    // Guard: a run dir belongs INSIDE the map's own folder";
const END = '    const outputs = f.outputs ? String(f.outputs)';
const a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('prove-red-stage-run-dir: could not find the guard in assets/stage.js.');
  console.error('  If the guard was deliberately removed, delete this harness with it.');
  process.exit(1);
}
const broken = src.slice(0, a) + src.slice(b);
if (broken.includes('outside the map folder')) {
  console.error('prove-red-stage-run-dir: the cut left the guard behind — the fixture is not broken.');
  process.exit(1);
}

// THE COPY GOES IN assets/, NOT IN A TEMP DIR. stage.js has relative requires
// (./sheet_stamps, ./engine_version) and a copy anywhere else cannot resolve
// them, so it dies in the module loader before main() runs and EVERY test goes
// red, control included — which reads like a triumphant falsification and is
// not one. prove-red-stage-commit.js learned this on 2026-08-29; same trap here.
const copy = path.join(ROOT, 'assets', '.stage.prove-red-run-dir.js');
fs.writeFileSync(copy, broken);
const cleanup = () => { try { fs.unlinkSync(copy); } catch (e) { } };
process.on('exit', cleanup);

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STAGE_JS: copy } });
const out = r.stdout + r.stderr;

// Parse the per-test verdicts rather than the exit code: "some failed" is not
// the claim. The claim is WHICH failed. Both reporter formats are read because
// `node --test` defaults to spec from Node 22 and to tap before it, and the CI
// runner is not pinned to this laptop's version.
const failed = new Set(), passed = new Set();
for (const line of out.split('\n')) {
  const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
  if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
  const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
  if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
}

const controls = [...passed, ...failed].filter(n => n.startsWith('CONTROL'));
const guards = [...passed, ...failed].filter(n => !n.startsWith('CONTROL'));
const controlsRed = controls.filter(n => failed.has(n));
const guardsGreen = guards.filter(n => passed.has(n));

console.log('fixture      : assets/stage.js with the containment guard cut out');
console.log(`controls     : ${controls.length}  (must all PASS)`);
console.log(`guard tests  : ${guards.length}  (must all FAIL)`);

let bad = false;
if (controls.length !== 1) { console.error(`FAIL: expected 1 CONTROL test, found ${controls.length}`); bad = true; }
if (guards.length !== 3) { console.error(`FAIL: expected 3 guard tests, found ${guards.length}`); bad = true; }
if (controlsRed.length) { console.error(`FAIL: the control went red — the harness broke the file, it did not falsify the guard:\n  ${controlsRed.join('\n  ')}`); bad = true; }
if (guardsGreen.length) { console.error(`FAIL: these guard tests still PASS without the guard, so they do not test it:\n  ${guardsGreen.join('\n  ')}`); bad = true; }

cleanup();

if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nPROVEN RED: all 3 guard tests fail without the guard, the control stays green.');
