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
//   internalCorridors bundle co-running services into ONE line with a badge
//                     stack (rung 1 of the complexity ladder) — see the block
//                     where it is parsed, below
//   coreBox           replace the congested centre with a labelled box that
//                     routes are cut at (rung 2)
//   corridorPalette   colour by corridor rather than by route (rung 3)
// (plus anchor/anchorLabel/internalZoom/features/internalBundle/internalTermini
//  already documented below).
//
// INTERNAL ROADS MODEL (2026-06-12; DEFAULT since 2026-08-04): the road-
// skeleton drawing model that makes the map read like the hand-made leaflet.
// Needs S2's roads_geo.json (pull_roads.js) + routes_paths.json
// (match_routes.js) — draft_town.py always writes both alongside the key.
// Every built town/place has opted in (8/8 towns, 5/5 places, 2026-08-04),
// so an ABSENT "internalRoads" key now defaults to the standard object below
// rather than falling back to the old classic stop-chord model. Set
// `internalRoads:false` explicitly to get the classic model (kept as an
// escape hatch; no live town uses it). Config (all optional):
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
//     lenses:[{center:[lat,lon],radiusKm,mag}], // extra local fisheye lens(es): magnify a
//                                      // congested cluster (bounded Sarkar–Brown, boundary fixed)
//                                      // on top of the always-on centre focus. Absent => none.
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
//     northArrow:false|{x,y,len?,angle?}, // compass for the rotated map — DRAWN BY DEFAULT on
//                                      // every internalRoads map; set false to suppress, or pass
//                                      // {x,y,len,angle} to position. Direction is the
//                                      // screen bearing of north under the active rotation
//                                      // (auto from theta); the schematic passes an explicit
//                                      // `angle` deg since its coords are pre-rotated at
//                                      // rotationDeg 0. Absent => no arrow (gate-safe).
//     badgeEvery:70,                  // route badge spacing along lines (mm)
//     termini:{ r:{start:"X",end:"Y"} } // arrow labels per cut end (falls back to terminiLabels)
//   }
// When internalRoads is active the source note also gets a build-version stamp
// (LEAFLET_VERSION env, else routes.json "version"); only `internalRoads:false`
// (classic model) omits the stamp.
// Also additive (work in both models, no output when absent): mapNotes[],
// panelGroups, panelRow, keyRow, panelBadge, fareNote.
//   panelCols:{ cols:2, width:48, row:5.0, keyAt:{x,y} }
//                                   // Multi-COLUMN Services panel, for a town with
//                                   // more services than a single column fits on A4
//                                   // (High Wycombe: 34). Entries fill column-major,
//                                   // `cols` columns `width` mm apart starting at the
//                                   // panel x; `row` overrides panelRow inside the
//                                   // panel only; keyAt pins the Key block, which
//                                   // would otherwise start below the tallest column.
//                                   // Absent => single column, byte-identical.
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
const _FONTM = path.join(path.dirname(_LABELLER), 'font_metrics.js');
const FONT = require(_FONTM);
// The internal map's own footer notes are fixed (not per-town), so the footer plate's
// top edge is a known constant — computed once here and used both by the mapNotes
// collision check below and the footerBand() call at the very end of this file. Keep
// these two in sync: whichever notes array is passed to footerBand must match this one.
const INTERNAL_FOOTER_NOTES = ['Routes & stops: UK Bus Open Data Service, cross-checked at bustimes.org (June 2026), Open Government Licence v3.0.',
          'Places: © OpenStreetMap contributors (ODbL). Stop names in italics are approximate; check live times at bustimes.org.'];
const FOOTER_PLATE_TOP = footerPlateTop({ notes: INTERNAL_FOOTER_NOTES });
const atco2name = JSON.parse(fs.readFileSync(DIR+'/atco2name.json','utf8'));
const RJ  = JSON.parse(fs.readFileSync(DIR+'/routes.json','utf8'));
const C = RJ.palette, TXT = RJ.textOn;
// badgeLabels: optional map { <route key> : <text drawn in the badge> }. Lets a
// route keep a distinct internal key (matching the S2 data) while the badge
// shows something else — e.g. two different routes both numbered "46", or a
// lettered/branded service. Absent/empty => badge shows the key (byte-identical).
const BL = RJ.badgeLabels || {};
const blab = r => (BL[r] != null ? BL[r] : r);
// design{}: the opt-in cartographic-quality keys (design-quality plan, 2026-08-15).
// Every key defaults to the pre-2026-08-15 behaviour, so an absent `design` block is
// byte-identical and towns adopt them one at a time. See references/design-quality.md.
//   footerSafe:true   end the map frame just above the footer plate instead of at a
//                     flat y=205, which the plate then covered (Phase 1).
//   footerGap:1.0     mm of clear air between the frame and the plate.
//   reserveIcons:true POI icons reserve their box before any label is placed, so a
//                     later symbol can no longer be painted over an earlier label
//                     (Phase 1). Implied by labels.engine:"v2".
//   spreadIcons:true  POI symbols closer than iconMinSep are pushed apart (capped at
//                     spreadMax mm from their true position) so a cluster stops
//                     reading as one blob. Hand-placed POIs are never moved.
//   iconMinSep:3.2 / spreadMax:2.6   the two numbers that pass governs by.
//   iconInk:"charcoal" one neutral for every POI symbol, red kept for the GP
//                     cross, so colour on the sheet means ROUTE and nothing else
//                     (Peter's G3 answer, 2026-08-15 — option E of five rendered
//                     at printed size). Absent => the original palette.
//   panelScale:true   one 1.2-ratio type scale and one heading rhythm for the
//                     Services/Key panel, replacing eleven unrelated text sizes and
//                     two section headings that were different sizes with different
//                     amounts of air (Phase 6, §4.4). Full rationale at the panel
//                     code near the foot of this file.
const DESIGN = RJ.design || {};
// labels{}: which label placer to use.
//   engine:"v2"  hand point labels to the shared labeller.js — real Arial widths, an
//                occupancy grid that knows where the route ink is, scored candidate
//                positions, a relaxation pass, two-line wrapping and leader lines,
//                and a report of anything it still could not place. Absent => the
//                original first-fit placer below, byte-identical.
const LABELS = RJ.labels || {};
const V2 = LABELS.engine === 'v2';
if(V2 && DESIGN.reserveIcons === undefined) DESIGN.reserveIcons = true;
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
// river_geo.json is the legacy single-river feature; a town with no river (common
// outside Cambridgeshire) simply has no such file — tolerate its absence (=> []).
// features[] in routes.json supplies the real linear features either way.
const river   = (function(){ try{ return JSON.parse(fs.readFileSync(DIR+'/river_geo.json','utf8')); }catch(e){ return []; } })();
// ---- internalRoads config + data (2026-08-04: DEFAULT ON; absent key = standard
// object, same as internalRoads:true. Only explicit `internalRoads:false` => null
// => classic model.)
const IR = (RJ.internalRoads === false) ? null : (function(){
  const u = (RJ.internalRoads && RJ.internalRoads !== true) ? RJ.internalRoads : {};
  const o = Object.assign({ stroke:1.7, gap:2.8, skeleton:'#e4e4e4', skeletonPad:1.3,
    contextRoads:true, contextColor:'#f0f0f0', contextWidth:0.45,
    roadLabelMax:12, badgeEvery:70 }, u);       // gap>=stroke+~1mm so bundled lanes read separately (see header)
  o.focus = Object.assign({ coreKm:1.1, comp:0.5 }, u.focus||{});
  return o; })();
// ---- internalDiagram render extensions (tube-map diagram, 2026-07-10) ------
// Keyed off internalDiagramRENDER, which ONLY diagram_internal.js writes into
// its workspace routes.json (curated stop ticks, interchange lozenges, one-way
// loop arrows). Deliberately NOT the town's own `internalDiagram{}` key — that
// is the diagram engine's config and is present in the town routes.json, which
// the geographic and schematic builds also read; keying off it would leak the
// diagram's curated-stops filter into those maps (it did — caught by the v6.6
// S4 size check). Absent => zero effect, gate-safe.
const ID = RJ.internalDiagramRender || null;
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
  // Ordnance-Survey-style railway (Peter's ask 2026-07-20): a black casing line
  // with regular, bolder perpendicular "sleeper" crossbars — reads unmistakably
  // as a railway, unlike the old thin grey line. tieEvery/tieLen/tieWidth are
  // honoured by drawFeature(); a town can still override any of them per feature.
  // minSegLen (page mm): drop polyline segments shorter than this before drawing.
  // A multi-track railway (ECML through a station) is mapped as many parallel ways
  // plus short crossover/point stubs; the stubs' perpendicular ties splay every
  // direction into a mess at the junction throat. Filtering out the short stubs
  // leaves the clean OS through-line. Harmless where a railway has no such clutter.
  railway: { stroke:'#333333', width:1.5, dash:null, ties:true, tieEvery:2.6, tieLen:1.6, tieWidth:0.7, minSegLen:3.5 },
  road:    { stroke:'#e6a532', width:2.8, dash:null },
  generic: { stroke:'#999999', width:2.2, dash:null }
};
// CHEQUER railway (Peter's ask 2026-08-15, plan Phase 1b): opt in per feature
// with style:{rail:"chequer"}. A black casing with white blocks laid ON TOP as a
// dash pattern, which the renderer distributes along the WHOLE path — so unlike
// the tie symbol it cannot bunch, reset its phase at a vertex or splay at a
// hairpin, whatever the diagram engine does to the geometry. Chosen because the
// tie symbol is computed per polyline segment: on geographic geometry the median
// segment (1.1-2.5mm) is shorter than the 2.6mm tie pitch, so spacing follows
// vertex density; on diagram geometry (featureDamp warping, turns up to 148 deg)
// adjacent ties cross each other. Picking chequer also turns ties off, retires
// the minSegLen stub hack (no longer needed, and it punched visible gaps in the
// line), and switches on railStitch + railMerge below. Any key is still
// overridable per feature via style{}.
// WEIGHT (plan Phase 6, §3.4): 1.6 mm of #4a4a4a, not 1.9 mm of #333. The
// railway is context; the bus routes are the subject, and they are drawn at
// 1.7 mm. At 1.9/#333 the railway was the widest and darkest single line on the
// sheet, so context out-shouted subject on every geographic town. coreWidth moves
// with width to hold the dark edging either side of a white block at 55% of the
// casing (1.05/1.9) — drop the width alone and the symbol goes pale and mushy
// rather than lighter. The dash pitch is deliberately NOT scaled: it sets the
// symbol's rhythm along the line, which is what makes it read as a railway at
// arm's length. Comparison on all four railway towns, with 300 dpi crops:
// Development Docs\railway-weight-options_2026-08-15.html.
// NOTE the base railway `stroke` stays #333333, so the places — still on the tie
// symbol until the Phase 8 re-vendor — are untouched by this.
const RAIL_CHEQUER = { width:1.6, ties:false, dash:null, minSegLen:0, stroke:'#4a4a4a',
  coreWidth:0.88, coreColor:'#ffffff', chequer:'2.3 2.3',
  railStitch:0.5, railStitchTurn:60, railMerge:1.5, railMinRun:6 };
