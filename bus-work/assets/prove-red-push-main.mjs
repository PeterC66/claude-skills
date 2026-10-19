#!/usr/bin/env node
/* Prove `push_main.mjs` can go red — and that it stays green in the places a
 * push job must not break. Built for the 6 October simplification review's B1/B2
 * (the scheduled loop cut to three ticks a day), which would have left a
 * deferred push waiting for a tick instead of an interval.
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets):
 *
 *   node prove-red-push-main.mjs
 *
 * No placeholders. It drives the REAL git against throwaway repositories under
 * the OS temp directory — a bare origin, a working clone, and a second clone
 * that pushes around the first — with a scripted preflight and a scripted
 * stamper. It never looks at the real buses-data checkout, the real origin or
 * the real `loop/LOCK.d`.
 *
 * THE CASES THAT MATTER MOST ARE THE ONES WHERE NOTHING MAY HAPPEN. A push job
 * that pushes on a DEFERRED preflight spends the month's Actions budget, and one
 * that rebases over a person's uncommitted edit loses work, and neither would be
 * caught by a case that only checks the happy push. So each refusal below asserts
 * that origin did not move AND that the local commits are still there.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pushMain, engineFastForward, STUCK_RUNS_FOR_HOLD } from './push_main.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pushmain-'));
let bad = 0;
let n = 0;

function ok(pass, label, detail) {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${!pass && detail ? `\n       ${detail}` : ''}`);
  if (!pass) bad++;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const FIXED = new Date(2026, 9, 6, 15, 30, 0);

/* A world: origin (bare), work (the checkout under test, on main), other (a second clone). */
function world() {
  const dir = path.join(root, `w${++n}`);
  const origin = path.join(dir, 'origin.git');
  const work = path.join(dir, 'work');
  const other = path.join(dir, 'other');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
  for (const c of [work, other]) {
    execFileSync('git', ['init', '-b', 'main', c], { stdio: 'ignore' });
    git(c, 'config', 'user.name', 'Proof'); git(c, 'config', 'user.email', 'proof@example.invalid');
    git(c, 'config', 'commit.gpgsign', 'false'); git(c, 'config', 'core.autocrlf', 'false');
    git(c, 'remote', 'add', 'origin', origin);
  }
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(work, 'doc.md'), 'stamp: 1\n');
  git(work, 'add', '.'); git(work, 'commit', '-m', 'seed'); git(work, 'push', '-u', 'origin', 'main');
  git(other, 'fetch', 'origin'); git(other, 'checkout', '-B', 'main', 'origin/main');
  return { dir, origin, work, other };
}

function commit(c, file, text, msg) {
  fs.writeFileSync(path.join(c, file), text);
  git(c, 'add', file); git(c, 'commit', '-m', msg);
}

const remoteHead = (w) => git(w.origin, 'rev-parse', 'main');
const lockPath = (w) => path.join(w.work, 'loop', 'LOCK.d');

function run(w, { pf = 0, stamp = null, apply = true, onPreflight = null, readRemote = undefined } = {}) {
  const calls = { preflight: 0, docstamp: 0, logs: [] };
  const r = pushMain({
    repo: w.work, apply, now: () => FIXED, ...(readRemote ? { readRemote } : {}), log: (s) => calls.logs.push(s),
    preflight: (repo) => { calls.preflight++; if (onPreflight) onPreflight(); return pf; },
    docstamp: (repo) => { calls.docstamp++; if (stamp) fs.writeFileSync(path.join(repo, stamp.file), stamp.text); return 0; },
  });
  return { r, calls };
}

function writeLock(w, firstLine, expiresIso) {
  fs.mkdirSync(lockPath(w), { recursive: true });
  fs.writeFileSync(path.join(lockPath(w), 'holder'), `${firstLine}\nexpires: ${expiresIso}\n`);
}
const minAgo = (m) => new Date(FIXED.getTime() - m * 60000).toISOString();

/* 1. Nothing ahead: no lock, no fetch, no preflight. */
{
  const w = world();
  const { r, calls } = run(w);
  ok(r.exit === 0 && r.outcome === 'nothing-to-push' && calls.preflight === 0 && !fs.existsSync(lockPath(w)),
    '1 nothing ahead is exit 0, asks nothing and takes no lock', JSON.stringify(r));
}

