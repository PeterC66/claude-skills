/*
 * engine_indirection.test.js — every suite loads its subject through _engine.js.
 *
 * THE FAULT THIS EXISTS FOR HAS ALREADY HAPPENED, TWICE OVER. `seed_prev_s4`'s
 * first draft required `../assets/` directly and BOTH of its prove-red mutations
 * survived (test/README.md records it): a suite that resolves its own path never
 * sees the harness's scratch copy, so it is green about code it never ran. The
 * rule has been written in `_engine.js` and in the README ever since — and
 * nothing enforced it, so on 2026-09-01 the codebase review counted 22 of 44
 * suites bypassing it. Measured on 2026-09-03 the count was mostly the HARNESS
 * (`scratch`), but three suites really did load a subject directly.
 *
 * A written convention with no check is a claim about a JOIN, and only the JOIN
 * can test it. Two questions, and they fail in opposite directions:
 *
 *   1. THE CLOSED CENSUS. No file under test/ may `require('../assets/…')` except
 *      the modules named in HARNESS below, each with its reason. A new suite that
 *      reaches straight into assets/ is red here, at `npm test` speed, rather
 *      than as a SURVIVED mutation somebody has to debug six weeks later.
 *
 *   2. THE JOIN WITH prove-red.js. For every mutation, the suite that is supposed
 *      to object must not load the mutated file directly. This is the sharper of
 *      the two: it is possible to satisfy the census and still write a mutation
 *      against a file whose suite reads it some other way.
 *
 * WHY NOT PUT THIS IN prove-red.js. It would run there, but only in the slow job,
 * and it would report the fault as SURVIVED — the verdict that means "the test did
 * not notice", which is precisely the wrong diagnosis when the truth is "the test
 * was never shown the mutation". A separate check names the cause.
 *
 * It is SOURCE-LEVEL, like cli.test.js: requiring a suite runs it, so the only way
 * to ask how it loads its subject is to read it. Falsified by
 * tools/prove-red-engine-indirection.js.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DIR = __dirname;
const PROVE_RED = path.join(TEST_DIR, '..', 'tools', 'prove-red.js');

/* Modules that are the TEST HARNESS rather than anything under test. They are
 * required directly on purpose: a mutation run copies assets/ and mutates one
 * file in it, and the machinery that MAKES that scratch directory must be the
 * real one in every run, or a mutation to it would break the harness rather than
 * be caught by it. `scratch.test.js` is the exception that proves the rule — its
 * subject IS scratch.js, so it alone loads it through _engine.js. */
const HARNESS = {
  'scratch': 'the scratch-directory helper: infrastructure every suite uses to make temp dirs, never the subject except in scratch.test.js',
};

const files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.js')).sort();

/* A require of a path under assets/, anywhere in the file, INCLUDING INSIDE A
 * COMMENT — deliberately. A check that strips comments first is a check with a
 * parser bug waiting in it, and the cost of the blunt version is only that a file
 * may not quote the form it forbids: _engine.js does, and is exempted by name
 * below. This paragraph learned that the hard way — its first draft spelled the
 * pattern out and the check went red on itself, which is the cheapest possible
 * demonstration that it reads what it says it reads. */
const DIRECT = /require\(\s*'\.\.\/assets\/([A-Za-z0-9_./-]+?)'\s*\)/g;
/* THE SAME REACH, SPELLED WITH path.join (2026-09-05, buses-data OA-233). A new
 * suite loaded its subject by joining __dirname with '..', 'assets' and the file
 * name, and this census, which knew only the '../assets/' literal, passed it — the
 * exact bypass the paragraph above describes, in a spelling nobody had used
 * before. A census is only as closed as the forms it enumerates; this is the
 * second one. (Not spelled out here in full, for the reason the paragraph above
 * gives: this file may not quote the form it forbids.) It matches the REQUIRE of
 * such a path only: eleven suites build the same path to spawn stage.js or to
 * test that a file exists, which loads nothing into this process, and a census
 * that went red on all of them on its first day would have been muted by the
 * second. Whether a spawn should go through ENGINE_DIR too is a separate question
 * and this line does not answer it. */
const DIRECT_JOIN = /require\(\s*path\.join\(\s*__dirname\s*,\s*'\.\.'\s*,\s*'assets'\s*,\s*'([A-Za-z0-9_./-]+?)'\s*\)\s*\)/g;

const EXEMPT_FILES = new Set([
  '_engine.js',   // it documents the form it replaces, and it is the indirection
]);

test('no suite reaches into assets/ except for the named harness modules', () => {
  const offenders = [];
  for (const f of files) {
    if (EXEMPT_FILES.has(f)) continue;
    const src = fs.readFileSync(path.join(TEST_DIR, f), 'utf8');
    for (const m of src.matchAll(DIRECT)) {
      const mod = m[1].replace(/\.js$/, '');
      if (!(mod in HARNESS)) offenders.push(`${f} requires ../assets/${m[1]} directly`);
    }
    for (const m of src.matchAll(DIRECT_JOIN)) {
      const mod = m[1].replace(/\.js$/, '');
      if (!(mod in HARNESS)) offenders.push(`${f} reaches assets/${m[1]} through path.join(__dirname, '..', 'assets', …)`);
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.join('\n  ') +
    '\n  Load it with require(\'./_engine.js\').load(\'<file>.js\') so a prove-red scratch copy is what runs,' +
    '\n  or add it to HARNESS in this file with the reason it is infrastructure.');
});

test('every harness module named here is still required by somebody', () => {
  // The converse, and it is the half that rots: a HARNESS entry nothing imports
  // is a hole somebody opened and stopped using, and it would sit here granting
  // permission for ever. Same shape as the portal's env-inventory census.
  const all = files.map((f) => fs.readFileSync(path.join(TEST_DIR, f), 'utf8')).join('\n');
  const used = new Set([...all.matchAll(DIRECT)].map((m) => m[1].replace(/\.js$/, '')));
  for (const mod of Object.keys(HARNESS)) {
    assert.ok(used.has(mod), `HARNESS names '${mod}' and no test requires it — drop the entry`);
  }
});

test('no prove-red mutation targets a file its own suite loads directly', () => {
  // The JOIN. A mutation is applied to a copy of assets/ under ENGINE_DIR; a suite
  // that resolved its own path would run the REAL file, pass, and be reported as
  // SURVIVED — a hole in the suite, said about a mutation the suite never saw.
  const src = fs.readFileSync(PROVE_RED, 'utf8');
  const pairs = [...src.matchAll(/\{\s*suite:\s*'([^']+)'\s*,\s*file:\s*'([^']+)'/g)]
    .map((m) => ({ suite: m[1], file: m[2] }));
  assert.ok(pairs.length > 100, `expected prove-red.js's mutation table, parsed ${pairs.length} entries`);

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blind = [];
  for (const { suite, file } of pairs) {
    const p = path.join(TEST_DIR, suite);
    assert.ok(fs.existsSync(p), `prove-red.js names a suite that is not here: ${suite}`);
    const body = fs.readFileSync(p, 'utf8');
    const base = esc(file.replace(/\.js$/, ''));
    if (new RegExp("require\\(\\s*'\\.\\./assets/" + base + "(\\.js)?'\\s*\\)").test(body)) {
      blind.push(`${suite} loads its mutated subject ${file} directly, so that mutation cannot be seen`);
    }
  }
  assert.deepStrictEqual([...new Set(blind)], [], [...new Set(blind)].join('\n  '));
});
