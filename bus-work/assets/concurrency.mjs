/*
 * concurrency.mjs — "is it safe to do this RIGHT NOW?", answered per worklist row.
 *
 * WHY THIS EXISTS (buses-data OA-221, 2026-09-01). Peter asked whether calling
 * /bus-work while development sessions are running is safe. The answer is a good
 * one and it lived nowhere he could reach it: PRINTING the worklist is read-only
 * and safe at any hour, while CARRYING AN ITEM THROUGH writes into a working tree
 * three sessions share, sometimes sweeps the whole estate, and sometimes deploys.
 * Which of those is true depends on the item's type and on the state of three
 * repositories at that moment. That reasoning was written down once, in
 * "Documentation/README - Working in parallel.md" — a page you have to remember
 * to read, about a hazard you only remember after it has bitten you.
 *
 * So the verdict goes ON THE ROW, in the same glance as the title. This tool has
 * already learned the weaker version of that lesson: on 2026-08-31 a session read
 * the dev checkout's worklist and reported a demo customer as a real person
 * waiting, with `LOCAL — dev checkout` in a box three lines above it the whole
 * time. A banner you have to read is not a guard.
 *
 * ---------------------------------------------------------------------------
 * DIRECT EVIDENCE ONLY. Verdicts are computed from things that are true of the
 * disk right now:
 *
 *   - the three working trees: branch, staged files, modified files, untracked
 *     files, unpushed commits
 *   - the claims other sessions have WRITTEN into the open-action files, which
 *     is a session saying in its own words what it is doing
 *
 * A count of recently-written session transcripts is gathered too, and it is
 * PRINTED AS CONTEXT AND NEVER SCORED. It is a proxy — a session sitting at a
 * prompt waiting for Peter has an idle transcript and is not idle at all, and a
 * session that crashed mid-turn has a fresh one and is gone. This project has
 * been bitten by a gate that read the neighbour of its subject; the remedy is
 * not a better proxy, it is keeping the proxy out of the verdict.
 *
 * WHAT IT CANNOT DO, stated because a tool that hides its blind spot gets
 * believed past it: `git status` cannot say WHOSE uncommitted files those are.
 * Yours and a neighbour's look identical. That is why a dirty tree is never
 * BETTER TO DELAY on its own — it is CHECK FIRST, which means "look at what is
 * actually there", and the printed reason names the folders so you can
 * recognise your own work in one glance.
 *
 * Exactly two conditions earn BETTER TO DELAY, and both are recorded faults
 * rather than theory:
 *
 *   1. An estate-wide sweep while map data is uncommitted. `quality_gate.js
 *      --accept` rebuilt the shared quality ledger from every sheet it could
 *      find on disk, INCLUDING a neighbouring session's uncommitted
 *      ci-reference/. No `git add` of a directory was involved and the diff read
 *      entirely as own work.
 *   2. A deliver or a deploy while the portal checkout is off `main`. The portal
 *      is PR-per-change, so sitting on a feature branch is its normal working
 *      state — and `npm run deploy` from there ships that branch.
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readLoopLock, fmtMin } from './loop_lock.mjs';
import { readYourMoveDir, heldPaths } from './loop_your_move.mjs';

// ---- verdicts --------------------------------------------------------------
export const SAFE = 'safe';
export const CHECK = 'check';
export const DELAY = 'delay';

const ORDER = { [SAFE]: 0, [CHECK]: 1, [DELAY]: 2 };
export const TAG = { [SAFE]: 'SAFE NOW', [CHECK]: 'CHECK FIRST', [DELAY]: 'BETTER TO DELAY' };
const worse = (a, b) => (ORDER[b] > ORDER[a] ? b : a);

// ---- reading the disk ------------------------------------------------------
function git(dir, argv) {
  try {
    return execFileSync('git', ['-C', dir, ...argv], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000,
    }).replace(/\s+$/, '');
  } catch { return null; }
}

/*
 * A git question whose answer is the EXIT STATUS rather than the output, with
 * three values and not two. `merge-base --is-ancestor` exits 0 for yes and 1
 * for no, and anything else — a ref that does not resolve, a repository it
 * cannot read, the binary missing — is neither. `git()` above collapses all of
 * that to null, which is right when the answer is text and wrong here: reading
 * "not an ancestor" out of a failure would let a broken read be reported as a
 * measured fact, which is the shape this estate names *the refusal read as an
 * absence*. So the caller gets true, false, or null for COULD NOT LOOK.
 */
