#!/usr/bin/env node
/* Prove the adopt-knobs row can appear AND can go away (buses-data OA-437, adoption).
 *
 * From this folder (C:\Buses\claude-skills\bus-work\assets), with no
 * placeholders:
 *
 *   node prove-red-knob-adopt.mjs
 *
 * WHAT IS BEING FALSIFIED. A map owes an adoption when its newest S3 types a position
 * the engine now finds itself, or carries a demand-responsive line that is not the
 * register's tagged block. Each case is a PAIR — the S3 that raises the row and the S3
 * that clears it — because a row that never clears is ignored. Asserted: (1) the pure
 * function on every branch, with objects; (2) the demand-responsive verdict through the
 * REAL fact_notes.js, so a change to its check reaches this row; (3) the S3 reader on a
 * manifest written to a temporary folder; (4) THE WIRE in worklist.mjs, and that neither
 * concurrency.mjs nor the loop's row reader treats the row as something else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { knobAdoptItems, knobsOwed, readLatestS3, readKnobInputs } from './knob_adopt.mjs';
import { needsOf } from './concurrency.mjs';
import { parseBusWork } from './loop_health.mjs';
import { GROUPED } from './row_groups.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { bad++; console.error(`  ✗   ${name}${extra ? ' — ' + extra : ''}`); }
};

const ENGINE = path.resolve(HERE, '..', '..', 'make-bus-leaflet', 'assets');
if (!fs.existsSync(path.join(ENGINE, 'fact_notes.js'))) { console.error(`prove-red-knob-adopt: ${ENGINE}/fact_notes.js not found — the engine must sit beside bus-work`); process.exit(2); }
const { checkConfig } = createRequire(import.meta.url)(path.join(ENGINE, 'fact_notes.js'));

const REG = { facts: [{ id: 'SF-900', class: 'drt', scope: ['Alpha', 'Alpha Co-op'], sheetLine: 'Dial-a-Ride: ring 01234 567890.' }] };
const TAGGED = { text: 'Also serving Alpha:', then: [{ fact: 'SF-900', text: 'Dial-a-Ride: ring 01234 567890.' }] };
const town = (name = 'Alpha') => ({ name, built: true, dir: '/x' });
const run = (routes, { towns = [town()], places = [], register = REG, cc = checkConfig } = {}) =>
  knobAdoptItems({ towns, places, readS3: () => ({ id: '2026-10-13_0900', routes }), register, checkConfig: cc, sk: '/sk', buses: '/b' });
const CLEAN = { mapNotes: [TAGGED] };

console.log('1. typed note positions — raised, then cleared');
{
  const r = run({ mapNotes: [TAGGED, { text: 'School buses', x: 10, y: 150, w: 90 }] });
  check('a note with x/y raises adopt-knobs-Alpha', r.items.length === 1 && r.items[0].key === 'adopt-knobs-Alpha');
  check('the row counts the typed note', r.items[0] && r.items[0].why.includes('1 mapNotes entry placed by a typed x/y'));
  check('the row asks for the new notes file', r.items[0] && r.items[0].do.some((d) => / --set-file "<notes.json>"/.test(d.cmd || '')));
  check('the same note with no x/y clears it', run({ mapNotes: [TAGGED, { text: 'School buses', w: 90 }] }).items.length === 0);
  check('a stop-anchored note (at, dx, dy) is not owed', run({ mapNotes: [TAGGED, { at: '0500HHOLY010', text: '300 stops here', dx: 8, dy: -4 }] }).items.length === 0);
  // gen_internal.js draws an `at` note at its stop and reads x/y only if the stop is unknown.
  check('an at note keeping x/y as its fallback is not owed', run({ mapNotes: [TAGGED, { at: '0500HHOLY010', text: '300 stops here', x: 120, y: 80 }] }).items.length === 0);
  check('a lone y is owed too', knobsOwed({ mapNotes: [{ text: 't', y: 3 }] }).typedNotes === 1);
}

console.log('2. the typed layout keys — each raised, then cleared');
for (const [k, routes] of [['legendAt', { legendAt: { x: 10, y: 40 } }], ['legendWrap', { legendWrap: { perRow: 4 } }], ['badgeOffset', { badgeOffset: 16 }], ['externalNoteAt', { externalNoteAt: null }], ['design.howToUse.width', { design: { howToUse: { width: 60 } } }]]) {
  const r = run({ ...CLEAN, ...routes });
  check(`${k} raises the row and is unset by it`, r.items.length === 1 && r.items[0].do.some((d) => (d.cmd || '').includes(` --unset ${k}`)), JSON.stringify(r.items[0] && r.items[0].why));
}
check('with none of them the map is clean', run(CLEAN).items.length === 0);
{
  const r = run({ ...CLEAN, design: { howToUse: { bullets: ['a', 'b', 'c'] } } });
  check('typed bullets raise the row, with the own-words caveat', r.items.length === 1 && r.items[0].do.some((d) => (d.cmd || '').includes('--unset design.howToUse.bullets') && /own words/.test(d.note || '')));
  check('no stored notes means no notes file is asked for', r.items[0] && !r.items[0].do.some((d) => (d.cmd || '').includes('--set-file')));
  check('an empty bullets list is not owed', run({ ...CLEAN, design: { howToUse: { bullets: [] } } }).items.length === 0);
}

console.log('3. not owed: no engine half yet, or not drawn');
check('panelCols.keyAt raises nothing', run({ ...CLEAN, panelCols: { cols: 2, keyAt: { x: 200, y: 104 } } }).items.length === 0);
check('design.keyCols raises nothing', run({ ...CLEAN, design: { keyCols: 2 } }).items.length === 0);
check('a parked mapNotes raises nothing', run({ ...CLEAN, parked: { internalDiagram: { mapNotes: [{ text: 'x', x: 1, y: 2 }] } } }).items.length === 0);
check('an unbuilt map raises nothing', run({ legendAt: {} }, { towns: [{ name: 'Beta', built: false, dir: '/x' }] }).items.length === 0);
check('a map with no S3 raises nothing', knobAdoptItems({ towns: [town()], readS3: () => null, register: REG, checkConfig }).items.length === 0);

console.log('4. demand-responsive lines, through the real fact_notes.js');
{
  const typed = run({ mapNotes: [{ text: 'Also serving Alpha:', then: [{ text: 'Dial-a-Ride: ring 01234 567890.' }] }] });
  check('an untagged hand-typed line raises the row', typed.items.length === 1 && /1 fact not carried/.test(typed.items[0].why));
  check('the row prints the register block first', typed.items[0] && /^node fact_notes\.js --name "Alpha" --facts ".+service-facts\.json"$/.test(typed.items[0].do[0].cmd || ''));
  check('the register\'s tagged block clears it', run(CLEAN).items.length === 0);
  check('a drifted tagged line raises it again', run({ mapNotes: [{ text: 'h', then: [{ fact: 'SF-900', text: 'Dial-a-Ride: ring 0000.' }] }] }).items.length === 1);
  check('a map no fact scopes owes no line', run({ mapNotes: [] }, { towns: [town('Gamma')] }).items.length === 0);
}

console.log('5. blind is not clean');
{
  const r = run({ mapNotes: [{ text: 'x', x: 1, y: 2 }] }, { register: null });
  check('no register gives a warning', /blind, not clean/.test(r.warning || ''));
  check('and still raises the typed-position row', r.items.length === 1);
  check('a readable register gives no warning', run(CLEAN).warning === null);
}

console.log('6. a place');
{
  const place = (town) => ({ name: 'Alpha Co-op', town, built: true, dir: '/p' });
  const r = run({ legendWrap: { perRow: 9 } }, { towns: [], places: [place('Alpha')] });
  check('a place row selects with --place and rebuilds with rollout_places.js', r.items[0] && r.items[0].do.some((d) => /adopt_config\.js --place "Alpha Co-op"/.test(d.cmd || '')) && r.items[0].do.some((d) => /^node rollout_places\.js --place "Alpha Co-op"/.test(d.cmd || '')));
  check('a place row is filed under its town', r.items[0] && r.items[0].towns[0] === 'Alpha');
  check('a standalone place is filed under itself and still a place', (() => { const s = run({ legendWrap: {} }, { towns: [], places: [place(null)] }).items[0]; return s && s.towns[0] === 'Alpha Co-op' && s.do.some((d) => /--place "Alpha Co-op"/.test(d.cmd || '')); })());
  check('the place\'s fact scope is its own name', run({ mapNotes: [] }, { towns: [], places: [place('Alpha')] }).items.length === 1);
}

console.log('7. the readers');
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'knob-adopt-'));
  fs.mkdirSync(path.join(d, 'S3-config', 'b'), { recursive: true });
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ stages: { S3: { latest: 'b', runs: [{ id: 'a', dir: 'S3-config/a' }, { id: 'b', dir: 'S3-config/b' }] } } }));
  fs.writeFileSync(path.join(d, 'S3-config', 'b', 'routes.json'), JSON.stringify({ legendAt: { x: 1 } }));
  const got = readLatestS3({ dir: d });
  check('readLatestS3 reads the run the manifest calls latest', got && got.id === 'b' && got.routes.legendAt.x === 1);
  check('a folder with no manifest reads as null', readLatestS3({ dir: path.join(d, 'none') }) === null);
  fs.writeFileSync(path.join(d, 'service-facts.json'), JSON.stringify(REG));
  const inp = readKnobInputs(ENGINE, d);
  check('readKnobInputs loads the register and the real checkConfig', inp.register && inp.checkConfig === checkConfig && inp.readS3 === readLatestS3);
  check('a missing register reads as null, so the caller says blind', readKnobInputs(ENGINE, path.join(d, 'none')).register === null);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('8. the wire');
{
  const wl = fs.readFileSync(path.join(HERE, 'worklist.mjs'), 'utf8');
  check('worklist imports knob_adopt.mjs', wl.includes("import { knobAdoptItems, readKnobInputs } from './knob_adopt.mjs';"));
  check('worklist raises the rows for towns and places', wl.includes("const k = knobAdoptItems({ towns: tree.towns, places: tree.places || [], ...readKnobInputs(SK || '', BUSES) });"));
  check('worklist reports a blind check and adds the rows', wl.includes('if (k.warning) warnings.push(k.warning); for (const it of k.items) add(it);'));
  const needs = needsOf({ key: 'adopt-knobs-Alpha', type: 'housekeeping' });
  check('adopt-knobs needs buses-tree, buses-maps and engine', ['buses-tree', 'buses-maps', 'engine'].every((n) => needs.includes(n)), JSON.stringify(needs));
  const bw = parseBusWork(JSON.stringify({ items: [{ key: 'adopt-knobs-Alpha', towns: ['Alpha'] }] }));
  check('the loop\'s row reader does not take it as a rebuild or a refresh', bw && bw.rows.length === 0);
  check('the printed board folds the rows by prefix (OA-608)', typeof GROUPED['adopt-knobs-'] === 'function');
}

if (bad) { console.error(`\nprove-red-knob-adopt: ${bad} check(s) failed`); process.exit(1); }
console.log('\nprove-red-knob-adopt: all checks passed');
