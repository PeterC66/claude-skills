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
 *             them: a push has waited too long, ticks keep stopping before
 *             dispatch with nothing visible to explain it, a lock stamp is suspect.
 *   NOTE      true and worth knowing, needs nothing: a live lock, holds waiting
 *             on Peter, dates coming back.
 *
 * "FREE" IS NOT "FINISHABLE", AND THE COUNT SAYS SO. A row is free when it is not
 * Parked, not `decision: peter` and not held by a `waiting:` date. The P1 re-weigh
 * found none of fourteen free P1 rows finishable by one tick, because an engine
 * change owes a re-vendor and rebuild rows. So a free count of 37 with an idle loop
 * is reported as a question to read the last tick's stated reason, never as "the
 * loop is wrong to idle".
 *
 * CAN A TICK DO WORK, BY ITS OWN PROMPT? (buses-data OA-560, Peter, 2026-10-03.)
 * Blocked or not is half the question: a loop can be clear of every blocker and
 * still have nothing the prompt lets a tick take. So the report adds a section that
 * asks the prompt's own questions of the facts on disk: can the tick execute the
 * prompt at all (the stored task against the README block; every file the block
 * names exists), does each resource a unit needs read safe (the conditions check,
 * a tick's own live lock being a run in progress and not a bar), and what is there
 * to take — bus-work rows (--deep)
 * judged by step 4D's rules (an `unattended` recipe; no unreviewed ESCALATE grade; not under
 * `_portal-fixture/`). The result is one word (CAN WORK, NOTHING TO DO, BARRED) and
 * a list of the things a person can do, most rows released first.
 *
 * THE BACKLOG IS NOT A FEED (buses-data OA-576, Peter, 2026-10-07). The loop does
 * map upkeep only: ad-hoc files Peter promotes and the bus-work rows with an
 * unattended recipe. So NOTHING TO DO is the normal day and a NOTE, never a fault,
 * and the open-actions backlog is reported as information (its counts, the dates
 * coming back) and no longer as the loop's supply. A tick that dispatched and found
 * nothing names itself `-idle`, which `loop_runs.mjs` does not count as idle; the
 * idle finding here is therefore about ticks that STOPPED before dispatch.
 *
 * THE AD-HOC QUEUE IS NOT A FEED EITHER (buses-data OA-610, Peter, 2026-10-08).
 * It moved to its own scheduled loop, `adhoc-loop`, with its own folder
 * (`adhoc/ready/`, `adhoc/runs/`) and its own run files. A bus tick no longer
 * takes an ad-hoc file, so counting `ready/` here would report CAN WORK for work
 * no tick may do. The ad-hoc readers, the ad-hoc capacity line and the "the ad-hoc
 * feed is empty" lever are gone; the only feed left is bus-work. Without `--deep`
 * that feed is not measured, so the verdict is then BARRED or not measured, never
 * a guess. Whether the ad-hoc loop is passing a file over is the worklist's
 * `adhoc-not-taken/<file>` row (`loop_ready.mjs`), not this report.
 *
 * CAN THE TICKS CLEAR THE REFRESHES IN TIME? (buses-data, 2026-10-08.) Three ticks a
 * day (OA-577) is plenty in a quiet month and not in a month whose scan lands many
 * finishable refreshes with changes days away, and nothing projected the one against
 * the other. With `--deep`, each finishable refresh row's earliest effective date
 * (the worklist's `effectiveDate`, from the scan) and the units it still owes (a
 * rebuild and a staging, less what the scan's ink review shows done) are run
 * earliest-deadline-first against the cadence read from `loop/README.md`. A shortfall
 * is AT RISK with the lever `/ticks N`, N being the extra ticks that put every row in
 * time; the arithmetic and its reasons are in `refresh_deadline.mjs`.
 *
 * IT IS READ-ONLY. It writes and commits nothing, so a tick may run it every
 * hour at no cost and a person may run it at any time. By default it opens no
 * socket: the two probes it spawns (`worklist.mjs --conditions`, which reads the
 * local trees, and the stored-prompt checker) are local. `--deep` also runs
 * `worklist.mjs --json`, which reads the live portal and takes about a minute.
 * The prose it reads is the newest run file's headline, quoted for display only,
 * and the `OA-nnn (passed over: ...)` lines the loop prompt makes every tick write in
 * exactly that form.
 * Anything else a run file says is never parsed for meaning: run files are written
 * by a fresh session each hour and a reader that depended on their wording would
 * break the first time one phrased it differently.
 *
 * Usage:
 *   node loop_health.mjs [--buses DIR] [--days 7] [--json] [--deep] [--no-probes]
 * Exit: 0 = nothing blocking, 1 = at least one BLOCKING finding, 2 = the buses
 * directory could not be read at all (never a pass). `--no-probes` skips the
 * spawned commands (the prompt prerequisites and resources then read "not
 * measured"), for the harness and for a machine with no sibling checkouts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveBuses, assetsDir } from './engine.mjs';
import { readRuns, loopHealth, readSchedule, scheduleText } from './loop_runs.mjs';
import { readLoopLock } from './loop_lock.mjs';
import { fenceOf } from './concurrency.mjs';
import { readYourMoveDir, classify, parseHold, heldPaths } from './loop_your_move.mjs';
import { ticksPerDay, unitsOwed, deadlineShortfall } from './refresh_deadline.mjs';

const DAY = 86400000;

/** The bus-loop's cadence since OA-577 (04:00, 13:00, 19:00), used only when `loop/README.md` cannot be read for it. */
export const DEFAULT_TICKS_PER_DAY = 3;

/** Local YYYY-MM-DD — the action files' dates are local. */
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
    headline: fm.headline ? fm.headline.replace(/^"|"$/g, '') : null,
  };
}

