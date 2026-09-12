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
 * WHY THE DARK FILES WERE DARK, and it was structural rather than an oversight.
 * generator_load.test.js can require a town generator only because OA-224 Tier 4.1
 * put every generator's body behind `if (require.main === module)`. That round
 * reached this folder's two GENERATORS and stopped there. The other eight .js files
 * were top-to-bottom scripts that read their inputs and act at load, so `require()`
 * would run them — the cheapest check in the estate was not available to them, which
 * is exactly the state gen_external_busway.js was in when it threw at load for a day
 * through a re-vendor and a deploy with every gate green.
 *
 * TIER 4.1 REACHED THIS SKILL ON 2026-09-12 (OA-323 item 1) AND THE INVENTORY IS
 * NOW EMPTY. Seven of the eight took the town idiom — body inside `function main()`,
 * `if (require.main === module) main();`, nothing re-indented, so the diff reads as a
 * scope being added — and the eighth, place_engine.js, turned out to need no guard at
 * all: it is a library with no body, which is a THIRD category this file did not have
 * and which its GUARD regex read as "runs at load". All ten .js in the folder are now
 * required, in a child process with an empty cwd, and every one of them prints
 * nothing and writes nothing. What that buys is stated in the next paragraph and is
 * not the whole busway fault: a ReferenceError at module scope is caught by a require
 * and not by a parse, so the load half is the strong question and the parse half
 * stays for whatever can only be parsed.
 *
 * WHAT THIS TEST THEREFORE CLAIMS, AND WHAT IT DOES NOT. Parse alone does not catch
 * the busway fault: a ReferenceError at module scope parses perfectly, and
 * `node --check` would have called that file healthy. Overstating that is the failure
 * this estate has named as a check that reports on a predicate it never evaluated.
 * Since every .js here is now loaded as well as parsed, the busway fault IS caught
 * for this folder — but only for what a bare `require()` reaches, which is module
 * scope and not a line inside main(). What it holds:
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
 * THE RE-VENDOR THIS ROUND WAS EXPECTED TO OWE, IT DOES NOT OWE, and that was
 * measured rather than assumed: engine/place/ in the portal holds three files, and
 * the eight are not among them — only gen_internal_place.js and gen_external_places.js
 * are vendored, and neither moved. Nor are any of the eight in engine_version.js's
 * place closure, so no map's engine stamp moves and nothing goes stale. OA-321 and
 * OA-322 still owe theirs; this item did not, once somebody read vendored.json
 * instead of the sentence that grouped all three together.
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

// THE THIRD CATEGORY, and the one this file did not have on the day it was written:
// a LIBRARY. place_engine.js has no body to guard — it resolves the town engine and
// exports — so the guard regex read it as "runs at load" and its NOT_REQUIRE_TESTABLE
// entry said "evaluates its tables at load", which is true and was never a reason it
// could not be required. Requiring it IS the check.
//
// This list is hand-written where the other two are derived, so say what stops it
// rotting: declaring a file here does not excuse it, it CONSCRIPTS it — the load test
// below requires every member, so a "library" that grows a body prints or writes or
// throws and goes red on the spot. The failure direction is closed, which is the
// opposite of NOT_REQUIRE_TESTABLE, where an entry that stops being true has to be
// caught by an assertion written for that purpose.
const PURE_MODULES = new Set(['place_engine.js']);
const REQUIRE_TESTABLE = JS.filter((f) => GUARDED.includes(f) || PURE_MODULES.has(f));

