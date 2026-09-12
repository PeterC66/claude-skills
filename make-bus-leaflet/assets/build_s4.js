#!/usr/bin/env node
/*
 * build_s4.js — the ONE place an S4's sheets are drawn (buses-data OA-310).
 *
 * WHY THIS EXISTS. `build_log.js` classifies every generator's stderr and writes
 * `build-warnings.txt` into the run folder, and until 2026-09-12 exactly two files
 * called it: `rollout.js` and `rollout_places.js`. `grep -c 'build_log\|build-warnings'
 * stage.js` returned 0. Both rollouts correctly REFUSE a data change — `gate_lib.js`'s
 * staleInputs() stops them with STALE-INPUTS rather than putting new config over old
 * geometry — so an S4 built through the documented stage order, which is the only path
 * left for a config change, produced no warnings log at all.
 *
 * Measured across all 20 maps on 2026-09-11: eighteen carry the log, two do not, and
 * both are recent data changes (Huntingdon v5.0, Wisbech v4.0 and v4.1). Huntingdon is
 * the control — the engine rollout three days earlier carries one.
 *
 * THE INVERSION IS THE POINT. A guard that only writes to stderr is not a guard: three
 * of `gen_internal.js`'s feature-label guards refuse to draw and still exit 0, so
 * without the log a sheet can ship carrying a label the engine declined to place with
 * nothing saying so. A CONFIG change is precisely when a label is most likely to be
 * refused — it is the change that moves text around the page — so the build that most
 * needs the record was the one guaranteed not to get it. On 2026-09-11 the Godmanchester
 * Co-op Ermine Street rebuild drew its new map notes across a school POI symbol; the
 * engine said so as a WARN, which does not block, and the sheet would have shipped over
 * the POI had the log not been read by hand in the same session that wrote it. The
 * throwaway driver that read it was deliberately not kept — a recipe somebody has to
 * remember is the category of guarantee `refresh_area_fixture.js` replaced with a
 * script — and this file is what replaces it.
 *
 * WHAT IT IS. `sheet_registry.js` is the one list of sheets this engine can DRAW; this
 * is the one statement of HOW each of them is drawn, at each level. The rollouts call
 * `buildSheets()` instead of keeping their own copy of the capture, so there is one
 * thing to keep in step rather than three.
 *
 * Usage as a command, run from inside the S4 run folder (the stage engine's cwd-as-
 * subject convention — see SKILL.md's stage model), with no placeholders:
 *
 *   node "%SK%\build_s4.js"
 *   node "%SK%\build_s4.js" --dir "<an S4 run folder>"
 *   node "%SK%\build_s4.js" --sheets internal,boarding     # override the sheet set
 *
 * It copies the generators the map's routes.json selects into the run folder, runs
 * them, classifies what they said and writes `build-warnings.txt` — then prints the
 * `--outputs` string for the commit that follows. It sets BUILD_META_DIR for an area's
 * internal sheet, which `stage.js commit S4` requires and which a hand build had to
 * remember (OA-206's second guard).
 *
 * NOT VENDORED AND NOT HASHED. This file is reachable from `rollout.js` and `stage.js`,
 * neither of which is an engine entry point, so it is in neither the engine template
 * hash nor the portal's `engine/vendored.json` — see changing-the-engine.md's three
 * prices. A change here re-stamps no map and needs no portal PR.
 *
 * Zero dependencies (Node core only).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const BUILDLOG = require('./build_log');
const { SHEETS } = require('./sheet_registry');
const { crossingWarnings } = require('./schematic_crossings');

const SK = __dirname;                                                   // …/make-bus-leaflet/assets
const PSK = path.join(SK, '..', '..', 'make-place-bus-leaflet', 'assets');
/* THE ONE NAME, taken rather than retyped. There is exactly one external template and
 * `gate_lib.js` is where it is declared — a second copy here would be the very shape
 * `gate_lib.test.js`'s census exists to refuse, and the fault that census was written
 * for (a name assembled in three places, one of them fixed) cost a day of every town's
 * rebuild throwing on a path no gate exercises. */
const { EXTERNAL_GENERATOR } = require('./gate_lib');

