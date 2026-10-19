#!/usr/bin/env node
/*
 * allowance.mjs — the one usage policy every scheduled task reads, the log of what each run saw,
 * and the weekly report and bounded self-adjustment built on that log (buses-data, steps 2 and 3
 * of `Development Docs/s6-commissioning-and-a-shared-job-runner_2026-10-17.md`, Peter's yes to
 * both on 19 October 2026).
 *
 * WHY THIS EXISTS. The plan's weekly usage is what runs out, not money, and until this landed
 * the projects competed for it blind: the court-book batch gated itself on usage and no bus task
 * did. Rather than a dispatcher above the tasks — which would need a session of its own just to
 * decide — every task keeps its own schedule, lock and STOP file and asks this ONE policy file,
 * `~/.claude/allowance.json`, whether its CLASS of work may run at the usage it has just read.
 *
 * THE MODEL READS THE USAGE, THIS SCRIPT DECIDES. `get_usage` is a tool only the model can call,
 * so the gate is a prompt step: the run calls it and passes the figures here. The thresholds,
 * the use-it-or-lose-it rule and the log live in one place instead of being re-typed into three
 * prompts in three projects.
 *
 * From any folder; the script path is real, every <…> is a placeholder explained beside it:
 *
 *   node "C:/Buses/claude-skills/bus-work/assets/allowance.mjs" gate --task <task> --class <class[,class]>
 *        --status <plan.status> --five-hour <pct> --weekly <pct> --weekly-resets <ISO> [--run <run id>]
 *     <task> the scheduled task's name; <class> one or more of publish-path, upkeep, background (the
 *     classes this run COULD do); the four figures are get_usage's plan.status, the "5-hour limit"
 *     and "Weekly · all models" percentUsed, and that weekly window's resetsAt. Pass --status as
 *     whatever the tool said ("unavailable" when the call failed) and 0 for figures it gave none.
 *     Exit 0 = PROCEED, and stdout's line `ADMITS <classes>` says which of the asked classes may run;
 *     exit 3 = SKIP (not now), stdout says why; exit 2 = misuse or an unreadable policy file, which
 *     a caller treats as SKIP — a gate that cannot read its policy must not let work through.
 *   node "…/allowance.mjs" after --task <task> --run <run id> --status <s> --five-hour <pct> --weekly <pct> --weekly-resets <ISO>
 *     records the usage seen when the run ended, so a class's real cost can be read from the log.
 *   node "…/allowance.mjs" report [--json]
 *     the week that ended at the most recent weekly reset: peak weekly usage, runs and allowance
 *     skips per class, and every policy change dated in that week. Read-only.
 *   node "…/allowance.mjs" adjust --buses "C:/Buses/buses-data" [--apply]
 *     the two bounded rules (below) for each finished week not yet adjusted. Without --apply it
 *     says what it would change; with it, it writes allowance.json and redteam-budget.json.
 *   --policy <file> and --log <file> override ~/.claude/allowance.json and ~/.claude/allowance-log.jsonl;
 *   --now <ISO> overrides the clock (the harness uses it).
 *
 * THE TWO RULES, each bounded by a hard limit Peter set and recorded as a dated line in
 * `changes[]`, which the morning brief prints — never a silent edit:
 *   - S6 UP: a week that ended under `adjust.s6Raise.weekEndedUnder`% weekly AND in which a map
 *     waited more than `mapWaitedDaysOver` days for its S6 (or the month's budget said WAIT) raises
 *     the S6 budget from NEXT month by `raiseTokens`, never past `maxMonthlyTokens`.
 *   - BACKGROUND DOWN: a week that reached `adjust.backgroundCut.weekReached`% weekly lowers the
 *     background class's weekly ceiling by `cutPoints`, never below `floorWeeklyUnder`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CLASSES = ['publish-path', 'upkeep', 'background'];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 864e5;

/** Parse and validate the policy text. Returns { ok, policy } or { ok: false, why }. */
export function readPolicy(text) {
  let p;
  try { p = JSON.parse(text); } catch (e) { return { ok: false, why: `it is not JSON (${e.message})` }; }
  if (!p || p.schema !== 1) return { ok: false, why: `its schema is ${JSON.stringify(p && p.schema)} and this reads 1` };
  for (const c of CLASSES) {
    const k = p.classes && p.classes[c];
    if (!k || !Number.isFinite(k.weeklyUnder) || !Number.isFinite(k.fiveHourUnder)) return { ok: false, why: `class ${c} has no numeric weeklyUnder and fiveHourUnder` };
  }
  return { ok: true, policy: p };
}

