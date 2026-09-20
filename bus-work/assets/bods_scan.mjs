/*
 * bods_scan.mjs — the monthly BODS scan itself did not fire, as a worklist row
 * (buses-data OA-402, R9 of the process review of 2026-09-17).
 *
 * WHY THIS EXISTS, AND IT IS NOT THE ROW YOU MIGHT EXPECT. `worklist.mjs` already
 * turns the newest `_gtfs/upcoming/upcoming-report_<date>.md` into one refresh row
 * per affected map. Every one of those rows is a JOIN on that report, so all of
 * them — and therefore the whole monthly refresh — are downstream of one fact
 * nothing asks about: **whether the scan that writes the report ran at all.**
 *
 * The scan is the Windows Scheduled Task "Refresh Cambridgeshire bus data", which
 * runs `_gtfs/refresh-bus-data.ps1` monthly: download each built region's BODS zip,
 * rebuild its sqlite, diff every built town, then run `gtfs_upcoming.py` and the
 * portal's `check-upcoming`. If that task is disabled, fails before the scan step,
 * or blocks on its own dialog, the newest report simply stays where it was — and
 * the board goes on printing refresh rows against it, or none, with no more alarm
 * than a genuinely quiet month gives. **A stale scan and a quiet month are the same
 * picture**, which is this repository's own named shape and the exact fault
 * `gtfs_upcoming.py`'s siblings have already paid for once: both monthly scripts
 * looked for towns at `<root>/<Town>` instead of `<root>/Areas/<Town>`, skipped
 * every town silently and printed a clean, confident, empty report every month for
 * as long as the path was wrong (see make-bus-leaflet/references/gotchas.md).
 *
 * Until 2026-09-18 the ONE signal that the monthly job had happened was the
 * centre-screen dialog the script pops at the end — which is to say, a human
 * touch, in the first step of the process R9 is making unattended. Measured on the
 * 2026-09-01 run: the log's last two lines are 29 seconds apart, and those 29
 * seconds are Peter clicking. That dialog is now suppressible (`-Unattended`), so
 * the signal has to live somewhere a person does not have to be present for. This
 * is that somewhere.
 *
 * WHAT IT READS. One directory listing of `_gtfs/upcoming/` — the report FILENAMES
 * and nothing else. No report is ever opened. That is deliberate and it is the same
 * reasoning `loop_runs.mjs` gives for reading `loop/runs/` by name: the reports are
 * generated prose, and a reader that depended on their wording would break the
 * first time the generator phrased something differently. The date is in the name.
 *
 * WHY THE THRESHOLD IS A CONSTANT AND NOT A MEASURED CADENCE. `loop_runs.mjs`
 * derives the loop's interval from the median gap between its own run files,
 * because the loop fires hourly and its files are all it has. That technique is
 * WRONG here and was tried first: the reports on disk on 2026-09-18 are dated
 * 07-14, 07-27, 08-01, 08-31 and 09-01, whose gaps are 13, 5, 30 and 1 days — a
 * median of 9, because a scan can also be run BY HAND at any time and four of those
 * five are. A cadence inferred from a population that mixes a schedule with ad-hoc
 * runs measures neither. The schedule is monthly by construction, so the threshold
 * is a month plus a grace, and the grace is what stops the row firing on the
 * ordinary 31-day month that lands a day late.
 *
 * WHAT IT DOES NOT DO. It never runs the scan, never fetches, never reddens. A
 * scan being overdue is a CHORE in R3's sense — the board prints it and exits 0 —
 * so it is a row, at a rank, and the row names the one command that clears it.
 *
 * PURE CORE, INJECTED EDGES, like `deploy_pending.mjs` and `ci_state.mjs`:
 * `readScanState()` is the only thing that touches the disk and takes its reader as
 * an argument, and `bodsScanItems()` is a function of that state and a clock. That
 * is what lets `prove-red-bods-scan.mjs` falsify every verdict with no `_gtfs`
 * folder at all.
 *
 * Zero dependencies (Node core only), matching worklist.mjs.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveBuses } from './engine.mjs';

/**
 * A calendar month plus a grace. The scheduled task fires on the 1st, so the
 * longest legitimate gap between two consecutive scheduled scans is 31 days
 * (1 January to 1 February is 31, and a task that slips to the 2nd makes it 32).
 * The row therefore starts asking on day 34, which is early in the month AFTER
 * the one that was missed and late enough that no ordinary slip reaches it.
 */
export const CADENCE_DAYS = 31;
export const GRACE_DAYS = 3;

const REPORT_RE = /^upcoming-report_(\d{4}-\d{2}-\d{2})\.md$/;

/** The default disk read: the report dates under `_gtfs/upcoming/`, ascending. */
export const defaultReadScanDates = (dir) => {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .map((f) => (f.match(REPORT_RE) || [])[1])
    .filter(Boolean)
    .sort();
};

