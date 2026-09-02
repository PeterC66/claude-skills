#!/usr/bin/env node
/*
 * engine_version.js — content-hash the engine: the five entry points every town's
 * S4 build runs unmodified (gen_internal.js, gen_external_radial.js,
 * gen_external_busway.js, icons.js, lane_normals.js) AND every module they
 * require, found by following the requires. Item 3 of the 2026-08-04
 * process-efficiency plan; the closure replaced the flat list on 2026-08-27,
 * when ten extractions had moved most of the drawing code outside it.
 *
 * Why: a town's S3 used to carry its own COPY of the two generators (frozen at
 * commit time) purely so a later build could know what code drew it. That copy
 * was never actually used to detect staleness — status.js/gate_lib.js always
 * gate the town's stored DATA against the CURRENT %SK% template, ignoring
 * whatever is sitting in the town's own S3/S4 folders. So the copy bought
 * nothing except repo bulk and the "a build takes its generator from its own
 * S3 run" trap that made every engine improvement invisible until a manual
 * rollout.js pass. This hash is the provenance the copy was really for:
 * routes.json's new "engine" field records WHICH engine build drew a town,
 * without needing the whole file(s) frozen alongside it.
 *
 * Usage:
 *   node engine_version.js                 print the current hash
 *   node engine_version.js --stamp <file>   write/update "engine":"<hash>" in
 *                                           that routes.json (surgical replace,
 *                                           like stage.js's version stamp;
 *                                           adds the field if absent)
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lfBytes } = require('./line_endings');

const SK = __dirname;
// THE ENTRY POINTS, not the whole engine. lane_normals.js joined them on
// 2026-08-26: it is required by gen_internal.js and it decides where a lane is
// drawn, so a hash that excluded it would go on reporting the same engine across
// a change that moves ink -- a stamp that is current and wrong.
const ENGINE_FILES = ['gen_internal.js', 'gen_external_radial.js', 'gen_external_busway.js', 'icons.js', 'lane_normals.js'];

// ...and everything they require is hashed WITH them, found by following the
// requires rather than by keeping a second list beside this one.
//
// WHY THIS IS NOT A LIST ANY MORE (2026-08-27, OA-129 Phase 3). Ten extractions
// moved 1,235 lines of drawing code OUT of gen_internal.js and into siblings —
// the projection, the linear features, both label placers, the Services panel,
// the complexity ladder. Every one of them left the hash behind: measured on the
// day, appending a line to services_panel.js or complexity_ladder.js did not move
// the template hash at all, and neither did editing labeller.js or footer.js,
// which were never on the list in the first place. A refactor that cannot change
// the answer is exactly the refactor that should not change it; a REDESIGN of the
// Services panel would have been invisible in the same way.
//
// The four idioms below are the four ways this engine names a sibling: _dep() (the
// shared resolver), path.join(..,'x.js') (footer.js and labeller.js reaching for
// font_metrics.js and qr.js), a bare relative require, and the SKILL_ASSETS forms
// the portal's own requireScan() reads. A name is only followed if a file of that
// name is actually there, so a filename mentioned in a comment adds nothing.
//
// THE SECOND PATTERN ALLOWS ONE LEVEL OF NESTED PARENS, and until 2026-08-30 it did
// not (OA-167). `[^()]*?` cannot cross a `(`, so it saw `path.join(SK,'x.js')` and
// was blind to `path.join(path.dirname(_LABELLER),'x.js')` — which is the idiom the
// two external generators actually use. It went unnoticed because all three files
// named that way (`font_metrics.js`, `svg_primitives.js`, `strict_guards.js`) are
// ALSO reached from gen_internal.js by a luckier route: `_dep()` for two of them and
// `path.join(__dirname,…)` inside labeller.js for the third. So the closure was
// right by accident, and the accident ended the moment a file was named ONLY that
// way — dash_fit.js, added the same day, sat outside the hash while being required
// by two of the five entry points. **A scanner is not proved by the answer it gives;
// it is proved by a name only it can find.** Measured before and after: the closure
// goes from 20 files to 21, the one addition is dash_fit.js, and nothing is lost.
//
// THE `_from(...)` IDIOM WAS ADDED TO THIS LIST ON 2026-09-02, AND THE COUNT DID NOT
// MOVE WHEN IT MATTERED (OA-224 Tier 3.4). Extracting the resolver into
// engine_paths.js replaced `path.join(path.dirname(_LABELLER),'dash_fit.js')` with
// `_from('dash_fit.js')`, which matched nothing here -- so dash_fit.js fell out of
// the closure at the same moment engine_paths.js joined it, and the closure stayed
// at exactly 21 files. A COUNT IS NOT A CHECK: only the NAMES showed the loss. This
// is the second time this scanner has been blind to the idiom the external
// generators actually use, and both times the answer looked right.
const DEP_PATTERNS = [
  /_(?:dep|from)\(\s*['"]([\w.-]+\.js)['"]\s*\)/g,               // _dep('x.js') / _from('x.js')
  /path\.join\((?:[^()]|\([^()]*\))*?['"]([\w.-]+\.js)['"]\s*\)/g, // path.join(<dir expr>, 'x.js')
  /require\(\s*['"]\.\/([\w.-]+?)(?:\.js)?['"]\s*\)/g,          // require('./x')
  /SKILL_ASSETS\s*,\s*['"]([\w.-]+\.js)['"]/g,                   // path.join(SKILL_ASSETS,'x.js')
];

/** Every engine file the entry points reach, transitively, sorted. */
function engineFiles(sk = SK) {
  const seen = new Set();
  const queue = ENGINE_FILES.slice();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const p = path.join(sk, name);
    if (!fs.existsSync(p)) continue;               // a missing entry point still hashes, as MISSING
    const src = fs.readFileSync(p, 'utf8');
    for (const re of DEP_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const dep = m[1].endsWith('.js') ? m[1] : m[1] + '.js';
        if (!seen.has(dep) && fs.existsSync(path.join(sk, dep))) queue.push(dep);
      }
    }
  }
  // Sorted, so the hash cannot depend on the order the requires happen to appear
  // in — an extraction reorders them constantly.
  return [...seen].sort();
}

