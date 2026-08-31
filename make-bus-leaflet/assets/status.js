#!/usr/bin/env node
/*
 * status.js — reports whether every built town/place/portal-fixture still
 * matches what the CURRENT engine template would draw, and how stale each
 * town's independent (S6) verification is.
 *
 * This replaces the hand-maintained gate table and §4 vendoring table in
 * references/changing-the-engine.md with something that reads the filesystem
 * instead of asserting a date. Run it whenever you open that doc, and always
 * after an engine change, per its own advice.
 *
 * Since 2026-08-16 (Phase 8 item 1 of the label-and-design-quality plan) it also
 * carries a QUALITY row beside each byte-gate row. The byte gate proves the
 * generator is deterministic; it says nothing at all about whether the sheet is
 * any good, which is how six towns once shipped with their legends sitting on
 * top of whole spokes with every number improving. quality_gate.js supplies the
 * verdict; --no-quality skips it if you only want the reproduce gates.
 *
 * Usage:
 *   node status.js [--buses "<Buses dir>"] [--portal "<portal repo dir>"] [--md] [--json] [--no-quality]
 *   ...[--live <base url>] [--no-live]     (deployment drift; see deploymentRow below)
 *
 * Defaults (Peter's machine): --buses "C:\u3a St Ives\Using AI\Buses"
 *                              --portal "C:\Claude\community-bus-maps"
 *
 * Zero dependencies (Node core only).
 */
const fs = require('fs');
const path = require('path');
const { SK, gate, sameIgnoringLineEndings, findTowns, findPlaces, readJson, latestRunDir, detectExternalStyle, PLACE_IGNORE, portalFixtureEnv } = require('./gate_lib');
const { computeEngineVersion, computePlaceEngineVersion } = require('./engine_version');
const quality = require('./quality_gate');

const CURRENT_ENGINE = computeEngineVersion();
// A place map is drawn by two generators the town closure does not reach, so it
// gets its own template (OA-168). Comparing a place against CURRENT_ENGINE was
// a check whose subject it could not see: it went on saying `current` through a
// round that changed gen_external_places.js by 266 lines.
const CURRENT_PLACE_ENGINE = computePlaceEngineVersion();

const PSK = path.join(SK, '..', '..', 'make-place-bus-leaflet', 'assets');

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) f[argv[i].slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
  return f;
}
const args = parseArgs(process.argv.slice(2));
const BUSES = path.resolve(args.buses || 'C:/u3a St Ives/Using AI/Buses');
const PORTAL = path.resolve(args.portal || 'C:/Claude/community-bus-maps');
const AS_MD = !!args.md;
const AS_JSON = !!args.json;
const NO_QUALITY = !!args['no-quality'];
// Deployment drift (technical-audit_2026-08-25 N2). Default ON against the live
// site; --no-live skips it entirely, --live <url> points it somewhere else.
const NO_LIVE = !!args['no-live'];
const LIVE_URL = typeof args.live === 'string' ? args.live.replace(/\/+$/, '') : 'https://busmaps.uk';
// How long a merged-but-undeployed commit is allowed to sit before this goes
// RED rather than amber. A deploy is a deliberate act and a merge at midnight
// should not page anyone at 00:01, but "we merged it and forgot" is exactly the
// state this exists to catch, and twelve hours is long enough that reaching it
// means nobody is coming.
//
// Overridable so the RED branch can be PROVED to fire rather than assumed to:
// `--deploy-grace-hours 0` against a deployment that is behind must exit 1. A
// gate nobody has watched fail is not a gate, and the amber/red split is the
// only part of this row that contains a judgement.
const DEPLOY_GRACE_HOURS = (args['deploy-grace-hours'] !== undefined && args['deploy-grace-hours'] !== true)
  ? Number(args['deploy-grace-hours'])
  : 12;

// COMMITMENTS. The one class of work this board could not see: a thing we said
// we would do, where nothing on disk changes if we never do it. The byte gates
// watch artefacts, the ratchet watches quality, the deployment row watches the
// live site -- all of them ask a question about something that EXISTS. "Did we
// send that letter" has no artefact to interrogate, and open-actions.md files
// such an item without chasing it: a row in a band of seventy is a filing
// system, not a reminder. The backlog literally carries a row beginning
// "Diary CROSS_REPO_PAT2's expiry" -- written as an instruction, into a
// document that diarises nothing. This is the diary.
//
// Only OVERDUE is folded into `bad`. The amber window prints and stays green,
// for the same reason the deploy grace exists: a board that goes red a month
// early is one that gets ignored by the time it matters.
//
// --commitments-today <ISO> overrides today so the OVERDUE branch can be PROVED
// to fire instead of being waited for; --no-commitments skips the section.
const NO_COMMITMENTS = !!args['no-commitments'];
const COMMITMENTS_TODAY = (typeof args['commitments-today'] === 'string') ? args['commitments-today'] : null;

function exists(p) { return fs.existsSync(p); }

