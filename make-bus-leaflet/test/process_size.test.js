'use strict';
// process_size.js (buses-data OA-488 item 2): the board's process-size section.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ps = require('./_engine.js').load('process_size.js');

test('countWords splits on any whitespace', () => {
  assert.strictEqual(ps.countWords('a b\n\nc\td  '), 4);
  assert.strictEqual(ps.countWords(''), 0);
});

test('parseWorktrees counts linked worktrees, not the main checkout, and prunable apart', () => {
  const porcelain = [
    'worktree C:/repo', 'HEAD abc', 'branch refs/heads/main', '',
    'worktree C:/repo/.claude/worktrees/a', 'HEAD def', 'branch refs/heads/work/a', '',
    'worktree C:/gone', 'HEAD 123', 'detached', 'prunable gitdir file points to non-existent location', '',
  ].join('\n');
  assert.deepStrictEqual(ps.parseWorktrees(porcelain), { linked: 2, prunable: 1 });
  assert.deepStrictEqual(ps.parseWorktrees('worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n'), { linked: 0, prunable: 0 });
});

test('parsePushes counts only "update by push" inside each window', () => {
  const now = Date.UTC(2026, 8, 28, 12) ;
  const s = (hoursAgo, what) => `refs/remotes/origin/main@{${Math.floor((now - hoursAgo * 3600000) / 1000)}}|${what}`;
  const reflog = [
    s(1, 'update by push'), s(5, 'update by push'), s(6, 'fetch: fast-forward'),
    s(30, 'update by push'), s(24 * 8, 'update by push'),
  ].join('\n');
  const p = ps.parsePushes(reflog, now);
  assert.strictEqual(p.last24h, 2);
  assert.strictEqual(p.last7d, 3);
  assert.strictEqual(p.perDay7d, 0.4);
});

test('memoryWords reads <projects>/<slug>/memory/**/*.md and is null where there is none', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'procsize-'));
  try {
    assert.strictEqual(ps.memoryWords(path.join(root, 'nope')), null);
    fs.mkdirSync(path.join(root, 'a', 'memory', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a', 'memory', 'x.md'), 'one two three');
    fs.writeFileSync(path.join(root, 'a', 'memory', 'sub', 'y.md'), 'four');
    fs.writeFileSync(path.join(root, 'a', 'memory', 'z.txt'), 'not counted at all');
    fs.mkdirSync(path.join(root, 'b'));   // a project with no memory store
    const mw = ps.memoryWords(root);
    assert.strictEqual(mw.total, 4);
    assert.deepStrictEqual(mw.stores, [{ store: 'a', files: 2, words: 4 }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('printSection says "not on this machine" for every null measure and prints no cap until one is set', () => {
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(String(s));
  try {
    ps.printSection({ memoryWords: null, worktrees: [{ name: 'x', linked: null, prunable: null }], busesPushes: null, caps: {} });
    ps.printSection({ memoryWords: { total: 10, stores: [{ store: 's', files: 1, words: 10 }] }, worktrees: [{ name: 'x', linked: 3, prunable: 0 }],
      busesPushes: { last24h: 9, last7d: 20, perDay7d: 2.9 }, caps: { pushesPerDay: 5 } });
  } finally { console.log = orig; }
  const text = lines.join('\n');
  assert.strictEqual((text.match(/not on this machine/g) || []).length, 3);
  assert.match(text, /memory-store words: 10 {2}\(no cap set\)/);
  assert.match(text, /linked worktrees: 3 {2}\(no cap set\)/);
  assert.match(text, /9 in the last 24h {2}OVER the cap of 5/);
});
