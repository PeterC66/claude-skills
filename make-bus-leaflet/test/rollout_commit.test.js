'use strict';
/*
 * rollout_commit.test.js — `rollout.js --commit` commits ONE map's tracked files by name and reads the
 * commit back (buses-data OA-586, A3 of the 2026-10-06 simplification review).
 *
 * REAL GIT, NOT A STUB, for the cases that decide what lands: a throwaway repository with a map folder
 * holding a tracked file that changed, a new tracked-eligible file, a deleted one and a gitignored build
 * folder, beside a second map the commit must not touch. A stub would prove the arguments; only git proves
 * which files were committed. The branch and the staged-path refusals use the same repository, so every
 * refusal is shown to leave the files written and uncommitted.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');
const { load } = require('./_engine');
const { commitMap, reportCommit, parseStatusZ } = load('rollout_commit.js');

const git = (root, ...a) => {
  const r = spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `git ${a.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};
const write = (root, rel, text) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

/* A repository on main with two maps, each holding a tracked manifest, a ci-reference file, and a
 * gitignored S4 folder. Returns { root, town, other }. */
function repo(branch = 'main') {
  const root = scratchDir('rollout-commit-');
  git(root, 'init', '-q', '-b', branch);
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, '.gitignore', 'S4-*/\nS5-*/\n_latest/\n');
  for (const name of ['Areas/Town A', 'Areas/Town B']) {
    write(root, `${name}/manifest.json`, '{"v":1}\n');
    write(root, `${name}/ci-reference/routes.json`, '{"engine":"old"}\n');
    write(root, `${name}/ci-reference/gone.json`, '{}\n');
  }
  git(root, 'add', '.gitignore', 'Areas');
  git(root, 'commit', '-q', '-m', 'seed');
  return { root, town: path.join(root, 'Areas', 'Town A'), other: path.join(root, 'Areas', 'Town B') };
}

/* What a rollout leaves: manifest and mirror rewritten, a file added, one removed, build output ignored. */
function roll(town) {
  fs.writeFileSync(path.join(town, 'manifest.json'), '{"v":2}\n');
  fs.writeFileSync(path.join(town, 'ci-reference', 'routes.json'), '{"engine":"new"}\n');
  fs.writeFileSync(path.join(town, 'ci-reference', 'added.json'), '{"added":true}\n');   // unlike gone.json, so git does not read a rename
  fs.rmSync(path.join(town, 'ci-reference', 'gone.json'));
  fs.mkdirSync(path.join(town, 'S4-generate', 'v1.1'), { recursive: true });
  fs.writeFileSync(path.join(town, 'S4-generate', 'v1.1', 'internal.svg'), '<svg/>');
}

test('commits exactly the tracked-eligible files under the map, deletion and addition included', () => {
  const { root, town } = repo();
  roll(town);
  const r = commitMap({ root, dir: town, subject: 'rollout: Town A v1.1 on engine abc', body: 'a note' });
  assert.strictEqual(r.status, 'committed', JSON.stringify(r));
  assert.deepStrictEqual(r.files.slice().sort(), [
    'Areas/Town A/ci-reference/added.json', 'Areas/Town A/ci-reference/gone.json',
    'Areas/Town A/ci-reference/routes.json', 'Areas/Town A/manifest.json']);
  const shown = git(root, 'show', '--name-status', '--format=%s%n%b', 'HEAD');
  assert.match(shown, /^rollout: Town A v1\.1 on engine abc/);
  assert.match(shown, /a note/);
  assert.match(shown, /D\s+Areas\/Town A\/ci-reference\/gone\.json/);
  assert.match(shown, /A\s+Areas\/Town A\/ci-reference\/added\.json/);
  assert.doesNotMatch(shown, /S4-generate/, 'gitignored build output was committed');
  assert.strictEqual(git(root, 'status', '--porcelain', '-uall', '--', 'Areas/Town A').trim(), '', 'the map is still dirty');
});