function daysSince(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

// ---- was this sheet ever part of the build? --------------------------------
// gate() reports NO-SHEET when there is nothing committed to reproduce. Whether
// that is fine depends on something gate() cannot see: what the build SAID it
// produced. The S4 manifest record lists its own outputs, so:
//
//   declared and present   -> PASS / DIFF as before
//   NOT declared, absent   -> '-'      the sheet was never part of this map
//   declared, absent       -> 'MISSING' the manifest advertises a sheet that is
//                                       not there — alarming, and it fails the board
//
// The third case is not hypothetical. `stage.js commit` took --outputs on trust
// until 2026-08-28 (OA-106), so a manifest could advertise a version with no map
// in it, and two of them were created that way on 2026-08-21 and 2026-08-23.
// commit now refuses that, which closes the way of CREATING one -- it does not
// retire this branch, because a run folder can also be lost AFTER a good commit
// and prune_runs.py does exactly that by design. Reading the declaration
// is what stops "never built" and "lost since" collapsing into one benign dash —
// which is the trap the 2026-08-18 vendoring change had to undo for MISSING files.
// ASK BEFORE RUNNING, not after. gate() only ever reports NO-SHEET when the
// generator SUCCEEDED and found nothing committed to compare against. A map that
// never had this sheet has none of the generator's inputs either, so the run
// errors and the honest answer "this map has no internal sheet" comes back as
// FAIL. High Wycombe Town Centre -- a place carrying a boarding plan and nothing
// else -- is the first of those, and it reddened the whole board.
function declares(rec, basename) {
  return !!(rec && Array.isArray(rec.outputs) && rec.outputs.includes(basename));
}

function judgeNoSheet(rec, basename) {
  const declared = !!(rec && Array.isArray(rec.outputs) && rec.outputs.includes(basename));
  return declared ? 'MISSING' : '-';
}

// ---- gate a single town -----------------------------------------------------
function gateTown(t) {
  const m = readJson(path.join(t.dir, 'manifest.json'));
  const s4 = latestRunDir(m, t.dir, 'S4');
  const row = { name: t.name, version: s4 ? s4.rec.version : null };
  if (!s4) { row.internal = 'NO-BUILD'; row.external = '-'; return row; }

  // Cheap fast-path (item 3, 2026-08-04): a town whose stamped "engine" hash
  // already matches the live template's hash cannot need a rollout — the full
  // regenerate-and-diff below still runs (it's the thing that actually proves
  // PASS), but this is what lets a human skim "who's behind" without reading
  // the PASS/DIFF columns town by town.
  let routesJsonEarly = {};
  try { routesJsonEarly = readJson(path.join(s4.dir, 'routes.json')); } catch (e) {}
  row.engine = routesJsonEarly.engine || '(none)';
  row.engineCurrent = routesJsonEarly.engine === CURRENT_ENGINE;

  // Same judgement as the place row below: no town is without an internal map today,
  // so this is inert -- and leaving the known second instance of a fixed fault in
  // place is how it comes back.
  const tInt = declares(s4.rec, 'internal.svg') || exists(path.join(s4.dir, 'internal.svg'))
    ? gate(path.join(SK, 'gen_internal.js'), s4.dir, 'internal.svg', path.join(s4.dir, 'internal.svg')).status
    : 'NO-SHEET';
  row.internal = tInt === 'NO-SHEET' ? judgeNoSheet(s4.rec, 'internal.svg') : tInt;

  const style = detectExternalStyle(s4.dir);
  row.externalStyle = style;
  const extGate = gate(path.join(SK, `gen_external_${style}.js`), s4.dir, 'external.svg', path.join(s4.dir, 'external.svg')).status;
  row.external = extGate === 'NO-SHEET' ? judgeNoSheet(s4.rec, 'external.svg') : extGate;

  // Optional pre-stage outputs, only gated if routes.json opted in.
  //
  // The `routesJson.<key> &&` guard is the honest half: a map that never asked
  // for a schematic has none of the pre-stage's inputs, so running it would
  // error and print FAIL for a sheet that was correctly never built.
  //
  // The `&& exists(...)` that used to sit beside it was NOT honest, and it was
  // the same trap judgeNoSheet exists for on the three sheets above (found
  // 2026-08-27, OA-129 Phase 0). It collapsed two different facts into one
  // benign dash: "this map has no schematic" and "this map's config asks for a
  // schematic and the file is GONE". The second is what a botched regenerate
  // looks like, and the board printed '-' for it. Since OA-106 `stage.js commit`
  // refuses to record an output that is not there, so a manifest can no longer be
  // BORN advertising a sheet nobody wrote -- but it can still come to advertise
  // one, because a pruned or hand-deleted run folder leaves the record behind.
  //
  // Both derived sheets now read the same way as internal/external/boarding:
  // gate() reports the fact, judgeNoSheet asks the S4 manifest record whether
  // the build claimed to produce it. Proven able to fire by tools/prove-red-gates.js.
  let routesJson = {};
  try { routesJson = readJson(path.join(s4.dir, 'routes.json')); } catch (e) {}
  if (routesJson.internalSchematic) {
    // Same as the place row below. INERT TODAY — no town carries an overrides.json,
    // measured 2026-08-29 — and that is exactly why it goes in now: the first town
    // to force a POI would otherwise reproduce the place fault, and leaving the
    // known second instance of a fixed fault in place is how it comes back.
    const g = gate(path.join(SK, 'schematize_internal.js'), s4.dir, 'internal-schematic.svg', path.join(s4.dir, 'internal-schematic.svg'), { overridesFromWorkspace: true }).status;
    row.schematic = g === 'NO-SHEET' ? judgeNoSheet(s4.rec, 'internal-schematic.svg') : g;
  } else row.schematic = '-';
  if (routesJson.internalDiagram) {
    const g = gate(path.join(SK, 'diagram_internal.js'), s4.dir, 'internal-diagram.svg', path.join(s4.dir, 'internal-diagram.svg')).status;
    row.diagram = g === 'NO-SHEET' ? judgeNoSheet(s4.rec, 'internal-diagram.svg') : g;
  } else row.diagram = '-';

  // S6 staleness: flag if S1/S2/S3 has moved on since the latest S6 run.
  const s6 = latestRunDir(m, t.dir, 'S6');
  const latestData = ['S1', 'S2', 'S3'].map(k => m.stages[k] && m.stages[k].runs.find(r => r.id === m.stages[k].latest)).filter(Boolean);
  const newestDataAt = latestData.reduce((acc, r) => (!acc || r.at > acc ? r.at : acc), null);
  if (!s6) { row.s6 = 'NEVER'; row.s6Age = null; }
  else {
    row.s6 = s6.rec.id;
    row.s6Age = daysSince(s6.rec.at);
    row.s6Stale = newestDataAt && s6.rec.at < newestDataAt;
  }
  return row;
}

// ---- gate a single place ----------------------------------------------------
// PLACE_IGNORE (title + "· Map v…" stamp, post-edited by build_internal_place.js) now lives in gate_lib.js, shared with rollout_places.js.
// ---- place-completeness keys: REPORTED, never gated (OA-057) ---------------
//
// `derive_frequency.js` and `derive_termini.js` both exist, both work, and both
// are written into the place skill's P3 procedure with their exact commands.
// Running them is REMEMBERED rather than required, and a key nobody writes is
// indistinguishable from a feature nobody built — which is how the count in the
// backlog row itself went stale between one week and the next. This column is
// the enforcement half: it makes the answer readable on demand instead of by
// hand, so the number cannot drift again unnoticed.
//
// FOUR KEYS, and each one is a visible thing on the sheet rather than a tidiness
// score. `frequency` + `design.frequencyTiers` are what draw a busy route heavier
// than a two-buses-a-day one; without both, every service prints at the same
// 1.7 mm weight. `internalRoads.termini` is what puts a destination name on a
// frame-exit arrow; without it the arrow is bare. `panelGroups` orders the
// Services panel.
//
// IT IS DELIBERATELY NOT IN `bad`, AND THAT IS THE WHOLE DESIGN. Seven of the ten
// places that draw an internal sheet are short today, so gating on it would put
// seven permanent reds on a board a real failure has to be spotted through — the
// same rule that keeps the quality TARGETS reported rather than gated, and the
// same rule that decided which of the three ink-on-ink measures got folded into
// `hard`. Filling them in is a VISIBLE change to seven live maps and therefore
// Peter's call, not a config sweep to run unannounced; the recommendation in
// OA-057 is to carry it with OA-019's other changes in one rebuild round. When
// that round has run, this becomes one line in `bad` — and the day it does,
// falsify it, because a column that has never been red is not yet a gate.
//
// READ FROM THE S4 routes.json, not from the latest S3, though the row proposed
// S3. They are normally the same file — S4 builds from the config S3 committed —
// but where they differ, S4 is what the SHIPPED sheet was actually drawn from,
// and every other column on this board is a statement about what shipped.
const PLACE_KEYS = [
  { id: 'freq', has: j => !!j.frequency },
  { id: 'tiers', has: j => !!(j.design && j.design.frequencyTiers) },
  { id: 'termini', has: j => !!(j.internalRoads && j.internalRoads.termini) },
  { id: 'panelGroups', has: j => !!j.panelGroups },
];
function placeKeys(routesJson, row) {
  // A place with no internal sheet cannot use any of them. 'n/a' rather than
  // '4 missing' is the same distinction the byte-gate columns draw between
  // MISSING and '-': a sheet the build never claimed to make cannot be short of
  // the keys that decorate it.
  if (row.internal === '-' || row.internal === 'NO-BUILD') return { state: 'n/a', missing: [] };
  const missing = PLACE_KEYS.filter(k => !k.has(routesJson)).map(k => k.id);
  return { state: missing.length ? 'short' : 'complete', missing };
}

function gatePlace(p) {
  const m = readJson(path.join(p.dir, 'manifest.json'));
  const s4 = latestRunDir(m, p.dir, 'S4');
  const row = { name: p.name, town: p.town || '(standalone)', version: s4 ? s4.rec.version : null };
  // S6 for a place, on the same terms as a town (OA-140). Computed before the
  // NO-BUILD return so an unbuilt place still reports whether it was verified.
  const ps6 = latestRunDir(m, p.dir, 'S6');
  const pData = ['S1', 'S2', 'S3'].map(k => m.stages[k] && m.stages[k].runs.find(r => r.id === m.stages[k].latest)).filter(Boolean);
  const pNewest = pData.reduce((acc, r) => (!acc || r.at > acc ? r.at : acc), null);
  if (!ps6) { row.s6 = 'NEVER'; row.s6Age = null; }
  else { row.s6 = ps6.rec.id; row.s6Age = daysSince(ps6.rec.at); row.s6Stale = pNewest && ps6.rec.at < pNewest; }
  if (!s4) { row.internal = 'NO-BUILD'; row.external = '-'; row.boarding = '-'; row.schematic = '-'; row.diagram = '-'; return row; }

  // The engine hash, on the same terms as a town (OA-161). The places table had
  // no Engine column where the towns table has had one since the hash existed,
  // so a place built from stale code -- or, as St Neots Town Centre v2.13 was,
  // from a hand-assembled S4 carrying no hash AT ALL -- did not show on the board
  // in any form. `stage.js commit S4` now refuses the second case outright; this
  // is what makes the first one visible. Reported, not gated, exactly as the town
  // column was until OA-151, and for the same reason: the place estate has never
  // been measured for staleness and a gate that goes red on day one gets muted.
  let placeRoutes = {};
  try { placeRoutes = readJson(path.join(s4.dir, 'routes.json')); } catch (e) {}
  row.engine = placeRoutes.engine || '(none)';
  row.engineCurrent = placeRoutes.engine === CURRENT_PLACE_ENGINE;
  // The NO-SHEET judgement was applied to `external` in August 2026 and not to
  // `internal`, because at the time every place had an internal map. High Wycombe
  // Town Centre (2026-08-23) is the first that does not -- it carries a boarding
  // plan and nothing else -- and it read FAIL, which is the same "absent is not
  // different" fault the external half already fixed. Its S4 record does not
  // declare internal.svg, so this reports '-'; a manifest that DID declare one
  // still gets MISSING.
  const pInt = declares(s4.rec, 'internal.svg') || exists(path.join(s4.dir, 'internal.svg'))
    ? gate(path.join(SK, 'gen_internal.js'), s4.dir, 'internal.svg', path.join(s4.dir, 'internal.svg'), { ignoreLineRe: PLACE_IGNORE }).status
    : 'NO-SHEET';
  row.internal = pInt === 'NO-SHEET' ? judgeNoSheet(s4.rec, 'internal.svg') : pInt;
  const genExt = path.join(PSK, 'gen_external_places.js');
  const pExt = exists(genExt)
    ? gate(genExt, s4.dir, 'external.svg', path.join(s4.dir, 'external.svg')).status
    : 'no-gen';
  row.external = pExt === 'NO-SHEET' ? judgeNoSheet(s4.rec, 'external.svg') : pExt;
  // The boarding sheet joins the board on 2026-08-24, and it starts GREEN because the
  // last arrears were cleared first: both High Wycombe sheets went to v1.2 and the two
  // LIVE ones -- St Ives Bus Station v1.4, St Neots Town Centre v2.5 -- were re-rendered
  // the same day. Adding it before that would have put four permanent reds on a board a
  // real failure has to be spotted through ([[feedback_a_new_gate_must_start_green]]).
  //
  // Gated on `routes.json.boardingPlan`, the same key gen_boarding.js and
  // rollout_places.js read, so a place without one shows '-' rather than a verdict about
  // a sheet it never had. The hand procedure this replaces is changing-the-engine.md §3a.
  let routesJson = {};
  try { routesJson = readJson(path.join(s4.dir, 'routes.json')); } catch (e) {}
  if (!routesJson.boardingPlan) row.boarding = '-';
  else {
    const pBrd = declares(s4.rec, 'boarding.svg') || exists(path.join(s4.dir, 'boarding.svg'))
      ? gate(path.join(SK, 'gen_boarding.js'), s4.dir, 'boarding.svg', path.join(s4.dir, 'boarding.svg')).status
      : 'NO-SHEET';
    row.boarding = pBrd === 'NO-SHEET' ? judgeNoSheet(s4.rec, 'boarding.svg') : pBrd;
  }
  // The DERIVED SHEETS, on the same opt-in terms as a town (OA-170). A place got
  // three sheet columns and a town four, because when gatePlace was written no
  // place had a schematic. High Wycombe Aldi has had one since; it is committed to
  // ci-reference, which makes it a tracked golden master, and nothing on this board
  // ever opened it.
  //
  // IT HAD DRIFTED, AND NOT COSMETICALLY. OA-019's round three rebuilt it and the
  // committed copy carried the TOWN's title -- `Buses within High Wycombe` on a
  // place sheet, one of three places published on busmaps.uk -- and was missing the
  // forced `Tannery Road Ind Est` POI label that rollout_places.js's own header
  // names as the reason that tool exists. Both were corrected as a SIDE EFFECT of a
  // round about something else, which is not a mechanism. This is the mechanism.
  //
  // Keyed off `routes.json.internalSchematic` exactly as the town is, so a place
  // that never asked for a schematic shows '-' rather than a verdict about a sheet
  // it never had, and any place that grows one later arrives already covered.
  // PLACE_IGNORE applies for the same reason it does on internal.svg: the title and
  // the "· Map v…" stamp are post-edited by build_internal_place.js.
  //
  // ADDED GREEN, and that was checked before it was added -- Aldi's schematic
  // reproduces byte-for-byte as of buses-data 877e668. A gate that is red on the
  // day it lands gets muted in its first week ([[feedback_a_new_gate_must_start_green]]).
  //
  // internalDiagram is here for symmetry and is inert today: no place opts in. That
  // is deliberate -- leaving the known second instance of a fixed fault out is how
  // it comes back, which is the argument the internal column above already carries.
  if (routesJson.internalSchematic) {
    // `overridesFromWorkspace` is what makes this green rather than red, and the
    // reason is worth the line: the schematiser's nested workspace drops
    // overrides.json, so rollout_places.js passes OVERRIDES_FILE explicitly when it
    // BUILDS the sheet. A gate that regenerates by a different procedure from the
    // build is measuring two things at once and calling the difference drift.
    // NOT set on the diagram below, exactly as rollout_places.js does not set it
    // there — diagram_internal.js copies its OWN diagram-overrides.json into the
    // workspace as overrides.json, and OVERRIDES_FILE would shadow that file whole.
    const g = gate(path.join(SK, 'schematize_internal.js'), s4.dir, 'internal-schematic.svg', path.join(s4.dir, 'internal-schematic.svg'), { ignoreLineRe: PLACE_IGNORE, overridesFromWorkspace: true }).status;
    row.schematic = g === 'NO-SHEET' ? judgeNoSheet(s4.rec, 'internal-schematic.svg') : g;
  } else row.schematic = '-';
  if (routesJson.internalDiagram) {
    const g = gate(path.join(SK, 'diagram_internal.js'), s4.dir, 'internal-diagram.svg', path.join(s4.dir, 'internal-diagram.svg'), { ignoreLineRe: PLACE_IGNORE }).status;
    row.diagram = g === 'NO-SHEET' ? judgeNoSheet(s4.rec, 'internal-diagram.svg') : g;
  } else row.diagram = '-';
  row.keys = placeKeys(routesJson, row);
  return row;
}

/* ---- IS THE COMMITTED FIXTURE THE CURRENT SHEET? (2026-08-30, OA-182) ------
 *
 * A byte gate against a FROZEN fixture is self-consistent by construction: the
 * old engine reproduces the old sheet perfectly and the gate reports PASS about
 * code that has not shipped. `Areas/_portal-fixture/README.md` says so in as
 * many words and the trap has been walked into three times in three days — the
 * radial round forgot the area fixture, the placer round forgot it again and was
 * caught only by the portal PR's own verify job going red, and the place-index
 * round found the PLACE fixture a version behind as well.
 *
 * The reason it keeps happening is that the two fixtures are refreshed by two
 * different mechanisms and nothing pairs them: the place one has
 * `scripts/refresh-place-fixture.mjs` in the portal, and the area one has a
 * shell recipe in a README. This does not pair them either. What it does is put
 * the fact in front of whoever is about to re-vendor, on the board they already
 * run — which is the cheapest of the three fixes OA-182 listed.
 *
 * `Areas/_portal-fixture` is the only one it looks at; see the note on the
 * function below for why the place one is neither comparable nor uncovered.
 *
 * AND IT IS A LAPTOP CHECK, NOT A CI ONE, WHICH IS STATED HERE BECAUSE THE
 * OPPOSITE IS EASY TO ASSUME. It compares the committed fixture against the
 * newest S5 render, and `S5-render/` is gitignored — so in a fresh
 * `actions/checkout` there is no render to compare with, `latestRunDir` points
 * at a folder that does not exist, and this returns no rows and gates nothing.
 * That is not a bug to fix by tracking the renders (they are 88% of the repo's
 * bulk and rebuildable); it is the honest shape of the question, which is *does
 * this laptop hold a newer render than the fixture describes*. CI answers a
 * different and equally necessary question — the portal PR's `verify` job
 * regenerates from the committed fixture with the PR's own engine — and it is
 * what caught the placer round. The two are complements, and this one exists
 * because CI's version only speaks after the PR is open.

 *
 * It compares the fixture's committed sheets with the newest S5 render of the
 * map they were cut from, BYTE FOR BYTE, rather than comparing version strings.
 * A version number says which build wrote a file and not whether the bytes
 * differ, and the fixture deliberately omits the JPGs, the svc_*.html evidence
 * pages and build-warnings.txt — so a filename comparison would be permanently
 * red and a gate that is red on day one gets muted in its first week.
 */
/* WHY ONLY THE AREA FIXTURE. `Places/_portal-fixture/<place>` is a DIFFERENT
 * pack from that place's own S5 render — it carries base-overrides.json, the
 * portal's name for a customer's edits, and its sheets are rendered with them —
 * so comparing the two is wrong in principle. It is also already covered: the
 * *Portal fixtures* table below runs the PORTAL's own vendored engine against
 * that fixture and diffs it against the committed SVG, which is the stronger
 * question. `Areas/_portal-fixture` is the one nothing asks about, and it is the
 * one that has been forgotten twice. */
function fixtureFreshness() {
  const rows = [];
  const fixDir = path.join(BUSES, 'Areas', '_portal-fixture', 'St Ives');
  const townDir = path.join(BUSES, 'Areas', 'St Ives');
  if (!exists(fixDir) || !exists(townDir)) return rows;
  /* ASK THE MANIFEST WHICH RUN IS LATEST, never the directory listing sorted as
   * strings. `v1.9_2026-08-18` sorts AFTER `v1.23_2026-08-30` one character in,
   * and the first cut of this check duly compared a fresh fixture against a
   * render from twelve days earlier and called it stale. latestRunDir() is how
   * every other gate in this file asks the same question. */
  const manifest = readJson(path.join(townDir, 'manifest.json'));
  // latestRunDir returns {dir, rec}, not a path. Taking it for a string made this
  // function return silently empty -- a check that prints nothing and gates on
  // nothing, which is the one failure mode a freshness check must not have.
  const latest = manifest && latestRunDir(manifest, townDir, 'S5');
  const newest = latest && latest.dir;
  if (!newest || !exists(newest)) return rows;
  const stale = [];
  for (const f of fs.readdirSync(fixDir)) {
    if (!f.endsWith('.svg')) continue;
    const src = path.join(newest, f);
    if (!exists(src)) { stale.push(f + ' (no longer rendered)'); continue; }
    if (!sameIgnoringLineEndings(path.join(fixDir, f), src)) stale.push(f);
  }
  rows.push({ label: 'Areas/_portal-fixture/St Ives', run: path.basename(newest), stale });
  return rows;
}

// ---- portal fixture reproduction (uses the PORTAL's own vendored engine) --
function gatePortalFixture() {
  const fixDir = path.join(BUSES, 'Places', '_portal-fixture');
  if (!exists(fixDir) || !exists(PORTAL)) return [];
  const out = [];
  for (const name of fs.readdirSync(fixDir)) {
    const dataDir = path.join(fixDir, name);
    if (!fs.statSync(dataDir).isDirectory()) continue;
    const genInt = path.join(PORTAL, 'engine', 'place', 'gen_internal.js');
    const genExt = path.join(PORTAL, 'engine', 'place', 'gen_external_places.js');
    const row = { name };
    // The portal's flat fixture dirs carry customer edits as base-overrides.json,
    // not the staged skill's overrides.json — pass it through explicitly so the
    // gate reproduces what the portal actually renders, not the un-overridden base.
    // SKILL_ASSETS MUST BE THE PORTAL'S OWN engine/, AND WAS NOT (2026-08-28).
    //
    // This whole table exists to gate the copies the live site renders. But
    // gate_lib's runGenerator sets SKILL_ASSETS to the SKILL's assets, and until
    // this line was added nothing here overrode it — so the gate ran the portal's
    // ENTRY generator (engine/place/gen_internal.js) against the SKILL's shared
    // modules. The portal's own svg_primitives.js, labeller.js, projection.js and
    // every other file in engine/ were never loaded at all. That is a combination
    // that exists in no deployment: renderMap.js passes SKILL_ASSETS = engine/, so
    // live, the portal's modules are the ones that draw.
    //
    // The vendored entry generators resolve a sibling FIRST and SKILL_ASSETS
    // second (`_dep`), and the shared modules sit one level up in engine/ rather
    // than beside them in engine/place/ — so the SKILL_ASSETS arm is the only arm,
    // and pointing it at the skill silently substituted 19 of the 22 vendored
    // files. MEASURED by making four portal modules throw on load: this table
    // still said PASS, and the same gate with SKILL_ASSETS = engine/ said FAIL.
    // A green row about code it had never executed.
    //
    // Its stablemate, the drift check further down, compares the two copies file
    // by file and is what has been carrying this — but drift is a different
    // question from "does the portal's engine still draw the shipped sheet".
    // Until 2026-08-28 this comment added "and OA-145 keeps three of those files
    // deliberately DRIFTED", which was the reassurance that stopped anyone
    // re-reading the rows: by then four of six drifted files carried real code
    // and the portal was a badge-and-lozenge release behind. Nothing is drifted
    // now, and the standing rule is that a note explaining away a red must carry
    // the measurement that made it benign — see "a row that explains away a red".
    // Built by gate_lib so that tools/prove-red-gates.js falsifies THIS gate
    // rather than a second copy of it that can drift away in silence. That
    // helper also carries base-overrides.json, the portal's name for the
    // customer edits the shipped sheet was rendered with.
    const extraEnv = portalFixtureEnv(PORTAL, dataDir);
    // A fixture has no manifest to consult, and it exists precisely to be a frozen
    // shipped sheet — so NO-SHEET here is never "never built", it is a fixture that
    // has lost the artwork it is supposed to prove. Always MISSING, always red.
    //
    // 2026-08-23 — that held while every place fixture carried both sheets, and
    // broke the day one did not. `High Wycombe High Street` is a BOARDING-ONLY
    // place (open action: deliberate, not unfinished), so its payload has no
    // routes_paths.json and no destinations[]; running gen_internal.js against it
    // is the same mistake the places table made a fortnight ago and printed FAIL
    // for the honest answer "this fixture has no internal sheet". A fixture still
    // has no manifest, so the declaration is read from the payload instead — the
    // same question the portal's own `requiresFiles` asks: can this generator's
    // inputs be satisfied at all? Absent, the row is '-' and gates nothing.
    // PRESENT and the reference SVG missing is still MISSING, still red, which is
    // the guard the paragraph above exists for.
    const rjF = readJson(path.join(dataDir, 'routes.json')) || {};
    const canInt = exists(path.join(dataDir, 'routes_paths.json'));
    const canExt = Array.isArray(rjF.destinations) && rjF.destinations.length > 0;
    const fInt = !canInt ? 'n/a' : exists(genInt)
      ? gate(genInt, dataDir, 'internal.svg', path.join(dataDir, 'internal.svg'), { ignoreLineRe: PLACE_IGNORE, extraEnv }).status
      : 'no-gen';
    const fExt = !canExt ? 'n/a' : exists(genExt)
      ? gate(genExt, dataDir, 'external.svg', path.join(dataDir, 'external.svg'), { extraEnv }).status
      : 'no-gen';
    row.internal = fInt === 'n/a' ? '-' : fInt === 'NO-SHEET' ? 'MISSING' : fInt;
    row.external = fExt === 'n/a' ? '-' : fExt === 'NO-SHEET' ? 'MISSING' : fExt;
    // The BOARDING sheet, new on 2026-08-23 with the portal's fifth output. This
    // is the one table it belongs in today: the places table would start on two
    // true DIFFs (St Ives is 13 lines behind the engine, High Wycombe town centre
    // 1) and a gate that is red on day one gets muted — that column stays tied to
    // its own open action. Here it starts green, and without it the fixture
    // committed to prove the boarding sheet proves nothing on this board at all.
    const genBrd = path.join(PORTAL, 'engine', 'expert', 'gen_boarding.js');
    const canBrd = !!rjF.boardingPlan
      && exists(path.join(dataDir, 'stands.json'))
      && exists(path.join(dataDir, 'boarding_index.json'));
    const fBrd = !canBrd ? 'n/a' : exists(genBrd)
      ? gate(genBrd, dataDir, 'boarding.svg', path.join(dataDir, 'boarding.svg'), { extraEnv }).status
      : 'no-gen';
    row.boarding = fBrd === 'n/a' ? '-' : fBrd === 'NO-SHEET' ? 'MISSING' : fBrd;
    out.push(row);
  }
  return out;
}

// ---- portal vendoring drift (engine/vendored.json in the portal) -----------
// UNTIL 2026-08-25 THIS FUNCTION HELD THE LIST ITSELF: eleven hard-coded pairs,
// maintained by remembering to add a row whenever a file was vendored. It went
// four days green while engine/area/gen_external_radial.js was stale, because
// nobody had added the row — the portal tree held sixteen files and this list
// named eleven, so area/gen_external_busway.js, area/gen_external_radial.js and
// place/gen_internal_place.js were vendored copies no gate had ever looked at.
// That is technical-audit_2026-08-25 N14, and "an enumeration is a silent
// filter" already in this project's memory.
//
// The list now lives ONCE, in the portal's own engine/vendored.json, which
// scripts/check-vendored.mjs reads inside `npm test` there. This function reads
// the same file, so the two checks cannot disagree about which files exist:
// each portal .js is either `vendored` (with a source to compare against) or
// `portal-owned` (a wrapper with no counterpart here), and a file on disk that
// the manifest does not name is UNLISTED, which is red.
//
// The division of labour between the two: the portal's check runs everywhere
// including CI and asks "has the portal's copy been edited since it was
// vendored?" — it cannot see the skill tree. THIS one runs on the laptop where
// both trees exist and asks the other question, "has the source moved on
// without us?". Neither can answer the other's.
function portalDrift() {
  if (!exists(PORTAL)) return [];
  const engineDir = path.join(PORTAL, 'engine');
  const manifestPath = path.join(engineDir, 'vendored.json');
  if (!exists(manifestPath)) {
    return [{ file: 'engine/vendored.json', same: null,
      status: 'NO-MANIFEST',
      note: 'no manifest in the portal — nothing here can say which files are vendored' }];
  }
  const SKILL_ROOT = path.resolve(SK, '..', '..');   // …/.claude/skills
  const manifest = readJson(manifestPath) || {};
  const entries = Array.isArray(manifest.files) ? manifest.files : [];
  const rows = [];

  for (const e of entries) {
    const portalFile = path.join(engineDir, e.path);
    if (e.kind === 'portal-owned') continue;         // no source to compare against
    const skillFile = path.join(SKILL_ROOT, e.source || '');
    rows.push({
      file: (e.source ? path.basename(e.source) : '?') + ' -> ' + path.join('engine', e.path),
      same: sameIgnoringLineEndings(skillFile, portalFile),
    });
  }

  // The population check. A .js under engine/ that the manifest does not name is
  // exactly the fault this rewrite is about, so it is red here as well as in the
  // portal's own check — the two components count the same set or neither does.
  const listed = new Set(entries.map(e => String(e.path).replace(/\\/g, '/')));
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = prefix ? prefix + '/' + name : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else if (name.endsWith('.js') && !listed.has(rel)) {
        rows.push({ file: path.join('engine', rel) + ' (not named in engine/vendored.json)', same: null, status: 'UNLISTED' });
      }
    }
  };
  if (exists(engineDir)) walk(engineDir, '');
  return rows;
}

