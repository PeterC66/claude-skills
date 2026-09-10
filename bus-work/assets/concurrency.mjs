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
import { readBlockedDir, heldPaths } from './loop_blocked.mjs';

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
 * files those are. A `loop/blocked/` hold can: its `**File:**` field names the
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

export function readRepo({ key, label, name, dir, expect = 'main' }) {
  const repo = { key, label, name, dir, present: false, readable: false, branch: null, expect };
  repo.staged = []; repo.modified = []; repo.untracked = [];
  repo.unpushed = null; repo.touchedTop = []; repo.touchesMapData = false;

  if (!dir || !existsSync(dir)) return repo;
  repo.present = true;
  if (git(dir, ['rev-parse', '--is-inside-work-tree']) !== 'true') return repo;
  repo.readable = true;
  repo.branch = git(dir, ['branch', '--show-current']) || '(detached)';

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

  // Ahead of its own remote-tracking ref. Deliberately NOT a fetch: this tool
  // promises to touch the network only in --url mode, and a fetch inside a
  // read-only status command is exactly the kind of side effect nobody expects.
  // So this answers "have I pushed what I committed", never "has someone else".
  const ahead = git(dir, ['rev-list', '--count', '@{u}..HEAD']);
  repo.unpushed = ahead === null ? null : Number(ahead);

  repo.dirty = isDirty(repo);
  repo.offMain = isOffMain(repo);
  return repo;
}

// The claims other sessions have written down. This is the one signal that says
// what somebody is DOING rather than what they have touched, and it is direct
// evidence: a claim is a session's own statement, checked in and pushed.
export function readClaims(busesDir, selfSession) {
  const dir = path.join(busesDir, 'Development Docs', 'open-actions');
  if (!existsSync(dir)) return [];
  const today = new Date();
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

export function readPeerActivity({ windowMin = 20, projectsDir, match = /Buses/i, now = Date.now() } = {}) {
  const root = projectsDir || path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'projects');
  const out = { windowMin, count: 0, newestAgeMin: null, scanned: 0, tailed: 0, demoted: 0, ok: false };
  if (!existsSync(root)) return out;
  let dirs;
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && match.test(e.name)); } catch { return out; }
  const cutoff = now - windowMin * 60000;
  for (const d of dirs) {
    const p = path.join(root, d.name);
    let entries;
    try { entries = readdirSync(p).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of entries) {
      const full = path.join(p, f);
      let s;
      try { s = statSync(full); } catch { continue; }
      out.scanned++;
      let at = s.mtimeMs;
      if (s.mtimeMs >= cutoff) {
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
    }
  }
  out.ok = true;
  return out;
}

