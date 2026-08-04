#!/usr/bin/env node
/*
 * rollout.js — re-render one or more towns onto the CURRENT engine template,
 * automating the manual procedure in references/changing-the-engine.md §2a
 * ("A template improvement leaves already-built towns STALE — and that is the
 * normal state... re-render every town the change affects").
 *
 * A build's generator files are always copied fresh from the LIVE %SK%
 * template at S4 time (item 3, 2026-08-04 — S3 no longer freezes its own copy,
 * it only holds routes.json/overrides.json), and routes.json's "engine" field
 * records the hash of the code that drew it (see engine_version.js). So a
 * pure engine-only re-render needs only a **new S4**, not a new S3: pull S2+S3
 * (data unchanged) -> copy the current generators in -> stamp the engine hash
 * -> run generators [+schematic/diagram if configured] -> label-set diff
 * against the previous S4 -> commit -> new S5 -> render -> pull -> refresh
 * _latest. Needs no S1/S2 network fetch: an engine change is pure
 * deterministic compute over data already on disk.
 *
 * Usage:
 *   node rollout.js [--town "St Ives"]... [--all] [--bump minor|major]
 *                    [--note "..."] [--apply] [--force] [--buses "<dir>"]
 *
 * Default is DRY RUN: builds each town in a scratch temp dir, reports the
 * label-set diff (gained/lost text vs the currently-shipped SVG) and whether
 * it would now gate PASS, and writes nothing under Areas/. Pass --apply to
 * actually commit S4/S5 and refresh _latest (no S3 commit any more).
 *
 * Safety: if a town's rendered internal.svg or external.svg LOSES any label
 * versus its previous shipped version, --apply stops after committing S4
 * (nothing lost, that commit is inert until pulled) without rendering/
 * publishing — re-run with --force once you've reviewed the loss, or fix the
 * cause and re-run normally. A GAIN-only diff (e.g. a new opt-in field
 * filling in previously-absent data) is not blocked.
 *
 * Zero dependencies (Node core only).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SK, gate, labelSet, findTowns, readJson, latestRunDir, detectExternalStyle } = require('./gate_lib');
const { computeEngineVersion, stampEngine } = require('./engine_version');

function parseArgs(argv) {
  const f = { town: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--town') { f.town.push(argv[++i]); }
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
function runNode(scriptPath, cwd, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.LEAFLET_DIR; // must run with cwd = the workspace, per the env contract
  const res = spawnSync(process.execPath, [scriptPath], { cwd, env, encoding: 'utf8' });
  return { ok: res.status === 0, stdout: res.stdout, stderr: res.stderr };
}
function copyFile(src, destDir, name) {
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, path.join(destDir, name || path.basename(src)));
  return true;
}

// Label-set diff, oriented old->new (matches the doc's comm -23/-13 recipe):
// lost = present in old, gone in new. gained = present in new, absent in old.
function labelDiff(oldSvgPath, newSvgPath) {
  if (!fs.existsSync(oldSvgPath) || !fs.existsSync(newSvgPath)) return { lost: [], gained: [] };
  const oldLabels = labelSet(fs.readFileSync(oldSvgPath, 'utf8'));
  const newLabels = labelSet(fs.readFileSync(newSvgPath, 'utf8'));
  return {
    lost: oldLabels.filter(x => !newLabels.includes(x)),
    gained: newLabels.filter(x => !oldLabels.includes(x)),
  };
}

function rolloutOne(t) {
  const manifest = readJson(path.join(t.dir, 'manifest.json'));
  const prevS3 = latestRunDir(manifest, t.dir, 'S3');
  const prevS4 = latestRunDir(manifest, t.dir, 'S4');
  if (!prevS3 || !prevS4) return { name: t.name, status: 'SKIP', detail: 'no committed S3/S4 to roll forward from' };

  // Already current? Check the existing PASS/DIFF gate before doing any work.
  const style = detectExternalStyle(prevS4.dir);
  const internalGate = gate(path.join(SK, 'gen_internal.js'), prevS4.dir, 'internal.svg', path.join(prevS4.dir, 'internal.svg'));
  const externalGate = gate(path.join(SK, `gen_external_${style}.js`), prevS4.dir, 'external.svg', path.join(prevS4.dir, 'external.svg'));
  if (internalGate.status === 'PASS' && externalGate.status === 'PASS' && !FORCE) {
    return { name: t.name, status: 'UP-TO-DATE', detail: 'internal+external already gate PASS against the current template' };
  }

  let routesJson = {};
  try { routesJson = readJson(path.join(prevS3.dir, 'routes.json')); } catch (e) {}

  // ---- build in a scratch workspace first (this is also the entire dry-run) ----
  // Item 3 (2026-08-04): S3 no longer carries a frozen COPY of the generators —
  // it only holds routes.json/overrides.json (real per-town data). S4 always
  // copies the two generators fresh from the LIVE %SK% template and stamps the
  // engine hash it just used into routes.json's "engine" field, so a pure
  // engine-only re-render needs no new S3 run at all (routes.json/overrides.json
  // are unchanged; only the generator + the stamp move).
  const scratch = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rollout-'));
  fs.mkdirSync(path.join(scratch, 'S4'));
  copyFile(path.join(prevS3.dir, 'routes.json'), path.join(scratch, 'S4'));
  copyFile(path.join(prevS3.dir, 'overrides.json'), path.join(scratch, 'S4')); // optional
  // S4 workspace = S2 geometry jsons (from the previous S4, since S2 is unchanged) + routes.json/overrides.json above
  for (const name of fs.readdirSync(prevS4.dir)) {
    const p = path.join(prevS4.dir, name);
    if (fs.statSync(p).isDirectory()) continue;
    if (name.endsWith('.json') && name !== 'routes.json' && name !== 'overrides.json') fs.copyFileSync(p, path.join(scratch, 'S4', name));
  }
  copyFile(path.join(SK, 'gen_internal.js'), path.join(scratch, 'S4'));
  copyFile(path.join(SK, `gen_external_${style}.js`), path.join(scratch, 'S4'), 'gen_external.js');
  const engineHash = computeEngineVersion();
  stampEngine(path.join(scratch, 'S4', 'routes.json'), engineHash);

  const s4 = path.join(scratch, 'S4');
  const outputs = [];
  let genOk = runNode(path.join(s4, 'gen_internal.js'), s4);
  if (!genOk.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: t.name, status: 'FAIL', detail: 'gen_internal.js: ' + genOk.stderr.split('\n')[0] }; }
  outputs.push('internal.svg');
  genOk = runNode(path.join(s4, 'gen_external.js'), s4);
  if (!genOk.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: t.name, status: 'FAIL', detail: 'gen_external.js: ' + genOk.stderr.split('\n')[0] }; }
  outputs.push('external.svg');
  if (routesJson.internalSchematic) {
    copyFile(path.join(SK, 'schematize_internal.js'), s4);
    const r = runNode(path.join(s4, 'schematize_internal.js'), s4, { SKILL_ASSETS: SK });
    if (r.ok && fs.existsSync(path.join(s4, 'internal-schematic.svg'))) outputs.push('internal-schematic.svg');
  }
  if (routesJson.internalDiagram) {
    copyFile(path.join(SK, 'diagram_internal.js'), s4);
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
    return { name: t.name, status: 'DRY-RUN', diffs, anyLost, version: prevS4.rec.version };
  }

  // ---- apply for real, via stage.js so the manifest/version-stamp rules are authoritative ----
  // No new S3 run: routes.json/overrides.json are unchanged for a pure engine
  // rollout, and S3 no longer carries a generator copy to re-commit (item 3).
  // S4 pulls S3's data as-is, then the generators are copied in fresh from the
  // live template and the engine hash is stamped, same as the dry-run above.
  const s4Dir = stage(t.dir, 'new', 'S4', '--bump', BUMP);
  stage(t.dir, 'pull', 'S2', s4Dir);
  stage(t.dir, 'pull', 'S3', s4Dir); // also syncs routes.json's printed version stamp to this run's v<N.N>
  copyFile(path.join(SK, 'gen_internal.js'), s4Dir);
  copyFile(path.join(SK, `gen_external_${style}.js`), s4Dir, 'gen_external.js');
  stampEngine(path.join(s4Dir, 'routes.json'), engineHash);
  let r = runNode(path.join(s4Dir, 'gen_internal.js'), s4Dir);
  if (!r.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: t.name, status: 'FAIL', detail: 'gen_internal.js (real S4): ' + r.stderr.split('\n')[0] }; }
  r = runNode(path.join(s4Dir, 'gen_external.js'), s4Dir);
  if (!r.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: t.name, status: 'FAIL', detail: 'gen_external.js (real S4): ' + r.stderr.split('\n')[0] }; }
  const realOutputs = ['internal.svg', 'external.svg'];
  if (routesJson.internalSchematic) { runNode(path.join(s4Dir, 'schematize_internal.js'), s4Dir, { SKILL_ASSETS: SK }); if (fs.existsSync(path.join(s4Dir, 'internal-schematic.svg'))) realOutputs.push('internal-schematic.svg'); }
  if (routesJson.internalDiagram) { runNode(path.join(s4Dir, 'diagram_internal.js'), s4Dir, { SKILL_ASSETS: SK }); if (fs.existsSync(path.join(s4Dir, 'internal-diagram.svg'))) realOutputs.push('internal-diagram.svg'); }
  stage(t.dir, 'commit', 'S4', s4Dir, '--outputs', realOutputs.join(','), '--note', NOTE);
  fs.rmSync(scratch, { recursive: true, force: true });

  if (anyLost && !FORCE) {
    return { name: t.name, status: 'REVIEW-NEEDED', diffs, s4Dir, detail: 'S4 committed but NOT rendered/published — a label was lost vs the previous build. Inspect ' + s4Dir + ', then re-run with --force (or fix the cause and re-run).' };
  }

  const s5Dir = stage(t.dir, 'new', 'S5');
  stage(t.dir, 'pull', 'S4', s5Dir);
  const renderJs = path.join(SK, 'render.js');
  const jpgOutputs = [];
  for (const svg of realOutputs) {
    const jpg = svg.replace(/\.svg$/, '.jpg');
    const res = spawnSync(process.execPath, [renderJs, path.join(s5Dir, svg), path.join(s5Dir, jpg)], { encoding: 'utf8' });
    if (res.status === 0) jpgOutputs.push(jpg);
  }
  stage(t.dir, 'commit', 'S5', s5Dir, '--outputs', jpgOutputs.join(','), '--note', NOTE);
  spawnSync(process.execPath, [path.join(SK, 'refresh_latest.js'), t.dir], { encoding: 'utf8' });
  // Keep the small tracked CI reference mirror (see sync_ci_reference.js) in
  // step with what was just published, so CI's gate stays meaningful.
  spawnSync(process.execPath, [path.join(SK, 'sync_ci_reference.js'), '--buses', BUSES, '--town', t.name], { encoding: 'utf8' });

  return { name: t.name, status: 'DONE', diffs, anyLost, s4Dir, s5Dir, version: BUMP };
}

// ---- run ---------------------------------------------------------------
const allTowns = findTowns(BUSES);
const selected = args.all ? allTowns
  : args.town.length ? allTowns.filter(t => args.town.includes(t.name))
  : allTowns; // default: consider every town (UP-TO-DATE ones are skipped cheaply by the gate check)

if (!selected.length) { console.error('No matching towns. --town names: ' + allTowns.map(t => t.name).join(', ')); process.exit(2); }

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} rollout over ${selected.length} town(s)${APPLY ? '' : ' (pass --apply to write anything)'}\n`);

const results = [];
for (const t of selected) {
  process.stdout.write(`${t.name}... `);
  let r;
  try { r = rolloutOne(t); } catch (e) { r = { name: t.name, status: 'ERROR', detail: e.message }; }
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