// ---- run ---------------------------------------------------------------
const towns = findTowns(BUSES);
const places = findPlaces(towns, BUSES);
const townRows = towns.map(gateTown);
const placeRows = places.map(gatePlace);
const portalFixtureRows = gatePortalFixture();
const freshnessRows = fixtureFreshness();
const driftRows = portalDrift();

// The quality ratchet (Phase 8 item 1). Measured off the ci-reference copies —
// what actually shipped — so a green byte gate and a green quality row are
// statements about the same bytes.
let qualityRows = [];
let qualityTargets = [];
if (!NO_QUALITY) {
  try {
    const q = quality.run(BUSES);
    qualityRows = q.rows;
    // Distance to target (technical-audit_2026-08-25 N11). Reported here and
    // never folded into `bad` below: this board fails on regression, and a
    // target that reddens the board on the day it is written gets muted.
    qualityTargets = quality.targetProgress(q.rows, q.ledger.targets, new Date().toISOString().slice(0, 10));
  } catch (e) { qualityRows = []; qualityTargets = []; console.error('quality gate skipped: ' + e.message); }
}
// Sheets belonging to one town/place, so a row can sit beside its byte-gate row.
const qualityFor = (name) => qualityRows.filter(r => r.key.startsWith(name + ' · '));
const qualityCell = (name) => {
  const rs = qualityFor(name);
  if (!rs.length) return '-';
  const bad = rs.filter(r => r.status === 'REGRESSED');
  if (bad.length) return 'REGRESSED';
  if (rs.some(r => r.status === 'NEW')) return 'unrecorded';
  return rs.some(r => r.status === 'BETTER') ? 'better' : 'ok';
};

