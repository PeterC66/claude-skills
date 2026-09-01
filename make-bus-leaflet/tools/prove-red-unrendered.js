#!/usr/bin/env node
/*
 * prove-red-unrendered.js — falsify the UNRENDERED verdict (OA-198).
 *
 * Run from make-bus-leaflet:  node tools/prove-red-unrendered.js
 * Optional: --buses "<dir>" to point at a different buses-data checkout,
 * --town "<Town>" and --place "<Place>" to name different fixtures. There are no
 * other arguments and no placeholders; the defaults are real names on this machine.
 *
 * WHAT IS BEING FALSIFIED. Both rollout tools commit S4 and then render S5 as a
 * separate step, with a stop in between: a BLOCKING build warning returns
 * REVIEW-NEEDED after the S4 commit and before `stage new S5`. Everything about
 * the state that leaves behind reads healthy — the manifest advertises the new
 * S4, the current generator redraws its stored sheets byte-for-byte, every gate
 * PASSES — and there is no JPG anywhere for the version being named. The next
 * ordinary run then hits the fast path, sees all sheets PASS, returns UP-TO-DATE
 * and skips the map, for ever. `--force` is the only thing that gets past it,
 * because the fast path is the only guard `!FORCE` disables — so the recovery is
 * a flag nobody has a reason to reach for, on a map nothing has reported.
 *
 * IT CANNOT BE SEEN WORKING ON THE REAL ESTATE. All twelve places and all eight
 * towns are rendered today, which is the state the verdict must stay silent in.
 * A verdict that fires on nothing and a verdict that is correct look identical
 * from the board, so it has to be provoked.
 *
 * SIX CASES ACROSS BOTH TOOLS, AND THAT PAIRING IS THE POINT. The row was written
 * about rollout_places.js; rollout.js has the same stop after the same commit and
 * therefore the same hole. Fixing one and proving one is how a guard ends up
 * covering a class once rather than completely, so both are provoked here.
 *
 *   A  town, manifest untouched                -> UP-TO-DATE   (control)
 *   B  town, the S5 run for the head S4 removed -> UNRENDERED   (the finding)
 *   C  place, manifest untouched               -> UP-TO-DATE   (control)
 *   D  place, the S5 run for the head S4 removed -> UNRENDERED  (the finding)
 *   E  town, head S4 carries no `version`      -> UP-TO-DATE   (the unanswerable
 *                                                 case must not become a finding)
 *   F  town, an OLDER S4's render missing      -> UP-TO-DATE   (the question is
 *                                                 about the head, not the history)
 *
 * E AND F ARE WHY THIS IS NOT TWO ASSERTIONS. A check that answered "unrendered"
 * whenever anything about S5 looked incomplete would satisfy B and D and turn
 * every map with a pruned run history into a false finding — and `prune_runs.py`
 * exists precisely to thin that history.
 *
 * THE FIXTURE IS TRACKED FILES ONLY: a manifest, the latest S3 run and
 * `ci-reference/`, which `latestRunDir()` falls back to when an S4 run folder
 * holds no routes.json. So this harness runs in a checkout that has never built
 * anything, and it never touches the real tree.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');
const { computeEngineVersion, computePlaceEngineVersion } = require('../assets/engine_version');

const ROOT = path.join(__dirname, '..');
const ROLLOUT = path.join(ROOT, 'assets', 'rollout.js');
const ROLLOUT_PLACES = path.join(ROOT, 'assets', 'rollout_places.js');
const argOf = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BUSES = argOf('buses', 'C:/u3a St Ives/Using AI/Buses');
const TOWN = argOf('town', 'Ramsey');
const PLACE = argOf('place', 'Ely Co-op');

let failures = 0;
const fail = (m) => { console.error('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

/* ---- fixtures --------------------------------------------------------- */
const srcTown = path.join(BUSES, 'Areas', TOWN);
const srcPlace = path.join(BUSES, 'Places', '_standalone', PLACE);
for (const [what, dir] of [[TOWN, srcTown], [PLACE, srcPlace]]) {
  for (const need of ['manifest.json', 'ci-reference/routes.json']) {
    if (!fs.existsSync(path.join(dir, need))) {
      console.error(`prove-red-unrendered: ${what} has no ${need} under ${dir}.`);
      console.error('  Point at a checkout that has one with --buses "<dir>", or name another with --town / --place.');
      process.exit(1);
    }
  }
}