let FEATURES;
if(RJ.features && RJ.features.length){
  let fgeo={}; try{ fgeo=JSON.parse(fs.readFileSync(DIR+'/features_geo.json','utf8')); }catch(e){}
  FEATURES = RJ.features.map(f=>Object.assign({}, f, { geo: fgeo[f.key]||[] }));
  // A feature is looked up in features_geo.json BY KEY, so two entries sharing a
  // key silently share one geometry, and a key with no geometry draws nothing at
  // all while still printing its label. Ramsey shipped both faults together: two
  // features keyed "canal" against a features_geo.json whose "canal" holds zero
  // polylines, so "Canal" and "Bevills Leam" floated in the bottom-left corner as
  // italic blue text naming watercourses that are not on the map. Say so at build
  // time — a label pointing at nothing is worse than no label.
  const seen={};
  for(const f of FEATURES){
    if(seen[f.key]) console.error('features: two entries share the key "'+f.key+'" ("'+seen[f.key]
      +'" and "'+f.label+'") — features_geo.json is keyed by `key`, so they will draw the SAME geometry. Give them distinct keys.');
    seen[f.key]=f.label;
    if(f.label && !(f.geo||[]).length) console.error('features: "'+f.label+'" (key "'+f.key
      +'") has NO geometry in features_geo.json — its label will print with no line under it. '
      +'Re-run S2 for that feature, or drop it from routes.json features[].');
  }
} else {
  // The legacy fallback's label has always sat at y=200 — which was fine against
  // the old flat frame bottom of 205, and is 4.8 mm INSIDE the footer plate once
  // design.footerSafe ends the frame at 192.16. March, the one town with no
  // features[] of its own, was drawing "River Nene (old course)" and then painting
  // the plate over it, so its river shipped unlabelled. Keep x (bottom-left is
  // where this label has always gone) and lift y to just inside the frame.
  // Gated on footerSafe so the five PLACE sheets, still on v1 until the Phase 8
  // re-vendor, stay byte-identical.
  const legacyY = DESIGN.footerSafe
    ? Math.round((FOOTER_PLATE_TOP - (DESIGN.footerGap!=null?DESIGN.footerGap:3.0) - 6)*100)/100
    : 200;
  FEATURES = [{ key:'river', type:'river', label:(RJ.riverLabel||'River Great Ouse'),
    labelPos:{x:40,y:legacyY}, labelColor:'#7fb0d8', labelItalic:true, labelSize:4,
    labelReserve:[34,legacyY-7,86,legacyY+3], geo:river }];
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
// hiddenOperators (opt-in customer edit, top-level overrides.json array of
// routes.json operators[].name) — drop every route belonging to a hidden
// operator from the draw order AND the Services panel (the panel's own
// per-operator grouping then naturally omits that operator's now-empty
// group). Absent/empty => byte-identical.
const HIDDEN_OPS = new Set(ALLOV.hiddenOperators || []);
const HIDDEN_ROUTES = new Set();
if (HIDDEN_OPS.size) (RJ.operators||[]).forEach(op=>{ if(HIDDEN_OPS.has(op.name)) (op.routes||[]).forEach(r=>HIDDEN_ROUTES.add(r)); });
const dropHidden = arr => HIDDEN_ROUTES.size ? arr.filter(r=>!HIDDEN_ROUTES.has(r)) : arr;
// Route draw order (internal). Default = palette key order.
const order = dropHidden(RJ.routeOrder || Object.keys(C));
// Services-panel list order. Default = draw order.
const panelOrder = dropHidden(RJ.panelOrder || order);
// ====== internalCorridors — RUNG 1 of the complexity ladder (P2, 2026-07-28) ==
// routes.json "internalCorridors": { "<lead>": ["1","1A","1B"] }
//                              or   { "<lead>": {routes:["1","1A","1B"]} }
// Draw a family of CO-RUNNING services as ONE line carrying a STACK of badges
// instead of one coloured line each. The internal twin of external[].routes.
// Why: the colour-blind-safe palettes hold ~12 usable hues; past that the
// palette repeats and colour stops identifying a route (High Wycombe v1.0 drew
// 31 lines in 12 colours). See references/complexity-triage.md.
//
// HOW IT WORKS — and why the bundle cannot state something false:
// every member KEEPS ITS OWN GEOMETRY. Bundling changes only two things:
//   (a) COLOUR — every member takes the lead's colour (and text colour);
//   (b) LANE — members count as ONE lane in the corridor offset maths, so where
//       they co-run they land on the same centreline and overdraw into a single
//       visible line, and where they DIVERGE they simply separate again, because
//       nothing merged their coordinates.
// So "the bundle must split back where the routes diverge" is satisfied BY
// CONSTRUCTION rather than by a rule someone has to remember. What a divergence
// does cost is identity — both branches are now the same colour — so the badge
// logic below stacks the badges of the members actually co-running AT that point
// and lets a member badge its own divergent branch alone. `corridors_report.json`
// records the shared fraction per member so S6 can flag a weak family.
//
// Absent => every derived value is a no-op identity and output is byte-identical.
// The config KEY is always the lead: it keys the colour, the overrides and the
// badge-stack order, regardless of how the member list happens to be written.
// Shared by internalCorridors (rung 1) and corridorPalette (rung 3).
function parseFamilies(raw){
  if(!raw || raw===true) return null;
  const fam={}, lead={};
  for(const k of Object.keys(raw)){
    const v=raw[k];
    const members=Array.isArray(v)?v:((v&&v.routes)||[]);
    const list=[k].concat(members.filter(r=>r!==k));
    if(list.length<2) continue;
    fam[k]=list; for(const m of list) lead[m]=k;
  }
  return Object.keys(fam).length?{fam,lead}:null;
}
// Colour aliasing. Only routes ALREADY in the palette are touched, so
// Object.keys(C) — and therefore the default `order` computed above — cannot
// change. Applied after routeColors, so recolouring the lead moves the family.
function aliasColours(g){ if(!g) return;
  for(const l of Object.keys(g.fam)) for(const m of g.fam[l]){
    if(m===l) continue;
    if(m in C) C[m] = C[l];
    if(TXT && (m in TXT)) TXT[m] = TXT[l];
  }
}
const CORR = parseFamilies(RJ.internalCorridors);
// lane identity: a family draws as ONE lane keyed by its lead. Identity map when
// internalCorridors is absent, which is what keeps every existing town unchanged.
const laneKey = CORR ? (r=>CORR.lead[r]||r) : (r=>r);
aliasColours(CORR);
// ====== corridorPalette — RUNG 3 of the complexity ladder (P3, 2026-07-28) ===
// routes.json "corridorPalette": { "<lead>": ["31","41"] }  (same shape as
// internalCorridors; also accepted: { "<lead>": {routes:[...]} })
//
// Colour by CORRIDOR rather than by route. The members keep their own line and
// their own lane — only the colour is shared — so this is the remedy for routes
// that follow the same corridor but do NOT co-run closely enough to bundle
// (High Wycombe's 31 and 41 overlap 0.40/0.46: one corridor, two real lines).
//
// THIS RETIRES A LOCKED DESIGN DECISION and is bounded: "one colour per route,
// consistent across both maps and across updates" no longer holds for the towns
// that use it. Approved 2026-07-28 for towns drawing more than 12 lines only. It
// is never a default and never inferred — the groups are declared, so a data
// refresh cannot silently reshuffle the town's colours.
//
// Because colour no longer identifies a route here, IDENTITY MUST COME FROM THE
// BADGES, so the badge pass below guarantees every colour-grouped line at least
// one badge rather than letting collision detection drop it silently.
const CPAL = parseFamilies(RJ.corridorPalette);
aliasColours(CPAL);
// A route whose colour is shared with another DRAWN LINE (rung 3, or a rung-1
// family that has diverged). Used to guarantee a badge.
const colourShared = r => !!(CPAL && CPAL.lead[r]);

// ====== coreBox — RUNG 2 of the complexity ladder (P3, 2026-07-28) ===========
// routes.json "coreBox": { "radius": 600, "label": "town centre" }
//   optional: "sublabel", "at":[x,y], "w", "h", "fill", "stroke", "textSize"
//
// Replace the congested town centre with a plain labelled box that routes run TO
// and stop at, instead of drawing the knot. This is the single most decisive
// move on a commercial operator's own big-town map (Carousel's High Wycombe
// sheet deletes its 1.21 km² core outright), and it is the only remedy that
// attacks a TRUNK-CORRIDOR congestion (D5 > 3 km) — a fisheye lens cannot.
//
// `radius` is in METRES from `anchor`, matching how complexity_score.js models
// rung 2, so the predicted score and the drawn sheet mean the same thing. The
// page-space rectangle is derived by projecting a real geographic circle of that
// radius and taking its bounding box — exact under any fisheye or lens, with no
// assumption about local scale. Everything inside the rectangle is suppressed or
// covered: route lines are CUT at the boundary (so each ends flush against the
// box rather than being hidden under it), and stop ticks, POIs, road labels, the
// anchor label and route badges inside it are dropped.
const CBOX = RJ.coreBox ? (RJ.coreBox===true?{}:RJ.coreBox) : null;

// ====== stopThinning — RUNG 2b of the complexity ladder (P3, 2026-07-28) =====
// routes.json "stopThinning": true  or  { minLines:2, termini:true,
//                                         keep:["ATCO",…], drop:["ATCO",…] }
//
// Draw only the stops that earn their place: interchanges (served by `minLines`
// or more DRAWN LINES) plus every line's two end stops. Label load is
// independent of route count — a town can clear R, K5 and D5 and still be
// unreadable because 300 stop ticks and their names fight for the same square
// centimetre — so without this the ladder cannot finish (High Wycombe stays RED
// on S alone however well rungs 0-2 do). The rule is deliberately the SAME one
// complexity_score.js models for rung 2b, so the prediction and the sheet agree.
//
// Counted per LANE, not per route: a stop served only by a bundled 1/1A/1B is
// served by one drawn line, not three.
const THIN = RJ.stopThinning ? (RJ.stopThinning===true?{}:RJ.stopThinning) : null;
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
// ---- optional local DETAIL LENSES (item 7, 2026-07-20): magnify one or more
//   congested clusters (e.g. St Neots' One Leisure / Eynesbury knot) WITHOUT
//   disturbing the rest of the map. Bounded Sarkar–Brown graphical fisheye: inside
//   radiusKm the centre is magnified `mag`×, compressing toward a FIXED boundary,
//   so the map's overall extent (hence fit-to-frame scale) and everything outside
//   each lens are unchanged. Applied after the primary focus fisheye, to
//   stops/roads/river/POIs alike (all go through tform). This is the "second
//   fisheye" the geographic map can carry on top of the always-on centre focus.
//   Config: internalRoads.lenses:[{center:[lat,lon],radiusKm,mag}]. Absent => none
//   => tform is byte-identical to before, so gate towns are unaffected.
const LENSES = (IR && Array.isArray(IR.lenses)) ? IR.lenses.map(z=>({
    c: compress(tform0(z.center)),
    R: (z.radiusKm!=null?z.radiusKm:0.5)/111.32,
    mag: z.mag!=null?z.mag:1.8 })) : [];
function lens(p){
  for(const z of LENSES){
    const dx=p[0]-z.c[0], dy=p[1]-z.c[1], r=Math.hypot(dx,dy);
    if(r===0 || r>=z.R) continue;
    const d=z.mag-1, rho=r/z.R, g=((d+1)*rho)/(d*rho+1), nr=z.R*g;
    p=[z.c[0]+dx/r*nr, z.c[1]+dy/r*nr];
  }
  return p;
}
const tform=ll=>lens(compress(tform0(ll)));
// viewport (map left/centre; right reserved for panel)
// MY1 (the frame's bottom edge) used to be a flat 205 mm on every sheet while the
// footer's backing plate starts at FOOTER_PLATE_TOP — 195.16 mm for the two standard
// notes — and is drawn ON TOP at the end of the file. So a 9.84 mm strip of every map
// was drawn and then erased: measured across the 31 shipped sheets (2026-08-15), 12 had
// real route ink under the plate (979 mm² in total) and 9 had erased *text*. The fit
// below is derived from MY1, so shortening the frame refits the map into the space that
// is actually visible rather than clipping content away. Opt-in per town while the
// design-quality plan is in flight; absent `design.footerSafe` => 205, byte-identical.
// footerGap defaults to 3.0 mm rather than hard against the plate because the terminus
// exit ARROWS are drawn OUTSIDE the map's clip group and point 2.6 mm past the cut
// point, i.e. past the frame — a 1 mm gap left their tips under the plate and the ink
// measure barely moved. 3.0 mm clears the arrow with a hair to spare.
const MX0=6, MX1=196, MY0=30;
const MY1 = DESIGN.footerSafe
  ? Math.round((FOOTER_PLATE_TOP - (DESIGN.footerGap!=null?DESIGN.footerGap:3.0))*100)/100
  : 205;
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
  out(`<text x="${x}" y="${y}" font-family="Arial" font-weight="bold" font-size="${(rad).toFixed(2)}" fill="${TXT[r]||'#fff'}" text-anchor="middle" dominant-baseline="central">${esc(blab(r))}</text>`);}
// A bundled corridor's badge is a vertical STACK of its members' badges (the
// convention every operator's own big-town map uses: one line, many identities).
// A one-element list reduces to exactly badge() at the same centre, so an
// unbundled town is byte-identical. Returns the stack's half-height in mm so the
// caller can reserve the right box.
function badgeStack(x,y,list,rad){
  if(list.length===1){ badge(x,y,list[0],rad); return rad; }
  const pitch=rad*2+0.5, y0=y-(list.length-1)/2*pitch;
  list.forEach((r,i)=>badge(x, y0+i*pitch, r, rad));
  return (list.length-1)/2*pitch + rad;
}
function cross(x,y,col){const a=1.0,b=2.6;out(`<rect x="${x-a/2}" y="${y-b/2}" width="${a}" height="${b}" fill="${col}"/><rect x="${x-b/2}" y="${y-a/2}" width="${b}" height="${a}" fill="${col}"/>`);}

