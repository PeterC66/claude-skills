/*
 * Branch-coverage spec for north_arrow.js — how do the committed maps actually
 * place their compass?
 *
 *   node tools/branch-coverage.js tools/branch-coverage.north_arrow.js
 *
 * Run from `make-bus-leaflet/`, no placeholders. MEASURED 2026-08-27, and this is
 * the best-covered module of Phase 3: 12 of the 17 labelled branches are live.
 * Thirteen of the 18 maps have their arrow moved off the configured spot by the
 * blank-space search and five keep it, so the byte gate really does certify the
 * placement. Genuinely dark: the device turned off, the `northArrow:true`
 * shorthand, a hand `len`, and the "no clear spot on the sheet" refusal.
 *
 * READ THE ANGLE ROW WITH CARE — it is the reason this note is longer than the
 * spec. `arrow: angle given` reports zero, and the branch is taken by TWELVE
 * committed sheets: schematize_internal.js and diagram_internal.js inject an
 * explicit angle before re-running this generator, because their coordinates are
 * pre-rotated and run at rotationDeg 0. This probe renders `internal.svg` only,
 * so those twelve are outside its POPULATION, not outside the estate. Dark means
 * "no map in this run took it", and the run is a choice.
 */
'use strict';

module.exports = {
  module: 'north_arrow.js',
  generator: 'gen_internal.js',
  sheet: 'internal.svg',
  marks: [
    { find: '  const LEN = NA.len||8;',
      insert: "  _hit(!(IR && IR.northArrow!==false) ? 'arrow: OFF (no internalRoads, or northArrow:false)'\n"
            + "     : (!IR.northArrow ? 'arrow: ON by default (no northArrow key)'\n"
            + "     : (IR.northArrow===true ? 'arrow: northArrow:true' : 'arrow: northArrow:{…}')));\n"
            + "  _hit(NA.len!=null ? 'arrow: len overridden' : 'arrow: len default 8');\n"
            + "  _hit(NA.angle!=null ? 'arrow: angle given (pre-rotated coords)' : 'arrow: angle derived from theta');\n"
            + "  _hit(NA.x!=null || NA.y!=null ? 'arrow: position configured' : 'arrow: position default 14,150');" },

    { find: '    if(got.auto){',
      insert: "    _hit(got.auto ? 'site: configured spot rejected, placed automatically'\n"
            + "        : (got.x===null ? 'site: NO clear spot on the sheet' : 'site: configured spot kept'));\n"
            + "    if(got.auto) _hit(got.want===null ? 'site: configured spot was off-frame or hard-reserved'\n"
            + "        : 'site: configured spot was covered by ink');" },

    { find: '    const c=Math.cos(ang), s=Math.sin(ang), tx=bx+c*L, ty=by+s*L;',
      insert: "    _hit(at.auto ? 'draw: at an automatic spot' : 'draw: at the configured spot');" },
  ],
  labels: [
    'arrow: OFF (no internalRoads, or northArrow:false)',
    'arrow: ON by default (no northArrow key)',
    'arrow: northArrow:true',
    'arrow: northArrow:{…}',
    'arrow: len default 8',
    'arrow: len overridden',
    'arrow: angle derived from theta',
    'arrow: angle given (pre-rotated coords)',
    'arrow: position default 14,150',
    'arrow: position configured',
    'site: configured spot kept',
    'site: configured spot rejected, placed automatically',
    'site: configured spot was covered by ink',
    'site: configured spot was off-frame or hard-reserved',
    'site: NO clear spot on the sheet',
    'draw: at the configured spot',
    'draw: at an automatic spot',
  ],
};
