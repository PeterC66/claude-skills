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

/* ---- OA-078: a NUMBER where the name would not go -------------------------
 *
 * 288 labels across the estate were dropped by the main solve, and every one of
 * them left its ICON on the sheet: an anonymous trolley the reader cannot look
 * up. indexPass() offers each one an ordinal instead, placed by the same solver.
 *
 * A FIXTURE PER CLAUSE, because the pass is a composition of four decisions and
 * any three can be right while the fourth is wrong.
 *
 * AND THE FIXTURE HAD TO BE MEASURED INTO EXISTENCE. The first cut was four
 * points in a tight cluster on a big page, which reads as crowded and is not:
 * the relaxation sweep and the two leader rings between them placed all four
 * names, so `unplaced()` was empty and every assertion below passed against
 * nothing. What actually drops names is a ROW of points whose pitch is smaller
 * than one name is wide — eight at 6 mm on a 70 mm page drops six of eight and
 * still leaves room beside three of them for two digits, which is the only
 * arrangement in which this pass can be observed doing its job at all.
 */
const crowd = () => {
  const P = 70;
  const L = new Labeller({ page: [P, P], frame: { x0: 0, y0: 0, x1: P, y1: P },
                           bounds: { x0: 0, y0: 0, x1: P, y1: P } });
  const A = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel'.split(' ');
  A.forEach((n, i) => L.add({ id: 'p' + i, at: [P / 2 - 7 * 6 / 2 + i * 6, P / 2],
                              text: 'Wonderfully Long Place Name ' + n,
                              size: 3, leader: false, wrap: false }));
  return L;
};

test('indexPass numbers what the main solve dropped, and leaves the placed ones alone', () => {
  const L = crowd();
  const dropped = L.unplaced().map(u => u.text);
  assert.ok(dropped.length >= 3, `premise: this row drops names — it dropped ${dropped.length}`);
  const rows = L.indexPass();
  assert.ok(rows.length >= 2, `nothing much was numbered (${rows.length}), so the pass proves nothing`);
  for (const r of rows) assert.ok(dropped.includes(r.text), `${r.text} was already placed`);
  // ...and the markers really are in the drawing, not merely in the return value.
  const svg = L.indexSvg();
  for (const r of rows) assert.match(svg, new RegExp('>' + r.n + '</text>'));
});

test('the index is numbered ALPHABETICALLY, so the printed list can be scanned', () => {
  const rows = crowd().indexPass();
  const byNumber = rows.slice().sort((a, b) => a.n - b.n).map(r => r.text.toUpperCase());
  assert.deepStrictEqual(byNumber, byNumber.slice().sort(),
    'the numbers do not run in the same order as the names, so the list is unscannable');
  assert.deepStrictEqual(rows.map(r => r.n), rows.map((_, i) => i + 1), 'the sequence has a gap');
});

test('a marker is placed against the WIDEST ordinal the pass could issue', () => {
  // Number 9's box must be no narrower than number 10's would have been, or a
  // two-digit marker drawn into a one-digit box overhangs whatever is beside it.
  //
  // AND IT MUST START AT 8, WHICH IS THE WHOLE TEST. The first cut used the
  // default `from: 1` on a fixture that numbers three rows, so the ordinals were
  // 1, 2 and 3 — all one digit, all the same width — and a pass that sized every
  // marker to its OWN digits satisfied it exactly. The mutation went uncaught and
  // the assertion was measuring nothing. Numbering from 8 puts 9 and 10 in the
  // same sequence, which is the only arrangement in which the two answers differ.
  const rows = crowd().indexPass({ from: 8 });
  assert.ok(rows.length >= 3, `need a run that crosses 9->10; got ${rows.length} rows`);
  assert.ok(rows.some(r => String(r.n).length === 1) && rows.some(r => String(r.n).length === 2),
    'the fixture never reached two digits, so this asserts nothing: ' + rows.map(r => r.n).join(','));
  const w = rows.map(r => r.rec.b[2] - r.rec.b[0]);
  assert.ok(Math.max(...w) - Math.min(...w) < 1e-9,
    'markers were sized to their own digits: ' + w.join(', '));
});

