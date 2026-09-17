#!/usr/bin/env node
/*
 * prove-red-deploy-grace.js — prove that the status board's DEPLOY GRACE can
 * actually expire, which until 2026-09-14 it could not.
 *
 * WHY THIS FILE EXISTS (buses-data OA-355). `deploymentRow()` dated the drift
 * with `git log -1 --format=%ct <main>` — the age of main's NEWEST commit —
 * under a comment that asked "how long has the undeployed commit been sitting
 * there?". Those are different questions on any repository that anything else
 * merges into: every unrelated merge reset the clock to zero, so the amber
 * `behind (grace)` could never age into the red `BEHIND`, and `status.js` kept
 * exiting 0 however long a deploy was outstanding. It was found by arithmetic
 * on a real morning rather than by a test — at 06:00Z on 2026-09-14 the oldest
 * undeployed portal commit (`ca87e7f`) was 16h old and over the 12h grace while
 * the board read 0h and exited 0. Three portal changes then went live
 * undescribed, one of them an engine re-vendor.
 *
 * THE POINT THAT MAKES THIS A HARNESS AND NOT A TEST. `BEHIND` feeds the board's
 * exit code (status.js has it in `bad` twice), so it is a gate — and this
 * project's standing rule is that a green check nobody has watched go red proves
 * nothing. The grace had never been watched expire ANYWHERE, because expiry
 * needs a clock and a backlog and the unit suite has neither. Case 3 is the one
 * that matters: it builds a backlog whose oldest commit is old and whose tip is
 * seconds old, which is the exact shape the old code could not see.
 *
 * AND CASE 4 IS WHY THE FIXTURE IS TRUSTWORTHY. A fixture that reddens the new
 * code proves nothing on its own — it might redden anything. Case 4 runs the
 * SAME fixture against a copy of status.js with the old `log -1` line put back,
 * and requires it to read `behind (grace)`. That is the mutation arm: it shows
 * the fixture discriminates between the two implementations rather than merely
 * agreeing with the one that is installed.
 *
 * NOTHING REAL IS TOUCHED. Every case builds its own throwaway git repository in
 * the OS temp dir and serves a fake `X-App-Version` from 127.0.0.1, so no case
 * reads the Buses repo, the portal checkout or busmaps.uk. The board is pointed
 * at an empty Buses tree on purpose: a tree with nothing to gate must read as
 * such, and this harness is asking about one row.
 *
 * Run it from make-bus-leaflet (no placeholders):
 *     npm run test:prove-red-deploy-grace
 *     node tools/prove-red-deploy-grace.js --keep   leave the scratch trees on disk
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const STATUS = path.join(__dirname, '..', 'assets', 'status.js');
const KEEP = process.argv.includes('--keep');
const HOUR = 3600 * 1000;

function git(dir, args, env) {
  return execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, env || {}),
  }).trim();
}

/* A throwaway portal repository whose commits carry the ages this case needs.
 * `hoursAgo` is per commit and both date variables are set, because git takes
 * the COMMITTER date for `%ct` and the author date is the one everybody
 * remembers to set. Returns the short sha of each commit in order. */
function scratchPortal(hoursAgo) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa355-portal-'));
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'harness@example.invalid']);
  git(root, ['config', 'user.name', 'OA-355 harness']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  /* A manifest declaring that this repository vendors NOTHING, which is true of
   * a throwaway one. Without it the board's portal-drift row reads NO-MANIFEST
   * and reddens the exit code on its own, and every assertion this harness makes
   * about the EXIT CODE would then be about that row instead of the deployment
   * row — green for a reason that has nothing to do with the subject. It is
   * committed rather than merely written, because the drift check reads the
   * manifest out of the git ref and not off the disk. */
  fs.mkdirSync(path.join(root, 'engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'engine', 'vendored.json'), JSON.stringify({ files: [] }, null, 2) + '\n');
  git(root, ['add', '--', 'engine/vendored.json']);

  const shas = [];
  hoursAgo.forEach((h, i) => {
    fs.writeFileSync(path.join(root, 'file' + i + '.txt'), 'commit ' + i + '\n');
    git(root, ['add', '--', 'file' + i + '.txt']);
    const when = new Date(Date.now() - h * HOUR).toISOString();
    git(root, ['commit', '--quiet', '-m', 'commit ' + i], {
      GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when,
    });
    shas.push(git(root, ['rev-parse', '--short', 'HEAD']));
  });
  return { root, shas };
}

/* A fake live site. Serves only the header the board reads, and drains nothing
 * else — the board issues a HEAD-shaped GET and consumes the body. */
function fakeLive(version) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('X-App-Version', version);
      res.setHeader('Content-Type', 'text/plain');
      res.end('ok');
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port });
    });
  });
}

