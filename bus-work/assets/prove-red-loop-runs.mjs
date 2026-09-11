#!/usr/bin/env node
/* Prove the loop-idle row appears, says WHY, and goes away (buses-data OA-288).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-loop-runs.mjs
 *
 * WHAT IS BEING FALSIFIED. A row that says the scheduled loop has fired and done
 * nothing. Its subject is `loop/runs/`, which is GITIGNORED — absent in CI, in a
 * clone, in a worktree and in every other harness's fixture — so the cases below
 * build real directories under the temp dir rather than injecting a fake reader.
 * A fake reader cannot be absent, and absence is the state this check spends most
 * of its life in.
 *
 * THE CONTROL MATTERS MORE THAN THE ROW. A board that nags about a healthy loop
 * is one nobody reads by the end of the week, so the pairs here are all
 * make-the-state-and-see-it / clear-it-and-see-it-go: a working tick clears the
 * row (case 3), one idle tick is below the threshold (case 4), and a merely OLD
 * newest run raises nothing at all (case 5) because the scheduler only fires
 * while the desktop app is open and "nothing since 01:15" is every morning.
 *
 * TWO HARNESS LESSONS FROM prove-red-loop-blocked.mjs ARE APPLIED HERE FROM THE
 * START, both found by a mutation sweep on 2026-09-08. A source assertion asks
 * whether the line RUNS, not whether the file contains the text, because
 * `includes()` is satisfied by the line commented out. And where a phrase must
 * appear in more than one branch it is COUNTED, because an assertion that one of
 * two things is true is not an assertion about both.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunName, readRuns, cadenceMin, loopHealth, loopRunItems } from './loop_runs.mjs';
import { needsOf } from './concurrency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-loop-runs-'));
/** Build a real runs/ directory from `HHMM-feed` shorthand on 2026-09-09. */
const mkRuns = (label, specs, day = 9) => {
  const dir = path.join(tmp, label, 'loop', 'runs');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of specs) fs.writeFileSync(path.join(dir, `2026-09-0${day}_${s}.md`), '# a tick\n', 'utf8');
  return dir;
};
const NOON = new Date(2026, 8, 9, 12, 0).getTime();
const health = (dir, now = NOON) => loopHealth({ runs: readRuns(dir), now });

console.log('\n1. the real 2026-09-09 morning, replayed');
{
  // The four consecutive gate-stops that prompted OA-288, and the working tick
  // that preceded them. This is the acceptance test: the row that should have
  // been on the board at noon and was not.
  const dir = mkRuns('morning', ['0715-OA', '0815-none', '0915-none', '1015-none', '1115-none']);
  const h = health(dir);
  check('four consecutive none ticks counted', h.idle === 4, String(h.idle));
  check('cadence derived as 60 from the filenames', h.cadence === 60, String(h.cadence));
  check('last working tick remembered', h.lastWorkingAt !== null);
  const rows = loopRunItems({ health: h, treeDirty: true, busesDir: 'B' });
  check('one row', rows.length === 1, String(rows.length));
  check('rank 3 — a dirty tree is Peter\'s move', rows[0].rank === 3, String(rows[0].rank));
  check('title states the count and the last tick', /fired 4 times and done nothing.*11:15/.test(rows[0].title), rows[0].title);
  check('why names the stray-file cause', /ONE stray file halts every tick/.test(rows[0].why));
  check('and offers git status in the buses dir', rows[0].do.some((d) => d.kind === 'shell' && d.cmd === 'git status --porcelain' && d.cwd === 'B'));
}

console.log('\n2. the same idling, with nothing visible to explain it');
{
  const h = health(mkRuns('unexplained', ['0715-OA', '0815-none', '0915-none']));
  const rows = loopRunItems({ health: h, treeDirty: false, stopFile: false, heldBy: null });
  check('still raises', rows.length === 1);
  check('but at rank 8 — nobody is blocked', rows[0].rank === 8, String(rows[0].rank));
  check('and says so rather than inventing a cause', /nothing visible from here explains it/.test(rows[0].why));
  check('and points at the newest run file', /newest file in `loop\/runs\/`/.test(rows[0].why));
}

