/*
 * external_primitives.js — the marks the two EXTERNAL sheets are drawn out of.
 *
 * WHY THIS FILE EXISTS. `gen_external_places.js` is not a new tool; it is a
 * reformatted clone of `gen_external_radial.js`. Measured 2026-09-01 (codebase
 * review, satellite F1/F2): the same five section headers in the same order, 60
 * of 83 top-level names shared, and 181 of 631 whitespace-stripped code lines
 * byte-identical — while a raw `diff` shows only 62 of 858 lines in common,
 * because the clone was re-styled with spaces around its operators. So the
 * duplication is INVISIBLE to the tool anyone would reach for, which is the part
 * that makes it dangerous rather than merely untidy.
 *
 * It is dangerous in a way this project has already paid for. `dash_fit.js` was
 * carved out of these same three files on 2026-08-30 because the SAME primitive
 * had been fixed twice in the places copy and neither fix reached the two it was
 * copied from — the second of them printing a 0.0923mm sliver on St Ives'
 * published external for eleven days. Each copy carried a comment saying "change
 * one, change all three". Nothing executes a comment; a require is executed on
 * every build. This module is the rest of that job (OA-224 Tier 3.5).
 *
 * WHERE THE COPIES DIFFERED, which is the interesting half — three places, and
 * each one is a parameter here rather than a silent choice:
 *
 *   badge()      the default radius (4.6 on the town sheet, 4.0 on the place
 *                one) and WHAT REGISTERING A BADGE MEANS. The radial reserves
 *                its box only under the v2 placer; the place external reserves
 *                unconditionally AND records the badge for quality_metrics.js to
 *                measure. Neither is wrong, so `onBadge` is a caller's hook.
 *   hubEdge()    a 14mm FLOOR, present in the radial and absent in the clone.
 *                The clone's own comment explains why it went: a guard written
 *                `Math.max(floor, computed)` is inert whenever the floor is below
 *                everything computed, and nothing about reading the line says so.
 *                It is `floor` here, 14 for the radial and 0 for the place, and 0
 *                is arithmetically the same as not being there.
 *   wrap()       see below. This one was a BUG, not a difference.
 *
 * THE `out` DEPENDENCY IS A FUNCTION CALL, NOT A FUNCTION. Both generators
 * declare `let out` and REDIRECT it part-way through — into a buffer, so the
 * legend's bounding box can be measured before its backing panel is drawn, then
 * back again. A factory that captured the binding's VALUE would go on writing to
 * the original document while the caller believed it was buffering, which moves
 * ink and would look like a placement bug. So the caller passes `x => out(x)`
 * and every mark here resolves the live binding at the moment it draws.
 */
'use strict';
const path = require('path');
const { dashFit, polylineLength } = require(path.join(__dirname, 'dash_fit.js'));
const { esc } = require(path.join(__dirname, 'svg_primitives.js'));

/* Split a label onto at most two lines at a space. TWO NAMES, ON PURPOSE.
 *
 * The three copies did not agree, and the disagreement is a live defect on
 * published artwork (codebase review 2026-09-01, engine F17).
 * `gen_external_busway.js` tested `!b && (a === '' || fits)`; the radial and the
 * place clone tested `fits && !b`. They agree on every label whose FIRST WORD
 * fits, and differ the moment one does not. The busway generator was dropped on
 * 2026-09-02, so the CORRECT spelling is the one no caller is left with:
 *
 *   "Hinchingbrooke", 14 characters, at max 13
 *     busway  -> ['Hinchingbrooke']                one line, drawn where it belongs
 *     radial  -> ['', 'Hinchingbrooke']            an EMPTY first line, and the
 *                                                  name pushed 2mm down its box
 *
 * MEASURED across the whole estate on 2026-09-02, by switching the radial to the
 * busway form and running the byte gate: ONE of the 98 sheet verdicts moved, St
 * Ives' external, and a grep for the empty element `>` `</text>` finds it on
 * exactly three published sheets — St Ives external and both Godmanchester place
 * externals, all three of them the destination "Hinchingbrooke". So it is a real
 * defect, on three live sheets, and it is small.
 *
 * WHICH IS WHY THERE ARE TWO FUNCTIONS AND NOT ONE. Correcting it is a DRAWING
 * change: three sheets move, each needs a version bump, a re-render and a
 * re-verify, and the town one is published. Folding that into an extraction
 * whose whole claim is "nothing moved" would put a fix inside the one commit
 * that cannot be read for one. So the extraction keeps each caller's present
 * behaviour exactly, the wrong behaviour is NAMED rather than defaulted — no
 * caller inherits it by writing `wrap` — and the correction is [OA-229].
 */
