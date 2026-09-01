#!/usr/bin/env node
/*
 * stage.js — staging / manifest / versioning helper for make-bus-leaflet.
 *
 * The bus-leaflet build runs in resumable stages, each writing into its own
 * dated subfolder under the town folder, indexed by manifest.json:
 *   S1 services  S2 geometry  S3 config  S4 generate  S5 render  S6 verify
 *
 * S1–S3 and S6 runs are identified by date/time (YYYY-MM-DD_HHMM).
 * S4–S5 runs additionally carry an image version vN.N (dir = v<ver>_<ts>).
 * S6 (verify) is dated, not versioned: it audits the latest S1–S5 outputs with
 * an independent blind red-team pass + structural sanity checks (see
 * references/s6-verify.md). It owns redteam.json, verification.json,
 * verification.docx.
 * Multiple runs of every stage coexist; the manifest's `latest` points at the
 * newest committed run of each stage, so any process can resume from a completed
 * stage by reading the manifest and pulling that stage's outputs.
 *
 * Zero dependencies (Node core only). Run it from anywhere inside the town tree;
 * it finds manifest.json by walking up from the current directory.
 *
 * Commands:
 *   init  <townDir> <"Town Name">      create manifest.json if absent
 *   new   <S1..S6> [--bump major|minor]  create+print the next run dir (abs path)
 *   pull  <S1..S6> [destDir]           copy latest outputs of a stage into destDir (def cwd)
 *   latest <S1..S6>                    print latest run dir (abs) of a stage
 *   commit <S1..S6> <runDir> --outputs a,b,c [--based-on "S2=<id>;S3=<id>"] [--note "..."]
 *         [--tokens <n>]                 record what this stage cost the session
 *         refuses when a declared output is not in <runDir> (--force-missing overrides)
 *         and, for S4, refuses a routes.json carrying no "engine" hash or no
 *         "design.sheetVersion" build stamp (--force-stamps overrides)
 *   stamps [runDir]                    write BOTH S4 provenance stamps into that
 *         run's routes.json — the engine hash and the footer's build stamp — then
 *         re-run the generators so the sheets carry them
 *   status                             print a manifest summary
 *   nextver [--bump major|minor]       print the version `new S4` would assign (no side effects)
 *   stampver [runDir]                  force routes.json "version" to match the run dir's v<N.N>
 *
 * WHAT A STAGE COST (OA-105, 2026-09-01). `new` now writes `pending: {id,
 * startedAt}` onto the stage in manifest.json, and `commit` turns it into
 * `startedAt` and `elapsedMin` on the run record and clears it. Two consequences
 * worth knowing before they surprise you: **`new` now dirties manifest.json**,
 * which it never did before, so a stage started and abandoned leaves one line
 * saying so — which `status` prints as OPEN, and which is true rather than
 * noise; and **a run committed before this landed, or a folder assembled by
 * hand, carries no timing at all**, which reads as "not recorded" and never as
 * zero. `--tokens <n>` records what the CALLER states and nothing estimates a
 * value when it is absent: only the session knows what it spent, and a guessed
 * cost would be indistinguishable from a measured one the moment it was in the
 * file. Both rollouts get the timing for free — they drive `new` and `commit`.
 *
 * THE TWO S4 PROVENANCE STAMPS are separate from the version stamp below and
 * are enforced at `commit` (OA-161): "engine" says which generator drew a map,
 * and "design.sheetVersion" is the `build N.N · date` the footer prints. Both
 * used to be written only by the two rollouts, so a hand-assembled S4 lost both
 * silently — and the byte gate cannot notice, because ci-reference is seeded
 * from the same unstamped run.
 *
 * THE VERSION STAMP (see "version stamp" section below): the version PRINTED ON
 * THE MAP comes from routes.json's "version" field, which is separate from the
 * v<N.N>_<ts> run-dir name. `pull` now keeps them in step automatically and
 * `commit` refuses a mismatch, so a branched build can no longer ship stamped
 * with the previous version.
 */
const fs = require('fs');
const path = require('path');

const STAGE_NAME = { S1: 'services', S2: 'geometry', S3: 'config', S4: 'generate', S5: 'render', S6: 'verify' };
// Stage order, for telling an ordinary downstream copy from a dirty upstream folder.
const ORDER_OF = Object.keys(STAGE_NAME);
const VERSIONED = new Set(['S4', 'S5']);

const { missingStamps, stampSheetVersion } = require('./sheet_stamps');
const { computeEngineVersion, computePlaceEngineVersion, isPlaceRun, stampEngine } = require('./engine_version');

function die(msg) { console.error('stage.js: ' + msg); process.exit(1); }

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
function isoNow() { return new Date().toISOString().slice(0, 16); }

