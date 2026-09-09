#!/usr/bin/env node
/*
 * prove-s6-checks.js — break the S6 verification engine's INPUTS on purpose, and
 * check that each check still says what it is supposed to say.
 *
 * WHY THIS FILE EXISTS. It is the third falsification harness in this skill, and
 * it covers what neither sibling can reach. `prove-red.js` mutates the small
 * requireable modules and checks `node --test` objects. `prove-red-gates.js`
 * mutates the five generators and checks the BYTE gate objects. Neither touches
 * `verify_report.js`, which is a top-to-bottom script like the generators — it
 * reads a run directory and exits — so no unit test can require it either.
 *
 * On 2026-08-27, four of its checks were rewritten because they were producing
 * findings that looked like defects and were not (OA-129 Phase 2). A check that
 * has been made quieter is exactly the check most in need of proof that it can
 * still go loud: the failure mode of "fix the noisy check" is a check that no
 * longer says anything at all, and it looks identical to success. So every case
 * below comes in a PAIR — the artefact must be quiet, AND a genuine fault of the
 * same kind must still be found.
 *
 * HOW. Each case copies a real S6 run's inputs into a temp directory, optionally
 * mutates one input, runs verify_report.js there, and asserts on the resulting
 * verification.json. Nothing under the Buses repo is written: the run folders
 * hold outputs that only exist on this laptop, and overwriting one leaves a dated
 * folder no longer describing the run that made it.
 *
 * Run it from make-bus-leaflet (no placeholders):
 *     npm run test:prove-s6
 *     node tools/prove-s6-checks.js --keep     leave the temp dirs on disk
 *     node tools/prove-s6-checks.js --buses "<path to the Buses repo>"
 * `--buses` defaults to C:\u3a St Ives\Using AI\Buses and is only needed if the
 * data repo is checked out somewhere else.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');
const { resolveBuses } = require('../assets/cli');

const SK = path.join(__dirname, '..');
const VERIFY = path.join(SK, 'assets', 'verify_report.js');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
/* --keep means the scratch is EVIDENCE: switch off scratch.js's exit sweep, or
 * the paths printed below would name directories that no longer exist. */
if (KEEP) require('../assets/scratch').keepScratch();
const bi = argv.indexOf('--buses');
const BUSES = resolveBuses({ buses: (bi >= 0 && argv[bi + 1]) ? argv[bi + 1] : undefined });

// The runs these cases are built from. Each is a real stored S6 run, chosen
// because it is the recorded instance of the thing being proved.
const RUNS = {
  //  uncurated S1; routes 32 / X31 have exactly ONE buffer stop; 301/303/305 have two
  ramsey: 'Areas/Ramsey/S6-verify/2026-08-26_0700',
  //  two route 46s (Stagecoach, Lynx); `excel` has a chain truncated to local stops
  wisbech: 'Areas/Wisbech/S6-verify/2026-08-26_0700',
  //  red team excluded "5A (Peterborough)" run by a DIFFERENT operator than our 5A
  stives: 'Areas/St Ives/S6-verify/2026-08-10_1138',
  //  the red team says route 69 does NOT serve the town and is wrong about it --
  //  the fixture for `redteamRejected[]`
  stneots: 'Areas/St Neots/S6-verify/2026-08-28_1347',
  //  a PLACE: no intown_cfg.json, so no in-town prefix and no buffer stops at all
  place: 'Areas/St Neots/Places/St Neots Town Centre/S6-verify/2026-08-21_1912',
};

const TMP = scratchDir('prove-s6-');
let failures = 0, run = 0;

/*
 * Build a run directory the way a real S6 does: `stage.js pull S1 S2 S3` into it,
 * plus the red team's answer.
 *
 * It would be shorter to copy the stored S6 run folder wholesale, and that is what
 * this did first — but S4/S5/S6 run folders are GITIGNORED, so a CI clone has none
 * of them and a harness written that way runs only on the one laptop that already
 * has the data. `git ls-files` over a stored S6 run returns README.md,
 * verification.docx and (since 2026-08-27) redteam.json, and nothing else. S1, S2
 * and S3 are tracked in full, so seeding from them makes this runnable anywhere,
 * and redteam.json — the one irreplaceable file — now comes with the clone.
 *
 * Seeding from each stage's `latest` rather than from the S6 run's pulled copies
 * means the inputs can move under the fixtures. That is deliberate and guarded:
 * every case that depends on a property of the data asserts it and throws
 * "fixture assumption broken" rather than quietly passing over data that no
 * longer exhibits the thing being proved.
 */
/* Tell the staged red team that a route the sheet DOES draw does not serve the
 * town, so the serves-town HARD this section needs exists by construction. Fails
 * loudly if the route stops being drawn, rather than quietly proving nothing --
 * which is the whole failure this helper was written to end. */
function injectServesTownFalse(dir, route = 'T7') {
  const routes = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
  const drawn = new Set([...(routes.routeOrder || []), ...Object.keys(routes.palette || {})]);
  if (!drawn.has(route)) throw new Error(`prove-s6-checks: fixture route ${route} is no longer drawn by the Wisbech config — pick another drawn route, do not delete the case`);
  const rt = JSON.parse(fs.readFileSync(path.join(dir, 'redteam.json'), 'utf8'));
  rt.excluded = (rt.excluded || []).filter((e) => String(e.route) !== route);
  rt.excluded.push({ route, operator: 'Stagecoach East Midlands', servesTown: false,
    reason: 'INJECTED BY prove-s6-checks.js — not a real claim about this route. The case needs a serves-town HARD to exist by construction rather than by borrowing whatever the estate happens to be wrong about today.' });
  rt.services = (rt.services || []).filter((sv) => String(sv.route) !== route);
  fs.writeFileSync(path.join(dir, 'redteam.json'), JSON.stringify(rt, null, 1));
}

/* The same move for the other direction: tell the staged red team about a service
 * the sheet does not draw and the town has not ruled off, so a `missing-service`
 * lead exists BY CONSTRUCTION. Three sections need one — 5, 12 and 14 — and until
 * 2026-09-09 all three borrowed Wisbech's real lead, route 68, which was the only
 * one that town had. SF-012 then decided 68 (FACT's Tesco Bus is real, and open to
 * all) and wrote it into notOnLeaflet[], which correctly turned the lead into a
 * `known-off` and left the three sections with nothing to test: 12 of 101 checks
 * went red on a checker that was behaving exactly as designed. A fixture whose
 * subject is whatever the estate happens to be wrong about today is one that
 * curation retires. Fails loudly if the synthetic route ever becomes real. */
function injectMissingService(dir, route = '987') {
  const routes = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
  const drawn = new Set([...(routes.routeOrder || []), ...Object.keys(routes.palette || {})]);
  if (drawn.has(route)) throw new Error(`prove-s6-checks: fixture route ${route} is now DRAWN by the Wisbech config — it was chosen because nothing carries it, so pick another absent route, do not delete the case`);
  const vs = JSON.parse(fs.readFileSync(path.join(dir, 'verified-services.json'), 'utf8'));
  for (const field of ['notOnLeaflet', 'verifiedNotDisplayed', 'notDisplayed', 'excluded']) {
    if ((vs[field] || []).some((e) => String(e.route) === route)) throw new Error(`prove-s6-checks: fixture route ${route} is now declared in Wisbech's ${field}[] — it was chosen because no convention names it, so pick another absent route, do not delete the case`);
  }
  const rt = JSON.parse(fs.readFileSync(path.join(dir, 'redteam.json'), 'utf8'));
  rt.excluded = (rt.excluded || []).filter((e) => String(e.route) !== route);
  rt.services = (rt.services || []).filter((sv) => String(sv.route) !== route);
  rt.services.push({ route, operator: 'Stagecoach East', termini: ['Wisbech Horsefair Bus Station', 'Nowhere In Particular'],
    days: 'Mon-Fri', servesTown: true, confidence: 'high', sources: ['operator-site'],
    notes: 'INJECTED BY prove-s6-checks.js — not a real claim about any route. The case needs a missing-service lead to exist by construction rather than by borrowing whatever the estate happens to be wrong about today.' });
  fs.writeFileSync(path.join(dir, 'redteam.json'), JSON.stringify(rt, null, 1));
  return route;
}