function gitSucceeds(dir, argv) {
  try {
    execFileSync('git', ['-C', dir, ...argv], { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch (e) {
    return e && e.status === 1 ? false : null;
  }
}

// A porcelain path may be quoted (a space, a non-ASCII byte) and a rename is
// written "old -> new". This repository has folders with spaces in the name, so
// neither case is hypothetical here.
function porcelainPath(rest) {
  let p = rest;
  const arrow = p.indexOf(' -> ');
  if (arrow !== -1) p = p.slice(arrow + 4);
  if (p.startsWith('"') && p.endsWith('"')) { try { p = JSON.parse(p); } catch { p = p.slice(1, -1); } }
  return p.replace(/\\/g, '/');
}

const MAP_DATA_RE = /^(Areas|Places)\//;
const REFERENCE_RE = /(^|\/)ci-reference(\/|$)/;

/*
 * DERIVED IN ONE PLACE, AND THE RULES USE THAT ONE. The first version stored
 * `touchesMapData` on the repo as it was read, and had the estate-sweep rule
 * consult that stored field — two sources for one fact. The falsification
 * harness put an uncommitted `Areas/Ramsey/ci-reference/internal.svg` into a
 * conditions object and got CHECK FIRST where BETTER TO DELAY was owed, because
 * the flag sitting beside the paths said false. The remedy is not a stricter
 * reader: it is for the rule to derive its answer from the PATHS, which are the
 * fact. Everything below reads the same helpers the reader does.
 */
export const allPaths = (r) => [...(r.staged || []), ...(r.modified || []), ...(r.untracked || [])];
export const mapDataHits = (r) => allPaths(r).filter((p) => MAP_DATA_RE.test(p) || REFERENCE_RE.test(p));
export const isDirty = (r) => (r.staged || []).length + (r.modified || []).length > 0;
export const isOffMain = (r) => !!r.branch && r.branch !== (r.expect || 'main');
export const topFolders = (r) => [...new Set(allPaths(r).map((p) => p.split('/')[0]))].sort();

/*
 * OA-301. A DIRTY FILE THAT A LIVE HOLD ALREADY NAMES IS ACCOUNTED FOR.
 *
 * The buses-tree rule exists because `git status` cannot say WHOSE uncommitted
 * files those are. A `loop/your-move/` hold can: its `**File:**` field names the
 * path, its body says who it belongs to and why the loop must not touch it. On
 * 2026-09-10 twelve of eighteen ticks stopped on one such file — a letter whose
 * salutation Peter had typed and left for the morning — every one of them
 * re-reading a hold that already explained the dirt in front of it. A held
 * letter with Peter's salutation in it is the NORMAL state of Correspondence/,
 * so without this the loop idles behind every letter he holds.
 *
 * THE SCOPE IS Correspondence/**\/*.md AND NOTHING WIDER, on purpose. A hold
 * that names a file under Areas/ or Development Docs/ is describing residue the
 * next commit could sweep or a run folder mid-build — `st-ives-experiment-
 * residue-uncommitted.md` named seven such files on 2026-09-09 and the tree was
 * RIGHT to read CHECK FIRST until they were committed. A held letter is the one
 * shape whose dirt is a person's deliberate, explained, standing state, and it
 * matches the loop's own write rule for that folder, which ends `*.md` for the
 * same reason (`_people.local.json` lives there).
 *
 * ONLY A HOLD THAT IS IN THE FOLDER NOW COUNTS. Retiring the hold puts the file
 * straight back into the verdict, and committing the file makes the hold moot.
 * Both directions fail towards CHECK FIRST, never away from it. And the file is
 * still reported as uncommitted in the conditions block — it IS — with a line
 * beneath saying which hold accounts for it, so a reader can see the subtraction
 * rather than trust it.
 */
const HELD_SCOPE_RE = /^Correspondence\/.+\.md$/i;

/** Mark on `repo` which of its dirty paths a live hold accounts for. */
export function accountFor(repo, holds) {
  const byPath = new Map();
  for (const h of holds || []) if (h && h.path && HELD_SCOPE_RE.test(h.path)) byPath.set(h.path, h.ref);
  repo.accounted = allPaths(repo)
    .filter((p) => byPath.has(p))
    .map((p) => ({ path: p, ref: byPath.get(p) }));
  return repo;
}
const accountedSet = (r) => new Set((r.accounted || []).map((a) => a.path));
/** The dirty paths a verdict should count: everything a live hold does not account for. */
export const unaccountedPaths = (r) => { const s = accountedSet(r); return allPaths(r).filter((p) => !s.has(p)); };
const unaccountedTop = (r) => [...new Set(unaccountedPaths(r).map((p) => p.split('/')[0]))].sort();

/*
 * OA-386 item 2. HOW OLD IS THE DIRT — the instrument the loop has been asking
 * for by hand, and the one `quiescentMin` was standing in for and cannot be.
 *
 * Step 2 of the loop's task prompt tells a stopped tick to say whether the tree
 * is MOVING (a live session, which clears itself) or STILL (a leftover, which
 * does not), and step 2b gates orphan adoption on a quiescence reading. Both
 * questions are about the ORPHAN, and `peers.quiescentMin` answers a question
 * about TRANSCRIPTS: the loop fires hourly, so an hour-old sibling tick's
 * transcript is always on disk and that number has a structural ceiling of
 * about sixty minutes. Over 106 recorded readings it topped out at 56 against a
 * threshold of 90, and the one reading that ever cleared 90 did so because the
 * scheduler MISSED a firing — a quantity whose variance is dominated by the
 * loop's own uptime, which is the opposite of evidence that a departed session
 * has gone home. Measured on 2026-09-16 at 05:15Z: peers read `quiescentMin: 3`
 * (live) while the bar in front of that tick had been byte-unchanged for six
 * hours. The subject is the file; so the instrument is the file's mtime.
 *
 * THREE ANSWERS, NOT TWO, because a stat that refused must never read as a file
 * that is young or a file that is absent. `read` carries a number; `absent` is
 * a path git names that is not in the working tree, which is the ordinary shape
 * of a staged deletion; `refused` is everything else, and it is counted as a
 * finding rather than skipped — see *the refusal read as an absence*.
 *
 * MTIME IS A PROXY AND IS LABELLED AS ONE WHERE IT PRINTS. A file rewritten
 * with identical bytes reads young, so this number can only ever say the dirt
 * is at LEAST that old when it is old, and nothing at all when it is young.
 * That asymmetry points the same way as every other rule here: it can hold a
 * tick back, never wave one through.
 *
 * NOTHING SCORES IT YET, deliberately. Widening step 2b's clause (iv) to read
 * this instead is [OA-294]'s conjunction and therefore Peter's decision, and a
 * tick that rewrote its own adoption clause would be granting itself the
 * capability the clause exists to withhold. What this buys now is the printed
 * diagnosis step 2 already asks for, and a range to set a threshold FROM.
 */
export function readDirtyAges(dir, paths, nowMs = Date.now()) {
  const out = {};
  for (const p of paths || []) {
    try {
      const st = statSync(path.join(dir, p));
      out[p] = { state: 'read', ageMin: Math.max(0, Math.round((nowMs - st.mtimeMs) / 60000)), why: null };
    } catch (e) {
      const code = (e && e.code) || 'unknown';
      out[p] = code === 'ENOENT'
        ? { state: 'absent', ageMin: null, why: 'git names it but it is not in the working tree — a deletion, or a rename away' }
        : { state: 'refused', ageMin: null, why: `could not stat it (${code}) — this is a refusal, not an absence` };
    }
  }
  return out;
}

/** The age of the dirt a verdict actually counts: the unaccounted paths only. */
export function dirtyAge(r) {
  const ages = r.dirtyAges || null;
  const paths = unaccountedPaths(r);
  const out = { paths: paths.length, counted: 0, absent: 0, refused: 0, oldestMin: null, newestMin: null };
  for (const p of paths) {
    /* No `dirtyAges` at all means nobody looked — a synthetic conditions object
     * in a harness, or a reader built before this existed. That is a refusal,
     * and it is the whole reason the field is counted rather than dropped. */
    const a = ages ? ages[p] : null;
    if (!a || a.state === 'refused') { out.refused++; continue; }
    if (a.state === 'absent') { out.absent++; continue; }
    out.counted++;
    if (out.oldestMin === null || a.ageMin > out.oldestMin) out.oldestMin = a.ageMin;
    if (out.newestMin === null || a.ageMin < out.newestMin) out.newestMin = a.ageMin;
  }
  return out;
}

/*
 * HOW MANY COMMITS NOBODY HAS PUSHED — and against WHAT (buses-data OA-313).
 *
 * `@{u}..HEAD` is the right question only where the branch HAS an upstream, and
 * a branch created locally has none until its first push. That is not an exotic
 * state: the portal is PR-per-change, so every piece of work there begins on a
 * fresh local branch, and the one repository where "is there finished work
 * nobody has pushed?" is asked most often was the one this count could not
 * answer. On 2026-09-11 it reported `unpushed: None` over twenty files and a
 * thousand committed lines of OA-308, while the same run counted buses-data's
 * single commit correctly.
 *
 * So: count against the upstream where there is one, and against the remote's
 * own default branch where there is not. `git rev-list --count origin/main..HEAD`
 * needs no upstream and no network.
 *
 * WHICH BASIS WAS USED IS REPORTED, NEVER INFERRED. "3 commits ahead of
 * origin/main" and "3 commits your upstream has not seen" are different
 * sentences, and a reader who cannot tell which one they are being told will
 * read the wrong one on the day it matters. `unpushedFrom` says which, and the
 * printed line says so too whenever it is not the branch's own upstream.
 *
 * AND WHERE NEITHER CAN BE COMPUTED THE REASON IS CARRIED, because `null` here
 * is *the refusal read as an absence* wearing a null: a repository with no
 * remote at all and a repository that is perfectly pushed both rendered as
 * nothing printed. `unpushedWhy` is that reason, and `repoLine` prints it.
 */
export function countUnpushed(dir) {
  const out = { unpushed: null, unpushedBasis: null, unpushedFrom: null, unpushedWhy: null };
  const count = (basis, from) => {
    const n = git(dir, ['rev-list', '--count', `${basis}..HEAD`]);
    if (n === null || !/^\d+$/.test(n)) return false;
    out.unpushed = Number(n); out.unpushedBasis = basis; out.unpushedFrom = from;
    return true;
  };
  const upstream = git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (upstream && count(upstream, 'upstream')) return out;
  /* origin/HEAD first, because it is what the remote itself says its default
   * branch is; the two guesses after it are for a clone that never set it. Each
   * is verified to EXIST before it is counted against, so a wrong guess falls
   * through to the reason below rather than to a number about nothing. */
  const head = git(dir, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  for (const ref of [head, 'origin/main', 'origin/master']) {
    if (!ref || !/^origin\//.test(ref)) continue;
    if (git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === null) continue;
    if (count(ref, 'default-branch')) return out;
  }
  out.unpushedWhy = upstream
    ? `counting ${upstream}..HEAD failed, and no origin default branch could be resolved either`
    : 'the branch has no upstream and no origin/HEAD, origin/main or origin/master to count against — is a remote configured?';
  return out;
}

export const DETACHED = '(detached)';

/*
 * OA-387. WHAT A DETACHED HEAD ACTUALLY IS, measured rather than asserted.
 *
 * `portal-write` used to say of any checkout that was not on `main` that the
 * branch was "somebody's live work". For two days in September 2026 that
 * sentence was said about the portal every hour and it was false every time:
 * a finished worktree held the `main` branch name, `git checkout main` in the
 * primary checkout therefore failed, and the deploy procedure's
 * `git checkout origin/main` had left a detached HEAD nothing could undo.
 * Eleven ticks in a row read *somebody's live work*, correctly declined to
 * deliver, and none of them went and looked — because a verdict that says
 * somebody is mid-task reads as transient, and residue is the opposite: it
 * will still be there tomorrow. That is the same fault as OA-375, a false
 * reason sitting in front of the one action that clears the estate's red.
 *
 * So this asks the two questions that separate them, and the answer to each
 * is carried rather than folded into a verdict:
 *
 *   ancestor — is the detached commit already on origin/<expect>? If it is,
 *     nothing is stranded here: the checkout is standing on published history
 *     and the only thing wrong is that no branch name points at it. If it is
 *     NOT, somebody's commits are sitting on no branch at all, which is the
 *     one shape where waiting is the right advice.
 *
 *   heldBy — which worktree holds <expect>, when one does. This is the fact a
 *     reader needs and cannot guess: it is WHY the branch cannot simply be
 *     checked out again, and `git worktree list` has had it all along.
 *
 * THREE ANSWERS, NOT TWO. `ancestor` is null for COULD NOT LOOK — no
 * origin/<expect> to compare against, or a git call that failed for any other
 * reason — and the rule treats null as the stricter verdict, never as residue.
 * A repository object carrying no `detached` field at all (a synthetic
 * conditions object in a harness, a reader written before today) is the same
 * refusal and is handled the same way.
 */
export function readDetachment(dir, expect = 'main') {
  const out = { state: 'refused', why: null, head: null, ref: null, ancestor: null, heldBy: null };
  out.head = git(dir, ['rev-parse', '--short', 'HEAD']);
  const ref = `origin/${expect}`;
  if (git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === null) {
    out.why = `there is no ${ref} in this checkout to compare the detached commit against`;
    out.heldBy = worktreeHolding(dir, expect);
    return out;
  }
  out.ref = ref;
  const anc = gitSucceeds(dir, ['merge-base', '--is-ancestor', 'HEAD', ref]);
  if (anc === null) {
    out.why = `git could not answer whether HEAD is an ancestor of ${ref}`;
    out.heldBy = worktreeHolding(dir, expect);
    return out;
  }
  out.state = 'read';
  out.ancestor = anc;
  out.heldBy = worktreeHolding(dir, expect);
  return out;
}

/* The worktree holding a branch, if it is not this one. `--porcelain` emits
 * stanzas of `worktree <path>` / `branch refs/heads/<name>`, so the branch line
 * is read against the path that preceded it rather than against the newest one
 * seen. A checkout that cannot answer at all returns null, which prints nothing
 * — the absence of a name is not a claim that no worktree holds it. */
export function worktreeHolding(dir, branch) {
  const out = git(dir, ['worktree', 'list', '--porcelain']);
  if (!out) return null;
  const here = path.resolve(dir).replace(/\\/g, '/').toLowerCase();
  let at = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) at = line.slice(9).trim().replace(/\\/g, '/');
    else if (line === `branch refs/heads/${branch}` && at && path.resolve(at).replace(/\\/g, '/').toLowerCase() !== here) return at;
  }
  return null;
}

export function readRepo({ key, label, name, dir, expect = 'main', now = Date.now() }) {
  const repo = { key, label, name, dir, present: false, readable: false, branch: null, expect };
  repo.staged = []; repo.modified = []; repo.untracked = []; repo.dirtyAges = {};
  repo.unpushed = null; repo.unpushedBasis = null; repo.unpushedFrom = null; repo.unpushedWhy = null;
  repo.touchedTop = []; repo.touchesMapData = false;
  repo.detached = null;

  if (!dir || !existsSync(dir)) return repo;
  repo.present = true;
  if (git(dir, ['rev-parse', '--is-inside-work-tree']) !== 'true') return repo;
  repo.readable = true;
  repo.branch = git(dir, ['branch', '--show-current']) || DETACHED;
  // OA-387. Measured beside the branch read that produced it, so the verdict
  // and the evidence for it can never come from two different reads of the
  // disk — the property OA-386's dirt ages are built on and for the same
  // reason. A checkout on a named branch carries null: there is nothing to ask.
  repo.detached = repo.branch === DETACHED ? readDetachment(dir, expect) : null;

  // --untracked-files=normal, not =all: an untracked FOLDER arrives as one entry
  // rather than every file under it. A session mid-task has untracked scratch
  // everywhere, and a conditions block that lists all of it is one nobody reads.
  const st = git(dir, ['status', '--porcelain', '--untracked-files=normal']);
  if (st) {
    for (const line of st.split(/\r?\n/)) {
      if (line.length < 4) continue;
      const x = line[0], y = line[1], p = porcelainPath(line.slice(3));
      if (x === '?' && y === '?') repo.untracked.push(p);
      else {
        if (x !== ' ' && x !== '?') repo.staged.push(p);
        if (y !== ' ' && y !== '?') repo.modified.push(p);
      }
    }
  }
  repo.touchedTop = topFolders(repo);
  repo.touchesMapData = mapDataHits(repo).length > 0;
  // OA-386 item 2. Read here, beside the paths it is about, so the age and the
  // path list can never come from two different reads of the disk.
  repo.dirtyAges = readDirtyAges(dir, allPaths(repo), now);

  // Ahead of its own remote-tracking ref. Deliberately NOT a fetch: this tool
  // promises to touch the network only in --url mode, and a fetch inside a
  // read-only status command is exactly the kind of side effect nobody expects.
  // So this answers "have I pushed what I committed", never "has someone else".
  Object.assign(repo, countUnpushed(dir));

  repo.dirty = isDirty(repo);
  repo.offMain = isOffMain(repo);
  return repo;
}

/* A claim dated before today is one nobody is working: sessions here do not
 * live overnight, so yesterday's claim is the residue of a collision that ended
 * rather than evidence of one in progress. The number is assemble.mjs's
 * STALE_AFTER_DAYS and is kept equal to it on purpose — the board and `--who`
 * are read side by side, and two thresholds that disagreed would be worse than
 * either. A null age (a `selected:` line whose date would not parse) is NOT
 * stale: "could not look" is a third answer, never a finding. */
export const STALE_CLAIM_AFTER_DAYS = 1;
export const isStaleClaim = (x) => x && x.ageDays !== null && x.ageDays >= STALE_CLAIM_AFTER_DAYS;

// The claims other sessions have written down. This is the one signal that says
// what somebody is DOING rather than what they have touched, and it is direct
// evidence: a claim is a session's own statement, checked in and pushed.
//
// `now` is INJECTABLE rather than read from the clock inside the loop, because
// the only interesting case here is an age, and a harness that cannot set the
// date can only assert an age against the day it happens to run.
export function readClaims(busesDir, selfSession, now = Date.now()) {
  const dir = path.join(busesDir, 'Development Docs', 'open-actions');
  if (!existsSync(dir)) return [];
  const today = now;
  const out = [];
  let files;
  try { files = readdirSync(dir).filter((f) => /^OA-\d+\.md$/.test(f)).sort(); } catch { return []; }
  for (const f of files) {
    let head;
    try { head = readFileSync(path.join(dir, f), 'utf8').slice(0, 2000); } catch { continue; }
    const m = /^selected:\s*(\d{4}-\d{2}-\d{2})\s*,\s*([^,\n]+?)\s*(?:,\s*([^\n]*))?$/m.exec(head);
    if (!m) continue;
    const days = Math.floor((today - new Date(`${m[1]}T00:00:00Z`)) / 86400000);
    out.push({
      ref: f.replace('.md', ''), date: m[1], session: m[2].trim(),
      note: (m[3] || '').trim(), ageDays: Number.isFinite(days) ? days : null,
      self: !!selfSession && m[2].trim() === selfSession,
    });
  }
  return out;
}

/*
 * THE BACKLOG'S DECISION MARKER, JOINED TO THE BOARD IT WAS ASSERTED TO REACH
 * (OA-414, 2026-09-20).
 *
 * `decision: peter` in an action's front matter marks a row whose next move is
 * his. `assemble.mjs` prints PETER'S DECISION into the index and drops the row
 * from the loop's open-actions feed, and OA-340 said in as many words that it
 * also took the row out of THIS board's housekeeping band. It did not: every
 * board row is recomputed from the map tree, the portal queues or the disk, and
 * not one of them joins to an action file. On 2026-09-20 a tick took row 6, *8
 * towns were drawn by an older engine*, three hours after that exact re-stamp
 * was marked his — re-derived that it could not finish it, and put it down.
 *
 * WHY THE ACTION NAMES THE ROW AND NOT THE OTHER WAY ROUND. A board row is
 * computed; an action is written. The row cannot know which action owns it
 * without somebody saying so, and the person who knows is the one writing the
 * marker. So the join is a `boardRows:` field beside `decision:`, carrying the
 * row keys that decision owns — the same keys a hold names in `**Blocks:**`,
 * because it is the same question asked from the other end of the backlog.
 *
 * WHY IT REUSES applyHolds RATHER THAN GATING THE ROW ITSELF. A row that
 * VANISHED would take its age, its measurement and its link with it, and the
 * chore is still true: eight towns really are behind. What the row loses is the
 * right to be read as an instruction, which is exactly what a hold does to it
 * already (OA-283). One mechanism, one renderer, two sources — and `origin`
 * says which, because the two point a reader at different files.
 *
 * WHY `boardRows:` IS NOT READ WITHOUT `decision:`. A field that acts on its own
 * would be a second, quieter way of suppressing a board row, reachable by any
 * action and answerable to nobody. `assemble.mjs` refuses the combination at
 * filing time; this reader refuses it again, because the board is read from a
 * worktree whose index the assembler has not seen.
 *
 * @param {string} busesDir  the buses-data checkout
 * @returns {Array<{key, ref, file, headline, need, raw, origin, source}>}
 */
export function readDecisionRows(busesDir) {
  const dir = path.join(busesDir, 'Development Docs', 'open-actions');
  if (!existsSync(dir)) return [];
  let files;
  try { files = readdirSync(dir).filter((f) => /^OA-\d+\.md$/.test(f)).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    let head;
    try { head = readFileSync(path.join(dir, f), 'utf8').slice(0, 4000); } catch { continue; }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    if (!fm) continue;
    const field = (k) => {
      const m = new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(fm[1]);
      return m ? m[1].replace(/^"(.*)"$/, '$1').trim() : '';
    };
    if (field('decision').toLowerCase() !== 'peter') continue;
    const raw = field('boardRows');
    if (!raw) continue;
    const keys = raw.split(/[,\s]+/).map((k) => k.replace(/^`|`$/g, '').trim()).filter(Boolean);
    for (const key of keys) {
      out.push({
        key,
        ref: f.replace('.md', ''),
        file: f,
        headline: `${f.replace('.md', '')} owns this row and is marked \`decision: peter\``,
        need: field('headline'),
        raw,
        origin: 'decision',
        source: `Development Docs/open-actions/${f}`,
      });
    }
  }
  return out;
}

/*
 * Gate the board rows those decisions own, and say so when one names nothing.
 *
 * WHY THE WHOLE JOIN IS HERE AND ONE LINE IS IN worklist.mjs. The reader above
 * and the warning below are one argument, and splitting them would put the
 * reasoning in one file and the sentence a reader actually sees in another —
 * which is how a warning ends up saying something its own parser never meant.
 * `applyHolds` and `groupUnmatched` are INJECTED rather than imported because
 * they live in `loop_your_move.mjs`, which imports nothing from here today and
 * must go on being free to.
 *
 * UNMATCHED IS ITS OWN SENTENCE AND NOT THE HOLD ONE. A hold's key can go stale
 * because the queue it named drained, or because this run could not reach the
 * portal at all, which is why that warning has three branches about whether the
 * board could even look — a confident *the row has cleared* was printed on
 * 2026-09-09 about a hold that was working perfectly. A `boardRows:` key names a
 * row computed from the MAP TREE and the disk, both of which every run reads
 * whatever else it can reach, so there is no "could not check" case to hedge:
 * the key is wrong, or the chore is done and the marker can go with it.
 *
 * @param {string} busesDir
 * @param {Array} items  the board's rows, mutated in place with `onHold`
 * @param {{applyHolds: Function, groupUnmatched: Function}} fns
 * @returns {string[]} warnings, one per action file whose field matched nothing
 */
export function applyDecisionRows(busesDir, items, { applyHolds, groupUnmatched }) {
  const { unmatched } = applyHolds(items, readDecisionRows(busesDir));
  return groupUnmatched(unmatched).map((g) => {
    const plural = g.keys.length > 1;
    return `Development Docs/open-actions/${g.file} carries \`boardRows: ${g.raw}\`, and ${plural ? 'none of those keys is' : 'that key is'} a row on this board — the marker gated nothing. `
      + 'Either the chore has been done and the field can go with it, or the key is misspelt; the keys are the `key:` values in worklist.mjs.';
  });
}

/*
 * THE FILE'S MTIME IS NOT THE SESSION'S LAST TURN, and on 2026-09-10 that was
 * measured here rather than reasoned about. `sched-1715` read this line saying
 * "2 session transcript(s) written in the last 20 min" while deciding whether
 * the working tree was MOVING or STILL. One of the two was itself. The other
 * was `sched-1115`, whose transcript ended at 10:23:56Z — and whose file had an
 * mtime of 16:14Z, five hours and fifty minutes later. Its last two lines were
 * a `last-prompt` and a `custom-title` record, neither of which carries a
 * timestamp at all: something appended bookkeeping to a finished session, and
 * the mtime moved with no turn behind it. A dead tick was being reported as a
 * live peer, in the one line a stopped tick consults to decide whether the
 * obstruction in front of it will clear itself.
 *
 * SO THE MTIME IS DEMOTED TO A PREFILTER AND THE ANSWER COMES FROM THE CONTENT.
 * That ordering is what keeps it cheap: an append only ever moves an mtime
 * FORWARD, so mtime-in-window is a strict superset of turn-in-window, and the
 * tail read happens only for the handful of files that pass. Everything else is
 * one stat, exactly as before — 298 files scanned, 2 tails read, on the run that
 * found this.
 *
 * THE FALLBACK IS THE OLD BEHAVIOUR AND NOT SILENCE. A tail that cannot be read
 * or holds no timestamp keeps its mtime, because the floor for this signal is
 * what it already gave: a proxy that sometimes says "recent" when it should say
 * "stale" is the thing being fixed, and a fix that answers "nothing is running"
 * on an unreadable file would be worse than the fault.
 *
 * STILL CONTEXT, STILL NEVER A VERDICT. See the header. This closes the third
 * way it was wrong; the two the header names — an idle session sitting at a
 * prompt, a crashed one with a fresh transcript — are properties of what a
 * transcript IS and no amount of reading it more carefully touches them.
 */
const TAIL_BYTES = 64 * 1024;

/* The latest `"timestamp":"…"` in the tail of a JSONL transcript that is no later
 * than `capMs`, as ms, or null.
 *
 * THE GREATEST RATHER THAN THE LAST, and that is not fussiness. A transcript
 * carries tool output verbatim, and this project's own tools print JSON with
 * timestamp fields in it — so the final match in the tail may be a string
 * somebody pasted rather than the record that ended the session, in either
 * direction. Taking the maximum makes an older pasted stamp harmless, and the
 * cap makes a newer one harmless.
 *
 * CAPPED AT THE MTIME, because a file cannot have been written after it was
 * written: skew, or a future date inside pasted text, must not invent activity
 * or produce a negative age in the printed line.
 *
 * Scanned as latin1 rather than utf8 on purpose: the chunk starts at an
 * arbitrary byte offset and may split a multi-byte character, and the pattern
 * being matched is pure ASCII. */
export function lastEntryMs(file, capMs = Infinity) {
  let fd;
  try { fd = openSync(file, 'r'); } catch { return null; }
  try {
    const size = statSync(file).size;
    const len = Math.min(size, TAIL_BYTES);
    if (!len) return null;
    const buf = Buffer.allocUnsafe(len);
    const got = readSync(fd, buf, 0, len, Math.max(0, size - len));
    const text = buf.toString('latin1', 0, got);
    const hits = text.match(/"timestamp":"[^"]+"/g);
    if (!hits) return null;
    let best = null;
    for (const h of hits) {
      const ms = Date.parse(h.slice(13, -1));
      if (Number.isFinite(ms) && ms <= capMs && (best === null || ms > best)) best = ms;
    }
    return best;
  } catch { return null; }
  finally { closeSync(fd); }
}

/*
 * `excludeId` IS WHAT MAKES A QUIESCENCE READING POSSIBLE AT ALL, and it exists
 * for exactly one caller: a scheduled tick asking whether ANYBODY ELSE is still
 * working (buses-data OA-294, Peter's YES, 2026-09-11).
 *
 * A tick always has a fresh transcript of its own — it is taking a turn as it
 * asks — so the unfiltered `newestAgeMin` is 0 on every run and can never
 * answer "has everyone gone quiet". The caller passes its own session id and
 * that one file is left out of `otherCount` and `newestOtherAgeMin`.
 *
 * A SESSION'S OWN ID IS ON ITS SCRATCHPAD PATH, measured 2026-09-11 rather than
 * assumed: the UUID in `…\Temp\claude\<project>\<uuid>\scratchpad` is the
 * basename of that session's own `<uuid>.jsonl` under `~/.claude/projects/`.
 * That is the only self-identifying string a fresh session is handed.
 *
 * `excludedFound` IS THE LOAD-BEARING HALF AND IT FAILS SAFE. An id that
 * matches no transcript means the exclusion did nothing, so the reading is NOT
 * self-excluded and a caller that trusted it would be reading its own freshness
 * back as a peer's. `quiescentMin` is therefore null unless the id was actually
 * seen — never a number that merely happens to be right. A typo, a renamed
 * transcript or a session whose file has not been created yet all land on null,
 * and null must read as "cannot tell", never as "quiet".
 *
 * STILL CONTEXT, STILL NEVER A VERDICT. The header's rule is unchanged: this
 * scores nothing. It reports an age, and the conjunction that may act on it
 * lives in the loop's stored task prompt, not here.
 */
/*
 * THE TAIL PREFILTER HAS TO REACH AS FAR BACK AS THE QUESTION DOES, and getting
 * this wrong would have made the whole reading useless in the safe direction.
 * The tail is read only for files whose mtime is inside the window, because an
 * append only moves an mtime forward — but with a 20-minute window every
 * transcript older than that keeps its MTIME as its age, and an mtime is the
 * signal the header above demotes. The `sched-1115` case is exactly this: a
 * session whose last turn was 5h50m before its mtime. Read at a 20-minute
 * window it would report as 0 minutes idle for ever and block every adoption.
 *
 * So when a caller asks a quiescence question, the tail prefilter widens to
 * `quiesceMin` while the COUNT window stays where it was. Beyond that horizon
 * no tail is read and the mtime stands — which is sound, because mtime-age is
 * always SMALLER than turn-age, so an mtime older than the horizon guarantees a
 * turn older than the horizon. The verdict `quiescentMin >= quiesceMin` is
 * therefore exact at the only boundary anybody tests it on.
 */
export function readPeerActivity({ windowMin = 20, projectsDir, match = /Buses/i, now = Date.now(), excludeId = null, quiesceMin = 90 } = {}) {
  const root = projectsDir || path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'projects');
  const out = {
    windowMin, quiesceMin, count: 0, newestAgeMin: null, scanned: 0, tailed: 0, demoted: 0, ok: false,
    excludeId: excludeId || null, excludedFound: false,
    otherCount: 0, newestOtherAgeMin: null, quiescentMin: null,
  };
  if (!existsSync(root)) return out;
  let dirs;
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && match.test(e.name)); } catch { return out; }
  const cutoff = now - windowMin * 60000;
  /* Widened only when somebody is actually asking a quiescence question; an
   * ordinary board read is one stat per file exactly as it always was. */
  const tailCutoff = excludeId !== null
    ? Math.min(cutoff, now - quiesceMin * 60000)
    : cutoff;
  for (const d of dirs) {
    const p = path.join(root, d.name);
    let entries;
    try { entries = readdirSync(p).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of entries) {
      const full = path.join(p, f);
      let s;
      try { s = statSync(full); } catch { continue; }
      out.scanned++;
      const isSelf = excludeId !== null && f === `${excludeId}.jsonl`;
      if (isSelf) out.excludedFound = true;
      let at = s.mtimeMs;
      if (s.mtimeMs >= tailCutoff) {
        out.tailed++;
        const entry = lastEntryMs(full, s.mtimeMs);
        if (entry !== null) {
          at = entry;
          if (entry < cutoff) out.demoted++;
        }
      }
      if (at >= cutoff) out.count++;
      const age = Math.floor((now - at) / 60000);
      if (out.newestAgeMin === null || age < out.newestAgeMin) out.newestAgeMin = age;
      if (!isSelf) {
        if (at >= cutoff) out.otherCount++;
        if (out.newestOtherAgeMin === null || age < out.newestOtherAgeMin) out.newestOtherAgeMin = age;
      }
    }
  }
  /* Only meaningful when the caller's own transcript was actually found and
   * skipped. See `excludedFound` above: null means "cannot tell". */
  if (out.excludedFound) out.quiescentMin = out.newestOtherAgeMin;
  out.ok = true;
  return out;
}

