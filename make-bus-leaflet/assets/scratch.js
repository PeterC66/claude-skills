/*
 * scratch.js — ONE root for every throwaway directory this engine makes, and one
 * place that removes them.
 *
 * WHY THIS EXISTS (OA-201). On 2026-08-31 the OS temp folder on this laptop held
 * **68,078** scratch directories. The row that raised it had counted 3,191 — the
 * `cbm-*` ones the portal's suites leave — and named a cause to match: Windows
 * will not unlink a SQLite file the process still holds, so a cleanup `rmSync`
 * throws EPERM after every assertion has passed and the suite wraps it in a
 * try/catch. That is a true story about 4.7% of them. **The other 95% are this
 * repository's own test fixtures, and they do not attempt cleanup at all**:
 * `gate-` 4,204, `seed-prev-s4-` 936, `stage-commit-` 680, and roughly 34,000
 * across the 28 numbered `qm-ink-*` prefixes, because `quality_metrics_ink`'s
 * `sheet()` helper makes a directory per call and never removes one. One `npm
 * test` run leaked **139** directories, measured before and after.
 *
 * So the row was right that there was something to fix and wrong about what and
 * where — a glob taken for a population, which this project has a name for. The
 * two facts that made it plausible are worth keeping: the prefix it counted was
 * real, and the cause it named is real for that prefix.
 *
 * WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 *   - **One root.** Everything lands under `<tmp>/busmaps-scratch/<label>-XXXXXX`
 *     instead of 47 unrelated prefixes directly in the temp folder. That is what
 *     makes a sweep something you can write down and be sure of: one directory to
 *     look in, and nothing of anybody else's inside it.
 *   - **A process that made scratch cleans it up.** `process.on('exit')` removes
 *     everything this process created, so a suite that forgets a teardown — which
 *     is every suite, eventually — stops being the reason the folder grows. It is
 *     belt and braces, not a replacement: a call site that already removes its own
 *     directory still should, because that frees the disk during a long run rather
 *     than at the end of it.
 *   - **It does NOT fix the EPERM.** A directory holding an open SQLite file still
 *     cannot be unlinked on Windows, here or anywhere else; `removeScratch()`
 *     returns false and says nothing, because a cleanup that fails is not a test
 *     failure. What it does mean is that such a directory is now inside one named
 *     root, where `tools/sweep-scratch.js` can take it later when the handle has
 *     gone.
 *   - **`--keep` still keeps.** Several tools print a scratch path for inspection.
 *     They call `keepScratch()` and the exit sweep does nothing. Getting this wrong
 *     would have deleted the evidence a harness was asked to leave behind.
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

/* The single directory name. `tools/sweep-scratch.js` and the documentation both
 * quote it, so it is exported rather than spelled twice. */
const ROOT_NAME = 'busmaps-scratch';

const made = [];
let keep = process.env.BUSMAPS_SCRATCH_KEEP === '1';
let hooked = false;

/** `<os tmpdir>/busmaps-scratch`, created if it is not there. */
function scratchRoot() {
  const r = path.join(os.tmpdir(), ROOT_NAME);
  fs.mkdirSync(r, { recursive: true });
  return r;
}

/* A label goes into a directory name, so it is reduced to characters a path can
 * hold on either OS. It is a HINT, not an identity: `mkdtempSync` supplies the
 * uniqueness, exactly as it did when the label was a bare prefix.
 *
 * THE DOT IS NOT IN THE ALLOWED SET, and that is the whole reason this function
 * exists rather than the label being used raw. A caller passing a place name or a
 * path fragment must not be able to put `..` or a separator into a directory name
 * the sweep is going to walk; runs of anything else collapse to a single `-`. */
function safeLabel(label) {
  const s = String(label == null ? '' : label).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'scratch';
}

/** Make a throwaway directory under the one root. Same contract as mkdtempSync. */
function scratchDir(label) {
  const dir = fs.mkdtempSync(path.join(scratchRoot(), safeLabel(label) + '-'));
  made.push(dir);
  if (!hooked) { hooked = true; process.on('exit', sweepThisProcess); }
  return dir;
}

/* Remove one, and never throw. A failed cleanup is a fact about the filesystem —
 * an open handle, a virus scanner mid-read — and turning it into an exception is
 * how a green suite goes red after every assertion in it has passed. */
function removeScratch(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch { return false; }
}

/** Leave this process's scratch on disk: for a tool whose --keep means inspect it. */
function keepScratch() { keep = true; }

/** Remove everything THIS process made. Registered on exit; safe to call early. */
function sweepThisProcess() {
  if (keep) return;
  while (made.length) removeScratch(made.pop());
}

module.exports = { ROOT_NAME, scratchRoot, scratchDir, removeScratch, keepScratch, sweepThisProcess };
