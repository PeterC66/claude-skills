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
 *   6. the control, unmutated                       -> GREEN
 *
 * CASE 3 IS NOT A DUPLICATE OF CASE 1. A throw and an exit reach the runner differently: a
 * file that exits takes the whole child process with it, which without the checkpoint the
 * test writes would be an unattributable failure naming no file at all.
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

// 6. The control. Without it a harness cannot tell a broken checker from a clean tree.
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
