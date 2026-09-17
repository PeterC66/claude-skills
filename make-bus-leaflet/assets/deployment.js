/*
 * deployment.js — the status board's Deployment row: is the LIVE site running
 * what the portal's `main` says, and is the answer a fault or a chore?
 *
 * Its own module rather than 230 lines in status.js, which is what
 * tools/line-ratchet.js exists to insist on (the OA-001 rule): the row was
 * written into status.js on 2026-08-25, grew by a grace on 2026-09-14 (OA-355),
 * a fetch on 2026-09-17 (OA-392) and a fault/chore split the same day (OA-396),
 * and the branch carrying the last two put status.js 182 lines over its ceiling.
 * Nothing here is in the engine-hash closure (engine_version.js lists its files
 * by name), so moving it moves no map's stamp.
 *
 * WHY THE ROW EXISTS (technical-audit_2026-08-25 N2). On 2026-08-25 the live
 * site was one commit behind `main`, and the commit it was missing was the one
 * crediting NaPTAN in legal.html -- an attribution correction whose entire
 * value is that the public can see it. Nothing in the estate compared the two.
 * The portal's own /health had carried `gitSha` until the S4 fix gated it
 * (correctly) behind a token on 2026-08-20, and the only other surface was a
 * <meta> injected by a script, so establishing the gap took a headless browser.
 * A security fix had quietly cost an operational control. The portal now sets
 * `X-App-Version: <version>+<short sha>` on every response, from every route,
 * with no authentication and no JavaScript. This reads it.
 *
 * FOUR RULES ABOUT THE VERDICT, because a badly-judged row here is worse than
 * none:
 *
 *   1. A NETWORK FAILURE IS NEVER RED. If the site is unreachable, that is what
 *      the uptime monitor is for (audit O2, live since 2026-08-20). A row that
 *      cannot reach the network must say "I could not tell", not "your
 *      deployment is stale" -- the difference between the two is the whole
 *      lesson of a checker that reports "no answer" as "wrong answer".
 *   2. A MISSING HEADER IS NEVER RED either. It means the live build predates
 *      this change, which is a true and temporary fact, not a fault.
 *   3. THE GRACE DECIDES THE WORD. BEHIND is amber (`behind (grace)`) for
 *      DEPLOY_GRACE_HOURS and `BEHIND` after, and the age is the OLDEST
 *      undeployed commit's, not the tip's (OA-355: dating the tip meant every
 *      unrelated merge reset the clock and the grace could never expire). A
 *      merge is not a deploy and nobody should be gated the minute they press
 *      merge; twelve hours later, "merged and forgotten" is the only remaining
 *      explanation -- and since OA-396 that explanation is a CHORE (below).
 *   4. A LIVE BUILD NEWER THAN MY COPY OF THE REMOTE IS NOT A DEPLOYMENT FAULT
 *      AT ALL, and until 2026-09-17 it was reported as the worst kind (OA-392).
 *      `origin/main` is only as current as whoever last fetched it, so a laptop
 *      one commit stale read `BEHIND ... undateable` about a site that was
 *      running `origin/main` exactly -- and since every `loop/blocked/` file is
 *      a rank-3 row, that verdict reached Peter's worklist carrying a pasteable
 *      deploy command for a site that needed nothing. The row now fetches ONCE,
 *      and only when the live sha resolves to nothing here, then says which of
 *      the two it is. The null-means-red path is untouched for the case it was
 *      written about: a live sha nobody can find even after fetching.
 *
 * WHAT IS RED, AND WHAT IS A CHORE (buses-data OA-396, R3 of the process review
 * of 2026-09-17). Until that day a BEHIND past the grace exited 1, and three of
 * the newest thirty reds on buses-data were exactly that -- a deploy somebody
 * had not got to, mailed as a failure. A dated BEHIND is now printed, carried
 * by the bus-work worklist as its deploy-pending row, and never red. What stays
 * red is an UNDATEABLE row: the live site reports a commit that neither this
 * checkout nor a fetch of origin can find, which is a live site that does not
 * match anything main ever held, or an instrument that could not look -- and
 * neither may be quieter than "fine". deployBad() is the whole rule, and
 * tools/prove-red-deploy-grace.js proves it both ways: a dated backlog exits 0
 * and reads BEHIND, the same fixture against the pre-OA-396 rule exits 1, and
 * the two undateable fixtures still exit 1.
 *
 * The comparison is against `origin/main` in the portal checkout, falling back
 * to HEAD -- so running this on a feature branch still asks the right question
 * ("is the deployment current with main"), not the wrong one ("is the deployment
 * running my branch").
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

const DEFAULT_LIVE_URL = 'https://busmaps.uk';
const DEFAULT_GRACE_HOURS = 12;

/** Run git in `dir` and return trimmed stdout, or null on any failure. */
function gitIn(dir, args) {
  try {
    const r = execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return r.trim();
  } catch { return null; }
}

