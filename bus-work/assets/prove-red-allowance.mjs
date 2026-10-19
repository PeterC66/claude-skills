#!/usr/bin/env node
/* Prove the shared usage gate admits a class only under its ceilings, refuses on usage it could
 * not read, lets every class run as publish-path only when the weekly reset is near and usage is
 * low, and that the weekly adjuster's two rules fire, and stop at their hard limits (allowance.mjs,
 * buses-data steps 2 and 3 of the S6 commissioning proposal, 19 October 2026).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), with no placeholders:
 *
 *   node prove-red-allowance.mjs
 *
 * WHAT IS BEING FALSIFIED. Each rule is asked of invented figures and paired with its opposite,
 * because a gate that always says yes passes every "may it run" case. Then the command line, in a
 * scratch folder, for its three exit codes. Then the MUTATION arm: a scratch copy of allowance.mjs,
 * one deliberate break each, and the case that must object. Nothing in the real tree or in
 * ~/.claude is read or written.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const POLICY = {
  schema: 1,
  classes: { 'publish-path': { weeklyUnder: 92, fiveHourUnder: 85 }, upkeep: { weeklyUnder: 85, fiveHourUnder: 75 }, background: { weeklyUnder: 75, fiveHourUnder: 70 } },
  useItOrLoseIt: { hoursBeforeReset: 24, weeklyUnder: 60, runsAs: 'publish-path' },
  adjust: {
    s6Raise: { weekEndedUnder: 80, mapWaitedDaysOver: 3, raiseTokens: 113000, maxMonthlyTokens: 1130000 },
    backgroundCut: { weekReached: 95, cutPoints: 5, floorWeeklyUnder: 60 },
  },
  changes: [],
};
const NOW = '2026-10-20T10:00:00Z', FAR = '2026-10-26T14:00:00Z', NEAR = '2026-10-21T02:00:00Z';
const fig = (o) => ({ classes: ['background'], status: 'ok', fiveHour: 10, weekly: 10, weeklyResetsAt: FAR, now: NOW, ...o });
const S6 = (o) => ({ waits: 0, oldestWaitDays: 0, monthlyTokens: 700000, ...o });
const WEEK = (peak) => ({ reset: '2026-10-19T14:00:00Z', peakWeekly: peak });

const CASES = {
  'a class under both its ceilings runs': ({ decide }) => {
    const d = decide(POLICY, fig({ weekly: 74, fiveHour: 69 }));
    return d.proceed && d.admits.join() === 'background' ? null : JSON.stringify(d);
  },
  'CONTROL: at its weekly ceiling it does not': ({ decide }) => {
    const d = decide(POLICY, fig({ weekly: 75 }));
    return !d.proceed ? null : JSON.stringify(d);
  },
  'CONTROL: at its 5-hour ceiling it does not': ({ decide }) => {
    const d = decide(POLICY, fig({ fiveHour: 70 }));
    return !d.proceed ? null : JSON.stringify(d);
  },
  'usage that could not be read is a skip, never a pass': ({ decide }) => {
    const d = decide(POLICY, fig({ status: 'unavailable', weekly: 0, fiveHour: 0 }));
    return !d.proceed && d.mode === 'unread' ? null : JSON.stringify(d);
  },
  'a run asking for two classes is told which one it may do': ({ decide }) => {
    const d = decide(POLICY, fig({ classes: ['publish-path', 'upkeep'], weekly: 88 }));
    return d.proceed && d.admits.join() === 'publish-path' ? null : JSON.stringify(d);
  },
  'near the reset with usage low, background runs as publish-path': ({ decide }) => {
    const d = decide(POLICY, fig({ weekly: 55, fiveHour: 80, weeklyResetsAt: NEAR }));
    return d.proceed && d.mode === 'use-it-or-lose-it' ? null : JSON.stringify(d);
  },
  'CONTROL: far from the reset, the same figures skip background': ({ decide }) => {
    const d = decide(POLICY, fig({ weekly: 55, fiveHour: 80, weeklyResetsAt: FAR }));
    return !d.proceed ? null : JSON.stringify(d);
  },
  'CONTROL: near the reset but at 60% or more, the class keeps its own ceiling': ({ decide }) => {
    const d = decide(POLICY, fig({ weekly: 60, fiveHour: 80, weeklyResetsAt: NEAR }));
    return !d.proceed && d.mode === 'normal' ? null : JSON.stringify(d);
  },
  'the week report takes the peak, and counts a skip per class asked': ({ weekReport }) => {
    const r = '2026-10-19T14:00:00Z';
    const e = [
      { event: 'gate', status: 'ok', weekly: 70, weeklyResetsAt: r, classes: ['background'], admits: ['background'] },
      { event: 'after', status: 'ok', weekly: 83, weeklyResetsAt: r },
      { event: 'gate', status: 'ok', weekly: 80, weeklyResetsAt: r, classes: ['publish-path', 'upkeep'], admits: ['publish-path'] },
      { event: 'gate', status: 'ok', weekly: 2, weeklyResetsAt: FAR, classes: ['background'], admits: [] },
    ];
    const w = weekReport(e, { now: NOW, policy: POLICY });
    const ok = w && w.reset === r && w.peakWeekly === 83 && w.perClass.upkeep.skipped === 1 && w.perClass['publish-path'].ran === 1 && w.perClass.background.skipped === 0;
    return ok ? null : JSON.stringify(w);
  },
  'a quiet week with a map waiting four days raises next month\'s S6 budget by one answer': ({ adjustWeek }) => {
    const e = adjustWeek(POLICY, WEEK(70), S6({ oldestWaitDays: 4 }));
    return e.length === 1 && e[0].kind === 's6-raise' && e[0].month === '2026-11' && e[0].to === 813000 ? null : JSON.stringify(e);
  },
  'CONTROL: a busy week does not raise it': ({ adjustWeek }) => {
    const e = adjustWeek(POLICY, WEEK(80), S6({ oldestWaitDays: 4 }));
    return e.length === 0 ? null : JSON.stringify(e);
  },
  'CONTROL: a quiet week with no map waiting past three days does not either': ({ adjustWeek }) => {
    const e = adjustWeek(POLICY, WEEK(70), S6({ oldestWaitDays: 3 }));
    return e.length === 0 ? null : JSON.stringify(e);
  },
  'a WAIT this month counts as a map waiting': ({ adjustWeek }) => {
    const e = adjustWeek(POLICY, WEEK(70), S6({ waits: 1 }));
    return e[0] && e[0].kind === 's6-raise' ? null : JSON.stringify(e);
  },
  'the raise stops at the hard ceiling, and says so': ({ adjustWeek }) => {
    const e = adjustWeek(POLICY, WEEK(70), S6({ oldestWaitDays: 9, monthlyTokens: 1130000 }));
    return e.length === 1 && e[0].kind === 'held' ? null : JSON.stringify(e);
  },
  'a week that reached 95% lowers the background ceiling by five': ({ adjustWeek }) => {
    const e = adjustWeek(POLICY, WEEK(95), S6());
    return e.length === 1 && e[0].kind === 'background-cut' && e[0].to === 70 ? null : JSON.stringify(e);
  },
  'CONTROL: 94% does not': ({ adjustWeek }) => {
    const e = adjustWeek(POLICY, WEEK(94), S6());
    return e.length === 0 ? null : JSON.stringify(e);
  },
  'the cut never goes below the floor': ({ adjustWeek }) => {
    const p = JSON.parse(JSON.stringify(POLICY)); p.classes.background.weeklyUnder = 62;
    const e = adjustWeek(p, WEEK(97), S6());
    return e[0] && e[0].kind === 'background-cut' && e[0].to === 60 ? null : JSON.stringify(e);
  },
  'a raise already scheduled for next month is built on, not repeated': ({ adjustWeek, budgetFor }) => {
    const budget = { monthlyTokens: 700000, schedule: [{ from: '2026-11', monthlyTokens: 813000 }] };
    const e = adjustWeek(POLICY, WEEK(70), S6({ oldestWaitDays: 5, scheduledFor: (m) => budgetFor(budget, m) }));
    return e[0] && e[0].from === 813000 && e[0].to === 926000 ? null : JSON.stringify(e);
  },
};

const real = await import(pathToFileURL(path.join(HERE, 'allowance.mjs')).href + '?real');
for (const [name, fn] of Object.entries(CASES)) {
  let why; try { why = fn(real); } catch (e) { why = 'threw: ' + e.message; }
  check(name, why === null, why);
}

// ---- the command line, in a scratch folder ----
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'allowance-'));
try {
  const pol = path.join(scratch, 'allowance.json'), log = path.join(scratch, 'log.jsonl');
  fs.writeFileSync(pol, JSON.stringify(POLICY));
  const run = (...a) => spawnSync(process.execPath, [path.join(HERE, 'allowance.mjs'), ...a, '--policy', pol, '--log', log, '--now', NOW], { encoding: 'utf8' });
  const g = (o) => run('gate', '--task', 't', '--class', o.cls || 'background', '--status', o.status || 'ok', '--five-hour', String(o.fh ?? 10), '--weekly', String(o.wk ?? 10), '--weekly-resets', FAR);
  const yes = g({}), no = g({ wk: 80 }), unread = g({ status: 'unavailable' });
  check('the command line exits 0 and prints ADMITS on a pass', yes.status === 0 && /^ADMITS background/m.test(yes.stdout), `${yes.status} ${yes.stdout}${yes.stderr}`);
  check('it exits 3 on an allowance skip', no.status === 3 && /SKIP: allowance/.test(no.stdout), `${no.status} ${no.stdout}`);
  check('it exits 3 on usage it could not read', unread.status === 3, `${unread.status}`);
  check('every gate is logged, the skips included', fs.readFileSync(log, 'utf8').trim().split('\n').length === 3);
  const typo = run('gate', '--task', 't', '--clas', 'background', '--status', 'ok');
  check('an unknown flag is refused by name, exit 2', typo.status === 2 && /--clas/.test(typo.stderr), `${typo.status} ${typo.stderr}`);
  fs.writeFileSync(pol, '{ not json');
  const broken = g({});
  check('an unreadable policy file is exit 2, never a pass', broken.status === 2, `${broken.status}`);
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }

// ---- the mutation arm ----
const mscratch = fs.mkdtempSync(path.join(os.tmpdir(), 'allowance-m-'));
try {
  const src = fs.readFileSync(path.join(HERE, 'allowance.mjs'), 'utf8');
  const MUTANTS = [
    { what: 'unread usage passes', find: "if (status !== 'ok') return", repl: "if (false) return", must: 'usage that could not be read is a skip, never a pass' },
    { what: 'the weekly ceiling becomes inclusive', find: 'return weekly < k.weeklyUnder && fiveHour < k.fiveHourUnder;', repl: 'return weekly <= k.weeklyUnder && fiveHour < k.fiveHourUnder;', must: 'CONTROL: at its weekly ceiling it does not' },
    { what: 'the 5-hour window is ignored', find: 'return weekly < k.weeklyUnder && fiveHour < k.fiveHourUnder;', repl: 'return weekly < k.weeklyUnder;', must: 'CONTROL: at its 5-hour ceiling it does not' },
    { what: 'use-it-or-lose-it ignores the clock', find: 'hoursLeft >= 0 && hoursLeft < u.hoursBeforeReset && ', repl: '', must: 'CONTROL: far from the reset, the same figures skip background' },
    { what: 'use-it-or-lose-it ignores usage', find: ' && weekly < u.weeklyUnder;', repl: ';', must: 'CONTROL: near the reset but at 60% or more, the class keeps its own ceiling' },
    { what: 'the raise ignores how busy the week was', find: 'week.peakWeekly < r.weekEndedUnder && ', repl: '', must: 'CONTROL: a busy week does not raise it' },
    { what: 'the raise passes its hard ceiling', find: 'Math.min(current + r.raiseTokens, r.maxMonthlyTokens)', repl: 'current + r.raiseTokens', must: 'the raise stops at the hard ceiling, and says so' },
    { what: 'the cut passes its floor', find: 'Math.max(cur - b.cutPoints, b.floorWeeklyUnder)', repl: 'cur - b.cutPoints', must: 'the cut never goes below the floor' },
    { what: 'the week report forgets the after-readings', find: "const wk = entries.filter((e) => e.weeklyResetsAt === reset && e.status === 'ok');", repl: "const wk = entries.filter((e) => e.weeklyResetsAt === reset && e.status === 'ok' && e.event === 'gate');", must: 'the week report takes the peak, and counts a skip per class asked' },
  ];
  for (const [i, m] of MUTANTS.entries()) {
    if (!src.includes(m.find)) { check(`mutant "${m.what}" still finds its text`, false, 'the source moved; re-aim the mutant'); continue; }
    const f = path.join(mscratch, `allowance-${i}.mjs`);
    fs.writeFileSync(f, src.replace(m.find, m.repl));
    const mod = await import(pathToFileURL(f).href);
    let why; try { why = CASES[m.must](mod); } catch (e) { why = 'threw: ' + e.message; }
    check(`RED on "${m.what}" (${m.must})`, why !== null, 'the case still held against the broken copy');
  }
} finally { fs.rmSync(mscratch, { recursive: true, force: true }); }

console.log(bad ? `\nprove-red-allowance: ${bad} failure(s)` : '\nprove-red-allowance: every case held and every mutant was caught');
process.exit(bad ? 1 : 0);
