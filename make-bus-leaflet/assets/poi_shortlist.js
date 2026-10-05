#!/usr/bin/env node
/*
 * poi_shortlist.js — the ~40 places worth asking a customer about, numbered, so a
 * reply can be "keep 3, 7, 12; drop 5, 9" (buses-data OA-568, slice 1 of 3).
 *
 * WHY THIS EXISTS. `poi_worksheet.js` asks about EVERY place (171 rows for High
 * Wycombe) and was demoted because nobody answers a census. Peter's 2026-10-05
 * decision: a managed customer gets a short numbered list with the first draft and
 * is asked two things only — the numbers that MUST show, the numbers to DROP —
 * and everything unmarked stays `may`, which is today's behaviour. Unmarked never
 * means `miss`: a customer who marked six places must not get a map that is empty.
 *
 * WHAT IS ON THE LIST, AND IN WHAT ORDER. A place the customer has not already
 * answered (it has no `poi.tiers` entry), ranked by how much the engine had to
 * give up on it last time:
 *     name dropped on at least one sheet  -> 3 points   (the question is "did this matter?")
 *     numbered in the index only          -> 2 points
 *     of a kind the map can name at all   -> 1 point    (a symbol-only kind is never named, so
 *                                                        asking "must it show" has no effect)
 * then by name, so a re-run gives the same numbers. The list is cut at --limit
 * (default 40). A spec map with no ci-reference sidecars scores every place 1 and
 * the list is simply the first 40 nameable places by name; that is honest about
 * having no evidence, and the picture slice is where a better ranking can go.
 *
 * Two files are written beside each other, and the numbers are the contract between
 * them: `<out>.md` is what the customer reads, `<out>.json` is `{ n: "<cat>:<name>" }`
 * for the importer (slice 3) to turn the reply back into `poi.tiers` keys. The JSON
 * carries the ranking inputs too, so the importer can echo back what it understood.
 *
 * READ-ONLY apart from those two files. No network, no generator, no stage folder.
 *
 * Usage — every path is a real path, not a placeholder; --map is relative to --buses:
 *   node poi_shortlist.js --map "Areas/High Wycombe"
 *   node poi_shortlist.js --map "Areas/High Wycombe" --limit 30 --out "<a path without extension>"
 *   node poi_shortlist.js --map "Areas/High Wycombe" --out -        # the markdown to stdout
 *   --map    <dir>   the map folder, relative to --buses
 *   --buses  <dir>   the buses-data checkout; then $BUSES_DIR, then the laptop (cli.js)
 *   --limit  <n>     the most places to list (default 40)
 *   --out    <path>  base path for the two files (default <map>/poi-shortlist); "-" = stdout
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { selectPois, AUTO_NAMED_CATS, printsName } = require('./poi_select.js');
const { poiInputs } = require('./poi_tiers_sync.js');
const { resolveBuses } = require('./cli');

const DEFAULT_LIMIT = 40;

/* The pure half: candidates in, numbered list out. `seen` is { dropped:Set, indexed:Set }
 * of `<cat>:<name>` keys; `tiers` is the map's existing `poi.tiers` object. */
function rank(pois, seen, tiers, limit) {
  const answered = new Set(Object.keys(tiers || {}));
  const rows = [];
  for (const p of pois) {
    const key = p.cat + ':' + p.name;
    if (answered.has(key) || !printsName(p)) continue;
    const dropped = seen.dropped.has(key), indexed = seen.indexed.has(key);
    rows.push({ key, cat: p.cat, name: p.name, dropped, indexed,
      score: (dropped ? 3 : 0) + (indexed ? 2 : 0) + 1 });
  }
  rows.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return rows.slice(0, limit).map((r, i) => Object.assign({ n: i + 1 }, r));
}

