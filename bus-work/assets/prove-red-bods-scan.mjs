#!/usr/bin/env node
/* Prove the BODS-scan source can raise a row AND stay quiet (buses-data OA-402,
 * R9 of the process review, 2026-09-18).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-bods-scan.mjs
 *
 * Written to the same shape as prove-red-deploy-pending.mjs: every case is a
 * PAIR, because appearing is only half of it.
 *
 * A row that never fires is the failure this source exists to prevent, and it is
 * the more dangerous half here than anywhere else on the board — a stale scan and
 * a quiet month produce exactly the same picture, so a source that silently never
 * raises reads as good news for ever. A row that never STOPS is the failure it
 * could introduce: a chore that fires every month by design is the column
 * everybody learns to ignore, which is the argument OA-091 already made about
 * FEED-STALE.
 *
 * No `_gtfs` folder and no clock: `readScanState()` takes its directory reader as
 * an argument and `bodsScanItems()` takes `now`, so every threshold below is
 * exact rather than "run this before the end of the month".
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readScanState, bodsScanItems, defaultReadScanDates, daysSinceIso, CADENCE_DAYS, GRACE_DAYS } from './bods_scan.mjs';

let bad = 0, ran = 0;
const check = (label, ok, detail) => { ran++; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };

const DAY = 86400000;
/* A fixed clock: 2026-10-05T00:00:00Z. Every age below is computed from it, and
 * no case anywhere in this file uses today's date -- OA-289's rule. */
const NOW = Date.parse('2026-10-05T00:00:00Z');
const ago = (days) => new Date(NOW - days * DAY).toISOString().slice(0, 10);

/* A reader stub keyed on the folder the source actually asks for, so a wrong
 * question returns null (read as "no folder") rather than something plausible. */
const readerFor = (dates) => {
  const asked = [];
  const read = (dir) => { asked.push(dir); return dates; };
  return { read, asked };
};

console.log('\n1. The scan is current: nothing is raised at all');
{
  const { read } = readerFor([ago(60), ago(30), ago(4)]);
  const st = readScanState({ busesDir: 'C:/anywhere', readScanDates: read });
  check('state is ok and names the NEWEST report', st.status === 'ok' && st.newest === ago(4), JSON.stringify(st.newest));
  const out = bodsScanItems(st, { now: NOW });
  check('no row and no warning for a 4-day-old scan', out.items.length === 0 && out.warnings.length === 0, JSON.stringify(out));
}

console.log('\n2. The scan is overdue: the row fires, and it is dated from the report');
{
  const { read } = readerFor([ago(65), ago(35)]);
  const st = readScanState({ busesDir: 'C:/anywhere', readScanDates: read });
  const out = bodsScanItems(st, { now: NOW });
  check('exactly one row', out.items.length === 1, JSON.stringify(out.items.map((i) => i.key)));
  const row = out.items[0] || {};
  check('keyed bods-scan-overdue at rank 4', row.key === 'bods-scan-overdue' && row.rank === 4, `${row.key} / ${row.rank}`);
  check('its age is the report\'s age in days, not the folder\'s mtime', row.ageDays === 35, String(row.ageDays));
  check('the title names the newest report\'s date, so the reader can check it', String(row.title).includes(ago(35)), row.title);
  check('the clearing step runs the WHOLE monthly job, not just gtfs_upcoming.py', /refresh-bus-data\.ps1/.test(JSON.stringify(row.do)), JSON.stringify(row.do));
  check('and it passes -Unattended, so the fix does not end in a dialog nobody is there to click', /-Unattended/.test(JSON.stringify(row.do)), JSON.stringify(row.do));
}

console.log('\n3. The threshold, from both sides, one day apart');
{
  const due = CADENCE_DAYS + GRACE_DAYS;
  const at = (days) => bodsScanItems(readScanState({ busesDir: 'C:/x', readScanDates: readerFor([ago(days)]).read }), { now: NOW }).items.length;
  check(`a scan exactly ${due} days old is still quiet — a month that slips a day is not a fault`, at(due) === 0, String(at(due)));
  check(`a scan ${due + 1} days old raises the row`, at(due + 1) === 1, String(at(due + 1)));
  check('and the boundary is the CONSTANTS, not the literal 34 — a case that agreed with whatever the file said would prove nothing', due === 34, String(due));
}

console.log('\n4. The scan has NEVER run: a different row, because that is a different sentence');
{
  const { read } = readerFor([]);
  const st = readScanState({ busesDir: 'C:/anywhere', readScanDates: read });
  check('state is none, not ok-with-no-newest', st.status === 'none', st.status);
  const out = bodsScanItems(st, { now: NOW });
  check('one row, keyed bods-scan-never', out.items.length === 1 && out.items[0].key === 'bods-scan-never', JSON.stringify(out.items.map((i) => i.key)));
  check('with no age, because there is no report to date it from', out.items[0].ageDays === null, String(out.items[0].ageDays));
  check('and the why says the feed is empty because its SOURCE is, not because the month was quiet', /quiet month/.test(out.items[0].why), out.items[0].why);
}

