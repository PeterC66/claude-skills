#!/usr/bin/env node
/*
 * pr_train.mjs — moves claude-skills' auto-merge queue along, one pull request
 * at a time, AS THE PERSON RUNNING IT (2026-09-27).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), with `gh`
 * logged in as PeterC66:
 *
 *   node pr_train.mjs                   report what it would do, change nothing
 *   node pr_train.mjs --apply           update the oldest waiting PR, once
 *   node pr_train.mjs --apply --watch   keep doing that until the queue is empty
 *
 * Flags: `--repo <owner/name>` (default PeterC66/claude-skills); `--max-minutes
 * <n>` caps `--watch` (default 120); `--interval <seconds>` sets its poll
 * (default 60). Exit 0 when it worked or had nothing to do, 1 when `gh` failed,
 * 2 for a bad flag.
 *
 * WHY THIS IS A LOCAL SCRIPT AND NOT A WORKFLOW. It replaced
 * `.github/workflows/pr-train.yml`, which lived for one afternoon. `main` is
 * protected in strict mode, so every merge leaves every other open pull request
 * BEHIND, and GitHub's auto-merge waits rather than updating one. The workflow
 * updated the branch with its own token and then dispatched the gates, on the
 * belief that a bot's branch update triggers no `pull_request` run. It does:
 * GitHub creates the run and HOLDS it — "1 workflow awaiting approval" — until
 * a maintainer approves it. On #190 the dispatched gates went green on the tip
 * (`unit` and `status`, 828a490) and the pull request still read BLOCKED with
 * an empty checks list for a quarter of an hour; three updates, no merge. A
 * held run cannot be cleared without a person's approval, and approving CI on
 * somebody's behalf is not a thing a robot should do. An update made with
 * Peter's own credentials triggers an ordinary `pull_request` run that needs
 * no approval and needs no dispatch, which is why this runs on the laptop.
 *
 * WHAT IT DOES, EACH PASS: among the open pull requests with auto-merge ON, if
 * one is already on its way (up to date and its checks running, or up to date
 * and green and about to merge) it does nothing. Otherwise it updates the
 * OLDEST one that is behind and whose checks have not failed. One at a time on
 * purpose: updating them all together makes the first to go green merge and
 * leaves the rest behind again, each having paid a full run for nothing.
 *
 * WHAT IT LEAVES ALONE: a pull request without auto-merge, a draft, one whose
 * checks failed, and one that conflicts with `main`. It never resolves a
 * conflict, never approves a run and never merges — GitHub's auto-merge does
 * that, on green. An up-to-date pull request with NO checks at all is named
 * and left: that is what a held run looks like, and it wants a person.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FAILED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

/* PURE. Takes `gh pr list --json number,headRefName,headRefOid,mergeStateStatus,
 * autoMergeRequest,isDraft,statusCheckRollup` and says what one pass should do.
 * Returns { action: 'none'|'wait'|'stuck'|'update', pr?, why, warnings[] }. */
export function decideTrain(prs) {
  const queue = prs
    .filter((p) => p.autoMergeRequest != null && !p.isDraft)
    .map((p) => {
      const rollup = p.statusCheckRollup || [];
      return {
        ...p,
        checks: rollup.length,
        pending: rollup.some((c) => (c.status || 'COMPLETED') !== 'COMPLETED' || c.state === 'PENDING'),
        failed: rollup.some((c) => FAILED.has(c.conclusion || c.state || '')),
      };
    })
    .sort((a, b) => a.number - b.number);

  const warnings = [];
  for (const p of queue) {
    if (p.mergeStateStatus === 'DIRTY') warnings.push(`#${p.number} conflicts with main; skipped until a session rebases it`);
    else if (p.failed) warnings.push(`#${p.number} has failed checks; skipped until a session fixes it`);
  }
  if (!queue.length) return { action: 'none', why: 'no open pull request has auto-merge on', warnings };

  const live = (p) => p.mergeStateStatus !== 'BEHIND' && p.mergeStateStatus !== 'DIRTY' && !p.failed;
  const onway = queue.find((p) => live(p) && (p.pending || p.mergeStateStatus === 'CLEAN'));
  if (onway) return { action: 'wait', pr: onway, why: `#${onway.number} is already on its way`, warnings };

  const stuck = queue.find((p) => live(p) && p.checks === 0);
  if (stuck) {
    warnings.push(`#${stuck.number} is up to date with NO checks — most likely a run held for approval; open it on GitHub, or push to the branch, to start its gates as a person`);
  }

  const next = queue.find((p) => p.mergeStateStatus === 'BEHIND' && !p.failed);
  if (next) return { action: 'update', pr: next, why: `#${next.number} is the oldest waiting pull request behind main`, warnings };
  if (stuck) return { action: 'stuck', pr: stuck, why: `#${stuck.number} has no checks and nothing else is waiting`, warnings };
  return { action: 'none', why: 'nothing is waiting', warnings };
}

