// gate_lib.js — shared byte-identical-gate machinery for status.js and rollout.js.
//
// Reproduces exactly what gate.sh / references/changing-the-engine.md describe by
// hand: copy a data dir's *.json + icons.js + a candidate generator into a temp
// workspace, run the generator with cwd = that workspace (so LEAFLET_DIR || cwd
// resolves there), diff the SVG it writes against a committed reference.
//
// Zero dependencies (Node core only), matching stage.js's convention.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SK = __dirname; // …/make-bus-leaflet/assets

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
}
function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}
function copyJsonsAndIcons(dataDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(dataDir)) {
    const p = path.join(dataDir, name);
    if (fs.statSync(p).isDirectory()) continue;
    if (name.endsWith('.json')) fs.copyFileSync(p, path.join(destDir, name));
  }
  const icons = path.join(SK, 'icons.js');
  if (fs.existsSync(icons)) fs.copyFileSync(icons, path.join(destDir, 'icons.js'));
}

// Run `genPath` (a generator script — gen_internal.js / gen_external_*.js /
// schematize_internal.js / diagram_internal.js) against dataDir's json inputs,
// in a clean temp workspace, with no overrides and no LEAFLET_DIR inherited.
// Returns { ok, tmpDir, stderr }.
function runGenerator(genPath, dataDir, { extraEnv = {} } = {}) {
  const tmp = mkTmp();
  copyJsonsAndIcons(dataDir, tmp);
  const destGen = path.join(tmp, path.basename(genPath));
  fs.copyFileSync(genPath, destGen);
  const env = { ...process.env, SKILL_ASSETS: SK };
  delete env.LEAFLET_DIR;
  delete env.OVERRIDES_FILE;
  delete env.EDITOR_KEYS;
  Object.assign(env, extraEnv);
  const res = spawnSync(process.execPath, [destGen], { cwd: tmp, env, encoding: 'utf8' });
  return { ok: res.status === 0, tmpDir: tmp, stderr: res.stderr || '', stdout: res.stdout || '' };
}

// Extract the sorted, de-duplicated set of <text>…</text> contents from an
// SVG string — for the migration-time "did any label appear/disappear"
// check (rollout.js), not for the pass/fail gate itself (see diffSvg).
function labelSet(svg) {
  const out = new Set();
  const re = />([^<>]*)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) out.add(m[1]);
  return [...out].sort();
}

// The generators emit one SVG element per line (writeFileSync of a big
// template-literal string), so a line-based comparison is what
// references/changing-the-engine.md itself uses for the byte-identical gate
// and the label-set check — reproduce that here instead of a markup-aware
// diff, which is fragile to nested-tspan structure differences that carry no
// visual meaning.
//
// `ignoreLineRe` (optional) drops lines matching it from both sides before
// comparing — used for the place-fixture's two legitimate diffs (title text,
// "· Map v…" stamp), which always sit on y="16"/y="208".
function diffSvg(pathA, pathB, { ignoreLineRe = null } = {}) {
  if (!fs.existsSync(pathA)) return { same: false, reason: 'missing:' + pathA };
  if (!fs.existsSync(pathB)) return { same: false, reason: 'missing:' + pathB };
  let linesA = fs.readFileSync(pathA, 'utf8').split('\n');
  let linesB = fs.readFileSync(pathB, 'utf8').split('\n');
  if (ignoreLineRe) {
    linesA = linesA.filter(l => !ignoreLineRe.test(l));
    linesB = linesB.filter(l => !ignoreLineRe.test(l));
  }
  if (linesA.join('\n') === linesB.join('\n')) return { same: true, filtered: !!ignoreLineRe };
  const max = Math.max(linesA.length, linesB.length);
  const diffs = [];
  for (let i = 0; i < max && diffs.length < 12; i++) {
    if (linesA[i] !== linesB[i]) diffs.push({ line: i + 1, a: linesA[i], b: linesB[i] });
  }
  return { same: false, lineCountA: linesA.length, lineCountB: linesB.length, diffs };
}

