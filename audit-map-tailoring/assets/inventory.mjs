#!/usr/bin/env node
// inventory.mjs — what is tailored on every map, read off its latest S3 run.
//
//   node inventory.mjs [--buses <estate root>] [--keys] [--json <file>]
//
// Prints, on stdout:
//   1. one markdown table row per map: the tailoring beyond the universal curation
//      (palette, textOn, routeOrder, panelOrder, operators, internalDesc and
//      external[]/destinations[] are on every map and are not listed);
//   2. where the latest S3 and ci-reference/routes.json disagree, ignoring the keys
//      a rollout stamps (design, version, engine);
//   3. every overrides.json and hand-built S2 file, and whether it is LIVE (in the
//      latest S3 or in ci-reference) or DEAD (only in a superseded run);
//   4. with --keys, every config leaf path and how many maps carry it.
// --json writes the whole estate read (including each map's S3 config) to <file>, the
// input compare_drafts.mjs takes. Reads only. Exit 0; 2 on misuse or an empty estate.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, die, resolveBuses, estate, short } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help) die('usage: node inventory.mjs [--buses <estate root>] [--keys] [--json <file>]', 0);
const buses = resolveBuses(args);
const maps = estate(buses);

const n = a => Array.isArray(a) ? a.length : (a && typeof a === 'object') ? Object.keys(a).length : 0;
function knobs(c) {
  const k = [];
  const pins = (c.features || []).filter(f => f.labelPos && typeof f.labelPos === 'object').length;
  if (pins) k.push(`${pins} feature label pin${pins > 1 ? 's' : ''}`);
  if (n(c.mapNotes)) k.push(`mapNotes ${n(c.mapNotes)}`);
  for (const key of ['legendAt', 'legendWrap', 'externalNoteAt', 'badgeOffset', 'panelCols', 'panelRow', 'externalHubLabel', 'externalNote', 'riverLabel', 'coreBox', 'stopThinning', 'corridorPalette', 'localLoops', 'notShown', 'boardingPlan'])
    if (c[key] !== undefined) k.push(key === 'boardingPlan' ? `boardingPlan ${n(c.boardingPlan)} keys` : key);
  const ir = c.internalRoads || {};
  for (const key of ['rotationDeg', 'roadLabelExclude', 'roadLabelInclude', 'roadRename', 'keyRoads', 'lenses', 'northArrow', 'skeletonMaxW'])
    if (ir[key] !== undefined) k.push(key === 'rotationDeg' ? `rotationDeg ${ir[key]}` : key);
  const off = Object.values(ir.termini || {}).filter(t => t && (t.end === false || t.start === false)).length;
  if (off) k.push(`${off} termin${off > 1 ? 'i' : 'us'} suppressed`);
  if (c.internalSchematic && typeof c.internalSchematic === 'object' && n(c.internalSchematic)) k.push('schematic tweaks');
  const d = c.design || {};
  if (d.iconMinSep != null || d.spreadMax != null) k.push('icon spacing');
  if (d.keyCols != null) k.push(`keyCols ${d.keyCols}`);
  if (d.howToUse && d.howToUse.width != null) k.push('howToUse.width');
  const p = c.poi || {};
  if (p.include) k.push(`poi.include ${[].concat(p.include).join('+')}`);
  if (n(p.tiers)) k.push(`poi.tiers ${n(p.tiers)}`);
  if (n(p.excludeName)) k.push(`excludeName ${n(p.excludeName)}`);
  if (Array.isArray(p.industrialKeep) && p.industrialKeep.length) k.push(`industrialKeep ${p.industrialKeep.length}`);
  if (n(p.canon)) k.push(`canon ${n(p.canon)}`);
  if (n(c.badgeLabels)) k.push(`badgeLabels ${n(c.badgeLabels)}`);
  if (n(c.internalCorridors)) k.push(`corridors ${n(c.internalCorridors)}`);
  if (n(c.notOnLeaflet)) k.push(`notOnLeaflet ${n(c.notOnLeaflet)}`);
  if (n(c.redteamRejected)) k.push(`redteamRejected ${n(c.redteamRejected)}`);
  const notes = Object.keys(c).filter(x => x.startsWith('_')).length;
  if (notes) k.push(`${notes} _note keys`);
  return k;
}

