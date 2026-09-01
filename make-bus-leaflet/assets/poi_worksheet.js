#!/usr/bin/env node
/*
 * poi_worksheet.js — print a map's points of interest as a question for somebody
 * who lives there: which are MUST, which are MAY, which are MISS.
 *
 * WHY THIS EXISTS (OA-202, 2026-08-31). 98% of every dropped label on the estate
 * is a POI, 100% of the numbered place index is POIs, and the de facto priority
 * system when a sheet runs out of room is `labeller.js`'s packing heuristic —
 * priority, then the LONGEST NAME. Longest-first is a sound way to pack a page
 * and it is not a statement of value. Nothing in this system has ever been able
 * to express which places matter, so the survivor of a crowded corner is decided
 * by string length.
 *
 * Every POI costs page area whether or not it is ever named: `poiMark()` draws
 * the symbol unconditionally and only the NAME is conditional, so each one
 * reserves a 4.2 x 4.2 mm box and a placer anchor before a single route line is
 * drawn. High Wycombe's 171 claim about a tenth of the map frame on
 * OpenStreetMap's opinion of what matters.
 *
 * So the cheapest thing that can be done about it is not a placer change. It is
 * to ask. This prints the list to ask WITH, and the JSON block to paste the
 * answer back INTO. It is the only step of that loop a tool can do.
 *
 * READ-ONLY except for the one file it is told to write. It runs the engine's
 * own `poi_select.js` over data already on disk — no network, no generator, no
 * stage folder touched. Running a generator to read a number overwrites the run
 * folder you pointed it at, which is why this does not.
 *
 * Usage — run from anywhere; every path argument is a real path, not a
 * placeholder, and --map is relative to --buses:
 *
 *   node poi_worksheet.js --map "Areas/High Wycombe"
 *   node poi_worksheet.js --map "Areas/High Wycombe" --buses "C:/u3a St Ives/Using AI/Buses"
 *   node poi_worksheet.js --map "Places/_standalone/Ely Co-op" --out -    # stdout
 *   node poi_worksheet.js --all                                          # every map, summary only
 *
 *   --map    <dir>   the map folder, relative to --buses (default: none, with --all)
 *   --buses  <dir>   the buses-data checkout (default: C:/u3a St Ives/Using AI/Buses)
 *   --out    <file>  where to write (default: <map>/poi-worksheet.md; "-" = stdout)
 *   --all            print one summary line per map and write nothing
 *
 * Zero dependencies (Node core + poi_select.js), matching the rest of assets/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { selectPois, AUTO_NAMED_CATS, printsName } = require('./poi_select.js');

// poiMark()'s auto-name set. Everything outside it draws a symbol the Key
// explains and is NEVER named, whatever OpenStreetMap called it — which is the
// single most useful fact to put in front of a local, because it is the part of
// the load that is pure page area.
//
// It was typed out again here, beside the identical list in gen_internal.js,
// with nothing comparing the two. Both now read poi_select.js (OA-212).
const AUTO_NAMED = AUTO_NAMED_CATS;
const FRAME_MM2 = 190 * 155.1;     // the internal sheet's clipPath rect
const POI_BOX_MM2 = 4.2 * 4.2;     // icon(cat, x, y, 2.1) => a 4.2 mm box
const DEFAULT_BUSES = 'C:/u3a St Ives/Using AI/Buses';

function args(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') f.all = true;
    else if (a.startsWith('--')) f[a.slice(2)] = argv[++i];
  }
  return f;
}
const F = args(process.argv.slice(2));
const BUSES = F.buses || DEFAULT_BUSES;

/*
 * WHERE THE DATA COMES FROM, and why ci-reference is preferred.
 *
 * `ci-reference/` is the tracked mirror of the map's latest S4 run, so it holds
 * the osm.json and the routes.json that DREW the sheet now published. The S2/S4
 * run folders are gitignored and a fresh clone or a worktree has neither. Asking
 * ci-reference means the worksheet describes the sheet the customer is holding.
 * The S2 fallback is for a town mid-build that has not reached S4 yet.
 */
