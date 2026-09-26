/*
 * spoke_crush_warning.test.js — the place external measures its own crowding
 * whether or not design.spokeSpread is switched on.
 *
 * WHY THIS EXISTS (buses-data OA-314). gen_external_places.js printed its "two
 * spokes are still under 18° apart" warning only inside the opted-in branch: the
 * bearings function returned early at `if (!SPRD ...) return raw;` before reaching
 * it. So a map with the feature OFF — the map most likely to need it — measured and
 * reported nothing. On 2026-09-11 three Co-op place sheets sat at 5° and 6° between
 * two spokes with clean build-warnings.txt files. That is the shape "the gate that
 * could only see what runs": a check that can only see the maps that already
 * opted in to the remedy.
 *
 * Seen red before it landed: main's generator, run on Ely Co-op's ci-reference,
 * printed no crowding line at all; the patched one names "Cambridge" and
 * "Impington" at 6°, and the two external.svg files are byte-identical.
 *
 * Both directions are held here, on a copy of the fixture estate's High Wycombe
 * Aldi: as committed (spokeSpread off, a 17° pair) it must warn and name the pair;
 * with design.spokeSpread switched on it must NOT print the off-warning, because the
 * opted-in branch reports for itself.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR, load } = require('./_engine');

const EV = load('engine_version.js');
const PLACE_DIR = EV.placeAssetsDir(ENGINE_DIR);
const GEN = path.join(PLACE_DIR, 'gen_external_places.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'estate', 'Places', '_standalone',
  'High Wycombe Aldi', 'ci-reference');
const PRESENT = fs.existsSync(GEN) && fs.existsSync(FIXTURE);
if (!PRESENT) {
  console.log('# spoke_crush_warning: the place generator or its fixture is absent — '
    + 'nothing to check (the expected shape under ENGINE_DIR=<scratch>)');
}

const OFF_WARNING = /spokeSpread is off and two spokes are (\d+)° apart \("([^"]+)" and "([^"]+)"\)/;

function runOn(mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spokecrush-'));
  try {
    fs.cpSync(FIXTURE, tmp, { recursive: true });
    if (mutate) {
      const f = path.join(tmp, 'routes.json');
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      mutate(d);
      fs.writeFileSync(f, JSON.stringify(d));
    }
    const r = spawnSync(process.execPath, [GEN], { cwd: tmp, encoding: 'utf8',
      env: { ...process.env, SKILL_ASSETS: ENGINE_DIR } });
    assert.strictEqual(r.status, 0, 'gen_external_places.js failed: ' + r.stderr);
    assert.ok(fs.existsSync(path.join(tmp, 'external.svg')), 'no external.svg was written');
    return r.stderr;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('with spokeSpread OFF, a crowded sheet still says so and names the pair', () => {
  if (!PRESENT) return;
  const m = runOn(null).match(OFF_WARNING);
  assert.ok(m, 'the crowding went unreported because design.spokeSpread is off — OA-314');
  assert.ok(Number(m[1]) < 18, 'warned about a gap of ' + m[1] + '°, which is not under 18°');
  assert.notStrictEqual(m[2], m[3], 'the warning named one destination twice');
});

test('with spokeSpread ON, the off-warning is not printed', () => {
  if (!PRESENT) return;
  const err = runOn(d => { d.design = { ...(d.design || {}), spokeSpread: true }; });
  assert.ok(!OFF_WARNING.test(err), 'printed the spokeSpread-is-off warning with the key on');
  assert.match(err, /^spokeSpread: /m, 'the opted-in branch no longer reports its own spread');
});
