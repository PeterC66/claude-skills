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
const { parseArgs, resolveBuses } = require('./cli');
const { spawnSync } = require('child_process');
const { SK, gate, labelDiff, PLACE_IGNORE, findTowns, findPlaces, readJson, latestRunDir, unrenderedS4, staleInputs } = require('./gate_lib');
const BUILDLOG = require('./build_log');
// The self-crossing check (buses-data OA-240). One place map has a schematic --
// High Wycombe Aldi -- and the town rollout's copy of this wiring would have
// certified only towns. Both tools call the one helper; `rollout_crossings.test.js`
// is the check on that. Non-blocking by construction, and outside the hash closure.
const { crossingWarnings } = require('./schematic_crossings');
// The printed sheet version (footer.js design.sheetVersion) and the engine hash.
// BOTH now come from shared modules rather than living here, because living here
// is how a hand-built S4 lost them both (OA-161) — see sheet_stamps.js.
const { stampSheetVersion } = require('./sheet_stamps');
// The PLACE template, not the town one (OA-168, 2026-08-30). Until then every
// place map carried the town hash, so a change to gen_external_places.js left
// all 12 of them reading `current` across a round that moved ink on nine.
const { computePlaceEngineVersion, stampEngine } = require('./engine_version');
// One value for the whole run, computed once, exactly as status.js does (OA-179).
const CURRENT_PLACE_ENGINE = computePlaceEngineVersion();

const PSK = path.join(SK, '..', '..', 'make-place-bus-leaflet', 'assets');

const args = parseArgs(process.argv.slice(2), { repeat: ['place'] });
const BUSES = resolveBuses(args);
const APPLY = !!args.apply;
// ONE seeding rule for both halves of this file — see seed_prev_s4.js (OA-013).
const { seedPrevS4 } = require('./seed_prev_s4');
const { scratchDir } = require('./scratch');
const FORCE = !!args.force;
const BUMP = args.bump === 'major' ? 'major' : 'minor';
const NOTE = args.note || 'rollout: adopt current engine template (auto)';
// --keep <dir>: dry run only. Copy each place's built sheets out before the scratch
// workspace is deleted, so they can be measured and rendered rather than judged from
// the label-set diff alone. Ignored with --apply (the sheets go to S4 anyway).
const KEEP = typeof args.keep === 'string' ? args.keep : null;
// --refresh-index [--asof YYYY-MM-DD]: ALSO re-run the boarding plan's two DATA
// scripts, not just its generator. Off by default, and the default is the honest
// one — a rollout is "same data, new engine", and re-deriving the index from a feed
// that has moved would smuggle a data refresh into a change nobody asked for one in.
//
// WITHOUT IT, A CHANGE TO boarding_index.py OR naptan_stands.py CANNOT REACH A SHEET
// AT ALL. `boarding_index.json` and `stands.json` live only in the S4 run, and
// seedPrevS4 copies them forward from the previous one, so every rollout since the
// files were first written has re-run gen_boarding.js against an index built by
// whatever generator happened to be current that day. Measured 2026-08-30: three of
// the four boarding sheets carried an index written by boarding_index.py v1.2 while
// the engine was on v1.3, and 27 destinations across them had trip counts the current
// generator computes differently. Nothing was red, because nothing was looking.
//
// `--asof` is passed straight to boarding_index.py and matters more than it looks:
// counting "today" makes the index a fact about the build date rather than about the
// registration the sheet will live on. Omit it and the tool refuses rather than
// guessing, because a silently-dated index is the failure this flag exists to end.
const REFRESH_INDEX = !!args['refresh-index'];
const ASOF = typeof args.asof === 'string' ? args.asof : null;
if (REFRESH_INDEX && !ASOF) {
  console.error('rollout_places: --refresh-index needs --asof YYYY-MM-DD.');
  console.error('  The index counts journeys in the registrations running on one date, and');
  console.error('  "today" makes the sheet a fact about the build rather than about the feed.');
  process.exit(2);
}

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
const NAPTAN_STANDS = path.join(SK, 'naptan_stands.py');
const BOARDING_INDEX = path.join(SK, 'boarding_index.py');
// The region comes off the index the previous run already wrote, not off a flag and
// not off a default: `boarding_index.json.region` is the only place the pairing of
// THIS place with THAT database is recorded, and every other entry point in the system
// lost its privileged default region on 2026-08-21.
// The last two non-empty lines of a failed run: naptan_stands.py's verdict and its
// reason both land at the end of stdout, and a bare exit code says neither.
const tailOf = (r) => ((r.stdout || '') + (r.stderr || ''))
  .split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean).slice(-2).join(' / ');
