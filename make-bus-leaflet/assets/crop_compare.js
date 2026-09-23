#!/usr/bin/env node
/*
 * crop_compare.js — the same page region cut out of two sheets, at 300 dpi.
 *
 * The companion to preview_design.js. That tool tells you the defect delta; this
 * one shows you the artwork, which on this project is the half that decides
 * things — every design key so far has been settled by rendering a crop and
 * looking at it, and twice the numbers and the picture disagreed (the legend
 * burying spokes, session 8; the fixed exit device, session 9).
 *
 *   node crop_compare.js old.svg new.svg out-prefix [--at x,y --size 40]
 *   node crop_compare.js old.svg new.svg out --poi 3      # 3 densest POI clusters
 *   node crop_compare.js old.svg new.svg out --diff 3     # 3 places the ink moved
 *
 * Writes <prefix>_<n>_old.png / _new.png (and _pair.png, the two stacked with
 * captions, which is the thing to send to Peter).
 *
 * Flags:
 *   --at x,y        centre of the crop in PAGE MILLIMETRES, repeatable
 *   --size mm       crop side, default 40
 *   --poi N         instead of --at, find the N densest POI-symbol clusters in
 *                   the NEW sheet and crop those
 *   --width px      output width per panel, default 1100 (the crop is rasterised
 *                   at 300 dpi and then scaled, so detail is real)
 *   --label "a|b"   captions for the two panels
 *   --diff N        instead of --at, find the N places where the two sheets'
 *                   PIXELS differ most and crop those (buses-data OA-429, the
 *                   monthly batched review). A sheet pair whose pixels do not
 *                   differ at all crops nothing and says so — bytes can move
 *                   without ink moving, and that is the reviewer's to know.
 *   --json          print one JSON object — the spots cropped and the count of
 *                   changed pixels — instead of the per-crop lines, for a caller
 *
 * WITH --diff, NEUTRALISE THE BUILD STAMP IN BOTH FILES FIRST. Two builds of one
 * map always differ in the footer's `build N.N · date`, so without that the
 * densest difference on every pair is the stamp. `ink_review.mjs` in bus-work
 * does it before calling this.
 *
 * THE TRAP THIS FILE EXISTS TO RECORD: do NOT pass { density: 300 } to sharp for
 * these SVGs. The generators declare width="3508" height="2480" on the root, so
 * sharp already rasterises at exactly 300 dpi for an A4 sheet; adding a density
 * makes it 14617 px wide, every mm-to-pixel conversion is then wrong by 4.17x,
 * and the crop silently comes out as a blank corner of the page. It cost half an
 * hour of "why is my crop white" on 2026-08-16.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function main() {   // OA-344: the body is guarded, not re-indented — see test/asset_load.test.js
const A4_W_MM = 297, A4_W_PX = 3508, PX_PER_MM = A4_W_PX / A4_W_MM;

// The one parser (OA-232 Tier 2.5).
const { parseArgs } = require('./cli.js');
const argv = process.argv.slice(2);
const FLAGS = parseArgs(argv);
const pos = argv.filter(a => !a.startsWith('--'));
const flag = (n, d) => (typeof FLAGS[n] === 'string' ? FLAGS[n] : d);
const flags = (n) => argv.reduce((a, v, i) => (v === '--' + n ? a.concat(argv[i + 1]) : a), []);
const [oldSvg, newSvg, prefix] = pos;
if (!oldSvg || !newSvg || !prefix) {
  console.error('usage: node crop_compare.js old.svg new.svg out-prefix [--at x,y] [--size 40] [--poi N]');
  process.exit(1);
}
const SIDE = +flag('size', 40), OUTW = +flag('width', 1100);
const CAPS = String(flag('label', 'before|after')).split('|');

// POI symbols are emitted as `translate(x y) scale(0.21...)` — the map's own
// icon scale. Good enough to find where the symbols are without parsing the SVG.
function poiPositions(svg) {
  const out = []; const re = /translate\(([\d.]+) ([\d.]+)\) scale\(0\.21/g;
  let m; while ((m = re.exec(svg))) out.push([+m[1], +m[2]]);
  return out;
}
function densest(pts, side, n) {
  const picked = [], used = new Set();
  for (let i = 0; i < n; i++) {
    let best = null;
    for (const c of pts) {
      const k = pts.filter((p, j) => !used.has(j) && Math.abs(p[0] - c[0]) < side / 2 && Math.abs(p[1] - c[1]) < side / 2).length;
      if (!best || k > best.n) best = { c, n: k };
    }
    if (!best || !best.n) break;
    pts.forEach((p, j) => { if (Math.abs(p[0] - best.c[0]) < side / 2 && Math.abs(p[1] - best.c[1]) < side / 2) used.add(j); });
    picked.push(best.c);
  }
  return picked;
}
// Where the two rasters differ: a quarter-scale pixel diff binned into 4 mm
// cells, then the N busiest cells, each at least half a crop from the last so
// two crops never show the same change. Quarter scale is still 0.34 mm a pixel,
// finer than any stroke that matters, and it keeps the diff to ~2 M pixels.
async function diffSpots(aBuf, bBuf, side, n) {
  const small = (buf) => sharp(buf).resize({ width: Math.round(A4_W_PX / 4) }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const [a, b] = await Promise.all([small(aBuf), small(bBuf)]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { spots: [], changedPx: null, why: 'the two sheets are not the same size' };
  }
  const { width: W, height: H, channels: C } = a.info;
  const pxPerMm = PX_PER_MM / 4, cell = Math.max(4, Math.round(pxPerMm * 4));
  const gw = Math.ceil(W / cell), counts = new Map();
  let changedPx = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C;
      let d = 0;
      for (let c = 0; c < C; c++) d = Math.max(d, Math.abs(a.data[o + c] - b.data[o + c]));
      if (d <= 24) continue;   // anti-aliasing noise, not ink
      changedPx++;
      const k = Math.floor(y / cell) * gw + Math.floor(x / cell);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const spots = [];
  for (const [k] of [...counts].sort((p, q) => q[1] - p[1])) {
    if (spots.length >= n) break;
    const cx = ((k % gw) + 0.5) * cell / pxPerMm, cy = (Math.floor(k / gw) + 0.5) * cell / pxPerMm;
    if (spots.some(([x, y]) => Math.abs(x - cx) < side / 2 && Math.abs(y - cy) < side / 2)) continue;
    spots.push([cx, cy]);
  }
  return { spots, changedPx };
}

const caption = (t, w) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="46">`
  + `<rect width="${w}" height="46" fill="#ffffff"/>`
  + `<text x="10" y="32" font-family="Arial" font-size="26" fill="#1c1f22">${t.replace(/[<&]/g, '')}</text></svg>`);

(async () => {
  const aSvg = fs.readFileSync(oldSvg, 'utf8'), bSvg = fs.readFileSync(newSvg, 'utf8');
  const JSON_OUT = FLAGS.json === true;
  // No { density }: the SVG already carries its 300 dpi pixel size. See the header.
  const aBuf = await sharp(Buffer.from(aSvg)).png().toBuffer();
  const bBuf = await sharp(Buffer.from(bSvg)).png().toBuffer();

  let spots = flags('at').map(s => s.split(',').map(Number)), diff = null;
  if (!spots.length && FLAGS.diff !== undefined) {
    diff = await diffSpots(aBuf, bBuf, SIDE, +flag('diff', 3));
    spots = diff.spots;
    if (!spots.length) {   // not an error: bytes moved and no ink did, or the sizes differ
      if (JSON_OUT) console.log(JSON.stringify({ spots: [], changedPx: diff.changedPx, why: diff.why || null }));
      else console.log(`no crop: ${diff.why || 'no pixel differs between the two sheets'}`);
      return;
    }
  }
  if (!spots.length && FLAGS.diff === undefined) spots = densest(poiPositions(bSvg), SIDE, +flag('poi', 2));
  if (!spots.length) { console.error('nothing to crop: pass --at x,y'); process.exit(1); }
  const { width: PW, height: PH } = await sharp(bBuf).metadata();

  for (let i = 0; i < spots.length; i++) {
    const [cx, cy] = spots[i];
    const size = Math.round(SIDE * PX_PER_MM);
    // Clamped to the page: a change in the footer is a change worth showing, and
    // a crop box that ran off the edge made sharp throw rather than crop.
    const box = {
      left: Math.max(0, Math.min(PW - size, Math.round((cx - SIDE / 2) * PX_PER_MM))),
      top: Math.max(0, Math.min(PH - size, Math.round((cy - SIDE / 2) * PX_PER_MM))),
      width: Math.min(size, PW), height: Math.min(size, PH),
    };
    const cut = async (buf) => sharp(buf).extract(box).resize({ width: OUTW }).png().toBuffer();
    const a = await cut(aBuf), b = await cut(bBuf);
    await fs.promises.writeFile(`${prefix}_${i}_old.png`, a);
    await fs.promises.writeFile(`${prefix}_${i}_new.png`, b);
    const h = (await sharp(a).metadata()).height;
    await sharp({ create: { width: OUTW, height: (h + 46) * 2 + 16, channels: 3, background: '#ffffff' } })
      .composite([{ input: caption(CAPS[0] || 'before', OUTW), top: 0, left: 0 },
                  { input: a, top: 46, left: 0 },
                  { input: caption(CAPS[1] || 'after', OUTW), top: h + 62, left: 0 },
                  { input: b, top: h + 108, left: 0 }])
      .png().toFile(`${prefix}_${i}_pair.png`);
    if (!JSON_OUT) console.log(`${path.basename(prefix)}_${i}: ${cx.toFixed(0)},${cy.toFixed(0)} mm  (${SIDE} mm square)`);
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ spots: spots.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]),
      changedPx: diff ? diff.changedPx : null, pairs: spots.map((_, i) => `${prefix}_${i}_pair.png`) }));
  }
})();
}

if (require.main === module) main();
module.exports = { main };
