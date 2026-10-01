/*
 * run_together.js — which route hues RUN TOGETHER on a drawn sheet.
 *
 * The map venue of quality_metrics.js's colourClashOnMap, and the ONE definition of
 * it. pick_route_colour.js asks the same question when it ranks a hue against the
 * routes "beside" it; it used to answer it by shared road edge instead, and on St
 * Neots (buses-data, 1 Oct 2026) offered #CC3311 for route 112 at dE 53 from
 * everything beside it while colourClashOnMap reported 112 vs 65 at dE 24 running
 * together. Two tests for one question disagree, so now there is one, and it lives
 * here rather than inside the metrics file, whose size the line ratchet holds.
 *
 * Coarse occupancy per hue on a 2 mm grid — route ink only, stroke width 1.2 and
 * up — and a pair runs together when one hue's ink falls within `nearMm` of the
 * other's. Dilation is by a square, so the relation is symmetric. A hue is dilated
 * only when asked about, and then kept. `strokes` is parseSvg()'s list;
 * `isRouteColour(c)` says which stroke colours count as route ink.
 *
 * Zero dependencies (Node core only).
 */
'use strict';

function runTogether(strokes, W, H, isRouteColour, nearMm) {
  const CC = 2, cnx = Math.ceil(W / CC), cny = Math.ceil(H / CC);
  const occ = {};
  for (const s of strokes) {
    if (!isRouteColour(s.stroke) || s.w < 1.2) continue;
    const g = (occ[s.stroke] ||= new Uint8Array(cnx * cny));
    const [p, q] = s.seg;
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / CC));
    for (let i = 0; i <= n; i++) {
      const gx = Math.floor((p[0] + (q[0] - p[0]) * i / n) / CC), gy = Math.floor((p[1] + (q[1] - p[1]) * i / n) / CC);
      if (gx >= 0 && gy >= 0 && gx < cnx && gy < cny) g[gy * cnx + gx] = 1;
    }
  }
  const rad = Math.ceil(nearMm / CC), dil = {};
  const dilated = (c) => {
    if (dil[c]) return dil[c];
    const g = occ[c], d2 = new Uint8Array(cnx * cny);
    for (let y = 0; y < cny; y++) for (let x = 0; x < cnx; x++) {
      if (!g[y * cnx + x]) continue;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const ix = x + dx, iy = y + dy;
        if (ix >= 0 && iy >= 0 && ix < cnx && iy < cny) d2[iy * cnx + ix] = 1;
      }
    }
    return (dil[c] = d2);
  };
  return {
    colours: Object.keys(occ),
    has: (c) => !!occ[c],
    together(a, b) {
      if (!occ[a] || !occ[b] || a === b) return false;
      const A = dilated(a), B = occ[b];
      for (let k = 0; k < B.length; k++) if (B[k] && A[k]) return true;
      return false;
    },
  };
}

module.exports = { runTogether };