console.log('\n3. CONTROL — a working tick clears it');
{
  const h = health(mkRuns('working', ['0815-none', '0915-none', '1015-none', '1115-adhoc']));
  check('idle is 0', h.idle === 0, String(h.idle));
  check('no row, even with a dirty tree', loopRunItems({ health: h, treeDirty: true }).length === 0);
}

console.log('\n3b. OA-303 — an `around` tick does NOT reset the count, and is still WORKING');
{
  // THE ACCEPTANCE TEST FOR PETER'S OPTION 3. Replays the shape that produced the
  // action: two gate-stops, then a tick that found and fixed a defect in the one
  // tree the bar left open, then another gate-stop. Under the old rule the middle
  // tick reset the run to 1 and the row vanished while the bar stayed; under
  // `-around` the sequence counts THREE.
  const h = health(mkRuns('around', ['0715-OA', '0815-none', '0915-around', '1015-none']));
  check('-none, -around, -none counts THREE', h.idle === 3, String(h.idle));
  check('and one of the three is named as an around', h.around === 1, String(h.around));
  // The two predicates are no longer each other's complement. This is the whole
  // substance of the change, so it is pinned directly rather than via the row.
  check('the around tick IS in working — lastWorkingAt is 09:15, not 07:15',
    h.lastWorkingAt === new Date(2026, 8, 9, 9, 15).getTime(), new Date(h.lastWorkingAt).toString());
  const rows = loopRunItems({ health: h, treeDirty: true });
  check('the row is raised — it was not, before OA-303', rows.length === 1, String(rows.length));
  // Guarded, because the mutation this case exists to catch REMOVES the row: a
  // harness that throws on `rows[0]` reports one red and abandons the six
  // assertions after it, which is the *check that could not go red* in reverse —
  // the evidence is there and nothing prints it. `row` stands in so every
  // assertion below states its own verdict.
  const row = rows[0] || { title: '(no row was raised)', why: '', idle: null, around: null };
  check('title does NOT say "done nothing", which is false of a tick that worked',
    rows.length === 1 && !/done nothing/.test(row.title), row.title);
  check('title says the queue was never reached', /without reaching its own queue/.test(row.title), row.title);
  check('title counts the around ticks', /1 of them worked around the bar/.test(row.title), row.title);
  check('why explains what the count now measures', /out of reach rather than how idle/.test(row.why));
  check('the count is on the row for a caller', row.idle === 3 && row.around === 1, `idle=${row.idle} around=${row.around}`);

  // CONTROL, both ways. An all-`none` run keeps the old wording exactly, so this
  // change cannot have silently rephrased the ordinary case…
  const plain = loopRunItems({ health: health(mkRuns('around-ctl', ['0815-none', '0915-none'])), treeDirty: true })[0];
  check('CONTROL — with no around tick the title is unchanged', /fired 2 times and done nothing/.test(plain.title), plain.title);
  check('CONTROL — and why gains no around clause', !/worked around the bar/.test(plain.why));
  // …and a REAL feed still resets the count, so `around` has not been made a
  // synonym for "any work at all". Without this, `UNREACHED` holding every feed
  // would pass every assertion above.
  const cleared = health(mkRuns('around-cleared', ['0815-none', '0915-around', '1015-bus-work']));
  check('CONTROL — a tick that DID reach the queue resets it to 0', cleared.idle === 0, String(cleared.idle));
  check('CONTROL — and no row, even with a dirty tree', loopRunItems({ health: cleared, treeDirty: true }).length === 0);
  check('CONTROL — around is 0 once the run is broken', cleared.around === 0, String(cleared.around));
}

