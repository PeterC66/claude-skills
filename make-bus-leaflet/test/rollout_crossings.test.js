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
 * THE SUBJECT MOVED ON 2026-09-12 (buses-data OA-310), AND THE PROPERTY DID NOT.
 * Both tools' four copies of the copy-run-capture sequence became one statement in
 * `build_s4.js`, so the question "does every schematizer run carry the check" is now
 * asked of that file's RECIPE rather than of two files' line counts — and it is asked
 * of the RECIPE OBJECT, not of a list of levels typed here, because a check pointed at
 * an identifier the test itself supplies cannot report that the identifier was wrong.
 * The count census survives in the second test below, one level up: each tool must
 * still reach the one build path exactly twice, the dry run and the real S4, so a
 * third build path added later fails this the day it is written.
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
const { RECIPE } = load('build_s4.js');

const TOOLS = ['rollout.js', 'rollout_places.js'];
const FILES = ['rollout.js', 'rollout_places.js', 'build_s4.js'];
const src = (name) => fs.readFileSync(path.join(ENGINE_DIR, name), 'utf8');

/* Every (sheet, level) pair the engine can draw, taken from the RECIPE itself so a
 * level or a sheet added later is in the population without anybody remembering. */
const RECIPES = Object.entries(RECIPE)
  .flatMap(([key, byLevel]) => Object.entries(byLevel).map(([level, r]) => ({ key, level, r })));

test('every schematizer run in the one build path carries the crossing check', () => {
  const schematizers = RECIPES.filter(x => x.r.script === 'schematize_internal.js');
  assert.ok(schematizers.length >= 2,
    `the RECIPE runs the schematizer for ${schematizers.length} (sheet, level) pair(s) — expected an area and a place`);
  for (const { key, level, r } of schematizers) {
    assert.strictEqual(r.crossings, true, `${key}/${level} runs the schematizer and does not check for crossings`);
  }
  // And the other direction, which is the one a copy-paste gets wrong: nothing that
  // is NOT the schematizer may claim the check. There is no schematic workspace to
  // read for any other sheet, so the answer would be about the previous sheet's.
  for (const { key, level, r } of RECIPES) {
    if (r.script !== 'schematize_internal.js') {
      assert.ok(!r.crossings, `${key}/${level} claims the crossing check and does not run the schematizer`);
    }
  }
});

test('each rollout tool reaches the one build path exactly twice — the dry run and the real S4', () => {
  // The census that used to count schematizer runs, one level up. Counted on the
  // CALL, not on the bare name: an earlier version of this file counted a word and
  // was really counting a mention of it inside a comment.
  for (const tool of TOOLS) {
    const s = src(tool);
    const builds = (s.match(/buildSheets\(\{/g) || []).length;
    assert.strictEqual(builds, 2,
      `${tool} calls buildSheets ${builds} time(s) — expected the scratch dry run and the real S4`);
    // On the DEFINITION, not on the word: both files name runNode in a comment saying
    // where it went, and a census that counts those is a census of the prose — the
    // fault this file's header already records itself committing once.
    assert.ok(!/(?:function|const)\s+runNode\b/.test(s),
      `${tool} has its own runNode again — the whole point of build_s4.js is that it does not`);
  }
});

test('no build path has grown its own copy of the geometry', () => {
  // The failure this forestalls is not a wrong answer, it is a SECOND answer:
  // two crossing detectors that agree until the day one of them is fixed.
  assert.match(src('build_s4.js'), /require\('\.\/schematic_crossings'\)/,
    'build_s4.js does not require the detector');
  for (const f of FILES) {
    const s = src(f);
    for (const own of ['function properCross', 'function selfCrossings', 'function segSepM']) {
      assert.ok(!s.includes(own), `${f} has grown its own ${own}`);
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
/* Two DIFFERENT roads 445 m apart on the ground, which the schematizer put on one
 * line and left 1e-8 of a degree off it -- a retrace, and the shape 94 of the
 * estate's 99 new crossings actually have. It clears the ground threshold easily,
 * because running two distant streets down one line is what a tube map is for. */
const RETRACE = [[52.000, 0.000], [52.000, 0.010], [52.004, 0.010], [52.004, 0.000]];
const RETRACE_SCH = [[52.000, 0.000], [52.000, 0.010], [52.00000001, 0.010], [51.99999999, 0.000]];

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

test('crossingWarnings applies the WEDGE threshold too - a retrace is not a build warning', () => {
  // The second threshold, at the place the rollout reads it. Both thresholds have
  // to be applied HERE and not only in the CLI, or the build log gets a different
  // answer from the sweep -- and this one is the dangerous direction, because a
  // threshold that only subtracts fails silently.
  const rt = makeRun(RETRACE, RETRACE_SCH);
  assert.deepStrictEqual(crossingWarnings(rt), [],
    'a retrace opens no wedge, so it must not reach the build log however far apart the roads are');
  assert.strictEqual(crossingWarnings(rt, { excMM: 0 }).length, 1,
    'and the WEDGE threshold must be the thing deciding it, not the ground one');
  fs.rmSync(rt, { recursive: true, force: true });
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

test('the default threshold the build path uses is the detector\'s own', () => {
  // Not a tautology: the one call site passes crossingWarnings no options, so a
  // second default written there is the way these drift apart. All three files are
  // in the population, because the call site moving is exactly what happened once.
  assert.strictEqual(DEFAULT_SEP_M, 150);
  for (const f of FILES) {
    assert.ok(!/crossingWarnings\([^)]*sepM/.test(src(f)),
      `${f} passes its own threshold — there must be one number, in the detector`);
  }
});
