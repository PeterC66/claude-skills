#!/usr/bin/env node
/* The cases for commit_paths.mjs (buses-data OA-617).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), no placeholders:
 *
 *   node test-commit-paths.mjs
 *
 * Real throwaway git repositories under the temp folder, real hooks where a case needs one to
 * refuse or to rewrite what it was handed, and an injected `git` where a case needs the world to
 * change between two calls. No network, no estate, no clock. Every case that matters is a refusal
 * or a read-back that must FAIL, because a commit script that commits is the easy half.
 *
 * `COMMIT_PATHS_SCRIPT=<file>` runs the same cases against another copy of the script, which is how
 * `prove-red-commit-paths.mjs` aims it at a copy with one guard broken. `--only <id>[,<id>]` runs
 * the named cases alone, so that harness need not run the whole suite once per break.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(process.env.COMMIT_PATHS_SCRIPT || path.join(HERE, 'commit_paths.mjs'));
const { main, defaultGit } = await import(pathToFileURL(SCRIPT).href);
const onlyIdx = process.argv.indexOf('--only');
const ONLY_IDS = onlyIdx > 0 ? process.argv[onlyIdx + 1].split(',') : null;
/** A selector is a case id, or a prefix ending in `*`. */
const wanted = (id) => !ONLY_IDS || ONLY_IDS.some((s) => (s.endsWith('*') ? id.startsWith(s.slice(0, -1)) : id === s));

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-paths-'));
let n = 0;
const g = (repo, ...argv) => {
  const r = spawnSync('git', ['-C', repo, ...argv], { encoding: 'utf8' });
  return { status: r.status, out: String(r.stdout || '').replace(/\r?\n$/, ''), err: String(r.stderr || '') };
};
const write = (repo, rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };

const STAMPED = (sha, vis) => `# Title\n<!-- docstamp v1.0 | 2026-01-01 | sha=${sha} -->\n${vis}\n\nbody one\n`;
const VIS = (d) => `**v1.0** \u00b7 updated ${d}`;

