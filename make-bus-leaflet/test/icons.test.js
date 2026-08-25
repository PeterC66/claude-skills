/*
 * icons.js — the POI pictograms, and one of the four files the engine hash
 * covers. `inkify` is a regex over finished artwork, which is the kind of code
 * that keeps working right up until someone adds a glyph with a shade nobody
 * thought about. Its three special cases are all corrections to a version that
 * had already shipped:
 *
 *   - a PALE fill is a backing plate, not a mark, and recolouring it charcoal
 *     turned the allotments glyph's bed into a solid black block;
 *   - a symbol drawn in NEUTRAL GREY was light on purpose — flattening every
 *     colour to one charcoal made a cluster of factories the heaviest ink on
 *     the sheet, the opposite of what taking the colour out is for;
 *   - the GP cross keeps its red, because that one is not decoration.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { icon, inkify, gridGlyph, GRID_COL } = require('./_engine.js').load('icons.js');

const fills = (svg) => [...svg.matchAll(/fill="(#[0-9a-fA-F]{3,6})"/g)].map(m => m[1].toLowerCase());

test('a saturated colour goes to charcoal', () => {
  assert.deepStrictEqual(fills(inkify('<path fill="#1f78b4"/>')), ['#33383d']);
  assert.deepStrictEqual(fills(inkify('<path fill="#2f8f2f"/>')), ['#33383d']);
});

test('the health red keeps an accent rather than joining the neutral', () => {
  assert.deepStrictEqual(fills(inkify('<path fill="#d00"/>')), ['#c62828']);
});

test('a pale fill goes to white, because it is a plate and not a mark', () => {
  assert.deepStrictEqual(fills(inkify('<rect fill="#f2f2ee"/>')), ['#ffffff']);
});

test('a mid grey keeps its tone instead of becoming the heaviest ink on the sheet', () => {
  const [out] = fills(inkify('<path fill="#777777"/>'));
  assert.notStrictEqual(out, '#33383d', 'the industrial estate was flattened to full charcoal again');
  assert.notStrictEqual(out, '#ffffff');
  const n = parseInt(out.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  assert.ok(Math.abs(lum - 0.4666) < 0.02, `tone moved: #777777 came back at luminance ${lum.toFixed(3)}`);
});

test('short hex is expanded before it is judged, not measured as three digits', () => {
  assert.deepStrictEqual(fills(inkify('<path fill="#fff"/>')), ['#ffffff']);
});

test('strokes are recoloured as well as fills', () => {
  assert.match(inkify('<path stroke="#1f78b4"/>'), /stroke="#33383d"/);
});

test('inkify leaves anything that is not a hex colour alone', () => {
  const svg = '<path fill="none" stroke="currentColor"/><g fill="url(#grad)"/>';
  assert.strictEqual(inkify(svg), svg);
});

test('every grid category has a colour, and every colour draws something', () => {
  // A category with no entry falls back to #666666 and reads as "context" —
  // silently demoting a shop to street furniture.
  for (const cat of Object.keys(GRID_COL)) {
    const g = gridGlyph(cat, GRID_COL[cat]);
    assert.ok(g && g.length > 40, `${cat} drew nothing`);
    assert.ok(g.includes(GRID_COL[cat]), `${cat} did not use its own colour`);
  }
});

test('the grid set is drawn charcoal by parameter, never by running inkify over it', () => {
  // "Authored one-colour-per-glyph, so charcoal is a parameter rather than a
  // regex over the artwork — inkify is not used on this set and must not be."
  const plain = icon('shop', 10, 10, 2.2, null, 'grid');
  const dark = icon('shop', 10, 10, 2.2, 'charcoal', 'grid');
  assert.ok(plain.includes(GRID_COL.shop), 'the coloured grid glyph lost its own colour');
  assert.ok(!dark.includes(GRID_COL.shop), 'the charcoal grid glyph kept a route-like colour');
  assert.ok(dark.includes('#ffffff'), 'the casing pass is missing: charcoal on a dark route is charcoal on navy');
});

test('an icon is centred where it is asked for, and scales from s', () => {
  assert.match(icon('shop', 42, 17, 2.2, null, 'grid'), /translate\(42 17\)/);
  const small = icon('shop', 0, 0, 1.1, null, 'grid'), big = icon('shop', 0, 0, 4.4, null, 'grid');
  assert.notStrictEqual(small, big, 'two sizes produced identical artwork');
});

test('an icon is deterministic', () => {
  assert.strictEqual(icon('library', 5, 5, 2.1, 'charcoal', 'grid'), icon('library', 5, 5, 2.1, 'charcoal', 'grid'));
});
