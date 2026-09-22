#!/usr/bin/env node
/* Prove the monthly ink review can show a sheet, stay quiet, and refuse
 * (buses-data OA-429, item 5 of R9 of the process review of 2026-09-17).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), no placeholders:
 *
 *   node prove-red-ink-review.mjs
 *
 * WHAT IS AT RISK. This review is the gate in front of the only step in R9 that
 * reaches a real person: delivery emails the map's customer. So the failures that
 * matter are all ways of calling a changed sheet unchanged, or an unanswered one
 * deliverable — a stamp spelled another way, a sheet missing from disk read as
 * sameness, an accept carried over to a build nobody looked at. Each has a case
 * whose answer would differ if the rule were gone, so the rule is shown to be
 * load-bearing rather than merely present.
 *
 * No Areas folder, no _gtfs folder and no clock: `collect()` takes its reads as
 * arguments. The crops need sharp and the engine, and are NOT here; the review
 * record and the gate are.
 */
import {
  neutralise, inkChange, runDate, pickRuns, collect, mergeAnswers, answer, deliverable, page, Refused, SCHEMA,
} from './ink_review.mjs';

let bad = 0, ran = 0;
const check = (label, ok, detail) => { ran++; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };
const refuses = (fn, re) => { try { fn(); return false; } catch (e) { return e instanceof Refused && (!re || re.test(e.message)); } };

const SCAN = '2026-10-01';
const BUSES = 'X:/estate';
const sheet = (body, stamp) => `<svg><g>${body}</g><text>${stamp}</text></svg>`;
const S = (v, d) => `build ${v} \u00b7 ${d}`;