function inputs(mapDir) {
  const ci = path.join(mapDir, 'ci-reference');
  if (fs.existsSync(path.join(ci, 'osm.json'))) return { dir: ci, source: 'ci-reference' };
  const s2 = path.join(mapDir, 'S2-geometry');
  if (fs.existsSync(s2)) {
    const runs = fs.readdirSync(s2).filter(d => fs.existsSync(path.join(s2, d, 'osm.json'))).sort();
    if (runs.length) return { dir: path.join(s2, runs[runs.length - 1]), source: 'S2-geometry/' + runs[runs.length - 1] };
  }
  return null;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function loadMap(mapDir) {
  const inp = inputs(mapDir);
  if (!inp) return null;
  const sets = ['osm.json', 'osm2.json']
    .map(f => path.join(inp.dir, f)).filter(fs.existsSync)
    .map(f => (readJson(f) || {}).elements).filter(Boolean);
  if (!sets.length) return null;
  const cfgPath = fs.existsSync(path.join(inp.dir, 'routes.json'))
    ? path.join(inp.dir, 'routes.json') : path.join(mapDir, 'ci-reference', 'routes.json');
  const cfg = readJson(cfgPath) || {};
  const report = {};
  const pois = selectPois(sets, cfg.poi || {}, report);

  /* What the sheets did with each name last time they were drawn. The `unplaced*`
   * sidecars are per-sheet and `indexed.json` describes one sheet of a town that
   * may have three, so this is read as "seen somewhere", never as a per-sheet
   * verdict — a POI dropped on the diagram and printed on the schematic is both,
   * and saying so is more use to a local than picking one. */
  const dropped = new Set(), indexed = new Set();
  const ciDir = path.join(mapDir, 'ci-reference');
  if (fs.existsSync(ciDir)) {
    for (const f of fs.readdirSync(ciDir)) {
      if (/^unplaced.*\.json$/.test(f)) for (const it of (readJson(path.join(ciDir, f)) || []))
        if (String(it.id || '').startsWith('poi:')) dropped.add(String(it.id).slice(4));
      if (f === 'indexed.json') for (const it of (readJson(path.join(ciDir, f)) || []))
        if (String(it.id || '').startsWith('poi:')) indexed.add(String(it.id).slice(4));
    }
  }
  return { mapDir, source: inp.source, cfg, pois, report, dropped, indexed };
}

function tierOf(cfg, key) {
  const t = (cfg.poi && cfg.poi.tiers) || {};
  if (!(key in t)) return '';
  const v = t[key];
  return typeof v === 'string' ? v : (v.tier || 'may');
}

// ------------------------------------------------------------------ --all
function findMaps(buses) {
  const out = [];
  const walk = d => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const f = path.join(d, e.name);
      if (/^(ci-reference|S[1-6]-[a-z]+|_latest)$/.test(e.name)) continue;
      // Record AND keep descending. A town is a map and it also CONTAINS maps —
      // `Areas/High Wycombe/Places/High Wycombe Aldi` is a map in its own right,
      // and stopping at the first hit found ten of them and missed four.
      if (fs.existsSync(path.join(f, 'ci-reference', 'osm.json'))) out.push(f);
      walk(f);
    }
  };
  // BOTH map roots. `Areas/` is not the population — `Places/_standalone` holds
  // maps that are under no town at all, and a scan that globs one root reports a
  // healthy-looking figure over the wrong denominator (OA-202's own first cut).
  for (const r of ['Areas', 'Places']) walk(path.join(buses, r));
  return out;
}

if (F.all) {
  const maps = findMaps(BUSES).map(loadMap).filter(Boolean);
  maps.sort((a, b) => b.pois.length - a.pois.length);
  console.log('POIs  frame%  never-named  dropped  classified   map');
  for (const m of maps) {
    const mute = m.pois.filter(p => !printsName(p)).length;
    const cls = Object.keys((m.cfg.poi && m.cfg.poi.tiers) || {}).length;
    console.log(String(m.pois.length).padStart(4)
      + (100 * m.pois.length * POI_BOX_MM2 / FRAME_MM2).toFixed(1).padStart(7) + '%'
      + String(mute).padStart(13) + String(m.dropped.size).padStart(9)
      + String(cls || '-').padStart(12) + '   ' + path.relative(BUSES, m.mapDir));
  }
  process.exit(0);
}

// ------------------------------------------------------------- one worksheet
if (!F.map) { console.error('poi_worksheet: --map "<folder under the buses checkout>" is required, or --all'); process.exit(1); }
const mapDir = path.isAbsolute(F.map) ? F.map : path.join(BUSES, F.map);
const M = loadMap(mapDir);
if (!M) { console.error('poi_worksheet: no osm.json under ' + mapDir + ' (looked in ci-reference/ then S2-geometry/)'); process.exit(1); }

const name = path.basename(mapDir);
const mute = M.pois.filter(p => !printsName(p));
const pct = (100 * M.pois.length * POI_BOX_MM2 / FRAME_MM2).toFixed(1);
const byCat = {};
for (const p of M.pois) (byCat[p.cat] = byCat[p.cat] || []).push(p);
const cats = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length || a.localeCompare(b));
const today = new Date().toISOString().slice(0, 10);

