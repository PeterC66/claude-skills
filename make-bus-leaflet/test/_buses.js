/*
 * _buses.js — where the DATA repository is, for the handful of tests whose
 * subject is a claim about the committed estate rather than about this code.
 *
 * WHY THIS FILE EXISTS. Three tests each answered the question their own way and
 * all three answered it badly (codebase review 2026-09-01, engine-pipeline F16):
 * `gate_lib.test.js` hard-coded `C:/u3a St Ives/Using AI/Buses` and did a bare
 * `return` when it was absent — no message, no skip, a green tick for a test that
 * had not run; `exit_caption.test.js` printed a line and returned, which the
 * runner still counts as PASSED; only `sheet_registry.test.js` used node:test's
 * own `{ skip }` and so was the only one a summary could see.
 *
 * A TEST THAT SILENTLY RETURNS WHEN ITS SUBJECT IS ABSENT IS GREEN IN CI FOR THE
 * WRONG REASON, which is this project's own central failure shape sitting inside
 * its own test suite. `node --test` counts and prints skips; a `return` is
 * invisible in exactly the place somebody would look.
 *
 * BUSES_DIR, when set, is AUTHORITATIVE — a wrong value skips rather than quietly
 * falling back to whichever other tree happens to be on this disk. Answering
 * about a repository the caller did not name is how a check comes to describe the
 * neighbour instead of its subject. Unset, two layouts are tried, because the
 * laptop and CI put the two repositories in different places: here buses-data is
 * ../../../../Using AI/Buses, in CI the workflow checks it out beside skills/.
 *
 * USE IT AS A SKIP OPTION, NOT AS AN `if`:
 *
 *     const { busesDir, needsBuses } = require('./_buses');
 *     test('…the committed estate…', needsBuses, () => { const B = busesDir(); … });
 *
 * so that an absent estate is REPORTED as a skip with its reason, and the test
 * body may then assume the tree is there.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mainCheckoutTwin } = require('./_worktree.js');

/* The two layouts, walked up from one base. Kept as a function OF the base so that the same
 * two walks can be retried from the main checkout when this one is a worktree, rather than
 * a third layout being invented for that case. */
const LAYOUTS = (base) => [
  path.join(base, '..', '..', '..', '..', 'Using AI', 'Buses'),
  path.join(base, '..', '..', '..', 'buses-data'),
];

/* AND A WORKTREE SITS AT A DIFFERENT DEPTH, so both walks miss (OA-344, 2026-09-19). From
 * the installed checkout the first lands on `C:\u3a St Ives\Using AI\Buses`; from a
 * worktree under `skills-wt/` the identical walk lands on `C:\u3a St Ives\.claude\Using AI\
 * Buses`, which does not exist — so SEVEN tests skipped, five of them the falsification
 * controls for collect-maps.ps1, in the one place OA-341 now requires engine work to be
 * done. They skipped VISIBLY, which is what this file was written for and is the only
 * reason the number could be read at all; what was wrong is that the estate was not absent.
 *
 * THIS IS NOT THE QUIET FALLBACK THE HEADER FORBIDS. `mainCheckoutTwin` asks git for the
 * main checkout of THIS repository and for nothing else, so the walks are retried from the
 * one tree that is by definition the same work — never from whichever other tree happens to
 * be on the disk. BUSES_DIR stays authoritative and short-circuits both. */
const CANDIDATES = () => {
  if (process.env.BUSES_DIR) return [path.resolve(process.env.BUSES_DIR)];
  const twin = mainCheckoutTwin(__dirname);
  return [...LAYOUTS(__dirname), ...(twin ? LAYOUTS(twin) : [])];
};

/* The repository root, or null. A directory is only the estate if it HAS an
 * estate — a `Areas/` beside it — because an empty checkout at the right path
 * would otherwise pass the existence test and then find nothing to assert. */
function busesDir() {
  for (const c of CANDIDATES()) {
    if (fs.existsSync(path.join(c, 'Areas'))) return c;
  }
  return null;
}

/* node:test's own skip option, carrying the reason and the paths tried, so the
 * run says WHICH tree it wanted. `{ skip: false }` runs the test. */
const needsBuses = (() => {
  if (busesDir()) return { skip: false };
  const where = process.env.BUSES_DIR
    ? 'BUSES_DIR=' + process.env.BUSES_DIR
    : CANDIDATES().join('  |  ');
  return { skip: 'no buses-data estate found (' + where + ') — set BUSES_DIR to point at it' };
})();

module.exports = { busesDir, needsBuses };
