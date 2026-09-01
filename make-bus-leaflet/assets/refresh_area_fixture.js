#!/usr/bin/env node
/*
 * refresh_area_fixture.js — restage `Areas/_portal-fixture/<Town>` from that
 * town's newest S5 render. (OA-182.)
 *
 * WHY THIS IS A SCRIPT AND NOT A README. The portal's byte gates run against two
 * committed fixtures, and until now they were refreshed by two different KINDS of
 * thing. `Places/_portal-fixture/High Wycombe Aldi` has `scripts/refresh-place-
 * fixture.mjs` in the portal, which reuses the verifier's own scratch/vendor/
 * generate path, so the reference is by construction what the gate will
 * regenerate. `Areas/_portal-fixture/St Ives` had a SHELL RECIPE IN A README —
 * and a recipe is a thing you have to remember to run, which is a different
 * category of guarantee from a thing you can run.
 *
 * It was forgotten three times in three days. The radial round forgot it; the
 * placer round forgot it again and was caught only by portal PR #162's own
 * `verify` job going red; and the place-index round found the PLACE fixture a
 * version behind as well. `status.js` now names a stale area fixture and gates on
 * it, which removed the harm; this removes the second mechanism.
 *
 * WHY A STALE FIXTURE IS WORSE THAN NO FIXTURE, in the words of the commit that
 * last fixed it: `verify-reproduce.mjs` runs the PACK'S OWN generator, which is
 * right — it is exactly what the live portal does with a delivered map. So a
 * frozen fixture is self-consistent by construction: the old engine reproduces
 * the old sheet perfectly, and the gate reports PASS about code that has not
 * shipped.
 *
 * IT ASKS THE MANIFEST WHICH RUN IS LATEST, never a directory listing. The README
 * this replaces said "`ls` lists them, newest last", and a string sort puts
 * `v1.9_2026-08-18` AFTER `v1.23_2026-08-30` one character in — which is the bug
 * `status.js`'s own freshness check shipped with and had to have fixed. Both now
 * ask `latestRunDir()`, so the tool that WRITES the fixture and the check that
 * JUDGES it cannot disagree about which run they mean.
 *
 * WHAT IS LEFT OUT, and it is copied from the README rather than reinvented:
 * the JPGs (rasterisation is platform-dependent by design, which is what
 * render-parity.yml is for, so 4.4 MB of JPG would buy a comparison expected to
 * differ for ever), `svc_*.html` and `build-warnings.txt` (nothing downstream
 * reads them). That takes the fixture from about 7.5 MB to about 2.8 MB.
 *
 * Run it from anywhere; every path below is derived. No placeholders:
 *     node "C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/refresh_area_fixture.js" --check
 *     node "C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/refresh_area_fixture.js" --apply
 *
 *     --check    say what would change and write nothing (the default)
 *     --apply    restage the fixture
 *     --town     which town the fixture is of (default St Ives)
 *     --buses    the Buses repo (default: Peter's laptop path)
 *
 * EXIT CODES.  0 = the fixture matches the newest render (--check), or was
 *                  restaged (--apply).
 *              1 = --check and the fixture is BEHIND. This is the same verdict
 *                  status.js gives, deliberately, so either can be used in a
 *                  script.
 *              2 = could not ask: no manifest, no S5 run on disk, no fixture.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readJson, latestRunDir, sameIgnoringLineEndings } = require('./gate_lib');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return (i >= 0 && argv[i + 1]) ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const TOWN = flag('--town', 'St Ives');
const BUSES = path.resolve(flag('--buses', 'C:/u3a St Ives/Using AI/Buses'));

function die(msg) { console.error('refresh_area_fixture.js: ' + msg); process.exit(2); }

/* The one list that says what a fixture is made of. It is a SKIP list rather than
 * a keep list on purpose: a generator that starts reading a new input would be
 * silently left out of a keep list, and the fixture would gate against a pack
 * missing the very file the change added. */
