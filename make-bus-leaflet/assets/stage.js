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
 *   status                             print a manifest summary
 *   nextver [--bump major|minor]       print the version `new S4` would assign (no side effects)
 */
const fs = require('fs');
const path = require('path');

const STAGE_NAME = { S1: 'services', S2: 'geometry', S3: 'config', S4: 'generate', S5: 'render', S6: 'verify' };
const VERSIONED = new Set(['S4', 'S5']);

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
function copyInto(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, name);
    if (fs.statSync(s).isDirectory()) continue; // outputs are flat files
    fs.copyFileSync(s, path.join(destDir, name));
  }
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
    const st = rest[0]; stage(st);
    let id, dir;
    if (st === 'S4') { const v = computeVersion(m, f.bump === 'major' ? 'major' : 'minor'); id = `v${v}_${ts()}`; }
    else if (st === 'S5') {
      const v = m.stages.S4.latest && m.stages.S4.runs.find(r => r.id === m.stages.S4.latest)?.version;
      if (!v) die('S5 needs a committed S4 build first (no version to inherit)');
      id = `v${v}_${ts()}`;
    } else { id = ts(); }
    dir = path.join(townDir, `${st}-${STAGE_NAME[st]}`, id);
    fs.mkdirSync(dir, { recursive: true });
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
    copyInto(path.join(townDir, r.dir), dest);
    console.log(`pulled ${st} (${r.id}) -> ${dest}`);
    return;
  }

  if (cmd === 'commit') {
    const st = rest[0]; const sx = stage(st);
    const runDir = path.resolve(rest[1] || die('commit needs <runDir>'));
    const id = path.basename(runDir);
    const relDir = path.relative(townDir, runDir).split(path.sep).join('/');
    const outputs = f.outputs ? String(f.outputs).split(',').map(s => s.trim()).filter(Boolean) : [];
    const basedOn = {};
    if (f['based-on']) for (const pair of String(f['based-on']).split(';')) { const [k, v] = pair.split('='); if (k) basedOn[k.trim()] = (v || '').trim(); }
    const rec = { id, dir: relDir, at: isoNow(), outputs };
    if (VERSIONED.has(st)) { const v = id.match(/^v(\d+\.\d+)_/); rec.version = v ? v[1] : null; }
    if (Object.keys(basedOn).length) rec.basedOn = basedOn;
    if (f.note) rec.note = String(f.note);
    sx.runs = sx.runs.filter(r => r.id !== id); // replace if re-committing same dir
    sx.runs.push(rec);
    sx.latest = id;
    saveManifest(townDir, m);
    console.log(`committed ${st} ${id}${rec.version ? ' (v' + rec.version + ')' : ''} — ${outputs.length} output(s)`);
    return;
  }

  if (cmd === 'status') {
    console.log(`Town: ${m.town}   (manifest: ${path.join(townDir, 'manifest.json')})`);
    for (const k of Object.keys(STAGE_NAME)) {
      const s = m.stages[k];
      const n = s.runs.length;
      const latest = s.latest || '(none)';
      console.log(`  ${k} ${s.name.padEnd(9)} latest=${latest}${n ? `  [${n} run(s)]` : '  [no runs]'}`);
    }
    return;
  }

  die('unknown command "' + (cmd || '') + '" — see header for usage');
}
main();
