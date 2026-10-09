#!/usr/bin/env node
/* Prove the "ad-hoc loop is not taking this" row appears, and stays away when it
 * should (buses-data OA-503; paths moved by OA-610).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets):
 *
 *   node prove-red-loop-ready.mjs
 *
 * WHAT IS BEING FALSIFIED. A row saying that a file in `adhoc/ready/` keeps
 * being named by the runs and is never taken. Every folder it reads is
 * gitignored, so, as in prove-red-loop-runs.mjs, every case builds real
 * directories under the temp dir. A fake reader cannot be absent.
 *
 * OA-610 (2026-10-08) moved the queue from `loop/adhoc/ready/` to a top-level
 * `adhoc/ready/`, and gave the ad-hoc loop its own run folder, `adhoc/runs/`.
 * The helper reads both `adhoc/runs/` and, for the 48 hours after the move,
 * `loop/runs/`; section 9 proves each folder is read, and that a file left in
 * the old `loop/adhoc/ready/` is not.
 *
 * THE CONTROLS MATTER AS MUCH AS THE ROW. The standing weekly triage sits in
 * ready/ all week and is correctly passed over as not due every hour. A row for
 * it would appear every day and soon be ignored. So each case that raises the
 * row is paired with the change that clears it: a tick takes the file, a tick
 * excuses it as not due, the file is young, or only one tick named it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReady, readRunsSince, verdict, adhocNotTakenItems, adhocNotTakenFor } from './loop_ready.mjs';
import { needsOf } from './concurrency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-loop-ready-'));
const at = (h, m = 0, d = 28) => new Date(2026, 8, d, h, m).getTime();
const pad = (n) => String(n).padStart(2, '0');

/**
 * A real buses root. `ready` is { name: mtimeMs }, written to `adhoc/ready/`.
 * `runs` is a list of [ms, feed, text], written as `2026-09-DD_HHMM-<feed>.md`
 * to `where` (`adhoc/runs` by default; `loop/runs` for a bus tick's file).
 */
const mkLoop = (label, ready, runs, where = 'adhoc/runs') => {
  const root = path.join(tmp, label);
  const rd = path.join(root, 'adhoc', 'ready');
  const rn = path.join(root, ...where.split('/'));
  fs.mkdirSync(rd, { recursive: true });
  fs.mkdirSync(rn, { recursive: true });
  for (const [name, ms] of Object.entries(ready)) {
    const p = path.join(rd, name);
    fs.writeFileSync(p, '# a request\n', 'utf8');
    fs.utimesSync(p, new Date(ms), new Date(ms));
  }
  for (const [ms, feed, text] of runs) {
    const d = new Date(ms);
    fs.writeFileSync(path.join(rn, `2026-09-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}-${feed}.md`), text, 'utf8');
  }
  return { root, rd, rn, where };
};
const rows = ({ rd, rn, where }, now) => adhocNotTakenItems({ ready: readReady(rd), runs: readRunsSince(rn, now - 48 * 3600000, where), now });
const keys = (rs) => rs.map((r) => r.key).sort().join(',');

// The line every tick on 28 September wrote, in substance.
const LISTED = '- **adhoc.** `ready/` is unchanged: `places-issues.md`, `wisbech-capacity.md` and `zz-weekly-backlog-triage.md` (not due until 2026-10-02).\n';
const oaRun = (ms) => [ms, 'OA', `# sched\n\n**Feed: OA — OA-100: something else**\n\n${LISTED}`];
// A pass in a run whose ready/ held only places-issues.md.
const plainRun = (ms) => [ms, 'OA', '# sched\n\n- `ready/` still has `places-issues.md`.\n'];
const READY = { 'places-issues.md': at(7, 36), 'wisbech-capacity.md': at(9, 36), 'zz-weekly-backlog-triage.md': at(9, 39, 21) };

console.log('\n1. the real 28 September, replayed');
{
  const t = mkLoop('replay', READY, [at(10, 15), at(11, 15), at(12, 15), at(13, 15)].map(oaRun));
  const rs = rows(t, at(14, 0));
  check('both stuck files raise a row', keys(rs) === 'adhoc-not-taken/places-issues,adhoc-not-taken/wisbech-capacity', keys(rs));
  check('the standing triage, passed over as not due, raises none', !rs.some((r) => /zz-weekly/.test(r.key)));
  const r = rs.find((x) => x.file === 'places-issues.md') || { title: '', why: '', rank: null, passes: null };
  check('the title says the ad-hoc loop is not taking it, at its new path', /^The ad-hoc loop is not taking this: `adhoc\/ready\/places-issues\.md`/.test(r.title), r.title);
  check('and never names the old loop/adhoc/ folder', !/loop\/adhoc/.test(`${r.title} ${r.why} ${(r.do || []).map((x) => x.what).join(' ')}`));
  check('and never calls it triage', !/triage/i.test(r.title), r.title);
  check('it counts the runs that named it', r.passes === 4 && /named by 4 runs since 10:15/.test(r.title), r.title);
  check('rank 3: a request of Peter\'s is blocked', r.rank === 3, String(r.rank));
  check('the why names the newest run file to read, in its folder', /adhoc\/runs\/2026-09-28_1315-OA\.md/.test(r.why), r.why.slice(0, 120));
  check('and the action names it too', /^Read adhoc\/runs\/2026-09-28_1315-OA\.md /.test(r.do[0].what), r.do[0].what);
  check('and says the only excuse a run has', /not due: <why>/.test(r.why));
}

