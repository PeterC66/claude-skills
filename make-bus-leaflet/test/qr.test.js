/*
 * qr.test.js — the footer's QR encoder, held against matrices an independent
 * encoder produced (buses-data OA-625).
 *
 * WHY THIS EXISTS. qr.js is hashed and draws a code onto every sheet with a
 * footer QR, and until 2026-10-11 nothing tested it and no mutation named it: the
 * fifth codebase review running to say so. The byte gate certifies the codes the
 * committed maps print, and those are a handful of short URLs at version 2; it
 * cannot see version 7's version block, version 10's 16-bit count, or a long URL.
 *
 * WHERE THE KNOWN MATRICES CAME FROM. OpenCV 4.13's cv2.QRCodeEncoder, byte mode,
 * which shares no code with this file, on 2026-10-11:
 *   - HELLO at L, version 1: identical in every module.
 *   - busmaps.uk/st-ives at M forced to version 7, and 231 bytes at L (version 10):
 *     identical in every module. Neither version has remainder bits.
 *   - busmaps.uk/st-ives at M, version 2: identical except module (16,1), one of
 *     version 2's seven remainder bits. ISO/IEC 18004 makes those 0 before masking,
 *     which is what qr.js does and what the matrix below holds; OpenCV sets that
 *     one otherwise, and decoders never read it. OpenCV's decoder reads ours back.
 * The two large ones are held as a sha256 of their rows, because 45 and 57 rows of
 * digits would be this file.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { load } = require('./_engine');

const { encode, svgPath } = load('qr.js');

const rows = (e) => e.modules.map((r) => r.join(''));
const digest = (e) => crypto.createHash('sha256').update(rows(e).join('\n')).digest('hex');

// Format information as ISO/IEC 18004 Table C.1 prints it, mask 0 to 7.
const ISO_FORMAT = {
  L: ['111011111000100', '111001011110011', '111110110101010', '111100010011101',
      '110011000101111', '110001100011000', '110110001000001', '110100101110110'],
  M: ['101010000010010', '101000100100101', '101111001111100', '101101101001011',
      '100010111111001', '100000011001110', '100111110010111', '100101010100000'],
};
// Copy 1 wraps the top-left finder; copy 2 is split between the other two. Both
// read most significant bit first.
const formatCopy1 = (m) => {
  const b = [];
  for (let i = 0; i <= 5; i++) b.push(m[i][8]);
  b.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i <= 14; i++) b.push(m[8][14 - i]);
  return b.reverse().join('');
};
const formatCopy2 = (m, n) => {
  const b = [];
  for (let i = 0; i <= 7; i++) b.push(m[8][n - 1 - i]);
  for (let i = 8; i <= 14; i++) b.push(m[n - 15 + i][8]);
  return b.reverse().join('');
};

test('HELLO at level L is the version 1 symbol an independent encoder draws, module for module', () => {
  const e = encode('HELLO', { level: 'L' });
  assert.deepStrictEqual([e.version, e.n, e.level], [1, 21, 'L']);
  assert.deepStrictEqual(rows(e), [
    '111111101011101111111',
    '100000100011001000001',
    '101110101101001011101',
    '101110101100101011101',
    '101110101001001011101',
    '100000100111101000001',
    '111111101010101111111',
    '000000000001100000000',
    '111100101111110011101',
    '110101011001111001100',
    '001011100001000000011',
    '110101001101001111010',
    '100111101000100100101',
    '000000001001001000101',
    '111111100001100100000',
    '100000100110000111110',
    '101110100010111111011',
    '101110101101001011110',
    '101110101000101100100',
    '100000101000010110001',
    '111111101100010100000',
  ]);
  assert.strictEqual(formatCopy1(e.modules), ISO_FORMAT.L[3], 'mask 3 wins on penalty');
});

test('a footer URL at level M is version 2 with its remainder bits light before masking', () => {
  const e = encode('busmaps.uk/st-ives', { level: 'M' });
  assert.deepStrictEqual([e.version, e.n], [2, 25]);
  assert.deepStrictEqual(rows(e), [
    '1111111001000010101111111',
    '1000001001001101101000001',
    '1011101011000011101011101',
    '1011101011100001001011101',
    '1011101010000100101011101',
    '1000001010000111001000001',
    '1111111010101010101111111',
    '0000000011001100100000000',
    '1011111001011011101111100',
    '1110000100001000100101010',
    '1111011100011001100100111',
    '0110110111001011010100011',
    '1110001100010000001111111',
    '1011110011001110100100110',
    '1011111101100111110010011',
    '1001110100001101110110000',
    '1000011110001010111111101',
    '0000000011000001100011000',
    '1111111000011000101010011',
    '1000001010110011100010000',
    '1011101011010001111110101',
    '1011101011001111011011011',
    '1011101010100110010001001',
    '1000001001001100101110001',
    '1111111010001010010000111',
  ]);
  assert.strictEqual(formatCopy1(e.modules), ISO_FORMAT.M[2]);
});

test('version 7 carries its version block, in both copies, as ISO tabulates it', () => {
  const e = encode('busmaps.uk/st-ives', { level: 'M', minVersion: 7 });
  assert.deepStrictEqual([e.version, e.n], [7, 45]);
  assert.strictEqual(digest(e), 'ce66118d0be247ead6c6724cb08d4562bf371c93dcade323ea9c3865179692ca');
  const n = e.n, a = [], b = [];
  for (let i = 0; i < 18; i++) {
    a.push(e.modules[n - 11 + (i % 3)][Math.floor(i / 3)]);   // bottom-left copy
    b.push(e.modules[Math.floor(i / 3)][n - 11 + (i % 3)]);   // top-right copy
  }
  const read = (bits) => parseInt(bits.reverse().join(''), 2);
  assert.strictEqual(read(a), 0x07C94, 'Annex D, version 7');
  assert.strictEqual(read(b), 0x07C94);
});

test('version 10 takes a 16-bit count, two block groups and a 3 x 3 alignment grid', () => {
  const text = ('busmaps.uk/' + 'abcdefghij'.repeat(22)).slice(0, 231);
  const e = encode(text, { level: 'L' });
  assert.deepStrictEqual([e.version, e.n], [10, 57]);
  assert.strictEqual(digest(e), '399aca2e0caf318733a96645a621be21b98b370559831c37b41d28d5ffc79258');
});

test('both copies of the format information agree and are an ISO entry, at every mask the encoder picks', () => {
  const seen = { L: new Set(), M: new Set() };
  for (let k = 0; k < 120; k++) {
    for (const level of ['L', 'M']) {
      const e = encode('busmaps.uk/' + k.toString(36) + 'x'.repeat(k % 40), { level });
      const one = formatCopy1(e.modules);
      assert.strictEqual(formatCopy2(e.modules, e.n), one, `copies disagree at ${k} ${level}`);
      assert.ok(ISO_FORMAT[level].includes(one), `${one} is no ${level} format string (${k})`);
      seen[level].add(one);
    }
  }
  // A test that only ever met one mask would hold one row of the table.
  assert.ok(seen.L.size >= 6 && seen.M.size >= 6, `masks met: L ${seen.L.size}, M ${seen.M.size}`);
});

test('the finders, timing lines and dark module are where every reader looks for them', () => {
  for (const [text, level] of [['HELLO', 'L'], ['busmaps.uk/st-ives', 'M']]) {
    const { modules: m, n } = encode(text, { level });
    const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      assert.deepStrictEqual(finder.map((_, r) => m[r0 + r].slice(c0, c0 + 7).join('')), finder);
    }
    for (let i = 8; i < n - 8; i++) {
      assert.strictEqual(m[6][i], i % 2 === 0 ? 1 : 0, `row 6 timing at ${i}`);
      assert.strictEqual(m[i][6], i % 2 === 0 ? 1 : 0, `column 6 timing at ${i}`);
    }
    assert.strictEqual(m[n - 8][8], 1, 'the dark module');
  }
});

test('the version is the smallest that holds the BYTES, and past version 10 it refuses', () => {
  assert.strictEqual(encode('a'.repeat(17), { level: 'L' }).version, 1);
  assert.strictEqual(encode('a'.repeat(18), { level: 'L' }).version, 2);
  assert.strictEqual(encode('é'.repeat(8), { level: 'L' }).version, 1, '16 UTF-8 bytes');
  assert.strictEqual(encode('é'.repeat(9), { level: 'L' }).version, 2, '18 UTF-8 bytes, not 9 characters');
  assert.strictEqual(encode('x'.repeat(230), { level: 'L' }).version, 9);
  assert.strictEqual(encode('x'.repeat(271), { level: 'L' }).version, 10);
  assert.throws(() => encode('x'.repeat(272), { level: 'L' }), /272 bytes will not fit version 10 at level L/);
  assert.throws(() => encode('x', { level: 'Z' }), /unknown EC level Z/);
  assert.strictEqual(encode('x', { minVersion: 3 }).version, 3);
});

test('the same text gives the same matrix, and a tied penalty goes to the lower mask', () => {
  assert.deepStrictEqual(encode('busmaps.uk/st-ives'), encode('busmaps.uk/st-ives'));
  // Masks 1 and 4 both score 353 here (found by search on 2026-10-11). ISO leaves
  // the tie open; qr.js's header promises the lower number, and nothing else would
  // notice a code that changed mask between two builds of one map.
  assert.strictEqual(formatCopy1(encode('busmaps.uk/2d', { level: 'M' }).modules), ISO_FORMAT.M[1]);
});

test('svgPath merges each horizontal run into one rectangle', () => {
  assert.strictEqual(svgPath([[1, 1, 0, 1], [0, 0, 0, 0], [0, 1, 1, 1]], 10, 20, 0.5),
    'M10 20h1v0.5h-1zM11.5 20h0.5v0.5h-0.5zM10.5 21h1.5v0.5h-1.5z');
  assert.strictEqual(svgPath([[0, 0]], 0, 0, 1), '');
});
