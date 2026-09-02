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
// Same sibling-then-SKILL_ASSETS resolution as font_metrics above, which is what
// makes it load inside the portal as well as here.
const { separateRow, esc } = require(path.join(path.dirname(_LABELLER), 'svg_primitives.js'));
// external_primitives.js — line, tick, the badge family, stampNote, hubEdge and
// rayToRect, shared with gen_external_radial.js, of which this file is a
// reformatted clone (OA-224 Tier 3.5). Its header records the three places the
// two copies differed and what each of them is a parameter for now. `wrap` is the
// LEGACY one here on purpose: this sheet draws an empty first line for a one-word
// label longer than the wrap width (both Godmanchester externals, Hinchingbrooke
// Hospital), and correcting that moves published artwork. OA-229 is the fix.
const { wrapLegacyEmptyFirstLine: wrap, externalPrimitives, hubEdgeFor, rayToRectFor } =
  require(path.join(path.dirname(_LABELLER), 'external_primitives.js'));
// STRICT_GUARDS, adopted 2026-09-02 (OA-224 Tier 1.4). gen_external_radial.js took the
// contract on 2026-08-28 (OA-045) and this file is that generator's clone, so the one
// refusal site it has -- the howToUse panel below, NOT DRAWN when nowhere is clear --
// wrote to stderr and exited 0, which the portal's publish path never reads. Swept
// before adopting: across the twelve committed place maps nothing here refuses, so
// this starts green. Same resolution as the modules above, so the portal's
// engine/place/ copy reaches engine/strict_guards.js.
const { refuse: guardRefuse, report: reportRefusals } =
  require(path.join(path.dirname(_LABELLER), 'strict_guards.js'));

