#!/usr/bin/env node
/*
 * prove-red-held-back.js — falsify the HELD-BACK ENGINE gate (OA-214).
 *
 * Run from make-bus-leaflet, no placeholders:
 *     npm run test:prove-red-held-back
 * Optional: --buses "<dir>" to point at another buses-data checkout.
 *
 * WHAT IS BEING FALSIFIED, AND WHY IT NEEDS ITS OWN FILE.
 *
 * On 2026-09-01 an engine change MOVED INK and one town — Wisbech — was held out
 * of the rollout, because portal proposed-update #139 was with the customer and a
 * rebuild would have superseded a version somebody was still deciding on. Its
 * committed sheets then stopped reproducing under the current engine, the board
 * reported DIFF and exited 1, and it would have gone on doing so until a customer
 * answered an email. The first fix EXCUSED the DIFF. That kept the board readable
 * and checked nothing: a genuine regression in that town's committed artwork — a
 * bad merge, a stray edit, a truncated file — would have been invisible for the
 * whole window.
 *
 * The real fix asks a different question of a held-back town: not "does this
 * reproduce under the CURRENT engine", whose answer we know and have decided we
 * do not mind, but "does it still reproduce under the engine it was BUILT with".
 * That is exact and falsifiable, and this file is where it gets falsified —
 * because the failure mode of the thing it replaced was precisely a check that
 * could not go red, and swapping a silent excuse for a green light would be no
 * better.
 *
 * `prove-red-status.js` cannot reach any of this. It falsifies the engine
 * STALENESS gate — "was this map drawn by the current engine at all" — which is a
 * different question about the same row, and its injected exceptions carry no
 * `commit` at all. The two files sit beside each other on purpose.
 *
 * THE CASES. Eight, and none is padding; each names a way this could be wrong.
 *
 *   A  held back, artwork untouched            -> PASS, exit 0   (the control)
 *   B  held back, a COMMITTED SHEET ALTERED    -> DIFF, exit 1   (the finding)
 *   C  held back, allowance names no `commit`  -> exit 1         (cannot look is red)
 *   D  held back, allowance names a WRONG one  -> exit 1         (a lying pair is refused)
 *   E  NOT held back, same altered sheet       -> exit 1         (the exception has not widened)
 *   F  held back, live gate already PASSES     -> exit 0         (no `commit` needed)
 *   G  the commit is NOT IN THE CLONE           -> PASS, exit 0   (it fetches it)
 *   H  the commit is nowhere to be had          -> exit 1         (and says the fetch failed)
 *
 * G AND H ARE ABOUT THE MACHINE, NOT THE ESTATE, AND THEY COST A DAY OF RED
 * (OA-217, 2026-09-01). Every case above assumes the named commit is in the
 * clone this runs in, which is true of every laptop and false of every
 * `actions/checkout`, whose clone is one commit deep. buses-data's gates
 * workflow went red on a perfectly good Wisbech reading `fatal: invalid
 * reference` while this file was green on the machine it was written on and in
 * the OTHER repository's CI, where a setup step happened to fetch the sha. The
 * setup step is gone: status.js fetches the commit itself now, and G is the only
 * place that path is ever taken -- on a laptop the first worktree add succeeds
 * and the fetch never runs, which is the shape of a feature flag left on
 * everywhere.
 *
 * B IS THE ONE THAT MATTERS AND A AND F ARE WHAT MAKE IT MEAN ANYTHING. A red
 * that is red in every arrangement proves nothing; F in particular guards the
 * design decision that `commit` is required exactly when the artwork moved, so a
 * byte-neutral allowance — which is what every one of them was before 2026-09-01
 * — keeps working with no new field.
 *
 * AND THE FIXTURE THEY ARE ALL POSED ON IS DERIVED, OR ELSE BUILT (OA-219,
 * 2026-09-01). Six of the eight need a town whose committed sheets do NOT
 * reproduce under the current engine, plus a commit that produces the engine they
 * were drawn by. Today the estate supplies exactly one — Wisbech, held out of an
 * ink-moving rollout while portal update #139 is with the customer — and when
 * that is answered it will supply none. The triple is read out of status.js's own
 * ENGINE_STALE_ALLOWED, so a premise that fails here is a live allowance the
 * BOARD cannot honour either; and when there is no such entry the fixture is
 * SYNTHESISED, so the day nothing is held back is a day this file still runs.
 * `--synthetic` forces that path. See the block above `liveAllowance()`.
 *
 * NOTHING UNDER Areas/ OR Places/ IS TOUCHED. Every case builds a scratch buses
 * tree holding one town's manifest.json and its tracked ci-reference/, and a
 * scratch copy of assets/ whose ENGINE_STALE_ALLOWED is replaced wholesale. That
 * mirrors prove-red-status.js deliberately: same shape, so the next person to
 * change ENGINE_STALE_ALLOWED finds both — including the anchor, which in both
 * files now refuses to cross a `]`, for a reason worth reading before changing it.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');
const { resolveBuses } = require('../assets/cli');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const SKILLS_REPO = path.resolve(ASSETS, '..', '..');
const argOf = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BUSES = resolveBuses({ buses: argOf('buses') });

let failures = 0;
const fail = (m) => { console.error('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

/* ---- WHICH TOWN, WHICH ENGINE, WHICH COMMIT (rewritten 2026-09-01, OA-219) --
 *
 * The first version read the TOWN's engine hash off the estate, with a comment
 * saying why — so that retiring the live Wisbech entry could not break this the
 * way a live-exception dependency broke prove-red-status's control in August —
 * and then hard-coded Wisbech's COMMIT as a literal two lines later. Half the
 * lesson, applied to half the fixture. Measured rather than predicted: posing the
 * default town against any other real commit produces FOUR failures, three of
 * them inside case A, and the sentence that actually explains it (`commit …
 * produces engine …, not the … this entry claims`) arrives in the middle of a
 * dumped board. A session reading that reaches for "something regressed", which
 * is the exact disguise this file was written to avoid.
 *
 * SO THE WHOLE TRIPLE IS DERIVED, from the one place that cannot disagree with
 * the board: status.js's own ENGINE_STALE_ALLOWED. If a live entry names a town,
 * an engine and a commit, that is the fixture — the same three facts the board
 * will act on, so a premise that does not hold here is a live allowance the board
 * cannot honour either, which is a finding rather than a stale test.
 *
 * AND WHEN THERE IS NO SUCH ENTRY, IT BUILDS ONE. That is the state the estate is
 * heading for: portal proposed-update #139 is with the customer, and when it is
 * answered Wisbech gets a real rebuild and the allowance goes. Skipping then would
 * leave the mechanism untested for as long as nobody is held back — a coverage
 * cliff arriving silently on a day nobody is thinking about this file. Instead the
 * fixture is SYNTHESISED: a two-commit engine repository in the temp dir and a
 * sheet redrawn by its first commit, which is the same move this file already
 * makes for the allowance itself (inject it, never borrow it) taken one level
 * deeper. `--synthetic` forces that path so it is exercised on demand rather than
 * lying dormant until the day it is needed.
 *
 * `--town` and `--commit` still override, and an override that cannot be posed is
 * an error rather than a fallback: somebody asked for something specific. */
