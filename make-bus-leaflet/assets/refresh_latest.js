// refresh_latest.js — copy a town's (or place's) newest key deliverables into
// <townDir>/_latest/ so nobody has to dig through the dated S1–S6 stage folders
// for them (Peter's ask 2026-07-20, item 9). Chosen mechanism: a _latest\ folder
// of COPIES (robust — never a broken link, survives moving/zipping the town
// folder), refreshed on every build. Run as the final step after S5/P5 (and
// after S6/diagram if present), AND after any in-place edit to an already-
// committed S5/P5 render (a re-rendered JPG inside an existing version folder
// is invisible to everything downstream until this runs):
//   node refresh_latest.js "<townDir-or-placeDir>"
// Works identically for a town dir or a place dir — both map onto the shared
// stage.js S-slots, so "latest S5" means the same thing in either.
// Copies (whichever exist): internal.jpg, external.jpg, internal-schematic.jpg,
// internal-diagram.jpg from
// the latest S5 render; the newest disagreements.docx + disagreements.pdf (the
// customer-facing PDF conversion, see gen_disagreements.py) and verification.docx
// found anywhere under the town folder. Missing items are skipped silently.
// Final step, always: re-runs collect-maps.ps1 -All at the Buses root, so the
// Collected_latests review folders never drift from _latest the way High
// Wycombe Aldi / St Neots Town Centre did on 2026-08-08 (an in-place render
// edit and a skipped refresh, each caught only because Collected_latests was
// stale against the newest S5-render — see project_bus_foolproofing_plan.md).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const TOWN = process.argv[2] || process.cwd();
// REFUSE A FOLDER THAT IS NOT A TOWN OR PLACE. There is no walking up: the dir
// is taken verbatim, so running this from the Buses root with no argument used
// to create a bogus `Buses/_latest` holding whatever disagreements.docx and
// verification.docx happened to be newest ANYWHERE in the tree, print one
// cheerful "refreshed" line, and leave every real town untouched. It looked
// like it had worked. Done on 2026-08-23 and only noticed because `git status`
// showed an untracked folder at the root. A manifest is what makes a folder a
// town or a place, so ask for one.
if (!fs.existsSync(path.join(TOWN, 'manifest.json'))) {
  console.error('refresh_latest: ' + TOWN + ' has no manifest.json, so it is not a town or place folder.');
  console.error('  This refreshes ONE town/place. Pass its folder, or run it from inside one:');
  console.error('    node refresh_latest.js "<townDir-or-placeDir>"');
  process.exit(2);
}
const OUT = path.join(TOWN, '_latest');
fs.mkdirSync(OUT, { recursive: true });

// newest S5 render dir from the manifest (fallback: newest S5-render/* by name)
function latestS5() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(TOWN, 'manifest.json'), 'utf8'));
    const id = m.stages && m.stages.S5 && m.stages.S5.latest;
    if (id) { const d = path.join(TOWN, 'S5-render', id); if (fs.existsSync(d)) return d; }
  } catch (e) {}
  const base = path.join(TOWN, 'S5-render');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter(d => fs.statSync(path.join(base, d)).isDirectory()).sort();
  return dirs.length ? path.join(base, dirs[dirs.length - 1]) : null;
}
// newest file of a given basename anywhere under the town folder (by mtime),
// ignoring the _latest copy itself
function newestUnder(name) {
  let best = null, bestT = -1;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '_latest') walk(p); }
      else if (e.name === name) { const t = fs.statSync(p).mtimeMs; if (t > bestT) { bestT = t; best = p; } }
    }
  })(TOWN);
  return best;
}

const copied = [], missing = [];
const NOW = new Date();
function grab(src, destName) {
  if (src && fs.existsSync(src)) {
    const dest = path.join(OUT, destName);
    fs.copyFileSync(src, dest);
    // Stamp the copy with the refresh time so _latest dates uniformly read
    // "as of this build" (copyFileSync otherwise carries the source's mtime,
    // which looks stale/mismatched next to a just-rebuilt sibling).
    try { fs.utimesSync(dest, NOW, NOW); } catch (e) {}
    copied.push(destName);
  } else missing.push(destName);
}

// The sheet basenames this delivery path knows about. ADDING A SHEET MEANS ADDING
// IT HERE — the list is hardcoded, and nothing warns when it falls behind.
// boarding.jpg was rendered, committed to S5 and verified on 2026-08-22, and still
// did not reach _latest (or Collected_latests, which reads _latest) purely because
// this array had four entries and the engine now makes five. The build said
// nothing; `_latest` simply held one file. Same shape as "merging is not
// deploying": the artefact was correct on disk and nothing downstream knew.
const SHEETS = ['internal.jpg', 'external.jpg', 'internal-schematic.jpg',
                'internal-diagram.jpg', 'boarding.jpg'];
const s5 = latestS5();
for (const img of SHEETS)
  grab(s5 ? path.join(s5, img) : null, img);
grab(newestUnder('disagreements.docx'), 'disagreements.docx');
grab(newestUnder('disagreements.pdf'), 'disagreements.pdf');
grab(newestUnder('verification.docx'), 'verification.docx');

console.log('_latest refreshed: ' + copied.join(', ') + (missing.length ? '  (skipped: ' + missing.join(', ') + ')' : ''));

// Find the Buses root (the ancestor dir holding collect-maps.ps1) by walking
// up from TOWN, then re-run it so Collected_latests never lags _latest.
function findBusesRoot(dir) {
  let cur = path.resolve(dir);
  while (true) {
    if (fs.existsSync(path.join(cur, 'collect-maps.ps1'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}
const busesRoot = findBusesRoot(TOWN);
if (busesRoot) {
  try {
    execFileSync('powershell', ['-File', path.join(busesRoot, 'collect-maps.ps1'), '-All'], { cwd: busesRoot, stdio: 'inherit' });
  } catch (e) {
    console.error('WARNING: collect-maps.ps1 -All failed to run — Collected_latests may now be stale: ' + e.message);
  }
} else {
  console.error('WARNING: could not find collect-maps.ps1 above ' + TOWN + ' — Collected_latests was NOT refreshed.');
}
