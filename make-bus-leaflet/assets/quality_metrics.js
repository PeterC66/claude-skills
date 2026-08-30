#!/usr/bin/env node
/*
 * quality_metrics.js — measure whether a generated sheet is any GOOD.
 *
 * gate.sh proves a generator is DETERMINISTIC (same input => same bytes). It
 * says nothing about whether the result is legible or well composed, so today
 * design quality is an opinion held one town at a time and can regress with
 * nothing complaining. This tool is the missing half: it reads a shipped SVG
 * and counts the defects that make a sheet look amateur — labels printed over
 * route lines, labels printed over each other, icons fused into blobs, map
 * content buried under the footer band, text too small to print, and whitespace
 * piled into one corner.
 *
 * Read-only. Touches no generator, changes no output, cannot break a gate.
 * Zero dependencies (Node core + font_metrics.js).
 *
 * Usage:
 *   node quality_metrics.js <file.svg> [more.svg ...]      # one or more sheets
 *   node quality_metrics.js --all [--buses "<Buses dir>"]  # every ci-reference sheet
 *   node quality_metrics.js --all --json                   # machine-readable
 *   node quality_metrics.js --all --detail                 # list every offender
 *
 * A sheet's routes.json (same folder, if present) supplies the exact route
 * palette, so "is this label sitting on a route line?" is an exact colour match
 * rather than a guess about what counts as a route.
 *
 * Phase 0 of Development Docs/label-and-design-quality-plan_2026-08-15.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FM = require(path.join(process.env.SKILL_ASSETS || __dirname, 'font_metrics.js'));

// ---------------------------------------------------------------- thresholds
// Deliberately in one object: G1 asks Peter whether these are the right numbers,
// and the answer should be a one-line edit here, not a hunt through the code.
const T = {
  cell: 0.5,              // mm — occupancy grid resolution
  inkCoverFrac: 0.04,     // label counts as "over ink" above this fraction of its box
  iconMinSep: 3.0,        // mm centre-to-centre before two icons read as one blob
  minTextMm: 2.4,         // print legibility floor
  overIntoPanelMm: 0.5,   // map text intruding into the panel column
  emptyNinthsWarn: 2,     // near-empty 9ths of the map frame before "unbalanced"
  densityCell: 10,        // mm — window for the crowding measure
  densityWarn: 0.55,      // ink fraction in the busiest window
  labelsOverInkFail: 3,   // point labels: > this = FAIL, 1..this = WARN
  roadOverInkWarn: 4,     // road names on route lines: partly by design, so warn only
  footerInkWarnMm2: 20,   // route ink drawn into the footer band
  haloPadMm: 0.35,        // half the 0.7mm white halo every label carries
  duplicateWithinMm: 30,  // same name printed twice this close = one confused reader
  // --- added 2026-08-16, from the §5.3 print check (see the block above `const m`) ---
  featureLabelMaxMm: 25,  // a feature label further than this from its own line names nothing
  colourClashDE: 25,      // CIE-Lab distance below which two route hues read as one
  colourNearMm: 6,        // ...and the gap at which two ribbons are compared side by side
  edgeSafeMm: 5,          // print safe margin: text closer than this to the trim edge = warn
  // ...and a fail below this. Two numbers because the 5mm breach is SYSTEMIC —
  // every sheet puts the footer credit 3mm from the right trim — so failing on
  // it would fail all 31 for one engine fix and make the verdict column useless.
  // What deserves a fail is a sheet TIGHTER than that systemic floor, which is a
  // placer or config problem on that sheet: today six sheets, worst 1.54mm.
  edgeFailMm: 2.5,
  // --- added 2026-08-28, OA-021 and OA-118: the two things a reader sees at a
  // glance and every measure above is blind to. ---
  badgeOverlapMm: 0.6,    // two badge discs closer than (r1+r2-this) are printing on each other
  // --- added 2026-08-28, OA-060. Deliberately the SAME tolerance as the badges:
  // an overprint is one thing, and a generator that separates marks to one rule
  // while the metric scores them by another is how the two come to disagree. ---
  lozengeOverlapMm: 0.6,  // two terminus lozenges overlapping by more than this on BOTH axes
  laneCrossDeg: 25,       // two route ribbons crossing SHALLOWER than this are swapping sides
  laneCrossSiteMm: 4,     // intersections closer than this are one visual crossing
  laneCrossWarn: 0,       // any shallow crossing is worth naming
};

// ------------------------------------------------------------------- parsing
const DEC = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&');            // last, so &amp;lt; does not become <

const attrs = (tag) => {
  const o = {};
  for (const m of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) o[m[1]] = m[2];
  return o;
};

// Only translate/scale/rotate appear in engine output. Compose as [a,b,c,d,e,f].
const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(s) {
  let m = IDENT;
  for (const t of String(s).matchAll(/(translate|scale|rotate|matrix)\(([^)]*)\)/g)) {
    const v = t[2].trim().split(/[\s,]+/).map(Number);
    if (t[1] === 'translate') m = mul(m, [1, 0, 0, 1, v[0] || 0, v[1] || 0]);
    else if (t[1] === 'scale') m = mul(m, [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0]);
    else if (t[1] === 'rotate') {
      const a = (v[0] || 0) * Math.PI / 180, c = Math.cos(a), s2 = Math.sin(a);
      const cx = v[1] || 0, cy = v[2] || 0;
      m = mul(m, [1, 0, 0, 1, cx, cy]);
      m = mul(m, [c, s2, -s2, c, 0, 0]);
      m = mul(m, [1, 0, 0, 1, -cx, -cy]);
    } else if (t[1] === 'matrix') m = mul(m, v);
  }
  return m;
}

// Walk the tags in document order, maintaining a transform + inherited-style stack.
function parseSvg(svg) {
  const texts = [], icons = [], strokes = [], rects = [], circles = [];
  let vb = [0, 0, 297, 210], mapFrame = null, footerTop = null, seenPlate = false;
  // Document order, kept on every element. `afterPlate` below is the same idea
  // applied to one specific box; the legend is a second, and it can sit anywhere
  // on the sheet, so it needs the general form: what was drawn BEFORE the legend
  // is what the legend is about to bury.
  let seq = 0;

  const mVb = svg.match(/viewBox="([^"]*)"/);
  if (mVb) vb = mVb[1].trim().split(/[\s,]+/).map(Number);

  const mClip = svg.match(/<clipPath[^>]*>\s*<rect([^>]*)\/>/);
  if (mClip) {
    const a = attrs(mClip[1]);
    mapFrame = { x0: +a.x, y0: +a.y, x1: +a.x + +a.width, y1: +a.y + +a.height };
  }

  const stack = [{ m: IDENT, style: {} }];
  const re = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>([^<]*)/g;
  let mm;
  while ((mm = re.exec(svg))) {
    const [, close, tag, raw, selfClose, tail] = mm;
    const top = stack[stack.length - 1];

    if (close) { if (tag === 'g' && stack.length > 1) stack.pop(); continue; }

    const a = attrs(raw);
    const m = a.transform ? mul(top.m, parseTransform(a.transform)) : top.m;
    const style = Object.assign({}, top.style);
    for (const k of ['stroke', 'stroke-width', 'fill', 'fill-opacity', 'font-size', 'font-weight', 'font-family']) {
      if (a[k] !== undefined) style[k] = a[k];
    }

    if (tag === 'g') {
      // An icon is emitted as exactly `<g transform="translate(x y) scale(s)">`
      // (icons.js). Badges translate but never scale, which is what separates them.
      if (!selfClose) stack.push({ m, style, clipped: top.clipped || /clip-path=/.test(raw) });
      if (/translate\([^)]*\)\s*scale\(/.test(a.transform || '')) {
        const [cx, cy] = apply(m, 0, 0);
        const sc = Math.abs(m[0]) || 1;
        icons.push({ cx, cy, r: 2.1 * sc, seq: seq++ });     // icons.js draws within a 4.2mm box
      }
      continue;
    }

    const sw = parseFloat(style['stroke-width'] ?? a['stroke-width'] ?? 0) || 0;
    const stroke = (style.stroke ?? a.stroke ?? 'none').toLowerCase();
    const scaleOf = Math.hypot(m[0], m[1]) || 1;

    if (tag === 'text') {
      const size = parseFloat(style['font-size'] ?? 0) || 0;
      const [x, y] = apply(m, parseFloat(a.x) || 0, parseFloat(a.y) || 0);
      texts.push({
        seq: seq++,
        text: DEC(tail), x, y, size: size * scaleOf,
        anchor: a['text-anchor'] || 'start',
        bold: (style['font-weight'] || '') === 'bold',
        central: a['dominant-baseline'] === 'central',
        // A ROTATED LABEL CAN CARRY ITS ROTATION ON EITHER ELEMENT. gen_internal.js
        // rotates the <text>; gen_boarding.js wraps it in <g transform="translate()
        // rotate()"> and leaves the text at 0,0. Reading only the text's own
        // attribute made every boarding-sheet street name a HORIZONTAL box as wide
        // as the words are long, so the separating-axis test below -- written to be
        // "exact for the rotated road names" -- was fed a box for a label that is
        // not there. High Wycombe's near-vertical "Oxford Road" was reported as
        // colliding with "Arch Way" and with "Cineworld", neither of which it comes
        // near on the page. The composed matrix already holds the angle.
        rot: a.transform && /rotate/.test(a.transform)
          ? (parseFloat(a.transform.match(/rotate\(([-\d.]+)/)[1]) || 0)
          : (Math.hypot(m[0], m[1]) > 1e-9 ? Math.atan2(m[1], m[0]) * 180 / Math.PI : 0),
        fill: (style.fill || '#000').toLowerCase(),
        halo: !!a.stroke,
        // Document order tells map content from footer chrome exactly. footer.js
        // paints the plate and THEN its own lines, so anything emitted after the
        // plate belongs to the footer and anything before it is map content the
        // plate is about to bury. Matching the notes by their opening words
        // instead does not work: the external sheets' second line begins
        // "Confirm live times…", so a text-prefix rule reported every external
        // footer as a buried label.
        afterPlate: seenPlate,
      });
      continue;
    }

    if (tag === 'path' && a.d) {
      for (const seg of pathSegments(a.d, m)) strokes.push({ seg, w: sw * scaleOf, stroke, clipped: top.clipped, seq });
      seq++;
      continue;
    }
    if (tag === 'line') {
      const p0 = apply(m, +a.x1 || 0, +a.y1 || 0), p1 = apply(m, +a.x2 || 0, +a.y2 || 0);
      strokes.push({ seg: [p0, p1], w: sw * scaleOf, stroke, clipped: top.clipped, seq: seq++ });
      continue;
    }
    if (tag === 'rect') {
      const x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, h = +a.height || 0;
      const [x0, y0] = apply(m, x, y), [x1, y1] = apply(m, x + w, y + h);
      const r = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1),
                  fill: (style.fill || a.fill || 'none').toLowerCase(), op: parseFloat(a['fill-opacity'] ?? 1),
                  rx: +a.rx || 0, stroked: (a.stroke || 'none').toLowerCase(), seq: seq++ };
      rects.push(r);
      // The footer plate: a full-width near-white band in the bottom third,
      // painted last over everything (footer.js footerBand()).
      if (r.x0 <= 0.5 && r.x1 >= vb[2] - 0.5 && r.y0 > vb[3] * 0.6 && /fff|white/.test(r.fill)) {
        footerTop = footerTop === null ? r.y0 : Math.min(footerTop, r.y0);
        seenPlate = true;
      }
      continue;
    }
    if (tag === 'circle') {
      const [cx, cy] = apply(m, +a.cx || 0, +a.cy || 0);
      circles.push({ cx, cy, r: (+a.r || 0) * scaleOf, fill: (style.fill || a.fill || 'none').toLowerCase(), seq: seq++ });
    }
  }
  return { vb, mapFrame, footerTop, texts, icons, strokes, rects, circles };
}

// Flatten a path's `d` into straight segments. The engine emits M/L almost
// exclusively; H/V/Z and the handful of icon curves are handled by taking
// their endpoints, which is ample for an occupancy grid at 0.5mm.
function pathSegments(d, m) {
  const out = [];
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cur = [], cmd = null;
  const num = () => parseFloat(toks[i++]);
  const push = (nx, ny) => { cur.push(apply(m, nx, ny)); cx = nx; cy = ny; };
  const flush = () => { if (cur.length > 1) for (let k = 1; k < cur.length; k++) out.push([cur[k - 1], cur[k]]); cur = []; };
  while (i < toks.length) {
    const t = toks[i];
    if (/[A-Za-z]/.test(t)) { cmd = t; i++; } else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': flush(); { const x = num(), y = num(); cx = rel ? cx + x : x; cy = rel ? cy + y : y; sx = cx; sy = cy; cur = [apply(m, cx, cy)]; } break;
      case 'L': { const x = num(), y = num(); push(rel ? cx + x : x, rel ? cy + y : y); } break;
      case 'H': { const x = num(); push(rel ? cx + x : x, cy); } break;
      case 'V': { const y = num(); push(cx, rel ? cy + y : y); } break;
      case 'C': { num(); num(); num(); num(); const x = num(), y = num(); push(rel ? cx + x : x, rel ? cy + y : y); } break;
      case 'S': case 'Q': { num(); num(); const x = num(), y = num(); push(rel ? cx + x : x, rel ? cy + y : y); } break;
      case 'T': { const x = num(), y = num(); push(rel ? cx + x : x, rel ? cy + y : y); } break;
      case 'A': { num(); num(); num(); num(); num(); const x = num(), y = num(); push(rel ? cx + x : x, rel ? cy + y : y); } break;
      case 'Z': push(sx, sy); flush(); break;
      default: i++;
    }
  }
  flush();
  return out;
}

// -------------------------------------------------------------- label boxes
// The old engine guessed width as length*size*0.52; this uses real advances,
// so a box here is what the renderer actually paints.
function textQuad(t) {
  const w = FM.textWidth(t.text, t.size, t.bold);
  const up = t.size * (t.central ? 0.5 : FM.CAP_HEIGHT);
  const dn = t.size * (t.central ? 0.5 : FM.DESCENDER);
  const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
  const corners = [[x0, t.y - up], [x0 + w, t.y - up], [x0 + w, t.y + dn], [x0, t.y + dn]];
  if (!t.rot) return corners;
  const a = t.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return corners.map(([px, py]) => {
    const dx = px - t.x, dy = py - t.y;
    return [t.x + dx * c - dy * s, t.y + dx * s + dy * c];
  });
}
function growQuad(q, pad) {
  const cx = q.reduce((s2, p) => s2 + p[0], 0) / q.length, cy = q.reduce((s2, p) => s2 + p[1], 0) / q.length;
  return q.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + (x - cx) / d * pad, y + (y - cy) / d * pad]; });
}
const quadBox = (q) => ({
  x0: Math.min(...q.map(p => p[0])), y0: Math.min(...q.map(p => p[1])),
  x1: Math.max(...q.map(p => p[0])), y1: Math.max(...q.map(p => p[1])),
});
// Separating-axis test — exact for the rotated road names, unlike an AABB.
function quadsOverlap(A, B) {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = -(q[1] - p[1]), ay = q[0] - p[0];
      let mnA = Infinity, mxA = -Infinity, mnB = Infinity, mxB = -Infinity;
      for (const v of A) { const d = v[0] * ax + v[1] * ay; if (d < mnA) mnA = d; if (d > mxA) mxA = d; }
      for (const v of B) { const d = v[0] * ax + v[1] * ay; if (d < mnB) mnB = d; if (d > mxB) mxB = d; }
      if (mxA < mnB || mxB < mnA) return false;
    }
  }
  return true;
}

// ------------------------------------------------------------ occupancy grid
function makeGrid(vb) {
  const nx = Math.ceil(vb[2] / T.cell), ny = Math.ceil(vb[3] / T.cell);
  return { nx, ny, x0: vb[0], y0: vb[1], a: new Uint8Array(nx * ny) };
}
// Liang–Barsky: the part of a segment that survives the map frame, or null if none
// of it does. The stroke is a WIDE line, so grow the rect by half the stroke width
// before clipping — a line running along the frame edge really does paint a little
// way outside it.
function clipSegToRect([p0, p1], F, pad = 0) {
  const x0 = F.x0 - pad, y0 = F.y0 - pad, x1 = F.x1 + pad, y1 = F.y1 + pad;
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, p0[0] - x0], [dx, x1 - p0[0]], [-dy, p0[1] - y0], [dy, y1 - p0[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[p0[0] + t0 * dx, p0[1] + t0 * dy], [p0[0] + t1 * dx, p0[1] + t1 * dy]];
}
function stampSeg(g, [p0, p1], w) {
  const half = Math.max(w, T.cell) / 2;
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const steps = Math.max(1, Math.ceil(len / (T.cell * 0.5)));
  const rad = Math.ceil(half / T.cell);
  for (let s = 0; s <= steps; s++) {
    const x = p0[0] + (p1[0] - p0[0]) * s / steps, y = p0[1] + (p1[1] - p0[1]) * s / steps;
    const gx = Math.round((x - g.x0) / T.cell), gy = Math.round((y - g.y0) / T.cell);
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.hypot(dx, dy) * T.cell > half) continue;
      const ix = gx + dx, iy = gy + dy;
      if (ix < 0 || iy < 0 || ix >= g.nx || iy >= g.ny) continue;
      g.a[iy * g.nx + ix] = 1;
    }
  }
}
function quadCoverage(g, q) {
  const b = quadBox(q);
  let tot = 0, hit = 0;
  for (let y = Math.floor((b.y0 - g.y0) / T.cell); y <= Math.ceil((b.y1 - g.y0) / T.cell); y++) {
    for (let x = Math.floor((b.x0 - g.x0) / T.cell); x <= Math.ceil((b.x1 - g.x0) / T.cell); x++) {
      if (x < 0 || y < 0 || x >= g.nx || y >= g.ny) continue;
      const px = g.x0 + x * T.cell, py = g.y0 + y * T.cell;
      if (!pointInQuad(px, py, q)) continue;
      tot++; if (g.a[y * g.nx + x]) hit++;
    }
  }
  return tot ? hit / tot : 0;
}
function pointInQuad(px, py, q) {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i], r = q[(i + 1) % q.length];
    const c = (r[0] - p[0]) * (py - p[1]) - (r[1] - p[1]) * (px - p[0]);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}

// ------------------------------------------------------------------- colour
// Used only to decide which ink a label must not be printed on. Route ribbons
// are matched exactly against the palette; these two rules cover the rest:
// the railway (heavy and near-black) counts, the river and the faint context
// road network (both pale) do not — the engine prints over those on purpose.
const NAMED = { black: '#000000', white: '#ffffff', none: null, red: '#ff0000', grey: '#808080', gray: '#808080' };
function lum(col) {
  let c = String(col || '').trim().toLowerCase();
  if (c in NAMED) c = NAMED[c];
  if (!c || c[0] !== '#') return 1;                       // unknown => treat as pale
  if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  if (c.length !== 7) return 1;
  const r = parseInt(c.slice(1, 3), 16) / 255, g = parseInt(c.slice(3, 5), 16) / 255, b = parseInt(c.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const isDark = (c) => lum(c) < 0.55;
const isPale = (c) => lum(c) > 0.8;

// CIE-Lab, for "do these two routes read as the same colour?". Luminance alone
// is no use for that question — #CC3311 and #009988 have near-identical
// luminance and could not look less alike. This is the same conversion
// gen_internal.js uses for its route-vs-river warning (§5.2); the difference is
// that this asks it of every PAIR of routes, which nothing has ever done.
function toLab(hex) {
  let c = String(hex || '').trim().toLowerCase();
  if (c in NAMED) c = NAMED[c];
  if (!c || c[0] !== '#') return null;
  if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  if (c.length !== 7) return null;
  const f = (i) => { const v = parseInt(c.substr(i, 2), 16) / 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
  const r = f(1), g = f(3), b = f(5);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
}
function deltaE(a, b) {
  const A = toLab(a), B = toLab(b);
  if (!A || !B) return Infinity;
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

// ----------------------------------------------------------------- analysing
/* Perpendicular distance from a point to a line SEGMENT (not the infinite line):
 * a spoke is a finite run, and a label beyond its end belongs to whatever is
 * actually nearest rather than to the line it happens to be collinear with. */