// ---- linear features: paths + labels (honour overrides.features[key]) ----
const featOv = f => (OV.features||{})[f.key]||{};
const featStyle = f => {
  const base = FEATURE_STYLES[f.type]||FEATURE_STYLES.generic;
  const own  = Object.assign({}, f.style||{}, featOv(f).style||{});
  // rail:"chequer" layers its defaults BETWEEN the type default and the town's
  // own style, so the town keeps the last word on any individual key.
  const mid  = (own.rail||base.rail)==='chequer' ? RAIL_CHEQUER : {};
  return Object.assign({}, base, mid, own);
};
function featSegs(f){              // page-mm polylines, honouring straighten/move overrides
  const ov=featOv(f); let segs;
  if(ov.segments) segs = ov.segments.map(s=>s.map(p=>[p[0],p[1]]));      // straighten (page mm)
  else if(ov.points) segs = [ov.points.map(p=>[p[0],p[1]])];
  else segs = f.geo.map(seg=>seg.map(p=>XY(p)));                          // project geo -> page mm
  const dx=(ov.move&&ov.move.dx)||0, dy=(ov.move&&ov.move.dy)||0;         // nudge whole feature
  if(dx||dy) segs = segs.map(s=>s.map(p=>[p[0]+dx,p[1]+dy]));
  return segs;
}
// segLen / ptToSeg / ptToPoly: shared by the stitch and merge passes below.
const segLen=s=>{ let L=0; for(let i=1;i<s.length;i++) L+=Math.hypot(s[i][0]-s[i-1][0],s[i][1]-s[i-1][1]); return L; };
function ptToSeg(p,a,b){
  const dx=b[0]-a[0], dy=b[1]-a[1], L2=dx*dx+dy*dy;
  if(!L2) return Math.hypot(p[0]-a[0],p[1]-a[1]);
  let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2; t=Math.max(0,Math.min(1,t));
  return Math.hypot(p[0]-(a[0]+t*dx), p[1]-(a[1]+t*dy));
}
const ptToPoly=(p,poly)=>{ let d=Infinity; for(let i=1;i<poly.length;i++) d=Math.min(d,ptToSeg(p,poly[i-1],poly[i])); return d; };
function turnAt(s, i){           // degrees the line turns through at vertex i
  if(i<1 || i>=s.length-1) return 0;
  const a=Math.atan2(s[i][1]-s[i-1][1], s[i][0]-s[i-1][0]);
  const b=Math.atan2(s[i+1][1]-s[i][1], s[i+1][0]-s[i][0]);
  return Math.abs(((b-a+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI)*180/Math.PI;
}
// railStitch (page mm): join polylines whose endpoints meet, so a line broken
// into several OSM ways becomes one path. Matters for the chequer symbol, whose
// dash phase restarts at each path — without this a white block can straddle a
// join. Also lets the merge pass below judge whole lines rather than fragments.
// maxTurn guards against the failure this had on first run: the four parallel
// tracks through St Neots station all begin and end at the same throat, so their
// endpoints are within tol of each other and they were chained into one path
// that doubled back on itself four times — four superimposed strokes with
// different dash phases, which renders as a solid white core. A real
// continuation carries on in roughly the same direction; a doubling-back does
// not, so reject any join that turns more than maxTurn degrees.
function stitchSegs(segs, tol, maxTurn){
  const out = segs.map(s=>s.slice());
  for(let joined=true; joined; ){
    joined=false;
    scan:
    for(let i=0;i<out.length;i++) for(let j=i+1;j<out.length;j++){
      const A=out[i], B=out[j], near=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1])<=tol;
      const cands=[];
      if(near(A[A.length-1],B[0]))               cands.push([A.concat(B.slice(1)), A.length-1]);
      if(near(A[A.length-1],B[B.length-1]))      cands.push([A.concat(B.slice(0,-1).reverse()), A.length-1]);
      if(near(A[0],B[0]))                        cands.push([A.slice(1).reverse().concat(B), A.length-2]);
      if(near(A[0],B[B.length-1]))               cands.push([B.concat(A.slice(1)), B.length-1]);
      for(const [m,jn] of cands){
        if(turnAt(m, jn) > maxTurn) continue;
        out.splice(j,1); out.splice(i,1,m); joined=true; break scan;
      }
    }
  }
  return out;
}
function densify(s, step){       // even sampling, so coverage is judged along the
  const out=[s[0]];              // line rather than at whatever vertices OSM gave us
  for(let i=1;i<s.length;i++){
    const a=s[i-1], b=s[i], n=Math.max(1, Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));
    for(let k=1;k<=n;k++) out.push([a[0]+(b[0]-a[0])*k/n, a[1]+(b[1]-a[1])*k/n]);
  }
  return out;
}
function dropCollinear(s, eps){  // undo densify's padding without moving the line
  if(s.length<3) return s;
  const out=[s[0]];
  for(let i=1;i<s.length-1;i++) if(ptToSeg(s[i], out[out.length-1], s[i+1])>eps) out.push(s[i]);
  out.push(s[s.length-1]);
  return out;
}
// railMerge (page mm): OSM maps a double-track line as two ways, plus loops,
// sidings and platform lines, and we were drawing every one of them with its own
// casing and its own ties (36 polylines / 1434 tie strokes on the St Neots
// diagram sheet). Take the longest line first and, for each later one, keep only
// the stretches that are NOT already within tol of a line already kept — trimmed,
// not dropped whole, because a siding that runs alongside for 90% of its length
// and then diverges would otherwise survive entirely and re-double the main line.
// (That is not hypothetical: it is what the first cut of this did on St Neots,
// where two coincident lines' dash phases interleaved into a solid white core.)
// Trimmed stretches shorter than minRun are dropped as floating fragments.
// Length order with an index tiebreak keeps the output deterministic.
function mergeSegs(segs, tol, minRun){
  const kept=[], step=Math.max(0.4, tol/3);
  for(const {s} of segs.map((s,i)=>({s,i,L:segLen(s)})).sort((a,b)=>b.L-a.L||a.i-b.i)){
    if(!kept.length){ kept.push(s); continue; }
    const runs=[]; let run=[];
    for(const p of densify(s, step)){
      if(kept.some(k=>ptToPoly(p,k)<=tol)){ if(segLen(run)>=minRun) runs.push(run); run=[]; }
      else run.push(p);
    }
    if(segLen(run)>=minRun) runs.push(run);
    for(const r of runs) kept.push(dropCollinear(r, 0.02));
  }
  return kept;
}
function drawFeature(f){
  if(featOv(f).hide) return;
  const st=featStyle(f); let segs=featSegs(f);
  if(st.railStitch) segs = stitchSegs(segs, st.railStitch, st.railStitchTurn!=null?st.railStitchTurn:60);
  if(st.railMerge)  segs = mergeSegs(segs, st.railMerge, st.railMinRun!=null?st.railMinRun:6);
  if(st.minSegLen){                              // drop short stubs (e.g. rail crossovers) — see FEATURE_STYLES
    segs = segs.filter(s=>s.length>1 && segLen(s)>=st.minSegLen);
  }
  const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : '';
  const lines=[];
  for(const seg of segs){
    const d=seg.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
    if(st.chequer){                              // black casing + white blocks on top
      lines.push(`<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}" stroke-linecap="butt" stroke-linejoin="round"/>`);
      lines.push(`<path d="${d}" fill="none" stroke="${st.coreColor}" stroke-width="${st.coreWidth}" stroke-dasharray="${st.chequer}" stroke-linecap="butt"/>`);
      continue;
    }
    lines.push(`<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}"${dash} stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  if(st.ties){                     // railway cross-ties (perpendicular ticks)
    const t = st.tieLen!=null ? st.tieLen : st.width*0.9;   // OS-style: longer, bolder,
    const step = st.tieEvery!=null ? st.tieEvery : 2.2;     // evenly-spaced crossbars.
    const tw = st.tieWidth!=null ? st.tieWidth : 0.5;       // (defaults = legacy behaviour)
    for(const seg of segs) for(let i=0;i<seg.length-1;i++){
      const [x0,y0]=seg[i],[x1,y1]=seg[i+1], L=Math.hypot(x1-x0,y1-y0); if(!L) continue;
      const nx=-(y1-y0)/L, ny=(x1-x0)/L;
      for(let dd=step*0.5; dd<L; dd+=step){ const cx=x0+(x1-x0)*dd/L, cy=y0+(y1-y0)*dd/L;
        lines.push(`<path d="M${(cx-nx*t).toFixed(2)} ${(cy-ny*t).toFixed(2)}L${(cx+nx*t).toFixed(2)} ${(cy+ny*t).toFixed(2)}" stroke="${st.stroke}" stroke-width="${tw}"/>`); }
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
  // coreBox: a feature label is placed by hand (labelPos) and has no collision
  // logic of its own, so one sited on the town centre would print INSIDE the
  // box. Drop it and say so — the fix is to move labelPos, not to hide the river.
  if(inCore([x,y])){
    console.error('coreBox: feature label "'+text+'" sits inside the town-centre box and was not '
      +'drawn — move its labelPos (routes.json features[] / overrides internal.features).');
    return;
  }
  // Same trap on the other side of the sheet, and it had actually happened: a
  // feature label is drawn OUTSIDE the map's clip group, so a labelPos right of
  // the frame lands in the Services panel and prints through the route list.
  // Wisbech shipped for months with "River Nene" struck across "46 Wisbech –
  // March" and "A47" adrift in the blank space under the Key. Neither the panel
  // metric (which counts point labels) nor the byte gate can see it, so refuse
  // to draw it and say why — as with coreBox, the fix is the labelPos.
  if(x>MX1+2){
    console.error('panel: feature label "'+text+'" sits at x='+x.toFixed(0)+', right of the map frame '
      +'(x'+MX1+') and inside the Services panel — not drawn. Move its labelPos '
      +'(routes.json features[] / overrides internal.features).');
    return;
  }
  // And the third edge, found 2026-08-15 the same way the Wisbech one was — by
  // asking why a number would not move. Six sheets were shipping a river, canal
  // or railway label sited BELOW the frame, at y=196..200 against a footer plate
  // starting at 195.16: drawn, then covered, so those features went unlabelled
  // and no-one could see why. footerSafe does not help, because a feature label
  // is drawn outside the map's clip group. Refuse it and say so, as above.
  if(DESIGN.footerSafe && y>FOOTER_PLATE_TOP-1.5){
    console.error('footer: feature label "'+text+'" sits at y='+y.toFixed(0)+', under the footer plate '
      +'(top y'+FOOTER_PLATE_TOP.toFixed(1)+') where it is painted and then covered — not drawn. '
      +'Move its labelPos (routes.json features[] / overrides internal.features).');
    return;
  }
  const italic=f.labelItalic!==false, size=f.labelSize||4, anchor=lov.anchor||null;
  out(`<text x="${x}" y="${y}" font-family="Arial" ${italic?'font-style="italic" ':''}font-size="${size}"${anchor?` text-anchor="${anchor}"`:''} fill="${f.labelColor||'#7fb0d8'}">${esc(text)}</text>`);
}

// ---- label de-collision: reserved boxes + greedy placement ----
const placed=[];                 // [x0,y0,x1,y1]
// design.reserveIcons: boxes contributed by POI ICONS rather than by text. They are
// ordinary members of `placed` for the first placement attempt, but a placer that
// finds nowhere at all falls back to a second pass that ignores them — so a label
// that could only ever have sat on a symbol still prints exactly where it used to.
// That keeps the change strictly a GAIN: labels that can dodge a symbol now do, and
// none is lost. (`rollout.js` refuses to publish a label loss, by design.)
const iconBoxes=new Set();
const hit=(b,o)=>!(b[2]<o[0]||b[0]>o[2]||b[3]<o[1]||b[1]>o[3]);
const overlaps=(b,skip)=>placed.some(o=>o!==skip && hit(b,o));
const overlapsNoIcons=(b)=>placed.some(o=>!iconBoxes.has(o) && hit(b,o));
// labels.engine:"v2" — one shared placer for the point labels (labeller.js). It is fed
// from the SAME reserve() calls the old placer uses, so nothing has to be remembered
// twice, plus the route ink read straight off the SVG this file has already emitted.
// Solved and drawn in one block near the end (the "two-phase draw"): every symbol,
// badge, pill and tick has claimed its space before the first label is positioned,
// which retires the whole class of "a later thing painted over an earlier label".
// bounds repeat the old placer's own page test (`b[0]<1 || b[2]>MX1+2`) as a hard
// limit — without it a name at the left edge of the map runs off the paper, because
// straying outside the frame is only COSTED, and on a congested edge the cost is
// sometimes the cheapest thing going (caught in the first St Ives v2 render).
const LAB = V2 ? new Labeller({ page:[297,210], frame:{x0:MX0,y0:MY0,x1:MX1,y1:MY1},
                                bounds:{x0:1, y0:1, x1:MX1+2, y1:FOOTER_PLATE_TOP-0.4} }) : null;
function reserve(x0,y0,x1,y1){placed.push([x0,y0,x1,y1]); if(LAB) LAB.block([x0,y0,x1,y1]);}
// `self` = this label's OWN icon box, excluded from the collision test: placement puts a
// label 2.6 mm from a 4.2 mm symbol by design, so its own symbol is not a defect (the
// same exclusion quality_metrics.js makes when it counts "label over a foreign icon").
function placeLabel(x,y,text,sz=2.6,col='#222',italic=false,lov=null,self=null,opt=null){
  if(LAB){                                     // v2: queue it, solve them all together
    LAB.add(Object.assign({ id:(opt&&opt.id)||('L'+text+'@'+x.toFixed(1)+','+y.toFixed(1)),
      at:[x,y], text, size:sz, fill:col, italic, own:self||null,
      fixed: (lov&&lov.offset) ? {x:x+lov.offset.dx, y:y+lov.offset.dy, anchor:lov.anchor||'start'} : null,
    }, opt||{}));
    return true;                               // the caller only uses this to decide whether
  }                                            // to draw a fallback; v2 never silently drops
  const w=text.length*sz*0.52, h=sz;
  let chosen=null;
  if(lov && lov.offset){                       // manual label placement (skip de-collision)
    const anc=lov.anchor||'start'; chosen=[x+lov.offset.dx, y+lov.offset.dy, anc];
  } else {
    const cands=[[x+2.6,y+0.9,'start'],[x-2.6,y+0.9,'end'],[x,y-2.6,'middle'],[x,y+3.6,'middle'],
                 [x+2.6,y-2.2,'start'],[x-2.6,y-2.2,'end'],[x+2.6,y+3.4,'start'],[x-2.6,y+3.4,'end']];
    const box=([lx,ly,anc])=>{ const bx = anc==='start'?lx : anc==='end'?lx-w : lx-w/2;
      return [bx-0.4,ly-h,bx+w+0.4,ly+1]; };
    const onPage=b=>!(IR && (b[0]<1 || b[2]>MX1+2));   // keep labels on the page / off the panel
    for(const c of cands){ const b=box(c);
      if(!onPage(b)) continue;
      if(!overlaps(b,self)){ placed.push(b); chosen=c; break; }
    }
    if(!chosen && iconBoxes.size){             // nowhere clear of the symbols: fall back to
      for(const c of cands){ const b=box(c);   // the pre-reserveIcons behaviour rather than drop
        if(!onPage(b)) continue;
        if(!overlapsNoIcons(b)){ placed.push(b); chosen=c; break; }
      }
    }
  }
  if(!chosen){ return false; }                // give up rather than overlap
  const [lx,ly,anc]=chosen;
  out(`<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-family="Arial" font-size="${sz}" ${italic?'font-style="italic" ':''}fill="${col}" text-anchor="${anc}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(text)}</text>`);
  return true;
}
// Where a POI's symbol lands, and whether it is drawn at all — split out of poiMark so
// the icon-reservation pre-pass and the drawing pass cannot disagree about either.
const POI_HALF=2.1;                             // icon(p.cat,x,y,2.1) => a 4.2 mm box
function poiSite(p){
  const k=p.cat+':'+p.name; const o=(OV.pois||{})[k]||{};
  if(o.hide) return null;                       // suppress this POI entirely
  let [x,y]=XY(p.ll);
  if(o.pos){ x=o.pos.x; y=o.pos.y; } else if(o.move){ x+=o.move.dx; y+=o.move.dy; }
  if(IR && (x<MX0+1||x>MX1-1||y<MY0+1||y>MY1-1) && !o.pos && !o.move) return null; // off-frame under roads model
  if(inCore([x,y])) return null;                // coreBox: the centre is deliberately blank
  const n=poiNudge.get(k); if(n){ x+=n[0]; y+=n[1]; }   // design.spreadIcons displacement
  return {k,o,x,y};
}
const poiBox=new Map();                         // poi key -> its reserved icon box (design.reserveIcons)
const poiNudge=new Map();                       // poi key -> [dx,dy] from spreadIcons
/*
 * design.spreadIcons — pull fused symbols apart.
 *
 * Two 4.2 mm symbols whose centres are 1 mm apart read as one unidentifiable blob,
 * and the reader loses both. The 2026-08-15 baseline counted 110 such pairs across
 * the 31 sheets, 34 of them on High Wycombe's internal sheet alone. Nothing in the
 * engine had ever tried to separate them: a POI is drawn exactly where OSM puts it,
 * and in a town centre several land within a couple of metres of each other.
 *
 * This is the standard cartographic answer — displace, don't drop. A few rounds of
 * mutual repulsion, capped so a symbol never strays more than `spreadMax` mm from
 * its true position (default 2.6, about a block at these scales), and hand-placed
 * POIs (overrides pos/move) are pinned and never moved. The label follows its
 * symbol, because both read the same adjusted point.
 */
function spreadIcons(){
  const S=[]; const cap=(DESIGN.spreadMax!=null?DESIGN.spreadMax:2.6);
  const sep=(DESIGN.iconMinSep!=null?DESIGN.iconMinSep:3.2);
  for(const p of pois){ const s=poiSite(p); if(!s) continue;
    S.push({k:s.k, x0:s.x, y0:s.y, x:s.x, y:s.y, pinned:!!(s.o.pos||s.o.move)}); }
  for(let it=0; it<24; it++){
    let worst=0;
    for(let i=0;i<S.length;i++) for(let j=i+1;j<S.length;j++){
      const a=S[i], b=S[j];
      let dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy);
      if(d>=sep) continue;
      worst=Math.max(worst, sep-d);
      // A deterministic push direction when two symbols are exactly coincident:
      // derive it from the pair's index, never from a random or hash.
      if(d<1e-6){ const ang=(i*7+j)*0.7853981633974483; dx=Math.cos(ang); dy=Math.sin(ang); d=1; }
      const push=(sep-d)/2*0.6, ux=dx/d, uy=dy/d;
      if(!a.pinned){ a.x-=ux*push; a.y-=uy*push; }
      if(!b.pinned){ b.x+=ux*push; b.y+=uy*push; }
    }
    if(worst<0.02) break;
  }
  for(const s of S){                             // never stray far from the truth
    let dx=s.x-s.x0, dy=s.y-s.y0; const d=Math.hypot(dx,dy);
    if(d>cap){ dx=dx/d*cap; dy=dy/d*cap; }
    if(dx||dy) poiNudge.set(s.k,[dx,dy]);
  }
}
function reserveIcons(){
  for(const p of pois){ const s=poiSite(p); if(!s) continue;
    const b=[s.x-POI_HALF, s.y-POI_HALF, s.x+POI_HALF, s.y+POI_HALF];
    placed.push(b); iconBoxes.add(b); poiBox.set(s.k, b);
    // v2 also wants every symbol as an ANCHOR, labelled or not: the placer costs a
    // position that sits nearer someone else's symbol than its own, which is what
    // stops a name reading as if it belongs to the thing next door.
    // The anchor id must be the SAME id the label is queued under, or the placer
    // reads a POI's own symbol as a foreign one sitting 0 mm away and charges the
    // full ambiguity penalty to every candidate it has.
    if(LAB){ LAB.block(b, 'icon'); LAB.anchor(s.x, s.y, 'poi:'+s.k); }
  }
}
function poiMark(p){
  const s=poiSite(p); if(!s) return;
  const {k,o,x,y}=s;
  out(gk('poi',k,icon(p.cat,x,y,2.1,DESIGN.iconInk)));
  const auto = ['shop','leisure','school','park','community','allotments'].includes(p.cat) && p.name && p.name!=='Park';
  const showName = o.force===true || (auto && o.force!==false);
  if(showName) placeLabel(x,y,p.name,2.5,'#222',false,o.label||null,poiBox.get(k)||null,{id:'poi:'+k});
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
let CORUN=null;                   // MEMR: r -> {segIdx:[routes physically co-running there]}
const inFrame=p=>p[0]>=MX0&&p[0]<=MX1&&p[1]>=MY0&&p[1]<=MY1;

// ---- coreBox geometry (rung 2). Null unless routes.json coreBox is set. ------
// Project a real geographic circle of `radius` metres around the anchor and take
// its page-space bounding box. Doing it this way, rather than converting metres
// to mm through a scale factor, is exact under the focus fisheye and any extra
// lenses[] — which is the whole difficulty, since those deliberately make the
// centre's scale different from everywhere else.
const CORE = (function(){
  if(!CBOX) return null;
  const all = atco2ll[ANCHOR];
  if(!all){ console.error('coreBox: anchor '+ANCHOR+' has no coordinate — box not drawn'); return null; }
  const R = (CBOX.radius!=null?CBOX.radius:600)/1000;           // km
  const latKm = 110.574, lonKm = 111.320*Math.cos(all[0]*Math.PI/180);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let i=0;i<72;i++){ const a=i/72*2*Math.PI;
    const p=XY([all[0]+R*Math.cos(a)/latKm, all[1]+R*Math.sin(a)/lonKm]);
    if(p[0]<x0)x0=p[0]; if(p[0]>x1)x1=p[0]; if(p[1]<y0)y0=p[1]; if(p[1]>y1)y1=p[1]; }
  if(CBOX.w!=null){ const cx=(x0+x1)/2; x0=cx-CBOX.w/2; x1=cx+CBOX.w/2; }
  if(CBOX.h!=null){ const cy=(y0+y1)/2; y0=cy-CBOX.h/2; y1=cy+CBOX.h/2; }
  if(CBOX.at){ const w=x1-x0, h=y1-y0;                          // re-centre by hand
    x0=CBOX.at[0]-w/2; x1=CBOX.at[0]+w/2; y0=CBOX.at[1]-h/2; y1=CBOX.at[1]+h/2; }
  return { x0,y0,x1,y1, label:(CBOX.label!=null?CBOX.label:'town centre'), sublabel:CBOX.sublabel||null };
})();
const inCore = p => !!CORE && p[0]>=CORE.x0 && p[0]<=CORE.x1 && p[1]>=CORE.y0 && p[1]<=CORE.y1;
// ---- stopThinning: the set of stops that keep their tick (null => all) -------
const THINKEEP = (function(){
  if(!THIN) return null;
  const minLines = THIN.minLines!=null?THIN.minLines:2;
  const keep = new Set(THIN.keep||[]);
  const lanes = {};
  for(const r of order){ const chain=routes[r]; if(!chain||!chain.length) continue;
    if(THIN.termini!==false){ keep.add(chain[0]); keep.add(chain[chain.length-1]); }
    const lane=laneKey(r);
    for(const a of new Set(chain)) (lanes[a]=lanes[a]||new Set()).add(lane); }
  for(const a of Object.keys(lanes)) if(lanes[a].size>=minLines) keep.add(a);
  keep.add(ANCHOR);                                    // the interchange always stays
  for(const a of (THIN.drop||[])) keep.delete(a);
  return keep;
})();
const keepStop = a => !THINKEEP || THINKEEP.has(a);
// Where does the segment out->inn cross the box boundary? Axis-aligned, so test
// the four planes and keep the first crossing that actually lands on an edge.
function coreEdge(outP,innP){
  const cand=[];
  if(innP[0]!==outP[0]){ cand.push((CORE.x0-outP[0])/(innP[0]-outP[0])); cand.push((CORE.x1-outP[0])/(innP[0]-outP[0])); }
  if(innP[1]!==outP[1]){ cand.push((CORE.y0-outP[1])/(innP[1]-outP[1])); cand.push((CORE.y1-outP[1])/(innP[1]-outP[1])); }
  let best=1, e=1e-6;
  for(const t of cand){ if(!(t>=0&&t<=1)) continue;
    const p=[outP[0]+(innP[0]-outP[0])*t, outP[1]+(innP[1]-outP[1])*t];
    if(p[0]>=CORE.x0-e&&p[0]<=CORE.x1+e&&p[1]>=CORE.y0-e&&p[1]<=CORE.y1+e && t<best) best=t; }
  return [outP[0]+(innP[0]-outP[0])*best, outP[1]+(innP[1]-outP[1])*best];
}
// Split a polyline into the runs OUTSIDE the box, each ending exactly on the
// boundary. A route that crosses the centre and comes out the other side yields
// two runs — which is the point: it visibly runs TO the box from both sides.
//
// A run shorter than `coreBox.minRun` mm is DROPPED. Town-centre one-way loops
// make a route's matched path poke a few millimetres back out of the box and in
// again, and that orphan stub — a line fragment attached to nothing, with the
// route's terminus badge stack planted on it — reads as a real branch (High
// Wycombe v2.0 draft: 102/103/104/105 each left a 5 mm stub west of the box
// carrying a six-badge stack). Only reachable when coreBox is set.
const MINRUN = CBOX ? (CBOX.minRun!=null?CBOX.minRun:2.5) : 0;
const runLen = rn => { let L=0; for(let i=1;i<rn.length;i++) L+=Math.hypot(rn[i][0]-rn[i-1][0], rn[i][1]-rn[i-1][1]); return L; };
function clipOutCore(pts){
  if(!CORE) return [pts];
  const runs=[]; let cur=[];
  for(let i=0;i<pts.length;i++){
    if(!inCore(pts[i])){
      if(!cur.length && i>0) cur.push(coreEdge(pts[i], pts[i-1]));   // leaving the box
      cur.push(pts[i]);
    } else if(cur.length){
      cur.push(coreEdge(cur[cur.length-1], pts[i]));                 // entering the box
      runs.push(cur); cur=[];
    }
  }
  if(cur.length) runs.push(cur);
  return runs.filter(rn=>rn.length>=2 && runLen(rn)>=MINRUN);
}
// r -> the endpoints of the runs actually DRAWN, so a terminus badge is never
// planted on a stub that clipOutCore threw away. Null without a coreBox.
const CORERUNS = CORE ? {} : null;
// Map an index in TRIM[r].pts back to the SOURCE polyline segment index, so the
// badge logic can ask CORUN who co-runs at that point. pts = sh.slice(s0,e+1)
// with the frame-cut points spliced on, so the shift is s0 minus the leading cut.
const segIdxOf=(tr,i)=>{ if(!tr||!tr.sh) return i;
  const j=(tr.draw?tr.draw.s0:0) + i - (tr.startCut?1:0);
  return Math.max(0, Math.min(tr.sh.length-2, j)); };
// The internalCorridors members actually co-running with r at that segment, in
// family order. Without the key this is always [r] — one badge, as before.
const famAt=(r,si)=>{ if(!CORR || !CORR.lead[r]) return [r];
  const fam=CORR.fam[CORR.lead[r]] || [r];
  const here=(CORUN && CORUN[r] && CORUN[r][si]) || [r];
  return fam.filter(m=>m===r || here.includes(m)); };
// Which route draws the badge for a bundled group: the first family member
// present. Every other member returns null there and stays silent, so the shared
// line carries ONE stack — but a member alone on a divergent branch is its own
// group leader and still badges its branch.
const badgeGroup=(r,si)=>{ const g=famAt(r,si); return g[0]===r ? g : null; };
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
  // MEMR = ROUTE-level membership (who physically co-runs here).
  // MEM  = LANE-level membership (MEMR with each internalCorridors family
  //        collapsed to its lead) — this is what sizes the casing and picks the
  //        lane offsets, so a bundled family occupies ONE lane. Without
  //        internalCorridors laneList() is the identity and MEM === MEMR.
  const laneList = CORR
    ? (a=>[...new Set(a.map(laneKey))].sort((x,y)=>orderIdx[x]-orderIdx[y]))
    : (a=>a);
  const MEM={}, MEMR={};
  for(const s of SEG){ const set=new Set([s.r]);
    for(const u of SEG){ if(u.r===s.r)continue;
      if(Math.abs(s.ux*u.ux+s.uy*u.uy)<CA)continue;             // not near-parallel
      if(pSeg(s.mx,s.my,u)>CD)continue;                         // s mid far from u
      if(pSeg(u.mx,u.my,s)>CD)continue;                         // u mid far from s
      set.add(u.r); }
    const here=[...set].sort((x,y)=>orderIdx[x]-orderIdx[y]);
    (MEMR[s.r]=MEMR[s.r]||{})[s.i]=here;
    (MEM[s.r]=MEM[s.r]||{})[s.i]=laneList(here); }
  CORUN=MEMR;                    // published for the badge logic further below
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
      // laneKey(r), not r: a bundled family shares ONE lane, so its members all
      // take the same offset and overdraw into a single visible line here. Where
      // they diverge this segment simply has no sibling and they separate again.
      if(arr && arr.length>1){ const so=(arr.indexOf(laneKey(r))-(arr.length-1)/2)*IR.gap;
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
  const drawnCovers1=(s,M)=>{ const o2=RPP[s], tr=TRIM[s]; if(!o2||!tr||!tr.draw)return false;
    const P=o2.P, dr=tr.draw; for(let j=dr.s0;j<dr.e && j<P.length-1;j++){ if(segDist(M,P[j],P[j+1])<=CD)return true; } return false; };
  // MEM now holds LANE keys, so ask "is ANY member of this lane drawn here?" —
  // a family whose lead has been trimmed away but whose sibling still runs must
  // keep its casing. Identity when internalCorridors is absent.
  const drawnCovers = CORR
    ? ((s,M)=>((CORR.fam[s]||[s]).some(m=>drawnCovers1(m,M))))
    : drawnCovers1;
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
      const bundle=(MEM[r]&&MEM[r][i])?MEM[r][i]:laneList(eRoutes[c]), nb=bundle.length;
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
    // coreBox: draw the runs OUTSIDE the box as subpaths of one path element, so
    // each end stops flush on the boundary. No box => one run, byte-identical.
    const runs=clipOutCore(tr.pts); if(!runs.length)continue;
    if(CORERUNS) CORERUNS[r]=[].concat(...runs.map(rn=>[rn[0],rn[rn.length-1]]));
    const d=runs.map(rn=>rn.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ')).join(' ');
    out(gk('route',r,`<path d="${d}" fill="none" stroke="${C[r]}" stroke-width="${IR.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`)); }
  // -- stop ticks ON the route lines (one per physical stop, first route wins;
  //    stops[ATCO].pos override moves the tick)
  const tickSeen=new Set();
  // internalDiagram: curated stops — only keepStops + stops near a drawn POI
  // (the hand-drawn convention: "only main stops or stops near places of
  // interest are shown"). ID absent => filter never engages (gate-safe).
  const IDKEEP = ID ? new Set(ID.keepStops||[]) : null;
  const IDPOI = ID ? pois.map(pp=>{ const o2=((OV.pois||{})[pp.cat+':'+pp.name]||{}); if(o2.hide)return null;
    const q=XY(pp.ll); if(o2.pos){q[0]=o2.pos.x;q[1]=o2.pos.y;} else if(o2.move){q[0]+=o2.move.dx;q[1]+=o2.move.dy;} return q; }).filter(Boolean) : null;
  const IDPD = (ID && ID.poiStopDist!=null) ? ID.poiStopDist : 8;
  for(const r of order){ const tr=TRIM[r]; if(!tr||!tr.sh)continue;
    for(const a in tr.st){ if(tickSeen.has(a))continue; const o=tr.st[a]; if(o.i>=tr.sh.length-1)continue;
      let p=baseOv[a] || [tr.sh[o.i][0]+(tr.sh[o.i+1][0]-tr.sh[o.i][0])*o.t, tr.sh[o.i][1]+(tr.sh[o.i+1][1]-tr.sh[o.i][1])*o.t];
      if(!inFrame(p))continue; if(inCore(p))continue; if(!keepStop(a))continue; tickSeen.add(a);
      if(IDKEEP && !IDKEEP.has(a) && !IDPOI.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<=IDPD)) continue;
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
    const lst=(segRoutes[key]=segRoutes[key]||[]);
    // internalCorridors: one lane per family (deduped). Without it, keep the
    // original unconditional push — a route that traverses the same stop pair
    // twice legitimately claims two ranks, and deduping would move its line.
    if(CORR){ const lk=laneKey(r); if(!lst.includes(lk)) lst.push(lk); }
    else lst.push(r); } } }