const L = [];
L.push('# ' + name + ' — which of these places matter?');
L.push('');
L.push('Generated ' + today + ' by `poi_worksheet.js` from `' + M.source + '`. **Nothing here is a decision yet.** It is the question, and the answer belongs to somebody who knows the town.');
L.push('');
L.push('## What we are asking, and why');
L.push('');
L.push('The map draws a small symbol for each of the places below — ' + M.pois.length + ' of them. It gets them from OpenStreetMap, which has no opinion about which of them a bus passenger is actually looking for. Each symbol claims a 4.2 mm square of the sheet whether or not there is room to print its name beside it, so these ' + M.pois.length + ' between them reserve about **' + pct + '% of the map area** before a single bus route is drawn. When the sheet runs out of room the name that survives is currently the LONGEST one, which is a sensible way to pack a page and a poor way to decide what matters.');
L.push('');
L.push('So: three answers, one per row.');
L.push('');
L.push('| Answer | What it does to the map |');
L.push('|---|---|');
L.push('| **must** | The name is printed, whatever it costs, and it is placed before everything else. Use it sparingly — every `must` takes room from its neighbours. |');
L.push('| **may** | What happens today. Printed if there is room; if not, it may still get a number in the index beside the map. This is the default, so a blank row means `may`. |');
L.push('| **miss** | Dropped completely — no symbol, no name, no number. It costs the map nothing at all. This is the answer we most need, and the one nobody ever volunteers. |');
L.push('');
L.push('**And if we have the name wrong, write the right one in the last column.** Several of the names below have been tidied by rules this project wrote, which is us guessing what the place is called locally. A shorter, truer name is worth more than a rule.');
L.push('');
L.push('## Two things worth knowing before you start');
L.push('');
L.push('**' + mute.length + ' of the ' + M.pois.length + ' can never show a name at all.** The map only prints names for shops, leisure centres, schools, parks and community centres; everything else — a pharmacy, a GP surgery, a library, an industrial estate — draws a symbol that the Key explains and nothing more. Those rows are marked *symbol only* below. A symbol with no name is not useless, but it costs exactly as much room as one with a name, so it is worth asking whether each is worth its square.');
if (M.dropped.size) L.push('');
if (M.dropped.size) L.push('**' + M.dropped.size + ' of them already lose their name on at least one sheet** — there was no room. They are marked *name dropped now*. If one of those is somewhere people actually catch a bus to, it is a `must`.');
L.push('');
L.push('## The list');
L.push('');
L.push('One table per kind of place, commonest first. Write **must**, **may** or **miss** in the *Answer* column — a blank means `may`.');

for (const c of cats) {
  const rows = byCat[c].slice().sort((a, b) => a.name.localeCompare(b.name));
  const auto = AUTO_NAMED.includes(c);
  L.push('');
  L.push('### ' + c + ' — ' + rows.length + (auto ? '' : '  *(symbol only: the map never prints these names)*'));
  L.push('');
  L.push('| Place | Status now | Answer | Better name? |');
  L.push('|---|---|---|---|');
  for (const p of rows) {
    const key = p.cat + ':' + p.name;
    const st = [];
    if (!auto) st.push('symbol only');
    if (M.dropped.has(key)) st.push('name dropped now');
    if (M.indexed.has(key)) st.push('numbered in the index');
    const cur = tierOf(M.cfg, key);
    if (cur) st.push('**already ' + cur + '**');
    L.push('| ' + p.name.replace(/\|/g, '\\|') + ' | ' + (st.join(', ') || 'printed') + ' |  |  |');
  }
}

L.push('');
L.push('## Handing the answer back');
L.push('');
L.push('This block goes into the map\'s `routes.json`, inside its `"poi"` object, as `"tiers"`. Every key is a real key for this map — it is `"<kind>:<name>"` exactly as the rows above read — and there are no placeholders. Delete the rows nobody answered; a POI with no entry is `may`, which is what it does today. A row can also be written `"<kind>:<name>": { "tier": "must", "as": "Shorter Name" }` to rename it, and `"as"` on its own renames without changing the tier.');
L.push('');
L.push('```json');
L.push('"tiers": {');
const skel = M.pois.slice().sort((a, b) => (a.cat + a.name).localeCompare(b.cat + b.name));
skel.forEach((p, i) => {
  L.push('  ' + JSON.stringify(p.cat + ':' + p.name) + ': "may"' + (i < skel.length - 1 ? ',' : ''));
});
L.push('}');
L.push('```');
L.push('');
L.push('**Then rebuild the map, and read the build warnings.** A `tiers` key that matches nothing is named on `stderr` and does nothing at all, and a `must` the placer still could not seat is named too — a customer answer that failed in silence is worse than one we never asked for.');
L.push('');

const text = L.join('\n') + '\n';
const outArg = F.out || path.join(mapDir, 'poi-worksheet.md');
if (outArg === '-') { process.stdout.write(text); }
else {
  fs.writeFileSync(outArg, text);
  console.log('poi_worksheet: ' + M.pois.length + ' POIs (' + pct + '% of the map frame), '
    + mute.length + ' that can never be named, ' + M.dropped.size + ' already dropped somewhere');
  console.log('  read from : ' + M.source);
  console.log('  written   : ' + outArg);
}