/* THE DRAW ORDER, and it is NOT the registry's delivery order. `sheet_registry.js`
 * lists the sheets in the order they are delivered; both rollouts have always RUN them
 * internal → external → schematic → boarding → diagram, and the order is observable
 * because `build_log.js` keeps entry order within each severity. Preserving it is what
 * makes the log this file writes byte-identical to the one the rollouts wrote before
 * they called it. No place carries `internalDiagram` today, so no committed log can
 * distinguish the two orders — which is exactly why it is written down rather than
 * left to whichever list happened to be iterated. */
const DRAW_ORDER = ['internal', 'external', 'schematic', 'boarding', 'diagram'];

/* Per invariant 6, every generator runs with cwd = the run folder and WITHOUT
 * LEAFLET_DIR set — the "LEAFLET_DIR trap" in changing-the-engine.md §4. Byte-identical
 * copies of this lived in both rollouts until this file took them. */
function runNode(scriptPath, cwd, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.LEAFLET_DIR;
  const res = spawnSync(process.execPath, [scriptPath], { cwd, env, encoding: 'utf8' });
  return { ok: res.status === 0, stdout: res.stdout, stderr: res.stderr };
}
function copyFile(src, destDir, name) {
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, path.join(destDir, name || path.basename(src)));
  return true;
}

/*
 * HOW EACH SHEET IS DRAWN, per level. Every field here was read out of the two
 * rollouts rather than invented, and the awkward ones are the load-bearing ones:
 *
 *  - `meta` (area internal only) asks gen_internal.js for build-meta.json, chiefly the
 *    rotation it actually applied. rollout.js sets it on the REAL run only, because a
 *    scratch dry run would overwrite it with a build that is then thrown away.
 *  - the place internal is built by the place skill's `build_internal_place.js` — a
 *    title-fix wrapper around the UNCHANGED town gen_internal.js — run IN PLACE from
 *    PSK rather than copied in, and never `build_internal_place_roads.js`, which pulls
 *    fresh OSM geometry over the network.
 *  - the place schematic passes OVERRIDES_FILE explicitly and the place diagram
 *    deliberately does NOT: schematize_internal.js's workspace copy does not carry
 *    overrides.json, while diagram_internal.js copies its own S3-owned
 *    diagram-overrides.json in as overrides.json, and OVERRIDES_FILE would shadow it
 *    (gotchas.md ~486).
 *  - `sentinel` is the place skill's gen_internal_place.js, which must exist beside
 *    routes.json so the pre-stages' isPlace check fires.
 *  - `fatal` says whether a failure stops the build. The pre-stage sheets are not
 *    fatal in either rollout — a schematic that fails leaves the other sheets standing
 *    and `stage.js commit S4`'s OA-206 guard is what refuses the commit.
 */
const RECIPE = {
  internal: {
    area:  { copy: [[SK, 'gen_internal.js']], script: 'gen_internal.js', meta: true, fatal: true, out: 'internal.svg' },
    place: { runFrom: path.join(PSK, 'build_internal_place.js'), env: { TSK: SK },
             fatal: true, out: 'internal.svg', needsOut: true, label: 'build_internal_place.js' },
  },
  external: {
    area:  { copy: [[SK, EXTERNAL_GENERATOR, 'gen_external.js']], script: 'gen_external.js', fatal: true, out: 'external.svg' },
    place: { copy: [[PSK, 'gen_external_places.js']], script: 'gen_external_places.js', fatal: true, out: 'external.svg' },
  },
  schematic: {
    area:  { copy: [[SK, 'schematize_internal.js']], script: 'schematize_internal.js',
             env: { SKILL_ASSETS: SK }, crossings: true, out: 'internal-schematic.svg' },
    place: { sentinel: true, copy: [[SK, 'schematize_internal.js']], script: 'schematize_internal.js',
             env: { SKILL_ASSETS: SK }, overridesFile: true, crossings: true, out: 'internal-schematic.svg' },
  },
  boarding: {
    place: { copy: [[SK, 'gen_boarding.js']], script: 'gen_boarding.js', env: { SKILL_ASSETS: SK },
             fatal: true, needsOut: true, out: 'boarding.svg', before: 'boarding' },
  },
  diagram: {
    area:  { copy: [[SK, 'diagram_internal.js']], script: 'diagram_internal.js',
             env: { SKILL_ASSETS: SK }, out: 'internal-diagram.svg' },
    place: { sentinel: true, copy: [[SK, 'diagram_internal.js']], script: 'diagram_internal.js',
             env: { SKILL_ASSETS: SK }, out: 'internal-diagram.svg' },
  },
};

