/*
 * complexity_ladder.js — the four rungs that make a big town's internal sheet
 * readable, and nothing else.
 *
 * CONTRACT, and it is three functions rather than one because the rungs are read
 * at two different moments in the build. `complexityLadder({RJ, C, TXT})` reads
 * the config — rung 1 `internalCorridors`, rung 2 `coreBox`, rung 2b
 * `stopThinning`, rung 3 `corridorPalette` — and returns
 * `{CORR, CPAL, laneKey, colourShared, CBOX, THIN}`. It ALIASES COLOURS IN PLACE,
 * mutating the caller's `C` and `TXT`, which is why it takes them rather than
 * returning a palette: every later consumer already holds a reference to those two
 * objects, and the aliasing has to be visible through it. `coreBoxGeometry(...)`
 * cannot run until the projection exists, and `thinKeep(...)` needs `laneKey` from
 * the first call. None of the three reads a file or writes one.
 * Extracted verbatim from gen_internal.js on 2026-08-27 (OA-129 Phase 3).
 *
 * ABSENT => IDENTITY, and this is the property the unit tests are here to hold.
 * With none of the four keys set: `CORR`/`CPAL`/`CBOX`/`THIN` are null, `laneKey`
 * is `r=>r`, `colourShared` is always false, `CORE` is null, `inCore` is always
 * false, `clipOutCore` hands back the polyline it was given, and `thinKeep`
 * returns null so every stop keeps its tick. That is what keeps the towns which do
 * not climb the ladder byte-identical.
 *
 * WHY A LADDER AT ALL: references/complexity-triage.md. The rungs are DECLARED in
 * routes.json and never inferred, so a data refresh cannot silently reshuffle a
 * town's colours or delete its town centre.
 */
'use strict';

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
// C and TXT are arguments because this mutates them; they were in lexical
// scope while the block lived in the generator.
function aliasColours(g, C, TXT){ if(!g) return;
  for(const l of Object.keys(g.fam)) for(const m of g.fam[l]){
    if(m===l) continue;
    if(m in C) C[m] = C[l];
    if(TXT && (m in TXT)) TXT[m] = TXT[l];
  }
}

/** Length of a page-space polyline, in mm. */
const runLen = rn => { let L=0; for(let i=1;i<rn.length;i++) L+=Math.hypot(rn[i][0]-rn[i-1][0], rn[i][1]-rn[i-1][1]); return L; };

/** Rungs 1 and 3, then 2 and 2b as config. MUTATES C and TXT (colour aliasing). */
function complexityLadder({ RJ, C, TXT }){
  const CORR = parseFamilies(RJ.internalCorridors);
  // lane identity: a family draws as ONE lane keyed by its lead. Identity map when
  // internalCorridors is absent, which is what keeps every existing town unchanged.
  const laneKey = CORR ? (r=>CORR.lead[r]||r) : (r=>r);
  aliasColours(CORR, C, TXT);
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
  aliasColours(CPAL, C, TXT);
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
  return { CORR, CPAL, laneKey, colourShared, CBOX, THIN };
}

/** Rung 2 in page space: the box, the inside test and the route clipper. */
function coreBoxGeometry({ CBOX, ANCHOR, atco2ll, XY, refuse }){
  // ---- coreBox geometry (rung 2). Null unless routes.json coreBox is set. ------
  // Project a real geographic circle of `radius` metres around the anchor and take
  // its page-space bounding box. Doing it this way, rather than converting metres
  // to mm through a scale factor, is exact under the focus fisheye and any extra
  // lenses[] — which is the whole difficulty, since those deliberately make the
  // centre's scale different from everywhere else.
  const CORE = (function(){
    if(!CBOX) return null;
    const all = atco2ll[ANCHOR];
    if(!all){ refuse('coreBox: anchor '+ANCHOR+' has no coordinate — box not drawn'); return null; }
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
  return { CORE, inCore, coreEdge, clipOutCore, MINRUN };
}

// ---- stopThinning: the set of stops that keep their tick (null => all) -------
function thinKeep({ THIN, order, routes, laneKey, ANCHOR }){
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
}

module.exports = { complexityLadder, coreBoxGeometry, thinKeep, parseFamilies, aliasColours, runLen };
