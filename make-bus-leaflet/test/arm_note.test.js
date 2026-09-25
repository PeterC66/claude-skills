/*
 * arm_note.test.js — the multi-arm note under the external radial's legend.
 *
 * J10 (buses-data OA-040): the auto note is one line per route with the number in
 * bold, and a hand-written externalNote is still one wrapped paragraph. The byte
 * gate proves the sheets; this pins the two shapes so a change to one cannot
 * quietly become a change to the other.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_engine');

const { armItemsFrom, drawArmNote } = load('arm_note.js');

// A fixed-advance measure and a word wrapper, so the geometry is checkable by hand:
// 1mm per character, 1.5mm per bold character.
const measureText = (s, size, bold) => s.length * (bold ? 1.5 : 1);
const wrapMm = (text, width) => {
  const lines = []; let cur = '';
  for (const w of text.split(' ')) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && next.length > width) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
};
const esc = s => s.replace(/&/g, '&amp;');
const draw = (args) => { const out = []; const ink = drawArmNote({ out: s => out.push(s), wrapMm, measureText, esc, ...args }); return { out, ink }; };

test('armItemsFrom lists only routes with more than one arm, in the order met', () => {
  const { items, note } = armItemsFrom([
    { route: '9', label: 'Hilton' }, { route: 'X3', label: 'Cambridge' }, { route: '9', label: 'Huntingdon' },
  ]);
  assert.deepStrictEqual(items, [{ route: '9', rest: 'runs as two arms — to Hilton and to Huntingdon.' }]);
  assert.strictEqual(note, '9 runs as two arms — to Hilton and to Huntingdon.');
});

test('with no multi-arm route the note is empty, which is what skips drawing it', () => {
  const { items, note } = armItemsFrom([{ route: '1', label: 'A' }, { route: '2', label: 'B' }]);
  assert.deepStrictEqual(items, []);
  assert.strictEqual(note, '');
});

test('each route starts its own line, with the number as a separate bold <text>', () => {
  const items = [{ route: '9', rest: 'to A.' }, { route: '301', rest: 'to B.' }];
  const { out, ink } = draw({ items, x: 10, y: 20, width: 100 });
  assert.strictEqual(out.length, 4);
  assert.match(out[0], /^<text x="10" y="20.00" [^>]*font-weight="bold"[^>]*>9<\/text>$/);
  assert.match(out[1], /^<text x="12.50" y="20.00" [^>]*>to A.<\/text>$/);   // 1.5 bold + 1 space
  assert.match(out[2], /y="23.60" [^>]*font-weight="bold"[^>]*>301</);
  assert.doesNotMatch(out[1], /bold/);
  assert.deepStrictEqual(ink, { maxX: 10 + 4.5 + 1 + 5, maxY: 20 + 3.6 + 2 });
});

test('an item longer than the panel still wraps, and the continuation is not bold', () => {
  const { out } = draw({ items: [{ route: '9', rest: 'aaaa bbbb cccc' }], x: 0, y: 0, width: 10 });
  assert.strictEqual(out.length, 3);
  assert.match(out[1], />aaaa<\/text>$/);
  assert.match(out[2], /^<text x="0" y="3.60" font-family="Arial" font-size="2.9" fill="#666">bbbb cccc<\/text>$/);
});

test('a hand-written note is one wrapped paragraph with no bold at all', () => {
  const { out, ink } = draw({ items: null, note: 'one two three', x: 5, y: 0, width: 8 });
  assert.deepStrictEqual(out, [
    '<text x="5" y="0.00" font-family="Arial" font-size="2.9" fill="#666">one two</text>',
    '<text x="5" y="3.60" font-family="Arial" font-size="2.9" fill="#666">three</text>',
  ]);
  assert.deepStrictEqual(ink, { maxX: 12, maxY: 5.6 });
});