const WANT_SYNTHETIC = process.argv.includes('--synthetic');
const TOWN_ARG = argOf('town', null);
const COMMIT_ARG = argOf('commit', null);

/* THE ANCHOR, ONCE, AND WHY IT REFUSES TO CROSS A BRACKET (OA-219).
 *
 * Both readers below used `\[[\s\S]*?\n\];` — the declaration as it is written
 * today, which spans lines and closes on its own. Emptied to `[]` on ONE line,
 * that anchor does not stop there: it runs on to the next `\n];` anywhere in the
 * file and swallows everything between. The hit-count guard does not save you,
 * because an over-match is still exactly one match — the scratch status.js came
 * out with a function definition deleted and threw `gateTown is not defined`,
 * and the ten failures that followed said nothing about the gate. Found on
 * 2026-09-01 while simulating the day the last live allowance retires, which is
 * precisely when somebody types `= [];`.
 *
 * `[^\[\]]*` cannot leave the array. It matches the one-line form and the
 * multi-line one, and on anything it does not understand it matches NOTHING,
 * which the hit-count guard does catch. Same form prove-red-status.js uses. */
const DECL_RE = /const ENGINE_STALE_ALLOWED = \[([^\[\]]*)\];/;

/** The live allowance list, read out of status.js rather than duplicated here. */
function liveAllowance() {
  const src = fs.readFileSync(path.join(ASSETS, 'status.js'), 'utf8');
  const m = src.match(DECL_RE);
  if (!m) return null;
  const town = [...m[1].matchAll(/town:\s*'([^']+)'[\s\S]*?engine:\s*'([^']+)'[\s\S]*?commit:\s*'([0-9a-f]{40})'/g)];
  return town.length ? { town: town[0][1], engine: town[0][2], commit: town[0][3] } : null;
}

const live = liveAllowance();
const explicit = !!(TOWN_ARG || COMMIT_ARG);
let SYNTH = null;                      // set by useSynthetic(), read by runBoard and the cases
let PLACE = null;                      // the place half of the synthetic fixture (OA-430), or null
let TOWN, ENGINE, COMMIT, FIXTURE;

function fromEstate(town, commit) {
  const dir = path.join(BUSES, 'Areas', town);
  const ref = path.join(dir, 'ci-reference', 'routes.json');
  if (!fs.existsSync(ref)) {
    console.error(`prove-red-held-back: ${town} has no ci-reference/routes.json under ${dir}.`);
    console.error('  Point at a checkout that has one with --buses "<dir>", or name another town with --town.');
    process.exit(1);
  }
  TOWN = town;
  COMMIT = commit;
  ENGINE = JSON.parse(fs.readFileSync(ref, 'utf8')).engine;
  FIXTURE = 'the live allowance';
}

if (explicit) {
  if (!TOWN_ARG || !COMMIT_ARG) {
    console.error('prove-red-held-back: --town and --commit go together. One without the other pairs a named town '
      + 'with some other town\'s commit, which is the fixture bug this file was rewritten to remove.');
    process.exit(1);
  }
  fromEstate(TOWN_ARG, COMMIT_ARG);
  FIXTURE = 'the pair named on the command line';
} else if (live && !WANT_SYNTHETIC) {
  fromEstate(live.town, live.commit);
  if (ENGINE !== live.engine) {
    console.error(`prove-red-held-back: the live allowance says ${live.town} is at ${live.engine}, and its committed`);
    console.error(`  routes.json says ${ENGINE}. Those disagree, so the BOARD cannot honour that entry either — this`);
    console.error('  is a finding about ENGINE_STALE_ALLOWED, not about this harness. Fix the entry or rebuild the town.');
    process.exit(1);
  }
}

function copyDir(a, b) { fs.mkdirSync(b, { recursive: true }); fs.cpSync(a, b, { recursive: true }); }

/** A scratch buses tree holding just this town.
 *
 * On the synthetic fixture two things are overlaid on the borrowed town: the
 * internal sheet as the SYNTHETIC engine drew it, and that engine's hash in
 * routes.json. Those two together are what make the live gate say DIFF and the
 * second gate say PASS — the whole precondition the six cases below need, and the
 * thing the estate happens to supply today and will not for ever. */
function tree({ stampCommit } = {}) {
  const root = scratchDir('prove-held-back-');
  const src = path.join(BUSES, 'Areas', TOWN);
  const dst = path.join(root, 'Areas', TOWN);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'manifest.json'), path.join(dst, 'manifest.json'));
  copyDir(path.join(src, 'ci-reference'), path.join(dst, 'ci-reference'));
  const rjp = path.join(dst, 'ci-reference', 'routes.json');
  const rj = JSON.parse(fs.readFileSync(rjp, 'utf8'));
  if (SYNTH) {
    fs.writeFileSync(path.join(dst, 'ci-reference', 'internal.svg'), SYNTH.internalSvg);
    rj.engine = SYNTH.engine;
  }
  // `stampCommit` is the OA-430 half: the commit written into the MAP's own
  // routes.json, which is where every map in the estate carries it now and where
  // the allowance list carried it for exactly one town before.
  if (stampCommit) rj.engineCommit = stampCommit; else delete rj.engineCommit;
  if (SYNTH || stampCommit) fs.writeFileSync(rjp, JSON.stringify(rj, null, 2));
  return { root, town: dst };
}

/* ---- THE FIXTURE THIS FILE CAN ALWAYS BUILD (OA-219) ----------------------
 *
 * A two-commit engine repository in the temp dir, laid out the way status.js
 * expects (`<root>/make-bus-leaflet/assets`), plus the donor town's internal
 * sheet as its FIRST commit draws it.
 *
 *   C1  one extra comment line emitted immediately before the closing tag. It
 *       cannot move a label, cannot change a placement decision and cannot take a
 *       different branch on a different town's data — it just guarantees today's
 *       engine will not reproduce what it drew, which is the precondition for the
 *       second gate to be asked at all.
 *   C2  a comment appended to a HASHED source file: the same drawn sheet, a
 *       different closure hash. That is the fixture case D needs — a commit that
 *       resolves cleanly and is not the engine the entry claims. A commit whose
 *       OUTPUT differed would be caught by the byte compare instead, and would
 *       prove nothing about the pair assertion.
 *
 * The engine hash is read back out of C1's own worktree rather than computed from
 * the working tree, which is C2's state. Every sha and hash below is derived; the
 * only literal is the anchored edit, and that is asserted unique before use. */
