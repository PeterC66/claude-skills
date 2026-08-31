#!/usr/bin/env node
/*
 * sweep-scratch.js — count, and on request remove, the throwaway directories this
 * estate's tools leave in the OS temp folder.
 *
 * WHY (OA-201). On 2026-08-31 the temp folder on this laptop held 68,078 scratch
 * directories. The row that raised it counted 3,191 — the portal's `cbm-*` — and
 * named the Windows SQLite-handle EPERM as the cause, which is true of those and
 * of 4.7% of the total. The rest were this repository's own test fixtures, which
 * did not attempt cleanup at all: one `npm test` run leaked 139 directories,
 * measured before and after. `assets/scratch.js` fixed the growth at source (the
 * same run now leaks 0). This tool is for the arrears, and for the residue the
 * EPERM will always leave behind.
 *
 * IT IS A DRY RUN UNLESS YOU SAY --apply, and it will not go outside two places:
 * the single root `assets/scratch.js` writes into, and a CLOSED list of the
 * prefixes that were in use before the migration. That list cannot grow: no code
 * writes those names any more, so it is an enumeration of the past rather than a
 * filter over the present — which is the only kind this project trusts. It was
 * taken from `git show` of the pre-migration tree plus a scan of the portal's
 * suites, not typed from memory.
 *
 * TWO PREFIXES ON THAT LIST ARE STILL LIVE, and that is deliberate: `bus-work`'s
 * `commit-worklist-` and `corr-worklist-` are ESM in another skill and already
 * remove their own directories, so they are swept but not migrated.
 *
 * SEVERAL SESSIONS RUN AT ONCE HERE, and a suite mid-run owns one of these
 * directories. That is why nothing is removed under --older-than hours (default
 * 6), and why the row that raised this counted 3,191 and deleted none of them.
 *
 * Run it from make-bus-leaflet (no placeholders; every flag is optional):
 *     node tools/sweep-scratch.js                      count them, remove nothing
 *     node tools/sweep-scratch.js --apply              remove what it counted
 *     node tools/sweep-scratch.js --older-than 24      only ones untouched for 24h
 *     node tools/sweep-scratch.js --root-only          ignore the legacy prefixes
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT_NAME } = require('../assets/scratch');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ROOT_ONLY = argv.includes('--root-only');
const oi = argv.indexOf('--older-than');
const OLDER_H = (oi >= 0 && argv[oi + 1]) ? Number(argv[oi + 1]) : 6;
if (!Number.isFinite(OLDER_H) || OLDER_H < 0) {
  console.error('sweep-scratch: --older-than takes a number of hours.');
  process.exit(2);
}

/* THE CLOSED LIST. Every prefix any tool in claude-skills or community-bus-maps
 * passed to mkdtemp before 2026-08-31, taken from the trees themselves. The
 * portal's are all `cbm-`, so one entry covers its thirty. Nothing writes these
 * any more — `assets/scratch.js` owns the naming now — so this list is finished,
 * and a name that is not on it is somebody else's directory. */
const LEGACY = [
  'branchcov-', 'cbm-', 'commit-worklist-', 'contact-old-', 'corr-worklist-', 'derive-freq-',
  'diagram-edit-', 'dq-', 'engver-', 'gate-', 'gatelib-', 'prove-red-', 'prove-rollout-stamp-',
  'prove-s6-', 'prove-unrendered-', 'qg-', 'qm-drop-', 'qm-ink-', 'qm-loz-', 'qm-spoke-',
  'redteam-src-', 'rollout-', 'rollout-place-', 'seed-prev-s4-', 'sheet-reg-', 'sheets-',
  'stage-commit-', 'stage-outside-', 'stage-pull-', 'stage-rundir-', 'stage-stamps-',
  'strays-', 'viachain-',
];

const TMP = os.tmpdir();
const ROOT = path.join(TMP, ROOT_NAME);
const cutoff = Date.now() - OLDER_H * 3600 * 1000;

/* lstat, not stat: a symlink pointing out of the temp folder must be counted as a
 * link and left alone, never followed and recursively removed. */
function entries(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;          // excludes symlinks, which lstat reports as links
    out.push({ name, full, mtimeMs: st.mtimeMs });
  }
  return out;
}

const inRoot = entries(ROOT);
const legacy = ROOT_ONLY ? [] : entries(TMP).filter(e => e.name !== ROOT_NAME && LEGACY.some(p => e.name.startsWith(p)));

function report(label, list) {
  const old = list.filter(e => e.mtimeMs < cutoff);
  console.log('  ' + String(list.length).padStart(7) + '  ' + label
    + '   (' + old.length + ' untouched for ' + OLDER_H + 'h or more)');
  return old;
}

console.log('scratch directories in ' + TMP);
const rootOld = report(ROOT_NAME + '/  (the one root)', inRoot);
const legacyOld = ROOT_ONLY ? [] : report('legacy prefixes, ' + LEGACY.length + ' names, closed list', legacy);

const doomed = rootOld.concat(legacyOld);
if (!APPLY) {
  console.log('\n  ' + doomed.length + ' would be removed. Nothing has been. Add --apply to remove them,');
  console.log('  and remember that another session\'s suite may own one — hence --older-than.');
  process.exit(0);
}

let gone = 0, held = 0;
for (const e of doomed) {
  try { fs.rmSync(e.full, { recursive: true, force: true }); gone++; }
  catch { held++; }
}
console.log('\n  removed ' + gone + (held ? ', could not remove ' + held
  + ' (a held file — Windows will not unlink one, which is the EPERM this row started from)' : ''));
