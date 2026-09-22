#!/usr/bin/env node
// draft_towns.mjs — re-draft every town with draft_town.py into a SCRATCH root, so the
// drafter's output can be compared with what ships (compare_drafts.mjs).
//
//   node draft_towns.mjs --assets <drafter assets> --scratch <empty folder>
//        [--buses <estate root>] [--town <Name>]... [--fresh]
//
// --assets   the make-bus-leaflet/assets folder of the drafter under test. Use a
//            detached claude-skills worktree at origin/main, NOT the shared checkout,
//            which can be behind: on 2026-09-22 it was one commit short of the
//            drafter fix (OA-431) and the first run measured the old drafter.
// --scratch  a folder OUTSIDE every repository. It gets _gtfs/ (COPIES of the region
//            databases, naptan.sqlite, town_prefixes.json and regions.json — copies,
//            because scaffold_town.py registers towns in the town_prefixes.json beside
//            the database) and Areas/<Town>/ per draft, plus log_<Town>.txt.
// --town     repeatable; default is every town in _gtfs/town_prefixes.json.
// --fresh    empty the scratch Areas/ and logs first; without it a non-empty Areas/
//            is refused, because drafting into an old draft mixes two runs.
//
// Runs the towns ONE AT A TIME in the foreground, about five minutes each (live
// Overpass and Nominatim calls). There is no background loop to outlive a stop — the
// failure shape "The stop that stopped only the shell" came from a backgrounded bash
// loop on 2026-09-22. Ctrl-C stops the whole run.
//
// Expected, and not a finding: S4 fails in a scratch root (the engine's path guard);
// only S3 is compared. A town can stop BEFORE S3 — RED complexity, or a name the
// geocoder cannot find — and that IS a finding; the summary says which.
// Exit 0 when every town was attempted (whatever each one's result); 2 on misuse.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, die, resolveBuses, readJson } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { repeat: ['town'] });
const USAGE = 'usage: node draft_towns.mjs --assets <drafter assets> --scratch <empty folder> [--buses <estate root>] [--town <Name>]... [--fresh]';
if (args.help) die(USAGE, 0);
if (typeof args.assets !== 'string' || typeof args.scratch !== 'string') die(USAGE);
const assets = path.resolve(args.assets), scratch = path.resolve(args.scratch), buses = resolveBuses(args);
if (!fs.existsSync(path.join(assets, 'draft_town.py'))) die(`no draft_town.py in ${assets}`);
const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
if (inside(scratch, buses)) die(`--scratch must be outside the estate (${buses}); a draft there would be a stray town`);

const gtfs = path.join(buses, '_gtfs');
const prefixes = readJson(path.join(gtfs, 'town_prefixes.json'));
const regions = readJson(path.join(gtfs, 'regions.json'));
if (!prefixes || !regions) die(`cannot read town_prefixes.json and regions.json in ${gtfs}`);
const all = Object.keys(prefixes).filter(k => !k.startsWith('_'));
const towns = args.town.length ? args.town : all;
for (const t of towns) if (!prefixes[t]) die(`${t} is not in ${path.join(gtfs, 'town_prefixes.json')} — the drafter needs its region`);

// The scratch root.
const areas = path.join(scratch, 'Areas'), sg = path.join(scratch, '_gtfs');
fs.mkdirSync(areas, { recursive: true });
if (fs.readdirSync(areas).length) {
  if (!args.fresh) die(`${areas} is not empty — pass --fresh to empty it, or choose another --scratch`);
  fs.rmSync(areas, { recursive: true, force: true }); fs.mkdirSync(areas);
  for (const f of fs.readdirSync(scratch)) if (/^log_.*\.txt$/.test(f)) fs.rmSync(path.join(scratch, f));
}
fs.mkdirSync(sg, { recursive: true });
const need = new Set(['naptan.sqlite', 'town_prefixes.json', 'regions.json']);
for (const t of towns) {
  const reg = regions.regions[prefixes[t].region || 'cambridgeshire'];
  if (!reg) die(`${t}: region "${prefixes[t].region}" is not in regions.json`);
  need.add(path.basename(reg.db));
}
for (const f of need) {
  const src = path.join(gtfs, f), dst = path.join(sg, f);
  if (!fs.existsSync(src)) die(`missing ${src}`);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size || f.endsWith('.json')) fs.copyFileSync(src, dst);
}
console.error(`scratch root ready: ${scratch} (${[...need].join(', ')})`);

const results = [];
for (const t of towns) {
  const e = prefixes[t];
  const regKey = e.region || 'cambridgeshire';
  const db = path.join(sg, path.basename(regions.regions[regKey].db));
  const argv = [path.join(assets, 'draft_town.py'), t, '--buses-root', scratch, '--db', db, '--naptan', path.join(sg, 'naptan.sqlite'),
    '--region', regKey[0].toUpperCase() + regKey.slice(1)];
  if (Array.isArray(e.near)) argv.push('--centre', `${e.near[0]},${e.near[1]}`, '--radius-km', String(e.near[2]));
  const log = path.join(scratch, `log_${t}.txt`);
  console.error(`drafting ${t} ...`);
  const t0 = Date.now();
  const r = spawnSync('python', argv, { encoding: 'utf8', maxBuffer: 1 << 28 });
  fs.writeFileSync(log, (r.stdout || '') + '\n' + (r.stderr || ''));
  const out = (r.stdout || '') + (r.stderr || '');
  const s3 = fs.existsSync(path.join(areas, t, 'S3-config')) && fs.readdirSync(path.join(areas, t, 'S3-config')).some(d => fs.existsSync(path.join(areas, t, 'S3-config', d, 'routes.json')));
  const band = (out.match(/complexity band: (\w+)/) || [])[1] || '?';
  const why = (out.match(/STOPPED \(\w+\)|Nominatim found nothing[^\n]*|\d+ BLOCKING warning/) || [''])[0];
  results.push({ t, exit: r.status, s3, band, why, min: ((Date.now() - t0) / 60000).toFixed(1) });
}

console.log('| Town | Drafted to S3 | Complexity | Exit | Stopped because | Minutes |');
console.log('|---|---|---|---|---|---|');
for (const x of results) console.log(`| ${x.t} | ${x.s3 ? 'yes' : '**no**'} | ${x.band} | ${x.exit} | ${x.why || (x.s3 ? '— (S4 failing in a scratch root is expected)' : 'see the log')} | ${x.min} |`);
console.log(`\nLogs: ${scratch}${path.sep}log_<Town>.txt. Next: node compare_drafts.mjs --scratch "${scratch}"`);
