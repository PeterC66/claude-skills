/*
 * wcag.test.js — the three colour questions, and the census that keeps them one.
 *
 * OA-232 Tier 3.1 / OA-135. `wcag.js` is a PURE EXTRACTION: seven sites across
 * five files each carried a weighted sum of the same three coefficients, and the
 * whole claim of the commit that moved them is that no sheet changed. So the
 * tests that matter are not "does it compute a luminance" — they are:
 *
 *   1. the VALUES, against the arithmetic the call sites ran before the move, so
 *      a later "tidy-up" of the module cannot quietly re-tune the artwork;
 *   2. that the three questions stay APART. relLum and rawLumHex answer
 *      differently for the same colour, and a `#808080` that read 0.502 as a
 *      brightness proxy reads 0.216 as a relative luminance. Every threshold in
 *      this engine — 0.62, 0.75, 0.55, 0.8 — is calibrated against the first, so
 *      a helper that "corrected" it would move ink on twenty sheets with every
 *      byte gate green until the render;
 *   3. the CENSUS: no engine file may define an eighth copy. This is the test
 *      that makes the extraction an extraction rather than an eighth
 *      implementation, and it is the shape svg_primitives.test.js already uses
 *      for `esc` ("no engine file defines a second esc body").
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ENGINE_DIR, load } = require('./_engine');

const { rawLumBytes, rawLumUnit, rawLumHex, relLum, lab } = load('wcag.js');

/* ---- 1. the values, as the call sites computed them ---- */

test('rawLumBytes is the weighted average of the BYTES, divided at the end', () => {
  // The expression gen_internal.js's two ink tests and icons.js each ran.
  const expected = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [128, 128, 128], [204, 51, 17], [0, 153, 136]]) {
    assert.strictEqual(rawLumBytes(r, g, b), expected(r, g, b));
  }
  assert.strictEqual(rawLumBytes(0, 0, 0), 0);
  // Not exactly 1: the three coefficients sum to 1 in decimal and to
  // 0.9999999999999999 in binary. Asserted as it IS, because a "fix" that made it
  // exact would be a change to what every threshold is measured against.
  assert.strictEqual(rawLumBytes(255, 255, 255), 0.9999999999999999);
});

test('rawLumHex parses #rrggbb and calls it pale when it cannot', () => {
  assert.ok(Math.abs(rawLumHex('#ffffff') - 1) < 1e-12);
  assert.strictEqual(rawLumHex('#000000'), 0);
  assert.strictEqual(rawLumHex('#CC3311'), rawLumBytes(0xcc, 0x33, 0x11));
  assert.strictEqual(rawLumHex('#cc3311'), rawLumHex('#CC3311'), 'case must not matter');
  // 1 = "treat an unknown colour as pale", which is what keeps `none`, a named
  // colour and a three-digit hex out of the ink test rather than in it.
  for (const bad of ['none', 'black', '#fff', '', null, undefined, '#12345g']) {
    assert.strictEqual(rawLumHex(bad), 1, JSON.stringify(bad) + ' should read as pale');
  }
});

test('rawLumUnit divides FIRST, and that is why it is a second function', () => {
  const expected = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.strictEqual(rawLumUnit(0.5, 0.5, 0.5), expected(0.5, 0.5, 0.5));
  // The two agree to within a rounding error and are not the same double for
  // every input. quality_metrics.js's ratchet reads the second; gen_internal.js
  // and icons.js read the first; each keeps the one it was calibrated against.
  for (const [r, g, b] of [[203, 91, 17], [7, 33, 251], [119, 187, 221]]) {
    const a = rawLumBytes(r, g, b), u = rawLumUnit(r / 255, g / 255, b / 255);
    assert.ok(Math.abs(a - u) < 1e-12, 'the two spellings must agree to 1e-12');
  }
});

test('relLum is the GAMMA-DECODED one, and it is not the brightness proxy', () => {
  const srgb = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const expected = (hex) => {
    const c = [1, 3, 5].map((i) => srgb(parseInt(hex.substr(i, 2), 16) / 255));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const hex of ['#000000', '#ffffff', '#808080', '#cc3311', '#009988', '#ddaa33']) {
    assert.strictEqual(relLum(hex), expected(hex), hex);
  }
  assert.strictEqual(relLum('#000000'), 0);
  assert.ok(Math.abs(relLum('#ffffff') - 1) < 1e-12);
  // THE POINT OF KEEPING THEM APART. Mid grey is half way up the byte scale and
  // nothing like half way up the luminance one. label_placer.js's contrast floor
  // needs the second; every threshold in this engine is set against the first.
  assert.ok(Math.abs(rawLumHex('#808080') - 0.502) < 0.002);
  assert.ok(Math.abs(relLum('#808080') - 0.2159) < 0.001);
  assert.ok(relLum('#808080') < rawLumHex('#808080') - 0.28,
    'a "tidy-up" that unified these two would move ink on every sheet');
});

