/*
 * corebox_anchor — a coreBox suppresses the anchor square and label only when the
 * anchor is INSIDE the box (buses-data OA-549, 2026-10-02).
 *
 * `coreBox` blanks a congested centre and, because the box used to sit on the
 * anchor by construction, gen_internal.js suppressed the "you are here" square,
 * its label and the place pointer on the box's mere presence. The place sheets
 * broke that assumption: High Wycombe Town Centre's v2.3 box is recentred with
 * `at` onto the bus station, 210 m from its Oxford Street anchor, and the first
 * build lost "Oxford Street" — the one stop the sheet exists to name. Found by
 * the rollout's label diff, not by any gate.
 *
 * The fixture is that map's S4 inputs (shared with anchor_badge.test.js). Three
 * draws: no box (the anchor prints, the control); a box recentred away from the
 * anchor (it still prints); a box on the anchor (it does not, as before).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'anchor-badge');

function draw(coreBox) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa549-'));
  for (const f of fs.readdirSync(FIXTURE)) fs.copyFileSync(path.join(FIXTURE, f), path.join(dir, f));
  const rj = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
  if (coreBox) rj.coreBox = coreBox; else delete rj.coreBox;
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(rj, null, 2));
  const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, 'gen_internal.js')],
    { cwd: dir, env: { ...process.env, LEAFLET_DIR: dir, SKILL_ASSETS: ENGINE_DIR, OVERRIDES_FILE: '' }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'gen_internal.js failed: ' + String(r.stderr).slice(-400));
  const svg = fs.readFileSync(path.join(dir, 'internal.svg'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { svg, label: rj.anchorLabel };
}

// The anchor label is the one bold 3.0 text printed 2.6 mm right of the square.
function anchorPrinted(svg, label) {
  return new RegExp('<text x="[\\d.]+" y="[\\d.]+" font-family="Arial" font-weight="bold" font-size="3.0"[^>]*>' + label + '</text>').test(svg);
}

test('no coreBox: the anchor square and label print (control)', () => {
  const { svg, label } = draw(null);
  assert.ok(anchorPrinted(svg, label), '"' + label + '" should print with no box');
});

test('a coreBox recentred away from the anchor leaves the anchor printed', () => {
  // The bus station: 80 m radius, recentred by page position as High Wycombe Town
  // Centre v2.3 does. The anchor, Oxford Street Stop J, is 210 m east of it.
  const { svg, label } = draw({ radius: 80, at: [78.1, 100.9], label: 'Bus station' });
  assert.ok(svg.includes('>Bus station<'), 'the box itself should be drawn');
  assert.ok(anchorPrinted(svg, label), '"' + label + '" should still print beside a box that does not contain it');
});

test('a coreBox on the anchor suppresses it, as before', () => {
  const { svg, label } = draw({ radius: 80, label: 'town centre' });
  assert.ok(!anchorPrinted(svg, label), '"' + label + '" should not print inside its own box');
});