/**
 * Sort every action into exactly one bucket, in the order that decides whose move
 * it is. Parked is never taken; `decision: peter` is never a tick's; a waiting
 * date holds a row until the date, and ON the date it is free (assemble.mjs
 * `--waiting`: "on the date, or after, it is EXPIRED"). Claims were retired by
 * buses-data OA-578, so no `selected:` line holds a row.
 */
export function bucketActions(actions, today) {
  const b = { parked: [], peter: [], held: [], free: [] };
  for (const a of actions) {
    if (/^parked$/i.test(a.priority || '')) b.parked.push(a);
    else if (a.decisionPeter) b.peter.push(a);
    else if (a.waitingDate && daysBetween(today, a.waitingDate) > 0) b.held.push(a);
    else b.free.push(a);
  }
  return b;
}

// ---- can a tick DO work? what the prompt lets it take, against what is there to take ----

/**
 * The prompt's own rules for the bus-work feed (step 4D), applied to the rows the
 * worklist printed: a `refresh` row is finishable only with an `unattended` block; an
 * `engine-rebuild` row is finishable unless a town in it is graded ESCALATE with no
 * `no-rebuild` review for that grades file's scan date (`bw.reviewed`), or the map
 * sits under `_portal-fixture/`. A grade is computed from the scan and never clears;
 * a person's `no-rebuild` verdict in `refresh-reviews.json` is the only thing that
 * answers it (buses-data OA-563). Judged from the grade, the review and the folder
 * only, so a row listed as finishable may still stop at its own dry run (LOST or REGRESSED).
 */
export function classifyBusWork(bw) {
  const out = { finishable: [], escalate: [], fixture: [], person: [], towns: [], refresh: [] };
  const grades = bw.grades || {};
  const fixtures = new Set(bw.fixtures || []);
  const reviewed = new Set(bw.reviewed || []);
  for (const r of bw.rows || []) {
    if (r.kind === 'refresh') {
      (r.unattended ? out.finishable : out.person).push(r.key);
      // What each finishable refresh still owes a tick, for the deadline check (refresh_deadline.mjs).
      if (r.unattended) out.refresh.push({ key: r.key, effectiveDate: r.effectiveDate || null, units: unitsOwed(bw.review || null, r.map, { local: !!r.local }) });
    }
    else {
      const name = r.key.replace(/^engine-rebuild-/, '');
      const esc = (r.towns || []).filter((t) => grades[t] === 'ESCALATE' && !reviewed.has(t));
      if (fixtures.has(name)) out.fixture.push(r.key);
      else if (esc.length) { out.escalate.push(r.key); for (const t of esc) if (!out.towns.includes(t)) out.towns.push(t); }
      else out.finishable.push(r.key);
    }
  }
  return out;
}

const UNIT = {
  'buses-tree': 'every unit that commits in buses-data', 'buses-maps': 'map builds, S6, rollouts and letters',
  engine: 'engine changes', 'portal-write': 'anything that writes to the portal', 'portal-deploy': 'a portal deploy', 'estate-sweep': 'an estate-wide sweep',
};

/**
 * Whether a tick CAN work, by the loop prompt's own rules, and what a person can do
 * about it. Every part reads a fact the caller may leave out (a `null` is "not
 * measured here", never a pass): the prompt prerequisites, the resource verdicts, the
 * bus-work feed, and a ranked list of levers. Pushes findings through
 * `ctx.add` so the verdict sees them.
 */
