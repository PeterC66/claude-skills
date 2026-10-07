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
 * SINCE buses-data OA-574 (A1 of the 2026-10-06 simplification review) THERE IS NO
 * `--rebuild-stale`. A stamp-only map is not work: the verdict stays, `--apply` leaves
 * the map alone, and the flag is an unknown flag. G, H, K and L below prove those
 * three things; they replace the OA-473 arms that proved the flag opened exactly the
 * state it named.
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

function buildFixture() {
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
  return tmp;
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
  if (/--rebuild-stale/.test(out) || /--force/.test(out))
    fail('the message still names a command that clears it — a stamp-only map is not work (OA-574), so none should be offered');
  else pass('names no command: nothing is owed');
  if (!/NOTHING IS OWED/.test(out)) fail('the message does not say nothing is owed');
  else pass('says nothing is owed');
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

/* ---- G, H, K, L: the flag is gone and a stamp-only map is left alone (buses-data OA-574) -------
 *
 * G  --apply on a stamp-only map writes NOTHING: the verdict is STAMP-STALE, the exit is 0, and a
 *    byte snapshot of the whole scratch tree is identical before and after. A control would be a
 *    tool that said "nothing owed" and rebuilt anyway, which is why the tree is compared and not
 *    only the words.
 * H  --rebuild-stale is an UNKNOWN FLAG: exit 2 before the estate is read. A loop prompt written
 *    before OA-574 that still names it fails loud instead of quietly doing a plain run.
 * K, L  a stale stamp does not mask the guards in front of the stamp test: STALE-INPUTS and
 *    UNRENDERED still refuse. They were OA-473's cases with the flag; the guards are the subject.
 * M  the lost-label and blocking-warning refusals in both tools still read !FORCE, and FORCE is
 *    args.force alone.
 */
const manifestOf = (tmp) => path.join(tmp, 'Areas', TOWN, 'manifest.json');
function editManifest(tmp, fn) {
  const p = manifestOf(tmp);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(j);
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}
const latestS4 = (j) => j.stages.S4.runs.find((r) => r.id === j.stages.S4.latest);
/* path -> bytes for every file under a tree, to say "nothing was written" by comparison */
function snapshot(root) {
  const out = new Map();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out.set(path.relative(root, p), fs.readFileSync(p).toString('base64'));
    }
  })(root);
  return out;
}
function sameTree(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

console.log(`\nG  ${TOWN}, stale stamp, --apply — a stamp-only map is left alone, nothing written`);
{
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { j.engine = '30fbffe221'; });
  const before = snapshot(tmp);
  const { out, code } = runRollout(tmp, ['--apply', '--by', 'prove-red']);
  const v = verdict(out);
  if (v !== 'STAMP-STALE') fail(`expected STAMP-STALE, got ${v}. --apply has taken a stamp-only map into a rebuild.\n${out}`);
  else pass('STAMP-STALE under --apply');
  if (!sameTree(before, snapshot(tmp))) fail('--apply WROTE to a stamp-only map — the rebuild OA-574 abolished has come back by another route');
  else pass('the scratch tree is byte-identical after --apply');
  if (code !== 0) fail(`exit ${code}, expected 0 — nothing owed is not a fault`);
  else pass('exit 0');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nH  ${TOWN}, --rebuild-stale — an unknown flag, refused before the estate is read`);
{
  const tmp = buildFixture();
  const { out, code } = runRollout(tmp, ['--rebuild-stale']);
  if (code !== 2) fail(`exit ${code}, expected 2. The flag is accepted again, or ignored.\n${out}`);
  else pass('exit 2');
  if (!/unknown flag --rebuild-stale/.test(out)) fail('the refusal does not name the flag');
  else pass('names the flag');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nK  ${TOWN}, stale stamp AND S2 moved since the S4 — STALE-INPUTS must still refuse`);
{
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { j.engine = '30fbffe221'; });
  editManifest(tmp, (j) => { const r = latestS4(j); r.basedOn = Object.assign({}, r.basedOn, { S2: 'prove-red-not-the-latest' }); });
  const { out, code } = runRollout(tmp, ['--apply', '--by', 'prove-red']);
  const v = verdict(out);
  if (v !== 'STALE-INPUTS') fail(`expected STALE-INPUTS, got ${v}. The stamp test has bypassed the data-moved guard.\n${out}`);
  else pass('STALE-INPUTS');
  if (code !== 1) fail(`exit ${code}, expected 1`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nL  ${TOWN}, stale stamp AND an S4 no S5 rendered — UNRENDERED must still refuse`);
{
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { j.engine = '30fbffe221'; });
  editManifest(tmp, (j) => {
    const ver = String(latestS4(j).version);
    j.stages.S5.runs = j.stages.S5.runs.filter((r) => String(r.version) !== ver);
  });
  const { out, code } = runRollout(tmp, ['--apply', '--by', 'prove-red']);
  const v = verdict(out);
  if (v !== 'UNRENDERED') fail(`expected UNRENDERED, got ${v}. The stamp test has bypassed the unrendered-S4 guard.\n${out}`);
  else pass('UNRENDERED');
  if (code !== 1) fail(`exit ${code}, expected 1`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- P to S: the flags OA-586 split, each seen to go the other way -------------------------------
 * A fast path that skips a build is a claim, so each case here is a dry run that asks WHICH verdict a
 * state gets: past the fast paths (anything but the four below) or stopped by one.
 *   P  S3 moved over an unmoved S2 (a config rollout), stamp current -> NOT UP-TO-DATE, NOT STALE-INPUTS,
 *      with no flag. If it answers UP-TO-DATE the new S3 is invisible, which is why --force used to be needed.
 *   Q  the control, healthy map + --force alone -> still UP-TO-DATE: --force no longer rebuilds a map.
 *   R  S2 moved + --force -> still STALE-INPUTS: there is no flag that rolls the old geometry forward.
 *   S  --apply with no --by and no lock -> exit 2 before the estate is read, tree untouched.
 */
const PAST_THE_FAST_PATHS = (v) => !['UP-TO-DATE', 'STAMP-STALE', 'STALE-INPUTS', 'UNRENDERED', '(no verdict line)'].includes(v);

console.log(`\nP  ${TOWN}, S3 moved over an unmoved S2 — a config rollout builds with no flag`);
{
  const tmp = buildFixture();
  editManifest(tmp, (j) => { const r = latestS4(j); r.basedOn = Object.assign({}, r.basedOn, { S3: 'prove-red-older-s3' }); });
  const { out } = runRollout(tmp);
  const v = verdict(out);
  if (!PAST_THE_FAST_PATHS(v)) fail(`got ${v}. A moved S3 must get past UP-TO-DATE and STAMP-STALE and must not be STALE-INPUTS.\n${out}`);
  else pass(`${v} — got past the fast paths with no flag`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nQ  ${TOWN}, healthy map AND --force alone — it does not rebuild an up-to-date map`);
{
  const tmp = buildFixture();
  const v = verdict(runRollout(tmp, ['--force']).out);
  if (v !== 'UP-TO-DATE') fail(`--force gave ${v}: it rebuilds a map nothing has moved on, so it means another thing again.`);
  else pass('UP-TO-DATE — --force is not a rebuild');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nR  ${TOWN}, S2 moved AND --force — STALE-INPUTS stands, there is no override`);
{
  const tmp = buildFixture();
  editManifest(tmp, (j) => { const r = latestS4(j); r.basedOn = Object.assign({}, r.basedOn, { S2: 'prove-red-not-the-latest' }); });
  const v = verdict(runRollout(tmp, ['--force', '--finish']).out);
  if (v !== 'STALE-INPUTS') fail(`--force --finish gave ${v}: a flag rolls the old geometry forward again.`);
  else pass('STALE-INPUTS — neither flag overrides it');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nS  ${TOWN}, --apply with no --by and no lock — refused before the estate is read`);
{
  const tmp = buildFixture();
  editRoutes(tmp, (j) => { j.engine = '30fbffe221'; });
  const before = snapshot(tmp);
  const { out, code } = runRollout(tmp, ['--apply']);
  if (code !== 2) fail(`exit ${code}, expected 2: an unattributed --apply was allowed.\n${out}`);
  else pass('exit 2');
  if (!/--by is required when writing/.test(out)) fail(`the refusal does not say why.\n${out}`);
  else pass('says --by is required');
  if (!sameTree(before, snapshot(tmp))) fail('a refused --apply wrote to the tree');
  else pass('the tree is byte-identical');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nM  both tools: FORCE is args.force alone, and the lost-label and blocking-warning refusals still read it');
for (const [label, file] of [['rollout.js', ROLLOUT], ['rollout_places.js', path.join(ROOT, 'assets', 'rollout_places.js')]]) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/^const FORCE = !!args\.force;$/m.test(src)) fail(`${label}: FORCE is no longer args.force alone`);
  else pass(`${label}: FORCE is args.force alone`);
  if (!/if \(anyLost && !FORCE\)/.test(src)) fail(`${label}: the lost-label refusal no longer reads \`anyLost && !FORCE\``);
  else pass(`${label}: the lost-label refusal reads !FORCE`);
  if (!/if \(realBlockers\.length && !FORCE\)/.test(src)) fail(`${label}: the blocking-warning refusal no longer reads \`realBlockers.length && !FORCE\``);
  else pass(`${label}: the blocking-warning refusal reads !FORCE`);
  if (/REBUILD_STALE|'rebuild-stale'/.test(src)) fail(`${label}: REBUILD_STALE or the flag name is back in the source`);
  else pass(`${label}: no REBUILD_STALE and no 'rebuild-stale' flag in the source`);
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
 * off it. NOT `requireTown` any more (buses-data OA-603): the fixture below builds whichever
 * layout the pick has, because the control must borrow a place the CURRENT engine reproduces, and
 * today no nested place is one — every place under a town trails the engine by design (OA-430), so
 * the control reached a rebuild and answered DRY-RUN where it must say UP-TO-DATE. */
