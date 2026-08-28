/*
 * line_endings.js — the eight lines three other files used to each carry a copy
 * of, two of them written hours apart on 2026-08-28 with the same bug.
 *
 * The bug was routing bytes through a UTF-8 string. These tests exist mainly to
 * pin the two properties that spelling got wrong: a byte that is not legal UTF-8
 * must survive untouched, and a LONE CR is content rather than a line ending.
 * Everything else here is ordinary.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { lfBytes, sameBytesIgnoringLineEndings } = require('./_engine.js').load('line_endings.js');

const B = (...bytes) => Buffer.from(bytes);

test('a CRLF pair becomes a lone LF', () => {
  assert.deepStrictEqual(lfBytes(Buffer.from('a\r\nb\r\n')), Buffer.from('a\nb\n'));
});

test('a file already in LF is returned unchanged', () => {
  const lf = Buffer.from('a\nb\n');
  assert.deepStrictEqual(lfBytes(lf), lf);
});

test('a LONE CR is content and survives', () => {
  // Not pedantry: a rule that strips every CR makes 'a\rb' and 'ab' the same
  // file, so a real difference disappears. tools/prove-red.js carries exactly
  // that mutation and this is the assertion that catches it.
  assert.deepStrictEqual(lfBytes(Buffer.from('a\rb')), Buffer.from('a\rb'));
  assert.notDeepStrictEqual(lfBytes(Buffer.from('a\rb')), lfBytes(Buffer.from('ab')));
});

test('a CR at the very end of the buffer is not a pair, so it stays', () => {
  // buf[i + 1] is undefined here, and `undefined === 0x0a` is false. Spelled out
  // because an off-by-one at the last byte is the classic way to write this loop
  // wrong, and it reads as an accident rather than a decision.
  assert.deepStrictEqual(lfBytes(B(0x61, 0x0d)), B(0x61, 0x0d));
});

test('CRLFCRLF collapses to two LFs, so a blank Windows line survives as blank', () => {
  assert.deepStrictEqual(lfBytes(Buffer.from('a\r\n\r\nb')), Buffer.from('a\n\nb'));
});

test('an empty buffer is fine', () => {
  assert.deepStrictEqual(lfBytes(Buffer.alloc(0)), Buffer.alloc(0));
});

test('THE BYTE THAT CAUSED THIS: 0x92 is not legal UTF-8 and must come back verbatim', () => {
  // March's ci-reference/atco2name_all.json carries a raw 0x92 — the CP1252
  // right single quote in "Ramsey St Mary's". The first version of this helper
  // decoded to UTF-8, which turned it into U+FFFD (ef bf bd), and REWROTE THE
  // FILE that way. This is the assertion that would have caught it before it
  // ever touched a fixture.
  const cp1252 = B(0x4d, 0x61, 0x72, 0x79, 0x92, 0x73, 0x0d, 0x0a); // "Mary<92>s" + CRLF
  const out = lfBytes(cp1252);
  assert.deepStrictEqual(out, B(0x4d, 0x61, 0x72, 0x79, 0x92, 0x73, 0x0a));
  assert.strictEqual(out.includes(0xfd), false, 'a replacement character means the bytes went through a decoder');
});

test('every byte value 0..255 round-trips when no CRLF pair is present', () => {
  // The general form of the test above: nothing outside a CRLF pair is the
  // helper's business, whatever encoding the file happens to be in.
  const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i).filter((b, i, a) => !(b === 0x0d && a[i + 1] === 0x0a)));
  assert.deepStrictEqual(lfBytes(all), all);
});

test('sameBytesIgnoringLineEndings sees past a whole-file CRLF difference', () => {
  assert.strictEqual(sameBytesIgnoringLineEndings(Buffer.from('a\r\nb'), Buffer.from('a\nb')), true);
});

test('...and still reports a real difference, including one made of odd bytes', () => {
  assert.strictEqual(sameBytesIgnoringLineEndings(Buffer.from('a\r\nb'), Buffer.from('a\r\nc')), false);
  // The drift-check blind spot this replaced: under a UTF-8 decode both of these
  // became U+FFFD and the two files compared EQUAL.
  assert.strictEqual(sameBytesIgnoringLineEndings(B(0x41, 0x92), B(0x41, 0x93)), false);
});

test('the input buffer is not modified', () => {
  const src = Buffer.from('a\r\nb');
  const copy = Buffer.from(src);
  lfBytes(src);
  assert.deepStrictEqual(src, copy);
});
