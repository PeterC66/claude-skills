/*
 * prove-all.js — run, on this laptop, every `npm run` invocation that CI makes
 * in a skill's own working-directory, and say what each one answered.
 *
 *   node tools/prove-all.js [--portal <path>] [--match <text>]
 *   npm run prove:all [-- --match <text>]
 *
 * `--match <text>` runs only the invocations whose line contains <text>, case
 * ignored — `--match crossings`, `--match bus-work`. A full run is about fifty
 * minutes on the laptop (2026-09-28), so a refactor can ask about the harnesses
 * near its change first. A filtered run is never a clean run: its closing line
 * says how many invocations the filter left out. Selecting nothing is exit 2.
 *
 * Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` — the engine's own
 * folder. `--portal` is the portal checkout, for the steps CI runs against one;
 * it falls back to BUSMAPS_PORTAL and then to the laptop's own checkout, so on
 * this machine there is nothing to type. Exit 0 every invocation passed; 1 at
 * least one went red; 2 none went red but some could not be run, or the list
 * could not be read.
 *
 * WHY (buses-data OA-351). `npm test` is `node --test` — the unit files and
 * nothing else — so the forty-odd `test:prove-red-*` and `gate:*` scripts that
 * make its green mean anything were reachable locally only by naming each one.
 * On 2026-09-14 a refactor of build_s4.js re-anchored one of the three
 * harnesses that quote it, read 944 pass / 0 fail, and a commit message claimed
 * all three; the third was red with two stale anchors, and only CI said so.
 *
 * THE LIST IS NOT TYPED HERE. It is `check-wiring.js --json`'s invocations —
 * the same join that asks whether each harness is scheduled — so a harness
 * added to gates.yml is run here with no edit to this file, and one this file
 * listed for itself would be a second copy of a set that already has an owner.
 *
 * TWO PROPERTIES, and the second is the one that is easy to lose:
 *   - every invocation is run and reported; a red does not stop the run, because
 *     the question a refactor asks is WHAT did I break;
 *   - the closing lines say how many ran out of how many CI makes, and list the
 *     scripts CI does not run with their declared reasons, so a short
 *     enumeration cannot pass for a clean one.
 *
 * `$GITHUB_WORKSPACE/skills` is this repository and `$GITHUB_WORKSPACE/
 * community-bus-maps` is `--portal`, which is how CI lays its checkouts out.
 * An argument naming anything else from the runner is not guessed at: that
 * invocation is reported as not run.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, die, resolvePortal } = require('../assets/cli.js');

const ENGINE = path.resolve(__dirname, '..');
const SKILLS = path.resolve(ENGINE, '..');
const TAIL = 15;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node tools/prove-all.js [--portal <path>] [--match <text>]   (run from make-bus-leaflet/)');
    process.exit(2);
  }
  const flags = parseArgs(argv);
  const unknown = Object.keys(flags).filter((k) => k !== '_' && k !== 'portal' && k !== 'match');
  if (unknown.length || flags._.length) die(`unknown argument: ${[...unknown.map((k) => `--${k}`), ...flags._].join(' ')}`);
  const portal = resolvePortal(flags);
  if (flags.match === true) die('--match needs some text');
  const match = typeof flags.match === 'string' ? flags.match.toLowerCase() : null;

  const wiring = spawnSync(process.execPath, [path.join(ENGINE, 'tools', 'check-wiring.js'), '--json'],
    { cwd: ENGINE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let join;
  try { join = JSON.parse(wiring.stdout); } catch (e) {
    die(`prove-all: check-wiring.js --json did not print JSON (exit ${wiring.status}), so there is no list to run.\n${wiring.stderr || ''}`);
  }
  const all = join.invocations || [];
  // A check that cannot find its subject must not report clear (conventions.md).
  if (!all.length) die('prove-all: check-wiring.js --json listed no invocations; refusing to report a clean run over nothing.');
  if (join.findings.length) {
    console.error(`prove-all: gate:wiring has ${join.findings.length} finding(s) of its own — its own invocation below will show them.`);
  }

  const labelOf = (inv) => `${inv.manifest} ${inv.script}${inv.args ? ` -- ${inv.args}` : ''}`;
  const chosen = match ? all.filter((inv) => labelOf(inv).toLowerCase().includes(match)) : all;
  if (!chosen.length) die(`prove-all: --match "${flags.match}" selected none of the ${all.length} invocation(s) CI makes.`);

  const results = [];
  console.log(`prove-all — ${all.length} invocation(s) CI makes, read from check-wiring.js --json${match ? `; ${chosen.length} selected by --match "${flags.match}"` : ''}\n`);
  for (const inv of chosen) {
    const label = labelOf(inv);
    const args = mapArgs(inv.args, portal);
    if (args.error) {
      results.push({ inv, label, verdict: 'NOT RUN', why: args.error });
      console.log(`  NOT RUN  ${label}\n           ${args.error}`);
      continue;
    }
    const t0 = Date.now();
    const r = runNpm(path.join(SKILLS, ...inv.manifest.split('/')), inv.script, args.list);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const verdict = r.status === 0 ? 'pass' : 'RED';
    results.push({ inv, label, verdict, code: r.status, secs });
    console.log(`  ${verdict.padEnd(7)}  ${label}   (exit ${r.status === null ? r.signal : r.status}, ${secs}s)`);
    if (r.status !== 0) {
      const lines = `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`.split(/\r?\n/).filter((l) => l.trim());
      for (const l of lines.slice(-TAIL)) console.log(`           | ${l}`);
    }
  }

  const count = (v) => results.filter((x) => x.verdict === v).length;
  const ran = count('pass') + count('RED');
  console.log('');
  console.log(`prove-all: ran ${ran} of ${all.length} invocation(s) CI makes — ${count('pass')} pass, ${count('RED')} red, ${count('NOT RUN')} not run${match ? `, ${all.length - chosen.length} left out by --match "${flags.match}"` : ''}.`);
  if (match) console.log('  A FILTERED run: it says nothing about the invocations it left out.');

  const notInCi = Object.entries(join.notInCi || {})
    .flatMap(([m, t]) => Object.entries(t).map(([name, why]) => ({ m, name, why })));
  console.log(`  ${notInCi.length} script(s) CI does not run, each declared in check-wiring.js's NOT_IN_CI and not run here either:`);
  for (const x of notInCi) console.log(`    ${x.m} ${x.name} — ${x.why.length > 110 ? `${x.why.slice(0, 107)}...` : x.why}`);

  if (count('RED')) {
    console.error(`\nprove-all: RED — ${results.filter((x) => x.verdict === 'RED').map((x) => `${x.inv.manifest} ${x.inv.script}`).join(', ')}`);
    process.exit(1);
  }
  if (count('NOT RUN')) {
    console.error(`\nprove-all: nothing red, but ${count('NOT RUN')} invocation(s) could not be run here, so this is not a clean run.`);
    process.exit(2);
  }
  process.exit(0);
}

/**
 * The workflow's argument string as an argv, with CI's two checkout paths
 * mapped onto this machine. Double-quoted and bare words only: that is every
 * form gates.yml writes, and anything else is refused rather than half-parsed.
 */