function stage(runKey, name) {
  const buildDir = path.join(BUSES, path.dirname(path.dirname(RUNS[runKey])));
  const s6 = path.join(BUSES, RUNS[runKey]);
  const manifest = path.join(buildDir, 'manifest.json');
  if (!fs.existsSync(manifest)) throw new Error('missing manifest: ' + manifest);
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const dst = path.join(TMP, name);
  fs.mkdirSync(dst, { recursive: true });
  for (const st of ['S1', 'S2', 'S3']) {
    const rec = m.stages && m.stages[st];
    if (!rec || !rec.latest) throw new Error(`${runKey}: manifest has no ${st} latest`);
    const from = path.join(buildDir, (rec.runs.find(r => r.id === rec.latest) || {}).dir
      || path.join(`${st}-${rec.name}`, rec.latest));
    if (!fs.existsSync(from)) throw new Error(`${runKey}: ${st} run folder absent: ${from}`);
    for (const f of fs.readdirSync(from)) {
      if (f.endsWith('.json')) fs.copyFileSync(path.join(from, f), path.join(dst, f));
    }
  }
  const rt = path.join(s6, 'redteam.json');
  if (!fs.existsSync(rt)) throw new Error(`${runKey}: redteam.json absent at ${rt} — it is tracked, so a clone should have it`);
  fs.copyFileSync(rt, path.join(dst, 'redteam.json'));
  fs.rmSync(path.join(dst, 'verification.json'), { force: true });

  // A PLACE's S1 writes gtfs-services.json, not the town-shaped
  // verified-services.json the engine hard-requires, so the documented place-S6
  // procedure runs this adapter first (references/s6-verify.md, "Running S6 on a
  // PLACE"). It lives in the sibling skill in this same repository, so CI has it.
  if (!fs.existsSync(path.join(dst, 'verified-services.json'))) {
    const adapter = path.join(SK, '..', 'make-place-bus-leaflet', 'assets', 'place_verified_services.js');
    if (!fs.existsSync(adapter)) throw new Error(`${runKey}: no verified-services.json and no place adapter at ${adapter}`);
    const r = spawnSync(process.execPath, [adapter], { cwd: dst, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${runKey}: place adapter failed:\n${r.stdout}${r.stderr}`);
  }
  return dst;
}
const readJ  = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
const writeJ = (d, f, o) => fs.writeFileSync(path.join(d, f), JSON.stringify(o, null, 2));

// The precondition gate reads ../../DRAFT-REVIEW.md, so a temp dir two levels
// deep with no such file is an already-curated town as far as it is concerned.
function verify(dir, env) {
  const r = spawnSync(process.execPath, [VERIFY], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, ...(env || {}) },
  });
  const vj = path.join(dir, 'verification.json');
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''),
           v: fs.existsSync(vj) ? JSON.parse(fs.readFileSync(vj, 'utf8')) : null };
}
const has = (v, sev, cat, route) => !!(v && v.findings.some(f =>
  f.severity === sev && f.category === cat && (route === undefined || f.route === route)));

function check(label, expectation, ok, detail) {
  run++;
  if (ok) { console.log(`  PASS  ${label}\n        ${expectation}`); return; }
  failures++;
  console.log(`  FAIL  ${label}\n        expected: ${expectation}\n        got:      ${detail}`);
}

console.log('prove-s6-checks — every fixed check, proved quiet on the artefact AND loud on a real fault');
console.log('='.repeat(78));

/* ------------------------------------------------------------------ 1. precondition gate */
console.log('\n1. Precondition gate — an uncurated S1 is refused, a curated one is not');
{
  const d = stage('ramsey', 'precond-refuse');
  // Put the run two levels below a folder holding DRAFT-REVIEW.md, as a real town is.
  const town = path.join(TMP, 'precond-town', 'S6-verify', 'r');
  fs.mkdirSync(town, { recursive: true });
  for (const f of fs.readdirSync(d)) fs.copyFileSync(path.join(d, f), path.join(town, f));
  fs.writeFileSync(path.join(TMP, 'precond-town', 'DRAFT-REVIEW.md'), 'unactioned\n');
  /* Inject the OTHER tell too. This case wrote the DRAFT-REVIEW.md itself and took
   * `_bootstrap` from Ramsey's real routes.json, which worked only while Ramsey
   * happened to be an unreviewed auto-draft. It stopped being one on 2026-08-28 --
   * curated S1, draft flag removed, DRAFT-REVIEW.md retired -- and this check then
   * went red about a map that had been FIXED. A harness must BUILD the fault it
   * asserts; borrowing it from live data makes the proof expire the day somebody
   * does the work it was waiting for. */
  const prj = readJ(town, 'routes.json');
  prj._bootstrap = 'injected by prove-s6-checks.js -- an unreviewed draft';
  writeJ(town, 'routes.json', prj);
  const a = verify(town);
  check('refuses an uncurated S1', 'exit 3, no verification.json written',
    a.code === 3 && a.v === null, `exit ${a.code}, verification.json ${a.v ? 'written' : 'absent'}`);
  check('names both tells', 'says _bootstrap AND DRAFT-REVIEW.md',
    /_bootstrap/.test(a.out) && /DRAFT-REVIEW\.md/.test(a.out), a.out.slice(0, 120));

  // Same inputs, curated: no _bootstrap, no DRAFT-REVIEW.md. It must run.
  const c = stage('ramsey', 'precond-allow');
  const rj = readJ(c, 'routes.json'); delete rj._bootstrap; writeJ(c, 'routes.json', rj);
  const b = verify(c);
  check('does NOT refuse a curated S1', 'exit is not 3 and a report is written',
    b.code !== 3 && b.v !== null, `exit ${b.code}, verification.json ${b.v ? 'written' : 'absent'}`);
}

/* ------------------------------------------------------------------ 2. uncurated downgrade */
console.log('\n2. Uncurated override — terminus findings are downgraded, and the verdict says so');
{
  const d = stage('ramsey', 'uncurated');
  // Uncurated by construction, for the same reason as case 1: Ramsey is curated now.
  const urj = readJ(d, 'routes.json');
  urj._bootstrap = 'injected by prove-s6-checks.js -- an unreviewed draft';
  writeJ(d, 'routes.json', urj);
  const a = verify(d, { VERIFY_ALLOW_UNCURATED: '1' });
  check('no terminus HARD survives the override', '0 hard terminus findings',
    a.v && !has(a.v, 'hard', 'terminus'), `${a.v ? a.v.findings.filter(f => f.severity === 'hard' && f.category === 'terminus').length : '?'} hard terminus`);
  check('the terminus findings are still reported', 'at least one soft terminus finding',
    has(a.v, 'soft', 'terminus'), 'none');
  check('the verdict is not a pass', "verdict 'not-verified-uncurated-s1', pass false, exit 3",
    a.v && a.v.summary.verdict === 'not-verified-uncurated-s1' && a.v.summary.pass === false && a.code === 3,
    `verdict ${a.v && a.v.summary.verdict}, pass ${a.v && a.v.summary.pass}, exit ${a.code}`);

  // ...and a CURATED town with a real terminus contradiction must still go HARD.
  const c = stage('wisbech', 'terminus-hard');
  const vs = readJ(c, 'verified-services.json');
  const t = vs.services.find(s => String(s.route) === '50');
  t.termini = ['Aberdeen', 'Inverness'];      // chain leaves town and ends at WISH/TYDD
  writeJ(c, 'verified-services.json', vs);
  const b = verify(c);
  check('a real terminus contradiction still goes HARD', 'hard terminus on route 50',
    has(b.v, 'hard', 'terminus', '50'), b.v ? JSON.stringify(b.v.findings.filter(f => f.route === '50').map(f => f.severity + '/' + f.category)) : 'no report');
}

/* ------------------------------------------------------------------ 3. direction check */
console.log('\n3. Direction — below two buffer stops it says unavailable, above it still goes HARD');
{
  const d = stage('ramsey', 'dir-quiet');
  const rj = readJ(d, 'routes.json'); delete rj._bootstrap; writeJ(d, 'routes.json', rj);
  const a = verify(d);
  check('a one-buffer-stop route no longer goes HARD', 'no hard direction finding',
    a.v && !has(a.v, 'hard', 'direction'), `${a.v ? a.v.findings.filter(f => f.category === 'direction' && f.severity === 'hard').length : '?'} hard direction`);
  check('and it is reported, not silently dropped', 'a soft direction-unavailable finding naming 32 and X31',
    a.v && a.v.findings.some(f => f.category === 'direction-unavailable' && /\b32\b/.test(f.message) && /X31/.test(f.message)),
    'not found');

  /*
   * Reverse a route that HAS two buffer stops, so the selector has a genuine
   * choice and the check applies. Route 303 qualifies.
   *
   * Simply reflecting the buffer stops through the anchor is NOT enough, and
   * trying it is what showed why: the check compares the edge bearing against
   * EVERY chain end and keeps the closest, and 303's four chain ends sit at
   * 88/81/201/201 degrees, so the reflected bearing landed inside the 55-90 band
   * and produced a SOFT. That is the check working, but it does not prove it can
   * reach HARD. So compute the bearing furthest from every chain end and put the
   * buffer stops there, asserting first that such a bearing is more than 90
   * degrees clear of all of them — otherwise the fixture cannot express a
   * reversal at all and saying "no HARD" would prove nothing.
   */
  const c = stage('ramsey', 'dir-loud');
  const rj2 = readJ(c, 'routes.json'); delete rj2._bootstrap; writeJ(c, 'routes.json', rj2);
  const cfg = readJ(c, 'intown_cfg.json'), ll = readJ(c, 'atco2ll.json');
  const anchor = ll[cfg.anchor];
  const seq = readJ(c, 'routes_intown_atco.json')['303'];
  const extra = new Set(cfg.extraCore || []);
  const buffers = seq.filter(x => !(x.startsWith(cfg.prefix) || extra.has(x)));
  if (buffers.length < 2) throw new Error('fixture assumption broken: 303 no longer has two buffer stops');

  const toR = Math.PI / 180;
  const bearing = (a, b) => {
    const dLon = (b[1] - a[1]) * toR, la1 = a[0] * toR, la2 = b[0] * toR;
    const y = Math.sin(dLon) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };
  const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  // Mirror the engine's own terminus-candidate set EXACTLY: the ends of each
  // direction that are more than 0.5 km out, plus the single farthest chain stop.
  // Taking every chain stop instead makes the fixture look unusable — the first
  // attempt at this reported a 71-degree best margin, because the mid-chain stops
  // fill in bearings the check never actually compares against.
  const hav = (a, b) => {
    const R = 6371, dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const la1 = a[0] * toR, la2 = b[0] * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const fe = readJ(c, 'routes_full_atco.json')['303'];
  const dirs = fe.directions ? Object.values(fe.directions) : (fe.canonical || []);
  const ends = [];
  for (const x of dirs) for (const a of [x.stops[0], x.stops[x.stops.length - 1]]) {
    if (ll[a] && hav(anchor, ll[a]) > 0.5) ends.push(a);
  }
  const allStops = fe.all || [...new Set(dirs.flatMap(x => x.stops))];
  let far = null, farD = -1;
  for (const a of allStops) { if (!ll[a]) continue; const d = hav(anchor, ll[a]); if (d > farD) { farD = d; far = a; } }
  if (far && !ends.includes(far)) ends.push(far);
  const endBearings = ends.map(a => bearing(anchor, ll[a]));
  let escape = 0, margin = -1;
  for (let b = 0; b < 360; b++) {
    const m = Math.min(...endBearings.map(x => angleDiff(b, x)));
    if (m > margin) { margin = m; escape = b; }
  }
  if (margin <= 90) throw new Error(`fixture assumption broken: 303's chain ends span too widely to express a reversal (best margin ${margin.toFixed(0)}deg)`);
  const km = 6;                               // well outside the town, like a real buffer stop
  for (const x of buffers) {
    ll[x] = [anchor[0] + (km / 111) * Math.cos(escape * toR),
             anchor[1] + (km / (111 * Math.cos(anchor[0] * toR))) * Math.sin(escape * toR)];
  }
  writeJ(c, 'atco2ll.json', ll);
  const b = verify(c);
  check('a genuinely reversed route still goes HARD', 'hard direction on route 303',
    has(b.v, 'hard', 'direction', '303'),
    b.v ? JSON.stringify(b.v.findings.filter(f => f.route === '303').map(f => f.severity + '/' + f.category)) : 'no report');
}

/* ------------------------------------------------------- 3b. direction COVERAGE (OA-048) */
console.log('\n3b. Direction coverage — the fraction that ran, and it must account for every route');
{
  /*
   * WHY THIS PAIR EXISTS. Every case above asks whether a FINDING appears. None
   * of them can ask how much of the check ran, and that turned out to be the
   * bigger fact: measured across the eight towns on 2026-08-29, S-5 ran on 26
   * of 95 displayed routes, and on High Wycombe and March it ran on none at all
   * — while both reported a single soft `direction-unavailable` row identical in
   * shape to St Ives' one-route gap.
   *
   * Worse, the row's own arithmetic was wrong in the flattering direction. High
   * Wycombe said "not checkable on 26 of 34", which reads as 8 checked; the true
   * figure was 0 of 34, because eight routes left the loop through two silent
   * `continue`s and were counted nowhere. So the pair here is: the number exists
   * and is non-zero where the check works, AND it accounts for every displayed
   * route so it cannot drift kind again.
   */
  const d = stage('ramsey', 'dir-coverage');
  const rj = readJ(d, 'routes.json'); delete rj._bootstrap; writeJ(d, 'routes.json', rj);
  const a = verify(d);
  const dc = a.v && a.v.summary && a.v.summary.directionCoverage;
  check('the report says how much of the direction check ran', 'summary.directionCoverage with checked > 0 on Ramsey',
    !!dc && dc.checked > 0, dc ? JSON.stringify(dc) : 'no directionCoverage in summary');
  check('and the coverage arithmetic closes', 'checked + unavailable + skipped == displayed',
    !!dc && dc.accountsForAll && dc.checked + dc.unavailable + dc.skipped === dc.displayed,
    dc ? `${dc.checked}+${dc.unavailable}+${dc.skipped} vs ${dc.displayed}` : 'no directionCoverage');

  /*
   * The other half: a sheet where the check ran on NOTHING must be distinguishable
   * from one where it ran on most things. A PLACE is that case by construction --
   * no intown_cfg.json, so no ATCO prefix, so no buffer stop on any route, ever --
   * which is why it is the honest fixture for it rather than a mutated town.
   */
  const p = verify(stage('place', 'dir-coverage-place'));
  const pc = p.v && p.v.summary && p.v.summary.directionCoverage;
  check('a sheet the check never ran on reports 0, not silence', 'directionCoverage.checked === 0 on a place',
    !!pc && pc.checked === 0 && pc.pct === 0, pc ? JSON.stringify(pc) : 'no directionCoverage');
  check('and its finding says ANY rather than N of M', 'a direction-unavailable finding with allBlind true',
    !!p.v && p.v.findings.some(f => f.category === 'direction-unavailable' && f.evidence && f.evidence.allBlind === true),
    p.v ? JSON.stringify(p.v.findings.filter(f => f.category === 'direction-unavailable').map(f => f.evidence && f.evidence.allBlind)) : 'no report');
}

/* ------------------------------------------------------------------ 4. truncated chain */
console.log('\n4. Truncated chain — a chain that never leaves town cannot contradict a terminus');
{
  /* BUILD the truncation; do not borrow it. Until 2026-08-31 this case simply used
   * Wisbech's `excel` as it stood, because that chain happened to hold only its 15
   * local stops — which was not a property of the route but the July S2 pull having
   * been truncated by the date it ran on. Correcting that data (excel's chain is 95
   * stops, Peterborough to Norwich) took the premise away and both checks here went
   * red, on a build that had changed nothing about S6. A fixture that borrows a real
   * object for the property under test holds only while nobody fixes the object. */
  const TOWN = '0500FWISH';
  /* Clip BOTH `directions` and `canonical`. verify_report's fullDirections() unions the
   * two, so clipping only one leaves the other carrying the chain that does leave town
   * and chainNeverLeavesTown() stays false — which is exactly the wrong-field mistake
   * this case is meant to be about. */
  const excelDirs = (full) => [
    ...(full.excel.directions ? Object.values(full.excel.directions) : []),
    ...(full.excel.canonical || []),
  ].filter(d => d && Array.isArray(d.stops) && d.stops.length);
  const clipToTown = (dirPath) => {
    const full = readJ(dirPath, 'routes_full_atco.json');
    for (const dir of excelDirs(full)) {
      const kept = dir.stops.filter(a => a.startsWith(TOWN));
      if (kept.length >= 2) dir.stops = kept;
    }
    full.excel.all = [...new Set(excelDirs(full).flatMap(x => x.stops))];
    writeJ(dirPath, 'routes_full_atco.json', full);
    return full;
  };

  const d = stage('wisbech', 'trunc');
  clipToTown(d);
  const a = verify(d);
  /* The fact asserted here has not changed — a chain that never leaves town does
   * not contradict a terminus — but since 2026-08-29 (OA-156) it is carried in
   * the grouped `terminus-unavailable` finding rather than in a row of its own,
   * because a route the check could not run on is not a finding about the route.
   * So look for EXCEL in that finding's bucket, with its reason, and assert
   * separately that no terminus row about EXCEL survives anywhere. */
  const tu = a.v && a.v.findings.find(f => f.category === 'terminus-unavailable' && f.source !== 'redteam');
  check('the truncated chain is SOFT, not HARD', "EXCEL in terminus-unavailable with reason 'chain-truncated-to-local-stops'",
    !!tu && tu.severity === 'soft' && (tu.evidence.routes || []).some(u => u.route === 'EXCEL' && u.reason === 'chain-truncated-to-local-stops' && u.truncatedChain === true),
    tu ? JSON.stringify((tu.evidence.routes || []).filter(u => u.route === 'EXCEL')) : 'no terminus-unavailable finding');
  check('and no terminus row is raised about it at all', 'zero terminus findings on EXCEL',
    a.v && !a.v.findings.some(f => f.route === 'EXCEL' && f.category === 'terminus'),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.route === 'EXCEL').map(f => f.severity + '/' + f.category)) : 'no report');

  // Extend the chain one stop beyond town: it now HAS left town, so the check
  // applies again and the same declared termini become a real contradiction.
  const c = stage('wisbech', 'trunc-loud');
  const full = clipToTown(c);                 // same truncation, so the two cases differ by ONE stop
  const ll = readJ(c, 'atco2ll.json');
  const outsider = '0500HTYDD001';            // Tydd, a locality that is not Wisbech
  ll[outsider] = [52.73, 0.15];
  excelDirs(full)[0].stops.push(outsider);
  full.excel.all = [...new Set(excelDirs(full).flatMap(x => x.stops))];
  writeJ(c, 'routes_full_atco.json', full); writeJ(c, 'atco2ll.json', ll);
  const b = verify(c);
  check('once the chain leaves town, the same data goes HARD', 'hard terminus on EXCEL',
    has(b.v, 'hard', 'terminus', 'EXCEL'),
    b.v ? JSON.stringify(b.v.findings.filter(f => f.route === 'EXCEL').map(f => f.severity + '/' + f.category)) : 'no report');
}

/* ------------------------------------------------------------------ 5. route-key pairing */
console.log('\n5. Route keys — a branded name is not a second route, and a duplicate number is');
{
  const d = stage('wisbech', 'keys');
  const LEAD = injectMissingService(d);
  const a = verify(d);
  check('a branded red-team route is not double-counted', 'no missing-service whose route holds a bracket',
    a.v && !a.v.findings.some(f => f.category === 'missing-service' && /[()]/.test(String(f.route))),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'missing-service').map(f => f.route)) : 'no report');
  check('and it is not also reported as unconfirmed', 'no not-confirmed on route 46',
    a.v && !has(a.v, 'soft', 'not-confirmed', '46'), 'found');
  check('both same-numbered routes are checked, on their own keys', 'a finding carrying route 46L',
    a.v && a.v.findings.some(f => f.route === '46L'), 'none');

  // A service the red team found and we neither draw nor have ruled off must
  // still be reported — the highest-value output of the stage, and the thing the
  // pairing above must not swallow. The lead is injected rather than borrowed:
  // this check named Wisbech's route 68 until SF-012 decided it on 2026-09-08,
  // at which point the case stopped testing anything and said so in red.
  check('a genuinely missing service still fires', `missing-service on route ${LEAD}`,
    has(a.v, 'soft', 'missing-service', LEAD),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'missing-service').map(f => f.route)) : 'no report');
}