function segDistance(p, [a, b]) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

function analyse(svgPath) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const P = parseSvg(svg);
  const vb = P.vb, W = vb[2], H = vb[3];

  // Route palette: exact hexes from the sheet's own routes.json where present,
  // so "over a route line" is a colour match, not a guess about what a route is.
  let palette = null, RJ = null;
  const rj = path.join(path.dirname(svgPath), 'routes.json');
  if (fs.existsSync(rj)) {
    try {
      RJ = JSON.parse(fs.readFileSync(rj, 'utf8'));
      palette = new Set(Object.values(RJ.palette || {}).map(c => String(c).toLowerCase()));
    }
    catch { /* unreadable routes.json => fall back to the width/darkness rule below */ }
  }
  const isRouteInk = (s) => {
    if (palette && palette.size) return palette.has(s.stroke) || (s.w >= 1.2 && isDark(s.stroke));
    return s.w >= 2.0 && s.stroke !== 'none' && !isPale(s.stroke);
  };

  // Internal sheets carry a clipPath = the map frame, with the services panel
  // to its right. External (radial/busway) sheets have neither: the whole page
  // is the drawing and the operators box floats inside it. Measuring an
  // external sheet against an imagined panel column produced nonsense (the
  // title counted as a label "59mm into the panel"), so the panel test is
  // simply not applicable there and reports null rather than a wrong number.
  const hasPanel = !!P.mapFrame;
  const panelX0 = hasPanel ? P.mapFrame.x1 : W;
  const footerTop = P.footerTop != null ? P.footerTop : H;
  // Legend/operators box on an external sheet: a large pale rounded rect.
  // ...but NOT the page background, which is also a big pale rect. Require it
  // to be a boxed panel: under a third of the page, and drawn with a border.
  //
  // It used to require r.y0 < H * 0.5 as well, which quietly meant the tool could
  // not see Beaconsfield's legend at all — that town parks it at y=145, so every
  // legend-aware measure reported null for the one sheet whose legend sits in the
  // busiest half of the page. gen_external_radial.js emits the box with an exact
  // signature (fill-opacity 0.94, a #ccc hairline), so match that first and keep
  // the loose rule only as a fallback for sheets drawn by older engines.
  const legendSig = hasPanel ? null : (P.rects.find(r =>
    Math.abs(r.op - 0.94) < 1e-6 && r.stroked === '#ccc') || null);
  const legend = legendSig || (hasPanel ? null : (P.rects.find(r =>
    r.x1 - r.x0 > 30 && r.y1 - r.y0 > 15 && r.y0 < H * 0.5 &&
    (r.x1 - r.x0) * (r.y1 - r.y0) < W * H / 3 && /fff|none|white/.test(r.fill)) || null));

  // Ink that a label must not sit on: route ribbons, plus the river/railway.
  // The faint grey context road network is deliberately NOT included — labels
  // over it are the design working as intended.
  // The map is drawn inside `<g clip-path="url(#map)">`, and a route polyline is
  // clipped, not trimmed — its `d` still carries the vertices that fall outside the
  // frame. Stamping the raw geometry therefore credits the sheet with ink that is
  // never painted. It mattered from the moment the frame stopped being the full
  // 30–205 band (design.footerSafe, 2026-08-15): the "route ink under the footer"
  // measure barely moved on a sheet whose map genuinely no longer reached the band,
  // because the clipped-away tails were still being counted. Clip to the frame first.
  const grid = makeGrid(vb);
  for (const s of P.strokes) {
    if (!isRouteInk(s)) continue;
    const seg = (s.clipped && P.mapFrame) ? clipSegToRect(s.seg, P.mapFrame, s.w / 2) : s.seg;
    if (seg) stampSeg(grid, seg, s.w);
  }

  // Classify text. Badge glyphs (dominant-baseline="central") sit inside their
  // own roundel by construction and are not map labels; panel, title and
  // footer text live outside the map frame.
  const mapLabels = [], allText = [];
  for (const t of P.texts) {
    if (!t.text.trim()) continue;
    allText.push(t);
    if (t.central) continue;                                  // badge glyph, inside its own roundel
    if (t.size >= 4.5) continue;                              // title / hub / section heading
    if (t.x >= panelX0 - 1) continue;
    if (t.y >= footerTop) continue;
    // An external sheet's operators legend is a floating box, not a reserved column,
    // so its own contents were being read as map labels sitting "into the panel" —
    // five on St Ives, every one of them the legend's own text inside its own box.
    // A fabricated defect is worse than none, so exclude it, exactly as the internal
    // sheets exclude everything right of the panel edge. (Found 2026-08-15 while
    // checking why Phase 4 had not moved that number.)
    if (legend && t.x >= legend.x0 - 1 && t.x <= legend.x1 + 1 && t.y >= legend.y0 - 1 && t.y <= legend.y1 + 1) continue;
    if (P.mapFrame && t.y < P.mapFrame.y0) continue;          // title block
    // Road names (grey, usually rotated, drawn ALONG the road they name) are a
    // different design problem from point labels: sitting on the line is what
    // they are for. Count them, but never mix them into the headline figure.
    const kind = /#6{3}|#666666/.test(t.fill) ? 'road' : 'point';
    mapLabels.push(Object.assign({}, t, { quad: textQuad(t), kind }));
  }

  const detail = { overInk: [], labelPairs: [], duplicates: [], iconPairs: [], labelIcon: [], inFooter: [], intoPanel: [], tiny: [],
                   underLegend: [], routeUnderLegend: [], unplaced: [], nearEdge: [],
                   labelOverBadge: [], badgeOverBadge: [], laneCross: [], lozengeOverlap: [] };

  /*
   * WHAT THE LEGEND IS BURYING.
   *
   * Every other measure in this file is about the map: ink, labels, collisions,
   * the frame. The operators legend is furniture — pinned in page coordinates,
   * drawn after the artwork, opaque — and until 2026-08-16 nothing here looked at
   * what went underneath it. That gap was not theoretical: previewing
   * design.spokeSpread across the seven towns hid 62 pieces of artwork behind
   * legends, including whole spokes and their destination lozenges, while this
   * tool reported the defect totals going DOWN on five of the six. A defect the
   * measure cannot express is a defect that ships.
   *
   * Two counts, because the two cases are not equally bad and the placer in
   * gen_external_radial.js draws the same line. A SYMBOL — a terminus lozenge,
   * the hub, a stop tick, a badge, a name — is a place: bury it and the reader
   * loses a destination with nothing to say it was ever there, so it counts as a
   * defect. A ROUTE LINE is a stroke, still legible either side of the box, so it
   * is reported and warned on but not scored. Document order is what makes this
   * exact rather than a guess: anything drawn before the legend rect is content
   * the legend is about to cover.
   */
  if (legend) {
    const LB = [legend.x0, legend.y0, legend.x1, legend.y1];
    const hits = (b) => !(b[2] < LB[0] || b[0] > LB[2] || b[3] < LB[1] || b[1] > LB[3]);
    for (const r of P.rects) {
      if (r.seq >= legend.seq || r === legend) continue;
      if (r.x1 - r.x0 > W * 0.5) continue;                       // the page background
      if (/none/.test(r.fill)) continue;
      if (hits([r.x0, r.y0, r.x1, r.y1]))
        detail.underLegend.push({ kind: 'box', at: [+r.x0.toFixed(1), +r.y0.toFixed(1)], fill: r.fill });
    }
    for (const c of P.circles) {
      if (c.seq >= legend.seq) continue;
      if (hits([c.cx - c.r, c.cy - c.r, c.cx + c.r, c.cy + c.r]))
        detail.underLegend.push({ kind: c.r >= 3 ? 'node' : 'tick', at: [+c.cx.toFixed(1), +c.cy.toFixed(1)] });
    }
    for (const t of P.texts) {
      if (t.seq >= legend.seq) continue;
      const q = textQuad(t);
      const bx = [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])),
                  Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))];
      if (hits(bx)) detail.underLegend.push({ kind: 'label', text: t.text, at: [+t.x.toFixed(1), +t.y.toFixed(1)] });
    }
    const seen = new Set();
    for (const s of P.strokes) {
      if (s.seq >= legend.seq || !isRouteInk(s)) continue;
      if (seen.has(s.seq)) continue;
      const [p, q] = s.seg;
      const n = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.4));
      for (let i = 0; i <= n; i++) {
        const x = p[0] + (q[0] - p[0]) * i / n, y = p[1] + (q[1] - p[1]) * i / n;
        if (x >= LB[0] && x <= LB[2] && y >= LB[1] && y <= LB[3]) {
          seen.add(s.seq);
          detail.routeUnderLegend.push({ stroke: s.stroke, at: [+x.toFixed(1), +y.toFixed(1)] });
          break;
        }
      }
    }
  }

  for (const L of mapLabels) {
    const cov = quadCoverage(grid, L.quad);
    if (cov > T.inkCoverFrac) detail.overInk.push({ text: L.text, kind: L.kind, cover: +(cov * 100).toFixed(0), at: [+L.x.toFixed(1), +L.y.toFixed(1)] });
  }
  // Test the HALOED extent, not the glyph extent: every label carries a 0.7mm
  // white outline, so two labels 0.5mm apart have their haloes eating each
  // other's letterforms even though the glyph boxes technically clear.
  const grown = mapLabels.map(L => growQuad(L.quad, T.haloPadMm));
  for (let i = 0; i < mapLabels.length; i++) for (let j = i + 1; j < mapLabels.length; j++) {
    if (quadsOverlap(grown[i], grown[j]))
      detail.labelPairs.push([mapLabels[i].text, mapLabels[j].text]);
  }

  // The same place name printed more than once close by. On the radial sheets
  // two spokes serving one village each label it independently (Huntingdon
  // prints "Fenstanton" twice, 0.6mm apart, which reads as garbled text), and
  // three separate "Cambridge" terminus lozenges say the same thing. Terminus
  // node text is centred inside its own box, so include those too.
  // Place names only. A route badge ("102", "X74", "5A") is SUPPOSED to repeat
  // along its line — that is the whole point of a badge — so require a lowercase
  // letter and some length, which every place name has and no route code does.
  const nameable = P.texts.filter(t => {
    const s = t.text.trim();
    return s.length >= 4 && /[a-z]/.test(s) && t.size >= 2 && t.size < 4.5
      && t.x < panelX0 - 1 && t.y < footerTop && !/^to /.test(s);
  });
  for (let i = 0; i < nameable.length; i++) for (let j = i + 1; j < nameable.length; j++) {
    if (nameable[i].text.trim() !== nameable[j].text.trim()) continue;
    const d = Math.hypot(nameable[i].x - nameable[j].x, nameable[i].y - nameable[j].y);
    if (d < T.duplicateWithinMm) detail.duplicates.push({ text: nameable[i].text.trim(), gap: +d.toFixed(1),
      at: [[nameable[i].x, nameable[i].y], [nameable[j].x, nameable[j].y]], size: nameable[i].size });
  }
  // A POI label is placed 2.6mm from its OWN icon's centre and the icon is
  // 4.2mm across, so every label touches its own symbol by construction —
  // counting that would report ~290 collisions that are simply the design.
  // Exclude the nearest icon to the label's anchor; anything else it covers is
  // a genuine defect (St Ives' "Waitrose" eaten by the library icon).
  for (const L of mapLabels) {
    const b = quadBox(L.quad);
    let own = null, bestD = Infinity;
    for (const ic of P.icons) {
      const d = Math.hypot(ic.cx - L.x, ic.cy - L.y);
      if (d < bestD) { bestD = d; own = ic; }
    }
    if (bestD > 8) own = null;                    // not this label's symbol at all
    for (const ic of P.icons) {
      if (ic === own) continue;
      if (ic.cx + ic.r > b.x0 && ic.cx - ic.r < b.x1 && ic.cy + ic.r > b.y0 && ic.cy - ic.r < b.y1)
        detail.labelIcon.push({ text: L.text, at: [+ic.cx.toFixed(1), +ic.cy.toFixed(1)] });
    }
  }
  for (let i = 0; i < P.icons.length; i++) for (let j = i + 1; j < P.icons.length; j++) {
    const d = Math.hypot(P.icons[i].cx - P.icons[j].cx, P.icons[i].cy - P.icons[j].cy);
    if (d < T.iconMinSep) detail.iconPairs.push({ gap: +d.toFixed(2), at: [+P.icons[i].cx.toFixed(1), +P.icons[i].cy.toFixed(1)] });
  }

  // Map content buried under the footer plate, which is painted last and opaque.
  //
  // MEASUREMENT BUG, found 2026-08-15 while checking the railway-weight rollout
  // (plan Phase 6): this used to require `b.y0 < footerTop + 6 && t.y < footerTop
  // + 2.5` as well, i.e. it only counted text STRADDLING the top edge of the
  // plate. Text sited wholly inside the band scored zero — so six river/canal
  // labels at y=200, the "Only main stops…" diagram note at y=196/198 and a
  // stray badge digit at y=197.67 were all completely invisible on the sheet and
  // completely invisible to the metric, while the scorecard read "content buried
  // under the footer: 0". Any box that reaches the plate at all is buried; the
  // plate is painted last, at 97% opacity, across the full page width. The
  // footer's own lines are the only text that belongs there, and they are told
  // apart by document order (t.afterPlate), not by their wording.
  for (const t of allText) {
    if (t.central || t.x >= panelX0 - 1 || t.afterPlate) continue;
    const b = quadBox(textQuad(t));
    if (b.y1 > footerTop)
      detail.inFooter.push({ text: t.text, y: +t.y.toFixed(1), footerTop: +footerTop.toFixed(1) });
  }
  // Route ink drawn into the band. Counting raw segments inflated this into the
  // hundreds (one route is thousands of segments), so measure the AREA of route
  // ink below the band instead — mm², which is comparable across sheets and
  // says how much drawing is actually being erased.
  let inkCellsInFooter = 0;
  for (let y = Math.floor((footerTop - grid.y0) / T.cell); y < grid.ny; y++) {
    for (let x = 0; x < grid.nx; x++) {
      if (grid.x0 + x * T.cell >= panelX0) continue;
      if (grid.a[y * grid.nx + x]) inkCellsInFooter++;
    }
  }
  const inkAreaInFooter = +(inkCellsInFooter * T.cell * T.cell).toFixed(1);

  if (hasPanel) for (const L of mapLabels) {
    const b = quadBox(L.quad);
    if (b.x1 > panelX0 + T.overIntoPanelMm) detail.intoPanel.push({ text: L.text, over: +(b.x1 - panelX0).toFixed(1) });
  }
  if (legend) for (const L of mapLabels) {
    const b = quadBox(L.quad);
    if (b.x1 > legend.x0 && b.x0 < legend.x1 && b.y1 > legend.y0 && b.y0 < legend.y1)
      detail.intoPanel.push({ text: L.text, over: 0 });
  }
  for (const t of allText) if (t.size > 0 && t.size < T.minTextMm) detail.tiny.push({ text: t.text.slice(0, 30), size: t.size });

  // Whitespace balance. A margin-based measure is wrong here: routes are MEANT
  // to run to the frame edge and be trimmed there, so the smallest margin is
  // almost always 0 and the ratio explodes to meaningless numbers (412, 366).
  // What actually reads as unbalanced is a quadrant of the sheet with nothing
  // in it while another is jammed — so measure ink share over a 3x3 grid of
  // the map frame and count the near-empty cells.
  //
  // TWO CORRECTIONS, 2026-08-15, made while acting on this measure for the first
  // time (plan §4.2) — until then nothing had been done on its say-so, so nobody
  // had checked it against a sheet that LOOKS fine.
  //
  // 1. An internal sheet's frame starts below the title at y=30; an external
  //    sheet had no frame, so F started at y=0 and the whole title band counted
  //    as empty map. Both sheet types reserve the same top strip, so use it.
  // 2. The operators/services box on an external sheet is composition, not
  //    emptiness, and it is not route ink — so a well-composed sheet reported
  //    its legend column as bare. March external looks balanced and scored 3.
  //    Count the legend's own footprint as occupied.
  const TITLE_BAND = 30;
  const F = P.mapFrame || { x0: 0, y0: TITLE_BAND, x1: panelX0, y1: footerTop };
  const cellW = (F.x1 - F.x0) / 3, cellH = (Math.min(F.y1, footerTop) - F.y0) / 3;
  const share = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let n = 0, tot = 0;
    const cx0 = F.x0 + c * cellW, cx1 = F.x0 + (c + 1) * cellW;
    const cy0 = F.y0 + r * cellH, cy1 = F.y0 + (r + 1) * cellH;
    const gx0 = Math.floor((cx0 - grid.x0) / T.cell), gx1 = Math.floor((cx1 - grid.x0) / T.cell);
    const gy0 = Math.floor((cy0 - grid.y0) / T.cell), gy1 = Math.floor((cy1 - grid.y0) / T.cell);
    for (let y = gy0; y < gy1 && y < grid.ny; y++) for (let x = gx0; x < gx1 && x < grid.nx; x++) { tot++; if (grid.a[y * grid.nx + x]) n++; }
    let s = tot ? n / tot : 0;
    if (legend) {                                    // the box occupies this cell too
      const ow = Math.max(0, Math.min(cx1, legend.x1) - Math.max(cx0, legend.x0));
      const oh = Math.max(0, Math.min(cy1, legend.y1) - Math.max(cy0, legend.y0));
      s = Math.min(1, s + (ow * oh) / (cellW * cellH));
    }
    share.push(s);
  }
  const meanShare = share.reduce((a, b) => a + b, 0) / 9;
  const emptyCells = share.filter(s => s < meanShare * 0.15).length;   // 9ths with essentially nothing in them
  const balance = meanShare > 0 ? +(Math.max(...share) / Math.max(meanShare * 0.15, Math.min(...share))).toFixed(1) : null;

  // Crowding: busiest densityCell window of route ink inside the map frame.
  let peak = 0;
  const step = Math.round(T.densityCell / T.cell);
  for (let y = 0; y + step <= grid.ny; y += Math.max(1, step / 2)) {
    for (let x = 0; x + step <= grid.nx; x += Math.max(1, step / 2)) {
      if (grid.x0 + x * T.cell > panelX0) continue;
      let n = 0;
      for (let j = 0; j < step; j++) for (let i2 = 0; i2 < step; i2++) n += grid.a[(y + j) * grid.nx + (x + i2)];
      peak = Math.max(peak, n / (step * step));
    }
  }

  /* ==================================================================
   * SEVEN MEASURES ADDED 2026-08-16, all from ONE print of two sheets.
   *
   * Peter printed High Wycombe internal and St Ives internal at 300 dpi for
   * the §5.3 palette check. Every defect he came back with was invisible to
   * everything above: a service badged in the panel and never drawn, a
   * railway label 78 mm from its railway, two route hues that read as one,
   * a footer line 4 mm from the trim. Each is trivially computable and each
   * had been reading zero — or reading nothing at all — since Phase 0.
   *
   * That is the standing lesson arriving from the other direction. The board
   * has been driven 628 -> 225 against measures chosen in Phase 0 from an
   * on-screen reading of the sheets, and the measures have been sharpened
   * five times since by doubting them. None of that found these, because
   * every one of them is a question nobody had thought to ask. A sheet that
   * scores well on every question you asked is not a sheet without defects.
   * ================================================================== */

  // --- 1. LABELS THE PLACER GAVE UP ON -------------------------------
  // Phase 0 recorded silent drops as "not measurable from the SVG" and it was
  // right: placeLabel() returns false and emits nothing. But §1.9 shipped in
  // Phase 2 and labeller.js now WRITES what it dropped, next to the sheet —
  // and this file went on carrying Phase 0's note for four more sessions.
  //
  // This matters more than its size. Every other measure here counts labels
  // that ARE on the page, so a placer that drops a label to avoid a collision
  // scores better for dropping it. Until this line existed the headline number
  // could be improved by printing less, which is precisely the failure mode
  // the legend occlusion taught in session 8 — a measure that cannot express a
  // defect will certify it. Phase 8 wires this tool into the gate; wiring it in
  // without this count would gate the board on a number you can game.
  //
  // EVERY generator that can drop a label writes what it dropped BESIDE THE SHEET,
  // and deletes the file when it dropped nothing. One table, one rule, no
  // per-sheet-type special cases — because the special cases were the bug.
  //
  // Until 2026-08-27 this table had two entries and one of them read the shared
  // idiom wrong. gen_internal.js, gen_external_radial.js and gen_external_places.js
  // ALL end with `if (un.length) writeFileSync(...) else unlinkSync(...)`, so an
  // absent file means ZERO — but the branch below turned an absent file into 0 for
  // `internal` and into null (UNKNOWN) for `external`. Fourteen external sheets
  // had counted themselves clean and were recorded as uncountable, and the board
  // headline of "108 dropped labels, 31 of 52 sheets could not count it" was
  // reporting a bug in this function as a gap in the generators.
  //
  // The schematic, the diagram and the boarding sheet were the real gap, and a
  // different one each. schematize_internal.js and diagram_internal.js run
  // gen_internal.js inside a workspace SUBFOLDER and used to copy only internal.svg
  // back out, stranding the workspace's unplaced.json where sync_ci_reference.js
  // (which skips directories) could never reach it — 165 dropped labels sitting on
  // disk, uncounted, on 13 sheets. gen_boarding.js does not use labeller.js at all
  // but has its own occupancy placer that silently draws an unnamed pictogram when
  // a landmark name cannot find clear air, and wrote no file of any kind. All three
  // now emit their own sidecar; see those files for the writing half.
  //
  // ABSENT IS NOT UNKNOWN. `null` here means "no generator on this sheet type
  // reports drops", and nothing on the board is in that state any more. A sheet
  // whose sidecar is missing scored zero and is reported as zero.
  const base = path.basename(svgPath, '.svg');
  const DROP_FILE = {
    'internal': 'unplaced.json',
    'external': 'unplaced-external.json',
    'internal-schematic': 'unplaced-schematic.json',
    'internal-diagram': 'unplaced-diagram.json',
    'boarding': 'unplaced-boarding.json',
  };
  const dropFile = DROP_FILE[base] || null;
  let unplaced = null;
  // Three states, not two. `no-reporter` is a sheet type nothing writes a sidecar
  // for; `unreadable` is a sidecar that WAS there and would not parse. Both leave
  // unplacedLabels null, and reporting them as one fact is how a parse failure
  // would hide inside a coverage gap and be read as "that sheet type again".
  let dropState = 'no-reporter';
  if (dropFile) {
    const dp = path.join(path.dirname(svgPath), dropFile);
    if (fs.existsSync(dp)) {
      try { unplaced = JSON.parse(fs.readFileSync(dp, 'utf8')); } catch { unplaced = null; }
    } else unplaced = [];      // every writer unlinks its sidecar when nothing dropped
    if (unplaced === null) dropState = 'unreadable';   // the file was there and would not parse
    else dropState = 'counted';
  }
  if (unplaced) for (const u of unplaced) detail.unplaced.push({ text: u.text, reason: u.reason, at: u.at });

  // --- 2. THE EXIT TAILS ----------------------------------------------
  // An off-map continuation is drawn as a badge 5 mm back from the frame cut
  // (gen_internal.js: `bx = px - dx*5`), a "to X" beside it, and an arrowhead
  // 2.6 mm PAST the cut — so the route line carries on underneath all of it.
  // The "to X" therefore sits on route ink BY CONSTRUCTION, and pt/ink has been
  // charging the engine a full defect for obeying its own design. This is the
  // same argument that already makes road names warn-only: a road name follows
  // its road by definition, and an exit label sits on its own continuation by
  // definition. Reported as a subset, so pt/ink itself is unchanged and the
  // board stays comparable; `pointLabelsOverInkNet` is the honest figure.
  //
  // Peter, 2026-08-16: "that maybe OK, but if so the engine and metric should
  // recognise it." This is the metric half. The engine half — stopping the
  // ribbon under the badge row, since the arrowhead and the "to X" already
  // state the continuation twice — is a separate, gated change.
  const exitTail = detail.overInk.filter(d => d.kind === 'point' && /^to\s/.test(d.text));

  // --- 3. FEATURE LABELS THAT NAME NOTHING NEAR THEM -------------------
  // §4.5 caught a label with NO geometry (Ramsey's phantom canals) and added an
  // engine warning for it. It never asked the next question: is the label
  // anywhere near the geometry that DOES exist? Three are not — High Wycombe's
  // "Chiltern Main Line" is 78 mm from its railway on a 190 mm frame, and
  // Ramsey's "River Nene (Old Course)" is 82 mm from the river, on the sheet
  // whose write-up records it as having been moved "onto the river it names".
  // It was moved out of the corner. Nothing checked where it landed.
  const FEAT_STROKE = { river: '#9ec9e8', canal: '#7fb0d8', railway: '#333333', road: '#e6a532', generic: '#999999' };
  const strandedFeatures = [];
  // ONLY on sheets that draw features. `features[]` belongs to the town, but the
  // radial spider draws no river and no railway, so measuring it there reported
  // every feature as stranded — three fabricated defects on the first run, which
  // is the failure this file's own comments keep warning about. A frame means an
  // internal sheet (geographic, schematic or diagram); those three draw features.
  // AND NOT ON A BOARDING SHEET, which is the same exclusion the panel-only and
  // duplicate-label measures already carry further down, found the same way. A
  // boarding plan's locator draws buildings and streets and no features at all, so
  // St Neots Town Centre's inherited `features: [River Great Ouse]` scored as a
  // stranded label with no ink of its colour anywhere — one hard defect, not a fault,
  // on an otherwise clean sheet. St Ives Bus Station never showed it because that
  // place's routes.json carries no `features[]` at all.
  if (RJ && Array.isArray(RJ.features) && hasPanel && base !== 'boarding') {
    // Which colour did the feature ACTUALLY get drawn in? Not derivable from
    // config: `rail:"chequer"` declares #4a4a4a and the sheets emit #33383d, and
    // the shipped SVG carries no feature grouping (gen_internal's gk() tags
    // features only in edit-key mode). So match the sheet's own non-route ink to
    // the colour the feature type EXPECTS, nearest in Lab — close enough to
    // absorb a shade difference, far enough not to mistake a river for a railway.
    const skeleton = new Set(['#e4e4e4', '#f0f0f0', '#ffffff', '#fff', 'none']);
    const counts = {};
    for (const s of P.strokes) {
      if (s.stroke === 'none' || skeleton.has(s.stroke) || (palette && palette.has(s.stroke))) continue;
      counts[s.stroke] = (counts[s.stroke] || 0) + 1;
    }
    const candidates = Object.keys(counts).filter(c => counts[c] >= 3);
    for (const f of RJ.features) {
      if (!f.labelPos) continue;
      const own = f.style || {};
      // EXACT first, Lab-nearest only as a fallback. Nearest-alone picks decoys:
      // the chequer railway's casing is #4a4a4a and the sheets also carry a
      // #33383d used 69 times for other furniture, which is nearer to the
      // railway's #333333 default than its own casing is — so High Wycombe's
      // "Chiltern Main Line" measured 115mm to the wrong ink instead of 78mm to
      // the right ink, and Beaconsfield's measured 132mm. Both still stranded,
      // both by the wrong number, which is the kind of right-for-the-wrong-reason
      // that survives review.
      const wants = [own.stroke, own.rail === 'chequer' ? '#4a4a4a' : null,
                     FEAT_STROKE[f.type], FEAT_STROKE.generic]
                    .filter(Boolean).map(c => String(c).toLowerCase());
      let col = wants.find(c => candidates.includes(c)) || null, bestDE = col ? 0 : Infinity;
      if (!col) for (const c of candidates) { const d = deltaE(wants[0], c); if (d < bestDE) { bestDE = d; col = c; } }
      if (!col || bestDE > 30) {                       // nothing on the sheet looks like this feature
        strandedFeatures.push({ label: f.label || f.key, mm: null, colour: want });
        continue;
      }
      /* MEASURE THE DRAWN LABEL, NOT THE CONFIGURED ONE.
       *
       * This read f.labelPos straight out of routes.json, which was true enough while
       * every feature label was a hand-set {x,y}. It stopped being true on 2026-08-19,
       * when labelPos gained the value "auto" — the engine then chooses the spot itself,
       * f.labelPos.x is undefined, the distance is NaN, `best` never falls below Infinity
       * and EVERY auto label is reported stranded. Six towns went REGRESSED on the ratchet
       * for labels that had in fact just been moved onto the features they name.
       *
       * Reading the position off the sheet beats patching around the new value, and not
       * only here: it is the difference between measuring the config and measuring the
       * artwork, and this file's whole job is the second one. It also now sees an
       * overrides.json nudge, which the config read never could.
       *
       * A feature whose label is NOT on the sheet at all is a genuine hard defect — the
       * engine refused it, or auto found nowhere — and falls through to `stranded`,
       * which is the right verdict for both.
       */
      const wantText = String((f.label != null ? f.label : f.key) || '');
      const drawn = P.texts.find(t => t.text === wantText && !t.afterPlate);
      if (!drawn) { strandedFeatures.push({ label: wantText, mm: null, colour: col }); continue; }
      const L = [drawn.x, drawn.y];
      let best = Infinity;
      for (const s of P.strokes) {
        if (s.stroke !== col) continue;
        const [a, b] = s.seg;
        const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
        let t = ((L[0] - a[0]) * vx + (L[1] - a[1]) * vy) / l2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(a[0] + t * vx - L[0], a[1] + t * vy - L[1]);
        if (d < best) best = d;
      }
      if (best > T.featureLabelMaxMm)
        strandedFeatures.push({ label: f.label || f.key, mm: +best.toFixed(1), colour: col });
    }
  }

  // --- 4. A SERVICE IN THE PANEL THAT THE MAP DOES NOT DRAW ------------
  //
  // KNOWN UNDER-REPORT, 2026-08-16. This works from the SVG, so it can only ask
  // "is there any ink in this badge's colour", and a colour is not unique to a
  // route — Ramsey's 301X and St Ives' VL14 both wear the limited-service grey
  // #BBBBBB, so a sheet drawing either one hides the other. gen_internal.js now
  // makes the same check from `TRIM[route]`, which is keyed by route rather than
  // by colour and is therefore exact; it found Ramsey's 301X, which this measure
  // reports as clean. Read the BUILD's stderr for the authoritative list; this
  // count is a floor. Not fixed here on purpose: `solo` feeds defectsAll, and
  // changing what it counts on the eve of gating the board would be a fifth
  // baseline correction landing in the middle of one.
  // St Ives lists VL14 under "VILLAGER MINIBUS" with a badge and a description,
  // and draws not one millimetre of it: `#BBBBBB` appears as a stroke nowhere on
  // the sheet. St Neots does the same with 69. The reader is told to look for a
  // line that is not there — which is worse than omitting the service, because
  // the panel is the sheet's own index of itself.
  //
  // Corridor-aware: a bundled route rides its lead's colour (internalCorridors)
  // or shares a corridor hue (corridorPalette), so it IS drawn. Only a route
  // that is in panelOrder, has its own hue, and has no ink counts.
  // A BOARDING SHEET DRAWS NO ROUTE LINES, ON PURPOSE. Both measures below assume
  // a sheet whose subject is drawn route ink, and neither is meaningful on the
  // destination-index sheet gen_boarding.js produces (see its header: "not a route
  // map"). Measured against it unadjusted, all nine of its services scored as
  // "in the panel with no line" and its repeated boarding-point names as duplicate
  // labels — 12 hard defects, none of them a fault, and a permanent FAIL row that
  // would train everyone to ignore the quality report. Scoped to the one basename
  // so every other sheet is byte-for-byte unaffected.
  const isBoarding = base === 'boarding';

  /* A REPEAT ON A DIFFERENT SPOKE IS THE DESIGN, NOT A DEFECT (OA-169, decided by
   * Peter 2026-08-30). On a radial sheet a spoke is drawn to a destination, and a
   * stop that several routes genuinely call at is named on each spoke it appears on
   * — Beaconsfield Waitrose prints `St Mary's School` on five of them, because five
   * routes really do call there. Counting that as a duplicate is counting the
   * design, exactly as `labelsOverBadge` was counting `to X` captions before OA-148
   * split them out, and the fix is the same: split the measure so the number moves
   * only when the thing it names moves.
   *
   * SCOPED TO THE EXTERNAL SHEETS, the way isBoarding above is scoped to one
   * basename, and for a stronger reason than tidiness. MEASURED 2026-08-30: an
   * external sheet carries 9–73 ink segments and the nearest-line assignment is
   * decisive (margins of 9–17mm); a town internal carries up to 14,745, and there
   * every assignment came back with a margin of 0.0–0.4mm, which is noise. On a
   * geographic map a name printed twice is a defect whatever line it is near, and
   * this must not reach one.
   *
   * AMBIGUITY IS SCORED AS A DEFECT, and that is the argument rather than a
   * concession. A label is treated as belonging to a spoke only when the
   * SECOND-nearest line is at least one cap-height further away than the nearest —
   * because if it is not, a READER cannot attribute the label to a spoke either,
   * and a name a reader cannot attribute is a defect on its own terms. That is
   * where the threshold comes from: the artwork's own type size, not a number
   * chosen to make the total look better. It bites: St Ives' second `Boxworth` sits
   * 0.1mm from being assigned the other way, and stays scored.
   *
   * WHAT IT CANNOT DO, said out loud the way OA-148's split says it: it assigns a
   * label to the nearest DRAWN LINE, which is a spoke on these sheets but is not
   * the same thing as knowing which service the label was emitted for. A generator
   * that stamped the spoke onto the label would answer this exactly and needs a
   * rollout to do it (OA-085's keyed layers, OA-118's argument about the cost). */
  const isExternal = base === 'external';
  const spokeInk = isExternal ? P.strokes.filter(st => st.w >= 1.2) : [];
  const spokeOf = (pt, capHeight) => {
    let seq = null, nearest = Infinity, second = Infinity;
    for (const st of spokeInk) {
      const d = segDistance(pt, st.seg);
      if (d < nearest) { second = nearest; nearest = d; seq = st.seq; }
      else if (d < second) second = d;
    }
    // Unambiguous only when the runner-up is a whole cap-height further off.
    return (seq !== null && second - nearest >= capHeight) ? seq : null;
  };
  for (const dup of detail.duplicates) {
    if (!isExternal || !dup.at) { dup.acrossSpokes = false; continue; }
    const a = spokeOf(dup.at[0], dup.size), b = spokeOf(dup.at[1], dup.size);
    dup.acrossSpokes = a !== null && b !== null && a !== b;
  }
  const panelOnly = [];
  if (RJ && hasPanel && !isBoarding && Array.isArray(RJ.panelOrder) && RJ.palette) {
    const rides = {};
    for (const [lead, ms] of Object.entries(RJ.internalCorridors || {})) for (const x of ms) rides[x] = lead;
    for (const [lead, ms] of Object.entries(RJ.corridorPalette || {})) for (const x of ms) if (!rides[x]) rides[x] = lead;
    const inked = new Set(P.strokes.filter(s => s.w >= 1.2).map(s => s.stroke));
    for (const key of RJ.panelOrder) {
      const c = String(RJ.palette[key] || '').toLowerCase();
      if (!c || rides[key] || inked.has(c)) continue;
      panelOnly.push({ route: key, colour: c });
    }
  }

  // --- 5. TWO ROUTE HUES THAT READ AS ONE ------------------------------
  // §5.2 built a route-vs-WATER colour check and stopped there, so nothing has
  // ever compared two routes with each other. Peter found it on paper: High
  // Wycombe's 30/32/36 are "different but similar". Measuring it turns up worse
  // pairs on towns nobody printed — St Neots' 150/112 and Wisbech's 46L/43A are
  // both dE 13.8 and run touching.
  //
  // TWO venues, because a reader confuses colours in two different places and
  // only one of them is about the map. On the MAP, two hues matter when the
  // lines run together — the pair is compared side by side, so proximity is the
  // whole question. In the PANEL every badge is side by side with every other
  // regardless of where the routes go, so any two hues in the list are compared
  // whether or not they ever meet. Peter's 30/32/36 are the panel case: none of
  // the three runs within 6 mm of another on the sheet.
  const clashMap = [], clashPanel = [];
  if (palette && palette.size && RJ && RJ.palette) {
    const byCol = {};
    for (const [k, c] of Object.entries(RJ.palette)) (byCol[String(c).toLowerCase()] ||= []).push(k);
    // Panel venue: every pair of hues the panel lists.
    const panelCols = [...new Set((RJ.panelOrder || Object.keys(RJ.palette))
      .map(k => String(RJ.palette[k] || '').toLowerCase()).filter(Boolean))];
    for (let i = 0; i < panelCols.length; i++) for (let j = i + 1; j < panelCols.length; j++) {
      const d = deltaE(panelCols[i], panelCols[j]);
      if (d < T.colourClashDE)
        clashPanel.push({ a: byCol[panelCols[i]].join('/'), b: byCol[panelCols[j]].join('/'), dE: +d.toFixed(1) });
    }
    // Map venue: coarse occupancy per hue, dilated by colourNearMm, intersected.
    const CC = 2, cnx = Math.ceil(W / CC), cny = Math.ceil(H / CC);
    const occ = {};
    for (const s of P.strokes) {
      if (!byCol[s.stroke] || s.w < 1.2) continue;
      const g = (occ[s.stroke] ||= new Uint8Array(cnx * cny));
      const [p, q] = s.seg;
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / CC));
      for (let i = 0; i <= n; i++) {
        const gx = Math.floor((p[0] + (q[0] - p[0]) * i / n) / CC), gy = Math.floor((p[1] + (q[1] - p[1]) * i / n) / CC);
        if (gx >= 0 && gy >= 0 && gx < cnx && gy < cny) g[gy * cnx + gx] = 1;
      }
    }
    const cols = Object.keys(occ), rad = Math.ceil(T.colourNearMm / CC);
    const dil = {};
    for (const c of cols) {
      const g = occ[c], d2 = new Uint8Array(cnx * cny);
      for (let y = 0; y < cny; y++) for (let x = 0; x < cnx; x++) {
        if (!g[y * cnx + x]) continue;
        for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
          const ix = x + dx, iy = y + dy;
          if (ix >= 0 && iy >= 0 && ix < cnx && iy < cny) d2[iy * cnx + ix] = 1;
        }
      }
      dil[c] = d2;
    }
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      const d = deltaE(cols[i], cols[j]);
      if (d >= T.colourClashDE) continue;
      const A = dil[cols[i]], B = occ[cols[j]];
      let together = false;
      for (let k = 0; k < B.length && !together; k++) if (B[k] && A[k]) together = true;
      if (together) clashMap.push({ a: byCol[cols[i]].join('/'), b: byCol[cols[j]].join('/'), dE: +d.toFixed(1) });
    }
  }

  // --- 6. HOW CLOSE THE TYPE COMES TO THE TRIM EDGE --------------------
  // Every sheet puts its last footer line at y=206.00 on a 210 mm page: 4 mm,
  // inside the conventional 5 mm safe margin. Borderless printing over-scales
  // by 2-3% to guarantee bleed, which on this page is ~3 mm — so the margin
  // that survives is about 1 mm, and whether a given sheet looks right is down
  // to feed tolerance. Peter saw it on St Ives and not on High Wycombe; the two
  // are byte-for-byte identical in this respect, which is the finding.
  //
  // Text only. Route ink is MEANT to run to the frame edge and be trimmed, so
  // measuring ink here would report 0 on every sheet and mean nothing.
  let textEdge = Infinity, edgeWorst = null;
  for (const t of allText) {
    if (!t.text.trim()) continue;
    const b = quadBox(textQuad(t));
    const d = Math.min(b.x0 - vb[0], b.y0 - vb[1], vb[0] + W - b.x1, vb[1] + H - b.y1);
    if (d < textEdge) { textEdge = d; edgeWorst = t.text.slice(0, 40); }
  }
  if (edgeWorst && textEdge < T.edgeSafeMm) detail.nearEdge.push({ text: edgeWorst, mm: +textEdge.toFixed(2) });

  /* ==================================================================
   * TWO MEASURES ADDED 2026-08-28 — OA-021 and OA-118.
   *
   * Both are things a reader sees the instant the sheet is in front of them
   * and every measure above scores as zero. They are grouped here because they
   * are one family: the densest small ink on the page, and the ink that is
   * drawn ON TOP of other ink rather than beside it.
   * ================================================================== */

  // --- 7. A LABEL PRINTED OVER A ROUTE BADGE, AND A BADGE OVER A BADGE ---
  //
  // OA-021. `lbl/lbl`, `lbl/ic` and `pt/ink` between them miss this: a badge is
  // not a label (its glyph carries dominant-baseline="central" and is excluded
  // from mapLabels by construction), it is not an icon (icons.js emits a scaled
  // <g>; a badge translates but never scales), and a filled disc is not a
  // stroke, so the occupancy grid never hears about it either. A place name
  // sitting on a 4.6mm coloured roundel is therefore worth exactly 0 today.
  //
  // svg_primitives.js badge() draws either a <circle r=rad> or, under
  // design.badgeFit, a <rect rx=rad> when the key is too wide for the disc —
  // both filled with the ROUTE's own palette colour and stroked white at 0.7.
  // The palette is what tells a badge from any other disc on the sheet (a stop
  // tick is white or black, a POI dot is grey), which is why this measure is
  // skipped entirely on a sheet with no readable routes.json rather than
  // guessed at: a guess here invents defects, and a fabricated defect is worse
  // than none (the same rule the legend exclusion above was written under).
  const badges = [];
  if (palette && palette.size) {
    for (const c of P.circles) {
      if (!palette.has(c.fill) || c.r <= 0) continue;
      if (c.cx >= panelX0 - 1 || c.cy >= footerTop) continue;   // panel key and footer chrome
      badges.push({ cx: c.cx, cy: c.cy, rx: c.r, ry: c.r, seq: c.seq });
    }
    for (const r of P.rects) {
      if (r.rx <= 0 || !palette.has(r.fill)) continue;
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      if (cx >= panelX0 - 1 || cy >= footerTop) continue;
      badges.push({ cx, cy, rx: (r.x1 - r.x0) / 2, ry: (r.y1 - r.y0) / 2, seq: r.seq });
    }
  }
  // A label over a badge. The badge's own glyph is already excluded (central).
  //
  // THIS COMMENT USED TO SAY that a "to X" terminus caption "is placed clear of
  // the badge box it belongs to by termBadge()'s own reserve(), so anything that
  // lands here is ink the placer did not know was there". **That was asserted,
  // never measured, and it is false** — measured 2026-08-29 across all 52 sheets,
  // 31 of the 44 hits are "to X" captions. The claim is also the reason nobody
  // looked for four weeks: the measure was documented as already excluding them,
  // so the whole number read as placer-attributable when two thirds of it is not.
  //
  // The two populations are now counted separately, because a caption on a frame
  // exit and a place name buried under a roundel are different harms with
  // different fixes, and one number cannot be driven to zero. This is exactly the
  // correction `exitTailOverInk` already applies to the sibling `pt/ink` measure
  // — "a point label over its OWN continuation is the design, not a defect" — and
  // it uses the same `^to\s` name test, with the same limitation stated out loud:
  // it tells a CAPTION from a place name, and it does not tell a caption on its
  // own badge from one on a neighbour's. Splitting that further needs the badge's
  // route identity, which is a separate measurement.
  for (const L of mapLabels) {
    const b = quadBox(growQuad(L.quad, T.haloPadMm));
    for (const g of badges) {
      if (g.cx + g.rx > b.x0 && g.cx - g.rx < b.x1 && g.cy + g.ry > b.y0 && g.cy - g.ry < b.y1) {
        detail.labelOverBadge.push({ text: L.text, kind: L.kind, at: [+g.cx.toFixed(1), +g.cy.toFixed(1)] });
        break;                                   // one defect per label, not one per badge under it
      }
    }
  }
  // A badge over a badge. badgeStack() pitches its members at rad*2+0.5, so a
  // legitimate stack clears by 0.5mm and never registers; what does register is
  // two INDEPENDENT badges stamped at the same place, which is what termBadge()
  // does today because it has no spacing test at all (OA-023: the 301 disc is
  // half under the 302 disc on the St Ives Bus Station internal sheet).
  //
  // BOX overlap, not centre distance, and the difference is not academic: under
  // design.badgeFit a wide key ("X31") is drawn as a STADIUM — a rect with rx =
  // the disc radius — that is far wider than it is tall. A radial test over
  // max(rx, ry) reads that half-width as a radius in BOTH directions and reports
  // two stadium badges sitting tidily side by side as printing on each other.
  // First cut of this measure did exactly that and claimed 9 overprints on High
  // Wycombe internal, of which the honest number is far smaller.
  //
  // CORRECTED 2026-08-28 (OA-060): the BOX rule above was right about stadiums and
  // wrong about discs, and it swapped one shape's false positive for another's.
  // Two circles of r=3.4 whose centres are 7.22mm apart have 0.42mm of daylight
  // between them and cannot be printing on anything -- but their bounding boxes
  // overlap 3.10 x 0.60mm, so a box test on both axes calls it an overprint. That
  // is not a corner case: it is what a badge ROW looks like on a diagonal spoke,
  // where consecutive badges sit at the row pitch and the pitch is only a little
  // more than the diameter. Ely Co-op and Godmanchester Ermine Street each carried
  // one, and they are not defects.
  //
  // The exact answer covers both shapes at once, because a disc IS a stadium whose
  // straight core has zero length. Take each badge's core segment -- horizontal,
  // half-length (rx - ry), at its centre -- and measure the true gap between the
  // two segments; the marks touch when that gap is less than the sum of their
  // corner radii. It degenerates to the radial test for two discs and to the box
  // test for two stadiums on one line, which is why both earlier rules looked
  // right on the cases their author had in front of them.
  const gapMm = (a, b) => {
    const ax0 = a.cx - (a.rx - a.ry), ax1 = a.cx + (a.rx - a.ry);
    const bx0 = b.cx - (b.rx - b.ry), bx1 = b.cx + (b.rx - b.ry);
    const dx = Math.max(0, ax0 - bx1, bx0 - ax1);   // 0 when the cores overlap in x
    return Math.hypot(dx, a.cy - b.cy) - (a.ry + b.ry);
  };
  for (let i = 0; i < badges.length; i++) for (let j = i + 1; j < badges.length; j++) {
    const a = badges[i], b = badges[j];
    const over = -gapMm(a, b);
    if (over <= T.badgeOverlapMm) continue;
    const ox = (a.rx + b.rx) - Math.abs(a.cx - b.cx);
    const oy = (a.ry + b.ry) - Math.abs(a.cy - b.cy);
    detail.badgeOverBadge.push({
      // `over` stays the per-axis pair every earlier report printed; `deep` is how
      // far the two marks actually interpenetrate, which is the figure the rule now
      // turns on and the only one that is comparable between a disc and a stadium.
      deep: +over.toFixed(2),
      over: [+ox.toFixed(2), +oy.toFixed(2)],
      at: [+a.cx.toFixed(1), +a.cy.toFixed(1)], and: [+b.cx.toFixed(1), +b.cy.toFixed(1)],
      // The HALF-HEIGHT is the badge radius the generator asked for, and that is
      // which pass drew it: termBadge() uses 2.6, the sprinkled pass 2.4, the
      // frame-cut terminus rows 3. Without it the detail line says two badges
      // overlap and cannot say whose fault it is, which is the whole question
      // OA-023/OA-024 turn on. Half-height, not half-width: a stadium is widened
      // by design.badgeFit and its ry is still the radius.
      rad: [+a.ry.toFixed(2), +b.ry.toFixed(2)],
    });
  }

  // --- 7b. A TERMINUS LOZENGE PRINTED ON ANOTHER TERMINUS LOZENGE -------
  //
  // The destination boxes on an external sheet were measured by NOTHING until
  // 2026-08-28. OA-060 had been open since 2026-08-24 saying "High Wycombe has
  // two overlapping by 4.99 mm" and quoting a hand measurement, because there
  // was no tool that could say how many more there were; the row's own words
  // were "18 badges plus an unknown number". The honest answer turned out to be
  // seven, and one of them is Huntingdon printing "Addenbrooke's ~79 min" over
  // "Cambridge ~56 min" by 13.46 x 14.60 mm -- a destination almost entirely
  // erased, on a sheet whose every other number was clean.
  //
  // Both external generators draw the box identically -- gen_external_radial.js
  // townNode() and gen_external_places.js destNode() -- so ONE signature covers
  // the town sheets and the place sheets. Keyed on the FILL AND STROKE PAIR
  // rather than on rx=2.4, because the corner radius is a magic number that a
  // later restyle could move without meaning anything, while #2e8b57 on #1d5f3a
  // is this mark's identity. Measured across all 52 committed sheets on
  // 2026-08-28: 153 lozenges, one signature, and nothing else on any sheet uses
  // that colour at all.
  //
  // BOX overlap on BOTH axes, with the badge tolerance, for the reason OA-021
  // and OA-023 paid for in opposite directions -- a radial test on a box that is
  // 40 mm wide and 11 mm tall invents defects along its short axis and misses
  // them along its long one. A lozenge is the widest box on the sheet, so it is
  // the worst possible candidate for a centre-distance test.
  const lozenges = [];
  for (const r of P.rects) {
    if (r.fill !== '#2e8b57' || r.stroked !== '#1d5f3a') continue;
    lozenges.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
      // The words inside the box, so a detail line can say WHICH destination is
      // buried. This is not decoration: it is what settled the open question on
      // OA-060, which had guessed that overlapping lozenges would turn out to be
      // one destination reached two ways and should therefore be MERGED. Named,
      // all seven were distinct places -- Addenbrooke's over Cambridge, Gatwick
      // over Maidenhead over Bourne End -- and the single same-destination pair
      // (St Ives' two Ramseys) carries different journey times, 67 min against
      // 49, so merging would have destroyed the one fact a reader wants. A count
      // alone would have sent that fix the wrong way.
      txt: P.texts.filter(t => t.x > r.x0 && t.x < r.x1 && t.y > r.y0 && t.y < r.y1)
                  .map(t => t.text).join(' ').trim() });
  }
  // THREE STATES, NOT TWO, and the middle one is a false-zero guard. An external
  // sheet ALWAYS draws at least one destination -- the fewest on the board is
  // Ramsey with four -- so finding none does not mean a clean sheet, it means
  // the signature above has stopped matching what the generator emits. Reporting
  // that as 0 would be exactly the shape this file already carries a paragraph
  // about at measure 1: a coverage gap reading as a good result. Any other sheet
  // type has no terminus lozenges by construction and the measure simply does
  // not apply to it.
  const lozState = base !== 'external' ? 'not-external'
                 : lozenges.length === 0 ? 'signature-lost' : 'counted';
  if (lozState === 'counted') {
    for (let i = 0; i < lozenges.length; i++) for (let j = i + 1; j < lozenges.length; j++) {
      const a = lozenges[i], b = lozenges[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox <= T.lozengeOverlapMm || oy <= T.lozengeOverlapMm) continue;
      detail.lozengeOverlap.push({
        over: [+ox.toFixed(2), +oy.toFixed(2)],
        at: [+a.x0.toFixed(1), +a.y0.toFixed(1)], and: [+b.x0.toFixed(1), +b.y0.toFixed(1)],
        text: a.txt, under: b.txt,
      });
    }
  }

  // --- 8. TWO ROUTE RIBBONS THAT CROSS AT A SHALLOW ANGLE ---------------
  //
  // Two co-running routes crossing at a shallow angle, clustered one site per
  // visual crossing. Different colours only: one route crossing ITSELF is an
  // out-and-back leg, which is the town rather than the placer. A steep crossing
  // is a junction and is not counted.
  //
  // WHAT THIS IS NOT, and the distinction cost a day to learn. It is NOT a lane
  // mirror detector. It was built as one on 2026-08-28 for OA-118 — the shipped
  // version classified a crossing as a "mirror" when the lane spacing was the
  // same either side of it — and the first site anybody actually LOOKED at
  // disproved it in both directions at once. High Wycombe internal, the street
  // at x≈156, y=116..134: with laneOrientation OFF the 32/32A and 34 ribbons
  // swap sides between y=126 and y=128 at a near-constant 2.9mm gap, which is a
  // textbook mirror, and the measure scored it ZERO — because that swap happens
  // as a JUMP between vertices, the two polylines never intersect, and a
  // crossing-based test cannot see a mirror that does not cross. With the fix ON
  // the same ribbons stay in the same order the whole way, and the measure
  // reported ONE mirror there.
  //
  // Two later attempts at a lateral-order test failed for a reason worth
  // recording: "which strand of the other route am I beside" is a discontinuous
  // selector wherever a route runs out and back, so the side flips spuriously —
  // which is precisely the bug lane_normals.js exists to fix, reappearing in the
  // detector written to check it.
  //
  // THE NUMBER ALREADY EXISTS AND IT IS NOT HERE. lane_normals.js computes the
  // corridor orientation field and returns `conflicts` and `flipped`; a corridor
  // with conflicts === 0 has a consistent orientation and therefore no mirrors,
  // by construction. gen_internal.js prints both behind DBG_LANES and nothing
  // else reads them. Surfacing that is OA-118's real answer; an SVG reader is
  // the wrong place to re-derive it. See OA-118.
  const laneSegs = [];
  for (const s2 of P.strokes) {
    if (!isRouteInk(s2) || !palette || !palette.has(s2.stroke)) continue;
    const seg = (s2.clipped && P.mapFrame) ? clipSegToRect(s2.seg, P.mapFrame, 0) : s2.seg;
    if (!seg) continue;
    const dx = seg[1][0] - seg[0][0], dy = seg[1][1] - seg[0][1];
    const L = Math.hypot(dx, dy);
    if (L < 0.3) continue;                       // a vertex, not a run
    laneSegs.push({ p: seg[0], q: seg[1], dx, dy, L, col: s2.stroke });
  }
  const COSMAX = Math.cos(T.laneCrossDeg * Math.PI / 180);
  const sites = [];
  for (let i = 0; i < laneSegs.length; i++) for (let j = i + 1; j < laneSegs.length; j++) {
    const a = laneSegs[i], b = laneSegs[j];
    if (a.col === b.col) continue;
    // |cos| because a ribbon's digitisation direction is arbitrary: anti-parallel
    // lanes are the same corridor, not a 180-degree crossing.
    const cos = Math.abs((a.dx * b.dx + a.dy * b.dy) / (a.L * b.L));
    if (cos < COSMAX) continue;                  // steep: a real junction
    const den = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(den) < 1e-9) continue;          // exactly parallel: never crosses
    const t = ((b.p[0] - a.p[0]) * b.dy - (b.p[1] - a.p[1]) * b.dx) / den;
    const u = ((b.p[0] - a.p[0]) * a.dy - (b.p[1] - a.p[1]) * a.dx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const x = a.p[0] + a.dx * t, y = a.p[1] + a.dy * t;
    // One visual crossing is many segment intersections (a polyline is hundreds
    // of segments and the two ribbons interleave through the swap), so cluster.
    const near = sites.find(s3 => Math.hypot(s3.x - x, s3.y - y) < T.laneCrossSiteMm);
    if (near) { near.n++; continue; }
    sites.push({ x, y, n: 1, deg: +(Math.acos(Math.min(1, cos)) * 180 / Math.PI).toFixed(1),
                 cols: [a.col, b.col], a });
  }
  for (const s3 of sites)
    detail.laneCross.push({ at: [+s3.x.toFixed(1), +s3.y.toFixed(1)], deg: s3.deg, hits: s3.n, cols: s3.cols });

  const m = {
    pointLabelsOverInk: detail.overInk.filter(d => d.kind === 'point').length,
    roadLabelsOverInk: detail.overInk.filter(d => d.kind === 'road').length,
    labelLabelCollisions: detail.labelPairs.length,
    // An index legitimately names the same boarding point on many rows.
    duplicateLabels: isBoarding ? 0 : detail.duplicates.length,
    duplicateAcrossSpokes: isBoarding ? 0 : (isExternal ? detail.duplicates.filter(d => d.acrossSpokes).length : null),
    labelIconCollisions: detail.labelIcon.length,
    iconBlobs: detail.iconPairs.length,
    textUnderFooter: detail.inFooter.length,
    symbolsUnderLegend: legend ? detail.underLegend.length : null,
    routeLinesUnderLegend: legend ? detail.routeUnderLegend.length : null,
    inkAreaUnderFooterMm2: inkAreaInFooter,
    labelsIntoPanel: hasPanel || legend ? detail.intoPanel.length : null,
    minTextMm: allText.length ? +Math.min(...allText.filter(t => t.size > 0).map(t => t.size)).toFixed(2) : null,
    emptyNinths: emptyCells,
    balance,
    peakInkDensity: +peak.toFixed(2),
    mapLabels: mapLabels.length,
    // --- the seven added 2026-08-16 ---
    unplacedLabels: unplaced ? unplaced.length : null,
    unplacedLabelsState: dropState,   // 'counted' | 'no-reporter' | 'unreadable'
    exitTailOverInk: exitTail.length,
    strandedFeatureLabels: strandedFeatures.length,
    panelOnlyServices: hasPanel ? panelOnly.length : null,
    colourClashOnMap: clashMap.length,
    colourClashInPanel: clashPanel.length,
    textEdgeMm: textEdge === Infinity ? null : +textEdge.toFixed(2),
    // --- the two added 2026-08-28 (OA-021, OA-118) ---
    // null, not 0, on a sheet with no readable routes.json: both measures are
    // defined by the route palette, and "could not tell" must not read as "clean".
    labelsOverBadge: (palette && palette.size) ? detail.labelOverBadge.length : null,
    // Of those, the frame-exit continuation captions — see the measure above.
    exitCaptionOverBadge: (palette && palette.size)
      ? detail.labelOverBadge.filter(d => d.kind === 'point' && /^to\s/.test(d.text)).length : null,
    badgeOverBadge: (palette && palette.size) ? detail.badgeOverBadge.length : null,
    laneCrossings: (palette && palette.size) ? detail.laneCross.length : null,
    // --- added 2026-08-28, OA-060 ---
    // null on every sheet that is not an external, and null on an external whose
    // lozenge signature found nothing at all; see measure 7b for why the second
    // of those is not a zero.
    lozengeOverlap: lozState === 'counted' ? detail.lozengeOverlap.length : null,
    lozengeOverlapState: lozState,    // 'counted' | 'not-external' | 'signature-lost'
    lozenges: lozState === 'counted' ? lozenges.length : null,
  };
  // A point label over its OWN continuation is the design, not a defect — see
  // measure 2. pt/ink is left untouched so the board stays comparable with the
  // frozen scorecard; this is the figure that means anything.
  m.pointLabelsOverInkNet = m.pointLabelsOverInk - m.exitTailOverInk;
  // The same correction for labels over a badge (OA-148). `labelsOverBadge` is
  // left untouched so the frozen scorecard stays comparable; THIS is the figure
  // the placer can be held to, and it is the one to drive to zero before the
  // measure is folded into `hard`.
  m.labelsOverBadgeNet = m.labelsOverBadge === null ? null : m.labelsOverBadge - m.exitCaptionOverBadge;
  /* And the same correction for a name repeated on two spokes (OA-169). Unlike the
   * two above, THIS one is subtracted from a measure that is already scored, so the
   * net figure is what `hard` counts — a split that left the scored number alone
   * would report the design honestly and go on failing the sheet for it.
   * `duplicateLabels` itself is left untouched so the frozen scorecard stays
   * comparable, which is the convention the two lines above already follow. */
  m.duplicateLabelsNet = m.duplicateLabels - (m.duplicateAcrossSpokes || 0);

  // Drops as a RATE, because the raw count is not comparable between sheets and
  // reading it as one would libel the towns the triage deliberately thinned.
  // High Wycombe drops 52 against 78 placed — 40% — and that is substantially
  // the over-stuffed sheet behaving as `complexity-triage.md` says it should
  // (rungs 2 and 2b exist to shed content). St Ives drops 2 against 42, 5%.
  // A rate makes the two legible side by side; the raw count made the biggest
  // town look like the worst engineering. What the THRESHOLD should be is a
  // judgement about the product, not about the placer — see the plan.
  m.dropRatePct = m.unplacedLabels === null ? null
    : +(m.unplacedLabels * 100 / Math.max(1, m.unplacedLabels + m.mapLabels)).toFixed(0);

  // One trackable number. Every later phase should drive this down, and the
  // per-100-labels form stops a big town looking worse simply for being big.
  //
  // UNCHANGED, deliberately. Five of the seven new measures would belong in it
  // on merit, and folding them in would move every figure on the frozen
  // scorecard at once — a fifth baseline correction, on the same day the tool
  // is being prepared for the gate. `defectsAll` below is the honest total;
  // this stays the ledger the plan has tracked since Phase 0, so the two can be
  // read against each other before either is adopted as the headline (G5).
  m.defects = m.pointLabelsOverInk + m.labelLabelCollisions + m.labelIconCollisions
    + m.duplicateLabels + m.iconBlobs + m.textUnderFooter + (m.labelsIntoPanel || 0)
    + (m.symbolsUnderLegend || 0);
  m.defectsPer100 = m.mapLabels ? +(m.defects * 100 / m.mapLabels).toFixed(0) : null;

  /* HARD versus SOFT — session 8's lesson, applied to the total itself.
   *
   * "Rank the two harms before you combine them." Today a place name buried
   * under the legend and a label grazing a ribbon both count 1, so the single
   * number can be improved by trading the first for several of the second. The
   * line is not severity-by-feel, it is a question about the reader:
   *
   *   HARD — the reader LOSES something or cannot read it. A label never drawn,
   *          drawn under an opaque plate, drawn twice so both read as garble,
   *          drawn below the legibility floor, or naming a thing that is not
   *          there. No amount of soft improvement compensates: gate this at 0.
   *   SOFT — the information survives, under pressure. A label on a ribbon
   *          still reads through its halo; a crowded icon is still the right
   *          icon. Worth driving down, never worth buying with a hard defect.
   *
   * Keep them as two numbers and a weighted sum can never quietly buy the
   * unacceptable thing because it happened to be small.
   */
  /* FOLDED IN 2026-08-28 (OA-021, on the day OA-060 and OA-147 emptied them):
   * `badgeOverBadge` and `lozengeOverlap` are HARD.
   *
   * Both were built REPORTED AND NOT SCORED on purpose, and the reason was never
   * that they did not matter -- a route number with its last digit under another
   * disc, or a destination printed over another destination, is information the
   * reader simply cannot recover, which is the definition of hard above. The
   * reason was that they were non-zero on the day they were written, and a check
   * that is red the day it lands gets muted within the week. So the fold-in was
   * gated on the sheets, not on anybody's opinion.
   *
   * The sheets are clean. Board-wide, all 52: badge-on-badge 0, lozenge-on-
   * lozenge 0. Both start green and every future occurrence fails the ratchet on
   * the sheet that causes it.
   *
   * `labelsOverBadge` STAYS REPORTED, at 47, and that is the same rule applied
   * honestly rather than an inconsistency: it is not zero, so scoring it today
   * would fail the ratchet on every affected sheet at once, which is the outcome
   * this whole convention exists to avoid. It folds in when it is empty too.
   *
   * `|| 0` on both, because null means "could not tell" -- an unreadable
   * routes.json, or a sheet type with no lozenges -- and an unmeasurable sheet
   * must not be charged for a defect nobody has established is there. */
  m.hard = m.textUnderFooter + m.duplicateLabelsNet + m.labelLabelCollisions
    + (m.symbolsUnderLegend || 0) + (m.unplacedLabels || 0)
    + (m.panelOnlyServices || 0) + m.strandedFeatureLabels
    + (m.badgeOverBadge || 0) + (m.lozengeOverlap || 0)
    + (m.minTextMm !== null && m.minTextMm < T.minTextMm ? detail.tiny.length : 0);
  m.soft = m.pointLabelsOverInkNet + m.labelIconCollisions + m.iconBlobs + (m.labelsIntoPanel || 0);
  m.defectsAll = m.hard + m.soft;
  const fails = [];
  const warns = [];
  if (m.pointLabelsOverInk > T.labelsOverInkFail) fails.push('point labels over route ink');
  else if (m.pointLabelsOverInk > 0) warns.push('point labels over route ink');
  if (m.labelLabelCollisions > 0) fails.push('labels overlapping');
  if (m.duplicateLabelsNet > 0) fails.push('duplicate labels'
    + (m.duplicateAcrossSpokes ? ' (' + m.duplicateAcrossSpokes + ' more repeat on a different spoke, which is the design)' : ''));
  else if (m.duplicateAcrossSpokes > 0) warns.push(m.duplicateAcrossSpokes
    + ' name' + (m.duplicateAcrossSpokes === 1 ? '' : 's') + ' repeated on a different spoke — reported, not scored (OA-169)');
  if (m.labelIconCollisions > 0) fails.push('labels over a foreign icon');
  if (m.iconBlobs > 0) fails.push('icon blobs');
  if (m.textUnderFooter > 0) fails.push('text under footer');
  if (m.symbolsUnderLegend > 0) fails.push('artwork buried under the legend');
  else if (m.routeLinesUnderLegend > 0) warns.push('route lines behind the legend');
  if (m.labelsIntoPanel > 0) fails.push('labels into panel');
  if (m.minTextMm !== null && m.minTextMm < T.minTextMm) fails.push('text below ' + T.minTextMm + 'mm');
  if (m.inkAreaUnderFooterMm2 > T.footerInkWarnMm2) warns.push('route ink under footer');
  if (m.roadLabelsOverInk > T.roadOverInkWarn) warns.push('road names over route ink');
  if (m.emptyNinths >= T.emptyNinthsWarn) warns.push('whitespace unbalanced');
  // The seven added 2026-08-16. Four are hard and fail; three are reported.
  if (m.unplacedLabels > 0) fails.push(m.unplacedLabels + ' labels the placer dropped');
  if (m.panelOnlyServices > 0) fails.push('service in the panel with no line on the map');
  if (m.strandedFeatureLabels > 0) fails.push('feature label far from its own feature');
  if (m.textEdgeMm !== null && m.textEdgeMm < T.edgeFailMm) fails.push('text ' + m.textEdgeMm + 'mm from the trim edge');
  else if (m.textEdgeMm !== null && m.textEdgeMm < T.edgeSafeMm) warns.push('text inside the ' + T.edgeSafeMm + 'mm print safe margin');
  // badgeOverBadge and lozengeOverlap are SCORED as of 2026-08-28 — see the note
  // on m.hard above for why that waited until the board was empty, and why
  // labelsOverBadge has not followed them yet.
  if (m.labelsOverBadge > 0) warns.push(m.labelsOverBadge + ' labels printed over a route badge'
    + (m.exitCaptionOverBadge ? ' (' + m.exitCaptionOverBadge + ' of them frame-exit captions, ' + m.labelsOverBadgeNet + ' placer-attributable)' : ''));
  if (m.badgeOverBadge > 0) fails.push(m.badgeOverBadge + ' route badges printed on each other');
  // OA-060, same treatment and the same reason: reported until the sheets are
  // clean, then folded in. `signature-lost` is louder than any count, because it
  // means this measure has stopped being able to see its own subject.
  if (m.lozengeOverlap > 0) fails.push(m.lozengeOverlap + ' destination lozenges printed on each other');
  if (m.lozengeOverlapState === 'signature-lost') warns.push('external sheet with NO terminus lozenge found - the lozengeOverlap measure is blind here');
  if (m.laneCrossings > T.laneCrossWarn) warns.push(m.laneCrossings + ' shallow route crossings');
  if (m.colourClashOnMap > 0) warns.push('route hues that read alike running together');
  else if (m.colourClashInPanel > 0) warns.push('route hues that read alike in the panel');

  detail.strandedFeatures = strandedFeatures;
  detail.panelOnly = panelOnly;
  detail.clashMap = clashMap;
  detail.clashPanel = clashPanel;
  // The map-label TEXTS, not just the count. Exported for contact_sheet.js's
  // old-vs-new diff (Phase 8 item 0b, 2026-08-16), which needs to separate a
  // label the reader lost off the MAP from a panel row that was reworded — on
  // High Wycombe a whole-sheet diff reports 36 lost, of which most are the
  // panelCorridors regrouping doing exactly what it was built to do. Emitted
  // here rather than re-derived there: the map/panel/footer/legend partition
  // above is subtle (six exclusions, four of them fixes for wrong answers), and
  // a second implementation of a rule is a second chance to get it wrong.
  detail.mapLabelTexts = mapLabels.map(l => l.text);
  return { file: svgPath, metrics: m, fails, warns, detail, share };
}

