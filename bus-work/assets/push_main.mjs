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
 *   5. push on exit 0 ONLY, and only the commit the preflight measured
 *      (`<sha>:main`); a `main` that moved while it ran waits for the next run
 *      (exit 3, head-moved). Then read origin back with ls-remote.
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
 * way of a rebase, main moved while the preflight ran) and the next run carries it.
 *
 * WHAT IT LEAVES BEHIND (buses-data OA-634). The scheduler's wrapper discards
 * stdout, and on 12 October a preflight that stayed red from 01:43 to 05:43
 * held local main back with nothing to say which arm was red. So every --apply
 * run appends its lines, a UTC stamp and its exit to `loop/push-main.log`
 * (gitignored), with the preflight's own report whenever it exited neither 0
 * nor 3. A red preflight on two consecutive runs that reached it writes ONE hold,
 * `loop/your-move/push-job-preflight-red.md`, naming the FAIL arms and the
 * oldest held commit; the streak lives in `loop/push-main.state.json`.
 *
 * ITS SECOND DUTY: KEEP THE ENGINE CHECKOUT CURRENT (buses-data, 2026-10-19).
 * The loop, worklist.mjs and status.js all run from C:\Buses\claude-skills, a
 * checkout nothing moved after a claude-skills pull request merged, and a tick
 * may not move it. On 2026-10-19 that had kept #383 (the S6 unattended recipe)
 * away from the loop for over a day, until a person pulled by hand. So every
 * --apply run, whatever the push did, fast-forwards the checkout THIS SCRIPT RUNS
 * FROM (`engineFastForward`) — and only fast-forwards: on main, nothing mid-
 * operation, no tracked edits, not diverged, the loop lock free. A diverged main
 * raises a hold at once; a checkout that stays behind for STUCK_RUNS_FOR_HOLD
 * runs in a row raises one. The checkout is the script's own because the
 * scheduler runs the engine's own copy, so the code that must be current is by
 * construction the code doing the asking; `--engine` overrides it for a test.
 * The step never changes this script's exit code, which stays the push's.
 *
 * Usage, from any folder. The one placeholder is the buses-data checkout whose
 * local main is to be carried, and it is REQUIRED, never defaulted, because a
 * job that guessed which tree to rebase could rebase somebody else's:
 *   node push_main.mjs --repo "<buses-data checkout>"            report only
 *   node push_main.mjs --repo "<buses-data checkout>" --apply    do it
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readLoopLock, fmtMin } from './loop_lock.mjs';
import { parseArgs } from './engine.mjs';

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
export const RED_HOLD_FILE = 'push-job-preflight-red.md';
export const LOG_FILE = 'push-main.log';
export const STATE_FILE = 'push-main.state.json';
/* Two reds in a row, not one: a single red can be a flaky arm the next hour
 * clears, and the job runs hourly, so a second is an hour's delay, not a day's. */
export const RED_RUNS_FOR_HOLD = 2;
/* The log is trimmed to its newest half past this, so an hourly job cannot grow
 * it without bound; a year of quiet runs is well under it. */
export const LOG_MAX_BYTES = 1024 * 1024;
/* Outcomes that answer "is the preflight red?" with a no, and so end a streak.
 * A lock held, a fetch failed or an unanswered preflight asked nothing about red. */
const STREAK_ENDERS = new Set(['pushed', 'nothing-to-push', 'deferred', 'head-moved']);

export const ENGINE_HOLD_FILE = 'engine-checkout-behind-origin.md';
export const ENGINE_STATE_FILE = 'engine-ff.state.json';
/* Six hourly runs: long enough that a person's half-hour on a branch in the
 * engine checkout never raises it, short enough that the loop's next tick after
 * a stuck morning hears of it rather than the next week. */
export const STUCK_RUNS_FOR_HOLD = 6;
const ENGINE_LEASE_MIN = 5;
/* Runs that end with the checkout at origin/main end a stuck streak; runs that
 * could not ask (lock held, fetch failed, not a checkout) leave it as it was. */
const ENGINE_CURRENT = new Set(['current', 'moved']);
const ENGINE_STUCK = new Set(['wrong-branch', 'mid-operation', 'diverged', 'dirty', 'ff-refused', 'not-read-back']);

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