function findTownDir(start) {
  let dir = path.resolve(start || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
function loadManifest(townDir) {
  return JSON.parse(fs.readFileSync(path.join(townDir, 'manifest.json'), 'utf8'));
}
function saveManifest(townDir, m) {
  fs.writeFileSync(path.join(townDir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
}
function emptyStages() {
  const s = {};
  for (const k of Object.keys(STAGE_NAME)) s[k] = { name: STAGE_NAME[k], latest: null, runs: [] };
  return s;
}
// Lazy backfill: manifests created before a stage existed (e.g. S6) miss its
// slot. Add any missing stage in canonical order so older towns can run it.
// Returns true if the manifest was mutated.
function backfillStages(m) {
  if (!m.stages) { m.stages = emptyStages(); return true; }
  let changed = false;
  const ordered = {};
  for (const k of Object.keys(STAGE_NAME)) {
    if (!m.stages[k]) { m.stages[k] = { name: STAGE_NAME[k], latest: null, runs: [] }; changed = true; }
    ordered[k] = m.stages[k];
  }
  m.stages = ordered; // keep canonical S1..S6 order in the written file
  return changed;
}
function parseFlags(args) {
  const f = {}; const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { f[args[i].slice(2)] = (args[i + 1] && !args[i + 1].startsWith('--')) ? args[++i] : true; }
    else rest.push(args[i]);
  }
  return { f, rest };
}
/* AN UNDECLARED FILE MAY NOT CLOBBER ONE ALREADY IN THE DESTINATION (OA-164, 2026-08-29).
 *
 * `pull` copies the whole run FOLDER, while `commit` and the manifest speak only of
 * the outputs a stage DECLARED. Any other file left in a run folder therefore rides
 * along, and whether it does damage depends on nothing but the order the pulls happen
 * to be written in.
 *
 * It fired on 2026-08-29. Beaconsfield Waitrose's S2 folder from 21 July holds a
 * `routes.json` it never declared -- the July draft -- and the documented P3 order is
 * `pull S3` then `pull S2`, so the S2 copy landed on top of five weeks of curated
 * config. The sheet rebuilt clean, gated PASS and lost its intermediate stop names,
 * its journey times, its QR code and its `checkedAt`, because ci-reference is
 * re-synced from the same run and the byte gate compares a build against itself.
 * One place in twelve carries such a file, which is why five earlier rounds missed it.
 *
 * So: a DECLARED output still overwrites, because that is what pulling a stage means.
 * An undeclared extra is still copied when the destination does not already hold that
 * name -- older folders are full of harmless upstream copies and something may rely on
 * them -- but it may no longer overwrite, and every skip is named on stdout. Silence
 * was the whole defect.
 */
function copyInto(srcDir, destDir, declared) {
  fs.mkdirSync(destDir, { recursive: true });
  const shadowed = [];
  for (const name of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, name);
    if (fs.statSync(s).isDirectory()) continue; // outputs are flat files
    const d = path.join(destDir, name);
    if (declared && !declared.has(name) && fs.existsSync(d)) { shadowed.push(name); continue; }
    fs.copyFileSync(s, d);
  }
  return shadowed;
}
function maxVersion(stage) {
  let best = null; // [major, minor]
  for (const r of stage.runs) {
    if (!r.version) continue;
    const [mj, mn] = r.version.split('.').map(Number);
    if (!best || mj > best[0] || (mj === best[0] && mn > best[1])) best = [mj, mn];
  }
  return best;
}
function computeVersion(m, bump) {
  const cur = maxVersion(m.stages.S4);
  if (!cur) return '1.0';                       // first build
  if (bump === 'major') return `${cur[0] + 1}.0`;
  return `${cur[0]}.${cur[1] + 1}`;             // default: minor
}

/* ---------------------------------------------------------------- version stamp
 * The map's version is a data field — routes.json "version", read by
 * gen_internal.js (RJ.version, unless LEAFLET_VERSION overrides) and by
 * gen_external_*.js (D.version). It is NOT PRINTED on the sheet: that was dropped
 * on 2026-08-10, and the generators pass it to footerBand, which ignores it. It is
 * a provenance field, and keeping it in step with the run dir is what stops a
 * branched build being RECORDED under the wrong version. The v<N.N>_<ts> run-dir
 * name is manifest metadata. Nothing tied the two together, so branching a new version from an
 * older routes.json shipped maps stamped with the PREVIOUS version (Beaconsfield
 * v1.1 printed "v1.0"; corrected by hand at the time).
 *
 * The fix lives here, not in a generator: the generators must keep reading a data
 * field (the portal renders from a data folder whose name carries no version, and
 * changing how they read it would alter every town's output). stage.js owns the
 * folder name, so stage.js is what can keep the field honest.
 *
 * Formatting is PRESERVED, never normalised — only the numeric part is rewritten:
 *   towns store "1.1"   ·  places store "v1.0"  ·  a suffix (" · Summer 2026") is possible
 * and the file is edited surgically so the S3 and S4 copies stay byte-comparable.
 */
const VER_DIR_RE = /^v(\d+\.\d+)_/;
const VER_FIELD_RE = /^(v?)(\d+\.\d+)(.*)$/s;

function versionOfRunDir(dir) {
  const m = VER_DIR_RE.exec(path.basename(path.resolve(dir)));
  return m ? m[1] : null;
}

// Set routes.json's "version" numeric part to `want`, keeping any v-prefix/suffix.
// Returns { status, from, to, file }:
//   no-dir-version | no-file | no-field | ok | updated | mismatch (check mode only)
function syncVersionField(runDir, { check = false } = {}) {
  const want = versionOfRunDir(runDir);
  if (!want) return { status: 'no-dir-version' };
  const file = path.join(path.resolve(runDir), 'routes.json');
  if (!fs.existsSync(file)) return { status: 'no-file', want, file };

  const raw = fs.readFileSync(file, 'utf8');
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { die(`routes.json in ${runDir} is not valid JSON — ${e.message}`); }
  const from = obj.version;
  if (from === undefined || from === null || from === '') return { status: 'no-field', want, file };

  const m = VER_FIELD_RE.exec(String(from));
  const to = m ? `${m[1]}${want}${m[3]}` : want;   // unparseable ⇒ replace wholesale
  if (String(from) === to) return { status: 'ok', from, to, want, file };
  if (check) return { status: 'mismatch', from, to, want, file };

  // Surgical replacement of the first "version": "..." pair — keeps the rest of
  // the file byte-for-byte, so a diff against the S3 copy shows only this line.
  const patched = raw.replace(/"version"(\s*):(\s*)"(?:[^"\\]|\\.)*"/, (mm, s1, s2) =>
    `"version"${s1}:${s2}${JSON.stringify(to)}`);
  let ok = false;
  try { ok = JSON.parse(patched).version === to; } catch { ok = false; }
  // Fall back to a full re-serialise if the surgical edit didn't land cleanly.
  fs.writeFileSync(file, ok ? patched : JSON.stringify({ ...obj, version: to }, null, 2) + '\n');
  return { status: 'updated', from, to, want, file };
}

