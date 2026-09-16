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
 * AND A GONE UPSTREAM IS ONLY THE TRUTH AS AT THE MERGE (2026-09-15). Nothing
 * stops anybody committing to the same local branch afterwards, and the
 * scheduled loop does it every hour: `oa001/prune-retention-tests` was squashed
 * into `claude-skills` main at 18:23 and gained a 944-insertion commit at 18:36,
 * which this source then suppressed as landed work. That is the `gone-extended`
 * grade below, and `addedAndAbsent` carries the measurement of the four
 * discriminators and why three of them were rejected.
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
 * Paths this branch ADDED that the trunk does not have — the discriminator that
 * separates a branch which landed and was abandoned from one which landed and
 * then gained more work.
 *
 * WHY THE GRADE ABOVE NEEDED SPLITTING AT ALL, measured on 2026-09-15. A
 * squash merge deletes the remote branch, and `gone-upstream` reads that
 * deletion as the remote saying the work landed. It did land — AS OF THE MERGE.
 * Nothing stopped anybody committing to the same local branch afterwards, and
 * the scheduled loop does exactly that every hour: `oa001/prune-retention-tests`
 * was squash-merged as `claude-skills` #16 at 18:23, gained `2275e53` at 18:36
 * carrying a 944-insertion Python suite, and the board suppressed it in the
 * `not raised` note as landed work. The loop's own output was invisible on the
 * only list Peter works from, and would have stayed so for every later tick,
 * because each commits to that same branch.
 *
 * FOUR DISCRIMINATORS WERE MEASURED OVER ALL 22 GONE-UPSTREAM BRANCHES IN BOTH
 * PUBLIC REPOSITORIES, and three of them are recorded here because each failed
 * in a way worth not repeating:
 *
 *   - TIP DATE NEWER THAN THE TRUNK'S TIP fires on exactly the one true case and
 *     nothing else, and is the only one that is a PROOF — the trunk cannot
 *     contain a commit made after its own newest commit. It was rejected anyway:
 *     the trunk moves several times a day, so the row would go quiet again
 *     within hours of being right, and a signal that extinguishes itself is
 *     worse than one that never fired.
 *   - CONTENT DIFF trunk..branch over the branch's own paths is non-empty on 16
 *     of the 22, because the trunk has moved on and the two-dot diff reverses
 *     its later work. It would have been muted in a week.
 *   - ANY PATH ON THE BRANCH THAT THE TRUNK LACKS raises 8 of the 22, and 7 of
 *     those are one explainable class: the portal DELETED `CHANGELOG.md` in the
 *     2026-08-27 truncation, so every branch from before that date still carries
 *     it. The trunk deleting a file is not this branch adding one.
 *
 * What is left is the rule below — a path this branch ADDED, absent at the merge
 * base and which the trunk's history has never once touched. It raises 1 of the
 * 22, and the one is the true case. It is also STABLE, which the date test is
 * not: it stays true until the work actually lands.
 *
 * THE HISTORY HALF OF THAT RULE WAS PUT THERE BY THE HARNESS, not by this
 * reasoning. The first version asked only whether the trunk has the path NOW,
 * which is a fifth class of false positive the 22 real branches happen not to
 * contain: a branch that adds a file, lands, and has that file deleted from the
 * trunk afterwards. The control written for the `CHANGELOG.md` class went red on
 * it — a rule with three measured rejections behind it, wrong on the first case
 * nobody had met.
 *
 * THE HOLE, NAMED AT THE POINT OF THE NARROWING. A post-squash commit that only
 * MODIFIES files the branch already had is invisible to this, and so is one that
 * adds a path the trunk has independently created. Both are silent, not wrong —
 * the branch stays graded as landed, which is where it was before this existed.
 * The harness carries a case for the modify-only shape asserting that silence,
 * so a later widening has something to flip rather than something to write.
 *
 * ANOTHER AVENUE WAS TRIED AND IS CLOSED, so nobody spends the hour again: git
 * keeps no reflog for a pruned remote-tracking ref. `.git/logs/refs/remotes/
 * origin/<branch>` is removed with the ref, so the moment the upstream went away
 * — which would have answered this exactly — cannot be read off the disk.
 *
 * @returns {string[]|null} null when git refused a question, never [] for that
 */
