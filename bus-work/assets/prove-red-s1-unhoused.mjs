#!/usr/bin/env node
/* Prove the s1-unhoused row can appear AND can go away (buses-data OA-655).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), with no
 * placeholders:
 *
 *   node prove-red-s1-unhoused.mjs
 *
 * WHAT IS BEING FALSIFIED. A map owes a home for every service its newest S1 decided
 * in, and its newest S4 is where s1_drawn_check.js says which have none. Each case is a
 * PAIR — the S4 that raises the row and the S4 that clears it — because a row that
 * never clears is ignored. Asserted: (1) the pure function on every branch, with
 * objects; (2) the verdict through the REAL s1_drawn_check.js on a map written to a
 * temporary folder, so a change to its rules reaches this row; (3) a missing engine
 * file is blind, not clean; (4) THE WIRE in worklist.mjs, that neither concurrency.mjs
 * nor the loop's row reader treats the row as something else, and that the printed
 * board folds the rows into one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { s1UnhousedItems, readS1Check } from './s1_unhoused.mjs';
import { needsOf } from './concurrency.mjs';
import { parseBusWork } from './loop_health.mjs';
import { GROUPED, groupForPrint } from './row_groups.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const ENGINE = path.resolve(HERE, '..', '..', 'make-bus-leaflet', 'assets');
if (!fs.existsSync(path.join(ENGINE, 's1_drawn_check.js'))) { console.error(`prove-red-s1-unhoused: ${ENGINE}/s1_drawn_check.js not found — the engine must sit beside bus-work`); process.exit(2); }

const town = (name = 'Alpha') => ({ name, built: true, dir: '/x', s4Dir: `/x/S4-generate/${name}-run` });
const run = (verdict, { towns = [town()], places = [] } = {}) =>
  s1UnhousedItems({ towns, places, check: () => verdict, sk: '/sk' });
const V = (fresh = [], shipped = [], notRun = null) => ({ fresh, shipped, notRun, messages: [] });

console.log('1. a shipped gap — raised, then cleared');
{
  const r = run(V([], [{ route: 'DAR' }, { route: '18A' }]));
  check('a shipped gap raises s1-unhoused-Alpha', r.length === 1 && r[0].key === 's1-unhoused-Alpha' && r[0].rank === 8 && r[0].type === 'housekeeping');
  check('the title counts the services', r[0] && /ships 2 S1 services with no home/.test(r[0].title));
  check('the why names each service', r[0] && r[0].why.includes('DAR, 18A'));
  check('the why says S4 warns and does not refuse', r[0] && /warns and does not refuse/.test(r[0].why));
  check('the why names the S4 folder for the command', r[0] && r[0].why.includes('"/x/S4-generate/Alpha-run"') && r[0].do[0].cmd === 'node s1_drawn_check.js --dir "<S4 folder>"');
  check('the row rides with the next rebuild', r[0] && /next S3/.test(r[0].why) && /next rebuild/.test(r[0].who));
  check('every service housed clears it', run(V()).length === 0);
}

console.log('2. a fresh gap says the next S4 refuses');
{
  const r = run(V([{ route: '9' }], [{ route: 'DAR' }]));
  check('a fresh gap raises the row', r.length === 1 && /ships 2 S1 services/.test(r[0].title));
  check('and says the next S4 refuses', /1 of them was not on the published sheet/.test(r[0].why) && /refuses until it has a home/.test(r[0].why));
  check('a key that is not the route is printed beside it', (run(V([], [{ route: '1', key: '1@SCCM' }]))[0] || { why: '' }).why.includes('1 (key 1@SCCM)'));
  check('one service is singular', /ships 1 S1 service with/.test((run(V([], [{ route: '1' }]))[0] || {}).title));
}

console.log('3. no row where nothing can be said');
check('a check that did not run raises nothing', run(V([], [{ route: '1' }], 'no S1 services file in the map\'s newest S1 run')).length === 0);
check('a null verdict raises nothing', run(null).length === 0);
check('an unbuilt map raises nothing', run(V([], [{ route: '1' }]), { towns: [{ ...town(), built: false }] }).length === 0);
check('a map with no S4 folder raises nothing', run(V([], [{ route: '1' }]), { towns: [{ ...town(), s4Dir: null }] }).length === 0);

console.log('4. a place');
{
  const place = (t) => ({ name: 'Alpha Co-op', town: t, built: true, dir: '/p', s4Dir: '/p/S4-generate/r' });
  const r = run(V([], [{ route: '1' }]), { towns: [], places: [place('Alpha')] });
  check('a place row is keyed by the place and filed under its town', r[0] && r[0].key === 's1-unhoused-Alpha Co-op' && r[0].towns[0] === 'Alpha');
  check('a standalone place is filed under itself', (run(V([], [{ route: '1' }]), { towns: [], places: [place(null)] })[0] || { towns: [] }).towns[0] === 'Alpha Co-op');
}

console.log('5. through the real s1_drawn_check.js');
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 's1-unhoused-'));
  const map = path.join(d, 'Alpha');
  fs.mkdirSync(path.join(map, 'S1-services', 'a'), { recursive: true });
  fs.mkdirSync(path.join(map, 'S4-generate', 'b'), { recursive: true });
  fs.writeFileSync(path.join(map, 'manifest.json'), JSON.stringify({ stages: { S1: { latest: 'a', runs: [{ id: 'a', dir: 'S1-services/a' }] } } }));
  fs.writeFileSync(path.join(map, 'S1-services', 'a', 'verified-services.json'), JSON.stringify({ services: [{ route: '1' }, { route: '2' }] }));
  const s4 = path.join(map, 'S4-generate', 'b');
  const write = (routes) => fs.writeFileSync(path.join(s4, 'routes.json'), JSON.stringify(routes));
  const s = readS1Check(ENGINE);
  const live = (routes) => { write(routes); return s1UnhousedItems({ towns: [{ name: 'Alpha', built: true, dir: map, s4Dir: s4 }], check: s.check, sk: ENGINE }); };
  check('readS1Check loads the engine with no warning', s.warning === null);
  const raised = live({ routeOrder: ['1'] });
  check('route 2 in S1 and drawn nowhere raises the row', raised.length === 1 && raised[0].why.includes('leaves 2 in none'), JSON.stringify(raised[0] && raised[0].why));
  check('with nothing published it is a new gap', raised[0] && /refuses until it has a home/.test(raised[0].why));
  check('declaring 2 notShown clears it', live({ routeOrder: ['1'], notShown: ['2'] }).length === 0);
  check('recording 2 in notOnLeaflet[] clears it', live({ routeOrder: ['1'], notOnLeaflet: [{ route: '2', reason: 'a note carries it' }] }).length === 0);
  fs.mkdirSync(path.join(map, 'ci-reference'));
  fs.writeFileSync(path.join(map, 'ci-reference', 'routes.json'), JSON.stringify({ routeOrder: ['1'] }));
  const shipped = live({ routeOrder: ['1'] });
  check('the same gap in the published sheet is shipped, not new', shipped.length === 1 && /warns and does not refuse/.test(shipped[0].why));
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('6. blind is not clean');
{
  const s = readS1Check(path.join(os.tmpdir(), 'no-engine-here'));
  check('a missing engine file gives a warning', /blind, not clean/.test(s.warning || ''));
  check('and a check that says nothing', s.check({ s4Dir: '/x' }) === null);
  check('no engine folder at all is blind too', /blind/.test(readS1Check('').warning || ''));
}

console.log('7. the wire');
{
  const wl = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  check('worklist imports s1_unhoused.mjs', wl.includes("import { s1UnhousedItems, readS1Check } from './s1_unhoused.mjs';"));
  check('worklist raises the rows for towns and places and reports a blind check', wl.includes("{ const s = readS1Check(SK || ''); if (s.warning) warnings.push(s.warning); for (const it of s1UnhousedItems({ towns: tree.towns, places: tree.places || [], check: s.check, sk: SK || '' })) add(it); }"));
  check('the tree walk keeps each town\'s and place\'s S4 folder', (wl.match(/s4Dir: s4 \? s4\.dir : null/g) || []).length === 2);
  const needs = needsOf({ key: 's1-unhoused-Alpha', type: 'housekeeping' });
  check('s1-unhoused needs buses-tree, buses-maps and engine', ['buses-tree', 'buses-maps', 'engine'].every((n) => needs.includes(n)), JSON.stringify(needs));
  const bw = parseBusWork(JSON.stringify({ items: [{ key: 's1-unhoused-Alpha', towns: ['Alpha'] }] }));
  check('the loop\'s row reader does not take it as a rebuild or a refresh', bw && bw.rows.length === 0);
  check('GROUPED names the prefix', typeof GROUPED['s1-unhoused-'] === 'function');
  const rows = run(V([], [{ route: '1' }]), { towns: [town('Alpha'), town('Beta')] });
  const printed = groupForPrint(rows);
  check('two maps fold into one printed row', printed.length === 1 && printed[0].members.length === 2 && /2 maps ship/.test(printed[0].title), JSON.stringify(printed.map((p) => p.title || p.key)));
  check('and the folded row still names each S4 folder', printed[0] && printed[0].detail.includes('Alpha-run') && printed[0].detail.includes('Beta-run'));
}

if (bad) { console.error(`\nprove-red-s1-unhoused: ${bad} check(s) failed`); process.exit(1); }
console.log('\nprove-red-s1-unhoused: all checks passed');