export function assessCapacity(f, ctx) {
  const { add, findings, today } = ctx;
  const cap = { work: null, prereq: null, resources: null, busWork: null, deadline: null, levers: [] };
  const lever = (rows, refs, text, move, nothing = false) => cap.levers.push({ rows, refs, text, move, nothing });

  // 1. can the tick execute its own prompt at all
  if (f.prereq) {
    const p = f.prereq;
    const missing = (p.scripts || []).filter((s) => !s.exists).map((s) => s.path);
    cap.prereq = { drift: p.drift ?? null, scripts: (p.scripts || []).length, missing };
    if (p.unreadable) add('AT RISK', 'prompt-unreadable', 'The prompt block could not be found in `loop/README.md` (no plain fenced block under "## The task prompt"), so the files a tick is told to run could not be checked.', 'Open `loop/README.md` and look at the foot of it.');
    if (p.drift === true) add('AT RISK', 'prompt-drift', 'The stored `bus-loop` task differs from the prompt block in `loop/README.md`, so ticks execute text nobody has reviewed.', 'From the buses-data root, `node Documentation/check-task-prompt.mjs` shows the difference and `--apply` deploys the README block.');
    if (missing.length) {
      const critical = missing.some((m) => /(?:worklist|assemble)\.mjs$/.test(m));
      add(critical ? 'BLOCKING' : 'AT RISK', 'script-missing', `The loop prompt tells ticks to run ${missing.length} file${missing.length === 1 ? '' : 's'} that ${missing.length === 1 ? 'is' : 'are'} not on this machine: ${missing.slice(0, 3).map((m) => `\`${m}\``).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.${critical ? ' Step 2 cannot run without it.' : ''}`, 'Restore the file (it is in the claude-skills or portal checkout) or edit the prompt block in `loop/README.md` and deploy it.');
    }
  }

  // 2. the resources a unit needs
  let treeBarred = false;
  if (f.resources) {
    const entries = Object.entries(f.resources);
    const isLock = (r) => r.need === 'loop-lock' || /holds loop\/LOCK\.d/.test(r.why || '');
    const barred = entries.filter(([, v]) => v && v.verdict !== 'safe').map(([name, v]) => {
      const rs = v.reasons || [];
      const real = rs.find((r) => !isLock(r));
      return { name, verdict: v.verdict, bars: UNIT[name] || name, why: String((real || rs[0] || {}).why || '').replace(/^(.{200}).+$/s, '$1...'), lockOnly: rs.length > 0 && !real, unpushed: rs.some((r) => /unpushed/i.test(r.why || '')) };
    });
    cap.resources = { safe: entries.filter(([, v]) => v && v.verdict === 'safe').map(([n]) => n), barred };
    for (const b of barred) {
      if (b.lockOnly) continue;
      if (b.name === 'buses-tree') treeBarred = true;
      if ((b.name === 'buses-tree' || b.name === 'estate-sweep') && findings.some((x) => x.key === 'tree-dirty')) continue;
      const fencedOnly = findings.some((x) => x.key === 'tree-fenced') && !findings.some((x) => x.key === 'tree-dirty');
      if (fencedOnly && (b.name === 'buses-maps' || b.name === 'estate-sweep')) continue;
      add(b.verdict === 'check' && !b.unpushed ? 'AT RISK' : 'NOTE', `resource-${b.name}`, `\`${b.name}\` is ${b.verdict.toUpperCase()}, which bars ${b.bars}: ${b.why}`, b.unpushed ? null : 'Read `node worklist.mjs --conditions` from the bus-work assets folder and clear what it names.');
    }
  }

  // 3. the bus-work feed (only with --deep: the worklist reads the live portal).
  // It is the only feed: the ad-hoc queue has its own loop since OA-610.
  if (f.busWork) cap.busWork = classifyBusWork(f.busWork);

  // 3b. can the ticks clear the finishable refresh rows before their changes take
  // effect? Earliest-deadline-first against the scheduled cadence; the shortfall is
  // the number of extra ticks that, run now, put every row in time (refresh_deadline.mjs).
  if (cap.busWork && cap.busWork.refresh.length && today) {
    const perDay = f.perDay || DEFAULT_TICKS_PER_DAY;
    const d = deadlineShortfall(cap.busWork.refresh, { today, perDay });
    cap.deadline = { ...d, perDay, perDaySource: f.perDay ? 'loop/README.md' : 'assumed' };
    if (d.shortfall > 0) {
      const w = d.worst;
      const pl = (n, one, many) => (n === 1 ? one : many);
      const nl = d.late.length;
      const when = d.daysLeft < 0 ? `${-d.daysLeft} ${pl(-d.daysLeft, 'day', 'days')} ago` : d.daysLeft === 0 ? 'today' : `in ${d.daysLeft} ${pl(d.daysLeft, 'day', 'days')}`;
      const fires = w.have ? `only ${w.have} ${pl(w.have, 'tick fires', 'ticks fire')} before then` : 'no tick fires before then';
      const late = nl ? ` ${nl} of them ${pl(nl, 'takes', 'take')} effect today or already ${pl(nl, 'has', 'have')}, so no scheduled tick reaches ${pl(nl, 'it', 'them')} first.` : '';
      add('AT RISK', 'refresh-deadline', `${d.counted} finishable refresh ${pl(d.counted, 'row owes', 'rows owe')} ${d.units} tick ${pl(d.units, 'unit', 'units')} (a rebuild and a staging each, less what the ink review shows done), and the earliest change takes effect ${d.earliest} (${when}). At ${perDay} ticks a day${cap.deadline.perDaySource === 'assumed' ? ' (assumed: the cadence could not be read from loop/README.md)' : ''}, ${w.need} ${pl(w.need, 'unit is', 'units are')} due before ${w.date} and ${fires}.${late}`, `Run \`/ticks ${d.shortfall}\` now: ${d.shortfall} extra ${pl(d.shortfall, 'tick', 'ticks')}, earliest date first, ${nl ? 'catch up the rows already in effect and put the rest in time' : 'put every row in time'}.`);
      lever(d.counted, cap.busWork.refresh.filter((r) => r.units > 0 && r.effectiveDate).map((r) => r.key), `${d.counted} refresh row${d.counted === 1 ? '' : 's'} cannot clear before ${d.counted === 1 ? 'its' : 'their'} changes take effect at ${perDay} ticks a day: ${d.shortfall} tick${d.shortfall === 1 ? '' : 's'} short.`, `\`/ticks ${d.shortfall}\``);
    }
  }

  // 4. the verdict on work. Nothing to take is the normal day for a loop that does
  // map upkeep only (OA-576), so it is a NOTE; the backlog is not a feed. A bar is
  // a bar whether or not the feed was measured (OA-610: before, the ad-hoc count
  // was always present and carried the verdict on a plain run); with no bar and
  // no --deep, the verdict is "not measured", never a guess.
  const blocking = treeBarred || findings.some((x) => x.level === 'BLOCKING');
  if (blocking) cap.work = 'BARRED';
  else if (cap.busWork) {
    cap.work = cap.busWork.finishable.length ? 'CAN WORK' : 'NOTHING TO DO';
    if (cap.work === 'NOTHING TO DO') {
      add('NOTE', 'no-work', 'Nothing for a tick to take: no bus-work row is finishable unattended. Normal for a loop that does map upkeep only: ticks write `-idle` and stop. Ad-hoc files are not a tick\'s work; the separate ad-hoc loop takes them from `adhoc/ready/` (OA-610).');
    }
  }

  // 5. what a person can do, most rows first
  if (f.ahead && f.ahead.count > 0 && cap.resources && cap.resources.barred.some((b) => b.unpushed)) {
    lever(0, [], `${f.ahead.count} commit${f.ahead.count === 1 ? '' : 's'} on local \`main\` hold \`portal-write\`, which bars every row that writes to the portal.`, 'push_main.mjs pushes once the preflight allows it (exit 3 means deferred, nothing for you to do). To go sooner, push from a session after the preflight exits 0.');
  }
  if (cap.busWork && cap.busWork.escalate.length) {
    const n = cap.busWork.escalate.length;
    lever(n, cap.busWork.escalate, `${n} row${n === 1 ? ' is' : 's are'} stopped by an ESCALATE grade${cap.busWork.towns.length ? ` (${cap.busWork.towns.join(', ')})` : ''}, which only a person reviews.`, 'Read the newest `_gtfs/refresh-grades_<date>.json` for those towns and settle the grade; the rebuild then goes back to the loop.');
  }
  if (cap.busWork && cap.busWork.fixture.length) lever(cap.busWork.fixture.length, cap.busWork.fixture, `${cap.busWork.fixture.length} map${cap.busWork.fixture.length === 1 ? ' sits' : 's sit'} under \`_portal-fixture/\`, which moves only with a pin bump and so never in a tick.`, 'Rebuild it in a session with the pin bump, or accept that it stays behind.');
  if (f.holds && f.holds.length) lever(f.holds.length, f.holds.map((h) => h.ref), `${f.holds.length} hold${f.holds.length === 1 ? '' : 's'} in \`loop/your-move/\` wait on you.`, 'Answer or retire each; `/triage` checks them against real state.');
  cap.levers.sort((a, b) => (a.nothing - b.nothing) || (b.rows - a.rows));
  return cap;
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
 * @param {object|null} [f.prereq]   {drift, scripts:[{path,exists}]}: the stored prompt against loop/README.md, and the files the prompt names
 * @param {object|null} [f.resources] the conditions check's per-resource verdicts
 * @param {{rows:Array, grades:object, fixtures:string[], review?:object|null}|null} [f.busWork] only with --deep; `review` is the scan's ink review
 * @param {number|null} [f.perDay]   ticks a day read from loop/README.md; null falls back to DEFAULT_TICKS_PER_DAY
 * @param {{minute, hours}|null} [f.schedule]  the same cron line's fire times; null measures lateness by the median gap (OA-608)
 * @param {Array<{id:string, what:string, by:string}>} f.commitments
 * @param {number} [f.days=7] [f.pushStaleHours=5]
 */
