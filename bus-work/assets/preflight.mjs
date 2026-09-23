// What would go red if I pushed now.
//
// buses-data OA-343, from Peter on 2026-09-14: *I want us to avoid the system
// being in a BROKEN state, or at least sort it out quickly.* Landing OA-338 left
// `buses-data` `main` red for about seven hours and met FOUR independent
// blockers one at a time — byte-gate control diff, portal vendoring drift, the
// deployment row BEHIND, the portal's own `verify:area` on a stale fixture.
// Each was correct, nothing was relaxed, and every one of them was answerable on
// this laptop in under two minutes before the first push. Three CI round trips
// were spent discovering, in sequence, facts that were all true before any of
// them started.
//
// Four properties are load-bearing, and each comes from a specific thing that
// went wrong rather than from a wish list.
//
// 1. IT DOES NOT STOP AT THE FIRST FAILURE. CI's job ordering hid three of the
//    four blockers, which is this estate's named shape *the blocker behind the
//    blocker*. A preflight that copies the ordering copies the fault, so every
//    check in the tier runs and the report names every failure.
//
// 2. IT SUPPRESSES NOTHING. No `--no-live`, no `--register-only`. A flag that
//    makes it cheap is the flag that will hide the next blocker — `status.js`'s
//    most useful row for this purpose is the one `--no-live` switches off, which
//    is how the deployment row went unasked.
//
// 3. IT SCALES TO WHAT THE PUSH CONTAINS. Hand-run before a docs-only push on
//    2026-09-14 the cheap version yielded zero true findings and one false
//    alarm, and a preflight whose false positives outnumber its true ones is one
//    somebody stops running — the same argument this estate already makes about
//    a gate that is red on day one. So the first question is what the push
//    touches, answered from `origin/main..HEAD`, and the answer picks the tier.
//
// 4. IT SAYS WHAT IT CANNOT ANSWER. A check whose script is missing is
//    UNANSWERED and exits non-zero; it is never a pass. And the report always
//    ends with the questions it never asked, because `fixtureFreshness` being
//    `[]` was read as coverage when it was blindness.
//
// TWO INSTRUMENTS MISLED THE HAND-RUN AND BOTH ARE HANDLED HERE. Every exit
// status is read from `spawnSync().status` with no shell and no pipe, because
// `docstamp.py --check` printed `rc=0` beside the words *1 need attention* when
// its status was read through `tail` — this repository's own *refusal that
// depended on how you read it*. And a check may declare `echo`, a list of
// patterns whose matching output lines are surfaced even on a PASS, because
// which tree a tool read is invisible in its verdict. `docstamp.py` resolved to
// its CONFIGURED root rather than the tree being pushed, so from a worktree it
// passed a stale stamp CI then failed; the stamp arm now runs the committed-stamp
// auditor against `--repo` itself (buses-data OA-449).
//
// WHAT IT IS NOT. It is not fast — running a sibling repository's byte gates is
// minutes — and it is not run per commit. It is run once per round, and the
// thing it replaces is three CI round trips plus the analysis between them.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, assetsDir, resolvePortal } from './engine.mjs';

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_CANNOT_TELL = 2;

/** git, with no shell and no pipe, from a named directory. */
function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** The repository a run is ABOUT: the one ENCLOSING the folder, never the folder. */
export function repoRoot(from) {
  const r = git(from, ['rev-parse', '--show-toplevel']);
  return r.ok ? path.resolve(r.out) : null;
}

/**
 * What the push CONTAINS.
 *
 * The upstream is asked for rather than assumed: a branch with none is not a
 * push whose contents are zero, it is a question this tool cannot answer, and
 * the two must not report the same way.
 */