console.log('\n5. A tree with no _gtfs at all: a warning, never a row');
{
  const st = readScanState({ busesDir: 'C:/anywhere', readScanDates: () => null });
  check('state is no-dir', st.status === 'no-dir', st.status);
  const out = bodsScanItems(st, { now: NOW });
  check('no row — a CI runner or a fresh clone is the wrong machine to ask for a monthly scan', out.items.length === 0, JSON.stringify(out.items));
  check('but it says so, rather than reading as a healthy tree', out.warnings.length === 1 && /does not carry the BODS feeds/.test(out.warnings[0]), JSON.stringify(out.warnings));
}

console.log('\n6. Two things it refuses to guess about');
{
  const future = bodsScanItems(readScanState({ busesDir: 'C:/x', readScanDates: readerFor([ago(-10)]).read }), { now: NOW });
  check('a report dated in the FUTURE raises nothing and names the ambiguity', future.items.length === 0 && /in the future/.test(future.warnings[0] || ''), JSON.stringify(future));
  const junk = bodsScanItems({ status: 'ok', dir: 'x', newest: 'not-a-date', dates: ['not-a-date'] }, { now: NOW });
  check('an unparseable date raises nothing and says which string beat it', junk.items.length === 0 && /not-a-date/.test(junk.warnings[0] || ''), JSON.stringify(junk));
  const unknown = bodsScanItems({ status: 'weather' }, { now: NOW });
  check('an unknown state raises nothing and names itself', unknown.items.length === 0 && /weather/.test(unknown.warnings[0] || ''), JSON.stringify(unknown));
  check('and no state at all is simply silent', bodsScanItems(null, { now: NOW }).items.length === 0);
}

console.log('\n7. It reads the FILENAMES and opens no report');
{
  const { read, asked } = readerFor([ago(2)]);
  readScanState({ busesDir: 'C:/x', readScanDates: read });
  check('exactly one directory is asked for', asked.length === 1, JSON.stringify(asked));
  check('and it is _gtfs/upcoming under the buses dir', /_gtfs[\\/]upcoming$/.test(asked[0]), asked[0]);
}

console.log('\n8. The real reader, against a folder that does not exist and one that does');
{
  check('a missing folder reads null, which is no-dir and not an empty estate', defaultReadScanDates('C:/definitely/not/a/gtfs/folder') === null);
  /* fileURLToPath, not `new URL('.', import.meta.url).pathname`: this tree lives
   * under a path with a SPACE in it, which the latter percent-encodes, so
   * existsSync() says no and this case reads `null` — indistinguishable from the
   * missing-folder case above, which is to say the two assertions would agree
   * with each other and with nothing. The same trap prove-red-deploy-pending.mjs
   * records in its own header, met again here on the first run. */
  const here = defaultReadScanDates(path.dirname(fileURLToPath(import.meta.url)));
  check('a real folder with no upcoming-report_*.md files reads as EMPTY, not as null', Array.isArray(here) && here.length === 0, JSON.stringify(here));
}

console.log('\n9. The mutation arm: the two ways this source could be quietly wrong');
{
  /* (a) A source that sorted the report dates as anything but strings-ascending
   * would name the wrong newest. ISO dates sort correctly as strings and that is
   * the whole reason the filenames carry them; a source that trusted readdir's
   * own order would pass every case above, because they are already sorted. */
  const shuffled = readScanState({ busesDir: 'C:/x', readScanDates: () => [ago(4), ago(65), ago(35)] });
  check('(a) an out-of-order listing still names the newest report, so nothing depends on readdir\'s order', shuffled.newest === ago(4), shuffled.newest);
  check('    and therefore stays quiet, where trusting the listing would have raised a 35-day row', bodsScanItems(shuffled, { now: NOW }).items.length === 0);

  /* (b) A source that measured age from the count of reports, or from the oldest,
   * rather than from the newest date, would fire on a busy month and sleep
   * through a dead one. Two populations with the SAME size and opposite verdicts. */
  const busy = bodsScanItems(readScanState({ busesDir: 'C:/x', readScanDates: () => [ago(80), ago(70), ago(1)] }), { now: NOW });
  const dead = bodsScanItems(readScanState({ busesDir: 'C:/x', readScanDates: () => [ago(80), ago(70), ago(60)] }), { now: NOW });
  check('(b) three reports ending yesterday: quiet', busy.items.length === 0, JSON.stringify(busy.items));
  check('    three reports ending 60 days ago: a row — so the verdict is the NEWEST date and not the count', dead.items.length === 1, JSON.stringify(dead.items));

  check('daysSinceIso is whole days and returns null on junk', daysSinceIso(ago(7), NOW) === 7 && daysSinceIso('rubbish', NOW) === null);
}

console.log('');
if (bad) {
  console.log(`FAILED — ${bad} of ${ran} assertions did not hold: the BODS-scan row is not what bods_scan.mjs says it is.`);
  process.exitCode = 1;
} else {
  console.log(`OK — all ${ran} assertions held: a scan past a month plus its grace is a rank-4 row naming the whole monthly job, a scan inside it is silent, a scan that never ran is its own sentence, a tree with no feeds is a warning rather than a row, and the verdict reads the newest report's DATE rather than the listing's order or its length.`);
}
