#!/usr/bin/env node
/*
 * prove-red-rollout-stamp.js — falsify OA-179's third rollout verdict.
 *
 * Run from make-bus-leaflet:  node tools/prove-red-rollout-stamp.js
 * Optional: --buses "<dir>" to point at a different buses-data checkout. There
 * are no other arguments and no placeholders; the default is the real one on
 * this machine.
 *
 * WHAT IS BEING FALSIFIED. Until 2026-08-30 `rolloutOne()` returned UP-TO-DATE
 * whenever all four sheet gates passed, without ever reading `routes.json`'s
 * `engine` field — so on the day the template hash moved without moving the
 * artwork, `rollout.js --all` said seven towns needed nothing while `status.js`
 * said eight were ENGINE STALE and gating. The new STAMP-STALE verdict closes
 * that. It is a REPORTING change: it writes nothing and it does not move the
 * exit code, which means the ordinary board can never show it working, and the
 * whole estate is on the current engine today, which means it cannot be seen
 * firing by accident either. It has to be provoked.
 *
 * FOUR CASES, AND THREE OF THEM ARE CONTROLS. "Expect a red" on its own would
 * pass for a verdict that fired on everything.
 *
 *   A  stamp current            -> UP-TO-DATE      (the control: it must stay quiet)
 *   B  stamp is an old hash     -> STAMP-STALE     (the finding)
 *   C  no `engine` field at all -> UP-TO-DATE      (status.js reports '(none)'
 *                                                   and never gates it; this
 *                                                   verdict must not widen into
 *                                                   maps stamped before the hash
 *                                                   existed)
 *   D  stale stamp AND a sheet that really differs
 *                               -> anything but STAMP-STALE
 *
 * D IS THE ONE THAT MATTERS MOST and it is the reason this file is not three
 * assertions. The new test sits in front of the fast path, so a careless version
 * of it would answer STAMP-STALE for a town that also needs its sheets redrawn —
 * turning a rebuild into a report and losing the actual work. The condition is
 * guarded by the same `every(PASS)` the UP-TO-DATE return uses, and D is what
 * says so out loud. It is also the slow case: it is the only one that reaches a
 * real generator run.
 *
 * THE FIXTURE IS TRACKED FILES ONLY. It copies one town's `manifest.json`, its
 * latest `S3-config` run and its `ci-reference/` into a scratch tree — no
 * `S4-generate`, because `latestRunDir()` falls back to `ci-reference` when a
 * run folder holds no `routes.json`, which is exactly what a fresh CI clone
 * gets. So this harness runs in a checkout that has never built anything.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');
const { computeEngineVersion, computePlaceEngineVersion } = require('../assets/engine_version');
const { resolveBuses } = require('../assets/cli');

/*
 * STAMP THE FIXTURE WITH TODAY'S ENGINE, rather than borrowing whatever the estate
 * happens to carry (2026-08-31).
 *
 * Cases A and E are CONTROLS: "the stamp is untouched, so the verdict must be
 * UP-TO-DATE". They took the stamp from a real map's committed `ci-reference`, which
 * makes them a claim about the ESTATE — that the borrowed map is currently built on
 * the current engine — and not about the mechanism they exist to prove.
 *
 * It went red at 11:33 on 2026-08-31 and stayed red for every commit after, on a
 * step that had nothing to do with any of them. The POI change moved the PLACE
 * template hash to `cfc8e820e8` while all twelve places are stamped `76cfef4804`,
 * so case E's control reported STAMP-STALE — correctly, about the estate — and case
 * F's assertion about which hash is quoted failed for the same reason. Nothing was
 * wrong with rollout_places.js.
 *
 * THIS IS THE THIRD TIME TODAY. `prove-red-status.js` had a case that depended on a
 * live staleness exception (fixed in August by building its own), and then its ANCHOR
 * and its DONOR TOWN still depended on today's estate and took buses-data CI down
 * this morning. The shape is *the remedy stopped one level short*: a fixture built
 * out of whatever the estate looks like today tests the estate, not the code.
 *
 * The town half is fixed too, and it is GREEN today — the eight towns happen to be
 * current. Leaving it would be leaving the same trap set for whenever the town
 * template next moves, which is the only reason the place half was ever red.
 */