let idx=0;
for(const r of order){ if(!routes[r])continue;
  const ro=(OV.routeOffsets||{})[r]||{dx:0,dy:0};                 // lateral spread off a shared corridor
  const sq=rseq[r]; const seq=sq.map(a=>rpos(r,a));
  if(seq.length<2)continue;
  let poly;
  if(BUNDLE){                                                    // perpendicular fan-out of shared runs
    const v=[];                                                  // per-segment offset vector
    for(let i=0;i<sq.length-1;i++){ const a=sq[i],b=sq[i+1], key=a<b?a+'|'+b:b+'|'+a;
      const list=segRoutes[key]||[r], cnt=list.length, rank=list.indexOf(CORR?laneKey(r):r);
      const so=(rank-(cnt-1)/2)*BGAP;
      const dx=seq[i+1][0]-seq[i][0], dy=seq[i+1][1]-seq[i][1], L=Math.hypot(dx,dy)||1;
      v.push([-dy/L*so, dx/L*so]); }
    poly=seq.map((p,i)=>{ let sx,sy;
      if(i===0){[sx,sy]=v[0];} else if(i===seq.length-1){[sx,sy]=v[i-1];}
      else {sx=(v[i-1][0]+v[i][0])/2; sy=(v[i-1][1]+v[i][1])/2;}
      return [p[0]+sx+ro.dx, p[1]+sy+ro.dy]; });
  } else { const off=(idx-3)*0.6;
    poly=seq.map(p=>[p[0]+off+ro.dx, p[1]+off+ro.dy]); }
  // coreBox: keep only the runs outside the box (one run, unchanged, without it)
  const runs=clipOutCore(poly); if(!runs.length){ idx++; continue; }
  const d=runs.map(rn=>rn.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ')).join(' ');
  out(gk('route',r,`<path d="${d}" fill="none" stroke="${C[r]}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`)); idx++; }
// stop ticks (one per physical stop at its base position)
const seen=new Set();
for(const r in routes) for(const a of routes[r]){ if(seen.has(a)||!atco2ll[a]||!keepStop(a))continue; seen.add(a);
  const[x,y]=XYS(a); if(inCore([x,y]))continue;
  out(gk('stop',a,`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.85" fill="#fff" stroke="#555" stroke-width="0.45"/>`));}
// per-route divergence ticks: only where a route pulled a shared stop off the base (no-op without overrides)
for(const r in routeOv) for(const a of (routes[r]||[])){ if(!atco2ll[a]&&!baseOv[a])continue;
  const rp=routeOv[r][a]; if(!rp)continue; const bp=baseXY(a);
  if(Math.abs(rp[0]-bp[0])<0.01 && Math.abs(rp[1]-bp[1])<0.01)continue;
  out(gk('stop', r+':'+a, `<circle cx="${rp[0].toFixed(2)}" cy="${rp[1].toFixed(2)}" r="0.85" fill="#fff" stroke="#555" stroke-width="0.45"/>`));}
}
// ---- coreBox: the box itself, drawn last inside the clipped map group so it
//      covers the road skeleton, context roads and any linear feature crossing
//      the centre. The route lines were already cut at its boundary, so nothing
//      of a route is hidden underneath — each one visibly runs TO the box.
if(CORE){
  const w=CORE.x1-CORE.x0, h=CORE.y1-CORE.y0;
  const ts=CBOX.textSize||(CORE.sublabel?4.0:4.6);
  out(gk('corebox','core',
    `<rect x="${CORE.x0.toFixed(2)}" y="${CORE.y0.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(6,Math.min(w,h)/3).toFixed(2)}" fill="${CBOX.fill||'#ffffff'}" stroke="${CBOX.stroke||'#444444'}" stroke-width="0.9"/>`));
  const cx=(CORE.x0+CORE.x1)/2, cy=(CORE.y0+CORE.y1)/2;
  if(CORE.label) out(`<text x="${cx.toFixed(2)}" y="${(cy+(CORE.sublabel?-0.6:ts*0.36)).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${ts}" fill="#111" text-anchor="middle">${esc(CORE.label)}</text>`);
  if(CORE.sublabel) out(`<text x="${cx.toFixed(2)}" y="${(cy+ts*0.95).toFixed(2)}" font-family="Arial" font-size="${(ts*0.66).toFixed(2)}" fill="#555" text-anchor="middle">${esc(CORE.sublabel)}</text>`);
  reserve(CORE.x0-0.5,CORE.y0-0.5,CORE.x1+0.5,CORE.y1+0.5);
}
out(`</g>`);