const ANCHOR_SVG_CLOSE = "out('</svg>');";
function useSynthetic(why) {
  const root = scratchDir('prove-held-back-synth-');
  const assets = path.join(root, 'make-bus-leaflet', 'assets');
  copyDir(ASSETS, assets);
  /* THE PLACE SKILL GOES IN TOO (OA-430), and leaving it out was not a saving.
   * `computePlaceEngineVersion()` hashes the town closure AND the place one, so a
   * synthetic engine with no make-place-bus-leaflet cannot produce any place hash
   * at all: engineDirForCommit would compute every place file as MISSING, refuse
   * the pair, and cases M and N below would go green through the refusal in K
   * rather than through anything they are about. Same trap as L's first draft,
   * one directory further out. */
  copyDir(path.resolve(ASSETS, '..', '..', 'make-place-bus-leaflet', 'assets'),
          path.join(root, 'make-place-bus-leaflet', 'assets'));

  const gp = path.join(assets, 'gen_internal.js');
  const src = fs.readFileSync(gp, 'utf8');
  if (src.split(ANCHOR_SVG_CLOSE).length - 1 !== 1) {
    console.error('prove-red-held-back: expected exactly one `' + ANCHOR_SVG_CLOSE + '` in gen_internal.js. The '
      + 'synthetic fixture needs one anchored edit that certainly changes the drawn bytes and certainly changes '
      + 'nothing else; re-point it at whatever writes the closing tag now.');
    process.exit(1);
  }
  fs.writeFileSync(gp, src.replace(ANCHOR_SVG_CLOSE,
    "out('<!-- prove-red-held-back: synthetic engine -->');" + ANCHOR_SVG_CLOSE));

  const git = (...a) => {
    const r = spawnSync('git', ['-C', root, '-c', 'user.email=prove-red@localhost',
      '-c', 'user.name=prove-red-held-back', ...a], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error('prove-red-held-back: git ' + a[0] + ' failed building the synthetic engine: '
        + ((r.stderr || r.stdout || '').trim().split('\n')[0]));
      process.exit(1);
    }
    return (r.stdout || '').trim();
  };
  git('init', '--quiet');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'synthetic held-back engine: one extra line before the closing tag');
  const commit = git('rev-parse', 'HEAD');
  fs.appendFileSync(gp, '\n// prove-red-held-back: a comment that moves the hash and no ink\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'synthetic: a comment, so the hash moves and the sheet does not');
  const otherCommit = git('rev-parse', 'HEAD');

  const engineAt = (d) => require(path.join(d, 'engine_version.js')).computeEngineVersion(d);
  const wt = path.join(root, '__c1__');
  git('worktree', 'add', '--quiet', '--detach', wt, commit);
  const c1assets = path.join(wt, 'make-bus-leaflet', 'assets');
  const engine = engineAt(c1assets);
  if (engine === engineAt(assets)) {
    console.error('prove-red-held-back: the two synthetic commits hash the same (' + engine + '), so case D could '
      + 'not tell them apart. A comment in a hashed file is supposed to move the closure hash.');
    process.exit(1);
  }

  const ci = path.join(BUSES, 'Areas', TOWN, 'ci-reference');
  const { runGenerator } = require('../assets/gate_lib');
  const run = runGenerator(path.join(c1assets, 'gen_internal.js'), ci, { engineDir: c1assets });
  const outPath = path.join(run.tmpDir, 'internal.svg');
  if (!run.ok || !fs.existsSync(outPath)) {
    console.error('prove-red-held-back: the synthetic engine could not draw ' + TOWN + ': '
      + (run.stderr || 'no output').trim().split('\n').slice(0, 3).join(' / '));
    process.exit(1);
  }
  const internalSvg = fs.readFileSync(outPath, 'utf8');
  fs.rmSync(run.tmpDir, { recursive: true, force: true });
  if (internalSvg === fs.readFileSync(path.join(ci, 'internal.svg'), 'utf8')) {
    console.error('prove-red-held-back: the synthetic engine drew ' + TOWN + ' byte-for-byte as the live one, so the '
      + 'live gate will PASS and the second gate will never be asked. The anchored edit is not moving ink.');
    process.exit(1);
  }

  /* AND THE PLACE HALF OF THE SAME FIXTURE (OA-430). `gen_internal.js` draws a
   * place's internal sheet too, so the one anchored edit moves BOTH hashes and one
   * synthetic engine serves both halves. The place hash is read out of C1's own
   * worktree, naming C1's place assets explicitly — placeAssetsDir()'s default
   * reads PLACE_SKILL_ASSETS from the environment, and a hybrid of C1's town
   * generators and today's place ones is exactly what gate_lib's own header
   * records being caught by once. */
  const placeEngine = require(path.join(c1assets, 'engine_version.js'))
    .computePlaceEngineVersion(c1assets, path.join(wt, 'make-place-bus-leaflet', 'assets'));

  SYNTH = { root, commit, otherCommit, engine, placeEngine, internalSvg, c1assets };
  COMMIT = commit;
  ENGINE = engine;
  FIXTURE = 'a synthetic engine (' + why + ')';
  console.log('  ..    ' + why + ' — fixture SYNTHESISED: engine ' + engine + ' at ' + commit.slice(0, 7)
    + ', place engine ' + placeEngine + ', ' + TOWN + "'s internal sheet redrawn by it");
}

/* ---- THE PLACE FIXTURE (OA-430) ------------------------------------------
 *
 * A scratch buses tree holding ONE nested place and the shell of its parent town,
 * with the place's internal sheet redrawn by the synthetic engine and stamped
 * with the synthetic PLACE hash and commit. That is the same trick `tree()` plays
 * for a town, and it is needed because the estate supplies no place that is both
 * behind AND failing to reproduce: on the day this landed all twelve places were
 * behind and all twelve reproduced, so the place branch of the second question
 * would have shipped never having been executed at all.
 *
 * THE PARENT TOWN COMES TOO, MANIFEST AND ci-reference BOTH, and the second half
 * of that was learned the hard way: findPlaces() enumerates places THROUGH
 * findTowns(), so a place with no parent directory is simply not found and the
 * board exits 0 over an empty estate — the vacuous green this whole file exists
 * to refuse. Copying the manifest alone is worse still: the board then reads a
 * manifest naming an S4 run that is not on disk, with no ci-reference to fall
 * back to, and gate_lib throws ENOENT out of copyJsons before any place is
 * reached. The town is at the current engine, so it PASSes and takes no part in
 * the verdicts below.
 */