// Does anything need attention? Computed HERE, above the JSON branch, and not at
// the foot of the file where it used to live.
//
// FIXED 2026-08-16, WITH the Phase 8 re-vendor and deliberately not before. The
// JSON branch used to `process.exit(0)` unconditionally while the human branch
// exited 1 — and `--json` is the form .github/workflows/gates.yml runs as its
// gating step, so **CI was green no matter what the gates said**, on both repos,
// for as long as that workflow has existed. The reason it could not be flipped
// on its own is the reason it is easy to get wrong twice: the board legitimately
// carried 4 DRIFTED vendoring rows while the design-quality plan held the portal
// hand-off back, so turning this on first would have made CI red for an expected
// state and taught everyone to ignore it. The re-vendor in this same commit is
// what clears them. A quality REGRESSION counts too (Phase 8 item 1).
// MISSING joins the failing set and '-' does not, which is the whole point of
// judgeNoSheet: a sheet the build never claimed to make cannot have regressed, and
// a sheet it did claim to make and has not got is worse than one that differs.
// SCHEMATIC AND DIAGRAM WERE NOT IN THIS SET UNTIL 2026-08-27, and had never been
// (OA-129 Phase 0). Both columns were computed, printed, and then dropped: a town
// whose internal-schematic.svg came back DIFF showed DIFF on the board and exited
// 0, so CI passed. Eight towns draw a schematic and four draw a diagram, so twelve
// sheet-gates were decorative — the exact "a gate described is not a gate run"
// shape, one rung further along, where the gate genuinely runs and its answer is
// discarded. Safe to add today because every one of those twelve currently reads
// PASS or '-', so the set starts green rather than red-on-day-one.
// ---- engine staleness: which STALE stamps gate, and which one does not ------
//
// OA-151. `row.engineCurrent` has been computed since the hash existed, printed
// in the Engine column, and then dropped on the floor: it was in neither `bad`
// below nor the JSON verdict. That is the same "verdict computed and discarded"
// shape as the twelve schematic/diagram sheet-gates folded in on 2026-08-27, one
// rung further along — because until 2026-08-28 a Linux checkout computed a
// DIFFERENT engine hash from the laptop that stamped the maps, so every town
// printed `f83987f11b STALE` in CI while CI exited 0. The verdict was discarded
// AND the value it was computed from had been invented by the checkout.
//
// WHY THERE IS AN EXCEPTION, AND WHY IT IS THIS NARROW. Folding this in
// unconditionally turns the board red for Ramsey on its first run, and a gate
// that is red on day one is a gate that gets muted — this project has paid for
// that more than once, and it is why the quality TARGETS are still reported
// rather than gated a few lines above. Ramsey is genuinely built from older code
// rather than carrying a line-ending artefact, it is the only record that any map
// was, and whether it stays a town at all is an open question (OA-072) — so
// rebuilding it to clear the gate would be work on a map that may not survive.
//
// The exception is keyed to the TOWN AND THE EXACT HASH, so it expires by itself:
// rebuild Ramsey on any engine and the pair stops matching, the exception stops
// applying, and the row gates like every other. It cannot silently widen into
// "Ramsey is never checked".
// Empty on purpose. The one entry this ever held — Ramsey at d8eb6961c7, excused
// because OA-072 asked whether Ramsey stayed a town at all — expired twice over on
// 2026-08-28: OA-072 was answered "keep it", and Ramsey was then rebuilt from S1 as
// v2.0 on the current engine. The board itself reported the exception as no longer
// applying, which is the behaviour to preserve: an entry here must name the town,
// the exact engine hash it excuses and why, so it stops excusing anything the
// moment that town is rebuilt.
const ENGINE_STALE_ALLOWED = [];
const engineStaleAllowed = (r) => ENGINE_STALE_ALLOWED.some(a => a.town === r.name && a.engine === r.engine);
// '(none)' is a map stamped before the hash existed, not a map built from stale
// code, and it is a different question — reported, never gated, exactly as the
// Engine column has always shown it.
const engineStaleRows = townRows.filter(r => r.engine && r.engine !== '(none)' && !r.engineCurrent && !engineStaleAllowed(r));

