#!/usr/bin/env node
/*
 * prove-red-portal-drift.js — the board's VENDORING verdict, falsified against a
 * synthetic portal repository built here, in the OS temp dir.
 *
 * WHY THIS FILE EXISTS (OA-200). Until 2026-08-31 `portalDrift()` in status.js
 * compared each skill source against the portal's WORKING TREE, so its verdict
 * was a claim about whichever branch a mutable local checkout happened to be on.
 * On 2026-08-31 it reported
 *
 *     DRIFTED  gen_internal.js -> engine\place\gen_internal.js
 *
 * while `main` was perfectly in sync. The checkout sat on a feature branch cut
 * before the re-vendor merged. The named file was the place generator, the skill
 * change was OA-175's exitCaption(), and the consequence a reader would have seen
 * is the live place engine printing `to X` on both tails of a one-way loop —
 * which is the CORR-001 correspondent's first point, in writing, about a
 * published sheet. A re-vendor PR was one command from being opened, and the only
 * thing that stopped it was a second tool disagreeing.
 *
 * WHAT IT PROVES, AND WHY A SYNTHETIC PORTAL. The claim under test is about the
 * relationship between three trees — the skill source, a named git ref, and a
 * working tree — and the real portal can only ever be in one of those states at a
 * time. So the portal here is BUILT: a git repository holding a manifest and two
 * vendored copies, with `refs/remotes/origin/main` written by hand, which is
 * enough for `git rev-parse --verify origin/main` and `git show origin/main:...`
 * to answer exactly as they do against the real one. Nothing under
 * C:\Claude\community-bus-maps is read, written or checked out.
 *
 * AND SINCE 2026-09-21 IT COVERS THE FIXTURE COPY TOO (buses-data OA-419). The
 * portal vendors two things out of two different repositories: the ENGINE, from
 * the skill tree, and buses-data's GATE FIXTURES, under `gate-fixtures/`. The
 * board asked the first and not the second, so a re-stamp that recut an area
 * fixture read exit 0 on the laptop and went red on the next push to buses-data —
 * the repository that bills. The same three trees, the same one decision, and the
 * last three cases below are that day: in step, BEHIND, and the branch-only
 * re-vendor that made two instruments disagree in the same ten minutes.
 *
 * THE PAIR THAT IS THE ROW. Case 2 puts a STALE file in the checkout while
 * `origin/main` is current, and requires the board to stay GREEN and to name the
 * branch it did not read; case 6 does the population half, adding an unlisted .js
 * on a branch only. Both were red before 2026-08-31 and neither can be caught by
 * exit code alone, which is why every case asserts the rows and the source line
 * rather than the colour.
 *
 * AND SINCE 2026-09-22 (OA-422) A THIRD SHAPE: a re-vendor that merges straight
 * onto `origin/main`, with no branch left behind to name, used to be DRIFTED the
 * instant it landed — four reds under unrelated commit subjects on 2026-09-20/21,
 * each cleared only by the next thing that happened to touch the pin. The three
 * `(OA-422)` cases give that merge the same grace a pushed branch has always had,
 * dated from when the mismatching bytes themselves last changed on `origin/main`,
 * and the control beside the older pair proves it still reddens once that grace
 * runs out.
 *
 * Run it from make-bus-leaflet (no placeholders):
 *     npm run test:prove-red-portal-drift
 *     node tools/prove-red-portal-drift.js --keep    leave the scratch repos on disk
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');

const SK = path.join(__dirname, '..');
const ASSETS = path.join(SK, 'assets');
const STATUS = path.join(ASSETS, 'status.js');
const KEEP = process.argv.includes('--keep');
/* --keep means the scratch is EVIDENCE: switch off scratch.js's exit sweep, or
 * the paths printed below would name directories that no longer exist. */
if (KEEP) require('../assets/scratch').keepScratch();

/* The two real skill files the synthetic manifest points at. They are named by
 * the manifest's `source`, which status.js resolves under …/.claude/skills — so
 * these must be paths that genuinely exist, or every case reads MISSING and the
 * harness proves nothing about drift. Small files, deliberately: each one is
 * copied into two commits. */
const SOURCE_A = 'make-bus-leaflet/assets/qr.js';
const SOURCE_B = 'make-bus-leaflet/assets/line_endings.js';
const SKILL_ROOT = path.resolve(SK, '..');           // …/.claude/skills

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function manifest(files) {
  return JSON.stringify({
    _comment: ['A synthetic manifest built by tools/prove-red-portal-drift.js.'],
    skillRootDefault: SKILL_ROOT.replace(/\\/g, '/'),
    files,
  }, null, 2);
}

/* The fixture the OA-419 cases move. One file is enough: the claim under test is
 * about WHICH TREE is compared, not about how many files differ, and a second
 * file would only make the assertions longer. The town name is deliberately not a
 * real one, so a case can never accidentally read the estate. */
const VENDORED_FIXTURE_DIR = 'gate-fixtures';
const FIXTURE_TOWN = 'Harness Town';
const FIXTURE_FILE = 'complexity.json';
const FIXTURE_CURRENT = '{"labels": 2}\n';
const FIXTURE_OLD = '{"labels": 1}\n';

const VENDORED = [
  { path: 'qr.js', kind: 'vendored', source: SOURCE_A, vendoredOn: '2026-08-31' },
  { path: 'place/line_endings.js', kind: 'vendored', source: SOURCE_B, vendoredOn: '2026-08-31' },
  { path: 'wrapper.js', kind: 'portal-owned', reason: 'a portal wrapper with no counterpart in the skills' },
];

