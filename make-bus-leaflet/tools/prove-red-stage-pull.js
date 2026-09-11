#!/usr/bin/env node
/*
 * prove-red-stage-pull.js — falsify BOTH of `pull`'s rules about a file the
 * destination already holds.
 *
 * The two rules pull in opposite directions and each is the other's danger, which
 * is why they are falsified in one harness and never separately:
 *
 *   OA-164  an undeclared file may NOT clobber one already there. Its risk is that
 *           it refuses too much and a legitimate pull stops landing its own
 *           outputs, which would break every build on the estate as silently as
 *           the defect did.
 *   OA-318  ...unless the destination is holding a SUPERSEDED copy of a file a
 *           stage at or before this pull owns, which is refreshed. Its risk is the
 *           cheap reading — "copy it when it differs" — which is OA-164's defect
 *           back again, because a stray July `routes.json` differs too.
 *
 * So each mutation names EXACTLY the tests it must redden, and every other test in
 * the file must stay green. A run where everything goes red proves the harness
 * broke the file, not that a rule works; a mutation whose named tests have been
 * renamed away is caught by its own check, because a harness pointed at an
 * identifier it supplied itself cannot report that the identifier was wrong.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-stage-pull.js
 * No arguments, no placeholders.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'stage.js');
const TEST = path.join(ROOT, 'test', 'stage_pull.test.js');

const GUARD_164 = '    if (declared && !declared.has(name) && fs.existsSync(d)) { shadowed.push({ name, differs: !sameBytes(s, d) }); continue; }\n';
const REFRESH_318 = [
  '      if (owners.length) {',
  '        fs.copyFileSync(path.join(srcDir, sh.name), path.join(dest, sh.name));',
  '        refreshed.push(`${sh.name} (${owners.join(\',\')})`);',
  '      } else orphaned.push(sh.name);\n',
].join('\n');

const MUTATIONS = [
  {
    what: 'the OA-164 guard line cut out — copyInto overwrites everything again',
    find: GUARD_164,
    replace: '',
    mustFail: [
      'an undeclared file does not overwrite one the destination already holds',
      'the pull says which file it kept, because silence was the whole defect',
      // Nothing is shadowed any more, so there is nothing to report either.
      'the pull says which stale copy it refreshed, and names the stage that owns it',
      'a differing copy that NO stage declares is kept and named, because nothing here can say which is right',
    ],
  },
  {
    what: 'the OA-318 refresh cut out — every differing upstream copy is kept as it was',
    find: REFRESH_318,
    replace: '      orphaned.push(sh.name);\n',
    mustFail: [
      'a stale upstream copy is REFRESHED when the stage that owns it is at or before this pull',
      'the pull says which stale copy it refreshed, and names the stage that owns it',
    ],
  },
];

const src = fs.readFileSync(SRC, 'utf8');

// The copy goes in assets/, not a temp dir: stage.js has relative requires
// (./sheet_stamps, ./engine_version) and a copy anywhere else dies in the module
// loader before main() runs, turning every test red including the controls.
const copy = path.join(ROOT, 'assets', '.stage.prove-red-pull.js');
const cleanup = () => { try { fs.unlinkSync(copy); } catch (e) { } };
process.on('exit', cleanup);

function readVerdicts(out) {
  // Both reporter formats: `node --test` defaults to spec from Node 22 and to tap
  // before it. This laptop is on Node 24 and the CI runner is pinned to Node 20.
  const failed = new Set(), passed = new Set();
  for (const line of out.split('\n')) {
    const spec = line.match(/^\s*(✔|✖)\s+(.+?)\s+\(\d[\d.]*ms\)\s*$/);
    if (spec) { (spec[1] === '✖' ? failed : passed).add(spec[2].trim()); continue; }
    const tap = line.match(/^(not ok|ok) \d+ - (.+?)\s*$/);
    if (tap) (tap[1] === 'not ok' ? failed : passed).add(tap[2].trim());
  }
  return { failed, passed };
}

// How many tests the file actually declares. Read rather than written down: a
// count in this file is a claim about the suite that the suite cannot check, and
// the whole point of the parser assertion is that a run reading no tests must not
// read as a pass.
const DECLARED = (fs.readFileSync(TEST, 'utf8').match(/^test\(/gm) || []).length;
if (DECLARED < 6) {
  console.error(`prove-red-stage-pull: only ${DECLARED} test() calls found in ${path.basename(TEST)} — the suite or this reader moved.`);
  process.exit(1);
}

let bad = false;
for (const mut of MUTATIONS) {
  console.log(`\nfixture      : assets/stage.js with ${mut.what}`);
  if (!src.includes(mut.find)) {
    console.error('FAIL: could not find the line this mutation cuts in assets/stage.js.');
    console.error('  If the rule was deliberately removed or rewritten, update or delete this mutation with it.');
    bad = true; continue;
  }
  const broken = src.replace(mut.find, mut.replace);
  if (broken === src) { console.error('FAIL: the cut changed nothing.'); bad = true; continue; }
  fs.writeFileSync(copy, broken);

  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', TEST],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, STAGE_JS: copy } });
  const out = r.stdout + r.stderr;
  const { failed, passed } = readVerdicts(out);
  const all = [...passed, ...failed];

  console.log(`tests seen   : ${all.length}  (must be ${DECLARED} — a parser that reads none says nothing)`);
  console.log(`must fail    : ${mut.mustFail.length}`);
  console.log(`must stay green: ${all.length - mut.mustFail.length}`);

  if (all.length !== DECLARED) {
    console.error(`FAIL: expected ${DECLARED} tests, read ${all.length} — the parser or the suite moved`); bad = true;
  }
  // A name this harness supplied that no longer exists would otherwise read as
  // "nothing matched", which reads as "nothing wrong".
  const unknown = mut.mustFail.filter(n => !all.includes(n));
  if (unknown.length) {
    console.error(`FAIL: this mutation names ${unknown.length} test(s) the suite does not have — renamed, or never written:\n  ${unknown.join('\n  ')}`);
    bad = true;
  }
  const stillGreen = mut.mustFail.filter(n => passed.has(n));
  if (stillGreen.length) {
    console.error(`FAIL: these tests still PASS with the rule cut, so they do not test it:\n  ${stillGreen.join('\n  ')}`);
    bad = true;
  }
  const collateral = [...failed].filter(n => !mut.mustFail.includes(n));
  if (collateral.length) {
    console.error(`FAIL: these went red and should not have — the harness broke the file, it did not falsify the rule:\n  ${collateral.join('\n  ')}`);
    bad = true;
  }
  if (bad) console.error('\n--- test output ---\n' + out);
  cleanup();
  if (bad) break;
  console.log('PROVEN RED for this mutation.');
}

if (bad) process.exit(1);
console.log(`\nPROVEN RED: ${MUTATIONS.length} mutations, each reddening exactly the tests it names and nothing else.`);
