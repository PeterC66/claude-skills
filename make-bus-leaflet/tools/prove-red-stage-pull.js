#!/usr/bin/env node
/*
 * prove-red-stage-pull.js — falsify the OA-164 guard.
 *
 * Copies assets/stage.js, restores the pre-OA-164 copyInto (which overwrote
 * everything, declared or not), and runs test/stage_pull.test.js against it.
 * The two guard tests must FAIL and the four named CONTROL must still PASS.
 *
 * The controls are the whole point here. This guard's risk is not that it fails
 * to refuse; it is that it refuses too much and a legitimate pull stops landing
 * its own outputs -- which would break every build on the estate silently, in
 * the same way the defect did. A run where everything goes red proves the
 * harness broke the file, not that the guard works.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-stage-pull.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'stage.js');
const TEST = path.join(ROOT, 'test', 'stage_pull.test.js');

const src = fs.readFileSync(SRC, 'utf8');
const GUARD = '    if (declared && !declared.has(name) && fs.existsSync(d)) { shadowed.push(name); continue; }\n';
if (!src.includes(GUARD)) {
  console.error('prove-red-stage-pull: could not find the OA-164 guard line in assets/stage.js.');
  console.error('  If the guard was deliberately removed, delete this harness with it.');
  process.exit(1);
}
const broken = src.replace(GUARD, '');
if (broken === src) { console.error('prove-red-stage-pull: the cut changed nothing.'); process.exit(1); }

// The copy goes in assets/, not a temp dir: stage.js has relative requires
// (./sheet_stamps, ./engine_version) and a copy anywhere else dies in the module
// loader before main() runs, turning every test red including the controls.
const copy = path.join(ROOT, 'assets', '.stage.prove-red-pull.js');
fs.writeFileSync(copy, broken);
const cleanup = () => { try { fs.unlinkSync(copy); } catch (e) { } };
process.on('exit', cleanup);

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STAGE_JS: copy } });
const out = r.stdout + r.stderr;

// Both reporter formats: `node --test` defaults to spec from Node 22 and to tap
// before it. This laptop is on Node 24 and the CI runner is pinned to Node 20.
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

console.log('fixture      : assets/stage.js with the OA-164 guard line cut out');
console.log(`tests seen   : ${all.length}  (must be 6 — a parser that reads none says nothing)`);
console.log(`controls     : ${controls.length}  (must all PASS)`);
console.log(`guard tests  : ${guards.length}  (must all FAIL)`);

let bad = false;
if (all.length !== 6) { console.error(`FAIL: expected 6 tests, read ${all.length} — the parser or the suite moved`); bad = true; }
if (controls.length !== 4) { console.error(`FAIL: expected 4 CONTROL tests, found ${controls.length}`); bad = true; }
if (guards.length !== 2) { console.error(`FAIL: expected 2 guard tests, found ${guards.length}`); bad = true; }
if (controlsRed.length) { console.error(`FAIL: a control went red — the harness broke the file, it did not falsify the guard:\n  ${controlsRed.join('\n  ')}`); bad = true; }
if (guardsGreen.length) { console.error(`FAIL: these guard tests still PASS without the guard, so they do not test it:\n  ${guardsGreen.join('\n  ')}`); bad = true; }

cleanup();
if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nPROVEN RED: both guard tests fail without the guard, all 4 controls stay green.');