function holderText(name, d, what = 'push_main.mjs carrying deferred commits to origin/main', leaseMin = LEASE_MIN) {
  const exp = new Date(d.getTime() + leaseMin * 60000);
  return `${name} ${d.toISOString()} ${what}\nexpires: ${exp.toISOString()}\n`;
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

/* The arms the preflight's report marks `[FAIL]`, by id and label. */
export function failedArms(report) {
  const arms = [];
  for (const line of String(report || '').split(/\r?\n/)) {
    const m = /^\s*\[FAIL\]\s+(.+?)(?:\s+\(\d+(?:\.\d+)?s\))?\s*$/.exec(line);
    if (m) arms.push(m[1]);
  }
  return arms;
}

function readState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

function appendLog(file, text) {
  appendFileSync(file, text, 'utf8');
  try {
    if (statSync(file).size > LOG_MAX_BYTES) {
      const all = readFileSync(file, 'utf8');
      const cut = all.indexOf('\n=== ', Math.floor(all.length / 2));
      writeFileSync(file, cut > 0 ? all.slice(cut + 1) : all.slice(Math.floor(all.length / 2)), 'utf8');
    }
  } catch { /* a trim that fails leaves a long log, never a lost run */ }
}

function writeRedHold(repo, name, d, state, arms, oldest, ahead) {
  const dir = path.join(repo, 'loop', 'your-move');
  const file = path.join(dir, RED_HOLD_FILE);
  if (existsSync(file)) return { file, written: false }; // one hold stands for as long as it is unanswered
  mkdirSync(dir, { recursive: true });
  const armList = arms.length ? arms.map((a) => `- ${a}`).join('\n') : '- (the report named no `[FAIL]` arm; read the log)';
  writeFileSync(file, [
    '# The push job\'s preflight has been red on consecutive runs, so local main is not reaching origin',
    '',
    `**Raised by:** ${name}, ${d.toISOString().slice(0, 10)}`,
    '',
    '## What is needed from you',
    '',
    `The hourly push job ran the preflight and got exit 1 (WOULD GO RED) on ${state.redRuns} consecutive runs since ${state.firstRedAt}, so it has pushed nothing, and ${ahead} commit${ahead === 1 ? '' : 's'} wait on local \`main\`, the oldest being \`${oldest || 'unknown'}\`. A session runs the push preflight by hand (claude-skills \`bus-work/assets/preflight.mjs\`, with \`--repo\` naming the buses-data checkout), fixes the red arm with a commit of its own, and deletes this file; the next push job run then carries everything.`,
    '',
    '## The red arms at the run that raised this',
    '',
    armList,
    '',
    `Every run's lines and the preflight's full report are in \`loop/${LOG_FILE}\` in the buses-data checkout, newest last.`,
    '',
  ].join('\n'), 'utf8');
  return { file, written: true };
}

/* Everything outside git is injected, so the harness drives the real git against
 * throwaway repositories with a stub preflight, a stub stamper and a fixed clock.
 * This outer layer only records: it runs the carry, then (with --apply) appends
 * the run to the log and keeps the red streak. */
export function pushMain(opts = {}) {
  const { repo, apply = false, now = () => new Date(), log = (s) => process.stdout.write(`push_main: ${s}\n`) } = opts;
  const lines = [];
  const res = pushMainOnce({ ...opts, log: (s) => { lines.push(s); log(s); } });
  if (!apply || !repo || !existsSync(path.join(repo, '.git'))) return res;
  try {
    const loopDir = path.join(repo, 'loop');
    mkdirSync(loopDir, { recursive: true });
    const t = now();
    const stateFile = path.join(loopDir, STATE_FILE);
    const prev = readState(stateFile);
    let state = { redRuns: prev.redRuns || 0, firstRedAt: prev.firstRedAt || null };
    if (res.outcome === 'preflight-red') {
      state = { redRuns: state.redRuns + 1, firstRedAt: state.firstRedAt || t.toISOString() };
    } else if (STREAK_ENDERS.has(res.outcome)) {
      state = { redRuns: 0, firstRedAt: null };
    }
    state.last = { at: t.toISOString(), exit: res.exit, outcome: res.outcome };
    if (res.outcome === 'preflight-red' && state.redRuns >= RED_RUNS_FOR_HOLD) {
      const oldest = git(repo, ['log', '--reverse', '--format=%h %s', 'origin/main..main']).out.split(/\r?\n/)[0] || '';
      const ahead = Number(git(repo, ['rev-list', '--count', 'origin/main..main']).out) || 0;
      const arms = failedArms(res.report);
      const h = writeRedHold(repo, `sched-push-${localHHMM(t)}`, t, state, arms, oldest, ahead);
      const said = h.written ? `wrote the hold ${h.file}` : `the hold ${h.file} already stands`;
      lines.push(`preflight red on ${state.redRuns} consecutive runs since ${state.firstRedAt}; ${said}`);
      log(lines[lines.length - 1]);
      res.hold = h.file;
    }
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    const block = [`=== ${t.toISOString()} exit ${res.exit} ${res.outcome}`, ...lines.map((l) => `  ${l}`)];
    if (res.preflightExit !== undefined && res.preflightExit !== 0 && res.preflightExit !== 3) {
      block.push('  --- the preflight\'s own report ---');
      block.push(...String(res.report || '(it printed nothing)').replace(/\s+$/, '').split(/\r?\n/).map((l) => `  | ${l}`));
    }
    appendLog(path.join(loopDir, LOG_FILE), `${block.join('\n')}\n`);
  } catch (e) {
    log(`could not record this run under loop/: ${e.message}`);
  }
  return res;
}

function pushMainOnce({
  repo,
  apply = false,
  preflight,                       // (repo) => exit status, or { status, report }, or null when it could not run
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

    // The commit the preflight is about to measure. Sessions do not take the loop
    // lock to commit, so `main` can move during the minutes the preflight runs;
    // the push sends THIS commit, and a move is waited out (buses-data, 2026-10-19).
    const measured = git(repo, ['rev-parse', 'main']).out;
    const answer = preflight(repo);
    const pf = answer !== null && typeof answer === 'object' ? answer.status : answer;
    const pfx = { preflightExit: pf, report: answer !== null && typeof answer === 'object' ? answer.report : undefined };
    if (pf === 3) {
      log('preflight: DEFERRED (inside the push interval); nothing pushed, the next run carries it');
      return res(EXIT_NOT_NOW, 'deferred', pfx);
    }
    if (pf !== 0) {
      const exit = pf === 1 ? EXIT_NO : EXIT_CANNOT_TELL;
      log(`preflight exited ${pf === null ? 'without an answer (timed out or did not start)' : pf}; nothing pushed`);
      return res(exit, pf === 1 ? 'preflight-red' : 'preflight-unanswered', pfx);
    }

    const tip = git(repo, ['rev-parse', 'main']).out;
    if (tip !== measured) {
      log(`main moved from ${measured.slice(0, 8)} to ${tip.slice(0, 8)} while the preflight ran, so its green is about a commit that is no longer the tip; nothing pushed, the next run measures and carries both`);
      return res(EXIT_NOT_NOW, 'head-moved', pfx);
    }
    const sending = Number(git(repo, ['rev-list', '--count', `origin/main..${measured}`]).out);
    const p = git(repo, ['push', 'origin', `${measured}:refs/heads/main`]);
    if (p.status !== 0) {
      log(`git push origin ${measured.slice(0, 8)}:main was refused: ${p.err}`);
      return res(EXIT_NO, 'push-refused');
    }
    // A stateful act is done when a read of the system says so, not when the push said ok.
    const remote = readRemote(repo);
    if (!remote || remote !== measured) {
      log(`push reported success but origin's main is ${remote || 'unreadable'} and the measured commit is ${measured}`);
      return res(EXIT_NO, 'not-read-back');
    }
    log(`pushed ${sending} local commit${sending === 1 ? '' : 's'}; origin/main is now ${measured.slice(0, 8)}, read back with ls-remote`);
    return res(EXIT_OK, 'pushed', { sha: measured });
  }
}

/* Bring the engine checkout to origin/main by fast-forward, or say why not.
 * `engine` is the claude-skills checkout; `repo` is the buses-data checkout,
 * which owns the loop lock, the log and loop/your-move/. Nothing here ever
 * merges, rebases, resets or checks out: the one write is `merge --ff-only`. */
export function engineFastForward(opts = {}) {
  const { repo, apply = false, now = () => new Date(), log = (s) => process.stdout.write(`push_main: engine: ${s}\n`) } = opts;
  const lines = [];
  const res = engineFastForwardOnce({ ...opts, log: (s) => { lines.push(s); log(s); } });
  if (!apply || !repo || !existsSync(path.join(repo, '.git'))) return res;
  try {
    const loopDir = path.join(repo, 'loop');
    mkdirSync(loopDir, { recursive: true });
    const t = now();
    const stateFile = path.join(loopDir, ENGINE_STATE_FILE);
    const prev = readState(stateFile);
    let state = { stuckRuns: prev.stuckRuns || 0, firstStuckAt: prev.firstStuckAt || null };
    if (ENGINE_STUCK.has(res.outcome)) state = { stuckRuns: state.stuckRuns + 1, firstStuckAt: state.firstStuckAt || t.toISOString() };
    else if (ENGINE_CURRENT.has(res.outcome)) state = { stuckRuns: 0, firstStuckAt: null };
    state.last = { at: t.toISOString(), outcome: res.outcome, behind: res.behind ?? null };
    if (res.outcome === 'diverged' || (ENGINE_STUCK.has(res.outcome) && state.stuckRuns >= STUCK_RUNS_FOR_HOLD)) {
      const h = writeEngineHold(repo, opts.engine, `sched-push-${localHHMM(t)}`, t, state, res);
      lines.push(h.written ? `wrote the hold ${h.file}` : `the hold ${h.file} already stands`);
      log(lines[lines.length - 1]);
      res.hold = h.file;
    }
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    appendLog(path.join(loopDir, LOG_FILE), `${[`=== ${t.toISOString()} engine ${res.outcome}`, ...lines.map((l) => `  ${l}`)].join('\n')}\n`);
  } catch (e) {
    log(`could not record the engine step under loop/: ${e.message}`);
  }
  return res;
}

function engineFastForwardOnce({ engine, repo, apply = false, now = () => new Date(), log }) {
  const res = (outcome, extra = {}) => ({ outcome, ...extra });
  if (!engine || !existsSync(path.join(engine, '.git'))) {
    log(`${engine} is not a git checkout`);
    return res('not-a-repo');
  }
  if (apply) {
    const f = git(engine, ['fetch', 'origin']);
    if (f.status !== 0) { log(`git fetch origin failed: ${f.err}`); return res('fetch-failed'); }
  }
  const behind = Number(git(engine, ['rev-list', '--count', 'main..origin/main']).out);
  const ahead = Number(git(engine, ['rev-list', '--count', 'origin/main..main']).out);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead) || git(engine, ['rev-parse', '--verify', '-q', 'origin/main']).status !== 0) {
    log('could not compare main with origin/main (no origin/main ref?)');
    return res('no-origin-ref');
  }
  const waiting = () => git(engine, ['log', '--format=%h %s', 'main..origin/main']).out.split(/\r?\n/).filter(Boolean);
  const branch = git(engine, ['branch', '--show-current']).out;
  if (branch !== 'main') {
    log(`the checkout is on "${branch || 'a detached HEAD'}", not main, so the loop is running that and not main; ${behind} commit${behind === 1 ? '' : 's'} on origin/main wait`);
    return res('wrong-branch', { behind, waiting: waiting(), branch });
  }
  const gitDir = path.resolve(engine, git(engine, ['rev-parse', '--git-dir']).out);
  for (const mid of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']) {
    if (existsSync(path.join(gitDir, mid))) {
      log(`a ${mid} is in progress in the checkout, which is somebody's work; not moved`);
      return res('mid-operation', { behind, waiting: waiting() });
    }
  }
  if (ahead > 0) {
    log(`local main has ${ahead} commit${ahead === 1 ? '' : 's'} origin/main lacks, so it cannot fast-forward; a person decides what they are`);
    return res('diverged', { behind, ahead, waiting: waiting() });
  }
  if (behind === 0) { log(`main is at origin/main (${git(engine, ['rev-parse', '--short', 'main']).out})`); return res('current', { behind }); }
  if (!apply) {
    log(`main is ${behind} commit${behind === 1 ? '' : 's'} behind origin/main as last fetched; --apply would fetch and fast-forward it`);
    return res('dry-run', { behind });
  }
  const dirty = git(engine, ['status', '--porcelain', '--untracked-files=no']).out;
  if (dirty) {
    log(`main is ${behind} behind and the checkout has tracked changes that are not committed, which are a person's; not moved`);
    return res('dirty', { behind, waiting: waiting() });
  }

  // The loop lock: a tick mid-run is reading engine scripts, and the code under it must not change.
  const t0 = now();
  const name = `sched-push-${localHHMM(t0)}`;
  const lockDir = path.join(repo, 'loop', 'LOCK.d');
  const L = readLoopLock(repo, { now: t0.getTime() });
  if (L.present) {
    log(`loop/LOCK.d is held by ${L.name || 'an unnamed holder'}, so a run may be reading the engine; main stays ${behind} behind until the next run`);
    return res('lock-held', { behind });
  }
  mkdirSync(path.join(repo, 'loop'), { recursive: true });
  try { mkdirSync(lockDir); } catch { log('loop/LOCK.d was taken a moment ago; standing down'); return res('lock-held', { behind }); }
  writeFileSync(path.join(lockDir, 'holder'), holderText(name, t0, 'push_main.mjs fast-forwarding the engine checkout', ENGINE_LEASE_MIN), 'utf8');
  try {
    const was = git(engine, ['rev-parse', '--short', 'main']).out;
    const m = git(engine, ['merge', '--ff-only', 'origin/main']);
    if (m.status !== 0) {
      log(`git merge --ff-only origin/main was refused: ${(m.err || m.out).split(/\r?\n/).slice(0, 4).join(' / ')}`);
      return res('ff-refused', { behind, waiting: waiting() });
    }
    // Done when a read of the checkout says so, not when merge said ok.
    const head = git(engine, ['rev-parse', 'HEAD']).out;
    const target = git(engine, ['rev-parse', 'origin/main']).out;
    if (!head || head !== target) {
      log(`merge reported success but HEAD is ${head || 'unreadable'} and origin/main is ${target}`);
      return res('not-read-back', { behind });
    }
    log(`fast-forwarded main ${was}..${head.slice(0, 7)} (${behind} commit${behind === 1 ? '' : 's'}), read back: HEAD = origin/main`);
    return res('moved', { behind, sha: head });
  } finally {
    try {
      const first = readFileSync(path.join(lockDir, 'holder'), 'utf8').split(/\r?\n/)[0] || '';
      if (first.startsWith(name)) rmSync(lockDir, { recursive: true, force: true });
      else log(`the lock no longer names ${name}; left it alone`);
    } catch { /* already gone */ }
  }
}

