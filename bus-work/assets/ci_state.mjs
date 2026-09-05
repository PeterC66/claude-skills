#!/usr/bin/env node
/*
 * ci_state.mjs — is any of the three repositories STANDING RED, and has anybody
 * said they expected it?
 *
 * WHY THIS EXISTS (buses-data OA-251). Every other source in worklist.mjs reads
 * something on this laptop or in the portal's database. CI state is the one
 * class of work whose only channel was an EMAIL to Peter, and on 2026-09-05 that
 * channel was measured and found dead: roughly 25 failure emails a day across
 * the three repos, and claude-skills red on 21 consecutive runs from 2026-09-04
 * 18:58 to 2026-09-05 11:55 on the same two steps. Every push in that window
 * mailed him about a red it had inherited, under its own commit message. The
 * three findings underneath were real and small, and were fixed only because a
 * session went looking.
 *
 * THE ROW IS THE POINT, NOT THE EMAIL. A red that reaches the worklist reaches
 * whoever asks "what needs doing" next, which is the same place the stale
 * renders and the publish reviews already arrive. Peter can then delete the
 * email unread, which is the question he actually asked.
 *
 * WHAT IT IS NOT. It does not read the gate results — `worklist.mjs --gates`
 * already runs status.js locally and ranks a byte-gate DIFF at 0. This asks the
 * cheaper and completely different question: does the LAST RUN GITHUB ACTUALLY
 * RAN still fail, and for how long. A local gate can pass while CI is red (a
 * checker that only runs there, a cross-repo pairing) and the reverse is just as
 * reachable, which is why neither substitutes for the other.
 *
 * THE MARKER, and the one thing it must not become. A commit whose subject
 * carries `[expected-red]` says a session predicted this failure. Such a red is
 * ranked 8 rather than 0 for GRACE_HOURS, and is then ranked 0 like any other:
 * the marker buys grace, not amnesty. A red nobody has cleared by tomorrow is
 * indistinguishable from a red nobody noticed, whatever its commit message said.
 * The same marker is what the workflows' `run-name` lifts into the failure
 * email's subject line, so the two halves of OA-251 agree on one token.
 *
 * PURE CORE, INJECTED EDGES. `summarise()` and `ciRows()` are functions of run
 * records and take a clock; only `gatherCiState()` shells out, and it takes the
 * runner as an argument. That is what lets prove-red-ci-state.mjs falsify every
 * verdict with no network, no gh and no GitHub account.
 *
 * Zero dependencies (Node core only), matching worklist.mjs / status.js.
 */
import { spawnSync } from 'node:child_process';

export const MARKER = '[expected-red]';

/*
 * How long a predicted red is allowed to stand before it is ranked as broken
 * anyway. Six hours is chosen to be shorter than a working day and longer than
 * any legitimate cross-repo pairing: the ordering trap in buses-data's CLAUDE.md
 * -- push this repository, then open the portal PR -- is minutes, not hours.
 */
export const GRACE_HOURS = 6;

/*
 * A run that was CANCELLED is not a verdict about the code. Sessions cancel runs
 * routinely when superseding a push, and 8 of the last 60 buses-data runs were
 * cancelled; counting one as a failure would invent reds, and counting one as a
 * success would end a genuine red streak that is still running.
 */
const CONCLUSIVE = new Set(['success', 'failure', 'timed_out', 'startup_failure']);
const RED = new Set(['failure', 'timed_out', 'startup_failure']);

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

/*
 * `owner/repo` from a working tree, rather than a hard-coded list. The skills
 * tree is reached through a junction and the portal moves between checkouts, so
 * asking git is the only thing that stays true; it also means this module works
 * for a fourth repository the day one exists, with no edit here.
 */
