#!/usr/bin/env node
/*
 * prove-red-derive-frequency.js — falsify the OA-019 stale-S1 guard.
 *
 * Copies make-place-bus-leaflet/assets/derive_frequency.js, cuts the guard out of
 * the copy, and runs test/derive_frequency.test.js against it. The three tests
 * that ARE the guard must go red; the two named CONTROL must stay green.
 *
 * Both halves are asserted. A run where everything went red would prove the
 * harness mangled the file, not that the guard works — and a guard that also
 * refused the CURRENT schema, or discarded a lane whose measured window is
 * legitimately empty, would cost more than the bug it fixes. Those are the two
 * controls, and they are the reason this harness is not just "expect failures".
 *
 * What the cut restores is the code as it stood before 2026-08-29: fed an S1 with
 * none of the five frequency fields, it returned "limited — ends mid-afternoon"
 * for every lane, because an absent typicalDayWindow became the empty string and
 * the empty string sorts below '15:30'.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-derive-frequency.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '..', 'make-place-bus-leaflet', 'assets', 'derive_frequency.js');
const TEST = path.join(ROOT, 'test', 'derive_frequency.test.js');

/* Cut a [start, end) span, asserting both anchors were found. An anchor that has
 * silently stopped matching would make this harness pass by cutting nothing —
 * the same class of lie it exists to catch. */
function cut(src, start, end, what) {
  const a = src.indexOf(start), b = src.indexOf(end);
  if (a < 0 || b < 0 || b < a) {
    console.error(`prove-red-derive-frequency: could not find ${what} in derive_frequency.js.`);
    console.error(`  looked for:\n    ${JSON.stringify(start)}\n    ${JSON.stringify(end)}`);
    console.error('  If the guard was deliberately removed, delete this harness with it.');
    process.exit(1);
  }
  return src.slice(0, a) + src.slice(b);
}

let broken = fs.readFileSync(SRC, 'utf8');
broken = cut(broken,
  '// WHICH LANES ARE MEASURABLE AT ALL (OA-019, 2026-08-29).',
  'function tier(r) {',
  'the measurable() predicate');
broken = cut(broken,
  '  // Present in GTFS, but this S1 cannot say how often it runs.',
  '  const r = {',
  'the per-lane skip');
broken = cut(broken,
  'if (unmeasured.length) {',
  'if (!WRITE) {',
  'the unmeasured report and the total refusal');
// unmeasured[] is still declared and still empty, which is exactly the pre-guard
// behaviour: nothing is ever put in it and nothing ever reads it.

for (const gone of ['measurable(', 'FREQ_FIELDS', 'not one lane could be tiered']) {
  if (broken.includes(gone)) {
    console.error(`prove-red-derive-frequency: the cut left ${JSON.stringify(gone)} behind — the fixture is not broken.`);
    process.exit(1);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-red-df-'));
const copy = path.join(dir, 'derive_frequency.js');
fs.writeFileSync(copy, broken);

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DERIVE_FREQUENCY_JS: copy } });
const out = r.stdout + r.stderr;

/*
 * Parse the per-test verdicts rather than the exit code: "some failed" is not the
 * claim. The claim is WHICH failed.
 *
 * BOTH REPORTER FORMATS ARE READ, for the reason prove-red-redteam-source.js
 * learned on 2026-08-29: `node --test` defaults to `spec` from Node 22 and to
 * `tap` before it, this laptop runs Node 24 and the CI runner is pinned to Node
 * 20, so a spec-only parser reads zero tests out of a perfectly correct TAP run
 * and fails on its own count assertion. The --test-reporter=spec above pins the
 * format; this reads either, so a Node bump on either side cannot empty it again.
 */
const failed = new Set(), passed = new Set();
for (const line of out.split('\n')) {
  const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
  if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
  const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
  if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
}

const all = [...passed, ...failed];
const controls = all.filter((n) => n.startsWith('CONTROL'));
const guards = all.filter((n) => !n.startsWith('CONTROL'));

console.log('fixture      : derive_frequency.js with the OA-019 stale-S1 guard cut out');
console.log(`controls     : ${controls.length}  (must all PASS)`);
console.log(`guard tests  : ${guards.length}  (must all FAIL)`);

let bad = false;
// The COUNTS are asserted as well as the verdicts. A test file that lost its guard
// cases would otherwise report a tidy, meaningless green.
if (controls.length !== 2) { console.error(`FAIL: expected 2 CONTROL tests, found ${controls.length}`); bad = true; }
if (guards.length !== 3) { console.error(`FAIL: expected 3 guard tests, found ${guards.length}`); bad = true; }
for (const n of controls) if (failed.has(n)) { console.error(`FAIL: CONTROL went red — the cut broke ordinary use, so nothing below is evidence: ${n}`); bad = true; }
for (const n of guards) if (passed.has(n)) { console.error(`FAIL: guard test stayed green with the guard removed — it is not testing the guard: ${n}`); bad = true; }

if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nOK — the stale-S1 guard was watched going red, and ordinary use stayed green.');