/* 2. The happy push, read back. */
{
  const w = world();
  commit(w.work, 'a.txt', 'one\ntwo\nthree\nfour\n', 'ahead 1');
  const { r, calls } = run(w);
  ok(r.exit === 0 && r.outcome === 'pushed' && remoteHead(w) === git(w.work, 'rev-parse', 'main'),
    '2 a clean preflight pushes, and origin reads back equal to local main', JSON.stringify(r));
  ok(!fs.existsSync(lockPath(w)), '2b the lock is released after a push');
  ok(calls.preflight === 1, '2c the preflight ran exactly once');
}

/* 3. DEFERRED must not push, and must leave the commit. */
{
  const w = world(); const before = remoteHead(w);
  commit(w.work, 'a.txt', 'x\n', 'ahead 1');
  const { r } = run(w, { pf: 3 });
  ok(r.exit === 3 && r.outcome === 'deferred' && remoteHead(w) === before && git(w.work, 'rev-list', '--count', 'origin/main..main') === '1',
    '3 preflight exit 3 pushes nothing, exits 3 and keeps the commit', JSON.stringify(r));
  ok(!fs.existsSync(lockPath(w)), '3b the lock is released after a deferral');
}

/* 4-5. A red or an unanswered preflight must not push either. */
for (const [pf, exit, outcome] of [[1, 1, 'preflight-red'], [2, 2, 'preflight-unanswered'], [null, 2, 'preflight-unanswered']]) {
  const w = world(); const before = remoteHead(w);
  commit(w.work, 'a.txt', 'x\n', 'ahead 1');
  const { r } = run(w, { pf });
  ok(r.exit === exit && r.outcome === outcome && remoteHead(w) === before,
    `4 preflight ${pf === null ? 'with no answer (timeout)' : `exit ${pf}`} pushes nothing and exits ${exit}`, JSON.stringify(r));
}

/* 6. Behind and ahead, no conflict: rebased, stamp commit by pathspec, pushed. */
{
  const w = world();
  commit(w.other, 'b.txt', 'theirs\n', 'theirs'); git(w.other, 'push', 'origin', 'main');
  commit(w.work, 'a.txt', 'one\ntwo\nthree\nours\n', 'ours');
  const { r, calls } = run(w, { stamp: { file: 'doc.md', text: 'stamp: 2\n' } });
  const subjects = git(w.origin, 'log', '--format=%s', 'main').split('\n');
  ok(r.exit === 0 && r.outcome === 'pushed' && subjects.includes('theirs') && subjects.includes('ours'),
    '6 a diverged but unconflicting main is rebased and pushed with both sides', JSON.stringify({ r, subjects }));
  ok(calls.docstamp === 1 && /^Stamps: re-stamp after the rebase onto /.test(subjects[0]),
    '6b the stamper ran after the rebase and what it wrote is its own commit', subjects[0]);
  ok(git(w.origin, 'show', 'main:doc.md') === 'stamp: 2', '6c the stamp commit holds the stamper\'s content');
}

/* 7. [expected-red] rides on the stamp commit. */
{
  const w = world();
  commit(w.other, 'b.txt', 'theirs\n', 'theirs'); git(w.other, 'push', 'origin', 'main');
  commit(w.work, 'a.txt', 'one\ntwo\nthree\nours\n', '[expected-red] ours');
  const { r } = run(w, { stamp: { file: 'doc.md', text: 'stamp: 2\n' } });
  ok(r.exit === 0 && git(w.origin, 'log', '-1', '--format=%s', 'main').startsWith('[expected-red] Stamps: '),
    '7 a head marked [expected-red] makes the stamp commit [expected-red] too', git(w.origin, 'log', '-1', '--format=%s', 'main'));
}

