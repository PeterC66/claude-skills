/*
 * design.exitAvoidsInk (buses-data OA-561) — an exit caption names a ceiling on route ink.
 *
 * WHY THIS EXISTS. With design.exitInFrame set, Ely Co-op's "to Chatteris", "to Newmarket" and
 * "to Impington" printed across 18-31% of a route ribbon: the exit device's inboard shortlist
 * had no clear spot and the relaxed pass costs ink at 34 per box, less than leaving the
 * shortlist (40). The key hands each terminus caption `maxInk`, and the placer then prefers
 * any clear spot (further rings included) to an inked one.
 *
 * Source assertion, as exit_in_frame.test.js, and for its reason: gen_internal.js runs at
 * require time. The placer's side of the contract is proved in labeller.test.js; this file
 * proves the generator hands the ceiling over, and only when asked. npm run test:prove-red
 * breaks the hand-over and requires this suite to go red.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(require('./_engine.js').ENGINE_DIR, 'gen_internal.js'), 'utf8');

function loadCeiling() {
  const m = SRC.match(/^\s*\.\.\.\(only\?\{only, leader:false\}:\{\}\), \.\.\.\((DESIGN\.exitAvoidsInk\?.*)\) \}\); \/\/ exitAvoidsInk \(OA-561\)$/m);
  assert.ok(m, 'the pendingTermini push no longer carries the exitAvoidsInk ceiling on one line — rewrite this test, do not delete it');
  const f = new Function('DESIGN', 'return ({...(' + m[1] + ')})');
  return design => f(design);
}

test('no ceiling unless design.exitAvoidsInk is set: an absent key leaves every sheet byte-identical', () => {
  const c = loadCeiling();
  assert.deepStrictEqual(c({}), {});
  assert.deepStrictEqual(c({ exitAvoidsInk: false }), {});
});

test('design.exitAvoidsInk gives the caption a ceiling', () => {
  assert.deepStrictEqual(loadCeiling()({ exitAvoidsInk: true }), { maxInk: 0.02 });
});
