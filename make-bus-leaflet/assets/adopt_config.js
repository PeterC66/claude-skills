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
 * Flags:
 *   --town <name>   repeatable; or --all
 *   --set <json>    deep-merged into routes.json (objects merge, values replace)
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
 *                   rather than a new key nothing reads.
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
const { SK, findTowns, readJson, latestRunDir, parseSetPath, applySetPath } = require(path.join(__dirname, 'gate_lib'));

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
const BUSES = path.resolve(args.buses || 'C:/u3a St Ives/Using AI/Buses');
const APPLY = !!args.apply;
const SET = args.set ? JSON.parse(args.set) : null;
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

const towns = findTowns(BUSES).filter(t => args.all || args.town.includes(t.name));
if (!towns.length) { console.error('--all, or --town from: ' + findTowns(BUSES).map(t => t.name).join(', ')); process.exit(2); }
if (!SET && !args.unset.length && !args.rail && !FEATPOS.length && !SETPATH.length) { console.error('nothing to do: pass --set, --unset, --rail, --feature-pos or --set-path'); process.exit(2); }

console.log((APPLY ? 'APPLYING' : 'DRY RUN') + ' over ' + towns.length + ' town(s)'
  + (APPLY ? '' : ' (pass --apply to commit)') + '\n');

for (const t of towns) {
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