/* 8. A conflict: abort, nothing lost, hold written, nothing pushed. */
{
  const w = world();
  commit(w.other, 'a.txt', 'one\nTHEIRS\nthree\n', 'theirs'); git(w.other, 'push', 'origin', 'main');
  const before = remoteHead(w);
  commit(w.work, 'a.txt', 'one\nOURS\nthree\n', 'ours');
  const mine = git(w.work, 'rev-parse', 'main');
  const { r, calls } = run(w);
  const hold = path.join(w.work, 'loop', 'your-move', 'push-job-rebase-conflict.md');
  ok(r.exit === 1 && r.outcome === 'rebase-conflict' && remoteHead(w) === before && calls.preflight === 0,
    '8 a rebase conflict exits 1, pushes nothing and never reaches the preflight', JSON.stringify(r));
  ok(git(w.work, 'rev-parse', 'main') === mine && git(w.work, 'status', '--porcelain', '--untracked-files=no') === ''
     && !fs.existsSync(path.join(w.work, '.git', 'rebase-merge')),
    '8b the rebase was aborted: local main is where it was, the tree is clean, no rebase is left');
  const text = fs.existsSync(hold) ? fs.readFileSync(hold, 'utf8') : '';
  ok(/^## What is needed from you$/m.test(text) && /\*\*Raised by:\*\* sched-push-1530, 2026-10-06/.test(text) && text.includes('a.txt'),
    '8c the hold has the heading the worklist reads, a Raised-by date and names the file');
}

/* 9. Behind with tracked changes uncommitted: do not rebase over a person's edit. */
{
  const w = world();
  commit(w.other, 'b.txt', 'theirs\n', 'theirs'); git(w.other, 'push', 'origin', 'main');
  commit(w.work, 'a.txt', 'one\ntwo\nthree\nours\n', 'ours');
  fs.writeFileSync(path.join(w.work, 'doc.md'), 'a person is editing this\n');
  const before = remoteHead(w); const mine = git(w.work, 'rev-parse', 'main');
  const { r, calls } = run(w);
  ok(r.exit === 3 && r.outcome === 'dirty-and-behind' && remoteHead(w) === before && git(w.work, 'rev-parse', 'main') === mine
     && fs.readFileSync(path.join(w.work, 'doc.md'), 'utf8') === 'a person is editing this\n' && calls.preflight === 0,
    '9 tracked edits in the way of a rebase: exit 3, the edit untouched, nothing pushed', JSON.stringify(r));
}

/* 9b. Dirty but NOT behind: nothing to rebase, so the push still goes. */
{
  const w = world();
  commit(w.work, 'a.txt', 'one\ntwo\nthree\nfour\n', 'ahead');
  fs.writeFileSync(path.join(w.work, 'doc.md'), 'a person is editing this\n');
  const { r } = run(w);
  ok(r.exit === 0 && r.outcome === 'pushed', '9b an uncommitted edit does not stop a push that needs no rebase', JSON.stringify(r));
}

/* 10. The lock. */
{
  // 10a live tick lock: stand down, touch nothing.
  const w = world(); const before = remoteHead(w);
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  writeLock(w, `sched-1500 ${minAgo(30)} a tick`, new Date(FIXED.getTime() + 60 * 60000).toISOString());
  const { r, calls } = run(w);
  ok(r.exit === 3 && r.outcome === 'lock-held' && calls.preflight === 0 && remoteHead(w) === before
     && fs.readFileSync(path.join(lockPath(w), 'holder'), 'utf8').startsWith('sched-1500'),
    '10a a live tick\'s lock: exit 3, no preflight, the lock is not touched', JSON.stringify(r));
}
{
  // 10b expired tick lock: stolen, pushed, released.
  const w = world();
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  writeLock(w, `sched-1100 ${minAgo(240)} a tick`, minAgo(60));
  const { r } = run(w);
  ok(r.exit === 0 && r.outcome === 'pushed' && !fs.existsSync(lockPath(w)),
    '10b a tick\'s lock past its lease is stolen, the push goes, the lock is gone', JSON.stringify(r));
}
{
  // 10c expired PERSON lock: not mine to steal.
  const w = world(); const before = remoteHead(w);
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  writeLock(w, `buses-29 ${minAgo(300)} a person`, minAgo(120));
  const { r } = run(w);
  ok(r.exit === 3 && r.outcome === 'lock-held' && remoteHead(w) === before && fs.existsSync(lockPath(w)),
    '10c a person\'s lock past its lease is NOT stolen: exit 3, the lock stays', JSON.stringify(r));
}
{
  // 10d the lock was stolen from us mid-run: do not remove somebody else's.
  const w = world();
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  const { r } = run(w, { onPreflight: () => fs.writeFileSync(path.join(lockPath(w), 'holder'), `sched-1600 ${FIXED.toISOString()} a thief\nexpires: ${new Date(FIXED.getTime() + 3600000).toISOString()}\n`) });
  ok(r.exit === 0 && fs.existsSync(lockPath(w)) && fs.readFileSync(path.join(lockPath(w), 'holder'), 'utf8').startsWith('sched-1600'),
    '10d a lock that no longer names this run is left alone on the way out', JSON.stringify(r));
}
{
  // 10e while it runs, the lock exists and names this run.
  const w = world();
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  let seen = '';
  run(w, { onPreflight: () => { seen = fs.readFileSync(path.join(lockPath(w), 'holder'), 'utf8'); } });
  ok(/^sched-push-1530 /.test(seen) && /^expires: /m.test(seen), '10e during the preflight the lock is held under a sched- name with an expiry', seen);
}

