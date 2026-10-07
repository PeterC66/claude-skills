'use strict';
/*
 * rollout_commit.js — `rollout.js --commit` and `rollout_places.js --commit`: commit what ONE map's
 * rollout wrote, by name, and read the commit back (buses-data OA-586, A3 of the 2026-10-06
 * simplification review).
 *
 * WHY IT EXISTS. A rollout writes S4, S5 and `_latest/`, which are gitignored, and leaves the map's
 * tracked files — `manifest.json`, the `ci-reference/` mirror — modified for the caller to commit. The
 * loop prompt and the `bus-work` playbook spent a paragraph on how, and a dirty main checkout stops
 * every tick that needs the tree. `ink_review.mjs` and `stage_refresh.mjs` already commit their own
 * records through `commitRecord()`; this is the same discipline for a folder of them, written beside
 * the rollouts because they are CommonJS and that module is not.
 *
 * WHAT IT COMMITS: every path `git status` lists under the map's folder, and nothing outside it. The
 * folder is the map's because the caller holds the loop lock and has just written it; gitignored build
 * output never appears in the list, so the list IS the tracked change. Each path is named to `git add`
 * and to `git commit --`, never a directory and never `-A`, so the commit takes exactly the files that
 * were read.
 *
 * WHAT IT REFUSES TO COMMIT, and says so: a checkout that is not on `main`, and a folder holding a path
 * somebody has already STAGED, because a staged path is another session's and a pathspec commit would
 * carry it. A refusal leaves the files written and uncommitted, which is where the caller started.
 *
 * It never pushes: the push preflight paces that, and a deferred push is carried by the hourly job.
 * `git` is injected so a stub can falsify each branch (test/rollout_commit.test.js). Node core only,
 * and outside the engine hash closure.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const defaultGit = (root, argv, input) => {
  const r = spawnSync('git', ['-C', root, ...argv], { encoding: 'utf8', input });
  return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
};

/** `git status --porcelain=v1 -z` into `[{ x, y, file }]`; a rename's second path is dropped. */
function parseStatusZ(out) {
  const parts = out.split('\0').filter(Boolean);
  const rows = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    const row = { x: e[0], y: e[1], file: e.slice(3) };
    rows.push(row);
    if (row.x === 'R' || row.x === 'C') i++;
  }
  return rows;
}

/**
 * Commit everything git lists under `dir` (a map folder inside `root`), and read the commit back.
 * Returns `{ status: 'clean' | 'committed' | 'skipped' | 'failed', why?, sha?, subject?, files? }` and
 * never throws: the rollout is already written, and a git fault must not turn the caller into a retry.
 */
function commitMap({ root, dir, subject, body = '', git = defaultGit }) {
  const rel = path.relative(root, dir).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return { status: 'skipped', why: `${dir} is not inside ${root}` };
  const branch = git(root, ['branch', '--show-current']);
  if (branch.status !== 0) return { status: 'skipped', why: `${root} is not a git checkout (${branch.err.trim()})` };
  if (branch.out.trim() !== 'main') return { status: 'skipped', why: `the checkout is on ${JSON.stringify(branch.out.trim())}, not main` };
  const st = git(root, ['status', '--porcelain=v1', '-z', '-uall', '--', rel]);
  if (st.status !== 0) return { status: 'failed', why: `git status failed: ${st.err.trim()}` };
  const rows = parseStatusZ(st.out);
  if (!rows.length) return { status: 'clean' };
  const staged = rows.filter(r => r.x !== ' ' && r.x !== '?');
  if (staged.length) return { status: 'skipped', why: `${staged.length} path(s) under ${rel} are already staged (${staged[0].file}), which is somebody else's: a pathspec commit would carry them` };
  const files = rows.map(r => r.file);
  const add = git(root, ['add', '--', ...files]);
  if (add.status !== 0) return { status: 'failed', why: `git add failed: ${add.err.trim()}` };
  const msg = `${subject}\n\n${body ? body + '\n\n' : ''}Written by rollout --commit and committed by it, so the checkout is not left dirty for the loop's tick gate.\n`;
  const c = git(root, ['commit', '-q', '-F', '-', '--', ...files], msg);
  if (c.status !== 0) return { status: 'failed', why: `git commit exited ${c.status}: ${(c.err || c.out).trim().split('\n').pop()}` };
  const head = git(root, ['log', '-1', '--format=%H%x00%s']).out.trim().split('\0');
  const after = git(root, ['status', '--porcelain=v1', '-uall', '--', rel]).out.trim();
  if (head[1] !== subject || after !== '') return { status: 'failed', why: `the commit did not read back (HEAD ${JSON.stringify(head[1])}, ${rel} ${after ? 'still dirty' : 'clean'})` };
  return { status: 'committed', sha: head[0].slice(0, 8), subject, files };
}

/** Print what `commitMap` did; true when the map is safely in git or needed no commit. */
function reportCommit(r, tag = 'rollout') {
  if (r.status === 'committed') { console.log(`    ${tag}: committed ${r.sha} "${r.subject}" — ${r.files.length} file(s), not pushed`); return true; }
  if (r.status === 'clean') { console.log(`    ${tag}: nothing under the map's folder to commit`); return true; }
  console.error(`    ${tag}: the rollout is written and NOT committed — ${r.why}. The checkout stays dirty until the map's tracked files (manifest.json, ci-reference/) are committed by pathspec.`);
  return false;
}

module.exports = { commitMap, reportCommit, parseStatusZ };