function writeEngineHold(repo, engine, name, d, state, r) {
  const dir = path.join(repo, 'loop', 'your-move');
  const file = path.join(dir, ENGINE_HOLD_FILE);
  if (existsSync(file)) return { file, written: false }; // one hold stands for as long as it is unanswered
  mkdirSync(dir, { recursive: true });
  const eng = String(engine || '').replace(/\\/g, '/');
  const why = {
    'wrong-branch': `it is on \`${r.branch || 'a detached HEAD'}\`, not \`main\`, so the loop is running that branch's code`,
    'mid-operation': 'a rebase, merge or cherry-pick is left in progress in it',
    diverged: `its local \`main\` has ${r.ahead} commit${r.ahead === 1 ? '' : 's'} that origin does not, so it cannot fast-forward`,
    dirty: 'it has tracked changes that are not committed',
    'ff-refused': '`git merge --ff-only origin/main` refused (the log has git\'s words; usually an untracked file in the way)',
    'not-read-back': 'a fast-forward reported success and HEAD did not read back equal to origin/main',
  }[r.outcome] || r.outcome;
  const list = (r.waiting || []).slice(0, 15).map((l) => `- \`${l}\``).join('\n') || '- (none listed)';
  writeFileSync(file, [
    '# The engine checkout is behind origin and the push job cannot fast-forward it',
    '',
    `**Raised by:** ${name}, ${d.toISOString().slice(0, 10)}`,
    '',
    '## What is needed from you',
    '',
    `The hourly push job fast-forwards \`${eng}\` to \`origin/main\` after every claude-skills merge, and it could not, because ${why}. ${r.outcome === 'diverged' ? 'It said so on its first sight of it' : `It has failed on ${state.stuckRuns} runs in a row since ${state.firstStuckAt}`}, and until it is moved the loop, \`worklist.mjs\` and \`status.js\` read the old engine. A session puts the checkout back on a clean \`main\` with nothing of its own (keeping any work on a branch), and the next push job run fast-forwards it; the session may instead run, once it is clean and on \`main\`:`,
    '',
    '```bash',
    `git -C "${eng}" merge --ff-only origin/main`,
    '```',
    '',
    'There are no placeholders in it. This hold is satisfied once `git -C "' + eng + '" rev-list --count main..origin/main` prints 0 after a fetch.',
    '',
    `## The ${r.behind ?? '?'} commit${r.behind === 1 ? '' : 's'} on origin/main the loop is not running`,
    '',
    list,
    '',
    `Every run's engine line is in \`loop/${LOG_FILE}\` in the buses-data checkout, newest last.`,
    '',
  ].join('\n'), 'utf8');
  return { file, written: true };
}