export function readConditions({ buses, portal, engine, selfSession, selfId = null, now = Date.now(), projectsDir, peerWindowMin = 20 } = {}) {
  const repos = {
    buses: readRepo({ key: 'buses', label: 'this tree', name: 'buses-data', dir: buses, now }),
    engine: readRepo({ key: 'engine', label: 'the engine', name: 'claude-skills', dir: engine, now }),
    portal: readRepo({ key: 'portal', label: 'the portal', name: 'community-bus-maps', dir: portal, now }),
  };
  const out = {
    at: new Date(now).toISOString(),
    repos,
    claims: buses ? readClaims(buses, selfSession, now) : [],
    /* OA-287. The one fact here that git cannot supply: `loop/` is gitignored,
     * so a held lock can never reach the `buses-tree` verdict as an uncommitted
     * file, and every reader of that verdict was blind to the loop by
     * construction. Absent when there is no buses tree to look in, which is the
     * normal case in a harness fixture and in CI. */
    loopLock: buses ? readLoopLock(buses, { selfSession, now }) : null,
    /* `peerWindowMin` stays 20 for the printed line, which is a "is anything
     * moving right now" hint. The 90-minute quiescence test OA-294 needs is a
     * DERIVED age (`peers.quiescentMin`), not a second scan: `newestOtherAgeMin`
     * is an age in minutes regardless of the window, so one pass answers both. */
    peers: readPeerActivity({ windowMin: peerWindowMin, projectsDir, now, excludeId: selfId }),
    selfSession: selfSession || null,
    selfId: selfId || null,
  };
  /* OA-301, applied at read time so the JSON the loop reads already carries it.
   * `loop/` is gitignored, so an absent folder — every fixture, every clone, CI
   * — accounts for nothing and the verdict is exactly what it was before. */
  accountFor(out.repos.buses, buses ? heldPaths(readYourMoveDir(path.join(buses, 'loop', 'your-move'))) : []);
  /* OA-386 item 2, and it is derived AFTER the subtraction above for the reason
   * OA-301 gives: the count, the folder list, the staged test and now the age
   * must all come from the same unaccounted set, or the block can print an age
   * for a file the verdict did not count. */
  for (const r of Object.values(out.repos)) r.dirtyAge = dirtyAge(r);
  return out;
}

