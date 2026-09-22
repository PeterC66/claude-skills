#!/usr/bin/env node
/*
 * prove-red-stage-s6-decision.js — falsify the OA-427 S6 decision guard.
 *
 * Two halves, so two arms, each a copy with ONE half cut out and run against
 * test/stage_s6_decision.test.js:
 *
 *   stage     stage.js with the S6 refusal disabled. The four stage-refusal tests
 *             must go red; everything else, the redteam_source half included,
 *             must hold.
 *   source    redteam_source.js with the decided-once block disabled. The five
 *             tests about a run dir that is already decided, or already holds an
 *             answer, must go red; everything else must hold.
 *
 * Each arm names EXACTLY which tests it reddens. A harness that asserted only
 * "something went red" could be satisfied by a copy that died in the module
 * loader, and an arm that reddened the other half's tests would mean the two
 * halves are not independent, which is worth knowing. The baseline is run first
 * and must be all green, and both subjects are byte-compared at the end.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-stage-s6-decision.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TEST = path.join(ROOT, 'test', 'stage_s6_decision.test.js');
const TOTAL = 14, CONTROLS = 5;

const ARMS = [
  {
    name: 'stage',
    subject: path.join(ROOT, 'assets', 'stage.js'),
    env: 'STAGE_JS',
    from: "if (st === 'S6' && fs.existsSync(path.join(runDir, 'redteam.json'))) {",
    to: "if (false) { // cut by prove-red-stage-s6-decision.js",
    red: [
      'an answer with no decision record is refused, and the manifest is not moved',
      'an answer beside a WAIT record is refused — it was bought against the ration',
      'an answer beside an unreadable record is refused',
      '--force-decision commits the bare answer, and says so',
    ],
  },
  {
    name: 'source',
    subject: path.join(ROOT, 'assets', 'redteam_source.js'),
    env: 'REDTEAM_SOURCE_JS',
    from: 'if (!DRY) {\n  const recFile = path.join(INTO, BUDGET.DECISION_FILE);',
    to: 'if (false) { // cut by prove-red-stage-s6-decision.js\n  const recFile = path.join(INTO, BUDGET.DECISION_FILE);',
    red: [
      'an answer already in the run dir with no record is refused, and nothing is written',
      '--already-bought records the answer as a BUY and leaves it untouched, and the commit then passes',
      'a run dir already decided BUY is not decided again',
      'a run dir already decided REUSE is not decided again',
      'an answer beside a WAIT record is refused by the tool too',
    ],
  },
];

/* Both reporter formats: `node --test` defaults to spec from Node 22 and to tap
 * before it, and the CI runner is pinned to Node 20. */
function runSuite(env) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
    { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, env) });
  const out = r.stdout + r.stderr;
  const failed = new Set(), passed = new Set();
  for (const line of out.split('\n')) {
    const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
    if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
    const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
    if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
  }
  return { out, failed, passed, all: [...passed, ...failed] };
}

const before = new Map(ARMS.map(a => [a.subject, fs.readFileSync(a.subject)]));
const copies = [];
const cleanup = () => { for (const c of copies) { try { fs.unlinkSync(c); } catch (e) { } } };
process.on('exit', cleanup);

let bad = false;
const fail = (msg) => { console.error('FAIL: ' + msg); bad = true; };

const base = runSuite({});
console.log(`baseline     : ${base.passed.size} pass, ${base.failed.size} fail of ${base.all.length}`);
if (base.all.length !== TOTAL) fail(`baseline parsed ${base.all.length} tests, expected ${TOTAL}`);
if (base.failed.size) fail('the baseline is not green, so no arm below can mean anything:\n  ' + [...base.failed].join('\n  '));
if (base.all.filter(n => n.startsWith('CONTROL')).length !== CONTROLS) fail(`expected ${CONTROLS} CONTROL tests`);

for (const arm of ARMS) {
  if (bad) break;
  const src = fs.readFileSync(arm.subject, 'utf8');
  if (!src.includes(arm.from)) { fail(`arm ${arm.name}: anchor not found in ${path.basename(arm.subject)} — narrow or update it`); break; }
  // The copy sits beside its subject: both files have relative requires, and a
  // copy anywhere else dies in the module loader and reddens every test.
  const copy = path.join(path.dirname(arm.subject), `.${path.basename(arm.subject, '.js')}.prove-red-s6-decision.js`);
  copies.push(copy);
  fs.writeFileSync(copy, src.replace(arm.from, arm.to));
  const r = runSuite({ [arm.env]: copy });
  const red = [...r.failed].sort(), want = [...arm.red].sort();
  console.log(`arm ${arm.name.padEnd(8)}: ${r.failed.size} red of ${r.all.length} (must be exactly ${want.length})`);
  if (r.all.length !== TOTAL) fail(`arm ${arm.name}: parsed ${r.all.length} tests, expected ${TOTAL}`);
  const missing = want.filter(n => !r.failed.has(n));
  const extra = red.filter(n => !arm.red.includes(n));
  if (missing.length) fail(`arm ${arm.name}: these stay GREEN with the guard cut, so they do not test it:\n  ` + missing.join('\n  '));
  if (extra.length) fail(`arm ${arm.name}: these went red and should not have — the cut broke more than its half:\n  ` + extra.join('\n  '));
  if (bad) console.error('\n--- test output ---\n' + r.out);
}

cleanup();
for (const [f, b] of before) if (!fs.readFileSync(f).equals(b)) fail(`${path.basename(f)} was changed by this harness`);

if (bad) process.exit(1);
console.log(`\nPROVEN RED: each arm reddens exactly its own tests, and all ${CONTROLS} controls hold in both.`);
