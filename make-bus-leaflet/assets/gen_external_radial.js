// Generates the EXTERNAL bus map ("Buses from March to nearby places") as SVG.
// RADIAL tube-map: March hub in the centre; every service that leaves town is a
// straight spoke drawn to its terminus, with intermediate towns as ticks.
// (March has no guided-busway / P&R corridor, so this replaces the St Ives layout.)
const fs = require('fs');
const path = require('path');
const _FOOTER = (()=>{ const local=path.join(__dirname,'footer.js');
  try{ if(fs.existsSync(local)) return local; }catch(e){}
  return process.env.SKILL_ASSETS ? path.join(process.env.SKILL_ASSETS,'footer.js')
       : 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/footer.js'; })();
const { footerBand, footerPlateTop } = require(_FOOTER);
const _LABELLER = (()=>{ const local=path.join(__dirname,'labeller.js');
  try{ if(fs.existsSync(local)) return local; }catch(e){}
  return process.env.SKILL_ASSETS ? path.join(process.env.SKILL_ASSETS,'labeller.js')
       : 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/labeller.js'; })();
const { Labeller } = require(_LABELLER);
const FONT = require(path.join(path.dirname(_LABELLER),'font_metrics.js'));
// Same sibling-then-SKILL_ASSETS resolution as font_metrics above, which is what
// makes it load inside the portal as well as here.
const { separateRow } = require(path.join(path.dirname(_LABELLER),'svg_primitives.js'));
// dash_fit.js — the dashed-spoke pattern and its mid-gap fit, shared with
// gen_external_busway.js and gen_external_places.js (OA-167). Resolved the same
// sibling-then-SKILL_ASSETS way, so it loads from engine\dash_fit.js in the portal.
const { dashFit, polylineLength } = require(path.join(path.dirname(_LABELLER),'dash_fit.js'));
// STRICT_GUARDS, adopted 2026-08-28 (OA-045). Until then only gen_internal.js and
// gen_boarding.js participated in the contract at all, so "STRICT_GUARDS is live"
// was true of a third of the sheets we publish and the board did not say which
// third. Swept before adopting it: across all 20 committed maps NOTHING here
// refuses, so this starts green — the precondition every gate on this project
// needs. This file has exactly ONE site that declines to draw something the
// config asked for, the howToUse panel below; the legend deliberately does NOT
// refuse (a sheet with no legend is not a sheet, so it warns and stays put), and
// `spokeSpread`, `external labels` and the two `moved` messages are a device
// relocating itself or a drop already counted by the sidecar. None of those is a
// refusal and none becomes one here.
const { refuse: guardRefuse, report: reportRefusals } =
  require(path.join(path.dirname(_LABELLER), 'strict_guards.js'));
const DIR = process.env.LEAFLET_DIR || process.cwd();
const D = JSON.parse(fs.readFileSync(DIR + '/routes.json', 'utf8'));
const C = D.palette, TXT = D.textOn;
// badgeLabels: optional { <route key>:<badge text> } — keep a distinct internal
// key (matching S2 data) while the badge shows something else (e.g. two "46"s).
const BL = D.badgeLabels || {};
const blab = r => (BL[r] != null ? BL[r] : r);
// Tier-1 manual overrides (optional; absent/empty => byte-identical). overrides.json
// {"external":{branches:{<route|route#n>:{bearing,side,terminus:{x,y}}}, hub:{x,y}, note:{x,y}}}
const OVF = process.env.OVERRIDES_FILE || (DIR+'/overrides.json');
const ALLOV = (function(){ try{ return JSON.parse(fs.readFileSync(OVF,'utf8')); }catch(e){ return {}; } })();
const OV = ALLOV.external || {};
const RCOL = ALLOV.routeColors || {};            // top-level: recolour a route on BOTH maps
for(const r in RCOL) C[r] = RCOL[r];
// hiddenOperators (opt-in customer edit, top-level overrides.json array of
// routes.json operators[].name) — drop every spoke + legend row belonging to
// a hidden operator. Absent/empty => byte-identical.
const HIDDEN_OPS = new Set(ALLOV.hiddenOperators || []);
const HIDDEN_ROUTES = new Set();
if (HIDDEN_OPS.size) (D.operators||[]).forEach(op=>{ if(HIDDEN_OPS.has(op.name)) (op.routes||[]).forEach(r=>HIDDEN_ROUTES.add(r)); });
const EXT = HIDDEN_ROUTES.size ? D.external.filter(b=>!HIDDEN_ROUTES.has(b.route)) : D.external;
const OPS = HIDDEN_OPS.size ? D.operators.filter(op=>!HIDDEN_OPS.has(op.name)) : D.operators;
const EDK = process.env.EDITOR_KEYS==='1';
/*
 * labels.engine:"v2" (design-quality plan, Phase 4). This generator had NO collision
 * detection at all: every intermediate stop name was printed at a flat 5.2 mm
 * perpendicular offset, on a side chosen once for the whole spoke, whatever else was
 * there. Two spokes serving the same village each labelled it independently, which is
 * what produced Huntingdon's famous garbled "Fenstanton" — the same word printed
 * twice, 15 mm apart, both across a grey spoke. v2 routes these labels through
 * labeller.js and deduplicates the names first. Absent => byte-identical.
 */
const LABELS = D.labels || {};
// G5 (2026-08-17): labels.engine, badgeFit, hubFit, legendPlace, scaleBar and
// printSafe are uniform on all 8 towns, so they are engine DEFAULTS now — see
// gen_internal.js's G5 comment for the full rationale and the escape-hatch
// convention (`false`, or `"v1"` for labels.engine) carried across all three
// generators. spokeSpread stays explicit config: 4/8 towns, a per-composition
// judgement.
const V2 = !(LABELS.engine === 'v1' || LABELS.engine === false);
const DESIGN = D.design || {};
// printSafe: keep drawn content this many mm from the trim. `false` => today's
// geometry exactly; absent => 5. See footer.js's header.
const PSAFE = DESIGN.printSafe === false ? null : (DESIGN.printSafe != null ? +DESIGN.printSafe : 5);
const W = 297, H = 210;
// Footer options and notes are hoisted to the top because the PLATE TOP has to be
// known before any page furniture is placed, and design.sheetUrl/sheetQr can move
// it. gen_internal.js has always computed this early for exactly that reason; this
// sheet did not need to until the footer could grow. The same object is passed to
// footerPlateTop() here and to footerBand() at the end of the file, so the plate the
// furniture is fitted around cannot differ from the plate that gets drawn.
const _hasTimes = EXT.some(b=>b.minutesToDestination!=null);
const EXTERNAL_FOOTER_NOTES = [
  // routes.json `checkedAt` — when this map's services were last cross-checked.
  // Hardcoded "(June 2026)" here until 2026-08-28 and identical on all 20 maps, so
  // it was false on most of them. Absent => the parenthetical is omitted rather than
  // guessed; see gen_internal.js's CHECKED_AT for the full reasoning and why this is
  // not defaulted from validFrom.
  `Routes & stops: UK Bus Open Data Service (Open Government Licence v3.0), cross-checked with operators at bustimes.org${D.checkedAt ? ` (${D.checkedAt})` : ''}.`,
  `Confirm live times & fares at bustimes.org or operator apps.${_hasTimes?' Journey times shown are approximate.':''}`
    + `${DESIGN.scaleBar!==false?' Diagram — not to scale.':''}`];
const FOOTER_OPTS = { notes: EXTERNAL_FOOTER_NOTES, safe: PSAFE,
  url: DESIGN.sheetUrl || null, qr: DESIGN.sheetQr === false ? null : (DESIGN.sheetQr || { mm: 14 }),
  // design.sheetVersion — the PUBLISHED version, printed in the gap the QR left beside
  // the credit line (footer.js). Absent => no row, byte-identical.
  sheetVersion: DESIGN.sheetVersion || null,
  ...(DESIGN.sheetUrlLabel !== undefined ? { urlLabel: DESIGN.sheetUrlLabel } : {}) };
const PLATE_TOP = footerPlateTop(FOOTER_OPTS);
// The bottom of the ground page furniture may stand on. 190 was a bare constant in
// legendSpot; with the footer able to grow it has to be the smaller of that and the
// plate. Absent the new keys the plate top is 193.57 and this is 190 exactly, so
// nothing moves — which is the whole test of whether a derived constant is right.
const FRAME_Y1 = Math.min(190, PLATE_TOP - 2);
let s = '';
let out = (x) => { s += x + '\n'; };
const esc = (t) => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function wrap(label, max=13){
  if (label.length<=max || label.includes('\n')) return label.split('\n');
  const w=label.split(' '); let a='',b='';
  for(const t of w){ if((a+' '+t).trim().length<=max && !b) a=(a+' '+t).trim(); else b=(b+' '+t).trim(); }
  return b?[a,b]:[a];
}
// wrapMm — multi-line word wrap to a width in MILLIMETRES, measured on the real Arial
// advances. Used for free-text notes (the "runs as two arms" note, etc.) so a long
// sentence fits a panel width instead of running off it as one unbounded line.
//
// This replaced wrapText(text, maxChars), a wrap by CHARACTER COUNT — see measureText
// below for why counting characters was the wrong unit for this job.
function wrapMm(text, maxMm, size){
  const words = String(text).split(' ');
  const lines = []; let cur = '';
  for(const w of words){
    const cand = cur ? cur+' '+w : w;
    if(cur && FONT.textWidth(cand, size, false) > maxMm){ lines.push(cur); cur = w; }
    else cur = cand;
  }
  if(cur) lines.push(cur);
  return lines;
}
// measureText — Arial advance width (mm) from the baked metrics table. Sizes the auto
// legend backing panel and picks the note's word-wrap width.
//
// This used to be `String(str).length * size * 0.58` — a character count times a
// deliberately generous per-character estimate — and the generosity was the bug. Real
// Arial prose averages ~0.50em per character, so the estimate ran ~16% wide, and it was
// used for BOTH jobs at once: the panel was sized ~16% wider than its own ink, AND the
// note wrapped ~16% narrower than the panel actually allowed. The two errors compounded
// into a dead column down the right-hand side of every legend — measured at 7-24% of
// panel width across the eight towns (St Neots worst: 25.5mm of 105.6mm) — and because
// the legend is placed before the spider is drawn around it, that dead column is map
// area the diagram never got. Peter reported it as "lots of space on the right, and it
// seems to do new lines unnecessarily and awkwardly", which is both halves of it.
//
// The howToUse panel further down already wraps on FONT.textWidth for exactly this
// reason ("the character estimate is ~11% out on ordinary prose"); this brings the
// legend into line with it. Callers must pass `bold` truthfully now — the old estimate
// was wide enough to cover bold by accident, exact metrics are not.
const measureText = (str, size, bold) => FONT.textWidth(str, size, !!bold);

// ---- primitives -------------------------------------------------------------
// dashed (limited-service) spokes use a BUTT cap, not round. A round cap adds w/2
// of ink beyond EACH end of every dash, so at w=3.4 the old `round` + "1.6 2.2"
// drew 1.6+3.4=5.0 mm of ink separated by 2.2-3.4 = -1.2 mm of gap: the dashes
// overlapped into one scalloped caterpillar and the line read as solid-but-lumpy.
// Butt caps plus a gap comfortably wider than the stroke keep each dash a crisp
// rectangle. The numbers, and the fit that keeps a spoke from ending in a sliver,
// now live in ONE place — dash_fit.js — required by this file, by
// gen_external_busway.js and by the place skill's gen_external_places.js. Until
// 2026-08-30 this was three copies of the same primitive with a comment telling
// the reader to change all three, and that comment failed twice: the 2026-08-06
// butt-cap fix and the 2026-08-29 dash fit were each made in the places copy and
// left out of this one, the second of them printing a 0.0923mm sliver on St Ives'
// published external for eleven days (OA-167). Nothing executes a comment.
function line(pts, color, w=3.4, dashed=false){
  const d = pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
  const cap = dashed ? 'butt' : 'round';
  const dash = dashed ? ` stroke-dasharray="${dashFit(polylineLength(pts))}"` : '';
  out(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="round"${dash}/>`);
}
function tick(x,y,color){ out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.5" fill="#fff" stroke="${color}" stroke-width="1.1"/>`); }
/* design.badgeFit — the same defect and the same fix as gen_internal.js, which
 * carries the full rationale. This sheet draws the SAME route keys, so a town
 * whose stop badges overflow overflows here too: Ramsey's "301S" is 8.9mm of
 * Arial Bold in the 8.0mm terminus badge and 6.4mm in the 5.8mm legend one. The
 * only difference is that here the text is 0.95 × the radius, not the radius, so
 * the fit test measures at that size.
 *
 * badgeXW returns the EXTRA over the radius — 0 whenever the text fits, and 0
 * always when the key is absent — and every pitch below is written as the old
 * literal plus that extra, so an ungated town stays byte-identical.
 */
const BFIT = DESIGN.badgeFit !== false;
const badgeHalfW = (route,r)=>{
  if(!BFIT) return r;
  const w = FONT.textWidth(blab(route), r*0.95, true);
  return (w <= 2*r-0.3) ? r : w/2 + 0.35*r;
};
const badgeXW = (route,r)=> BFIT ? badgeHalfW(route,r)-r : 0;
const badgeXWs = (list,r)=> BFIT ? Math.max(0,...list.map(k=>badgeXW(k,r))) : 0;
function badge(x,y,route,r=4.6){
  const hw=badgeHalfW(route,r);
  if(V2) HARD.push([x-hw-0.4, y-r-0.4, x+hw+0.4, y+r+0.4, 'badge']);
  if(hw>r) out(`<rect x="${(x-hw).toFixed(2)}" y="${(y-r).toFixed(2)}" width="${(2*hw).toFixed(2)}" height="${(2*r).toFixed(2)}" rx="${r}" fill="${C[route]||'#888'}" stroke="#fff" stroke-width="0.7"/>`);
  else out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${C[route]||'#888'}" stroke="#fff" stroke-width="0.7"/>`);
  out(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${(r*0.95).toFixed(2)}" fill="${TXT[route]||'#fff'}" text-anchor="middle" dominant-baseline="central">${esc(blab(route))}</text>`);
  return hw-r;
}
// measureNodeWidth — the terminus-lozenge width formula, factored out of townNode() so the
// badge-clearance calc below can know a box's width BEFORE it's drawn (badges are placed back
// from the terminus point; the box is drawn afterwards, on top, so an offset shorter than the
// box's half-width lets the box cover the badge).
function measureNodeWidth(label, timeLabel){
  const lines = wrap(label);
  return Math.max(18, Math.max(...lines.map(l=>l.length))*1.95 + 4, timeLabel ? timeLabel.length*1.7+4 : 0);
}
// timeLabel (optional, e.g. "~18 min") — an extra non-bold line under the
// destination name, fed by routes.json external[].minutesToDestination.
// Absent => box drawn exactly as before (byte-identical for gated towns).
// v2 collects the boxes that must never be printed over, and the label requests, as
// the sheet is drawn — the same "claim your space before anything is placed" order
// gen_internal.js uses.
const HARD = [];      // [x0,y0,x1,y1,tag]
const ANCH = [];      // [x,y,id] every tick/lozenge, for the "nearer a foreign symbol" test
const REQS = [];      // queued stop labels
/* WHERE THE LOZENGE ACTUALLY ENDS UP, asked separately so the badge placement further
 * down can ask it BEFORE it draws. The box is nudged twice after the spoke's end point is
 * chosen — once by design.printSafe and once by the footer plate — and both nudges move it
 * TOWARDS the hub, i.e. onto the badges parked just inside it. March's X32 was the visible
 * case (Peter, 2026-08-24): the box clamped 1.75 mm left to stay inside the print margin,
 * over a badge positioned against the unclamped point. Same arithmetic, used by both.
 *
 * A REACH-BACK ALONG THE SPOKE WAS THE FIRST ANSWER AND IS NOT THIS ONE. Asking how far
 * the box reaches from its own centre along the spoke — min(halfW/|dx|, halfH/|dy|), which
 * is 12.72 mm on March's X32 against the 11.75 mm reserved — is a real correction and still
 * the wrong question, because a badge parked down-and-left of the box is nearest its EDGE,
 * not the point where the spoke crosses it. It left the X32 0.44 mm under "Whittlesey".
 * distToRect() below is what the badge placement actually asks; this clamp is the other
 * half. The two errors together came to 2.7 mm; the overlap measured on the shipped sheet
 * was 2.84. */
function nodeClamp(x,y,w,hh){
  if(PSAFE!=null){
    x = Math.min(Math.max(x, PSAFE + w/2), W - PSAFE - w/2);
    y = Math.min(Math.max(y, PSAFE + hh/2), H - PSAFE - hh/2);
  }
  if(PLATE_TOP != null) y = Math.min(y, PLATE_TOP - 1 - hh/2);
  return [x,y];
}
// Distance from a point to a RECTANGLE (0 inside it). The badge/box test has to be this,
// not a distance measured along the spoke: the box's nearest point to a badge sitting
// down-and-left of it is the perpendicular foot on its edge, not where the spoke crosses.
// Measuring along the spoke left March's X32 still 0.44 mm under "Whittlesey" after the
// clamp had been accounted for — right answer to the wrong question.
function distToRect(px,py,cx,cy,w,hh){
  const dx = Math.max(Math.abs(px-cx) - w/2, 0), dy = Math.max(Math.abs(py-cy) - hh/2, 0);
  return Math.hypot(dx,dy);
}
// `at` (optional) — the centre this box has ALREADY been solved to, from NODE_AT
// below. Passed in rather than recomputed because the badge placement further down
// has to know the same answer, and the one thing this file has learned the hard way
// is that two places computing a box's position separately will disagree (March's
// X32, 2026-08-24). Absent => clamp here exactly as before.
function townNode(x,y,label,h=11,timeLabel,at){
  const lines = wrap(label);
  const w = measureNodeWidth(label, timeLabel);
  const extra = timeLabel ? 3.6 : 0;
  const hh = h + extra;
  // design.printSafe: a terminus lozenge is drawn centred on the end of its
  // spoke, and the spoke's end is chosen from a bearing and a radius that know
  // nothing about the page edge — so Wisbech printed "King's Lynn –" 3.92mm from
  // the trim and High Wycombe "Beaconsfield" at 4.42mm. Nudge the BOX back
  // inside the margin rather than shorten the spoke: the shift is a millimetre
  // or two and the box is at least 18mm wide, so it still covers the line end
  // and still reads as that spoke's terminus.
  // (the two clamps below now live in nodeClamp(), because the badge placement has to
  //  apply exactly the same ones before it decides where the badges go.)
  // ...and clear of the FOOTER PLATE, which is not the same boundary as the trim.
  //
  // The clamp above keeps a lozenge inside the printable page; it says nothing about
  // the opaque footer plate, which is drawn LAST and over everything. That was safe
  // only while the plate was short: the plate top sat around 190mm and RECT.y1's
  // hardcoded 182 left a lozenge's half-height of room below it by luck, not by
  // design. design.sheetQr changes the arithmetic — an 18mm code plus its quiet zone
  // and the URL line lift the plate to ~183mm, and St Ives' bottom row (Hilton &
  // Elsworth, Boxworth, Trumpington P&R, Bar Hill) was drawn 6mm INSIDE it, so four
  // destinations lost their journey times under an opaque white band.
  //
  // Worth knowing how this was found: quality_metrics scored that very sheet BETTER
  // (+8 labels) because the how-to panel's bullets are labels and a buried lozenge is
  // not a label at all — `textUnderFooter` counts <text>, and these are <rect> plus
  // white text that the metric reads as present. The defect was visible in the JPG
  // and invisible in every number. Clamp the BOX, not the spoke's end point, so an
  // overridden terminus (overrides.branches.*.terminus) is covered too.
  if(at) { x = at[0]; y = at[1]; } else [x,y] = nodeClamp(x,y,w,hh);
  if(V2){ HARD.push([x-w/2-0.6, y-hh/2-0.6, x+w/2+0.6, y+hh/2+0.6, 'terminus']); ANCH.push([x,y,'term:'+label]); }
  out(`<rect x="${(x-w/2).toFixed(2)}" y="${(y-hh/2).toFixed(2)}" width="${w.toFixed(2)}" height="${hh}" rx="2.4" fill="#2e8b57" stroke="#1d5f3a" stroke-width="0.5"/>`);
  const lh=4.0, y0=y-((lines.length-1)*lh+extra)/2;
  lines.forEach((ln,i)=>out(`<text x="${x.toFixed(2)}" y="${(y0+i*lh).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="3.4" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(ln)}</text>`));
  if(timeLabel){
    const ty2 = y0 + lines.length*lh - (lh-3.6)/2 + 0.2;
    out(`<text x="${x.toFixed(2)}" y="${ty2.toFixed(2)}" font-family="Arial" font-size="2.7" fill="#d7f0df" text-anchor="middle" dominant-baseline="central">${esc(timeLabel)}</text>`);
  }
  return w;
}

// ---- canvas -----------------------------------------------------------------
out(`<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 ${W} ${H}">`);
out(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
const TITLE_COL = D.titleColor || Object.values(C)[0] || '#444';
out(`<text x="10" y="17" font-family="Arial" font-weight="bold" font-size="11" fill="${TITLE_COL}">Buses from ${esc(D.town)} to nearby places</text>`);
out(`<text x="10" y="24" font-family="Arial" font-size="5" fill="#444">(from ${esc(D.validFrom)})</text>`);

// ---- hub + radial spokes ----------------------------------------------------
let HX=152, HY=116;                 // hub centre
if(OV.hub){ HX=OV.hub.x; HY=OV.hub.y; }
// The inset frame the termini sit on. y1 used to be a flat 182, which was a constant
// standing in for "just above the footer plate" and stopped being true the moment the
// plate could grow (design.sheetUrl/sheetQr). Follow FRAME_Y1 — the bound every other
// page device already works to — less a lozenge's half-height, so the spoke ENDS high
// enough for its box to clear the plate instead of relying on the clamp in townNode()
// to drag it back, which would band every southern terminus onto one line.
const RECT={x0:24,y0:34,x1:282,y1:Math.min(182, FRAME_Y1 - 7.5)};
function rayToRect(dx,dy){             // distance from hub to inset rect along (dx,dy)
  let t=1e9;
  if(dx>0) t=Math.min(t,(RECT.x1-HX)/dx); else if(dx<0) t=Math.min(t,(RECT.x0-HX)/dx);
  if(dy>0) t=Math.min(t,(RECT.y1-HY)/dy); else if(dy<0) t=Math.min(t,(RECT.y0-HY)/dy);
  return t;
}
// Hub label box, measured FIRST (used to be measured only afterwards, purely to draw the
// hub rectangle, while every spoke anchored to a flat 14mm circle regardless of the label's
// real shape) so a long/thin label (Beaconsfield, Beaconsfield Simpson Centre) doesn't leave
// an obvious gap on the spokes that pass its short axis while barely clearing its long axis.
const HUB_LABEL_TXT = D.externalHubLabel || D.town;
const HUB_LINES = wrap(HUB_LABEL_TXT, Math.max(13, D.town.length));
const HUB_H = 12 + (HUB_LINES.length-1)*4.0;
/* design.hubFit — size the hub box from the text, not from a character count.
 *
 * The legacy width is `characters x 2.6mm + 6`, which is not a measurement of
 * anything: at 5.2mm Arial Bold a real glyph runs 1.16mm ('I') to 4.91mm ('W'),
 * so the constant is only ever right by luck. Measured across the eight towns on
 * 2026-08-16 the padding it leaves ranges from **-0.18mm to +4.73mm a side** —
 * "High Wycombe" overflowed its own box (37.56mm of text in 37.20mm) while
 * "St Ives Bus Station/" sat in 4.73mm of slack. Same class of bug as the badge
 * overflow, and the same cure: ask font_metrics.js.
 *
 * 2.2mm a side is the padding, near the middle of what the old formula happened
 * to give, so no hub changes much: +4.8mm on High Wycombe (the overflow), -5.1mm
 * on St Ives (the slack), under 2.4mm either way on the rest, and March is
 * pinned by the 22mm floor and does not move at all.
 *
 * The TERMINUS lozenges deliberately keep their own character-count formula
 * (`measureNodeWidth`). It was measured at the same time and it works: across
 * 312 text lines in nodes on the eight shipped sheets, the tightest was Wisbech's
 * "Downham" at 0.88mm a side and nothing overflowed — its 18mm floor and +4
 * padding absorb the error the hub's does not. Changing it would move every
 * lozenge AND every spoke's badge offset (`_autoOff` is derived from it) to fix
 * nothing, so it stays until something actually overflows.
 *
 * The wrap width stays in characters too: where a two-line hub label BREAKS is a
 * layout choice, not a fitting bug.
 */
const HUBFIT = DESIGN.hubFit !== false;
const HUB_W = HUBFIT
  ? Math.max(22, Math.max(...HUB_LINES.map(l=>FONT.textWidth(l,5.2,true)))+4.4, FONT.textWidth(D.town,5.2,true)+4.4)
  : Math.max(22, Math.max(...HUB_LINES.map(l=>l.length))*2.6+6, D.town.length*2.6+6);
// hubEdge — fit an ellipse to the label's half-width/half-height and solve
// r(theta) = 1/sqrt((cos/a)^2+(sin/b)^2) for each spoke's own bearing, so every spoke starts
// just outside the label box regardless of angle, instead of all spokes sharing one radius.
const HUB_A = HUB_W/2 + 3, HUB_B = HUB_H/2 + 3;
function hubEdge(dx,dy){
  const denom = Math.sqrt((dx*dx)/(HUB_A*HUB_A) + (dy*dy)/(HUB_B*HUB_B));
  return denom>0 ? Math.max(14, 1/denom) : Math.max(14, HUB_A, HUB_B);
}
/* ---- design.spokeSpread — spread the spokes around the hub (plan §4.2) --------
 *
 * A radial spider is a tube map: spoke LENGTH already carries nothing (every
 * spoke runs to the frame), and the footer says "Diagram — not to scale". Bearing
 * is the one geographic claim left, and taken literally it wastes the page —
 * Ramsey's five spokes left the east and west of the circle empty while three of
 * them fought over a ~40° fan pointing straight down, which is *why* its labels
 * collided. Every published spider (TfL's included) spreads its spokes and keeps
 * the compass SECTOR rather than the compass angle.
 *
 * So: the target is an even distribution around the circle **in the spokes' own
 * bearing order**, phased to sit as close to the true bearings as it can (a
 * circular mean of bearing − k·step, so the whole fan is rotated rather than
 * re-ordered), and then each spoke is clamped to `maxShift` degrees of its real
 * bearing. **The clamp is the honesty control and 30° is deliberate**: a spoke may
 * be nudged to the edge of its sector — Ramsey's SSW Huntingdon drawn SW — but it
 * cannot cross into the opposite one, so "which way do I leave town" survives.
 * Raise it per town knowingly; `strength` < 1 blends toward the true bearings
 * instead, for a town that only wants the fan opened a little.
 *
 * Order is preserved by construction, which is what keeps the sheet readable as a
 * compass. Absent the key nothing runs and every sheet is byte-identical; a town
 * that has hand-pinned bearings in overrides.json should not turn it on, because
 * those are inputs here and would be spread along with the rest.
 */
const SPRD = DESIGN.spokeSpread ? (DESIGN.spokeSpread===true?{}:DESIGN.spokeSpread) : null;
const _cnt={}; EXT.forEach(b=>_cnt[b.route]=(_cnt[b.route]||0)+1);
const _keyOf=(()=>{ const seen={}; return EXT.map(b=>{ seen[b.route]=(seen[b.route]||0)+1;
  return _cnt[b.route]>1 ? b.route+'#'+seen[b.route] : b.route; }); })();
const norm360 = a => ((a%360)+360)%360;
const BEARINGS = (()=>{
  const raw = EXT.map((b,i)=>{ const ov=(OV.branches||{})[_keyOf[i]]||{};
    return norm360(ov.bearing!=null?ov.bearing:b.bearing); });
  if(!SPRD || raw.length<2) return raw;
  const maxShift = SPRD.maxShift!=null?SPRD.maxShift:30;
  const strength = SPRD.strength!=null?SPRD.strength:1;
  const order = raw.map((_,i)=>i).sort((a,b)=>raw[a]-raw[b]);
  const step = 360/order.length;
  // Phase = circular mean of (bearing − k·step): the rotation of the even fan that
  // sits closest to the real bearings. A plain arithmetic mean would break at the
  // 0°/360° seam, which is exactly where a north-pointing spoke lives.
  let sx=0, sy=0;
  order.forEach((idx,k)=>{ const d=(raw[idx]-k*step)*Math.PI/180; sx+=Math.cos(d); sy+=Math.sin(d); });
  const phase = Math.atan2(sy,sx)*180/Math.PI;
  const outB = raw.slice();
  order.forEach((idx,k)=>{
    const want = ((phase + k*step - raw[idx] + 540)%360)-180;      // signed shift wanted
    const d = Math.max(-maxShift, Math.min(maxShift, want*strength));
    outB[idx] = norm360(raw[idx]+d);
  });
  const gaps = order.map((idx,k)=>{ const nx=order[(k+1)%order.length];
    return norm360(outB[nx]-outB[idx]) || 360; });
  process.stderr.write('spokeSpread: '+order.map((idx,k)=>_keyOf[idx]+' '+raw[idx].toFixed(0)+'->'
    +outB[idx].toFixed(0)+'°').join(', ')+'  (smallest gap '+Math.min(...gaps).toFixed(0)+'°, '
    +'max shift '+Math.max(...outB.map((v,i)=>Math.abs(((v-raw[i]+540)%360)-180))).toFixed(0)+'°)\n');
  if(Math.min(...gaps) < 18) process.stderr.write('spokeSpread: two spokes are still under 18° apart '
    +'— the maxShift clamp cannot open them. Merge co-terminating routes onto one spoke '
    +'(external[].routes) or raise design.spokeSpread.maxShift.\n');
  return outB;
})();
// draw spokes first (under hub)
/* WHERE EVERY TERMINUS BOX ENDS UP, SOLVED BEFORE ANY OF THEM IS DRAWN.
 *
 * nodeClamp() moves one box inside the print margin and above the footer plate,
 * and it is the only rule there has ever been. Both of its clamps are per-object,
 * and two boxes landing on each other is a relationship BETWEEN objects, so no
 * amount of care inside nodeClamp can see it: several spokes ending low all get
 * pushed up to the same line above the plate and pile onto one another there.
 * Measured on the committed board 2026-08-28 that is four of the seven lozenge
 * overlaps on the estate, and the loudest is Huntingdon printing "Addenbrooke's
 * ~79 min" over "Cambridge ~56 min" by 13.46 x 14.60mm — a destination a reader
 * simply cannot recover, on a sheet every other measure calls clean.
 *
 * So the boxes are solved as a SET, once, and BOTH consumers read the answer: the
 * badge placement below (which must know where the box will be before it decides
 * how far back to park the badges — see distToRect) and townNode itself. That is
 * the whole reason this is a pre-pass and not a tidy-up afterwards. Moving the
 * boxes after the badges were placed against their old positions would recreate
 * March's X32 sitting under "Whittlesey", which is the defect the comments around
 * nodeClamp exist to describe.
 *
 * A band of one is returned exactly where the clamp put it, so every sheet with no
 * collision stays byte-identical.
 */
const NODE_AT = (()=>{
  const boxes = EXT.map((b,i)=>{
    const ov=(OV.branches||{})[_keyOf[i]]||{};
    const a=BEARINGS[i]*Math.PI/180; let dx=Math.sin(a), dy=-Math.cos(a);
    let t=rayToRect(dx,dy); let tx=HX+dx*t, ty=HY+dy*t;
    if(ov.terminus){ tx=ov.terminus.x; ty=ov.terminus.y; }
    const tl = b.minutesToDestination!=null?('~'+b.minutesToDestination+' min'):null;
    const w = measureNodeWidth(b.label, tl), hh = 11 + (tl?3.6:0);
    const [cx,cy] = nodeClamp(tx,ty,w,hh);
    return {x:cx,y:cy,w,h:hh};
  });
  // Band membership is a y-overlap deeper than the tolerance quality_metrics.js
  // scores by, so the generator and the measure cannot disagree about which pairs
  // are a problem. Single-link, in index order, so the grouping is deterministic.
  const TOL=0.6, band=boxes.map(()=>-1); let nb=0;
  for(let i=0;i<boxes.length;i++){
    if(band[i]<0) band[i]=nb++;
    for(let j=i+1;j<boxes.length;j++){
      const oy = Math.min(boxes[i].y+boxes[i].h/2, boxes[j].y+boxes[j].h/2)
               - Math.max(boxes[i].y-boxes[i].h/2, boxes[j].y-boxes[j].h/2);
      if(oy>TOL){ if(band[j]<0) band[j]=band[i];
        else { const from=band[j], to=band[i]; for(let k=0;k<boxes.length;k++) if(band[k]===from) band[k]=to; } }
    }
  }
  const lo = PSAFE!=null?PSAFE:0, hi = W - (PSAFE!=null?PSAFE:0);
  for(let g=0; g<nb; g++){
    const idx = boxes.map((_,i)=>i).filter(i=>band[i]===g);
    if(idx.length<2) continue;
    const r = separateRow(idx.map(i=>({c:boxes[i].x, hw:boxes[i].w/2})), lo, hi, 1);
    idx.forEach((i,k)=>{ boxes[i].x = r.centres[k]; });
    if(!r.fits) console.error('terminus boxes on one line are wider than the page: '
      + idx.map(i=>EXT[i].label).join(', ') + ' — shorten a label or merge two termini.');
  }
  return boxes.map(b=>[b.x,b.y]);
})();
for(let _i=0;_i<EXT.length;_i++){
  const b=EXT[_i];
  const _key=_keyOf[_i];
  const _ov=(OV.branches||{})[_key]||{};
  if(EDK) out('<g data-kind="branch" data-key="'+esc(_key)+'">');
  const _bearing=BEARINGS[_i];
  let a=_bearing*Math.PI/180, dx=Math.sin(a), dy=-Math.cos(a);
  let t=rayToRect(dx,dy);
  let tx=HX+dx*t, ty=HY+dy*t;            // terminus point on frame
  if(_ov.terminus){ tx=_ov.terminus.x; ty=_ov.terminus.y; const _l=Math.hypot(tx-HX,ty-HY)||1; dx=(tx-HX)/_l; dy=(ty-HY)/_l; t=_l; }
  const px=-dy, py=dx;                      // unit perpendicular (left of travel)
  const stops=b.stops;                      // intermediate... terminus (last)
  const n=stops.length;
  const R0=hubEdge(dx,dy);                  // this spoke's own clear-zone edge (ellipse-fitted)
  // node positions along the spoke (evenly), last = terminus
  const pts=[[HX+dx*R0, HY+dy*R0]];
  for(let i=0;i<n;i++){ const f=(i+1)/n; const r=R0+(t-R0)*f; pts.push([HX+dx*r, HY+dy*r]); }
  line(pts, C[b.route], 3.4, b.limited);
  // intermediate ticks + labels (white halo so crossings stay legible)
  // choose which perpendicular side the labels sit on (steer into open space)
  let perpx=px, perpy=py;
  const _side=_ov.side||b.side;
  if(_side==='up'    && perpy>0){perpx*=-1;perpy*=-1;}
  if(_side==='down'  && perpy<0){perpx*=-1;perpy*=-1;}
  if(_side==='left'  && perpx>0){perpx*=-1;perpy*=-1;}
  if(_side==='right' && perpx<0){perpx*=-1;perpy*=-1;}
  const labSide = (perpx<0)? 'end':'start';
  for(let i=0;i<n-1;i++){
    const [x,y]=pts[i+1];
    tick(x,y,C[b.route]);
    if(V2){
      HARD.push([x-1.9,y-1.9,x+1.9,y+1.9,'tick']);
      ANCH.push([x,y,'stop:'+stops[i]+'@'+_key+'#'+i]);
      /* design.labelPrefer — WHETHER THE STATED SIDE IS ACTED ON (2026-08-30, OA-062).
       *
       * `prefer` is computed here and was silently discarded by labeller.js, which
       * read sixteen item properties and not that one, so every `side` in every
       * town's config had done nothing since labels engine v2 became the default —
       * 81 of the 83 spokes on the board. The labeller now honours it, and the
       * mechanism is tested and mutation-proved.
       *
       * It is nevertheless OFF by default, and that is the measurement's own
       * finding rather than caution. Values nobody has ever seen the effect of are
       * not a setting, they are a guess: Ramsey states `side:"up"` on all six of
       * its branches, which is what a config looks like when it has never done
       * anything. Turning the whole board on at once was measured on 2026-08-30 —
       * it improved no sheet's numbers, and it moved one of Ramsey's four "Bury"
       * labels from 31.9 mm to 23.9 mm from another, turning a clean external
       * sheet into a HARD defect. So the estate keeps today's placement byte for
       * byte, and a town opts in when somebody has looked at its spokes and
       * re-authored them. That is the invariant this engine holds anyway: absent
       * config, byte-identical output. */
      REQS.push(Object.assign({ id:'stop:'+stops[i]+'@'+_key+'#'+i, at:[x,y], text:stops[i], size:2.9,
                  own:[x-1.9,y-1.9,x+1.9,y+1.9] },
                DESIGN.labelPrefer ? { prefer:[perpx,perpy] } : {}));
      continue;
    }
    const lx=x+perpx*5.2, ly=y+perpy*5.2+0.9;
    out(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-family="Arial" font-size="2.9" fill="#222" text-anchor="${labSide}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(stops[i])}</text>`);
  }
  // route badge(s) on the line just inside the terminus node.
  // b.routes:[…] (optional) — several services sharing ONE spoke to a destination.
  // A big town's radial runs out of frame perimeter long before it runs out of
  // services (High Wycombe: 23 spokes, five destinations reached by two routes
  // each), so co-terminating routes share a spoke and stack their badges along it.
  // Absent => a single badge for b.route, exactly as before.
  // badgeOffset (optional) — mm back from the terminus for the first badge; a town with wide
  // destination lozenges needs more clearance. Default 8, but ALWAYS raised to clear the actual
  // terminus box for this spoke (half its width + a small margin) — the box is drawn on top of
  // the badge afterwards, so a short flat default only worked for towns with short labels.
  const _timeLabel = b.minutesToDestination!=null?('~'+b.minutesToDestination+' min'):null;
  const _badges = (Array.isArray(b.routes) && b.routes.length) ? b.routes : [b.route];
  // design.badgeFit: a pill on this spoke is wider than the 8.0mm disc that both
  // the 8.6mm stacking pitch and the 4.5mm box clearance were sized for. Both
  // grow by the widest extra on THIS spoke; an ungated spoke adds zero.
  const _bxw = badgeXWs(_badges, 4.0);
  /* Measure the clearance against the box AS IT WILL BE DRAWN, and along the spoke.
   * See nodeClamp() and distToRect() above for why each half of that matters; the two
   * together are March's X32 sitting under "Whittlesey ~17 min". `_shift` is how much of
   * the clamp eats into the gap: it is the component of the box's move along the spoke's
   * own direction, so a sideways nudge (which does not close the gap) costs nothing. */
  const _nw = measureNodeWidth(b.label, _timeLabel), _nh = 11 + (_timeLabel ? 3.6 : 0);
  const [_cx,_cy] = NODE_AT[_i];      // solved as a set above; see NODE_AT for why
  // The badge's own half-extent: the 4.0 disc, its 0.7 white stroke, and design.badgeFit's
  // extra half-width where the pill is wider than the disc. Plus 1.1 mm of daylight.
  const _bneed = 4.0 + 0.35 + _bxw + 1.1;
  let _boff = Math.max((D.badgeOffset != null) ? D.badgeOffset : 8,
                       measureNodeWidth(b.label, _timeLabel)/2 + 4.5 + _bxw);
  // ...then walk it back until the badge genuinely clears the box. Terminates: the spoke
  // is finite and the box is at its far end, so moving hubward strictly increases the gap.
  for(let _g=0; _g<200 && distToRect(tx-dx*_boff, ty-dy*_boff, _cx, _cy, _nw, _nh) < _bneed; _g++) _boff += 0.2;
  const _bpitch = 8.6 + 2*_bxw;
  _badges.forEach((r,i)=>badge(tx-dx*(_boff+i*_bpitch), ty-dy*(_boff+i*_bpitch), r, 4.0));
  // terminus node
  townNode(tx,ty,b.label,11,_timeLabel,NODE_AT[_i]);
  if(EDK) out('</g>');
}
// 56 serves two arms (Manea & Wisbech) — note it once
// hub node on top
// externalHubLabel (optional) — override the hub box text (supports \n for a
// second line, e.g. a combined "Bus Station/Park and Ride" label for a town
// with two departure points sharing one radial hub). Absent => D.town, drawn
// exactly as before (byte-identical).
if(EDK) out('<g data-kind="hub" data-key="hub">');
(function(){
  const lines = HUB_LINES, h = HUB_H, w = HUB_W;   // measured up front, alongside hubEdge()
  if(V2){ HARD.push([HX-w/2-1, HY-h/2-1, HX+w/2+1, HY+h/2+1, 'hub']); ANCH.push([HX,HY,'hub']); }
  out(`<rect x="${(HX-w/2).toFixed(2)}" y="${(HY-h/2).toFixed(2)}" width="${w}" height="${h}" rx="2.6" fill="#111" stroke="#000" stroke-width="0.5"/>`);
  const lh=5.2, y0=HY-(lines.length-1)*lh/2;
  lines.forEach((ln,i)=>{ const yy = lines.length>1 ? (y0+i*lh).toFixed(2) : HY;
    out(`<text x="${HX}" y="${yy}" font-family="Arial" font-weight="bold" font-size="5.2" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(ln)}</text>`); });
})();
if(EDK) out('</g>');

// ---- legend + notes (top-left, under title) ---------------------------------
// The words the dashed spokes get in the line-style key. Matches gen_internal.js's
// FTIER_LABEL.limited so the two sheets of one map explain the same thing the same way;
// design.limitedKeyLabel overrides it for a town whose dashed services are unusual.
const LIMITED_KEY = DESIGN.limitedKeyLabel || 'Dashed — certain days only, check times';
// legendAt:{x,y} (optional) — move the operator legend out of a sector the spokes
// need. Absent => top-left under the title, exactly as before.
const LX0 = (D.legendAt && D.legendAt.x!=null) ? D.legendAt.x : 10;
const LY0 = (D.legendAt && D.legendAt.y!=null) ? D.legendAt.y : 40;
const _box = D.legendAt && D.legendAt.box;
let _boxWarned = false;   // OA-157 — see buildLegend
// auto-note any route that leaves town on more than one arm (e.g. "56 runs as
// two arms — to Manea and to Wisbech"), or use D.externalNote to override.
// Hoisted above buildLegend because its TEXT does not depend on where the legend
// sits — only its wrap width and position do.
let armNote = D.externalNote;
if(armNote===undefined){
  const arms={}; EXT.forEach(b=>{(arms[b.route]=arms[b.route]||[]).push(b.label);});
  armNote = Object.entries(arms).filter(([,v])=>v.length>1)
    .map(([r,v])=>`${r} runs as two arms — to ${v.slice(0,-1).join(', ')} and to ${v[v.length-1]}.`).join('  ');
}
/*
 * ART — the artwork's own claimed boxes, snapshotted BEFORE the legend adds any
 * badge boxes of its own. design.legendPlace searches against this, so the legend
 * never treats its own contents as an obstacle.
 */
const ART = HARD.slice();
/*
 * buildLegend — draw the legend at (lx,ly) into a buffer and measure it.
 *
 * Extracted from the inline block it used to be so that design.legendPlace can
 * build it TWICE: once to learn how big the box is, then again wherever the
 * search puts it. Content is a pure function of (lx,ly), which is what makes the
 * second build safe — and with the flag absent it is called exactly once, at the
 * configured spot, emitting the same strings in the same order as before.
 *
 * dx,dy shift an explicit overrides.note position by however far the legend moved,
 * so a hand-placed note travels with the box instead of being left behind.
 */
function buildLegend(lx, ly, dx, dy){
  // legendWrap reassigns `ly` below (to keep the note's default offset sane) — the backing
  // panel's TOP must stay pinned to where the header was actually drawn, or the panel drifts
  // away from its own content (Wisbech/High Wycombe, 2026-08-06: box outline landed well below
  // the "Operators & services" header once legendWrap was in play).
  const legendTopY = ly;
  // Auto backing panel: the legend (+ its arm note, if any) is drawn into a buffer first so its
  // bounding box can be measured, then an opaque panel is emitted UNDER it. Used to be opt-in via
  // legendAt.box — now always drawn (every town's legend sits over the spokes at least once they
  // wrap around a busy hub), auto-sized to content. legendAt.box still wins when given explicitly,
  // as a hand-tuning escape hatch.
  const legendBuf = [];
  const realOut = out;
  out = (x) => legendBuf.push(x);
  let panelMaxX = lx, panelMaxY = ly - 4;
  out(`<text x="${lx}" y="${ly-4}" font-family="Arial" font-weight="bold" font-size="4.4" fill="#222">Operators &amp; services</text>`);
  panelMaxX = Math.max(panelMaxX, lx + measureText('Operators & services', 4.4, true));
  // legendWrap:{perRow:N} (optional) — wrap an operator's badge run onto further
  // lines instead of letting it run off the page. Needed once a town has an
  // operator with many routes (High Wycombe: Carousel runs 17 of them). Absent =>
  // one line per operator exactly as before, so gated towns stay byte-identical.
  const LW = (D.legendWrap && (D.legendWrap.perRow|0) > 0) ? (D.legendWrap.perRow|0) : 0;
  if(LW){
    let yy = ly;
    OPS.forEach(op=>{
      const rs = op.routes.filter(r=>C[r] && !HIDDEN_ROUTES.has(r));
      if(!rs.length) return;
      const rows = Math.ceil(rs.length/LW);
      // design.badgeFit: one column pitch for the whole grid, or the columns stop
      // lining up. Widest extra in this operator's run, so a run of discs keeps 7.0.
      const _oxw = badgeXWs(rs, 2.9), _col = 7.0 + 2*_oxw;
      rs.forEach((r,k)=>badge(lx+3+_oxw+(k%LW)*_col, yy+Math.floor(k/LW)*6.2, r, 2.9));
      /* The name goes after the LAST row of badges, not after a notional full one.
       *
       * It used to be drawn beside row 1 at an x past the width of a COMPLETE row —
       * `Math.min(rs.length,LW)*_col`, which for any operator with more routes than fit
       * on a line is the full row width. Carousel runs 17 routes over three rows on High
       * Wycombe, so "Carousel Buses" landed past the panel's own edge (Peter's item 27)
       * while the third row, holding just three badges, had room going spare. Anchoring
       * to the last row uses that room and puts the name where the grid actually ends,
       * which is also where the eye finishes reading it.
       */
      const _lastRow = rows - 1, _lastCount = rs.length - _lastRow*LW;
      const _textX = lx + _lastCount*_col + 2, _textY = yy + _lastRow*6.2;
      out(`<text x="${_textX.toFixed(2)}" y="${(_textY+0.2).toFixed(2)}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`);
      panelMaxX = Math.max(panelMaxX, _textX + measureText(op.name,3.4));
      panelMaxY = Math.max(panelMaxY, yy + (rows-1)*6.2 + 3);
      yy += rows*6.2 + 1.4;
    });
    ly = yy - 6.6*OPS.length;   // keep the note's default offset sane
  } else
  OPS.forEach((op,i)=>{ const yy=ly+i*6.6; let bx=lx;
    // design.badgeFit: bx already walks left-to-right, so each badge takes the room
    // it actually needs and the next one starts after it (7.0 = 5.8mm disc + 1.2mm gap).
    op.routes.filter(r=>!HIDDEN_ROUTES.has(r)).forEach(r=>{ const w=badgeXW(r,2.9); badge(bx+3+w,yy,r,2.9); bx+=7.0+2*w; });
    out(`<text x="${bx+2}" y="${(yy+0.2).toFixed(2)}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`);
    panelMaxX = Math.max(panelMaxX, bx+2 + measureText(op.name,3.4));
    panelMaxY = Math.max(panelMaxY, yy+3); });
  /* The line-style key. style-guide §9 rule 7 says a sheet that shares a HUE must say
   * why, and an unexplained line WEIGHT or PATTERN is worse, because the reader can see
   * it is deliberate and cannot tell what it claims. The internal sheets got a frequency
   * key in the tier round; the externals got nothing at all, and a dashed spoke has meant
   * "certain days only" on them since the first build (Peter's item 29).
   *
   * Only drawn when a spoke on THIS sheet is actually dashed — a key line for a class the
   * town has none of would be a lie about the network, the same rule the internal Key's
   * tier rows follow. So March, whose every service runs daily, gains nothing and stays
   * byte-identical.
   *
   * The sample is 12mm of the real thing: same width, same dash array, same butt cap the
   * spokes use, so what the key shows and what the map draws cannot drift apart. TWELVE,
   * not the six it started at — at 6mm the 2.6/2.4 pattern fits two blocks and one gap and
   * reads as a pair of squares rather than as a dashed line, which is the one thing the row
   * has to communicate.
   */
  let lineKeyBottom = null;
  if(EXT.some(b=>b.limited && C[b.route] && !HIDDEN_ROUTES.has(b.route))){
    const _ky = ly + OPS.length*6.6 + 1.0;
    out(`<path d="M${lx.toFixed(2)} ${_ky.toFixed(2)}h12.00" fill="none" stroke="#888" stroke-width="3.4" stroke-dasharray="2.6 2.4" stroke-linecap="butt"/>`);
    out(`<text x="${(lx+14).toFixed(2)}" y="${(_ky+0.2).toFixed(2)}" font-family="Arial" font-size="2.9" fill="#666" dominant-baseline="central">${esc(LIMITED_KEY)}</text>`);
    panelMaxX = Math.max(panelMaxX, lx+14 + measureText(LIMITED_KEY,2.9));
    panelMaxY = Math.max(panelMaxY, _ky + 2);
    lineKeyBottom = _ky + 2;
  }
  // Word-wrapped to the legend panel's own content width, so a long note (several
  // multi-arm routes, or long destination names) breaks onto further lines instead
  // of running off the page — it used to be one unbounded <text>.
  if(armNote){
    const _nx=(OV.note&&OV.note.x!=null)?OV.note.x+dx:lx, _ny=(OV.note&&OV.note.y!=null)?OV.note.y+dy:(lineKeyBottom!=null ? lineKeyBottom+4.4 : ly+OPS.length*6.6+3);
    // Wrap width: an explicit legendAt.box caps it to the box's own interior (so the note can
    // never spill past a hand-tuned panel); otherwise prefer a wide-but-short wrap (110mm floor)
    // over a narrow-but-tall one — the auto panel's HEIGHT is what risks colliding with a nearby
    // terminus lozenge (St Ives: the default 60mm floor wrapped to 6 lines, reaching low enough
    // to cover the Hinchingbrooke box; 110mm wraps the same note to 3).
    // Measured in mm on the real advances, not in characters: the note now fills the
    // width it is given instead of stopping ~16% short of it (see measureText).
    const _panelW = _box ? (_box.w - 8) : Math.max(panelMaxX - lx, 100);
    const _noteLines = wrapMm(armNote, _panelW, 2.9);
    _noteLines.forEach((ln,i)=>out(`<text x="${_nx}" y="${(_ny+i*3.6).toFixed(2)}" font-family="Arial" font-size="2.9" fill="#666">${esc(ln)}</text>`));
    panelMaxX = Math.max(panelMaxX, _nx + Math.max(..._noteLines.map(ln=>measureText(ln,2.9))));
    panelMaxY = Math.max(panelMaxY, _ny + (_noteLines.length-1)*3.6 + 2);
  }
  out = realOut;
  // legendAt.box may override just one dimension (e.g. width, to steer clear of a spoke
  // label) — the other stays auto-sized to content instead of freezing at a stale value.
  //
  // BUT IT MAY NOT SHRINK THE RESERVATION BELOW THE INK (OA-157, 2026-08-30). This box
  // sizes three things at once: the white backing panel, the rectangle registered as a
  // hard box for the label placer, and the rectangle legendPlace searches with. It has
  // never sized the legend's CONTENT. Set it smaller than the content and the text keeps
  // its full extent while all three shrink around it — measured on Wisbech at
  // legendAt.box:{w:20,h:15}: the panel drew 20 x 15mm at (6,30), bottom edge y=45, and
  // the legend's own text ran to y=155, 110mm below its own plate, printing over the
  // spokes with nothing behind it. legendSpot() was handed the 20 x 15 rectangle, found
  // it clear, and reported success.
  //
  // That is the named shape RESERVE FOR WHAT YOU WILL DRAW, arriving in the one place
  // the engine offers an explicit override for the reservation — which is worse than
  // the general case, because the override exists precisely to be reached for when the
  // legend is in the way, the moment somebody is most likely to type a number that is
  // too small.
  //
  // So grow it back and SAY SO, rather than refusing: the sheet still needs a legend,
  // and a silent clamp would leave the person who typed the number believing it took.
  // NOTHING ON THE ESTATE MOVES — measured 2026-08-30, the two towns that set a box
  // both ask for more than their content (High Wycombe w=92 for 88.28mm, Wisbech w=78
  // for 77.63mm) and neither sets h at all, so this starts green, which is the
  // precondition every gate on this project needs.
  const _contentW = panelMaxX - lx + 8;
  const _contentH = panelMaxY - (legendTopY-10) + 4;
  let bw = (_box && _box.w!=null) ? _box.w : _contentW;
  let bh = (_box && _box.h!=null) ? _box.h : _contentH;
  if(_box && (bw < _contentW || bh < _contentH)){
    const asked = [];
    if(bw < _contentW){ asked.push('w='+bw+' for '+_contentW.toFixed(1)+'mm of content'); bw = _contentW; }
    if(bh < _contentH){ asked.push('h='+bh+' for '+_contentH.toFixed(1)+'mm of content'); bh = _contentH; }
    // Once per build, not once per buildLegend() call — legendPlace builds it twice
    // when it moves the legend, and the same config note twice is noise.
    if(!_boxWarned){
      _boxWarned = true;
      process.stderr.write('legend: legendAt.box is smaller than the legend it backs — '+asked.join(', ')
        +'. Grown back to the content. The box also sizes the rectangle legendPlace reserves and the '
        +'hard box labels dodge, so a box smaller than the ink tells both searches a rectangle the '
        +'legend does not occupy. To make the legend itself smaller, use legendWrap or fewer rows.\n');
    }
  }
  return { buf: legendBuf, x: lx-4, y: legendTopY-10, w: bw, h: bh };
}
/*
 * design.legendPlace — let the legend find its own clear ground. Absent => the
 * legend stays exactly where legendAt (or the default 10,40) puts it, byte-identical.
 *
 * WHY THIS EXISTS. The legend is furniture: pinned in page coordinates and drawn
 * AFTER the spider, on an opaque panel. It is registered as a hard box for the
 * label placer, so LABELS dodge it — but the spokes, terminus lozenges and route
 * lines are laid out with no knowledge of it whatever, and simply disappear
 * underneath. Until 2026-08-16 the only defence was legendAt, a hand-tuned
 * constant per town, and four towns carried one; the other four sat at the
 * default and happened to be clear. Every one of those eight positions is tuned
 * against the CURRENT bearings, so one composition change invalidates all of them
 * at once — which is exactly what design.spokeSpread did, burying 62 pieces of
 * artwork across six towns while every defect metric went DOWN, because
 * quality_metrics.js measures the map and the legend is not the map.
 *
 * The internal sheet solved this class of problem already (gen_internal.js,
 * spotSearch: "the blank-space search, shared by every free-floating page
 * device"). This is that idea for the external sheet, with the same two rules —
 * a page device belongs at the EDGE of the sheet, so among equally clear
 * positions the one nearest a frame corner wins; and a configured position is
 * honoured when it is clear, so a town that has hand-placed its legend keeps it.
 */
const LEGPLACE = DESIGN.legendPlace !== false;
const legendSpot = (w, h, wantX, wantY) => {
  /*
   * TWO occupancies, not one, because the two things the legend can cover are not
   * equally bad. A terminus lozenge, the hub or a tick is a NAMED PLACE: cover it
   * and the reader loses a destination with nothing to tell them it was ever
   * there. A route line is a stroke: cover a stretch of it and the line is still
   * legible either side. So symbols are a hard constraint and route ink is the
   * thing minimised within it. Scoring them as one weighted number, which the
   * first cut of this did, buys a slightly cleaner sheet by burying a lozenge —
   * exactly the trade this whole fix exists to refuse.
   */
  const pal = new Set(Object.values(C||{}).map(v=>String(v).toLowerCase()));
  const inkL = new Labeller({ page:[W,H] });
  inkL.stampSvg(s, (stroke,wd)=> pal.has(stroke) && wd>=1.2);
  const symL = new Labeller({ page:[W,H] });
  for(const b of ART) symL.stampBox(b);
  // Summed-area tables. Without them, scoring ~15,000 candidate positions against
  // an 80x90 mm box is ~400 million cell reads; with them every candidate is four.
  const sat = (g)=>{
    const nx=g.nx, ny=g.ny, T = new Int32Array((nx+1)*(ny+1));
    for(let gy=0; gy<ny; gy++){
      let run = 0;
      for(let gx=0; gx<nx; gx++){ run += g.a[gy*nx+gx] ? 1 : 0; T[(gy+1)*(nx+1)+gx+1] = T[gy*(nx+1)+gx+1] + run; }
    }
    return T;
  };
  const clampi = (v,lo,hi)=> v<lo?lo:(v>hi?hi:v);
  const mk = (g)=>{
    const T = sat(g), nx=g.nx, ny=g.ny, cell=g.cell;
    return (x0,y0)=>{
      const gx0 = clampi(Math.floor(x0/cell), 0, nx), gx1 = clampi(Math.ceil((x0+w)/cell), 0, nx);
      const gy0 = clampi(Math.floor(y0/cell), 0, ny), gy1 = clampi(Math.ceil((y0+h)/cell), 0, ny);
      const tot = (gx1-gx0)*(gy1-gy0);
      if(tot<=0) return 1;
      const hit = T[gy1*(nx+1)+gx1] - T[gy0*(nx+1)+gx1] - T[gy1*(nx+1)+gx0] + T[gy0*(nx+1)+gx0];
      return hit/tot;
    };
  };
  const inkCover = mk(inkL.ink), symCover = mk(symL.ink);
  // The frame the labeller itself works to, so the legend cannot stray under the
  // title block or the footer band.
  const FX0=6, FY0=30, FX1=291, FY1=FRAME_Y1;
  const wantSym = symCover(wantX, wantY), wantInk = inkCover(wantX, wantY);
  if(wantSym <= 0 && wantInk <= 0.005) return { moved:false, want:wantInk, wantSym };
  const cnr=[[FX0,FY0],[FX1,FY0],[FX0,FY1],[FX1,FY1]];
  /*
   * Covering NO symbol is a qualification, not a preference. A position that
   * buries fewer lozenges than the current one is not thereby a good position,
   * and ranking by "least symbol area" produced the worst result of this whole
   * exercise: High Wycombe's 92x80 mm legend parked itself on the HUB — the town
   * the sheet is about — because that scored lower than the three spokes it was
   * covering before. Among clear positions, least route ink then nearest a frame
   * corner, a page device belonging at the edge of the sheet rather than floating
   * in the middle of it.
   */
  let best=null;
  for(let by=FY0; by<=FY1-h; by+=1) for(let bx=FX0; bx<=FX1-w; bx+=1){
    if(symCover(bx,by) > 0) continue;
    const ink = inkCover(bx,by);
    if(best && ink > best.ink + 1e-9) continue;
    const d = Math.min(...cnr.map(c=>Math.hypot(bx-c[0],by-c[1])));
    if(!best || ink < best.ink - 1e-9 || d < best.d - 1e-9) best={bx,by,ink,d};
  }
  // No clear position => leave the legend where the town put it and say so. A
  // sheet whose legend cannot be placed clear needs a SMALLER legend (legendWrap,
  // legendAt.box) — shuffling an oversized box around is not a fix, and moving it
  // somewhere equally bad costs the reader the one thing they had, which is
  // knowing where the legend lives from one version to the next.
  if(!best) return { moved:false, want:wantInk, wantSym, nowhere:true };
  if(wantSym <= 0 && best.ink >= wantInk - 1e-9) return { moved:false, want:wantInk, wantSym };
  return { moved:true, want:wantInk, wantSym, cov:best.ink, sym:0, dx:best.bx-wantX, dy:best.by-wantY };
};
/* A MOVE THAT DOES NOT REACH ZERO IS A RESIDUE, NOT A FIX (OA-207, 2026-08-31).
 * Both pinned page devices below relocate themselves off the artwork and then
 * report the move. Neither said what SURVIVED it, and on three towns something
 * did: Wisbech's teal 60 to Downham Market runs full-strength, fades to a ghost
 * for the width of the help panel, and returns to full teal on the far side.
 * The build printed `moved 152,-16 mm to 162,142` and stopped there, so the one
 * process that knew route ink was still underneath said nothing about it.
 * `legendSpot()` only ever returns a position covering NO symbol, so `sym` is 0
 * by construction and the residue that survives a move is route ink.
 *
 * THE MISSING NUMBER WAS ALREADY MISLEADING PEOPLE. OA-207's own write-up says
 * the panel "still left 8% of route ink underneath" — but 8% was what the
 * CONFIGURED spot covered, printed before the move. Measured on Wisbech, the
 * ink that actually survives the move is 6%. The row misread its own evidence
 * in precisely the way this silence causes: with only a before-figure on the
 * line, the reader has nothing to attach the after-figure to and reuses the
 * one number there is. Both figures are now printed, in that order. */
const residue = (got) => (got.cov > 0
  ? ' STILL over ' + (got.cov * 100).toFixed(0) + '% route ink there — a move that does not reach zero'
    + ' leaves a line the reader has to trace under an opaque panel. quality_metrics.js names which line.'
  : '');
const hardMark = HARD.length;
let LEG = buildLegend(LX0, LY0, 0, 0);
if(LEGPLACE){
  const got = legendSpot(LEG.w, LEG.h, LEG.x, LEG.y);
  if(got.moved){
    HARD.length = hardMark;               // drop the trial build's badge boxes
    LEG = buildLegend(LX0+got.dx, LY0+got.dy, got.dx, got.dy);
    process.stderr.write('legend: the configured spot covers '+(got.wantSym*100).toFixed(1)
      +'% symbols / '+(got.want*100).toFixed(0)+'% route ink — moved '
      +got.dx.toFixed(0)+','+got.dy.toFixed(0)+' mm to '+LEG.x.toFixed(0)+','+LEG.y.toFixed(0)
      +' ('+(got.sym*100).toFixed(1)+'% / '+(got.cov*100).toFixed(0)+'%).'+residue(got)+'\n');
  } else if(got.nowhere){
    process.stderr.write('legend: no position on this sheet leaves a '+LEG.w.toFixed(0)+'x'+LEG.h.toFixed(0)
      +' mm legend clear of every symbol'+(got.wantSym>0 ? ', and where it sits covers '
      +(got.wantSym*100).toFixed(1)+'% of them' : '')+'. Left where it is — shrink it with legendWrap '
      +'or legendAt.box, or make room.\n');
  }
}
if(V2) HARD.push([LEG.x-0.6, LEG.y-0.6, LEG.x+LEG.w+0.6, LEG.y+LEG.h+0.6, 'legend']);
out(`<rect x="${LEG.x.toFixed(2)}" y="${LEG.y.toFixed(2)}" width="${LEG.w.toFixed(2)}" height="${LEG.h.toFixed(2)}" rx="2" fill="#ffffff" fill-opacity="0.94" stroke="#ccc" stroke-width="0.4"/>`);
LEG.buf.forEach(out);

/* ---- design.howToUse: the "how to read this" panel -------------------------
 *
 * WHY (publisher benchmark plan, item 3). TfL puts five plain bullets on every
 * spider map, because a hub-and-spoke diagram is an unfamiliar FORM to most
 * people and this sheet is nothing but one. We had `Operators & services` and a
 * Key: both tell you what a mark MEANS, neither tells you how to read the sheet.
 *
 * The words come from the town's own data, not from a literal (invariant 1): the
 * hub sentence names whatever `externalHubLabel` says, and the journey-time
 * bullet appears only on sheets that actually carry `minutesToDestination`. The
 * not-to-scale bullet appears only when `design.scaleBar:false` has switched off
 * the footer's own sentence, so the sheet never says it twice.
 *
 * `bullets` and `heading` override the lot for a town that wants its own words.
 *
 * ON BY DEFAULT since 2026-08-24, `howToUse:false` to refuse it. All 8 towns had
 * opted in, which is the definition of a default here. NOTE what was NOT flipped:
 * every one of those towns also stores its own three `bullets`, a hand-picked subset
 * of the five derived below, and those stay explicit — they are per-map content, not
 * a repeated flag, and unsetting them would grow every town's panel by two bullets.
 */
const HOWTO = DESIGN.howToUse === false ? null
  : (DESIGN.howToUse == null || DESIGN.howToUse === true ? {} : DESIGN.howToUse);
if(HOWTO){
  const HEAD = HOWTO.heading !== undefined ? HOWTO.heading : 'How to use this map';
  // externalHubLabel carries a newline where the hub BOX wants to break ("St Ives
  // Bus Station/\nPark and Ride"). In a sentence that is just whitespace, and it
  // also makes one un-splittable 20-character token for the wrapper to choke on.
  const HUB_PROSE = String(HUB_LABEL_TXT).replace(/\s+/g, ' ').trim();
  const BULLETS = (Array.isArray(HOWTO.bullets) && HOWTO.bullets.length) ? HOWTO.bullets : (()=>{
    const b = [
      'Find where you want to go, around the edge of the diagram.',
      `Follow its coloured line in to ${HUB_PROSE} at the centre.`,
      'The badge on that line is the bus service number.',
      'The panel headed “Operators & services” says who runs it.',
      'Names printed along a line are its main stops, not every stop.',
    ];
    if(_hasTimes) b.push('A time under a destination is a typical whole journey, not a timetable.');
    if(DESIGN.scaleBar === false) b.push('Not to scale — directions and distances are simplified.');
    return b;
  })();
  const HS = HOWTO.headingSize!=null ? +HOWTO.headingSize : 4.4;   // matches the legend header
  const BS = HOWTO.size!=null ? +HOWTO.size : 3.2;                 // style-guide floor for body type
  // WIDE AND SHORT, deliberately. The first cut used a 74mm column and produced an
  // 81x72mm panel that nothing on St Ives' sheet could clear, so it sat on a
  // terminus lozenge. buildLegend's note wrap learned the same thing on 2026-08-06
  // and for the same reason: it is a page device's HEIGHT that collides, because
  // the spokes fan out horizontally. 92mm puts most bullets on one line.
  const CW = HOWTO.width!=null ? +HOWTO.width : 92;                // content column, mm
  const PAD = 3.4, LH = BS*1.28, GAP = 1.3, IND = 2.9;
  // Width-based wrap using the real Arial advances, not wrapText()'s character
  // count — a bullet is a whole sentence, and the character estimate is ~11% out
  // on ordinary prose, which is the difference between four lines and five.
  const wrapW = (text, maxMm) => {
    const words = String(text).split(' '), lines = []; let cur = '';
    for(const w of words){
      const t = cur ? cur+' '+w : w;
      if(cur && FONT.textWidth(t, BS, false) > maxMm){ lines.push(cur); cur = w; } else cur = t;
    }
    if(cur) lines.push(cur);
    return lines;
  };
  const WRAPPED = BULLETS.map(t=>wrapW(t, CW-IND));
  const bodyH = WRAPPED.reduce((a,ls)=>a + ls.length*LH + GAP, 0) - GAP;
  const PW = CW + PAD*2;
  const PH = PAD + (HEAD ? HS*1.15 + 1.6 : 0) + bodyH + PAD;
  // Content is a pure function of (px,py), like buildLegend — which is what makes
  // building it twice safe when the placement search moves it.
  const buildHowTo = (px, py) => {
    const buf = [];
    buf.push(`<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${PW.toFixed(2)}" height="${PH.toFixed(2)}" rx="2" fill="#ffffff" fill-opacity="0.94" stroke="#ccc" stroke-width="0.4"/>`);
    let y = py + PAD;
    if(HEAD){
      y += HS*0.86;
      buf.push(`<text x="${(px+PAD).toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${HS}" fill="#222">${esc(HEAD)}</text>`);
      y += HS*0.29 + 1.6;
    }
    WRAPPED.forEach(lines=>{
      y += BS*0.78;
      buf.push(`<text x="${(px+PAD).toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-size="${BS}" fill="#555">•</text>`);
      lines.forEach((ln,i)=>buf.push(`<text x="${(px+PAD+IND).toFixed(2)}" y="${(y+i*LH).toFixed(2)}" font-family="Arial" font-size="${BS}" fill="#333">${esc(ln)}</text>`));
      y += (lines.length-1)*LH + (LH - BS*0.78) + GAP;
    });
    return buf;
  };
  // Default want-position: bottom-left, which is the white space these sheets
  // already carry (the spokes fan out of a central hub and the legend lives top-
  // left). `at:{x,y}` pins it for a town that knows better.
  const HX0 = (HOWTO.at && HOWTO.at.x!=null) ? +HOWTO.at.x : 10;
  const HY0 = (HOWTO.at && HOWTO.at.y!=null) ? +HOWTO.at.y : FRAME_Y1 - PH;
  let hx = HX0, hy = HY0, draw = true;
  // A fully-specified `at` is a decision, so it opts out of the search — unlike
  // legendAt, which is only a preference the search may overrule. The difference
  // is that this panel can decline to appear, so "put it exactly here" needs to
  // mean it, or a town could set `at` and still get nothing.
  const PINNED = !!(HOWTO.at && HOWTO.at.x != null && HOWTO.at.y != null);
  if(HOWTO.place !== false && !PINNED){
    // The legend is furniture too, and it is already on the page — without this
    // the search would happily park the panel on top of it, since ART holds the
    // ARTWORK's boxes and was snapshotted before the legend existed. The legend
    // gets first pick of the clear ground, which is right: it is mandatory and
    // this panel is not.
    ART.push([LEG.x, LEG.y, LEG.x+LEG.w, LEG.y+LEG.h, 'legend']);
    const got = legendSpot(PW, PH, HX0, HY0);
    if(got.moved){
      hx = HX0 + got.dx; hy = HY0 + got.dy;
      process.stderr.write('howToUse: the configured spot covers '+(got.wantSym*100).toFixed(1)
        +'% symbols / '+(got.want*100).toFixed(0)+'% route ink — moved '+got.dx.toFixed(0)+','+got.dy.toFixed(0)
        +' mm to '+hx.toFixed(0)+','+hy.toFixed(0)
        +' ('+((got.sym||0)*100).toFixed(1)+'% / '+((got.cov||0)*100).toFixed(0)+'%).'+residue(got)+'\n');
    } else if(got.nowhere){
      /*
       * NOT DRAWN, rather than drawn where it does harm. This is where an optional
       * page device has to part company with the legend: legendPlace's rule when
       * nothing is clear is "leave it and warn", because a sheet with no legend is
       * not a sheet. A help panel is different — the reader who loses the "St Neots"
       * lozenge underneath it loses a destination and is given nothing to say it was
       * ever there, and gains a paragraph telling them to look around the edge of
       * the diagram for exactly the thing that has just been covered up.
       * Huntingdon's sheet did precisely that, first try. Warn, name the two
       * remedies, and ship the map intact.
       */
      draw = false;
      // refuse(), not stderr.write(): the message is unchanged, and build_log.js
      // has always classified it BLOCKING off the words "NOT DRAWN". What it was
      // missing was the EXIT CODE, which is the only signal the portal's publish
      // path reads — renderMap.js looks at stderr only when the status is
      // non-zero, so on the success path this stream went public unread.
      guardRefuse('howToUse: no position on this sheet leaves a '+PW.toFixed(0)+'x'+PH.toFixed(0)
        +' mm panel clear of every symbol, so it was NOT DRAWN rather than cover one. '
        +'Shrink it (design.howToUse.width, or fewer bullets), make room, or place it '
        +'deliberately with design.howToUse.at — which also switches this search off.');
    }
  }
  if(draw){
    if(V2) HARD.push([hx-0.6, hy-0.6, hx+PW+0.6, hy+PH+0.6, 'howto']);
    buildHowTo(hx, hy).forEach(out);
  }
}

// ---- v2: deduplicate the stop names, then place them all at once ------------
if(V2){
  /*
   * DEDUPLICATION FIRST, because this is not a placement problem.
   *
   * Two spokes that both call at a village each label it, independently. On
   * Huntingdon's sheet "Fenstanton" is printed twice 15 mm apart, each copy across a
   * grey spoke, the two white haloes eating into each other — which reads as garbled
   * text and was originally mis-diagnosed as a collision between two DIFFERENT names.
   * No placer can fix that: both labels are correct, and moving them apart just
   * spreads the redundancy. Say it once. The copy kept is the one nearest the hub,
   * so the name sits on the first spoke a reader traces outward.
   */
  const DEDUPE = DESIGN.dedupeStopsMm!=null ? DESIGN.dedupeStopsMm : 30;
  // A village is often an intermediate stop on one spoke and the DESTINATION of
  // another (St Ives prints "Boxworth" and "Elsworth" twice for exactly that
  // reason). The lozenge is the stronger statement, so it wins and the tick label
  // goes; the tick itself stays, so the fact that the spoke calls there is not lost.
  const kept=ANCH.filter(a=>a[2].startsWith('term:')).map(a=>({text:a[2].slice(5),at:[a[0],a[1]],fixedNode:true}));
  for(const q of REQS.slice().sort((a,b)=>
      (Math.hypot(a.at[0]-HX,a.at[1]-HY)-Math.hypot(b.at[0]-HX,b.at[1]-HY)) || (a.id<b.id?-1:1))){
    if(kept.some(k=>k.text===q.text && Math.hypot(k.at[0]-q.at[0],k.at[1]-q.at[1])<=DEDUPE)) continue;
    kept.push(q);
  }
  const L = new Labeller({ page:[W,H], frame:{x0:6,y0:30,x1:291,y1:190},
                           bounds:{x0:2,y0:28,x1:295,y1:191} });
  const pal=new Set(Object.values(C||{}).map(v=>String(v).toLowerCase()));
  L.stampSvg(s, (stroke,w)=> pal.has(stroke) && w>=1.2);
  for(const h of HARD) L.block([h[0],h[1],h[2],h[3]], h[4]);
  L.block([0,0,120,27],'title');
  L.block([0,193,297,210],'footer');
  for(const a of ANCH) L.anchor(a[0],a[1],a[2]);
  // Keep REQS order (spoke order) so the solve is stable across runs.
  for(const q of REQS) if(kept.includes(q)) L.add(q);
  out(L.svg());
  const un=L.unplaced();
  if(un.length){
    try{ fs.writeFileSync(DIR+'/unplaced-external.json', JSON.stringify(un,null,2)); }catch(e){}
    process.stderr.write('external labels: '+un.length+' unplaced ('+un.map(u=>'"'+u.text+'"').join(', ')+')\n');
  } else { try{ fs.unlinkSync(DIR+'/unplaced-external.json'); }catch(e){} }
  const dropped=REQS.length-kept.length;
  if(dropped) console.log('external: '+dropped+' duplicate stop label(s) merged');
}

// source note
// design.scaleBar reaches this sheet too, but as a sentence rather than a device.
// A radial spider is a tube map — bearings are spread for legibility and spoke
// length carries nothing — so it can never carry a bar, and it was the one sheet
// type saying nothing at all about that. It goes in the footer rather than on the
// map because that is where this sheet already keeps its caveats ("Journey times
// shown are approximate"). Kept short on purpose: a note long enough to WRAP adds
// a line to the footer plate, which moves FOOTER_PLATE_TOP and refits every sheet
// derived from it.
out(footerBand({ ...FOOTER_OPTS, version: D.version, validFrom: D.validFrom || 'Summer 2026' }));

// Optional "coming soon" / validity stamp. Opt-in via routes.json "stamp"
// {heading?, notes:[...], asOf?, externalAt?:[x,y], internalAt?:[x,y]}. Absent => nothing
// emitted (byte-identical for gated towns). Draw future-dated changes from the upcoming report.
function stampNote(cfg,x,y,align){
  if(!cfg) return;
  const notes=Array.isArray(cfg.notes)?cfg.notes:(cfg.notes?[cfg.notes]:[]);
  if(!notes.length && !cfg.asOf) return;
  const HS=3.4,NS=3.0,AS=2.6,lh=3.7,pad=1.8;
  const rows=[]; if(notes.length) rows.push([cfg.heading||'Coming soon',HS,'#b30000',true]);
  notes.forEach(n=>rows.push([n,NS,'#222',false]));
  if(cfg.asOf) rows.push(['Timetable correct as at '+cfg.asOf,AS,'#666',false]);
  const wmm=Math.max(...rows.map(r=>r[0].length*(r[1]*0.56)))+pad*2, hmm=pad*2+lh*rows.length;
  const bx=align==='end'?x-wmm:x, anc=align==='end'?'end':'start', tx=align==='end'?x-pad:x+pad;
  out(`<rect x="${bx.toFixed(2)}" y="${(y-HS-pad+0.3).toFixed(2)}" width="${wmm.toFixed(2)}" height="${hmm.toFixed(2)}" rx="1.4" fill="#fff" fill-opacity="0.9" stroke="#b30000" stroke-width="0.4"/>`);
  let cy=y;
  rows.forEach((r,i)=>{ if(i) cy+=lh; out(`<text x="${tx.toFixed(2)}" y="${cy.toFixed(2)}" font-family="Arial"${r[3]?' font-weight="bold"':''} font-size="${r[1]}" fill="${r[2]}" text-anchor="${anc}">${esc(r[0])}</text>`); });
}
{ const at=(D.stamp&&D.stamp.externalAt)||[10,188]; stampNote(D.stamp, at[0], at[1], 'start'); }

out('</svg>');
fs.writeFileSync(DIR+'/external.svg', s);
console.log('external.svg', s.length, 'bytes;', EXT.length, 'spokes');

// ---- STRICT_GUARDS: report the refusals as an exit code ----------------------
// Last statement in the file, after the artwork is written, exactly as
// gen_internal.js does it: a build that refused something is still worth
// LOOKING at, it is just not worth publishing.
if (reportRefusals('refused to draw something this config asked for -- see the'
    + ' messages above. The sheet is incomplete and nothing on it says so.')) {
  process.exitCode = 1;
}
