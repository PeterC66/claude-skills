#!/usr/bin/env node
/*
 * worktree_sweep.mjs — remove the worktrees whose work is already on main, and
 * the empty folders sessions leave behind (built 2026-09-23, at Peter's request).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node worktree_sweep.mjs            report only — says what it WOULD remove, removes nothing
 *   node worktree_sweep.mjs --apply    removes what the report says, and nothing else
 *
 * No placeholders. `--buses` and `--portal` resolve as everywhere else in this
 * folder (engine.mjs); the engine repository is the one containing this file.
 *
 * WHY THIS EXISTS. claude-skills' CLAUDE.md says "remove it when the PR merges",
 * and every session is told so. On 2026-09-23 the three repositories held 34
 * worktrees, of which 25 were on branches already merged, plus two empty folders
 * under buses-data's `.claude/worktrees/` that git no longer knew about. A step a
 * session has to remember at the end of its work is skipped about three times in
 * four. A rule that can be computed is a script, not a sentence.
 *
 * WHAT MAKES A WORKTREE REMOVABLE — every one of these, or it stays:
 *
 *   MERGED    its HEAD is an ancestor of origin/main, OR (the two public
 *             repositories squash-merge, so ancestry fails for every one of
 *             their merged branches — the first measurement read 23 of 25 as
 *             unmerged) GitHub says a pull request from its branch MERGED and
 *             the local HEAD is an ancestor of, or equal to, that PR's head
 *             commit. The second half is load-bearing: a commit made AFTER the
 *             merge is on no remote, and a PR state alone would delete it.
 *   CLEAN     `git status --porcelain` prints nothing. Untracked counts. Ignored
 *             files (node_modules) do not, and git removes them with the tree.
 *   IDLE      nothing git records for it — HEAD's commit, its index, its reflog —
 *             and no uncommitted file in it — has moved for IDLE_HOURS, so a
 *             session still sitting in a finished worktree does not have the
 *             floor taken from under it. Read BEFORE
 *             `git status`, which refreshes the index and would reset the clock.
 *   UNLOCKED  `git worktree lock` is somebody saying keep this.
 *   NO LINK   no symlink or junction anywhere inside it. `git worktree remove
 *             --force` once followed a node_modules junction out of a worktree
 *             and emptied the main checkout's copy (claude-skills CLAUDE.md). This
 *             never passes --force, and refuses a tree with a link in it at all
 *             rather than trusting that the non-forced path cannot do the same.
 *             Measured when this was built: with the guard mutated out, git's
 *             non-forced remove took a worktree holding an IGNORED junction and
 *             left the target intact — so the guard is a second layer, not the
 *             only one, and it costs one row for a person when it fires.
 *
 * Removal is `git worktree remove` without --force, so git itself refuses
 * anything dirty a second time. The branch is deleted afterwards only when the
 * MERGED proof above held, and the remote branch is never touched.
 *
 * STRAY FOLDERS. Under each `<repo>/.claude/worktrees/` and the engine's sibling
 * `skills-wt/`, a folder no worktree is registered at is removed when it holds
 * no FILE at all (empty directories only), and reported otherwise — never
 * deleted, because an unregistered folder with files in it is somebody's work
 * whose history git has already lost.
 *
 * THE PR-SWEEP SHAPE. The writer (`main()`, bottom, runs only when EXECUTED)
 * writes `<buses>/loop/worktree-sweep.json`; `worktreeSweepItems()` is pure and
 * is all worklist.mjs imports, so the board still opens no socket and runs no git.
 * The board raises a row only for what needs a person: a MERGED worktree the
 * sweep refused to remove, and a stray folder with files in it. An unmerged or
 * busy worktree is somebody's live work and is a note, never a row.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveBuses, resolvePortal } from './engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** How long nothing may have moved in a worktree before it can be removed. Hours. */
export const IDLE_HOURS = 24;

/**
 * How old the record may be before the board asks for another sweep. Days.
 * The Windows task runs it weekly; eight days is one missed run's grace.
 */
export const CADENCE_DAYS = 8;

const HOUR = 3600000;

/**
 * The decision for one worktree. PURE — facts in, verdict out — so the harness
 * can drive every refusal without a repository. The ORDER of the checks is the
 * order of the reasons a person reads, most fundamental first.
 *
 * @param {object} wt   { branch|null, merged:{proved:boolean, how?:string}, dirty:number|null,
 *                        locked:boolean, links:string[], lastMovedMs:number|null, error?:string }
 * @returns {{remove:boolean, reason:string, mergedButKept:boolean}}
 */