test('lab is the CIE conversion the three colour-distance sites each carried', () => {
  const [L, a, b] = lab('#ffffff');
  assert.ok(Math.abs(L - 100) < 0.01, 'white is L=100');
  // Not exactly neutral: the D65 white point is written as 0.95047/1.08883, three
  // decimal places short of exact, so white lands a fraction off the a=b=0 axis.
  // That is the conversion all three call sites ran and it is what dE was tuned
  // against, so it is asserted as it is rather than corrected.
  assert.ok(Math.abs(a) < 0.02 && Math.abs(b) < 0.02, 'white is near-neutral');
  assert.deepStrictEqual(lab('#000000').map((v) => Math.round(v * 1e9) / 1e9), [0, 0, 0]);
  // The pair quality_metrics.js's header names — red and teal, as far apart as two
  // colours on this palette get. If lab() ever became a luminance the
  // route-vs-route check would go QUIET rather than red, so the distance is
  // asserted here and not only the conversion.
  const dE = (x, y) => { const A = lab(x), B = lab(y); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
  assert.ok(dE('#cc3311', '#009988') > 100, 'they must be far apart in Lab');
  // ...and the sheet's own limit: gen_internal.js warns below dE 25, so a pair
  // just inside it has to stay inside it.
  assert.ok(dE('#9ec9e8', '#7fb0d8') < 25, 'river blue and canal blue read alike');
  assert.strictEqual(dE('#cc3311', '#cc3311'), 0);
  assert.strictEqual(lab('#CC3311')[0], lab('#cc3311')[0], 'case must not matter');
});

/* ---- 2. the census: no eighth copy ---- */

test('no engine file carries its own luminance or Lab conversion any more', () => {
  // The coefficients are the fingerprint: every one of the seven copies had all
  // three of them on one line. Comments are excluded — wcag.js's own header names
  // them to a reader, and gen_internal.js's require line does too.
  const offenders = [];
  for (const f of fs.readdirSync(ENGINE_DIR)) {
    if (!f.endsWith('.js') || f === 'wcag.js') continue;
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (line.includes('0.2126') || line.includes('0.7152') || line.includes('0.0722')) {
        offenders.push(f + ':' + (i + 1) + ' ' + line.trim());
      }
    });
  }
  assert.deepStrictEqual(offenders, [],
    'an eighth luminance has appeared — it belongs in wcag.js, under the question it answers');
});

test('the place skill has not grown one either', () => {
  const EV = load('engine_version.js');
  const PLACE_DIR = EV.placeAssetsDir(ENGINE_DIR);
  if (!fs.existsSync(PLACE_DIR)) {
    // Announced, not skipped silently: a mutation run points ENGINE_DIR at a
    // scratch copy of the town engine and the place skill is not beside it.
    console.log('# wcag: the place assets folder is not at ' + PLACE_DIR + ' — town census only');
    return;
  }
  const offenders = [];
  for (const f of fs.readdirSync(PLACE_DIR)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(PLACE_DIR, f), 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (line.includes('0.2126')) offenders.push('place/' + f + ':' + (i + 1));
    });
  }
  assert.deepStrictEqual(offenders, []);
});

/* ---- 3. the callers ARE the helper ---- */

test('the four in-hash call sites import wcag.js rather than reimplementing it', () => {
  // The lesson of this whole round: an extraction is the module PLUS a check that
  // its callers use it. Without this, deleting the require and pasting the loop
  // back would be green everywhere.
  const wants = {
    'gen_internal.js': ['rawLumHex', 'lab'],
    'icons.js': ['rawLumBytes'],
    'label_placer.js': ['relLum'],
    'quality_metrics.js': ['rawLumUnit', 'lab'],
    'pick_route_colour.js': ['lab'],
  };
  for (const [file, names] of Object.entries(wants)) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
    assert.ok(/require\((?:_dep\('wcag\.js'\)|path\.join\(__dirname, 'wcag\.js'\)|'\.\/wcag\.js')\)/.test(src),
      file + ' does not require wcag.js');
    for (const n of names) assert.ok(src.includes(n), file + ' does not use ' + n);
  }
});
