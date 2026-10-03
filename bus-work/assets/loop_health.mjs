#!/usr/bin/env node
/*
 * loop_health.mjs — what is holding the scheduled loop, and what will hold it
 * within a week (buses-data OA-554, Peter, 2026-10-03).
 *
 * THE LOOP'S FACTS ARE READ BY SIX MODULES AND ANSWERED BY NONE. `loop_runs.mjs`
 * says the loop has fired and done nothing, `loop_lock.mjs` says who holds the
 * lease, `loop_your_move.mjs` says what is waiting on a person, `assemble.mjs
 * --waiting` says which rows a date holds back, `preflight.mjs` says when a push
 * may go. The worklist raises a `loop-idle` row from some of them. What nobody
 * answered, on a morning when eleven consecutive ticks had written `-none`, was
 * the question a person actually has: IS THE LOOP BLOCKED, BY WHAT, AND WHAT IS
 * ABOUT TO BLOCK IT. This composes the readers that exist and adds the three
 * things none of them has — the SUPPLY of rows a tick could take, a LOOK-AHEAD
 * over the dates already written into the action files and `commitments.json`,
 * and the commits on local `main` that are waiting for a push.
 *
 * THREE LEVELS, AND THE DIFFERENCE IS WHETHER A TICK CAN WORK TODAY.
 *   BLOCKING  the next tick cannot do work until somebody acts: `loop/STOP`, a
 *             tracked file modified and not named by a live hold, a lock held by
 *             a session that is not a tick and whose lease has run out (a tick
 *             never steals from a person's name, so it stalls until removed).
 *   AT RISK   ticks can run, and something will stop them or is already failing
 *             them: the supply of free rows is low, a push has waited too long,
 *             the loop is idling while free rows exist, a lock stamp is suspect.
 *   NOTE      true and worth knowing, needs nothing: a live lock, holds waiting
 *             on Peter, claims that expire at midnight, dates coming back.
 *
 * "FREE" IS NOT "FINISHABLE", AND THE COUNT SAYS SO. A row is free when it is not
 * Parked, not `decision: peter`, not held by a `waiting:` date and not claimed
 * today. The P1 re-weigh found none of fourteen free P1 rows finishable by one
 * tick, because an engine change owes a re-vendor and rebuild rows. So a free
 * count of 37 with an idle loop is reported as a question to read the last tick's
 * stated reason, never as "the loop is wrong to idle".
 *
 * IT IS READ-ONLY AND OPENS NO SOCKET. It claims, writes and commits nothing, so
 * a tick may run it every hour at no cost and a person may run it at any time.
 * The only prose it reads is the newest run file's headline, quoted for display
 * and never parsed for meaning — the same line `loop_runs.mjs` holds, for the same
 * reason: run files are written by a fresh session each hour and a reader that
 * depended on their wording would break the first time one phrased it differently.
 *
 * Usage:
 *   node loop_health.mjs [--buses DIR] [--days 7] [--low 3] [--json]
 * Exit: 0 = nothing blocking, 1 = at least one BLOCKING finding, 2 = the buses
 * directory could not be read at all (never a pass).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuses } from './engine.mjs';
import { readRuns, loopHealth } from './loop_runs.mjs';
import { readLoopLock } from './loop_lock.mjs';
import { readYourMoveDir, classify, parseHold, heldPaths } from './loop_your_move.mjs';

const DAY = 86400000;

/** Local YYYY-MM-DD — the action files' dates are local, and a claim expires at local midnight. */
export function localDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days from local date `a` to local date `b` (both YYYY-MM-DD). */
function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / DAY);
}

/** Front matter of an action file: `{ key: value }`, one line each, no nesting. */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (k) out[k[1]] = k[2].trim();
  }
  return out;
}

/** One action file -> the facts this module needs. A file with no `ref` is skipped by the caller. */
export function parseAction(text) {
  const fm = frontMatter(text);
  const iso = (v) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(v || ''); return m ? m[1] : null; };
  return {
    ref: fm.ref || null,
    priority: fm.priority || null,
    decisionPeter: /^peter$/i.test(fm.decision || ''),
    waitingDate: iso(fm.waiting), waitingWhy: fm.waiting ? fm.waiting.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') : null,
    selectedDate: iso(fm.selected),
  };
}

