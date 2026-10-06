#!/usr/bin/env node
/* push_main.mjs — carry buses-data's local `main` to origin, with no model in
 * the loop. The scheduled tick's step 8 used to be the only thing that did this.
 *
 * WHY IT EXISTS. `preflight.mjs` exits 3 (DEFERRED) when the last push-triggered
 * `gates.yml` run started inside the push interval, and a session that gets 3
 * leaves its commits on local `main` for "the hourly tick" to push. That made the
 * hourly tick the push scheduler by accident. Cutting the loop to three ticks a
 * day (the 6 October simplification review, B1/B2) would have turned a wait of
 * one interval into a wait of one tick, up to about eight hours, with local
 * `main` the only copy of the commits and `.git` outside the backup. Pushing
 * needs no model, so it moves here, and the tick's cadence stops mattering to it.
 *
 * WHAT IT DOES, in step 8's own order, and stops at the first refusal:
 *   1. nothing ahead of origin/main -> exit 0, no lock, no fetch, no preflight;
 *   2. take `loop/LOCK.d` (named sched-push-HHMM, so a later tick may steal it
 *      once its lease has run out, and nobody else may before) or stand down;
 *   3. fetch; if main is behind origin/main, rebase onto it (a conflict aborts
 *      the rebase and writes a hold to loop/your-move/), then run docstamp.py
 *      because a rebase runs no hook, and commit what it wrote by pathspec;
 *   4. run preflight.mjs, its status read straight from spawnSync, never piped;
 *   5. push `origin main` on exit 0 ONLY, then read origin back with ls-remote.
 *
 * WHAT IT NEVER DOES. It never passes `--urgent` (that is for a red main or a
 * cross-repository pairing, and it is a person's call); it never rebases over
 * tracked changes a person has not committed; it never steals a lock that a
 * person's session holds; and it never pushes any branch but main.
 *
 * Exit codes (README - Conventions.md): 0 pushed, or nothing to push, or the
 * dry run's report; 1 the answer is no (preflight red, a conflict, a push
 * refused or not read back); 2 cannot tell or used wrongly (wrong branch, a
 * rebase already in progress, preflight could not answer, fetch failed);
 * 3 not now (inside the push interval, the lock held, tracked changes in the
 * way of a rebase) and the next run carries it.
 *
 * Usage, from any folder. The one placeholder is the buses-data checkout whose
 * local main is to be carried, and it is REQUIRED, never defaulted, because a
 * job that guessed which tree to rebase could rebase somebody else's:
 *   node push_main.mjs --repo "<buses-data checkout>"            report only
 *   node push_main.mjs --repo "<buses-data checkout>" --apply    do it
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readLoopLock, fmtMin } from './loop_lock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const EXIT_OK = 0;
export const EXIT_NO = 1;
export const EXIT_CANNOT_TELL = 2;
export const EXIT_NOT_NOW = 3;

/* Longer than the preflight's own 600000 ms ceiling plus a rebase and a stamp,
 * and far inside loop_lock's four-hour maximum. A crashed job's lock is stolen
 * by the first tick after this, because the name starts `sched-`. */
export const LEASE_MIN = 40;
export const PREFLIGHT_TIMEOUT_MS = 600000;

const HOLD_FILE = 'push-job-rebase-conflict.md';

function git(repo, args, opts = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', input: opts.input, maxBuffer: 64 * 1024 * 1024 });
  // `raw` keeps leading whitespace: porcelain's " M file" starts with a space that
  // a plain trim() eats, which turns the path into "file" minus its first letter.
  const out = r.stdout || '';
  return { status: r.status, out: opts.raw ? out.replace(/\s+$/, '') : out.trim(), err: (r.stderr || '').trim() };
}

function pad(n) { return String(n).padStart(2, '0'); }

/* The same local-clock HHMM the loop's run files use, so a lock and a run file
 * from one moment carry one name. */