/**
 * The gate. Pure: the caller supplies the policy, the figures and the clock.
 * Returns { proceed, admits[], mode, why }.
 */
export function decide(policy, { classes, status, fiveHour, weekly, weeklyResetsAt, now }) {
  const asked = classes.filter((c) => CLASSES.includes(c));
  if (!asked.length) return { proceed: false, admits: [], mode: 'refused', why: `no known class in ${JSON.stringify(classes)}` };
  if (status !== 'ok') return { proceed: false, admits: [], mode: 'unread', why: `usage could not be read (plan.status ${JSON.stringify(status)}); never proceed on usage you could not read` };
  if (![fiveHour, weekly].every(Number.isFinite)) return { proceed: false, admits: [], mode: 'unread', why: 'a usage figure is missing' };
  const u = policy.useItOrLoseIt;
  const resetMs = Date.parse(weeklyResetsAt || '');
  const hoursLeft = Number.isFinite(resetMs) ? (resetMs - Date.parse(now)) / 36e5 : Infinity;
  const loseIt = !!u && hoursLeft >= 0 && hoursLeft < u.hoursBeforeReset && weekly < u.weeklyUnder;
  const admits = asked.filter((c) => {
    const k = policy.classes[loseIt ? (u.runsAs || 'publish-path') : c];
    return weekly < k.weeklyUnder && fiveHour < k.fiveHourUnder;
  });
  const fig = `5-hour ${fiveHour}%, weekly ${weekly}%`;
  const mode = loseIt ? 'use-it-or-lose-it' : 'normal';
  if (!admits.length) {
    const lim = asked.map((c) => `${c} needs weekly under ${policy.classes[c].weeklyUnder}% and 5-hour under ${policy.classes[c].fiveHourUnder}%`).join('; ');
    return { proceed: false, admits, mode, why: `${fig}: ${lim}` };
  }
  return { proceed: true, admits, mode, why: `${fig}${loseIt ? `, and the weekly reset is ${hoursLeft.toFixed(1)} h away with usage under ${u.weeklyUnder}%, so every class runs as ${u.runsAs || 'publish-path'}` : ''}` };
}

/** The log, one JSON object per line; a line that does not parse is skipped and counted. */
export function readLog(text) {
  const entries = []; let unreadable = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { unreadable++; }
  }
  return { entries, unreadable };
}

/**
 * The week that ended at the most recent weekly reset at or before `now`: every entry whose
 * weeklyResetsAt is that reset. Pure. Returns null when the log holds no finished week.
 */
export function weekReport(entries, { now, policy }) {
  const t = Date.parse(now);
  const resets = [...new Set(entries.map((e) => e.weeklyResetsAt).filter((r) => r && Date.parse(r) <= t))].sort();
  if (!resets.length) return null;
  const reset = resets[resets.length - 1];
  const wk = entries.filter((e) => e.weeklyResetsAt === reset && e.status === 'ok');
  const peak = wk.reduce((m, e) => Math.max(m, Number.isFinite(e.weekly) ? e.weekly : 0), 0);
  const perClass = Object.fromEntries(CLASSES.map((c) => [c, { asked: 0, ran: 0, skipped: 0 }]));
  for (const e of entries.filter((x) => x.weeklyResetsAt === reset && x.event === 'gate')) {
    for (const c of e.classes || []) {
      if (!perClass[c]) continue;
      perClass[c].asked++;
      if ((e.admits || []).includes(c)) perClass[c].ran++; else perClass[c].skipped++;
    }
  }
  const from = new Date(Date.parse(reset) - 7 * DAY).toISOString();
  const changes = ((policy && policy.changes) || []).filter((c) => c.on >= from.slice(0, 10) && c.on <= reset.slice(0, 10));
  return { reset, from, peakWeekly: peak, readings: wk.length, perClass, changes };
}