/* Commit with a CONTROLLED date. The grace rule is the only part of the
 * vendoring row that contains a judgement about time, so the harness has to be
 * able to put a commit on either side of the boundary. Both variables are set
 * because git takes the committer date for `%(committerdate)`, which is what
 * status.js sorts and ages by, and leaving the author date alone would make the
 * fixture describe two different moments. */
function commitAged(dir, message, ageHours) {
  const when = new Date(Date.now() - ageHours * 3600 * 1000).toISOString();
  execFileSync('git', ['commit', '--quiet', '-m', message], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
}

/* Build a synthetic portal. `mainStale` decides what is committed on the ref the
 * board reads; `branch` puts the checkout somewhere else afterwards; `revendorRef`
 * pushes a re-vendor to a remote-tracking ref that is NOT the one the verdict is
 * about, which is the open-PR window. Every knob is one of the trees the row is
 * about, and nothing here touches the real portal.
 *
 * `mainStaleAgeHours` (OA-422) dates the commit that puts the stale content on
 * `main` itself. It defaults to long past the grace window, because every case
 * that predates OA-422 means "this drift has sat here, settled, forever" and
 * must keep reading DRIFTED — only the cases that explicitly name a young age
 * are testing the new merge-lands-with-grace behaviour. */
function portalRepo({ mainStale = false, mainStaleAgeHours = 999, branch = null, branchStale = false,
                      unlistedOnMain = false, unlistedOnBranch = false,
                      worktreeCurrent = false, noGit = false,
                      revendorRef = null, revendorAgeHours = 0, revendorStale = false,
                      behindRef = null, behindAgeHours = 18,
                      fixtureOnMain = null, fixtureOnBranch = null } = {}) {
  const dir = scratchDir('prove-red-portal-drift-');
  const engine = path.join(dir, 'engine');
  fs.mkdirSync(path.join(engine, 'place'), { recursive: true });

  /* THE VENDORED FIXTURE COPY (buses-data OA-419). The same three trees as the
   * engine rows above, about a different file: `gate-fixtures/` holds this
   * repository's copy of buses-data's `_portal-fixture` folders, and buses-data's
   * own gates.yml asks whether it has fallen behind by checking this repository
   * out at its DEFAULT BRANCH. So a re-vendor sitting on a branch is not an
   * answer, and the only reading that predicts the push is the ref's. */
  const fixtureFile = path.join(dir, VENDORED_FIXTURE_DIR, 'Areas', '_portal-fixture', FIXTURE_TOWN, FIXTURE_FILE);
  const writeFixture = (body) => {
    if (body === null) return;
    fs.mkdirSync(path.dirname(fixtureFile), { recursive: true });
    fs.writeFileSync(fixtureFile, body);
  };

  const current = (rel) => fs.readFileSync(path.join(SKILL_ROOT, rel));
  const stale = (rel) => Buffer.concat([current(rel), Buffer.from('\n// a line the source does not have\n')]);

  const writeTree = ({ staleA, unlisted }) => {
    fs.writeFileSync(path.join(engine, 'vendored.json'), manifest(VENDORED));
    fs.writeFileSync(path.join(engine, 'qr.js'), staleA ? stale(SOURCE_A) : current(SOURCE_A));
    fs.writeFileSync(path.join(engine, 'place', 'line_endings.js'), current(SOURCE_B));
    fs.writeFileSync(path.join(engine, 'wrapper.js'), '// portal-owned\n');
    const extra = path.join(engine, 'extra.js');
    if (unlisted) fs.writeFileSync(extra, '// a vendored file nobody listed\n');
    else if (fs.existsSync(extra)) fs.rmSync(extra);
  };

  if (noGit) { writeTree({ staleA: mainStale, unlisted: unlistedOnMain }); writeFixture(fixtureOnMain); return dir; }

  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.email', 'harness@example.invalid']);
  git(dir, ['config', 'user.name', 'prove-red-portal-drift']);
  git(dir, ['checkout', '--quiet', '-b', 'main']);
  /* A BRANCH THAT IS MERELY BEHIND (OA-422, 2026-09-23). `main` first holds
   * the source's bytes, a branch is cut there that touches only a portal-owned
   * file, and then `main` moves the vendored file on. The branch still holds
   * the source's bytes without ever having re-vendored anything — the shape of
   * portal PR #333, a dependabot bump named as the re-vendor that reddened
   * buses-data's main on 2026-09-23. */
  if (behindRef) {
    writeTree({ staleA: false, unlisted: false });
    git(dir, ['add', '-A']);
    commitAged(dir, 'main before it moved the vendored file', behindAgeHours + 1);
    git(dir, ['checkout', '--quiet', '-b', behindRef]);
    fs.writeFileSync(path.join(engine, 'wrapper.js'), '// portal-owned, bumped by a dependency PR\n');
    git(dir, ['add', '-A']);
    commitAged(dir, 'a dependency bump that never touches the engine', behindAgeHours);
    git(dir, ['update-ref', 'refs/remotes/origin/' + behindRef, git(dir, ['rev-parse', 'HEAD'])]);
    git(dir, ['checkout', '--quiet', 'main']);
  }
  writeTree({ staleA: mainStale, unlisted: unlistedOnMain });
  writeFixture(fixtureOnMain);
  git(dir, ['add', '-A']);
  if (mainStale) commitAged(dir, 'the state of origin/main', mainStaleAgeHours);
  else git(dir, ['commit', '--quiet', '-m', 'the state of origin/main']);

  /* THE REMOTE-TRACKING REF, WRITTEN BY HAND. There is no remote to fetch from
   * and there does not need to be one: `origin/main` is a ref like any other, and
   * status.js reaches it through rev-parse and `git show`, both of which are
   * indifferent to how it got there. */
  git(dir, ['update-ref', 'refs/remotes/origin/main', git(dir, ['rev-parse', 'HEAD'])]);

  if (branch) {
    git(dir, ['checkout', '--quiet', '-b', branch]);
    writeTree({ staleA: branchStale, unlisted: unlistedOnBranch });
    writeFixture(fixtureOnBranch);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '-m', 'the state of the feature branch']);
  }
  /* A re-vendor PUSHED TO A BRANCH: origin/main is stale, and some OTHER
   * remote-tracking ref carries the current source. This is the open-PR window
   * the documented push order creates, and before 2026-08-31 it read DRIFTED —
   * true, useless, and red on every engine rollout. The working tree is left on
   * main's stale content on purpose, so the working-tree PENDING path cannot
   * answer and only the branch rule can. */
  if (revendorRef) {
    git(dir, ['checkout', '--quiet', '-b', revendorRef]);
    /* `revendorStale` makes this a branch that EXISTS and does not carry the
     * fix — a different third content, so it matches neither origin/main nor the
     * skill source. That is the control for the rule reading "is there a branch"
     * when what it must read is "do these BYTES exist on a branch". */
    fs.writeFileSync(path.join(engine, 'qr.js'),
      revendorStale ? Buffer.concat([current(SOURCE_A), Buffer.from('\n// a branch that is not the re-vendor\n')])
                    : current(SOURCE_A));
    git(dir, ['add', '-A']);
    commitAged(dir, 'the re-vendor, sitting in an open PR', revendorAgeHours);
    git(dir, ['update-ref', 'refs/remotes/origin/' + revendorRef, git(dir, ['rev-parse', 'HEAD'])]);
    git(dir, ['checkout', '--quiet', 'main']);
    git(dir, ['checkout', '--quiet', '--', '.']);
  }

  /* An UNCOMMITTED re-vendor: the working tree holds the current source while the
   * ref does not. That is PENDING, and it is the one state the old reading called
   * green. */
  if (worktreeCurrent) fs.writeFileSync(path.join(engine, 'qr.js'), current(SOURCE_A));
  return dir;
}

