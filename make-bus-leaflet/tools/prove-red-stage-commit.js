#!/usr/bin/env node
/*
 * prove-red-stage-commit.js — falsify the OA-106 guard.
 *
 * Copies assets/stage.js, cuts the output-existence guard out of the copy, and
 * runs test/stage_commit.test.js against it. Six of the eight tests must FAIL
 * (they are the guard) and the two named CONTROL must still PASS (they are the
 * ordinary commit the guard must not break). A run where everything goes red
 * proves the harness broke the file, not that the guard works — so both halves
 * are asserted, not just the failures.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-stage-commit.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'stage.js');
const TEST = path.join(ROOT, 'test', 'stage_commit.test.js');

const src = fs.readFileSync(SRC, 'utf8');
const START = '    // Guard (OA-106)';
const END = '    const rec = { id, dir: relDir, at: isoNow(), outputs };';
const a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('prove-red-stage-commit: could not find the guard in assets/stage.js.');
  console.error('  If the guard was deliberately removed, delete this harness with it.');
  process.exit(1);
}
const broken = src.slice(0, a) + src.slice(b);
// Assert on a phrase from inside the guard BODY, not on the action number.
// This read `broken.includes('OA-106')` until 2026-08-30, which is a proxy: the
// string can legitimately appear anywhere in the file, and the moment the
// neighbouring run-dir containment guard was added citing OA-106 in its comment,
// this tripped on text the cut was never meant to remove and reported a
// perfectly good fixture as unbroken. Name something only the guard says.
if (broken.includes('A manifest that advertises a sheet nobody wrote')) {
  console.error('prove-red-stage-commit: the cut left the OA-106 guard behind — the fixture is not broken.');
  process.exit(1);
}

// THE COPY GOES IN assets/, NOT IN A TEMP DIR (changed 2026-08-29). It was a
// temp dir until stage.js gained two relative requires with the OA-161 work —
// ./sheet_stamps and ./engine_version — and a copy anywhere else cannot resolve
// them, so it dies in the module loader before main() runs and EVERY test goes
// red, controls included. This harness reported exactly that on the day, and
// the CONTROL assertion below is the only reason it read as "the harness broke
// the file" rather than as a triumphant falsification. Adding a require to a CLI
// silently breaks every harness that copies it somewhere else.
const copy = path.join(ROOT, 'assets', '.stage.prove-red-commit.js');
fs.writeFileSync(copy, broken);
const cleanup = () => { try { fs.unlinkSync(copy); } catch (e) { } };
process.on('exit', cleanup);

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STAGE_JS: copy } });
const out = r.stdout + r.stderr;

// Parse the per-test verdicts rather than the exit code: "some failed" is not
// the claim. The claim is WHICH failed.
/* BOTH REPORTER FORMATS ARE READ (2026-08-29). `node --test` defaults to `spec`
 * from Node 22 and to `tap` before it; this laptop is on Node 24 and the CI
 * runner is pinned to Node 20. This parser was spec-only and would have read
 * zero tests in CI — it has simply never run anywhere but Windows. Found when
 * the sibling harness prove-red-redteam-source.js hit it on its first CI run. */
const failed = new Set(), passed = new Set();
for (const line of out.split('\n')) {
  // The trailing duration is what distinguishes a test line from the summary
  // heading "✖ failing tests:", which an earlier version of this parser counted
  // as a seventh test and which is exactly what the count assertion caught.
  const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
  if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
  const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
  if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
}

const controls = [...passed, ...failed].filter(n => n.startsWith('CONTROL'));
const guards = [...passed, ...failed].filter(n => !n.startsWith('CONTROL'));
const controlsRed = controls.filter(n => failed.has(n));
const guardsGreen = guards.filter(n => passed.has(n));

console.log(`fixture      : assets/stage.js with the OA-106 guard cut out`);
console.log(`controls     : ${controls.length}  (must all PASS)`);
console.log(`guard tests  : ${guards.length}  (must all FAIL)`);

let bad = false;
if (controls.length !== 2) { console.error(`FAIL: expected 2 CONTROL tests, found ${controls.length}`); bad = true; }
if (guards.length !== 6) { console.error(`FAIL: expected 6 guard tests, found ${guards.length}`); bad = true; }
if (controlsRed.length) { console.error(`FAIL: a control went red — the harness broke the file, it did not falsify the guard:\n  ${controlsRed.join('\n  ')}`); bad = true; }
if (guardsGreen.length) { console.error(`FAIL: these guard tests still PASS without the guard, so they do not test it:\n  ${guardsGreen.join('\n  ')}`); bad = true; }

cleanup();

if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nPROVEN RED: all 6 guard tests fail without the guard, both controls stay green.');