function mapArgs(text, portal) {
  if (!text) return { list: [] };
  const list = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(text))) {
    let a = m[1] !== undefined ? m[1] : m[2];
    if (/['`\\]/.test(a)) return { error: `argument ${a} is not a form this runner parses` };
    a = a.replace(/\$\{?GITHUB_WORKSPACE\}?\/skills(?=\/|$)/g, SKILLS.replace(/\\/g, '/'))
      .replace(/\$\{?GITHUB_WORKSPACE\}?\/community-bus-maps(?=\/|$)/g, portal.replace(/\\/g, '/'));
    if (/\$|\{\{/.test(a)) return { error: `argument ${a} names something only the CI runner has` };
    list.push(a);
  }
  if (list.some((a) => a.startsWith(portal.replace(/\\/g, '/'))) && !fs.existsSync(portal)) {
    return { error: `needs the portal checkout, and ${portal} is not there (pass --portal)` };
  }
  return { list };
}

/**
 * `npm run <script> -- <args>` through npm itself, never by reading the
 * script's command out of package.json: a rebuilt command is the drift
 * check-wiring.js exists to refuse. Under `npm run prove:all` npm hands us its
 * own entry point; run directly, `npm` is found on PATH, through the shell on
 * Windows where it is a .cmd.
 */
function runNpm(cwd, script, args) {
  const opts = { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 };
  const cli = process.env.npm_execpath;
  if (cli && /\.c?js$/.test(cli)) {
    return spawnSync(process.execPath, [cli, 'run', script, '--', ...args], opts);
  }
  if (process.platform === 'win32') {
    const q = (a) => `"${a.replace(/"/g, '\\"')}"`;
    return spawnSync(['npm', 'run', script, '--', ...args].map((a, i) => (i < 4 ? a : q(a))).join(' '), { ...opts, shell: true });
  }
  return spawnSync('npm', ['run', script, '--', ...args], opts);
}

if (require.main === module) main();
module.exports = { main, mapArgs };
