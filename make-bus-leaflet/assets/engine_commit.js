#!/usr/bin/env node
/*
 * engine_commit.js — WHICH COMMIT of claude-skills drew this map, and how to get
 * that engine back. (buses-data OA-430, item 6 of R9 of the process review.)
 *
 * WHY A COMMIT AND NOT JUST THE HASH. `routes.json` has carried `engine` — a
 * content hash of the generator closure — since 2026-08-04, and it answers *was
 * this map drawn by today's code*. It cannot answer *what did today's question
 * look like when it was*, because a hash of a closure of files is not a thing git
 * can check out. OA-214 hit that wall and paid for it: recovering the commit
 * behind one held-back town's hash cost a walk back through history recomputing
 * the hash at every step, and the fix was to write the commit down BY HAND in
 * status.js's allowance list, one line per excused town. This module writes it
 * down automatically, at the moment the stamp is made, when it is free.
 *
 * WHAT THAT BUYS. The byte gate's honest question stops being *does this sheet
 * reproduce under the CURRENT engine* — which an engine change makes false for
 * the whole estate at once, in one step, with no fault anywhere — and becomes
 * *does this sheet still reproduce under the engine it was BUILT with*, which is
 * exact, falsifiable, and true of every map independently of every other. An
 * engine change then owes each map a REBUILD ROW rather than owing all of them a
 * synchronous rebuild before anything can merge.
 *
 * TWO HALVES, AND THEY ARE DELIBERATELY IN ONE FILE. `engineCommitNow()` is the
 * writer, called from the stamp; `engineDirForCommit()` is the reader, called
 * from the board. They share the rule about what makes a commit a truthful
 * description of an engine — the closure it hashes must be clean — and a rule
 * split across two files is a rule that drifts.
 *
 * THIS FILE IS OUTSIDE BOTH ENGINE HASHES and must stay there. It is required by
 * `engine_version.js`, `status.js` and `bus-work`'s worklist, none of which any
 * generator reaches; put a require to it inside the closure and every map in the
 * estate goes stale over a file that draws no ink. Ask before you move it:
 *   node -e "console.log(require('./assets/engine_version.js').engineFiles().join(' '))"
 * from `make-bus-leaflet`, and read the LIST rather than its length.
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SK = __dirname;

/* THE SKILLS REPOSITORY holding a given assets directory.
 *
 * Found by WALKING UP FOR A `.git` rather than by counting two levels, and it
 * takes an env override, for two reasons that are the same reason: the callers
 * are routinely run from somewhere that is not the repository. `tools/prove-red*`
 * copy `assets/` into a scratch directory and run THAT copy, where the
 * grandparent is a temp folder; the portal vendors these files into `engine/`,
 * which is a different repository entirely. Guessing a path that happens to be
 * right on one machine is how a check ends up reporting "cannot look" for a
 * reason having nothing to do with its subject.
 *
 * Lifted here verbatim from status.js, which had the only copy, so the writer and
 * the reader cannot disagree about which repository they are talking about. */
function skillsRootFor(sk = SK) {
  if (process.env.SKILLS_REPO) return path.resolve(process.env.SKILLS_REPO);
  let d = path.resolve(sk);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

/** git in a named directory, never in the caller's cwd. */
const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });

/* WHICH FILES THE HASH ACTUALLY READS, as absolute paths, for one template.
 *
 * Asked of `engine_version.js` rather than restated, because a second list beside
 * that one is the fault ENGINE_FILES' own comment records having made twice — a
 * count that stayed right while the NAMES went wrong. */
function hashedFiles(sk, { place = false } = {}) {
  const ev = require('./engine_version');
  const out = ev.engineFiles(sk).map((n) => path.join(sk, n));
  if (!place) return out;
  const psk = ev.placeAssetsDir(sk);
  for (const n of ev.placeEngineFiles(psk)) out.push(path.join(psk, n));
  for (const n of ev.boardingEngineFiles(sk)) out.push(path.join(sk, n));
  return out;
}

