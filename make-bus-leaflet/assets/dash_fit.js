/*
 * dash_fit.js — the dashed-spoke pattern, and the ONE place it is computed.
 *
 * WHY THIS FILE EXISTS, which is the whole point of it. Three generators drew a
 * dashed line — `gen_external_radial.js`, `gen_external_busway.js` (dropped
 * 2026-09-02) and the place skill's `gen_external_places.js` — and each carried its own
 * copy of the `line()` primitive with the same numbers written out three times.
 * Each copy also carried a comment saying "change one, change all three". That
 * comment was written on 2026-08-06 after the FIRST time a fix to this primitive
 * was made in one copy and not propagated, and it did not work: on 2026-08-29 the
 * dash-fit below was added to the places copy alone (OA-160) and the two it was
 * copied from kept the flat pattern, so St Ives' published external went on
 * printing a 0.0923mm sliver. **Nothing executes a comment.** OA-167 is the row
 * that says so, and this module is its fix: one implementation, one test.
 *
 * ---------------------------------------------------------------------------
 * THE PATTERN
 *
 * A flat `stroke-dasharray="2.6 2.4"` takes no account of the length it is
 * stroking, so wherever the remainder lands inside the ON phase the final dash is
 * truncated -- and where the remainder is a small fraction of a millimetre what
 * paints is a sliver PERPENDICULAR to the spoke, a 1px mark at 300dpi that reads
 * as a stray hairline rather than as the end of a dashed line.
 *
 * MEASURED across every place external's ci-reference on 2026-08-29: 14 dashed
 * spokes, 7 ending cleanly in a gap, 5 in a part-dash long enough to read as
 * intentional, and 2 in a sliver under 0.1mm -- St Neots Town Centre's 66 spoke at
 * 0.066mm and Beaconsfield Simpson Centre's at 0.090mm. RE-MEASURED across the
 * WHOLE estate on 2026-08-29 when the sweep was widened from two-point spokes to
 * multi-point polylines as well: 17 two-point spokes and 34 multi-point polylines,
 * and a third sliver -- St Ives `external.svg`, a 115.09mm dashed polyline ending
 * in a 0.0923mm tail, on a live published town map. The figure quoted as "2 of 14"
 * was 3, and the reason nobody saw the third is that the sweep's population was
 * the file it was looking at.
 *
 * It was invisible because the destination box covered the end of the spoke, which
 * is the fault's real shape: dropping St Neots Town Centre's sub-label on v2.14
 * took that box from 20.6mm tall to 13.0mm and brought 1.29mm of spoke, tail
 * included, out from under it. The <path> was byte-identical across both versions;
 * only the <rect> moved. A defect can be CREATED by one change and REVEALED by a
 * much later, unrelated one, and the second change gets the blame because it is
 * the one in the diff.
 *
 * THE OBVIOUS TARGET IS THE WRONG ONE, and it was tried first: scaling so the line
 * ends exactly on a cycle boundary took the estate's slivers from 2 to SIX. Ending
 * on a boundary is the most fragile place to end, not the safest -- the
 * coordinates are written to 2dp and the dasharray to 3dp, so the length that
 * actually paints differs from the computed one by a few thousandths of a
 * millimetre, and a hair past the boundary is a hair INTO the next dash.
 * Godmanchester Ermine Street came out at a 0.0046mm tail, an order of magnitude
 * finer than the defect being fixed. **Do not re-derive this from the obvious
 * target.**
 *
 * So aim for the MIDDLE OF A GAP instead, which is the point furthest from any
 * ink: end the line a complete dash plus half a gap into its last cycle. In cycle
 * fractions that target is `(ON + OFF/2) / CYCLE` = 0.76, so we want `len` to be
 * `(n + 0.76)` scaled cycles. That leaves 1.2mm of gap on either side of where the
 * line stops -- 260 times the rounding error -- so no representable rounding can
 * put ink at the end of a spoke, and the last dash drawn is always a whole one.
 *
 * Both phases scale by the same factor, so the pattern keeps its 52/48 duty ratio
 * exactly; the factor is within half a cycle spread over the line's whole length.
 *
 * THE 12mm KEY SAMPLE IS NOT A FITTED LINE and deliberately keeps the nominal
 * 2.6/2.4. Each generator draws it inline rather than through `line()`: it is a
 * sample of the pattern, not of a spoke, and its own length was chosen to read as
 * a dashed line rather than as two squares.
 *
 * ---------------------------------------------------------------------------
 * MEASURING IT AFTERWARDS, which is what `tailInk` is for.
 *
 * `dashFit` returns the pattern ROUNDED TO 3dp, because that is what goes into the
 * SVG. The property worth asserting is therefore about the rounded pattern and not
 * about the exact arithmetic -- the first attempt at this fix was correct in exact
 * arithmetic and produced six slivers on the page. `tailInk(len, dash)` answers
 * the question the artwork asks: how much ink is painted in the final, incomplete
 * cycle. Zero means the line ended in a gap, which is what we want; a small
 * positive number is the defect.
 */
'use strict';

/* The nominal 2.6mm on + 2.4mm off, kept as one number because the whole point is
 * to fit a WHOLE number of them into the line being stroked. */
const DASH_ON = 2.6, DASH_OFF = 2.4, DASH_CYCLE = DASH_ON + DASH_OFF;

/* 0.76 — a complete dash plus half a gap into the final cycle. */
const DASH_TARGET = (DASH_ON + DASH_OFF / 2) / DASH_CYCLE;

/* dashFit(len) -> the `stroke-dasharray` value for a line of that length. */
function dashFit(len) {
  const n = Math.max(0, Math.round(len / DASH_CYCLE - DASH_TARGET));
  const k = len / ((n + DASH_TARGET) * DASH_CYCLE);
  return `${(DASH_ON * k).toFixed(3)} ${(DASH_OFF * k).toFixed(3)}`;
}

/* polylineLength(pts) -> the drawn length of an [[x,y],...] polyline, which is
 * what `line()` strokes. Two-point spokes and multi-point polylines are the same
 * case; treating them as different is how the 2026-08-29 sweep missed St Ives. */
function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return len;
}

/* tailInk(len, dash) -> mm of ink painted in the final, incomplete cycle, using
 * the pattern AS EMITTED (rounded to 3dp). 0 means the line ended in a gap. */
function tailInk(len, dash) {
  const [on, off] = String(dash).trim().split(/\s+/).map(Number);
  const cycle = on + off;
  const r = len - Math.floor(len / cycle) * cycle;
  return r < on ? r : 0;
}

/* gapClearance(len, dash) -> mm between the end of the last complete dash and the
 * end of the line, again using the emitted pattern. This is the 1.2mm figure the
 * mid-gap target buys, and it is what makes a rounding error harmless. Returns 0
 * when the line ends inside a dash, which is the defect. */
function gapClearance(len, dash) {
  const [on, off] = String(dash).trim().split(/\s+/).map(Number);
  const cycle = on + off;
  const r = len - Math.floor(len / cycle) * cycle;
  return r < on ? 0 : r - on;
}

module.exports = { DASH_ON, DASH_OFF, DASH_CYCLE, DASH_TARGET, dashFit, polylineLength, tailInk, gapClearance };
