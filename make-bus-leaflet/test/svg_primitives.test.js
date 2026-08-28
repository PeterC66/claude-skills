/*
 * svg_primitives — the small marks the internal sheet is drawn out of.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3). MEASURED across
 * the 18 committed maps that have an internal sheet on the same day: seven draw
 * at least one STADIUM badge (High Wycombe 4, March 5, Ramsey 7, St Ives 1, High
 * Wycombe Aldi 4, St Ives Bus Station 2, Ely Co-op 8), so the badgeFit shape
 * change is well covered by the byte gate. Two things are NOT. `design.badgeFit`
 * is false on ZERO maps, so the whole opt-out is a dark branch. And `gk()` emits
 * nothing at all unless EDITOR_KEYS=1, which the byte gate never sets — that one
 * is certified separately by rendering all 20 maps with EDITOR_KEYS=1 before and
 * after the extraction (18 of them emit data-kind attrs; every SVG hash matched).
 *
 * `cross()` was here until 2026-08-27 and is gone: it had no caller anywhere,
 * and OA-136's Phase 4 pass retired it. Removing it moved no bytes on any of the
 * 20 maps, which is what dark means when it is true.
 *
 * ONE CLAIM HERE WAS WRONG AND THE MUTATION RUN SAID SO. The module comments
 * present badgeStack's one-element fast path as the invariant that keeps every
 * unbundled town byte-identical. It is not: deleting the fast path entirely and
 * letting a one-element list go round the general loop produces the same bytes
 * and the same return value at every radius, because y0 collapses to y and
 * (n-1)/2*pitch collapses to 0. It is an optimisation, not a behavioural branch,
 * and the mutation written to break it survived because there was nothing to
 * break. The assertion below stays — it is the right thing to pin — but it is
 * pinning a consequence of the arithmetic, not a fork in it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { svgPrimitives } = require('./_engine.js').load('svg_primitives.js');
const FONT = require('./_engine.js').load('font_metrics.js');

// A two-route town: one route with a colour and a text colour, one with neither,
// so the `||` fallbacks in badge() are exercised.
const make = (over = {}) => {
  const lines = [];
  const api = svgPrimitives({
    out: (x) => lines.push(x),
    palette: { 9: '#66CCEE', '301S': '#EE6677' },
    textOn: { 9: '#000' },
    badgeLabel: (r) => (r === 'X' ? 'X31' : r),
    font: FONT,
    badgeFit: true,
    editorKeys: false,
    ...over,
  });
  return { api, lines };
};

test('esc escapes the three XML text characters and leaves quotes alone', () => {
  const { api } = make();
  assert.strictEqual(api.esc('Fish & Chips'), 'Fish &amp; Chips');
  assert.strictEqual(api.esc('<b>a</b>'), '&lt;b&gt;a&lt;/b&gt;');
  assert.strictEqual(api.esc(9), '9', 'a non-string route key must not throw');
  // Deliberate record, not an endorsement: a double quote passes through, and
  // gk() drops esc()'s output straight into a double-quoted attribute. No
  // committed key contains one; a key that did would produce invalid SVG.
  assert.strictEqual(api.esc('a"b'), 'a"b');
});

test('gk is completely inert unless editorKeys is set', () => {
  const off = make({ editorKeys: false }).api;
  assert.strictEqual(off.gk('stop', 'K1', '<circle/>'), '<circle/>');
  const on = make({ editorKeys: true }).api;
  assert.strictEqual(on.gk('stop', 'K1', '<circle/>'),
    '<g data-kind="stop" data-key="K1"><circle/></g>');
});

test('gk escapes the key it puts in the attribute', () => {
  const on = make({ editorKeys: true }).api;
  assert.strictEqual(on.gk('feature', 'Ouse & Nene', 'x'),
    '<g data-kind="feature" data-key="Ouse &amp; Nene">x</g>');
});

test('badgeFit off returns the radius for every key, however long — 0 maps take this branch', () => {
  const { api } = make({ badgeFit: false });
  assert.strictEqual(api.badgeHalfW('301S', 2.4), 2.4);
  assert.strictEqual(api.badgeHalfW('9', 2.4), 2.4);
  assert.strictEqual(api.badgeXW('301S', 2.4), 0);
  assert.strictEqual(api.badgeXWs(['301S', 'VL14'], 2.4), 0);
});

test('a key that fits the diameter less 0.3mm keeps its disc', () => {
  const { api } = make();
  // X31 at a 2.4mm stop badge is 4.27mm wide against a 4.5mm allowance — the
  // widest committed three-character key, and the reason the inset is 0.3 and
  // not 0. The figure is quoted in the module's own comment.
  assert.strictEqual(Number(FONT.textWidth('X31', 2.4, true).toFixed(2)), 4.27);
  assert.strictEqual(api.badgeHalfW('X31', 2.4), 2.4);
  assert.strictEqual(api.badgeXW('X31', 2.4), 0);
});

test('the 0.3mm inset itself decides the band between 4.50 and 4.80mm', () => {
  const { api } = make();
  // NO COMMITTED KEY LANDS IN THAT BAND — X31, the widest that ships, is 4.27mm
  // and the next size up is a four-character key well past 4.80. So the inset's
  // decision boundary is a dark sub-branch of a branch the byte gate does cover,
  // and '10M' is synthetic, picked because it falls inside it at 4.669mm. Drop
  // the inset and this key stops being a pill; that is the whole of its effect.
  const w = FONT.textWidth('10M', 2.4, true);
  assert.ok(w > 2 * 2.4 - 0.3 && w < 2 * 2.4, `premise: ${w} is inside the band`);
  assert.strictEqual(api.badgeHalfW('10M', 2.4), w / 2 + 0.35 * 2.4);
  assert.ok(api.badgeXW('10M', 2.4) > 0, 'inside the band is a stadium, not a disc');
});

test('a four-character key becomes a stadium of half-width w/2 + 0.35r', () => {
  const { api } = make();
  const w = FONT.textWidth('301S', 2.4, true);
  assert.ok(w > 2 * 2.4 - 0.3, 'premise: 301S does not fit a 2.4mm disc');
  assert.strictEqual(api.badgeHalfW('301S', 2.4), w / 2 + 0.35 * 2.4);
  assert.strictEqual(api.badgeXW('301S', 2.4), w / 2 + 0.35 * 2.4 - 2.4);
});

test('the badge is sized on what is PRINTED, not on the route key', () => {
  const { api, lines } = make({ badgeLabel: (r) => (r === 'X' ? '301S' : r) });
  // Comparing badgeHalfW('X') with badgeHalfW('301S') is not enough on its own:
  // measuring the key instead of the label would give 'X' a disc and '301S' a
  // stadium, and a suite that only compares two disc widths would not notice.
  // So assert the SHAPE, and the width it drew.
  assert.strictEqual(api.badgeHalfW('X', 2.4), api.badgeHalfW('301S', 2.4));
  api.badge(100, 50, 'X', 2.4);
  assert.match(lines[0], /^<rect /, 'a one-character key with a four-character label is a stadium');
  assert.match(lines[0], new RegExp(`width="${(2 * api.badgeHalfW('301S', 2.4)).toFixed(2)}"`));
  assert.match(lines[1], />301S<\/text>$/);
});

test('badgeXWs is the widest EXTRA in the list, and zero for an empty one', () => {
  const { api } = make();
  assert.strictEqual(api.badgeXWs([], 2.4), 0);
  assert.strictEqual(api.badgeXWs(['9', 'X31'], 2.4), 0, 'a list that all fits adds nothing');
  assert.strictEqual(api.badgeXWs(['9', '301S', 'VL14'], 2.4),
    Math.max(api.badgeXW('301S', 2.4), api.badgeXW('VL14', 2.4)));
});

test('badge draws a circle then its text, and returns 0 extra width', () => {
  const { api, lines } = make();
  const xw = api.badge(100, 50, 9, 2.4);
  assert.strictEqual(xw, 0);
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /^<circle cx="100" cy="50" r="2.4" fill="#66CCEE" stroke="#fff" stroke-width="0.7"\/>$/);
  assert.match(lines[1], /font-size="2.40"/, 'the type is the size of the RADIUS — the badgeFit premise');
  assert.match(lines[1], /fill="#000"/);
  assert.match(lines[1], />9<\/text>$/);
});

test('badge falls back to grey on unknown colour and white on unknown text colour', () => {
  const { api, lines } = make();
  api.badge(10, 20, '77', 2.4);
  assert.match(lines[0], /fill="#888"/);
  assert.match(lines[1], /fill="#fff"/);
});

test('badge draws a rect for a long key, still at font-size = radius, and reports the overhang', () => {
  const { api, lines } = make();
  const xw = api.badge(100, 50, '301S', 2.4);
  const hw = api.badgeHalfW('301S', 2.4);
  assert.strictEqual(xw, hw - 2.4);
  assert.ok(xw > 0);
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /^<rect /);
  assert.match(lines[0], new RegExp(`width="${(2 * hw).toFixed(2)}"`));
  assert.match(lines[0], /height="4.80" rx="2.4"/, 'the ends stay semicircular — a stadium, not a box');
  assert.match(lines[1], /font-size="2.40"/, 'the shape gave way, not the type');
});

test('a one-element badgeStack is byte-identical to badge at the same centre', () => {
  const a = make(); a.api.badge(100, 50, 9, 2.6);
  const b = make(); const r = b.api.badgeStack(100, 50, [9], 2.6);
  assert.deepStrictEqual(b.lines, a.lines);
  assert.deepStrictEqual(r, { h: 2.6, xw: 0 });
});

test('a bundled stack pitches its members by 2r+0.5 about the given centre', () => {
  const { api, lines } = make();
  const rad = 2.4, pitch = rad * 2 + 0.5;
  // THIS TEST USED [9, 9, 9] UNTIL 2026-08-28, one route key three times, purely
  // because repeating a key was the shortest way to get three discs out of the
  // stack. That was free while nothing deduped; under OA-024's dedupe-by-printed-
  // label it is one identity and draws once, so the premise expired and the test
  // went red for a reason that had nothing to do with pitching. Three DISTINCT
  // labels is what the assertion was always about.
  const r = api.badgeStack(100, 50, [9, 8, 7], rad);
  // Compared as the emitted STRINGS, because a circle's cx/cy go into the SVG
  // unrounded — only the rect branch runs them through toFixed(2). The third
  // disc really is written as cy="55.300000000000004", and any future rounding
  // of these two attributes would move bytes on every map.
  const y0 = 50 - (3 - 1) / 2 * pitch;
  const ys = lines.filter((l) => l.startsWith('<circle')).map((l) => /cy="([-0-9.e]+)"/.exec(l)[1]);
  assert.deepStrictEqual(ys, [String(y0), String(y0 + pitch), String(y0 + 2 * pitch)]);
  // And the arithmetic PATH matters, not only the arrangement: walking up from
  // y0 gives 55.300000000000004 where 50 + pitch gives 55.3. Both are the same
  // place on the page and they are not the same bytes.
  assert.strictEqual(ys[2], '55.300000000000004');
  assert.notStrictEqual(ys[2], String(50 + pitch));
  assert.strictEqual(r.h, pitch + rad, 'half-height covers the outermost disc, not just the centres');
});

test('a stack reports the widest overhang any of its members drew', () => {
  const { api } = make();
  const r = api.badgeStack(100, 50, [9, '301S'], 2.4);
  assert.strictEqual(r.xw, api.badgeXW('301S', 2.4));
  assert.strictEqual(make().api.badgeStack(100, 50, [9, 9], 2.4).xw, 0);
});

test('the factory returns exactly the seven marks the sheet is drawn out of', () => {
  // cross() was the eighth until 2026-08-27, when OA-136 retired it for having no
  // caller anywhere. This assertion is here so the next person to add a primitive
  // has to say so out loud, rather than leaving one to go quietly unused for
  // weeks behind a name another generator uses for something else entirely.
  assert.deepStrictEqual(Object.keys(make().api).sort(),
    ['badge', 'badgeHalfW', 'badgeStack', 'badgeXW', 'badgeXWs', 'esc', 'gk']);
});

/*
 * OA-024. `badgeLabels` exists so several route keys can print the same text, and
 * a stack drew one badge per MEMBER — so a bundled 301 family printed "301" three
 * times down one lane, which is one identity drawn three times and two badges
 * carrying nothing. The stack is a list of identities a reader can tell apart.
 */
