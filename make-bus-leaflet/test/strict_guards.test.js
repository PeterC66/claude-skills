/*
 * strict_guards — the refusal contract every generator shares.
 *
 * WHY THESE ASSERTIONS. This module was extracted on 2026-08-27 (OA-129 Phase 3)
 * from two near-identical copies in gen_internal.js and gen_boarding.js. The byte
 * gate that certified the extraction cannot see any of this: it runs with the flag
 * unset on purpose, and — measured across all 20 committed maps, both generators,
 * 40 runs — not one of them refuses anything, so the entire guard path is dark to
 * it. What certified the extraction was a forced refusal compared before and
 * after; what keeps it honest from here is this file.
 *
 * The properties that matter are the ones a careless tidy-up would break: that the
 * flag is genuinely INERT when unset (a refusal must still print, and must still
 * exit zero, or the byte gate turns red on day one over fixtures that legitimately
 * carry warnings); that refusals are COUNTED rather than thrown, so one run reports
 * every refusal instead of only the first; and that `report` decides but does not
 * exit, because the two callers end differently on purpose — gen_internal.js sets
 * process.exitCode so buffered stdout still flushes, gen_boarding.js calls exit.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ENGINE_DIR } = require('./_engine.js');

const MODULE = path.join(ENGINE_DIR, 'strict_guards.js');

// The flag is read once, at load, which is the whole point of it — so a test that
// wants the other setting has to load the module again.
function loadWith(flag) {
  const before = process.env.STRICT_GUARDS;
  if (flag === undefined) delete process.env.STRICT_GUARDS; else process.env.STRICT_GUARDS = flag;
  delete require.cache[require.resolve(MODULE)];
  const m = require(MODULE);
  if (before === undefined) delete process.env.STRICT_GUARDS; else process.env.STRICT_GUARDS = before;
  return m;
}

// Capture what the module writes to stderr rather than letting it reach the runner.
function capture(fn) {
  const lines = [];
  const real = process.stderr.write;
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try { fn(); } finally { process.stderr.write = real; }
  return lines;
}

test('refuse prints the message with exactly one trailing newline', () => {
  const g = loadWith(undefined);
  const out = capture(() => g.refuse('panel: label sits off the frame'));
  assert.deepStrictEqual(out, ['panel: label sits off the frame\n']);
});

test('refuse strips the trailing newlines a caller already added, however many', () => {
  const g = loadWith(undefined);
  const out = capture(() => g.refuse('feature: names nothing\n\n\n'));
  assert.deepStrictEqual(out, ['feature: names nothing\n']);
});

test('refusals are counted, not thrown — one run reports every one of them', () => {
  const g = loadWith('1');
  capture(() => { g.refuse('first'); g.refuse('second'); g.refuse('third'); });
  assert.strictEqual(g.refusals(), 3);
});

test('unset, the flag is inert: a refusal still prints and report() declines to fail the run', () => {
  const g = loadWith(undefined);
  let out;
  const banner = capture(() => { g.refuse('a guard refused'); out = g.report('refused to draw something.'); });
  assert.strictEqual(out, false, 'report must not ask the caller to fail when the flag is unset');
  assert.deepStrictEqual(banner, ['a guard refused\n'], 'the refusal itself must still reach stderr');
});

test('set, but with nothing refused, report() writes no banner and does not fail the run', () => {
  const g = loadWith('1');
  const banner = capture(() => { assert.strictEqual(g.report('refused to draw something.'), false); });
  assert.deepStrictEqual(banner, []);
});

test('one refusal reads "1 guard", and the caller-supplied sentence follows verbatim', () => {
  const g = loadWith('1');
  let ret;
  const out = capture(() => { g.refuse('x'); ret = g.report('refused to draw something this sheet was asked for.'); });
  assert.strictEqual(ret, true);
  assert.strictEqual(out[out.length - 1],
    'STRICT_GUARDS: 1 guard refused to draw something this sheet was asked for.\n');
});

test('more than one reads "guards" — the plural branch is the one a run in anger takes', () => {
  const g = loadWith('1');
  let ret;
  const out = capture(() => { g.refuse('x'); g.refuse('y'); ret = g.report('refused to draw something this config asked for.'); });
  assert.strictEqual(ret, true);
  assert.strictEqual(out[out.length - 1],
    'STRICT_GUARDS: 2 guards refused to draw something this config asked for.\n');
});

test('report decides but does not exit — the caller owns how the run ends', () => {
  const g = loadWith('1');
  const before = process.exitCode;
  capture(() => { g.refuse('x'); g.report('refused to draw something.'); });
  assert.strictEqual(process.exitCode, before,
    'the module must not set process.exitCode itself; gen_internal and gen_boarding end differently');
});