/* 11. Wrong branch and a rebase already in progress. */
{
  const w = world(); const before = remoteHead(w);
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  git(w.work, 'checkout', '-b', 'work/elsewhere');
  const { r, calls } = run(w);
  ok(r.exit === 2 && r.outcome === 'wrong-branch' && calls.preflight === 0 && remoteHead(w) === before,
    '11 a checkout that is not on main: exit 2, nothing asked, nothing pushed', JSON.stringify(r));
}
{
  const w = world();
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  fs.mkdirSync(path.join(w.work, '.git', 'rebase-merge'));
  const { r, calls } = run(w);
  ok(r.exit === 2 && r.outcome === 'mid-operation' && calls.preflight === 0, '11b somebody\'s rebase in progress: exit 2, hands off', JSON.stringify(r));
}

/* 12. The dry run changes nothing. */
{
  const w = world(); const before = remoteHead(w);
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  const { r, calls } = run(w, { apply: false });
  ok(r.exit === 0 && r.outcome === 'dry-run' && calls.preflight === 0 && calls.docstamp === 0 && remoteHead(w) === before && !fs.existsSync(lockPath(w)),
    '12 without --apply: reports, takes no lock, runs no preflight, pushes nothing', JSON.stringify(r));
}

/* 13. A push that loses a race is a refusal, not a silent loss. */
{
  const w = world();
  commit(w.work, 'a.txt', 'one\ntwo\nthree\nfour\n', 'ahead');
  const { r } = run(w, { onPreflight: () => { commit(w.other, 'b.txt', 'raced\n', 'raced'); git(w.other, 'push', 'origin', 'main'); } });
  ok(r.exit === 1 && r.outcome === 'push-refused' && git(w.work, 'rev-list', '--count', 'origin/main..main') === '1',
    '13 origin moved between the preflight and the push: exit 1, the commit is still local', JSON.stringify(r));
}

/* 13a. LOCAL main moved while the preflight ran — another session committed to the
 * shared checkout (buses-data, 2026-10-19, 3c4b5a87 carried by a push whose
 * preflight never saw it). Neither commit may go: the green was about the first. */
{
  const w = world(); const before = remoteHead(w);
  commit(w.work, 'a.txt', 'one\ntwo\nthree\nfour\n', 'measured');
  const { r } = run(w, { onPreflight: () => commit(w.work, 'c.txt', 'unmeasured\n', 'landed mid-preflight') });
  ok(r.exit === 3 && r.outcome === 'head-moved' && remoteHead(w) === before && git(w.work, 'rev-list', '--count', 'origin/main..main') === '2',
    '13a local main moved during the preflight: exit 3, origin unmoved, both commits still local', JSON.stringify(r));
  const { r: again } = run(w);
  ok(again.outcome === 'pushed' && remoteHead(w) === git(w.work, 'rev-parse', 'main'),
    '13a the next run measures the new tip and carries both', JSON.stringify(again));
}

/* 13b. A push that says ok while origin disagrees is not a success. */
{
  const w = world();
  commit(w.work, 'a.txt', 'one\ntwo\nthree\nfour\n', 'ahead');
  const { r } = run(w, { readRemote: () => '0'.repeat(40) });
  ok(r.exit === 1 && r.outcome === 'not-read-back', '13b a push whose read-back disagrees is exit 1, not a pass', JSON.stringify(r));
  const w2 = world();
  commit(w2.work, 'a.txt', 'x\n', 'ahead');
  const { r: r2 } = run(w2, { readRemote: () => '' });
  ok(r2.exit === 1 && r2.outcome === 'not-read-back', '13c an unreadable origin after a push is exit 1, not a pass', JSON.stringify(r2));
}

