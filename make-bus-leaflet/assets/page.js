/*
 * page.js — the sheet itself: how big it is, and how an SVG for it opens.
 *
 * WHY. Every sheet this engine draws is A4 LANDSCAPE at 300 dpi, and until
 * 2026-09-02 that fact was written out as bare literals in a dozen places:
 * `const W = 297, H = 210` in four generators plus the labeller demo, and
 * `width="3508" height="2480"` in six files (codebase review 2026-09-01, engine
 * F15). None of them has ever disagreed, and that is the whole finding — a
 * number repeated twelve times is not a constant, it is twelve numbers that
 * happen to be equal, and the day one sheet has to be a different size the other
 * eleven look exactly like the ones that were meant to change.
 *
 * THE TWO PAIRS ARE NOT INTERCHANGEABLE, which is why both are here and named:
 *
 *   W, H            millimetres. This is the coordinate system EVERY generator
 *                   draws in — every x, y, radius and font size in this engine
 *                   is a millimetre on the finished sheet, which is what makes
 *                   `quality_metrics.js`'s 2.4mm print-legibility floor a real
 *                   measurement rather than a proxy.
 *   RASTER_W/H      pixels, and ONLY on the root <svg> element. 297mm x 210mm at
 *                   300 dpi is 3507.87 x 2480.31 px, rounded to 3508 x 2480.
 *                   render.js's header explains why they are declared at all:
 *                   sharp rasterises an SVG at its declared pixel size, so
 *                   declaring the print size here is what gets crisp text
 *                   instead of an upscaled 297px-wide bitmap.
 *
 * The rounding means RASTER_W / W is 11.8114 px/mm rather than exactly 300/25.4
 * = 11.81102 -- a third of a pixel across the whole sheet, which is why nothing
 * derives one pair from the other and both are written down.
 *
 * WHAT IS DELIBERATELY NOT HERE. The map FRAME (MX0/MX1/MY0/MY1), the geographic
 * constant 111.32, and the `pad = 0.0006` bbox margin are each repeated three or
 * four times too, and all of them live in `projection.js` and its two drifted
 * copies in diagram_internal.js / schematize_internal.js. Those copies have
 * ALREADY diverged from the module (engine F5: a hardcoded MY1 = 205 where
 * projection.js derives it from the footer plate), so consolidating them is a
 * behaviour change to be gated on its own, not a constants move -- it is Tier 4
 * of the same review. Moving them here would put a fix inside a commit whose
 * whole claim is that nothing moved.
 */
'use strict';

/* The page, in millimetres — the coordinate system every generator draws in. */
const W = 297, H = 210;

/* The page, in pixels, for the root <svg> only: A4 landscape at 300 dpi. */
const RASTER_W = 3508, RASTER_H = 2480;

/* svgOpen() -> the root element, identical on all four sheet types. Written out
 * four times before this, character for character, including the xmlns. */
function svgOpen(w = W, h = H) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RASTER_W}" height="${RASTER_H}" viewBox="0 0 ${w} ${h}">`;
}

module.exports = { W, H, RASTER_W, RASTER_H, svgOpen };
