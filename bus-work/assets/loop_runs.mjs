/*
 * loop_runs.mjs — is the scheduled loop actually DOING anything (buses-data
 * OA-288, 2026-09-09).
 *
 * THE THIRD FACT ABOUT THE LOOP, AND THE ONE NOTHING READ. OA-283 gave
 * the holds folder a reader (now `loop/your-move/`) and OA-287 gave `loop/LOCK.d` one. Between them they
 * answer *these items need you* and *a tick is running right now*. Neither
 * answers *the loop has fired four times this morning and done nothing*, and the
 * gap is not a rounding error in the coverage: when the loop is halted there is
 * NO LOCK AT ALL, so `loop_lock.mjs` reports `present: false` — which is exactly
 * what it reports when everything is fine. The one state you most need to be told
 * about is the one indistinguishable from health.
 *
 * IT IS NOT HYPOTHETICAL. On 2026-09-09 the loop stopped at 08:15, 09:15, 10:15
 * and 11:15. Three met a STILL tree — `sched-0815`'s own headline was "the tree
 * is a finished experiment nobody has committed yet" — and the fourth was a
 * healthy collision with an interactive session holding the lock. Six of the
 * first 36 ticks were gate-stops. Nothing on the board said so on any of them;
 * the `buses-tree CHECK FIRST` line was there, but that says a tree is dirty, not
 * that four hours of loop time went nowhere.
 *
 * WHAT IT READS, AND WHY IT OPENS NOTHING. `loop/runs/` is one file per tick,
 * named `YYYY-MM-DD_HHMM-<feed>.md`, and `<feed>` is `none` exactly when the run
 * stopped before dispatch, or `around` when it dispatched but never reached
 * `buses-data` at all. So the date, the time and the verdict are all in the
 * NAME: the measurement is a directory listing, and no run file is ever parsed.
 * That matters beyond speed — the run files are prose written by a fresh session
 * each hour, and a reader that depended on their wording would be a reader that
 * broke the first time a tick phrased something differently.
 *
 * `around` IS WHY THE TWO PREDICATES BELOW ARE NOT EACH OTHER'S COMPLEMENT
 * (buses-data OA-303, Peter's option 3, 2026-09-11). The counter measured
 * IDLENESS, and the subject anybody cares about is whether the loop can reach its
 * own queue. Those came apart on 2026-09-10: `0815-none`, `0915-none` (row
 * raised), then `1015-bus-work` — a tick that found and fixed a defect in
 * `claude-skills`, the one tree the bar left open — and the row went away while
 * one modified `Correspondence/` letter went on barring `buses-data` for another
 * four hours. A better tick made the board quieter about a problem that was
 * getting older. So a tick that WORKED but never reached the barred resource now
 * names itself `-around`, and it counts BOTH ways: it continues the idle run,
 * because the bar did not move, and it is in `working`, because it genuinely did
 * something. Naming it is the tick's job at step 7 of the task prompt; this module
 * still reads nothing but the filename.
 *
 * `missed` IS THE THIRD STATE, AND IT IS WRITTEN BY SOMEBODY ELSE (buses-data
 * OA-408, decided by Peter 2026-09-21). A scheduled run that dies in three seconds
 * on a session limit never reads its prompt and leaves no file here, so the
 * listing above could not see it at all. The NEXT tick joins the scheduler's own
 * run list against this folder and writes `<stamp>-missed.md` for each run with no
 * file. Such a run fired and did nothing, so it continues the idle run exactly as
 * `none` does and is never `working` — and it is counted apart, because its cause
 * is the scheduler's recorded message and not anything in the tree. Until this
 * reader knew the name, a `-missed` file would have parsed as an ordinary feed and
 * been counted as a WORKING tick: the one thing it certainly was not.
 *
 * `busy` IS THE FOURTH, AND IT IS NEITHER IDLE NOR WORKING (buses-data adhoc
 * `tick-counts`, 2026-09-26). A scheduled run that finds `loop/LOCK.d` held by
 * ANOTHER TICK (`sched-…`) whose lease is live stands down, and until then it
 * named itself `-none`. That day a 20-tick `/ticks` run held the lock while the
 * hourly schedule fired into it twice (`1221-none`, `1515-none`), and each one
 * inflated the idle rate — yet the queue was being worked the whole time, by the
 * tick holding the lock. So a stand-down to a live TICK is `-busy`, and it is
 * TRANSPARENT: it neither continues nor breaks the idle run, and it is not
 * working. A stand-down to a PERSON's session stays `-none`: that is loop time
 * the queue really lost, and the row names that holder as its cause. Since
 * buses-data OA-610 (2026-10-08) the separate ad-hoc loop holds the same lock as
 * `sched-adhoc-HHMM`; the `sched-` test below makes it a tick, so a bus tick that
 * meets it is `-busy` too.
 *
 * `idle` IS THE FIFTH, AND TRANSPARENT FOR THE SAME REASON (buses-data OA-576,
 * Peter, 2026-10-07). Since the loop does map upkeep only, a tick that
 * dispatched and found no bus-work row it could finish and no ad-hoc file is the
 * normal day, not a fault (and since OA-610 a bus tick takes no ad-hoc file at
 * all: the ad-hoc queue has its own loop, whose run files are in `adhoc/runs/`
 * and are not read here; a bus tick's file no longer carries `-adhoc`, and an old
 * one that does still parses as a working tick): there is no backlog feed left to fall back on. Named
 * `-none`, three of those a day would keep the `loop-idle` row on the board for
 * ever and hide the gate-stop it exists to catch. So a tick that got past step 2
 * and chose nothing names itself `-idle`; like `busy` it neither continues nor
 * breaks the idle run and is not working. `-none` keeps its meaning: stopped
 * before dispatch.
 *
 * THE CADENCE IS DERIVED FROM THE FILENAMES, NOT CONFIGURED. OA-288 asked for a
 * threshold taken from the schedule rather than from taste. The schedule is not
 * readable from here — the cron lives in the desktop app's scheduled-task store,
 * which a plain node script cannot reach — so the interval is the MEDIAN GAP
 * between consecutive runs, which is the schedule's own output measuring itself.
 * Measured over the first 36 ticks: 14 of 21 gaps were exactly 60 minutes, and
 * the median is robust to the rest (a 4-hour hole where the desktop app was shut,
 * an 82-minute one, a 6-minute manual fire). A median needs no outlier rule and
 * no configuration, and it re-calibrates by itself if the schedule ever changes.
 *
 * EXCEPT IT DID NOT, AND THE SCHEDULE NOW WINS WHERE IT IS WRITTEN (buses-data
 * OA-608). When OA-577 moved the loop to `0 4,13,19` on 7 October, the median was
 * still 57 minutes a day later — weeks of hourly history outvote a handful of new
 * gaps — so every normal nine-hour wait read as nine missed ticks. And an uneven
 * schedule has no one gap a median could find. So `loop/README.md`'s cron line,
 * the written copy of the stored task's schedule and the line OA-577 changed, is
 * read for the scheduled FIRE TIMES: a run is late when a fire time has passed by
 * `FIRE_GRACE_MIN` with no run file since, and a normal gap raises nothing. The
 * median stays as the fallback for a README with no cron line.
 *
 * WHAT IT DELIBERATELY DOES NOT RAISE: a stale newest run on its own. The
 * scheduler only fires while the desktop app is open, and a task that falls due
 * while it is shut runs once on next launch — so "nothing since 01:15" is the
 * NORMAL state of every morning, and a row for it would cry wolf daily and be
 * muted inside a week. The row is raised by the loop FIRING and doing nothing,
 * which is unambiguous, or by a `loop/STOP` somebody may have forgotten. The age
 * of the last tick is reported inside the row rather than being a trigger of its
 * own.
 *
 * THE ONE EXCEPTION IS SILENCE WITH WITNESSES (buses-data OA-408 item 3, Peter,
 * 2026-09-21: "prefer a false alarm to silence"). A stale newest run is
 * innocent when the app was shut and damning when it was open, and the
 * transcripts under `~/.claude/projects/` say which: every turn any session
 * took carries a timestamp. `loopSilentItems` counts the cadence-long slots
 * after the newest run that hold at least one turn, skipping the first slot
 * (the next tick is not due until it ends), and raises a CHORE row at three.
 * Slots, not elapsed time, is what keeps the morning quiet: the app opened at
 * 08:00 after a 01:15 tick is one slot of activity, and the tick that fires on
 * launch writes a file and ends the silence before a second slot fills. The
 * turns are read by `concurrency.mjs`'s `readSessionTurns`, and only when the
 * newest run is already three cadences old; this module still opens nothing.
 *
 * SILENCE IS A REQUIREMENT. `loop/` is gitignored apart from its README, so an
 * absent folder is the normal state in a fresh clone, in a worktree, in CI and in
 * every other harness's fixture — the named shape *the subject that does not
 * survive `actions/checkout`*. Absent, empty and unreadable each yield no row and
 * no warning, and `prove-red-loop-runs.mjs` proves that against real directories
 * because a fake reader cannot be absent.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Minutes after a scheduled fire before its missing run file counts: the loop lock's lease. */
