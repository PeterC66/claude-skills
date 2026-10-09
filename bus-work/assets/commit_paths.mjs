#!/usr/bin/env node
/*
 * commit_paths.mjs — commit NAMED paths, once, from a diff you were shown, and read the commit
 * back by content (buses-data OA-617, which supersedes item D4 of the 2026-10-06 simplification
 * review).
 *
 * WHY IT EXISTS. Every session used to assemble the same sequence by hand: `git add "<file>"`, a
 * review of `git diff HEAD -- <paths>`, `git commit -F - -- <paths>` through a quoted heredoc, and a
 * read-back of `git show HEAD:<file>`. Each slip in that sequence grew a rule — a directory staged
 * by `git add`, a backtick in a `-m` message, a bare commit that took a neighbour's index, a commit
 * piped to `head`, a pathspec commit that put back an untracked file — until five hookify rules, four
 * rulebook bullets and a page of why stood round a sequence that one program can do correctly every
 * time. This is that program. `rollout_commit.js` and `ink_review.mjs` (`commitRecord`) already do
 * the same for the records a tool writes itself; this one is for a person's or a session's edit.
 *
 * TWO STEPS, AND THE SECOND CANNOT RUN WITHOUT THE FIRST.
 *
 *   report   (the default)  Resolves the paths, prints `git diff HEAD` of them, and prints a REVIEW
 *                           TOKEN: a hash of the branch, the paths, each path's blob at HEAD and in
 *                           the working tree, and the message. Changes nothing.
 *   --apply --reviewed <token>
 *                           Recomputes the token. If ANYTHING differs it refuses, because what would
 *                           land is no longer what was read. Otherwise it commits and reads back.
 *
 * WHAT IT REFUSES, before it touches git's index: a directory, a glob (`*` or `?`), a path outside
 * the repository, anything under `.git`, a path with no change to commit, a path somebody else has
 * already STAGED (the pathspec commit would carry their half-finished work under this message), a
 * branch other than `--branch` — checked at the start and again just before the commit — and a HEAD
 * that moved between the report and the commit. Every git call is `--literal-pathspecs` (the commit
 * names each path as `:(literal)<path>` instead, so the option is not exported to the hooks), so a
 * name with `[` in it is that file and never a pattern that also matches its sibling.
 *
 * HOW IT COMMITS: `git commit --quiet -F <message-file> -- <paths>` through spawnSync with the output
 * captured. Never a shell, so a backtick in the message is text; never a pipe, so a hook cannot be
 * killed mid-refusal by `head` closing it. A NEW file is `git add`ed by name first (a pathspec commit
 * cannot see an untracked file); if the commit is then refused, exactly those paths are unstaged again.
 *
 * THE READ-BACK is the part nobody did reliably by hand. After the commit: HEAD's subject is the
 * message's; HEAD's parent is the HEAD that was reviewed; the files HEAD changed are exactly the
 * paths named; `git status` for those paths is clean; and each path's committed blob IS the reviewed
 * blob — or, where the pre-commit hook rewrote it (the document stamp, written at commit time), every
 * line the reviewed diff added is still in `git show HEAD:<path>`, the two stamp lines excepted. A
 * restamp also leaves git's index one stamp behind (`MM`), so before the status read-back a staged
 * path whose working tree already equals HEAD has its index entry reset (`refreshStaleIndex`).
 *
 * --index. An untrack (`git rm --cached`) or a file-mode change (`git update-index --chmod=+x`) has
 * no working-tree content a pathspec could carry — a pathspec commit of an untracked file puts it
 * back — so it is committed from the INDEX. Do the `git rm --cached` or `update-index` first; this
 * mode requires the staged set to be EXACTLY the named paths (a neighbour's staged file is refused
 * by name), refuses a staged change of content, commits bare, and reads back that the index is clean,
 * the untracked path is gone from HEAD and a mode change reads back as the mode that was reviewed.
 *
 * It never pushes: the push preflight paces that. `git` and the file reads are injected so a stub can
 * falsify each branch (`prove-red-commit-paths-cases.mjs`), and `prove-red-commit-paths.mjs` breaks each guard
 * below, one at a time, in a scratch copy and requires that suite to go red. A line tagged
 * `@guard:<name>` is a line that harness replaces. Node core only; keep it one file, because the
 * harness copies it.
 *
 * Run from anywhere. <repo> is the repository root (a linked worktree's root is its own); <branch>
 * is the branch it must be on; <file> is a message file written beforehand with the Write tool, so
 * nothing in it passes through a shell; <path> is a file inside <repo>, relative to it or absolute:
 *
 *   node commit_paths.mjs --repo "<repo>" --branch <branch> --message-file "<file>" -- "<path>" ...
 *   node commit_paths.mjs ... --apply --reviewed <token> -- "<path>" ...
 *   node commit_paths.mjs ... --index [--apply --reviewed <token>] -- "<path>" ...
 *   add --json for one JSON object on stdout in place of the text
 *
 * Exit 0: the report was printed, or the commit landed and read back. Exit 1: the commit was
 * refused by a hook, or it LANDED and the read-back failed (the first line then reads
 * `COMMITTED <sha> - READ-BACK FAILED` and `--json` carries `committed: true`). Exit 2: refused
 * before any commit — a bad argument, a stale token, the wrong branch, a path staged by somebody
 * else, a path with no change. Exit 3: not now — git's index is locked by another process; nothing
 * was committed, try again.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class Refused extends Error {
  constructor(message, code = 2, usage = false) { super(message); this.code = code; this.usage = usage; }
}

export const defaultGit = (root, argv, input) => {
  /* NOT for `commit`: git exports the option to the hooks as GIT_LITERAL_PATHSPECS, which turned the
   * `'*.md'` glob in buses-data's post-commit hook into a literal and stopped its index repair from
   * ever running (found 2026-10-09). The commit names its paths as `:(literal)<path>` instead. */
  const flags = [];
  if (argv[0] !== 'commit' /* @guard:commit-env */) flags.push('--literal-pathspecs'); // @guard:literal
  const r = spawnSync('git', [...flags, '-C', root, ...argv], { encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024 });
  return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
};

