/*
 * refresh_deadline.mjs — when a refresh row's changes take effect, and whether the
 * loop can clear the refresh rows before they do (buses-data, 2026-10-08).
 *
 * WHY. Every refresh row on the worklist shares rank 5, so until now a town whose
 * timetable changes in four days sat behind one whose changes are a month away,
 * ordered by the scan's age — which is the same for every row from one scan, so in
 * practice by key, alphabetically. And since OA-577 moved the bus-loop to three ticks
 * a day (04:00, 13:00, 19:00), the queue's depth matters: a scan that lands ten
 * finishable refreshes with changes due in three days is nine units of work against
 * nine ticks, and nothing said so. This module answers both from facts already on
 * disk: the scan report's own dates, the ink review's record of what has been rebuilt
 * and staged, and the cadence sentence in the buses-data `loop/README.md`.
 *
 * THE DATE IS THE SCAN'S OWN, NEVER INFERRED. `gtfs_upcoming.py` writes a date into
 * exactly two kinds of line: a NEW or CHANGE service "registered to start <date>", and
 * an ENDS? service "registered only to <date>". A WITHDRAWN, DAYS, OPERATOR, APPEARED
 * or TIMETABLE line carries no date, so a section made only of those has none, and its
 * row sorts after every dated row of the same rank. A date in the past is kept: the
 * change is already running and the sheet is already wrong, which is the most urgent
 * row, not one to drop.
 *
 * WHAT A ROW STILL OWES A TICK. A refresh of a portal map is two units of unattended
 * work, the rebuild (`refresh_town.py`, through S5) and the staging (`stage_refresh.mjs`,
 * once the ink review lets the town through), each one tick. A local map with no portal
 * map has no staging, so one. The ink review for the row's scan says how far a map got:
 * staged this build is nothing owed; `deliver` is the staging alone; enrolled and
 * waiting on Peter's answer, held, or unreadable is a person's move and owes no tick.
 * A map the review does not list has not been rebuilt, so it owes everything.
 *
 * THE ARITHMETIC IS EARLIEST-DEADLINE-FIRST, which is the order the worklist now puts
 * the rows in and therefore the order ticks take them. The k-th row, cumulatively,
 * needs the units of rows 1..k done before its own date, and the ticks that fire
 * before that date are `perDay × days left` (none for a date today or past). The
 * shortfall is the worst of those differences; `/ticks <shortfall>` run now closes every
 * one of them, because each extra tick run now counts against every later deadline.
 * Checking only the earliest date would miss a pile-up on the second date, and
 * checking each date gives the earliest-date check for free as its first term.
 *
 * Pure: no disk, no clock. The callers read the files and pass today's date in.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DATED = /registered (?:to start|only to) (\d{4}-\d{2}-\d{2})\b/g;

/**
 * The earliest date in one scan-report section's body, from the bullet lines only,
 * or null when no bullet carries one.
 */
export function earliestEffective(body) {
  let best = null;
  for (const line of String(body || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('- ')) continue;
    for (const m of line.matchAll(DATED)) if (!best || m[1] < best) best = m[1];
  }
  return best;
}

/**
 * The worklist's row order. Demo rows last; then rank; then, inside one rank, a row
 * with an effective date before one without, and the sooner date first; then the
 * older row; then the key, so the order never depends on the order rows were added.
 */
export function compareRows(a, b) {
  return (a.demo ? 1 : 0) - (b.demo ? 1 : 0)
    || a.rank - b.rank
    || byEffective(a.effectiveDate, b.effectiveDate)
    || (b.ageDays || 0) - (a.ageDays || 0)
    || a.key.localeCompare(b.key);
}

function byEffective(x, y) {
  if (x && y) return x < y ? -1 : x > y ? 1 : 0;
  return x ? -1 : y ? 1 : 0;
}

/**
 * Ticks a day, read from the cadence sentence of the buses-data `loop/README.md`:
 * "(cron `0 4,13,19 * * *`". Only a fixed-minute, every-day cron whose hours are a
 * list or `*` (hourly) is counted; anything else is null and the caller falls back,
 * saying so.
 */
export function ticksPerDay(readme) {
  const m = /cron `(\d{1,2}) ([\d,]+|\*) \* \* \*`/.exec(String(readme || ''));
  if (!m) return null;
  if (m[2] === '*') return 24;
  const hours = new Set(m[2].split(',').filter(Boolean).map(Number));
  if (![...hours].every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) return null;
  return hours.size || null;
}

/**
 * Units of tick work a finishable refresh row still owes, from the ink review for its
 * scan (`{ maps: [...] }`, or null when none was written). `local` is a row with no
 * portal map, which is never staged.
 */
export function unitsOwed(review, mapName, { local = false } = {}) {
  const full = local ? 1 : 2;
  const want = String(mapName || '').toLowerCase();
  const m = review && Array.isArray(review.maps) ? review.maps.find((x) => String(x.map || '').toLowerCase() === want) : null;
  if (!m) return full;
  if (local) return 0;
  if (m.staged && m.staged.after === m.after) return 0;
  if (m.status === 'no-ink') return 1;
  if (m.status === 'ink-moved' && m.answer && m.answer.after === m.after && m.answer.verdict === 'accept') return 1;
  return 0;
}

const dayNumber = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

/**
 * Can `perDay` ticks a day clear these rows before their dates?
 *
 * @param {Array<{key:string, effectiveDate:string|null, units:number}>} rows  finishable rows
 * @param {{today:string, perDay:number}} o
 * @returns {{counted:number, units:number, undated:number, earliest:string|null, daysLeft:number|null,
 *            shortfall:number, worst:{key:string, date:string, need:number, have:number}|null, late:string[]}}
 *   `shortfall` is the number of extra ticks that, run now, clear every row in time; 0 is in time.
 */
export function deadlineShortfall(rows, { today, perDay }) {
  const owed = (rows || []).filter((r) => r && r.units > 0);
  const dated = owed.filter((r) => ISO.test(r.effectiveDate || '')).sort((a, b) => byEffective(a.effectiveDate, b.effectiveDate) || a.key.localeCompare(b.key));
  const out = { counted: dated.length, units: 0, undated: owed.length - dated.length, earliest: dated.length ? dated[0].effectiveDate : null, daysLeft: null, shortfall: 0, worst: null, late: [] };
  if (!dated.length) return out;
  out.daysLeft = dayNumber(out.earliest) - dayNumber(today);
  let need = 0;
  for (const r of dated) {
    need += r.units;
    const have = Math.max(0, dayNumber(r.effectiveDate) - dayNumber(today)) * perDay;
    if (have === 0) out.late.push(r.key);
    if (need - have > out.shortfall) { out.shortfall = need - have; out.worst = { key: r.key, date: r.effectiveDate, need, have }; }
  }
  out.units = need;
  return out;
}