// --------------------------------------------------------------------- CLI
// THE THIRD COPY OF THE SAME ENUMERATION, and it was the one still short.
// quality_gate.js fixed this on 2026-08-23 with a comment reading "same shape as
// the gap in gate_lib's findPlaces(), in a second file" — and this, the walk the
// `--all` CLI actually uses, was the third and nobody looked for it. Consequence,
// measured 2026-08-28: every board-wide figure this tool has ever printed, the
// "57 badge overprints across 46 sheets" of OA-021 included, was taken over a
// population three maps short — Ely Co-op and the two Godmanchester Co-ops live
// under `Places/_standalone/` and were measured by nothing. An enumeration is a
// silent filter: it does not fail, it answers about a smaller board.
// `_portal-fixture` is excluded for the reason quality_gate.js excludes it — it is
// a CI fixture reproduced byte-for-byte on purpose, not a map anybody reads.
function findSheets(busesDir) {
  const out = [];
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '_portal-fixture') walk(p); }
      else if (e.name.endsWith('.svg') && path.basename(d) === 'ci-reference') out.push(p);
    }
  };
  walk(path.join(busesDir, 'Areas'));
  walk(path.join(busesDir, 'Places'));
  return out.sort();
}
const label = (p) => {
  const parts = p.split(/[\\/]/); const sheet = path.basename(p, '.svg');
  const i = parts.indexOf('ci-reference');
  return parts[i - 1] + ' · ' + sheet;
};

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json'), detail = argv.includes('--detail');
  let buses = 'C:/u3a St Ives/Using AI/Buses';
  const bi = argv.indexOf('--buses'); if (bi >= 0) buses = argv[bi + 1];
  let files = argv.filter(a => a.endsWith('.svg'));
  if (argv.includes('--all') || !files.length) files = findSheets(buses);
  if (!files.length) { console.error('no sheets found'); process.exit(2); }

  const results = files.map(analyse);
  // `share` is the 3x3 ink share behind emptyNinths, row-major. Emitted because
  // "this sheet has 4 empty ninths" is not actionable without knowing WHICH four.
  if (json) { console.log(JSON.stringify(results.map(r => ({ file: r.file, metrics: r.metrics, fails: r.fails, warns: r.warns, share: r.share })), null, 2)); return; }

  const cols = [
    ['sheet', r => label(r.file), 36],
    ['lbls', r => r.metrics.mapLabels, 5],
    ['pt/ink', r => r.metrics.pointLabelsOverInk, 7],
    ['rd/ink', r => r.metrics.roadLabelsOverInk, 7],
    ['lbl/lbl', r => r.metrics.labelLabelCollisions, 8],
    ['lbl/ic', r => r.metrics.labelIconCollisions, 7],
    ['dup', r => r.metrics.duplicateLabels, 4],
    ['blob', r => r.metrics.iconBlobs, 5],
    ['ftr.txt', r => r.metrics.textUnderFooter, 8],
    ['lgnd', r => r.metrics.symbolsUnderLegend, 6],
    ['ftr.mm2', r => r.metrics.inkAreaUnderFooterMm2, 8],
    ['pnl', r => r.metrics.labelsIntoPanel ?? '-', 4],
    ['min', r => r.metrics.minTextMm, 5],
    ['void', r => r.metrics.emptyNinths, 5],
    // The seven added 2026-08-16 (§5.3 print check). drop/pnlOnly/feat/edge are
    // HARD — the reader loses something; exit and the two clash counts are
    // reported rather than scored.
    ['drop', r => (r.metrics.unplacedLabels ?? '-') + (r.metrics.dropRatePct === null ? '' : '/' + r.metrics.dropRatePct + '%'), 9],
    ['exit', r => r.metrics.exitTailOverInk, 5],
    ['solo', r => r.metrics.panelOnlyServices ?? '-', 5],
    ['feat', r => r.metrics.strandedFeatureLabels, 5],
    ['col~', r => r.metrics.colourClashOnMap + '/' + r.metrics.colourClashInPanel, 6],
    ['edge', r => r.metrics.textEdgeMm ?? '-', 5],
    ['DEF', r => r.metrics.defects, 5],
    ['HARD', r => r.metrics.hard, 5],
    ['ALL', r => r.metrics.defectsAll, 5],
    ['/100', r => r.metrics.defectsPer100, 5],
    ['', r => (r.fails.length ? 'FAIL' : r.warns.length ? 'warn' : 'ok'), 5],
  ];
  const width = cols.reduce((s, c) => s + c[2], 0);
  console.log(cols.map(c => String(c[0]).padEnd(c[2])).join(''));
  console.log('-'.repeat(width));
  for (const r of results) console.log(cols.map(c => String(c[1](r)).padEnd(c[2])).join(''));

  const tot = (k) => results.reduce((s, r) => s + (r.metrics[k] || 0), 0);
  console.log('-'.repeat(width));
  console.log(`total defects: ${results.reduce((a,r)=>a+r.metrics.defects,0)} across ${results.length} sheets
${results.length} sheets · ${results.filter(r => r.fails.length).length} FAIL · ${results.filter(r => !r.fails.length && r.warns.length).length} warn · ${results.filter(r => !r.fails.length && !r.warns.length).length} clean`);
  console.log(`totals: ${tot('pointLabelsOverInk')} point labels over route ink · ${tot('roadLabelsOverInk')} road names over route ink · ${tot('labelLabelCollisions')} label collisions · ${tot('duplicateLabels')} duplicate labels · ${tot('labelIconCollisions')} over a foreign icon · ${tot('iconBlobs')} icon blobs · ${tot('textUnderFooter')} text under footer · ${tot('symbolsUnderLegend')} buried under the legend`);

  if (detail) for (const r of results) {
    if (!r.fails.length && !r.warns.length) continue;
    console.log('\n== ' + label(r.file) + '  [' + [...r.fails, ...r.warns].join(', ') + ']');
    if (r.detail.overInk.length) console.log('  over route ink: ' + r.detail.overInk.map(d => `"${d.text}" ${d.cover}%`).join(', '));
    if (r.detail.duplicates.length) console.log('  duplicate labels: ' + r.detail.duplicates.map(d => `"${d.text}" x2 ${d.gap}mm apart${d.acrossSpokes ? ' [different spokes — the design, not scored]' : ''}`).join(', '));
    if (r.detail.labelPairs.length) console.log('  label collisions: ' + r.detail.labelPairs.map(p => `"${p[0]}" x "${p[1]}"`).join(', '));
    if (r.detail.labelIcon.length) console.log('  label over icon: ' + r.detail.labelIcon.map(d => `"${d.text}"`).join(', '));
    if (r.detail.iconPairs.length) console.log('  icon blobs: ' + r.detail.iconPairs.map(d => `${d.gap}mm at ${d.at}`).join(', '));
    if (r.detail.inFooter.length) console.log('  under footer: ' + r.detail.inFooter.map(d => `"${d.text}" y=${d.y} (band from ${d.footerTop})`).join(', '));
    if (r.detail.intoPanel.length) console.log('  into panel: ' + r.detail.intoPanel.map(d => `"${d.text}" +${d.over}mm`).join(', '));
    if (r.detail.tiny.length) console.log('  tiny text: ' + r.detail.tiny.map(d => `"${d.text}" ${d.size}mm`).join(', '));
    // The seven added 2026-08-16 (§5.3 print check).
    if (r.detail.unplaced.length) console.log('  DROPPED by the placer: ' + r.detail.unplaced.map(d => `"${d.text}" (${d.reason})`).join(', '));
    if (r.detail.panelOnly.length) console.log('  in the panel, not on the map: ' + r.detail.panelOnly.map(d => `${d.route} ${d.colour}`).join(', '));
    if (r.detail.strandedFeatures.length) console.log('  feature label far from its feature: ' + r.detail.strandedFeatures.map(d => `"${d.label}" ${d.mm === null ? 'no ink of its colour at all' : d.mm + 'mm away'}`).join(', '));
    if (r.detail.clashMap.length) console.log('  hues alike AND running together: ' + r.detail.clashMap.map(d => `${d.a} vs ${d.b} (dE ${d.dE})`).join(', '));
    if (r.detail.clashPanel.length) console.log('  hues alike in the panel: ' + r.detail.clashPanel.map(d => `${d.a} vs ${d.b} (dE ${d.dE})`).join(', '));
    if (r.detail.nearEdge.length) console.log('  inside the print safe margin: ' + r.detail.nearEdge.map(d => `"${d.text}" ${d.mm}mm from the trim`).join(', '));
    // OA-021 built both badge measures REPORTED and gave neither a --detail line,
    // so the board could say 57 and not say WHERE. That is the half a placer fix
    // actually needs: OA-023/OA-024/OA-060 are all "which pass stamped these two".
    if (r.detail.labelOverBadge.length) console.log('  label over a route badge: ' + r.detail.labelOverBadge.map(d => `"${d.text}" on the badge at ${d.at}`).join(', '));
    if (r.detail.lozengeOverlap.length) console.log('  lozenge on a lozenge: ' + r.detail.lozengeOverlap.map(d => `"${d.text}" over "${d.under}" (${d.over[0]}x${d.over[1]}mm)`).join(', '));
    if (r.detail.badgeOverBadge.length) console.log('  badge on a badge: ' + r.detail.badgeOverBadge.map(d => `${d.at} r${d.rad[0]} x ${d.and} r${d.rad[1]} (overlap ${d.over[0]}x${d.over[1]}mm)`).join(', '));
    if (r.share) console.log('  ink share by 9th: ' + r.share.map(s=>(s*100).toFixed(0)+"%").join(" "));
  }
}
if (require.main === module) main();
module.exports = { analyse, parseSvg, textQuad, findSheets, T };