/**
 * Sort every action into exactly one bucket, in the order that decides whose move
 * it is. Parked is never taken; `decision: peter` is never a tick's; a waiting
 * date holds a row until the date, and ON the date it is free (assemble.mjs
 * `--waiting`: "on the date, or after, it is EXPIRED"); a claim dated today is
 * live, and one dated earlier is EXPIRED and so free.
 */
export function bucketActions(actions, today) {
  const b = { parked: [], peter: [], held: [], claimed: [], free: [] };
  for (const a of actions) {
    if (/^parked$/i.test(a.priority || '')) b.parked.push(a);
    else if (a.decisionPeter) b.peter.push(a);
    else if (a.waitingDate && daysBetween(today, a.waitingDate) > 0) b.held.push(a);
    else if (a.selectedDate === today) b.claimed.push(a);
    else b.free.push(a);
  }
  return b;
}

/**
 * Pure: every finding and the look-ahead, from facts the caller gathered.
 *
 * @param {object} f
 * @param {number} f.now
 * @param {Array}  f.runs            readRuns() of loop/runs
 * @param {string|null} f.lastRun    {name, headline} of the newest run file, or null
 * @param {boolean} f.stopFile
 * @param {object} f.lock            readLoopLock()
 * @param {Array<string>|null} f.dirty  tracked modified paths, null if unreadable
 * @param {Array<{path:string, ref:string}>} f.holdPaths  paths a live hold accounts for
 * @param {Array<{ref:string, ageDays:number}>} f.holds
 * @param {number} f.drafts
 * @param {{count:number, oldestMs:number|null}|null} f.ahead  commits on main not on origin/main
 * @param {Array} f.actions          parseAction() results
 * @param {Array<{id:string, what:string, by:string}>} f.commitments
 * @param {number} [f.days=7] [f.low=3] [f.pushStaleHours=5]
 */