function splitTwoLines(label, max, firstWordTakesLineOne) {
  if (label.length <= max || label.includes('\n')) return label.split('\n');
  const w = label.split(' '); let a = '', b = '';
  for (const t of w) {
    const fits = (a + ' ' + t).trim().length <= max;
    if (!b && (fits || (firstWordTakesLineOne && a === ''))) a = (a + ' ' + t).trim();
    else b = (b + ' ' + t).trim();
  }
  return b ? [a, b] : [a];
}

/* The correct one: a first word longer than `max` still takes the first line.
 * gen_external_busway.js was its only caller and was dropped 2026-09-02; see the
 * note on wrapLegacyEmptyFirstLine below for why it stays. */
const wrap = (label, max = 13) => splitTwoLines(label, max, true);

/* The one with the empty first line, kept ONLY so gen_external_radial.js and
 * gen_external_places.js keep drawing what they draw today. Retire it with
 * OA-229; when its last caller goes, delete it and `splitTwoLines`'s flag. */
// NOTHING CALLS `wrap` SINCE 2026-09-02, and that is a statement about the estate
// rather than about this module. It was gen_external_busway.js's wrap -- the only
// correct one of the three -- and that generator was dropped the same day. The
// radial and the place external both take `wrapLegacyEmptyFirstLine`, so the
// empty-first-line defect is now the ONLY wrap behaviour any sheet is drawn with.
// `wrap` stays because it is the answer OA-229 adopts, and its unit test is the
// only thing certifying it: no byte gate can reach code no generator calls.
const wrapLegacyEmptyFirstLine = (label, max = 13) => splitTwoLines(label, max, false);

/* externalPrimitives(deps) -> { line, tick, badgeHalfW, badgeXW, badgeXWs,
 * badge, stampNote }. A factory, not free functions, because six of the seven
 * need the sheet in scope: the document being written, the route palette, the
 * text colour on each fill, the badge-label lookup and the font metrics. */
