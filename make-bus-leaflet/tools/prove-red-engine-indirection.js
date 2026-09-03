#!/usr/bin/env node
/*
 * prove-red-engine-indirection.js — break `test/engine_indirection.test.js` on
 * purpose and require it to notice, because a green check that has never been
 * seen to go red proves nothing.
 *
 *   node tools/prove-red-engine-indirection.js
 *
 * Run from `make-bus-leaflet/`. No arguments.
 *
 * WHY IT NEEDS ITS OWN HARNESS RATHER THAN A ROW IN prove-red.js. That harness
 * mutates a copy of `assets/` and runs one suite against it through ENGINE_DIR.
 * This suite's subject is not in `assets/` at all — it is `test/` itself and
 * `tools/prove-red.js` — so there is nothing for a `prove-red.js` mutation to
 * break. The fixture here is therefore a copy of the TEST TREE, laid out with
 * `test/` and `tools/` in the same relative positions, because the suite resolves
 * `../tools/prove-red.js` from its own `__dirname`.
 *
 * THE CONTROL IS THE IMPORTANT HALF, and here it does something the other
 * harnesses do not have to: it asserts that the copied tree is the LIVE one, by
 * counting the suites and the mutation rows it can see. A fixture that had lost
 * `tools/prove-red.js` would make every mutation below pass for the wrong reason
 * — a check reading an empty population is green about everything.
 *
 * A CRASH IS NOT A RED. Each case asserts the node:test failure NAME, not merely
 * a non-zero exit, so a suite that threw while reading a broken fixture cannot be
 * counted as having caught the fault it was aimed at.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');

const SK = path.join(__dirname, '..');
const REAL_TEST = path.join(SK, 'test');
const REAL_PROVE_RED = path.join(SK, 'tools', 'prove-red.js');
const SUITE = 'engine_indirection.test.js';

const WORK = scratchDir('prove-red-engine-indirection-');
const FIX_TEST = path.join(WORK, 'test');
const FIX_TOOLS = path.join(WORK, 'tools');
fs.mkdirSync(FIX_TEST, { recursive: true });
fs.mkdirSync(FIX_TOOLS, { recursive: true });

/* Only the .js files, and flat: the suite reads `test/*.js` and one file under
 * `tools/`, and copying anything else would slow the run without being read. */
for (const f of fs.readdirSync(REAL_TEST)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(REAL_TEST, f), path.join(FIX_TEST, f));
}
fs.copyFileSync(REAL_PROVE_RED, path.join(FIX_TOOLS, 'prove-red.js'));

const snapshot = new Map();
for (const f of fs.readdirSync(FIX_TEST)) snapshot.set(path.join(FIX_TEST, f), fs.readFileSync(path.join(FIX_TEST, f)));
snapshot.set(path.join(FIX_TOOLS, 'prove-red.js'), fs.readFileSync(path.join(FIX_TOOLS, 'prove-red.js')));
const restore = () => { for (const [p, b] of snapshot) fs.writeFileSync(p, b); };

const run = () => {
  const r = spawnSync(process.execPath, ['--test', path.join(FIX_TEST, SUITE)],
    { encoding: 'utf8', cwd: WORK });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

let failures = 0;
const say = (ok, name, why) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ' — ' + why}`);
};

const edit = (p, from, to) => {
  const s = fs.readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`fixture anchor gone in ${path.basename(p)}: ${from.slice(0, 60)}`);
  fs.writeFileSync(p, s.replace(from, to));
};

console.log('prove-red-engine-indirection — the convention that had never been enforced\n');

/* ---- the control, and it counts its own population -------------------- */
console.log('control:');
{
  const r = run();
  say(r.code === 0, 'the real test tree passes', `exit ${r.code}: ${r.out.trim().slice(0, 400)}`);

  const suites = fs.readdirSync(FIX_TEST).filter((f) => f.endsWith('.test.js')).length;
  const rows = [...fs.readFileSync(path.join(FIX_TOOLS, 'prove-red.js'), 'utf8')
    .matchAll(/\{\s*suite:\s*'([^']+)'\s*,\s*file:\s*'([^']+)'/g)].length;
  say(suites > 40, 'the fixture holds the whole suite population', `only ${suites} test files copied`);
  say(rows > 100, 'the fixture holds the whole mutation table', `only ${rows} mutation rows readable`);
  console.log(`        (${suites} suites, ${rows} mutation rows)`);
}

/* ---- the mutations ----------------------------------------------------- */
const cases = [
  {
    name: 'a suite reaches straight into assets/',
    expect: /no suite reaches into assets\/ except for the named harness modules/,
    apply() {
      edit(path.join(FIX_TEST, 'labeller.test.js'),
        "'use strict';",
        "'use strict';\nconst SNEAK = require('../assets/labeller.js');");
    },
  },
  {
    name: 'a mutation is aimed at a file its own suite loads directly',
    expect: /no prove-red mutation targets a file its own suite loads directly/,
    apply() {
      // Both halves, because either alone is a different fault: the suite starts
      // loading its subject directly AND prove-red keeps a mutation against it.
      edit(path.join(FIX_TEST, 'labeller.test.js'),
        "'use strict';",
        "'use strict';\nconst SNEAK = require('../assets/labeller.js');");
      edit(path.join(FIX_TEST, SUITE),
        "const HARNESS = {",
        "const HARNESS = {\n  'labeller': 'DELIBERATELY WRONG, for prove-red-engine-indirection.js',");
    },
  },
  {
    name: 'a HARNESS entry nothing requires any more',
    expect: /every harness module named here is still required by somebody/,
    apply() {
      edit(path.join(FIX_TEST, SUITE),
        "const HARNESS = {",
        "const HARNESS = {\n  'no_such_module': 'a permission nobody uses',");
    },
  },
  {
    name: 'prove-red.js names a suite that is not there',
    expect: /names a suite that is not here: no_such\.test\.js/,
    apply() {
      const p = path.join(FIX_TOOLS, 'prove-red.js');
      const s = fs.readFileSync(p, 'utf8');
      const m = s.match(/\{\s*suite:\s*'[^']+'\s*,\s*file:\s*'[^']+'/);
      if (!m) throw new Error('fixture anchor gone: no mutation row to retarget');
      fs.writeFileSync(p, s.replace(m[0], "{ suite: 'no_such.test.js', file: 'projection.js'"));
    },
  },
  {
    name: 'the mutation table is unreadable, so the JOIN has nothing to join',
    expect: /expected prove-red\.js's mutation table, parsed 0 entries/,
    apply() {
      // The check that a check is looking at something. Without it, a rename in
      // prove-red.js's table would make case 2 green for ever.
      fs.writeFileSync(path.join(FIX_TOOLS, 'prove-red.js'), '// emptied on purpose\n');
    },
  },
];

console.log('\nmutations:');
for (const c of cases) {
  restore();
  c.apply();
  const r = run();
  restore();

  if (r.code === 0) { say(false, c.name, 'the suite stayed GREEN — this fault is not covered'); continue; }
  say(c.expect.test(r.out), c.name, `red, but for the wrong reason: ${r.out.trim().slice(0, 400)}`);
}

/* ---- and green again --------------------------------------------------- */
restore();
console.log('\ncontrol, repeated:');
{
  const r = run();
  say(r.code === 0, 'green again once every mutation is reverted', `exit ${r.code}: ${r.out.trim().slice(0, 400)}`);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log('');
if (failures) {
  console.error(`${failures} check${failures > 1 ? 's' : ''} failed — the indirection census is not proven.`);
  process.exit(1);
}
console.log(`${cases.length} mutations, each caught for its own reason; controls green before and after.`);
