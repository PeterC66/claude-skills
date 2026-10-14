#!/usr/bin/env node
/*
 * temp_sweep.mjs — remove the scratch folders the portal's tests leave in the
 * Windows temp folder (built 2026-10-14, at Peter's request). worktree_sweep.mjs
 * calls it, so the weekly "BusMaps worktree sweep" task does this too.
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets):
 *
 *   node temp_sweep.mjs                   report only — says what it WOULD remove, removes nothing
 *   node temp_sweep.mjs --apply           removes what the report says, and nothing else
 *   node temp_sweep.mjs --temp "<folder>" sweeps that folder instead of the user's temp folder
 *
 * `<folder>` is a real folder path; it exists so the harness can sweep a
 * throwaway folder. Leave it off to sweep the temp folder (`os.tmpdir()`).
 *
 * WHY THIS EXISTS. On 2026-10-14 `%TEMP%` held 62,823 entries, of which 36,858
 * were scratch folders from the portal's test scripts, 2.3 GB, the oldest from
 * 31 August. 118 portal scripts call `mkdtemp` and 77 mention a removal, and
 * those remove on the success path only, so a failed or interrupted run leaves
 * its folder for good. The disk did not mind (257 GB free); the directory did —
 * a plain `find` over it timed out at two minutes. Making all 118 scripts clean
 * up after themselves is a larger change than deleting what they left, and the
 * sweep also covers the next script nobody remembers to fix.
 *
 * WHAT IS REMOVABLE — every one of these, or it stays:
 *
 *   NAMED    a directory whose name starts with one of PREFIXES, the ones the
 *            portal's scripts give their `mkdtemp` folders. Nothing else in the
 *            temp folder is touched: it is every program's, not ours.
 *   IDLE     its own modified time is TEMP_IDLE_HOURS or more old, so a test
 *            run in progress keeps its folder.
 *
 * LINKS. 117 of the first 36,858 held a junction (`engine`, `node_modules`)
 * pointing into a live portal worktree. Such a tree is not refused — it would
 * then pile up for ever — but each link ENTRY is removed first with an
 * unlink/rmdir that cannot recurse, and checked to be gone, before anything is
 * deleted below it. The harness holds the control: a junction whose target
 * must still hold its file afterwards.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './engine.mjs';

/** How old a scratch folder's own modified time must be. Hours. */
export const TEMP_IDLE_HOURS = 24;

/** The `mkdtemp` prefixes the portal's scripts use. A name must START with one. */
export const PREFIXES = ['cbm-', 'portal-deps-', 'prove-red-status-', 'sheets-'];

const HOUR = 3600000;

/**
 * The decision for one entry of the temp folder. PURE — facts in, verdict out.
 * @param {{name:string, isDir:boolean, isLink?:boolean, mtimeMs:number|null}} e
 * @returns {{remove:boolean, reason:string}}
 */
export function classifyTempEntry(e, { now = Date.now(), idleHours = TEMP_IDLE_HOURS } = {}) {
  const keep = (reason) => ({ remove: false, reason });
  if (!PREFIXES.some((p) => e.name.startsWith(p))) return keep('not one of the portal tests\' folders');
  if (e.isLink) return keep('is itself a link');
  if (!e.isDir) return keep('is a file');
  if (!Number.isFinite(e.mtimeMs)) return keep('its age could not be read');
  if (now - e.mtimeMs < idleHours * HOUR) return keep(`touched within ${idleHours}h`);
  return { remove: true, reason: 'portal test scratch folder, idle' };
}

/** Every symlink or junction under `dir`. Never follows one. */
export function linksUnder(dir) {
  const found = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) found.push(p);
      else if (e.isDirectory()) stack.push(p);
    }
  }
  return found;
}

/** Remove the link ENTRY and nothing it points at; throw if it is still there. */
function dropLink(p) {
  if (!fs.lstatSync(p).isSymbolicLink()) throw new Error(`${p} is not a link any more`);
  try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); }
  if (fs.lstatSync(p, { throwIfNoEntry: false })) throw new Error(`link still present: ${p}`);
}

/**
 * Sweep one temp folder. Never throws for one folder's failure — a folder a
 * program holds open stays for the next run and is counted, not fatal.
 * @returns {{dir:string, removed:number, kept:number, linksUnlinked:number, failed:string[]}}
 */
export function sweepTemp({ dir = os.tmpdir(), apply = false, now = Date.now(), idleHours = TEMP_IDLE_HOURS, log = () => {} } = {}) {
  const res = { dir, removed: 0, kept: 0, linksUnlinked: 0, failed: [] };
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { res.failed.push(`${dir}: ${e.code || e.message}`); return res; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    let mtimeMs = null;
    try { mtimeMs = fs.lstatSync(p).mtimeMs; } catch { /* classified as unreadable */ }
    const v = classifyTempEntry({ name: e.name, isDir: e.isDirectory(), isLink: e.isSymbolicLink(), mtimeMs }, { now, idleHours });
    if (!v.remove) { if (PREFIXES.some((x) => e.name.startsWith(x))) res.kept++; continue; }
    if (!apply) { res.removed++; continue; }
    try {
      for (const l of linksUnder(p)) { dropLink(l); res.linksUnlinked++; }
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 2 });
      res.removed++;
    } catch (err) { res.failed.push(`${e.name}: ${err.code || err.message}`); }
  }
  log(`  ${apply ? 'removed' : 'would remove'} ${res.removed} scratch folder(s) from ${dir}; kept ${res.kept} newer; ${res.linksUnlinked} link(s) unlinked first; ${res.failed.length} left in use`);
  return res;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const r = sweepTemp({ dir: args.temp || os.tmpdir(), apply: !!args.apply, log: (s) => console.log(s) });
  for (const f of r.failed) console.error(`  left: ${f}`);
  process.exit(0);
}
