/*
 * via_build_check.test.js — S6's via-on-chain check asked at S4 (buses-data OA-650).
 *
 * Every case builds a map folder in the stage layout (<map>/manifest.json,
 * <map>/ci-reference/routes.json, <map>/S4-generate/<run>/) in a temp directory and
 * hands the check a register of its own, because the real NaPTAN register is
 * gitignored and CI's Node has no node:sqlite. The split under test is the design:
 * a via this build introduced is BLOCKING, one already on the published sheet is
 * WARN and names OA-636, and with no register nothing is said at all.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./_engine');

const { viaBuildCheck, mapDirOf } = load('via_build_check.js');
const BUILDLOG = load('build_log.js');
const { buildSheets } = load('build_s4.js');
const ENGINE = load('engine_version.js');

const LOC = { A1: 'Godmanchester', A2: 'Hemingford Grey', A3: 'St Ives' };
const KNOWN = new Set(['godmanchester', 'hemingford grey', 'st ives', 'ramsey', 'fenstanton']);
const register = {
  localitiesOf: a => (LOC[a] ? [LOC[a]] : []),
  isLocality: n => KNOWN.has(String(n).toLowerCase()),
};
const config = desc => ({
  routeOrder: ['9'],
  external: [{ route: '9', label: 'St Ives', stops: ['Hemingford Grey', 'St Ives'] }],
  internalDesc: { 9: ['St Ives', desc] },
});

// A map folder with `published` in ci-reference (or none) and `built` in an S4 run.
function mapWith({ published, built }) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'vbc-'));
  fs.writeFileSync(path.join(map, 'manifest.json'), '{}');
  if (published) {
    fs.mkdirSync(path.join(map, 'ci-reference'));
    fs.writeFileSync(path.join(map, 'ci-reference', 'routes.json'), JSON.stringify(published));
  }
  const dir = path.join(map, 'S4-generate', 'v1.0_2026-10-20_1200');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(built));
  fs.writeFileSync(path.join(dir, 'routes_full_atco.json'), JSON.stringify({ 9: { all: ['A1', 'A2', 'A3'] } }));
  return { map, dir, done: () => fs.rmSync(map, { recursive: true, force: true }) };
}
const severities = msgs => BUILDLOG.collect([{ source: 'via', stderr: msgs.join('\n'), ok: true }]).map(e => e.severity);

test('a config whose every via is on its chain says nothing', () => {
  const m = mapWith({ published: config('via Godmanchester'), built: config('via Godmanchester') });
  const r = viaBuildCheck({ dir: m.dir, register });
  assert.deepStrictEqual(r.messages, []);
  m.done();
});

test('a via this build introduced is BLOCKING and names the village', () => {
  const m = mapWith({ published: config('via Godmanchester'), built: config('via Ramsey') });
  const r = viaBuildCheck({ dir: m.dir, register });
  assert.strictEqual(r.fresh.length, 1);
  assert.strictEqual(r.shipped.length, 0);
  assert.match(r.messages[0], /Ramsey/);
  assert.deepStrictEqual(severities(r.messages), ['BLOCKING']);
  m.done();
});

test('a via already on the published sheet is WARN and names OA-636', () => {
  const m = mapWith({ published: config('via Ramsey'), built: config('via Ramsey') });
  const r = viaBuildCheck({ dir: m.dir, register });
  assert.strictEqual(r.fresh.length, 0);
  assert.strictEqual(r.shipped.length, 1);
  assert.match(r.messages[0], /OA-636/);
  assert.deepStrictEqual(severities(r.messages), ['WARN']);
  m.done();
});

test('the same village owed on the spoke is not new when it also reaches the Services text', () => {
  const pub = config('via Godmanchester');
  pub.external[0].stops = ['Ramsey', 'St Ives'];
  const built = config('via Ramsey');
  built.external[0].stops = ['Ramsey', 'St Ives'];
  const m = mapWith({ published: pub, built });
  const r = viaBuildCheck({ dir: m.dir, register });
  assert.strictEqual(r.fresh.length, 0, r.messages.join('\n'));
  assert.strictEqual(r.shipped.length, 2);
  m.done();
});

test('a map with nothing published yet blocks on every off-chain via', () => {
  const m = mapWith({ published: null, built: config('via Ramsey') });
  const r = viaBuildCheck({ dir: m.dir, register });
  assert.deepStrictEqual(severities(r.messages), ['BLOCKING']);
  m.done();
});

test('with no register nothing is said, and the reason is returned', () => {
  const m = mapWith({ published: null, built: config('via Ramsey') });
  const r = viaBuildCheck({ dir: m.dir, register: null });
  assert.deepStrictEqual(r.messages, []);
  assert.ok(r.notRun, 'a check that did not run returned no reason');
  m.done();
});

test('the map folder is found from the stage layout, and not from a folder outside one', () => {
  const m = mapWith({ published: null, built: config('via Godmanchester') });
  assert.strictEqual(mapDirOf(m.dir), path.resolve(m.map));
  assert.strictEqual(mapDirOf(os.tmpdir()), null);
  m.done();
});

test('a scratch build told its map folder compares with that map, as a rollout dry run does', () => {
  const m = mapWith({ published: config('via Ramsey'), built: config('via Ramsey') });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vbc-scratch-'));
  for (const f of ['routes.json', 'routes_full_atco.json']) fs.copyFileSync(path.join(m.dir, f), path.join(scratch, f));
  assert.strictEqual(viaBuildCheck({ dir: scratch, mapDir: m.map, register }).shipped.length, 1);
  assert.strictEqual(viaBuildCheck({ dir: scratch, register }).fresh.length, 1, 'with no map folder a via must count as new');
  fs.rmSync(scratch, { recursive: true, force: true });
  m.done();
});

test('build_s4 files a new via as a BLOCKING entry from source via, even with no sheet drawn', () => {
  const m = mapWith({ published: config('via Godmanchester'), built: config('via Ramsey') });
  const routesJson = JSON.parse(fs.readFileSync(path.join(m.dir, 'routes.json'), 'utf8'));
  const r = buildSheets({ dir: m.dir, level: 'area', routesJson, sheets: [], write: false, register });
  const mine = r.blockers.filter(e => e.source === 'via');
  assert.strictEqual(mine.length, 1, 'build_s4 did not file the via check as blocking');
  assert.match(mine[0].text, /Ramsey/);
  m.done();
});

test('it stays outside every engine hash', () => {
  const hashed = [...ENGINE.engineFiles(), ...[].concat(ENGINE.placeEngineFiles() || [])].map(f => path.basename(String(f)));
  for (const f of ['via_build_check.js', 'via_on_chain.js', 'build_log.js', 'build_s4.js']) {
    assert.ok(!hashed.includes(f), `${f} joined the engine hash: every map now owes a re-stamp for a build check`);
  }
});
