#!/usr/bin/env node
/*
 * adopt_config.js — apply a routes.json change to towns as a new committed S3.
 *
 * The missing half of rollout.js. `rollout.js` re-renders towns onto the current
 * ENGINE and needs no new S3, because routes.json is unchanged. A CONFIG change
 * does need one, and doing it by hand across eight towns is where mistakes live.
 * This makes the S3 run, writes the patched routes.json into it, carries any
 * overrides.json forward and commits it — then you run rollout.js for S4/S5.
 *
 *   node adopt_config.js --all --set '{"design":{"iconInk":"charcoal"}}'
 *   node adopt_config.js --all --unset internalRoads.northArrow --note "..."
 *   node adopt_config.js --town "St Ives" --rail chequer --apply
 *
 * DRY RUN BY DEFAULT — prints what would change per town. Pass --apply to commit.
 *
 * PLACES too, since 2026-08-16 (plan Phase 8 item 4). A place's S3 has exactly the
 * same shape as a town's — `stage.js new/commit S3`, routes.json plus an optional
 * overrides.json — and everything below the target list is target-agnostic, so this
 * is `--place` / `--all-places` reusing the same body rather than a second tool.
 * It exists for the same reason rollout_places.js does: the alternative is
 * hand-editing a committed S3, which this project forbids for good reason.
 *
 * Flags:
 *   --town <name>   repeatable; or --all
 *   --place <name>  repeatable; or --all-places (a place's own name, e.g.
 *                   "High Wycombe Aldi" — not its town's)
 *   --set <json>    deep-merged into routes.json (objects merge, values replace)
 *   --set-file <p>  the same JSON read from a UTF-8 file. USE THIS when the change
 *                   contains an en-dash or a middot: PowerShell mangles non-ASCII
 *                   in argv on the way to node.exe, silently, and this tool commits
 *                   what it is handed.
 *   --unset <path>  dotted path to delete, repeatable
 *   --rail <style>  set style.rail on every railway feature (features[] is an
 *                   array, so --set cannot reach it)
 *   --feature-pos <key>=<x>,<y>   move a linear feature's LABEL, in page mm.
 *                   Repeatable. labelPos lives in that same array, so --set
 *                   cannot reach it either.
 *   --set-path <dotted>=<json>   set one value at a dotted path, where a numeric
 *                   segment indexes an ARRAY. Repeatable. This is the general
 *                   form of --rail/--feature-pos and the escape hatch for
 *                   anything else inside an array that --set cannot express:
 *                     --set-path 'internalDiagram.mapNotes.0.y=180'
 *                     --set-path 'features.1.style={"width":1.4}'
 *                   Refuses to create a missing path, so a typo is an error
 *                   rather than a new key nothing reads. Prefix the whole
 *                   expression with '+' when you DO mean to add the last
 *                   segment — the only way to reach a new key inside an array
 *                   element, and how OA-181 reached mapNotes' new wrap width:
 *                     --set-path '+mapNotes.0.w=110'
 *   --note "..."    the S3 commit note
 *   --apply         actually write and commit
 *
 * THE STEP AFTER THIS ONE NEEDS --force. rollout.js starts by gating the town's
 * previous S4 against the current template and reports UP-TO-DATE if it passes —
 * and it does pass, because that S4 folder still holds the OLD routes.json. The
 * new S3 is invisible to that check. So a config rollout is always:
 *
 *   node adopt_config.js --all --set '{...}' --apply
 *   node rollout.js --all --apply --force --bump minor --note "..."
 *
 * Zero dependencies (Node core only). See references/changing-the-engine.md §2b.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SK, findTowns, findPlaces, readJson, latestRunDir, parseSetPath, applySetPath } = require(path.join(__dirname, 'gate_lib'));

function parseArgs(argv) {
  const f = { town: [], place: [], unset: [], 'feature-pos': [], 'set-path': [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--town') f.town.push(argv[++i]);
    else if (a === '--place') f.place.push(argv[++i]);
    else if (a === '--unset') f.unset.push(argv[++i]);
    else if (a === '--feature-pos') f['feature-pos'].push(argv[++i]);
    else if (a === '--set-path') f['set-path'].push(argv[++i]);
    else if (a.startsWith('--')) f[a.slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  }
  return f;
}
const args = parseArgs(process.argv.slice(2));
const BUSES = path.resolve(args.buses || 'C:/u3a St Ives/Using AI/Buses');
const APPLY = !!args.apply;
/* --set-file <path> — the same JSON, read from a UTF-8 FILE.
 *
 * Use this, not --set, for anything containing an en-dash or a middot — which is
 * nearly every panel string in this system ("Mon–Sat", " · "). PowerShell 5.1
 * converts argv to the system ANSI codepage on its way to node.exe, so those
 * characters arrive corrupted, silently, and this tool commits what it is given
 * straight into a new S3. A file is read as UTF-8 by fs and cannot be mangled.
 * (2026-08-16; the same flag exists on preview_design.js as --patch-file, so what
 * you preview is what you commit.)
 */