function markdown(town, list, total, evidence) {
  const L = [];
  L.push('# ' + town + ' — which of these places must be on your map?');
  L.push('');
  L.push('Your first draft shows places taken from OpenStreetMap. We cannot fit every one of them, so here are ' + list.length
    + ' we would like your view on, picked from ' + total + '. **Everything you do not mention stays as it is in the draft.** You only need to reply with two lists of numbers:');
  L.push('');
  L.push('- **Must show** — places people in your town really navigate by. Their names are printed whatever it costs. Please keep this to about a dozen, because each one takes room from its neighbours.');
  L.push('- **Drop** — places nobody needs on the map. They are removed completely and the space is given back.');
  L.push('');
  L.push('For example: *Must show: 3, 7, 12. Drop: 5, 9.* If a name is wrong, write the right one next to its number.');
  L.push('');
  L.push('| No. | Place | Kind |' + (evidence ? ' In the draft |' : ''));
  L.push('|---|---|---|' + (evidence ? '---|' : ''));
  for (const r of list) {
    const st = r.dropped ? 'name did not fit' : r.indexed ? 'number only' : 'named';
    L.push('| ' + r.n + ' | ' + r.name.replace(/\|/g, '\\|') + ' | ' + r.cat + ' |' + (evidence ? ' ' + st + ' |' : ''));
  }
  L.push('');
  return L.join('\n');
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function load(mapDir) {
  const inp = poiInputs(mapDir);
  if (!inp) return null;
  const sets = ['osm.json', 'osm2.json'].map(f => path.join(inp.dir, f)).filter(fs.existsSync)
    .map(f => (readJson(f) || {}).elements).filter(Boolean);
  if (!sets.length) return null;
  const cfgPath = fs.existsSync(path.join(inp.dir, 'routes.json'))
    ? path.join(inp.dir, 'routes.json') : path.join(mapDir, 'ci-reference', 'routes.json');
  const cfg = readJson(cfgPath) || {};
  const pois = selectPois(sets, cfg.poi || {}, {});
  const dropped = new Set(), indexed = new Set();
  const keyOf = id => String(id).slice(4).replace(/#\d+$/, '');   // a second POI sharing a key is `poi:<key>#2`
  const ciDir = path.join(mapDir, 'ci-reference');
  if (fs.existsSync(ciDir)) for (const f of fs.readdirSync(ciDir)) {
    const into = /^unplaced.*\.json$/.test(f) ? dropped : f === 'indexed.json' ? indexed : null;
    if (into) for (const it of (readJson(path.join(ciDir, f)) || []))
      if (String(it.id || '').startsWith('poi:')) into.add(keyOf(it.id));
  }
  return { pois, cfg, seen: { dropped, indexed }, source: inp.source };
}

function main() {   // OA-344: the body is guarded, not re-indented — see test/asset_load.test.js
  const F = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) F[argv[i].slice(2)] = argv[++i];
  if (!F.map) { console.error('poi_shortlist: --map "<folder under the buses checkout>" is required'); process.exit(1); }
  const limit = F.limit ? parseInt(F.limit, 10) : DEFAULT_LIMIT;
  if (!(limit > 0)) { console.error('poi_shortlist: --limit must be a positive number'); process.exit(1); }
  const BUSES = resolveBuses(F);
  const mapDir = path.isAbsolute(F.map) ? F.map : path.join(BUSES, F.map);
  const M = load(mapDir);
  if (!M) { console.error('poi_shortlist: no osm.json under ' + mapDir + ' (looked in ci-reference/ then S2-geometry/)'); process.exit(1); }
  const list = rank(M.pois, M.seen, (M.cfg.poi || {}).tiers, limit);
  const evidence = M.seen.dropped.size + M.seen.indexed.size > 0;
  const md = markdown(path.basename(mapDir), list, M.pois.length, evidence);
  if (F.out === '-') { process.stdout.write(md); return; }
  const base = F.out || path.join(mapDir, 'poi-shortlist');
  fs.writeFileSync(base + '.md', md);
  fs.writeFileSync(base + '.json', JSON.stringify({ map: path.basename(mapDir), source: M.source,
    candidates: M.pois.length, list }, null, 2) + '\n');
  console.log('poi_shortlist: ' + list.length + ' of ' + M.pois.length + ' places listed'
    + (evidence ? '' : ' (no sidecars: ranked by name only)'));
  console.log('  read from : ' + M.source);
  console.log('  written   : ' + base + '.md, ' + base + '.json');
}

if (require.main === module) main();
module.exports = { main, rank, markdown, load, AUTO_NAMED_CATS };
