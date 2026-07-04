// Generates the INTERNAL bus map ("Buses within <Town>") as SVG.
// Geo-anchored (real lat/lon, equirectangular + PCA auto-rotation to fill A4),
// route lines traced through stops, river from OSM, POI icons from OSM.
//
// FULLY CONFIG-DRIVEN (2026-06-07): every town-specific value is read from
// routes.json — nothing in this file is St-Ives/March-specific, so the SAME
// template runs UNCHANGED for any town. The per-town keys are:
//   routeOrder[]      internal draw order (defaults to palette key order)
//   panelOrder[]      Services-panel list order (defaults to routeOrder)
//   orientationRoute  route used to orient road-name labels (the town circular
//                     if any; defaults to the route with the most in-town stops)
//   atcoPrefix        in-town stop ATCO prefix for road labels (defaults to the
//                     anchor with its trailing digits stripped, e.g. 0500HSTIV)
//   internalDesc{}    {route:[title,subtitle]} for the Services panel
//   poi{}             POI filter/tidy rules (industrialKeep, excludeName, tidy,
//                     canon, include e.g. ["allotments"])
// (plus anchor/anchorLabel/internalZoom/features/internalBundle/internalTermini
//  already documented below).
//
// INTERNAL ROADS MODEL (2026-06-12, opt-in via routes.json "internalRoads"):
// the road-skeleton drawing model that makes the map read like the hand-made
// leaflet. Needs S2's roads_geo.json (pull_roads.js) + routes_paths.json
// (match_routes.js). When the key is ABSENT everything below is skipped and
// the classic stop-chord model runs byte-identical. Config (all optional):
//   internalRoads: {
//     stroke:1.7, gap:2.8,            // route line width / parallel-lane centre spacing.
//                                      // Visible daylight between adjacent bundled lines =
//                                      // gap-stroke, CONSTANT regardless of route count. gap
//                                      // only just above stroke (e.g. 1.9 vs 1.7 = 0.2mm) reads
//                                      // as one fat band at 300dpi; aim gap >= stroke + ~1mm.
//     corridor:{dist:2.4, angle:22},  // lane-bundling by GEOMETRY not edge id: two
//                                      // projected route segments share a lane-bundle
//                                      // (offset apart, not stacked) when their midpoints
//                                      // are within `dist` mm AND bearings within `angle`
//                                      // deg. Fixes same-road routes the map-matcher split
//                                      // onto different edge ids (they used to draw on one
//                                      // centreline, last colour hiding the rest, and re-
//                                      // converge at each boundary/stop). Raise dist to fuse
//                                      // more aggressively, lower it to avoid merging close
//                                      // parallel streets.
//     skeleton:"#e4e4e4", skeletonPad:1.3,   // road casing colour / extra width (bundle-sized)
//     contextRoads:true, contextColor:"#f0f0f0", contextWidth:0.45, // named side roads
//     focus:{coreKm:1.1, comp:0.5},   // fisheye: built-up-centroid radius kept 1:1 / outer scale.
//                                      // LOWER comp => interchange bigger (smaller compressed
//                                      // extent => higher fit scale); raising coreKm makes it
//                                      // SMALLER. Optional 3-zone: add midKm + outerComp
//                                      // (true<coreKm, moderate comp out to midKm, strong
//                                      // outerComp beyond) to magnify the core while keeping the
//                                      // mid-town moderate; absent => single-band (byte-identical).
//     fitExtra:["ATCO"...],           // extra stops in the fit set (default intown_cfg extraCore)
//     roadLabelMax:12, roadLabelInclude:["OSM name"...], roadRename:[["OSM name","Display name"]...],
//     keyRoads:["OSM name"...],       // drawn at skeleton weight even if no route uses them
//                                      // today; also implicitly label-eligible (folds into
//                                      // the roadLabelInclude effective list, one array to maintain)
//     roadLabelExclude:["OSM name"...], // never label these — a name shared by several
//                                      // out-of-frame localities (e.g. every village's "High
//                                      // Street") aggregates to ONE label at their combined
//                                      // centroid, which can land spuriously inside the town
//                                      // where no such road exists. Drops the label only, not
//                                      // any drawn road line.
//     northArrow:{x,y,len?,angle?},   // small compass for the rotated map. Direction is the
//                                      // screen bearing of north under the active rotation
//                                      // (auto from theta); the schematic passes an explicit
//                                      // `angle` deg since its coords are pre-rotated at
//                                      // rotationDeg 0. Absent => no arrow (gate-safe).
//     badgeEvery:70,                  // route badge spacing along lines (mm)
//     termini:{ r:{start:"X",end:"Y"} } // arrow labels per cut end (falls back to terminiLabels)
//   }
// When internalRoads is present the source note also gets a build-version stamp
// (LEAFLET_VERSION env, else routes.json "version"); absent internalRoads =>
// no stamp, so the non-internalRoads gate towns stay byte-identical.
// Also additive (work in both models, no output when absent): mapNotes[],
// panelGroups, panelRow, keyRow, panelBadge, fareNote.
const fs = require('fs');
const path = require('path');
// All DATA files are read from, and SVG written to, the TOWN WORKING FOLDER
// (the current directory). Run this script from inside the town's folder.
const DIR = process.env.LEAFLET_DIR || process.cwd();
// icons.js (shared code) loads from the skill's assets. Self-resolving so this
// SAME file works whether it is run in-place from assets/ (sibling icons.js) or
// copied into a town's run folder (no sibling -> fall back to the skill path /
// SKILL_ASSETS env). Resolution does not affect SVG output.
const _ICONS = (()=>{ const local=path.join(__dirname,'icons.js');
  try{ if(fs.existsSync(local)) return local; }catch(e){}
  return process.env.SKILL_ASSETS ? path.join(process.env.SKILL_ASSETS,'icons.js')
       : 'C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/icons.js'; })();
const { icon } = require(_ICONS);
const atco2name = JSON.parse(fs.readFileSync(DIR+'/atco2name.json','utf8'));
const RJ  = JSON.parse(fs.readFileSync(DIR+'/routes.json','utf8'));
const C = RJ.palette, TXT = RJ.textOn;
const atco2ll = JSON.parse(fs.readFileSync(DIR+'/atco2ll.json','utf8'));
// Routes to DRAW = the in-town DISPLAY subset (each route traced to the town EDGE,
// derived in S2 from the full both-direction chains). Prefer routes_intown_atco.json;
// fall back to routes_atco.json for towns built before the full-data standard.
const routes  = (function(){
  for(const f of ['routes_intown_atco.json','routes_atco.json']){
    try{ return JSON.parse(fs.readFileSync(DIR+'/'+f,'utf8')); }catch(e){}
  }
  throw new Error('no routes_intown_atco.json or routes_atco.json in '+DIR);
})();
const river   = JSON.parse(fs.readFileSync(DIR+'/river_geo.json','utf8'));
// ---- internalRoads config + data (null/absent => classic model, byte-identical)
const IR = RJ.internalRoads ? (function(){
  const u = (RJ.internalRoads===true)?{}:RJ.internalRoads;
  const o = Object.assign({ stroke:1.7, gap:2.8, skeleton:'#e4e4e4', skeletonPad:1.3,
    contextRoads:true, contextColor:'#f0f0f0', contextWidth:0.45,
    roadLabelMax:12, badgeEvery:70 }, u);       // gap>=stroke+~1mm so bundled lanes read separately (see header)
  o.focus = Object.assign({ coreKm:1.1, comp:0.5 }, u.focus||{});
  return o; })() : null;
let RG=null, RP=null, ICFG={};
if(IR){
  RG = JSON.parse(fs.readFileSync(DIR+'/roads_geo.json','utf8'));
  RP = JSON.parse(fs.readFileSync(DIR+'/routes_paths.json','utf8'));
  try{ ICFG = JSON.parse(fs.readFileSync(DIR+'/intown_cfg.json','utf8')); }catch(e){}
}

// ====== LINEAR FEATURES (river / main road / railway / canal …) =============
// A town has 1–3 key linear features. They are configured in routes.json as
//   "features":[{key,type,label,style{stroke,width,dash},labelPos{x,y},
//                labelColor,labelItalic,labelSize,labelReserve:[x0,y0,x1,y1]}]
// and their geometry comes from S2's features_geo.json (keyed by feature key:
//   { "<key>": [ [ [lat,lon],… ], … ] }  — array of polyline segments).
// Each feature is straightenable/nudgeable via overrides.json -> internal.features[key]
// (hide, move{dx,dy}, points/segments page-mm arrays, label{pos|offset,anchor,text,hide},
// merged style). BACKWARD-COMPAT: with NO "features" config, synthesize ONE river
// feature from river_geo.json using the legacy style/label so existing towns
// (St Ives, March) stay byte-identical. Per-type default styles:
const FEATURE_STYLES = {
  river:   { stroke:'#9ec9e8', width:3.4, dash:null },
  canal:   { stroke:'#7fb0d8', width:2.4, dash:'3 1.6' },
  railway: { stroke:'#888888', width:1.6, dash:null, ties:true },
  road:    { stroke:'#e6a532', width:2.8, dash:null },
  generic: { stroke:'#999999', width:2.2, dash:null }
};
let FEATURES;
if(RJ.features && RJ.features.length){
  let fgeo={}; try{ fgeo=JSON.parse(fs.readFileSync(DIR+'/features_geo.json','utf8')); }catch(e){}
  FEATURES = RJ.features.map(f=>Object.assign({}, f, { geo: fgeo[f.key]||[] }));
} else {
  FEATURES = [{ key:'river', type:'river', label:(RJ.riverLabel||'River Great Ouse'),
    labelPos:{x:40,y:200}, labelColor:'#7fb0d8', labelItalic:true, labelSize:4,
    labelReserve:[34,193,86,203], geo:river }];
}

