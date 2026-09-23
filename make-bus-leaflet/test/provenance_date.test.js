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

/** The ELSE-BRANCH of the `checkedAt ? … : …` ternary, and only that. Null when there
 *  is no such ternary.
 *
 *  IT USED TO BE `/checkedAt\s*\?([^\n]*)/` — the rest of the LINE — and that read the
 *  whole footer on any generator that builds its notes as one long template literal.
 *  `gen_external_places.js` does exactly that, and its line carries two more ternaries
 *  after this one, both ending `: ''`; so the assertion below was satisfied by a `: ''`
 *  belonging to `_hasTimes`, and a checkedAt branch defaulting to a made-up date passed.
 *  It survived as case 3 of tools/prove-red-provenance-place.js on 2026-09-22 and is the
 *  reason this helper exists: the suite was green about a fault on the one generator
 *  OA-321 had just brought into its population. The two town generators never exposed it
 *  because their notes are split one per array element, so the line ended at the ternary.
 *
 *  The scan counts BRACES only — never parentheses, which appear inside the string
 *  literals here (" (") and would unbalance at once — and stops at the first `}` or `;`
 *  seen at depth 0, which is the end of the enclosing `${…}` placeholder in the two
 *  radial generators and the end of the statement in gen_internal.js's CHECKED_AT. */
function checkedAtElse(src) {
  const at = src.search(/\bcheckedAt\s*\?/);
  if (at < 0) return null;
  let depth = 0, colon = -1;
  for (let i = src.indexOf('?', at) + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { if (depth === 0) return colon < 0 ? null : src.slice(colon + 1, i); depth--; }
    else if (depth === 0 && (c === ';' || c === '\n')) return colon < 0 ? null : src.slice(colon + 1, i);
    else if (c === ':' && depth === 0 && colon < 0) colon = i;
  }
  return null;
}

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

// THE EXEMPTION IS LOAD-BEARING AND IT RETIRES ITSELF, AND ON 2026-09-22 IT DID.
// gen_external_places.js drew "cross-checked with operators" and read checkedAt NOWHERE,
// so its sheet made the claim and could not ever say when — the OA-153 fault in its
// dateless form. It was exempted here rather than fixed in place because the fix is an
// assets/ change owing a portal re-vendor and a rebuild of three live place sheets, and
// a gate that is red on the day it lands is one somebody mutes in its first week. OA-321
// then fixed it, and the LAST TEST IN THIS FILE is what said so: with the generator
// changed and this entry still present, the suite went red naming the file and quoting
// the reason below, which is how the entry came to be deleted rather than left behind as
// a stale excuse. THE MAP IS DELIBERATELY LEFT IN PLACE AND EMPTY — the control iterates
// it, so an empty map is a control that iterates nothing, and the mutation that proves
// the control still discriminates is case 4 of tools/prove-red-provenance-place.js, which
// puts a stale entry back and requires the suite to refuse it.
const KNOWN_DATELESS = new Map([]);

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
    const branch = checkedAtElse(CODE.get(g));
    assert.ok(branch !== null, `${g} does not branch on checkedAt at all`);
    // validFrom FIRST, and the order is load-bearing: it is a strict special case of the
    // empty-string rule below, so whichever runs first is the message a reader gets. The
    // named one is worth far more than "not an empty string" — it says which field was
    // reached for and why that field answers a different question. Until 2026-09-22 the
    // order did not matter, because the empty-string assertion was passing spuriously.
    assert.ok(!/validFrom/.test(branch),
      `${g} falls back to validFrom, which is when the timetable takes effect — not when it was checked.`);
    assert.ok(/^\s*(''|"")\s*$/.test(branch),
      `${g}'s checkedAt branch must fall back to an empty string, not to another date. Got: ${branch.trim()}`);
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
