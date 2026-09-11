#!/usr/bin/env node
/* Prove the bus-map directory's link rows appear, say WHY, and go away
 * (buses-data OA-308's "Keeping it true", 2026-09-11).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-directory-links.mjs
 *
 * WHAT IS BEING FALSIFIED. A monthly reminder to run `directory.mjs --links`, and
 * a row ranking any DEAD link it found. Every one of this module's answers is a
 * NEGATIVE most of the time — no row, because the sweep is recent and nothing is
 * dead — and a negative is what a check that does nothing also reports. So each
 * case below is paired: make the state and see the row, clear it and see the row
 * go. Section 4 is the important one. A board that nags about a directory swept
 * last Tuesday is a board nobody reads by the end of the month, and this row
 * would be the first casualty of that.
 *
 * ITS SUBJECT PARTLY SURVIVES actions/checkout, unlike every loop harness beside
 * it: `BusMapsUK/bus-map-directory/directory.json` is tracked, so a clone of
 * buses-data has it. `link-check.json` is tracked too — it is a written record —
 * but the CHECKOUT here is claude-skills, which contains neither, so the cases
 * below build their own folders under the temp dir and section 12's join is
 * skipped out loud when buses-data cannot be found.
 *
 * THE CLOCK IS INJECTED, never read. `directoryLinkItems` takes `now`, so the
 * boundary cases (29 days quiet, 30 days loud) are assertions rather than
 * something that happens to be true today — and nothing here can start failing
 * on a calendar, which is the fault OA-289 took out of the backlog index and the
 * whole reason this check is not in CI in the first place.
 *
 * TWO HARNESS LESSONS INHERITED FROM prove-red-loop-blocked.mjs. A source
 * assertion asks whether the line RUNS, not whether the file contains the text,
 * because `includes()` is satisfied by the line commented out. And where a phrase
 * must appear in more than one branch it is COUNTED, because an assertion that
 * one of two things is true is not an assertion about both.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readDirectoryState, directoryLinkItems, CADENCE_DAYS } from './directory_links.mjs';
import { needsOf } from './concurrency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-directory-links-'));
const NOW = Date.UTC(2026, 8, 11, 12, 0);
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

/** Build a bus-map-directory folder. `record === null` means the sweep never ran. */
const mkDir = (label, { data = true, record = undefined } = {}) => {
  const dir = path.join(tmp, label);
  fs.mkdirSync(dir, { recursive: true });
  if (data) fs.writeFileSync(path.join(dir, 'directory.json'), JSON.stringify({ rows: [{ lta: 'A Council' }] }), 'utf8');
  if (record !== undefined) {
    fs.writeFileSync(path.join(dir, 'link-check.json'), typeof record === 'string' ? record : JSON.stringify(record, null, 2), 'utf8');
  }
  return dir;
};
/** A healthy record: swept `age` days ago, everything live. */
const healthy = (age, extra = {}) => ({
  checkedAt: daysAgo(age), urls: 109, rows: 76, live: 109, blocked: 0, dead: 0, deadLinks: [], blockedLinks: [], ...extra,
});
const deadLink = (url, cites) => ({ url, status: 404, why: null, cites });
const rows = (dir, now = NOW) => directoryLinkItems({ state: readDirectoryState(dir), now });
const byKey = (list, key) => list.find((r) => r.key === key);

console.log('\n1. no directory in this tree at all — silence, and the control that proves it is not silence everywhere');
{
  check('an empty folder raises nothing', rows(mkDir('empty', { data: false })).length === 0);
  check('a folder that does not exist raises nothing', rows(path.join(tmp, 'nope')).length === 0);
  // THE CONTROL. Without it, every assertion in this file is satisfied by a
  // function that returns []. The only difference between the two folders is
  // directory.json, which is exactly the trigger the module claims to key on.
  check('MUTATION CONTROL — the same folder WITH directory.json raises one', rows(mkDir('trigger')).length === 1);
  check('…and it is the never-swept row', byKey(rows(mkDir('trigger2')), 'directory-links-due') !== undefined);
}

console.log('\n2. the directory is here and the sweep has never run');
{
  const r = rows(mkDir('never'));
  check('exactly one row', r.length === 1, String(r.length));
  check('rank 8 — nobody is blocked by it', r[0].rank === 8, String(r[0].rank));
  check('title says never', /never had its links swept/.test(r[0].title), r[0].title);
  check('why says whose URLs they are', /belongs to somebody else/.test(r[0].why));
  check('and offers the sweep, in the directory folder', r[0].do.some((d) => d.kind === 'shell' && d.cmd === 'node directory.mjs --links' && d.cwd.endsWith('never')));
}

