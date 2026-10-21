/*
 * external_config_check.test.js — the spoke-stops mistake of buses-data OA-632. Its
 * other mistake, legendAt under design, is design_key_check.test.js's since OA-652.
 *
 * Each case is asked of a REAL committed config from the fixture estate, once as it
 * stands and once with the mistake put into it, so the check is seen red on a fixture
 * and quiet on the same fixture without it. March and St Ives are clear of the
 * mistake; the Beaconsfield fixture is not (its route 31 ends at Hazlemere under the
 * label "High Wycombe", so Hazlemere is missing from its sheet), and the last case
 * pins that the check says so.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./_engine');

const { externalConfigWarnings, namesTheTerminus } = load('external_config_check.js');
const BUILDLOG = load('build_log.js');
const { buildSheets } = load('build_s4.js');
const ENGINE = load('engine_version.js');

const FIX = path.join(__dirname, 'fixtures', 'estate', 'Areas');
const config = town => JSON.parse(fs.readFileSync(path.join(FIX, town, 'ci-reference', 'routes.json'), 'utf8'));
const stopsWarnings = D => externalConfigWarnings(D).filter(m => m.startsWith('spokeStops:'));

test('March and St Ives, as committed, carry neither mistake', () => {
  for (const town of ['March', 'St Ives']) {
    const D = config(town);
    assert.ok(D.external.length > 0, `${town}'s fixture has no spokes, so this case proves nothing`);
    assert.deepStrictEqual(externalConfigWarnings(D), [], `${town} warned on a config that draws correctly`);
  }
});

test('a spoke whose stops leave out the terminus warns, naming the village the sheet loses', () => {
  const D = config('March');
  const i = D.external.findIndex(b => b.stops.length >= 2);
  assert.ok(i >= 0, 'no March spoke has two stops to cut');
  const dropped = D.external[i].stops.pop();
  const kept = D.external[i].stops[D.external[i].stops.length - 1];
  const w = stopsWarnings(D);
  assert.strictEqual(w.length, 1, `expected one warning after dropping "${dropped}", got ${w.length}`);
  assert.ok(w[0].includes(`"${kept}"`), 'the warning does not name the last stop the sheet will not print');
});

test('an empty stops list warns', () => {
  const D = config('St Ives');
  D.external[0].stops = [];
  const w = stopsWarnings(D);
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /empty stops list/);
});

test('every message files as a WARN entry of its own, never BLOCKING', () => {
  const D = config('March');
  D.external[0].stops = [];
  D.external[1].stops.pop();
  const msgs = externalConfigWarnings(D);
  assert.strictEqual(msgs.length, 2);
  const entries = BUILDLOG.collect([{ source: 'config', stderr: msgs.join('\n'), ok: true }]);
  assert.strictEqual(entries.length, 2, 'build_log.js glued two messages into one entry');
  for (const e of entries) assert.strictEqual(e.severity, 'WARN', `classified ${e.severity}: ${e.text}`);
});

test('the label rule accepts the committed variations and refuses a different place', () => {
  assert.ok(namesTheTerminus('Ely', 'Ely (some journeys)'));
  assert.ok(namesTheTerminus('Alconbury Weston', 'The Alconburys'));
  assert.ok(namesTheTerminus('Cambridge (Drummer St)', 'Cambridge'));
  assert.ok(namesTheTerminus('Norwich', "King's Lynn – Norwich"));
  assert.ok(!namesTheTerminus('Chinnor', 'Thame'));
  assert.ok(!namesTheTerminus('Hazlemere', 'High Wycombe'));
  assert.ok(!namesTheTerminus('Cadmore End', 'Lane End'), 'a generic word made two places agree');
});

test('the Beaconsfield fixture is told that route 31 loses Hazlemere', () => {
  const w = stopsWarnings(config('Beaconsfield'));
  assert.ok(w.some(m => m.includes('route 31') && m.includes('"Hazlemere"')), w.join('\n'));
});

test('it stays outside every engine hash', () => {
  const hashed = [...ENGINE.engineFiles(), ...[].concat(ENGINE.placeEngineFiles() || [])].map(f => path.basename(String(f)));
  assert.ok(!hashed.includes('external_config_check.js'),
    'external_config_check.js joined the engine hash: every map now owes a re-stamp for a warning');
});

test('a build at either level files what the check said as WARN entries from source config, even when the sheet fails', () => {
  // An empty run folder makes the external generator die on its missing inputs, which
  // is the case where the config is most worth reading: the check runs regardless.
  for (const level of ['area', 'place']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-'));
    const routesJson = { town: 'Nowhere', external: [{ route: '1', label: 'Thame', stops: ['Chinnor'] }] };
    fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(routesJson));
    const r = buildSheets({ dir, level, routesJson, sheets: ['external'], write: false });
    const mine = r.warnings.filter(e => e.source === 'config');
    assert.strictEqual(mine.length, 1, `build_s4 did not file the config check at level ${level}`);
    assert.strictEqual(mine[0].severity, 'WARN');
    assert.ok(mine[0].text.includes('"Chinnor"'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
