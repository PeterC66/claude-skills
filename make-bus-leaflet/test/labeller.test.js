/*
 * labeller.js — the shared label placer.
 *
 * The faults this project has actually paid for are the shape of these tests.
 * Two labels drawn over each other. A label dropped silently because the first
 * candidates happened to be taken, leaving no trace in the SVG at all. A
 * destination label queued mustPlace with an inboard-only shortlist, which
 * composed into "must overprint" and printed "to Cambridge" into a route badge.
 * And the invariant the whole engine rests on: same input, same bytes.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Labeller, Grid, POSITIONS, DEFAULTS } = require('./_engine.js').load('labeller.js');

const page = () => new Labeller({ page: [100, 100] });
const overlap = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

/* ---- OA-062: `prefer` was computed for 81 of 83 spokes and thrown away ----
 *
 * gen_external_radial.js steers each spoke's stop labels onto the open side and
 * packs the perpendicular into `prefer`. This class read sixteen item properties
 * and that was not one of them, so every `side` in every town's config had done
 * nothing since labels engine v2 became the default.
 *
 * A FIXTURE PER CLAUSE. The first proves it is READ (the label crosses to the
 * asked-for side of a clean page, which the cartographic order would never
 * choose); the second proves it is a PREFERENCE and not a rule (a preferred side
 * buried in ink is abandoned); the third proves an absent `prefer` is byte-for-
 * byte the old behaviour, because every internal sheet depends on that.
 */
test('a stated `prefer` direction moves the label to that side', () => {
  const plain = page().add({ id: 'a', at: [50, 50], text: 'Fenstanton', size: 3 });
  assert.strictEqual(plain.solve()[0].pos, 'E', 'premise: the free placer goes east');

  const west = page().add({ id: 'a', at: [50, 50], text: 'Fenstanton', size: 3, prefer: [-1, 0] });
  assert.strictEqual(west.solve()[0].pos, 'W', 'the caller asked for the other side');
});

test('...but it is a preference, not a rule, and yields to ink', () => {
  const L = new Labeller({ page: [100, 100] });
  // Paint the whole western half solid, then ask for west anyway.
  for (let y = 20; y < 80; y += 0.4) L.stampSeg([2, y], [49, y], 1.2);
  L.add({ id: 'a', at: [50, 50], text: 'Fenstanton', size: 3, prefer: [-1, 0] });
  const [r] = L.solve();
  assert.ok(r.placed, 'a preference must never cost a label');
  assert.ok(r.b[0] >= 50, 'it crossed to the clear side rather than sitting on the ink');
});

test('a label with no `prefer` is costed exactly as before', () => {
  const L = page().add({ id: 'a', at: [50, 50], text: 'Fenstanton', size: 3 });
  const [r] = L.solve();
  assert.strictEqual(L._preference(r.it, r.b), 0, 'the term must be inert when nothing asked');
});

/* ---- OA-176 4.20: a leader drawn out of the middle of its own badge -------
 *
 * Found from the outside, at magnification, on the Ramsey internal sheet: the
 * leader starts at the disc's centre and labels are painted last, so it crosses
 * the digit. Measured there — r=3.0 discs at x=158.22, leaders 5.01mm long, so
 * three fifths of each one was drawn on the badge it came out of.
 *
 * The second assertion is the one that keeps this honest: a fix that simply
 * stopped drawing leaders would satisfy the first.
 */
test('a leader starts at the rim of its own symbol, not at its centre', () => {
  const L = new Labeller({ page: [100, 100] });
  const own = [47, 47, 53, 53];                 // a 6mm badge centred on the point
  // A band of claimed space around the point, deep enough that both close rings
  // and the first leader ring are refused and only the outer one is clear.
  L.block([30, 44, 70, 56]);
  L.add({ id: 'a', at: [50, 50], text: 'Bury', size: 3, own });
  const [r] = L.solve();
  assert.ok(r.placed && r.leader, 'test premise: this label needed a leader');
  const [sx, sy] = r.leader[0];
  assert.ok(sx <= own[0] || sx >= own[2] || sy <= own[1] || sy >= own[3],
    `the leader still starts inside the symbol, at ${sx.toFixed(2)},${sy.toFixed(2)}`);
  assert.ok(Math.hypot(r.leader[1][0] - sx, r.leader[1][1] - sy) > 0.3,
    'and it is still a line, not a fix that stopped drawing them');
});

