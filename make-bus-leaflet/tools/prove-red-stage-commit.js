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
const os = require('node:os');
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
if (broken.includes('OA-106')) {
  console.error('prove-red-stage-commit: the cut left OA-106 behind — the fixture is not broken.');
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-red-stage-'));
const copy = path.join(dir, 'stage.js');
fs.writeFileSync(copy, broken);

const r = spawnSync(process.execPath, ['--test', TEST],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STAGE_JS: copy } });
const out = r.stdout + r.stderr;

// Parse the per-test verdicts rather than the exit code: "some failed" is not
// the claim. The claim is WHICH failed.
const failed = new Set(), passed = new Set();
for (const line of out.split('\n')) {
  // The trailing duration is what distinguishes a test line from the summary
  // heading "✖ failing tests:", which an earlier version of this parser counted
  // as a seventh test and which is exactly what the count assertion caught.
  const m = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
  if (!m) continue;
  (m[1] === '✖' ? failed : passed).add(m[2].trim());
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

fs.rmSync(dir, { recursive: true, force: true });

if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nPROVEN RED: all 6 guard tests fail without the guard, both controls stay green.');
