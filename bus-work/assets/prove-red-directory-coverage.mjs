#!/usr/bin/env node
/* Prove the coverage-gate freshness row appears, names the right authorities,
 * and — far more importantly — GOES AWAY (buses-data OA-317, 2026-09-12).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-directory-coverage.mjs
 *
 * WHAT IS BEING FALSIFIED. One row that asks a person to re-read the council
 * pages `coverage.mjs --check` answers out of. On the day it was written the
 * whole directory had been read 1 day earlier, so the row is SILENT — and a
 * silent check is indistinguishable from a check that does nothing. That is the
 * shape this repository has already paid for twice, as *the count that equalled
 * the total* and as *the subject you named yourself*, so section 1 is a control
 * before anything else, and section 4 is the boundary either side of the cadence.
 *
 * TWO FAULTS IT MUST NOT REPORT, AND BOTH ARE ASSERTED AS SILENCE. An `lta`
 * naming no directory row, and a register that will not parse, are already faults
 * of `coverage.mjs --check`, which runs in buses-data's `gates.yml`. One fault
 * printed twice under two names is worse than one — the rule `check-s6-claims.mjs`
 * states for its own silence check — so sections 6 and 7 hold this module quiet on
 * both, each paired with a control proving the quiet is about THAT state and not
 * about the module being broken.
 *
 * THE CLOCK IS INJECTED, never read. `directoryCoverageItems` takes `now`, so
 * "89 days quiet, 90 days loud" is an assertion rather than something that happens
 * to be true this afternoon — and nothing here can start failing on a calendar,
 * which is the fault OA-289 took out of the backlog index and the reason this row
 * is on the board rather than in CI.
 *
 * THE JOIN IS ASSERTED DIRECTLY, not only through the row. `gateBearingAuthorities`
 * is exported for that reason: the join is the half that can silently narrow, and
 * a row that looks right while reading one authority out of two would pass every
 * assertion made about its prose.
 *
 * ITS SUBJECT SURVIVES actions/checkout on the buses-data side — both files are
 * tracked — but the checkout HERE is claude-skills, which holds neither, so every
 * case below builds its own folder under the temp dir and the last section's join
 * against the real data is skipped out loud when buses-data cannot be found.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCoverageState, directoryCoverageItems, gateBearingAuthorities, REREAD_DAYS } from './directory_coverage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-directory-coverage-'));
const NOW = Date.UTC(2026, 11, 20, 12, 0);                       // 2026-12-20
const dayStamp = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

/**
 * Build a bus-map-directory folder.
 * `rows` are directory.json rows; `maps` are existing-coverage.json entries.
 * `data: false` means no directory.json; `coverage: false` means no register.
 */
const mkDir = (label, { data = true, coverage = true, rows = undefined, maps = undefined } = {}) => {
  const dir = path.join(tmp, label);
  fs.mkdirSync(dir, { recursive: true });
  if (data) {
    fs.writeFileSync(path.join(dir, 'directory.json'), typeof rows === 'string' ? rows : JSON.stringify({ rows: rows || [row('A Council', 200)] }), 'utf8');
  }
  if (coverage) {
    fs.writeFileSync(path.join(dir, 'existing-coverage.json'), typeof maps === 'string' ? maps : JSON.stringify({ maps: maps || [entry('Areas/Anytown', 'A Council')] }), 'utf8');
  }
  return dir;
};
const row = (lta, agedDays, extra = {}) => ({
  lta,
  networkMap: { status: 'yes', url: `https://${lta.replace(/\W+/g, '').toLowerCase()}.example/map`, format: 'pdf', dated: '2025-04' },
  townMaps: { status: 'no' },
  landingPage: `https://${lta.replace(/\W+/g, '').toLowerCase()}.example/buses`,
  checked: agedDays === null ? undefined : dayStamp(agedDays),
  ...extra,
});
const entry = (map, lta) => ({ map, town: map.split('/').pop(), lta, grade: 'area-only', decision: 'build', reason: 'x', decidedOn: '2026-09-11' });
const items = (dir, now = NOW) => directoryCoverageItems({ state: readCoverageState(dir), now });

