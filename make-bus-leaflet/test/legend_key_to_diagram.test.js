/*
 * legend_key_to_diagram.test.js — the town external legend badges only what the
 * diagram draws, plus what localLoops[] captions.
 *
 * WHY THIS EXISTS (buses-data OA-305, Peter's choice 2026-10-01). The Operators &
 * services legend was built from operators[] and never asked whether a route had a
 * spoke: 20 badges on 8 of the 17 external sheets had no line under them, and five
 * operator rows carried nothing at all. Wisbech's FACT and 68 is the one it was
 * found by, and only by a person looking at the JPG. The hybrid fix filters the
 * legend to the spokes, keeps a spokeless badge only where the town declares it in
 * localLoops[] {route,label} with a caption, and names everything dropped on stderr.
 *
 * Seen red before it landed: on main's generator the first case finds the 33A badge
 * and the FACT row still in the legend, and nothing on stderr.
 *
 * Held on a copy of the fixture estate's March, where 33A (Fenland Assoc. for
 * Community Transport) is a town service with no spoke, and on Beaconsfield, where
 * every legend badge has a line — the control that must stay silent.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine');

const GEN = path.join(ENGINE_DIR, 'gen_external_radial.js');
const ESTATE = path.join(__dirname, 'fixtures', 'estate', 'Areas');
const MARCH = path.join(ESTATE, 'March', 'ci-reference');
const BEACONSFIELD = path.join(ESTATE, 'Beaconsfield', 'ci-reference');
const FACT = 'Fenland Assoc. for Community Transport';

function runOn(fixture, mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legendkey-'));
  try {
    fs.cpSync(fixture, tmp, { recursive: true });
    fs.rmSync(path.join(tmp, 'overrides.json'), { force: true });
    if (mutate) {
      const f = path.join(tmp, 'routes.json');
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      mutate(d);
      fs.writeFileSync(f, JSON.stringify(d));
    }
    const r = spawnSync(process.execPath, [GEN], { cwd: tmp, encoding: 'utf8',
      env: { ...process.env, LEAFLET_DIR: tmp, SKILL_ASSETS: ENGINE_DIR } });
    assert.strictEqual(r.status, 0, 'gen_external_radial.js failed: ' + r.stderr);
    return { svg: fs.readFileSync(path.join(tmp, 'external.svg'), 'utf8'), stderr: r.stderr };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Every <text> printed at exactly `size`, as plain strings.
const textsAt = (svg, size) => [...svg.matchAll(new RegExp(`font-size="${size}"[^>]*>([^<]*)</text>`, 'g'))]
  .map(m => m[1].replace(/&amp;/g, '&'));
const legendLines = stderr => stderr.split('\n').filter(l => l.startsWith('legend: ') && l.includes('operators[]'));

test('a spokeless route is left out of the legend, its emptied operator row goes, and stderr names it', () => {
  const { svg, stderr } = runOn(MARCH);
  assert.ok(!textsAt(svg, '3.4').includes(FACT), 'the FACT operator row is still drawn');
  assert.ok(textsAt(svg, '3.4').includes('Dews Coaches'), 'a row with spokes was dropped too');
  const lines = legendLines(stderr);
  assert.strictEqual(lines.length, 1, 'expected one legend guard line, got: ' + stderr);
  assert.match(lines[0], /33A \(Fenland Assoc\. for Community Transport\)/);
});

test('localLoops[] keeps the badge and the operator row, and draws the caption', () => {
  const { svg, stderr } = runOn(MARCH, d => { d.localLoops = [{ route: '33A', label: 'town service to Westry' }]; });
  assert.ok(textsAt(svg, '3.4').includes(FACT), 'the declared loop lost its operator row');
  assert.ok(textsAt(svg, '3.0').includes('town service to Westry'), 'no caption row was drawn');
  assert.deepStrictEqual(legendLines(stderr), [], 'a declared loop must not trip the guard');
});

test('a bare string in localLoops[] reads as "local circular"', () => {
  const { svg } = runOn(MARCH, d => { d.localLoops = ['33A']; });
  assert.ok(textsAt(svg, '3.0').includes('local circular'));
});

test('control: a sheet where every badge has a spoke stays silent', () => {
  const { stderr } = runOn(BEACONSFIELD);
  assert.deepStrictEqual(legendLines(stderr), []);
});

test('control: a route carried only in an arm\'s routes[] counts as having a spoke', () => {
  const { svg, stderr } = runOn(MARCH, d => {
    const arm = d.external.find(b => b.route === '32');
    arm.routes = ['32', '33A'];
  });
  assert.deepStrictEqual(legendLines(stderr), []);
  assert.ok(textsAt(svg, '3.4').includes(FACT));
});