test('a leader from a symbol-less point still starts at the point', () => {
  const L = new Labeller({ page: [100, 100] });
  L.block([30, 44, 70, 56]);
  L.add({ id: 'a', at: [50, 50], text: 'Bury', size: 3 });
  const [r] = L.solve();
  assert.ok(r.placed && r.leader, 'test premise: this label needed a leader');
  assert.deepStrictEqual(r.leader[0].map(v => +v.toFixed(4)), [50, 50]);
});

test('an unobstructed label takes the first cartographic preference', () => {
  const L = page().add({ id: 'a', at: [50, 50], text: 'Somersham', size: 3 });
  const [r] = L.solve();
  assert.ok(r.placed);
  assert.strictEqual(r.pos, 'E', 'right of the symbol is the textbook first choice');
});

test('no two placed labels are allowed to overlap', () => {
  // Eight names on one point. Whatever survives must not be printed on top of
  // anything else that survived — the measured cost this module was built to end
  // was 244 point labels sitting on ink and 190 on a foreign symbol.
  const L = page();
  for (let i = 0; i < 8; i++) L.add({ id: 'n' + i, at: [50, 50], text: 'Fenstanton ' + i, size: 3 });
  const placed = L.solve().filter(r => r.placed);
  assert.ok(placed.length >= 2, 'test premise: more than one label got placed');
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.ok(!overlap(placed[i].b, placed[j].b),
        `${placed[i].id} and ${placed[j].id} were placed on top of each other`);
    }
  }
});

test('a label with nowhere to go is REPORTED, not silently dropped', () => {
  // "Anything that still cannot be placed is reported, because today a dropped
  // label leaves no trace in the SVG at all and we have no idea how much the
  // maps are failing to say."
  const L = page();
  L.block([0, 0, 100, 100], 'everything');
  L.add({ id: 'lost', at: [50, 50], text: 'Bluntisham', size: 3 });
  const un = L.unplaced();
  assert.strictEqual(un.length, 1);
  assert.strictEqual(un[0].id, 'lost');
  assert.strictEqual(un[0].text, 'Bluntisham');
  assert.ok(un[0].reason, 'an unplaced label must carry a reason');
  assert.strictEqual(L.svg(), '', 'nothing was drawn, which is exactly why it has to be reported');
});

test('a mustPlace label is printed rather than dropped, and that is the trade', () => {
  // Same sheet, same impossible page. A destination is the answer to the question
  // the sheet exists to answer, so it is costed heavily instead of dropped.
  // The cost is real and known: where nothing is free it overprints. That is why
  // gen_internal.js's exitDevice stays off (references/design-quality.md), and
  // why this is asserted as a deliberate trade and not as a good outcome.
  const L = page();
  L.block([0, 0, 100, 100], 'everything');
  L.add({ id: 'dest', at: [50, 50], text: 'to Cambridge', size: 3, mustPlace: true });
  const [r] = L.solve();
  assert.ok(r.placed, 'a destination was dropped to keep a symbol pristine');
  assert.strictEqual(L.unplaced().length, 0);
});

test('a shortlisted label uses its shortlist when the shortlist is free', () => {
  const L = page().add({ id: 'd', at: [50, 50], text: 'to Ramsey', size: 3, only: ['W'], mustPlace: true });
  const [r] = L.solve();
  assert.strictEqual(r.pos, 'W');
  assert.ok(!r.offDevice, 'it should not have needed to leave the device');
});

test('leaving a shortlist is allowed, and is reported as having happened', () => {
  // "A shortlist that can drop a label is worse than an inconsistent sheet: the
  // device is a look, the destination is the information." The caller can only
  // act on that if the record says which labels left.
  const L = page();
  L.block([0, 30, 49, 70], 'west side');
  L.add({ id: 'd', at: [50, 50], text: 'to Ramsey', size: 3, only: ['W'], mustPlace: true });
  const [r] = L.solve();
  assert.ok(r.placed);
  assert.strictEqual(r.offDevice, true, 'it left the shortlist without saying so');
});

test('a label may sit on its own symbol and nothing else', () => {
  const L = page();
  L.block([48, 48, 52, 52], 'own badge');
  L.add({ id: 'p', at: [50, 50], text: 'Post Office', size: 2.5, own: [48, 48, 52, 52] });
  const [r] = L.solve();
  assert.ok(r.placed, 'a label was refused for touching the symbol it names');
});

test('a hard block is never entered by an ordinary label', () => {
  const L = page();
  const panel = [60, 0, 100, 100];
  L.block(panel, 'services panel');
  for (let i = 0; i < 6; i++) L.add({ id: 'x' + i, at: [58, 10 + i * 12], text: 'Houghton ' + i, size: 3 });
  for (const r of L.solve()) {
    if (!r.placed) continue;
    assert.ok(!overlap(r.b, panel), `${r.id} was printed into the services panel`);
  }
});