// ---- the rules -------------------------------------------------------------
/*
 * Each resource is one question: what does doing this thing actually touch, and
 * what about the world right now makes that a bad idea? A rule returns a verdict
 * and a sentence that NAMES ITS EVIDENCE — "the portal checkout is on
 * oa-220-…", not "there may be contention". A reason you cannot check is a
 * reason you will learn to skip.
 */
const RULES = {
  'buses-tree': (c) => {
    const r = c.repos.buses;
    if (!r.readable) return [CHECK, `could not read the state of ${r.name} at ${r.dir} — assume nothing`];
    // OA-301: a dirty letter a live hold names is accounted for and not counted.
    // The count, the folders and the staged test all come from the SAME
    // subtracted list, so the sentence cannot name a file it did not count.
    const paths = unaccountedPaths(r);
    const n = paths.length;
    if (!n) return [SAFE, null];
    const top = unaccountedTop(r);
    const where = top.slice(0, 4).join(', ') + (top.length > 4 ? ', …' : '');
    const staged = paths.filter((p) => r.staged.includes(p)).length;
    if (staged) {
      return [CHECK, `${n} uncommitted file(s) here (${where}), ${staged} already STAGED in the shared index — commit with a pathspec (git commit -m "…" -- <paths>), never a bare commit`];
    }
    return [CHECK, `${n} uncommitted file(s) here (${where}) — this tool cannot tell yours from a neighbour's; read them, then stage by name and commit with a pathspec`];
  },

  engine: (c) => {
    const r = c.repos.engine;
    if (!r.readable) return [CHECK, `could not read the state of ${r.name} at ${r.dir} — a byte verdict from an unknown engine means nothing`];
    if (isOffMain(r)) return [CHECK, `the engine checkout is on ${r.branch}, not ${r.expect || 'main'} — anything you build or gate is drawn by that branch`];
    const n = r.staged.length + r.modified.length;
    if (!n) return [SAFE, null];
    return [CHECK, `${n} uncommitted change(s) in the engine — a build or a gate would measure work in progress, and its verdict would be true of nobody's engine`];
  },

  'estate-sweep': (c) => {
    const r = c.repos.buses;
    if (!r.readable) return [CHECK, `could not read the state of ${r.name} — a sweep re-records from whatever it finds`];
    const hits = mapDataHits(r);
    if (hits.length) {
      return [DELAY, `${hits.length} uncommitted file(s) under Areas/, Places/ or ci-reference/ (${hits.slice(0, 2).join(', ')}${hits.length > 2 ? ', …' : ''}). A sweep re-records from every sheet it can FIND, and has already absorbed a neighbour's uncommitted ci-reference/`];
    }
    // OA-301: the same subtraction as buses-tree. A held letter cannot be swept
    // into a quality ledger; the map-data test two lines up is untouched by it.
    if (unaccountedPaths(r).length) return [CHECK, 'the tree is not clean — take a copy of any shared file the sweep writes, and diff it afterwards'];
    return [SAFE, null];
  },

  'portal-write': (c) => {
    const p = c.repos.portal, b = c.repos.buses;
    if (!p.readable) return [CHECK, `could not read the state of ${p.name} at ${p.dir}`];
    /*
     * OA-387. TWO THINGS LOOK ALIKE HERE AND ONLY ONE OF THEM CLEARS ITSELF.
     * A named branch that is not `main` is somebody working — waiting is the
     * right advice, so it stays BETTER TO DELAY. A DETACHED head standing on
     * published history is residue the deploy procedure leaves behind by
     * design, and nothing will ever clear it: that is CHECK FIRST, which in
     * this module means go and look, and the reason says what to look at and
     * why the branch cannot simply be checked out again. The verdict grade is
     * the smaller half of the fix; the sentence is the half that cost eleven
     * ticks, because *somebody's live work* reads as transient.
     */
    if (isOffMain(p)) {
      const want = p.expect || 'main';
      if (p.branch !== DETACHED) {
        return [DELAY, `the portal checkout is on ${p.branch}, not ${want} — a deliver from here carries that branch, and the branch is somebody's live work`];
      }
      /* A detached checkout whose conditions object carries no reading — a
       * synthetic world in a harness, a caller written before this landed — is
       * a REFUSAL and not a licence to reuse the old sentence. Falling back to
       * *somebody's live work* here would reinstate the exact false claim this
       * rule was rewritten to stop making, on the one input that cannot answer
       * back. */
      const d = p.detached || { state: 'refused', ancestor: null, head: null, ref: null, heldBy: null, why: 'nothing measured the detachment — this conditions object carries no reading' };
      const held = d.heldBy ? ` The worktree at ${d.heldBy} holds ${want}, which is why checking it out again fails.` : '';
      const dirt = isDirty(p) ? ` There are also ${p.staged.length + p.modified.length} uncommitted change(s) here.` : '';
      if (d.ancestor === true) {
        return [CHECK, `the portal checkout is detached at ${d.head}, a commit already on ${d.ref} — this is residue from the deploy procedure, not somebody's work, and nothing clears it on its own.${held}${dirt} Restore it first: git -C "${p.dir}" checkout ${want}`];
      }
      if (d.ancestor === false) {
        return [DELAY, `the portal checkout is detached at ${d.head}, and that commit is NOT on ${d.ref} — it is work nobody has landed, sitting on no branch, so a deliver from here would commit onto no branch either.${held}${dirt}`];
      }
      return [DELAY, `the portal checkout is detached at ${d.head || 'an unknown commit'} and this tool COULD NOT LOOK to see whether that is deploy residue or somebody's unlanded work — ${d.why || 'no reason recorded'}.${held}${dirt} Check by hand before delivering`];
    }
    if (b.readable && b.unpushed > 0) return [CHECK, `${b.name} has ${b.unpushed} unpushed commit(s)${b.unpushedFrom === 'default-branch' ? ` (counted against ${b.unpushedBasis}, which is where they would land)` : ''} — push this side FIRST; the portal's verify.yml reads whatever is on this repo's main at that moment`];
    // OA-313. A count that could not be taken is not a count of zero. Before
    // this, a buses-data checkout with no upstream and no origin said nothing
    // here and the row read SAFE NOW — the shape named as *the refusal read as
    // an absence*, and the one direction in which being wrong ships a deliver
    // against fixtures GitHub has never seen.
    if (b.readable && b.unpushed === null) return [CHECK, `could not count what ${b.name} has not pushed — ${b.unpushedWhy || 'no basis to count against'}. The portal's verify.yml reads whatever is on that repo's main, so check by hand before delivering`];
    if (isDirty(p)) return [CHECK, `${p.staged.length + p.modified.length} uncommitted change(s) in the portal checkout`];
    return [SAFE, null];
  },

  /*
   * OA-287. The scheduled loop's mutex, read from the one place it exists.
   *
   * THE THREE GREENS BELOW ARE LOAD-BEARING AND EACH IS A DIFFERENT MISTAKE
   * THIS RULE COULD MAKE.
   *
   *   Held by ME is SAFE, or the rule blocks its own holder for ever — and it
   *   would then pass every red case in the harness while being useless. Same
   *   shape the estate-sweep rule was caught in on the day that harness was
   *   written.
   *
   *   A TICK's lock past its lease is SAFE, and this one is not obvious. The
   *   loop runs the conditions check at step 2 and takes the lock at step 3,
   *   and step 3 is where the steal rule lives. A CHECK FIRST here would stop
   *   the next tick before it ever reached the line entitled to recover a
   *   crashed run — this rule would have disabled the loop's own crash
   *   recovery. So it stays quiet and leaves that decision where the design
   *   puts it. The facts remain in `conditions.loopLock` for anyone reading.
   *
   *   ABSENT is SAFE. This runs in harness fixtures, in a fresh clone and in
   *   CI, none of which have a `loop/` folder at all, and every synthetic world
   *   in prove-red-concurrency.mjs omits the field entirely.
   *
   * A PERSON's lock past its lease is CHECK FIRST rather than SAFE, because a
   * tick never steals from a name that is not a tick's: nothing will clear it
   * for you, and an idle session looks exactly like an abandoned one.
   *
   * AND `mine` IS FALSE UNTIL SOMEBODY PASSES `--session`, WHICH MAKES THE
   * FIRST GREEN ABOVE CONDITIONAL ON A FLAG NOBODY IS OBLIGED TO REMEMBER.
   * Measured on 2026-09-10 by sched-2215, which took the lock at step 3 and
   * then re-read the board — which step 4 of the task prompt requires it to do
   * — and was told by five rows that `sched-2215 holds loop/LOCK.d ... that is
   * a run in progress on the shared trees`. Every contending row went DELAY
   * with the reader's own name as the reason. On the dirty tree of that
   * afternoon it changed no count, because `buses-tree` was already hiding the
   * same five; on a CLEAN tree it takes every buses-tree, engine and
   * estate-sweep row from SAFE to DELAY, and `--safe-only` then hides them and
   * prints `SAFE NOW - nothing on this list is contended`. So the failure is
   * masked by an unrelated fault and shows itself only when the tree is well.
   *
   * The rule cannot work out that it is being read by its own holder - nothing
   * connects a node process to the name in that file. What it CAN do is stop
   * being a dead end: the claims block three hundred lines below has said
   * `(one of those may be you - pass --session ...)` since it was written, and
   * this one said nothing. The hint carries the holder's own name, so a tick
   * reading `pass --session sched-2215` needs no further thought.
   */
  'loop-lock': (c) => {
    const L = c.loopLock;
    if (!L || !L.present) return [SAFE, null];
    if (L.mine) return [SAFE, null];
    if (!L.readable) return [CHECK, 'loop/LOCK.d is held and its holder file cannot be read — something took the loop\'s lock without saying who; read the directory before you start anything that writes'];
    const who = L.name || 'an unnamed holder';
    const age = L.ageMin === null ? 'for an unknown time' : `${fmtMin(L.ageMin)} ago`;
    /* Only when no name was given: with --session passed, a holder that is not
     * you really is somebody else and the hint would be a lie. */
    const mayBeYou = (!c.selfSession && L.name)
      ? ` — if that is YOU, nothing told this board so: re-run it with --session ${L.name} and this row goes back to what it would say with no lock at all`
      : '';
    /* buses-data OA-407. THE VERDICT IS DELIBERATELY UNCHANGED and the sentence
     * is what moves. `loop_lock.mjs` has already disbelieved the holder and
     * rebuilt both times from the directory's own mtime, so the age and the
     * lease in this sentence are right — there is nothing left for a person to
     * decide, and reddening the board for a holder that is correctly running is
     * going red for a chore. What was actually broken was that the board stated
     * a wrong number in a confident voice; the cure is that the number is right
     * and the voice says which clock it came from. Escalating this to CHECK
     * would also put a live tick's lock in front of the next tick's step-2 gate,
     * which is the harm the two quiet verdicts above exist to prevent. */
    const stamp = L.stampSuspect
      ? ` — and its holder file was DISBELIEVED: ${L.stampWhy}, so the times here are the directory's own mtime and a ${fmtMin(L.leaseMin)} lease from it, not what the file says`
      : '';
    if (L.isTick && L.expired) return [SAFE, null];
    if (L.expired) {
      return [CHECK, `${who} has held loop/LOCK.d since ${age} and its lease ran out ${fmtMin(L.overdueMin)} ago — a person's lock is never stolen, so nothing will clear it for you: read it, and delete the directory if nobody is behind it${stamp}${mayBeYou}`];
    }
    return [DELAY, `${who} holds loop/LOCK.d, taken ${age}, lease live for another ${fmtMin(L.remainMin)} — that is a run in progress on the shared trees, not a stale file${stamp}${mayBeYou}`];
  },

  'portal-deploy': (c) => {
    const p = c.repos.portal;
    if (!p.readable) return [CHECK, `could not read the state of ${p.name} at ${p.dir}`];
    if (isOffMain(p)) return [DELAY, `npm run deploy ships the CHECKED-OUT commit, and this checkout is on ${p.branch}, not ${p.expect || 'main'}`];
    if (isDirty(p)) return [CHECK, `${p.staged.length + p.modified.length} uncommitted change(s) in the portal checkout — deploy ships the commit, not these`];
    return [SAFE, null];
  },
};

