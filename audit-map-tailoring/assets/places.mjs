#!/usr/bin/env node
// places.mjs — how much of each place's drafted destination list survived review.
//
//   node places.mjs [--buses <estate root>]
//
// Compares ci-reference/destinations.draft.json (aggregate_destinations.js's output)
// with the destinations[] the place's latest S3 ships, by name. A low survival rate is
// the signature of a drafter naming clusters after their STOP ("Bus Station", "Tesco
// Store") rather than their locality — 7 of 87 on 2026-09-22. Reads only. Exit 0;
// 1 if no place has both files (nothing was measured, which must not read as clean);
// 2 on misuse.
import path from 'node:path';
import { parseArgs, die, resolveBuses, estate, short, readJson } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help) die('usage: node places.mjs [--buses <estate root>]', 0);
const buses = resolveBuses(args);
const maps = estate(buses).filter(m => m.kind !== 'town');

console.log('| Place | Drafted | Shipped | Drafted names kept | Shipped names the draft never had |');
console.log('|---|---|---|---|---|');
let drafted = 0, kept = 0, measured = 0;
for (const m of maps) {
  let d = readJson(path.join(m.ciDir, 'destinations.draft.json'));
  const live = m.s3 && m.s3.destinations;
  if (!d || !Array.isArray(live)) { console.log(`| ${short(m)} | — | — | not measured: ${!d ? 'no destinations.draft.json' : 'no destinations[] in S3'} | |`); continue; }
  d = Array.isArray(d) ? d : (d.destinations || []);
  const dn = d.map(x => x.name), ln = live.map(x => x.name);
  const k = ln.filter(x => dn.includes(x)).length;
  drafted += dn.length; kept += k; measured++;
  console.log(`| ${short(m)} | ${dn.length} | ${ln.length} | ${k} | ${ln.filter(x => !dn.includes(x)).join(', ')} |`);
}
if (!measured) die('no place carries both a drafted and a shipped destination list — nothing was measured', 1);
console.log(`\n${kept} of ${drafted} drafted destination names survived, across ${measured} places.`);