test('the same input produces the same bytes, twice running', () => {
  // changing-the-engine.md §1: no Math.random, no Date, no iteration-order
  // dependence. A placer that is only usually deterministic makes every
  // byte-identical gate in the estate meaningless.
  const build = () => {
    const L = new Labeller({ page: [120, 90] });
    L.stampSeg([10, 10], [110, 80], 1.2);
    L.block([0, 70, 40, 90], 'footer');
    for (const [id, x, y, t] of [['a', 20, 20, 'Hemingford Grey'], ['b', 60, 40, 'Wyton'],
                                 ['c', 90, 25, 'Needingworth'], ['d', 35, 55, 'Holywell']]) {
      L.add({ id, at: [x, y], text: t, size: 2.6 });
    }
    return L.svg();
  };
  assert.strictEqual(build(), build());
});

test('insertion order does not change the outcome for equal-priority labels of equal length', () => {
  // The sweep sorts on priority, then text length, then insertion order — all
  // three stable. Two names of the same length must therefore land the same way
  // whichever order the generator happened to walk its data in.
  const make = (order) => {
    const L = new Labeller({ page: [100, 100] });
    for (const [id, x, y] of order) L.add({ id, at: [x, y], text: 'Elton', size: 3 });
    return L.solve().map(r => `${r.id}:${r.placed ? r.pos : '-'}`).sort().join(',');
  };
  const a = make([['p', 40, 50], ['q', 44, 50]]);
  const b = make([['q', 44, 50], ['p', 40, 50]]);
  assert.strictEqual(a, b);
});

test('a long name wraps to two lines rather than being refused the space', () => {
  // 55 mm of text on a 40 mm page. The one-line form is still OFFERED and still
  // preferred wherever it fits — a two-line label is costed, not free — so the
  // page has to be narrower than the name for the wrap to be the cheaper answer.
  const L = new Labeller({ page: [40, 60], bounds: { x0: 0, y0: 0, x1: 40, y1: 60 } });
  L.add({ id: 'w', at: [20, 30], text: 'Hemingford Abbots and Hemingford Grey', size: 3 });
  const [r] = L.solve();
  assert.ok(r.placed, 'a name longer than the page was dropped instead of wrapped');
  assert.strictEqual(r.lines.length, 2, `expected a two-line form, got ${JSON.stringify(r.lines)}`);
  // Split at the space that leaves the halves most equal — a two-line label reads
  // as one thing only if the lines are of a kind.
  assert.deepStrictEqual(r.lines, ['Hemingford Abbots', 'and Hemingford Grey']);
});

test('a label is refused space outside the hard bounds, however cheap it looks', () => {
  // `bounds` is the page minus the column the sheet reserves. Straying past the
  // soft frame is costed; straying past this is a label half off the paper.
  const L = new Labeller({ page: [100, 100], bounds: { x0: 0, y0: 0, x1: 55, y1: 100 } });
  L.add({ id: 'edge', at: [54, 50], text: 'Warboys', size: 3 });
  const [r] = L.solve();
  if (r.placed) assert.ok(r.b[2] <= 55 + 1e-9, `box ran to x=${r.b[2]}, past the hard bound at 55`);
});

test('Grid.cover reports the fraction of a box that is inked, not merely whether any of it is', () => {
  const g = new Grid(100, 100, 0.5);
  const box = [10, 10, 20, 20];
  assert.strictEqual(g.cover(box), 0);
  assert.strictEqual(g.any(box), false);
  g.set(10, 10, 15, 20);                       // half the box
  assert.ok(g.any(box));
  const c = g.cover(box);
  assert.ok(c > 0.4 && c < 0.65, `half-covered box reported ${c}`);
});

test('the compass preference list is the one the costing indexes into', () => {
  // wPos charges per step down this list, so its ORDER is a design decision and
  // its length is what `only` shortlists are validated against.
  assert.deepStrictEqual(POSITIONS.map(p => p.k), ['E', 'W', 'NE', 'SE', 'NW', 'SW', 'N', 'S']);
  assert.ok(DEFAULTS.wOffDevice > DEFAULTS.inkFatal * DEFAULTS.wInk,
    'leaving a shortlist must cost more than the worst a shortlist position can');
  assert.ok(DEFAULTS.wHard > DEFAULTS.wOffDevice,
    'overlapping a reserved symbol must cost more than leaving the device');
});
