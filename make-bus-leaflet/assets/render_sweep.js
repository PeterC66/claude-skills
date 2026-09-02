#!/usr/bin/env node
/*
 * render_sweep.js — can every map still be RE-RENDERED?
 *
 * THE QUESTION NOTHING ELSE IN THE ESTATE ASKS. The byte gate (status.js) asks
 * whether the current engine reproduces each map's committed sheet, and it runs
 * the generators with STRICT_GUARDS unset — deliberately, because the gate must
 * not turn red on a fixture that legitimately carries a warning. The portal sets
 * STRICT_GUARDS=1 on every render that goes public (import, preview, accepted
 * update, re-publish), so a map can reproduce its committed bytes perfectly and
 * still be incapable of ever producing a NEW version. That map looks completely
 * healthy from every angle we had, right up until somebody tries to update it.
 *
 * Seven of the eighteen live maps were REPORTED to be in exactly that state on
 * 2026-08-27 (OA-137). They were not: measured on the live host the same day,
 * through the portal's own previewFrom(), all eighteen render. The refusal was
 * in the MEASURING HARNESS, which invoked each generator without composing
 * base-overrides.json into OVERRIDES_FILE — see the next paragraph, which is
 * the reason this file composes it explicitly. The question above is still
 * worth asking and nothing else in the estate asks it; the false alarm is a
 * reason to run the sweep, not a reason to trust a report that skipped it.
 *
 * WHY IT COMPOSES THE OVERRIDES ITSELF, which is the whole point. A place's
 * "expert framing" — the river-hide, the frozen viewport — does not live in
 * routes.json. It lives in a SIDE FILE, and that file changes its name and its
 * loading mechanism on the way to the portal:
 *
 *   in the skill / buses-data pack   overrides.json, read by gen_internal.js
 *                                    from LEAFLET_DIR by default
 *   in the portal store              data/base-overrides.json, merged UNDER the
 *                                    customer layer into a temp file that the
 *                                    portal passes as OVERRIDES_FILE
 *
 * A harness that renders a pack in place, and lets gen_internal.js pick up
 * whatever overrides.json happens to sit beside it, models the FIRST of those
 * and reports a fault that does not exist in the second — which is exactly what
 * OA-137 did, and it cost a day. So this composes the framing explicitly,
 * the way src/maps/engine.js's renderVersion(id, {}) does, and says which file
 * it took it from. --drop-framing renders with the framing deliberately absent,
 * which is what a delivery that loses the side file WOULD look like. Note the
 * conditional: no delivery has been observed losing it. --drop-framing measures
 * a dependency, not an incident, and must not be quoted as one.
 *
 * Usage — every argument below is a real path on this machine, no placeholders:
 *
 *   node assets/render_sweep.js --buses "<Buses dir>"
 *   node assets/render_sweep.js --store "C:/Claude/community-bus-maps/data/maps"
 *   node assets/render_sweep.js --buses "..." --drop-framing
 *   node assets/render_sweep.js --buses "..." --expect 20
 *
 * Run it from the engine's own folder, C:\u3a St Ives\.claude\skills\make-bus-leaflet.
 *
 * --expect <n> fails when the enumeration finds a different number of maps than
 * you asked for. An enumeration is a silent filter: this repo has already
 * shipped three standalone places that were invisible to every consumer of
 * findPlaces() for a fortnight, and a sweep that quietly covers 13 of 20 reports
 * the same cheerful green as one that covers all 20.
 *
 * Exits 1 if any map refuses anything. Zero dependencies (Node core only).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SK, rmTmp, runGenerator, findTowns, findPlaces, readJson, latestRunDir, EXTERNAL_GENERATOR,
} = require('./gate_lib');

const PSK = path.join(SK, '..', '..', 'make-place-bus-leaflet', 'assets');

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--buses') f.buses = argv[++i];
    else if (a === '--store') f.store = argv[++i];
    else if (a === '--drop-framing') f.dropFraming = true;
    else if (a === '--expect') f.expect = Number(argv[++i]);
    else if (a === '--json') f.json = true;
    else if (a === '--quiet') f.quiet = true;
    else if (a === '-h' || a === '--help') f.help = true;
  }
  return f;
}

/*
 * The framing a pack carries, and the name it carries it under. Order matters:
 * base-overrides.json is the PORTAL's name and wins where both exist, because a
 * store that has been through import-map.mjs has the expert layer split out and
 * an overrides.json sitting beside it would be the CUSTOMER layer, which the
 * portal merges on top rather than instead.
 */
