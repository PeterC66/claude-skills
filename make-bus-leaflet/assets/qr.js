// qr.js — a QR encoder, self-contained and dependency-free, for the footer's
// "route back to the current version" code (publisher-benchmark item 2).
//
// WHY IT IS HAND-WRITTEN RATHER THAN AN npm PACKAGE. The engine is vendored into
// the portal, which renders untrusted customer edits on a server, and
// changing-the-engine.md's invariant 4 is "no network at render time" and 5 is
// "deterministic output". A dependency would have to be vendored, audited and
// kept in step across two repos for the sake of one algorithm whose output must
// be byte-stable. This file has no requires at all.
//
// SCOPE, deliberately narrow: byte mode, versions 1-10, all four EC levels. A
// printed sheet carries a short branded URL — "busmaps.uk/st-ives" is 18 bytes,
// which fits version 2 at level M with room to spare — and version 10 at L holds
// 271. Anything longer throws with the capacity it needed, rather than silently
// picking a denser code no phone will read at 16 mm across.
//
// DETERMINISM. The mask is not chosen at random or fixed by fiat: all eight are
// scored with the standard penalty rules and the lowest wins, ties going to the
// lower mask number. Same input => same matrix, on any machine, forever.
'use strict';

// ---------------------------------------------------------------- GF(256) ----
// The Reed-Solomon field QR uses: primitive polynomial x^8+x^4+x^3+x^2+1 (0x11d).
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

// Generator polynomial for `n` error-correction codewords: prod (x + a^i).
// g[0] is the leading coefficient, which is always 1 — relied on by rsEncode.
function rsGenPoly(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); }
    g = ng;
  }
  return g;
}
function rsEncode(data, ecLen) {
  const g = rsGenPoly(ecLen), res = new Uint8Array(data.length + ecLen);
  res.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const f = res[i]; if (!f) continue;
    for (let j = 0; j < g.length; j++) res[i + j] ^= gmul(g[j], f);
  }
  return Array.from(res.slice(data.length));
}

// -------------------------------------------------------- version tables ----
// [ecCodewordsPerBlock, group1Blocks, group1DataCodewords, group2Blocks, group2DataCodewords]
// Table 13-22 of ISO/IEC 18004, versions 1-10 only. Each row's
// (g1*d1 + g2*d2) + (g1+g2)*ec equals that version's total codeword count —
// asserted at load time below, because a single mistyped digit here produces a
// code that scans as garbage rather than failing, and this table is the only
// part of the file that cannot be derived from something else in it.
const BLOCKS = {
  L: [[7,1,19,0,0],[10,1,34,0,0],[15,1,55,0,0],[20,1,80,0,0],[26,1,108,0,0],
      [18,2,68,0,0],[20,2,78,0,0],[24,2,97,0,0],[30,2,116,0,0],[18,2,68,2,69]],
  M: [[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],
      [16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44]],
  Q: [[13,1,13,0,0],[22,1,22,0,0],[18,2,17,0,0],[26,2,24,0,0],[18,2,15,2,16],
      [24,4,19,0,0],[18,2,14,4,15],[22,4,18,2,19],[20,4,16,4,17],[24,6,19,2,20]],
  H: [[17,1,9,0,0],[28,1,16,0,0],[22,2,13,0,0],[16,4,9,0,0],[22,2,11,2,12],
      [28,4,15,0,0],[26,4,13,1,14],[26,4,14,2,15],[24,4,12,4,13],[28,6,15,2,16]],
};
const TOTAL_CODEWORDS = [26,44,70,100,134,172,196,242,292,346];
for (const lvl of Object.keys(BLOCKS)) BLOCKS[lvl].forEach((b, i) => {
  const [ec, g1, d1, g2, d2] = b;
  const n = g1 * d1 + g2 * d2 + (g1 + g2) * ec;
  if (n !== TOTAL_CODEWORDS[i]) throw new Error(`qr.js: BLOCKS.${lvl} v${i + 1} sums to ${n}, not ${TOTAL_CODEWORDS[i]}`);
});
// Alignment-pattern centre coordinates, versions 1-10 (Annex E).
const ALIGN = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
const ECBITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

const dataCapacity = (ver, lvl) => { const [, g1, d1, g2, d2] = BLOCKS[lvl][ver - 1]; return g1 * d1 + g2 * d2; };

