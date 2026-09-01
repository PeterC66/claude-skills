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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

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
 * CONTEXT, NEVER A VERDICT. See the header. A session appends to its transcript
 * on every turn, so a recent mtime means "was working recently" — which is worth
 * a line of context and is not worth scoring, because the two ways it is wrong
 * point in opposite directions and neither is rare.
 */
export function readPeerActivity({ windowMin = 20, projectsDir, match = /Buses/i, now = Date.now() } = {}) {
  const root = projectsDir || path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'projects');
  const out = { windowMin, count: 0, newestAgeMin: null, scanned: 0, ok: false };
  if (!existsSync(root)) return out;
  let dirs;
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && match.test(e.name)); } catch { return out; }
  const cutoff = now - windowMin * 60000;
  for (const d of dirs) {
    const p = path.join(root, d.name);
    let entries;
    try { entries = readdirSync(p).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of entries) {
      let s;
      try { s = statSync(path.join(p, f)); } catch { continue; }
      out.scanned++;
      const age = Math.floor((now - s.mtimeMs) / 60000);
      if (s.mtimeMs >= cutoff) out.count++;
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
  return {
    at: new Date(now).toISOString(),
    repos,
    claims: buses ? readClaims(buses, selfSession) : [],
    peers: readPeerActivity({ windowMin: peerWindowMin, projectsDir, now }),
    selfSession: selfSession || null,
  };
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
    const n = r.staged.length + r.modified.length + r.untracked.length;
    if (!n) return [SAFE, null];
    const top = topFolders(r);
    const where = top.slice(0, 4).join(', ') + (top.length > 4 ? ', …' : '');
    if (r.staged.length) {
      return [CHECK, `${n} uncommitted file(s) here (${where}), ${r.staged.length} already STAGED in the shared index — commit with a pathspec (git commit -m "…" -- <paths>), never a bare commit`];
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
    if (isDirty(r) || r.untracked.length) return [CHECK, 'the tree is not clean — take a copy of any shared file the sweep writes, and diff it afterwards'];
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
};

export function assess(needs, conditions) {
  let verdict = SAFE;
  const reasons = [];
  for (const need of needs || []) {
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
  L.push(`  ${'the engine'.padEnd(12)}${repoLine(c.repos.engine)}`);
  L.push(`  ${'the portal'.padEnd(12)}${repoLine(c.repos.portal)}`);

  // WITHOUT --session THIS CANNOT SUBTRACT YOURSELF, and a list that shows your
  // own claim back to you as somebody else's work is worse than no list: it
  // manufactures exactly the collision it exists to report. Say so rather than
  // let the row be read as a peer.
  const others = c.claims.filter((x) => !x.self);
  if (others.length && !c.selfSession) {
    L.push(`  ${'claimed'.padEnd(12)}(no --session given, so this cannot tell your own claim from a neighbour's)`);
  }
  if (others.length) {
    const say = (x) => `${x.session} holds ${x.ref}${x.ageDays === 0 ? ' (today)' : x.ageDays === null ? '' : ` (${x.ageDays}d)`}${x.note ? ` — ${x.note.slice(0, 46)}` : ''}`;
    L.push(`  ${'claimed'.padEnd(12)}${say(others[0])}`);
    for (const x of others.slice(1)) L.push(`  ${''.padEnd(12)}${say(x)}`);
  } else {
    L.push(`  ${'claimed'.padEnd(12)}no open action is claimed by another session`);
  }

  // Context, and labelled as context. See the header for why it is never scored.
  if (c.peers.ok) {
    L.push(`  ${'activity'.padEnd(12)}${c.peers.count} session transcript(s) written in the last ${c.peers.windowMin} min — a hint, not evidence; an idle prompt looks the same as gone`);
  }
  return L;
}