function placeTree({ stampCommit } = {}) {
  const root = scratchDir('prove-held-back-place-');
  const src = PLACE.dir;
  const dstTown = path.join(root, 'Areas', PLACE.town);
  const dst = path.join(dstTown, 'Places', PLACE.name);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(BUSES, 'Areas', PLACE.town, 'manifest.json'), path.join(dstTown, 'manifest.json'));
  copyDir(path.join(BUSES, 'Areas', PLACE.town, 'ci-reference'), path.join(dstTown, 'ci-reference'));
  fs.copyFileSync(path.join(src, 'manifest.json'), path.join(dst, 'manifest.json'));
  copyDir(path.join(src, 'ci-reference'), path.join(dst, 'ci-reference'));
  fs.writeFileSync(path.join(dst, 'ci-reference', 'internal.svg'), PLACE.internalSvg);
  const rjp = path.join(dst, 'ci-reference', 'routes.json');
  const rj = JSON.parse(fs.readFileSync(rjp, 'utf8'));
  rj.engine = SYNTH.placeEngine;
  if (stampCommit) rj.engineCommit = stampCommit; else delete rj.engineCommit;
  fs.writeFileSync(rjp, JSON.stringify(rj, null, 2));
  return { root, place: dst };
}

/* The first nested place, in name order, whose internal sheet the synthetic engine
 * draws DIFFERENTLY FROM TODAY'S — asked of the disk rather than named here, for
 * the reason OA-219 rewrote the town fixture: a name written into a harness is a
 * claim about today's estate.
 *
 * THE COMPARISON IS SYNTHETIC-AGAINST-TODAY AND NOT SYNTHETIC-AGAINST-THE-STORED
 * SHEET, and the first draft got that wrong in a way that produced a green case M
 * and a failing one. A place's committed internal.svg is POST-EDITED by
 * build_internal_place.js — the title and the "· Map v…" stamp, the two lines
 * PLACE_IGNORE exists to drop — so any raw generator output differs from it for
 * reasons the gate is specifically built to ignore. Every candidate therefore
 * "differed", the first one was taken, its synthetic sheet went into the fixture,
 * and the live gate then compared two raw outputs whose only real difference the
 * chosen place did not have. What the fixture actually needs is the difference the
 * GATE will see, so that is what is asked. */
function pickPlace() {
  const areas = path.join(BUSES, 'Areas');
  const { runGenerator } = require('../assets/gate_lib');
  for (const town of fs.readdirSync(areas).sort()) {
    const pdir = path.join(areas, town, 'Places');
    // The parent must have a ci-reference of its own, or placeTree() cannot build
    // a tree the board can read at all — see its header.
    if (!fs.existsSync(pdir) || !fs.existsSync(path.join(areas, town, 'ci-reference', 'routes.json'))) continue;
    for (const name of fs.readdirSync(pdir).sort()) {
      const ci = path.join(pdir, name, 'ci-reference');
      if (!fs.existsSync(path.join(ci, 'internal.svg')) || !fs.existsSync(path.join(ci, 'routes.json'))) continue;
      const draw = (assetsDir) => {
        const run = runGenerator(path.join(assetsDir, 'gen_internal.js'), ci, { engineDir: assetsDir });
        const out = path.join(run.tmpDir, 'internal.svg');
        const svg = run.ok && fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
        fs.rmSync(run.tmpDir, { recursive: true, force: true });
        return svg;
      };
      const synth = draw(SYNTH.c1assets);
      const today = draw(ASSETS);
      if (!synth || !today || synth === today) continue;
      return { town, name, dir: path.join(pdir, name), internalSvg: synth };
    }
  }
  return null;
}

/** A scratch engine whose ENGINE_STALE_ALLOWED is exactly `entries`. */
function engineWith(entries) {
  const root = scratchDir('prove-held-back-engine-');
  copyDir(ASSETS, path.join(root, 'assets'));
  const f = path.join(root, 'assets', 'status.js');
  const src = fs.readFileSync(f, 'utf8');
  // Replace the whole DECLARATION, not a value of it — the lesson prove-red-status
  // learned when a real entry appeared and its `= [];` anchor stopped matching.
  const hits = src.match(new RegExp(DECL_RE.source, 'g')) || [];
  if (hits.length !== 1) {
    console.error('prove-red-held-back: expected exactly one `const ENGINE_STALE_ALLOWED = [ ... ];` '
      + 'declaration in status.js, found ' + hits.length + '. Re-point this anchor at whatever replaced it.');
    process.exit(1);
  }
  fs.writeFileSync(f, src.replace(DECL_RE, 'const ENGINE_STALE_ALLOWED = ' + JSON.stringify(entries) + ';'));
  return f;
}

/* WHICH REPOSITORY HOLDS THE ENGINE THE FIXTURE NAMES. The real skills clone for
 * a live allowance; the scratch two-commit repository for a synthetic one. Every
 * case reads it through here rather than naming SKILLS_REPO, so neither fixture
 * is a special case anywhere below. */
const fixtureRepo = () => (SYNTH ? SYNTH.root : SKILLS_REPO);

/* `skillsRepo` — WHICH CLONE IS status.js ALLOWED TO LOOK IN. Defaults to the one
 * holding the fixture, which is what every case but G and H wants. Those two are
 * about a clone that does NOT hold the commit, and a parameter is the only way to
 * pose that question without moving the repository this file is running out of. */
function runBoard(statusPath, busesRoot, skillsRepo = fixtureRepo()) {
  /* POINT AT A PORTAL THAT IS NOT THERE, ON PURPOSE.
   *
   * Without this the scratch board reads the REAL portal checkout, and every
   * verdict here becomes a claim about whatever branch somebody else happens to
   * have it on. Caught by case A on the first run: a second session had it on
   * their own branch, the vendoring rows read MISSING, and the control went red
   * for the room's reason rather than its own — while B, C, D and E all went
   * "red" and would have been believed. status.js skips every portal check when
   * the directory does not exist, so an absent one is the clean isolation. */
  const r = spawnSync(process.execPath, [statusPath, '--buses', busesRoot, '--no-live',
                                         '--portal', path.join(busesRoot, '_no-portal-here')], {
    encoding: 'utf8', maxBuffer: 1 << 28,
    // SKILLS_REPO is the whole reason status.js takes the override: this copy of
    // assets/ lives in a temp folder that is no git repository, so without it the
    // worktree could never be made and every case would report "cannot look" for
    // a reason having nothing to do with the case.
    env: Object.assign({}, process.env, { SKILLS_REPO: skillsRepo }),
  });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}
const verdictOf = (out) => {
  const m = out.match(new RegExp('^' + TOWN + '\\s+\\S+\\s+(.*)$', 'm'));
  return m ? m[1] : '(no row)';
};

/* Break EVERY committed sheet the way a bad merge would: change drawn ink.
 *
 * All of them, not one. Damaging only internal.svg left the town's external and
 * schematic legitimately reading `PASS (own engine)`, so "no PASS (own engine)
 * anywhere" was false for an honest reason and case B failed on its own
 * assertion rather than on the code. Damaging the lot also widens what is being
 * proved: the fallback is exercised on all three sheet kinds, and the schematic
 * is the one that caught the hybrid-engine bug in the first place. */