export const realFs = {
  read: (file) => fs.readFileSync(file, 'utf8'),
  isDirectory: (abs) => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } },
  isFile: (abs) => { try { return fs.statSync(abs).isFile(); } catch { return false; } },
};

/* The two lines docstamp.py writes at commit time (stamp-docs/scripts/docstamp.py, MD_COMMENT_RE and
 * MD_VISIBLE_RE). A reviewed diff that touched either must not fail the read-back because the hook
 * restamped it. */
export const STAMP_COMMENT = /^<!--\s*docstamp\s+v\d+\.\d+\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*sha=[0-9a-fA-F]+\s*-->\s*$/;
export const STAMP_VISIBLE = /^\*\*v\d+\.\d+\*\*\s*.\s*updated\s+\S.*$/;
export const isStampLine = (line) => STAMP_COMMENT.test(line) || STAMP_VISIBLE.test(line);

const KNOWN = { repo: 1, branch: 1, 'message-file': 1, reviewed: 1, apply: 0, index: 0, json: 0, help: 0 };
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const lines = (text) => String(text).split('\n').map((l) => l.replace(/\r$/, ''));
const same = (a, b) => (process.platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);

/** `argv` (without node and the script) into options; a bare `--` ends the flags and starts the paths. */
export function parseCli(argv) {
  const o = { paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o.paths = argv.slice(i + 1); break; }
    if (!a.startsWith('--')) throw new Refused(`unexpected argument ${JSON.stringify(a)}: paths go after a bare --`, 2, true);
    const eq = a.indexOf('=');
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (!Object.hasOwn(KNOWN, name)) throw new Refused(`unknown flag --${name}; the flags are ${Object.keys(KNOWN).map((k) => '--' + k).join(', ')}`, 2, true);
    if (KNOWN[name] === 0) { o[name] = true; continue; }
    const v = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (v == null || v === '' || v === '--') throw new Refused(`--${name} needs a value`, 2, true);
    o[name] = v;
  }
  return o;
}

function requireOptions(o) {
  for (const k of ['repo', 'branch', 'message-file']) if (!o[k]) throw new Refused(`--${k} is required`, 2, true);
  if (!o.paths.length) throw new Refused('name at least one path after a bare --', 2, true);
  if (o.apply && !o.reviewed) throw new Refused('--apply needs --reviewed <token>: run without --apply, read the diff, and pass the token it prints', 2, true);
  if (o.reviewed && !o.apply) throw new Refused('--reviewed only means something with --apply', 2, true);
}

