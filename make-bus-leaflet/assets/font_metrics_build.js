#!/usr/bin/env node
/*
 * font_metrics_build.js — regenerate `font_metrics.js` from the installed Arial.
 *
 * Run this ONLY when the baked table needs to change: a new glyph appears in a
 * label (an accented place name, a new symbol) and `textWidth()` starts falling
 * back to the 0.556em default for it. Ordinary work never runs this — the point
 * of baking the table is that no build step touches a font file.
 *
 *   node font_metrics_build.js                 # rewrites font_metrics.js in place
 *   node font_metrics_build.js --check         # reports missing glyphs, writes nothing
 *   node font_metrics_build.js --buses "<dir>" # non-default Buses root
 *
 * It harvests its own character set from every `<text>` element in every
 * shipped `ci-reference/*.svg`, plus printable ASCII and the punctuation the
 * sheets use, so a glyph that exists on any map is always covered.
 *
 * WHY BAKED AND NOT READ AT RUNTIME: changing-the-engine.md §1 invariants 4
 * (no network / no outside reads at render time) and 5 (deterministic output).
 * A generator that measured text from C:\Windows\Fonts would produce different
 * SVGs on different machines, and the portal renders on a Linux server with no
 * Arial at all. Arial and Liberation Sans are metric-compatible by design, so
 * the widths baked here are correct for the substitution the server makes.
 *
 * Zero dependencies (Node core only).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ARGV = process.argv.slice(2);
const CHECK = ARGV.includes('--check');
const bi = ARGV.indexOf('--buses');
const BUSES = bi >= 0 ? ARGV[bi + 1] : 'C:/u3a St Ives/Using AI/Buses';
const REG_TTF = 'C:/Windows/Fonts/arial.ttf';
const BOLD_TTF = 'C:/Windows/Fonts/arialbd.ttf';
const OUT = path.join(__dirname, 'font_metrics.js');

// ------------------------------------------------------------- TTF plumbing
function tables(buf) {
  const n = buf.readUInt16BE(4), t = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    t[buf.toString('ascii', o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
  }
  return t;
}

// Arial ships BOTH a format-4 (3,1) BMP subtable and a format-12 (3,10) full
// one. Taking whichever came last threw "cmap subtable is not format 4"; every
// glyph these maps use is in the BMP, so prefer format 4 and keep 12 as a fallback.
function cmapLookup(buf, off) {
  const n = buf.readUInt16BE(off + 2), subs = [];
  for (let i = 0; i < n; i++) {
    const r = off + 4 + i * 8;
    const pid = buf.readUInt16BE(r), eid = buf.readUInt16BE(r + 2), so = buf.readUInt32BE(r + 4);
    if (pid === 3 && (eid === 1 || eid === 10)) subs.push({ at: off + so, fmt: buf.readUInt16BE(off + so) });
  }
  const f4 = subs.find(s => s.fmt === 4), f12 = subs.find(s => s.fmt === 12);
  if (!f4 && f12) {
    const nGroups = buf.readUInt32BE(f12.at + 12);
    return (cp) => {
      for (let g = 0; g < nGroups; g++) {
        const o = f12.at + 16 + g * 12;
        const s = buf.readUInt32BE(o), e = buf.readUInt32BE(o + 4);
        if (cp >= s && cp <= e) return buf.readUInt32BE(o + 8) + (cp - s);
      }
      return 0;
    };
  }
  if (!f4) throw new Error('no usable (3,1)/(3,10) cmap subtable in this font');
  const best = f4.at, segX2 = buf.readUInt16BE(best + 6), seg = segX2 / 2;
  const endO = best + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
  return (cp) => {
    for (let s = 0; s < seg; s++) {
      const end = buf.readUInt16BE(endO + s * 2);
      if (cp > end) continue;
      const start = buf.readUInt16BE(startO + s * 2);
      if (cp < start) return 0;
      const delta = buf.readInt16BE(deltaO + s * 2), ro = buf.readUInt16BE(rangeO + s * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const g = buf.readUInt16BE(rangeO + s * 2 + ro + (cp - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
}

function widths(file, chars) {
  const buf = fs.readFileSync(file), t = tables(buf);
  const upem = buf.readUInt16BE(t.head.off + 18);
  const numH = buf.readUInt16BE(t.hhea.off + 34);
  const look = cmapLookup(buf, t.cmap.off);
  const out = {};
  for (const ch of chars) {
    const gid = look(ch.codePointAt(0));
    if (!gid) continue;
    out[ch] = +(buf.readUInt16BE(t.hmtx.off + Math.min(gid, numH - 1) * 4) / upem).toFixed(4);
  }
  return out;
}

// ---------------------------------------------------------------- charset
const DEC = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&');

function harvest(busesDir) {
  const set = new Set();
  for (let c = 0x20; c < 0x7f; c++) set.add(String.fromCharCode(c));
  for (const ch of '£€–—·•©®°éèáàóúüöäñ’‘“”…×') set.add(ch);
  let n = 0;
  (function walk(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!e.name.endsWith('.svg') || path.basename(d) !== 'ci-reference') continue;
      n++;
      const svg = fs.readFileSync(p, 'utf8');
      for (const m of svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)) for (const ch of DEC(m[1])) set.add(ch);
    }
  })(path.join(busesDir, 'Areas'));
  return { chars: [...set].filter(c => c >= ' ').sort(), sheets: n };
}

// ------------------------------------------------------------------- main
const { chars, sheets } = harvest(BUSES);
const reg = widths(REG_TTF, chars);
const bold = widths(BOLD_TTF, chars);
const missing = chars.filter(c => !(c in reg));
console.log(`${sheets} sheets scanned · ${chars.length} distinct characters · ${Object.keys(reg).length} regular / ${Object.keys(bold).length} bold glyphs`);
if (missing.length) console.error('WARNING no glyph in Arial for: ' + JSON.stringify(missing.join('')));

if (CHECK) {
  const cur = fs.existsSync(OUT) ? require(OUT) : null;
  if (cur) {
    const absent = chars.filter(c => !(c in cur.REGULAR));
    console.log(absent.length
      ? `font_metrics.js is MISSING ${absent.length} glyph(s): ${JSON.stringify(absent.join(''))} — re-run without --check`
      : 'font_metrics.js covers every character currently on a sheet.');
  }
  process.exit(0);
}

const enc = JSON.stringify;
fs.writeFileSync(OUT, `/*
 * font_metrics.js — Arial advance widths, in em units, baked at build time.
 *
 * GENERATED FILE — do not hand-edit. Regenerate with:
 *     node "%SK%\\font_metrics_build.js"
 * and check coverage without rewriting with:
 *     node "%SK%\\font_metrics_build.js" --check
 *
 * WHY BAKED: the generators must stay deterministic and free of outside reads
 * (changing-the-engine.md §1, invariants 4 and 5). Measuring text from an
 * installed font would make output depend on which Arial a machine has, and
 * the portal renders on a server that may have none. Arial and Liberation Sans
 * are metric-compatible, so these widths hold for the Linux substitution.
 *
 * WHY IT EXISTS: label collision code guessed width as
 * \`text.length * size * 0.52\` (gen_internal.js:648, and :1485). Real Arial
 * advances span 0.222em ('i') to 0.944em ('W') — a factor of four — so the
 * guess both invented collisions (labels dropped that would have fitted; it
 * over-estimates a typical name by ~11%) and missed real ones (labels drawn
 * over each other). See Development Docs/label-and-design-quality-plan.
 *
 * ${chars.length} glyphs, harvested from every shipped ci-reference sheet.
 */
'use strict';
const REGULAR = ${enc(reg)};
const BOLD = ${enc(bold)};
const FALLBACK = 0.556;   // 'n' — used for any character not in the table

// Width of \`text\` in mm at \`size\` mm, matching what the renderer will draw.
function textWidth(text, size, bold) {
  const t = bold ? BOLD : REGULAR;
  let em = 0;
  for (const ch of String(text)) em += (ch in t) ? t[ch] : FALLBACK;
  return em * size;
}

// Cap height and descender as fractions of font size (Arial), for label boxes
// that hug the ink rather than the full em square.
const CAP_HEIGHT = 0.716;
const DESCENDER = 0.212;

module.exports = { textWidth, REGULAR, BOLD, FALLBACK, CAP_HEIGHT, DESCENDER };
`);
console.log('wrote ' + OUT);
