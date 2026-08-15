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
        icons.push({ cx, cy, r: 2.1 * sc });     // icons.js draws within a 4.2mm box
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
        text: DEC(tail), x, y, size: size * scaleOf,
        anchor: a['text-anchor'] || 'start',
        bold: (style['font-weight'] || '') === 'bold',
        central: a['dominant-baseline'] === 'central',
        rot: a.transform && /rotate/.test(a.transform)
          ? (parseFloat(a.transform.match(/rotate\(([-\d.]+)/)[1]) || 0) : 0,
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
      for (const seg of pathSegments(a.d, m)) strokes.push({ seg, w: sw * scaleOf, stroke, clipped: top.clipped });
      continue;
    }
    if (tag === 'line') {
      const p0 = apply(m, +a.x1 || 0, +a.y1 || 0), p1 = apply(m, +a.x2 || 0, +a.y2 || 0);
      strokes.push({ seg: [p0, p1], w: sw * scaleOf, stroke, clipped: top.clipped });
      continue;
    }
    if (tag === 'rect') {
      const x = +a.x || 0, y = +a.y || 0, w = +a.width || 0, h = +a.height || 0;
      const [x0, y0] = apply(m, x, y), [x1, y1] = apply(m, x + w, y + h);
      const r = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1),
                  fill: (style.fill || a.fill || 'none').toLowerCase(), op: parseFloat(a['fill-opacity'] ?? 1) };
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
      circles.push({ cx, cy, r: (+a.r || 0) * scaleOf, fill: (style.fill || a.fill || 'none').toLowerCase() });
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

// ----------------------------------------------------------------- analysing
function analyse(svgPath) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const P = parseSvg(svg);
  const vb = P.vb, W = vb[2], H = vb[3];

  // Route palette: exact hexes from the sheet's own routes.json where present,
  // so "over a route line" is a colour match, not a guess about what a route is.
  let palette = null;
  const rj = path.join(path.dirname(svgPath), 'routes.json');
  if (fs.existsSync(rj)) {
    try { palette = new Set(Object.values(JSON.parse(fs.readFileSync(rj, 'utf8')).palette || {}).map(c => String(c).toLowerCase())); }
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
  const legend = hasPanel ? null : (P.rects.find(r =>
    r.x1 - r.x0 > 30 && r.y1 - r.y0 > 15 && r.y0 < H * 0.5 &&
    (r.x1 - r.x0) * (r.y1 - r.y0) < W * H / 3 && /fff|none|white/.test(r.fill)) || null);

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

  const detail = { overInk: [], labelPairs: [], duplicates: [], iconPairs: [], labelIcon: [], inFooter: [], intoPanel: [], tiny: [] };

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
    if (d < T.duplicateWithinMm) detail.duplicates.push({ text: nameable[i].text.trim(), gap: +d.toFixed(1) });
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
  const F = P.mapFrame || { x0: 0, y0: 0, x1: panelX0, y1: footerTop };
  const cellW = (F.x1 - F.x0) / 3, cellH = (Math.min(F.y1, footerTop) - F.y0) / 3;
  const share = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let n = 0, tot = 0;
    const gx0 = Math.floor((F.x0 + c * cellW - grid.x0) / T.cell), gx1 = Math.floor((F.x0 + (c + 1) * cellW - grid.x0) / T.cell);
    const gy0 = Math.floor((F.y0 + r * cellH - grid.y0) / T.cell), gy1 = Math.floor((F.y0 + (r + 1) * cellH - grid.y0) / T.cell);
    for (let y = gy0; y < gy1 && y < grid.ny; y++) for (let x = gx0; x < gx1 && x < grid.nx; x++) { tot++; if (grid.a[y * grid.nx + x]) n++; }
    share.push(tot ? n / tot : 0);
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

  // SILENT DROPS ARE NOT MEASURABLE FROM THE SVG, and that is itself a finding.
  // placeLabel() returns false and emits nothing (gen_internal.js:662), so a
  // dropped label leaves no trace in the output at all — there is nothing here
  // to count. The obvious proxy, pois.json, does not work either: it is the raw
  // OSM candidate list (categories "Supermarket"/"Sports/Leisure", not the
  // engine's 'shop'/'leisure'), taken BEFORE excludeName/tidy/canon/hide, the
  // core-box test and the off-frame test. Anything absent from the sheet is
  // therefore usually deliberate curation, not a drop, and reporting the
  // difference as a defect count would be a fabricated number.
  //
  // The real count needs the generator to say what it dropped — the unplaced.json
  // report in §1.9 of the plan. Until Phase 2 ships that, this stays honestly
  // unmeasured rather than confidently wrong.

  const m = {
    pointLabelsOverInk: detail.overInk.filter(d => d.kind === 'point').length,
    roadLabelsOverInk: detail.overInk.filter(d => d.kind === 'road').length,
    labelLabelCollisions: detail.labelPairs.length,
    duplicateLabels: detail.duplicates.length,
    labelIconCollisions: detail.labelIcon.length,
    iconBlobs: detail.iconPairs.length,
    textUnderFooter: detail.inFooter.length,
    inkAreaUnderFooterMm2: inkAreaInFooter,
    labelsIntoPanel: hasPanel || legend ? detail.intoPanel.length : null,
    minTextMm: allText.length ? +Math.min(...allText.filter(t => t.size > 0).map(t => t.size)).toFixed(2) : null,
    emptyNinths: emptyCells,
    balance,
    peakInkDensity: +peak.toFixed(2),
    mapLabels: mapLabels.length,
  };
  // One trackable number. Every later phase should drive this down, and the
  // per-100-labels form stops a big town looking worse simply for being big.
  m.defects = m.pointLabelsOverInk + m.labelLabelCollisions + m.labelIconCollisions
    + m.duplicateLabels + m.iconBlobs + m.textUnderFooter + (m.labelsIntoPanel || 0);
  m.defectsPer100 = m.mapLabels ? +(m.defects * 100 / m.mapLabels).toFixed(0) : null;
  const fails = [];
  const warns = [];
  if (m.pointLabelsOverInk > T.labelsOverInkFail) fails.push('point labels over route ink');
  else if (m.pointLabelsOverInk > 0) warns.push('point labels over route ink');
  if (m.labelLabelCollisions > 0) fails.push('labels overlapping');
  if (m.duplicateLabels > 0) fails.push('duplicate labels');
  if (m.labelIconCollisions > 0) fails.push('labels over a foreign icon');
  if (m.iconBlobs > 0) fails.push('icon blobs');
  if (m.textUnderFooter > 0) fails.push('text under footer');
  if (m.labelsIntoPanel > 0) fails.push('labels into panel');
  if (m.minTextMm !== null && m.minTextMm < T.minTextMm) fails.push('text below ' + T.minTextMm + 'mm');
  if (m.inkAreaUnderFooterMm2 > T.footerInkWarnMm2) warns.push('route ink under footer');
  if (m.roadLabelsOverInk > T.roadOverInkWarn) warns.push('road names over route ink');
  if (m.emptyNinths >= T.emptyNinthsWarn) warns.push('whitespace unbalanced');

  return { file: svgPath, metrics: m, fails, warns, detail, share };
}