/** A repository on `main` with one commit, plus a message file kept OUTSIDE it. */
function fixture() {
  const repo = path.join(SCRATCH, 'r' + ++n);
  fs.mkdirSync(repo, { recursive: true });
  g(repo, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 'harness'], ['user.email', 'harness@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.safecrlf', 'false']]) g(repo, 'config', k, v);
  write(repo, '.gitignore', 'ignored.txt\n');
  write(repo, 'a.md', 'alpha\n');
  write(repo, 'b.md', 'bravo\n');
  write(repo, 'keep.txt', 'keep\n');
  write(repo, 'sub/c.txt', 'charlie\n');
  write(repo, 'data [v2].md', 'bracket\n');
  write(repo, 'data 2.md', 'sibling\n');
  write(repo, 'doc.md', STAMPED('aaaaaaaa', VIS('1 January 2026')));
  g(repo, 'add', '.gitignore', 'a.md', 'b.md', 'keep.txt', 'sub/c.txt', 'data [v2].md', 'data 2.md', 'doc.md');
  g(repo, 'commit', '-q', '-m', 'base');
  const msg = path.join(SCRATCH, `msg${n}.txt`);
  const MESSAGE = 'harness: a subject with `backticks`, $(echo no) and "quotes"\n\nBody line with `code` and $HOME and a trailing backslash \\\n';
  fs.writeFileSync(msg, MESSAGE);
  return { repo, msg, MESSAGE };
}
const hook = (repo, name, body) => fs.writeFileSync(path.join(repo, '.git', 'hooks', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
const base = (f, extra = []) => ['--repo', f.repo, '--branch', 'main', '--message-file', f.msg, ...extra];
const run = (f, paths, extra = [], deps = {}) => main([...base(f, extra), '--', ...paths], deps);
const json = (r) => JSON.parse(r.stdout);
const report = (f, paths, extra = [], deps) => { const r = run(f, paths, ['--json', ...extra], deps); return { r, j: json(r) }; };
const apply = (f, paths, token, extra = [], deps) => run(f, paths, ['--apply', '--reviewed', token, ...extra], deps);
const head = (f) => g(f.repo, 'rev-parse', 'HEAD').out;
const filesOf = (f, rev = 'HEAD') => g(f.repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', rev).out.split('\n').filter(Boolean).sort();
const lsStaged = (f) => g(f.repo, 'diff', '--cached', '--name-only').out.split('\n').filter(Boolean).sort();
const status = (f) => g(f.repo, 'status', '--porcelain', '-uall').out.split('\n').filter(Boolean).sort();
/** git, with a callback seeing each call BEFORE it runs: cb(argv, callNumberForThisVerb) may change the world. */
const spy = (cb) => { const seen = {}; return (root, argv, input) => { const k = argv.slice(0, 2).join(' '); seen[k] = (seen[k] || 0) + 1; const over = cb(argv, seen[k], root, k); return over || defaultGit(root, argv, input); }; };

const T = [];
const test = (id, title, fn) => T.push({ id, title, fn });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const yes = (v, what) => { if (!v) throw new Error(what); };
const refusedWith = (r, re, what = 'refusal') => { eq(r.code, 2, `${what} exit code`); yes(re.test(r.stderr), `${what}: stderr ${JSON.stringify(r.stderr.split('\n')[0])} does not match ${re}`); };

test('report', 'the report prints the diff and a token and changes nothing', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  write(f.repo, 'new.md', 'brand new\n');
  const before = head(f);
  const { r, j } = report(f, ['a.md', 'new.md']);
  eq(r.code, 0, 'exit code');
  yes(/^[0-9a-f]{16}$/.test(j.token), 'a 16-hex token');
  eq(j.paths.map((p) => [p.path, p.state]), [['a.md', 'modified'], ['new.md', 'new']], 'paths');
  yes(j.diff.includes('+alpha2') && j.diff.includes('+brand new'), 'the diff shows the modified line and the new file');
  eq(head(f), before, 'HEAD'); eq(lsStaged(f), [], 'nothing staged');
  const text = run(f, ['a.md']);
  yes(/^commit_paths: REPORT/.test(text.stdout) && text.stdout.includes('--apply --reviewed'), 'the text report names the apply command');
});

test('commit', 'a commit takes the named path alone and carries the message byte for byte', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  write(f.repo, 'b.md', 'bravo\nneighbour edit\n');
  write(f.repo, 'keep.txt', 'keep\nstaged by another session\n');
  g(f.repo, 'add', 'keep.txt');
  const { j } = report(f, ['a.md']);
  yes(j.otherStaged.includes('keep.txt'), 'the report names the neighbour\'s staged file');
  const r = apply(f, ['a.md'], j.token);
  eq(r.code, 0, 'exit code'); yes(/committed [0-9a-f]{8}/.test(r.stdout), 'success line');
  eq(filesOf(f), ['a.md'], 'files in the commit');
  eq(lsStaged(f), ['keep.txt'], 'the neighbour\'s staged file is still staged and uncommitted');
  yes(status(f).some((l) => l.includes('b.md')), 'the unnamed dirty file is still dirty');
  eq(g(f.repo, 'log', '-1', '--format=%B').out.trim(), f.MESSAGE.trim(), 'the message');
});

test('pathspec', 'the commit is a pathspec commit, so it cannot carry the index', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  write(f.repo, 'b.md', 'bravo\nstaged elsewhere\n');
  g(f.repo, 'add', 'b.md');
  const { j } = report(f, ['a.md']);
  const r = apply(f, ['a.md'], j.token);
  eq(r.code, 0, 'exit code'); eq(filesOf(f), ['a.md'], 'files in the commit'); eq(lsStaged(f), ['b.md'], 'the other staged path');
});

test('token', 'a path edited after the report is refused, and so is a changed message', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  const { j } = report(f, ['a.md']);
  write(f.repo, 'a.md', 'alpha\nalpha2\nsneaked in after the review\n');
  const before = head(f);
  refusedWith(apply(f, ['a.md'], j.token), /not what was reviewed/, 'stale path');
  eq(head(f), before, 'HEAD unchanged');
  const f2 = fixture();
  write(f2.repo, 'a.md', 'alpha\nalpha2\n');
  const j2 = report(f2, ['a.md']).j;
  fs.writeFileSync(f2.msg, 'a different subject\n');
  refusedWith(apply(f2, ['a.md'], j2.token), /not what was reviewed/, 'changed message');
  refusedWith(apply(f2, ['a.md'], 'deadbeefdeadbeef'), /not what was reviewed/, 'invented token');
});

