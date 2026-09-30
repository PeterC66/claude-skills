/*
 * anchor_badge — no route badge prints over the anchor's own name (buses-data OA-531).
 *
 * The anchor label ("Oxford Street", "Huntingdon Bus Station") is drawn first and
 * its box reserved, and the lane-badge sprinkler already refuses reserved space.
 * The corridorPalette IDENTIFYING-badge pass did not: its avoid loop asked only
 * whether a spot clashed with another badge. On High Wycombe Town Centre v2.0 it
 * put the 102/103/104/105/M40/X74 stack on "Oxford Street" at badgeEvery 45, 55,
 * 60, 65 and 70, and the map shipped at 50 only because that pitch happened to
 * move it. Measured 2026-09-30 on an instrumented copy of gen_internal.js.
 *
 * The fixture is that map's S4 inputs, copied from buses-data. The test draws it
 * at two of the pitches that failed and asks the SVG, not the generator, whether
 * any badge's drawn shape crosses the label's reserved box, which is the box the
 * engine computes: from the anchor square's left edge to the end of the bold
 * 3.0 text plus 0.5, and 2 mm either side of the square's centre.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine.js');
const FONT = require(path.join(ENGINE_DIR, 'font_metrics.js'));

const FIXTURE = path.join(__dirname, 'fixtures', 'anchor-badge');

function draw(badgeEvery) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa531-' + badgeEvery + '-'));
  for (const f of fs.readdirSync(FIXTURE)) fs.copyFileSync(path.join(FIXTURE, f), path.join(dir, f));
  const rj = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
  rj.internalRoads = { ...rj.internalRoads, badgeEvery };
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(rj, null, 2));
  const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, 'gen_internal.js')],
    { cwd: dir, env: { ...process.env, LEAFLET_DIR: dir, SKILL_ASSETS: ENGINE_DIR, OVERRIDES_FILE: '' }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'gen_internal.js failed: ' + String(r.stderr).slice(-400));
  const svg = fs.readFileSync(path.join(dir, 'internal.svg'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { svg, label: rj.anchorLabel };
}

// The label's reserved box, rebuilt from where the label was printed: its text sits
// at (square x + 2.6, square y + 1.0).
function labelBox(svg, label) {
  const m = new RegExp('<text x="([\\d.]+)" y="([\\d.]+)" font-family="Arial" font-weight="bold" font-size="3.0"[^>]*>' + label + '</text>').exec(svg);
  assert.ok(m, 'the anchor label "' + label + '" is not on the sheet');
  const sx = +m[1] - 2.6, sy = +m[2] - 1.0;
  return [sx - 2, sy - 2, sx + 2.6 + FONT.textWidth(label, 3.0, true) + 0.5, sy + 2];
}

// Every badge's drawn shape: a disc, or the stadium rect badge() draws for a wide key.
function badges(svg) {
  const out = [];
  for (const m of svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)" fill="[^"]*" stroke="#fff" stroke-width="0.7"\/>\s*<text [^>]*text-anchor="middle" dominant-baseline="central">([^<]*)</g)) {
    const [x, y, r] = [+m[1], +m[2], +m[3]];
    out.push({ key: m[4], box: [x - r, y - r, x + r, y + r] });
  }
  for (const m of svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="[^"]*" stroke="#fff" stroke-width="0.7"\/>\s*<text [^>]*text-anchor="middle" dominant-baseline="central">([^<]*)</g)) {
    const [x, y, w, h] = [+m[1], +m[2], +m[3], +m[4]];
    out.push({ key: m[5], box: [x, y, x + w, y + h] });
  }
  return out;
}

const hits = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

for (const pitch of [55, 65]) {
  test('High Wycombe Town Centre at badgeEvery ' + pitch + ': no badge prints over the anchor label', () => {
    const { svg, label } = draw(pitch);
    const box = labelBox(svg, label);
    const all = badges(svg);
    assert.ok(all.length > 20, 'the badge parser found only ' + all.length + ' badges, so it is not reading this sheet');
    const over = all.filter(b => hits(b.box, box)).map(b => b.key);
    assert.deepStrictEqual(over, [], 'badges over "' + label + '": ' + over.join(', '));
  });
}
