/*
 * render_sweep.test.js — WHICH ENGINE a --store sweep runs (buses-data OA-342 item 4).
 *
 * THE FAULT THIS EXISTS FOR HAD SHIPPED AND WAS INVISIBLE. `enumerateStore` sets
 * `preferPackGen: true` under its own comment — *the portal runs the pack's OWN
 * generator, not the skill's; so must this* — and `sweepOne` then handed that
 * generator to `runGenerator` with no `engineDir`, so its shared modules came from
 * the SKILL. A pack's entry generator against another engine's shared modules is
 * the latent hybrid `portalFixtureEnv` was written for on 2026-08-28 (OA-132),
 * when status.js was caught doing the identical thing and every file in the
 * portal's `engine/` went unexecuted while the board said PASS.
 *
 * WHY THESE TESTS ARE ABOUT RESOLUTION AND NOT ABOUT A FLAG BEING PRESENT. On this
 * laptop the skill's engine and the portal's vendored copy usually agree, so a
 * sweep with the wrong one still goes green — which is exactly why this survived.
 * A test asserting `engineDir` is set would pass on the day somebody sets it to
 * the wrong directory. So the assertions are about WHICH DIRECTORY each sheet's
 * generator and shared modules resolve to, with both answers read off the module
 * rather than typed here.
 *
 * The end-to-end half is NOT here and cannot be: it needs a populated portal store,
 * which is in another repository and is not in CI's clone. It was run by hand on
 * 2026-09-14 against the live checkout's five packs — all five re-render through the
 * portal's engine — and falsified both ways by copying that engine to a scratch
 * folder, making `poi_select.js` throw on load, and watching the sweep go from 0 to
 * 5 maps that cannot be re-rendered, while the pre-fix call (engineDir defaulting to
 * SK) stayed green on the same broken engine. Same reason build_s4.test.js keeps its
 * byte-identity acceptance test out of CI.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./_engine');

const { sheetsFor, enumerateStore, portalEngine, parseArgs, sweepOne } = load('render_sweep.js');
const { SK } = load('gate_lib');

/* A store laid out the way the portal lays one out: <portal>/data/maps/<id>/data,
 * and <portal>/engine holding the shared modules. Only the files these functions
 * actually look for are written — a fixture that carried more would be asserting
 * the fixture builder's memory of the portal rather than the portal. */
