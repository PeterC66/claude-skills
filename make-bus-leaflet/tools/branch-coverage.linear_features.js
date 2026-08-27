/*
 * A worked branch-coverage spec, kept because an example that RUNS is worth
 * more than a description of the format. This is the one that produced the
 * linear_features.js numbers on 2026-08-27:
 *
 *   node tools/branch-coverage.js tools/branch-coverage.linear_features.js
 *
 * Run from `make-bus-leaflet/`, no placeholders. Expected result, and it is
 * worth checking against, because a spec whose anchors have drifted aborts
 * rather than lying: 11 maps project their geometry and draw, 7 hide the
 * feature by override, 6 take railStitch / railMerge / chequer, 10 draw a plain
 * stroke — and SIX branches are dark: both geometry overrides, the whole-
 * feature nudge, minSegLen, the dashed cap, and the tie symbol.
 */
'use strict';

module.exports = {
  module: 'linear_features.js',
  generator: 'gen_internal.js',
  sheet: 'internal.svg',
  marks: [
    { find: '    if(ov.segments) segs = ov.segments.map',
      insert: "    if(ov.segments) _hit('featSegs: override segments (straighten)');\n"
            + "    else if(ov.points) _hit('featSegs: override points');\n"
            + "    else _hit('featSegs: projected geo');" },

    { find: '    if(dx||dy) segs = segs.map',
      insert: "    if(dx||dy) _hit('featSegs: override move (nudge)');" },

    { find: '    if(featOv(f).hide) return;',
      insert: "    _hit(featOv(f).hide ? 'drawFeature: HIDDEN by override' : 'drawFeature: drawn');" },

    { find: '    if(st.railStitch) segs = stitchSegs',
      insert: "    if(st.railStitch) _hit('drawFeature: railStitch');\n"
            + "    if(st.railMerge) _hit('drawFeature: railMerge');\n"
            + "    if(st.minSegLen) _hit('drawFeature: minSegLen');\n"
            + "    if(st.chequer) _hit('drawFeature: chequer');\n"
            + "    else if(st.dash) _hit('drawFeature: dashed (butt cap)');\n"
            + "    else _hit('drawFeature: plain stroke');\n"
            + "    if(st.ties) _hit('drawFeature: ties');" },

    { find: "    const mid  = (own.rail||base.rail)===",
      insert: "    _hit((own.rail||base.rail)==='chequer' ? 'featStyle: RAIL_CHEQUER layered' : 'featStyle: plain');" },
  ],
  labels: [
    'featSegs: override segments (straighten)',
    'featSegs: override points',
    'featSegs: projected geo',
    'featSegs: override move (nudge)',
    'drawFeature: HIDDEN by override',
    'drawFeature: drawn',
    'drawFeature: railStitch',
    'drawFeature: railMerge',
    'drawFeature: minSegLen',
    'drawFeature: chequer',
    'drawFeature: dashed (butt cap)',
    'drawFeature: plain stroke',
    'drawFeature: ties',
    'featStyle: RAIL_CHEQUER layered',
    'featStyle: plain',
  ],
};
