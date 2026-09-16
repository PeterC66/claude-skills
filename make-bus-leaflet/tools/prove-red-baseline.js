#!/usr/bin/env node
/*
 * prove-red-baseline.js — falsify the "could not look" verdict (buses-data OA-353).
 *
 *   node tools/prove-red-baseline.js
 *
 * Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` — the engine's own
 * folder. No placeholders.
 *
 * WHY. `prove-red.js` is the file that makes the unit suite's green mean
 * anything, and it has one outcome that is neither a pass nor an ordinary
 * failure: the baseline is red, so NOT ONE mutation was attempted. Until
 * 2026-09-14 that outcome printed a single line and exited 1, exactly like a
 * mutation surviving — and on 2026-09-13 it hid a full day in which the answer
 * to *can these 341 mutations fail?* was nobody has asked. A verdict that
 * distinguishes the two is itself a check, so it ships with its falsification.
 *
 * SEVEN CASES. The first five drive tools/lib/baseline.js directly with a stub
 * runner, in milliseconds, which is why a genuinely broken repository is not
 * needed to watch the stop fire. The last two run `prove-red.js --baseline-only`
 * end to end — green on this checkout, and RED on a scratch copy of the skill
 * with one test file deliberately broken — because the first five would all pass
 * against a module nothing called. ~1-2 min, almost all of it those two.
 *
 *   0  control: every suite green          -> ok, and the ready line counts BOTH
 *                                             the suites and the mutations
 *   1  one suite red                       -> the stop, naming it, and saying
 *                                             0 of N mutations RAN
 *   2  two suites red                      -> both named, and "2 of 3"
 *   3  the runner returns nothing at all   -> red, never green. A suite that
 *                                             could not be run is the refusal
 *                                             read as an absence, and this is
 *                                             the control for it
 *   4  the two exit codes differ           -> the whole point of the action: a
 *                                             harness that DID NOT RUN must not
 *                                             share an exit code with one that
 *                                             ran and found a hole
 *   5  e2e control: --baseline-only here   -> exit 0, the ready line, and NOT
 *                                             the mutation table
 *   6  e2e red: a scratch copy of the skill
 *      with one baseline suite broken      -> exit 2, the stop, the suite named
 *
 * CASE 5 IS NOT DECORATION. Cases 0-4 assert things about a module, and a module
 * prove-red.js had stopped requiring would pass every one of them — the estate's
 * own *the subject you named yourself*. Case 5 is what joins the two files, and
 * case 6 is what proves the join carries the RED and not merely the green.
 *
 * CASE 4 AND CASE 6 DIVIDE ONE ASSERTION AND NEITHER HALF IS SUFFICIENT, which
 * was measured rather than reasoned: setting EXIT_DID_NOT_RUN back to 1 — the
 * behaviour before OA-353 — turns case 4 red and leaves case 6 GREEN, because
 * case 6 compares the observed exit code to the declared constant and follows it
 * wherever it goes. Case 6 says the declared code is what a real run exits with;
 * case 4 says that code is not the one a found-a-hole run uses. Both, or the
 * regression walks between them.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SK = path.resolve(__dirname, '..');
const {
  EXIT_FOUND_A_HOLE, EXIT_DID_NOT_RUN, checkBaseline, stopLines, readyLine,
} = require('./lib/baseline');

let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const ok = (m) => console.log(`  + ${m}`);
const has = (text, needle) => text.includes(needle);

/* A stub runner: every suite is green unless it is named in `red`. */
const stub = (red) => (suite) => (red.includes(suite) ? { status: 1, stdout: `FAIL ${suite}` } : { status: 0, stdout: '' });
const SUITES = ['alpha.test.js', 'beta.test.js', 'gamma.test.js'];
const N = 341;

console.log('\nprove-red-baseline.js — can the "the harness did not run" verdict go red?\n');

// 0 — control.
{
  const v = checkBaseline({ suites: SUITES, mutationCount: N, runSuite: stub([]) });
  const line = readyLine(v);
  if (!v.ok) fail('0 control: a fully green baseline did not read as ok');
  else if (!has(line, '3 of 3') || !has(line, `${N} mutations ready`)) fail(`0 control: the ready line says neither count: ${line}`);
  else if (/DID NOT RUN/.test(line)) fail('0 control: a green baseline printed the did-not-run words');
  else ok('0 control: a green baseline is ok, and the ready line counts 3 of 3 suites and 341 mutations');
}