const bad = townRows.some(r => ['DIFF', 'FAIL', 'NO-BUILD', 'MISSING'].includes(r.internal) || String(r.external).startsWith('DIFF') || String(r.external).startsWith('FAIL') || r.external === 'MISSING'
    || ['DIFF', 'FAIL', 'MISSING'].includes(r.schematic) || ['DIFF', 'FAIL', 'MISSING'].includes(r.diagram))
  || placeRows.some(r => ['DIFF', 'FAIL', 'NO-BUILD', 'MISSING'].includes(r.internal) || ['DIFF', 'FAIL', 'MISSING'].includes(r.external)
    || ['DIFF', 'FAIL', 'MISSING'].includes(r.boarding)
    // OA-170. Printing a column the exit code ignores is the shape this row was
    // raised about one level up: a reference with the authority of a golden master
    // and the coverage of a scratch copy.
    || ['DIFF', 'FAIL', 'MISSING'].includes(r.schematic) || ['DIFF', 'FAIL', 'MISSING'].includes(r.diagram))
  || portalFixtureRows.some(r => ['DIFF', 'FAIL', 'MISSING'].includes(r.internal) || ['DIFF', 'FAIL', 'MISSING'].includes(r.external) || ['DIFF', 'FAIL', 'MISSING'].includes(r.boarding))
  // `null` is MISSING — the portal has no such file. It counted as fine until
  // 2026-08-18, which had it backwards: a vendored file that DIFFERS is stale
  // output, a vendored file that is ABSENT is a require that throws. The row was
  // printed either way, so this only closes the gap between what the board says
  // and what it gates on. Safe to flip now for the same reason the exit code
  // itself was: the board is already red for the deferred re-vendor above, so no
  // expected state changes colour today and nobody learns to ignore it.
  || driftRows.some(r => r.same === false || r.same === null)
  // OA-057, GATED FROM 2026-08-29 and reported-only before that. The rule the
  // column was held out under is that a check red on the day it lands gets muted
  // within the week, and seven of the ten places that draw an internal sheet were
  // short. OA-019's round two closed all seven, so the board is 10 of 10 and this
  // goes red only for a place that LOSES a key or for a new place built without
  // one -- which is the whole point of gating it now rather than later.
  || placeRows.some(r => r.keys && r.keys.state === 'short')
  || qualityRows.some(r => r.status === 'REGRESSED')
  // OA-182, GATED from the day it landed. The rule this project holds to is that
  // a check which is red on its first run gets muted inside a week -- so the two
  // committed fixtures were recut in the same change that added this, and the
  // board is green on it now. What turns it red from here is exactly the thing
  // that has slipped through three times in three days: an engine round that
  // re-vendors and leaves a fixture describing the previous engine.
  || freshnessRows.some(r => r.stale.length)
  || engineStaleRows.length > 0;