export function analyse(f) {
  const days = f.days ?? 7;
  const low = f.low ?? 3;
  const pushStaleMs = (f.pushStaleHours ?? 5) * 3600000;
  const today = localDate(f.now);
  const findings = [];
  const add = (level, key, text, move) => findings.push({ level, key, text, move: move || null });

  const health = loopHealth({ runs: f.runs, now: f.now });
  const buckets = bucketActions(f.actions || [], today);

  if (f.stopFile) {
    add('BLOCKING', 'stop', '`loop/STOP` exists, so every tick ends at step 1 and does nothing. A forgotten STOP looks exactly like a loop with nothing to do.', 'Delete `loop/STOP` if you want the loop back.');
  }

  const lock = f.lock || {};
  if (lock.present) {
    if (lock.stampSuspect) {
      add('AT RISK', 'lock-stamp', `The lock's own stamp is not believable: ${lock.stampWhy}. Its lease is being read from the directory time instead.`, 'Read `loop/LOCK.d/holder`; if its session is finished, remove the folder `loop/LOCK.d`.');
    }
    if (lock.isTick) {
      if (lock.expired) add('NOTE', 'lock-tick-expired', `A tick (\`${lock.name}\`) holds the lock and its lease ran out ${lock.overdueMin} min ago. The next tick steals it, so this clears itself.`);
      else add('NOTE', 'lock-tick', `A tick (\`${lock.name}\`) is running: ${lock.remainMin} min of its lease left. Ticks that fire meanwhile stand down.`);
    } else if (lock.expired) {
      add('BLOCKING', 'lock-person-expired', `\`loop/LOCK.d\` is held by \`${lock.name || 'an unreadable holder'}\`, which is not a tick, and its lease ran out ${lock.overdueMin} min ago. A tick never steals from a person's name, so the loop stalls until it is removed.`, 'If that session is finished, delete the folder `loop/LOCK.d`.');
    } else {
      add('NOTE', 'lock-person', `\`loop/LOCK.d\` is held by \`${lock.name || 'an unreadable holder'}\` (a session, not a tick), ${lock.remainMin} min of lease left. The loop defers to it and resumes when it finishes.`);
    }
  }

  if (f.dirty === null) {
    add('AT RISK', 'tree-unreadable', 'The shared working tree could not be read with git, so whether it is dirty is unknown.');
  } else {
    const accounted = new Set((f.holdPaths || []).map((h) => h.path.replace(/\\/g, '/')));
    const stray = f.dirty.filter((p) => !accounted.has(p.replace(/\\/g, '/')));
    if (stray.length) {
      const shown = stray.slice(0, 4).map((p) => `\`${p}\``).join(', ') + (stray.length > 4 ? ` and ${stray.length - 4} more` : '');
      add('BLOCKING', 'tree-dirty', `${stray.length} tracked file${stray.length === 1 ? ' is' : 's are'} modified and not named by a live hold: ${shown}. An unattended tick reads that as stop, so one stray file halts every tick.`, 'Commit or revert what `git status` names in the buses-data checkout, or ask whoever owns it.');
    }
  }

  if (f.ahead && f.ahead.count > 0) {
    const ageMs = f.ahead.oldestMs ? f.now - f.ahead.oldestMs : null;
    const ageTxt = ageMs == null ? 'an unknown time' : ageMs < 5400000 ? `${Math.round(ageMs / 60000)} min` : `${(ageMs / 3600000).toFixed(1)} h`;
    if (ageMs != null && ageMs > pushStaleMs) {
      add('AT RISK', 'push-stale', `${f.ahead.count} commit${f.ahead.count === 1 ? '' : 's'} on local \`main\` have waited ${ageTxt} for a push (the budget-paced interval is at most about 4 h). Either the preflight is failing or no tick has pushed.`, 'Run the push preflight from the buses-data root; its exit code says whether it is held (3), red (1) or cannot tell (2).');
    } else {
      add('NOTE', 'push-waiting', `${f.ahead.count} commit${f.ahead.count === 1 ? '' : 's'} on local \`main\` waiting for a push, the oldest ${ageTxt}. Normal inside the paced interval.`);
    }
  } else if (f.ahead === null) {
    add('NOTE', 'push-unknown', 'Whether local `main` is ahead of `origin/main` could not be read.');
  }

  if (f.holds && f.holds.length) {
    const oldest = Math.max(...f.holds.map((h) => h.ageDays || 0));
    add(oldest >= 7 ? 'AT RISK' : 'NOTE', 'holds', `${f.holds.length} hold${f.holds.length === 1 ? '' : 's'} in \`loop/your-move/\` wait on Peter (${f.holds.map((h) => h.ref).join(', ')}), the oldest ${oldest} day${oldest === 1 ? '' : 's'}${f.drafts ? `; plus ${f.drafts} draft${f.drafts === 1 ? '' : 's'} to triage` : ''}. Only a person moves them.`, oldest >= 7 ? 'Triage the oldest hold: answer it, retire it, or change the question.' : null);
  }

  const free = buckets.free.length;
  const urgent = buckets.free.filter((a) => /^P[01]$/i.test(a.priority || ''));
  if (health.ran && health.idle >= 2) {
    const blocked = findings.some((x) => x.level === 'BLOCKING');
    const why = f.lastRun ? ` Last tick (${f.lastRun.name.replace(/\.md$/, '')}) said: "${f.lastRun.headline}"` : '';
    if (blocked) add('NOTE', 'idle-explained', `${health.idle} consecutive ticks reached no work, which the BLOCKING finding${findings.filter((x) => x.level === 'BLOCKING').length === 1 ? '' : 's'} above explain.${why}`);
    else if (free === 0) add('NOTE', 'idle-supply', `${health.idle} consecutive ticks reached no work, and no row is free to take: everything is Parked, Peter's, held by a date or claimed today. The loop is idle for want of work, not blocked.${why}`);
    else if (urgent.length) add('AT RISK', 'idle-with-free', `${health.idle} consecutive ticks reached no work although ${urgent.length} free row${urgent.length === 1 ? ' is' : 's are'} P0 or P1 (${urgent.slice(0, 4).map((a) => a.ref).join(', ')}). Free is not finishable (an engine change owes a re-vendor and rebuild rows), but an urgent row no tick opens is worth reading.${why}`, 'Read the newest file in `loop/runs/` and the P1 re-weigh, and ask whether those rows are really beyond one tick or the feed is being skipped.');
    else add('NOTE', 'idle-free-lower', `${health.idle} consecutive ticks reached no work. ${free} row${free === 1 ? ' is' : 's are'} free to take, none P0 or P1, so this is the loop declining lower-priority work it judged unfinishable, not a fault.${why}`);
  }
  if (health.ran && health.missed > 0) {
    add('AT RISK', 'missed', `${health.missed} of the recent idle runs were fired by the scheduler and never reached a prompt (written up as \`-missed\`). No tree state explains that.`, "Open the scheduled task bus-loop in the desktop app and read its recent runs' messages.");
  }
  if (health.ran && health.ageMin != null && health.ageMin >= 3 * health.cadence) {
    add('NOTE', 'quiet', `No tick for ${health.ageMin < 180 ? health.ageMin + ' min' : (health.ageMin / 60).toFixed(1) + ' h'} (cadence ${health.cadence} min). Normal while the desktop app was shut; if it was open, the schedule may be off.`);
  }
  if (!health.ran) add('NOTE', 'no-runs', 'No run files found in `loop/runs/`, which is normal in a fresh clone or a worktree and means nothing here.');

  // ---- the look-ahead: dates already written down, over the next `days` days ----
  const coming = [];
  for (const a of buckets.held) {
    const d = daysBetween(today, a.waitingDate);
    if (d <= days) coming.push({ date: a.waitingDate, inDays: d, ref: a.ref, what: a.waitingWhy });
  }
  coming.sort((x, y) => x.date.localeCompare(y.date) || x.ref.localeCompare(y.ref));
  const byDate = new Map();
  for (const c of coming) byDate.set(c.date, [...(byDate.get(c.date) || []), c]);
  let running = free;
  const supplyPath = [{ date: today, free }];
  for (const [date, rows] of byDate) { running += rows.length; supplyPath.push({ date, free: running, adds: rows.map((r) => r.ref) }); }

  const claimsToday = buckets.claimed.length;
  if (claimsToday) add('NOTE', 'claims-midnight', `${claimsToday} claim${claimsToday === 1 ? '' : 's'} made today ${claimsToday === 1 ? 'expires' : 'expire'} at local midnight and the row${claimsToday === 1 ? ' becomes' : 's become'} free again.`);

  if (free < low) {
    const when = supplyPath.find((s) => s.free >= low);
    add('AT RISK', 'supply-low', `Only ${free} row${free === 1 ? ' is' : 's are'} free to take (warning below ${low}).${when && when.date !== today ? ` Held rows bring it back to ${when.free} on ${when.date}.` : ` Nothing held comes back within ${days} days, so the loop will sit idle unless a row is filed or a decision released.`}`, 'Release a `decision: peter` row, file work, or accept that the loop idles.');
  }

  const dated = [];
  for (const c of f.commitments || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.by || '')) continue;
    const d = daysBetween(today, c.by);
    if (d <= days) dated.push({ id: c.id, what: c.what, by: c.by, inDays: d });
  }
  dated.sort((a, b) => a.by.localeCompare(b.by));

  const level = findings.some((x) => x.level === 'BLOCKING') ? 'BLOCKED' : findings.some((x) => x.level === 'AT RISK') ? 'AT RISK' : 'CLEAR';
  return {
    verdict: level, today, health, findings,
    supply: { free, held: buckets.held.length, claimedToday: claimsToday, peter: buckets.peter.length, parked: buckets.parked.length, total: (f.actions || []).length },
    lookahead: { days, coming, supplyPath, dated },
  };
}