/**
 * The sheets to draw, in draw order. `routesJson` is the map's own declaration, read
 * through `sheet_registry.js` so an added sheet reaches this file for free; `level` is
 * 'area' or 'place'; `has` narrows it for the case routes.json cannot express — three
 * place maps deliberately ship with no internal or external sheet (OA-035, OA-037), and
 * both rollouts read that off the previous S4 rather than off the config.
 */
function planSheets({ routesJson, level, has = {} }) {
  const rj = routesJson || {};
  const declared = new Set(SHEETS
    .filter(s => !s.optIn || rj[s.optIn])
    .filter(s => s.level === 'both' || s.level === level)
    .map(s => s.key));
  /* NO SECOND LEVEL TEST AGAINST THE RECIPE HERE, and its absence was measured rather
   * than chosen: with one, the mutation that deletes the registry's own `level` filter
   * SURVIVED the suite, because RECIPE has no area boarding either and the second guard
   * quietly did the first one's job. Two guards for one property is one guard nobody can
   * see fail. The registry's `level` is the declaration; that the RECIPE covers exactly
   * the pairs it declares is asserted in build_s4.test.js, and buildSheets still skips a
   * key it has no recipe for rather than throwing. */
  return DRAW_ORDER.filter(k => declared.has(k)).filter(k => has[k] !== false);
}

/**
 * Draw the sheets, keep everything they said, classify it and write the log.
 *
 * Returns `{ ok, outputs, said, warnings, blockers, failure }` — `failure` is
 * `{ sheet, label, stderr }` for the first FATAL sheet that failed, and null otherwise.
 * `outputs` holds the basenames that actually landed, ready for `commit S4 --outputs`;
 * the log's own name is appended when it is written, exactly as the rollouts append it.
 *
 * Every generator's stderr is kept, not just a failing one's: the guards that matter
 * refuse to draw and then exit 0, so a build that "succeeded" is precisely the case
 * where nothing was listening (build_log.js).
 */
function buildSheets({ dir, level, routesJson, sheets = null, has = {}, buildMeta = true, write = true, hooks = {} }) {
  const rj = routesJson || {};
  const plan = sheets || planSheets({ routesJson: rj, level, has });
  const said = [];
  const outputs = [];
  let failure = null;

  for (const key of plan) {
    const r = RECIPE[key] && RECIPE[key][level];
    if (!r) continue;

    if (r.before && hooks[r.before]) {
      const pre = hooks[r.before](dir);
      if (pre && pre.ok === false) {
        said.push({ source: key, stderr: pre.stderr || '', ok: false });
        failure = { sheet: key, label: r.label || r.script || key, stderr: pre.stderr || '' };
        break;
      }
    }
    if (r.sentinel) copyFile(path.join(PSK, 'gen_internal_place.js'), dir);
    for (const [from, name, as] of (r.copy || [])) copyFile(path.join(from, name), dir, as);

    const env = { ...(r.env || {}) };
    if (r.meta && buildMeta) env.BUILD_META_DIR = dir;
    if (r.overridesFile) env.OVERRIDES_FILE = path.join(dir, 'overrides.json');
    const script = r.runFrom || path.join(dir, r.script);
    const res = runNode(script, dir, env);
    said.push({ source: key, stderr: res.stderr, ok: res.ok });
    if (r.crossings) said.push({ source: 'crossings', stderr: crossingWarnings(dir).join('\n'), ok: true });

    const landed = fs.existsSync(path.join(dir, r.out));
    if (r.fatal && (!res.ok || (r.needsOut && !landed))) {
      failure = { sheet: key, label: r.label || r.script || key,
                  stderr: res.stderr || `no ${r.out} produced` };
      break;
    }
    /* A FATAL sheet that exited 0 is listed WITHOUT asking the disk, and that is not
     * an oversight — it is what both rollouts did. A generator that exits 0 having
     * written nothing is then caught loudly by `stage.js commit S4`, which refuses an
     * `--outputs` naming a file the run does not hold; silently dropping it here would
     * turn a refusal into a sheet that quietly stopped existing, which is the OA-206
     * fault verbatim. A non-fatal sheet is listed only if it landed, because its
     * failure is allowed and leaves nothing behind. */
    if (r.fatal ? res.ok : (res.ok && landed)) outputs.push(r.out);
  }

  const warnings = BUILDLOG.collect(said);
  const blockers = BUILDLOG.blocking(warnings);
  /* The log goes in the run folder BESIDE the artwork it describes, ALWAYS — including
   * when it is empty, and including after a fatal failure, which is the build whose
   * stderr is most worth keeping. A missing file is ambiguous; a file saying "no
   * warnings" is evidence (build_log.js). The one caller that asks for `write: false`
   * is a rollout's scratch dry run, whose folder is deleted a few lines later. */
  if (write) {
    BUILDLOG.write(dir, warnings);
    outputs.push(BUILDLOG.LOG_NAME);
  }
  return { ok: !failure, outputs, said, warnings, blockers, failure };
}