const nextMonth = (iso) => { const d = new Date(iso); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 7); };

/**
 * The two bounded rules for one finished week. Pure: returns the edits, applies nothing.
 * `s6` is { oldestWaitDays, waits, monthlyTokens, scheduled } from the estate.
 */
export function adjustWeek(policy, week, s6) {
  const out = []; const a = policy.adjust || {};
  const r = a.s6Raise, b = a.backgroundCut;
  if (r && week.peakWeekly < r.weekEndedUnder && ((s6.oldestWaitDays || 0) > r.mapWaitedDaysOver || (s6.waits || 0) > 0)) {
    const month = nextMonth(week.reset);
    const current = s6.scheduledFor ? s6.scheduledFor(month) : s6.monthlyTokens;
    const to = Math.min(current + r.raiseTokens, r.maxMonthlyTokens);
    const why = `week to ${week.reset.slice(0, 10)} peaked at ${week.peakWeekly}% weekly (under ${r.weekEndedUnder}%) and ${s6.waits > 0 ? `the S6 budget said WAIT ${s6.waits} time(s) this month` : `a map waited ${s6.oldestWaitDays} days for its S6 (over ${r.mapWaitedDaysOver})`}`;
    if (to > current) out.push({ kind: 's6-raise', month, from: current, to, why });
    else out.push({ kind: 'held', what: `S6 budget stays at ${current} for ${month}: at its hard ceiling of ${r.maxMonthlyTokens}`, why });
  }
  if (b && week.peakWeekly >= b.weekReached) {
    const cur = policy.classes.background.weeklyUnder;
    const to = Math.max(cur - b.cutPoints, b.floorWeeklyUnder);
    const why = `week to ${week.reset.slice(0, 10)} reached ${week.peakWeekly}% weekly (${b.weekReached}% or more)`;
    if (to < cur) out.push({ kind: 'background-cut', from: cur, to, why });
    else out.push({ kind: 'held', what: `background weekly ceiling stays at ${cur}%: at its floor of ${b.floorWeeklyUnder}%`, why });
  }
  return out;
}

/** redteam-budget.json's monthly figure for a month, honouring its `schedule` of raises. */
export function budgetFor(budget, month) {
  const steps = (budget.schedule || []).filter((s) => s.from <= month).sort((x, y) => x.from.localeCompare(y.from));
  return steps.length ? steps[steps.length - 1].monthlyTokens : budget.monthlyTokens;
}