/*
 * A SHORT NAME PER RESOURCE, and the reason it had to exist. The first working
 * version printed each contended resource's full sentence on every row -- two
 * lines of identical prose repeated nineteen times, burying the titles it was
 * meant to help you read. Every fact in it was correct and the shape was
 * unusable, which is its own recorded failure here.
 *
 * So a fact is stated ONCE, in the conditions block, and the rows NAME it.
 */
export const NEED_LABEL = {
  'buses-tree': 'the shared working tree',
  engine: 'the engine repo',
  'estate-sweep': 'an estate-wide sweep',
  'portal-write': 'delivery to the live portal',
  'portal-deploy': 'a portal deploy',
  'loop-lock': "the scheduled loop's lock",
};

/*
 * OA-287. WHICH WORK THE LOOP CAN CONTEND FOR, and it is a fact about the loop
 * rather than a judgement about risk. Until 2026-09-17 a tick NEVER pushed — a
 * deny rule in buses-data's settings, observed refusing — so it could neither
 * deliver a map nor deploy the portal, and the two portal resources were
 * genuinely not contended. buses-data OA-394 (R1 of the 2026-09-17 process
 * review, Peter's decision) gave the tick the push, the pull request, the merge
 * and the DEPLOY, so a deploy is contended now and the harness assertion the
 * old comment promised would go red has been flipped. Delivery of a map was
 * NOT in that grant, so `portal-write` stays outside the set on purpose.
 */
