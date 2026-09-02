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
  'gate:extraction':
    'needs the buses estate; run by hand after an extraction, where its whole job is to report nothing moved',
  'gate:dark-paths':
    'needs the buses estate; run by the rollout over the sheets it just built',
  'gate:branch-coverage':
    'takes a spec file as its argument and answers a question about the committed maps, not a pass/fail',
  'test:prove-lane-mirror':
    'needs the buses estate AND renders every town twice — minutes, not seconds; run by hand when laneOrientation is touched',
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
// Only what CI actually RUNS. A tool named in a comment is not scheduled, and
// this file is heavily commented — the whole point is to ask what it reads.
const runSteps = yml.split(/\r?\n/).reduce((acc, line) => {
  if (/^\s*run:\s*\|/.test(line)) { acc.inBlock = true; return acc; }
  if (/^\s*run:\s*(.+)$/.test(line)) { acc.inBlock = false; acc.cmds.push(RegExp.$1.trim()); return acc; }
  if (acc.inBlock && /^\s{10,}\S/.test(line)) { acc.cmds.push(line.trim()); return acc; }
  if (/^\s*-\s+name:/.test(line)) acc.inBlock = false;
  return acc;
}, { inBlock: false, cmds: [] }).cmds;
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

const gateScripts = Object.keys(scripts).filter((n) => /^(test|gate):/.test(n));
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
for (const name of Object.keys(NOT_IN_CI)) {
  if (!gateScripts.includes(name)) {
    findings.push(`NOT_IN_CI names "${name}", which is not a script any more. Delete the entry.`);
  } else if (!NOT_IN_CI[name].trim()) {
    findings.push(`NOT_IN_CI["${name}"] has no reason. An exclusion with no reason is a hole.`);
  }
}

// --- report ----------------------------------------------------------------

const byStatus = (s) => rows.filter((r) => r.status === s).length;
console.log(`check-wiring — ${ENGINE}`);
console.log(`  ${toolFiles.length} file(s) in tools/, ${gateScripts.length} test:/gate: script(s)`);
console.log(`  scheduled by name: ${byStatus('npm run')}   rebuilt in the workflow: ${byStatus('REBUILT')}   not in CI: ${byStatus('absent')} (${Object.keys(NOT_IN_CI).length} declared)`);

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