// ---- reserve protected areas so labels avoid them ----
reserve(197,0,297,210);                 // right service panel
reserve(0,0,86,26);                     // title block
// ---- the north arrow's home -------------------------------------------------
// It is drawn at the very END of the file, so nothing used to know it was there:
// on High Wycombe it printed straight through route 130's terminus badge and
// across the railway (Peter, G2, 2026-08-15). It does not need a chosen spot,
// only a blank one (Peter, same day), so under v2 the engine finds one — see the
// search in the labels block below, which runs once the ink is known. `NORTH` is
// the resolved base point; `northBox()` is the footprint of the whole device.
const NORTH_ON = !!(IR && IR.northArrow!==false);
const NA = (IR && IR.northArrow && IR.northArrow!==true) ? IR.northArrow : {};
const NORTH_LEN = NA.len||8;
const NORTH_ANG = NA.angle!=null ? NA.angle*Math.PI/180
                : Math.atan2(-Math.cos(-theta), Math.sin(-theta));
function northBox(bx,by){                 // base, tip, arrowhead and the "N"
  const tx = bx+Math.cos(NORTH_ANG)*NORTH_LEN, ty = by+Math.sin(NORTH_ANG)*NORTH_LEN;
  return [Math.min(bx,tx)-3.4, Math.min(by,ty)-4.6, Math.max(bx,tx)+3.4, Math.max(by,ty)+4.6];
}
const NORTH = { x: NA.x!=null?NA.x:14, y: NA.y!=null?NA.y:150, auto:false };

/* ---- design.scaleBar: a scale bar, or an honest refusal to draw one ---------
 *
 * §4.6 of the design-quality plan asked for "a scale bar on the geographic
 * sheets and a 'diagram — not to scale' note on the diagram and schematic
 * variants". Measuring the projection before building it moved the line between
 * those two cases, so read this before changing anything here.
 *
 * THE GEOGRAPHIC SHEETS ARE NOT TO A SINGLE SCALE EITHER. Every town runs the
 * radial fisheye in `compress()`: true scale inside `focus.coreKm`, then
 * `focus.comp` beyond it. Measured across all eight towns on 2026-08-15, comp is
 * between 0.30 and 0.50 — so the page scale STEPS BY A FACTOR OF 2 TO 3.3 at the
 * core boundary, and two towns carry a detail lens on top of that. An
 * unqualified bar would be right in the middle of the sheet and wrong by 3x at
 * the edges, which is the difference between a fifteen-minute walk and a
 * forty-five-minute one. It would be worse than no bar at all.
 *
 * What saves the device is that the core is not a small disc: fitted to the
 * frame it is 34-71 mm in radius on a 190x162 mm map, so the true-scale zone
 * covers most of the PAGE even though most of the CONTENT lies outside it. So
 * the bar is drawn, sized from the core scale, and labelled `town centre scale`
 * whenever the town is actually fisheyed. A town with comp >= 1 and no lens gets
 * the bar with no qualifier, because then it really is one scale.
 *
 *   sc is page mm per unit of `planar()`, whose unit is one degree of latitude
 *   (isotropic — planar() scales longitude by cos(lat0)), i.e. 111.32 km.
 *
 * On a schematic or diagram sheet the pre-stage sets `notToScale`, and no bar is
 * drawn at any size: those coordinates are solved onto a tube-map grid and carry
 * no real-world distance at all. They get the words instead.
 *
 * Opt-in, absent => byte-identical. Needs labels.engine:"v2" for the blank-space
 * search, so the five place sheets (still on v1) ignore it until Phase 8.
 */
const SCALE_STEPS = [50,100,200,250,500,1000,2000,5000];   // metres
const FISHEYED = !!(IR && (CPF<1 || R1!==null || LENSES.length));
const NOT_TO_SCALE = !!RJ.notToScale;
// The bar: the largest round distance whose bar is at most 32 mm, and at least
// 14 mm so it is worth printing. Falls back to the shortest step.
const SCALE_M = NOT_TO_SCALE ? null : (function(){
  const mmPerM = sc/111320;
  const fit = SCALE_STEPS.filter(m=>m*mmPerM<=32 && m*mmPerM>=14);
  return fit.length ? fit[fit.length-1] : null;
})();
const SCALE_LEN  = SCALE_M ? SCALE_M*sc/111320 : 0;
const SCALE_TEXT = SCALE_M ? (SCALE_M>=1000 ? (SCALE_M/1000)+' km' : SCALE_M+' m') : '';
const SCALE_NOTE = NOT_TO_SCALE ? 'Diagram — not to scale' : (FISHEYED ? 'town centre scale' : '');
const SCALE_ON   = !!(DESIGN.scaleBar && (SCALE_M || NOT_TO_SCALE));
// Footprint: the distance above the bar, the bar, the qualifier below it. `bx,by`
// is the bar's LEFT END, so the box is asymmetric — which is what lets the search
// push the device right up against a frame corner.
const scaleW = ()=> Math.max(SCALE_LEN, SCALE_NOTE.length*1.25, SCALE_TEXT.length*1.5);
function scaleBox(bx,by){
  const w = scaleW();
  return [bx-1.5, by-(SCALE_M?5.2:3.6), bx+w+1.5, by+(SCALE_NOTE?4.4:1.6)];
}
function drawScaleDevice(spotSearch){
  if(!SCALE_ON) return;
  const got = spotSearch(scaleBox, (IR&&IR.scaleBar&&IR.scaleBar.x)!=null?IR.scaleBar.x:null,
                                   (IR&&IR.scaleBar&&IR.scaleBar.y)!=null?IR.scaleBar.y:null, 0.02);
  if(got.x===null){
    process.stderr.write('scaleBar: no clear spot found on this sheet — not drawn. '
      +'Set design.scaleBar:false on this town, or make room.\n');
    return;
  }
  const bx=got.x, by=got.y;
  if(SCALE_M){
    // A plain bar with end serifs, in the footer's own grey so it reads as
    // apparatus rather than as map content.
    out(`<path d="M${bx.toFixed(2)} ${by.toFixed(2)}h${SCALE_LEN.toFixed(2)}" stroke="#666" stroke-width="0.5" fill="none"/>`);
    for(const t of [0,SCALE_LEN]) out(`<path d="M${(bx+t).toFixed(2)} ${(by-1.6).toFixed(2)}v3.2" stroke="#666" stroke-width="0.5"/>`);
    out(`<text x="${(bx+SCALE_LEN/2).toFixed(2)}" y="${(by-2.6).toFixed(2)}" font-family="Arial" font-size="2.8" fill="#666" text-anchor="middle">${esc(SCALE_TEXT)}</text>`);
  }
  // "Diagram — not to scale" is a statement about the whole sheet, so it takes the
  // same grey as the towns' own map notes, which it usually sits beside. "town
  // centre scale" is an annotation ON the bar and stays lighter than it.
  if(SCALE_NOTE) out(`<text x="${(bx+(SCALE_M?SCALE_LEN/2:0)).toFixed(2)}" y="${(by+(SCALE_M?4.0:0)).toFixed(2)}" font-family="Arial" font-style="italic" font-size="2.4" fill="${SCALE_M?'#999':'#555'}"${SCALE_M?' text-anchor="middle"':''}>${esc(SCALE_NOTE)}</text>`);
  reserve(...scaleBox(bx,by));
}
// The footer's backing plate is drawn LAST and covers whatever is beneath it, but no
// placer knew it was there: 9 of the 31 sheets measured on 2026-08-15 had a label
// printed and then erased by it. Shortening the frame (above) keeps the map out of the
// band; this keeps the placers — which work in page mm, outside the clip — out too.
if(DESIGN.footerSafe) reserve(0,FOOTER_PLATE_TOP,297,210);
for(const f of FEATURES){ const ov=featOv(f);           // linear-feature label areas
  if(ov.hide || (ov.label&&ov.label.hide)) continue;
  if(f.labelReserve){ reserve(...f.labelReserve); continue; }
  // A feature label is hand-placed (labelPos) and drawn at the very END of the
  // file, so without labelReserve nothing knows it is there and a map label lands
  // underneath it — High Wycombe printed "to Widmer End & Great Missenden" straight
  // through "Chiltern Main Line". labelReserve is per-town config nobody remembers
  // to write; with real font metrics the box can just be measured. v2 only, so no
  // existing sheet moves without asking.
  if(V2 && f.labelPos && (f.label || (ov.label&&ov.label.text))){
    const lov=ov.label||{}; const txt=lov.text!=null?lov.text:f.label;
    const sz=f.labelSize||4;
    let lx=f.labelPos.x+((ov.move&&ov.move.dx)||0), ly=f.labelPos.y+((ov.move&&ov.move.dy)||0);
    if(lov.pos){ lx=lov.pos.x; ly=lov.pos.y; } else if(lov.offset){ lx+=lov.offset.dx; ly+=lov.offset.dy; }
    const w=FONT.textWidth(txt,sz,false), anc=lov.anchor||'start';
    const x0 = anc==='start'?lx : anc==='end'?lx-w : lx-w/2;
    reserve(x0-0.5, ly-sz*FONT.CAP_HEIGHT-0.5, x0+w+0.5, ly+sz*FONT.DESCENDER+0.5);
  }
}
// design.reserveIcons: POI symbols are drawn LAST (`pois.forEach(poiMark)`, below the
// road names and the terminus badges) but were never reserving a box, so a symbol
// routinely landed on a label placed earlier in the file and painted over it — St Ives
// printed "Waitrose" as "Wa▮▮se" under the library icon for months, and the 2026-08-15
// baseline counted 190 labels sitting on a foreign symbol across the 31 shipped sheets.
// Claiming the boxes here, before the first label is placed, is what stops it. Absent
// the key nothing is reserved and every placer behaves exactly as it did.
if(DESIGN.spreadIcons) spreadIcons();
if(DESIGN.reserveIcons) reserveIcons();
// Central interchange / bus-station label (the ANCHOR) drawn + reserved first
// (suppressed when internalDiagram draws a lozenge for the anchor instead)
// (also suppressed by coreBox — the box IS the interchange, and its own label
//  says so; drawing both puts two names on the same square centimetre)
if((atco2ll[ANCHOR]||baseOv[ANCHOR]) && !CORE && !(ID && (ID.interchanges||[]).some(ic=>ic.atco===ANCHOR))){const[x,y]=XYS(ANCHOR);
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
  const termBadge=(p,r,grp)=>{
    if(inCore(p)) return;                                      // coreBox owns the centre
    // and never on an end whose run was dropped as a stub (see clipOutCore)
    if(CORERUNS && !(CORERUNS[r]||[]).some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<0.05)) return;
    const anc=(atco2ll[ANCHOR]||baseOv[ANCHOR])?XYS(ANCHOR):null;
    if(anc && Math.hypot(p[0]-anc[0],p[1]-anc[1])<8) return;   // not at the interchange knot
    const hh=badgeStack(p[0],p[1],grp||[r],2.6);
    reserve(p[0]-2.8,p[1]-hh-0.2,p[0]+2.8,p[1]+hh+0.2);
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
    const eDef=lt.end!==undefined, sDef=lt.start!==undefined;
    let endLab, startLab;
    if(tr.endCut && tr.startCut){                 // both tails cut the frame: honour each side literally
      endLab   = eDef ? lt.end   : null;
      startLab = sDef ? lt.start : null;
    } else {
      // Single tail (the usual case). A town configures a destination as end:"X"
      // or start:"X", but which chain-end becomes the frame-cut depends on the
      // map-matcher's canonical direction — unpredictable to the config author.
      // If the one configured single-ended label sits on the OTHER end from the
      // actual cut, route it to whichever cut exists so the "to X" still draws
      // (Peter's item 2, 2026-07-20: 66/C2/193 reached the edge but their label
      // was pinned to the missing opposite cut). Explicit false still suppresses.
      const only = (eDef && lt.end!==false)   ? lt.end
                 : (sDef && lt.start!==false) ? lt.start
                 : (TL[r]||null);
      endLab   = tr.endCut   ? (lt.end===false   ? null : only) : null;
      startLab = tr.startCut ? (lt.start===false ? null : only) : null;
    }
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
    // The cut point sits ON the frame, so a badge centred near it straddles the edge and
    // renders half-clipped ("905" printed as "05" at the right edge in St Neots v1.1).
    // Keep the whole 3.0 mm badge inside the drawing frame.
    const groups=[], gi2={};                   // same "to X" text -> one shared row
    for(const m of ms){ const k=m.label||''; if(!(k in gi2)){ gi2[k]=groups.length; groups.push({label:m.label,ms:[]}); } groups[gi2[k]].ms.push(m); }
    // A row is centred on bx and spreads (n-1)/2*BS each way, so clamping the
    // CENTRE to the frame is not enough once a bundled family puts 3+ badges in
    // one row: High Wycombe's six-badge "to Loudwater & Beaconsfield" row ran
    // 13 mm off the right edge and printed over the Services panel. Widen the
    // clamp by the row's own half-width. A solo badge keeps the original 3.4 mm
    // margin exactly; a multi-badge row is pulled fully inside the frame (St Ives'
    // 2-badge "to Cambridge" row moves 2.1 mm — re-rendered at v6.8).
    const rowHalf=Math.max(3.4, ((Math.max(...groups.map(g=>g.ms.length))-1)/2)*BS+3.4);
    // And the SAME argument vertically, which was missed: a cluster with several
    // distinct "to X" texts draws one row per group at by ± (n-1)/2 * RH, so
    // clamping the centre alone lets the outermost row escape the frame. It had
    // happened — Huntingdon's 4-group cluster put route 9's badge at y=197.7 on a
    // frame ending at 192.2, i.e. 5.5 mm INSIDE the footer plate, where it was
    // painted and then covered. Nothing complained: badges are drawn outside the
    // map's clip group, the byte gate is deterministic, and the footer-text metric
    // skipped badge digits (dominant-baseline="central"). Clamp by the column's
    // own half-height too.
    const colHalf=Math.max(3.4, ((groups.length-1)/2)*RH+3.4);
    bx=Math.min(Math.max(bx,MX0+rowHalf),MX1-rowHalf); by=Math.min(Math.max(by,MY0+colHalf),MY1-colHalf);
    aplaced.push([bx,by]);
    let bxMin=Infinity,bxMax=-Infinity,byMin=Infinity,byMax=-Infinity;
    const pendingTermini=[];
    groups.forEach((g,gidx)=>{
      const ry=by+(gidx-(groups.length-1)/2)*RH;
      let lastX=bx;
      g.ms.forEach((m,i)=>{ const bxi=bx+(i-(g.ms.length-1)/2)*BS; badge(bxi,ry,m.r,3.0); lastX=bxi;
        bxMin=Math.min(bxMin,bxi); bxMax=Math.max(bxMax,bxi); byMin=Math.min(byMin,ry); byMax=Math.max(byMax,ry); });
      if(!g.label) return;
      // A "to X" shared by 2+ differently-coloured routes (e.g. 18 + 905 both to
      // Cambridge) is drawn in BLACK so it clearly applies to every route in the
      // cluster, not just one (Peter's ask 2026-07-20). A solo route keeps its
      // own colour.
      const col=g.ms.length===1?(C[g.ms[0].r]||'#333'):'#111';
      // SOLO rows used to go through placeLabel anchored ON the badge centre, which
      // printed the text straight over its own badge ("65to Buckden", "905to Bedford",
      // and at the frame edge a clipped "05to Cambridge") because the badge was not
      // reserved until after the label was placed. St Neots, with five solo terminus
      // badges, made it obvious. Solo and multi rows now share the same path: reserve
      // the row's badges first, then pick a row-level spot beside/above/below them.
      {
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
        if(LAB){
          // v2: a destination label is the single most useful string on the sheet —
          // it is the answer to "where does this bus go?" — so it is queued at the
          // top priority and gets first pick of the space around its badge row.
          // Queued, not added: the cluster reserves a box around ALL its rows after
          // this loop, and a label whose `own` exemption is smaller than that box
          // finds every candidate blocked by its own badges. St Ives' "to Boxworth"
          // was dropped for exactly that reason on the first v2 run.
          pendingTermini.push({ id:'term:'+gidx+':'+g.ms.map(m=>m.r).join('-')+'@'+bx.toFixed(1)+','+ry.toFixed(1),
            at:[(rx0+rx1)/2, ry], text, size:sz, fill:col, priority:20, wrap:false, mustPlace:true });
          return;
        }
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
      }
    });
    reserve(bxMin-3.5,byMin-3.5,bxMax+3.5,byMax+3.5);                    // reserve, or it can't place
    if(LAB) for(const t of pendingTermini)
      LAB.add(Object.assign({own:[bxMin-3.6,byMin-3.6,bxMax+3.6,byMax+3.6]}, t));
  }
  for(const r of order){ const tr=TRIM[r]; if(!tr)continue;
    const closed = tr.pts.length>2 && Math.hypot(tr.pts[0][0]-tr.pts[tr.pts.length-1][0], tr.pts[0][1]-tr.pts[tr.pts.length-1][1])<2;
    if(!closed){
      if(!tr.endCut   && tr.pts.length>=2 && inFrame(tr.pts[tr.pts.length-1])){
        const g=badgeGroup(r,segIdxOf(tr,tr.pts.length-2));
        if(g) termBadge(tr.pts[tr.pts.length-1],r,g); }
      if(!tr.startCut && tr.pts.length>=2 && inFrame(tr.pts[0])){
        const g=badgeGroup(r,segIdxOf(tr,0));
        if(g) termBadge(tr.pts[0],r,g); }
    }
  }
  // small route badges sprinkled along each visible line
  const bplaced=aplaced.slice();
  const badged=new Set();          // routes that got at least one badge anywhere
  const soloEligible=new Set();    // routes seen drawing ALONE (own colour, own line)
  for(const r of order){ const tr=TRIM[r]; if(!tr||tr.pts.length<2)continue;
    let acc=0, next=(IR.badgeEvery)*0.55;
    for(let i=0;i<tr.pts.length-1;i++){
      const L=Math.hypot(tr.pts[i+1][0]-tr.pts[i][0], tr.pts[i+1][1]-tr.pts[i][1]);
      while(acc+L>=next){
        const t=(next-acc)/L;
        const p=[tr.pts[i][0]+(tr.pts[i+1][0]-tr.pts[i][0])*t, tr.pts[i][1]+(tr.pts[i+1][1]-tr.pts[i][1])*t];
        next+=IR.badgeEvery;
        if(!inFrame(p))continue;
        if(inCore(p))continue;                       // coreBox: nothing inside the box
        // On a bundled corridor only the group leader badges, and it badges the
        // WHOLE stack; a sibling that has left the bundle badges its own branch.
        const grp=badgeGroup(r,segIdxOf(tr,i));
        if(!grp)continue;
        if(grp.length===1) soloEligible.add(r);
        if(bplaced.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<9))continue;
        const gh=grp.length===1?2.3:(grp.length-1)/2*5.3+2.3;
        if(overlaps([p[0]-2.3,p[1]-gh,p[0]+2.3,p[1]+gh]))continue;
        bplaced.push(p); const hh=badgeStack(p[0],p[1],grp,2.4);
        for(const g of grp) badged.add(g);
        reserve(p[0]-2.5,p[1]-hh-0.1,p[0]+2.5,p[1]+hh+0.1);
      }
      acc+=L;
    }
  }
  // ---- GUARANTEED badge for a line whose colour no longer identifies it ------
  // Rung 3 (corridorPalette) deliberately gives several drawn lines one colour,
  // and a rung-1 family that diverges does the same on its branches. The normal
  // pass drops a badge rather than overlap something — fine when colour still
  // says which route this is, fatal when it doesn't. So for those lines only,
  // place one badge regardless of collision: an unidentifiable line is a worse
  // defect than a crowded one. Gated on the keys, so no existing town changes.
  if(CPAL || CORR){
    for(const r of order){
      if(badged.has(r)) continue;
      const shared = colourShared(r) || (CORR && CORR.lead[r] && soloEligible.has(r));
      if(!shared) continue;
      const tr=TRIM[r]; if(!tr||tr.pts.length<2) continue;
      // walk to the mid-point of the drawn line, then outwards, for the first
      // spot that is on the page and outside the core box
      const segs=[]; let tot=0;
      for(let i=0;i<tr.pts.length-1;i++){
        const L=Math.hypot(tr.pts[i+1][0]-tr.pts[i][0], tr.pts[i+1][1]-tr.pts[i][1]);
        if(L){ segs.push({i,L,at:tot+L/2}); tot+=L; } }
      if(!segs.length) continue;
      segs.sort((a,b)=>Math.abs(a.at-tot/2)-Math.abs(b.at-tot/2));
      for(const s of segs){
        const p=[(tr.pts[s.i][0]+tr.pts[s.i+1][0])/2, (tr.pts[s.i][1]+tr.pts[s.i+1][1])/2];
        if(!inFrame(p)||inCore(p)) continue;
        const grp=badgeGroup(r,segIdxOf(tr,s.i)) || [r];
        const hh=badgeStack(p[0],p[1],grp,2.4);
        for(const g of grp) badged.add(g);
        bplaced.push(p); reserve(p[0]-2.5,p[1]-hh-0.1,p[0]+2.5,p[1]+hh+0.1);
        break;
      }
    }
  }
}

