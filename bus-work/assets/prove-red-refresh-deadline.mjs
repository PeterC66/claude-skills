#!/usr/bin/env node
/*
 * prove-red-refresh-deadline.mjs — falsification harness for refresh_deadline.mjs:
 * the effective date the worklist orders refresh rows by, the order itself, and the
 * arithmetic loop_health.mjs uses to say whether the ticks can clear them in time.
 *
 * TWO HALVES, BECAUSE A GREEN SUITE THAT HAS NEVER BEEN SEEN RED PROVES NOTHING.
 * Part 1 runs the assertions against the real module. Part 2 breaks the module on
 * purpose, one line at a time, in a throwaway copy beside it, and requires the SAME
 * assertions to fail for each break. A mutation that leaves the suite green names an
 * assertion that cannot go red, and fails this harness.
 *
 * The module is pure, so every case is built facts: no disk, no clock, no network.
 * The scan lines are copied in the exact form `gtfs_upcoming.py` writes them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'refresh_deadline.mjs');

const SECTION = [
  '_region cambridgeshire_',
  '- **[CHANGE] A** — already running; service registered to start 2026-11-01 (31d away) [Daily], First Norfolk & Suffolk -> timetable changes then, re-check (newly registered this month)',
  '- **[CHANGE] 56** — already running; service registered to start 2026-10-14 (13d away) [Mon-Sat], Stagecoach East Midlands -> timetable changes then, re-check',
  '- **[ENDS?] 9** — registered only to 2026-10-09 (8d), Dews Coaches [Mon-Fri] - may withdraw / be seasonal / not yet re-registered - verify',
  '- **[DAYS] X2** — \'Mon-Fri\' -> \'Mon-Sat\'',
  'A note that is not a bullet: registered to start 2026-10-02 must not count.',
].join('\n');
const row = (key, rank, o = {}) => ({ key, rank, ageDays: 7, ...o });
const ink = (maps) => ({ schema: 1, scan: '2026-10-01', maps });

/** Every assertion, run against `m`. Returns the number that FAILED. */
function suite(m, verbose) {
  let bad = 0;
  const check = (name, cond) => { let ok = false; try { ok = !!cond(); } catch { ok = false; } if (ok) { if (verbose) console.log(`  ok  ${name}`); } else { bad++; if (verbose) console.error(`  ✗   ${name}`); } };
  const { earliestEffective, compareRows, ticksPerDay, unitsOwed, deadlineShortfall } = m;

  // 1. the date, from the scan's own two dated phrases and nothing else
  check('the earliest dated bullet wins, and an ENDS? line is a date', () => earliestEffective(SECTION) === '2026-10-09');
  check('a NEW/CHANGE "registered to start" line is a date', () => earliestEffective(SECTION.split('\n').filter((l) => !/ENDS\?/.test(l)).join('\n')) === '2026-10-14');
  check('a date in a line that is not a bullet is not read', () => earliestEffective('_x_\nregistered to start 2026-10-02\n- **[DAYS] X2** — a') === null);
  check('a section with no dated line has no date', () => earliestEffective('- **[WITHDRAWN] 101** — route no longer serves the town - verify\n- **[DAYS] C2** — \'Tue & Thu\' -> \'Thu\'') === null);
  check('a CRLF body reads the same', () => earliestEffective(SECTION.replace(/\n/g, '\r\n')) === '2026-10-09');
  check('nothing is no date, never a throw', () => earliestEffective(undefined) === null && earliestEffective('') === null);

  // 2. the worklist's order
  const sorted = (rows) => rows.slice().sort(compareRows).map((r) => r.key);
  check('inside rank 5, the sooner date comes first', () => sorted([row('refresh-b', 5, { effectiveDate: '2026-11-01' }), row('refresh-a', 5, { effectiveDate: '2026-10-04' })]).join() === 'refresh-a,refresh-b');
  check('a dated row comes before an undated one of the same rank, whatever its key', () => sorted([row('refresh-a', 5), row('refresh-z', 5, { effectiveDate: '2026-12-31' })]).join() === 'refresh-z,refresh-a');
  check('rank still decides first: a rank-4 row with no date beats a rank-5 row due tomorrow', () => sorted([row('refresh-a', 5, { effectiveDate: '2026-10-02' }), row('pub-x', 4)]).join() === 'pub-x,refresh-a');
  check('a demo row sorts below every real row', () => sorted([row('demo-x', 1, { demo: true }), row('refresh-a', 5, { effectiveDate: '2026-10-04' })]).join() === 'refresh-a,demo-x');
  check('with no dates the old order holds: older first, then key', () => sorted([row('b', 5, { ageDays: 1 }), row('c', 5, { ageDays: 9 }), row('a', 5, { ageDays: 1 })]).join() === 'c,a,b');
  check('the same date falls through to age, then key', () => sorted([row('refresh-b', 5, { effectiveDate: '2026-10-04' }), row('refresh-a', 5, { effectiveDate: '2026-10-04' })]).join() === 'refresh-a,refresh-b');

  // 3. the cadence, read from loop/README.md's sentence
  const readme = 'The cadence is three ticks a day, at 04:00, 13:00 and 19:00 local** (cron `0 4,13,19 * * *`, OA-577, Peter, 7 October 2026)';
  check('the README cron gives three ticks a day', () => ticksPerDay(readme) === 3);
  check('another list of hours is counted, not assumed', () => ticksPerDay('(cron `30 6,18 * * *`)') === 2);
  check('a repeated hour is one tick', () => ticksPerDay('cron `0 4,4,13 * * *`') === 2);
  check('an hourly cron is 24', () => ticksPerDay('cron `0 * * * *`') === 24);
  check('no cron, or one this cannot count, is null for the caller to fall back on', () => ticksPerDay('no schedule here') === null && ticksPerDay('cron `0 4 * * 1`') === null && ticksPerDay('cron `0 25 * * *`') === null);

  // 4. what a row still owes a tick, from the ink review for its scan
  check('a map the review does not list owes a rebuild and a staging', () => unitsOwed(ink([]), 'March') === 2 && unitsOwed(null, 'March') === 2);
  check('a local map owes the rebuild only, and nothing once the review lists it', () => unitsOwed(null, 'Chatteris', { local: true }) === 1 && unitsOwed(ink([{ map: 'Chatteris', status: 'ink-moved', after: 'v2' }]), 'Chatteris', { local: true }) === 0);
  check('a map staged for this build owes nothing', () => unitsOwed(ink([{ map: 'March', status: 'no-ink', after: 'v2', staged: { after: 'v2' } }]), 'March') === 0);
  check('a map staged for an OLDER build still owes its staging', () => unitsOwed(ink([{ map: 'March', status: 'no-ink', after: 'v3', staged: { after: 'v2' } }]), 'March') === 1);
  check('no-ink owes the staging alone', () => unitsOwed(ink([{ map: 'March', status: 'no-ink', after: 'v2' }]), 'March') === 1);
  check('ink moved and accepted for THIS build owes the staging', () => unitsOwed(ink([{ map: 'March', status: 'ink-moved', after: 'v2', answer: { verdict: 'accept', after: 'v2' } }]), 'March') === 1);
  check('ink moved and unanswered, answered for an older build, or held is a person\'s, no tick\'s', () => [
    { status: 'ink-moved', after: 'v2', answer: null },
    { status: 'ink-moved', after: 'v3', answer: { verdict: 'accept', after: 'v2' } },
    { status: 'ink-moved', after: 'v2', answer: { verdict: 'hold', after: 'v2' } },
    { status: 'unreadable', after: null },
  ].every((x) => unitsOwed(ink([{ map: 'March', ...x }]), 'March') === 0));
  check('the map is matched without regard to case', () => unitsOwed(ink([{ map: 'march', status: 'no-ink', after: 'v2' }]), 'March') === 1);

  // 5. the arithmetic: earliest deadline first against ticks a day
  const r = (key, effectiveDate, units = 2) => ({ key, effectiveDate, units });
  const T = '2026-10-03';
  const tight = deadlineShortfall([r('a', '2026-10-04'), r('b', '2026-10-04'), r('c', '2026-10-04')], { today: T, perDay: 3 });
  check('six units due tomorrow against three ticks is three short', () => tight.shortfall === 3 && tight.units === 6 && tight.counted === 3 && tight.earliest === '2026-10-04' && tight.daysLeft === 1);
  check('the worst deadline is named with what it needs and what it has', () => tight.worst.date === '2026-10-04' && tight.worst.need === 6 && tight.worst.have === 3);
  check('one row a week away is in time', () => deadlineShortfall([r('a', '2026-10-10')], { today: T, perDay: 3 }).shortfall === 0);
  check('more ticks a day closes the gap', () => deadlineShortfall([r('a', '2026-10-04'), r('b', '2026-10-04'), r('c', '2026-10-04')], { today: T, perDay: 6 }).shortfall === 0);
  const pile = deadlineShortfall([r('a', '2026-10-10', 2), r('b', '2026-10-05', 2), r('c', '2026-10-05', 2), r('d', '2026-10-05', 2)], { today: T, perDay: 3 });
  check('a pile-up on the earliest date is caught: 6 units due in 2 days against 6 ticks is in time, 8 is not', () => deadlineShortfall([r('b', '2026-10-05'), r('c', '2026-10-05'), r('d', '2026-10-05')], { today: T, perDay: 3 }).shortfall === 0 && deadlineShortfall([r('b', '2026-10-05'), r('c', '2026-10-05'), r('d', '2026-10-05'), r('e', '2026-10-05')], { today: T, perDay: 3 }).shortfall === 2);
  check('a LATER date is projected too: the earliest is in time and the second is short', () => {
    const x = deadlineShortfall([r('a', '2026-10-05', 2), r('b', '2026-10-06', 10)], { today: T, perDay: 3 });
    return x.shortfall === 3 && x.worst.key === 'b' && x.worst.need === 12 && x.worst.have === 9;
  });
  check('rows are taken in date order whatever order they arrive in', () => { const x = deadlineShortfall([r('a', '2026-10-10', 20), r('b', '2026-10-04', 3)], { today: T, perDay: 3 }); return x.shortfall === 2 && x.worst.key === 'a'; });
  check('the arrival order is not the projection order for a later pile either', () => pile.shortfall === 0 && pile.worst === null && pile.units === 8);
  check('a date today has no tick left before it, and is late', () => { const x = deadlineShortfall([r('a', T, 1)], { today: T, perDay: 3 }); return x.shortfall === 1 && x.late.join() === 'a' && x.daysLeft === 0; });
  check('a date already past is late with no ticks, never a negative count', () => { const x = deadlineShortfall([r('a', '2026-09-30', 2)], { today: T, perDay: 3 }); return x.shortfall === 2 && x.worst.have === 0 && x.late.join() === 'a' && x.daysLeft === -3; });
  check('an undated row is counted apart and not projected', () => { const x = deadlineShortfall([r('a', null, 2), r('b', '2026-10-04', 2)], { today: T, perDay: 3 }); return x.undated === 1 && x.counted === 1 && x.units === 2 && x.shortfall === 0; });
  check('a row that owes nothing is not counted', () => { const x = deadlineShortfall([r('a', '2026-10-04', 0), r('b', '2026-10-04', 0)], { today: T, perDay: 3 }); return x.counted === 0 && x.shortfall === 0 && x.earliest === null; });
  check('no rows is in time, never a throw', () => deadlineShortfall([], { today: T, perDay: 3 }).shortfall === 0 && deadlineShortfall(null, { today: T, perDay: 3 }).counted === 0);
  check('the shortfall, run now, puts every deadline in time', () => {
    const rows = [r('a', '2026-10-04', 2), r('b', '2026-10-05', 5), r('c', '2026-10-08', 9), r('d', '2026-10-09', 1)];
    const x = deadlineShortfall(rows, { today: T, perDay: 3 });
    let need = 0; let ok = x.shortfall > 0;
    for (const y of rows.slice().sort((p, q) => p.effectiveDate.localeCompare(q.effectiveDate))) { need += y.units; const days = (Date.parse(y.effectiveDate) - Date.parse(T)) / 86400000; if (need > days * 3 + x.shortfall) ok = false; }
    return ok;
  });
  return bad;
}