console.log('\n1. no directory in this tree — silence, and the CONTROL that proves it is not silence everywhere');
{
  check('a folder that does not exist raises nothing', items(path.join(tmp, 'nope')).length === 0);
  check('an empty folder raises nothing', items(mkDir('empty', { data: false, coverage: false })).length === 0);
  check('directory.json alone, no register, raises nothing', items(mkDir('nodreg', { coverage: false })).length === 0);
  // THE CONTROL. Without it every assertion in this file is satisfied by a
  // function that returns []. The only difference from 'nodreg' is the register,
  // and the only difference from a green tree is the age of one date.
  check('MUTATION CONTROL — both files, one stale row, raises exactly one', items(mkDir('trigger', { rows: [row('A Council', 200)] })).length === 1);
  check('…and it is the reread row', items(mkDir('trigger2', { rows: [row('A Council', 200)] }))[0].key === 'directory-coverage-reread');
}

console.log('\n2. THE CONTROL THAT MATTERS MOST — a recently read authority says nothing');
{
  check('read today, nothing', items(mkDir('today', { rows: [row('A Council', 0)] })).length === 0);
  check('read 1 day ago, nothing — the state on the day this was written', items(mkDir('yesterday', { rows: [row('A Council', 1)] })).length === 0);
  check(`${REREAD_DAYS - 1} days — still quiet`, items(mkDir('day89', { rows: [row('A Council', REREAD_DAYS - 1)] })).length === 0);
  check(`${REREAD_DAYS} days — raises`, items(mkDir('day90', { rows: [row('A Council', REREAD_DAYS)] })).length === 1);
  check('the cadence is the module\'s constant, not a literal here', REREAD_DAYS === 90, String(REREAD_DAYS));
  // And the caller can override it without the module ever reading the clock.
  const st = readCoverageState(mkDir('override', { rows: [row('A Council', 40)] }));
  check('a 30-day cadence would raise the same row', directoryCoverageItems({ state: st, now: NOW, rereadDays: 30 }).length === 1);
  check('a 365-day cadence would not', directoryCoverageItems({ state: st, now: NOW, rereadDays: 365 }).length === 0);
}

console.log('\n3. the row itself — what it says, and what it offers');
{
  const r = items(mkDir('says', {
    rows: [row('Bucks Council', 120), row('CPCA', 200), row('Unused Council', 900)],
    maps: [entry('Areas/Beaconsfield', 'Bucks Council'), entry('Areas/Beaconsfield/Places/Waitrose', 'Bucks Council'), entry('Areas/St Ives', 'CPCA')],
  }))[0];
  check('rank 8 — nobody is blocked by it', r.rank === 8, String(r.rank));
  check('title counts the authorities, not the maps', /^The 2 authorities the coverage gate depends on were last read up to 200 days ago$/.test(r.title), r.title);
  check('ageDays is the OLDEST of them, so the board sorts on the worst case', r.ageDays === 200, String(r.ageDays));
  check('why names how many of OUR maps hang on them', /^.*3 of our maps are graded against these 2 authorities/m.test(r.why), r.why);
  check('why says why the link sweep does not cover this', /proves a URL still resolves/.test(r.why), r.why);
  check('why says the gate is green because nobody looked', /green because nobody looked/.test(r.why));
  check('why states the 74-row decision rather than leaving it implicit', /other 74 rows are deliberately on no cadence/.test(r.why));
  check('detail names both authorities', r.detail.includes('Bucks Council') && r.detail.includes('CPCA'));
  check('detail gives each its own read-date', r.detail.includes(dayStamp(120)) && r.detail.includes(dayStamp(200)));
  check('detail gives each its landing page, which is what a person opens', r.detail.includes('https://buckscouncil.example/buses'));
  check('detail says what the directory currently CLAIMS, so a change is visible', /network map yes, town maps no/.test(r.detail));
  // THE NARROWING IS THE POINT. An authority no map is graded against is not on
  // this cadence, however old its row — that is the other 74.
  check('an authority NO map names is absent, however stale', !r.detail.includes('Unused Council'), r.detail);
  check('the oldest is listed first', r.detail.indexOf('CPCA') < r.detail.indexOf('Bucks Council'));
  check('it offers the re-render', r.do.some((d) => d.kind === 'shell' && d.cmd === 'node directory.mjs'));
  check('and the gate this row exists to feed', r.do.some((d) => d.kind === 'shell' && d.cmd === 'node coverage.mjs --check'));
  check('and says a WITHDRAWN map is a finding, never a blank', r.do.some((d) => /never leave it blank/.test(d.what || '')));
  check('and that a moved grade needs a fresh decision, not just a grade', r.do.some((d) => /the decision is the half no code can supply/.test(d.what || '')));
  check('every shell step runs in the directory folder', r.do.filter((d) => d.kind === 'shell').every((d) => d.cwd.endsWith('says')));
}