/* ------------------------------------------------------------------ 6. excluded pairing */
console.log('\n6. Exclusions — a same-numbered route run by someone else is not ours');
{
  const d = stage('stives', 'excl-quiet');
  const a = verify(d);
  check("a different operator's exclusion is not read as ours", 'no serves-town finding on 5A',
    a.v && !a.v.findings.some(f => f.route === '5A' && f.category === 'serves-town'),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.route === '5A').map(f => f.severity + '/' + f.category)) : 'no report');

  // Same exclusion, OUR operator on it: now it is about our route, and must block.
  const c = stage('stives', 'excl-loud');
  const rt = readJ(c, 'redteam.json');
  const e = rt.excluded.find(x => /^5A/.test(String(x.route)));
  if (!e) throw new Error('fixture assumption broken: no 5A exclusion in the St Ives redteam.json');
  e.operator = 'Stephensons of Essex';
  writeJ(c, 'redteam.json', rt);
  const b = verify(c);
  check('an exclusion naming our operator still goes HARD', 'hard serves-town on 5A',
    has(b.v, 'hard', 'serves-town', '5A'),
    b.v ? JSON.stringify(b.v.findings.filter(f => f.route === '5A').map(f => f.severity + '/' + f.category)) : 'no report');
}

/* ------------------------------------------------------------------ 7. a place */
console.log('\n7. A place — the direction check is unavailable by construction, and says so');
{
  const d = stage('place', 'place');
  const a = verify(d);
  check('no direction finding is manufactured for a place', 'no hard or soft direction finding',
    a.v && !has(a.v, 'hard', 'direction') && !has(a.v, 'soft', 'direction'),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'direction').map(f => f.severity)) : 'no report');
  check('it explains why rather than going quiet', "direction-unavailable citing 'no-intown-prefix'",
    a.v && a.v.findings.some(f => f.category === 'direction-unavailable' && f.evidence.reason === 'no-intown-prefix'),
    'not found');
  /*
   * The red-team terminus comparison is what actually carries the direction-ish
   * signal for a place, so prove IT can still block.
   *
   * Not by asserting the historic finding: references/s6-verify.md cites St Neots
   * Town Centre's route 66 as a HARD, and on the CURRENT S2/S3 it is a SOFT --
   * because the place's routes.json has since been given curated destinations[]
   * and the red team's second terminus, St Neots, now matches a chain end (STNS).
   * The data was fixed, which is the outcome that finding was for. Asserting the
   * old HARD would have made this harness a monument to a resolved defect.
   */
  check('with both red-team termini reachable it is SOFT', 'soft, not hard, terminus on 66 from the red team',
    a.v && a.v.findings.some(f => f.route === '66' && f.category === 'terminus' && f.source === 'redteam' && f.severity === 'soft')
        && !a.v.findings.some(f => f.route === '66' && f.category === 'terminus' && f.severity === 'hard'),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.route === '66').map(f => f.severity + '/' + f.category + '/' + f.source)) : 'no report');

  const c = stage('place', 'place-loud');
  const rt = readJ(c, 'redteam.json');
  const s66 = rt.services.find(s => String(s.route) === '66');
  if (!s66) throw new Error('fixture assumption broken: no route 66 in the place redteam.json');
  s66.termini = ['Fenstanton', 'Aberdeen'];   // neither is a locality at our chain ends
  writeJ(c, 'redteam.json', rt);
  const b = verify(c);
  check("a place's red-team terminus check still goes HARD", 'hard terminus on 66 from the red team',
    b.v && b.v.findings.some(f => f.route === '66' && f.category === 'terminus' && f.severity === 'hard' && f.source === 'redteam'),
    b.v ? JSON.stringify(b.v.findings.filter(f => f.route === '66').map(f => f.severity + '/' + f.category + '/' + f.source)) : 'no report');
}

/* ------------------------------------------------------------------ 8. the not-shown declaration */
console.log("\n8. Not shown \u2014 a declared panel row is not missing geometry, and the declaration is checked both ways");
{
  /*
   * The artefact this pair exists for. Routes 112 and 193 (Ivel Sprinter, a
   * Bedfordshire community service outside the BODS region we pull) are carried on
   * both St Neots place sheets as Services-panel rows with no line, on purpose. S6
   * called both HARD `no-full-chain`, and on current data those two findings were
   * the ENTIRE distance between this place being BLOCKED and being clean.
   *
   * The fixture asserts that first, against the UNDECLARED config, so this case
   * cannot quietly pass on a place that no longer carries either route.
   *
   * AND IT MUST UNDECLARE IT ITSELF. This case was written on 2026-08-28 against a
   * config that had no `notShown`, and the same day the fix went into the place's
   * real S3 -- which is where `stage()` seeds from, deliberately, by `latest`. From
   * that moment the "before the fix" fixture WAS the fixed config, the precondition
   * could never hold again, and CI went red reporting a fault in the subject when
   * the fault was in its own premise. It was red on four consecutive pushes before
   * anybody read the log. Deleting the key here makes the fixture state what it
   * means rather than borrowing it from a file the fix is expected to change; the
   * throw below is what distinguishes "the declaration was there and is now gone"
   * from "this place no longer carries either route", which the old form could not.
   * See the failure shape `the fix invalidates its own control`.
   */
  const base = stage('place', 'notshown-base');
  {
    const rj0 = readJ(base, 'routes.json');
    if (!Array.isArray(rj0.notShown) || !rj0.notShown.includes('112') || !rj0.notShown.includes('193')) {
      throw new Error('fixture assumption broken: the place\'s latest S3 no longer declares 112 and 193 '
        + 'as notShown, so this case can no longer show the fix doing anything. Got: '
        + JSON.stringify(rj0.notShown || null));
    }
    delete rj0.notShown;
    writeJ(base, 'routes.json', rj0);
  }
  const a0 = verify(base);
  check('the artefact is real before the fix', 'hard no-full-chain on both 112 and 193 with no declaration',
    has(a0.v, 'hard', 'no-full-chain', '112') && has(a0.v, 'hard', 'no-full-chain', '193'),
    a0.v ? JSON.stringify(a0.v.findings.filter(f => f.category === 'no-full-chain').map(f => f.severity + '/' + f.route)) : 'no report');

  const d = stage('place', 'notshown-quiet');
  const rj = readJ(d, 'routes.json'); rj.notShown = ['112', '193']; writeJ(d, 'routes.json', rj);
  const a = verify(d);
  check('a declared panel row no longer blocks', 'no hard no-full-chain on 112 or 193',
    a.v && !has(a.v, 'hard', 'no-full-chain', '112') && !has(a.v, 'hard', 'no-full-chain', '193'),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'no-full-chain').map(f => f.severity + '/' + f.route)) : 'no report');
  check('and it is reported, not silently dropped', 'a soft declared-not-shown for each',
    a.v && has(a.v, 'soft', 'declared-not-shown', '112') && has(a.v, 'soft', 'declared-not-shown', '193'),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'declared-not-shown').map(f => f.severity + '/' + f.route)) : 'no report');

  /*
   * A route with NO declaration must still go HARD -- otherwise the fix is a mute
   * button with extra steps. Declare only 112 and check that 193 still blocks.
   */
  const u = stage('place', 'notshown-undeclared');
  const rju = readJ(u, 'routes.json'); rju.notShown = ['112']; writeJ(u, 'routes.json', rju);
  const b = verify(u);
  check('an UNDECLARED route with no chain still goes HARD', 'hard no-full-chain on 193',
    has(b.v, 'hard', 'no-full-chain', '193'),
    b.v ? JSON.stringify(b.v.findings.filter(f => f.category === 'no-full-chain').map(f => f.severity + '/' + f.route)) : 'no report');

  /*
   * The declaration checked the other way. Route 66 IS drawn on this place -- seven
   * stops in routes_intown_atco.json -- so declaring it "not shown" is false, and a
   * false declaration is exactly how this key would be abused to silence a finding
   * about a route that is on the sheet.
   */
  const c = stage('place', 'notshown-loud');
  const drawn66 = (readJ(c, 'routes_intown_atco.json')['66'] || []).length;
  if (drawn66 < 2) throw new Error('fixture assumption broken: route 66 is no longer drawn on this place');
  const rjc = readJ(c, 'routes.json'); rjc.notShown = ['112', '193', '66']; writeJ(c, 'routes.json', rjc);
  const cc = verify(c);
  check('declaring a DRAWN route not shown goes HARD', 'hard declared-not-shown on 66',
    has(cc.v, 'hard', 'declared-not-shown', '66'),
    cc.v ? JSON.stringify(cc.v.findings.filter(f => f.category === 'declared-not-shown').map(f => f.severity + '/' + f.route)) : 'no report');

  // ...and a declaration for a route the sheet does not carry at all is stale, and says so.
  const e = stage('place', 'notshown-stale');
  const rje = readJ(e, 'routes.json'); rje.notShown = ['112', '193', 'ZZ9']; writeJ(e, 'routes.json', rje);
  const ee = verify(e);
  check('a stale declaration is reported, not ignored', 'soft declared-not-shown on ZZ9',
    has(ee.v, 'soft', 'declared-not-shown', 'ZZ9'),
    ee.v ? JSON.stringify(ee.v.findings.filter(f => f.category === 'declared-not-shown').map(f => f.severity + '/' + f.route)) : 'no report');
}

