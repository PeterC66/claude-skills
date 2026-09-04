/*
 * rollout_crossings.test.js — the self-crossing check is CALLED, by both rollout
 * tools, everywhere they build a schematic (buses-data OA-240, 2026-09-04).
 *
 * WHY A SECOND FILE. `schematic_crossings.test.js` asks whether the detector is
 * right. This asks whether anything runs it, which is a different question and
 * the one this project has got wrong before: the unit of an extraction here is
 * not the module, it is the module PLUS a check on its callers. A helper that
 * exists and a helper that is used look identical from the module's own suite.
 *
 * AND THE ROLLOUT IS THE ONLY PLACE THE QUESTION CAN BE ASKED AT ALL. The
 * schematic workspace — `schematic/routes_paths.json` — lives in an S4 run folder
 * and nowhere else. `ci-reference/` mirrors an S4 run and does not carry it, so a
 * fresh CI clone has nothing to read and `status.js` cannot host this check
 * however much one might want it to. If these call sites go, the check has no
 * home left.
 *
 * BOTH TOOLS, AND THAT PAIRING IS THE POINT. `rollout_places.js` builds a
 * schematic too — High Wycombe Aldi has one — and wiring only the town tool is
 * how a guard ends up covering a class once rather than completely. That has
 * happened here before, in this exact pair of files: the 2026-08-06 bug where the
 * real-S4 branch ran `schematize_internal.js` without copying it in, silently,
 * because only the dry-run branch had been looked at.
 *
 * THE CENSUS IS ON THE COUNT, not on a list of line numbers. Each tool runs the
 * schematizer TWICE — once into a scratch dry run and once into the real S4 — and
 * the check has to follow both, so the assertion is that the two counts agree.
 * A third build path added later fails this the day it is written.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, ENGINE_DIR } = require('./_engine');

const { crossingWarnings, DEFAULT_SEP_M } = load('schematic_crossings.js');
const { severity, collect, blocking } = load('build_log.js');

const TOOLS = ['rollout.js', 'rollout_places.js'];
const src = (name) => fs.readFileSync(path.join(ENGINE_DIR, name), 'utf8');

test('both rollout tools follow every schematizer run with the crossing check', () => {
  for (const tool of TOOLS) {
    const s = src(tool);
    const runs = (s.match(/runNode\(path\.join\(s4[A-Za-z]*, 'schematize_internal\.js'\)/g) || []).length;
    // Counted on the ARGUMENT, not on the bare name. The first draft counted
    // `crossingWarnings(` and subtracted one for the require — which does not
    // contain a paren at all, so the subtraction was really cancelling a mention
    // of the function inside a comment in one file and nothing in the other. It
    // reported the correctly-wired place tool as short by one. A census whose
    // population is "every appearance of a word" is a census of the prose.
    const checks = (s.match(/crossingWarnings\(s4[A-Za-z]*[,)]/g) || []).length;
    assert.ok(runs >= 2, `${tool} builds a schematic in ${runs} place(s) — expected the dry run and the real S4`);
    assert.strictEqual(checks, runs,
      `${tool} runs the schematizer ${runs} times and checks for crossings ${checks} times`);
  }
});

test('neither rollout tool has grown its own copy of the geometry', () => {
  // The failure this forestalls is not a wrong answer, it is a SECOND answer:
  // two crossing detectors that agree until the day one of them is fixed.
  for (const tool of TOOLS) {
    const s = src(tool);
    assert.match(s, /require\('\.\/schematic_crossings'\)/, `${tool} does not require the detector`);
    for (const own of ['function properCross', 'function selfCrossings', 'function segSepM']) {
      assert.ok(!s.includes(own), `${tool} has grown its own ${own}`);
    }
  }
});

/* ---- the finding, as the build log will read it ------------------------- */

