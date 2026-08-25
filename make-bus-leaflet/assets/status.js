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
const { SK, gate, sameIgnoringLineEndings, findTowns, findPlaces, readJson, latestRunDir, detectExternalStyle, PLACE_IGNORE } = require('./gate_lib');
const { computeEngineVersion } = require('./engine_version');
const quality = require('./quality_gate');

const CURRENT_ENGINE = computeEngineVersion();

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
// The third case is not hypothetical: `stage.js commit` does not check that the
// outputs it is told about exist (a known open action, hit again on 2026-08-23),
// so a manifest CAN advertise a version with no map in it. Reading the declaration
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
  let routesJson = {};
  try { routesJson = readJson(path.join(s4.dir, 'routes.json')); } catch (e) {}
  if (routesJson.internalSchematic && exists(path.join(s4.dir, 'internal-schematic.svg'))) {
    row.schematic = gate(path.join(SK, 'schematize_internal.js'), s4.dir, 'internal-schematic.svg', path.join(s4.dir, 'internal-schematic.svg')).status;
  } else row.schematic = '-';
  if (routesJson.internalDiagram && exists(path.join(s4.dir, 'internal-diagram.svg'))) {
    row.diagram = gate(path.join(SK, 'diagram_internal.js'), s4.dir, 'internal-diagram.svg', path.join(s4.dir, 'internal-diagram.svg')).status;
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
function gatePlace(p) {
  const m = readJson(path.join(p.dir, 'manifest.json'));
  const s4 = latestRunDir(m, p.dir, 'S4');
  const row = { name: p.name, town: p.town || '(standalone)', version: s4 ? s4.rec.version : null };
  if (!s4) { row.internal = 'NO-BUILD'; row.external = '-'; row.boarding = '-'; return row; }
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
  return row;
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
    const baseOverrides = path.join(dataDir, 'base-overrides.json');
    const extraEnv = exists(baseOverrides) ? { OVERRIDES_FILE: baseOverrides } : {};
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

// ---- portal vendoring drift (§4 table in changing-the-engine.md) -----------
function portalDrift() {
  if (!exists(PORTAL)) return [];
  const rows = [
    [path.join(SK, 'icons.js'), path.join(PORTAL, 'engine', 'icons.js')],
    [path.join(SK, 'render.js'), path.join(PORTAL, 'engine', 'render.js')],
    // footer.js was missing from this table until 2026-08-10: gen_internal.js
    // resolves it via SKILL_ASSETS just like icons.js (see its _FOOTER IIFE),
    // so a footer-only skill change silently drifted the portal — the reproduce
    // gate still "passed" locally (own-copy-vs-own-copy) and only failed when
    // verify:area ran the portal's stale engine/footer.js against a fixture
    // built with the new one.
    [path.join(SK, 'footer.js'), path.join(PORTAL, 'engine', 'footer.js')],
    // qr.js became a row on 2026-08-18 with design.sheetQr. footer.js requires it
    // LAZILY, and only when a sheet asks for a code, so a partial vendor does not
    // take the portal down the way a missing labeller.js would — but it would make
    // exactly one town's build throw, months later, with nothing in this table to
    // say why. A row costs nothing and is the whole lesson of the footer.js entry
    // above: the file that is easy to forget is the one nobody lists.
    [path.join(SK, 'qr.js'), path.join(PORTAL, 'engine', 'qr.js')],
    // labeller.js and font_metrics.js became rows on 2026-08-16, at the Phase 8
    // re-vendor that first carried them across. They are not optional extras:
    // gen_internal.js REQUIRES labeller.js at load time (resolved through
    // SKILL_ASSETS exactly as icons.js and footer.js are) and labeller.js
    // requires font_metrics.js, so vendoring gen_internal.js without them throws
    // at the portal's require time rather than failing a byte gate — which is a
    // worse failure than the footer.js one this table was extended to prevent,
    // because it takes the whole build down instead of one file's output.
    [path.join(SK, 'labeller.js'), path.join(PORTAL, 'engine', 'labeller.js')],
    [path.join(SK, 'font_metrics.js'), path.join(PORTAL, 'engine', 'font_metrics.js')],
    [path.join(SK, 'gen_internal.js'), path.join(PORTAL, 'engine', 'place', 'gen_internal.js')],
    [path.join(PSK, 'gen_external_places.js'), path.join(PORTAL, 'engine', 'place', 'gen_external_places.js')],
    [path.join(SK, 'schematize_internal.js'), path.join(PORTAL, 'engine', 'expert', 'schematize_internal.js')],
    [path.join(SK, 'diagram_internal.js'), path.join(PORTAL, 'engine', 'expert', 'diagram_internal.js')],
    // gen_boarding.js became a row on 2026-08-23, when the portal started
    // offering the boarding plan as its fifth output. It is portal-owned like the
    // two expert pre-stages above rather than copied into each map's data, so a
    // skill-side change to it drifts the portal exactly the way gen_internal.js
    // does — and its three dependencies (footer.js, icons.js, font_metrics.js)
    // are already rows, which is what makes vendoring it safe at all.
    [path.join(SK, 'gen_boarding.js'), path.join(PORTAL, 'engine', 'expert', 'gen_boarding.js')],
  ];
  return rows.map(([skillFile, portalFile]) => ({
    file: path.basename(skillFile) + ' -> ' + path.relative(PORTAL, portalFile),
    same: sameIgnoringLineEndings(skillFile, portalFile),
  }));
}

// ---- run ---------------------------------------------------------------
const towns = findTowns(BUSES);
const places = findPlaces(towns, BUSES);
const townRows = towns.map(gateTown);
const placeRows = places.map(gatePlace);
const portalFixtureRows = gatePortalFixture();
const driftRows = portalDrift();

// The quality ratchet (Phase 8 item 1). Measured off the ci-reference copies —
// what actually shipped — so a green byte gate and a green quality row are
// statements about the same bytes.
let qualityRows = [];
if (!NO_QUALITY) {
  try { qualityRows = quality.run(BUSES).rows; }
  catch (e) { qualityRows = []; console.error('quality gate skipped: ' + e.message); }
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
const bad = townRows.some(r => ['DIFF', 'FAIL', 'NO-BUILD', 'MISSING'].includes(r.internal) || String(r.external).startsWith('DIFF') || String(r.external).startsWith('FAIL') || r.external === 'MISSING')
  || placeRows.some(r => ['DIFF', 'FAIL', 'NO-BUILD', 'MISSING'].includes(r.internal) || ['DIFF', 'FAIL', 'MISSING'].includes(r.external)
    || ['DIFF', 'FAIL', 'MISSING'].includes(r.boarding))
  || portalFixtureRows.some(r => ['DIFF', 'FAIL', 'MISSING'].includes(r.internal) || ['DIFF', 'FAIL', 'MISSING'].includes(r.external) || ['DIFF', 'FAIL', 'MISSING'].includes(r.boarding))
  // `null` is MISSING — the portal has no such file. It counted as fine until
  // 2026-08-18, which had it backwards: a vendored file that DIFFERS is stale
  // output, a vendored file that is ABSENT is a require that throws. The row was
  // printed either way, so this only closes the gap between what the board says
  // and what it gates on. Safe to flip now for the same reason the exit code
  // itself was: the board is already red for the deferred re-vendor above, so no
  // expected state changes colour today and nobody learns to ignore it.
  || driftRows.some(r => r.same === false || r.same === null)
  || qualityRows.some(r => r.status === 'REGRESSED');


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
  if (AS_JSON) {
    console.log(JSON.stringify({ towns: townRows, places: placeRows, portalFixtures: portalFixtureRows, portalDrift: driftRows, quality: qualityRows, deployment: deploy }, null, 2));
    return bad || deploy.status === 'BEHIND';
  }

  function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
  function line(cells, widths) { return cells.map((c, i) => pad(c, widths[i])).join(AS_MD ? ' | ' : '  '); }

  console.log('=== Towns (' + towns.length + ') === engine: current template = ' + CURRENT_ENGINE);
  if (AS_MD) console.log('| Town | Ver | Engine | Internal | External | Schematic | Diagram | Quality | S6 | S6 age |\n|---|---|---|---|---|---|---|---|---|---|');
  const tw = [16, 6, 12, 9, 16, 10, 8, 11, 20, 8];
  if (!AS_MD) console.log(line(['Town', 'Ver', 'Engine', 'Internal', 'External', 'Schematic', 'Diagram', 'Quality', 'S6 latest', 'S6 age'], tw));
  for (const r of townRows) {
    const ext = r.external + (r.externalStyle ? ` (${r.externalStyle})` : '');
    const s6age = r.s6Age == null ? '' : `${r.s6Age}d${r.s6Stale ? ' STALE' : ''}`;
    const eng = r.engine ? (r.engine === '(none)' ? '(none)' : r.engine + (r.engineCurrent ? '' : ' STALE')) : '-';
    const cells = [r.name, r.version || '-', eng, r.internal, ext, r.schematic, r.diagram, qualityCell(r.name), r.s6, s6age];
    console.log(line(cells, tw));
  }

  console.log('\n=== Places (' + places.length + ') ===');
  const pw = [24, 18, 6, 9, 9, 9, 11];
  if (!AS_MD) console.log(line(['Place', 'Town', 'Ver', 'Internal', 'External', 'Boarding', 'Quality'], pw));
  for (const r of placeRows) console.log(line([r.name, r.town, r.version || '-', r.internal, r.external, r.boarding || '-', qualityCell(r.name)], pw));

  if (portalFixtureRows.length) {
    console.log('\n=== Portal fixtures (vendored engine, ' + PORTAL + ') ===');
    const fw = [24, 9, 9, 9];
    console.log(line(['Fixture', 'Internal', 'External', 'Boarding'], fw));
    for (const r of portalFixtureRows) console.log(line([r.name, r.internal, r.external, r.boarding], fw));
  }

  if (driftRows.length) {
    console.log('\n=== Portal vendoring drift (skill -> portal, CRLF-safe) ===');
    for (const r of driftRows) console.log('  ' + (r.same === null ? 'MISSING  ' : r.same ? 'in sync  ' : 'DRIFTED  ') + r.file);
  }

  if (qualityRows.length) {
    const moved = qualityRows.filter(r => r.status !== 'ok');
    console.log('\n=== Quality ratchet (' + qualityRows.length + ' sheets, ledger: ' + quality.LEDGER_NAME + ') ===');
    if (!moved.length) console.log('  every sheet at or under its recorded ceiling, and none printing fewer labels');
    for (const r of moved) console.log('  ' + r.status.padEnd(11) + r.key.padEnd(38) + r.why.join('; '));
    console.log('  totals: ' + ['labels', 'hard', 'soft', 'drop']
      .map(k => k + ' ' + qualityRows.reduce((s, r) => s + (r.now[k] || 0), 0)).join(' · ')
      + '   (node quality_gate.js --accept to re-record)');
  }

  // Exit non-zero if anything needs attention, so this can gate CI. `bad` is
  // computed once, above the JSON branch, so both output forms agree — see there.

  // Deployment drift is reported LAST, under the gates, because it is a
  // statement about a different thing: everything above asks "does the code
  // still produce what it produced", this asks "is any of that actually live".
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

  return bad || deploy.status === 'BEHIND';
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
