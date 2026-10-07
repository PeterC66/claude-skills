#!/usr/bin/env node
/*
 * prove-red-redteam-toward.js — falsify buses-data OA-575 (item A2 of the
 * 2026-10-06 simplification review): a move TOWARD the stored blind answer is
 * reused, and a move AGAINST it buys.
 *
 * Runs test/redteam_toward_answer.test.js against two broken copies, and for
 * each one names which cases must go red and which must stay green:
 *
 *   M1  THE REVERT. Every move buys, and our own verified-services.json is not
 *       asked about operator and days — the rule as it stood before OA-575.
 *       The toward cases must redden (they reuse now and bought then), and so
 *       must the SAFE-refresh-against case, which the old code REUSED: the hole
 *       this row found, where the refresh's S1 carries no feed derivation and
 *       the inherited one compared equal to itself.
 *   M2  THE PERMISSIVE RULE. Agreement always holds. This is the mutation the
 *       row's "rule that must hold" is about — a day string moving against the
 *       answer must still buy — and every against case must redden ON ITS EXIT
 *       CODE, which a too-generous agreement test would turn into a free reuse.
 *
 * Some M1 reds are on a message rather than an exit code: the old rule bought
 * those cases too, but could not say which value disagreed with what. They are
 * listed below as such, so nobody reads them as decisions the revert changed.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-redteam-toward.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const TEST = path.join(ROOT, 'test', 'redteam_toward_answer.test.js');

function fail(msg) {
  console.error('prove-red-redteam-toward: ' + msg);
  console.error('  If the change was deliberately removed, delete this harness with it.');
  process.exit(1);
}

const T = {
  daysTo: 'a days string that moved TO the answer is reused (OA-575)',
  daysAway: 'a days string that moved AWAY from the answer still buys (OA-575 prove-red)',
  operator: 'an operator that moved to the answer is reused; one that moved elsewhere buys (OA-575)',
  terminus: 'agreement licenses operator and days ONLY — a terminus riding along buys (OA-575)',
  noEntry: 'a route the answer does not mention cannot agree, and a qualified day is not agreement (OA-575)',
  refreshAgainst: 'a SAFE refresh S1 that moved a day string AGAINST the answer buys (OA-575 prove-red)',
  refreshTo: 'a SAFE refresh S1 that moved a day string TO the answer is reused (OA-575)',
  decided: 'a decided include in our file is still our reply, not a move (OA-332 under OA-575)',
};

/* Replace the span [start, end) of `src` with `next`; both anchors asserted. */
function span(src, start, end, next, what) {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  if (a < 0) fail(`could not find the start of ${what}:\n    ${JSON.stringify(start)}`);
  if (b < 0) fail(`could not find the end of ${what} after its start:\n    ${JSON.stringify(end)}`);
  return src.slice(0, a) + next + src.slice(b);
}

const MUTATIONS = [
  {
    name: 'M1, the rule reverted: every move buys, our file unasked',
    file: 'redteam_source.js',
    apply: s => span(s, 'function disagreements(', 'function whatMoved(', [
      'function disagreements(moved, answer, { pairsOnly = false } = {}) {',
      '  if (pairsOnly) return [];   // before OA-575 our own file was never asked',
      '  return moved.pairs.length || moved.gone.length || moved.came.length ? [\'reverted: any move buys\'] : [];',
      '}',
      '',
      '',
    ].join('\n'), 'disagreements()'),
    red: [T.daysTo, T.operator, T.refreshAgainst],
    redOnMessage: [T.daysAway, T.terminus, T.noEntry],
    green: [T.refreshTo, T.decided],
  },
  {
    name: 'M2, agreement always holds',
    file: 'redteam_agree.js',
    apply: s => s.replace('function agreesWithAnswer(answer, route, moved) {',
      'function agreesWithAnswer(answer, route, moved) {\n  return { ok: true };   // M2: agreement always holds'),
    red: [T.daysAway, T.operator, T.noEntry, T.refreshAgainst],
    redOnMessage: [],
    green: [T.daysTo, T.terminus, T.refreshTo, T.decided],
  },
];

let bad = false;
for (const m of MUTATIONS) {
  const dir = scratchDir('prove-red-rttoward-');
  for (const f of ['redteam_source.js', 'redteam_agree.js', 'cli.js', 'redteam_budget.js', 'gate_lib.js', 'line_endings.js', 'scratch.js']) {
    fs.copyFileSync(path.join(ASSETS, f), path.join(dir, f));
  }
  const target = path.join(dir, m.file);
  const was = fs.readFileSync(target, 'utf8');
  const now = m.apply(was);
  if (now === was) fail(`${m.name}: the fixture is byte-identical to the source — nothing was mutated.`);
  fs.writeFileSync(target, now);
  const syn = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (syn.status !== 0) fail(`${m.name}: the mutated fixture does not parse:\n${syn.stderr || ''}`);

  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, REDTEAM_SOURCE_JS: path.join(dir, 'redteam_source.js') } });
  const out = r.stdout + r.stderr;
  // Per-test verdicts, both reporter formats, as prove-red-redteam-fingerprint.js reads them.
  const failed = new Set(), passed = new Set();
  for (const line of out.split('\n')) {
    const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
    if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
    const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
    if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
  }
  const all = new Set([...passed, ...failed]);
  const named = [...m.red, ...m.redOnMessage, ...m.green];
  console.log(`\n${m.name}`);
  // Every case in the file must be classified, so a new case cannot slip in unexamined.
  if (all.size !== Object.keys(T).length) { console.error(`  FAIL: expected ${Object.keys(T).length} cases, found ${all.size}`); bad = true; }
  for (const n of all) if (!Object.values(T).includes(n)) { console.error(`  FAIL: unclassified case: ${n}`); bad = true; }
  for (const n of named) if (!all.has(n)) { console.error(`  FAIL: case not run: ${n}`); bad = true; }
  for (const n of [...m.red, ...m.redOnMessage]) {
    const ok = failed.has(n);
    console.log(`  ${ok ? 'red  ' : 'GREEN'} ${n}${m.redOnMessage.includes(n) ? '   (on its message)' : ''}`);
    if (!ok) { console.error(`  FAIL: stayed green under ${m.name} — it does not test the change`); bad = true; }
  }
  for (const n of m.green) {
    const ok = passed.has(n);
    console.log(`  ${ok ? 'green' : 'RED  '} ${n}`);
    if (!ok) { console.error(`  FAIL: went red under ${m.name}, which should not touch it`); bad = true; }
  }
  if (bad) console.error('\n--- test output ---\n' + out);
}

if (bad) process.exit(1);
console.log('\nOK — the revert was watched buying what agreement reuses and reusing the refresh it must buy,');
console.log('     and a permissive agreement was watched reusing every move against the answer.');
