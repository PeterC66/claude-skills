// Break the push preflight on purpose, and insist it notices.
//
// buses-data OA-343. Every case here is one of the four properties the action
// says are load-bearing, and each is watched go the WRONG way against a
// deliberately broken subject as well as the right way against a correct one.
//
// The control comes first and must stay green: a preflight that reports a red on
// a clean repository is one somebody stops running, which is the same argument
// this estate makes about a gate that is red on day one.
//
// THE CASE THAT IS NOT DECORATION IS 2. `runAll` could pass every other case
// here by stopping at the first failure and reporting it — the report would name
// a real red and the exit code would be right. It would also be the exact shape
// the action exists to remove, *the blocker behind the blocker*, so the
// assertion is on the number of checks that RAN, not on the verdict.
//
// Each case builds a throwaway repository with a real bare origin, because the
// scope question is `origin/main..HEAD` and a fixture that fakes it would be
// testing the fake. The checks themselves are `node -e` one-liners, so nothing
// here depends on the estate's real checkers being installed.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight, pushScope, tierFor, manifestFor } from './preflight.mjs';

const NODE = process.execPath;
// `fileURLToPath`, not `new URL(...).pathname`: this folder is under
// `C:\u3a St Ives\`, so the URL form is percent-encoded and the path it yields
// names nothing. Case 10 spawned a module that did not exist and still SAW
// exit 1 — node's own *cannot find module* — so the assertion passed for the
// wrong reason. An exit-code assertion is paired with one about the OUTPUT.
const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
const fails = [];

function check(what, cond, detail = '') {
  if (cond) { pass += 1; return; }
  fails.push(`${what}${detail ? ` — ${detail}` : ''}`);
}

// stderr is discarded: git narrates line-ending conversions on this machine, and
// a harness whose own scaffolding prints thirty warnings is one whose real
// output nobody reads.
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** A repository with a bare origin, one commit on main, and whatever else the case wants. */
function makeRepo({ manifest, pushed = [], upstream = true }) {
  const root = mkdtempSync(path.join(tmpdir(), 'preflight-'));
  const repo = path.join(root, 'work');
  const origin = path.join(root, 'origin.git');
  mkdirSync(repo);
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'preflight@test');
  git(repo, 'config', 'user.name', 'preflight');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-m', 'base', '--no-verify');
  git(repo, 'remote', 'add', 'origin', origin);
  // The manifest is committed BEFORE the push, so it is part of the base rather
  // than part of what would be pushed. Committing it after made case 1's push
  // contain `.preflight.json`, which is not documentation, so the control was a
  // FULL tier and the case failed on its first run — the fixture's own setup
  // deciding the thing the case is about.
  if (manifest) {
    writeFileSync(path.join(repo, '.preflight.json'), JSON.stringify(manifest, null, 2));
    git(repo, 'add', '.preflight.json');
    git(repo, 'commit', '-m', 'manifest', '--no-verify');
  }
  if (upstream) git(repo, 'push', '-u', 'origin', 'main');
  for (const p of pushed) {
    const full = path.join(repo, p);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, 'x\n');
    git(repo, 'add', p);
    git(repo, 'commit', '-m', `add ${p}`, '--no-verify');
  }
  return { root, repo };
}

/** A check that exits with the code we name, after printing what we name. */
const scripted = (id, code, say = '') => ({
  id,
  label: `scripted exit ${code}`,
  cmd: NODE,
  args: ['-e', `require('fs').appendFileSync(process.env.PF_LOG, '${id}\\n'); console.log(${JSON.stringify(say)}); process.exit(${code});`],
});

/**
 * Run the preflight over a fixture and report which checks actually RAN.
 *
 * The log is the instrument for case 2: a verdict cannot tell a check that ran
 * and passed from one that was never reached, and *the blocker behind the
 * blocker* is precisely the second shape.
 */
function runWith(fixture, opts = {}) {
  const log = path.join(fixture.root, 'ran.log');
  writeFileSync(log, '');
  process.env.PF_LOG = log;
  const result = preflight({ repo: fixture.repo, ...opts });
  const ran = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { result, ran };
}

// ---------------------------------------------------------------------------

