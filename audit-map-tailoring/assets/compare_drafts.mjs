#!/usr/bin/env node
// compare_drafts.mjs — each fresh draft's S3 routes.json against the town's live latest
// S3, key by key: what had to be changed by hand after the drafter.
//
//   node compare_drafts.mjs --scratch <the draft_towns.mjs scratch root> [--buses <estate root>] [--town <Name>]...
//
// For each town: keys only one side has; routes drafted but not shipped and shipped
// but not drafted; palette entries changed; every external spoke whose label, bearing
// (> 2 degrees), bundled routes or stop count differs; internalRoads differences;
// internalDesc entries rewritten; and features, poi, operators, anchor, anchorLabel,
// orientationRoute, titleColor, mapNotes and internalZoom where they differ.
// internalRoads.termini start/end is LEFT OUT on purpose: the draft and the live map
// build their chains from different sources, so which end is "start" is not
// comparable.
//
// A difference is not by itself a fault in the drafter: some are data that changed
// since the town was built, some are the customer's to decide. Sort each into the
// audit's three buckets by hand. Reads only. Exit 0; 1 if no town was drafted to S3;
// 2 on misuse.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, die, resolveBuses, estate, readJson } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { repeat: ['town'] });
const USAGE = 'usage: node compare_drafts.mjs --scratch <scratch root> [--buses <estate root>] [--town <Name>]...';
if (args.help) die(USAGE, 0);
if (typeof args.scratch !== 'string') die(USAGE);
const scratch = path.resolve(args.scratch);
if (!fs.existsSync(path.join(scratch, 'Areas'))) die(`${scratch} has no Areas/ — run draft_towns.mjs first`);
const buses = resolveBuses(args);
let towns = estate(buses).filter(m => m.kind === 'town');
if (args.town.length) towns = towns.filter(m => args.town.includes(m.name));

const j = v => v === undefined ? 'undefined' : JSON.stringify(v);
const cut = (s, n = 200) => s.length > n ? s.slice(0, n) + '…' : s;
const flat = (o, p = '', a = {}) => { if (o && typeof o === 'object' && !Array.isArray(o)) { for (const k of Object.keys(o)) flat(o[k], p ? p + '.' + k : k, a); } else a[p] = o; return a; };
let compared = 0;

for (const t of towns) {
  const td = path.join(scratch, 'Areas', t.name);
  console.log(`\n## ${t.name}\n`);
  const s3d = path.join(td, 'S3-config');
  const run = fs.existsSync(s3d) ? fs.readdirSync(s3d).sort().filter(d => fs.existsSync(path.join(s3d, d, 'routes.json'))).pop() : null;
  if (!run) {
    const log = path.join(scratch, `log_${t.name}.txt`);
    const why = fs.existsSync(log) ? (fs.readFileSync(log, 'utf8').match(/STOPPED \(\w+\)[^\n]*|Nominatim found nothing[^\n]*|complexity band: \w+/) || ['no reason in the log'])[0] : 'no draft and no log';
    console.log(`- **not drafted to S3**: ${why}`);
    continue;
  }
  if (!t.s3) { console.log('- the live map has no S3 config to compare with'); continue; }
  compared++;
  const d = readJson(path.join(s3d, run, 'routes.json')), L = t.s3;
  const dk = Object.keys(d), lk = Object.keys(L);
  console.log(`- keys only in the live config: ${lk.filter(k => !dk.includes(k)).join(', ') || '—'}`);
  console.log(`- keys only in the draft: ${dk.filter(k => !lk.includes(k)).join(', ') || '—'}`);
  const dr = Object.keys(d.palette || {}), lr = Object.keys(L.palette || {});
  console.log(`- routes drafted, not shipped: ${dr.filter(r => !lr.includes(r)).join(' ') || '—'}; shipped, not drafted: ${lr.filter(r => !dr.includes(r)).join(' ') || '—'}`);
  const both = lr.filter(r => dr.includes(r));
  console.log(`- palette changed on ${both.filter(r => String(d.palette[r]).toLowerCase() !== String(L.palette[r]).toLowerCase()).length} of ${both.length} shared routes`);
  const ex = a => Object.fromEntries((a || []).map(e => [e.route, e]));
  const de = ex(d.external), le = ex(L.external);
  const spokes = [...new Set([...Object.keys(de), ...Object.keys(le)])].map(r => {
    const a = de[r], b = le[r];
    if (!a) return `${r}: shipped only (${b.label})`;
    if (!b) return `${r}: drafted only (${a.label})`;
    const bits = [];
    if (a.label !== b.label) bits.push(`label "${a.label}" → "${b.label}"`);
    if (Math.abs((a.bearing ?? 0) - (b.bearing ?? 0)) > 2) bits.push(`bearing ${a.bearing} → ${b.bearing}`);
    if (j(a.routes) !== j(b.routes)) bits.push(`routes ${j(a.routes)} → ${j(b.routes)}`);
    if ((a.stops || []).length !== (b.stops || []).length) bits.push(`stops ${(a.stops || []).length} → ${(b.stops || []).length}`);
    return bits.length ? `${r}: ${bits.join('; ')}` : null;
  }).filter(Boolean);
  console.log(`- external spokes differing: ${spokes.length}`);
  for (const s of spokes) console.log(`  - ${cut(s)}`);
  const fd = flat(d.internalRoads || {}), fl = flat(L.internalRoads || {});
  const ir = [...new Set([...Object.keys(fd), ...Object.keys(fl)])].filter(k => !k.startsWith('termini') && j(fd[k]) !== j(fl[k]));
  console.log(`- internalRoads differing: ${ir.map(k => `${k} ${j(fd[k])} → ${j(fl[k])}`).join(' | ') || '—'}`);
  const idd = Object.keys(L.internalDesc || {}).filter(r => j((d.internalDesc || {})[r]) !== j(L.internalDesc[r]));
  console.log(`- internalDesc rewritten: ${idd.length} of ${Object.keys(L.internalDesc || {}).length}${idd.length ? ', e.g. ' + cut(`${idd[0]}: ${j((d.internalDesc || {})[idd[0]])} → ${j(L.internalDesc[idd[0]])}`) : ''}`);
  for (const k of ['features', 'poi', 'operators', 'anchor', 'anchorLabel', 'orientationRoute', 'titleColor', 'mapNotes', 'internalZoom'])
    if (j(d[k]) !== j(L[k])) console.log(`- ${k}: draft ${cut(j(d[k]), 150)}\n  - live ${cut(j(L[k]), 150)}`);
}
if (!compared) die('\nno town was drafted to S3 — nothing was compared', 1);
