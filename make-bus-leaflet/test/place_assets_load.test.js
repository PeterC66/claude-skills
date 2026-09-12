/*
 * place_assets_load.test.js — the place skill's assets folder, asked the cheapest
 * question there is, over a population taken from the DIRECTORY rather than from
 * any list.
 *
 * WHY THIS EXISTS. OA-001's round of 2026-09-12 widened two hand-typed populations
 * (provenance_date.test.js, then page.test.js) so they could see the place skill at
 * all, and closed by asking a sharper question than the one it had answered: not
 * "is this population typed" but "can what it DERIVES FROM see both skills". Asked
 * of this folder on 2026-09-12, the answer is no, and the numbers are not close.
 *
 *     the place skill ships 14 assets (10 .js, 4 .py)
 *     engine_version.js's place closure reaches exactly 2 of them
 *     8 of the 14 are named in NO test and NO harness anywhere in the estate
 *
 * So every population derived from engine_version.js — which is the derivation the
 * two widenings above were fixed to use, and the one generator_load.test.js's header
 * recommends in terms — is blind to six sevenths of this folder. That is not those
 * tests being wrong: the hash lists exist to name what DRAWS a sheet, and a stage
 * tool does not. It is that nothing else was asking either.
 *
 * WHY THE DARK FILES ARE DARK, and it is structural rather than an oversight.
 * generator_load.test.js can require a town generator only because OA-224 Tier 4.1
 * put every generator's body behind `if (require.main === module)`. That round
 * reached this folder's two GENERATORS and stopped there. The other eight .js files
 * are top-to-bottom scripts that read their inputs and act at load, so `require()`
 * would run them — the cheapest check in the estate is not available to them, which
 * is exactly the state gen_external_busway.js was in when it threw at load for a day
 * through a re-vendor and a deploy with every gate green.
 *
 * WHAT THIS TEST THEREFORE CLAIMS, AND WHAT IT DOES NOT. It does not claim to catch
 * the busway fault in the eight: a ReferenceError at module scope parses perfectly,
 * and `node --check` would have called that file healthy. Overstating that is the
 * failure this estate has named as a check that reports on a predicate it never
 * evaluated. What it holds is narrower and still worth having:
 *
 *   1. no file can appear in this folder, or change category, unnoticed;
 *   2. every file at least PARSES — the strongest question available to a script
 *      that cannot be required, and the one nothing was asking;
 *   3. anything that CAN be required is required, in a child process with an empty
 *      cwd, and must draw nothing — so the day one of the eight gains its guard it
 *      is load-tested automatically rather than when somebody remembers;
 *   4. the exemption list is the inventory of what is still dark, with a reason
 *      each, and it retires itself in both directions.
 *
 * Fixing (3) for the eight properly — Tier 4.1 for this skill — is an assets/ change
 * and owes a portal re-vendor with `npm run track:engine` in the same commit, so it
 * is FILED rather than made here, for the same reason OA-321 and OA-322 were filed
 * the same week. A gate that is red on the day it lands is one somebody mutes in its
 * first week.
 *
 * THE PYTHON HALF IS OUT OF SCOPE HERE AND SAID SO RATHER THAN DROPPED. Four of the
 * fourteen are .py, and test/python/test_module_load.py derives its population from
 * the TOWN assets directory, so it cannot see them. Asking python from a node test
 * buys a second runner's problems; the gap is recorded in the filed action instead.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ENGINE_DIR, load } = require('./_engine');

const EV = load('engine_version.js');
const PLACE_DIR = EV.placeAssetsDir(ENGINE_DIR);

// THE PLACE HALF SKIPS LOUDLY, IT DOES NOT VANISH — the idiom generator_load.test.js
// and page.test.js already use. A mutation run copies the TOWN assets to a scratch
// folder and points ENGINE_DIR at it; the place skill is not beside them there. Only
// a whole missing FOLDER earns the skip, because a silent filter is also how a
// deleted file stops being checked without anyone noticing.
const PLACE_PRESENT = fs.existsSync(PLACE_DIR);
if (!PLACE_PRESENT) {
  console.log('# place_assets_load: the place assets folder is not at ' + PLACE_DIR
    + ' — nothing to check (the expected shape under ENGINE_DIR=<scratch>)');
}

const JS = PLACE_PRESENT
  ? fs.readdirSync(PLACE_DIR).filter((f) => f.endsWith('.js')).sort()
  : [];
const PY = PLACE_PRESENT
  ? fs.readdirSync(PLACE_DIR).filter((f) => f.endsWith('.py')).sort()
  : [];

/** Source with block and line comments removed. A file's prose quotes the guard
 *  idiom on purpose — generator_load.test.js's own header does — so a classifier
 *  that read comments would put a file in the wrong group for describing one. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const SRC = new Map();
for (const f of JS) SRC.set(f, fs.readFileSync(path.join(PLACE_DIR, f), 'utf8'));

// CLASSIFIED BY BEHAVIOUR, NOT BY NAME. A file is require-testable when its body is
// behind the Tier 4.1 guard; it is not when it acts at load. Nobody maintains this
// split — the file's own source decides it, so a script that gains a guard moves
// group by itself and the assertion that used to excuse it goes red.
const GUARD = /require\s*\.\s*main\s*===\s*module|module\s*===\s*require\s*\.\s*main/;
const GUARDED = JS.filter((f) => GUARD.test(stripComments(SRC.get(f))));
const RUNS_AT_LOAD = JS.filter((f) => !GUARD.test(stripComments(SRC.get(f))));

// THE INVENTORY OF WHAT IS STILL DARK, one line of reason each. This is the
// load-bearing half of the file: it is what makes a new unguarded script fail
// rather than join a silent majority, and it is the list whoever does Tier 4.1 for
// this skill deletes from as they go.
const NOT_REQUIRE_TESTABLE = new Map([
  ['aggregate_destinations.js', 'a P2 stage tool — reads the place folder and writes destinations at load'],
  ['build_internal_place.js', 'a P4 driver — spawns the town gen_internal.js against the place folder at load'],
  ['build_internal_place_roads.js', 'a P4 driver — spawns the road chain at load'],
  ['derive_frequency.js', 'a P3 tool; spawned against fixtures by derive_frequency.test.js, which is the idiom for this group'],
  ['derive_termini.js', 'a P3 tool — reads routes.json and writes termini at load'],
  ['derive_walkshed.js', 'a P2 tool — reads osm.json and writes the walkshed at load'],
  ['place_engine.js', 'the place stage helper — evaluates its tables at load'],
  ['place_verified_services.js', 'a P1 tool — writes verified-services.json into the cwd at load'],
]);

test('the population is this folder on disk, and it is not empty', () => {
  // A suite whose population is empty is green by arithmetic — the assertion
  // test_module_load.py was given for the same reason.
  if (!PLACE_PRESENT) return;
  assert.ok(JS.length >= 10,
    'expected at least the ten .js assets the place skill ships, got ' + JS.length + ': ' + JS.join(', '));
  assert.ok(PY.length >= 4,
    'expected at least the four .py assets the place skill ships, got ' + PY.length + ': ' + PY.join(', '));
});

test('this population is a SUPERSET of the one engine_version.js can see', () => {
  // The assertion that states the finding, and it cannot rot in either direction.
  // If the hash lists ever grow to cover this folder, this still passes; if a hashed
  // place entry point vanishes from the folder, it goes red and says so.
  if (!PLACE_PRESENT) return;
  for (const f of EV.PLACE_ENGINE_FILES) {
    assert.ok(JS.includes(f),
      f + ' is a hashed place entry point and is not in ' + PLACE_DIR + ' — the hash names a file that is gone.');
  }
  assert.ok(JS.length > EV.PLACE_ENGINE_FILES.length,
    'this folder holds no asset beyond the hashed entry points, so this test adds nothing — '
    + 'if that is now true, say so here rather than leaving an assertion that cannot fail.');
});

test('every .js in the place skill parses', () => {
  // The strongest question available to the eight, and nothing was asking it. It is
  // deliberately NOT sold as a load check: a ReferenceError at module scope parses.
  if (!PLACE_PRESENT) return;
  for (const f of JS) {
    const abs = path.join(PLACE_DIR, f);
    try {
      execFileSync(process.execPath, ['--check', abs], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      assert.fail('place/' + f + ' does not parse: ' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' '));
    }
  }
});

test('every place asset is either require-testable or has a written reason it is not', () => {
  // A new script dropped into this folder belongs to one group or the other, and
  // joining the dark one is a decision somebody writes down. Without this, the
  // default for a new file is silence — which is how this folder got to eight.
  if (!PLACE_PRESENT) return;
  const undeclared = RUNS_AT_LOAD.filter((f) => !NOT_REQUIRE_TESTABLE.has(f));
  assert.deepStrictEqual(undeclared, [],
    'these place assets run their body at load and are excused nowhere: ' + undeclared.join(', ')
    + '. Either put the body behind `if (require.main === module)` so it can be loaded, '
    + 'or add it to NOT_REQUIRE_TESTABLE with the reason.');
});

test('everything that CAN be required is required, and draws nothing', () => {
  // Requiring in a child process with an empty cwd is generator_load.test.js's third
  // test, and the reason this file does it too is the automatic case: the day one of
  // the eight gains its guard it joins GUARDED by itself and is load-tested here
  // without anybody adding a line.
  if (!PLACE_PRESENT) return;
  assert.ok(GUARDED.length >= 2,
    'no place asset is behind the Tier 4.1 guard — the two generators were, so this has gone backwards. Got: '
    + GUARDED.join(', '));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'placeload-'));
  try {
    for (const f of GUARDED) {
      const abs = path.join(PLACE_DIR, f);
      const script = 'require(' + JSON.stringify(abs) + ');';
      let out;
      try {
        out = execFileSync(process.execPath, ['-e', script],
          { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        assert.fail('place/' + f + ' did something at require time: '
          + String(e.stderr || e.message).split('\n')[0]);
      }
      assert.strictEqual(out.trim(), '', 'place/' + f + ' printed at require time: ' + out.trim());
      assert.deepStrictEqual(fs.readdirSync(tmp), [], 'place/' + f + ' wrote a file at require time');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('every exemption is still earned, so Tier 4.1 retires its own entries', () => {
  // The control, and the half that earns the file. Without it NOT_REQUIRE_TESTABLE
  // excuses a file for ever — including one somebody has already fixed, and one that
  // has been deleted. Red in both directions, which is what page.test.js's own
  // exemption was held to the same week.
  if (!PLACE_PRESENT) return;
  for (const [f, why] of NOT_REQUIRE_TESTABLE) {
    assert.ok(JS.includes(f),
      f + ' is excused here and is not in ' + PLACE_DIR + ' any more. Delete its NOT_REQUIRE_TESTABLE entry — '
      + 'the exemption is stale. (' + why + ')');
    assert.ok(!GUARDED.includes(f),
      f + ' is behind `if (require.main === module)` now, so it can be loaded. Delete its '
      + 'NOT_REQUIRE_TESTABLE entry and let the load test above run over it. (' + why + ')');
  }
});
