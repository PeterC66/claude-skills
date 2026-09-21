#!/usr/bin/env node
/*
 * pr_sweep.mjs — the pull-request half of OA-326: a `gh` pass that WRITES a
 * file, and a board that only ever reads it (buses-data OA-326 item 1, built
 * 2026-09-21).
 *
 * WHY THIS EXISTS, AND WHY IT DID NOT UNTIL TODAY. `unpushed_branches.mjs`
 * beside this file raises a row for a branch that is on NO remote, and stops
 * there. Its header names the narrowing at the point it happens: a branch that
 * HAS been pushed raises nothing, whether or not a pull request is open for it,
 * because `worklist.mjs` promises to touch the network only in `--url` mode and
 * a board opening a socket per branch would fail on a train. OA-326 wrote down
 * what would justify closing that hole — *"If that is judged too weak, the
 * shape to build is the directory sweep's — a `gh pr list` pass that WRITES a
 * file, and a board that only reads it — never a `gh` call inside the board"* —
 * and on 2026-09-21 it was judged too weak, on three measurements:
 *
 *   - `community-bus-maps` #170 was opened on 2026-08-31 and merged on
 *     2026-09-21, 21 days later. Nothing mentioned it in between. It was not a
 *     draft, it was not blocked, and it was not conflicted; it was simply not
 *     on any list Peter works from.
 *   - `community-bus-maps` #64, dependabot's node 24→26 bump, has been open
 *     since 2026-08-21 — 31 days, `BEHIND` a protected base — and is likewise
 *     on no list.
 *   - the one tick that DID go looking got it wrong. `sched-2315` (2026-09-19)
 *     reported that `worklist-demo-applications` had "never had a pull request
 *     at all", and that claim was repeated to Peter two days later before
 *     anybody checked it. #170 had been open on that branch for nineteen days.
 *
 * THE THIRD ONE IS THE DESIGN CONSTRAINT, not a detail. That tick scanned the
 * branches the board reported and inferred absence from a list it had already
 * filtered. **Inference from a filtered list answers ABSENT, and absent reads
 * as a finding.** A branch with no pull request and a branch with a stalled one
 * are different faults wanting different fixes — the first is invisible and
 * needs one opening, the second is perfectly visible to anybody who lists pull
 * requests and is being ignored — and no amount of branch-scanning would ever
 * have surfaced the second. So this file asks TWO questions, each with the
 * instrument that can answer it, and never derives one from the other:
 *
 *   OPEN PULL REQUESTS   `gh pr list --state open` once per repository. This
 *                        cannot miss one, and it is what finds a stall.
 *   HAS THIS BRANCH EVER `gh pr list --state all --head <branch>`, asked per
 *   HAD ONE?             branch, over every state. A direct query answers with
 *                        the pull request; only a direct query may answer no.
 *
 * IT IS THE DIRECTORY SWEEP'S SHAPE, DELIBERATELY. `directory.mjs --links`
 * fetches a hundred council URLs and writes `link-check.json`; `directory_links
 * .mjs` reads that record and opens no socket. Here the writer is `main()` at
 * the bottom of this file, which runs only when the file is EXECUTED, and the
 * reader is `prSweepItems()`, which is pure and takes its clock as an argument.
 * `worklist.mjs` imports the reader. Nothing importable from this module can
 * reach the network, which is the property that keeps the board half a second
 * long and working on a train.
 *
 * WHERE THE RECORD LIVES, AND WHY IT IS NOT TRACKED. `<buses>/loop/pr-sweep
 * .json`. `loop/*` is gitignored in buses-data with `loop/README.md` the single
 * exception, so the record is local bookkeeping by construction — which is
 * required rather than convenient: it is dated, it is a function of the clock
 * and of another repository's state, and CLAUDE.md's rule is that a generated
 * file under byte comparison must never read the clock. Committing this would
 * put a date in a diff every time anybody ran it.
 *
 * A DRAFT RAISES NOTHING, AND IS COUNTED IN A NOTE. `claude-skills` #3 and #4
 * are titled `[DO NOT MERGE]` and `[NEEDS A ROLLOUT DECISION]`: their authors
 * are saying in the title that they are not finished. A row that nagged about
 * those two every day would be muted inside a week and would take the other
 * rows with it — this project's standard way of losing a gate, and the same
 * argument that made the untracked-sibling hook warn rather than refuse. They
 * are named in a warning instead, so the narrowing is visible rather than
 * silently absent.
 *
 * STALENESS IS MEASURED FROM `createdAt`, NOT FROM `updatedAt`, and that was
 * measured too. On 2026-09-21 #64 read 31 days since it was created and 10 days
 * since it was last touched; #285 and #284 read 8 and 8. An `updatedAt` test is
 * reset by a bot comment, a base push or a CI re-run, so a pull request nobody
 * intends to merge can evade it for ever while looking busy. The age that
 * matches the fault this file was built for is the one #170 accumulated: how
 * long it has been open. The last-activity age is carried in the row's detail,
 * where a reader can see it, and is never the trigger.
 *
 * WHAT IT STILL DOES NOT ASK, named at the point of the narrowing. It does not
 * read review state, checks or mergeability as a trigger — `mergeStateStatus`
 * is computed lazily by GitHub and read `UNKNOWN` for two of the three open
 * portal pull requests on the day this was written, so a row built on it would
 * be silent at random. It is recorded in the row's detail as a fact about the
 * sweep, not acted on. CI redness already has its own source (`ci_state.mjs`),
 * and a deploy already has `deploy_pending.mjs`.
 *
 * AND IT ASKS ONLY OF THE PR-PER-CHANGE REPOSITORIES. `buses-data` is direct
 * push to `main`; a branch there with no pull request is not a finding, it is
 * the convention.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** How long a pull request may stay OPEN before the board says so. Days. */