/* An empty Buses tree. The board tolerates a tree with nothing to gate, which is
 * the property every harness fixture in this repository leans on. */
function emptyBuses() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa355-buses-'));
  fs.mkdirSync(path.join(root, 'Areas'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Places'), { recursive: true });
  return root;
}

/* OA-392's fixture: a checkout whose `origin/main` is STALE, which is the shape
 * the old row could not tell from a stale deployment. An upstream repository is
 * built and cloned, and only THEN does upstream gain the newer commit — so the
 * clone holds neither the object nor the ref, exactly as `C:\Claude\
 * community-bus-maps` did on the morning of 2026-09-17 when `git cat-file -t
 * 7c1297d` answered `fatal: Not a valid object name`. Reproducing the ABSENCE
 * rather than merely the inequality is the whole point: the cheaper fix the
 * action first proposed — comparing the two `git log` directions — cannot see
 * this fixture at all, because both directions fail on an object that is not
 * there. `ahead` puts the newer commit on a branch instead of on main, which is
 * the other state one fetch can reach.
 *
 * Returns the CLONE as the portal directory, plus the sha the fake live site
 * should claim. Both repositories are handed back so the caller can clean up. */
function scratchStaleClone(mode) {
  const { root: up, shas } = scratchPortal([50, 40]);
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'oa392-clone-'));
  fs.rmSync(clone, { recursive: true, force: true });
  git(path.dirname(clone), ['clone', '--quiet', up, clone]);
  /* Everything below happens AFTER the clone, so the clone cannot know about it
   * without fetching. */
  if (mode === 'ahead') git(up, ['checkout', '--quiet', '-b', 'deploy']);
  fs.writeFileSync(path.join(up, 'newer.txt'), 'the commit the clone has never heard of\n');
  git(up, ['add', '--', 'newer.txt']);
  const when = new Date(Date.now() - 1 * HOUR).toISOString();
  git(up, ['commit', '--quiet', '-m', 'the commit the clone has never heard of'],
      { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  const liveSha = git(up, ['rev-parse', '--short', 'HEAD']);
  return { portal: clone, upstream: up, liveSha, cloneTip: shas[shas.length - 1] };
}

/* status.js with the pre-OA-355 line put back, for the mutation arm. Copies the
 * whole assets folder rather than editing in place, the way prove-red-status.js
 * builds its injected-exception copy. */
function statusWithOldRule() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oa355-oldrule-'));
  const assets = path.join(root, 'assets');
  fs.cpSync(path.join(__dirname, '..', 'assets'), assets, { recursive: true });
  const p = path.join(assets, 'status.js');
  let s = fs.readFileSync(p, 'utf8');
  /* The ref this reads is `liveRef` rather than `ref` since OA-392, which may
   * have been refreshed by that action's one fetch. The marker is matched
   * VERBATIM and the throw below is the anchor check: if the subject moves
   * again, this arm says so instead of silently testing nothing. */
  const marker = "  const backlog = gitIn(PORTAL, ['log', '--format=%ct', deployed + '..' + liveRef]);";
  if (!s.includes(marker)) {
    throw new Error('the current status.js does not carry the OA-355 backlog line; this harness is out of date with its subject');
  }
  const oldLine = "  const backlog = null; const oldest = String(Number(gitIn(PORTAL, ['log', '-1', '--format=%ct', liveRef])));";
  s = s.replace(marker, oldLine);
  /* The replacement above redeclares `oldest` on the next line in the real file,
   * so that line is removed rather than left to throw a SyntaxError — a mutant
   * that cannot parse would "catch" every case for the wrong reason. */
  s = s.replace("  const oldest = backlog == null ? null : backlog.split('\\n').map(s => s.trim()).filter(Boolean).pop();\n", '');
  fs.writeFileSync(p, s, 'utf8');
  return { root, status: p };
}

/* SPAWNED, NOT execFileSync, AND THAT IS THE WHOLE REASON THIS WORKS. The fake
 * live site is served from THIS process, so a synchronous child blocks the event
 * loop that would have to answer it: the board's fetch then times out and every
 * case scores `unreachable`, which is Rule 1 doing its job and reporting "I could
 * not tell". The first cut of this harness did exactly that and read 5 of 5
 * FAILED — a harness that cannot reach its own fixture, wearing the face of a
 * subject that is broken. Async spawn keeps the loop free to serve. */