function damage(townDir) {
  const dir = path.join(townDir, 'ci-reference');
  const hit = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.svg')) continue;
    const p = path.join(dir, f);
    const s = fs.readFileSync(p, 'utf8');
    const m = s.match(/<text [^>]*>([^<]{4,})<\/text>/);
    if (!m) continue;
    fs.writeFileSync(p, s.replace(m[0], m[0].replace(m[1], m[1].slice(0, -1) + 'X')));
    hit.push(f);
  }
  if (!hit.length) throw new Error('nothing to damage under ' + dir);
  return hit.join(', ');
}

const ALLOW = (extra = {}) => [Object.assign({ town: TOWN, engine: ENGINE, commit: COMMIT,
  since: '2026-09-01', why: 'injected by prove-red-held-back.js' }, extra)];

/* ---- CAN THE FIXTURE BE POSED AT ALL? (OA-219) ---------------------------
 *
 * ASKED BEFORE ANY CASE RUNS, because the failure it catches is one a reader
 * misreads. When the fixture is wrong, case A alone fails three times, case G
 * fails once, and the sentence that explains all four sits in the middle of a
 * dumped board — measured on 2026-09-01 by posing the default town against
 * another real commit. Four red assertions and no diagnosis reads as a
 * regression, and this file exists precisely so that a red here means the gate
 * is broken.
 *
 * The premise is one board run on an undamaged tree, and there are only three
 * answers worth telling apart:
 *
 *   PASS (own engine)   the fixture holds; run everything.
 *   CANNOT BE GATED     the commit and the engine do not pair. On a LIVE
 *                       allowance that is a finding about ENGINE_STALE_ALLOWED —
 *                       the board cannot honour that entry either — so it is red
 *                       and it says so. On a synthetic one it is this file's own
 *                       bug and equally red.
 *   PASS, no own engine the town's sheets reproduce under the CURRENT engine, so
 *                       the second gate is never asked. That is not a fault: it
 *                       is what a rebuilt town looks like. Synthesise a fixture
 *                       and carry on.
 */
function posePremise() {
  const t = tree();
  const { out } = runBoard(engineWith(ALLOW()), t.root);
  if (/PASS \(own engine\)/.test(out)) return { ok: true };
  const m = out.match(/CANNOT BE GATED: ([^\n]+)/);
  if (m) return { ok: false, fatal: true, why: m[1].split('. This row is red')[0] };
  return { ok: false, fatal: false, why: TOWN + "'s committed sheets reproduce under the CURRENT engine, so there "
    + 'is no second question to ask of them' };
}

/* A donor for the synthetic fixture: the first town, in name order, whose stamped
 * engine IS the current one. Asked rather than remembered — a name written here
 * would be a claim about today's estate, which is the whole complaint OA-219 was
 * filed about.
 *
 * The refusal says WHERE the remedy is (buses-data OA-341 item 2). The stamp is
 * computed from the engine in front of you, so any edit to a hashed engine file
 * empties the donor set at once; that reads as advice about a stale estate unless
 * the message says which estate was read and what re-stamps it. */
function pickDonor() {
  const areas = path.join(BUSES, 'Areas');
  const current = require('../assets/engine_version').computeEngineVersion();
  for (const name of fs.readdirSync(areas).sort()) {
    const rjp = path.join(areas, name, 'ci-reference', 'routes.json');
    if (!fs.existsSync(rjp)) continue;
    try { if (JSON.parse(fs.readFileSync(rjp, 'utf8')).engine === current) return name; } catch (e) {}
  }
  const fixture = path.resolve(BUSES).toLowerCase().startsWith(path.resolve(SKILLS_REPO).toLowerCase() + path.sep);
  console.error('prove-red-held-back: no town under ' + areas + ' carries the current engine stamp ' + current
    + ', so there is nothing to redraw a synthetic held-back sheet from. The stamp is computed from the engine in '
    + 'front of you, so any edit to a hashed engine file makes every town a non-donor at once.');
  console.error(fixture
    ? '  This is the fixture estate in claude-skills: re-stamp it in the same change, from make-bus-leaflet, with '
      + 'npm run fixture:estate -- --apply'
    : '  This is a real estate, outside claude-skills: rebuild one town there under this engine, or point --buses '
      + 'at the fixture estate, make-bus-leaflet/test/fixtures/estate, which CI gates instead.');
  process.exit(1);
}

if (!TOWN) {
  // No live allowance at all, or --synthetic was asked for. Nothing is held back,
  // which is the state the estate is heading for and is not a fault.
  TOWN = pickDonor();
  useSynthetic(WANT_SYNTHETIC ? '--synthetic' : 'no live entry in ENGINE_STALE_ALLOWED carries a commit');
} else {
  const premise = posePremise();
  if (!premise.ok && premise.fatal) {
    console.error('\nprove-red-held-back: the fixture cannot be posed, and it is not this harness that is wrong.');
    console.error('  ' + FIXTURE + ' names ' + TOWN + ' at ' + ENGINE + ', commit ' + COMMIT.slice(0, 7) + ', and:');
    console.error('  ' + premise.why);
    console.error('  The BOARD reads the same three facts, so it cannot gate that town either. Fix the entry in');
    console.error('  status.js, rebuild the town, or name a pair that holds with --town and --commit.');
    process.exit(1);
  }
  if (!premise.ok && explicit) {
    console.error('\nprove-red-held-back: ' + premise.why + '.');
    console.error('  You named that pair explicitly, so this is an error rather than a reason to substitute');
    console.error('  something else. Drop --town/--commit to use the live allowance, or add --synthetic.');
    process.exit(1);
  }
  if (!premise.ok) useSynthetic(premise.why);
}

// The place half is picked AFTER the fixture exists, because picking it means
// drawing each candidate with the synthetic engine and asking whether the bytes
// moved — the same question the town premise asks, and unanswerable before there
// is a synthetic engine to ask it of.
if (SYNTH) PLACE = pickPlace();

console.log(`\nOwn-engine gate — falsifying on ${TOWN} at engine ${ENGINE}, commit ${COMMIT.slice(0, 7)}`);
console.log(`Fixture: ${FIXTURE}\n`);

