/*
 * deploy_pending.mjs — a merge on the portal's `main` that nobody has deployed
 * yet, as a worklist row (buses-data OA-396, 2026-09-17).
 *
 * WHY THIS EXISTS. R3 of the process review of 2026-09-17: a deploy pending is a
 * CHORE, and a chore is a worklist row at its rank and never a red. Until that
 * day the board's Deployment row PRINTED the state and CI went red on it — a
 * BEHIND older than the 12-hour grace exited 1 (OA-355), and three of the
 * newest thirty reds on buses-data were exactly that. The board now prints it
 * and exits 0, so the chore needed a carrier, and it had none: the only thing
 * that had ever chased a forgotten deploy was the failure email. A chore that
 * used to shout must not merely go quiet.
 *
 * WHAT IT READS. The same two facts as the board's row: the live site's
 * `X-App-Version` header and the portal checkout's `origin/main` (falling back
 * to HEAD). The backlog is `git log <deployed>..<main>`, and the row is dated
 * from the OLDEST undeployed commit, never the tip — OA-355's rule, because
 * dating the tip meant every unrelated merge reset the clock. Rank 5 once the
 * backlog is older than the grace, rank 8 inside it: a merge is not a deploy
 * and nobody should be chased the minute they press merge.
 *
 * WHAT IT DOES NOT DO. It never fetches, never reddens and never deploys. A
 * live sha this checkout cannot resolve is NOT its business: that is the
 * board's one remaining red on this subject (`deployBad()` in
 * make-bus-leaflet/assets/deployment.js — a site running something `main`
 * never held, or an instrument that could not look), and this says so in a
 * warning rather than guessing a row. An unreachable site is a warning too,
 * never a row, because the uptime monitor owns reachability; a missing header
 * means the live build predates the header, which is a fact and not a chore.
 *
 * SINCE OA-394 THE LOOP DEPLOYS WHAT IT MERGED in the same run, so this row is
 * for a merge somebody ELSE made — Peter by hand, a Dependabot auto-merge, a
 * session that merged and did not deploy — and for a loop deploy whose
 * read-back failed and was reverted.
 *
 * PURE CORE, INJECTED EDGES, like ci_state.mjs: deployPendingItems() is a
 * function of a state object and a clock, and readDeployState() is the only
 * thing that touches git or the network and takes both as arguments, which is
 * what lets prove-red-deploy-pending.mjs falsify every verdict with no portal,
 * no site and no git.
 *
 * Zero dependencies (Node core only), matching worklist.mjs.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolvePortal } from './engine.mjs';

export const DEFAULT_LIVE_URL = 'https://busmaps.uk';
export const DEFAULT_GRACE_HOURS = 12;

/** git in `dir`, trimmed stdout or null — the same helper the board uses. */
export const defaultGit = (dir, argv) => {
  try {
    return execFileSync('git', argv, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
};

/**
 * The live site's version header, as { ok, version } or { ok: false, why }.
 * The body is drained even though only the header is wanted — an unconsumed
 * body leaves undici holding the socket, and on Windows a process that ends
 * with one open aborts (the board learned this on 2026-08-25).
 */
export async function defaultLiveVersion(liveUrl) {
  try {
    const res = await fetch(liveUrl + '/health', { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    const version = res.headers.get('x-app-version');
    await res.arrayBuffer().catch(() => {});
    return { ok: true, version };
  } catch (e) {
    return { ok: false, why: String(e.message || e) };
  }
}

/**
 * Read the facts. Returns one of:
 *   { status: 'no-portal' }                       — no checkout to compare against; nothing is asked of the network
 *   { status: 'no-sha' }                          — the checkout has no readable main
 *   { status: 'unreachable', why }                — the site did not answer
 *   { status: 'no-header' }                       — the live build predates X-App-Version
 *   { status: 'current', main, deployed }         — nothing to do
 *   { status: 'unresolvable', main, deployed }    — live names a commit this checkout does not hold: the board's question, not this one's
 *   { status: 'live ahead', main, deployed }      — main has nothing the public cannot see
 *   { status: 'behind', main, deployed, ref, commitTimes }  — commitTimes are the backlog's unix seconds, newest first
 */
export async function readDeployState({ portalDir, liveUrl = DEFAULT_LIVE_URL, git = defaultGit, liveVersion = defaultLiveVersion }) {
  if (!portalDir || !existsSync(portalDir)) return { status: 'no-portal' };
  const ref = git(portalDir, ['rev-parse', '--verify', '--quiet', 'origin/main']) ? 'origin/main' : 'HEAD';
  const mainFull = git(portalDir, ['rev-parse', ref]);
  const main = git(portalDir, ['rev-parse', '--short', ref]);
  if (!main) return { status: 'no-sha' };
  const live = await liveVersion(liveUrl);
  if (!live.ok) return { status: 'unreachable', why: live.why };
  if (!live.version) return { status: 'no-header' };
  const deployed = String(live.version).split('+').pop();
  if (deployed === main || (mainFull && mainFull.startsWith(deployed))) return { status: 'current', main, deployed };
  const resolved = git(portalDir, ['rev-parse', '--verify', '--quiet', deployed + '^{commit}']);
  if (!resolved) return { status: 'unresolvable', main, deployed };
  const log = git(portalDir, ['log', '--format=%ct', deployed + '..' + ref]);
  const commitTimes = (log || '').split('\n').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  if (!commitTimes.length) return { status: 'live ahead', main, deployed };
  return { status: 'behind', main, deployed, ref, commitTimes };
}

/**
 * The row, or nothing, plus the warnings the worklist should print. `now` is
 * milliseconds; `commitTimes` are seconds, as git prints them.
 */
export function deployPendingItems(state, { graceHours = DEFAULT_GRACE_HOURS, now = Date.now(), portalDir = resolvePortal() } = {}) {
  const items = [];
  const warnings = [];
  if (!state) return { items, warnings };
  switch (state.status) {
    case 'no-portal':
    case 'no-sha':
    case 'current':
    case 'live ahead':
      return { items, warnings };
    case 'unreachable':
      warnings.push(`deploy-pending: the live site did not answer (${state.why}) — not a verdict about the deployment; the uptime monitor owns reachability.`);
      return { items, warnings };
    case 'no-header':
      warnings.push('deploy-pending: the live build predates X-App-Version; deploy once and this row starts working.');
      return { items, warnings };
    case 'unresolvable':
      warnings.push(`deploy-pending: live ${state.deployed} is a commit this checkout does not hold. That is not a chore — it is the board\'s one remaining RED on the Deployment row (status.js fetches once and decides); this row will not guess.`);
      return { items, warnings };
    case 'behind':
      break;
    default:
      warnings.push(`deploy-pending: unknown state ${JSON.stringify(state.status)} — nothing raised.`);
      return { items, warnings };
  }
  const times = (state.commitTimes || []).filter(Number.isFinite);
  if (!times.length) return { items, warnings };
  const oldestMs = Math.min(...times) * 1000;
  const ageHours = Math.max(0, Math.floor((now - oldestMs) / 3600000));
  const n = times.length;
  const past = ageHours >= graceHours;
  items.push({
    key: 'deploy-pending',
    rank: past ? 5 : 8,
    type: 'housekeeping',
    title: `Deploy the portal: main ${state.main} is ${n} commit${n === 1 ? '' : 's'} ahead of the live site (${state.deployed}), oldest ${ageHours}h`,
    why: past
      ? `Merged and not deployed for ${ageHours}h, past the ${graceHours}h grace: the public cannot see what main has. A chore, not a fault — the board prints it and no longer reddens on it (OA-396); this row is what chases it.`
      : `Merged ${ageHours}h ago, inside the ${graceHours}h grace. A merge is not a deploy; this row ranks low until the grace passes and then moves up.`,
    who: '\u2014',
    runbook: 'deploy',
    ageDays: Math.floor(ageHours / 24),
    do: [
      { kind: 'shell', cwd: portalDir, cmd: 'npm run deploy', note: 'ships whatever the HOST pulls from origin/main (OA-375), then reads /health?deep=1 back; the loop does this itself for a merge it made (OA-394)' },
      { kind: 'chat', what: 'If the merge was yours and you meant to hold it back, say so here; nothing on disk records a deliberate delay, so this row will keep asking.' },
    ],
  });
  return { items, warnings };
}