export function pushScope(repo) {
  const up = git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (!up.ok) return { known: false, why: 'this branch has no upstream, so there is no "what would this push contain" to answer', upstream: null, paths: [] };
  const diff = git(repo, ['diff', '--name-only', `${up.out}..HEAD`]);
  if (!diff.ok) return { known: false, why: `git diff ${up.out}..HEAD failed: ${diff.err}`, upstream: up.out, paths: [] };
  const paths = diff.out ? diff.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const dirty = git(repo, ['status', '--porcelain']);
  return {
    known: true,
    upstream: up.out,
    paths,
    branch: git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).out,
    dirtyCount: dirty.ok && dirty.out ? dirty.out.split('\n').filter(Boolean).length : 0,
  };
}

/**
 * Which tier a push earns.
 *
 * `docsOnly` is the population `gates.yml` already carries: a push touching only
 * those paths runs no falsification harness there, and its byte gates read
 * inputs that by construction have not moved. Anything else is a full round.
 * An EMPTY push is `cheap` rather than `none`, because a branch level with its
 * upstream is a state worth reporting rather than a reason to skip the report.
 */
export function tierFor(paths, docsOnly) {
  const res = docsOnly.map((p) => new RegExp(p));
  const beyond = paths.filter((p) => !res.some((re) => re.test(p)));
  return { tier: beyond.length ? 'full' : 'cheap', beyond };
}

/*
 * Where the shared checkers are, asked of the engine rather than typed.
 *
 * Until 2026-09-17 the three constants below were literal paths on Peter's
 * laptop (buses-data OA-345). `assetsDir()` is the resolver every other tool in
 * this skill reaches the engine through — `BUS_SKILL_ASSETS`, then the sibling
 * skills tree beside this file, then the two named fallbacks — so a checkout
 * anywhere else, or a session with the environment variable set, now gets the
 * engine it is actually running rather than a path that happens to exist here.
 *
 * `skillsRoot` is the tree those two live under, and `stamp-docs` is in it too,
 * so the auditor is asked of that tree first and of the user profile's junction
 * second. Profile-only, it named a file that does not exist on a CI runner, and
 * a worktree ran `main`'s copy rather than its own (buses-data OA-449). Neither
 * found is a null, which the manifest reports as UNANSWERED, never as a pass.
 */
function skillPaths() {
  const engine = assetsDir();
  const skillsRoot = engine ? path.resolve(engine, '..', '..') : null;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return {
    ENGINE: engine,
    SKILLS: skillsRoot,
    TOOLS: skillsRoot ? path.join(skillsRoot, 'tools') : null,
    STAMP: [skillsRoot, home && path.join(home, '.claude', 'skills')]
      .filter(Boolean)
      .map((root) => path.join(root, 'stamp-docs', 'scripts', 'check_committed_stamps.py'))
      .find((p) => existsSync(p)) || null,
  };
}

