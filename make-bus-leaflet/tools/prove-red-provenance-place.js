#!/usr/bin/env node
/*
 * prove-red-provenance-place.js — break `test/provenance_date.test.js` on purpose
 * ACROSS THE SKILL BOUNDARY, because a green check that has never been seen to go red
 * proves nothing and this is the half of that suite `tools/prove-red.js` structurally
 * cannot reach.
 *
 *   node tools/prove-red-provenance-place.js
 *
 * Run from `make-bus-leaflet/`. No arguments.
 *
 * WHY IT NEEDS ITS OWN HARNESS, and it is the same reason as its sibling
 * `prove-red-page-place.js`. `prove-red.js` copies the TOWN `assets/` to a scratch
 * directory and points ENGINE_DIR at it. The place skill is not beside them there, so
 * `provenance_date.test.js` announces the absence and checks the town generators only —
 * loudly, by design, but the place half drops out, and there is nothing for a
 * `prove-red.js` row to mutate. OA-321 step 3 says exactly that and asks where the
 * mutation went instead. This is where it went.
 *
 * WHAT THE SUBJECT IS. Until 2026-09-22 `gen_external_places.js` printed "cross-checked
 * with operators" and read `checkedAt` nowhere, so three live place sheets asserted that
 * a cross-check had happened and were structurally incapable of ever saying when — the
 * OA-153 fault in its dateless form, on the class of sheet a member of the public had
 * already reported four real faults on. OA-321 gave the footer the same treatment the
 * town radial has had since 2026-08-28. These mutations are every way that can come
 * undone: the read deleted, the absent case defaulted to a guess, a date typed into the
 * source where it is the same on every map, and the exemption that excused it all put
 * back after the fix.
 *
 * THE REDIRECT IS THE WHOLE TRICK and it is two env vars, not a copied engine:
 *   PLACE_SKILL_ASSETS  — `engine_version.js`'s `placeAssetsDir()` reads it, which is
 *                         what the suite builds its place candidates from.
 *   ENGINE_DIR          — left pointing at the REAL town assets, because the town half
 *                         of the population is not the subject here and a copied engine
 *                         would only add a second thing that can be wrong.
 * The SUITE is copied too, with `_engine.js` beside it, so cases 5 and 6 can mutate the
 * TEST rather than the generator. Those are the ones that matter most: `KNOWN_DATELESS`
 * is EMPTY as of 2026-09-22, and a control that iterates nothing is green about
 * everything — which is precisely the state the same map was in before OA-321.
 *
 * A CRASH IS NOT A RED. Every case asserts the assertion MESSAGE, not merely a non-zero
 * exit, so a suite that threw while reading a broken fixture cannot be counted as having
 * caught the fault it was aimed at.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');

const SK = path.join(__dirname, '..');
const REAL_ASSETS = path.join(SK, 'assets');
const REAL_TEST = path.join(SK, 'test');
const SUITE = 'provenance_date.test.js';

const EV = require(path.join(REAL_ASSETS, 'engine_version.js'));
const REAL_PLACE = EV.placeAssetsDir(REAL_ASSETS);

const WORK = scratchDir('prove-red-provenance-place-');
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

/* The live footer's cross-check clause, quoted once so every case below anchors on the
 * same text. Double-quoted on purpose: it carries backticks, a `${` and a pair of empty
 * single quotes, and a JS double-quoted string takes all three verbatim. */
const CLAUSE = "cross-checked with operators${D.checkedAt ? ` (${D.checkedAt})` : ''}.";

console.log('prove-red-provenance-place — the cross-check date, across the skill boundary\n');

