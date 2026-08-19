// Generates the EXTERNAL place map ("Buses from <place> to ...") as SVG.
// AGGREGATED radial: the PLACE is the hub; each spoke is a REACHABLE DESTINATION
// (a town / interchange / village), not a single route. Every route that gets you
// there rides the one spoke as a row of small badges. This is the place skill's
// answer to "where can I get to from here", vs the town skill's one-spoke-per-route
// external map (gen_external_radial.js, on which the drawing primitives are based).
//
// routes.json contract (place skill):
//   place, placeShort?, validFrom, version, palette{route:hex}, textOn{route:hex},
//   operators:[{name,routes[]}], titleColor?,
//   destinations:[{name, sub?, bearing, routes:[...], side?:'up|down|left|right',
//                  terminus?:{x,y}, limited?:bool, minutesToDestination?:num,
//                  stops?:[...intermediate,terminus] (single-route spokes only,
//                  from derive_stops.py)}],
//   localLoops?:[{route,label}], note?, stamp?
const fs = require('fs');
const path = require('path');
const _FOOTER = (()=>{ const local=path.join(__dirname,'footer.js');
  try{ if(fs.existsSync(local)) return local; }catch(e){}
  if (process.env.SKILL_ASSETS) return path.join(process.env.SKILL_ASSETS,'footer.js');
  const sibling = path.join(__dirname,'..','..','make-bus-leaflet','assets','footer.js');
  try{ if(fs.existsSync(sibling)) return sibling; }catch(e){}
  return 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/footer.js'; })();
const { footerBand, footerPlateTop } = require(_FOOTER);
// labeller.js + font_metrics.js — the shared placer and the real Arial metrics, resolved
// the same way footer.js is (sibling first, then SKILL_ASSETS, which is how the portal's
// vendored copy at engine\place\ reaches engine\labeller.js). REQUIRED at load time, as in
// gen_internal.js: a partial vendor must throw here rather than quietly draw a stale sheet.
const _LABELLER = (() => { const local = path.join(__dirname, 'labeller.js');
  try{ if(fs.existsSync(local)) return local; }catch(e){}
  if (process.env.SKILL_ASSETS) return path.join(process.env.SKILL_ASSETS,'labeller.js');
  const sibling = path.join(__dirname,'..','..','make-bus-leaflet','assets','labeller.js');
  try{ if(fs.existsSync(sibling)) return sibling; }catch(e){}
  return 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/labeller.js'; })();
const { Labeller } = require(_LABELLER);
const FONT = require(path.join(path.dirname(_LABELLER), 'font_metrics.js'));
const DIR = process.env.LEAFLET_DIR || process.cwd();
const D = JSON.parse(fs.readFileSync(DIR + '/routes.json', 'utf8'));
const C = D.palette, TXT = D.textOn || {};
const BL = D.badgeLabels || {};
const blab = r => (BL[r] != null ? BL[r] : r);
const OVF = process.env.OVERRIDES_FILE || (DIR + '/overrides.json');
const ALLOV = (function () { try { return JSON.parse(fs.readFileSync(OVF, 'utf8')); } catch (e) { return {}; } })();
const OV = ALLOV.external || {};
const RCOL = ALLOV.routeColors || {};
for (const r in RCOL) C[r] = RCOL[r];
// hiddenOperators (opt-in customer edit, top-level overrides.json array of
// routes.json operators[].name) — drop a hidden operator's routes from every
// destination spoke's badge row (dropping the spoke entirely if that empties
// it) and its legend row. Absent/empty => byte-identical.
const HIDDEN_OPS = new Set(ALLOV.hiddenOperators || []);
const HIDDEN_ROUTES = new Set();
if (HIDDEN_OPS.size) (D.operators || []).forEach(op => { if (HIDDEN_OPS.has(op.name)) (op.routes || []).forEach(r => HIDDEN_ROUTES.add(r)); });
const OPS = HIDDEN_OPS.size ? D.operators.filter(op => !HIDDEN_OPS.has(op.name)) : D.operators;
/* ---- design keys (label-and-design-quality plan, Phase 8 item 3b) -------------
 *
 * Until 2026-08-16 this generator referenced NO design key whatsoever, which is
 * why re-vendoring the engine (item 3) lifted the five place INTERNAL sheets for
 * free — they run through the town's gen_internal.js — and did nothing at all for
 * the five place EXTERNALS. They are the worse half: 29 of the places' 52 defects
 * and the worst rates on the board. So this is a PORT from gen_external_radial.js,
 * not a vendoring step, and the ported keys keep their names and their semantics
 * there so a place and a town mean the same thing by the same key.
 *
 * What the measurement said before any of it was written, because on this project
 * a premise is checked first:
 *
 *   - Every defect on all five sheets is ONE shape. "Butlers Court Road" is
 *     printed three times on Simpson Centre, "St Mary's School" three times on
 *     Waitrose, "The King George V PH" three times on Aldi — each copy then over
 *     route ink and colliding with its own twin. That is Huntingdon's garbled
 *     "Fenstanton" exactly, and it is not a placement problem: two spokes calling
 *     at the same village each label it independently. `labels.engine:"v2"` is
 *     therefore the whole of the fix, and its DEDUPE pass is the half that matters.
 *   - Plus one line on every sheet: the credit 3 mm from the trim (`printSafe`).
 *   - `badgeFit` fixes NOTHING here today — no route key on any of the five places
 *     overflows its badge at either size, so the key is byte-identical even when
 *     it is ON. It is ported anyway because a place draws its TOWN's route keys,
 *     so a place derived from Ramsey (`301S`) or High Wycombe (`WW1`) would
 *     overflow the day it is built. Do not read a flat number as it doing nothing.
 *   - The destination lozenges keep their character-count width (`destNodeSize`),
 *     for the reason gen_external_radial.js keeps `measureNodeWidth`: measured
 *     across all five sheets the tightest line is "High Wycombe" at 1.92 mm a side
 *     and nothing overflows. Changing it would move every lozenge and every badge
 *     offset to fix nothing.
 */
const DESIGN = D.design || {};
const LABELS = D.labels || {};
// G5 (2026-08-17): labels.engine, badgeFit, hubFit, printSafe and scaleBar were
// uniform on all 5 places the day after item 4 shipped, so they are engine
// DEFAULTS now — same escape-hatch convention as gen_internal.js (`false`, or
// `"v1"` for labels.engine). legendPlace is deliberately EXCLUDED: measured
// 2026-08-16 at no better than the search this file already had (0% symbols,
// <=0.1% route ink either way), so it stays opt-in and OFF by default — the
// one key this generator does not share with gen_external_radial.js's default.
const V2 = !(LABELS.engine === 'v1' || LABELS.engine === false);
// printSafe: keep drawn content this many mm from the trim. `false` => today's
// geometry exactly; absent => 5. See footer.js's header for why 5.
const PSAFE = DESIGN.printSafe === false ? null : (DESIGN.printSafe != null ? +DESIGN.printSafe : 5);
const BFIT = DESIGN.badgeFit !== false;
const HUBFIT = DESIGN.hubFit !== false;
const LEGPLACE = !!DESIGN.legendPlace;
const SPRD = DESIGN.spokeSpread ? (DESIGN.spokeSpread === true ? {} : DESIGN.spokeSpread) : null;
const W = 297, H = 210;
// The boxes nothing may be printed over, gathered as the sheet is drawn — the same
// "claim your space before anything is placed" order gen_internal.js uses. Unlike
// gen_external_radial.js these are collected UNCONDITIONALLY rather than only under
// v2, because design.legendPlace searches against them too: gating them on v2 would
// leave a legendPlace-only sheet searching against an empty obstacle set and silently
// parking the panel on a destination. Nothing here is emitted, so it costs a sheet
// that uses neither key nothing at all.
const HARD = [];      // [x0,y0,x1,y1,tag]
const ANCH = [];      // [x,y,id] every tick/lozenge, for the "nearer a foreign symbol" test
const REQS = [];      // queued stop labels (v2 only)
let s = '';
let out = x => { s += x + '\n'; };   // `let`, not `const`: the legend section below
                                      // redirects it into a buffer so its bounding box
                                      // can be measured before the backing panel is drawn.
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function wrap(label, max = 13) {
  if (label.length <= max || label.includes('\n')) return label.split('\n');
  const w = label.split(' '); let a = '', b = '';
  for (const t of w) { if ((a + ' ' + t).trim().length <= max && !b) a = (a + ' ' + t).trim(); else b = (b + ' ' + t).trim(); }
  return b ? [a, b] : [a];
}
// wrapText — generic multi-line word wrap (from gen_external_radial.js), used for the
// free-text note so a long sentence breaks onto further lines instead of running off
// the panel as one unbounded line.
function wrapText(text, maxChars) {
  const words = String(text).split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (cand.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}
// measureText — generous Arial glyph-width estimate (mm), used only to size the auto
// legend backing panel and to pick a word-wrap width; deliberately erring wide so the
// panel never clips its own content.
const measureText = (str, size) => String(str).length * size * 0.58;

// ---- primitives (from gen_external_radial.js) -------------------------------
// dashed (limited-service) spokes use a BUTT cap, not round: a round cap on a dash
// shorter than the stroke width balloons each dash into a near-circle, so the whole
// line reads as a string of blobs rather than a dash (Beaconsfield 380, St Neots 66).
// Butt caps plus a dash length comfortably longer than the stroke width keep each
// dash a crisp rectangle.
// The SAME primitive, with the same numbers, lives in gen_external_busway.js and
// gen_external_radial.js — change one, change all three. This fix was made here on
// 2026-08-06 and NOT propagated back to the two files it was copied from, so the
// defect survived on every area external until St Ives VL14/9v/301o resurfaced it
// on 2026-08-17. See make-bus-leaflet references/gotchas.md.
function line(pts, color, w = 3.4, dashed = false) {
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
  const cap = dashed ? 'butt' : 'round';
  out(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="round"${dashed ? ' stroke-dasharray="2.6 2.4"' : ''}/>`);
}
function tick(x, y, color) { out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.5" fill="#fff" stroke="${color}" stroke-width="1.1"/>`); }
/* design.badgeFit — a route key wider than its disc overflows it. Same defect, same
 * fix and the same measuring rule as gen_external_radial.js: ask font_metrics.js for
 * the real Arial width rather than counting characters, and draw a stadium instead of
 * shrinking the type. The text here is 0.95 x the radius, so the fit test measures at
 * that size. badgeXW returns the EXTRA over the radius — 0 whenever the text fits and
 * 0 always when the key is absent — and every pitch below is written as the old
 * literal plus that extra, so an ungated place stays byte-identical. */
const badgeHalfW = (route, r) => {
  if (!BFIT) return r;
  const w = FONT.textWidth(blab(route), r * 0.95, true);
  return (w <= 2 * r - 0.3) ? r : w / 2 + 0.35 * r;
};
const badgeXW = (route, r) => BFIT ? badgeHalfW(route, r) - r : 0;
const badgeXWs = (list, r) => BFIT ? Math.max(0, ...list.map(k => badgeXW(k, r))) : 0;
function badge(x, y, route, r = 4.0) {
  const hw = badgeHalfW(route, r);
  HARD.push([x - hw - 0.4, y - r - 0.4, x + hw + 0.4, y + r + 0.4, 'badge']);
  if (hw > r) out(`<rect x="${(x - hw).toFixed(2)}" y="${(y - r).toFixed(2)}" width="${(2 * hw).toFixed(2)}" height="${(2 * r).toFixed(2)}" rx="${r}" fill="${C[route] || '#888'}" stroke="#fff" stroke-width="0.7"/>`);
  else out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${C[route] || '#888'}" stroke="#fff" stroke-width="0.7"/>`);
  out(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${(r * 0.95).toFixed(2)}" fill="${TXT[route] || '#fff'}" text-anchor="middle" dominant-baseline="central">${esc(blab(route))}</text>`);
  return hw - r;
}
// destNodeSize — the terminus-box dimensions, factored out of destNode so the legend's
// collision search (below) can know a node's footprint before anything is drawn.
function destNodeSize(label, sub, timeLabel) {
  const lines = wrap(label);
  if (sub) lines.push(sub);
  if (timeLabel) lines.push(timeLabel);
  const w = Math.max(20, Math.max(...lines.map(l => l.length)) * 1.95 + 5);
  const h = 5.4 + lines.length * 3.8;
  return { w, h, lines };
}
/* design.printSafe: a destination lozenge is drawn centred on the end of its spoke, and
 * that end comes from a bearing and a radius that know nothing about the page edge. Nudge
 * the BOX back inside the margin rather than shorten the spoke — the shift is a millimetre
 * or two and the box is at least 20mm wide, so it still covers the line end and still reads
 * as that spoke's terminus. (Same fix as gen_external_radial.js's townNode.) Applied at the
 * CALL SITE, not inside destNode, so the box the legend search is told about and the box
 * that is drawn can never disagree.
 *
 * THE BOTTOM EDGE IS THE FOOTER PLATE, NOT THE PAPER, and the first cut of this got it
 * wrong in the way this project keeps getting it wrong. Clamping to `H - PSAFE` clears
 * 5mm of paper and clears nothing that matters: the plate is opaque and drawn last, so a
 * box can sit legally inside the trim and still have its bottom sliced off. Measured on
 * the shipped sheets, High Wycombe Aldi already had FOUR lozenges reaching 4.74mm under
 * the plate — a defect no measure on the board reports, because `textUnderFooter` looks
 * for TEXT and a lozenge's text sits above its own box bottom. Worse, the scaleBar
 * sentence lengthens the footer note and lifts the plate top 1.6mm, which buried a
 * lozenge on the four sheets that were clear. Adding ink to fix a margin defect creating a
 * margin defect, for the second time in two sessions. So: clamp to whichever bound is
 * higher up the page, and let printSafe FIX Aldi's four rather than preserve them.
 */
function destNodeAt(x, y, size) {
  if (PSAFE == null) return { x, y };
  const bottom = Math.min(H - PSAFE, PLATE_TOP - 0.5);
  return { x: Math.min(Math.max(x, PSAFE + size.w / 2), W - PSAFE - size.w / 2),
           y: Math.min(Math.max(y, PSAFE + size.h / 2), bottom - size.h / 2) };
}
// timeLabel (optional, e.g. "~18 min") — an extra non-bold line appended after
// any `sub` line, fed by routes.json destinations[].minutesToDestination.
// Absent => box drawn exactly as before (byte-identical for gated places).
function destNode(x, y, label, sub, timeLabel) {
  const { w, h, lines } = destNodeSize(label, sub, timeLabel);
  out(`<rect x="${(x - w / 2).toFixed(2)}" y="${(y - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="2.4" fill="#2e8b57" stroke="#1d5f3a" stroke-width="0.5"/>`);
  const lh = 3.8, y0 = y - (lines.length - 1) * lh / 2;
  const lastPlain = lines.length - 1;
  const smallFrom = sub && timeLabel ? lastPlain - 1 : lastPlain; // both sub+time are non-bold small lines
  lines.forEach((ln, i) => out(`<text x="${x.toFixed(2)}" y="${(y0 + i * lh).toFixed(2)}" font-family="Arial" font-weight="${i >= smallFrom && (sub || timeLabel) ? 'normal' : 'bold'}" font-size="${i >= smallFrom && (sub || timeLabel) ? 2.9 : 3.4}" fill="${i >= smallFrom && (sub || timeLabel) ? '#d7f0df' : '#fff'}" text-anchor="middle" dominant-baseline="central">${esc(ln)}</text>`));
  return w;
}

// ---- canvas -----------------------------------------------------------------
out(`<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 ${W} ${H}">`);
out(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
const TITLE_COL = D.titleColor || Object.values(C)[0] || '#444';
out(`<text x="10" y="17" font-family="Arial" font-weight="bold" font-size="11" fill="${TITLE_COL}">Buses from ${esc(D.place)}</text>`);
out(`<text x="10" y="24" font-family="Arial" font-size="5" fill="#444">where you can get to, and which buses take you there (${esc(D.validFrom || 'Summer 2026')})</text>`);

// ---- hub + aggregated spokes ------------------------------------------------
let HX = 150, HY = 118;
if (OV.hub) { HX = OV.hub.x; HY = OV.hub.y; }
const RECT = { x0: 30, y0: 40, x1: 268, y1: 184 };
// Hub box is drawn LAST (on top of the spokes/badges) so it always reads cleanly, but that
// means a long place name's box can grow past the fixed 16mm clear zone and cover the route
// badges parked just outside it — the "bubbles overwritten by the central label" defect. Size
// the hub box up front so the clear zone (and the first badge ring) always sits outside it.
const HUB_LABEL = D.placeShort || D.place;
/* design.hubFit — size the hub box from the text, not from a character count.
 *
 * The legacy width is `measureText(label,4.8) + 8`, i.e. characters x 2.784mm + 8,
 * and measureText is deliberately a GENEROUS estimate (0.58 em/char) written to size
 * a legend panel that must never clip itself. Used as a box width it is simply too
 * big: measured across the five places on 2026-08-16 the padding it leaves runs
 * **5.00mm to 8.47mm a side** — "The Simpson Centre" sits in a 58.11mm box holding
 * 46.67mm of type. Nothing overflows, so unlike the towns' hubs this is not a defect;
 * it is map room being spent on air, and it is spent twice over because HUB_W feeds
 * HUB_A, so every spoke starts further out and every badge row with it.
 *
 * 2.2mm a side, the same padding gen_external_radial.js's hubFit settled on. The 26mm
 * floor stays: the box also carries "you are here" at 2.8 (15.72mm), and the floor is
 * what a short name like "Aldi" is really sized by — so Aldi does not move at all and
 * the four longer names come in 4.3-7.0mm narrower.
 */
const HUB_W = HUBFIT
  ? Math.max(26, FONT.textWidth(HUB_LABEL, 4.8, true) + 4.4, FONT.textWidth('you are here', 2.8, false) + 4.4)
  : Math.max(26, measureText(HUB_LABEL, 4.8) + 8);
const HUB_H = 13;
// hubEdge — the earlier fixed-circle clear zone bound EVERY spoke to the same radius no
// matter its bearing, so a long/thin label (e.g. two-word place names) left visible gaps
// on spokes leaving from top/bottom while barely clearing the label on spokes leaving from
// the sides. Fit an ellipse to the label's actual measured half-width/half-height instead,
// and solve r(theta) = 1/sqrt((cos/a)^2+(sin/b)^2) for the direction each spoke actually
// travels, so every spoke starts just outside the label box regardless of its angle.
const HUB_A = HUB_W / 2 + 3, HUB_B = HUB_H / 2 + 3;
function hubEdge(dx, dy) {
  const denom = Math.sqrt((dx * dx) / (HUB_A * HUB_A) + (dy * dy) / (HUB_B * HUB_B));
  return denom > 0 ? Math.max(16, 1 / denom) : Math.max(16, HUB_A, HUB_B);
}
function rayToRect(dx, dy) {
  let t = 1e9;
  if (dx > 0) t = Math.min(t, (RECT.x1 - HX) / dx); else if (dx < 0) t = Math.min(t, (RECT.x0 - HX) / dx);
  if (dy > 0) t = Math.min(t, (RECT.y1 - HY) / dy); else if (dy < 0) t = Math.min(t, (RECT.y0 - HY) / dy);
  return t;
}
const dests = HIDDEN_ROUTES.size
  ? (D.destinations || []).map(b => Object.assign({}, b, { routes: (b.routes || []).filter(r => !HIDDEN_ROUTES.has(r)) })).filter(b => b.routes.length)
  : (D.destinations || []);
// nodeBoxes — every destination node's + the hub's own footprint, gathered as the spokes
// are laid out, so the legend panel (drawn later) can be placed somewhere that avoids all
// of them instead of risking landing on top of one (see legend section below). spokeSegs —
// each spoke's own line segment, gathered the same way: a panel is free to cross a spoke
// (it's opaque, so a crossing line just gets tidied up, same as gen_external_radial.js),
// but for a busy hub with spokes fanning in every direction that's a secondary concern —
// prefer a placement with zero crossings, and only accept crossings when no clear spot
// exists at all (a spoke line cut off mid-flight by the panel's edge reads worse than one
// discreetly hidden behind it).
/* The footer's own text is built HERE, before a single spoke is laid out, rather than at
 * the footerBand() call at the bottom of the file — because the bottom edge every piece of
 * artwork has to respect is not the paper, it is where the footer PLATE starts, and the
 * plate top depends on how many lines the notes wrap to. gen_internal.js keeps the same two
 * in sync for the same reason: the two disagreeing is how content ends up under the plate.
 */
const _hasTimes = dests.some(b => b.minutesToDestination != null);
// design.scaleBar reaches this sheet as a SENTENCE rather than a device, exactly as it does
// on the town radial. An aggregated radial is a tube map — the spokes are drawn to the frame
// and their length carries nothing — so it can never carry a bar, and it was the one sheet
// type saying nothing at all about that. Kept short on purpose: a note long enough to WRAP
// adds a line to the footer plate, which moves the plate top and refits the whole sheet.
const FOOTER_NOTES = `Reachable destinations & routes serving them, from the UK Bus Open Data Service (Open Government Licence v3.0), cross-checked with operators. Confirm live times & fares at bustimes.org or operator apps.${_hasTimes ? ' Journey times shown are approximate.' : ''}${DESIGN.scaleBar !== false ? ' Diagram — not to scale.' : ''}`;
// design.sheetUrl / design.sheetQr — the printed route back to the current version.
// Hoisted above footerPlateTop because a QR block can push the plate top UP, and every
// free-floating page device below works to PLATE_TOP: deriving the plate without the
// code would place that furniture against a boundary the footer then moves. Same shape
// and same reason as gen_external_radial.js and gen_internal.js — this generator simply
// never got the wiring when the keys landed on 2026-08-18, so the place external sheet
// could not carry the code its town siblings could. Absent both keys every number below
// reduces to the arithmetic that was here before, so ungated places stay byte-identical.
const FOOTER_OPTS = {
  url: DESIGN.sheetUrl || null, qr: DESIGN.sheetQr || null,
  // design.sheetVersion — the PUBLISHED version, printed in the gap the QR left beside
  // the credit line (footer.js). Absent => no row, byte-identical.
  sheetVersion: DESIGN.sheetVersion || null,
  ...(DESIGN.sheetUrlLabel !== undefined ? { urlLabel: DESIGN.sheetUrlLabel } : {}) };
const PLATE_TOP = footerPlateTop({ notes: FOOTER_NOTES, safe: PSAFE, ...FOOTER_OPTS });
// The frame every free-floating page device works to: inside the title block, above the
// footer plate, and never nearer the trim than design.printSafe asks for.
const _SAFE = PSAFE != null ? PSAFE : 0;
const FX0 = Math.max(6, _SAFE), FX1 = Math.min(291, W - _SAFE);
const FY0 = 30, FY1 = Math.min(190, PLATE_TOP - 1);
const nodeBoxes = [{ x0: HX - HUB_W / 2, y0: HY - HUB_H / 2, x1: HX + HUB_W / 2, y1: HY + HUB_H / 2 }];
HARD.push([HX - HUB_W / 2 - 0.6, HY - HUB_H / 2 - 0.6, HX + HUB_W / 2 + 0.6, HY + HUB_H / 2 + 0.6, 'hub']);
const spokeSegs = [];
/* design.spokeSpread — spread the spokes around the hub, ported verbatim in behaviour
 * from gen_external_radial.js (§4.2); its comment carries the full rationale. Short
 * version: an aggregated radial is a tube map — spoke LENGTH already carries nothing —
 * so bearing is the one geographic claim left, and taken literally it wastes the page.
 * Target an even distribution in the spokes' own bearing ORDER, phased by a circular
 * mean so the whole fan rotates rather than re-orders, then clamp each spoke to
 * `maxShift` degrees of its true bearing. The clamp is the honesty control: a spoke can
 * be nudged to the edge of its compass sector but never into the opposite one.
 *
 * Absent the key nothing runs and every sheet is byte-identical. A place with
 * hand-pinned bearings in overrides.json should not turn it on — those are inputs
 * here and would be spread along with the rest.
 */
const norm360 = a => ((a % 360) + 360) % 360;
const BEARINGS = (() => {
  const raw = dests.map(b => { const ov = (OV.branches || {})[b.name] || {};
    return norm360(ov.bearing != null ? ov.bearing : b.bearing); });
  if (!SPRD || raw.length < 2) return raw;
  const maxShift = SPRD.maxShift != null ? SPRD.maxShift : 30;
  const strength = SPRD.strength != null ? SPRD.strength : 1;
  const order = raw.map((_, i) => i).sort((a, b) => raw[a] - raw[b]);
  const step = 360 / order.length;
  let sx = 0, sy = 0;
  order.forEach((idx, k) => { const d = (raw[idx] - k * step) * Math.PI / 180; sx += Math.cos(d); sy += Math.sin(d); });
  const phase = Math.atan2(sy, sx) * 180 / Math.PI;
  const outB = raw.slice();
  order.forEach((idx, k) => {
    const want = ((phase + k * step - raw[idx] + 540) % 360) - 180;   // signed shift wanted
    outB[idx] = norm360(raw[idx] + Math.max(-maxShift, Math.min(maxShift, want * strength)));
  });
  const gaps = order.map((idx, k) => norm360(outB[order[(k + 1) % order.length]] - outB[idx]) || 360);
  process.stderr.write('spokeSpread: ' + order.map((idx) => dests[idx].name + ' ' + raw[idx].toFixed(0) + '->'
    + outB[idx].toFixed(0) + '°').join(', ') + '  (smallest gap ' + Math.min(...gaps).toFixed(0) + '°, '
    + 'max shift ' + Math.max(...outB.map((v, i) => Math.abs(((v - raw[i] + 540) % 360) - 180))).toFixed(0) + '°)\n');
  if (Math.min(...gaps) < 18) process.stderr.write('spokeSpread: two spokes are still under 18° apart '
    + '— the maxShift clamp cannot open them. Merge co-terminating destinations, or raise '
    + 'design.spokeSpread.maxShift.\n');
  return outB;
})();
for (let _i = 0; _i < dests.length; _i++) {
  const b = dests[_i];
  const ov = (OV.branches || {})[b.name] || {};
  const bearing = BEARINGS[_i];
  let a = bearing * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
  let t = rayToRect(dx, dy);
  let tx = HX + dx * t, ty = HY + dy * t;
  if (ov.terminus || b.terminus) { const T = ov.terminus || b.terminus; tx = T.x; ty = T.y; const l = Math.hypot(tx - HX, ty - HY) || 1; dx = (tx - HX) / l; dy = (ty - HY) / l; t = l; }
  const r0 = hubEdge(dx, dy);   // this spoke's own clear-zone edge (ellipse-fitted, not a flat circle)
  // spoke line from hub edge to just short of the destination node
  const nodeGap = 9;
  const ex = HX + dx * (t - nodeGap), ey = HY + dy * (t - nodeGap);
  spokeSegs.push({ x1: HX + dx * r0, y1: HY + dy * r0, x2: ex, y2: ey });
  line([[HX + dx * r0, HY + dy * r0], [ex, ey]], C[b.routes[0]] || '#888', 3.0, b.limited);
  // intermediate-stop ticks (from gen_external_radial.js): only for a SINGLE-route
  // spoke with a b.stops[] chain (derive_stops.py) -- a multi-route spoke has no one
  // unambiguous stop sequence to hang labels off (see file-header comment).
  // Drawn AFTER the spoke line (not before) so the line doesn't paint over the
  // ticks -- matches gen_external_radial.js's order.
  const stops = (b.routes.length === 1 && Array.isArray(b.stops)) ? b.stops : null;
  if (stops && stops.length) {
    const n = stops.length;
    const px = -dy, py = dx;   // unit perpendicular (left of travel)
    let perpx = px, perpy = py;
    const side = b.side;
    if (side === 'up' && perpy > 0) { perpx *= -1; perpy *= -1; }
    if (side === 'down' && perpy < 0) { perpx *= -1; perpy *= -1; }
    if (side === 'left' && perpx > 0) { perpx *= -1; perpy *= -1; }
    if (side === 'right' && perpx < 0) { perpx *= -1; perpy *= -1; }
    const labSide = perpx < 0 ? 'end' : 'start';
    const span = (t - nodeGap) - r0;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n, r = r0 + span * f;
      const x = HX + dx * r, y = HY + dy * r;
      if (i === n - 1) continue;   // last entry is the terminus itself; node drawn separately
      tick(x, y, C[b.routes[0]] || '#888');
      HARD.push([x - 1.9, y - 1.9, x + 1.9, y + 1.9, 'tick']);
      ANCH.push([x, y, 'stop:' + stops[i] + '@' + b.name + '#' + i]);
      if (V2) {
        // labels.engine:"v2" — queue the name instead of printing it at a flat 5.2mm
        // perpendicular offset on a side chosen once for the whole spoke. That flat
        // offset is what put "Butlers Court Road" on this sheet three times, each copy
        // over a route line and two of them overlapping each other. The placer solves
        // all of them together, after the deduplication pass below.
        REQS.push({ id: 'stop:' + stops[i] + '@' + b.name + '#' + i, at: [x, y], text: stops[i], size: 2.9,
                    own: [x - 1.9, y - 1.9, x + 1.9, y + 1.9], prefer: [perpx, perpy] });
        continue;
      }
      const lx = x + perpx * 5.2, ly = y + perpy * 5.2 + 0.9;
      out(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-family="Arial" font-size="2.9" fill="#222" text-anchor="${labSide}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(stops[i])}</text>`);
      // Claim this label's footprint as a hard no-go for the legend panel (below), same as a
      // destination node -- the panel is opaque, so landing on tick-label text makes it
      // unreadable, not just "a line tidied up behind it" (which spokeSegs tolerates).
      const lw = measureText(stops[i], 2.9);
      nodeBoxes.push(labSide === 'end'
        ? { x0: lx - lw, y0: ly - 2.6, x1: lx, y1: ly + 1.0 }
        : { x0: lx, y0: ly - 2.6, x1: lx + lw, y1: ly + 1.0 });
    }
  }
  // route badges: a row along the spoke just outside the hub
  // design.badgeFit: a pill on this spoke is wider than the 6.8mm disc the 7.2mm
  // stacking pitch was sized for. One pitch for the whole row, from the widest extra
  // on THIS spoke, or the badges stop sitting evenly; an ungated spoke adds zero.
  const rs = b.routes;
  const _xw = badgeXWs(rs, 3.4);
  rs.forEach((r, i) => { const rr = r0 + 4 + _xw + i * (7.2 + 2 * _xw); badge(HX + dx * rr, HY + dy * rr, r, 3.4); });
  // destination node
  const _timeLabel = b.minutesToDestination != null ? ('~' + b.minutesToDestination + ' min') : null;
  const _size = destNodeSize(b.name, b.sub, _timeLabel);
  const _at = destNodeAt(tx, ty, _size);
  nodeBoxes.push({ x0: _at.x - _size.w / 2, y0: _at.y - _size.h / 2, x1: _at.x + _size.w / 2, y1: _at.y + _size.h / 2 });
  HARD.push([_at.x - _size.w / 2 - 0.6, _at.y - _size.h / 2 - 0.6, _at.x + _size.w / 2 + 0.6, _at.y + _size.h / 2 + 0.6, 'terminus']);
  ANCH.push([_at.x, _at.y, 'term:' + b.name]);
  destNode(_at.x, _at.y, b.name, b.sub, _timeLabel);
}
// hub node (the place) on top
(function () {
  const w = HUB_W, h = HUB_H;
  out(`<rect x="${(HX - w / 2).toFixed(2)}" y="${(HY - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h}" rx="2.8" fill="#111" stroke="#000" stroke-width="0.5"/>`);
  out(`<text x="${HX}" y="${(HY - 1.2).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="4.8" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(HUB_LABEL)}</text>`);
  out(`<text x="${HX}" y="${(HY + 3.4).toFixed(2)}" font-family="Arial" font-size="2.8" fill="#bbb" text-anchor="middle" dominant-baseline="central">you are here</text>`);
})();

// ---- legend + notes -----------------------------------------------------------
// Auto backing panel (from gen_external_radial.js): the legend + its note is drawn into
// a buffer first so its bounding box can be measured, then an opaque panel is emitted
// UNDER it and both are flushed on top of the spokes — otherwise a spoke that happens to
// pass under the panel's sector shows through and the badges/route lines visually
// collide with the text.
// buildLegend(lx,ly) draws (into a buffer) the operators list + local loops + note at a
// given top-left corner and reports the panel size it needed. The size is independent of
// (lx,ly) — every offset inside is relative — so it can be called once to measure and
// again, after a placement is chosen, to actually draw.
function buildLegend(lx, ly) {
  const buf = [];
  const realOut = out;
  out = x => buf.push(x);
  let panelMaxX = lx, panelMaxY = ly - 4;
  out(`<text x="${lx}" y="${ly - 4}" font-family="Arial" font-weight="bold" font-size="4.4" fill="#222">Operators &amp; services</text>`);
  panelMaxX = Math.max(panelMaxX, lx + measureText('Operators & services', 4.4));
  OPS.forEach((op, i) => {
    const yy = ly + i * 6.6; let bx = lx;
    // design.badgeFit: bx already walks left-to-right, so each badge takes the room it
    // actually needs and the next one starts after it (7.0 = 5.8mm disc + 1.2mm gap).
    op.routes.filter(r => !HIDDEN_ROUTES.has(r)).forEach(r => { const w = badgeXW(r, 2.9); badge(bx + 3 + w, yy, r, 2.9); bx += 7.0 + 2 * w; });
    out(`<text x="${bx + 2}" y="${(yy + 0.2).toFixed(2)}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`);
    panelMaxX = Math.max(panelMaxX, bx + 2 + measureText(op.name, 3.4));
    panelMaxY = Math.max(panelMaxY, yy + 3);
  });
  let ny = ly + OPS.length * 6.6 + 4;
  (D.localLoops || []).forEach(l => {
    const _lw = badgeXW(l.route, 2.9);
    badge(lx + 3 + _lw, ny, l.route, 2.9);
    const _loopLabel = l.label || 'local circular';
    out(`<text x="${lx + 8 + 2 * _lw}" y="${(ny + 0.2).toFixed(2)}" font-family="Arial" font-size="3.0" fill="#666" dominant-baseline="central">${esc(_loopLabel)}</text>`);
    panelMaxX = Math.max(panelMaxX, lx + 8 + 2 * _lw + measureText(_loopLabel, 3.0));
    panelMaxY = Math.max(panelMaxY, ny + 3);
    ny += 6.0;
  });
  // D.note — word-wrapped to the legend panel's own content width, so a long note breaks
  // onto further lines instead of running off the panel as one unbounded line.
  if (D.note) {
    const _panelW = Math.max(panelMaxX - lx, 100);
    const _maxChars = Math.max(20, Math.floor(_panelW / (2.9 * 0.58)));
    const _noteLines = wrapText(D.note, _maxChars);
    _noteLines.forEach((ln, i) => out(`<text x="${lx}" y="${(ny + 2 + i * 3.6).toFixed(2)}" font-family="Arial" font-size="2.9" fill="#666">${esc(ln)}</text>`));
    panelMaxX = Math.max(panelMaxX, lx + Math.max(..._noteLines.map(ln => measureText(ln, 2.9))));
    panelMaxY = Math.max(panelMaxY, ny + 2 + (_noteLines.length - 1) * 3.6 + 2);
  }
  out = realOut;
  return { buf, bw: panelMaxX - lx + 8, bh: panelMaxY - (ly - 10) + 4 };
}
/* ART — the artwork's own claimed boxes, snapshotted BEFORE buildLegend adds any badge
 * boxes of its own, so design.legendPlace never treats the legend's own contents as an
 * obstacle. hardMark is where to rewind HARD to when the legend is rebuilt at a new spot. */
const ART = HARD.slice();
const hardMark = HARD.length;
const { bw, bh } = buildLegend(10, 42);   // measure only; discard this buffer
HARD.length = hardMark;                    // ...and its badge boxes with it
// Placement search: legendAt is an explicit hand-tuned escape hatch (as in
// gen_external_radial.js); absent that, walk a grid and score every candidate that clears
// every destination/hub node (a hard constraint — the panel is opaque, so overlapping a
// node would fully hide it, not just tidy up a crossing spoke) by how many spoke LINES it
// crosses, and keep the lowest-scoring one (ties broken toward the default top-left). A
// spoke is allowed to run under the panel — same as gen_external_radial.js — but for a busy
// hub with spokes fanning in every direction, minimising crossings still matters: a line
// clipped mid-flight by the panel's edge (High Wycombe Aldi, 14 spokes) reads worse than
// one fully hidden behind it.
function overlaps(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
function segRectHit(x1, y1, x2, y2, r) {
  const inside = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  const cross = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  const edges = [[r.x0, r.y0, r.x1, r.y0], [r.x1, r.y0, r.x1, r.y1], [r.x1, r.y1, r.x0, r.y1], [r.x0, r.y1, r.x0, r.y0]];
  return edges.some(([ax, ay, bx, by]) => cross(x1, y1, x2, y2, ax, ay, bx, by));
}
function legendCandidate(lx, ly) {
  const box = { x0: lx - 4, y0: ly - 10, x1: lx - 4 + bw, y1: ly - 10 + bh };
  // design.printSafe tightens the 4mm side inset and the 186 floor to whatever margin
  // the place asks for; absent it these are the literals they always were.
  if (box.x0 < Math.max(4, _SAFE) || box.y0 < 27 || box.x1 > W - Math.max(4, _SAFE) || box.y1 > Math.min(186, FY1)) return null;
  if (nodeBoxes.some(nb => overlaps(box, nb))) return null;
  const crossings = spokeSegs.filter(s => segRectHit(s.x1, s.y1, s.x2, s.y2, box)).length;
  return { lx, ly, crossings };
}
/*
 * design.legendPlace — the two-occupancy blank-space search, ported from
 * gen_external_radial.js. Absent => the legacy search above runs exactly as it always
 * has, byte-identical.
 *
 * WHY, given this generator already searches. The legacy search is honest but it
 * scores the wrong things. It treats `nodeBoxes` as its hard constraint — hub,
 * destination lozenges, tick labels — and **has never known about the route badge rows
 * parked just outside the hub**, which on Aldi is 14 spokes' worth of badges in the
 * busiest part of the sheet. It also tests spoke crossings against straight SEGMENTS
 * rather than the ink actually drawn, and it walks a coarse 10x6 mm grid and stops at
 * the first zero-crossing candidate, so "clear" is whatever that grid happened to land on.
 *
 * The ported search asks the two questions in the right order instead. A lozenge, the
 * hub, a tick or a badge is a NAMED PLACE: cover it and the reader loses a destination
 * with nothing to say it was ever there — so symbols are a HARD constraint, scored off
 * the real HARD boxes. A route line is a stroke: cover a stretch and it is still legible
 * either side — so route ink is what is MINIMISED within that constraint, measured off
 * the ink actually stamped from the SVG. Ties go to the position nearest a frame corner,
 * because a page device belongs at the edge of the sheet. Scoring the two as one
 * weighted number is what parked High Wycombe's town legend on its own hub.
 */
function legendSpot(w, h, wantX, wantY) {
  const pal = new Set(Object.values(C || {}).map(v => String(v).toLowerCase()));
  const inkL = new Labeller({ page: [W, H] });
  inkL.stampSvg(s, (stroke, wd) => pal.has(stroke) && wd >= 1.2);
  const symL = new Labeller({ page: [W, H] });
  for (const b of ART) symL.stampBox(b);
  // Summed-area tables: without them, scoring ~15,000 candidate positions against a
  // large box is hundreds of millions of cell reads; with them every candidate is four.
  const sat = (g) => {
    const nx = g.nx, ny = g.ny, T = new Int32Array((nx + 1) * (ny + 1));
    for (let gy = 0; gy < ny; gy++) {
      let run = 0;
      for (let gx = 0; gx < nx; gx++) { run += g.a[gy * nx + gx] ? 1 : 0; T[(gy + 1) * (nx + 1) + gx + 1] = T[gy * (nx + 1) + gx + 1] + run; }
    }
    return T;
  };
  const clampi = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
  const mk = (g) => {
    const T = sat(g), nx = g.nx, ny = g.ny, cell = g.cell;
    return (x0, y0) => {
      const gx0 = clampi(Math.floor(x0 / cell), 0, nx), gx1 = clampi(Math.ceil((x0 + w) / cell), 0, nx);
      const gy0 = clampi(Math.floor(y0 / cell), 0, ny), gy1 = clampi(Math.ceil((y0 + h) / cell), 0, ny);
      const tot = (gx1 - gx0) * (gy1 - gy0);
      if (tot <= 0) return 1;
      const hit = T[gy1 * (nx + 1) + gx1] - T[gy0 * (nx + 1) + gx1] - T[gy1 * (nx + 1) + gx0] + T[gy0 * (nx + 1) + gx0];
      return hit / tot;
    };
  };
  const inkCover = mk(inkL.ink), symCover = mk(symL.ink);
  const wantSym = symCover(wantX, wantY), wantInk = inkCover(wantX, wantY);
  if (wantSym <= 0 && wantInk <= 0.005) return { moved: false, want: wantInk, wantSym };
  const cnr = [[FX0, FY0], [FX1, FY0], [FX0, FY1], [FX1, FY1]];
  let best = null;
  for (let by = FY0; by <= FY1 - h; by += 1) for (let bx = FX0; bx <= FX1 - w; bx += 1) {
    if (symCover(bx, by) > 0) continue;
    const ink = inkCover(bx, by);
    if (best && ink > best.ink + 1e-9) continue;
    const d = Math.min(...cnr.map(c => Math.hypot(bx - c[0], by - c[1])));
    if (!best || ink < best.ink - 1e-9 || d < best.d - 1e-9) best = { bx, by, ink, d };
  }
  // No clear position => leave the legend where the place put it and say so. A sheet
  // whose legend cannot be placed clear needs a SMALLER legend, not a shuffled one:
  // moving it somewhere equally bad costs the reader the one thing they had, which is
  // knowing where the legend lives from one version to the next.
  if (!best) return { moved: false, want: wantInk, wantSym, nowhere: true };
  if (wantSym <= 0 && best.ink >= wantInk - 1e-9) return { moved: false, want: wantInk, wantSym };
  return { moved: true, want: wantInk, wantSym, cov: best.ink, dx: best.bx - wantX, dy: best.by - wantY };
}
let lx = 10, ly = 42;
if (D.legendAt && (D.legendAt.x != null || D.legendAt.y != null)) {
  if (D.legendAt.x != null) lx = D.legendAt.x;
  if (D.legendAt.y != null) ly = D.legendAt.y;
} else if (LEGPLACE) {
  const got = legendSpot(bw, bh, lx - 4, ly - 10);
  if (got.moved) {
    lx += got.dx; ly += got.dy;
    process.stderr.write('legend: the default spot covers ' + (got.wantSym * 100).toFixed(1)
      + '% symbols / ' + (got.want * 100).toFixed(0) + '% route ink — moved '
      + got.dx.toFixed(0) + ',' + got.dy.toFixed(0) + ' mm to ' + (lx - 4).toFixed(0) + ',' + (ly - 10).toFixed(0)
      + ' (0.0% / ' + (got.cov * 100).toFixed(0) + '%).\n');
  } else if (got.nowhere) {
    process.stderr.write('legend: no position on this sheet leaves a ' + bw.toFixed(0) + 'x' + bh.toFixed(0)
      + ' mm legend clear of every symbol' + (got.wantSym > 0 ? ', and where it sits covers '
      + (got.wantSym * 100).toFixed(1) + '% of them' : '') + '. Left where it is — shrink it, or make room.\n');
  }
} else {
  let best = legendCandidate(lx, ly);
  for (let cy = 42; cy <= 165 && (!best || best.crossings > 0); cy += 6) {
    for (let cx = 10; cx <= 200 && (!best || best.crossings > 0); cx += 10) {
      const cand = legendCandidate(cx, cy);
      if (cand && (!best || cand.crossings < best.crossings)) best = cand;
    }
  }
  if (best) { lx = best.lx; ly = best.ly; }
}
const legend = buildLegend(lx, ly);
HARD.push([lx - 4 - 0.6, ly - 10 - 0.6, lx - 4 + legend.bw + 0.6, ly - 10 + legend.bh + 0.6, 'legend']);
out(`<rect x="${(lx - 4).toFixed(2)}" y="${(ly - 10).toFixed(2)}" width="${legend.bw.toFixed(2)}" height="${legend.bh.toFixed(2)}" rx="2" fill="#ffffff" fill-opacity="0.94" stroke="#ccc" stroke-width="0.4"/>`);
legend.buf.forEach(out);

// ---- labels.engine:"v2" — deduplicate the stop names, then place them all at once ----
if (V2) {
  /*
   * DEDUPLICATION FIRST, because this is not a placement problem.
   *
   * An AGGREGATED radial makes this worse than the town sheet does, and the shipped
   * sheets show it: several spokes leave the same place along the same road, so each
   * one labels the same first few stops independently. Simpson Centre prints "Butlers
   * Court Road" three times, Waitrose "St Mary's School" three times, Aldi "The King
   * George V PH" three times — each copy then over a route line, with two of them
   * overlapping each other and their white haloes eating into each other, which reads
   * as garbled text. No placer can fix that: every copy is correct, and moving them
   * apart just spreads the redundancy. Say it once. The copy kept is the one nearest
   * the hub, so the name sits on the first spoke a reader traces outward.
   */
  const DEDUPE = DESIGN.dedupeStopsMm != null ? DESIGN.dedupeStopsMm : 30;
  // A stop is often an intermediate call on one spoke and the DESTINATION of another.
  // The lozenge is the stronger statement, so it wins and the tick label goes; the tick
  // itself stays, so the fact that the spoke calls there is not lost.
  const kept = ANCH.filter(a => a[2].startsWith('term:')).map(a => ({ text: a[2].slice(5), at: [a[0], a[1]], fixedNode: true }));
  for (const q of REQS.slice().sort((a, b) =>
      (Math.hypot(a.at[0] - HX, a.at[1] - HY) - Math.hypot(b.at[0] - HX, b.at[1] - HY)) || (a.id < b.id ? -1 : 1))) {
    if (kept.some(k => k.text === q.text && Math.hypot(k.at[0] - q.at[0], k.at[1] - q.at[1]) <= DEDUPE)) continue;
    kept.push(q);
  }
  const L = new Labeller({ page: [W, H], frame: { x0: FX0, y0: FY0, x1: FX1, y1: FY1 },
                           bounds: { x0: Math.max(2, _SAFE), y0: 28, x1: Math.min(295, W - _SAFE), y1: FY1 + 1 } });
  const pal = new Set(Object.values(C || {}).map(v => String(v).toLowerCase()));
  L.stampSvg(s, (stroke, w) => pal.has(stroke) && w >= 1.2);
  for (const h of HARD) L.block([h[0], h[1], h[2], h[3]], h[4]);
  L.block([0, 0, 120, 27], 'title');
  L.block([0, PLATE_TOP, W, H], 'footer');
  for (const a of ANCH) L.anchor(a[0], a[1], a[2]);
  // Keep REQS order (spoke order) so the solve is stable across runs.
  for (const q of REQS) if (kept.includes(q)) L.add(q);
  out(L.svg());
  const un = L.unplaced();
  if (un.length) {
    try { fs.writeFileSync(DIR + '/unplaced-external.json', JSON.stringify(un, null, 2)); } catch (e) {}
    process.stderr.write('external labels: ' + un.length + ' unplaced (' + un.map(u => '"' + u.text + '"').join(', ') + ')\n');
  } else { try { fs.unlinkSync(DIR + '/unplaced-external.json'); } catch (e) {} }
  const dropped = REQS.length - (kept.length - ANCH.filter(a => a[2].startsWith('term:')).length);
  if (dropped) console.log('external: ' + dropped + ' duplicate stop label(s) merged');
}

out(footerBand({
  notes: FOOTER_NOTES,
  version: D.version, validFrom: D.validFrom || 'Summer 2026',
  safe: PSAFE,
  ...FOOTER_OPTS
}));

// Optional "coming soon" / validity stamp (shared shape with the town generators).
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
{ const at = (D.stamp && D.stamp.externalAt) || [10, 190]; stampNote(D.stamp, at[0], at[1], 'start'); }

out('</svg>');
fs.writeFileSync(DIR + '/external.svg', s);
console.log('external.svg', s.length, 'bytes;', dests.length, 'destination spokes');
