#!/usr/bin/env node
/*
 * remove_worktree.mjs — remove ONE worktree by hand without deleting through a link in it.
 *
 *   node remove_worktree.mjs "<worktree path>"           report only — says what it would unlink and remove
 *   node remove_worktree.mjs "<worktree path>" --apply   unlinks the mirror links, then `git worktree remove`
 *
 * Run from anywhere; this file is in `C:\Buses\claude-skills\bus-work\assets\`. `<worktree path>` is the
 * worktree's own root folder, as `git worktree list` prints it — never the main checkout, which is refused.
 *
 * WHY THIS EXISTS (buses-data 3e177140, 2026-10-13). `git worktree remove`, WITHOUT --force, on a clean
 * buses-data worktree whose town folder was still attached (`stage.js attach`) exited 0 and emptied High
 * Wycombe Aldi's S4-generate, S5-render, S6-verify and _latest in the MAIN checkout. Git for Windows walks a
 * junction as a directory: the worktree looked clean because the tracked files it saw through the junction
 * matched, and the recursive delete then went through it. The weekly sweep already refused any tree holding a
 * link; a session removing its own worktree by hand had nothing.
 *
 * WHAT IT UNLINKS AND WHAT IT REFUSES. A MIRROR link is one whose target is the main checkout's folder at the
 * same relative path — exactly what `stage.js attach` makes for the four stage folders, and what the push
 * preflight lends as node_modules. Unlinking one loses nothing: the folder it points at is the main checkout's
 * own. A link that cannot be resolved points nowhere and is unlinked too. ANY OTHER link is refused and nothing
 * is touched, because this tool cannot know what deleting through it would cost. A link is removed with
 * unlink (rmdir for a junction), which never follows it; nothing here deletes recursively. Then the tree is
 * scanned again, and only with no link left does `git worktree remove` run — without --force, so git still
 * refuses a dirty tree. The local branch is left alone.
 *
 * Exit 0: removed (or, without --apply, would be). 1: refused — a foreign link, a link left after unlinking,
 * or git said no. 2: usage, or the path is not a worktree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findLinks } from './worktree_sweep.mjs';

const git = (dir, ...argv) => {
  try { return { ok: true, out: execFileSync('git', ['-C', dir, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { ok: false, out: '', err: String(e.stderr || e.message || '').trim() }; }
};
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

/** Sort every link under the worktree into mirror, dangling and foreign. Reads only. */
export function classifyLinks(wt, mainRoot) {
  const out = { mirror: [], dangling: [], foreign: [] };
  for (const rel of findLinks(wt, Infinity)) {
    const to = real(path.join(wt, rel));
    if (!to) { out.dangling.push(rel); continue; }
    const mirror = real(path.join(mainRoot, rel));
    if (mirror && same(to, mirror)) out.mirror.push(rel);
    else out.foreign.push(rel + ' -> ' + to);
  }
  return out;
}

// A junction takes rmdir on Windows, a POSIX symlink takes unlink; neither follows the link.
function unlinkOnly(p) { try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); } }

export function removeWorktree(wtArg, { apply = false, log = console.log, warn = console.error } = {}) {
  const wt = path.resolve(wtArg);
  if (!fs.existsSync(wt)) { warn(`remove_worktree: no such folder ${wt}`); return 2; }
  const top = git(wt, 'rev-parse', '--show-toplevel');
  const common = git(wt, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  if (!top.ok || !common.ok) { warn(`remove_worktree: ${wt} is not inside a git checkout`); return 2; }
  if (!same(top.out, wt)) { warn(`remove_worktree: ${wt} is not a worktree's root — its root is ${path.resolve(top.out)}`); return 2; }
  const mainRoot = path.dirname(path.resolve(common.out));
  if (same(mainRoot, wt)) { warn(`remove_worktree: ${wt} is the MAIN checkout — refused`); return 2; }

  const links = classifyLinks(wt, mainRoot);
  for (const l of links.mirror) log(`  mirror link   ${l}  (points at the main checkout's own folder — ${apply ? 'unlinking' : 'would unlink'})`);
  for (const l of links.dangling) log(`  dangling link ${l}  (points nowhere — ${apply ? 'unlinking' : 'would unlink'})`);
  for (const l of links.foreign) warn(`  FOREIGN link  ${l}`);
  if (links.foreign.length) {
    warn(`remove_worktree: REFUSED — ${links.foreign.length} link(s) point somewhere other than the main checkout's own folder; git would delete through them. Nothing was touched.`);
    return 1;
  }
  if (!apply) { log(`would remove ${wt} with \`git worktree remove\` (no --force) — pass --apply to do it`); return 0; }

  for (const l of [...links.mirror, ...links.dangling]) unlinkOnly(path.join(wt, l));
  const left = findLinks(wt, Infinity);
  if (left.length) { warn(`remove_worktree: REFUSED — still a link after unlinking: ${left.join(', ')}`); return 1; }
  // A junction over a folder git tracks files in (S6-verify's redteam.json) leaves those files missing once
  // it is unlinked, and a non-forced remove refuses a tree with a deletion in it. Put them back from the
  // worktree's own index, into the worktree's own folder; the main checkout is not written to.
  for (const l of [...links.mirror, ...links.dangling]) {
    const tracked = git(wt, 'ls-files', '--', l.split(path.sep).join('/'));
    if (tracked.ok && tracked.out) {
      const co = git(wt, 'checkout', '--', l.split(path.sep).join('/'));
      if (!co.ok) { warn(`remove_worktree: could not restore the tracked files under ${l} — ${co.err}`); return 1; }
      log(`  restored the tracked files under ${l} from the worktree's index`);
    }
  }
  const rm = git(mainRoot, 'worktree', 'remove', wt);
  if (!rm.ok) { warn(`remove_worktree: git worktree remove refused — ${rm.err}`); return 1; }
  if (fs.existsSync(wt)) { warn(`remove_worktree: git said yes but ${wt} is still there`); return 1; }
  log(`removed ${wt}`);
  if (links.mirror.length) log('  a town attached with `stage.js attach --as <session>` still holds its lock in the main checkout — `stage.js unlock --as <session> "<main town folder>"` gives it back');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const named = a.filter((x) => !x.startsWith('--'));
  const unknown = a.filter((x) => x.startsWith('--') && x !== '--apply');
  if (named.length !== 1 || unknown.length) {
    console.error('usage: node remove_worktree.mjs "<worktree path>" [--apply]' + (unknown.length ? ` — unknown flag ${unknown[0]}` : ''));
    process.exit(2);
  }
  process.exit(removeWorktree(named[0], { apply: a.includes('--apply') }));
}