test('branch1', 'the wrong branch is refused at the start', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  refusedWith(main(['--repo', f.repo, '--branch', 'work/other', '--message-file', f.msg, '--', 'a.md']), /not "work\/other"/, 'wrong branch');
});

test('branch2', 'a branch that changes between the review and the commit stops the commit', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  write(f.repo, 'new.md', 'brand new\n');
  const { j } = report(f, ['a.md', 'new.md']);
  const before = head(f);
  const git = spy((argv, k) => (argv[0] === 'branch' && k === 2 ? { status: 0, out: 'work/elsewhere\n', err: '' } : null));
  refusedWith(apply(f, ['a.md', 'new.md'], j.token, [], { git }), /branch changed under the commit/, 'flipped branch');
  eq(head(f), before, 'HEAD'); eq(lsStaged(f), [], 'nothing was staged before the refusal');
});

test('head', 'a HEAD that moves between the review and the commit stops the commit', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  const { j } = report(f, ['a.md']);
  const git = spy((argv, k) => {
    if (argv[0] === 'rev-parse' && argv.includes('HEAD') && argv.includes('--verify') && k === 2) {
      write(f.repo, 'other.txt', 'a neighbour\'s commit\n'); g(f.repo, 'add', 'other.txt'); g(f.repo, 'commit', '-q', '-m', 'neighbour', '--', 'other.txt');
    }
    return null;
  });
  refusedWith(apply(f, ['a.md'], j.token, [], { git }), /HEAD moved/, 'moved HEAD');
  eq(filesOf(f), ['other.txt'], 'only the neighbour\'s commit exists');
});

const BAD = [
  ['glob', ['*.md'], /glob/], ['glob', ['a?.md'], /glob/],
  ['dir-slash', ['sub/'], /directory/], ['dir', ['sub'], /directory/],
  ['outside', ['../elsewhere.txt'], /is outside (?!repository)\S/], ['outside', [path.join(SCRATCH, 'abs.txt')], /is outside (?!repository)\S/],
];
BAD.forEach(([id, paths, re], i) => {
  test(`refuse-${id}-${i}`, `${path.isAbsolute(paths[0]) ? 'an absolute path outside the repository' : JSON.stringify(paths[0])} is refused (${id})`, () => {
    const f = fixture();
    write(f.repo, 'a.md', 'alpha\nalpha2\n'); write(f.repo, 'sub/c.txt', 'charlie\nchanged\n'); fs.writeFileSync(path.join(SCRATCH, 'abs.txt'), 'x');
    const before = head(f);
    refusedWith(run(f, paths), re, JSON.stringify(paths[0]));
    refusedWith(apply(f, paths, '0000000000000000'), re, 'apply ' + JSON.stringify(paths[0]));
    eq(head(f), before, 'HEAD'); eq(lsStaged(f), [], 'index');
  });
});

test('refuse-misc', 'duplicates, .git, unchanged, missing, ignored and a message among the paths are refused', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n'); write(f.repo, 'ignored.txt', 'ignored\n');
  refusedWith(run(f, ['a.md', 'a.md']), /named twice/, 'duplicate');
  refusedWith(run(f, ['.git/config']), /inside \.git/, '.git');
  refusedWith(run(f, ['b.md']), /no change to commit/, 'unchanged');
  refusedWith(run(f, ['nope.md']), /does not exist, or \.gitignore/, 'missing');
  refusedWith(run(f, ['ignored.txt']), /does not exist, or \.gitignore/, 'ignored');
  const inside = path.join(f.repo, 'msg-inside.txt'); fs.writeFileSync(inside, 'subject\n');
  refusedWith(main(['--repo', f.repo, '--branch', 'main', '--message-file', inside, '--', 'msg-inside.txt']), /one of the paths/, 'message among the paths');
  fs.writeFileSync(f.msg, '\n  \n');
  refusedWith(run(f, ['a.md']), /is empty/, 'empty message');
  refusedWith(main(['--repo', f.repo, '--branch', 'main', '--message-file', path.join(SCRATCH, 'missing.txt'), '--', 'a.md']), /cannot read the message file/, 'no message file');
  refusedWith(main(['--repo', path.join(f.repo, 'sub'), '--branch', 'main', '--message-file', f.msg, '--', 'a.md']), /not a git checkout|must be the repository root/, 'repo is a subfolder');
});