export function classifyWorktree(wt, { now = Date.now(), idleHours = IDLE_HOURS } = {}) {
  const keep = (reason, mergedButKept = false) => ({ remove: false, reason, mergedButKept });
  if (wt.error) return keep(`could not be read — ${wt.error}`);
  if (!wt.merged || !wt.merged.proved) return keep(wt.merged && wt.merged.why ? `not merged — ${wt.merged.why}` : 'not merged');
  if (wt.locked) return keep('locked with git worktree lock', true);
  // IDLE BEFORE DIRTY. A worktree cut from main with uncommitted edits and no
  // commit yet is "merged" by ancestry — trivially — and is somebody's live work.
  // Asked first, recent dirt stays quiet; only OLD dirt on finished work is a row.
  if (!Number.isFinite(wt.lastMovedMs)) return keep('its last activity could not be dated');
  const idle = (now - wt.lastMovedMs) / HOUR;
  if (idle < idleHours) return keep(`last touched ${Math.floor(idle)} hour(s) ago, under ${idleHours}`);
  if (wt.dirty === null || wt.dirty === undefined) return keep('git status could not be read', true);
  if (wt.dirty > 0) return keep(`${wt.dirty} uncommitted or untracked path(s), none touched for ${Math.floor(idle / 24)} day(s)`, true);
  if (wt.links && wt.links.length) return keep(`contains a link git could follow out of the tree: ${wt.links.slice(0, 3).join(', ')}`, true);
  return { remove: true, reason: `merged (${wt.merged.how}), clean, idle ${Math.floor(idle / 24)} day(s)`, mergedButKept: false };
}

/**
 * The MERGED proof. Pure: the three git/gh answers it needs are passed in.
 *
 * @param {object} p
 * @param {boolean} p.ancestorOfMain   HEAD is an ancestor of origin/main
 * @param {Array|null} p.prs            gh answer for this branch ([{number,state,headRefOid}]), null if not asked or refused
 * @param {(oid:string)=>boolean|null} p.headWithin  is HEAD an ancestor of (or equal to) oid? null = cannot tell
 */
export function proveMerged({ ancestorOfMain, prs, headWithin }) {
  if (ancestorOfMain) return { proved: true, how: 'on origin/main' };
  if (!Array.isArray(prs)) return { proved: false, why: 'not on origin/main, and GitHub was not asked' };
  const merged = prs.filter((p) => p.state === 'MERGED');
  if (!merged.length) return { proved: false, why: prs.length ? `its pull request is ${prs[0].state}` : 'no pull request, and not on origin/main' };
  for (const pr of merged) {
    const within = headWithin(pr.headRefOid);
    if (within === true) return { proved: true, how: `PR #${pr.number} merged` };
  }
  return { proved: false, why: `PR #${merged[0].number} merged, but this worktree has commits that PR did not carry` };
}

/** Parse `git worktree list --porcelain`. Pure. The first entry is the main checkout. */
export function parseWorktreeList(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), head: null, branch: null, detached: false, locked: false, prunable: false }; out.push(cur); }
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'locked' || line.startsWith('locked ')) cur.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) cur.prunable = true;
  }
  return out;
}

/* ─────────────────────────── the board's half ─────────────────────────── */

/** Read the record. Never throws; `loopPresent` is the trigger, as in pr_sweep.mjs. */
export function readWorktreeSweep(loopDir) {
  const recordFile = path.join(loopDir || '', 'worktree-sweep.json');
  const state = { loopDir, recordFile, loopPresent: false, present: false, record: null, unreadable: null };
  try { state.loopPresent = !!loopDir && fs.existsSync(loopDir); } catch { /* not ours to report */ }
  if (!state.loopPresent) return state;
  let raw;
  try { raw = fs.readFileSync(recordFile, 'utf8'); } catch { return state; }
  state.present = true;
  try { state.record = JSON.parse(raw); } catch (e) { state.unreadable = e.message; }
  return state;
}

const slug = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-60);

/**
 * Rows from a record already on disk. PURE — no I/O, clock injected.
 * @returns {{items: Array, notes: string[]}}
 */