test('a point with no room even for two digits keeps its silence', () => {
  // The pass must not force. A number stamped on top of a route line is a number
  // the reader can neither read nor look up — a visible failure turned invisible.
  const L = new Labeller({ page: [12, 12], frame: { x0: 0, y0: 0, x1: 12, y1: 12 },
                           bounds: { x0: 0, y0: 0, x1: 12, y1: 12 } });
  L.hard.set(0, 0, 12, 12);                       // every cell reserved
  L.add({ id: 'a', at: [6, 6], text: 'Somersham', size: 3 });
  assert.strictEqual(L.unplaced().length, 1, 'premise: the name is dropped');
  assert.strictEqual(L.indexPass().length, 0, 'a marker was forced onto reserved ink');
  assert.strictEqual(L.stillUnplaced().length, 1, 'the residue lost the label it never numbered');
});

test('`max` leaves behind what the main solve already ranked last', () => {
  const all = crowd().indexPass().length;
  assert.ok(all >= 2, 'need at least two numbered rows for this to mean anything');
  const one = crowd().indexPass({ max: 1 });
  assert.strictEqual(one.length, 1, 'max was ignored');
  // ...and the one kept is the highest-PRIORITY candidate, not the first in the
  // array. Alphabetically 'Zulu' sorts last, so a pass that numbered in array
  // order or in name order would keep something else.
  const P = 70;
  const L = new Labeller({ page: [P, P], frame: { x0: 0, y0: 0, x1: P, y1: P },
                           bounds: { x0: 0, y0: 0, x1: P, y1: P } });
  const A = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Zulu'.split(' ');
  A.forEach((n, i) => L.add({ id: 'p' + i, at: [P / 2 - 7 * 6 / 2 + i * 6, P / 2],
                              text: 'Wonderfully Long Place Name ' + n, priority: n === 'Zulu' ? 9 : 0,
                              size: 3, leader: false, wrap: false }));
  const dropped = L.unplaced().map(u => u.id);
  if (dropped.includes('p7')) {
    const kept = L.indexPass({ max: 1 });
    assert.strictEqual(kept[0].id, 'p7', 'max kept an item the solve ranked below another');
  }
});

test('stillUnplaced is the residue after BOTH passes, and unplaced() is not', () => {
  const L = crowd();
  const before = L.unplaced().length;
  const rows = L.indexPass();
  assert.strictEqual(L.unplaced().length, before, 'unplaced() must keep meaning what it meant');
  assert.strictEqual(L.stillUnplaced().length, before - rows.length);
  assert.ok(L.stillUnplaced().length >= 1, 'a residue of zero cannot tell the two apart');
});

test('a caller that never asks for an index changes not one byte', () => {
  const a = crowd(), b = crowd();
  b.indexPass();
  assert.strictEqual(a.svg(), b.svg(), 'the index pass moved the main answer');
  assert.strictEqual(a.indexSvg(), '', 'markers were drawn without indexPass()');
});

/* ---- OA-187: `max` is the block's CAPACITY, not a budget of attempts --------
 *
 * `crowd()` above cannot see this bug and no fixture built from it can. Every one
 * of its candidates that gets tried either places or does not, and `max` only ever
 * bites at the end of the list — so attempts and successes agree, which is exactly
 * the one arrangement in which the old code was right.
 *
 * WHAT SEPARATES THEM is a candidate that SORTS FIRST and can never be numbered.
 * The two `b*` points below sit inside a hard-reserved band with priority 9, so
 * the comparator puts them at the head of `want` and `_best` refuses both — the
 * shape High Wycombe reports on every build, where fifty-one names went unnumbered
 * beside five free rows. Asked for two rows, the old code spent both attempts on
 * them and printed nothing; this one walks on. The premise is asserted rather than
 * assumed, because a fixture in which `b0`/`b1` turned out to be placeable would
 * pass every assertion below while proving the opposite. */
