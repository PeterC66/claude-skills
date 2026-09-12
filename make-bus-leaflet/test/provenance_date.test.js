/*
 * The footer's cross-check date must come from routes.json, never from the source.
 *
 * Until 2026-08-28 three generators each carried a hardcoded "June 2026" inside the
 * attribution note, identical on all 20 maps and false on most of them: the S1
 * passes it claimed to describe ran anywhere between June and August 2026, and
 * Ramsey's had never happened at all. A member of the public reported real errors on
 * a sheet whose footer said it had been cross-checked (OA-153).
 *
 * A byte gate cannot catch this class. It compares a generator against its own
 * previous output, so a date that is wrong on every map is reproduced perfectly and
 * for ever. Nothing else in the suite reads the generators as text, so this file is
 * the only place the invariant "no generator states a provenance date of its own"
 * is written down.
 *
 * These are deliberately source assertions rather than render assertions: the
 * generators need a whole S2/S3 data tree to run, which the suite does not have and
 * should not grow. The rendered behaviour on both branches is covered by the byte
 * gates over 39 sheets across 20 maps.
 *
 * THE POPULATION IS DERIVED, NEVER TYPED — and until 2026-09-12 it was typed, as a
 * two-name array. That is the same shape `generator_load.test.js` exists to refuse,
 * and it had already cost this estate a day: `gen_external_busway.js` threw at load
 * through a re-vendor and a deploy because every check could only see the files some
 * artefact ran. A hand-written list here rots the same way and more quietly, because
 * a generator it omits is not merely unchecked — it reads as checked. Of the seven
 * entry points the engine hashes, FOUR draw an attribution band and the list named
 * two, so half the drawn footers in this estate were outside the only test that
 * reads a generator as text.
 *
 * The two populations below are different sets and that is the point:
 *
 *   DRAWS_FOOTER      — calls footerBand(). Must state no date of its own.
 *   CLAIMS_CROSSCHECK — its footer text says "cross-check". Must ALSO read
 *                       checkedAt, because a claim to have checked carries a claim
 *                       about WHEN, and a sheet that will not say when is asserting
 *                       the thing OA-153 was raised about.
 *
 * gen_boarding.js is the case that shows why one list would be wrong: it draws a
 * footer and makes no cross-check claim in it, so assertion 1 applies to it and
 * assertions 2 and 3 must not.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Through _engine.js, NOT a hardcoded '../assets'. The first version of this file
// resolved the path itself and all three of its prove-red mutations SURVIVED: the
// harness copies assets/ to a scratch dir and points ENGINE_DIR at it, so a test
// that reads the real folder is green about code the run never touched. It was a
// suite that could not fail, which is the exact thing prove-red exists to expose.
const ASSETS = require('./_engine.js').ENGINE_DIR;
const EV = require(path.join(ASSETS, 'engine_version.js'));
const PLACE_DIR = EV.placeAssetsDir(ASSETS);

// THE PLACE HALF SKIPS LOUDLY, IT DOES NOT VANISH — the rule generator_load.test.js
// states and the reason it states it. A mutation run copies the TOWN engine to a
// scratch folder and points ENGINE_DIR at it; the place skill is not copied, so
// PLACE_DIR does not exist there. That is a legitimate reason to check fewer files,
// and a silent filter is also how a deleted generator stops being checked without
// anyone noticing. So the absence is announced, and only a whole missing FOLDER
// earns it.
const PLACE_PRESENT = fs.existsSync(PLACE_DIR);
if (!PLACE_PRESENT) {
  console.log('# provenance_date: the place assets folder is not at ' + PLACE_DIR
    + ' — checking the town generators only (this is the expected shape under ENGINE_DIR=<scratch>)');
}

// icons.js and lane_normals.js are in ENGINE_FILES because their BYTES belong in the
// hash, not because they are run. They draw nothing and are filtered out by the
// footerBand test below rather than by name, so a library that grew a footer would
// still be caught.
const ENTRIES = [
  ...EV.ENGINE_FILES.map((f) => [path.join(ASSETS, f), f]),
  ...EV.BOARDING_ENGINE_FILES.map((f) => [path.join(ASSETS, f), f]),
  ...(PLACE_PRESENT ? EV.PLACE_ENGINE_FILES.map((f) => [path.join(PLACE_DIR, f), 'place/' + f]) : []),
];

// A month-and-year literal: the shape of the fault. Matched only OUTSIDE comments,
// because the comments in these files deliberately quote the old string to explain
// what was removed and why — a test that banned the words outright would force the
// history out of the code, which is the opposite of what this project wants.
const MONTH_YEAR = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d\d\b/;

/** Source with // line comments and block comments removed. Crude, and enough:
 *  these files contain no string literal carrying "//" or a comment marker. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}

const CODE = new Map();
for (const [abs, label] of ENTRIES) {
  if (fs.existsSync(abs)) CODE.set(label, stripComments(fs.readFileSync(abs, 'utf8')));
}

const DRAWS_FOOTER = [...CODE.keys()].filter((l) => /\bfooterBand\s*\(/.test(CODE.get(l))).sort();
const CLAIMS_CROSSCHECK = DRAWS_FOOTER.filter((l) => /cross-check/i.test(CODE.get(l)));

// THE EXEMPTION IS LOAD-BEARING AND IT RETIRES ITSELF. gen_external_places.js draws
// "cross-checked with operators" and reads checkedAt NOWHERE, so its sheet makes the
// claim and cannot ever say when — the OA-153 fault in its dateless form. The fix is
// an assets/ change, which owes a portal re-vendor and a rebuild of three live place
// sheets, so it is FILED as OA-321 rather than made here; a gate that is red on the
// day it lands is one somebody mutes in its first week. The last test in this file
// asserts the exemption is still EARNED, so whoever fixes OA-321 is told to delete
// this entry rather than left to discover it.
const KNOWN_DATELESS = new Map([
  ['place/gen_external_places.js',
   'OA-321 — claims a cross-check and reads checkedAt nowhere; fixing it moves ink on three live place sheets'],
]);

test('the derived population is every generator that draws a footer, and it is not empty', () => {
  // A suite whose population is empty is green by arithmetic. This is the assertion
  // that says the two filters below actually selected something, and it names the
  // three town generators explicitly because those are the ones present in EVERY
  // run, scratch mutation runs included.
  assert.ok(DRAWS_FOOTER.length >= 3,
    'expected at least the three town generators to draw a footer, got: ' + DRAWS_FOOTER.join(', '));
  for (const must of ['gen_internal.js', 'gen_external_radial.js', 'gen_boarding.js']) {
    assert.ok(DRAWS_FOOTER.includes(must),
      must + ' no longer calls footerBand() — if that is deliberate this test must be told, '
      + 'because it is the population every assertion below runs over. Got: ' + DRAWS_FOOTER.join(', '));
  }
  assert.ok(CLAIMS_CROSSCHECK.length >= 2,
    'expected at least two generators to claim a cross-check, got: ' + CLAIMS_CROSSCHECK.join(', '));
});

for (const g of DRAWS_FOOTER) {
  test(`${g} states no provenance date of its own`, () => {
    const hit = CODE.get(g).match(MONTH_YEAR);
    assert.strictEqual(hit, null,
      `${g} carries the literal "${hit && hit[0]}" in code. A date in a generator is the same on `
      + 'every map it draws, so it is wrong on all but the one it was written for. Read it from '
      + "routes.json's checkedAt instead.");
  });
}

for (const g of CLAIMS_CROSSCHECK) {
  if (KNOWN_DATELESS.has(g)) continue;

  test(`${g} reads checkedAt from the map's own config`, () => {
    assert.match(CODE.get(g), /\bcheckedAt\b/,
      `${g} draws a cross-check note but never reads checkedAt, so its date cannot be per-map.`);
  });

  test(`${g}: an absent checkedAt omits the parenthetical rather than guessing a date`, () => {
    // The honest failure mode. A default — most temptingly validFrom, which is a
    // DIFFERENT claim and already disagrees with the real S1 date on Huntingdon —
    // would manufacture a confident wrong date, which is the fault being fixed.
    const m = CODE.get(g).match(/checkedAt\s*\?([^\n]*)/);
    assert.ok(m, `${g} does not branch on checkedAt at all`);
    const branch = m[1];
    assert.ok(/:\s*''/.test(branch),
      `${g}'s checkedAt branch must fall back to an empty string, not to another date. Got: ${branch.trim()}`);
    assert.ok(!/validFrom/.test(branch),
      `${g} falls back to validFrom, which is when the timetable takes effect — not when it was checked.`);
  });
}

test('every exemption is still earned, so a fixed generator retires its own entry', () => {
  // The control. Without this, KNOWN_DATELESS is a list that silently excuses a file
  // for ever — including one somebody has already fixed, and one that has stopped
  // claiming a cross-check at all. Both of those now go red and say what to delete.
  for (const [label, why] of KNOWN_DATELESS) {
    if (!CODE.has(label)) continue;   // the place half is absent under a scratch ENGINE_DIR
    assert.ok(CLAIMS_CROSSCHECK.includes(label),
      label + ' is exempted here but no longer claims a cross-check in its footer. '
      + 'Delete its KNOWN_DATELESS entry — the exemption is stale. (' + why + ')');
    assert.ok(!/\bcheckedAt\b/.test(CODE.get(label)),
      label + ' now reads checkedAt, so it no longer needs its exemption. '
      + 'Delete its KNOWN_DATELESS entry and let the two assertions above run over it. (' + why + ')');
  }
});
