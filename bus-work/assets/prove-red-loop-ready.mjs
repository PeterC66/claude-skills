#!/usr/bin/env node
/* Prove the "loop is not taking this" row appears, and stays away when it should
 * (buses-data OA-503).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-loop-ready.mjs
 *
 * WHAT IS BEING FALSIFIED. A row saying that a file in `loop/adhoc/ready/` keeps
 * being named by the ticks and is never taken. Both folders it reads are
 * gitignored, so, as in prove-red-loop-runs.mjs, every case builds real
 * directories under the temp dir. A fake reader cannot be absent.
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
 * A real loop/ tree. `ready` is { name: mtimeMs }. `runs` is a list of
 * [ms, feed, text], written as `2026-09-DD_HHMM-<feed>.md`.
 */
const mkLoop = (label, ready, runs) => {
  const root = path.join(tmp, label, 'loop');
  const rd = path.join(root, 'adhoc', 'ready');
  const rn = path.join(root, 'runs');
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
  return { rd, rn };
};
const rows = ({ rd, rn }, now) => adhocNotTakenItems({ ready: readReady(rd), runs: readRunsSince(rn, now - 48 * 3600000), now });
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
  check('the title says the loop is not taking it', /^The loop is not taking this: `loop\/adhoc\/ready\/places-issues\.md`/.test(r.title), r.title);
  check('and never calls it triage', !/triage/i.test(r.title), r.title);
  check('it counts the ticks that named it', r.passes === 4 && /named by 4 ticks since 10:15/.test(r.title), r.title);
  check('rank 3: a request of Peter\'s is blocked', r.rank === 3, String(r.rank));
  check('the why names the newest run file to read', /2026-09-28_1315-OA\.md/.test(r.why), r.why.slice(0, 120));
  check('and says the only excuse a tick has', /not due: <why>/.test(r.why));
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

console.log('\n9. the helper the wire calls reads the right two folders');
{
  // The wire is one line, so the paths live in adhocNotTakenFor. Build a buses
  // root and prove the helper finds both folders under it.
  const now = at(14, 0);
  const t = mkLoop('helper', READY, [at(10, 15), at(11, 15), at(12, 15), at(13, 15)].map(oaRun));
  const root = path.dirname(path.dirname(t.rn));
  const rs = adhocNotTakenFor(root, now);
  check('adhocNotTakenFor(<buses root>) raises the same two rows', keys(rs) === 'adhoc-not-taken/places-issues,adhoc-not-taken/wisbech-capacity', keys(rs));
  check('and an absent root raises none', adhocNotTakenFor(path.join(tmp, 'no-buses'), now).length === 0);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