// ---- the command line ----------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [verb, ...rest] = process.argv.slice(2);
  const KNOWN = { gate: ['--task', '--class', '--status', '--five-hour', '--weekly', '--weekly-resets', '--run'], after: ['--task', '--run', '--status', '--five-hour', '--weekly', '--weekly-resets'], report: ['--json'], adjust: ['--buses', '--apply'] };
  const COMMON = ['--policy', '--log', '--now'];
  const BOOL = ['--json', '--apply'];
  const die = (why) => { console.error(`allowance.mjs: ${why}`); process.exit(2); };
  if (!KNOWN[verb]) die(`the first argument must be one of ${Object.keys(KNOWN).join(', ')}; got ${JSON.stringify(verb)}`);
  const o = {};
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i];
    if (![...KNOWN[verb], ...COMMON].includes(f)) die(`${verb} does not take ${f}; it takes ${[...KNOWN[verb], ...COMMON].join(' ')}`);
    if (BOOL.includes(f)) o[f] = true; else { if (rest[i + 1] === undefined) die(`${f} needs a value`); o[f] = rest[++i]; }
  }
  const policyFile = o['--policy'] || path.join(os.homedir(), '.claude', 'allowance.json');
  const logFile = o['--log'] || path.join(os.homedir(), '.claude', 'allowance-log.jsonl');
  const now = o['--now'] || new Date().toISOString();
  let text; try { text = fs.readFileSync(policyFile, 'utf8'); } catch { die(`no policy file at ${policyFile}: SKIP`); }
  const pol = readPolicy(text);
  if (!pol.ok) die(`${policyFile} cannot be read: ${pol.why}. SKIP`);
  const policy = pol.policy;
  const num = (f) => (o[f] === undefined ? NaN : Number(o[f]));
  const append = (entry) => fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');

  if (verb === 'gate' || verb === 'after') {
    for (const f of verb === 'gate' ? ['--task', '--class', '--status'] : ['--task', '--run', '--status']) if (!o[f]) die(`${verb} needs ${f}`);
    const fig = { status: o['--status'], fiveHour: num('--five-hour'), weekly: num('--weekly'), weeklyResetsAt: o['--weekly-resets'] || null };
    if (verb === 'after') {
      append({ at: now, event: 'after', task: o['--task'], run: o['--run'], ...fig });
      console.log(`RECORDED after ${o['--task']} ${o['--run']}: 5-hour ${fig.fiveHour}%, weekly ${fig.weekly}%`);
      process.exit(0);
    }
    const classes = o['--class'].split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = classes.filter((c) => !CLASSES.includes(c));
    if (unknown.length) die(`unknown class ${unknown.join(', ')}; the classes are ${CLASSES.join(', ')}`);
    const d = decide(policy, { classes, ...fig, now });
    append({ at: now, event: 'gate', task: o['--task'], run: o['--run'] || null, classes, admits: d.admits, decision: d.proceed ? 'PROCEED' : 'SKIP', mode: d.mode, ...fig });
    if (d.proceed) { console.log(`ADMITS ${d.admits.join(' ')}`); console.log(`PROCEED: ${d.why}`); process.exit(0); }
    console.log(`SKIP: allowance — ${d.why}`);
    process.exit(3);
  }

  let logText = ''; try { logText = fs.readFileSync(logFile, 'utf8'); } catch { /* no runs yet */ }
  const { entries, unreadable } = readLog(logText);
  if (unreadable) console.error(`allowance.mjs: ${unreadable} log line(s) in ${logFile} did not parse and were skipped`);

  if (verb === 'report') {
    const w = weekReport(entries, { now, policy });
    if (o['--json']) { console.log(JSON.stringify(w, null, 2)); process.exit(0); }
    if (!w) { console.log('No finished week in the allowance log yet.'); process.exit(0); }
    console.log(`Week ${w.from.slice(0, 10)} to ${w.reset.slice(0, 10)} (reset ${w.reset}): peak weekly usage ${w.peakWeekly}% over ${w.readings} reading(s).`);
    for (const c of CLASSES) console.log(`  ${c.padEnd(13)} asked ${w.perClass[c].asked}, ran ${w.perClass[c].ran}, skipped for allowance ${w.perClass[c].skipped}`);
    console.log(w.changes.length ? w.changes.map((c) => `  change ${c.on}: ${c.what} — ${c.why}`).join('\n') : '  no policy change dated in that week');
    process.exit(0);
  }

  // adjust
  if (!o['--buses']) die('adjust needs --buses "<the buses-data root>"');
  const done = new Set(policy.adjustedWeeks || []);
  const w = weekReport(entries, { now, policy });
  if (!w) { console.log('ADJUST: nothing to do — no finished week in the allowance log yet.'); process.exit(0); }
  if (done.has(w.reset)) { console.log(`ADJUST: nothing to do — the week to ${w.reset} was adjusted already.`); process.exit(0); }
  const budgetFile = path.join(o['--buses'], 'redteam-budget.json');
  let budget; try { budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8')); } catch (e) { die(`cannot read ${budgetFile}: ${e.message}`); }
  // The S6 side: the month's WAITs from redteam_budget.js, the oldest wait from the worklist's S6 queue.
  const SK = path.join(HERE, '..', '..', 'make-bus-leaflet', 'assets');
  let waits = 0, oldestWaitDays = 0;
  try { waits = JSON.parse(execFileSync(process.execPath, [path.join(SK, 'redteam_budget.js'), '--estate', o['--buses'], '--json'], { encoding: 'utf8' })).waits || 0; } catch (e) { die(`redteam_budget.js could not be read: ${e.message}`); }
  try {
    const wl = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'worklist.mjs'), '--json'], { encoding: 'utf8', cwd: HERE, maxBuffer: 64 << 20 }));
    for (const it of wl.items || []) for (const m of (it.unattended && it.unattended.waiting) || []) {
      if (m.waitingSince === '') continue; // never verified: no date to count from
      const days = Math.floor((Date.parse(now) - Date.parse(m.waitingSince)) / DAY);
      if (Number.isFinite(days)) oldestWaitDays = Math.max(oldestWaitDays, days);
    }
  } catch (e) { die(`worklist.mjs could not be read: ${e.message}`); }
  const edits = adjustWeek(policy, w, { waits, oldestWaitDays, monthlyTokens: budget.monthlyTokens, scheduledFor: (m) => budgetFor(budget, m) });
  const on = now.slice(0, 10);
  const lines = edits.length ? edits : [{ kind: 'none', what: 'no rule fired' }];
  for (const e of lines) {
    if (e.kind === 's6-raise') console.log(`S6 budget from ${e.month}: ${e.from} -> ${e.to} tokens — ${e.why}`);
    else if (e.kind === 'background-cut') console.log(`background weekly ceiling: ${e.from}% -> ${e.to}% — ${e.why}`);
    else console.log(`${e.what}${e.why ? ' — ' + e.why : ''}`);
  }
  console.log(`(week to ${w.reset}: peak ${w.peakWeekly}%, S6 waits this month ${waits}, oldest S6 wait ${oldestWaitDays} days)`);
  if (!o['--apply']) { console.log('ADJUST: dry run — nothing written; --apply writes it.'); process.exit(0); }
  policy.changes = policy.changes || [];
  for (const e of edits) {
    if (e.kind === 's6-raise') {
      budget.schedule = (budget.schedule || []).filter((s) => s.from !== e.month).concat([{ from: e.month, monthlyTokens: e.to, setOn: on, setBy: 'allowance.mjs adjust', why: e.why }]);
      policy.changes.push({ on, what: `S6 budget from ${e.month}: ${e.from} -> ${e.to} tokens`, why: e.why, by: 'allowance.mjs adjust' });
    } else if (e.kind === 'background-cut') {
      policy.classes.background.weeklyUnder = e.to;
      policy.changes.push({ on, what: `background weekly ceiling ${e.from}% -> ${e.to}%`, why: e.why, by: 'allowance.mjs adjust' });
    } else policy.changes.push({ on, what: e.what, why: e.why, by: 'allowance.mjs adjust' });
  }
  policy.adjustedWeeks = [...done, w.reset];
  fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2) + '\n');
  if (edits.some((e) => e.kind === 's6-raise')) fs.writeFileSync(budgetFile, JSON.stringify(budget, null, 2) + '\n');
  console.log(`ADJUST: applied — ${policyFile}${edits.some((e) => e.kind === 's6-raise') ? ` and ${budgetFile} (commit it)` : ''} written.`);
  process.exit(0);
}