/* An empty Buses tree, so that nothing but the portal can colour the board. A
 * tree with maps in it would let a byte gate answer for the vendoring row. */
function emptyBuses() {
  return scratchDir('prove-red-portal-drift-buses-');
}

/* A Buses tree holding ONE fixture file and no maps, for the OA-419 cases. It is
 * not `Areas/<town>/` — `_portal-fixture` is the folder the portal vendors and
 * findTowns() skips names beginning with an underscore, so this adds a fixture to
 * compare and still no map that could colour the board. */
function busesWithFixture(body) {
  const dir = scratchDir('prove-red-portal-drift-buses-fixture-');
  const f = path.join(dir, 'Areas', '_portal-fixture', FIXTURE_TOWN, FIXTURE_FILE);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return dir;
}

function board(busesDir, portalDir, statusPath = STATUS, extra = []) {
  let out, code = 0;
  try {
    out = execFileSync(process.execPath,
      [statusPath, '--buses', busesDir, '--portal', portalDir, '--no-quality', '--no-live', '--json', ...extra],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    if (typeof e.status !== 'number') throw e;
    code = e.status; out = e.stdout;
  }
  let json = null;
  try { json = JSON.parse(out); } catch { json = null; }
  return { code, json };
}

const rowFor = (json, needle) => (json.portalDrift || []).find(r => String(r.file).includes(needle));
const statusOf = (r) => !r ? 'ABSENT' : (r.status || (r.same === null ? 'MISSING' : r.same ? 'in sync' : 'DRIFTED'));

const CASES = [
  {
    label: 'control: origin/main carries the current source',
    make: {},
    expect: 0,
    also: (json, dir) => {
      if (statusOf(rowFor(json, 'qr.js')) !== 'in sync') return 'qr.js read ' + statusOf(rowFor(json, 'qr.js'));
      const s = json.portalDriftSource;
      if (!s || s.ref !== 'origin/main') return 'the board did not say it read origin/main: ' + JSON.stringify(s);
      if (s.branch !== 'main') return 'the checkout should be on main, and the board says ' + s.branch;
      return null;
    },
    what: 'a synthetic portal in sync must be green, or a red one below proves nothing',
  },
  {
    /* THE ROW. Before 2026-08-31 this case went red and named a real file. */
    label: 'the CHECKOUT is stale and origin/main is not',
    make: { branch: 'worklist-demo-applications', branchStale: true },
    expect: 0,
    also: (json, dir) => {
      /* The fixture must not be free: assert the working tree really does differ
       * from the source, so a green here cannot come from having mutated nothing. */
      const onDisk = fs.readFileSync(path.join(dir, 'engine', 'qr.js'));
      const src = fs.readFileSync(path.join(SKILL_ROOT, SOURCE_A));
      if (onDisk.equals(src)) return 'the fixture never made the checkout stale';
      if (statusOf(rowFor(json, 'qr.js')) !== 'in sync') return 'the board judged the CHECKOUT, not the ref: qr.js read ' + statusOf(rowFor(json, 'qr.js'));
      const s = json.portalDriftSource;
      if (!s || s.branch !== 'worklist-demo-applications') return 'the board did not name the branch it declined to read: ' + JSON.stringify(s);
      if (s.ref !== 'origin/main') return 'the board did not read origin/main: ' + JSON.stringify(s);
      return null;
    },
    what: 'OA-200 - this reported DRIFTED about a published sheet, and main was clean',
  },
  {
    label: 'THE GATE: origin/main itself carries a stale copy',
    make: { mainStale: true },
    expect: 1,
    also: (json) => {
      const st = statusOf(rowFor(json, 'qr.js'));
      if (st !== 'DRIFTED') return 'the board went red, but qr.js read ' + st;
      return null;
    },
    what: 'reading a ref must not cost the finding the whole row exists to make',
  },
  {
    label: 'vendored in the working tree and not merged is PENDING',
    make: { mainStale: true, worktreeCurrent: true },
    expect: 1,
    also: (json) => {
      const st = statusOf(rowFor(json, 'qr.js'));
      if (st !== 'PENDING') return 'expected PENDING, got ' + st;
      return null;
    },
    what: 'the disk agreeing is not the deployable engine being current',
  },
  /* THE 2026-08-31 ROW. A re-vendor pushed to a branch, origin/main still stale:
   * the open-PR window the documented push order creates. Amber, not red — and
   * the four cases after this one are what stop that from being a hole. */
  {
    label: 'a re-vendor pushed to a branch is amber, not DRIFTED',
    make: { mainStale: true, revendorRef: 'revendor', revendorAgeHours: 0 },
    expect: 0,
    also: (json) => {
      const r = rowFor(json, 'qr.js');
      if (!r) return 'no qr.js row at all';
      if (r.status !== 'PENDING') return 'expected PENDING, got ' + statusOf(r);
      if (r.inFlight !== true) return 'expected inFlight, got ' + JSON.stringify(r.inFlight);
      // NAME the ref. A row that says "somewhere" is one nobody can act on, and
      // asserting it is what stops the rule passing because some unrelated ref
      // happened to agree.
      if (r.pendingOn !== 'origin/revendor') return 'expected pendingOn origin/revendor, got ' + r.pendingOn;
      return null;
    },
    what: 'the push order guarantees this window; calling it red reddened two repos on every rollout',
  },
  {
    /* The same fixture, proved RED. This is the assertion that makes the case
     * above mean something: without it, "expect 0" is satisfied by a board that
     * stopped looking at the portal at all. */
    label: '...and the SAME fixture goes red with --drift-grace-hours 0',
    make: { mainStale: true, revendorRef: 'revendor', revendorAgeHours: 0 },
    args: ['--drift-grace-hours', '0'],
    expect: 1,
    also: (json) => {
      const r = rowFor(json, 'qr.js');
      if (r.status !== 'PENDING') return 'expected PENDING, got ' + statusOf(r);
      if (r.inFlight !== false) return 'grace 0 must leave nothing in flight, got ' + JSON.stringify(r.inFlight);
      return null;
    },
    what: 'the amber branch is a judgement about TIME, so it has to be provable at the boundary',
  },
  {
    label: 'a re-vendor that has sat past the grace is RED again',
    make: { mainStale: true, revendorRef: 'revendor', revendorAgeHours: 48 },
    expect: 1,
    also: (json) => {
      const r = rowFor(json, 'qr.js');
      if (r.status !== 'PENDING') return 'expected PENDING, got ' + statusOf(r);
      if (r.inFlight !== false) return 'a 48h-old branch must not be in flight';
      if (!(r.ageHours >= 48)) return 'expected an age of at least 48h, got ' + r.ageHours;
      return null;
    },
    what: 'an abandoned re-vendor branch closes its own hole; this is why no GitHub API is needed',
  },
  {
    /* THE CONTROL THAT MATTERS MOST. The whole change is a way of NOT reporting
     * something, so the case that must stay red is a genuine drift with no branch
     * carrying the fix. If this ever goes green the rule has stopped discriminating
     * and has become a way of never reporting drift at all. */
    label: 'control: drift with NO branch carrying the fix is still RED',
    make: { mainStale: true },
    expect: 1,
    also: (json) => {
      const r = rowFor(json, 'qr.js');
      if (statusOf(r) !== 'DRIFTED') return 'expected DRIFTED, got ' + statusOf(r);
      if (r.inFlight) return 'nothing is in flight here and the board says there is';
      if (r.pendingOn) return 'no ref carries this fix, and the board named ' + r.pendingOn;
      return null;
    },
    what: 'green here would mean the widening had swallowed the finding the row exists for',
  },
  /* THE 2026-09-22 ROW (OA-422). A re-vendor PR merges straight onto `main`
   * with no branch left behind to carry the fix -- the case above's `found`
   * is null, and until now that meant DRIFTED the instant the merge landed,
   * with no grace at all. The three cases below are that window, its
   * boundary, and its own control. */
  {
    label: 'a merge onto origin/main itself is amber within the grace (OA-422)',
    make: { mainStale: true, mainStaleAgeHours: 0 },
    expect: 0,
    also: (json) => {
      const r = rowFor(json, 'qr.js');
      if (!r) return 'no qr.js row at all';
      if (r.status !== 'PENDING') return 'expected PENDING, got ' + statusOf(r);
      if (r.inFlight !== true) return 'expected inFlight, got ' + JSON.stringify(r.inFlight);
      if (r.pendingOn) return 'there is no separate branch here, and the board named ' + r.pendingOn;
      return null;
    },
    what: 'the remedy already merged; only the pin (or the next re-vendor) has not caught up yet',
  },
  {
    /* The same fixture, proved RED, exactly as the branch-flavoured pair above
     * does — without this, "expect 0" above is satisfied by a board that
     * stopped looking at all. */
    label: '...and the SAME fixture goes red with --drift-grace-hours 0 (OA-422)',
    make: { mainStale: true, mainStaleAgeHours: 0 },
    args: ['--drift-grace-hours', '0'],
    expect: 1,
    also: (json) => {
      const r = rowFor(json, 'qr.js');
      if (statusOf(r) !== 'DRIFTED') return 'expected DRIFTED, got ' + statusOf(r);
      if (r.inFlight) return 'grace 0 must leave nothing in flight';
      return null;
    },
    what: 'the amber window is a judgement about TIME, so it has to be provable at the boundary',
  },
  {
    label: 'a merge onto origin/main that has sat past the grace is RED again (OA-422)',
    make: { mainStale: true, mainStaleAgeHours: 48 },
    expect: 1,
    also: (json) => {
      const r = rowFor(json, 'qr.js');
      if (statusOf(r) !== 'DRIFTED') return 'expected DRIFTED, got ' + statusOf(r);
      if (r.inFlight) return 'a 48h-old merge must not be in flight';
      return null;
    },
    what: 'an old, settled drift closes its own hole exactly as the 999h default above already does',
  },
  {
    label: 'a branch merely BEHIND main is no witness to a re-vendor (OA-422)',
    make: { mainStale: true, mainStaleAgeHours: 0, behindRef: 'dependabot', behindAgeHours: 18 },
    expect: 0,
    also: (json, dir) => {
      /* The fixture must not be free: the branch really does carry the source's bytes. */
      const onBranch = execFileSync('git', ['show', 'origin/dependabot:engine/qr.js'], { cwd: dir });
      if (!onBranch.equals(fs.readFileSync(path.join(SKILL_ROOT, SOURCE_A)))) return 'the fixture never put the source bytes on the branch';
      const r = rowFor(json, 'qr.js');
      if (!r) return 'no qr.js row at all';
      if (r.pendingOn) return 'a branch that never touched the file was named as the re-vendor: ' + r.pendingOn;
      if (r.status !== 'PENDING' || r.inFlight !== true) return 'expected the landed-merge grace, got ' + statusOf(r) + ' inFlight ' + JSON.stringify(r.inFlight);
      return null;
    },
    what: 'portal PR #333 did this to buses-data main on 2026-09-23, inside the grace its merge had earned',
  },
  {
    /* The other direction: a branch that is NOT a re-vendor must not excuse
     * anything. Same shape as the row above, but the branch carries main's stale
     * content, so no ref anywhere holds the current source. */
    label: 'control: an unrelated branch does not excuse a real drift',
    make: { mainStale: true, revendorRef: 'unrelated', revendorStale: true },
    expect: 1,
    also: (json) => {
      const r = rowFor(json, 'qr.js');
      if (r.inFlight) return 'an unrelated branch was treated as a re-vendor';
      return null;
    },
    what: 'the witness is the BYTES on the ref, never the existence of a branch',
  },
  {
    label: 'an engine .js on origin/main that the manifest never names',
    make: { unlistedOnMain: true },
    expect: 1,
    also: (json) => {
      const st = statusOf(rowFor(json, 'extra.js'));
      if (st !== 'UNLISTED') return 'expected UNLISTED, got ' + st;
      return null;
    },
    what: 'the population check follows the ref, and still counts',
  },
  {
    /* The population half of case 2. A file a feature branch adds is not yet part
     * of the vendored engine, and a disk walk would have called it UNLISTED. */
    label: 'an engine .js that exists only on the feature branch',
    make: { branch: 'add-a-generator', unlistedOnBranch: true },
    expect: 0,
    also: (json, dir) => {
      if (!fs.existsSync(path.join(dir, 'engine', 'extra.js'))) return 'the fixture never added the file to the checkout';
      const r = rowFor(json, 'extra.js');
      if (r) return 'the board named a branch-only file: ' + JSON.stringify(r);
      return null;
    },
    what: 'OA-200, the population half - a disk walk would have called this UNLISTED',
  },
  {
    label: 'a portal that is not a git repository at all',
    make: { noGit: true },
    expect: 0,
    also: (json) => {
      const s = json.portalDriftSource;
      if (!s) return 'the board reported no source at all';
      if (s.ref !== null) return 'there is no git here, and the board claims to have read ' + s.ref;
      if (statusOf(rowFor(json, 'qr.js')) !== 'in sync') return 'the disk fallback did not compare: ' + statusOf(rowFor(json, 'qr.js'));
      return null;
    },
    what: 'the fallback is allowed, and it must SAY it read a working tree',
  },

  /* ---- the VENDORED FIXTURE copy (buses-data OA-419) ---------------------
   * The three cases below are about `gate-fixtures/`, not about `engine/`. On
   * 2026-09-21 a nine-town re-stamp recut `Areas/_portal-fixture/St Ives`, the
   * board read exit 0, and the push went red on buses-data's own gates.yml step
   * *The portal's vendored fixtures are in step with this repository* — one
   * billed run, in the one repository that bills. The middle case is that day. */
  {
    label: 'control: the portal has vendored the current fixture',
    make: { fixtureOnMain: FIXTURE_CURRENT },
    buses: () => busesWithFixture(FIXTURE_CURRENT),
    expect: 0,
    also: (json) => {
      const v = json.portalFixtureVendoring;
      if (!v) return 'the board did not report on the vendored fixtures at all';
      if (v.status !== 'in step') return 'a matching fixture read ' + v.status + ': ' + JSON.stringify(v.behind);
      return null;
    },
    what: 'a fixture in step must read green, or the BEHIND below proves nothing',
  },
  {
    label: 'THE ROW: buses-data recut the fixture and nobody re-vendored',
    make: { fixtureOnMain: FIXTURE_OLD },
    buses: () => busesWithFixture(FIXTURE_CURRENT),
    /* GREEN ON PURPOSE. This is a CHORE under OA-396: the artwork is right and
     * only the next push is blocked, so the board must SAY it and must not go
     * red. A case expecting exit 1 here would be asking for the thing that rule
     * exists to stop. */
    expect: 0,
    also: (json) => {
      const v = json.portalFixtureVendoring;
      if (!v) return 'the board did not report on the vendored fixtures at all';
      if (v.status !== 'BEHIND') return 'a fixture the portal has not re-vendored read ' + v.status;
      const hit = (v.behind || []).find((b) => String(b.file).includes(FIXTURE_FILE));
      if (!hit) return 'BEHIND, but it did not name the file: ' + JSON.stringify(v.behind);
      if (hit.state !== 'differs') return 'the file was named as ' + hit.state + ', wanted differs';
      return null;
    },
    what: 'the 2026-09-21 red, predicted for free instead of bought at a push',
  },
  {
    /* THE DISCRIMINATOR. This is the state the laptop was actually in that
     * morning: `npm run fixtures:vendor` said `in step` while CI said six files
     * BEHIND, minutes apart, about the same two commits — because the script
     * compares working tree against working tree and a session had already
     * applied the re-vendor on a branch. Both readings were right about
     * different questions, and only the ref's answers *will the next push go
     * red*. It is also the case the self-falsification below requires to fail. */
    label: 'the re-vendor is on a BRANCH and origin/main is still behind',
    make: { fixtureOnMain: FIXTURE_OLD, branch: 'vendor/area-fixture', fixtureOnBranch: FIXTURE_CURRENT },
    buses: () => busesWithFixture(FIXTURE_CURRENT),
    expect: 0,
    also: (json) => {
      const v = json.portalFixtureVendoring;
      if (!v) return 'the board did not report on the vendored fixtures at all';
      if (v.status !== 'BEHIND') return 'the board judged the CHECKOUT, not the ref: it read ' + v.status;
      if (!v.source || v.source.ref !== 'origin/main') return 'the board did not read origin/main: ' + JSON.stringify(v.source);
      if (v.source.branch !== 'vendor/area-fixture') return 'the board did not name the branch it declined to read: ' + JSON.stringify(v.source);
      return null;
    },
    what: 'a fix on a branch is not an answer to whether the push goes red',
  },
];

const kept = [];

/* Run one case and say whether it behaved as its `expect` and its `also` claim.
 * The colour alone is never the verdict: a board that never LOOKED at the portal
 * is green too, and the two cases this file exists for differ from their opposite
 * only in which tree was read — a fact no exit code carries. */
function runCase(c, statusPath = STATUS) {
  const portal = portalRepo(c.make);
  const buses = c.buses ? c.buses() : emptyBuses();
  kept.push(portal, buses);
  const { code, json } = board(buses, portal, statusPath, c.args || []);
  const wantRed = c.expect !== 0;
  const colourOk = (code !== 0) === wantRed;
  const alsoWhy = json ? c.also(json, portal) : 'the board printed no parseable JSON';
  if (!KEEP) { fs.rmSync(portal, { recursive: true, force: true }); fs.rmSync(buses, { recursive: true, force: true }); }
  return {
    ok: colourOk && !alsoWhy,
    verdict: !colourOk ? (wantRed ? 'SURVIVED' : 'CONTROL RED') : alsoWhy ? 'VACUOUS' : wantRed ? 'caught' : 'green',
    detail: alsoWhy ? 'exit ' + code + ' BUT ' + alsoWhy : 'exit ' + code,
    code, json,
  };
}

/* A COPY OF THE ENGINE WITH OA-200 TAKEN BACK OUT. `ref = null` is precisely the
 * pre-2026-08-31 behaviour: no ref is read, the manifest and every file come off
 * the working tree, and the population is a disk walk. It is one line because the
 * fix is one decision.
 *
 * WHY THIS IS HERE AT ALL. Seven green rows above are exactly what a harness that
 * asserts nothing also prints. The two cases this file was written for — a stale
 * CHECKOUT and a branch-only file — are green under the fix and were red before
 * it, and nothing else in this project can tell those two states apart. So the
 * harness falsifies ITSELF: it re-runs those two against the old behaviour and
 * requires both to fail. If a later edit makes them pass under `ref = null` they
 * have stopped testing the thing they are named for, and this says so.
 *
 * SINCE OA-419 THERE ARE TWO MUTATIONS, one per block, and each is the same
 * decision written twice: read a NAMED REF, or read whatever is on this disk.
 * They are separate strings rather than one global replace because `portalDrift()`
 * and `portalFixtureVendoring()` both open with `const ref = source && source.ref`
 * and a replace that hit the wrong one would mutate a block the case does not
 * name — which is the shape of a harness that goes red for a reason of its own. */
const MUTATION_OA200 = {
  file: 'status.js',
  find: '  const ref = source && source.ref;\n',
  replace: '  const ref = null; // MUTATED by prove-red-portal-drift.js: the pre-OA-200 reading\n',
  why: 'portalDrift() no longer picks its ref from portalSource()',
};
const MUTATION_OA419 = {
  file: 'portal_fixtures.js',
  find: '  const ref = source && source.ref;   // the ref CI checks out, never this laptop\'s disk',
  replace: '  const ref = null; // MUTATED by prove-red-portal-drift.js: the pre-OA-419 reading, the DISK',
  why: 'fixtureVendoring() no longer picks its ref from the source it is handed',
};
/* THE THIRD, for OA-422: a merge that lands its bytes on `ref` itself no
 * longer earns any grace at all, which is exactly the reading this row
 * replaced. Targets the `if (inFlight)` guard rather than the `ageHours`
 * computation above it, because a case that mutates only the DATE could
 * still pass by accident if the harness's own clock arithmetic happened to
 * agree, and a mutation that flips just `row.inFlight` after the guard has
 * already fired would still leave `row.status` set to PENDING — the guard
 * itself is the one mutation that removes the grace rather than just its own
 * label. */
const MUTATION_OA422 = {
  file: 'status.js',
  find: '        if (inFlight) {\n',
  replace: '        if (false) { // MUTATED by prove-red-portal-drift.js: the pre-OA-422 reading, no grace on a merge\n',
  why: 'a merge landing directly on origin/main no longer gets any grace window',
};

/* AND THE FOURTH, for the 2026-09-23 half of OA-422: any ref holding the
 * source's bytes is a witness again, whether or not it ever touched the file. */
const MUTATION_WITNESS = {
  file: 'status.js',
  find: ' && changedSinceFork(cand.ref, rel, buf)) return cand;',
  replace: ') return cand; // MUTATED by prove-red-portal-drift.js: a branch merely behind main is a witness again',
  why: 'vendoredOnOtherRef() no longer asks whether the ref changed the file',
};

function regressedStatus(mutations = [MUTATION_OA200]) {
  const root = scratchDir('prove-red-portal-drift-engine-');
  const dst = path.join(root, 'assets');
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(ASSETS, { withFileTypes: true })) {
    if (e.isDirectory()) continue;
    fs.copyFileSync(path.join(ASSETS, e.name), path.join(dst, e.name));
  }
  const f = path.join(dst, 'status.js');
  /* THE MUTATION NAMES ITS OWN FILE. The fixture half lives in portal_fixtures.js
   * since OA-419, and both modules open their block with the same line — so a
   * replace that did not say which file it meant would silently mutate the wrong
   * one and the case would fail for a reason it does not name. */
  const edit = (file, find, replace, why) => {
    const target = path.join(dst, file);
    let src = fs.readFileSync(target, 'utf8');
    if (!src.includes(find)) throw new Error('prove-red-portal-drift: ' + why + ' — re-point this file at whatever replaced `' + find.trim() + '` in ' + file + '.');
    fs.writeFileSync(target, src.replace(find, replace));
  };
  for (const m of mutations) edit(m.file, m.find, m.replace, m.why);
  /* AND THE SKILL ROOT, WHICH IS NOT DECORATION. status.js derives it from its own
   * location, so a copy running out of the OS temp dir resolves every manifest
   * `source` to a path that does not exist and every row reads MISSING. The first
   * cut of this self-falsification did exactly that and scored both regression
   * cases as "goes red" — red, and for a reason that has nothing to do with which
   * tree was read. A harness that accepts any red is not a harness. */
  edit('status.js', "  const SKILL_ROOT = path.resolve(SK, '..', '..');",
       '  const SKILL_ROOT = ' + JSON.stringify(SKILL_ROOT) + ';',
       'portalDrift() no longer derives SKILL_ROOT from SK');
  kept.push(root);
  return { statusPath: f, root };
}