export const STALE_DAYS = 7;

/**
 * How old the RECORD may be before the board asks for another sweep. Hours.
 *
 * 48 rather than 24, and the relation to `STALE_DAYS` is the whole reasoning: a
 * stall cannot be missed by more than the cadence, so two days inside a
 * seven-day threshold means the worst case is a pull request raised on day nine
 * instead of day seven. A daily row at rank 8 on a board Peter reads every
 * morning is the muting risk again; two days is the cheapest cadence that keeps
 * the answer honest. Whoever wires the sweep into the scheduled loop makes this
 * row disappear altogether, which is the right end state.
 */
export const CADENCE_HOURS = 48;

const DAY = 86400000;

/**
 * Read the sweep's record from disk. Returns a plain object and never throws.
 *
 * `loopPresent` is the TRIGGER for every row below, and it is the buses tree's
 * `loop/` folder rather than the record itself — exactly the split
 * `readDirectoryState` makes, for exactly the same reason. A tree that has no
 * `loop/` is not this estate's buses checkout (a fixture, a bare clone in CI, a
 * worktree pointed somewhere else) and must stay silent; a tree that HAS it and
 * no record has never swept, which is the loudest thing this module can say.
 * Keying on the record would make "never run" and "not applicable" the same
 * state — the shape this estate names *the refusal read as an absence*.
 *
 * @param {string} loopDir  the buses tree's loop/ folder
 */
export function readPrSweep(loopDir) {
  const recordFile = path.join(loopDir || '', 'pr-sweep.json');
  const state = { loopDir, recordFile, loopPresent: false, present: false, record: null, unreadable: null };
  try { state.loopPresent = !!loopDir && fs.existsSync(loopDir); } catch { /* an unreadable disk is not our business */ }
  if (!state.loopPresent) return state;
  let raw;
  try { raw = fs.readFileSync(recordFile, 'utf8'); } catch { return state; }
  state.present = true;
  try { state.record = JSON.parse(raw); } catch (e) { state.unreadable = e.message; }
  return state;
}

/** The command that refreshes the record, offered by every row here. */
const sweepStep = (assetsDir) => ({
  kind: 'shell', cwd: assetsDir, cmd: 'node pr_sweep.mjs',
  note: 'asks GitHub once per repository and once per pushed branch; writes loop/pr-sweep.json',
});

const ageDaysOf = (iso, now) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
};

