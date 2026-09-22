/*
 * redteam_budget.js — the monthly red-team ration (OA-427, item 3 of R9 of the
 * process review of 2026-09-17).
 *
 * `redteam_source.js` stops us re-buying an answer we already own. It cannot stop
 * a month in which twenty maps each legitimately need a fresh one from spending
 * twenty answers' worth in a week — which an unattended monthly refresh makes
 * possible for the first time, because until R9 a person started every S6 and the
 * budget was their attention.
 *
 * THE THREE CLAIMS THIS FILE ASSERTS, and each has a mutation arm in
 * tools/prove-red-redteam-budget.js:
 *
 *   1. NO BUDGET STATED IS NOT "NO". An absent file means nothing is rationed and
 *      a BUY goes ahead. A tool that refused on an absent file would stop the
 *      whole estate dead the moment it merged, and the CONTROLs below are what
 *      watch for that.
 *   2. NOT RECORDED IS NOT ZERO. The spend is counted from decision records, so
 *      an S6 run carrying none is invisible to it — and `coverage` must say so,
 *      because the difference between "we spent this" and "this is the least we
 *      spent" is the whole honesty of the number.
 *   3. A MEASURED COST AND A NOMINAL ONE ARE NEVER ADDED SILENTLY. Both halves
 *      travel beside the total.
 *
 * The month is INJECTED throughout. `budgetState` never reads the clock, so these
 * cases cannot start failing in October — a harness whose verdict depends on the
 * date is one that has to be re-proved every time it goes red.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const SUBJECT = process.env.REDTEAM_BUDGET_JS || path.join(__dirname, '..', 'assets', 'redteam_budget.js');
const B = require(SUBJECT);

/** An estate on disk: a budget file (or none) and a set of S6 runs. */
function estate({ budget, runs = [] }) {
  const root = scratchDir('redteam-budget-');
  fs.writeFileSync(path.join(root, 'service-facts.json'), '{}\n');
  if (budget !== undefined) fs.writeFileSync(path.join(root, B.BUDGET_FILE), typeof budget === 'string' ? budget : JSON.stringify(budget, null, 2));
  for (const r of runs) {
    const dir = path.join(root, 'Areas', r.map, 'S6-verify', r.run);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(root, 'Areas', r.map, 'manifest.json'), JSON.stringify({ town: r.map }));
    /* `raw` writes the file's bytes verbatim, for the cases about a record this
     * cannot read. It is a separate key from `decision` on purpose: the first
     * version of this helper overloaded one key on `typeof === 'string'`, and
     * since every real decision IS a string it wrote the literal text `BUY` into
     * every fixture and seven cases went red at once. */
    if (r.raw !== undefined) fs.writeFileSync(path.join(dir, B.DECISION_FILE), r.raw);
    else if (r.decision !== undefined) {
      fs.writeFileSync(path.join(dir, B.DECISION_FILE), JSON.stringify({
        schema: B.SCHEMA, decision: r.decision, at: r.at || r.run.slice(0, 10), why: 'test', ...(r.tokens != null ? { tokens: r.tokens } : {}),
      }, null, 2));
    }
  }
  return root;
}

const OK_BUDGET = { schema: 1, monthlyTokens: 300000, nominalBuyTokens: 100000, setOn: '2026-09-22', setBy: 'test' };

test('CONTROL: with no budget file, nothing is rationed and a BUY goes ahead', () => {
  const root = estate({ runs: [] });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.budget.status, 'none');
  assert.equal(B.mayBuy(s).verdict, 'no-budget', 'an absent budget file must not refuse a buy');
});

test('CONTROL: an unreadable budget file also rations nothing, and says which it is', () => {
  const root = estate({ budget: '{ not json' });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.budget.status, 'unreadable');
  assert.notEqual(s.budget.status, 'none', 'a typo must not read as a policy');
  assert.equal(B.mayBuy(s).verdict, 'no-budget');
});

test('a budget with room says buy', () => {
  const root = estate({ budget: OK_BUDGET, runs: [{ map: 'March', run: '2026-09-02_0900', decision: 'BUY' }] });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.buys, 1);
  assert.equal(s.spent, 100000, 'one nominal buy');
  assert.equal(s.remaining, 200000);
  assert.equal(B.mayBuy(s).verdict, 'buy');
});

