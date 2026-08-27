/*
 * Branch-coverage spec for complexity_ladder.js — which rungs do the committed
 * maps actually climb?
 *
 *   node tools/branch-coverage.js tools/branch-coverage.complexity_ladder.js
 *
 * Run from `make-bus-leaflet/`, no placeholders. MEASURED answer, 2026-08-27, so
 * a later run can be compared against it rather than read on its own: of the 18
 * maps with an internal sheet, THREE bundle corridors (High Wycombe, Ramsey and
 * the High Wycombe Aldi place sheet, which inherits the town's config) and ONE —
 * High Wycombe — climbs rungs 2, 2b and 3 as well. **14 of the 39 labelled
 * branches are dark**, and they are not the ones a reader of the code would
 * guess: every hand override of the coreBox rectangle (`w`, `h`, `at`, `minRun`),
 * the whole `stopThinning` object form with its `minLines`, `keep`, `drop` and
 * `termini:false`, the `coreBox:true` shorthand, the `{routes:[…]}` spelling of a
 * family, a family of one, and the coreBox anchor refusal.
 */
'use strict';

module.exports = {
  module: 'complexity_ladder.js',
  generator: 'gen_internal.js',
  sheet: 'internal.svg',
  marks: [
    { find: '    if(list.length<2) continue;',
      insert: "    _hit(Array.isArray(v) ? 'parseFamilies: array form' : 'parseFamilies: {routes:[…]} form');\n"
            + "    if(list.length<2) _hit('parseFamilies: family of one, skipped');" },

    { find: '    if(m in C) C[m] = C[l];',
      insert: "    _hit(m in C ? 'aliasColours: member recoloured' : 'aliasColours: member not in palette');" },

    { find: '  const laneKey = CORR ? (r=>CORR.lead[r]||r) : (r=>r);',
      insert: "  _hit(CORR ? 'rung 1: internalCorridors declared' : 'rung 1: absent (laneKey is identity)');" },

    { find: '  const colourShared = r => !!(CPAL && CPAL.lead[r]);',
      insert: "  _hit(CPAL ? 'rung 3: corridorPalette declared' : 'rung 3: absent');" },

    { find: '  const THIN = RJ.stopThinning ? (RJ.stopThinning===true?{}:RJ.stopThinning) : null;',
      insert: "  _hit(!RJ.coreBox ? 'rung 2: absent' : (RJ.coreBox===true ? 'rung 2: coreBox true (all defaults)' : 'rung 2: coreBox object'));" },

    { find: '  return { CORR, CPAL, laneKey, colourShared, CBOX, THIN };',
      insert: "  _hit(!RJ.stopThinning ? 'rung 2b: absent' : (RJ.stopThinning===true ? 'rung 2b: stopThinning true (all defaults)' : 'rung 2b: stopThinning object'));" },

    { find: '    if(!CBOX) return null;',
      insert: "    _hit(CBOX ? 'coreBox: projecting the box' : 'coreBox: no box to project');" },

    { find: '    if(!all){ refuse(',
      insert: "    _hit(atco2ll[ANCHOR] ? 'coreBox: anchor located' : 'coreBox: REFUSED — anchor has no coordinate');" },

    { find: '    if(CBOX.at){ const w=x1-x0, h=y1-y0;',
      insert: "    _hit(CBOX.w!=null ? 'coreBox: width overridden' : 'coreBox: width from radius');\n"
            + "    _hit(CBOX.h!=null ? 'coreBox: height overridden' : 'coreBox: height from radius');\n"
            + "    _hit(CBOX.at ? 'coreBox: re-centred by hand (at)' : 'coreBox: centred on the anchor');" },

    { find: '  const MINRUN = CBOX ? (CBOX.minRun!=null?CBOX.minRun:2.5) : 0;',
      insert: "  if(CBOX) _hit(CBOX.minRun!=null ? 'coreBox: minRun overridden' : 'coreBox: minRun default 2.5');" },

    { find: '    if(!CORE) return [pts];',
      insert: "    _hit(CORE ? 'clipOutCore: splitting a line at the box' : 'clipOutCore: pass-through');" },

    { find: '  if(!THIN) return null;',
      insert: "  _hit(THIN ? 'thinKeep: thinning' : 'thinKeep: every stop keeps its tick');" },

    { find: '  const keep = new Set(THIN.keep||[]);',
      insert: "  _hit(THIN.minLines!=null ? 'thinKeep: minLines overridden' : 'thinKeep: minLines default 2');\n"
            + "  _hit(THIN.termini!==false ? 'thinKeep: termini always kept' : 'thinKeep: termini NOT kept');\n"
            + "  _hit((THIN.keep||[]).length ? 'thinKeep: hand keep list' : 'thinKeep: no keep list');\n"
            + "  _hit((THIN.drop||[]).length ? 'thinKeep: hand drop list' : 'thinKeep: no drop list');" },
  ],
  labels: [
    'parseFamilies: array form',
    'parseFamilies: {routes:[…]} form',
    'parseFamilies: family of one, skipped',
    'aliasColours: member recoloured',
    'aliasColours: member not in palette',
    'rung 1: internalCorridors declared',
    'rung 1: absent (laneKey is identity)',
    'rung 3: corridorPalette declared',
    'rung 3: absent',
    'rung 2: coreBox object',
    'rung 2: coreBox true (all defaults)',
    'rung 2: absent',
    'rung 2b: stopThinning object',
    'rung 2b: stopThinning true (all defaults)',
    'rung 2b: absent',
    'coreBox: projecting the box',
    'coreBox: no box to project',
    'coreBox: anchor located',
    'coreBox: REFUSED — anchor has no coordinate',
    'coreBox: width overridden',
    'coreBox: width from radius',
    'coreBox: height overridden',
    'coreBox: height from radius',
    'coreBox: re-centred by hand (at)',
    'coreBox: centred on the anchor',
    'coreBox: minRun overridden',
    'coreBox: minRun default 2.5',
    'clipOutCore: splitting a line at the box',
    'clipOutCore: pass-through',
    'thinKeep: thinning',
    'thinKeep: every stop keeps its tick',
    'thinKeep: minLines overridden',
    'thinKeep: minLines default 2',
    'thinKeep: termini always kept',
    'thinKeep: termini NOT kept',
    'thinKeep: hand keep list',
    'thinKeep: no keep list',
    'thinKeep: hand drop list',
    'thinKeep: no drop list',
  ],
};
