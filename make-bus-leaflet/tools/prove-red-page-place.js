#!/usr/bin/env node
/*
 * prove-red-page-place.js — break `test/page.test.js` on purpose ACROSS THE SKILL
 * BOUNDARY, because a green check that has never been seen to go red proves nothing
 * and this is the half of that suite `tools/prove-red.js` structurally cannot reach.
 *
 *   node tools/prove-red-page-place.js
 *
 * Run from `make-bus-leaflet/`. No arguments.
 *
 * WHY IT NEEDS ITS OWN HARNESS. `prove-red.js` copies the TOWN `assets/` to a scratch
 * directory and points ENGINE_DIR at it. The place skill is not beside them there, so
 * `page.test.js`'s place half drops out of the population — loudly, by design, but it
 * drops out — and there is nothing for a `prove-red.js` row to mutate. Both OA-321 and
 * OA-322 say the same sentence in their step 4: the mutation cannot go in that table,
 * say where it went instead. This is where OA-322's went.
 *
 * THE REDIRECT IS THE WHOLE TRICK and it is two env vars, not a copied engine:
 *   PLACE_SKILL_ASSETS  — `engine_version.js`'s `placeAssetsDir()` reads it, which is
 *                         what `page.test.js` builds its place candidates from.
 *   ENGINE_DIR          — left pointing at the REAL town assets, because the town half
 *                         of the population is not the subject here and a copied engine
 *                         would only add a second thing that can be wrong.
 * The SUITE is copied too, with `_engine.js` beside it, so case 4 can mutate the test
 * rather than the generator. That case is the one that matters most: `KNOWN_LITERAL` is
 * EMPTY as of 2026-09-12, and a control that iterates nothing is green about everything.
 *
 * A CRASH IS NOT A RED. Every case asserts the assertion MESSAGE, not merely a non-zero
 * exit, so a suite that threw while reading a broken fixture cannot be counted as having
 * caught the fault it was aimed at.
 *
 * WATCHED LIVE BEFORE IT WAS WRITTEN. On 2026-09-12, with the generator fixed and the
 * exemption still present, the committed suite reported exactly one failure and it was
 * *every exemption is still earned*, naming the file and quoting OA-322's reason. Case 4
 * below is that observation turned into a case so it does not have to be remembered.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');

const SK = path.join(__dirname, '..');
const REAL_ASSETS = path.join(SK, 'assets');
const REAL_TEST = path.join(SK, 'test');
const SUITE = 'page.test.js';

const EV = require(path.join(REAL_ASSETS, 'engine_version.js'));
const REAL_PLACE = EV.placeAssetsDir(REAL_ASSETS);

const WORK = scratchDir('prove-red-page-place-');
const FIX_PLACE = path.join(WORK, 'place-assets');
const FIX_TEST = path.join(WORK, 'test');
fs.mkdirSync(FIX_PLACE, { recursive: true });
fs.mkdirSync(FIX_TEST, { recursive: true });

/* Only the .js files, and flat: the suite reads the place generators as TEXT and never
 * requires them, so nothing else in that folder can be read by this run. */
for (const f of fs.readdirSync(REAL_PLACE)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(REAL_PLACE, f), path.join(FIX_PLACE, f));
}
for (const f of [SUITE, '_engine.js']) {
  fs.copyFileSync(path.join(REAL_TEST, f), path.join(FIX_TEST, f));
}

const GEN = path.join(FIX_PLACE, 'gen_external_places.js');
const TESTFILE = path.join(FIX_TEST, SUITE);

const snapshot = new Map();
for (const p of [GEN, TESTFILE]) snapshot.set(p, fs.readFileSync(p));
const restore = () => { for (const [p, b] of snapshot) fs.writeFileSync(p, b); };

