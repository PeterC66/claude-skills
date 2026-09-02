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

// Every generator that draws an attribution band naming a cross-check.
const GENERATORS = ['gen_internal.js', 'gen_external_radial.js'];

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

for (const g of GENERATORS) {
  const src = fs.readFileSync(path.join(ASSETS, g), 'utf8');
  const code = stripComments(src);

  test(`${g} states no provenance date of its own`, () => {
    const hit = code.match(MONTH_YEAR);
    assert.strictEqual(hit, null,
      `${g} carries the literal "${hit && hit[0]}" in code. A date in a generator is the same on `
      + 'every map it draws, so it is wrong on all but the one it was written for. Read it from '
      + "routes.json's checkedAt instead.");
  });

  test(`${g} reads checkedAt from the map's own config`, () => {
    assert.match(code, /\bcheckedAt\b/,
      `${g} draws a cross-check note but never reads checkedAt, so its date cannot be per-map.`);
  });
}

test('an absent checkedAt omits the parenthetical rather than guessing a date', () => {
  // The honest failure mode. A default — most temptingly validFrom, which is a
  // DIFFERENT claim and already disagrees with the real S1 date on Huntingdon —
  // would manufacture a confident wrong date, which is the fault being fixed.
  for (const g of GENERATORS) {
    const code = stripComments(fs.readFileSync(path.join(ASSETS, g), 'utf8'));
    const m = code.match(/checkedAt\s*\?([^\n]*)/);
    assert.ok(m, `${g} does not branch on checkedAt at all`);
    const branch = m[1];
    assert.ok(/:\s*''/.test(branch),
      `${g}'s checkedAt branch must fall back to an empty string, not to another date. Got: ${branch.trim()}`);
    assert.ok(!/validFrom/.test(branch),
      `${g} falls back to validFrom, which is when the timetable takes effect — not when it was checked.`);
  }
});