test('a stack dedupes by what is PRINTED, not by route key', () => {
  const { api, lines } = make({ badgeLabel: (r) => (String(r).startsWith('301') ? '301' : String(r)) });
  const r = api.badgeStack(100, 50, ['301', '301A', '301B'], 2.6);
  const texts = lines.filter((l) => l.startsWith('<text')).map((l) => />([^<]*)</.exec(l)[1]);
  assert.deepStrictEqual(texts, ['301'], 'three members printing "301" are one badge');
  // and it collapses to the one-element geometry, not to a three-high stack
  assert.deepStrictEqual(r, { h: 2.6, xw: 0 });
});

test('members printing DIFFERENT text all keep their badge', () => {
  const { api, lines } = make();
  api.badgeStack(100, 50, [9, '301S'], 2.6);
  const texts = lines.filter((l) => l.startsWith('<text')).map((l) => />([^<]*)</.exec(l)[1]);
  assert.deepStrictEqual(texts, ['9', '301S'], 'a real family with distinct numbers is untouched');
});

test('dedupe keeps the FIRST member, so the group leader supplies the drawn colour', () => {
  const { api, lines } = make({
    palette: { A: '#111111', B: '#222222' },
    badgeLabel: () => '7',        // short, so it stays a disc rather than a stadium
  });
  api.badgeStack(100, 50, ['A', 'B'], 2.6);
  const fills = lines.filter((l) => l.startsWith('<circle')).map((l) => /fill="([^"]*)"/.exec(l)[1]);
  assert.deepStrictEqual(fills, ['#111111']);
});

