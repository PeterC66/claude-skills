'use strict';
/*
 * pin_clock.test.js — a map is judged against the engine the estate ADOPTED, not the one on disk
 * (buses-data OA-574, A1 of the process simplification review).
 *
 * The cases that matter are the two that must NOT say `behind`: a map drawn by today's engine while
 * the pin lags, and a map the shadow rebuild proved stamp-only. Each has a control one field away
 * that must say `behind`, because a rule that excuses everything looks exactly like a rule that
 * excuses the right things.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');
const { readPin, readShadow, standing, regressed } = require('./_engine.js').load('pin_clock.js');

const PIN = 'aaaaaaaaaa', LIVE = 'bbbbbbbbbb', OLD = 'cccccccccc';
const BUILT = '2026-10-01T10:00:00.000Z', RAN = '2026-10-04T00:00:00.000Z';

function shadowFor({ engine = PIN, status = 'STAMP-STALE', name = 'Ramsey', place = false } = {}) {
  const half = { engine, maps: [{ name, status }] };
  const empty = { engine, maps: [] };
  return readShadowFrom({ ranAt: RAN, engine, towns: place ? empty : half, places: place ? half : empty });
}
function readShadowFrom(obj) {
  const root = scratchDir('pin-clock-');
  fs.mkdirSync(path.join(root, 'loop'), { recursive: true });
  fs.writeFileSync(path.join(root, 'loop', 'shadow-rebuild.json'), JSON.stringify(obj));
  return readShadow(root);
}
const ask = (over = {}) => standing({ kind: 'town', name: 'Ramsey', mapEngine: OLD, builtAt: BUILT, live: LIVE, pin: PIN, shadow: null, ...over });

test('a map drawn by the pinned engine is current, whatever the live template says', () => {
  assert.strictEqual(ask({ mapEngine: PIN }), 'current');
});

test('a map drawn by today\'s engine while the pin lags is ahead, never behind', () => {
  assert.strictEqual(ask({ mapEngine: LIVE }), 'ahead');
});

test('control: a map drawn by neither is behind', () => {
  assert.strictEqual(ask(), 'behind');
});

test('behind the PIN, not the live template: a map the live template has overtaken is not stale while it equals the pin', () => {
  assert.strictEqual(ask({ mapEngine: PIN, live: LIVE }), 'current');
  assert.strictEqual(ask({ mapEngine: PIN, live: PIN }), 'current');
});

test('an unstamped build is its own answer, not "behind"', () => {
  assert.strictEqual(ask({ mapEngine: null }), 'unstamped');
  assert.strictEqual(ask({ mapEngine: '(none)' }), 'unstamped');
});

test('a STAMP-STALE verdict taken on the clocked engine after the build excuses the map', () => {
  assert.strictEqual(ask({ shadow: shadowFor() }), 'stamp-only');
});

test('control: the same verdict taken BEFORE the map was built excuses nothing', () => {
  assert.strictEqual(ask({ shadow: shadowFor(), builtAt: '2026-10-05T00:00:00.000Z' }), 'behind');
});

test('a STAMP-STALE or UP-TO-DATE verdict taken on the LIVE template excuses the map too: that is the engine the row’s own dry run would use, so a tick would only repeat it (OA-574, Beaconsfield Waitrose dry-run five times, 8-11 Oct)', () => {
  assert.strictEqual(ask({ shadow: shadowFor({ engine: LIVE }) }), 'stamp-only');
  assert.strictEqual(ask({ shadow: shadowFor({ engine: LIVE, status: 'UP-TO-DATE' }) }), 'stamp-only');
  assert.strictEqual(ask({ kind: 'place', shadow: shadowFor({ engine: LIVE, place: true }) }), 'stamp-only');
});

test('control: the verdict is keyed by engine hash, so one taken on an engine that is neither the pin nor the live template excuses nothing', () => {
  assert.strictEqual(ask({ shadow: shadowFor({ engine: 'dddddddddd' }) }), 'behind');
  assert.strictEqual(ask({ shadow: shadowFor({ engine: LIVE }), live: 'dddddddddd' }), 'behind');
});

test('control: a LIVE-engine verdict taken before the build, or about another map, or that the ink moved, still excuses nothing', () => {
  assert.strictEqual(ask({ shadow: shadowFor({ engine: LIVE }), builtAt: '2026-10-05T00:00:00.000Z' }), 'behind');
  assert.strictEqual(ask({ shadow: shadowFor({ engine: LIVE, name: 'Soham' }) }), 'behind');
  assert.strictEqual(ask({ shadow: shadowFor({ engine: LIVE, status: 'DRY-RUN' }) }), 'behind');
});

test('control: a verdict that is not STAMP-STALE excuses nothing — the ink moved, so a rebuild is owed', () => {
  assert.strictEqual(ask({ shadow: shadowFor({ status: 'DRY-RUN' }) }), 'behind');
  assert.strictEqual(ask({ shadow: shadowFor({ status: 'STALE-INPUTS' }) }), 'behind');
});

test('control: a verdict about another map excuses nothing', () => {
  assert.strictEqual(ask({ shadow: shadowFor({ name: 'Soham' }) }), 'behind');
});

test('a place is asked of the places half of the report, not the towns half', () => {
  assert.strictEqual(ask({ kind: 'place', shadow: shadowFor({ place: true }) }), 'stamp-only');
  assert.strictEqual(ask({ kind: 'town', shadow: shadowFor({ place: true }) }), 'behind');
});

test('strict (the area-fixture town) must EQUAL the pin: no ahead, no stamp-only', () => {
  assert.strictEqual(ask({ strict: true, mapEngine: PIN }), 'current');
  assert.strictEqual(ask({ strict: true, mapEngine: LIVE }), 'behind');
  assert.strictEqual(ask({ strict: true, shadow: shadowFor() }), 'behind');
});

test('no pin falls back to the live template, as an estate with no lock always was judged', () => {
  assert.strictEqual(ask({ pin: null, mapEngine: LIVE }), 'current');
  assert.strictEqual(ask({ pin: null, mapEngine: OLD }), 'behind');
});

test('readPin reads the two hashes, and says null for no lock, a broken lock or a lock naming neither', () => {
  const root = scratchDir('pin-clock-pin-');
  assert.strictEqual(readPin(root), null);
  fs.writeFileSync(path.join(root, 'engine.lock.json'), '{not json');
  assert.strictEqual(readPin(root), null);
  fs.writeFileSync(path.join(root, 'engine.lock.json'), JSON.stringify({ commit: 'x' }));
  assert.strictEqual(readPin(root), null);
  fs.writeFileSync(path.join(root, 'engine.lock.json'), JSON.stringify({ commit: 'abc', engine: PIN, placeEngine: LIVE }));
  assert.deepStrictEqual(readPin(root), { commit: 'abc', engine: PIN, placeEngine: LIVE });
});

test('readShadow says null for an absent, unparseable or half-written report instead of throwing', () => {
  const root = scratchDir('pin-clock-sh-');
  assert.strictEqual(readShadow(root), null);
  fs.mkdirSync(path.join(root, 'loop'));
  fs.writeFileSync(path.join(root, 'loop', 'shadow-rebuild.json'), '{"ranAt":');
  assert.strictEqual(readShadow(root), null);
  fs.writeFileSync(path.join(root, 'loop', 'shadow-rebuild.json'), JSON.stringify({ ranAt: RAN, towns: { maps: [] } }));
  assert.strictEqual(readShadow(root), null);
});

const regressedFor = (over = {}) => regressed({ kind: 'town', name: 'Ramsey', builtAt: BUILT, live: LIVE, pin: PIN, shadow: null, ...over });
function shadowVerdict({ engine = LIVE, verdict = 'regressed', status = 'DRY-RUN', name = 'Ramsey' } = {}) {
  return readShadowFrom({ ranAt: RAN, engine, towns: { engine, maps: [{ name, status, verdict }] }, places: { engine, maps: [] } });
}

test('regressed: a shadow on the live template or the pin that found this map regressed says so (OA-574, the fold into a hold)', () => {
  assert.strictEqual(regressedFor({ shadow: shadowVerdict() }), true);
  assert.strictEqual(regressedFor({ shadow: shadowVerdict({ engine: PIN }) }), true);
});

test('control: regressed is false for a clean verdict, another map, another engine, a build after the report, or no report', () => {
  assert.strictEqual(regressedFor({ shadow: shadowVerdict({ verdict: 'clean' }) }), false);
  assert.strictEqual(regressedFor({ shadow: shadowVerdict({ name: 'Soham' }) }), false);
  assert.strictEqual(regressedFor({ shadow: shadowVerdict({ engine: 'dddddddddd' }) }), false);
  assert.strictEqual(regressedFor({ shadow: shadowVerdict(), builtAt: '2026-10-05T00:00:00.000Z' }), false);
  assert.strictEqual(regressedFor({ shadow: null }), false);
});
