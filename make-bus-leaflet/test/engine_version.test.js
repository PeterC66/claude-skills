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
const { computeEngineVersion, stampEngine, engineFiles, ENGINE_FILES } = require('./_engine.js').load('engine_version.js');
const { ENGINE_DIR } = require('./_engine.js');

const tmp = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engver-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const seed = (dir, overrides = {}) => {
  for (const f of ENGINE_FILES) fs.writeFileSync(path.join(dir, f), overrides[f] != null ? overrides[f] : `// ${f}\n`);
  return dir;
};

test('the ENTRY POINTS are the files every town build runs unmodified', () => {
  // lane_normals.js was added 2026-08-26 with design.laneOrientation. These five
  // are only where the walk STARTS; what gets hashed is their transitive closure.
  assert.deepStrictEqual(ENGINE_FILES,
    ['gen_internal.js', 'gen_external_radial.js', 'gen_external_busway.js', 'icons.js', 'lane_normals.js']);
});

test('the hash follows the requires, so an extracted module is inside it', () => {
  // The reason this test exists, measured 2026-08-27: with the flat list of five,
  // appending a line to services_panel.js or complexity_ladder.js did not move the
  // template hash at all — and nor did editing labeller.js, which was never on the
  // list. Ten extractions had moved most of the drawing code outside the thing
  // that is supposed to say which code drew a sheet.
  const files = engineFiles(ENGINE_DIR);
  for (const f of ENGINE_FILES) assert.ok(files.includes(f), f + ' is an entry point and must be hashed');
  for (const f of ['services_panel.js', 'complexity_ladder.js', 'projection.js', 'label_placer.js',
                   'linear_features.js', 'svg_primitives.js', 'fit_set.js', 'poi_select.js',
                   'strict_guards.js', 'labeller.js', 'footer.js', 'font_metrics.js', 'qr.js']) {
    assert.ok(files.includes(f), f + ' draws part of a sheet and is outside the engine hash');
  }
  assert.deepStrictEqual(files, [...files].sort(), 'the closure must be sorted, or the hash moves with require order');
});

test('a file nothing requires is not hashed, however much it looks like the engine', () => {
  // The closure is the point: quality_gate.js, status.js and the stage tools all
  // sit in assets/ and none of them draws anything, so a change to one of them
  // must not mark every town's sheet as built by a different engine.
  const files = engineFiles(ENGINE_DIR);
  for (const f of ['status.js', 'quality_gate.js', 'stage.js', 'render.js']) {
    assert.ok(!files.includes(f), f + ' is not part of what draws a sheet');
  }
});

test('every file in the closure moves the hash — none of them is decorative', () => tmp(dir => {
  fs.cpSync(ENGINE_DIR, dir, { recursive: true });
  const base = computeEngineVersion(dir);
  for (const f of engineFiles(dir)) {
    const p = path.join(dir, f);
    const was = fs.readFileSync(p);
    fs.writeFileSync(p, Buffer.concat([was, Buffer.from(' ')]));
    assert.notStrictEqual(computeEngineVersion(dir), base, `editing ${f} did not move the engine hash`);
    fs.writeFileSync(p, was);
  }
  assert.strictEqual(computeEngineVersion(dir), base, 'putting the files back did not restore the hash');
}));

