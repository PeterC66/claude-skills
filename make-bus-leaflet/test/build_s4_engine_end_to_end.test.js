'use strict';
/*
 * build_s4_engine_end_to_end.test.js — a sheet is drawn by the engine that is BUILDING it,
 * asserted end to end from an engine directory that is not the installed one
 * (buses-data OA-342 item 3).
 *
 * WHY A SECOND FILE RATHER THAN A CASE IN build_s4.test.js. The two tests there are
 * resolution-level joins: one enumerates RECIPE through sheetEnv() and asserts every
 * row names an engine, the other sets process.env.SKILL_ASSETS to what sheetEnv()
 * returned and asserts engine_paths.js then resolves under it. Both call sheetEnv()
 * themselves, so neither can see a build path that stops calling it — and the second
 * one says so in its own closing comment: "Run from the INSTALLED engine the two are
 * the same folder and only the first assertion above is doing any work." `npm test`
 * runs from the installed engine on this laptop, which is exactly the machine where
 * the hybrid of 2026-09-13 was drawn, so the join that was supposed to be the guard
 * is vacuous precisely where the fault lives. That is the shape this estate has
 * named as *the number that was already true*: an equality that holds by
 * construction cannot tell agreement from absence.
 *
 * WHAT THIS FILE DOES INSTEAD. It copies the engine under test to a scratch
 * directory, requires build_s4.js FROM THAT COPY — so SK, the engine doing the
 * building, is provably not the installed one — and runs a real buildSheets() over a
 * real run folder. Nothing here calls sheetEnv(); the assertion is the path a
 * spawned generator wrote to disk. A build path that copied a generator in and
 * spawned it without the environment would be red here however tidy the RECIPE is.
 *
 * BOTH SHEET KINDS, because one of them cannot stand for the other. OA-342's own
 * measurement is that `internal.area`, `external.area` and `external.place` were the
 * three rows carrying no engine, and that the external sheet READ as innocent on
 * 2026-09-13 only because the change being rolled out was a poi_select.js one the
 * external generator never loads — an engine difference of zero measured and
 * reported as a pass. So the external case is not a copy of the internal one: it
 * probes `labeller.js`, which is the single _dep() call the external generator's
 * whole dependency chain hangs off, and then the sibling resolution that follows it.
 *
 * THE PROBE'S BOOTSTRAP IS TAKEN FROM THE ENGINE, NEVER RETYPED. The four-line
 * search that finds engine_paths.js is the one piece no module can own, and
 * engine_paths.test.js asserts every entry point spells it identically. A copy of it
 * written out here would be a fourteenth spelling, in a file that test does not read,
 * and it would go stale the first time the search changed — so each stub is built by
 * slicing the block out of the real generator it stands in for. If that slice ever
 * stops being findable the test fails loudly rather than falling back to a literal.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR, load } = require('./_engine');

const { EXTERNAL_GENERATOR } = load('gate_lib.js');
const { ENGINE_HOME } = load('engine_paths.js');

const BOOT_FIRST = 'const _EP = (() => {';
const BOOT_LAST = 'const _dep = engineDep(__dirname);';

/* The bootstrap block of a real generator, start of `const _EP` to end of the `_dep`
 * line inclusive. Read rather than written, for the reason in the header. */
function bootstrapOf(generator) {
  const src = fs.readFileSync(path.join(ENGINE_DIR, generator), 'utf8');
  const from = src.indexOf(BOOT_FIRST);
  const last = src.indexOf(BOOT_LAST);
  assert.ok(from >= 0 && last > from,
    `${generator} no longer carries the engine_paths.js bootstrap this probe is built from`);
  return src.slice(from, last + BOOT_LAST.length);
}

/* A generator that draws nothing and reports one thing: which engine it resolved its
 * shared modules through. It writes the sheet the recipe expects, so the build is a
 * success in every other respect and the only thing under test is the path. */
function probe(generator, outName, lines) {
  return "'use strict';\n"
    + "const fs = require('fs');\nconst path = require('path');\n"
    + bootstrapOf(generator) + '\n'
    + `fs.writeFileSync(path.join(process.cwd(), ${JSON.stringify(outName)}), [${lines}].join('\\n'));\n`;
}

/* The internal generator takes icons.js straight off _dep. */
const INTERNAL_PROBE = () => probe('gen_internal.js', 'internal.svg', "_dep('icons.js')");
/* The external generator takes labeller.js off _dep and then everything else off
 * siblingOf(_LABELLER) — so one resolution decides seven modules, and the second
 * line is the chain that follows it. */
const EXTERNAL_PROBE = () => probe(EXTERNAL_GENERATOR, 'external.svg',
  "_dep('labeller.js'), siblingOf(_dep('labeller.js'))('external_primitives.js')");

const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `bs4-e2e-${tag}-`));

