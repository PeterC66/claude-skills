/*
 * feature_labels — siting the NAME of a river, main road, railway or canal.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3), the block
 * extraction 7 deliberately left behind. Measured the same day with
 * `npm run gate:branch-coverage -- tools/branch-coverage.feature_labels.js`:
 * **17 of its 34 labelled branches are dark**, and among them is EVERY FAULT PATH
 * OF ALL FOUR GUARDS — three that refuse to draw and one that warns and draws
 * anyway. That is the guards working — each was written after a
 * shipped sheet went wrong, the boards were then fixed, and a fixed board trips
 * nothing. It also means the byte gate certifies none of them: delete a guard and
 * all 20 maps stay byte-identical, right up until the next town sites a label
 * badly, which is precisely the case the guard exists for.
 *
 * So this suite is mostly the four refusals, plus the override keys no committed
 * map uses (label text, label position, label offset, anchor, upright type).
 *
 * The three legibility guards ask whether the name can be READ; the fourth asks
 * whether it MEANS anything — is it anywhere near the thing it names. That fourth
 * measures INSIDE THE FRAME, because a feature polyline does not stop at the map
 * edge, it is clipped there: Huntingdon's Great Ouse runs to y=277 on a sheet
 * whose frame ends at 182, so the unclipped measure said 29mm and looked
 * survivable while the reader could see no river within reach of the words.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { featureLabels } = require('./_engine.js').load('feature_labels.js');

const FRAME = { MX0: 10, MY0: 10, MX1: 190, MY1: 180 };

// A river drawn as one straight line down the middle of the frame.
const RIVER = [[[100, 20], [100, 170]]];

function make(over = {}) {
  const out = [], refused = [], warned = [];
  const draw = featureLabels(Object.assign({
    out: l => out.push(l),
    esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    refuse: m => refused.push(m),
    warn: m => warned.push(m),
    featOv: () => ({}),
    featSegs: () => RIVER,
    isAuto: () => false,
    autoPos: {},
    inCore: () => false,
    FOOTER_SAFE: true,
    FOOTER_PLATE_TOP: 195.16,
  }, FRAME, over));
  return { draw, out, refused, warned, svg: () => out.join('\n') };
}
const river = (over = {}) => Object.assign({ key: 'ouse', type: 'river', label: 'Great Ouse',
                                             labelPos: { x: 105, y: 90 } }, over);

// ---------------------------------------------------------------- the skips
test('a hidden feature and a hidden label both draw nothing', () => {
  const a = make({ featOv: () => ({ hide: true }) });
  a.draw(river());
  assert.deepStrictEqual(a.out, [], 'hiding the river hides its name');
  const b = make({ featOv: () => ({ label: { hide: true } }) });
  b.draw(river());
  assert.deepStrictEqual(b.out, [], 'the label can be hidden while the line stays');
});

test('a feature with no labelPos is silently skipped', () => {
  const a = make();
  a.draw(river({ labelPos: null }));
  assert.deepStrictEqual([a.out, a.refused, a.warned], [[], [], []],
    'no position is a choice, not a fault — most features have none');
});

// ---------------------------------------------------------------- guard 1: coreBox
test('a label inside the town-centre box is dropped, and says to move the labelPos', () => {
  const a = make({ inCore: () => true });
  a.draw(river());
  assert.deepStrictEqual(a.out, []);
  assert.match(a.warned[0], /sits inside the town-centre box and was not drawn/);
  assert.match(a.warned[0], /move its labelPos/, 'the fix is the position, not hiding the river');
  assert.deepStrictEqual(a.refused, [], 'a coreBox clash warns; it is not a STRICT_GUARDS refusal');
});

// ---------------------------------------------------------------- guard 2: the panel
test('a label right of the map frame lands in the Services panel and is refused', () => {
  // Wisbech shipped for months with "River Nene" struck across "46 Wisbech –
  // March": a feature label is drawn OUTSIDE the map's clip group, so nothing
  // stops it. Neither the panel metric nor the byte gate can see it.
  const a = make();
  a.draw(river({ labelPos: { x: 193, y: 90 } }));
  assert.deepStrictEqual(a.out, []);
  assert.match(a.refused[0], /right of the map frame \(x190\) and inside the Services panel/);
});

test('the panel guard has 2mm of slack, so a label ON the frame edge still draws', () => {
  const a = make();
  a.draw(river({ labelPos: { x: 192, y: 90 } }));
  assert.strictEqual(a.out.length, 1, 'x = MX1+2 is the last position that draws');
  assert.ok(!a.refused.some(m => /Services panel/.test(m)), 'the panel guard did not fire');
  // Guard 4 does speak here, and that is the two guards being about different
  // things: this label is legible where it sits and 92mm from the river it names.
  assert.ok(a.refused.some(m => /names nothing where it sits/.test(m)));
});

// ---------------------------------------------------------------- guard 3: the footer
test('a label under the footer plate is painted and then covered, so it is refused', () => {
  const a = make();
  a.draw(river({ labelPos: { x: 100, y: 196 } }));
  assert.deepStrictEqual(a.out, []);
  assert.match(a.refused[0], /under the footer plate \(top y195\.2\)/);
  assert.match(a.refused[0], /painted and then covered/);
});

test('footerSafe:false turns that guard off rather than moving it', () => {
  const a = make({ FOOTER_SAFE: false });
  a.draw(river({ labelPos: { x: 100, y: 196 } }));
  assert.strictEqual(a.out.length, 1, 'a town that has opted out owns the consequence');
  assert.ok(!a.refused.some(m => /footer plate/.test(m)), 'the footer guard is the one that is off');
});

// ---------------------------------------------------------------- guard 4: meaning
test('a label 25mm or less from its ink is left alone', () => {
  const a = make();
  a.draw(river({ labelPos: { x: 120, y: 90 } }));      // 20mm from the line at x=100
  assert.strictEqual(a.out.length, 1);
  assert.deepStrictEqual(a.refused, []);
});

test('a stranded label is WARNED about, not dropped, and told where to go', () => {
  const a = make();
  a.draw(river({ labelPos: { x: 160, y: 90 } }));      // 60mm from the line
  assert.strictEqual(a.out.length, 1, 'it is legible — dropping it would be the engine overruling a judgement');
  assert.match(a.refused[0], /is 60mm from the nearest DRAWN ouse ink/,
    'the KEY names the feature when it has one — that is what the reader greps routes.json for');
  assert.match(a.refused[0], /nearest drawn point \(100,90\)/, 'report the REMEDY, not only the fault');
  assert.match(a.refused[0], /the ink runs through \(100,\d+\)/, 'and where the reader can see the feature');
});

test('the distance is measured inside the FRAME, because the polyline is clipped there', () => {
  // Huntingdon's Great Ouse runs on to y=277 on a sheet whose frame ends at 182.
  // Measured unclipped, its label was 29mm from "the river" and looked survivable;
  // measured against the ink a reader can see, there was none within reach.
  const a = make({ featSegs: () => [[[100, 200], [100, 400]]] });   // every point below MY1
  a.draw(river({ labelPos: { x: 100, y: 90 } }));
  assert.match(a.refused[0], /none of it lands inside the map frame/);
  assert.match(a.refused[0], /the label names nothing that is drawn/);
  assert.strictEqual(a.out.length, 1,
    'and it is still DRAWN: all three of guard 4 outcomes warn, none returns');
});

test('a long segment crossing the frame is SAMPLED, not just tested at its ends', () => {
  // Both endpoints outside, the middle inside: testing the ends alone would call
  // this "all clipped away" and refuse a label sitting right on the ink.
  const a = make({ featSegs: () => [[[100, -50], [100, 400]]] });
  a.draw(river({ labelPos: { x: 100, y: 90 } }));
  assert.deepStrictEqual(a.refused, []);
  assert.strictEqual(a.out.length, 1);
});

test('a feature with no geometry at all is a different fault, and says so', () => {
  const a = make({ featSegs: () => [] });
  a.draw(river());
  assert.match(a.refused[0], /has no geometry of its own on this sheet at all/);
  assert.match(a.refused[0], /check the features\[\] key/, 'the cause is a key, not a position');
  assert.strictEqual(a.out.length, 1, 'still drawn — guard 4 never drops a label');
});

// ---------------------------------------------------------------- the auto path
test('an auto label is drawn where the solver put it, centred', () => {
  const a = make({ isAuto: () => true, autoPos: { ouse: { x: 55.5, y: 66.25 } } });
  a.draw(river());
  assert.match(a.svg(), /x="55.50" y="66.25"/, 'auto coordinates are rounded to 2dp');
  assert.match(a.svg(), /text-anchor="middle"/, 'the solver returns a centre, not a start');
});

test('an auto label whose search found nowhere is skipped in silence', () => {
  const a = make({ isAuto: () => true, autoPos: {} });
  a.draw(river());
  assert.deepStrictEqual([a.out, a.refused, a.warned], [[], [], []],
    'it already said so on stderr; a name printed because nothing fitted is worse than no name');
});

test('the auto path ignores the four guards, because the solver already avoided the ink', () => {
  const a = make({ isAuto: () => true, autoPos: { ouse: { x: 1, y: 1 } }, inCore: () => true });
  assert.strictEqual(a.out.length, 0);
  a.draw(river());
  assert.strictEqual(a.out.length, 1, 'a solved position is not second-guessed');
});

// ---------------------------------------------------------------- the overrides
test('a label override can move, offset, retitle and re-anchor the name', () => {
  const a = make({ featOv: () => ({ label: { pos: { x: 40, y: 50 }, text: 'The Ouse', anchor: 'end' } }) });
  a.draw(river());
  assert.match(a.svg(), /x="40" y="50"/);
  assert.match(a.svg(), />The Ouse</);
  assert.match(a.svg(), /text-anchor="end"/);
  const b = make({ featOv: () => ({ label: { offset: { dx: 5, dy: -3 } } }) });
  b.draw(river());
  assert.match(b.svg(), /x="110" y="87"/, 'an offset is relative to labelPos, a pos is absolute');
});

test('a hand pos beats an offset rather than compounding with it', () => {
  const a = make({ featOv: () => ({ label: { pos: { x: 40, y: 50 }, offset: { dx: 5, dy: 5 } } }) });
  a.draw(river());
  assert.match(a.svg(), /x="40" y="50"/);
});

test('the label follows the feature nudge, so a moved river keeps its name', () => {
  const a = make({ featOv: () => ({ move: { dx: 4, dy: -2 } }) });
  a.draw(river());
  assert.match(a.svg(), /x="109" y="88"/);
});

test('empty override text is honoured, but an absent one falls back to the feature label', () => {
  const a = make({ featOv: () => ({ label: { text: '' } }) });
  a.draw(river());
  assert.match(a.svg(), /><\/text>/, 'text:"" is a way to draw the line and drop the name');
  const b = make();
  b.draw(river());
  assert.match(b.svg(), />Great Ouse</);
});

test('the name is italic, size 4 and river-blue unless the feature says otherwise', () => {
  const a = make();
  a.draw(river());
  assert.match(a.svg(), /font-style="italic"/);
  assert.match(a.svg(), /font-size="4"/);
  assert.match(a.svg(), /fill="#7fb0d8"/);
  const b = make();
  b.draw(river({ labelItalic: false, labelSize: 6, labelColor: '#333' }));
  assert.ok(!/font-style/.test(b.svg()), 'labelItalic:false gives upright type');
  assert.match(b.svg(), /font-size="6"/);
  assert.match(b.svg(), /fill="#333"/);
});

test('the text is escaped, because a feature name comes from config', () => {
  const a = make();
  a.draw(river({ label: 'Ouse & <Nene>' }));
  assert.match(a.svg(), />Ouse &amp; &lt;Nene>/);
});