// ====== TIER-1 MANUAL OVERRIDES (optional; absent/empty => byte-identical) ===
// overrides.json {"internal":{...}} lets you hand-adjust the auto layout and have
// it RE-APPLIED on every regenerate (survives data refreshes). Authored by hand
// or with the drag editor (assets/override-editor.html). Keys are stable: stops
// by ATCO, POIs by "cat:name". Supported: rotationDeg; viewport (frozen fit);
// stops[ATCO].pos{x,y}; align[] (straighten a run of stops onto a line, optional
// snap°); pois[cat:name].{hide,pos|move}; panel/legend/note {x,y} (read below).
// overrides come from OVERRIDES_FILE (editor preview) or the run-dir overrides.json
// NOTE (internalRoads): route geometry comes from the road graph, so stops[ATCO].pos
// moves the stop TICK only, and align/routeStops are ignored; routeOffsets,
// routeColors, features, pois, panel, rotationDeg, viewport all still apply.
const OVF = process.env.OVERRIDES_FILE || (DIR+'/overrides.json');
const ALLOV = (function(){ try{ return JSON.parse(fs.readFileSync(OVF,'utf8')); }catch(e){ return {}; } })();
const OV = ALLOV.internal || {};
// top-level routeColors recolour a route on BOTH maps (no-op when absent)
const RCOL = ALLOV.routeColors || {};
for(const r in RCOL) C[r] = RCOL[r];
const EDK = process.env.EDITOR_KEYS==='1';   // emit data-key attrs ONLY in editor mode

// ====== TOWN CONFIG (all from routes.json — nothing hardcoded) ==============
// ANCHOR = the central interchange / bus-station stop ATCO. It is the labelled
// hub AND the origin for the optional "zoom" compression below.
const ANCHOR = RJ.anchor || '0500HSTIV002';
const ANCHOR_LABEL = RJ.anchorLabel || 'St Ives Bus Station';
// ZOOM-ON-TOWN: when routes run far out along rural approach roads, keep the
// built-up core to scale and pull the outer stops in so the map zooms onto the
// town (user rule, all towns). Set routes.json "internalZoom":{"corePct":0.55,
// "comp":0.22} to enable. Defaults below = identity (no compression).
// (Under internalRoads this is superseded by the focus fisheye.)
const ZOOM = Object.assign({ corePct: 1.0, comp: 1.0 }, RJ.internalZoom || {});
// Route draw order (internal). Default = palette key order.
const order = RJ.routeOrder || Object.keys(C);
// Services-panel list order. Default = draw order.
const panelOrder = RJ.panelOrder || order;
// Internal Services-panel descriptions {route:[title,subtitle]}.
const INTDESC = RJ.internalDesc || {};
// Orientation route for road-name labels: the town circular if named, else the
// route with the most in-town stops (so road labels still align on towns with
// no circular).
const ORI = RJ.orientationRoute
  || Object.keys(routes).sort((a,b)=>(routes[b]?routes[b].length:0)-(routes[a]?routes[a].length:0))[0];
// In-town stop ATCO prefix (road-name labels only look at these). Default: the
// anchor code with trailing digits stripped (0500HSTIV002 -> 0500HSTIV).
const PREFIX = RJ.atcoPrefix || String(ANCHOR).replace(/\d+$/,'');
// POI rules (filter / tidy / canonicalise). All optional; absent => keep named
// industrial, no name excludes, generic tidy only.
const POI = RJ.poi || {};
// ===========================================================================

// ---------- classify POIs from raw OSM ----------
function classify(t){
  if(t.shop==='supermarket') return ['shop', t.name||'Supermarket'];
  if(t.amenity==='pharmacy')  return ['pharmacy', t.name||''];
  if(t.amenity==='doctors')   return ['gp', t.name||''];
  if(t.amenity==='library')   return ['library','Library'];
  if(t.tourism==='museum')    return ['museum','Museum'];
  if(t.amenity==='townhall')  return ['townhall','Town Hall'];
  if(t.amenity==='community_centre') return ['community', t.name||'Community Centre'];
  if(t.leisure==='sports_centre'||t.leisure==='fitness_centre') return ['leisure', t.name||'Leisure'];
  if(t.amenity==='school')    return ['school', t.name||'School'];
  if(t.leisure==='park'||t.leisure==='recreation_ground') return ['park', t.name||'Park'];
  if((POI.include||[]).includes('allotments') && t.landuse==='allotments') return ['allotments', t.name||'Allotments'];
  if(t.landuse==='industrial') return ['industrial', t.name||'Industrial Estate'];
  return null;
}
let pois=[];
for(const f of ['osm.json','osm2.json']){
  for(const e of JSON.parse(fs.readFileSync(DIR+'/'+f,'utf8')).elements){
    const t=e.tags||{}; const c=classify(t); if(!c) continue;
    const ll=e.lat!=null?[e.lat,e.lon]:(e.center?[e.center.lat,e.center.lon]:null); if(!ll) continue;
    pois.push({cat:c[0], name:c[1], ll});
  }
}
// industrial: keep a named list (array), drop all ("none"), or keep any named (default)
const IND = POI.industrialKeep;
pois = pois.filter(p=>{
  if(p.cat!=='industrial') return true;
  if(IND==='none') return false;
  if(Array.isArray(IND)) return IND.includes(p.name);
  return !!(p.name && p.name!=='Industrial Estate');   // default: keep named estates
});
// drop POIs whose name matches any excludeName pattern (case-insensitive, any cat)
const EXN = POI.excludeName||[];
if(EXN.length){ const exRe=new RegExp(EXN.join('|'),'i'); pois=pois.filter(p=>!exRe.test(p.name)); }
// drop unnamed greens (always)
pois = pois.filter(p=> !(p.cat==='park' && (p.name==='Park'||!p.name)));
// tidy names: generic strip, then per-town tidy[] (suffix replaces), then canon[] (whole-name)
const TIDY  = (POI.tidy ||[]).map(([re,to])=>[new RegExp(re),    to]);
const CANON = (POI.canon||[]).map(([re,to])=>[new RegExp(re,'i'),to]);
for(const p of pois){
  p.name = p.name.replace(/\s*\(.*?\)/g,'').replace(/\s*-\s*building$/i,'').trim();
  for(const [re,to] of TIDY) p.name = p.name.replace(re,to);
  for(const [re,to] of CANON) if(re.test(p.name)) p.name=to;
}
// de-duplicate by cat+name, and collapse near-duplicate points (<60 m)
const dedup=[]; const near=(a,b)=>Math.hypot((a[0]-b[0])*111000,(a[1]-b[1])*70000)<60;
outer: for(const p of pois){
  for(const q of dedup){ if(q.cat===p.cat && (q.name===p.name || near(q.ll,p.ll))){ continue outer; } }
  dedup.push(p);
}
pois = dedup;

// ---------- projection: planar -> PCA rotate -> fit ----------
// FIT SET: classic model fits ALL drawn stops; internalRoads fits only the
// town-core stops (locality prefix + extraCore) so out-of-town tails run off
// the frame edge (clipped, with "to X" arrows) instead of shrinking the town.
const stopPts=[];
if(IR){
  const xc=new Set(IR.fitExtra||ICFG.extraCore||[]); const fseen=new Set();
  for(const r in routes) for(const a of routes[r]){ if(fseen.has(a)||!atco2ll[a])continue; fseen.add(a);
    if(a.startsWith(PREFIX)||xc.has(a)) stopPts.push(atco2ll[a]); }
} else {
  for(const r in routes) for(const a of routes[r]) if(atco2ll[a]) stopPts.push(atco2ll[a]);
}
const lat0 = stopPts.reduce((s,p)=>s+p[0],0)/stopPts.length;
const k=Math.cos(lat0*Math.PI/180);
const planar=([lat,lon])=>[lon*k,-lat];
// PCA on stop points
const P=stopPts.map(planar);
const mx=P.reduce((s,p)=>s+p[0],0)/P.length, my=P.reduce((s,p)=>s+p[1],0)/P.length;
let sxx=0,sxy=0,syy=0; for(const [x,y] of P){const dx=x-mx,dy=y-my; sxx+=dx*dx; sxy+=dx*dy; syy+=dy*dy;}
let theta=0.5*Math.atan2(2*sxy, sxx-syy);              // principal axis angle
if(OV.rotationDeg!=null) theta = -OV.rotationDeg*Math.PI/180;   // manual rotation override
else if(IR && IR.rotationDeg!=null) theta = -IR.rotationDeg*Math.PI/180; // config rotation (0 = north up)
const cosT=Math.cos(-theta), sinT=Math.sin(-theta);
const rot=([x,y])=>{const dx=x-mx,dy=y-my; return [dx*cosT-dy*sinT, dx*sinT+dy*cosT];};
const tform0=ll=>rot(planar(ll));
// --- optional radial distance-compression so the map zooms onto the town -----
// Classic: keep the inner `corePct` of stops (by distance from ANCHOR) to scale,
// draw the rest at `comp`× their extra distance (defaults => identity).
// internalRoads: fisheye centred on the BUILT-UP CENTROID — everything within
// focus.coreKm stays 1:1, beyond that distances scale by focus.comp; applied to
// stops, roads, river and POIs alike so the layers stay mutually consistent.
const O = IR ? (function(){
          const fc=IR.focus.center;                       // [lat,lon] | 'centroid' | default = anchor
          if(Array.isArray(fc)) return tform0(fc);
          if(fc!=='centroid' && atco2ll[ANCHOR]) return tform0(atco2ll[ANCHOR]);
          const t=stopPts.map(tform0);return [t.reduce((s,p)=>s+p[0],0)/t.length, t.reduce((s,p)=>s+p[1],0)/t.length]; })()
        : (atco2ll[ANCHOR] ? tform0(atco2ll[ANCHOR])
        : (function(){const t=stopPts.map(tform0);return [t.reduce((s,p)=>s+p[0],0)/t.length, t.reduce((s,p)=>s+p[1],0)/t.length];})());
const _radii = stopPts.map(p=>{const[x,y]=tform0(p); return Math.hypot(x-O[0],y-O[1]);}).sort((a,b)=>a-b);
const R0 = IR ? IR.focus.coreKm/111.32
         : _radii[Math.min(_radii.length-1, Math.floor(_radii.length*ZOOM.corePct))];
const CPF = IR ? IR.focus.comp : ZOOM.comp;
// Optional THREE-ZONE fisheye (internalRoads only): true scale inside coreKm,
// moderate `comp` in a middle band out to `midKm`, then STRONG `outerComp` beyond.
// Compressing the far tails harder shrinks the fitted extent, so fit-to-frame
// magnifies the true-scale core -> the bus-station interchange gets breathing
// room without changing mid-town spacing. Absent midKm/outerComp => the original
// single-band behaviour (byte-identical). (St Ives item 4a, 2026-07-04.)
const R1  = (IR && IR.focus.midKm!=null)     ? IR.focus.midKm/111.32 : null;
const CPF2= (IR && IR.focus.outerComp!=null) ? IR.focus.outerComp    : CPF;
function compress([x,y]){ if(CPF>=1 && R1===null) return [x,y];
  const dx=x-O[0], dy=y-O[1], r=Math.hypot(dx,dy);
  if(r<=R0 || r===0) return [x,y];
  const nr = (R1!==null && r>R1) ? R0+(R1-R0)*CPF+(r-R1)*CPF2 : R0+(r-R0)*CPF;
  return [O[0]+dx/r*nr, O[1]+dy/r*nr]; }