console.log('\n4. only ONE of the two is overdue — it is named and the fresh one is not');
{
  const r = items(mkDir('mixed', {
    rows: [row('Fresh Council', 5), row('Stale Council', 300)],
    maps: [entry('Areas/One', 'Fresh Council'), entry('Areas/Two', 'Stale Council')],
  }));
  check('one row', r.length === 1, String(r.length));
  check('title says ONE authority, singular', /^The 1 authority the coverage gate depends on was last read up to 300 days ago$/.test(r[0].title), r[0].title);
  check('detail names the stale one', r[0].detail.includes('Stale Council'));
  check('and NOT the fresh one — a row that renamed everything would be unreadable', !r[0].detail.includes('Fresh Council'), r[0].detail);
  check('the map count is the stale authority\'s alone', /1 of our maps are graded against this authority/.test(r[0].why), r[0].why);
}

console.log('\n5. CANNOT TELL is not FINE — a gate-bearing row with no readable date');
{
  // Every read below is guarded. A mutation that empties this row must produce a
  // REPORT rather than a stack trace: a harness that throws stops saying what
  // else it would have caught, which is the difference between a falsification
  // and a crash.
  const undatedRow = items(mkDir('undated', { rows: [row('A Council', null)] }));
  const u = undatedRow[0] || {};
  check('a missing checked date raises, though no cadence has elapsed', undatedRow.length === 1, String(undatedRow.length));
  check('the title says so rather than quoting a number', /has no readable read-date/.test(u.title || ''), u.title);
  check('ageDays is null rather than a fabricated 0', undatedRow.length === 1 && u.ageDays === null, String(u.ageDays));
  check('detail says NEVER in as many words', /last read NEVER/.test(u.detail || ''), u.detail);
  const junk = items(mkDir('junkdate', { rows: [row('A Council', 0, { checked: 'last spring' })] }));
  check('an unparseable date is CANNOT TELL, not a pass', junk.length === 1 && /no readable read-date/.test(junk[0].title), JSON.stringify(junk.map((x) => x.title)));
  check('an empty-string date is CANNOT TELL too', items(mkDir('emptydate', { rows: [row('A Council', 0, { checked: '   ' })] })).length === 1);
  // The undated one is listed FIRST even when another is older in days, because
  // "we do not know" outranks "we know and it is old".
  const both = items(mkDir('bothkinds', {
    rows: [row('Old Council', 400), row('Unknown Council', null)],
    maps: [entry('Areas/One', 'Old Council'), entry('Areas/Two', 'Unknown Council')],
  }))[0] || {};
  check('undated is named before merely old', String(both.detail).indexOf('Unknown Council') < String(both.detail).indexOf('Old Council') && String(both.detail).includes('Unknown Council'), both.detail);
  check('and the title is the cannot-tell one', /1 of the 2 authorities .* has no readable read-date/.test(both.title || ''), both.title);
}

console.log('\n6. SILENT ON PURPOSE — an lta naming no directory row is coverage.mjs --check\'s fault');
{
  const r = items(mkDir('badlta', {
    rows: [row('A Council', 0)],
    maps: [entry('Areas/One', 'A Council'), entry('Areas/Two', 'A Council That Does Not Exist')],
  }));
  check('no row here — one fault under one name', r.length === 0, JSON.stringify(r.map((x) => x.title)));
  // CONTROL: the same unmatched lta must not be able to SUPPRESS a real finding.
  const r2 = items(mkDir('badlta2', {
    rows: [row('A Council', 400)],
    maps: [entry('Areas/One', 'A Council'), entry('Areas/Two', 'A Council That Does Not Exist')],
  }));
  check('CONTROL — and it does not swallow the stale authority beside it', r2.length === 1 && r2[0].detail.includes('A Council'), JSON.stringify(r2.map((x) => x.title)));
  check('the phantom authority is not named in the row either', !r2[0].detail.includes('Does Not Exist'));
  check('a register with no maps[] at all is silent', items(mkDir('nomaps', { maps: [] })).length === 0);
  check('an entry with no lta is skipped, not counted', items(mkDir('noltafield', { rows: [row('A Council', 400)], maps: [{ map: 'Areas/One' }, entry('Areas/Two', 'A Council')] }))[0].why.includes('1 of our maps'));
}