/*
 * engineCommitNow — the commit to stamp beside the hash, or the reason there is
 * none.
 *
 * IT REFUSES ON A DIRTY CLOSURE, and that is the whole point rather than fussiness.
 * A commit recorded beside a hash is a claim that checking that commit out gets
 * the engine back. During development the working tree is exactly where that
 * claim is false — the sheets were drawn by code that is in no commit at all —
 * and a stamp that named HEAD anyway would send a later gate to an engine that
 * computes a DIFFERENT hash, which `engineDirForCommit()` below would then
 * correctly refuse, three weeks later, about a map nobody was looking at.
 *
 * So the test is narrow and exact: is every file THIS TEMPLATE'S HASH READS the
 * same as HEAD's copy of it. A dirty `tools/`, a half-written test, an untracked
 * scratch file — none of those change what was drawn, and none of them block a
 * stamp. Anything else (no repository, no HEAD, a git that will not answer) is a
 * COULD-NOT-LOOK, and a could-not-look is recorded as an absence of the field
 * rather than as a guess: `engine` alone is exactly what a map carried before
 * this existed, and the board knows what to do with it.
 *
 * Returns { commit } or { why }.
 */
function engineCommitNow(sk = SK, opts = {}) {
  const root = skillsRootFor(sk);
  if (!root) return { why: `no git repository above ${sk}` };
  const head = git(root, 'rev-parse', 'HEAD');
  if (head.status !== 0) return { why: `${root} has no HEAD to name: ${(head.stderr || '').trim().split('\n')[0]}` };

  let files;
  try { files = hashedFiles(sk, opts); }
  catch (e) { return { why: `could not enumerate the hashed closure: ${e.message}` }; }
  const rel = files.map((f) => path.relative(root, f).split(path.sep).join('/'));
  // A file OUTSIDE the repository cannot be described by its HEAD. That is the
  // vendored-into-the-portal case, and it is a could-not-look, not a clean tree.
  const outside = rel.filter((r) => r.startsWith('..'));
  if (outside.length) return { why: `${outside.length} hashed file(s) lie outside ${root}, starting with ${outside[0]}` };

  const st = git(root, 'status', '--porcelain', '--', ...rel);
  if (st.status !== 0) return { why: `git status refused in ${root}: ${(st.stderr || '').trim().split('\n')[0]}` };
  const dirty = (st.stdout || '').trim().split('\n').filter(Boolean);
  if (dirty.length) {
    return { why: `${dirty.length} hashed file(s) differ from HEAD, starting with ${dirty[0].slice(3).trim()}` };
  }
  return { commit: head.stdout.trim() };
}

/*
 * THE READER: check an engine commit out, once per process, and prove it is the
 * engine the map claims.
 *
 * `git worktree add` REGISTERS the tree in `.git/worktrees/`, and scratch.js
 * sweeps the directory at exit without telling git — so every board run left a
 * stale registration behind and `git worktree list` grew by one each time.
 * Measured immediately after the first version of this, in status.js: one run,
 * one leaked entry. Pruning BEFORE adding clears whatever a crashed or swept run
 * left; removing at exit clears this one. Both are needed — prune alone leaves
 * today's entry until tomorrow, and remove alone cannot clean up after a run that
 * was killed.
 */
const WT = new Map();                    // commit -> { dir, commit } | { error }
const MADE = [];
let ROOT_FOR_CLEANUP = null;
process.on('exit', () => {
  if (!ROOT_FOR_CLEANUP) return;
  for (const d of MADE) {
    try { spawnSync('git', ['-C', ROOT_FOR_CLEANUP, 'worktree', 'remove', '--force', d], { stdio: 'ignore' }); } catch (e) { /* best effort at exit */ }
  }
});

/* IT FETCHES THE COMMIT ITSELF RATHER THAN ASKING CI TO (OA-217, 2026-09-01).
 *
 * A clone made by `actions/checkout` is one commit deep, so a map naming anything
 * older is simply not in it and the worktree add says `fatal: invalid reference`.
 * That is not a hypothetical: it made buses-data's gates workflow red on
 * 2026-09-01 about a sheet that was perfectly good, while the same board on the
 * laptop — whose clone has the whole history — said PASS.
 *
 * THE FIRST FIX WAS A WORKFLOW STEP, AND THE FIRST FIX WAS IN THE WRONG PLACE. It
 * was written into claude-skills' gates.yml and not into buses-data's, and the
 * sentence "CI is green on it" was true of the one that had it. The remedy for
 * two YAML files holding a setup requirement is not a third file comparing them:
 * it is for the code with the requirement to satisfy it. TIMED OUT at 60s because
 * the alternative to a slow answer is no answer, and a failure of any kind leaves
 * the ORIGINAL error, because "the commit is not here" is what the reader has to
 * act on and "and the fetch did not help" is the footnote. */