export function analyse(f) {
  const days = f.days ?? 7;
  const pushStaleMs = (f.pushStaleHours ?? 5) * 3600000;
  const today = localDate(f.now);
  const findings = [];
  const add = (level, key, text, move) => findings.push({ level, key, text, move: move || null });

  const health = loopHealth({ runs: f.runs, now: f.now, schedule: f.schedule || null });
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
    const dirtyAll = f.dirty.filter((p) => !accounted.has(p.replace(/\\/g, '/')));
    // A tick holding a live lock edits the backlog itself (its filing, the index the hook rebuilds): that is its run in progress, not a stray file.
    const tickOwn = !!(lock.present && lock.isTick && !lock.expired);
    const own = tickOwn ? dirtyAll.filter((p) => /^Development Docs\/open-actions(\.md$|\/)/.test(p.replace(/\\/g, '/'))) : [];
    if (own.length) add('NOTE', 'tree-tick-own', `${own.length} backlog file${own.length === 1 ? ' is' : 's are'} modified while a tick (\`${lock.name}\`) holds a live lock: that tick's own filing, committed at the end of its unit.`);
    const staged = new Set((f.staged || []).map((p) => p.replace(/\\/g, '/')));
    // OA-434: unstaged dirt inside ONE map or letter folder is fenced. Ticks carry on with any unit that stays out of that folder, so it is a note, not a stop; a staged path, ci-reference/ and a bare file under a root are never fenced (`fenceOf` is the loop's own test).
    const fenced = dirtyAll.filter((p) => !own.includes(p) && !staged.has(p.replace(/\\/g, '/')) && fenceOf(p.replace(/\\/g, '/')));
    if (fenced.length) {
      const shown = fenced.slice(0, 4).map((p) => `\`${p}\``).join(', ') + (fenced.length > 4 ? ` and ${fenced.length - 4} more` : '');
      add('NOTE', 'tree-fenced', `${fenced.length} modified file${fenced.length === 1 ? ' is' : 's are'} fenced inside one map or letter folder and not named by a hold: ${shown}. Ticks carry on with any unit that stays out of that folder; it only bars work that writes under Areas/, Places/ or Correspondence/.`, 'Commit or revert it when you are done with it, or a hold naming it under **File:** takes it out of the counts.');
    }
    const stray = dirtyAll.filter((p) => !own.includes(p) && !fenced.includes(p));
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

  // Consecutive ticks that STOPPED before dispatch. A tick that dispatched and found
  // nothing is `-idle`, which loopHealth() does not count (OA-576).
  if (health.ran && health.idle >= 2) {
    const blockers = findings.filter((x) => x.level === 'BLOCKING');
    const why = f.lastRun ? ` Last tick (${f.lastRun.name.replace(/\.md$/, '')}) said: "${f.lastRun.headline}"` : '';
    if (blockers.length) add('NOTE', 'idle-explained', `${health.idle} consecutive ticks stopped before reaching work, which the BLOCKING finding${blockers.length === 1 ? '' : 's'} above explain.${why}`);
    else if (lock.present && !lock.isTick) add('NOTE', 'idle-explained', `${health.idle} consecutive ticks stopped before reaching work, deferring to the session holding \`loop/LOCK.d\`.${why}`);
    else add('AT RISK', 'idle-stopped', `${health.idle} consecutive ticks stopped before reaching work and nothing visible from here explains it.${why}`, 'Read the newest `-none` file in `loop/runs/`, which says why that tick stopped.');
  }
  if (f.engineLag && !f.engineLag.error) {
    const el = f.engineLag;
    if (el.over.length) add('NOTE', 'engine-lag', `${el.over.length} map${el.over.length === 1 ? ' is' : 's are'} past the ${el.ceiling}-day engine-lag ceiling: ${el.over.slice(0, 5).map((m) => `${m.name} ${m.days}d`).join(', ')}${el.over.length > 5 ? ` and ${el.over.length - 5} more` : ''}. Each is one rebuild row (OA-430), not a stop.`, 'The worklist carries a rebuild row per map; take them as the loop reaches them, or ask for them first.');
    if (el.unknown) add('NOTE', 'engine-lag-unknown', `Engine lag could not be read for ${el.unknown} map${el.unknown === 1 ? '' : 's'} (no recorded engine commit, or one this clone lacks), so ${el.unknown === 1 ? 'it is' : 'they are'} not counted inside the ${el.ceiling}-day ceiling.`);
  }
  if (health.ran && health.missed > 0) {
    add('AT RISK', 'missed', `${health.missed} of the recent idle runs were fired by the scheduler and never reached a prompt (written up as \`-missed\`). No tree state explains that.`, "Open the scheduled task bus-loop in the desktop app and read its recent runs' messages.");
  }
  // OA-608: against the scheduled fire times when loop/README.md gives them, so a normal gap says nothing.
  if (health.ran && (health.dueAt ? health.dueAt.length >= 1 : health.ageMin != null && health.ageMin >= 3 * health.cadence)) {
    add('NOTE', 'quiet', `No tick for ${health.ageMin < 180 ? health.ageMin + ' min' : (health.ageMin / 60).toFixed(1) + ' h'} (${health.dueAt ? `${health.dueAt.length} scheduled run${health.dueAt.length === 1 ? '' : 's'} of ${scheduleText(health.schedule)} fell due since` : `cadence ${health.cadence} min`}). Normal while the desktop app was shut; if it was open, the schedule may be off.`);
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
  const free = buckets.free.length;
  let running = free;
  const supplyPath = [{ date: today, free }];
  for (const [date, rows] of byDate) { running += rows.length; supplyPath.push({ date, free: running, adds: rows.map((r) => r.ref) }); }

  const dated = [];
  for (const c of f.commitments || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.by || '')) continue;
    const d = daysBetween(today, c.by);
    if (d <= days) dated.push({ id: c.id, what: c.what, by: c.by, inDays: d });
  }
  dated.sort((a, b) => a.by.localeCompare(b.by));

  const capacity = assessCapacity(f, { add, findings, buckets, today });

  const level = findings.some((x) => x.level === 'BLOCKING') ? 'BLOCKED' : findings.some((x) => x.level === 'AT RISK') ? 'AT RISK' : 'CLEAR';
  return {
    verdict: level, today, health, findings, capacity,
    supply: { free, held: buckets.held.length, peter: buckets.peter.length, parked: buckets.parked.length, total: (f.actions || []).length },
    lookahead: { days, coming, supplyPath, dated },
  };
}