test('arguments', 'unknown flags, missing options and a stray --apply are refused by name', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  refusedWith(run(f, ['a.md'], ['--commit-all']), /unknown flag --commit-all/, 'unknown flag');
  refusedWith(main(['--repo', f.repo, '--branch', 'main', '--', 'a.md']), /--message-file is required/, 'no message file');
  refusedWith(main(['--repo', f.repo, '--branch', 'main', '--message-file', f.msg]), /at least one path/, 'no paths');
  refusedWith(run(f, ['a.md'], ['--apply']), /needs --reviewed/, '--apply alone');
  refusedWith(run(f, ['a.md'], ['--reviewed', 'abc']), /only means something with --apply/, '--reviewed alone');
  refusedWith(main([...base(f), 'a.md']), /unexpected argument/, 'a path before --');
});

test('staged', 'a path somebody else staged is refused and left staged', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nhalf-finished edit from another session\n');
  g(f.repo, 'add', 'a.md');
  const before = head(f);
  refusedWith(run(f, ['a.md']), /already staged by somebody else/, 'report');
  refusedWith(apply(f, ['a.md'], '0000000000000000'), /already staged by somebody else/, 'apply');
  eq(lsStaged(f), ['a.md'], 'still staged'); eq(head(f), before, 'HEAD');
});

test('literal', 'a name with [ ] is that file and not a pattern that also matches its sibling', () => {
  const f = fixture();
  write(f.repo, 'data [v2].md', 'bracket\nedited\n'); write(f.repo, 'data 2.md', 'sibling\nedited too\n');
  const { j } = report(f, ['data [v2].md']);
  eq(j.paths.map((p) => p.path), ['data [v2].md'], 'paths');
  const r = apply(f, ['data [v2].md'], j.token);
  eq(r.code, 0, 'exit code'); eq(filesOf(f), ['data [v2].md'], 'files in the commit');
  yes(status(f).some((l) => l.includes('data 2.md')), 'the sibling is still uncommitted');
});

test('new-deleted', 'a new file and a deleted file go in one commit', () => {
  const f = fixture();
  write(f.repo, 'new.md', 'brand new\n'); fs.rmSync(path.join(f.repo, 'b.md'));
  const { j } = report(f, ['new.md', 'b.md']);
  eq(j.paths.map((p) => [p.path, p.state]), [['new.md', 'new'], ['b.md', 'deleted']], 'states');
  const r = apply(f, ['new.md', 'b.md'], j.token);
  eq(r.code, 0, 'exit code'); eq(filesOf(f), ['b.md', 'new.md'], 'files in the commit');
  eq(g(f.repo, 'ls-tree', '-r', '--name-only', 'HEAD').out.split('\n').includes('b.md'), false, 'b.md gone from HEAD');
});

test('hook-refuses', 'a hook that refuses leaves nothing committed and nothing staged', () => {
  const f = fixture();
  hook(f.repo, 'pre-commit', 'echo "pre-commit: no thanks" >&2\nexit 1');
  write(f.repo, 'a.md', 'alpha\nalpha2\n'); write(f.repo, 'new.md', 'brand new\n');
  const { j } = report(f, ['a.md', 'new.md']);
  const before = head(f);
  const r = apply(f, ['a.md', 'new.md'], j.token);
  eq(r.code, 1, 'exit code'); yes(/no thanks/.test(r.stderr), 'the hook\'s words reach the caller');
  eq(head(f), before, 'HEAD'); eq(lsStaged(f), [], 'the new file is unstaged again');
  yes(fs.existsSync(path.join(f.repo, 'new.md')), 'the new file is still on disk');
  const rj = json(apply(f, ['a.md', 'new.md'], j.token, ['--json']));
  eq([rj.ok, rj.committed], [false, false], 'json says nothing was committed');
});