function fetchCommit(root, sha) {
  const remotes = git(root, 'remote');
  const first = ((remotes.stdout || '').trim().split('\n')[0] || '').trim();
  if (remotes.status !== 0 || !first) return 'this clone has no remote to fetch it from';
  const r = spawnSync('git', ['-C', root, 'fetch', '--depth=1', '--no-tags', first, sha],
    { encoding: 'utf8', timeout: 60000 });
  if (r.error && r.error.code === 'ETIMEDOUT') return 'the fetch from ' + first + ' timed out after 60s';
  if (r.status !== 0) return 'fetching it from ' + first + ' failed: '
    + ((r.stderr || r.stdout || 'no reason given').trim().split('\n').pop() || '').slice(0, 160);
  return null;
}

/*
 * engineDirForCommit — an assets directory holding the engine at `commit`,
 * VERIFIED to compute the hash the map claims.
 *
 * THE VERIFICATION IS NOT DECORATION AND IT IS WHY THIS RETURNS AN ERROR RATHER
 * THAN A DIRECTORY. The pair (hash, commit) is a written claim about a join, and
 * the only thing that can check a claim about a join is the join. A commit that
 * computes a different hash means the stamp is lying about its own provenance —
 * a bad backfill, a rebase, a stamp written from a dirty tree in spite of
 * `engineCommitNow()` — and continuing to gate against it would make every
 * subsequent PASS meaningless. A refusal read as an absence measures the
 * instrument instead of the subject, so this reports, and the caller reddens.
 *
 * `expect` is the hash from the map's routes.json; `place` says which of the two
 * templates to recompute. Both are required: recomputing the TOWN hash over a
 * place's stamp would refuse every place on earth for the wrong reason.
 */
function engineDirForCommit({ skillsRoot, commit, expect, place = false, scratchDir }) {
  if (!commit) return { error: 'no engine commit recorded — nothing to check out' };
  if (!skillsRoot) return { error: 'no claude-skills checkout to take a worktree from' };
  const key = commit + (place ? ':place' : ':town') + ':' + expect;
  if (WT.has(key)) return WT.get(key);
  ROOT_FOR_CLEANUP = skillsRoot;
  let out;
  try {
    const dir = path.join(scratchDir('engine-commit-'), 'wt');
    spawnSync('git', ['-C', skillsRoot, 'worktree', 'prune'], { stdio: 'ignore' });
    const add = () => git(skillsRoot, 'worktree', 'add', '--quiet', '--detach', dir, commit);
    let r = add();
    if (r.status !== 0) {
      const why = fetchCommit(skillsRoot, commit);
      if (!why) r = add();
      else r.fetchNote = why;
    }
    if (r.status === 0) MADE.push(dir);
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'git worktree add failed').trim().split('\n')[0]
      + (r.fetchNote ? ' — and ' + r.fetchNote : ''));
    const assets = path.join(dir, 'make-bus-leaflet', 'assets');
    const mod = path.join(assets, 'engine_version.js');
    if (!fs.existsSync(mod)) throw new Error(`commit ${commit.slice(0, 7)} has no make-bus-leaflet/assets/engine_version.js`);
    const ev = require(mod);
    // PLACE ASSETS ARE NAMED EXPLICITLY rather than left to placeAssetsDir()'s
    // default, because that default reads PLACE_SKILL_ASSETS from the environment
    // — and a caller that has set it (every place rollout does) would otherwise
    // hash TODAY's place generators against the checked-out town ones, which is
    // the sibling-beats-the-argument hybrid gate_lib.js's own header records
    // being caught by once already.
    const got = place
      ? ev.computePlaceEngineVersion(assets, path.join(dir, 'make-place-bus-leaflet', 'assets'))
      : ev.computeEngineVersion(assets);
    if (got !== expect) throw new Error(`commit ${commit.slice(0, 7)} produces engine ${got}, not the ${expect} this map's stamp claims`);
    out = { dir: assets, placeDir: path.join(dir, 'make-place-bus-leaflet', 'assets'), commit };
  } catch (e) { out = { error: e.message }; }
  WT.set(key, out);
  return out;
}

module.exports = { skillsRootFor, engineCommitNow, engineDirForCommit, hashedFiles };
