#!/usr/bin/env node
/* Prove the worktree sweep removes ONLY what is finished, and that every refusal
 * actually refuses (built 2026-09-23 with worktree_sweep.mjs).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), no placeholders:
 *
 *   node prove-red-worktree-sweep.mjs
 *
 * WHAT IS BEING FALSIFIED. A sweep that deletes things is dangerous in exactly
 * one direction, so almost every case below is a REFUSAL, each paired with a
 * control that removes: the same worktree with the one fact changed. Section 2
 * is the one this file exists for — the two public repositories squash-merge,
 * so "GitHub says MERGED" is how most worktrees qualify, and a commit made AFTER
 * that merge is on no remote. A sweep that trusted the PR state alone would
 * delete it, and nothing else would ever notice.
 *
 * Section 4 runs the real writer against throwaway repositories under the temp
 * dir (a bare origin, a clone, worktrees made with git), including a junction
 * whose TARGET must still hold its file afterwards. `now` is injected, so idle
 * is a parameter rather than a wait. No network: the test repositories are not
 * PR-per-change, so gh is never called.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  classifyWorktree, proveMerged, parseWorktreeList, worktreeSweepItems, sweepRepo, findLinks, IDLE_HOURS, CADENCE_DAYS,
} from './worktree_sweep.mjs';
import { needsOf } from './concurrency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};
const H = 3600000;
const NOW = Date.parse('2026-09-23T12:00:00Z');

console.log('1. classifyWorktree — each refusal against a control that removes');
const good = { branch: 'b', merged: { proved: true, how: 'on origin/main' }, dirty: 0, locked: false, links: [], lastMovedMs: NOW - 48 * H };
check('control: merged, clean, unlocked, no link, idle 48h → REMOVE', classifyWorktree(good, { now: NOW }).remove === true);
const refusals = [
  ['not merged', { merged: { proved: false, why: 'x' } }, false],
  ['locked', { locked: true }, true],
  ['one dirty path', { dirty: 1 }, true],
  ['git status unreadable', { dirty: null }, true],
  ['a junction inside', { links: ['node_modules'] }, true],
  ['touched 23h ago', { lastMovedMs: NOW - 23 * H }, false],
  ['undatable', { lastMovedMs: null }, false],
  ['read error', { error: 'folder missing' }, false],
];
for (const [name, patch, mbk] of refusals) {
  const v = classifyWorktree({ ...good, ...patch }, { now: NOW });
  check(`${name} → keep`, v.remove === false, JSON.stringify(v));
  check(`${name} → mergedButKept is ${mbk} (a row for Peter only when the work is already on main)`, v.mergedButKept === mbk);
}
{
  // A branch cut from main with edits and no commit is "merged" by ancestry. It
  // is live work: kept, and NOT a row saying finished work was left behind.
  const v = classifyWorktree({ ...good, dirty: 5, lastMovedMs: NOW - 1 * H }, { now: NOW });
  check('LIVE WORK: uncommitted edits touched 1h ago → keep, and NO row', !v.remove && !v.mergedButKept, JSON.stringify(v));
}
check(`idle boundary is ${IDLE_HOURS}h exactly`, classifyWorktree({ ...good, lastMovedMs: NOW - IDLE_HOURS * H }, { now: NOW }).remove === true
  && classifyWorktree({ ...good, lastMovedMs: NOW - IDLE_HOURS * H + 1 }, { now: NOW }).remove === false);

console.log('\n2. proveMerged — the squash-merge case, and a commit after the merge');
check('ancestor of origin/main → proved', proveMerged({ ancestorOfMain: true, prs: null, headWithin: () => null }).proved);
check('not ancestor, GitHub not asked → NOT proved', !proveMerged({ ancestorOfMain: false, prs: null, headWithin: () => true }).proved);
check('PR MERGED and HEAD is the PR head → proved', proveMerged({ ancestorOfMain: false, prs: [{ number: 9, state: 'MERGED', headRefOid: 'aaa' }], headWithin: (o) => o === 'aaa' }).proved);
check('LOAD-BEARING: PR MERGED but HEAD has a commit the PR did not carry → NOT proved',
  !proveMerged({ ancestorOfMain: false, prs: [{ number: 9, state: 'MERGED', headRefOid: 'aaa' }], headWithin: () => false }).proved);
check('PR MERGED but the head commit cannot be found → NOT proved', !proveMerged({ ancestorOfMain: false, prs: [{ number: 9, state: 'MERGED', headRefOid: 'aaa' }], headWithin: () => null }).proved);
check('PR OPEN → NOT proved', !proveMerged({ ancestorOfMain: false, prs: [{ number: 9, state: 'OPEN', headRefOid: 'aaa' }], headWithin: () => true }).proved);
check('PR CLOSED unmerged → NOT proved', !proveMerged({ ancestorOfMain: false, prs: [{ number: 9, state: 'CLOSED', headRefOid: 'aaa' }], headWithin: () => true }).proved);
check('a CLOSED then a MERGED PR on one branch → proved by the merged one', proveMerged({ ancestorOfMain: false, prs: [{ number: 8, state: 'CLOSED', headRefOid: 'x' }, { number: 9, state: 'MERGED', headRefOid: 'aaa' }], headWithin: (o) => o === 'aaa' }).proved);

console.log('\n3. the board half — rows only for what needs a person');
const st = (record, extra = {}) => ({ loopPresent: true, present: true, record, unreadable: null, recordFile: 'loop/worktree-sweep.json', ...extra });
check('no loop/ folder → silent', worktreeSweepItems({ state: { loopPresent: false } }).items.length === 0);
check('never swept → one due row', worktreeSweepItems({ state: st(null, { present: false }) }).items.map((i) => i.key).join() === 'worktree-sweep-due');
check('unparseable record → a record row, not silence', worktreeSweepItems({ state: st(null, { unreadable: 'bad' }) }).items[0].key === 'worktree-sweep-record');
check('record with no checkedAt → a record row', worktreeSweepItems({ state: st({ repos: [] }) }).items[0].key === 'worktree-sweep-record');
const rec = { checkedAt: new Date(NOW).toISOString(), repos: [{ key: 'engine', name: 'claude-skills', kept: [
  { path: '/w/a', branch: 'a', reason: '3 uncommitted', mergedButKept: true },
  { path: '/w/b', branch: 'b', reason: 'not merged', mergedButKept: false },
], strays: [{ path: '/w/s', files: 4, removed: false }, { path: '/w/e', files: 0, removed: true }], removed: [] }] };
const r3 = worktreeSweepItems({ state: st(rec), now: NOW });
check('merged-but-kept → a row', r3.items.some((i) => i.key === 'worktree-sweep-kept-engine-a'));
check('unmerged → NO row, a note instead', !r3.items.some((i) => i.key.includes('-b')) && r3.notes.some((n) => n.includes('still in use')));
check('stray with files → a row; removed empty stray → none', r3.items.filter((i) => i.key.startsWith('worktree-sweep-stray')).length === 1);
check(`cadence: ${CADENCE_DAYS - 1} days → no due row`, !worktreeSweepItems({ state: st(rec), now: NOW + (CADENCE_DAYS - 1) * 24 * H }).items.some((i) => i.key === 'worktree-sweep-due'));
check(`cadence: ${CADENCE_DAYS} days → a due row`, worktreeSweepItems({ state: st(rec), now: NOW + CADENCE_DAYS * 24 * H }).items.some((i) => i.key === 'worktree-sweep-due'));
check('kept rows are decisions: needsOf is empty', needsOf({ key: 'worktree-sweep-kept-engine-a', type: 'worktree-sweep' }).length === 0);
check('due row writes loop/: needsOf is buses-tree', needsOf({ key: 'worktree-sweep-due', type: 'worktree-sweep' }).join() === 'buses-tree');

console.log('\n4. the writer, against real throwaway repositories');
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-sweep-'));
try {
  const origin = path.join(T, 'origin.git');
  const main = path.join(T, 'main');
  g(T, 'init', '-q', '--bare', '-b', 'main', origin);
  g(T, 'clone', '-q', origin, main);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['core.autocrlf', 'false']]) g(main, 'config', k, v);
  fs.writeFileSync(path.join(main, 'f.txt'), '1\n');
  fs.writeFileSync(path.join(main, '.gitignore'), 'node_modules/\n');
  g(main, 'add', '.'); g(main, 'commit', '-q', '-m', 'one'); g(main, 'push', '-q', 'origin', 'HEAD:main');
  const wts = path.join(main, '.claude', 'worktrees');
  const mk = (name) => { const p = path.join(wts, name); g(main, 'worktree', 'add', '-q', p, '-b', name); return p; };
  const done = mk('done');                      // merged by ancestry, clean → removed
  const ahead = mk('ahead');                    // a commit on no remote → kept
  fs.writeFileSync(path.join(ahead, 'g.txt'), 'x\n'); g(ahead, 'add', '.'); g(ahead, 'commit', '-q', '-m', 'unpushed');
  const dirty = mk('dirty');                    // merged, untracked file → kept, needs a person
  fs.writeFileSync(path.join(dirty, 'scratch.txt'), 'x\n');
  const target = path.join(T, 'precious'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep.txt'), 'keep\n');
  const linked = mk('linked');                  // merged, clean (ignored junction) → kept, target intact
  fs.symlinkSync(target, path.join(linked, 'node_modules'), 'junction');
  fs.mkdirSync(path.join(wts, 'empty-stray', 'sub'), { recursive: true });
  fs.mkdirSync(path.join(wts, 'full-stray')); fs.writeFileSync(path.join(wts, 'full-stray', 'work.txt'), 'x\n');

  check('findLinks sees the junction', findLinks(linked).includes('node_modules'));
  const repo = { key: 't', name: 'test', dir: main, prPerChange: false };
  const later = Date.now() + 48 * H;
  const opts = { repo, now: later, idleHours: IDLE_HOURS, strayRoots: [wts], log: () => {} };

  const look = sweepRepo({ ...opts, apply: false });
  check('report mode: says it would remove "done"', look.removed.map((r) => r.branch).join() === 'done', JSON.stringify(look.removed));
  check('report mode: removes NOTHING from disk', fs.existsSync(done) && fs.existsSync(path.join(wts, 'empty-stray')));

  const early = sweepRepo({ ...opts, apply: false, now: Date.now() });
  check('control: the same tree swept NOW removes nothing (idle guard)', early.removed.length === 0);

  const res = sweepRepo({ ...opts, apply: true });
  check('apply: "done" worktree folder is gone', !fs.existsSync(done));
  check('apply: its local branch is deleted', !g(main, 'branch', '--list', 'done').trim());
  check('apply: "ahead" kept — its commit is on no remote', fs.existsSync(ahead) && res.kept.some((k) => k.branch === 'ahead' && !k.mergedButKept));
  check('apply: "dirty" kept, and flagged for a person', fs.existsSync(path.join(dirty, 'scratch.txt')) && res.kept.some((k) => k.branch === 'dirty' && k.mergedButKept));
  check('apply: "linked" kept, flagged for a person', fs.existsSync(linked) && res.kept.some((k) => k.branch === 'linked' && k.mergedButKept));
  check('apply: the junction TARGET still holds its file', fs.readFileSync(path.join(target, 'keep.txt'), 'utf8') === 'keep\n');
  check('apply: empty stray folder removed', !fs.existsSync(path.join(wts, 'empty-stray')));
  check('apply: stray folder with a file left alone, and reported', fs.existsSync(path.join(wts, 'full-stray', 'work.txt')) && res.strays.some((s) => s.files === 1 && !s.removed));
  check('apply: git no longer lists "done"', !parseWorktreeList(g(main, 'worktree', 'list', '--porcelain')).some((w) => w.branch === 'done'));
} finally {
  // Remove the junction first so the cleanup cannot follow it.
  try { for (const w of ['linked']) fs.unlinkSync(path.join(T, 'main', '.claude', 'worktrees', w, 'node_modules')); } catch { /* already gone */ }
  fs.rmSync(T, { recursive: true, force: true });
}

console.log('\n5. the source — no --force anywhere a git call is built');
const src = fs.readFileSync(path.join(HERE, 'worktree_sweep.mjs'), 'utf8');
const codeLines = src.split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
check('no code line passes --force', !codeLines.some((l) => /['"]--force['"]|['"]-f['"]/.test(l)));

console.log(bad ? `\n${bad} assertion(s) FAILED` : '\nall assertions held');
process.exit(bad ? 1 : 0);
