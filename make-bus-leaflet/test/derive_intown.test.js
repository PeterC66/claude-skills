/*
 * derive_intown.js — the majority pattern (buses-data OA-452, 2026-09-25).
 *
 * The St Neots map drew the 18 westbound round the station loop that 3 of 25
 * passing journeys run, because a direction was the union of every stop any
 * journey calls at. journey_weights.py now lists each direction's minority
 * deviations, and derive_intown.js drops them when journey_weights.json sits
 * beside routes_full.json. Two of these tests are CONTROLS, and they matter more
 * than the first: every S2 folder on the estate was derived without the file, so
 * a derive that moved without it — or ignored the opt-out — would silently
 * redraw a map at its next rebuild for a reason nobody chose.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine');
const { scratchDir } = require('../assets/scratch');

const SCRIPT = path.join(ENGINE_DIR, 'derive_intown.js');

// A through route, one direction: T1 > L1 > L2 > T2 is the loop, T1 > T2 direct.
const FULL = { R: { directions: [{ name: 'A to B', stops: ['T1', 'L1', 'L2', 'T2', 'T3'] }],
  canonical: [{ name: 'A to B', stops: ['T1', 'L1', 'L2', 'T2', 'T3'] }],
  all: ['T1', 'L1', 'L2', 'T2', 'T3'] } };
const LL = { T1: [52.2, -0.26], L1: [52.21, -0.25], L2: [52.21, -0.24], T2: [52.2, -0.23], T3: [52.2, -0.22] };
const WEIGHTS = { R: { 'A to B': { drop: ['L1', 'L2'] } } };

function derive(cfg, weights) {
  const dir = scratchDir('derive-intown-');
  const w = (f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o));
  w('routes_full_atco.json', FULL);
  w('atco2ll.json', LL);
  w('intown_cfg.json', Object.assign({ prefix: 'T', extraCore: ['L1', 'L2'], buf: 0 }, cfg));
  if (weights) w('journey_weights.json', weights);
  const out = path.join(dir, 'routes_intown_atco.json');
  const r = spawnSync(process.execPath, [SCRIPT, path.join(dir, 'routes_full_atco.json'),
    path.join(dir, 'atco2ll.json'), path.join(dir, 'intown_cfg.json'), out], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

test('a direction loses the minority stops journey_weights.json lists', () => {
  assert.deepStrictEqual(derive({}, WEIGHTS).R, ['T1', 'T2', 'T3']);
});

test('CONTROL: with no journey_weights.json the union is drawn exactly as before', () => {
  assert.deepStrictEqual(derive({}, null).R, ['T1', 'L1', 'L2', 'T2', 'T3']);
});

test('CONTROL: "journeyWeights": false in intown_cfg.json ignores the file', () => {
  assert.deepStrictEqual(derive({ journeyWeights: false }, WEIGHTS).R, ['T1', 'L1', 'L2', 'T2', 'T3']);
});

test('a weight for another direction name drops nothing here', () => {
  assert.deepStrictEqual(derive({}, { R: { 'B to A': { drop: ['L1'] } } }).R, ['T1', 'L1', 'L2', 'T2', 'T3']);
});
