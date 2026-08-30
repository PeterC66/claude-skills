// Generates the EXTERNAL bus map ("Buses from <Town> to nearby places") as SVG.
// (Title wording changed 2026-08-19 with the radial's, Peter's item 4 — "towns" was
// wrong: St Ives alone terminates at Boxworth, Fen Drayton Lakes and two Park & Rides.
// This file is otherwise kept UNEDITED per changing-the-engine.md §2; a title string is
// changed here only so a town adopting the busway layout later cannot inherit the old
// name and quietly disagree with every other sheet.)
// Busway variant: hubs centre; colour branches fan LEFT to towns; the guided busway
// runs as a vertical corridor down the centre-right; a Services panel sits far right.
//
// DATA: read from / written to the TOWN WORKING FOLDER (cwd). Run from inside it.
//
// routes.json keys this generator understands:
//   town, validFrom, version, palette, textOn, operators[]
//   external[]  - left-fan branches. Each: {route, id?, label, days?, stops[], limited?,
//                 loz?:[place,...] (places on this arm to draw as lozenges), via?}
//                 `id` (default = route) keys the row map so a route can have >1 arm
//                 (e.g. 9 + 9-villages, 301 main + 301 via Old Hurst).
//   busway[]    - the A/B corridor (first entry A full, second B).
//   yMap?       - {id:y} explicit row y; otherwise auto-distributed.
//   servicesPanel? - {x?,show?} the right description panel (E1). Omit/show:false = legacy
//                    bottom-left operators legend only.
//   serviceDesc?   - {route:[title, subtitle]} text for the panel (else derived).
//   externalLozenges? - true (auto: places on >=2 arms) or [place,...] explicit (E2).
//   busStationNote?   - string drawn by the Bus Station hub (E6, e.g. the 300 circular).
//   externalNote?     - extra source note line.
const fs = require('fs');
const path = require('path');
const _FOOTER = (()=>{ const local=path.join(__dirname,'footer.js');
  try{ if(fs.existsSync(local)) return local; }catch(e){}
  return process.env.SKILL_ASSETS ? path.join(process.env.SKILL_ASSETS,'footer.js')
       : 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/footer.js'; })();
const { footerBand } = require(_FOOTER);
// dash_fit.js — the dashed-spoke pattern and its mid-gap fit, shared with
// gen_external_radial.js and gen_external_places.js (OA-167). footer.js resolves
// out of the same folder, so its directory is where this lives too.
const { dashFit, polylineLength } = require(path.join(path.dirname(_FOOTER),'dash_fit.js'));
const DIR = process.env.LEAFLET_DIR || process.cwd();
const D = JSON.parse(fs.readFileSync(DIR + '/routes.json', 'utf8'));
const C = D.palette, TXT = D.textOn;
// badgeLabels: optional { <route key>:<badge text> } (see gen_internal.js). Absent => key.
const BL = D.badgeLabels || {};
const blab = r => (BL[r] != null ? BL[r] : r);
const OVF = process.env.OVERRIDES_FILE || (DIR+'/overrides.json');
const ALLOV = (function(){ try{ return JSON.parse(fs.readFileSync(OVF,'utf8')); }catch(e){ return {}; } })();
const OV = ALLOV.external || {};
const RCOL = ALLOV.routeColors || {};            // top-level: recolour a route on BOTH maps
for(const r in RCOL) C[r] = RCOL[r];
// hiddenOperators (opt-in customer edit, top-level overrides.json array of
// routes.json operators[].name) — drops a hidden operator's LEFT-FAN branches
// (external[]) and legend row. Absent/empty => byte-identical. NOTE: the A/B
// busway corridor itself is not filterable (it's drawn as a fixed structural
// block, not a loop over routes) — no currently-built town needs that, since
// no town uses both hiddenOperators and this generator yet.
const HIDDEN_OPS = new Set(ALLOV.hiddenOperators || []);
const HIDDEN_ROUTES = new Set();
if (HIDDEN_OPS.size) (D.operators||[]).forEach(op=>{ if(HIDDEN_OPS.has(op.name)) (op.routes||[]).forEach(r=>HIDDEN_ROUTES.add(r)); });
const OPS = HIDDEN_OPS.size ? D.operators.filter(op=>!HIDDEN_OPS.has(op.name)) : D.operators;
const EDK = process.env.EDITOR_KEYS==='1';
const W = 297, H = 210;
let s = '';
const out = (x) => { s += x + '\n'; };
const esc = (t) => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function wrap(label, max=13){ // split long labels into <=2 lines on a space
  if (label.length<=max || label.includes('\n')) return label.split('\n');
  const w=label.split(' '); let a='',b='';
  for(const t of w){ if(!b && (a==='' || (a+' '+t).trim().length<=max)) a=(a+' '+t).trim(); else b=(b+' '+t).trim(); }
  return b?[a,b]:[a];
}

// ---- de-collision (reserve boxes + greedy placement, like the internal map) ----
const placed=[];
const hits=(b)=>placed.some(o=>!(b[2]<o[0]||b[0]>o[2]||b[3]<o[1]||b[1]>o[3]));
function reserve(x0,y0,x1,y1){placed.push([x0,y0,x1,y1]);}

// ---- primitives -------------------------------------------------------------
// dashed (limited-service) spokes use a BUTT cap, not round. A round cap adds w/2
// of ink beyond EACH end of every dash, so at w=3.4 the old `round` + "1.6 2.2"
// drew 1.6+3.4=5.0 mm of ink separated by 2.2-3.4 = -1.2 mm of gap: the dashes
// overlapped into one scalloped caterpillar and the line read as solid-but-lumpy.
// Butt caps plus a gap comfortably wider than the stroke keep each dash a crisp
// rectangle. The numbers, and the fit that keeps a spoke from ending in a sliver,
// now live in ONE place — dash_fit.js — required by this file, by
// gen_external_radial.js and by the place skill's gen_external_places.js. Until
// 2026-08-30 this was three copies of the same primitive with a comment telling
// the reader to change all three, and that comment failed twice: the 2026-08-06
// butt-cap fix and the 2026-08-29 dash fit were each made in the places copy and
// left out of this one (OA-167). No town draws this layout today, so neither fix
// was ever visible here — which is exactly why a third copy would have drifted
// again. Nothing executes a comment.
function line(pts, color, w=3.4, dashed=false){
  const d = pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
  const cap = dashed ? 'butt' : 'round';
  const dash = dashed ? ` stroke-dasharray="${dashFit(polylineLength(pts))}"` : '';
  out(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="round"${dash}/>`);
}
function tick(x,y,color){ out(`<circle cx="${x}" cy="${y}" r="1.5" fill="#fff" stroke="${color}" stroke-width="1.1"/>`); }
function badge(x,y,route,r=4.6){
  out(`<circle cx="${x}" cy="${y}" r="${r}" fill="${C[route]||'#888'}" stroke="#fff" stroke-width="0.7"/>`);
  out(`<text x="${x}" y="${y}" font-family="Arial" font-weight="bold" font-size="${(r*1.0).toFixed(2)}" fill="${TXT[route]||'#fff'}" text-anchor="middle" dominant-baseline="central">${esc(blab(route))}</text>`);
}
function townNode(x,y,label,h=12,reserveBox=true){
  const lines = wrap(label);
  const w = Math.max(18, Math.max(...lines.map(l=>l.length))*1.9 + 4);
  out(`<rect x="${(x-w/2).toFixed(2)}" y="${y-h/2}" width="${w.toFixed(2)}" height="${h}" rx="2.4" fill="#2e8b57" stroke="#1d5f3a" stroke-width="0.5"/>`);
  const lh=4.0, y0=y-(lines.length-1)*lh/2;
  lines.forEach((ln,i)=>out(`<text x="${x}" y="${(y0+i*lh).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="3.5" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(ln)}</text>`));
  if(reserveBox) reserve(x-w/2-0.5, y-h/2-0.5, x+w/2+0.5, y+h/2+0.5);
  return w;
}
// compact intermediate-place lozenge (E2): smaller green rounded box on the line
function lozenge(x,y,label,color='#2e8b57'){
  const w = Math.max(11, label.length*1.7 + 3.5), h=5.2;
  out(`<rect x="${(x-w/2).toFixed(2)}" y="${(y-h/2).toFixed(2)}" width="${w.toFixed(2)}" height="${h}" rx="2.0" fill="${color}" stroke="#1d5f3a" stroke-width="0.4"/>`);
  out(`<text x="${x}" y="${y}" font-family="Arial" font-weight="bold" font-size="2.9" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`);
  reserve(x-w/2-0.4, y-h/2-0.4, x+w/2+0.4, y+h/2+0.4);
  return w;
}
// stop label with simple de-collision (above, then below, then skip)
function stopLabel(x,y,label,size=3.0,prefer='above',anchor='middle'){
  const lines=wrap(label,14), lh=3.3, wpx=Math.max(...lines.map(l=>l.length))*size*0.52;
  const cand = prefer==='above'
    ? [['above',y-3.2-(lines.length-1)*lh],['below',y+4.2]]
    : [['below',y+4.2],['above',y-3.2-(lines.length-1)*lh]];
  for(const [,baseY] of cand){
    const bx = anchor==='start'?x : anchor==='end'?x-wpx : x-wpx/2;
    const b=[bx-0.6, baseY-lh, bx+wpx+0.6, baseY+(lines.length-1)*lh+1.2];
    if(!hits(b)){ placed.push(b);
      lines.forEach((ln,i)=>out(`<text x="${x}" y="${(baseY+i*lh).toFixed(2)}" font-family="Arial" font-size="${size}" fill="#222" text-anchor="${anchor}" stroke="#fff" stroke-width="0.5" paint-order="stroke">${esc(ln)}</text>`));
      return true; }
  }
  return false;
}

// ---- canvas -----------------------------------------------------------------
out(`<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 ${W} ${H}">`);
out(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
out(`<text x="10" y="17" font-family="Arial" font-weight="bold" font-size="11" fill="${C.B}">Buses from ${esc(D.town)} to nearby places</text>`);
out(`<text x="10" y="24" font-family="Arial" font-size="5" fill="#444">(from ${esc(D.validFrom)})</text>`);

// ---- layout anchors ---------------------------------------------------------
const PANEL = D.servicesPanel || null;
const PANX  = PANEL && PANEL.show!==false ? (PANEL.x!=null?PANEL.x:240) : null;  // panel left edge
const RIGHT = PANX!=null ? PANX-4 : 296;          // right limit for the map area
const BSx=172, BSy=126;   // Bus Station hub
const PRx=172, PRy=52;    // Park & Ride hub
const spineX = 158;       // grey interchange spine for left branches
const leftX1 = 19;        // left terminus centre x
const corX = Math.min(206, RIGHT-30);  // busway corridor x

// reserve the panel + title so labels avoid them
if(PANX!=null) reserve(PANX-3, 0, 297, 210);
reserve(0,0,150,26);

// ===== LEFT BRANCHES =========================================================
const branches = D.external.filter(b=>!HIDDEN_ROUTES.has(b.route)).map(b=>Object.assign({}, b, { id: b.id||b.route }));
// row y: explicit yMap (by id) wins; else auto-distribute across [yTop,yBot]
const yTop=40, yBot=182;
const autoY = {}; branches.forEach((b,i)=>{ autoY[b.id] = branches.length>1 ? yTop+(yBot-yTop)*i/(branches.length-1) : (yTop+yBot)/2; });
const yMap = Object.assign(autoY, D.yMap||{}, OV.yMap||{});

// which intermediate places get lozenges (E2)
let lozSet=null;
if(D.externalLozenges){
  if(Array.isArray(D.externalLozenges)) lozSet=new Set(D.externalLozenges);
  else { const cnt={}; branches.forEach(b=>b.stops.slice(1,-1).forEach(nm=>cnt[nm]=(cnt[nm]||0)+1));
         lozSet=new Set(Object.keys(cnt).filter(k=>cnt[k]>=2)); }
}

function leftBranch(b){
  const route=b.route, y=yMap[b.id], stops=b.stops, n=stops.length, xs=[];
  for(let i=0;i<n;i++) xs.push(spineX-(spineX-leftX1)*(i/(n-1)));
  line(xs.map(x=>[x,y]), C[route], 3.4, b.limited);
  for(let i=1;i<n;i++){
    const x=xs[i], last=(i===n-1);
    if(last){ townNode(x,y,stops[i]); }
    else if(lozSet && lozSet.has(stops[i])){ lozenge(x,y,stops[i]); }
    else { tick(x,y,C[route]); stopLabel(x,y,stops[i],3.0,'above'); }
  }
  // arm label (e.g. "via Old Hurst") under the line near the spine, if given
  if(b.label && b.via===undefined && /via |&/.test(b.label) && b.label!==stops[n-1]){ /* label already the terminus */ }
  badge(spineX+4, y, route, 4.4);   // badge just right of spine, before hub
}
// grey spine + bus-station connector
const ys = branches.map(b=>yMap[b.id]);
line([[spineX,Math.min(...ys)],[spineX,Math.max(...ys)]], '#9aa0a6', 2.0);
line([[spineX,BSy],[BSx-13,BSy]], '#9aa0a6', 2.0);
branches.forEach(b=>{ if(EDK) out('<g data-kind="branch" data-key="'+esc(b.id)+'">'); leftBranch(b); if(EDK) out('</g>'); });

// ===== BUSWAY (vertical corridor, centre-right) ==============================
const A=D.busway[0], B=D.busway[1];
const sharedN = 6;                          // P&R..Histon & Impington shared by A & B
const aX=corX-1.6, bX=corX+1.6;
// shared stop y positions (auto across a band)
const yS0=70, yStep=12.4;
const yShared=[]; for(let i=0;i<sharedN;i++) yShared.push(yS0+i*yStep);
const histY=yShared[sharedN-1];
// link P&R hub to corridor top
line([[PRx,PRy],[corX,PRy],[corX,yShared[0]]], '#9aa0a6', 2.0);
// two close parallel lines down to Histon
line(yShared.map(y=>[aX,y]), C.A, 2.6);
line(yShared.map(y=>[bX,y]), C.B, 2.6);
A.stops.slice(0,sharedN).forEach((nm,i)=>{ if(i===0)return; const y=yShared[i];
  tick(corX,y,'#444'); stopLabel(corX-5,y,nm,2.9,'above','end'); });
// A continues down to Trumpington
const aTail=A.stops.slice(sharedN);          // Orchard Park..Trumpington P&R
const aYs=[histY]; aTail.forEach((nm,i)=>aYs.push(histY+(i+1)*11));
line(aYs.map(y=>[aX,y]), C.A, 2.8);
aTail.forEach((nm,i)=>{ const y=aYs[i+1], last=i===aTail.length-1;
  if(last){ townNode(aX,y,nm); } else { tick(aX,y,C.A); stopLabel(aX-5,y,nm,2.9,'below','end'); } });
// B leaves the busway AT Histon (E3 fix: branch at histY, not one stop early)
const bTail=B.stops.slice(sharedN);          // Cambridge North, Cambridge (Drummer St)
const cnX=Math.min(corX+16, RIGHT-14);
line([[bX,histY],[cnX,histY],[cnX,histY+10]], C.B, 2.8);
tick(cnX,histY,C.B); stopLabel(cnX,histY,bTail[0],2.9,'above','middle');
townNode(cnX,histY+18,bTail[bTail.length-1]);
// A & B badges spaced so circles don't overlap (E8): stack vertically above corridor
badge(aX, yShared[0]-9, 'A', 4.4);
badge(bX, yShared[0]-18, 'B', 4.4);

// hubs on top
townNode(PRx,PRy,D.town+'\nPark & Ride',13);
townNode(BSx,BSy,D.town+'\nBus Station',13);
// BS <-> P&R link in A/B colours (E4): A/B run between the two hubs
line([[PRx-2,PRy+6.5],[BSx-2,BSy-6.5]], C.A, 1.8);
line([[PRx+2,PRy+6.5],[BSx+2,BSy-6.5]], C.B, 1.8);
badge(PRx-2,(PRy+BSy)/2-3,'A',2.7); badge(PRx+2,(PRy+BSy)/2+3,'B',2.7);
// 300 / town-circular note on the Bus Station hub (E6)
if(D.busStationNote){
  const ln=wrap(D.busStationNote,26);
  ln.forEach((t,i)=>out(`<text x="${BSx}" y="${(BSy+10+i*3.4).toFixed(2)}" font-family="Arial" font-size="2.8" fill="#444" text-anchor="middle">${esc(t)}</text>`));
}

// ---- Services panel (E1) ----------------------------------------------------
if(PANX!=null){
  const desc = D.serviceDesc || {};
  function dfor(r){ if(desc[r]) return desc[r];
    const fromB=branches.find(b=>b.route===r); const lbl=fromB?(D.town+' – '+(fromB.label||fromB.stops[fromB.stops.length-1])):r;
    return [lbl, fromB&&fromB.days?fromB.days:'']; }
  let px=PANX, py=16;
  out(`<text x="${px}" y="${py}" font-family="Arial" font-weight="bold" font-size="5.5" fill="#222">Services</text>`); py+=3;
  OPS.forEach(op=>{
    py+=5.4; out(`<text x="${px}" y="${py}" font-family="Arial" font-weight="bold" font-size="3.2" fill="#777">${esc(op.name)}</text>`);
    op.routes.forEach(r=>{ py+=7.2; badge(px+3.6,py,r,3.6);
      const dd=dfor(r), t1=wrap(dd[0],30), t2=wrap(dd[1]||'',34);
      out(`<text x="${px+9}" y="${(py-0.6).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="3.2" fill="#111">${esc(t1[0])}</text>`);
      let sy=py+2.7; if(t1[1]){ out(`<text x="${px+9}" y="${sy.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="3.2" fill="#111">${esc(t1[1])}</text>`); sy+=2.9; }
      if(dd[1]){ t2.forEach(tt=>{ out(`<text x="${px+9}" y="${sy.toFixed(2)}" font-family="Arial" font-size="2.6" fill="#555">${esc(tt)}</text>`); sy+=2.9; }); }
      py = sy-2.9;
    });
  });
}

// ---- bottom-left operators legend (kept when no panel; compact note otherwise) ----
if(PANX==null){
  let lx=10, ly=185;
  out(`<text x="${lx}" y="${ly-4}" font-family="Arial" font-weight="bold" font-size="4.2" fill="#222">Operators &amp; services</text>`);
  OPS.forEach((op,i)=>{ const yy=ly+i*6.2; let bx=lx;
    op.routes.forEach(r=>{ badge(bx+3,yy,r,2.8); bx+=6.6; });
    out(`<text x="${bx+2}" y="${yy}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`); });
}
// source notes (bottom)
out(footerBand({
  // routes.json `checkedAt` — when this map's services were last cross-checked.
  // Hardcoded ", June 2026." here until 2026-08-28; absent => omitted, never guessed.
  // See gen_internal.js's CHECKED_AT for why this is not defaulted from validFrom.
  notes: [`Routes & stops: UK Bus Open Data Service (Open Government Licence v3.0), cross-checked with operators at bustimes.org${D.checkedAt ? `, ${D.checkedAt}` : ''}.`,
          D.externalNote || 'Always confirm live times & fares at bustimes.org or operator apps.'],
  // `|| null`, not `|| 'Summer 2026'`: footer.js draws no "Valid from" line for a
  // falsy value, which is the honest answer for a map that has not said. The old
  // literal was the same fault as the cross-check date it sits beside. Byte-identical
  // for St Ives, the only busway map, which sets validFrom.
  version: D.version, validFrom: D.validFrom || null
}));

// Optional "coming soon" / validity stamp (opt-in via routes.json "stamp"; absent => byte-identical).
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
console.log('external.svg', s.length, 'bytes;', branches.length, 'branches');
