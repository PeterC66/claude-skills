/*
 * engine_commit_reclaim.test.js — an engine-commit worktree a KILLED run left
 * behind is reclaimed by the next engineDirForCommit, and nothing else is.
 *
 * `engine_commit.js` removes its trees in a process 'exit' handler, which a
 * killed run never reaches, and `git worktree prune` clears a registration only
 * when its folder has gone — which a killed run leaves. On 2026-10-01 five such
 * trees from 27–30 Sep were still listed on the laptop's claude-skills. Mutated
 * by tools/prove-red.js, which removes the reclaim call and expects this to go red.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { engineDirForCommit, reclaimStaleCommitTrees, STALE_COMMIT_TREE_HOURS } = require('./_engine.js').load('engine_commit.js');
const { scratchDir, scratchRoot } = require('../assets/scratch');

const git = (dir, ...a) => {
  const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const registered = (skills, root) => git(skills, 'worktree', 'list', '--porcelain').split('\n')
  .some((l) => l.startsWith('worktree ') && path.resolve(l.slice(9).trim()).toLowerCase() === path.resolve(root).toLowerCase());

test('the next engineDirForCommit releases a killed run\'s tree and leaves a young one', () => {
  const skills = path.join(scratchDir('engine-commit-reclaim-test'), 'skills');
  fs.mkdirSync(path.join(skills, 'make-bus-leaflet'), { recursive: true });
  git(skills, 'init', '-q', '-b', 'main');
  git(skills, 'config', 'user.email', 'reclaim@test');
  git(skills, 'config', 'user.name', 'reclaim');
  git(skills, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(skills, 'make-bus-leaflet', 'a.js'), '1\n');
  fs.writeFileSync(path.join(skills, '.gitignore'), 'node_modules/\n');
  git(skills, 'add', '.');
  git(skills, 'commit', '-q', '-m', 'engine', '--no-verify');
  const sha = git(skills, 'rev-parse', 'HEAD');
  const sentinel = path.join(skills, 'make-bus-leaflet', 'node_modules', 'sharp', 'package.json');
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, '{}\n');

  // Two trees of exactly the shape engineDirForCommit makes, as other processes left them.
  const killed = path.join(scratchDir('engine-commit-'), 'wt');
  const young = path.join(scratchDir('engine-commit-'), 'wt');
  git(skills, 'worktree', 'add', '-q', '--detach', killed, sha);
  git(skills, 'worktree', 'add', '-q', '--detach', young, sha);
  // The killed one borrowed the checkout's node_modules: the reclaim must unlink, not follow.
  fs.symlinkSync(path.join(skills, 'make-bus-leaflet', 'node_modules'), path.join(killed, 'make-bus-leaflet', 'node_modules'), 'junction');
  const old = new Date(Date.now() - (STALE_COMMIT_TREE_HOURS + 1) * 3600e3);
  fs.utimesSync(path.dirname(killed), old, old);

  try {
    assert.ok(registered(skills, killed), 'premise: the killed tree is registered');
    engineDirForCommit({ skillsRoot: skills, commit: sha, expect: 'none', scratchDir });
    assert.ok(!registered(skills, killed), 'the killed tree\'s registration was released');
    assert.ok(!fs.existsSync(path.dirname(killed)), 'and its folder');
    assert.ok(registered(skills, young) && fs.existsSync(young), 'a young tree is left to its own run');
    assert.ok(fs.existsSync(sentinel), 'the CHECKOUT\'s node_modules survives the reclaim');
    assert.deepStrictEqual(reclaimStaleCommitTrees(skills, { base: path.join(scratchRoot(), 'elsewhere'), now: Date.now() + 1e12 }), [],
      'a tree under another base is never touched');
  } finally {
    for (const t of [killed, young]) {
      if (fs.existsSync(t)) {
        try { fs.rmdirSync(path.join(t, 'make-bus-leaflet', 'node_modules')); } catch (e) { /* not a link */ }
        spawnSync('git', ['-C', skills, 'worktree', 'remove', '--force', t]);
      }
    }
  }
});
