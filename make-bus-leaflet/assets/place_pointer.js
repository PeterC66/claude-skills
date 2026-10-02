/*
 * place_pointer.js — design.placePointer: a red arrow aimed at a place map's own
 * marker (buses-data OA-509).
 *
 * WHY. On a place's internal sheet the place itself is a 3.4 mm black square with
 * a bold name, and on a busy sheet it is the hardest thing on the page to find:
 * Peter could not spot Ely Co-op's on its own map. He asked for "an extra
 * pointer, perhaps a red arrow". Three candidates were drawn on Ely Co-op's real
 * sheet on 2026-10-01 — an arrow, a ring, and the arrow with "You are here" — and
 * he chose the bare arrow (candidate A). Not the words, because the same picture
 * is on busmaps.uk and in a customer's newsletter, where "You are here" is false;
 * not the ring, because at arm's length it is the weaker signal.
 *
 * THE GLYPH is exactly the one he chose: a #d62728 shaft 0.9 mm wide and a head
 * 3.2 mm long and 3.8 mm across, its tip 2.85 mm from the marker's centre (just
 * clear of the square's corner), the whole thing about 16 mm long, under a white
 * edge so it stays legible where it crosses a route line. The head is a <path>,
 * not a <polygon>, because the portal's SVG allowlist (src/public/svgSanitise.js)
 * has no polygon and the web view would silently drop it.
 *
 * WHERE IT POINTS FROM is the only decision, and it is made in the claim phase,
 * so every badge, road name and point label placed afterwards works round the
 * arrow rather than under it. Sixteen bearings are tried. A bearing whose tail
 * leaves the map frame or reaches the footer is refused outright. The rest are
 * costed at 1 mm steps:
 *
 *   - the HEAD against the marker's own name, as drawn: 10 a step. Not against
 *     the name's reserved box, which is padded 2 mm all round the square, so any
 *     arrow at all would touch it — the first cut tested that box, refused the
 *     upper right on Ely Co-op for clipping it, and came in from the lower left.
 *   - the SHAFT against reserved space (a POI symbol, a map note, the panel): 10
 *     a step; against route ink: 1 a step.
 *   - every symbol within 4 mm of the shaft: 4 each. Its name has not been placed
 *     yet and wants the space round it; on Ely Co-op the lower-left arrow cleared
 *     The Albert's symbol and still pushed its name out onto a leader.
 *   - a turn away from the upper right: up to 3, the price of three steps of
 *     ink. It is the conventional direction for a callout and the one Peter
 *     chose, and the cost of the other bearings cannot see everything: on Ely
 *     Co-op a westward arrow scored 0.25 better than the upper right with a
 *     preference of 1, and the label placer, run afterwards, then moved The
 *     Prince Albert's name off its spot and onto the orange route. Three is still
 *     less than one step on reserved space, so it never buys a collision.
 *
 * Route ink is costed rather than refused because a place often sits ON the
 * route bundle (Ely Co-op does), and then every approach crosses a line; the
 * white edge is what pays for that.
 *
 * DEFAULT ON for a place map — one whose routes.json names a `place` — and off
 * for a town. `design.placePointer:false` turns it off on a place; `true` turns
 * it on for a town's interchange. No marker (a coreBox or an interchange lozenge
 * stands in for it) means no arrow. A town that does not ask is byte-identical.
 *
 * Pure: it reads the SVG drawn so far and the reserved boxes, and returns the
 * markup for the caller to print LAST, on top of everything, so nothing drawn
 * later can paint over it.
 */
'use strict';

const RED = '#d62728';
const TIP = 2.85;          // mm from the marker's centre to the arrow's point
const LEN = 15.95;         // mm from the point to the tail
const HEAD_LEN = 3.2, HEAD_HALF = 1.9, SHAFT = 0.9, EDGE = 0.8;
const BEARINGS = 16;
const PREFER = -Math.PI / 4;   // up and to the right, in page coordinates (y down)
const MARGIN = 2;              // mm the tail keeps from the frame and the footer
const HALF = (SHAFT + EDGE) / 2 + 0.1;   // half-size of each costed box along the shaft
const CROWD = 4;               // mm: a symbol this close to the shaft is crowded by it
const TURN = 3;                // the most a bearing pays for facing away from the upper right

const f2 = (v) => v.toFixed(2);
const hit = (b, o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]);

// Is the pointer on for this sheet? Absent the key, a place map says yes and a town no —
// and so does a place framed by a partner box, a town centre, which the box identifies
// as an area rather than a point (Peter, buses-data OA-549, 2026-10-02).
function pointerOn(design, rj) {
  const v = design ? design.placePointer : undefined;
  if (v === undefined || v === null) return !!(rj && rj.place) && !(design && design.partnerBox);
  return v !== false;
}

// The geometry of one candidate: tip, head base and tail, plus the costed boxes —
// `head` for the steps inside the arrowhead, `shaft` for the rest.
function arrowAt(sq, ang) {
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const at = (d) => [sq[0] + ux * d, sq[1] + uy * d];
  const tip = at(TIP), base = at(TIP + HEAD_LEN), tail = at(TIP + LEN);
  const head = [], shaft = [];
  for (let d = TIP + 0.5; d <= TIP + LEN + 1e-9; d += 1) {
    const p = at(d), hw = d < TIP + HEAD_LEN ? HEAD_HALF * (d - TIP) / HEAD_LEN : HALF;
    (d < TIP + HEAD_LEN ? head : shaft).push([p[0] - hw, p[1] - hw, p[0] + hw, p[1] + hw]);
  }
  return { ang, ux, uy, tip, base, tail, head, shaft };
}