/** The built-in manifests, used only where a repository declares none of its own. */
function builtIn(repo) {
  const has = (p) => existsSync(path.join(repo, p));
  const { ENGINE, SKILLS, TOOLS, STAMP } = skillPaths();
  if (has('Development Docs/open-actions/assemble.mjs')) {
    return {
      name: 'buses-data',
      docsOnly: ['^Development Docs/', '^Documentation/', '^Correspondence/', '^BusMapsUK/', '^CLAUDE\\.md$', '^README\\.md$', '^loop/README\\.md$'],
      checks: [
        /* `check_committed_stamps.py <repo>`, the auditor gates.yml runs, and not
         * `docstamp.py --check`: that one resolves to its CONFIGURED root whatever
         * tree you stand in, so from a worktree it hashed the main checkout's
         * disk, printed ok, and CI went red on the stale stamp this tree carried
         * (buses-data OA-449). This one reads HEAD of the tree it is given. */
        STAMP && { id: 'docstamp', label: 'every committed document describes its committed content', cmd: 'python3', args: [STAMP, repo] },
        TOOLS && { id: 'tables', label: 'tables are still tables', cmd: 'node', args: [`${TOOLS}/check-tables.mjs`] },
        TOOLS && { id: 'doc-links', label: 'links, anchors and documented commands resolve', cmd: 'node', args: [`${TOOLS}/check-doc-links.mjs`] },
        TOOLS && { id: 'file-hygiene', label: 'no BOM, no trailing whitespace, no missing final newline', cmd: 'node', args: [`${TOOLS}/check-file-hygiene.mjs`, '--root', '.'] },
        TOOLS && { id: 'acronyms', label: 'every short form can be looked up', cmd: 'node', args: [`${TOOLS}/check-doc-acronyms.mjs`] },
        /* --from-index, because a push carries what is COMMITTED and CI checks it
         * out with nothing else beside it. Read from the disk, this arm went red
         * for every session whenever a neighbour held an uncommitted `--claim` —
         * a difference the push did not contain — and the loop, which pushes on
         * exit 0 only, stopped pushing (buses-data OA-441). The index is the
         * committed tree plus whatever the caller has staged, and a claim is
         * never staged by the tool that writes it. */
        { id: 'backlog-index', label: 'the backlog index matches every committed action file', cmd: 'node', args: ['Development Docs/open-actions/assemble.mjs', '--check', '--from-index'] },
        { id: 'doc-coverage', label: 'every working document is reachable from live work', cmd: 'node', args: ['Documentation/check-doc-coverage.mjs'] },
        { id: 'directory-coverage', label: 'every map has an answer to does somebody else map this town', cmd: 'node', args: ['BusMapsUK/bus-map-directory/coverage.mjs', '--check'] },
        TOOLS && { id: 'exclusion-fields', label: 'a town declares a route off in notOnLeaflet[] and nowhere else', cmd: 'node', args: [`${TOOLS}/check-exclusion-fields.mjs`] },
        TOOLS && { id: 's6-claims', label: 'every S6 claim has a home, and the operator join resolves', cmd: 'node', args: [`${TOOLS}/check-s6-claims.mjs`], note: 'run WITHOUT --register-only: the coverage half is the half CI cannot run' },
        /* The board prints this join and keeps it out of its exit code, because a
         * behind fixture is a chore (OA-396) — so reading only the board's exit,
         * this called a push clean that gates.yml then failed (buses-data OA-445).
         * Cheap tier, because gates.yml runs its twin on EVERY push. */
        ENGINE && { id: 'portal-fixtures', label: 'the portal\'s vendored fixtures are in step with this repository, on its origin/main', cmd: 'node', args: [`${ENGINE}/portal_fixtures.js`, '--buses', repo, '--portal', resolvePortal()], cannotTell: [2] },
        ENGINE && { id: 'board', label: 'the board, unsuppressed — byte gates, vendoring, the quality ratchet, S6 staleness, deployment drift', tier: 'full', cmd: 'node', args: [`${ENGINE}/status.js`, '--buses', repo, '--portal', resolvePortal()], note: 'no --no-live: the deployment row is the one that flag hides' },
        ENGINE && { id: 'area-fixture', label: 'the committed area fixture reproduces', tier: 'full', cmd: 'node', args: [`${ENGINE}/refresh_area_fixture.js`, '--check'] },
      ].filter(Boolean),
      unanswered: [
        'Whether the PORTAL suite is green — its `verify:area` gates a fixture that lives in this repository, and nothing on this side runs another repository\'s gates.',
        'Anything that needs the network: whether a pull request is open, what origin holds that this checkout has not fetched, whether the live host answers.',
        /* A missing engine tree is a REFUSAL and is said out loud. It used to be
         * a path literal that simply was not there, which reads as a check that
         * failed rather than as one that could not be run (OA-345). */
        ...(ENGINE ? [] : ['Every check that needs the engine or the shared checkers — the board, the portal\'s vendored fixtures, the area fixture, tables, links, hygiene, acronyms, exclusion fields and S6 claims. NO skills tree was found: set BUS_SKILL_ASSETS, or run this beside one. That is a refusal, not a pass.']),
        ...(STAMP ? [] : ['The docstamp check — `stamp-docs/scripts/check_committed_stamps.py` is neither in the skills tree nor under the user profile. That is a refusal, not a pass.']),
      ],
    };
  }
  if (has('make-bus-leaflet/assets/status.js')) {
    return {
      name: 'claude-skills',
      docsOnly: ['^docs/', '^README\\.md$', '^CLAUDE\\.md$', '\\.md$'],
      checks: [
        { id: 'tables', label: 'tables are still tables', cmd: 'node', args: ['tools/check-tables.mjs', '--tree', '.'] },
        { id: 'doc-links', label: 'links, anchors and documented commands resolve', cmd: 'node', args: ['tools/check-doc-links.mjs'] },
        { id: 'file-hygiene', label: 'no BOM, no trailing whitespace, no missing final newline', cmd: 'node', args: ['tools/check-file-hygiene.mjs', '--root', '.'] },
        { id: 'acronyms', label: 'every short form can be looked up', cmd: 'node', args: ['tools/check-doc-acronyms.mjs'] },
        { id: 'unit', label: 'the unit suite', tier: 'full', cmd: 'npm', args: ['test', '--prefix', 'make-bus-leaflet'] },
        { id: 'wiring', label: 'every test:/gate: script is run by a workflow, through its npm script', tier: 'full', cmd: 'npm', args: ['run', 'gate:wiring', '--prefix', 'make-bus-leaflet'] },
      ],
      unanswered: [
        'Whether an engine change has its estate rebuild — `prove-red-held-back` needs a town in buses-data carrying the new engine stamp, and that town is in the other repository (OA-341).',
      ],
    };
  }
  return null;
}