export const FIRE_GRACE_MIN = 90;

/**
 * The schedule in `loop/README.md`'s cron line, `cron \`M H,H,H * * *\``:
 * `{ minute, hours }` with the hours sorted, or null when there is no such line
 * or it holds an hour or minute out of range. Shared with refresh_deadline.mjs.
 */
export function scheduleOf(readme) {
  const m = /cron `(\d{1,2}) ([\d,]+|\*) \* \* \*`/.exec(String(readme || ''));
  if (!m) return null;
  const minute = Number(m[1]);
  const hours = m[2] === '*' ? [...Array(24).keys()] : [...new Set(m[2].split(',').filter(Boolean).map(Number))].sort((a, b) => a - b);
  if (minute > 59 || !hours.length || !hours.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) return null;
  return { minute, hours };
}

/** scheduleOf() of `<loopDir>/README.md`, or null when it is absent or unreadable. */
export function readSchedule(loopDir) {
  try { return scheduleOf(readFileSync(path.join(loopDir, 'README.md'), 'utf8')); } catch { return null; }
}

/** Scheduled fire times (local, ms) strictly after `from` and at or before `to`. */
export function firesBetween(sched, from, to) {
  const out = [];
  if (!sched || !(to > from)) return out;
  const d0 = new Date(from);
  // Day by day through the local calendar, so a clock change cannot skip or repeat a day.
  for (let k = 0; ; k++) {
    const day = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + k);
    if (day.getTime() > to) break;
    for (const h of sched.hours) {
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, sched.minute).getTime();
      if (t > from && t <= to) out.push(t);
    }
  }
  return out;
}

