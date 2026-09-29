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
 * WHAT THE MARKER LOOKS LIKE BY THE TIME IT REACHES HERE, which is not what a
 * session typed. `gh run list` reports `displayTitle` as the commit subject only
 * while a workflow has no `run-name`; once it has one -- as all six here now do
 * -- displayTitle IS the resolved run name, so the raw marker never appears and
 * the workflow's own sentence appears instead. Both are matched, so this module
 * is right about a repository whose workflows carry the run-name expression and
 * about one whose do not. Measured on run 33966... of claude-skills, the first
 * push after the expression landed.
 */
export const PREDICTED_NAME = 'EXPECTED RED';

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

/*
 * A RUN GITHUB REFUSED TO START IS NOT A VERDICT EITHER (2026-09-29). When the
 * account's Actions budget runs out, every push to a PRIVATE repository still
 * makes a run, and GitHub reports it as conclusion `failure` -- but its job has
 * no steps, no runner, and one annotation: "The job was not started because
 * recent account payments have failed or your spending limit needs to be
 * increased." Read as a failure, that is a red streak nobody can fix in code,
 * ranked 0, sending every tick to diagnose a bill. Read as a success it would
 * end a real red streak. So it is treated like a cancelled run -- dropped from
 * the verdict -- and reported on its own row, as a chore: the commits are
 * UNCHECKED, not broken, and the first run after the budget resets checks the
 * whole tree. Measured on buses-data run 36587778478.
 *
 * Only `failure` runs are probed, and only while they sit at the top of the
 * list, so a green or genuinely red repository costs no extra call beyond the
 * one the failing-steps lookup already made. MAX_PROBES bounds the walk; past
 * it the older runs are dropped rather than guessed at, and the row says
 * "at least".
 */
export const MAX_PROBES = 15;

// Every job failed without running a single step. A real failure always has at
// least GitHub's own "Set up job" step, and a workflow that cannot be parsed is
// `startup_failure` with no jobs at all -- neither matches.
export function isNotStarted(jobs) {
  return Array.isArray(jobs) && jobs.length > 0
    && jobs.every((j) => j.conclusion === 'failure' && !(j.steps || []).length);
}

// GitHub's own words, and whether they are about money. Quoted rather than
// paraphrased, so a different refusal (a disabled runner, an org policy) is
// reported as what it is and not mislabelled a budget.
const BUDGET_WORDS = /spending limit|payments? have failed|billing/i;
export function refusalReason(annotations) {
  const msgs = (annotations || []).map((a) => String(a.message || '')).filter(Boolean);
  const text = msgs.find((m) => /not (been )?started/i.test(m) || BUDGET_WORDS.test(m)) || null;
  return {
    text: text || 'GitHub did not start the job: it failed with no steps run and no runner assigned.',
    budget: !!text && BUDGET_WORDS.test(text),
  };
}

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
  const all = runs || [];
  const conclusive = all.filter((r) => CONCLUSIVE.has(r.conclusion) && !r.notStarted);
  const inFlight = all.some((r) => r.status && r.status !== 'completed');
  const notRun = notRunBlock(all, now);

  if (!conclusive.length) return { verdict: 'unknown', inFlight, runs: 0, notRun };

  const newest = conclusive[0];
  if (!RED.has(newest.conclusion)) {
    return { verdict: 'green', inFlight, runs: conclusive.length, latest: newest, notRun };
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
  const label = `${newest.displayTitle || ''} ${newest.name || ''}`;
  const predicted = label.includes(MARKER) || label.includes(PREDICTED_NAME);

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
    notRun,
  };
}

/*
 * The refused runs ABOVE the newest run that actually ran -- cancelled and
 * in-flight runs are stepped over, as everywhere else. A refusal further down,
 * with a real run on top of it, is history: the budget came back. Null when
 * the newest run was not refused.
 */