const LOOP_CONTENDS = new Set(['buses-tree', 'engine', 'estate-sweep', 'portal-deploy']);

export function assess(needs, conditions) {
  let verdict = SAFE;
  const reasons = [];
  /* OA-287, and stated ONCE here rather than added to a dozen returns in
   * needsOf(). Attaching it at the boundary is what keeps the empty list empty:
   * `ci-red-` and `loop-hold-` rows return [] on purpose so that --safe-only
   * can never hide the row saying the repository is broken or that the loop has
   * stopped, and a guard written case by case is exactly how that gets undone by
   * somebody adding the thirteenth case. */
  const list = [...(needs || [])];
  if (list.some((n) => LOOP_CONTENDS.has(n))) list.unshift('loop-lock');
  for (const need of list) {
    const rule = RULES[need];
    if (!rule) continue;
    const [v, why] = rule(conditions);
    if (v !== SAFE) { verdict = worse(verdict, v); reasons.push({ need, verdict: v, why }); }
  }
  return { verdict, reasons };
}

/*
 * WHAT A ROW ACTUALLY TOUCHES. Keyed on the item KEY where the type is too
 * coarse to be honest: `housekeeping` covers both an estate-wide rollout and a
 * single town's S6 pass, and giving those the same verdict would be wrong in
 * whichever direction you picked.
 *
 * The empty list is not a shrug — it is the finding. A publish review, an
 * organisation application, a map-request decision and a drafted reply Peter has
 * to send are decisions taken in a browser or an email client. They touch no
 * working tree, so no amount of development traffic can make them unsafe, and
 * they are exactly what he should reach for when everything else says wait.
 */