const blockedFirst = (nBlocked = 4) => {
  const P = 70;
  const L = new Labeller({ page: [P, P], frame: { x0: 0, y0: 0, x1: P, y1: P },
                           bounds: { x0: 0, y0: 0, x1: P, y1: P } });
  L.hard.set(0, 0, P, 10);                                  // a reserved band, top of the page
  for (let i = 0; i < nBlocked; i++)
    L.add({ id: 'b' + i, at: [8 + (i % 8) * 7, 5], text: 'Wonderfully Long Blocked Name ' + i,
            priority: 9, size: 3, leader: false, wrap: false });
  const A = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel'.split(' ');
  A.forEach((n, i) => L.add({ id: 'p' + i, at: [P / 2 - 7 * 6 / 2 + i * 6, P / 2],
                              text: 'Wonderfully Long Place Name ' + n,
                              size: 3, leader: false, wrap: false }));
  return L;
};

test('`max` counts rows PRINTED, not candidates tried, so the block fills', () => {
  // Premise 1: the two blocked points really do sort first.
  const L0 = blockedFirst();
  const want = L0.solve().filter(r => !r.placed && r.it.at).map(r => r.it);
  want.sort((a, b) => (b.priority - a.priority) || (b.text.length - a.text.length) || (a.seq - b.seq));
  assert.deepStrictEqual(want.slice(0, 2).map(i => i.id), ['b0', 'b1'],
    'the blocked pair no longer heads the candidate list, so this fixture proves nothing');
  // Premise 2: and they can never be numbered, however many attempts are allowed.
  const everything = blockedFirst().indexPass({ max: 99 }).map(r => r.id);
  assert.ok(!everything.includes('b0') && !everything.includes('b1'),
    'a blocked point was numberable after all: ' + everything.join(','));
  // The claim: two rows asked for, two rows printed — from further down the list.
  const rows = blockedFirst().indexPass({ max: 2 });
  assert.strictEqual(rows.length, 2,
    'the block was left part empty while candidates remained: ' + rows.map(r => r.id).join(','));
});

test('the attempt walk is BOUNDED — a dense sheet does not run the placer 260 times', () => {
  // The other half of the same change: not spending the caller's rows on failures
  // must not become spending the whole afternoon on them. `_best` is the cost, so
  // it is `_best` that is counted, and the ceiling is asserted as an exact number
  // rather than "fewer than all" — a ceiling one candidate short of the list would
  // satisfy the loose form and bound nothing.
  const N = 60;
  const L = blockedFirst(0);
  L.hard.set(0, 0, 70, 70);                                 // nothing can be numbered at all
  for (let i = 0; i < N; i++)
    L.add({ id: 'q' + i, at: [4 + (i % 30) * 2, 20 + Math.floor(i / 30) * 8],
            text: 'Wonderfully Long Place Name ' + i, size: 3, leader: false, wrap: false });
  const cap = 1, ceiling = Math.max(cap * 4, cap + 40);      // 41
  assert.ok(L.unplaced().length > ceiling,
    `premise: the candidate list must be longer than the ceiling; it is ${L.unplaced().length}`);
  let calls = 0;
  const real = L._best.bind(L);
  L._best = (...a) => { calls++; return real(...a); };
  assert.strictEqual(L.indexPass({ max: cap }).length, 0, 'premise: nothing here can be numbered');
  assert.strictEqual(calls, ceiling, `the walk was not bounded at ${ceiling}: it tried ${calls}`);
});

