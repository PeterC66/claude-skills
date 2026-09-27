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
// The one manifest reader (OA-232 Tier 2.4). This resolves the REAL stage.js,
// not the scratch copy this harness mutates — reading back what the subject
// wrote is a question about the manifest, not about the mutation.
const { loadManifest } = require('../assets/stage.js');
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
/* WHICH TOWN, ASKED OF THE ESTATE RATHER THAN TYPED (OA-398, 2026-09-18). This
 * was `argOf('town', 'Ramsey')`, and the place half below carried two more
 * literals — one map name and one that has to AGREE with it, which is worse. The
 * same fault OA-219 fixed in prove-red-held-back and did not fix here; it
 * surfaced as `Ramsey has no manifest.json` the moment this was pointed at the
 * fixture estate. `--town` still names one, and a name that is not there is an
 * error rather than a substitution (tools/lib/pick-fixture.js). */
const { pickTown, pickPlace } = require('./lib/pick-fixture');
const townPick = pickTown(BUSES, argOf('town', null), 'prove-red-rollout-stamp');
const TOWN = townPick.name;

let failures = 0;
const fail = (m) => { console.error('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

/* ---- fixture ---------------------------------------------------------- */
const srcTown = townPick.dir;

function buildFixture({ withData = false } = {}) {
  const tmp = scratchDir('prove-rollout-stamp-');
  const dst = path.join(tmp, 'Areas', TOWN);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(srcTown, 'manifest.json'), path.join(dst, 'manifest.json'));
  fs.cpSync(path.join(srcTown, 'ci-reference'), path.join(dst, 'ci-reference'), { recursive: true });
  // The S3 run rolloutOne() seeds a rebuild from. Case D is the only case that
  // reaches it, and a missing one would make D return SKIP — a pass for the
  // wrong reason.
  const man = loadManifest(dst);
  const s3 = man.stages && man.stages.S3;
  const rec = s3 && s3.runs && s3.runs.find((x) => x.id === s3.latest);
  if (!rec) { console.error('prove-red-rollout-stamp: no latest S3 run in the manifest.'); process.exit(1); }
  fs.cpSync(path.join(srcTown, rec.dir), path.join(dst, rec.dir), { recursive: true });
  stampCurrent(path.join(dst, 'ci-reference', 'routes.json'), computeEngineVersion());
  dataCopied = withData && copyDataStages(srcTown, dst, man, ['S2']);
  return tmp;
}

/* The DATA stages a real rebuild pulls — S2 for a town, S1 and S2 for a place — and
 * only for G and N, the two cases that must get through the scratch build. Copied
 * when the source estate has them and silently not otherwise: CI's fixture estate
 * carries no S2, and there G and N assert the weaker thing they can see (below). */
let dataCopied = false;   // set by the last fixture built: did its data stages come with it?
function copyDataStages(src, dst, man, stages) {
  let all = true;
  for (const st of stages) {
    const sx = man.stages && man.stages[st];
    const rec = sx && sx.runs && sx.runs.find((x) => x.id === sx.latest);
    if (rec && fs.existsSync(path.join(src, rec.dir))) fs.cpSync(path.join(src, rec.dir), path.join(dst, rec.dir), { recursive: true });
    else all = false;
  }
  return all;
}
/* G and N ask one question of the flag — did it take the map PAST the fast path and
 * into the rebuild? — and a stronger one where the data is on disk to answer it. */
function assertReachedRebuild(v, out, code, full) {
  if (['STAMP-STALE', 'UP-TO-DATE', 'NOT-STAMP-STALE'].includes(v) || v === '(no verdict line)')
    return fail(`expected the rebuild, got ${v}. The flag did not take the map past STAMP-STALE.\n${out}`);
  pass(`${v} — past STAMP-STALE and into the rebuild`);
  if (!full) return pass('this estate has no data stages to finish the scratch build with, so the reach is all it can show');
  if (v !== 'DRY-RUN') fail(`with the data on disk the scratch build should finish as DRY-RUN, got ${v}.\n${out}`);
  else pass('DRY-RUN — the scratch build finished');
  if (/LOST in /.test(out)) fail(`the rebuild of a stamp-stale map lost a label — PASS on every sheet should make that impossible.\n${out}`);
  else pass('no label lost');
  if (code !== 0) fail(`exit ${code}, expected 0`);
  else pass('exit 0');
}

const routesOf = (tmp) => path.join(tmp, 'Areas', TOWN, 'ci-reference', 'routes.json');
function editRoutes(tmp, fn) {
  const p = routesOf(tmp);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(j);
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}

function runRollout(tmp, extra = []) {
  const r = spawnSync(process.execPath, [ROLLOUT, '--buses', tmp, '--town', TOWN, ...extra],
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
  if (!new RegExp(`node rollout\\.js --town "${TOWN}" --apply --rebuild-stale`).test(out))
    fail('the message does not name the --rebuild-stale command that clears it — the whole point of the verdict (OA-473: not --force)');
  else pass('names the --rebuild-stale command');
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

/* ---- G to L: --rebuild-stale (buses-data OA-473) -----------------------
 *
 * The flag exists so a loop tick can clear a STAMP-STALE map without being handed
 * --force, which also means "finish an UNRENDERED S4", "roll old geometry past
 * STALE-INPUTS" and "publish past a lost label or a blocking warning". So one case
 * shows it opening the state it names (G) and the rest show it opening nothing else:
 * a map whose ink would move (H), a current map (I), --force alongside it (J), a map
 * whose data has moved (K) and a map with an unrendered S4 (L). K and L carry a stale
 * stamp too, so the only thing refusing them is the guard in front of the stamp test.
 *
 * The lost-label and blocking-warning refusals are asked in M, from the source,
 * because neither is reachable in a dry run: a lost label needs a sheet that does
 * not reproduce, which is H's state and refused before any build, and a blocker
 * refuses only under --apply, which this fixture cannot run. */
const manifestOf = (tmp) => path.join(tmp, 'Areas', TOWN, 'manifest.json');
function editManifest(tmp, fn) {
  const p = manifestOf(tmp);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(j);
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}
const latestS4 = (j) => j.stages.S4.runs.find((r) => r.id === j.stages.S4.latest);

console.log(`\nG  ${TOWN}, stale stamp, --rebuild-stale — the flag opens the state it names  (slow: this one rebuilds)`);
{
  const tmp = buildFixture({ withData: true });
  editRoutes(tmp, (j) => { j.engine = '30fbffe221'; });
  const { out, code } = runRollout(tmp, ['--rebuild-stale']);
  assertReachedRebuild(verdict(out), out, code, dataCopied);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nH  ${TOWN}, stale stamp AND a sheet that really differs, --rebuild-stale — must refuse`);
{
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { j.engine = '30fbffe221'; });
  const svg = path.join(tmp, 'Areas', TOWN, 'ci-reference', 'internal.svg');
  fs.writeFileSync(svg, fs.readFileSync(svg, 'utf8').replace('</svg>', '<!-- prove-red-rollout-stamp: forced DIFF --></svg>'));
  const { out, code } = runRollout(tmp, ['--rebuild-stale']);
  const v = verdict(out);
  if (v !== 'NOT-STAMP-STALE') fail(`expected NOT-STAMP-STALE, got ${v}. The flag has widened into an ink-moving rebuild, which is plain --apply's and a person's.\n${out}`);
  else pass('NOT-STAMP-STALE');
  if (!/internal would change/.test(out)) fail('the refusal does not name the sheet that would change');
  else pass('names the sheet that would change');
  if (code !== 1) fail(`exit ${code}, expected 1 — a tick reads a non-zero exit as a hold`);
  else pass('exit 1');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nI  ${TOWN}, stamp current, --rebuild-stale — nothing to do`);
{
  const tmp = buildFixture();
  const { out, code } = runRollout(tmp, ['--rebuild-stale']);
  const v = verdict(out);
  if (v !== 'UP-TO-DATE') fail(`expected UP-TO-DATE, got ${v}.\n${out}`);
  else pass('UP-TO-DATE');
  if (code !== 0) fail(`exit ${code}, expected 0`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nJ  ${TOWN}, --rebuild-stale with --force — a usage error`);
{
  const tmp = buildFixture();
  const { out, code } = runRollout(tmp, ['--rebuild-stale', '--force']);
  if (code !== 2) fail(`exit ${code}, expected 2. Together the two flags would hand a tick every meaning of --force.\n${out}`);
  else pass('exit 2');
  if (!/--rebuild-stale and --force together/.test(out)) fail('the refusal does not say why');
  else pass('says why');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nK  ${TOWN}, stale stamp AND S2 moved since the S4, --rebuild-stale — STALE-INPUTS must still refuse`);
{
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { j.engine = '30fbffe221'; });
  editManifest(tmp, (j) => { const r = latestS4(j); r.basedOn = Object.assign({}, r.basedOn, { S2: 'prove-red-not-the-latest' }); });
  const { out, code } = runRollout(tmp, ['--rebuild-stale']);
  const v = verdict(out);
  if (v !== 'STALE-INPUTS') fail(`expected STALE-INPUTS, got ${v}. The flag has bypassed the data-moved guard.\n${out}`);
  else pass('STALE-INPUTS');
  if (code !== 1) fail(`exit ${code}, expected 1`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nL  ${TOWN}, stale stamp AND an S4 no S5 rendered, --rebuild-stale — UNRENDERED must still refuse`);
{
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { j.engine = '30fbffe221'; });
  editManifest(tmp, (j) => {
    const ver = String(latestS4(j).version);
    j.stages.S5.runs = j.stages.S5.runs.filter((r) => String(r.version) !== ver);
  });
  const { out, code } = runRollout(tmp, ['--rebuild-stale']);
  const v = verdict(out);
  if (v !== 'UNRENDERED') fail(`expected UNRENDERED, got ${v}. The flag has bypassed the unrendered-S4 guard.\n${out}`);
  else pass('UNRENDERED');
  if (code !== 1) fail(`exit ${code}, expected 1`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nM  both tools: the flag never sets FORCE, and the lost-label and blocking-warning refusals still read it');
for (const [label, file] of [['rollout.js', ROLLOUT], ['rollout_places.js', path.join(ROOT, 'assets', 'rollout_places.js')]]) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/^const FORCE = !!args\.force;$/m.test(src)) fail(`${label}: FORCE is no longer args.force alone — the flag may have been folded into it`);
  else pass(`${label}: FORCE is args.force alone`);
  if (!/if \(anyLost && !FORCE\)/.test(src)) fail(`${label}: the lost-label refusal no longer reads \`anyLost && !FORCE\``);
  else pass(`${label}: the lost-label refusal reads !FORCE`);
  if (!/if \(realBlockers\.length && !FORCE\)/.test(src)) fail(`${label}: the blocking-warning refusal no longer reads \`realBlockers.length && !FORCE\``);
  else pass(`${label}: the blocking-warning refusal reads !FORCE`);
  if (/FORCE\s*=\s*[^;]*REBUILD_STALE|REBUILD_STALE\s*\|\|/.test(src)) fail(`${label}: REBUILD_STALE is combined into a force-like condition`);
  else pass(`${label}: REBUILD_STALE is combined into nothing force-like`);
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
/* `--place-town` has gone, and its disappearance is the point. It had to AGREE
 * with `--place`: name one and not the other and the harness paired a real place
 * with some other town's folder, which is the fixture bug OA-219 is about, wired
 * in as an argument. The place's town is a property of the place, so it is read
 * off it. `requireTown` because the fixture below builds the nested layout — a
 * standalone place has no town folder to put a manifest in. */
const placePick = pickPlace(BUSES, argOf('place', null), 'prove-red-rollout-stamp', { requireTown: true });
const PLACE = placePick.name;
const PLACE_TOWN = placePick.town;
const srcPlace = placePick.dir;

if (!fs.existsSync(path.join(srcPlace, 'ci-reference', 'routes.json'))) {
  fail(`no ci-reference/routes.json for the place ${PLACE} under ${srcPlace} — the place half is UNPROVEN, which is a failure, not a skip. Name another with --place.`);
} else {
  function buildPlaceFixture({ withData = false } = {}) {
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
    const man = loadManifest(dst);
    const s3 = man.stages && man.stages.S3;
    const rec = s3 && s3.runs && s3.runs.find((x) => x.id === s3.latest);
    if (rec) fs.cpSync(path.join(srcPlace, rec.dir), path.join(dst, rec.dir), { recursive: true });
    stampCurrent(path.join(dst, 'ci-reference', 'routes.json'), computePlaceEngineVersion());
    dataCopied = withData && copyDataStages(srcPlace, dst, man, ['S1', 'S2']);
    return tmp;
  }
  const placeRoutes = (tmp) => path.join(tmp, 'Areas', PLACE_TOWN, 'Places', PLACE, 'ci-reference', 'routes.json');
  function runPlaces(tmp, extra = []) {
    const r = spawnSync(process.execPath, [ROLLOUT_PLACES, '--buses', tmp, '--place', PLACE, ...extra],
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
    if (!new RegExp(`node rollout_places\\.js --place "${PLACE}" --apply --rebuild-stale`).test(out))
      fail('the message does not name the rollout_places --rebuild-stale command');
    else pass('names the rollout_places --rebuild-stale command');
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

  // N and O: the place tool's copy of --rebuild-stale is wired up — it opens the
  // state it names and refuses a sheet that would change (OA-473).
  console.log(`\nN  place ${PLACE}, stale stamp, --rebuild-stale — the flag opens the state it names  (slow: this one rebuilds)`);
  {
    const tmp = buildPlaceFixture({ withData: true });
    const p = placeRoutes(tmp);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.engine = 'a0a0a0a0a0';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const { out, code } = runPlaces(tmp, ['--rebuild-stale']);
    assertReachedRebuild(placeVerdict(out), out, code, dataCopied);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nO  place ${PLACE}, stale stamp AND a sheet that really differs, --rebuild-stale — must refuse`);
  {
    const tmp = buildPlaceFixture();
    const p = placeRoutes(tmp);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.engine = 'a0a0a0a0a0';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const svg = path.join(path.dirname(p), 'internal.svg');
    fs.writeFileSync(svg, fs.readFileSync(svg, 'utf8').replace('</svg>', '<!-- prove-red-rollout-stamp: forced DIFF --></svg>'));
    const { out, code } = runPlaces(tmp, ['--rebuild-stale']);
    const v = placeVerdict(out);
    if (v !== 'NOT-STAMP-STALE') fail(`expected NOT-STAMP-STALE, got ${v}.\n${out}`);
    else pass('NOT-STAMP-STALE');
    if (code !== 1) fail(`exit ${code}, expected 1`);
    else pass('exit 1');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nP  place ${PLACE}, --rebuild-stale with --force — a usage error`);
  {
    const tmp = buildPlaceFixture();
    const { code } = runPlaces(tmp, ['--rebuild-stale', '--force']);
    if (code !== 2) fail(`exit ${code}, expected 2`);
    else pass('exit 2');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('');
if (failures) { console.error(`prove-red-rollout-stamp: ${failures} assertion(s) failed.`); process.exit(1); }
console.log('prove-red-rollout-stamp: every case across both rollout tools, the --rebuild-stale refusals included, as expected.');