/* 14. --urgent is never passed. The real preflight wrapper builds its argv from
 * a fixed list, so this reads the source rather than a run. */
{
  const src = fs.readFileSync(new URL('./push_main.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n');
  ok(!/--urgent/.test(code), '14 no line of code passes --urgent to the preflight');
  ok(!/push['"],\s*['"]--force|--force-with-lease|push', '-f'/.test(code), '14b nothing force-pushes');
}

/* 15. The record (buses-data OA-634): every --apply run is logged with its exit,
 * a red preflight's own report goes with it, and two reds in a row raise ONE hold
 * naming the red arm and the oldest held commit. */
const RED_REPORT = 'preflight\n  [ ok ] stamps — the document stamps (0.4s)\n  [FAIL] links — the relative-link checker (1.2s)\nWOULD GO RED — 1 of 2:\n';
const logOf = (w) => { const f = path.join(w.work, 'loop', 'push-main.log'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
const redHold = (w) => path.join(w.work, 'loop', 'your-move', 'push-job-preflight-red.md');
{
  const w = world();
  commit(w.work, 'a.txt', 'x\n', 'the oldest held');
  commit(w.work, 'b.txt', 'y\n', 'the newer held');
  const red = { status: 1, report: RED_REPORT };
  run(w, { pf: red });
  ok(!fs.existsSync(redHold(w)), '15 one red run raises no hold');
  const { r } = run(w, { pf: red });
  const text = fs.existsSync(redHold(w)) ? fs.readFileSync(redHold(w), 'utf8') : '';
  ok(r.exit === 1 && r.outcome === 'preflight-red' && text !== '', '15b the second red in a row writes the hold', JSON.stringify(r));
  ok(/^## What is needed from you$/m.test(text) && /\*\*Raised by:\*\* sched-push-1530, 2026-10-06/.test(text),
    '15c the hold has the heading the worklist reads and a Raised-by date', text.slice(0, 300));
  ok(text.includes('links — the relative-link checker') && text.includes('the oldest held') && !text.includes('the newer held') && text.includes('2 commits wait'),
    '15d the hold names the red arm and the oldest held commit', text);
  const log = logOf(w);
  ok((log.match(/^=== \S+ exit 1 preflight-red$/gm) || []).length === 2 && (log.match(/\|\s+\[FAIL\] links/g) || []).length === 2,
    '15e both runs are in the log with their exit and the preflight\'s own report', log);
  fs.writeFileSync(redHold(w), 'answered in part\n');
  run(w, { pf: red });
  ok(fs.readFileSync(redHold(w), 'utf8') === 'answered in part\n' && fs.readdirSync(path.join(w.work, 'loop', 'your-move')).length === 1,
    '15f a third red leaves the standing hold alone: exactly one hold');
}
{
  // 15g a deferral between two reds ends the streak: no hold.
  const w = world();
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  const red = { status: 1, report: RED_REPORT };
  run(w, { pf: red }); run(w, { pf: 3 }); run(w, { pf: red });
  ok(!fs.existsSync(redHold(w)), '15g red, deferred, red is no streak of two: no hold');
  // 15h a lock held between two reds asked nothing, so the streak survives it.
  const w2 = world();
  commit(w2.work, 'a.txt', 'x\n', 'ahead');
  run(w2, { pf: red });
  writeLock(w2, `sched-1500 ${minAgo(5)} a tick`, new Date(FIXED.getTime() + 60 * 60000).toISOString());
  run(w2, { pf: red });
  fs.rmSync(lockPath(w2), { recursive: true, force: true });
  run(w2, { pf: red });
  ok(fs.existsSync(redHold(w2)) && /exit 3 lock-held/.test(logOf(w2)), '15h a lock-held run between two reds is logged and does not break the streak');
}
{
  // 15i a push logs no report; a dry run writes no log at all.
  const w = world();
  commit(w.work, 'a.txt', 'x\n', 'ahead');
  run(w, { apply: false });
  ok(logOf(w) === '', '15i a dry run writes nothing to the log');
  run(w, { pf: { status: 0, report: RED_REPORT } });
  const log = logOf(w);
  ok(/^=== \S+ exit 0 pushed$/m.test(log) && !log.includes('[FAIL]'), '15j a pushed run is logged without the preflight report', log);
}

/* 16. The engine checkout (buses-data, 2026-10-19). `work` plays C:\Buses\claude-skills
 * and `other` merges a pull request into origin; a separate repository plays
 * buses-data, which owns the lock, the log and loop/your-move/. Case 16a is the
 * POINT: a checkout behind origin is moved. Every other case is a place it must
 * not move, and asserts that HEAD did not. */
function engineWorld() {
  const w = world();
  w.buses = path.join(w.dir, 'buses');
  execFileSync('git', ['init', '-b', 'main', w.buses], { stdio: 'ignore' });
  commit(w.other, 'engine.js', 'v2\n', 'a merged pull request'); git(w.other, 'push', 'origin', 'main');
  return w;
}
const engineRun = (w, apply = true) => engineFastForward({ engine: w.work, repo: w.buses, apply, now: () => FIXED, log: () => {} });
const engHead = (w) => git(w.work, 'rev-parse', 'HEAD');
const engHold = (w) => path.join(w.buses, 'loop', 'your-move', 'engine-checkout-behind-origin.md');
const busesLock = (w) => path.join(w.buses, 'loop', 'LOCK.d');
{
  const w = engineWorld();
  const r = engineRun(w);
  ok(r.outcome === 'moved' && engHead(w) === git(w.origin, 'rev-parse', 'main') && fs.existsSync(path.join(w.work, 'engine.js')),
    '16a a clean checkout on main, behind origin, is fast-forwarded and reads back equal to origin', JSON.stringify(r));
  ok(!fs.existsSync(busesLock(w)), '16b the loop lock is released after the fast-forward');
  const log = fs.readFileSync(path.join(w.buses, 'loop', 'push-main.log'), 'utf8');
  ok(/^=== \S+ engine moved$/m.test(log), '16c the run is in push-main.log', log);
  const r2 = engineRun(w);
  ok(r2.outcome === 'current', '16d a second run finds it current and does nothing', JSON.stringify(r2));
}
{
  const w = engineWorld(); const before = engHead(w);
  const r = engineRun(w, false);
  ok(r.outcome === 'current' && engHead(w) === before, '16e the dry run neither fetches nor moves (it has not seen origin move)', JSON.stringify(r));
}
{
  const w = engineWorld(); const before = engHead(w);
  fs.writeFileSync(path.join(w.work, 'a.txt'), 'a person is editing this\n');
  const r = engineRun(w);
  ok(r.outcome === 'dirty' && engHead(w) === before && fs.readFileSync(path.join(w.work, 'a.txt'), 'utf8') === 'a person is editing this\n',
    '16f tracked edits: not moved, the edit untouched', JSON.stringify(r));
}
{
  const w = engineWorld(); const before = engHead(w);
  fs.writeFileSync(path.join(w.work, 'untracked.txt'), 'scratch\n');
  const r = engineRun(w);
  ok(r.outcome === 'moved' && fs.existsSync(path.join(w.work, 'untracked.txt')), '16g an untracked file origin does not touch is no bar, and survives', JSON.stringify(r));
  void before;
}
{
  const w = engineWorld(); const before = engHead(w);
  git(w.work, 'checkout', '-b', 'work/elsewhere');
  const r = engineRun(w);
  ok(r.outcome === 'wrong-branch' && engHead(w) === before && git(w.work, 'branch', '--show-current') === 'work/elsewhere',
    '16h on another branch: not moved, branch not switched', JSON.stringify(r));
}
{
  const w = engineWorld(); const before = engHead(w);
  fs.mkdirSync(path.join(w.work, '.git', 'rebase-merge'));
  const r = engineRun(w);
  ok(r.outcome === 'mid-operation' && engHead(w) === before, '16i a rebase in progress: hands off', JSON.stringify(r));
}
{
  const w = engineWorld(); const before = engHead(w);
  fs.mkdirSync(path.join(w.buses, 'loop'), { recursive: true });
  fs.mkdirSync(busesLock(w));
  fs.writeFileSync(path.join(busesLock(w), 'holder'), `sched-1500 ${minAgo(5)} a tick\nexpires: ${new Date(FIXED.getTime() + 3600000).toISOString()}\n`);
  const r = engineRun(w);
  ok(r.outcome === 'lock-held' && engHead(w) === before && fs.readFileSync(path.join(busesLock(w), 'holder'), 'utf8').startsWith('sched-1500'),
    '16j a tick holds the loop lock: the engine under it is not moved, the lock not touched', JSON.stringify(r));
}
{
  const w = engineWorld(); const before = engHead(w);
  commit(w.work, 'mine.txt', 'local only\n', 'a local commit');
  const mine = engHead(w);
  const r = engineRun(w);
  const text = fs.existsSync(engHold(w)) ? fs.readFileSync(engHold(w), 'utf8') : '';
  ok(r.outcome === 'diverged' && engHead(w) === mine && mine !== before, '16k a diverged main is never merged or rebased', JSON.stringify(r));
  ok(/^## What is needed from you$/m.test(text) && /\*\*Raised by:\*\* sched-push-1530, 2026-10-06/.test(text) && text.includes('a merged pull request') && text.includes('merge --ff-only origin/main'),
    '16l a diverged main raises the hold at once, naming the waiting commit and the command', text.slice(0, 400));
}
{
  // 16m a stuck checkout raises ONE hold after STUCK_RUNS_FOR_HOLD runs, a lock-held run between does not break the streak, and moving ends it.
  const w = engineWorld();
  git(w.work, 'checkout', '-b', 'work/elsewhere');
  for (let i = 1; i < STUCK_RUNS_FOR_HOLD; i++) engineRun(w);
  ok(!fs.existsSync(engHold(w)), `16m ${STUCK_RUNS_FOR_HOLD - 1} stuck runs raise no hold`);
  git(w.work, 'checkout', 'main');
  fs.mkdirSync(busesLock(w)); fs.writeFileSync(path.join(busesLock(w), 'holder'), `sched-1500 ${minAgo(5)} a tick\nexpires: ${new Date(FIXED.getTime() + 3600000).toISOString()}\n`);
  const held = engineRun(w); // clean on main but the lock is held: asked nothing, counts nothing
  ok(held.outcome === 'lock-held' && !fs.existsSync(engHold(w)), '16m2 a lock-held run neither raises the hold nor ends the streak', JSON.stringify(held));
  fs.writeFileSync(path.join(w.work, 'a.txt'), 'x\n');
  engineRun(w); // dirty, so stuck: run number STUCK_RUNS_FOR_HOLD
  ok(fs.existsSync(engHold(w)) && new RegExp(`failed on ${STUCK_RUNS_FOR_HOLD} runs in a row`).test(fs.readFileSync(engHold(w), 'utf8')), `16n the ${STUCK_RUNS_FOR_HOLD}th stuck run writes the hold`);
  git(w.work, 'checkout', '--', 'a.txt');
  fs.rmSync(busesLock(w), { recursive: true, force: true });
  const r = engineRun(w);
  const state = JSON.parse(fs.readFileSync(path.join(w.buses, 'loop', 'engine-ff.state.json'), 'utf8'));
  ok(r.outcome === 'moved' && state.stuckRuns === 0, '16o once clean it moves and the streak ends', JSON.stringify({ r, state }));
}
{
  // 16p a fast-forward git refuses (an untracked file in the way) is not moved and is a refusal, not a pass.
  const w = engineWorld(); const before = engHead(w);
  fs.writeFileSync(path.join(w.work, 'engine.js'), 'an untracked copy in the way\n');
  const r = engineRun(w);
  ok(r.outcome === 'ff-refused' && engHead(w) === before && fs.readFileSync(path.join(w.work, 'engine.js'), 'utf8') === 'an untracked copy in the way\n',
    '16p an untracked file the merge would overwrite: refused, nothing moved or lost', JSON.stringify(r));
}
{
  // 16q nothing but --ff-only: no line of the engine step rebases, resets, checks out or merges otherwise.
  const src = fs.readFileSync(new URL('./push_main.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function engineFastForwardOnce'), src.indexOf('function writeEngineHold'));
  const calls = [...body.matchAll(/git\(engine, \[([^\]]*)\]/g)].map((m) => m[1]);
  const writes = calls.filter((c) => /'(merge|rebase|reset|checkout|switch|pull|stash|clean)'/.test(c));
  ok(writes.length === 1 && writes[0] === "'merge', '--ff-only', 'origin/main'", '16q the engine step\'s one write is merge --ff-only origin/main', JSON.stringify(writes));
}

fs.rmSync(root, { recursive: true, force: true });
console.log(bad ? `\n${bad} case(s) FAILED` : '\nall cases passed');
process.exitCode = bad ? 1 : 0;