// CASE 1 — the control. Three passing checks on a docs-only push: green, and it
// says so, and it ran exactly the cheap tier.
{
  const fx = makeRepo({
    manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [scripted('a', 0), scripted('b', 0), { ...scripted('c', 0), tier: 'full' }] },
    pushed: ['docs/one.md', 'docs/two.md'],
  });
  const { result, ran } = runWith(fx);
  check('control: exits 0', result.exit === 0, `exit ${result.exit}`);
  check('control: tier is cheap for a docs-only push', result.tier.tier === 'cheap', result.tier.tier);
  check('control: the full-tier check did NOT run', !ran.includes('c'), ran.join(','));
  check('control: both cheap checks ran', ran.includes('a') && ran.includes('b'), ran.join(','));
  check('control: nothing is reported red', result.checks.every((c) => c.verdict === 'PASS'));
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 2 — THE ONE THAT MATTERS. A failure in the MIDDLE must not stop the
// checks after it. This is the shape CI's job ordering has, and copying it would
// reproduce the fault the action was filed about.
{
  const fx = makeRepo({
    manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [scripted('a', 0), scripted('b', 1), scripted('c', 1), scripted('d', 0)] },
    pushed: ['docs/one.md'],
  });
  const { result, ran } = runWith(fx);
  check('blocker-behind-the-blocker: every check ran despite an early failure', ran.length === 4, `ran ${ran.join(',')}`);
  check('blocker-behind-the-blocker: BOTH failures are reported, not just the first', result.checks.filter((c) => c.verdict === 'FAIL').length === 2);
  check('a failing tier exits 1', result.exit === 1, `exit ${result.exit}`);
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 3 — a check whose command does not exist is UNANSWERED and never a pass,
// and it takes the exit code with it. A preflight that reports clear over a
// check it could not run is the most expensive kind of green.
{
  const fx = makeRepo({
    manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [scripted('a', 0), { id: 'ghost', label: 'a tool that is not installed', cmd: 'definitely-not-a-program-preflight', args: [] }] },
    pushed: ['docs/one.md'],
  });
  const { result } = runWith(fx);
  const ghost = result.checks.find((c) => c.id === 'ghost');
  check('a missing tool is UNANSWERED', ghost.verdict === 'UNANSWERED', ghost.verdict);
  check('a missing tool is not counted as a pass', result.checks.filter((c) => c.verdict === 'PASS').length === 1);
  check('unanswered alone exits 2, not 0', result.exit === 2, `exit ${result.exit}`);
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 4 — the verdict comes from the exit STATUS. `docstamp.py --check` printed
// `rc=0` beside the words *1 need attention* when its status was read through a
// pipe; a check that prints a reassuring last line and exits 1 is a FAIL.
{
  const fx = makeRepo({
    manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [scripted('reassuring', 1, '0 need attention -- all good')] },
    pushed: ['docs/one.md'],
  });
  const { result } = runWith(fx);
  check('a reassuring last line does not turn a non-zero exit green', result.checks[0].verdict === 'FAIL', result.checks[0].verdict);
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 5 — the tier scales to what the push CONTAINS, and the dangerous
// direction is the one asserted first: a push reaching beyond documentation must
// NOT be treated as cheap.
{
  const fx = makeRepo({
    manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [scripted('a', 0), { ...scripted('c', 0), tier: 'full' }] },
    pushed: ['docs/one.md', 'Areas/Ramsey/verified-services.json'],
  });
  const { result, ran } = runWith(fx);
  check('a push touching map data is FULL', result.tier.tier === 'full', result.tier.tier);
  check('the full-tier check ran', ran.includes('c'), ran.join(','));
  check('the path beyond documentation is named', result.tier.beyond.some((p) => p.startsWith('Areas/')), result.tier.beyond.join(','));
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 6 — a branch with no upstream is a question this tool cannot answer, and
// that is a different thing from a push containing nothing.
{
  const fx = makeRepo({ manifest: { name: 'fixture', docsOnly: [], checks: [scripted('a', 0)] }, upstream: false });
  const { result } = runWith(fx);
  check('no upstream: the scope is NOT claimed as known', result.scope.known === false);
  check('no upstream: it says why', /upstream/.test(result.scope.why), result.scope.why);
  check('no upstream: exits 2 even when every check passes', result.exit === 2, `exit ${result.exit}`);
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 7 — a repository that declares nothing and matches no built-in gets a
// REFUSAL, not a clean bill of health. `check-doc-coverage` and its siblings
// have the same rule: a check that cannot find its subject must not report clear.
{
  const fx = makeRepo({ manifest: null, pushed: ['docs/one.md'] });
  const { result } = runWith(fx);
  check('an undeclared repository runs no checks', result.checks.length === 0);
  check('an undeclared repository exits 2', result.exit === 2, `exit ${result.exit}`);
  check('an undeclared repository says nothing was checked', result.unanswered.join(' ').includes('NOTHING was checked'));
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 8 — `echo` surfaces a line even on a PASS, because which TREE a tool read
// is invisible in its verdict. This is OA-333's trap surviving its own fix:
// `docstamp.py --root buses` resolves to the configured root, not the tree you
// are standing in, and only its own `scope:` line says so.
{
  const fx = makeRepo({
    manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [{ ...scripted('scoped', 0, "scope: root 'buses' (cwd is the root)"), echo: ['^scope:'] }] },
    pushed: ['docs/one.md'],
  });
  const { result } = runWith(fx);
  check('a passing check still surfaces its declared echo line', result.checks[0].echoed.some((l) => l.startsWith('scope:')), JSON.stringify(result.checks[0].echoed));
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 9 — `--all` forces the full tier on a docs-only push, for the round where
// somebody wants everything asked regardless of what the diff says.
{
  const fx = makeRepo({
    manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [scripted('a', 0), { ...scripted('c', 0), tier: 'full' }] },
    pushed: ['docs/one.md'],
  });
  const { ran } = runWith(fx, { all: true });
  check('--all runs the full tier over a docs-only push', ran.includes('c'), ran.join(','));
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 10 — the exit codes are real at the command line, not only in the
// exported function, and the report names the failure. Read unpiped, because a
// harness about exit codes that reads one through a pipe is the fault it is for.
{
  const fx = makeRepo({
    manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [scripted('a', 0), scripted('b', 1)] },
    pushed: ['docs/one.md'],
  });
  const log = path.join(fx.root, 'ran.log');
  writeFileSync(log, '');
  const r = spawnSync(NODE, [path.join(HERE, 'preflight.mjs'), '--repo', fx.repo], { encoding: 'utf8', env: { ...process.env, PF_LOG: log } });
  check('cli: exits 1 when a check fails', r.status === 1, `exit ${r.status}: ${r.stderr}`);
  check('cli: the report names the failing check', /WOULD GO RED/.test(r.stdout) && /\bb\b/.test(r.stdout), r.stdout.slice(0, 300));
  check('cli: the report always ends with what it did not ask', /WHAT THIS DID NOT ASK/.test(r.stdout));
  const j = spawnSync(NODE, [path.join(HERE, 'preflight.mjs'), '--repo', fx.repo, '--json'], { encoding: 'utf8', env: { ...process.env, PF_LOG: log } });
  let parsed = null;
  try { parsed = JSON.parse(j.stdout); } catch { /* left null so this REPORTS rather than throwing the harness over */ }
  check('cli: --json parses and carries the verdicts', !!parsed && parsed.checks.length === 2, `stdout ${j.stdout.length} byte(s); stderr: ${(j.stderr || '').split('\n')[0]}`);
  check('cli: --json writes the whole document before exiting', j.stdout.trim().endsWith('}'), `ends ${JSON.stringify(j.stdout.slice(-40))}`);
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 11 — the two pure functions, asserted directly, so a refactor of the
// runner cannot quietly change what a tier MEANS.
{
  check('tierFor: an empty push is cheap', tierFor([], ['^docs/']).tier === 'cheap');
  check('tierFor: a workflow edit is full', tierFor(['.github/workflows/gates.yml'], ['^docs/']).tier === 'full');
  check('tierFor: a docsOnly list of nothing makes every push full', tierFor(['docs/x.md'], []).tier === 'full');
  check('pushScope: a folder that is no repository is not claimed as known', pushScope(tmpdir()).known === false);
}

// CASE 12 — the buses-data backlog arm asks about what is COMMITTED, not the
// disk. Read from the disk it was red for every session while a neighbour held
// an uncommitted claim, and the loop stopped pushing (buses-data OA-441). The
// assembler's own harness proves `--from-index` ignores an unstaged edit; this
// proves the preflight still asks for it.
{
  const fx = makeRepo({ manifest: null, pushed: ['Development Docs/open-actions/assemble.mjs'] });
  const m = manifestFor(fx.repo);
  const arm = m && m.checks.find((c) => c.id === 'backlog-index');
  check('buses-data: the built-in manifest is the one chosen', !!m && m.name === 'buses-data', m ? m.name : 'no manifest');
  check('buses-data: the backlog arm reads the index, not the working tree', !!arm && arm.args.includes('--check') && arm.args.includes('--from-index'), arm ? arm.args.join(' ') : 'no backlog-index arm');
  rmSync(fx.root, { recursive: true, force: true });
}

const total = pass + fails.length;
if (fails.length) {
  process.stderr.write(`prove-red-preflight: ${fails.length} of ${total} assertion(s) FAILED\n`);
  for (const f of fails) process.stderr.write(`  ${f}\n`);
  process.exit(1);
}
process.stdout.write(`prove-red-preflight: ${total} assertion(s), all held\n`);
