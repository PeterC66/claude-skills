// WHICH REPOSITORY A CHECKER IS ABOUT, asked of git rather than of the shell.
//
// buses-data OA-275 step 2. Every checker in this folder used to take
// `ROOT = process.cwd()`, which reads as "the repository you are standing in"
// and is not the same thing. Standing in `Areas/Beaconsfield`, `check-s6-claims`
// reported `2 map(s) tracked; 11 claim(s) — UNCOVERED 11`; standing at the
// repository root, the same command on the same commit reported `20 map(s)
// tracked … every claim has a home`. **The wrong verdict is entirely plausible
// on its face** — it names a real directory, counts real maps and reports real
// claims, and nothing in it says you are looking at one map out of twenty.
//
// AND THE COLLISION IS GUARANTEED RATHER THAN UNLUCKY. The stage engine
// (`stage.js`, `redteam_source.js`, `verify_report.js`) takes its cwd as its
// SUBJECT and has no directory argument, so it is always run from a map or run
// folder — the scheduled loop's commonest work — and leaves the shell there.
// Any session that runs a stage and then a checker gets a silently narrowed
// corpus, which is this estate's own named failure shape reached in the
// ordinary course of one unit of work.
//
// THE FIX BELONGS IN THE CHECKER, NOT IN THE CALLER. The alternative on offer
// was a rule telling every caller to `cd` back first, and OA-275 preferred this
// one for a reason worth keeping: a rule a caller must remember is a rule that
// is one forgotten call away from a green verdict about the wrong tree, and
// nothing in the output distinguishes the two. Resolving here cannot be got
// wrong by a caller at all.
//
// `git rev-parse --show-toplevel` RATHER THAN A WALK LOOKING FOR `.git`. It is
// the same question `git ls-files` will answer moments later in
// `lib/tracked-docs.mjs`, so the two cannot disagree; it is right about a
// worktree, where `.git` is a FILE and not a directory; and it honours
// `GIT_DIR`, which is set for every command a git hook runs.
//
// AN EXPLICIT `--root` IS UNTOUCHED and must stay so. That flag names a TREE
// rather than a repository — it is what the prove-red harnesses drive over a
// temp folder that is no repository at all — and a flag that quietly resolved
// somewhere else would be the same fault this file exists to remove.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * The root of the git repository enclosing `start`, or `start` itself when there
 * is none.
 *
 * FALLING BACK TO `start` RATHER THAN THROWING is deliberate. A tree that is no
 * repository is a real case for three of the four callers — every `--root`
 * fixture in the harnesses is one — and each of them already has its own answer
 * for it: `tracked-docs.mjs` throws rather than reporting clear, and
 * `check-s6-claims.mjs` exits 2 saying `notARepository`. Throwing here would
 * move that decision out of the checker that has thought about it.
 */
export function enclosingRepoRoot(start = process.cwd()) {
  const from = path.resolve(start);
  try {
    const out = execFileSync('git', ['-C', from, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return path.resolve(out);
  } catch {
    /* not a repository, or no git on PATH — the caller's own precondition check
     * is what should say so, in its own words. */
  }
  return from;
}