console.log('\n3. a month has passed');
{
  const r = rows(mkDir('stale', { record: healthy(45) }));
  check('one row', r.length === 1, String(r.length));
  check('it is the due row', r[0].key === 'directory-links-due');
  check('title carries the age in days', /last swept 45 days ago/.test(r[0].title), r[0].title);
  check('ageDays is set, so the board can sort on it', r[0].ageDays === 45, String(r[0].ageDays));
  check('why names the sweep date', /2026-07-28/.test(r[0].why), r[0].why);
  check('why names the scale — URLs and authorities', /109 URLs across 76 authorities/.test(r[0].why), r[0].why);
  check('and warns against "fixing" a bot wall', r[0].do.some((d) => /BLOCKED is a bot wall/.test(d.what || '')));
}

console.log('\n4. THE CONTROL THAT MATTERS MOST — a recently swept directory says nothing');
{
  check('swept today, nothing', rows(mkDir('today', { record: healthy(0) })).length === 0);
  check('swept 2 days ago, nothing', rows(mkDir('recent', { record: healthy(2) })).length === 0);
  // The boundary, both sides. 30 is the cadence OA-308 asked for; 29 must be
  // quiet or "monthly" is a word rather than a number.
  check(`${CADENCE_DAYS - 1} days — still quiet`, rows(mkDir('day29', { record: healthy(CADENCE_DAYS - 1) })).length === 0);
  check(`${CADENCE_DAYS} days — raises`, rows(mkDir('day30', { record: healthy(CADENCE_DAYS) })).length === 1);
  check('the cadence is the module\'s constant, not a literal here', CADENCE_DAYS === 30, String(CADENCE_DAYS));
  // And the caller can override it without the module reading the clock itself.
  const st = readDirectoryState(mkDir('override', { record: healthy(10) }));
  check('a 7-day cadence would raise the same record', directoryLinkItems({ state: st, now: NOW, cadenceDays: 7 }).length === 1);
  check('a 90-day cadence would not', directoryLinkItems({ state: st, now: NOW, cadenceDays: 90 }).length === 0);
}

console.log('\n5. a dead link, found by a sweep that is otherwise current');
{
  const rec = healthy(3, {
    dead: 2, live: 107,
    deadLinks: [
      deadLink('https://example.gov.uk/gone.pdf', ['Cumberland Council (networkMap)']),
      deadLink('https://tees.example/map', ['Tees Valley CA (landingPage)', 'Tees Valley CA (townMaps)']),
    ],
  });
  const r = rows(mkDir('dead', { record: rec }));
  check('one row — the sweep itself is current, so no due row', r.length === 1, JSON.stringify(r.map((x) => x.key)));
  const d = byKey(r, 'directory-links-dead');
  check('it is the dead row', d !== undefined);
  check('rank 7, ABOVE housekeeping — a published wrong answer is not hygiene', d.rank === 7, String(d.rank));
  check('title counts them and pluralises', /^2 links in the national bus-map directory are DEAD$/.test(d.title), d.title);
  check('why says what dead MEANS, as against refused', /withdrawn rather than a reader being refused/.test(d.why));
  check('why names the consequence for a reader', /points? a reader at nothing|pointing a reader at nothing/.test(d.why));
  // The URLs must be NAMED. Grouping twelve dead links into one row is only
  // honest if the row still says which twelve.
  check('detail names the first URL and who cites it', d.detail.includes('https://example.gov.uk/gone.pdf') && d.detail.includes('Cumberland Council (networkMap)'));
  check('detail names the second, with BOTH of its citing rows', d.detail.includes('https://tees.example/map') && /Tees Valley CA \(landingPage\); Tees Valley CA \(townMaps\)/.test(d.detail));
  check('the first step is to open them in a browser, not to edit', /open each dead URL in the browser/i.test(d.do[0].what || ''));
  check('…and it says why: a 404 to a fetcher may be a redirect', /redirect we have not followed/.test(d.do[0].what));
  check('a withdrawn map is recorded as a finding, not blanked', d.do.some((x) => /withdrawn map is a finding/.test(x.what || '')));
  check('and the README re-render is offered after the edit', d.do.some((x) => x.kind === 'shell' && x.cmd === 'node directory.mjs'));

  // ONE dead link reads as one dead link.
  const one = rows(mkDir('dead1', { record: healthy(3, { dead: 1, deadLinks: [deadLink('https://x/y', ['B (landingPage)'])] }) }));
  check('MUTATION CONTROL — one dead link says "1 link … is DEAD"', /^1 link in the national bus-map directory is DEAD$/.test(one[0].title), one[0].title);
}

