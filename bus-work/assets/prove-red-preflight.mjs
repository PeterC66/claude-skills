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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { preflight, pushScope, tierFor, manifestFor, runCheck, npmArm, triggered, engineTransfers } from './preflight.mjs';

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

// CASE 13 — the portal's vendored fixtures are asked on their own, against the
// portal's origin/main (buses-data OA-445). The board prints this join and keeps
// it out of its exit code, so a preflight reading only that exit called a push
// clean which gates.yml then failed. The red case has the portal's WORKING TREE
// already matching — the fix applied locally and not merged — because that is
// the state in which the disk says "in step" and CI says BEHIND.
{
  const SCRIPT = path.resolve(HERE, '..', '..', 'make-bus-leaflet', 'assets', 'portal_fixtures.js');
  const root = mkdtempSync(path.join(tmpdir(), 'preflight-fx-'));
  const portal = path.join(root, 'portal');
  const origin = path.join(root, 'portal.git');
  const rel = path.join('gate-fixtures', 'Areas', '_portal-fixture', 'Town', 'internal.svg');
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
  mkdirSync(path.dirname(path.join(portal, rel)), { recursive: true });
  git(portal, 'init', '-b', 'main');
  git(portal, 'config', 'user.email', 'preflight@test');
  git(portal, 'config', 'user.name', 'preflight');
  git(portal, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(portal, rel), '<svg>old</svg>\n');
  git(portal, 'add', '.');
  git(portal, 'commit', '-m', 'vendored', '--no-verify');
  git(portal, 'remote', 'add', 'origin', origin);
  git(portal, 'push', '-u', 'origin', 'main');
  const buses = path.join(root, 'buses');
  const busesFile = path.join(buses, 'Areas', '_portal-fixture', 'Town', 'internal.svg');
  mkdirSync(path.dirname(busesFile), { recursive: true });
  const arm = (b) => ({ id: 'portal-fixtures', label: 'fixtures', cmd: NODE, args: [SCRIPT, '--buses', b, '--portal', portal], cannotTell: [2] });
  const fx = makeRepo({ manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [arm(buses), arm(path.join(root, 'no-such-buses'))] } });
  const verdicts = () => preflight({ repo: fx.repo }).checks.map((c) => c.verdict);

  writeFileSync(busesFile, '<svg>old</svg>\n');
  let [same, absent] = verdicts();
  check('portal fixtures: in step on origin/main is a pass', same === 'PASS', same);
  check('portal fixtures: no fixture folder is UNANSWERED, never a pass or a finding', absent === 'UNANSWERED', absent);

  writeFileSync(busesFile, '<svg>new</svg>\n');
  writeFileSync(path.join(portal, rel), '<svg>new</svg>\n');
  [same] = verdicts();
  check('portal fixtures: origin/main behind is red even when the portal disk already matches', same === 'FAIL', same);

  const bd = makeRepo({ manifest: null, pushed: ['Development Docs/open-actions/assemble.mjs'] });
  const m = manifestFor(bd.repo);
  rmSync(bd.root, { recursive: true, force: true });
  const built = m && m.checks.find((c) => c.id === 'portal-fixtures');
  check('buses-data: the built-in manifest asks the fixture join itself', !!built && built.args[0].endsWith('portal_fixtures.js'), built ? built.args[0] : 'no portal-fixtures arm');
  check('buses-data: the fixture arm is cheap tier, as gates.yml runs it on every push', !!built && (built.tier || 'cheap') === 'cheap');
  check('buses-data: the fixture arm declares exit 2 as cannot tell', !!built && (built.cannotTell || []).includes(2));
  rmSync(root, { recursive: true, force: true });
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 14 — the stamp arm asks about the tree being PUSHED (buses-data OA-449).
// `docstamp.py --check` resolved to its configured root, so from a worktree it
// hashed the main checkout, printed ok, and CI went red on the worktree's stale
// stamp. The fixture is that state for real: a correctly stamped document on the
// main checkout, and a linked worktree whose commit changed the body and not the
// stamp. The arm is taken from the built-in manifest and run as the preflight
// runs it, so what is asserted is the command, not a description of it.
{
  const fx = makeRepo({ manifest: null, pushed: ['Development Docs/open-actions/assemble.mjs'] });
  const stamped = (body) => {
    const sha = createHash('sha256').update(`# T\n\n${body}\n`, 'utf8').digest('hex').slice(0, 8);
    return `# T\n<!-- docstamp v1.0 | 2026-09-23 | sha=${sha} -->\n**v1.0** · updated 23 September 2026\n\n${body}\n`;
  };
  mkdirSync(path.join(fx.repo, 'docs'), { recursive: true });
  writeFileSync(path.join(fx.repo, 'docs', 'a.md'), stamped('body one'));
  git(fx.repo, 'add', 'docs/a.md');
  git(fx.repo, 'commit', '-m', 'stamped', '--no-verify');
  const wt = path.join(fx.root, 'wt');
  git(fx.repo, 'worktree', 'add', wt, '-b', 'wt');
  const doc = readFileSync(path.join(wt, 'docs', 'a.md'), 'utf8');
  writeFileSync(path.join(wt, 'docs', 'a.md'), doc.replace('body one', 'body two'));
  git(wt, 'commit', '-am', 'body changed, stamp not', '--no-verify');

  const armFor = (r) => { const m = manifestFor(r); return m && m.checks.find((c) => c.id === 'docstamp'); };
  const mainArm = armFor(fx.repo);
  const wtArm = armFor(wt);
  check('docstamp: the arm names the tree it was built for', !!wtArm && wtArm.args.includes(wt), wtArm ? wtArm.args.join(' ') : 'no docstamp arm');
  if (mainArm && wtArm) {
    const control = runCheck(mainArm, fx.repo);
    check('docstamp: a correctly stamped checkout passes (control)', control.verdict === 'PASS', `${control.verdict}: ${control.why || control.out || control.err}`);
    const stale = runCheck(wtArm, wt);
    check('docstamp: a stale stamp committed in a WORKTREE is red', stale.verdict === 'FAIL', `${stale.verdict}: ${stale.why || stale.out}`);
    check('docstamp: the red names the stale document', /docs\/a\.md/.test(`${stale.out}\n${stale.err}`), stale.out);
  }
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 15 — the portal has a manifest, and its npm arms can START (buses-data
// OA-343 item 2). Before 2026-09-24 community-bus-maps matched nothing and got
// the case-7 refusal; and every npm arm anywhere was `spawnSync('npm')`, which is
// ENOENT on Windows, so claude-skills' unit and wiring arms were UNANSWERED on
// the one machine that runs them. The arm is RUN, not described: `--version`
// through the same resolver, so a resolver that names a missing CLI fails here.
{
  const fx = makeRepo({ manifest: null, pushed: ['engine/vendored.json', 'scripts/run-tests.mjs', 'docs/one.md'] });
  const m = manifestFor(fx.repo);
  check('portal: the built-in manifest is the one chosen', !!m && m.name === 'community-bus-maps', m ? m.name : 'no manifest');
  check('portal: a prose-only push is still the FULL tier, as test.yml has no paths filter', !!m && tierFor(['docs/one.md'], m.docsOnly).tier === 'full');
  const ids = m ? m.checks.map((c) => c.id) : [];
  for (const id of ['npm-test', 'verify-area', 'verify-place', 'verify-defaults', 'selfsufficient']) check(`portal: the manifest asks ${id}`, ids.includes(id), ids.join(','));
  const probe = runCheck({ id: 'npm-version', label: 'npm starts', ...npmArm(['--version']) }, fx.repo);
  check('npmArm: an npm arm starts and passes, rather than being UNANSWERED', probe.verdict === 'PASS', `${probe.verdict}: ${probe.why || probe.err || ''}`);
  check('npmArm: and it printed a version, so exit 0 was npm answering', /^\d+\.\d+/.test(probe.out || ''), JSON.stringify(probe.out));
  rmSync(fx.root, { recursive: true, force: true });
}

// CASE 16 — a push that moves the ENGINE PIN asks the estate harnesses (buses-data
// OA-462). 280bd51c moved engine.lock.json, passed this preflight with the board
// green, and failed gates.yml at *Prove the byte gates can go red*, because a
// harness's control diffed. The fixture is that shape: a `when` arm standing for
// the harness, exiting 1, beside a board arm that passes. The red is asserted
// first; the controls then show the arm stays out of a push it is not about, and
// that a scope the tool cannot read never skips it.
{
  const WHEN = ['^engine\\.lock\\.json$', '(^|/)ci-reference/'];
  const manifest = { name: 'fixture', docsOnly: ['^docs/'], checks: [{ ...scripted('board', 0), tier: 'full' }, { ...scripted('harness', 1, 'CONTROL DIFF — High Wycombe Aldi'), tier: 'full', when: WHEN }] };

  const pin = makeRepo({ manifest, pushed: ['engine.lock.json'] });
  let { result, ran } = runWith(pin);
  check('pin push: the estate harness RAN', ran.includes('harness'), ran.join(','));
  check('pin push: its control diff is a FAIL', result.checks.find((c) => c.id === 'harness')?.verdict === 'FAIL');
  check('pin push: a green board does not carry the push — exit 1', result.exit === 1, `exit ${result.exit}`);
  rmSync(pin.root, { recursive: true, force: true });

  const ref = makeRepo({ manifest, pushed: ['Areas/Ramsey/ci-reference/internal.svg'] });
  ({ ran } = runWith(ref));
  check('golden-master push: the estate harness ran', ran.includes('harness'), ran.join(','));
  rmSync(ref.root, { recursive: true, force: true });

  const data = makeRepo({ manifest, pushed: ['Areas/Ramsey/verified-services.json'] });
  ({ result, ran } = runWith(data));
  check('control: a full-tier push that moves neither does NOT run it', !ran.includes('harness') && ran.includes('board'), ran.join(','));
  check('control: and exits 0', result.exit === 0, `exit ${result.exit}`);
  check('control: the arm is named as not asked, never counted as a pass', result.notTriggered.some((c) => c.id === 'harness') && !result.checks.some((c) => c.id === 'harness'));
  rmSync(data.root, { recursive: true, force: true });

  const blind = makeRepo({ manifest, upstream: false });
  ({ ran } = runWith(blind));
  check('no upstream: a scope it cannot read asks the when-arm anyway', ran.includes('harness'), ran.join(','));
  rmSync(blind.root, { recursive: true, force: true });

  const forced = makeRepo({ manifest, pushed: ['docs/one.md'] });
  ({ ran } = runWith(forced, { all: true }));
  check('--all asks the when-arm over a docs-only push', ran.includes('harness'), ran.join(','));
  rmSync(forced.root, { recursive: true, force: true });

  // The built-in buses-data manifest carries both arms, triggered by the pin and
  // not by a map's own data, and runs each as gates.yml does: from make-bus-leaflet.
  const bd = makeRepo({ manifest: null, pushed: ['Development Docs/open-actions/assemble.mjs'] });
  const m = manifestFor(bd.repo);
  rmSync(bd.root, { recursive: true, force: true });
  for (const id of ['prove-red-gates', 'prove-red-status']) {
    const arm = m && m.checks.find((c) => c.id === id);
    check(`buses-data: the built-in manifest asks ${id}`, !!arm, m ? m.checks.map((c) => c.id).join(',') : 'no manifest');
    if (!arm) continue;
    const known = (paths) => ({ known: true, paths });
    check(`buses-data: ${id} is triggered by engine.lock.json`, triggered(arm, known(['engine.lock.json']), false));
    check(`buses-data: ${id} is triggered by a ci-reference/`, triggered(arm, known(['Places/X/ci-reference/routes.json']), false));
    check(`buses-data: ${id} is NOT triggered by a map's S3 config`, !triggered(arm, known(['Areas/Ramsey/S3-config/2026-09-24_1000/routes.json']), false));
    check(`buses-data: ${id} runs from make-bus-leaflet, where its script is`, !!arm.cwd && existsSync(path.join(arm.cwd, arm.args[0])), `${arm.cwd} + ${arm.args[0]}`);
  }
}

// CASE 17 — an estate harness runs at the engine the push PINS, not at the
// checkout's main (buses-data OA-466). On 2026-09-25 claude-skills main had moved
// the control town's ink, so the preflight's prove-red-gates said CONTROL DIFF on
// a push CI then proved 11 of 11 at the pin. The fixture is that state: a skills
// repository whose PIN commit's harness passes and whose HEAD's fails, and a
// buses repository pinning the first. The arm's `cwd` is the checkout, exactly as
// the built-in manifest writes it, so today's code runs HEAD's copy and goes red.
{
  const WHEN = ['^engine\\.lock\\.json$', '(^|/)ci-reference/'];
  const skills = mkdtempSync(path.join(tmpdir(), 'preflight-skills-'));
  git(skills, 'init', '-b', 'main');
  git(skills, 'config', 'user.email', 'preflight@test');
  git(skills, 'config', 'user.name', 'preflight');
  git(skills, 'config', 'commit.gpgsign', 'false');
  const tool = path.join(skills, 'make-bus-leaflet', 'tools', 'h.js');
  mkdirSync(path.dirname(tool), { recursive: true });
  const harness = (tag, code) => `require('fs').appendFileSync(process.env.PF_LOG, '${tag}\\n'); console.log(${JSON.stringify(code ? 'CONTROL DIFF' : 'proved')}); process.exit(${code});\n`;
  writeFileSync(tool, harness('pin', 0));
  git(skills, 'add', '.');
  git(skills, 'commit', '-m', 'pinned engine', '--no-verify');
  const pinSha = git(skills, 'rev-parse', 'HEAD').trim();
  writeFileSync(tool, harness('main', 1));
  git(skills, 'commit', '-am', 'main moved the control town', '--no-verify');

  const arm = { id: 'harness', label: 'estate harness', tier: 'full', when: WHEN, atPin: 'make-bus-leaflet', cwd: path.join(skills, 'make-bus-leaflet'), cmd: NODE, args: ['tools/h.js'] };
  const pinned = (commit) => {
    const fx = makeRepo({ manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [arm] } });
    writeFileSync(path.join(fx.repo, 'engine.lock.json'), JSON.stringify({ commit }));
    git(fx.repo, 'add', 'engine.lock.json');
    git(fx.repo, 'commit', '-m', 'move the pin', '--no-verify');
    return fx;
  };
  const worktrees = () => git(skills, 'worktree', 'list').trim().split('\n').length;

  let fx = pinned(pinSha);
  let { result, ran } = runWith(fx, { skillsRoot: skills });
  const h = result.checks.find((c) => c.id === 'harness');
  check('at-pin: the harness ran the PINNED commit\'s copy, not main\'s', ran.includes('pin') && !ran.includes('main'), ran.join(','));
  check('at-pin: so a push CI would pass is a PASS here', h?.verdict === 'PASS', `${h?.verdict}: ${h?.out || h?.why || ''}`);
  check('at-pin: the report says which commit and how', result.pin?.commit === pinSha && result.pin?.via === 'worktree', JSON.stringify(result.pin));
  check('at-pin: the worktree it made is gone afterwards', worktrees() === 1, git(skills, 'worktree', 'list'));
  rmSync(fx.root, { recursive: true, force: true });

  // The dangerous direction: a pin whose harness FAILS stays red when main passes.
  git(skills, 'checkout', '-q', pinSha);
  writeFileSync(tool, harness('pin', 1));
  git(skills, 'commit', '-qam', 'a pin that really diffs', '--no-verify');
  const badPin = git(skills, 'rev-parse', 'HEAD').trim();
  git(skills, 'checkout', '-q', 'main');
  writeFileSync(tool, harness('main', 0));
  git(skills, 'commit', '-qam', 'main passes', '--no-verify');
  fx = pinned(badPin);
  ({ result, ran } = runWith(fx, { skillsRoot: skills }));
  check('at-pin: a pin whose control diffs is RED even while main passes', result.checks.find((c) => c.id === 'harness')?.verdict === 'FAIL' && ran.includes('pin'), ran.join(','));
  rmSync(fx.root, { recursive: true, force: true });

  // Already AT the pin: the checkout itself is used and no worktree is made.
  const mainSha = git(skills, 'rev-parse', 'HEAD').trim();
  fx = pinned(mainSha);
  ({ result, ran } = runWith(fx, { skillsRoot: skills }));
  check('at-pin: a checkout already at the pin runs in place', result.pin?.via === 'checkout' && ran.includes('main'), JSON.stringify(result.pin));
  rmSync(fx.root, { recursive: true, force: true });

  // A pin the clone cannot produce is UNANSWERED: not main's verdict, not a pass.
  fx = pinned('0123456789abcdef0123456789abcdef01234567');
  ({ result, ran } = runWith(fx, { skillsRoot: skills }));
  const ghost = result.checks.find((c) => c.id === 'harness');
  check('at-pin: an unknown pin is UNANSWERED and nothing ran', ghost?.verdict === 'UNANSWERED' && ran.length === 0, `${ghost?.verdict}; ran ${ran.join(',')}`);
  check('at-pin: and it exits 2', result.exit === 2, `exit ${result.exit}`);
  rmSync(fx.root, { recursive: true, force: true });

  // No engine.lock.json at HEAD: the same refusal, saying why.
  fx = makeRepo({ manifest: { name: 'fixture', docsOnly: ['^docs/'], checks: [arm] }, pushed: ['Places/X/ci-reference/routes.json'] });
  ({ result } = runWith(fx, { skillsRoot: skills }));
  const nolock = result.checks.find((c) => c.id === 'harness');
  check('at-pin: no engine.lock.json is UNANSWERED and says so', nolock?.verdict === 'UNANSWERED' && /engine\.lock\.json/.test(nolock?.why || ''), `${nolock?.verdict}: ${nolock?.why}`);
  rmSync(fx.root, { recursive: true, force: true });

  // The caveat compares against the pin, which is what CI checks out.
  check('engineTransfers: a checkout off the pin does not transfer', engineTransfers(skills, pinSha).transfers === false);
  check('engineTransfers: a checkout at the pin transfers', engineTransfers(skills, mainSha).transfers === true);

  // And the built-in buses-data arms carry the mark.
  const bd = makeRepo({ manifest: null, pushed: ['Development Docs/open-actions/assemble.mjs'] });
  const m = manifestFor(bd.repo);
  rmSync(bd.root, { recursive: true, force: true });
  for (const id of ['prove-red-gates', 'prove-red-status']) {
    const a = m && m.checks.find((c) => c.id === id);
    check(`buses-data: ${id} runs at the pin, from make-bus-leaflet`, a?.atPin === 'make-bus-leaflet', a ? String(a.atPin) : 'no arm');
  }
  rmSync(skills, { recursive: true, force: true });
}

const total = pass + fails.length;
if (fails.length) {
  process.stderr.write(`prove-red-preflight: ${fails.length} of ${total} assertion(s) FAILED\n`);
  for (const f of fails) process.stderr.write(`  ${f}\n`);
  process.exit(1);
}
process.stdout.write(`prove-red-preflight: ${total} assertion(s), all held\n`);
