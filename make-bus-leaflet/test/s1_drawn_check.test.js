/*
 * s1_drawn_check.test.js — every S1 service has a home on the sheet, asked at S4
 * (buses-data OA-655).
 *
 * Every case builds a map folder in the stage layout (<map>/manifest.json naming the
 * S1, S3 and S4 runs, <map>/S1-services/<run>/verified-services.json,
 * <map>/ci-reference/routes.json, <map>/S4-generate/<run>/routes.json) in a temp
 * directory. The split under test is the design: a gap this build made is BLOCKING,
 * one the published sheet already shipped is WARN, and with no manifest nothing is
 * said at all.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./_engine');

const { s1DrawnCheck, publishedS1Id } = load('s1_drawn_check.js');
const BUILDLOG = load('build_log.js');
const { buildSheets } = load('build_s4.js');

const svc = (route, extra = {}) => ({ route, servesTown: true, status: 'live', ...extra });

// A map whose published build came from S1 run `old` and whose newest S1 is `now`.
function mapWith({ old = null, now, published, built, file = 'verified-services.json', chain = true }) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 's1dc-'));
  const runs = [];
  for (const [id, body] of [['2026-10-01_0900', old], ['2026-10-20_0900', now]]) {
    if (!body) continue;
    const dir = path.join('S1-services', id);
    fs.mkdirSync(path.join(map, dir), { recursive: true });
    fs.writeFileSync(path.join(map, dir, file), JSON.stringify(body));
    runs.push({ id, dir });
  }
  const pubS1 = old ? '2026-10-01_0900' : '2026-10-20_0900';
  const manifest = { stages: {
    S1: { latest: runs[runs.length - 1].id, runs },
    S3: { latest: 's3a', runs: [{ id: 's3a', dir: 'S3-config/s3a', ...(chain ? { basedOn: { S1: pubS1 } } : {}) }] },
    S4: { latest: 'v1.0', runs: [{ id: 'v1.0', dir: 'S4-generate/v1.0', basedOn: { S3: 's3a' } }] },
  } };
  fs.writeFileSync(path.join(map, 'manifest.json'), JSON.stringify(manifest));
  if (published) {
    fs.mkdirSync(path.join(map, 'ci-reference'));
    fs.writeFileSync(path.join(map, 'ci-reference', 'routes.json'), JSON.stringify(published));
  }
  const dir = path.join(map, 'S4-generate', 'v1.1_2026-10-21_0900');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(built));
  return { map, dir, done: () => fs.rmSync(map, { recursive: true, force: true }) };
}
const severities = msgs => BUILDLOG.collect([{ source: 's1', stderr: msgs.join('\n'), ok: true }]).map(e => e.severity);

test('a config that gives every S1 service a home says nothing', () => {
  const v = { services: [svc('9'), svc('66'), svc('X1')], notOnLeaflet: [{ route: '400', note: 'school' }] };
  v.services.push(svc('400'));
  const rj = { routeOrder: ['9'], panelOrder: ['9', '66'], notShown: ['X1'] };
  const m = mapWith({ now: v, published: rj, built: rj });
  const r = s1DrawnCheck({ dir: m.dir });
  assert.deepStrictEqual(r.messages, [], r.messages.join('\n'));
  assert.strictEqual(r.notRun, null);
  m.done();
});

test('a service S1 gained since the published build, and S3 never drew, is BLOCKING — Huntingdon\'s X1', () => {
  const rj = { routeOrder: ['9', '66'] };
  const m = mapWith({ old: { services: [svc('9'), svc('66')] },
    now: { services: [svc('9'), svc('66'), svc('X1', { hasGtfsShape: false, notInBods: { why: 'not in the feed' } })] },
    published: rj, built: rj });
  const r = s1DrawnCheck({ dir: m.dir });
  assert.strictEqual(r.fresh.length, 1);
  assert.strictEqual(r.shipped.length, 0);
  assert.match(r.messages[0], /route X1/);
  assert.deepStrictEqual(severities(r.messages), ['BLOCKING']);
  m.done();
});

test('a service the published sheet carried and this build dropped is BLOCKING', () => {
  const v = { services: [svc('9'), svc('66')] };
  const m = mapWith({ old: v, now: v, published: { routeOrder: ['9', '66'] }, built: { routeOrder: ['9'] } });
  const r = s1DrawnCheck({ dir: m.dir });
  assert.deepStrictEqual(r.fresh.map(s => s.route), ['66']);
  assert.deepStrictEqual(severities(r.messages), ['BLOCKING']);
  m.done();
});

test('a gap the published build already shipped from the same S1 entry is WARN and names OA-655', () => {
  const v = { services: [svc('9'), svc('DIAL-A-RIDE', { hasGtfsShape: false })] };
  const rj = { routeOrder: ['9'] };
  const m = mapWith({ old: v, now: v, published: rj, built: rj });
  const r = s1DrawnCheck({ dir: m.dir });
  assert.strictEqual(r.fresh.length, 0);
  assert.deepStrictEqual(r.shipped.map(s => s.route), ['DIAL-A-RIDE']);
  assert.match(r.messages[0], /OA-655/);
  assert.deepStrictEqual(severities(r.messages), ['WARN']);
  m.done();
});

test('with the S1 chain broken, the published routes.json alone is the baseline', () => {
  const rj = { routeOrder: ['9'] };
  const m = mapWith({ now: { services: [svc('9'), svc('18A')] }, published: rj, built: rj, chain: false });
  const r = s1DrawnCheck({ dir: m.dir });
  assert.strictEqual(r.fresh.length, 0);
  assert.strictEqual(r.shipped.length, 1);
  m.done();
});

test('a map with nothing published blocks on every service with no home', () => {
  const m = mapWith({ now: { services: [svc('9'), svc('66')] }, published: null, built: { routeOrder: ['9'] } });
  assert.deepStrictEqual(severities(s1DrawnCheck({ dir: m.dir }).messages), ['BLOCKING']);
  m.done();
});

test('servesTown:false and drawn:false need no home; hasGtfsShape:false still does', () => {
  const v = { services: [svc('9'), svc('X46', { servesTown: false }), svc('TIGER', { drawn: false }), svc('RH3', { hasGtfsShape: false })] };
  const m = mapWith({ now: v, published: null, built: { routeOrder: ['9'] } });
  assert.deepStrictEqual(s1DrawnCheck({ dir: m.dir }).fresh.map(s => s.route), ['RH3']);
  m.done();
});

test('a place reads gtfs-services.json, and its notOnLeaflet[] lives in routes.json', () => {
  const rj = { routeOrder: ['A'], notOnLeaflet: [{ route: '101', note: 'seasonal' }] };
  const m = mapWith({ now: { services: [svc('A'), svc('101'), svc('604')] }, published: null, built: rj, file: 'gtfs-services.json' });
  assert.deepStrictEqual(s1DrawnCheck({ dir: m.dir }).fresh.map(s => s.route), ['604']);
  m.done();
});

test('a service is matched by its key where it has one', () => {
  const v = { services: [svc('9', { key: '9-day' }), svc('9', { key: '9-night' })] };
  const m = mapWith({ now: v, published: null, built: { routeOrder: ['9-day'] } });
  assert.deepStrictEqual(s1DrawnCheck({ dir: m.dir }).fresh.map(s => s.key), ['9-night']);
  m.done();
});

test('with no map folder or no S1 file nothing is said, and the reason is returned', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 's1dc-scratch-'));
  fs.writeFileSync(path.join(scratch, 'routes.json'), JSON.stringify({ routeOrder: [] }));
  const r = s1DrawnCheck({ dir: scratch });
  assert.deepStrictEqual(r.messages, []);
  assert.ok(r.notRun, 'a check that did not run returned no reason');
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('a scratch build told its map folder compares with that map, as a rollout dry run does', () => {
  const v = { services: [svc('9'), svc('18A')] };
  const rj = { routeOrder: ['9'] };
  const m = mapWith({ old: v, now: v, published: rj, built: rj });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 's1dc-scratch-'));
  fs.copyFileSync(path.join(m.dir, 'routes.json'), path.join(scratch, 'routes.json'));
  assert.strictEqual(s1DrawnCheck({ dir: scratch, mapDir: m.map }).shipped.length, 1);
  fs.rmSync(scratch, { recursive: true, force: true });
  m.done();
});

test('the published S1 is found through S4 latest, its S3, and that S3\'s S1', () => {
  const v = { services: [svc('9')] };
  const m = mapWith({ old: v, now: v, published: { routeOrder: ['9'] }, built: { routeOrder: ['9'] } });
  const manifest = JSON.parse(fs.readFileSync(path.join(m.map, 'manifest.json'), 'utf8'));
  assert.strictEqual(publishedS1Id(manifest), '2026-10-01_0900');
  assert.strictEqual(publishedS1Id({ stages: {} }), null);
  m.done();
});

test('build_s4 files a new gap as a BLOCKING entry from source s1, even with no sheet drawn', () => {
  const m = mapWith({ old: { services: [svc('9')] }, now: { services: [svc('9'), svc('X1')] },
    published: { routeOrder: ['9'] }, built: { routeOrder: ['9'] } });
  const routesJson = JSON.parse(fs.readFileSync(path.join(m.dir, 'routes.json'), 'utf8'));
  const r = buildSheets({ dir: m.dir, level: 'area', routesJson, sheets: [], write: false, register: null });
  const mine = r.blockers.filter(e => e.source === 's1');
  assert.strictEqual(mine.length, 1, 'build_s4 did not file the S1 check as blocking');
  assert.match(mine[0].text, /X1/);
  m.done();
});