/** A repository's own declaration wins over the built-in; neither is invented. */
export function manifestFor(repo) {
  const declared = path.join(repo, '.preflight.json');
  if (existsSync(declared)) {
    const m = JSON.parse(readFileSync(declared, 'utf8'));
    return { ...m, source: '.preflight.json' };
  }
  const b = builtIn(repo);
  return b ? { ...b, source: 'built-in default' } : null;
}

const tail = (s, n) => (s || '').trim().split('\n').filter(Boolean).slice(-n).join('\n');

/**
 * Run one check.
 *
 * The verdict comes from the exit STATUS and from nothing else. A check that
 * prints a reassuring last line and exits 1 is a FAIL, which is the whole of
 * what the piped-`tail` reading of `docstamp.py` got wrong.
 */
export function runCheck(check, repo) {
  const started = Date.now();
  const cwd = check.cwd ? path.resolve(repo, check.cwd) : repo;
  const r = spawnSync(check.cmd, check.args || [], { cwd, encoding: 'utf8' });
  const ms = Date.now() - started;
  if (r.error) return { ...check, verdict: 'UNANSWERED', ms, why: `${check.cmd} could not be run: ${r.error.code || r.error.message}`, echoed: [] };
  if (r.status === null) return { ...check, verdict: 'UNANSWERED', ms, why: `${check.cmd} was killed by ${r.signal || 'a signal'} and never returned a status`, echoed: [] };
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const echoed = (check.echo || []).flatMap((p) => text.split('\n').filter((l) => new RegExp(p).test(l)).map((l) => l.trim()));
  // A check may declare the exit codes that mean "could not ask", so its refusal
  // reads as a refusal and never as a finding about the push (property 4).
  if ((check.cannotTell || []).includes(r.status)) return { ...check, verdict: 'UNANSWERED', status: r.status, ms, why: `${check.id} exited ${r.status}, which it declares as cannot tell: ${tail(r.stdout, 1) || tail(r.stderr, 1)}`, echoed };
  return {
    ...check,
    verdict: r.status === 0 ? 'PASS' : 'FAIL',
    status: r.status,
    ms,
    echoed,
    out: tail(r.stdout, 6),
    err: tail(r.stderr, 6),
  };
}