/* ------------------------------------------------ redteamRejected: adjudicated claims */
console.log('\n6. redteamRejected — an adjudicated red-team claim is recorded, never muted');
{
  /*
   * THE ARTEFACT. The blind red team says St Neots route 69 does not serve the
   * town, calling its "Eynesbury Tesco" stop a data-extraction artefact. It is
   * wrong twice over: NaPTAN gives 0500HEYNE001 ParentLocalityName "St Neots",
   * and BODS carries the service from 20 Aug 2026 -- a calendar that opened the
   * day before that red team ran, which is exactly what a web-sourced check
   * cannot see. Peter adjudicated it on 2026-08-22; S6 went on saying HARD.
   *
   * THE FIXTURE UNDECLARES IT ITSELF, and throws if there was nothing to
   * undeclare. `stage()` seeds from the town's LATEST S3, which is where the fix
   * lands -- so a case that merely read the config would, from the moment the fix
   * shipped, be testing the fixed state against itself and could never show the
   * fix doing anything. That is the failure shape `the fix invalidates its own
   * control`, and it cost this harness four consecutive red pushes once already.
   */
  const base = stage('stneots', 'rtr-base');
  {
    const rj = readJ(base, 'routes.json');
    if (!Array.isArray(rj.redteamRejected) || !rj.redteamRejected.some(e => String(e.route) === '69')) {
      throw new Error('fixture assumption broken: St Neots\' latest S3 no longer declares a redteamRejected '
        + 'entry for route 69, so this case cannot show the declaration doing anything. Got: '
        + JSON.stringify(rj.redteamRejected || null));
    }
    delete rj.redteamRejected;
    writeJ(base, 'routes.json', rj);
  }
  const a0 = verify(base);
  check('the artefact is real before the declaration', 'hard serves-town on 69 with nothing declared',
    has(a0.v, 'hard', 'serves-town', '69'),
    a0.v ? JSON.stringify(a0.v.findings.filter(f => f.category === 'serves-town').map(f => f.severity + '/' + f.route)) : 'no report');

  const GOOD = {
    route: '69', claim: 'serves-town', decidedOn: '2026-08-22', decidedBy: 'Peter',
    why: 'NaPTAN gives 0500HEYNE001 ParentLocalityName "St Neots"; BODS carries 69 to it from 20 Aug 2026.',
    evidence: 'Development Docs/route-66-and-69-evidence_2026-08-22.md',
  };
  const withDecl = (name, decl, mutate) => {
    const d = stage('stneots', name);
    const rj = readJ(d, 'routes.json'); rj.redteamRejected = decl; writeJ(d, 'routes.json', rj);
    if (mutate) mutate(d);
    return verify(d);
  };

  const ok = withDecl('rtr-quiet', [GOOD]);
  check('an adjudicated claim no longer blocks', 'no hard serves-town on 69',
    ok.v && !has(ok.v, 'hard', 'serves-town', '69'),
    ok.v ? JSON.stringify(ok.v.findings.filter(f => f.severity === 'hard').map(f => f.category + '/' + f.route)) : 'no report');
  check('and it is reported in full, not silently dropped', 'a soft redteam-rejected on 69',
    has(ok.v, 'soft', 'redteam-rejected', '69'),
    ok.v ? JSON.stringify(ok.v.findings.filter(f => f.category === 'redteam-rejected').map(f => f.severity + '/' + f.route)) : 'no report');

  /*
   * The three ways this could become a mute button, each proved to still be loud.
   */
  const bad = withDecl('rtr-malformed', [{ route: '69', decidedOn: '2026-08-22', decidedBy: 'Peter' }]);
  check('an entry with no reason silences NOTHING', 'hard serves-town on 69 still fires',
    has(bad.v, 'hard', 'serves-town', '69'),
    bad.v ? JSON.stringify(bad.v.findings.filter(f => f.severity === 'hard').map(f => f.category + '/' + f.route)) : 'no report');
  check('and the malformed entry is named', 'a soft redteam-rejected reporting the missing field',
    has(bad.v, 'soft', 'redteam-rejected', '69'),
    bad.v ? JSON.stringify(bad.v.findings.filter(f => f.category === 'redteam-rejected').map(f => f.severity + '/' + f.route)) : 'no report');

  const expired = withDecl('rtr-expired', [{ ...GOOD, recheckBy: '2026-08-01' }]);
  check('a rejection past its recheckBy stops silencing', 'hard serves-town on 69 returns',
    has(expired.v, 'hard', 'serves-town', '69'),
    expired.v ? JSON.stringify(expired.v.findings.filter(f => f.severity === 'hard').map(f => f.category + '/' + f.route)) : 'no report');

  /*
   * The dangerous direction. We asserted the red team was wrong; if our OWN drawn
   * data stops placing the route in the town, the entry would be silencing a claim
   * that has become correct. Assert 69 IS drawn first, so the mutation means
   * something on a future config rather than passing vacuously.
   */
  const drawn69 = (readJ(base, 'routes_intown_atco.json')['69'] || []).length;
  if (drawn69 < 1) throw new Error('fixture assumption broken: route 69 is no longer drawn in St Neots at all');
  const danger = withDecl('rtr-danger', [GOOD], (d) => {
    const it = readJ(d, 'routes_intown_atco.json'); delete it['69']; writeJ(d, 'routes_intown_atco.json', it);
  });
  check('a rejection our own data no longer supports goes HARD', 'hard redteam-rejected on 69',
    has(danger.v, 'hard', 'redteam-rejected', '69'),
    danger.v ? JSON.stringify(danger.v.findings.filter(f => f.severity === 'hard').map(f => f.category + '/' + f.route)) : 'no report');
  check('and it does not ALSO claim the entry is unused', 'exactly one redteam-rejected finding for 69',
    danger.v && danger.v.findings.filter(f => f.category === 'redteam-rejected' && f.route === '69').length === 1,
    danger.v ? JSON.stringify(danger.v.findings.filter(f => f.category === 'redteam-rejected').map(f => f.severity + '/' + f.route)) : 'no report');

  /* Two kinds of stale entry, both reported rather than ignored. */
  const stale1 = withDecl('rtr-stale-uncontested', [GOOD, { ...GOOD, route: '66' }]);
  check('a rejection the red team does not contradict is reported stale', 'soft redteam-rejected on 66',
    has(stale1.v, 'soft', 'redteam-rejected', '66'),
    stale1.v ? JSON.stringify(stale1.v.findings.filter(f => f.category === 'redteam-rejected').map(f => f.severity + '/' + f.route)) : 'no report');
  const stale2 = withDecl('rtr-stale-absent', [GOOD, { ...GOOD, route: 'ZZ9' }]);
  check('a rejection for a route the sheet does not carry is reported stale', 'soft redteam-rejected on ZZ9',
    has(stale2.v, 'soft', 'redteam-rejected', 'ZZ9'),
    stale2.v ? JSON.stringify(stale2.v.findings.filter(f => f.category === 'redteam-rejected').map(f => f.severity + '/' + f.route)) : 'no report');
}

/* ------------------------------------------- 9. borrowed red team (OA-141) */
console.log('\n9. A borrowed red team is evidence, not a verdict — and it still says everything it said');
{
  /*
   * Peter decided on 2026-08-29 that a TOWN's blind answer may verify a PLACE
   * inside it, with every HARD restated as a SOFT. The pair is the whole point:
   * the downgrade must happen, AND nothing may be silently dropped on the way.
   * "Fix the noisy check" whose failure mode is a check that no longer says
   * anything is exactly the shape this file exists to catch.
   *
   * THE HARD IS BUILT, NOT BORROWED (2026-08-29). It used to rely on Wisbech's
   * own red team producing a real one -- X46, which the answer says merged into
   * the plain 46 while we still drew it. On 2026-08-29 Peter adjudicated that
   * question, X46 came off the sheet and out of verified-services.json, and this
   * case failed in CI the same afternoon: "the fixture really produces a
   * red-team HARD to begin with" went red, not because anything broke but
   * because the estate got BETTER underneath it. That is the same trap case 1
   * and case 10 both record, walked into from the other side -- a fixture that
   * borrows a real object which happens to have the property under test expires
   * the day somebody fixes the object, and it expires as a FALSE ALARM.
   *
   * So the claim is now injected: the red team is told a route the sheet
   * genuinely draws does not serve the town. T7 is chosen because it is drawn,
   * it carries no redteamRejected entry (case 8 uses 66 for that), and nothing
   * else in this file depends on it.
   */
  const ownDir = stage('wisbech', 'borrow-own');
  injectServesTownFalse(ownDir);
  const own = verify(ownDir);
  const ownHard = own.v ? own.v.findings.filter(f => f.source === 'redteam' && f.severity === 'hard') : [];
  check('the fixture really produces a red-team HARD to begin with', 'at least one hard finding with source redteam',
    ownHard.length > 0, `${ownHard.length} — without one this case proves nothing`);

  const d = stage('wisbech', 'borrow-lent');
  injectServesTownFalse(d);
  const rt = readJ(d, 'redteam.json');
  rt._borrowedFrom = { map: 'Somewhere Else', build: '/elsewhere', run: '2026-08-26_0700', derivedAt: '2026-08-26', borrowedOn: '2026-08-29' };
  writeJ(d, 'redteam.json', rt);
  const lent = verify(d);
  check('a borrowed answer blocks nothing', 'no hard finding with source redteam',
    lent.v && lent.v.findings.filter(f => f.source === 'redteam' && f.severity === 'hard').length === 0,
    lent.v ? JSON.stringify(lent.v.findings.filter(f => f.source === 'redteam' && f.severity === 'hard').map(f => f.id)) : 'no report');
  check('and every one of them survives as a soft, not dropped', `${ownHard.length} downgraded finding(s) still present`,
    !!lent.v && ownHard.every(o => lent.v.findings.some(f => f.category === o.category && f.route === o.route
      && f.severity === 'soft' && f.evidence && f.evidence.downgradedFromHard === true)),
    lent.v ? JSON.stringify(lent.v.findings.filter(f => f.evidence && f.evidence.downgradedFromHard).map(f => f.category + '/' + f.route)) : 'no report');
  check('the file records that this pass rests on a borrowed answer', 'summary.borrowedRedteam names the lending map',
    !!lent.v && lent.v.summary.borrowedRedteam && lent.v.summary.borrowedRedteam.map === 'Somewhere Else',
    lent.v ? JSON.stringify(lent.v.summary.borrowedRedteam) : 'no report');
  check('the SANITY checks are untouched — only the red team is scoped', 'the same number of sanity findings either way',
    !!lent.v && !!own.v
      && lent.v.findings.filter(f => f.source === 'sanity').length === own.v.findings.filter(f => f.source === 'sanity').length,
    lent.v && own.v ? `${lent.v.findings.filter(f => f.source === 'sanity').length} vs ${own.v.findings.filter(f => f.source === 'sanity').length}` : 'no report');
}