/* ---- A: the control ---------------------------------------------------- */
console.log('A  held back, artwork untouched — the control');
{
  const t = tree();
  const { out, code } = runBoard(engineWith(ALLOW()), t.root);
  if (!/PASS \(own engine\)/.test(out)) fail(`expected a PASS (own engine) row; got: ${verdictOf(out)}\n${out.slice(0, 1200)}`);
  else pass('PASS (own engine)');
  if (code !== 0) fail(`exit ${code}, expected 0. A control that is not green means the fixture is wrong, not the code.`);
  else pass('exit 0');
  if (!/GATED AGAINST THAT ENGINE/.test(out)) fail('the board does not SAY which engine the row was gated against');
  else pass('says which engine it used');
  // AND THE ROOM MUST BE QUIET. If the portal rows ever start appearing here, every
  // later case is red for a reason that is not its own and this file is worthless.
  if (/MISSING|DRIFTED/.test(out)) fail('the scratch board is reading a real portal — isolate it before believing any case below');
  else pass('no portal rows: the cases below are red only for their own reason');
}

/* ---- B: the finding ---------------------------------------------------- */
console.log('\nB  held back, a committed sheet ALTERED — the finding');
{
  const t = tree();
  const was = damage(t.town);
  const { out, code } = runBoard(engineWith(ALLOW()), t.root);
  if (/PASS \(own engine\)/.test(out)) fail(`a damaged sheet still reported PASS. The gate is not looking at the artwork. (damaged "${was}")\n${out.slice(0, 1200)}`);
  else pass('no longer PASS');
  if (!/\bDIFF\b/.test(out)) fail(`expected a DIFF verdict; row read: ${verdictOf(out)}`);
  else pass('DIFF');
  if (code === 0) fail('exit 0 — a regression in a held-back town\'s committed artwork does not move the exit code, which is the exact fault this row replaced');
  else pass(`exit ${code}`);
}

/* ---- C: cannot look is red, not quiet ---------------------------------- */
console.log('\nC  held back and DIFFERING, allowance names no `commit`');
{
  const t = tree();
  damage(t.town);
  const entry = ALLOW(); delete entry[0].commit;
  const { out, code } = runBoard(engineWith(entry), t.root);
  if (code === 0) fail('exit 0. "We could not check" must never be quieter than "we checked and it was fine".');
  else pass(`exit ${code}`);
  if (!/CANNOT BE GATED/.test(out)) fail('the board does not say WHY it could not check');
  else pass('says it could not be gated, and why');
}