export function worktreeSweepItems({ state, now = Date.now(), cadenceDays = CADENCE_DAYS, assetsDir = '.' }) {
  const items = [];
  const notes = [];
  if (!state || !state.loopPresent) return { items, notes };
  const sweep = { kind: 'shell', cwd: assetsDir, cmd: 'node worktree_sweep.mjs --apply', note: 'removes only merged, clean, idle worktrees; run without --apply to see the list first' };

  if (!state.present) {
    items.push({ key: 'worktree-sweep-due', rank: 8, type: 'worktree-sweep', who: '—', runbook: 'git',
      title: 'Nothing has ever swept the finished worktrees',
      why: 'Sessions leave a worktree behind for every merged branch; this sweep removes the ones whose work is on main and writes down what it left.',
      do: [sweep] });
    return { items, notes };
  }
  if (state.unreadable) {
    items.push({ key: 'worktree-sweep-record', rank: 8, type: 'worktree-sweep', who: '—', runbook: 'git',
      title: 'The worktree sweep\'s record will not parse',
      why: `${state.recordFile} is not JSON (${state.unreadable}). Delete it and sweep again; it is a record, not source data.`,
      do: [sweep] });
    return { items, notes };
  }
  const rec = state.record || {};
  const at = Date.parse(rec.checkedAt || '');
  if (!Number.isFinite(at)) {
    items.push({ key: 'worktree-sweep-record', rank: 8, type: 'worktree-sweep', who: '—', runbook: 'git',
      title: 'The worktree sweep\'s record does not say when it ran',
      why: `${state.recordFile} carries no readable checkedAt, so nothing can tell last week's sweep from last month's.`,
      do: [sweep] });
    return { items, notes };
  }
  const on = new Date(at).toISOString().slice(0, 10);

  for (const repo of Array.isArray(rec.repos) ? rec.repos : []) {
    if (repo.error) { notes.push(`worktree sweep: ${repo.name} could not be read on ${on} — ${repo.error}`); continue; }
    const kept = Array.isArray(repo.kept) ? repo.kept : [];
    for (const k of kept.filter((x) => x.mergedButKept)) {
      items.push({
        key: `worktree-sweep-kept-${repo.key}-${slug(k.branch || k.path)}`, rank: 8, type: 'worktree-sweep',
        title: `${repo.name}: finished worktree ${k.branch || '(detached)'} was left in place — ${k.reason}`,
        why: 'Its work is on main, so the only thing keeping it is what the sweep found in it. Either that is work somebody still wants (commit it somewhere) or it is debris (discard it), and only a person can say which.',
        detail: `${k.path}\nswept ${on}`,
        who: 'Peter', runbook: 'git', repo: repo.name,
        do: [
          { kind: 'shell', cwd: k.path, cmd: 'git status --short', note: 'see what the sweep saw' },
          { kind: 'chat', what: 'If it is debris, ask a session to discard it and remove the worktree; the next sweep will not raise it again.' },
        ],
      });
    }
    const live = kept.filter((x) => !x.mergedButKept);
    if (live.length) notes.push(`worktree sweep: ${repo.name} has ${live.length} worktree(s) still in use, not raised: ${live.map((x) => x.branch || path.basename(x.path)).join(', ')}`);
    for (const s of (Array.isArray(repo.strays) ? repo.strays : []).filter((x) => !x.removed)) {
      items.push({
        key: `worktree-sweep-stray-${repo.key}-${slug(s.path)}`, rank: 8, type: 'worktree-sweep',
        title: `${repo.name}: ${s.path} is a worktree folder git has forgotten, and it has ${s.files} file(s) in it`,
        why: 'No worktree is registered there, so git holds no history for what is inside. The sweep deletes an empty one; this one has files, so it waits for a person.',
        detail: `swept ${on}`, who: 'Peter', runbook: 'git', repo: repo.name,
        do: [{ kind: 'chat', what: 'Look inside; copy out anything wanted, then delete the folder.' }],
      });
    }
  }

  const ageDays = Math.floor((now - at) / (24 * HOUR));
  if (ageDays >= cadenceDays) {
    items.push({ key: 'worktree-sweep-due', rank: 8, type: 'worktree-sweep', who: '—', runbook: 'git', ageDays,
      title: `The worktree sweep last ran ${ageDays} days ago`,
      why: `It is meant to run weekly from Windows Task Scheduler (task "BusMaps worktree sweep"). ${ageDays} days means that task has stopped or failed.`,
      do: [sweep, { kind: 'shell', cwd: '.', cmd: 'schtasks /Query /TN "BusMaps worktree sweep" /V /FO LIST', note: 'shows the last run time and result' }] });
  }
  return { items, notes };
}

/* ─────────────────────── the writer: git, gh and the disk ─────────────────────── */

const run = (cmd, argv, cwd) => {
  try { return { ok: true, out: execFileSync(cmd, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message || '').trim() }; }
};
const git = (dir, ...argv) => run('git', ['-C', dir, ...argv]);