// --------------------------------------------------------------------- CLI
function findSheets(busesDir) {
  const out = [];
  (function walk(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (e.name.endsWith('.svg') && path.basename(d) === 'ci-reference') out.push(p);
    }
  })(path.join(busesDir, 'Areas'));
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
  if (json) { console.log(JSON.stringify(results.map(r => ({ file: r.file, metrics: r.metrics, fails: r.fails, warns: r.warns })), null, 2)); return; }

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
    ['ftr.mm2', r => r.metrics.inkAreaUnderFooterMm2, 8],
    ['pnl', r => r.metrics.labelsIntoPanel ?? '-', 4],
    ['min', r => r.metrics.minTextMm, 5],
    ['void', r => r.metrics.emptyNinths, 5],
    ['dens', r => r.metrics.peakInkDensity, 5],
    ['DEF', r => r.metrics.defects, 5],
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
  console.log(`totals: ${tot('pointLabelsOverInk')} point labels over route ink · ${tot('roadLabelsOverInk')} road names over route ink · ${tot('labelLabelCollisions')} label collisions · ${tot('duplicateLabels')} duplicate labels · ${tot('labelIconCollisions')} over a foreign icon · ${tot('iconBlobs')} icon blobs · ${tot('textUnderFooter')} text under footer`);

  if (detail) for (const r of results) {
    if (!r.fails.length && !r.warns.length) continue;
    console.log('\n== ' + label(r.file) + '  [' + [...r.fails, ...r.warns].join(', ') + ']');
    if (r.detail.overInk.length) console.log('  over route ink: ' + r.detail.overInk.map(d => `"${d.text}" ${d.cover}%`).join(', '));
    if (r.detail.duplicates.length) console.log('  duplicate labels: ' + r.detail.duplicates.map(d => `"${d.text}" x2 ${d.gap}mm apart`).join(', '));
    if (r.detail.labelPairs.length) console.log('  label collisions: ' + r.detail.labelPairs.map(p => `"${p[0]}" x "${p[1]}"`).join(', '));
    if (r.detail.labelIcon.length) console.log('  label over icon: ' + r.detail.labelIcon.map(d => `"${d.text}"`).join(', '));
    if (r.detail.iconPairs.length) console.log('  icon blobs: ' + r.detail.iconPairs.map(d => `${d.gap}mm at ${d.at}`).join(', '));
    if (r.detail.inFooter.length) console.log('  under footer: ' + r.detail.inFooter.map(d => `"${d.text}" y=${d.y} (band from ${d.footerTop})`).join(', '));
    if (r.detail.intoPanel.length) console.log('  into panel: ' + r.detail.intoPanel.map(d => `"${d.text}" +${d.over}mm`).join(', '));
    if (r.detail.tiny.length) console.log('  tiny text: ' + r.detail.tiny.map(d => `"${d.text}" ${d.size}mm`).join(', '));
    if (r.share) console.log('  ink share by 9th: ' + r.share.map(s=>(s*100).toFixed(0)+"%").join(" "));
  }
}
if (require.main === module) main();
module.exports = { analyse, parseSvg, textQuad, T };
