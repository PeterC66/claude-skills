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
const caption = (t, w) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="46">`
  + `<rect width="${w}" height="46" fill="#ffffff"/>`
  + `<text x="10" y="32" font-family="Arial" font-size="26" fill="#1c1f22">${t.replace(/[<&]/g, '')}</text></svg>`);

(async () => {
  const aSvg = fs.readFileSync(oldSvg, 'utf8'), bSvg = fs.readFileSync(newSvg, 'utf8');
  let spots = flags('at').map(s => s.split(',').map(Number));
  if (!spots.length) spots = densest(poiPositions(bSvg), SIDE, +flag('poi', 2));
  if (!spots.length) { console.error('nothing to crop: pass --at x,y'); process.exit(1); }

  // No { density }: the SVG already carries its 300 dpi pixel size. See the header.
  const aBuf = await sharp(Buffer.from(aSvg)).png().toBuffer();
  const bBuf = await sharp(Buffer.from(bSvg)).png().toBuffer();

  for (let i = 0; i < spots.length; i++) {
    const [cx, cy] = spots[i];
    const box = {
      left: Math.max(0, Math.round((cx - SIDE / 2) * PX_PER_MM)),
      top: Math.max(0, Math.round((cy - SIDE / 2) * PX_PER_MM)),
      width: Math.round(SIDE * PX_PER_MM), height: Math.round(SIDE * PX_PER_MM),
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
    console.log(`${path.basename(prefix)}_${i}: ${cx.toFixed(0)},${cy.toFixed(0)} mm  (${SIDE} mm square)`);
  }
})();