function localHHMM(d) { return `${pad(d.getHours())}${pad(d.getMinutes())}`; }

function holderText(name, d) {
  const exp = new Date(d.getTime() + LEASE_MIN * 60000);
  return `${name} ${d.toISOString()} push_main.mjs carrying deferred commits to origin/main\nexpires: ${exp.toISOString()}\n`;
}

function writeHold(repo, name, d, why, files) {
  const dir = path.join(repo, 'loop', 'your-move');
  const file = path.join(dir, HOLD_FILE);
  if (existsSync(file)) return file; // one hold stands for as long as it is unanswered
  mkdirSync(dir, { recursive: true });
  const list = files.length ? files.map((f) => `- \`${f}\``).join('\n') : '- (git named no file)';
  const iso = d.toISOString().slice(0, 10);
  writeFileSync(file, [
    '# The push job cannot rebase local main onto origin/main',
    '',
    `**Raised by:** ${name}, ${iso}`,
    '',
    '## What is needed from you',
    '',
    'Local `main` holds commits that are not on origin, and origin has commits that local `main` lacks, and the two touch the same lines, so the push job aborted its rebase and pushed nothing. Rebase `main` onto `origin/main` by hand in the buses-data checkout, resolve the files below, and the next push job run will carry the result; delete this file once it has.',
    '',
    '## What git said',
    '',
    why ? '```\n' + why + '\n```' : 'Nothing.',
    '',
    'Conflicting files:',
    '',
    list,
    '',
  ].join('\n'), 'utf8');
  return file;
}

/* Everything outside git is injected, so the harness drives the real git against
 * throwaway repositories with a stub preflight, a stub stamper and a fixed clock. */
