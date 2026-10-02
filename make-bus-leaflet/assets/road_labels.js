/*
 * road_labels.js — where an internalRoads map prints its road names.
 *
 * CONTRACT. `roadLabels(deps)` returns `{ roadNameAgg, placeRoadName }`.
 * `roadNameAgg()` gathers every drawn skeleton segment by road name, pulls in
 * the names a town asks for that no bus uses (roadLabelInclude, keyRoads,
 * roadLabelPin) from roads_geo, and drops roadLabelExclude. `placeRoadName()`
 * tries the candidate spots for one name, RESERVES the first clear box and
 * returns the <text> for it, without writing it: the caller keeps the document
 * and so keeps the paint order.
 *
 * WHY IT IS A MODULE (OA-176, 2026-10-02). It was one block at the end of
 * gen_internal.js's claim phase. internalRoads.roadLabelPin has to run the same
 * placement EARLIER, before the badges along the lines are placed, because with
 * Ramsey's laneTrim on, RH5's badge took the exact spot Great Whyte and Oilmills
 * Road had used, and a pass that runs after the badges can never win it back.
 * Two callers of one placement is a function; the generator's line ceiling made
 * it a module. The bodies moved verbatim, so every map that sets no pin is
 * byte-identical.
 */
'use strict';

function roadLabels({ IR, SKEL, RG, XY, FONT, iconBoxes, overlaps, overlapsNoIcons, inFrame, inCore, reserve, esc }){
function roadNameAgg(){
  const agg={};
  for(const e of SKEL){ if(!e.name)continue;
    const L=Math.hypot(e.q[0]-e.p[0], e.q[1]-e.p[1]); if(!L)continue;
    (agg[e.name]=agg[e.name]||{len:0,segs:[]}).len+=L; agg[e.name].segs.push([e.p,e.q]); }
  const rn=IR.roadRename||[];
  const ren=n=>{ for(const [a,b] of rn) if(n===a) return b; return n; };
  // keyRoads are implicitly label-eligible too (one name, not two config arrays).
  const incl=(IR.roadLabelInclude||[]).concat(IR.keyRoads||[]).concat(IR.roadLabelPin||[]);
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
  return {agg, incl, ren};
}
function placeRoadName(n,a,ren){
    let svg=null;
    let sw=0,cx0=0,cy0=0,vx=0,vy=0;
    for(const [p,q] of a.segs){ const L=Math.hypot(q[0]-p[0],q[1]-p[1]);
      sw+=L; cx0+=(p[0]+q[0])/2*L; cy0+=(p[1]+q[1])/2*L;
      const an=Math.atan2(q[1]-p[1],q[0]-p[0]); vx+=Math.cos(2*an)*L; vy+=Math.sin(2*an)*L; }
    cx0/=sw; cy0/=sw;
    let ang=Math.atan2(vy,vx)/2*180/Math.PI; if(ang>90)ang-=180; if(ang<-90)ang+=180;
    const label=ren(n);
    // Measured, for the same reason as the anchor label above: a character-count
    // guess put "Ramsey Road" at 13.75 mm when it draws 15.84, and the badge sitting
    // in the 2.09 mm nobody claimed was one of OA-148's thirteen.
    const w=FONT.textWidth(label,2.5,false);
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
    /* THE SEVEN, THEN EVERY OTHER MIDPOINT (2026-08-30, OA-148 / OA-176).
     *
     * Measuring the box properly (above) makes it 2 mm wider than the guess, and
     * on the first dry run that cost St Ives its "Ramsey Road" and "Somersham
     * Road" outright — the pass drops a name when all its candidates are blocked,
     * and a wider box blocks more easily. A truthful measurement that loses a
     * named road is not an improvement, and the drop count is a number this
     * project has already been blind to once.
     *
     * So the pass gets more places to look rather than a smaller box. The seven
     * it always had come FIRST and in the same order, so any road name that
     * placed at one of them still does; the rest of the road's own segment
     * midpoints follow, in the along-bearing order `mids` is already sorted into,
     * which is deterministic and costs nothing on a road that placed at its
     * centroid. */
    const seen7=new Set();
    const cands=[[cx0,cy0]].concat([0.3,0.7,0.15,0.85,0.42,0.58].map(along))
      .concat(mids.map(m=>[m.x,m.y]))
      .filter(([px2,py2])=>{ const k=px2.toFixed(3)+','+py2.toFixed(3);
        if(seen7.has(k)) return false; seen7.add(k); return true; });
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
      svg=`<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-family="Arial" font-size="2.5" fill="#666" text-anchor="middle" transform="rotate(${ang.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})" stroke="#fff" stroke-width="0.8" paint-order="stroke">${esc(label)}</text>`;
      ok=true; break;
    }
    }
    return {ok, anyInFrame, svg};
}
return { roadNameAgg, placeRoadName };
}

module.exports = { roadLabels };