export function repoSlug(dir, run = sh) {
  const r = run('git', ['-C', dir, 'remote', 'get-url', 'origin']);
  if (r.status !== 0 || !r.stdout) return null;
  const m = r.stdout.trim().match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/*
 * The default branch, from the local remote HEAD. A PR's own red belongs to
 * whoever opened it and is visible on the PR; what nobody owns -- and what this
 * row exists for -- is a red sitting on the branch everything else is cut from.
 */
export function defaultBranch(dir, run = sh) {
  const r = run('git', ['-C', dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().replace(/^origin\//, '');
  return 'main';
}

/*
 * ---- the pure core --------------------------------------------------------
 *
 * `runs` is newest-first, as `gh run list` returns it. Everything below is a
 * function of that array and `now`, so every verdict is reachable from a
 * fixture.
 */
export function summarise(runs, { now = Date.now() } = {}) {
  const conclusive = (runs || []).filter((r) => CONCLUSIVE.has(r.conclusion));
  const inFlight = (runs || []).some((r) => r.status && r.status !== 'completed');

  if (!conclusive.length) return { verdict: 'unknown', inFlight, runs: 0 };

  const newest = conclusive[0];
  if (!RED.has(newest.conclusion)) {
    return { verdict: 'green', inFlight, runs: conclusive.length, latest: newest };
  }

  // Walk the consecutive red streak. `redSince` is the OLDEST failure in it --
  // the moment the repository stopped being green, not the moment of the latest
  // push, which is what an email would have told you.
  let streak = 0;
  let oldestRed = newest;
  for (const r of conclusive) {
    if (!RED.has(r.conclusion)) break;
    streak += 1;
    oldestRed = r;
  }
  const lastGreen = conclusive.find((r) => !RED.has(r.conclusion)) || null;

  // TRUNCATION IS A FACT ABOUT THE ANSWER, NOT A DETAIL. If every run we were
  // given is red, the streak reaches the edge of the window and `redSince` is a
  // lower bound -- the repository may have been red for longer. Saying "at
  // least" is the difference between a measurement and a guess.
  const truncated = streak === conclusive.length && !lastGreen;

  const since = Date.parse(oldestRed.createdAt);
  const hoursRed = Number.isNaN(since) ? null : (now - since) / 3600000;
  const predicted = typeof newest.displayTitle === 'string' && newest.displayTitle.includes(MARKER);

  return {
    verdict: 'red',
    inFlight,
    runs: conclusive.length,
    latest: newest,
    streak,
    truncated,
    redSince: oldestRed.createdAt,
    hoursRed,
    lastGreen,
    predicted,
    // A predicted red is explained only while it is fresh. Past GRACE_HOURS the
    // marker stops mattering: see the header.
    excused: predicted && hoursRed !== null && hoursRed < GRACE_HOURS,
  };
}

const hrs = (h) => (h === null ? 'an unknown time'
  : h < 1 ? `${Math.max(1, Math.round(h * 60))} min`
    : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h`
      : `${Math.round(h / 24)} days`);

/*
 * One row per red repository. `states` is [{ name, slug, branch, state, steps }].
 */
export function ciRows(states) {
  const rows = [];
  for (const s of states) {
    const st = s.state;
    if (!st || st.verdict !== 'red') continue;

    const age = `${st.truncated ? 'at least ' : ''}${hrs(st.hoursRed)}`;
    const steps = (s.steps || []).length
      ? ` Failing: ${s.steps.join('; ')}.`
      : '';
    const streak = st.streak > 1 ? `${st.streak} consecutive failed runs` : 'the last run';

    // A red older than the grace window is BROKEN whatever its commit said.
    const rank = st.excused ? 8 : 0;

    const why = st.excused
      ? `A session marked the triggering commit ${MARKER}, so this red was predicted — but it is still here after ${age}.`
        + ` Confirm it is the predicted one and clear it; a marker buys ${GRACE_HOURS} hours, not amnesty.${steps}`
      : `Red for ${age} (${streak}), and NOTHING says anybody expected it.`
        + ` Every push since has inherited this and mailed Peter about it under its own commit message.${steps}`
        + (st.lastGreen ? ` Last green: ${String(st.lastGreen.createdAt).slice(0, 16).replace('T', ' ')}.` : '');

    rows.push({
      key: `ci-red-${s.slug}`,
      rank,
      type: 'ci',
      title: `${st.excused ? 'CI red (predicted)' : 'CI RED'}: ${s.name} — ${s.branch}`,
      why,
      who: '—',
      runbook: 'engine',
      ageDays: st.hoursRed === null ? 0 : Math.floor(st.hoursRed / 24),
      do: [
        { kind: 'shell', cwd: s.dir, cmd: `gh run view ${st.latest.databaseId ?? ''} --log-failed`.trim() },
        {
          kind: 'skill',
          what: `Read the failing step above. The buses-data gate writes its findings to the step SUMMARY, not the log, so a log saying only "exit code 1" means open ${st.latest.url || 'the run in the browser'}.`,
        },
      ],
    });
  }
  return rows;
}

/*
 * ---- the injected edge ----------------------------------------------------
 *
 * Fails SOFT and says so. No gh, no auth, no network: a warning, never a row and
 * never a throw. A worklist that refuses to print because GitHub was unreachable
 * would be worse than the email it replaces.
 */
export function gatherCiState({ dirs, run = sh, now = Date.now(), limit = 40 } = {}) {
  const states = [];
  const warnings = [];

  for (const { name, dir } of dirs) {
    const slug = repoSlug(dir, run);
    if (!slug) { warnings.push(`CI state: no git origin for ${name} (${dir}) — skipped.`); continue; }
    const branch = defaultBranch(dir, run);

    const r = run('gh', ['-R', slug, 'run', 'list', '--branch', branch, '--limit', String(limit),
      '--json', 'conclusion,status,createdAt,displayTitle,databaseId,url,workflowName']);
    if (r.status !== 0) {
      const msg = (r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`;
      warnings.push(`CI state: could not read ${slug} — ${msg}`);
      continue;
    }
    let runs;
    try { runs = JSON.parse(r.stdout); } catch { warnings.push(`CI state: ${slug} returned unparseable JSON.`); continue; }

    const state = summarise(runs, { now });
    let steps = [];
    // The failing STEP NAMES are what make the row actionable, and they cost a
    // second call -- so pay it only for a repository that is actually red.
    if (state.verdict === 'red' && state.latest && state.latest.databaseId) {
      const v = run('gh', ['-R', slug, 'run', 'view', String(state.latest.databaseId), '--json', 'jobs']);
      if (v.status === 0) {
        try {
          const jobs = JSON.parse(v.stdout).jobs || [];
          steps = jobs.filter((j) => j.conclusion === 'failure')
            .flatMap((j) => (j.steps || []).filter((x) => x.conclusion === 'failure').map((x) => `${j.name} / ${x.name}`));
        } catch { /* best effort: the row is still worth printing without them */ }
      }
    }
    states.push({ name, dir, slug, branch, state, steps });
  }
  return { states, warnings };
}

// Standalone: `node ci_state.mjs <dir> [<dir> ...]` prints what the worklist
// would say. Behind require.main so importing this file runs nothing.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('ci_state.mjs')) {
  const dirs = process.argv.slice(2).map((d) => ({ name: d.split(/[\\/]/).filter(Boolean).pop(), dir: d }));
  if (!dirs.length) { console.error('usage: node ci_state.mjs <repo dir> [<repo dir> ...]'); process.exit(2); }
  const { states, warnings } = gatherCiState({ dirs });
  for (const w of warnings) console.error('  ! ' + w);
  for (const s of states) console.log(`  ${s.slug.padEnd(30)} ${s.branch.padEnd(8)} ${s.state.verdict}${s.state.verdict === 'red' ? ` for ${hrs(s.state.hoursRed)} (${s.state.streak} runs)${s.state.predicted ? ' [predicted]' : ''}` : ''}`);
  const rows = ciRows(states);
  if (!rows.length) console.log('\n  No CI row: nothing is standing red.');
  for (const r of rows) console.log(`\n  rank ${r.rank}  ${r.title}\n    ${r.why}`);
}
