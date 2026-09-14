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
 * Nine cases, each on a scratch repository under os.tmpdir() holding a
 * package.json, a tools/ folder and a gates.yml — never this checkout, so
 * nothing here can turn it green or red. ~2 s.
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
 *
 * CASES 8-11 ARE OA-346 (buses-data), from the 2026-09-14 review's R2 N34: a step
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
 */
function tree({ tools = {}, scripts = {}, steps = [], comment = '', patch = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-wiring-'));
  const engine = path.join(tmp, 'skills', 'make-bus-leaflet');
  fs.mkdirSync(path.join(engine, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'skills', '.github', 'workflows'), { recursive: true });

  for (const [name, body] of Object.entries(tools)) {
    fs.writeFileSync(path.join(engine, 'tools', name), body || '// scratch\n');
  }
  fs.writeFileSync(path.join(engine, 'package.json'),
    JSON.stringify({ name: 'scratch', version: '0.0.0', scripts }, null, 2));

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
  // The scratch repo is not a git repository, so the tracked-file enumeration
  // has nothing to read. Point it at the disk for the scratch runs only; the
  // real check keeps reading the index, which is what case 0 in the REAL
  // repository (the check's own green run) exercises.
  src = src.replace(
    /const toolFiles = require\('child_process'\)[\s\S]*?\.sort\(\);/,
    "const toolFiles = fs.readdirSync(path.join(ENGINE, 'tools')).sort();");
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
  patch: (src) => src.replace('const NOT_IN_CI = {};', "const NOT_IN_CI = { 'test:thing': '' };"),
}, ({ code, out }) => {
  if (code === 1 && /has no reason/.test(out)) ok('an exception with no reason is a finding, not a licence');
  else fail(`a reasonless exception was accepted (exit ${code})\n${out}`);
});

// 5 — an exception naming a script that is gone -----------------------------
withTree({
  tools: SELF,
  scripts: SELF_SCRIPT,
  steps: [SELF_STEP],
  patch: (src) => src.replace('const NOT_IN_CI = {};', "const NOT_IN_CI = { 'test:retired': 'needs the buses estate' };"),
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

for (const t of made) fs.rmSync(t, { recursive: true, force: true });

console.log('');
if (failures) {
  console.error(`prove-red-wiring: ${failures} case(s) did not behave as required.`);
  process.exit(1);
}
console.log(`prove-red-wiring: all ${passes} case(s) behaved as required.`);
process.exit(0);