const ORDER = { BLOCKING: 0, 'AT RISK': 1, NOTE: 2 };

/** The "can a tick do work" section: what the prompt lets a tick take, against what is there, and what a person can do. */
export function renderCapacity(c) {
  const L = [];
  L.push(`CAN A TICK DO WORK? ${c.work || 'not measured here'}`);
  if (c.prereq) {
    const p = c.prereq;
    L.push(`  Prompt      ${p.drift === false ? 'the stored task matches loop/README.md' : p.drift === true ? 'the stored task DIFFERS from loop/README.md' : 'the stored task could not be compared'}; ${p.scripts - p.missing.length} of ${p.scripts} files it names exist${p.missing.length ? ` (missing: ${p.missing.join(', ')})` : ''}.`);
  }
  if (c.resources) {
    const r = c.resources;
    L.push(`  Resources   ${r.safe.join(', ') || 'none'} safe${r.barred.map((b) => `; ${b.name} ${b.verdict.toUpperCase()} (bars ${b.bars}${b.lockOnly ? ': a run in progress' : ''})`).join('')}.`);
  }
  if (c.busWork) {
    const b = c.busWork;
    L.push(`  Bus-work    at most ${b.finishable.length} row${b.finishable.length === 1 ? '' : 's'} a tick can finish by the prompt's rules (an upper bound: rollout.js is not run, and can still answer STALE-INPUTS for a rebuild); ${b.escalate.length} stopped by an ESCALATE grade, ${b.fixture.length} under _portal-fixture, ${b.person.length} refresh row${b.person.length === 1 ? '' : 's'} with no unattended recipe.`);
  } else L.push('  Bus-work    not measured (add --deep: it reads the live portal and takes about a minute).');
  if (c.deadline) {
    const d = c.deadline;
    L.push(`  Deadlines   ${d.counted ? `${d.units} tick unit${d.units === 1 ? '' : 's'} owed by ${d.counted} dated refresh row${d.counted === 1 ? '' : 's'}, the earliest taking effect ${d.earliest}; at ${d.perDay} a day (${d.perDaySource}) ${d.shortfall ? `${d.shortfall} tick${d.shortfall === 1 ? '' : 's'} short` : 'in time'}` : 'no finishable refresh row carries a date'}${d.undated ? `; ${d.undated} undated row${d.undated === 1 ? '' : 's'} not projected` : ''}.`);
  }
  if (c.levers.length) {
    L.push('');
    L.push('What you can do, most rows first:');
    c.levers.forEach((v, i) => {
      L.push(`  ${i + 1}. ${v.text}${v.refs.length ? ` [${v.refs.slice(0, 8).join(', ')}${v.refs.length > 8 ? `, +${v.refs.length - 8}` : ''}]` : ''}`);
      L.push(`     ${v.move ? 'Move: ' + v.move : 'Nothing to do.'}`);
    });
  }
  return L.join('\n');
}