export function needsOf(item) {
  const key = String(item.key || '');
  const type = String(item.type || '');

  if (key.startsWith('engine-stale')) return ['buses-tree', 'engine', 'estate-sweep'];
  if (key.startsWith('s6-stale') || key.startsWith('nobuild-')) return ['buses-tree', 'engine'];
  if (key.startsWith('corr-owed-')) return ['buses-tree'];
  if (key.startsWith('corr-unsent-') || key.startsWith('corr-asked-')) return [];
  // OA-233: pulling an answer writes a new S3 run; building it runs the engine over the tree.
  if (key.startsWith('landmark-owed-')) return ['buses-tree'];
  if (key.startsWith('landmark-unbuilt-')) return ['buses-tree', 'engine'];
  // OA-251: the row's own action is `gh run view --log-failed`, which reads a
  // GitHub run and touches no tree here. Whatever the FIX turns out to need is
  // the fix's business, and will be classified by whatever row that becomes.
  // Empty on purpose and load-bearing: --safe-only hides every non-SAFE row, and
  // the one row that must never be hidden from a session looking for something
  // safe to do is the one saying the repository is broken.
  if (key.startsWith('ci-red-')) return [];
  // OA-283, renamed by OA-401: the row's own action is "read
  // loop/your-move/<ref>.md and decide". That
  // is a decision, like a drafted reply or an application — it touches no working
  // tree, and whatever the ANSWER turns out to need belongs to the row that
  // answer becomes. Empty for the same load-bearing reason as `ci-red-` above:
  // --safe-only hides every non-SAFE row, and a session looking for something
  // safe to do is exactly who should see that the loop has stopped and why.
  if (key.startsWith('loop-hold-')) return [];
  // OA-288: the row's action is "commit or revert what git status names", or
  // "delete loop/STOP", or "read the newest run file". None of that writes to a
  // shared tree, and the same load-bearing argument as `ci-red-` and
  // `loop-hold-` applies with more force here: --safe-only hides every
  // non-SAFE row, and a row saying THE LOOP HAS STOPPED must never be the one
  // hidden from a session looking for something safe to do. It is also the row
  // most likely to be ABOUT a dirty tree, so classifying it by the tree it
  // reports on would suppress it exactly when it is right.
  if (key === 'loop-idle') return [];
  // 2026-09-10: the row's action is "read loop/your-move/ and promote, file or
  // decline each draft" — a triage, done by moving gitignored files. It touches
  // no shared tree, and it is the row most likely to be ABOUT a fix a tick was
  // barred from making, so classifying it by the tree would hide it exactly
  // when it is right.
  if (key === 'loop-drafts') return [];
  // OA-326 (2026-09-12): the row's action is `git push` plus opening a pull
  // request, which only Peter can do — the loop is denied the push by design and
  // that is the reason the row exists. Pushing a branch writes to no working
  // tree here, and whatever REVIEWING that branch turns out to need belongs to
  // the row that review becomes. Empty for the same load-bearing reason as
  // `ci-red-` and `loop-hold-`: --safe-only hides every non-SAFE row, and a
  // row saying finished work is invisible to everyone but this laptop must not
  // be the one hidden from a session looking for something safe to do.
  if (key.startsWith('unpushed-branch-')) return [];
  // OA-326 item 1 (2026-09-21): the pull-request sweep's two loud rows. Merging
  // a pull request, closing it, or opening one for a branch that has never had
  // one happens in a browser or in `gh`; none of it writes to a working tree
  // here, and whatever REVIEWING that branch turns out to need belongs to the
  // row that review becomes. Empty for the same load-bearing reason as
  // `ci-red-`, `loop-hold-` and `unpushed-branch-`: --safe-only hides every
  // non-SAFE row, and a row saying finished work has been sitting open for
  // three weeks must not be the one hidden from a session looking for
  // something safe to do.
  if (key.startsWith('pr-sweep-stalled-') || key.startsWith('pr-sweep-no-pr-')) return [];
  // The other two are the sweep's own housekeeping, and they are NOT empty: the
  // action they offer is `node pr_sweep.mjs`, which writes loop/pr-sweep.json
  // into the buses tree. Nothing it does needs the engine.
  if (key === 'pr-sweep-due' || key === 'pr-sweep-record') return ['buses-tree'];
  // OA-308 (2026-09-11): the directory rows. NOT empty, and answered explicitly
  // rather than left to fall through the default — the row's own action WRITES to
  // the buses tree twice over. `directory.mjs --links` writes link-check.json, and
  // fixing a dead link edits directory.json and re-renders README.md. Nothing it
  // does needs the engine, and no other repository is involved.
  if (key.startsWith('directory-links')) return ['buses-tree'];

  switch (type) {
    case 'review': case 'application': case 'request-decision': case 'awaiting-customer': case 'commitment':
      return [];
    case 'gate':
      return ['engine'];
    case 'correspondence':
      return ['buses-tree'];
    case 'refresh-local':
      return ['buses-tree', 'engine'];
    case 'build': case 'refresh':
      return ['buses-tree', 'engine', 'portal-write'];
    case 'housekeeping':
      return ['buses-tree', 'engine'];
    default:
      // An unrecognised type is not assumed harmless. Say the type, so whoever
      // added it can come here and answer the question properly.
      return ['buses-tree'];
  }
}

export function classify(item, conditions) {
  return assess(needsOf(item), conditions);
}

/*
 * The commands that are NOT worklist rows, classified through the same rules —
 * so this table cannot drift away from the row markers. Every one of these has
 * been reached for mid-session by somebody who had not thought about who else
 * was on the machine.
 */
export const STANDING_TOOLS = [
  { what: 'Print this worklist', cmd: 'node worklist.mjs', needs: [], note: 'read-only; safe while the dev server runs (the portal DB is WAL)' },
  { what: 'Draft a reply / decide in the portal UI', cmd: '(browser, or a chat)', needs: [], note: 'decisions touch no working tree' },
  { what: 'Full byte gate sweep', cmd: 'node status.js  /  worklist.mjs --gates', needs: ['engine', 'buses-tree'], note: 'regenerates every map to diff it' },
  { what: 'Push gate results to the portal', cmd: 'node push-status.mjs', needs: ['engine', 'buses-tree'] },
  { what: 'Run a map build (S1–S6)', cmd: '/make-bus-leaflet', needs: ['buses-tree', 'engine'] },
  { what: 'Engine rollout across the estate', cmd: 'node rollout.js --all --apply', needs: ['buses-tree', 'engine', 'estate-sweep'] },
  { what: 'Re-record the quality ledger', cmd: 'node quality_gate.js --accept', needs: ['estate-sweep'] },
  { what: 'Deliver a map to the live portal', cmd: 'npm run deliver -- --map <slug>', needs: ['portal-write'] },
  { what: 'Deploy the portal', cmd: 'npm run deploy', needs: ['portal-deploy'] },
];