/* ---- D: a lying pair is refused, not believed --------------------------- */
console.log('\nD  held back, allowance names a commit that does not produce that engine');
{
  const t = tree();
  /* A commit that RESOLVES CLEANLY and is not the engine this entry claims — the
   * two halves matter equally, because a commit the repository cannot find fails
   * this case for a completely different reason and the third assertion below is
   * what tells them apart. It caught exactly that on 2026-09-01: the fixture used
   * the real skills HEAD, which is not an object in the SYNTHETIC engine repo at
   * all, so the board said `invalid reference` and the case went red about the
   * fixture rather than the code. Each fixture supplies its own: the synthetic
   * one's second commit exists to be this, and for a live allowance the skills
   * repo's HEAD is real and emphatically not what built a held-back town. */
  const wrong = SYNTH ? SYNTH.otherCommit
    : execFileSync('git', ['-C', SKILLS_REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const { out, code } = runBoard(engineWith(ALLOW({ commit: wrong })), t.root);
  if (/PASS \(own engine\)/.test(out)) fail('a commit that produces a DIFFERENT engine was used to gate the sheets anyway — every verdict on that row would be about the wrong code');
  else pass('did not gate on the wrong engine');
  if (code === 0) fail('exit 0 — a recorded pair that is a lie was accepted silently');
  else pass(`exit ${code}`);
  if (!/produces engine/.test(out)) fail('the board does not name the mismatch it found');
  else pass('names the mismatch');
}

/* ---- E: a behind map with NOTHING to check out is red, not quiet --------
 *
 * THIS CASE CHANGED MEANING UNDER OA-430 AND THE OLD WORDING WOULD HAVE HIDDEN IT.
 * It read "the exception has not widened", and asserted that a town with no
 * allowance was gated against the CURRENT engine like every ordinary town. Now
 * every behind map gets the second question, so what this fixture actually poses
 * is a behind map that records no commit of its own AND has no allowance naming
 * one — a could-not-look, red for that reason rather than for a DIFF. Same exit
 * code, different sentence, and a case whose prose has stopped describing the code
 * is a case nobody can maintain. L below took over the job this one used to do. */
console.log('\nE  the SAME damaged sheet, no allowance and no engineCommit — nothing to look at');
{
  const t = tree();
  damage(t.town);
  const { out, code } = runBoard(engineWith([]), t.root);
  if (code === 0) fail('exit 0 — a behind map that could not be gated against anything stopped gating');
  else pass(`exit ${code}`);
  if (/own engine/.test(out)) fail('a map naming no commit was gated against some other engine anyway');
  else pass('did not invent an engine to gate against');
  if (!/CANNOT GATE|CANNOT BE GATED/.test(out)) fail('it never said it could not look, so this is indistinguishable from an ordinary DIFF');
  else pass('says it could not look');
}

/* ---- F: a byte-neutral allowance still needs no commit ------------------ */
console.log('\nF  held back, artwork reproduces under the CURRENT engine — no `commit` needed');
{
  /* POSED ON A DIFFERENT TOWN, and that is the point rather than a convenience.
   * This case needs a town whose sheets DO gate PASS against the live engine —
   * the state every allowance was in before 2026-09-01, when held-back changes
   * were byte-neutral. The borrowed town above is by construction not in that
   * state. Posing it on a rolled town proves the design decision that `commit` is
   * demanded exactly when the artwork moved, and never otherwise. */
  const OKTOWN = argOf('ok-town', 'Beaconsfield');
  const okSrc = path.join(BUSES, 'Areas', OKTOWN);
  const okRef = path.join(okSrc, 'ci-reference', 'routes.json');
  if (!fs.existsSync(okRef)) {
    console.log(`  ..    no ${OKTOWN} to borrow, so this case cannot be posed here — skipped, and said so`);
  } else {
    const okEngine = JSON.parse(fs.readFileSync(okRef, 'utf8')).engine;
    const root = scratchDir('prove-held-back-ok-');
    const dst = path.join(root, 'Areas', OKTOWN);
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(path.join(okSrc, 'manifest.json'), path.join(dst, 'manifest.json'));
    copyDir(path.join(okSrc, 'ci-reference'), path.join(dst, 'ci-reference'));
    const clean = runBoard(engineWith([]), root);
    if (clean.code !== 0) {
      console.log(`  ..    ${OKTOWN} does not gate clean on its own, so the premise is absent — skipped, and said so`);
    } else {
      pass(`premise: ${OKTOWN} gates PASS against the live engine with no allowance`);
      const entry = [{ town: OKTOWN, engine: okEngine, since: '2026-09-01', why: 'injected, byte-neutral, no commit' }];
      const { out, code } = runBoard(engineWith(entry), root);
      if (code !== 0) fail(`exit ${code}: an allowance with NO commit turned red a town whose sheets gate PASS on their own. That makes \`commit\` mandatory for every historic byte-neutral entry.
${out.slice(0, 900)}`);
      else pass('exit 0 — an allowance with no commit costs nothing while the live gate passes');
      if (/CANNOT BE GATED/.test(out)) fail('the board complained it could not gate a town it never needed to gate twice');
      else pass('did not ask the second question at all');
    }
  }
}

/* ---- G: the commit is not in the clone, and it goes and gets it --------- */
console.log('\nG  held back, the commit is NOT in the clone — it must fetch it');
{
  /* A ONE-DEEP CLONE WITH A REMOTE THAT HAS THE REST, which is exactly what
   * actions/checkout leaves behind and exactly the state buses-data's CI was in.
   * Cloned over `file://` deliberately: --depth is SILENTLY IGNORED on a plain
   * local path, so the obvious spelling gives a full clone and a case that proves
   * nothing. Asserted rather than assumed — if the shallow clone turns out to
   * hold the commit already, the fetch is never reached and a green here would be
   * green about nothing. */
  const shallow = path.join(scratchDir('prove-held-back-shallow-'), 'skills');
  const url = 'file://' + fixtureRepo().replace(/\\/g, '/');
  const cl = spawnSync('git', ['clone', '--quiet', '--depth', '1', url, shallow], { encoding: 'utf8' });
  if (cl.status !== 0) {
    console.log('  ..    could not make a one-deep clone of ' + SKILLS_REPO + ' ('
      + ((cl.stderr || cl.stdout || '').trim().split('\n')[0]) + ') — skipped, and said so');
  } else if (spawnSync('git', ['-C', shallow, 'cat-file', '-e', COMMIT + '^{commit}']).status === 0) {
    /* TWO REASONS A ONE-DEEP CLONE CAN HOLD IT, AND THE MESSAGE USED TO NAME ONLY
     * ONE (OA-219). The interesting one is that `--depth` was ignored — it is on a
     * plain local path, which is why the URL above is `file://`. The dull one is
     * that the fixture's commit simply IS the tip, in which case a one-deep clone
     * holds it perfectly correctly and the fixture, not the clone, is wrong. The
     * first version asserted the first reason for both, and a session that named
     * HEAD as --commit was sent to check a URL that was fine. */
    const tip = spawnSync('git', ['-C', shallow, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    const isTip = (tip.stdout || '').trim() === COMMIT;
    fail(isTip
      ? 'the fixture names the tip commit (' + COMMIT.slice(0, 7) + '), which a one-deep clone holds by '
        + 'definition — so there is nothing to fetch. Pose this on a commit that is not HEAD.'
      : 'the one-deep clone holds ' + COMMIT.slice(0, 7) + ' and it is not the tip, so --depth did not take. '
        + 'It is ignored on a plain local path; check the URL above is still a file:// one.');
  } else {
    pass('the clone genuinely does not hold ' + COMMIT.slice(0, 7));
    const t = tree();
    const { out, code } = runBoard(engineWith(ALLOW()), t.root, shallow);
    if (!/PASS \(own engine\)/.test(out)) fail('it did not recover: ' + verdictOf(out)
      + '\n' + out.slice(0, 900));
    else pass('PASS (own engine) — it fetched the commit and gated against it');
    if (code !== 0) fail('exit ' + code + ' — a commit that CAN be fetched must not redden the board');
    else pass('exit 0');
  }
}

/* ---- H: nowhere to be had — red, and it says the fetch was tried -------- */
console.log('\nH  held back, the commit is nowhere to be had');
{
  /* A well-formed sha that is not an object anywhere, in a clone with no remote
   * to ask. This is the honest end of G: the board must still be red, and it must
   * distinguish "I could not find it" from "I did not look" — a reader who cannot
   * tell those apart cannot tell a broken runner from a broken entry. */
  const bare = path.join(scratchDir('prove-held-back-bare-'), 'skills');
  fs.mkdirSync(bare, { recursive: true });
  spawnSync('git', ['-C', bare, 'init', '--quiet'], { encoding: 'utf8' });
  const sha = 'be5a1e00' + 'd0'.repeat(16);
  const t = tree();
  const { out, code } = runBoard(engineWith(ALLOW({ commit: sha })), t.root, bare);
  if (code === 0) fail('exit 0 — a commit nobody can produce was not a finding');
  else pass('exit ' + code);
  if (!/CANNOT BE GATED/.test(out)) fail('the board does not say it could not check');
  else pass('says it could not be gated');
  if (!/no remote|fetch/i.test(out)) fail('it never said whether it tried to FETCH the commit, so a bad '
    + 'runner and a bad entry read identically: ' + verdictOf(out));
  else pass('says what became of the fetch');
}

/* ---- I to L: THE SAME GATE, DRIVEN BY THE MAP'S OWN routes.json (OA-430) ----
 *
 * Cases A to H pose the commit in status.js's ENGINE_STALE_ALLOWED, which is
 * where the only commit in the estate lived until OA-430 and where a hand-written
 * one still may. Every map now carries its own in `ci-reference/routes.json`,
 * written by stampEngine() at build time, and that is the path the whole estate
 * takes — so it is the path that has to be watched go red, not the one three
 * towns a year use.
 *
 * THE ALLOWANCE LIST IS EMPTY IN ALL FOUR, deliberately. If any of these passed
 * while an injected entry happened to be standing, the case would prove that the
 * allowance still works and say nothing at all about the field it is named for.
 *
 *   I  behind, its own commit recorded, artwork untouched  -> PASS (own engine), 0
 *   J  behind, its own commit recorded, a sheet ALTERED     -> DIFF, exit 1
 *   K  behind, its own commit names a DIFFERENT engine      -> exit 1, names it
 *   L  AT THE CURRENT ENGINE, a sheet ALTERED               -> exit 1, no second question
 *
 * L IS A CONTROL, AND ITS FIRST DRAFT WAS GREEN FOR THE WRONG REASON — which was
 * found by mutating the code rather than by reading it, and is why the fixture
 * below is the fiddliest in the file. It stamped the map with the SYNTHETIC
 * engine's commit, which does not produce the current hash the map carries, so the
 * pair was a lie and the case went green through the refusal in K rather than
 * through being current at all. It now stamps the REAL skills HEAD and runs the
 * board against the REAL clone, so the only thing standing between this map and a
 * second question is that it is not behind. A control that is green because the
 * fixture could not be posed is the most expensive kind of green there is. */
console.log('\nI  behind, its OWN engineCommit recorded, artwork untouched — the control');
{
  const t = tree({ stampCommit: COMMIT });
  const { out, code } = runBoard(engineWith([]), t.root);
  if (!/PASS \(own engine\)/.test(out)) fail(`expected PASS (own engine) from routes.json alone; got: ${verdictOf(out)}\n${out.slice(0, 1200)}`);
  else pass('PASS (own engine), with no allowance anywhere');
  if (code !== 0) fail(`exit ${code}, expected 0 — a behind map whose sheets reproduce under their own engine is a chore, not a fault`);
  else pass('exit 0');
  if (!/ENGINE STALE \(information, not red\)/.test(out)) fail('the board does not report the staleness as the chore the worklist turns into a rebuild row');
  else pass('reported as a chore the worklist can make a row of');
}

console.log('\nJ  behind, its OWN engineCommit recorded, a committed sheet ALTERED');
{
  const t = tree({ stampCommit: COMMIT });
  const was = damage(t.town);
  const { out, code } = runBoard(engineWith([]), t.root);
  if (/PASS \(own engine\)/.test(out)) fail(`a damaged sheet still reported PASS (own engine) — the routes.json path is not looking at the artwork (damaged "${was}")\n${out.slice(0, 1200)}`);
  else pass('no longer PASS');
  if (!/\bDIFF\b/.test(out)) fail(`expected DIFF; row read: ${verdictOf(out)}`);
  else pass('DIFF');
  if (code === 0) fail('exit 0 — a regression in committed artwork does not move the exit code, which is the whole thing this file exists to refuse');
  else pass(`exit ${code}`);
}

console.log('\nK  behind, its OWN engineCommit names a commit that produces a different engine');
{
  const t = tree({ stampCommit: SYNTH ? SYNTH.otherCommit
    : execFileSync('git', ['-C', SKILLS_REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() });
  const { out, code } = runBoard(engineWith([]), t.root);
  if (/PASS \(own engine\)/.test(out)) fail('a stamp whose commit does not produce its own hash was believed — every verdict on that row would be about the wrong code');
  else pass('did not gate on the wrong engine');
  if (code === 0) fail('exit 0 — a (hash, commit) pair that cannot both be true was accepted silently');
  else pass(`exit ${code}`);
  if (!/produces engine/.test(out)) fail('the board does not name the mismatch it found');
  else pass('names the mismatch');
}

console.log('\nL  a map AT THE CURRENT ENGINE, a committed sheet ALTERED — no second question');
{
  const OKTOWN = argOf('ok-town', 'Beaconsfield');
  const okSrc = path.join(BUSES, 'Areas', OKTOWN);
  if (!fs.existsSync(path.join(okSrc, 'ci-reference', 'routes.json'))) {
    console.log(`  ..    no ${OKTOWN} to borrow, so this case cannot be posed here — skipped, and said so`);
  } else {
    const root = scratchDir('prove-held-back-current-');
    const dst = path.join(root, 'Areas', OKTOWN);
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(path.join(okSrc, 'manifest.json'), path.join(dst, 'manifest.json'));
    copyDir(path.join(okSrc, 'ci-reference'), path.join(dst, 'ci-reference'));
    // A TRUTHFUL pair, which is what makes this a control at all: the real skills
    // HEAD, in the real clone, against a map whose stamp is the current engine.
    // Stamping the synthetic commit instead — the first draft — made the pair a
    // lie, and the case then went green through the refusal case K proves rather
    // than through being current, which is a control measuring the wrong thing.
    const rjp = path.join(dst, 'ci-reference', 'routes.json');
    const rj = JSON.parse(fs.readFileSync(rjp, 'utf8'));
    const head = execFileSync('git', ['-C', SKILLS_REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    rj.engineCommit = head;
    fs.writeFileSync(rjp, JSON.stringify(rj, null, 2));
    damage(dst);
    const { out, code } = runBoard(engineWith([]), root, SKILLS_REPO);
    if (/own engine/.test(out)) fail('a map at the CURRENT engine was given a second question — the byte gate now has a way round it');
    else pass('no second question asked');
    if (/CANNOT GATE|CANNOT BE GATED/.test(out)) fail('it refused the pair instead of ignoring it, so this case is measuring K and not itself: '
      + 'the stamped HEAD ' + head.slice(0, 7) + ' must produce the engine ' + OKTOWN + ' carries');
    else pass('the stamped pair is truthful, so nothing but currency stopped the second question');
    if (code === 0) fail('exit 0 — a damaged sheet on a current map stopped gating');
    else pass(`exit ${code}`);
  }
}

/* ---- M and N: A PLACE, WHICH HAD NO SECOND QUESTION AT ALL (OA-430) --------
 *
 * gatePlace() gated its five sheets against the live place template and nothing
 * else, from the day it was written until OA-430 — the same shape OA-170 found
 * here once before, a rule written about a town and never copied to the place
 * beside it. And the population makes it the half that matters: on the day this
 * landed all twelve behind maps in the estate were places and not one was a town.
 *
 * Posed only when the fixture is synthetic, because a live allowance names a TOWN
 * and there is no place equivalent of ENGINE_STALE_ALLOWED to borrow from. That
 * is not a gap: the routes.json path is the one every place actually uses. */
if (SYNTH && PLACE) {
  console.log('\nM  a PLACE, behind, its own engineCommit recorded, artwork untouched — the control');
  {
    const t = placeTree({ stampCommit: COMMIT });
    const { out, code } = runBoard(engineWith([]), t.root);
    if (!/PASS \(own engine\)/.test(out)) fail(`expected PASS (own engine) on ${PLACE.name}; got:\n${out.slice(0, 1400)}`);
    else pass('PASS (own engine)');
    if (code !== 0) fail(`exit ${code}, expected 0 — a behind PLACE whose sheets reproduce under their own engine is a chore, not a fault`);
    else pass('exit 0');
  }

  console.log('\nN  a PLACE, behind, its own engineCommit recorded, a committed sheet ALTERED');
  {
    const t = placeTree({ stampCommit: COMMIT });
    const was = damage(t.place);
    const { out, code } = runBoard(engineWith([]), t.root);
    if (/PASS \(own engine\)/.test(out)) fail(`a damaged place sheet still reported PASS (own engine) (damaged "${was}")\n${out.slice(0, 1400)}`);
    else pass('no longer PASS');
    if (code === 0) fail('exit 0 — a regression in a PLACE\'s committed artwork does not move the exit code');
    else pass(`exit ${code}`);
  }
} else if (SYNTH) {
  console.log('\nM/N  no place whose internal sheet the synthetic engine draws differently — skipped, and said so');
}

console.log(failures
  ? `\n${failures} FAILURE(S) — the own-engine gate is not doing what this file says it does.\n`
  : '\nAll cases behaved on ' + FIXTURE + ': a behind map is CHECKED against the engine it was built with — named by its own routes.json or by an allowance — a damaged sheet goes red, an unverifiable pair goes red, a commit the clone lacks is fetched, and a map at the current engine is given no second chance at all.\n');
process.exit(failures ? 1 : 0);
