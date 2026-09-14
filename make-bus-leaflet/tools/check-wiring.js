/*
 * check-wiring.js — is every gate and harness in this repository actually
 * scheduled, and does CI run it the way `npm run` does?
 *
 *   node tools/check-wiring.js            # report; exit 1 if anything is unwired
 *   node tools/check-wiring.js --list     # print the full table, exit 0
 *
 * Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` — the engine's own
 * folder. No placeholders.
 *
 * WHY THIS EXISTS (buses-data OA-224, Tier 2.3). This repository accumulates
 * falsification harnesses faster than it accumulates the CI steps that run them,
 * and the gap is invisible: every one of them passes when a person runs it, and
 * nothing anywhere says which ones a person is the only thing running. The
 * 2026-09-01 codebase review counted the unscheduled files by hand; a count
 * made by hand is right on the day it is made.
 *
 * It asks TWO questions, and the second is the one nobody thinks of:
 *
 *   1. Is every runnable tool reachable by name — does it have an npm script?
 *      A tool nobody can name is a tool nobody adds to a workflow.
 *   2. Does `gates.yml` run it THROUGH that script, or does it rebuild the
 *      command? A rebuilt command is a second copy of the invocation, and the
 *      two drift: four python harnesses are `python` in package.json and
 *      `python3` in the workflow, so `npm run test:prove-red-days-resolution`
 *      and the CI step of the same name are not the same command. On a machine
 *      where `python` is Python 2, or absent, the local one is broken and the
 *      green tick says nothing about it.
 *
 * WHAT IT FOUND ON ITS FIRST RUN, 2026-09-02: `tools/prove-red.js` — the
 * 226-mutation suite that falsifies the whole unit suite — has NEVER been in
 * `gates.yml`. `git log -S` over that file returns nothing. Meanwhile
 * `buses-data/CLAUDE.md` said, in writing, "Both now run in CI too, as steps in
 * the `gates` job — they never did until 2026-08-28", about that suite and
 * `prove-red-gates.js`. One of the two was true.
 *
 * EXCEPTIONS ARE DECLARED, NOT INFERRED. A script may be absent from the
 * workflow only with a written reason, and the reason has to say what would have
 * to change for it to be scheduled. The list is checked in both directions: an
 * exception naming a script that no longer exists is a finding, because
 * otherwise the exception list becomes where stale decisions go to be believed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ENGINE = path.resolve(__dirname, '..');
const SKILLS = path.resolve(ENGINE, '..');
const WORKFLOW = path.join(SKILLS, '.github', 'workflows', 'gates.yml');

/*
 * Files in tools/ that are not runnable tools. Each needs a reason, and the
 * reason has to be about what the file IS, not about whether we got round to it.
 */
const NOT_A_TOOL = {
  'line-ratchet.json': 'the ratchet ledger — data, read by line-ratchet.js',
};
/** Spec files passed AS AN ARGUMENT to another tool; they run nothing alone. */
const SPEC_OF = {
  'branch-coverage.js': /^branch-coverage\..+\.js$/,
};

/*
 * Scripts `gates.yml` does not run, each with the reason it cannot. A reason
 * must say what would have to change — "needs X" — so that a later reader can
 * tell a deliberate exclusion from an oversight nobody revisited.
 */