// ---------------------------------------------------------- bit assembly ----
function encodeBytes(bytes, ver, lvl) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                        // mode: byte
  push(bytes.length, ver <= 9 ? 8 : 16);  // character count indicator
  for (const b of bytes) push(b, 8);
  const cap = dataCapacity(ver, lvl) * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);   // terminator
  while (bits.length % 8) bits.push(0);                            // pad to a whole byte
  const words = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const PAD = [0xEC, 0x11];
  for (let i = 0; words.length < dataCapacity(ver, lvl); i++) words.push(PAD[i % 2]);
  return words;
}

// Split into blocks, error-correct each, then interleave — data codewords
// column-first across the blocks, then the EC codewords the same way.
function interleave(words, ver, lvl) {
  const [ec, g1, d1, g2, d2] = BLOCKS[lvl][ver - 1];
  const dat = [], ecc = [];
  let p = 0;
  for (let i = 0; i < g1; i++) { const b = words.slice(p, p + d1); p += d1; dat.push(b); ecc.push(rsEncode(b, ec)); }
  for (let i = 0; i < g2; i++) { const b = words.slice(p, p + d2); p += d2; dat.push(b); ecc.push(rsEncode(b, ec)); }
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of dat) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const b of ecc) out.push(b[i]);
  return out;
}

// -------------------------------------------------------------- matrix ------
// `res` marks function modules (finders, separators, timing, alignment, the
// format/version reservations, the dark module). Data placement skips them and
// masking leaves them alone, so the two never have to agree on a coordinate list
// twice — which is the usual way a hand-written encoder goes subtly wrong.
function blankMatrix(ver) {
  const n = ver * 4 + 17;
  const m = [], res = [];
  for (let i = 0; i < n; i++) { m.push(new Uint8Array(n)); res.push(new Uint8Array(n)); }
  const set = (r, c, v) => { m[r][c] = v; res[r][c] = 1; };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6))
              || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      set(rr, cc, on ? 1 : 0);          // the -1/7 ring is the separator: light
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0); set(i, 6, i % 2 === 0 ? 1 : 0); }
  const ctr = ALIGN[ver - 1];
  for (const r0 of ctr) for (const c0 of ctr) {
    if ((r0 === 6 && c0 === 6) || (r0 === 6 && c0 === n - 7) || (r0 === n - 7 && c0 === 6)) continue;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++)
      set(r0 + r, c0 + c, (Math.max(Math.abs(r), Math.abs(c)) !== 1) ? 1 : 0);
  }
  set(n - 8, 8, 1);                                        // dark module
  // Format-information reservations (both copies), then version information.
  for (let i = 0; i <= 8; i++) { if (!res[8][i]) set(8, i, 0); if (!res[i][8]) set(i, 8, 0); }
  for (let i = 0; i < 8; i++) { if (!res[8][n - 1 - i]) set(8, n - 1 - i, 0); if (!res[n - 1 - i][8]) set(n - 1 - i, 8, 0); }
  if (ver >= 7) for (let i = 0; i < 18; i++) { const a = Math.floor(i / 3), b = i % 3; set(n - 11 + b, a, 0); set(a, n - 11 + b, 0); }
  return { m, res, n };
}

function placeData(mx, codewords) {
  const { m, res, n } = mx;
  const bits = [];
  for (const w of codewords) for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1);
  let bi = 0, up = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;                     // column 6 is the vertical timing line
    for (let k = 0; k < n; k++) {
      const r = up ? n - 1 - k : k;
      for (const c of [right, right - 1]) {
        if (res[r][c]) continue;
        m[r][c] = bi < bits.length ? bits[bi++] : 0; // remainder bits are light
      }
    }
    up = !up;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function formatBits(lvl, mask) {
  const v = (ECBITS[lvl] << 3) | mask;
  let d = v << 10;
  for (let i = 14; i >= 10; i--) if (d & (1 << i)) d ^= 0x537 << (i - 10);
  return ((v << 10) | d) ^ 0x5412;
}
function versionBits(ver) {
  let d = ver << 12;
  for (let i = 17; i >= 12; i--) if (d & (1 << i)) d ^= 0x1F25 << (i - 12);
  return (ver << 12) | d;
}

