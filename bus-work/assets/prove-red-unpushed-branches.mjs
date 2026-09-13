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
 * project's standard way of losing a gate. So five of the nine assertions below
 * are controls asserting SILENCE, and two of them cannot be falsified by
 * deleting the guard at all — they go red against a broken SCOPE, and they are
 * named CONTROL rather than counted as evidence that the rule works.
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

  // 6. IN A WORKTREE — the blind spot that started all this. `countUnpushed`
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
ok(JSON.stringify(names) === JSON.stringify(['in-a-worktree', 'stranded']),
  'two rows, and they are the two stranded branches', `got ${JSON.stringify(names)}`);
ok(got.items.every((i) => i.rank === 3), 'each sits in SOMEONE IS BLOCKED (rank 3)');
ok(got.items.every((i) => i.do.some((d) => d.kind === 'shell' && d.cmd.includes(`push -u origin ${i.ref}`) && d.cmd.includes(work))),
  'each carries a self-contained push command with its repository inside it',
  got.items.map((i) => (i.do.find((d) => d.kind === 'shell') || {}).cmd).join(' | '));
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
ok(got.items.length === 2,
  'while this source names two branches of committed work nobody has pushed');

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
