/*
 * prove-red-wiring.js — falsify check-wiring.js (buses-data OA-224, Tier 2.3).
 *
 *   node tools/prove-red-wiring.js
 *
 * Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` — the engine's own
 * folder. No placeholders.
 *
 * WHY. `check-wiring.js` is a check whose whole subject is OTHER checks being
 * scheduled, so if it stops finding things it reports the healthiest possible
 * state — "every gate is scheduled" — about a repository where nothing is. It is
 * exactly the shape it was written to catch, one level up, and it went green on
 * the same afternoon it went red, which is when a check is least trustworthy.
 *
 * Every case runs on its own scratch repository under os.tmpdir() holding a
 * package.json, a tools/ folder and a gates.yml — never this checkout, so
 * nothing here can turn it green or red. ~2 s. The COUNT is printed by the run
 * and written nowhere: this header said "nine cases" for a fortnight, and the
 * closing line still said it while fourteen ran.
 *
 *   0  control: a correctly wired scratch repo      -> exit 0
 *   1  a tool with no npm script                    -> exit 1, and it is NAMED
 *   2  a script in no workflow step                 -> exit 1, and it is NAMED
 *   3  CI rebuilding the command instead of `npm run` -> exit 1, and BOTH
 *                                                      copies are printed. This
 *                                                      is the finding nothing
 *                                                      else in the estate makes
 *   4  a declared exception with an empty reason    -> exit 1
 *   5  a declared exception naming a script that is gone -> exit 1
 *   6  a tool NAMED IN A COMMENT but never run      -> still a finding. The
 *                                                      control for case 2: this
 *                                                      workflow is heavily
 *                                                      commented, and a checker
 *                                                      that grepped the file
 *                                                      would call a mention a
 *                                                      schedule and report the
 *                                                      whole repository clean
 *   7  `npm run <name> --flag` with no `--`           -> a finding. npm reads
 *                                                      the flag as its OWN
 *                                                      config, warns on stderr
 *                                                      and hands the script
 *                                                      nothing
 *  7b  the same step WITH `--`                        -> clean, so 7 tested the
 *                                                      separator and not the
 *                                                      flag
 *   8  a step running a RAW command, undeclared      -> exit 1, and it is NAMED
 *  8b  the same step DECLARED in RAW_STEPS           -> clean, so 8 tested the
 *                                                      declaration, not the
 *                                                      command
 *   9  a RAW_STEPS entry naming no raw step          -> exit 1
 *  10  a RAW_STEPS entry with an empty reason        -> exit 1
 *  11  a `run: |` block holding a shell comment      -> the block IS read as the
 *                                                      step's commands, and a
 *                                                      harness named only in the
 *                                                      comment is still
 *                                                      unscheduled. Case 6's
 *                                                      rule one level in
 *  12  a harness in a SECOND manifest, unscheduled  -> exit 1, NAMED with its
 *                                                      skill
 * 12b  the same harness with a step in ITS OWN
 *      working-directory                            -> clean
 *  13  two skills with a script of the SAME NAME,
 *      only one of them scheduled                   -> exit 1 for the other one.
 *                                                      The case a flat join gets
 *                                                      WRONG rather than misses
 *  14  a NOT_IN_CI table keyed to a manifest that
 *      is not in the repository                     -> exit 1
 *
 * CASES 8-14 ARE OA-346 (buses-data), from the 2026-09-14 review's R2 N34 and
 * R3 G3. Case 13 is the one to read: `bus-work` and `make-bus-leaflet` both call
 * a script `test:prove-red`, so a join that matched `npm run <name>` against
 * every command in the workflow would have answered GREEN for a script no step
 * runs. A missing question is a hole; a wrong answer is worse, and widening this
 * check without scoping each match to the step's working-directory would have
 * built one into the instrument whose subject is exactly that.
 *
 * CASES 8-11 ARE the raw-step half of the same action: a step
 * with a raw `run:` was outside this check by construction, which is the blind
 * spot one level up from the one the check exists for — it could only see the
 * form it already knew. The number of cases is now PRINTED FROM THE RUN rather
 * than written into the closing line, because that line said "nine" while
 * fourteen of them ran.
 *
 * Case 6 is the one that matters most, and it is a control rather than a break:
 * "ask what it reads, not what it mentions". A `grep` over gates.yml passes
 * every other case here and fails only this one.
 *
 * CASE 7 IS HERE BECAUSE IT HAPPENED, an hour after this file was written. The
 * change that routed CI through the npm scripts matched a PREFIX of each `run:`
 * line and left the trailing arguments dangling, so two steps became
 * `npm run test:prove-red-rollout-stamp --buses "…"`. npm swallowed `--buses`,
 * the tool fell back to its hardcoded laptop default, and CI failed on a Windows
 * path. Failing was the lucky outcome: a tool whose default happened to be right
 * would have gone GREEN while being handed nothing at all.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ENGINE = path.resolve(__dirname, '..');
const CHECKER = path.join(ENGINE, 'tools', 'check-wiring.js');

let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
// COUNTED, not typed. This line read "all nine cases behaved as required" while
// fourteen ran — the same shape as quoting a checker's row count from a document
// instead of reading it off the run, committed in the file whose whole subject is
// a written claim that has stopped being true.
let passes = 0;
const ok = (m) => { passes++; console.log(`  + ${m}`); };

/** Replace, or say which substitution stopped matching and stop. */
function mustReplace(src, re, to, what) {
  const out = src.replace(re, to);
  if (out === src) {
    console.error(`  x the harness could not patch ${what} out of check-wiring.js.`);
    console.error('    The checker has been edited and this substitution no longer matches, so every');
    console.error('    case below would be testing the scratch runner rather than the check. Fix the');
    console.error('    regex in prove-red-wiring.js before trusting anything this file prints.');
    process.exit(1);
  }
  return out;
}