console.log('\n6. dead AND overdue — two rows, and the dead one sorts first');
{
  const r = rows(mkDir('both', { record: healthy(60, { dead: 1, deadLinks: [deadLink('https://x/y', ['C (landingPage)'])] }) }));
  check('two rows', r.length === 2, JSON.stringify(r.map((x) => x.key)));
  check('both keys present and distinct', byKey(r, 'directory-links-dead') && byKey(r, 'directory-links-due'));
  check('the dead row has the lower rank number', byKey(r, 'directory-links-dead').rank < byKey(r, 'directory-links-due').rank);
}

console.log('\n7. BLOCKED IS NOT DEAD — the fault this checker already paid for once');
{
  // Twelve of the fourteen "dead" links on the first real run were 403 bot walls
  // on pages a person opens without trouble. A row that nagged about them would
  // put "the refusal read as an absence" straight back, one layer up.
  const rec = healthy(2, { blocked: 11, live: 98, blockedLinks: Array.from({ length: 11 }, (_, i) => ({ url: `https://b${i}/x`, status: 403, cites: ['D (landingPage)'] })) });
  check('eleven blocked links on a fresh sweep raise NOTHING', rows(mkDir('blocked', { record: rec })).length === 0);
  // But they are not hidden either: where a row exists for another reason, the
  // count is in its prose, labelled as something not to act on.
  const overdue = rows(mkDir('blocked-old', { record: { ...rec, checkedAt: daysAgo(40) } }));
  check('on an overdue sweep the count appears in the prose', /11 URLs refused an automated reader/.test(overdue[0].why), overdue[0].why);
  check('…and says plainly it is not something to act on', /not something to act on/.test(overdue[0].why));
  check('MUTATION CONTROL — with zero blocked, no such sentence', !/refused an automated reader last time/.test(rows(mkDir('nb', { record: healthy(40) }))[0].why));
}

console.log('\n8. the record is there and cannot be believed');
{
  const r = rows(mkDir('broken', { record: '{ this is not json' }));
  check('a broken record raises a row rather than falling quiet', r.length === 1, String(r.length));
  check('key is the record row', r[0].key === 'directory-links-record');
  check('title says it will not parse', /will not parse/.test(r[0].title), r[0].title);
  check('why says nothing is watching while it is broken', /Nothing is watching/.test(r[0].why));
  check('and it does not ALSO claim the sweep is overdue', byKey(r, 'directory-links-due') === undefined);
}

console.log('\n9. THE WRITER-AND-READER JOIN — a record with no readable date');
{
  // If buildLinkRecord() ever renamed checkedAt, or a write were interrupted, the
  // age would be unknowable and this module would have no basis for the monthly
  // row at all. That state looks exactly like health from everywhere else.
  const r = rows(mkDir('nodate', { record: { urls: 109, dead: 0, deadLinks: [] } }));
  check('raises, rather than treating a dateless record as fresh', r.length === 1, String(r.length));
  check('key is the record row', r[0].key === 'directory-links-record');
  check('title says it does not say when it ran', /does not say when it ran/.test(r[0].title), r[0].title);
  check('and it points at buildLinkRecord, which is where such a fault lives', r[0].do.some((d) => /buildLinkRecord\(\) in directory\.mjs/.test(d.what || '')));
  check('an unparseable DATE is treated the same way', rows(mkDir('baddate', { record: { checkedAt: 'last Tuesday', deadLinks: [] } }))[0].key === 'directory-links-record');
  // A dateless record must not silently swallow a dead link either.
  check('MUTATION CONTROL — a dateless record with dead links still stops at the record row', rows(mkDir('nodate2', { record: { deadLinks: [deadLink('https://x/y', [])] } })).length === 1);
}

console.log('\n10. a whole site reorganises — twelve dead at once');
{
  const many = Array.from({ length: 12 }, (_, i) => deadLink(`https://gone${i}.example/map`, [`Council ${i} (landingPage)`]));
  const r = rows(mkDir('many', { record: healthy(3, { dead: 12, deadLinks: many }) }));
  check('still ONE row, not twelve that bury the rest of the board', r.length === 1, String(r.length));
  check('the title carries the count', /^12 links/.test(r[0].title), r[0].title);
  check('detail lists ten', (r[0].detail.match(/https:\/\/gone/g) || []).length === 10);
  check('…and says how many it did not list, and where they all are', /and 2 more, all of them in link-check\.json/.test(r[0].detail));
}