/** `04:00, 13:00, 19:00` */
export const scheduleText = (sched) => sched.hours.map((h) => `${String(h).padStart(2, '0')}:${String(sched.minute).padStart(2, '0')}`).join(', ');

/** `2026-09-09_1115-none.md` -> { name, feed: 'none', at: <ms> }, or null. */
export function parseRunName(name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})-(.+)\.md$/i.exec(String(name || ''));
  if (!m) return null;
  const [, y, mo, d, hh, mm, feed] = m;
  // Local time: the filenames are written in local time by the tick, and the
  // reader is on the same machine. Parsing them as UTC would shift every age by
  // the offset and would be wrong by an hour for half the year.
  const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)).getTime();
  return Number.isFinite(at) ? { name: String(name), feed: feed.toLowerCase(), at } : null;
}

/**
 * Read `<dir>` if it is there. Absent, empty, not-a-directory and unreadable all
 * return [] — see the header. Names that do not parse are skipped rather than
 * fatal: `loop/runs/` has held a hand-written record before (`sched-1001`, written
 * on behalf of a tick that hung), and one odd filename must not blind the check.
 */
export function readRuns(dir) {
  const out = [];
  try {
    // The try/catch IS the mechanism and there is deliberately no existsSync in
    // front of it — readdirSync already throws for a missing path, an undefined
    // path and a path that is a file, so a guard here could be deleted with every
    // assertion still green. That is *the check that could not go red*, and
    // loop_your_move.mjs carries the same note for the same reason.
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const r = parseRunName(e.name);
      if (r) out.push(r);
    }
  } catch { return []; }
  return out.sort((a, b) => a.at - b.at);
}

/** Median gap in minutes between consecutive runs, or `fallback` if too few. */
export function cadenceMin(runs, fallback = 60) {
  const gaps = [];
  for (let i = 1; i < (runs || []).length; i++) gaps.push((runs[i].at - runs[i - 1].at) / 60000);
  if (gaps.length < 4) return fallback;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const med = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  // Clamped so a pathological history cannot produce a threshold of seconds or
  // of days. The bounds are wide on purpose: they are a guard against nonsense,
  // not a second opinion about the schedule.
  return Math.min(240, Math.max(15, Math.round(med)));
}

