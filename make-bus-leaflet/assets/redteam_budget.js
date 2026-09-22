#!/usr/bin/env node
/*
 * redteam_budget.js — how much of this month's red-team spend is left, and
 * whether a BUY may go ahead (buses-data OA-427, item 3 of R9 of the process
 * review of 2026-09-17).
 *
 * WHY THERE IS A BUDGET AT ALL. The blind red-team agent is the most expensive
 * thing in this skill — 89k-137k tokens and 41-70 tool calls per town, about
 * 814,000 tokens for seven towns on 2026-08-26 (references/s6-verify.md, "Cost").
 * `redteam_source.js` already stops us re-buying an answer we own. What it cannot
 * do is stop a month in which twenty maps each legitimately need a fresh answer
 * from spending twenty answers' worth in a week, which is what an unattended
 * monthly refresh makes possible for the first time: until R9 a person started
 * every S6, and the budget was their attention.
 *
 * SO A BUY IS RATIONED, AND THE RATION IS STATED RATHER THAN GUESSED. The figure
 * lives in `redteam-budget.json` at the estate root, beside `service-facts.json`,
 * because it is a policy about this estate and not a property of the engine. The
 * engine ships no default: a missing file means NO BUDGET IS STATED, and this
 * says so rather than inventing one. An invented budget would be indistinguishable
 * from a decided one the moment it was in a run record, which is the argument
 * `stage.js` makes about `--tokens` and this file makes again.
 *
 * WHAT RUNNING OUT MEANS, AND IT IS THE POINT OF THE ROW. A BUY with no budget
 * left is not a failure and must never be a red. It is a CHORE: the map waits,
 * its S6 waits with it, and the board carries it as a row until the month turns
 * or Peter raises the figure. A red would say a map is broken; nothing is broken.
 *
 * WHAT IS COUNTED, AND WHY IT IS A FLOOR RATHER THAN A TOTAL. Spend is read from
 * the decision records `redteam_source.js` writes — `redteam-source.json` in each
 * S6 run dir — and never inferred from a `redteam.json`'s shape. A record is a
 * statement; a shape is a guess, and the two are indistinguishable once a number
 * is in a report. Every S6 run that bought an answer BEFORE this existed has no
 * record, so it cannot be counted, and NOT RECORDED IS NOT ZERO: every answer
 * carries `coverage`, which says how many of the month's S6 runs had a record and
 * how many did not. A caller that prints the spend without the coverage is
 * reporting a floor as a total.
 *
 * PRICING A BUY. Where the record carries a measured `tokens` — stated by the
 * session that spent them, on `stage.js`'s terms — that is what the buy cost.
 * Where it does not, the buy is priced at the budget file's own
 * `nominalBuyTokens`, and every output that used one says `nominal` beside it.
 * The two are never added into a figure that does not say how much of it is
 * which.
 *
 * PURE CORE, INJECTED EDGE, like `bods_scan.mjs` and `refresh_grades.mjs`: the
 * only thing that touches the disk is `defaultReadEstate`, it hands back raw
 * records, and `budgetState()` does the arithmetic — so the harness can falsify a
 * missing file, a bad schema, a month boundary and an over-spend with no estate
 * on disk at all.
 *
 * Run it from anywhere, with no placeholders:
 *     node "%SK%\redteam_budget.js" --build "<town or place folder>"
 *     node "%SK%\redteam_budget.js" --estate "C:\u3a St Ives\Using AI\Buses"
 *     node "%SK%\redteam_budget.js" --estate "<...>" --json
 *
 * EXIT CODES.  0 = a budget is stated and a BUY fits inside what is left.
 *             11 = a budget is stated and it is spent — WAIT, which is a chore.
 *              3 = no budget is stated (no file, or one this cannot read).
 *              2 = could not decide (no estate root, unreadable estate).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, readJson } = require('./cli.js');

/** The schema this reads. The producer stamps it; a bump is a refusal, not a guess. */
const SCHEMA = 1;

/** The file, and the marker that says a folder is the estate root. */
const BUDGET_FILE = 'redteam-budget.json';
const ESTATE_MARKERS = ['service-facts.json', 'engine.lock.json'];

/** The name `redteam_source.js` writes its decision under, in an S6 run dir. */
const DECISION_FILE = 'redteam-source.json';