/* ---- the half that touches GitHub; runs only when this file is EXECUTED ---- */

function parseArgs(argv) {
  const a = { repo: 'PeterC66/claude-skills', apply: false, watch: false, maxMinutes: 120, interval: 60 };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--apply') a.apply = true;
    else if (f === '--watch') a.watch = true;
    else if (f === '--repo') a.repo = argv[++i];
    else if (f === '--max-minutes') a.maxMinutes = Number(argv[++i]);
    else if (f === '--interval') a.interval = Number(argv[++i]);
    else { console.error(`pr_train: unknown flag ${f}`); process.exit(2); }
  }
  if (!a.repo || !(a.maxMinutes > 0) || !(a.interval > 0)) { console.error('pr_train: --repo, --max-minutes and --interval need a value'); process.exit(2); }
  if (a.watch && !a.apply) { console.error('pr_train: --watch acts, so it needs --apply'); process.exit(2); }
  return a;
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listPrs(repo) {
  const read = () => JSON.parse(gh(['pr', 'list', '--repo', repo, '--state', 'open', '--base', 'main', '--limit', '100',
    '--json', 'number,headRefName,headRefOid,mergeStateStatus,autoMergeRequest,isDraft,statusCheckRollup']));
  // GitHub computes mergeStateStatus lazily, and just after a push to main it reads UNKNOWN.
  let prs = read();
  for (let i = 0; i < 6 && prs.some((p) => p.mergeStateStatus === 'UNKNOWN'); i++) { await sleep(10000); prs = read(); }
  return prs;
}

async function pass(a) {
  const d = decideTrain(await listPrs(a.repo));
  for (const w of d.warnings) console.error(`warning: ${w}`);
  console.log(`${d.action}: ${d.why}`);
  if (d.action !== 'update' || !a.apply) return d;

  const { number: n, headRefOid: old } = d.pr;
  try {
    gh(['api', '-X', 'PUT', `repos/${a.repo}/pulls/${n}/update-branch`, '-f', `expected_head_sha=${old}`]);
  } catch (e) {
    console.error(`warning: #${n} could not be updated (most likely a conflict with main): ${String(e.stderr || e.message).trim()}`);
    return { ...d, action: 'refused' };
  }
  // The update is asynchronous; report the new tip once it has moved.
  for (let i = 0; i < 30; i++) {
    const now = gh(['pr', 'view', String(n), '--repo', a.repo, '--json', 'headRefOid', '--jq', '.headRefOid']).trim();
    if (now !== old) { console.log(`updated #${n} to ${now.slice(0, 8)}; its gates start as an ordinary pull_request run`); return d; }
    await sleep(4000);
  }
  console.error(`warning: #${n} did not move after update-branch; run again`);
  return d;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.watch) { await pass(a); return; }
  const until = Date.now() + a.maxMinutes * 60000;
  while (Date.now() < until) {
    const d = await pass(a);
    // A refused update would be chosen again on every pass; it wants a session.
    if (['none', 'stuck', 'refused'].includes(d.action)) return;
    await sleep(a.interval * 1000);
  }
  console.error(`warning: --watch stopped after ${a.maxMinutes} minutes with the queue not empty`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(String(e.stderr || e.stack || e)); process.exit(1); });
}
