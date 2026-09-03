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
 * Build warnings (2026-08-19): every generator's stderr is captured, classified
 * (build_log.js) and written into the S4 run folder as build-warnings.txt, which is
 * committed as an output. A BLOCKING warning — the engine refused to draw something,
 * or drew a label that names nothing — stops --apply before render/publish, exactly
 * like a lost label, and clears with --force. Pass --warnings to print the
 * non-blocking ones too. Before this the stream was thrown away on success, which is
 * the one case where it matters: a guard that refuses to draw still exits 0.
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
const { parseArgs, resolveBuses } = require('./cli');
const { spawnSync } = require('child_process');
const { SK, gate, labelDiff, findTowns, readJson, latestRunDir, unrenderedS4, EXTERNAL_GENERATOR } = require('./gate_lib');
const { computeEngineVersion, stampEngine } = require('./engine_version');
// One value for the whole run, computed once, exactly as status.js does — the
// two tools compare the same number against the same file (OA-179).
const CURRENT_ENGINE = computeEngineVersion();
const BUILDLOG = require('./build_log');
// The printed sheet version (footer.js design.sheetVersion). Byte-identical
// copies of this lived in BOTH rollouts until 2026-08-29 and in neither of the
// other two routes into an S4, which is how a hand-built build shipped with no
// stamp at all (OA-161). One copy now, in sheet_stamps.js, reachable from the
// stage boundary that enforces it.
const { stampSheetVersion } = require('./sheet_stamps');
const { scratchDir } = require('./scratch');

const args = parseArgs(process.argv.slice(2), { repeat: ['town'] });
const BUSES = resolveBuses(args);
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

// labelDiff (label-set diff, oriented old->new, version-stamp-filtered) now
// lives in gate_lib.js, shared with rollout_places.js — see its comment for
// the 2026-08-09 false-positive fix.