test('rb-content', 'a hook that rewrites a reviewed line makes the read-back fail, loudly, with committed:true', () => {
  const f = fixture();
  hook(f.repo, 'pre-commit', "sed -i 's/alpha2/ALPHA-REWRITTEN/' a.md\ngit add a.md");
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  const { j } = report(f, ['a.md']);
  const r = apply(f, ['a.md'], j.token);
  eq(r.code, 1, 'exit code'); yes(/^COMMITTED [0-9a-f]{8} - READ-BACK FAILED\n/.test(r.stdout), `first line, got ${JSON.stringify(r.stdout.split('\n')[0])}`);
  yes(/FAIL content a\.md/.test(r.stdout), 'the failing check is named');
  const f2 = fixture();
  hook(f2.repo, 'pre-commit', "sed -i 's/alpha2/ALPHA-REWRITTEN/' a.md\ngit add a.md");
  write(f2.repo, 'a.md', 'alpha\nalpha2\n');
  const j2 = report(f2, ['a.md']).j;
  const rj = json(apply(f2, ['a.md'], j2.token, ['--json']));
  eq([rj.ok, rj.committed], [false, true], 'json: committed but not ok');
  yes(/^[0-9a-f]{40}$/.test(rj.sha), 'json carries the sha');
});

test('rb-stamp', 'the two document-stamp lines may differ from the reviewed diff', () => {
  const f = fixture();
  hook(f.repo, 'pre-commit', "sed -i 's/sha=bbbbbbbb/sha=cccccccc/; s/updated 2 January 2026/updated 9 October 2026/' doc.md\ngit add doc.md");
  write(f.repo, 'doc.md', STAMPED('bbbbbbbb', VIS('2 January 2026')).replace('body one', 'body two'));
  const { j } = report(f, ['doc.md']);
  const r = apply(f, ['doc.md'], j.token);
  eq(r.code, 0, `exit code (${r.stdout.split('\n').filter((l) => /^\s+FAIL/.test(l)).join(' | ')})`);
  yes(g(f.repo, 'show', 'HEAD:doc.md').out.includes('sha=cccccccc'), 'the hook\'s stamp is what landed');
  yes(g(f.repo, 'show', 'HEAD:doc.md').out.includes('body two'), 'the reviewed edit landed');
  eq(status(f), [], 'git status afterwards: the index is not left one stamp behind');
  yes(/restamped doc\.md/.test(r.stdout), 'the refresh is said aloud');
});

test('rb-clean', 'a path left dirty after the commit makes the read-back fail', () => {
  const f = fixture();
  hook(f.repo, 'post-commit', 'echo dirtied-after >> a.md');
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  const { j } = report(f, ['a.md']);
  const r = apply(f, ['a.md'], j.token);
  eq(r.code, 1, 'exit code'); yes(/FAIL status clean/.test(r.stdout), 'status clean named');
});

test('rb-subject', 'a hook that rewrites the subject makes the read-back fail', () => {
  const f = fixture();
  hook(f.repo, 'commit-msg', `sed -i '1s/^/hooked: /' "$1"`);
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  const { j } = report(f, ['a.md']);
  const r = apply(f, ['a.md'], j.token);
  eq(r.code, 1, 'exit code'); yes(/FAIL subject/.test(r.stdout), 'subject named');
});

test('rb-files', 'a hook that adds a file to the commit makes the read-back fail', () => {
  const f = fixture();
  hook(f.repo, 'pre-commit', "echo smuggled > smuggled.txt\ngit add smuggled.txt");
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  const { j } = report(f, ['a.md']);
  const r = apply(f, ['a.md'], j.token);
  eq(r.code, 1, 'exit code'); yes(/FAIL files/.test(r.stdout), 'files named');
});

test('lock', 'a held index lock is "not now" (exit 3) and commits nothing', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  const { j } = report(f, ['a.md']);
  const lock = path.join(f.repo, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  const before = head(f);
  const r = apply(f, ['a.md'], j.token);
  fs.rmSync(lock);
  eq(r.code, 3, 'exit code'); yes(/locked by another process/.test(r.stderr), 'says why'); eq(head(f), before, 'HEAD');
});