async function load(file) {
  return import(`file://${file.replace(/\\/g, '/')}?v=${Math.random()}`);
}

console.log('\n1. the real module');
const badReal = suite(await load(SRC), true);
let failed = badReal;
if (badReal) console.error(`\n${badReal} assertion(s) failed against the real module`);

console.log('\n2. each mutation must turn the suite red');
const source = fs.readFileSync(SRC, 'utf8');
// Each `from` must occur EXACTLY once, or the mutation is not the line it claims to be.
const MUTANTS = [
  ['an ENDS? line is not a date', '(?:to start|only to)', '(?:to start)'],
  ['a line that is not a bullet is read', "if (!line.trim().startsWith('- ')) continue;", ''],
  ['the LATEST date is taken', 'if (!best || m[1] < best) best = m[1];', 'if (!best || m[1] > best) best = m[1];'],
  ['the order ignores the date', '|| byEffective(a.effectiveDate, b.effectiveDate)\n', '\n'],
  ['undated rows come first', 'return x ? -1 : y ? 1 : 0;', 'return x ? 1 : y ? -1 : 0;'],
  ['the date outranks the rank', '|| a.rank - b.rank\n    || byEffective(a.effectiveDate, b.effectiveDate)', '|| byEffective(a.effectiveDate, b.effectiveDate)\n    || a.rank - b.rank'],
  ['demo rows are not last', '(a.demo ? 1 : 0) - (b.demo ? 1 : 0)', '0'],
  ['the cadence is assumed, not read', 'return hours.size || null;', 'return 3;'],
  ['a repeated hour counts twice', "const hours = new Set(m[2].split(',')", "const hours = (m[2].split(',')"],
  ['an hour past 23 is counted', 'h >= 0 && h <= 23', 'h >= 0'],
  ['hourly is not counted', "if (m[2] === '*') return 24;", "if (m[2] === '*') return null;"],
  ['a staging is ignored', 'if (m.staged && m.staged.after === m.after) return 0;', ''],
  ['a staging of an older build counts', 'if (m.staged && m.staged.after === m.after) return 0;', 'if (m.staged) return 0;'],
  ['an answer for an older build counts', "m.answer && m.answer.after === m.after && m.answer.verdict === 'accept'", "m.answer && m.answer.verdict === 'accept'"],
  ['a held map owes a tick', "if (m.status === 'ink-moved' && m.answer && m.answer.after === m.after && m.answer.verdict === 'accept') return 1;\n  return 0;", "return 1;"],
  ['no-ink owes nothing', "if (m.status === 'no-ink') return 1;", ''],
  ['a local map owes a staging', 'const full = local ? 1 : 2;', 'const full = 2;'],
  ['a rebuilt local map still owes its rebuild', 'if (local) return 0;', 'if (local) return 1;'],
  ['the map name is matched with case', "String(x.map || '').toLowerCase() === want", 'String(x.map || \'\') === mapName'],
  ['only the earliest date is projected', 'for (const r of dated) {', 'for (const r of dated.slice(0, 1)) {'],
  ['a past date gets ticks', 'Math.max(0, dayNumber(r.effectiveDate) - dayNumber(today)) * perDay', 'Math.abs(dayNumber(r.effectiveDate) - dayNumber(today)) * perDay'],
  ['a tick fires on the day itself', 'Math.max(0, dayNumber(r.effectiveDate) - dayNumber(today)) * perDay', 'Math.max(0, dayNumber(r.effectiveDate) - dayNumber(today) + 1) * perDay'],
  ['a row owing nothing is counted', '.filter((r) => r && r.units > 0)', '.filter((r) => r)'],
  ['rows are projected in arrival order', '.sort((a, b) => byEffective(a.effectiveDate, b.effectiveDate) || a.key.localeCompare(b.key));', ';'],
  ['a late row is not named', 'if (have === 0) out.late.push(r.key);', ''],
];
for (const [name, from, to] of MUTANTS) {
  const n = source.split(from).length - 1;
  if (n !== 1) { failed++; console.error(`  ✗   mutation "${name}": its target occurs ${n} times, not once, so it tests nothing`); continue; }
  const file = path.join(HERE, `.refresh_deadline.mutant-${process.pid}.mjs`);
  fs.writeFileSync(file, source.replace(from, to));
  let bad = 0;
  try { bad = suite(await load(file), false); } catch { bad = 1; } finally { fs.rmSync(file, { force: true }); }
  if (bad > 0) console.log(`  ok  "${name}" turns ${bad} assertion(s) red`);
  else { failed++; console.error(`  ✗   mutation "${name}" left the suite green: an assertion that cannot go red`); }
}

console.log(failed ? `\nFAILED (${failed})` : '\nall refresh_deadline assertions hold, and every mutation is caught');
process.exitCode = failed ? 1 : 0;