test('a budget that is spent says wait, not fail', () => {
  const runs = ['2026-09-02_0900', '2026-09-03_0900', '2026-09-04_0900'].map((run, i) => ({ map: 'M' + i, run, decision: 'BUY' }));
  const root = estate({ budget: OK_BUDGET, runs });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.spent, 300000);
  assert.equal(s.remaining, 0);
  const m = B.mayBuy(s);
  assert.equal(m.verdict, 'wait');
  assert.match(m.why, /CHORE and not a fault/, 'running out must be stated as a chore, never as a fault');
});

test('a measured cost is used instead of the nominal one, and both are reported apart', () => {
  const root = estate({ budget: OK_BUDGET, runs: [
    { map: 'A', run: '2026-09-02_0900', decision: 'BUY', tokens: 130000 },
    { map: 'B', run: '2026-09-03_0900', decision: 'BUY' },
  ] });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.measured.buys, 1);
  assert.equal(s.measured.tokens, 130000);
  assert.equal(s.nominal.buys, 1);
  assert.equal(s.nominal.tokens, 100000);
  assert.equal(s.spent, 230000, 'measured and nominal add, but only after both are stated');
});

test('a REUSE costs nothing and is counted apart from a BUY', () => {
  const root = estate({ budget: OK_BUDGET, runs: [
    { map: 'A', run: '2026-09-02_0900', decision: 'REUSE' },
    { map: 'B', run: '2026-09-03_0900', decision: 'BUY' },
  ] });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.reuses, 1);
  assert.equal(s.buys, 1);
  assert.equal(s.spent, 100000, 'a reuse must not be priced');
});

test('another month\'s buys are not this month\'s spend', () => {
  const root = estate({ budget: OK_BUDGET, runs: [
    { map: 'A', run: '2026-08-30_0900', decision: 'BUY' },
    { map: 'B', run: '2026-09-03_0900', decision: 'BUY' },
  ] });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.buys, 1, 'August must not be charged to September');
  assert.equal(s.remaining, 200000);
});

test('an S6 run with no decision record is counted as unrecorded, not as zero', () => {
  const root = estate({ budget: OK_BUDGET, runs: [
    { map: 'A', run: '2026-09-02_0900', decision: 'BUY' },
    { map: 'B', run: '2026-09-03_0900' },
  ] });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.coverage.s6Runs, 2);
  assert.equal(s.coverage.recorded, 1);
  assert.equal(s.coverage.unrecorded, 1);
  assert.match(B.report(s).join('\n'), /FLOOR and not a total/, 'an incomplete spend must say so on its own line');
});

test('a decision record this cannot read is ignored and named, never counted', () => {
  const root = estate({ budget: OK_BUDGET, runs: [
    { map: 'A', run: '2026-09-02_0900', raw: '{ "schema": 99, "decision": "BUY", "at": "2026-09-02" }' },
  ] });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.buys, 0);
  assert.equal(s.unreadable.length, 1);
  assert.match(B.report(s).join('\n'), /ignored A 2026-09-02_0900/);
});

test('a budget missing nominalBuyTokens is unreadable, not half-usable', () => {
  const root = estate({ budget: { schema: 1, monthlyTokens: 300000 } });
  const s = B.budgetState({ root, month: '2026-09' });
  assert.equal(s.budget.status, 'unreadable');
  assert.match(s.budget.why, /nominalBuyTokens/);
});

test('an explicit price beats the nominal one when asking whether a buy fits', () => {
  const root = estate({ budget: OK_BUDGET, runs: [{ map: 'A', run: '2026-09-02_0900', decision: 'BUY' }] });
  const s = B.budgetState({ root, month: '2026-09' });   // 200,000 left
  assert.equal(B.mayBuy(s, { price: 150000 }).verdict, 'buy');
  assert.equal(B.mayBuy(s, { price: 250000 }).verdict, 'wait');
});

test('the estate root is found by its marker, walking up from a run dir', () => {
  const root = estate({ budget: OK_BUDGET, runs: [{ map: 'A', run: '2026-09-02_0900', decision: 'BUY' }] });
  const deep = path.join(root, 'Areas', 'A', 'S6-verify', '2026-09-02_0900');
  assert.equal(path.resolve(B.findEstateRoot(deep)), path.resolve(root));
});