console.log('\n4. one idle tick is below the threshold');
{
  const h = health(mkRuns('one', ['0915-bus-work', '1015-none']));
  check('idle is 1', h.idle === 1, String(h.idle));
  check('no row at the default threshold of 2', loopRunItems({ health: h, treeDirty: true }).length === 0);
  check('but a threshold of 1 raises it', loopRunItems({ health: h, treeDirty: true, idleThreshold: 1 }).length === 1);
}

console.log('\n5. CONTROL — a merely OLD newest run raises NOTHING');
{
  // The scheduler fires only while the desktop app is open, so "nothing since
  // 01:15" is the normal state of every morning. A row for it would cry wolf
  // daily and be muted inside a week. Age is reported INSIDE a row, never a
  // trigger of one.
  const h = health(mkRuns('stale', ['0015-bus-work', '0115-adhoc']));
  check('the age is large', h.ageMin > 600, String(h.ageMin));
  check('and it raises nothing', loopRunItems({ health: h, treeDirty: true }).length === 0);
}

console.log('\n6. a forgotten loop/STOP raises it on its own');
{
  const h = health(mkRuns('stopped', ['1115-adhoc']));
  const rows = loopRunItems({ health: h, stopFile: true });
  check('row raised with no idling at all', rows.length === 1 && h.idle === 0);
  check('rank 3', rows[0].rank === 3, String(rows[0].rank));
  check('title names STOP', /halted by `loop\/STOP`/.test(rows[0].title), rows[0].title);
  check('why warns a forgotten STOP looks like an idle loop', /indistinguishable from a loop with nothing to do/.test(rows[0].why));
  check('and offers to remove it', rows[0].do.some((d) => d.cmd === 'rm -f loop/STOP'));
}

console.log('\n7. who holds the lock changes the cause but not the fact');
{
  const h = health(mkRuns('held', ['0815-none', '0915-none', '1015-none']));
  const person = loopRunItems({ health: h, heldBy: 'buses-85 (interactive session)' })[0];
  check('a person holding the lock is named as a cause', /deferring to a session at the keyboard/.test(person.why), person.why.slice(0, 90));
  check('…and is NOT rank 3, because it clears itself', person.rank === 8, String(person.rank));
  const tick = loopRunItems({ health: h, heldBy: 'sched-1015' })[0];
  check('a sched- holder is not offered as a cause', !/deferring to a session/.test(tick.why));
}

// ---- the silence, against a real disk ---------------------------------------
console.log('\n8. absent, empty, not-a-directory, junk — all silent');
{
  const missing = path.join(tmp, 'nowhere', 'loop', 'runs');
  check('absent folder: no throw, no runs', readRuns(missing).length === 0);
  check('absent folder: no row', loopRunItems({ health: health(missing) }).length === 0);
  check('absent folder: health says it never ran', health(missing).ran === false);

  const empty = path.join(tmp, 'empty', 'loop', 'runs');
  fs.mkdirSync(empty, { recursive: true });
  check('empty folder: no row', loopRunItems({ health: health(empty) }).length === 0);

  const notDir = path.join(tmp, 'notdir');
  fs.writeFileSync(notDir, 'a file, not a folder', 'utf8');
  check('a FILE where the folder should be: no throw', readRuns(notDir).length === 0);
  check('undefined dir: no throw', readRuns(undefined).length === 0);

  const junk = mkRuns('junk', ['0815-none']);
  fs.writeFileSync(path.join(junk, 'notes.txt'), 'x', 'utf8');
  fs.writeFileSync(path.join(junk, 'hand-written record.md'), 'x', 'utf8');
  fs.mkdirSync(path.join(junk, '2026-09-09_2015-adhoc.md'));   // a directory named like a run
  check('unparseable names and a directory are skipped', readRuns(junk).length === 1, String(readRuns(junk).length));
}