/**
 * A scratch skills repository: <tmp>/skills/.github/workflows/gates.yml and
 * <tmp>/skills/make-bus-leaflet/{package.json,tools/}. The checker resolves both
 * from its own location, so it is copied in rather than pointed at.
 *
 *   tools:   filename -> file body
 *   scripts: npm script name -> command
 *   steps:   the `run:` lines to put in the workflow
 *   comment: extra prose in the workflow that must NOT count as scheduling
 *   patch:   (checkerSource) => checkerSource, to change its declared exceptions
 *   manifests: dirName -> { script: command } for a SECOND skill in the tree
 */
function tree({ tools = {}, scripts = {}, steps = [], comment = '', patch = null, manifests = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-wiring-'));
  const engine = path.join(tmp, 'skills', 'make-bus-leaflet');
  fs.mkdirSync(path.join(engine, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'skills', '.github', 'workflows'), { recursive: true });

  for (const [name, body] of Object.entries(tools)) {
    // A name may carry a folder — `lib/helper.js` — since the tools/lib/ cases.
    fs.mkdirSync(path.dirname(path.join(engine, 'tools', name)), { recursive: true });
    fs.writeFileSync(path.join(engine, 'tools', name), body || '// scratch\n');
  }
  fs.writeFileSync(path.join(engine, 'package.json'),
    JSON.stringify({ name: 'scratch', version: '0.0.0', scripts }, null, 2));

  // A SECOND SKILL with its own manifest and no tools/ folder — the shape
  // `bus-work` actually has, and the one the join could not see until OA-346.
  for (const [dirName, dirScripts] of Object.entries(manifests)) {
    const other = path.join(tmp, 'skills', dirName);
    fs.mkdirSync(path.join(other, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(other, 'package.json'),
      JSON.stringify({ name: dirName, version: '0.0.0', scripts: dirScripts }, null, 2));
  }

  // A step is either a bare command string — named `step <i>` and run in the
  // engine — or `{ name, dir, run }`, where `run` may be an ARRAY, which is
  // written as a `run: |` block. The object form exists for the raw-step and
  // multi-manifest cases, which are about a step's name and its working
  // directory rather than about its command.
  const stepYaml = steps.map((step, i) => {
    const s = typeof step === 'string' ? { run: step } : step;
    const name = s.name || `step ${i}`;
    const dir = s.dir === null ? null : (s.dir || 'skills/make-bus-leaflet');
    const wd = dir ? `        working-directory: ${dir}\n` : '';
    const body = Array.isArray(s.run)
      ? `        run: |\n${s.run.map((l) => `          ${l}`).join('\n')}`
      : `        run: ${s.run}`;
    return `      - name: ${name}\n${wd}${body}`;
  }).join('\n');
  fs.writeFileSync(path.join(tmp, 'skills', '.github', 'workflows', 'gates.yml'),
    `name: scratch\njobs:\n  unit:\n    runs-on: ubuntu-latest\n    steps:\n${comment}${stepYaml}\n`);

  let src = fs.readFileSync(CHECKER, 'utf8');
  // The scratch repo is not a git repository, so neither enumeration has an
  // index to read. Point both at the disk for the scratch runs only; the real
  // check keeps reading the index, which is what its own green run in the REAL
  // repository exercises.
  //
  // ASSERTED, not attempted. A patch that silently stopped matching would leave
  // the checker calling git in a directory that is not a repository, and the
  // whole harness would report the shape of that crash rather than the shape of
  // the case — a checker pointed at a subject the harness itself supplied,
  // which is the estate's own named fault. Both of these regexes have already
  // had to be rewritten once, by the change that added the second one.
  // RECURSIVE, with `/` separators, because `git ls-files tools/` is — the real
  // enumeration answers `lib/baseline.js` for a file in tools/lib/, and a flat
  // readdir would answer `lib` and trip the "neither a .js/.py tool" finding for
  // a folder. The same walk stands in for the tracked-source enumeration the
  // library rule reads, which in the real repository is `git ls-files '*.js'`.
  src = mustReplace(src,
    /const toolFiles = gitLines\(\[[\s\S]*?\.sort\(\);/,
    "const walk = (d, pre = '') => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true })\n" +
    "    .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), pre + e.name + '/') : [pre + e.name]) : [];\n" +
    "  const toolFiles = walk(path.join(dir, 'tools')).sort();",
    'the tools/ enumeration');
  src = mustReplace(src,
    /const sourceFiles = gitLines\(\[[\s\S]*?\.sort\(\);/,
    "const sourceFiles = walk(dir).filter((f) => /\\.(?:c?js|mjs)$/.test(f) && !f.startsWith('node_modules/')).sort();",
    'the tracked-source enumeration');
  src = mustReplace(src,
    /const manifestDirs = gitLines\(\[[\s\S]*?\.sort\(\);/,
    "const manifestDirs = fs.readdirSync(SKILLS)\n" +
    "  .filter((d) => fs.existsSync(path.join(SKILLS, d, 'package.json'))).sort();",
    'the manifest enumeration');
  if (patch) src = patch(src);
  fs.writeFileSync(path.join(engine, 'tools', 'check-wiring.js'), src);
  return { tmp, engine };
}

/** Clear the declared exception tables, so each case tests one thing. */
const noExceptions = (src) => src
  .replace(/const NOT_IN_CI = \{[\s\S]*?\n\};/, 'const NOT_IN_CI = {};')
  .replace(/const RAW_STEPS = \{[\s\S]*?\n\};/, 'const RAW_STEPS = {};')
  .replace(/const NOT_A_TOOL = \{[\s\S]*?\n\};/, 'const NOT_A_TOOL = {};');

const made = [];
function withTree(spec, fn) {
  const t = tree({ ...spec, patch: spec.patch ? (s) => spec.patch(noExceptions(s)) : noExceptions });
  made.push(t.tmp);
  const r = spawnSync(process.execPath, [path.join(t.engine, 'tools', 'check-wiring.js')],
    { cwd: t.engine, encoding: 'utf8' });
  fn({ code: r.status, out: (r.stdout || '') + (r.stderr || '') });
}

console.log('prove-red-wiring — falsifying the scheduling check\n');

// The checker itself is always in the scratch tools/ folder, so every case has
// to give it a script, or every case would trip case 1 for the room's reason.
const SELF = { 'check-wiring.js': null };
const SELF_SCRIPT = { 'gate:wiring': 'node tools/check-wiring.js' };
const SELF_STEP = 'npm run gate:wiring';

// 0 — control ---------------------------------------------------------------
withTree({
  tools: { ...SELF, 'prove-red-thing.js': null },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'node tools/prove-red-thing.js' },
  steps: [SELF_STEP, 'npm run test:thing'],
}, ({ code, out }) => {
  if (code === 0) ok('control: a correctly wired repository is clean');
  else fail(`control: a correct repository exited ${code}\n${out}`);
});

// 1 — a tool nobody can name ------------------------------------------------
withTree({
  tools: { ...SELF, 'orphan-tool.js': null },
  scripts: SELF_SCRIPT,
  steps: [SELF_STEP],
}, ({ code, out }) => {
  if (code === 1 && /orphan-tool\.js has no npm script/.test(out)) ok('a tool with no npm script is found and NAMED');
  else fail(`a tool with no npm script was not reported (exit ${code})\n${out}`);
});

// 2 — a script in no workflow step ------------------------------------------
withTree({
  tools: { ...SELF, 'prove-red-thing.js': null },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'node tools/prove-red-thing.js' },
  steps: [SELF_STEP],
}, ({ code, out }) => {
  if (code === 1 && /test:thing is in no workflow step/.test(out)) ok('an unscheduled gate is found and NAMED');
  else fail(`an unscheduled gate was not reported (exit ${code})\n${out}`);
});

// 3 — CI rebuilding the command --------------------------------------------
withTree({
  tools: { ...SELF, 'prove-red-thing.py': null },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'python tools/prove-red-thing.py' },
  steps: [SELF_STEP, 'python3 tools/prove-red-thing.py'],
}, ({ code, out }) => {
  if (code !== 1) return fail(`a rebuilt command did not fail the check (exit ${code})\n${out}`);
  if (!/CI rebuilds the command/.test(out)) return fail('the rebuilt command was not reported as such');
  if (/python tools\/prove-red-thing\.py/.test(out) && /python3 tools\/prove-red-thing\.py/.test(out)) {
    ok('a rebuilt command is found, and BOTH copies are printed so the drift is visible');
  } else {
    fail('the finding did not print both copies — a reader cannot see what differs');
  }
});

// 4 — an exception with no reason -------------------------------------------
withTree({
  tools: { ...SELF, 'prove-red-thing.js': null },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'node tools/prove-red-thing.js' },
  steps: [SELF_STEP],
  patch: (src) => src.replace('const NOT_IN_CI = {};',
    "const NOT_IN_CI = { 'make-bus-leaflet': { 'test:thing': '' } };"),
}, ({ code, out }) => {
  if (code === 1 && /has no reason/.test(out)) ok('an exception with no reason is a finding, not a licence');
  else fail(`a reasonless exception was accepted (exit ${code})\n${out}`);
});

// 5 — an exception naming a script that is gone -----------------------------
withTree({
  tools: SELF,
  scripts: SELF_SCRIPT,
  steps: [SELF_STEP],
  patch: (src) => src.replace('const NOT_IN_CI = {};',
    "const NOT_IN_CI = { 'make-bus-leaflet': { 'test:retired': 'needs the buses estate' } };"),
}, ({ code, out }) => {
  if (code === 1 && /not a script any more/.test(out)) ok('a stale exception is a finding — the list cannot rot quietly');
  else fail(`a stale exception was accepted (exit ${code})\n${out}`);
});

// 6 — THE CONTROL: a mention in a comment is not a schedule -----------------
withTree({
  tools: { ...SELF, 'prove-red-thing.js': null },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'node tools/prove-red-thing.js' },
  steps: [SELF_STEP],
  comment: '      # TODO: we should run npm run test:thing here one day\n' +
           '      # see also node tools/prove-red-thing.js\n',
}, ({ code, out }) => {
  if (code === 1 && /test:thing is in no workflow step/.test(out)) {
    ok('a tool named only in a COMMENT is still unscheduled — the check reads run steps, not the file');
  } else {
    fail(`a commented mention was counted as a schedule (exit ${code}) — this is a grep, not a check\n${out}`);
  }
});

// 7 — a flag passed to npm instead of to the script -------------------------
withTree({
  tools: { ...SELF, 'prove-red-thing.js': null },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'node tools/prove-red-thing.js' },
  steps: [SELF_STEP, 'npm run test:thing --buses "/somewhere"'],
}, ({ code, out }) => {
  if (code === 1 && /passes a flag to npm, not to the script/.test(out)) {
    ok('`npm run <name> --flag` is a finding — npm eats the flag and the script is handed nothing');
  } else {
    fail(`a missing \`--\` separator was accepted (exit ${code})\n${out}`);
  }
});

// 7b — the control: WITH the separator it is correctly wired ----------------
withTree({
  tools: { ...SELF, 'prove-red-thing.js': null },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'node tools/prove-red-thing.js' },
  steps: [SELF_STEP, 'npm run test:thing -- --buses "/somewhere"'],
}, ({ code, out }) => {
  if (code === 0) ok('control for 7: with `--` the same step is clean, so case 7 tested the separator and not the flag');
  else fail(`control for 7: a correctly separated step was reported (exit ${code})\n${out}`);
});

// 8 — a RAW step nobody declared -------------------------------------------
//
// The blind spot OA-346 was filed about. Until it was closed, a step with a raw
// `run:` was outside the check entirely: the whole file could have been raw
// commands and the report would have said every gate was scheduled.
withTree({
  tools: SELF,
  scripts: SELF_SCRIPT,
  steps: [SELF_STEP, { name: 'Install the world', run: 'pip install -r requirements.txt' }],
}, ({ code, out }) => {
  if (code === 1 && /the step "Install the world" runs a raw command/.test(out)) {
    ok('a raw step with no declaration is found and NAMED');
  } else {
    fail(`an undeclared raw step was accepted (exit ${code})\n${out}`);
  }
});

// 8b — the control: declared, the SAME step is clean ------------------------
withTree({
  tools: SELF,
  scripts: SELF_SCRIPT,
  steps: [SELF_STEP, { name: 'Install the world', run: 'pip install -r requirements.txt' }],
  patch: (src) => src.replace('const RAW_STEPS = {};',
    "const RAW_STEPS = { 'Install the world': 'pip install — the same shape as npm ci, one layer down' };"),
}, ({ code, out }) => {
  if (code === 0) ok('control for 8: declared with a reason, the same raw step is clean — case 8 tested the declaration, not the command');
  else fail(`control for 8: a declared raw step was still reported (exit ${code})\n${out}`);
});

// 9 — a RAW_STEPS entry naming no raw step ----------------------------------
withTree({
  tools: SELF,
  scripts: SELF_SCRIPT,
  steps: [SELF_STEP],
  patch: (src) => src.replace('const RAW_STEPS = {};',
    "const RAW_STEPS = { 'A step that was deleted': 'it ran pip once' };"),
}, ({ code, out }) => {
  if (code === 1 && /which no longer runs a raw command/.test(out)) {
    ok('a stale raw-step declaration is a finding — this table cannot rot quietly either');
  } else {
    fail(`a stale RAW_STEPS entry was accepted (exit ${code})\n${out}`);
  }
});

// 10 — a RAW_STEPS entry with no reason -------------------------------------
withTree({
  tools: SELF,
  scripts: SELF_SCRIPT,
  steps: [SELF_STEP, { name: 'Install the world', run: 'pip install -r requirements.txt' }],
  patch: (src) => src.replace('const RAW_STEPS = {};', "const RAW_STEPS = { 'Install the world': '' };"),
}, ({ code, out }) => {
  if (code === 1 && /has no reason/.test(out)) ok('a raw step declared with no reason is a finding, not a licence');
  else fail(`a reasonless raw declaration was accepted (exit ${code})\n${out}`);
});

// 11 — THE CONTROL FOR THE BLOCK PARSER: `run: |` and a shell comment -------
//
// Two things at once, and both are case 6's rule one level in. A `run: |` block
// must be read as the step's commands — or every multi-line step in the real
// workflow would read as having none, and a step with no commands is skipped by
// every check here. And a `#` line INSIDE that block is a shell comment, so a
// tool named there is mentioned and not run.
withTree({
  tools: { ...SELF, 'prove-red-thing.js': null, 'prove-red-other.js': null },
  scripts: {
    ...SELF_SCRIPT,
    'test:thing': 'node tools/prove-red-thing.js',
    'test:other': 'node tools/prove-red-other.js',
  },
  steps: [SELF_STEP, {
    name: 'Both harnesses',
    run: ['npm run test:thing', '# one day: npm run test:other', 'npm run test:thing'],
  }],
}, ({ code, out }) => {
  if (code !== 1) return fail(`the block case did not report the commented-out harness (exit ${code})\n${out}`);
  if (!/test:other is in no workflow step/.test(out)) {
    return fail(`a harness named in a shell comment inside a \`run: |\` block was counted as scheduled\n${out}`);
  }
  if (/runs a raw command/.test(out)) {
    return fail(`a \`run: |\` block of npm scripts was misread as a raw step\n${out}`);
  }
  ok('a `run: |` block is read as its commands, and a `#` line inside it is a comment and not a schedule');
});

// 12 — a SECOND manifest's harness, scheduled nowhere ----------------------
//
// The blind spot OA-346 half 2 was filed about: `bus-work` holds sixteen
// harnesses and the join read one manifest. A whole skill's worth of gates could
// have been unscheduled and this check would have said every gate is scheduled.
withTree({
  tools: SELF,
  scripts: SELF_SCRIPT,
  manifests: { 'other-skill': { 'test:theirs': 'node assets/prove-red-theirs.mjs' } },
  steps: [SELF_STEP],
}, ({ code, out }) => {
  if (code === 1 && /other-skill test:theirs is in no workflow step/.test(out)) {
    ok('a harness in a SECOND manifest is inside the join, and an unscheduled one is NAMED with its skill');
  } else {
    fail(`a second manifest's unscheduled harness was not reported (exit ${code})\n${out}`);
  }
});

// 12b — the control: with its own step, in its own directory, it is clean ---
withTree({
  tools: SELF,
  scripts: SELF_SCRIPT,
  manifests: { 'other-skill': { 'test:theirs': 'node assets/prove-red-theirs.mjs' } },
  steps: [SELF_STEP, { name: 'Theirs', dir: 'skills/other-skill', run: 'npm run test:theirs' }],
}, ({ code, out }) => {
  if (code === 0) ok('control for 12: scheduled in its own working-directory, the same harness is clean');
  else fail(`control for 12: a correctly scheduled second-manifest harness was reported (exit ${code})\n${out}`);
});

// 13 — THE ONE A FLAT JOIN GETS WRONG: the same script name in two skills ---
//
// Not a missing question but a WRONG ANSWER, and the direction that matters: a
// flat `npm run <name>` match over every command in the file reads the second
// skill's `test:prove-red` as scheduled because the ENGINE has a step of that
// name. Both skills in this repository really do call a script `test:prove-red`,
// so widening the join without scoping it to the step's working-directory would
// have manufactured a green answer for a script no step runs — in the check
// whose whole subject is that mistake.
withTree({
  tools: { ...SELF, 'prove-red-thing.js': null },
  scripts: { ...SELF_SCRIPT, 'test:prove-red': 'node tools/prove-red-thing.js' },
  manifests: { 'other-skill': { 'test:prove-red': 'node assets/prove-red-theirs.mjs' } },
  steps: [SELF_STEP, 'npm run test:prove-red'],
}, ({ code, out }) => {
  if (code !== 1) {
    return fail(
      'a script sharing its NAME with a scheduled step in ANOTHER skill was read as scheduled\n' +
      `      (exit ${code}). This is the flat-join answer, and it is the wrong one.\n${out}`);
  }
  if (!/other-skill test:prove-red is in no workflow step running in other-skill/.test(out)) {
    return fail(`the collision was reported, but not as the second skill's own script\n${out}`);
  }
  if (/make-bus-leaflet test:prove-red is in no workflow step/.test(out)) {
    return fail(`the ENGINE's correctly scheduled script of the same name was reported too\n${out}`);
  }
  ok('two skills with a script of the SAME NAME are answered separately — the engine\'s is scheduled, the other\'s is not');
});

// 14 — NOT_IN_CI naming a manifest the repository does not have -------------
withTree({
  tools: SELF,
  scripts: SELF_SCRIPT,
  steps: [SELF_STEP],
  patch: (src) => src.replace('const NOT_IN_CI = {};',
    "const NOT_IN_CI = { 'a-skill-that-left': { 'test:gone': 'needs the estate' } };"),
}, ({ code, out }) => {
  if (code === 1 && /names the manifest "a-skill-that-left", which this repository does not have/.test(out)) {
    ok('an exception table for a manifest that is not there is a finding — the keys rot like the entries');
  } else {
    fail(`a NOT_IN_CI table keyed to a missing manifest was accepted (exit ${code})\n${out}`);
  }
});

// 15 — a LIBRARY under tools/lib/, loaded by a tool: not a finding -------------
// (buses-data OA-353, 2026-09-16.) tools/lib/baseline.js was the estate's first
// shared library under tools/, and question 1 reported it as a tool with no npm
// script — a question a library cannot answer. This is the green arm: a library
// some tracked source requires is clean, and is NOT reported under the old rule.
withTree({
  tools: { ...SELF, 'prove-red-thing.js': "const { x } = require('./lib/helper');\n", 'lib/helper.js': 'module.exports = { x: 1 };\n' },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'node tools/prove-red-thing.js' },
  steps: [SELF_STEP, 'npm run test:thing'],
}, ({ code, out }) => {
  if (code === 0) ok('a library under tools/lib/ that a tool requires is clean, and is not asked for an npm script');
  else fail(`a required library under tools/lib/ was reported (exit ${code})\n${out}`);
});

