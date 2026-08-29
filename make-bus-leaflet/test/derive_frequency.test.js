/*
 * derive_frequency.js — the stale-S1 guard (OA-019, 2026-08-29).
 *
 * The tool tiers a place's line weights from five fields that only gtfs_query.py
 * writes. Three of the twelve places on the estate have an S1 that predates them,
 * and fed one of those the tool did not fail: an absent typicalDayWindow became
 * the empty string, the empty string sorts below '15:30', and every lane came out
 * "limited — ends mid-afternoon" from no data at all. --write would have drawn
 * 22 lanes across three sheets at the limited weight and printed a Key saying so.
 *
 * derive_frequency.js is a script, not a module, so these tests spawn it against
 * fixture folders. The fixtures are the two real S1 SHAPES, cut down to the fields
 * that matter — the modern one from St Neots Co-op, the old one from Beaconsfield
 * Waitrose. Two of the tests are CONTROLS: a guard that refused the good schema,
 * or that threw away a lane whose measured window is legitimately empty, would be
 * worse than the bug.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = process.env.DERIVE_FREQUENCY_JS ||
  path.join(__dirname, '..', '..', 'make-place-bus-leaflet', 'assets', 'derive_frequency.js');

/* A service in the CURRENT S1 schema — the shape gtfs_query.py writes. */
function modern(route, over) {
  return Object.assign({
    route, operator: 'Test', days: 'Mon-Sat',
    weeksActive: 12, typicalDayJourneys: 20, coreHeadwayMinutes: 30,
    longestDaytimeGap: 35, typicalDayWindow: ['06:00', '19:00'],
  }, over || {});
}

/* A service in the OLD schema — Beaconsfield Waitrose's, which carries a weekly
 * volume and not one of the five fields the tiering rule reads. */
function legacy(route) {
  return { route, operator: 'Test', days: 'Mon-Sat', tripsAtTownPerWeekSample: 96 };
}

function run(services, lanes, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-freq-'));
  const palette = {};
  for (const l of lanes) palette[l] = '#123456';
  fs.writeFileSync(path.join(dir, 'routes.json'),
    JSON.stringify({ town: 'Fixture Place', palette }, null, 2));
  fs.writeFileSync(path.join(dir, 'gtfs-services.json'), JSON.stringify(
    Object.assign({ town: 'Fixture Place', services }, opts || {}), null, 2));
  const r = spawnSync(process.execPath, [SCRIPT].concat((opts && opts.argv) || []),
    { cwd: dir, encoding: 'utf8' });
  let written = null;
  try { written = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8')); } catch (e) { /* ignore */ }
  return { code: r.status, out: r.stdout + r.stderr, written, dir };
}

test('an S1 with none of the frequency fields is REFUSED, not tiered', () => {
  const r = run([legacy('102'), legacy('103'), legacy('380')], ['102', '103', '380']);
  assert.notStrictEqual(r.code, 0, 'it must not exit 0 on a schema it cannot measure');
  assert.match(r.out, /not one lane could be tiered/);
  assert.match(r.out, /predates the frequency fields/);
  // The specific lie it used to tell must not appear anywhere in the output.
  assert.doesNotMatch(r.out, /ends mid-afternoon/,
    'the empty-window fall-through must not produce a reason phrase');
});

test('the refusal writes nothing, even with --write', () => {
  const r = run([legacy('102'), legacy('103')], ['102', '103'], { argv: ['--write'] });
  assert.notStrictEqual(r.code, 0);
  assert.strictEqual(r.written.frequency, undefined, 'routes.json must be untouched');
  assert.strictEqual(r.written.design, undefined);
});

test('CONTROL: the current schema still tiers exactly as before the guard', () => {
  const r = run([
    modern('A', { coreHeadwayMinutes: 20, longestDaytimeGap: 16, typicalDayJourneys: 103 }),
    modern('302', { coreHeadwayMinutes: 120, longestDaytimeGap: 120 }),
    modern('9', { typicalDayJourneys: 6, coreHeadwayMinutes: null, longestDaytimeGap: 210, typicalDayWindow: ['09:18', '17:10'] }),
  ], ['A', '302', '9'], { argv: ['--write'], frequencyBasis: { weeksSampled: 12 } });
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(r.written.frequency, { A: 'frequent', 302: 'all-day', 9: 'limited' });
  assert.ok(r.written.design.frequencyTiers.frequent, 'the Key rows are emitted too');
});

test('CONTROL: a MEASURED empty window is kept — the test is for the key, not the value', () => {
  // St Ives Bus Station's 301S: weeksActive 12, typicalDayJourneys 0, an empty
  // typicalDayWindow. That is a real measurement of a service that does not run on
  // weekdays, and a guard written as `s.typicalDayWindow != null` would discard it.
  const r = run([
    modern('301S', { typicalDayJourneys: 0, coreHeadwayMinutes: null, longestDaytimeGap: null, typicalDayWindow: ['', ''] }),
    modern('B'),
  ], ['301S', 'B'], { argv: ['--write'], frequencyBasis: { weeksSampled: 12 } });
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(r.written.frequency['301S'], 'limited', 'the measured lane is still tiered');
  assert.match(r.out, /not on weekdays/, 'and still carries its measured reason');
});

test('a MIXED S1 tiers what it can and names what it cannot', () => {
  // Not a case on the estate today, but it is the one where a whole-file check and
  // a per-lane check disagree, so it is the one that fixes the choice in place.
  const r = run([modern('X3'), legacy('101')], ['X3', '101'],
    { argv: ['--write'], frequencyBasis: { weeksSampled: 12 } });
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(Object.keys(r.written.frequency), ['X3']);
  assert.match(r.out, /S1 carries no frequency fields for these, left UNCLASSIFIED: 101/);
});
