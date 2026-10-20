#!/usr/bin/env node
/* Prove the monthly ink review can show a sheet, stay quiet, and refuse
 * (buses-data OA-429, item 5 of R9 of the process review of 2026-09-17).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), no placeholders:
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
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import {
  commitRecord, reportCommit, neutralise, inkChange, runDate, pickRuns, collect, mergeAnswers, answer, deliverable, page, resolvePlaces, carriedNames, withCarried, sameInkAsAnswered, Refused, SCHEMA,
  recordStaged, markStaged, newestRender, waitingItems,
  liveVerdict, liveDeliverable, newestBuild, fetchPortalMaps, LIVE,
} from './ink_review.mjs';
import { svgText, textChange, gatherEvidence, decide, registerFrom, selfAnswer, backfillEngine, recordable, sheetKind, acceptedBase, deliveryOrder, recordRuling } from './ink_self_answer.mjs';

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
    /* A key with a slash is a map folder relative to the estate — a place map. */
    const dir = (town.includes('/') ? `${BUSES}/${town}` : `${BUSES}/Areas/${town}`).replace(/\//g, '|');
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

console.log('\n3a. A place map joins by name, from its own folder (OA-430 item 3)');
{
  const SNE = 'Areas/St Neots/Places/St Neots East';
  const io = estate({
    March: [run(OLD, { 'internal.svg': sheet('a', 'x') }), run(NEW, { 'internal.svg': sheet('a', 'x') })],
    [SNE]: [run(OLD, { 'internal.svg': sheet('a', 'x') }), run(NEW, { 'internal.svg': sheet('b', 'x') })],
  });
  const places = resolvePlaces(['st neots east'], [{ name: 'St Neots East', rel: SNE }, { name: 'Ely Co-op', rel: 'Places/_standalone/Ely Co-op' }]);
  check('a place name resolves to its folder, spelled as the disk spells it', places[0].name === 'St Neots East' && places[0].dir === SNE, JSON.stringify(places));
  check('an unknown place refuses and lists the place maps', refuses(() => resolvePlaces(['Ely Tesco'], [{ name: 'Ely Co-op', rel: 'x' }]), /are Ely Co-op/));
  check('a name two place maps share refuses', refuses(() => resolvePlaces(['Co-op'], [{ name: 'Co-op', rel: 'a' }, { name: 'Co-op', rel: 'b' }]), /2 place maps/));
  const r = collect({ busesDir: BUSES, scan: SCAN, places, io });
  const p = r.maps.find((m) => m.map === 'St Neots East');
  check('the place is reviewed beside the SAFE towns', r.maps.map((m) => m.map).join() === 'March,St Neots East', r.maps.map((m) => m.map).join());
  check('  read from its own folder, not Areas/<name>', p && p.status === 'ink-moved' && p.dir === SNE, p && `${p.status} ${p.dir}`);
  check('  and says it is a place, and a town says it is an area', p && p.kind === 'place' && r.maps[0].kind === 'area');
  const guessed = collect({ busesDir: BUSES, scan: SCAN, towns: ['St Neots East'], io }).maps.find((m) => m.map === 'St Neots East');
  check('  and without its folder it WOULD have been unreadable — the folder is load-bearing', guessed.status === 'unreadable', guessed.status);
  check('a place can be answered like a town', deliverable(answer(r, 'St Neots East', 'accept', { by: 'a', at: 'T' })).deliver.includes('St Neots East'));
  const stale = estate({ [SNE]: [run(OLD, { 'i.svg': 'a' }), run(NEW, { 'i.svg': 'a' })] }, { '2026-09-01': { March: 'SAFE' } });
  check('a named place is a population when the grading is another scan\'s', collect({ busesDir: BUSES, scan: SCAN, places, io: stale }).maps.map((m) => m.map).join() === 'St Neots East');
  check('a place sharing a town\'s name in one review refuses', refuses(() => collect({ busesDir: BUSES, scan: SCAN, places: [{ name: 'March', dir: 'Places/March' }], io }), /as well as a place map/));
}

console.log('\n3b. A map named by an earlier run stays in the review (OA-430)');
{
  const GCR = 'Places/_standalone/Godmanchester Co-op Cambridge Road';
  const io = estate({
    March: [run(OLD, { 'i.svg': 'a' }), run(NEW, { 'i.svg': 'a' })],
    Chatteris: [run(OLD, { 'i.svg': 'a' }), run(NEW, { 'i.svg': 'b' })],
    [GCR]: [run(OLD, { 'i.svg': 'a' }), run(NEW, { 'i.svg': 'b' })],
  });
  const first = answer(collect({ busesDir: BUSES, scan: SCAN, towns: ['Chatteris'], io }), 'Chatteris', 'hold', { by: 'buses-29', at: 'T1' });
  const second = mergeAnswers(first, collect({ busesDir: BUSES, scan: SCAN,
    ...withCarried(carriedNames(first), [], [{ name: 'Godmanchester Co-op Cambridge Road', dir: GCR }]), io }));
  const names = second.maps.map((m) => m.map).join();
  check('the second tick\'s place joins and the first tick\'s town stays', names === 'Chatteris,Godmanchester Co-op Cambridge Road,March', names);
  check('  with its answer', deliverable(second).held.join() === 'Chatteris', JSON.stringify(deliverable(second)));
  const bare = mergeAnswers(first, collect({ busesDir: BUSES, scan: SCAN, places: [{ name: 'Godmanchester Co-op Cambridge Road', dir: GCR }], io }));
  check('  and without the carry it WOULD have been dropped — the carry is load-bearing', !bare.maps.some((m) => m.map === 'Chatteris'));
  const plain = mergeAnswers(second, collect({ busesDir: BUSES, scan: SCAN, ...withCarried(carriedNames(second), [], []), io }));
  check('a plain re-collection naming nobody keeps both named maps', plain.maps.map((m) => m.map).join() === names, plain.maps.map((m) => m.map).join());
  const carried = carriedNames(second);
  check('a place is carried with the folder it was found at', carried.places.length === 1 && carried.places[0].dir === GCR, JSON.stringify(carried));
  check('a SAFE town is not carried — the grading names it', !carried.towns.includes('March'), carried.towns.join());
  check('a name given again is one map, this run\'s spelling winning', withCarried({ towns: ['chatteris'], places: [] }, ['Chatteris'], []).towns.join() === 'Chatteris');
  check('no record carries nothing', carriedNames(null).towns.length === 0 && carriedNames(null).places.length === 0);
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

console.log('\n5a. A stamp-only rebuild keeps the answer (OA-584)');
{
  const NEW2 = 'v2.61_2026-10-03_0300', NEW3 = 'v2.62_2026-10-04_0300';
  const body = (v, d, ink) => ({ 'internal.svg': sheet(ink, S(v, d)) });
  const mk = (runs) => estate({ March: runs });
  const ctxOf = (io) => ({ busesDir: BUSES, io });
  const base = mk([run(OLD, body('2.59', '5 Sep 2026', 'a')), run(NEW, body('2.60', '2 Oct 2026', 'b'))]);
  const acc = answer(collect({ busesDir: BUSES, scan: SCAN, io: base }), 'March', 'accept', { by: 'buses-29', at: 'T1' });
  const run3 = (ink3) => mk([run(OLD, body('2.59', '5 Sep 2026', 'a')), run(NEW, body('2.60', '2 Oct 2026', 'b')), run(NEW2, body('2.61', '3 Oct 2026', ink3))]);

  /* The case this action exists for: only the stamp differs. */
  const stampIo = run3('b');
  const stampNext = collect({ busesDir: BUSES, scan: SCAN, io: stampIo });
  const carried = mergeAnswers(acc, stampNext, ctxOf(stampIo));
  const cm = carried.maps[0];
  check('a stamp-only rebuild leaves the accept standing, so the map is deliverable', deliverable(carried).deliver.join() === 'March', JSON.stringify(deliverable(carried)));
  check('  with the answer re-pointed at the current build', cm.answer && cm.answer.after === NEW2, cm.answer && cm.answer.after);
  check('  and a carried note naming the build it was given against', cm.answer && cm.answer.carried && cm.answer.carried.from === NEW && /byte-identical/.test(cm.answer.carried.why), JSON.stringify(cm.answer));
  check('  and nothing is superseded, because nothing was lost', !(cm.superseded || []).length);
  check('  and without the rule the map WOULD be asked again — the rule is load-bearing', deliverable(mergeAnswers(acc, stampNext)).waiting.join() === 'March');

  /* A third build, still the same picture: the note keeps the ORIGINAL build. */
  const chainIo = mk([run(OLD, body('2.59', '5 Sep 2026', 'a')), run(NEW, body('2.60', '2 Oct 2026', 'b')), run(NEW2, body('2.61', '3 Oct 2026', 'b')), run(NEW3, body('2.62', '4 Oct 2026', 'b'))]);
  const chained = mergeAnswers(carried, collect({ busesDir: BUSES, scan: SCAN, io: chainIo }), ctxOf(chainIo));
  check('a second stamp-only rebuild carries it again, still naming the first answered build', deliverable(chained).deliver.join() === 'March' && chained.maps[0].answer.carried.from === NEW && chained.maps[0].answer.after === NEW3, JSON.stringify(chained.maps[0].answer));

  /* Ink moved: must supersede. */
  const movedIo = run3('c');
  const moved = mergeAnswers(acc, collect({ busesDir: BUSES, scan: SCAN, io: movedIo }), ctxOf(movedIo));
  check('a rebuild whose ink moved is WAITING again, the old accept kept with its reason', deliverable(moved).waiting.join() === 'March' && /rebuilt as v2\.61/.test(moved.maps[0].superseded[0].why), JSON.stringify(moved.maps[0]));
  check('  and no answer is left standing', moved.maps[0].answer == null);
  const wordIo = run3('b build 1.0');
  check('  the stamp is the ONLY thing neutralised: a "build 1.0" in the body still moves the ink',
    mergeAnswers(acc, collect({ busesDir: BUSES, scan: SCAN, io: wordIo }), ctxOf(wordIo)).maps[0].answer == null);

  /* The answered build is gone from disk: nothing can be compared. */
  const prunedIo = mk([run(OLD, body('2.59', '5 Sep 2026', 'a')), run(NEW, { 'internal.svg': null }), run(NEW2, body('2.61', '3 Oct 2026', 'b'))]);
  const pruned = mergeAnswers(acc, collect({ busesDir: BUSES, scan: SCAN, io: prunedIo }), ctxOf(prunedIo));
  check('an answered build pruned from disk is WAITING again, because nothing can be compared', deliverable(pruned).waiting.join() === 'March' && pruned.maps[0].answer == null, JSON.stringify(deliverable(pruned)));
  const goneIo = mk([run(OLD, body('2.59', '5 Sep 2026', 'a')), run(NEW2, body('2.61', '3 Oct 2026', 'b'))]);
  const gone = mergeAnswers(acc, collect({ busesDir: BUSES, scan: SCAN, io: goneIo }), ctxOf(goneIo));
  check('  and so is one the manifest no longer lists', deliverable(gone).waiting.join() === 'March');

  /* A sheet added is a change even if the shared sheet matches. */
  const addIo = mk([run(OLD, body('2.59', '5 Sep 2026', 'a')), run(NEW, body('2.60', '2 Oct 2026', 'b')), run(NEW2, { ...body('2.61', '3 Oct 2026', 'b'), 'external.svg': sheet('x', S('2.61', '3 Oct 2026')) })]);
  const added = mergeAnswers(acc, collect({ busesDir: BUSES, scan: SCAN, io: addIo }), ctxOf(addIo));
  check('a sheet that appears in the new build is WAITING again, though the shared sheet matches', deliverable(added).waiting.join() === 'March');

  /* A hold is about the same picture too. */
  const hold = answer(collect({ busesDir: BUSES, scan: SCAN, io: base }), 'March', 'hold', { by: 'buses-29', note: 'icon doubled', at: 'T1' });
  check('a HOLD on an unchanged picture stays a hold — it is not quietly dropped', deliverable(mergeAnswers(hold, stampNext, ctxOf(stampIo))).held.join() === 'March');
  check('sameInkAsAnswered reads false with no answered id', sameInkAsAnswered({ busesDir: BUSES, entry: stampNext.maps[0], answeredId: null, io: stampIo }) === false);
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

console.log('\n7. The record commits itself — by pathspec, read back, never pushed');
{
  const g = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  const root = mkdtempSync(path.join(os.tmpdir(), 'ink-commit-'));
  g(root, 'init', '-q', '-b', 'main');
  g(root, 'config', 'user.email', 't@example.com'); g(root, 'config', 'user.name', 't'); g(root, 'config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(root, '_gtfs'));
  const rec = path.join(root, '_gtfs', 'ink-review_2026-10-01.json');
  const other = path.join(root, 'other.txt');
  writeFileSync(rec, '{"v":1}\n'); writeFileSync(other, 'a\n');
  g(root, 'add', '-A'); g(root, 'commit', '-q', '-m', 'seed');
  const head = () => g(root, 'log', '-1', '--format=%s').stdout.trim();
  const count = () => Number(g(root, 'rev-list', '--count', 'HEAD').stdout.trim());

  check('an unchanged record commits nothing', commitRecord({ root, file: rec, subject: 'x' }).status === 'clean' && count() === 1);

  writeFileSync(rec, '{"v":2}\n'); writeFileSync(other, 'b\n');
  const r = commitRecord({ root, file: rec, subject: 'ink-review: re-point' });
  check('a modified record is committed under its subject', r.status === 'committed' && head() === 'ink-review: re-point', JSON.stringify(r));
  check('  and the path is clean afterwards', g(root, 'status', '--porcelain', '--', '_gtfs').stdout === '');
  check('  and ONLY that path went in: a neighbour\'s dirty file is left alone', g(root, 'status', '--porcelain', '--', 'other.txt').stdout.startsWith(' M'));

  const fresh = path.join(root, '_gtfs', 'ink-review_2026-11-01.json');
  writeFileSync(fresh, '{"v":1}\n');
  check('a NEW record is added and committed', commitRecord({ root, file: fresh, subject: 'ink-review: new' }).status === 'committed' && g(root, 'ls-files', '_gtfs').stdout.includes('2026-11-01'));

  writeFileSync(rec, '{"v":3}\n'); g(root, 'add', '--', '_gtfs');
  check('a record somebody has STAGED is refused, not swept', commitRecord({ root, file: rec, subject: 'x' }).status === 'skipped' && head() === 'ink-review: new');
  g(root, 'reset', '-q', '--', '_gtfs');

  check('a file outside the checkout is refused', commitRecord({ root, file: path.join(os.tmpdir(), 'elsewhere.json'), subject: 'x' }).status === 'skipped');
  g(root, 'checkout', '-q', '-b', 'work/x');
  check('a checkout not on main is refused', /not main/.test(commitRecord({ root, file: rec, subject: 'x' }).why || ''));
  g(root, 'checkout', '-q', 'main');

  /* The gate must be seen to fail: a hook that refuses, then a commit that lies. */
  mkdirSync(path.join(root, 'hooks'));
  writeFileSync(path.join(root, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 }); // git skips a hook that is not executable, as it does on Linux CI
  g(root, 'config', 'core.hooksPath', 'hooks');
  const refusedBy = commitRecord({ root, file: rec, subject: 'ink-review: nope' });
  check('a refusing pre-commit hook is reported as FAILED, not swallowed', refusedBy.status === 'failed' && head() === 'ink-review: new', JSON.stringify(refusedBy));
  check('  and the record is still written', readFileSync(rec, 'utf8') === '{"v":3}\n');
  const liar = (cwd, argv) => (argv[0] === 'commit' ? { status: 0, out: '', err: '' } : spawnSync2(cwd, argv));
  const spawnSync2 = (cwd, argv) => { const x = g(cwd, ...argv); return { status: x.status, out: x.stdout, err: x.stderr }; };
  check('a commit that exits 0 but landed nothing fails the read-back', commitRecord({ root, file: rec, subject: 'ink-review: lie', git: liar }).status === 'failed');
  check('reportCommit is false for a failure and true for clean', reportCommit({ status: 'clean' }) === true && (console.error = () => {}, reportCommit({ status: 'failed', why: 'x' })) === false);
  rmSync(root, { recursive: true, force: true });
}

console.log('\n8. A staging made by hand is recorded against the build the review compared (OA-573)');
{
  const AFTER = 'v1.31_2026-10-03_0049', NEWER = 'v1.32_2026-10-07_0300';
  const r = { schema: 1, scan: SCAN, maps: [{ map: 'St Ives Bus Station', kind: 'place', dir: 'Areas/St Ives/Places/St Ives Bus Station', status: 'ink-moved', before: 'v1.29_2026-09-29_1425', after: AFTER, sheets: [], answer: { verdict: 'accept', by: 'p', at: 'T0', after: AFTER } }] };
  /* S5 names its folder by its own start minute, so the render's id is NOT the S4 id. */
  const s5 = (id) => ({ id: id.replace(/_\d{4}$/, '_0059'), dir: `S5-render/${id}`, version: id.match(/^v([\d.]+)_/)[1] });
  const opts = (extra = {}) => ({ slug: 'st-ives-bus-station', proposal: 171, by: 'peter', at: 'T1', render: s5(AFTER), ...extra });
  check('before the record, the hand-staged map is under deliver — the fault OA-573 names', deliverable(r).deliver.join() === 'St Ives Bus Station');
  const rec = recordStaged(r, 'st ives bus station', opts());
  const st = rec.maps[0].staged;
  check('recorded, it is staged and no longer deliverable', deliverable(rec).staged.join() === 'St Ives Bus Station' && !deliverable(rec).deliver.length, JSON.stringify(deliverable(rec)));
  check('  against the review\'s after build, with the proposal number and who recorded it', st.after === AFTER && st.proposal === 171 && st.madeBy === 'hand' && st.by === 'peter' && st.slug === 'st-ives-bus-station', JSON.stringify(st));
  check('  and owing no digest unless told to', st.notify === undefined && recordStaged(r, 'St Ives Bus Station', opts({ notify: 'digest' })).maps[0].staged.notify === 'digest');
  check('a newest render that is NOT the review\'s build refuses', refuses(() => recordStaged(r, 'St Ives Bus Station', opts({ render: s5(NEWER) })), /not a staging of the build the review compared/));
  check('  and with the matching render it does not — the render is what the refusal turned on', !refuses(() => recordStaged(r, 'St Ives Bus Station', opts())));
  check('no render at all refuses', refuses(() => recordStaged(r, 'St Ives Bus Station', opts({ render: null })), /no S5 render/));
  check('newestRender picks the newest by name, so a newer render on disk is what the refusal sees', newestRender({ stages: { S5: { runs: [s5(NEWER), s5(AFTER)] } } }).dir === `S5-render/${NEWER}`);
  check('recording it twice refuses, naming the proposal', refuses(() => recordStaged(rec, 'St Ives Bus Station', opts()), /already recorded as staged by peter .* #171/));
  check('a build stage_refresh already staged refuses too', refuses(() => recordStaged(markStaged(r, 'St Ives Bus Station', { slug: 'st-ives-bus-station', by: 'sched-0100', at: 'T' }), 'St Ives Bus Station', opts()), /already recorded/));
  check('a proposal that is not a number refuses', refuses(() => recordStaged(r, 'St Ives Bus Station', opts({ proposal: '#171' })), /proposed-update number/));
  check('no --by refuses', refuses(() => recordStaged(r, 'St Ives Bus Station', opts({ by: ' ' })), /--by is required/));
  check('a slug that is not a slug refuses', refuses(() => recordStaged(r, 'St Ives Bus Station', opts({ slug: 'St Ives' })), /slug/));
  check('a notify other than digest refuses', refuses(() => recordStaged(r, 'St Ives Bus Station', opts({ notify: 'email' })), /--notify/));
  check('a map not in the review refuses', refuses(() => recordStaged(r, 'Ely', opts()), /not in the 2026-10-01 review/));
  const kept = mergeAnswers(rec, { schema: 1, scan: SCAN, maps: [{ ...r.maps[0] }] });
  check('re-collecting the same build keeps the hand staging and its proposal', kept.maps[0].staged && kept.maps[0].staged.proposal === 171 && deliverable(kept).staged.length === 1, JSON.stringify(kept.maps[0].staged));
}

console.log('\n9. A map waiting on an answer is a worklist row, and nothing else is (2026-10-14)');
{
  const m = (map, extra = {}) => ({ map, status: 'ink-moved', after: NEW, ...extra });
  const ok = { verdict: 'accept', after: NEW, by: 'peter' };
  const rv = (scan, maps) => ({ scan, review: { schema: SCHEMA, scan, maps }, page: true });
  const oct = rv('2026-10-01', [m('March'), m('Ely', { answer: ok }), m('Ramsey', { status: 'no-ink' }), m('Huntingdon', { answer: { ...ok, verdict: 'hold' } }), m('Soham', { answer: { ...ok, after: OLD } })]);
  const rows = waitingItems([oct], { busesDir: BUSES, assets: 'X:/assets', daysSince: () => 13 });
  check('one row for the review, YOUR MOVE rank 5, keyed by scan', rows.length === 1 && rows[0].rank === 5 && rows[0].key === 'ink-waiting-2026-10-01', JSON.stringify(rows.map((r) => [r.key, r.rank])));
  check('  naming the unanswered map and the one answered for an OLDER build, and no other', /^March, Soham — /.test(rows[0].why), rows[0].why);
  check('  counting them in its title, and aged from the scan', /2 maps waiting/.test(rows[0].title) && rows[0].ageDays === 13, rows[0].title);
  /* Since 2026-10-14 the rule is offered first, for the maps no session has tried; Peter looks at what it refused. */
  const at = (re) => rows[0].do.findIndex((st) => re.test(st.cmd || st.what || ''));
  check('  offering the self-answer first, then the page on disk, then --answer', at(/--self-answer --by <session> --apply/) === 0 && at(/loop[\\/]ink-review[\\/]2026-10-01[\\/]index\.html/) === 1 && at(/--answer/) === 2, JSON.stringify(rows[0].do));
  check('an accepted, held, no-ink or staged review raises nothing', !waitingItems([rv('2026-10-01', [m('Ely', { answer: ok }), m('Huntingdon', { answer: { ...ok, verdict: 'hold' } }), m('Ramsey', { status: 'no-ink' }), m('March', { staged: { after: NEW } })])]).length);
  const nov = rv('2026-11-01', [m('March')]);
  const both = waitingItems([oct, nov]);
  check('a map a LATER review also holds is asked about there, not twice', both.length === 2 && !/March/.test(both[0].why) && /^Soham — /.test(both[0].why) && /^March — /.test(both[1].why), JSON.stringify(both.map((r) => r.why.split(' — ')[0])));
  const noPage = waitingItems([{ ...oct, page: false }], { assets: 'X:/assets' });
  check('no page on disk: the first step is the collect that rebuilds it, from the bus-work folder', noPage[0].do[0].kind === 'shell' && noPage[0].do[0].cmd === 'node ink_review.mjs --scan 2026-10-01' && noPage[0].do[0].cwd === 'X:/assets', JSON.stringify(noPage[0].do[0]));
  const broken = waitingItems([{ scan: '2026-10-01', review: null, page: false }]);
  check('a record that will not parse is rank 0, not silence', broken.length === 1 && broken[0].rank === 0 && broken[0].key === 'ink-review-unreadable-2026-10-01', JSON.stringify(broken));

  /* OA-658: the row asks only what the live verdict calls needsPeter. On 2026-10-20 the
     record called Beaconsfield, Cambridge Road and Ermine Street waiting after the portal
     had received all three. NEW renders at 2026-10-02 03:00 UTC. */
  const REB = 'v2.61_2026-10-10_0900';
  const mfOf = (builds) => ({ stages: {
    S4: { runs: builds.map((id) => ({ id, dir: `S4-generate/${id}`, outputs: ['internal.svg'] })) },
    S5: { runs: builds.map((id) => ({ id, dir: `S5-render/${id}`, version: id.slice(1).split('_')[0], at: `${runDate(id)}T${id.slice(-4, -2)}:${id.slice(-2)}` })) } } });
  const onPortal = (name, extra = {}) => ({ slug: name.toLowerCase().replace(/ /g, '-'), name, kind: 'area', pendingUpdate: false, lastDeliveryAt: '2026-09-06 00:00:00', ...extra });
  const oct20 = rv('2026-10-01', [m('Beaconsfield'), m('Cambridge Road'), m('Ermine Street'), m('March'), m('Ely', { answer: ok })]);
  const portal20 = { maps: [onPortal('Beaconsfield', { lastDeliveryAt: '2026-10-17 21:50:53' }), onPortal('Cambridge Road', { pendingUpdate: true }), onPortal('Ermine Street', { lastDeliveryAt: '2026-10-02 03:00:00' }), onPortal('March'), onPortal('Ely')] };
  const every = () => mfOf([NEW]);
  const live20 = waitingItems([oct20], { assets: 'X:/assets', portal: portal20, manifestOf: every });
  const peter20 = live20.filter((r) => r.key === 'ink-waiting-2026-10-01');
  check('THE 2026-10-20 CASE: with the portal read, the row names only the map that needs Peter', peter20.length === 1 && /^March — /.test(peter20[0].why) && /1 map waiting/.test(peter20[0].title) && live20.length === 1, JSON.stringify(live20.map((r) => [r.key, r.why.split(' — ')[0]])));
  const rec20 = waitingItems([oct20], { assets: 'X:/assets', manifestOf: every });
  check('  and with no portal the same record names all four, as before OA-658 — the portal is what turned it', rec20.length === 1 && /^Beaconsfield, Cambridge Road, Ermine Street, March — /.test(rec20[0].why), JSON.stringify(rec20.map((r) => r.why.split(' — ')[0])));
  const down20 = waitingItems([oct20], { assets: 'X:/assets', portal: { error: 'the portal could not be read (/api/maps -> 503)' }, manifestOf: every });
  check('a portal that could not be read keeps the record\'s list and says so, never silence', down20.length === 1 && /^Beaconsfield, Cambridge Road, Ermine Street, March — /.test(down20[0].why) && /portal was not read/.test(down20[0].why), JSON.stringify(down20.map((r) => r.why)));
  check('  and a read portal does not carry that warning', !/portal was not read/.test(peter20[0].why));
  const allSent = waitingItems([rv('2026-10-01', [m('Beaconsfield'), m('Ermine Street')])], { portal: portal20, manifestOf: every });
  check('a review whose every waiting map was delivered raises no row for Peter', !allSent.length, JSON.stringify(allSent));
  const rebuilt = waitingItems([rv('2026-10-01', [m('March'), m('Ely Co-op')])], { assets: 'X:/assets', portal: { maps: [onPortal('March'), onPortal('Ely Co-op')] }, manifestOf: (e) => mfOf(e.map === 'March' ? [NEW, REB] : [NEW]) });
  const recRow = rebuilt.find((r) => r.key === 'ink-recollect-2026-10-01'), askRow = rebuilt.find((r) => r.key === 'ink-waiting-2026-10-01');
  check('a map rebuilt since collection is a re-collect row for a session, rank 7, not Peter\'s', recRow && recRow.rank === 7 && /^March — /.test(recRow.why) && recRow.do[0].cmd === 'node ink_review.mjs --scan 2026-10-01' && recRow.who !== 'Peter', JSON.stringify(recRow));
  check('  and is off Peter\'s row, which keeps the unanswered one', askRow && /^Ely Co-op — /.test(askRow.why), JSON.stringify(askRow));
  const unsure = waitingItems([rv('2026-10-01', [m('March'), m('Ramsey')])], { portal: { maps: [onPortal('March'), onPortal('Ramsey')] }, manifestOf: (e) => { if (e.map === 'Ramsey') throw new Refused('Areas/Ramsey/manifest.json is there and is not valid JSON'); return null; } });
  check('a map whose verdict cannot be told stays on Peter\'s row (no manifest, or one that will not parse)', unsure.length === 1 && /^March, Ramsey — /.test(unsure[0].why), JSON.stringify(unsure.map((r) => r.why.split(' — ')[0])));
  const off = waitingItems([rv('2026-10-01', [m('Chatteris'), m('March')])], { portal: { maps: [onPortal('March')] }, manifestOf: every });
  check('a map the portal does not hold is not asked about — its accept would deliver nothing', off.length === 1 && /^March — /.test(off[0].why), JSON.stringify(off.map((r) => r.why.split(' — ')[0])));
}

console.log('\n10. A session answers by rule only when the words are the same and every engine commit was accepted elsewhere (2026-10-14)');
{
  const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40), SHA_X = 'c'.repeat(40);
  /* One map, two builds, each a set of sheets and a routes.json; `commits` is what the engine says lies between them, by kind. */
  const svgOf = (x, words) => `<svg><g transform="translate(${x})">${words.map((w, i) => `<text x="${i}"><tspan>${w}</tspan></text>`).join('')}</g><text>${S('1.0', '1 Oct 2026')}</text></svg>`;
  const WORDS = ['Services', '7 &amp; 8', 'to Ely', 'Market Place'];
  const routes = (commit, extra = {}) => JSON.stringify({ engine: commit.slice(0, 10), engineCommit: commit, version: '1.0', design: { sheetVersion: S('1.0', '1 Oct 2026') }, ...extra });
  const fixture = ({ before = { 'internal.svg': svgOf(1, WORDS) }, after = { 'internal.svg': svgOf(2, WORDS) }, rb = routes(SHA_X), ra = routes(SHA_A), commits = { 'area:internal': [{ sha: SHA_A, subject: 'place the arrow' }] }, kind = 'area' } = {}) => {
    const entry = { map: 'March', kind, dir: 'Areas/March', status: 'ink-moved', before: OLD, after: NEW, sheets: [], answer: null };
    const files = { [OLD]: before, [NEW]: after }, inputs = { [OLD]: rb == null ? {} : { 'routes.json': rb }, [NEW]: { 'routes.json': ra } };
    const io = {
      readManifest: () => ({ stages: { S4: { runs: [OLD, NEW].map((id) => ({ id, dir: `S4-generate/${id}`, outputs: Object.keys(files[id]) })) } } }),
      readSheet: (f) => { const [id, name] = f.replace(/\\/g, '/').split('/').slice(-2); return files[id] ? files[id][name] ?? null : null; },
      readInputs: (d) => inputs[d.replace(/\\/g, '/').split('/').pop()] || {},
    };
    const engine = { commitsIn: (from, to, k) => ({ status: 'ok', commits: commits[k] || [] }) };
    return { entry, evidenceFor: (m, b, a) => gatherEvidence({ busesDir: BUSES, entry: m, before: b, after: a, io, engine }) };
  };
  /* Peter's accept of SHA_A on another map, for internal sheets: the first sighting. */
  const seen = (over = {}) => ({ scan: '2026-09-01', review: { maps: [{ map: 'Ely', answer: { verdict: 'accept', by: 'peter', at: '2026-09-02T00:00:00Z', after: 'v1.0_2026-09-02_0000', engine: { from: SHA_X, to: SHA_A, commits: [{ sha: SHA_A, subject: 'place the arrow', kinds: ['area:internal'] }] }, ...over } }] } });
  const verdict = (fx, reviews = [seen()]) => decide({ entry: fx.entry, evidence: fx.evidenceFor(fx.entry, OLD, NEW), register: registerFrom(reviews) });

  check('svgText reads every string in order, decodes entities, strips tspans and neutralises the stamp', JSON.stringify(svgText(svgOf(0, WORDS))) === JSON.stringify(['Services', '7 & 8', 'to Ely', 'Market Place', 'build ·']));
  check('textChange: identical strings are no change', textChange(['a', 'b'], ['a', 'b']) === null);
  check('textChange: the same strings drawn in another order are not a change of words', textChange(['a', 'b'], ['b', 'a']).changed === false);
  check('textChange: a re-wrapped line is not a change of words', textChange(['x', 'one two', 'three'], ['x', 'one', 'two three']).changed === false);
  check('textChange: one word altered IS a change', textChange(['to Ely', 'b'], ['to Elyy', 'b']).changed === true);

  const base = fixture();
  const ok = verdict(base);
  check('a moved sheet with the same words, the same inputs and a commit Peter accepted on Ely is accepted by rule', ok.verdict === 'accept' && /accepted on Ely by peter/.test(ok.note), JSON.stringify(ok));
  const worded = verdict(fixture({ after: { 'internal.svg': svgOf(2, ['Services', '7 &amp; 8', 'to Elyy', 'Market Place']) } }));
  check('A TEXT CHANGE REFUSES SELF-ACCEPTANCE, however well the ink is attributed', worded.verdict === 'waiting' && /text on internal\.svg changed: added "to Elyy"; removed "to Ely"/.test(worded.reason), JSON.stringify(worded));
  const gone = verdict(fixture({ after: { 'internal.svg': svgOf(2, ['Services', '7 &amp; 8', 'to Ely']) } }));
  check('  and so does a string dropped', gone.verdict === 'waiting' && /removed "Market Place"/.test(gone.reason), JSON.stringify(gone));
  check('  while the same words in another draw order are accepted', verdict(fixture({ after: { 'internal.svg': svgOf(2, [...WORDS].reverse()) } })).verdict === 'accept');
  check('a build whose provenance alone differs (engine, engineCommit, version, sheetVersion) has unchanged inputs', verdict(fixture({ ra: routes(SHA_A, { version: '9.9', design: { sheetVersion: S('9.9', '9 Oct 2026') } }) })).verdict === 'accept');
  const knob = verdict(fixture({ ra: routes(SHA_A, { design: { sheetVersion: 'x', strandedOnInk: false } }) }));
  check('a hand config change is not an engine commit, and waits', knob.verdict === 'waiting' && /inputs changed — routes\.json \(design\)/.test(knob.reason), JSON.stringify(knob));
  const unseen = verdict(base, []);
  check('a commit Peter has accepted nowhere waits, naming the commit', unseen.verdict === 'waiting' && /aaaaaaa "place the arrow" moves area:internal ink and Peter has not accepted it on another map/.test(unseen.reason), JSON.stringify(unseen));
  const sameMap = seen(); sameMap.review.maps[0].map = 'March';
  check('a sighting on THIS map is not a sighting on another', verdict(base, [sameMap]).verdict === 'waiting');
  const otherKind = seen(); otherKind.review.maps[0].answer.engine.commits[0].kinds = ['area:external'];
  check('a sighting on another kind of sheet does not vouch for this one', verdict(base, [otherKind]).verdict === 'waiting');
  check('a self-answer is never a sighting, so the rule cannot stand on its own output', verdict(base, [seen({ self: true })]).verdict === 'waiting');
  check('a superseded accept still counts: Peter saw what he accepted', verdict(base, [{ scan: '2026-09-01', review: { maps: [{ map: 'Ely', answer: null, superseded: [seen().review.maps[0].answer] }] } }]).verdict === 'accept');
  const held = { scan: '2026-09-15', review: { maps: [{ map: 'Ramsey', answer: { ...seen().review.maps[0].answer, verdict: 'hold', by: 'peter', at: '2026-09-15T00:00:00Z' } }] } };
  const h = verdict(base, [seen(), held]);
  check('a commit Peter HELD on another map waits, though he accepted it elsewhere', h.verdict === 'waiting' && /was held on Ramsey/.test(h.reason), JSON.stringify(h));
  const healed = { scan: '2026-09-20', review: { maps: [{ map: 'Ramsey', answer: { ...seen().review.maps[0].answer, at: '2026-09-20T00:00:00Z' } }] } };
  check('  unless he later accepted it on that same map', verdict(base, [seen(), held, healed]).verdict === 'accept');
  const blank = verdict(fixture({ commits: {} }));
  check('a moved sheet with no engine commit touching its generator and no input change is unexplained, and waits', blank.verdict === 'waiting' && /nothing explains it/.test(blank.reason), JSON.stringify(blank));
  const old = verdict(fixture({ rb: null }));
  check('a before build that records no engineCommit waits', old.verdict === 'waiting' && /records no engineCommit/.test(old.reason), JSON.stringify(old));
  check('a sheet added is not a rollout', /external\.svg is new/.test(verdict(fixture({ after: { 'internal.svg': svgOf(2, WORDS), 'external.svg': '<svg/>' } })).reason || ''));
  check('a moved sheet no rule covers waits', /no rule covers/.test(verdict(fixture({ before: { 'poster.svg': svgOf(1, WORDS) }, after: { 'poster.svg': svgOf(2, WORDS) } })).reason || ''));
  check('sheet kinds: a place internal is not an area internal', sheetKind('place', 'internal.svg') === 'place:internal' && sheetKind('area', 'internal-schematic.svg') === 'area:schematic' && sheetKind('area', 'boarding.svg') === null);

  /* The pass, the record, the gate and the row. */
  const answered = { map: 'Soham', kind: 'area', dir: 'Areas/Soham', status: 'ink-moved', before: OLD, after: NEW, sheets: [], answer: { verdict: 'hold', by: 'peter', at: 'x', after: NEW, note: null } };
  const wordy = fixture({ after: { 'internal.svg': svgOf(2, ['Services', 'to Elyy']) } });
  const rv10 = { schema: SCHEMA, scan: SCAN, maps: [base.entry, { ...base.entry, map: 'Wordy' }, answered] };
  const pass = selfAnswer(rv10, { by: 'buses-99', at: '2026-10-14T00:00:00Z', register: registerFrom([seen()]), evidenceFor: (m, b, a) => (m.map === 'Wordy' ? wordy : base).evidenceFor(m, b, a) });
  const got = Object.fromEntries(pass.review.maps.map((m) => [m.map, m]));
  check('the pass accepts by rule with self: true, the session named and the sightings recorded', got.March.answer && got.March.answer.self === true && got.March.answer.by === 'buses-99' && got.March.answer.engine.commits[0].sha === SHA_A, JSON.stringify(got.March.answer));
  check('  leaves a text change waiting with selfCheck and its one-line reason', !got.Wordy.answer && got.Wordy.selfCheck.after === NEW && /text on internal\.svg changed/.test(got.Wordy.selfCheck.reason), JSON.stringify(got.Wordy));
  check('  and never touches a map Peter has already answered', got.Soham.answer.verdict === 'hold' && !got.Soham.selfCheck && pass.results.length === 2);
  const gate = deliverable(pass.review);
  check('the gate delivers the self-accepted map and keeps the refused one waiting', gate.deliver.includes('March') && gate.waiting.includes('Wordy') && gate.held.includes('Soham'), JSON.stringify(gate));
  check('a self-answer never needs --by to be guessed', (() => { try { selfAnswer(rv10, { by: '', at: 'x', register: [], evidenceFor: () => null }); return false; } catch { return true; } })());
  check('the page says why a map could not be answered by rule, and marks one that was', /Not answerable by rule: the text on internal\.svg changed/.test(page(pass.review)) && /by buses-99 \(by rule\)/.test(page(pass.review)));
  const row = waitingItems([{ scan: SCAN, review: pass.review, page: true }], { assets: 'X:/assets' })[0];
  check('the worklist row carries the reason, and offers no self-answer once every waiting map was tried', /Not answerable by rule — Wordy: the text on internal\.svg changed/.test(row.why) && !row.do.some((s) => /--self-answer/.test(s.cmd || '')), JSON.stringify(row));
  const again = mergeAnswers(pass.review, { ...pass.review, maps: pass.review.maps.map((m) => ({ ...m, answer: null, selfCheck: undefined })) });
  check('a re-collection of the same build keeps the self-answer\'s reason', again.maps.find((m) => m.map === 'Wordy').selfCheck?.reason === got.Wordy.selfCheck.reason);
  const rebuilt = mergeAnswers(pass.review, { ...pass.review, maps: pass.review.maps.map((m) => ({ ...m, after: 'v9.9_2026-10-20_0000', answer: null, selfCheck: undefined })) });
  check('  and drops it once the map is rebuilt', !rebuilt.maps.find((m) => m.map === 'Wordy').selfCheck);
  const peter = answer(pass.review, 'Wordy', 'accept', { by: 'peter', at: 'y', engine: recordable(wordy.evidenceFor(wordy.entry, OLD, NEW)) });
  const pw = peter.maps.find((m) => m.map === 'Wordy');
  check('Peter\'s answer clears selfCheck and records his sightings', !pw.selfCheck && pw.answer.engine && pw.answer.engine.commits[0].kinds.join() === 'area:internal' && !pw.answer.self, JSON.stringify(pw));
  const fill = backfillEngine({ ...rv10, maps: [{ ...base.entry, answer: { verdict: 'accept', by: 'peter', at: 'z', after: NEW } }, { ...base.entry, map: 'Selfie', answer: { verdict: 'accept', by: 's', at: 'z', after: NEW, self: true } }] }, { evidenceFor: base.evidenceFor });
  check('backfill gives an older answer of Peter\'s its sightings, and never a self-answer', fill.filled === 1 && fill.review.maps[0].answer.engine.commits[0].sha === SHA_A && !fill.review.maps[1].answer.engine, JSON.stringify(fill.review.maps.map((m) => m.answer)));

  /* OA-643: an OA-437 adoption counts like an engine commit, and the first map to adopt stays Peter's. */
  const NOTE = { text: 'School services also call here', size: 2.7 };
  const typedRoutes = (extra = {}) => routes(SHA_X, { mapNotes: [{ ...NOTE, x: 10, y: 90, w: 60 }], legendAt: { x: 1, y: 2 }, ...extra });
  const adoptedRoutes = (extra = {}) => routes(SHA_A, { mapNotes: [{ ...NOTE, near: { x: 10, y: 90 } }], ...extra });
  const adoptSeen = (labels = ['mapNotes.near', 'legendAt'], kinds = ['area:internal']) => ({ scan: '2026-10-01', review: { maps: [{ map: 'Beaconsfield Simpson Centre', answer: { verdict: 'accept', by: 'peter', at: '2026-10-02T00:00:00Z', after: 'v1.45_2026-10-13_1950', engine: { from: SHA_X, to: SHA_X, commits: labels.map((l) => ({ sha: `adopt:${l}`, subject: `OA-437 adoption of ${l}`, kinds })) } } }] } });
  const adopt = fixture({ rb: typedRoutes(), ra: adoptedRoutes() });
  const ad = verdict(adopt, [seen(), adoptSeen()]);
  check('an adoption Peter accepted on another map is accepted by rule, and the note says it was an adoption', ad.verdict === 'accept' && /differ only by the OA-437 adoption of legendAt, mapNotes\.near/.test(ad.note) && /adopt:mapNotes\.near \(accepted on Beaconsfield Simpson Centre by peter\)/.test(ad.note), JSON.stringify(ad));
  const first = verdict(adopt, [seen()]);
  check('THE FIRST MAP TO ADOPT STAYS PETER\'S: with no accept of the adoption elsewhere it waits, naming it', first.verdict === 'waiting' && /adopt:legendAt "OA-437 adoption of legendAt" moves area:internal ink and Peter has not accepted it on another map/.test(first.reason), JSON.stringify(first));
  check('  and an accept of only one of its adoptions vouches for neither the other nor the whole', verdict(adopt, [seen(), adoptSeen(['mapNotes.near'])]).verdict === 'waiting');
  check('  and an adoption accepted on an external sheet does not vouch for an internal one', verdict(adopt, [seen(), adoptSeen(undefined, ['area:external'])]).verdict === 'waiting');
  check('  and a self-answered adoption is never a sighting', verdict(adopt, [seen(), (() => { const s = adoptSeen(); s.review.maps[0].answer.self = true; return s; })()]).verdict === 'waiting');
  const alone = verdict(fixture({ rb: typedRoutes(), ra: routes(SHA_X, { mapNotes: [{ ...NOTE, near: { x: 10, y: 90 } }] }), commits: {} }), [adoptSeen()]);
  check('an adoption with no engine commit at all explains the moved ink by itself', alone.verdict === 'accept', JSON.stringify(alone));
  const switched = verdict(fixture({ rb: typedRoutes(), ra: adoptedRoutes({ design: { sheetVersion: 'x', strandedOnInk: false } }) }), [seen(), adoptSeen()]);
  check('A PER-MAP SWITCH STAYS WITH PETER, even riding on an adoption he accepted elsewhere', switched.verdict === 'waiting' && /neither an engine commit, an OA-437 adoption nor a ruling of Peter.s explains/.test(switched.reason), JSON.stringify(switched));
  const moved = verdict(fixture({ rb: typedRoutes(), ra: routes(SHA_A, { mapNotes: [{ ...NOTE, x: 50, y: 90, w: 60 }], legendAt: { x: 1, y: 2 } }) }), [seen(), adoptSeen()]);
  check('a typed coordinate moved by hand is not an adoption', moved.verdict === 'waiting' && /inputs changed/.test(moved.reason), JSON.stringify(moved));
  check('a knob ADDED is not an adoption', verdict(fixture({ rb: routes(SHA_X), ra: routes(SHA_A, { legendAt: { x: 1, y: 2 } }) }), [seen(), adoptSeen()]).verdict === 'waiting');
  check('a note whose words changed as it was adopted is not an adoption', verdict(fixture({ rb: typedRoutes(), ra: adoptedRoutes({ mapNotes: [{ ...NOTE, text: 'Other words', near: { x: 10, y: 90 } }] }) }), [seen(), adoptSeen()]).verdict === 'waiting');
  check('a note that kept its w is not adopted, because the search sets the width', verdict(fixture({ rb: typedRoutes(), ra: adoptedRoutes({ mapNotes: [{ ...NOTE, near: { x: 10, y: 90 }, w: 60 }] }) }), [seen(), adoptSeen()]).verdict === 'waiting');
  const hp = verdict(fixture({ rb: routes(SHA_X, { mapNotes: [{ ...NOTE, x: 10, y: 90 }] }), ra: routes(SHA_A, { mapNotes: [{ ...NOTE, x: 10, y: 90, handPlaced: 'in the title band' }] }) }));
  check('a handPlaced reason added to a typed note needs no sighting, since it moves no ink', hp.verdict === 'accept' && /differ only by a handPlaced reason or a fact tag \(neither moves ink\)/.test(hp.note), JSON.stringify(hp));
  /* OA-648's fact tags are read by fact_notes.js --check and never by a generator. */
  const TAGS = { fact: 'SF-011', factWords: 'keeps the pickup-area point' };
  const tagged = verdict(fixture({ rb: routes(SHA_X, { mapNotes: [{ ...NOTE, x: 10, y: 90 }] }), ra: routes(SHA_A, { mapNotes: [{ ...NOTE, x: 10, y: 90, ...TAGS }] }) }));
  check('a fact tag and its factWords added to a note need no sighting, since no generator reads them', tagged.verdict === 'accept' && /a fact tag \(neither moves ink\)/.test(tagged.note), JSON.stringify(tagged));
  const thenTag = verdict(fixture({ rb: routes(SHA_X, { mapNotes: [{ ...NOTE, then: [{ text: 'Ring 01354 661234' }] }] }), ra: routes(SHA_A, { mapNotes: [{ ...NOTE, then: [{ text: 'Ring 01354 661234', fact: 'SF-011' }] }] }) }));
  check('  and so does a fact tag on a then paragraph', thenTag.verdict === 'accept', JSON.stringify(thenTag));
  check('  but a fact tag riding on a note whose words changed still waits', verdict(fixture({ rb: routes(SHA_X, { mapNotes: [{ ...NOTE, x: 10, y: 90 }] }), ra: routes(SHA_A, { mapNotes: [{ ...NOTE, text: 'Other words', x: 10, y: 90, ...TAGS }] }) })).verdict === 'waiting');
  check('  and so does one on a then paragraph whose words changed', verdict(fixture({ rb: routes(SHA_X, { mapNotes: [{ ...NOTE, then: [{ text: 'Ring 01354 661234' }] }] }), ra: routes(SHA_A, { mapNotes: [{ ...NOTE, then: [{ text: 'Ring 01354 999999', fact: 'SF-011' }] }] }) })).verdict === 'waiting');
  check('  and a fact tag beside a moved typed coordinate still waits', verdict(fixture({ rb: routes(SHA_X, { mapNotes: [{ ...NOTE, x: 10, y: 90 }] }), ra: routes(SHA_A, { mapNotes: [{ ...NOTE, x: 50, y: 90, ...TAGS }] }) })).verdict === 'waiting');
  const other = fixture({ rb: typedRoutes(), ra: adoptedRoutes() });
  const otherInputs = other.evidenceFor(other.entry, OLD, NEW);
  check('recordable writes the adoption onto the answer, so Peter\'s --answer accept becomes the sighting', JSON.stringify(recordable(otherInputs).commits.map((c) => c.sha)) === JSON.stringify([SHA_A, 'adopt:legendAt', 'adopt:mapNotes.near']), JSON.stringify(recordable(otherInputs)));
}

console.log('\n11. The deliverable verdict is asked of the manifest and the portal at read time (OA-658)');
await (async () => {
  const B1 = 'v1.45_2026-10-13_1950', B2 = 'v1.46_2026-10-19_2006';
  const mf = (builds, renders = builds) => ({ stages: {
    S4: { runs: builds.map((id) => ({ id, dir: `S4-generate/${id}`, outputs: ['internal.svg'] })) },
    S5: { runs: renders.map((id) => ({ id, dir: `S5-render/${id}`, version: id.slice(1).split('_')[0], at: `${runDate(id)}T${id.slice(-4, -2)}:${id.slice(-2)}` })) } } });
  const ent = (extra = {}) => ({ map: 'Beaconsfield Simpson Centre', kind: 'place', dir: 'Areas/Beaconsfield/Places/Beaconsfield Simpson Centre', why: 'named', status: 'ink-moved', before: 'v1.30_2026-09-20_1000', after: B2, sheets: [], answer: { verdict: 'accept', by: 'peter', at: 'T', after: B2 }, ...extra });
  const pm = (extra = {}) => ({ slug: 'beaconsfield-simpson-centre', name: 'Beaconsfield Simpson Centre', kind: 'place', pendingUpdate: false, lastDeliveryAt: '2026-10-13 20:00:00', ...extra });
  const v = (e, { manifest = mf([B1, B2]), maps = [pm()], portal } = {}) => liveVerdict(e, { manifest, portal: portal || { maps }, scan: SCAN });

  check('an accept of the newest build, rendered, on the portal and not yet sent there, is deliver', v(ent()).verdict === 'deliver' && v(ent()).portalMap === 'beaconsfield-simpson-centre', JSON.stringify(v(ent())));
  /* The case itself: the record's accept and after are v1.45, the disk's newest build is v1.46. */
  const stale = ent({ after: B1, answer: { verdict: 'accept', by: 'peter', at: 'T', after: B1 } });
  check('THE 2026-10-20 CASE: an accept of v1.45 with v1.46 on disk is re-collect, not deliver', v(stale).verdict === 'recollect' && /rebuilt as v1\.46.*accept was for v1\.45/.test(v(stale).why), JSON.stringify(v(stale)));
  check('  and the record-only gate called it deliver — the read of the manifest is what changed the answer', deliverable({ maps: [stale] }).deliver.join() === 'Beaconsfield Simpson Centre');
  check('  and with v1.45 still the newest build it IS deliverable', v(stale, { manifest: mf([B1]), maps: [pm({ lastDeliveryAt: '2026-10-01 00:00:00' })] }).verdict === 'deliver');
  check('an accept for an older build than the record\'s is needs Peter, with the build named', v(ent({ answer: { verdict: 'accept', by: 'p', at: 'T', after: B1 } })).verdict === 'needsPeter' && /not answered for v1\.46/.test(v(ent({ answer: { verdict: 'accept', by: 'p', at: 'T', after: B1 } })).why));
  check('an unanswered ink-moved map is needs Peter', v(ent({ answer: null })).verdict === 'needsPeter');
  check('a held one is needs Peter, with his reason', /held v1\.46_2026-10-19_2006 \(the icon is doubled\)/.test(v(ent({ answer: { verdict: 'hold', by: 'p', at: 'T', after: B2, note: 'the icon is doubled' } })).why));
  check('no ink moved and the newest build is deliver', v(ent({ status: 'no-ink', answer: null })).verdict === 'deliver');
  check('  and no ink moved on an OLDER build is re-collect, not deliver', v(ent({ status: 'no-ink', answer: null, after: B1 })).verdict === 'recollect');
  /* Chatteris on 2026-10-20: in the review, not on the portal. */
  const chat = { map: 'Chatteris', dir: 'Areas/Chatteris', status: 'no-ink', before: B1, after: B2, sheets: [], answer: null };
  check('THE CHATTERIS CASE: a map the portal does not hold is not on the portal, never deliver', v(chat, { maps: [pm()] }).verdict === 'offPortal' && /no area map named "Chatteris"/.test(v(chat, { maps: [pm()] }).why));
  check('  and with a Chatteris on the portal the same entry IS deliver — the portal\'s list is what refused it', v(chat, { maps: [{ ...pm(), slug: 'chatteris', name: 'Chatteris', kind: 'area' }] }).verdict === 'deliver');
  check('an area is joined by its exact name only — "Ely" is not "Ely Co-op"', v({ ...chat, map: 'Ely', dir: 'Areas/Ely' }, { maps: [{ ...pm(), slug: 'ely-co-op', name: 'Ely Co-op', kind: 'area' }] }).verdict === 'offPortal');
  check('a place is joined by a portal name that contains it, as the worklist joins them', v(ent({ map: 'Simpson Centre' })).portalMap === 'beaconsfield-simpson-centre');
  check('  but never across kinds: an area of that name is not the place', v(ent(), { maps: [pm({ kind: 'area' })] }).verdict === 'offPortal');
  check('an update already waiting on its customer is already staged, though the record does not say so', v(ent(), { maps: [pm({ pendingUpdate: true })] }).verdict === 'staged' && /record it with ink_review\.mjs --staged/.test(v(ent(), { maps: [pm({ pendingUpdate: true })] }).why));
  /* The 01:02 hand delivery: v1.46 rendered 19:06 UTC on the 19th, the portal received it 00:04 UTC on the 20th. */
  check('a portal that received the map after this render was cut is already staged', v(ent(), { maps: [pm({ lastDeliveryAt: '2026-10-20 00:04:19' })] }).verdict === 'staged');
  check('  and one that received it before the render is not — the time join is what turned it', v(ent(), { maps: [pm({ lastDeliveryAt: '2026-10-19 19:05:59' })] }).verdict === 'deliver');
  check('  at the same minute the delivery is taken to carry the render', v(ent(), { maps: [pm({ lastDeliveryAt: '2026-10-19 20:06:00' })] }).verdict === 'staged');
  check('  and a map never delivered is not staged by time', v(ent(), { maps: [pm({ lastDeliveryAt: null })] }).verdict === 'deliver');
  check('the record\'s own staging of this build is already staged', v(ent({ staged: { after: B2, by: 'x', at: 'T', proposal: 186 } })).verdict === 'staged');
  check('  and its staging of an older build is not', v(ent({ staged: { after: B1, by: 'x', at: 'T' } })).verdict === 'deliver');
  const down = { error: 'the portal could not be read (/api/maps -> 503)' };
  check('a portal that cannot be read is cannot tell, never deliver', v(ent(), { portal: down }).verdict === 'cannotTell' && /503/.test(v(ent(), { portal: down }).why));
  check('  unless the record already says this build is staged', v(ent({ staged: { after: B2, by: 'x', at: 'T' } }), { portal: down }).verdict === 'staged');
  check('an accepted build with no render of it is cannot tell', v(ent(), { manifest: mf([B1, B2], [B1]) }).verdict === 'cannotTell' && /no S5 render yet/.test(v(ent(), { manifest: mf([B1, B2], [B1]) }).why));
  check('no manifest is cannot tell', v(ent(), { manifest: null }).verdict === 'cannotTell');
  check('a manifest with no sheet-bearing S4 is cannot tell', v(ent(), { manifest: { stages: { S4: { runs: [{ id: B2, outputs: ['x.jpg'] }] } } } }).verdict === 'cannotTell');
  check('newestBuild sorts by name, not manifest order', newestBuild(mf([B2, B1])).id === B2);
  const all = liveDeliverable({ scan: SCAN, maps: [ent(), chat, { ...ent(), map: 'Broken' }] }, { manifestOf: (m) => { if (m.map === 'Broken') throw new Refused('Broken/manifest.json is there and is not valid JSON'); return mf([B1, B2]); }, portal: { maps: [pm()] } });
  check('liveDeliverable sorts every map, and one broken manifest is that map\'s cannot tell', all.deliver.map((x) => x.map).join() === 'Beaconsfield Simpson Centre' && all.offPortal.map((x) => x.map).join() === 'Chatteris' && all.cannotTell.map((x) => x.map).join() === 'Broken', JSON.stringify(all));
  check('  and every bucket is present, empty or not', LIVE.every((k) => Array.isArray(all[k])));
  const fake = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
  check('fetchPortalMaps with no URL or token is an error, never an empty list', !!(await fetchPortalMaps({ base: '', token: '' })).error);
  check('  and a non-200 is an error naming it', /-> 401/.test((await fetchPortalMaps({ base: 'https://x', token: 't', fetchFn: fake(401, {}) })).error || ''));
  check('  and a body with no maps list is an error', !!(await fetchPortalMaps({ base: 'https://x', token: 't', fetchFn: fake(200, {}) })).error);
  check('  and a good one is its maps', (await fetchPortalMaps({ base: 'https://x/', token: 't', fetchFn: fake(200, { maps: [pm()] }) })).maps[0].slug === 'beaconsfield-simpson-centre');
})();

console.log('\n12. A ruling of Peter\'s covers the words it names, and a delivery he queued is his accept (OA-659)');
{
  const SHA_A = 'a'.repeat(40);
  const B0 = 'v1.38_2026-10-01_1000', B1 = 'v1.39_2026-10-13_2351', B2 = 'v1.40_2026-10-19_2006';
  const OLD31 = 'Mon–Sat · Carousel · via Holtspur, Penn & Hazlemere', NEW31 = 'Mon–Sat · Carousel · via Knotty Green, Penn & Hazlemere';
  const panel = (lines) => `<svg>${lines.map((w, i) => `<text y="${i}">${w.replace(/&/g, '&amp;')}</text>`).join('')}<text>${S('1.40', '19 Oct 2026')}</text></svg>`;
  const LINES = (d31, extra = []) => ['Services', '31  Beaconsfield – High Wycombe', ...(Array.isArray(d31) ? d31 : [d31]), 'Waitrose', ...extra];
  const routesOf = (d31, extra = {}) => JSON.stringify({ engine: 'x', engineCommit: SHA_A, version: '1.0', internalDesc: { 31: ['31  Beaconsfield – High Wycombe', d31], 105: ['105', 'via Coleshill & Chesham'] }, ...extra });
  const RULING = { by: 'peter', on: '2026-10-19', said: 'Peter approved both rulings', where: 'buses-data 3c4b5a87', set: { 'internalDesc.31.1': NEW31 } };
  /* One place map: S3 runs, S4 builds based on them, and what each build drew and was given. */
  const fx = ({ ruling = RULING, rulingOn = '2026-10-19_2005', after = panel(LINES(NEW31)), ra = routesOf(NEW31), rb = routesOf(OLD31), afterExt = null, commits = {} } = {}) => {
    const s3 = [{ id: '2026-10-01_0959' }, { id: '2026-10-13_2350' }, { id: '2026-10-19_2005' }].map((r) => (r.id === rulingOn && ruling ? { ...r, ruling } : r));
    const s4 = [[B0, '2026-10-01_0959'], [B1, '2026-10-13_2350'], [B2, '2026-10-19_2005']].map(([id, S3]) => ({ id, dir: `S4-generate/${id}`, version: id.slice(1).split('_')[0], basedOn: { S3 }, outputs: ['internal.svg', ...(afterExt ? ['external.svg'] : [])] }));
    const files = { [B0]: { 'internal.svg': panel(LINES(OLD31)), 'external.svg': '<svg><text>Ely</text></svg>' }, [B1]: { 'internal.svg': panel(LINES(OLD31)), 'external.svg': '<svg><text>Ely</text></svg>' }, [B2]: { 'internal.svg': after, 'external.svg': afterExt } };
    const inputs = { [B0]: { 'routes.json': rb }, [B1]: { 'routes.json': rb }, [B2]: { 'routes.json': ra } };
    const io = {
      readManifest: () => ({ stages: { S3: { runs: s3 }, S4: { runs: s4 } } }),
      readSheet: (f) => { const [id, name] = f.replace(/\\/g, '/').split('/').slice(-2); return files[id] ? files[id][name] ?? null : null; },
      readInputs: (d) => inputs[d.replace(/\\/g, '/').split('/').pop()] || {},
    };
    const engine = { commitsIn: (from, to, k) => ({ status: 'ok', commits: commits[k] || [] }) };
    const entry = { map: 'Beaconsfield Waitrose', kind: 'place', dir: 'Areas/Beaconsfield/Places/Beaconsfield Waitrose', status: 'ink-moved', before: B1, after: B2, sheets: [], answer: null };
    return { entry, s4, evidenceFor: (m, b, a) => gatherEvidence({ busesDir: BUSES, entry: m, before: b, after: a, io, engine }) };
  };
  const ask = (f, register = []) => decide({ entry: f.entry, evidence: f.evidenceFor(f.entry, B1, B2), register });

  const ok = ask(fx());
  check('THE 3c4b5a87 CASE: the one line Peter ruled is accepted by rule, quoting his words and the S3 run', ok.verdict === 'accept' && /but for the words Peter ruled/.test(ok.note) && /ruling of internalDesc\.31\.1 \(S3 2026-10-19_2005, "Peter approved both rulings"/.test(ok.note) && ok.ruled.join() === 'internalDesc.31.1', JSON.stringify(ok));
  const none = ask(fx({ ruling: null }));
  check('  and the same build with NO ruling waits on the changed text — the ruling is what turned it', none.verdict === 'waiting' && /text on internal\.svg changed: added "Mon–Sat · Carousel · via Knotty Green, …"/.test(none.reason), JSON.stringify(none));
  const wrong = ask(fx({ ruling: { ...RULING, set: { 'internalDesc.105.1': 'via Coleshill & Chesham' } } }));
  check('A RULING OF ANOTHER PATH DOES NOT COVER THIS LINE', wrong.verdict === 'waiting' && /changed beyond what Peter ruled: added "Mon–Sat · Carousel · via Knotty Green/.test(wrong.reason), JSON.stringify(wrong));
  const extra = ask(fx({ after: panel(LINES(NEW31, ['Penn Street'])) }));
  check('an unruled string beside the ruled one waits, naming only the unruled string', extra.verdict === 'waiting' && /beyond what Peter ruled: added "Penn Street"$/.test(extra.reason), JSON.stringify(extra));
  const reedited = ask(fx({ ra: routesOf(`${NEW31} & Amersham`), after: panel(LINES(`${NEW31} & Amersham`)) }));
  check('a ruled path changed again after the ruling is not covered, and the reason says so', reedited.verdict === 'waiting' && /internalDesc\.31\.1 in the after build is not what Peter ruled on S3 2026-10-19_2005/.test(reedited.reason), JSON.stringify(reedited));
  const session = ask(fx({ ruling: { ...RULING, by: 'sched-adhoc-0102' } }));
  check('a ruling not by Peter is not used', session.verdict === 'waiting' && /only Peter rules/.test(session.reason), JSON.stringify(session));
  check('a ruling that does not quote him is not used', /does not quote what Peter said/.test(ask(fx({ ruling: { ...RULING, said: ' ' } })).reason || ''));
  check('a ruling on the BEFORE build\'s own S3 run is not read, because that build already had it', ask(fx({ rulingOn: '2026-10-13_2350' })).verdict === 'waiting');
  check('a ruled line the engine wraps onto two lines is still the ruled words', ask(fx({ after: panel(LINES(['Mon–Sat · Carousel · via Knotty Green,', 'Penn & Hazlemere'])) })).verdict === 'accept');
  const cmt = ask(fx({ commits: { 'place:internal': [{ sha: 'c'.repeat(40), subject: 'move the panel' }] } }));
  check('a ruling covers words, not an engine commit nobody accepted elsewhere', cmt.verdict === 'waiting' && /ccccccc "move the panel" moves place:internal ink/.test(cmt.reason), JSON.stringify(cmt));
  const ext = ask(fx({ afterExt: '<svg><g transform="translate(1)"><text>Ely</text></g></svg>' }));
  check('a sheet that moved where no ruled word is, with no engine commit, is unexplained and waits', ext.verdict === 'waiting' && /external\.svg moved with no OA-437 adoption and no engine commit/.test(ext.reason), JSON.stringify(ext));
  const hand = ask(fx({ ra: routesOf(NEW31, { design: { strandedOnInk: false } }) }));
  check('a hand config change beside the ruled one still waits', hand.verdict === 'waiting' && /inputs changed — routes\.json \(design\)/.test(hand.reason), JSON.stringify(hand));

  /* Godmanchester Co-op Cambridge Road on 2026-10-20 (buses-data 28b77796): a ruled note line, with handPlaced reasons and a fact tag added since Peter's last accept. */
  const ENDS = 'Sat & Sun service whose registration ends 13 Sep 2026.', ENDED = 'Sat & Sun service that ended 13 Sep 2026.';
  const KEPT = 'kept where it was typed (OA-437, Peter 2026-10-15)';
  const DAR = { text: 'Dial-a-Ride (FACT): a pre-booked shopper bus.', x: 45, y: 156 };
  const notesB = [DAR, { text: ENDS, x: 45, y: 172 }];
  const notesA = (n0 = { ...DAR, handPlaced: KEPT, fact: 'SF-011', factWords: 'keeps the pickup-area point (OA-648)' }, t1 = ENDED) => [n0, { text: t1, x: 45, y: 172, handPlaced: KEPT }];
  const NOTE_RULING = { by: 'peter', on: '2026-10-18', said: 'Reword it to say the service ended', where: 'buses-data 5c13869d', set: { 'mapNotes.1.text': ENDED } };
  const cr = (o = {}) => ask(fx({ ruling: NOTE_RULING, rb: routesOf(OLD31, { mapNotes: notesB }), ra: routesOf(OLD31, { mapNotes: notesA() }), after: panel(LINES(OLD31, [ENDED])), ...o }));
  const crOk = cr();
  check('THE CAMBRIDGE ROAD CASE: a ruled note line composes with handPlaced reasons and a fact tag, and is accepted by rule', crOk.verdict === 'accept' && /differ only by a handPlaced reason or a fact tag \(neither moves ink\) and Peter's ruling of mapNotes\.1\.text/.test(crOk.note), JSON.stringify(crOk));
  check('  and with no ruling it waits on the words', /text on internal\.svg changed: added "Sat & Sun service that ended/.test(cr({ ruling: null }).reason || ''), JSON.stringify(cr({ ruling: null })));
  const crWords = cr({ ra: routesOf(OLD31, { mapNotes: notesA({ ...DAR, text: 'Dial-a-Ride: book ahead.', fact: 'SF-011' }) }) });
  check('  and a fact-tagged note whose words also changed is not explained by the ruling of another line', crWords.verdict === 'waiting' && /inputs changed — routes\.json \(mapNotes\)/.test(crWords.reason), JSON.stringify(crWords));
  const crSwitch = cr({ ra: routesOf(OLD31, { mapNotes: notesA(), design: { strandedOnInk: false } }) });
  check('  and a per-map switch beside them still waits', crSwitch.verdict === 'waiting' && /routes\.json \(mapNotes, design\)/.test(crSwitch.reason), JSON.stringify(crSwitch));

  /* Asked from the build Peter last accepted on this map, not from the review's before. */
  const three = fx({ commits: { 'place:internal': [] } });
  const fromB0 = { ...three.entry, before: B0 };
  const engineB0 = { commitsIn: (from, to, k) => ({ status: 'ok', commits: [] }) };
  check('acceptedBase is the newest earlier build Peter accepted', acceptedBase({ ...fromB0, superseded: [{ verdict: 'accept', by: 'peter', at: '1', after: B0 }, { verdict: 'accept', by: 'peter', at: '2', after: B1 }] }) === B1);
  check('  and a later hold of his means there is none', acceptedBase({ ...fromB0, superseded: [{ verdict: 'accept', by: 'peter', at: '1', after: B1 }, { verdict: 'hold', by: 'peter', at: '2', after: B1 }] }) === null);
  check('  and a self-answer is never a base', acceptedBase({ ...fromB0, before: 'v0', superseded: [{ verdict: 'accept', by: 's', self: true, at: '1', after: B1 }] }) === null);
  const sawB0 = (m, b, a) => { const ev = three.evidenceFor(m, b, a); return b === B0 && ev.status === 'ok' ? { ...ev, inputs: ['routes.json (design)'], adopted: null } : ev; };
  const passB = selfAnswer({ schema: SCHEMA, scan: SCAN, maps: [{ ...fromB0, superseded: [{ verdict: 'accept', by: 'peter', at: '2026-10-14T00:00:00Z', after: B1 }] }] }, { by: 'buses-99', at: 'T', register: [], evidenceFor: sawB0 });
  check('THE SECOND-ACCEPT CASE: with Peter\'s accept of the build before, a hand change since the review\'s before is his already, and the ruling is accepted', passB.results[0].outcome === 'accept' && /asked from v1\.39_2026-10-13_2351, which Peter accepted, not from v1\.38/.test(passB.results[0].why), JSON.stringify(passB.results));
  const passNoB = selfAnswer({ schema: SCHEMA, scan: SCAN, maps: [fromB0] }, { by: 'buses-99', at: 'T', register: [], evidenceFor: sawB0 });
  check('  and without that accept it is asked from the review\'s before, and waits', passNoB.results[0].outcome === 'waiting' && /inputs changed/.test(passNoB.results[0].why), JSON.stringify(passNoB.results));

  /* A delivery Peter queued. */
  const f = fx({ ruling: null });
  const order = (text, s4 = f.s4, entry = f.entry) => deliveryOrder(text, entry, s4);
  const QUEUED = 'Deliver Beaconsfield Simpson Centre v1.46 and Beaconsfield Waitrose v1.40 to the portal (busmaps.uk). Both were rebuilt on 2026-10-19.';
  check('THE QUEUED CASE: "Deliver … Beaconsfield Waitrose v1.40" names this build', order(QUEUED) === 'Deliver Beaconsfield Simpson Centre v1.46 and Beaconsfield Waitrose v1.40 to the portal (busmaps.uk).', String(order(QUEUED)));
  check('  and the full build id anywhere in the sentence does too', !!order(`Please deliver the Waitrose map, build ${B2}, today.`));
  check('"don\'t deliver" is not an order, though it names the build', order('Reword the note on Beaconsfield Waitrose v1.40, and don\'t deliver to the portal without asking.') === null);
  check('a sentence that does not start "Deliver" is not an order', order('Once Beaconsfield Waitrose v1.40 passes S6, deliver it.') === null);
  check('an older version named is not this build', order('Deliver Beaconsfield Waitrose v1.39 to the portal.') === null);
  check('  nor is a version that only begins the same way', order('Deliver Beaconsfield Waitrose v1.4 to the portal.') === null);
  check('another map\'s name ending in this one is not this map', order('Deliver Old Beaconsfield Waitrose v1.40.') === null);
  check('  but a list naming it after a comma is', !!order('Deliver Ely Co-op v1.36, Beaconsfield Waitrose v1.40.'));
  check('the run\'s own report under ## TAKEN is not Peter\'s words', order('Look at Waitrose.\n\n## TAKEN — 2026-10-20 by sched\n\nDeliver Beaconsfield Waitrose v1.40 next time.') === null);
  check('a version two S4 runs share names no one build, unless the full id is given', order('Deliver Beaconsfield Waitrose v1.40.', [...f.s4, { id: 'v1.40_2026-10-20_0101', version: '1.40' }]) === null && !!order(`Deliver ${B2}.`, [...f.s4, { id: 'v1.40_2026-10-20_0101', version: '1.40' }]));
  const passD = selfAnswer({ schema: SCHEMA, scan: SCAN, maps: [f.entry] }, { by: 'buses-99', at: 'T', register: [], evidenceFor: f.evidenceFor, ordersFor: (m) => { const s = order(QUEUED, f.s4, m); return s ? { file: 'adhoc/done/beaconsfield-portal-delivery.md', sentence: s } : null; } });
  const da = passD.review.maps[0].answer;
  check('a queued delivery is accepted with self: true and basis delivery, quoting the file and the sentence', da && da.self === true && da.basis === 'delivery' && /adhoc\/done\/beaconsfield-portal-delivery\.md says "Deliver Beaconsfield/.test(da.note), JSON.stringify(da));
  check('  where the rule alone would have waited on the text', ask(f).verdict === 'waiting');
  check('  and it is never a sighting for another map', registerFrom([{ scan: SCAN, review: passD.review }]).length === 0);

  /* Writing a ruling. */
  const man = () => ({ stages: { S3: { runs: [{ id: '2026-10-19_2005', dir: 'S3-config/2026-10-19_2005' }] } } });
  const ROUTES = JSON.parse(routesOf(NEW31));
  const read = (p) => p.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), ROUTES);
  const rec = recordRuling(man(), { s3: '2026-10-19_2005', paths: ['internalDesc.31.1'], said: 'Peter approved both rulings', where: 'buses-data 3c4b5a87', on: '2026-10-19', read });
  check('recordRuling reads the ruled value from the S3 run itself and writes it on that run', JSON.stringify(rec.manifest.stages.S3.runs[0].ruling) === JSON.stringify(RULING), JSON.stringify(rec.ruling));
  const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
  check('  and refuses a path the S3 run does not hold', throws(() => recordRuling(man(), { s3: '2026-10-19_2005', paths: ['internalDesc.99.1'], said: 'x', on: 'd', read }), /nothing at internalDesc\.99\.1/));
  check('  and refuses a ruling without Peter\'s words', throws(() => recordRuling(man(), { s3: '2026-10-19_2005', paths: ['internalDesc.31.1'], said: '', on: 'd', read }), /does not quote/));
  check('  and refuses an S3 run that is not there', throws(() => recordRuling(man(), { s3: '2026-01-01_0000', paths: ['internalDesc.31.1'], said: 'x', on: 'd', read }), /no S3 run/));
  check('  and never overwrites a different ruling', throws(() => recordRuling(rec.manifest, { s3: '2026-10-19_2005', paths: ['internalDesc.105.1'], said: 'x', on: 'd', read }), /already carries a different ruling/));
}

console.log(`\n${ran - bad} of ${ran} passed`);
process.exit(bad ? 1 : 0);
