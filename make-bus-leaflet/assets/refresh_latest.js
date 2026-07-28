// refresh_latest.js — copy a town's newest key deliverables into <townDir>/_latest/
// so nobody has to dig through the dated S1–S6 stage folders for them (Peter's
// ask 2026-07-20, item 9). Chosen mechanism: a _latest\ folder of COPIES
// (robust — never a broken link, survives moving/zipping the town folder),
// refreshed on every build. Run as the final step after S5 (and after S6/diagram
// if present):   node refresh_latest.js "<townDir>"
// Copies (whichever exist): internal.jpg, external.jpg, internal-schematic.jpg,
// internal-diagram.jpg from
// the latest S5 render; the newest disagreements.docx and verification.docx found
// anywhere under the town folder. Missing items are skipped silently.
const fs = require('fs'), path = require('path');
const TOWN = process.argv[2] || process.cwd();
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

const s5 = latestS5();
for (const img of ['internal.jpg', 'external.jpg', 'internal-schematic.jpg', 'internal-diagram.jpg'])
  grab(s5 ? path.join(s5, img) : null, img);
grab(newestUnder('disagreements.docx'), 'disagreements.docx');
grab(newestUnder('verification.docx'), 'verification.docx');

console.log('_latest refreshed: ' + copied.join(', ') + (missing.length ? '  (skipped: ' + missing.join(', ') + ')' : ''));