/** Every symlink or junction under `dir`, skipping `.git`. Stops at `limit`. */
export function findLinks(dir, limit = 5) {
  const found = [];
  const stack = [dir];
  while (stack.length && found.length < limit) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) { found.push(path.relative(dir, p)); if (found.length >= limit) break; }
      else if (e.isDirectory() && e.name !== '.git') stack.push(p);
    }
  }
  return found;
}

/** Number of FILES (not directories) under dir; stops counting at `cap`. */
export function countFiles(dir, cap = 1000) {
  let n = 0;
  const stack = [dir];
  while (stack.length && n < cap) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { n++; continue; }
    for (const e of entries) { if (e.isDirectory()) stack.push(path.join(d, e.name)); else n++; }
  }
  return n;
}

const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return null; } };

/** Last time anything git records for this worktree moved. Read BEFORE git status. */
function lastMoved(wtPath) {
  const gd = git(wtPath, 'rev-parse', '--absolute-git-dir');
  const commit = git(wtPath, 'log', '-1', '--format=%ct', 'HEAD');
  const times = [];
  if (commit.ok && commit.out.trim()) times.push(Number(commit.out.trim()) * 1000);
  if (gd.ok) for (const f of ['index', 'HEAD', path.join('logs', 'HEAD')]) { const t = mtime(path.join(gd.out.trim(), f)); if (t) times.push(t); }
  return times.length ? Math.max(...times) : null;
}

function ghPrs(dir, branch) {
  const r = run('gh', ['pr', 'list', '--state', 'all', '--head', branch, '--limit', '10', '--json', 'number,state,headRefOid'], dir);
  if (!r.ok) return null;
  try { const v = JSON.parse(r.out); return Array.isArray(v) ? v : null; } catch { return null; }
}

/** Is `head` an ancestor of (or equal to) `oid`? Fetches the PR head if the object is missing. */
function headWithinFactory(dir, head, prs) {
  return (oid) => {
    if (!oid) return null;
    if (oid === head) return true;
    if (!git(dir, 'cat-file', '-e', `${oid}^{commit}`).ok) {
      const pr = prs.find((p) => p.headRefOid === oid);
      if (pr) git(dir, 'fetch', '-q', 'origin', `refs/pull/${pr.number}/head`);
      if (!git(dir, 'cat-file', '-e', `${oid}^{commit}`).ok) return null;
    }
    return git(dir, 'merge-base', '--is-ancestor', head, oid).ok;
  };
}

export function sweepRepo({ repo, apply, now, idleHours, strayRoots, log }) {
  const out = { key: repo.key, name: repo.name, dir: repo.dir, error: null, removed: [], kept: [], strays: [], failed: [] };
  const fetched = git(repo.dir, 'fetch', '-q', '--prune', 'origin');
  if (!fetched.ok) { out.error = `git fetch failed — ${fetched.err}`; return out; }
  const list = git(repo.dir, 'worktree', 'list', '--porcelain');
  if (!list.ok) { out.error = `git worktree list failed — ${list.err}`; return out; }
  const all = parseWorktreeList(list.out);
  const registered = new Set(all.map((w) => path.resolve(w.path).toLowerCase()));

  for (const w of all.slice(1)) {
    if (w.prunable) continue; // its folder is already gone; `git worktree prune` below clears the entry
    const facts = { branch: w.branch, locked: w.locked };
    if (!fs.existsSync(w.path)) { facts.error = 'folder missing'; }
    else {
      facts.lastMovedMs = lastMoved(w.path);
      const anc = git(repo.dir, 'merge-base', '--is-ancestor', w.head, 'origin/main').ok;
      const prs = !anc && repo.prPerChange && w.branch ? ghPrs(repo.dir, w.branch) : null;
      facts.merged = proveMerged({ ancestorOfMain: anc, prs, headWithin: headWithinFactory(repo.dir, w.head, prs || []) });
      if (facts.merged.proved) {
        const st = git(w.path, 'status', '--porcelain');
        const dirtyPaths = st.ok ? st.out.split(/\r?\n/).filter(Boolean) : null;
        facts.dirty = dirtyPaths ? dirtyPaths.length : null;
        // An edit is activity even when no git command recorded it.
        for (const l of dirtyPaths || []) {
          const t = mtime(path.join(w.path, l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()));
          if (t && (!facts.lastMovedMs || t > facts.lastMovedMs)) facts.lastMovedMs = t;
        }
        facts.links = facts.dirty === 0 ? findLinks(w.path) : [];
      }
    }
    const v = classifyWorktree(facts, { now, idleHours });
    const entry = { path: w.path, branch: w.branch, reason: v.reason, mergedButKept: v.mergedButKept };
    const label = w.branch || `(detached) ${w.path}`;
    if (!v.remove) { out.kept.push(entry); log(`  keep    ${label} — ${v.reason}`); continue; }
    if (!apply) { out.removed.push({ ...entry, wouldRemove: true }); log(`  REMOVE  ${label} — ${v.reason}`); continue; }
    const rm = git(repo.dir, 'worktree', 'remove', w.path);
    if (!rm.ok) { out.failed.push({ ...entry, reason: `git worktree remove refused — ${rm.err}` }); out.kept.push({ ...entry, reason: `git worktree remove refused — ${rm.err}`, mergedButKept: true }); log(`  FAILED  ${w.branch} — ${rm.err}`); continue; }
    let branchDeleted = false;
    if (w.branch && w.branch !== 'main') branchDeleted = git(repo.dir, 'branch', '-D', w.branch).ok;
    out.removed.push({ ...entry, branchDeleted });
    log(`  removed ${label}${branchDeleted ? ' and its local branch' : ''}`);
  }
  if (apply) git(repo.dir, 'worktree', 'prune');

  for (const root of strayRoots) {
    let names;
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { continue; }
    for (const n of names) {
      const p = path.join(root, n);
      if (registered.has(path.resolve(p).toLowerCase())) continue;
      const files = countFiles(p);
      const s = { path: p, files, removed: false };
      if (files === 0 && apply) { try { fs.rmSync(p, { recursive: true }); s.removed = true; } catch (e) { s.error = e.message; } }
      out.strays.push(s);
      log(`  ${files === 0 ? (apply ? (s.removed ? 'removed' : 'FAILED ') : 'REMOVE ') : 'stray  '} folder ${p}${files ? ` — ${files} file(s), left for a person` : ' (empty)'}`);
    }
  }
  return out;
}

