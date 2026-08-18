#!/usr/bin/env node
/*
 * sheet_pair.js — two WHOLE sheets, stacked and captioned, at page scale.
 *
 * The companion to crop_compare.js, and the answer to a defect that tool cannot
 * show you. crop_compare settles detail: does this label clear that line, is the
 * chequer fusing. It cannot settle PROPORTION — how much of the sheet a change
 * takes over — because a 40 mm crop has no page in it.
 *
 * Written 2026-08-17, when the frequency-tier dashed "limited" style looked
 * perfectly reasonable in every crop and was obviously wrong at page scale: 40% of
 * a market town's lanes are limited, so dashing them made Ramsey — which has no
 * frequent lane to anchor it — read as a town whose buses are provisional. Nothing
 * in the defect numbers said so either; they moved by one or two either way.
 *
 *   node sheet_pair.js old.svg new.svg out.png ["before|after"] [width-px]
 *
 * Defaults: captions "shipped|with frequency tiers", 1500 px per panel. The SVGs
 * declare width="3508", so sharp already rasterises at 300 dpi for A4 — do NOT
 * pass { density: 300 } (the trap recorded at the top of crop_compare.js).
 *
 * Zero dependencies beyond sharp, which the skill already has.
 */
'use strict';
const sharp = require('sharp');

const [oldSvg, newSvg, out, labels = 'shipped|with frequency tiers', W = '1500'] = process.argv.slice(2);
if (!oldSvg || !newSvg || !out) {
  console.error('usage: node sheet_pair.js old.svg new.svg out.png ["before|after"] [width-px]');
  process.exit(2);
}
const [capA, capB] = labels.split('|');
const w = parseInt(W, 10), BAR = 46;

const caption = (text, width) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR}">
     <rect width="${width}" height="${BAR}" fill="#111"/>
     <text x="14" y="31" font-family="Arial" font-size="24" fill="#fff">${
       String(text).replace(/[<&]/g, c => ({ '<': '&lt;', '&': '&amp;' }[c]))}</text></svg>`);

(async () => {
  const panels = [];
  for (const [file, cap] of [[oldSvg, capA], [newSvg, capB]]) {
    const img = await sharp(file).resize({ width: w }).png().toBuffer();
    const { height } = await sharp(img).metadata();
    panels.push({ img, height, cap: await sharp(caption(cap, w)).png().toBuffer() });
  }
  const H = panels.reduce((a, p) => a + p.height + BAR, 0);
  const composite = [];
  let y = 0;
  for (const p of panels) {
    composite.push({ input: p.cap, top: y, left: 0 }); y += BAR;
    composite.push({ input: p.img, top: y, left: 0 }); y += p.height;
  }
  await sharp({ create: { width: w, height: H, channels: 3, background: '#ffffff' } })
    .composite(composite).png().toFile(out);
  console.log(`wrote ${out}  ${w}x${H}`);
})();
