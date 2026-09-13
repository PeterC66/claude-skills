#!/usr/bin/env node
/*
 * prove-red-stage-build-log.js — falsify the OA-310 item 2 guard.
 *
 * Copies assets/stage.js, cuts the build-warnings guard out of the copy, and runs
 * test/stage_build_log.test.js against it. The two guard tests must FAIL (they are
 * the guard) and the five named CONTROL must still PASS. A run where everything
 * goes red proves the harness broke the file rather than that the guard works, so
 * both halves are asserted instead of just the failures.
 *
 * WHY FIVE CONTROLS FOR TWO GUARD TESTS, which is an unusual ratio here. This guard
 * is a SCOPED refusal — the flat rule it deliberately is not would be red on
 * Huntingdon and Wisbech the day it landed — so most of what has to be true of it is
 * that it stays silent. Two of those controls (the re-commit of one dir, and the S2)
 * pass with the guard cut out and are named CONTROL for exactly that reason: a test
 * that cannot go red under this cut must not be counted as evidence that it can.
 *
 * THE COUNTS ARE ASSERTED, not just the verdicts, for the reason the sibling
 * harnesses give: a verdict cannot express "it did not look at this one".
 *
 * Run from make-bus-leaflet:  node tools/prove-red-stage-build-log.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'stage.js');
const TEST = path.join(ROOT, 'test', 'stage_build_log.test.js');

const src = fs.readFileSync(SRC, 'utf8');
const START = '      /* Guard (OA-310 item 2)';
// The brace on this END anchor closes `if (st === 'S4')`, and the guard sits inside
// it — so the anchor keeps the brace and the cut stays syntactically whole.
const END = '    }\n    if (Object.keys(basedOn).length) rec.basedOn = basedOn;';
const a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('prove-red-stage-build-log: could not find the guard in assets/stage.js.');
  console.error('  If the guard was deliberately removed, delete this harness with it.');
  process.exit(1);
}
const broken = src.slice(0, a) + src.slice(b);
// Not 'OA-310' — that ref also appears in stage.js's header and in build_s4.js's
// name. The refusal's own words are what has to be gone.
if (broken.includes('and the run before it did')) {
  console.error('prove-red-stage-build-log: the refusal survived the cut — the fixture is not broken.');
  process.exit(1);
}
// The guards the controls depend on must survive the cut, or every test goes red
// and the run says nothing about this one.
for (const keep of ['S4 provenance stamps missing', 'has no orientation record', "cmd === 'commit'"]) {
  if (!broken.includes(keep)) {
    console.error(`prove-red-stage-build-log: the cut also removed "${keep}" — narrow the anchors.`);
    process.exit(1);
  }
}

// THE COPY GOES IN assets/, NOT IN A TEMP DIR: stage.js requires ./sheet_stamps,
// ./engine_version and ./sheet_registry relatively, and a copy anywhere else dies in
// the module loader before main() runs, turning every test red including the
// controls. That reads as a spectacular falsification and proves nothing at all.
const copy = path.join(ROOT, 'assets', '.stage.prove-red-build-log.js');
fs.writeFileSync(copy, broken);
const cleanup = () => { try { fs.unlinkSync(copy); } catch (e) { } };
process.on('exit', cleanup);

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
  { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { STAGE_JS: copy }) });
const out = r.stdout + r.stderr;

/* BOTH REPORTER FORMATS ARE READ. `node --test` defaults to spec from Node 22 and
 * to tap before it; this laptop is on Node 24 and the CI runner is pinned to Node
 * 20. A spec-only parser reads zero tests in CI and says nothing about it. */
const failed = new Set(), passed = new Set();
for (const line of out.split('\n')) {
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

console.log('fixture      : assets/stage.js with the OA-310 build-warnings guard cut out');
console.log(`tests seen   : ${all.length}  (must be 7 — a parser that reads none says nothing)`);
console.log(`controls     : ${controls.length}  (must all PASS)`);
console.log(`guard tests  : ${guards.length}  (must all FAIL)`);

let bad = false;
if (all.length !== 7) { console.error(`FAIL: expected 7 tests, parsed ${all.length} — the reporter format changed or the suite did`); bad = true; }
if (controls.length !== 5) { console.error(`FAIL: expected 5 CONTROL tests, found ${controls.length}`); bad = true; }
if (guards.length !== 2) { console.error(`FAIL: expected 2 guard tests, found ${guards.length}`); bad = true; }
if (controlsRed.length) { console.error('FAIL: a control went red — the harness broke the file, it did not falsify the guard:\n  ' + controlsRed.join('\n  ')); bad = true; }
if (guardsGreen.length) { console.error('FAIL: these guard tests still PASS without the guard, so they do not test it:\n  ' + guardsGreen.join('\n  ')); bad = true; }

cleanup();

if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nPROVEN RED: both guard tests fail without the guard, all 5 controls stay green.');