/* --------------------------------------------------- 10. terminus coverage */
console.log('\n10. Terminus coverage — a check with nothing to compare against says so ONCE');
{
  /*
   * OA-156, 2026-08-29. The terminus check reads NaPTAN locality codes off the
   * ends of a route's full chain. Where the local ATCO codes are not in the
   * 0500H<LLLL>nnn style there is no code to read, nothing is compared, and the
   * check used to print a row per route saying so — 34 of them on High Wycombe,
   * where it has therefore never once run, and 7 on Beaconsfield. Estate-wide
   * that was 217 of 280 terminus findings.
   *
   * The fixture is BUILT rather than borrowed, for the reason case 1 learned the
   * hard way: High Wycombe's own data would make this case expire the day
   * somebody re-codes Buckinghamshire's stops. Wisbech's chain ends are properly
   * locality-coded, so re-coding them to a non-locality style is the fault.
   */
  const d = stage('wisbech', 'term-blind');
  const full = readJ(d, 'routes_full_atco.json'), ll = readJ(d, 'atco2ll.json');
  const rename = {};
  for (const fe of Object.values(full)) {
    /* BOTH lists, not one: verify_report's fullDirections() concatenates
     * fe.directions AND fe.canonical, so a fixture that re-codes only the first
     * leaves tokenised ends behind and the check goes on running. It did, on the
     * first run of this case. */
    const dirs = [...(fe.directions ? Object.values(fe.directions) : []), ...(fe.canonical || [])];
    for (const dir of dirs) {
      if (!dir || !Array.isArray(dir.stops) || !dir.stops.length) continue;
      for (const i of [0, dir.stops.length - 1]) {
        const a = dir.stops[i];
        if (!rename[a]) { rename[a] = 'ZZ' + a.replace(/[^0-9]/g, '').slice(-8); ll[rename[a]] = ll[a]; }
        dir.stops[i] = rename[a];
      }
    }
    if (Array.isArray(fe.all)) fe.all = fe.all.map(a => rename[a] || a);
  }
  writeJ(d, 'routes_full_atco.json', full); writeJ(d, 'atco2ll.json', ll);
  const a = verify(d);
  const tc = a.v && a.v.summary && a.v.summary.terminusCoverage;
  check('a sheet the terminus check never ran on reports 0, not silence', 'terminusCoverage.checked === 0',
    !!tc && tc.checked === 0, tc ? JSON.stringify(tc) : 'no terminusCoverage in summary');
  /* Scoped to the SANITY check on purpose. On a TOWN the red-team terminus
   * comparison is name-against-name — our declared termini against the red
   * team's settlements — and reads no chain code at all, so blinding the chain
   * does not and should not blind it. Asserting "no terminus row of any kind"
   * would have made this case fail for the right check doing its job. */
  check('it says so ONCE, not once per route', 'exactly one terminus-unavailable finding, and no per-route SANITY terminus rows',
    !!a.v && a.v.findings.filter(f => f.category === 'terminus-unavailable' && f.source !== 'redteam').length === 1
         && a.v.findings.filter(f => f.category === 'terminus' && f.source !== 'redteam').length === 0,
    a.v ? JSON.stringify(a.v.findings.filter(f => /^terminus/.test(f.category)).map(f => f.severity + '/' + f.category + '/' + (f.route || '-') + '/' + f.source)) : 'no report');
  check('and it says ANY rather than N of M', 'the finding carries allBlind true',
    !!a.v && a.v.findings.some(f => f.category === 'terminus-unavailable' && f.evidence && f.evidence.allBlind === true),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'terminus-unavailable').map(f => f.evidence && f.evidence.allBlind)) : 'no report');

  /*
   * THE LOUD ARM. The same town, unmutated: the check runs, the arithmetic
   * closes, and a route whose declared termini are nowhere near its chain ends
   * still goes HARD. Without this the case above is satisfied by a checker that
   * has stopped saying anything at all.
   */
  const c = stage('wisbech', 'term-loud');
  const vs = readJ(c, 'verified-services.json');
  vs.services.find(t => String(t.route) === '50').termini = ['Aberdeen', 'Inverness'];
  writeJ(c, 'verified-services.json', vs);
  const b = verify(c);
  const tc2 = b.v && b.v.summary && b.v.summary.terminusCoverage;
  check('on the same town unmutated the check DOES run', 'terminusCoverage.checked > 0',
    !!tc2 && tc2.checked > 0, tc2 ? JSON.stringify(tc2) : 'no terminusCoverage');
  check('and the coverage arithmetic closes', 'checked + unavailable + skipped == displayed',
    !!tc2 && tc2.accountsForAll && tc2.checked + tc2.unavailable + tc2.skipped === tc2.displayed,
    tc2 ? `${tc2.checked}+${tc2.unavailable}+${tc2.skipped} vs ${tc2.displayed}` : 'no terminusCoverage');
  check('a real terminus contradiction still goes HARD', 'hard terminus on 50',
    has(b.v, 'hard', 'terminus', '50'),
    b.v ? JSON.stringify(b.v.findings.filter(f => f.route === '50').map(f => f.severity + '/' + f.category)) : 'no report');
}

/* ------------------------------------------------------------- 11. days */
console.log('\n11. Days — a wording difference, a qualification and a contradiction are three things');
{
  /*
   * OA-156 source three, 2026-08-29. One `days` category made a gap in our data,
   * a qualification the red team adds, and a genuine disagreement about which
   * days a bus runs all read alike: 102 findings across the estate, of which 34
   * were a difference of fact. All four arms below are driven off ONE fixture
   * route so the only thing that varies is the red team's string.
   */
  const setDays = (name, ours, theirs) => {
    const d = stage('wisbech', name);
    const vs = readJ(d, 'verified-services.json');
    const svc = vs.services.find(t => String(t.route) === '50');
    svc.days = ours;
    writeJ(d, 'verified-services.json', vs);
    const rt = readJ(d, 'redteam.json');
    const rs = (rt.services || []).find(t => String(t.route).replace(/\s+/g, '') === '50');
    if (!rs) throw new Error('fixture: the red team does not name route 50, so this case would prove nothing');
    rs.days = theirs;
    writeJ(d, 'redteam.json', rt);
    const v = verify(d).v;
    return (v ? v.findings : []).filter(f => f.route === '50' && /^days/.test(f.category)).map(f => f.category);
  };
  check('"only" is not a day', 'ours "Mon-Fri" vs red-team "Mon-Fri only" raises nothing at all',
    JSON.stringify(setDays('days-wording', 'Mon-Fri', 'Mon-Fri only')) === '[]', JSON.stringify(setDays('days-wording2', 'Mon-Fri', 'Mon-Fri only')));
  check('nor is a plural', 'ours "Thu" vs red-team "Thursdays only" raises nothing at all',
    JSON.stringify(setDays('days-plural', 'Thu', 'Thursdays only')) === '[]', JSON.stringify(setDays('days-plural2', 'Thu', 'Thursdays only')));
  check('a qualification is reported as a qualification', "days-qualified, not days",
    JSON.stringify(setDays('days-qual', 'Mon-Fri', 'Mon-Fri (not bank holidays)')) === '["days-qualified"]',
    JSON.stringify(setDays('days-qual2', 'Mon-Fri', 'Mon-Fri (not bank holidays)')));
  check('a gap on our side is reported as a gap', 'days-unknown when ours is "?"',
    JSON.stringify(setDays('days-unk', '?', 'Mon-Sat')) === '["days-unknown"]',
    JSON.stringify(setDays('days-unk2', '?', 'Mon-Sat')));
  /* THE LOUD ARM: a real difference of fact must still be reported as one. */
  check('a real difference of fact still fires', 'plain days when the days genuinely differ',
    JSON.stringify(setDays('days-real', 'Mon-Fri', 'Sun')) === '["days"]',
    JSON.stringify(setDays('days-real2', 'Mon-Fri', 'Sun')));
}

/* --------------------------------------- 12. missing-service on a borrowed answer */
console.log('\n12. missing-service — a borrowed answer is a superset, and the row says so');
{
  /*
   * OA-156 source two, 2026-08-29. A place borrows its parent town's blind
   * answer (OA-141); the town answer is about services serving the TOWN, so
   * every town service the place does not draw arrives as an "inclusion
   * candidate". High Wycombe Aldi drew 12 against a borrowed answer naming 44.
   * These are NOT suppressed — St Neots Co-op's W9/W10 leads come out of this
   * same path and are real (OA-050) — so the pair is: the row carries the reason
   * when borrowed, and does NOT claim a borrow when the answer is the map's own.
   */
  const ownDir = stage('wisbech', 'ms-own');
  injectMissingService(ownDir);
  const own = verify(ownDir).v;
  const ownMs = (own ? own.findings : []).filter(f => f.category === 'missing-service');
  check('the fixture really produces a missing-service row to begin with', 'at least one missing-service finding',
    ownMs.length > 0, `${ownMs.length} — without one this case proves nothing`);
  check('an answer bought for THIS map claims no borrow', 'supersetArtefactPossible false on every row',
    ownMs.every(f => f.evidence && f.evidence.supersetArtefactPossible === false && f.evidence.borrowedFrom === null),
    JSON.stringify(ownMs.map(f => f.evidence && f.evidence.borrowedFrom)));

  const d = stage('wisbech', 'ms-lent');
  injectMissingService(d);
  const rt = readJ(d, 'redteam.json');
  rt._borrowedFrom = { map: 'Somewhere Else', build: '/elsewhere', run: '2026-08-26_0700', derivedAt: '2026-08-26', borrowedOn: '2026-08-29' };
  writeJ(d, 'redteam.json', rt);
  const lent = verify(d).v;
  const lentMs = (lent ? lent.findings : []).filter(f => f.category === 'missing-service');
  check('none of them is dropped when the answer is borrowed', `${ownMs.length} missing-service row(s) either way`,
    lentMs.length === ownMs.length, `${lentMs.length} vs ${ownMs.length}`);
  check('and every row names the map the answer was bought for', "supersetArtefactPossible true, borrowedFrom 'Somewhere Else'",
    lentMs.length > 0 && lentMs.every(f => f.evidence && f.evidence.supersetArtefactPossible === true && f.evidence.borrowedFrom === 'Somewhere Else'),
    JSON.stringify(lentMs.map(f => f.evidence && f.evidence.borrowedFrom)));
}

/* ------------------------- 13. the NaPTAN register behind the terminus check (OA-038) */
console.log('\n13. The stop register — it may only ever REMOVE a terminus finding, never add one');
{
  /*
   * OA-038, 2026-08-31. Two gazetteers were built on 2026-08-22 by concurrent
   * sessions: this engine's hand-seeded `naptan_localities.json`, which had ONE
   * entry, and `_gtfs/naptan.sqlite`, the DfT register with a locality and a parent
   * for all 127,658 stops. verify_report.js now reads the register and keeps the
   * hand file as the offline fallback.
   *
   * THIS CASE BUILDS ITS OWN REGISTER, and that is the point rather than an
   * economy. `_gtfs/*.sqlite` is gitignored — 38 MB of rebuildable data in no
   * repository — so a CI clone has no register at all, and a case that read the
   * real one would be a check sited where its subject cannot exist: green for ever
   * on the one machine that has the file and silently skipped everywhere else.
   * Two rows of synthetic sqlite are enough, and they make the fixture say exactly
   * what is being tested instead of borrowing an estate fact that can move.
   *
   * THE PAIR. One run, one invented terminus name, and the ONLY variable is what
   * the register says. Quiet arm: the register resolves the chain-end token to
   * that name, and the finding goes. Loud arm: the register resolves the same
   * token to something else, and the finding stays. Without the loud arm the
   * quiet one is satisfied by a register lookup that has stopped working.
   *
   * SCOPED TO source 'sanity', AND THE CONTROL IS WHY. Route 50 draws TWO terminus
   * findings once its declared terminus is invented: the SANITY one, which asks
   * whether the name reaches the chain-end locality code and is the only one the
   * register feeds, and the REDTEAM one, which asks whether our terminus agrees
   * with the settlements the red team gives and is a genuine HARD that must
   * survive. Written unscoped, the quiet arm below failed on the hard row — the
   * check catching the fixture rather than the code, which is the whole reason a
   * loud arm is written first.
   */
  const sanityTerm = (v) => (v ? v.findings : []).filter(
    (f) => f.category === 'terminus' && f.route === '50' && f.source === 'sanity');
  /*
   * node:sqlite IS NOT EVERYWHERE, AND CI IS WHERE IT IS NOT. It arrived in Node
   * 22 and this file was written on Node 24; the runner is on **Node 20**, where
   * `require('node:sqlite')` throws ERR_UNKNOWN_BUILTIN_MODULE. Requiring it at
   * the top of this block took the WHOLE harness down on the first push, after
   * twelve sections had passed — measured, not foreseen, which is the point.
   *
   * So this resolves it defensively and the section SPLITS on the answer. The two
   * register arms need the module and are reported NOT RUN by name when it is
   * absent; the no-register arm needs nothing and runs everywhere, because that
   * arm is the FALLBACK PATH — the one CI actually executes in `verify_report.js`,
   * since `_gtfs/*.sqlite` is gitignored and no runner has a register either. A
   * skip that quietly counted as a pass would be the exact failure this file
   * exists to prevent, so the not-run lines are printed loudly and counted as
   * neither.
   */
  const DatabaseSync = (() => {
    const emit = process.emitWarning;
    process.emitWarning = (w, ...rest) => {
      const s = typeof w === 'string' ? w : (w && w.message) || '';
      if (/SQLite is an experimental feature/.test(s)) return;
      return emit.call(process, w, ...rest);
    };
    try { return require('node:sqlite').DatabaseSync; }
    catch { return null; }
    finally { process.emitWarning = emit; }
  })();
  if (!DatabaseSync) {
    console.log(`  NOT RUN  the two register arms — this Node (${process.version}) has no node:sqlite`);
    console.log('           the no-register arm below still runs, and it is the path CI itself takes');
  }

  // A one-table register with the columns verify_report.js actually selects.
  // `localityToken` slices four letters out of an ATCO code after 4 digits and one
  // letter, so 0500H<TOKEN>001 is how a row is addressed to a token.
  function miniRegister(file, token, localityName) {
    fs.rmSync(file, { force: true });
    const db = new DatabaseSync(file);
    db.exec('create table naptan (ATCOCode text, LocalityName text, ParentLocalityName text)');
    const ins = db.prepare('insert into naptan values (?, ?, ?)');
    ins.run('0500H' + token + '001', localityName, null);
    ins.run('9999X' + 'ZZZZ' + '001', 'Somewhere With No Bearing On This', null);
    db.close();
    return file;
  }

  const TERMINUS = 'Zzyzxville';                    // in no gazetteer, real or invented
  const d = stage('wisbech', 'gazetteer');
  const vs = readJ(d, 'verified-services.json');
  const svc = vs.services.find(t => String(t.route) === '50');
  if (!svc) throw new Error('prove-s6-checks: fixture route 50 is gone from the Wisbech S1 — pick another drawn route, do not delete the case');
  svc.termini = [TERMINUS];
  writeJ(d, 'verified-services.json', vs);

  // Arm 0 — NO register at all. This both establishes the finding exists to be
  // removed and TELLS US THE KEY: the checker reports the chain-end tokens it
  // compared against, so the register below is addressed from the checker's own
  // evidence and cannot go stale when the geometry moves.
  const bare = verify(d, { VERIFY_NAPTAN: path.join(TMP, 'no-such-register.sqlite') });
  const f0 = sanityTerm(bare.v)[0];
  check('with no register the invented terminus IS a finding', "a sanity terminus finding on 50",
    !!f0, bare.v ? JSON.stringify(bare.v.findings.filter(f => f.route === '50').map(f => f.severity + '/' + f.category + '/' + f.source)) : 'no report');
  const token = f0 && f0.evidence && (f0.evidence.chainEndTokens || [])[0];
  check('and it names the chain-end token it compared against', 'evidence.chainEndTokens is non-empty',
    !!token, f0 ? JSON.stringify(f0.evidence) : 'no finding to read a token from');

  if (token && DatabaseSync) {
    // QUIET ARM — the register says that token IS Zzyzxville.
    const good = verify(d, { VERIFY_NAPTAN: miniRegister(path.join(TMP, 'reg-hit.sqlite'), token, TERMINUS) });
    check('a register that resolves the token REMOVES the finding', 'no sanity terminus finding on 50',
      sanityTerm(good.v).length === 0,
      good.v ? JSON.stringify(good.v.findings.filter(f => f.route === '50').map(f => f.severity + '/' + f.category + '/' + f.source)) : 'no report');

    // LOUD ARM — same run, same token, a register that says something else.
    const bad = verify(d, { VERIFY_NAPTAN: miniRegister(path.join(TMP, 'reg-miss.sqlite'), token, 'Nowhereton') });
    check('a register that does NOT resolve it leaves the finding standing', 'the sanity terminus finding on 50 survives',
      sanityTerm(bad.v).length > 0,
      bad.v ? JSON.stringify(bad.v.findings.filter(f => f.route === '50').map(f => f.severity + '/' + f.category + '/' + f.source)) : 'no report');

    // AND THE ONE-DIRECTIONAL CLAIM, which is the whole safety argument for
    // reading a file CI does not have: adding a source of TRUE to a boolean can
    // only ever remove findings. Measured, not reasoned — the two runs above
    // differ in nothing but the register, so any finding present with the
    // resolving register and absent without it would be one this code invented.
    const key = (f) => f.severity + '/' + f.category + '/' + (f.route || '-') + '/' + String(f.message).slice(0, 60);
    const bareKeys = new Set((bare.v ? bare.v.findings : []).map(key));
    const invented = (good.v ? good.v.findings : []).filter(f => !bareKeys.has(key(f)));
    check('and it never ADDS a finding', 'no finding present with the register and absent without it',
      invented.length === 0, JSON.stringify(invented.map(key)));
  } else if (token) {
    /* THE FALLBACK IS NOT UNTESTED HERE, it is the only thing tested. With no
     * node:sqlite the register lookup returns nothing on every call, so this
     * asserts the documented safe direction: absent register => pre-2026-08-31
     * behaviour, and the hand file still answers. */
    const hand = JSON.parse(fs.readFileSync(path.join(SK, 'assets', 'naptan_localities.json'), 'utf8'));
    check('with no node:sqlite the hand gazetteer is still loaded', 'naptan_localities.json parses and carries CITY',
      !!(hand.localities && hand.localities.CITY), JSON.stringify(Object.keys(hand.localities || {})));
    check('and the terminus check still runs and still reports', 'a sanity terminus finding on 50, and a verdict',
      !!bare.v && sanityTerm(bare.v).length > 0,
      bare.v ? JSON.stringify(bare.v.summary && bare.v.summary.terminusCoverage) : 'no report');
  }
}