// THE HASH IGNORES LINE ENDINGS, and that is not tidiness (2026-08-28).
//
// This used to hash the raw bytes, which made the engine version a property of
// the CHECKOUT rather than of the commit. `core.autocrlf=true` is set on the
// machine that writes this repo and there was no .gitattributes, so one commit
// gave three different answers depending on who had checked it out: f83987f11b
// on the laptop's historical mix of 15 CRLF files and 180 LF ones — the value
// stamped into all 20 maps — 24ebbec148 in a fresh Windows clone, and
// 0a32b566d4 in an all-LF tree, which is what Linux CI computes. 54 files under
// assets/ differed byte-for-byte between the first two and NOT ONE of them
// differed once \r was stripped. Every town therefore printed `STALE` in CI
// against code that was character-for-character the code that drew it.
//
// `* text=auto eol=lf` (OA-073) stops that happening again, and is the primary
// fix. This is the second half, and it is worth having on its own: a checkout
// made before that rule existed, or on a machine configured some third way,
// still has to reach the same answer as everyone else. The identity of the
// engine is what the code SAYS, not how a filesystem chose to end its lines.
//
// On an all-LF tree this changes nothing — there are no \r to strip — so the
// answer here is the same 0a32b566d4 the fix produced, not a third new value.
//
// The normalisation itself lives in line_endings.js and works ON THE BYTES, for
// reasons written up there: the obvious string round-trip mangles anything that
// is not legal UTF-8, and it did exactly that to a real fixture the same day.
// Here it would damage no file — this only hashes — but a hash taken over a
// mangled buffer is blind to every change inside the mangled run.

function computeEngineVersion(sk = SK) {
  const h = crypto.createHash('sha256');
  for (const name of engineFiles(sk)) {
    const p = path.join(sk, name);
    h.update(name + '\0');
    h.update(fs.existsSync(p) ? lfBytes(fs.readFileSync(p)) : Buffer.from('MISSING'));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 10);
}

// ---------------------------------------------------------------------------
// THE PLACE ENGINE, WHICH IS A DIFFERENT ENGINE (OA-168, 2026-08-30).
//
// A place map is drawn by two generators that live in the OTHER skill —
// `make-place-bus-leaflet/assets/gen_internal_place.js` and
// `gen_external_places.js` — and nothing in the town engine requires either, so
// neither is in the closure above. Yet until 2026-08-30 all 12 place maps carried
// the TOWN template hash, which is the state this file's header says the list
// exists to prevent.
//
// MEASURED, NOT INFERRED. OA-019's round three changed `gen_external_places.js` by
// 266 lines and moved ink on nine shipped sheets. `computeEngineVersion()` returned
// `30fbffe221` before the change and `30fbffe221` after it. Nothing was re-stamped.
// The only thing that noticed at all was `status.js`'s portal vendoring drift check
// — which says the portal is behind the skill and says nothing about the maps
// already delivered, the exact gap `track:engine` exists to close.
//
// WHY A SECOND HASH RATHER THAN A LONGER LIST. Adding the two place generators to
// ENGINE_FILES is a one-line change, and it would then report every TOWN map as
// having changed engine whenever a place generator moved — a false alarm on eight
// maps that nothing about them touched, and the same in reverse. Two templates say
// something true instead: a town map's stamp describes the code that drew a town
// map, and a place map's describes the code that drew a place map.
//
// A PLACE STAMP INCLUDES THE WHOLE TOWN CLOSURE, and that is not laziness. A
// place's internal sheet is drawn by `gen_internal.js` itself — `gen_internal_place.js`
// is a pre-stage that rewrites geometry into a workspace and then runs the
// UNMODIFIED town generator there — so a town-engine change really does move ink on
// a place sheet, and a place stamp that ignored it would be current and wrong in the
// other direction. The place entry points are hashed UNDER A `place/` PREFIX so a
// file of the same name in both folders cannot collide, and so the two halves of the
// answer stay distinguishable.
//
// PROVE IT CAN FAIL: change one byte in `gen_external_places.js` and watch the PLACE
// hash move and the TOWN hash not; change one byte in `gen_internal.js` and watch
// BOTH move. A hash that never moves for a file is indistinguishable from one that
// does not cover it, and that is exactly how this survived.
const PLACE_ENGINE_FILES = ['gen_internal_place.js', 'gen_external_places.js'];