// ------------------------------------------- separateRow (OA-060, 2026-08-28)
/*
 * The terminus lozenges on an external sheet were each clamped to the page and
 * the footer plate ALONE, so two destinations whose spokes both end low were
 * pushed onto the same line and printed on each other. Six of the estate's seven
 * lozenge overlaps were that, the worst being Huntingdon burying "Cambridge"
 * under "Addenbrooke's" by 13.46 x 14.60mm.
 */
const { separateRow } = require('./_engine.js').load('svg_primitives.js');

// No two boxes may overlap, and with fits:true none may leave the bounds.
function check(t, items, lo, hi, gap, r) {
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    assert.ok(Math.abs(r.centres[i] - r.centres[j]) >= items[i].hw + items[j].hw - 1e-9,
      t + ': boxes ' + i + ' and ' + j + ' still overlap');
  }
  if (r.fits) for (let i = 0; i < items.length; i++) {
    assert.ok(r.centres[i] - items[i].hw >= lo - 1e-9 && r.centres[i] + items[i].hw <= hi + 1e-9,
      t + ': box ' + i + ' left the bounds while reporting fits');
  }
}

test('a row that is already clear is not moved at all', () => {
  // The byte gate depends on this: every external sheet with no lozenge
  // collision must render exactly as before, or 17 sheets re-render for nothing.
  const items = [{ c: 50, hw: 5 }, { c: 70, hw: 5 }, { c: 90, hw: 5 }];
  const r = separateRow(items, 0, 300, 1);
  assert.deepStrictEqual(r.centres, [50, 70, 90]);
  assert.strictEqual(r.fits, true);
});