/* ------------------- 14. known-off: the four exclusion conventions (OA-259) */
console.log('\n14. known-off — a route the town has already ruled off is a decision to confirm, not news');
{
  /*
   * OA-259, 2026-09-06. Eight town files use four conventions to say "we know
   * about this route and deliberately do not draw it", and verify_report.js read
   * exactly one of them, only in the `servesTown:false` direction — so a
   * truthfully written exclusion was invisible and the route came back a
   * `missing-service` inclusion candidate on every run. Huntingdon's red team
   * named the same seven routes on both its runs at 89k–137k tokens an answer.
   *
   * THE FIXTURE ROUTE IS DISCOVERED, NOT TYPED. Case 12 already establishes that
   * the Wisbech fixture yields missing-service rows; which routes they are about
   * depends on that town's red team and its curation, both of which move. Taking
   * the route off the baseline run means this case cannot quietly stop testing
   * anything the day Wisbech's leads change — the same trap case 1 and case 10
   * record from the other side.
   *
   * DISCOVERY WAS NOT ENOUGH, and 2026-09-09 is when that showed. Discovering the
   * route protects against the lead CHANGING; it does nothing when there is no
   * lead at all, which is what SF-012 produced by deciding route 68 — Wisbech's
   * only one — into notOnLeaflet[]. The lead is now injected by construction and
   * still read off the baseline run, so both failure modes are covered.
   */
  const baseDir = stage('wisbech', 'ko-base');
  injectMissingService(baseDir);
  const base = verify(baseDir).v;
  const baseMs = (base ? base.findings : []).filter(f => f.category === 'missing-service');
  check('the fixture really produces a missing-service row to declare against', 'at least one missing-service finding',
    baseMs.length > 0, `${baseMs.length} — without one this case proves nothing`);
  const R = baseMs.length ? baseMs[0].route : null;

  const REASON = 'FIXTURE REASON — injected by prove-s6-checks.js, not a real ruling about this route';
  const declare = (name, field, entry) => {
    const d = stage('wisbech', name);
    injectMissingService(d);
    const vs = readJ(d, 'verified-services.json');
    vs[field] = [...(vs[field] || []), entry];
    writeJ(d, 'verified-services.json', vs);
    return verify(d).v;
  };
  const rows = (v, cat, route) => (v ? v.findings : []).filter(f =>
    f.category === cat && (route === undefined || f.route === route));

  // THE QUIET ARM, once per convention. All four must reach the same answer,
  // because the whole complaint was that they did not.
  for (const field of ['notOnLeaflet', 'verifiedNotDisplayed', 'notDisplayed', 'excluded']) {
    const v = R ? declare(`ko-${field}`, field, { route: R, reason: REASON }) : null;
    check(`${field} is read`, `route ${R} is no longer a missing-service inclusion candidate`,
      !!v && rows(v, 'missing-service', R).length === 0,
      v ? JSON.stringify(rows(v, 'missing-service', R).map(f => f.severity)) : 'no report');
    check(`${field} still REPORTS, carrying the town's own words`, `a soft known-off on ${R} quoting the recorded reason`,
      !!v && rows(v, 'known-off', R).some(f => f.severity === 'soft' && String(f.message).includes(REASON)),
      v ? JSON.stringify(rows(v, 'known-off', R).map(f => f.severity + ': ' + String(f.message).slice(0, 70))) : 'no report');
  }

  /*
   * THE CONTROL, and it is one arm rather than four because counting the OTHER
   * missing-service rows is not one here: Wisbech's fixture yields exactly one
   * lead, so "the others are unchanged" would be 0 against 0 and would hold for
   * a checker that deleted every finding it saw. Declaring a route nobody has
   * mentioned is the control that cannot be vacuous — the row it must NOT touch
   * is the one row that exists.
   */
  if (R) {
    const unrelated = declare('ko-unrelated', 'notDisplayed', { route: 'ZZ99', reason: REASON });
    check('declaring an unrelated route silences nothing', `the missing-service row on ${R} survives it`,
      !!unrelated && rows(unrelated, 'missing-service', R).length === 1 && rows(unrelated, 'known-off', R).length === 0,
      unrelated ? JSON.stringify(rows(unrelated, 'missing-service').concat(rows(unrelated, 'known-off')).map(f => f.severity + '/' + f.category + '/' + f.route)) : 'no report');
  }

  /*
   * LOUD ARM 1 — the mute button. A declaration over a route the sheet DRAWS is
   * HARD, and the red team is not consulted: the drawn set alone settles it.
   * Route 50 is drawn by Wisbech (case 11 drives its days off the same fixture),
   * and the assertion below proves the fixture really draws it rather than
   * assuming so.
   */
  const drawnV = declare('ko-abuse', 'notDisplayed', { route: '50', reason: REASON });
  check('declaring a route the sheet DRAWS is HARD', 'hard known-off on 50, naming the drawn stop count',
    !!drawnV && rows(drawnV, 'known-off', '50').some(f => f.severity === 'hard' && /\d+ stops/.test(f.message)),
    drawnV ? JSON.stringify(rows(drawnV, 'known-off', '50').map(f => f.severity + ': ' + String(f.message).slice(0, 80))) : 'no report');

  /*
   * LOUD ARM 2 — the precedence that must NOT change. `notOnLeaflet` with
   * `servesTown:false` had the one reader S6 already possessed, and it raises
   * the louder `serves-town-conflict`. Folding it into known-off would have
   * demoted an existing finding to a quieter one while appearing to add a
   * feature, which is the worst kind of regression this harness can catch.
   */
  if (R) {
    const notServeV = declare('ko-notserve', 'notOnLeaflet', { route: R, servesTown: false, reason: REASON });
    check('servesTown:false keeps its louder finding', `serves-town-conflict on ${R}, and no known-off`,
      !!notServeV && rows(notServeV, 'serves-town-conflict', R).length > 0 && rows(notServeV, 'known-off', R).length === 0,
      notServeV ? JSON.stringify(rows(notServeV, 'serves-town-conflict', R).concat(rows(notServeV, 'known-off', R)).map(f => f.severity + '/' + f.category)) : 'no report');
  }

  /*
   * LOUD ARM 3 — an entry that names no route. Beaconsfield's `notDisplayed`
   * carries a `{group: "Dedicated school services"}` block. It is a reasonable
   * thing for a person to write and nothing can match a route against it, so it
   * must be reported and must silence nothing.
   */
  const groupV = declare('ko-group', 'notDisplayed', { group: 'Dedicated school services', reason: REASON });
  check('an entry naming a CLASS rather than a route is reported', 'a soft known-off quoting the group name',
    !!groupV && rows(groupV, 'known-off').some(f => f.severity === 'soft' && /Dedicated school services/.test(f.message)),
    groupV ? JSON.stringify(rows(groupV, 'known-off').map(f => f.severity + ': ' + String(f.message).slice(0, 70))) : 'no report');
  check('and it silences nothing', `all ${baseMs.length} missing-service row(s) survive it`,
    !!groupV && rows(groupV, 'missing-service').length === baseMs.length,
    groupV ? `${rows(groupV, 'missing-service').length} vs ${baseMs.length}` : 'no report');
}