// ---- main() ---------------------------------------------------------------
// OA-224 Tier 4.1: the body below runs only when this file is RUN, never when it
// is required, so a test can ask whether it LOADS without asking it to draw a
// map. Nothing inside is re-indented -- the diff has to read as "a scope was
// added". Why it was worth a hash move, and the fault that proves it:
// make-bus-leaflet/test/generator_load.test.js.
function main() {
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

// ---- primitives -------------------------------------------------------------
// line, tick, badgeHalfW/XW/XWs, badge and stampNote are make-bus-leaflet's
// external_primitives.js since 2026-09-02 (OA-224 Tier 3.5). They were copied
// from gen_external_radial.js, re-styled, and then fixed independently: the
// 2026-08-06 butt-cap fix and the 2026-08-29 dash-fit were both made HERE and
// neither reached the two files this one was copied from, the second leaving a
// 0.0923mm sliver on St Ives' published town external for eleven days (OA-167).
// dash_fit.js was carved out that day; this is the rest of the same job.
//
// `out` is passed as a CALL, not as the function: the legend section below
// redirects `out` into a buffer and back, and a factory holding the old binding
// would go on writing to the document while this file believed it was buffering.
const { line, tick, badgeHalfW, badgeXW, badgeXWs, badge, stampNote } = externalPrimitives({
  out: (x) => out(x), palette: C, textOn: TXT, badgeLabel: blab, font: FONT,
  badgeFit: BFIT, badgeRadius: 4.0,
  // Registered HERE rather than at the call site, so a badge cannot be drawn
  // without the register hearing about it. Unlike the town radial this is
  // unconditional -- design.legendPlace searches against HARD too, so gating it
  // on v2 would leave a legendPlace-only sheet searching an empty obstacle set.
  // hw/r are the half-extents quality_metrics.js reads back off the finished
  // <circle>/<rect>; the 0.7 white stroke is outside both and is excluded there too.
  onBadge: (x, y, hw, r) => {
    HARD.push([x - hw - 0.4, y - r - 0.4, x + hw + 0.4, y + r + 0.4, 'badge']);
    BADGES.push({ x, y, hw, hh: r });
  },
});
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
/* THE FLOOR THAT CANCELLED THE ELLIPSE (OA-149, fixed 2026-08-29).
 *
 * This function used to end `Math.max(16, 1 / denom)`. `1/denom` is the ellipse's
 * radius in the spoke's own direction and so ranges between HUB_B (9.5) and HUB_A;
 * HUB_A is `HUB_W/2 + 3` and HUB_W has a 26mm floor, so on any place whose hub label
 * fits the minimum box HUB_A is exactly 16 -- the floor and the computation's own
 * MAXIMUM were the same number, and `Math.max` returned the floor for every bearing.
 * Twelve lines of comment above described an ellipse that had not run since some
 * later change moved HUB_W's floor to 26. Measured on the committed board
 * 2026-08-28: five of six places had a constant r0 of 16.00 on every spoke, which is
 * also why OA-060's badge ring came out exactly circular at 19.99-20.00mm.
 *
 * The floor is DELETED rather than re-tuned, because the ellipse already is the
 * clear zone: HUB_A/HUB_B are the hub box's half-width/half-height PLUS 3mm, so
 * every bearing keeps the same 3mm of air the pad was written to give it. A second
 * floor on top of that could only ever spend map room, and on a near-vertical spoke
 * it was spending 6.5mm of it.
 *
 * A guard written `Math.max(floor, computed)` is inert whenever `floor >=
 * max(computed)`, and nothing about reading either line says so -- it needs the two
 * numbers side by side. See "a floor that equals its own ceiling" in the failure
 * shapes list.
 */
// floor 0, not the radial's 14: the clone dropped that guard, and the comment
// above says why. 0 is arithmetically the same as having no floor.
const hubEdge = hubEdgeFor({ a: HUB_A, b: HUB_B, floor: 0 });
const rayToRect = rayToRectFor({ rect: RECT, hx: HX, hy: HY });
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
  url: DESIGN.sheetUrl || null, qr: DESIGN.sheetQr === false ? null : (DESIGN.sheetQr || { mm: 14 }),
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
/* EVERY SPOKE'S BADGE ROW STARTED AT THE SAME RADIUS, AND NO ROW KNEW ABOUT ANY OTHER.
 *
 * A badge row is drawn along its own spoke at `r0 + 4 + xw` from the hub, and `r0` is
 * hubEdge(), which carries a `Math.max(16, ...)` floor. On five of the six place maps
 * the hub box is 26mm wide, so HUB_A is exactly 16 and the ellipse can never return
 * more than its own floor -- so r0 is 16 on every bearing and the first badge of every
 * spoke lands on one perfect ring. Measured on the committed sheets 2026-08-28: r =
 * 19.99-20.00mm, on all four affected maps, with 14 of High Wycombe Aldi's spokes
 * sitting on it.
 *
 * Bearings, meanwhile, are REAL -- they are a geographic claim and are not spread out
 * unless design.spokeSpread says so, which no place map sets. So two destinations that
 * happen to lie in similar directions get their badges 3mm apart on a shared ring, and
 * nothing anywhere tested for it: 17 of the board's 30 badge overprints were this, in
 * one chain of 9 around High Wycombe Aldi's hub.
 *
 * The fix is the one OA-023 used on the internal sheet's terminus badges and the one
 * OA-147 prescribes: ONE register that every badge pass tests against, so no mark is
 * ever placed in ignorance of what is already on the page. Here the free variable is
 * how far OUT along its own spoke a row starts, and pushing outward always helps --
 * two spokes theta apart are 2*r*sin(theta/2) apart at radius r, which is monotonic in
 * r -- so a greedy walk outward terminates on geometry rather than on a step count.
 *
 * A BOX TEST, NOT A RADIAL ONE, and the tolerance is quality_metrics.js's own, so the
 * generator and the measure cannot disagree about what an overprint is. OA-021 paid
 * for that lesson in one direction (a radial test on a stadium INVENTED nine defects
 * on High Wycombe internal) and OA-023 in the other (two discs at dx=dy=5.0 are 7.07mm
 * apart and overlap on both axes).
 */
const BADGE_CLEAR = 0.6;      // quality_metrics.js T.badgeOverlapMm
const BADGES = [];            // {x,y,hw,hh} every badge already committed to the page
/* The SAME arithmetic quality_metrics.js scores with, deliberately duplicated rather
 * than approximated. A badge is a stadium -- a disc when its key is narrow, a rect with
 * rx=r when design.badgeFit widens it -- so the exact gap between two of them is the gap
 * between their straight cores less the two corner radii. A plain box test on both axes
 * is WRONG here and was wrong in the measure until 2026-08-28: two discs of r=3.4 whose
 * centres are 7.22mm apart have 0.42mm of daylight and overlapping bounding boxes, which
 * is what a badge row looks like on any diagonal spoke. Seventeen of the thirty overprints
 * the board reported that morning were that, and none of them was a defect. */
const badgeGap = (a, b) => {
  const ax0 = a.x - (a.hw - a.hh), ax1 = a.x + (a.hw - a.hh);
  const bx0 = b.x - (b.hw - b.hh), bx1 = b.x + (b.hw - b.hh);
  return Math.hypot(Math.max(0, ax0 - bx1, bx0 - ax1), a.y - b.y) - (a.hh + b.hh);
};
const badgeClash = (x, y, hw, hh) => BADGES.some(g => -badgeGap(g, { x, y, hw, hh }) > BADGE_CLEAR);
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
/* WHERE EVERY DESTINATION BOX ENDS UP, SOLVED BEFORE ANY OF THEM IS DRAWN.
 *
 * destNodeAt() clamps one box to the print margin and the footer plate, and it is
 * the only rule there has ever been. It is a per-object rule, and two boxes landing
 * on each other is a relationship between objects, so it cannot see the defect no
 * matter how carefully it is written: two spokes that both end low are both pushed
 * up to the same line above the plate, and there they sit on top of one another.
 * On the committed board that is High Wycombe Aldi burying "Bourne End &
 * Maidenhead" under "Windsor Parish Church" by 6.58 x 13.70mm.
 *
 * So the boxes are placed as a SET, in a pass of their own, and the loop below
 * reads the answer instead of computing it. Boxes that share a horizontal band are
 * separated along x -- the axis the frame edge leaves free, and the one OA-060
 * asks for -- and a band of one is returned exactly where the clamp put it, which
 * is what keeps every uncollided sheet byte-identical.
 */
const DEST_AT = (() => {
  const boxes = dests.map((b, i) => {
    const ov = (OV.branches || {})[b.name] || {};
    const a = BEARINGS[i] * Math.PI / 180;
    let dx = Math.sin(a), dy = -Math.cos(a);
    let t = rayToRect(dx, dy);
    let tx = HX + dx * t, ty = HY + dy * t;
    if (ov.terminus || b.terminus) { const T = ov.terminus || b.terminus; tx = T.x; ty = T.y; }
    const size = destNodeSize(b.name, b.sub, b.minutesToDestination != null ? ('~' + b.minutesToDestination + ' min') : null);
    const at = destNodeAt(tx, ty, size);
    return { x: at.x, y: at.y, w: size.w, h: size.h };
  });
  // Band membership is a y-overlap deeper than the tolerance the measure scores by,
  // so the generator and quality_metrics.js cannot disagree about which pairs are a
  // problem. Single-link, in index order, so the grouping is deterministic.
  const TOL = 0.6;
  const band = boxes.map(() => -1);
  let nb = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (band[i] < 0) band[i] = nb++;
    for (let j = i + 1; j < boxes.length; j++) {
      const oy = Math.min(boxes[i].y + boxes[i].h / 2, boxes[j].y + boxes[j].h / 2)
               - Math.max(boxes[i].y - boxes[i].h / 2, boxes[j].y - boxes[j].h / 2);
      if (oy > TOL) { if (band[j] < 0) band[j] = band[i]; else { const from = band[j], to = band[i];
        for (let k = 0; k < boxes.length; k++) if (band[k] === from) band[k] = to; } }
    }
  }
  const lo = (PSAFE != null ? PSAFE : 0), hi = W - (PSAFE != null ? PSAFE : 0);
  for (let g = 0; g < nb; g++) {
    const idx = boxes.map((_, i) => i).filter(i => band[i] === g);
    if (idx.length < 2) continue;
    const r = separateRow(idx.map(i => ({ c: boxes[i].x, hw: boxes[i].w / 2 })), lo, hi, 1);
    idx.forEach((i, k) => { boxes[i].x = r.centres[k]; });
    if (!r.fits) console.error('destination boxes on one line are wider than the page: '
      + idx.map(i => dests[i].name).join(', ') + ' -- shorten a label or merge two destinations.');
  }
  return boxes.map(b => ({ x: b.x, y: b.y }));
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
  const _pitch = 7.2 + 2 * _xw;
  const _hw = rs.map(r => badgeHalfW(r, 3.4));
  // Walk the WHOLE row outward together, not badge by badge: the row is a single
  // object reading left to right along its spoke, and staggering its members would
  // break the reading order to fix a collision with a different spoke entirely.
  //
  // The cap is the destination lozenge. Pushing past it would hide the badges under
  // the box that is drawn on top of them afterwards -- ink off the page beats ink
  // absent, but ink UNDER an opaque box is neither, it is a route identity silently
  // deleted. If the row cannot clear inside the cap the badges stay where they were
  // and the sheet says so, rather than the generator quietly making it worse.
  let _rr0 = r0 + 4 + _xw;
  const _rowClash = (base) => rs.some((_, i) => badgeClash(HX + dx * (base + i * _pitch),
    HY + dy * (base + i * _pitch), _hw[i], 3.4));
  const _cap = (t - nodeGap) - (rs.length - 1) * _pitch - _xw - 3.4;
  const _want = _rr0;
  while (_rr0 <= _cap && _rowClash(_rr0)) _rr0 += 0.2;
  if (_rr0 > _cap) {
    // Could not clear. Two spokes this close in bearing want MERGING into one
    // destination or opening with design.spokeSpread -- neither is something a
    // generator may decide for itself, so it reports and draws as before.
    console.error('badge row on "' + b.name + '" cannot clear its neighbours '
      + 'inside this spoke (' + (_cap - _want).toFixed(1) + 'mm of travel available): '
      + 'two spokes are too close in bearing. Merge the destinations, or set '
      + 'design.spokeSpread.');
    _rr0 = _want;
  }
  rs.forEach((r, i) => { const rr = _rr0 + i * _pitch; badge(HX + dx * rr, HY + dy * rr, r, 3.4); });
  // destination node
  const _timeLabel = b.minutesToDestination != null ? ('~' + b.minutesToDestination + ' min') : null;
  const _size = destNodeSize(b.name, b.sub, _timeLabel);
  const _at = DEST_AT[_i];      // solved as a set above; see DEST_AT for why
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
/*
 * design.limitedKeyLabel — the words the DASHED spokes get in the line-style key.
 *
 * This sheet has drawn `limited: true` destinations dashed since its first build and
 * said nowhere what dashed means. The TOWN external gained the row on 2026-08-19 for
 * exactly that reason and this generator never got it, so every place external with a
 * limited destination was showing an unexplained convention — St Neots Town Centre's
 * "Huntingdon / St Ives dir" spoke among them (OA-055).
 *
 * Same default string as gen_external_radial.js and the same override key, so the town
 * sheet and the place sheet of one map explain the same thing in the same words. Both
 * match gen_internal.js's FTIER_LABEL.limited.
 */
const LIMITED_KEY = DESIGN.limitedKeyLabel || 'Dashed \u2014 certain days only, check times';
// Auto backing panel (from gen_external_radial.js): the legend + its note is drawn into
// a buffer first so its bounding box can be measured, then an opaque panel is emitted
// UNDER it and both are flushed on top of the spokes — otherwise a spoke that happens to
// pass under the panel's sector shows through and the badges/route lines visually
// collide with the text.
// buildLegend(lx,ly) draws (into a buffer) the operators list + local loops + note at a
// given top-left corner and reports the panel size it needed. The size is independent of
// (lx,ly) — every offset inside is relative — so it can be called once to measure and
// again, after a placement is chosen, to actually draw.
/* panelText — the legend panel's own width measure (OA-061, fixed 2026-08-29).
 *
 * Every `panelMaxX` line below used to call `measureText`, the characters x size x
 * 0.58 estimate, while `font_metrics.js` -- real Arial advances -- was already
 * required in this file and already used for `hubFit` and `badgeFit`. The legend
 * panel never got it. Measured on all NINE shipped panels 2026-08-29, the panel
 * claimed 7.6-21.3mm more than its widest line actually needs; 8mm of that is the
 * intended padding in `bw` below, so what real metrics recover is 8-13mm on the eight
 * whose longest line is prose, and nothing at all on High Wycombe Aldi, whose long
 * note already fills the panel.
 *
 * `measureText` STAYS, and is still the right tool where it is still called: it is a
 * deliberately generous estimate, and picking a word-wrap character count (below) is
 * exactly the job an estimate erring wide should keep. What it was wrong for was
 * sizing a box around type that has already been laid out.
 *
 * NOTE THE POPULATION. The 2026-08-29 measurement that sized this said "six place
 * externals carry a ci-reference" and tabulated six. There are NINE: it globbed
 * `Areas/*'/'Places/` and never looked in `Places/_standalone/`, where Ely Co-op and
 * both Godmanchester Co-ops live. Walk for the fixtures, do not glob for them.
 */
const panelText = (str, size, bold) => FONT.textWidth(str, size, !!bold);
function buildLegend(lx, ly) {
  const buf = [];
  const realOut = out;
  out = x => buf.push(x);
  let panelMaxX = lx, panelMaxY = ly - 4;
  out(`<text x="${lx}" y="${ly - 4}" font-family="Arial" font-weight="bold" font-size="4.4" fill="#222">Operators &amp; services</text>`);
  panelMaxX = Math.max(panelMaxX, lx + panelText('Operators & services', 4.4, true));
  OPS.forEach((op, i) => {
    const yy = ly + i * 6.6; let bx = lx;
    // design.badgeFit: bx already walks left-to-right, so each badge takes the room it
    // actually needs and the next one starts after it (7.0 = 5.8mm disc + 1.2mm gap).
    op.routes.filter(r => !HIDDEN_ROUTES.has(r)).forEach(r => { const w = badgeXW(r, 2.9); badge(bx + 3 + w, yy, r, 2.9); bx += 7.0 + 2 * w; });
    out(`<text x="${bx + 2}" y="${(yy + 0.2).toFixed(2)}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`);
    panelMaxX = Math.max(panelMaxX, bx + 2 + panelText(op.name, 3.4));
    panelMaxY = Math.max(panelMaxY, yy + 3);
  });
  let ny = ly + OPS.length * 6.6 + 4;
  (D.localLoops || []).forEach(l => {
    const _lw = badgeXW(l.route, 2.9);
    badge(lx + 3 + _lw, ny, l.route, 2.9);
    const _loopLabel = l.label || 'local circular';
    out(`<text x="${lx + 8 + 2 * _lw}" y="${(ny + 0.2).toFixed(2)}" font-family="Arial" font-size="3.0" fill="#666" dominant-baseline="central">${esc(_loopLabel)}</text>`);
    panelMaxX = Math.max(panelMaxX, lx + 8 + 2 * _lw + panelText(_loopLabel, 3.0));
    panelMaxY = Math.max(panelMaxY, ny + 3);
    ny += 6.0;
  });
  /*
   * The line-style key row — drawn only when a dashed spoke is actually on this sheet.
   *
   * The sample is 12mm of the real thing: same stroke width, same dash array and the same
   * butt cap the spokes use (see `line()` above), so what the key shows and what the map
   * draws cannot drift apart. Ported from gen_external_radial.js including the 12mm, which
   * is not arbitrary — at 6mm the 2.6/2.4 pattern fits two blocks and one gap and reads as
   * a pair of squares rather than as a dashed line, which is the one thing the row exists
   * to communicate.
   *
   * It sits after the local loops and before the free-text note, which is the same place
   * in the reading order the town sheet puts it: line styles belong with the other things
   * the reader has to decode, above prose.
   */
  if (dests.some(b => b.limited && b.routes.some(r => !HIDDEN_ROUTES.has(r)))) {
    out(`<path d="M${lx.toFixed(2)} ${ny.toFixed(2)}h12.00" fill="none" stroke="#888" stroke-width="3.4" stroke-dasharray="2.6 2.4" stroke-linecap="butt"/>`);
    out(`<text x="${(lx + 14).toFixed(2)}" y="${(ny + 0.2).toFixed(2)}" font-family="Arial" font-size="2.9" fill="#666" dominant-baseline="central">${esc(LIMITED_KEY)}</text>`);
    panelMaxX = Math.max(panelMaxX, lx + 14 + panelText(LIMITED_KEY, 2.9));
    panelMaxY = Math.max(panelMaxY, ny + 3);
    ny += 6.0;
  }
  // D.note — word-wrapped to the legend panel's own content width, so a long note breaks
  // onto further lines instead of running off the panel as one unbounded line.
  if (D.note) {
    const _panelW = Math.max(panelMaxX - lx, 100);
    const _maxChars = Math.max(20, Math.floor(_panelW / (2.9 * 0.58)));
    const _noteLines = wrapText(D.note, _maxChars);
    _noteLines.forEach((ln, i) => out(`<text x="${lx}" y="${(ny + 2 + i * 3.6).toFixed(2)}" font-family="Arial" font-size="2.9" fill="#666">${esc(ln)}</text>`));
    panelMaxX = Math.max(panelMaxX, lx + Math.max(..._noteLines.map(ln => panelText(ln, 2.9))));
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

/* ---- design.howToUse: the "how to read this" panel (OA-056, built 2026-08-29) ----
 *
 * WHY THIS SHEET NEEDS IT MORE THAN THE TOWN'S, not less. The argument in
 * gen_external_radial.js is that a hub-and-spoke diagram is an unfamiliar FORM to
 * most people and that sheet is nothing but one. A place external is MORE of one: its
 * spokes are aggregated DESTINATIONS rather than routes, which is a second unfamiliar
 * idea on the same sheet, and the badges along a spoke are the buses that take you
 * there rather than the line you are following.
 *
 * THE ROW THAT ASKED FOR THIS ARGUED THE OPPOSITE FOR FIVE DAYS. OA-056 used to read
 * "five of the eight TOWN externals decline the panel rather than bury a destination,
 * so a place ... may well not want it either". Measured 2026-08-28 against every
 * town's latest S3: all eight carry `design.howToUse`, none declines it, and the
 * panel has been ON BY DEFAULT in the radial since 2026-08-24 precisely because all
 * eight had opted in. Nothing declines it and nothing ever did. Re-measure a row's
 * headline claim before acting on it.
 *
 * ON BY DEFAULT here too, for the same reason and by the same rule -- and `false`
 * refuses it. The words derive from the map's own data (invariant 1): the hub
 * sentence names whatever this place is called, the journey-time bullet appears only
 * where `minutesToDestination` exists, and the not-to-scale bullet only when the
 * footer is not already saying it. Nothing new has to be authored per place.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM THE TOWN'S, AND IT WAS MEASURED RATHER THAN
 * CHOSEN. The first cut derived the radial's five-to-seven bullets, conditioning two
 * of them on `minutesToDestination` and on tick labels being drawn. Swept across all
 * nine shipped place externals on 2026-08-29, that panel came out 99 x 49mm and
 * legendSpot could not place it on SIX of the nine -- Beaconsfield Simpson Centre,
 * Beaconsfield Waitrose, High Wycombe Aldi, Ely Co-op and both Godmanchester Co-ops
 * all declined it rather than cover a destination.
 *
 * NARROWING THE COLUMN IS THE WRONG LEVER AND THE SWEEP SAYS SO. Widths 92/84/76/68/
 * 60/52mm placed on 3/2/1/3/5/6 sheets -- NOT MONOTONIC, because a narrower column
 * wraps into more lines and the panel gets TALLER, and it is a page device's HEIGHT
 * that collides on a sheet whose spokes fan out horizontally. The radial's own
 * comment records learning this in the other direction.
 *
 * THE LEVER IS THE BULLET COUNT. At the full 92mm: four bullets place on 3 of 9,
 * THREE place on 9 OF 9, two add nothing further. So the default here is three.
 *
 * AND THAT IS THE SAME ANSWER THE TOWNS REACHED INDEPENDENTLY. All eight town
 * externals pin `bullets` to a hand-picked three of the five the radial derives
 * (OA-054), which had been read as eight separate local decisions. It is one general
 * fact about this sheet family, arrived at twice by different routes.
 *
 * THE CONDITIONALS ARE GONE, not defaulted around. `minutesToDestination` is present
 * on all nine and a tick label is drawn on all nine, so `_hasTimes` and its sibling
 * were not discriminating between sheets -- they were constants wearing a condition,
 * and each of them added a bullet that cost six sheets their panel. A branch no
 * fixture can take the other way is a dark branch whether or not it is written as an
 * `if`. `bullets` still overrides the lot for a place that wants its own words, which
 * is where per-place content belongs.
 */
const HOWTO = DESIGN.howToUse === false ? null
  : (DESIGN.howToUse == null || DESIGN.howToUse === true ? {} : DESIGN.howToUse);
if (HOWTO) {
  const HEAD = HOWTO.heading !== undefined ? HOWTO.heading : 'How to use this map';
  // HUB_LABEL carries a newline where the hub BOX wants to break. In a sentence that
  // is just whitespace, and it also makes one un-splittable token the wrapper chokes on.
  const HUB_PROSE = String(HUB_LABEL).replace(/\s+/g, ' ').trim();
  // THREE, and see the header: three place on all nine sheets and four on three of
  // them. They are the reading procedure end to end — where to look, what to follow,
  // what the badge on it means — and the third is worded for an AGGREGATED sheet,
  // where a badge is the bus that takes you there rather than the line you are on.
  const BULLETS = (Array.isArray(HOWTO.bullets) && HOWTO.bullets.length) ? HOWTO.bullets : [
    'Find where you want to go, around the edge of the diagram.',
    `Follow its coloured line in to ${HUB_PROSE} at the centre.`,
    'The badges on that line are the buses that go there.',
  ];
  const HS = HOWTO.headingSize != null ? +HOWTO.headingSize : 4.4;   // matches the legend header
  const BS = HOWTO.size != null ? +HOWTO.size : 3.2;                 // style-guide floor for body type
  // WIDE AND SHORT, for the reason the radial records: it is a page device's HEIGHT
  // that collides, because the spokes fan out horizontally. 92mm puts most bullets on
  // one line. buildLegend's note wrap learned the same thing on 2026-08-06.
  const CW = HOWTO.width != null ? +HOWTO.width : 92;                // content column, mm
  const PAD = 3.4, LH = BS * 1.28, GAP = 1.3, IND = 2.9;
  // Width-based wrap on the real Arial advances, not wrapText()'s character count — a
  // bullet is a whole sentence and the 0.58 estimate is ~11% out on ordinary prose,
  // which is the difference between four lines and five.
  const wrapW = (text, maxMm) => {
    const words = String(text).split(' '), lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && FONT.textWidth(t, BS, false) > maxMm) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const WRAPPED = BULLETS.map(t => wrapW(t, CW - IND));
  const bodyH = WRAPPED.reduce((a, ls) => a + ls.length * LH + GAP, 0) - GAP;
  const PW = CW + PAD * 2;
  const PH = PAD + (HEAD ? HS * 1.15 + 1.6 : 0) + bodyH + PAD;
  // Content is a pure function of (px,py), like buildLegend — which is what makes
  // building it twice safe when the placement search moves it.
  const buildHowTo = (px, py) => {
    const buf = [];
    buf.push(`<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${PW.toFixed(2)}" height="${PH.toFixed(2)}" rx="2" fill="#ffffff" fill-opacity="0.94" stroke="#ccc" stroke-width="0.4"/>`);
    let y = py + PAD;
    if (HEAD) {
      y += HS * 0.86;
      buf.push(`<text x="${(px + PAD).toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${HS}" fill="#222">${esc(HEAD)}</text>`);
      y += HS * 0.29 + 1.6;
    }
    WRAPPED.forEach(lines => {
      y += BS * 0.78;
      buf.push(`<text x="${(px + PAD).toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-size="${BS}" fill="#555">•</text>`);
      lines.forEach((ln, i) => buf.push(`<text x="${(px + PAD + IND).toFixed(2)}" y="${(y + i * LH).toFixed(2)}" font-family="Arial" font-size="${BS}" fill="#333">${esc(ln)}</text>`));
      y += (lines.length - 1) * LH + (LH - BS * 0.78) + GAP;
    });
    return buf;
  };
  // Default want-position: bottom-left, the white space these sheets already carry —
  // the spokes fan out of a central hub and the legend lives top-left. FY1 is the
  // frame bottom, which is the footer PLATE and not the paper (a QR block can push
  // the plate up, and every free-floating device on this sheet works to it).
  const HX0 = (HOWTO.at && HOWTO.at.x != null) ? +HOWTO.at.x : 10;
  const HY0 = (HOWTO.at && HOWTO.at.y != null) ? +HOWTO.at.y : FY1 - PH;
  let hx = HX0, hy = HY0, draw = true;
  // A fully-specified `at` is a decision, so it opts out of the search — unlike
  // legendAt, which is only a preference the search may overrule. The difference is
  // that this panel can decline to appear, so "put it exactly here" has to mean it,
  // or a place could set `at` and still get nothing.
  const PINNED = !!(HOWTO.at && HOWTO.at.x != null && HOWTO.at.y != null);
  if (HOWTO.place !== false && !PINNED) {
    // The legend is furniture too and is already on the page; ART holds the ARTWORK's
    // boxes and was snapshotted before the legend existed, so without this the search
    // would happily park the panel on top of it. The legend gets first pick of the
    // clear ground, which is right: it is mandatory and this panel is not.
    ART.push([lx - 4, ly - 10, lx - 4 + legend.bw, ly - 10 + legend.bh, 'legend']);
    const got = legendSpot(PW, PH, HX0, HY0);
    if (got.moved) {
      hx = HX0 + got.dx; hy = HY0 + got.dy;
      process.stderr.write('howToUse: the configured spot covers ' + (got.wantSym * 100).toFixed(1)
        + '% symbols / ' + (got.want * 100).toFixed(0) + '% route ink — moved ' + got.dx.toFixed(0) + ',' + got.dy.toFixed(0)
        + ' mm to ' + hx.toFixed(0) + ',' + hy.toFixed(0) + '.\n');
    } else if (got.nowhere) {
      /*
       * NOT DRAWN, rather than drawn where it does harm — the same parting of company
       * with the legend the radial records. legendPlace's rule when nothing is clear
       * is "leave it and warn", because a sheet with no legend is not a sheet. A help
       * panel is different: the reader who loses a destination lozenge underneath it
       * loses a destination, is given nothing to say it was ever there, and gains a
       * paragraph telling them to look around the edge of the diagram for exactly the
       * thing that has just been covered up.
       */
      draw = false;
      // refuse(), not stderr.write(): the message is unchanged; what was missing was the
      // EXIT CODE, the only signal the portal's publish path reads (as in the radial).
      guardRefuse('howToUse: no position on this sheet leaves a ' + PW.toFixed(0) + 'x' + PH.toFixed(0)
        + ' mm panel clear of every symbol, so it was NOT DRAWN rather than cover one. '
        + 'Shrink it (design.howToUse.width, or fewer bullets), make room, or place it '
        + 'deliberately with design.howToUse.at — which also switches this search off.');
    }
  }
  if (draw) {
    if (V2) HARD.push([hx - 0.6, hy - 0.6, hx + PW + 0.6, hy + PH + 0.6, 'howto']);
    buildHowTo(hx, hy).forEach(out);
  }
}

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

{ const at = (D.stamp && D.stamp.externalAt) || [10, 190]; stampNote(D.stamp, at[0], at[1], 'start'); }

out('</svg>');
fs.writeFileSync(DIR + '/external.svg', s);
console.log('external.svg', s.length, 'bytes;', dests.length, 'destination spokes');

// ---- STRICT_GUARDS: report the refusals as an exit code ----------------------
// Last statement in the file, after the artwork is written, exactly as the radial
// does it: a build that refused something is still worth LOOKING at, it is just
// not worth publishing.
if (reportRefusals('refused to draw something this config asked for -- see the'
    + ' messages above. The sheet is incomplete and nothing on it says so.')) {
  process.exitCode = 1;
}
}

if (require.main === module) main();
module.exports = { main };