if (require.main === module) {
  const { parseArgs } = require('./cli.js');
  const { isPlaceRun } = require('./engine_version');
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(typeof args.dir === 'string' ? args.dir : process.cwd());
  const rjPath = path.join(dir, 'routes.json');
  if (!fs.existsSync(rjPath)) {
    console.error(`build_s4.js: no routes.json in ${dir}`);
    console.error('  Run this from inside the S4 run folder, or pass --dir "<an S4 run folder>".');
    process.exit(2);
  }
  const routesJson = JSON.parse(fs.readFileSync(rjPath, 'utf8'));
  const level = isPlaceRun(dir) ? 'place' : 'area';
  let sheets = null;
  if (typeof args.sheets === 'string') {
    sheets = args.sheets.split(',').map(s => s.trim()).filter(Boolean);
    const unknown = sheets.filter(k => !(RECIPE[k] && RECIPE[k][level]));
    if (unknown.length) {
      console.error(`build_s4.js: this engine draws no ${unknown.join(', ')} for a ${level} — `
        + `known sheets are ${DRAW_ORDER.filter(k => RECIPE[k][level]).join(', ')}`);
      process.exit(2);
    }
  }
  const plan = sheets || planSheets({ routesJson, level });
  console.log(`build_s4: ${level} build in ${dir}`);
  console.log(`  sheets: ${plan.join(', ') || '(none — routes.json declares nothing this level can draw)'}`);
  const r = buildSheets({ dir, level, routesJson, sheets: plan });
  for (const w of r.warnings.filter(e => e.severity !== 'MEASURED')) {
    console.log(`  [${w.severity}] ${w.text}`);
  }
  console.log(`  ${BUILDLOG.LOG_NAME} written — ${r.warnings.length} entr${r.warnings.length === 1 ? 'y' : 'ies'}, ${r.blockers.length} blocking`);
  if (!r.ok) {
    console.error(`build_s4.js: ${r.failure.label} failed — ${String(r.failure.stderr).split('\n')[0]}`);
    console.error(`  The log was written anyway: ${path.join(dir, BUILDLOG.LOG_NAME)}`);
    process.exit(1);
  }
  console.log(`  --outputs ${r.outputs.join(',')}`);
  if (r.blockers.length) {
    console.error(`build_s4.js: ${r.blockers.length} BLOCKING warning(s) — the engine refused to draw something,`);
    console.error(`  or drew a label that names nothing. Read ${path.join(dir, BUILDLOG.LOG_NAME)} and fix the`);
    console.error('  config it names before committing this S4.');
    process.exit(3);
  }
}

/* The `source` on every captured entry is the SHEET KEY, in both rollouts and here —
 * 'internal', 'external', 'schematic', 'boarding', 'diagram', plus the 'crossings'
 * pseudo-source the schematic pushes. A log written through this file is therefore
 * byte-identical to the one the rollouts wrote before they called it, and
 * test/build_s4.test.js asserts that rather than leaving it as a claim. */
module.exports = { buildSheets, planSheets, runNode, copyFile, DRAW_ORDER, RECIPE, SK, PSK };