test('never touches a sibling map, even one that is dirty', () => {
  const { root, town, other } = repo();
  roll(town);
  fs.writeFileSync(path.join(other, 'manifest.json'), '{"v":99}\n');
  const r = commitMap({ root, dir: town, subject: 'rollout: Town A' });
  assert.strictEqual(r.status, 'committed');
  assert.match(git(root, 'status', '--porcelain', '--', 'Areas/Town B'), /M "?Areas\/Town B\/manifest\.json/, 'the sibling was committed or reset');
  assert.doesNotMatch(git(root, 'show', '--name-only', '--format=', 'HEAD'), /Town B/);
});

test('a clean map has nothing to commit and says so', () => {
  const { root, town } = repo();
  const before = git(root, 'rev-parse', 'HEAD');
  assert.deepStrictEqual(commitMap({ root, dir: town, subject: 'x' }), { status: 'clean' });
  assert.strictEqual(git(root, 'rev-parse', 'HEAD'), before, 'an empty commit was made');
});

test('a checkout that is not on main is skipped, and the files stay written', () => {
  const { root, town } = repo('work-branch');
  roll(town);
  const r = commitMap({ root, dir: town, subject: 'x' });
  assert.strictEqual(r.status, 'skipped');
  assert.match(r.why, /not main/);
  assert.match(git(root, 'status', '--porcelain', '--', 'Areas/Town A'), /manifest\.json/, 'the refusal lost the written file');
});

test('a path somebody already staged under the map is refused, because a pathspec commit would carry it', () => {
  const { root, town } = repo();
  roll(town);
  git(root, 'add', '--', 'Areas/Town A/ci-reference/added.json');
  const r = commitMap({ root, dir: town, subject: 'x' });
  assert.strictEqual(r.status, 'skipped');
  assert.match(r.why, /already staged/);
  assert.strictEqual(git(root, 'log', '-1', '--format=%s').trim(), 'seed');
});

test('a folder outside the checkout is skipped', () => {
  const { root } = repo();
  const r = commitMap({ root, dir: path.join(root, '..', 'elsewhere'), subject: 'x' });
  assert.strictEqual(r.status, 'skipped');
  assert.match(r.why, /not inside/);
});

test('a commit that does not read back is reported as failed, not committed', () => {
  const { root, town } = repo();
  roll(town);
  // A stub that lets the commit "succeed" but reports a different subject at HEAD: the read-back is the check.
  const real = (r, argv, input) => {
    const x = spawnSync('git', ['-C', r, ...argv], { encoding: 'utf8', input });
    return { status: x.status, out: String(x.stdout || ''), err: String(x.stderr || '') };
  };
  const lying = (r, argv, input) => {
    const out = real(r, argv, input);
    if (argv[0] === 'log') return { ...out, out: out.out.replace(/\0.*/s, '\0some other subject\n') };
    return out;
  };
  const res = commitMap({ root, dir: town, subject: 'rollout: Town A', git: lying });
  assert.strictEqual(res.status, 'failed');
  assert.match(res.why, /did not read back/);
});

test('reportCommit: true for committed and clean, false for skipped and failed', () => {
  const log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    assert.strictEqual(reportCommit({ status: 'committed', sha: 'abc', subject: 's', files: ['a'] }), true);
    assert.strictEqual(reportCommit({ status: 'clean' }), true);
    assert.strictEqual(reportCommit({ status: 'skipped', why: 'w' }), false);
    assert.strictEqual(reportCommit({ status: 'failed', why: 'w' }), false);
  } finally { console.log = log; console.error = err; }
});

test('parseStatusZ reads paths with spaces and skips a rename\'s second field', () => {
  const rows = parseStatusZ(' M Areas/Town A/manifest.json\0?? Areas/Town A/new file.json\0R  new.json\0old.json\0 D gone.json\0');
  assert.deepStrictEqual(rows.map(r => r.file), ['Areas/Town A/manifest.json', 'Areas/Town A/new file.json', 'new.json', 'gone.json']);
});