/**
 * The sibling caveat, and it is the one nobody thinks to ask.
 *
 * `buses-data`'s `gates.yml` checks `claude-skills` out with NO `ref:`, so the
 * engine a push is gated against is whatever that repository's `main` holds when
 * the run starts — never the working tree these gates just ran against. A local
 * PASS therefore transfers only while the engine tree is clean and level with
 * its own origin, and when it is not, saying so is worth more than the PASS.
 */
export function engineTransfers(engineRepo) {
  if (!engineRepo || !existsSync(path.join(engineRepo, '.git'))) return { known: false, why: `no engine checkout found at ${engineRepo || '(unresolved)'}` };
  const dirty = git(engineRepo, ['status', '--porcelain', '--', 'make-bus-leaflet/assets', 'make-place-bus-leaflet/assets']);
  const ahead = git(engineRepo, ['rev-list', '--count', 'origin/main..HEAD']);
  const branch = git(engineRepo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!dirty.ok || !ahead.ok) return { known: false, why: 'the engine checkout could not be read' };
  const dirtyFiles = dirty.out ? dirty.out.split('\n').filter(Boolean).length : 0;
  const aheadN = Number(ahead.out || 0);
  const transfers = dirtyFiles === 0 && aheadN === 0 && branch.out === 'main';
  return { known: true, transfers, dirtyFiles, ahead: aheadN, branch: branch.out };
}

function report(result, quiet) {
  const L = [];
  L.push(`preflight — ${result.repoName} (${result.repo})`);
  if (!result.scope.known) {
    L.push(`  CANNOT TELL — ${result.scope.why}`);
  } else {
    L.push(`  ${result.scope.branch} vs ${result.scope.upstream}: ${result.scope.paths.length} path(s) would be pushed · tier ${result.tier.tier.toUpperCase()}`);
    if (result.tier.beyond.length) L.push(`  beyond documentation: ${result.tier.beyond.slice(0, 6).join(', ')}${result.tier.beyond.length > 6 ? ` (+${result.tier.beyond.length - 6} more)` : ''}`);
    if (result.scope.dirtyCount) L.push(`  NOTE ${result.scope.dirtyCount} file(s) are modified and are NOT in this push — this preflight measured the WORKING TREE, which is not what would be pushed`);
  }
  L.push(`  checks from ${result.source}`);
  L.push('');
  for (const c of result.checks) {
    const mark = c.verdict === 'PASS' ? ' ok ' : c.verdict === 'FAIL' ? 'FAIL' : ' ?? ';
    L.push(`  [${mark}] ${c.id} — ${c.label}${c.ms != null ? ` (${(c.ms / 1000).toFixed(1)}s)` : ''}`);
    for (const e of c.echoed || []) L.push(`         ${e}`);
    if (c.verdict === 'UNANSWERED') L.push(`         ${c.why}`);
  }
  const failed = result.checks.filter((c) => c.verdict === 'FAIL');
  const unanswered = result.checks.filter((c) => c.verdict === 'UNANSWERED');
  if (failed.length && !quiet) {
    L.push('');
    L.push(`WOULD GO RED — ${failed.length} of ${result.checks.length}:`);
    for (const c of failed) {
      L.push(`  ${c.id} (exit ${c.status}) — ${c.label}`);
      for (const line of [...(c.out ? c.out.split('\n') : []), ...(c.err ? c.err.split('\n') : [])]) L.push(`      ${line}`);
    }
  }
  L.push('');
  L.push('WHAT THIS DID NOT ASK:');
  if (result.engine && result.engine.known && !result.engine.transfers) {
    L.push(`  Whether these verdicts TRANSFER. CI gates this repository against claude-skills' origin/main; the engine here is on ${result.engine.branch}, ${result.engine.ahead} commit(s) ahead of origin/main, with ${result.engine.dirtyFiles} uncommitted file(s) under a hashed assets folder. A byte gate that passed locally was measured against an engine CI will not use.`);
  } else if (result.engine && result.engine.known) {
    L.push('  The engine checkout is on main, clean under assets/ and level with origin/main, so a byte-gate verdict here is about the same engine CI will check out.');
  } else if (result.engine) {
    L.push(`  Whether these verdicts transfer to CI's engine: ${result.engine.why}.`);
  }
  for (const u of result.unanswered || []) L.push(`  ${u}`);
  for (const c of unanswered) L.push(`  ${c.id}: ${c.why}`);
  L.push('');
  L.push(`${failed.length} would go red · ${unanswered.length} unanswered · ${result.checks.filter((c) => c.verdict === 'PASS').length} pass · tier ${result.tier.tier}`);
  return L.join('\n');
}

