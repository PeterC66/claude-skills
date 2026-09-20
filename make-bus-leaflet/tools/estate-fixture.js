#!/usr/bin/env node
/*
 * estate-fixture.js — the miniature map estate this repository OWNS, and the
 * thing that keeps it in step with the engine that draws it (buses-data OA-398,
 * R5 of the 2026-09-17 process review).
 *
 * WHY THERE IS A MAP ESTATE IN THE ENGINE REPOSITORY AT ALL.
 *
 * Until 2026-09-18 the `status` job in `.github/workflows/gates.yml` cloned the
 * PRIVATE buses-data repository with CROSS_REPO_PAT2 and ran nine harnesses and
 * the whole-estate board against it. Two things were wrong with that, and only
 * one of them was the token.
 *
 *   THE TOKEN. It expires on 22 November 2026. `status` is a required check here,
 *   `strict` is on and so is `enforce_admins`, so its expiry would have blocked
 *   every pull request in this repository outright.
 *
 *   THE FLOATING REF. The checkout named no `ref:`, so a verdict was about
 *   whatever buses-data's `main` held for the minutes the job ran. buses-data's
 *   own CLAUDE.md records run 34607735390, red on the quality ratchet four
 *   minutes after an innocent engine commit, because of a buses-data commit
 *   pushed 95 minutes earlier in another repository.
 *
 * AND THE ORDERING TRAP (OA-341), WHICH IS WHAT THIS FILE ACTUALLY FIXES.
 * `prove-red-held-back` needs a donor town — one whose stamped engine IS the
 * current one — and the stamp is a hash of the engine's own files. So ANY edit to
 * ANY hashed engine file made every town in that estate a non-donor at once, and
 * the harness exited 1 before a single case ran. Appending one comment line to
 * `icons.js` was enough. An engine pull request therefore opened RED and the only
 * thing that could clear it was a commit in the OTHER repository.
 *
 * A fixture this repository owns breaks that, because the same pull request that
 * moves the ink re-stamps and redraws it. That is the ordinary snapshot
 * discipline every other byte gate in this estate already uses, and it is the
 * ordering trap turned into a normal step.
 *
 * WHAT IS LOST, SAID PLAINLY. This job no longer gates twenty-one maps on every
 * engine push. It gates five, twelve sheets between them. The full estate gate
 * runs in buses-data's own `gates.yml`, on the rebuild that follows an engine
 * change, where it is a statement about two commits somebody chose rather than
 * two that happened to be on `main` together. Narrower and truthful, against
 * wider and floating.
 *
 * WHAT IS IN IT, AND WHY EACH ONE IS THERE. Every map here earns its place by
 * being the only one that lets some check ask its question — this is not a
 * sample, and none of it is spare.
 *
 *   Areas/Beaconsfield                     an area WITH a place under it, so the
 *                                          nested layout is exercised
 *   .../Places/Beaconsfield Waitrose       that place
 *   Areas/March                            a plain town: a fault that needs two
 *                                          independent maps has somewhere to show
 *   Places/_standalone/High Wycombe Aldi    the only pack carrying an
 *                                          `overrides.json` beside a schematic,
 *                                          which is what `prove-red-gates`' own
 *                                          load-bearing control asks about
 *   Places/_standalone/High Wycombe High Street   the only pack with a BOARDING
 *                                          sheet — and a map that carries a
 *                                          boarding plan and nothing else, which
 *                                          is the case that proves an undeclared
 *                                          sheet is not a missing one
 *
 * THE LAST TWO ARE STANDALONE PLACES ON PURPOSE. On the real estate they sit
 * under High Wycombe, a 4 MB town this fixture has no other use for. Seeded as
 * standalone they need no town at all — and that is the third of the three place
 * layouts, the one `findPlaces()` could not see until 2026-08-21, when three
 * shipped maps turned out to have been ungated for a fortnight.
 *
 * Only `manifest.json`, `ci-reference/` and the latest S3 run are carried:
 * `ci-reference` is a complete pack — everything the generators read plus the
 * shipped SVGs they are compared against — and `latestRunDir()` already falls
 * back to it when the gitignored S4 run folder is absent, which is the case in
 * every CI checkout.
 *
 * THE MAPS THEMSELVES STILL LIVE IN buses-data. This is a COPY, seeded with
 * `--seed`, and a copy that quietly falls behind does not make a byte gate red —
 * it makes it green about last month's artwork. What stops that is not a
 * comparison against buses-data (this repository cannot do one, and should not
 * want to): it is that `--check` runs on every push and asks whether the CURRENT
 * engine still draws these bytes. If it does, the fixture is as good as the day
 * it was cut, whatever buses-data has done since.
 *
 * Run from `make-bus-leaflet`, with no placeholders:
 *
 *     npm run fixture:estate                 -- says what is behind, writes nothing
 *     npm run fixture:estate -- --apply      -- redraws the sheets and re-stamps
 *
 * Seeding another map in, once, from a buses-data checkout — `--from` is the only
 * argument here that names a path on a particular machine:
 *
 *     node tools/estate-fixture.js --seed --map "Areas/March" \
 *        --from "C:/u3a St Ives/Using AI/Buses"
 *
 * EXIT CODES are the house rule: 0 in step, 1 BEHIND (a finding), 2 used wrongly.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, die } = require('../assets/cli');
// loadManifest is the ONE manifest reader (OA-232 Tier 2.4); test/stage_module.test.js
// censuses assets/ and tools/ for anything that re-parses manifest.json inline, and
// it caught this file on the day it was written.
const { loadManifest } = require('../assets/stage');
const gl = require('../assets/gate_lib');

const ROOT = path.join(__dirname, '..');
const ESTATE_REL = path.join('test', 'fixtures', 'estate');

const args = parseArgs(process.argv.slice(2));
const ESTATE = path.resolve(typeof args.estate === 'string' ? args.estate : path.join(ROOT, ESTATE_REL));
const APPLY = args.apply === true;
const SEED = args.seed === true;

/* THE SHEET-TO-GENERATOR TABLE, AND THE JOIN THAT KEEPS IT HONEST.
 *
 * status.js chooses a generator per sheet in `gateTown`/`gatePlace`, and this
 * file has to make the same choice or `--apply` would write a sheet the board
 * then calls DIFF. That is two lists that must agree, which is a shape this
 * estate has been bitten by repeatedly — so it is NOT left as a comment.
 *
 * The join is the `status` job itself: it runs `--check` and then runs status.js
 * over this same fixture. If this table ever picked a different generator, or
 * different options, the bytes would differ and the board would say so on the
 * next push. A comment claiming the two agree would be a claim about a join; the
 * workflow is the join.
 *
 * `overridesFromWorkspace` and `ignoreLineRe` are copied from status.js's own
 * call sites, where each carries the measurement that earned it.
 */