const NOT_IN_CI = {
  'test:prove-red-status':
    'needs the buses estate AND a portal checkout; it is falsified in the status job by prove-red-gates.js instead',
  'test:prove-red-attribution':
    'needs the buses estate — would have to move to the status job, which has the checkout',
  'test:prove-red-external-spokes':
    'needs the buses estate — would have to move to the status job, which has the checkout',
  'gate:attribution':
    'needs the buses estate; run by the rollout, and gated estate-wide by status.js in the status job',
  'gate:latest-mirrors':
    'needs the buses estate — its subject is each map\'s _latest/verification.docx, so it is wired into buses-data\'s own gates.yml status job, which has that checkout. It would move here only if this repository gained one',
  'test:prove-red-latest-mirrors':
    'builds its own fixture and needs no estate, but it is wired beside the gate it falsifies, in buses-data\'s gates.yml, so the harness and its subject cannot be scheduled apart. Moving it here would split the pair',
  'gate:extraction':
    'needs the buses estate; run by hand after an extraction, where its whole job is to report nothing moved',
  'gate:dark-paths':
    'needs the buses estate; run by the rollout over the sheets it just built',
  'gate:branch-coverage':
    'takes a spec file as its argument and answers a question about the committed maps, not a pass/fail',
  'test:prove-lane-mirror':
    'needs the buses estate AND renders every town twice — minutes, not seconds; run by hand when laneOrientation is touched',
  'census:lanes':
    'needs the buses estate AND renders every internal sheet on it — minutes, not seconds — and answers a question (how the offsetter treats each sheet, OA-176 4.21) rather than a pass/fail; run by hand when lane offsets, laneRibbon or a corridor family are touched. Its tool had no npm script from 2026-09-04 to 2026-09-05, and this check was red on every push in between',
  'sweep:scratch':
    'a housekeeping sweep, not a check — it DELETES scratch folders, and a CI runner has none; run by hand on the laptop. It escaped this file entirely until 2026-09-03 because its name carries neither prefix (the review\'s engine-pipeline N27), which is why the rule above now reads what a script DOES rather than what it is called',
};

/*
 * Steps that run a RAW command instead of an npm script, each with the reason it
 * cannot be routed through one. Keyed by the step's `name:`, which is what a
 * reader of the workflow sees; two steps sharing a name share one entry, which is
 * why the reason has to be about the KIND of command rather than about one job.
 *
 * WHY THIS TABLE EXISTS (buses-data OA-346, from the 2026-09-14 review's R2 N34).
 * Question 2 below asks whether CI runs a script THROUGH `npm run` — but it could
 * only ask that of a command it recognised as belonging to a script. A step with
 * a raw `run:` was invisible to the whole check by construction, which is the
 * same blind spot one level up: the instrument could only see what it already
 * knew the form of. A raw step is now a finding unless it is declared here, so
 * the population the question is asked of is every step in the file.
 *
 * `npm ci` and `npm test` are raw by this rule too, deliberately: the rule is
 * structural — every command line in the step is `npm run <script>`, or the step
 * is declared — because any rule that special-cased a list of "fine" commands
 * would be a second list to keep true.
 */
const RAW_STEPS = {
  'Install engine dependencies':
    'npm ci — installing the dependencies is what makes the scripts runnable, so it cannot itself be one. Appears in both the unit and the status job',
  'Unit suite':
    '`npm test` is npm\'s own lifecycle script and `npm run test` is the same command; there is nothing to drift',
  'Install the engine\'s Python dependencies':
    'pip install -r requirements.txt — the same shape as npm ci, one layer down',
  'Prove the stamp policy and its scope rule can go red':
    'runs in skills/stamp-docs, which has NO package.json, so there is no script to route through. It would stop being raw only if that skill gained a manifest — and then it would join the manifest enumeration below',
  'Prove the file-hygiene checker can go red':
    'a shared checker in skills/tools/, run from the repository root, which has no package.json — the shared tools are deliberately outside every skill\'s manifest so all three repositories can run them the same way',
  'Files carry no BOM, no trailing whitespace, no missing newline':
    'the same shared skills/tools/ checker; see the entry above',
  'Prove the table checker can go red':
    'a shared checker in skills/tools/ — see above',
  'Prove the doc-link checker can go red':
    'a shared checker in skills/tools/ — see above',
  'Prove the acronym checker can go red':
    'a shared checker in skills/tools/ — see above',
  'Prove the exclusion-field gate can go red':
    'a shared checker in skills/tools/ — see above',
  'Prove the S6 claims gate can go red':
    'a shared checker in skills/tools/ — see above',
  'Tables are still tables':
    'a shared checker in skills/tools/ — see above',
  'Links, anchors, §n citations and documented commands':
    'a shared checker in skills/tools/ — see above',
  'Every short form a reader meets is one they can look up':
    'a shared checker in skills/tools/ — see above',
  'Preflight -- can the PAT see both private repos?':
    'a shell block calling the GitHub API to say WHY a checkout is about to fail; it runs before any checkout, so there is no manifest in the workspace yet',
  'Fetch the portal\'s branch tips (so an open re-vendor reads pending, not DRIFTED)':
    'raw git against the checked-out portal — plumbing for the step after it, not a gate, and it belongs to no skill',
  'Which three commits is this verdict about':
    'a shell block writing the step summary — it names the three SHAs this verdict is about and runs no tool',
  'What Node does the deployment image use?':
    'a shell block reading the portal\'s Dockerfile; its subject is the portal repository, which has its own manifest and its own workflow',
  'Sweep for run folders holding a later stage\'s output':
    'node assets/stray_outputs.js — an ASSET, not a tools/ gate, and it takes --buses so it can only run where the estate is checked out. If it is ever given an npm script it must be removed from here, which is what the two-way check below enforces',
  'Run gates (JSON + step summary)':
    'a shell block running assets/gates.js and writing its JSON into the step summary; the redirection is the point and cannot live in a script',
};