function externalPrimitives(deps) {
  const {
    out,              // (x) => append one line — a CALL, see the header
    palette: C,       // route key -> fill colour
    textOn: TXT,      // route key -> text colour on that fill
    badgeLabel: blab, // route key -> what is PRINTED in the badge
    font: FONT,       // font_metrics.js, for textWidth()
    badgeFit: BFIT,   // design.badgeFit !== false
    badgeRadius,      // this sheet's default badge radius
    onBadge,          // (x, y, hw, r) => register the box just drawn; see header
  } = deps;

  /* dashed (limited-service) spokes use a BUTT cap, not round. A round cap adds
   * w/2 of ink beyond EACH end of every dash, so at w=3.4 the old `round` plus
   * "1.6 2.2" drew 1.6+3.4 = 5.0mm of ink separated by 2.2-3.4 = -1.2mm of gap:
   * the dashes overlapped into one scalloped caterpillar and the line read as
   * solid-but-lumpy. Butt caps plus a gap comfortably wider than the stroke keep
   * each dash a crisp rectangle. The numbers, and the fit that keeps a spoke from
   * ending in a sliver, are dash_fit.js's (OA-167). */
  function line(pts, color, w = 3.4, dashed = false) {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
    const cap = dashed ? 'butt' : 'round';
    const dash = dashed ? ` stroke-dasharray="${dashFit(polylineLength(pts))}"` : '';
    out(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="round"${dash}/>`);
  }

  function tick(x, y, color) {
    out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.5" fill="#fff" stroke="${color}" stroke-width="1.1"/>`);
  }

  /* design.badgeFit — a route key wider than its disc overflows it. The same
   * defect, fix and measuring rule as gen_internal.js, whose svg_primitives.js
   * carries the full rationale: ask font_metrics.js for the real Arial width
   * rather than counting characters, and draw a stadium instead of shrinking the
   * type. The text on these two sheets is 0.95 x the radius, not the radius, so
   * the fit test measures at that size — which is the one thing that stops this
   * being svg_primitives' badge().
   *
   * badgeXW returns the EXTRA over the radius: 0 whenever the text fits, and 0
   * always when the key is absent. Every pitch in both callers is written as the
   * old literal plus that extra, so an ungated sheet adds a floating zero and
   * stays bit-for-bit identical. */
  const badgeHalfW = (route, r) => {
    if (!BFIT) return r;
    const w = FONT.textWidth(blab(route), r * 0.95, true);
    return (w <= 2 * r - 0.3) ? r : w / 2 + 0.35 * r;
  };
  const badgeXW = (route, r) => BFIT ? badgeHalfW(route, r) - r : 0;
  const badgeXWs = (list, r) => BFIT ? Math.max(0, ...list.map(k => badgeXW(k, r))) : 0;

  function badge(x, y, route, r = badgeRadius) {
    const hw = badgeHalfW(route, r);
    if (onBadge) onBadge(x, y, hw, r);
    if (hw > r) out(`<rect x="${(x - hw).toFixed(2)}" y="${(y - r).toFixed(2)}" width="${(2 * hw).toFixed(2)}" height="${(2 * r).toFixed(2)}" rx="${r}" fill="${C[route] || '#888'}" stroke="#fff" stroke-width="0.7"/>`);
    else out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${C[route] || '#888'}" stroke="#fff" stroke-width="0.7"/>`);
    out(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${(r * 0.95).toFixed(2)}" fill="${TXT[route] || '#fff'}" text-anchor="middle" dominant-baseline="central">${esc(blab(route))}</text>`);
    return hw - r;
  }

  /* Optional "coming soon" / validity stamp, opt-in via routes.json "stamp"
   * {heading?, notes:[...], asOf?, externalAt?:[x,y], internalAt?:[x,y]}. Absent
   * => nothing emitted, which is what keeps an ungated sheet byte-identical.
   * Draw future-dated changes from the upcoming report. */
  function stampNote(cfg, x, y, align) {
    if (!cfg) return;
    const notes = Array.isArray(cfg.notes) ? cfg.notes : (cfg.notes ? [cfg.notes] : []);
    if (!notes.length && !cfg.asOf) return;
    const HS = 3.4, NS = 3.0, AS = 2.6, lh = 3.7, pad = 1.8;
    const rows = []; if (notes.length) rows.push([cfg.heading || 'Coming soon', HS, '#b30000', true]);
    notes.forEach(n => rows.push([n, NS, '#222', false]));
    if (cfg.asOf) rows.push(['Timetable correct as at ' + cfg.asOf, AS, '#666', false]);
    const wmm = Math.max(...rows.map(r => r[0].length * (r[1] * 0.56))) + pad * 2, hmm = pad * 2 + lh * rows.length;
    const bx = align === 'end' ? x - wmm : x, anc = align === 'end' ? 'end' : 'start', tx = align === 'end' ? x - pad : x + pad;
    out(`<rect x="${bx.toFixed(2)}" y="${(y - HS - pad + 0.3).toFixed(2)}" width="${wmm.toFixed(2)}" height="${hmm.toFixed(2)}" rx="1.4" fill="#fff" fill-opacity="0.9" stroke="#b30000" stroke-width="0.4"/>`);
    let cy = y;
    rows.forEach((r, i) => { if (i) cy += lh; out(`<text x="${tx.toFixed(2)}" y="${cy.toFixed(2)}" font-family="Arial"${r[3] ? ' font-weight="bold"' : ''} font-size="${r[1]}" fill="${r[2]}" text-anchor="${anc}">${esc(r[0])}</text>`); });
  }

  return { line, tick, badgeHalfW, badgeXW, badgeXWs, badge, stampNote };
}

/* hubEdgeFor({a, b, floor}) -> hubEdge(dx, dy). Fit an ellipse to the hub
 * label's half-width and half-height and solve r(theta) for each spoke's own
 * bearing, so every spoke starts just outside the label box whatever its angle,
 * instead of all spokes sharing one radius. `floor` is 14 on the town sheet and
 * 0 on the place one; 0 is arithmetically the same as having no floor, which is
 * how one function serves both. */
function hubEdgeFor({ a, b, floor = 0 }) {
  return function hubEdge(dx, dy) {
    const denom = Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
    return denom > 0 ? Math.max(floor, 1 / denom) : Math.max(floor, a, b);
  };
}

/* rayToRectFor({rect, hx, hy}) -> rayToRect(dx, dy), the distance from the hub
 * to the inset frame along a bearing. Identical in both generators; only the
 * rectangle differs, and it is already each sheet's own constant. */
function rayToRectFor({ rect, hx, hy }) {
  return function rayToRect(dx, dy) {
    let t = 1e9;
    if (dx > 0) t = Math.min(t, (rect.x1 - hx) / dx); else if (dx < 0) t = Math.min(t, (rect.x0 - hx) / dx);
    if (dy > 0) t = Math.min(t, (rect.y1 - hy) / dy); else if (dy < 0) t = Math.min(t, (rect.y0 - hy) / dy);
    return t;
  };
}

module.exports = { wrap, wrapLegacyEmptyFirstLine, externalPrimitives, hubEdgeFor, rayToRectFor };