// ---- internalCorridors: divergence report (no SVG output; CORR-gated) -------
// Bundling asserts that a family runs together. The geometry keeps that honest
// by itself — members separate where they diverge, because nothing merged their
// coordinates — but a family whose members only share half their length is a bad
// bundle even so: most of the sheet is then two SAME-COLOURED lines going
// different ways, which is worse than two colours. Measure it and say so.
//
// The measure is the SAME one complexity_score.js uses to PROPOSE a family:
// mutual overlap of ~111 m cells on the raw matched lat/lon paths, warn below
// 0.6 (its --overlap default). The tool that suggests a bundle and the tool that
// draws it must not disagree about what "co-running" means.
//
// Two measures were tried first and are wrong; recording them so they are not
// re-invented. (a) The lane-bundling test (CORUN / corridor.dist 2.4 mm ≈ 65 m
// at map scale) is right for "should these share a casing" but far too generous
// here — in a dense core it makes almost every route a neighbour of every other.
// (b) Page-space coincidence of the DRAWN lines is circular: bundling is exactly
// what removes the lane offset between members, so measuring after it inflates
// every family towards 1.0 (two unrelated High Wycombe routes read 0.70).
if((CORR || CPAL) && RP && RP.routes){
  const CELL=0.001;                                   // ~111 m of latitude
  let laMin=90, laMax=-90;
  for(const k of Object.keys(RP.routes)) for(const p of (RP.routes[k].pts||[])){
    if(p[0]<laMin)laMin=p[0]; if(p[0]>laMax)laMax=p[0]; }
  const cellLo = CELL/Math.cos((laMin+laMax)/2*Math.PI/180);
  const cellsOf = r => { const e=RP.routes[r]; if(!e||!e.pts||e.pts.length<2) return null;
    const s=new Set(); for(const p of e.pts) s.add(Math.floor(p[0]/CELL)+','+Math.floor(p[1]/cellLo));
    return s; };
  const rep={ town:RJ.town, measure:'mutual 111m-cell overlap of the matched paths (as complexity_score.js --overlap)',
    sharedMin:0.6, families:[] };
  for(const lead of Object.keys(CORR ? CORR.fam : {})){
    const fam=CORR.fam[lead], cells={}, members=[];
    for(const m of fam) cells[m]=cellsOf(m);
    for(const m of fam){ const A=cells[m];
      if(!A){ members.push({route:m, drawn:false}); continue; }
      // worst pairwise overlap against the family: a member has to co-run with
      // EVERY sibling, not just the one it happens to share a street with
      let worst=1, worstWith=null;
      for(const o of fam){ if(o===m||!cells[o])continue;
        let inter=0; for(const c of A) if(cells[o].has(c)) inter++;
        const f=inter/A.size; if(f<worst){ worst=f; worstWith=o; } }
      members.push({ route:m, drawn:true, cells:A.size,
        sharedFraction:+worst.toFixed(3), weakestAgainst:worstWith });
    }
    const weak=members.filter(x=>x.drawn && x.sharedFraction<rep.sharedMin).map(x=>x.route);
    rep.families.push({ lead, routes:fam, members, weakMembers:weak });
    console.log('  corridor '+fam.join('/')+'  '+members.map(x=>x.route+' '
      +(x.drawn?Math.round(x.sharedFraction*100)+'%':'not drawn')).join('  '));
    if(weak.length) console.error('CORRIDOR WARNING '+fam.join('/')+': '+weak.join(', ')
      +' co-run with the family over <'+Math.round(rep.sharedMin*100)+'% of their route — the rest '
      +'is now a second same-coloured line going somewhere else, which is worse than two colours. '
      +'Reconsider this bundle.');
  }
  // ---- rung 3: what the colour scheme now says ------------------------------
  // With corridorPalette the palette no longer identifies a route, so the honest
  // number to report is DISTINCT COLOURS, not lines — that is the ~12 ceiling
  // the whole ladder exists to respect. complexity_score.js counts the same way.
  const drawnRoutes=order.filter(r=>TRIM && TRIM[r] && TRIM[r].pts && TRIM[r].pts.length>=2);
  const distinct=new Set(drawnRoutes.map(r=>C[r])).size;
  rep.colours={ drawnLines:drawnRoutes.length, distinctColours:distinct,
    ambiguity:+(distinct?drawnRoutes.length/distinct:0).toFixed(2),
    corridorPalette:!!CPAL };
  if(CPAL){
    rep.colourGroups=Object.keys(CPAL.fam).map(l=>({lead:l, routes:CPAL.fam[l]}));
    // The check that matters most for rung 3. corridorPalette does not, on its
    // own, reduce how many colours a town uses — it makes the SHARING MEANINGFUL.
    // High Wycombe v1.0's real disease was 12 hues spread arbitrarily over 31
    // routes: colour repeated, but repeated at random. So flag any hue used by
    // two DIFFERENT corridor groups — an accidental clash, which reads to a
    // reader exactly like a corridor and is not one.
    const grpOf=r=>(CPAL.lead[r]) || (CORR&&CORR.lead[r]) || r;
    const byColour={};
    for(const r of drawnRoutes){ (byColour[C[r]]=byColour[C[r]]||new Set()).add(grpOf(r)); }
    const clashes=Object.keys(byColour).filter(c=>byColour[c].size>1)
      .map(c=>({colour:c, groups:[...byColour[c]]}));
    rep.colourClashes=clashes;
    for(const cl of clashes) console.error('CORRIDOR WARNING colour '+cl.colour+' is shared by '
      +'unrelated groups ('+cl.groups.join(', ')+') — a reader will read them as one corridor. '
      +'Give each corridor its own hue, or group them in corridorPalette.');
  }
  fs.writeFileSync(DIR+'/corridors_report.json', JSON.stringify(rep,null,2));
  console.log('corridors: '+rep.families.length+' bundled famil'+(rep.families.length===1?'y':'ies')
    +(CPAL?', '+Object.keys(CPAL.fam).length+' colour group(s)':'')
    +' — '+drawnRoutes.length+' lines in '+distinct+' colours; corridors_report.json written');
  if(distinct>12) console.error('CORRIDOR WARNING '+distinct+' distinct colours still exceeds the ~12 '
    +'usable colour-blind-safe hues — colour cannot identify a line. Group more corridors '
    +'(corridorPalette) or curate more services.');
}

