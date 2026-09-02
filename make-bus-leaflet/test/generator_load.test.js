/*
 * generator_load.test.js — every entry generator must LOAD.
 *
 * WHY THIS EXISTS, and it is not a hypothetical. On 2026-09-02 the Tier 3.4/3.5
 * extraction (5816627) gave `gen_external_busway.js` two calls to `_from(...)`
 * and never declared `_from`. The file threw `ReferenceError: _from is not
 * defined` at load — not on a rare branch, not for one town, but the moment node
 * read it — and it stayed that way through the rest of that day's work, a
 * re-vendor and a deploy to busmaps.uk, with:
 *
 *     status.js PASS, all 98 sheet verdicts green, 249/249 mutations caught,
 *     prove-red-gates 12/12, npm test green, CI green.
 *
 * Every one of those gates asks the same question — DOES THE OUTPUT STILL MATCH
 * — and every one of them can only ask it of a generator some map actually runs.
 * No committed sheet ran the busway one (it went dormant on 2026-08-03 when St
 * Ives moved to the radial template), so the whole suite was silent about a file
 * that could not execute a single line. `gate_lib.detectExternalStyle` even
 * probed it, got a failure, and read that as "this town must be radial, then".
 *
 * THE CHEAPEST POSSIBLE QUESTION IS THE ONE NOBODY WAS ASKING: does the file
 * load? It costs a require. What made it unaskable was that requiring a
 * generator used to DRAW A MAP — so a test could not load one without a town's
 * data around it. OA-224 Tier 4.1 put every generator's body behind
 * `if (require.main === module) main()`, and this test is the reason that was
 * worth a hash move.
 *
 * THE POPULATION IS DERIVED, NEVER TYPED. A hand-written list here would rot the
 * same way: the entry points come from engine_version.js, which is the file that
 * has to know them anyway, and the last test asserts that list against the
 * generators actually on disk. A generator added to assets/ and to nobody's list
 * is exactly the shape that hid for a month.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { ENGINE_DIR } = require('./_engine.js');
const EV = require(path.join(ENGINE_DIR, 'engine_version.js'));
const PLACE_DIR = EV.placeAssetsDir(ENGINE_DIR);

// THE PLACE HALF SKIPS LOUDLY, IT DOES NOT VANISH. A mutation run (tools/prove-red.js)
// copies the TOWN engine to a scratch folder and points ENGINE_DIR at it; the place
// skill is not copied, so PLACE_DIR does not exist there. That is a legitimate reason
// to check fewer files — and a silent `filter(existsSync)` is also exactly how a
// generator that has been DELETED would stop being checked without anyone noticing.
// So the absence is announced, and only a whole missing FOLDER earns it: a place
// generator missing from a folder that IS there still fails the first test.
const PLACE_PRESENT = fs.existsSync(PLACE_DIR);
if (!PLACE_PRESENT) {
  console.log('# generator_load: the place assets folder is not at ' + PLACE_DIR
    + ' — checking the town entry points only (this is the expected shape under ENGINE_DIR=<scratch>)');
}

// The entry points, from the two lists engine_version.js keeps for the hash, plus
// the boarding generator's. Each is [absolute path, label].
const ENTRIES = [
  ...EV.ENGINE_FILES.map((f) => [path.join(ENGINE_DIR, f), f]),
  ...EV.BOARDING_ENGINE_FILES.map((f) => [path.join(ENGINE_DIR, f), f]),
  ...(PLACE_PRESENT ? EV.PLACE_ENGINE_FILES.map((f) => [path.join(PLACE_DIR, f), 'place/' + f]) : []),
];

// icons.js and lane_normals.js are in ENGINE_FILES because their BYTES belong in
// the hash, not because they are run: they are libraries the generators require.
// They must load; they are not expected to export main().
const LIBRARIES = new Set(['icons.js', 'lane_normals.js']);

test('every entry point in the engine hash loads without throwing', () => {
  for (const [abs, label] of ENTRIES) {
    assert.ok(fs.existsSync(abs), label + ' is in an ENGINE_FILES list but not on disk');
    assert.doesNotThrow(() => require(abs), label + ' throws while being loaded');
  }
});

test('every GENERATOR exports main(), so its body is behind require.main', () => {
  for (const [abs, label] of ENTRIES) {
    if (LIBRARIES.has(path.basename(abs))) continue;
    const m = require(abs);
    assert.strictEqual(typeof m.main, 'function',
      label + ' does not export main() — its body still runs at require time (OA-224 Tier 4.1)');
  }
});

test('requiring a generator draws NOTHING — the wrap is real, not decorative', () => {
  // The assertion above would pass for a file that exports main() AND still draws
  // at load. This is the one that says the body actually moved inside it: require
  // each generator with the cwd set to an empty directory and assert the directory
  // is still empty. A generator that drew would leave an .svg, or die looking for
  // routes.json — either way, not silence.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'genload-'));
  try {
    for (const [abs, label] of ENTRIES) {
      if (LIBRARIES.has(path.basename(abs))) continue;
      const script = 'require(' + JSON.stringify(abs) + ');';
      let out;
      try {
        out = execFileSync(process.execPath, ['-e', script],
          { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        assert.fail(label + ' did something at require time: ' + String(e.stderr || e.message).split('\n')[0]);
      }
      assert.strictEqual(out.trim(), '', label + ' printed at require time: ' + out.trim());
      assert.deepStrictEqual(fs.readdirSync(tmp), [], label + ' wrote a file at require time');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the derived population is every generator on disk, so none can hide', () => {
  // The check that stops this file rotting. Anything named gen_*.js or *_internal.js
  // in either assets folder is a generator; if it is not in one of the lists above,
  // nothing hashes it and nothing here loads it — which is precisely how
  // gen_boarding.js sat outside BOTH hashes until 2026-09-02.
  const isGenerator = (f) => /^gen_.*\.js$/.test(f) || /^(diagram|schematize)_internal\.js$/.test(f);
  const onDisk = [
    ...fs.readdirSync(ENGINE_DIR).filter(isGenerator).map((f) => f),
    ...(PLACE_PRESENT ? fs.readdirSync(PLACE_DIR).filter(isGenerator).map((f) => 'place/' + f) : []),
  ].sort();
  const listed = ENTRIES.map(([, label]) => label).filter((l) => isGenerator(path.basename(l))).sort();
  assert.deepStrictEqual(onDisk, listed,
    'a generator on disk is in no ENGINE_FILES list (or a list names one that is gone)');
});
