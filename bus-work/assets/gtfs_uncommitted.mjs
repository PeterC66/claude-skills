/*
 * gtfs_uncommitted.mjs — the monthly BODS refresh RAN and was never committed,
 * as a worklist row (buses-data OA-505, Tier 2.1 of the codebase review of
 * 2026-09-28).
 *
 * WHY THIS EXISTS. `bods_scan.mjs` asks whether the monthly refresh ran at all.
 * Nothing asked the other half: whether a refresh that DID run was committed.
 * `_gtfs/refresh-bus-data.ps1` has no git calls. It rewrites tracked files in
 * the main checkout — the `feed_info_*.json`, `refresh-summary.txt`, the
 * refresh report and everything under `upcoming/` — and leaves them there. The
 * 2026-09-01 run was committed by hand fifteen hours later (buses-data
 * `43c18367`). From 2026-10-01 it runs `-Unattended` (OA-402), so there is not
 * even a dialog left to remind anybody.
 *
 * WHY A ROW AND NOT AN AUTO-COMMIT. The main checkout is shared by map builds
 * and is meant to have one writer at a time. A scheduled task that committed
 * from inside it would be a second writer nobody is watching. A row names the
 * files and leaves the commit to a session that holds the tree.
 *
 * WHAT IT READS. One `git status --porcelain -uall -- _gtfs` in the buses-data
 * checkout. Ignored files (the sqlite builds, the zips, `refresh.log`) never
 * appear in porcelain output, so the row speaks only about what git would
 * commit. `-uall` lists a new report under `upcoming/` by its own name rather
 * than folding it into its folder.
 *
 * WHAT IT DOES NOT DO. It never commits, never stages, never reddens. An
 * uncommitted refresh is a CHORE in R3's sense: the board prints it and exits 0.
 *
 * PURE CORE, INJECTED EDGES, like `bods_scan.mjs` and `deploy_pending.mjs`:
 * `readGtfsDirt()` is the only thing that runs git and takes its runner as an
 * argument, and `gtfsUncommittedItems()` is a function of that state. That is
 * what lets `prove-red-gtfs-uncommitted.mjs` falsify every verdict with no
 * repository at all.
 *
 * Zero dependencies (Node core only), matching worklist.mjs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveBuses } from './engine.mjs';

/** git in `dir`: stdout untrimmed (porcelain columns matter), or null on any failure. */
export const defaultGit = (dir, argv) => {
  try {
    return execFileSync('git', ['-C', dir, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};

/**
 * Parse `git status --porcelain` lines into { code, path }. The path is
 * everything after the two status columns and the space; a rename's
 * `old -> new` keeps the new name, which is the one that would be committed.
 */
export const parsePorcelain = (text) => String(text || '')
  .split(/\r?\n/)
  .filter((l) => l.length > 3)
  .map((l) => {
    const code = l.slice(0, 2);
    let p = l.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow >= 0) p = p.slice(arrow + 4);
    return { code, path: p.replace(/^"|"$/g, '') };
  });

/**
 * Read the facts. Returns one of:
 *   { status: 'no-dir', dir }          — this checkout has no `_gtfs` folder
 *   { status: 'unreadable', dir }      — git could not answer
 *   { status: 'ok', dir, files }       — `files` is every tracked-or-new path under `_gtfs` git would commit
 */
export function readGtfsDirt({ busesDir, git = defaultGit, exists = existsSync } = {}) {
  const root = busesDir || '.';
  const dir = path.join(root, '_gtfs');
  if (!exists(dir)) return { status: 'no-dir', dir };
  const out = git(root, ['status', '--porcelain', '-uall', '--', '_gtfs']);
  if (out === null) return { status: 'unreadable', dir };
  return { status: 'ok', dir, files: parsePorcelain(out) };
}

/** The row, or nothing, plus the warnings the worklist should print. */
export function gtfsUncommittedItems(state, { busesDir = resolveBuses(), shown = 6 } = {}) {
  const items = [];
  const warnings = [];
  if (!state || state.status === 'no-dir') return { items, warnings };

  if (state.status === 'unreadable') {
    warnings.push(`gtfs-uncommitted: git could not report on ${state.dir} — whether a refresh was left uncommitted is not known.`);
    return { items, warnings };
  }
  if (state.status !== 'ok') {
    warnings.push(`gtfs-uncommitted: unknown state ${JSON.stringify(state.status)} — nothing raised.`);
    return { items, warnings };
  }

  const files = state.files || [];
  if (!files.length) return { items, warnings };

  const fresh = files.filter((f) => f.code === '??').length;
  const changed = files.length - fresh;
  const names = files.slice(0, shown).map((f) => '`' + f.path + '`').join(', ')
    + (files.length > shown ? `, and ${files.length - shown} more` : '');

  items.push({
    key: 'gtfs-uncommitted',
    rank: 4,
    type: 'housekeeping',
    title: `A BODS refresh left ${files.length} file(s) in _gtfs/ uncommitted`,
    why: `${changed} tracked file(s) changed and ${fresh} new file(s) under _gtfs/: ${names}. The monthly refresh script rewrites these and has no git calls, so nothing commits them. Until they are committed the main checkout is dirty, which stops every tick that needs the buses-data tree, and the refresh the reports describe is on no other machine (buses-data OA-505).`,
    who: '—',
    runbook: 'R4',
    files: files.map((f) => f.path),
    do: [
      {
        kind: 'shell',
        cwd: busesDir,
        cmd: 'git status --short -uall -- _gtfs',
        note: 'see what the refresh wrote; ignored files (sqlite, zips, refresh.log) do not appear and are not meant to be committed',
      },
      {
        kind: 'chat',
        what: 'Commit those files by name with a pathspec, in a session holding the buses-data tree, in one commit that names the scan date — the shape of buses-data 43c18367.',
      },
    ],
  });
  return { items, warnings };
}
