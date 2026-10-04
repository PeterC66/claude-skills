/*
 * design.exitInFrame (buses-data OA-561) — an exit caption is bounded by the map frame.
 *
 * WHY THIS EXISTS. Ely Co-op's "to Little Downham" was seated above the exit arrowhead at
 * y 29.5 mm, over a frame that starts at y 30, and quality_metrics.js counts anything above
 * the frame as title block, so the engine rebuild read REGRESSED 53 -> 52 with the label
 * drawn and every gate otherwise content. The key hands each terminus caption the frame as
 * its own hard bound, so the placer falls through to the next inboard candidate.
 *
 * Source assertions, as exit_caption.test.js, and for its reason: gen_internal.js runs at
 * require time and needs a whole S2/S3 tree. The placer's per-label bounds are proved in
 * labeller.test.js; this file proves the generator actually hands them over, and only when
 * asked. npm run test:prove-red breaks the hand-over and requires this suite to go red.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(require('./_engine.js').ENGINE_DIR, 'gen_internal.js'), 'utf8');

// The one line that hands a terminus caption its bound, evaluated rather than re-implemented.
function loadBounds() {
  const m = SRC.match(/^\s*\.\.\.\((EXIT_IN_PANEL\?.*)\), \/\/ exitInFrame \(OA-561\)$/m);
  assert.ok(m, 'the pendingTermini push no longer carries the exitInFrame bound on one line — rewrite this test, do not delete it');
  const f = new Function('EXIT_IN_PANEL', 'LAB', 'DESIGN', 'PRINT_SAFE', 'FOOTER_PLATE_TOP', 'MX0', 'MY0', 'MX1', 'MY1', 'return ({...(' + m[1] + ')})');
  return (panel, lab, design) => f(panel, lab, design, 1, 200, 5, 30, 190, 200);
}

test('no bound unless design.exitInFrame is set: an absent key leaves every sheet byte-identical', () => {
  const b = loadBounds();
  assert.deepStrictEqual(b(false, {}, {}), {});
  assert.deepStrictEqual(b(false, {}, { exitInFrame: false }), {});
});

test('design.exitInFrame bounds the caption by the map frame', () => {
  assert.deepStrictEqual(loadBounds()(false, {}, { exitInFrame: true }), { bounds: { x0: 5, y0: 30, x1: 190, y1: 200 } });
});

test('exitCaptionsInPanel keeps its own bound, and the pre-v2 placer (no labeller) gets none', () => {
  const b = loadBounds();
  assert.strictEqual(b(true, {}, { exitInFrame: true, exitCaptionsInPanel: true }).bounds.y0, 1);
  assert.deepStrictEqual(b(false, null, { exitInFrame: true }), {});
});