/**
 * A feed that means the run never reached `buses-data`'s own queue — `none` for a
 * gate-stop before dispatch, `around` for a tick that dispatched and worked
 * somewhere the bar left open, `missed` for a scheduled run that left no file of
 * its own. All three continue the run the row counts. Exported, because
 * `routine_numbers.mjs` counts the same idleness and once carried its own copy.
 */
export const UNREACHED = new Set(['none', 'around', 'missed']);

/**
 * A tick that stood down because another tick held a live lock, or (`idle`)
 * dispatched and found nothing to do — see the header. Skipped by the idle walk
 * and absent from `working`. Exported for
 * `routine_numbers.mjs`, which takes it out of the idle ratio's denominator too.
 */
export const DEFERRED = new Set(['busy', 'idle']);

/** Feeds that did no work at all — every UNREACHED feed except `around`, and `busy` and `idle`. */
const DID_NOTHING = new Set(['none', 'missed', ...DEFERRED]);

/**
 * @param {{runs: Array, now?: number, fallbackMin?: number, schedule?: {minute, hours}|null}} p
 * @returns {{ran: boolean, lastAt, ageMin, cadence, idle: number, around: number, missed: number, lastWorkingAt, schedule, dueAt}}
 *   `dueAt` (with a schedule only, else null): the fire times after the newest run
 *   whose grace has passed with no run file since — the runs that are LATE.
 *   `idle` is the number of CONSECUTIVE most-recent ticks that never reached the
 *   queue — `none`, `around` or `missed`. `around` is how many of those did work
 *   anyway, and `missed` how many left no file of their own.
 */
export function loopHealth({ runs, now = Date.now(), fallbackMin = 60, schedule = null }) {
  const list = (runs || []).slice();
  // With a schedule the cadence is its mean gap, for wording only; lateness is `dueAt`.
  const cadence = schedule ? Math.round(1440 / schedule.hours.length) : cadenceMin(list, fallbackMin);
  if (!list.length) return { ran: false, lastAt: null, ageMin: null, cadence, idle: 0, around: 0, missed: 0, lastWorkingAt: null, schedule, dueAt: null };
  const last = list[list.length - 1];
  // Ten minutes' slack: a tick names its file when it starts, a minute or two after its fire.
  const dueAt = schedule ? firesBetween(schedule, last.at + 10 * 60000, now - FIRE_GRACE_MIN * 60000) : null;
  let idle = 0;
  let around = 0;
  let missed = 0;
  for (let i = list.length - 1; i >= 0 && (UNREACHED.has(list[i].feed) || DEFERRED.has(list[i].feed)); i--) {
    if (DEFERRED.has(list[i].feed)) continue;
    idle++;
    if (list[i].feed === 'around') around++;
    if (list[i].feed === 'missed') missed++;
  }
  // NOT the complement of the loop above, and that is the whole substance of
  // OA-303. An `around` tick did a real unit of work, so it belongs here and sets
  // `lastWorkingAt`; it also belongs in the run above, because the bar it worked
  // around is still there. A `none` or a `missed` run is in neither.
  const working = list.filter((r) => !DID_NOTHING.has(r.feed));
  return {
    ran: true,
    lastAt: last.at,
    ageMin: Math.max(0, Math.round((now - last.at) / 60000)),
    cadence,
    idle,
    around,
    missed,
    lastWorkingAt: working.length ? working[working.length - 1].at : null,
    schedule,
    dueAt,
  };
}

const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const ago = (min) => (min == null ? 'an unknown time' : min < 90 ? `${min} min` : `${(min / 60).toFixed(1)} h`);

/**
 * The row, if there is one.
 *
 * RAISED BY THE LOOP FIRING AND DOING NOTHING, or by a `loop/STOP` nobody has
 * removed — never by silence alone, for the reason in the header.
 *
 * @param {object} p
 * @param {object} p.health          from loopHealth()
 * @param {number} p.idleThreshold   consecutive `none` ticks before it is a signal (default 2)
 * @param {boolean} p.stopFile       does `loop/STOP` exist
 * @param {boolean} p.treeDirty      does `buses-tree` report anything uncommitted
 * @param {string|null} p.heldBy     name in `loop/LOCK.d/holder`, or null
 * @param {string} p.busesDir        for the row's shell step
 */
