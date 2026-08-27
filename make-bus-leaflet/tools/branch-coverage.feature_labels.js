/*
 * Branch-coverage spec for feature_labels.js — which of the four guards do the
 * committed maps actually trip?
 *
 *   node tools/branch-coverage.js tools/branch-coverage.feature_labels.js
 *
 * Run from `make-bus-leaflet/`, no placeholders. The guards exist BECAUSE they
 * each caught something shipped — a river name struck across the Services panel,
 * six labels under the footer plate, seven stranded from the ink they name — so a
 * row reading zero here is the guard doing its job on a board that has since been
 * fixed, not a branch nobody needs. Re-run rather than trusting a number written
 * here; what matters is which rows move when a town's labelPos changes.
 */
'use strict';

module.exports = {
  module: 'feature_labels.js',
  generator: 'gen_internal.js',
  sheet: 'internal.svg',
  marks: [
    { find: '    if(ov.hide || lov.hide || !f.labelPos) return;',
      insert: "    _hit(ov.hide ? 'skip: feature hidden by override'\n"
            + "       : (lov.hide ? 'skip: label hidden by override'\n"
            + "       : (!f.labelPos ? 'skip: no labelPos at all' : 'label: has a position')));" },

    { find: '    if(isAuto(f)){',
      insert: "    _hit(isAuto(f) ? 'auto: solved by the auto placer' : 'manual: labelPos {x,y}');\n"
            + "    if(isAuto(f)) _hit(autoPos[f.key] ? 'auto: the search found a spot' : 'auto: the search found NOWHERE');" },

    { find: '    if(lov.pos){ x=lov.pos.x; y=lov.pos.y; } else if(lov.offset){ x+=lov.offset.dx; y+=lov.offset.dy; }',
      insert: "    _hit((ov.move&&(ov.move.dx||ov.move.dy)) ? 'manual: follows the feature nudge' : 'manual: no feature nudge');\n"
            + "    _hit(lov.pos ? 'manual: label position overridden' : (lov.offset ? 'manual: label offset' : 'manual: labelPos as configured'));" },

    { find: '    const text=lov.text!=null?lov.text:f.label;',
      insert: "    _hit(lov.text!=null ? 'manual: label text overridden' : 'manual: label text from features[]');" },

    // Each guard is instrumented on its OWN `if`, not on the one below it. The
    // first cut put every hit one guard late — after the `return` it was meant to
    // observe — so all three refusal rows read zero and could never have read
    // anything else. A probe that cannot express the outcome it is counting
    // reports it as absent, which is the same shape as a checker that cannot say
    // "no answer" reporting it as a wrong answer.
    { find: '    if(inCore([x,y])){',
      insert: "    _hit(inCore([x,y]) ? 'GUARD 1: refused — inside the coreBox' : 'guard 1: clear of the coreBox');" },

    { find: '    if(x>MX1+2){',
      insert: "    _hit(x>MX1+2 ? 'GUARD 2: refused — in the Services panel' : 'guard 2: clear of the panel');" },

    { find: '    if(FOOTER_SAFE && y>FOOTER_PLATE_TOP-1.5){',
      insert: "    _hit(!FOOTER_SAFE ? 'guard 3: footerSafe off, not checked'\n"
            + "       : (y>FOOTER_PLATE_TOP-1.5 ? 'GUARD 3: refused — under the footer plate' : 'guard 3: clear of the footer'));" },

    { find: '      const at = p => ',
      insert: "      _hit(!anyInk ? 'GUARD 4: refused — the feature has no geometry at all'\n"
            + "         : (!seen ? 'GUARD 4: refused — all its geometry is clipped away'\n"
            + "         : (best > 25 ? 'GUARD 4: warned — the label is stranded from its ink'\n"
            + "         : 'guard 4: the label sits within 25mm of its ink')));" },

    { find: '    const italic=f.labelItalic!==false, size=f.labelSize||4, anchor=lov.anchor||null;',
      insert: "    _hit(f.labelItalic===false ? 'draw: upright' : 'draw: italic (the default)');\n"
            + "    _hit(f.labelSize ? 'draw: size overridden' : 'draw: size default 4');\n"
            + "    _hit(lov.anchor ? 'draw: anchor overridden' : 'draw: anchor default (start)');\n"
            + "    _hit(f.labelColor ? 'draw: colour overridden' : 'draw: colour default #7fb0d8');" },
  ],
  labels: [
    'label: has a position',
    'skip: feature hidden by override',
    'skip: label hidden by override',
    'skip: no labelPos at all',
    'auto: solved by the auto placer',
    'auto: the search found a spot',
    'auto: the search found NOWHERE',
    'manual: labelPos {x,y}',
    'manual: follows the feature nudge',
    'manual: no feature nudge',
    'manual: label position overridden',
    'manual: label offset',
    'manual: labelPos as configured',
    'manual: label text overridden',
    'manual: label text from features[]',
    'guard 1: clear of the coreBox',
    'GUARD 1: refused — inside the coreBox',
    'guard 2: clear of the panel',
    'GUARD 2: refused — in the Services panel',
    'guard 3: clear of the footer',
    'guard 3: footerSafe off, not checked',
    'GUARD 3: refused — under the footer plate',
    'guard 4: the label sits within 25mm of its ink',
    'GUARD 4: warned — the label is stranded from its ink',
    'GUARD 4: refused — all its geometry is clipped away',
    'GUARD 4: refused — the feature has no geometry at all',
    'draw: italic (the default)',
    'draw: upright',
    'draw: size default 4',
    'draw: size overridden',
    'draw: anchor default (start)',
    'draw: anchor overridden',
    'draw: colour default #7fb0d8',
    'draw: colour overridden',
  ],
};