export function render(r, now) {
  const L = [];
  const stamp = new Date(now).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  L.push(`Loop health, ${stamp}`);
  L.push(`VERDICT: ${r.verdict}`);
  L.push('');
  const h = r.health;
  L.push(h.ran
    ? `Ticks: last ${new Date(h.lastAt).toTimeString().slice(0, 5)} (${h.ageMin < 180 ? h.ageMin + ' min' : (h.ageMin / 60).toFixed(1) + ' h'} ago), ${h.schedule ? `scheduled ${scheduleText(h.schedule)}` : `cadence ${h.cadence} min`}, ${h.idle} consecutive without reaching work${h.lastWorkingAt ? `, last worked ${new Date(h.lastWorkingAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.`
    : 'Ticks: no run files here.');
  const s = r.supply;
  L.push(`Backlog (not the loop's feed since OA-576; worked in /oa sessions): ${s.total} actions: ${s.free} free, ${s.held} held by a date, ${s.peter} Peter's decision, ${s.parked} Parked.`);
  L.push('');
  const sorted = r.findings.slice().sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  if (!sorted.length) L.push('Nothing to report.');
  for (const x of sorted) {
    L.push(`${x.level.padEnd(8)} ${x.text}`);
    if (x.move) L.push(`         Move: ${x.move}`);
  }
  if (r.capacity && (r.capacity.work || r.capacity.levers.length)) { L.push(''); L.push(renderCapacity(r.capacity)); }
  L.push('');
  const la = r.lookahead;
  L.push(`Next ${la.days} days:`);
  if (la.coming.length) {
    for (const p of la.supplyPath.slice(1)) L.push(`  ${p.date}: ${p.adds.join(', ')} come${p.adds.length === 1 ? 's' : ''} back to the backlog`);
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
/** The loop prompt's P2-and-P3 rule (buses-data OA-557) took effect with runs started after this stamp; older run files cannot be blamed for not following it. */
export const RULE_FROM = '2026-10-03_1300';
/** The number of newest ticks whose `(not due: ...)` lines are read. */
export const PASSED_RUNS = 12;

/**
 * The `OA-nnn (passed over: <gate>)` lines of the newest ticks, newest tick first, each ref
 * once with the newest gate. It is a form the loop prompt mandates. (Until OA-610 this
 * also collected the ad-hoc files a tick named `<file>.md` (not due: ...); a bus tick
 * no longer takes ad-hoc work, and `loop_ready.mjs` reads those lines for the worklist.) A line
 * naming several refs ("OA-237, 302, 311 (passed over: ...)") gives each of them the gate.
 */
export function passedOver(runsDir, n = PASSED_RUNS) {
  try {
    const files = readdirSync(runsDir).filter((x) => /^\d{4}-\d{2}-\d{2}_\d{4}-(?!busy|missed)[a-z-]+\.md$/i.test(x) && x.slice(0, 15) >= RULE_FROM).sort().reverse().slice(0, n);
    const seen = new Map();
    for (const name of files) {
      const text = readFileSync(path.join(runsDir, name), 'utf8');
      for (const m of text.matchAll(/(OA-\d+(?:`?(?:,\s*|\s+and\s+)`?(?:OA-)?\d+)*)`?\s*\(passed over:\s*([^)]*)\)/g)) {
        for (const num of m[1].match(/\d+/g)) { const ref = `OA-${num}`; if (!seen.has(ref)) seen.set(ref, { ref, gate: m[2].trim(), run: name.replace(/\.md$/, '') }); }
      }
    }
    return { runs: files.length, rows: [...seen.values()] };
  } catch { return { runs: 0, rows: [] }; }
}