// Format information, Figure 25. Bit 0 of the 15-bit string is the module
// FURTHEST from the top-left corner in each copy, which is why both loops count
// bit index upward while walking the matrix in opposite directions.
//
// Written out as m[row][col] rather than the (x,y) of the usual references,
// because transposing this block is the one mistake that still produces a
// plausible-looking symbol: the finders, timing and data are all symmetric
// enough to survive it, so a swapped copy renders fine and simply never scans.
// (It did, first time. Every one of 35 matrices failed the OpenCV decode.)
function applyFormat(mx, lvl, mask) {
  const { m, n } = mx, f = formatBits(lvl, mask);
  const bit = i => (f >> i) & 1;
  // Copy 1, wrapped around the top-left finder: bits 0-5 down column 8, the
  // three corner modules, then bits 9-14 leftwards along row 8.
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) m[8][14 - i] = bit(i);
  // Copy 2: bits 0-7 leftwards along row 8 from the right edge, bits 8-14
  // upwards along column 8 from the bottom edge.
  for (let i = 0; i <= 7; i++) m[8][n - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) m[n - 15 + i][8] = bit(i);
  m[n - 8][8] = 1;                                     // dark module
}
function applyVersion(mx, ver) {
  if (ver < 7) return;
  const { m, n } = mx, v = versionBits(ver);
  for (let i = 0; i < 18; i++) {
    const b = (v >> i) & 1, a = Math.floor(i / 3), c = i % 3;
    m[n - 11 + c][a] = b; m[a][n - 11 + c] = b;
  }
}

// The four penalty rules, scored on the finished (masked, format-stamped) symbol.
function penalty(m, n) {
  let p = 0;
  const runScore = run => run >= 5 ? 3 + (run - 5) : 0;
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) { if (m[r][c] === m[r][c - 1]) run++; else { p += runScore(run); run = 1; } }
    p += runScore(run);
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) { if (m[r][c] === m[r - 1][c]) run++; else { p += runScore(run); run = 1; } }
    p += runScore(run);
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++)
    if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
  const PAT = [1,0,1,1,1,0,1,0,0,0,0], PAT2 = [0,0,0,0,1,0,1,1,1,0,1];
  const hit = get => {
    let a = true, b = true;
    for (let k = 0; k < 11; k++) { const v = get(k); if (v !== PAT[k]) a = false; if (v !== PAT2[k]) b = false; }
    return a || b;
  };
  for (let r = 0; r < n; r++) for (let c = 0; c + 11 <= n; c++) if (hit(k => m[r][c + k])) p += 40;
  for (let c = 0; c < n; c++) for (let r = 0; r + 11 <= n; r++) if (hit(k => m[r + k][c])) p += 40;
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += m[r][c];
  p += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
  return p;
}

/**
 * encode(text, {level='M', minVersion=1}) -> { n, version, level, modules }
 *   modules: n arrays of n 0/1 values, row-major, top-left origin.
 *   `n` is the module count WITHOUT the quiet zone — the caller supplies that.
 */
function encode(text, { level = 'M', minVersion = 1 } = {}) {
  if (!BLOCKS[level]) throw new Error(`qr.js: unknown EC level ${level} (use L, M, Q or H)`);
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  let ver = 0;
  for (let v = Math.max(1, minVersion | 0); v <= 10; v++) {
    const overhead = 4 + (v <= 9 ? 8 : 16);
    if (bytes.length * 8 + overhead <= dataCapacity(v, level) * 8) { ver = v; break; }
  }
  if (!ver) throw new Error(`qr.js: ${bytes.length} bytes will not fit version 10 at level ${level}`
    + ` (max ${dataCapacity(10, level) - 2}). Use a shorter URL, or a lower EC level.`);
  const codewords = interleave(encodeBytes(bytes, ver, level), ver, level);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const mx = blankMatrix(ver);
    placeData(mx, codewords);
    for (let r = 0; r < mx.n; r++) for (let c = 0; c < mx.n; c++)
      if (!mx.res[r][c] && MASKS[mask](r, c)) mx.m[r][c] ^= 1;
    applyFormat(mx, level, mask);
    applyVersion(mx, ver);
    const p = penalty(mx.m, mx.n);
    if (!best || p < best.p) best = { p, mx };     // strict <, so ties keep the lower mask
  }
  return { n: best.mx.n, version: ver, level, modules: best.mx.m.map(row => Array.from(row)) };
}

/**
 * svgPath(modules, x, y, mod) -> one `d` string covering every dark module.
 * Horizontal runs are merged, which roughly halves the path on a typical symbol
 * and costs nothing — the shape is identical either way.
 */
function svgPath(modules, x, y, mod) {
  const parts = [];
  const f = v => (Math.round(v * 1000) / 1000).toString();
  modules.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c++; continue; }
      let c1 = c; while (c1 < row.length && row[c1]) c1++;
      const w = (c1 - c) * mod;
      parts.push(`M${f(x + c * mod)} ${f(y + r * mod)}h${f(w)}v${f(mod)}h-${f(w)}z`);
      c = c1;
    }
  });
  return parts.join('');
}

module.exports = { encode, svgPath };