// THE INVENTORY OF WHAT IS STILL DARK, one line of reason each. This is the
// load-bearing half of the file: it is what makes a new unguarded script fail
// rather than join a silent majority, and it is the list whoever does Tier 4.1 for
// this skill deletes from as they go.
// IT IS EMPTY AS OF 2026-09-12, which is what OA-323 item 1 was for, and an empty
// map here is NOT this test going quiet: the assertion that bites for a new file is
// `undeclared` below, whose population is the folder, and it is unaffected by this
// map being empty. What an empty map does cost is the exemption test's own
// population, so that test states it rather than passing over nothing.
const NOT_REQUIRE_TESTABLE = new Map([]);

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
  const undeclared = RUNS_AT_LOAD.filter((f) => !NOT_REQUIRE_TESTABLE.has(f) && !PURE_MODULES.has(f));
  assert.deepStrictEqual(undeclared, [],
    'these place assets run their body at load and are excused nowhere: ' + undeclared.join(', ')
    + '. Either put the body behind `if (require.main === module)` so it can be loaded '
    + '(the idiom the other seven took under OA-323: body inside function main(), nothing '
    + 're-indented), or declare it in PURE_MODULES if it is a library with no body, '
    + 'or add it to NOT_REQUIRE_TESTABLE with the reason.');
});

test('everything that CAN be required is required, and draws nothing', () => {
  // Requiring in a child process with an empty cwd is generator_load.test.js's third
  // test, and the reason this file does it too is the automatic case: the day one of
  // the eight gains its guard it joins GUARDED by itself and is load-tested here
  // without anybody adding a line.
  if (!PLACE_PRESENT) return;
  // The floor moved from 2 to 9 on 2026-09-12 and it is a RATCHET, not a count of
  // today's folder: nine is the two generators plus the seven OA-323 guarded, and
  // a tenth (place_engine.js) arrives through PURE_MODULES. A file deleted from the
  // folder drops it below and says so, which is the direction that matters — going
  // backwards on Tier 4.1 is exactly how the eight got dark in the first place.
  assert.ok(REQUIRE_TESTABLE.length >= 9,
    'fewer place assets can be loaded than on 2026-09-12, when OA-323 item 1 left nine behind '
    + 'the guard and one declared pure — this has gone backwards. Got: ' + REQUIRE_TESTABLE.join(', '));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'placeload-'));
  try {
    for (const f of REQUIRE_TESTABLE) {
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

test('every declaration is still earned, so Tier 4.1 retires its own entries', () => {
  // The control, and the half that earns the file. Without it NOT_REQUIRE_TESTABLE
  // excuses a file for ever — including one somebody has already fixed, and one that
  // has been deleted. Red in both directions, which is what page.test.js's own
  // exemption was held to the same week.
  if (!PLACE_PRESENT) return;
  // OA-323 emptied NOT_REQUIRE_TESTABLE, so the loop below now has no members and a
  // loop over nothing is green by arithmetic — the shape this file's own header
  // refuses elsewhere. The fix is not to forbid a future exemption (the `undeclared`
  // assertion above offers it in terms, and a file that genuinely cannot take the
  // guard should say so) but to widen this test to every DECLARATION, of which
  // PURE_MODULES is the one that is not empty. Both lists are hand-written; both
  // retire their own entries here.
  assert.ok(NOT_REQUIRE_TESTABLE.size + PURE_MODULES.size > 0,
    'both declaration lists are empty, so this test asserts nothing — if that is now '
    + 'the right state, delete it rather than leaving a test that cannot fail.');
  for (const f of PURE_MODULES) {
    assert.ok(JS.includes(f),
      f + ' is declared a pure module and is not in ' + PLACE_DIR + ' any more. Delete its '
      + 'PURE_MODULES entry — the declaration is stale.');
    assert.ok(!GUARDED.includes(f),
      f + ' is behind `if (require.main === module)` now, so it is a script with a body and '
      + 'not a library. Delete its PURE_MODULES entry; GUARDED already covers it.');
  }
  for (const [f, why] of NOT_REQUIRE_TESTABLE) {
    assert.ok(JS.includes(f),
      f + ' is excused here and is not in ' + PLACE_DIR + ' any more. Delete its NOT_REQUIRE_TESTABLE entry — '
      + 'the exemption is stale. (' + why + ')');
    assert.ok(!GUARDED.includes(f),
      f + ' is behind `if (require.main === module)` now, so it can be loaded. Delete its '
      + 'NOT_REQUIRE_TESTABLE entry and let the load test above run over it. (' + why + ')');
  }
});
