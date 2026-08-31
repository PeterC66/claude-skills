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

const SK = path.join(__dirname, '..');
const VERIFY = path.join(SK, 'assets', 'verify_report.js');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
/* --keep means the scratch is EVIDENCE: switch off scratch.js's exit sweep, or
 * the paths printed below would name directories that no longer exist. */
if (KEEP) require('../assets/scratch').keepScratch();
const bi = argv.indexOf('--buses');
const BUSES = (bi >= 0 && argv[bi + 1]) ? argv[bi + 1] : 'C:/u3a St Ives/Using AI/Buses';

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
  const d = stage('wisbech', 'trunc');
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
  const full = readJ(c, 'routes_full_atco.json'), ll = readJ(c, 'atco2ll.json');
  const dirs = full.excel.directions ? Object.values(full.excel.directions) : full.excel.canonical;
  const outsider = '0500HTYDD001';            // Tydd, a locality that is not Wisbech
  ll[outsider] = [52.73, 0.15];
  dirs[0].stops.push(outsider);
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
  const a = verify(d);
  check('a branded red-team route is not double-counted', 'no missing-service whose route holds a bracket',
    a.v && !a.v.findings.some(f => f.category === 'missing-service' && /[()]/.test(String(f.route))),
    a.v ? JSON.stringify(a.v.findings.filter(f => f.category === 'missing-service').map(f => f.route)) : 'no report');
  check('and it is not also reported as unconfirmed', 'no not-confirmed on route 46',
    a.v && !has(a.v, 'soft', 'not-confirmed', '46'), 'found');
  check('both same-numbered routes are checked, on their own keys', 'a finding carrying route 46L',
    a.v && a.v.findings.some(f => f.route === '46L'), 'none');

  // A service the red team really did find and we really do not carry must still
  // be reported. Wisbech's 68 (FACT) is exactly that, and is the highest-value
  // output of the stage.
  check('a genuinely missing service still fires', 'missing-service on route 68',
    has(a.v, 'soft', 'missing-service', '68'),
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
  const own = verify(stage('wisbech', 'ms-own')).v;
  const ownMs = (own ? own.findings : []).filter(f => f.category === 'missing-service');
  check('the fixture really produces a missing-service row to begin with', 'at least one missing-service finding',
    ownMs.length > 0, `${ownMs.length} — without one this case proves nothing`);
  check('an answer bought for THIS map claims no borrow', 'supersetArtefactPossible false on every row',
    ownMs.every(f => f.evidence && f.evidence.supersetArtefactPossible === false && f.evidence.borrowedFrom === null),
    JSON.stringify(ownMs.map(f => f.evidence && f.evidence.borrowedFrom)));

  const d = stage('wisbech', 'ms-lent');
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

console.log('\n' + '='.repeat(78));
console.log(failures
  ? `FAILED — ${failures} of ${run} checks did not hold`
  : `OK — all ${run} checks held: every fixed check is quiet on its artefact and loud on a real fault`);
if (KEEP) console.log('temp dirs kept at ' + TMP);
else fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
