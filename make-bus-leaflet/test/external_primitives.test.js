/*
 * external_primitives.test.js — the marks the two external sheets share.
 *
 * OA-224 Tier 3.5. `gen_external_places.js` is a reformatted CLONE of
 * `gen_external_radial.js`, and the same primitive has already been fixed in one
 * copy and not the others twice — the second time printing a 0.0923mm sliver on
 * St Ives' published external for eleven days (OA-167). So the extraction itself
 * is proved by the byte gate, and what is tested here is the FOUR THINGS THE
 * BYTE GATE CANNOT SEE:
 *
 *   1. That `out` is resolved at CALL time. Both generators declare `let out`
 *      and redirect it into a buffer while the legend is measured, then back. A
 *      factory that captured the binding's value would keep writing to the
 *      document while the caller believed it was buffering — ink in the wrong
 *      place, looking like a placement bug and nothing like a require. This is
 *      the one mistake this extraction could have made silently, and no fixture
 *      in the estate exercises it, because both callers pass the wrapper.
 *   2. The two `wrap`s, and exactly where they disagree. The estate proves they
 *      agree TODAY; only a test can hold the case they were written for.
 *   3. That the three parameters really are parameters — `onBadge`, the radius
 *      and `floor` — rather than one caller's behaviour frozen in.
 *   4. That neither generator has grown its own copy back.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ENGINE_DIR, load } = require('./_engine');

const EP = load('external_primitives.js');
const FONT = load('font_metrics.js');
const { wrap, externalPrimitives, hubEdgeFor, rayToRectFor } = EP;

/* The place skill, resolved from THIS folder and not from ENGINE_DIR: the
 * mutation harness copies only the town assets/, so a scratch run must still
 * find the real clone to take the census of. */
const PLACE_DIR = process.env.PLACE_SKILL_ASSETS
  || path.join(__dirname, '..', '..', 'make-place-bus-leaflet', 'assets');

/* ---- 1. the redirect, which is the trap this extraction could have fallen in ---- */

test('out is resolved at CALL time, so a caller may redirect it mid-sheet', () => {
  // Exactly what both generators do: draw, redirect into a buffer to measure the
  // legend's box, then put it back. If the factory had captured the value, the
  // buffer would come out empty and the document would carry the legend's marks.
  const doc = []; const buf = [];
  let out = (x) => doc.push(x);
  const p = externalPrimitives({
    out: (x) => out(x), palette: {}, textOn: {}, badgeLabel: (r) => r,
    font: FONT, badgeFit: true, badgeRadius: 4.6, onBadge: null,
  });
  p.tick(1, 2, '#000');
  const realOut = out;
  out = (x) => buf.push(x);
  p.tick(3, 4, '#000');
  out = realOut;
  p.tick(5, 6, '#000');
  assert.strictEqual(doc.length, 2, 'the redirected mark must NOT be in the document');
  assert.strictEqual(buf.length, 1, 'the redirected mark must be in the buffer');
  assert.match(buf[0], /cx="3.00"/);
});

/* ---- 2. the wrap ---- */

/* There were two of these until 2026-09-04, and the second was a live defect kept
 * on purpose so an extraction could claim nothing moved. OA-229 deleted it and
 * pointed both generators here, which moved ink on three published sheets. What
 * survives is the CASE LIST: the whole population of the bug is a label whose
 * first word is longer than the width it is given, because the width is a
 * character count and not a measurement. Ask that of every new destination. */

test('THE FAULT THIS FIXED: a one-word label longer than the wrap width takes line one', () => {
  // "Hinchingbrooke" is 14 characters and was the destination on all three sheets
  // that carried the empty element — St Ives' external and both Godmanchester
  // place externals. The wrong answer was ['', 'Hinchingbrooke']: a real
  // <text></text> element taking a line's worth of leading, with the name pushed
  // 2mm down a box sized for two lines.
  assert.deepStrictEqual(wrap('Hinchingbrooke', 13), ['Hinchingbrooke']);
  assert.notDeepStrictEqual(wrap('Hinchingbrooke', 13), ['', 'Hinchingbrooke'],
    'the empty first line is the defect OA-229 removed');
  // With a second word the old form put BOTH on line two — a line the caller's
  // width formula had been told would be at most `max` characters.
  assert.deepStrictEqual(wrap('Cambridgeshire Guided', 13), ['Cambridgeshire', 'Guided']);
  // No line this returns is ever empty, which is the property the SVG cares about.
  for (const label of ['Hinchingbrooke', 'Cambridgeshire Guided', 'Peterborough', 'A', 'Wolverhampton']) {
    for (const line of wrap(label, 13)) assert.notStrictEqual(line, '', label + ' emitted an empty line');
  }
});

