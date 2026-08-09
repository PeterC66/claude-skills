#!/usr/bin/env node
/*
 * rollout_places.js — the rollout.js equivalent for PLACES: re-render one or
 * more places onto the CURRENT engine template, automating the manual §2a
 * sequence in references/changing-the-engine.md adapted for a place's env
 * contract (invariant 6: LEAFLET_DIR/SKILL_ASSETS/OVERRIDES_FILE/EDITOR_KEYS)
 * and delegation model: the town's gen_internal.js is shared verbatim (§3),
 * a place's own build_internal_place(_roads).js wrapper does the title/version
 * fix gen_internal can't express, and gen_external_places.js is the place's
 * own aggregated-radial external generator.
 *
 * Why this didn't exist until now: the 2026-08-06 note in changing-the-engine.md
 * flagged "rollout.js only handles towns — there is still no place equivalent"
 * after gen_external_radial.js/gen_external_places.js changed and 4/5 places
 * went stale. The manual re-render that eventually cleared that backlog
 * (2026-08-09, alongside an unrelated footer-text change) hit exactly the
 * OVERRIDES_FILE gotcha documented in make-place-bus-leaflet/references/
 * gotchas.md (~line 486): schematize_internal.js's workspace copy step does
 * NOT carry overrides.json into schematic/, so High Wycombe Aldi's forced
 * "Tannery Road Ind Est" POI label was silently dropped and only caught by
 * hand, after the fact, by diffing label sets. This tool exists so that step
 * is structural, not remembered.
 *
 * A place needs no new S1/S2/S3 for an engine-only rollout (place.json,
 * geometry, routes.json/overrides.json are unchanged) for exactly the same
 * reason a town doesn't (item 3, 2026-08-04): S4 always draws from the LIVE
 * %SK%/%PSK% templates, never a frozen per-run copy. So the whole thing is
 * pure deterministic compute over data already on disk — no network.
 *
 * Usage:
 *   node rollout_places.js [--place "High Wycombe Aldi"]... [--all]
 *                           [--bump minor|major] [--note "..."] [--apply]
 *                           [--force] [--buses "<dir>"]
 *
 * Default is DRY RUN, identical semantics to rollout.js: builds each place in
 * a scratch temp dir, reports the label-set diff (gained/lost text vs the
 * currently-shipped SVGs) and whether it would now gate PASS, and writes
 * nothing under Areas/. Pass --apply to actually commit S4/S5 and refresh
 * _latest.
 *
 * Safety: identical to rollout.js — if a place's rendered internal.svg (or
 * external/schematic/diagram, if present) LOSES any label versus its previous
 * shipped version, --apply stops after committing S4 (nothing lost, that
 * commit is inert until pulled) without rendering/publishing. Re-run with
 * --force once reviewed, or fix the cause and re-run normally.
 *
 * Zero dependencies (Node core only).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SK, gate, labelDiff, PLACE_IGNORE, findTowns, findPlaces, readJson, latestRunDir } = require('./gate_lib');
const { computeEngineVersion, stampEngine } = require('./engine_version');

const PSK = path.join(SK, '..', '..', 'make-place-bus-leaflet', 'assets');

function parseArgs(argv) {
  const f = { place: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--place') { f.place.push(argv[++i]); }
    else if (a.startsWith('--')) { f[a.slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true; }
  }
  return f;
}
const args = parseArgs(process.argv.slice(2));
const BUSES = path.resolve(args.buses || 'C:/u3a St Ives/Using AI/Buses');
const APPLY = !!args.apply;
const FORCE = !!args.force;
const BUMP = args.bump === 'major' ? 'major' : 'minor';
const NOTE = args.note || 'rollout: adopt current engine template (auto)';

const STAGE_JS = path.join(SK, 'stage.js');
function stage(cwd, ...cmdArgs) {
  const res = spawnSync(process.execPath, [STAGE_JS, ...cmdArgs], { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`stage.js ${cmdArgs.join(' ')} failed:\n${res.stderr || res.stdout}`);
  return res.stdout.trim();
}
// Per invariant 6, the tool's own invocations must run WITHOUT LEAFLET_DIR set
// (cwd is the run dir) — same trap as rollout.js and the schematic/diagram
// pre-stages (changing-the-engine.md's "LEAFLET_DIR trap").
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

const GEN_EXTERNAL_PLACES = path.join(PSK, 'gen_external_places.js');

// Build internal.svg the same way build_internal_place.js does (title-fix
// wrapper around the UNCHANGED town gen_internal.js) — never
// build_internal_place_roads.js, which additionally pulls fresh OSM road
// geometry over the network. An engine-only rollout reuses the place's
// existing roads_geo.json/routes_paths.json (copied forward like every other
// S2-derived json), so it needs none of that; routes.json's own
// `internalRoads` block (already stamped with fitExtra etc from the original
// build) is what gen_internal.js reads either way.
function buildInternal(dir) {
  return runNode(path.join(PSK, 'build_internal_place.js'), dir, { TSK: SK });
}

function rolloutOnePlace(p) {
  const manifest = readJson(path.join(p.dir, 'manifest.json'));
  const prevS3 = latestRunDir(manifest, p.dir, 'S3');
  const prevS4 = latestRunDir(manifest, p.dir, 'S4');
  if (!prevS3 || !prevS4) return { name: p.name, status: 'SKIP', detail: 'no committed S3/S4 to roll forward from' };

  // Already current? Same fast-path as rollout.js: check the existing
  // PASS/DIFF gate (status.js's gatePlace logic) before doing any work.
  const internalGate = gate(path.join(SK, 'gen_internal.js'), prevS4.dir, 'internal.svg', path.join(prevS4.dir, 'internal.svg'), { ignoreLineRe: PLACE_IGNORE });
  const hasExternalGen = fs.existsSync(GEN_EXTERNAL_PLACES);
  const externalGate = hasExternalGen
    ? gate(GEN_EXTERNAL_PLACES, prevS4.dir, 'external.svg', path.join(prevS4.dir, 'external.svg'))
    : { status: 'SKIP' };
  if (internalGate.status === 'PASS' && (externalGate.status === 'PASS' || externalGate.status === 'SKIP') && !FORCE) {
    return { name: p.name, status: 'UP-TO-DATE', detail: 'internal+external already gate PASS against the current template' };
  }

  let routesJson = {};
  try { routesJson = readJson(path.join(prevS3.dir, 'routes.json')); } catch (e) {}

  // ---- build in a scratch workspace first (this is also the entire dry-run) ----
  // Mirrors rollout.js: no new S1/S2/S3 needed, only a new S4. Copy routes.json
  // + overrides.json (+ diagram-overrides.json, if this place ever configures
  // internalDiagram) from the previous S3, and every other *.json from the
  // previous S4 (place.json, atco2ll.json, roads_geo.json, routes_paths.json,
  // destinations, etc — all S1/S2-derived and unchanged by an engine rollout).
  const scratch = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rollout-place-'));
  fs.mkdirSync(path.join(scratch, 'S4'));
  const s3Carry = ['routes.json', 'overrides.json', 'diagram-overrides.json'];
  for (const name of s3Carry) copyFile(path.join(prevS3.dir, name), path.join(scratch, 'S4'));
  for (const name of fs.readdirSync(prevS4.dir)) {
    const fp = path.join(prevS4.dir, name);
    if (fs.statSync(fp).isDirectory()) continue;
    if (name.endsWith('.json') && !s3Carry.includes(name)) fs.copyFileSync(fp, path.join(scratch, 'S4', name));
  }
  const engineHash = computeEngineVersion();
  stampEngine(path.join(scratch, 'S4', 'routes.json'), engineHash);

  const s4 = path.join(scratch, 'S4');
  const outputs = [];
  let genOk = buildInternal(s4);
  if (!genOk.ok || !fs.existsSync(path.join(s4, 'internal.svg'))) {
    fs.rmSync(scratch, { recursive: true, force: true });
    return { name: p.name, status: 'FAIL', detail: 'build_internal_place.js: ' + (genOk.stderr || 'no internal.svg produced').split('\n')[0] };
  }
  outputs.push('internal.svg');
  if (hasExternalGen) {
    copyFile(GEN_EXTERNAL_PLACES, s4);
    genOk = runNode(path.join(s4, 'gen_external_places.js'), s4);
    if (!genOk.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: p.name, status: 'FAIL', detail: 'gen_external_places.js: ' + genOk.stderr.split('\n')[0] }; }
    outputs.push('external.svg');
  }
  // Schematic/diagram pre-stages (opt-in; only High Wycombe Aldi has
  // internalSchematic as of 2026-08-09, none has internalDiagram yet) — the
  // sentinel gen_internal_place.js must exist beside routes.json so their
  // internal isPlace check (fs.existsSync) fires, which applies the same
  // title/version fix build_internal_place.js applies to the ordinary map.
  if (routesJson.internalSchematic || routesJson.internalDiagram) copyFile(path.join(PSK, 'gen_internal_place.js'), s4);
  if (routesJson.internalSchematic) {
    copyFile(path.join(SK, 'schematize_internal.js'), s4);
    // THE GOTCHA (gotchas.md ~486): schematize_internal.js's workspace copy
    // does NOT carry overrides.json into schematic/, and gen_internal.js only
    // falls back to reading overrides.json from ITS OWN cwd (the workspace)
    // when OVERRIDES_FILE isn't set — so a place's forced-POI overrides are
    // silently dropped unless OVERRIDES_FILE is passed explicitly, pointing
    // at the place's own overrides.json (absolute path; the child's cwd is
    // the workspace subfolder, not this dir). No LEAFLET_DIR (runNode already
    // deletes it) — same trap, documented in changing-the-engine.md §4.
    const r = runNode(path.join(s4, 'schematize_internal.js'), s4, { SKILL_ASSETS: SK, OVERRIDES_FILE: path.join(s4, 'overrides.json') });
    if (r.ok && fs.existsSync(path.join(s4, 'internal-schematic.svg'))) outputs.push('internal-schematic.svg');
  }
  if (routesJson.internalDiagram) {
    copyFile(path.join(SK, 'diagram_internal.js'), s4);
    // Deliberately NOT OVERRIDES_FILE here, unlike schematic above:
    // diagram_internal.js copies its OWN diagram-overrides.json (S3-owned)
    // into the workspace as overrides.json; forcing OVERRIDES_FILE would
    // shadow that file entirely (gen_internal.js prefers OVERRIDES_FILE over
    // its cwd-relative overrides.json unconditionally).
    const r = runNode(path.join(s4, 'diagram_internal.js'), s4, { SKILL_ASSETS: SK });
    if (r.ok && fs.existsSync(path.join(s4, 'internal-diagram.svg'))) outputs.push('internal-diagram.svg');
  }

  const diffs = {};
  let anyLost = false;
  for (const name of outputs) {
    const d = labelDiff(path.join(prevS4.dir, name), path.join(s4, name));
    diffs[name] = d;
    if (d.lost.length) anyLost = true;
  }

  if (!APPLY) {
    fs.rmSync(scratch, { recursive: true, force: true });
    return { name: p.name, status: 'DRY-RUN', diffs, anyLost, version: prevS4.rec.version };
  }

  // ---- apply for real, via stage.js so the manifest/version-stamp rules are authoritative ----
  const s4Dir = stage(p.dir, 'new', 'S4', '--bump', BUMP);
  stage(p.dir, 'pull', 'S1', s4Dir); // place.json is an S1 output (pipeline.md P4 note) — pull it explicitly, not just S2
  stage(p.dir, 'pull', 'S2', s4Dir);
  stage(p.dir, 'pull', 'S3', s4Dir); // also syncs routes.json's printed version stamp to this run's v<N.N>
  stampEngine(path.join(s4Dir, 'routes.json'), engineHash);
  let r = buildInternal(s4Dir);
  if (!r.ok || !fs.existsSync(path.join(s4Dir, 'internal.svg'))) {
    fs.rmSync(scratch, { recursive: true, force: true });
    return { name: p.name, status: 'FAIL', detail: 'build_internal_place.js (real S4): ' + (r.stderr || 'no internal.svg produced').split('\n')[0] };
  }
  const realOutputs = ['internal.svg'];
  if (hasExternalGen) {
    copyFile(GEN_EXTERNAL_PLACES, s4Dir);
    r = runNode(path.join(s4Dir, 'gen_external_places.js'), s4Dir);
    if (!r.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: p.name, status: 'FAIL', detail: 'gen_external_places.js (real S4): ' + r.stderr.split('\n')[0] }; }
    realOutputs.push('external.svg');
  }
  if (routesJson.internalSchematic || routesJson.internalDiagram) copyFile(path.join(PSK, 'gen_internal_place.js'), s4Dir);
  if (routesJson.internalSchematic) {
    copyFile(path.join(SK, 'schematize_internal.js'), s4Dir);
    const r2 = runNode(path.join(s4Dir, 'schematize_internal.js'), s4Dir, { SKILL_ASSETS: SK, OVERRIDES_FILE: path.join(s4Dir, 'overrides.json') });
    if (r2.ok && fs.existsSync(path.join(s4Dir, 'internal-schematic.svg'))) realOutputs.push('internal-schematic.svg');
  }
  if (routesJson.internalDiagram) {
    copyFile(path.join(SK, 'diagram_internal.js'), s4Dir);
    const r3 = runNode(path.join(s4Dir, 'diagram_internal.js'), s4Dir, { SKILL_ASSETS: SK });
    if (r3.ok && fs.existsSync(path.join(s4Dir, 'internal-diagram.svg'))) realOutputs.push('internal-diagram.svg');
  }
  // place.json must ride the S4 commit too — the portal's import-map.mjs
  // --kind place requires it in --src, and `pull` never reaches back further
  // than one stage (pipeline.md P4 note).
  if (fs.existsSync(path.join(s4Dir, 'place.json'))) realOutputs.push('place.json');
  stage(p.dir, 'commit', 'S4', s4Dir, '--outputs', realOutputs.join(','), '--note', NOTE);
  fs.rmSync(scratch, { recursive: true, force: true });

  if (anyLost && !FORCE) {
    return { name: p.name, status: 'REVIEW-NEEDED', diffs, s4Dir, detail: 'S4 committed but NOT rendered/published — a label was lost vs the previous build. Inspect ' + s4Dir + ', then re-run with --force (or fix the cause and re-run).' };
  }

  const s5Dir = stage(p.dir, 'new', 'S5');
  stage(p.dir, 'pull', 'S4', s5Dir);
  const renderJs = path.join(SK, 'render.js');
  const svgOutputs = realOutputs.filter(f => f.endsWith('.svg'));
  const jpgOutputs = [];
  for (const svg of svgOutputs) {
    const jpg = svg.replace(/\.svg$/, '.jpg');
    const res = spawnSync(process.execPath, [renderJs, path.join(s5Dir, svg), path.join(s5Dir, jpg)], { encoding: 'utf8' });
    if (res.status === 0) jpgOutputs.push(jpg);
  }
  const s5Outputs = jpgOutputs.concat(svgOutputs);
  if (fs.existsSync(path.join(s5Dir, 'place.json'))) s5Outputs.push('place.json');
  stage(p.dir, 'commit', 'S5', s5Dir, '--outputs', s5Outputs.join(','), '--note', NOTE);
  spawnSync(process.execPath, [path.join(SK, 'refresh_latest.js'), p.dir], { encoding: 'utf8' });
  // Keep the small tracked CI reference mirror in step with what was just
  // published (see sync_ci_reference.js). It filters by town name, which
  // also mirrors every OTHER place under the same town — harmless (they're
  // already in sync) and simpler than adding a --place flag there too.
  spawnSync(process.execPath, [path.join(SK, 'sync_ci_reference.js'), '--buses', BUSES, '--town', p.town], { encoding: 'utf8' });

  return { name: p.name, status: 'DONE', diffs, anyLost, s4Dir, s5Dir, version: BUMP };
}

// ---- run ---------------------------------------------------------------
const allTowns = findTowns(BUSES);
const allPlaces = findPlaces(allTowns);
const selected = args.all ? allPlaces
  : args.place.length ? allPlaces.filter(p => args.place.includes(p.name))
  : allPlaces; // default: consider every place (UP-TO-DATE ones are skipped cheaply by the gate check)

if (!selected.length) { console.error('No matching places. --place names: ' + allPlaces.map(p => p.name).join(', ')); process.exit(2); }

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} rollout over ${selected.length} place(s)${APPLY ? '' : ' (pass --apply to write anything)'}\n`);

const results = [];
for (const p of selected) {
  process.stdout.write(`${p.town} / ${p.name}... `);
  let r;
  try { r = rolloutOnePlace(p); } catch (e) { r = { name: p.name, status: 'ERROR', detail: e.message }; }
  results.push(r);
  console.log(r.status + (r.detail ? ' — ' + r.detail : ''));
  if (r.diffs) {
    for (const [file, d] of Object.entries(r.diffs)) {
      if (d.lost.length) console.log(`    LOST in ${file}: ${d.lost.join(' | ')}`);
      if (d.gained.length) console.log(`    GAINED in ${file}: ${d.gained.join(' | ')}`);
    }
  }
}

console.log('\nSummary: ' + results.map(r => `${r.name}=${r.status}`).join(', '));
const bad = results.some(r => ['FAIL', 'ERROR', 'REVIEW-NEEDED'].includes(r.status));
process.exit(bad ? 1 : 0);
