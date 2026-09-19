/*
 * asset_load.test.js — EVERY file in assets/ must load, and loading it must do nothing.
 *
 * WHY THIS EXISTS AND WHY IT IS SEPARATE FROM generator_load.test.js. That test asks the
 * cheapest question there is — does the file load — of the entry points in the engine hash,
 * which on 2026-09-14 was SEVEN files out of EIGHTY. The other seventy-three were outside
 * it, and the twenty-nine that were pure CLI scripts could not have been asked at all: with
 * no `require.main` guard and no `module.exports`, requiring one RAN it. OA-344 measured
 * that and put the guard on all of them; this file is the question, asked of the directory.
 *
 * THE SHAPE OF THE FAULT IT IS FOR. `gen_external_busway.js` gained a call to a helper it
 * never declared and threw at load for a whole day, through a re-vendor and a deploy, with
 * status.js PASS, every mutation caught and CI green in three repositories — because every
 * other gate asks *does the output still match*, and can only ask it of code some artefact
 * exercises. `rollout.js --apply` then threw for every town by the same mechanism. Both are
 * in the population below. The files most likely to be run by a person at a terminal rather
 * than by a gate were precisely the ones nothing loaded.
 *
 * WHAT A PASS HERE DOES NOT MEAN. That the script works. Only that it parses, that every
 * name it resolves at module level resolves, and that nothing at its top level runs. That
 * is the floor, and the floor was absent for 73 of 80 files.
 *
 * THE POPULATION IS DERIVED, NEVER TYPED — the same rule as the Python half's
 * test/python/test_module_load.py, and for the same reason: a typed population cannot
 * notice the file nobody added to it, which is exactly the file this test is for. It is the
 * DIRECTORY, and where git can be asked, the directory is held against `git ls-files` so
 * that an untracked scratch file cannot join the population and a tracked file cannot leave
 * it. Where git cannot be asked — a mutation run copies the engine to a scratch folder —
 * that half SKIPS LOUDLY rather than vanishing.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { ENGINE_DIR } = require('./_engine.js');
const { mainCheckoutTwin } = require('./_worktree.js');

const onDisk = fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js')).sort();

const PKG_DIR = path.join(__dirname, '..');

// The dependencies this package DECLARES. Read, never typed — see the census's own rule.
function declaredDependencies() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
  return Object.keys(pkg.dependencies || {}).sort();
}

// Where a declared dependency may be found, nearest first: this package's own install, then
// — when this checkout is a git WORKTREE and has none — the main checkout's install of the
// same package. `--git-common-dir` is the only thing that names the main checkout without
// assuming a layout; the package is then located at its own path relative to the repository
// root, so this stays correct if either tree is moved or renamed. Only directories that
// exist are returned, because NODE_PATH entries that do not are silently ignored and a
// silent ignore is how this went wrong in the first place.
function dependencySearchPath() {
  const twin = mainCheckoutTwin(PKG_DIR);
  return [path.join(PKG_DIR, 'node_modules'), twin && path.join(twin, 'node_modules')]
    .filter(Boolean)
    .filter((d) => fs.existsSync(d));
}

test('the population is the directory, and it is not empty', () => {
  // A misdirected ENGINE_DIR must read as a failure, not as eighty silent passes. This is
  // the assertion that stops the test measuring itself rather than the engine.
  assert.ok(onDisk.length > 10,
    'found only ' + onDisk.length + ' JavaScript file(s) in ' + ENGINE_DIR);
});

test('every .js in assets/ is tracked, and every tracked .js is in the population', () => {
  // The join. A directory listing alone would quietly absorb a scratch file somebody left
  // behind, and would say nothing about a tracked file the listing missed.
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '--', '*.js'],
      { cwd: ENGINE_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((s) => s.trim()).filter(Boolean).sort();
  } catch (e) {
    // Not a git working tree — this is the expected shape under ENGINE_DIR=<scratch>, which
    // is how tools/prove-red.js runs the suite. Say so; do not pass silently.
    console.log('# asset_load: ' + ENGINE_DIR + ' is not inside a git working tree'
      + ' — the tracked-versus-disk join did not run (this is the expected shape under'
      + ' ENGINE_DIR=<scratch>)');
    return;
  }
  assert.deepStrictEqual(onDisk, tracked,
    'assets/ and `git ls-files` disagree about which .js files exist');
});

test('every file in assets/ loads, prints nothing and writes nothing', () => {
  // ONE child process for the whole directory rather than eighty. Its cwd is an empty
  // directory, so a file that draws or writes at require time leaves evidence; its stdout
  // must stay empty, so a file that prints is caught; and it checkpoints the name it is
  // ABOUT to require to a file OUTSIDE that directory, so a process.exit() or a throw is
  // still attributed to the right file rather than just killing the run.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assetload-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'assetload-out-'));
  const marker = path.join(work, 'at.json');
  const runner = path.join(work, 'runner.js');
  fs.writeFileSync(runner, [
    'const fs = require("fs");',
    'const path = require("path");',
    'const DIR = process.argv[2], MARK = process.argv[3];',
    'const names = JSON.parse(process.argv[4]);',
    'const done = [];',
    'for (const n of names) {',
    '  fs.writeFileSync(MARK, JSON.stringify({ at: n, done }));',
    '  const m = require(path.join(DIR, n));',
    '  done.push({ n, exports: Object.keys(m || {}).length });',
    '}',
    'fs.writeFileSync(MARK, JSON.stringify({ at: null, done }));',
  ].join('\n'));

  // THE ENGINE UNDER TEST MAY BE A COPY; ITS DEPENDENCIES ARE STILL THE PACKAGE'S. Under
  // ENGINE_DIR=<scratch> — which is how tools/prove-red.js runs the suite — a file that
  // requires `sharp` would resolve nothing from a temp folder, and four files here do.
  // Without this the mutation run's own BASELINE would be red for a reason having nothing
  // to do with the engine, which is the shape this whole action is about.
  //
  // AND THE PACKAGE'S OWN node_modules IS NOT ALWAYS THERE (OA-344, 2026-09-19). A git
  // worktree has none — nothing is junctioned in, deliberately — and since OA-341 every
  // engine change is made in one. So this named a directory that did not exist, and the
  // census died on the first of the four saying `contact_sheet.js failed while being
  // loaded`: a sentence about the ENGINE, for a condition that is a property of the
  // CHECKOUT. The cost was not the wrong message. It made this suite permanently one-red
  // wherever engine work now happens, and tools/prove-red-asset-load.js could not run there
  // at all — its CONTROL failed, so four of its six cases reported NOT RED and the harness
  // that exists to prove this check can go red was itself dead in the water.
  //
  // The search is therefore the candidates that EXIST, and the main checkout is the second
  // of them: `--git-common-dir` names it, it is the same repository rather than a second
  // copy or a junction, and the package is taken at its own path relative to the repository
  // root rather than by a layout this file would then have to be right about. The fallback
  // is reached only when the worktree has no install of its own.
  const search = dependencySearchPath();
  // Said out loud, because "it resolved from somewhere" is the claim, and which somewhere is
  // the part a reader in a worktree needs to be able to see rather than infer.
  console.log('# asset_load: dependencies searched in ' + (search.join(', ') || '(nowhere)'));
  const env = Object.assign({}, process.env, {
    NODE_PATH: [...search, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  });

  // AND THE DECLARED DEPENDENCIES ARE ASKED FOR BEFORE THE CENSUS RUNS, so that a checkout
  // with no install anywhere fails saying WHICH dependency is missing rather than naming
  // whichever engine file happens to sort first. The list is READ from package.json and
  // never typed — a typed one cannot notice the dependency nobody added to it, which is
  // this suite's own rule about its population one level down.
  //
  // WHAT THIS MUST NOT DO is excuse a file requiring something the package never declared:
  // that is the busway fault the whole test exists for, and it stays a failure that names
  // the file. prove-red-asset-load.js case 7 is what says so, and case 8 says this check
  // is consulted at all.
  const missing = declaredDependencies().filter((dep) => {
    try { require.resolve(dep, { paths: search }); return false; } catch { return true; }
  });
  assert.deepStrictEqual(missing, [],
    'declared dependenc(ies) ' + missing.join(', ') + ' resolve from none of '
    + search.join(', ') + ' — this checkout has no install, so run `npm ci` in it. Nothing'
    + ' about this is a statement about the engine.');

  let failed = null;
  let out = '';
  try {
    out = execFileSync(process.execPath, [runner, ENGINE_DIR, marker, JSON.stringify(onDisk)],
      { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
  } catch (e) {
    failed = String(e.stderr || e.message).split('\n').filter(Boolean)[0] || 'no message';
  }
  const state = JSON.parse(fs.readFileSync(marker, 'utf8'));
  const left = fs.readdirSync(tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });

  assert.strictEqual(failed, null,
    (state.at || '(after the last file)') + ' failed while being loaded: ' + failed);
  assert.strictEqual(state.at, null,
    (state.at || '?') + ' ended the process while being loaded — it exited rather than threw');
  assert.strictEqual(out.trim(), '',
    'something in assets/ printed at require time, after ' + state.done.length + ' file(s): '
    + out.trim().split('\n')[0]);
  assert.deepStrictEqual(left, [],
    'something in assets/ wrote at require time: ' + left.join(', '));
  assert.strictEqual(state.done.length, onDisk.length,
    'only ' + state.done.length + ' of ' + onDisk.length + ' file(s) were loaded');

  // A file that loads but exports nothing is either a script whose body still runs on
  // require — the fault this action was about — or a file with no reason to be required.
  // Either way it is the shape that hides, so it is named rather than tolerated.
  const silent = state.done.filter((d) => d.exports === 0).map((d) => d.n);
  assert.deepStrictEqual(silent, [],
    'file(s) in assets/ export nothing: ' + silent.join(', '));
});
