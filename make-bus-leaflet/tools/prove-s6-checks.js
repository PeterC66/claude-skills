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

const SK = path.join(__dirname, '..');
const VERIFY = path.join(SK, 'assets', 'verify_report.js');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
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
  //  a PLACE: no intown_cfg.json, so no in-town prefix and no buffer stops at all
  place: 'Areas/St Neots/Places/St Neots Town Centre/S6-verify/2026-08-21_1912',
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-s6-'));
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

/* ------------------------------------------------------------------ 4. truncated chain */
console.log('\n4. Truncated chain — a chain that never leaves town cannot contradict a terminus');
{
  const d = stage('wisbech', 'trunc');
  const a = verify(d);
  check('the truncated chain is SOFT, not HARD', 'soft terminus on EXCEL with truncatedChain',
    a.v && a.v.findings.some(f => f.route === 'EXCEL' && f.category === 'terminus' && f.severity === 'soft' && f.evidence.truncatedChain === true),
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
   */
  const base = stage('place', 'notshown-base');
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

console.log('\n' + '='.repeat(78));
console.log(failures
  ? `FAILED — ${failures} of ${run} checks did not hold`
  : `OK — all ${run} checks held: every fixed check is quiet on its artefact and loud on a real fault`);
if (KEEP) console.log('temp dirs kept at ' + TMP);
else fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
