/*
 * place_legend_wrap.test.js — the place external honours legendWrap:{perRow:N}.
 *
 * WHY THIS EXISTS (buses-data OA-089). gen_external_radial.js has wrapped an
 * operator's badge run since 2026-08-06, because High Wycombe's Carousel runs 17
 * routes; gen_external_places.js was copied from it before that and never gained
 * the key. High Wycombe Town Centre's first external drew Carousel as one row, a
 * legend 153mm wide that sat over three destination boxes, and no layout could
 * clear it. The key is ported under the same name, so a place and its town are
 * configured alike.
 *
 * Seen red before it landed: on main's generator the "wrapped" run below draws the
 * same 1-row legend as the plain run, and the width assertion fails.
 *
 * Held on a copy of the fixture estate's High Wycombe Aldi, whose Carousel row has
 * nine badges: absent the key the legend is unchanged, and at perRow 3 the panel is
 * narrower and taller, still carries every badge, and names the operator after the
 * LAST row rather than past a full one.
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
  console.log('# place_legend_wrap: the place generator or its fixture is absent — '
    + 'nothing to check (the expected shape under ENGINE_DIR=<scratch>)');
}

function runOn(mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legendwrap-'));
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
    return fs.readFileSync(path.join(tmp, 'external.svg'), 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The legend's backing panel: the one white, grey-stroked rx=2 rect drawn under it.
function legendPanel(svg) {
  const all = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="2" fill="#ffffff"[^>]*stroke="#ccc"/g)];
  // The how-to-use panel shares the style; the legend is the one holding the header.
  const hdr = svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>Operators &amp; services</);
  assert.ok(hdr, 'no "Operators & services" header was drawn');
  const hx = +hdr[1], hy = +hdr[2];
  const m = all.find(a => hx >= +a[1] && hx <= +a[1] + +a[3] && hy >= +a[2] && hy <= +a[2] + +a[4]);
  assert.ok(m, 'no backing panel contains the legend header');
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}
const badgeCount = (svg, p) => [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)]
  .filter(c => +c[1] >= p.x && +c[1] <= p.x + p.w && +c[2] >= p.y && +c[2] <= p.y + p.h).length;

test('absent legendWrap, the legend is one row per operator (the byte gate holds the rest)', () => {
  if (!PRESENT) return;
  const svg = runOn(null);
  const p = legendPanel(svg);
  assert.ok(p.w > 0 && p.h > 0);
});

test('legendWrap:{perRow:3} wraps the long operator: narrower, taller, same badges', () => {
  if (!PRESENT) return;
  const plain = runOn(null), wrapped = runOn(d => { d.legendWrap = { perRow: 3 }; });
  const a = legendPanel(plain), b = legendPanel(wrapped);
  assert.ok(b.w < a.w - 10, `the wrapped legend is ${b.w}mm wide against ${a.w}mm unwrapped — legendWrap was ignored`);
  assert.ok(b.h > a.h, `the wrapped legend is no taller (${b.h}mm against ${a.h}mm) — rows were overprinted`);
  assert.strictEqual(badgeCount(wrapped, b), badgeCount(plain, a), 'the wrapped legend lost or gained a badge');
  // Carousel names itself after its last row, not past a full one (the town fault, Peter's item 27).
  const t = wrapped.match(/<text x="([\d.]+)"[^>]*>Carousel Buses</);
  assert.ok(t && +t[1] < b.x + b.w, 'the operator name is drawn outside its own panel');
});

test('perRow 0 or a non-number is the absent key', () => {
  if (!PRESENT) return;
  const plain = runOn(null);
  assert.strictEqual(runOn(d => { d.legendWrap = { perRow: 0 }; }), plain);
  assert.strictEqual(runOn(d => { d.legendWrap = { perRow: 'x' }; }), plain);
});