test('a name only mentioned in a comment is not followed', () => {
  // Over-inclusion is the safe direction for a hash, but not this safe: a
  // filename in prose would drag a whole generator in and move the stamp for
  // every town whenever somebody edited a comment.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engver-'));
  try {
    for (const f of ENGINE_FILES) fs.writeFileSync(path.join(dir, f), '// ' + f + '\n');
    fs.writeFileSync(path.join(dir, 'decoy.js'), '// nothing requires this\n');
    fs.writeFileSync(path.join(dir, 'gen_internal.js'), '// see decoy.js for why\n');
    assert.ok(!engineFiles(dir).includes('decoy.js'),
      'a filename in prose pulled a whole file into the engine hash');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a required sibling that is not on disk is not hashed at all', () => {
  // Only an ENTRY POINT hashes as MISSING when it is absent. A require of
  // something that was never there is a broken build, and the portal's
  // requireScan() is the check that names it; this one is about not inventing
  // a row here and calling the engine changed because of it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engver-'));
  try {
    for (const f of ENGINE_FILES) fs.writeFileSync(path.join(dir, f), '// ' + f + '\n');
    fs.writeFileSync(path.join(dir, 'gen_internal.js'), "require(_dep('ghost.js'));" + '\n');
    assert.ok(!engineFiles(dir).includes('ghost.js'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
  // stream of contents-plus-delimiters — the NUL sits inside the first file in
  // one and at the end of the second in the other — so an engine that hashed only
  // the bytes would call them the same build. Hashing the name first is what makes
  // the record unambiguous, and this is the one property the swap test above
  // cannot see. (Found by test/prove-red.js: dropping the name from the hash
  // survived every other assertion in this file.)
  //
  // THE TWO FILES HAVE TO BE ADJACENT IN HASH ORDER, and that is why they are
  // named here rather than taken from ENGINE_FILES. The construction used
  // gen_internal.js and gen_external_radial.js while the hash walked the entry
  // points in declaration order; the closure sorts, which put another file
  // between them and made the two streams differ for a reason that had nothing to
  // do with names. The mutation then survived — a test that had been proving the
  // property stopped, silently, because a change elsewhere invalidated its setup.
  const NUL = '\u0000';   // a real NUL, written as an escape
  const [FIRST, SECOND] = [...ENGINE_FILES].sort();
  const hash = (o) => tmp(d => computeEngineVersion(seed(d, Object.assign(
    Object.fromEntries(ENGINE_FILES.map(f => [f, ''])), o))));
  assert.notStrictEqual(
    hash({ [FIRST]: 'A' + NUL + 'B' }),
    hash({ [FIRST]: 'A', [SECOND]: 'B' + NUL }));
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

test('CRLF and LF are the same engine, because the checkout is not the commit', () => tmp(dir => {
  // The hash used to be over raw bytes, so it answered a question about the
  // FILESYSTEM. With core.autocrlf=true and no .gitattributes, one commit of the
  // skills repo gave three answers on 2026-08-28: f83987f11b on the laptop's
  // historical mix of CRLF and LF files — the value stamped into all 20 maps —
  // 24ebbec148 in a fresh Windows clone, and 0a32b566d4 in an all-LF tree, which
  // is what Linux CI computes. 54 files under assets/ differed byte-for-byte
  // between the first two and none of them differed once \r was stripped. Every
  // town printed STALE in CI against character-for-character the code that drew
  // it, and CI stayed green only because status.js leaves engine staleness out of
  // its exit code.
  const lf = computeEngineVersion(seed(dir, { 'icons.js': 'const a = 1;\nconst b = 2;\n' }));
  const crlf = computeEngineVersion(seed(dir, { 'icons.js': 'const a = 1;\r\nconst b = 2;\r\n' }));
  assert.strictEqual(crlf, lf, 'the same source with different line endings must be the same engine');
}));

test('...and normalising line endings does not blind the hash to a real edit', () => tmp(dir => {
  // The other direction, which the test above cannot see on its own: a rule that
  // ignores \r must not ignore anything else.
  const base = computeEngineVersion(seed(dir, { 'icons.js': 'const a = 1;\r\n' }));
  assert.notStrictEqual(computeEngineVersion(seed(dir, { 'icons.js': 'const a = 2;\r\n' })), base,
    'an edit inside a CRLF file must still move the hash');

  // THE DISCRIMINATING PAIR, and the first version of this test did not have it.
  // It compared a CRLF file against a bare-CR one, which the correct rule and a
  // rule that strips EVERY \r both call DIFFERENT — so the assertion passed under
  // either and proved nothing. tools/prove-red.js is what said so: the mutation
  // 'a bare CR is stripped as well as a CRLF pair' SURVIVED. These two differ
  // under the correct rule (a lone \r survives, so they differ) and are IDENTICAL
  // under the greedy one, which is the only shape that can separate them.
  const pairA = computeEngineVersion(seed(dir, { 'icons.js': 'a\rb' }));
  const pairB = computeEngineVersion(seed(dir, { 'icons.js': 'ab' }));
  assert.notStrictEqual(pairA, pairB, 'a lone CR is content, not a line ending, and must survive the hash');
}));