const PLACE_SK = path.join(ROOT, '..', 'make-place-bus-leaflet', 'assets');
const AREA_SHEETS = [
  { out: 'internal.svg', gen: path.join(gl.SK, 'gen_internal.js'), optIn: null },
  { out: 'external.svg', gen: path.join(gl.SK, gl.EXTERNAL_GENERATOR), optIn: null },
  { out: 'internal-schematic.svg', gen: path.join(gl.SK, 'schematize_internal.js'), optIn: 'internalSchematic', opts: { overridesFromWorkspace: true } },
  { out: 'internal-diagram.svg', gen: path.join(gl.SK, 'diagram_internal.js'), optIn: 'internalDiagram' },
];
const PLACE_SHEETS = [
  { out: 'internal.svg', gen: path.join(gl.SK, 'gen_internal.js'), optIn: null, opts: { ignoreLineRe: gl.PLACE_IGNORE } },
  { out: 'external.svg', gen: path.join(PLACE_SK, 'gen_external_places.js'), optIn: null },
  { out: 'internal-schematic.svg', gen: path.join(gl.SK, 'schematize_internal.js'), optIn: 'internalSchematic', opts: { ignoreLineRe: gl.PLACE_IGNORE, overridesFromWorkspace: true } },
  { out: 'boarding.svg', gen: path.join(gl.SK, 'gen_boarding.js'), optIn: 'boardingPlan' },
];

/* A SHEET IS PART OF A MAP WHEN ITS MANIFEST SAYS SO, not when a file happens to
 * be on disk — `declares()` in status.js, and the same three-way distinction:
 * declared and present is gated, declared and absent is MISSING, undeclared is
 * nothing at all. High Wycombe High Street is the case that earned it: it carries
 * a boarding plan AND NOTHING ELSE, so a rule reading "every place has an
 * internal sheet" reported two findings about a map that is exactly as it should
 * be. */
const declares = (rec, base) => !!(rec && Array.isArray(rec.outputs) && rec.outputs.includes(base));

/* Every map in the fixture, area and place, each with the engine hash its stamp
 * is measured against. The two hashes are different functions of different file
 * sets, and a place stamped with the area hash would make the place donor
 * unusable in a way no byte comparison could explain. */
