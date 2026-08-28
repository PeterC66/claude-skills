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
const DEP_PATTERNS = [
  /_dep\(\s*['"]([\w.-]+\.js)['"]\s*\)/g,                       // _dep('x.js')
  /path\.join\([^()]*?['"]([\w.-]+\.js)['"]\s*\)/g,             // path.join(<dir>, 'x.js')
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
// ON THE BYTES, not through a string. The first version of this decoded to a
// UTF-8 string, replaced, and re-encoded — which mangles any byte that is not
// legal UTF-8 into U+FFFD. The identical spelling in sync_ci_reference.js
// corrupted a real fixture the same day (March's atco2name_all.json holds a raw
// 0x92, the CP1252 right quote in "Ramsey St Mary's"). Here it would not damage
// a file, only the hash — but a hash computed over a mangled buffer is blind to
// every change inside the mangled run, which is the same fault wearing a quieter
// coat. Dropping only the CR of a CRLF PAIR is also the correct semantics: a
// lone CR is content, and test/engine_version.test.js pins both halves.
const stripCR = (buf) => {
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[n++] = buf[i];
  }
  return out.subarray(0, n);
};

function computeEngineVersion(sk = SK) {
  const h = crypto.createHash('sha256');
  for (const name of engineFiles(sk)) {
    const p = path.join(sk, name);
    h.update(name + '\0');
    h.update(fs.existsSync(p) ? stripCR(fs.readFileSync(p)) : Buffer.from('MISSING'));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 10);
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
  const hash = computeEngineVersion();
  const stampIdx = args.indexOf('--stamp');
  if (stampIdx !== -1) {
    const file = args[stampIdx + 1];
    if (!file) { console.error('engine_version.js: --stamp needs a routes.json path'); process.exit(1); }
    const r = stampEngine(path.resolve(file), hash);
    console.log(r.status === 'ok' ? `engine already current (${hash})` : `engine ${r.status}: ${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}`);
  } else {
    console.log(hash);
  }
}

module.exports = { computeEngineVersion, stampEngine, engineFiles, ENGINE_FILES };
