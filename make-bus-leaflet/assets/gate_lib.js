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
const { sameBytesIgnoringLineEndings } = require('./line_endings');
const { scratchDir } = require('./scratch');

const SK = __dirname; // …/make-bus-leaflet/assets

function mkTmp() {
  return scratchDir('gate-');
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
/* `engineDir` — WHICH ENGINE THE GENERATOR'S DEPENDENCIES COME FROM (OA-214).
 *
 * This used to hardcode `SKILL_ASSETS: SK`, the live assets directory, and that
 * was fine while every caller also took its generator from there. It stopped
 * being fine the moment status.js began gating a held-back town against an OLDER
 * engine: it handed this function `gen_internal.js` from a worktree at that
 * commit, and the generator then resolved labeller.js, footer.js and the rest
 * through SKILL_ASSETS to the CURRENT ones. The result was a HYBRID — an old
 * caller driving a new labeller — which is not the engine that drew the sheet and
 * is not any engine that has ever existed.
 *
 * It was caught because the hybrid disagreed with itself: Wisbech's internal
 * sheet reproduced (its index has fewer candidates than the block holds, so the
 * new labeller's fill change is inert there, and the old caller still passed the
 * old 2.3 mm marker size explicitly) while its SCHEMATIC did not. A PASS from a
 * hybrid engine is worth nothing, and this one was one sheet away from being
 * believed. `engineDir` defaults to `SK`, so every existing caller is unchanged. */
function runGenerator(genPath, dataDir, { extraEnv = {}, overridesFromWorkspace = false, engineDir = SK } = {}) {
  const tmp = mkTmp();
  copyJsonsAndIcons(dataDir, tmp);
  const destGen = path.join(tmp, path.basename(genPath));
  fs.copyFileSync(genPath, destGen);
  const env = { ...process.env, SKILL_ASSETS: engineDir };
  delete env.LEAFLET_DIR;
  delete env.OVERRIDES_FILE;
  delete env.EDITOR_KEYS;
  /* `overridesFromWorkspace` — SET OVERRIDES_FILE THE WAY THE ROLLOUT DOES.
   *
   * Deleting OVERRIDES_FILE above is right for every generator that reads its own
   * cwd: copyJsonsAndIcons has already put the data dir's overrides.json into the
   * workspace, so gen_internal.js finds it there and the gate reproduces the build.
   *
   * schematize_internal.js is the exception, and it is the one that matters here. It
   * writes a NESTED `schematic/` workspace and runs gen_internal.js in that, and its
   * copy list does not include overrides.json — so the forced POIs are silently
   * dropped one level down. rollout_places.js knows this and passes OVERRIDES_FILE
   * explicitly (its own comment at the call site says why); this gate did not, so it
   * regenerated the sheet by a DIFFERENT PROCEDURE FROM THE ONE THAT BUILT THE
   * REFERENCE and would have called the disagreement drift. Measured on High Wycombe
   * Aldi, 2026-08-29: the regenerate lost `Tannery Road Ind Est` and moved two other
   * labels around the hole it left.
   *
   * Set before extraEnv, so a caller that names its own OVERRIDES_FILE still wins.
   * Absent file, absent variable — a place with no overrides.json gates exactly as
   * it did before. */
  if (overridesFromWorkspace) {
    const ovf = path.join(tmp, 'overrides.json');
    if (fs.existsSync(ovf)) env.OVERRIDES_FILE = ovf;
  }
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
//
// design.sheetVersion IS THE SAME KIND OF FACT AND WAS NOT FILTERED, which is
// what made rollout_places.js report a lost label on every rollout it has ever
// run -- it hit all four boarding places on 2026-08-25, and the label it had
// "lost" was `build 2.7 · 24 Aug 2026`, replaced by `build 2.8 · 25 Aug 2026`.
// A stamp that MUST change on every rollout can never be evidence that content
// was dropped. footer.js prints it in four forms (project memory calls them the
// four states of a sheet version) and all four belong here: the development
// `build <n> · <date>`, the portal's `Draft <n> · <date> <time>` and `Preview
// ...`, and the published bare number, which footer.js prefixes with `Map
// version `.
const VERSION_STAMP_RE =
  /^(Valid from .*|Map v[\d.]+(?: · .*)?|Map version v?[\d.]+|(?:build|Draft|Preview) v?[\d.]+(?: · .*)?)$/;

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
/* A LABEL'S IDENTITY IS ITS STRING, AND A RE-WRAP CHANGES THE STRING (OA-171).
 *
 * labelSet() reads <text>…</text> contents, so a label the placer decides to break
 * over two lines is not the same label: `Wood Green Animal Shelter` disappears and
 * `Wood Green` and `Animal Shelter` are there instead. That is a LOST label to the
 * diff, and a lost label stops the rollout.
 *
 * IT HAPPENED, on Godmanchester Co-op Ermine Street in OA-019's round three. The
 * name was on the sheet TWICE already -- once wrapped, once not -- and both copies
 * then wrapped, so nothing left the sheet and no reader lost anything. The net text
 * count was +8, so a count alone would have hidden it; the safety stop is right to
 * compare sets rather than totals. The cost is not the false positive, it is what
 * the false positive teaches: the remedy on offer is --force, and --force disables
 * the check for the whole run, including for the sheet where a loss would be real.
 *
 * WHY NOT THE RULE THE BACKLOG ROW PROPOSED. It said to treat a lost string as
 * benign when its words are accounted for by strings that APPEARED. On this very
 * case nothing appeared: `Wood Green` was already in the old set -- it went from one
 * copy to two, and a SET cannot see that. The rule has to look at what the new sheet
 * CONTAINS, not at what is new in it.
 *
 * THE RULE, AND IT IS DELIBERATELY NARROW. A lost label is a re-wrap only when its
 * text can be rebuilt by concatenating TWO OR MORE labels that are on the new sheet,
 * in order, on word boundaries. `Wood Green` + `Animal Shelter` reconstructs it
 * exactly. A destination that genuinely disappears reconstructs from nothing and is
 * still reported. This is stricter than "the words are all still there somewhere",
 * which would call `High Street` benign on a sheet holding `High Wycombe` and
 * `Green Street`.
 *
 * AND IT IS REPORTED, NOT SWALLOWED. Re-wraps come back in their own array, so the
 * rollout can say what happened instead of going quiet -- a check that hides its
 * reasoning is the next --force habit waiting to start. */
const normLabel = (x) => x.trim().replace(/\s+/g, ' ');

function rewrapOf(lost, newLabels) {
  const words = normLabel(lost).split(' ').filter(Boolean);
  if (words.length < 2) return null;                 // one word cannot be re-wrapped into parts
  const present = new Set(newLabels.map(normLabel));
  /* Segment words[i..] into chunks that are each a label on the new sheet. Longest
   * chunk first, memoised, so `A B` beats `A` + `B` when both are present and the
   * search still backtracks when the greedy choice dead-ends. */
  const memo = new Array(words.length + 1).fill(undefined);
  const seg = (i) => {
    if (i === words.length) return [];
    if (memo[i] !== undefined) return memo[i];
    memo[i] = null;
    for (let j = words.length; j > i; j--) {
      const chunk = words.slice(i, j).join(' ');
      if (!present.has(chunk)) continue;
      const rest = seg(j);
      if (rest) { memo[i] = [chunk, ...rest]; break; }
    }
    return memo[i];
  };
  const parts = seg(0);
  return parts && parts.length >= 2 ? parts : null;
}

function labelDiff(oldSvgPath, newSvgPath) {
  if (!fs.existsSync(oldSvgPath) || !fs.existsSync(newSvgPath)) return { lost: [], gained: [], rewrapped: [] };
  const oldLabels = labelSet(fs.readFileSync(oldSvgPath, 'utf8')).filter(x => !VERSION_STAMP_RE.test(x));
  const newLabels = labelSet(fs.readFileSync(newSvgPath, 'utf8')).filter(x => !VERSION_STAMP_RE.test(x));
  const lost = [], rewrapped = [];
  for (const x of oldLabels) {
    if (newLabels.includes(x)) continue;
    const parts = rewrapOf(x, newLabels);
    if (parts) rewrapped.push({ label: x, as: parts });
    else lost.push(x);
  }
  return {
    lost,
    gained: newLabels.filter(x => !oldLabels.includes(x)),
    rewrapped,
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
//
// COMPARED AS BYTES since 2026-08-28, through the shared line_endings helper.
// It used to read both sides as UTF-8 strings, which decoded every byte that is
// not legal UTF-8 to U+FFFD on BOTH sides — so two vendored files differing only
// in such a byte compared EQUAL and the drift check said "in sync". A narrow
// blind spot, since these are generator sources, but it is the same decode that
// corrupted a real fixture elsewhere the same day, and there is no reason for a
// byte comparison to route through a text decoder.
function sameIgnoringLineEndings(pathA, pathB) {
  if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) return null; // can't compare
  return sameBytesIgnoringLineEndings(fs.readFileSync(pathA), fs.readFileSync(pathB));
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
const { readJson } = require('./cli');   // one implementation, OA-224 Tier 3.1: it names the file in the error
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
  //
  // IT TESTS FOR A FILE, NOT THE FOLDER, and that is the whole point (2026-08-28).
  // The ignore file re-includes a few names from inside an S4 run — README.md,
  // manifest.json, *.docx, and since 2026-08-28 build-warnings.txt. The moment
  // build-warnings.txt started being tracked, every S4 run FOLDER began existing
  // in a fresh clone with one file in it, `fs.existsSync(dir)` became true, this
  // fallback stopped firing, and the byte gate reported FAIL on all twenty maps in
  // CI while passing on every laptop that had the real folders. Nothing in the
  // commit that tracked the file went anywhere near this one. Probing for
  // routes.json — which every real S4 run and every ci-reference has, and which no
  // re-included name will ever be — asks the question the caller actually means:
  // are the inputs here?
  if (stage === 'S4' && !fs.existsSync(path.join(dir, 'routes.json'))) {
    const ciRef = path.join(townDir, 'ci-reference');
    if (fs.existsSync(path.join(ciRef, 'routes.json'))) dir = ciRef;
  }
  return { dir, rec: r };
}

/* IS A SHEET'S STORED DATA WHAT ITS DATA SCRIPT WOULD PRODUCE TODAY? (OA-188)
 *
 * A boarding sheet is drawn by `gen_boarding.js` from two JSON files that are
 * derived, not authored: `boarding_index.json` (from `boarding_index.py`) and
 * `stands.json` (from `naptan_stands.py`). Both live only in the S4 run, and
 * `seedPrevS4` copies them forward, so no rollout has ever re-derived them --
 * every boarding rollout re-ran the generator against an index built by whatever
 * script version happened to be current the day that place was last touched.
 *
 * NOTHING WAS RED, AND THAT IS THE FINDING. The byte gate asks "does the current
 * generator redraw this sheet from its stored data?" and the answer was correctly
 * yes, so `status.js` reported all four boarding sheets PASS and
 * `rollout_places.js` reported all four UP-TO-DATE. The question nobody was asking
 * is "is the stored data what the current SCRIPT would produce?". Measured on
 * 2026-08-30: three of the four carried an index written by boarding_index.py v1.2
 * while the script on disk was v1.3, and 27 destinations across them had trip
 * counts the current script computes differently. Only St Ives was current, and it
 * was the only one with no drift -- the two facts are the same fact.
 *
 * This is the same shape as OA-130 (a delivered map running the generator it was
 * imported with, for ever) but for the DATA half of the pipeline rather than the
 * code half, which is why the byte gate cannot see it: the drift is upstream of
 * the bytes it compares.
 *
 * Each script stamps its output with `generatedBy: "<script>.py v<n.n>"` and
 * declares `SCRIPT_VERSION` at its top, so the claim is already written down at
 * both ends and all this does is ask whether they agree. A file that is absent, a
 * script that is absent, or a stamp in a shape this cannot read is NOT a finding:
 * absent means the place has no boarding plan, and a gate that reddened every
 * place without one would be muted in a week.
 *
 * Returns [] when all is well, or one {file, script, saidBy, current} per
 * disagreement.
 */
const DATA_SCRIPTS = [
  { json: 'boarding_index.json', script: 'boarding_index.py' },
  { json: 'stands.json', script: 'naptan_stands.py' },
];

/** The SCRIPT_VERSION a data script declares, or null if it cannot be read. */
function scriptVersion(scriptPath) {
  if (!fs.existsSync(scriptPath)) return null;
  const m = /^SCRIPT_VERSION\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(scriptPath, 'utf8'));
  return m ? m[1] : null;
}

/* AND WHICH FEED DID IT COUNT? (OA-210)
 *
 * dataScriptDrift() above versions the derivation SCRIPT and gates on it, which
 * is the right first cut and is exactly half the question. The other half is the
 * DATA. `region` in a boarding index names a FILE -- `buckinghamshire.sqlite` --
 * and that file is rebuilt in place by every refresh, so the name is stable
 * across the very change that matters.
 *
 * MEASURED, not imagined. On the morning of 2026-08-31 three of the four boarding
 * indexes were built at 05:07 and the Buckinghamshire feed was rebuilt in place at
 * 10:01. High Wycombe High Street was therefore shipping eleven destinations whose
 * trip counts today's feed does not reproduce -- Beaconsfield 830 against 811,
 * London 644 against 590, Loudwater 1141 against 1095, and eight more. Every check
 * in the estate was green and every one of them was right: the byte gates ask
 * whether the current generator redraws the sheet from its stored index, and
 * dataScriptDrift() read v1.3 on both sides because the SCRIPT had not moved. Only
 * the data had.
 *
 * `boarding_index.py` v1.4 records the feed_version it counted, so the claim is
 * written down at both ends and this only asks whether they agree -- the same
 * shape as the version stamp, one level up. An index with no `feed` key, an
 * unreadable feed_info, or a `region` naming no feed file is NOT a finding: it is
 * "cannot tell", and a board that reddened for a fact nobody can act on would be
 * muted in a week. Same rule dataScriptDrift() adopted for an absent `generatedBy`.
 *
 * IT IS REPORTED AND DOES NOT GATE, and that is a decision rather than an
 * omission. Clearing it costs `rollout_places.js --refresh-index --asof <date>`
 * plus a rebuild, so a monthly feed refresh -- which is OA-091 -- would fire this
 * on every boarding place every month. A cell that is red every month by design is
 * the column everyone learns to ignore, and the cadence has to be settled before
 * it can be a gate. Until then it says the true thing loudly and stops there.
 *
 * Returns [] when all is well, or one {file, said, current, region} per
 * disagreement.
 */
function dataFeedDrift(dataDir, busesDir) {
  const jf = path.join(dataDir, 'boarding_index.json');
  if (!fs.existsSync(jf)) return [];                     // no boarding plan here
  let j;
  try { j = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch { return []; }
  const said = j.feed ? String(j.feed) : null;
  if (!said) return [];                                  // written before the stamp existed
  const region = String(j.region || '').replace(/\.sqlite$/i, '');
  if (!region) return [];
  const info = path.join(busesDir, '_gtfs', 'feed_info_' + region + '.json');
  if (!fs.existsSync(info)) return [];                   // cannot ask the question
  let current = null;
  try { current = ((JSON.parse(fs.readFileSync(info, 'utf8')).feed_info) || {}).feed_version || null; } catch { current = null; }
  if (!current) return [];
  return String(current) === said ? [] : [{ file: 'boarding_index.json', said, current: String(current), region }];
}

function dataScriptDrift(s4Dir, assetsDir) {
  const assets = assetsDir || SK;
  const out = [];
  for (const { json, script } of DATA_SCRIPTS) {
    const jf = path.join(s4Dir, json);
    if (!fs.existsSync(jf)) continue;                    // no boarding plan here
    let said = null;
    try {
      const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
      const m = /\sv([\d.]+)\s*$/.exec(String(j.generatedBy || ''));
      said = m ? m[1] : null;
    } catch { said = null; }
    if (!said) continue;                                 // written before the stamp existed
    const current = scriptVersion(path.join(assets, script));
    if (!current) continue;                              // cannot ask the question
    if (said !== current) out.push({ file: json, script, saidBy: said, current });
  }
  return out;
}

/* IS THE LATEST COMMITTED S4 ACTUALLY RENDERED? (OA-198)
 *
 * Both rollout tools commit S4, then render S5 as a separate step, and both have
 * a stop in between: a BLOCKING build warning returns REVIEW-NEEDED after the S4
 * commit and before `stage new S5`. The state that leaves behind is the whole of
 * this row. The manifest advertises the new S4, so `gate()` re-runs the current
 * generator against the sheets stored in it, they reproduce byte-for-byte -- of
 * course they do, that generator drew them -- and every byte gate PASSES. There
 * is no JPG anywhere for the version the board is naming.
 *
 * AND THEN THE FAST PATH BURIES IT. On the next ordinary run, all sheets gate
 * PASS, so the tool returns UP-TO-DATE and skips the place entirely. Nothing
 * fails, nothing is red, and the S4 stays unrendered for ever. `--force` is the
 * only thing that gets past it, because the fast path is the only guard that
 * `!FORCE` disables -- which means the recovery from an unrendered S4 is a flag
 * nobody has a reason to reach for, on a place nothing has reported.
 *
 * The question is asked of the VERSION, not of run ids or of file mtimes: an S5
 * run is stamped with the version of the S4 it pulled, so "some S5 run carries
 * the latest S4's version" is exactly the sentence "that S4 has been rendered",
 * with no ordering assumption and no clock in it.
 *
 * Returns the unrendered version string, or null when all is well. A manifest
 * with no S4 at all returns null: that is a place nothing has ever built, which
 * is a different condition and one the callers already report.
 */
function unrenderedS4(manifest) {
  const stages = (manifest && manifest.stages) || {};
  const s4 = stages.S4;
  if (!s4 || !s4.latest || !Array.isArray(s4.runs)) return null;
  const latest = s4.runs.find(r => r.id === s4.latest);
  if (!latest) return null;
  // A run committed before versions were recorded cannot answer this question, and
  // guessing from the run id would be the reasoning this helper exists to avoid.
  if (latest.version === undefined || latest.version === null) return null;
  const s5runs = (stages.S5 && Array.isArray(stages.S5.runs)) ? stages.S5.runs : [];
  const rendered = s5runs.some(r => String(r.version) === String(latest.version));
  return rendered ? null : String(latest.version);
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
//
// '+' IN FRONT OF THE PATH ADDS THE LEAF (2026-08-30, OA-181). The refusal above
// is right and is unchanged for every path without it; what it also refused was
// adding a key the engine has only just learned to read. `mapNotes[]` is an
// array, so --set and --patch cannot reach inside it at all and --set-path is the
// only route in — which left `mapNotes.0.w`, the wrap width OA-181 added,
// reachable by nothing but hand-editing a committed S3. Only the LAST segment may
// be created: a typo in the middle of the path is still an error, because a
// mistyped parent is the mistake this guard was written for.
function parseSetPath(s) {
  const create = s.startsWith('+');
  if (create) s = s.slice(1);
  const i = s.indexOf('=');
  if (i < 1) throw new Error("--set-path wants '<dotted.path>=<json>', got: " + s);
  const raw = s.slice(i + 1);
  let value;
  try { value = JSON.parse(raw); } catch (e) { value = raw; }   // bare words/strings are fine
  return { path: s.slice(0, i), value, create };
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
  if (o == null || typeof o !== 'object') throw new Error('--set-path: no such path: ' + spec.path);
  if (!(last in o) && !spec.create) throw new Error('--set-path: no such path: ' + spec.path
    + " \u2014 prefix the expression with '+' if you mean to ADD it");
  if (JSON.stringify(o[last]) === JSON.stringify(spec.value)) return null;
  const was = JSON.stringify(o[last]);
  o[last] = spec.value;
  return spec.path + ': ' + was + ' -> ' + JSON.stringify(spec.value);
}

// The environment a PORTAL FIXTURE is rendered in, in ONE place (2026-08-28,
// OA-132), because status.js gates the fixtures and tools/prove-red-gates.js
// falsifies that gate — and a harness that builds its own copy of the environment
// proves a copy of the gate, not the gate. The two drifted apart the moment they
// were written separately: status.js inherited SKILL_ASSETS from runGenerator,
// which points at the SKILL's assets, so the board ran the portal's entry
// generator against the skill's shared modules and every file in the portal's
// engine/ went unexecuted. Measured by making four of them throw on load: the
// board still said PASS.
//
// SKILL_ASSETS = <portal>/engine is what src/render/renderMap.js passes live, and
// the vendored entry generators resolve a sibling first and SKILL_ASSETS second —
// with the shared modules one level up in engine/ rather than beside them, that
// second arm is the only arm. base-overrides.json is the portal's name for a
// customer's edits, which the shipped sheet was rendered WITH.
function portalFixtureEnv(portalDir, dataDir) {
  const env = { SKILL_ASSETS: path.join(portalDir, 'engine') };
  const baseOverrides = path.join(dataDir, 'base-overrides.json');
  if (fs.existsSync(baseOverrides)) env.OVERRIDES_FILE = baseOverrides;
  return env;
}

module.exports = {
  SK, mkTmp, rmTmp, runGenerator, diffSvg, labelSet, labelDiff, rewrapOf, VERSION_STAMP_RE, PLACE_IGNORE,
  gate, sameIgnoringLineEndings, findTowns, findPlaces, readJson, latestRunDir, unrenderedS4, dataScriptDrift, dataFeedDrift, detectExternalStyle,
  parseSetPath, applySetPath, portalFixtureEnv,
};
