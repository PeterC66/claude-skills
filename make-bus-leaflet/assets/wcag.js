/*
 * wcag.js — colour luminance, and the three DIFFERENT questions this engine asks
 * with the same three coefficients.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A DEDUPE. Seven sites across five files
 * computed a weighted sum of 0.2126 R + 0.7152 G + 0.0722 B, which is what made
 * them look like seven copies of one function (OA-135, engine N25/N27). They are
 * not. Three questions are being asked:
 *
 *   1. "is this dark enough to be a MARK rather than a backing plate?"
 *      — the raw bytes, weighted, with no gamma decode at all. A brightness
 *        proxy, and every threshold calibrated against it (icons.js sends a fill
 *        to white above 0.75; gen_internal.js calls a stroke ink below 0.62;
 *        quality_metrics.js calls a colour dark below 0.55 and pale above 0.8)
 *        is calibrated against THAT number and no other.
 *   2. "is this legible as INK on white?" — the WCAG relative luminance, which
 *      gamma-decodes each channel first and is the only one of the three from
 *      which a contrast RATIO may honestly be computed. label_placer.js's
 *      inkOnWhite is the sole caller.
 *   3. "how far apart do these two colours LOOK?" — the CIE XYZ->Lab path, for
 *      colour DISTANCE. Luminance alone is no use for it: #CC3311 and #009988
 *      have near-identical luminance and could not look less alike.
 *
 * SO THIS FILE DOES NOT UNIFY THEM, IT NAMES THEM. Every function below is the
 * arithmetic its callers already ran, moved with no change of any kind — same
 * operations, same order, same constants, including the two that differ between
 * the questions and would be invisible in a "tidy-up":
 *
 *   - relLum's gamma knee is 0.03928 and lab's is 0.04045. Those are the two
 *     spellings of the sRGB threshold in the two standards these came from, and
 *     they are kept apart because each site's output is what it is today.
 *   - rawLumBytes and rawLumUnit are the SAME sum with the /255 in a different
 *     place, and they are not the same double. `(0.2126*r + ...)/255` and
 *     `0.2126*(r/255) + ...` agree in exact arithmetic and round differently in
 *     IEEE 754, so the sites that divided at the end and the site that divided
 *     first each keep their own. That is the whole reason there are two.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE. Unifying the three questions onto one
 * formula — i.e. making icons.js and the ink test use the real relative
 * luminance — is a BEHAVIOUR change: it would re-tune which icon plates go white
 * and which sheets clear the quality ratchet. OA-135 is the row that decides it,
 * and it is a separate, gated commit. This one is a pure extraction whose whole
 * claim is that no sheet moved, and it cannot make both claims at once.
 */
'use strict';

/* ---- 1. the raw weighted average of the sRGB bytes: a BRIGHTNESS PROXY ------
 * Not a luminance, and named so nobody reads it as one. No gamma decode. */

/** From 0-255 channels, dividing at the END: gen_internal.js's two ink tests and
 * icons.js's plate test. */
function rawLumBytes(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** From channels ALREADY on 0..1: quality_metrics.js, which divides first. See
 * the header on why this is a second function rather than a call to the first. */
function rawLumUnit(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** From '#rrggbb'. Anything else is 1 — "treat an unknown colour as pale", which
 * is what both gen_internal.js copies did and what keeps a named or shorthand
 * colour from being mistaken for ink. */
function rawLumHex(h) {
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return rawLumBytes((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/* ---- 2. WCAG relative luminance: the only one a CONTRAST RATIO may use ------ */

/** Relative luminance of '#rrggbb', gamma-decoded per WCAG 2.x. The caller
 * guarantees the format; label_placer.js tests it before calling. */
function relLum(hex) {
  const srgb = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const c = [1, 3, 5].map((i) => srgb(parseInt(hex.substr(i, 2), 16) / 255));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/* ---- 3. CIE Lab, for colour DISTANCE ---------------------------------------- */

/** '#rrggbb' -> [L, a, b], D65, the sRGB->XYZ->Lab path. The caller guarantees
 * the format: all three sites test it (or normalise to it) first. */
function lab(h) {
  const srgb = [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116));
  const [r, g, b] = srgb;
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
        Y = 0.2126 * r + 0.7152 * g + 0.0722 * b,
        Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

module.exports = { rawLumBytes, rawLumUnit, rawLumHex, relLum, lab };