const tform=ll=>compress(tform0(ll));
// viewport (map left/centre; right reserved for panel)
const MX0=6, MX1=196, MY0=30, MY1=205;
const allT=stopPts.map(tform);
let minX=Math.min(...allT.map(p=>p[0])),maxX=Math.max(...allT.map(p=>p[0]));
let minY=Math.min(...allT.map(p=>p[1])),maxY=Math.max(...allT.map(p=>p[1]));
const pad=0.0006; minX-=pad;maxX+=pad;minY-=pad;maxY+=pad;
// internalRoads: fit with an inner margin so edge stops sit comfortably inside
// the frame (ticks/arrows otherwise clip at the boundary). Default 4 mm.
const FM = IR ? (IR.fitMargin!=null?IR.fitMargin:4) : 0;
let sc=Math.min((MX1-MX0-2*FM)/(maxX-minX),(MY1-MY0-2*FM)/(maxY-minY));
let offX=(MX1-MX0-(maxX-minX)*sc)/2, offY=(MY1-MY0-(maxY-minY)*sc)/2;
// frozen viewport: once you hand-place stops the editor freezes the fit so absolute
// page positions stay valid across data refreshes (new stops project into the same frame)
if(OV.viewport){ ({minX,maxX,minY,maxY,sc,offX,offY}=OV.viewport); }
if(EDK) console.error('VIEWPORT '+JSON.stringify({minX,maxX,minY,maxY,sc,offX,offY}));
const XY=ll=>{const [x,y]=tform(ll); return [MX0+offX+(x-minX)*sc, MY0+offY+(y-minY)*sc];};
// ---- stop-position overrides (page mm), two layers so editing one route never
//      moves another route that shares the stop -----------------------------------
// BASE layer: stops[ATCO].pos moves the physical stop for EVERY route through it.
const baseOv={};
for(const a in (OV.stops||{})){ const o=OV.stops[a]; if(o&&o.pos) baseOv[a]=[o.pos.x,o.pos.y]; }
const baseXY=a=> baseOv[a] ? baseOv[a] : XY(atco2ll[a]);
// PER-ROUTE layer: routeStops[route][ATCO].pos + align[] straighten runs (route-scoped).
const routeOv={};                                       // routeOv[route][ATCO] = [x,y]
const setR=(r,a,xy)=>{ (routeOv[r]=routeOv[r]||{})[a]=xy; };
const rpos=(r,a)=> (routeOv[r]&&routeOv[r][a]) ? routeOv[r][a] : baseXY(a);
for(const r in (OV.routeStops||{})){ const m=OV.routeStops[r]||{};
  for(const a in m){ if(m[a]&&m[a].pos) setR(r,a,[m[a].pos.x,m[a].pos.y]); } }
for(const al of (OV.align||[])){
  const seq=routes[al.route]; if(!seq) continue;
  // explicit selected stops; legacy {from,to} (no stops[]) expands to the route-order span
  let list = (al.stops&&al.stops.length) ? al.stops.filter(a=>seq.indexOf(a)>=0)
    : (function(){ const i0=seq.indexOf(al.from), i1=seq.indexOf(al.to); if(i0<0||i1<0) return [];
        const lo=Math.min(i0,i1),hi=Math.max(i0,i1); return seq.slice(lo,hi+1); })();
  list = list.slice().sort((x,y)=>seq.indexOf(x)-seq.indexOf(y));
  if(list.length<2) continue;
  let A=rpos(al.route,list[0]), B=rpos(al.route,list[list.length-1]);
  if(al.snap){ const dx=B[0]-A[0],dy=B[1]-A[1],L=Math.hypot(dx,dy);
    const step=al.snap*Math.PI/180; const ang=Math.round(Math.atan2(dy,dx)/step)*step;
    B=[A[0]+Math.cos(ang)*L, A[1]+Math.sin(ang)*L]; }
  if(al.mode==='even'){                                  // distribute evenly along the line
    for(let i=0;i<list.length;i++){ const t=i/(list.length-1);
      setR(al.route,list[i],[A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t]); }
  } else {                                               // 'project' (default): keep natural spacing
    const ux=B[0]-A[0], uy=B[1]-A[1], LL=Math.hypot(ux,uy)||1, ex=ux/LL, ey=uy/LL;
    setR(al.route,list[0],A); setR(al.route,list[list.length-1],B);
    for(let i=1;i<list.length-1;i++){ const P=rpos(al.route,list[i]);
      const d=(P[0]-A[0])*ex+(P[1]-A[1])*ey; setR(al.route,list[i],[A[0]+ex*d, A[1]+ey*d]); }
  }
}
const XYS=a=> baseXY(a);            // base accessor (anchor / road labels share one position)

// ---------- svg helpers ----------
const W=297,H=210; let s=''; const out=x=>{s+=x+'\n';};
const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// editor-only element keys (no-op unless EDITOR_KEYS=1, so normal output is unchanged)
const gk=(kind,key,inner)=> EDK ? `<g data-kind="${kind}" data-key="${esc(key)}">${inner}</g>` : inner;
function badge(x,y,r,rad=4.6){out(`<circle cx="${x}" cy="${y}" r="${rad}" fill="${C[r]||'#888'}" stroke="#fff" stroke-width="0.7"/>`);
  out(`<text x="${x}" y="${y}" font-family="Arial" font-weight="bold" font-size="${(rad).toFixed(2)}" fill="${TXT[r]||'#fff'}" text-anchor="middle" dominant-baseline="central">${esc(r)}</text>`);}
function cross(x,y,col){const a=1.0,b=2.6;out(`<rect x="${x-a/2}" y="${y-b/2}" width="${a}" height="${b}" fill="${col}"/><rect x="${x-b/2}" y="${y-a/2}" width="${b}" height="${a}" fill="${col}"/>`);}

// ---- linear features: paths + labels (honour overrides.features[key]) ----
const featOv = f => (OV.features||{})[f.key]||{};
const featStyle = f => Object.assign({}, FEATURE_STYLES[f.type]||FEATURE_STYLES.generic,
                                      f.style||{}, featOv(f).style||{});
