/*
 * unpushed_branches.mjs — committed work that has never reached GitHub, as
 * worklist rows (buses-data OA-326, 2026-09-12).
 *
 * WHY THIS EXISTS. The scheduled loop can never push: `Bash(git push…)` is in
 * this estate's deny list, and that containment is the whole reason an
 * unattended tick may write to the map trees and to `claude-skills` at all — a
 * wrong edit sits in an unpushed commit until a person reads it. Nothing here
 * proposes changing that. What was missing is the CHANNEL for the residue it
 * creates. On 2026-09-12 `check/schema-version-oa325` sat in the portal with 463
 * insertions, a falsification harness, no pull request and no `loop/blocked/`
 * item, while the board printed `the portal  community-bus-maps — main, clean`.
 *
 * WHY `countUnpushed` COULD NOT SEE IT. That function counts `<basis>..HEAD` in
 * the three main checkouts, so it answers only for the branch each checkout
 * happens to have out. A branch held in a git WORKTREE, or checked out nowhere
 * at all — the normal end state once a worktree is removed — is invisible to it.
 * The worktree convention is spreading, so the blind spot was widening.
 *
 * THE TRAP, AND IT IS THE WHOLE DESIGN CONSTRAINT: THE ROW IS COMPUTED FROM
 * PATCH IDENTITY, NEVER FROM AHEAD-COUNT. The portal squash-merges with
 * `delete_branch_on_merge` on, so every branch it has ever merged stays ahead of
 * `main` for ever. Measured in `community-bus-maps` on 2026-09-12: 34 local
 * branches, 27 ahead of `origin/main`, and 8 unmerged by `git cherry`. A row
 * built on ahead-count would raise 27 items of which 24 are finished work, and
 * it would be muted inside a week — this project's standard way of losing a
 * gate, and the same argument that made the untracked-sibling hook WARN rather
 * than refuse.
 *
 * AND `git cherry` IS NOT ENOUGH ON ITS OWN, WHICH WAS MEASURED RATHER THAN
 * REASONED. A squash of a SINGLE commit keeps that commit's diff, so its
 * patch-id still matches and `cherry` correctly says merged. A squash of TWO
 * commits produces one diff that matches neither, so `cherry` says unmerged for
 * ever. Both of the portal's two-commit strays are exactly this:
 * `schema-note-token-column` landed as `a12d247` (#127) and
 * `tabs-read-as-buttons` as `709a9b5` (#125), both in August, and both still
 * report `+` twice. The discriminator that separates them costs nothing and is
 * already on the disk — their upstream is RECORDED AND GONE, which in a
 * repository that deletes a branch on merge is the remote saying the work
 * landed. So a gone upstream is read as merged, and it is the reason this source
 * raises three portal rows today instead of five.
 *
 * WHAT IT DOES NOT LOOK AT, NAMED AT THE POINT OF THE NARROWING. OA-326 asks for
 * `gh pr list --head <branch>` as the second half of the test. This source does
 * not make that call, because `worklist.mjs` promises to touch the network only
 * in `--url` mode and a board that opened a socket per branch would stop working
 * on a train — the same argument that made the directory link sweep write a file
 * for this to read. So the narrowing is: a branch that HAS been pushed is not
 * raised, whether or not a pull request is open for it. The guarantee is
 * re-established by where that work now lives rather than by another check —
 * a pushed branch is on GitHub, both public repositories are protected so
 * nothing merges without a pull request, and the branch is visible to anybody
 * who looks at the repository. What is raised is the case where NOTHING outside
 * this laptop knows the work exists, which is the case that cost 463 lines. The
 * count of pushed-but-unmerged branches is reported anyway, as a note, so the
 * half that is not being asked is visible rather than silently absent.
 *
 * IT OPENS NO SOCKET AND IT NEVER FETCHES. Every question below is answered from
 * refs already on the disk, like `countUnpushed` beside it. That means it
 * answers "have we pushed what we committed", never "has somebody else pushed
 * something we have not seen".
 *
 * COMPUTED RATHER THAN DECLARED, AND THAT IS THE POINT. Telling every tick in
 * `loop/README.md` to write a `blocked/` item would be the cheaper change and it
 * is the wrong one: a declaration can be forgotten, and on the day this was
 * found it had been. The standing rule is *do not keep a list — run the one that
 * is computed*. A row raised here for a branch a `loop/blocked/` hold ALSO names
 * is correct and deliberate: the computed half must be loud exactly where
 * somebody remembered, or it could not be told from the half that is silent
 * where nobody did.
 */