/* -------------------- 15. a SLASHED red-team route (OA-262 item 2) */
console.log('\n15. Slashed route keys — `18/18A` is our 18, and a slashed route we really lack still fires');
{
  /*
   * `baseRoute` strips a bracketed BRAND and left a slashed VARIANT LIST alone,
   * so a red team writing `18/18A` keyed on a name no town has ever carried. The
   * town that pays for it draws 18 and declares 18A a `subServices` variant in
   * the SAME FILE, and got told 18/18A was missing AND that its own 18 was
   * unconfirmed — one route, two findings, disagreeing with each other.
   *
   * The fixture is not injected: the St Neots red team really does write
   * `18/18A`, on both stored runs. So the case ASSERTS that assumption rather
   * than trusting it, and dies loudly if a future answer stops exhibiting it.
   */
  const d = stage('stneots', 'slash-quiet');
  const rt0 = readJ(d, 'redteam.json');
  if (!(rt0.services || []).some(s => String(s.route) === '18/18A')) {
    throw new Error('fixture assumption broken: the St Neots redteam.json no longer writes `18/18A` — find another slashed key, do not delete the case');
  }
  const v0 = readJ(d, 'verified-services.json');
  if (!(v0.services || []).some(s => String(s.route) === '18')) {
    throw new Error('fixture assumption broken: St Neots no longer carries route 18');
  }
  const a = verify(d);
  const slashRows = (a.v ? a.v.findings : []).filter(f => f.category === 'missing-service' && String(f.route).indexOf('18') === 0);
  check('a slashed red-team key pairs with the route we carry', 'no missing-service on 18/18A',
    a.v && slashRows.length === 0,
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'missing-service').map(f => f.route)) : 'no report');
  check('and our own route is not then reported unconfirmed', 'no not-confirmed on 18',
    a.v && !has(a.v, 'soft', 'not-confirmed', '18'),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.route === '18').map(f => f.severity + '/' + f.category)) : 'no report');

  /*
   * THE ARM THAT MATTERS. Widening a MATCH silences findings, so the failure mode
   * of this fix is a `missing-service` that quietly stops firing — and a route
   * whose number merely contains a slash must still be reported, under the name
   * the red team wrote rather than under half of it.
   */
  const c = stage('stneots', 'slash-loud');
  const rt = readJ(c, 'redteam.json');
  rt.services.push({ route: '77/77A', operator: 'Whippet Coaches', servesTown: true,
    termini: ['St Neots', 'Nowhere'], days: 'Mon-Sat', confidence: 'high',
    notes: 'INJECTED BY prove-s6-checks.js — not a real service. A slashed key neither of whose halves we carry must still be reported.' });
  writeJ(c, 'redteam.json', rt);
  const b = verify(c);
  check('a slashed route we really do not carry still fires', 'missing-service on 77/77A',
    has(b.v, 'soft', 'missing-service', '77/77A'),
    b.v ? JSON.stringify(b.v.findings.filter(f => f.category === 'missing-service').map(f => f.route)) : 'no report');

  /*
   * AN EXACT KEY MUST OUTRANK A SLASHED NEAR-MISS. This is the guarantee the
   * SECOND PASS exists to give: a widened index would let the two compete on Map
   * insertion order, which is not a rule at all.
   *
   * The fixture puts both in front of it -- the red team's real `18/18A` plus an
   * injected exact `18`, same operator, with days nothing else could produce --
   * and asserts the DAYS finding quotes the exact entry. If pairing ever prefers
   * the slashed one, the quoted days change and this goes red.
   *
   * A NOTE ON WHAT IS DELIBERATELY *NOT* CHECKED HERE. A slash also appears
   * inside a BRAND -- `61EY (St Neots/Eynesbury Town Shuttle)`, and High Wycombe
   * Aldi's `the airline (badged LGW/LHR/OXF)`; nine of twenty maps carry a
   * slashed key and two of those slashes are brand-internal. `routeKeys` calls
   * `baseRoute` FIRST so the bracket goes before the split, but a case asserting
   * that CANNOT FAIL and was removed after being written: pass 1 pairs 61EY on
   * the bracket-stripped key before any slash logic runs, so the assertion stayed
   * green with the split deliberately broken to operate on the raw string. A
   * check that cannot go red is worse than no check, because it reads like cover.
   */
  const c2 = stage('stneots', 'slash-exact-wins');
  const rt2 = readJ(c2, 'redteam.json');
  const slashed18 = (rt2.services || []).find(s => String(s.route) === '18/18A');
  if (!slashed18) throw new Error('fixture assumption broken: no `18/18A` in the St Neots redteam.json');
  const ODD = 'Sun only (INJECTED BY prove-s6-checks.js)';
  rt2.services.push({ route: '18', operator: slashed18.operator, servesTown: true,
    termini: slashed18.termini, days: ODD, confidence: 'high',
    notes: 'INJECTED BY prove-s6-checks.js — the EXACT key, which must outrank the slashed one beside it.' });
  writeJ(c2, 'redteam.json', rt2);
  const e = verify(c2);
  const daysRow = (e.v ? e.v.findings : []).find(f => f.category === 'days' && f.route === '18');
  check('an exact red-team key outranks a slashed near-miss', `the days finding on 18 quotes the EXACT entry ("${ODD}")`,
    !!daysRow && String(daysRow.evidence && daysRow.evidence.redteam) === ODD,
    daysRow ? JSON.stringify(daysRow.evidence) : 'no days finding on 18');
}

/* ------- 16. serves-town says what is true of THIS sheet (OA-262 item 1) */
console.log('\n16. serves-town — "we include it" only where a sheet actually draws it');
{
  /*
   * The message asserted "but we include it" on any servesTown disagreement,
   * whether or not the sheet drew the route, and sat directly above its own
   * evidence block reading `displayed: false, drawnStops: 0`. That sentence put a
   * false claim into the backlog for a fortnight, and no verdict was ever wrong —
   * so only a case that reads the MESSAGE can hold the fix in place.
   */
  const drawnCase = stage('wisbech', 'serves-drawn');
  injectServesTownFalse(drawnCase, 'T7');
  const a = verify(drawnCase);
  const fa = (a.v ? a.v.findings : []).find(f => f.category === 'serves-town' && f.route === 'T7');
  check('a route the sheet DRAWS still says we include and draw it', 'message says "we include it and draw it"',
    !!fa && /we include it and draw it/.test(fa.message), fa ? fa.message.slice(0, 120) : 'no serves-town finding on T7');
  /* SEVERITY FOLLOWS THE SHEET (Peter, 2026-09-06, OA-004 q5). Drawn blocks; the
   * pair below asserts both halves, because a change that made everything soft
   * would pass the undrawn half on its own. */
  check('and a DRAWN route still BLOCKS', 'the T7 serves-town finding is hard',
    !!fa && fa.severity === 'hard', fa ? fa.severity : 'no finding');

  /*
   * The other state, BUILT rather than borrowed: a route in our verified set that
   * no sheet draws. Wisbech's X46 is verified and absent from routeOrder and
   * palette; the case finds such a route, asserts one exists, and sets
   * servesTown itself — so it proves the wording even after somebody adjudicates
   * X46 one way or the other.
   */
  const undrawn = stage('wisbech', 'serves-undrawn');
  const rj = readJ(undrawn, 'routes.json');
  const drawn = new Set([...(rj.routeOrder || []), ...Object.keys(rj.palette || {})]);
  const vj = readJ(undrawn, 'verified-services.json');
  const off = (vj.services || []).find(s => !drawn.has(String(s.route)));
  if (!off) throw new Error('fixture assumption broken: every Wisbech verified service is now drawn — pick another town, do not delete the case');
  const R = String(off.route);
  off.servesTown = true;
  writeJ(undrawn, 'verified-services.json', vj);
  const rt = readJ(undrawn, 'redteam.json');
  rt.excluded = (rt.excluded || []).filter(e => String(e.route) !== R);
  rt.excluded.push({ route: R, operator: off.operator, servesTown: false,
    reason: 'INJECTED BY prove-s6-checks.js — not a real claim about this route.' });
  rt.services = (rt.services || []).filter(s => String(s.route) !== R);
  writeJ(undrawn, 'redteam.json', rt);
  const b = verify(undrawn);
  const fb = (b.v ? b.v.findings : []).find(f => f.category === 'serves-town' && f.route === R);
  check('the finding is still RAISED, not silenced', 'a serves-town finding exists on ' + R,
    !!fb, b.v ? JSON.stringify(b.v.findings.filter(f => f.route === R).map(f => f.severity + '/' + f.category)) : 'no report');
  check('but an UNDRAWN route does not block', `the ${R} serves-town finding is soft`,
    !!fb && fb.severity === 'soft', fb ? fb.severity : 'no finding');
  check('and the run therefore PASSES on it', 'exit 0, verdict pass',
    b.code === 0 && b.v && b.v.summary.pass === true,
    b.v ? `exit ${b.code}, verdict ${b.v.summary.verdict}, hard ${b.v.summary.hard}` : `exit ${b.code}, no report`);
  check('a route no sheet draws (' + R + ') is not described as included', 'message does NOT claim we include it',
    !!fb && !/we include it/.test(fb.message), fb ? fb.message.slice(0, 140) : 'no serves-town finding on ' + R);
  check('and it says what IS true — nothing here draws it', 'message says no sheet draws it, evidence displayed:false',
    !!fb && /No sheet here draws it/.test(fb.message) && fb.evidence && fb.evidence.ours.displayed === false,
    fb ? JSON.stringify({ m: fb.message.slice(0, 90), d: fb.evidence && fb.evidence.ours }) : 'no finding');
}