function featSegs(f){              // page-mm polylines, honouring straighten/move overrides
  const ov=featOv(f); let segs;
  if(ov.segments) segs = ov.segments.map(s=>s.map(p=>[p[0],p[1]]));      // straighten (page mm)
  else if(ov.points) segs = [ov.points.map(p=>[p[0],p[1]])];
  else segs = f.geo.map(seg=>seg.map(p=>XY(p)));                          // project geo -> page mm
  const dx=(ov.move&&ov.move.dx)||0, dy=(ov.move&&ov.move.dy)||0;         // nudge whole feature
  if(dx||dy) segs = segs.map(s=>s.map(p=>[p[0]+dx,p[1]+dy]));
  return segs;
}
function drawFeature(f){
  if(featOv(f).hide) return;
  const st=featStyle(f), segs=featSegs(f);
  const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : '';
  const lines=[];
  for(const seg of segs){
    const d=seg.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
    lines.push(`<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}"${dash} stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  if(st.ties){                     // railway cross-ties (perpendicular ticks)
    for(const seg of segs) for(let i=0;i<seg.length-1;i++){
      const [x0,y0]=seg[i],[x1,y1]=seg[i+1], L=Math.hypot(x1-x0,y1-y0); if(!L) continue;
      const nx=-(y1-y0)/L, ny=(x1-x0)/L, t=st.width*0.9;
      for(let dd=1.1; dd<L; dd+=2.2){ const cx=x0+(x1-x0)*dd/L, cy=y0+(y1-y0)*dd/L;
        lines.push(`<path d="M${(cx-nx*t).toFixed(2)} ${(cy-ny*t).toFixed(2)}L${(cx+nx*t).toFixed(2)} ${(cy+ny*t).toFixed(2)}" stroke="${st.stroke}" stroke-width="0.5"/>`); }
    }
  }
  out(gk('feature', f.key, lines.join('\n')));
}
function drawFeatureLabel(f){
  const ov=featOv(f), lov=ov.label||{};
  if(ov.hide || lov.hide || !f.labelPos) return;
  let x=f.labelPos.x, y=f.labelPos.y;
  x+=(ov.move&&ov.move.dx)||0; y+=(ov.move&&ov.move.dy)||0;               // follow the feature nudge
  if(lov.pos){ x=lov.pos.x; y=lov.pos.y; } else if(lov.offset){ x+=lov.offset.dx; y+=lov.offset.dy; }
  const text=lov.text!=null?lov.text:f.label;
  const italic=f.labelItalic!==false, size=f.labelSize||4, anchor=lov.anchor||null;
  out(`<text x="${x}" y="${y}" font-family="Arial" ${italic?'font-style="italic" ':''}font-size="${size}"${anchor?` text-anchor="${anchor}"`:''} fill="${f.labelColor||'#7fb0d8'}">${esc(text)}</text>`);
}

// ---- label de-collision: reserved boxes + greedy placement ----
const placed=[];                 // [x0,y0,x1,y1]
const overlaps=(b)=>placed.some(o=>!(b[2]<o[0]||b[0]>o[2]||b[3]<o[1]||b[1]>o[3]));
function reserve(x0,y0,x1,y1){placed.push([x0,y0,x1,y1]);}
function placeLabel(x,y,text,sz=2.6,col='#222',italic=false,lov=null){
  const w=text.length*sz*0.52, h=sz;
  let chosen=null;
  if(lov && lov.offset){                       // manual label placement (skip de-collision)
    const anc=lov.anchor||'start'; chosen=[x+lov.offset.dx, y+lov.offset.dy, anc];
  } else {
    const cands=[[x+2.6,y+0.9,'start'],[x-2.6,y+0.9,'end'],[x,y-2.6,'middle'],[x,y+3.6,'middle'],
                 [x+2.6,y-2.2,'start'],[x-2.6,y-2.2,'end'],[x+2.6,y+3.4,'start'],[x-2.6,y+3.4,'end']];
    for(const [lx,ly,anc] of cands){
      const bx = anc==='start'?lx : anc==='end'?lx-w : lx-w/2;
      const b=[bx-0.4,ly-h,bx+w+0.4,ly+1];
      if(IR && (b[0]<1 || b[2]>MX1+2)) continue;   // keep labels on the page / off the panel
      if(!overlaps(b)){ placed.push(b); chosen=[lx,ly,anc]; break; }
    }
  }
  if(!chosen){ return false; }                // give up rather than overlap
  const [lx,ly,anc]=chosen;
  out(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-family="Arial" font-size="${sz}" ${italic?'font-style="italic" ':''}fill="${col}" text-anchor="${anc}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(text)}</text>`);
  return true;
}
function poiMark(p){
  const k=p.cat+':'+p.name; const o=(OV.pois||{})[k]||{};
  if(o.hide) return;                            // suppress this POI entirely
  let [x,y]=XY(p.ll);
  if(o.pos){ x=o.pos.x; y=o.pos.y; } else if(o.move){ x+=o.move.dx; y+=o.move.dy; }
  if(IR && (x<MX0+1||x>MX1-1||y<MY0+1||y>MY1-1) && !o.pos && !o.move) return; // off-frame under roads model
  out(gk('poi',k,icon(p.cat,x,y,2.1)));
  const auto = ['shop','leisure','school','park','community','allotments'].includes(p.cat) && p.name && p.name!=='Park';
  const showName = o.force===true || (auto && o.force!==false);
  if(showName) placeLabel(x,y,p.name,2.5,'#222',false,o.label||null);
}

out(`<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 ${W} ${H}">`);
out(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
out(`<clipPath id="map"><rect x="${MX0}" y="${MY0}" width="${MX1-MX0}" height="${MY1-MY0}"/></clipPath>`);

// linear features (river / road / railway / canal) — drawn under the route lines
out(`<g clip-path="url(#map)">`);
for(const f of FEATURES) drawFeature(f);
// ============================================================================
// ROUTE DRAWING — two models.
// internalRoads: context roads -> road skeleton -> road-following route lines
//   (corridor-bundled, tails cut at the frame) -> stop ticks on the lines.
// classic: straight chords between stops (internalBundle fan-out) + ticks.
// ============================================================================
let rseq={};                      // classic model's filtered sequences (old termini block)
let TRIM=null, SKEL=null;         // internalRoads artefacts used later (arrows/badges/labels)
const inFrame=p=>p[0]>=MX0&&p[0]<=MX1&&p[1]>=MY0&&p[1]<=MY1;
if(IR){
  // -- project matched polylines to page space
  const RPP={};                                  // r -> {P:[[x,y]..], E:[token|null]}
  for(const r of order){ const e=RP.routes[r]; if(!e||!e.pts||e.pts.length<2)continue;
    RPP[r]={ P:e.pts.map(ll=>XY(ll)), E:e.edges||[] }; }
  const canonOf=t=>{ const i=t.indexOf('>'); const a=t.slice(0,i), b=t.slice(i+1); return (+a<+b)?(a+'|'+b):(b+'|'+a); };
  const dirOf=t=>{ const i=t.indexOf('>'); return (+t.slice(0,i) < +t.slice(i+1)) ? 1 : -1; };
  // -- corridor membership: which routes use each (canonical) road edge
  const eRoutes={};
  for(const r of order){ const o=RPP[r]; if(!o)continue;
    for(const t of o.E){ if(!t)continue; const c=canonOf(t);
      if(!(eRoutes[c]=eRoutes[c]||[]).includes(r)) eRoutes[c].push(r); } }
  // -- geometric corridor membership (page-space), independent of OSM edge id.
  //    The map-matcher sometimes puts routes that share ONE physical road onto
  //    DIFFERENT canonical edge ids (parallel ways, a split node, the stop
  //    vertex). Grouping lanes by edge id (eRoutes) then misses them, so they
  //    draw on the same centreline and the last colour hides the rest (and they
  //    re-converge at every such boundary). Regroup by geometry instead: two
  //    projected segments belong to the same lane-bundle if they are near-
  //    coincident (close midpoints + near-parallel), regardless of edge id.
  //    MEM[r][i] = routes sharing route r's segment i (incl. r), sorted by draw
  //    order -> a stable lane index. Used for BOTH the casing width and the
  //    per-route lane offset below. Tunable via internalRoads.corridor{dist,angle}.
  const COR = IR.corridor||{};
  const CD = COR.dist!=null?COR.dist:2.4;                     // max lateral mm to co-bundle
  const CA = Math.cos((COR.angle!=null?COR.angle:22)*Math.PI/180); // max bearing deviation
  const orderIdx={}; order.forEach((r,k)=>{orderIdx[r]=k;});
  const SEG=[];
  for(const r of order){ const o=RPP[r]; if(!o)continue; const Pp=o.P;
    for(let i=0;i<Pp.length-1;i++){ const a=Pp[i],b=Pp[i+1];
      const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy); if(L<1e-6)continue;
      SEG.push({r,i,ax:a[0],ay:a[1],ux:dx/L,uy:dy/L,L,mx:(a[0]+b[0])/2,my:(a[1]+b[1])/2}); } }
  const pSeg=(px,py,s)=>{ let t=(px-s.ax)*s.ux+(py-s.ay)*s.uy; if(t<0)t=0; else if(t>s.L)t=s.L;
    const cx=s.ax+s.ux*t, cy=s.ay+s.uy*t; return Math.hypot(px-cx,py-cy); };
  const MEM={};
  for(const s of SEG){ const set=new Set([s.r]);
    for(const u of SEG){ if(u.r===s.r)continue;
      if(Math.abs(s.ux*u.ux+s.uy*u.uy)<CA)continue;             // not near-parallel
      if(pSeg(s.mx,s.my,u)>CD)continue;                         // s mid far from u
      if(pSeg(u.mx,u.my,s)>CD)continue;                         // u mid far from s
      set.add(u.r); }
    (MEM[s.r]=MEM[s.r]||{})[s.i]=[...set].sort((x,y)=>orderIdx[x]-orderIdx[y]); }
  const segByRoute={};                             // r -> its own segments (for reference dir)
  for(const s of SEG){ (segByRoute[s.r]=segByRoute[s.r]||[]).push(s); }
  // reference direction for a lane-bundle at a point: the local heading of the
  // bundle's lowest-order route (r0). Using ONE shared reference per location (not
  // each route's own per-segment heading) gives a normal that varies smoothly along
  // the corridor -- no 180 deg hemisphere flips that made curved bundles swap sides,
  // and no per-stop pinch from adjacent segments disagreeing on the normal.
  const refDir=(r0,mx,my,fx,fy)=>{ const segs=segByRoute[r0]; if(!segs) return [fx,fy];
    let best=Infinity,bux=fx,buy=fy;
    for(const s of segs){ const dd=(s.mx-mx)*(s.mx-mx)+(s.my-my)*(s.my-my); if(dd<best){best=dd;bux=s.ux;buy=s.uy;} }
    return [bux,buy]; };
  // -- context roads (named side streets, very light) under everything
  if(IR.contextRoads){
    for(const w of RG.ways){ if(!w.tags.name)continue;
      const pp=w.geometry.map(ll=>XY(ll));
      out(`<path d="${pp.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ')}" fill="none" stroke="${IR.contextColor}" stroke-width="${IR.contextWidth}"/>`);
    }
  }
  // -- road skeleton (grey casing) + keyRoads are drawn LOWER DOWN, after the
  //    TRIM pass computes each route's drawn/in-frame index range: the casing
  //    width is sized to the routes whose *trimmed* line actually spans a
  //    segment, not the raw geometric bundle (item 4c, 2026-07-04) -- so a
  //    shared corridor slims where fewer colours are in view. SKEL is populated
  //    there and consumed by the road-label block further below.
  // -- per-route offset polylines (parallel lanes within each corridor)
  const SH={};
  for(const r of order){ const o=RPP[r]; if(!o)continue; const Pp=o.P,E=o.E;
    const ro=(OV.routeOffsets||{})[r]||{dx:0,dy:0};
    const v=[];
    for(let i=0;i<Pp.length-1;i++){ let sx=0,sy=0;
      const arr=(MEM[r]&&MEM[r][i])||null;                      // geometric lane-bundle here
      if(arr && arr.length>1){ const so=(arr.indexOf(r)-(arr.length-1)/2)*IR.gap;
        const ox=Pp[i+1][0]-Pp[i][0], oy=Pp[i+1][1]-Pp[i][1];  // own heading (fallback)
        // normal from the bundle's reference route (arr[0]) local heading, so ALL
        // lanes share one smoothly-varying normal here -> no side-swaps on curves,
        // no pinch at stops. r0's heading is continuous along its own polyline, so
        // NO hemisphere flip is needed (a flip would reverse lane order mid-curve,
        // i.e. make co-running lines cross over) -- use the raw perpendicular.
        const [dx0,dy0]=refDir(arr[0],(Pp[i][0]+Pp[i+1][0])/2,(Pp[i][1]+Pp[i+1][1])/2,ox,oy);
        const L=Math.hypot(dx0,dy0)||1; const nx=-dy0/L, ny=dx0/L;
        sx=nx*so; sy=ny*so; }
      v.push([sx,sy]); }
    SH[r]=Pp.map((p,i)=>{ let sx,sy;
      if(i===0){[sx,sy]=v[0];} else if(i===Pp.length-1){[sx,sy]=v[v.length-1];}
      else { sx=(v[i-1][0]+v[i][0])/2; sy=(v[i-1][1]+v[i][1])/2; }
      return [p[0]+sx+ro.dx, p[1]+sy+ro.dy]; });
  }
  // -- cut each route at the frame: keep from the last entry before its first
  //    in-frame stop to the first exit after its last in-frame stop; remember
  //    the cut points + outward directions for the terminus arrows.
  const frameCut=(p,q)=>{ let t=1;
    if(q[0]<MX0&&q[0]!==p[0]) t=Math.min(t,(MX0-p[0])/(q[0]-p[0]));
    if(q[0]>MX1&&q[0]!==p[0]) t=Math.min(t,(MX1-p[0])/(q[0]-p[0]));
    if(q[1]<MY0&&q[1]!==p[1]) t=Math.min(t,(MY0-p[1])/(q[1]-p[1]));
    if(q[1]>MY1&&q[1]!==p[1]) t=Math.min(t,(MY1-p[1])/(q[1]-p[1]));
    return [p[0]+(q[0]-p[0])*t, p[1]+(q[1]-p[1])*t]; };
  const unit=(a,b)=>{ const L=Math.hypot(b[0]-a[0],b[1]-a[1])||1; return [(b[0]-a[0])/L,(b[1]-a[1])/L]; };
  TRIM={};
  for(const r of order){ const sh=SH[r]; if(!sh)continue; const st=(RP.routes[r]||{}).stopT||{};
    const params=[];
    for(const a in st){ const o=st[a]; if(o.i>=sh.length-1)continue;
      const p=[sh[o.i][0]+(sh[o.i+1][0]-sh[o.i][0])*o.t, sh[o.i][1]+(sh[o.i+1][1]-sh[o.i][1])*o.t];
      if(inFrame(p)) params.push(o.i+o.t); }
    if(!params.length){ TRIM[r]={pts:sh, draw:{s0:0,e:sh.length-1}}; continue; }
    const lo=Math.min(...params), hi=Math.max(...params);
    let s0=0, e=sh.length-1, startCut=null, endCut=null;
    for(let kk=Math.max(0,Math.floor(hi)); kk<sh.length-1; kk++){
      if(inFrame(sh[kk]) && !inFrame(sh[kk+1])){ endCut={p:frameCut(sh[kk],sh[kk+1]), d:unit(sh[kk],sh[kk+1])}; e=kk; break; } }
    for(let kk=Math.min(sh.length-1,Math.ceil(lo)); kk>0; kk--){
      if(inFrame(sh[kk]) && !inFrame(sh[kk-1])){ startCut={p:frameCut(sh[kk],sh[kk-1]), d:unit(sh[kk],sh[kk-1])}; s0=kk; break; } }
    const pts=sh.slice(s0,e+1);
    if(startCut) pts.unshift(startCut.p);
    if(endCut) pts.push(endCut.p);
    // off-map continuation arrows for routes whose matched path ENDS inside the
    // frame but whose full chain carries on (e.g. a village just over the river)
    const cont=RP.routes[r]||{};
    if(!endCut && cont.contEnd && pts.length>=2 && inFrame(pts[pts.length-1]))
      endCut={p:pts[pts.length-1], d:unit(pts[pts.length-2],pts[pts.length-1])};
    if(!startCut && cont.contStart && pts.length>=2 && inFrame(pts[0]))
      startCut={p:pts[0], d:unit(pts[1],pts[0])};
    TRIM[r]={pts, startCut, endCut, sh, st, draw:{s0,e}};
    if(process.env.DBG_TRIM) console.error('TRIM '+r+': vtx '+sh.length+' lo '+lo.toFixed(1)+' hi '+hi.toFixed(1)
      +' s0 '+s0+' e '+e+' startCut '+(startCut?startCut.p.map(v=>v.toFixed(1)):'-')
      +' endCut '+(endCut?endCut.p.map(v=>v.toFixed(1)):'-')
      +' last '+sh[sh.length-1].map(v=>v.toFixed(1))+' lastIn '+inFrame(sh[sh.length-1]));
  }
  // -- road skeleton (grey casing): every edge a bus uses. Casing width is sized
  //    to the routes whose *trimmed* in-frame line actually spans each segment,
  //    not the raw geometric bundle -- so a shared corridor slims back down where
  //    fewer colours are in view (item 4c, 2026-07-04). Reuses MEM (lane bundle)
  //    + TRIM.draw (each route's drawn index range). Drawn here (post-TRIM) so
  //    TRIM exists; nothing is emitted between the pre-TRIM code and here, so an
  //    all-drawn corridor renders byte-identically to the old always-full formula.
  const segDist=(M,a,b)=>{ const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy;
    let tt=L2?((M[0]-a[0])*dx+(M[1]-a[1])*dy)/L2:0; tt=tt<0?0:tt>1?1:tt;
    const cx=a[0]+dx*tt, cy=a[1]+dy*tt; return Math.hypot(M[0]-cx,M[1]-cy); };
  // does route s's DRAWN (trimmed, in-frame) centreline pass within CD of M?
  const drawnCovers=(s,M)=>{ const o2=RPP[s], tr=TRIM[s]; if(!o2||!tr||!tr.draw)return false;
    const P=o2.P, dr=tr.draw; for(let j=dr.s0;j<dr.e && j<P.length-1;j++){ if(segDist(M,P[j],P[j+1])<=CD)return true; } return false; };
  SKEL=[];                                       // [{c,p,q,name}] for road labels
  const eSeen=new Set();
  let _wmax=0;
  for(const r of order){ const o=RPP[r]; if(!o)continue; const Pp=o.P,E=o.E;
    for(let i=0;i<E.length;i++){ const t=E[i]; if(!t)continue; const c=canonOf(t);
      if(eSeen.has(c))continue; eSeen.add(c);
      // Of the geometric bundle MEM[r][i] (edge-id bundle as fallback), keep only
      // the routes whose TRIMMED line actually spans this segment; the casing must
      // cover exactly those drawn lanes. Each bundle member occupies lane offset
      // (k-(nb-1)/2)*gap along the SAME normal the lanes use (refDir of bundle[0]),
      // so: width = drawn span + stroke + pad, and the casing is CENTRED on the
      // drawn lanes' midpoint (offset perpendicular by mid) -- otherwise a corridor
      // showing only its outer lane would either overrun a centreline-anchored
      // casing or leave bare grey on the empty side. When every bundle route is
      // drawn, mid=0 and span=(nb-1)*gap, i.e. the old always-full casing exactly.
      const bundle=(MEM[r]&&MEM[r][i])?MEM[r][i]:eRoutes[c], nb=bundle.length;
      const M=[(Pp[i][0]+Pp[i+1][0])/2,(Pp[i][1]+Pp[i+1][1])/2];
      let loO=Infinity,hiO=-Infinity;
      for(let k2=0;k2<nb;k2++){ if(!drawnCovers(bundle[k2],M))continue;
        const off=(k2-(nb-1)/2)*IR.gap; if(off<loO)loO=off; if(off>hiO)hiO=off; }
      const drawn=hiO>=loO, mid=drawn?(loO+hiO)/2:0, span=drawn?(hiO-loO):0;
      const w=span + IR.stroke + IR.skeletonPad;
      const [rdx,rdy]=refDir(bundle[0],M[0],M[1],Pp[i+1][0]-Pp[i][0],Pp[i+1][1]-Pp[i][1]);
      const Ln=Math.hypot(rdx,rdy)||1, nX=-rdy/Ln*mid, nY=rdx/Ln*mid;
      const p0x=Pp[i][0]+nX, p0y=Pp[i][1]+nY, p1x=Pp[i+1][0]+nX, p1y=Pp[i+1][1]+nY;
      if(w>_wmax)_wmax=w;
      // DBG_CASE=2: per-segment casing report (road name, geometric bundle size,
      // drawn lanes, final width, centre offset) -- companion to DBG_TRIM/DBG_LABELS.
      if(process.env.DBG_CASE==='2' && inFrame(M)){ const nm=(RP.edgeWay[c]&&RP.edgeWay[c].name)||'?';
        const dn=bundle.filter(s=>drawnCovers(s,M)).length;
        console.error('CASE '+nm+' bundle='+nb+' drawn='+dn+' w='+w.toFixed(2)+' mid='+mid.toFixed(2)); }
      SKEL.push({c, p:Pp[i], q:Pp[i+1], name:(RP.edgeWay[c]&&RP.edgeWay[c].name)||null});
      out(`<path d="M${p0x.toFixed(2)} ${p0y.toFixed(2)}L${p1x.toFixed(2)} ${p1y.toFixed(2)}" fill="none" stroke="${IR.skeleton}" stroke-width="${w.toFixed(2)}" stroke-linecap="round"/>`);
    } }
  if(process.env.DBG_CASE) console.error('CASE max casing width '+_wmax.toFixed(2)+' mm');
  // -- keyRoads: named roads drawn at skeleton weight regardless of bus usage
  //    today (e.g. a real-world corridor continuation whose stretch nearest a
  //    junction happens to be unused). Same RG.ways name-lookup technique the
  //    road-label block below uses for roadLabelInclude, but emitting a SKEL
  //    casing (drawn), not just a label-position entry. Safe to overlap an
  //    already-used stretch of the same road: same opaque skeleton colour, so
  //    a duplicate draw is visually a no-op.
  for(const n of (IR.keyRoads||[])){
    const kw=IR.stroke+IR.skeletonPad;
    for(const way of RG.ways){ if(way.tags.name!==n)continue;
      for(let i=0;i<way.geometry.length-1;i++){ const p=XY(way.geometry[i]), q=XY(way.geometry[i+1]);
        if(p[0]===q[0]&&p[1]===q[1])continue;
        // keep only the frame-relevant stretch: an OSM way often runs far out
        // into the countryside beyond the map frame, and including that whole
        // length would swamp the (length-weighted) road-label centroid below.
        if(!inFrame(p)&&!inFrame(q))continue;
        SKEL.push({c:'key:'+n+':'+way.geometry[i].join(',')+'>'+way.geometry[i+1].join(','), p, q, name:n});
        out(`<path d="M${p[0].toFixed(2)} ${p[1].toFixed(2)}L${q[0].toFixed(2)} ${q[1].toFixed(2)}" fill="none" stroke="${IR.skeleton}" stroke-width="${kw.toFixed(2)}" stroke-linecap="round"/>`);
      } }
  }
  // -- route lines
  for(const r of order){ const tr=TRIM[r]; if(!tr||tr.pts.length<2)continue;
    const d=tr.pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
    out(gk('route',r,`<path d="${d}" fill="none" stroke="${C[r]}" stroke-width="${IR.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`)); }
  // -- stop ticks ON the route lines (one per physical stop, first route wins;
  //    stops[ATCO].pos override moves the tick)
  const tickSeen=new Set();
  for(const r of order){ const tr=TRIM[r]; if(!tr||!tr.sh)continue;
    for(const a in tr.st){ if(tickSeen.has(a))continue; const o=tr.st[a]; if(o.i>=tr.sh.length-1)continue;
      let p=baseOv[a] || [tr.sh[o.i][0]+(tr.sh[o.i+1][0]-tr.sh[o.i][0])*o.t, tr.sh[o.i][1]+(tr.sh[o.i+1][1]-tr.sh[o.i][1])*o.t];
      if(!inFrame(p))continue; tickSeen.add(a);
      out(gk('stop',a,`<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="0.8" fill="#fff" stroke="#555" stroke-width="0.4"/>`)); } }
} else {
// route lines.  Default = original per-route diagonal nudge (byte-identical when
// "internalBundle" is absent).  Opt-in routes.json "internalBundle":{gap:0.9} fans
// co-running routes into closely-parallel lines (perpendicular per-segment offset).
const BUNDLE = RJ.internalBundle || null;                        // {gap} or falsy
const BGAP = (BUNDLE&&BUNDLE.gap)||0.9;
for(const r of order){ if(!routes[r])continue;
  rseq[r]=routes[r].filter(a=>atco2ll[a]||(routeOv[r]&&routeOv[r][a])||baseOv[a]); }
const segRoutes={};                                             // "a|b" -> [routes sharing the segment]
if(BUNDLE){ for(const r of order){ const sq=rseq[r]||[];
  for(let i=0;i<sq.length-1;i++){ const a=sq[i],b=sq[i+1], key=a<b?a+'|'+b:b+'|'+a;
    (segRoutes[key]=segRoutes[key]||[]).push(r); } } }
let idx=0;
for(const r of order){ if(!routes[r])continue;
  const ro=(OV.routeOffsets||{})[r]||{dx:0,dy:0};                 // lateral spread off a shared corridor
  const sq=rseq[r]; const seq=sq.map(a=>rpos(r,a));
  if(seq.length<2)continue;
  let d;
  if(BUNDLE){                                                    // perpendicular fan-out of shared runs
    const v=[];                                                  // per-segment offset vector
    for(let i=0;i<sq.length-1;i++){ const a=sq[i],b=sq[i+1], key=a<b?a+'|'+b:b+'|'+a;
      const list=segRoutes[key]||[r], cnt=list.length, rank=list.indexOf(r);
      const so=(rank-(cnt-1)/2)*BGAP;
      const dx=seq[i+1][0]-seq[i][0], dy=seq[i+1][1]-seq[i][1], L=Math.hypot(dx,dy)||1;
      v.push([-dy/L*so, dx/L*so]); }
    const sh=seq.map((p,i)=>{ let sx,sy;
      if(i===0){[sx,sy]=v[0];} else if(i===seq.length-1){[sx,sy]=v[i-1];}
      else {sx=(v[i-1][0]+v[i][0])/2; sy=(v[i-1][1]+v[i][1])/2;}
      return [p[0]+sx+ro.dx, p[1]+sy+ro.dy]; });
    d=sh.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
  } else { const off=(idx-3)*0.6;
    d=seq.map((p,i)=>(i?'L':'M')+(p[0]+off+ro.dx).toFixed(2)+' '+(p[1]+off+ro.dy).toFixed(2)).join(' '); }
  out(gk('route',r,`<path d="${d}" fill="none" stroke="${C[r]}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`)); idx++; }
// stop ticks (one per physical stop at its base position)
const seen=new Set();
for(const r in routes) for(const a of routes[r]){ if(seen.has(a)||!atco2ll[a])continue; seen.add(a);
  const[x,y]=XYS(a); out(gk('stop',a,`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.85" fill="#fff" stroke="#555" stroke-width="0.45"/>`));}
// per-route divergence ticks: only where a route pulled a shared stop off the base (no-op without overrides)
for(const r in routeOv) for(const a of (routes[r]||[])){ if(!atco2ll[a]&&!baseOv[a])continue;
  const rp=routeOv[r][a]; if(!rp)continue; const bp=baseXY(a);
  if(Math.abs(rp[0]-bp[0])<0.01 && Math.abs(rp[1]-bp[1])<0.01)continue;
  out(gk('stop', r+':'+a, `<circle cx="${rp[0].toFixed(2)}" cy="${rp[1].toFixed(2)}" r="0.85" fill="#fff" stroke="#555" stroke-width="0.45"/>`));}
}
out(`</g>`);

// ---- reserve protected areas so labels avoid them ----
reserve(197,0,297,210);                 // right service panel
reserve(0,0,86,26);                     // title block
for(const f of FEATURES){ const ov=featOv(f);           // linear-feature label areas
  if(ov.hide || (ov.label&&ov.label.hide)) continue;
  if(f.labelReserve) reserve(...f.labelReserve); }
// Central interchange / bus-station label (the ANCHOR) drawn + reserved first
if(atco2ll[ANCHOR]||baseOv[ANCHOR]){const[x,y]=XYS(ANCHOR);
  const _a=[`<rect x="${x-1.7}" y="${y-1.7}" width="3.4" height="3.4" rx="0.5" fill="#111"/>`,
    `<rect x="${x-1.0}" y="${y-1.0}" width="2.0" height="2.0" rx="0.3" fill="#fff"/>`,
    `<text x="${x+2.6}" y="${y+1.0}" font-family="Arial" font-weight="bold" font-size="3.0" fill="#111" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(ANCHOR_LABEL)}</text>`].join('\n');
  out(gk('stop',ANCHOR,_a));
  reserve(x-2,y-2,x+24,y+2);
}

// ---- internalRoads: terminus arrows at the frame cuts + badges along lines --
if(IR && TRIM){
  const TL=RJ.terminiLabels||{};
  const aplaced=[];
  // terminal badge where a route simply ENDS in town (not continuing, not circular)
  const termBadge=(p,r)=>{
    const anc=(atco2ll[ANCHOR]||baseOv[ANCHOR])?XYS(ANCHOR):null;
    if(anc && Math.hypot(p[0]-anc[0],p[1]-anc[1])<8) return;   // not at the interchange knot
    badge(p[0],p[1],r,2.6); reserve(p[0]-2.8,p[1]-2.8,p[0]+2.8,p[1]+2.8);
  };
  // -- consolidate frame-cut termini into ONE box per exit cluster (item 5,
  //    2026-07-04): nearby cut points used to each place an independent
  //    arrow+badge+label, which just overlapped/jittered (e.g. St Ives A/B
  //    both leaving via the same Cambridge corridor, ~3mm apart). Gather every
  //    non-suppressed cut as an event, single-link-cluster events within
  //    `terminiClusterDist` mm (default 7, the old jitter threshold), then draw
  //    ONE arrow + one badge/label box per cluster: same-destination members
  //    share a row and ONE "to X" text; different destinations stack as
  //    separate rows. A cluster of one reduces to exactly the old per-route
  //    arrow+badge+label (same maths, same draw order) -- byte-identical output
  //    for any route whose cut has no neighbour within range.
  const CLD = IR.terminiClusterDist!=null ? IR.terminiClusterDist : 7;
  const events=[];
  for(const r of order){ const tr=TRIM[r]; if(!tr)continue;
    const lt=((IR.termini||{})[r])||{};
    const endLab   = (lt.end  !==undefined) ? lt.end   : ((tr.endCut && !tr.startCut) ? TL[r] : null);
    const startLab = (lt.start!==undefined) ? lt.start : ((tr.startCut && !tr.endCut) ? TL[r] : null);
    if(tr.endCut   && lt.end  !==false) events.push({r,cut:tr.endCut,  label:endLab});
    if(tr.startCut && lt.start!==false) events.push({r,cut:tr.startCut,label:startLab});
  }
  const clusters=[];
  for(const e of events){
    const cl=clusters.find(c=>c.some(m=>Math.hypot(m.cut.p[0]-e.cut.p[0],m.cut.p[1]-e.cut.p[1])<CLD));
    if(cl) cl.push(e); else clusters.push([e]);
  }
  const BS=6.6, RH=7.0;                        // badge pitch (side-by-side) / row pitch (stacked) --
                                                // badges are 3.0mm radius (6mm dia.), so pitch must
                                                // clear that or adjacent/stacked badges overlap and
                                                // hide each other (caught visually, not by the gate).
  for(const ms of clusters){
    let px=0,py=0,dx=0,dy=0;
    for(const m of ms){ px+=m.cut.p[0]; py+=m.cut.p[1]; dx+=m.cut.d[0]; dy+=m.cut.d[1]; }
    const n=ms.length; px/=n; py/=n;
    const dl=Math.hypot(dx,dy)||1; dx/=dl; dy/=dl;
    const nx=-dy, ny=dx;
    const cols=[...new Set(ms.map(m=>C[m.r]||'#888'))], col=cols.length===1?cols[0]:'#555';
    out(`<path d="M${(px+dx*2.6).toFixed(2)} ${(py+dy*2.6).toFixed(2)} L${(px-dx*0.5+nx*1.6).toFixed(2)} ${(py-dy*0.5+ny*1.6).toFixed(2)} L${(px-dx*0.5-nx*1.6).toFixed(2)} ${(py-dy*0.5-ny*1.6).toFixed(2)} Z" fill="${col}"/>`);
    let bx=px-dx*5, by=py-dy*5, tries=0;
    while(aplaced.some(q=>Math.hypot(q[0]-bx,q[1]-by)<7) && tries<5){ bx-=dx*6; by-=dy*6; tries++; }
    aplaced.push([bx,by]);
    const groups=[], gi2={};                   // same "to X" text -> one shared row
    for(const m of ms){ const k=m.label||''; if(!(k in gi2)){ gi2[k]=groups.length; groups.push({label:m.label,ms:[]}); } groups[gi2[k]].ms.push(m); }
    let bxMin=Infinity,bxMax=-Infinity,byMin=Infinity,byMax=-Infinity;
    groups.forEach((g,gidx)=>{
      const ry=by+(gidx-(groups.length-1)/2)*RH;
      let lastX=bx;
      g.ms.forEach((m,i)=>{ const bxi=bx+(i-(g.ms.length-1)/2)*BS; badge(bxi,ry,m.r,3.0); lastX=bxi;
        bxMin=Math.min(bxMin,bxi); bxMax=Math.max(bxMax,bxi); byMin=Math.min(byMin,ry); byMax=Math.max(byMax,ry); });
      if(!g.label) return;
      const col=g.ms.length===1?(C[g.ms[0].r]||'#333'):'#333';
      if(g.ms.length>1){
        // MULTI-badge row: the legacy anchor-on-last-badge placement either
        // runs off the page (right candidate at the frame edge) or prints the
        // text straight over a sibling badge (the left 'end' candidate --
        // caught visually: "to Cambridge" covered B's badge; badges were
        // never reserved, so placeLabel thought the spot was clear). Reserve
        // the row's badges first, then try row-level spots (right / left /
        // above / below the WHOLE row) so text can never cover a badge.
        // Solo rows keep the legacy call below unchanged (byte-identical).
        const rx0=bx+(0-(g.ms.length-1)/2)*BS, rx1=lastX;
        g.ms.forEach((m,i)=>{ const bxi=bx+(i-(g.ms.length-1)/2)*BS;
          reserve(bxi-3.2,ry-3.2,bxi+3.2,ry+3.2); });
        const text='to '+g.label, sz=2.7, w=text.length*sz*0.52;
        const rcands=[[rx1+3.7,ry+0.9,'start'],[rx0-3.7,ry+0.9,'end'],[bx,ry-4.4,'middle'],[bx,ry+5.4,'middle']];
        for(const [lx,ly,anc] of rcands){
          const tb = anc==='start'?lx : anc==='end'?lx-w : lx-w/2;
          const bb=[tb-0.4,ly-sz,tb+w+0.4,ly+1];
          if(IR && (bb[0]<1 || bb[2]>MX1+2)) continue;
          if(overlaps(bb)) continue;
          placed.push(bb);
          out(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-family="Arial" font-size="${sz}" fill="${col}" text-anchor="${anc}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(text)}</text>`);
          break;
        }
      } else placeLabel(lastX,ry,'to '+g.label,2.7, col, false, null); // label BEFORE the badge
    });
    reserve(bxMin-3.5,byMin-3.5,bxMax+3.5,byMax+3.5);                    // reserve, or it can't place
  }
  for(const r of order){ const tr=TRIM[r]; if(!tr)continue;
    const closed = tr.pts.length>2 && Math.hypot(tr.pts[0][0]-tr.pts[tr.pts.length-1][0], tr.pts[0][1]-tr.pts[tr.pts.length-1][1])<2;
    if(!closed){
      if(!tr.endCut   && tr.pts.length>=2 && inFrame(tr.pts[tr.pts.length-1])) termBadge(tr.pts[tr.pts.length-1],r);
      if(!tr.startCut && tr.pts.length>=2 && inFrame(tr.pts[0])) termBadge(tr.pts[0],r);
    }
  }
  // small route badges sprinkled along each visible line
  const bplaced=aplaced.slice();
  for(const r of order){ const tr=TRIM[r]; if(!tr||tr.pts.length<2)continue;
    let acc=0, next=(IR.badgeEvery)*0.55;
    for(let i=0;i<tr.pts.length-1;i++){
      const L=Math.hypot(tr.pts[i+1][0]-tr.pts[i][0], tr.pts[i+1][1]-tr.pts[i][1]);
      while(acc+L>=next){
        const t=(next-acc)/L;
        const p=[tr.pts[i][0]+(tr.pts[i+1][0]-tr.pts[i][0])*t, tr.pts[i][1]+(tr.pts[i+1][1]-tr.pts[i][1])*t];
        next+=IR.badgeEvery;
        if(!inFrame(p))continue;
        if(bplaced.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<9))continue;
        if(overlaps([p[0]-2.3,p[1]-2.3,p[0]+2.3,p[1]+2.3]))continue;
        bplaced.push(p); badge(p[0],p[1],r,2.4); reserve(p[0]-2.5,p[1]-2.5,p[0]+2.5,p[1]+2.5);
      }
      acc+=L;
    }
  }
}

// ---- road-name labels ----
if(IR && SKEL){
  // labels along the USED road geometry (length-weighted centroid + axial mean
  // angle per road name); roadLabelInclude forces a road in (from roads_geo if
  // no bus uses it), roadRename maps OSM names to display names.
  const agg={};
  for(const e of SKEL){ if(!e.name)continue;
    const L=Math.hypot(e.q[0]-e.p[0], e.q[1]-e.p[1]); if(!L)continue;
    (agg[e.name]=agg[e.name]||{len:0,segs:[]}).len+=L; agg[e.name].segs.push([e.p,e.q]); }
  const rn=IR.roadRename||[];
  const ren=n=>{ for(const [a,b] of rn) if(n===a) return b; return n; };
  // keyRoads are implicitly label-eligible too (one name, not two config arrays).
  const incl=(IR.roadLabelInclude||[]).concat(IR.keyRoads||[]);
  for(const n of incl){ if(agg[n])continue;            // not bus-used: pull from roads_geo
    for(const w of RG.ways){ if(w.tags.name!==n)continue;
      for(let i=0;i<w.geometry.length-1;i++){ const p=XY(w.geometry[i]), q=XY(w.geometry[i+1]);
        const L=Math.hypot(q[0]-p[0],q[1]-p[1]); if(!L)continue;
        (agg[n]=agg[n]||{len:0,segs:[]}).len+=L; agg[n].segs.push([p,q]); } } }
  // roadLabelExclude: never label these names. A road name shared by several
  // out-of-frame localities (e.g. every village's "High Street") aggregates to
  // ONE label at their combined centroid, which can fall spuriously inside the
  // town where no such road exists — this drops it. Removes only the LABEL, not
  // any drawn road line.
  for(const n of (IR.roadLabelExclude||[])) delete agg[n];
  const names=Object.entries(agg).sort((a,b)=>b[1].len-a[1].len);
  const chosen=[];
  for(const e of names){ if(incl.includes(e[0])) chosen.push(e); }
  for(const e of names){ if(chosen.length>=IR.roadLabelMax)break; if(!chosen.includes(e)) chosen.push(e); }
  if(process.env.DBG_LABELS) console.error('chosen ('+chosen.length+'/'+IR.roadLabelMax+'): '+chosen.map(e=>e[0]).join(', '));
  for(const [n,a] of chosen){
    let sw=0,cx0=0,cy0=0,vx=0,vy=0;
    for(const [p,q] of a.segs){ const L=Math.hypot(q[0]-p[0],q[1]-p[1]);
      sw+=L; cx0+=(p[0]+q[0])/2*L; cy0+=(p[1]+q[1])/2*L;
      const an=Math.atan2(q[1]-p[1],q[0]-p[0]); vx+=Math.cos(2*an)*L; vy+=Math.sin(2*an)*L; }
    cx0/=sw; cy0/=sw;
    let ang=Math.atan2(vy,vx)/2*180/Math.PI; if(ang>90)ang-=180; if(ang<-90)ang+=180;
    const label=ren(n);
    const w=label.length*2.5*0.5;
    // multi-candidate search (same fallback pattern as placeLabel()): try the
    // whole-road weighted centroid first, then points spread along the road's
    // used length (projected onto its own mean bearing), so ONE local collision
    // (a badge, another label) no longer drops the entire label.
    const ux=Math.cos(ang*Math.PI/180), uy=Math.sin(ang*Math.PI/180);
    const mids=a.segs.map(([p,q])=>({x:(p[0]+q[0])/2, y:(p[1]+q[1])/2, L:Math.hypot(q[0]-p[0],q[1]-p[1])}))
      .sort((m1,m2)=>(m1.x*ux+m1.y*uy)-(m2.x*ux+m2.y*uy));
    let acc=0; for(const m of mids){ m.t=acc+m.L/2; acc+=m.L; }
    const along=frac=>{ const target=frac*sw; let best=mids[0];
      for(const m of mids) if(Math.abs(m.t-target)<Math.abs(best.t-target)) best=m;
      return [best.x,best.y]; };
    const cands=[[cx0,cy0]].concat([0.3,0.7,0.15,0.85,0.42,0.58].map(along));
    let ok=false, anyInFrame=false;
    for(const [cx,cy] of cands){
      if(!inFrame([cx,cy]))continue; anyInFrame=true;
      // reserve the ROTATED footprint (rect rotated by `ang`, then its axis-
      // aligned bounding box) -- the old axis-aligned-only box ignored rotation
      // entirely, so a steeply-angled road name (e.g. -35 deg) could visually
      // swing well outside its own reservation and cover something the collision
      // check thought was clear (caught: it hid a terminus badge once a nearby
      // reservation moved). Reduces to the exact old box when ang=0.
      const rad=ang*Math.PI/180, ca=Math.cos(rad), sa=Math.sin(rad), hw=w/2+1, hh=2;
      const corners=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([lx,ly])=>[cx+lx*ca-ly*sa, cy+lx*sa+ly*ca]);
      const b=[Math.min(...corners.map(c=>c[0])), Math.min(...corners.map(c=>c[1])),
                Math.max(...corners.map(c=>c[0])), Math.max(...corners.map(c=>c[1]))];
      if(overlaps(b))continue; reserve(...b);
      out(`<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-family="Arial" font-size="2.5" fill="#666" text-anchor="middle" transform="rotate(${ang.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})" stroke="#fff" stroke-width="0.8" paint-order="stroke">${esc(label)}</text>`);
      ok=true; break;
    }
    if(process.env.DBG_LABELS) console.error('  '+(ok?'placed  ':'SKIP('+(anyInFrame?'overlap':'off-frame')+')')+' '+n);
  }
} else {
// classic: group stops by road (from stop names), label along route direction
const roadSuffix=/(Road|Way|Lane|Street|Drive|Hill|Rise)$/;
const roadGroups={};
for(const a in atco2name){ if(!atco2ll[a]||!a.startsWith(PREFIX))continue;
  let nm=(atco2name[a]||'').replace(/\s*\(.*?\)/g,'').trim();
  const m=nm.match(roadSuffix); if(!m)continue;
  // road name = trailing two words ending with suffix
  const parts=nm.split(' '); const road=parts.slice(Math.max(0,parts.length-2)).join(' ');
  (roadGroups[road]=roadGroups[road]||[]).push(a);
}
// orientation lookup from the orientation route (town circular / longest route)
const ORISEQ = routes[ORI]||[];
const loop=ORISEQ.map(a=>(atco2ll[a]||baseOv[a]||(routeOv[ORI]&&routeOv[ORI][a]))?rpos(ORI,a):null);
function dirAt(xy){ let best=1e9,ang=0; for(let i=0;i<loop.length-1;i++){ if(!loop[i]||!loop[i+1])continue;
  const mx=(loop[i][0]+loop[i+1][0])/2,my=(loop[i][1]+loop[i+1][1])/2; const d=Math.hypot(mx-xy[0],my-xy[1]);
  if(d<best){best=d;ang=Math.atan2(loop[i+1][1]-loop[i][1],loop[i+1][0]-loop[i][0]);}} return ang; }
const roads=Object.entries(roadGroups).filter(([r,as])=>as.length>=2)
  .sort((a,b)=>b[1].length-a[1].length).slice(0,9);
for(const [road,as] of roads){
  const xys=as.map(a=>XYS(a)); const cx=xys.reduce((s,p)=>s+p[0],0)/xys.length, cy=xys.reduce((s,p)=>s+p[1],0)/xys.length;
  let ang=dirAt([cx,cy])*180/Math.PI; if(ang>90)ang-=180; if(ang<-90)ang+=180;
  const w=road.length*2.5*0.5, b=[cx-w/2-1,cy-2,cx+w/2+1,cy+2];
  if(overlaps(b))continue; reserve(...b);
  out(`<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-family="Arial" font-size="2.5" fill="#666" text-anchor="middle" transform="rotate(${ang.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})" stroke="#fff" stroke-width="0.8" paint-order="stroke">${esc(road)}</text>`);
}
}