function refreshBoardingData(dir) {
  const idx = readJson(path.join(dir, 'boarding_index.json')) || {};
  const region = idx.region;
  if (!region) return { ok: false, stderr: 'boarding_index.json names no region — cannot choose a GTFS database' };
  const db = path.join(BUSES, '_gtfs', region);
  const naptan = path.join(BUSES, '_gtfs', 'naptan.sqlite');
  for (const f of [db, naptan]) {
    if (!fs.existsSync(f)) return { ok: false, stderr: 'missing ' + f };
  }
  // `python3`, not `python` — the conventions page's rule, and this was the one
  // spawn in the engine still saying `python` (OA-232 Tier 2.5). Both resolve on
  // this laptop; only `python3` resolves on a CI runner, and `python` is Python 2
  // on some machines.
  const py = (script, extra) => spawnSync('python3',
    [script, '--dir', dir, '--naptan', naptan, ...extra, '--write'], { encoding: 'utf8' });
  // stands FIRST: boarding_index.py reads stands.json.
  const rs = py(NAPTAN_STANDS, []);
  if (rs.status !== 0) return { ok: false, stderr: 'naptan_stands.py: ' + tailOf(rs) };
  const ri = py(BOARDING_INDEX, ['--db', db, '--asof', ASOF]);
  if (ri.status !== 0) return { ok: false, stderr: 'boarding_index.py: ' + tailOf(ri) };
  return { ok: true, stderr: '' };
}
function buildBoarding(dir) {
  if (REFRESH_INDEX) {
    const r = refreshBoardingData(dir);
    if (!r.ok) return { ok: false, stdout: '', stderr: 'refresh-index failed — ' + r.stderr };
  }
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
  //
  // ...AND THE GATE CANNOT SEE A DATA-SCRIPT CHANGE, WHICH IS WHY --refresh-index
  // BYPASSES IT. `gate()` re-runs gen_boarding.js against the S4's STORED
  // boarding_index.json, so a sheet whose index is stale by two generator versions
  // reproduces byte-for-byte and reports PASS. That is the correct answer to the
  // question the gate asks ("does the current generator redraw this sheet?") and the
  // wrong answer to the one a --refresh-index run is asking ("does the current
  // generator, fed a freshly derived index, still draw this sheet?"). All four
  // boarding places reported UP-TO-DATE on 2026-08-30 while three of them held an
  // index a version behind — the fast path skipped the build that would have shown it.
  const boardingGate = !wantsBoarding ? { status: 'SKIP' }
    : REFRESH_INDEX ? { status: 'REFRESH' }
    : !fs.existsSync(path.join(prevS4.dir, 'boarding.svg')) ? { status: 'MISSING' }
    : gate(GEN_BOARDING, prevS4.dir, 'boarding.svg', path.join(prevS4.dir, 'boarding.svg'));
  const ok = (g) => g.status === 'PASS' || g.status === 'SKIP';
  const shipped = [hadInternal && 'internal', hadExternal && 'external', wantsBoarding && 'boarding'].filter(Boolean);
  // The built S4's routes.json is read again further down as `_s4rj`, for the
  // stale-S3 refusal. The stamp question is asked BEFORE any of that, so it is
  // read here and reused there rather than opened twice.
  const _s4rjEarly = readJson(path.join(prevS4.dir, 'routes.json')) || {};
  /* AND THE STAMP (OA-179) — see the long note in rollout.js's rolloutOne().
   * Identical shape, identical reasoning, different template: a place is
   * measured against computePlaceEngineVersion(), because a place gets its own
   * template (OA-168) and comparing one against the town hash was a real bug.
   * Reports only; writes nothing; does not move the exit code.
   */
  /* THE DATA MAY HAVE MOVED, AND THEN THIS IS NOT AN ENGINE ROLLOUT AT ALL (OA-225).
   * The town side is where it was hit — High Wycombe, 2026-09-01, route 20 in the panel
   * and no line on the map — and this tool seeds its scratch build from the previous S4
   * in exactly the same way (seedPrevS4 below), so it produces exactly the same state.
   * Fixing one and not the other is how a guard covers a class once rather than
   * completely, which is the lesson the block directly beneath this one already carries.
   * See staleInputs() in gate_lib.js, and the paragraph in rollout.js. */
  const moved = staleInputs(manifest);
  if (moved.length && !FORCE) {
    return { name: p.name, status: 'STALE-INPUTS',
             detail: moved.map(x => `${x.stage} has moved to ${x.now}`
                        + (x.was ? ` (this S4 was built on ${x.was})` : ' since this S4 was built')).join('; ')
                   + ` — so this is a DATA change, not an engine-only re-render, and the geometry `
                   + `this would roll forward is the previous build's. Rebuild it through the documented `
                   + `stage order (pull S2, then pull S3). To roll the OLD geometry forward anyway:  `
                   + `node rollout_places.js --place "${p.name}" --apply --force` };
  }

  /* AN UNRENDERED S4 IS NOT UP TO DATE, WHATEVER THE GATES SAY (OA-198). This sits
   * in FRONT of both fast-path returns, and in front of the stamp check too: a
   * place whose S4 was committed and never rendered gates PASS on every sheet by
   * construction, so both of those verdicts are reachable and both of them are
   * wrong. See unrenderedS4() in gate_lib.js for how the state is produced -- it is
   * this tool's own blocking-warning stop, twenty lines below the S4 commit. */
  /* AND IT HAS TO YIELD TO --force, OR ITS OWN REMEDY IS A NO-OP (2026-09-01) —
   * the same fault, fixed in the same change as rollout.js's, because this guard
   * and that one are one guard written twice and fixing either alone is how a
   * remedy covers a class once rather than completely. The town side is where it
   * was hit; see the paragraph there. */
  const unrendered = unrenderedS4(manifest);
  if (unrendered && !FORCE) {
    return { name: p.name, status: 'UNRENDERED',
             detail: `S4 v${unrendered} is committed and NO S5 run has rendered it, so every byte gate passes against a `
                   + `version that has no JPG on disk. Finish it with:  `
                   + `node rollout_places.js --place "${p.name}" --apply --force` };
  }

  const stampedEngine = _s4rjEarly.engine;
  if (ok(internalGate) && ok(externalGate) && ok(boardingGate) && !FORCE
      && stampedEngine && stampedEngine !== '(none)' && stampedEngine !== CURRENT_PLACE_ENGINE) {
    return { name: p.name, status: 'STAMP-STALE',
             detail: `every sheet gates PASS, but routes.json says engine ${stampedEngine} and the current PLACE template `
                   + `is ${CURRENT_PLACE_ENGINE} — status.js gates that as ENGINE STALE. Rebuild and re-stamp with:  `
                   + `node rollout_places.js --place "${p.name}" --apply --force` };
  }
  if (ok(internalGate) && ok(externalGate) && ok(boardingGate) && !FORCE) {
    return { name: p.name, status: 'UP-TO-DATE',
             detail: shipped.join('+') + ' already gate PASS against the current template, and the engine stamp is current' };
  }

  // ---- build in a scratch workspace first (this is also the entire dry-run) ----
  // Mirrors rollout.js: no new S1/S2/S3 needed, only a new S4. Copy routes.json
  // + overrides.json (+ diagram-overrides.json, if this place ever configures
  // internalDiagram) from the previous S3, and every other *.json from the
  // previous S4 (place.json, atco2ll.json, roads_geo.json, routes_paths.json,
  // destinations, etc — all S1/S2-derived and unchanged by an engine rollout).
  const scratch = scratchDir('rollout-place-');
  fs.mkdirSync(path.join(scratch, 'S4'));
  const s3Carry = ['routes.json', 'overrides.json', 'diagram-overrides.json'];
  for (const name of s3Carry) copyFile(path.join(prevS3.dir, name), path.join(scratch, 'S4'));
  seedPrevS4(path.join(scratch, 'S4'), prevS4.dir, s3Carry);
  // REFUSE TO SEED FROM AN S3 THE BUILT S4 DISAGREES WITH. The comment on
  // buildInternal() says routes.json's internalRoads block arrives "already stamped
  // with fitExtra etc from the original build" — true of the S4 copy, and NOT true of
  // the S3 this tool actually seeds from. `build_internal_place_roads.js` injects
  // `internalRoads.fitExtra` (every drawn stop, so a cross-locality walkshed frames the
  // whole close-up) and `fitMargin` at BUILD time, writing them into the run folder
  // only. Three places — St Neots Co-op and both Godmanchester Co-ops — had them in S4
  // and not in S3 on 2026-08-24, so the opt-in rebase was one --force away from
  // re-fitting each map to one locality's stops: no error, no lost sheet, just a
  // different composition and a handful of swapped road labels in the label diff.
  // Three blocks are checked, and they are exactly the ones a build stage writes BACK
  // into a run's routes.json: `internalRoads` (build_internal_place_roads.js's fit fix
  // and derive_termini.js's exits), `frequency` and `design.frequencyTiers`
  // (derive_frequency.js). Nothing else is compared — `design.sheetVersion` and `engine`
  // are stamped per run and MUST differ, which is why this is a named list and not a
  // whole-object diff.
  // The fix when this fires is to lift the value out of the built S4 into the S3
  // (`adopt_config.js --place ... --set-file`), never to let the rollout proceed.
  const _s3ir = (routesJson.internalRoads && typeof routesJson.internalRoads === 'object') ? routesJson.internalRoads : {};
  const _s4rj = _s4rjEarly;
  const _s4ir = (_s4rj.internalRoads && typeof _s4rj.internalRoads === 'object') ? _s4rj.internalRoads : {};
  const _onlyInS4 = Object.keys(_s4ir).filter(k => !(k in _s3ir)).map(k => 'internalRoads.' + k);
  if (_s4rj.frequency && !routesJson.frequency) _onlyInS4.push('frequency');
  if (_s4rj.design && _s4rj.design.frequencyTiers && !(routesJson.design && routesJson.design.frequencyTiers))
    _onlyInS4.push('design.frequencyTiers');
  if (_onlyInS4.length) {
    fs.rmSync(scratch, { recursive: true, force: true });
    return { name: p.name, status: 'STALE-S3',
      detail: 'the built S4 holds ' + _onlyInS4.join(', ')
            + ' and the S3 this would seed from does not — copy it into the S3 first (adopt_config --set-file), do not roll out over it' };
  }

  const engineHash = CURRENT_PLACE_ENGINE;
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
    said.push({ source: 'internal', stderr: genOk.stderr, ok: genOk.ok });
  }
  if (hasExternalGen) {
    copyFile(GEN_EXTERNAL_PLACES, s4);
    genOk = runNode(path.join(s4, 'gen_external_places.js'), s4);
    said.push({ source: 'external', stderr: genOk.stderr, ok: genOk.ok });
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
    said.push({ source: 'schematic', stderr: r.stderr, ok: r.ok });
    said.push({ source: 'crossings', stderr: crossingWarnings(s4).join('\n'), ok: true });
    if (r.ok && fs.existsSync(path.join(s4, 'internal-schematic.svg'))) outputs.push('internal-schematic.svg');
  }
  if (routesJson.boardingPlan) {
    const r = buildBoarding(s4);
    said.push({ source: 'boarding', stderr: r.stderr, ok: r.ok });
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
    said.push({ source: 'diagram', stderr: r.stderr, ok: r.ok });
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

  // A lost label stops the rollout BEFORE anything is written.
  //
  // It used to stop after `stage.js commit S4`, and the state that left behind
  // was the dangerous part: a committed S4, a manifest advertising it, byte
  // gates newly PASSING against it, and no S5 render at all -- so the board
  // read healthy while no JPG existed for the version it was naming. Hit on all
  // four boarding places on 2026-08-25. `anyLost` comes from the scratch build
  // above, which is the same build, so nothing is gained by getting here first.
  if (anyLost && !FORCE) {
    fs.rmSync(scratch, { recursive: true, force: true });
    return { name: p.name, status: 'REVIEW-NEEDED', diffs, warnings, blockers,
      detail: 'a label was lost vs the previous build, and NOTHING was written. Re-run with --keep <dir> to inspect the sheets, then --force to publish anyway (or fix the cause and re-run).' };
  }

  // ---- apply for real, via stage.js so the manifest/version-stamp rules are authoritative ----
  /* RECORD WHAT THIS BUILD WAS MADE FROM (OA-225) — see the same block in rollout.js.
   * Neither rollout passed --based-on until this change, so the field the staleness
   * guard wants to read was missing on almost every map it would be asked about. */
  const s2Latest = (manifest.stages && manifest.stages.S2 && manifest.stages.S2.latest) || null;
  const s3Latest = (manifest.stages && manifest.stages.S3 && manifest.stages.S3.latest) || null;
  const basedOn = [s2Latest && `S2=${s2Latest}`, s3Latest && `S3=${s3Latest}`].filter(Boolean).join(';');
  const s4Dir = basedOn
    ? stage(p.dir, 'new', 'S4', '--bump', BUMP, '--based-on', basedOn)
    : stage(p.dir, 'new', 'S4', '--bump', BUMP);
  stage(p.dir, 'pull', 'S1', s4Dir); // place.json is an S1 output (pipeline.md P4 note) — pull it explicitly, not just S2
  stage(p.dir, 'pull', 'S2', s4Dir);
  stage(p.dir, 'pull', 'S3', s4Dir); // also syncs routes.json's printed version stamp to this run's v<N.N>
  // roads_geo.json/routes_paths.json (and anything else build_internal_place_roads.js
  // wrote) are S4-GENERATED, not registered S2 outputs — `stage.js pull S2` never
  // brings them in, so a real (non-scratch) apply run was missing them entirely
  // and crashed reading roads_geo.json (found 2026-08-10 rolling out all 5
  // places: the scratch/dry-run path above already carries these forward from
  // prevS4, this real path didn't).
  //
  // THE SAME CALL AS THE SCRATCH BUILD ABOVE, and until 2026-08-29 it was not
  // (OA-013). This one used to add `&& !fs.existsSync(...)`, so a file present in
  // both a pulled stage and the previous S4 was taken from the STAGE here and from
  // the previous S4 there — the dry run's diff then described a build this path
  // would not make. St Ives Bus Station is the recorded case; seed_prev_s4.js
  // carries the account. `shadowed` names every file where the two disagreed, so
  // the choice is stated rather than silently made.
  const seeded = seedPrevS4(s4Dir, prevS4.dir, s3Carry);
  stampEngine(path.join(s4Dir, 'routes.json'), engineHash);
  const sheetStamp = stampSheetVersion(path.join(s4Dir, 'routes.json'), path.basename(s4Dir));
  if (seeded.shadowed.length) {
    console.log(`  ${p.name}: ${seeded.shadowed.length} file(s) existed in a pulled stage with different content and the previous S4's copy was used — ${seeded.shadowed.join(', ')}. That is the rollout rule (same data, new engine); if one of them SHOULD be refreshed, re-run the stage that owns it and commit before rolling out.`);
  }
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
    realSaid.push({ source: 'internal', stderr: r.stderr, ok: r.ok });
  }
  if (hasExternalGen) {
    copyFile(GEN_EXTERNAL_PLACES, s4Dir);
    r = runNode(path.join(s4Dir, 'gen_external_places.js'), s4Dir);
    realSaid.push({ source: 'external', stderr: r.stderr, ok: r.ok });
    if (!r.ok) { fs.rmSync(scratch, { recursive: true, force: true }); return { name: p.name, status: 'FAIL', detail: 'gen_external_places.js (real S4): ' + r.stderr.split('\n')[0] }; }
    realOutputs.push('external.svg');
  }
  if (routesJson.internalSchematic || routesJson.internalDiagram) copyFile(path.join(PSK, 'gen_internal_place.js'), s4Dir);
  if (routesJson.internalSchematic) {
    copyFile(path.join(SK, 'schematize_internal.js'), s4Dir);
    const r2 = runNode(path.join(s4Dir, 'schematize_internal.js'), s4Dir, { SKILL_ASSETS: SK, OVERRIDES_FILE: path.join(s4Dir, 'overrides.json') });
    realSaid.push({ source: 'schematic', stderr: r2.stderr, ok: r2.ok });
    realSaid.push({ source: 'crossings', stderr: crossingWarnings(s4Dir).join('\n'), ok: true });
    if (r2.ok && fs.existsSync(path.join(s4Dir, 'internal-schematic.svg'))) realOutputs.push('internal-schematic.svg');
  }
  if (routesJson.boardingPlan) {
    const rb = buildBoarding(s4Dir);
    realSaid.push({ source: 'boarding', stderr: rb.stderr, ok: rb.ok });
    if (rb.ok && fs.existsSync(path.join(s4Dir, 'boarding.svg'))) realOutputs.push('boarding.svg');
    else { fs.rmSync(scratch, { recursive: true, force: true }); return { name: p.name, status: 'FAIL', detail: 'gen_boarding.js (real S4): ' + ((rb.stderr || 'no boarding.svg produced').split('\n')[0]) }; }
  }
  if (routesJson.internalDiagram) {
    copyFile(path.join(SK, 'diagram_internal.js'), s4Dir);
    const r3 = runNode(path.join(s4Dir, 'diagram_internal.js'), s4Dir, { SKILL_ASSETS: SK });
    realSaid.push({ source: 'diagram', stderr: r3.stderr, ok: r3.ok });
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
      // Re-wraps are NOT lost labels and do not stop the rollout, but they are
      // printed: a check that silently forgives is the next --force habit starting.
      if (d.rewrapped && d.rewrapped.length) console.log(`    RE-WRAPPED in ${file}: ` + d.rewrapped.map(r => `${r.label} -> ${r.as.join(' + ')}`).join(' | '));
      if (d.gained.length) console.log(`    GAINED in ${file}: ${d.gained.join(' | ')}`);
    }
  }
  for (const w of (r.blockers || [])) console.log(`    BLOCKING [${w.source}] ${w.text}`);
  const soft = (r.warnings || []).filter(w => w.severity === 'WARN');
  if (soft.length && args.warnings) for (const w of soft) console.log(`    warn [${w.source}] ${w.text}`);
  else if (soft.length) console.log(`    ${soft.length} non-blocking warning${soft.length > 1 ? 's' : ''} (pass --warnings to see them)`);
}