function resolveRoot(repo, git) {
  const r = git(repo, ['rev-parse', '--show-toplevel']);
  if (r.status !== 0) throw new Refused(`${repo} is not a git checkout (${r.err.trim()})`);
  const top = r.out.trim();
  if (!same(path.resolve(top), path.resolve(repo))) throw new Refused(`--repo must be the repository root: ${repo} is inside ${top}`);
  return top;
}

const currentBranch = (git, root) => {
  const b = git(root, ['branch', '--show-current']);
  if (b.status !== 0) throw new Refused(`could not read the branch: ${b.err.trim()}`);
  return b.out.trim();
};
const headSha = (git, root) => {
  const h = git(root, ['rev-parse', '--verify', 'HEAD']);
  if (h.status !== 0) throw new Refused('this repository has no commits yet; make the first one by hand');
  return h.out.trim();
};

/** Paths into repo-relative, slash-separated names, or a Refused saying which path and why. */
export function normalisePaths(root, raw, fsx) {
  const out = [];
  for (const p of raw) {
    if (!p || !p.trim()) throw new Refused('an empty path was named');
    if (/[*?]/.test(p)) throw new Refused(`${JSON.stringify(p)} is a glob; name each file`); // @guard:glob
    if (p.startsWith(':')) throw new Refused(`${JSON.stringify(p)} looks like a pathspec magic prefix; name the file`);
    const abs = path.resolve(root, p);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Refused(`${JSON.stringify(p)} is outside ${root}`); // @guard:outside
    if (rel.split('/')[0] === '.git') throw new Refused(`${JSON.stringify(p)} is inside .git`);
    if (fsx.isDirectory(abs)) throw new Refused(`${JSON.stringify(p)} is a directory; name each file`); // @guard:dir
    if (out.includes(rel)) throw new Refused(`${JSON.stringify(rel)} is named twice`);
    out.push(rel);
  }
  return out;
}

function readMessage(file, root, paths, fsx) {
  const abs = path.resolve(file);
  let text;
  try { text = fsx.read(abs); } catch (e) { throw new Refused(`cannot read the message file ${abs}: ${e.message}`); }
  const body = text.replace(/\r\n/g, '\n').replace(/^\s*\n/, '');
  if (!body.trim()) throw new Refused(`the message file ${abs} is empty`);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (paths.some((p) => same(p, rel))) throw new Refused(`the message file ${abs} is one of the paths to commit`);
  /* git's %s: the first paragraph, its lines joined by single spaces. */
  const subject = body.split(/\n\s*\n/)[0].split('\n').map((l) => l.trim()).join(' ').trim();
  return { file: abs, hash: sha256(body), subject };
}

/** `git status --porcelain=v1 -z` into rows `{ x, y, file }`. */
export function parseStatusZ(out) {
  return out.split('\0').filter(Boolean).map((e) => ({ x: e[0], y: e[1], file: e.slice(3) }));
}

/** `git diff --raw -z` into `{ oldMode, newMode, oldSha, newSha, status, path }`. */
export function parseRawZ(out) {
  const t = out.split('\0');
  const rows = [];
  for (let i = 0; i < t.length - 1; i++) {
    if (!t[i].startsWith(':')) continue;
    const [oldMode, newMode, oldSha, newSha, status] = t[i].slice(1).split(' ');
    rows.push({ oldMode, newMode, oldSha, newSha, status, path: t[++i] });
  }
  return rows;
}

function parseTreeZ(out) {
  const m = new Map();
  for (const e of out.split('\0').filter(Boolean)) {
    const tab = e.indexOf('\t');
    const [mode, , sha] = e.slice(0, tab).split(' ');
    m.set(e.slice(tab + 1), { mode, sha });
  }
  return m;
}

const addedLines = (diff) => lines(diff).filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
const isBinaryDiff = (diff) => /^Binary files .* differ$/m.test(diff) || /^GIT binary patch$/m.test(diff);