/** The record the reader parses. Pure; clock is an argument. */
export function buildSweepRecord({ results, apply, now = new Date() }) {
  return { checkedAt: now.toISOString(), tool: 'worktree_sweep.mjs', mode: apply ? 'apply' : 'report', repos: results };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = !!args.apply;
  const buses = resolveBuses(args);
  const portal = resolvePortal(args);
  const engine = args.engine || process.env.BUS_ENGINE_REPO || (() => {
    // The MAIN checkout of the engine, even when this file runs from a worktree of it.
    const r = git(HERE, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    return r.ok ? path.dirname(r.out.trim()) : null;
  })();
  const repos = [
    { key: 'buses', name: 'buses-data', dir: buses, prPerChange: false },
    { key: 'engine', name: 'claude-skills', dir: engine, prPerChange: true, extraStrayRoots: engine ? [path.join(path.dirname(engine), 'skills-wt')] : [] },
    { key: 'portal', name: 'community-bus-maps', dir: portal, prPerChange: true },
  ].filter((r) => r.dir && fs.existsSync(r.dir));

  const now = Date.now();
  const results = [];
  let failures = 0;
  console.log(apply ? 'worktree sweep — APPLYING' : 'worktree sweep — report only; nothing is removed without --apply');
  for (const repo of repos) {
    console.log(`\n${repo.name}  (${repo.dir})`);
    const strayRoots = [path.join(repo.dir, '.claude', 'worktrees'), ...(repo.extraStrayRoots || [])];
    const r = sweepRepo({ repo, apply, now, idleHours: IDLE_HOURS, strayRoots, log: (s) => console.log(s) });
    if (r.error) { console.error(`  ERROR ${r.error}`); failures++; }
    failures += r.failed.length;
    results.push(r);
  }

  const loopDir = path.join(buses, 'loop');
  if (fs.existsSync(loopDir)) {
    const outFile = path.join(loopDir, 'worktree-sweep.json');
    fs.writeFileSync(outFile, JSON.stringify(buildSweepRecord({ results, apply }), null, 2) + '\n', 'utf8');
    console.log(`\nwritten: ${outFile}`);
  }
  const n = (f) => results.reduce((a, r) => a + f(r), 0);
  console.log(`\n${apply ? 'removed' : 'would remove'} ${n((r) => r.removed.length)} worktree(s) and ${n((r) => r.strays.filter((s) => s.files === 0).length)} empty folder(s); kept ${n((r) => r.kept.length)}, of which ${n((r) => r.kept.filter((k) => k.mergedButKept).length)} are merged and need a person.`);
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack || String(e)); process.exit(2); });
}
