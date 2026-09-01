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
 * THE CASES. Six, and none is padding; each names a way this could be wrong.
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
 * NOTHING UNDER Areas/ OR Places/ IS TOUCHED. Every case builds a scratch buses
 * tree holding one town's manifest.json and its tracked ci-reference/, and a
 * scratch copy of assets/ whose ENGINE_STALE_ALLOWED is replaced wholesale. That
 * mirrors prove-red-status.js deliberately: same shape, so the next person to
 * change ENGINE_STALE_ALLOWED finds both.
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

/* ---- the town this borrows, and the engine it was built with --------------
 * Read off the estate rather than hard-coded, so retiring the live Wisbech entry
 * cannot break this the way a live-exception dependency broke prove-red-status's
 * control in August. What IS fixed is the pair: whichever town is borrowed, the
 * commit injected below must genuinely produce the hash its routes.json carries,
 * because case A's whole claim is that the sheets reproduce under it. */
const TOWN = argOf('town', 'Wisbech');
const COMMIT = argOf('commit', '9347f7dee6061e5cae94377e9a1886bbfc7b6d30');
const srcTown = path.join(BUSES, 'Areas', TOWN);
const refRoutes = path.join(srcTown, 'ci-reference', 'routes.json');
if (!fs.existsSync(refRoutes)) {
  console.error(`prove-red-held-back: ${TOWN} has no ci-reference/routes.json under ${srcTown}.`);
  console.error('  Point at a checkout that has one with --buses "<dir>", or name another town with --town.');
  process.exit(1);
}
const ENGINE = JSON.parse(fs.readFileSync(refRoutes, 'utf8')).engine;

function copyDir(a, b) { fs.mkdirSync(b, { recursive: true }); fs.cpSync(a, b, { recursive: true }); }

/** A scratch buses tree holding just this town. */
function tree() {
  const root = scratchDir('prove-held-back-');
  const dst = path.join(root, 'Areas', TOWN);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(srcTown, 'manifest.json'), path.join(dst, 'manifest.json'));
  copyDir(path.join(srcTown, 'ci-reference'), path.join(dst, 'ci-reference'));
  return { root, town: dst };
}

/** A scratch engine whose ENGINE_STALE_ALLOWED is exactly `entries`. */
function engineWith(entries) {
  const root = scratchDir('prove-held-back-engine-');
  copyDir(ASSETS, path.join(root, 'assets'));
  const f = path.join(root, 'assets', 'status.js');
  const src = fs.readFileSync(f, 'utf8');
  // Replace the whole DECLARATION, not a value of it — the lesson prove-red-status
  // learned when a real entry appeared and its `= [];` anchor stopped matching.
  const DECL = /const ENGINE_STALE_ALLOWED = \[[\s\S]*?\n\];/g;
  const hits = src.match(DECL) || [];
  if (hits.length !== 1) {
    console.error('prove-red-held-back: expected exactly one `const ENGINE_STALE_ALLOWED = [ ... \\n];` '
      + 'declaration in status.js, found ' + hits.length + '. Re-point this anchor at whatever replaced it.');
    process.exit(1);
  }
  fs.writeFileSync(f, src.replace(DECL, 'const ENGINE_STALE_ALLOWED = ' + JSON.stringify(entries) + ';'));
  return f;
}

/* `skillsRepo` — WHICH CLONE IS status.js ALLOWED TO LOOK IN. Defaults to the
 * real one, which is what every case but G and H wants. Those two are about a
 * clone that does not hold the commit, and a parameter is the only way to pose
 * that question without moving the repository this file is running out of. */
function runBoard(statusPath, busesRoot, skillsRepo = SKILLS_REPO) {
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

console.log(`\nHeld-back engine gate — falsifying on ${TOWN} at engine ${ENGINE}, commit ${COMMIT.slice(0, 7)}\n`);

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
  // HEAD is a real commit and emphatically not the one that built this town.
  const wrong = execFileSync('git', ['-C', SKILLS_REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
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
  const url = 'file://' + SKILLS_REPO.replace(/\\/g, '/');
  const cl = spawnSync('git', ['clone', '--quiet', '--depth', '1', url, shallow], { encoding: 'utf8' });
  if (cl.status !== 0) {
    console.log('  ..    could not make a one-deep clone of ' + SKILLS_REPO + ' ('
      + ((cl.stderr || cl.stdout || '').trim().split('\n')[0]) + ') — skipped, and said so');
  } else if (spawnSync('git', ['-C', shallow, 'cat-file', '-e', COMMIT + '^{commit}']).status === 0) {
    fail('the one-deep clone already holds ' + COMMIT.slice(0, 7) + ', so the fetch is never reached. '
      + '--depth is ignored on a local-path clone; check the file:// URL above still is one.');
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
  : '\nAll cases behaved: a held-back town is CHECKED against the engine it was built with, a damaged sheet goes red, an unverifiable allowance goes red, and no ordinary town was excused anything.\n');
process.exit(failures ? 1 : 0);