export function pushMain({
  repo,
  apply = false,
  preflight,                       // (repo) => exit status, or null when it could not run
  docstamp,                        // (repo) => exit status
  readRemote = (repo) => git(repo, ['ls-remote', 'origin', 'refs/heads/main']).out.split(/\s+/)[0],
  now = () => new Date(),
  log = (s) => process.stdout.write(`push_main: ${s}\n`),
} = {}) {
  const res = (exit, outcome, extra = {}) => ({ exit, outcome, ...extra });

  if (!repo || !existsSync(path.join(repo, '.git'))) {
    log(`${repo} is not a git checkout`);
    return res(EXIT_CANNOT_TELL, 'not-a-repo');
  }
  const branch = git(repo, ['branch', '--show-current']).out;
  if (branch !== 'main') {
    log(`the checkout is on "${branch || 'a detached HEAD'}", not main; nothing pushed`);
    return res(EXIT_CANNOT_TELL, 'wrong-branch');
  }
  const gitDir = path.resolve(repo, git(repo, ['rev-parse', '--git-dir']).out);
  for (const mid of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']) {
    if (existsSync(path.join(gitDir, mid))) {
      log(`a ${mid} is in progress in the checkout, which is somebody's work; nothing touched`);
      return res(EXIT_CANNOT_TELL, 'mid-operation');
    }
  }

  const ahead0 = Number(git(repo, ['rev-list', '--count', 'origin/main..main']).out);
  if (!Number.isFinite(ahead0)) {
    log('could not count commits ahead of origin/main (no origin/main ref?)');
    return res(EXIT_CANNOT_TELL, 'no-origin-ref');
  }
  if (ahead0 === 0) {
    log('nothing ahead of origin/main; nothing to push');
    return res(EXIT_OK, 'nothing-to-push');
  }

  const t0 = now();
  const name = `sched-push-${localHHMM(t0)}`;
  const lockDir = path.join(repo, 'loop', 'LOCK.d');
  const L = readLoopLock(repo, { now: t0.getTime() });
  if (!apply) {
    log(`${ahead0} commit${ahead0 === 1 ? '' : 's'} ahead of origin/main; the lock is ${L.present ? `held by ${L.name || 'an unnamed holder'}${L.expired ? ' (lease over)' : ''}` : 'free'}; --apply would fetch, rebase if behind, run the preflight and push on exit 0`);
    return res(EXIT_OK, 'dry-run', { ahead: ahead0 });
  }

  // 2. the lock.
  if (L.present) {
    if (!(L.expired && L.isTick)) {
      log(`loop/LOCK.d is held by ${L.name || 'an unnamed holder'}${L.expired ? ' and its lease is over, but it is not a tick of the loop, so it is not mine to steal' : `, lease live for ${fmtMin(L.remainMin)} more`}; the ${ahead0} commit${ahead0 === 1 ? '' : 's'} wait for the next run`);
      return res(EXIT_NOT_NOW, 'lock-held');
    }
    log(`loop/LOCK.d belonged to ${L.name} and its lease ran out ${fmtMin(L.overdueMin)} ago; stealing it`);
    rmSync(lockDir, { recursive: true, force: true });
  }
  mkdirSync(path.join(repo, 'loop'), { recursive: true });
  try { mkdirSync(lockDir); } catch { // somebody took it between the read and the mkdir
    log('loop/LOCK.d was taken a moment ago; standing down');
    return res(EXIT_NOT_NOW, 'lock-raced');
  }
  writeFileSync(path.join(lockDir, 'holder'), holderText(name, t0), 'utf8');

  try {
    return carry();
  } finally {
    // Release only what is still ours: a holder that no longer names this run was
    // stolen, and removing it would free a lock somebody else is using.
    try {
      const first = readFileSync(path.join(lockDir, 'holder'), 'utf8').split(/\r?\n/)[0] || '';
      if (first.startsWith(name)) rmSync(lockDir, { recursive: true, force: true });
      else log(`the lock no longer names ${name}; left it alone`);
    } catch { /* already gone */ }
  }

  function carry() {
    const f = git(repo, ['fetch', 'origin']);
    if (f.status !== 0) {
      log(`git fetch origin failed: ${f.err}`);
      return res(EXIT_CANNOT_TELL, 'fetch-failed');
    }
    const behind = Number(git(repo, ['rev-list', '--count', 'main..origin/main']).out);
    if (behind > 0) {
      const dirty = git(repo, ['status', '--porcelain', '--untracked-files=no']).out;
      if (dirty) {
        log(`origin/main is ${behind} commit${behind === 1 ? '' : 's'} ahead and the checkout has tracked changes that are not committed, so a rebase would move a person's work; the commits wait`);
        return res(EXIT_NOT_NOW, 'dirty-and-behind');
      }
      const rb = git(repo, ['rebase', 'origin/main']);
      if (rb.status !== 0) {
        const files = git(repo, ['diff', '--name-only', '--diff-filter=U']).out.split(/\r?\n/).filter(Boolean);
        git(repo, ['rebase', '--abort']);
        const hold = writeHold(repo, name, t0, (rb.out + '\n' + rb.err).trim().slice(0, 1500), files);
        log(`rebase onto origin/main conflicted (${files.join(', ') || 'no file named'}); aborted, nothing lost, hold at ${hold}`);
        return res(EXIT_NO, 'rebase-conflict', { hold });
      }
      // A rebase runs no hook, so the stamps are re-checked here (step 8's own rule).
      const before = new Set(git(repo, ['status', '--porcelain', '--untracked-files=no'], { raw: true }).out.split(/\r?\n/).filter(Boolean));
      const ds = docstamp(repo);
      if (ds !== 0) log(`docstamp exited ${ds}; the preflight below decides whether that matters`);
      const after = git(repo, ['status', '--porcelain', '--untracked-files=no'], { raw: true }).out.split(/\r?\n/).filter(Boolean);
      const wrote = after.filter((l) => !before.has(l)).map((l) => l.slice(3).replace(/^"|"$/g, ''));
      if (wrote.length) {
        const heads = git(repo, ['log', '--format=%s', 'origin/main..main']).out.split(/\r?\n/);
        const prefix = heads.some((s) => s.startsWith('[expected-red]')) ? '[expected-red] ' : '';
        const subject = `${prefix}Stamps: re-stamp after the rebase onto ${git(repo, ['rev-parse', '--short', 'origin/main']).out}`;
        const c = git(repo, ['commit', '-F', '-', '--', ...wrote], { input: `${subject}\n\nWritten by push_main.mjs: a rebase runs no hook, so docstamp.py was run over the checkout and what it wrote is committed here by pathspec.\n` });
        if (c.status !== 0) {
          log(`the stamp commit was refused: ${c.err || c.out}`);
          return res(EXIT_NO, 'stamp-commit-refused');
        }
        log(`committed ${wrote.length} re-stamped file${wrote.length === 1 ? '' : 's'}: ${subject}`);
      }
    }

    const pf = preflight(repo);
    if (pf === 3) {
      log('preflight: DEFERRED (inside the push interval); nothing pushed, the next run carries it');
      return res(EXIT_NOT_NOW, 'deferred');
    }
    if (pf !== 0) {
      const exit = pf === 1 ? EXIT_NO : EXIT_CANNOT_TELL;
      log(`preflight exited ${pf === null ? 'without an answer (timed out or did not start)' : pf}; nothing pushed`);
      return res(exit, pf === 1 ? 'preflight-red' : 'preflight-unanswered');
    }

    const sending = Number(git(repo, ['rev-list', '--count', 'origin/main..main']).out);
    const p = git(repo, ['push', 'origin', 'main']);
    if (p.status !== 0) {
      log(`git push origin main was refused: ${p.err}`);
      return res(EXIT_NO, 'push-refused');
    }
    // A stateful act is done when a read of the system says so, not when the push said ok.
    const remote = readRemote(repo);
    const local = git(repo, ['rev-parse', 'main']).out;
    if (!remote || remote !== local) {
      log(`push reported success but origin's main is ${remote || 'unreadable'} and local main is ${local}`);
      return res(EXIT_NO, 'not-read-back');
    }
    log(`pushed ${sending} local commit${sending === 1 ? '' : 's'}; origin/main is now ${local.slice(0, 8)}, read back with ls-remote`);
    return res(EXIT_OK, 'pushed', { sha: local });
  }
}

