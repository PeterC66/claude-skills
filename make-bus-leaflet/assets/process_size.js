/*
 * process_size.js — how big is the PROCESS, as against the product? (buses-data
 * OA-488 item 2, from finding H4 of the 2026-09-27 technical audit)
 *
 * The audit found the process outweighs the product and that nothing measured it:
 * the words in the memory stores, the linked worktrees left across the three
 * repositories, and the pushes to buses-data (each one a billed CI run). This
 * prints all three on the board so a trend is read off a run rather than felt.
 *
 * A CHORE AND NEVER A RED. The board exits non-zero for a fault only (buses-data
 * CLAUDE.md), and a big number is not a fault. Nothing here is in `bad`. Peter
 * sets the caps; until he does, `CAPS` is empty and the section prints the
 * numbers with "no cap set". A cap, once set, turns an over-cap measure into the
 * word OVER on the line — still printed, still not red.
 *
 * Every measure reads the local machine and says "not on this machine" where it
 * cannot: CI has no memory store, and a fresh `actions/checkout` has no push
 * reflog and no worktrees. An unmeasured value is null, never 0.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Peter's caps, by measure key. Empty until he sets them (OA-488).
const CAPS = {};

function git(dir, args) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch { return null; }
}

function countWords(text) {
  const m = String(text).match(/\S+/g);
  return m ? m.length : 0;
}

/* Words in every *.md under each <projects>/<slug>/memory/, per store. */
function memoryWords(projectsDir) {
  if (!projectsDir || !fs.existsSync(projectsDir)) return null;
  const stores = [];
  for (const slug of fs.readdirSync(projectsDir).sort()) {
    const dir = path.join(projectsDir, slug, 'memory');
    let files;
    try { files = fs.readdirSync(dir, { recursive: true }); } catch { continue; }
    let words = 0, count = 0;
    for (const f of files) {
      if (!String(f).endsWith('.md')) continue;
      try { words += countWords(fs.readFileSync(path.join(dir, String(f)), 'utf8')); count++; } catch { /* unreadable: skip */ }
    }
    stores.push({ store: slug, files: count, words });
  }
  if (!stores.length) return null;
  return { total: stores.reduce((s, r) => s + r.words, 0), stores };
}

/* `git worktree list --porcelain`: the first entry is the main checkout, the rest
 * are linked worktrees. A `prunable` one is a folder git has lost, counted apart. */
function parseWorktrees(porcelain) {
  const blocks = String(porcelain).split(/\r?\n\r?\n/).filter(b => /^worktree /m.test(b));
  const linked = blocks.slice(1);
  return { linked: linked.length, prunable: linked.filter(b => /^prunable/m.test(b)).length };
}

function worktrees(repos) {
  return repos.map(({ name, dir }) => {
    const out = dir && fs.existsSync(dir) ? git(dir, ['worktree', 'list', '--porcelain']) : null;
    return out == null ? { name, linked: null, prunable: null } : { name, ...parseWorktrees(out) };
  });
}

/* Pushes are read off origin/main's reflog, where this machine's own pushes are
 * recorded as "update by push" — every push to buses-data is made from here. The
 * lines are `%gd|%gs` with --date=unix, so each selector carries the epoch. */
function parsePushes(reflog, nowMs) {
  const times = [];
  for (const line of String(reflog).split(/\r?\n/)) {
    const m = line.match(/@\{(\d+)\}\|update by push/);
    if (m) times.push(Number(m[1]) * 1000);
  }
  const day = 86400000;
  const last24h = times.filter(t => t > nowMs - day && t <= nowMs).length;
  const last7d = times.filter(t => t > nowMs - 7 * day && t <= nowMs).length;
  return { last24h, last7d, perDay7d: Math.round(last7d / 7 * 10) / 10, oldestMs: times.length ? Math.min(...times) : null };
}

function pushes(repoDir, nowMs) {
  const out = repoDir && fs.existsSync(repoDir)
    ? git(repoDir, ['reflog', 'show', '--date=unix', '--format=%gd|%gs', 'refs/remotes/origin/main'])
    : null;
  if (out == null) return null;
  const p = parsePushes(out, nowMs);
  // A reflog with no push in it (CI, a fresh clone) cannot answer; say so.
  return p.oldestMs == null ? null : p;
}

function processSize({ buses, skills, portal, projectsDir = path.join(os.homedir(), '.claude', 'projects'), nowMs = Date.now() }) {
  return {
    memoryWords: memoryWords(projectsDir),
    worktrees: worktrees([{ name: 'buses-data', dir: buses }, { name: 'claude-skills', dir: skills }, { name: 'community-bus-maps', dir: portal }]),
    busesPushes: pushes(buses, nowMs),
    caps: { ...CAPS },
  };
}

function capWord(key, value, caps) {
  if (value == null) return '';
  if (caps[key] == null) return '  (no cap set)';
  return value > caps[key] ? '  OVER the cap of ' + caps[key] : '  (cap ' + caps[key] + ')';
}

function printSection(ps) {
  if (!ps) return;
  const caps = ps.caps || {};
  console.log('\n=== Process size (information, not red — OA-488) ===');
  const mw = ps.memoryWords;
  if (!mw) console.log('  memory-store words: not on this machine');
  else {
    console.log('  memory-store words: ' + mw.total + capWord('memoryWords', mw.total, caps));
    for (const s of mw.stores) console.log('      ' + String(s.words).padStart(8) + '  ' + s.store + ' (' + s.files + ' files)');
  }
  const known = ps.worktrees.filter(w => w.linked != null);
  const linked = known.reduce((s, w) => s + w.linked, 0);
  if (!known.length) console.log('  linked worktrees: not on this machine');
  else console.log('  linked worktrees: ' + linked + capWord('worktrees', linked, caps) + '  — '
    + ps.worktrees.map(w => w.name + ' ' + (w.linked == null ? 'n/a' : w.linked + (w.prunable ? ' (' + w.prunable + ' prunable)' : ''))).join(', '));
  const p = ps.busesPushes;
  if (!p) console.log('  buses-data pushes: not on this machine (no push in the origin/main reflog)');
  else console.log('  buses-data pushes: ' + p.last24h + ' in the last 24h' + capWord('pushesPerDay', p.last24h, caps)
    + ', ' + p.last7d + ' in 7 days (' + p.perDay7d + '/day) — each one a billed CI run');
}

module.exports = { processSize, printSection, countWords, parseWorktrees, parsePushes, memoryWords, CAPS };