// The markup: a white edge under a red shaft and head.
function arrowSvg(a) {
  const px = -a.uy, py = a.ux;
  const l = [a.base[0] + px * HEAD_HALF, a.base[1] + py * HEAD_HALF];
  const r = [a.base[0] - px * HEAD_HALF, a.base[1] - py * HEAD_HALF];
  const head = `M${f2(a.tip[0])},${f2(a.tip[1])} L${f2(l[0])},${f2(l[1])} L${f2(r[0])},${f2(r[1])} Z`;
  const shaft = `x1="${f2(a.tail[0])}" y1="${f2(a.tail[1])}" x2="${f2(a.base[0])}" y2="${f2(a.base[1])}"`;
  return [
    `<g id="place-pointer">`,
    `<line ${shaft} stroke="#fff" stroke-width="${(SHAFT + EDGE).toFixed(1)}" stroke-linecap="round"/>`,
    `<path d="${head}" fill="#fff" stroke="#fff" stroke-width="${EDGE}" stroke-linejoin="round"/>`,
    `<line ${shaft} stroke="${RED}" stroke-width="${SHAFT}" stroke-linecap="round"/>`,
    `<path d="${head}" fill="${RED}"/>`,
    `</g>`,
  ].join('\n');
}

/*
 * Route ink, read off the SVG drawn so far on the same test gen_internal's
 * autoInk() uses: a route colour, or a stroke both wide and dark. A separate
 * stamp rather than autoInk() itself, because that one is built once and cached,
 * and building it here, before the badges are drawn, would hand the auto feature
 * labels a stale picture of the sheet.
 */
function inkFromSvg(svg, C, rawLumHex, Labeller) {
  const palette = new Set(Object.values(C || {}).map((v) => String(v).toLowerCase()));
  const L = new Labeller({ page: [297, 210] });
  L.stampSvg(svg, (stroke, w) => palette.has(String(stroke).toLowerCase()) || (w >= 1.2 && rawLumHex(stroke) < 0.62));
  return (b) => L.ink.cover(b);
}

// Distance from a point to the segment a-b.
function segDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
}

/*
 * placePointer(deps) -> { svg, bearing, score } | null
 *   on          is the key on for this sheet (pointerOn)
 *   sq          [x, y] the marker's centre, or null when the sheet draws none
 *   nameBox     [x0, y0, x1, y1] the marker's own name as drawn, or null
 *   symbols     [[x, y], ...] every symbol whose name is still to be placed
 *   inkCover    (box) -> fraction of the box on route ink (inkFromSvg)
 *   overlaps    (box) -> does the box touch reserved space
 *   reserve     (x0, y0, x1, y1, tag) claims space for every later placer
 *   frame       { x0, y0, x1, y1 } the map frame
 *   footerTop   y where the footer plate starts
 *   warn        (message) -> void, for the refusal
 */
function placePointer(deps) {
  const { on, sq, nameBox, symbols, inkCover, overlaps, reserve, frame, footerTop, warn } = deps;
  if (!on || !sq) return null;
  const yMax = Math.min(frame.y1, footerTop) - MARGIN;
  const inside = (p) => p[0] >= frame.x0 + MARGIN && p[0] <= frame.x1 - MARGIN && p[1] >= frame.y0 + MARGIN && p[1] <= yMax;
  // The marker's own symbol is not crowded by an arrow aimed at it.
  const others = (symbols || []).filter((s) => Math.hypot(s[0] - sq[0], s[1] - sq[1]) > CROWD);
  let best = null;
  for (let k = 0; k < BEARINGS; k++) {
    const ang = -Math.PI + k * 2 * Math.PI / BEARINGS;
    const a = arrowAt(sq, ang);
    if (!inside(a.tail)) continue;
    let score = 0;
    for (const b of a.head) {
      if (nameBox && hit(b, nameBox)) score += 10;
      else if (inkCover(b) > 0) score += 1;
    }
    for (const b of a.shaft) {
      if (overlaps(b)) score += 10;
      else if (inkCover(b) > 0) score += 1;
    }
    for (const s of others) if (segDist(s, a.base, a.tail) < CROWD) score += 4;
    let turn = Math.abs(ang - PREFER) % (2 * Math.PI);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    score += TURN * turn / Math.PI;                // 0..3: less than one step on reserved space
    if (!best || score < best.score) best = Object.assign(a, { score });
  }
  if (!best) {
    if (warn) warn('placePointer: no bearing keeps the arrow inside the map frame, so the place marker has no pointer on this sheet.');
    return null;
  }
  for (const b of best.shaft) reserve(b[0], b[1], b[2], b[3], 'the place pointer');
  const { tip, base } = best;
  reserve(Math.min(tip[0], base[0]) - HEAD_HALF, Math.min(tip[1], base[1]) - HEAD_HALF,
    Math.max(tip[0], base[0]) + HEAD_HALF, Math.max(tip[1], base[1]) + HEAD_HALF, 'the place pointer');
  return { svg: arrowSvg(best), bearing: Math.round(best.ang * 180 / Math.PI), score: best.score };
}

module.exports = { placePointer, pointerOn, inkFromSvg, arrowAt, arrowSvg, RED };
