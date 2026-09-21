#!/usr/bin/env node
/* Prove the concurrency verdicts can go red — and, just as hard, that they go
 * back to green when the condition clears.
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-concurrency.mjs
 *
 * No placeholders; it builds its own throwaway git repositories under the OS
 * temp directory and never looks at the real trees.
 *
 * WHY EVERY CASE IS A PAIR. A guard that says BETTER TO DELAY whatever the
 * world looks like is not a guard, it is a mute button waiting to be pressed —
 * and this one is aimed at somebody who wants to stop thinking about it, which
 * is precisely the reader who will stop reading it. So each case makes the
 * condition and sees the verdict, then clears the condition and sees it go.
 *
 * TWO HALVES, TESTED DIFFERENTLY, because they can each be wrong on their own.
 *
 *   1. THE OBSERVATION — readRepo() against real git repositories built here.
 *      Rules over a hand-written conditions object cannot tell you that
 *      `git status --porcelain` is being parsed correctly, and misparsing it
 *      would make every verdict below a confident fiction.
 *
 *   2. THE JUDGEMENT — assess()/classify() over synthetic conditions. Reaching
 *      a DELAY on the real disk would mean corrupting a real checkout, and a
 *      harness that has to break the machine to run is a harness nobody runs.
 *
 * THE CONTROL IS NOT DECORATION. The last block asserts that a clean world
 * makes everything SAFE NOW. Without it, a rule that returned CHECK FIRST
 * unconditionally would pass every red case above and be useless.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as conc from './concurrency.mjs';
/* OA-414 — the decision marker's gate is applyHolds, and a test that asserted
 * only the parse would not have caught the fault this row was filed about. */
import { applyHolds } from './loop_your_move.mjs';

/* fileURLToPath, not new URL(...).pathname: this tree lives under
 * "C:\u3a St Ives\.claude\..." and the latter percent-encodes the space. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conc-'));
let bad = 0;

function ok(pass, label, detail) {
  console.log(`  ${pass ? 'ok   ' : 'MISS '} ${label}`);
  if (!pass) { bad++; if (detail) console.log(`        ${detail}`); }
}
const want = (got, expected, label) => ok(got.verdict === expected, label, `wanted ${expected}, got ${got.verdict}${got.reasons.length ? ` (${got.reasons.map((r) => r.need).join(', ')})` : ''}`);
const says = (got, re, label) => ok(got.reasons.some((r) => re.test(r.why)), label, `no reason matched ${re}; saw: ${got.reasons.map((r) => r.why).join(' | ') || '(none)'}`);

// ---------------------------------------------------------------------------
// 1. THE OBSERVATION — does readRepo actually see what is on the disk?
// ---------------------------------------------------------------------------
console.log('\n== reading a real working tree ==');

const repoDir = path.join(root, 'fixture');
const g = (...a) => execFileSync('git', ['-C', repoDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
fs.mkdirSync(repoDir, { recursive: true });
try {
  execFileSync('git', ['init', '-b', 'main', repoDir], { stdio: 'ignore' });
  g('config', 'user.email', 'harness@example.invalid');
  g('config', 'user.name', 'harness');
  fs.writeFileSync(path.join(repoDir, 'kept.txt'), 'one\n');
  g('add', 'kept.txt');
  g('commit', '-m', 'first');
} catch (e) {
  // THE ROOM MUST NOT BE RED BEFORE THE EXPERIMENT. If the fixture itself
  // cannot be built, every case below would fail for a reason that has nothing
  // to do with the thing under test. Refuse to run rather than report it.
  console.log(`\n  Cannot build the git fixture (${e.message.split('\n')[0]}). Nothing was tested.`);
  process.exit(2);
}

const read = () => conc.readRepo({ key: 'f', label: 'fixture', name: 'fixture', dir: repoDir });

let r = read();
ok(r.readable && r.branch === 'main', 'a fresh repo reads as branch main', `branch=${r.branch} readable=${r.readable}`);
ok(!r.dirty && !r.untracked.length && !r.offMain, 'and reads as clean, on the expected branch');

fs.writeFileSync(path.join(repoDir, 'scratch.txt'), 'x\n');
r = read();
ok(r.untracked.length === 1 && !r.dirty, 'an untracked file is untracked, not dirty', `untracked=${r.untracked.length} dirty=${r.dirty}`);

g('add', 'scratch.txt');
r = read();
ok(r.staged.length === 1 && !r.untracked.length, 'staging it moves it to STAGED', `staged=${r.staged.length}`);

fs.writeFileSync(path.join(repoDir, 'kept.txt'), 'two\n');
r = read();
ok(r.modified.length === 1, 'editing a tracked file shows as modified', `modified=${r.modified.join(',')}`);

// The path shape that drives the estate-sweep rule, and the one this project
// has actually been bitten by. A folder with a space in the name is not a
// hypothetical here either -- the real tree is full of them.
fs.mkdirSync(path.join(repoDir, 'Areas', 'St Ives'), { recursive: true });
fs.writeFileSync(path.join(repoDir, 'Areas', 'St Ives', 'routes.json'), '{}');
r = read();
ok(r.touchesMapData, 'an uncommitted file under Areas/ is seen as map data', `touchedTop=${r.touchedTop.join(',')}`);
ok(r.touchedTop.includes('Areas'), 'and the folder is named in the summary');

g('checkout', '-q', '-b', 'work/thing');
r = read();
ok(r.offMain && r.branch === 'work/thing', 'a feature branch reads as off main', `branch=${r.branch}`);
g('checkout', '-q', 'main');
ok(!read().offMain, 'and switching back clears it');

// ---------------------------------------------------------------------------
// 1a. THE HELD LETTER — readConditions against a real tree with a real hold
// ---------------------------------------------------------------------------
/* OA-301. The fixture has to look like the real repository in the one respect
 * that matters: `loop/` is gitignored, so the hold folder itself can never show
 * up as an untracked path. Without that line the tree would be dirty BECAUSE of
 * the hold, and the case would be measuring the wrong thing. */