const ev = require('../assets/engine_version');

/* Written as LF, always, whichever side the bytes came from. See the `--seed`
 * block below for the measurement that earned this. */
const toLf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
function maps() {
  const towns = gl.findTowns(ESTATE);
  const places = gl.findPlaces(towns, ESTATE);
  const out = [];
  for (const t of towns) out.push({ kind: 'area', label: t.name, dir: t.dir, sheets: AREA_SHEETS });
  for (const p of places) out.push({ kind: 'place', label: (p.town ? p.town + ' / ' : '') + p.name, dir: p.dir, sheets: PLACE_SHEETS });
  return out;
}
const CURRENT = { area: ev.computeEngineVersion(), place: ev.computePlaceEngineVersion ? ev.computePlaceEngineVersion() : null };

/* ---- --seed: bring a map in from a real buses-data checkout ---------------
 *
 * LINE ENDINGS ARE NORMALISED, and that is not tidiness. `core.autocrlf=true` is
 * set on the laptop this estate is cut from, so buses-data's WORKING TREE holds
 * CRLF in files git stores as LF, while this repository's `.gitattributes` says
 * `* text=auto eol=lf`. Copying the bytes across verbatim puts CRLF into a tree
 * that checks out LF, so the committed copy and the working copy disagree from
 * the first commit — the identical fault the portal half of OA-398 measured, 15
 * files deep, an hour before this was written.
 */
function seed() {
  const from = typeof args.from === 'string' ? args.from : null;
  const rel = typeof args.map === 'string' ? args.map : null;
  if (!from || !rel) die('estate-fixture --seed needs --from "<buses-data checkout>" and --map "Areas/<Town>" (or "Areas/<Town>/Places/<Place>").');
  const src = path.join(from, rel);
  if (!fs.existsSync(path.join(src, 'ci-reference', 'routes.json'))) {
    die(`estate-fixture --seed: ${src} has no ci-reference/routes.json. A map is only seedable once it has a committed ci-reference mirror.`);
  }
  /* `--as` PUTS THE MAP SOMEWHERE ELSE IN THE FIXTURE, and the two places that
   * use it are the reason the fixture can prove anything about a place at all.
   * `prove-red-gates` needs a place carrying an `overrides.json` beside a
   * schematic, and a place carrying a boarding sheet; on the real estate those
   * are two High Wycombe places, nested under a 4 MB town this fixture has no
   * use for. Seeded as STANDALONE places they need no town at all — and that is
   * the third of the three place layouts, the one that was invisible to every
   * consumer of findPlaces() until 2026-08-21, so carrying one here is worth
   * having for its own sake. */
  const dst = path.join(ESTATE, typeof args.as === 'string' ? args.as : rel);
  let n = 0;
  const copy = (a, b) => {
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.writeFileSync(b, toLf(fs.readFileSync(a)));
    n++;
  };
  copy(path.join(src, 'manifest.json'), path.join(dst, 'manifest.json'));
  for (const f of fs.readdirSync(path.join(src, 'ci-reference')).sort()) {
    const a = path.join(src, 'ci-reference', f);
    if (fs.statSync(a).isDirectory()) continue;
    copy(a, path.join(dst, 'ci-reference', f));
  }

  /* AND THE LATEST S3 RUN, WHICH IS TWELVE KILOBYTES AND WITHOUT WHICH TWO
   * HARNESSES PASS FOR THE WRONG REASON. `prove-red-rollout-stamp` case D and
   * `prove-red-unrendered` both seed a rebuild from the map's latest S3 config
   * run, and both say in their own comments that a missing one turns the case
   * into a SKIP — which their authors call a pass for the wrong reason rather
   * than a gap. It is the one stage folder small enough to carry: Beaconsfield's
   * is 12 KB against 1.5 MB of ci-reference. S1, S2 and S6 are not carried,
   * because nothing that runs against this fixture reads them; the harnesses that
   * do read them run in buses-data's own gates workflow, against the real thing. */
  const man = loadManifest(src);
  const s3 = man.stages && man.stages.S3;
  const rec = s3 && s3.runs && s3.runs.find((r) => r.id === s3.latest);
  if (rec) {
    const runSrc = path.join(src, rec.dir);
    for (const f of (fs.existsSync(runSrc) ? fs.readdirSync(runSrc).sort() : [])) {
      const a = path.join(runSrc, f);
      if (fs.statSync(a).isDirectory()) continue;
      copy(a, path.join(dst, rec.dir, f));
    }
  }

  console.log(`seeded ${rel} — ${n} file(s) from ${src}`);
  console.log('Now run `npm run fixture:estate` to confirm the current engine reproduces it.');
}

