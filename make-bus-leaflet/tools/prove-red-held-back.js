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

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const SKILLS_REPO = path.resolve(ASSETS, '..', '..');
const argOf = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BUSES = argOf('buses', 'C:/u3a St Ives/Using AI/Buses');

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
function tree() {
  const root = scratchDir('prove-held-back-');
  const src = path.join(BUSES, 'Areas', TOWN);
  const dst = path.join(root, 'Areas', TOWN);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'manifest.json'), path.join(dst, 'manifest.json'));
  copyDir(path.join(src, 'ci-reference'), path.join(dst, 'ci-reference'));
  if (SYNTH) {
    fs.writeFileSync(path.join(dst, 'ci-reference', 'internal.svg'), SYNTH.internalSvg);
    const rjp = path.join(dst, 'ci-reference', 'routes.json');
    const rj = JSON.parse(fs.readFileSync(rjp, 'utf8'));
    rj.engine = SYNTH.engine;
    fs.writeFileSync(rjp, JSON.stringify(rj, null, 2));
  }
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

  SYNTH = { root, commit, otherCommit, engine, internalSvg };
  COMMIT = commit;
  ENGINE = engine;
  FIXTURE = 'a synthetic engine (' + why + ')';
  console.log('  ..    ' + why + ' — fixture SYNTHESISED: engine ' + engine + ' at ' + commit.slice(0, 7)
    + ', ' + TOWN + "'s internal sheet redrawn by it");
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
 * filed about. */
function pickDonor() {
  const areas = path.join(BUSES, 'Areas');
  const current = require('../assets/engine_version').computeEngineVersion();
  for (const name of fs.readdirSync(areas).sort()) {
    const rjp = path.join(areas, name, 'ci-reference', 'routes.json');
    if (!fs.existsSync(rjp)) continue;
    try { if (JSON.parse(fs.readFileSync(rjp, 'utf8')).engine === current) return name; } catch (e) {}
  }
  console.error('prove-red-held-back: no town carries the current engine stamp ' + current + ', so there is nothing '
    + 'to redraw a synthetic held-back sheet from. Rebuild a town, or run this after the next rollout.');
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

console.log(`\nHeld-back engine gate — falsifying on ${TOWN} at engine ${ENGINE}, commit ${COMMIT.slice(0, 7)}`);
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

/* ---- E: the exception has not widened ---------------------------------- */
console.log('\nE  the SAME damaged sheet, with no allowance at all');
{
  const t = tree();
  damage(t.town);
  const { out, code } = runBoard(engineWith([]), t.root);
  if (code === 0) fail('exit 0 — an ordinary town\'s damaged sheet stopped gating, so this change widened past held-back towns');
  else pass(`exit ${code}`);
  if (/own engine/.test(out)) fail('a town with no allowance was gated against some other engine');
  else pass('gated against the current engine, as every ordinary town is');
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

console.log(failures
  ? `\n${failures} FAILURE(S) — the held-back engine gate is not doing what this file says it does.\n`
  : '\nAll cases behaved on ' + FIXTURE + ': a held-back town is CHECKED against the engine it was built with, a damaged sheet goes red, an unverifiable allowance goes red, a commit the clone lacks is fetched, and no ordinary town was excused anything.\n');
process.exit(failures ? 1 : 0);