/**
 * Every file the loop prompt tells a tick to run, from the prompt block in loop/README.md
 * (the last plain fenced block under "## The task prompt"): a quoted absolute path to a
 * script or .env, and a quoted `Development Docs/...` script relative to the checkout.
 * `null` when the block cannot be found, which is a fault to report and never a pass.
 */
export function promptScripts(readme) {
  const i = String(readme || '').lastIndexOf('## The task prompt');
  if (i < 0) return null;
  const m = /```\r?\n([\s\S]*?)\r?\n```/.exec(readme.slice(i).replace(/```bash\r?\n[\s\S]*?```/g, ''));
  if (!m) return null;
  const out = new Set();
  for (const x of m[1].matchAll(/"((?:[A-Za-z]:[\\/]|\/)[^"<>]+?\.(?:mjs|js|py|env))"/g)) out.add(x[1]);
  for (const x of m[1].matchAll(/"(Development Docs\/[^"<>]+?\.mjs)"/g)) out.add(x[1]);
  return [...out];
}

/** The conditions check's per-resource verdicts from `worklist.mjs --conditions --json`, or null. */
export function parseResources(text) {
  try { const r = JSON.parse(text).resources; return r && typeof r === 'object' ? r : null; } catch { return null; }
}

/**
 * The bus-work rows the prompt could take, from `worklist.mjs --json` (--deep only: it reads
 * the live portal, so a plain run opens no socket). `null` when the worklist cannot be read.
 * `scan` is the upcoming report the refresh rows join to, which names the ink review to read.
 */
export function parseBusWork(text, { grades = {}, fixtures = [], reviewed = [] } = {}) {
  try {
    const j = JSON.parse(text);
    const items = j.items || [];
    const rows = [];
    for (const r of items) {
      if (/^refresh-/.test(r.key)) rows.push({ key: r.key, kind: 'refresh', towns: [], unattended: !!r.unattended, effectiveDate: r.effectiveDate || null, map: r.map || null, local: /^refresh-local-/.test(r.key) });
      else if (/^engine-rebuild-/.test(r.key)) rows.push({ key: r.key, kind: 'rebuild', towns: r.towns || [] });
    }
    return { rows, grades, fixtures, reviewed, scan: (j.meta && j.meta.upcomingReport && j.meta.upcomingReport.date) || null };
  } catch { return null; }
}

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

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The refresh grades by town, the towns a person has answered with a `no-rebuild`
 * review for the grades file's own scan date, and the maps under _portal-fixture/,
 * for classifying bus-work rows. Town maps only: a place carries its own review file.
 */
function gradesAndFixtures(busesDir) {
  const grades = {}, reviewed = [];
  try {
    const f = readdirSync(path.join(busesDir, '_gtfs')).filter((n) => /^refresh-grades_\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().pop();
    if (f) for (const [t, v] of Object.entries(JSON.parse(readFileSync(path.join(busesDir, '_gtfs', f), 'utf8')).towns || {})) grades[t] = v.grade;
    const scan = f && /(\d{4}-\d{2}-\d{2})/.exec(f)[1];
    if (scan) for (const t of Object.keys(grades)) {
      try {
        const j = JSON.parse(readFileSync(path.join(busesDir, 'Areas', t, 'refresh-reviews.json'), 'utf8'));
        if ((j.reviews || []).some((r) => r.scan === scan && r.verdict === 'no-rebuild')) reviewed.push(t);
      } catch { /* no review file for this town: its grade stands */ }
    }
  } catch { /* no grades file: nothing reads as ESCALATE, which the caller cannot tell from a clean grade, so the rows say "judged from grade and folder" */ }
  const fixtures = [];
  for (const root of ['Areas', 'Places']) {
    try { for (const e of readdirSync(path.join(busesDir, root, '_portal-fixture'), { withFileTypes: true })) if (e.isDirectory()) fixtures.push(e.name); } catch { /* none */ }
  }
  return { grades, fixtures, reviewed };
}

/** The ink review for one scan (`_gtfs/ink-review_<scan>.json`), or null when there is none: then every finishable refresh row owes its full rebuild and staging. */
export function readInkReview(busesDir, scan) {
  if (!scan) return null;
  try { return JSON.parse(readFileSync(path.join(busesDir, '_gtfs', `ink-review_${scan}.json`), 'utf8')); } catch { return null; }
}

/** Run a read-only command and return its stdout, or null if it could not run or timed out. */
function probe(args, { cwd, timeout = 120000 } = {}) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd, timeout, maxBuffer: 128 * 1024 * 1024 });
  return r.error ? null : { status: r.status, out: r.stdout || '' };
}