function board(statusPath, busesDir, portalDir, liveUrl, graceHours, extra) {
  const flags = [statusPath, '--buses', busesDir, '--portal', portalDir,
                 '--live', liveUrl, '--deploy-grace-hours', String(graceHours),
                 '--no-quality', '--no-commitments', '--json'].concat(extra || []);
  return new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, flags, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    ch.on('error', reject);
    ch.on('close', (code) => {
      let json = null;
      try { json = JSON.parse(out); } catch { json = null; }
      resolve({ code, json, out, err });
    });
  });
}

/* Each case says which commit the live site claims to be running, the ages of
 * the commits on main, and what the deployment row must then say. `wantRed` is
 * about the BOARD's exit code, because that is the half CI reads. */
/* THE FIXTURE SHAPE THAT MATTERS, and the one this harness got wrong first time.
 * A backlog needs a DEPLOYED commit older than the oldest UNDEPLOYED one, so
 * every case below commits a deployed base first and points the fake live site
 * at it. The first cut used `ages: [40, 0]` with the 40h commit deployed, which
 * left a backlog of exactly one commit that really was 0h old — so `behind
 * (grace)` was the correct answer and the arm failed for being wrong rather than
 * for finding anything. An arm that cannot state its own fixture is worth less
 * than no arm at all. */
const CASES = [
  {
    label: 'control: live is main, nothing is undeployed',
    ages: [50, 40, 0], live: 'tip', grace: 12,
    wantStatus: 'current', wantRed: false,
    what: 'a current deployment is never amber or red',
  },
  {
    label: 'control: the whole backlog is younger than the grace',
    ages: [50, 2, 1], live: 0, grace: 12,
    wantStatus: 'behind (grace)', wantRed: false,
    what: 'a fresh merge is excused, which is what the grace is for',
  },
  {
    label: 'THE ARM: an old backlog behind a tip committed seconds ago',
    ages: [50, 40, 0], live: 0, grace: 12,
    wantStatus: 'BEHIND', wantRed: true, wantMinAge: 12,
    what: 'the case the pre-OA-355 rule read as 0h and exited 0 on',
  },
  {
    label: 'mutation: the same fixture against the pre-OA-355 rule',
    ages: [50, 40, 0], live: 0, grace: 12, useOldRule: true,
    wantStatus: 'behind (grace)', wantRed: false,
    what: 'proves the fixture discriminates rather than reddening anything',
  },
  {
    label: 'a live sha this checkout cannot resolve is not 0h',
    ages: [50, 40, 0], live: 'ffffffe', grace: 12,
    wantStatus: 'BEHIND', wantRed: true, wantUndateable: true, wantFetch: 'COULD NOT FETCH',
    what: 'could-not-tell must fail safe, and a failed fetch is named rather than hidden',
  },
  /* OA-392's three, and the second is the mutation arm for the first: the same
   * fixture, the same code, one flag. If `--no-fetch` did not redden it, the
   * fixture would be proving nothing about the fetch. */
  {
    label: 'OA-392 THE ARM: live is the remote main, and MY origin/main is stale',
    fixture: 'stale', grace: 12,
    wantStatus: 'current', wantRed: false, wantWasStale: true, wantFetch: 'fetched',
    what: 'the 2026-09-17 false BEHIND that became a rank-3 row asking for a deploy',
  },
  {
    label: 'OA-392 mutation: the same fixture with --no-fetch',
    fixture: 'stale', grace: 12, extra: ['--no-fetch'],
    wantStatus: 'BEHIND', wantRed: true, wantUndateable: true, wantFetch: 'not attempted (--no-fetch)',
    what: 'the old behaviour exactly — so the fetch is what moved the verdict, not the fixture',
  },
  {
    label: 'OA-392 control: live is genuinely ahead of the remote main',
    fixture: 'ahead', grace: 12,
    wantStatus: 'live ahead', wantRed: false, wantFetch: 'fetched',
    what: 'main has nothing the public cannot see, so it passes and prescribes a fetch',
  },
];