function main() {
  const [cmd, ...rest0] = process.argv.slice(2);
  const { f, rest } = parseFlags(rest0);

  if (cmd === 'init') {
    const townDir = path.resolve(rest[0] || process.cwd());
    const townName = rest[1] || path.basename(townDir);
    fs.mkdirSync(townDir, { recursive: true });
    const mp = path.join(townDir, 'manifest.json');
    if (fs.existsSync(mp)) { console.log('manifest exists: ' + mp); return; }
    saveManifest(townDir, { town: townName, created: isoNow(), stages: emptyStages() });
    console.log('initialised ' + mp);
    return;
  }

  const townDir = findTownDir();
  if (!townDir) die('no manifest.json found above ' + process.cwd() + ' — run `stage.js init` first');
  const m = loadManifest(townDir);
  if (backfillStages(m)) saveManifest(townDir, m); // one-time migration for pre-S6 manifests
  const stage = (s) => { if (!STAGE_NAME[s]) die('unknown stage ' + s + ' (use S1..S6)'); return m.stages[s]; };

  if (cmd === 'nextver') { console.log(computeVersion(m, f.bump === 'major' ? 'major' : 'minor')); return; }

  if (cmd === 'new') {
    const st = rest[0]; const sx = stage(st);
    let id, dir;
    if (st === 'S4') { const v = computeVersion(m, f.bump === 'major' ? 'major' : 'minor'); id = `v${v}_${ts()}`; }
    else if (st === 'S5') {
      const v = m.stages.S4.latest && m.stages.S4.runs.find(r => r.id === m.stages.S4.latest)?.version;
      if (!v) die('S5 needs a committed S4 build first (no version to inherit)');
      id = `v${v}_${ts()}`;
    } else { id = ts(); }
    dir = path.join(townDir, `${st}-${STAGE_NAME[st]}`, id);
    fs.mkdirSync(dir, { recursive: true });
    /* WHAT DID THIS STAGE COST? (OA-105.) Nothing recorded it, and after the fact
     * nothing CAN. The two obvious sources are both wrong: a run folder's mtime
     * moves every time a generator writes into it, and the run ID's timestamp is
     * LOCAL (`ts()`) while `at` is UTC (`isoNow()`), so subtracting one from the
     * other is a daylight-saving bug waiting for a March morning -- on St Ives'
     * 2026-06-05 S1 the id says 1830 and `at` says 17:38, which is eight minutes
     * and looks like minus fifty-two.
     *
     * So the start is written down here, in UTC, in the same shape `at` uses, and
     * `commit` subtracts like from like. It is kept on the STAGE rather than in the
     * run folder because the folder's contents are the build's, not the
     * bookkeeping's -- an extra file there would be swept into the next commit or
     * named by the untracked-sibling hook, and gitignored run folders would lose it
     * entirely. `commit` clears it, and only trusts it when it names THIS run: a
     * stage started, abandoned and started again must not report the first one's
     * clock. An absent or mismatched `pending` records no duration at all, never a
     * guessed one. */
    sx.pending = { id, startedAt: isoNow() };
    saveManifest(townDir, m);
    console.log(dir);   // sole stdout line = absolute path of the new run dir
    return;
  }

  if (cmd === 'latest') {
    const st = rest[0]; const sx = stage(st);
    if (!sx.latest) die('no committed runs for ' + st);
    const r = sx.runs.find(x => x.id === sx.latest);
    console.log(path.join(townDir, r.dir));
    return;
  }

  if (cmd === 'pull') {
    const st = rest[0]; const sx = stage(st);
    if (!sx.latest) die('no committed runs for ' + st + ' to pull');
    const r = sx.runs.find(x => x.id === sx.latest);
    const dest = path.resolve(rest[1] || process.cwd());
    const shadowed = copyInto(path.join(townDir, r.dir), dest, new Set(r.outputs || []));
    console.log(`pulled ${st} (${r.id}) -> ${dest}`);
    /* WHICH SKIPS ARE WORTH SAYING OUT LOUD (narrowed the same day it was written).
     * The guard is right to skip in both directions, but only one of them means the
     * folder is dirty. A DOWNSTREAM folder holding an upstream file is ordinary and
     * everywhere -- every S4 holds the S2 geometry it was built from -- so an S6 pull
     * of S1,S2,S3,S4 printed 28 lines about files S2 had already, correctly, provided.
     * That is exactly how a message stops being read. The interesting case is the one
     * that cost Beaconsfield Waitrose its config: an EARLY stage's folder holding a
     * file a LATER stage declares. The rest is counted, not listed. */
    const owner = (f) => Object.keys(STAGE_NAME).filter((o) => {
      const sx2 = m.stages[o];
      if (!sx2 || !sx2.latest) return false;
      const rr = sx2.runs.find((x) => x.id === sx2.latest);
      return rr && (rr.outputs || []).includes(f);
    });
    const idx = (x) => ORDER_OF.indexOf(x);
    const loud = shadowed.filter((f) => owner(f).some((o) => idx(o) > idx(st)));
    for (const f of loud)
      console.log(`  kept the file already there: ${st}'s folder holds an undeclared "${f}" that a LATER stage declares — go and look at that folder`);
    const quiet = shadowed.length - loud.length;
    if (quiet) console.log(`  (${quiet} undeclared upstream cop${quiet === 1 ? 'y' : 'ies'} in ${st}'s folder left alone; the owning stage had already supplied them)`);
    // Keep the on-map version stamp in step with the run dir it just landed in.
    // Silent when there is nothing to do (unversioned dest, no routes.json, or
    // already correct) — it should only speak when it changed something.
    const sv = syncVersionField(dest);
    if (sv.status === 'updated') console.log(`  version stamp: "${sv.from}" -> "${sv.to}" (from run dir v${sv.want})`);
    else if (sv.status === 'no-field') console.log(`  note: routes.json has no "version" field — the map will print no version stamp`);
    return;
  }

  if (cmd === 'stampver') {
    const dir = path.resolve(rest[0] || process.cwd());
    const sv = syncVersionField(dir);
    if (sv.status === 'no-dir-version') die(`${path.basename(dir)} is not a versioned run dir (expected v<N.N>_<ts>)`);
    if (sv.status === 'no-file') die('no routes.json in ' + dir);
    if (sv.status === 'no-field') die('routes.json has no "version" field to stamp — add one, then re-run');
    console.log(sv.status === 'updated'
      ? `version stamp: "${sv.from}" -> "${sv.to}"`
      : `version stamp already correct ("${sv.to}")`);
    return;
  }

  // The other half of the OA-161 guard: one command that writes both stamps, so
  // the refusal above can name a single thing to run. Deliberately NOT run by
  // `commit` itself — see the guard's comment: by commit time the sheets are
  // drawn, and a silent repair would leave them carrying the old footer while
  // the manifest said otherwise.
  if (cmd === 'stamps') {
    const dir = path.resolve(rest[0] || process.cwd());
    const rjp = path.join(dir, 'routes.json');
    if (!fs.existsSync(rjp)) die('no routes.json in ' + dir);
    // Which template (OA-168): a place map is drawn by generators the town
    // closure does not reach, and `stamps` is the one stamping path that is not
    // already inside a rollout that knows which kind of map it is building. The
    // rule is the one gate_lib.js's findPlaces() enumerates by — a `Places`
    // segment in the path — so the two agree by construction rather than by
    // being kept in step.
    const hash = isPlaceRun(dir) ? computePlaceEngineVersion() : computeEngineVersion();
    const eng = stampEngine(rjp, hash);
    const stamp = stampSheetVersion(rjp, path.basename(dir));
    console.log(`engine: ${eng.status}${eng.from ? ' (was ' + eng.from + ')' : ''} -> ${hash}`);
    if (stamp) console.log(`design.sheetVersion: "${stamp}"`);
    else console.log(`design.sheetVersion: NOT written — "${path.basename(dir)}" is not a versioned run dir (expected v<N.N>_<date>_<time>)`);
    const left = missingStamps(JSON.parse(fs.readFileSync(rjp, 'utf8')));
    if (left.length) die('still missing after stamping: ' + left.join(', '));
    console.log('both stamps present. Re-run the generators so the sheets carry them.');
    return;
  }

  if (cmd === 'commit') {
    const st = rest[0]; const sx = stage(st);
    const runDir = path.resolve(rest[1] || die('commit needs <runDir>'));
    const id = path.basename(runDir);
    const relDir = path.relative(townDir, runDir).split(path.sep).join('/');
    // Guard: a run dir belongs INSIDE the map's own folder, and the manifest
    // records it as a relative path. `path.relative` will cheerfully describe
    // somewhere else — it answers "how do I get there from here" and a `..`
    // chain is a perfectly good answer — so without this, `commit` writes a dir
    // that walks out of the repository and nothing downstream notices.
    //
    // FOUND IN THE DATA, not imagined. High Wycombe Aldi's manifest carried
    //   "dir": "../../../../../Users/Peter/AppData/Local/Programs/Git/v1.1_2026-07-30_0359"
    // for its S5 v1.1 run, written 2026-07-30. That is MSYS path mangling: a
    // bare `/v1.1_2026-07-30_0359` argument in Git Bash is rewritten with the
    // Git install prefix before node ever sees it, so `commit` was handed a real
    // absolute path pointing at the Git installation. One row in 1,654 across
    // all 20 manifests, and inert — every consumer resolves only the `latest`
    // run and this was not it, and prune_runs.py walks the disk rather than the
    // manifest, so nothing was ever steered outside the repo by it.
    //
    // WHY IT CANNOT RECUR THE SAME WAY, and why this guard is still worth having.
    // The OA-106 existence check below would now stop that exact case, because
    // the mangled path does not exist — but it stops it by accident, as a side
    // effect of asking a different question, and only while the bogus path
    // happens to be absent. A runDir that exists and is simply in the wrong place
    // still records a `..`. This asks the question directly.
    if (relDir === '' || relDir === '..' || relDir.startsWith('../') || path.isAbsolute(relDir))
      die(`run dir is outside the map folder: ${runDir}\n`
        + `  recorded as: ${relDir || '(the map folder itself)'}\n`
        + `  A manifest dir must be relative to ${townDir} and stay inside it, like S4-generate/<id>.\n`
        + `  In Git Bash, a leading-slash argument is rewritten with the Git install prefix —\n`
        + `  pass the run dir as a repo path, or prefix with ./ , rather than /<id>.`);
    const outputs = f.outputs ? String(f.outputs).split(',').map(s => s.trim()).filter(Boolean) : [];
    const basedOn = {};
    if (f['based-on']) for (const pair of String(f['based-on']).split(';')) { const [k, v] = pair.split('='); if (k) basedOn[k.trim()] = (v || '').trim(); }
    // Guard (OA-106): never record an output that is not there. `commit` used to
    // take --outputs on trust, so a stage could be committed over an empty folder
    // and the manifest then advertised a version with no map in it — hit for real
    // on 2026-08-21 and again on 2026-08-23. status.js reports the result as
    // MISSING, which detects the symptom after the fact; this refuses to create it.
    // MISSING is still needed and is not superseded: a run folder can also be lost
    // AFTER a good commit, which is exactly what prune_runs.py does by design.
    if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory())
      die(`no such run dir: ${runDir}\n`
        + `  Create it with \`stage.js new ${st}\`, and write the stage's outputs into it, before committing.`);
    const absent = outputs.filter(o => {
      const p = path.join(runDir, o);
      return !fs.existsSync(p) || !fs.statSync(p).isFile();
    });
    if (absent.length && !f['force-missing']) {
      die(`${absent.length} of ${outputs.length} declared output(s) are not in ${id}:\n`
        + absent.map(o => '    ' + o).join('\n') + '\n'
        + `  A manifest that advertises a sheet nobody wrote is worse than no record at all —\n`
        + `  status.js reports it as MISSING and the board fails. Re-run the stage, or name\n`
        + `  only what it actually produced.\n`
        + `  Override with --force-missing only if the absence is deliberate.`);
    }
    if (absent.length) console.log(`  WARNING: recording ${absent.length} output(s) that do not exist (--force-missing): ${absent.join(', ')}`);

    const rec = { id, dir: relDir, at: isoNow(), outputs };

    /* THE COST OF THE STAGE (OA-105). `startedAt` and `at` are both UTC minutes
     * from `isoNow()`, so this subtracts like from like. Recorded only when the
     * pending record names THIS run; otherwise the fields are simply absent, which
     * is the honest answer for every run committed before 2026-09-01 and for any
     * run whose folder was made by hand.
     *
     * TOKENS CANNOT BE MEASURED FROM IN HERE and are not estimated. A stage is
     * driven by a session, and only the session knows what it spent, so `--tokens`
     * records what the caller states and nothing invents a value when it is
     * absent. A number written nowhere is better than a number written wrongly:
     * an estimated cost would be indistinguishable from a measured one the moment
     * it was in the file. */
    const utc = (s) => Date.parse(String(s) + ':00Z');   // isoNow() is 'YYYY-MM-DDTHH:MM', UTC
    const pend = sx.pending;
    if (pend && pend.id === id && pend.startedAt) {
      const from = utc(pend.startedAt), to = utc(rec.at);
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
        rec.startedAt = pend.startedAt;
        rec.elapsedMin = Math.round((to - from) / 60000);
      }
    }
    if (f.tokens != null) {
      const t = Number(String(f.tokens).replace(/[_,]/g, ''));
      if (!Number.isFinite(t) || t < 0) die('--tokens must be a non-negative number; got ' + JSON.stringify(f.tokens));
      rec.tokens = Math.round(t);
    }
    if (VERSIONED.has(st)) { const v = id.match(/^v(\d+\.\d+)_/); rec.version = v ? v[1] : null; }

    // Guard: never record a build whose printed version stamp disagrees with its
    // version. By commit time the SVGs are already drawn, so this is a stop sign,
    // not a repair — fix routes.json and re-run the generators.
    if (VERSIONED.has(st)) {
      const sv = syncVersionField(runDir, { check: true });
      if (sv.status === 'mismatch' && !f['force-version']) {
        die(`version stamp mismatch in ${id}\n`
          + `  routes.json "version" = ${JSON.stringify(sv.from)} but this run is v${sv.want}\n`
          + `  The maps in this folder are stamped ${JSON.stringify(sv.from)} — regenerating them is the fix:\n`
          + `    node "%SK%\\stage.js" stampver "${runDir}"   then re-run the generators (and re-render for S5)\n`
          + `  Override with --force-version only if the stamp is deliberately different.`);
      }
      if (sv.status === 'no-field') console.log(`  note: routes.json has no "version" field — maps carry no version stamp`);
    }

    // Guard (OA-161): an S4 must carry BOTH of its provenance stamps — the
    // `engine` hash that says which generator drew it, and `design.sheetVersion`,
    // the `build N.N · date` the footer prints.
    //
    // WHY THE CHECK IS HERE AND NOT IN A CALLER. `rollout_places.js` and
    // `rollout.js` each stamped both, between seeding and generating. A build
    // assembled BY HAND — `stage.js new S4`, `pull`, then the generators — ran
    // neither, and nothing said so at the time. St Neots Town Centre v2.13
    // shipped on 2026-08-29 with no engine hash and no footer stamp, and was
    // caught only because the NEXT version's label diff came back too clean: the
    // build stamp is a text element and it should have changed between two
    // versions. The stage boundary is the one place every route to an S4 passes
    // through, so it is the only place a check covers the hand-built one too.
    //
    // THE BYTE GATE CANNOT DO THIS JOB. `sync_ci_reference.js` mirrors the S4
    // run into `ci-reference/`, and the gate reproduces the sheet from
    // `ci-reference` and compares — both sides come from the same unstamped
    // inputs, agree exactly, and it goes green. A gate that regenerates an
    // artefact from its own committed inputs can never notice an input missing
    // from both. That is why this is a refusal at a boundary rather than a
    // comparison.
    //
    // A refusal, not a repair: by commit time the SVGs are already drawn, so
    // stamping now would leave the sheets carrying the old footer. Stamp, then
    // re-run the generators.
    if (st === 'S4') {
      const rjp = path.join(runDir, 'routes.json');
      if (fs.existsSync(rjp)) {
        let rj = null;
        try { rj = JSON.parse(fs.readFileSync(rjp, 'utf8')); } catch (e) { rj = null; }
        const miss = rj ? missingStamps(rj) : ['engine', 'design.sheetVersion'];
        if (miss.length && !f['force-stamps']) {
          die(`${miss.length} of the 2 S4 provenance stamps missing from ${id}: ${miss.join(', ')}
`
            + `  "engine" says WHICH generator drew this map; "design.sheetVersion" is the
`
            + `  build stamp the footer prints and the number to quote when a sheet looks wrong.
`
            + `  A sheet with no version at all is the one case that vocabulary cannot describe,
`
            + `  and the byte gate cannot see this because ci-reference is seeded from this run.
`
            + `  Stamp them, then RE-RUN THE GENERATORS (the SVGs already carry the old footer):
`
            + `    node "%SK%\\stage.js" stamps "${runDir}"
`
            + `  Override with --force-stamps only if the absence is deliberate.`);
        }
        if (miss.length) console.log(`  WARNING: committing an S4 with no ${miss.join(' and no ')} (--force-stamps)`);

        /* Guard (OA-206): an S4 must contain every sheet its OWN routes.json asked
         * for. Wisbech's `internalSchematic: true` means the town ships three
         * sheets; `schematize_internal.js` is a separate command, `rollout.js` runs
         * it and a hand-built S4 does not, and on 2026-08-31 v3.1 was assembled,
         * committed and byte-gated with `internal-schematic.svg` simply absent. The
         * only thing that ever said so was `sync_ci_reference.js` reporting a
         * DELETION against the golden master, and only because somebody read it.
         *
         * WHY ONLY THE OPT-IN SHEETS. `sheet_registry.js` calls `internal` and
         * `external` unconditional, and for a town they are — but THREE place maps
         * deliberately ship without them (High Wycombe High Street and Town Centre
         * carry a boarding plan and nothing else, OA-035; St Ives Bus Station has no
         * external radial yet, OA-037). Measured before writing this: requiring the
         * unconditional pair would refuse all three of those maps' next commit for
         * doing exactly what they were designed to do. An opt-in key is a
         * DECLARATION the map itself made, so its absence cannot be a decision — it
         * is the one form of this question with an unambiguous answer, which is the
         * whole of the *deliberately absent, reported as broken* lesson.
         *
         * The byte gate cannot do this job, for the OA-161 reason: `ci-reference/`
         * is seeded from the run, so a sheet missing from both sides agrees.
         */
        if (rj) {
          const { declaredBy } = require('./sheet_registry');
          const placeRun = isPlaceRun(runDir);
          const wanted = declaredBy(rj, 'svg')
            .filter(s => s.optIn)
            .filter(s => s.level === 'both' || s.level === (placeRun ? 'place' : 'area'));
          const gone = wanted.filter(s => !fs.existsSync(path.join(runDir, s.out)));
          if (gone.length && !f['force-missing']) {
            die(`${gone.length} sheet(s) this map ASKED FOR are not in ${id}:\n`
              + gone.map(s => `    ${s.out}   (routes.json "${s.optIn}")`).join('\n') + '\n'
              + `  routes.json declares them, so their absence is a build that fell short rather\n`
              + `  than a design decision. rollout.js runs the extra generator; a hand-built S4\n`
              + `  does not, and nothing downstream reports the gap — the byte gate seeds\n`
              + `  ci-reference from this very run, so both sides agree that the sheet is not there.\n`
              + `  Run the sheet's own generator in ${id}, then commit again:\n`
              + `    node "%SK%\\schematize_internal.js"      (for internal-schematic.svg)\n`
              + `  Override with --force-missing only if the absence is deliberate.`);
          }
          if (gone.length) console.log(`  WARNING: committing an S4 without ${gone.map(s => s.out).join(', ')} (--force-missing)`);
        }

        /* Guard (OA-206, second half): an AREA S4 must carry `build-meta.json`.
         *
         * `gen_internal.js` writes it only when `BUILD_META_DIR` is set, and only
         * `rollout.js` sets it, so a hand-built S4 loses the one record of which way
         * up the sheet was drawn. That is not cosmetic: PCA re-derives the rotation
         * on every build, a route added next month can swing the whole sheet several
         * degrees, and `freeze_orientation.js` reads this file to pin an orientation.
         *
         * THE FIX OA-206 ASKED FOR IS IN THE GENERATOR — write it always — and that
         * is still the right fix. It is not made here because `gen_internal.js` is
         * inside the engine template hash, so editing it marks all eight towns
         * ENGINE STALE and demands an estate-wide rebuild, which today would
         * supersede Wisbech's proposed-update #139 with the customer. This guard is
         * the boundary half, available at no such cost: it cannot create the file,
         * but it stops a build reaching the manifest without one.
         *
         * AND IT CHECKS THE DATE, because presence is not freshness. `seedPrevS4`
         * copies every `.json` from the previous S4 forward, `build-meta.json`
         * included, and `gen_internal.js` overwrites it only when the env var is set
         * — so the carried-forward copy of a build weeks old satisfies a presence
         * test while describing a different rotation. Both dates are written down
         * (the run id carries one, `builtAt` the other), so nothing is inferred. It
         * compares DAYS, and says so: a stale copy made the same day is invisible to
         * it, and claiming otherwise would be the more expensive kind of wrong.
         *
         * PLACES ARE EXCLUDED, and that is structural rather than a let-off: the
         * place engine has no build-meta path at all — `rollout_places.js` contains
         * the string BUILD_META_DIR zero times — so a place without one is not a
         * place that lost anything.
         */
        if (!isPlaceRun(runDir)) {
          const bmp = path.join(runDir, 'build-meta.json');
          const runDay = (id.match(/_(\d{4}-\d{2}-\d{2})_/) || [])[1] || null;
          let why = null;
          if (!fs.existsSync(bmp)) why = 'there is no build-meta.json in this run';
          else if (runDay) {
            let bm = null;
            try { bm = JSON.parse(fs.readFileSync(bmp, 'utf8')); } catch (e) { bm = null; }
            const built = bm && typeof bm.builtAt === 'string' ? bm.builtAt.slice(0, 10) : null;
            if (!built) why = 'build-meta.json has no readable "builtAt"';
            else if (built < runDay) why = `build-meta.json says builtAt ${built}, before this run's own date ${runDay} — it was carried forward by seedPrevS4, not written by this build`;
          }
          if (why && !f['force-meta']) {
            die(`${id} has no orientation record: ${why}\n`
              + `  build-meta.json records the rotation THIS build chose, and PCA re-derives that\n`
              + `  rotation every time — a route added next month can swing the sheet several\n`
              + `  degrees, and this file is how anyone would ever notice. freeze_orientation.js\n`
              + `  reads it to pin a sheet.\n`
              + `  Re-run the internal generator in the run dir with the variable set:\n`
              + `    BUILD_META_DIR="${runDir}" node "%SK%\\gen_internal.js"\n`
              + `  (rollout.js sets it for you; a hand-built S4 has to set it itself.)\n`
              + `  Override with --force-meta only if the absence is deliberate.`);
          }
          if (why) console.log(`  WARNING: committing an area S4 with no orientation record — ${why} (--force-meta)`);
        }
      }
    }
    if (Object.keys(basedOn).length) rec.basedOn = basedOn;
    if (f.note) rec.note = String(f.note);
    sx.runs = sx.runs.filter(r => r.id !== id); // replace if re-committing same dir
    sx.runs.push(rec);
    sx.latest = id;
    // Cleared whether or not it was used: a pending record that outlives its commit
    // would attach this run's clock to the NEXT one committed under the same id.
    if (sx.pending && sx.pending.id === id) delete sx.pending;
    saveManifest(townDir, m);
    const cost = [rec.elapsedMin != null ? rec.elapsedMin + ' min' : null,
      rec.tokens != null ? rec.tokens.toLocaleString('en-GB') + ' tokens' : null].filter(Boolean).join(', ');
    console.log(`committed ${st} ${id}${rec.version ? ' (v' + rec.version + ')' : ''} — ${outputs.length} output(s)${cost ? '  [' + cost + ']' : ''}`);
    return;
  }

  if (cmd === 'status') {
    console.log(`Town: ${m.town}   (manifest: ${path.join(townDir, 'manifest.json')})`);
    for (const k of Object.keys(STAGE_NAME)) {
      const s = m.stages[k];
      const n = s.runs.length;
      const latest = s.latest || '(none)';
      /* WHAT THE LATEST RUN COST (OA-105). Printed only when it is recorded —
       * every run committed before 2026-09-01, and any folder made by hand, has
       * no timing at all, and an absent duration must read as "not recorded"
       * rather than as zero. A stage still open shows its pending clock, which is
       * the one moment the number is actually useful while you wait for it. */
      const r = s.runs.find(x => x.id === s.latest);
      const cost = !r ? [] : [r.elapsedMin != null ? r.elapsedMin + ' min' : null,
        r.tokens != null ? r.tokens.toLocaleString('en-GB') + ' tokens' : null].filter(Boolean);
      console.log(`  ${k} ${s.name.padEnd(9)} latest=${latest}${n ? `  [${n} run(s)]` : '  [no runs]'}`
        + (cost.length ? `  cost ${cost.join(', ')}` : '')
        + (s.pending ? `  OPEN since ${s.pending.startedAt} (${s.pending.id})` : ''));
    }
    return;
  }

  die('unknown command "' + (cmd || '') + '" — see header for usage');
}
main();
