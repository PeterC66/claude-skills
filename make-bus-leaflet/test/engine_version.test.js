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
const { scratchDir } = require('../assets/scratch');

const tmp = (fn) => {
  const dir = scratchDir('engver-');
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const seed = (dir, overrides = {}) => {
  for (const f of ENGINE_FILES) fs.writeFileSync(path.join(dir, f), overrides[f] != null ? overrides[f] : `// ${f}\n`);
  return dir;
};

test('the ENTRY POINTS are the files every town build runs unmodified', () => {
  // lane_normals.js was added 2026-08-26 with design.laneOrientation. These five
  // are only where the walk STARTS; what gets hashed is their transitive closure.
  // diagram_internal.js and schematize_internal.js joined 2026-09-02 (OA-230): they
  // draw the schematic and diagram sheets the byte gate certifies, and a change to
  // either used to re-stamp nothing.
  // gen_external_busway.js left on 2026-09-02: dormant since St Ives moved to the
  // radial template, drawn by zero sheets, and unrunnable for a day without a
  // single gate noticing -- because nothing ran it.
  assert.deepStrictEqual(ENGINE_FILES,
    ['gen_internal.js', 'gen_external_radial.js', 'icons.js', 'lane_normals.js',
     'diagram_internal.js', 'schematize_internal.js']);
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
  const dir = scratchDir('engver-');
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
  const dir = scratchDir('engver-');
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

/* `{ commit: null }` ON THE THREE SURGICAL TESTS BELOW, and it is not a
 * convenience. Since OA-430 a bare stampEngine() asks the enclosing git
 * repository for the engine commit, so a test that does not name one is a test
 * whose expected BYTES depend on which checkout it runs in — green on a dirty
 * tree, red on a clean one, and nothing in the failure saying so. These three are
 * about the surgical rewrite; the commit half has its own tests under them. */
test('stamping an existing field rewrites only that field', () => tmp(dir => {
  const p = path.join(dir, 'routes.json');
  const before = '{\n  "engine": "0000000000",\n  "version": "2.1",\n  "design": { "printSafe": 5 }\n}\n';
  fs.writeFileSync(p, before);
  const r = stampEngine(p, 'abcdef1234', { commit: null });
  assert.strictEqual(r.status, 'updated');
  const after = fs.readFileSync(p, 'utf8');
  assert.strictEqual(JSON.parse(after).engine, 'abcdef1234');
  assert.strictEqual(after, before.replace('0000000000', 'abcdef1234'),
    'the stamp reformatted the file — every diff against it now shows changes nobody made');
}));

test('stamping adds the field when it is absent, and the file stays valid JSON', () => tmp(dir => {
  const p = path.join(dir, 'routes.json');
  fs.writeFileSync(p, '{\n  "version": "2.1"\n}\n');
  const r = stampEngine(p, 'abcdef1234', { commit: null });
  assert.strictEqual(r.status, 'added');
  const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(obj.engine, 'abcdef1234');
  assert.strictEqual(obj.version, '2.1', 'adding the stamp lost the rest of the file');
}));

test('re-stamping the same hash is a no-op and says so', () => tmp(dir => {
  const p = path.join(dir, 'routes.json');
  const text = '{\n  "engine": "abcdef1234",\n  "version": "2.1"\n}\n';
  fs.writeFileSync(p, text);
  assert.strictEqual(stampEngine(p, 'abcdef1234', { commit: null }).status, 'ok');
  assert.strictEqual(fs.readFileSync(p, 'utf8'), text, 'a no-op stamp still touched the bytes');
}));

/* ---- THE COMMIT HALF OF THE STAMP (buses-data OA-430) --------------------
 *
 * `engine` says whether a map is behind; `engineCommit` is what lets the board get
 * that engine back and ask whether the map's own committed sheets still reproduce
 * under it. The pair is a written claim about a join, so what is worth testing is
 * the rule that keeps it honest: the two fields move together or not at all. */
test('the commit is recorded beside the hash, and the hash reads first', () => tmp(dir => {
  const p = path.join(dir, 'routes.json');
  fs.writeFileSync(p, '{\n  "version": "2.1"\n}\n');
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const r = stampEngine(p, 'abcdef1234', { commit: sha });
  assert.strictEqual(r.commit, sha);
  const after = fs.readFileSync(p, 'utf8');
  const obj = JSON.parse(after);
  assert.strictEqual(obj.engine, 'abcdef1234');
  assert.strictEqual(obj.engineCommit, sha);
  assert.strictEqual(obj.version, '2.1', 'adding the pair lost the rest of the file');
  assert.ok(after.indexOf('"engine"') < after.indexOf('"engineCommit"'),
    'the hash is what a reader skims for, so it must not end up below the commit');
}));

test('a stamp that can name no commit REMOVES the old one rather than leaving it', () => tmp(dir => {
  // A new hash beside a stale commit is the lying pair engineDirForCommit()
  // exists to refuse — and it would be refused weeks later, about a map nobody is
  // looking at, with nothing left to say which stamp did it. A map carrying
  // `engine` and no `engineCommit` is what every map carried before OA-430, and
  // the board has an answer for that.
  const p = path.join(dir, 'routes.json');
  fs.writeFileSync(p, '{\n  "engine": "0000000000",\n  "engineCommit": "1111111111111111111111111111111111111111",\n  "version": "2.1"\n}\n');
  const r = stampEngine(p, 'abcdef1234', { commit: null, commitWhy: 'the closure was dirty' });
  assert.strictEqual(r.commitStatus, 'removed');
  const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(obj.engine, 'abcdef1234');
  assert.ok(!('engineCommit' in obj), 'the stale commit survived a stamp that could not vouch for it');
  assert.strictEqual(obj.version, '2.1');
}));

test('removing the commit leaves valid JSON whichever side of it the comma is on', () => tmp(dir => {
  // The removal has to take the comma with it, and which neighbour owns the comma
  // depends on where the field sits. Both arrangements, because a rule that
  // handles one and mangles the other produces a routes.json no generator can read
  // — and the mangling would land in a tracked ci-reference.
  for (const before of ['{\n  "engineCommit": "1111111111111111111111111111111111111111",\n  "engine": "0000000000"\n}\n',
                        '{\n  "engine": "0000000000",\n  "engineCommit": "1111111111111111111111111111111111111111"\n}\n']) {
    const p = path.join(dir, 'routes.json');
    fs.writeFileSync(p, before);
    stampEngine(p, 'abcdef1234', { commit: null });
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));   // throws if a comma was left behind
    assert.strictEqual(obj.engine, 'abcdef1234');
    assert.ok(!('engineCommit' in obj));
  }
}));

test('engineCommitNow names no commit for a tree that is in no repository', () => tmp(dir => {
  // The whole value of the field is that checking the commit out gets the engine
  // back. A directory in no git repository cannot support that claim, and neither
  // can a dirty closure; both are an ABSENCE of the field rather than a guess.
  // Through _engine.js like every other subject, so a prove-red scratch copy is
  // what runs — engine_indirection.test.js is the census that enforces it.
  const { engineCommitNow } = require('./_engine.js').load('engine_commit.js');
  const r = engineCommitNow(seed(dir, { 'icons.js': 'const a = 1;\n' }));
  assert.ok(!r.commit, 'a directory in no git repository was given a commit anyway');
  assert.match(r.why, /no git repository/);
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

/* ---- the PLACE template (OA-168, 2026-08-30) ------------------------------ */

const EV = require('./_engine.js').load('engine_version.js');

const seedPlace = (dir, overrides = {}) => {
  for (const f of EV.PLACE_ENGINE_FILES) {
    fs.writeFileSync(path.join(dir, f), overrides[f] != null ? overrides[f] : `// ${f}\n`);
  }
  return dir;
};
const twoDirs = (fn) => tmp(root => {
  const town = fs.mkdirSync(path.join(root, 'town'), { recursive: true }) || path.join(root, 'town');
  const place = fs.mkdirSync(path.join(root, 'place'), { recursive: true }) || path.join(root, 'place');
  return fn(town, place);
});

test('a place map has its own template, and it is not the town one', () => twoDirs((town, place) => {
  seed(town); seedPlace(place);
  assert.notStrictEqual(EV.computePlaceEngineVersion(town, place), computeEngineVersion(town),
    'two templates that agree are one template with extra steps');
}));

test('THE FAULT THIS ROW RECORDS: a place-generator change must move the PLACE hash and NOT the town one', () => twoDirs((town, place) => {
  // Measured on the real engine 2026-08-29: OA-019 round three changed
  // gen_external_places.js by 266 lines and moved ink on nine shipped sheets, and
  // computeEngineVersion() returned 30fbffe221 before and after. All 12 place maps
  // went on reading `current`.
  seed(town); seedPlace(place);
  const t0 = computeEngineVersion(town), p0 = EV.computePlaceEngineVersion(town, place);
  seedPlace(place, { 'gen_external_places.js': '// gen_external_places.js\n// one more line\n' });
  assert.strictEqual(computeEngineVersion(town), t0, 'a place generator is not part of the TOWN engine');
  assert.notStrictEqual(EV.computePlaceEngineVersion(town, place), p0, 'and it IS part of the place engine');
}));

test('...and a town-engine change moves BOTH, because gen_internal.js draws a place sheet too', () => twoDirs((town, place) => {
  // gen_internal_place.js is a pre-stage: it rewrites geometry into a workspace and
  // runs the UNMODIFIED town generator there. A place stamp that ignored the town
  // closure would be current and wrong in the other direction.
  seed(town); seedPlace(place);
  const t0 = computeEngineVersion(town), p0 = EV.computePlaceEngineVersion(town, place);
  seed(town, { 'gen_internal.js': '// gen_internal.js\n// one more line\n' });
  assert.notStrictEqual(computeEngineVersion(town), t0);
  assert.notStrictEqual(EV.computePlaceEngineVersion(town, place), p0);
}));

test('the place walk follows requires, so a shared place module is hashed too', () => twoDirs((town, place) => {
  // The place entry points reach almost everything through the TOWN skill today, so
  // this branch is dark on the real tree — which is exactly why it is tested here
  // rather than trusted. A place-local helper extracted out of gen_external_places.js
  // would otherwise sit outside the place hash from the day it was written, which is
  // the fault this whole row is about, one level down.
  seed(town);
  seedPlace(place, { 'gen_external_places.js': "const H = require('./place_helper.js');\n" });
  fs.writeFileSync(path.join(place, 'place_helper.js'), '// v1\n');
  const before = EV.computePlaceEngineVersion(town, place);
  assert.ok(EV.placeEngineFiles(place).includes('place_helper.js'),
    'a required place-local sibling must be in the place closure');
  fs.writeFileSync(path.join(place, 'place_helper.js'), '// v2\n');
  assert.notStrictEqual(EV.computePlaceEngineVersion(town, place), before,
    'and editing it must move the place hash');
}));

/* The `place/` prefix on the place half is deliberate and is NOT asserted here.
 * It was, briefly, with a mutation that dropped it — and that mutation SURVIVED.
 * The two halves are hashed in a fixed order, so a filename appearing in both trees
 * is already disambiguated by its position in the stream, and removing the prefix
 * loses no information that any fixture can expose. The prefix stays because it
 * makes the inputs readable when something prints them; the claim that it prevents
 * a collision does not, because nothing could break it. A defence that cannot be
 * falsified is a defence that was not doing anything, and asserting it would have
 * been a green this suite had not earned. */

test('a missing place generator hashes as MISSING rather than vanishing', () => twoDirs((town, place) => {
  seed(town); seedPlace(place);
  const before = EV.computePlaceEngineVersion(town, place);
  fs.rmSync(path.join(place, 'gen_external_places.js'));
  assert.notStrictEqual(EV.computePlaceEngineVersion(town, place), before,
    'a partial vendor must be a different engine, not the same one');
}));

test('isPlaceRun follows the rule findPlaces() already enumerates by', () => {
  // All three layouts a place is stored in, and a town, which must not match.
  assert.strictEqual(EV.isPlaceRun('C:/x/Buses/Areas/St Ives/Places/St Ives Bus Station/S4-generate/v1.1'), true);
  assert.strictEqual(EV.isPlaceRun('C:/x/Buses/Places/Ely Co-op/S4-generate/v1.1'), true);
  assert.strictEqual(EV.isPlaceRun('C:/x/Buses/Places/_standalone/Ely Co-op/S4-generate/v1.1'), true);
  assert.strictEqual(EV.isPlaceRun('C:/x/Buses/Areas/St Ives/S4-generate/v6.58'), false);
  // A folder whose NAME merely contains the word is not a Places folder.
  assert.strictEqual(EV.isPlaceRun('C:/x/Buses/Areas/Placesville/S4-generate/v1.1'), false);
});

test('dash_fit.js is inside the hashed closure, whichever idiom names it', () => {
  const files = engineFiles();
  assert.ok(files.includes('dash_fit.js'),
    'a hash that does not cover dash_fit.js cannot see a change to the dashed-spoke pattern');
});

test('EVERY require idiom is followed, asserted on a fixture and not on the estate', () => tmp(dir => {
  /* THIS TEST REPLACED ONE THAT WAS RIGHT BY ACCIDENT, TWICE OVER.
   *
   * The scanner's `path.join` pattern could not cross a nested `(` until
   * 2026-08-30, which made it blind to `path.join(path.dirname(_LABELLER),
   * 'x.js')` — the idiom the two external generators actually used. It went
   * unnoticed because every file named that way was ALSO reached from
   * gen_internal.js by a luckier route, until dash_fit.js was named ONLY that
   * way and sat outside the hash. The test written that day pinned the nested
   * pattern THROUGH dash_fit.js: it asserted the closure contained it, and the
   * mutation that reverted the pattern turned it red.
   *
   * OA-224 Tier 3.4 then replaced that idiom with `_from('dash_fit.js')` — and
   * the mutation SURVIVED, because dash_fit.js was now reached another way. The
   * pattern was still needed (the place engine's clone still uses it) and
   * nothing was left holding it. A scanner asserted through whatever the estate
   * happens to write is a scanner that stops being asserted the day the estate
   * writes something else, so this asserts each idiom against a source file
   * written for the purpose. It is the same lesson as the module's own header:
   * a scanner is proved by a name only it can find.
   */
  const IDIOMS = {
    'a.js': "require(_dep('a.js'))",
    'b.js': "require(_from('b.js'))",
    'c.js': "require(path.join(__dirname, 'c.js'))",
    'd.js': "require(path.join(path.dirname(_LABELLER), 'd.js'))",
    'e.js': "require('./e')",
    'f.js': "require(path.join(process.env.SKILL_ASSETS, 'f.js'))",
  };
  seed(dir);
  fs.writeFileSync(path.join(dir, 'gen_internal.js'), Object.values(IDIOMS).join('\n') + '\n');
  for (const name of Object.keys(IDIOMS)) fs.writeFileSync(path.join(dir, name), '// ' + name + '\n');
  const found = engineFiles(dir);
  for (const [name, how] of Object.entries(IDIOMS)) {
    assert.ok(found.includes(name), name + ' is not followed: ' + how);
  }
}));

/* ---- the BOARDING half of the place template (OA-230, 2026-09-02) ---------- */

test('THE FAULT OA-230 RECORDS: a boarding-generator change must move the PLACE hash and NOT the town one', () => twoDirs((town, place) => {
  // changing-the-engine.md measured it on 2026-08-29: a stderr line added to
  // gen_boarding.js re-stamped no map and track:engine reported nothing behind,
  // because the file was outside both hashes.
  seed(town); seedPlace(place);
  fs.writeFileSync(path.join(town, 'gen_boarding.js'), '// gen_boarding.js\n');
  const t0 = computeEngineVersion(town), p0 = EV.computePlaceEngineVersion(town, place);
  fs.writeFileSync(path.join(town, 'gen_boarding.js'), '// gen_boarding.js\n// one more line\n');
  assert.strictEqual(computeEngineVersion(town), t0, 'the boarding generator is not part of the TOWN engine');
  assert.notStrictEqual(EV.computePlaceEngineVersion(town, place), p0, 'and it IS part of the place engine');
}));

test('the boarding closure is what gen_boarding.js ALONE reaches — a town file is hashed once, as itself', () => twoDirs((town, place) => {
  seed(town, { 'gen_internal.js': "require(_dep('footer.js'));\n" });
  fs.writeFileSync(path.join(town, 'footer.js'), '// footer.js\n');
  fs.writeFileSync(path.join(town, 'boarding_only.js'), '// boarding_only.js\n');
  fs.writeFileSync(path.join(town, 'gen_boarding.js'), "require(_dep('footer.js')); require(_dep('boarding_only.js'));\n");
  assert.deepStrictEqual(EV.boardingEngineFiles(town), ['boarding_only.js', 'gen_boarding.js']);
  assert.ok(engineFiles(town).includes('footer.js'), 'footer.js is hashed in the town half');
}));

test('a pre-stage change moves the TOWN hash (OA-230): the diagram a town serves was drawn by this code', () => tmp(dir => {
  const base = computeEngineVersion(seed(dir));
  fs.writeFileSync(path.join(dir, 'diagram_internal.js'), '// diagram_internal.js\n// one more line\n');
  assert.notStrictEqual(computeEngineVersion(dir), base);
}));

test('on the real engine: gen_boarding.js is in the boarding half and its shared modules are not repeated there', () => {
  const b = EV.boardingEngineFiles(ENGINE_DIR);
  assert.ok(b.includes('gen_boarding.js'));
  for (const f of ['footer.js', 'strict_guards.js', 'svg_primitives.js', 'page.js']) {
    assert.ok(!b.includes(f), f + ' is in the town closure and must not be hashed twice');
  }
  assert.ok(!engineFiles(ENGINE_DIR).includes('gen_boarding.js'), 'a boarding change must not re-stamp every town');
});

// ---------------------------------------------------------------------------
// A BAD `sk` USED TO ANSWER, AND THE ANSWER LOOKED REAL (2026-09-18).
//
// computeEngineVersion takes a DIRECTORY. Hand it the NAME of an engine kind —
// which is the reading the parameter name `sk` invites, and this engine really
// does have three kinds — and nothing threw: every closure name was absent,
// each hashed as MISSING, and the function returned an ordinary ten-character
// hash. `computeEngineVersion('internal')` and `computeEngineVersion('C:/no/such/dir')`
// were EQUAL, and OA-310's 2026-09-14 section quotes that equality as evidence
// that two engines agreed. They did agree — re-measured with real directories
// the same morning — but the pair could not have told agreement from two reads
// of nothing, and a second reader of that paragraph repeated the mistake within
// the hour. These four tests are the instrument, not the conclusion.
test('a `sk` that is not a directory is refused, rather than hashed as 28 missing files', () => {
  assert.throws(() => computeEngineVersion('internal'), /not a directory/,
    'the NAME of an engine kind is not a path, and must not produce a hash');
  assert.throws(() => computeEngineVersion(path.join(os.tmpdir(), 'no-such-engine-dir-9f3a2b')), /not a directory/);
  assert.throws(() => computeEngineVersion(''), TypeError);
  assert.throws(() => computeEngineVersion(null), TypeError);
});

test('two bad paths no longer agree with each other, which is the whole fault', () => {
  // The shape this fixes: both calls returned the same hash, and a reader
  // concluded the engines matched. Now neither call returns anything at all.
  for (const bad of ['internal', 'external', 'place']) {
    assert.throws(() => computeEngineVersion(bad), /not a directory/, `${bad} must not answer`);
  }
});

test('a real directory that is not an engine is refused too', () => tmp(dir => {
  // The subtler half: the path exists, so an existence check alone would pass
  // it, and every entry point is still absent. A file that is not an entry
  // point does not make a folder an engine.
  fs.writeFileSync(path.join(dir, 'README.md'), '# not an engine\n');
  assert.throws(() => computeEngineVersion(dir), /holds none of the entry points/);
  assert.throws(() => engineFiles(dir), /holds none of the entry points/);
}));

test('an engine that has DROPPED a file still hashes, because MISSING is the point', () => tmp(dir => {
  // The guard must not swallow the case it was built around: a checkout whose
  // engine has lost a module is a real engine in a state the stamp has to keep
  // describing. One entry point present is enough to make it an engine.
  const base = computeEngineVersion(seed(dir));
  fs.rmSync(path.join(dir, 'lane_normals.js'));
  const gone = computeEngineVersion(dir);
  assert.notStrictEqual(gone, base, 'dropping an entry point must move the hash');
  assert.match(gone, /^[0-9a-f]{10}$/, 'and it must still be an ordinary hash');
  assert.ok(engineFiles(dir).includes('gen_internal.js'));
}));

test('the PLACE half stays lenient when the place skill is not beside the town one', () => {
  // THE CONTROL THIS COMMIT NEEDED, and it was CI that supplied it. The first
  // version of the guard above asked the same question of placeEngineFiles(),
  // and turned two prove-red harnesses red: prove-red-held-back and the cli.js
  // closure test both copy the town skill's assets/ ALONE into a scratch
  // directory and run the engine there, so placeAssetsDir() resolves to a
  // sibling make-place-bus-leaflet/assets that is genuinely not on disk. That
  // is a real configuration, not a caller error, and the place half has always
  // hashed it as two MISSING entry points. It must go on doing so.
  const nowhere = path.join(os.tmpdir(), 'no-such-place-assets-4c1e7d');
  assert.ok(!fs.existsSync(nowhere), 'the premise: this directory must not exist');
  const hash = EV.computePlaceEngineVersion(ENGINE_DIR, nowhere);
  assert.match(hash, /^[0-9a-f]{10}$/, 'a town engine with no place skill beside it still has a place hash');
  assert.deepStrictEqual(EV.placeEngineFiles(nowhere), [...EV.PLACE_ENGINE_FILES].sort(),
    'the two place entry points are still named, and hashed as MISSING');
  // Only asked where a real place skill is actually beside this engine. Under
  // prove-red it is NOT — the harness copies assets/ alone into scratch — and
  // asserting it unconditionally made this very test fail there, which is the
  // same mistake one layer up: a premise that holds on the laptop and not in
  // the place the check really runs.
  if (fs.existsSync(EV.placeAssetsDir(ENGINE_DIR))) {
    assert.notStrictEqual(hash, EV.computePlaceEngineVersion(ENGINE_DIR),
      'and it is not the same answer as a real place skill, which is the whole point of MISSING');
  }
});
