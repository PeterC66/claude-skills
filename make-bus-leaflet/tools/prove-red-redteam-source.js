#!/usr/bin/env node
/*
 * prove-red-redteam-source.js — falsify the OA-141 changes.
 *
 * Copies assets/redteam_source.js, cuts BOTH OA-141 changes out of the copy —
 * the ambiguity guard and the line that names the build it examined — and runs
 * test/redteam_source.test.js against it. Four of the six tests must FAIL (they
 * are the changes) and the two named CONTROL must still PASS (they are the
 * ordinary decisions the guard must not break).
 *
 * Both halves are asserted, not just the failures. A run where everything goes
 * red proves the harness mangled the file, not that the guard works — and a
 * refusal that fired on the documented invocation would cost a red team rather
 * than save one, which is precisely what the CONTROLs are watching for.
 *
 * The cut is the whole point: what it restores is the code as it stood on
 * 2026-08-25, when the tool reported on Beaconsfield for a place called
 * Beaconsfield Waitrose and nothing in the output said so.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-redteam-source.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'redteam_source.js');
const TEST = path.join(ROOT, 'test', 'redteam_source.test.js');

/* Cut a [start, end) span out of the source, asserting both anchors were found.
 * An anchor that has silently stopped matching would make this harness pass by
 * cutting nothing, which is the same class of lie it exists to catch. */
function cut(src, start, end, what) {
  const a = src.indexOf(start), b = src.indexOf(end);
  if (a < 0 || b < 0 || b < a) {
    console.error(`prove-red-redteam-source: could not find ${what} in assets/redteam_source.js.`);
    console.error(`  looked for:\n    ${JSON.stringify(start)}\n    ${JSON.stringify(end)}`);
    console.error('  If it was deliberately removed, delete this harness with it.');
    process.exit(1);
  }
  return src.slice(0, a) + src.slice(b);
}

let broken = fs.readFileSync(SRC, 'utf8');
broken = cut(broken,
  '/* AMBIGUITY GUARD (OA-141).',
  '// When were the inputs the red team is diffed against last pulled?',
  'the ambiguity guard');
broken = cut(broken,
  '// Always say which folder that name came out of (OA-141).',
  'console.log(`  inputs last pulled',
  'the build-examined line');

for (const gone of ['AMBIGUOUS', 'build examined', 'FOREIGN BUILD']) {
  if (broken.includes(gone)) {
    console.error(`prove-red-redteam-source: the cut left ${JSON.stringify(gone)} behind — the fixture is not broken.`);
    process.exit(1);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-red-rts-'));
const copy = path.join(dir, 'redteam_source.js');
fs.writeFileSync(copy, broken);

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, REDTEAM_SOURCE_JS: copy } });
const out = r.stdout + r.stderr;

/*
 * Parse the per-test verdicts rather than the exit code: "some failed" is not
 * the claim. The claim is WHICH failed.
 *
 * BOTH REPORTER FORMATS ARE READ, and that is not belt-and-braces (2026-08-29).
 * `node --test` defaults to `spec` from Node 22 and to `tap` before it. This
 * laptop runs Node 24 and the CI runner is pinned to Node 20, so the very first
 * CI run of this harness read zero tests out of a perfectly correct `# pass 2 /
 * # fail 4` and failed on its own count assertion — which is the count
 * assertion doing its job, and the reason it is here. The --test-reporter=spec
 * above pins the format; this reads either, so a Node bump on either side
 * cannot silently empty the parser again. prove-red-stage-commit.js carried the
 * same spec-only parser and the same latent failure, never noticed because it
 * has never run anywhere but a Windows laptop.
 */
const failed = new Set(), passed = new Set();
for (const line of out.split('\n')) {
  const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
  if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
  // TAP: top-level results only — nested subtests are indented, and the trailing
  // "# SKIP"/"# TODO" directives are not verdicts we assert on here.
  const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
  if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
}

const all = [...passed, ...failed];
const controls = all.filter(n => n.startsWith('CONTROL'));
const guards = all.filter(n => !n.startsWith('CONTROL'));

console.log('fixture      : assets/redteam_source.js with both OA-141 changes cut out');
console.log(`controls     : ${controls.length}  (must all PASS)`);
console.log(`guard tests  : ${guards.length}  (must all FAIL)`);

let bad = false;
// The counts are asserted as well as the verdicts. A test file that lost its
// guard cases would otherwise report a tidy, meaningless green.
if (controls.length !== 2) { console.error(`FAIL: expected 2 CONTROL tests, found ${controls.length}`); bad = true; }
if (guards.length !== 4) { console.error(`FAIL: expected 4 guard tests, found ${guards.length}`); bad = true; }
for (const n of controls) if (failed.has(n)) { console.error(`FAIL: CONTROL went red — the cut broke ordinary use, so nothing below is evidence: ${n}`); bad = true; }
for (const n of guards) if (passed.has(n)) { console.error(`FAIL: guard test stayed green with the guard removed — it is not testing the guard: ${n}`); bad = true; }

if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nOK — both OA-141 changes were watched going red, and ordinary use stayed green.');
