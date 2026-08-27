/*
 * linear_features.js — how a river, main road, railway or canal becomes ink.
 *
 * CONTRACT. `linearFeatures(deps)` returns `{ featOv, featStyle, featSegs,
 * drawFeature }`. A factory, because every one of them reads the town's
 * overrides, its FEATURE_STYLES table and its projection. `out` and `gk` are
 * passed in, so the caller keeps the document.
 *
 * WHAT IS NOT HERE, and it is a deliberate boundary rather than a stopping
 * point: `drawFeatureLabel` stays in gen_internal.js. Drawing the line needs
 * the overrides and the projection and nothing else; siting its NAME reaches
 * into four subsystems the geometry knows nothing about — the coreBox, the
 * Services panel's left edge, the footer plate, and the auto-label solver that
 * has not run yet when this module is built. It is a different subject and it
 * belongs in a different module, extracted with the guards it is made of.
 *
 * THE EIGHT POLYLINE HELPERS BELOW ARE PURE and are not exported, because
 * nothing outside called them: segLen, ptToSeg, ptToPoly, turnAt, stitchSegs,
 * densify, dropCollinear, mergeSegs. Two of them carry a fault that was found
 * on real data and their comments say which — stitchSegs' maxTurn (St Neots'
 * four parallel tracks chained into one path that doubled back) and mergeSegs'
 * trimming rather than dropping (a siding that runs alongside for 90% of its
 * length and then diverges). Those are what the unit suite is for; the byte
 * gate can only say that today's four rail towns did not move.
 *
 * Extracted from gen_internal.js on 2026-08-27 (OA-129 Phase 3), verbatim.
 */
'use strict';

function linearFeatures(deps) {
  const {
    out,             // append one line to the document the CALLER owns
    gk,              // editor-key wrapper, from svg_primitives
    OV,              // overrides.internal — features[key] may hide/move/straighten
    FEATURE_STYLES,  // per-type defaults
    RAIL_CHEQUER,    // the chequer preset, layered between type default and town style
    XY,              // [lat,lon] -> page mm
  } = deps;

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
        // The white core needs the SAME linejoin as the casing under it. It had none, so
        // it took SVG's default — miter — and a miter spike is width/sin(turn/2) long: on
        // GEOGRAPHIC geometry the turns are gentle and nothing showed, but the diagram
        // engine warps the line into turns up to 148 deg, where a 0.88 mm core throws a
        // 3.2 mm spike out past a 1.6 mm casing. That is High Wycombe's "malformed railway
        // segments (white too large)" (Peter, 2026-08-24) — white blocks bursting out of
        // the dark band at every bend, and the pattern reading as an outline rather than a
        // chequer. Round joins clip the spike back inside the casing. Byte-inert on any
        // sheet whose railway has no sharp turn, which is every geographic internal.
        lines.push(`<path d="${d}" fill="none" stroke="${st.coreColor}" stroke-width="${st.coreWidth}" stroke-dasharray="${st.chequer}" stroke-linecap="butt" stroke-linejoin="round"/>`);
        continue;
      }
      // A dashed feature needs a BUTT cap for the same reason the chequer above does
      // and the external generators' dashed spokes do: a round cap adds width/2 of ink
      // past each end of every dash, so any pattern whose gap is narrower than the
      // stroke fuses into a solid scalloped line. The `canal` default ("3 1.6" at
      // w2.4) is exactly such a pattern — latent today because no town has a canal yet.
      const cap = st.dash ? 'butt' : 'round';
      lines.push(`<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}"${dash} stroke-linecap="${cap}" stroke-linejoin="round"/>`);
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
  return { featOv, featStyle, featSegs, drawFeature };
}

module.exports = { linearFeatures };