/** Copy one map's tracked skeleton into a scratch buses tree. `rel` is where the
 *  map sits under the tree, so a town and a place build the same way. */
function buildFixture(src, rel) {
  const tmp = scratchDir('prove-unrendered-');
  const dst = path.join(tmp, rel);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'manifest.json'), path.join(dst, 'manifest.json'));
  fs.cpSync(path.join(src, 'ci-reference'), path.join(dst, 'ci-reference'), { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
  const s3 = man.stages && man.stages.S3;
  const rec = s3 && s3.runs && s3.runs.find((x) => x.id === s3.latest);
  if (!rec) { console.error('prove-red-unrendered: no latest S3 run in ' + src + "'s manifest."); process.exit(1); }
  fs.cpSync(path.join(src, rec.dir), path.join(dst, rec.dir), { recursive: true });
  /*
   * STAMP THE FIXTURE WITH TODAY'S ENGINE (2026-08-31).
   *
   * This file borrows a real map's committed `ci-reference`, and the rollout tools it
   * spawns check the engine stamp before they check anything else — so case C, the
   * control that says "manifest untouched, therefore UP-TO-DATE", was a claim about
   * the ESTATE: that the borrowed map is currently built on the current engine. It is
   * not. The morning's POI change moved the PLACE template hash while all twelve
   * places are stamped with the old one, so the control reported STAMP-STALE, exactly
   * as it should have — about the estate, not about the code under test.
   *
   * This is the FOURTH instance of that shape in one day, and the second in this
   * repository: `prove-red-status.js` had it in its ENGINE_STALE_ALLOWED anchor and
   * its donor town, `prove-red-rollout-stamp.js` in cases A and E. The class is
   * "a harness that spawns rollout.js or rollout_places.js over a borrowed fixture",
   * and it is exactly these three files — `prove-red-attribution.js` and
   * `prove-red-gates.js` also borrow a ci-reference and are unaffected, because they
   * never run a tool that reads the stamp. Measured, not assumed: both were run and
   * both are green.
   */
  stampCurrent(path.join(dst, 'ci-reference', 'routes.json'),
    /Places/.test(rel) ? computePlaceEngineVersion() : computeEngineVersion());
  return { tmp, manifestPath: path.join(dst, 'manifest.json') };
}

function stampCurrent(routesPath, hash) {
  if (!fs.existsSync(routesPath)) return;
  const j = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
  j.engine = hash;
  fs.writeFileSync(routesPath, JSON.stringify(j, null, 2));
}

function editManifest(manifestPath, fn) {
  const j = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fn(j);
  fs.writeFileSync(manifestPath, JSON.stringify(j, null, 2));
}

/** The version the head S4 carries — what every case below is really about. */
function headS4Version(manifestPath) {
  const j = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const s4 = j.stages.S4;
  return String(s4.runs.find((r) => r.id === s4.latest).version);
}

/** Delete the S5 run that renders the head S4 — the exact state the stop leaves. */
function unrender(manifestPath) {
  const v = headS4Version(manifestPath);
  editManifest(manifestPath, (j) => {
    const s5 = j.stages.S5;
    s5.runs = s5.runs.filter((r) => String(r.version) !== v);
    s5.latest = s5.runs.length ? s5.runs[s5.runs.length - 1].id : null;
  });
  return v;
}

function runTool(tool, tmp, nameFlag, name, extra = []) {
  const r = spawnSync(process.execPath, [tool, '--buses', tmp, nameFlag, name, ...extra],
    { encoding: 'utf8', cwd: path.join(ROOT, 'assets') });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}
const verdict = (out, name) => {
  const m = out.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.\\.\\. ([A-Z-]+)', 'm'));
  return m ? m[1] : '(no verdict line)';
};

/* ---- A: the town control ---------------------------------------------- */
console.log(`\nA  ${TOWN}, manifest untouched — the control`);
{
  const { tmp } = buildFixture(srcTown, path.join('Areas', TOWN));
  const { out, code } = runTool(ROLLOUT, tmp, '--town', TOWN);
  const v = verdict(out, TOWN);
  if (v !== 'UP-TO-DATE') fail(`expected UP-TO-DATE, got ${v}. A control that is not green means the fixture is wrong, not the code.\n${out}`);
  else pass('UP-TO-DATE');
  if (code !== 0) fail(`exit ${code}, expected 0`);
  else pass('exit 0');
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- B: the town finding ---------------------------------------------- */
console.log(`\nB  ${TOWN}, the S5 run rendering the head S4 removed — the finding`);
{
  const { tmp, manifestPath } = buildFixture(srcTown, path.join('Areas', TOWN));
  const v = unrender(manifestPath);
  const { out, code } = runTool(ROLLOUT, tmp, '--town', TOWN);
  const got = verdict(out, TOWN);
  if (got !== 'UNRENDERED') fail(`expected UNRENDERED, got ${got}. This is the state the blocking-warning stop leaves: a committed S4, every gate PASS, and no JPG.\n${out}`);
  else pass('UNRENDERED');
  // Name the phrase, not just the colour: a harness that accepts any red accepts a crash.
  if (!out.includes(`S4 v${v} is committed`)) fail(`the message does not name the unrendered version v${v}`);
  else pass(`names the unrendered version v${v}`);
  if (!new RegExp(`node rollout\\.js --town "${TOWN}" --apply --force`).test(out))
    fail('the message does not name the command that finishes it — the whole point of the verdict');
  else pass('names the --force command');
  if (code === 0) fail('exit 0. The state was invisible because nothing failed; a verdict that only prints is the same silence with a longer summary line.');
  else pass(`exit ${code}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- C: the place control --------------------------------------------- */
console.log(`\nC  ${PLACE}, manifest untouched — the control`);
{
  const { tmp } = buildFixture(srcPlace, path.join('Places', '_standalone', PLACE));
  const { out, code } = runTool(ROLLOUT_PLACES, tmp, '--place', PLACE);
  const v = verdict(out, PLACE);
  if (v !== 'UP-TO-DATE') fail(`expected UP-TO-DATE, got ${v}.\n${out}`);
  else pass('UP-TO-DATE');
  if (code !== 0) fail(`exit ${code}, expected 0`);
  else pass('exit 0');
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- D: the place finding --------------------------------------------- */
console.log(`\nD  ${PLACE}, the S5 run rendering the head S4 removed — the finding`);
{
  const { tmp, manifestPath } = buildFixture(srcPlace, path.join('Places', '_standalone', PLACE));
  const v = unrender(manifestPath);
  const { out, code } = runTool(ROLLOUT_PLACES, tmp, '--place', PLACE);
  const got = verdict(out, PLACE);
  if (got !== 'UNRENDERED') fail(`expected UNRENDERED, got ${got}.\n${out}`);
  else pass('UNRENDERED');
  if (!out.includes(`S4 v${v} is committed`)) fail(`the message does not name the unrendered version v${v}`);
  else pass(`names the unrendered version v${v}`);
  if (!new RegExp(`node rollout_places\\.js --place "${PLACE}" --apply --force`).test(out))
    fail('the message does not name the command that finishes it');
  else pass('names the --force command');
  if (code === 0) fail('exit 0 — the verdict does not move the exit code');
  else pass(`exit ${code}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- E: unanswerable is not a finding ---------------------------------- */
console.log(`\nE  ${TOWN}, head S4 carries no version — unanswerable, must stay quiet`);
{
  const { tmp, manifestPath } = buildFixture(srcTown, path.join('Areas', TOWN));
  unrender(manifestPath);
  editManifest(manifestPath, (j) => {
    const s4 = j.stages.S4;
    delete s4.runs.find((r) => r.id === s4.latest).version;
  });
  const { out } = runTool(ROLLOUT, tmp, '--town', TOWN);
  const v = verdict(out, TOWN);
  if (v === 'UNRENDERED') fail('a run committed before versions were recorded was reported as unrendered. Guessing the version out of the run id is the reasoning this check exists to avoid.');
  else pass(`${v} — not a finding`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- F: an OLDER gap is not a finding ---------------------------------- */
console.log(`\nF  ${TOWN}, an older S4's render removed — the head is what matters`);
{
  const { tmp, manifestPath } = buildFixture(srcTown, path.join('Areas', TOWN));
  const head = headS4Version(manifestPath);
  let removed = null;
  editManifest(manifestPath, (j) => {
    const s5 = j.stages.S5;
    const older = s5.runs.filter((r) => String(r.version) !== head);
    if (!older.length) return;
    removed = String(older[older.length - 1].version);
    s5.runs = s5.runs.filter((r) => String(r.version) !== removed);
  });
  if (!removed) {
    console.log('  ..    this fixture has only one S5 run, so there is no older gap to make — case skipped');
  } else {
    const { out, code } = runTool(ROLLOUT, tmp, '--town', TOWN);
    const v = verdict(out, TOWN);
    if (v === 'UNRENDERED') fail(`v${removed}'s render is missing from the HISTORY and v${head}'s is present. prune_runs.py thins that history on purpose; a check that read it as a finding would redden every map it has ever run on.`);
    else pass(`${v} — an older gap is not a finding`);
    if (code !== 0) fail(`exit ${code}, expected 0`);
    else pass('exit 0');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- G and H: the verdict must YIELD to the command it prints ----------
 *
 * ADDED 2026-09-01, AFTER IT BIT. Cases B and D prove the verdict FIRES and that
 * it names `--apply --force` as the way to finish the map. Neither asked whether
 * that command works — and it did not: the guard returned before the `!FORCE`
 * test, so its own printed remedy reached the same line and got the same refusal,
 * for ever. Hit for real during the OA-187/OA-213 rollout, when a transient
 * file-open error killed High Wycombe between the S4 commit and the S5 render,
 * producing exactly the state this verdict exists for, on a map that then could
 * not be finished by the tool that made it.
 *
 * The shape is worth the two extra cases: a guard is not proved by watching it
 * refuse. It is proved by watching it refuse AND watching the stated escape work,
 * because a refusal nobody can satisfy is worse than no refusal — it stops the one
 * tool that could repair the state. `--force` without `--apply` is a dry run, so
 * these assert only that the verdict gets out of the way; what happens after is
 * cases A to F's business.
 */
for (const [label, tool, src, rel, flag, name] of [
  ['G', ROLLOUT, srcTown, path.join('Areas', TOWN), '--town', TOWN],
  ['H', ROLLOUT_PLACES, srcPlace, path.join('Places', '_standalone', PLACE), '--place', PLACE],
]) {
  console.log(`\n${label}  ${name}, unrendered AND --force — the verdict must yield to its own remedy`);
  const { tmp, manifestPath } = buildFixture(src, rel);
  const v = unrender(manifestPath);
  const plain = runTool(tool, tmp, flag, name);
  if (verdict(plain.out, name) !== 'UNRENDERED') {
    fail(`premise: without --force this fixture must report UNRENDERED, got ${verdict(plain.out, name)}. Nothing below means anything otherwise.`);
  } else {
    pass(`premise: UNRENDERED without --force (v${v})`);
    const forced = runTool(tool, tmp, flag, name, ['--force']);
    const got = verdict(forced.out, name);
    if (got === 'UNRENDERED') fail(`--force still returns UNRENDERED, so the command this verdict PRINTS cannot clear it. A guard whose stated remedy is a no-op stops the only tool that could fix the state.\n${forced.out}`);
    else pass(`${got} — --force gets past the verdict`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures
  ? `\n${failures} FAILURE(S) — the UNRENDERED verdict is not doing what this file says it does.\n`
  : '\nAll cases behaved: the verdict fires on the state that produced it, on BOTH tools, stays quiet on the estate as it stands, and yields to the command it tells you to run.\n');
process.exit(failures ? 1 : 0);
