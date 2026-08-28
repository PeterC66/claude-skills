/*
 * Falsification for the laneMirrors measure (OA-118): render every town's
 * internal sheet TWICE — once as shipped (design.laneOrientation defaults on,
 * since 2026-08-27) and once with the key forced false, which is exactly the
 * pre-2026-08-26 behaviour the fix removed — and ask whether the measure can
 * tell the two apart. If it cannot, it is not an instrument.
 *
 * Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` — the engine's own
 * folder, not the buses-data repository. No placeholders; run it exactly as written:
 *
 *   node tools/prove-lane-mirror.js
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. A sheet whose two renders are
 * byte-identical has nothing for the measure to see, and counting that as
 * blindness would libel it — so those are reported separately as `unmoved`.
 * As at 2026-08-28: 18 internal sheets, 15 of which the flip actually moves,
 * and the pair (laneMirrors, laneCrossings) separates the two renders on 11 of
 * them. The 4 it cannot are sheets that draw NO shallow crossing either way —
 * small place maps with no route bundle to mirror. That is the honest residual
 * and it should be re-run, not quoted, after any change to either measure.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../assets/gate_lib.js');
const { analyse } = require('../assets/quality_metrics.js');

const BUSES = 'C:/u3a St Ives/Using AI/Buses';
const GEN = path.join(G.SK, 'gen_internal.js');

function sheets() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (e.name === 'internal.svg' && path.basename(d) === 'ci-reference') out.push(d);
    }
  })(BUSES);
  return out.sort();
}

const rows = [];
for (const dir of sheets()) {
  const name = dir.replace(BUSES + path.sep, '').replace(path.sep + 'ci-reference', '');
  let on, off;
  try {
    const rOn = G.runGenerator(GEN, dir);
    if (!rOn.ok) { rows.push([name, 'GEN-FAIL', '', '']); continue; }
    on = analyse(path.join(rOn.tmpDir, 'internal.svg'));

    // Same pack, one key flipped. Write it into a copy of the data dir.
    const tmp = G.mkTmp();
    for (const f of fs.readdirSync(dir)) {
      if (/\.(json|js)$/.test(f)) fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
    }
    const rj = JSON.parse(fs.readFileSync(path.join(tmp, 'routes.json'), 'utf8'));
    rj.design = Object.assign({}, rj.design, { laneOrientation: false });
    fs.writeFileSync(path.join(tmp, 'routes.json'), JSON.stringify(rj, null, 2));
    const rOff = G.runGenerator(GEN, tmp);
    if (!rOff.ok) { rows.push([name, 'OFF-FAIL', '', '']); continue; }
    // analyse() reads routes.json from the SVG's own folder for the palette;
    // runGenerator copied it there, so the palette is the same either way.
    off = analyse(path.join(rOff.tmpDir, 'internal.svg'));
    // "Absent is not different": a sheet whose two renders are byte-identical has
    // NOTHING for the measure to see, and scoring that as blindness would libel it.
    var svgOn = fs.readFileSync(path.join(rOn.tmpDir, 'internal.svg'), 'utf8');
    var svgOff = fs.readFileSync(path.join(rOff.tmpDir, 'internal.svg'), 'utf8');
    var moved = svgOn !== svgOff;
  } catch (e) { rows.push([name, 'ERR ' + e.message.slice(0, 40), '', '']); continue; }
  rows.push([name, '', `${off.metrics.laneMirrors} -> ${on.metrics.laneMirrors}`,
             `${off.metrics.laneCrossings} -> ${on.metrics.laneCrossings}`,
             !moved ? 'unmoved'
               : (off.metrics.laneMirrors !== on.metrics.laneMirrors
                  || off.metrics.laneCrossings !== on.metrics.laneCrossings) ? 'sees it' : 'BLIND']);
}

const w = [46, 10, 16, 16, 9];
const pad = (s, n) => String(s).padEnd(n);
console.log(['sheet', '', 'mirrors off->on', 'cross off->on', 'verdict'].map((s, i) => pad(s, w[i])).join(''));
for (const r of rows) console.log(r.map((s, i) => pad(s == null ? '' : s, w[i])).join(''));
const seen = rows.filter(r => r[4] === 'sees it').length;
const blind = rows.filter(r => r[4] === 'BLIND').length;
console.log(`\n${seen} sheets where the measure separates the two renders, ${blind} where it cannot.`);