test('index-untrack', '--index commits an untrack and the file stays on disk', () => {
  const f = fixture();
  g(f.repo, 'rm', '--cached', '-q', 'keep.txt');
  const { j } = report(f, ['keep.txt'], ['--index']);
  eq(j.paths.map((p) => [p.path, p.state]), [['keep.txt', 'untrack']], 'states');
  const r = apply(f, ['keep.txt'], j.token, ['--index']);
  eq(r.code, 0, `exit code (${r.stderr}${r.stdout})`); eq(filesOf(f), ['keep.txt'], 'files in the commit');
  yes(fs.existsSync(path.join(f.repo, 'keep.txt')), 'the file is still on disk');
  yes(!g(f.repo, 'ls-tree', '-r', '--name-only', 'HEAD').out.split('\n').includes('keep.txt'), 'gone from HEAD');
});

test('index-mode', '--index commits a mode change and reads back the mode', () => {
  const f = fixture();
  g(f.repo, 'update-index', '--chmod=+x', 'a.md');
  const { j } = report(f, ['a.md'], ['--index']);
  eq(j.paths.map((p) => p.state), ['mode'], 'state');
  const r = apply(f, ['a.md'], j.token, ['--index']);
  eq(r.code, 0, `exit code (${r.stderr}${r.stdout})`);
  yes(/^100755 /.test(g(f.repo, 'ls-tree', 'HEAD', '--', 'a.md').out), 'mode 100755 in HEAD');
});

test('index-set', '--index refuses when the staged set is not exactly the named paths', () => {
  const f = fixture();
  g(f.repo, 'rm', '--cached', '-q', 'keep.txt');
  write(f.repo, 'b.md', 'bravo\nsomeone else\n'); g(f.repo, 'add', 'b.md');
  const before = head(f);
  refusedWith(run(f, ['keep.txt'], ['--index']), /Staged but not named: b\.md/, 'extra staged');
  refusedWith(run(f, ['keep.txt', 'a.md'], ['--index']), /Named but not staged: a\.md/, 'missing staged');
  eq(head(f), before, 'HEAD'); eq(lsStaged(f), ['b.md', 'keep.txt'], 'index untouched');
});

test('index-kind', '--index refuses a staged change of content', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n'); g(f.repo, 'add', 'a.md');
  refusedWith(run(f, ['a.md'], ['--index']), /change of content/, 'content change');
});

test('index-recheck', '--index refuses when the index moves between the review and the commit', () => {
  const f = fixture();
  g(f.repo, 'rm', '--cached', '-q', 'keep.txt');
  const { j } = report(f, ['keep.txt'], ['--index']);
  const before = head(f);
  let raws = 0;
  const git = spy((argv) => { if (argv[0] === 'diff' && argv.includes('--raw') && ++raws === 2) { write(f.repo, 'b.md', 'bravo\nsneaked\n'); g(f.repo, 'add', 'b.md'); } return null; });
  refusedWith(apply(f, ['keep.txt'], j.token, ['--index'], { git }), /index changed between/, 'moved index');
  eq(head(f), before, 'HEAD');
});

test('cli', 'the command line works end to end: JSON on stdout, reasons on stderr, the exit code set', () => {
  const f = fixture();
  write(f.repo, 'a.md', 'alpha\nalpha2\n');
  const cli = (...argv) => spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8' });
  const rep = cli(...base(f, ['--json']), '--', 'a.md');
  eq(rep.status, 0, 'report exit'); const token = JSON.parse(rep.stdout).token;
  const bad = cli(...base(f, ['--bogus']), '--', 'a.md');
  eq(bad.status, 2, 'unknown flag exit'); yes(bad.stdout === '' && /--bogus/.test(bad.stderr), 'stdout empty, reason on stderr');
  const done = cli(...base(f, ['--json', '--apply', '--reviewed', token]), '--', 'a.md');
  eq(done.status, 0, 'apply exit'); eq(JSON.parse(done.stdout).committed, true, 'committed');
  eq(filesOf(f), ['a.md'], 'files in the commit');
});

let failed = 0, ran = 0;
console.log(`commit_paths test — ${path.relative(process.cwd(), SCRIPT) || SCRIPT}`);
for (const t of T) {
  if (!wanted(t.id)) continue;
  ran++;
  try { t.fn(); console.log(`  ok   ${t.id}: ${t.title}`); } catch (e) { failed++; console.log(`  FAIL ${t.id}: ${t.title}\n         ${String(e.message).split('\n')[0]}`); }
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log(failed ? `\nFAIL — ${failed} of ${ran} case(s)` : `\nOK — ${ran} case(s)`);
process.exit(failed ? 1 : 0);