export function loopRunItems({ health, idleThreshold = 2, stopFile = false, treeDirty = false, heldBy = null, busesDir = '.' }) {
  const h = health || {};
  const idling = h.ran && h.idle >= idleThreshold;
  if (!idling && !stopFile) return [];

  // WHY, in the order that decides whose move it is. Each cause is read from live
  // state rather than from a run file, so the row can never contradict what the
  // CONDITIONS block above it says. A cause is about NOW; the ticks it explains
  // already happened, and the wording says so rather than implying it covers each.
  const causes = [];
  let rank = 8;
  if (stopFile) {
    causes.push('`loop/STOP` exists — somebody asked the loop to halt. Delete it when you are done; a forgotten STOP is indistinguishable from a loop with nothing to do.');
    rank = 3;
  }
  if (treeDirty) {
    causes.push('the shared working tree has uncommitted files, and an unattended run reads `CHECK FIRST` as stop — so ONE stray file halts every tick until somebody commits or reverts it.');
    rank = 3;
  }
  if (heldBy && !/^sched-/i.test(heldBy)) {
    causes.push(`\`loop/LOCK.d\` is held by \`${heldBy}\`, which is not a tick — the loop is deferring to a session at the keyboard, which is correct and clears itself when that session finishes.`);
  }
  if (!causes.length) {
    causes.push('nothing visible from here explains it — the tree is clean, there is no `loop/STOP` and no lock is held. Read the newest file in `loop/runs/`, which says why that tick stopped.');
  }

  // TWO TITLES, BECAUSE "done nothing" IS FALSE OF AN `around` TICK. It committed
  // a fix; what it did not do is reach the barred queue, which is what the row is
  // about. Saying "done nothing" about a tick that worked is the kind of false
  // sentence on a board this project does not ship — and with `around` counted in
  // the run, the old wording would have been false rather than merely imprecise.
  const around = h.around || 0;
  // OA-408. A `missed` run is one the scheduler fired and no tick ever wrote up,
  // so "done nothing" stays true of it; what the title adds is that the cause is
  // in the scheduler's own record, which the `-missed` file quotes.
  const missed = h.missed || 0;
  const missedClause = missed ? `, ${missed} of them leaving no run file of their own` : '';
  const title = !idling
    ? 'The scheduled loop is halted by `loop/STOP`'
    : around
      ? `The scheduled loop has fired ${h.idle} time${h.idle === 1 ? '' : 's'} without reaching its own queue — ${around} of them worked around the bar rather than clearing it${missedClause} (last tick ${hhmm(h.lastAt)}, ${ago(h.ageMin)} ago)`
      : `The scheduled loop has fired ${h.idle} time${h.idle === 1 ? '' : 's'} and done nothing${missedClause} (last tick ${hhmm(h.lastAt)}, ${ago(h.ageMin)} ago)`;

  return [{
    key: 'loop-idle', rank, type: 'loop-health',
    title,
    why: `${causes.join(' Also: ')}${around ? `  ${around} of those ${h.idle} tick${h.idle === 1 ? '' : 's'} found work in a tree the bar left open and named itself \`-around\`, so the count below measures how long the queue has been out of reach rather than how idle the loop has been.` : ''}${missed ? `  ${missed} of those ${h.idle} run${h.idle === 1 ? '' : 's'} never reached a prompt: the scheduler fired ${missed === 1 ? 'it' : 'them'}, no tick wrote a file, and a later tick recorded ${missed === 1 ? 'it' : 'each'} as \`-missed\` with the scheduler's own status and message — read ${missed === 1 ? 'that file' : 'those files'} for the cause, which no tree state explains.` : ''}${h.lastWorkingAt ? `  The last tick that finished a unit of work was ${hhmm(h.lastWorkingAt)}.` : ''} Each stopped tick still wrote a file in \`loop/runs/\` saying why; this row exists because nothing read them.`,
    who: 'Peter', runbook: 'loop',
    ageDays: h.ageMin == null ? null : Math.floor(h.ageMin / 1440),
    idle: h.idle, around, missed, cadenceMin: h.cadence,
    do: [
      ...(treeDirty ? [{ kind: 'shell', cwd: busesDir, cmd: 'git status --porcelain', note: 'commit or revert what this names, and the next tick runs' }] : []),
      ...(stopFile ? [{ kind: 'shell', cwd: busesDir, cmd: 'rm -f loop/STOP', note: 'only when you actually want the loop back' }] : []),
      { kind: 'chat', what: 'The newest file in loop/runs/ is that tick\'s own account of why it stopped — open it if the causes above do not explain it.' },
    ],
  }];
}