export function addedAndAbsent(dir, git, base, branch) {
  const mb = git(dir, ['merge-base', base, branch]);
  if (!mb) return null;
  const added = git(dir, ['diff', '--name-only', '--diff-filter=A', mb, branch]);
  if (added === null) return null;
  const out = [];
  for (const p of lines(added)) {
    // `cat-file -e` prints nothing and exits 0 when the path exists, so an
    // empty string is PRESENT and only null is absent-or-refused. Both read as
    // "the trunk has it" here, which is the quiet direction.
    if (git(dir, ['cat-file', '-e', `${base}:${p}`]) !== null) continue;
    // ABSENT FROM THE TIP IS NOT ENOUGH, and the harness's control is what said
    // so rather than any reasoning here. A branch can add a file, land, and the
    // trunk drop that file later — then the path is missing from the tip while
    // the work is long since merged. So ask the trunk's HISTORY: a path it has
    // never once touched is a path this branch's landing never carried.
    const seen = git(dir, ['rev-list', '--max-count=1', base, '--', p]);
    if (seen === null || seen !== '') continue;
    out.push(p);
  }
  return out;
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
    //
    // AND A CONFIGURED UPSTREAM IS NOT EVIDENCE ON ITS OWN, which cost nothing
    // to find because this tick created one: `git worktree add -b <b> <path>
    // origin/main` — the ordinary way a branch is started in this estate — sets
    // the new branch's upstream to origin/MAIN. Read as "it has an upstream, so
    // somebody can see it", that grades a branch nobody has pushed as visible to
    // the world, which is the very silence this file exists to break. An
    // upstream counts only when it is a ref of its OWN, never the trunk every
    // branch here forks from.
    const ownUpstream = !!upstream && upstream !== base;
    const onRemote = !upstreamGone
      && (git(dir, ['rev-parse', '--verify', '--quiet', `origin/${branch}^{commit}`]) !== null
        || (ownUpstream && git(dir, ['rev-parse', '--verify', '--quiet', `${upstream}^{commit}`]) !== null));

    let insertions = null;
    const stat = git(dir, ['diff', '--shortstat', `${base}...${branch}`]);
    const m = /(\d+) insertion/.exec(stat || '');
    if (m) insertions = Number(m[1]);

    // DID THIS BRANCH GAIN WORK AFTER ITS SQUASH LANDED? Asked only of a gone
    // upstream, because that is the only grade whose verdict it can change, and
    // `null` means NOT ASKED rather than none found — the same three-valued
    // shape as `readable` above, for the same reason.
    const addedMissing = upstreamGone ? addedAndAbsent(dir, git, base, branch) : null;

    out.branches.push({
      branch, upstream, upstreamGone, onRemote, unmerged, addedMissing,
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
 *   gone-extended— the same, EXCEPT that the branch has gained work since the
 *                  squash landed: it carries a file it added that the trunk does
 *                  not have. The deletion said the work landed as of the merge,
 *                  and this part came after it. Raises a row, and a different
 *                  one, because the fix is not a plain push. See
 *                  `addedAndAbsent` for why this discriminator and not the
 *                  three that were measured beside it.
 *   pushed       — unmerged, and on the remote. Visible to anybody who looks;
 *                  whether a pull request is open is the question this source
 *                  deliberately does not ask.
 *   stranded     — unmerged, and on NO remote. Nothing outside this laptop knows
 *                  the work exists.
 *
 * `stranded` and `gone-extended` are the two classes that raise a row.
 */
export function classifyBranch(b) {
  if (!b || !b.unmerged) return 'merged';
  if (b.upstreamGone) {
    return (b.addedMissing && b.addedMissing.length) ? 'gone-extended' : 'gone-upstream';
  }
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

    // LANDED, AND THEN ADDED TO. The deletion of the remote branch said the work
    // landed as of the merge; these carry a file they added that the trunk still
    // does not have, so part of them came after it. A separate row from the
    // stranded one because the ADVICE differs: this branch has been pushed
    // before, and pushing it again re-proposes everything the squash already
    // took, since a pull request diffs against the merge base rather than
    // against the trunk.
    for (const b of graded.filter((x) => x.grade === 'gone-extended')) {
      const stamp = b.committedAt ? Date.parse(b.committedAt) : NaN;
      const ageDays = Number.isFinite(stamp) ? Math.max(0, Math.floor((now - stamp) / 86400000)) : null;
      const stat = git(repo.dir, ['diff', '--shortstat', read.base, b.branch, '--', ...b.addedMissing]);
      const m = /(\d+) insertion/.exec(stat || '');
      const size = m ? m[1] : 'an unknown number of';
      items.push({
        key: `extended-branch-${repo.key}-${b.branch.replace(/[^A-Za-z0-9]+/g, '-')}`,
        rank: 3, type: 'unpushed-branch',
        title: `${repo.name}: the branch ${b.branch} was merged and its remote deleted — and it has been committed to SINCE`,
        why: `${size} insertion(s) in ${b.addedMissing.length} file(s) the trunk has never had. `
          + `The deleted remote branch is what makes this repository's finished work look finished, so a branch in `
          + `that state is normally read as landed — this one gained work after the merge, and nothing outside this `
          + `laptop knows about that part. The loop commits to a branch like this every hour and cannot push.`,
        detail: [`last commit ${(b.committedAt || '').slice(0, 10) || 'date unknown'} — ${b.subject || '(no subject)'}`,
          `on the branch and in no trunk: ${b.addedMissing.join(', ')}`].join('\n'),
        who: 'Peter', runbook: 'git', ref: b.branch, repo: repo.name, ageDays,
        do: [
          { kind: 'shell', cwd: repo.dir,
            cmd: `git -C "${repo.dir}" log --oneline ${read.base}..${b.branch}`,
            note: 'one self-contained command; run it from anywhere — it lists every commit the trunk lacks, landed ones included' },
          { kind: 'chat',
            what: 'Do NOT just push it. A pull request diffs against the merge base, so this branch would re-propose '
              + 'everything its squash already took. Start a fresh branch from the trunk and cherry-pick onto it only '
              + 'the commits made after the merge — the ones whose files are named above — then push that and open the '
              + 'pull request for it.' },
          { kind: 'chat', what: 'Nothing in the loop can do this: pushing is denied to an unattended tick by design, which is why the work waits here.' },
        ],
      });
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