const rows = [];
let failed = 0;
for (const c of CASES) {
  const r = runCase(c);
  if (!r.ok) failed++;
  rows.push([r.verdict, c.label, r.detail, c.what]);
}

/* The self-falsification. Only the two cases whose subject is WHICH TREE was
 * read: the other five are about drift itself and would go the same way under
 * either reading, so requiring them to fail would be requiring the wrong thing. */
/* Each names the row the OLD reading must produce, not merely that something went
 * wrong. `MISSING` is what a copy that cannot find the skill sources reports, and
 * it is the red this pair scored on its first run — so the reason is asserted. */
const REGRESSION_SUBJECTS = [
  { label: 'the CHECKOUT is stale and origin/main is not', file: 'qr.js', want: 'DRIFTED' },
  { label: 'an engine .js that exists only on the feature branch', file: 'extra.js', want: 'UNLISTED' },
];
const inj = regressedStatus();
for (const sub of REGRESSION_SUBJECTS) {
  const c = CASES.find(x => x.label === sub.label);
  if (!c) throw new Error('prove-red-portal-drift: no case named "' + sub.label + '" — the self-falsification list is out of date.');
  const r = runCase(c, inj.statusPath);
  const got = r.json ? statusOf(rowFor(r.json, sub.file)) : '(no JSON)';
  const rightReason = !r.ok && got === sub.want;
  if (!rightReason) failed++;
  rows.push([r.ok ? 'STILL PASSES' : rightReason ? 'goes red' : 'RED, WRONG CAUSE',
    'with OA-200 removed: ' + c.label,
    sub.file + ' read ' + got + ' (wanted ' + sub.want + ')',
    r.ok ? 'THIS CASE NO LONGER TESTS WHICH TREE WAS READ'
      : rightReason ? 'the case discriminates: it was red before the fix'
      : 'red for a reason that is not the old reading']);
}
if (!KEEP) fs.rmSync(inj.root, { recursive: true, force: true });