/* ---------------- 17. a STYLED corridor family (OA-249) */
console.log('\n17. Corridor families — a styled family keeps its colours, and the finding must say so');
{
  /*
   * Since OA-176 4.24 an `internalCorridors` entry may be `{routes,style}`, and
   * for a styled family "the rest draws as a second same-coloured line going
   * elsewhere" is the one thing that is NOT true — every member keeps its own
   * colour. Ramsey v3.7's F003 read that way on the 303/305 pair that was built
   * to keep both colours.
   *
   * corridors_report.json is an S4 output and `stage()` seeds S1/S2/S3 only, so
   * the report is BUILT here — which is what this harness's own rule asks for,
   * and lets ONE run carry a styled family and a plain one side by side. Ramsey's
   * config really does style 303 and leave 301 bare; the case asserts both.
   */
  const report = {
    town: 'Ramsey', measure: 'INJECTED BY prove-s6-checks.js', sharedMin: 0.6,
    families: [
      { lead: '303', routes: ['303', '305'], weakMembers: ['303'],
        members: [{ route: '303', drawn: true, cells: 58, sharedFraction: 0.362, weakestAgainst: '305' },
                  { route: '305', drawn: true, cells: 22, sharedFraction: 0.955, weakestAgainst: '303' }] },
      { lead: '301', routes: ['301', '301S'], weakMembers: ['301S'],
        members: [{ route: '301', drawn: true, cells: 21, sharedFraction: 1, weakestAgainst: null },
                  { route: '301S', drawn: true, cells: 9, sharedFraction: 0.31, weakestAgainst: '301' }] },
    ],
    colours: { drawnLines: 7, distinctColours: 7, ambiguity: 1, corridorPalette: false },
  };
  const d = stage('ramsey', 'corr-styled');
  const rj = readJ(d, 'routes.json');
  const ic = rj.internalCorridors || {};
  if (!ic['303'] || Array.isArray(ic['303']) || ic['303'].style !== 'alternate') {
    throw new Error('fixture assumption broken: Ramsey no longer styles the 303 family — restyle another family or move the case, do not delete it');
  }
  if (!Array.isArray(ic['301'])) throw new Error('fixture assumption broken: Ramsey 301 is no longer a bare (unstyled) family');
  writeJ(d, 'corridors_report.json', report);
  const a = verify(d);
  const rowsOf = (v, lead) => (v ? v.findings : []).filter(f => f.category === 'weak-corridor-bundle' && f.route === lead);
  const styled = rowsOf(a.v, '303')[0], plain = rowsOf(a.v, '301')[0];
  check('a styled family is still REPORTED', 'a soft weak-corridor-bundle on 303',
    !!styled && styled.severity === 'soft', styled ? styled.severity : 'no finding');
  check('but not as a second same-coloured line', 'message drops the same-coloured wording',
    !!styled && !/second same-coloured line/.test(styled.message), styled ? styled.message.slice(0, 140) : 'no finding');
  check('and it names the style and the shared fraction', 'message quotes "alternate" and 36%',
    !!styled && /alternate/.test(styled.message) && /36%/.test(styled.message), styled ? styled.message.slice(0, 200) : 'no finding');
  check('the style reaches the evidence too', 'evidence.style === "alternate"',
    !!styled && styled.evidence && styled.evidence.style === 'alternate',
    styled ? JSON.stringify(styled.evidence && styled.evidence.style) : 'no finding');

  /* THE ARM THAT MATTERS, and it is in the SAME run: an unstyled family with an
   * equally weak member must still get the original wording. A fix that simply
   * softened this finding for everybody would pass every check above. */
  check('an unstyled family in the same run still says same-coloured', 'the 301 row keeps the original wording',
    !!plain && /second same-coloured line/.test(plain.message), plain ? plain.message.slice(0, 140) : 'no finding on 301');

  /* And the same family with its style REMOVED reverts — so the wording is keyed
   * on the config, not on the route number. */
  const c = stage('ramsey', 'corr-unstyled');
  const cj = readJ(c, 'routes.json');
  cj.internalCorridors['303'] = ['305'];
  writeJ(c, 'routes.json', cj);
  writeJ(c, 'corridors_report.json', report);
  const b = verify(c);
  const reverted = rowsOf(b.v, '303')[0];
  check('removing the style brings the same-coloured wording back', 'the 303 row reverts to the bundle wording',
    !!reverted && /second same-coloured line/.test(reverted.message), reverted ? reverted.message.slice(0, 140) : 'no finding');
}
/* ------- 18. a PLACE can now say "known, and deliberately off" (OA-262 item 3) */
console.log('\n18. Place exclusions — notOnLeaflet[] declared in a place\'s routes.json reaches the report');
{
  /*
   * Until 2026-09-06 a place had nowhere to record that a route serving the parent
   * town is knowingly off this sheet, so an adjudication made once came back as an
   * inclusion candidate on every later run. Measured across the estate that day:
   * 86 missing-service findings over nine places, 53 of them a borrowed answer's
   * superset (already labelled), and 33 on places that BOUGHT their own answer.
   *
   * Peter's decision was the SAME field rather than a fifth convention, so
   * `place_verified_services.js` carries `notOnLeaflet[]` through from the place's
   * S3 routes.json into the verified-services.json it builds, where known_off.js
   * reads it exactly as it reads a town's.
   *
   * The route is not hard-coded: the case takes whatever the place's own run
   * reports as a missing-service and declares THAT, so it keeps working when the
   * fixture's data moves. It throws if there is none, rather than passing on a
   * declaration that silences nothing.
   */
  const base = stage('place', 'place-known-off-base');
  const a0 = verify(base);
  const missing = (a0.v ? a0.v.findings : []).filter(f => f.category === 'missing-service');
  if (!missing.length) {
    throw new Error('fixture assumption broken: the place run reports no missing-service, so there is nothing for a declaration to convert — pick another place, do not delete the case');
  }
  const R = String(missing[0].route);
  const REASON = 'INJECTED BY prove-s6-checks.js — a place-level decision, not a real one.';

  const d = stage('place', 'place-known-off');
  const rj = readJ(d, 'routes.json');
  rj.notOnLeaflet = [{ route: R, reason: REASON, servesTown: true }];
  writeJ(d, 'routes.json', rj);
  /* Rebuild verified-services.json so the adapter sees the declaration: stage()
   * runs the adapter only when the file is absent, and it wrote one already. */
  fs.rmSync(path.join(d, 'verified-services.json'), { force: true });
  const adapter = path.join(SK, '..', 'make-place-bus-leaflet', 'assets', 'place_verified_services.js');
  const ar = spawnSync(process.execPath, [adapter], { cwd: d, encoding: 'utf8' });
  if (ar.status !== 0) throw new Error(`place adapter failed:\n${ar.stdout}${ar.stderr}`);

  check('the adapter carries the declaration into verified-services.json', `notOnLeaflet names ${R}`,
    (readJ(d, 'verified-services.json').notOnLeaflet || []).some(e => String(e.route) === R),
    JSON.stringify(readJ(d, 'verified-services.json').notOnLeaflet || null));

  const a = verify(d);
  check('and the lead becomes a known-off carrying the place\'s own words', `soft known-off on ${R} quoting the reason`,
    a.v && a.v.findings.some(f => f.category === 'known-off' && String(f.route) === R
      && f.severity === 'soft' && new RegExp(REASON.slice(0, 30)).test(f.message)),
    a.v ? JSON.stringify(a.v.findings.filter(f => String(f.route) === R).map(f => f.severity + '/' + f.category)) : 'no report');
  check('it is no longer reported as news', `no missing-service on ${R}`,
    a.v && !a.v.findings.some(f => f.category === 'missing-service' && String(f.route) === R),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'missing-service').map(f => f.route)) : 'no report');

  /* THE ARM THAT MATTERS. A declaration must silence ONLY what it names -- the
   * whole risk of this change is a place quietly muting its own inclusion leads. */
  const others = missing.map(f => String(f.route)).filter(x => x !== R);
  check('and it silences nothing else', `the other ${others.length} missing-service row(s) survive`,
    a.v && others.every(x => a.v.findings.some(f => f.category === 'missing-service' && String(f.route) === x)),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'missing-service').map(f => f.route)) : 'no report');
}
/* ---- 19. a SECOND red-team entry on a route we carry (OA-274 fault 1) */
console.log('\n19. Two red-team entries, one route number — the second is an operator disagreement, not a missing service');
{
  /*
   * Ely Co-op's blind answer wrote route 9 twice, Stagecoach East and A2B Bus and
   * Coach. The pairing is one-to-one, so our single route 9 took one and the other
   * fell through as "absent from our verified set -- inclusion candidate" about a
   * route the sheet draws: the report contradicting its own inputs.
   *
   * The fault is INJECTED rather than borrowed. Ely Co-op's own run is the recorded
   * instance, but a fixture whose subject is whatever the estate happens to be
   * wrong about today is one that curation retires -- which is exactly what SF-012
   * did to route 68 and 12 checks in this file on 2026-09-09. So the case picks
   * whatever route this fixture already pairs on, asserts that it does, and adds a
   * second entry naming an operator nothing runs.
   */
  const d = stage('wisbech', 's19-second-operator');
  const vs = readJ(d, 'verified-services.json');
  const rt = readJ(d, 'redteam.json');
  const ourRoutes = new Set((vs.services || []).map(s => String(s.route).toUpperCase()));
  const paired = (rt.services || []).map(s => String(s.route).toUpperCase()).find(r => ourRoutes.has(r));
  if (!paired) throw new Error('fixture assumption broken: the Wisbech red team and our verified set no longer name any route in common, so there is nothing for a SECOND entry to be second to — pick another fixture, do not delete the case');
  const OP = 'Nonesuch Coaches Ltd';

  // CONTROL FIRST: unmutated, this route is paired and quiet in both categories.
  const a0 = verify(d);
  check('the fixture pairs the route before anything is injected', `no missing-service and no operator finding on ${paired}`,
    a0.v && !a0.v.findings.some(f => String(f.route) === paired && (f.category === 'missing-service' || f.category === 'operator')),
    a0.v ? JSON.stringify(a0.v.findings.filter(f => String(f.route) === paired).map(f => f.severity + '/' + f.category)) : 'no report');

  const rt2 = readJ(d, 'redteam.json');
  rt2.services.push({ route: paired, operator: OP, servesTown: true,
    termini: ['Wisbech Horsefair Bus Station', 'Nowhere In Particular'], days: 'Mon-Sat', confidence: 'medium',
    notes: 'INJECTED BY prove-s6-checks.js — not a real claim about any route. The case needs a SECOND entry on an already-paired route to exist by construction.' });
  writeJ(d, 'redteam.json', rt2);
  /* THE LOUD ARM IN THE SAME RUN: a route we genuinely do not carry must still be
   * reported. Widening the lookup SILENCES findings, so this control is the whole
   * reason the change is safe to make. */
  const LEAD = injectMissingService(d);
  const a = verify(d);

  check('a second entry on a route we draw is not reported as missing', `no missing-service on ${paired}`,
    a.v && !a.v.findings.some(f => f.category === 'missing-service' && String(f.route) === paired),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'missing-service').map(f => f.route)) : 'no report');
  check('it reaches the operator arm instead', `a soft operator finding on ${paired} naming "${OP}"`,
    a.v && a.v.findings.some(f => f.severity === 'soft' && f.category === 'operator'
      && String(f.route) === paired && f.message.includes(OP)),
    a.v ? JSON.stringify(a.v.findings.filter(f => String(f.route) === paired).map(f => f.severity + '/' + f.category)) : 'no report');
  check('and the row says which side is which', 'the evidence carries our operator(s) and theirs',
    a.v && a.v.findings.some(f => f.category === 'operator' && String(f.route) === paired
      && f.evidence && f.evidence.secondEntry === true && f.evidence.redteam === OP
      && Array.isArray(f.evidence.ours)),
    a.v ? JSON.stringify((a.v.findings.find(f => f.category === 'operator' && String(f.route) === paired) || {}).evidence || null) : 'no report');
  check('a route we really do not carry still fires', `missing-service on ${LEAD}`,
    has(a.v, 'soft', 'missing-service', LEAD),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'missing-service').map(f => f.route)) : 'no report');
}
/* ---- 20. a PLACE's declaration beats its own inference (OA-274 fault 2) */
console.log('\n20. servesTown — a place\'s notOnLeaflet declaration outranks the stop-presence inference');
{
  /*
   * `place_verified_services.js` writes `servesTown: true` on every service,
   * because its whole input is "routes with a stop inside the walkshed" -- an
   * INFERENCE. A `notOnLeaflet[]` entry saying `servesTown: false` is a DECISION,
   * and the two used to disagree silently: the declaration reached known_off.js
   * while the inferred true stayed in services[], so verify_report's
   * `if (isDisplayed || vs.servesTown)` guard kept firing. Ely Co-op's AJ2 --
   * adjudicated 2026-09-08 as register entry SF-003 -- came back every run.
   *
   * Wholly injected, on a route number nothing carries, so nothing about this case
   * depends on what any place happens to draw today.
   */
  const R = 'ZZ9', OP = 'Nonesuch Coaches Ltd';
  const REASON = 'INJECTED BY prove-s6-checks.js — a place-level decision, not a real one.';
  /* Build a staged place dir carrying a synthetic undrawn service the red team
   * says does not serve the town. `decl` is what goes in notOnLeaflet[], or null
   * for the no-declaration control. */
  const build = (name, decl) => {
    const d = stage('place', name);
    const g = readJ(d, 'gtfs-services.json');
    if ((g.services || []).some(s => String(s.route).toUpperCase() === R)) throw new Error(`fixture assumption broken: the place now carries a real route ${R} — pick another absent number, do not delete the case`);
    const rj = readJ(d, 'routes.json');
    const drawn = new Set([...(rj.routeOrder || []), ...Object.keys(rj.palette || {})]);
    if (drawn.has(R)) throw new Error(`fixture assumption broken: route ${R} is now DRAWN by the place config`);
    g.services.push({ route: R, operator: OP, days: 'Mon-Fri', termini: ['Nowhere In Particular'], headsigns: [] });
    writeJ(d, 'gtfs-services.json', g);
    if (decl) { rj.notOnLeaflet = [decl]; writeJ(d, 'routes.json', rj); }
    const rt = readJ(d, 'redteam.json');
    rt.excluded = (rt.excluded || []).concat([{ route: R, operator: OP, servesTown: false,
      reason: 'INJECTED BY prove-s6-checks.js — not a real claim about any route.' }]);
    writeJ(d, 'redteam.json', rt);
    // Rebuild verified-services.json so the adapter sees both the new service and
    // the declaration: stage() runs the adapter only when the file is absent.
    fs.rmSync(path.join(d, 'verified-services.json'), { force: true });
    const adapter = path.join(SK, '..', 'make-place-bus-leaflet', 'assets', 'place_verified_services.js');
    const ar = spawnSync(process.execPath, [adapter], { cwd: d, encoding: 'utf8' });
    if (ar.status !== 0) throw new Error(`place adapter failed:\n${ar.stdout}${ar.stderr}`);
    return d;
  };
  const stFor = (d) => {
    const e = (readJ(d, 'verified-services.json').services || []).find(s => String(s.route).toUpperCase() === R);
    return e ? e.servesTown : 'absent';
  };
  const stRows = (v) => (v ? v.findings : []).filter(f => f.category === 'serves-town' && String(f.route) === R);

  // CONTROL: undeclared, the finding fires. Without this the case cannot go red.
  const base = build('s20-undeclared', null);
  const b = verify(base);
  check('the adapter still infers servesTown from stop presence', `${R} is servesTown:true when nothing declares otherwise`,
    stFor(base) === true, String(stFor(base)));
  check('and the serves-town finding fires', `a serves-town finding on ${R}`,
    stRows(b.v).length === 1, JSON.stringify(stRows(b.v).map(f => f.severity)) + ' / ' + (b.v ? 'report' : 'no report'));

  // THE CASE: an explicit servesTown:false is a decision, and it wins.
  const decl = build('s20-declared-false', { route: R, reason: REASON, servesTown: false });
  const c = verify(decl);
  check('an explicit servesTown:false reaches the services[] entry', `${R} is servesTown:false in verified-services.json`,
    stFor(decl) === false, String(stFor(decl)));
  check('and the finding stops being re-raised', `no serves-town finding on ${R}`,
    stRows(c.v).length === 0, JSON.stringify(stRows(c.v).map(f => f.severity + '/' + f.message.slice(0, 60))));

  /*
   * THE ARM THAT MATTERS. This change writes `false` over an inference, so its
   * failure mode is a place quietly disclaiming every route it declares off --
   * and the commoner declaration is a route that really does call here and is
   * simply not drawn (Ely Co-op's TIGERONDEMAND). A declaration with no
   * `servesTown` key must change nothing.
   */
  const silent = build('s20-declared-silent', { route: R, reason: REASON });
  const s = verify(silent);
  check('a declaration that says nothing about servesTown changes nothing', `${R} is still servesTown:true`,
    stFor(silent) === true, String(stFor(silent)));
  check('and the serves-town finding still fires on it', `a serves-town finding on ${R} survives the declaration`,
    stRows(s.v).length === 1, JSON.stringify(stRows(s.v).map(f => f.severity)));
}
console.log('\n' + '='.repeat(78));
console.log(failures
  ? `FAILED — ${failures} of ${run} checks did not hold`
  : `OK — all ${run} checks held: every fixed check is quiet on its artefact and loud on a real fault`);
if (KEEP) console.log('temp dirs kept at ' + TMP);
else fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