function rolloutOne(t) {
  const manifest = readJson(path.join(t.dir, 'manifest.json'));
  const prevS3 = latestRunDir(manifest, t.dir, 'S3');
  const prevS4 = latestRunDir(manifest, t.dir, 'S4');
  if (!prevS3 || !prevS4) return { name: t.name, status: 'SKIP', detail: 'no committed S3/S4 to roll forward from' };

  /* Already current? Check the existing PASS/DIFF gate before doing any work.
   *
   * ALL FOUR SHEETS, as of 2026-08-28. This test used to read `internal` and
   * `external` and nothing else, so a town whose SCHEMATIC or DIAGRAM would be
   * redrawn by the current template was reported UP-TO-DATE and skipped — the
   * rollout's own answer to "does this town need rebuilding" was blind to half
   * its deliverables. Caught on OA-147: Beaconsfield, March and Wisbech all came
   * back UP-TO-DATE while status.js showed a DIFF on a schematic or a diagram,
   * and March's was an exit arrowhead with no area at all. A tool that decides
   * what to rebuild from a subset of what it builds will keep a defect alive
   * indefinitely and report a clean board while it does it.
   *
   * status.js gates the same four from the same routes.json keys; these two now
   * agree, which is the point. A town that configures neither key is unaffected
   * and the extra gates do not run.
   */
  const rj = readJson(path.join(prevS4.dir, 'routes.json')) || {};
  const sheetGates = [
    ['internal', gate(path.join(SK, 'gen_internal.js'), prevS4.dir, 'internal.svg', path.join(prevS4.dir, 'internal.svg'))],
    ['external', gate(path.join(SK, EXTERNAL_GENERATOR), prevS4.dir, 'external.svg', path.join(prevS4.dir, 'external.svg'))],
  ];
  if (rj.internalSchematic) sheetGates.push(['internal-schematic',
    gate(path.join(SK, 'schematize_internal.js'), prevS4.dir, 'internal-schematic.svg', path.join(prevS4.dir, 'internal-schematic.svg'))]);
  if (rj.internalDiagram) sheetGates.push(['internal-diagram',
    gate(path.join(SK, 'diagram_internal.js'), prevS4.dir, 'internal-diagram.svg', path.join(prevS4.dir, 'internal-diagram.svg'))]);
  const internalGate = sheetGates[0][1], externalGate = sheetGates[1][1];
  /* AND THE STAMP, AS OF 2026-08-30 (OA-179). Four gates PASS means "no sheet
   * would change"; it does not mean "nothing to do". `routes.json`'s `engine`
   * field is a separate claim — WHICH engine build drew this — and until today
   * this function never read it. On 2026-08-30 an engine round moved the
   * template hash from 30fbffe221 to 7e59f923e5 while changing the drawn output
   * of exactly one sheet in the estate: `rollout.js --all` reported seven towns
   * UP-TO-DATE and one to rebuild, and `status.js` reported eight ENGINE STALE
   * in the same minute. Both were right about what they measured. Since OA-151
   * a stale stamp FAILS the board, so the state reported as needing nothing was
   * a state in which the board exits non-zero — and the only tool that can clear
   * it had just said there was nothing to clear.
   *
   * THIS REPORTS; IT DOES NOT WRITE, AND THAT IS THE WHOLE DESIGN. The obvious
   * fix is a --stamp-only that rewrites `engine` on a map whose sheets gate
   * PASS. Do not build it. `engine` means *which engine build drew this*;
   * rewriting it without re-running the generators quietly converts it into
   * *which engine reproduces this*, and those are different claims. The byte
   * gate already answers the second; this field is the only record of the
   * first, and it is what `track:engine` and the whole OA-130 tracking decision
   * rest on. So the rebuild is real work and --force is the right way to ask
   * for it; the bug was only ever that nobody was told.
   *
   * IT READS THE SAME FILE STATUS.JS READS — the latest S4 run's routes.json,
   * not ci-reference — so the two tools cannot disagree about the input. And it
   * excuses `(none)` and an absent field on status.js's terms: a map stamped
   * before the hash existed is a different question, reported and never gated.
   *
   * IT DOES NOT MOVE THE EXIT CODE. status.js is the board and already gates
   * this; a second red here adds no signal, and turning a tool you run to find
   * out what to do into a tool that fails while telling you is how a check gets
   * a --no-verify habit built around it. The summary line below names it
   * loudly instead.
   */
  /* AN UNRENDERED S4 IS NOT UP TO DATE, WHATEVER THE GATES SAY (OA-198). The row
   * was written about rollout_places.js; this tool has the same stop after the same
   * S4 commit, so it produces the same state and its fast path buries it the same
   * way. Fixing one and not the other is how a guard covers a class once rather
   * than completely. See unrenderedS4() in gate_lib.js. */
  /* AND IT HAS TO YIELD TO --force, OR ITS OWN REMEDY IS A NO-OP (2026-09-01).
   * This returned unconditionally, and the sentence it printed told you to re-run
   * with `--apply --force` — which reached this same line and returned the same
   * refusal, for ever. Hit for real on High Wycombe during the OA-187/OA-213
   * rollout: a transient file-open error killed the run between the S4 commit and
   * the S5 render, leaving exactly the state this guard is for, and the guard's
   * advice could not clear it. A guard whose stated remedy cannot satisfy it is
   * worse than no guard: it stops the one tool that could fix the state. --force
   * is the whole vocabulary this file already has for "a human has read this", and
   * every other stop here honours it. */
  const unrendered = unrenderedS4(manifest);
  if (unrendered && !FORCE) {
    return { name: t.name, status: 'UNRENDERED',
             detail: `S4 v${unrendered} is committed and NO S5 run has rendered it, so every byte gate passes against a `
                   + `version that has no JPG on disk. Finish it with:  `
                   + `node rollout.js --town "${t.name}" --apply --force` };
  }

  const stampedEngine = rj.engine;
  if (sheetGates.every(([, g]) => g.status === 'PASS') && !FORCE
      && stampedEngine && stampedEngine !== '(none)' && stampedEngine !== CURRENT_ENGINE) {
    return { name: t.name, status: 'STAMP-STALE',
             detail: `every sheet gates PASS, but routes.json says engine ${stampedEngine} and the current template is `
                   + `${CURRENT_ENGINE} — status.js gates that as ENGINE STALE. Rebuild and re-stamp with:  `
                   + `node rollout.js --town "${t.name}" --apply --force` };
  }
  if (sheetGates.every(([, g]) => g.status === 'PASS') && !FORCE) {
    return { name: t.name, status: 'UP-TO-DATE',
             detail: sheetGates.map(([n]) => n).join('+')
                   + ' already gate PASS against the current template, and the engine stamp is current' };
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
  const scratch = scratchDir('rollout-');
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
  copyFile(path.join(SK, EXTERNAL_GENERATOR), path.join(scratch, 'S4'), 'gen_external.js');
  const engineHash = CURRENT_ENGINE;
  stampEngine(path.join(scratch, 'S4', 'routes.json'), engineHash);
  // Dry-run parity: stamp the PREVIOUS run's identifier so the label-set diff below
  // compares like with like. Stamping the next one would report the version line as
  // both lost and gained on every town, every time, which is noise that trains you to
  // skim the diff — the one thing it exists to stop you doing.
  stampSheetVersion(path.join(scratch, 'S4', 'routes.json'), path.basename(prevS4.dir));

  const s4 = path.join(scratch, 'S4');
  const outputs = [];
  // Every generator's stderr is KEPT, not just a failing one's. The guards that
  // matter most refuse to draw and then exit 0, so a build that "succeeded" is
  // precisely the case where nothing was listening — see build_log.js.
  const said = [];
  let genOk = runNode(path.join(s4, 'gen_internal.js'), s4);
  said.push({ source: 'internal', stderr: genOk.stderr, ok: genOk.ok });
  if (!genOk.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: t.name, status: 'FAIL', detail: 'gen_internal.js: ' + genOk.stderr.split('\n')[0] }; }
  outputs.push('internal.svg');
  genOk = runNode(path.join(s4, 'gen_external.js'), s4);
  said.push({ source: 'external', stderr: genOk.stderr, ok: genOk.ok });
  if (!genOk.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: t.name, status: 'FAIL', detail: 'gen_external.js: ' + genOk.stderr.split('\n')[0] }; }
  outputs.push('external.svg');
  if (routesJson.internalSchematic) {
    copyFile(path.join(SK, 'schematize_internal.js'), s4);
    const r = runNode(path.join(s4, 'schematize_internal.js'), s4, { SKILL_ASSETS: SK });
    said.push({ source: 'schematic', stderr: r.stderr, ok: r.ok });
    if (r.ok && fs.existsSync(path.join(s4, 'internal-schematic.svg'))) outputs.push('internal-schematic.svg');
  }
  if (routesJson.internalDiagram) {
    copyFile(path.join(SK, 'diagram_internal.js'), s4);
    const r = runNode(path.join(s4, 'diagram_internal.js'), s4, { SKILL_ASSETS: SK });
    said.push({ source: 'diagram', stderr: r.stderr, ok: r.ok });
    if (r.ok && fs.existsSync(path.join(s4, 'internal-diagram.svg'))) outputs.push('internal-diagram.svg');
  }
  const warnings = BUILDLOG.collect(said);
  const blockers = BUILDLOG.blocking(warnings);

  const diffs = {};
  let anyLost = false;
  for (const name of outputs) {
    const d = labelDiff(path.join(prevS4.dir, name), path.join(s4, name));
    diffs[name] = d;
    if (d.lost.length) anyLost = true;
  }

  if (!APPLY) {
    fs.rmSync(scratch, { recursive: true, force: true });
    return { name: t.name, status: 'DRY-RUN', diffs, anyLost, warnings, blockers, version: prevS4.rec.version };
  }

  // A lost label stops the rollout BEFORE anything is written -- see the same
  // block in rollout_places.js. The old position, after `stage.js commit S4`,
  // left a committed S4 with no S5 render: the manifest naming a version that
  // has no JPG, and byte gates passing against it. The backlog recorded this
  // against the PLACE rollout only, because that is where it was hit; the town
  // rollout was written from the same template and had it too.
  if (anyLost && !FORCE) {
    return { name: t.name, status: 'REVIEW-NEEDED', diffs, warnings, blockers,
      detail: 'a label was lost vs the previous build, and NOTHING was written. Inspect the dry run, then re-run with --force (or fix the cause and re-run).' };
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
  copyFile(path.join(SK, EXTERNAL_GENERATOR), s4Dir, 'gen_external.js');
  stampEngine(path.join(s4Dir, 'routes.json'), engineHash);
  const sheetStamp = stampSheetVersion(path.join(s4Dir, 'routes.json'), path.basename(s4Dir));
  const realSaid = [];
  // BUILD_META_DIR asks gen_internal.js to write build-meta.json beside the artwork
  // — chiefly the rotation it actually applied, which is otherwise only a formatted
  // number inside a stdout sentence. freeze_orientation.js reads it to turn "keep it
  // the way the published sheet is" into an explicit design.fixedOrientation. Set
  // only here, on the REAL S4 run: the scratch dry-run above would overwrite it with
  // a build that is then thrown away.
  let r = runNode(path.join(s4Dir, 'gen_internal.js'), s4Dir, { BUILD_META_DIR: s4Dir });
  realSaid.push({ source: 'internal', stderr: r.stderr, ok: r.ok });
  if (!r.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: t.name, status: 'FAIL', detail: 'gen_internal.js (real S4): ' + r.stderr.split('\n')[0] }; }
  r = runNode(path.join(s4Dir, 'gen_external.js'), s4Dir);
  realSaid.push({ source: 'external', stderr: r.stderr, ok: r.ok });
  if (!r.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: t.name, status: 'FAIL', detail: 'gen_external.js (real S4): ' + r.stderr.split('\n')[0] }; }
  const realOutputs = ['internal.svg', 'external.svg'];
  // Bug fixed 2026-08-06: this block ran schematize_internal.js/diagram_internal.js straight out
  // of s4Dir without ever copying them in (unlike the scratch dry-run above, which does) — the
  // spawn silently failed (ENOENT), r.ok was never checked, and the town's schematic/diagram
  // output just vanished from the commit with no error surfaced. Caught when High Wycombe,
  // Beaconsfield, St Neots and St Ives all lost internal-diagram.svg (St Ives also
  // internal-schematic.svg) across a rollout --all --apply.
  if (routesJson.internalSchematic) { copyFile(path.join(SK, 'schematize_internal.js'), s4Dir); const r2 = runNode(path.join(s4Dir, 'schematize_internal.js'), s4Dir, { SKILL_ASSETS: SK }); realSaid.push({ source: 'schematic', stderr: r2.stderr, ok: r2.ok }); if (r2.ok && fs.existsSync(path.join(s4Dir, 'internal-schematic.svg'))) realOutputs.push('internal-schematic.svg'); }
  if (routesJson.internalDiagram) { copyFile(path.join(SK, 'diagram_internal.js'), s4Dir); const r3 = runNode(path.join(s4Dir, 'diagram_internal.js'), s4Dir, { SKILL_ASSETS: SK }); realSaid.push({ source: 'diagram', stderr: r3.stderr, ok: r3.ok }); if (r3.ok && fs.existsSync(path.join(s4Dir, 'internal-diagram.svg'))) realOutputs.push('internal-diagram.svg'); }
  // The log goes in the run folder BESIDE the artwork it describes, and is committed
  // as an output — so "what did the engine say when it drew this?" is answerable
  // later, from the tree, without rebuilding. Written even when empty (build_log.js).
  const realWarnings = BUILDLOG.collect(realSaid);
  const realBlockers = BUILDLOG.blocking(realWarnings);
  BUILDLOG.write(s4Dir, realWarnings);
  realOutputs.push(BUILDLOG.LOG_NAME);
  stage(t.dir, 'commit', 'S4', s4Dir, '--outputs', realOutputs.join(','), '--note', NOTE);
  fs.rmSync(scratch, { recursive: true, force: true });

  // Two gates now stand between a committed S4 and a published S5, and they stop for
  // the same reason: something changed that a reader of the sheet cannot see. A LOST
  // LABEL is a fact that left the artwork; a BLOCKING warning is a fact that never
  // reached it. Both are recoverable — S4 is committed and inert until pulled — and
  // both clear with --force once a human has read what happened.
  if (realBlockers.length && !FORCE) {
    return { name: t.name, status: 'REVIEW-NEEDED', diffs, s4Dir, warnings: realWarnings, blockers: realBlockers,
      detail: 'S4 committed but NOT rendered/published — ' + realBlockers.length + ' blocking build warning'
        + (realBlockers.length > 1 ? 's' : '') + ' (the engine refused to draw something, or a label names nothing). Read '
        + path.join(s4Dir, BUILDLOG.LOG_NAME) + ', fix the config it names, then re-run (or --force to publish anyway).' };
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

  return { name: t.name, status: 'DONE', diffs, anyLost, warnings: realWarnings, blockers: realBlockers, s4Dir, s5Dir, version: BUMP, sheetStamp };
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
      // Re-wraps are NOT lost labels and do not stop the rollout, but they are
      // printed: a check that silently forgives is the next --force habit starting.
      if (d.rewrapped && d.rewrapped.length) console.log(`    RE-WRAPPED in ${file}: ` + d.rewrapped.map(r => `${r.label} -> ${r.as.join(' + ')}`).join(' | '));
      if (d.gained.length) console.log(`    GAINED in ${file}: ${d.gained.join(' | ')}`);
    }
  }
  // Blocking warnings always print in full; the rest print as a count, with the
  // detail in the run folder's build-warnings.txt (or under --warnings here).
  for (const w of (r.blockers || [])) console.log(`    BLOCKING [${w.source}] ${w.text}`);
  const soft = (r.warnings || []).filter(w => w.severity === 'WARN');
  if (soft.length && args.warnings) for (const w of soft) console.log(`    warn [${w.source}] ${w.text}`);
  else if (soft.length) console.log(`    ${soft.length} non-blocking warning${soft.length > 1 ? 's' : ''} (pass --warnings to see them)`);
}