/**
 * Rows from a record that is already on the disk. PURE — no I/O, no clock, no
 * network — so the harness can drive every branch, including "the sweep has
 * never run" and "the record will not parse", without a repository or a socket.
 *
 * @param {object} p
 * @param {object} p.state          from readPrSweep()
 * @param {number} [p.now]          ms since epoch; injected so the harness owns the clock
 * @param {number} [p.staleDays]
 * @param {number} [p.cadenceHours]
 * @param {string} [p.assetsDir]    where `node pr_sweep.mjs` is to be run
 * @returns {{items: Array, notes: string[]}}
 */
export function prSweepItems({ state, now = Date.now(), staleDays = STALE_DAYS, cadenceHours = CADENCE_HOURS, assetsDir = '.' }) {
  const items = [];
  const notes = [];
  if (!state || !state.loopPresent) return { items, notes };
  const sweep = sweepStep(assetsDir);

  // 1. THE RECORD IS THERE AND CANNOT BE BELIEVED. Loud, not silent: a reader
  //    that fell quiet on a record it could not parse would report exactly what
  //    a healthy sweep reports.
  if (state.present && state.unreadable) {
    items.push({
      key: 'pr-sweep-record', rank: 8, type: 'pr-sweep',
      title: 'The pull-request sweep\'s record will not parse',
      why: `${state.recordFile} is not JSON (${state.unreadable}). While it is broken, nothing is watching for a pull request that has been open for weeks, and this row is all that says so.`,
      who: '—', runbook: 'git',
      do: [
        { kind: 'chat', what: 'Delete the file and sweep again — it is a written record, not source data, and it costs one round trip per repository to rebuild.' },
        sweep,
      ],
    });
    return { items, notes };
  }

  const rec = state.record || {};
  const at = state.present && !state.unreadable ? Date.parse(rec.checkedAt || '') : NaN;

  // 2. IT PARSES BUT DOES NOT SAY WHEN. The writer-and-reader join going wrong —
  //    a renamed field, a half-written file — and from anywhere but here it
  //    looks identical to health.
  if (state.present && !Number.isFinite(at)) {
    items.push({
      key: 'pr-sweep-record', rank: 8, type: 'pr-sweep',
      title: 'The pull-request sweep\'s record does not say when it ran',
      why: `${state.recordFile} parses but carries no readable \`checkedAt\`. Its age is the whole basis of the cadence row, so nothing can tell a sweep run this morning from one run last month.`,
      who: '—', runbook: 'git',
      do: [
        sweep,
        { kind: 'chat', what: 'If a fresh sweep still writes no checkedAt, the fault is in buildSweepRecord() in pr_sweep.mjs, not in the data.' },
      ],
    });
    return { items, notes };
  }

  const repos = Array.isArray(rec.repos) ? rec.repos : [];
  const sweptOn = Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : 'an unknown date';

  // 3. A PULL REQUEST THAT HAS BEEN OPEN TOO LONG. One row each rather than one
  //    row for all of them: unlike a site reorganisation killing a dozen links
  //    at once, these arrive one at a time, each is a separate decision, and
  //    each carries its own age, its own number and its own command.
  for (const repo of repos) {
    if (repo.error) {
      notes.push(`pull-request sweep: ${repo.name} could not be asked — ${repo.error}. Its pull requests are unwatched, and this is a statement about the sweep, not about that repository.`);
      continue;
    }
    const open = Array.isArray(repo.open) ? repo.open : [];
    const drafts = open.filter((p) => p.isDraft);
    const live = open.filter((p) => !p.isDraft);
    const stale = [];
    const fresh = [];
    for (const pr of live) ((ageDaysOf(pr.createdAt, now) >= staleDays) ? stale : fresh).push(pr);

    if (drafts.length) {
      notes.push(`pull-request sweep: ${repo.name} has ${drafts.length} DRAFT pull request(s), not raised — a draft is its author saying it is unfinished: `
        + drafts.map((p) => `#${p.number} ${p.title}`).join('; '));
    }
    if (fresh.length) {
      notes.push(`pull-request sweep: ${repo.name} has ${fresh.length} open pull request(s) younger than ${staleDays} days, not raised: `
        + fresh.map((p) => `#${p.number} (${ageDaysOf(p.createdAt, now)}d)`).join(', '));
    }

    for (const pr of stale) {
      const openDays = ageDaysOf(pr.createdAt, now);
      const quietDays = ageDaysOf(pr.updatedAt, now);
      items.push({
        key: `pr-sweep-stalled-${repo.key}-${pr.number}`,
        rank: 3, type: 'pr-sweep',
        title: `${repo.name} #${pr.number} has been open ${openDays} days: ${pr.title}`,
        why: `A pull request nobody has merged or closed. It is not a draft, so its author considers it finished. `
          + `This row exists because #170 in ${repo.name === 'community-bus-maps' ? 'this repository' : 'community-bus-maps'} sat open for 21 days and was named on no list Peter works from until the day it merged — `
          + `the board could not see it, because a pushed branch is where this estate's stranded-work row deliberately stops looking.`,
        detail: [
          `opened ${String(pr.createdAt || '').slice(0, 10)} by ${pr.author || 'unknown'}${quietDays === null ? '' : `; last activity ${quietDays} day(s) ago`}`,
          `branch ${pr.headRefName || '(unknown)'}${pr.mergeStateStatus ? `; GitHub calls it ${pr.mergeStateStatus}` : ''}${pr.reviewDecision ? `; review ${pr.reviewDecision}` : ''}`,
          `swept ${sweptOn}`,
        ].join('\n'),
        who: 'Peter', runbook: 'git', ref: `#${pr.number}`, repo: repo.name, ageDays: openDays,
        do: [
          { kind: 'shell', cwd: repo.dir || '.',
            cmd: `gh pr view ${pr.number} --repo ${repo.slug} --web`,
            note: 'one self-contained command; run it from anywhere' },
          { kind: 'chat', what: 'Merge it, close it, or say in the pull request why it is waiting. A pull request with no answer is the one state this estate has no other instrument for.' },
          ...(pr.mergeStateStatus === 'BEHIND' ? [{ kind: 'chat', what: 'GitHub calls it BEHIND, and both public repositories require an up-to-date branch, so it cannot merge until it is brought forward — update the branch first.' }] : []),
          sweep,
        ],
      });
    }

    // 4. A PUSHED BRANCH THAT HAS NEVER HAD A PULL REQUEST IN ANY STATE. The
    //    half `unpushed_branches.mjs` says at the point of its own narrowing
    //    that it does not ask. Answered per branch and over every state,
    //    because absence inferred from a filtered list is what got #170 wrong.
    for (const b of (Array.isArray(repo.noPr) ? repo.noPr : [])) {
      const branchAge = ageDaysOf(b.committedAt, now);
      const size = b.insertions == null ? 'an unknown number of' : String(b.insertions);
      items.push({
        key: `pr-sweep-no-pr-${repo.key}-${String(b.branch).replace(/[^A-Za-z0-9]+/g, '-')}`,
        rank: 3, type: 'pr-sweep',
        title: `${repo.name}: ${b.branch} is pushed and unmerged, and has never had a pull request`,
        why: `${size} insertion(s) on a branch GitHub holds, which ${repo.name === 'buses-data' ? 'could be merged directly' : 'is protected and therefore cannot merge without a pull request'}. `
          + `The stranded-branch row does not raise this one, on purpose: the branch IS on the remote, so somebody looking at the repository could see it. Nobody is looking. `
          + `Asked as \`gh pr list --state all --head ${b.branch}\` — over every state, so a closed or merged one would have answered here instead of reading as none.`,
        detail: [
          `last commit ${String(b.committedAt || '').slice(0, 10) || 'date unknown'} — ${b.subject || '(no subject)'}`,
          `swept ${sweptOn}`,
        ].join('\n'),
        who: 'Peter', runbook: 'git', ref: b.branch, repo: repo.name, ageDays: branchAge,
        do: [
          { kind: 'shell', cwd: repo.dir || '.',
            cmd: `gh pr create --repo ${repo.slug} --head ${b.branch} --fill --web`,
            note: 'one self-contained command; run it from anywhere — --web opens the draft for editing before it is filed' },
          { kind: 'chat', what: 'Or, if the branch is abandoned, delete it from the remote — a branch nobody will merge is the noise this row will otherwise repeat every day.' },
          sweep,
        ],
      });
    }
  }

  // 5. THE CADENCE ROW ITSELF. Quiet until the record is older than the cadence.
  if (!state.present) {
    items.push({
      key: 'pr-sweep-due', rank: 8, type: 'pr-sweep',
      title: 'Nothing has ever asked GitHub whether a pull request is sitting open',
      why: `The board computes stranded work from refs on this disk and stops at the remote, by design. Whether a pushed branch has an open pull request, and whether that pull request has been open for weeks, needs one round trip per repository — this sweep takes it and writes the answer down.`,
      who: '—', runbook: 'git',
      do: [sweep],
    });
  } else {
    const ageHours = Math.floor((now - at) / 3600000);
    if (ageHours >= cadenceHours) {
      items.push({
        key: 'pr-sweep-due', rank: 8, type: 'pr-sweep',
        title: `The pull-request sweep last ran ${ageHours} hours ago`,
        why: `Every row above about a pull request is a statement about ${sweptOn}, not about now. The sweep is a handful of \`gh\` calls; the cadence is ${cadenceHours} hours, which is inside the ${staleDays} days a pull request must be open before it is raised, so a stall cannot be missed by more than the gap.`,
        who: '—', runbook: 'git', ageDays: Math.floor(ageHours / 24),
        do: [sweep],
      });
    }
  }

  return { items, notes };
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WRITER. Everything below this line touches the network, and nothing below
 * it is imported by worklist.mjs. `buildSweepRecord` is the join: it is pure,
 * takes the answers as data, and is what the harness drives against the reader
 * so the two halves cannot drift apart on a field name.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Turn per-repository answers into the record the reader parses.
 * Pure: no I/O, and the clock is an argument.
 *
 * @param {{results: Array, now?: Date}} p
 */
export function buildSweepRecord({ results, now = new Date() }) {
  return {
    checkedAt: now.toISOString(),
    tool: 'pr_sweep.mjs',
    repos: (results || []).map((r) => ({
      key: r.key,
      name: r.name,
      slug: r.slug || null,
      dir: r.dir || null,
      error: r.error || null,
      open: (r.open || []).map((p) => ({
        number: p.number,
        title: p.title,
        headRefName: p.headRefName,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        isDraft: !!p.isDraft,
        mergeStateStatus: p.mergeStateStatus || null,
        reviewDecision: p.reviewDecision || null,
        author: (p.author && (p.author.login || p.author)) || null,
      })),
      branchesAsked: Number.isFinite(+r.branchesAsked) ? +r.branchesAsked : (r.noPr || []).length,
      noPr: (r.noPr || []).map((b) => ({
        branch: b.branch,
        committedAt: b.committedAt || null,
        subject: b.subject || '',
        insertions: b.insertions == null ? null : +b.insertions,
      })),
    })),
  };
}

/** The one `gh` runner. `null` on any failure — a question GitHub refuses is not a finding. */
export const defaultGh = (dir, argv) => {
  try {
    return execFileSync('gh', argv, {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000,
    });
  } catch { return null; }
};

const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

/**
 * Ask GitHub about one repository: its open pull requests, and — per branch
 * handed in — whether that branch has EVER had one.
 *
 * `branches` comes from the caller, which grades them with
 * `unpushed_branches.mjs`; this function does no git.
 *
 * @param {{repo: object, branches: Array, gh?: Function}} p
 */
export function sweepRepo({ repo, branches = [], gh = defaultGh }) {
  const out = { key: repo.key, name: repo.name, dir: repo.dir, slug: null, error: null, open: [], noPr: [], branchesAsked: 0 };

  const slugRaw = gh(repo.dir, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (slugRaw === null) {
    out.error = 'gh could not name the repository — is gh installed and authenticated, and is there a GitHub remote?';
    return out;
  }
  out.slug = String(slugRaw).trim();

  // ONE CALL FOR EVERY OPEN PULL REQUEST. This cannot miss one, which is the
  // reason a stall is found here and never inferred from anything else.
  const openRaw = gh(repo.dir, ['pr', 'list', '--state', 'open', '--limit', '100', '--json',
    'number,title,headRefName,createdAt,updatedAt,isDraft,mergeStateStatus,reviewDecision,author']);
  const open = openRaw === null ? null : parseJson(openRaw);
  if (!Array.isArray(open)) {
    out.error = 'gh pr list --state open did not answer with a list';
    return out;
  }
  out.open = open;

  // AND ONE CALL PER BRANCH, OVER EVERY STATE. Never "it is not in the list
  // above, therefore it has none": that inference is what reported #170 as
  // having never existed, nineteen days after it was opened.
  for (const b of branches) {
    out.branchesAsked++;
    const raw = gh(repo.dir, ['pr', 'list', '--state', 'all', '--head', b.branch, '--limit', '10', '--json', 'number,state']);
    const found = raw === null ? null : parseJson(raw);
    // A REFUSAL IS NOT AN ABSENCE. Only an answered empty list means "none".
    if (!Array.isArray(found)) continue;
    if (found.length) continue;
    out.noPr.push({ branch: b.branch, committedAt: b.committedAt, subject: b.subject, insertions: b.insertions });
  }
  return out;
}

/* The CLI. Runs only when this file is EXECUTED, never when it is imported. */
async function main() {
  const [{ readBranches, classifyBranch }, { resolveBuses, resolvePortal, parseArgs }] = await Promise.all([
    import('./unpushed_branches.mjs'),
    import('./engine.mjs'),
  ]);
  const args = parseArgs(process.argv.slice(2));
  const buses = resolveBuses(args);
  const portal = resolvePortal(args);
  // The engine repository is the one CONTAINING this file — the same question
  // worklist.mjs's findEngineRepo asks, and the answer that is right in a
  // worktree as well as in the main checkout.
  const engine = args.engine || process.env.BUS_ENGINE_REPO || (() => {
    try { return execFileSync('git', ['-C', HERE, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
  })();

  // ONLY THE PR-PER-CHANGE REPOSITORIES. buses-data is direct push to main, so
  // a branch there without a pull request is the convention, not a finding.
  const repos = [
    { key: 'portal', name: 'community-bus-maps', dir: portal },
    { key: 'engine', name: 'claude-skills', dir: engine },
  ].filter((r) => !!r.dir);

  const results = [];
  for (const repo of repos) {
    const read = readBranches(repo.dir);
    // `pushed` — unmerged by patch identity and on the remote. Exactly the class
    // unpushed_branches.mjs prints as a warning and does not raise, which is the
    // class this sweep exists to finish the sentence about.
    const branches = !read.readable || !read.base ? []
      : read.branches.filter((b) => classifyBranch(b) === 'pushed');
    const r = sweepRepo({ repo, branches });
    if (!read.readable || !read.base) {
      r.error = r.error || `git could not be read here — ${read.why || 'unknown'}`;
    }
    results.push(r);
    const label = r.error ? `ERROR ${r.error}` : `${r.open.length} open, ${branches.length} pushed branch(es) asked, ${r.noPr.length} with no pull request ever`;
    console.log(`  ${repo.name.padEnd(20)} ${label}`);
  }

  const record = buildSweepRecord({ results });
  const loopDir = path.join(buses, 'loop');
  fs.mkdirSync(loopDir, { recursive: true });
  const outFile = args.out ? path.resolve(args.out) : path.join(loopDir, 'pr-sweep.json');
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + '\n', 'utf8');
  console.log(`\nwritten: ${outFile}`);
  console.log('The board reads that file and opens no socket — run `node worklist.mjs` to see what it now says.');
}

/* EXECUTED, not imported — `fileURLToPath` rather than a hand-peeled URL,
 * because on Windows `new URL(...).pathname` is `/C:/…` and the comparison
 * quietly fails, which would make this file import-only for ever and the
 * sweep unrunnable with no error to read. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
}