function planWorktree(ctx) {
  const { git, root, paths } = ctx;
  const st = git(root, ['status', '--porcelain=v1', '-z', '--no-renames', '-uall', '--', ...paths]);
  if (st.status !== 0) throw new Refused(`git status failed: ${st.err.trim()}`);
  const rows = new Map(parseStatusZ(st.out).map((r) => [r.file, r]));
  const staged = paths.filter((p) => { const r = rows.get(p); return r && r.x !== ' ' && r.x !== '?' && r.x !== '!'; });
  if (staged.length) throw new Refused(`already staged by somebody else, and a pathspec commit would carry it under this message: ${staged.join(', ')}. Nothing was changed; ask what that session is doing (git log --oneline --since=midnight) before taking the path.`); // @guard:staged
  const tree = parseTreeZ(git(root, ['ls-tree', '-z', 'HEAD', '--', ...paths]).out);
  const problems = [];
  const entries = [];
  for (const p of paths) {
    const r = rows.get(p);
    if (!r) { problems.push(tree.has(p) ? `${p} has no change to commit` : `${p} is not tracked and not new: it does not exist, or .gitignore ignores it`); continue; }
    const state = r.y === '?' ? 'new' : r.y === 'D' ? 'deleted' : (r.y === 'M' || r.y === 'T') ? 'modified' : null;
    if (!state) { problems.push(`${p} is in git state ${JSON.stringify(r.x + r.y)}, which this script does not commit`); continue; }
    if (state === 'new' && !ctx.fsx.isFile(path.resolve(root, p))) { problems.push(`${p} is untracked and is not a regular file`); continue; }
    let diff;
    if (state === 'new') diff = git(root, ['diff', '--no-index', '--no-color', '--', '/dev/null', p]).out;
    else diff = git(root, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--no-renames', '--', p]).out;
    const head = tree.get(p)?.sha || null;
    let work = null;
    if (state !== 'deleted') {
      const h = git(root, ['hash-object', '--', p]);
      if (h.status !== 0) { problems.push(`could not hash ${p}: ${h.err.trim()}`); continue; }
      work = h.out.trim();
    }
    entries.push({ path: p, state, head, work, diff, added: addedLines(diff), binary: isBinaryDiff(diff) });
  }
  if (problems.length) throw new Refused(problems.join('\n  '));
  const other = git(root, ['diff', '--cached', '--name-only', '-z', '--no-renames']).out.split('\0').filter(Boolean).filter((f) => !paths.includes(f));
  return { entries, otherStaged: other, diff: entries.map((e) => e.diff).join(''), digest: entries.map((e) => [e.path, e.state, e.head, e.work]) }; // @guard:digest
}

function planIndex(ctx) {
  const { git, root, paths } = ctx;
  const raw = git(root, ['diff', '--cached', '--raw', '-z', '--no-renames']);
  if (raw.status !== 0) throw new Refused(`git diff --cached failed: ${raw.err.trim()}`);
  const staged = parseRawZ(raw.out);
  const extra = staged.map((r) => r.path).filter((p) => !paths.includes(p));
  const missing = paths.filter((p) => !staged.some((r) => r.path === p));
  if (extra.length || missing.length) throw new Refused(`--index commits the whole index, so the staged set must be exactly the named paths. Staged but not named: ${extra.join(', ') || '(none)'}. Named but not staged: ${missing.join(', ') || '(none)'}. Nothing was changed.`); // @guard:index-set
  const entries = staged.map((r) => {
    const kind = r.status === 'D' ? 'untrack' : (r.status === 'M' && r.oldSha === r.newSha && r.oldMode !== r.newMode) ? 'mode' : null;
    if (!kind) throw new Refused(`${r.path} is staged as ${r.status} with a change of content; --index is only for an untrack or a mode change, so commit content with a pathspec (no --index)`); // @guard:index-kind
    return { path: r.path, state: kind, oldMode: r.oldMode, newMode: r.newMode, sha: r.oldSha };
  });
  const diff = git(root, ['diff', '--cached', '--no-color', '--no-ext-diff', '--no-renames', '--stat', '--summary']).out;
  return { entries, otherStaged: [], diff, digest: entries.map((e) => [e.path, e.state, e.oldMode, e.newMode, e.sha]), raw: raw.out };
}

/** Everything a report prints and a token is made of. Reads; changes nothing. */
export function plan(o, deps) {
  const { git, fsx } = deps;
  const root = resolveRoot(o.repo, git);
  const branch = currentBranch(git, root);
  if (branch !== o.branch) throw new Refused(`the checkout is on ${JSON.stringify(branch)}, not ${JSON.stringify(o.branch)}; nothing was changed`); // @guard:branch1
  const head = headSha(git, root);
  const paths = normalisePaths(root, o.paths, fsx);
  const message = readMessage(o['message-file'], root, paths, fsx);
  const body = (o.index ? planIndex : planWorktree)({ git, root, paths, fsx });
  const token = sha256(JSON.stringify({ v: 1, mode: o.index ? 'index' : 'paths', branch, digest: body.digest.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)), message: message.hash })).slice(0, 16); // @guard:msg-hash
  return { root, branch, head, paths, message, mode: o.index ? 'index' : 'paths', token, ...body };
}

