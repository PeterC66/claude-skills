/*
 * satellite_assets_load.test.js — the satellite folders, bus-work/assets/ and tools/,
 * asked the question place_assets_load.test.js asks of the place skill, over a
 * population taken from the DIRECTORY rather than from any list.
 *
 * WHY THIS EXISTS. OA-323 item 3 (buses-data, 2026-09-27) asked whether any derived
 * load population reaches past make-bus-leaflet's own edge into the other skills.
 * It did not. The satellites are held up by their prove-red harnesses, and a harness
 * imports its SUBJECT — so a module no harness happens to import is loaded by
 * nothing in CI. Measured that morning, by static import closure from every
 * prove-red-*.mjs, 4 of the 39 non-harness .mjs were reached by no harness at all:
 *
 *     bus-work/assets/local_decisions.mjs   imported only by worklist.mjs
 *     bus-work/assets/outbound_letter.mjs   imported only by worklist.mjs
 *     bus-work/assets/push-status.mjs       imported by nothing
 *     tools/lib/repo-root.mjs               imported only by the checkers, which CI runs
 *
 * and worklist.mjs itself — every scheduled tick's step 2 — is imported by no
 * harness either. A missing export or a ReferenceError at module scope in any of the
 * first three would have shipped green and been found by the next tick, which is
 * gen_external_busway.js's fault (a day of green gates over a file that threw at
 * load) in the one place the loop cannot recover from it.
 *
 * WHAT IT HOLDS, and it is the place test's contract, adapted to ES modules:
 *
 *   1. every .mjs in these folders PARSES (`node --check`);
 *   2. every file that is not declared to run at load is IMPORTED, in a child process
 *      with an empty cwd and no arguments, and must print nothing, write nothing and
 *      exit 0 — which links its imports, so a name one module asks another for and
 *      that module does not export goes red here;
 *   3. a file that runs its body at load is declared in RUNS_AT_LOAD with a reason,
 *      or the test goes red naming it;
 *   4. a declaration that has stopped being true — the file is gone, or it has gained
 *      a main-module guard — goes red too, so the list retires itself.
 *
 * WHAT IT DOES NOT: a line inside main() is not reached by an import, and the files
 * in RUNS_AT_LOAD get the parse and nothing more. worklist.mjs is one of them; its
 * import graph is loaded here all the same, because every module it imports is a
 * library and is imported on its own.
 *
 * OA-323 item 4 (2026-09-27) added audit-map-tailoring/assets/ and
 * review-bus-codebases/assets/, whose scripts no harness imports at all. Adding
 * them went red naming exactly their eight scripts as undeclared, which is the
 * question asked; the eight are declared below and lib.mjs is imported.
 *
 * THE HARNESSES ARE OUT OF THE POPULATION BY NAME, and that is a scope, not a gap:
 * a prove-red-*.mjs is a script by design and each is run by its own CI step.
 *
 * THE SKILLS ROOT IS FOUND FROM THIS FILE, not from ENGINE_DIR: a mutation run
 * points ENGINE_DIR at a scratch copy of the town assets, beside which the satellites
 * are not. A missing FOLDER skips loudly; a missing file never does.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const SKILLS = path.resolve(__dirname, '..', '..');
const FOLDERS = ['bus-work/assets', 'tools', 'tools/lib', 'audit-map-tailoring/assets', 'review-bus-codebases/assets'];

const present = FOLDERS.filter((d) => fs.existsSync(path.join(SKILLS, d)));
for (const d of FOLDERS) {
  if (!present.includes(d)) {
    console.log('# satellite_assets_load: ' + d + ' is not at ' + path.join(SKILLS, d) + ' — nothing to check there');
  }
}

const ALL = present.flatMap((d) => fs.readdirSync(path.join(SKILLS, d))
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => d + '/' + f)).sort();
const HARNESSES = ALL.filter((f) => /^prove-red-/.test(path.basename(f)));
const MJS = ALL.filter((f) => !HARNESSES.includes(f));
const SRC = new Map(MJS.map((f) => [f, fs.readFileSync(path.join(SKILLS, f), 'utf8')]));

/** Source with block and line comments removed, so a file that DESCRIBES the guard
 *  idiom — engine_adoption.mjs's header does — is not read as having one. The line
 *  half only strips `//` at the start of a line or after whitespace, so a URL in a
 *  string survives. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

// The main-module guard, in every spelling these folders use: each compares
// process.argv[1] with this module's own URL or path, on one line.
const GUARD = /process\.argv\[1\][^\n]*import\.meta\.url|import\.meta\.url[^\n]*process\.argv\[1\]/;
const GUARDED = MJS.filter((f) => GUARD.test(stripComments(SRC.get(f))));

// THE SCRIPTS THAT ACT AT LOAD, one reason each. Importing one would run it, so it
// gets the parse and nothing more; giving it the guard moves it into the import test
// by itself, and the last test below then asks for this entry to be deleted.
const RUNS_AT_LOAD = new Map([
  ['bus-work/assets/worklist.mjs', 'the board: reads the portal and every repository at load'],
  ['bus-work/assets/push-status.mjs', 'writes status-snapshot.json into the portal data folder'],
  ['bus-work/assets/refresh_review.mjs', 'records a verdict into an ink-review file'],
  ['bus-work/assets/town_status.mjs', 'reads a town folder named on its command line'],
  ['tools/check-doc-acronyms.mjs', 'a checker: walks the enclosing repository at load'],
  ['tools/check-doc-links.mjs', 'a checker: walks the enclosing repository at load'],
  ['tools/check-exclusion-fields.mjs', 'a checker: walks the enclosing repository at load'],
  ['tools/check-file-hygiene.mjs', 'a checker: walks the enclosing repository at load'],
  ['tools/check-s6-claims.mjs', 'a checker: walks the enclosing repository at load'],
  ['tools/check-tables.mjs', 'a checker: walks the enclosing repository at load'],
  ['audit-map-tailoring/assets/compare_drafts.mjs', 'compares a scratch draft tree named on its command line with the estate'],
  ['audit-map-tailoring/assets/draft_places.mjs', 're-drafts every place into a scratch root named on its command line'],
  ['audit-map-tailoring/assets/draft_towns.mjs', 're-drafts every town into a scratch root named on its command line'],
  ['audit-map-tailoring/assets/history.mjs', 'reads every S3 run in the estate and prints them by cause'],
  ['audit-map-tailoring/assets/inventory.mjs', 'walks the estate and prints the tailoring inventory'],
  ['audit-map-tailoring/assets/places.mjs', 'walks the estate\'s places and prints the drafted-against-shipped table'],
  ['audit-map-tailoring/assets/portal_query.mjs', 'prints the one read-only command Peter runs against the live portal'],
  ['review-bus-codebases/assets/test-measure.mjs', 'the measurer\'s test: builds scratch git repositories and asserts at load, run by its own CI step (test:measure)'],
]);

const IMPORTABLE = MJS.filter((f) => !RUNS_AT_LOAD.has(f));

test('the population is these folders on disk, and it is not empty', () => {
  if (!present.length) return;
  // A floor, not today's count: 31 importable and 49 in all on 2026-09-27, after
  // OA-323 item 4 added two folders. Falling below it means files left the
  // population, which is the direction that hides.
  assert.ok(MJS.length >= 49, 'expected at least 49 satellite .mjs, got ' + MJS.length + ': ' + MJS.join(', '));
  assert.ok(IMPORTABLE.length >= 31,
    'fewer satellite modules can be imported than on 2026-09-27 (31) — this has gone backwards. Got: ' + IMPORTABLE.join(', '));
});

test('every satellite .mjs parses', () => {
  for (const f of MJS) {
    try {
      execFileSync(process.execPath, ['--check', path.join(SKILLS, f)], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      assert.fail(f + ' does not parse: ' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' '));
    }
  }
});

test('every satellite module is importable or declared to run at load', () => {
  // Classified by source, not by trying it: importing an unguarded script RUNS it,
  // and push-status.mjs would write into the portal. So the undeclared file this
  // catches is one whose top level calls something — the shape of every script here.
  const TOP_LEVEL_CALL = /^(?:await\s+)?[A-Za-z_$][\w$.]*\s*\(/m;
  const undeclared = IMPORTABLE.filter((f) => !GUARDED.includes(f)
    && TOP_LEVEL_CALL.test(stripComments(SRC.get(f)).replace(/`[\s\S]*?`/g, '``')));
  assert.deepStrictEqual(undeclared, [],
    'these satellite modules call something at their top level and are declared nowhere: ' + undeclared.join(', ')
    + '. Put the body behind a main-module guard — `if (process.argv[1] && path.resolve(process.argv[1]) === '
    + 'fileURLToPath(import.meta.url)) main();`, the spelling doc_triage.mjs uses — or add it to RUNS_AT_LOAD with the reason.');
});

test('everything that CAN be imported is imported, and does nothing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satload-'));
  try {
    for (const f of IMPORTABLE) {
      const url = pathToFileURL(path.join(SKILLS, f)).href;
      let out;
      try {
        out = execFileSync(process.execPath, ['--input-type=module', '-e', 'await import(' + JSON.stringify(url) + ');'],
          { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
      } catch (e) {
        assert.fail(f + ' failed when imported: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 4).join(' '));
      }
      assert.strictEqual(out.trim(), '', f + ' printed when imported: ' + out.trim());
      assert.deepStrictEqual(fs.readdirSync(tmp), [], f + ' wrote a file when imported');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('every RUNS_AT_LOAD entry is still earned, so the list retires itself', () => {
  if (!present.length) return;
  for (const [f, why] of RUNS_AT_LOAD) {
    if (!present.includes(path.dirname(f))) continue;
    assert.ok(MJS.includes(f), f + ' is declared to run at load and is not on disk any more. Delete its entry. (' + why + ')');
    assert.ok(!GUARDED.includes(f),
      f + ' has a main-module guard now, so it can be imported. Delete its RUNS_AT_LOAD entry and let the import test run over it. (' + why + ')');
  }
});
