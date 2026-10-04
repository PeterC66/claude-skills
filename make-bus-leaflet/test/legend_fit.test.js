/*
 * legend_fit.test.js — design.legendFit: a legend with no clear ground is wrapped narrower by the
 * engine, where it used to be left on top of the sheet with a warning (buses-data OA-437, A1 slice 2).
 *
 * WHY THIS EXISTS. Four maps carry a hand-typed legendWrap.perRow (9, 9, 4, 3, 2 across five maps) because
 * the legend as drawn was too big for any clear ground, and the engine's only answer was "shrink it with
 * legendWrap". The numbers were chosen by eye per map. The engine now tries the narrower wraps itself when
 * the town set no legendWrap and the plain legend has nowhere to go, and keeps the widest wrap that finds
 * a spot.
 *
 * Held on a copy of the fixture estate's March external with one operator inflated to 35 drawn routes.
 * Absent the inflation nothing changes, so the byte gate holds every real map; with it the legend is
 * wrapped, fits, and keeps every badge. A stored legendWrap wins, and design.legendFit:false is the old
 * behaviour. Also holds the panel-width fix made in the same change: a wrapped legend counts its badge
 * grid, not only the operator name after the last row, so the panel never ends inside its own badges.
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
const FIXTURE = path.join(__dirname, 'fixtures', 'estate', 'Areas', 'March', 'ci-reference');
const PRESENT = fs.existsSync(GEN) && fs.existsSync(FIXTURE);
if (!PRESENT) {
  console.log('# legend_fit: the radial generator or its fixture is absent — nothing to check');
}

function runOn(mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legendfit-'));
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
    assert.strictEqual(r.status, 0, 'gen_external_radial.js failed: ' + r.stderr);
    return { svg: fs.readFileSync(path.join(tmp, 'external.svg'), 'utf8'), err: r.stderr };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// One operator drawn with many routes: 34 extra badges piled onto the first spoke, so its legend row is
// far wider than any clear ground on the sheet.
const inflate = (d) => {
  const extra = [];
  for (let i = 1; i <= 34; i++) { extra.push('T' + i); d.palette['T' + i] = '#336699'; }
  d.operators[0].routes = d.operators[0].routes.concat(extra);
  d.external[0].routes = [d.external[0].route].concat(extra);
};

function legendPanel(svg) {
  const hdr = svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>Operators &amp; services</);
  assert.ok(hdr, 'no "Operators & services" header was drawn');
  const all = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="2" fill="#ffffff"[^>]*stroke="#ccc"/g)];
  const m = all.find(a => +hdr[1] >= +a[1] && +hdr[1] <= +a[1] + +a[3] && +hdr[2] >= +a[2] && +hdr[2] <= +a[2] + +a[4]);
  assert.ok(m, 'no backing panel contains the legend header');
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}
// Badges drawn at the legend's radius (2.9) that lie inside the panel, and those just outside it.
const legendBadges = (svg, p) => [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="2\.9"/g)]
  .map(c => ({ x: +c[1], y: +c[2] })).filter(c => c.y >= p.y && c.y <= p.y + p.h);

test('a legend that already fits is untouched: legendFit on and off draw the same bytes', () => {
  if (!PRESENT) return;
  const on = runOn(null), off = runOn(d => { d.design.legendFit = false; });
  assert.strictEqual(on.svg, off.svg);
  assert.ok(!/design\.legendFit/.test(on.err), 'the fit ran on a legend that had ground: ' + on.err);
});

test('no clear ground and no legendWrap: the legend is wrapped, fits, and keeps every badge', () => {
  if (!PRESENT) return;
  const fit = runOn(inflate);
  assert.match(fit.err, /wrapped at \d+ per row \(design\.legendFit\)/);
  // The widest wrap that finds ground: 11 on this fixture. The narrowest (2) would also fit, as a tall column.
  assert.ok(+fit.err.match(/wrapped at (\d+) per row/)[1] >= 8, 'a narrow wrap was chosen where a wider one fits: ' + fit.err);
  const p = legendPanel(fit.svg);
  assert.ok(p.x + p.w <= 297, `the fitted legend runs off the page: ${p.x}+${p.w}mm`);
  const b = legendBadges(fit.svg, p);
  assert.ok(b.length >= 38, `only ${b.length} legend badges were drawn`);
  assert.ok(b.every(c => c.x >= p.x && c.x <= p.x + p.w), 'a legend badge was drawn outside its own panel');
});

test('legendFit:false keeps the old behaviour: warn, leave it, draw one wide row', () => {
  if (!PRESENT) return;
  const off = runOn(d => { inflate(d); d.design.legendFit = false; });
  assert.match(off.err, /no position on this sheet leaves a/);
  assert.ok(!/design\.legendFit\)/.test(off.err));
});

test('a stored legendWrap wins: the fit never runs, even where the stored wrap leaves no ground', () => {
  if (!PRESENT) return;
  // 30 per row is still far too wide for any ground, so only the stored-key guard stops the fit from running.
  const hand = runOn(d => { inflate(d); d.legendWrap = { perRow: 30 }; });
  assert.match(hand.err, /no position on this sheet leaves a/);
  assert.ok(!/design\.legendFit\)/.test(hand.err), hand.err);
});
