// Generates the EXTERNAL bus map ("Buses from March to nearby towns") as SVG.
// RADIAL tube-map: March hub in the centre; every service that leaves town is a
// straight spoke drawn to its terminus, with intermediate towns as ticks.
// (March has no guided-busway / P&R corridor, so this replaces the St Ives layout.)
const fs = require('fs');
const path = require('path');
const _FOOTER = (()=>{ const local=path.join(__dirname,'footer.js');
  try{ if(fs.existsSync(local)) return local; }catch(e){}
  return process.env.SKILL_ASSETS ? path.join(process.env.SKILL_ASSETS,'footer.js')
       : 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/footer.js'; })();
const { footerBand } = require(_FOOTER);
const _LABELLER = (()=>{ const local=path.join(__dirname,'labeller.js');
  try{ if(fs.existsSync(local)) return local; }catch(e){}
  return process.env.SKILL_ASSETS ? path.join(process.env.SKILL_ASSETS,'labeller.js')
       : 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/labeller.js'; })();
const { Labeller } = require(_LABELLER);
const FONT = require(path.join(path.dirname(_LABELLER),'font_metrics.js'));
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
const V2 = LABELS.engine === 'v2';
const DESIGN = D.design || {};
// printSafe: keep drawn content this many mm from the trim. Absent => today's
// geometry exactly (byte-identical for ungated towns). See footer.js's header.
const PSAFE = DESIGN.printSafe != null ? +DESIGN.printSafe : null;
const W = 297, H = 210;
let s = '';
let out = (x) => { s += x + '\n'; };
const esc = (t) => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function wrap(label, max=13){
  if (label.length<=max || label.includes('\n')) return label.split('\n');
  const w=label.split(' '); let a='',b='';
  for(const t of w){ if((a+' '+t).trim().length<=max && !b) a=(a+' '+t).trim(); else b=(b+' '+t).trim(); }
  return b?[a,b]:[a];
}
// wrapText — generic multi-line word wrap (unlike wrap() above, no 2-line cap), used for
// free-text notes (the "runs as two arms" note, etc.) so a long sentence fits a panel width
// instead of running off it as one unbounded line.
function wrapText(text, maxChars){
  const words = String(text).split(' ');
  const lines = []; let cur = '';
  for(const w of words){
    const cand = cur ? cur+' '+w : w;
    if(cand.length > maxChars && cur){ lines.push(cur); cur = w; }
    else cur = cand;
  }
  if(cur) lines.push(cur);
  return lines;
}
// measureText — generous Arial glyph-width estimate (mm), used only to size the auto legend
// backing panel and to pick a word-wrap width; not exact typesetting, deliberately erring wide
// so the panel never clips its own content.
const measureText = (str, size) => String(str).length * size * 0.58;

// ---- primitives -------------------------------------------------------------
function line(pts, color, w=3.4, dashed=false){
  const d = pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
  out(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dashed?' stroke-dasharray="1.6 2.2"':''}/>`);
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
const BFIT = !!(D.design && D.design.badgeFit);
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
function townNode(x,y,label,h=11,timeLabel){
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
  if(PSAFE!=null){
    x = Math.min(Math.max(x, PSAFE + w/2), W - PSAFE - w/2);
    y = Math.min(Math.max(y, PSAFE + hh/2), H - PSAFE - hh/2);
  }
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
out(`<text x="10" y="17" font-family="Arial" font-weight="bold" font-size="11" fill="${TITLE_COL}">Buses from ${esc(D.town)} to nearby towns</text>`);
out(`<text x="10" y="24" font-family="Arial" font-size="5" fill="#444">(from ${esc(D.validFrom)})</text>`);

// ---- hub + radial spokes ----------------------------------------------------
let HX=152, HY=116;                 // hub centre
if(OV.hub){ HX=OV.hub.x; HY=OV.hub.y; }
const RECT={x0:24,y0:34,x1:282,y1:182}; // inset frame the termini sit on
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
const HUBFIT = !!(D.design && D.design.hubFit);
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
      REQS.push({ id:'stop:'+stops[i]+'@'+_key+'#'+i, at:[x,y], text:stops[i], size:2.9,
                  own:[x-1.9,y-1.9,x+1.9,y+1.9], prefer:[perpx,perpy] });
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
  const _autoOff = measureNodeWidth(b.label, _timeLabel)/2 + 4.5 + _bxw;
  const _boff = Math.max((D.badgeOffset != null) ? D.badgeOffset : 8, _autoOff);
  const _bpitch = 8.6 + 2*_bxw;
  _badges.forEach((r,i)=>badge(tx-dx*(_boff+i*_bpitch), ty-dy*(_boff+i*_bpitch), r, 4.0));
  // terminus node
  townNode(tx,ty,b.label,11,_timeLabel);
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
// legendAt:{x,y} (optional) — move the operator legend out of a sector the spokes
// need. Absent => top-left under the title, exactly as before.
const LX0 = (D.legendAt && D.legendAt.x!=null) ? D.legendAt.x : 10;
const LY0 = (D.legendAt && D.legendAt.y!=null) ? D.legendAt.y : 40;
const _box = D.legendAt && D.legendAt.box;
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
  panelMaxX = Math.max(panelMaxX, lx + measureText('Operators & services', 4.4));
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
      const _textX = lx+Math.min(rs.length,LW)*_col+2;
      out(`<text x="${_textX.toFixed(2)}" y="${(yy+0.2).toFixed(2)}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`);
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
  // Word-wrapped to the legend panel's own content width, so a long note (several
  // multi-arm routes, or long destination names) breaks onto further lines instead
  // of running off the page — it used to be one unbounded <text>.
  if(armNote){
    const _nx=(OV.note&&OV.note.x!=null)?OV.note.x+dx:lx, _ny=(OV.note&&OV.note.y!=null)?OV.note.y+dy:(ly+OPS.length*6.6+3);
    // Wrap width: an explicit legendAt.box caps it to the box's own interior (so the note can
    // never spill past a hand-tuned panel); otherwise prefer a wide-but-short wrap (110mm floor)
    // over a narrow-but-tall one — the auto panel's HEIGHT is what risks colliding with a nearby
    // terminus lozenge (St Ives: the default 60mm floor wrapped to 6 lines, reaching low enough
    // to cover the Hinchingbrooke box; 110mm wraps the same note to 3).
    const _panelW = _box ? (_box.w - 8) : Math.max(panelMaxX - lx, 100);
    const _maxChars = Math.max(20, Math.floor(_panelW / (2.9*0.58)));
    const _noteLines = wrapText(armNote, _maxChars);
    _noteLines.forEach((ln,i)=>out(`<text x="${_nx}" y="${(_ny+i*3.6).toFixed(2)}" font-family="Arial" font-size="2.9" fill="#666">${esc(ln)}</text>`));
    panelMaxX = Math.max(panelMaxX, _nx + Math.max(..._noteLines.map(ln=>measureText(ln,2.9))));
    panelMaxY = Math.max(panelMaxY, _ny + (_noteLines.length-1)*3.6 + 2);
  }
  out = realOut;
  // legendAt.box may override just one dimension (e.g. width, to steer clear of a spoke
  // label) — the other stays auto-sized to content instead of freezing at a stale value.
  const bw = (_box && _box.w!=null) ? _box.w : (panelMaxX - lx + 8);
  const bh = (_box && _box.h!=null) ? _box.h : (panelMaxY - (legendTopY-10) + 4);
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
const LEGPLACE = !!(DESIGN.legendPlace);
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
  const FX0=6, FY0=30, FX1=291, FY1=190;
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
      +' ('+(got.sym*100).toFixed(1)+'% / '+(got.cov*100).toFixed(0)+'%).\n');
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
const _hasTimes = EXT.some(b=>b.minutesToDestination!=null);
// design.scaleBar reaches this sheet too, but as a sentence rather than a device.
// A radial spider is a tube map — bearings are spread for legibility and spoke
// length carries nothing — so it can never carry a bar, and it was the one sheet
// type saying nothing at all about that. It goes in the footer rather than on the
// map because that is where this sheet already keeps its caveats ("Journey times
// shown are approximate"). Kept short on purpose: a note long enough to WRAP adds
// a line to the footer plate, which moves FOOTER_PLATE_TOP and refits every sheet
// derived from it.
out(footerBand({
  notes: [`Routes & stops: UK Bus Open Data Service (Open Government Licence v3.0), cross-checked with operators at bustimes.org (June 2026).`,
          `Confirm live times & fares at bustimes.org or operator apps.${_hasTimes?' Journey times shown are approximate.':''}`
            + `${DESIGN.scaleBar?' Diagram — not to scale.':''}`],
  version: D.version, validFrom: D.validFrom || 'Summer 2026',
  safe: DESIGN.printSafe != null ? +DESIGN.printSafe : null
}));

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
