/*
 * internal_roads_config — the one reading of routes.json's `internalRoads`.
 *
 * Extracted on 2026-09-02 (OA-230) from three places that disagreed: gen_internal.js
 * defaulted nine keys and read an ABSENT key as the standard object; the two
 * pre-stages defaulted three and refused an absent key with exit 1. What is
 * asserted here is the contract the three now share, and — the half a unit test
 * on the module cannot reach — that all three FILES call it and none has grown a
 * private reading back. The estate cannot certify the absent-key case: every
 * schematic town writes the block, so this suite is the only place that rule
 * is held.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, ENGINE_DIR } = require('./_engine.js');
const { internalRoadsConfig, IR_DEFAULTS, FOCUS_DEFAULTS } = load('internal_roads_config.js');

test('absent, true and {} all mean the standard object — DEFAULT ON since 2026-08-04', () => {
  const absent = internalRoadsConfig({});
  assert.deepStrictEqual(absent, { ...IR_DEFAULTS, focus: { ...FOCUS_DEFAULTS } });
  assert.deepStrictEqual(internalRoadsConfig({ internalRoads: true }), absent);
  assert.deepStrictEqual(internalRoadsConfig({ internalRoads: {} }), absent);
  assert.deepStrictEqual(internalRoadsConfig(undefined), absent, 'no routes.json at all is still the roads model');
});

test('only an explicit false is the classic model, and it is null rather than an empty object', () => {
  assert.strictEqual(internalRoadsConfig({ internalRoads: false }), null);
  assert.notStrictEqual(internalRoadsConfig({ internalRoads: null }), null, 'null is not false: JSON null reads as absent');
  assert.notStrictEqual(internalRoadsConfig({ internalRoads: 0 }), null);
});

test('the nine defaults are the ones gen_internal.js carried, byte for byte', () => {
  // The numbers are the drawn defaults on every roads-model sheet in the estate.
  // Changing one moves ink on eighteen maps; changing it HERE by accident is what
  // this pin is for.
  assert.deepStrictEqual(IR_DEFAULTS, { stroke: 1.7, gap: 2.8, skeleton: '#e4e4e4', skeletonPad: 1.3,
    contextRoads: true, contextColor: '#f0f0f0', contextWidth: 0.45, roadLabelMax: 12, badgeEvery: 70 });
  assert.deepStrictEqual(FOCUS_DEFAULTS, { coreKm: 1.1, comp: 0.5 });
  assert.ok(Object.isFrozen(IR_DEFAULTS) && Object.isFrozen(FOCUS_DEFAULTS), 'a caller must not be able to edit the defaults for everyone');
});

test('a town key wins over the default, one level down for focus, and the rest of focus stays defaulted', () => {
  const o = internalRoadsConfig({ internalRoads: { gap: 3.1, keyRoads: ['High Street'], focus: { comp: 0.7 } } });
  assert.strictEqual(o.gap, 3.1);
  assert.strictEqual(o.stroke, 1.7);
  assert.deepStrictEqual(o.keyRoads, ['High Street']);
  assert.deepStrictEqual(o.focus, { coreKm: 1.1, comp: 0.7 });
});

test('the reading is a COPY — the town config object is not mutated', () => {
  const town = { internalRoads: { focus: { comp: 0.7 } } };
  internalRoadsConfig(town);
  assert.deepStrictEqual(town, { internalRoads: { focus: { comp: 0.7 } } });
});

test('key ORDER is the old order: defaults first, then the town keys, focus reassigned in place', () => {
  // gen_internal.js's EDITOR_KEYS dump and the workspace writers serialise the object;
  // an order change there is a byte change on a file the gate reads.
  const o = internalRoadsConfig({ internalRoads: { zebra: 1, focus: { comp: 0.7 }, gap: 3 } });
  assert.deepStrictEqual(Object.keys(o), [...Object.keys(IR_DEFAULTS), 'zebra', 'focus']);
});

/* ---- source-level: the three readers, and no fourth reading ------------------ */

const READERS = ['gen_internal.js', 'diagram_internal.js', 'schematize_internal.js'];

test('gen_internal.js and both pre-stages read internalRoads through the module', () => {
  for (const f of READERS) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8');
    assert.ok(src.includes("require(_dep('internal_roads_config.js'))"), f + ' does not require internal_roads_config.js');
    assert.ok(src.includes('const IR = internalRoadsConfig(RJ);'), f + ' does not read IR through internalRoadsConfig');
  }
});

test('no engine file carries a private stroke/gap default any more', () => {
  const offenders = [];
  for (const f of fs.readdirSync(ENGINE_DIR)) {
    if (!f.endsWith('.js') || f === 'internal_roads_config.js') continue;
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8');
    for (const line of src.split(/\r?\n/)) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (/\bstroke\s*:\s*1\.7\b/.test(line) && /\bgap\s*:\s*2\.8\b/.test(line)) offenders.push(f + ': ' + line.trim());
    }
  }
  assert.deepStrictEqual(offenders, [], 'a second reading of the internalRoads defaults has appeared');
});

test('the module is inside the engine hash, through gen_internal.js', () => {
  const { engineFiles } = load('engine_version.js');
  assert.ok(engineFiles(ENGINE_DIR).includes('internal_roads_config.js'), 'a changed default would move ink and not the stamp');
});
