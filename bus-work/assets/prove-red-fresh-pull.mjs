#!/usr/bin/env node
/* Prove the fresh-pull row can appear AND can go away (buses-data OA-499 item 1).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets), with no
 * placeholders:
 *
 *   node prove-red-fresh-pull.mjs
 *
 * WHAT IS BEING FALSIFIED. A town is owed a fresh landmark pull when its latest S2
 * query lacks a token today's pois_query() asks for. Each case is a PAIR — the
 * state that raises the row, and the state that clears it — because a row that
 * never clears is ignored. Three things are asserted: (1) the pure function on
 * every branch, with query strings; (2) THE REAL SOURCE: draft_town.py parses to a
 * non-trivial token set that includes a category OA-500 added, so a refactor of
 * pois_query() that the parser cannot read goes red here rather than reading as
 * "every town is fresh"; (3) THE WIRE in worklist.mjs and concurrency.mjs, by
 * literal string, for the reason *The harness that stopped at the module's edge*.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshPullItems, queryTokens, poisQuerySource, readCurrentQuery } from './fresh_pull.mjs';
import { needsOf } from './concurrency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const ENGINE = path.resolve(HERE, '..', '..', 'make-bus-leaflet', 'assets');
if (!fs.existsSync(path.join(ENGINE, 'draft_town.py'))) { console.error(`prove-red-fresh-pull: ${ENGINE}/draft_town.py not found — the engine must sit beside bus-work`); process.exit(2); }

// A miniature pois_query() in the f-string shape draft_town.py uses: `(` and `)`
// in column 0, which is what broke the first cut of poisQuerySource().
const PY = (amen) => `import x\n\ndef pois_query(bbox):\n    box = f'{bbox["s"]}'\n    return f"""[out:json][timeout:90];\n(\n  node["highway"="bus_stop"]({box});\n  node["amenity"~"^(${amen})$"]({box});\n  way["amenity"="pub"]({box});\n)\n;\nout center tags;"""\n\n\ndef feature_query(bbox, feat):\n    node["waterway"="river"]({box})\n`;
const REC = (amen) => `[out:json][timeout:90];\n(\n  node["highway"="bus_stop"](52.1,-0.2,52.3,0.1);\n  node["amenity"~"^(${amen})$"](52.1,-0.2,52.3,0.1);\n  way["amenity"="pub"](52.1,-0.2,52.3,0.1);\n)\n;\nout center tags;\n`;
const town = (name, s2 = { id: '2026-09-29_1933', dir: '/x' }) => ({ name, built: true, s2 });
const run = (current, recorded, towns = [town('Alpha')]) =>
  freshPullItems({ towns, currentQuery: poisQuerySource(current), readRecorded: () => recorded });

console.log('1. the parser');
{
  const src = poisQuerySource(PY('pharmacy|cinema'));
  check('pois_query body is cut at the next def, not at column-0 "("', src && src.includes('way["amenity"="pub"]') && !src.includes('waterway'));
  const t = queryTokens(src);
  check('an alternation splits into one token per value', t.has('node amenity=pharmacy') && t.has('node amenity=cinema'));
  check('the box is not part of a token', queryTokens(REC('pharmacy')).has('node amenity=pharmacy'));
  check('no def pois_query → null', poisQuerySource('def other():\n  pass\n') === null);
}

console.log('2. the row — raised, then cleared');
{
  const r = run(PY('pharmacy|cinema'), REC('pharmacy'));
  check('a recorded query lacking cinema raises fresh-pull-Alpha', r.items.length === 1 && r.items[0].key === 'fresh-pull-Alpha');
  check('the row names what is missing', r.items[0] && r.items[0].why.includes('amenity=cinema') && !r.items[0].why.includes('amenity=pharmacy'));
  check('the row names the dry run first', r.items[0] && /repull_landmarks\.py --town "Alpha"$/.test(r.items[0].do[0].cmd));
  check('owed carries the town for the rebuild row', r.owed.has('Alpha'));
  const ok = run(PY('pharmacy|cinema'), REC('cinema|pharmacy'));
  check('the same categories in another order clear it', ok.items.length === 0 && !ok.owed.size);
  const none = run(PY('pharmacy'), null);
  check('a run that recorded no query owes it', none.items.length === 1 && none.items[0].why.includes('recorded no overpass-pois.txt'));
  const unbuilt = run(PY('pharmacy'), null, [{ name: 'Beta', built: false, s2: null }]);
  check('an unbuilt town raises nothing', unbuilt.items.length === 0);
}

console.log('3. blind is not clean');
{
  const r = freshPullItems({ towns: [town('Alpha')], currentQuery: null, readRecorded: () => null });
  check('an unreadable pois_query() gives a warning and no rows', r.items.length === 0 && /blind, not clean/.test(r.warning || ''));
}

console.log('4. the real draft_town.py');
{
  const t = queryTokens(readCurrentQuery(ENGINE));
  check('pois_query() parses to at least 20 tokens', t.size >= 20, `got ${t.size}`);
  check('it includes an OA-500 category (amenity=pub)', t.has('node amenity=pub'));
  check('it includes bus stops', t.has('node highway=bus_stop'));
}

console.log('5. the wire');
{
  const wl = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  check('worklist imports fresh_pull.mjs', wl.includes("import { freshPullItems, readCurrentQuery, readRecordedQuery } from './fresh_pull.mjs';"));
  check('worklist calls freshPullItems', wl.includes('const freshPull = freshPullItems({ towns: tree.towns, currentQuery: readCurrentQuery(SK), readRecorded: readRecordedQuery'));
  check('worklist adds the rows', wl.includes('for (const it of freshPull.items) add(it);'));
  check('worklist reports a blind check', wl.includes('if (freshPull.warning) warnings.push(freshPull.warning);'));
  check('the tree row carries its latest S2', wl.includes("row.s2 = s2 ? { id: s2.rec.id, dir: s2.dir } : null;"));
  check('the rebuild row names the pull', wl.includes('take fresh-pull-${mapRow.name} first'));
  const needs = needsOf({ key: 'fresh-pull-Alpha', type: 'housekeeping' });
  check('fresh-pull needs buses-tree, buses-maps and engine', ['buses-tree', 'buses-maps', 'engine'].every((n) => needs.includes(n)), JSON.stringify(needs));
}

if (bad) { console.error(`\nprove-red-fresh-pull: ${bad} check(s) failed`); process.exit(1); }
console.log('\nprove-red-fresh-pull: all checks passed');