// ---- internalDiagram: one-way loop arrows + interchange lozenges (ID-gated) --
if(ID && IR && TRIM){
  // direction-of-travel arrowheads along a one-way loop route (e.g. a town
  // circular): the diagram abstracts geography away, so travel direction must
  // be shown explicitly — the hand-drawn leaflet does exactly this.
  const AEV = ID.loopArrowEvery!=null ? ID.loopArrowEvery : 34;
  for(const r of (ID.loopArrows||[])){ const tr=TRIM[r]; if(!tr||tr.pts.length<2)continue;
    let acc=0, next=AEV*0.5;
    for(let i=0;i<tr.pts.length-1;i++){
      const a2=tr.pts[i], b2=tr.pts[i+1];
      const L=Math.hypot(b2[0]-a2[0],b2[1]-a2[1]); if(!L){continue;}
      while(acc+L>=next){
        const t=(next-acc)/L; next+=AEV;
        const p=[a2[0]+(b2[0]-a2[0])*t, a2[1]+(b2[1]-a2[1])*t];
        if(!inFrame(p)) continue;
        const ux=(b2[0]-a2[0])/L, uy=(b2[1]-a2[1])/L, px2=-uy, py2=ux, ah=2.0, aw=1.35;
        out(`<path d="M${(p[0]+ux*ah).toFixed(2)} ${(p[1]+uy*ah).toFixed(2)}L${(p[0]-ux*ah*0.45+px2*aw).toFixed(2)} ${(p[1]-uy*ah*0.45+py2*aw).toFixed(2)}L${(p[0]-ux*ah*0.45-px2*aw).toFixed(2)} ${(p[1]-uy*ah*0.45-py2*aw).toFixed(2)}Z" fill="${C[r]||'#333'}" stroke="#fff" stroke-width="0.35"/>`);
      }
      acc+=L;
    }
  }
  // interchange lozenges — tube-style station boxes (Bus Station, Park & Ride)
  for(const ic of (ID.interchanges||[])){
    const a2=ic.atco; if(!(atco2ll[a2]||baseOv[a2]))continue;
    const [x,y]=XYS(a2); if(inCore([x,y]))continue;      // coreBox replaces it
    const label=ic.label||atco2name[a2]||'';
    const sz=ic.size||3.0, w=(ic.w!=null?ic.w:label.length*sz*0.58+5), h=ic.h!=null?ic.h:5.4;
    const fill=ic.fill||'#1e7a46';
    out(`<rect x="${(x-w/2).toFixed(2)}" y="${(y-h/2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${(h/2).toFixed(2)}" fill="${fill}" stroke="#fff" stroke-width="0.7"/>`);
    out(`<text x="${x.toFixed(2)}" y="${(y+sz*0.36).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="${sz}" fill="#fff" text-anchor="middle">${esc(label)}</text>`);
    reserve(x-w/2-0.5,y-h/2-0.5,x+w/2+0.5,y+h/2+0.5);
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
    // Two sweeps when design.reserveIcons is on: honour the symbols first, and only if
    // every candidate is blocked, repeat ignoring them — the same "gain, never lose"
    // fallback placeLabel() uses, so no road name that printed before disappears now.
    for(const pass of (iconBoxes.size?[0,1]:[0])){
    if(ok) break;
    const blocked = pass ? overlapsNoIcons : (b=>overlaps(b));
    for(const [cx,cy] of cands){
      if(!inFrame([cx,cy]))continue; if(inCore([cx,cy]))continue; anyInFrame=true;
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
      if(blocked(b))continue; reserve(...b);
      out(`<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-family="Arial" font-size="2.5" fill="#666" text-anchor="middle" transform="rotate(${ang.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})" stroke="#fff" stroke-width="0.8" paint-order="stroke">${esc(label)}</text>`);
      ok=true; break;
    }
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
  const charW=sz*0.52;
  // Word-wrap long notes to the space actually available in the note's own direction
  // (to the page edge on the open side of its anchor), instead of drawing one long line
  // that runs off the page or gets clipped by the footer band. Short notes that already
  // fit on one line are unaffected (lines.length===1, same output as before).
  const avail = anc==='start' ? (294-6-x) : anc==='end' ? (x-6) : Math.min(x-6,294-6-x)*2;
  const maxChars = Math.max(20, Math.floor(avail/charW));
  const words=String(n.text).split(' '); const lines=[]; let cur='';
  for(const wd of words){ if((cur+' '+wd).trim().length>maxChars){ lines.push(cur.trim()); cur=wd; } else cur+=' '+wd; }
  if(cur.trim()) lines.push(cur.trim());
  const lineGap=n.lineGap||sz*1.35;
  // Catch the mistake that bit Beaconsfield Simpson Centre + Waitrose (2026-08-11): a
  // mapNotes entry authored with a y so low it sits under the footer's backing plate,
  // which is drawn on top later and visually swallows it. The engine can't know where
  // it's SAFE to put a note (that depends on the town's route geometry), so it doesn't
  // try to auto-relocate — it just warns loudly, the same way the panelCols row-pitch
  // check does below, so the next occurrence is a build-time warning instead of a
  // silent visual bug someone has to spot in a rendered JPG.
  const lastLineY = y + (lines.length-1)*lineGap;
  if (lastLineY > FOOTER_PLATE_TOP - 2) {
    process.stderr.write(`mapNotes: "${String(n.text).slice(0,40)}${n.text.length>40?'…':''}" ends at y=${lastLineY.toFixed(1)}, inside/near the footer plate (top ${FOOTER_PLATE_TOP.toFixed(1)}) — it will be hidden or look clipped. Move its y up (see Beaconsfield Simpson Centre/Waitrose routes.json for the fix).\n`);
  }
  lines.forEach((ln,i)=>{
    const ly=y+i*lineGap;
    const w=ln.length*charW;
    const bx = anc==='start'?x : anc==='end'?x-w : x-w/2;
    reserve(bx-0.4,ly-sz,bx+w+0.4,ly+1);
    out(`<text x="${x.toFixed(2)}" y="${ly.toFixed(2)}" font-family="Arial" font-size="${sz}" font-style="italic" fill="${n.color||'#333'}" text-anchor="${anc}" stroke="#fff" stroke-width="0.7" paint-order="stroke">${esc(ln)}</text>`);
  });
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

// ---- labels.engine:"v2": solve and draw every queued point label at once ------
// This is the two-phase draw. Everything above has finished claiming space —
// route ribbons, casings, the river and railway, POI symbols, route badges, stop
// ticks, road names, map notes, the core box, the panel and the footer plate — so
// the placer is working against the finished drawing rather than against a partial
// list of text boxes. The ink comes off the SVG this file has already built, which
// cannot drift from what is drawn the way a parallel bookkeeping list would.
if(LAB){
  const palette=new Set(Object.values(C||{}).map(v=>String(v).toLowerCase()));
  const lum=h=>{ const m=/^#([0-9a-f]{6})$/i.exec(h); if(!m) return 1;
    const n=parseInt(m[1],16); return (0.2126*((n>>16)&255)+0.7152*((n>>8)&255)+0.0722*(n&255))/255; };
  LAB.stampSvg(s, (stroke,w)=> palette.has(stroke) || (w>=1.2 && lum(stroke)<0.62));

  /*
   * Find the north arrow a blank corner.
   *
   * This has to happen HERE, between stamping the ink and solving the labels: any
   * earlier and there is no ink to avoid, any later and the labels have already
   * taken the blank space. So the arrow gets first pick of whatever is empty, and
   * the labels then work around it — which is the right order, because the arrow
   * can go anywhere and a label cannot.
   *
   * "Anywhere" is not quite true: a compass belongs at the edge of a sheet, not
   * floating in the middle of it, so among the positions that are completely
   * clear of ink and of every reserved box the one nearest a frame corner wins.
   * A configured {x,y} is honoured when it is clear — a town that has hand-placed
   * its arrow keeps it — and overruled, with a note, when it is not.
   */
  // A SECOND, broader occupancy just for these searches. LAB.ink is deliberately
  // narrow — route ribbons and dark features, the things a label must not sit
  // on — and by that measure the River Great Ouse is empty space, which is how
  // the first cut of this parked St Neots' compass in the middle of the river.
  // For a page device, anything drawn counts except the two pale road tiers,
  // which cover the whole sheet and would leave nowhere at all. Built lazily and
  // shared, because stamping the whole SVG a second time is not free.
  let NAV = null;
  const nav = ()=>{
    if(NAV) return NAV;
    const paleRoads = new Set([ (IR&&IR.skeleton)||'#e4e4e4', (IR&&IR.contextColor)||'#f0f0f0' ]
      .map(v=>String(v).toLowerCase()));
    NAV = new Labeller({ page:[297,210] });
    NAV.stampSvg(s, (stroke,w)=> w>=1.2 && stroke!=='none' && !paleRoads.has(stroke)
      && stroke!=='#fff' && stroke!=='#ffffff');
    return NAV;
  };
  /*
   * The blank-space search, shared by every free-floating page device.
   *
   * `boxOf(x,y)` is the device's whole footprint at that anchor. Returns the
   * clear position nearest a frame corner, or null if the sheet has none. A
   * preferred {x,y} is honoured when it is clear enough (`tol`), so a town that
   * has hand-placed a device keeps it, and is overruled otherwise.
   *
   * Written for the compass; the scale bar is the second caller, which is why it
   * is a function rather than the inline loop it started as.
   */
  const spotSearch = (boxOf, wantX, wantY, tol)=>{
    const clearAt = (bx,by)=>{ const b=boxOf(bx,by);
      if(b[0]<MX0+1||b[2]>MX1-1||b[1]<MY0+1||b[3]>MY1-1) return null;
      if(LAB.hard.any(b)) return null;
      return nav().ink.cover(b); };
    const want = (wantX!=null) ? clearAt(wantX, wantY) : null;
    if(wantX!=null && want!==null && want<=tol) return { x:wantX, y:wantY, auto:false, want };
    const cnr=[[MX0,MY0],[MX1,MY0],[MX0,MY1],[MX1,MY1]];
    let best=null;
    for(let by=MY0+2; by<=MY1-2; by+=1) for(let bx=MX0+2; bx<=MX1-2; bx+=1){
      const cov = clearAt(bx,by);
      if(cov===null || cov>0) continue;
      const d = Math.min(...cnr.map(c=>Math.hypot(bx-c[0],by-c[1])));
      if(!best || d<best.d-1e-9) best={bx,by,d};
    }
    return best ? { x:best.bx, y:best.by, auto:true, want } : { x:null, y:null, auto:false, want };
  };
  if(NORTH_ON){
    const got = spotSearch(northBox, NORTH.x, NORTH.y, 0.02);
    if(got.auto){
      process.stderr.write('northArrow: '+(got.want===null?'the configured spot is blocked':
        'the configured spot is '+(got.want*100).toFixed(0)+'% covered by ink')
        +' — placed automatically at '+got.x+','+got.y+' (nearest clear corner).\n');
      NORTH.x=got.x; NORTH.y=got.y; NORTH.auto=true;
    } else if(got.x===null){
      process.stderr.write('northArrow: no clear spot found on this sheet; left at the configured '
        +NORTH.x+','+NORTH.y+'. Set internalRoads.northArrow:false, or make room.\n');
    }
    reserve(...northBox(NORTH.x, NORTH.y));
  }
  if(DESIGN.scaleBar) drawScaleDevice(spotSearch);
  if(process.env.DBG_LABELS) for(const r of LAB.solve()){
    console.error('  '+(r.placed?'placed':'UNPLACED').padEnd(9)
      +(r.placed?(r.pos||'fixed').padEnd(6)+(r.leader?'leader ':'       '):'      ')
      +'at '+(r.it.at?r.it.at.map(v=>v.toFixed(1)).join(','):'-').padEnd(14)
      +(r.placed?'-> '+r.x.toFixed(1)+','+r.y.toFixed(1)+'  ':'')+r.it.text);
  }
  out(LAB.svg());
  // A label the placer could not fit leaves NO trace in the SVG, which is why the
  // Phase 0 baseline could not measure silent drops at all. Write them down.
  const un=LAB.unplaced();
  if(un.length){
    try{ fs.writeFileSync(DIR+'/unplaced.json', JSON.stringify(un,null,2)); }catch(e){}
    process.stderr.write('labels: '+un.length+' could not be placed -> unplaced.json ('
      + un.slice(0,6).map(u=>'"'+u.text+'"').join(', ') + (un.length>6?', ...':'') + ')\n');
  } else { try{ fs.unlinkSync(DIR+'/unplaced.json'); }catch(e){} }
}

// title
// Title colour defaults to the orientation route's colour, as it always has.
// `internalTitleColor` overrides it — needed once a town colours by CORRIDOR
// (rung 3), because the orientation route then wears a shared corridor hue that
// has nothing to do with the sheet's identity (High Wycombe's title turned red
// when 32A joined the Booker–Micklefield corridor). Absent => byte-identical.
out(`<text x="6" y="16" font-family="Arial" font-weight="bold" font-size="11" fill="${RJ.internalTitleColor||C[ORI]}">Buses within ${esc(RJ.town)}</text>`);
out(`<text x="6" y="23" font-family="Arial" font-size="5" fill="#444">(from ${esc(RJ.validFrom||'June 2026')})</text>`);
for(const f of FEATURES) drawFeatureLabel(f);

// ---------- right service panel ----------
const PX=(OV.panel&&OV.panel.x!=null)?OV.panel.x:200; let py=(OV.panel&&OV.panel.y!=null)?OV.panel.y:14;
const PROW=RJ.panelRow||8, KROW=RJ.keyRow||4.4, PBR=RJ.panelBadge||4;
// panelCols (optional) — multi-column Services panel. Absent => single column.
const PCOLS=(RJ.panelCols&&(RJ.panelCols.cols|0)>1)?RJ.panelCols:null;

/* design.panelScale — one type scale and one heading rhythm for the panel.
 *
 * Before this key the panel drew text at eleven unrelated sizes (5 / 4.4 / 4 /
 * 3.5 / 3.2 / 3 / 2.9 / 2.8 / 2.5 / 2.3 / 1.95) and gave its two section
 * headings, which are peers, different sizes AND different amounts of air:
 * measured on Beaconsfield, `Services` had 5.9 mm of clear space beneath it and
 * `Key` had 3.2 mm, while `Key` had barely more air above it (3.6 mm) than
 * below — so the heading read as floating between the two lists rather than
 * belonging to the one under it. Uneven panel rhythm is among the fastest
 * amateur tells and is entirely arithmetic to fix (plan §4.4).
 *
 * The scale is a 1.2 ratio anchored on the route title and floored just above
 * the 2.4 mm print-legibility threshold quality_metrics.js enforces — the dense
 * two-column subtitle was 2.3 mm and failed it:
 *
 *     2.45  ·  2.9  ·  3.5  ·  (4.2)  ·  5.0
 *
 *   5.0   section heading — `Services` and `Key`, now the same size
 *   3.5   route title (single column and grouped)
 *   2.9   route subtitle, operator group header, Key item, fare note, and the
 *         route title in a dense multi-column panel (one step down)
 *   2.45  subtitle in a dense multi-column panel
 *
 * 4.2 is a step of the scale that nothing in the panel needs; it is listed so
 * the 3.5 → 5.0 jump reads as skipping a step rather than as an arbitrary gap.
 *
 * The rhythm: one rule for every heading, expressed as CLEAR AIR between real
 * ink (cap-top to descender) rather than between baselines — so a 5 mm heading
 * gets the same optical gap over 3.5 mm titles as it does over 2.9 mm Key
 * items, which a fixed baseline step cannot give. Air above a section heading
 * is deliberately larger than air below it, the asymmetry panelGroups already
 * discovered by hand on 2026-08-11 and got backwards on its first attempt.
 *
 * Absent => every size and every gap is exactly the hand-tuned value it was,
 * byte for byte (invariant 2).
 */
const PS = DESIGN.panelScale ? { head:5.0, title:3.5, sub:2.9, dense:2.45 } : null;
const CAP=0.72, DESC=0.21;      // Arial cap-height / descender, as a fraction of size
const AIR_BELOW_HEAD=3.2, AIR_ABOVE_HEAD=5.0;    // section heading (Services, Key)
const AIR_ABOVE_GROUP=3.4, AIR_BELOW_GROUP=2.0;  // operator group header, a lesser break
// Baseline-to-baseline distance leaving `air` mm of clear space between the
// descenders of one line and the topmost ink of the next. `rise` is how far that
// ink stands above ITS baseline — cap-height for a plain line of text, but the
// route badge and the Key pictogram both stand higher than the text beside them,
// and they are what the eye reads as the top edge of the row. Measuring to the
// cap-height instead put `Services` visibly tighter to its first badge than
// `Key` was to its first symbol, even though the arithmetic said they matched.
const gapDown=(from,air,rise)=>from*DESC+air+rise;
// Topmost ink above the baseline, per row type.
const RISE_ROW   = PS ? Math.max(PS.title*CAP, PBR-0.6) : 0;   // badge row, full size
const RISE_HEAD  = PS ? PS.sub*CAP : 0;                        // operator group header
const RISE_KEY   = PS ? Math.max(PS.sub*CAP, 2.0+1) : 0;       // 2.0 mm-radius pictogram
// A single-column route block is a fixed 3.6 mm title-to-subtitle leading inside
// a `panelRow` pitch, so the air between one row's subtitle and the NEXT row's
// badge is whatever `panelRow` has left over. The test is simply that they must
// not touch, with 0.3 mm of tolerance: the default 8.0 clears it with 0.39 mm,
// and St Ives' 6.8 with a 3.2 mm badge does not — its badges and the subtitles
// above them are in contact. Report it rather than change `panelRow` here; the
// pitch is the town's, and widening it lengthens the whole panel.
if(PS && !PCOLS){
  const needRow = 3.6 + gapDown(PS.sub,0.3,RISE_ROW);
  if(PROW < needRow) process.stderr.write(`panelScale: panelRow ${PROW}mm leaves ${(PROW-3.6-PS.sub*DESC-RISE_ROW).toFixed(2)}mm between a subtitle and the badge below it (wants >= ${needRow.toFixed(1)}mm at ${PS.title}/${PS.sub}mm with a ${PBR}mm badge).\n`);
}

out(`<text x="${PX}" y="${py}" font-family="Arial" font-weight="bold" font-size="${PS?PS.head:5}" fill="#222">Services</text>`);
if(!PS) py+=2;
let lastSubY=py;                // baseline of the last line drawn in the services list
if(RJ.panelGroups){
  // group the panel by operator (operators[] from routes.json)
  const groups=(RJ.operators||[]).map(op=>({name:op.name, rs:panelOrder.filter(r=>(op.routes||[]).includes(r))})).filter(g=>g.rs.length);
  const ungrouped=panelOrder.filter(r=>!groups.some(g=>g.rs.includes(r)));
  if(ungrouped.length) groups.push({name:'', rs:ungrouped});
  let firstBlock=true;
  for(const g of groups){
    // Group-header spacing is deliberately asymmetric: more room ABOVE the
    // header (to read as a break from the previous group) than BELOW it
    // (the header sits right above its own routes, not floating between
    // them) — was 5.4/PROW(8), i.e. backwards, until 2026-08-11.
    if(g.name){
      if(PS) py = (firstBlock ? py + gapDown(PS.head,AIR_BELOW_HEAD,RISE_HEAD)
                              : lastSubY + gapDown(PS.sub,AIR_ABOVE_GROUP,RISE_HEAD));
      else py+=7.5;
      out(`<text x="${PX}" y="${py}" font-family="Arial" font-weight="bold" font-size="${PS?PS.sub:2.9}" fill="#777">${esc(g.name.toUpperCase())}</text>`);
    }
    g.rs.forEach((r,i)=>{
      const d=INTDESC[r]||[r,''];
      // `py` is the badge CENTRE; the title baseline sits 0.6 mm above it, so the
      // 0.6 converts a baseline-to-baseline gap into a row anchor.
      if(PS){
        if(i>0 || (!g.name && !firstBlock)) py += PROW;
        else if(g.name) py += gapDown(PS.sub,AIR_BELOW_GROUP,RISE_ROW) + 0.6;
        else py += gapDown(PS.head,AIR_BELOW_HEAD,RISE_ROW) + 0.6;
      } else py += (g.name && i===0) ? PROW-1.5 : PROW;
      badge(PX+4,py,r,PBR);
      out(`<text x="${PX+10}" y="${py-0.6}" font-family="Arial" font-weight="bold" font-size="${PS?PS.title:3.5}" fill="#111">${esc(d[0])}</text>`);
      out(`<text x="${PX+10}" y="${py+3.0}" font-family="Arial" font-size="${PS?PS.sub:2.8}" fill="#555">${esc(d[1])}</text>`);
      lastSubY=py+3.0;
    });
    firstBlock=false;
  }
} else if(PCOLS){
  // multi-column panel: a town with more services than one column fits on A4.
  // Column-major so a column reads top-to-bottom like the single-column panel.
  const nCol=Math.max(1,PCOLS.cols|0), cw=PCOLS.width||48, crow=PCOLS.row||PROW;
  // Badge radius must fit inside whatever row pitch this town picked, or
  // consecutive rows' bubbles overlap (High Wycombe: row 4.9 vs the old
  // fixed PBR-0.6=3.4 radius/6.8 diameter — badges overlapped). Shrink to
  // fit crow, down to a legibility floor of 1.8mm; if even that overlaps,
  // the row pitch itself is too tight and needs widening/another column —
  // warn rather than silently print unreadable or overlapping badges.
  const pcolsBadgeR = Math.min(PBR-0.6, Math.max(1.8, crow/2-0.5));
  if (2*pcolsBadgeR+0.3 > crow) process.stderr.write(`panelCols: row ${crow}mm is too tight even at the ${pcolsBadgeR.toFixed(1)}mm badge floor (needs >= ${(2*1.8+0.3).toFixed(1)}mm) — widen row or add a column.\n`);
  // Under the type scale a dense row carries a 2.9 mm title over a 2.45 mm
  // subtitle; if the row pitch cannot hold both with air between the blocks,
  // say so rather than letting the subtitle silently crowd the title below it.
  // The remedy is a column or a wider row (config), not a smaller type size —
  // 2.45 mm is already the print-legibility floor.
  const riseDense = PS ? Math.max(PS.sub*CAP, pcolsBadgeR-0.6) : 0;
  if (PS){
    const need = gapDown(PS.sub,0.15,PS.dense*CAP) + gapDown(PS.dense,0.8,riseDense);
    if (crow < need) process.stderr.write(`panelScale: panelCols row ${crow}mm cannot carry the type scale (needs >= ${need.toFixed(1)}mm for ${PS.sub}mm over ${PS.dense}mm) — the panel is over-stuffed. Add a column, widen the row, or drop the subtitles on this town.\n`);
  }
  const per=Math.ceil(panelOrder.length/nCol);
  // First row's anchor comes from the heading rule; later rows step by `crow`.
  const top = PS ? py + gapDown(PS.head,AIR_BELOW_HEAD,riseDense) + 0.6 - crow : py;
  panelOrder.forEach((r,i)=>{
    const col=Math.floor(i/per), row=i%per;
    const cx=PX+col*cw, cy=top+(row+1)*crow;
    const d=INTDESC[r]||[r,''];
    badge(cx+3,cy,r,pcolsBadgeR);
    // Subtitle sits ~35% of the row pitch below its own title, not at a
    // fixed +3.1mm offset or an even 50/50 split — a 50/50 split (2026-08-11)
    // fixed the previous overlap but read as too close above the title/too
    // loose below it once seen printed; skewing the split gives the title
    // more clear air above (from the previous row's subtitle) while pulling
    // its own subtitle in tighter underneath (2026-08-11, second pass).
    const subY=cy-0.6+crow*0.35+0.1;
    out(`<text x="${cx+7.6}" y="${cy-0.6}" font-family="Arial" font-weight="bold" font-size="${PS?PS.sub:2.9}" fill="#111">${esc(d[0])}</text>`);
    out(`<text x="${cx+7.6}" y="${subY.toFixed(2)}" font-family="Arial" font-size="${PS?PS.dense:2.3}" fill="#555">${esc(d[1])}</text>`);
    if(row===per-1) lastSubY=subY;
  });
  py=top+per*crow;
} else {
let firstRow=true;
for(const r of panelOrder){
  const d=INTDESC[r]||[r,''];
  // `py` is the badge CENTRE; the title baseline sits 0.6 mm above it.
  if(PS&&firstRow) py += gapDown(PS.head,AIR_BELOW_HEAD,RISE_ROW)+0.6; else py+=PROW;
  firstRow=false;
  badge(PX+4,py,r,PBR);
  out(`<text x="${PX+10}" y="${py-0.6}" font-family="Arial" font-weight="bold" font-size="${PS?PS.title:3.5}" fill="#111">${esc(d[0])}</text>`);
  out(`<text x="${PX+10}" y="${py+3.0}" font-family="Arial" font-size="${PS?PS.sub:2.8}" fill="#555">${esc(d[1])}</text>`);
  lastSubY=py+3.0;
}
}
// key (using the real pictograms)
let KX=PX;
if(PCOLS&&PCOLS.keyAt){ KX=PCOLS.keyAt.x!=null?PCOLS.keyAt.x:PX; py=(PCOLS.keyAt.y!=null?PCOLS.keyAt.y:py+10)-10; }
// A pinned keyAt.y still wins — the two-column towns place the Key beside the
// map, not under the list, and only the town knows where that is.
if(PS && !(PCOLS&&PCOLS.keyAt&&PCOLS.keyAt.y!=null)) py = lastSubY + gapDown(PS.sub,AIR_ABOVE_HEAD,PS.head*CAP) - 10;
py+=10; out(`<text x="${KX}" y="${py}" font-family="Arial" font-weight="bold" font-size="${PS?PS.head:4.4}" fill="#222">Key</text>`);
const key=[['shop','Supermarket'],['gp','Doctors / GP'],['pharmacy','Pharmacy'],['library','Library'],['museum','Museum'],['leisure','Leisure centre'],['school','School'],['park','Park'],['industrial','Industrial estate'],['community','Community centre'],['townhall','Town Hall']];
if(pois.some(p=>p.cat==='allotments')) key.push(['allotments','Allotments']);
// The label baseline is ky+1, so the heading rule is applied there and the icon
// centre follows from it — the same clear air under `Key` as under `Services`.
const KFIRST = PS ? gapDown(PS.head,AIR_BELOW_HEAD,RISE_KEY)-1 : 5;
key.forEach((kk,i)=>{const ky=py+KFIRST+i*KROW, kx=PX+3;
  out(icon(kk[0],kx,ky,2.0,DESIGN.iconInk));
  // '3.0' as a STRING: the old code emitted the literal font-size="3.0", and
  // JS renders the number 3.0 as "3" — a one-character diff that fails all 27
  // byte-identical gates with the key absent.
  out(`<text x="${kx+4.0}" y="${ky+1}" font-family="Arial" font-size="${PS?PS.sub:'3.0'}" fill="#222">${esc(kk[1])}</text>`);});

// fare note (opt-in routes.json "fareNote") — highlighted box under the key
if(RJ.fareNote){
  let fy=PS ? py+KFIRST+(key.length-1)*KROW+1+gapDown(PS.sub,AIR_ABOVE_HEAD,PS.sub*CAP)
            : py+5+key.length*KROW+9;
  const words=String(RJ.fareNote).split(' '); const lines=[]; let cur='';
  for(const wd of words){ if((cur+' '+wd).trim().length>38){ lines.push(cur.trim()); cur=wd; } else cur+=' '+wd; }
  if(cur.trim()) lines.push(cur.trim());
  out(`<rect x="${PX-2}" y="${fy-4.4}" width="95" height="${(lines.length*3.6+6).toFixed(1)}" rx="1.2" fill="#fff4c2"/>`);
  lines.forEach((ln,i)=>out(`<text x="${PX}" y="${fy+i*3.6}" font-family="Arial" font-weight="bold" font-size="${PS?PS.sub:2.9}" fill="#333">${esc(ln)}</text>`));
}

// ---- north arrow (DEFAULT ON for internalRoads; disable with northArrow:false)
// The internal map is rotated (rotationDeg / PCA) to fill the page, so "up" is
// not north — a small arrow shows which way north actually is. Drawn on EVERY
// internalRoads map by default (Peter's ask 2026-07-20, "north arrow on every
// map"); set internalRoads.northArrow:false to suppress, or pass {x,y,len,angle}
// to position it. Still gated by IR so non-internalRoads gate towns are
// unaffected. Direction: the SCREEN bearing of increasing latitude under the
// active rotation (theta); the schematic passes a precomputed `angle` (deg)
// because its coords are pre-rotated and run at rotationDeg 0, so it can't
// re-derive north from theta.
if (NORTH_ON) {
  // Position resolved above: the configured {x,y} when it is clear, otherwise the
  // nearest blank corner (v2 only — a v1 sheet never runs that search, so its
  // arrow stays exactly where its config puts it and the output is byte-identical).
  // north planar step (0,-1) through the same rot() the projection uses:
  // rot(0,-1) = [sin(-theta), -cos(-theta)] in screen space (y down).
  const bx = NORTH.x, by = NORTH.y, L = NORTH_LEN, ang = NORTH_ANG;
  const c=Math.cos(ang), s=Math.sin(ang), tx=bx+c*L, ty=by+s*L;
  const px=-s, py=c, ah=2.4, aw=1.4;                     // arrowhead
  out(`<line x1="${bx.toFixed(2)}" y1="${by.toFixed(2)}" x2="${tx.toFixed(2)}" y2="${ty.toFixed(2)}" stroke="#666" stroke-width="0.8"/>`);
  out(`<path d="M${tx.toFixed(2)} ${ty.toFixed(2)}L${(tx-c*ah+px*aw).toFixed(2)} ${(ty-s*ah+py*aw).toFixed(2)}L${(tx-c*ah-px*aw).toFixed(2)} ${(ty-s*ah-py*aw).toFixed(2)}Z" fill="#666"/>`);
  out(`<text x="${(tx+c*3).toFixed(2)}" y="${(ty+s*3+1).toFixed(2)}" font-family="Arial" font-weight="bold" font-size="3.4" fill="#666" text-anchor="middle">N</text>`);
}

// footer band: attribution note + version + BusMaps.uk (shared across all four map types — footer.js)
const _ver = process.env.LEAFLET_VERSION || RJ.version;
out(footerBand({
  notes: INTERNAL_FOOTER_NOTES,
  version: _ver, validFrom: RJ.validFrom || 'Summer 2026'
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
{ const at=(RJ.stamp&&RJ.stamp.internalAt)||[6,196]; stampNote(RJ.stamp, at[0], at[1], 'start'); }

out('</svg>');
if(THINKEEP){
  const all=new Set([].concat(...Object.values(routes)));
  console.log('stopThinning: '+THINKEEP.size+' of '+all.size+' stops keep a tick'
    +' (minLines '+(THIN.minLines!=null?THIN.minLines:2)+(THIN.termini!==false?' + termini':'')+')');
}
fs.writeFileSync(DIR+'/internal.svg', s);
console.log('internal.svg', s.length, 'bytes; pois', pois.length, 'rotation°', (-theta*180/Math.PI).toFixed(1) + (IR?' [internalRoads]':''));
