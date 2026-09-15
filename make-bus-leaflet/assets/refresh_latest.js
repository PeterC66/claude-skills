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
// found anywhere under THIS map's own folder — never under a map nested inside
// it, see newestUnder(). Missing items are skipped silently.
// Final step, always: re-runs collect-maps.ps1 -All at the Buses root, so the
// Collected_latests review folders never drift from _latest the way High
// Wycombe Aldi / St Neots Town Centre did on 2026-08-08 (an in-place render
// edit and a skipped refresh, each caught only because Collected_latests was
// stale against the newest S5-render — see project_bus_foolproofing_plan.md).
//
// --no-collect DOES THE COPY AND SKIPS THAT SWEEP, and it exists for exactly one
// caller: `stage.js commit S6`, which refreshes this map's mirror as part of the
// commit (OA-329 fault A). Three reasons the chokepoint may not run the sweep,
// and the third is the deciding one. It is estate-wide work — collect-maps.ps1
// -All walks all twenty maps — triggered by an event about ONE map. It needs
// `powershell`, so a call from `commit` would make an engine unit test depend on
// a Windows shell, and `commit` is spawned by a dozen of them. And
// `Collected_latests/` is untracked (.gitignore:152), so no gate, no byte and no
// CI run depends on it, while `_latest/verification.docx` IS tracked and IS
// gated — `latest-mirror-gate.js` fails on a mirror that does not match the S6
// run its own manifest names. So the half with a gate behind it moves into the
// boundary and the half with none stays where a person drives it; the skipped
// sweep is PRINTED rather than silent, with the command that does it.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { loadManifest } = require('./stage.js');   // the one manifest reader (OA-232 Tier 2.4)
function main() {   // OA-344: the body is guarded, not re-indented — see test/asset_load.test.js
const ARGV = process.argv.slice(2);
const NO_COLLECT = ARGV.includes('--no-collect');
// The folder is the first NON-FLAG argument, so `<dir> --no-collect` and
// `--no-collect <dir>` both work and a flag can never be mistaken for a town.
const TOWN = ARGV.filter(a => !a.startsWith('--'))[0] || process.cwd();
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
    const m = loadManifest(TOWN);   // loadManifest from stage.js — one reader (OA-232 Tier 2.4)
    const id = m.stages && m.stages.S5 && m.stages.S5.latest;
    if (id) { const d = path.join(TOWN, 'S5-render', id); if (fs.existsSync(d)) return d; }
  } catch (e) {}
  const base = path.join(TOWN, 'S5-render');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter(d => fs.statSync(path.join(base, d)).isDirectory()).sort();
  return dirs.length ? path.join(base, dirs[dirs.length - 1]) : null;
}
// newest file of a given basename anywhere under THIS MAP's folder (by mtime),
// ignoring the _latest copy itself and ignoring any nested map.
//
// A DIRECTORY HOLDING ITS OWN manifest.json IS A DIFFERENT MAP, AND THIS WALK
// MUST NOT DESCEND INTO IT (OA-329 fault B). A town's folder contains
// Places/<Place>/, each of which is a map in its own right, so for a town this
// walk used to consider a PLACE's verification.docx as a candidate for the
// TOWN's mirror — and being newer, it won. It won twice, and both wrong files
// were tracked in git: Beaconsfield's _latest/verification.docx was byte-for-byte
// Beaconsfield Simpson Centre's report, and High Wycombe's was High Wycombe Town
// Centre's — a current, true statement about a DIFFERENT map, sitting in the
// folder a reader opens to find out what was checked about the sheet beside it.
// High Wycombe's mirror reported on a single-stop boarding plan while its
// _latest/internal.jpg was a 34-route town sheet. Nothing could see it: git
// status is clean, every byte gate passes, and status.js reads S6 staleness off
// the manifest and never opens _latest.
//
// "Holds a manifest.json" is the estate's EXISTING definition of a different map
// — it is the same test this file already applies to its own argument above, and
// the one status.js and the map-population sweeps use — so the narrowing agrees
// with every other reader rather than inventing a rule of its own. The check is
// on the CHILD before descending, so the map's own manifest at TOWN never
// excludes TOWN itself, and Places/ (which holds no manifest) is still entered
// so that a place nested one level deeper is skipped individually rather than
// the whole branch being cut off blind.
function newestUnder(name) {
  let best = null, bestT = -1;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '_latest') continue;
        if (fs.existsSync(path.join(p, 'manifest.json'))) continue;   // a different map — OA-329 fault B
        walk(p);
      }
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

// The sheet basenames this delivery path knows about — read from the registry
// since 2026-08-28 (OA-098), not written out here.
//
// This array used to be the list, and it is what the registry exists because of.
// boarding.jpg was rendered, committed to S5 and verified on 2026-08-22, and still
// did not reach _latest (or Collected_latests, which reads _latest) purely because
// it had four entries and the engine had started making five. The build said
// nothing; `_latest` simply held one file fewer, which looks exactly like a map
// with no boarding sheet. Same shape as "merging is not deploying": the artefact
// was correct on disk and nothing downstream knew.
const SHEETS = require('./sheet_registry.js').basenames('jpg');
const s5 = latestS5();
for (const img of SHEETS)
  grab(s5 ? path.join(s5, img) : null, img);
grab(newestUnder('disagreements.docx'), 'disagreements.docx');
grab(newestUnder('disagreements.pdf'), 'disagreements.pdf');
grab(newestUnder('verification.docx'), 'verification.docx');

// SWEEP WHAT THIS RUN DID NOT WRITE. _latest is a folder of copies and nothing
// else writes to it, so any file left over from an earlier build is stale by
// definition — but grab() skips a missing source silently, so the old copy just
// stayed. St Neots Town Centre carried an external.svg from 7 August beside an
// external.jpg from 23 August, and the whole point of a rebase is that every
// _latest describes the build that made it. This also stops the failure mode in
// rollout_places' comment above: a run that drops a sheet entirely used to leave
// _latest mirroring the previous run's copy, so the sheet did not look missing.
const swept = [];
for (const e of fs.readdirSync(OUT, { withFileTypes: true })) {
  if (!e.isFile() || copied.includes(e.name)) continue;
  fs.unlinkSync(path.join(OUT, e.name));
  swept.push(e.name);
}

console.log('_latest refreshed: ' + copied.join(', ') + (missing.length ? '  (skipped: ' + missing.join(', ') + ')' : '') +
            (swept.length ? '  (swept stale: ' + swept.join(', ') + ')' : ''));

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
if (NO_COLLECT) {
  console.log('Collected_latests NOT refreshed (--no-collect). The sweep is one command, from anywhere:'
    + '\n    powershell -File "' + (busesRoot ? path.join(busesRoot, 'collect-maps.ps1') : '<Buses root>\\collect-maps.ps1') + '" -All');
} else if (busesRoot) {
  try {
    execFileSync('powershell', ['-File', path.join(busesRoot, 'collect-maps.ps1'), '-All'], { cwd: busesRoot, stdio: 'inherit' });
  } catch (e) {
    console.error('WARNING: collect-maps.ps1 -All failed to run — Collected_latests may now be stale: ' + e.message);
  }
} else {
  console.error('WARNING: could not find collect-maps.ps1 above ' + TOWN + ' — Collected_latests was NOT refreshed.');
}
}

if (require.main === module) main();
module.exports = { main };