console.log('\n2. CONTROL — a tick that TAKES the file clears the row');
{
  const took = [at(13, 15), 'adhoc', '# sched\n\n**Feed: adhoc — places-issues.md: the first slice, rest filed as OAs**\n'];
  const t = mkLoop('took', READY, [...[at(10, 15), at(11, 15), at(12, 15)].map(oaRun), took]);
  const rs = rows(t, at(14, 0));
  check('places-issues has no row once the newest tick took it', !rs.some((r) => r.file === 'places-issues.md'), keys(rs));
  check('wisbech still has one: that tick did not take it', rs.some((r) => r.file === 'wisbech-capacity.md'), keys(rs));
  // An adhoc tick that took ANOTHER file and lists this one has passed it over.
  const other = [at(13, 15), 'adhoc', '# sched\n\n**Feed: adhoc — google-search.md: the search round**\n\n`ready/` still has `places-issues.md`.\n'];
  check('an adhoc tick that took a different file counts as a pass', verdict({ feed: 'adhoc', text: other[2] }, 'places-issues.md') === 'passed');
}

console.log('\n3. CONTROL — the exact not-due form clears it, and a later pass brings it back');
{
  const excused = (ms) => [ms, 'OA', '# sched\n\n- `places-issues.md` (not due: Peter dated it for October)\n'];
  const t = mkLoop('excused', { 'places-issues.md': at(7, 36) }, [...[at(10, 15), at(11, 15)].map(plainRun), excused(at(12, 15))]);
  check('the newest tick excused it, so no row', rows(t, at(14, 0)).length === 0);
  const t2 = mkLoop('excused-then', { 'places-issues.md': at(7, 36) }, [excused(at(10, 15)), ...[at(11, 15), at(12, 15)].map(plainRun)]);
  check('excused once, then passed twice: the row is back', rows(t2, at(14, 0)).length === 1);
}

console.log('\n4. the span stops at another ready/ file, not at any filename');
{
  const names = Object.keys(READY);
  const run = { feed: 'OA', text: LISTED };
  check('places-issues on the shared line is a pass', verdict(run, 'places-issues.md', names) === 'passed');
  check('wisbech-capacity on the shared line is a pass', verdict(run, 'wisbech-capacity.md', names) === 'passed');
  check('the triage at the end of it is excused', verdict(run, 'zz-weekly-backlog-triage.md', names) === 'not-due');
  // The wording ticks used before OA-503: the excuse comes after ANOTHER filename.
  const loose = { feed: 'OA', text: '- adhoc: only `zz-weekly-backlog-triage.md`; `backlog-triage-2026-09-25.md` is in done/, so it is not due until 2026-10-02.\n' };
  check('an excuse after a done/ filename still excuses', verdict(loose, 'zz-weekly-backlog-triage.md', names) === 'not-due');
  check('"next due" excuses too', verdict({ feed: 'OA', text: '`zz-weekly-backlog-triage.md` is next due 2026-10-02\n' }, 'zz-weekly-backlog-triage.md', names) === 'not-due');
  check('MUTATION CONTROL — without the other names, the shared line would excuse all three', verdict(run, 'places-issues.md', []) === 'not-due');
  check('a run that never names the file has no verdict', verdict({ feed: 'OA', text: '# nothing\n' }, 'places-issues.md', names) === null);
}

console.log('\n5. thresholds: age and count');
{
  const t = mkLoop('young', { 'places-issues.md': at(12, 0) }, [at(12, 15), at(13, 15)].map(plainRun));
  check('a file younger than three hours raises nothing', rows(t, at(14, 0)).length === 0);
  check('the same file an hour later raises the row', rows(t, at(15, 5)).length === 1);
  const one = mkLoop('one-pass', { 'places-issues.md': at(7, 36) }, [plainRun(at(13, 15))]);
  check('one pass is below the threshold', rows(one, at(14, 0)).length === 0);
  // Runs from before the file existed cannot have passed it over.
  const before = mkLoop('before', { 'places-issues.md': at(12, 0) }, [at(6, 15), at(7, 15), at(15, 15)].map(plainRun));
  check('runs older than the file are not counted', rows(before, at(16, 0)).length === 0);
}