// 16 — a library nothing loads: a dark file, found and NAMED --------------------
withTree({
  tools: { ...SELF, 'prove-red-thing.js': "// no requires here\n", 'lib/orphan.js': 'module.exports = {};\n' },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'node tools/prove-red-thing.js' },
  steps: [SELF_STEP, 'npm run test:thing'],
}, ({ code, out }) => {
  if (code === 1 && /tools\/lib\/orphan\.js is required by no tracked source/.test(out)) ok('a library under tools/lib/ that nothing requires is found and NAMED');
  else fail(`an unrequired library was not reported (exit ${code})\n${out}`);
});

// 17 — THE CONTROL: a mention in a comment is not a reader ----------------------
// The same shape as case 6 for scripts. `// see lib/orphan.js` is not a
// require(), so a library whose only "reader" is a comment is still dark.
withTree({
  tools: { ...SELF, 'prove-red-thing.js': "// see lib/orphan.js for the verdict vocabulary\n", 'lib/orphan.js': 'module.exports = {};\n' },
  scripts: { ...SELF_SCRIPT, 'test:thing': 'node tools/prove-red-thing.js' },
  steps: [SELF_STEP, 'npm run test:thing'],
}, ({ code, out }) => {
  if (code === 1 && /tools\/lib\/orphan\.js is required by no tracked source/.test(out)) ok('control: a comment naming a library is not a require — it is still reported');
  else fail(`a library mentioned only in a comment was accepted as loaded (exit ${code})\n${out}`);
});

for (const t of made) fs.rmSync(t, { recursive: true, force: true });

console.log('');
if (failures) {
  console.error(`prove-red-wiring: ${failures} case(s) did not behave as required.`);
  process.exit(1);
}
console.log(`prove-red-wiring: all ${passes} case(s) behaved as required.`);
process.exit(0);