function fakePortal(routes, { withEngine = true, packFiles = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-portal-'));
  const dataDir = path.join(dir, 'data', 'maps', '1', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'routes.json'), JSON.stringify(routes));
  for (const f of packFiles) fs.writeFileSync(path.join(dataDir, f), '// pack copy\n');
  if (withEngine) {
    fs.mkdirSync(path.join(dir, 'engine', 'expert'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine', 'engine_paths.js'), '// vendored\n');
  }
  return { dir, storeDir: path.join(dir, 'data', 'maps'), dataDir };
}

test('the portal is two levels above the store, and --portal overrides it', () => {
  const p = fakePortal({});
  const derived = portalEngine(p.storeDir);
  assert.strictEqual(derived.portalDir, path.resolve(p.dir));
  assert.strictEqual(derived.engineDir, path.join(derived.portalDir, 'engine'));
  assert.strictEqual(derived.expertDir, path.join(derived.portalDir, 'engine', 'expert'));
  assert.ok(derived.ok, 'a store with an engine two levels up resolves');

  // --portal names it outright, for a store that is not laid out that way.
  const explicit = portalEngine('C:/nowhere/data/maps', p.dir);
  assert.strictEqual(explicit.engineDir, path.join(path.resolve(p.dir), 'engine'));
  assert.ok(explicit.ok);
  fs.rmSync(p.dir, { recursive: true, force: true });
});

test('an engine directory with no shared modules in it is NOT ok, so main refuses instead of falling back to SK', () => {
  // The discriminator that matters: `engine/` existing is not the question. An
  // empty one resolves every dependency past it, which is the hybrid this whole
  // change removes — so the test is for a module the portal actually vendors.
  const p = fakePortal({}, { withEngine: false });
  fs.mkdirSync(path.join(p.dir, 'engine'), { recursive: true });
  assert.strictEqual(portalEngine(p.storeDir).ok, false,
    'an engine folder with no engine_paths.js must not pass for an engine');
  fs.writeFileSync(path.join(p.dir, 'engine', 'engine_paths.js'), '// vendored\n');
  assert.strictEqual(portalEngine(p.storeDir).ok, true);
  fs.rmSync(p.dir, { recursive: true, force: true });
});

test('a store sweep takes its shared modules from the PORTAL engine and never from the skill', () => {
  const p = fakePortal({}, { packFiles: ['gen_internal.js', 'gen_external.js'] });
  fs.writeFileSync(path.join(p.dataDir, 'internal.svg'), '<svg/>');
  const portal = portalEngine(p.storeDir);
  const [map] = enumerateStore(p.storeDir, portal);

  assert.strictEqual(map.engineDir, portal.engineDir);
  assert.notStrictEqual(map.engineDir, SK,
    'SK is the skill; a pack resolving its shared modules there is the OA-132 hybrid');
  // And the tree case is unchanged: no portal, no engineDir, so runGenerator's own
  // SK default applies — which is the right answer for a sweep of our own tree.
  const [treeShaped] = enumerateStore(p.storeDir, null);
  assert.strictEqual(treeShaped.engineDir, undefined);
  fs.rmSync(p.dir, { recursive: true, force: true });
});

test('the expert three resolve from the PORTAL expert dir under the PORTAL file names, and are marked portal-owned', () => {
  const routes = { internalSchematic: {}, internalDiagram: {}, boardingPlan: {} };
  const p = fakePortal(routes);
  const portal = portalEngine(p.storeDir);
  const sheets = sheetsFor(p.dataDir, { isPlace: false, preferPackGen: true, expertDir: portal.expertDir });
  const by = Object.fromEntries(sheets.map((s) => [s.key, s]));

  // store.js declares these three `engine: 'expert'` with gens the skill does not
  // have under those names at all — the wrapper, not our pre-stage.
  assert.strictEqual(path.basename(by.schematic.gen), 'gen_internal_schematic.js');
  assert.strictEqual(path.basename(by.diagram.gen), 'gen_internal_diagram.js');
  assert.strictEqual(path.basename(by.boarding.gen), 'gen_boarding.js');
  for (const k of ['schematic', 'diagram', 'boarding']) {
    assert.strictEqual(path.dirname(by[k].gen), portal.expertDir, `${k} must come from the portal's expert dir`);
    assert.strictEqual(by[k].portalOwned, true, `${k} must be marked so sweepOne declines to run it`);
  }
  fs.rmSync(p.dir, { recursive: true, force: true });
});

test('a TREE sweep is unchanged: the expert three come from the skill, under the skill names, and are swept', () => {
  // The control. This is the case that was already right, and a change that
  // quietly moved it would move every tree sweep onto files the estate does not
  // build with.
  const routes = { internalSchematic: {}, internalDiagram: {}, boardingPlan: {} };
  const p = fakePortal(routes, { withEngine: false });
  const sheets = sheetsFor(p.dataDir, { isPlace: false });
  const by = Object.fromEntries(sheets.map((s) => [s.key, s]));
  assert.strictEqual(by.schematic.gen, path.join(SK, 'schematize_internal.js'));
  assert.strictEqual(by.diagram.gen, path.join(SK, 'diagram_internal.js'));
  assert.strictEqual(by.boarding.gen, path.join(SK, 'gen_boarding.js'));
  for (const k of ['schematic', 'diagram', 'boarding']) {
    assert.ok(!by[k].portalOwned, `${k} must still be swept in tree mode`);
  }
  fs.rmSync(p.dir, { recursive: true, force: true });
});

/* THE TWIN, and it is here because the test above cannot stand in for it. Asserting
 * that `enumerateStore` PUTS the engine on the map says nothing about whether
 * `sweepOne` passes it on — two halves of one rule, and the checked half reads as the
 * whole rule until somebody deletes the other. So this one runs a generator and lets
 * it judge its own environment: it exits non-zero unless SKILL_ASSETS is the engine
 * the map named, which makes the sweep's verdict the assertion. */
test('sweepOne RUNS the generator under the engine the map names, not under the skill', () => {
  const p = fakePortal({});
  fs.writeFileSync(path.join(p.dataDir, 'internal.svg'), '<svg/>');
  const portal = portalEngine(p.storeDir);
  // A pack generator that is only happy under the portal's engine. Written as the
  // pack's own gen_internal.js so `preferPackGen` picks it, exactly as a real store
  // sweep does.
  fs.writeFileSync(path.join(p.dataDir, 'gen_internal.js'), [
    "const fs = require('fs');",
    `const want = ${JSON.stringify(portal.engineDir)};`,
    'if (process.env.SKILL_ASSETS !== want) {',
    "  process.stderr.write('SKILL_ASSETS was ' + process.env.SKILL_ASSETS + ', wanted ' + want + '\\n');",
    '  process.exit(1);',
    '}',
    "fs.writeFileSync('internal.svg', '<svg/>');",
  ].join('\n'));

  const [map] = enumerateStore(p.storeDir, portal);
  const { rows } = sweepOne(map, {});
  const internal = rows.find((r) => r.sheet === 'internal');
  assert.strictEqual(internal.verdict, 'n/a',
    `the generator refused its environment: ${internal.detail}`);
  fs.rmSync(p.dir, { recursive: true, force: true });
});

test('--portal is parsed, and nothing else about the flag set moved', () => {
  const f = parseArgs(['--store', 'S', '--portal', 'P', '--drop-framing', '--expect', '5']);
  assert.strictEqual(f.store, 'S');
  assert.strictEqual(f.portal, 'P');
  assert.strictEqual(f.dropFraming, true);
  assert.strictEqual(f.expect, 5);
});