function stampCurrent(routesPath, hash) {
  const j = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
  j.engine = hash;
  fs.writeFileSync(routesPath, JSON.stringify(j, null, 2));
}

const ROOT = path.join(__dirname, '..');
const ROLLOUT = path.join(ROOT, 'assets', 'rollout.js');
const argOf = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BUSES = resolveBuses({ buses: argOf('buses') });
const TOWN = argOf('town', 'Ramsey');

let failures = 0;
const fail = (m) => { console.error('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

/* ---- fixture ---------------------------------------------------------- */
const srcTown = path.join(BUSES, 'Areas', TOWN);
for (const need of ['manifest.json', 'ci-reference/routes.json', 'ci-reference/internal.svg']) {
  if (!fs.existsSync(path.join(srcTown, need))) {
    console.error(`prove-red-rollout-stamp: ${TOWN} has no ${need} under ${srcTown}.`);
    console.error('  Point at a checkout that has one with --buses "<dir>", or name another town with --town "<Town>".');
    process.exit(1);
  }
}

function buildFixture() {
  const tmp = scratchDir('prove-rollout-stamp-');
  const dst = path.join(tmp, 'Areas', TOWN);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(srcTown, 'manifest.json'), path.join(dst, 'manifest.json'));
  fs.cpSync(path.join(srcTown, 'ci-reference'), path.join(dst, 'ci-reference'), { recursive: true });
  // The S3 run rolloutOne() seeds a rebuild from. Case D is the only case that
  // reaches it, and a missing one would make D return SKIP — a pass for the
  // wrong reason.
  const man = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
  const s3 = man.stages && man.stages.S3;
  const rec = s3 && s3.runs && s3.runs.find((x) => x.id === s3.latest);
  if (!rec) { console.error('prove-red-rollout-stamp: no latest S3 run in the manifest.'); process.exit(1); }
  fs.cpSync(path.join(srcTown, rec.dir), path.join(dst, rec.dir), { recursive: true });
  stampCurrent(path.join(dst, 'ci-reference', 'routes.json'), computeEngineVersion());
  return tmp;
}

const routesOf = (tmp) => path.join(tmp, 'Areas', TOWN, 'ci-reference', 'routes.json');
function editRoutes(tmp, fn) {
  const p = routesOf(tmp);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(j);
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}

function runRollout(tmp) {
  const r = spawnSync(process.execPath, [ROLLOUT, '--buses', tmp, '--town', TOWN],
    { encoding: 'utf8', cwd: path.join(ROOT, 'assets') });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}
const verdict = (out) => {
  const m = out.match(new RegExp('^' + TOWN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.\\.\\. ([A-Z-]+)', 'm'));
  return m ? m[1] : '(no verdict line)';
};

/* ---- A: the control --------------------------------------------------- */
console.log(`\nA  ${TOWN}, stamp untouched — the control`);
{
  const tmp = buildFixture();
  const stamped = JSON.parse(fs.readFileSync(routesOf(tmp), 'utf8')).engine;
  const { out, code } = runRollout(tmp);
  const v = verdict(out);
  if (v !== 'UP-TO-DATE') fail(`expected UP-TO-DATE, got ${v}. A control that is not green means the fixture is wrong, not the code.\n${out}`);
  else pass(`UP-TO-DATE at engine ${stamped}`);
  if (!/and the engine stamp is current/.test(out)) fail('UP-TO-DATE no longer says the stamp was checked — the detail line is the only place a reader learns it was.');
  else pass('the detail line says the stamp was checked');
  if (code !== 0) fail(`exit ${code}, expected 0`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- B: the finding --------------------------------------------------- */
console.log(`\nB  ${TOWN}, sheets unchanged, stamp rewritten to an old hash — the finding`);
{
  const OLD = '30fbffe221';            // the real pre-2026-08-30 template hash
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { j.engine = OLD; });
  const { out, code } = runRollout(tmp);
  const v = verdict(out);
  if (v !== 'STAMP-STALE') fail(`expected STAMP-STALE, got ${v}. This is the bug OA-179 is about: the sheets gate PASS and the stamp does not, and the tool called it UP-TO-DATE.\n${out}`);
  else pass('STAMP-STALE');
  // Name the phrase, not just the colour: a harness that accepts any red would
  // accept a crash. Both hashes and the command the operator has to type.
  if (!out.includes(OLD)) fail(`the message does not name the stale hash ${OLD}`);
  else pass('names the stale hash');
  if (!new RegExp(`node rollout\\.js --town "${TOWN}" --apply --force`).test(out))
    fail('the message does not name the --force command that clears it — the whole point of the verdict');
  else pass('names the --force command');
  if (!/draw the CURRENT sheets from an OLD engine stamp/.test(out)) fail('the summary block did not print');
  else pass('the summary block repeats it');
  // Deliberately exit 0: status.js is the board and already gates this.
  if (code !== 0) fail(`exit ${code}. STAMP-STALE is a report, not a gate — see the note in rolloutOne().`);
  else pass('exit 0, as designed');
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- C: the control that stops it widening ---------------------------- */
console.log(`\nC  ${TOWN}, no 'engine' field at all — must stay UP-TO-DATE`);
{
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { delete j.engine; });
  const { out } = runRollout(tmp);
  const v = verdict(out);
  if (v !== 'UP-TO-DATE') fail(`expected UP-TO-DATE, got ${v}. A map stamped before the hash existed is '(none)' — status.js reports it and never gates it, and these two tools have to agree.\n${out}`);
  else pass('UP-TO-DATE — an unstamped map is not a stale one');
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- D: the one that matters ------------------------------------------ */
console.log(`\nD  ${TOWN}, stale stamp AND a sheet that really differs — must NOT be STAMP-STALE  (slow: this one rebuilds)`);
{
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { j.engine = '30fbffe221'; });
  const svg = path.join(tmp, 'Areas', TOWN, 'ci-reference', 'internal.svg');
  const before = fs.readFileSync(svg, 'utf8');
  fs.writeFileSync(svg, before.replace('</svg>', '<!-- prove-red-rollout-stamp: forced DIFF --></svg>'));
  if (fs.readFileSync(svg, 'utf8') === before) fail('could not force a DIFF into internal.svg — D proves nothing.');
  const { out } = runRollout(tmp);
  const v = verdict(out);
  if (v === 'STAMP-STALE') fail(`reported STAMP-STALE for a town whose internal sheet does not reproduce. The stamp test has escaped the every(PASS) guard, and a rebuild has been turned into a report.\n${out}`);
  else pass(`${v} — the stale stamp did not mask the sheet that needs redrawing`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- E and F: the place half -------------------------------------------
 *
 * `rollout_places.js` got the identical change and is a SEPARATE FILE with a
 * separate hash function — a place is measured against
 * computePlaceEngineVersion(), because a place gets its own template (OA-168)
 * and comparing a place against the town hash was a real bug. A harness that
 * proved the town half and left this one would be the "satisfied by the other
 * clause" shape: one fixture answering for two implementations.
 *
 * Only the control and the finding are repeated here. C and D exercise logic
 * that is line-for-line the same in both files; E and F exist to prove this
 * file's copy is wired up and reads the PLACE hash.
 */
const ROLLOUT_PLACES = path.join(ROOT, 'assets', 'rollout_places.js');
const PLACE = argOf('place', 'St Neots Co-op');
const PLACE_TOWN = argOf('place-town', 'St Neots');
const srcPlace = path.join(BUSES, 'Areas', PLACE_TOWN, 'Places', PLACE);

if (!fs.existsSync(path.join(srcPlace, 'ci-reference', 'routes.json'))) {
  fail(`no ci-reference/routes.json for the place ${PLACE} under ${srcPlace} — the place half is UNPROVEN, which is a failure, not a skip. Name another with --place / --place-town.`);
} else {
  function buildPlaceFixture() {
    const tmp = scratchDir('prove-rollout-stamp-p-');
    const townDst = path.join(tmp, 'Areas', PLACE_TOWN);
    fs.mkdirSync(townDst, { recursive: true });
    // findTowns() keys on the TOWN's manifest, and findPlaces() only walks
    // Places/ under a town it already found. Without this the place is invisible
    // and the run would exit 2 — a pass for the wrong reason.
    fs.copyFileSync(path.join(BUSES, 'Areas', PLACE_TOWN, 'manifest.json'), path.join(townDst, 'manifest.json'));
    const dst = path.join(townDst, 'Places', PLACE);
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(path.join(srcPlace, 'manifest.json'), path.join(dst, 'manifest.json'));
    fs.cpSync(path.join(srcPlace, 'ci-reference'), path.join(dst, 'ci-reference'), { recursive: true });
    const man = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
    const s3 = man.stages && man.stages.S3;
    const rec = s3 && s3.runs && s3.runs.find((x) => x.id === s3.latest);
    if (rec) fs.cpSync(path.join(srcPlace, rec.dir), path.join(dst, rec.dir), { recursive: true });
    stampCurrent(path.join(dst, 'ci-reference', 'routes.json'), computePlaceEngineVersion());
    return tmp;
  }
  const placeRoutes = (tmp) => path.join(tmp, 'Areas', PLACE_TOWN, 'Places', PLACE, 'ci-reference', 'routes.json');
  function runPlaces(tmp) {
    const r = spawnSync(process.execPath, [ROLLOUT_PLACES, '--buses', tmp, '--place', PLACE],
      { encoding: 'utf8', cwd: path.join(ROOT, 'assets') });
    return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
  }
  // rollout_places.js prefixes the progress line with the parent town —
  // "St Neots / St Neots Co-op... UP-TO-DATE" — where rollout.js prints the bare
  // name. A standalone place has no prefix, so the town half is optional.
  const placeVerdict = (out) => {
    const m = out.match(new RegExp('^(?:.* / )?' + PLACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.\\.\\. ([A-Z-]+)', 'm'));
    return m ? m[1] : '(no verdict line)';
  };

  console.log(`\nE  place ${PLACE}, stamp untouched — the control`);
  {
    const tmp = buildPlaceFixture();
    const { out } = runPlaces(tmp);
    const v = placeVerdict(out);
    if (v !== 'UP-TO-DATE') fail(`expected UP-TO-DATE, got ${v}. The place control is not green, so nothing case F says can be trusted.\n${out}`);
    else pass('UP-TO-DATE');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nF  place ${PLACE}, sheets unchanged, stamp rewritten to an old hash — the finding`);
  {
    const OLDP = 'a0a0a0a0a0';
    const tmp = buildPlaceFixture();
    const p = placeRoutes(tmp);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const wasPlaceHash = j.engine;
    j.engine = OLDP;
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const { out, code } = runPlaces(tmp);
    const v = placeVerdict(out);
    if (v !== 'STAMP-STALE') fail(`expected STAMP-STALE, got ${v}.\n${out}`);
    else pass('STAMP-STALE');
    if (!/current PLACE template/.test(out)) fail('the message does not say PLACE template — a place compared against the town hash is the OA-168 bug coming back');
    else pass('names the PLACE template');
    if (!new RegExp(`node rollout_places\\.js --place "${PLACE}" --apply --force`).test(out))
      fail('the message does not name the rollout_places --force command');
    else pass('names the rollout_places --force command');
    // The town hash and the place hash are different numbers, and this asserts
    // the place arm quoted the place one. If they were ever equal this assertion
    // would be vacuous, so it says so rather than passing quietly.
    const townHash = out.match(/current PLACE template is ([0-9a-f]+)/);
    if (!townHash) fail('could not read the current template hash back out of the message');
    else if (townHash[1] !== wasPlaceHash) fail(`quoted ${townHash[1]} as the current PLACE template; the fixture was stamped ${wasPlaceHash}`);
    else pass(`quoted the place template ${townHash[1]}, not the town's`);
    if (code !== 0) fail(`exit ${code}. STAMP-STALE is a report, not a gate.`);
    else pass('exit 0, as designed');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('');
if (failures) { console.error(`prove-red-rollout-stamp: ${failures} assertion(s) failed.`); process.exit(1); }
console.log('prove-red-rollout-stamp: 6 cases across both rollout tools — 2 findings and 4 controls, all as expected.');