/** Where the place skill's assets live, beside this skill. Overridable for tests. */
function placeAssetsDir(sk = SK) {
  return process.env.PLACE_SKILL_ASSETS || path.join(sk, '..', '..', 'make-place-bus-leaflet', 'assets');
}

/** The place entry points and their place-LOCAL siblings, sorted. Anything they
 * reach in the town skill is already in engineFiles() and is not repeated here. */
function placeEngineFiles(psk = placeAssetsDir()) {
  const seen = new Set();
  const queue = PLACE_ENGINE_FILES.slice();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const p = path.join(psk, name);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const re of DEP_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const dep = m[1].endsWith('.js') ? m[1] : m[1] + '.js';
        if (!seen.has(dep) && fs.existsSync(path.join(psk, dep))) queue.push(dep);
      }
    }
  }
  return [...seen].sort();
}

function computePlaceEngineVersion(sk = SK, psk = placeAssetsDir(sk)) {
  const h = crypto.createHash('sha256');
  for (const name of engineFiles(sk)) {
    const p = path.join(sk, name);
    h.update(name + '\0');
    h.update(fs.existsSync(p) ? lfBytes(fs.readFileSync(p)) : Buffer.from('MISSING'));
    h.update('\0');
  }
  for (const name of placeEngineFiles(psk)) {
    const p = path.join(psk, name);
    h.update('place/' + name + '\0');
    h.update(fs.existsSync(p) ? lfBytes(fs.readFileSync(p)) : Buffer.from('MISSING'));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 10);
}

/* isPlaceRun — which of the two templates a run directory belongs to. The rule is
 * the one gate_lib.js's findPlaces() already enumerates by: a place map sits under
 * a `Places` folder, in all three of its layouts (`Areas/<Town>/Places/<Place>`,
 * `Places/<Place>`, `Places/<Bucket>/<Place>`). Only stage.js needs to ask —
 * rollout.js and rollout_places.js each know which kind of map they are building. */
function isPlaceRun(dir) {
  return path.resolve(dir).split(/[\\/]+/).includes('Places');
}

// Surgical stamp — same approach as stage.js's syncVersionField: rewrite just
// the "engine" field so the rest of the file (and any diff against it) stays
// untouched. Adds the field if absent (appended, valid JSON either way).
function stampEngine(routesJsonPath, hash) {
  const raw = fs.readFileSync(routesJsonPath, 'utf8');
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { throw new Error(`${routesJsonPath} is not valid JSON — ${e.message}`); }
  const from = obj.engine;
  if (from === hash) return { status: 'ok', hash };
  let patched;
  if (from !== undefined) {
    patched = raw.replace(/"engine"(\s*):(\s*)"[^"]*"/, (mm, s1, s2) => `"engine"${s1}:${s2}${JSON.stringify(hash)}`);
  } else {
    // Insert right after the opening brace so it reads first, near "version".
    patched = raw.replace(/\{/, `{\n  "engine": ${JSON.stringify(hash)},`);
  }
  let ok = false;
  try { ok = JSON.parse(patched).engine === hash; } catch { ok = false; }
  fs.writeFileSync(routesJsonPath, ok ? patched : JSON.stringify({ ...obj, engine: hash }, null, 2) + '\n');
  return { status: from === undefined ? 'added' : 'updated', from, to: hash };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const stampIdx = args.indexOf('--stamp');
  // --place selects the PLACE template (OA-168). --stamp INFERS it from the path,
  // so a place's routes.json cannot be stamped with the town hash by forgetting a
  // flag; --place still forces it, which is what the falsification harness needs.
  const wantPlace = args.includes('--place') ||
    (stampIdx !== -1 && args[stampIdx + 1] ? isPlaceRun(path.dirname(path.resolve(args[stampIdx + 1]))) : false);
  const hash = wantPlace ? computePlaceEngineVersion() : computeEngineVersion();
  if (stampIdx !== -1) {
    const file = args[stampIdx + 1];
    if (!file) { console.error('engine_version.js: --stamp needs a routes.json path'); process.exit(1); }
    const r = stampEngine(path.resolve(file), hash);
    console.log(r.status === 'ok' ? `engine already current (${hash})` : `engine ${r.status}: ${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}`);
  } else {
    console.log(hash);
  }
}

module.exports = { computeEngineVersion, stampEngine, engineFiles, ENGINE_FILES,
  computePlaceEngineVersion, placeEngineFiles, placeAssetsDir, isPlaceRun, PLACE_ENGINE_FILES };