/* The real preflight and the real stamper, each by status with no shell and no pipe. */
export function realPreflight(preflightScript = path.join(HERE, 'preflight.mjs')) {
  return (repo) => {
    const r = spawnSync(process.execPath, [preflightScript, '--repo', repo], { stdio: 'inherit', timeout: PREFLIGHT_TIMEOUT_MS });
    return r.status;
  };
}
export function realDocstamp(script = path.resolve(HERE, '..', '..', 'stamp-docs', 'scripts', 'docstamp.py')) {
  return (repo) => {
    const r = spawnSync('python', [script, '--checkout', repo], { stdio: 'inherit' });
    return r.status === null ? 2 : r.status;
  };
}

function main(argv) {
  const known = new Set(['--repo', '--apply']);
  let repo = null; let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!known.has(a)) { process.stderr.write(`push_main: unknown argument ${a}\nusage: node push_main.mjs [--repo DIR] [--apply]\n`); return EXIT_CANNOT_TELL; }
    if (a === '--apply') apply = true;
    else { repo = argv[++i]; if (!repo) { process.stderr.write('push_main: --repo needs a folder\n'); return EXIT_CANNOT_TELL; } }
  }
  if (!repo) {
    process.stderr.write('push_main: --repo "<buses-data checkout>" is required\n');
    return EXIT_CANNOT_TELL;
  }
  return pushMain({ repo: path.resolve(repo), apply, preflight: realPreflight(), docstamp: realDocstamp() }).exit;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // process.exitCode, not process.exit(): a write to a pipe is asynchronous on Windows.
  process.exitCode = main(process.argv.slice(2));
}