const fmtCmd = (p) => `node "${fileURLToPath(import.meta.url).split(path.sep).join('/')}" --repo "${p.root}" --branch "${p.branch}" --message-file "${p.message.file.split(path.sep).join('/')}"${p.mode === 'index' ? ' --index' : ''} --apply --reviewed ${p.token} -- ${p.paths.map((x) => `"${x}"`).join(' ')}`;

function reportText(p) {
  const L = [];
  L.push('commit_paths: REPORT — nothing was committed or staged');
  L.push(`repo      ${p.root}`);
  L.push(`branch    ${p.branch}  (HEAD ${p.head.slice(0, 8)})`);
  L.push(`message   ${p.message.file}`);
  L.push(`subject   ${JSON.stringify(p.message.subject)}`);
  L.push(`mode      ${p.mode === 'index' ? 'INDEX (an untrack or a mode change, committed bare)' : 'pathspec (the working-tree content of the paths named)'}`);
  L.push(`paths     ${p.entries.length}`);
  for (const e of p.entries) L.push(`  ${e.state.padEnd(9)} ${e.path}`);
  if (p.otherStaged.length) L.push(`staged by somebody else, and NOT part of this commit: ${p.otherStaged.join(', ')}`);
  if (p.paths.some((x) => x.endsWith('.md'))) L.push('note      the pre-commit hook stamps .md files at commit time; the read-back tolerates the two stamp lines');
  L.push('', p.mode === 'index' ? '--- git diff --cached --stat --summary ---' : '--- git diff HEAD of the paths above ---', p.diff.replace(/\n$/, ''), '--- end of diff ---', '');
  L.push(`review token  ${p.token}`);
  L.push('Read the diff above. To commit exactly this and nothing else:', `  ${fmtCmd(p)}`);
  return L.join('\n') + '\n';
}

/** Throws unless the branch and HEAD are still what the plan was made against. */
function assertStill(ctx, p) {
  if (currentBranch(ctx.git, p.root) !== p.branch) throw new Refused(`the branch changed under the commit (it is no longer ${JSON.stringify(p.branch)}); nothing was committed`); // @guard:branch2
  if (headSha(ctx.git, p.root) !== p.head) throw new Refused('HEAD moved since the report (another commit landed); nothing was committed — run the report again'); // @guard:head
}

const checkRow = (name, ok, detail) => ({ name, ok, detail: ok ? undefined : detail });