/* The real preflight and the real stamper, each by status with no shell and no pipe.
 * The preflight's output is captured as well as passed through, so a red run's
 * report reaches the log; its status is still read from spawnSync, never a pipe. */
export function realPreflight(preflightScript = path.join(HERE, 'preflight.mjs')) {
  return (repo) => {
    const r = spawnSync(process.execPath, [preflightScript, '--repo', repo], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: PREFLIGHT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
    });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    const report = [r.stdout, r.stderr].filter(Boolean).join('\n') + (r.error ? `\n(${r.error.code || r.error.message})` : '');
    return { status: r.status, report };
  };
}
export function realDocstamp(script = path.resolve(HERE, '..', '..', 'stamp-docs', 'scripts', 'docstamp.py')) {
  return (repo) => {
    const r = spawnSync('python', [script, '--checkout', repo], { stdio: 'inherit' });
    return r.status === null ? 2 : r.status;
  };
}

function main(flags) {
  const usage = 'usage: node push_main.mjs --repo "<buses-data checkout>" [--apply] [--engine "<claude-skills checkout>"]\n';
  const unknown = Object.keys(flags).filter((k) => k !== '_' && k !== 'repo' && k !== 'apply' && k !== 'engine');
  if (unknown.length || (Array.isArray(flags._) && flags._.length)) {
    process.stderr.write(`push_main: unknown argument ${unknown.length ? '--' + unknown[0] : flags._[0]}\n${usage}`);
    return EXIT_CANNOT_TELL;
  }
  if (flags.apply !== undefined && flags.apply !== true) { process.stderr.write(`push_main: --apply takes no value\n${usage}`); return EXIT_CANNOT_TELL; }
  if (flags.repo === true) { process.stderr.write('push_main: --repo needs a folder\n'); return EXIT_CANNOT_TELL; }
  const apply = flags.apply === true;
  const repo = typeof flags.repo === 'string' ? flags.repo : null;
  if (!repo) {
    process.stderr.write('push_main: --repo "<buses-data checkout>" is required\n');
    return EXIT_CANNOT_TELL;
  }
  if (flags.engine === true) { process.stderr.write('push_main: --engine needs a folder\n'); return EXIT_CANNOT_TELL; }
  const exit = pushMain({ repo: path.resolve(repo), apply, preflight: realPreflight(), docstamp: realDocstamp() }).exit;
  // The engine step runs whatever the push did, and never changes the exit code.
  const engine = typeof flags.engine === 'string' ? path.resolve(flags.engine) : git(HERE, ['rev-parse', '--show-toplevel']).out;
  try { engineFastForward({ engine, repo: path.resolve(repo), apply }); } catch (e) { process.stderr.write(`push_main: engine step failed: ${e.message}\n`); }
  return exit;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // process.exitCode, not process.exit(): a write to a pipe is asynchronous on Windows.
  process.exitCode = main(parseArgs(process.argv.slice(2)));
}