/* THE SAME SELF-FALSIFICATION FOR THE FIXTURE BLOCK (OA-419). Its discriminating
 * case is the branch-only re-vendor, for the same reason as the engine one above:
 * every other fixture case would go the same way whichever tree was read, and
 * requiring them to fail would be requiring the wrong thing. Under the disk
 * reading the branch's copy answers and the block reads `in step` — which is
 * exactly what the bare `fixtures:vendor` said on the laptop that morning while
 * CI was red. The assertion is on the WORD, not on the colour: this block never
 * changes the exit code, so a harness reading the exit code alone could not tell
 * the two readings apart at all. */
const FIXTURE_REGRESSION = 'the re-vendor is on a BRANCH and origin/main is still behind';
{
  const c = CASES.find((x) => x.label === FIXTURE_REGRESSION);
  if (!c) throw new Error('prove-red-portal-drift: no case named "' + FIXTURE_REGRESSION + '" — the self-falsification list is out of date.');
  const injF = regressedStatus([MUTATION_OA419]);
  const r = runCase(c, injF.statusPath);
  const got = r.json && r.json.portalFixtureVendoring ? r.json.portalFixtureVendoring.status : '(no JSON)';
  const rightReason = !r.ok && got === 'in step';
  if (!rightReason) failed++;
  rows.push([r.ok ? 'STILL PASSES' : rightReason ? 'goes red' : 'RED, WRONG CAUSE',
    'with OA-419 removed: ' + c.label,
    'the fixture block read ' + got + ' (wanted in step)',
    r.ok ? 'THIS CASE NO LONGER TESTS WHICH TREE WAS READ'
      : rightReason ? 'the case discriminates: the disk reading calls it in step'
      : 'wrong for a reason that is not the disk reading']);
  if (!KEEP) fs.rmSync(injF.root, { recursive: true, force: true });
}