export function preflight({ repo, all = false }) {
  const scope = pushScope(repo);
  const manifest = manifestFor(repo);
  if (!manifest) {
    return {
      repo, repoName: path.basename(repo), scope, source: 'nothing', checks: [], tier: { tier: 'unknown', beyond: [] },
      unanswered: [`This repository declares no .preflight.json and matches no built-in manifest, so NOTHING was checked. That is a refusal, not a pass.`],
      exit: EXIT_CANNOT_TELL,
    };
  }
  const tier = scope.known ? tierFor(scope.paths, manifest.docsOnly || []) : { tier: 'full', beyond: [] };
  const wanted = all || tier.tier === 'full' ? manifest.checks : manifest.checks.filter((c) => (c.tier || 'cheap') === 'cheap');
  const checks = wanted.map((c) => runCheck(c, repo));
  /* Resolved, not typed — and `engineTransfers` already reports an unresolved
   * tree as `known: false` with its reason, which is the answer a refusal wants
   * rather than a literal that happens to exist on one laptop (OA-345). */
  const engine = manifest.name === 'buses-data' ? engineTransfers(skillPaths().SKILLS) : null;
  const failed = checks.filter((c) => c.verdict === 'FAIL').length;
  const unanswered = checks.filter((c) => c.verdict === 'UNANSWERED').length;
  const exit = failed ? EXIT_FAILED : (unanswered || !scope.known) ? EXIT_CANNOT_TELL : EXIT_OK;
  return { repo, repoName: manifest.name, scope, tier: all ? { tier: 'full (forced by --all)', beyond: tier.beyond } : tier, source: manifest.source, checks, engine, unanswered: manifest.unanswered || [], exit };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const from = args.repo ? path.resolve(String(args.repo)) : process.cwd();
  const repo = repoRoot(from);
  if (!repo) {
    process.stderr.write(`preflight: ${from} is not inside a git repository\n`);
    process.exitCode = EXIT_CANNOT_TELL;
    return;
  }
  const result = preflight({ repo, all: !!args.all });
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${report(result, !!args.quiet)}\n`);
  // `process.exitCode` rather than `process.exit()`: a write to a PIPE is
  // asynchronous on Windows, and `process.exit()` tears the process down before
  // it drains. The harness's `--json` case read an EMPTY stdout beside a correct
  // exit code — a tool whose entire output is a verdict, losing the verdict and
  // keeping the code, only when somebody reads it through a pipe.
  process.exitCode = result.exit;
}

// The basename is compared EXACTLY rather than with `endsWith`, which every
// other module in this folder uses and which is safe for them only by accident:
// this folder's convention puts `prove-red-<thing>.mjs` beside `<thing>.mjs`,
// and `'prove-red-preflight.mjs'.endsWith('preflight.mjs')` is TRUE. The
// harness's first run drew a full preflight report before its first assertion,
// because importing the module ran it. The older pairs escape only because they
// spell the module with an underscore and the harness with hyphens.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || path.basename(process.argv[1] || '') === 'preflight.mjs') main();