function readBack(ctx, p, { added }) {
  const { git, root } = ctx;
  const checks = [];
  const sha = git(root, ['rev-parse', 'HEAD']).out.trim();
  const subject = git(root, ['log', '-1', '--format=%s']).out.replace(/\r?\n$/, '');
  checks.push(checkRow('subject', subject === p.message.subject, `HEAD's subject is ${JSON.stringify(subject)}, the message's is ${JSON.stringify(p.message.subject)}`)); // @guard:rb-subject
  const parent = git(root, ['rev-parse', 'HEAD^']).out.trim();
  checks.push(checkRow('parent', parent === p.head, `HEAD's parent is ${parent.slice(0, 8)}, the reviewed HEAD was ${p.head.slice(0, 8)}`));
  const changed = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', 'HEAD']).out.split('\0').filter(Boolean).sort();
  const named = p.paths.slice().sort();
  checks.push(checkRow('files', JSON.stringify(changed) === JSON.stringify(named), `the commit changed [${changed.join(', ')}] but the paths named are [${named.join(', ')}]`)); // @guard:rb-files
  if (p.mode === 'index') {
    const clean = git(root, ['diff', '--cached', '--quiet']);
    checks.push(checkRow('index clean', clean.status === 0, 'the index still differs from HEAD after the commit'));
    for (const e of p.entries) {
      const t = parseTreeZ(git(root, ['ls-tree', '-z', 'HEAD', '--', e.path]).out).get(e.path);
      if (e.state === 'untrack') checks.push(checkRow(`untracked ${e.path}`, !t, `${e.path} is still in HEAD`));
      else checks.push(checkRow(`mode ${e.path}`, !!t && t.mode === e.newMode, `${e.path} is mode ${t ? t.mode : '(absent)'} in HEAD, the reviewed mode was ${e.newMode}`));
    }
  } else {
    const st = git(root, ['status', '--porcelain=v1', '-z', '--no-renames', '-uall', '--', ...p.paths]);
    checks.push(checkRow('status clean', st.status === 0 && st.out === '', `git status still lists: ${st.out.split('\0').filter(Boolean).join(', ') || st.err.trim()}`)); // @guard:rb-clean
    const tree = parseTreeZ(git(root, ['ls-tree', '-z', 'HEAD', '--', ...p.paths]).out);
    for (const e of p.entries) {
      if (e.state === 'deleted') { checks.push(checkRow(`deleted ${e.path}`, !tree.has(e.path), `${e.path} is still in HEAD`)); continue; }
      const t = tree.get(e.path);
      if (t && t.sha === e.work) { checks.push(checkRow(`content ${e.path}`, true)); continue; }
      if (!t || e.binary) { checks.push(checkRow(`content ${e.path}`, false, `${e.path} in HEAD is not the blob that was reviewed`)); continue; }
      const have = new Set(lines(git(root, ['show', `HEAD:${e.path}`]).out));
      const missing = e.added.filter((l) => !isStampLine(l) /* @guard:rb-stamp */ && !have.has(l));
      checks.push(checkRow(`content ${e.path}`, missing.length === 0, `${missing.length} reviewed line(s) are missing from HEAD:${e.path}; the first is ${JSON.stringify(missing[0])}`)); // @guard:rb-content
    }
  }
  return { sha, subject, ok: checks.every((c) => c.ok), checks };
}

/**
 * A pathspec commit builds git's real index BEFORE the pre-commit hook runs, so a hook that restamps
 * a document (it does: the stamp is written at commit time) lands the stamp in the commit and the
 * working tree but leaves the index one stamp behind — `MM` in `git status`, and a later bare commit
 * would silently put the old stamp back. Measured 2026-10-09 against buses-data's own hook. buses-data
 * has a post-commit hook that resets exactly this; this does the same for a repository that has none,
 * and is a no-op where the hook ran. Where a named path is staged and its working-tree content already
 * EQUALS HEAD's, the staged entry is stale and is reset to HEAD; anything else is left alone for the
 * read-back to report.
 */
function refreshStaleIndex(ctx, p) {
  const st = ctx.git(p.root, ['status', '--porcelain=v1', '-z', '--no-renames', '-uall', '--', ...p.paths]);
  const stale = parseStatusZ(st.out).filter((r) => r.x !== ' ' && r.x !== '?' && r.x !== '!').map((r) => r.file)
    .filter((f) => ctx.git(p.root, ['diff', 'HEAD', '--quiet', '--', f]).status === 0);
  if (stale.length) ctx.git(p.root, ['reset', '--quiet', '--', ...stale]);
  return stale;
}