const placePick = pickPlace(BUSES, argOf('place', null), 'prove-red-rollout-stamp');
const PLACE = placePick.name;
const PLACE_TOWN = placePick.town;   // null for a standalone place
const srcPlace = placePick.dir;

if (!fs.existsSync(path.join(srcPlace, 'ci-reference', 'routes.json'))) {
  fail(`no ci-reference/routes.json for the place ${PLACE} under ${srcPlace} — the place half is UNPROVEN, which is a failure, not a skip. Name another with --place.`);
} else {
  function buildPlaceFixture() {
    const tmp = scratchDir('prove-rollout-stamp-p-');
    let dst;
    if (PLACE_TOWN) {
      const townDst = path.join(tmp, 'Areas', PLACE_TOWN);
      fs.mkdirSync(townDst, { recursive: true });
      // findTowns() keys on the TOWN's manifest, and findPlaces() only walks
      // Places/ under a town it already found. Without this the place is invisible
      // and the run would exit 2 — a pass for the wrong reason.
      fs.copyFileSync(path.join(BUSES, 'Areas', PLACE_TOWN, 'manifest.json'), path.join(townDst, 'manifest.json'));
      dst = path.join(townDst, 'Places', PLACE);
    } else {
      // A standalone place has no town: findPlaces() reads Places/<bucket>/<Place>/ from the root.
      dst = path.join(tmp, 'Places', '_standalone', PLACE);
    }
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(path.join(srcPlace, 'manifest.json'), path.join(dst, 'manifest.json'));
    fs.cpSync(path.join(srcPlace, 'ci-reference'), path.join(dst, 'ci-reference'), { recursive: true });
    // The latest run of EVERY stage the rollout pulls (S1, S2, S3: rollout_places.js PULL_STAGES —
    // place.json is an S1 output). The fixture held the S3 run only, so the control's S1 pull died with
    // ENOENT and answered ERROR where it should say UP-TO-DATE (buses-data OA-603). A stage with no
    // latest run is skipped here and left for the rollout to say, as before.
    const man = loadManifest(dst);
    for (const stage of ['S1', 'S2', 'S3']) {
      const st = man.stages && man.stages[stage];
      const rec = st && st.runs && st.runs.find((x) => x.id === st.latest);
      if (rec && fs.existsSync(path.join(srcPlace, rec.dir))) fs.cpSync(path.join(srcPlace, rec.dir), path.join(dst, rec.dir), { recursive: true });
    }
    stampCurrent(path.join(dst, 'ci-reference', 'routes.json'), computePlaceEngineVersion());
    return tmp;
  }
  const placeRoutes = (tmp) => path.join(tmp, ...(PLACE_TOWN ? ['Areas', PLACE_TOWN, 'Places'] : ['Places', '_standalone']), PLACE, 'ci-reference', 'routes.json');
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
    if (/--rebuild-stale/.test(out) || /--force/.test(out)) fail('the message still names a command that clears it — a stamp-only place is not work (OA-574)');
    else pass('names no command: nothing is owed');
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

  // N and O: the place tool's copy of G and H (OA-574).
  console.log(`\nN  place ${PLACE}, stale stamp, --apply — a stamp-only place is left alone, nothing written`);
  {
    const tmp = buildPlaceFixture();
    const p = placeRoutes(tmp);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.engine = 'a0a0a0a0a0';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const before = snapshot(tmp);
    const { out, code } = runPlaces(tmp, ['--apply', '--by', 'prove-red']);
    const v = placeVerdict(out);
    if (v !== 'STAMP-STALE') fail(`expected STAMP-STALE, got ${v}.\n${out}`);
    else pass('STAMP-STALE under --apply');
    if (!sameTree(before, snapshot(tmp))) fail('--apply WROTE to a stamp-only place');
    else pass('the scratch tree is byte-identical after --apply');
    if (code !== 0) fail(`exit ${code}, expected 0`);
    else pass('exit 0');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nO  place ${PLACE}, --rebuild-stale — an unknown flag, refused before the estate is read`);
  {
    const tmp = buildPlaceFixture();
    const { out, code } = runPlaces(tmp, ['--rebuild-stale']);
    if (code !== 2) fail(`exit ${code}, expected 2.\n${out}`);
    else pass('exit 2');
    if (!/unknown flag --rebuild-stale/.test(out)) fail('the refusal does not name the flag');
    else pass('names the flag');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('');
if (failures) { console.error(`prove-red-rollout-stamp: ${failures} assertion(s) failed.`); process.exit(1); }
console.log('prove-red-rollout-stamp: every case across both rollout tools, the gone --rebuild-stale flag and the untouched stamp-only map included, as expected.');
