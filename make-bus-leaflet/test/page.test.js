/*
 * page.test.js — the sheet's own dimensions, and the root element.
 *
 * OA-224 Tier 3.4 (engine F15). Nothing here has ever been wrong either; W was
 * 297 in four generators and the raster size was written out in six files, and
 * they all agreed. What a test can hold that a comment cannot is the ONE
 * relationship that is easy to get wrong when a number moves house: the two
 * pairs are not derivable from each other. 297mm at 300dpi is 3507.87px, and the
 * root element declares 3508 — so RASTER_W / W is 11.8114 px/mm, not the
 * 11.81102 that 300/25.4 gives, and a "tidy-up" that computed one pair from the
 * other would move every sheet by a third of a pixel and be very hard to see.
 *
 * The second thing worth pinning is that the root element is byte-for-byte what
 * the four generators used to emit. This is the only line in the extraction
 * where a shared function REPLACES a literal string rather than a literal
 * number, so it is the only one where a stray space would produce a diff on
 * every sheet at once — which the byte gate would catch, but this says why.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ENGINE_DIR, load } = require('./_engine');

const { W, H, RASTER_W, RASTER_H, svgOpen } = load('page.js');

test('the page is A4 landscape in millimetres', () => {
  assert.strictEqual(W, 297);
  assert.strictEqual(H, 210);
});

test('the raster pair is the ROUNDED 300dpi size and is not derived from the mm pair', () => {
  assert.strictEqual(RASTER_W, 3508);
  assert.strictEqual(RASTER_H, 2480);
  // The exact conversion, for comparison: deriving would give 3507.87 / 2480.31.
  assert.notStrictEqual(RASTER_W, Math.round((W * 300) / 25.4 * 1000) / 1000);
  assert.ok(Math.abs(RASTER_W - (W * 300) / 25.4) < 0.2, 'still the 300dpi size, rounded');
  assert.ok(Math.abs(RASTER_H - (H * 300) / 25.4) < 0.4, 'still the 300dpi size, rounded');
});

test('svgOpen() is character-for-character the line all four generators wrote out', () => {
  assert.strictEqual(
    svgOpen(W, H),
    '<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 297 210">');
  // Defaulted, it is the same line: the internal, both externals and the
  // boarding sheet are all one page size, and none of them passes anything else.
  assert.strictEqual(svgOpen(), svgOpen(W, H));
});

test('no entry generator still carries the page size as a literal', () => {
  // The finding was twelve numbers that happened to be equal. This is the check
  // that they did not quietly become thirteen.
  const files = ['gen_internal.js', 'gen_external_radial.js', 'gen_external_busway.js', 'gen_boarding.js'];
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8');
    for (const line of src.split(/\r?\n/)) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;          // prose may quote the numbers
      if (/\b(?:W|H)\s*=\s*(?:297|210)\b/.test(line)) offenders.push(f + ': ' + line.trim());
      if (/width="3508"/.test(line)) offenders.push(f + ': ' + line.trim());
    }
  }
  assert.deepStrictEqual(offenders, []);
});
