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

test('the flag is off unless design.exitInFrame is set, and yields to exitCaptionsInPanel', () => {
  const m = SRC.match(/^const EXIT_IN_FRAME = (.*);$/m);
  assert.ok(m, 'gen_internal.js no longer defines EXIT_IN_FRAME on one line — rewrite this test, do not delete it');
  const f = (LAB, DESIGN) => eval('(' + m[1] + ')'); // eslint-disable-line no-eval
  assert.strictEqual(f({}, {}), false, 'absent key must leave every sheet byte-identical');
  assert.strictEqual(f({}, { exitInFrame: true }), true);
  assert.strictEqual(f({}, { exitInFrame: true, exitCaptionsInPanel: true }), false);
  assert.strictEqual(f(null, { exitInFrame: true }), false, 'the pre-v2 placer has no labeller to bound');
});

test('a terminus caption is handed the map frame as its bound, and only when the flag is on', () => {
  const m = SRC.match(/^\s*\.\.\.\(EXIT_IN_FRAME\?\{bounds:\{x0:MX0, y0:MY0, x1:MX1, y1:MY1\}\}:\{\}\),$/m);
  assert.ok(m, 'the pendingTermini push no longer spreads the frame bounds when EXIT_IN_FRAME is set');
  const push = SRC.indexOf('pendingTermini.push(');
  assert.ok(push > 0 && SRC.indexOf(m[0].trim(), push) > push && SRC.indexOf(m[0].trim(), push) - push < 900,
    'the frame bound must sit inside the pendingTermini.push call');
});