function applyPlan(o, deps, p) {
  const ctx = { git: deps.git, root: p.root };
  assertStill(ctx, p);
  let added = [];
  if (p.mode === 'index') {
    const again = ctx.git(p.root, ['diff', '--cached', '--raw', '-z', '--no-renames']);
    if (again.out !== p.raw) throw new Refused('the index changed between the report and the commit; nothing was committed'); // @guard:index-recheck
  } else {
    added = p.entries.filter((e) => e.state === 'new').map((e) => e.path);
    if (added.length) {
      const a = ctx.git(p.root, ['add', '--', ...added]);
      if (a.status !== 0) throw new Refused(`git add failed: ${a.err.trim()}`, 1);
    }
  }
  const argv = ['commit', '--quiet', '-F', p.message.file, ...(p.mode === 'index' ? [] : ['--', ...p.paths.map((x) => `:(literal)${x}`)])]; // @guard:pathspec @guard:commit-literal
  const c = ctx.git(p.root, argv);
  const hookOutput = `${c.out}${c.err}`.trim();
  if (c.status !== 0) {
    if (added.length) ctx.git(p.root, ['reset', '--quiet', '--', ...added]); // @guard:unstage
    if (/index\.lock/.test(c.err)) throw new Refused(`git's index is locked by another process (${c.err.trim().split('\n')[0]}); nothing was committed — try again`, 3); // @guard:lock
    return { ok: false, committed: false, refusedByGit: true, hookOutput, status: c.status };
  }
  const refreshed = p.mode === 'index' ? [] : refreshStaleIndex(ctx, p); // @guard:refresh
  const rb = readBack(ctx, p, { added });
  return { ok: rb.ok, committed: true, sha: rb.sha, subject: rb.subject, files: p.paths, checks: rb.checks, refreshed, hookOutput };
}

function resultText(p, r) {
  const L = [];
  if (!r.committed) {
    L.push(`commit_paths: the commit was REFUSED by git (exit ${r.status}) and nothing was committed${p.mode === 'index' ? '' : '; any path this run staged is unstaged again'}.`);
    if (r.hookOutput) L.push('--- git said ---', r.hookOutput, '--- end ---');
    return L.join('\n') + '\n';
  }
  if (!r.ok) L.push(`COMMITTED ${r.sha.slice(0, 8)} - READ-BACK FAILED`);
  else L.push(`commit_paths: committed ${r.sha.slice(0, 8)} ${JSON.stringify(r.subject)} — ${r.files.length} file(s), read back, not pushed`);
  for (const c of r.checks) L.push(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : ' — ' + c.detail}`);
  if (r.refreshed && r.refreshed.length) L.push(`  note  the hook restamped ${r.refreshed.join(', ')} after git built its index; the index entry was reset to HEAD so it is not left one stamp behind`);
  if (r.hookOutput) L.push('--- hook output ---', r.hookOutput, '--- end ---');
  if (!r.ok) L.push('The commit IS in the history; do not commit again. Look at `git show HEAD` and repair it by a new commit.');
  return L.join('\n') + '\n';
}

const USAGE = 'usage: node commit_paths.mjs --repo <repo> --branch <branch> --message-file <file> [--index] [--apply --reviewed <token>] [--json] -- <path> ...\n';

/** The whole program, with its edges injected; returns `{ code, stdout, stderr }` and never throws. */
export function main(argv, deps = {}) {
  const d = { git: deps.git || defaultGit, fsx: deps.fsx || realFs };
  let o = { json: argv.includes('--json') };
  try {
    o = parseCli(argv);
    if (o.help) return { code: 0, stdout: USAGE, stderr: '' };
    requireOptions(o);
    const p = plan(o, d);
    if (!o.apply) {
      return { code: 0, stdout: o.json ? JSON.stringify({ ok: true, mode: 'report', committed: false, token: p.token, branch: p.branch, head: p.head, subject: p.message.subject, paths: p.entries.map((e) => ({ path: e.path, state: e.state })), otherStaged: p.otherStaged, diff: p.diff }) + '\n' : reportText(p), stderr: '' };
    }
    if (o.reviewed !== p.token) throw new Refused(`what would land is not what was reviewed (the token is ${p.token}, not ${o.reviewed}): a path, the branch or the message changed since the report. Nothing was committed; run the report again and read the diff.`); // @guard:token
    const r = applyPlan(o, d, p);
    const code = r.ok ? 0 : 1;
    if (o.json) return { code, stdout: JSON.stringify({ ok: r.ok, mode: 'apply', committed: r.committed, sha: r.sha, subject: r.subject, files: r.files, checks: r.checks, refreshed: r.refreshed, hookOutput: r.hookOutput, token: p.token }) + '\n', stderr: '' };
    return { code, stdout: r.committed ? resultText(p, r) : '', stderr: r.committed ? '' : resultText(p, r) };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    if (o.json) return { code: e.code, stdout: JSON.stringify({ ok: false, committed: false, refused: e.message, code: e.code }) + '\n', stderr: '' };
    return { code: e.code, stdout: '', stderr: `commit_paths: REFUSED — ${e.message}\n${e.usage ? USAGE : ''}` };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = main(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