/**
 * Is the silence long enough to be worth reading the transcripts for? The board
 * asks this first, so `readSessionTurns` costs nothing on a working loop.
 */
export function silenceOld(health, minSlots = 3) {
  const h = health || {};
  if (h.ran && h.dueAt) return h.dueAt.length >= Math.min(minSlots, SCHEDULED_SLOTS);
  return !!(h.ran && h.ageMin != null && h.cadence && h.ageMin >= minSlots * h.cadence);
}

/**
 * Late fires that must each have seen a session before the silent row is raised,
 * when the schedule is known (OA-608). Two, not three: at three a day, three would
 * be a whole day of silence, and one would cry wolf on the morning the app opens a
 * minute before the catch-up tick writes its file.
 */
export const SCHEDULED_SLOTS = 2;

/**
 * The cadence-long slots after the newest run file that hold at least one
 * session turn — slot 1 is the first one the next tick was due to END, so a
 * turn inside the first cadence counts for nothing. Sorted slot numbers.
 */
export function silentSlots({ health, turns }) {
  const h = health || {};
  if (h.ran && h.dueAt) {
    // Slot k runs from the k-th late fire to the next one (or now): a turn in it
    // says the app was open after a fire that wrote no run file.
    const seen = new Set();
    for (const t of turns || []) {
      const k = h.dueAt.filter((f) => f <= t).length;
      if (k >= 1) seen.add(k);
    }
    return [...seen].sort((a, b) => a - b);
  }
  if (!h.ran || !h.cadence) return [];
  const slotMs = h.cadence * 60000;
  const seen = new Set();
  for (const t of turns || []) {
    const k = Math.floor((t - h.lastAt) / slotMs);
    if (k >= 1) seen.add(k);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * The silent-loop row (buses-data OA-408 item 3): no run file for `minSlots`
 * cadences while sessions were active. A CHORE — rank 8, never a red — because
 * the evidence is circumstantial: a session at a prompt is not proof the
 * scheduler could have fired, and Peter ruled that a false alarm is the price.
 */
export function loopSilentItems({ health, turns, readTurns, minSlots = 3 }) {
  const h = health || {};
  if (!silenceOld(h, minSlots)) return [];
  // `readTurns` is `concurrency.mjs`'s `readSessionTurns`, passed in so this
  // module still opens nothing and a working loop never reaches the read.
  const slots = silentSlots({ health: h, turns: turns || (readTurns ? readTurns({ since: h.lastAt }) : []) });
  const sched = !!h.dueAt;
  if (slots.length < (sched ? Math.min(minSlots, SCHEDULED_SLOTS) : minSlots)) return [];
  return [{
    key: 'loop-silent', rank: 8, type: 'loop-health',
    title: sched
      ? `The scheduled loop has written no run file for ${ago(h.ageMin)} (last tick ${hhmm(h.lastAt)}), though sessions were working after ${slots.length} of the ${h.dueAt.length} scheduled runs since`
      : `The scheduled loop has written no run file for ${ago(h.ageMin)} (last tick ${hhmm(h.lastAt)}), though sessions were working in ${slots.length} of the ${Math.floor(h.ageMin / h.cadence)} cadences since`,
    why: `${sched ? `The loop is scheduled at ${scheduleText(h.schedule)} (loop/README.md's cron line), and ${h.dueAt.length} of those runs have fallen due since the last tick with no run file.` : `The loop's cadence is ${h.cadence} min, measured from the run filenames.`} A stale newest run is normal while the desktop app is shut, so it raises nothing by itself; this row is raised because session transcripts show the app open ${sched ? `after ${slots.length} separate scheduled runs that wrote nothing` : `in ${slots.length} separate ${h.cadence}-minute slots after the last tick, and no tick wrote a file in any of them`}. Either the scheduler did not fire, or it fired and each run died before its prompt (a session limit, a crash) — the scheduler's own run list for \`bus-loop\` says which. A chore, not a fault: a session sitting at a prompt is weak evidence, and Peter chose a false alarm over silence (OA-408, 2026-09-21).`,
    who: 'Peter', runbook: 'loop',
    ageDays: Math.floor(h.ageMin / 1440),
    silentSlots: slots.length, cadenceMin: h.cadence,
    do: [
      { kind: 'chat', what: 'Open the scheduled task bus-loop in the desktop app and read its recent runs: a run with an error message is a -missed tick; no runs at all means the schedule is off.' },
    ],
  }];
}
