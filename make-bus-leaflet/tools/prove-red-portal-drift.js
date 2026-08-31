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
 * THE PAIR THAT IS THE ROW. Case 2 puts a STALE file in the checkout while
 * `origin/main` is current, and requires the board to stay GREEN and to name the
 * branch it did not read; case 6 does the population half, adding an unlisted .js
 * on a branch only. Both were red before 2026-08-31 and neither can be caught by
 * exit code alone, which is why every case asserts the rows and the source line
 * rather than the colour.
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

const VENDORED = [
  { path: 'qr.js', kind: 'vendored', source: SOURCE_A, vendoredOn: '2026-08-31' },
  { path: 'place/line_endings.js', kind: 'vendored', source: SOURCE_B, vendoredOn: '2026-08-31' },
  { path: 'wrapper.js', kind: 'portal-owned', reason: 'a portal wrapper with no counterpart in the skills' },
];

/* Build a synthetic portal. `mainStale` decides what is committed on the ref the
 * board reads; `branch` puts the checkout somewhere else afterwards. Every knob
 * is one of the three trees the row is about, and nothing here touches the real
 * portal. */
function portalRepo({ mainStale = false, branch = null, branchStale = false,
                      unlistedOnMain = false, unlistedOnBranch = false,
                      worktreeCurrent = false, noGit = false } = {}) {
  const dir = scratchDir('prove-red-portal-drift-');
  const engine = path.join(dir, 'engine');
  fs.mkdirSync(path.join(engine, 'place'), { recursive: true });

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

  if (noGit) { writeTree({ staleA: mainStale, unlisted: unlistedOnMain }); return dir; }

  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.email', 'harness@example.invalid']);
  git(dir, ['config', 'user.name', 'prove-red-portal-drift']);
  git(dir, ['checkout', '--quiet', '-b', 'main']);
  writeTree({ staleA: mainStale, unlisted: unlistedOnMain });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'the state of origin/main']);

  /* THE REMOTE-TRACKING REF, WRITTEN BY HAND. There is no remote to fetch from
   * and there does not need to be one: `origin/main` is a ref like any other, and
   * status.js reaches it through rev-parse and `git show`, both of which are
   * indifferent to how it got there. */
  git(dir, ['update-ref', 'refs/remotes/origin/main', git(dir, ['rev-parse', 'HEAD'])]);

  if (branch) {
    git(dir, ['checkout', '--quiet', '-b', branch]);
    writeTree({ staleA: branchStale, unlisted: unlistedOnBranch });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '--quiet', '-m', 'the state of the feature branch']);
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

function board(busesDir, portalDir, statusPath = STATUS) {
  let out, code = 0;
  try {
    out = execFileSync(process.execPath,
      [statusPath, '--buses', busesDir, '--portal', portalDir, '--no-quality', '--no-live', '--json'],
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
];

const kept = [];

/* Run one case and say whether it behaved as its `expect` and its `also` claim.
 * The colour alone is never the verdict: a board that never LOOKED at the portal
 * is green too, and the two cases this file exists for differ from their opposite
 * only in which tree was read — a fact no exit code carries. */
function runCase(c, statusPath = STATUS) {
  const portal = portalRepo(c.make);
  const buses = emptyBuses();
  kept.push(portal, buses);
  const { code, json } = board(buses, portal, statusPath);
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
 * have stopped testing the thing they are named for, and this says so. */
function regressedStatus() {
  const root = scratchDir('prove-red-portal-drift-engine-');
  const dst = path.join(root, 'assets');
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(ASSETS, { withFileTypes: true })) {
    if (e.isDirectory()) continue;
    fs.copyFileSync(path.join(ASSETS, e.name), path.join(dst, e.name));
  }
  const f = path.join(dst, 'status.js');
  let src = fs.readFileSync(f, 'utf8');
  const edit = (find, replace, why) => {
    if (!src.includes(find)) throw new Error('prove-red-portal-drift: ' + why + ' — re-point this file at whatever replaced `' + find.trim() + '`.');
    src = src.replace(find, replace);
  };
  edit('  const ref = source && source.ref;',
       '  const ref = null; // MUTATED by prove-red-portal-drift.js: the pre-OA-200 reading',
       'portalDrift() no longer picks its ref from portalSource()');
  /* AND THE SKILL ROOT, WHICH IS NOT DECORATION. status.js derives it from its own
   * location, so a copy running out of the OS temp dir resolves every manifest
   * `source` to a path that does not exist and every row reads MISSING. The first
   * cut of this self-falsification did exactly that and scored both regression
   * cases as "goes red" — red, and for a reason that has nothing to do with which
   * tree was read. A harness that accepts any red is not a harness. */
  edit("  const SKILL_ROOT = path.resolve(SK, '..', '..');",
       '  const SKILL_ROOT = ' + JSON.stringify(SKILL_ROOT) + ';',
       'portalDrift() no longer derives SKILL_ROOT from SK');
  fs.writeFileSync(f, src);
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

const TOTAL = CASES.length + REGRESSION_SUBJECTS.length;
const w = [14, 62, 46];
for (const r of rows) console.log(r[0].padEnd(w[0]) + r[1].padEnd(w[1]) + r[2].padEnd(w[2]) + r[3]);
if (KEEP) for (const k of kept) console.log('kept  ' + k);

if (failed) {
  console.error('\n' + failed + ' of ' + TOTAL + ' cases did not behave as claimed — the vendoring verdict is not what status.js says it is.');
  process.exitCode = 1;
} else {
  console.log('\nall ' + TOTAL + ' cases behaved as claimed: the verdict is about a named ref, it still goes red when that ref is stale, '
    + 'a local re-vendor that has not merged reads PENDING rather than green, the population follows the ref too, a portal with no git says so, '
    + 'and both tree-reading cases go red the moment OA-200 is taken back out.');
}