/**
 * Walk up from `start` to the nearest folder carrying an estate marker, or null.
 * Two markers rather than one because a worktree or a fixture may carry either,
 * and a root that answers to neither is better refused than half-recognised.
 */
function findEstateRoot(start) {
  let d = path.resolve(start || '.');
  for (;;) {
    if (ESTATE_MARKERS.some((f) => fs.existsSync(path.join(d, f)))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** The month a date falls in, as `YYYY-MM`. The one place a date becomes a month. */
function monthOf(date) { return String(date || '').slice(0, 7); }

/**
 * The default disk read: the budget file's raw text (or null), and every S6
 * decision record in the estate as `{ map, run, text }`.
 *
 * IT READS DECISION RECORDS AND COUNTS S6 RUNS SEPARATELY, because the gap
 * between the two is the coverage figure, and a reader that saw only the records
 * could not tell an estate that bought nothing from one that recorded nothing.
 */
const defaultReadEstate = (root) => {
  const budgetPath = path.join(root, BUDGET_FILE);
  const budgetText = fs.existsSync(budgetPath) ? fs.readFileSync(budgetPath, 'utf8') : null;
  const decisions = [];
  const runs = [];
  const mapDirs = [];
  for (const top of ['Areas', 'Places']) {
    const dir = path.join(root, top);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const d = path.join(dir, name);
      if (!fs.existsSync(path.join(d, 'manifest.json'))) continue;
      mapDirs.push({ map: name, dir: d });
      /* A place may sit inside a town folder; one level of nesting is what this
       * estate has and what `Places/` was made for, so this does not recurse. */
      for (const sub of fs.readdirSync(d)) {
        const sd = path.join(d, sub);
        if (sub === 'S6-verify' || !fs.existsSync(path.join(sd, 'manifest.json'))) continue;
        mapDirs.push({ map: `${name}/${sub}`, dir: sd });
      }
    }
  }
  for (const { map, dir } of mapDirs) {
    const s6 = path.join(dir, 'S6-verify');
    if (!fs.existsSync(s6)) continue;
    for (const run of fs.readdirSync(s6)) {
      const rd = path.join(s6, run);
      if (!fs.statSync(rd).isDirectory()) continue;
      runs.push({ map, run });
      const f = path.join(rd, DECISION_FILE);
      if (fs.existsSync(f)) decisions.push({ map, run, text: fs.readFileSync(f, 'utf8') });
    }
  }
  return { budgetText, decisions, runs };
};

/**
 * Parse the budget file. Returns `{ status: 'ok', ... }`, or a status saying why
 * there is no figure. `none` and `unreadable` are kept apart on purpose: one says
 * nobody has set a budget, the other says somebody set one this cannot read, and
 * a caller that merged them would report a typo as a policy.
 */
function readBudget(text, { file } = {}) {
  if (text == null) return { status: 'none', file };
  const bad = (why) => ({ status: 'unreadable', file, why });
  let p;
  try { p = JSON.parse(text); } catch (e) { return bad(`it is not JSON (${e.message})`); }
  if (!p || typeof p !== 'object') return bad('it is not an object');
  if (p.schema !== SCHEMA) return bad(`its schema is ${JSON.stringify(p.schema)} and this reads ${SCHEMA}`);
  const n = (k) => (Number.isFinite(p[k]) && p[k] >= 0 ? p[k] : null);
  const monthlyTokens = n('monthlyTokens');
  if (monthlyTokens === null) return bad(`\`monthlyTokens\` is ${JSON.stringify(p.monthlyTokens)}, which is not a non-negative number`);
  const nominalBuyTokens = n('nominalBuyTokens');
  if (nominalBuyTokens === null) return bad(`\`nominalBuyTokens\` is ${JSON.stringify(p.nominalBuyTokens)}, which is not a non-negative number`);
  return { status: 'ok', file, monthlyTokens, nominalBuyTokens, setOn: p.setOn || null, setBy: p.setBy || null, note: p.note || null };
}

/** One decision record, parsed, or null with a reason. Never throws at a caller. */
function readDecision({ map, run, text }) {
  let p;
  try { p = JSON.parse(text); } catch (e) { return { map, run, bad: `not JSON (${e.message})` }; }
  if (!p || typeof p !== 'object') return { map, run, bad: 'not an object' };
  if (p.schema !== SCHEMA) return { map, run, bad: `schema ${JSON.stringify(p.schema)}` };
  if (!['BUY', 'REUSE', 'WAIT'].includes(p.decision)) return { map, run, bad: `decision ${JSON.stringify(p.decision)}` };
  const tokens = Number.isFinite(p.tokens) && p.tokens >= 0 ? p.tokens : null;
  return { map, run, decision: p.decision, at: String(p.at || '').slice(0, 10), tokens, why: p.why || null };
}

/**
 * The whole answer for one month. `month` is `YYYY-MM` and is the caller's to
 * supply — this file never reads the clock, so that a report built from it is a
 * pure function of its inputs (CLAUDE.md, "a generated file must not read the
 * clock"); `main()` below is the one place the clock is read, and it is not
 * generating anything byte-compared.
 */
function budgetState({ root, month, read = defaultReadEstate } = {}) {
  const raw = read(root);
  const budget = readBudget(raw.budgetText, { file: path.join(root, BUDGET_FILE) });
  const parsed = raw.decisions.map(readDecision);
  const unreadable = parsed.filter((d) => d.bad);
  const mine = parsed.filter((d) => !d.bad && monthOf(d.at) === month);
  const buys = mine.filter((d) => d.decision === 'BUY');

  /* MEASURED AND NOMINAL ARE ADDED, BUT NEVER SILENTLY. Both halves travel to the
   * caller beside the total, so a reader can see how much of the figure is a
   * statement and how much is the budget file's own price list. */
  const measured = buys.filter((d) => d.tokens !== null);
  const nominal = buys.filter((d) => d.tokens === null);
  const nominalPrice = budget.status === 'ok' ? budget.nominalBuyTokens : null;
  const measuredTokens = measured.reduce((a, d) => a + d.tokens, 0);
  const nominalTokens = nominalPrice === null ? null : nominal.length * nominalPrice;
  const spent = nominalTokens === null ? null : measuredTokens + nominalTokens;

  /* COVERAGE: the month's S6 runs against the month's decision records. A run's
   * month is the run id's own date prefix, which is how every other reader in
   * this estate dates a run. */
  const runsThisMonth = raw.runs.filter((r) => monthOf(r.run) === month);
  const recorded = new Set(mine.map((d) => `${d.map}\u0000${d.run}`));
  const unrecorded = runsThisMonth.filter((r) => !recorded.has(`${r.map}\u0000${r.run}`));

  const remaining = budget.status === 'ok' && spent !== null ? budget.monthlyTokens - spent : null;
  return {
    month, root, budget,
    buys: buys.length,
    measured: { buys: measured.length, tokens: measuredTokens },
    nominal: { buys: nominal.length, price: nominalPrice, tokens: nominalTokens },
    spent, remaining,
    reuses: mine.filter((d) => d.decision === 'REUSE').length,
    waits: mine.filter((d) => d.decision === 'WAIT').length,
    coverage: { s6Runs: runsThisMonth.length, recorded: mine.length, unrecorded: unrecorded.length },
    unreadable,
  };
}

/**
 * May a BUY go ahead? The only question `redteam_source.js` asks. `price` is what
 * this buy is expected to cost — the caller's estimate where it has one, the
 * nominal price otherwise.
 *
 * NO BUDGET STATED IS NOT "NO", and that matters: every S6 before this row was
 * built ran without one, and a tool that refused on an absent file would stop the
 * estate dead the moment it merged. It reports `no-budget` and the caller goes
 * ahead, saying so.
 */
function mayBuy(state, { price } = {}) {
  if (!state || state.budget.status !== 'ok') {
    return { verdict: 'no-budget', why: state && state.budget.status === 'unreadable'
      ? `${BUDGET_FILE} could not be read — ${state.budget.why}. Nothing is rationed until it is fixed.`
      : `no ${BUDGET_FILE} at the estate root, so no budget is stated and nothing is rationed.` };
  }
  const want = Number.isFinite(price) && price >= 0 ? price : state.budget.nominalBuyTokens;
  if (state.remaining === null) return { verdict: 'no-budget', why: 'the spend could not be computed' };
  if (want <= state.remaining) {
    return { verdict: 'buy', want, remaining: state.remaining,
      why: `${fmt(state.remaining)} of this month's ${fmt(state.budget.monthlyTokens)} is left and this buy is priced at ${fmt(want)}.` };
  }
  /* A NEGATIVE REMAINDER IS A REAL STATE AND IS SAID AS ONE. The month can be
   * over-spent — a buy recorded before the figure was set, or a figure lowered
   * mid-month — and "-50,000 is left" is a sentence nobody parses correctly on
   * first reading. It is the same number either way; only the wording moves. */
  const short = state.remaining < 0
    ? `this month is already OVER its ${fmt(state.budget.monthlyTokens)} by ${fmt(-state.remaining)}`
    : `only ${fmt(state.remaining)} of ${fmt(state.budget.monthlyTokens)} is left for ${state.month}`;
  return { verdict: 'wait', want, remaining: state.remaining,
    why: `this buy is priced at ${fmt(want)} and ${short}. `
      + 'This is a CHORE and not a fault: the map waits for the month to turn or for the figure to be raised.' };
}

const fmt = (n) => (n === null || n === undefined ? '(none)' : Number(n).toLocaleString('en-GB'));

/** The lines a caller prints. Kept here so `redteam_source.js` and the CLI agree. */
function report(state) {
  const b = state.budget;
  const L = [];
  L.push(`redteam_budget — ${state.month}`);
  L.push(`  estate             : ${state.root}`);
  if (b.status === 'ok') {
    L.push(`  budget             : ${fmt(b.monthlyTokens)} tokens/month${b.setOn ? `, set ${b.setOn}${b.setBy ? ' by ' + b.setBy : ''}` : ''}`);
    L.push(`  nominal buy        : ${fmt(b.nominalBuyTokens)} tokens — used only where a buy recorded no measured cost`);
    L.push(`  bought this month  : ${state.buys} (${state.measured.buys} measured = ${fmt(state.measured.tokens)}, ${state.nominal.buys} nominal = ${fmt(state.nominal.tokens)})`);
    L.push(`  spent / remaining  : ${fmt(state.spent)} / ${fmt(state.remaining)}`);
  } else if (b.status === 'none') {
    L.push(`  budget             : NONE STATED — no ${BUDGET_FILE} at ${state.root}. Nothing is rationed.`);
  } else {
    L.push(`  budget             : UNREADABLE — ${b.why}. Nothing is rationed until it is fixed.`);
  }
  L.push(`  also this month    : ${state.reuses} reuse(s), ${state.waits} wait(s)`);
  /* THE COVERAGE LINE IS NOT OPTIONAL. It is the difference between "we spent
   * this" and "this is the least we spent", and the second is what the number
   * actually is until every S6 writes a record. */
  const c = state.coverage;
  L.push(`  coverage           : ${c.recorded} of ${c.s6Runs} S6 run(s) this month carry a decision record`
    + (c.unrecorded ? ` — ${c.unrecorded} do NOT, so the spend above is a FLOOR and not a total` : ''));
  for (const u of state.unreadable) L.push(`  ! ignored ${u.map} ${u.run}: ${u.bad}`);
  return L;
}

function main() {
  const F = parseArgs(process.argv.slice(2));
  const flag = (n, d) => (typeof F[n] === 'string' ? F[n] : d);
  const start = flag('estate', null) || flag('build', null) || process.cwd();
  const root = flag('estate', null) ? path.resolve(flag('estate')) : findEstateRoot(start);
  if (!root) {
    console.error(`redteam_budget.js: no estate root above ${path.resolve(start)} — nothing there carries ${ESTATE_MARKERS.join(' or ')}.`);
    console.error('  Pass it: --estate "C:/u3a St Ives/Using AI/Buses"');
    process.exit(2);
  }
  /* THE ONE CLOCK READ IN THIS FILE, and it writes nothing byte-compared. */
  const month = flag('month', new Date().toISOString().slice(0, 7));
  const state = budgetState({ root, month });
  if ('json' in F) { console.log(JSON.stringify({ ...state, mayBuy: mayBuy(state) }, null, 2)); }
  else { for (const l of report(state)) console.log(l); }
  if (state.budget.status !== 'ok') process.exit(3);
  process.exit(mayBuy(state).verdict === 'wait' ? 11 : 0);
}

if (require.main === module) main();
module.exports = { SCHEMA, BUDGET_FILE, DECISION_FILE, ESTATE_MARKERS,
  findEstateRoot, monthOf, readBudget, readDecision, budgetState, mayBuy, report,
  defaultReadEstate, main };