// ONE fetch, bounded, and only from the branch below that has established it has
// nothing to answer with (OA-392). It updates remote-tracking refs and touches
// no branch, no index and no working tree, so it cannot disturb whatever the
// portal checkout is in the middle of. A repository with no `origin`, no network
// or no credentials returns false in a bounded time rather than hanging the
// board -- and false is reported as COULD NOT FETCH rather than folded into
// "the live sha does not exist", because a refusal read as an absence measures
// the instrument instead of the subject.
function gitFetch(dir) {
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000,
    });
    return true;
  } catch { return false; }
}

// The row's ONE red (OA-396): a BEHIND that cannot be dated. `undateable` is set
// only when the live sha resolves to no commit this checkout holds after the
// fetch OA-392 added, or when nobody could look (`COULD NOT FETCH`, `--no-fetch`)
// -- a live site running something main never held, or an instrument that
// failed, and neither may pass quietly. A dated BEHIND is a deploy somebody has
// not run yet: a chore, printed and carried by the worklist, never red.
// `current`, `live ahead`, `behind (grace)`, `unreachable`, `no-header` and
// `skipped` were never red and still are not.
function deployBad(d) {
  return !!d && d.status === 'BEHIND' && d.undateable === true;
}

/**
 * Compute the row. `portal` is the portal checkout, `liveUrl` the site to ask,
 * `noLive` skips the row entirely, `noFetch` holds off the one fetch (so a
 * harness can prove the fetch is what moves the verdict), and `graceHours` is
 * the amber window. Returns a plain object whose `status` is one of: skipped,
 * unreachable, no-header, current, live ahead, behind (grace), BEHIND.
 */
