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

/* ---- the population, derived rather than typed ------------------------------ */

// UNTIL 2026-09-12 THE TEST BELOW RAN OVER THREE NAMES TYPED INTO IT, and six files
// in this estate open a page. The three it could not see included the only file that
// breaches the rule it exists to hold. That is the shape found the day before in
// provenance_date.test.js next door under OA-001, and refused in terms by
// generator_load.test.js's header: a hand-typed population inside a green test is
// indistinguishable from coverage, from the outside and from the row that counts it.
// Worse here than a plain omission, because the three names are all TOWN files and
// the place skill has no test folder of its own — so a list typed in this directory
// silently stops at the skill boundary, and the invariant is about both skills.
//
// The population is therefore taken from engine_version.js's three lists and then
// filtered on what each file DOES: a generator that stops drawing a page leaves it,
// one that starts drawing a page joins it, and neither happens by anybody's hand.
const EV = load('engine_version.js');
const PLACE_DIR = EV.placeAssetsDir(ENGINE_DIR);

// THE PLACE HALF SKIPS LOUDLY, IT DOES NOT VANISH. A mutation run copies the TOWN
// assets to a scratch folder and points ENGINE_DIR at it; the place skill is not
// beside them there. That is a legitimate reason to check fewer files — and a silent
// filter is also how a deleted generator stops being checked without anyone noticing,
// so the absence is announced and only a whole missing FOLDER earns it.
const PLACE_PRESENT = fs.existsSync(PLACE_DIR);
if (!PLACE_PRESENT) {
  console.log('# page: the place assets folder is not at ' + PLACE_DIR
    + ' — checking the town generators only (the expected shape under ENGINE_DIR=<scratch>)');
}

const CANDIDATES = [
  ...EV.ENGINE_FILES.map((f) => [path.join(ENGINE_DIR, f), f]),
  ...EV.BOARDING_ENGINE_FILES.map((f) => [path.join(ENGINE_DIR, f), f]),
  ...(PLACE_PRESENT ? EV.PLACE_ENGINE_FILES.map((f) => [path.join(PLACE_DIR, f), 'place/' + f]) : []),
];

/** Source with // line comments and block comments removed. The comments in these
 *  files quote the old literal on purpose, to say what was removed and why; a test
 *  that read them would force that history out of the code. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const SRC = new Map();
for (const [abs, label] of CANDIDATES) {
  if (fs.existsSync(abs)) SRC.set(label, fs.readFileSync(abs, 'utf8'));
}

// icons.js and lane_normals.js are in ENGINE_FILES because their BYTES belong in the
// hash, not because they draw anything, and gen_internal_place.js builds its sheet
// through the town generator rather than opening its own root. All three are filtered
// out by what they DO, not by name, so a library that grew a page would still be caught.
const OPENS_PAGE = /svgOpen\s*\(|<svg\s+xmlns=/;
const DRAWS_PAGE = [...SRC.keys()].filter((l) => OPENS_PAGE.test(stripComments(SRC.get(l)))).sort();

// THE EXEMPTION IS LOAD-BEARING AND IT RETIRES ITSELF. gen_external_places.js keeps a
// second home for the page size — `const W = 297, H = 210` — and writes the root
// element out as its own literal instead of calling svgOpen(), which is the thirteenth
// number this test was written to prevent and the one file it could not see. The fix is
// an assets/ change, which owes a portal re-vendor and `npm run track:engine` in the
// same commit, so it is FILED as OA-322 rather than made here; a gate that is red on the
// day it lands is one somebody mutes in its first week. The control below asserts the
// exemption is still EARNED, so whoever fixes OA-322 is told to delete this entry.
const KNOWN_LITERAL = new Map([
  ['place/gen_external_places.js',
   'OA-322 — a second home for the page size and its own copy of the root element; fixing it owes a re-vendor'],
]);

test('the derived population is every generator that opens a page, and it is not empty', () => {
  // A suite whose population is empty is green by arithmetic. This says the filter
  // above selected something, and names the three town generators the typed list used
  // to carry, because those are the ones present in EVERY run, scratch mutations included.
  assert.ok(DRAWS_PAGE.length >= 5,
    'expected at least the five town entry points to open a page, got: ' + DRAWS_PAGE.join(', '));
  for (const must of ['gen_internal.js', 'gen_external_radial.js', 'gen_boarding.js']) {
    assert.ok(DRAWS_PAGE.includes(must),
      must + ' no longer opens a page — if that is deliberate this test must be told, '
      + 'because it is the population the assertions below run over. Got: ' + DRAWS_PAGE.join(', '));
  }
  if (PLACE_PRESENT) {
    assert.ok(DRAWS_PAGE.some((l) => l.startsWith('place/')),
      'no place generator opens a page, yet the place assets folder is present — the cross-skill '
      + 'half of this population has gone silent. Got: ' + DRAWS_PAGE.join(', '));
  }
});

for (const g of DRAWS_PAGE) {
  if (KNOWN_LITERAL.has(g)) continue;

  test(`${g} carries no page size of its own`, () => {
    // The finding was twelve numbers that happened to be equal. This is the check
    // that they did not quietly become thirteen.
    const offenders = [];
    for (const line of SRC.get(g).split(/\r?\n/)) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;          // prose may quote the numbers
      if (/\b(?:W|H)\s*=\s*(?:297|210)\b/.test(line)) offenders.push(g + ': ' + line.trim());
      if (/width="3508"/.test(line)) offenders.push(g + ': ' + line.trim());
    }
    assert.deepStrictEqual(offenders, [],
      g + ' keeps its own copy of the page size. Take W, H and svgOpen from page.js — '
      + 'the two pairs are not derivable from each other, so a second home is a second answer.');
  });
}

test('every exemption is still earned, so a fixed generator retires its own entry', () => {
  // The control. Without it KNOWN_LITERAL silently excuses a file for ever — including
  // one somebody has already fixed, and one that has stopped opening a page at all.
  for (const [label, why] of KNOWN_LITERAL) {
    if (!SRC.has(label)) continue;   // the place half is absent under a scratch ENGINE_DIR
    assert.ok(DRAWS_PAGE.includes(label),
      label + ' is exempted here but no longer opens a page. Delete its KNOWN_LITERAL entry — '
      + 'the exemption is stale. (' + why + ')');
    const carries = SRC.get(label).split(/\r?\n/).some((line) =>
      !/^\s*(\/\/|\*|\/\*)/.test(line)
      && (/\b(?:W|H)\s*=\s*(?:297|210)\b/.test(line) || /width="3508"/.test(line)));
    assert.ok(carries,
      label + ' no longer carries a page size of its own, so it does not need its exemption. '
      + 'Delete its KNOWN_LITERAL entry and let the assertion above run over it. (' + why + ')');
  }
});
