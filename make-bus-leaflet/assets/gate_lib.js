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

// The footer's validity stamp (footer.js) can legitimately change on a data
// refresh (a new `validFrom`) independent of any real content change, so it
// must never itself count as a "lost"/"gained" label. Matches both the
// current "Valid from <date>" format and the pre-2026-08-10 "Map v<N.N> ·
// <date>" format (old archived SVGs / mid-migration diffs still use it).
// Filtered out by labelDiff below.
const VERSION_STAMP_RE = /^(Valid from .*|Map v[\d.]+(?: · .*)?)$/;

// Label-set diff, oriented old->new (matches changing-the-engine.md's
// comm -23/-13 recipe): lost = present in old, gone in new; gained = present
// in new, absent in old. Shared by rollout.js and rollout_places.js so the
// version-stamp exclusion (and any future fix here) only needs to live once.
//
// Bug fixed 2026-08-09: rollout.js used to compute this straight off a
// scratch build whose routes.json came directly from the previous S3 run,
// never having gone through `stage.js pull`'s version-stamp sync (that only
// fires when landing into a NAMED versioned run dir, which a scratch preview
// isn't) — so the scratch build's version stamp was often one release behind
// the real thing, and the diff reported a false-positive LOST/GAINED pair on
// the stamp text alone. Filtering the stamp out here fixes it at the root:
// the label is expected to change on every rollout, so it should never be
// judged as content loss regardless of which version numbers land on which
// side of the diff.
function labelDiff(oldSvgPath, newSvgPath) {
  if (!fs.existsSync(oldSvgPath) || !fs.existsSync(newSvgPath)) return { lost: [], gained: [] };
  const oldLabels = labelSet(fs.readFileSync(oldSvgPath, 'utf8')).filter(x => !VERSION_STAMP_RE.test(x));
  const newLabels = labelSet(fs.readFileSync(newSvgPath, 'utf8')).filter(x => !VERSION_STAMP_RE.test(x));
  return {
    lost: oldLabels.filter(x => !newLabels.includes(x)),
    gained: newLabels.filter(x => !oldLabels.includes(x)),
  };
}