export function readConditions({ buses, portal, engine, selfSession, now = Date.now(), projectsDir, peerWindowMin = 20 } = {}) {
  const repos = {
    buses: readRepo({ key: 'buses', label: 'this tree', name: 'buses-data', dir: buses }),
    engine: readRepo({ key: 'engine', label: 'the engine', name: 'claude-skills', dir: engine }),
    portal: readRepo({ key: 'portal', label: 'the portal', name: 'community-bus-maps', dir: portal }),
  };
  const out = {
    at: new Date(now).toISOString(),
    repos,
    claims: buses ? readClaims(buses, selfSession) : [],
    /* OA-287. The one fact here that git cannot supply: `loop/` is gitignored,
     * so a held lock can never reach the `buses-tree` verdict as an uncommitted
     * file, and every reader of that verdict was blind to the loop by
     * construction. Absent when there is no buses tree to look in, which is the
     * normal case in a harness fixture and in CI. */
    loopLock: buses ? readLoopLock(buses, { selfSession, now }) : null,
    peers: readPeerActivity({ windowMin: peerWindowMin, projectsDir, now }),
    selfSession: selfSession || null,
  };
  /* OA-301, applied at read time so the JSON the loop reads already carries it.
   * `loop/` is gitignored, so an absent folder — every fixture, every clone, CI
   * — accounts for nothing and the verdict is exactly what it was before. */
  accountFor(out.repos.buses, buses ? heldPaths(readBlockedDir(path.join(buses, 'loop', 'blocked'))) : []);
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
    if (isOffMain(p)) return [DELAY, `the portal checkout is on ${p.branch}, not ${p.expect || 'main'} — a deliver from here carries that branch, and the branch is somebody's live work`];
    if (b.readable && b.unpushed > 0) return [CHECK, `${b.name} has ${b.unpushed} unpushed commit(s) — push this side FIRST; the portal's verify.yml reads whatever is on this repo's main at that moment`];
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
    if (L.isTick && L.expired) return [SAFE, null];
    if (L.expired) {
      return [CHECK, `${who} has held loop/LOCK.d since ${age} and its lease ran out ${fmtMin(L.overdueMin)} ago — a person's lock is never stolen, so nothing will clear it for you: read it, and delete the directory if nobody is behind it${mayBeYou}`];
    }
    return [DELAY, `${who} holds loop/LOCK.d, taken ${age}, lease live for another ${fmtMin(L.remainMin)} — that is a run in progress on the shared trees, not a stale file${mayBeYou}`];
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
 * rather than a judgement about risk. A tick works the shared local trees; it
 * NEVER pushes — a deny rule in buses-data's settings, observed refusing — so it
 * can neither deliver a map nor deploy the portal, and the two portal resources
 * are genuinely not contended. If the loop is ever allowed to push, the harness
 * assertion that a deploy does not carry the lock is what should go red.
 */
const LOOP_CONTENDS = new Set(['buses-tree', 'engine', 'estate-sweep']);

export function assess(needs, conditions) {
  let verdict = SAFE;
  const reasons = [];
  /* OA-287, and stated ONCE here rather than added to a dozen returns in
   * needsOf(). Attaching it at the boundary is what keeps the empty list empty:
   * `ci-red-` and `loop-blocked-` rows return [] on purpose so that --safe-only
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
  // OA-283: the row's own action is "read loop/blocked/<ref>.md and decide". That
  // is a decision, like a drafted reply or an application — it touches no working
  // tree, and whatever the ANSWER turns out to need belongs to the row that
  // answer becomes. Empty for the same load-bearing reason as `ci-red-` above:
  // --safe-only hides every non-SAFE row, and a session looking for something
  // safe to do is exactly who should see that the loop has stopped and why.
  if (key.startsWith('loop-blocked-')) return [];
  // OA-288: the row's action is "commit or revert what git status names", or
  // "delete loop/STOP", or "read the newest run file". None of that writes to a
  // shared tree, and the same load-bearing argument as `ci-red-` and
  // `loop-blocked-` applies with more force here: --safe-only hides every
  // non-SAFE row, and a row saying THE LOOP HAS STOPPED must never be the one
  // hidden from a session looking for something safe to do. It is also the row
  // most likely to be ABOUT a dirty tree, so classifying it by the tree it
  // reports on would suppress it exactly when it is right.
  if (key === 'loop-idle') return [];
  // 2026-09-10: the row's action is "read loop/adhoc/ and promote, file or
  // decline each draft" — a triage, done by moving gitignored files. It touches
  // no shared tree, and it is the row most likely to be ABOUT a fix a tick was
  // barred from making, so classifying it by the tree would hide it exactly
  // when it is right.
  if (key === 'loop-drafts') return [];

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
  if (r.unpushed) bits.push(`${r.unpushed} unpushed`);
  const top = topFolders(r);
  const where = top.length ? `  [${top.slice(0, 4).join(', ')}${top.length > 4 ? ', …' : ''}]` : '';
  return `${r.name} — ${bits.join(', ')}${where}`;
};

export function formatConditions(c) {
  const L = [];
  L.push(`  ${'this tree'.padEnd(12)}${repoLine(c.repos.buses)}`);
  // OA-301. The subtraction is SHOWN, under the line that still counts the file
  // as uncommitted, because a number that silently got smaller is a number
  // nobody can check — the same rule the activity line follows for demotions.
  for (const a of (c.repos.buses.accounted || [])) {
    L.push(`  ${'accounted'.padEnd(12)}${a.path} — named by loop/blocked/${a.ref}.md, a held letter with Peter's own edit in it; left OUT of the buses-tree verdict, and not yours to touch`);
  }
  L.push(`  ${'the engine'.padEnd(12)}${repoLine(c.repos.engine)}`);
  L.push(`  ${'the portal'.padEnd(12)}${repoLine(c.repos.portal)}`);

  // WITHOUT --session THIS CANNOT SUBTRACT YOURSELF, and a list that shows your
  // own claim back to you as somebody else's work is worse than no list: it
  // manufactures exactly the collision it exists to report. Say so rather than
  // let the row be read as a peer.
  const others = c.claims.filter((x) => !x.self);
  if (others.length) {
    const say = (x) => `${x.session} holds ${x.ref}${x.ageDays === 0 ? ' (today)' : x.ageDays === null ? '' : ` (${x.ageDays}d)`}${x.note ? ` — ${x.note.slice(0, 46)}` : ''}`;
    L.push(`  ${'claimed'.padEnd(12)}${say(others[0])}`);
    for (const x of others.slice(1)) L.push(`  ${''.padEnd(12)}${say(x)}`);
    if (!c.selfSession) L.push(`  ${''.padEnd(12)}(one of those may be you — pass --session <this session's name> and it will drop it)`);
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
