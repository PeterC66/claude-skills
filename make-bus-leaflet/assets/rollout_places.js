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
const BUILDLOG = require('./build_log');
// ---- the printed sheet version (footer.js design.sheetVersion) -------------
//
// Peter, 2026-08-19: a sheet needs a version he can quote back when something on it
// looks wrong, and the three places a sheet can come from need three different
// answers. This is the FIRST of them — a map built here, before it has ever reached
// the portal — and it says so in as many words, so it can never be mistaken for the
// portal's customer-facing number. The other two (a portal draft, and a published
// version) are the portal's to stamp, via LEAFLET_SHEET_VERSION.
//
// Written into the RUN'S OWN routes.json rather than passed as an environment
// variable, and that is the whole reason it works: gate.sh reproduces a sheet from
// its data folder and nothing else, so a value in routes.json is reproducible and a
// value in the environment would make every gate DIFF forever.
//
// The date comes from the run folder's name, not from the clock — same reason the
// generators may not read the clock at all (invariant 5, deterministic output).
const _MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function buildStamp(runDirName) {
  const m = /v([\d.]+)_(\d{4})-(\d{2})-(\d{2})/.exec(String(runDirName || ''));
  if (!m) return null;
  return `build ${m[1]} \u00b7 ${+m[4]} ${_MON[+m[3] - 1]} ${m[2]}`;
}
function stampSheetVersion(routesPath, runDirName) {
  const stamp = buildStamp(runDirName);
  if (!stamp) return null;
  let rj;
  try { rj = JSON.parse(fs.readFileSync(routesPath, 'utf8')); } catch (e) { return null; }
  rj.design = rj.design || {};
  rj.design.sheetVersion = stamp;
  fs.writeFileSync(routesPath, JSON.stringify(rj, null, 2) + '\n');
  return stamp;
}

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
// --keep <dir>: dry run only. Copy each place's built sheets out before the scratch
// workspace is deleted, so they can be measured and rendered rather than judged from
// the label-set diff alone. Ignored with --apply (the sheets go to S4 anyway).
const KEEP = typeof args.keep === 'string' ? args.keep : null;

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
// The boarding-plan sheet is a place's THIRD output (make-place-bus-leaflet SKILL.md
// "Phase 3"), drawn by an engine-level generator in this folder rather than the place
// skill's. It was missing from this tool entirely until 2026-08-23 — so a rollout of
// a place that has one committed an S4 with internal + external and no boarding.svg
// at all, quietly dropping a whole sheet while _latest kept mirroring the previous
// run's copy. `boardingPlan` in routes.json is the same gate gen_boarding.js applies
// to itself: absent means the place declines the sheet, which is a valid answer and
// not an error.
const GEN_BOARDING = path.join(SK, 'gen_boarding.js');
function buildBoarding(dir) {
  copyFile(GEN_BOARDING, dir);
  return runNode(path.join(dir, 'gen_boarding.js'), dir, { SKILL_ASSETS: SK });
}

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

  // WHICH SHEETS DOES THIS PLACE ACTUALLY SHIP? Read it off the previous S4 rather
  // than assuming. Until 2026-08-23 this tool took "a place has an internal" as given
  // and would have died in buildInternal() on High Wycombe High Street and High
  // Wycombe Town Centre, which are BOARDING-ONLY (`internalRoads:false`, no external):
  // the boarding plan can be the whole product at a lettered town centre, and those
  // two places have never had another sheet.
  const hadInternal = fs.existsSync(path.join(prevS4.dir, 'internal.svg'));
  const hadExternal = fs.existsSync(path.join(prevS4.dir, 'external.svg'));

  // Already current? Same fast-path as rollout.js: check the existing
  // PASS/DIFF gate (status.js's gatePlace logic) before doing any work.
  const internalGate = hadInternal
    ? gate(path.join(SK, 'gen_internal.js'), prevS4.dir, 'internal.svg', path.join(prevS4.dir, 'internal.svg'), { ignoreLineRe: PLACE_IGNORE })
    : { status: 'SKIP' };
  const hasExternalGen = fs.existsSync(GEN_EXTERNAL_PLACES) && hadExternal;
  const externalGate = hasExternalGen
    ? gate(GEN_EXTERNAL_PLACES, prevS4.dir, 'external.svg', path.join(prevS4.dir, 'external.svg'))
    : { status: 'SKIP' };
  let routesJson = {};
  try { routesJson = readJson(path.join(prevS3.dir, 'routes.json')); } catch (e) {}

  // The boarding sheet has to be in the fast path too, or a place whose ONLY stale
  // sheet is its boarding plan reports UP-TO-DATE and is skipped — including the case
  // this tool created for itself before it could build one: a previous rollout whose
  // S4 has no boarding.svg at all, while the place's routes.json asks for one.
  const wantsBoarding = !!routesJson.boardingPlan;
  const boardingGate = !wantsBoarding ? { status: 'SKIP' }
    : !fs.existsSync(path.join(prevS4.dir, 'boarding.svg')) ? { status: 'MISSING' }
    : gate(GEN_BOARDING, prevS4.dir, 'boarding.svg', path.join(prevS4.dir, 'boarding.svg'));
  const ok = (g) => g.status === 'PASS' || g.status === 'SKIP';
  const shipped = [hadInternal && 'internal', hadExternal && 'external', wantsBoarding && 'boarding'].filter(Boolean);
  if (ok(internalGate) && ok(externalGate) && ok(boardingGate) && !FORCE) {
    return { name: p.name, status: 'UP-TO-DATE', detail: shipped.join('+') + ' already gate PASS against the current template' };
  }

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
  // Every generator's stderr is kept, not just a failing one's — the guards that
  // matter refuse to draw and then exit 0 (build_log.js).
  const said = [];
  let genOk;
  if (hadInternal) {
    genOk = buildInternal(s4);
    if (!genOk.ok || !fs.existsSync(path.join(s4, 'internal.svg'))) {
      fs.rmSync(scratch, { recursive: true, force: true });
      return { name: p.name, status: 'FAIL', detail: 'build_internal_place.js: ' + (genOk.stderr || 'no internal.svg produced').split('\n')[0] };
    }
    outputs.push('internal.svg');
    said.push({ source: 'internal', stderr: genOk.stderr });
  }
  if (hasExternalGen) {
    copyFile(GEN_EXTERNAL_PLACES, s4);
    genOk = runNode(path.join(s4, 'gen_external_places.js'), s4);
    said.push({ source: 'external', stderr: genOk.stderr });
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
    said.push({ source: 'schematic', stderr: r.stderr });
    if (r.ok && fs.existsSync(path.join(s4, 'internal-schematic.svg'))) outputs.push('internal-schematic.svg');
  }
  if (routesJson.boardingPlan) {
    const r = buildBoarding(s4);
    said.push({ source: 'boarding', stderr: r.stderr });
    if (r.ok && fs.existsSync(path.join(s4, 'boarding.svg'))) outputs.push('boarding.svg');
    else return (fs.rmSync(scratch, { recursive: true, force: true }),
      { name: p.name, status: 'FAIL', detail: 'gen_boarding.js: ' + ((r.stderr || 'no boarding.svg produced').split('\n')[0]) });
  }
  if (routesJson.internalDiagram) {
    copyFile(path.join(SK, 'diagram_internal.js'), s4);
    // Deliberately NOT OVERRIDES_FILE here, unlike schematic above:
    // diagram_internal.js copies its OWN diagram-overrides.json (S3-owned)
    // into the workspace as overrides.json; forcing OVERRIDES_FILE would
    // shadow that file entirely (gen_internal.js prefers OVERRIDES_FILE over
    // its cwd-relative overrides.json unconditionally).
    const r = runNode(path.join(s4, 'diagram_internal.js'), s4, { SKILL_ASSETS: SK });
    said.push({ source: 'diagram', stderr: r.stderr });
    if (r.ok && fs.existsSync(path.join(s4, 'internal-diagram.svg'))) outputs.push('internal-diagram.svg');
  }

  const diffs = {};
  const warnings = BUILDLOG.collect(said);
  const blockers = BUILDLOG.blocking(warnings);
  let anyLost = false;
  for (const name of outputs) {
    const d = labelDiff(path.join(prevS4.dir, name), path.join(s4, name));
    diffs[name] = d;
    if (d.lost.length) anyLost = true;
  }

  if (!APPLY) {
    // --keep <dir>: leave the built sheets somewhere so they can be MEASURED and
    // LOOKED AT before anything is applied. preview_design.js has had this for the
    // towns all along; places had only the label-set diff, which is a set and
    // therefore cannot see a duplicate copy being merged, a label moving, or a box
    // sliding under the footer plate. Added 2026-08-16 (plan Phase 8 item 4), when
    // judging the place internals needed exactly that and there was nothing to point
    // quality_metrics.js at.
    if (KEEP) {
      const dest = path.join(path.resolve(KEEP), p.name.replace(/[^\w]/g, '_'));
      fs.mkdirSync(dest, { recursive: true });
      for (const name of fs.readdirSync(s4)) {
        const fp = path.join(s4, name);
        if (!fs.statSync(fp).isDirectory()) fs.copyFileSync(fp, path.join(dest, name));
      }
    }
    fs.rmSync(scratch, { recursive: true, force: true });
    return { name: p.name, status: 'DRY-RUN', diffs, anyLost, warnings, blockers, version: prevS4.rec.version, kept: KEEP || null };
  }

  // ---- apply for real, via stage.js so the manifest/version-stamp rules are authoritative ----
  const s4Dir = stage(p.dir, 'new', 'S4', '--bump', BUMP);
  stage(p.dir, 'pull', 'S1', s4Dir); // place.json is an S1 output (pipeline.md P4 note) — pull it explicitly, not just S2
  stage(p.dir, 'pull', 'S2', s4Dir);
  stage(p.dir, 'pull', 'S3', s4Dir); // also syncs routes.json's printed version stamp to this run's v<N.N>
  // roads_geo.json/routes_paths.json (and anything else build_internal_place_roads.js
  // wrote) are S4-GENERATED, not registered S2 outputs — `stage.js pull S2` never
  // brings them in, so a real (non-scratch) apply run was missing them entirely
  // and crashed reading roads_geo.json (found 2026-08-10 rolling out all 5
  // places: the scratch/dry-run path above already carries these forward from
  // prevS4, this real path didn't). Mirror that here.
  for (const name of fs.readdirSync(prevS4.dir)) {
    const fp = path.join(prevS4.dir, name);
    if (fs.statSync(fp).isDirectory()) continue;
    if (name.endsWith('.json') && !s3Carry.includes(name) && !fs.existsSync(path.join(s4Dir, name))) fs.copyFileSync(fp, path.join(s4Dir, name));
  }
  stampEngine(path.join(s4Dir, 'routes.json'), engineHash);
  const sheetStamp = stampSheetVersion(path.join(s4Dir, 'routes.json'), path.basename(s4Dir));
  let r;
  const realOutputs = [];
  const realSaid = [];
  if (hadInternal) {
    r = buildInternal(s4Dir);
    if (!r.ok || !fs.existsSync(path.join(s4Dir, 'internal.svg'))) {
      fs.rmSync(scratch, { recursive: true, force: true });
      return { name: p.name, status: 'FAIL', detail: 'build_internal_place.js (real S4): ' + (r.stderr || 'no internal.svg produced').split('\n')[0] };
    }
    realOutputs.push('internal.svg');
    realSaid.push({ source: 'internal', stderr: r.stderr });
  }
  if (hasExternalGen) {
    copyFile(GEN_EXTERNAL_PLACES, s4Dir);
    r = runNode(path.join(s4Dir, 'gen_external_places.js'), s4Dir);
    realSaid.push({ source: 'external', stderr: r.stderr });
    if (!r.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: p.name, status: 'FAIL', detail: 'gen_external_places.js (real S4): ' + r.stderr.split('\n')[0] }; }
    realOutputs.push('external.svg');
  }
  if (routesJson.internalSchematic || routesJson.internalDiagram) copyFile(path.join(PSK, 'gen_internal_place.js'), s4Dir);
  if (routesJson.internalSchematic) {
    copyFile(path.join(SK, 'schematize_internal.js'), s4Dir);
    const r2 = runNode(path.join(s4Dir, 'schematize_internal.js'), s4Dir, { SKILL_ASSETS: SK, OVERRIDES_FILE: path.join(s4Dir, 'overrides.json') });
    realSaid.push({ source: 'schematic', stderr: r2.stderr });
    if (r2.ok && fs.existsSync(path.join(s4Dir, 'internal-schematic.svg'))) realOutputs.push('internal-schematic.svg');
  }
  if (routesJson.boardingPlan) {
    const rb = buildBoarding(s4Dir);
    realSaid.push({ source: 'boarding', stderr: rb.stderr });
    if (rb.ok && fs.existsSync(path.join(s4Dir, 'boarding.svg'))) realOutputs.push('boarding.svg');
    else { fs.rmSync(scratch, { recursive: true, force: true }); return { name: p.name, status: 'FAIL', detail: 'gen_boarding.js (real S4): ' + ((rb.stderr || 'no boarding.svg produced').split('\n')[0]) }; }
  }
  if (routesJson.internalDiagram) {
    copyFile(path.join(SK, 'diagram_internal.js'), s4Dir);
    const r3 = runNode(path.join(s4Dir, 'diagram_internal.js'), s4Dir, { SKILL_ASSETS: SK });
    realSaid.push({ source: 'diagram', stderr: r3.stderr });
    if (r3.ok && fs.existsSync(path.join(s4Dir, 'internal-diagram.svg'))) realOutputs.push('internal-diagram.svg');
  }
  // place.json must ride the S4 commit too — the portal's import-map.mjs
  // --kind place requires it in --src, and `pull` never reaches back further
  // than one stage (pipeline.md P4 note).
  if (fs.existsSync(path.join(s4Dir, 'place.json'))) realOutputs.push('place.json');
  // The log goes in the run folder beside the artwork it describes and rides the
  // commit as an output, so "what did the engine say when it drew this?" stays
  // answerable from the tree without rebuilding.
  const realWarnings = BUILDLOG.collect(realSaid);
  const realBlockers = BUILDLOG.blocking(realWarnings);
  BUILDLOG.write(s4Dir, realWarnings);
  realOutputs.push(BUILDLOG.LOG_NAME);
  stage(p.dir, 'commit', 'S4', s4Dir, '--outputs', realOutputs.join(','), '--note', NOTE);
  fs.rmSync(scratch, { recursive: true, force: true });

  if (realBlockers.length && !FORCE) {
    return { name: p.name, status: 'REVIEW-NEEDED', diffs, s4Dir, warnings: realWarnings, blockers: realBlockers,
      detail: 'S4 committed but NOT rendered/published — ' + realBlockers.length + ' blocking build warning'
        + (realBlockers.length > 1 ? 's' : '') + ' (the engine refused to draw something, or a label names nothing). Read '
        + path.join(s4Dir, BUILDLOG.LOG_NAME) + ', fix the config it names, then re-run (or --force to publish anyway).' };
  }
  if (anyLost && !FORCE) {
    return { name: p.name, status: 'REVIEW-NEEDED', diffs, s4Dir, warnings: realWarnings, blockers: realBlockers, detail: 'S4 committed but NOT rendered/published — a label was lost vs the previous build. Inspect ' + s4Dir + ', then re-run with --force (or fix the cause and re-run).' };
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
  // published (see sync_ci_reference.js). This passed `--town p.town` until
  // 2026-08-23, on the reasoning that mirroring the town's other places too was
  // harmless and saved adding a flag there. It was harmless only while every place
  // had a town: `p.town` is null for a STANDALONE place, so the sync would exit 2
  // with "No town named null" — and since the result is never checked, the mirror
  // would silently not happen. `--place` names one place in any layout.
  spawnSync(process.execPath, [path.join(SK, 'sync_ci_reference.js'), '--buses', BUSES, '--place', p.name], { encoding: 'utf8' });

  return { name: p.name, status: 'DONE', diffs, anyLost, warnings: realWarnings, blockers: realBlockers, s4Dir, s5Dir, version: BUMP, sheetStamp };
}

