#!/usr/bin/env node
// history.mjs — every S3 run on every map: which keys it changed, why (its manifest
// note), and WHO the note says asked for it.
//
//   node history.mjs [--buses <estate root>] [--detail] [--since YYYY-MM-DD]
//
// Prints the runs by cause (keyword-classified from the note, so read the shares, not
// the units) and every run whose note names Peter. --detail adds every run, map by
// map, with its changed keys and note. --since keeps runs whose id is on or after the
// date. Reads only. Exit 0; 2 on misuse.
//
// WHO: every commit in buses-data is authored "Peter Cooper", Claude sessions
// included, so git cannot say who typed a key. The run's note can. A run whose note
// does not name Peter was, as far as the record says, a session's — do NOT report it
// as Peter's. (2026-09-22: the first audit wrote "what a person changed" on Chatteris,
// and Peter had changed only the orientation.)
import path from 'node:path';
import { parseArgs, die, resolveBuses, estate, short, readJson } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help) die('usage: node history.mjs [--buses <estate root>] [--detail] [--since YYYY-MM-DD]', 0);
if (args.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.since))) die('--since needs a date, YYYY-MM-DD');
const buses = resolveBuses(args);
const maps = estate(buses);

// First match wins, so the order is the priority. An engine rollout is checked first
// because its notes also mention layout words.
const CAUSES = [
  ['engine rollout or stamp', /design-quality|Phase [0-9]|G5|Opt-in rebase|laneOrientation|laneRibbon|OA-120|checkedAt from|config: set design|iconSet|scaleBar|routeCasing|spokeSpread: adopted|legendPlace: the|P1 round: two-column|parked|adopt current engine|OA-019 round two|OA-163|Review set|re-home|editor-capable|migrated|carry-forward|verbatim|Rebase|Phase 8/i],
  ['layout fixed by hand', /footer|collid|collision|overlap|clear of|nudge|move|moved|lift|spread|bearing|legend|wrap|off the|under the|position|hand-place|labelPos|keyAt|width|placer|clipped|casing|cap the road|fit fix|fitExtra|orient|north|rotation|tol /i],
  ['service set or data correction', /drop|dropp|removed|added|adds|joins|enters|withdraw|registration|operator|renamed|serves|not serve|never served|circular|termin|spoke|via|variant|bundle|merge|chain|Dial-a-Ride|Tiger|SF-0|notOnLeaflet|notShown|redteam|booking|validFrom/i],
  ['palette', /palette|colour|recolour|grey|cyan/i],
  ['POI or landmark choice', /poi|pub|landmark|must|tiers/i],
];
const PETER = /\bPeter\b/;
const IGNORE = new Set(['version', 'validFrom', 'checkedAt', 'engine']);

const rows = [];
for (const m of maps) {
  let prev = null;
  for (const r of m.s3Runs) {
    if (args.since && r.id.slice(0, 10) < args.since) { prev = readJson(path.join(m.dir, r.dir, 'routes.json')) || prev; continue; }
    const cur = readJson(path.join(m.dir, r.dir, 'routes.json'));
    let changed = [];
    if (prev && cur) changed = [...new Set([...Object.keys(prev), ...Object.keys(cur)])].filter(k => !IGNORE.has(k) && JSON.stringify(prev[k]) !== JSON.stringify(cur[k]));
    const note = (r.note || '').replace(/\s+/g, ' ');
    const cause = note ? (CAUSES.find(([, re]) => re.test(note)) || ['no cause matched'])[0] : 'no note';
    rows.push({ map: short(m), id: r.id, changed, note, cause, peter: PETER.test(note) });
    if (cur) prev = cur;
  }
}
if (!rows.length) die('no S3 runs found' + (args.since ? ` since ${args.since}` : ''), 1);

console.log(`# S3 history — ${rows.length} runs on ${maps.length} maps${args.since ? ` since ${args.since}` : ''}\n`);
console.log('| Cause (keyword-classified) | Runs | Share |');
console.log('|---|---|---|');
const by = {};
for (const r of rows) by[r.cause] = (by[r.cause] || 0) + 1;
for (const [c, k] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`| ${c} | ${k} | ${Math.round(100 * k / rows.length)}% |`);

const p = rows.filter(r => r.peter);
console.log(`\n## Runs whose note names Peter — ${p.length} of ${rows.length}\n`);
console.log('Every other run was typed by a session as far as the record says. Read each of these: most record a DECISION of Peter\'s that a session then typed.\n');
for (const r of p) console.log(`- ${r.map} ${r.id} [${r.changed.join(', ')}] ${r.note.slice(0, 220)}`);

if (args.detail) {
  console.log('\n## Every run\n');
  let last = null;
  for (const r of rows) {
    if (r.map !== last) { console.log(`\n### ${r.map}\n`); last = r.map; }
    console.log(`- ${r.id} [${r.changed.join(', ')}] (${r.cause}) ${r.note.slice(0, 300)}`);
  }
}