const args = process.argv.slice(2);
if (args.some((a) => a === '--help' || a === '-h')) {
  console.log('usage: node tools/check-wiring.js [--list]   (run from make-bus-leaflet/)');
  process.exit(2);
}
const listAll = args.includes('--list');
const unknown = args.filter((a) => a !== '--list');
if (unknown.length) {
  console.error(`unknown argument: ${unknown.join(' ')}`);
  process.exit(2);
}

if (!fs.existsSync(WORKFLOW)) {
  console.error(`Cannot find the workflow at ${WORKFLOW}.`);
  console.error('This check reads gates.yml; without it there is nothing to compare against.');
  process.exit(2);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ENGINE, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const yml = fs.readFileSync(WORKFLOW, 'utf8');

/*
 * Parse the workflow into STEPS rather than into a flat list of command lines.
 * A step is `{ name, dir, cmds }` — its `name:`, its `working-directory:` if it
 * declares one, and every command line it actually runs.
 *
 * It used to be flat, and two things were impossible while it was: a step with a
 * raw command could not be named (there was nothing to name), and a `npm run X`
 * could not be attributed to the MANIFEST it runs against, so a script called X
 * in one skill read as scheduled because a different skill's step of the same
 * name existed. Both are the same fault — the flat list threw away the only two
 * fields that say what a command is about.
 *
 * Only what CI actually RUNS. A tool named in a comment is not scheduled, and
 * this workflow is heavily commented — the whole point is to ask what it reads.
 * That holds INSIDE a `run: |` block too: a `#` line there is a shell comment.
 */
function parseSteps(text) {
  const indentOf = (l) => l.match(/^\s*/)[0].length;
  const steps = [];
  let cur = null;
  let blockIndent = null;
  for (const line of text.split(/\r?\n/)) {
    if (blockIndent !== null) {
      if (/^\s*$/.test(line)) continue;
      if (indentOf(line) > blockIndent) {
        const cmd = line.trim();
        if (!cmd.startsWith('#')) cur.cmds.push(cmd);
        continue;
      }
      blockIndent = null;
    }
    const start = line.match(/^\s*-\s+name:\s*(.+)$/);
    if (start) {
      cur = { name: start[1].trim().replace(/^['"]|['"]$/g, ''), dir: null, cmds: [] };
      steps.push(cur);
      continue;
    }
    if (!cur) continue;
    const wd = line.match(/^\s*working-directory:\s*(.+)$/);
    if (wd) { cur.dir = wd[1].trim().replace(/^['"]|['"]$/g, ''); continue; }
    const run = line.match(/^(\s*)run:\s*(.*)$/);
    if (run) {
      const rest = run[2].trim();
      if (/^[|>][+-]?$/.test(rest)) blockIndent = run[1].length;
      else if (rest) cur.cmds.push(rest);
    }
  }
  return steps;
}

const steps = parseSteps(yml);
const runSteps = steps.flatMap((s) => s.cmds);
const ciCommands = runSteps.join('\n');

const findings = [];
const rows = [];

// --- 1. every runnable tool is reachable by name --------------------------

// TRACKED files, not the disk. tools/ collects gitignored scratch (a gate's
// before/after baselines), and a check that read the disk would report a
// neighbouring session's working files as unscheduled tools.
const toolFiles = require('child_process')
  .execFileSync('git', ['ls-files', 'tools/'], { cwd: ENGINE, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean).map((f) => f.replace(/^tools\//, '')).sort();
const allScriptText = Object.values(scripts).join('\n');
for (const file of toolFiles) {
  if (NOT_A_TOOL[file]) continue;
  const owner = Object.entries(SPEC_OF).find(([, re]) => re.test(file));
  if (owner) continue;
  if (!/\.(js|py)$/.test(file)) {
    findings.push(`tools/${file} is neither a .js/.py tool nor declared in NOT_A_TOOL.`);
    continue;
  }
  if (!allScriptText.includes(`tools/${file}`)) {
    findings.push(`tools/${file} has no npm script — nothing can name it, so nothing will schedule it.`);
  }
}
for (const file of Object.keys(NOT_A_TOOL)) {
  if (!toolFiles.includes(file)) findings.push(`NOT_A_TOOL names tools/${file}, which is not there. Delete the entry.`);
}

// --- 2. every gate and harness is scheduled, and scheduled BY NAME ---------

// EVERY SCRIPT THAT RUNS A FILE IN tools/, not every script whose NAME begins
// test: or gate:.
//
// It was the prefix rule until 2026-09-03, and the 2026-09-03 review found what
// that costs (engine-pipeline N27): `sweep:scratch` -> `tools/sweep-scratch.js`
// was named, unscheduled and undeclared, and invisible to the check whose whole
// job is to notice that. A NAME is a convention somebody has to remember; what a
// script DOES is a fact. Any future harness registered under a third prefix
// escaped the old rule the same way, silently, which is the failure mode this
// file exists to end -- the same shape as the four python/python3 divergences
// below, one level up.
//
// `npm test` (`node --test`) names no tools/ file and is correctly outside this:
// it is the unit suite, and `gates.yml` runs it by name in the `unit` job.
// `test:python` (`test/python/run.py`) is the same shape and outside for the same
// reason -- it is the Python unit suite, not a tools/ gate. Its join is asserted
// where it can be, in `test/python/test_wiring.py`, rather than left unchecked:
// this filter is structural, so widening it to reach one suite would pull in every
// future script that happens to name a .py outside tools/.
const gateScripts = Object.keys(scripts).filter((n) => /tools\/[\w.-]+\.(js|py)/.test(scripts[n]));
for (const name of gateScripts) {
  const cmd = scripts[name];
  const target = (cmd.match(/tools\/[\w.-]+\.(js|py)/) || [])[0];
  const viaNpm = new RegExp(`npm run ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'm').test(ciCommands);
  const rebuilt = !viaNpm && target && ciCommands.includes(target);
  const status = viaNpm ? 'npm run' : rebuilt ? 'REBUILT' : 'absent';
  rows.push({ name, cmd, status });

  if (rebuilt) {
    const ciLine = runSteps.find((l) => l.includes(target)) || '';
    findings.push(
      `${name}: CI rebuilds the command instead of running the script.\n` +
      `      package.json:  ${cmd}\n` +
      `      gates.yml:     ${ciLine}\n` +
      `      Two copies of one invocation drift. Use \`npm run ${name}\`.`);
  }
  if (status === 'absent' && !NOT_IN_CI[name]) {
    findings.push(
      `${name} is in no workflow step. Either add it to gates.yml, or declare it in\n` +
      `      NOT_IN_CI with a reason saying what would have to change.`);
  }
}
// --- 3. `npm run <name> --flag` silently loses the flag ---------------------
//
// npm parses a `--flag` after the script name as an npm CONFIG option, not as an
// argument to the script: it warns on stderr and passes the script nothing. The
// separator is `--`. This is not hypothetical -- it is how this very check was
// wired in on 2026-09-02: two steps became
// `npm run test:prove-red-rollout-stamp --buses "..."`, npm ate `--buses`, the
// tool fell back to its laptop default and CI failed on a Windows path. Worse
// than failing: a tool whose default happens to be right would have gone GREEN
// while being handed nothing.
for (const line of runSteps) {
  const m = line.match(/npm run ([\w:.-]+)\s+(--[\w-]+)/);
  if (m && m[2] !== '--') {
    findings.push(
      `a workflow step passes a flag to npm, not to the script:\n` +
      `      ${line}\n` +
      `      npm reads "${m[2]}" as its own config and the script is handed nothing.\n` +
      `      Write \`npm run ${m[1]} -- ${m[2]} ...\`.`);
  }
}

for (const name of Object.keys(NOT_IN_CI)) {
  if (!gateScripts.includes(name)) {
    findings.push(`NOT_IN_CI names "${name}", which is not a script any more. Delete the entry.`);
  } else if (!NOT_IN_CI[name].trim()) {
    findings.push(`NOT_IN_CI["${name}"] has no reason. An exclusion with no reason is a hole.`);
  }
}

// --- 4. every RAW step is declared ------------------------------------------
//
// A step is routed if EVERY command line in it is `npm run <script>`; anything
// else is raw and needs an entry in RAW_STEPS. Structural, not a list of
// commands we have decided are acceptable — a rule that named `npm ci` and `pip`
// as fine would be a second list to keep true, and the next raw form would slip
// in under it exactly as raw steps slipped past the whole check until now.
const isNpmRun = (c) => /^npm run [\w:.-]+/.test(c);
const rawSteps = steps.filter((s) => s.cmds.length && !s.cmds.every(isNpmRun));
for (const st of rawSteps) {
  if (RAW_STEPS[st.name] === undefined) {
    findings.push(
      `the step "${st.name}" runs a raw command, and RAW_STEPS does not declare it.\n` +
      `      gates.yml:     ${st.cmds[0]}${st.cmds.length > 1 ? `   (+${st.cmds.length - 1} more line(s))` : ''}\n` +
      `      A raw command is a second copy of an invocation with no script behind it.\n` +
      `      Either run it through an npm script, or declare it in RAW_STEPS with a\n` +
      `      reason saying why it cannot be one.`);
  } else if (!RAW_STEPS[st.name].trim()) {
    findings.push(`RAW_STEPS["${st.name}"] has no reason. An exclusion with no reason is a hole.`);
  }
}
const rawNames = new Set(rawSteps.map((s) => s.name));
for (const name of Object.keys(RAW_STEPS)) {
  if (!rawNames.has(name)) {
    findings.push(
      `RAW_STEPS names the step "${name}", which no longer runs a raw command.\n` +
      `      Delete the entry — otherwise this table is where stale decisions go to be believed.`);
  }
}

// --- report ----------------------------------------------------------------

const byStatus = (s) => rows.filter((r) => r.status === s).length;
console.log(`check-wiring — ${ENGINE}`);
console.log(`  ${toolFiles.length} file(s) in tools/, ${gateScripts.length} script(s) running one of them`);
console.log(`  scheduled by name: ${byStatus('npm run')}   rebuilt in the workflow: ${byStatus('REBUILT')}   not in CI: ${byStatus('absent')} (${Object.keys(NOT_IN_CI).length} declared)`);
console.log(`  ${steps.length} workflow step(s), ${rawSteps.length} of them running a raw command (${Object.keys(RAW_STEPS).length} declared)`);

if (listAll) {
  console.log('');
  for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    const note = r.status === 'absent' && NOT_IN_CI[r.name] ? `  — ${NOT_IN_CI[r.name]}` : '';
    console.log(`  ${r.status.padEnd(8)} ${r.name.padEnd(34)}${note}`);
  }
  process.exit(0);
}

if (findings.length) {
  console.log('');
  for (const f of findings) console.error(`  ! ${f}`);
  console.error(`\ncheck-wiring: ${findings.length} finding(s).`);
  process.exit(1);
}
console.log('  every tool is named, every gate is scheduled, and CI runs each one through its own script.');
process.exit(0);