console.log('\n6. absent, empty and junk: all silent');
{
  const nowhere = path.join(tmp, 'nowhere');
  check('absent ready/: []', readReady(path.join(nowhere, 'ready')).length === 0);
  check('absent runs/: []', readRunsSince(path.join(nowhere, 'runs'), 0).length === 0);
  check('undefined: no throw', readReady(undefined).length === 0 && readRunsSince(undefined, 0).length === 0);
  check('no inputs: no row', adhocNotTakenItems({ ready: [], runs: [] }).length === 0);
  const t = mkLoop('junk', { 'places-issues.md': at(7, 36) }, []);
  fs.writeFileSync(path.join(t.rd, 'notes.txt'), 'x', 'utf8');
  fs.writeFileSync(path.join(t.rn, 'hand-written.md'), '`places-issues.md`', 'utf8');
  check('a non-.md in ready/ is ignored', readReady(t.rd).length === 1);
  check('an unparseable run name is ignored', readRunsSince(t.rn, 0).length === 0);
}

console.log('\n7. the concurrency verdict');
{
  check('the row contends with nothing', needsOf({ key: 'adhoc-not-taken/places-issues', type: 'loop-health' }).length === 0);
}

console.log('\n8. the wire in worklist.mjs — literal strings, and it must RUN');
{
  const src = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  const liveLine = (lit) => src.split('\n').some((l) => l.includes(lit) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  for (const lit of [
    "import { adhocNotTakenFor } from './loop_ready.mjs';",
    'for (const it of adhocNotTakenFor(BUSES)) add(it);',
  ]) check(`worklist.mjs RUNS: ${lit.slice(0, 58)}`, liveLine(lit), 'absent, or commented out');
}

console.log('\n9. the helper the wire calls reads the right folders (OA-610)');
{
  // The wire is one line, so the paths live in adhocNotTakenFor. Build a buses
  // root and prove the helper finds each folder under it.
  const now = at(14, 0);
  const four = [at(10, 15), at(11, 15), at(12, 15), at(13, 15)].map(oaRun);
  const t = mkLoop('helper', READY, four);
  const rs = adhocNotTakenFor(t.root, now);
  check('adhocNotTakenFor(<buses root>) reads adhoc/ready/ and adhoc/runs/: the same two rows', keys(rs) === 'adhoc-not-taken/places-issues,adhoc-not-taken/wisbech-capacity', keys(rs));
  check('and an absent root raises none', adhocNotTakenFor(path.join(tmp, 'no-buses'), now).length === 0);
  // The transition: the passes are a bus tick's, in loop/runs/, and still count.
  const old = mkLoop('helper-transition', READY, four, 'loop/runs');
  const ro = adhocNotTakenFor(old.root, now);
  check('the transition: passes in loop/runs/ inside 48 h still raise the rows', keys(ro) === keys(rs), keys(ro));
  const ri = ro.find((x) => x.file === 'places-issues.md') || { do: [{ what: '' }] };
  check('and the action names loop/runs/, where that run file is', /^Read loop\/runs\/2026-09-28_1315-OA\.md /.test(ri.do[0].what), ri.do[0].what);
  // One pass in each folder is two passes: the folders are one history.
  const split = mkLoop('helper-split', { 'places-issues.md': at(7, 36) }, [plainRun(at(10, 15))], 'loop/runs');
  fs.mkdirSync(path.join(split.root, 'adhoc', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(split.root, 'adhoc', 'runs', '2026-09-28_1101-idle.md'), '# sched-adhoc-1101\n\n- `ready/` still has `places-issues.md`.\n', 'utf8');
  const rsp = adhocNotTakenFor(split.root, now);
  check('one pass in each folder is two passes, and the newest names adhoc/runs/', rsp.length === 1 && rsp[0].passes === 2 && /adhoc\/runs\/2026-09-28_1101-idle\.md/.test(rsp[0].why), rsp.map((x) => x.title).join(' | '));
  // An ad-hoc run that took the file, after a bus tick passed it, clears it.
  fs.writeFileSync(path.join(split.root, 'adhoc', 'runs', '2026-09-28_1301-adhoc.md'), '# sched-adhoc-1301\n\n**Feed: adhoc — places-issues.md: the first slice**\n', 'utf8');
  check('an ad-hoc run that took it, newest, clears the row', adhocNotTakenFor(split.root, now).length === 0);
  // The old queue folder is not read: a file left there is nobody's request now.
  const stale = path.join(tmp, 'helper-old-queue');
  fs.mkdirSync(path.join(stale, 'loop', 'adhoc', 'ready'), { recursive: true });
  fs.mkdirSync(path.join(stale, 'loop', 'runs'), { recursive: true });
  const p = path.join(stale, 'loop', 'adhoc', 'ready', 'places-issues.md');
  fs.writeFileSync(p, '# a request\n', 'utf8');
  fs.utimesSync(p, new Date(at(7, 36)), new Date(at(7, 36)));
  for (const ms of [at(10, 15), at(11, 15), at(12, 15)]) { const [, feed, text] = plainRun(ms); const d = new Date(ms); fs.writeFileSync(path.join(stale, 'loop', 'runs', `2026-09-28_${pad(d.getHours())}${pad(d.getMinutes())}-${feed}.md`), text, 'utf8'); }
  check('a file in the OLD loop/adhoc/ready/ raises nothing', adhocNotTakenFor(stale, now).length === 0);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