/* ---- --check / --apply ---------------------------------------------------- */
function run() {
  const all = maps();
  if (!all.length) die(`estate-fixture: no map under ${ESTATE}. Seed one with --seed --map "Areas/<Town>" --from "<buses-data checkout>".`, 2);

  let behind = 0;
  for (const m of all) {
    const ci = path.join(m.dir, 'ci-reference');
    const routesPath = path.join(ci, 'routes.json');
    const routes = gl.readJson(routesPath);
    const want = CURRENT[m.kind];

    // THE STAMP. A fixture whose stamp is not the current engine is not a donor,
    // and `prove-red-held-back` exits 1 over the whole estate before a case runs.
    // That is the ordering trap this file exists to remove, so it is checked
    // first and named in those words.
    if (want && routes.engine !== want) {
      behind++;
      console.log(`  stamp    ${m.label}  ${routes.engine} -> ${want}  (a non-donor: prove-red-held-back cannot pose its fixture)`);
      if (APPLY) { routes.engine = want; fs.writeFileSync(routesPath, JSON.stringify(routes, null, 2) + '\n'); }
    }

    const s4rec = (() => {
      try { const r = gl.latestRunDir(loadManifest(m.dir), m.dir, 'S4'); return r && r.rec; } catch { return null; }
    })();

    for (const s of m.sheets) {
      const committed = path.join(ci, s.out);
      // A sheet the map never asked for, or never had: nothing to draw and
      // nothing to say. status.js draws the same distinction and calls it '-'.
      if (s.optIn && !routes[s.optIn]) continue;
      if (!fs.existsSync(committed)) {
        if (declares(s4rec, s.out)) { behind++; console.log(`  MISSING  ${m.label} · ${s.out}  (the manifest's latest S4 declares it and the fixture has no copy)`); }
        continue;
      }
      /* THE COMPARISON IS `gate()`'s, NOT A BYTE COMPARE, and the difference is
       * not academic: `diffSvg` filters the footer's validity stamp and the
       * sheet-version stamp, which move on a data refresh independently of any
       * content change. A straight byte compare here reported all eight fixture
       * sheets BEHIND on the day this file was written while status.js reported
       * PASS on all eight -- one command, two answers, and the wrong one would
       * have taught the reader to re-cut a fixture that was correct. The board
       * and this tool now ask through the same function, which is what makes the
       * `status` job a real join rather than a claim about one. */
      const v = gl.gate(s.gen, ci, s.out, committed, s.opts || {});
      if (v.status === 'PASS') continue;
      behind++;
      if (v.status === 'DIFF') {
        const drawn = path.join(v.tmpDir, s.out);
        const was = fs.statSync(committed).size;
        const now = fs.statSync(drawn).size;
        console.log(`  redrawn  ${m.label} · ${s.out}  ${was} B -> ${now} B`);
        if (APPLY) fs.writeFileSync(committed, toLf(fs.readFileSync(drawn)));
      } else {
        console.log(`  ${v.status.padEnd(8)} ${m.label} · ${s.out}  ${v.detail || ''}`);
      }
      if (v.tmpDir) gl.rmTmp(v.tmpDir);
    }
  }

  const where = path.relative(ROOT, ESTATE).split(path.sep).join('/');
  console.log(`\nfixture estate: ${where}/ — ${all.length} map(s), engine ${CURRENT.area}`
    + (CURRENT.place ? ` / place ${CURRENT.place}` : ''));
  if (!behind) { console.log('  in step — the current engine redraws every fixture sheet byte for byte, and every stamp is current.'); return 0; }
  if (APPLY) { console.log(`\n${behind} item(s) rewritten. Commit test/fixtures/estate/ in the SAME change as the engine edit that moved them.`); return 0; }
  console.error(`\n✗ ${behind} item(s) BEHIND this engine. From make-bus-leaflet, with no placeholders:`);
  console.error('    npm run fixture:estate -- --apply');
  console.error('  and commit the result in the same change as the engine edit. An engine pull request that');
  console.error('  moves ink updates its own fixtures; that is what stops it opening red on a donor set the');
  console.error('  edit itself emptied (buses-data OA-341).');
  return 1;
}

process.exit(SEED ? (seed(), 0) : run());
