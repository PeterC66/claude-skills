/*
 * note_place — a mapNotes entry that finds its own clear ground (buses-data OA-437, A1).
 *
 * No stored map has a note without a coordinate, so the byte gate runs only the path
 * that is NOT searched; every clause of the search is held here, on a blank page, one
 * at a time: the widest wrap that has a spot wins, a box over reserved space or route
 * ink is refused, the hint decides among clear spots, and "nowhere" is null so the
 * caller can say so instead of dropping the note.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { placeNote, wrapMeasured, placeSearchedNotes } = require('./_engine.js').load('note_place.js');

const FRAME = { x0: 6, y0: 30, x1: 196, y1: 185 };
const hit = (b, o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]);
// 1 mm per character at any size, so widths are checkable by hand.
const measure = (ln) => ln.length;
const TEXT = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh';           // 8 words of 4, 39 characters

function run(opt = {}) {
  const reserved = opt.reserved || [], ink = opt.ink || [];
  return placeNote({
    text: opt.text || TEXT, size: 2.4, lineGap: 3.24, w: opt.w, near: opt.near, frame: opt.frame || FRAME,
    footerTop: opt.footerTop || 195, measure, step: opt.step || 1,
    overlaps: (b) => reserved.some((o) => hit(b, o)),
    inkCover: (b) => (ink.some((o) => hit(b, o)) ? 1 : 0),
  });
}

test('wrapMeasured breaks on measured width, and a word longer than the width gets its own line', () => {
  assert.deepStrictEqual(wrapMeasured('aaaa bbbb cccc', 9, measure), ['aaaa bbbb', 'cccc']);
  assert.deepStrictEqual(wrapMeasured('aa bbbbbbbbbbbb c', 5, measure), ['aa', 'bbbbbbbbbbbb', 'c']);
});

test('on a blank page the widest wrap wins, so the note is one line', () => {
  const got = run();
  assert.strictEqual(got.lines.length, 1);
  assert.strictEqual(got.width, 120);
});

test('with no hint it goes bottom-left of the frame, above the footer plate', () => {
  const got = run();
  assert.strictEqual(got.x, FRAME.x0 + 1);
  assert.ok(got.y + 1 <= 195 - 2, 'the last line clears the footer plate');
  assert.ok(got.y > 150, 'and it is at the bottom, not the top');
});

test('a hint pulls the note to the nearest clear spot', () => {
  const got = run({ near: { x: 100, y: 60 } });
  assert.ok(Math.abs(got.x - 100) <= 1 && Math.abs(got.y - 60) <= 1, `got ${got.x},${got.y}`);
});

test('reserved space and route ink are both refused, every line of the box being tested', () => {
  const block = [6, 150, 196, 190];                          // the whole bottom strip
  const a = run({ reserved: [block] });
  assert.ok(a.y + 1 < 150, 'reserved space pushes the note above the strip');
  const b = run({ ink: [block] });
  assert.ok(b.y + 1 < 150, 'route ink does the same');
});

test('a wide note that cannot fit narrows until it does, and reports the width that worked', () => {
  // Leave only a 45 mm-wide corridor: 79 characters need the 40 mm wrap, the first that fits it.
  const reserved = [[6, 30, 30, 190], [75, 30, 196, 190]];
  const got = run({ reserved, text: TEXT + ' ' + TEXT });
  assert.ok(got.lines.length > 1);
  assert.ok(got.boxes.every((b) => b[0] >= 30 && b[2] <= 75), 'every line sits in the corridor');
  assert.strictEqual(got.width, 40);
});

test('the footer plate is a floor: the last line ends at least 2 mm above it, even inside the frame', () => {
  const got = run({ footerTop: 100 });
  assert.ok(got.boxes[got.boxes.length - 1][3] <= 98, 'ends above the plate');
});

test('w caps the widest wrap tried', () => {
  assert.strictEqual(run({ w: 20 }).width, 20);
});

test('nowhere clear is null, never a note quietly dropped on top of something', () => {
  assert.strictEqual(run({ reserved: [[0, 0, 300, 300]] }), null);
});

test('one box per line, shaped as mapNotes reserves it', () => {
  const got = run({ w: 20 });
  assert.strictEqual(got.boxes.length, got.lines.length);
  got.boxes.forEach((b, i) => {
    assert.strictEqual(b[0], got.x - 0.4);
    assert.strictEqual(b[3], got.y + i * 3.24 + 1);
  });
});

// ------------------------------------------------- placeSearchedNotes (the call gen_internal makes)
class FakeLabeller {                       // the two methods noteInk uses; records what it was stamped with
  constructor() { FakeLabeller.last = this; this.ink = { cover: (b) => FakeLabeller.cover(b) }; }
  stampSvg(svg, pred) { FakeLabeller.pred = pred; }
}
function searched(opt = {}) {
  const reserved = [], warnings = [];
  FakeLabeller.cover = opt.cover || (() => 0);
  const out = placeSearchedNotes({
    notes: opt.notes || [{ text: TEXT }], frame: FRAME, footerTop: 195, svg: '<svg/>', IR: opt.IR || null, Labeller: FakeLabeller,
    esc: (s) => s.replace(/&/g, '&amp;'), measure, labelBoxes: opt.labelBoxes || [],
    overlaps: (b) => (opt.reserved || []).some((o) => hit(b, o)),
    reserve: (x0, y0, x1, y1, tag) => reserved.push({ b: [x0, y0, x1, y1], tag }), warn: (m) => warnings.push(m),
  });
  return { out, reserved, warnings };
}

test('a searched note is drawn as italic text in the same form the claim-phase notes use, and reserved', () => {
  const { out, reserved, warnings } = searched({ notes: [{ text: 'Fish & chips', color: '#123' }] });
  assert.strictEqual(out.length, 1);
  assert.match(out[0], /^<text x="[\d.]+" y="[\d.]+" font-family="Arial" font-size="2.4" font-style="italic" fill="#123" text-anchor="start" stroke="#fff" stroke-width="0.7" paint-order="stroke">Fish &amp; chips<\/text>$/);
  assert.deepStrictEqual(reserved.map((r) => r.tag), ['a map note']);
  assert.match(warnings[0], /placed by search/);
});

test('every placed label is an obstacle, which a claim-phase note could not know', () => {
  const labels = [[6, 150, 196, 190]];
  const { reserved } = searched({ labelBoxes: labels });
  assert.ok(reserved[0].b[3] < 150, 'the note sits above the label strip');
});

test('the second note keeps clear of the first, because the first is reserved as it lands', () => {
  const notes = [{ text: TEXT }, { text: TEXT }];
  const seen = [];
  const r = placeSearchedNotes({
    notes, frame: FRAME, footerTop: 195, svg: '', IR: null, Labeller: FakeLabeller, esc: (s) => s, measure, labelBoxes: seen,
    overlaps: (b) => seen.some((o) => hit(b, o)),
    reserve: (x0, y0, x1, y1) => seen.push([x0, y0, x1, y1]), warn: () => {},
  });
  assert.strictEqual(r.length, 2);
  const ys = r.map((s) => +/y="([\d.]+)"/.exec(s)[1]);
  assert.notStrictEqual(ys[0], ys[1], 'two notes do not share a line');
});

test('the ink probe counts a river and anything but the pale road tiers and white', () => {
  searched();
  const p = FakeLabeller.pred;
  assert.strictEqual(p('#a8d0ee', 3), true, 'a river stroke');
  assert.strictEqual(p('#e4e4e4', 3), false, 'the skeleton road tier');
  assert.strictEqual(p('#fff', 3), false);
  assert.strictEqual(p('#333', 0.5), false, 'a hairline');
});

test('nowhere clear: the note is still drawn, at the hint, and the build says so', () => {
  const { out, warnings } = searched({ reserved: [[0, 0, 300, 300]], notes: [{ text: 'short', near: { x: 50, y: 60 } }] });
  assert.strictEqual(out.length, 1);
  assert.match(out[0], /x="50.00" y="60.00"/);
  assert.match(warnings[0], /no clear ground/);
});