/* THE SELF-FALSIFICATION FOR THE GRACE WINDOW ITSELF (OA-422). Its
 * discriminating case is the fresh merge onto `origin/main` with no branch
 * behind it: every other case above would go the same way whether or not the
 * grace exists, because they are all either in sync, excused by a BRANCH, or
 * aged past any grace already. Under the pre-OA-422 reading a fresh merge is
 * DRIFTED the instant it lands, which is the four-reds cost this row exists
 * to remove — so the case that must flip from green to red when the window is
 * mutated away is this one. */
const GRACE_REGRESSION = 'a merge onto origin/main itself is amber within the grace (OA-422)';
{
  const c = CASES.find((x) => x.label === GRACE_REGRESSION);
  if (!c) throw new Error('prove-red-portal-drift: no case named "' + GRACE_REGRESSION + '" — the self-falsification list is out of date.');
  const injG = regressedStatus([MUTATION_OA422]);
  const r = runCase(c, injG.statusPath);
  const got = r.json ? statusOf(rowFor(r.json, 'qr.js')) : '(no JSON)';
  const rightReason = !r.ok && got === 'DRIFTED';
  if (!rightReason) failed++;
  rows.push([r.ok ? 'STILL PASSES' : rightReason ? 'goes red' : 'RED, WRONG CAUSE',
    'with OA-422 removed: ' + c.label,
    'qr.js read ' + got + ' (wanted DRIFTED)',
    r.ok ? 'THIS CASE NO LONGER TESTS THE GRACE WINDOW'
      : rightReason ? 'the case discriminates: a fresh merge was red before the fix'
      : 'red for a reason that is not the old, grace-less reading']);
  if (!KEEP) fs.rmSync(injG.root, { recursive: true, force: true });
}