const ORDER = { BLOCKING: 0, 'AT RISK': 1, NOTE: 2 };

export function render(r, now) {
  const L = [];
  const stamp = new Date(now).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  L.push(`Loop health, ${stamp}`);
  L.push(`VERDICT: ${r.verdict}`);
  L.push('');
  const h = r.health;
  L.push(h.ran
    ? `Ticks: last ${new Date(h.lastAt).toTimeString().slice(0, 5)} (${h.ageMin < 180 ? h.ageMin + ' min' : (h.ageMin / 60).toFixed(1) + ' h'} ago), cadence ${h.cadence} min, ${h.idle} consecutive without reaching work${h.lastWorkingAt ? `, last worked ${new Date(h.lastWorkingAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.`
    : 'Ticks: no run files here.');
  const s = r.supply;
  L.push(`Supply: ${s.total} actions: ${s.free} free to take, ${s.held} held by a date, ${s.claimedToday} claimed today, ${s.peter} Peter's decision, ${s.parked} Parked. Free is not finishable.`);
  L.push('');
  const sorted = r.findings.slice().sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  if (!sorted.length) L.push('Nothing to report.');
  for (const x of sorted) {
    L.push(`${x.level.padEnd(8)} ${x.text}`);
    if (x.move) L.push(`         Move: ${x.move}`);
  }
  L.push('');
  const la = r.lookahead;
  L.push(`Next ${la.days} days:`);
  if (la.coming.length) {
    for (const p of la.supplyPath.slice(1)) L.push(`  ${p.date}: ${p.adds.join(', ')} come${p.adds.length === 1 ? 's' : ''} back (free rows ${p.free})`);
  } else L.push('  no held row comes back.');
  for (const c of la.dated) L.push(`  commitment ${c.id}: ${c.what.length > 100 ? c.what.slice(0, 97) + '...' : c.what} (${c.by}${c.inDays < 0 ? `, ${-c.inDays} d overdue` : c.inDays === 0 ? ', today' : `, in ${c.inDays} d`})`);
  return L.join('\n');
}

// ---- gathering: the only part that touches the disk or git ----

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').replace(/\s+$/, '') };
}

/** Newest run file's first bold line, for display only. */
export function newestRun(runsDir) {
  try {
    const files = readdirSync(runsDir).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{4}-.+\.md$/.test(n)).sort();
    const name = files[files.length - 1];
    if (!name) return null;
    const text = readFileSync(path.join(runsDir, name), 'utf8');
    const line = text.split(/\r?\n/).find((l) => /^\*\*.+\*\*/.test(l.trim())) || text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
    return { name, headline: line.replace(/\*\*/g, '').trim().slice(0, 300) };
  } catch { return null; }
}

export function gather(busesDir, { now = Date.now() } = {}) {
  const loopDir = path.join(busesDir, 'loop');
  const files = readYourMoveDir(path.join(loopDir, 'your-move'));
  const { holds, drafts } = classify(files);
  const parsedHolds = [];
  for (const h of holds) {
    try { const b = parseHold(h); parsedHolds.push({ ref: b.ref || String(h.name).replace(/\.md$/i, ''), ageDays: Math.floor((now - h.mtimeMs) / DAY) }); } catch { /* one odd hold is not the folder's problem */ }
  }

  const st = git(busesDir, ['status', '--porcelain', '--untracked-files=no']);
  const dirty = st.ok ? st.out.split('\n').filter(Boolean).map((l) => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, '')) : null;

  let ahead = null;
  const cnt = git(busesDir, ['rev-list', '--count', 'origin/main..main']);
  if (cnt.ok) {
    const n = Number(cnt.out);
    const times = n ? git(busesDir, ['log', 'origin/main..main', '--format=%ct']).out.split('\n').map(Number).filter(Boolean) : [];
    ahead = { count: n, oldestMs: times.length ? Math.min(...times) * 1000 : null };
  }

  const actions = [];
  const oaDir = path.join(busesDir, 'Development Docs', 'open-actions');
  try {
    for (const n of readdirSync(oaDir)) {
      if (!/^OA-\d+\.md$/.test(n)) continue;
      const a = parseAction(readFileSync(path.join(oaDir, n), 'utf8'));
      if (a.ref) actions.push(a);
    }
  } catch { /* no action files here: supply reads as zero, which the caller reports */ }

  let commitments = [];
  try { commitments = JSON.parse(readFileSync(path.join(busesDir, 'Development Docs', 'commitments.json'), 'utf8')).commitments || []; } catch { /* absent or unparsable: the worklist raises that row */ }

  return {
    now,
    runs: readRuns(path.join(loopDir, 'runs')),
    lastRun: newestRun(path.join(loopDir, 'runs')),
    stopFile: existsSync(path.join(loopDir, 'STOP')),
    lock: readLoopLock(busesDir, { now }),
    dirty, holdPaths: heldPaths(files), holds: parsedHolds, drafts: drafts.length,
    ahead, actions, commitments,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const buses = resolveBuses({ buses: val('--buses') });
  if (!existsSync(path.join(buses, 'Development Docs', 'open-actions'))) {
    process.stderr.write(`loop_health: ${buses} is not a buses-data checkout (no Development Docs/open-actions). Pass --buses DIR.\n`);
    process.exitCode = 2;
    return;
  }
  const now = Date.now();
  const facts = gather(buses, { now });
  const days = Number(val('--days')); const low = Number(val('--low'));
  const r = analyse({ ...facts, ...(Number.isFinite(days) && days > 0 ? { days } : {}), ...(Number.isFinite(low) && low >= 0 && val('--low') !== undefined ? { low } : {}) });
  process.stdout.write((argv.includes('--json') ? JSON.stringify(r, null, 2) : render(r, now)) + '\n');
  // `process.exitCode`, not `process.exit()`: a pipe write is asynchronous on Windows.
  process.exitCode = r.findings.some((x) => x.level === 'BLOCKING') ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
