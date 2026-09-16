#!/usr/bin/env node
/* Prove the stranded-branch row can go red — and, harder, that it stays SILENT
 * for every branch that is finished (buses-data OA-326).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-unpushed-branches.mjs
 *
 * No placeholders; it builds its own throwaway git repositories under the OS
 * temp directory — a bare "origin" and a clone with a remote, a worktree and a
 * squash-merge history — and never looks at the real trees. It opens no socket,
 * because neither does the thing under test.
 *
 * WHY THE SILENT CASES CARRY MORE WEIGHT THAN THE LOUD ONE. The loud case is
 * easy: a committed branch nobody pushed must raise a row. The way this source
 * actually fails is by being RIGHT too often — the portal has 34 local branches
 * and 24 of them are finished work that still looks unmerged from one angle or
 * another. A row that raised those would be muted inside a week, which is this
 * project's standard way of losing a gate. So a third of the assertions below
 * are controls asserting SILENCE, and two of them cannot be falsified by
 * deleting the guard at all — they go red against a broken SCOPE, and they are
 * named CONTROL rather than counted as evidence that the rule works. The run
 * prints how many controls it carried; do not write the number here, because
 * this sentence said "five of the nine" until 2026-09-15 and by then it was
 * seven of twenty-five.
 *
 * THE TRAP HAS ITS OWN FIXTURE, because reasoning about it got the wrong answer
 * first. `git cherry` is defeated by a squash merge of TWO commits and not by a
 * squash of one, so `squashed-double` below is built to be exactly the shape
 * that lies, and the assertion next to it proves that ahead-count would have
 * raised it. Without that pair, a future simplification back to ahead-count
 * would pass every other case here.
 *
 * WHICH ASSERTION CATCHES WHICH MUTATION WAS MEASURED, not assumed, by a sweep
 * of six mutations of `unpushed_branches.mjs` on 2026-09-12 — all six red, exit
 * 1 each. Two results are worth carrying:
 *
 *   - Replacing patch identity with AHEAD-COUNT reddens exactly ONE assertion,
 *     the `squashed-single` control. Every other case survives it, because the
 *     two-commit squash is already rescued by its gone upstream. So that single
 *     control is the whole of this harness's defence against the change the
 *     module's header argues hardest against, and it must not be deleted as
 *     redundant with the one below it.
 *   - `each says how much work is sitting there` was first written as
 *     `/insertion/` over the row's own sentence, and in that form it could not
 *     fail: the word is in the sentence whatever the number is. Dropping the
 *     insertion count entirely left it green. It asserts the COUNT now, and
 *     that mutation is red.
 *
 * THE 2026-09-15 ROUND ADDED THE `gone-extended` GRADE, and its two mutations
 * were run the same way — collapsing the grade back to `gone-upstream` reddens 7
 * assertions, and dropping the trunk-HISTORY half of `addedAndAbsent` reddens 4.
 * Worth more than either: the `squashed-then-trunk-deleted` CONTROL went red
 * against the first draft of the rule and is what put that history half in.
 * A rule with three measured rejections behind it was still wrong about a case
 * the 22 real branches did not happen to contain, and only a control asserting
 * silence could have said so.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBranches, classifyBranch, unpushedBranchItems, defaultGit } from './unpushed_branches.mjs';
import * as conc from './concurrency.mjs';

/* fileURLToPath, not new URL(...).pathname: this tree lives under
 * "C:\u3a St Ives\.claude\..." and the latter percent-encodes the space. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strand-'));
let bad = 0;
let controls = 0;

function ok(pass, label, detail) {
  console.log(`  ${pass ? 'ok   ' : 'MISS '} ${label}`);
  if (!pass) { bad++; if (detail) console.log(`        ${detail}`); }
}
function control(pass, label, detail) {
  controls++;
  console.log(`  ${pass ? 'ok   ' : 'MISS '} CONTROL — ${label}`);
  if (!pass) { bad++; if (detail) console.log(`        ${detail}`); }
}

// ---------------------------------------------------------------------------
// The fixture: a bare origin, a clone, and one branch per shape we have met.
// ---------------------------------------------------------------------------
const origin = path.join(root, 'origin.git');
const work = path.join(root, 'work');
const g = (...a) => execFileSync('git', ['-C', work, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const commit = (name, body) => {
  fs.writeFileSync(path.join(work, name), body);
  g('add', name);
  g('commit', '-m', `add ${name}`);
};

try {
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
  execFileSync('git', ['clone', origin, work], { stdio: 'ignore' });
  g('config', 'user.email', 'harness@example.invalid');
  g('config', 'user.name', 'harness');
  commit('trunk.txt', 'one\n');
  g('push', '-u', 'origin', 'main');

  // 1. STRANDED — committed, never pushed. The whole point of the row.
  g('checkout', '-b', 'stranded');
  commit('stranded.txt', 'a\nb\nc\n');

  // 2. PUSHED AND LIVE — on the remote, so somebody other than this laptop can
  //    see it. Not raised: whether a pull request is open is the half this
  //    source deliberately does not ask, and the narrowing is in its header.
  g('checkout', 'main');
  g('checkout', '-b', 'pushed-live');
  commit('pushed.txt', 'a\n');
  g('push', '-u', 'origin', 'pushed-live');

  // 3. MERGED PLAIN — merged into main the ordinary way and main pushed.
  g('checkout', 'main');
  g('checkout', '-b', 'merged-plain');
  commit('merged.txt', 'a\n');
  g('checkout', 'main');
  g('merge', '--no-ff', '-m', 'merge merged-plain', 'merged-plain');
  g('push', 'origin', 'main');

  // 4. SQUASHED SINGLE — one commit, squash-merged, remote branch deleted. The
  //    patch survives the squash, so `cherry` gets this one right on its own.
  g('checkout', '-b', 'squashed-single');
  commit('sq1.txt', 'a\n');
  g('push', '-u', 'origin', 'squashed-single');
  g('checkout', 'main');
  g('merge', '--squash', 'squashed-single');
  g('commit', '-m', 'squash squashed-single (#1)');
  g('push', 'origin', 'main');
  g('push', 'origin', '--delete', 'squashed-single');

  // 5. SQUASHED DOUBLE — TWO commits squashed into one, remote branch deleted.
  //    This is the shape that lies: neither commit's patch-id survives, so
  //    `cherry` reports it unmerged for ever. The portal has two of these from
  //    August. Only the gone upstream tells the truth about it.
  g('checkout', '-b', 'squashed-double');
  commit('sq2a.txt', 'a\n');
  commit('sq2b.txt', 'b\n');
  g('push', '-u', 'origin', 'squashed-double');
  g('checkout', 'main');
  g('merge', '--squash', 'squashed-double');
  g('commit', '-m', 'squash squashed-double (#2)');
  g('push', 'origin', 'main');
  g('push', 'origin', '--delete', 'squashed-double');

  // 6. SQUASHED THEN EXTENDED — squash-merged and the remote branch deleted,
  //    exactly like 5, and then committed to AGAIN. The new commit adds a file
  //    the trunk has never had. This is what the loop does to its own branch
  //    every hour, and until 2026-09-15 it was folded into 5's silent note.
  g('checkout', '-b', 'squashed-extended');
  commit('se1.txt', 'a\n');
  commit('se2.txt', 'b\n');
  g('push', '-u', 'origin', 'squashed-extended');
  g('checkout', 'main');
  g('merge', '--squash', 'squashed-extended');
  g('commit', '-m', 'squash squashed-extended (#3)');
  g('push', 'origin', 'main');
  g('push', 'origin', '--delete', 'squashed-extended');
  g('checkout', 'squashed-extended');
  commit('se-after.txt', 'x\ny\nz\nw\n');   // four lines: the row must say four

  // 7. CONTROL — THE TRUNK DELETED A FILE THE BRANCH STILL CARRIES. Measured on
  //    2026-09-15 as the false-positive class that sank the obvious rule: the
  //    portal dropped `CHANGELOG.md` in the 2026-08-27 truncation, so 7 of its
  //    17 gone-upstream branches carry a path the trunk lacks and NOT ONE of
  //    them has gained a commit. A branch of this shape must stay silent — the
  //    trunk deleting a file is not this branch adding one.
  g('checkout', 'main');
  g('checkout', '-b', 'squashed-then-trunk-deleted');
  commit('sd1.txt', 'a\n');
  commit('sd2.txt', 'b\n');
  g('push', '-u', 'origin', 'squashed-then-trunk-deleted');
  g('checkout', 'main');
  g('merge', '--squash', 'squashed-then-trunk-deleted');
  g('commit', '-m', 'squash squashed-then-trunk-deleted (#4)');
  g('rm', 'sd2.txt');
  g('commit', '-m', 'the trunk drops sd2.txt later');
  g('push', 'origin', 'main');
  g('push', 'origin', '--delete', 'squashed-then-trunk-deleted');

  // 8. CONTROL — THE NAMED HOLE, written as a case rather than as a sentence. A
  //    post-squash commit that only MODIFIES a file the branch already had adds
  //    no path, so it stays graded as landed. Silent, not wrong: the branch sits
  //    where it sat before `gone-extended` existed. A later widening flips this
  //    case; until then it is the boundary of the claim.
  g('checkout', 'main');
  g('checkout', '-b', 'squashed-extended-modify-only');
  commit('mo1.txt', 'a\n');
  commit('mo2.txt', 'b\n');
  g('push', '-u', 'origin', 'squashed-extended-modify-only');
  g('checkout', 'main');
  g('merge', '--squash', 'squashed-extended-modify-only');
  g('commit', '-m', 'squash squashed-extended-modify-only (#5)');
  g('push', 'origin', 'main');
  g('push', 'origin', '--delete', 'squashed-extended-modify-only');
  g('checkout', 'squashed-extended-modify-only');
  commit('mo1.txt', 'a\nand more\n');
  g('checkout', 'main');

  // 9. STARTED FROM THE TRUNK WITH AN UPSTREAM ALREADY SET. `git worktree add -b
  //    <b> <path> origin/main` — how a branch is started in this estate — points
  //    the new branch's upstream at origin/MAIN. A branch with an upstream
  //    configured used to read as "somebody can see it"; nobody can. Found on
  //    2026-09-15 because the tick writing this created one for its own work and
  //    watched the board stay quiet about it.
  g('branch', 'upstream-is-the-trunk', 'main');
  g('branch', '--set-upstream-to=origin/main', 'upstream-is-the-trunk');
  g('checkout', 'upstream-is-the-trunk');
  commit('ut.txt', 'a\n');
  g('checkout', 'main');

  // 10. IN A WORKTREE — the blind spot that started all this. `countUnpushed`
  //    reads HEAD in the main checkout and cannot see this branch at all.
  g('worktree', 'add', '-b', 'in-a-worktree', path.join(root, 'wt'));
  execFileSync('git', ['-C', path.join(root, 'wt'), 'config', 'user.email', 'harness@example.invalid'], { stdio: 'ignore' });
  execFileSync('git', ['-C', path.join(root, 'wt'), 'config', 'user.name', 'harness'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(root, 'wt', 'wt.txt'), 'a\n');
  execFileSync('git', ['-C', path.join(root, 'wt'), 'add', 'wt.txt'], { stdio: 'ignore' });
  execFileSync('git', ['-C', path.join(root, 'wt'), 'commit', '-m', 'work in a worktree'], { stdio: 'ignore' });

  g('checkout', 'main');
  g('fetch', '--prune');
} catch (e) {
  /* THE ROOM MUST NOT BE RED BEFORE THE EXPERIMENT. If the fixture cannot be
   * built, every case below would fail for a reason that has nothing to do with
   * the thing under test. Refuse to run rather than report it. */
  console.log(`\n  Cannot build the git fixture (${String(e.message).split('\n')[0]}). Nothing was tested.`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 1. THE OBSERVATION — does readBranches see what is actually on the disk?
// ---------------------------------------------------------------------------
console.log('\n== reading real branches ==');

const read = readBranches(work, defaultGit);
ok(read.readable && read.base === 'origin/main', 'the clone reads, and its trunk is origin/main', `readable=${read.readable} base=${read.base}`);

const by = Object.fromEntries(read.branches.map((b) => [b.branch, b]));
ok(!!by['in-a-worktree'], 'a branch held in a WORKTREE is in the listing — the blind spot that started this',
  `saw: ${read.branches.map((b) => b.branch).join(', ')}`);
ok(!('main' in by), 'the trunk itself is not a candidate');

const grade = (name) => (by[name] ? classifyBranch(by[name]) : '(absent)');

// ---------------------------------------------------------------------------
// 2. THE JUDGEMENT — one assertion per shape, loud and silent.
// ---------------------------------------------------------------------------
console.log('\n== grading each shape ==');

ok(grade('stranded') === 'stranded', 'a committed, never-pushed branch is STRANDED', `got ${grade('stranded')}`);
ok(grade('in-a-worktree') === 'stranded', 'and so is one committed inside a worktree', `got ${grade('in-a-worktree')}`);
control(grade('pushed-live') === 'pushed', 'a branch that IS on the remote is not stranded', `got ${grade('pushed-live')}`);
control(grade('merged-plain') === 'merged', 'a branch merged the ordinary way is not stranded', `got ${grade('merged-plain')}`);
control(grade('squashed-single') === 'merged', 'a SINGLE-commit squash merge is seen as merged by patch identity', `got ${grade('squashed-single')}`);
control(grade('squashed-double') === 'gone-upstream', 'a TWO-commit squash merge is rescued by its gone upstream, not by cherry', `got ${grade('squashed-double')}`);
ok(grade('upstream-is-the-trunk') === 'stranded',
  'a branch whose upstream was set to the TRUNK when it was created is still stranded — an upstream is not a push',
  `got ${grade('upstream-is-the-trunk')}`);
ok(grade('squashed-extended') === 'gone-extended',
  'a branch COMMITTED TO AFTER its squash landed is gone-EXTENDED, not landed', `got ${grade('squashed-extended')}`);
control(grade('squashed-then-trunk-deleted') === 'gone-upstream',
  'a branch carrying a file the TRUNK later deleted is still landed — the class that sank the obvious rule',
  `got ${grade('squashed-then-trunk-deleted')}`);
control(grade('squashed-extended-modify-only') === 'gone-upstream',
  'the named hole: a post-squash commit that only MODIFIES is silent, and that boundary is asserted rather than described',
  `got ${grade('squashed-extended-modify-only')}`);

// THE DISCRIMINATOR'S THIRD VALUE, asserted so a refusal can never be read as an
// absence. It is asked only of a gone upstream; everywhere else it must be null,
// which is "not asked" and is a different thing from "nothing found".
ok((by['squashed-extended'] || {}).addedMissing?.length === 1
  && (by['stranded'] || {}).addedMissing === null,
  'the added-and-absent question is asked of a gone upstream and of nothing else, and null means NOT ASKED',
  `extended=${JSON.stringify((by['squashed-extended'] || {}).addedMissing)} stranded=${JSON.stringify((by['stranded'] || {}).addedMissing)}`);

// THE TRAP, STATED AS AN ASSERTION RATHER THAN AS A COMMENT. If this ever fails
// the fixture has stopped being the shape that lies, and the control above has
// quietly stopped proving anything.
ok((by['squashed-double'] || {}).unmerged > 0,
  'and `git cherry` really does still call that branch unmerged — the trap is real, not remembered',
  `unmerged=${(by['squashed-double'] || {}).unmerged}`);

// ---------------------------------------------------------------------------
// 3. THE ROWS — exactly the stranded ones, with what a reader needs on them.
// ---------------------------------------------------------------------------
console.log('\n== the rows it raises ==');

const got = unpushedBranchItems({ repos: [{ key: 'f', name: 'fixture', dir: work, prPerChange: true }], git: defaultGit });
const names = got.items.map((i) => i.ref).sort();
ok(JSON.stringify(names) === JSON.stringify(['in-a-worktree', 'squashed-extended', 'stranded', 'upstream-is-the-trunk']),
  'four rows — the three stranded branches and the one that was added to after its merge', `got ${JSON.stringify(names)}`);
ok(got.items.every((i) => i.rank === 3), 'each sits in SOMEONE IS BLOCKED (rank 3)');
const strandedRows = got.items.filter((i) => i.ref !== 'squashed-extended');
ok(strandedRows.every((i) => i.do.some((d) => d.kind === 'shell' && d.cmd.includes(`push -u origin ${i.ref}`) && d.cmd.includes(work))),
  'each stranded row carries a self-contained push command with its repository inside it',
  strandedRows.map((i) => (i.do.find((d) => d.kind === 'shell') || {}).cmd).join(' | '));

// THE ADVICE IS THE POINT OF THE SEPARATE ROW, so it is asserted rather than
// left to the prose. Telling Peter to push this branch would re-propose
// everything its squash already took, because a pull request diffs against the
// merge base — so the row must NOT carry the push command the others carry, and
// must say what to do instead.
const extRow = got.items.find((i) => i.ref === 'squashed-extended');
ok(extRow && !extRow.do.some((d) => d.kind === 'shell' && /push/.test(d.cmd))
  && extRow.do.some((d) => d.kind === 'chat' && /cherry-pick/.test(d.what)),
  'the extended row does NOT say push it, and says cherry-pick onto a fresh branch instead',
  JSON.stringify((extRow || {}).do));
ok(/\b4 insertion/.test((extRow || {}).why || ''),
  'and it sizes the work added SINCE the merge — four lines — not the whole branch',
  (extRow || {}).why);
ok(/se-after\.txt/.test((extRow || {}).detail || ''),
  'and names the file that proves it, so a reader can check the verdict rather than trust it',
  (extRow || {}).detail);
// Membership of the note's own comma-separated list, not a substring match:
// `squashed-extended-modify-only` starts with the same letters and is supposed
// to be in there, so a /squashed-extended/ test would have passed either way.
ok(!got.notes.some((n) => n.split(/[:,]\s+/).includes('squashed-extended')),
  'and it is no longer swallowed by the note that says these branches landed', got.notes.join(' | '));
// NOT `/insertion/`, which is what this said first and which cannot fail: the
// sentence carries the word "insertion(s)" whatever the number is, including
// when the number is the string "an unknown". Assert the COUNT, against a
// fixture whose file is three lines long — the named shape *the subject you
// named yourself*, where a check pointed at something you supplied reports
// nothing wrong because it could not have.
const strandedRow = got.items.find((i) => i.ref === 'stranded');
ok(/\b3 insertion/.test((strandedRow || {}).why || ''),
  'each says how much work is sitting there, and the number is the real one',
  (strandedRow || {}).why);
ok(got.notes.some((n) => /pushed-live/.test(n)),
  'the half it does NOT ask about is reported rather than silently absent', got.notes.join(' | '));
ok(got.notes.some((n) => /squashed-double/.test(n)),
  'and so is the branch it decided was merged despite cherry', got.notes.join(' | '));

// ---------------------------------------------------------------------------
// 4. THE HEADLINE CLAIM — countUnpushed cannot see any of this.
// ---------------------------------------------------------------------------
console.log('\n== the blind spot this exists to cover ==');

const repo = conc.readRepo({ key: 'f', label: 'fixture', name: 'fixture', dir: work });
ok(repo.unpushed === 0,
  'with main checked out, countUnpushed reports NOTHING unpushed — the board would print "clean"',
  `unpushed=${repo.unpushed} basis=${repo.unpushedBasis}`);
ok(got.items.length === 4,
  'while this source names four branches of committed work nobody has pushed');

// ---------------------------------------------------------------------------
// 5. REFUSAL IS NOT ABSENCE — a repo it cannot read says so, and raises nothing.
// ---------------------------------------------------------------------------
console.log('\n== when it cannot look ==');

const notARepo = path.join(root, 'not-a-repo');
fs.mkdirSync(notARepo, { recursive: true });
const noRepo = unpushedBranchItems({ repos: [{ key: 'x', name: 'nope', dir: notARepo }], git: defaultGit });
ok(noRepo.items.length === 0 && noRepo.unreadable.length === 1 && /not a git working tree/.test(noRepo.unreadable[0].why),
  'a directory that is not a git tree raises no row and SAYS why',
  JSON.stringify(noRepo.unreadable));

const lonely = path.join(root, 'lonely');
execFileSync('git', ['init', '-b', 'main', lonely], { stdio: 'ignore' });
execFileSync('git', ['-C', lonely, 'config', 'user.email', 'harness@example.invalid'], { stdio: 'ignore' });
execFileSync('git', ['-C', lonely, 'config', 'user.name', 'harness'], { stdio: 'ignore' });
fs.writeFileSync(path.join(lonely, 'a.txt'), 'a\n');
execFileSync('git', ['-C', lonely, 'add', 'a.txt'], { stdio: 'ignore' });
execFileSync('git', ['-C', lonely, 'commit', '-m', 'only commit'], { stdio: 'ignore' });
const noRemote = unpushedBranchItems({ repos: [{ key: 'y', name: 'no-remote', dir: lonely }], git: defaultGit });
ok(noRemote.items.length === 0 && /no origin\/HEAD/.test((noRemote.unreadable[0] || {}).why || ''),
  'a repository with NO REMOTE raises no row and says it has nothing to compare against',
  JSON.stringify(noRemote.unreadable));

// A stub git that answers null to everything: the source must not throw, and
// must not invent a finding out of a refusal.
const deadGit = () => null;
const dead = unpushedBranchItems({ repos: [{ key: 'z', name: 'dead', dir: work }], git: deadGit });
control(dead.items.length === 0 && dead.unreadable.length === 1,
  'a git that answers nothing produces a stated refusal, never a row');

// ---------------------------------------------------------------------------
console.log(`\n${bad === 0 ? 'PROVEN' : 'FAILED'} — ${bad} miss(es); ${controls} of the assertions are controls asserting silence.`);
try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* the temp dir is the OS's problem */ }
process.exit(bad === 0 ? 0 : 1);