const SET = args['set-file'] ? JSON.parse(fs.readFileSync(path.resolve(args['set-file']), 'utf8'))
          : args.set ? JSON.parse(args.set) : null;
// "<key>=<x>,<y>" -> {key,x,y}
const FEATPOS = args['feature-pos'].map(s => {
  const m = /^([^=]+)=([-\d.]+),([-\d.]+)$/.exec(s);
  if (!m) { console.error('--feature-pos wants <key>=<x>,<y> in page mm, got: ' + s); process.exit(2); }
  return { key: m[1], x: +m[2], y: +m[3] };
});
let SETPATH;
try { SETPATH = args['set-path'].map(parseSetPath); }
catch (e) { console.error(e.message); process.exit(2); }

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
  for (let i = 0; i < parts.length - 1; i++) { o = o && o[parts[i]]; if (!o) return false; }
  const last = parts[parts.length - 1];
  if (!(o && last in o)) return false;
  delete o[last]; return true;
}
function stage(cwd, ...a) {
  const r = spawnSync(process.execPath, [path.join(SK, 'stage.js'), ...a], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('stage.js ' + a.join(' ') + ':\n' + (r.stderr || r.stdout));
  return r.stdout.trim();
}

// One list of targets, towns and places together. Everything below this point only
// needs {name, dir}: a place's S3 has the same shape as a town's, so the body is the
// same body. --all is towns only and --all-places is places only, deliberately —
// adopting a key on 8 towns and 5 places in one command is a bigger blast radius than
// anything else this tool does, and the two sets are judged on different sheets.
const allTowns = findTowns(BUSES);
const targets = [
  ...allTowns.filter(t => args.all || args.town.includes(t.name)),
  ...findPlaces(allTowns, BUSES).filter(p => args['all-places'] || args.place.includes(p.name)),
];
if (!targets.length) {
  console.error('--all / --town from: ' + allTowns.map(t => t.name).join(', '));
  console.error('--all-places / --place from: ' + findPlaces(allTowns, BUSES).map(p => p.name).join(', '));
  process.exit(2);
}
if (!SET && !args.unset.length && !args.rail && !FEATPOS.length && !SETPATH.length) { console.error('nothing to do: pass --set, --unset, --rail, --feature-pos or --set-path'); process.exit(2); }

console.log((APPLY ? 'APPLYING' : 'DRY RUN') + ' over ' + targets.length + ' target(s)'
  + (APPLY ? '' : ' (pass --apply to commit)') + '\n');

for (const t of targets) {
  const prev = latestRunDir(readJson(path.join(t.dir, 'manifest.json')), t.dir, 'S3');
  if (!prev) { console.log(t.name + ': no committed S3 to roll forward from'); continue; }
  const before = fs.readFileSync(path.join(prev.dir, 'routes.json'), 'utf8');
  const rj = JSON.parse(before);
  const changes = [];

  if (SET) { const b4 = JSON.stringify(rj); deepMerge(rj, SET); if (JSON.stringify(rj) !== b4) changes.push('set ' + Object.keys(SET).join(',')); }
  for (const u of args.unset) if (unset(rj, u)) changes.push('unset ' + u);
  if (args.rail) {
    let n = 0;
    for (const f of (rj.features || [])) if (f.type === 'railway' && !(f.style && f.style.rail === args.rail)) { f.style = Object.assign({}, f.style, { rail: args.rail }); n++; }
    if (n) changes.push('rail:' + args.rail + '×' + n);
  }
  for (const fp of FEATPOS) {
    const f = (rj.features || []).find(x => x.key === fp.key);
    if (!f) { console.log(t.name + ': no feature "' + fp.key + '" — skipped'); continue; }
    if (f.labelPos && f.labelPos.x === fp.x && f.labelPos.y === fp.y) continue;
    f.labelPos = { x: fp.x, y: fp.y };
    changes.push('labelPos ' + fp.key + '=' + fp.x + ',' + fp.y);
  }
  for (const sp of SETPATH) {
    let d;
    try { d = applySetPath(rj, sp); }
    catch (e) { console.log(t.name + ': ' + e.message + ' — skipped'); continue; }
    if (d) changes.push(d);
  }

  if (!changes.length) { console.log(t.name + ': already current'); continue; }
  console.log(t.name + ': ' + changes.join(', '));
  if (!APPLY) continue;

  const dir = stage(t.dir, 'new', 'S3');
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(rj, null, 2) + '\n');
  const outputs = ['routes.json'];
  const ov = path.join(prev.dir, 'overrides.json');
  if (fs.existsSync(ov)) { fs.copyFileSync(ov, path.join(dir, 'overrides.json')); outputs.push('overrides.json'); }
  stage(t.dir, 'commit', 'S3', dir, '--outputs', outputs.join(','),
    '--note', args.note || ('config: ' + changes.join(', ')));
  console.log('   committed ' + path.basename(dir));
}

if (APPLY) console.log('\nNow render them:\n  node "%SK%\\rollout.js" --all --apply --force --bump minor --note "..."'
  + '\n(--force is required: rollout.js gates the PREVIOUS S4, which still holds the old routes.json, and would otherwise report UP-TO-DATE.)');