console.log('\nSummary: ' + results.map(r => `${r.name}=${r.status}`).join(', '));
// OA-179. STAMP-STALE is easy to skim past in a per-town line, and it is the one
// verdict that names a command the operator has to type. It repeats here.
const stampStale = results.filter(r => r.status === 'STAMP-STALE');
if (stampStale.length) console.log(
  `${stampStale.length} town(s) draw the CURRENT sheets from an OLD engine stamp — status.js gates these as ENGINE STALE, `
  + `and this tool will not clear them without --force:\n  `
  + stampStale.map(r => `node rollout.js --town "${r.name}" --apply --force`).join('\n  '));
const totalBlockers = results.reduce((n, r) => n + ((r.blockers || []).length), 0);
if (totalBlockers) console.log(`${totalBlockers} BLOCKING build warning(s) across ${results.filter(r => (r.blockers || []).length).length} town(s) — the engine refused to draw something, or a label names nothing.`);
// UNRENDERED moves the exit code. The state it names was invisible precisely
// because nothing failed, so a verdict that only printed would be the same
// silence with a longer summary line.
const bad = results.some(r => ['FAIL', 'ERROR', 'REVIEW-NEEDED', 'UNRENDERED'].includes(r.status)) || (!APPLY && totalBlockers > 0);
process.exit(bad ? 1 : 0);
