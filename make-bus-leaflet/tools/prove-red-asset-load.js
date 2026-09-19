#!/usr/bin/env node
/*
 * prove-red-asset-load.js — break `test/asset_load.test.js` on purpose and require it to
 * notice, because a green check that has never been seen to go red proves nothing.
 *
 *   node tools/prove-red-asset-load.js
 *
 * Run from `make-bus-leaflet/`. No arguments. Touches nothing outside a scratch folder: it
 * copies assets/ into a scratch tree, makes that tree a git index of its own so the
 * tracked-versus-disk join can be exercised for real, and points the test at it with
 * ENGINE_DIR — the indirection test/_engine.js exists for.
 *
 * THE MUTATION HAS TO BE A LOAD FAILURE, NOT A BEHAVIOUR FAILURE. That is the one thing
 * OA-344 said to be careful about: a test that passes because the file merely EXISTS would
 * be this action repeating itself one level up. Case 1 is therefore the busway fault
 * verbatim — an undeclared identifier at module scope — and the file it is planted in is
 * one no map and no gate exercises, which is the whole population this test was widened to
 * cover.
 *
 * THE CASES, each reverted before the next:
 *   1. an undeclared identifier at module scope     -> RED, and NAMES the file
 *   2. the require.main guard removed from a script -> RED, it runs at load
 *   3. a process.exit(0) at module scope            -> RED, and says it exited rather than threw
 *   4. a file that exports nothing                  -> RED, and names it
 *   5. an untracked .js dropped into the directory  -> RED, disk and git disagree
 *   6. an UNDECLARED module required by an engine file -> RED, and NAMES the file
 *   7. a DECLARED dependency that cannot resolve    -> RED, and names the DEPENDENCY
 *   8. the control, unmutated                       -> GREEN
 *
 * CASE 3 IS NOT A DUPLICATE OF CASE 1. A throw and an exit reach the runner differently: a
 * file that exits takes the whole child process with it, which without the checkpoint the
 * test writes would be an unattributable failure naming no file at all.
 *
 * CASES 6 AND 7 ARE THE TWO HALVES OF ONE CHANGE (OA-344, 2026-09-19) and neither stands
 * for the other. The test now tolerates the package's install living somewhere other than
 * beside it, because a git worktree has no node_modules and every engine change is made in
 * one — before that, this harness could not run there at all: its CONTROL failed and four
 * of its six cases reported NOT RED. The risk any such tolerance carries is that it starts
 * EXCUSING a file that requires something the package never declared, which is the busway
 * fault this whole test is for; case 6 is that fault as a missing MODULE rather than case
 * 1's missing identifier, and it must still name the file. Case 7 is the other direction —
 * it proves the declared-dependency check is consulted at all, rather than being a block of
 * code that happens never to fire — and it is the only case here that mutates package.json
 * rather than the engine copy, so it is written with its own revert.
 *
 * BOTH DISCRIMINATE ON EVERY MACHINE, which is the property that was missing from the guard
 * they replace. A case that only goes red in a worktree would be green for ever on the
 * laptop where `npm test` is usually run — this estate's own *the number that was already
 * true*, and exactly what OA-342 found under build_s4.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scratchDir } = require('../assets/scratch');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const TEST = 'test/asset_load.test.js';

const WORK = scratchDir('prove-red-asset-load-');
const ENGINE = path.join(WORK, 'engine');
fs.cpSync(ASSETS, ENGINE, { recursive: true });

// A git index of its own, so case 5 is a real disagreement between `git ls-files` and the
// directory rather than a simulated one. No commit is needed and none is made, so this
// asks nothing of a git identity that CI may not have.
const git = (...args) => spawnSync('git', args, { cwd: ENGINE, encoding: 'utf8' });
const HAVE_GIT = git('init', '-q').status === 0 && git('add', '-A').status === 0;
if (!HAVE_GIT) {
  console.log('prove-red-asset-load: could not make a git index in the scratch tree'
    + ' — case 5 (the tracked-versus-disk join) WILL NOT RUN');
}

const run = () => {
  const r = spawnSync(process.execPath, ['--test', TEST],
    { cwd: SK, encoding: 'utf8', timeout: 900000, env: { ...process.env, ENGINE_DIR: ENGINE } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

let bad = 0;
const verdict = (label, r, expect) => {
  const red = r.code !== 0;
  const named = expect.test(r.out);
  if (red && named) { console.log('  RED   ' + label); return; }
  bad++;
  console.log('  ----  ' + label + '   NOT RED (exit ' + r.code
    + ', the expected message was ' + (named ? 'present' : 'ABSENT') + ')');
};

const edit = (name, mutate) => {
  const f = path.join(ENGINE, name);
  const orig = fs.readFileSync(f, 'utf8');
  const next = mutate(orig);
  if (next === orig) {
    bad++;
    console.log('  ----  the mutation matched nothing in ' + name
      + ' — the case did not run, which is not the same as passing');
    return null;
  }
  fs.writeFileSync(f, next);
  return () => fs.writeFileSync(f, orig);
};

console.log('\nprove-red-asset-load — ' + ENGINE + '\n');

// 1. The busway fault, verbatim, in a file no map and no gate exercises.
let undo = edit('stray_outputs.js', (s) => s.replace("const fs = require('fs');",
  "const fs = require('fs');\nconst DIRNAMES = _undeclaredHelper();"));
if (undo) { verdict('an undeclared identifier at module scope', run(), /stray_outputs\.js failed while being loaded/); undo(); }

// 2. A script whose body runs at require time again.
undo = edit('refresh_latest.js', (s) => s.replace('if (require.main === module) main();', 'main();'));
if (undo) { verdict('the require.main guard removed from a script', run(), /printed at require time|failed while being loaded|wrote at require time/); undo(); }

// 3. A file that exits rather than throws.
undo = edit('stray_outputs.js', (s) => s.replace("const fs = require('fs');",
  "const fs = require('fs');\nprocess.exit(0);"));
if (undo) { verdict('a process.exit(0) at module scope', run(), /ended the process while being loaded/); undo(); }

// 4. A file that loads but offers nothing — the shape a half-done guard leaves behind.
undo = edit('scratch.js', (s) => s.replace(/module\.exports\s*=/, 'const _unused ='));
if (undo) { verdict('a file that exports nothing', run(), /export nothing/); undo(); }

// 5. An untracked file joining the population.
if (HAVE_GIT) {
  const stray = path.join(ENGINE, 'zz_untracked_probe.js');
  fs.writeFileSync(stray, 'module.exports = {};\n');
  verdict('an untracked .js joining the population', run(), /disagree about which \.js files exist/);
  fs.rmSync(stray);
}

// 6. An engine file requiring a module the package never declared. This is the fault case 1
//    is about, arriving as a missing MODULE rather than a missing identifier — and it is the
//    one the dependency tolerance could plausibly swallow, so it has to name the file.
undo = edit('stray_outputs.js', (s) => s.replace("const fs = require('fs');",
  "const fs = require('fs');\nconst _nope = require('oa344-not-a-declared-dependency');"));
if (undo) { verdict('an undeclared MODULE required by an engine file', run(), /stray_outputs\.js failed while being loaded/); undo(); }

// 7. A declared dependency that resolves from nowhere. The only mutation here that touches
//    package.json rather than the engine copy, so it carries its own revert: the harness
//    must not be able to leave a broken manifest behind if a case throws.
//    The insert is TEXTUAL rather than a JSON.parse/stringify round trip, so the manifest
//    on disk differs by the one line under test and by nothing else: a round trip would
//    silently restyle a file this harness has no business restyling, and the window it is
//    restyled in is a window another process could read it in.
const PKG = path.join(SK, 'package.json');
const pkgOrig = fs.readFileSync(PKG, 'utf8');
const pkgNext = pkgOrig.replace(/("dependencies"\s*:\s*\{)/,
  '$1\n    "oa344-never-installed": "^1.0.0",');
if (pkgNext === pkgOrig) {
  bad++;
  console.log('  ----  package.json has no "dependencies" block to mutate'
    + ' — the case did not run, which is not the same as passing');
} else {
  try {
    fs.writeFileSync(PKG, pkgNext);
    verdict('a DECLARED dependency that cannot resolve', run(), /oa344-never-installed/);
  } finally {
    fs.writeFileSync(PKG, pkgOrig);
  }
}

// 8. The control. Without it a harness cannot tell a broken checker from a clean tree.
const ctl = run();
if (ctl.code === 0) console.log('  GREEN the control — the unmutated copy still passes');
else {
  bad++;
  console.log('  ----  THE CONTROL FAILED — the scratch copy did not come back clean');
  console.log(ctl.out.split('\n').slice(0, 20).map((l) => '        ' + l).join('\n'));
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log('\n' + (bad ? bad + ' case(s) did not behave' : 'every case behaved') + '\n');
process.exit(bad ? 1 : 0);