async function deploymentRow({ portal, liveUrl = DEFAULT_LIVE_URL, noLive = false, noFetch = false, graceHours = DEFAULT_GRACE_HOURS }) {
  if (noLive) return { status: 'skipped', why: '--no-live' };
  if (!portal || !fs.existsSync(portal)) return { status: 'skipped', why: 'no portal checkout to compare against' };

  const ref = gitIn(portal, ['rev-parse', '--verify', '--quiet', 'origin/main']) ? 'origin/main' : 'HEAD';
  const wantFull = gitIn(portal, ['rev-parse', ref]);
  const want = gitIn(portal, ['rev-parse', '--short', ref]);
  if (!want) return { status: 'skipped', why: 'could not read a SHA from ' + portal };

  let live = null;
  try {
    const res = await fetch(liveUrl + '/health', { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    live = res.headers.get('x-app-version');
    // DRAIN THE BODY even though only the header is wanted. An unconsumed
    // response body leaves undici holding the socket, and the board ends by
    // setting an exit code and letting Node exit -- on Windows an open socket at
    // that moment aborts the process outright: "Assertion failed:
    // !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c". Found on the
    // first real run after the deploy of 2026-08-25: every row was correct, the
    // Deployment row said `current`, and the EXIT CODE was 127.
    await res.arrayBuffer().catch(() => {});
  } catch (e) {
    // Rule 1: unreachable is not stale.
    return { status: 'unreachable', want, url: liveUrl, why: String(e.message || e) };
  }
  if (!live) {
    // Rule 2: no header means an older build, which is a fact and not a fault.
    return { status: 'no-header', want, url: liveUrl, why: 'live build predates X-App-Version' };
  }
  const deployed = live.split('+').pop();
  if (deployed === want || (wantFull && wantFull.startsWith(deployed))) {
    return { status: 'current', want, deployed, url: liveUrl, fetch: 'not needed' };
  }

  // Rule 4 (OA-392): BEFORE JUDGING THE DEPLOYMENT, ESTABLISH THAT THIS CHECKOUT
  // CAN SEE WHAT IS DEPLOYED. The cheap test the action first proposed --
  // `log <ref>..<deployed>` non-empty -- cannot see the case that raised it: a
  // stale clone does not HOLD the newer object, so both log directions fail and
  // the branch never fires (`git cat-file -t 7c1297d` answered `fatal: Not a
  // valid object name` on the morning it was found: absent, not merely
  // unreachable). So the resolvable question is asked first, and the fetch runs
  // only when the answer is no -- the common path stays offline.
  let liveRef = ref, liveWant = want, liveWantFull = wantFull;
  let fetchState = 'not needed';
  let resolved = gitIn(portal, ['rev-parse', '--verify', '--quiet', deployed + '^{commit}']);
  if (!resolved) {
    if (noFetch) {
      fetchState = 'not attempted (--no-fetch)';
    } else {
      const ok = gitFetch(portal);
      fetchState = ok ? 'fetched' : 'COULD NOT FETCH';
      if (ok) {
        liveRef = gitIn(portal, ['rev-parse', '--verify', '--quiet', 'origin/main']) ? 'origin/main' : 'HEAD';
        liveWantFull = gitIn(portal, ['rev-parse', liveRef]) || wantFull;
        liveWant = gitIn(portal, ['rev-parse', '--short', liveRef]) || want;
        resolved = gitIn(portal, ['rev-parse', '--verify', '--quiet', deployed + '^{commit}']);
      }
    }
  }

  // The clone was the stale one: the live site is running exactly what the
  // remote's `main` says. This is a PASS and it prescribes nothing, because
  // there is nothing to do. `wasStale` records that the answer needed a fetch,
  // so a reader can tell it from a row that was current all along.
  if (deployed === liveWant || (liveWantFull && liveWantFull.startsWith(deployed))) {
    return { status: 'current', want: liveWant, deployed, url: liveUrl, fetch: fetchState, wasStale: fetchState === 'fetched' };
  }

  // The live site is running something this clone's `main` does not contain, in
  // the forward direction -- deployed from a branch, or from a commit merged
  // after the ref this board is comparing against. A PASS with a prescription
  // that is a fetch and never a deploy: `main` has nothing the public cannot
  // see, so the one rule this row exists to enforce is not broken.
  if (resolved) {
    const behindLive = gitIn(portal, ['log', '--format=%h', liveWant + '..' + deployed]);
    const aheadOfLive = gitIn(portal, ['log', '--format=%h', deployed + '..' + liveWant]);
    if (behindLive && !aheadOfLive) {
      return {
        status: 'live ahead', want: liveWant, deployed, url: liveUrl, fetch: fetchState,
        why: 'the live build contains commits this checkout\'s ' + liveRef + ' does not; that is a fact about this clone, not about the deployment',
      };
    }
  }

  // Rule 3: how long has the undeployed work been sitting there? THE POPULATION
  // IS THE WHOLE BACKLOG, NOT THE TIP (OA-355, falsified by
  // prove-red-deploy-grace.js). A range that yields nothing -- an unresolvable
  // live sha -- is "I could not tell" and takes the null-means-red path, because
  // a backlog nobody can date is what a grace must not excuse.
  const backlog = gitIn(portal, ['log', '--format=%ct', deployed + '..' + liveRef]);
  const oldest = backlog == null ? null : backlog.split('\n').map(s => s.trim()).filter(Boolean).pop();
  const ts = Number(oldest);
  const ageH = oldest && Number.isFinite(ts) ? Math.floor((Date.now() / 1000 - ts) / 3600) : null;
  const overGrace = ageH == null ? true : ageH >= graceHours;
  return {
    status: overGrace ? 'BEHIND' : 'behind (grace)',
    want: liveWant, deployed, url: liveUrl, ageHours: ageH, graceHours,
    undateable: ageH == null,
    // Three answers, never two: the live sha was found, or it was looked for and
    // is genuinely not there, or nobody could look. An undateable row that says
    // COULD NOT FETCH is naming the instrument rather than the deployment, and a
    // reader can act on the difference.
    fetch: fetchState, resolved: !!resolved,
  };
}

/** Print the section the way the board always has. `log` is console.log unless a caller wants the lines. */
function printDeployment(deploy, liveUrl = DEFAULT_LIVE_URL, log = console.log) {
  log('\n=== Deployment (' + (deploy.url || liveUrl) + ') ===');
  if (deploy.status === 'current') {
    log('  current   live ' + deploy.deployed + ' == main ' + deploy.want
      + (deploy.wasStale ? '  (this clone was the stale one — origin/main was fetched to find that out)' : ''));
  } else if (deploy.status === 'live ahead') {
    // OA-392. Not a verdict about the deployment, so it prescribes a fetch and
    // never a deploy: the old text sent a reader to `npm run deploy` for a site
    // that was already current, and that instruction reached Peter's worklist.
    log('  live ahead   live ' + deploy.deployed + ' contains commits this checkout\'s main ' + deploy.want + ' does not');
    log('    Nothing is undeployed. This clone is behind the remote. From anywhere, with no placeholders:');
    log('      git -C "C:\\Claude\\community-bus-maps" fetch origin');
  } else if (deploy.status === 'skipped') {
    log('  skipped   ' + deploy.why);
  } else if (deploy.status === 'unreachable') {
    log('  unreachable  ' + deploy.why + '  (not a verdict about the deployment -- the uptime monitor owns that)');
  } else if (deploy.status === 'no-header') {
    log('  no header    the live build predates X-App-Version; deploy once and this row starts working');
  } else {
    log('  ' + deploy.status + '   live ' + deploy.deployed + ' != main ' + deploy.want
      + (deploy.ageHours == null ? '  (RED: undateable — the live sha is not in this checkout, so it is NOT being excused'
         + (deploy.fetch === 'fetched' ? '; origin was fetched and it is still not there)'
            : deploy.fetch === 'COULD NOT FETCH' ? '; the fetch that would have settled it FAILED, so this names the instrument as much as the deployment)'
            : deploy.fetch === 'not attempted (--no-fetch)' ? '; --no-fetch, so nobody looked)' : ')')
         : '  (oldest undeployed commit ' + deploy.ageHours + 'h old, grace ' + deploy.graceHours + 'h'
           + (deploy.status === 'BEHIND' ? ' — a chore, not a fault: information here and a deploy-pending row on the worklist, never red)' : ')')));
    log('    main has commits the public cannot see. From C:\\Claude\\community-bus-maps, with no placeholders:');
    log('      npm run deploy');
  }
}

module.exports = { deploymentRow, deployBad, printDeployment, gitIn, gitFetch, DEFAULT_LIVE_URL, DEFAULT_GRACE_HOURS };
