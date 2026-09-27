#!/usr/bin/env node
// draft_places.mjs — re-draft every place's destination list into a SCRATCH root, so
// places.mjs --drafts can compare the drafter under test with what ships. The place arm
// of section 8 (buses-data OA-438): without it places.mjs could only read the draft a
// place was built with, which says how the OLD drafter did and nothing about a new one.
//
//   node draft_places.mjs --assets <place assets> --scratch <folder> [--buses <estate root>]
//
// --assets   the make-place-bus-leaflet/assets folder of the drafter under test — a
//            claude-skills worktree, for the reason draft_towns.mjs gives.
// --scratch  a folder OUTSIDE every repository; gets <map rel path>/destinations.draft.json
//            and atco2locality.json per place.
//
// Offline and quick: each place is drafted from the inputs its own ci-reference/ holds
// (routes_full_atco.json, atco2ll.json, atco2name.json, place.json) and the estate's
// _gtfs/naptan.sqlite, so no feed, Overpass or Nominatim call is made and the result
// is a pure function of committed files. A place missing any of those is reported and
// skipped. Exit 0 when every place was attempted; 1 if none could be drafted; 2 on misuse.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, die, resolveBuses, estate, short } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const USAGE = 'usage: node draft_places.mjs --assets <place assets> --scratch <folder> [--buses <estate root>]';
if (args.help) die(USAGE, 0);
if (typeof args.assets !== 'string' || typeof args.scratch !== 'string') die(USAGE);
const assets = path.resolve(args.assets), scratch = path.resolve(args.scratch), buses = resolveBuses(args);
for (const f of ['aggregate_destinations.js', 'stop_localities.py'])
  if (!fs.existsSync(path.join(assets, f))) die(`no ${f} in ${assets} — is --assets a make-place-bus-leaflet/assets folder new enough to name by locality?`);
const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
if (inside(scratch, buses)) die(`--scratch must be outside the estate (${buses})`);
const naptan = path.join(buses, '_gtfs', 'naptan.sqlite');
if (!fs.existsSync(naptan)) die(`missing ${naptan}`);

const INPUTS = ['routes_full_atco.json', 'atco2ll.json', 'atco2name.json', 'place.json'];
const rows = [];
for (const m of estate(buses).filter(x => x.kind !== 'town')) {
  const missing = INPUTS.filter(f => !fs.existsSync(path.join(m.ciDir, f)));
  if (missing.length) { rows.push([short(m), 'skipped', `no ${missing.join(', ')} in ci-reference`]); continue; }
  const out = path.join(scratch, m.rel);
  fs.mkdirSync(out, { recursive: true });
  const ci = f => path.join(m.ciDir, f);
  const loc = path.join(out, 'atco2locality.json');
  const r1 = spawnSync('python', [path.join(assets, 'stop_localities.py'), ci('routes_full_atco.json'), '--out', loc, '--naptan', naptan], { encoding: 'utf8' });
  if (r1.status !== 0) { rows.push([short(m), '**failed**', `stop_localities: ${(r1.stderr || r1.stdout).trim().split('\n').pop()}`]); continue; }
  // clusterKm as the place was drafted with, so only the NAMING differs.
  const old = (() => { try { return JSON.parse(fs.readFileSync(ci('destinations.draft.json'), 'utf8')).clusterKm; } catch { return null; } })();
  const r2 = spawnSync('node', [path.join(assets, 'aggregate_destinations.js'), ci('routes_full_atco.json'), ci('atco2ll.json'), ci('atco2name.json'), ci('place.json'),
    String(old || 1.2), path.join(out, 'destinations.draft.json'), '--localities', loc], { encoding: 'utf8' });
  rows.push([short(m), r2.status === 0 ? 'drafted' : '**failed**', r2.status === 0 ? `clusterKm ${old || 1.2}` : (r2.stderr || '').trim().split('\n').pop()]);
}
console.log('| Place | Result | Note |');
console.log('|---|---|---|');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
if (!rows.some(r => r[1] === 'drafted')) die('no place could be drafted', 1);
console.log(`\nNext: node places.mjs --drafts "${scratch}"`);
