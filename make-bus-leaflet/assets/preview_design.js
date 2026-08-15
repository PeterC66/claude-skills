#!/usr/bin/env node
/*
 * preview_design.js — try a routes.json change across towns WITHOUT committing.
 *
 * The tool that made the design-quality work possible, and the one to reach for
 * before any config or engine change that moves the artwork. For each town it
 * rebuilds every sheet from the latest committed S4 data with a patch applied,
 * measures the shipped sheet and the new one with quality_metrics.js, and reports
 * the defect delta plus which label strings were gained and lost. Writes nothing
 * under Areas/.
 *
 *   node preview_design.js --all --patch '{"design":{"footerSafe":true}}'
 *   node preview_design.js --town "St Ives" --patch '{...}' --render --keep
 *
 * Flags:
 *   --town <name>     repeatable; or --all
 *   --patch <json>    deep-merged into routes.json (objects merge, values replace)
 *   --rail chequer    also set style.rail on every railway feature (an array, so
 *                     --patch cannot reach it)
 *   --feature-pos <key>=<x>,<y>   move a linear feature's LABEL, in page mm.
 *                     Repeatable. features[] is an array too, so --patch cannot
 *                     reach labelPos either.
 *   --set-path <dotted>=<json>    set one value at a dotted path, where a numeric
 *                     segment indexes an array — the general escape hatch for
 *                     anything inside an array. Repeatable, and the same
 *                     expression adopt_config.js takes, so what you preview is
 *                     what you commit:
 *                       --set-path 'internalDiagram.mapNotes.0.y=180'
 *   --unset <path>    dotted path to delete, repeatable (e.g. internalRoads.northArrow)
 *   --render          also write JPGs beside the SVGs
 *   --keep            leave the build workspace on disk and print its path, for
 *                     re-running a generator by hand with DBG_LABELS=1 etc.
 *   --out <dir>       where to put the built sheets (default ./design-preview)
 *
 * TRAP THIS TOOL EXISTS TO AVOID: quality_metrics.js reads the routes.json BESIDE
 * the SVG to get the exact route palette. Without it, isRouteInk() falls back to a
 * stroke-width >= 2.0 rule that misses every 1.7 mm route line, and every ink
 * measure reads far too low — a scratch build measured in a bare folder once
 * reported "labels over route ink" collapsing from 13 to 0, which was pure
 * fiction. This copies routes.json out with the sheets so that cannot happen.
 *
 * Zero dependencies (Node core only). See references/design-quality.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { SK, latestRunDir, readJson, findTowns, detectExternalStyle, parseSetPath, applySetPath } = require(path.join(__dirname, 'gate_lib'));

function parseArgs(argv) {
  const f = { town: [], unset: [], 'feature-pos': [], 'set-path': [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--town') f.town.push(argv[++i]);
    else if (a === '--unset') f.unset.push(argv[++i]);
    else if (a === '--feature-pos') f['feature-pos'].push(argv[++i]);
    else if (a === '--set-path') f['set-path'].push(argv[++i]);
    else if (a.startsWith('--')) f[a.slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
  return f;
}
const args = parseArgs(process.argv.slice(2));
// "<key>=<x>,<y>" -> {key,x,y}
const featurePos = args['feature-pos'].map(s => {
  const m = /^([^=]+)=([-\d.]+),([-\d.]+)$/.exec(s);
  if (!m) { console.error('--feature-pos wants <key>=<x>,<y> in page mm, got: ' + s); process.exit(2); }
  return { key: m[1], x: +m[2], y: +m[3] };
});
let SETPATH;
try { SETPATH = args['set-path'].map(parseSetPath); }
catch (e) { console.error(e.message); process.exit(2); }
const BUSES = path.resolve(args.buses || 'C:/u3a St Ives/Using AI/Buses');
const PATCH = args.patch ? JSON.parse(args.patch) : {};
const OUT = path.resolve(args.out || 'design-preview');
fs.mkdirSync(OUT, { recursive: true });

const deepMerge = (a, b) => {
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
};
function unset(obj, dotted) {
  const parts = dotted.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { o = o && o[parts[i]]; if (!o) return; }
  delete o[parts[parts.length - 1]];
}
function run(script, cwd) {
  const env = { ...process.env, SKILL_ASSETS: SK };
  delete env.LEAFLET_DIR;                      // must run with cwd = the workspace
  return spawnSync(process.execPath, [script], { cwd, env, encoding: 'utf8' });
}
const copy = (src, dst) => { if (fs.existsSync(src)) fs.copyFileSync(src, dst); };

function build(t) {
  const s4 = latestRunDir(readJson(path.join(t.dir, 'manifest.json')), t.dir, 'S4');
  if (!s4) return null;
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-'));
  for (const n of fs.readdirSync(s4.dir)) {
    const p = path.join(s4.dir, n);
    if (!fs.statSync(p).isDirectory() && n.endsWith('.json')) fs.copyFileSync(p, path.join(ws, n));
  }
  const rjPath = path.join(ws, 'routes.json');
  const rj = JSON.parse(fs.readFileSync(rjPath, 'utf8'));
  deepMerge(rj, PATCH);
  if (args.rail) for (const f of (rj.features || [])) if (f.type === 'railway') f.style = Object.assign({}, f.style, { rail: args.rail });
  for (const fp of featurePos) { const f = (rj.features || []).find(x => x.key === fp.key); if (f) f.labelPos = { x: fp.x, y: fp.y }; }
  for (const sp of SETPATH) { try { applySetPath(rj, sp); } catch (e) { console.error('  [' + t.name + '] ' + e.message); } }
  for (const u of args.unset) unset(rj, u);
  fs.writeFileSync(rjPath, JSON.stringify(rj, null, 2));

  copy(path.join(SK, 'gen_internal.js'), path.join(ws, 'gen_internal.js'));
  copy(path.join(SK, `gen_external_${detectExternalStyle(s4.dir)}.js`), path.join(ws, 'gen_external.js'));

  const made = [];
  let r = run(path.join(ws, 'gen_internal.js'), ws);
  if (r.status !== 0) { console.error(t.name + ' gen_internal FAILED:\n' + r.stderr); return { ws, made, s4 }; }
  if (r.stderr.trim()) for (const ln of r.stderr.trim().split('\n')) console.error('  [' + t.name + '] ' + ln);
  made.push('internal.svg');
  if (run(path.join(ws, 'gen_external.js'), ws).status === 0) made.push('external.svg');
  for (const [key, script, out] of [['internalSchematic', 'schematize_internal.js', 'internal-schematic.svg'],
                                    ['internalDiagram', 'diagram_internal.js', 'internal-diagram.svg']]) {
    if (!rj[key]) continue;
    copy(path.join(SK, script), path.join(ws, script));
    const rr = run(path.join(ws, script), ws);
    if (rr.status === 0 && fs.existsSync(path.join(ws, out))) made.push(out);
    else console.error('  [' + t.name + '] ' + script + ' FAILED: ' + (rr.stderr || '').split('\n').slice(-3).join(' '));
  }
  return { ws, made, s4 };
}

const metrics = (files) => {
  const r = spawnSync(process.execPath, [path.join(SK, 'quality_metrics.js'), '--json', ...files],
    { encoding: 'utf8', env: { ...process.env, SKILL_ASSETS: SK }, maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch (e) { return []; }
};
// Version-stamp text is expected to differ on every build and was never a content
// change — the same filter gate_lib's labelDiff() applies.
const labels = (svg) => (fs.readFileSync(svg, 'utf8').match(/>[^<>]*<\/text>/g) || [])
  .map(s => s.slice(1, -7)).filter(s => !/Map v\d/.test(s)).sort();

const towns = findTowns(BUSES);
const chosen = args.all ? towns : towns.filter(t => args.town.includes(t.name));
if (!chosen.length) { console.error('--all, or --town from: ' + towns.map(t => t.name).join(', ')); process.exit(2); }

const rows = [];
for (const t of chosen) {
  process.stderr.write('building ' + t.name + '...\n');
  const b = build(t);
  if (!b) { console.error(t.name + ': no committed S4'); continue; }
  const dest = path.join(OUT, t.name.replace(/[^\w]/g, '_'));
  fs.mkdirSync(dest, { recursive: true });
  for (const n of b.made) fs.copyFileSync(path.join(b.ws, n), path.join(dest, n));
  fs.copyFileSync(path.join(b.ws, 'routes.json'), path.join(dest, 'routes.json'));   // see the trap, above
  const before = metrics(b.made.map(n => path.join(b.s4.dir, n)).filter(fs.existsSync));
  const after = metrics(b.made.map(n => path.join(dest, n)));
  const M = (x) => (x && x.metrics) || {};
  for (const n of b.made) {
    const oldSvg = path.join(b.s4.dir, n);
    const bm = M(before.find(x => path.basename(x.file) === n)), am = M(after.find(x => path.basename(x.file) === n));
    let lost = [], gained = [];
    if (fs.existsSync(oldSvg)) {
      const a = labels(oldSvg), c = labels(path.join(dest, n));
      lost = a.filter(x => !c.includes(x)); gained = c.filter(x => !a.includes(x));
    }
    rows.push({ town: t.name, sheet: n, mb: bm, ma: am, lost, gained });
  }
  if (args.render) for (const n of b.made) {
    spawnSync(process.execPath, [path.join(SK, 'render.js'), path.join(dest, n), path.join(dest, n.replace(/\.svg$/, '.jpg'))], { encoding: 'utf8' });
  }
  if (args.keep) console.error('  workspace: ' + b.ws); else fs.rmSync(b.ws, { recursive: true, force: true });
}

const KEYS = ['pointLabelsOverInk', 'labelLabelCollisions', 'labelIconCollisions', 'iconBlobs',
              'textUnderFooter', 'inkAreaUnderFooterMm2', 'labelsIntoPanel', 'mapLabels'];
const SHORT = { pointLabelsOverInk: 'pt/ink', labelLabelCollisions: 'l/l', labelIconCollisions: 'l/ic',
  iconBlobs: 'blob', textUnderFooter: 'ftxt', inkAreaUnderFooterMm2: 'fmm2', labelsIntoPanel: 'pnl', mapLabels: 'lbls' };
let tb = 0, ta = 0;
console.log('\nsheet'.padEnd(40) + '   DEF     /100   ' + KEYS.map(k => SHORT[k].padStart(11)).join(''));
for (const r of rows) {
  tb += r.mb.defects || 0; ta += r.ma.defects || 0;
  console.log((r.town + ' · ' + r.sheet.replace(/\.svg$/, '')).padEnd(40)
    + (r.mb.defects + '>' + r.ma.defects).padStart(8)
    + (r.mb.defectsPer100 + '>' + r.ma.defectsPer100).padStart(9) + '  '
    + KEYS.map(k => (String(r.mb[k]) + '>' + String(r.ma[k])).padStart(11)).join(''));
  if (r.lost.length) console.log('    LOST: ' + r.lost.join(' | '));
  if (r.gained.length) console.log('    GAINED: ' + r.gained.join(' | '));
}
console.log('TOTAL defects: ' + tb + ' -> ' + ta + '\nsheets in ' + OUT);