// ---- deployment drift: is the LIVE site running what main says? ------------
//
// WHY THIS IS HERE AT ALL (technical-audit_2026-08-25 N2). On 2026-08-25 the
// live site was one commit behind `main`, and the commit it was missing was the
// one crediting NaPTAN in legal.html -- an attribution correction whose entire
// value is that the public can see it. Nothing in the estate compared the two.
// The portal's own /health had carried `gitSha` until the S4 fix gated it
// (correctly) behind a token on 2026-08-20, and the only other surface was a
// <meta> injected by a script, so establishing the gap took a headless browser.
// A security fix had quietly cost an operational control.
//
// The portal now sets `X-App-Version: <version>+<short sha>` on every response,
// from every route, with no authentication and no JavaScript. This reads it.
//
// THREE RULES ABOUT WHEN THIS MAY GO RED, because a badly-judged gate here would
// be worse than none:
//
//   1. A NETWORK FAILURE IS NEVER RED. If the site is unreachable, that is what
//      the uptime monitor is for (audit O2, live since 2026-08-20). A gate that
//      cannot reach the network must say "I could not tell", not "your
//      deployment is stale" -- the difference between the two is the whole
//      lesson of a checker that reports "no answer" as "wrong answer".
//   2. A MISSING HEADER IS NEVER RED either. It means the live build predates
//      this change, which is a true and temporary fact, not a fault.
//   3. BEHIND IS AMBER FOR DEPLOY_GRACE_HOURS AND RED AFTER. A merge is not a
//      deploy and nobody should be gated the minute they press merge; twelve
//      hours later, "merged and forgotten" is the only remaining explanation.
//
// The comparison is against `origin/main` in the portal checkout, falling back
// to HEAD -- so running this on a feature branch still asks the right question
// ("is the deployment current with main"), not the wrong one ("is the deployment
// running my branch").
function gitIn(dir, args) {
  try {
    const r = require('child_process').execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return r.trim();
  } catch { return null; }
}

// Read Development Docs/commitments.json and judge each entry against today.
// Pure: no network, no git, no clock beyond `today`. Returns [] when the file is
// absent, because a repo without one is not a repo in breach.
function commitmentRows() {
  if (NO_COMMITMENTS) return { status: 'skipped', why: '--no-commitments', rows: [] };
  const f = path.join(BUSES, 'Development Docs', 'commitments.json');
  if (!exists(f)) return { status: 'skipped', why: 'no commitments.json', rows: [] };
  const doc = readJson(f);
  if (!doc || !Array.isArray(doc.commitments)) {
    // A file we cannot parse is a FAULT, not an empty list -- the silent-failure
    // shape this project keeps paying for. Say so and fail the board.
    return { status: 'UNREADABLE', why: 'commitments.json present but has no `commitments` array', rows: [] };
  }
  const todayMs = COMMITMENTS_TODAY ? Date.parse(COMMITMENTS_TODAY + 'T00:00:00Z') : Date.now();
  const rows = doc.commitments.map((c) => {
    const byMs = Date.parse(String(c.by) + 'T00:00:00Z');
    if (!Number.isFinite(byMs)) return { ...c, state: 'UNDATED', days: null };
    const days = Math.ceil((byMs - todayMs) / 86400000);
    const warn = Number.isFinite(+c.warnDays) ? +c.warnDays : 14;
    return { ...c, days, state: days < 0 ? 'OVERDUE' : days <= warn ? 'due soon' : 'ok' };
  });
  rows.sort((a, b) => (a.days == null ? -1 : b.days == null ? 1 : a.days - b.days));
  return { status: 'read', rows };
}

