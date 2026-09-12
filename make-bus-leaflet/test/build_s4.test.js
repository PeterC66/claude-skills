/*
 * build_s4.test.js — the one build path (buses-data OA-310).
 *
 * WHAT THIS FILE IS FOR. `build_log.js` classifies what the generators say and writes
 * `build-warnings.txt`; until 2026-09-12 only the two rollouts called it, and both
 * correctly refuse a DATA change — so the build that most needs the record, a config
 * rebuild through the documented stage order, was the one guaranteed not to get it.
 * Eighteen of twenty maps carried a log on 2026-09-11 and the two that did not were
 * both recent data changes. `build_s4.js` is the entry point both rollouts and the
 * stage path now share.
 *
 * THE JOIN IS THE POINT OF THE FIRST TEST. `sheet_registry.js` is the one list of
 * sheets this engine can DRAW; `build_s4.js`'s RECIPE is the one statement of HOW each
 * is drawn. Two lists that must agree is the exact shape sheet_registry.js was written
 * to end — so a sheet added there with no recipe here is a sheet the engine declares
 * and cannot build, and only a test over BOTH can say so. Both populations are read
 * from the modules, never typed here: a check pointed at an identifier the test itself
 * supplies cannot report that the identifier was wrong.
 *
 * The byte-identity acceptance test is NOT here and cannot be: it needs a real S4 run
 * folder, which is gitignored, so CI's clone has nothing to read. It was run by hand on
 * 2026-09-12 against three committed runs — Beaconsfield v1.66 (town, internal +
 * external + schematic), High Wycombe Aldi v1.30 (place, the same three) and St Ives
 * Bus Station v1.22 (place, internal + boarding) — each rebuilt from its own inputs
 * through this module, and each reproducing every sheet AND its build-warnings.txt
 * byte for byte against what the rollout had written. Same reason `rollout_crossings`
 * cannot host its subject in CI either.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./_engine');

const { planSheets, buildSheets, DRAW_ORDER, RECIPE } = load('build_s4.js');
const { SHEETS } = load('sheet_registry.js');
const { LOG_NAME } = load('build_log.js');

const LEVELS = ['area', 'place'];

test('every sheet the registry declares has a recipe at every level it can be drawn', () => {
  // The join, in the direction that matters: a sheet the engine says it draws and
  // cannot build. Both lists come from their own modules.
  for (const s of SHEETS) {
    for (const level of LEVELS) {
      const applies = s.level === 'both' || s.level === level;
      const has = !!(RECIPE[s.key] && RECIPE[s.key][level]);
      if (applies) assert.ok(has, `the registry declares ${s.key} at level ${level} and build_s4.js cannot draw it`);
      else assert.ok(!has, `build_s4.js draws ${s.key} at level ${level}, which cannot have one`);
    }
  }
  // And the other direction: a recipe for a sheet the registry has never heard of
  // would be drawn, committed and named by nothing downstream.
  const known = new Set(SHEETS.map(s => s.key));
  for (const key of Object.keys(RECIPE)) {
    assert.ok(known.has(key), `build_s4.js has a recipe for "${key}", which sheet_registry.js does not list`);
  }
});

test('the draw order holds every sheet, and it is the order the rollouts have always used', () => {
  // Observable, not cosmetic: build_log.js keeps entry order within each severity, so
  // this is what makes a log written here byte-identical to the one a rollout wrote.
  // No place carries internalDiagram today, so no committed log can tell boarding-then-
  // diagram from diagram-then-boarding — which is exactly why it is asserted.
  assert.deepStrictEqual(DRAW_ORDER, ['internal', 'external', 'schematic', 'boarding', 'diagram']);
  for (const s of SHEETS) assert.ok(DRAW_ORDER.includes(s.key), `${s.key} is in no draw order`);
});

test('a town plans the two unconditional sheets, and the opt-ins only when asked', () => {
  assert.deepStrictEqual(planSheets({ routesJson: {}, level: 'area' }), ['internal', 'external']);
  assert.deepStrictEqual(planSheets({ routesJson: { internalSchematic: true }, level: 'area' }),
    ['internal', 'external', 'schematic']);
  assert.deepStrictEqual(planSheets({ routesJson: { internalDiagram: true, internalSchematic: true }, level: 'area' }),
    ['internal', 'external', 'schematic', 'diagram']);
});

test('a town that somehow carries boardingPlan still plans no boarding sheet', () => {
  // gen_boarding.js reads place.json on its way in, which only a place build has, and
  // rollout.js contains the string "boarding" zero times. sheet_registry.js records
  // that render_sweep.js derives boarding with no level test, so the key on an area is
  // latent rather than impossible — this is the level filter doing its job.
  assert.deepStrictEqual(planSheets({ routesJson: { boardingPlan: {} }, level: 'area' }), ['internal', 'external']);
  assert.deepStrictEqual(planSheets({ routesJson: { boardingPlan: {} }, level: 'place' }),
    ['internal', 'external', 'boarding']);
});

test('`has` drops the sheets a place deliberately does not ship', () => {
  // Three place maps ship without an internal or an external (OA-035, OA-037), and
  // routes.json cannot say so — both rollouts read it off the previous S4 instead.
  assert.deepStrictEqual(
    planSheets({ routesJson: { boardingPlan: {} }, level: 'place', has: { internal: false, external: false } }),
    ['boarding']);
  assert.deepStrictEqual(
    planSheets({ routesJson: {}, level: 'place', has: { external: false } }), ['internal']);
});

test('the schematic recipe passes OVERRIDES_FILE for a place and never for a town', () => {
  // The gotcha this whole tool exists to make structural (gotchas.md ~486):
  // schematize_internal.js's workspace copy does not carry overrides.json, so a place's
  // forced-POI overrides are silently dropped unless the path is passed explicitly. It
  // was found by hand, after the fact, by diffing label sets. The DIAGRAM must not have
  // it — diagram_internal.js copies its own S3-owned diagram-overrides.json in as
  // overrides.json, and OVERRIDES_FILE would shadow that file entirely.
  assert.strictEqual(RECIPE.schematic.place.overridesFile, true);
  assert.ok(!RECIPE.schematic.area.overridesFile);
  assert.ok(!RECIPE.diagram.place.overridesFile, 'the place diagram must not force OVERRIDES_FILE');
  assert.ok(!RECIPE.diagram.area.overridesFile);
});

test('only an area internal asks for build-meta.json', () => {
  // `stage.js commit S4` refuses an AREA S4 without one and excludes places
  // structurally — the place engine has no build-meta path at all.
  const withMeta = [];
  for (const [key, byLevel] of Object.entries(RECIPE))
    for (const [level, r] of Object.entries(byLevel)) if (r.meta) withMeta.push(`${key}/${level}`);
  assert.deepStrictEqual(withMeta, ['internal/area']);
});

test('a build that dies still writes the log, and names the generator that died', () => {
  // The new half, and the one worth having: a rollout used to return FAIL without
  // writing anything, so the stderr of the one build whose stderr matters most was
  // thrown away. An empty run folder makes gen_internal.js fail on its missing inputs.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs4-'));
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify({ town: 'Nowhere' }));
  const r = buildSheets({ dir, level: 'area', routesJson: { town: 'Nowhere' } });
  assert.strictEqual(r.ok, false, 'an empty run folder cannot produce a sheet');
  assert.strictEqual(r.failure.label, 'gen_internal.js');
  assert.ok(fs.existsSync(path.join(dir, LOG_NAME)), 'the log was not written');
  assert.ok(r.blockers.length >= 1, 'a generator that died is a blocking entry');
  assert.deepStrictEqual(r.outputs, [LOG_NAME], 'no sheet landed, so only the log is an output');
  // And it stopped there rather than running the external generator over the same
  // missing inputs: one captured entry, not two.
  assert.deepStrictEqual(r.said.map(e => e.source), ['internal']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('write:false leaves no log and no log in the outputs — the dry run contract', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs4-'));
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify({ town: 'Nowhere' }));
  const r = buildSheets({ dir, level: 'area', routesJson: { town: 'Nowhere' }, write: false });
  assert.ok(!fs.existsSync(path.join(dir, LOG_NAME)), 'a dry run wrote a log into a folder about to be deleted');
  assert.deepStrictEqual(r.outputs, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a hook that refuses stops the sheet before its generator runs', () => {
  // --refresh-index is rollout_places.js's flag, not the stage path's, so the boarding
  // sheet's data refresh is handed in as a hook. A refusal must be fatal and must be
  // captured, or a sheet is drawn from an index the refresh failed to rebuild.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs4-'));
  const rj = { boardingPlan: {} };
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(rj));
  let ran = false;
  const r = buildSheets({ dir, level: 'place', routesJson: rj, sheets: ['boarding'],
    hooks: { boarding: () => { ran = true; return { ok: false, stderr: 'refresh-index failed — no region' }; } } });
  assert.ok(ran, 'the hook was never called');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.failure.label, 'gen_boarding.js');
  assert.match(String(r.failure.stderr), /refresh-index failed/);
  assert.ok(!fs.existsSync(path.join(dir, 'gen_boarding.js')), 'the generator was copied in despite the refusal');
  fs.rmSync(dir, { recursive: true, force: true });
});
