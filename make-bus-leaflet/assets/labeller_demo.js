#!/usr/bin/env node
/*
 * labeller_demo.js — the synthetic test page labeller.js is developed against.
 *
 * Phase 2 of the design-quality plan deliberately wires nothing in: the placer
 * has to be judged on its own before a real sheet moves. This draws the same
 * scene twice — crossing route ribbons, a river, a scatter of symbols, a panel
 * and a footer plate — labelled once by the OLD algorithm (first-fit over eight
 * fixed offsets, width guessed as length*size*0.52, no knowledge of ink) and
 * once by labeller.js, so the difference is visible rather than asserted.
 *
 *   node labeller_demo.js [outdir]     # writes labeller-old.svg / labeller-new.svg
 *
 * Then measure both with quality_metrics.js, which knows nothing about either.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Labeller } = require(path.join(__dirname, 'labeller.js'));

const OUT = process.argv[2] || process.cwd();
const W = 297, H = 210;
const FRAME = { x0: 6, y0: 30, x1: 196, y1: 192 };
const PALETTE = { A: '#0072b2', B: '#d55e00', C: '#009e73', D: '#cc79a7', E: '#7b3294' };

// ---- the scene (deterministic, hand-authored so it stresses the known cases) --
// Ribbons: long diagonals and a bundle of near-parallel lines, which is where
// labels get squeezed on the real sheets.
const RIBBONS = [
  { r: 'A', pts: [[10, 60], [55, 72], [95, 68], [140, 96], [190, 104]] },
  { r: 'B', pts: [[12, 96], [58, 90], [96, 104], [138, 100], [192, 130]] },
  { r: 'C', pts: [[20, 180], [46, 140], [70, 108], [92, 70], [120, 38]] },
  { r: 'D', pts: [[8, 140], [60, 136], [104, 146], [150, 138], [192, 158]] },
  { r: 'E', pts: [[30, 34], [58, 76], [88, 118], [116, 158], [150, 188]] },
];
const RIVER = [[6, 168], [40, 160], [78, 172], [118, 162], [160, 176], [196, 168]];
// Symbols: a mix of isolated ones, a tight cluster (the "Carrington blob" case),
// and several sitting directly on a ribbon.
const SYMS = [
  ['Waitrose', 96, 68], ['Library', 55, 72], ['Sainsbury\'s', 140, 96],
  ['Priory Junior School', 58, 90], ['Riverside Health Centre', 104, 146],
  ['Market Square', 92, 70], ['The Maple Centre', 116, 158],
  ['Leisure Centre', 70, 108], ['Aldi', 46, 140], ['Cromwell Academy', 150, 138],
  ['St Peter\'s', 30, 34], ['Boundary Park', 190, 104], ['Tesco Express', 12, 96],
  ['Hinchingbrooke Hospital', 138, 100], ['Community Centre', 60, 136],
  ['Wintringham Primary', 118, 162], ['Copley Scout Park', 78, 172],
  ['Museum', 88, 118], ['Town Hall', 89, 121], ['Bus Station', 91, 116],
  ['Spring Common Academy', 20, 180], ['Kings Ripton Road Surgery', 192, 130],
];

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function scene() {
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<clipPath id="map"><rect x="${FRAME.x0}" y="${FRAME.y0}" width="${FRAME.x1 - FRAME.x0}" height="${FRAME.y1 - FRAME.y0}"/></clipPath>`,
    `<g clip-path="url(#map)">`];
  const d = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
  o.push(`<path d="${d(RIVER)}" fill="none" stroke="#9ec9e8" stroke-width="3.4" stroke-linecap="round"/>`);
  for (const R of RIBBONS) {
    o.push(`<path d="${d(R.pts)}" fill="none" stroke="#e4e4e4" stroke-width="4.3" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const R of RIBBONS) {
    o.push(`<path d="${d(R.pts)}" fill="none" stroke="${PALETTE[R.r]}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  o.push(`</g>`);
  for (const [, x, y] of SYMS) {
    o.push(`<g transform="translate(${x} ${y}) scale(0.0875)"><rect x="-24" y="-24" width="48" height="48" rx="6" fill="none" stroke="#444" stroke-width="4"/><circle cx="0" cy="0" r="10" fill="#444"/></g>`);
  }
  return o;
}
function chrome(o) {
  o.push(`<text x="6" y="16" font-family="Arial" font-weight="bold" font-size="11" fill="#0072b2">Labeller test page</text>`);
  o.push(`<rect x="197" y="0" width="100" height="210" fill="#fff"/>`);
  o.push(`<text x="200" y="14" font-family="Arial" font-weight="bold" font-size="5" fill="#222">Services</text>`);
  Object.keys(PALETTE).forEach((r, i) => {
    o.push(`<circle cx="204" cy="${24 + i * 8}" r="3" fill="${PALETTE[r]}"/>`);
    o.push(`<text x="210" y="${25.5 + i * 8}" font-family="Arial" font-weight="bold" font-size="3.4" fill="#222">Route ${r}</text>`);
  });
  o.push(`<rect x="0" y="195.16" width="297" height="14.84" fill="#fff" fill-opacity="0.97"/>`);
  o.push(`<text x="8" y="202.4" font-family="Arial" font-size="2.8" fill="#666">Synthetic test page for labeller.js — not a real map.</text>`);
  o.push(`<text x="294" y="206" font-family="Arial" font-size="2.8" fill="#999" text-anchor="end">Map design © BusMaps.uk</text>`);
  o.push('</svg>');
  return o.join('\n');
}

// ---- OLD: the placer as it stands in gen_internal.js (placeLabel) -----------
function oldPage() {
  const o = scene();
  const placed = [[197, 0, 297, 210], [0, 0, 86, 26]];
  const overlaps = b => placed.some(p => !(b[2] < p[0] || b[0] > p[2] || b[3] < p[1] || b[1] > p[3]));
  let dropped = 0;
  for (const [name, x, y] of SYMS) {
    const sz = 2.5, w = name.length * sz * 0.52, h = sz;
    const cands = [[x + 2.6, y + 0.9, 'start'], [x - 2.6, y + 0.9, 'end'], [x, y - 2.6, 'middle'], [x, y + 3.6, 'middle'],
                   [x + 2.6, y - 2.2, 'start'], [x - 2.6, y - 2.2, 'end'], [x + 2.6, y + 3.4, 'start'], [x - 2.6, y + 3.4, 'end']];
    let chosen = null;
    for (const [lx, ly, anc] of cands) {
      const bx = anc === 'start' ? lx : anc === 'end' ? lx - w : lx - w / 2;
      const b = [bx - 0.4, ly - h, bx + w + 0.4, ly + 1];
      if (b[0] < 1 || b[2] > 198) continue;
      if (!overlaps(b)) { placed.push(b); chosen = [lx, ly, anc]; break; }
    }
    if (!chosen) { dropped++; continue; }
    o.push(`<text x="${chosen[0].toFixed(2)}" y="${chosen[1].toFixed(2)}" font-family="Arial" font-size="2.5" fill="#222" text-anchor="${chosen[2]}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(name)}</text>`);
  }
  return { svg: chrome(o), dropped };
}

// ---- NEW: labeller.js ------------------------------------------------------
function newPage() {
  const body = scene();
  const L = new Labeller({ page: [W, H], frame: FRAME });
  const pal = new Set(Object.values(PALETTE));
  L.stampSvg(body.join('\n'), (stroke, w) => pal.has(stroke) || (stroke === '#9ec9e8' && w >= 1.2));
  L.block([197, 0, 297, 210], 'panel');
  L.block([0, 0, 86, 26], 'title');
  L.block([0, 195.16, 297, 210], 'footer');
  for (const [name, x, y] of SYMS) L.block([x - 2.1, y - 2.1, x + 2.1, y + 2.1], 'icon:' + name);
  for (const [name, x, y] of SYMS) {
    L.add({ id: name, at: [x, y], text: name, size: 2.5, own: [x - 2.1, y - 2.1, x + 2.1, y + 2.1] });
  }
  const o = body.concat(L.svg('array'));
  return { svg: chrome(o), dropped: L.unplaced().length, unplaced: L.unplaced() };
}

const a = oldPage(), b = newPage();
fs.writeFileSync(path.join(OUT, 'labeller-old.svg'), a.svg);
fs.writeFileSync(path.join(OUT, 'labeller-new.svg'), b.svg);
fs.writeFileSync(path.join(OUT, 'routes.json'), JSON.stringify({ town: 'Labeller test', palette: PALETTE }, null, 2));
console.log(`old: ${SYMS.length - a.dropped}/${SYMS.length} placed, ${a.dropped} dropped silently`);
console.log(`new: ${SYMS.length - b.dropped}/${SYMS.length} placed, ${b.dropped} unplaced` + (b.dropped ? ' -> ' + b.unplaced.map(u => u.text).join(', ') : ''));
console.log('wrote labeller-old.svg / labeller-new.svg to ' + OUT);