test('two boxes on top of each other are separated, and share the movement', () => {
  // Huntingdon's shape. A forward-only pass leaves the left box alone and shoves
  // the right one the whole way; on this sheet x is roughly the direction you
  // travel to reach the place, so 31mm of one-sided shove is a claim about
  // geography. Half each is the honest repair.
  const items = [{ c: 180, hw: 20 }, { c: 172, hw: 18 }];
  const r = separateRow(items, 24, 282, 1);
  check('pair', items, 24, 282, 1, r);
  assert.ok(r.fits);
  assert.ok(Math.abs((r.centres[0] - 180) + (r.centres[1] - 172)) < 1e-9,
    'the two moves should cancel, i.e. the run stays centred where it was');
});

test('a run pinned against the far edge is pulled back inside it', () => {
  const items = [{ c: 270, hw: 20 }, { c: 265, hw: 20 }];
  const r = separateRow(items, 24, 282, 1);
  check('edge', items, 24, 282, 1, r);
  assert.ok(r.fits);
});

test('input order is preserved however the boxes are sorted', () => {
  // The caller indexes the result by branch, so a returned array in sorted order
  // would silently attach every destination name to the wrong box.
  const items = [{ c: 200, hw: 10 }, { c: 100, hw: 10 }, { c: 150, hw: 10 }];
  const r = separateRow(items, 0, 300, 1);
  assert.deepStrictEqual(r.centres, [200, 100, 150]);
});

test('a row too wide for its bounds says so instead of pretending', () => {
  // AND the feasibility answer must not be produced by the repair. The first cut
  // asked after distributing, and the left-hand clamp had by then shoved the run
  // off the right of the page — so the left edge was legal and it reported true.
  const items = [{ c: 50, hw: 30 }, { c: 60, hw: 30 }];
  const r = separateRow(items, 24, 100, 1);
  assert.strictEqual(r.fits, false);
  check('narrow', items, 24, 100, 1, r);       // still separated, just overflowing
  assert.ok(r.centres[1] + 30 > 100, 'the overflow should be visible, not hidden');
});

test('one box, and no boxes, are both handled', () => {
  assert.deepStrictEqual(separateRow([{ c: 50, hw: 5 }], 0, 300, 1), { centres: [50], fits: true });
  assert.deepStrictEqual(separateRow([], 0, 300, 1), { centres: [], fits: true });
});