test('a label whose first word fits is unaffected — the cases the two forms always agreed on', () => {
  assert.deepStrictEqual(wrap('St Neots', 13), ['St Neots']);
  assert.deepStrictEqual(wrap('Cambridge', 13), ['Cambridge']);
  assert.deepStrictEqual(wrap('Fen Drayton Lakes', 13), ['Fen Drayton', 'Lakes']);
  assert.deepStrictEqual(wrap('Huntingdon Bus Station', 13), ['Huntingdon', 'Bus Station']);
  assert.deepStrictEqual(wrap('a b c d e f g h i j', 5), ['a b c', 'd e f g h i j']);
});

test('a label at or under the width, or already broken by hand, is passed through', () => {
  assert.deepStrictEqual(wrap('Ramsey', 13), ['Ramsey']);
  assert.deepStrictEqual(wrap('Long name here\nsecond', 13), ['Long name here', 'second'],
    'an explicit newline wins over the width');
});

test('the legacy wrap is GONE from the exports, not merely unused', () => {
  // It was exported and named for three days so that no caller could inherit the
  // bug by writing `wrap`. Both callers now write `wrap`, so the name must not
  // come back: a re-export would be a second spelling of a primitive this project
  // has already paid for having three of (dash_fit.js, OA-167). The assertion is
  // on the EXPORTS and not on the source text, because the file's own header is
  // entitled to go on explaining what was deleted and why.
  assert.strictEqual(EP.wrapLegacyEmptyFirstLine, undefined);
  assert.deepStrictEqual(Object.keys(EP).sort(),
    ['externalPrimitives', 'hubEdgeFor', 'rayToRectFor', 'wrap']);
});

/* The require statement, and only that — a comment saying which export this file
 * USED to take is history worth keeping, and a grep over the whole source would
 * forbid writing it down. */
const destructuredFrom = (file, mod) => {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(new RegExp('const\\s*\\{([^}]*)\\}\\s*=\\s*[\\s\\S]{0,40}?require\\([^)]*' + mod + '[^)]*\\)'));
  assert.ok(m, path.basename(file) + ' has no destructuring require of ' + mod);
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
};

test('BOTH generators take the corrected wrap, by name', () => {
  // The whole shape of OA-229 is that one module was right and its two callers
  // asked for the wrong export. Reading the require is the only way to ask that:
  // the byte gate proves what the sheets look like, not which symbol was imported.
  for (const f of [path.join(ENGINE_DIR, 'gen_external_radial.js'),
                   path.join(PLACE_DIR, 'gen_external_places.js')]) {
    const names = destructuredFrom(f, 'external_primitives\\.js');
    assert.ok(names.includes('wrap'), path.basename(f) + ' does not take `wrap`');
    assert.ok(!names.some(n => /wrapLegacy/.test(n)),
      path.basename(f) + ' still imports the legacy wrap: ' + names.join(', '));
  }
});

/* ---- 3. the three parameters ---- */

const mk = (over = {}) => {
  const lines = [];
  const api = externalPrimitives({
    out: (x) => lines.push(x),
    palette: { 9: '#66CCEE', '301S': '#EE6677' },
    textOn: { 9: '#000' },
    badgeLabel: (r) => r,
    font: FONT,
    badgeFit: true,
    badgeRadius: 4.6,
    onBadge: null,
    ...over,
  });
  return { api, lines };
};

test('badgeRadius is the default, and it differs between the two sheets', () => {
  const town = mk({ badgeRadius: 4.6 });
  town.api.badge(10, 20, 9);
  assert.match(town.lines[0], /r="4.6"/);
  const place = mk({ badgeRadius: 4.0 });
  place.api.badge(10, 20, 9);
  assert.match(place.lines[0], /r="4"/);
});