/* THE SAME FOR THE WITNESS RULE (OA-422, 2026-09-23). Under the old rule the
 * behind branch is named, past its grace, and the board goes red — the colour
 * buses-data's main actually turned. */
const WITNESS_REGRESSION = 'a branch merely BEHIND main is no witness to a re-vendor (OA-422)';
{
  const c = CASES.find((x) => x.label === WITNESS_REGRESSION);
  if (!c) throw new Error('prove-red-portal-drift: no case named "' + WITNESS_REGRESSION + '" — the self-falsification list is out of date.');
  const injW = regressedStatus([MUTATION_WITNESS]);
  const r = runCase(c, injW.statusPath);
  const row = r.json ? rowFor(r.json, 'qr.js') : null;
  const rightReason = !r.ok && r.code !== 0 && !!row && row.pendingOn === 'origin/dependabot';
  if (!rightReason) failed++;
  rows.push([r.ok ? 'STILL PASSES' : rightReason ? 'goes red' : 'RED, WRONG CAUSE',
    'with the witness rule removed: ' + c.label,
    'qr.js pendingOn ' + (row ? row.pendingOn : '(no row)') + ' (wanted origin/dependabot)',
    r.ok ? 'THIS CASE NO LONGER TESTS THE WITNESS RULE'
      : rightReason ? 'the case discriminates: a behind branch was red before the fix'
      : 'red for a reason that is not the old witness rule']);
  if (!KEEP) fs.rmSync(injW.root, { recursive: true, force: true });
}

const TOTAL = CASES.length + REGRESSION_SUBJECTS.length + 3;
const w = [14, 62, 46];
for (const r of rows) console.log(r[0].padEnd(w[0]) + r[1].padEnd(w[1]) + r[2].padEnd(w[2]) + r[3]);
if (KEEP) for (const k of kept) console.log('kept  ' + k);

if (failed) {
  console.error('\n' + failed + ' of ' + TOTAL + ' cases did not behave as claimed — the vendoring verdict is not what status.js says it is.');
  process.exitCode = 1;
} else {
  console.log('\nall ' + TOTAL + ' cases behaved as claimed: the verdict is about a named ref, it still goes red when that ref is stale, '
    + 'a local re-vendor that has not merged reads PENDING rather than green, the population follows the ref too, a portal with no git says so, '
    + 'the VENDORED FIXTURE copy is read off the same ref and says BEHIND without going red, '
    + 'a merge landing straight on origin/main gets the same grace a pushed branch always has, '
    + 'a branch merely behind main is never named as its re-vendor, '
    + 'and all four tree/time/witness cases go red the moment their own fix is taken back out.');
}