console.log('\n== a held letter, read from a real tree (OA-301) ==');
{
  const held = path.join(root, 'held');
  const hg = (...a) => execFileSync('git', ['-C', held, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  fs.mkdirSync(path.join(held, 'Correspondence', 'CORR-001'), { recursive: true });
  fs.mkdirSync(path.join(held, 'Areas', 'Ramsey'), { recursive: true });
  execFileSync('git', ['init', '-b', 'main', held], { stdio: 'ignore' });
  hg('config', 'user.email', 'harness@example.invalid');
  hg('config', 'user.name', 'harness');
  fs.writeFileSync(path.join(held, '.gitignore'), 'loop/*\n!loop/README.md\n');
  const letter = 'Correspondence/CORR-001/008-2026-09-10-out-the-map-is-back-up.md';
  fs.writeFileSync(path.join(held, letter), '# CORR-001 · message 008\n\nHi\n');
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'x\n');
  hg('add', '-A');
  hg('commit', '-q', '-m', 'first');
  const yourMove = path.join(held, 'loop', 'your-move');
  fs.mkdirSync(yourMove, { recursive: true });
  const cond = () => conc.readConditions({ buses: held });

  // The clean control first, so the hold cannot be what makes it green.
  let C = cond();
  ok(conc.assess(['buses-tree'], C).verdict === conc.SAFE && C.repos.buses.accounted.length === 0,
    'clean tree with an empty your-move folder: SAFE, nothing accounted');

  // Peter types the salutation and leaves it.
  fs.writeFileSync(path.join(held, letter), '# CORR-001 · message 008\n\nHi Simon\n');
  C = cond();
  want(conc.assess(['buses-tree'], C), conc.CHECK, 'the held letter with NO hold naming it: CHECK FIRST — nothing accounts for it');

  // A tick writes the hold, in the house style: several fields on one line,
  // the path in backticks, prose after it.
  fs.writeFileSync(path.join(yourMove, 'corr-001-salutation.md'),
    '# CORR-001 message 008: the salutation names the correspondent\n\n' +
    `**Raised by:** \`sched-0815\`, 2026-09-10 · **File:** \`${letter}\`, modified and uncommitted since 07:16 local · **Blocks:** corr-unsent-CORR-001\n\n` +
    '## What is needed from you\n\nDecide the salutation.\n');
  C = cond();
  ok(C.repos.buses.modified.includes(letter), 'the letter is STILL reported as modified — the fact is not hidden', `modified=${C.repos.buses.modified.join(',')}`);
  ok(C.repos.buses.accounted.length === 1 && C.repos.buses.accounted[0].path === letter && C.repos.buses.accounted[0].ref === 'corr-001-salutation',
    'and it is accounted for, by the hold that names it', JSON.stringify(C.repos.buses.accounted));
  want(conc.assess(['buses-tree'], C), conc.SAFE, 'the held letter WITH a live hold naming it: SAFE — this is the case twelve ticks stopped on');
  want(conc.assess(['estate-sweep'], C), conc.SAFE, 'and a sweep is not held back by a letter either');
  ok(conc.formatConditions(C).some((l) => /accounted\s+Correspondence\/CORR-001.*corr-001-salutation\.md/.test(l)),
    'the conditions block SHOWS the subtraction and names the hold', conc.formatConditions(C).join('\n'));

  // A second dirty file the hold does not name brings CHECK FIRST straight back,
  // and the sentence counts ONE file and names Areas, not two and Correspondence.
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'y\n');
  C = cond();
  const A = conc.assess(['buses-tree'], C);
  want(A, conc.CHECK, 'a second dirty file outside the hold: CHECK FIRST again');
  ok(A.reasons.some((x) => /^1 uncommitted file\(s\) here \(Areas\)/.test(x.why)), 'and the reason counts the ONE unaccounted file and names its folder only', A.reasons.map((x) => x.why).join(' | '));
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'x\n');

  // Retiring the hold puts the letter back into the verdict — the direction a
  // rule like this must fail in.
  fs.rmSync(path.join(yourMove, 'corr-001-salutation.md'));
  C = cond();
  want(conc.assess(['buses-tree'], C), conc.CHECK, 'retire the hold and the letter counts again: CHECK FIRST');

  // A hold that names a file OUTSIDE Correspondence/ accounts for nothing: that
  // is residue, and the tree was right to stop on it on 2026-09-09.
  fs.writeFileSync(path.join(held, letter), '# CORR-001 · message 008\n\nHi\n');
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'y\n');
  fs.writeFileSync(path.join(yourMove, 'residue.md'),
    '# Residue\n\n**Raised by:** `sched-1115`, 2026-09-09 · **File:** `Areas/Ramsey/notes.md`, left behind\n\n## What is needed from you\n\nCommit it.\n');
  C = cond();
  want(conc.assess(['buses-tree'], C), conc.CHECK, 'a hold naming a file under Areas/ accounts for NOTHING: CHECK FIRST');
  ok(C.repos.buses.accounted.length === 0, 'and nothing is listed as accounted', JSON.stringify(C.repos.buses.accounted));

  // A hold with no File field, or a File field with no backticked path, is inert.
  fs.rmSync(path.join(yourMove, 'residue.md'));
  fs.writeFileSync(path.join(held, 'Areas', 'Ramsey', 'notes.md'), 'x\n');
  fs.writeFileSync(path.join(held, letter), '# CORR-001 · message 008\n\nHi Simon\n');
  fs.writeFileSync(path.join(yourMove, 'vague.md'), '# Vague\n\n**Raised by:** `sched-0815`, 2026-09-10 · **File:** the Ramsey letter\n\n## What is needed from you\n\nDecide.\n');
  C = cond();
  want(conc.assess(['buses-tree'], C), conc.CHECK, 'a hold whose File field carries no backticked path accounts for nothing');
}

// ---------------------------------------------------------------------------
// 1c. HOW OLD IS THE DIRT — the instrument OA-386 item 2 asks for
// ---------------------------------------------------------------------------
/* `peers.quiescentMin` has a structural ceiling of about an hour, because the
 * previous scheduled tick's own transcript is always on disk, so it can never
 * answer "has the owner of this orphan gone home". The subject is the FILE, so
 * the instrument is the file's mtime. These cases hold the three properties
 * that make it worth having: it follows the disk, it obeys the SAME
 * subtraction the count obeys, and it has three answers rather than two. The
 * last case is the one that keeps it honest — an observation that scores
 * nothing, so it can never become a mute button. */