function makeRun(geo, sch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-run-'));
  fs.mkdirSync(path.join(dir, 'schematic'));
  fs.writeFileSync(path.join(dir, 'routes_paths.json'),
    JSON.stringify({ routes: { 66: { pts: geo, edges: [] } }, edgeWay: {} }));
  fs.writeFileSync(path.join(dir, 'schematic', 'routes_paths.json'),
    JSON.stringify({ routes: { 66: { pts: sch, edges: [] } } }));
  return dir;
}
const CLEAN = [[52.000, 0.000], [52.000, 0.010], [52.005, 0.010], [52.005, 0.000], [52.010, 0.000]];
const CROSSED = CLEAN.map((p, i) => (i === 3 ? [51.998, 0.000] : p));
const NEAR = [[52.000, 0.000], [52.000, 0.010], [52.0005, 0.010], [52.0005, 0.000], [52.001, 0.000]];
const NEAR_CROSSED = NEAR.map((p, i) => (i === 3 ? [51.9995, 0.000] : p));

test('crossingWarnings says nothing about a run with no schematic, and nothing about a clean one', () => {
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-run-'));
  fs.writeFileSync(path.join(none, 'routes_paths.json'), JSON.stringify({ routes: {} }));
  assert.deepStrictEqual(crossingWarnings(none), []);
  fs.rmSync(none, { recursive: true, force: true });

  const clean = makeRun(CLEAN, CLEAN);
  assert.deepStrictEqual(crossingWarnings(clean), []);
  fs.rmSync(clean, { recursive: true, force: true });
});

test('crossingWarnings applies the threshold — a bus doubling back is not a build warning', () => {
  const near = makeRun(NEAR, NEAR_CROSSED);
  assert.deepStrictEqual(crossingWarnings(near), [],
    'a 56 m crossing must not reach the build log — every schematic on the estate has dozens');
  assert.strictEqual(crossingWarnings(near, { sepM: 10 }).length, 1,
    'and the threshold must still be the thing deciding it');
  fs.rmSync(near, { recursive: true, force: true });
});

test('a Class A crossing produces one line, naming the distance', () => {
  const dirty = makeRun(CLEAN, CROSSED);
  const w = crossingWarnings(dirty);
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /^crossings: route 66 /);
  assert.match(w[0], /m apart on the ground/);
  assert.match(w[0], /OA-240/, 'the line names the row, so a reader of build-warnings.txt can find the reasoning');
  fs.rmSync(dirty, { recursive: true, force: true });
});

test('the warning is WARN and not BLOCKING — the property that lets it ship today', () => {
  // THE LINE THIS TEST HOLDS, and it is fragile in an interesting way: severity()
  // classifies on the PROSE, so a well-meant rewording of the message into "the
  // sheet is not drawn correctly" would silently make it blocking and stop the
  // next build of three published maps. Promoting it is a decision, and this is
  // what makes it one.
  const dirty = makeRun(CLEAN, CROSSED);
  const w = crossingWarnings(dirty);
  assert.strictEqual(severity(w[0]), 'WARN', `"${w[0]}" would block a build`);
  // And through the real collection path the two rollout tools use.
  const entries = collect([{ source: 'crossings', stderr: w.join('\n'), ok: true }]);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].source, 'crossings');
  assert.strictEqual(entries[0].code, 'crossings');
  assert.deepStrictEqual(blocking(entries), []);
  fs.rmSync(dirty, { recursive: true, force: true });
});

test('an unreadable run is reported, not thrown — a rollout must not die of a checker', () => {
  // A guard that can crash the build it guards is worse than no guard. The one
  // thing this must never do is take a rollout down with it.
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-run-'));
  fs.mkdirSync(path.join(broken, 'schematic'));
  fs.writeFileSync(path.join(broken, 'routes_paths.json'), '{ not json');
  fs.writeFileSync(path.join(broken, 'schematic', 'routes_paths.json'), '{}');
  const w = crossingWarnings(broken);
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /could not read this run/);
  assert.strictEqual(severity(w[0]), 'WARN', 'and it does not block either');
  fs.rmSync(broken, { recursive: true, force: true });
});

test('the default threshold the rollout uses is the detector\'s own', () => {
  // Not a tautology: the two rollout tools call crossingWarnings with no options,
  // so a second default written at the call site is the way these drift apart.
  assert.strictEqual(DEFAULT_SEP_M, 150);
  for (const tool of TOOLS) {
    assert.ok(!/crossingWarnings\([^)]*sepM/.test(src(tool)),
      `${tool} passes its own threshold — there must be one number, in the detector`);
  }
});