// The place fixtures legitimately differ on exactly two lines — the title
// ("Buses within X" vs "Buses serving X") and the "· Map v…" stamp — because
// build_internal_place(_roads).js/gen_internal_place.js post-edit both after
// running the shared town generator. Shared by status.js and rollout_places.js.
const PLACE_IGNORE = /y="16"|y="208"/;

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
  // NO-SHEET: the generator ran and produced output, and there is NOTHING COMMITTED
  // to compare it against. That is a different fact from DIFF and it used to be
  // reported as one — St Ives Bus Station has no external radial (the solver cannot
  // fan its eight spokes), so its external row read DIFF for ever and was the sole
  // reason `status.js` exited 1 once the vendoring cleared. A board that is
  // permanently red for one known-benign reason is the state a real failure has to
  // be spotted through, which is the whole argument of "a new gate must start green".
  //
  // This function does NOT decide whether that is acceptable — it cannot, because it
  // does not know whether the sheet was never built or has gone missing. It reports
  // the fact and the caller judges it (status.js reads the S4 manifest record).
  // Cleaning the workspace is right here: there is nothing to inspect.
  if (!fs.existsSync(committedPath)) {
    rmTmp(run.tmpDir);
    return { status: 'NO-SHEET', detail: 'nothing committed at ' + committedPath };
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
// A "town" is any Areas/<Name>/manifest.json. A "place" is any manifest.json in one
// of the THREE place layouts (see findPlaces). Both share the same S1..S6 manifest
// shape (stage.js is generic over it).
function findTowns(busesDir) {
  const areasDir = path.join(busesDir, 'Areas');
  if (!fs.existsSync(areasDir)) return [];
  return fs.readdirSync(areasDir)
    .filter(name => fs.existsSync(path.join(areasDir, name, 'manifest.json')))
    .map(name => ({ name, dir: path.join(areasDir, name) }));
}
// A place lives in one of THREE layouts, not one. `Documentation/README - Folder
// structure.md` and `gtfs_places.py` have both said so since 2026-08-02 — a place
// under its town, a place at `Places/<Place>/`, and a place under a bucket such as
// `Places/_standalone/<Place>/` for a place whose surrounding town we do not map.
// This function only ever walked the first, so from 2026-08-21 (when the first
// standalone place was built) Ely Co-op and the two Godmanchester Co-ops were
// invisible to EVERY consumer of it: no byte gate and no quality row in status.js,
// skipped by `rollout_places.js --all`, absent from `adopt_config.js --all-places`,
// and never mirrored into ci-reference. Three shipped maps, ungated — while the
// monthly GTFS scan, which discovers places independently, listed them as live the
// whole time. The two halves of the system disagreed about what a place is.
// Keyed on manifest.json exactly as gtfs_places.py is, excluding the same fixture.
const PLACE_ROOT_EXCLUDE = new Set(['_portal-fixture']);
function findPlaces(towns, busesDir) {
  const places = [];
  const seen = new Set();
  const add = (name, town, dir) => {
    if (seen.has(dir)) return;
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) return;
    seen.add(dir);
    places.push({ name, town, dir, standalone: town == null });
  };
  for (const t of towns) {
    const pd = path.join(t.dir, 'Places');
    if (!fs.existsSync(pd)) continue;
    for (const name of fs.readdirSync(pd)) add(name, t.name, path.join(pd, name));
  }
  // `busesDir` stays optional so an outside caller that passes only `towns` keeps
  // working; every caller in this folder passes it. Derived from a town's own dir
  // as a fallback, since Areas/<Town> and Places/ are siblings.
  const root = busesDir || (towns[0] && path.dirname(path.dirname(towns[0].dir)));
  const pr = root && path.join(root, 'Places');
  if (pr && fs.existsSync(pr)) {
    for (const name of fs.readdirSync(pr)) {
      if (PLACE_ROOT_EXCLUDE.has(name)) continue;
      const dir = path.join(pr, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      // `Places/<Place>/` — a place with no parent area at all.
      add(name, null, dir);
      // `Places/<Bucket>/<Place>/` — the same thing filed under a bucket.
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
        for (const inner of fs.readdirSync(dir)) {
          const idir = path.join(dir, inner);
          if (fs.statSync(idir).isDirectory()) add(inner, null, idir);
        }
      }
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

// --set-path '<dotted>=<json>' — set ONE value in routes.json at a dotted path,
// where a numeric segment indexes an array. The general form of --rail and
// --feature-pos, and the answer to "features[]/mapNotes[] are arrays, which
// --set/--patch cannot reach": shared by adopt_config.js and preview_design.js so
// a config change can always be previewed with the same expression that commits
// it. Refuses to create a missing path — a typo should be an error, not a new key
// nothing reads. Returns a one-line change description, or null for a no-op.
function parseSetPath(s) {
  const i = s.indexOf('=');
  if (i < 1) throw new Error("--set-path wants '<dotted.path>=<json>', got: " + s);
  const raw = s.slice(i + 1);
  let value;
  try { value = JSON.parse(raw); } catch (e) { value = raw; }   // bare words/strings are fine
  return { path: s.slice(0, i), value };
}
function applySetPath(obj, spec) {
  const parts = spec.path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? +parts[i] : parts[i];
    if (o == null || typeof o !== 'object' || !(k in o)) throw new Error('--set-path: no such path: ' + parts.slice(0, i + 1).join('.'));
    o = o[k];
  }
  const last = /^\d+$/.test(parts[parts.length - 1]) ? +parts[parts.length - 1] : parts[parts.length - 1];
  if (o == null || typeof o !== 'object' || !(last in o)) throw new Error('--set-path: no such path: ' + spec.path);
  if (JSON.stringify(o[last]) === JSON.stringify(spec.value)) return null;
  const was = JSON.stringify(o[last]);
  o[last] = spec.value;
  return spec.path + ': ' + was + ' -> ' + JSON.stringify(spec.value);
}

module.exports = {
  SK, mkTmp, rmTmp, runGenerator, diffSvg, labelSet, labelDiff, VERSION_STAMP_RE, PLACE_IGNORE,
  gate, sameIgnoringLineEndings, findTowns, findPlaces, readJson, latestRunDir, detectExternalStyle,
  parseSetPath, applySetPath,
};
