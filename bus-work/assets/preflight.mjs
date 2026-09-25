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
import { existsSync, readFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/*
 * An npm arm, run as `node npm-cli.js`, because `spawnSync('npm')` with no shell
 * is ENOENT on Windows — npm is `npm.cmd` there, and Node refuses to spawn a
 * `.cmd` without a shell. Until 2026-09-24 the claude-skills manifest's `unit`
 * and `wiring` arms were therefore UNANSWERED on the only machine that runs this
 * (buses-data OA-343): honest, since a refusal exits 2, and never once asked.
 * The CLI is looked for beside the running node, in the Windows layout and then
 * the Unix one; neither found falls back to plain `npm`, whose failure to start
 * is reported as UNANSWERED by `runCheck` rather than as a pass.
 */
export function npmArm(args) {
  const dir = path.dirname(process.execPath);
  const cli = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((p) => existsSync(p));
  return cli ? { cmd: process.execPath, args: [cli, ...args] } : { cmd: 'npm', args };
}

/*
 * A check may carry `when`, a list of patterns: it is asked only if a pushed
 * path matches one, on top of its tier. An unknown scope or `--all` asks it
 * anyway, because "could not tell what the push holds" must never skip a check.
 * These are the paths that move what the estate harnesses read: the engine pin,
 * and any map's tracked golden master.
 */
const ESTATE_INPUTS = ['^engine\\.lock\\.json$', '(^|/)ci-reference/'];

export function triggered(check, scope, all) {
  if (!check.when || all || !scope.known) return true;
  return scope.paths.some((p) => check.when.some((w) => new RegExp(w).test(p)));
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
        /* The two falsification steps a pin bump fails on (buses-data OA-462).
         * On 2026-09-24 a push moving engine.lock.json passed this preflight with
         * the board green and failed gates.yml at *Prove the byte gates can go
         * red*: High Wycombe Aldi, the place-schematic donor, predated the engine
         * change, so the harness's own CONTROL diffed. The board cannot see that,
         * because a harness's control is not a board row. Run as gates.yml runs
         * them, from make-bus-leaflet with --buses and --portal, and only when
         * the push moves the pin or a golden master: they take minutes, and every
         * other push reads inputs neither harness is about.
         *
         * `atPin`, because gates.yml runs both from claude-skills checked out at
         * engine.lock.json's commit, not at main (buses-data OA-466). On
         * 2026-09-25 main had moved Beaconsfield's ink, the harness's control
         * town, so this arm said CONTROL DIFF where CI would have proved 11 of 11
         * — a refusal of a push CI would pass. `cwd` stays the local checkout's
         * folder so the arm reads where its script is; `atPin` re-roots it. */
        ENGINE && { id: 'prove-red-gates', label: 'the byte gates can go red — every control reproduces under the pinned engine', tier: 'full', when: ESTATE_INPUTS, atPin: 'make-bus-leaflet', cwd: path.resolve(ENGINE, '..'), cmd: 'node', args: ['tools/prove-red-gates.js', '--buses', repo, '--portal', resolvePortal()] },
        ENGINE && { id: 'prove-red-status', label: 'the status board separates a fault from a chore, under the pinned engine', tier: 'full', when: ESTATE_INPUTS, atPin: 'make-bus-leaflet', cwd: path.resolve(ENGINE, '..'), cmd: 'node', args: ['tools/prove-red-status.js', '--buses', repo, '--portal', resolvePortal()] },
      ].filter(Boolean),
      unanswered: [
        'Whether the PORTAL suite is green — its `verify:area` gates a fixture that lives in this repository, and nothing on this side runs another repository\'s gates.',
        'Anything that needs the network: whether a pull request is open, what origin holds that this checkout has not fetched, whether the live host answers.',
        'The estate harnesses gates.yml runs beyond prove-red-gates and prove-red-status — held-back, rollout-stamp, unrendered, sweep, prove-s6, attribution, the _latest mirrors. Only the two a pin bump has been seen to fail are asked, and only when the push moves engine.lock.json or a ci-reference/.',
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
        /* The same `node --test` population as CI's `unit` step: counted from both
         * runs on 2026-09-24 (buses-data loop, sched-0657), the SAME test count on
         * each side. The seven CI reports as skipped need a buses-data estate beside
         * the checkout, so here they run and assert and CI's are the weaker answer.
         * What the arm does NOT cover is the rest of CI's `unit` JOB, which the
         * unanswered list below says out loud. */
        { id: 'unit', label: 'the unit suite', tier: 'full', ...npmArm(['test', '--prefix', 'make-bus-leaflet']) },
        { id: 'wiring', label: 'every test:/gate: script is run by a workflow, through its npm script', tier: 'full', ...npmArm(['run', 'gate:wiring', '--prefix', 'make-bus-leaflet']) },
      ],
      unanswered: [
        'Whether an engine change has its estate rebuild — `prove-red-held-back` needs a town in buses-data carrying the new engine stamp, and that town is in the other repository (OA-341).',
        'Everything else in CI\'s `unit` job beyond `npm test` — the Python unit suite (`npm run test:python`), every prove-red harness, the generator ceilings, the design-key register and the LF check. The `unit` arm here is `node --test` only, so a push that breaks one of those goes red in CI after passing here.',
      ],
    };
  }
  /* The portal, community-bus-maps (buses-data OA-343 item 2). Until 2026-09-24
   * it matched nothing, so the preflight REFUSED there, which was honest and
   * useless. It is a built-in rather than a `.preflight.json` in that repository
   * because every documentation checker lives in the skills tree, and a declared
   * manifest could only reach them by a literal path on one laptop — the fault
   * OA-345 removed from the two manifests above.
   *
   * `docsOnly` IS EMPTY ON PURPOSE, so every push with content is the full tier.
   * The portal's `test.yml` has no `paths:` filter by design, and it is right not
   * to: `test-changelog.mjs` reads `CHANGELOG.d/`, the schema harnesses read
   * `docs/`, `check-chrome.mjs` reads `public/`, so a push of prose alone can
   * redden `npm test` there. A cheap tier would be the preflight copying a
   * population CI does not have. Measured on 2026-09-24: `npm test` 5 min 5 s,
   * the four byte-identical steps 1 min 46 s together.
   *
   * The checks are the steps of `test.yml` and `verify.yml` in their order, one
   * per step, so a red names the step that will go red. */
  if (has('engine/vendored.json') && has('scripts/run-tests.mjs')) {
    return {
      name: 'community-bus-maps',
      docsOnly: [],
      checks: [
        { id: 'prove-red-run-tests', label: 'the test runner can go red', ...npmArm(['run', 'test:prove-red-run-tests']) },
        { id: 'npm-test', label: 'the portal suite, npm test', tier: 'full', ...npmArm(['test']) },
        TOOLS && { id: 'file-hygiene', label: 'no BOM, no trailing whitespace, no missing final newline', cmd: 'node', args: [`${TOOLS}/check-file-hygiene.mjs`, '--root', '.'] },
        TOOLS && { id: 'tables', label: 'tables are still tables', cmd: 'node', args: [`${TOOLS}/check-tables.mjs`, '--tree', '.'] },
        TOOLS && { id: 'doc-links', label: 'links, anchors and documented commands resolve', cmd: 'node', args: [`${TOOLS}/check-doc-links.mjs`] },
        TOOLS && { id: 'acronyms', label: 'every short form can be looked up', cmd: 'node', args: [`${TOOLS}/check-doc-acronyms.mjs`] },
        { id: 'verify-area', label: 'verify:area — the portal reproduces a shipped town sheet', tier: 'full', ...npmArm(['run', 'verify:area']) },
        { id: 'verify-place', label: 'verify:place — the vendored place engine reproduces a shipped place sheet', tier: 'full', ...npmArm(['run', 'verify:place']) },
        { id: 'verify-defaults', label: 'verify:defaults — every design/labels escape hatch is still live code', tier: 'full', ...npmArm(['run', 'verify:defaults']) },
        { id: 'prove-red-selfsufficient', label: 'the self-sufficiency gate can go red', tier: 'full', ...npmArm(['run', 'test:prove-red-selfsufficient']) },
        { id: 'selfsufficient', label: 'the vendored engine renders with nothing but this repository', tier: 'full', ...npmArm(['run', 'test:selfsufficient']) },
      ].filter(Boolean),
      unanswered: [
        '`render-parity.yml` — it rasterises inside the production Docker image on Linux, and glyph outlines differ from this laptop by design, so a local answer would not be the one CI gives.',
        '`audit.yml` — `npm audit` asks the registry, and anything that needs the network is not asked here.',
        'Whether this branch is current with the portal\'s origin/main — its protection requires an up-to-date branch, and a verdict about a stale base is a verdict about the wrong tree.',
        ...(TOOLS ? [] : ['The four documentation checks — NO skills tree was found: set BUS_SKILL_ASSETS, or run this beside one. That is a refusal, not a pass.']),
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
  // `unsetEnv` names variables the check must NOT inherit — the engine resolvers
  // read BUS_SKILL_ASSETS before their own folder, so a pinned harness would
  // otherwise load main's generators. Names rather than an env object, because
  // the check is spread into `--json` output and an env object would print it.
  const env = { ...process.env };
  for (const k of check.unsetEnv || []) delete env[k];
  const r = spawnSync(check.cmd, check.args || [], { cwd, encoding: 'utf8', env });
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
 * The engine commit this push PINS — read from `HEAD:engine.lock.json`, because
 * that committed file is what gates.yml's `engine-pin.mjs --print` reads, and a
 * pin edited on disk and not committed is not in the push.
 */
export function pinnedCommit(repo) {
  const r = git(repo, ['show', 'HEAD:engine.lock.json']);
  if (!r.ok) return { why: 'HEAD carries no engine.lock.json, so there is no pinned engine to run at' };
  let commit;
  try { commit = JSON.parse(r.out).commit; } catch (e) { return { why: `HEAD:engine.lock.json does not parse: ${e.message}` }; }
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(commit)) return { why: 'HEAD:engine.lock.json names no commit' };
  return { commit };
}

/**
 * A claude-skills tree AT `commit`: the checkout itself when it already is that
 * commit and clean under both skills, otherwise a detached worktree in the temp
 * directory — the move `engine_commit.js` makes for a map's own engine.
 *
 * `node_modules` is not in git, so the worktree borrows the checkout's by a
 * junction; the engine's one dependency is sharp, which no generator's bytes
 * depend on. A commit the clone lacks is fetched once from its first remote.
 * The caller hands the result to `releaseEngine`, which removes the worktree;
 * a run killed before that leaves a registration `worktree prune` clears next
 * time, which is why prune runs BEFORE the add.
 */
export function engineAtPin(skillsRoot, commit) {
  if (!skillsRoot || !existsSync(path.join(skillsRoot, '.git'))) return { why: `no claude-skills checkout found at ${skillsRoot || '(unresolved)'}` };
  const want = git(skillsRoot, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]);
  const head = git(skillsRoot, ['rev-parse', 'HEAD']);
  const dirty = git(skillsRoot, ['status', '--porcelain', '--untracked-files=no', '--', 'make-bus-leaflet', 'make-place-bus-leaflet']);
  if (want.ok && head.ok && want.out === head.out && dirty.ok && !dirty.out) return { root: skillsRoot, commit: head.out, via: 'checkout' };
  const dir = mkdtempSync(path.join(tmpdir(), 'preflight-pin-'));
  const wt = path.join(dir, 'skills');
  git(skillsRoot, ['worktree', 'prune']);
  const add = () => git(skillsRoot, ['worktree', 'add', '--quiet', '--detach', wt, commit]);
  let r = add();
  if (!r.ok) {
    const remote = (git(skillsRoot, ['remote']).out.split('\n')[0] || '').trim();
    if (remote && git(skillsRoot, ['fetch', '--quiet', '--no-tags', remote, commit]).ok) r = add();
  }
  if (!r.ok) {
    rmSync(dir, { recursive: true, force: true });
    return { why: `could not check claude-skills out at the pin ${commit.slice(0, 7)}: ${r.err.split('\n')[0] || `git exited ${r.status}`}` };
  }
  const mods = path.join(skillsRoot, 'make-bus-leaflet', 'node_modules');
  if (existsSync(mods)) {
    try { symlinkSync(mods, path.join(wt, 'make-bus-leaflet', 'node_modules'), 'junction'); } catch { /* a harness that needs it then fails loudly, by itself */ }
  }
  return { root: wt, commit: git(wt, ['rev-parse', 'HEAD']).out, via: 'worktree', dir, skillsRoot };
}

/** Remove a worktree `engineAtPin` made; the checkout itself is left alone. */
export function releaseEngine(e) {
  if (!e || e.via !== 'worktree') return;
  git(e.skillsRoot, ['worktree', 'remove', '--force', e.root]);
  rmSync(e.dir, { recursive: true, force: true });
  git(e.skillsRoot, ['worktree', 'prune']);
}

/**
 * The sibling caveat, and it is the one nobody thinks to ask.
 *
 * `buses-data`'s `gates.yml` checks `claude-skills` out at engine.lock.json's
 * `commit` (OA-398) — never the working tree these gates just ran against. The
 * arms marked `atPin` run at that commit whatever this checkout holds; every
 * other arm runs from the checkout, so ITS verdict transfers only while the
 * checkout is clean and AT the pin. Until 2026-09-25 this compared against
 * origin/main and told the reader CI did too, a year's worth of comment written
 * before the pin existed (buses-data OA-466). With no pin to read it falls back
 * to origin/main and says so.
 */
export function engineTransfers(engineRepo, pin = null) {
  if (!engineRepo || !existsSync(path.join(engineRepo, '.git'))) return { known: false, why: `no engine checkout found at ${engineRepo || '(unresolved)'}` };
  const dirty = git(engineRepo, ['status', '--porcelain', '--', 'make-bus-leaflet/assets', 'make-place-bus-leaflet/assets']);
  const head = git(engineRepo, ['rev-parse', 'HEAD']);
  const against = pin || 'origin/main';
  const target = git(engineRepo, ['rev-parse', '--verify', '--quiet', `${against}^{commit}`]);
  const branch = git(engineRepo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!dirty.ok || !head.ok) return { known: false, why: 'the engine checkout could not be read' };
  const dirtyFiles = dirty.out ? dirty.out.split('\n').filter(Boolean).length : 0;
  const level = target.ok && target.out === head.out;
  return { known: true, transfers: dirtyFiles === 0 && level, dirtyFiles, against: pin ? `the pin ${pin.slice(0, 7)}` : 'origin/main (no pin was readable)', head: head.out.slice(0, 7), branch: branch.out };
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
  if (result.pin && result.pin.via) {
    L.push(`  (The arms marked at-pin ran from claude-skills ${result.pin.commit.slice(0, 7)}, by ${result.pin.via === 'worktree' ? 'a detached worktree, since removed' : 'this checkout, which is already there'}.)`);
  }
  if (result.engine && result.engine.known && !result.engine.transfers) {
    L.push(`  Whether the OTHER engine-reading verdicts TRANSFER. CI gates this repository against claude-skills at ${result.engine.against}; the checkout here is at ${result.engine.head} (${result.engine.branch}), with ${result.engine.dirtyFiles} uncommitted file(s) under a hashed assets folder. The board and the fixture arms were measured against an engine CI will not use.`);
  } else if (result.engine && result.engine.known) {
    L.push(`  The engine checkout is clean under assets/ and at ${result.engine.against}, so a byte-gate verdict here is about the same engine CI will check out.`);
  } else if (result.engine) {
    L.push(`  Whether these verdicts transfer to CI's engine: ${result.engine.why}.`);
  }
  for (const c of result.notTriggered || []) L.push(`  ${c.id} — ${c.label}: not asked, because no pushed path matches ${c.when.join(' or ')}.`);
  for (const u of result.unanswered || []) L.push(`  ${u}`);
  for (const c of unanswered) L.push(`  ${c.id}: ${c.why}`);
  L.push('');
  L.push(`${failed.length} would go red · ${unanswered.length} unanswered · ${result.checks.filter((c) => c.verdict === 'PASS').length} pass · tier ${result.tier.tier}`);
  return L.join('\n');
}

/*
 * An `atPin` arm runs from `<the engine at the pin>/<atPin>`, with the engine
 * resolvers' environment overrides removed. A pin that cannot be read or
 * checked out makes the arm UNANSWERED — never a run at main, which is the
 * wrong answer this exists to stop, and never a pass.
 */
const PIN_UNSET = ['BUS_SKILL_ASSETS', 'PLACE_SKILL_ASSETS'];
function runAtPin(check, repo, pinEngine) {
  if (!pinEngine.root) return { ...check, verdict: 'UNANSWERED', ms: 0, why: pinEngine.why, echoed: [] };
  return runCheck({ ...check, cwd: path.join(pinEngine.root, check.atPin), unsetEnv: [...(check.unsetEnv || []), ...PIN_UNSET] }, repo);
}

export function preflight({ repo, all = false, skillsRoot }) {
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
  const inTier = all || tier.tier === 'full' ? manifest.checks : manifest.checks.filter((c) => (c.tier || 'cheap') === 'cheap');
  const wanted = inTier.filter((c) => triggered(c, scope, all));
  // Named in the report, so a check that was not triggered reads as not asked and never as a pass.
  const notTriggered = inTier.filter((c) => !triggered(c, scope, all)).map((c) => ({ id: c.id, label: c.label, when: c.when }));
  const skills = skillsRoot || skillPaths().SKILLS;
  const pin = pinnedCommit(repo);
  let pinEngine = null;
  if (wanted.some((c) => c.atPin)) pinEngine = pin.commit ? engineAtPin(skills, pin.commit) : { why: pin.why };
  let checks;
  try {
    checks = wanted.map((c) => (c.atPin ? runAtPin(c, repo, pinEngine) : runCheck(c, repo)));
  } finally {
    releaseEngine(pinEngine);
  }
  /* Resolved, not typed — and `engineTransfers` already reports an unresolved
   * tree as `known: false` with its reason, which is the answer a refusal wants
   * rather than a literal that happens to exist on one laptop (OA-345). */
  const engine = manifest.name === 'buses-data' ? engineTransfers(skills, pin.commit || null) : null;
  const failed = checks.filter((c) => c.verdict === 'FAIL').length;
  const unanswered = checks.filter((c) => c.verdict === 'UNANSWERED').length;
  const exit = failed ? EXIT_FAILED : (unanswered || !scope.known) ? EXIT_CANNOT_TELL : EXIT_OK;
  const pinReport = pinEngine ? (pinEngine.root ? { commit: pinEngine.commit, via: pinEngine.via } : { why: pinEngine.why }) : null;
  return { repo, repoName: manifest.name, scope, tier: all ? { tier: 'full (forced by --all)', beyond: tier.beyond } : tier, source: manifest.source, checks, notTriggered, engine, pin: pinReport, unanswered: manifest.unanswered || [], exit };
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