// Only OVERDUE and UNDATED fail the board; an amber row is information, and an
// UNREADABLE file is a fault rather than an empty list.
function commitBad(c) {
  if (!c || c.status === 'skipped') return false;
  if (c.status === 'UNREADABLE') return true;
  return c.rows.some(r => r.state === 'OVERDUE' || r.state === 'UNDATED');
}

async function deploymentRow() {
  if (NO_LIVE) return { status: 'skipped', why: '--no-live' };
  if (!exists(PORTAL)) return { status: 'skipped', why: 'no portal checkout to compare against' };

  const ref = gitIn(PORTAL, ['rev-parse', '--verify', '--quiet', 'origin/main']) ? 'origin/main' : 'HEAD';
  const wantFull = gitIn(PORTAL, ['rev-parse', ref]);
  const want = gitIn(PORTAL, ['rev-parse', '--short', ref]);
  if (!want) return { status: 'skipped', why: 'could not read a SHA from ' + PORTAL };

  let live = null;
  try {
    const res = await fetch(LIVE_URL + '/health', { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    live = res.headers.get('x-app-version');
    // DRAIN THE BODY even though only the header is wanted. An unconsumed
    // response body leaves undici holding the socket, and this process ends by
    // calling process.exit -- on Windows that combination aborts the process
    // outright: "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file
    // src\win\async.c". Found on the first real run after the deploy of
    // 2026-08-25: every row was correct, the Deployment row said `current`, and
    // the EXIT CODE was 127. Which is the worse half, because the exit code is
    // the only part of this CI reads.
    await res.arrayBuffer().catch(() => {});
  } catch (e) {
    // Rule 1: unreachable is not stale.
    return { status: 'unreachable', want, url: LIVE_URL, why: String(e.message || e) };
  }
  if (!live) {
    // Rule 2: no header means an older build, which is a fact and not a fault.
    return { status: 'no-header', want, url: LIVE_URL, why: 'live build predates X-App-Version' };
  }
  const deployed = live.split('+').pop();
  if (deployed === want || (wantFull && wantFull.startsWith(deployed))) {
    return { status: 'current', want, deployed, url: LIVE_URL };
  }

  // Rule 3: how long has the undeployed commit been sitting there?
  const ts = Number(gitIn(PORTAL, ['log', '-1', '--format=%ct', ref]));
  const ageH = Number.isFinite(ts) ? Math.floor((Date.now() / 1000 - ts) / 3600) : null;
  const overGrace = ageH == null ? true : ageH >= DEPLOY_GRACE_HOURS;
  return {
    status: overGrace ? 'BEHIND' : 'behind (grace)',
    want, deployed, url: LIVE_URL, ageHours: ageH, graceHours: DEPLOY_GRACE_HOURS,
  };
}

async function main() {
  const deploy = await deploymentRow();
  const commit = commitmentRows();
  if (AS_JSON) {
    console.log(JSON.stringify({ towns: townRows, places: placeRows, portalFixtures: portalFixtureRows, fixtureFreshness: freshnessRows, portalDrift: driftRows, quality: qualityRows, qualityTargets, engineStale: engineStaleRows.map(r => ({ town: r.name, engine: r.engine })), engineStaleAllowed: ENGINE_STALE_ALLOWED, deployment: deploy, commitments: commit }, null, 2));
    return bad || deploy.status === 'BEHIND' || commitBad(commit);
  }

  function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
  function line(cells, widths) { return cells.map((c, i) => pad(c, widths[i])).join(AS_MD ? ' | ' : '  '); }

  console.log('=== Towns (' + towns.length + ') === engine: current template = ' + CURRENT_ENGINE);
  if (AS_MD) console.log('| Town | Ver | Engine | Internal | External | Schematic | Diagram | Quality | S6 | S6 age |\n|---|---|---|---|---|---|---|---|---|---|');
  // Engine is 26 wide, not 12: 'd8eb6961c7 STALE (allowed)' is exactly 26 characters
  // and anything narrower pushes the Internal column out of line on the one row the
  // reader is most likely to be looking at.
  const tw = [16, 6, 26, 9, 16, 10, 8, 11, 20, 8];
  if (!AS_MD) console.log(line(['Town', 'Ver', 'Engine', 'Internal', 'External', 'Schematic', 'Diagram', 'Quality', 'S6 latest', 'S6 age'], tw));
  for (const r of townRows) {
    const ext = r.external + (r.externalStyle ? ` (${r.externalStyle})` : '');
    const s6age = r.s6Age == null ? '' : `${r.s6Age}d${r.s6Stale ? ' STALE' : ''}`;
    // 'STALE (allowed)' rather than plain STALE, so the board says out loud which
    // staleness gates and which is the dated exception above — an exception nobody
    // can see on the board is one nobody will ever come back to.
    const eng = r.engine ? (r.engine === '(none)' ? '(none)' : r.engine + (r.engineCurrent ? '' : (engineStaleAllowed(r) ? ' STALE (allowed)' : ' STALE'))) : '-';
    const cells = [r.name, r.version || '-', eng, r.internal, ext, r.schematic, r.diagram, qualityCell(r.name), r.s6, s6age];
    console.log(line(cells, tw));
  }

  // The exception is stated under the table it excuses, not only in the source.
  // An exception a reader of the board cannot see is one nobody ever comes back to,
  // and this one is meant to be temporary.
  for (const a of ENGINE_STALE_ALLOWED) {
    const row = townRows.find(r => r.name === a.town && r.engine === a.engine);
    if (row) console.log('  engine staleness ALLOWED for ' + a.town + ' at ' + a.engine + ' since ' + a.since + ' -- ' + a.why);
    else console.log('  engine-staleness exception for ' + a.town + ' at ' + a.engine + ' NO LONGER APPLIES -- delete it from ENGINE_STALE_ALLOWED');
  }
  if (engineStaleRows.length) console.log('  ENGINE STALE (gating): ' + engineStaleRows.map(r => r.name + ' @ ' + r.engine).join(', ') + '  -- rebuild it, or add a dated exception');
  console.log('\n=== Places (' + places.length + ') === engine: current PLACE template = ' + CURRENT_PLACE_ENGINE);
  const pw = [34, 18, 6, 26, 9, 9, 9, 9, 9, 11, 26, 20, 8];
  if (AS_MD) console.log('| Place | Town | Ver | Engine | Internal | External | Schematic | Diagram | Boarding | Quality | Keys | S6 | S6 age |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  if (!AS_MD) console.log(line(['Place', 'Town', 'Ver', 'Engine', 'Internal', 'External', 'Schematic', 'Diagram', 'Boarding', 'Quality', 'Keys', 'S6 latest', 'S6 age'], pw));
  for (const r of placeRows) {
    // Names what is MISSING rather than a fraction, because the missing key is
    // the actionable half and 'freq+tiers' says which command to run.
    const keys = !r.keys ? '-' : r.keys.state === 'n/a' ? 'n/a'
      : r.keys.state === 'complete' ? 'all four'
      : r.keys.missing.length === PLACE_KEYS.length ? 'none of four'
      : 'no ' + r.keys.missing.join('/');
    const ps6age = r.s6Age == null ? '' : `${r.s6Age}d${r.s6Stale ? ' STALE' : ''}`;
    // Same wording as the town row, minus the 'STALE (allowed)' arm — there is no
    // exception list for places and there should not be one until a measured
    // reason for it exists.
    const peng = r.engine ? (r.engine === '(none)' ? '(none)' : r.engine + (r.engineCurrent ? '' : ' STALE')) : '-';
    console.log(line([r.name, r.town, r.version || '-', peng, r.internal, r.external, r.schematic || '-', r.diagram || '-', r.boarding || '-', qualityCell(r.name), keys, r.s6, ps6age], pw));
  }
  // In `bad` since 2026-08-29 -- see the gate expression for why it was not before.
  const drawing = placeRows.filter(r => r.keys && r.keys.state !== 'n/a');
  const short = drawing.filter(r => r.keys.state === 'short');
  if (drawing.length) {
    const noFreq = short.filter(r => r.keys.missing.includes('freq') || r.keys.missing.includes('tiers')).length;
    const noTerm = short.filter(r => r.keys.missing.includes('termini')).length;
    console.log('  completeness (OA-057, GATED since 2026-08-29): ' + (drawing.length - short.length) + ' of ' + drawing.length
      + ' places that draw an internal sheet carry all four keys');
    if (short.length) console.log('    ' + noFreq + ' draw every service at the same weight, ' + noTerm
      + ' have bare arrows at the frame exits -- run derive_frequency.js and derive_termini.js with --write on the place, then rebuild it');
  }

  if (portalFixtureRows.length) {
    console.log('\n=== Portal fixtures (vendored engine, ' + PORTAL + ') ===');
    const fw = [24, 9, 9, 9];
    console.log(line(['Fixture', 'Internal', 'External', 'Boarding'], fw));
    for (const r of portalFixtureRows) console.log(line([r.name, r.internal, r.external, r.boarding], fw));
  }

  if (freshnessRows.length) {
    console.log('\n=== Committed portal fixtures vs the newest render (OA-182) ===');
    for (const r of freshnessRows) {
      if (!r.stale.length) { console.log('  current  ' + r.label + '  (' + r.run + ')'); continue; }
      console.log('  STALE    ' + r.label + '  \u2014 ' + r.stale.join(', ')
        + ' differ from ' + r.run);
    }
    if (freshnessRows.some(r => r.stale.length)) {
      console.log('    A gate against a frozen fixture is self-consistent by construction: the old');
      console.log('    engine reproduces the old sheet and PASS says nothing about what shipped.');
      console.log('    Refresh: the place ones with the portal\'s scripts/refresh-place-fixture.mjs,');
      console.log('    the area one with the recipe in Areas/_portal-fixture/README.md.');
    }
  }

  if (driftRows.length) {
    console.log('\n=== Portal vendoring drift (skill -> portal, CRLF-safe) ===');
    for (const r of driftRows) console.log('  ' + (r.status || (r.same === null ? 'MISSING' : r.same ? 'in sync' : 'DRIFTED')).padEnd(9) + r.file);
  }

  if (qualityRows.length) {
    const moved = qualityRows.filter(r => r.status !== 'ok');
    console.log('\n=== Quality ratchet (' + qualityRows.length + ' sheets, ledger: ' + quality.LEDGER_NAME + ') ===');
    if (!moved.length) console.log('  every sheet at or under its recorded ceiling, and none printing fewer labels');
    for (const r of moved) console.log('  ' + r.status.padEnd(11) + r.key.padEnd(38) + r.why.join('; '));
    console.log('  totals: ' + ['labels', 'hard', 'soft', 'drop']
      .map(k => k + ' ' + qualityRows.reduce((s, r) => s + (r.now[k] || 0), 0)).join(' · ')
      + '   (node quality_gate.js --accept to re-record)');
    for (const line of quality.targetLines(qualityTargets)) console.log(line);
  }

  // Exit non-zero if anything needs attention, so this can gate CI. `bad` is
  // computed once, above the JSON branch, so both output forms agree — see there.

  // Deployment drift is reported LAST, under the gates, because it is a
  // statement about a different thing: everything above asks "does the code
  // still produce what it produced", this asks "is any of that actually live".
  // Commitments print above Deployment because they are the same KIND of row --
  // a statement about the world rather than about the code -- and the older of
  // the two questions: "did we do the thing we said" comes before "is what we
  // wrote actually live".
  if (commit.status !== 'skipped') {
    console.log('\n=== Commitments (Development Docs/commitments.json) ===');
    if (commit.status === 'UNREADABLE') {
      console.log('  UNREADABLE   ' + commit.why);
    } else if (!commit.rows.length) {
      console.log('  none recorded');
    } else {
      for (const r of commit.rows) {
        const when = r.days == null ? 'no date' : r.days < 0 ? Math.abs(r.days) + 'd OVERDUE' : r.days + 'd left';
        const mark = r.state === 'OVERDUE' ? 'OVERDUE ' : r.state === 'due soon' ? 'due soon' : 'ok      ';
        console.log('  ' + mark + '  ' + String(r.what || r.id) + '   (' + r.by + ', ' + when + ')');
        if (r.state !== 'ok') {
          if (r.why) console.log('      ' + r.why);
          if (r.link) console.log('      ' + r.link);
        }
      }
      const over = commit.rows.filter(r => r.state === 'OVERDUE' || r.state === 'UNDATED').length;
      if (over) console.log('  ' + over + ' overdue. Do it, or move the date DELIBERATELY -- moving it is a decision, letting it slide is not.');
    }
  }

  console.log('\n=== Deployment (' + (deploy.url || LIVE_URL) + ') ===');
  if (deploy.status === 'current') {
    console.log('  current   live ' + deploy.deployed + ' == main ' + deploy.want);
  } else if (deploy.status === 'skipped') {
    console.log('  skipped   ' + deploy.why);
  } else if (deploy.status === 'unreachable') {
    console.log('  unreachable  ' + deploy.why + '  (not a verdict about the deployment -- the uptime monitor owns that)');
  } else if (deploy.status === 'no-header') {
    console.log('  no header    the live build predates X-App-Version; deploy once and this row starts working');
  } else {
    console.log('  ' + deploy.status + '   live ' + deploy.deployed + ' != main ' + deploy.want
      + (deploy.ageHours == null ? '' : '  (' + deploy.ageHours + 'h old, grace ' + deploy.graceHours + 'h)'));
    console.log('    main has commits the public cannot see. From C:\\Claude\\community-bus-maps, with no placeholders:');
    console.log('      npm run deploy');
  }

  return bad || deploy.status === 'BEHIND' || commitBad(commit);
}

// Exit non-zero if anything needs attention, so this can gate CI. `bad` is
// computed once, above the JSON branch, so both output forms agree -- see there.
//
// process.exitCode AND NOT process.exit(), for a reason worth keeping. This file
// became async on 2026-08-25 to fetch the live version header, and
// `main().then(f => process.exit(f ? 1 : 0))` tears the process down while
// undici is still closing its socket. On Windows that aborts with
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" and the shell sees
// 127 -- so the board printed every row correctly and then reported a status
// nobody could act on. Draining the response body above is the other half of
// the fix; setting the code and letting Node exit when the loop is genuinely
// empty is this half.
//
// The watchdog is unref'd, so it never keeps the process alive by itself. It is
// there because "let Node exit naturally" fails in the other direction if
// anything ever holds a handle open: a gate that hangs is worse than one that
// fails, since nothing chases a check that never reaches a verdict. Fifteen
// seconds is far past undici's keep-alive, so reaching it means a real leak --
// and it exits with the RIGHT code rather than pretending nothing happened.
function finish(failed) {
  const code = failed ? 1 : 0;
  process.exitCode = code;
  const watchdog = setTimeout(() => {
    console.error('status.js: something is still holding the event loop open after 15s; exiting ' + code + ' anyway.');
    process.exit(code);
  }, 15_000);
  if (watchdog.unref) watchdog.unref();
}
main().then(finish).catch((e) => {
  console.error(e);
  finish(true);
});