test('onBadge is handed the geometry that was drawn, and is optional', () => {
  const seen = [];
  const { api, lines } = mk({ onBadge: (x, y, hw, r) => seen.push([x, y, hw, r]) });
  api.badge(100, 50, '301S', 4.6);
  assert.strictEqual(seen.length, 1);
  const [x, y, hw, r] = seen[0];
  assert.deepStrictEqual([x, y, r], [100, 50, 4.6]);
  assert.strictEqual(hw, api.badgeHalfW('301S', 4.6));
  // The hook is told the HALF-WIDTH, not the radius, which is the whole reason
  // it is a hook: a stadium's reserved box is wider than its disc.
  assert.ok(hw > r, 'premise: 301S at 4.6mm is a stadium');
  assert.match(lines[0], /^<rect /);
  // And with no hook at all, nothing throws and the same marks are drawn.
  const none = mk({ onBadge: null });
  none.api.badge(100, 50, '301S', 4.6);
  assert.deepStrictEqual(none.lines, lines);
});

test('the badge text is 0.95 x the radius, which is what makes this not svg_primitives badge()', () => {
  const { api, lines } = mk();
  api.badge(10, 20, 9, 4.6);
  assert.match(lines[1], /font-size="4.37"/);
});

test('hubEdge floor: 14 on the town sheet, 0 on the place one, and 0 is not-a-floor', () => {
  const a = 30, b = 8;
  const town = hubEdgeFor({ a, b, floor: 14 });
  const place = hubEdgeFor({ a, b, floor: 0 });
  // Along the short axis the ellipse gives 8mm, so the floor is what decides.
  assert.strictEqual(place(0, 1), 8);
  assert.strictEqual(town(0, 1), 14);
  // Along the long axis it gives 30mm and the floor is inert — which is the
  // clone's own argument for dropping it, and the reason a floor of 0 reproduces
  // the clone exactly rather than approximately.
  assert.strictEqual(place(1, 0), 30);
  assert.strictEqual(town(1, 0), 30);
  // The degenerate bearing, which both copies special-cased.
  assert.strictEqual(place(0, 0), 30);
  assert.strictEqual(town(0, 0), 30);
});

test('rayToRect answers the nearest wall along the bearing', () => {
  const r = rayToRectFor({ rect: { x0: 20, y0: 30, x1: 280, y1: 180 }, hx: 150, hy: 100 });
  assert.strictEqual(r(1, 0), 130);          // east wall
  assert.strictEqual(r(-1, 0), 130);         // west wall
  assert.strictEqual(r(0, 1), 80);           // south wall
  assert.strictEqual(r(0, -1), 70);          // north wall
  // Both diagonals, because the walls are tested x-then-y: one case where the y
  // wall is nearer and one where the x wall is. A `min` mistaken for an
  // assignment gives the right answer for the first and the wrong one for the
  // second, so a single diagonal proves nothing.
  assert.strictEqual(r(1, 1), 80, 'the NEAREST of the two, not the last one tested');
  assert.strictEqual(r(1, 0.2), 130, '...and the x wall when THAT is the nearer');
});

/* ---- 4. the census ---- */

test('neither external generator defines these primitives itself any more', () => {
  const files = [
    path.join(ENGINE_DIR, 'gen_external_radial.js'),
    path.join(PLACE_DIR, 'gen_external_places.js'),
  ].filter((f) => fs.existsSync(f));
  assert.strictEqual(files.length, 2, 'a generator this test is about has moved or gone');
  // tick and badge are NOT in this list. They were shared by neither caller when
  // this module was extracted, because the third external generator -- the busway
  // one, dropped 2026-09-02 -- wrote its tick coordinates without .toFixed(2) and
  // always drew a circular badge. The two that remain agree; unifying them is a
  // live option now rather than one that would have moved ink.
  const OWN = [/^function line\(/, /^function wrap\(/, /^function stampNote\(/,
    /^function rayToRect\(/, /^function hubEdge\(/, /^const badgeHalfW =/];
  const offenders = [];
  for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (OWN.some((re) => re.test(line))) offenders.push(path.basename(f) + ': ' + line.trim());
    }
  }
  assert.deepStrictEqual(offenders, []);
});
