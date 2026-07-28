// Generates the EXTERNAL bus map ("Buses from March to nearby towns") as SVG.
// RADIAL tube-map: March hub in the centre; every service that leaves town is a
// straight spoke drawn to its terminus, with intermediate towns as ticks.
// (March has no guided-busway / P&R corridor, so this replaces the St Ives layout.)
const fs = require('fs');
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
const EDK = process.env.EDITOR_KEYS==='1';
const W = 297, H = 210;
let s = '';
const out = (x) => { s += x + '\n'; };
const esc = (t) => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function wrap(label, max=13){
  if (label.length<=max || label.includes('\n')) return label.split('\n');
  const w=label.split(' '); let a='',b='';
  for(const t of w){ if((a+' '+t).trim().length<=max && !b) a=(a+' '+t).trim(); else b=(b+' '+t).trim(); }
  return b?[a,b]:[a];
}

// ---- primitives -------------------------------------------------------------
function line(pts, color, w=3.4, dashed=false){
  const d = pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
  out(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dashed?' stroke-dasharray="1.6 2.2"':''}/>`);
}
function tick(x,y,color){ out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.5" fill="#fff" stroke="${color}" stroke-width="1.1"/>`); }
function badge(x,y,route,r=4.6){
  out(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${C[route]||'#888'}" stroke="#fff" stroke-width="0.7"/>`);
  out(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${(r*0.95).toFixed(2)}" fill="${TXT[route]||'#fff'}" text-anchor="middle" dominant-baseline="central">${esc(blab(route))}</text>`);
}
function townNode(x,y,label,h=11){
  const lines = wrap(label);
  const w = Math.max(18, Math.max(...lines.map(l=>l.length))*1.95 + 4);
  out(`<rect x="${(x-w/2).toFixed(2)}" y="${(y-h/2).toFixed(2)}" width="${w.toFixed(2)}" height="${h}" rx="2.4" fill="#2e8b57" stroke="#1d5f3a" stroke-width="0.5"/>`);
  const lh=4.0, y0=y-(lines.length-1)*lh/2;
  lines.forEach((ln,i)=>out(`<text x="${x.toFixed(2)}" y="${(y0+i*lh).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="3.4" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(ln)}</text>`));
  return w;
}

// ---- canvas -----------------------------------------------------------------
out(`<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 ${W} ${H}">`);
out(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
const TITLE_COL = D.titleColor || Object.values(C)[0] || '#444';
out(`<text x="10" y="17" font-family="Arial" font-weight="bold" font-size="11" fill="${TITLE_COL}">Buses from ${esc(D.town)} to nearby towns</text>`);
out(`<text x="10" y="24" font-family="Arial" font-size="5" fill="#444">(from ${esc(D.validFrom)})</text>`);
out(`<text x="294" y="150" font-family="Arial" font-size="3.3" fill="#999" text-anchor="end" transform="rotate(-90 294 150)">${esc(D.version)} · Summer 2026</text>`);

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
// draw spokes first (under hub)
const _cnt={}; D.external.forEach(b=>_cnt[b.route]=(_cnt[b.route]||0)+1); const _occ={};
for(const b of D.external){
  _occ[b.route]=(_occ[b.route]||0)+1;
  const _key=_cnt[b.route]>1?b.route+'#'+_occ[b.route]:b.route;
  const _ov=(OV.branches||{})[_key]||{};
  if(EDK) out('<g data-kind="branch" data-key="'+esc(_key)+'">');
  const _bearing=_ov.bearing!=null?_ov.bearing:b.bearing;
  let a=_bearing*Math.PI/180, dx=Math.sin(a), dy=-Math.cos(a);
  let t=rayToRect(dx,dy);
  let tx=HX+dx*t, ty=HY+dy*t;            // terminus point on frame
  if(_ov.terminus){ tx=_ov.terminus.x; ty=_ov.terminus.y; const _l=Math.hypot(tx-HX,ty-HY)||1; dx=(tx-HX)/_l; dy=(ty-HY)/_l; t=_l; }
  const px=-dy, py=dx;                      // unit perpendicular (left of travel)
  const stops=b.stops;                      // intermediate... terminus (last)
  const n=stops.length;
  const R0=14;                              // clear zone around the hub
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
    const lx=x+perpx*5.2, ly=y+perpy*5.2+0.9;
    out(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-family="Arial" font-size="2.9" fill="#222" text-anchor="${labSide}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(stops[i])}</text>`);
  }
  // route badge(s) on the line just inside the terminus node.
  // b.routes:[…] (optional) — several services sharing ONE spoke to a destination.
  // A big town's radial runs out of frame perimeter long before it runs out of
  // services (High Wycombe: 23 spokes, five destinations reached by two routes
  // each), so co-terminating routes share a spoke and stack their badges along it.
  // Absent => a single badge for b.route, exactly as before.
  // badgeOffset (optional) — mm back from the terminus for the first badge; a town
  // with wide destination lozenges needs more clearance. Default 8 = previous behaviour.
  const _boff = (D.badgeOffset != null) ? D.badgeOffset : 8;
  const _badges = (Array.isArray(b.routes) && b.routes.length) ? b.routes : [b.route];
  _badges.forEach((r,i)=>badge(tx-dx*(_boff+i*8.6), ty-dy*(_boff+i*8.6), r, 4.0));
  // terminus node
  townNode(tx,ty,b.label);
  if(EDK) out('</g>');
}
// 56 serves two arms (Manea & Wisbech) — note it once
// hub node on top
if(EDK) out('<g data-kind="hub" data-key="hub">');
(function(){const w=Math.max(22, D.town.length*2.6+6),h=12;   // box widens for longer town names (March=22, byte-identical)
  out(`<rect x="${(HX-w/2).toFixed(2)}" y="${(HY-h/2).toFixed(2)}" width="${w}" height="${h}" rx="2.6" fill="#111" stroke="#000" stroke-width="0.5"/>`);
  out(`<text x="${HX}" y="${HY}" font-family="Arial" font-weight="bold" font-size="5.2" fill="#fff" text-anchor="middle" dominant-baseline="central">${esc(D.town)}</text>`);
})();
if(EDK) out('</g>');

// ---- legend + notes (top-left, under title) ---------------------------------
// legendAt:{x,y} (optional) — move the operator legend out of a sector the spokes
// need. Absent => top-left under the title, exactly as before.
let lx=10, ly=40;
if(D.legendAt){ if(D.legendAt.x!=null) lx=D.legendAt.x; if(D.legendAt.y!=null) ly=D.legendAt.y; }
// legendAt.box:{w,h} (optional) — opaque backing panel, drawn UNDER the legend so it
// can sit over the spokes in a town where every sector carries one. Absent => nothing.
if(D.legendAt && D.legendAt.box){ const bx=D.legendAt.box;
  out(`<rect x="${(lx-4).toFixed(2)}" y="${(ly-10).toFixed(2)}" width="${bx.w}" height="${bx.h}" rx="2" fill="#ffffff" fill-opacity="0.94" stroke="#ccc" stroke-width="0.4"/>`); }
out(`<text x="${lx}" y="${ly-4}" font-family="Arial" font-weight="bold" font-size="4.4" fill="#222">Operators &amp; services</text>`);
// legendWrap:{perRow:N} (optional) — wrap an operator's badge run onto further
// lines instead of letting it run off the page. Needed once a town has an
// operator with many routes (High Wycombe: Carousel runs 17 of them). Absent =>
// one line per operator exactly as before, so gated towns stay byte-identical.
const LW = (D.legendWrap && (D.legendWrap.perRow|0) > 0) ? (D.legendWrap.perRow|0) : 0;
if(LW){
  let yy = ly;
  D.operators.forEach(op=>{
    const rs = op.routes.filter(r=>C[r]);
    if(!rs.length) return;
    const rows = Math.ceil(rs.length/LW);
    rs.forEach((r,k)=>badge(lx+3+(k%LW)*7.0, yy+Math.floor(k/LW)*6.2, r, 2.9));
    out(`<text x="${(lx+Math.min(rs.length,LW)*7.0+2).toFixed(2)}" y="${(yy+0.2).toFixed(2)}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`);
    yy += rows*6.2 + 1.4;
  });
  ly = yy - 6.6*D.operators.length;   // keep the note's default offset sane
} else
D.operators.forEach((op,i)=>{ const yy=ly+i*6.6; let bx=lx;
  op.routes.forEach(r=>{ badge(bx+3,yy,r,2.9); bx+=7.0; });
  out(`<text x="${bx+2}" y="${(yy+0.2).toFixed(2)}" font-family="Arial" font-size="3.4" fill="#333" dominant-baseline="central">${esc(op.name)}</text>`); });
// auto-note any route that leaves town on more than one arm (e.g. "56 runs as
// two arms — to Manea and to Wisbech"), or use D.externalNote to override.
let armNote = D.externalNote;
if(armNote===undefined){
  const arms={}; D.external.forEach(b=>{(arms[b.route]=arms[b.route]||[]).push(b.label);});
  armNote = Object.entries(arms).filter(([,v])=>v.length>1)
    .map(([r,v])=>`${r} runs as two arms — to ${v.slice(0,-1).join(', ')} and to ${v[v.length-1]}.`).join('  ');
}
if(armNote){ const _nx=(OV.note&&OV.note.x!=null)?OV.note.x:lx, _ny=(OV.note&&OV.note.y!=null)?OV.note.y:(ly+D.operators.length*6.6+3);
  out(`<text x="${_nx}" y="${_ny}" font-family="Arial" font-size="2.9" fill="#666">${esc(armNote)}</text>`); }
// source note
out(`<text x="10" y="203" font-family="Arial" font-size="3.0" fill="#666">Routes &amp; stops from bustimes.org, cross-checked with operators (June 2026). Confirm live times &amp; fares at bustimes.org or operator apps.</text>`);

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
console.log('external.svg', s.length, 'bytes;', D.external.length, 'spokes');
