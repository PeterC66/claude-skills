/*
 * projection.js - lat/lon to page millimetres, for the internal map.
 *
 * CONTRACT. `projection({ stopPts, atco2ll, ANCHOR, IR, ZOOM, OV,
 * FIXED_ORIENTATION, FOOTER_SAFE, FOOTER_PLATE_TOP, DESIGN })` returns the
 * eleven things the drawing code downstream actually asks for:
 *
 *   XY(ll)              the projection itself: [lat,lon] -> [x mm, y mm]
 *   MX0 MX1 MY0 MY1     the map frame, in mm
 *   sc                  page mm per unit of planar(), i.e. per 111.32 km
 *   theta               the rotation in radians, as the north arrow needs it
 *   APPLIED_ROTATION_DEG  the same angle in the units and sign the CONFIG uses,
 *                       so design.fixedOrientation:<this> reproduces the sheet
 *   CPF R1 LENSES       what the scale bar needs to know it is on a fisheye
 *
 * plus `viewport`, the frozen-fit block, for the caller's EDITOR_KEYS dump. The
 * intermediate steps -- planar, rot, tform0, compress, lens, tform -- are NOT
 * exported, because measured across the whole of gen_internal.js not one of them
 * is called downstream: every later mention is a comment. This module writes
 * nothing and reads no files.
 *
 * THE PIPELINE, in the order a coordinate goes through it:
 *   planar   equirectangular, longitude scaled by cos(lat0) so it is isotropic
 *   rot      PCA rotation about the fit centroid, so the town fills A4 landscape
 *   compress the always-on centre fisheye: 1:1 inside coreKm, then focus.comp,
 *            optionally a third zone beyond midKm at outerComp
 *   lens     zero or more LOCAL fisheyes on top, each bounded so the map's
 *            overall extent -- hence the fit scale -- does not move
 *   fit      scale and offset the result into the frame
 *
 * ORIENTATION PRECEDENCE, highest first: overrides.json rotationDeg (the
 * editor's hand-nudge), design.fixedOrientation, internalRoads.rotationDeg, then
 * PCA. The parameter names below are the generator's own, deliberately: this was
 * lifted out of gen_internal.js on 2026-08-27 (OA-129 Phase 3) as an extraction,
 * not a rewrite, and keeping the names makes the diff readable.
 */
'use strict';

function projection({ stopPts, atco2ll, ANCHOR, IR, ZOOM, OV, FIXED_ORIENTATION,
                      FOOTER_SAFE, FOOTER_PLATE_TOP, DESIGN }) {
  const lat0 = stopPts.reduce((s,p)=>s+p[0],0)/stopPts.length;
  const k=Math.cos(lat0*Math.PI/180);
  const planar=([lat,lon])=>[lon*k,-lat];
  // PCA on stop points
  const P=stopPts.map(planar);
  const mx=P.reduce((s,p)=>s+p[0],0)/P.length, my=P.reduce((s,p)=>s+p[1],0)/P.length;
  let sxx=0,sxy=0,syy=0; for(const [x,y] of P){const dx=x-mx,dy=y-my; sxx+=dx*dx; sxy+=dx*dy; syy+=dy*dy;}
  let theta=0.5*Math.atan2(2*sxy, sxx-syy);              // principal axis angle
  // ---- orientation, in precedence order -------------------------------------
  // 1. overrides.json  (the editor's own hand-nudge; always wins)
  // 2. design.fixedOrientation  (2026-08-21 — see FIXED_ORIENTATION below)
  // 3. internalRoads.rotationDeg  (the older, roads-model-only key; still honoured)
  // 4. PCA (above) — the default, and what every map used before this existed
  //
  // WHY 2 EXISTS ALONGSIDE 3. `internalRoads.rotationDeg` is read off the IR block,
  // so a town on the CLASSIC model (internalRoads:false — no roads skeleton) had no
  // config route to a fixed orientation at all; its only option was an overrides.json
  // entry, which is the editor's file, not the town's config. `design.fixedOrientation`
  // is top-level and therefore available to every map, classic or roads, area or place.
  if(OV.rotationDeg!=null) theta = -OV.rotationDeg*Math.PI/180;   // manual rotation override
  else if(FIXED_ORIENTATION!=null) theta = -FIXED_ORIENTATION*Math.PI/180; // design.fixedOrientation
  else if(IR && IR.rotationDeg!=null) theta = -IR.rotationDeg*Math.PI/180; // config rotation (0 = north up)
  // The rotation ACTUALLY APPLIED, in the same units and sign convention the config
  // uses, so `design.fixedOrientation: <this number>` reproduces this exact sheet.
  // Captured below for tooling; also printed in the closing summary line.
  const APPLIED_ROTATION_DEG = -theta*180/Math.PI;
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
  const MY1 = FOOTER_SAFE
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
  // The EDITOR_KEYS viewport dump stays with the caller: this module writes
  // nothing. The whole fit is returned, so the caller can print it.
  const XY=ll=>{const [x,y]=tform(ll); return [MX0+offX+(x-minX)*sc, MY0+offY+(y-minY)*sc];};

  return { XY, MX0, MX1, MY0, MY1, sc, theta, APPLIED_ROTATION_DEG, CPF, R1, LENSES,
           viewport: { minX, maxX, minY, maxY, sc, offX, offY } };
}

module.exports = { projection };
