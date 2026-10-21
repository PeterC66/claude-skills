/*
 * design_key_check.test.js — a routes.json design key that no engine file reads
 * (buses-data OA-652, the half of OA-632 it could not do for one generator).
 *
 * The quiet case is asked of every committed config in the fixture estate, towns
 * and places, so the check is seen quiet on real configs; the loud cases put the
 * mistake into one of them. A typo and a top-level key are the two shapes, and
 * each gets its own message.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./_engine');

const { designKeyWarnings, engineReadSet } = load('design_key_check.js');
const BUILDLOG = load('build_log.js');
const { buildSheets } = load('build_s4.js');
const ENGINE = load('engine_version.js');

const ESTATE = path.join(__dirname, 'fixtures', 'estate');
function configs(dir = ESTATE, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) configs(p, out);
    else if (e.name === 'routes.json') out.push(p);
  }
  return out;
}
const isPlace = p => p.split(path.sep).includes('Places');
const march = () => JSON.parse(fs.readFileSync(path.join(ESTATE, 'Areas', 'March', 'ci-reference', 'routes.json'), 'utf8'));

test('every committed fixture config, town and place, warns nothing', () => {
  const all = configs();
  assert.ok(all.length >= 8, `only ${all.length} fixture configs found, so this case proves little`);
  let keys = 0;
  for (const p of all) {
    const D = JSON.parse(fs.readFileSync(p, 'utf8'));
    keys += Object.keys(D.design || {}).length;
    assert.deepStrictEqual(designKeyWarnings(D, { place: isPlace(p) }), [], `${path.relative(ESTATE, p)} warned`);
  }
  assert.ok(keys > 20, `the fixtures carry only ${keys} design keys, so the quiet case asked almost nothing`);
});

test('a misspelt key and a top-level key under design both warn, each with its own remedy', () => {
  const D = march();
  D.design = Object.assign({}, D.design, { laneOrientaton: 'h', legendAt: { x: 12, y: 40 } });
  const w = designKeyWarnings(D);
  assert.strictEqual(w.length, 2, w.join('\n'));
  const typo = w.find(m => m.includes('laneOrientaton'));
  const up = w.find(m => m.includes('legendAt'));
  assert.ok(typo && /read by no engine file/.test(typo), `the typo's message: ${typo}`);
  assert.ok(up && /top-level routes\.json key; move it up/.test(up), `legendAt's message: ${up}`);
});

test('a top-level legendAt, and a note key beginning _, are not asked', () => {
  const D = march();
  D.legendAt = { x: 12, y: 40 };
  D.design = Object.assign({}, D.design, { _why: 'a note to the reader' });
  assert.deepStrictEqual(designKeyWarnings(D), []);
});

test('the read set is the whole engine, and a place reads the place engine too', () => {
  const town = engineReadSet();
  assert.ok(town.read.size > 25, `the town engine reads only ${town.read.size} design keys: the scan is not reaching it`);
  assert.ok(town.read.has('laneOrientation') && town.top.has('legendAt'));
  const place = engineReadSet({ place: true });
  for (const k of town.read) assert.ok(place.read.has(k), `the place set lost ${k}`);
});

test('every message files as a WARN entry of its own, never BLOCKING', () => {
  const D = march();
  D.design = Object.assign({}, D.design, { laneOrientaton: 'h', legendAt: {} });
  const msgs = designKeyWarnings(D);
  const entries = BUILDLOG.collect([{ source: 'design', stderr: msgs.join('\n'), ok: true }]);
  assert.strictEqual(entries.length, 2, 'build_log.js glued two messages into one entry');
  for (const e of entries) assert.strictEqual(e.severity, 'WARN', `classified ${e.severity}: ${e.text}`);
});

test('it stays outside every engine hash', () => {
  const hashed = [...ENGINE.engineFiles(), ...[].concat(ENGINE.placeEngineFiles() || [])].map(f => path.basename(String(f)));
  assert.ok(!hashed.includes('design_key_check.js'),
    'design_key_check.js joined the engine hash: every map now owes a re-stamp for a warning');
});

test('a build at either level files the check as WARN entries from source design, even when the sheet fails', () => {
  for (const level of ['area', 'place']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dkc-'));
    const routesJson = { town: 'Nowhere', design: { laneOrientaton: 'h' } };
    fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(routesJson));
    const r = buildSheets({ dir, level, routesJson, sheets: ['external'], write: false });
    const mine = r.warnings.filter(e => e.source === 'design');
    assert.strictEqual(mine.length, 1, `build_s4 did not file the design-key check at level ${level}`);
    assert.strictEqual(mine[0].severity, 'WARN');
    assert.ok(mine[0].text.includes('laneOrientaton'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