import { execFileSync } from 'node:child_process';

/** Split a git ref listing safely; a missing or empty answer is no branches. */
const lines = (s) => String(s || '').split(/\r?\n/).filter((l) => l.trim().length > 0);

/*
 * The one git runner, injectable so the harness can drive both this and a stub.
 * `null` on any failure, exactly like concurrency.mjs's private copy: a question
 * git refuses to answer is not a finding, and every caller below treats null as
 * "do not raise a row about this".
 */
export const defaultGit = (dir, argv) => {
  try {
    return execFileSync('git', ['-C', dir, ...argv], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000,
    }).replace(/\s+$/, '');
  } catch { return null; }
};

/**
 * Which ref is this repository's trunk, according to the repository itself.
 *
 * `origin/HEAD` first, because it is what the remote says; the two guesses after
 * it are for a clone that never set it, and each is verified to EXIST before it
 * is used, so a wrong guess falls through to a stated reason rather than to an
 * answer about nothing. Same order and same argument as `countUnpushed`.
 *
 * @returns {string|null}
 */
export function defaultRef(dir, git) {
  const head = git(dir, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  for (const ref of [head, 'origin/main', 'origin/master']) {
    if (!ref || !/^origin\//.test(ref)) continue;
    if (git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === null) continue;
    return ref;
  }
  return null;
}

/**
 * Read every LOCAL branch and what git already knows about it.
 *
 * Read from the main checkout, which is enough: `refs/heads/` is shared across
 * every worktree of a repository, so a branch checked out in a worktree is in
 * this listing — verified against the portal's two live worktrees on 2026-09-12.
 *
 * ABSENT, UNREADABLE AND HAS-NO-REMOTE ARE THREE DIFFERENT ANSWERS and each
 * carries its reason. `null` for all three would be *the refusal read as an
 * absence*: a repository nobody can read and a repository with nothing stranded
 * would print the same nothing.
 *
 * @param {string} dir
 * @param {(dir: string, argv: string[]) => string|null} git
 * @returns {{readable: boolean, why: string|null, base: string|null, branches: Array}}
 */
export function readBranches(dir, git = defaultGit) {
  const out = { readable: false, why: null, base: null, branches: [] };
  if (!dir || git(dir, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    out.why = 'not a git working tree';
    return out;
  }
  out.readable = true;
  const base = defaultRef(dir, git);
  if (!base) {
    out.why = 'no origin/HEAD, origin/main or origin/master to compare against — is a remote configured?';
    return out;
  }
  out.base = base;
  const trunk = base.replace(/^origin\//, '');

  // %(upstream:track) is the half that separates merged-and-deleted from
  // genuinely stranded; it renders "[gone]" once the remote ref has been
  // deleted. Tab-separated because a branch name cannot contain a tab and a
  // subject very much can.
  const raw = git(dir, ['for-each-ref',
    '--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(committerdate:iso8601-strict)\t%(contents:subject)',
    'refs/heads/']);
  if (raw === null) { out.why = 'could not list refs/heads/'; return out; }

  for (const line of lines(raw)) {
    const [branch, upstream = '', track = '', when = '', subject = ''] = line.split('\t');
    if (!branch || branch === trunk) continue;

    // PATCH IDENTITY, NOT AHEAD-COUNT. `git cherry <base> <branch>` marks each
    // commit `+` when the base has no equivalent patch and `-` when it does.
    const cherry = git(dir, ['cherry', base, branch]);
    if (cherry === null) continue;  // a branch we cannot read is not a finding
    const unmerged = lines(cherry).filter((l) => l.startsWith('+')).length;

    const upstreamGone = /\[gone\]/.test(track);
    // A branch may be on the remote without an upstream ever being configured —
    // `git push origin <b>` without -u. Ask the ref directly rather than trust
    // the configuration.
    const onRemote = !upstreamGone
      && (!!upstream || git(dir, ['rev-parse', '--verify', '--quiet', `origin/${branch}^{commit}`]) !== null);

    let insertions = null;
    const stat = git(dir, ['diff', '--shortstat', `${base}...${branch}`]);
    const m = /(\d+) insertion/.exec(stat || '');
    if (m) insertions = Number(m[1]);

    out.branches.push({
      branch, upstream, upstreamGone, onRemote, unmerged,
      committedAt: when || null, subject: subject || '', insertions,
    });
  }
  return out;
}

/**
 * What this branch is, in one word.
 *
 *   merged       — the trunk already has every one of its patches
 *   gone-upstream— unmerged by patch, but the remote branch has been DELETED.
 *                  In a repository with delete_branch_on_merge that is the
 *                  remote saying it landed, and a multi-commit squash is why
 *                  `cherry` disagrees. See the header's measurement.
 *   pushed       — unmerged, and on the remote. Visible to anybody who looks;
 *                  whether a pull request is open is the question this source
 *                  deliberately does not ask.
 *   stranded     — unmerged, and on NO remote. Nothing outside this laptop knows
 *                  the work exists. This is the only class that raises a row.
 */
export function classifyBranch(b) {
  if (!b || !b.unmerged) return 'merged';
  if (b.upstreamGone) return 'gone-upstream';
  return b.onRemote ? 'pushed' : 'stranded';
}

/**
 * Rows for every stranded branch, plus the counts of what was deliberately not
 * raised.
 *
 * Rank 3 — the same band as a drafted reply Peter has not sent, and for exactly
 * the same reason: a person is the only thing that moves it, and every tick that
 * fires meanwhile does nothing about it.
 *
 * @param {{repos: Array<{key,name,dir,prPerChange?}>, git: Function, now?: number}} p
 * @returns {{items: Array, notes: Array<string>, unreadable: Array}}
 */
export function unpushedBranchItems({ repos, git = defaultGit, now = Date.now() }) {
  const items = [];
  const notes = [];
  const unreadable = [];

  for (const repo of repos || []) {
    const read = readBranches(repo.dir, git);
    if (!read.readable || !read.base) {
      unreadable.push({ name: repo.name, why: read.why || 'unknown' });
      continue;
    }
    const graded = read.branches.map((b) => ({ ...b, grade: classifyBranch(b) }));
    const pushed = graded.filter((b) => b.grade === 'pushed');
    const gone = graded.filter((b) => b.grade === 'gone-upstream');

    if (pushed.length) {
      notes.push(`${repo.name}: ${pushed.length} branch(es) are unmerged but ARE on the remote, so they are not raised — `
        + `whether a pull request is open for one needs the network, which this board does not touch: `
        + pushed.map((b) => b.branch).join(', '));
    }
    if (gone.length) {
      notes.push(`${repo.name}: ${gone.length} branch(es) read unmerged by patch but their remote branch has been DELETED, `
        + `which in a squash-merging repository means they landed — not raised: ${gone.map((b) => b.branch).join(', ')}`);
    }

    for (const b of graded.filter((x) => x.grade === 'stranded')) {
      const stamp = b.committedAt ? Date.parse(b.committedAt) : NaN;
      const ageDays = Number.isFinite(stamp) ? Math.max(0, Math.floor((now - stamp) / 86400000)) : null;
      const size = b.insertions == null ? 'an unknown number of' : String(b.insertions);
      const do_ = [{
        kind: 'shell', cwd: repo.dir,
        cmd: `git -C "${repo.dir}" push -u origin ${b.branch}`,
        note: 'one self-contained command; run it from anywhere',
      }];
      if (repo.prPerChange) {
        do_.push({ kind: 'chat', what: `Then open the pull request — ${repo.name} is PR-per-change and protected, so nothing merges without one.` });
      } else {
        do_.push({ kind: 'chat', what: `${repo.name} is direct-push to main, so a branch here is unusual — merge it or say why it exists.` });
      }
      do_.push({ kind: 'chat', what: 'Nothing in the loop can do this: pushing is denied to an unattended tick by design, which is why the work waits here.' });

      items.push({
        key: `unpushed-branch-${repo.key}-${b.branch.replace(/[^A-Za-z0-9]+/g, '-')}`,
        rank: 3, type: 'unpushed-branch',
        title: `${repo.name}: the branch ${b.branch} has never been pushed, and nothing outside this laptop knows it exists`,
        why: `${size} insertion(s) of committed work, on no remote and in no pull request. `
          + `Its patches are not in ${read.base}, and it is checked out in this repository or one of its worktrees. `
          + `The loop cannot push, so this sits here until you do.`,
        detail: [`last commit ${(b.committedAt || '').slice(0, 10) || 'date unknown'} — ${b.subject || '(no subject)'}`,
          `${b.unmerged} commit(s) whose patches ${read.base} does not have`].join('\n'),
        who: 'Peter', runbook: 'git', ref: b.branch, repo: repo.name, ageDays,
        do: do_,
      });
    }
  }
  return { items, notes, unreadable };
}