// 1 — one suite red.
{
  const v = checkBaseline({ suites: SUITES, mutationCount: N, runSuite: stub(['beta.test.js']) });
  const text = stopLines(v).join('\n');
  if (v.ok) fail('1: a red suite still read as ok');
  else if (!has(text, 'DID NOT RUN')) fail('1: the stop does not say the harness did not run');
  else if (!has(text, `0 of ${N} mutations ran`)) fail(`1: the stop does not say 0 of ${N} mutations ran`);
  else if (!has(text, 'beta.test.js')) fail('1: the stop does not name the suite that stopped it');
  else if (!has(text, '1 of 3 baseline suites')) fail('1: the stop does not say how many of how many are red');
  else ok('1: one red suite stops it, and the stop says DID NOT RUN, 0 of 341 ran, 1 of 3 suites, and names beta.test.js');
}

// 2 — two suites red.
{
  const v = checkBaseline({ suites: SUITES, mutationCount: N, runSuite: stub(['alpha.test.js', 'gamma.test.js']) });
  const text = stopLines(v).join('\n');
  if (v.ok) fail('2: two red suites still read as ok');
  else if (!has(text, '2 of 3 baseline suites')) fail('2: the stop does not count both red suites');
  else if (!has(text, 'alpha.test.js') || !has(text, 'gamma.test.js')) fail('2: the stop names one red suite and not the other');
  else ok('2: two red suites are both named, and counted as 2 of 3');
}

// 3 — the runner could not answer at all.
{
  const v = checkBaseline({ suites: SUITES, mutationCount: N, runSuite: () => undefined });
  if (v.ok) fail('3: a runner that answered nothing at all read as GREEN — could-not-look became a pass');
  else if (v.red.length !== 3) fail(`3: ${v.red.length} of 3 unanswerable suites counted as red`);
  else ok('3: a suite that could not be run is red, never green — three of three');
}

// 4 — the exit codes.
{
  if (EXIT_DID_NOT_RUN === EXIT_FOUND_A_HOLE) fail('4: "did not run" and "found a hole" still share an exit code — the fault OA-353 is about');
  else if (EXIT_DID_NOT_RUN === 0) fail('4: "did not run" exits 0, so CI would read it as a pass');
  else ok(`4: the two outcomes have different exit codes — ${EXIT_DID_NOT_RUN} for did-not-run, ${EXIT_FOUND_A_HOLE} for found-a-hole`);
}

// 5 — end to end on this checkout, green.
{
  const r = spawnSync(process.execPath, [path.join(SK, 'tools', 'prove-red.js'), '--baseline-only'],
    { cwd: SK, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) fail(`5 e2e control: --baseline-only exited ${r.status} on this checkout:\n${out.slice(-2000)}`);
  else if (!has(out, 'baseline green:')) fail('5 e2e control: --baseline-only printed no ready line');
  else if (has(out, 'Mutation testing')) fail('5 e2e control: --baseline-only went on to run the mutations');
  else ok(`5 e2e control: prove-red.js --baseline-only exits 0 here and says — ${out.trim().split('\n').pop()}`);
}

// 6 — end to end on a scratch copy with one baseline suite broken.
{
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-red-baseline-'));
  const skill = path.join(scratch, 'make-bus-leaflet');
  for (const dir of ['assets', 'test', 'tools']) fs.cpSync(path.join(SK, dir), path.join(skill, dir), { recursive: true });
  const victim = path.join(skill, 'test', 'road_graph.test.js');
  fs.appendFileSync(victim,
    '\nrequire("node:test")("OA-353 fixture: a deliberately red baseline test", () => {'
    + ' require("node:assert").equal(1, 2); });\n');
  const r = spawnSync(process.execPath, [path.join(skill, 'tools', 'prove-red.js'), '--baseline-only'],
    { cwd: skill, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== EXIT_DID_NOT_RUN) fail(`6 e2e red: a broken baseline exited ${r.status}, not ${EXIT_DID_NOT_RUN}:\n${out.slice(-2000)}`);
  else if (!has(out, 'DID NOT RUN')) fail('6 e2e red: the run did not say the harness did not run');
  else if (!has(out, 'road_graph.test.js')) fail('6 e2e red: the run did not name the suite that stopped it');
  else if (!/0 of \d+ mutations ran/.test(out)) fail('6 e2e red: the run did not say how many mutations did not happen');
  else ok('6 e2e red: one broken baseline suite gives exit 2, the stop, the suite by name, and 0 of N mutations ran');
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n7 cases, ${7 - failures} passed, ${failures} failed.\n`);
process.exitCode = failures ? 1 : 0;