/*
 * The distinct contentions across a set of rows, worst first. This is what the
 * conditions block prints, and it is derived from the SAME assess() the rows
 * use -- so the summary cannot claim something the rows do not, which is the
 * standing way a header and its list drift apart.
 */
export function contentions(items, conditions) {
  const seen = new Map();
  for (const it of items) {
    for (const r of (it.safety ? it.safety.reasons : classify(it, conditions).reasons)) {
      if (!seen.has(r.need)) seen.set(r.need, r);
    }
  }
  return [...seen.values()].sort((a, b) => ORDER[b.verdict] - ORDER[a.verdict]);
}

// ---- printing --------------------------------------------------------------
const repoLine = (r) => {
  if (!r.present) return `${r.name} — not found at ${r.dir}`;
  if (!r.readable) return `${r.name} — ${r.dir} is not a git working tree`;
  const bits = [];
  bits.push(isOffMain(r) ? `on ${r.branch} (not ${r.expect || 'main'})` : r.branch);
  const n = r.staged.length + r.modified.length;
  if (n) bits.push(`${n} uncommitted${r.staged.length ? ` (${r.staged.length} staged)` : ''}`);
  if (r.untracked.length) bits.push(`${r.untracked.length} untracked`);
  if (!n && !r.untracked.length) bits.push('clean');
  // OA-313. The basis is printed whenever it is not the branch's own upstream,
  // because that is the case a reader would otherwise assume, and the reason is
  // printed when there is no count at all — silence there read as "pushed".
  if (r.unpushed) bits.push(`${r.unpushed} unpushed${r.unpushedFrom === 'default-branch' ? ` (ahead of ${r.unpushedBasis}; this branch has no upstream)` : ''}`);
  else if (r.readable && r.unpushed === null) bits.push(`unpushed UNKNOWN — ${r.unpushedWhy || 'no basis to count against'}`);
  const top = topFolders(r);
  const where = top.length ? `  [${top.slice(0, 4).join(', ')}${top.length > 4 ? ', …' : ''}]` : '';
  return `${r.name} — ${bits.join(', ')}${where}`;
};

/* OA-386 item 2. One line, printed only where there is unaccounted dirt to be
 * old, saying how long the thing barring a tick has been sitting there. It is
 * labelled `mtime` at the point of use because that is what it is: a file
 * rewritten with identical bytes reads young, so an old answer is evidence and
 * a young one is not. */
const ageLine = (r) => {
  const a = r.dirtyAge;
  if (!a || !a.paths) return null;
  const bits = [];
  if (a.counted) bits.push(a.oldestMin === a.newestMin
    ? `${fmtMin(a.oldestMin)} old`
    : `oldest ${fmtMin(a.oldestMin)}, newest ${fmtMin(a.newestMin)}`);
  if (a.absent) bits.push(`${a.absent} named by git and not on disk`);
  if (a.refused) bits.push(`${a.refused} COULD NOT LOOK — a refusal, not an absence`);
  return `${a.paths} unaccounted path(s), ${bits.join('; ')} — mtime, so an OLD answer is evidence that nobody is working on it and a young one is not`;
};

/* OA-387. A detached checkout prints what it IS, on its own line, under the one
 * that reports the branch. The reader's question on meeting `(detached)` is
 * always the same — is this somebody mid-task, or is it left over? — and until
 * this line existed the board answered it by assertion. `state: 'refused'` says
 * COULD NOT LOOK in as many words rather than falling silent, because silence
 * here would be read as the benign answer. */
const detachedLine = (r) => {
  const d = r && r.readable && r.branch === DETACHED ? r.detached : null;
  if (!d) return null;
  const want = r.expect || 'main';
  const held = d.heldBy ? ` — ${want} is held by the worktree at ${d.heldBy}` : '';
  if (d.state !== 'read') return `detached at ${d.head || 'an unknown commit'}: COULD NOT LOOK — ${d.why || 'no reason recorded'}${held}`;
  if (d.ancestor) return `detached at ${d.head}, already on ${d.ref} — deploy residue, not somebody's work; it will not clear itself${held}`;
  return `detached at ${d.head}, NOT on ${d.ref} — commits sitting on no branch${held}`;
};

export function formatConditions(c) {
  const L = [];
  const age = (r) => { const s = ageLine(r); if (s) L.push(`  ${'dirt age'.padEnd(12)}${s}`); };
  const detach = (r) => { const s = detachedLine(r); if (s) L.push(`  ${'detached'.padEnd(12)}${s}`); };
  L.push(`  ${'this tree'.padEnd(12)}${repoLine(c.repos.buses)}`);
  detach(c.repos.buses);
  // OA-301. The subtraction is SHOWN, under the line that still counts the file
  // as uncommitted, because a number that silently got smaller is a number
  // nobody can check — the same rule the activity line follows for demotions.
  for (const a of (c.repos.buses.accounted || [])) {
    L.push(`  ${'accounted'.padEnd(12)}${a.path} — named by loop/your-move/${a.ref}.md, a held letter with Peter's own edit in it; left OUT of the buses-tree verdict, and not yours to touch`);
  }
  age(c.repos.buses);
  L.push(`  ${'the engine'.padEnd(12)}${repoLine(c.repos.engine)}`);
  detach(c.repos.engine);
  age(c.repos.engine);
  L.push(`  ${'the portal'.padEnd(12)}${repoLine(c.repos.portal)}`);
  detach(c.repos.portal);
  age(c.repos.portal);

  // WITHOUT --session THIS CANNOT SUBTRACT YOURSELF, and a list that shows your
  // own claim back to you as somebody else's work is worse than no list: it
  // manufactures exactly the collision it exists to report. Say so rather than
  // let the row be read as a peer.
  const others = c.claims.filter((x) => !x.self);
  if (others.length) {
    const say = (x) => `${x.session} holds ${x.ref}${x.ageDays === 0 ? ' (today)' : x.ageDays === null ? '' : ` (${x.ageDays}d)`}${x.note ? ` — ${x.note.slice(0, 46)}` : ''}${isStaleClaim(x) ? `   << STALE, ${x.ageDays} day(s) old` : ''}`;
    L.push(`  ${'claimed'.padEnd(12)}${say(others[0])}`);
    for (const x of others.slice(1)) L.push(`  ${''.padEnd(12)}${say(x)}`);
    if (!c.selfSession) L.push(`  ${''.padEnd(12)}(one of those may be you — pass --session <this session's name> and it will drop it)`);
    /* Until 2026-09-13 this block printed the age and said nothing about it, and
     * a session asked the obvious question: does the board tell me which of these
     * to RELEASE? It did not. Six claims printed alike, five of them held by
     * sessions that had ended days earlier and one being worked at that moment,
     * and nothing in the rendering separated them — so a stale claim went on
     * refusing `--claim` to everybody, the scheduled loop included, until a person
     * happened to run `--who`. `--who` is the only thing in the estate that says
     * STALE, and nothing runs it for you.
     *
     * THE MARKER IS ABOUT AGE, AND THE SENTENCE BELOW SAYS SO. This board cannot
     * tell a dead session from an idle one — its own `activity` line, a few lines
     * down, is explicit that "an idle prompt looks the same as gone" — so a
     * marker phrased as liveness would be a claim this file has no evidence for.
     * What it does know is the date somebody wrote down, and the estate's rule
     * that a session does not live overnight.
     *
     * A COMPUTED AGE IS SAFE HERE AND IS NOT SAFE IN THE INDEX, which is the same
     * distinction OA-289 was paid for: `open-actions.md` is a generated file under
     * byte comparison, so an age in it turned `main` red on the calendar. This is
     * a REPORT, recomputed on every run and compared to nothing. Threshold and
     * wording are deliberately assemble.mjs's, so the two agree when read side by
     * side. */
    const stale = others.filter(isStaleClaim);
    if (stale.length) {
      L.push(`  ${''.padEnd(12)}${stale.length} of those ${stale.length === 1 ? 'was' : 'were'} claimed BEFORE TODAY, which is longer than a session lives here — that is an AGE, not a liveness check, and this board cannot tell a dead session from an idle one. If nobody is behind one, release it; --who names each and prints the command:`);
      L.push(`  ${''.padEnd(12)}  node "Development Docs/open-actions/assemble.mjs" --who`);
    }
  } else {
    L.push(`  ${'claimed'.padEnd(12)}no open action is claimed by another session`);
  }

  // Context, and labelled as context. See the header for why it is never scored.
  // The demotion is NAMED rather than quietly applied: a number that silently
  // got smaller is a number nobody can check, and "the file moved but the
  // session did not" is the most useful single fact this line has ever carried.
  if (c.peers.ok) {
    const d = c.peers.demoted
      ? `; ${c.peers.demoted} more file(s) moved with no turn behind them and are not counted`
      : '';
    L.push(`  ${'activity'.padEnd(12)}${c.peers.count} session(s) with a TURN in the last ${c.peers.windowMin} min — a hint, not evidence; an idle prompt looks the same as gone${d}`);
  }
  return L;
}
