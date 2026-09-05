/*
 * complexity_ladder — the four rungs that make a big town's internal sheet
 * readable: internalCorridors (1), coreBox (2), stopThinning (2b),
 * corridorPalette (3).
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3). Measured the
 * same day with `npm run gate:branch-coverage -- tools/branch-coverage.complexity_ladder.js`:
 * of the 18 maps with an internal sheet, THREE declare corridor families and
 * exactly ONE — High Wycombe — climbs rungs 2, 2b and 3 at all, so the 20-map
 * byte diff certifies most of this file on a single data point. **14 of the 39
 * labelled branches are dark to it**, and those are what the assertions below
 * are for: every hand override of the coreBox rectangle (`w`, `h`, `at`,
 * `minRun`), the whole object form of `stopThinning` (`minLines`, `keep`,
 * `drop`, `termini:false`), the `coreBox:true` shorthand, the `{routes:[…]}`
 * spelling of a family, a family of one, and the anchor refusal.
 *
 * The one property no map can express and every town depends on is ABSENT =>
 * IDENTITY: with none of the four keys set, laneKey is r=>r, colourShared is
 * false, CORE is null, clipOutCore hands the polyline straight back and
 * thinKeep returns null. Seventeen of the eighteen maps are byte-identical only
 * because that holds, and it is one `||` away from not holding.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { complexityLadder, coreBoxGeometry, thinKeep, parseFamilies, aliasColours, runLen } =
  require('./_engine.js').load('complexity_ladder.js');

const palette = () => ({ 1: '#4477AA', '1A': '#EE6677', '1B': '#228833', 9: '#CCBB44' });

// ---------------------------------------------------------------- absent => identity
test('no ladder keys at all: every derived value is an identity', () => {
  const C = palette(), TXT = { 1: '#fff' };
  const L = complexityLadder({ RJ: {}, C, TXT });
  assert.strictEqual(L.CORR, null);
  assert.strictEqual(L.CPAL, null);
  assert.strictEqual(L.CBOX, null);
  assert.strictEqual(L.THIN, null);
  assert.strictEqual(L.laneKey('1A'), '1A');
  assert.strictEqual(L.colourShared('1A'), false);
  assert.deepStrictEqual(C, palette(), 'the palette must come back untouched');
  assert.deepStrictEqual(TXT, { 1: '#fff' });
});

test('an empty families object is the same as no key at all', () => {
  assert.strictEqual(parseFamilies({}), null);
  assert.strictEqual(parseFamilies(true), null, 'internalCorridors:true declares no families');
  assert.strictEqual(parseFamilies(undefined), null);
});

// ---------------------------------------------------------------- parseFamilies
test('the {routes:[…]} spelling parses identically to the bare array', () => {
  const a = parseFamilies({ 1: ['1A', '1B'] });
  const b = parseFamilies({ 1: { routes: ['1A', '1B'] } });
  assert.deepStrictEqual(b, a);
  assert.deepStrictEqual(a.fam['1'], ['1', '1A', '1B'], 'the lead leads its own family');
  assert.strictEqual(a.lead['1B'], '1');
});

test('a family of one is dropped, not kept as a family', () => {
  assert.strictEqual(parseFamilies({ 1: [] }), null);
  const g = parseFamilies({ 1: [], 9: ['9A'] });
  assert.deepStrictEqual(Object.keys(g.fam), ['9'], 'only the real family survives');
  assert.strictEqual(g.lead['1'], undefined, 'and a dropped lead leads nothing');
});

test('a lead named among its own members is not listed twice', () => {
  const g = parseFamilies({ 1: ['1', '1A'] });
  assert.deepStrictEqual(g.fam['1'], ['1', '1A']);
});

// ---------------------------------------------------------------- aliasColours
test('aliasing recolours members onto the lead and leaves the key set alone', () => {
  const C = palette(), before = Object.keys(C);
  aliasColours(parseFamilies({ 1: ['1A', '1B'] }), C, null);
  assert.strictEqual(C['1A'], C['1'], 'a member takes the lead colour');
  assert.strictEqual(C['1B'], C['1']);
  assert.strictEqual(C['9'], palette()['9'], 'a route outside the family is untouched');
  assert.deepStrictEqual(Object.keys(C), before,
    'Object.keys(C) is the default draw order — aliasing must not add or drop a key');
});

test('a member that is not in the palette is not invented', () => {
  const C = palette();
  aliasColours(parseFamilies({ 1: ['1A', '77'] }), C, null);
  assert.ok(!('77' in C), 'only routes ALREADY in the palette are touched');
});

test('the text-colour map is optional and follows the same rule', () => {
  const C = palette();
  assert.doesNotThrow(() => aliasColours(parseFamilies({ 1: ['1A'] }), C, undefined));
  const TXT = { 1: '#ffffff' };
  aliasColours(parseFamilies({ 1: ['1A', '1B'] }), palette(), TXT);
  assert.ok(!('1A' in TXT), 'a route with no text colour does not acquire one');
});

test('aliasing a null family is a no-op rather than a throw', () => {
  const C = palette();
  aliasColours(null, C, null);
  assert.deepStrictEqual(C, palette());
});

// ---------------------------------------------------------------- the config reads
test('coreBox:true and stopThinning:true are the all-defaults shorthand', () => {
  const L = complexityLadder({ RJ: { coreBox: true, stopThinning: true }, C: palette(), TXT: null });
  assert.deepStrictEqual(L.CBOX, {}, 'true means "the box, with every default"');
  assert.deepStrictEqual(L.THIN, {});
});

test('rung 3 shares a colour without sharing a lane', () => {
  const C = palette();
  const L = complexityLadder({ RJ: { corridorPalette: { 1: ['9'] } }, C, TXT: null });
  assert.strictEqual(C['9'], C['1'], 'the colour is shared');
  assert.strictEqual(L.laneKey('9'), '9', 'but the lane is NOT — rung 3 keeps both lines');
  assert.strictEqual(L.colourShared('9'), true, 'so the badge pass must guarantee it a badge');
});

test('rung 1 shares the lane as well, which is what makes one line out of three', () => {
  const L = complexityLadder({ RJ: { internalCorridors: { 1: ['1A', '1B'] } }, C: palette(), TXT: null });
  assert.strictEqual(L.laneKey('1A'), '1');
  assert.strictEqual(L.laneKey('9'), '9', 'a route outside every family is its own lane');
  assert.strictEqual(L.colourShared('1A'), false, 'colourShared is rung 3 only');
});

// ---------------------------------------------------------------- coreBoxGeometry
const XY = ([lat, lon]) => [lon * 1000, -lat * 1000];       // a plain linear stand-in
const atco2ll = { ANCH: [52.0, -0.1] };
const geom = (CBOX, refuse = () => {}) =>
  coreBoxGeometry({ CBOX, ANCHOR: 'ANCH', atco2ll, XY, refuse });

test('no coreBox: no rectangle, nothing inside it, and the polyline comes back whole', () => {
  const g = geom(null);
  assert.strictEqual(g.CORE, null);
  assert.strictEqual(g.inCore([0, 0]), false);
  const pts = [[0, 0], [1, 1], [2, 2]];
  const runs = g.clipOutCore(pts);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0], pts, 'the SAME array, not a copy — this is the identity path');
});

test('an anchor with no coordinate refuses rather than drawing a box at the origin', () => {
  const said = [];
  const g = coreBoxGeometry({ CBOX: { radius: 600 }, ANCHOR: 'NOPE', atco2ll, XY, refuse: m => said.push(m) });
  assert.strictEqual(g.CORE, null);
  assert.strictEqual(said.length, 1);
  assert.match(said[0], /^coreBox: anchor NOPE has no coordinate/);
});

test('the box is the bounding box of a projected circle, centred on the anchor', () => {
  const { CORE } = geom({ radius: 600 });
  const [ax, ay] = XY(atco2ll.ANCH);
  assert.ok(Math.abs((CORE.x0 + CORE.x1) / 2 - ax) < 1e-6, 'centred in x');
  assert.ok(Math.abs((CORE.y0 + CORE.y1) / 2 - ay) < 1e-6, 'centred in y');
  assert.ok(CORE.x1 > CORE.x0 && CORE.y1 > CORE.y0);
  assert.strictEqual(CORE.label, 'town centre', 'the default label');
  assert.strictEqual(CORE.sublabel, null);
});

test('radius is in metres, so doubling it doubles the box', () => {
  const a = geom({ radius: 600 }).CORE, b = geom({ radius: 1200 }).CORE;
  assert.ok(Math.abs((b.x1 - b.x0) / (a.x1 - a.x0) - 2) < 1e-6);
});

test('w and h override the size about the centre, without moving it', () => {
  const base = geom({ radius: 600 }).CORE;
  const { CORE } = geom({ radius: 600, w: 40, h: 20 });
  assert.ok(Math.abs(CORE.x1 - CORE.x0 - 40) < 1e-9);
  assert.ok(Math.abs(CORE.y1 - CORE.y0 - 20) < 1e-9);
  assert.ok(Math.abs((CORE.x0 + CORE.x1) / 2 - (base.x0 + base.x1) / 2) < 1e-9, 'still centred');
});

test('at moves the box by hand and keeps whatever size it already had', () => {
  const sized = geom({ radius: 600, w: 40, h: 20 }).CORE;
  const { CORE } = geom({ radius: 600, w: 40, h: 20, at: [100, 200] });
  assert.deepStrictEqual([CORE.x0, CORE.x1, CORE.y0, CORE.y1], [80, 120, 190, 210]);
  assert.ok(Math.abs((CORE.x1 - CORE.x0) - (sized.x1 - sized.x0)) < 1e-9, 'the size is preserved');
});

test('an empty label is honoured, and a sublabel is carried through', () => {
  assert.strictEqual(geom({ radius: 600, label: '' }).CORE.label, '',
    'label:"" means no words, not "fall back to town centre"');
  assert.strictEqual(geom({ radius: 600, sublabel: 'bus station' }).CORE.sublabel, 'bus station');
});

test('inCore is inclusive of the boundary', () => {
  const { CORE, inCore } = geom({ radius: 600, w: 40, h: 20, at: [0, 0] });
  assert.strictEqual(inCore([0, 0]), true);
  assert.strictEqual(inCore([CORE.x1, CORE.y1]), true, 'on the corner counts as inside');
  assert.strictEqual(inCore([CORE.x1 + 0.01, 0]), false);
});

// ---------------------------------------------------------------- clipOutCore
const box = extra => geom(Object.assign({ radius: 600, w: 40, h: 20, at: [0, 0] }, extra));

test('a line crossing the centre comes out as two runs, each ending ON the boundary', () => {
  const { clipOutCore } = box();
  const runs = clipOutCore([[-100, 0], [-10, 0], [10, 0], [100, 0]]);
  assert.strictEqual(runs.length, 2, 'it visibly runs TO the box from both sides');
  assert.ok(Math.abs(runs[0][runs[0].length - 1][0] + 20) < 1e-6, 'first run stops on the west edge');
  assert.ok(Math.abs(runs[1][0][0] - 20) < 1e-6, 'second run starts on the east edge');
});

test('the clip tests VERTICES, so a single segment jumping the whole box is not cut', () => {
  // Not a defect and not hypothetical: a matched road polyline has a vertex every
  // few metres, so this cannot arise from real geometry. It is written down
  // because the rule is "no vertex inside" and not "does not intersect", and a
  // reader who assumes the second would mis-predict a straight-chord CLASSIC map.
  const { clipOutCore } = box();
  assert.strictEqual(clipOutCore([[-100, 0], [100, 0]]).length, 1);
});

test('a line that never meets the box is handed back as one run', () => {
  const { clipOutCore } = box();
  assert.strictEqual(clipOutCore([[-100, 500], [100, 500]]).length, 1);
});

test('a stub shorter than minRun is dropped, so no badge is planted on a phantom branch', () => {
  const { clipOutCore } = box();                       // minRun defaults to 2.5 mm
  const runs = clipOutCore([[-21, 0], [-100, 0]]);     // a 1 mm poke out of the west edge
  assert.strictEqual(runs.length, 1, 'the long run survives');
  assert.ok(runLen(runs[0]) >= 2.5);
  assert.strictEqual(clipOutCore([[-21, 0], [-20.5, 0]]).length, 0, 'the 0.5 mm stub is gone');
});

test('minRun:0 keeps every stub — the escape hatch is real', () => {
  const { clipOutCore } = box({ minRun: 0 });
  assert.strictEqual(clipOutCore([[-21, 0], [-20.5, 0]]).length, 1);
});

test('runLen measures the polyline, not the straight line between its ends', () => {
  assert.strictEqual(runLen([[0, 0], [3, 4]]), 5);
  assert.strictEqual(runLen([[0, 0], [3, 4], [3, 0]]), 9);
  assert.strictEqual(runLen([[1, 1]]), 0, 'one point has no length');
});

// ---------------------------------------------------------------- thinKeep
const chains = { 1: ['A', 'B', 'C', 'D'], '1A': ['A', 'B', 'C', 'D'], 9: ['C', 'E', 'F'] };
const order = ['1', '1A', '9'];
const thin = (THIN, laneKey = r => r) => thinKeep({ THIN, order, routes: chains, laneKey, ANCHOR: 'HUB' });

test('no stopThinning: null, and the caller reads that as "every stop keeps its tick"', () => {
  assert.strictEqual(thin(null), null);
});

test('an interchange is counted by DRAWN LINES, so a bundled family counts once', () => {
  const bundled = thin({}, r => (r === '1A' ? '1' : r));
  assert.ok(!bundled.has('B'), 'B is served only by the 1/1A bundle — one line, not two');
  const unbundled = thin({});
  assert.ok(unbundled.has('B'), 'without the bundle the same stop has two lines and stays');
});

test('every line keeps its two end stops, and the anchor always stays', () => {
  const keep = thin({});
  for (const a of ['A', 'D', 'C', 'F', 'HUB']) assert.ok(keep.has(a), a + ' should be kept');
  assert.ok(!keep.has('E'), 'a plain intermediate stop on one line goes');
});

test('termini:false drops the end stops and leaves only the interchanges', () => {
  const keep = thin({ termini: false }, r => (r === '1A' ? '1' : r));
  assert.ok(!keep.has('A'), 'the terminus is no longer automatic');
  assert.ok(keep.has('C'), 'C is served by two lanes, so it survives on its own merit');
});

test('minLines raises the bar for what counts as an interchange', () => {
  assert.ok(thin({ minLines: 2, termini: false }).has('B'));
  assert.ok(!thin({ minLines: 3, termini: false }).has('B'), 'two lines is no longer enough');
});

test('the hand keep list adds a stop that earned nothing', () => {
  assert.ok(thin({ keep: ['E'] }).has('E'));
});

test('the hand drop list is applied LAST and beats everything, including the anchor', () => {
  assert.ok(!thin({ drop: ['A'] }).has('A'), 'a terminus can be dropped by hand');
  assert.ok(!thin({ keep: ['E'], drop: ['E'] }).has('E'), 'drop wins over keep');
  assert.ok(!thin({ drop: ['HUB'] }).has('HUB'), 'and over the automatic anchor');
});

test('a route with no chain is skipped rather than throwing', () => {
  const keep = thinKeep({ THIN: {}, order: ['1', 'GHOST'], routes: { 1: ['A', 'B'] },
                          laneKey: r => r, ANCHOR: 'HUB' });
  assert.ok(keep.has('A'));
});

// ------------------------------------------------ a family with a style (OA-176 4.24)
// The shared section drawn once: a styled family keeps every member's colour and
// still takes one lane. Ramsey's S1 says the 303 must not be colour-merged with
// the 305, so the difference between these and the plain bundle is the whole point.
test('a styled family is parsed with its style and a default block length', () => {
  const g = parseFamilies({ 303: { routes: ['305'], style: 'alternate' } });
  assert.deepStrictEqual(g.fam, { 303: ['303', '305'] });
  assert.deepStrictEqual(g.style, { 303: { kind: 'alternate', block: 3 } });
  const h = parseFamilies({ 303: { routes: ['305'], style: 'parallel', block: 2 } });
  assert.deepStrictEqual(h.style, { 303: { kind: 'parallel', block: 2 } });
});

test('a plain family, in either spelling, carries no style', () => {
  assert.deepStrictEqual(parseFamilies({ 1: ['1A'] }).style, {});
  assert.deepStrictEqual(parseFamilies({ 1: { routes: ['1A'] } }).style, {});
});

test('an unknown style is refused, not drawn as the plain bundle', () => {
  assert.throws(() => parseFamilies({ 303: { routes: ['305'], style: 'stripy' } }), /style "stripy"/,
    'a typo that silently recoloured the 305 green would be exactly the merge S1 forbids');
});

test('a styled family keeps its colours; a plain family beside it is still aliased', () => {
  const C = Object.assign(palette(), { 303: '#228833', 305: '#CCBB44' });
  aliasColours(parseFamilies({ 303: { routes: ['305'], style: 'alternate' }, 1: ['1A'] }), C, null);
  assert.strictEqual(C['305'], '#CCBB44', 'the styled member keeps its own colour');
  assert.strictEqual(C['1A'], C['1'], 'the plain family next to it is aliased as before');
});

test('a styled family still takes ONE lane', () => {
  const L = complexityLadder({ RJ: { internalCorridors: { 303: { routes: ['305'], style: 'parallel' } } },
    C: { 303: '#228833', 305: '#CCBB44' }, TXT: null });
  assert.strictEqual(L.laneKey('305'), '303');
  assert.strictEqual(L.CORR.style['303'].kind, 'parallel');
});

test('a style on a corridorPalette group is refused', () => {
  assert.throws(() => complexityLadder({ RJ: { corridorPalette: { 31: { routes: ['41'], style: 'alternate' } } },
    C: palette(), TXT: null }), /corridorPalette 31/);
});