console.log('\n== the age of the dirt (OA-386) ==');
{
  const aged = path.join(root, 'aged');
  const ag = (...a) => execFileSync('git', ['-C', aged, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  fs.mkdirSync(path.join(aged, 'Correspondence', 'CORR-001'), { recursive: true });
  fs.mkdirSync(path.join(aged, 'Areas', 'Ramsey'), { recursive: true });
  execFileSync('git', ['init', '-b', 'main', aged], { stdio: 'ignore' });
  ag('config', 'user.email', 'harness@example.invalid');
  ag('config', 'user.name', 'harness');
  fs.writeFileSync(path.join(aged, '.gitignore'), 'loop/*\n!loop/README.md\n');
  const letter = 'Correspondence/CORR-001/009-2026-09-17-out.md';
  fs.writeFileSync(path.join(aged, letter), 'Hi\n');
  fs.writeFileSync(path.join(aged, 'Areas', 'Ramsey', 'notes.md'), 'x\n');
  fs.writeFileSync(path.join(aged, 'gone.txt'), 'g\n');
  ag('add', '-A');
  ag('commit', '-q', '-m', 'first');
  const yourMove = path.join(aged, 'loop', 'your-move');
  fs.mkdirSync(yourMove, { recursive: true });

  const THEN = Date.parse('2026-09-17T12:00:00Z');
  const setAge = (rel, min) => { const t = (THEN - min * 60000) / 1000; fs.utimesSync(path.join(aged, rel), t, t); };
  const cond = () => conc.readConditions({ buses: aged, now: THEN });
  const line = (C) => conc.formatConditions(C).find((l) => /dirt age/.test(l)) || '(no dirt-age line)';

  // THE CONTROL FIRST: nothing dirty, nothing to be old, and no line about it.
  // Without this a reader could not tell an age of zero from no measurement.
  let C = cond();
  ok(C.repos.buses.dirtyAge.paths === 0 && C.repos.buses.dirtyAge.oldestMin === null,
    'CONTROL — a clean tree reports no dirt age at all', JSON.stringify(C.repos.buses.dirtyAge));
  ok(!conc.formatConditions(C).some((l) => /dirt age/.test(l)), 'and the conditions block prints no dirt-age line');

  fs.writeFileSync(path.join(aged, 'Areas', 'Ramsey', 'notes.md'), 'y\n');
  setAge('Areas/Ramsey/notes.md', 360);
  C = cond();
  ok(C.repos.buses.dirtyAge.counted === 1 && C.repos.buses.dirtyAge.oldestMin === 360,
    'a file last written six hours ago reads 360 minutes old', JSON.stringify(C.repos.buses.dirtyAge));
  ok(/6h old/.test(line(C)) && /mtime/.test(line(C)),
    'and the block prints it, labelled as an mtime rather than as proof of stillness', line(C));

  setAge('Areas/Ramsey/notes.md', 0);
  C = cond();
  ok(C.repos.buses.dirtyAge.oldestMin === 0, 'touch the same file and the same dirt reads young — the number follows the disk', JSON.stringify(C.repos.buses.dirtyAge));

  /* THE SAME SUBTRACTION AS THE COUNT (OA-301). An accounted held letter must be
   * out of the age as well as out of the count, or the block prints an age for a
   * file the verdict never counted — two sources for one fact, which is the
   * exact fault `unaccountedPaths` was introduced to remove. */
  fs.writeFileSync(path.join(aged, letter), 'Hi Simon\n');
  setAge(letter, 600);
  setAge('Areas/Ramsey/notes.md', 5);
  fs.writeFileSync(path.join(yourMove, 'corr-001-salutation.md'),
    `# CORR-001: the salutation names the correspondent\n\n**Raised by:** \`sched-0815\`, 2026-09-17 · **File:** \`${letter}\`, modified and uncommitted\n\n## What is needed from you\n\nDecide the salutation.\n`);
  C = cond();
  ok(C.repos.buses.dirtyAge.paths === 1 && C.repos.buses.dirtyAge.oldestMin === 5,
    'a held letter ten hours old is left OUT of the age, exactly as it is left out of the count', JSON.stringify(C.repos.buses.dirtyAge));
  fs.rmSync(path.join(yourMove, 'corr-001-salutation.md'));
  C = cond();
  ok(C.repos.buses.dirtyAge.paths === 2 && C.repos.buses.dirtyAge.oldestMin === 600,
    'retire the hold and the ten-hour letter is counted and aged again', JSON.stringify(C.repos.buses.dirtyAge));

  /* THREE ANSWERS, NOT TWO. A path git names that is not on the disk is ABSENT,
   * and a path nobody measured is a REFUSAL — neither may arrive as an age, and
   * neither may quietly vanish from the total. */
  fs.writeFileSync(path.join(aged, letter), 'Hi\n');
  fs.rmSync(path.join(aged, 'gone.txt'));
  C = cond();
  const three = C.repos.buses.dirtyAge;
  ok(three.absent === 1 && three.refused === 0 && three.counted === 1,
    'a tracked file deleted from the working tree reads ABSENT — not aged, and not refused', JSON.stringify(three));
  ok(/named by git and not on disk/.test(line(C)), 'and the block says how many it could not age, rather than dropping them', line(C));

  const blind = { staged: [], modified: ['Development Docs/open-actions.md'], untracked: [], accounted: [] };
  const b = conc.dirtyAge(blind);
  ok(b.refused === 1 && b.counted === 0 && b.oldestMin === null,
    'a repo carrying no dirtyAges at all is a REFUSAL over its paths — never an absence, and never an age of zero', JSON.stringify(b));

  /* AND IT SCORES NOTHING. Widening step 2b's quiescence clause to read this is
   * OA-294's conjunction and Peter's decision; a tick that let its own new
   * number move a verdict would be granting itself that. Ten-hour-old dirt is
   * still CHECK FIRST, and that is the whole point of the measurement being an
   * observation. */
  fs.writeFileSync(path.join(aged, letter), 'Hi Simon\n');
  setAge(letter, 600);
  C = cond();
  want(conc.assess(['buses-tree'], C), conc.CHECK, 'CONTROL — dirt ten hours old still reads CHECK FIRST: the age is an observation and moves no verdict');
}

const missing = conc.readRepo({ key: 'x', label: 'x', name: 'nowhere', dir: path.join(root, 'no-such-dir') });
ok(!missing.present && !missing.readable, 'a directory that does not exist is not silently "clean"');

// ---------------------------------------------------------------------------
// 1b. THE PROXY — readPeerActivity, which had no case at all until 2026-09-10
// ---------------------------------------------------------------------------
/* It is never scored, which is exactly why nothing tested it, and it was wrong:
 * it read each transcript's MTIME, and a `custom-title` record appended to a
 * finished session moves an mtime with no turn behind it. `sched-1715` was
 * shown a tick that had stopped at 10:23Z as a peer active within the last
 * twenty minutes, in the line a stopped tick uses to decide whether the thing
 * blocking it is about to clear itself.
 *
 * THE FIRST TWO CASES ARE THE PAIR. The first is red against the old code and
 * green against the new; the second must stay green either way, or the fix
 * would have been "count nothing" and would have passed the first on its own.
 * The three after them hold the FLOOR: where the content cannot answer, the
 * mtime still does, because the fallback must not go below what the proxy
 * already gave. */
console.log('\n== the activity proxy, mtime against content ==');

const peerRoot = path.join(root, 'projects');
const peerDir = path.join(peerRoot, 'C--Buses');
fs.mkdirSync(peerDir, { recursive: true });

const NOW = Date.parse('2026-09-10T16:15:00Z');
const MIN = 60000;
const line = (ms) => `{"type":"assistant","timestamp":"${new Date(ms).toISOString()}"}\n`;
// The two records that actually did it: appended after the session ended, and
// neither of them carries a timestamp.
const BOOKKEEPING = '{"type":"last-prompt","leafUuid":"x"}\n{"type":"custom-title","customTitle":"t"}\n';

function transcript(name, body, mtimeMs) {
  const f = path.join(peerDir, name);
  fs.writeFileSync(f, body);
  fs.utimesSync(f, mtimeMs / 1000, mtimeMs / 1000);
  return f;
}
const only = (name) => {
  for (const f of fs.readdirSync(peerDir)) if (f !== name) fs.rmSync(path.join(peerDir, f));
};
const peers = () => conc.readPeerActivity({ windowMin: 20, projectsDir: peerRoot, now: NOW });

// 1. The measured fault: a fresh file whose last turn was six hours ago.
transcript('dead.jsonl', line(NOW - 352 * MIN) + BOOKKEEPING, NOW - 1 * MIN);
let P = peers();
ok(P.count === 0, 'a transcript touched a minute ago whose last TURN was 6 h ago is not a live peer', `count=${P.count}`);
ok(P.demoted === 1, 'and the demotion is counted, so the line can say so', `demoted=${P.demoted}`);
ok(P.newestAgeMin === 352, 'and the age reported is the turn\'s, not the file\'s', `newestAgeMin=${P.newestAgeMin}`);

// 2. The other half of the pair — a genuinely live session must still count.
only('none');
transcript('live.jsonl', line(NOW - 3 * MIN), NOW - 3 * MIN);
P = peers();
ok(P.count === 1 && P.demoted === 0, 'a session that took a turn 3 min ago IS counted', `count=${P.count}, demoted=${P.demoted}`);
ok(P.tailed === 1, 'and only the candidate was tail-read', `tailed=${P.tailed}`);

// 3. THE FLOOR. No timestamp anywhere: the mtime is all there is, so it is used.
only('none');
transcript('opaque.jsonl', BOOKKEEPING, NOW - 2 * MIN);
P = peers();
ok(P.count === 1 && P.demoted === 0, 'a transcript with no timestamp at all keeps its mtime — the fallback is the old behaviour, not silence', `count=${P.count}`);

// 4. The floor again, for a file that cannot be read as JSONL at all.
only('none');
transcript('empty.jsonl', '', NOW - 5 * MIN);
P = peers();
ok(P.count === 1, 'an empty transcript still counts by mtime rather than vanishing', `count=${P.count}`);

// 5. A timestamp LATER than the file itself must not be believed. The first
//    version of this case put the fresh stamp in a file with an OLD mtime, so
//    the prefilter threw it out before the cap was ever consulted and the
//    assertion was green against code with no cap in it at all. It has to sit
//    INSIDE the window, where the cap is the only thing standing.
only('none');
transcript('skewed.jsonl', line(NOW + 100 * MIN), NOW - 2 * MIN);
P = peers();
ok(P.newestAgeMin === 2, 'a timestamp from the future is capped at the mtime, not reported as a negative age', `newestAgeMin=${P.newestAgeMin}`);
ok(P.count === 1, 'and the file is still counted, on its mtime', `count=${P.count}`);

// 5b. And the greatest stamp wins, not the last one. A transcript quotes tool
//     output verbatim, so an OLDER timestamp pasted into the final turn must not
//     drag a live session's age backwards.
only('none');
transcript('pasted.jsonl', line(NOW - 4 * MIN) + line(NOW - 900 * MIN), NOW - 4 * MIN);
P = peers();
ok(P.count === 1 && P.newestAgeMin === 4, 'an older stamp pasted after the real one does not age a live session out', `count=${P.count}, newestAgeMin=${P.newestAgeMin}`);

// 6. The stat-only path is untouched: a file outside the window is never tailed.
only('none');
transcript('old.jsonl', line(NOW - 300 * MIN), NOW - 300 * MIN);
P = peers();
ok(P.count === 0 && P.tailed === 0 && P.scanned === 1, 'a file outside the window costs one stat and no read', `tailed=${P.tailed}, scanned=${P.scanned}`);

// ---------------------------------------------------------------------------
// 1b. QUIESCENCE — the reading OA-294's orphan adoption rests on
//
// Peter said YES on 2026-09-11 to letting a tick ADOPT an orphaned document,
// and one clause of the conjunction he approved — "the OWNING session's
// transcript is more than 90 minutes old" — is not implementable: nothing
// records which session modified a working-tree file. What is implementable is
// strictly safer, and these cases are what say so: NOBODY ELSE has taken a turn
// in 90 minutes. It can only refuse an adoption the original would have
// allowed, never permit one it would have forbidden.
//
// Every case below is paired. The adoption rule is a rule that COMMITS SOMEBODY
// ELSE'S WORK, so a harness that only proved it fires would be worse than none.
// ---------------------------------------------------------------------------
console.log('\n== quiescence: may a tick conclude everyone else has gone? ==');

const SELF = 'self-abc';
const quiet = (id = SELF) => conc.readPeerActivity({ windowMin: 20, projectsDir: peerRoot, now: NOW, excludeId: id });

// 1. THE SHAPE OF THE NIGHT THE ACTION IS ABOUT. This tick is mid-turn; the one
//    other session last took a turn two hours ago. MUST read as quiet.
for (const f of fs.readdirSync(peerDir)) fs.rmSync(path.join(peerDir, f));
transcript(`${SELF}.jsonl`, line(NOW), NOW);
transcript('owner.jsonl', line(NOW - 120 * MIN), NOW - 120 * MIN);
P = quiet();
ok(P.excludedFound === true, 'the tick\'s own transcript is found and excluded', `excludedFound=${P.excludedFound}`);
ok(P.quiescentMin === 120, 'and the quiet reading is the OTHER session\'s age, not its own 0', `quiescentMin=${P.quiescentMin}`);
ok(P.newestAgeMin === 0, 'while the unfiltered line still reports 0 — which is why the flag had to exist', `newestAgeMin=${P.newestAgeMin}`);

// 2. THE MUST-NOT. One peer took a turn five minutes ago. Everything else about
//    the world is identical. Adoption must be off the table.
for (const f of fs.readdirSync(peerDir)) fs.rmSync(path.join(peerDir, f));
transcript(`${SELF}.jsonl`, line(NOW), NOW);
transcript('owner.jsonl', line(NOW - 120 * MIN), NOW - 120 * MIN);
transcript('busy.jsonl', line(NOW - 5 * MIN), NOW - 5 * MIN);
P = quiet();
ok(P.quiescentMin === 5, 'one live peer drags the quiet reading back to ITS age, not the orphan owner\'s', `quiescentMin=${P.quiescentMin}`);
ok(P.quiescentMin < 90, 'so the 90-minute test fails and nothing is adopted', `quiescentMin=${P.quiescentMin}`);

// 3. THE BUG THIS ACTUALLY CAUGHT, and it is the case to keep. A peer whose
//    MTIME is 30 min old — outside the 20-minute count window — but whose last
//    turn was five hours ago. With the tail prefilter at `windowMin` the mtime
//    stands, the reading is 30, and adoption is blocked FOR EVER by a session
//    that died before supper. The prefilter has to reach as far as the question.
for (const f of fs.readdirSync(peerDir)) fs.rmSync(path.join(peerDir, f));
transcript(`${SELF}.jsonl`, line(NOW), NOW);
transcript('stale.jsonl', line(NOW - 300 * MIN) + BOOKKEEPING, NOW - 30 * MIN);
P = quiet();
ok(P.quiescentMin === 300, 'a bookkeeping touch 30 min ago does not make a 5-hour-dead session a reason to refuse', `quiescentMin=${P.quiescentMin}`);
ok(P.demoted === 1, 'and it is demoted by reading the tail, not by trusting the mtime', `demoted=${P.demoted}`);

// 4. THE FLAG IS LOAD-BEARING. Same quiet world, no excludeId: the answer must
//    be "cannot tell", never "quiet". Without this the feature could ship
//    reading its own freshness back as a peer's.
P = conc.readPeerActivity({ windowMin: 20, projectsDir: peerRoot, now: NOW });
ok(P.quiescentMin === null, 'with no self-id there is no quiet reading at all', `quiescentMin=${P.quiescentMin}`);

// 5. FAIL SAFE ON A WRONG ID. An id matching no transcript excluded nothing, so
//    the reading is not self-excluded and must not be offered as one.
P = quiet('not-a-session');
ok(P.excludedFound === false && P.quiescentMin === null,
  'an id that matches no transcript reads as cannot-tell, not as quiet', `excludedFound=${P.excludedFound}, quiescentMin=${P.quiescentMin}`);

// 6. ALONE IN THE WORLD is also cannot-tell. A fixture with no peers at all
//    must not read as maximally quiet — null means null.
for (const f of fs.readdirSync(peerDir)) fs.rmSync(path.join(peerDir, f));
transcript(`${SELF}.jsonl`, line(NOW), NOW);
P = quiet();
ok(P.excludedFound === true && P.quiescentMin === null,
  'a tick alone on the disk gets no quiet reading either — there is nothing to be quiet', `quiescentMin=${P.quiescentMin}`);

// 7. THE CONTROL FOR THIS WHOLE BLOCK: the ordinary board read is unchanged by
//    all of the above. No excludeId means no widened prefilter and no extra
//    reads — the cost argument in `readPeerActivity` has to still hold.
//    The file sits at 30 minutes: OUTSIDE the 20-minute count window, INSIDE
//    the 90-minute horizon. That gap is the whole difference between the two
//    callers, and a file older than BOTH would prove nothing — the first
//    version of this case used 300 minutes and went green against a prefilter
//    that had never widened, because neither caller tails that far.
for (const f of fs.readdirSync(peerDir)) fs.rmSync(path.join(peerDir, f));
transcript('old.jsonl', line(NOW - 300 * MIN), NOW - 30 * MIN);
P = conc.readPeerActivity({ windowMin: 20, projectsDir: peerRoot, now: NOW });
ok(P.tailed === 0 && P.scanned === 1, 'an ordinary board read still costs one stat and no tail', `tailed=${P.tailed}, scanned=${P.scanned}`);
ok(P.newestAgeMin === 30, 'and it therefore still believes the mtime, exactly as before', `newestAgeMin=${P.newestAgeMin}`);
P = quiet();
ok(P.tailed === 1, 'while a tick asking the quiet question DOES reach back for it', `tailed=${P.tailed}`);
ok(P.newestOtherAgeMin === 300, 'and gets the turn\'s age where the board got the file\'s', `newestOtherAgeMin=${P.newestOtherAgeMin}`);

fs.rmSync(peerRoot, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 1c. THE UNPUSHED COUNT — against an upstream, and against a branch that has none
// ---------------------------------------------------------------------------
/* buses-data OA-313. The fault: `@{u}..HEAD` fails on a branch with no upstream
 * and the count came back `null`, which printed as nothing at all — so twenty
 * committed files on a fresh portal branch and a repository with nothing to push
 * rendered identically. Every case here is over a REAL clone with a REAL remote,
 * because the whole question is what git answers, and a synthetic conditions
 * object cannot be wrong about that.
 *
 * THE CASE TO GUARD IS THE EMPTY BRANCH. An implementation that counts
 * `origin/main..HEAD` on a freshly cut branch and reports 0 is correct; one that
 * reports the base branch's own history is loudly wrong and would say "1
 * unpushed" about a branch nobody has committed on. Both directions are asserted
 * below, and the control — a branch WITH an upstream still answering exactly what
 * it answered before — is what stops this becoming a count that is merely never
 * null. */
console.log('\n== the unpushed count, with and without an upstream (OA-313) ==');
{
  const originDir = path.join(root, 'origin.git');
  const cloneDir = path.join(root, 'clone');
  execFileSync('git', ['init', '--bare', '-b', 'main', originDir], { stdio: 'ignore' });
  const seed = path.join(root, 'seed');
  const sg = (...a) => execFileSync('git', ['-C', seed, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  fs.mkdirSync(seed, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', seed], { stdio: 'ignore' });
  sg('config', 'user.email', 'harness@example.invalid');
  sg('config', 'user.name', 'harness');
  fs.writeFileSync(path.join(seed, 'a.txt'), 'one\n');
  sg('add', 'a.txt'); sg('commit', '-q', '-m', 'first');
  sg('remote', 'add', 'origin', originDir); sg('push', '-q', 'origin', 'main');
  execFileSync('git', ['clone', '-q', originDir, cloneDir], { stdio: 'ignore' });
  const cg = (...a) => execFileSync('git', ['-C', cloneDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  cg('config', 'user.email', 'harness@example.invalid');
  cg('config', 'user.name', 'harness');
  const commit = (name) => { fs.writeFileSync(path.join(cloneDir, name), 'x\n'); cg('add', name); cg('commit', '-q', '-m', name); };
  const U = () => conc.countUnpushed(cloneDir);

  // The control, and it is the behaviour this change must not disturb.
  let u = U();
  ok(u.unpushed === 0 && u.unpushedFrom === 'upstream', 'a tracking branch with nothing to push: 0, counted against its upstream', `${u.unpushed} from ${u.unpushedFrom}`);
  ok(u.unpushedWhy === null, 'and it carries no reason, because nothing refused to answer');
  commit('b.txt');
  u = U();
  ok(u.unpushed === 1 && u.unpushedFrom === 'upstream', 'one commit on a tracking branch: 1, still against the upstream', `${u.unpushed} from ${u.unpushedFrom}`);

  // THE FAULT ITSELF. A branch cut locally, with no upstream — the state every
  // portal change begins in — and nothing committed on it yet.
  cg('checkout', '-q', '-b', 'oa308/suggest-and-signal');
  u = U();
  ok(u.unpushed === 1, 'a new branch with no upstream still answers a NUMBER, not null', `unpushed=${u.unpushed}`);
  ok(u.unpushedFrom === 'default-branch' && /^origin\//.test(u.unpushedBasis || ''), 'and it says which basis it used', `from=${u.unpushedFrom} basis=${u.unpushedBasis}`);

  // The regression to guard: cut from a branch that IS pushed, the answer is 0.
  cg('checkout', '-q', 'main'); cg('reset', '-q', '--hard', 'origin/main');
  cg('checkout', '-q', '-b', 'fresh/empty');
  u = U();
  ok(u.unpushed === 0, 'a freshly cut branch with NO commits on it reports 0, not the base branch\'s history', `unpushed=${u.unpushed}`);
  commit('c.txt'); commit('d.txt');
  u = U();
  ok(u.unpushed === 2, 'two commits on it report 2 — the count moves with the work', `unpushed=${u.unpushed}`);

  // A clone that never learned what the remote's default branch is: origin/HEAD
  // is gone, and origin/main has to be the one it falls back to.
  cg('remote', 'set-head', 'origin', '-d');
  u = U();
  ok(u.unpushed === 2 && u.unpushedBasis === 'origin/main', 'with origin/HEAD deleted it falls back to origin/main and answers the same', `${u.unpushed} vs ${u.unpushedBasis}`);

  // And where there is no basis at all, the REASON is carried rather than a null.
  const lonely = path.join(root, 'lonely');
  const lg = (...a) => execFileSync('git', ['-C', lonely, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  fs.mkdirSync(lonely, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', lonely], { stdio: 'ignore' });
  lg('config', 'user.email', 'harness@example.invalid');
  lg('config', 'user.name', 'harness');
  fs.writeFileSync(path.join(lonely, 'a.txt'), 'x\n'); lg('add', 'a.txt'); lg('commit', '-q', '-m', 'only');
  u = conc.countUnpushed(lonely);
  ok(u.unpushed === null && /remote/i.test(u.unpushedWhy || ''), 'a repository with no remote says WHY it cannot count, rather than null', `unpushed=${u.unpushed} why=${u.unpushedWhy}`);
  const line = conc.formatConditions(conc.readConditions({ buses: lonely })).join('\n');
  ok(/unpushed UNKNOWN/.test(line), 'and the printed conditions block says UNKNOWN rather than staying silent', line.split('\n')[0]);

  fs.rmSync(seed, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1d. WHAT A DETACHED HEAD IS — deploy residue, or somebody's unlanded work
// ---------------------------------------------------------------------------
/* buses-data OA-387. The fault: `portal-write` said of ANY checkout that was not
 * on `main` that the branch was "somebody's live work", and for two days that
 * sentence was said hourly about a portal checkout the deploy procedure had
 * detached and a finished worktree was holding `main` away from. Eleven ticks
 * read it, correctly declined to deliver, and none went and looked — because a
 * verdict that says somebody is mid-task reads as transient, and residue is the
 * opposite: it is still there tomorrow.
 *
 * EVERY CASE HERE IS A REAL CLONE WITH A REAL REMOTE, because the whole question
 * is what git answers about ancestry and about who holds a branch, and a
 * synthetic conditions object cannot be wrong about that. The pairs matter more
 * than usual: a rule that called every detachment residue would be as false as
 * the one it replaces, and in the more dangerous direction.
 *
 * WATCHED GO RED AGAINST THE OLD BEHAVIOUR, not only against fixtures, and both
 * experiments were run and reverted rather than reasoned about. Reinstating the
 * pre-OA-387 rule — one BETTER TO DELAY for every checkout that is not on main —
 * reddens 13 cases here and leaves every control green, including the named
 * feature branch, which is the case the old sentence was right about. Treating
 * the third answer as residue (`ancestor !== false`) reddens 4, and TWO of them
 * are `says` assertions rather than verdicts: an unlanded-work detachment and a
 * refused reading both come out BETTER TO DELAY under the old rule as well, so
 * the verdict alone cannot tell the fix from its absence and the sentence is
 * what divides them. Drop either `says` and the regression walks between the
 * cases that are left. */
console.log('\n== a detached checkout: residue or unlanded work (OA-387) ==');
{
  const originDir = path.join(root, 'origin-d.git');
  const seed = path.join(root, 'seed-d');
  const work = path.join(root, 'detached-clone');
  const held = path.join(root, 'holds-main');
  execFileSync('git', ['init', '--bare', '-b', 'main', originDir], { stdio: 'ignore' });
  const sg = (...a) => execFileSync('git', ['-C', seed, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  fs.mkdirSync(seed, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', seed], { stdio: 'ignore' });
  sg('config', 'user.email', 'harness@example.invalid');
  sg('config', 'user.name', 'harness');
  fs.writeFileSync(path.join(seed, 'a.txt'), 'one\n');
  sg('add', 'a.txt'); sg('commit', '-q', '-m', 'first');
  sg('remote', 'add', 'origin', originDir); sg('push', '-q', 'origin', 'main');
  execFileSync('git', ['clone', '-q', originDir, work], { stdio: 'ignore' });
  const wg = (...a) => execFileSync('git', ['-C', work, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  wg('config', 'user.email', 'harness@example.invalid');
  wg('config', 'user.name', 'harness');

  const readPortal = () => conc.readRepo({ key: 'portal', label: 'the portal', name: 'community-bus-maps', dir: work });
  const verdict = () => conc.assess(['portal-write'], conc.readConditions({ portal: work }));
  const block = () => conc.formatConditions(conc.readConditions({ portal: work })).join('\n');

  // THE CONTROL FIRST, and it is the one that stops a `detached` line appearing
  // over a checkout that is not detached at all: nothing measured, nothing said.
  let p = readPortal();
  ok(p.branch === 'main' && p.detached === null, 'a checkout on main carries NO detachment reading', `branch=${p.branch} detached=${JSON.stringify(p.detached)}`);
  ok(!/detached/.test(block()), 'and the conditions block prints no detached line at all');

  // The shape the deploy procedure leaves behind: detached at the commit
  // origin/main already points at.
  wg('checkout', '-q', '--detach', 'origin/main');
  p = readPortal();
  ok(p.branch === '(detached)' && p.detached && p.detached.state === 'read', 'a detached checkout is measured rather than asserted', `${p.branch} ${JSON.stringify(p.detached)}`);
  ok(p.detached.ancestor === true && p.detached.ref === 'origin/main', 'and standing on published history reads as an ancestor of origin/main', JSON.stringify(p.detached));
  ok(p.detached.heldBy === null, 'with no worktree holding main, no worktree is named — an absence is not invented');
  let v = verdict();
  ok(v.verdict === conc.CHECK, 'deploy residue is CHECK FIRST — go and look — not BETTER TO DELAY', `got ${v.verdict}`);
  ok(/residue/.test(v.reasons[0].why) && !/somebody's live work/.test(v.reasons[0].why), 'and the reason says RESIDUE, never "somebody\'s live work"', v.reasons[0].why);
  ok(/nothing clears it on its own/.test(v.reasons[0].why), 'and says in terms that waiting will not fix it — the half that cost eleven ticks');
  ok(/deploy residue/.test(block()), 'and the conditions block carries the same finding', block());

  // The worktree that holds `main` away from the primary checkout. This is the
  // fact a reader cannot guess and `git worktree list` has had all along.
  execFileSync('git', ['-C', work, 'worktree', 'add', '-q', held, 'main'], { stdio: 'ignore' });
  p = readPortal();
  ok(p.detached.heldBy !== null && /holds-main/.test(p.detached.heldBy), 'the worktree holding main is NAMED', `heldBy=${p.detached.heldBy}`);
  ok(/holds-main/.test(verdict().reasons[0].why), 'and the reason says why checking main out again would fail');
  execFileSync('git', ['-C', work, 'worktree', 'remove', held], { stdio: 'ignore' });
  ok(readPortal().detached.heldBy === null, 'and removing that worktree takes the name away again');

  // THE OTHER DIRECTION, and it is what stops this becoming a mute button: a
  // commit that is on no branch is somebody's unlanded work, and waiting IS the
  // right advice there.
  fs.writeFileSync(path.join(work, 'b.txt'), 'two\n');
  wg('add', 'b.txt'); wg('commit', '-q', '-m', 'work nobody has landed');
  p = readPortal();
  ok(p.detached.ancestor === false, 'a commit made on the detached head is NOT an ancestor of origin/main', JSON.stringify(p.detached));
  v = verdict();
  ok(v.verdict === conc.DELAY, 'unlanded work on a detached head stays BETTER TO DELAY', `got ${v.verdict}`);
  ok(/NOT on origin\/main/.test(v.reasons[0].why), 'and the reason says which way the ancestry went', v.reasons[0].why);

  // THE THIRD ANSWER. With nothing to compare against, the instrument says it
  // could not look — it does not fall back to either finding.
  wg('update-ref', '-d', 'refs/remotes/origin/main');
  p = readPortal();
  ok(p.detached.state === 'refused' && p.detached.ancestor === null, 'no origin/main to compare against: COULD NOT LOOK, not a verdict', JSON.stringify(p.detached));
  ok(/origin\/main/.test(p.detached.why || ''), 'and it says what it could not find', p.detached.why);
  v = verdict();
  ok(v.verdict === conc.DELAY && /COULD NOT LOOK/.test(v.reasons[0].why), 'a refusal takes the STRICTER verdict and says so out loud', `${v.verdict}: ${v.reasons[0].why}`);
  ok(/COULD NOT LOOK/.test(block()), 'and the conditions block does not quietly print nothing', block());

  fs.rmSync(seed, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 2. THE JUDGEMENT — each rule, made red and then cleared
// ---------------------------------------------------------------------------
console.log('\n== the rules, each one paired ==');

const repo = (over = {}) => {
  const base = {
    present: true, readable: true, name: 'repo', dir: '/x', branch: 'main', expect: 'main',
    staged: [], modified: [], untracked: [], unpushed: 0, touchedTop: [], touchesMapData: false,
  };
  const out = { ...base, ...over };
  out.dirty = out.staged.length + out.modified.length > 0;
  out.offMain = out.branch !== out.expect;
  if (!out.touchedTop.length) out.touchedTop = [...new Set([...out.staged, ...out.modified, ...out.untracked].map((p) => p.split('/')[0]))];
  return out;
};
const world = (o = {}) => ({
  at: '', selfSession: null, claims: [], peers: { ok: false },
  repos: { buses: repo(o.buses), engine: repo(o.engine), portal: repo(o.portal) },
});
const CLEAN = world();

// --- the shared working tree ---
want(conc.assess(['buses-tree'], CLEAN), conc.SAFE, 'clean tree: SAFE NOW');
const dirtyTree = world({ buses: { modified: ['_gtfs/refresh.log', 'Documentation/x.md'] } });
want(conc.assess(['buses-tree'], dirtyTree), conc.CHECK, 'uncommitted files: CHECK FIRST, not a delay');
says(conc.assess(['buses-tree'], dirtyTree), /_gtfs/, 'and it names the folder so you can recognise your own work');
says(conc.assess(['buses-tree'], dirtyTree), /cannot tell yours from a neighbour/, 'and admits it cannot attribute them');

const stagedTree = world({ buses: { staged: ['Development Docs/OA-999.md'] } });
want(conc.assess(['buses-tree'], stagedTree), conc.CHECK, "someone else's staged file: CHECK FIRST");
says(conc.assess(['buses-tree'], stagedTree), /pathspec/, 'and the remedy named is the pathspec commit');

// OA-301, the judgement half: accountFor over a synthetic repo, and the
// subtraction must reach the STAGED count too, or a staged held letter would
// print "1 already STAGED" about a file the verdict has not counted.
{
  const LETTER = 'Correspondence/CORR-001/008-out.md';
  const heldOnly = world({ buses: { modified: [LETTER] } });
  conc.accountFor(heldOnly.repos.buses, [{ path: LETTER, ref: 'corr-001-salutation' }]);
  want(conc.assess(['buses-tree'], heldOnly), conc.SAFE, 'synthetic: one held letter, accounted: SAFE');
  const unheld = world({ buses: { modified: [LETTER] } });
  conc.accountFor(unheld.repos.buses, []);
  want(conc.assess(['buses-tree'], unheld), conc.CHECK, 'synthetic: the same letter with no hold: CHECK FIRST');
  const stagedHeld = world({ buses: { staged: [LETTER], modified: ['Documentation/x.md'] } });
  conc.accountFor(stagedHeld.repos.buses, [{ path: LETTER, ref: 'corr-001-salutation' }]);
  const S = conc.assess(['buses-tree'], stagedHeld);
  want(S, conc.CHECK, 'synthetic: a staged held letter beside an unheld edit: CHECK FIRST');
  ok(S.reasons.some((x) => /^1 uncommitted file\(s\) here \(Documentation\) — this tool cannot tell/.test(x.why)),
    'and the staged-count branch is NOT taken for the accounted file', S.reasons.map((x) => x.why).join(' | '));
  const json = world({ buses: { modified: ['Correspondence/CORR-001/_people.local.json'] } });
  conc.accountFor(json.repos.buses, [{ path: 'Correspondence/CORR-001/_people.local.json', ref: 'x' }]);
  want(conc.assess(['buses-tree'], json), conc.CHECK, 'synthetic: a hold naming a .json under Correspondence/ is outside the scope: CHECK FIRST');
}

// --- the engine ---
want(conc.assess(['engine'], CLEAN), conc.SAFE, 'clean engine: SAFE NOW');
want(conc.assess(['engine'], world({ engine: { modified: ['assets/gen_internal.js'] } })), conc.CHECK, 'engine mid-edit: CHECK FIRST');
says(conc.assess(['engine'], world({ engine: { branch: 'work/labels' } })), /work\/labels/, 'engine on a branch names the branch');

// --- an estate-wide sweep: the quality_gate.js --accept shape ---
want(conc.assess(['estate-sweep'], CLEAN), conc.SAFE, 'clean tree, sweep away: SAFE NOW');
const sweepDanger = world({ buses: { untracked: ['Areas/Ramsey/ci-reference/internal.svg'] } });
want(conc.assess(['estate-sweep'], sweepDanger), conc.DELAY, 'uncommitted ci-reference: BETTER TO DELAY');
says(conc.assess(['estate-sweep'], sweepDanger), /every sheet it can FIND/, 'and says why a sweep is different from a commit');
// Cleared -- and this is the half that stops it being a mute button.
want(conc.assess(['estate-sweep'], world({ buses: { modified: ['Documentation/x.md'] } })), conc.CHECK,
  'dirty but NOT under Areas/Places/ci-reference: back down to CHECK FIRST');

// --- delivery and deploy ---
want(conc.assess(['portal-write'], CLEAN), conc.SAFE, 'portal on main and clean: SAFE NOW');
const portalBranch = world({ portal: { branch: 'oa-220-landmark-chooser' } });
want(conc.assess(['portal-write'], portalBranch), conc.DELAY, 'portal on a feature branch: BETTER TO DELAY');
says(conc.assess(['portal-deploy'], portalBranch), /oa-220-landmark-chooser/, 'and the deploy rule names the branch it would ship');
want(conc.assess(['portal-write'], world({ buses: { unpushed: 3 } })), conc.CHECK, 'unpushed commits here: CHECK FIRST before portal work');
says(conc.assess(['portal-write'], world({ buses: { unpushed: 3 } })), /verify\.yml/, 'and it says WHY the order matters');
// OA-313. A count that could not be TAKEN used to fall through this rule as
// silently as a count of zero, and the row read SAFE NOW. The pair is the
// point: unknown is CHECK FIRST, and a real zero is still SAFE NOW, or the
// rule would simply be CHECK for ever and get muted.
const cannotCount = world({ buses: { unpushed: null, unpushedWhy: 'the branch has no upstream and no origin/HEAD' } });
want(conc.assess(['portal-write'], cannotCount), conc.CHECK, 'a buses-data whose unpushed count could not be taken: CHECK FIRST, not SAFE');
says(conc.assess(['portal-write'], cannotCount), /no upstream/, 'and it repeats the reason git gave rather than reporting an absence');
want(conc.assess(['portal-write'], world({ buses: { unpushed: 0 } })), conc.SAFE, 'and a genuine zero is still SAFE NOW');
says(conc.assess(['portal-write'], world({ buses: { unpushed: 2, unpushedFrom: 'default-branch', unpushedBasis: 'origin/main' } })), /origin\/main/, 'a count taken against the default branch says so on the row');

/* OA-387, the judgement half. The observation block above proves what git
 * answers; these prove what the rule DOES with each answer, including the one
 * input a real tree cannot produce — a conditions object that carries no
 * detachment reading at all, which is every caller written before this landed
 * and every synthetic world in every harness. Falling back to the old sentence
 * there would reinstate the false claim on the one input that cannot answer
 * back, so it is a refusal like any other. */
{
  const det = (over) => world({ portal: { branch: '(detached)', detached: { state: 'read', ancestor: true, head: 'b461f93', ref: 'origin/main', heldBy: null, why: null, ...over } } });
  const residue = conc.assess(['portal-write'], det({}));
  want(residue, conc.CHECK, 'detached at a commit already on origin/main: CHECK FIRST, go and look');
  says(residue, /residue from the deploy procedure/, 'and it is named as residue');
  says(residue, /checkout main/, 'and the reason carries the command that clears it');
  ok(!/somebody's live work/.test(residue.reasons[0].why), 'and never says somebody is working on it', residue.reasons[0].why);
  // The held-by path is opaque to the rule -- it only has to come back out on
  // the row -- so it is deliberately NOT the real portal worktree path of the
  // OA-387 incident. A laptop path in a fixture works everywhere and breaks
  // nowhere, which is exactly why excusing this file for the idiom would then
  // excuse a real one too. The distinctive half, the worktree's own name, is
  // what is asserted, and that is unchanged.
  says(conc.assess(['portal-write'], det({ heldBy: 'C:/x/cbm-oa261' })), /cbm-oa261/, 'the worktree holding main is named on the row');
  want(conc.assess(['portal-write'], det({ ancestor: false })), conc.DELAY, 'detached at a commit that is NOT on origin/main: BETTER TO DELAY');
  want(conc.assess(['portal-write'], det({ state: 'refused', ancestor: null, why: 'there is no origin/main here' })), conc.DELAY, 'a refused reading: BETTER TO DELAY, the stricter answer');
  says(conc.assess(['portal-write'], det({ state: 'refused', ancestor: null, why: 'there is no origin/main here' })), /COULD NOT LOOK/, 'and it says it could not look rather than implying it did');
  const unmeasured = world({ portal: { branch: '(detached)' } });
  want(conc.assess(['portal-write'], unmeasured), conc.DELAY, 'a detached portal with NO reading at all: BETTER TO DELAY');
  ok(!/somebody's live work/.test(conc.assess(['portal-write'], unmeasured).reasons[0].why),
    'and it must NOT fall back to the sentence this action was filed about', conc.assess(['portal-write'], unmeasured).reasons[0].why);
  // The control that keeps the old behaviour where it was right: a NAMED branch
  // really is somebody's work, and that sentence is correct about it.
  says(conc.assess(['portal-write'], portalBranch), /somebody's live work/, 'a named feature branch still reads as somebody working');
}

// --- failing safe ---
const blind = world({ portal: { present: false, readable: false } });
want(conc.assess(['portal-write'], blind), conc.CHECK, 'a portal it cannot read is never reported SAFE');

// ---------------------------------------------------------------------------
// 3. WHICH ROW GETS WHICH VERDICT
// ---------------------------------------------------------------------------
console.log('\n== rows ==');

// The worst world it can construct. Everything that touches a tree should be
// held back in it -- and the decisions must NOT be, because a decision taken in
// a browser cannot be spoiled by anything happening on this disk. That is the
// single most important assertion in this file: it is what makes the tool
// useful rather than merely cautious.
const WORST = world({
  buses: { staged: ['Areas/Ramsey/S3-config/x.json'], modified: ['_gtfs/refresh.log'], unpushed: 4 },
  engine: { branch: 'work/x', modified: ['assets/render.js'] },
  portal: { branch: 'oa-220-x', modified: ['src/app.js'] },
});

for (const [type, key] of [['review', 'review-7'], ['application', 'apps'], ['request-decision', 'req-3'], ['awaiting-customer', 'await-2'], ['commitment', 'commitment-letter']]) {
  want(conc.classify({ type, key }, WORST), conc.SAFE, `${type}: SAFE NOW even in the worst world — it is a decision, not a write`);
}
want(conc.classify({ type: 'correspondence', key: 'corr-unsent-CORR-001' }, WORST), conc.SAFE,
  'a drafted reply Peter has to SEND: SAFE NOW — it is an email, not a commit');
want(conc.classify({ type: 'correspondence', key: 'corr-owed-CORR-001' }, WORST), conc.CHECK,
  'a reply that still has to be DRAFTED: CHECK FIRST — drafting writes into the tree');

want(conc.classify({ type: 'housekeeping', key: 'engine-stale' }, WORST), conc.DELAY,
  'an estate rollout: BETTER TO DELAY');
want(conc.classify({ type: 'housekeeping', key: 's6-stale' }, WORST), conc.CHECK,
  'one town\'s S6 pass: CHECK FIRST — the two housekeeping rows are not conflated');
want(conc.classify({ type: 'build', key: 'build-x' }, WORST), conc.DELAY,
  'a build that ends in a delivery: BETTER TO DELAY while the portal is off main');
want(conc.classify({ type: 'refresh-local', key: 'refresh-local-Ramsey' }, WORST), conc.CHECK,
  'a local-only refresh: CHECK FIRST — it never reaches the portal');

// An unrecognised type must not be assumed harmless. Whoever adds a new type
// should find it marked and come and say what it touches.
want(conc.classify({ type: 'something-new', key: 'zzz' }, WORST), conc.CHECK,
  'an unknown item type is not assumed harmless');

// One fact, stated once. contentions() is what lets the rows stay short.
const rows = [
  { key: 'a', type: 'refresh-local', safety: conc.classify({ key: 'a', type: 'refresh-local' }, dirtyTree) },
  { key: 'b', type: 'refresh-local', safety: conc.classify({ key: 'b', type: 'refresh-local' }, dirtyTree) },
];
ok(conc.contentions(rows, dirtyTree).length === 1, 'two rows blocked by one thing produce ONE contention line',
  `got ${conc.contentions(rows, dirtyTree).length}`);

// ---------------------------------------------------------------------------
// 3b. THE EXPIRED-CLAIM MARKER — read off real OA files, judged on AGE
// ---------------------------------------------------------------------------
//
// Deliberately end-to-end rather than over a hand-built claims array. The
// marker reads `ageDays`, `ageDays` is produced by readClaims parsing a
// `selected:` line, and a test that hands formatConditions an object it made
// itself could not tell you the parser ever produces the field — "the subject
// you named yourself", and the reason `now` was made injectable above.
console.log('\n== the expired-claim marker ==');
{
  const busesDir = path.join(root, 'claims-fixture');
  const oa = path.join(busesDir, 'Development Docs', 'open-actions');
  fs.mkdirSync(oa, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', busesDir], { stdio: 'ignore' });

  const NOW = Date.parse('2026-09-13T09:00:00Z');
  const day = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
  const action = (ref, date, session, note) => fs.writeFileSync(path.join(oa, `${ref}.md`),
    `---\nref: ${ref}\nstatus: open\nselected: ${date}, ${session}, ${note}\n---\n\nbody\n`);
  const blockAt = (now, dir = busesDir) => conc.formatConditions(conc.readConditions({ buses: dir, now })).join('\n');

  action('OA-901', day(0), 'buses-live', 'being worked right now');
  action('OA-902', day(3), 'buses-gone', 'nobody is behind this');
  // A date the regex matches and Date.parse does not. "Could not look" is a
  // third answer and must never be rendered as a finding.
  action('OA-903', '2026-13-45', 'buses-odd', 'an age nothing can compute');

  const b = blockAt(NOW);
  ok(/OA-902 \(3d\).*<< EXPIRED, 3 day\(s\) old/.test(b), 'a claim made before today is MARKED EXPIRED, with its age', b);
  ok(/OA-901 \(today\)(?!.*EXPIRED)/.test(b), 'CONTROL — a claim made today is printed and NOT marked', b);
  ok(/OA-903(?!.*EXPIRED)/.test(b), 'CONTROL — an age that would not parse is not marked either', b);
  ok(/claimed BEFORE TODAY/.test(b) && /assemble\.mjs" --claim OA-902 --as /.test(b),
    'and one summary line names the count and prints the --claim that takes one', b);
  // OA-400 (R7): an expired claim is FREE — --claim takes it without --force. A
  // board that still says "release it" sends a session to do a chore that no
  // longer exists, and contradicts assemble.mjs --who printed beside it.
  ok(!/releas/i.test(b), 'it never tells anyone to RELEASE an expired claim', b);
  ok(/without --force/.test(b), 'it says the row is free: --claim takes it without --force', b);
  ok(/an AGE, not a liveness check/.test(b),
    'the summary says it is an AGE — this board cannot tell a dead session from an idle one', b);
  ok((b.match(/claimed BEFORE TODAY/g) || []).length === 1, 'the summary is printed once, not once per stale claim', b);

  // THE INJECTION IS LIVE. Same files, clock moved on two days: the claim that
  // was fresh is now stale. Without this, a marker wired to a hardcoded date
  // would pass every case above on the day the fixture was written.
  const later = blockAt(NOW + 2 * 86400000);
  ok(/OA-901 \(2d\).*<< EXPIRED, 2 day\(s\) old/.test(later), 'two days later the SAME file reads expired — the age is computed, not fixed', later);
  ok(/3 of those were claimed BEFORE TODAY|2 of those were/.test(later), 'and the count moves with it', later);

  // MUTATION CONTROL — with nothing old, the summary must be ABSENT. A footer
  // printed unconditionally would satisfy every assertion above.
  const freshOnly = path.join(root, 'claims-fresh');
  fs.mkdirSync(path.join(freshOnly, 'Development Docs', 'open-actions'), { recursive: true });
  execFileSync('git', ['init', '-b', 'main', freshOnly], { stdio: 'ignore' });
  fs.writeFileSync(path.join(freshOnly, 'Development Docs', 'open-actions', 'OA-904.md'),
    `---\nref: OA-904\nstatus: open\nselected: ${day(0)}, buses-live, today only\n---\n\nbody\n`);
  const clean = blockAt(NOW, freshOnly);
  ok(/OA-904 \(today\)/.test(clean) && !/EXPIRED/.test(clean) && !/claimed BEFORE TODAY/.test(clean),
    'CONTROL — no expired claim, no marker and no summary line at all', clean);

  // The boundary, stated once rather than inferred from the cases above.
  ok(conc.isStaleClaim({ ageDays: conc.STALE_CLAIM_AFTER_DAYS }) && !conc.isStaleClaim({ ageDays: 0 })
    && !conc.isStaleClaim({ ageDays: null }),
    `the threshold is ${conc.STALE_CLAIM_AFTER_DAYS} day and a null age is not stale`);
}

// ---------------------------------------------------------------------------
// 3c. THE DECISION MARKER, JOINED TO THE BOARD ROW IT NAMES (OA-414)
// ---------------------------------------------------------------------------
//
// PAIRED, AND THE PAIRING IS THE WHOLE TEST. This gate suppresses commands on a
// board row, so a reader has to be able to see it stop suppressing them. OA-340
// asserted on 2026-09-20 that `decision: peter` already took its chore out of
// the board's housekeeping band; it did not, and nothing went red, because
// there was nothing anywhere that could have. Each case below removes one half
// of the marker and sees the row come back.
//
// END-TO-END OVER REAL FILES for the same reason 3b is: `readDecisionRows`
// parses front matter off the disk, and a test handing it an object it built
// itself could not tell you the parser ever produces a key.
console.log('\n== the backlog decision marker, and the board rows it owns ==');
{
  const busesDir = path.join(root, 'decision-fixture');
  const oa = path.join(busesDir, 'Development Docs', 'open-actions');
  fs.mkdirSync(oa, { recursive: true });
  const write = (ref, fm) => fs.writeFileSync(path.join(oa, `${ref}.md`),
    `---\nref: ${ref}\nstatus: open\nheadline: "what ${ref} is about"\n${fm}---\n\nbody\n`);
  const keysFor = (ref) => conc.readDecisionRows(busesDir).filter((d) => d.ref === ref).map((d) => d.key);

  write('OA-901', 'decision: peter\nboardRows: engine-stale\n');
  let got = conc.readDecisionRows(busesDir);
  ok(got.length === 1 && got[0].key === 'engine-stale' && got[0].ref === 'OA-901',
    'a `decision: peter` action naming a board row yields that row key', JSON.stringify(got));
  ok(got[0].origin === 'decision' && /OA-901\.md$/.test(got[0].source) && got[0].need === 'what OA-901 is about',
    'and it carries its origin, its file and the headline the reader needs', JSON.stringify(got[0]));

  // THE GATE ACTUALLY GATES. applyHolds is the mechanism the renderer reads, so
  // assert against IT and not against the list — a reader is protected by the
  // attachment, not by the parse.
  const rows = [{ key: 'engine-stale', title: 'eight towns' }, { key: 's6-stale', title: 'verification' }];
  const applied = applyHolds(rows, got);
  ok(applied.applied === 1 && rows[0].onHold?.length === 1 && !rows[1].onHold,
    'it attaches to the row it names and to no other row', JSON.stringify(rows));

  // RED → GREEN, arm 1: the decision marker goes and the row is free again.
  write('OA-901', 'boardRows: engine-stale\n');
  ok(keysFor('OA-901').length === 0,
    'CONTROL — `boardRows:` WITHOUT `decision: peter` gates nothing', JSON.stringify(keysFor('OA-901')));

  // RED → GREEN, arm 2: the marker stays and the naming goes. This is the state
  // the whole estate was in until 2026-09-20 — the marker set, the board
  // untold — and it must read as no gate rather than as a gate on everything.
  write('OA-901', 'decision: peter\n');
  ok(keysFor('OA-901').length === 0,
    'CONTROL — `decision: peter` with no `boardRows:` gates nothing, which is the pre-OA-414 world', JSON.stringify(keysFor('OA-901')));

  // A wrong value is not a quiet one. `decision: yes` is refused at filing by
  // assemble.mjs; here it must simply not gate, never gate by truthiness.
  write('OA-901', 'decision: yes\nboardRows: engine-stale\n');
  ok(keysFor('OA-901').length === 0, 'CONTROL — a `decision:` value that is not peter gates nothing');

  // Several keys, and the separator is not load-bearing.
  write('OA-902', 'decision: peter\nboardRows: engine-stale, s6-stale\n');
  write('OA-903', 'decision: PETER\nboardRows: `nobuild-March`\n');
  const multi = keysFor('OA-902');
  ok(multi.length === 2 && multi.includes('engine-stale') && multi.includes('s6-stale'),
    'one action may own several rows', JSON.stringify(multi));
  ok(keysFor('OA-903').join() === 'nobuild-March',
    'the value is case-insensitive and backticks are stripped', JSON.stringify(keysFor('OA-903')));

  // AN EMPTY BACKLOG IS NOT AN ERROR, and a missing folder is not either — the
  // board runs against trees that have neither.
  ok(conc.readDecisionRows(path.join(root, 'no-such-tree')).length === 0,
    'CONTROL — no backlog folder at all reads as no decisions, not as a throw');
}

// ---------------------------------------------------------------------------
// 4. THE CONTROL — a quiet machine must say go
// ---------------------------------------------------------------------------
console.log('\n== the control: nothing else running ==');

for (const t of conc.STANDING_TOOLS) {
  want(conc.assess(t.needs, CLEAN), conc.SAFE, `clean world: "${t.what}" is SAFE NOW`);
}
for (const type of ['build', 'refresh', 'housekeeping', 'correspondence', 'gate']) {
  want(conc.classify({ type, key: `${type}-1` }, CLEAN), conc.SAFE, `clean world: a ${type} row is SAFE NOW`);
}
ok(conc.contentions([{ key: 'a', type: 'build', safety: conc.classify({ key: 'a', type: 'build' }, CLEAN) }], CLEAN).length === 0,
  'and nothing is listed as contended');

// The other side of the control: the worst world must NOT be all-clear, or the
// block above would pass with rules that always return SAFE.
ok(conc.STANDING_TOOLS.some((t) => conc.assess(t.needs, WORST).verdict !== conc.SAFE),
  'and the worst world does hold something back (so the control means something)');

fs.rmSync(root, { recursive: true, force: true });
if (bad) { console.log(`\n${bad} case(s) behaved wrongly.`); process.exit(1); }
console.log('\nAll cases behaved: it holds work back when it should, and gets out of the way when it should.');