// Composite gate: run genPath against dataDir, diff the file it writes
// (outName, e.g. "internal.svg") against committedPath. Cleans up the temp
// workspace on PASS; leaves it on DIFF/FAIL so it can be inspected.
function gate(genPath, dataDir, outName, committedPath, opts = {}) {
  if (!fs.existsSync(genPath)) return { status: 'SKIP', detail: 'generator not found: ' + genPath };
  const run = runGenerator(genPath, dataDir, opts);
  const outPath = path.join(run.tmpDir, outName);
  if (!run.ok || !fs.existsSync(outPath)) {
    return { status: 'FAIL', detail: (run.stderr || 'no output produced').trim().split('\n').slice(0, 5).join(' / '), tmpDir: run.tmpDir };
  }
  const d = diffSvg(outPath, committedPath, opts);
  if (d.same) { rmTmp(run.tmpDir); return { status: 'PASS', filtered: !!d.filtered }; }
  return { status: 'DIFF', diffs: d.diffs || [], lineCountA: d.lineCountA, lineCountB: d.lineCountB, tmpDir: run.tmpDir };
}

// CRLF-safe byte compare for the portal vendoring drift check (§4 table) — both
// repos store LF but a fresh skills-repo checkout can write CRLF into the
// working tree (core.autocrlf=true, no .gitattributes), which must not read as
// drift. See changing-the-engine.md's caveat on this exact trap.
function sameIgnoringLineEndings(pathA, pathB) {
  if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) return null; // can't compare
  const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  return norm(pathA) === norm(pathB);
}

// ---- shared town/place discovery -------------------------------------------
// A "town" is any Areas/<Name>/manifest.json. A "place" is any
// Areas/<Town>/Places/<Place>/manifest.json. Both share the same S1..S6
// manifest shape (stage.js is generic over it).
function findTowns(busesDir) {
  const areasDir = path.join(busesDir, 'Areas');
  if (!fs.existsSync(areasDir)) return [];
  return fs.readdirSync(areasDir)
    .filter(name => fs.existsSync(path.join(areasDir, name, 'manifest.json')))
    .map(name => ({ name, dir: path.join(areasDir, name) }));
}
function findPlaces(towns) {
  const places = [];
  for (const t of towns) {
    const pd = path.join(t.dir, 'Places');
    if (!fs.existsSync(pd)) continue;
    for (const name of fs.readdirSync(pd)) {
      const dir = path.join(pd, name);
      if (fs.existsSync(path.join(dir, 'manifest.json'))) places.push({ name, town: t.name, dir });
    }
  }
  return places;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function latestRunDir(manifest, townDir, stage) {
  const s = manifest.stages && manifest.stages[stage];
  if (!s || !s.latest) return null;
  const r = s.runs.find(x => x.id === s.latest);
  if (!r) return null;
  let dir = path.join(townDir, r.dir);
  // S4-generate is gitignored (rebuildable bulk); a fresh CI clone won't have
  // it. Fall back to the small tracked ci-reference/ mirror of the latest S4
  // run (see sync_ci_reference.js) — same files, just not the run history.
  // Locally, where the real S4-generate dir exists, this branch never fires.
  if (stage === 'S4' && !fs.existsSync(dir)) {
    const ciRef = path.join(townDir, 'ci-reference');
    if (fs.existsSync(ciRef)) dir = ciRef;
  }
  return { dir, rec: r };
}

// Detect which external generator template (radial vs busway) a town's own S3
// gen_external.js currently plays back as, by trying both against the town's
// own committed external.svg. Used to pick which template to gate/rollout
// with — it does not itself prove the template is current.
function detectExternalStyle(s4Dir) {
  const committed = path.join(s4Dir, 'external.svg');
  if (!fs.existsSync(committed)) return null;
  for (const style of ['radial', 'busway']) {
    const gen = path.join(SK, `gen_external_${style}.js`);
    if (!fs.existsSync(gen)) continue;
    if (gate(gen, s4Dir, 'external.svg', committed).status === 'PASS') return style;
  }
  return 'radial';
}

module.exports = {
  SK, mkTmp, rmTmp, runGenerator, diffSvg, labelSet, gate, sameIgnoringLineEndings,
  findTowns, findPlaces, readJson, latestRunDir, detectExternalStyle,
};
