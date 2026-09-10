#!/usr/bin/env node
/* Prove the loop/adhoc/ drop-zone row can appear, ages honestly, counts ONLY the
 * drop zone, and goes away (buses-data, 2026-09-10).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-loop-adhoc.mjs
 *
 * No placeholders; it builds real folders under the OS temp directory.
 *
 * THE CONTROL THAT MATTERS MOST IS CASE 4. `ready/`, `doing/` and `done/` live
 * INSIDE `loop/adhoc/`, and a reader that walked the tree would report as
 * "awaiting your triage" a prompt Peter has already promoted, a file a tick is
 * working on this minute, and every prompt ever finished. The row must count the
 * drop zone and nothing under it, so the case puts a file in each subfolder and
 * asserts the count is exactly one.
 *
 * THE SILENCE IS PROVED AGAINST A REAL DISK (cases 5-7), for the reason every
 * loop harness states: `loop/` is gitignored, the folder is absent in CI and in
 * every fixture, and a fake reader cannot be absent.
 *
 * THE WIRE IS ASSERTED ON LIVE LINES (case 9), never with a bare includes(): a
 * commented-out call still contains the string.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDraftsDir, parseDraft, loopDraftItems } from './loop_adhoc.mjs';
import { needsOf } from './concurrency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-loop-adhoc-'));
const mk = (dir, name, text) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text, 'utf8');
  return path.join(dir, name);
};
const NOW = Date.parse('2026-09-11T00:00:00Z');

// The three provenance shapes the ticks have actually written.
const DRAFTED_BY = '# The claim was keyed on the badge, and the file on the registration\n\nDrafted by `sched-1615` on 2026-09-08 while deciding SF-014. Inert — nothing will action this until Peter moves it to `ready/`.\n\n## What happened\n\nProse.\n';
const NOTICED_BY = '# The register\'s `queued:` line names fewer facts than the count beside it\n\nNoticed by `sched-1522` on 2026-09-08 while deciding SF-007.\n';
const FIELD = '# The heading a reader tidied was load-bearing\n\n**Drafted:** 2026-09-10 by `sched-1015` · **Status:** draft, not promoted.\n';

console.log('\n1. one draft, one row, aged from the stated date');
{
  const dir = path.join(tmp, 'one', 'loop', 'adhoc');
  mk(dir, 'the claim was keyed on the badge.md', DRAFTED_BY);
  const r = loopDraftItems({ files: readDraftsDir(dir), now: NOW });
  check('one row', r.length === 1, `got ${r.length}`);
  check('key is loop-drafts', r[0].key === 'loop-drafts', r[0].key);
  check('rank 7 — the bottom of YOUR MOVE', r[0].rank === 7, String(r[0].rank));
  check('title carries the count and the oldest age', r[0].title === '1 draft in loop/adhoc/ await your triage (oldest 3d)', r[0].title);
  check('the H1 is named inside the row, without markdown', r[0].why.includes('The claim was keyed on the badge, and the file on the registration (2026-09-08, sched-1615)'), r[0].why.slice(0, 200));
  check('ageDays is from the stated date, not the mtime', r[0].ageDays === 3, String(r[0].ageDays));
  check('the drafts are carried for --json', r[0].drafts.length === 1 && r[0].drafts[0].by === 'sched-1615', JSON.stringify(r[0].drafts));
}

console.log('\n2. the three provenance shapes all yield a date and a tick');
{
  const p1 = parseDraft({ name: 'a.md', text: DRAFTED_BY, mtimeMs: 0 });
  const p2 = parseDraft({ name: 'b.md', text: NOTICED_BY, mtimeMs: 0 });
  const p3 = parseDraft({ name: 'c.md', text: FIELD, mtimeMs: 0 });
  check('"Drafted by … on <date>"', p1.draftedOn === '2026-09-08' && p1.by === 'sched-1615', JSON.stringify(p1));
  check('"Noticed by … on <date>"', p2.draftedOn === '2026-09-08' && p2.by === 'sched-1522', JSON.stringify(p2));
  check('"**Drafted:** <date> by …"', p3.draftedOn === '2026-09-10' && p3.by === 'sched-1015', JSON.stringify(p3));
}

console.log('\n3. no date falls back to mtime; no H1 falls back to the filename');
{
  const dir = path.join(tmp, 'mtime', 'loop', 'adhoc');
  const f = mk(dir, 'bare note.md', 'Just a sentence somebody saved.\n');
  const past = new Date('2026-09-05T00:00:00Z');
  fs.utimesSync(f, past, past);
  const r = loopDraftItems({ files: readDraftsDir(dir), now: NOW });
  check('mtime decides the age', r[0].ageDays === 6, String(r[0].ageDays));
  check('the filename is the title', r[0].drafts[0].title === 'bare note', r[0].drafts[0].title);
  check('the row still appears', r[0].title.startsWith('1 draft in loop/adhoc/'), r[0].title);
}

console.log('\n4. THE CONTROL — ready/, doing/ and done/ are NOT counted');
{
  const dir = path.join(tmp, 'subfolders', 'loop', 'adhoc');
  mk(dir, 'a draft.md', FIELD);
  mk(path.join(dir, 'ready'), 'promoted.md', DRAFTED_BY);
  mk(path.join(dir, 'doing'), 'in-flight.md', DRAFTED_BY);
  mk(path.join(dir, 'done'), 'finished.md', DRAFTED_BY);
  mk(dir, 'notes.txt', 'not markdown');
  fs.mkdirSync(path.join(dir, 'a-directory.md'));   // a .md that is a directory
  const files = readDraftsDir(dir);
  check('exactly ONE file is read — the drop zone', files.length === 1 && files[0].name === 'a draft.md', files.map((f) => f.name).join(','));
  const r = loopDraftItems({ files, now: NOW });
  check('and the row counts one, not four', r[0].title.startsWith('1 draft in'), r[0].title);
  // The half that makes it a pair: a second file IN the drop zone is counted.
  mk(dir, 'b draft.md', NOTICED_BY);
  const r2 = loopDraftItems({ files: readDraftsDir(dir), now: NOW });
  check('a second drop-zone file makes two', r2[0].title.startsWith('2 drafts in') && r2[0].title.endsWith('(oldest 3d)'), r2[0].title);
  check('sorted by filename', r2[0].drafts[0].file === 'a draft.md', r2[0].drafts[0].file);
}

console.log('\n5-7. absent, empty, not-a-directory, unreadable file — all silent');
{
  const missing = path.join(tmp, 'nothing-here', 'loop', 'adhoc');
  check('absent folder: no rows, no throw', loopDraftItems({ files: readDraftsDir(missing) }).length === 0);
  check('undefined dir: no rows', readDraftsDir(undefined).length === 0);
  const empty = path.join(tmp, 'empty', 'loop', 'adhoc');
  fs.mkdirSync(empty, { recursive: true });
  check('empty folder: no rows', loopDraftItems({ files: readDraftsDir(empty) }).length === 0);
  // An empty drop zone with a full ready/ is the NORMAL state after a triage.
  mk(path.join(empty, 'ready'), 'promoted.md', DRAFTED_BY);
  check('empty drop zone beside a full ready/: still no row', loopDraftItems({ files: readDraftsDir(empty) }).length === 0);
  const notDir = path.join(tmp, 'notdir');
  fs.writeFileSync(notDir, 'I am a file, not a folder', 'utf8');
  check('a FILE where the folder should be: no rows, no throw', readDraftsDir(notDir).length === 0);
  const unreadable = path.join(tmp, 'unreadable', 'loop', 'adhoc');
  mk(unreadable, 'good.md', FIELD);
  fs.mkdirSync(path.join(unreadable, 'bad.md'));   // readdir says .md, readFileSync throws
  check('one unreadable entry does not take the others off the board', readDraftsDir(unreadable).length === 1);
}

console.log('\n8. the concurrency verdict — a triage touches no tree');
{
  check('loop-drafts contends with nothing', needsOf({ key: 'loop-drafts', type: 'loop-drafts' }).length === 0,
    JSON.stringify(needsOf({ key: 'loop-drafts', type: 'loop-drafts' })));
  check('MUTATION CONTROL — an unknown type still defaults to buses-tree', needsOf({ key: 'zzz', type: 'never-heard-of-it' }).join() === 'buses-tree');
}

console.log('\n9. the wire in worklist.mjs — literal strings, on live lines');
{
  const src = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  const liveLine = (lit) => src.split('\n').some((l) => l.includes(lit) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  for (const lit of [
    "import { readDraftsDir, loopDraftItems } from './loop_adhoc.mjs';",
    "readDraftsDir(path.join(BUSES, 'loop', 'adhoc'))",
    'for (const it of loopDrafts) add(it);',
  ]) check(`worklist.mjs RUNS: ${lit.slice(0, 58)}`, liveLine(lit), 'absent, or commented out');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