function notRunBlock(runs, now) {
  const block = [];
  let reachedRealRun = false;
  for (const r of runs) {
    if (r.notStarted) { block.push(r); continue; }
    if (CONCLUSIVE.has(r.conclusion)) { reachedRealRun = true; break; }
  }
  if (!block.length) return null;
  const oldest = block[block.length - 1];
  const since = Date.parse(oldest.createdAt);
  const reason = block.find((r) => r.notStarted.text)?.notStarted || refusalReason([]);
  return {
    count: block.length,
    // Every run in the window was refused, or the probe cap cut the walk:
    // either way the block may be longer than we saw.
    atLeast: !reachedRealRun,
    since: oldest.createdAt,
    hours: Number.isNaN(since) ? null : (now - since) / 3600000,
    latest: block[0],
    reason: reason.text,
    budget: !!reason.budget,
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
    if (st && st.notRun) rows.push(notRunRow(s, st));
    if (!st || st.verdict !== 'red') continue;

    const age = `${st.truncated ? 'at least ' : ''}${hrs(st.hoursRed)}`;
    const steps = (s.steps || []).length
      ? ` Failing: ${s.steps.join('; ')}.`
      : '';
    const streak = st.streak > 1 ? `${st.streak} consecutive failed runs` : 'the last run';

    // A red older than the grace window is BROKEN whatever its commit said.
    const rank = st.excused ? 8 : 0;

    const lastGreenNote = st.lastGreen
      ? ` Last green: ${String(st.lastGreen.createdAt).slice(0, 16).replace('T', ' ')}.`
      : '';

    // THREE STATES, NOT TWO (buses-data OA-341, hole C, 2026-09-14). `predicted`
    // and `excused` are different facts -- the second is the first ANDed with
    // the grace -- and branching the message on `excused` alone meant that the
    // moment the grace expired the row asserted the OPPOSITE of a flag that was
    // still true two lines up. It did so in precisely the state where knowing
    // the red was deliberate matters most: an old red somebody opened on
    // purpose and has not finished closing. On 2026-09-14 that sentence sent a
    // scheduled tick re-deriving, from four repositories, a chain that the head
    // commit's own subject announced in terms.
    //
    // THE RANK IS UNCHANGED IN ALL THREE and must stay that way: rank 0 past the
    // grace is the design, because a marker buys GRACE_HOURS and not amnesty.
    // What was wrong is only the explanation attached to it.
    const why = st.excused
      ? `A session marked the triggering commit ${MARKER}, so this red was predicted — but it is still here after ${age}.`
        + ` Confirm it is the predicted one and clear it; a marker buys ${GRACE_HOURS} hours, not amnesty.${steps}`
      : st.predicted
        ? `Red for ${age} (${streak}). A session DID mark this ${MARKER}, so somebody opened it deliberately —`
          + ` but the ${GRACE_HOURS}-hour grace has gone, so it ranks as broken like any other red.`
          + ` Read that commit's subject and finish what it started, rather than hunting for an unexplained failure.${steps}`
          + lastGreenNote
        : `Red for ${age} (${streak}), and NOTHING says anybody expected it.`
          + ` Every push since has inherited this and mailed Peter about it under its own commit message.${steps}`
          // Since 2026-09-17 (buses-data OA-396, R3 of the process review) a red
          // is a FAULT by construction -- a sheet that does not reproduce, a
          // document check, a harness, or a live site running a commit no fetch
          // can find -- and never a chore. Said here so a tick opens the run
          // rather than first asking whether this is an S6 due or a deploy
          // pending; those are rows now, further down this same list.
          + ' Since OA-396 a red is a fault by construction (a sheet, a document check, a harness, or a live sha nothing can find), never a chore, so open the run rather than asking whether it is a stale S6 or a pending deploy — those are rows on this list, not reds.'
          + lastGreenNote;

    rows.push({
      key: `ci-red-${s.slug}`,
      rank,
      type: 'ci',
      title: `${st.excused ? 'CI red (predicted)' : st.predicted ? 'CI RED (predicted, grace expired)' : 'CI RED'}: ${s.name} — ${s.branch}`,
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
 * A CHORE, NOT A FAULT: rank 8, like every other row whose answer is waiting
 * rather than wrong. Nothing in the repository can make this row go away, so
 * the one thing it must do is stop a reader opening the run to find out why.
 */
function notRunRow(s, st) {
  const n = st.notRun;
  const runs = `${n.atLeast ? 'at least ' : ''}${n.count} run${n.count === 1 && !n.atLeast ? '' : 's'}`;
  const before = st.verdict === 'green'
    ? ` The last run that DID run was green (${String(st.latest.createdAt).slice(0, 16).replace('T', ' ')}).`
    : st.verdict === 'red'
      ? ' The last run that DID run was red, and that red has its own row.'
      : ' No run in the window actually ran, so the state of the code is unknown until one does.';
  return {
    key: `ci-not-run-${s.slug}`,
    rank: 8,
    type: 'ci',
    title: `CI NOT RUN${n.budget ? ' (Actions budget exhausted)' : ''}: ${s.name} — ${s.branch}`,
    why: `GitHub did not start the last ${runs}, for ${hrs(n.hours)}. In its words: "${n.reason}"`
      + ' Nothing failed and there is nothing to diagnose — no step ran, so those commits are UNCHECKED, not broken.'
      + (n.budget
        ? ' It clears on the first push or scheduled run after the monthly allowance resets or the spending limit is raised (GitHub → Settings → Billing), and that run checks the whole tree, so nothing is lost.'
          + ' Until then, run the push preflight and the local document checks before pushing.'
        : ' Read the run in the browser for what GitHub wants changed.')
      + before,
    who: n.budget ? 'Peter' : '—',
    runbook: 'engine',
    ageDays: n.hours === null ? 0 : Math.floor(n.hours / 24),
    do: [
      {
        kind: 'skill',
        what: n.budget
          ? 'Nothing to fix in code. Wait for the billing cycle, or raise the Actions spending limit; do not open the run looking for a failing step, because there is none.'
          : `Open ${n.latest.url || 'the run in the browser'} and read GitHub's annotation.`,
      },
    ],
  };
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
      // `name` as well as `displayTitle`: with a run-name expression the two are
      // the same string, without one they differ, and the marker can be in either.
      '--json', 'conclusion,status,createdAt,displayTitle,name,databaseId,url,workflowName']);
    if (r.status !== 0) {
      const msg = (r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`;
      warnings.push(`CI state: could not read ${slug} — ${msg}`);
      continue;
    }
    let runs;
    try { runs = JSON.parse(r.stdout); } catch { warnings.push(`CI state: ${slug} returned unparseable JSON.`); continue; }

    // Jobs per run id, fetched at most once: the refusal probe and the
    // failing-steps lookup below ask for the same record.
    const jobsCache = new Map();
    const jobsOf = (id) => {
      if (!jobsCache.has(id)) {
        const v = run('gh', ['-R', slug, 'run', 'view', String(id), '--json', 'jobs']);
        let jobs = null;
        if (v.status === 0) { try { jobs = JSON.parse(v.stdout).jobs || []; } catch { /* unreadable: not probed */ } }
        jobsCache.set(id, jobs);
      }
      return jobsCache.get(id);
    };

    // Walk the failures at the top of the list, newest first, marking each one
    // GitHub refused to start; stop at the first run that actually ran.
    let probes = 0;
    let reasonRead = false;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (!CONCLUSIVE.has(r.conclusion)) continue;
      if (r.conclusion !== 'failure' || !r.databaseId) break;
      if (probes >= MAX_PROBES) { runs = runs.slice(0, i); break; }
      probes += 1;
      const jobs = jobsOf(r.databaseId);
      if (!isNotStarted(jobs)) break;
      r.notStarted = { text: null, budget: false };
      if (!reasonRead) {
        // GitHub's words live on the job's check run, not in the run record.
        reasonRead = true;
        const jobId = jobs[0].databaseId;
        const a = jobId ? run('gh', ['api', `repos/${slug}/check-runs/${jobId}/annotations`]) : { status: 1 };
        let annotations = [];
        if (a.status === 0) { try { annotations = JSON.parse(a.stdout); } catch { /* generic reason below */ } }
        r.notStarted = refusalReason(annotations);
      }
    }

    const state = summarise(runs, { now });
    let steps = [];
    // The failing STEP NAMES are what make the row actionable, and they cost a
    // second call -- so pay it only for a repository that is actually red.
    if (state.verdict === 'red' && state.latest && state.latest.databaseId) {
      const jobs = jobsOf(state.latest.databaseId);
      if (jobs) {
        steps = jobs.filter((j) => j.conclusion === 'failure')
          .flatMap((j) => (j.steps || []).filter((x) => x.conclusion === 'failure').map((x) => `${j.name} / ${x.name}`));
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
  for (const s of states) console.log(`  ${s.slug.padEnd(30)} ${s.branch.padEnd(8)} ${s.state.verdict}${s.state.verdict === 'red' ? ` for ${hrs(s.state.hoursRed)} (${s.state.streak} runs)${s.state.predicted ? ' [predicted]' : ''}` : ''}${s.state.notRun ? ` — ${s.state.notRun.atLeast ? 'at least ' : ''}${s.state.notRun.count} run(s) NOT STARTED${s.state.notRun.budget ? ' (budget)' : ''}` : ''}`);
  const rows = ciRows(states);
  if (!rows.length) console.log('\n  No CI row: nothing is standing red or refused.');
  for (const r of rows) console.log(`\n  rank ${r.rank}  ${r.title}\n    ${r.why}`);
}
