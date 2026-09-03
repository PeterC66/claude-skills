#!/usr/bin/env node
/*
 * prove-red-redteam-fingerprint.js — falsify the OA-166 change.
 *
 * Copies assets/redteam_source.js and puts the decision back the way it was on
 * 2026-08-29: no fingerprint, no --reuse-anyway, just "have S1 or S2 been
 * re-pulled since this answer was derived?". Then runs
 * test/redteam_fingerprint.test.js against that copy. The six guard tests must
 * FAIL — they are the change — and the two named CONTROL must still PASS.
 *
 * WHY THE FIXTURE IS A REPLACEMENT AND NOT A CUT. Deleting the fingerprint would
 * leave a file that does not parse, and a harness whose fixture crashes proves
 * only that it crashed: every test goes red, including the controls, and nothing
 * is distinguished from anything else. What is restored here is the code that
 * bought three red teams it did not need, so a green run of this harness is the
 * statement "we have watched the old rule make the old mistake, and the new one
 * not make it".
 *
 * Two hunks, both anchors asserted, and the result is checked for the two
 * expressions that must no longer be reachable — an anchor that silently stopped
 * matching would make this harness pass by changing nothing, which is the same
 * class of lie it exists to catch.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-redteam-fingerprint.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'redteam_source.js');
const TEST = path.join(ROOT, 'test', 'redteam_fingerprint.test.js');

let src = fs.readFileSync(SRC, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';

function fail(msg) {
  console.error('prove-red-redteam-fingerprint: ' + msg);
  console.error('  If the change was deliberately removed, delete this harness with it.');
  process.exit(1);
}

/* Replace the span [start, end) with `next`, keeping `end` in place. */
function span(start, end, next, what) {
  const a = src.indexOf(start), b = src.indexOf(end);
  if (a < 0) fail(`could not find the start of ${what}:\n    ${JSON.stringify(start)}`);
  if (b < a) fail(`could not find the end of ${what} after its start:\n    ${JSON.stringify(end)}`);
  src = src.slice(0, a) + next + src.slice(b);
}

const before = src.length;

// 1. The decision, back to the timestamp. `fp` survives as a dead object so the
//    lines downstream that ask `fp.ok` take the branch they took before OA-166.
span(
  '/* DID THE FACTS MOVE? (OA-166.)',
  'if (age > MAX_AGE) {',
  [
    'const fp = { ok: false };   // the pre-OA-166 code had no fingerprint at all',
    '// Compare dates only: derivedAt is a date, a run `at` is a date+time, and',
    '// comparing the two as strings made a same-day re-pull look newer than the answer.',
    'if (newestDataAt && String(newestDataAt).slice(0, 10) > best.at) {',
    '  reasons.push(`our ${newestDataStage} inputs were re-pulled on ${String(newestDataAt).slice(0, 10)}, after this answer was derived (${best.at}) — the thing being diffed has changed`);',
    '}',
    '',
  ].join(NL),
  'the fingerprint decision');

// 2. No override flag. With this null, the BUY block fires on every reason and
//    the override below it is unreachable, which is exactly its old state.
// THE ANCHOR IS THE VARIABLE, NOT THE PARSER BEHIND IT (2026-09-03). This
// matched `const REUSE_ANYWAY = argv.includes('--reuse-anyway')` until OA-232
// Tier 2.5 moved the file onto `cli.parseArgs`, and then the harness went red
// saying "could not find the start of the --reuse-anyway flag" -- red about a
// change to the FLAG READER, in a harness whose subject is the OA-166 fingerprint
// decision. An anchor is a claim about a line, so anchor on the shortest part
// that is really about the subject.
span(
  'const REUSE_ANYWAY = ',
  'function die(msg)',
  'const REUSE_ANYWAY = null;   // --reuse-anyway did not exist before OA-166' + NL + NL,
  'the --reuse-anyway flag');

if (src.length === before) fail('the fixture is byte-identical to the source — nothing was reverted.');
for (const gone of ['const fp = fingerprintPair(', "'reuse-anyway' in FLAGS"]) {
  if (src.includes(gone)) fail(`the revert left ${JSON.stringify(gone)} reachable — the fixture is not broken.`);
}

const dir = scratchDir('prove-red-rtfp-');
const copy = path.join(dir, 'redteam_source.js');
fs.writeFileSync(copy, src);
// The subject's siblings. This runs a reverted COPY out of a scratch folder, so
// every module it requires by relative path has to be beside it -- the same fix
// prove-red-redteam-source.js needed on the same day, and for the same reason:
// a scratch world silently missing a dependency is how a mutation "survives".
for (const sibling of ['cli.js']) {
  fs.copyFileSync(path.join(ROOT, 'assets', sibling), path.join(dir, sibling));
}

// A fixture that does not parse would redden the controls too, and a run where
// everything is red says nothing about which half is the change.
const syn = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
if (syn.status !== 0) fail('the reverted fixture does not parse:\n' + (syn.stderr || ''));

const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, REDTEAM_SOURCE_JS: copy } });
const out = r.stdout + r.stderr;

/* Parse the per-test verdicts rather than the exit code: "some failed" is not the
 * claim, WHICH failed is. Both reporter formats are read for the reason
 * prove-red-redteam-source.js records — `node --test` defaults to spec from Node
 * 22 and to tap before it, and CI is pinned older than this laptop. */
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

console.log('fixture      : assets/redteam_source.js with the OA-166 decision reverted to the pull timestamp');
console.log(`controls     : ${controls.length}  (must all PASS)`);
console.log(`guard tests  : ${guards.length}  (must all FAIL)`);

let bad = false;
// The counts are asserted as well as the verdicts. A test file that lost its
// guard cases would otherwise report a tidy, meaningless green.
if (controls.length !== 2) { console.error(`FAIL: expected 2 CONTROL tests, found ${controls.length}`); bad = true; }
if (guards.length !== 6) { console.error(`FAIL: expected 6 guard tests, found ${guards.length}`); bad = true; }
for (const n of controls) if (failed.has(n)) { console.error(`FAIL: CONTROL went red — the revert broke ordinary use, so nothing below is evidence: ${n}`); bad = true; }
for (const n of guards) if (passed.has(n)) { console.error(`FAIL: guard test stayed green under the OLD rule — it is not testing the change: ${n}`); bad = true; }

if (bad) { console.error('\n--- test output ---\n' + out); process.exit(1); }
console.log('\nOK — the old timestamp rule was watched buying red teams it did not need,');
console.log('     and the new rule was watched not buying them.');
