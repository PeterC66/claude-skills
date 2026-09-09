/*
 * loop_runs.mjs — is the scheduled loop actually DOING anything (buses-data
 * OA-288, 2026-09-09).
 *
 * THE THIRD FACT ABOUT THE LOOP, AND THE ONE NOTHING READ. OA-283 gave
 * `loop/blocked/` a reader and OA-287 gave `loop/LOCK.d` one. Between them they
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
 * stopped before dispatch. So the date, the time and the verdict are all in the
 * NAME: the measurement is a directory listing, and no run file is ever parsed.
 * That matters beyond speed — the run files are prose written by a fresh session
 * each hour, and a reader that depended on their wording would be a reader that
 * broke the first time a tick phrased something differently.
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
 * WHAT IT DELIBERATELY DOES NOT RAISE: a stale newest run on its own. The
 * scheduler only fires while the desktop app is open, and a task that falls due
 * while it is shut runs once on next launch — so "nothing since 01:15" is the
 * NORMAL state of every morning, and a row for it would cry wolf daily and be
 * muted inside a week. The row is raised by the loop FIRING and doing nothing,
 * which is unambiguous, or by a `loop/STOP` somebody may have forgotten. The age
 * of the last tick is reported inside the row rather than being a trigger of its
 * own.
 *
 * SILENCE IS A REQUIREMENT. `loop/` is gitignored apart from its README, so an
 * absent folder is the normal state in a fresh clone, in a worktree, in CI and in
 * every other harness's fixture — the named shape *the subject that does not
 * survive `actions/checkout`*. Absent, empty and unreadable each yield no row and
 * no warning, and `prove-red-loop-runs.mjs` proves that against real directories
 * because a fake reader cannot be absent.
 */
import { readdirSync, statSync } from 'node:fs';

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
    // loop_blocked.mjs carries the same note for the same reason.
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
 * @param {{runs: Array, now?: number, fallbackMin?: number}} p
 * @returns {{ran: boolean, lastAt, ageMin, cadence, idle: number, lastWorkingAt}}
 *   `idle` is the number of CONSECUTIVE most-recent ticks whose feed was `none`.
 */
export function loopHealth({ runs, now = Date.now(), fallbackMin = 60 }) {
  const list = (runs || []).slice();
  const cadence = cadenceMin(list, fallbackMin);
  if (!list.length) return { ran: false, lastAt: null, ageMin: null, cadence, idle: 0, lastWorkingAt: null };
  const last = list[list.length - 1];
  let idle = 0;
  for (let i = list.length - 1; i >= 0 && list[i].feed === 'none'; i--) idle++;
  const working = list.filter((r) => r.feed !== 'none');
  return {
    ran: true,
    lastAt: last.at,
    ageMin: Math.max(0, Math.round((now - last.at) / 60000)),
    cadence,
    idle,
    lastWorkingAt: working.length ? working[working.length - 1].at : null,
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

  const title = idling
    ? `The scheduled loop has fired ${h.idle} time${h.idle === 1 ? '' : 's'} and done nothing (last tick ${hhmm(h.lastAt)}, ${ago(h.ageMin)} ago)`
    : 'The scheduled loop is halted by `loop/STOP`';

  return [{
    key: 'loop-idle', rank, type: 'loop-health',
    title,
    why: `${causes.join(' Also: ')}${h.lastWorkingAt ? `  The last tick that finished a unit of work was ${hhmm(h.lastWorkingAt)}.` : ''} Each stopped tick still wrote a file in \`loop/runs/\` saying why; this row exists because nothing read them.`,
    who: 'Peter', runbook: 'loop',
    ageDays: h.ageMin == null ? null : Math.floor(h.ageMin / 1440),
    idle: h.idle, cadenceMin: h.cadence,
    do: [
      ...(treeDirty ? [{ kind: 'shell', cwd: busesDir, cmd: 'git status --porcelain', note: 'commit or revert what this names, and the next tick runs' }] : []),
      ...(stopFile ? [{ kind: 'shell', cwd: busesDir, cmd: 'rm -f loop/STOP', note: 'only when you actually want the loop back' }] : []),
      { kind: 'chat', what: 'The newest file in loop/runs/ is that tick\'s own account of why it stopped — open it if the causes above do not explain it.' },
    ],
  }];
}