/**
 * Read the facts. Returns one of:
 *   { status: 'no-dir', dir }                — `_gtfs/upcoming/` does not exist here
 *   { status: 'none', dir }                  — the folder exists and holds no report
 *   { status: 'ok', dir, newest, dates }     — `newest` is the newest report's date, `dates` all of them
 *
 * `no-dir` and `none` are kept apart on purpose. A tree with no `_gtfs` at all is
 * a checkout that does not carry the feeds — a CI runner, a fresh clone, a
 * harness fixture — and asking it to run a monthly scan is asking the wrong
 * machine. A folder that exists and is empty is this laptop with the scan never
 * having run, which is a real thing to say out loud.
 */
export function readScanState({ busesDir, readScanDates = defaultReadScanDates } = {}) {
  const dir = path.join(busesDir || '.', '_gtfs', 'upcoming');
  const read = readScanDates(dir);
  if (read === null) return { status: 'no-dir', dir };
  /* SORTED HERE AND NOT ONLY IN THE READER, and the harness is what said so.
   * `defaultReadScanDates` sorts, so every case driven through it agrees with a
   * core that trusts the listing's order -- and `readdir` on Windows happens to
   * return these names in order, which is how a source that depends on it stays
   * green for ever. The moment the reader is stubbed, replaced, or reads a
   * folder the filesystem orders differently, the newest report is whichever
   * name came last, and naming the wrong newest is silently the WRONG VERDICT in
   * both directions. ISO dates sort correctly as strings, which is the whole
   * reason the filenames carry them. */
  const dates = [...read].sort();
  if (!dates.length) return { status: 'none', dir };
  return { status: 'ok', dir, newest: dates[dates.length - 1], dates };
}

/** Whole days from an ISO date to `now`, negative if the date is in the future. */
export const daysSinceIso = (iso, now) => {
  const t = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / 86400000);
};

/**
 * The row, or nothing, plus the warnings the worklist should print. `now` is
 * milliseconds.
 *
 * Rank 4 once overdue: below the rows where a real person is waiting (1 to 3) and
 * above the ordinary chores, because every refresh row in the whole list is
 * downstream of this one fact and a board that is confidently quiet about it is
 * worse than a board that is noisy.
 */
export function bodsScanItems(state, {
  now = Date.now(),
  cadenceDays = CADENCE_DAYS,
  graceDays = GRACE_DAYS,
  busesDir = resolveBuses(),
} = {}) {
  const items = [];
  const warnings = [];
  if (!state) return { items, warnings };

  const clears = [
    {
      kind: 'shell',
      cwd: busesDir,
      cmd: 'powershell -ExecutionPolicy Bypass -File "_gtfs/refresh-bus-data.ps1" -Unattended',
      note: 'the WHOLE monthly job — re-download each built region, rebuild its sqlite, diff every town, then scan for upcoming changes and flag the portal. `-Unattended` is what stops it ending in a dialog that waits for a click (OA-402).',
    },
    {
      kind: 'chat',
      what: 'If the scheduled task is switched off deliberately, say so here — nothing on disk records a deliberate pause, so this row will keep asking.',
    },
  ];

  if (state.status === 'no-dir') {
    warnings.push(`bods-scan: no ${state.dir} — this tree does not carry the BODS feeds, so nothing is asked of the monthly scan here.`);
    return { items, warnings };
  }

  if (state.status === 'none') {
    items.push({
      key: 'bods-scan-never',
      rank: 4,
      type: 'housekeeping',
      title: 'The BODS upcoming-changes scan has never run — there is no report for any refresh row to join to',
      why: 'Every `refresh` row on this board is a JOIN on the newest `_gtfs/upcoming/upcoming-report_<date>.md`, and there is none. That is not a quiet month: it is the whole refresh feed reading empty because its source has never been written.',
      who: '\u2014',
      runbook: 'R4',
      ageDays: null,
      do: clears,
    });
    return { items, warnings };
  }

  if (state.status !== 'ok') {
    warnings.push(`bods-scan: unknown state ${JSON.stringify(state.status)} — nothing raised.`);
    return { items, warnings };
  }

  const age = daysSinceIso(state.newest, now);
  if (age === null) {
    warnings.push(`bods-scan: the newest report names ${JSON.stringify(state.newest)}, which is not a date this can read — nothing raised.`);
    return { items, warnings };
  }
  if (age < 0) {
    warnings.push(`bods-scan: the newest report is dated ${state.newest}, which is in the future — a clock or a filename is wrong, and this row will not guess which.`);
    return { items, warnings };
  }

  const due = cadenceDays + graceDays;
  if (age <= due) return { items, warnings };

  items.push({
    key: 'bods-scan-overdue',
    rank: 4,
    type: 'housekeeping',
    title: `The monthly BODS scan has not run for ${age} days — newest report is ${state.newest}`,
    why: `The scheduled task writes one report a month and the newest is ${age} days old, past the ${due}-day threshold (a month plus a ${graceDays}-day grace). Every \`refresh\` row on this board joins to that report, so until it is re-run a board with no refresh rows means the scan is stale and NOT that the timetables are quiet — the two are the same picture, which is why this row exists.`,
    who: '\u2014',
    runbook: 'R4',
    ageDays: age,
    do: clears,
  });
  return { items, warnings };
}
