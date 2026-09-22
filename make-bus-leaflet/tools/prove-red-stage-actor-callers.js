#!/usr/bin/env node
/*
 * prove-red-stage-actor-callers.js — falsify the OA-427 caller join.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-stage-actor-callers.js
 * No arguments, no placeholders.
 *
 * WHY THIS HARNESS EXISTS AT ALL. The check it falsifies is a source-reading join,
 * and a source-reading join is the easiest kind of check to write green for ever:
 * a regex that has quietly stopped matching anything reports every call site it
 * can see as correct, and it can see none. So each arm below breaks the SUBJECT in
 * a way the real defect would break it and asserts the named case goes red — and
 * asserts, in the same run, that the cases which are not about that defect stay
 * green. A run where everything reddens proves the harness broke the copy, not
 * that the join works, which is the trap prove-red-stage-commit.js paid for.
 *
 * THE MUTATIONS ARE THE TWO WAYS THIS FIX CAN ROT.
 *   1. A call site stops forwarding the flag — the state every one of them was in
 *      before 2026-09-22, when 1,211 stage runs carried no actor.
 *   2. `byArgs` starts inventing a name for the absent case. That is the dangerous
 *      one: it would fill the window with a confident answer rather than leaving
 *      it honestly empty, and the rate built on it would read as a rate over the
 *      estate. `stage_actor.test.js` holds the same line at the CLI; this holds it
 *      at the shared helper the four callers all reach for.
 *
 * THE COPY IS A WHOLE DIRECTORY, not one file, because the subject is a set of
 * files and the join's first case counts them. It goes in a scratch dir and the
 * originals are never written to; both are byte-compared at the end, because a
 * harness that leaves the estate mutated is worse than no harness.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const TEST = path.join(ROOT, 'test', 'stage_actor_callers.test.js');
const SUBJECTS = ['cli.js', 'rollout.js', 'rollout_places.js', 'adopt_config.js', 'poi_tiers_sync.js'];

const CALL_SITE = 'the set of stage.js callers';
const FORWARDS = 'forwards the by-spread';
const ABSENT = 'spreads to NOTHING';
const PASSES = 'passes a name through';

let bad = 0, ran = 0;
const check = (label, ok, detail) => {
  ran++; if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`);
};

/* The bytes of every subject as this run found them, read once and compared at the
 * end. Taken BEFORE any copy is made, so section 4 is a claim about this harness. */
const BEFORE = new Map(SUBJECTS.map(f => [f, fs.readFileSync(path.join(ASSETS, f))]));

/* A scratch copy of the five subject files. Nothing else from assets/ is needed:
 * the test reads the directory and requires cli.js out of it, and no other file
 * there spawns stage.js. */
function copySubjects() {
  const dir = scratchDir('prove-red-callers-');
  for (const f of SUBJECTS) fs.copyFileSync(path.join(ASSETS, f), path.join(dir, f));
  return dir;
}

/* Run the suite against a subject directory and return which case names passed
 * and which failed. Both reporter formats are read for the reason the sibling
 * harnesses state: `node --test` defaults to `spec` from Node 22 and to `tap`
 * before it, this laptop is on Node 24 and the CI runner is pinned to Node 20,
 * and a spec-only parser reads zero tests in CI and calls that a pass. */
function runSuite(assetsDir) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STAGE_CALLERS_ASSETS: assetsDir } });
  const out = r.stdout + r.stderr;
  const passed = [], failed = [];
  for (const line of out.split('\n')) {
    let m = /^\s*(✔|✖)\s+(.*?)(?:\s+\([\d.]+ms\))?\s*$/.exec(line);
    if (m) { (m[1] === '✔' ? passed : failed).push(m[2]); continue; }
    m = /^\s*(ok|not ok)\s+\d+\s+-\s+(.*?)\s*$/.exec(line);
    if (m) (m[1] === 'ok' ? passed : failed).push(m[2]);
  }
  return { passed, failed, out, status: r.status };
}
const has = (list, frag) => list.some(n => n.includes(frag));