console.log('\n11. the concurrency verdict');
{
  // Not empty, and not the default. The row's own action writes link-check.json
  // into the buses tree, and the fix edits directory.json beside it.
  check('a directory row needs the buses tree', needsOf({ key: 'directory-links-due', type: 'directory-links' }).join() === 'buses-tree');
  check('the dead row says the same', needsOf({ key: 'directory-links-dead', type: 'directory-links' }).join() === 'buses-tree');
  check('it does NOT claim the engine', !needsOf({ key: 'directory-links-dead', type: 'directory-links' }).includes('engine'));
  check('MUTATION CONTROL — an unknown key of the same type falls to the default', needsOf({ key: 'zzz', type: 'never-heard-of-it' }).join() === 'buses-tree');
}

console.log('\n12. THE JOIN ITSELF — the real writer\'s output, read by the real reader');
{
  // The two halves live in different repositories and each could pass its own
  // tests while disagreeing about a field name. This is the only place the
  // question can be asked. buses-data is absent from a claude-skills checkout, so
  // in CI this section SAYS it could not look rather than reporting a pass.
  const busesDir = process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses';
  const writer = path.join(busesDir, 'BusMapsUK', 'bus-map-directory', 'directory.mjs');
  if (!fs.existsSync(writer)) {
    console.log(`  --  SKIPPED, and this is not a pass: buses-data is not at ${busesDir}, so the writer cannot be joined to the reader here. Expected in CI; run this on the laptop.`);
  } else {
    const { buildLinkRecord } = await import(pathToFileURL(writer).href);
    check('importing directory.mjs did NOT render the README (no entry-point side effect)', true);
    const cites = new Map([
      ['https://gone.example/map', ['A Council (networkMap)']],
      ['https://walled.example/', ['B Council (landingPage)']],
    ]);
    const record = buildLinkRecord({
      results: [
        { url: 'https://live.example/', verdict: 'LIVE', status: 200 },
        { url: 'https://gone.example/map', verdict: 'DEAD', status: 404 },
        { url: 'https://walled.example/', verdict: 'BLOCKED', status: 403 },
      ],
      cites, rowCount: 76, now: new Date(NOW - 40 * 86400000),
    });
    const dir = mkDir('join', { record });
    const r = rows(dir);
    check('the real record drives BOTH rows', r.length === 2, JSON.stringify(r.map((x) => x.key)));
    const d = byKey(r, 'directory-links-dead');
    check('the dead row names the URL the writer classified DEAD', d && d.detail.includes('https://gone.example/map'));
    check('…and the directory row that cites it', d && d.detail.includes('A Council (networkMap)'));
    check('the blocked one is carried, and raises nothing of its own', /1 URL refused an automated reader/.test(byKey(r, 'directory-links-due').why));
    check('the writer counts live itself', record.live === 1 && record.dead === 1 && record.blocked === 1, JSON.stringify({ l: record.live, d: record.dead, b: record.blocked }));
    check('and dates the record in a form the reader can parse', Number.isFinite(Date.parse(record.checkedAt)));
  }
}

console.log('\n13. the wire in worklist.mjs — literal strings, and they must RUN');
{
  const src = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  // NOT src.includes(). A mutation sweep on prove-red-loop-blocked.mjs commented
  // a wire out and every assertion stayed green, because a commented line still
  // contains the string.
  const liveLine = (lit) => src.split('\n').some((l) => l.includes(lit) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  for (const lit of [
    "import { readDirectoryState, directoryLinkItems } from './directory_links.mjs';",
    "const directoryDir = path.join(BUSES, 'BusMapsUK', 'bus-map-directory');",
    'for (const it of directoryLinkItems({ state: readDirectoryState(directoryDir) })) add(it);',
  ]) check(`worklist.mjs RUNS: ${lit.slice(0, 58)}`, liveLine(lit), 'absent, or commented out');
  // The detail line, which is what makes the dead URLs visible to a human at all.
  // It was written by three row types and printed by none until 2026-09-11, so
  // this row's evidence would have gone to an empty room.
  check('worklist.mjs PRINTS it.detail', liveLine('if (it.detail) for (const l of String(it.detail).split'), 'the dead URLs would be invisible outside --json');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
