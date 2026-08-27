/*
 * Branch-coverage spec for services_panel.js — which of the panel's forks the
 * twenty committed maps actually take, measured by INSTRUMENTING the module and
 * rendering every one of them, never by reading routes.json.
 *
 *   node tools/branch-coverage.js tools/branch-coverage.services_panel.js
 *
 * Run from `make-bus-leaflet/`, no placeholders. Written 2026-08-27 with
 * extraction 9; its answer is in the phase's write-up in
 * `Development Docs/refactor-scope_2026-08-27.md`. A spec whose anchors have
 * drifted aborts rather than lying, so re-running it is the check.
 *
 * The four list layouts are mutually exclusive and every map takes exactly one,
 * so their four counts must sum to the number of maps that draw a panel at all.
 */
'use strict';

module.exports = {
  module: 'services_panel.js',
  generator: 'gen_internal.js',
  sheet: 'internal.svg',
  marks: [
    // ---- the type scale, and which of the four list layouts draws the list ----
    { find: '  const PS = PANEL_SCALE_ON ?',
      insert: "  _hit(PANEL_SCALE_ON ? 'panelScale: ON' : 'panelScale: off (hand-tuned sizes)');" },

    { find: '  if(PCORR){',
      insert: "  _hit(PCORR ? 'layout: panelCorridors' : (RJ.panelGroups ? 'layout: panelGroups'\n"
            + "        : (PCOLS ? 'layout: panelCols' : 'layout: plain single column')));" },

    // ---- a service badged in the panel with no line on the map ----
    { find: '  for(const r of NOT_DRAWN)',
      insert: "  _hit(NOT_DRAWN.size ? 'notDrawn: at least one badged service draws no line' : 'notDrawn: none');" },

    { find: '    const avail = (297-PRINT_SAFE) - x;',
      insert: "    _hit('panelSub: appending a not-shown note');" },

    // ---- subFit: the width discipline ----
    { find: '    if(x + w <= right) return size;',
      insert: "    _hit(x + FONT.textWidth(sub, size, false) <= right ? 'subFit: fits as set' : 'subFit: must shrink');" },

    { find: '    if(want >= 2.4) return Math.floor(want*100)/100;',
      insert: "    _hit(want >= 2.4 ? 'subFit: shrunk above the 2.4mm floor' : 'subFit: BELOW the print floor');" },

    // ---- inside panelCorridors ----
    { find: '      const stacked = L.mem.length>1;',
      insert: "      _hit(L.mem.length>1 ? 'corridor row: stacked (several services)' : 'corridor row: single service');" },

    { find: '    if(RJ.corridorNote!==false){',
      insert: "    _hit(RJ.corridorNote===false ? 'corridorNote: suppressed'\n"
            + "      : (RJ.corridorNote ? 'corridorNote: town wording'\n"
            + "      : (CPAL ? 'corridorNote: default, palette sentence' : 'corridorNote: default, plain sentence')));" },

    // ---- the Key ----
    { find: '  const KEY_COLS = Math.max(1,',
      insert: "  _hit('keyCols: ' + Math.max(1, Math.min(3, (DESIGN.keyCols|0) || 2)) + ' column(s)');" },

    { find: "  if(pois.some(p=>p.cat==='allotments'))",
      insert: "  _hit(pois.some(p=>p.cat==='allotments') ? 'key: allotments row' : 'key: no allotments row');" },

    { find: '  if(PCOLS&&PCOLS.keyAt){',
      insert: "  _hit(PCOLS&&PCOLS.keyAt ? 'key: pinned by panelCols.keyAt' : 'key: follows the list');" },

    { find: '    if(!FTIER || !FOOTER_SAFE) return KROW;',
      insert: "    _hit(!FTIER ? 'KROW_FIT: no frequency tiers, pitch unchanged'\n"
            + "      : (!FOOTER_SAFE ? 'KROW_FIT: footerSafe off, pitch unchanged' : 'KROW_FIT: measured against the plate'));" },

    { find: '    if(last <= room) return KROW;',
      insert: "    _hit(last <= room ? 'KROW_FIT: clears the plate as it is' : 'KROW_FIT: COMPRESSED to clear the plate');" },

    { find: '  if(FTIER){',
      insert: "  _hit(FTIER ? 'tiers: line-weight rows drawn' : 'tiers: none');" },

    { find: '  if(RJ.fareNote){',
      insert: "  _hit(RJ.fareNote ? 'fareNote: drawn' : 'fareNote: absent');" },
  ],
  labels: [
    'panelScale: ON',
    'panelScale: off (hand-tuned sizes)',
    'layout: panelCorridors',
    'layout: panelGroups',
    'layout: panelCols',
    'layout: plain single column',
    'notDrawn: at least one badged service draws no line',
    'notDrawn: none',
    'panelSub: appending a not-shown note',
    'subFit: fits as set',
    'subFit: must shrink',
    'subFit: shrunk above the 2.4mm floor',
    'subFit: BELOW the print floor',
    'corridor row: stacked (several services)',
    'corridor row: single service',
    'corridorNote: suppressed',
    'corridorNote: town wording',
    'corridorNote: default, palette sentence',
    'corridorNote: default, plain sentence',
    'keyCols: 1 column(s)',
    'keyCols: 2 column(s)',
    'keyCols: 3 column(s)',
    'key: allotments row',
    'key: no allotments row',
    'key: pinned by panelCols.keyAt',
    'key: follows the list',
    'KROW_FIT: no frequency tiers, pitch unchanged',
    'KROW_FIT: footerSafe off, pitch unchanged',
    'KROW_FIT: measured against the plate',
    'KROW_FIT: clears the plate as it is',
    'KROW_FIT: COMPRESSED to clear the plate',
    'tiers: line-weight rows drawn',
    'tiers: none',
    'fareNote: drawn',
    'fareNote: absent',
  ],
};