console.log('\nSummary: ' + results.map(r => `${r.name}=${r.status}`).join(', '));
// OA-179 — see rollout.js's identical block.
const stampStale = results.filter(r => r.status === 'STAMP-STALE');
if (stampStale.length) console.log(
  `${stampStale.length} place(s) draw the CURRENT sheets from an OLD engine stamp — status.js gates these as ENGINE STALE, `
  + `and this tool will not clear them without --force:\n  `
  + stampStale.map(r => `node rollout_places.js --place "${r.name}" --apply --force`).join('\n  '));
// STALE-INPUTS repeats here for the same reason STAMP-STALE does: it is a verdict
// that names work the operator has to go and do somewhere else, and a per-map line
// scrolls past. It is the one refusal here whose remedy is NOT this tool (OA-225).
const staleIn = results.filter(r => r.status === 'STALE-INPUTS');
if (staleIn.length) console.log(
  `${staleIn.length} map(s) have had their S2/S3 DATA move since the S4 this would roll forward — that is a data `
  + `change, and rolling it forward would put the new config over the old geometry. Rebuild them through `
  + `make-bus-leaflet/references/s4-s5-build-and-render.md:\n  `
  + staleIn.map(r => `  ${r.name}`).join('\n  '));
const totalBlockers = results.reduce((n, r) => n + ((r.blockers || []).length), 0);
if (totalBlockers) console.log(`${totalBlockers} BLOCKING build warning(s) across ${results.filter(r => (r.blockers || []).length).length} place(s) — the engine refused to draw something, or a label names nothing.`);
// UNRENDERED moves the exit code. The state it names was invisible precisely
// because nothing failed, so a verdict that only printed would be the same
// silence with a longer summary line.
const bad = results.some(r => ['FAIL', 'ERROR', 'REVIEW-NEEDED', 'UNRENDERED', 'STALE-INPUTS'].includes(r.status)) || (!APPLY && totalBlockers > 0);
process.exit(bad ? 1 : 0);