function readFraming(dataDir) {
  for (const name of ['base-overrides.json', 'overrides.json']) {
    const p = path.join(dataDir, name);
    if (!fs.existsSync(p)) continue;
    try { return { from: name, obj: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
    catch (e) { return { from: name, obj: {}, broken: e.message }; }
  }
  return { from: null, obj: {} };
}

/*
 * Which sheets does this map declare? Exactly the mapping status.js gates, so
 * the two boards answer about the same set of artefacts — a sweep that asks
 * about a different set of sheets from the byte gate is a third list, and this
 * repo already knows what a third list costs.
 *
 * WHICH GENERATOR, AND THE TWO ANSWERS ARE DIFFERENT ON PURPOSE.
 *
 *   tree mode   the SKILL's template. A map's S4/ci-reference folder holds no
 *               generator, and gating a town against its own frozen copy would
 *               pass by construction — changing-the-engine.md §2, "gate the
 *               TEMPLATE, not the town's frozen copy".
 *
 *   store mode  the PACK's own copy, which is what the portal runs:
 *               generateSvg() resolves `path.join(dataDir, generator)`. A
 *               delivered map is pinned to the generator that travelled with it
 *               until `npm run track:engine --apply` moves it forward (OA-130),
 *               so a sweep that reached past the pack for the skill's current
 *               engine would report on an engine that map does not run. This
 *               version got that wrong on its first outing and cheerfully
 *               reported a store of un-tracked packs as clean.
 *
 * AND THE PACK ONLY OWNS TWO OF THE FIVE SHEETS. `src/maps/store.js` marks the
 * schematic, the diagram and the boarding plan `engine: 'expert'`, and
 * resolveGen() takes those from the PORTAL's own engine/expert/ directory,
 * ignoring the pack entirely. A store pack can still hold a `gen_boarding.js`
 * left by an older import — map 4 here holds one that predates strict_guards.js
 * altogether — and running it would report on a file the portal never executes.
 * So only `internal` and `external` prefer the pack; the expert three never do.
 * That stale copy is dead weight rather than a live fault, and `track-engine.mjs`
 * does not move it, but it is exactly the kind of file a sweep would be fooled by.
 *
 * Falling back to the template when the pack has no copy is right for both: it
 * is how an area map's portal-owned expert sheets resolve anyway.
 */
function sheetsFor(dataDir, { isPlace, preferPackGen }) {
  const rj = readJson(path.join(dataDir, 'routes.json'));
  const sheets = [];
  const have = (n) => fs.existsSync(path.join(dataDir, n));
  const pick = (fallbackDir, name) => {
    const inPack = path.join(dataDir, name);
    if (preferPackGen && fs.existsSync(inPack)) return inPack;
    return path.join(fallbackDir, name);
  };
  if (have('internal.svg')) sheets.push({ key: 'internal', gen: pick(SK, 'gen_internal.js'), out: 'internal.svg' });
  if (have('external.svg')) {
    // A store's area pack names its external generator `gen_external.js` and does
    // NOT record which template it came from, which is the same ambiguity
    // track-engine.mjs refuses to guess through. Prefer the pack's own file when
    // there is one; otherwise fall back to detecting the style from the sheet.
    const gen = preferPackGen && have('gen_external.js') ? path.join(dataDir, 'gen_external.js')
      : isPlace ? pick(PSK, 'gen_external_places.js')
      : path.join(SK, EXTERNAL_GENERATOR);
    sheets.push({ key: 'external', gen, out: 'external.svg' });
  }
  // The expert three are portal-owned (store.js `engine: 'expert'`): always the
  // template, never the pack, however tempting a copy sitting in the pack looks.
  if (rj.internalSchematic) sheets.push({ key: 'schematic', gen: path.join(SK, 'schematize_internal.js'), out: 'internal-schematic.svg' });
  if (rj.internalDiagram) sheets.push({ key: 'diagram', gen: path.join(SK, 'diagram_internal.js'), out: 'internal-diagram.svg' });
  if (rj.boardingPlan) sheets.push({ key: 'boarding', gen: path.join(SK, 'gen_boarding.js'), out: 'boarding.svg' });
  return sheets;
}

/*
 * Guard-shaped stderr, and the ONE number that is authoritative about it.
 *
 * A generator's stderr carries three different kinds of line that all look the
 * same, and only one of them stops a publish:
 *
 *   refuse()          counted, and under STRICT_GUARDS it becomes the exit code
 *   warn()            printed, never counted — the label is legible, the siting
 *                     is a judgement call
 *   stderr.write()    a bare diagnostic that never entered the contract at all,
 *                     e.g. services_panel.js's "service N is badged … but draws
 *                     no line", which is a build note and not a guard
 *
 * Nothing in the TEXT separates them, and reading them as one is not a
 * hypothetical mistake: OA-137 reported "five further refusals … on two maps"
 * for five lines of the third kind, which had never blocked anything. So the
 * count comes from strict_guards.js's own closing banner, which is the only
 * statement of how many refusals a run actually recorded, and the lines are
 * reported as context beneath it rather than as the finding.
 */
const GUARD_LINE = /^(feature|panel|footer|coreBox|route|stop|label|key|legend|note|mapNotes|poi|badge|terminus|services?|title|frame|guard):/;

function guardLines(stderr) {
  return String(stderr).split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !/^STRICT_GUARDS: /.test(s) && GUARD_LINE.test(s));
}

/** The refusal count strict_guards.js reported, or 0 when it printed no banner. */
function refusalCount(stderr) {
  const m = /^STRICT_GUARDS: (\d+) guards? /m.exec(String(stderr));
  return m ? Number(m[1]) : 0;
}

/*
 * Does this generator participate in the STRICT_GUARDS contract at all? Only
 * gen_internal.js and gen_boarding.js require strict_guards.js; the two external
 * generators, schematize_internal.js and diagram_internal.js have no refusal
 * path, so a green from them means "did not crash", NOT "would be allowed to
 * publish". Printing OK for those would be a check claiming more coverage than
 * it has, which is the fault this whole sweep exists to catch.
 */
const guardedCache = new Map();
// THE DETECTOR WAS BLIND TO A BRACKET, found 2026-08-28 while adopting the
// contract in gen_external_radial.js (OA-045). The test was
// `/require\([^)]*strict_guards\.js/`, and `[^)]*` cannot cross a closing
// bracket — so it matched gen_internal.js's `require(_dep('strict_guards.js'))`
// and NOT `require(path.join(path.dirname(X), 'strict_guards.js'))`, which is
// the idiom the external generator resolves its own dependencies with. The
// newly guarded sheet reported `n/a`: not a failure, not a pass, but "this
// generator has no guard contract" — which is the one thing this column exists
// to say and it was saying it about a generator that had just adopted one. A
// detector made of a pattern over SOURCE can only see the spellings its author
// happened to have in front of them. `.*` within the line is the honest test
// here: any require naming the module is a require of the module.
function isGuarded(genPath) {
  if (!guardedCache.has(genPath)) {
    let src = '';
    try { src = fs.readFileSync(genPath, 'utf8'); } catch (e) {}
    guardedCache.set(genPath, /require\(.*strict_guards\.js/.test(src));
  }
  return guardedCache.get(genPath);
}

function sweepOne(map, flags) {
  const framing = flags.dropFraming ? { from: '(dropped)', obj: {} } : readFraming(map.dataDir);
  const ovFile = path.join(os.tmpdir(), `sweep-ov-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(ovFile, JSON.stringify(framing.obj));
  const rows = [];
  try {
    for (const s of sheetsFor(map.dataDir, map)) {
      // NO-GEN carries the same SHAPE as every other row, `refusals` and
      // `refused` included. It did not, and the summary crashed reading
      // `.refusals.length` off it — on the live host, mid-measurement, which is
      // the worst place to discover that two rows built in one function do not
      // agree about their own fields.
      if (!fs.existsSync(s.gen)) {
        rows.push({ sheet: s.key, verdict: 'NO-GEN', lines: [], refusals: [], refused: 0, detail: s.gen });
        continue;
      }
      const run = runGenerator(s.gen, map.dataDir, { extraEnv: { STRICT_GUARDS: '1', OVERRIDES_FILE: ovFile } });
      const lines = guardLines(run.stderr);
      const refused = refusalCount(run.stderr);
      // Four outcomes, deliberately kept apart. A non-zero exit WITH a refusal
      // banner is the map declining to publish; a non-zero exit WITHOUT one is a
      // crash, and the two want different remedies. `n/a` is an unguarded
      // generator: it ran, and that is all this sweep can say about it.
      const verdict = !isGuarded(s.gen) ? (run.ok ? 'n/a' : 'ERROR')
        : refused ? 'REFUSE'
        : !run.ok ? 'ERROR'
        : lines.length ? 'WARN' : 'OK';
      rows.push({
        sheet: s.key, verdict, lines, refused,
        // Only a refusing run's lines are the finding; on any other run they are
        // build notes that happen to share a prefix.
        refusals: refused ? lines : [],
        detail: verdict === 'ERROR' ? String(run.stderr).trim().split(/\r?\n/).slice(-4).join(' / ') : '',
      });
      rmTmp(run.tmpDir);
    }
  } finally { try { fs.unlinkSync(ovFile); } catch (e) {} }
  return { framing: framing.from, rows };
}

function enumerateTree(busesDir) {
  const maps = [];
  for (const t of findTowns(busesDir)) {
    const s4 = latestRunDir(readJson(path.join(t.dir, 'manifest.json')), t.dir, 'S4');
    if (s4) maps.push({ name: t.name, group: 'town', isPlace: false, dataDir: s4.dir });
  }
  for (const p of findPlaces(findTowns(busesDir), busesDir)) {
    const s4 = latestRunDir(readJson(path.join(p.dir, 'manifest.json')), p.dir, 'S4');
    if (s4) maps.push({ name: p.name, group: p.town || '(standalone)', isPlace: true, dataDir: s4.dir });
  }
  return maps;
}

function enumerateStore(storeDir) {
  const maps = [];
  for (const id of fs.readdirSync(storeDir).sort((a, b) => Number(a) - Number(b))) {
    const dataDir = path.join(storeDir, id, 'data');
    if (!fs.existsSync(path.join(dataDir, 'routes.json'))) continue;
    let rj = {};
    try { rj = readJson(path.join(dataDir, 'routes.json')); } catch (e) {}
    maps.push({
      name: `${id} ${rj.placeTitle || rj.place || rj.town || ''}`.trim(),
      group: 'store',
      // A store map is a place when the payload carries the place wrapper, which
      // is what import-map.mjs keys its own `isPlace` branch on.
      isPlace: fs.existsSync(path.join(dataDir, 'gen_internal_place.js')),
      dataDir,
      // The portal runs the pack's OWN generator, not the skill's; so must this.
      preferPackGen: true,
    });
  }
  return maps;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || (!flags.buses && !flags.store)) {
    console.log('usage: node render_sweep.js --buses "<Buses dir>" | --store "<portal data/maps>"'
      + ' [--drop-framing] [--expect <n>] [--json] [--quiet]');
    process.exit(flags.help ? 0 : 2);
  }
  const maps = flags.store ? enumerateStore(flags.store) : enumerateTree(flags.buses);
  if (flags.expect != null && maps.length !== flags.expect) {
    console.error(`render_sweep: enumerated ${maps.length} maps, --expect said ${flags.expect}.`);
    console.error('  A sweep that covers a subset reports the same green as one that covers everything.');
    process.exit(2);
  }

  const results = [];
  for (const m of maps) {
    const r = sweepOne(m, flags);
    results.push({ ...m, ...r });
    if (!flags.json && !flags.quiet) {
      const worst = r.rows.some((x) => x.verdict === 'REFUSE' || x.verdict === 'ERROR') ? 'REFUSE'
        : r.rows.some((x) => x.verdict === 'WARN') ? 'WARN' : 'OK';
      const cells = r.rows.map((x) => `${x.sheet}:${x.verdict}`).join(' ');
      console.log(`${worst.padEnd(7)} ${m.name.padEnd(38)} framing=${String(r.framing).padEnd(21)} ${cells}`);
    }
  }

  const bad = results.filter((r) => r.rows.some((x) => x.verdict === 'REFUSE' || x.verdict === 'ERROR'));
  if (flags.json) { console.log(JSON.stringify({ maps: results.length, refusing: bad.length, results }, null, 2)); }
  else {
    const total = bad.reduce((n, r) => n + r.rows.reduce((m, x) => m + x.refused, 0), 0);
    console.log('');
    console.log(`${results.length} maps swept, ${bad.length} cannot be re-rendered`
      + (bad.length ? ` (${total} refusal${total === 1 ? '' : 's'} in total).` : '.'));
    if (bad.length) {
      // Group by the SENTENCE, not by map: OA-137's whole finding was that one
      // cause accounted for all seven, and a per-map listing buries that.
      //
      // AND SAY WHAT THIS LISTING IS, because the honest answer is narrower than
      // it looks. The count above comes from strict_guards.js's own banner and is
      // exact. These lines cannot be, because the generator does not mark which
      // of its stderr lines were refusals — refuse(), warn() and a bare
      // stderr.write() all come out looking identical. So a refusing run's guard
      // output is shown in full and the arithmetic is left visible: when a map
      // refused once and printed five lines, five of them are not the cause.
      // OA-137 read exactly that arrangement as "five further refusals" on a map
      // that had refused once, and prescribed work for four services that were
      // never blocking anything.
      const byCause = new Map();
      for (const r of bad) {
        for (const row of r.rows) {
          if (row.verdict !== 'REFUSE' && row.verdict !== 'ERROR') continue;
          for (const line of (row.refusals.length ? row.refusals : [row.detail || '(no message)'])) {
            if (!byCause.has(line)) byCause.set(line, []);
            byCause.get(line).push(`${r.name}/${row.sheet}`);
          }
        }
      }
      console.log('');
      console.log('  Guard output from the runs that refused. The refusal COUNT above is');
      console.log('  authoritative; these lines are not individually marked as refusals.');
      console.log('');
      for (const [cause, where] of [...byCause].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  ${where.length}x  ${cause}`);
        console.log(`        ${where.join(', ')}`);
      }
      const noisy = bad.flatMap((r) => r.rows.filter((x) => x.refusals.length > x.refused)
        .map((x) => `${r.name}/${x.sheet} refused ${x.refused}, printed ${x.refusals.length}`));
      if (noisy.length) {
        console.log('');
        console.log('  More guard lines than refusals — the extra lines are build notes, not causes:');
        for (const n of noisy) console.log(`    ${n}`);
      }
    }
  }
  process.exit(bad.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { readFraming, sheetsFor, guardLines, refusalCount, isGuarded, enumerateTree, enumerateStore, sweepOne };