// POIs (on top of lines)
pois.forEach(poiMark);

// ---- map notes (e.g. "300, 301 and 9 stop at Morrisons") — additive ----
for(const n of (RJ.mapNotes||[])){
  let x,y;
  if(n.at && (atco2ll[n.at]||baseOv[n.at])){ const p=XYS(n.at); x=p[0]; y=p[1]; } else { x=n.x||0; y=n.y||0; }
  x+=(n.dx||0); y+=(n.dy||0);
  const sz=n.size||2.4, anc=n.anchor||'start';
  const w=String(n.text).length*sz*0.52;
  const bx = anc==='start'?x : anc==='end'?x-w : x-w/2;
  reserve(bx-0.4,y-sz,bx+w+0.4,y+1);
  out(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial" font-size="${sz}" font-style="italic" fill="${n.color||'#333'}" text-anchor="${anc}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(n.text)}</text>`);
}

// ---- terminus destination badges (opt-in: routes.json "internalTermini":true + "terminiLabels") ----
// For each route that leaves town, put a route badge + "to <dest>" at the endpoint farthest
// from the central interchange (the out-of-town end). Absent config => no output (byte-identical).
// (internalRoads replaces this with frame-cut arrows above.)
if(RJ.internalTermini && !IR){ const TL=RJ.terminiLabels||{};
  const anc=(atco2ll[ANCHOR]||baseOv[ANCHOR])?XYS(ANCHOR):null;
  const tplaced=[];                         // placed terminus badge centres (avoid overlap)
  for(const r of order){ if(!TL[r]||!rseq[r]||rseq[r].length<2)continue; const sq=rseq[r];
    const e0=rpos(r,sq[0]), e1=rpos(r,sq[sq.length-1]);
    const endFirst = anc && Math.hypot(e0[0]-anc[0],e0[1]-anc[1])>Math.hypot(e1[0]-anc[0],e1[1]-anc[1]);
    const k = endFirst?0:sq.length-1; let p=(endFirst?e0:e1).slice();
    // nudge off any nearby already-placed terminus, perpendicular to the last segment
    const adj = rpos(r, sq[k===0?1:sq.length-2]);
    const dx=p[0]-adj[0], dy=p[1]-adj[1], L=Math.hypot(dx,dy)||1, nx=-dy/L, ny=dx/L;
    let t=0; while(tplaced.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<6.5) && t<8){ p=[p[0]+nx*4, p[1]+ny*4]; t++; }
    tplaced.push(p);
    badge(p[0],p[1],r,3.0); placeLabel(p[0],p[1],'to '+TL[r],2.7,C[r]||'#333',false,null); }
}

// title
out(`<text x="6" y="16" font-family="Arial" font-weight="bold" font-size="11" fill="${C[ORI]}">Buses within ${esc(RJ.town)}</text>`);
out(`<text x="6" y="23" font-family="Arial" font-size="5" fill="#444">(from ${esc(RJ.validFrom||'June 2026')})</text>`);
for(const f of FEATURES) drawFeatureLabel(f);

// ---------- right service panel ----------
const PX=(OV.panel&&OV.panel.x!=null)?OV.panel.x:200; let py=(OV.panel&&OV.panel.y!=null)?OV.panel.y:14;
const PROW=RJ.panelRow||8, KROW=RJ.keyRow||4.4, PBR=RJ.panelBadge||4;
out(`<text x="${PX}" y="${py}" font-family="Arial" font-weight="bold" font-size="5" fill="#222">Services</text>`); py+=2;
if(RJ.panelGroups){
  // group the panel by operator (operators[] from routes.json)
  const groups=(RJ.operators||[]).map(op=>({name:op.name, rs:panelOrder.filter(r=>(op.routes||[]).includes(r))})).filter(g=>g.rs.length);
  const ungrouped=panelOrder.filter(r=>!groups.some(g=>g.rs.includes(r)));
  if(ungrouped.length) groups.push({name:'', rs:ungrouped});
  for(const g of groups){
    if(g.name){ py+=5.4; out(`<text x="${PX}" y="${py}" font-family="Arial" font-weight="bold" font-size="2.9" fill="#777">${esc(g.name.toUpperCase())}</text>`); }
    for(const r of g.rs){
      const d=INTDESC[r]||[r,''];
      py+=PROW; badge(PX+4,py,r,PBR);
      out(`<text x="${PX+10}" y="${py-0.6}" font-family="Arial" font-weight="bold" font-size="3.5" fill="#111">${esc(d[0])}</text>`);
      out(`<text x="${PX+10}" y="${py+3.0}" font-family="Arial" font-size="2.8" fill="#555">${esc(d[1])}</text>`);
    }
  }
} else {
for(const r of panelOrder){
  const d=INTDESC[r]||[r,''];
  py+=PROW; badge(PX+4,py,r,PBR);
  out(`<text x="${PX+10}" y="${py-0.6}" font-family="Arial" font-weight="bold" font-size="3.5" fill="#111">${esc(d[0])}</text>`);
  out(`<text x="${PX+10}" y="${py+3.0}" font-family="Arial" font-size="2.8" fill="#555">${esc(d[1])}</text>`);
}
}
// key (using the real pictograms)
py+=10; out(`<text x="${PX}" y="${py}" font-family="Arial" font-weight="bold" font-size="4.4" fill="#222">Key</text>`);
const key=[['shop','Supermarket'],['gp','Doctors / GP'],['pharmacy','Pharmacy'],['library','Library'],['museum','Museum'],['leisure','Leisure centre'],['school','School'],['park','Park'],['industrial','Industrial estate'],['community','Community centre'],['townhall','Town Hall']];
if(pois.some(p=>p.cat==='allotments')) key.push(['allotments','Allotments']);
key.forEach((kk,i)=>{const ky=py+5+i*KROW, kx=PX+3;
  out(icon(kk[0],kx,ky,2.0));
  out(`<text x="${kx+4.0}" y="${ky+1}" font-family="Arial" font-size="3.0" fill="#222">${esc(kk[1])}</text>`);});

// fare note (opt-in routes.json "fareNote") — highlighted box under the key
if(RJ.fareNote){
  let fy=py+5+key.length*KROW+9;
  const words=String(RJ.fareNote).split(' '); const lines=[]; let cur='';
  for(const wd of words){ if((cur+' '+wd).trim().length>38){ lines.push(cur.trim()); cur=wd; } else cur+=' '+wd; }
  if(cur.trim()) lines.push(cur.trim());
  out(`<rect x="${PX-2}" y="${fy-4.4}" width="95" height="${(lines.length*3.6+6).toFixed(1)}" rx="1.2" fill="#fff4c2"/>`);
  lines.forEach((ln,i)=>out(`<text x="${PX}" y="${fy+i*3.6}" font-family="Arial" font-weight="bold" font-size="2.9" fill="#333">${esc(ln)}</text>`));
}

// ---- north arrow (opt-in: internalRoads.northArrow) -------------------------
// The internal map is rotated (rotationDeg / PCA) to fill the page, so "up" is
// not north — a small arrow shows which way north actually is. Gated by IR so
// the non-internalRoads gate towns stay byte-identical. Direction: the SCREEN
// bearing of increasing latitude under the active rotation (theta); the
// schematic passes a precomputed `angle` (deg) because its coords are pre-
// rotated and run at rotationDeg 0, so it can't re-derive north from theta.
if (IR && IR.northArrow) {
  const na = IR.northArrow===true ? {} : IR.northArrow;
  const bx = na.x!=null?na.x:14, by = na.y!=null?na.y:150, L = na.len||8;
  // north planar step (0,-1) through the same rot() the projection uses:
  // rot(0,-1) = [sin(-theta), -cos(-theta)] in screen space (y down).
  const ang = na.angle!=null ? na.angle*Math.PI/180
            : Math.atan2(-Math.cos(-theta), Math.sin(-theta));
  const c=Math.cos(ang), s=Math.sin(ang), tx=bx+c*L, ty=by+s*L;
  const px=-s, py=c, ah=2.4, aw=1.4;                     // arrowhead
  out(`<line x1="${bx.toFixed(2)}" y1="${by.toFixed(2)}" x2="${tx.toFixed(2)}" y2="${ty.toFixed(2)}" stroke="#666" stroke-width="0.8"/>`);
  out(`<path d="M${tx.toFixed(2)} ${ty.toFixed(2)}L${(tx-c*ah+px*aw).toFixed(2)} ${(ty-s*ah+py*aw).toFixed(2)}L${(tx-c*ah-px*aw).toFixed(2)} ${(ty-s*ah-py*aw).toFixed(2)}Z" fill="#666"/>`);
  out(`<text x="${(tx+c*3).toFixed(2)}" y="${(ty+s*3+1).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="3.4" fill="#666" text-anchor="middle">N</text>`);
}

// source note (+ build version stamp when internalRoads — gate towns unaffected)
const _ver = IR ? (process.env.LEAFLET_VERSION || RJ.version) : null;
out(`<text x="6" y="208" font-family="Arial" font-size="2.7" fill="#888">Routes &amp; stops: bustimes.org (operator-verified, June 2026). Places: OpenStreetMap. Stop names in italics are approximate; check live times at bustimes.org.${_ver?' · Map v'+esc(_ver):''}</text>`);

out('</svg>');
fs.writeFileSync(DIR+'/internal.svg', s);
console.log('internal.svg', s.length, 'bytes; pois', pois.length, 'rotation°', (-theta*180/Math.PI).toFixed(1) + (IR?' [internalRoads]':''));
