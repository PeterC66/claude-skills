/*
 * quality_metrics.js — A CORRIDOR FAMILY IS NOT ALWAYS AN ARRAY, and the one
 * place that still believed it was took the whole quality ratchet down.
 *
 * OA-176 4.24 (claude-skills 5582750, 2026-09-05 04:28) gave an
 * internalCorridors family an optional STYLE, which is expressible only in the
 * object form:
 *
 *     "internalCorridors": { "303": { "routes": ["305"], "style": "alternate" } }
 *
 * `complexity_ladder.js` grew `parseFamilies()` to read both shapes, and every
 * caller inside the drawing engine was moved onto it. `quality_metrics.js` was
 * not, because it never called it — it hand-rolled the same parse in two lines
 * to build the `rides` map that stops a corridor member being reported as a
 * service in the panel with no line on the map. `for (const x of ms)` on
 * `{routes, style}` throws `ms is not iterable`.
 *
 * Ramsey adopted the styled form the same morning, so from that commit
 * `quality.run()` threw on the whole estate. status.js catches it, prints one
 * line on stderr and carries on with `qualityRows = []` — which prints NO
 * ratchet section at all and, because `[].some()` is false, contributes nothing
 * to the board's exit code. The ratchet was gone rather than failing, and it
 * would have been gone under a GREEN board had the estate not been engine-stale
 * for an unrelated reason at the same time.
 *
 * So the cases below are about the SHAPE, not about Ramsey: an object-form
 * family must be read, the array form must keep working, and a route that
 * really is panel-only must still be reported — because the cheapest wrong fix
 * here is one that suppresses the finding for everything.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analyse } = require('./_engine.js').load('quality_metrics.js');
const { scratchDir } = require('../assets/scratch');

const PALETTE = { '303': '#4477aa', '305': '#ee6677', '9': '#228833' };
const PANEL_ORDER = ['303', '305', '9'];

let seq = 0;
// An internal sheet carrying exactly one inked route line, in the 303's colour.
// The 305 and the 9 are in the panel and drawn nowhere, so what separates them
// is only whether the config says the 305 rides with the 303.
function sheet(routesJson) {
  const dir = scratchDir('qm-fam-' + (seq++) + '-');
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(routesJson));
  fs.writeFileSync(path.join(dir, 'internal.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
    + '<clipPath id="map"><rect x="6" y="30" width="190" height="155"/></clipPath>'
    + '<path d="M20,60 L120,60" fill="none" stroke="#4477aa" stroke-width="2.2"/>'
    + '</svg>');
  return path.join(dir, 'internal.svg');
}
const base = { palette: PALETTE, panelOrder: PANEL_ORDER };
const panelOnly = p => analyse(p).detail.panelOnly.map(d => d.route).sort();

// ---- the shape that threw --------------------------------------------------

test('a STYLED internalCorridors family is read, not thrown on', () => {
  const p = sheet({ ...base, internalCorridors: { '303': { routes: ['305'], style: 'alternate' } } });
  assert.doesNotThrow(() => analyse(p), /is not iterable/);
  assert.deepStrictEqual(panelOnly(p), ['9'],
    'the 305 rides with the 303 and only the 9 is genuinely panel-only');
});

test('a styled family with an explicit block length is read too', () => {
  const p = sheet({ ...base, internalCorridors: { '303': { routes: ['305'], style: 'parallel' } } });
  assert.deepStrictEqual(panelOnly(p), ['9']);
});

test('corridorPalette accepts the object form as well — the same parse, the same hole', () => {
  const p = sheet({ ...base, corridorPalette: { '303': { routes: ['305'] } } });
  assert.deepStrictEqual(panelOnly(p), ['9']);
});

// ---- controls: the array form, and the finding this must not suppress ------

test('CONTROL the plain array form still suppresses its members', () => {
  const p = sheet({ ...base, internalCorridors: { '303': ['305'] } });
  assert.deepStrictEqual(panelOnly(p), ['9']);
});

test('CONTROL with no family at all, BOTH undrawn routes are reported', () => {
  const p = sheet(base);
  assert.deepStrictEqual(panelOnly(p), ['305', '9'],
    'nothing rides with anything, so the 305 is a service in the panel with no line');
});

test('CONTROL a styled family does not silence a route outside it', () => {
  const p = sheet({ ...base, internalCorridors: { '303': { routes: ['305'], style: 'alternate' } } });
  assert.ok(analyse(p).detail.panelOnly.some(d => d.route === '9'),
    'the 9 is in no family and is drawn nowhere — the fix must not blanket-suppress');
});

test('CONTROL the lead itself is judged on its own ink, not excused by leading', () => {
  // The 303 leads the family and IS drawn, so it is not panel-only. Its colour is
  // what makes that true; a fix that excused every lead would pass this anyway,
  // so the case that carries the weight is the next one.
  const p = sheet({ ...base, internalCorridors: { '303': { routes: ['305'], style: 'alternate' } } });
  assert.ok(!analyse(p).detail.panelOnly.some(d => d.route === '303'));
});

test('CONTROL an UNDRAWN lead is still reported — leading a family is not ink', () => {
  const dir = scratchDir('qm-fam-lead-');
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(
    { palette: { '7': '#aa3377', '8': '#66ccee' }, panelOrder: ['7', '8'],
      internalCorridors: { '7': { routes: ['8'], style: 'alternate' } } }));
  fs.writeFileSync(path.join(dir, 'internal.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
    + '<clipPath id="map"><rect x="6" y="30" width="190" height="155"/></clipPath>'
    + '</svg>');
  assert.deepStrictEqual(analyse(path.join(dir, 'internal.svg')).detail.panelOnly.map(d => d.route), ['7'],
    'the 7 leads a family and is drawn nowhere, so it is panel-only; the 8 rides with it');
});