/* ---- the control, and it counts its own population ---------------------- */
console.log('control:');
{
  const r = run();
  say(r.code === 0, 'the real suite passes against the copied place assets',
    `exit ${r.code}: ${r.out.trim().slice(0, 500)}`);

  // A fixture that had lost the place folder would make every mutation below pass for
  // the wrong reason: the suite announces the absence and checks the town files only.
  say(/place\/gen_external_places\.js reads checkedAt from the map's own config/.test(r.out),
    'the place generator is IN the population the assertions ran over',
    'the suite never named it — PLACE_SKILL_ASSETS did not reach the copy');

  say(!/the place assets folder is not at/.test(r.out),
    'the suite did NOT take its own announced skip path',
    'the suite said the place folder was missing, so the place half was never checked');

  const present = EV.PLACE_ENGINE_FILES.filter((f) => fs.existsSync(path.join(FIX_PLACE, f)));
  say(present.length === EV.PLACE_ENGINE_FILES.length,
    'the fixture holds every file engine_version.js calls a place entry point',
    `only ${present.join(', ') || 'none'} copied of ${EV.PLACE_ENGINE_FILES.join(', ')}`);

  say(/const KNOWN_DATELESS = new Map\(/.test(fs.readFileSync(TESTFILE, 'utf8')),
    'the copied suite is the live one, exemption map and all',
    'KNOWN_DATELESS is not in the copied suite — cases 5 and 6 would pass for the wrong reason');
  console.log(`        (${EV.PLACE_ENGINE_FILES.length} place entry points, suite copied from ${REAL_TEST})`);
}

/* ---- the mutations ------------------------------------------------------ */
const cases = [
  {
    name: 'OA-321 put back — the footer claims a cross-check and reads checkedAt nowhere',
    expect: /never reads checkedAt, so its date cannot be per-map/,
    apply() {
      edit(GEN, CLAUSE, 'cross-checked with operators.');
    },
  },
  {
    name: 'an absent checkedAt is defaulted from validFrom, which is a different claim',
    expect: /falls back to validFrom, which is when the timetable takes effect/,
    apply() {
      // The temptation the suite exists to refuse, and it is not hypothetical: on
      // Huntingdon validFrom already disagrees with the real S1 date, so this mutation
      // manufactures a confident wrong date rather than printing none.
      edit(GEN, CLAUSE,
        "cross-checked with operators${D.checkedAt ? ` (${D.checkedAt})` : ` (${D.validFrom})`}.");
    },
  },
  {
    name: 'an absent checkedAt falls back to some other string instead of to nothing',
    expect: /must fall back to an empty string, not to another date/,
    apply() {
      // Weaker than the validFrom case and the same fault: the sheet says WHEN on a map
      // where nobody knows when. This one is here because the assertion is written about
      // the fallback's SHAPE, not about the word validFrom, and a test that only caught
      // the word would be green about every other guess.
      edit(GEN, CLAUSE,
        "cross-checked with operators${D.checkedAt ? ` (${D.checkedAt})` : ' (this season)'}.");
    },
  },
  {
    name: 'a month and year is typed into the generator, where it is the same on every map',
    expect: /carries the literal "August 2026" in code/,
    apply() {
      // The original OA-153 fault, which is a DIFFERENT assertion from the two above:
      // this one runs over every footer-drawing generator, not only the ones claiming a
      // cross-check. It goes into a string literal rather than a comment on purpose —
      // the suite strips comments, deliberately, so the files can keep quoting the old
      // wording while explaining what was removed.
      edit(GEN, CLAUSE, 'cross-checked with operators (August 2026).');
    },
  },
  {
    name: 'an exemption is granted to a file that has already been fixed',
    expect: /now reads checkedAt, so it no longer needs its exemption/,
    apply() {
      // The control's control. KNOWN_DATELESS is empty since OA-321, so without this
      // case nothing here would ever exercise the assertion that retires a stale entry
      // — and a stale entry is a gate that is green about its own subject. This is the
      // exact red that was watched live on 2026-09-22 with the fix in and the entry
      // still there, which is how the entry came to be deleted.
      edit(TESTFILE, 'const KNOWN_DATELESS = new Map([]);',
        "const KNOWN_DATELESS = new Map([['place/gen_external_places.js', 'a stale excuse']]);");
    },
  },
  {
    name: 'an exemption outlives the claim it excused — the footer stops cross-checking at all',
    expect: /no longer claims a cross-check in its footer/,
    apply() {
      // The OTHER arm of the same control, and it needs both files moved: an entry for a
      // generator that has dropped the claim is an excuse for a fault that no longer
      // exists, and it would sit there for ever excusing the NEXT one.
      edit(TESTFILE, 'const KNOWN_DATELESS = new Map([]);',
        "const KNOWN_DATELESS = new Map([['place/gen_external_places.js', 'a stale excuse']]);");
      edit(GEN, CLAUSE, 'compiled from published timetables.');
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
  console.error(`${failures} check${failures > 1 ? 's' : ''} failed — the cross-check date's place half is not proven.`);
  process.exit(1);
}
console.log(`${cases.length} mutations, each caught for its own reason; controls green before and after.`);
