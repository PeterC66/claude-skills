/*
 * font_metrics.js — the file that exists because label collision code guessed
 * text width as `length * size * 0.52`. Its own header says the real Arial
 * advances span 0.222em to 0.944em, "a factor of four", and that the guess both
 * invented collisions and missed real ones. These tests are that sentence.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const FM = require('./_engine.js').load('font_metrics.js');

test('a wide glyph and a narrow one are not the same width', () => {
  // The whole reason this table exists: 0.52/char says W and i are equal.
  const w = FM.textWidth('W', 10);
  const i = FM.textWidth('i', 10);
  assert.ok(w / i > 3.5, `W/i should be about 4x, got ${(w / i).toFixed(2)}`);
});

test('width is linear in size', () => {
  const at2 = FM.textWidth('Huntingdon', 2);
  const at8 = FM.textWidth('Huntingdon', 8);
  assert.ok(Math.abs(at8 - at2 * 4) < 1e-9, `${at8} should be 4x ${at2}`);
});

test('bold is never narrower than regular for the same string', () => {
  // The placer reserves a box from one of these and the renderer draws with the
  // other; a bold string measured as regular is a label that outgrows its halo.
  for (const s of ['St Ives', 'Bus Station', 'Ramsey', 'A14']) {
    assert.ok(FM.textWidth(s, 3, true) >= FM.textWidth(s, 3, false) - 1e-9,
      `bold "${s}" measured narrower than regular`);
  }
});

test('an unmapped character costs FALLBACK, not zero', () => {
  // 121 glyphs are baked. A name carrying anything else — a Welsh circumflex, a
  // dash the source data invented — must still take up room, or the label is
  // measured short and the collision that follows is invisible to the placer.
  const known = FM.textWidth('nn', 4);
  const unknown = FM.textWidth('n\u0175', 4);           // n + w-circumflex, not in the table
  assert.ok(!('\u0175' in FM.REGULAR), 'test premise: w-circumflex is not in the table');
  assert.ok(Math.abs(unknown - known) < 0.02, `an unknown glyph should cost about FALLBACK (${known} vs ${unknown})`);
  assert.ok(unknown > FM.textWidth('n', 4), 'an unknown glyph cost nothing at all');
});

test('the empty string is zero, and a space is not', () => {
  assert.strictEqual(FM.textWidth('', 5), 0);
  assert.ok(FM.textWidth(' ', 5) > 0, 'a space with no width collapses two-line wrapping');
});