(async function main() {
  const rows = [];
  let failed = 0;
  const kept = [];

  for (const c of CASES) {
    /* Two fixture families now: the OA-355 ones, which are a single repository
     * whose commits carry chosen ages, and the OA-392 ones, which are a clone
     * whose `origin/main` is deliberately behind its upstream. */
    let portal, upstream = null, liveSha;
    if (c.fixture) {
      const f = scratchStaleClone(c.fixture);
      portal = f.portal; upstream = f.upstream; liveSha = f.liveSha;
    } else {
      const s = scratchPortal(c.ages);
      portal = s.root;
      /* `live: null` means "the commit before the backlog starts" — i.e. nothing
       * on main is deployed. 'tip' means the deployment is current. A string is
       * used verbatim, which is how the unresolvable-sha case is built. */
      liveSha = c.live === 'tip' ? s.shas[s.shas.length - 1]
        : typeof c.live === 'number' ? s.shas[c.live]
        : typeof c.live === 'string' ? c.live
        : s.shas[0];
    }
    const buses = emptyBuses();
    const { srv, url } = await fakeLive('0.0.0-harness+' + liveSha);
    const inj = c.useOldRule ? statusWithOldRule() : null;
    const r = await board(inj ? inj.status : STATUS, buses, portal, url, c.grace, c.extra);
    srv.close();

    const dep = r.json && r.json.deployment;
    const got = dep ? dep.status : '(no deployment row)';
    const statusOk = got === c.wantStatus;
    const redOk = c.wantRed ? r.code !== 0 : r.code === 0;
    const ageOk = c.wantMinAge == null ? true : (dep && dep.ageHours != null && dep.ageHours >= c.wantMinAge);
    const undateOk = c.wantUndateable == null ? true : (dep && dep.undateable === true);
    /* OA-392's two extra assertions. `fetch` is checked by VALUE rather than by
     * truthiness because its three answers — not needed, fetched, COULD NOT
     * FETCH — are the point: a refusal read as an absence measures the
     * instrument instead of the subject. */
    const fetchOk = c.wantFetch == null ? true : (dep && dep.fetch === c.wantFetch);
    const staleOk = c.wantWasStale == null ? true : (dep && dep.wasStale === true);
    const ok = statusOk && redOk && ageOk && undateOk && fetchOk && staleOk;
    if (!ok) failed++;

    const why = !statusOk ? 'said ' + got + ', wanted ' + c.wantStatus
      : !redOk ? 'exit ' + r.code + ', wanted ' + (c.wantRed ? 'non-zero' : '0')
      : !ageOk ? 'age ' + (dep && dep.ageHours) + 'h, wanted at least ' + c.wantMinAge + 'h'
      : !undateOk ? 'undateable was ' + (dep && dep.undateable) + ', wanted true'
      : !fetchOk ? 'fetch was ' + (dep && dep.fetch) + ', wanted ' + c.wantFetch
      : !staleOk ? 'wasStale was ' + (dep && dep.wasStale) + ', wanted true'
      : 'exit ' + r.code + ', ' + got + (dep && dep.ageHours != null ? ', ' + dep.ageHours + 'h' : '')
        + (dep && dep.fetch && dep.fetch !== 'not needed' ? ', ' + dep.fetch : '');
    rows.push([ok ? 'ok' : 'FAILED', c.label, why, c.what]);

    if (KEEP) { kept.push(portal); kept.push(buses); if (upstream) kept.push(upstream); if (inj) kept.push(inj.root); }
    else {
      fs.rmSync(portal, { recursive: true, force: true });
      fs.rmSync(buses, { recursive: true, force: true });
      if (upstream) fs.rmSync(upstream, { recursive: true, force: true });
      if (inj) fs.rmSync(inj.root, { recursive: true, force: true });
    }
  }

  const w = [9, 62, 46];
  for (const r of rows) console.log(r[0].padEnd(w[0]) + r[1].padEnd(w[1]) + r[2].padEnd(w[2]) + r[3]);
  if (KEEP) for (const k of kept) console.log('kept  ' + k);

  if (failed) {
    console.error('\n' + failed + ' of ' + CASES.length + ' cases did not behave as claimed - the deploy grace is not what status.js says it is.');
    process.exitCode = 1;
  } else {
    console.log('\nall ' + CASES.length + ' cases behaved as claimed: the deploy grace expires on the age of the OLDEST undeployed commit, a fresh tip no longer hides an old backlog, an unresolvable live sha fails safe, the same fixture still reads amber against the rule this replaced, and a stale origin/main no longer reads as a stale deployment - with --no-fetch reproducing the old verdict on the same fixture.');
  }
})();
