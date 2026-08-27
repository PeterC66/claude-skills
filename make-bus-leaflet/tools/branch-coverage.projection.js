/*
 * Branch-coverage spec for projection.js — lat/lon to page mm.
 *
 *   node tools/branch-coverage.js tools/branch-coverage.projection.js
 *
 * Run from `make-bus-leaflet/`, no placeholders. Written for OA-136's Phase 4
 * verdicts (2026-08-27), to re-measure a claim rather than act on a backlog row:
 * the row said SIX branches here are taken by no committed map — `overrides.json`
 * `rotationDeg`, `design.fixedOrientation`, `design.footerSafe:false`, the
 * three-zone fisheye `focus.midKm`, a frozen viewport, and the CLASSIC
 * `internalRoads:false` model itself.
 *
 * Read the result with the population in mind: this renders `internal.svg` only,
 * so a branch a schematic or a place-boarding sheet takes will read as zero here.
 */
'use strict';

module.exports = {
  module: 'projection.js',
  generator: 'gen_internal.js',
  sheet: 'internal.svg',
  marks: [
    { find: '  if(OV.rotationDeg!=null) theta = -OV.rotationDeg*Math.PI/180;   // manual rotation override',
      insert: "  _hit(OV.rotationDeg!=null ? 'orientation: overrides.json rotationDeg (the editor hand-nudge)'\n"
            + "     : (FIXED_ORIENTATION!=null ? 'orientation: design.fixedOrientation'\n"
            + "     : ((IR && IR.rotationDeg!=null) ? 'orientation: internalRoads.rotationDeg' : 'orientation: PCA (the default)')));" },

    { find: '  const _radii = stopPts.map(p=>{const[x,y]=tform0(p); return Math.hypot(x-O[0],y-O[1]);}).sort((a,b)=>a-b);',
      insert: "  _hit(IR ? 'model: internalRoads (roads skeleton)' : 'model: CLASSIC (straight chords)');\n"
            + "  if(IR) _hit(Array.isArray(IR.focus.center) ? 'focus: an explicit [lat,lon]'\n"
            + "     : (IR.focus.center==='centroid' ? 'focus: the built-up centroid'\n"
            + "     : (atco2ll[ANCHOR] ? 'focus: the anchor stop' : 'focus: centroid, the anchor having no coordinate')));" },

    { find: '  const CPF2= (IR && IR.focus.outerComp!=null) ? IR.focus.outerComp    : CPF;',
      insert: "  _hit((IR && IR.focus.midKm!=null) ? 'fisheye: THREE zones (focus.midKm)' : 'fisheye: two zones');" },

    { find: '  function lens(p){',
      insert: "  _hit(LENSES.length ? 'lenses: '+(LENSES.length===1?'one detail lens':'several detail lenses') : 'lenses: none');" },

    { find: '  const allT=stopPts.map(tform);',
      insert: "  _hit(FOOTER_SAFE ? 'frame: footerSafe, bottom edge derived from the plate' : 'frame: the legacy flat 205mm');\n"
            + "  _hit((DESIGN.footerGap!=null) ? 'frame: footerGap overridden' : 'frame: footerGap default 3.0');" },

    { find: '  const XY=ll=>{const [x,y]=tform(ll); return [MX0+offX+(x-minX)*sc, MY0+offY+(y-minY)*sc];};',
      insert: "  _hit(OV.viewport ? 'fit: FROZEN viewport from overrides.json' : 'fit: computed from the stops');\n"
            + "  _hit(IR ? ((IR.fitMargin!=null) ? 'fit: fitMargin overridden' : 'fit: fitMargin default 4mm') : 'fit: no margin (classic)');" },
  ],
  labels: [
    'orientation: PCA (the default)',
    'orientation: internalRoads.rotationDeg',
    'orientation: design.fixedOrientation',
    'orientation: overrides.json rotationDeg (the editor hand-nudge)',
    'model: internalRoads (roads skeleton)',
    'model: CLASSIC (straight chords)',
    'focus: the anchor stop',
    'focus: the built-up centroid',
    'focus: an explicit [lat,lon]',
    'focus: centroid, the anchor having no coordinate',
    'fisheye: two zones',
    'fisheye: THREE zones (focus.midKm)',
    'lenses: none',
    'lenses: one detail lens',
    'lenses: several detail lenses',
    'frame: footerSafe, bottom edge derived from the plate',
    'frame: the legacy flat 205mm',
    'frame: footerGap default 3.0',
    'frame: footerGap overridden',
    'fit: computed from the stops',
    'fit: FROZEN viewport from overrides.json',
    'fit: fitMargin default 4mm',
    'fit: fitMargin overridden',
    'fit: no margin (classic)',
  ],
};