/** Whether the stored task matches loop/README.md, and which of the files the prompt names exist. */
function probePrereq(busesDir) {
  const checker = path.join(busesDir, 'Documentation', 'check-task-prompt.mjs');
  const drift = existsSync(checker) ? probe([checker], { cwd: busesDir }) : null;
  // exit 0 = the stored task matches the block (or there is no stored task, which the checker treats as fine); 1 = they diverge
  const drifted = drift ? (drift.status === 1 ? true : drift.status === 0 ? false : null) : null;
  let scripts = null;
  try {
    const list = promptScripts(readFileSync(path.join(busesDir, 'loop', 'README.md'), 'utf8'));
    if (list) {
      const must = ['worklist.mjs', 'adopt.mjs'].map((n) => path.join(HERE, n));
      const all = [...new Set([...list.map((p) => (path.isAbsolute(p) ? p : path.join(busesDir, p))), ...must])];
      scripts = all.map((p) => ({ path: p.replace(/\\/g, '/'), exists: existsSync(p) }));
    }
  } catch { /* README unreadable: scripts stay null, which is reported as an unreadable prompt block */ }
  return { drift: drifted, scripts: scripts || [], unreadable: scripts === null };
}

/** Which maps are past the engine-lag ceiling (OA-485 item 3). The ceiling lives in `engine_lag.js` and is read back from its output, never restated here. */
function probeEngineLag(busesDir) {
  try {
    const script = path.join(assetsDir(), 'engine_lag.js');
    if (!existsSync(script)) return null;
    const r = probe([script, '--buses', busesDir, '--json'], { cwd: busesDir });
    if (!r || r.status !== 0) return null;
    const j = JSON.parse(r.out);
    return { ceiling: j.ceiling, over: (j.over || []).map((m) => ({ name: m.name, days: m.days })), unknown: (j.unknown || []).length, measured: j.measured, error: j.error || null };
  } catch { return null; }
}

function probeFacts(busesDir, deep, which) {
  const facts = {};
  if (which.prereq) facts.prereq = probePrereq(busesDir);
  if (which.engineLag) facts.engineLag = probeEngineLag(busesDir);
  if (which.conditions) {
    const cond = probe([path.join(HERE, 'worklist.mjs'), '--conditions', '--json', '--buses', busesDir], { cwd: HERE });
    facts.resources = cond ? parseResources(cond.out) : null;
  }
  if (deep) {
    const wl = probe([path.join(HERE, 'worklist.mjs'), '--json', '--buses', busesDir], { cwd: HERE, timeout: 300000 });
    facts.busWork = wl ? parseBusWork(wl.out, gradesAndFixtures(busesDir)) : null;
    if (facts.busWork) facts.busWork.review = readInkReview(busesDir, facts.busWork.scan);
  }
  return facts;
}

/**
 * `probes` runs the two read-only commands the prompt's own step 2 and the pre-commit hook run
 * (the conditions check, the stored-prompt check); `deep` adds the worklist, which reads the live portal.
 */
export function gather(busesDir, { now = Date.now(), probes = false, deep = false } = {}) {
  const loopDir = path.join(busesDir, 'loop');
  const files = readYourMoveDir(path.join(loopDir, 'your-move'));
  const { holds, drafts } = classify(files);
  const parsedHolds = [];
  for (const h of holds) {
    try { const b = parseHold(h); parsedHolds.push({ ref: b.ref || String(h.name).replace(/\.md$/i, ''), ageDays: Math.floor((now - h.mtimeMs) / DAY) }); } catch { /* one odd hold is not the folder's problem */ }
  }

  const st = git(busesDir, ['status', '--porcelain', '--untracked-files=no']);
  const dirty = st.ok ? st.out.split('\n').filter(Boolean).map((l) => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, '')) : null;

  const sg = git(busesDir, ['diff', '--cached', '--name-only']);
  const staged = sg.ok ? sg.out.split('\n').filter(Boolean) : [];

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
    dirty, staged, holdPaths: heldPaths(files), holds: parsedHolds, drafts: drafts.length,
    ahead, actions, commitments,
    passedOver: passedOver(path.join(loopDir, 'runs')),
    perDay: (() => { try { return ticksPerDay(readFileSync(path.join(loopDir, 'README.md'), 'utf8')); } catch { return null; } })(),
    schedule: readSchedule(loopDir),
    ...(probes ? probeFacts(busesDir, deep, probes === true ? { prereq: true, conditions: true, engineLag: true } : probes) : {}),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const buses = resolveBuses(args);
  if (!existsSync(path.join(buses, 'Development Docs', 'open-actions'))) {
    process.stderr.write(`loop_health: ${buses} is not a buses-data checkout (no Development Docs/open-actions). Pass --buses DIR.\n`);
    process.exitCode = 2;
    return;
  }
  const now = Date.now();
  const facts = gather(buses, { now, probes: !args['no-probes'], deep: !!args.deep });
  const days = Number(args.days);
  const r = analyse({ ...facts, ...(Number.isFinite(days) && days > 0 ? { days } : {}) });
  process.stdout.write((args.json ? JSON.stringify(r, null, 2) : render(r, now)) + '\n');
  // `process.exitCode`, not `process.exit()`: a pipe write is asynchronous on Windows.
  process.exitCode = r.findings.some((x) => x.level === 'BLOCKING') ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