/* A fake estate: map → { runs: [{id, outputs, files: {name: text}}] }. */
function estate(maps, grades = { [SCAN]: { March: 'SAFE', Ely: 'ESCALATE' } }) {
  const files = new Map(), manifests = new Map();
  for (const [town, runs] of Object.entries(maps)) {
    const dir = `${BUSES}/Areas/${town}`.replace(/\//g, '|');
    manifests.set(dir, { stages: { S4: { runs: runs.map((r) => ({ id: r.id, dir: `S4-generate/${r.id}`, outputs: Object.keys(r.files) })) } } });
    for (const r of runs) for (const [n, t] of Object.entries(r.files)) if (t != null) files.set(`${dir}|S4-generate|${r.id}|${n}`, t);
  }
  const key = (p) => p.replace(/[\\/]/g, '|');
  return {
    readGradeFiles: () => Object.entries(grades).map(([date, towns]) => ({ date, text: JSON.stringify({
      date, schema: 1, towns: Object.fromEntries(Object.entries(towns).map(([t, g]) => [t, { grade: g, actionable: 1, reasons: [] }])),
    }) })),
    readManifest: (dir) => manifests.get(key(dir)) || null,
    readSheet: (f) => (files.has(key(f)) ? files.get(key(f)) : null),
  };
}
const OLD = 'v2.59_2026-09-05_1025', NEW = 'v2.60_2026-10-02_0300';
const run = (id, files) => ({ id, files });

console.log('\n1. The stamp is not ink, in every spelling an SVG could carry it');
{
  const a = sheet('<path d="M0 0"/>', S('2.59', '5 Sep 2026')), b = sheet('<path d="M0 0"/>', S('2.60', '2 Oct 2026'));
  check('two builds differing ONLY in the stamp are no change', inkChange(a, b) === null);
  check('  and without neutralising they WOULD differ — the rule is load-bearing', a !== b);
  check('the stamp escaped as &#183; is neutralised too', inkChange(a, b.replace('\u00b7', '&#183;')) === null);
  check('  and as &middot;', inkChange(a, b.replace('\u00b7', '&middot;')) === null);
  check('a changed path beside a changed stamp IS a change', inkChange(a, sheet('<path d="M0 1"/>', S('2.60', '2 Oct 2026'))) === 'moved');
  check('a stamp-shaped string is not a licence: "build" text in the body still counts',
    inkChange(sheet('<text>Buses</text>', 'x'), sheet('<text>Buses build 1.0</text>', 'x')) === 'moved');
  check('neutralise leaves a sheet with no stamp byte-identical', neutralise('<svg/>') === '<svg/>');
  check('a sheet that appears is "new", one that goes is "dropped"', inkChange(null, a) === 'new' && inkChange(a, null) === 'dropped');
}

console.log('\n2. Which two builds are compared');
{
  check('runDate reads the folder\'s own date', runDate('v3.12_2026-09-21_0343') === '2026-09-21');
  const man = (ids) => ({ stages: { S4: { runs: ids.map((id) => ({ id, dir: `S4-generate/${id}`, outputs: ['internal.svg'] })) } } });
  const p = pickRuns(man(['v1.0_2026-09-01_1000', 'v1.1_2026-09-20_1000', 'v1.2_2026-10-02_1000', 'v1.3_2026-10-05_1000']), SCAN);
  check('after is the newest build', p.after.id === 'v1.3_2026-10-05_1000', p.after && p.after.id);
  check('before is the newest build BEFORE the scan, so a refresh then a rollout shows the whole month', p.before.id === 'v1.1_2026-09-20_1000', p.before && p.before.id);
  const shuffled = pickRuns(man(['v1.3_2026-10-05_1000', 'v1.0_2026-09-01_1000', 'v1.1_2026-09-20_1000']), SCAN);
  check('a manifest out of order is sorted, not trusted', shuffled.after.id === 'v1.3_2026-10-05_1000' && shuffled.before.id === 'v1.1_2026-09-20_1000');
  check('no build since the scan is not-refreshed', pickRuns(man(['v1.0_2026-09-01_1000']), SCAN).status === 'not-refreshed');
  check('no build before the scan is no-before', pickRuns(man(['v1.0_2026-10-02_1000']), SCAN).status === 'no-before');
}

console.log('\n3. The population, and the grading from another scan');
{
  const io = estate({ March: [run(OLD, { 'internal.svg': sheet('a', S('2.59', '5 Sep 2026')) }), run(NEW, { 'internal.svg': sheet('a', S('2.60', '2 Oct 2026')) })] });
  const r = collect({ busesDir: BUSES, scan: SCAN, io });
  check('the review names its schema and scan', r.schema === SCHEMA && r.scan === SCAN);
  check('SAFE towns are in, ESCALATE towns are not', r.maps.map((m) => m.map).join() === 'March', r.maps.map((m) => m.map).join());
  check('a re-stamped map is no-ink', r.maps[0].status === 'no-ink', r.maps[0].status);
  const stale = estate({}, { '2026-09-01': { March: 'SAFE' } });
  check('a grading from another scan REFUSES rather than reviewing last month\'s towns', refuses(() => collect({ busesDir: BUSES, scan: SCAN, io: stale }), /newest grading is 2026-09-01/));
  check('  unless the towns are named, and then only those', collect({ busesDir: BUSES, scan: SCAN, towns: ['Ely'], io: stale }).maps.map((m) => m.map).join() === 'Ely');
  check('a scan that is not a date refuses', refuses(() => collect({ busesDir: BUSES, scan: 'October', io })));
}

console.log('\n4. A sheet missing from disk is never read as sameness');
{
  const io = estate({ March: [run(OLD, { 'internal.svg': sheet('a', 'x') }), run(NEW, { 'internal.svg': null })] });
  const m = collect({ busesDir: BUSES, scan: SCAN, io }).maps[0];
  check('a listed sheet absent from disk makes the map unreadable', m.status === 'unreadable', m.status);
  check('  and says which', /internal\.svg/.test(m.detail || ''), m.detail);
  check('  and it is not deliverable', deliverable({ maps: [m] }).deliver.length === 0);
}

console.log('\n5. Answers: one per build, and the gate');
{
  const io = estate({ March: [run(OLD, { 'internal.svg': sheet('a', 'x') }), run(NEW, { 'internal.svg': sheet('b', 'x') })] });
  const r = collect({ busesDir: BUSES, scan: SCAN, io });
  check('a moved sheet makes the map ink-moved', r.maps[0].status === 'ink-moved');
  check('  and unanswered it is WAITING, not deliverable', deliverable(r).waiting.join() === 'March' && !deliverable(r).deliver.length);
  const acc = answer(r, 'march', 'accept', { by: 'buses-29', at: 'T1' });
  check('an accept makes it deliverable', deliverable(acc).deliver.join() === 'March');
  check('  and the answer names the build it was given against', acc.maps[0].answer.after === NEW);
  const held = answer(acc, 'March', 'hold', { by: 'buses-29', note: 'the museum icon is doubled', at: 'T2' });
  check('a hold is held, and the earlier accept is kept under superseded', deliverable(held).held.join() === 'March' && held.maps[0].superseded.length === 1);
  check('an answer with no --by refuses', refuses(() => answer(r, 'March', 'accept', { by: ' ', at: 'T' })));
  check('a verdict other than accept or hold refuses', refuses(() => answer(r, 'March', 'yes', { by: 'a', at: 'T' })));
  check('an unknown map refuses', refuses(() => answer(r, 'Wisbech', 'accept', { by: 'a', at: 'T' })));
  const quiet = collect({ busesDir: BUSES, scan: SCAN, io: estate({ March: [run(OLD, { 'i.svg': 'x' }), run(NEW, { 'i.svg': 'x' })] }) });
  check('a no-ink map cannot be answered — it goes ahead without Peter', refuses(() => answer(quiet, 'March', 'hold', { by: 'a', at: 'T' }), /did not move/));
  check('  and it is deliverable unanswered', deliverable(quiet).deliver.join() === 'March');

  /* THE REBUILD RULE. An accept of one build must not carry to the next. */
  const rebuilt = collect({ busesDir: BUSES, scan: SCAN, io: estate({ March: [run(OLD, { 'internal.svg': sheet('a', 'x') }),
    run(NEW, { 'internal.svg': sheet('b', 'x') }), run('v2.61_2026-10-03_0300', { 'internal.svg': sheet('c', 'x') })] }) });
  const merged = mergeAnswers(acc, rebuilt);
  check('a map rebuilt after its accept is WAITING again', deliverable(merged).waiting.join() === 'March', JSON.stringify(deliverable(merged)));
  check('  and the old accept is kept, with the reason', merged.maps[0].superseded && /rebuilt as v2\.61/.test(merged.maps[0].superseded[0].why));
  check('  and without the rule the accept WOULD have carried — the rule is load-bearing', deliverable({ maps: [{ ...merged.maps[0], answer: acc.maps[0].answer, after: NEW }] }).deliver.join() === 'March');
  check('  and the gate itself checks the build too, not only the merge', deliverable({ maps: [{ ...merged.maps[0], answer: acc.maps[0].answer }] }).waiting.join() === 'March');
  const same = mergeAnswers(acc, collect({ busesDir: BUSES, scan: SCAN, io }));
  check('re-collecting the SAME build keeps the answer', deliverable(same).deliver.join() === 'March');
}

console.log('\n6. The page shows only what moved');
{
  const io = estate({ March: [run(OLD, { 'i.svg': 'a' }), run(NEW, { 'i.svg': 'b' })], Soham: [run(OLD, { 'i.svg': 'a' }), run(NEW, { 'i.svg': 'a' })] },
    { [SCAN]: { March: 'SAFE', Soham: 'SAFE' } });
  const html = page(collect({ busesDir: BUSES, scan: SCAN, io }), { 'March/i.svg': { pairs: ['March_i_0_pair.png'] } });
  check('the heading counts the maps to look at', /1 map to look at/.test(html));
  check('the moved map has a section and its crop', /<h2>March<\/h2>/.test(html) && /March_i_0_pair\.png/.test(html));
  check('the quiet map has no section, only a line saying it goes ahead', !/<h2>Soham/.test(html) && /Soham/.test(html));
  check('the page tells Peter how to answer in words, not a command', /tell Claude/.test(html) && !/node /.test(html));
}

console.log(`\n${ran - bad} of ${ran} passed`);
process.exit(bad ? 1 : 0);
