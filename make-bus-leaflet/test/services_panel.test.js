/*
 * services_panel — the sheet's right-hand column.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3). WHAT IS TESTED
 * HERE IS WHAT THE BYTE GATE CANNOT SEE, measured the same day by
 * `npm run gate:branch-coverage -- tools/branch-coverage.services_panel.js`
 * across the 18 committed maps that draw an internal sheet. Nine of its 35
 * labelled branches came back dark, and they are the subject of this file:
 *
 *   panelScale OFF          0 maps — every town runs the type scale, so the whole
 *                           hand-tuned size set the `absent => byte-identical`
 *                           invariant exists to protect is certified by nothing.
 *   layout panelCols        0 maps — an ENTIRE layout, ~30 lines with three guards
 *                           of its own, drawn by no shipped sheet. High Wycombe is
 *                           the only town with a `panelCols` block and it sets
 *                           `panelCorridors` too, which wins the if/else; its
 *                           `panelCols.keyAt` is read, and nothing else in it is.
 *   subFit below the floor  0 maps — the 2.4 mm refusal.
 *   corridorNote:false,     0 maps each — three of the four corridor-note forms.
 *     town wording, and
 *     the no-palette words
 *   keyCols:1               0 maps — the pre-2026-08-24 single column.
 *   footerSafe:false        0 maps — KROW_FIT's early return.
 *   fareNote                0 maps — the highlighted box is drawn by no sheet.
 *
 * The panel is a pure sink: `drawServicesPanel` returns nothing, so every
 * assertion here reads the lines it appended or the stderr it wrote. Both are
 * captured by `run()` below.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_engine.js');
const { drawServicesPanel } = load('services_panel.js');
const { svgPrimitives } = load('svg_primitives.js');
const FONT = load('font_metrics.js');

// A three-route town, drawn through the REAL svg primitives so badgeXWs and
// badge() behave as they do on a sheet. `pois` earns two Key rows.
const run = (over = {}) => {
  const lines = [];
  const out = (x) => lines.push(x);
  const prim = svgPrimitives({
    out,
    palette: { 1: '#4477AA', 2: '#66CCEE', 3: '#228833' },
    textOn: {},
    badgeLabel: (r) => r,
    font: FONT,
    badgeFit: true,
    editorKeys: false,
  });
  const deps = {
    out, esc: prim.esc, badge: prim.badge, badgeXWs: prim.badgeXWs,
    icon: (cat, x, y) => `<icon cat="${cat}" x="${x}" y="${y}"/>`,
    OV: {},
    RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4,
          internalDesc: undefined },
    DESIGN: {},
    INTDESC: { 1: ['1 Town–Village', 'Mon–Sat'], 2: ['2 Town–Station', 'Mon–Fri'], 3: ['3 Town–Hospital', ''] },
    FONT,
    PANEL_SCALE_ON: true,
    PRINT_SAFE: 5,
    FOOTER_SAFE: true,
    FOOTER_PLATE_TOP: 187.6,
    CORR: null, CPAL: null, laneKey: (r) => r,
    TRIM: { 1: { pts: [[0, 0], [1, 1]] }, 2: { pts: [[0, 0], [1, 1]] }, 3: { pts: [[0, 0], [1, 1]] } },
    panelOrder: ['1', '2', '3'],
    order: ['1', '2', '3'],
    pois: [{ cat: 'shop' }, { cat: 'gp' }],
    FTIER: null,
    FTIER_LABEL: { frequent: 'Frequent — turn up and go', limited: 'Limited — check times' },
    IR: { stroke: 2.6 },
    ICON_INK: '#444', ICON_SET: 'line',
    ...over,
  };
  const real = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = (s) => { err += s; return true; };
  try { drawServicesPanel(deps); } finally { process.stderr.write = real; }
  return { lines, svg: lines.join('\n'), err };
};

// A named text element's font-size, as drawn. The panel is one long string of
// <text> elements, so this is how every size assertion below reads one.
const sizeOf = (svg, words) => {
  const re = new RegExp(`<text[^>]*font-size="([^"]+)"[^>]*>${words}</text>`);
  const m = re.exec(svg);
  assert.ok(m, `no <text> element reading ${JSON.stringify(words)} in the panel`);
  return m[1];
};

// ---------------------------------------------------------------------------
// design.panelScale — 0 of 18 maps turn it off
// ---------------------------------------------------------------------------

test('panelScale off restores the hand-tuned sizes it replaced', () => {
  const on = run({ PANEL_SCALE_ON: true });
  const off = run({ PANEL_SCALE_ON: false });
  // The two section headings are peers and the scale makes them the same size;
  // before it, `Services` was 5 and `Key` was 4.4. That inequality is the whole
  // reason design.panelScale exists, so it is what the off path must restore.
  assert.strictEqual(sizeOf(on.svg, 'Services'), '5');
  assert.strictEqual(sizeOf(on.svg, 'Key'), '5');
  assert.strictEqual(sizeOf(off.svg, 'Services'), '5');
  assert.strictEqual(sizeOf(off.svg, 'Key'), '4.4');
  // Route title 3.5 either way; the subtitle steps 2.9 (scale) -> 2.8 (old).
  assert.strictEqual(sizeOf(on.svg, '1 Town–Village'), '3.5');
  assert.strictEqual(sizeOf(off.svg, '1 Town–Village'), '3.5');
  assert.strictEqual(sizeOf(on.svg, 'Mon–Sat'), '2.9');
  assert.strictEqual(sizeOf(off.svg, 'Mon–Sat'), '2.8');
  // A Key label is 2.9 under the scale and the STRING '3.0' without it — the
  // literal, not the number, because JS renders 3.0 as "3" and that one
  // character failed every byte gate when the key was absent.
  assert.strictEqual(sizeOf(off.svg, 'Supermarket'), '3.0');
});

test('panelScale off steps the list by panelRow and nothing else', () => {
  const { svg } = run({ PANEL_SCALE_ON: false });
  const ys = [...svg.matchAll(/<text x="\d+" y="([\d.]+)"[^>]*font-weight="bold" font-size="3\.5"/g)]
    .map((m) => Number(m[1]));
  assert.strictEqual(ys.length, 3);
  // py starts at 14, +2 for the no-scale nudge, then one panelRow (8) per row;
  // the title baseline sits 0.6mm above the badge centre.
  assert.deepStrictEqual(ys, [23.4, 31.4, 39.4]);
});

// ---------------------------------------------------------------------------
// design.panelCols — an entire layout no committed map reaches
// ---------------------------------------------------------------------------

test('panelCols lays the list out column-major, not row-major', () => {
  const { svg } = run({
    RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4, panelCols: { cols: 2, width: 48, row: 6 } },
  });
  const titles = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-weight="bold" font-size="2\.9" fill="#111">([^<]+)</g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), t: m[3] }));
  assert.strictEqual(titles.length, 3);
  // Three routes over two columns is ceil(3/2)=2 per column: routes 1 and 2 fill
  // column one top-to-bottom, route 3 starts column two at the SAME y as route 1.
  assert.strictEqual(titles[0].t, '1 Town–Village');
  assert.strictEqual(titles[1].t, '2 Town–Station');
  assert.strictEqual(titles[2].t, '3 Town–Hospital');
  assert.strictEqual(titles[0].x, titles[1].x, 'column one shares an x');
  assert.strictEqual(titles[2].x - titles[0].x, 48, 'column two is one width to the right');
  assert.strictEqual(titles[2].y, titles[0].y, 'column-major: row 3 is the top of column two');
  assert.ok(titles[1].y - titles[0].y === 6, 'rows step by panelCols.row');
});

test('panelCols shrinks its badge to the row pitch, and says so at the floor', () => {
  // crow 6 => crow/2-0.5 = 2.5, under the panelBadge-0.6 = 3.4 default.
  const wide = run({ RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4, panelCols: { cols: 2, width: 48, row: 6 } } });
  assert.match(wide.svg, /<circle cx="[\d.]+" cy="[\d.]+" r="2\.5"/);
  assert.ok(!/panelCols: row/.test(wide.err), 'a 6mm row clears the floor silently');
  // 3mm is too tight even at the 1.8mm floor: 2*1.8+0.3 = 4.1 > 3.
  const tight = run({ RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4, panelCols: { cols: 2, width: 48, row: 3 } } });
  assert.match(tight.svg, /<circle cx="[\d.]+" cy="[\d.]+" r="1\.8"/);
  assert.match(tight.err, /panelCols: row 3mm is too tight even at the 1\.8mm badge floor/);
});

test('panelCols measures a subtitle against its own column, not against the trim', () => {
  // A 48mm column starting at x=200 ends at 248; the print-safe trim is at 292.
  // A subtitle that fits the sheet and not the column must still be shrunk —
  // otherwise column one runs underneath column two.
  const long = 'Mon to Saturday, hourly, via the Industrial Estate and the Hospital';
  const { err, svg } = run({
    RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4, panelCols: { cols: 2, width: 48, row: 6 } },
    INTDESC: { 1: ['1 Town–Village', long], 2: ['2 T–S', ''], 3: ['3 T–H', ''] },
  });
  assert.ok(!/BELOW the print floor/.test(err));
  const m = new RegExp(`font-size="([\\d.]+)" fill="#555">${long}<`).exec(svg);
  assert.ok(m, 'the long subtitle is drawn');
  assert.ok(Number(m[1]) < 2.45, `fitted down from 2.45, got ${m[1]}`);
  assert.ok(Number(m[1]) >= 2.4, 'never below the print floor');
});

// ---------------------------------------------------------------------------
// subFit's refusal — 0 of 18 maps reach it
// ---------------------------------------------------------------------------

test('subFit refuses to go under 2.4mm, draws at 2.4 and names the route', () => {
  const huge = 'Monday to Saturday, half hourly, via Great Paxton, Little Paxton, Diddington, Buckden, Brampton and Hinchingbrooke Hospital, then onward to the Park and Ride';
  const { err, svg } = run({ INTDESC: { 1: ['1 Town–Village', huge], 2: ['2 T–S', ''], 3: ['3 T–H', ''] } });
  assert.match(err, /panel: service 1's subtitle .* below the 2\.4mm print floor/);
  assert.match(svg, new RegExp(`font-size="2.4" fill="#555">${huge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
});

test('a subtitle that fits is not touched at all', () => {
  const { err, svg } = run();
  assert.strictEqual(err, '', 'a comfortable panel is silent');
  assert.strictEqual(sizeOf(svg, 'Mon–Sat'), '2.9');
});

// ---------------------------------------------------------------------------
// the corridor note — one of its four forms is taken by one map, three by none
// ---------------------------------------------------------------------------

const CORRIDOR = {
  CORR: { fam: { 1: ['1', '2'] }, lead: { 1: '1', 2: '1' } },
  laneKey: (r) => ({ 1: '1', 2: '1' }[r] || r),
};
const corridorTown = (rj = {}, over = {}) => run({
  ...CORRIDOR,
  DESIGN: { panelCorridors: true },
  RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4, corridorDesc: { 1: ['Village & Station', 'every 20 minutes'] }, ...rj },
  ...over,
});

// The note wraps to the panel width, so it arrives as several <text> elements at
// the column's own x. Joining them back is how any assertion reads its wording.
const noteText = (svg) => [...svg.matchAll(/<text x="200" y="[\d.]+" font-family="Arial" font-size="2\.9" fill="#555">([^<]+)</g)]
  .map((m) => m[1]).join(' ');

test('the corridor note explains the palette only when there IS a palette', () => {
  const withPal = corridorTown({}, { CPAL: { fam: {}, lead: {} } });
  assert.match(noteText(withPal.svg), /routes along the same corridor share a colour\./);
  const noPal = corridorTown();
  assert.match(noteText(noPal.svg), /drawn as one line carrying every number\.$/);
  assert.ok(!/share a colour/.test(noteText(noPal.svg)), 'no palette, no palette sentence');
});

test('corridorNote takes the town wording, and false suppresses it entirely', () => {
  const own = corridorTown({ corridorNote: 'These buses run together through town.' });
  assert.match(own.svg, /These buses run together through town\./);
  assert.ok(!/drawn as one line carrying every number/.test(own.svg));
  const none = corridorTown({ corridorNote: false });
  assert.ok(!/run the same roads through the town/.test(none.svg),
    'corridorNote:false draws no sentence at all');
});

test('a stacked lane hangs its badges above the row and still starts the title at the column x', () => {
  const { svg } = corridorTown();
  const titles = [...svg.matchAll(/<text x="([\d.]+)"[^>]*fill="#111">([^<]+)</g)].map((m) => ({ x: m[1], t: m[2] }));
  // Lane 1 carries routes 1 and 2 and wears corridorDesc; route 3 is its own lane
  // and falls back to internalDesc — with its "3 " prefix dropped, because the
  // badge is drawn beside the title here and would otherwise say the number twice.
  assert.deepStrictEqual(titles.map((t) => t.t), ['Village &amp; Station', 'Town–Hospital']);
  assert.strictEqual(titles[0].x, titles[1].x,
    'a panel is a table: the stacked row and the plain row share one title x');
});

test('the route-number prefix is dropped only under printSafe, and only off a single-service row', () => {
  const on = corridorTown();
  assert.match(on.svg, /fill="#111">Town–Hospital</);
  const off = corridorTown({}, { PRINT_SAFE: null });
  assert.match(off.svg, /fill="#111">3 Town–Hospital</,
    'absent printSafe the title is exactly what internalDesc says');
});

test('a stacked lane with no corridorDesc wears one service\'s words and says so', () => {
  const { err } = corridorTown({ corridorDesc: {} });
  assert.match(err, /no corridorDesc\["1"\] for the 1\/2 lane/);
});

// ---------------------------------------------------------------------------
// the Key
// ---------------------------------------------------------------------------

test('keyCols:1 restores the single column the two-column default replaced', () => {
  const pois = [{ cat: 'shop' }, { cat: 'gp' }, { cat: 'library' }, { cat: 'park' }];
  const one = run({ pois, DESIGN: { keyCols: 1 } });
  const two = run({ pois });
  const xs = (s) => [...s.matchAll(/<icon cat="[a-z]+" x="([\d.]+)"/g)].map((m) => m[1]);
  assert.strictEqual(new Set(xs(one.svg)).size, 1, 'keyCols:1 puts every pictogram at one x');
  assert.strictEqual(new Set(xs(two.svg)).size, 2, 'the default splits four rows over two columns');
});

test('the Key lists only the categories this sheet actually draws', () => {
  const { svg } = run({ pois: [{ cat: 'shop' }, { cat: 'allotments' }] });
  assert.match(svg, /Supermarket</);
  assert.match(svg, /Allotments</);
  assert.ok(!/Doctors \/ GP</.test(svg), 'a category with no POI earns no row');
  // Allotments is appended after the filtered list, not sorted into it.
  assert.ok(svg.indexOf('Supermarket<') < svg.indexOf('Allotments<'));
});

test('footerSafe:false leaves the Key pitch alone however long the Key is', () => {
  const many = ['shop', 'gp', 'pharmacy', 'library', 'museum', 'leisure', 'school', 'park',
    'industrial', 'community', 'townhall'].map((cat) => ({ cat }));
  const tiers = { FTIER: { frequent: { mm: 3.4 }, limited: { mm: 1.6, dash: '3 2' } },
                  RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4, frequency: { 1: 'frequent', 2: 'limited', 3: 'limited' } } };
  const safe = run({ pois: many, ...tiers, FOOTER_SAFE: true, FOOTER_PLATE_TOP: 60 });
  const off = run({ pois: many, ...tiers, FOOTER_SAFE: false, FOOTER_PLATE_TOP: 60 });
  const pitch = (s) => {
    const ys = [...s.matchAll(/<icon cat="[a-z]+" x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    return Number((ys[1] - ys[0]).toFixed(2));
  };
  // A plate at 60mm is far too high for eleven pictogram rows plus two tier rows,
  // so the safe build compresses; footerSafe:false never measures and keeps keyRow.
  assert.ok(pitch(safe.svg) < 4.4, `footerSafe on compresses, got ${pitch(safe.svg)}`);
  assert.strictEqual(pitch(off.svg), 4.4, 'footerSafe off keeps routes.json keyRow');
});

test('a tier row is drawn only for a tier a DRAWN route uses', () => {
  const { svg } = run({
    FTIER: { frequent: { mm: 3.4 }, limited: { mm: 1.6, dash: '3 2' } },
    RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4, frequency: { 1: 'frequent', 9: 'limited' } },
    order: ['1', '2', '3'],       // route 9 is in `frequency` and is not drawn
  });
  assert.match(svg, /Frequent — turn up and go/);
  assert.ok(!/Limited — check times/.test(svg),
    'the tier belongs to a service this sheet does not draw, so it earns no row');
});

// ---------------------------------------------------------------------------
// the fare note — drawn by no committed map
// ---------------------------------------------------------------------------

test('the fare note wraps at 38 characters into a box that grows with the lines', () => {
  const { svg } = run({ RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4,
    fareNote: 'Single fares are capped at £2 on every service shown on this map until the end of 2026.' } });
  const box = /<rect x="198" y="([\d.-]+)" width="95" height="([\d.]+)" rx="1.2" fill="#fff4c2"\/>/.exec(svg);
  assert.ok(box, 'the highlighted box is drawn');
  const lines = [...svg.matchAll(/font-size="2\.9" fill="#333">([^<]+)</g)].map((m) => m[1]);
  assert.strictEqual(lines.length, 3);
  for (const l of lines) assert.ok(l.length <= 38, `"${l}" is ${l.length} characters`);
  assert.strictEqual(lines.join(' '),
    'Single fares are capped at £2 on every service shown on this map until the end of 2026.');
  assert.strictEqual(Number(box[2]), lines.length * 3.6 + 6, 'the box height follows the line count');
});

// ---------------------------------------------------------------------------
// a service badged in the panel with no line on the map
// ---------------------------------------------------------------------------

test('a badged service that draws no line is warned about and labelled on the sheet', () => {
  const { err, svg } = run({ TRIM: { 1: { pts: [[0, 0], [1, 1]] }, 2: { pts: [] } } });
  assert.match(err, /panel: service 2 is badged in the Services panel but draws no line/);
  assert.match(err, /panel: service 3 is badged/);
  assert.match(svg, /Mon–Fri · not shown on this map</);
  // Route 3 has no subtitle of its own, so the note stands alone.
  assert.match(svg, /fill="#555">not shown on this map</);
});

test('the not-shown note falls back to the short form, then keeps the subtitle', () => {
  // Measured, not guessed: at 2.9mm in the 82mm a plain row has, this subtitle is
  // 51.1mm, the long note takes it to 82.7 and the short one to 66.9.
  const near = 'Mon–Fri, hourly via the Industrial Estate';
  const short = run({
    TRIM: {},
    INTDESC: { 1: ['1 Town–Village', near], 2: ['2 T–S', ''], 3: ['3 T–H', ''] },
  });
  assert.match(short.svg, new RegExp(`${near} · not shown<`), 'the long form did not fit, the short one did');
  const nothing = run({
    TRIM: {},
    RJ: { panelRow: 8, keyRow: 4.4, panelBadge: 4, notShownNote: 'x'.repeat(60), notShownNoteShort: 'y'.repeat(60) },
    INTDESC: { 1: ['1 Town–Village', near], 2: ['2 T–S', ''], 3: ['3 T–H', ''] },
  });
  assert.match(nothing.err, /panel: service 1 draws no line, but its row has no room to say so/);
  assert.ok(!/xxx|yyy/.test(nothing.svg), 'neither note is drawn when neither fits');
});