const run = () => {
  const r = spawnSync(process.execPath, ['--test', TESTFILE], {
    encoding: 'utf8',
    cwd: WORK,
    env: Object.assign({}, process.env, {
      PLACE_SKILL_ASSETS: FIX_PLACE,
      ENGINE_DIR: REAL_ASSETS,
    }),
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

let failures = 0;
const say = (ok, name, why) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ' — ' + why}`);
};

const edit = (p, from, to) => {
  const s = fs.readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`fixture anchor gone in ${path.basename(p)}: ${from.slice(0, 60)}`);
  fs.writeFileSync(p, s.replace(from, to));
};

console.log('prove-red-page-place — the page census, across the skill boundary\n');

/* ---- the control, and it counts its own population ---------------------- */
console.log('control:');
{
  const r = run();
  say(r.code === 0, 'the real suite passes against the copied place assets',
    `exit ${r.code}: ${r.out.trim().slice(0, 500)}`);

  // A fixture that had lost the place folder would make every mutation below pass for
  // the wrong reason: the suite announces the absence and checks the town files only.
  say(/place\/gen_external_places\.js carries no page size of its own/.test(r.out),
    'the place generator is IN the population the assertions ran over',
    'the suite never named it — PLACE_SKILL_ASSETS did not reach the copy');

  const present = EV.PLACE_ENGINE_FILES.filter((f) => fs.existsSync(path.join(FIX_PLACE, f)));
  say(present.length === EV.PLACE_ENGINE_FILES.length,
    'the fixture holds every file engine_version.js calls a place entry point',
    `only ${present.join(', ') || 'none'} copied of ${EV.PLACE_ENGINE_FILES.join(', ')}`);

  say(/const KNOWN_LITERAL = new Map\(/.test(fs.readFileSync(TESTFILE, 'utf8')),
    'the copied suite is the live one, exemption map and all',
    'KNOWN_LITERAL is not in the copied suite — case 4 would pass for the wrong reason');
  console.log(`        (${EV.PLACE_ENGINE_FILES.length} place entry points, suite copied from ${REAL_TEST})`);
}

/* ---- the mutations ------------------------------------------------------ */
const cases = [
  {
    name: 'the mm pair gets a second home again — OA-322 put back, exactly as it stood',
    expect: /place\/gen_external_places\.js keeps its own copy of the page size/,
    apply() {
      edit(GEN,
        "const { W, H, svgOpen } = require(_dep('page.js'));",
        "const W = 297, H = 210;\nconst { svgOpen } = require(_dep('page.js'));");
    },
  },
  {
    name: 'the root element is typed out again instead of coming from svgOpen()',
    expect: /place\/gen_external_places\.js keeps its own copy of the page size/,
    apply() {
      // The raster half alone. It compiles, it draws the same characters, and no byte
      // moves — which is exactly why this suite is the only thing standing under it.
      edit(GEN, 'out(svgOpen(W, H));',
        'out(`<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 ${W} ${H}">`);');
    },
  },
  {
    name: 'the place generator stops opening a page at all, silently shrinking the population',
    expect: /no place generator opens a page, yet the place assets folder is present/,
    apply() {
      edit(GEN, 'out(svgOpen(W, H));', 'out("");');
    },
  },
  {
    name: 'an exemption is granted to a file that no longer breaches the rule',
    expect: /no longer carries a page size of its own, so it does not need its exemption/,
    apply() {
      // The control's control. KNOWN_LITERAL is empty, so without this case nothing
      // here would ever exercise the assertion that retires a stale entry — and a
      // stale entry is a gate that is green about its own subject.
      edit(TESTFILE, 'const KNOWN_LITERAL = new Map([]);',
        "const KNOWN_LITERAL = new Map([['place/gen_external_places.js', 'a stale excuse']]);");
    },
  },
];

console.log('\nmutations:');
for (const c of cases) {
  restore();
  c.apply();
  const r = run();
  restore();

  if (r.code === 0) { say(false, c.name, 'the suite stayed GREEN — this fault is not covered'); continue; }
  say(c.expect.test(r.out), c.name, `red, but for the wrong reason: ${r.out.trim().slice(0, 500)}`);
}

/* ---- and green again ---------------------------------------------------- */
restore();
console.log('\ncontrol, repeated:');
{
  const r = run();
  say(r.code === 0, 'green again once every mutation is reverted',
    `exit ${r.code}: ${r.out.trim().slice(0, 500)}`);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log('');
if (failures) {
  console.error(`${failures} check${failures > 1 ? 's' : ''} failed — the page census's place half is not proven.`);
  process.exit(1);
}
console.log(`${cases.length} mutations, each caught for its own reason; controls green before and after.`);