console.log('\n7. SILENT ON PURPOSE — an unparseable file is already red in CI');
{
  check('a register that will not parse raises nothing here', items(mkDir('badreg', { maps: '{ not json' })).length === 0);
  check('a directory that will not parse raises nothing here', items(mkDir('baddir', { rows: '{ not json', maps: [entry('Areas/One', 'A Council')] })).length === 0);
  // CONTROL — the state is READ, and says which file, so the silence is a choice.
  const st = readCoverageState(mkDir('badreg2', { maps: '{ not json' }));
  check('CONTROL — but readCoverageState records WHICH file', /existing-coverage\.json/.test(st.unreadable || ''), String(st.unreadable));
  check('and it does not throw', st.dataPresent === true && st.coveragePresent === true);
}

console.log('\n8. the join, asserted directly — the half that can silently narrow');
{
  const st = readCoverageState(mkDir('join', {
    rows: [row('A Council', 10), row('B Council', 20), row('C Council', 30)],
    maps: [entry('Areas/One', 'A Council'), entry('Areas/Two', 'A Council'), entry('Areas/Three', 'B Council')],
  }));
  const a = gateBearingAuthorities(st);
  check('two authorities, not three and not one', a.length === 2, JSON.stringify(a.map((x) => x.lta)));
  check('the map count is per authority', a.find((x) => x.lta === 'A Council').maps === 2 && a.find((x) => x.lta === 'B Council').maps === 1);
  check('it carries the landing page the row prints', a.every((x) => typeof x.landingPage === 'string' && x.landingPage.length));
  check('oldest first', a[0].lta === 'B Council', JSON.stringify(a.map((x) => x.lta)));
  check('an empty state joins to nothing rather than throwing', gateBearingAuthorities(null).length === 0 && gateBearingAuthorities({}).length === 0);
}

console.log('\n9. the wire in worklist.mjs — literal strings, and they must RUN');
{
  const src = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  // NOT src.includes(). A mutation sweep on prove-red-loop-blocked.mjs commented
  // a wire out and every assertion stayed green, because a commented line still
  // contains the string.
  const liveLine = (lit) => src.split('\n').some((l) => l.includes(lit) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  for (const lit of [
    "import { readCoverageState, directoryCoverageItems } from './directory_coverage.mjs';",
    'for (const it of directoryCoverageItems({ state: readCoverageState(directoryDir) })) add(it);',
  ]) check(`worklist.mjs RUNS: ${lit.slice(0, 60)}`, liveLine(lit), 'absent, or commented out');
}

console.log('\n10. against the REAL buses-data directory, when it is beside this checkout');
{
  const real = path.resolve(HERE, '..', '..', '..', '..', 'Using AI', 'Buses', 'BusMapsUK', 'bus-map-directory');
  const st = readCoverageState(real);
  if (!st.coveragePresent) {
    console.log(`  --  skipped: no bus-map-directory at ${real} (this is a claude-skills checkout)`);
  } else {
    check('the real register and directory both parse', st.unreadable === null, String(st.unreadable));
    const a = gateBearingAuthorities(st);
    check('every authority the real register names joins to a real directory row', a.length > 0, JSON.stringify(a.map((x) => x.lta)));
    check('every one of them carries a parseable checked date', a.every((x) => Number.isFinite(x.at)), JSON.stringify(a.map((x) => [x.lta, x.checked])));
    check('the real map count is all 20 of them', a.reduce((s, x) => s + x.maps, 0) === 20, String(a.reduce((s, x) => s + x.maps, 0)));
    // A DATED ASSERTION ABOUT TODAY WOULD BE THE FAULT THIS ROW IS ABOUT, so the
    // clock stays injected even here: the real data is driven from a fixed `now`.
    const fresh = directoryCoverageItems({ state: st, now: Date.parse(a[0].checked) + 1000 });
    check('read a second after the recorded date, the real data is silent', fresh.length === 0, JSON.stringify(fresh.map((x) => x.title)));
    const late = directoryCoverageItems({ state: st, now: Date.parse(a[a.length - 1].checked) + (REREAD_DAYS + 1) * 86400000 });
    check('a quarter later, the real data raises', late.length === 1, JSON.stringify(late.map((x) => x.title)));
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