// ---- run ---------------------------------------------------------------
const allTowns = findTowns(BUSES);
const allPlaces = findPlaces(allTowns, BUSES);
const selected = args.all ? allPlaces
  : args.place.length ? allPlaces.filter(p => args.place.includes(p.name))
  : allPlaces; // default: consider every place (UP-TO-DATE ones are skipped cheaply by the gate check)

if (!selected.length) { console.error('No matching places. --place names: ' + allPlaces.map(p => p.name).join(', ')); process.exit(2); }

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} rollout over ${selected.length} place(s)${APPLY ? '' : ' (pass --apply to write anything)'}\n`);

const results = [];
for (const p of selected) {
  process.stdout.write(`${p.town || "(standalone)"} / ${p.name}... `);
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
  for (const w of (r.blockers || [])) console.log(`    BLOCKING [${w.source}] ${w.text}`);
  const soft = (r.warnings || []).filter(w => w.severity === 'WARN');
  if (soft.length && args.warnings) for (const w of soft) console.log(`    warn [${w.source}] ${w.text}`);
  else if (soft.length) console.log(`    ${soft.length} non-blocking warning${soft.length > 1 ? 's' : ''} (pass --warnings to see them)`);
}

console.log('\nSummary: ' + results.map(r => `${r.name}=${r.status}`).join(', '));
const totalBlockers = results.reduce((n, r) => n + ((r.blockers || []).length), 0);
if (totalBlockers) console.log(`${totalBlockers} BLOCKING build warning(s) across ${results.filter(r => (r.blockers || []).length).length} place(s) — the engine refused to draw something, or a label names nothing.`);
const bad = results.some(r => ['FAIL', 'ERROR', 'REVIEW-NEEDED'].includes(r.status)) || (!APPLY && totalBlockers > 0);
process.exit(bad ? 1 : 0);
