#!/usr/bin/env node
/*
 * prove-red-redteam-budget.js — watch the OA-427 budget rules go red.
 *
 * test/redteam_budget.test.js is twelve green assertions about a rationing rule
 * that, on the estate as it stands today, RATIONS NOTHING: there is no
 * `redteam-budget.json` yet, so every real run takes the `no-budget` arm. A suite
 * like that is the easiest kind of green-for-ever — it can be green because the
 * rule works or because the rule is never reached, and nothing in the suite can
 * tell those apart. This harness makes the difference visible by breaking the
 * rule on purpose, four ways, and requiring the right cases to fail each time.
 *
 * THE FOUR MUTATIONS, each a DIFFERENT ANSWER and not merely a missing line — a
 * mutation that deletes a rule can be survived by a test that never exercised it,
 * where a mutation that inverts one cannot:
 *
 *   1. THE MONTH FILTER. Charge every month's buys to this month. If no case goes
 *      red, nothing is asserting that August's spend is not September's, and a
 *      budget that accumulates for ever refuses every buy by the third month.
 *   2. THE NOMINAL PRICE. Price an unmeasured buy at zero. This is the dangerous
 *      one: it is invisible until the month a buy carries no `--tokens`, and it
 *      turns a budget into decoration. The estate's records carry NO measured
 *      cost at all today, so this mutation would be free in production.
 *   3. THE COVERAGE COUNT. Report every S6 run as recorded. That is the
 *      "NOT RECORDED IS NOT ZERO" claim, and it is the difference between a spend
 *      figure and a floor.
 *   4. THE ABSENT-FILE ARM. Make a missing budget file refuse a buy. Both
 *      CONTROLs must go red here and nothing else needs to: this is the arm that
 *      would stop the whole estate dead on the day it merged, and it is the one
 *      an author "tidying up" is most likely to write.
 *
 * THE CONTROLS ARE ASSERTED IN BOTH DIRECTIONS. They must STAY GREEN under
 * mutations 1-3 (breaking the arithmetic must not break ordinary unrationed use)
 * and must GO RED under mutation 4 (they are the only thing watching that arm).
 * A run where everything reddens proves the harness mangled the file.
 *
 * THE SUBJECT IS BYTE-RESTORED, and `diff -q`'s question — is this the same file
 * — is asked at the end rather than assumed from "the write did not throw".
 *
 * Run from make-bus-leaflet:  node tools/prove-red-redteam-budget.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'redteam_budget.js');
const TEST = path.join(ROOT, 'test', 'redteam_budget.test.js');
const ORIGINAL = fs.readFileSync(SRC, 'utf8');

/* Replace an anchor, asserting it was found exactly once. An anchor that has
 * silently stopped matching would make this harness pass by mutating nothing,
 * which is the same class of lie it exists to catch; an anchor that matches twice
 * is the OA-426 failure — a duplicated line is invisible to every test and
 * visible only here, because a mutation is addressed by TEXT. */
function mutate(src, from, to, what) {
  const n = src.split(from).length - 1;
  if (n !== 1) {
    console.error(`prove-red-redteam-budget: the anchor for ${what} matched ${n} time(s) in assets/redteam_budget.js; it must match exactly once.`);
    console.error(`  looked for: ${JSON.stringify(from)}`);
    console.error('  If the rule was deliberately removed, delete this arm with it.');
    process.exit(1);
  }
  return src.split(from).join(to);
}

const ARMS = [
  {
    name: 'the month filter — every month charged to this one',
    apply: (s) => mutate(s,
      'const mine = parsed.filter((d) => !d.bad && monthOf(d.at) === month);',
      'const mine = parsed.filter((d) => !d.bad);',
      'the month filter'),
    mustFail: ["another month's buys are not this month's spend"],
  },
  {
    name: 'the nominal price — an unmeasured buy costs nothing',
    apply: (s) => mutate(s,
      'const nominalTokens = nominalPrice === null ? null : nominal.length * nominalPrice;',
      'const nominalTokens = nominalPrice === null ? null : 0;',
      'the nominal price'),
    mustFail: [
      'a budget with room says buy',
      'a budget that is spent says wait, not fail',
      'a measured cost is used instead of the nominal one, and both are reported apart',
      'a REUSE costs nothing and is counted apart from a BUY',
      "another month's buys are not this month's spend",
      'an explicit price beats the nominal one when asking whether a buy fits',
      /* NOT the coverage case. It asserts how many runs carry a record, which is
       * a count of files and says nothing about what they cost — so it is right
       * that zeroing the nominal price leaves it green, and claiming it here
       * would have been a vacuous assertion this harness caught on its first run. */
    ],
  },
  {
    name: 'the coverage count — every run reported as recorded',
    apply: (s) => mutate(s,
      'const unrecorded = runsThisMonth.filter((r) => !recorded.has(`${r.map}\\u0000${r.run}`));',
      'const unrecorded = [];',
      'the coverage count'),
    mustFail: ['an S6 run with no decision record is counted as unrecorded, not as zero'],
  },
  {
    name: 'the absent-file arm — no budget stated reads as "no"',
    apply: (s) => mutate(s,
      "    return { verdict: 'no-budget', why: state && state.budget.status === 'unreadable'",
      "    return { verdict: 'wait', why: state && state.budget.status === 'unreadable'",
      'the absent-file arm'),
    mustFail: [
      'CONTROL: with no budget file, nothing is rationed and a BUY goes ahead',
      'CONTROL: an unreadable budget file also rations nothing, and says which it is',
    ],
  },
];