// S2 tuning files a person or session writes, as opposed to the geometry tools' output.
const HAND_S2 = /^(intown_cfg|match_cfg|walkshed_cfg|manual-chain.*|atco2ll_extra|atco2ll_osm|atco2name_all|external_seed|palette|chains_community.*)\.json$/;
function s2Summary(m) {
  const bits = [];
  for (const f of ['intown_cfg.json', 'match_cfg.json', 'walkshed_cfg.json']) {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(m.ciDir, f), 'utf8')); } catch { continue; }
    const keys = Object.keys(j).filter(k => !['_comment', 'prefix', 'anchor', 'buf', 'center'].includes(k) && !(Array.isArray(j[k]) && !j[k].length) && !(j[k] && typeof j[k] === 'object' && !Array.isArray(j[k]) && !Object.keys(j[k]).length));
    if (keys.length) bits.push(`${f.replace('.json', '')}: ${keys.join(', ')}`);
  }
  const hand = m.ciFiles.filter(f => HAND_S2.test(f) && !/^(intown|match|walkshed)_cfg/.test(f));
  if (hand.length) bits.push(`hand files: ${hand.join(', ')}`);
  return bits.join('; ');
}

console.log(`# Tailoring inventory — ${maps.length} maps under ${buses}\n`);
console.log('| Map | Latest S3 | Tailoring beyond the universal curation | S2 / other layers |');
console.log('|---|---|---|---|');
for (const m of maps) console.log(`| ${short(m)} | ${m.s3Id ? m.s3Id.slice(0, 10) : '—'} | ${m.s3 ? (knobs(m.s3).join(', ') || '—') : '**no S3 config**'} | ${s2Summary(m) || '—'} |`);

console.log('\n## Latest S3 against ci-reference (rollout stamps ignored)\n');
const STAMPS = new Set(['design', 'version', 'engine']);
let drift = 0;
for (const m of maps) {
  if (!m.s3 || !m.ci) { console.log(`- ${short(m)}: ${!m.s3 ? 'no S3 config' : 'no ci-reference/routes.json'}`); drift++; continue; }
  const keys = [...new Set([...Object.keys(m.s3), ...Object.keys(m.ci)])].filter(k => !STAMPS.has(k));
  const diff = keys.filter(k => JSON.stringify(m.s3[k]) !== JSON.stringify(m.ci[k]));
  if (diff.length) { console.log(`- ${short(m)}: ${diff.join(', ')}`); drift++; }
}
if (!drift) console.log('- none: every latest S3 matches its golden master');

console.log('\n## Override and hand-geometry files, live or dead\n');
// One line per map and file. LIVE means the latest S3 run or the golden master carries
// it — i.e. the next build reads it; a copy only in superseded runs is dead.
let anyOv = false;
for (const m of maps) {
  const runs = m.s3Runs.filter(r => fs.existsSync(path.join(m.dir, r.dir, 'overrides.json'))).map(r => r.id);
  if (runs.length) {
    anyOv = true;
    const live = m.s3Files.includes('overrides.json') || m.ciFiles.includes('overrides.json');
    console.log(`- ${short(m)}: overrides.json in ${runs.length} S3 run${runs.length > 1 ? 's' : ''} (last ${runs[runs.length - 1]}) — ${live ? '**LIVE**' : 'dead (superseded runs only)'}`);
  }
  for (const f of m.ciFiles.filter(f => /^manual-chain/.test(f))) { anyOv = true; console.log(`- ${short(m)}: ${f} in ci-reference — **LIVE**`); }
}
if (!anyOv) console.log('- none');

if (args.keys) {
  console.log('\n## Every config key and how many maps carry it\n');
  const ROUTEMAPS = new Set(['palette', 'textOn', 'internalDesc', 'termini', 'frequency', 'badgeLabels', 'corridorDesc', 'internalCorridors', 'reachExtend', 'terminiLabels', 'tiers']);
  const counts = {};
  const walk = (o, p, acc) => {
    if (o && typeof o === 'object') {
      if (Array.isArray(o)) { if (o.some(x => x && typeof x === 'object')) o.forEach(x => walk(x, p + '[]', acc)); else acc.add(p); return; }
      const last = p.split('.').pop();
      for (const k of Object.keys(o)) walk(o[k], p + '.' + (ROUTEMAPS.has(last) ? '*' : k), acc);
    } else acc.add(p);
  };
  for (const m of maps) { if (!m.s3) continue; const s = new Set(); walk(m.s3, '', s); for (const p of s) (counts[p] ??= []).push(short(m)); }
  for (const [p, ms] of Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])))
    console.log(`${String(ms.length).padStart(3)} ${p}${ms.length <= 6 ? '  — ' + ms.join('; ') : ''}`);
}

if (typeof args.json === 'string') {
  fs.writeFileSync(args.json, JSON.stringify(maps.map(m => ({ map: m.rel, kind: m.kind, name: m.name, town: m.town, S3: m.s3Id, s3: m.s3, ciFiles: m.ciFiles }))));
  console.error(`wrote ${args.json}`);
} else if (args.json) die('--json needs a file path');