const skip = b => /\.jpg$/i.test(b) || /^svc_.*\.html$/i.test(b) || b === 'build-warnings.txt';

const townDir = path.join(BUSES, 'Areas', TOWN);
const fixDir = path.join(BUSES, 'Areas', '_portal-fixture', TOWN);
if (!fs.existsSync(townDir)) die(`no town at ${townDir}. Pass --town and --buses.`);

const manifest = readJson(path.join(townDir, 'manifest.json'));
if (!manifest) die(`no readable manifest.json at ${townDir}`);
const latest = latestRunDir(manifest, townDir, 'S5');
if (!latest || !latest.dir || !fs.existsSync(latest.dir)) {
  die(`the manifest names no S5 run that is on this disk. S5-render/ is gitignored, so a fresh clone or a worktree cannot do this — run it where the render is.`);
}
const src = latest.dir;
const wanted = fs.readdirSync(src).filter(b => !skip(b)).sort();

console.log(`refresh_area_fixture — ${TOWN}`);
console.log(`  newest S5 run   : ${path.basename(src)}   (from the manifest, not a directory listing)`);
console.log(`  fixture         : ${fixDir}`);
try {
  const rj = readJson(path.join(src, 'routes.json'));
  if (rj && rj.engine) console.log(`  engine stamp    : ${rj.engine}   — name this in the commit note`);
} catch { /* the stamp is a courtesy, not a precondition */ }

const have = fs.existsSync(fixDir) ? fs.readdirSync(fixDir).sort() : [];
const added = wanted.filter(b => !have.includes(b));
const removed = have.filter(b => !wanted.includes(b));
/* Compared the way the GATE compares — line endings ignored — so this tool and
 * status.js cannot disagree about whether the fixture is current. */
const changed = wanted.filter(b => have.includes(b)
  && !sameIgnoringLineEndings(path.join(src, b), path.join(fixDir, b)));

const moved = added.length + removed.length + changed.length;
console.log(`  files           : ${wanted.length} in the run, ${have.length} in the fixture`);
if (!moved) {
  console.log(`\n  CURRENT — the fixture is byte-for-byte the newest render. Nothing to do.`);
  process.exit(0);
}
for (const b of changed) console.log(`    changed : ${b}`);
for (const b of added) console.log(`    added   : ${b}`);
for (const b of removed) console.log(`    removed : ${b}   (in the fixture, not in the run)`);

if (!APPLY) {
  console.log(`\n  BEHIND — ${moved} file(s) differ. Re-run with --apply, then from the PORTAL repo`);
  console.log(`  (C:\\Claude\\community-bus-maps) confirm both gates still pass against the COMMITTED`);
  console.log(`  fixture — with FIXTURE_DIR unset, so you are testing this folder and not whatever`);
  console.log(`  your .env points at:`);
  console.log(`      npm run verify:area && npm run verify:defaults`);
  process.exit(1);
}

/* Rebuilt rather than patched: a file the run no longer writes must LEAVE the
 * fixture, and a fixture that only ever gains files gates against a pack the
 * engine has stopped producing. */
fs.rmSync(fixDir, { recursive: true, force: true });
fs.mkdirSync(fixDir, { recursive: true });
for (const b of wanted) fs.copyFileSync(path.join(src, b), path.join(fixDir, b));

console.log(`\n  RESTAGED — ${wanted.length} file(s) from ${path.basename(src)}.`);
console.log(`  Now, from the PORTAL repo (C:\\Claude\\community-bus-maps), with FIXTURE_DIR unset:`);
console.log(`      npm run verify:area && npm run verify:defaults`);
console.log(`  Then commit with a note saying WHICH ENGINE CHANGE moved the bytes. A fixture`);
console.log(`  refresh with no explanation is indistinguishable from one that hid a regression.`);
console.log(`\n  And do the PLACE fixture in the same breath — they are two mechanisms for one`);
console.log(`  job and forgetting the other one is how this row was opened. From the portal:`);
console.log(`      node scripts/refresh-place-fixture.mjs`);
