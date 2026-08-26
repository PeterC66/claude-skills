/*
 * engine_version.js — the hash that records WHICH engine build drew a town.
 *
 * It is the only thing standing between "this map was built by the current
 * engine" and "this map was built by something, once". A stamp can be current
 * and wrong: this project has already had 47/47 sheets pass a gate whose hash
 * excluded the very field the gate was reporting on. So these tests check that
 * the hash MOVES when the engine moves — a hash that cannot change is a
 * provenance field that means nothing — and that stamping is reversible and
 * surgical, because a stamp that rewrites the file is a byte gate that reds for
 * a reason nobody can see.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { computeEngineVersion, stampEngine, ENGINE_FILES } = require('./_engine.js').load('engine_version.js');

const tmp = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engver-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const seed = (dir, overrides = {}) => {
  for (const f of ENGINE_FILES) fs.writeFileSync(path.join(dir, f), overrides[f] != null ? overrides[f] : `// ${f}\n`);
  return dir;
};

test('the hashed files are the ones every town build runs unmodified', () => {
  // lane_normals.js was added 2026-08-26 with design.laneOrientation. A file
  // that decides where a lane is drawn and is not in this list would let the
  // engine change while the stamp stayed put.
  assert.deepStrictEqual(ENGINE_FILES,
    ['gen_internal.js', 'gen_external_radial.js', 'gen_external_busway.js', 'icons.js', 'lane_normals.js']);
});

test('the same tree hashes the same, twice', () => tmp(dir => {
  seed(dir);
  assert.strictEqual(computeEngineVersion(dir), computeEngineVersion(dir));
}));

test('a one-byte change to any hashed file changes the hash', () => tmp(dir => {
  const base = computeEngineVersion(seed(dir));
  for (const f of ENGINE_FILES) {
    const p = path.join(dir, f);
    const was = fs.readFileSync(p);
    fs.writeFileSync(p, was + ' ');
    assert.notStrictEqual(computeEngineVersion(dir), base, `editing ${f} did not move the engine hash`);
    fs.writeFileSync(p, was);
  }
  assert.strictEqual(computeEngineVersion(dir), base, 'putting the files back did not restore the hash');
}));

test('moving content between two files changes the hash', () => tmp(dir => {
  // A helper cut from one generator and pasted into another is a different
  // engine even though the estate's total bytes are unchanged.
  const a = computeEngineVersion(seed(dir, { 'icons.js': 'AB', 'gen_internal.js': '' }));
  const b = computeEngineVersion(seed(dir, { 'icons.js': '', 'gen_internal.js': 'AB' }));
  assert.notStrictEqual(a, b);
}));

test('the file NAME is hashed, so the NUL delimiter cannot be forged', () => {
  // The separator alone is not enough. These two trees produce a byte-identical
  // stream of contents-plus-delimiters — the NUL sits inside gen_internal.js in
  // one and at the end of gen_external_radial.js in the other — so an engine that
  // hashed only the bytes would call them the same build. Hashing the name first
  // is what makes the record unambiguous, and this is the one property the swap
  // test above cannot see. (Found by test/prove-red.js: dropping the name from
  // the hash survived every other assertion in this file.)
  const NUL = '\u0000';   // a real NUL, written as an escape
  const hash = (o) => tmp(d => computeEngineVersion(seed(d, Object.assign(
    Object.fromEntries(ENGINE_FILES.map(f => [f, ''])), o))));
  assert.notStrictEqual(
    hash({ 'gen_internal.js': 'A' + NUL + 'B' }),
    hash({ 'gen_internal.js': 'A', 'gen_external_radial.js': 'B' + NUL }));
});

test('a missing file is not the same as an empty one', () => tmp(dir => {
  const empty = computeEngineVersion(seed(dir, { 'icons.js': '' }));
  fs.rmSync(path.join(dir, 'icons.js'));
  assert.notStrictEqual(computeEngineVersion(dir), empty,
    'an absent generator hashed identically to a present but empty one');
}));

test('stamping an existing field rewrites only that field', () => tmp(dir => {
  const p = path.join(dir, 'routes.json');
  const before = '{\n  "engine": "0000000000",\n  "version": "2.1",\n  "design": { "printSafe": 5 }\n}\n';
  fs.writeFileSync(p, before);
  const r = stampEngine(p, 'abcdef1234');
  assert.strictEqual(r.status, 'updated');
  const after = fs.readFileSync(p, 'utf8');
  assert.strictEqual(JSON.parse(after).engine, 'abcdef1234');
  assert.strictEqual(after, before.replace('0000000000', 'abcdef1234'),
    'the stamp reformatted the file — every diff against it now shows changes nobody made');
}));

test('stamping adds the field when it is absent, and the file stays valid JSON', () => tmp(dir => {
  const p = path.join(dir, 'routes.json');
  fs.writeFileSync(p, '{\n  "version": "2.1"\n}\n');
  const r = stampEngine(p, 'abcdef1234');
  assert.strictEqual(r.status, 'added');
  const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(obj.engine, 'abcdef1234');
  assert.strictEqual(obj.version, '2.1', 'adding the stamp lost the rest of the file');
}));

test('re-stamping the same hash is a no-op and says so', () => tmp(dir => {
  const p = path.join(dir, 'routes.json');
  const text = '{\n  "engine": "abcdef1234",\n  "version": "2.1"\n}\n';
  fs.writeFileSync(p, text);
  assert.strictEqual(stampEngine(p, 'abcdef1234').status, 'ok');
  assert.strictEqual(fs.readFileSync(p, 'utf8'), text, 'a no-op stamp still touched the bytes');
}));

test('stamping refuses a file that is not JSON, rather than writing over it', () => tmp(dir => {
  const p = path.join(dir, 'routes.json');
  fs.writeFileSync(p, 'not json at all');
  assert.throws(() => stampEngine(p, 'abcdef1234'), /not valid JSON/);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'not json at all');
}));