test('the marker box is sized from the CAPACITY, never from the attempt ceiling', () => {
  // Widening the walk must not widen the ink. Asked for two rows from `from: 1`,
  // the highest ordinal this pass can issue is 2 — one glyph — however many
  // candidates it had to try to find them. Sizing the box from `take.length`
  // instead would reserve room for a two-digit number that cannot exist, and move
  // ink on every sheet that carries an index for nothing.
  //
  // AND THE CANDIDATE LIST MUST REACH TEN, which is the whole test. The first cut
  // of this fixture had eight candidates, so the wrong answer was `String(8)` —
  // one glyph, the same width as the right one — and the mutation that inverts
  // this line SURVIVED the harness while the assertion below passed. Ten is where
  // the two answers first differ, so the premise is asserted rather than trusted.
  const L = blockedFirst();
  assert.ok(L.unplaced().length >= 10,
    `premise: fewer than ten candidates and the wrong answer is a one-digit box too, which asserts nothing (got ${L.unplaced().length})`);
  const rows = blockedFirst().indexPass({ max: 2 });
  assert.strictEqual(rows.length, 2, 'premise: two markers were drawn');
  assert.ok(rows.every(r => String(r.n).length === 1), 'premise: both ordinals are one digit');
  // THE CONTROL READS THE MARKER'S OWN SIZE rather than restating it. Naming the
  // number here made this test fail the day OA-213 moved the default from 2.3 to
  // 2.4 — it was measuring the size constant, which is not the property under
  // test. What is under test is the WIDTH: one glyph or two.
  const size = rows[0].rec.it.size;
  const control = new Labeller({ page: [70, 70] })
    .add({ id: 'c', at: [35, 35], text: '8', size, bold: true, wrap: false, gap: 1.7 })
    .solve()[0];
  const oneDigit = control.b[2] - control.b[0];
  for (const r of rows) assert.ok(Math.abs((r.rec.b[2] - r.rec.b[0]) - oneDigit) < 1e-9,
    `a one-digit marker reserved ${r.rec.b[2] - r.rec.b[0]}mm against a one-digit box of ${oneDigit}mm`);
});

test('an index marker is never drawn below the floor the quality gate enforces', () => {
  // OA-213: the marker was 2.3 mm against a print-legibility floor of 2.4, so
  // every index marker on the estate was a HARD defect — 82 of them, 27% of the
  // whole board, for a year, in a number nothing compared to anything.
  //
  // THIS IS THE TEST THAT WOULD HAVE CAUGHT IT, and the reason it did not exist is
  // that 2.3 was a bare constant: a lone number restated in two files has nothing
  // to be wrong against. The floor is not restated here either — it is read from
  // quality_metrics.js, the file that charges the defect — so the two can never
  // again drift apart silently. If the floor rises, this goes red and the marker
  // must follow it.
  const { T } = require('./_engine.js').load('quality_metrics.js');
  const rows = blockedFirst().indexPass({ max: 2 });
  assert.ok(rows.length >= 1, 'premise: at least one marker was drawn');
  for (const r of rows) assert.ok(r.rec.it.size >= T.minTextMm,
    `an index marker is drawn at ${r.rec.it.size}mm against a legibility floor of ${T.minTextMm}mm`);
});

test('`gap` is read, and an absent one is the default distance', () => {
  // The index marker asks to sit closer than a name would. Proving the option is
  // READ needs a page where the two answers differ, not merely one where it fits.
  const at = [50, 50];
  const far = page().add({ id: 'a', at, text: 'X', size: 3 }).solve()[0];
  const near = page().add({ id: 'a', at, text: 'X', size: 3, gap: 1.0 }).solve()[0];
  assert.ok(near.x - at[0] < far.x - at[0] - 1e-9,
    `gap ignored: default put the box at ${far.x}, gap:1.0 at ${near.x}`);
  const dflt = page().add({ id: 'a', at, text: 'X', size: 3, gap: DEFAULTS.gap }).solve()[0];
  assert.strictEqual(dflt.x, far.x, 'stating the default gap changed the answer');
});