/* A copy of the engine under test, with the two area generators replaced by probes.
 * Built once: it is 2.4 MB of files and three tests ask the same thing of it. */
let ENG = null;
function rollingEngine() {
  if (ENG) return ENG;
  ENG = path.join(tmp('eng'), 'assets');
  fs.cpSync(ENGINE_DIR, ENG, { recursive: true });
  fs.writeFileSync(path.join(ENG, 'gen_internal.js'), INTERNAL_PROBE());
  fs.writeFileSync(path.join(ENG, EXTERNAL_GENERATOR), EXTERNAL_PROBE());
  return ENG;
}

function runArea(eng) {
  const dir = tmp('run');
  const routesJson = { town: 'Nowhere' };
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(routesJson));
  const { buildSheets } = require(path.join(eng, 'build_s4.js'));
  const r = buildSheets({ dir, level: 'area', routesJson, sheets: ['internal', 'external'] });
  return { dir, r };
}

test('the fixture discriminates: the rolling engine is not the installed one', () => {
  // THE CONTROL THAT MAKES THE THREE BELOW MEAN ANYTHING, and it is first because the
  // fault it guards against is this file passing for the same reason build_s4.test.js
  // passes today — two paths that are equal by construction. If the copy ever landed
  // on the installed engine, every assertion below would hold with the engine unset.
  const eng = rollingEngine();
  assert.notStrictEqual(path.resolve(eng), path.resolve(ENGINE_DIR),
    'the rolling engine is the engine under test — nothing here would discriminate');
  assert.ok(!path.resolve(eng).startsWith(path.resolve(ENGINE_HOME)),
    'the rolling engine sits inside the INSTALLED engine, which is the path the last resort returns');
});

test('a spawned generator with NO engine named answers somewhere else entirely', () => {
  // The other half of the control, and it is the pre-fix behaviour replayed rather
  // than described: the same probe, in the same sibling-less run folder, with
  // SKILL_ASSETS unset. engine_paths.js then falls to its last resort — the engine
  // INSTALLED on this laptop — or, on a clone that has none, fails to resolve at all.
  // Either answer is the point: it is not the engine doing the building. Without this
  // the tests below could be green over a probe that always says the same thing.
  const dir = tmp('nolink');
  fs.writeFileSync(path.join(dir, 'gen_internal.js'), INTERNAL_PROBE());
  const env = { ...process.env };
  delete env.SKILL_ASSETS;
  delete env.LEAFLET_DIR;
  const res = spawnSync(process.execPath, [path.join(dir, 'gen_internal.js')], { cwd: dir, env, encoding: 'utf8' });
  const out = path.join(dir, 'internal.svg');
  const answered = res.status === 0 && fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  assert.notStrictEqual(answered, path.join(rollingEngine(), 'icons.js'),
    'a generator with no engine named found the engine being rolled out, so nothing here is under test');
});

test('an area internal sheet is drawn by the engine that is building it', () => {
  // buses-data OA-342 item 3. `c879f5a1` put eight sheets on buses-data's main whose
  // internal.svg was the INSTALLED engine's artwork stamped with the branch's hash;
  // this is that build, in miniature, asserted at the only place it was observable —
  // what the spawned generator resolved.
  const eng = rollingEngine();
  const { dir, r } = runArea(eng);
  assert.strictEqual(r.ok, true, r.failure && r.failure.stderr);
  assert.ok(r.outputs.includes('internal.svg'), 'no internal sheet landed');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'internal.svg'), 'utf8'),
    path.join(eng, 'icons.js'),
    'the internal sheet was drawn with a different engine from the one building it');
});

test('an area external sheet is drawn by the engine that is building it, and so is the chain behind it', () => {
  // The row's own lesson turned on the row: on 2026-09-13 this sheet read as innocent
  // because the change being rolled out was one the external generator cannot load, so
  // the evidence that said "external was fine" was measuring a difference of zero. A
  // labeller.js or page.js change would have shipped a hybrid external sheet by the
  // same code path with nothing different about it.
  const eng = rollingEngine();
  const { dir, r } = runArea(eng);
  assert.strictEqual(r.ok, true, r.failure && r.failure.stderr);
  assert.ok(r.outputs.includes('external.svg'), 'no external sheet landed');
  const [labeller, primitives] = fs.readFileSync(path.join(dir, 'external.svg'), 'utf8').split('\n');
  assert.strictEqual(labeller, path.join(eng, 'labeller.js'),
    'the external sheet resolved labeller.js outside the engine building it');
  // AND THE SIBLING ARM, which is the half a SKILL_ASSETS assertion cannot reach:
  // six of this generator's modules are found relative to labeller.js rather than
  // through _dep at all, so a labeller resolved from the wrong engine takes them all.
  assert.strictEqual(primitives, path.join(eng, 'external_primitives.js'),
    'the sibling chain behind labeller.js left the engine building the sheet');
});
