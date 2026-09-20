#!/usr/bin/env node
/*
 * prove-red-stage-s6-mirror.js — falsify the OA-329 fault A refresh.
 *
 * Copies assets/stage.js, cuts the one call that refreshes a map's `_latest`
 * mirror after an S6 commit out of the copy, and runs test/stage_s6_mirror.test.js
 * against it. The four mechanism tests must FAIL — they are the mechanism — and
 * the three named CONTROL must still PASS: the commit still succeeds and still
 * records its run, S5 still writes no mirror, and `refresh_latest.js --no-collect`
 * still answers for itself, none of which the cut is involved in.
 *
 * A run where everything goes red proves the harness broke the file rather than
 * that the mechanism works, so both halves are asserted rather than just the
 * failures. THE COUNTS ARE ASSERTED TOO: a verdict alone cannot say "it did not
 * look at this one", which was the actual bug in a sibling checker on 2026-08-28.
 *
 * THE CONTROL THAT MATTERS MOST IS THE S5 ONE. The cut removes an `if (st ===
 * 'S6')`, so a mechanism widened to every stage would pass the four tests above
 * and break that control instead — and widening it is the plausible wrong fix,
 * since the rollout already refreshes after its own `commit S5`.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-stage-s6-mirror.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'stage.js');
const TEST = path.join(ROOT, 'test', 'stage_s6_mirror.test.js');

const src = fs.readFileSync(SRC, 'utf8');
const CALL = "    if (st === 'S6') refreshLatestMirror(townDir);";
if (!src.includes(CALL)) {
  console.error('prove-red-stage-s6-mirror: could not find the S6 mirror call in assets/stage.js.');
  console.error('  If it was deliberately removed, delete this harness with it.');
  process.exit(1);
}
const broken = src.replace(CALL, '    // (cut by prove-red-stage-s6-mirror.js)');
// The FUNCTION stays; only its one call site goes. Cutting the definition too
// would be a bigger edit than the one being falsified, and a ReferenceError in
// the module would redden the controls for the wrong reason.
if (!broken.includes('function refreshLatestMirror(')) {
  console.error('prove-red-stage-s6-mirror: the cut also removed the function — narrow the anchor.');
  process.exit(1);
}
if (broken.includes(CALL)) {
  console.error('prove-red-stage-s6-mirror: the call survived the cut — the fixture is not broken.');
  process.exit(1);
}

// THE COPY GOES IN assets/, NOT IN A TEMP DIR — stage.js has relative requires
// (./sheet_stamps, ./engine_version, ./cli.js) and a copy anywhere else dies in
// the module loader before main() runs, reddening every test including the
// controls. That reads as a spectacular falsification and proves nothing.
const copy = path.join(ROOT, 'assets', '.stage.prove-red-s6-mirror.js');
fs.writeFileSync(copy, broken);
const cleanup = () => { try { fs.unlinkSync(copy); } catch (e) { } };
process.on('exit', cleanup);

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
  { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { STAGE_JS: copy }) });
const out = r.stdout + r.stderr;

/* BOTH REPORTER FORMATS ARE READ. `node --test` defaults to `spec` from Node 22
 * and to `tap` before it; this laptop is on Node 24 and the CI runner is pinned
 * to Node 20. A spec-only parser reads zero tests in CI and says nothing about
 * it — which is how a sibling harness failed on its first CI run. */
const failed = new Set(), passed = new Set();
for (const line of out.split('\n')) {
  const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
  if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
  const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
  if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
}

const all = [...passed, ...failed];
const controls = all.filter(n => n.startsWith('CONTROL'));
const mech = all.filter(n => !n.startsWith('CONTROL'));
const controlsRed = controls.filter(n => failed.has(n));
const mechGreen = mech.filter(n => passed.has(n));

console.log('fixture      : assets/stage.js with the S6 _latest refresh call cut out');
console.log(`tests seen   : ${all.length}  (must be 7 — a parser that reads none says nothing)`);
console.log(`controls     : ${controls.length}  (must all PASS)`);
console.log(`mechanism    : ${mech.length}  (must all FAIL)`);

let bad = false;
if (all.length !== 7) { console.error(`FAIL: expected 7 tests, parsed ${all.length} — the reporter format changed or the suite did`); bad = true; }
if (controls.length !== 3) { console.error(`FAIL: expected 3 CONTROL tests, found ${controls.length}`); bad = true; }
if (mech.length !== 4) { console.error(`FAIL: expected 4 mechanism tests, found ${mech.length}`); bad = true; }
if (controlsRed.length) { console.error('FAIL: a control went red — the harness broke the file, it did not falsify the refresh:\n  ' + controlsRed.join('\n  ')); bad = true; }
if (mechGreen.length) { console.error('FAIL: these tests still PASS with the refresh cut out, so they do not test it:\n  ' + mechGreen.join('\n  ')); bad = true; }

cleanup();

if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nPROVEN RED: all 4 mechanism tests fail without the refresh, all 3 controls stay green.');
