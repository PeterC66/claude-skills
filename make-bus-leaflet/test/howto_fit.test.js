/*
 * howto_fit.test.js — design.howToUse.fit: a "How to use this map" panel with no clear ground is given a
 * narrower column by the engine, where it used to be refused as NOT DRAWN (buses-data OA-437, A1 slice 3).
 *
 * WHY THIS EXISTS. Huntingdon and The Shelfords carry a hand-typed howToUse.width of 60, because the panel
 * at the default 92 mm column had nowhere clear to go and the engine's only answer was "shrink it with
 * design.howToUse.width". The engine now tries 84, 76, 68 and 60 mm itself when the town stored no width
 * and the default panel has nowhere to go, and keeps the widest column that finds a spot.
 *
 * Held on a copy of the fixture estate's March external with ten one-line bullets, which is the count at
 * which the 92 mm panel finds no ground and a narrower one does (nine fit at 92, eleven fit nowhere).
 * Absent that the fit never runs, so the byte gate holds every real map. A stored width wins, and
 * design.howToUse.fit:false is the old behaviour.
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
  console.log('# howto_fit: the radial generator or its fixture is absent — nothing to check');
}

function runOn(mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'howtofit-'));
  try {
    fs.cpSync(FIXTURE, tmp, { recursive: true });
    if (mutate) {
      const f = path.join(tmp, 'routes.json');
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      d.design = d.design || {};
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

// Ten one-line bullets: too tall for any clear ground at the default 98.8 mm panel, not at a narrower one.
const tall = (extra) => (d) => {
  const bullets = [];
  for (let i = 1; i <= 10; i++) bullets.push('Line ' + i + '.');
  d.design.howToUse = Object.assign({ bullets }, extra || {});
};

function howToPanel(svg) {
  const hdr = svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>How to use this map</);
  if (!hdr) return null;
  const all = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="2" fill="#ffffff"[^>]*stroke="#ccc"/g)];
  const m = all.find(a => +hdr[1] >= +a[1] && +hdr[1] <= +a[1] + +a[3] && +hdr[2] >= +a[2] && +hdr[2] <= +a[2] + +a[4]);
  assert.ok(m, 'no backing panel contains the "How to use this map" heading');
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}

test('a panel that already fits is untouched: howToUse.fit on and off draw the same bytes', () => {
  if (!PRESENT) return;
  const on = runOn(null), off = runOn(d => { d.design.howToUse = { fit: false }; });
  assert.strictEqual(on.svg, off.svg);
  assert.ok(!/design\.howToUse\.fit/.test(on.err), 'the fit ran on a panel that had ground: ' + on.err);
});

test('no clear ground and no stored width: the column is narrowed, widest first, and the panel is drawn', () => {
  if (!PRESENT) return;
  const fit = runOn(tall());
  const m = fit.err.match(/column was narrowed to (\d+) mm \(design\.howToUse\.fit\)/);
  assert.ok(m, 'the fit did not run: ' + fit.err);
  // 84 finds no ground on this fixture and 76 does; 68 and 60 would also fit, as a narrower, taller panel.
  assert.strictEqual(+m[1], 76, 'not the widest column that finds ground: ' + fit.err);
  const p = howToPanel(fit.svg);
  assert.ok(p, 'the fitted panel was not drawn');
  assert.strictEqual(p.w.toFixed(2), (76 + 2 * 3.4).toFixed(2), 'the drawn panel is not the fitted width');
  assert.ok(!/NOT DRAWN/.test(fit.err), fit.err);
});

test('howToUse.fit:false keeps the old behaviour: refuse, and draw no panel', () => {
  if (!PRESENT) return;
  const off = runOn(tall({ fit: false }));
  assert.match(off.err, /no position on this sheet leaves a 99x\d+ mm panel/);
  assert.ok(!/design\.howToUse\.fit\)/.test(off.err));
  assert.strictEqual(howToPanel(off.svg), null);
});

test('a stored width wins: the fit never runs, even where the stored width leaves no ground', () => {
  if (!PRESENT) return;
  // 92 stored is the default width, still too wide for any ground, so only the stored-key guard stops the fit.
  const hand = runOn(tall({ width: 92 }));
  assert.match(hand.err, /no position on this sheet leaves a 99x\d+ mm panel/);
  assert.ok(!/design\.howToUse\.fit\)/.test(hand.err), hand.err);
});