console.log('\n9. the filename is the measurement');
{
  check('feed comes off the name', parseRunName('2026-09-09_1115-none.md').feed === 'none');
  check('a hyphenated feed survives', parseRunName('2026-09-08_1515-bus-work.md').feed === 'bus-work');
  check('junk is null, not a throw', parseRunName('notes.txt') === null && parseRunName('') === null && parseRunName(null) === null);
  // LOCAL time, not UTC. The tick writes local time and the reader is on the same
  // machine, so parsing as UTC would shift every age by the offset — wrong by an
  // hour for half the year, and silently.
  const at = parseRunName('2026-09-09_1115-none.md').at;
  check('parsed as LOCAL time', at === new Date(2026, 8, 9, 11, 15).getTime(), new Date(at).toString());
}

console.log('\n10. the cadence is derived, bounded, and falls back');
{
  const hourly = mkRuns('hourly', ['0015-none', '0115-none', '0215-none', '0315-none', '0415-none', '0515-none']);
  check('six hourly runs give 60', cadenceMin(readRuns(hourly)) === 60, String(cadenceMin(readRuns(hourly))));
  const few = mkRuns('few', ['0015-none', '0115-none']);
  check('too few gaps falls back to the default', cadenceMin(readRuns(few), 60) === 60);
  check('…and the fallback is the caller\'s, not a literal', cadenceMin(readRuns(few), 17) === 17);
  // A median rather than a mean, so one four-hour hole where the desktop app was
  // shut does not move the threshold. This is the property, asserted directly.
  const holed = mkRuns('holed', ['0015-none', '0115-none', '0215-none', '0615-none', '0715-none', '0815-none']);
  check('a 4-hour hole does not move the median', cadenceMin(readRuns(holed)) === 60, String(cadenceMin(readRuns(holed))));
  check('an empty history is the fallback', cadenceMin([], 60) === 60);
}

console.log('\n11. the concurrency verdict');
{
  check('loop-idle contends with nothing', needsOf({ key: 'loop-idle', type: 'loop-health' }).length === 0,
    JSON.stringify(needsOf({ key: 'loop-idle', type: 'loop-health' })));
  check('MUTATION CONTROL — an unknown type still defaults to buses-tree', needsOf({ key: 'zzz', type: 'never-heard-of-it' }).join() === 'buses-tree');
}

console.log('\n12. the wire in worklist.mjs — literal strings, and it must RUN');
{
  const src = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  // NOT src.includes(). A mutation sweep on prove-red-loop-blocked.mjs commented
  // a wire out and every assertion stayed green, because a commented line still
  // contains the string.
  const liveLine = (lit) => src.split('\n').some((l) => l.includes(lit) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  for (const lit of [
    "import { readRuns, loopHealth, loopRunItems } from './loop_runs.mjs';",
    "readRuns(path.join(BUSES, 'loop', 'runs'))",
    "stopFile: existsSync(path.join(BUSES, 'loop', 'STOP')),",
    'treeDirty: !!(conditions.repos.buses && conditions.repos.buses.dirty),',
    'heldBy: (conditions.loopLock && conditions.loopLock.name) || null,',
    'for (const it of loopIdle) add(it);',
  ]) check(`worklist.mjs RUNS: ${lit.slice(0, 58)}`, liveLine(lit), 'absent, or commented out');
  // The causes must come from `conditions`, which the run has already gathered
  // and PRINTED, or the row can contradict the block above it. Both reads
  // asserted, counted, so removing one cannot pass on the other.
  const fromConditions = src.split('\n').filter((l) => l.includes('conditions.') && l.includes('loopIdle') === false && /treeDirty|heldBy/.test(l) && !l.trim().startsWith('//')).length;
  check('BOTH causes are read from conditions', fromConditions === 2, `found ${fromConditions}, expected 2`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) FAILED\n` : '\nAll checks passed.\n');
process.exit(bad ? 1 : 0);
