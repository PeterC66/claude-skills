'use strict';
/*
 * baseline.js — the "could not look" verdict, shared by prove-red.js and by the
 * harness that falsifies it (buses-data OA-353).
 *
 * WHY THIS FILE EXISTS. `prove-red.js` runs every suite against an unmutated
 * scratch copy before it mutates anything, because otherwise "the suite noticed"
 * could be the copy failing rather than the mutation. The guard is right. What
 * was wrong until 2026-09-14 is that its stop shared one exit path — one line,
 * exit 1 — with the outcome it has nothing in common with: `a mutation
 * SURVIVED`. On 2026-09-13 a place map's S3 moved, one estate-control test went
 * red, and from then until the next day the answer to *can these 341 mutations
 * fail?* was NOBODY HAS ASKED, while the run printed a single ordinary-looking
 * failure line. A harness needs `caught`, `survived` AND `could not look`, or it
 * measures itself — [the refusal read as an absence] in the failure-shapes list.
 *
 * WHAT IT GIVES. Two exit codes that mean different things, and a stop that says
 * the number that did NOT happen: `0 of 341 mutations ran` beside a count that
 * is normally in the hundreds is the cheapest possible signal that a run is not
 * a pass. It is a module rather than lines inside prove-red.js so that
 * `prove-red-baseline.js` can drive the verdict with a stub runner and watch it
 * go red in milliseconds, instead of needing a repository that is genuinely
 * broken.
 */

/* A mutation survived, or an anchor is stale: the harness RAN and found a hole. */
const EXIT_FOUND_A_HOLE = 1;
/* The baseline was red, so not one mutation was attempted. Deliberately NOT 1:
 * the two outcomes sharing an exit code is the whole fault this file fixes. */
const EXIT_DID_NOT_RUN = 2;

/* Run every suite once against the unmutated copy and report which are red.
 * `runSuite` is injected so the harness can stub it; in prove-red.js it is the
 * same spawnSync the mutations themselves use. */
function checkBaseline({ suites, mutationCount, runSuite }) {
  const red = [];
  for (const suite of suites) {
    const r = runSuite(suite);
    if (!r || r.status !== 0) red.push({ suite, output: (r && (r.stdout || r.stderr)) || '' });
  }
  return { ok: red.length === 0, red, suiteCount: suites.length, mutationCount };
}

/* The stop. Every line of it is load-bearing: the first says this is not a test
 * failure, the second is the count that did not happen, the third names the red
 * that caused it, and the last says where to fix it. */
function stopLines(v) {
  const bar = '='.repeat(78);
  const lines = [
    bar,
    'THE MUTATION HARNESS DID NOT RUN — this is NOT a test failure and NOT a pass.',
    `0 of ${v.mutationCount} mutations ran, 0 caught, 0 survived, 0 anchors stale.`,
    `${v.red.length} of ${v.suiteCount} baseline suites are red against an UNMUTATED copy of assets/:`,
  ];
  for (const r of v.red) lines.push(`  - ${r.suite}`);
  lines.push(
    `Until they are green, nobody has asked whether those ${v.mutationCount} mutations are`,
    'caught — and the unit suite will go on reporting an ordinary, unalarming shape.',
    'Each suite above is red on the working tree too, unmutated: fix it there, then',
    'run this again.',
    bar,
  );
  return lines;
}

/* The green form, printed only by --baseline-only. A run that goes on to mutate
 * says nothing here, so the ordinary output is unchanged. */
function readyLine(v) {
  return `baseline green: ${v.suiteCount} of ${v.suiteCount} suites pass against an unmutated copy of assets/, `
    + `${v.mutationCount} mutations ready to run.`;
}

module.exports = { EXIT_FOUND_A_HOLE, EXIT_DID_NOT_RUN, checkBaseline, stopLines, readyLine };
