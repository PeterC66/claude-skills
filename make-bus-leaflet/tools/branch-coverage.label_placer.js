/*
 * Branch-coverage spec for label_placer.js — v1 against v2, and the ink floor.
 *
 *   node tools/branch-coverage.js tools/branch-coverage.label_placer.js
 *
 * Run from `make-bus-leaflet/`, no placeholders. Written for OA-136's Phase 4
 * verdicts (2026-08-27) to re-measure the claim rather than act on the row: the
 * whole v1 placer is said to be dark, every map running v2, which would leave
 * the eight-candidate greedy search, the manual-offset path, the icon-box
 * relaxation and the give-up return certified by nothing but a unit test.
 *
 * `labels.engine:"v1"` (or `false`) is what selects it. Read the result with the
 * population in mind: this renders `internal.svg` only.
 */
'use strict';

module.exports = {
  module: 'label_placer.js',
  generator: 'gen_internal.js',
  sheet: 'internal.svg',
  marks: [
    // Anchored on the v2 branch's OWN line, not on the statement after it: the
    // insert goes BEFORE the find, and v2 RETURNS from inside the if, so a mark
    // below it is unreachable on every map that runs v2 — which is all of them.
    { find: '    if(LAB){                                     // v2: queue it, solve them all together',
      insert: "    _hit(LAB ? 'v2: queued for the shared solver' : 'V1: placed one at a time');" },

    { find: '    if(!chosen){ return false; }                // give up rather than overlap',
      insert: "    if(!LAB) _hit(chosen ? 'v1: a candidate was found' : 'V1: gave up rather than overlap');" },

    { find: '      const cands=[[x+2.6,y+0.9,\'start\'],[x-2.6,y+0.9,\'end\'],[x,y-2.6,\'middle\'],[x,y+3.6,\'middle\'],',
      insert: "      _hit('v1: the eight-candidate greedy search');" },

    { find: '      if(!chosen && iconBoxes.size){             // nowhere clear of the symbols: fall back to',
      insert: "      _hit(chosen ? 'v1: cleared the icons first time' : (iconBoxes.size ? 'V1: relaxed to ignore the icon boxes' : 'V1: nowhere clear and no icons to relax'));" },

    { find: '    if(lov && lov.offset){                       // manual label placement (skip de-collision)',
      insert: "    _hit((lov && lov.offset) ? 'V1: a manual offset, de-collision skipped' : 'v1: solved rather than placed by hand');" },

    { find: '    for(let i=0; i<40 && 1.05/(_lum(out)+0.05) < floor; i++){ f *= 0.93; out = _scaleHex(hex, f); }',
      insert: "    _hit(1.05/(_lum(out)+0.05) < floor ? 'ink floor: DARKENED to reach the contrast floor' : 'ink floor: already legible, untouched');" },
  ],
  labels: [
    'v2: queued for the shared solver',
    'V1: placed one at a time',
    'v1: the eight-candidate greedy search',
    'v1: solved rather than placed by hand',
    'V1: a manual offset, de-collision skipped',
    'v1: cleared the icons first time',
    'V1: relaxed to ignore the icon boxes',
    'V1: nowhere clear and no icons to relax',
    'v1: a candidate was found',
    'V1: gave up rather than overlap',
    'ink floor: already legible, untouched',
    'ink floor: DARKENED to reach the contrast floor',
  ],
};