/* ---- the control: unmutated, everything must be green --------------------- */
console.log('\n0. The unmutated copy is green, so a red below is the mutation and not the copy');
{
  const dir = copySubjects();
  const { passed, failed, out } = runSuite(dir);
  check('every case passes against an untouched copy', failed.length === 0 && passed.length >= 6,
    `passed ${passed.length}, failed ${failed.length}\n${failed.length ? out : ''}`);
}

/* ---- arm 1: a call site stops forwarding ---------------------------------- */
console.log('\n1. A call site that stops forwarding --by reddens the join, and only the join');
{
  const dir = copySubjects();
  const p = path.join(dir, 'rollout.js');
  const src = fs.readFileSync(p, 'utf8');
  const FROM = "const s4Dir = stage(t.dir, 'new', 'S4', '--bump', BUMP, ...BY);";
  const TO = "const s4Dir = stage(t.dir, 'new', 'S4', '--bump', BUMP);";
  if (!src.includes(FROM)) {
    console.error('prove-red-stage-actor-callers: could not find rollout.js\'s S4 `new` call site.');
    console.error('  If it was deliberately reshaped, update this harness with it — a harness that');
    console.error('  cannot find its subject silently proves nothing.');
    process.exit(1);
  }
  fs.writeFileSync(p, src.replace(FROM, TO));
  const { passed, failed } = runSuite(dir);
  check('the forwarding case goes RED', has(failed, FORWARDS), `failed: ${failed.join(' | ') || 'nothing'}`);
  check('and the caller-set case stays green — the file is still a caller', has(passed, CALL_SITE));
  check('and both byArgs cases stay green — the helper was not touched',
    has(passed, ABSENT) && has(passed, PASSES));
}

/* ---- arm 2: byArgs invents a name for the absent case --------------------- */
console.log('\n2. A byArgs that invents a name for the absent case reddens the control that forbids it');
{
  const dir = copySubjects();
  const p = path.join(dir, 'cli.js');
  const src = fs.readFileSync(p, 'utf8');
  const FROM = "  if (v === undefined || v === null || v === false) return [];";
  const TO = "  if (v === undefined || v === null || v === false) return ['--by', 'unknown'];";
  if (!src.includes(FROM)) {
    console.error('prove-red-stage-actor-callers: could not find byArgs\'s absent-case guard in cli.js.');
    process.exit(1);
  }
  fs.writeFileSync(p, src.replace(FROM, TO));
  const { passed, failed } = runSuite(dir);
  check('the absent-case control goes RED', has(failed, ABSENT), `failed: ${failed.join(' | ') || 'nothing'}`);
  check('and the pass-through case stays green — a real name is still passed through', has(passed, PASSES));
  check('and the forwarding join stays green — no call site changed', has(passed, FORWARDS));
}

/* ---- arm 3: the matcher itself, which is the thing that can go blind ------ */
console.log('\n3. A caller the matcher cannot see is a caller nothing holds to the rule');
{
  const dir = copySubjects();
  fs.unlinkSync(path.join(dir, 'adopt_config.js'));
  const { failed } = runSuite(dir);
  check('losing a caller reddens the caller-set case rather than passing quietly',
    has(failed, CALL_SITE), `failed: ${failed.join(' | ') || 'nothing'}`);
}

/* ---- the originals are untouched ----------------------------------------- */
console.log('\n4. The estate is as it was — every subject byte-identical to the file this harness read');
{
  /* BYTES, not mtimes and not `git diff`. git would report a subject clean while
   * this run had rewritten it to whatever HEAD says, and an existence test cannot
   * fail at all — which is the shape of check this file exists to disallow. */
  for (const f of SUBJECTS) {
    const now = fs.readFileSync(path.join(ASSETS, f));
    check(`assets/${f} unchanged`, now.equals(BEFORE.get(f)),
      'this harness wrote to the real file — restore it from git before doing anything else');
  }
}

console.log(`\n${bad ? 'FAILED' : 'PASSED'} — ${ran - bad}/${ran} checks`);
process.exit(bad ? 1 : 0);
