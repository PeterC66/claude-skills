/*
 * lane-census.js — how the lane offsetter is treating every internal sheet on
 * the estate, read off the generator's own DBG_LANES trace rather than off the
 * drawn page. Written for OA-176 4.21 (design.laneRibbon, 2026-09-04), where the
 * defect being repaired — a bundle of routes swapping sides, or a lane stepping
 * in and out for one segment — is one quality_metrics.js cannot see at all.
 *
 * Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` — the engine's own
 * folder, not the buses-data repository:
 *
 *   node tools/lane-census.js --buses "C:/u3a St Ives/Using AI/Buses"
 *   node tools/lane-census.js --buses "C:/u3a St Ives/Using AI/Buses" --ribbon
 *
 * `--buses` names the buses-data root (BUSES_DIR or the laptop default stand in
 * for it). `--ribbon` forces `design.laneRibbon: true` into a scratch copy of
 * each sheet's config, so the two runs are the before and after of that key.
 * `--only <text>` keeps the sheets whose path contains it. `--out <dir>` says
 * where the rendered SVG, its routes.json and the trace go (default: a folder
 * under the system temp dir, named for the variant), so crop_compare.js can be
 * pointed at `<out>/live/<sheet>/internal.svg` and `<out>/ribbon/...`.
 *
 * Every sheet is rendered from its ci-reference/ folder through gate_lib's
 * runGenerator, so the counts are of the committed artwork under the CURRENT
 * engine, and a place sheet gets its overrides the way the gate gives them.
 *
 * WHAT IT COUNTS, per in-frame bundled segment or pair of consecutive ones:
 *   offaxis  — the applied normal is more than 22 degrees off the segment's own
 *              heading: the reference came from a segment that had turned off
 *   mirrorAll — the lane changes side of travel between two consecutive
 *              segments whose headings turn less than a right angle
 *   mirror   — the same, excluding pairs where either normal is off-axis
 *   pinch    — the lane index or the bundle size changes
 *   blip     — the bundle changes for one segment and its neighbours agree
 *   fold     — in-frame vertices the key's second half (OA-176 4.24) moved onto
 *              an earlier leg of the same route: the retrace drawn once. Zero
 *              in a live run unless the sheet has adopted the key
 *
 * READ THE MIRROR COLUMNS WITH THE HEADER'S OWN CAVEAT. `own` in the trace is
 * the heading the offsetter USED, and under the ribbon key that is a heading
 * smoothed over ±1 mm, so a hairpin taken in 0.2 mm steps is a sequence of
 * gentle turns there and one reversal in the live trace. The reversal at a
 * genuine hairpin is excluded by the right-angle test in the live run and
 * counted in the ribbon run — Beaconsfield Simpson Centre went 0 → 13 on this
 * column on 2026-09-04 while its crop got visibly cleaner. The two runs'
 * mirror columns are therefore not like for like; offaxis and blip are, and
 * so are the crops. Judge the key on the artwork, as laneOrientation was.
 *
 * Measured on the day it was written, 18 internal sheets, live → ribbon:
 * offaxis 693 → 25 (22 of them St Ives, which declines the field), blip
 * 160 → 68, pinch 1380 → 1121. Re-run it rather than quoting it.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const G = require('../assets/gate_lib.js');
const { parseArgs, resolveBuses } = require('../assets/cli.js');

const FLAGS = parseArgs(process.argv.slice(2));
const BUSES = resolveBuses(FLAGS);
const FORCE = FLAGS.ribbon === true;
const VAR = typeof FLAGS.tag === 'string' ? FLAGS.tag : (FORCE ? 'ribbon' : 'live');
const ONLY = typeof FLAGS.only === 'string' ? FLAGS.only : null;
const OUT = path.join(typeof FLAGS.out === 'string' ? FLAGS.out : path.join(os.tmpdir(), 'busmaps-lane-census'), VAR);
const CA = Math.cos(22 * Math.PI / 180);
const GEN = path.join(G.SK, 'gen_internal.js');

const dirs = [...new Set(G.findSheets(BUSES)
  .filter(p => path.basename(p) === 'internal.svg')
  .map(p => path.dirname(p)))].sort();

const tot = { offaxis: 0, mirror: 0, mirrorAll: 0, pinch: 0, blip: 0, fold: 0, segs: 0 };
const detail = [];
fs.mkdirSync(OUT, { recursive: true });

for (const dir of dirs) {
  const name = path.relative(BUSES, path.dirname(dir)).split(path.sep).join('/');
  if (ONLY && !name.includes(ONLY)) continue;
  const slug = name.replace(/[^A-Za-z0-9]/g, '_');
  const place = /Places/.test(name);
  let data = dir;
  if (FORCE) {
    data = path.join(OUT, '_forced', slug);
    fs.mkdirSync(data, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) fs.copyFileSync(path.join(dir, f), path.join(data, f));
    const rj = JSON.parse(fs.readFileSync(path.join(data, 'routes.json'), 'utf8'));
    rj.design = rj.design || {}; rj.design.laneRibbon = true;
    fs.writeFileSync(path.join(data, 'routes.json'), JSON.stringify(rj, null, 2));
  }
  const run = G.runGenerator(GEN, data, { extraEnv: { DBG_LANES: '1' }, overridesFromWorkspace: place });
  if (!run.ok) { console.log(`${name.padEnd(52)} FAILED ${run.stderr.slice(-200).replace(/\s+/g, ' ')}`); continue; }
  const sheetDir = path.join(OUT, slug);
  fs.mkdirSync(sheetDir, { recursive: true });
  fs.writeFileSync(path.join(sheetDir, 'lanes.log'), run.stderr);
  fs.copyFileSync(path.join(run.tmpDir, 'internal.svg'), path.join(sheetDir, 'internal.svg'));
  fs.copyFileSync(path.join(data, 'routes.json'), path.join(sheetDir, 'routes.json'));

  const byRoute = {}; const folds = [];
  for (const l of run.stderr.split('\n')) {
    if (l.startsWith('FOLD ') && /\tfr=1$/.test(l)) { folds.push(l.slice(5).replace(/\t/g, ' ')); continue; }
    if (!l.startsWith('LANE ')) continue;
    const parts = l.split('\t'); const r = parts[0].slice(5); const f = { r };
    for (const kv of parts.slice(1)) { const i = kv.indexOf('='); f[kv.slice(0, i)] = kv.slice(i + 1); }
    f.seg = +f.seg; f.k = +f.k; f.fr = f.fr === '1';
    f.nv = f.n.split(',').map(Number); f.ov = f.own.split(',').map(Number);
    f.axis = f.nv[0] * -f.ov[1] + f.nv[1] * f.ov[0];      // normal · perp(own): ±1 on-axis
    f.side = f.axis >= 0 ? 1 : -1; f.off = Math.abs(f.axis) < CA;
    (byRoute[r] = byRoute[r] || []).push(f);
  }
  const c = { offaxis: 0, mirror: 0, mirrorAll: 0, pinch: 0, blip: 0, fold: folds.length, segs: 0 };
  const sites = folds.map(f => 'fold ' + f);
  for (const r in byRoute) {
    const a = byRoute[r].sort((x, y) => x.seg - y.seg);
    for (let i = 0; i < a.length; i++) {
      const f = a[i]; if (!f.fr) continue; c.segs++;
      if (f.off) { c.offaxis++; sites.push(`offaxis ${r} seg${f.seg} @${f.mid} r0=${f.r0} axis=${f.axis.toFixed(2)}`); }
      const p = a[i - 1]; if (!p || p.seg !== f.seg - 1) continue;
      const turn = p.ov[0] * f.ov[0] + p.ov[1] * f.ov[1];
      if (p.side !== f.side && turn > 0) {
        c.mirrorAll++;
        sites.push(`mirrorAll ${r} seg${f.seg} @${f.mid} bundle ${p.bundle}->${f.bundle} sign ${p.r0sign}->${f.r0sign} r0 ${p.r0}->${f.r0}`);
        if (!p.off && !f.off) c.mirror++;
      }
      if (p.k !== f.k || p.bundle.split(',').length !== f.bundle.split(',').length) c.pinch++;
      const q = a[i + 1];
      if (q && q.seg === f.seg + 1 && p.bundle === q.bundle && f.bundle !== p.bundle) {
        c.blip++; sites.push(`blip ${r} seg${f.seg} @${f.mid} ${p.bundle} -> ${f.bundle} -> ${q.bundle}`);
      }
    }
  }
  for (const k in tot) tot[k] += c[k];
  console.log(`${name.padEnd(52)} segs=${c.segs} offaxis=${c.offaxis} mirror=${c.mirror} mirrorAll=${c.mirrorAll} pinch=${c.pinch} blip=${c.blip} fold=${c.fold}`);
  detail.push(`## ${name}\n` + sites.join('\n'));
}
console.log('TOTAL', JSON.stringify(tot));
fs.writeFileSync(path.join(OUT, 'census.txt'), detail.join('\n\n') + '\n');
console.log(`sites: ${path.join(OUT, 'census.txt')}; sheets under ${OUT}`);
