#!/usr/bin/env node
/*
 * engine_version.js — content-hash the engine (the files every town's S4 build
 * runs unmodified: gen_internal.js, gen_external_radial.js,
 * gen_external_busway.js, icons.js), for item 3 of the 2026-08-04
 * process-efficiency plan.
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
const ENGINE_FILES = ['gen_internal.js', 'gen_external_radial.js', 'gen_external_busway.js', 'icons.js'];

function computeEngineVersion(sk = SK) {
  const h = crypto.createHash('sha256');
  for (const name of ENGINE_FILES) {
    const p = path.join(sk, name);
    h.update(name + '\0');
    h.update(fs.existsSync(p) ? fs.readFileSync(p) : Buffer.from('MISSING'));
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

module.exports = { computeEngineVersion, stampEngine, ENGINE_FILES };