/* Run the suite against a mutated COPY, never against the file in assets/. The
 * subject is read through REDTEAM_BUDGET_JS, so the real file is never written
 * to and there is no window in which a concurrent build could load a broken one. */
function runAgainst(source) {
  const dir = scratchDir('prove-red-rtb-');
  const copy = path.join(dir, 'redteam_budget.js');
  fs.writeFileSync(copy, source);
  // The subject's siblings, for the reason prove-red-redteam-source.js states at
  // length: a scratch world that silently lacks a dependency is how a mutation
  // "survives" for the wrong reason.
  for (const sibling of ['cli.js']) fs.copyFileSync(path.join(ROOT, 'assets', sibling), path.join(dir, sibling));
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, REDTEAM_BUDGET_JS: copy } });
  const out = r.stdout + r.stderr;
  const failed = new Set(), passed = new Set();
  /* BOTH REPORTER FORMATS, for the reason prove-red-redteam-source.js gives: this
   * laptop runs Node 24 (spec) and the CI runner is pinned to Node 20 (tap), and
   * a spec-only parser reads zero tests out of a perfectly correct CI run. */
  for (const line of out.split('\n')) {
    const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
    if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
    const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
    if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
  }
  return { failed, passed, out };
}

let bad = false;

/* THE BASELINE. Everything green before anything is broken — otherwise a red
 * below says nothing about the mutation. */
const base = runAgainst(ORIGINAL);
const CASES = [...base.passed, ...base.failed];
if (CASES.length !== 12) { console.error(`FAIL: expected 12 cases in the suite, found ${CASES.length}`); bad = true; }
if (base.failed.size) { console.error(`FAIL: the unmutated suite is not green (${[...base.failed].join('; ')})`); bad = true; }
if (bad) { console.error('\n--- baseline output ---\n' + base.out); process.exit(1); }
console.log(`baseline     : ${CASES.length} cases, all green`);

for (const arm of ARMS) {
  const { failed, passed, out } = runAgainst(arm.apply(ORIGINAL));
  /* Every name this arm claims must exist in the suite. A `mustFail` naming a
   * case that has been renamed away would otherwise be asserted vacuously. */
  for (const n of arm.mustFail) if (!CASES.includes(n)) { console.error(`FAIL: ${arm.name}: names a case that is not in the suite: ${n}`); bad = true; }
  for (const n of arm.mustFail) if (!failed.has(n)) { console.error(`FAIL: ${arm.name}: "${n}" stayed GREEN with the rule broken — it is not testing that rule.`); bad = true; }
  const unexpected = [...failed].filter((n) => !arm.mustFail.includes(n));
  if (unexpected.length) { console.error(`FAIL: ${arm.name}: cases reddened that this arm does not claim: ${unexpected.join('; ')}`); bad = true; }
  if (failed.size && passed.size === 0) { console.error(`FAIL: ${arm.name}: EVERYTHING reddened — the fixture is mangled, not mutated.`); bad = true; }
  console.log(`arm          : ${arm.name} — ${failed.size} red, ${passed.size} green`);
  if (bad) { console.error('\n--- arm output ---\n' + out); break; }
}

/* THE SUBJECT IS UNTOUCHED, asked rather than assumed. Every mutation above ran
 * from a scratch copy, so this should be a formality — and a formality that has
 * never been checked is how a harness comes to leave a broken engine behind. */
if (fs.readFileSync(SRC, 'utf8') !== ORIGINAL) {
  console.error('FAIL: assets/redteam_budget.js is not byte-identical to how this harness found it.');
  bad = true;
}

if (bad) process.exit(1);
console.log('\nOK — all four budget rules were watched going red, and the unrationed arm stayed green under the other three.');
