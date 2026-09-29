/*
 * owed_at_rebuild.js — what a map's next rebuild owes its S3 (buses-data OA-074, OA-082).
 *
 * Peter ruled on 2026-09-25 that Ely Co-op's road casing is adopted by each town, and a
 * delivered place takes its town's route colours, "at the next rebuild". A rollout carries
 * S3 unchanged and a full rebuild copies the old S3, so neither made them unless somebody
 * remembered; these tests hold the report that now says so, on both paths.
 *
 * Every "owed" case has a CONTROL beside it that must answer nothing, because a report
 * that has only ever been seen to speak has not been shown to know when to stay quiet.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');
const { ENGINE_DIR, load } = require('./_engine.js');
const { casingOwed, paletteOwed, owedLines, CASING } = load('owed_at_rebuild.js');

const STAGE = path.join(ENGINE_DIR, 'stage.js');

/* Areas/Testton with a committed-looking ci-reference palette, and one place under it. */
function estate(townPalette) {
  const root = scratchDir('owed-');
  const town = path.join(root, 'Areas', 'Testton');
  fs.mkdirSync(path.join(town, 'ci-reference'), { recursive: true });
  fs.writeFileSync(path.join(town, 'manifest.json'), JSON.stringify({ town: 'Testton', stages: {} }));
  fs.writeFileSync(path.join(town, 'ci-reference', 'routes.json'), JSON.stringify({ palette: townPalette }));
  const place = path.join(town, 'Places', 'Testton Co-op');
  fs.mkdirSync(place, { recursive: true });
  const standalone = path.join(root, 'Places', '_standalone', 'Elsewhere Co-op');
  fs.mkdirSync(standalone, { recursive: true });
  return { town, place, standalone };
}

test('OA-074: a town drawing casing without Ely\'s values owes them, and says which it has', () => {
  const { town } = estate({});
  const l = casingOwed(town, { internalRoads: { stroke: 1.7, gap: 2.8 } });
  assert.match(l, /is 1\.7 \/ 2\.8 \/ default, owed 2 \/ 2\.6 \/ 0\.9/);
  assert.match(l, /OA-074/);
});

test('OA-074 CONTROL: a town that has adopted all three, a town with no casing, and a place owe nothing', () => {
  const { town, place } = estate({});
  assert.strictEqual(casingOwed(town, { internalRoads: { ...CASING } }), null);
  assert.strictEqual(casingOwed(town, {}), null, 'no internalRoads block draws no casing to change');
  assert.strictEqual(casingOwed(place, { internalRoads: {} }), null, 'the ruling is for towns');
});

test('OA-074 exemption: Areas/St Ives keeps its hand-tuned casing and owes nothing (Peter, 2026-09-29)', () => {
  const root = scratchDir('owed-exempt-');
  const stIves = path.join(root, 'Areas', 'St Ives');
  fs.mkdirSync(stIves, { recursive: true });
  assert.strictEqual(casingOwed(stIves, { internalRoads: { stroke: 1.7, gap: 2.8 } }), null);
  assert.deepStrictEqual(owedLines(stIves, { internalRoads: { stroke: 1.7, gap: 2.8 } }), []);
});

test('OA-074 exemption CONTROL: the exemption is St Ives\'s town folder, not the name anywhere else', () => {
  const root = scratchDir('owed-exempt-');
  const other = path.join(root, 'Areas', 'St Neots');
  const notArea = path.join(root, 'Elsewhere', 'St Ives');
  fs.mkdirSync(other, { recursive: true });
  fs.mkdirSync(notArea, { recursive: true });
  assert.match(casingOwed(other, { internalRoads: { stroke: 1.7, gap: 2.8 } }), /OA-074/);
  assert.match(casingOwed(notArea, { internalRoads: { stroke: 1.7, gap: 2.8 } }), /OA-074/);
});

test('OA-082: a place whose colours differ from its town\'s owes the change, route by route', () => {
  const { place } = estate({ '12': '#4477AA', '66': '#228833' });
  const l = paletteOwed(place, { palette: { '12': '#EE6677', '66': '#228833' }, routeOrder: ['12', '66'] });
  assert.match(l, /1 route colour\(s\) differ from Testton's: 12 #EE6677 -> #4477AA/);
  assert.match(l, /OA-082/);
});

test('OA-082 CONTROL: a place already wearing its town\'s colours, a standalone place, and a town owe nothing', () => {
  const { town, place, standalone } = estate({ '12': '#4477AA' });
  assert.strictEqual(paletteOwed(place, { palette: { '12': '#4477AA' } }), null);
  assert.strictEqual(paletteOwed(standalone, { palette: { '12': '#EE6677' } }), null, 'no town to follow');
  assert.strictEqual(paletteOwed(town, { palette: { '12': '#EE6677' } }), null, 'a town is not a place');
});

test('owedLines gathers both, and nothing when nothing is owed', () => {
  const { town, place } = estate({ '12': '#4477AA' });
  assert.strictEqual(owedLines(town, { internalRoads: {} }).length, 1);
  assert.strictEqual(owedLines(place, { palette: { '12': '#EE6677' }, internalRoads: {} }).length, 1);
  assert.deepStrictEqual(owedLines(town, { internalRoads: { ...CASING } }), []);
});

/* The FULL rebuild path. stage.js is a CLI, so it is spawned, not required. */
function commitS3(routes) {
  const town = scratchDir('owed-stage-');
  assert.strictEqual(spawnSync(process.execPath, [STAGE, 'init', town, 'Testton'], { encoding: 'utf8' }).status, 0);
  const d = path.join(town, 'S3-config', '2026-09-27_1200');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'routes.json'), JSON.stringify(routes));
  return spawnSync(process.execPath, [STAGE, 'commit', 'S3', d, '--outputs', 'routes.json'], { cwd: town, encoding: 'utf8' });
}

test('stage.js commit S3 prints what the committed routes.json owes, and still commits', () => {
  const r = commitS3({ internalRoads: { stroke: 1.7 } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /OWED IN S3: road casing/);
});

test('stage.js commit S3 CONTROL: an S3 that owes nothing prints no OWED line', () => {
  const r = commitS3({ internalRoads: { ...CASING } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /OWED/);
});

/* OA-071 on the same path: an alike-hue pair needs a drawn sheet, so it is S4's commit
 * that says so. A hand-built S4 carries none of build_s4.js's records, hence the four
 * --force flags, each of which only says that record is absent on purpose. */
function commitS4(y2) {
  const town = scratchDir('owed-s4-');
  assert.strictEqual(spawnSync(process.execPath, [STAGE, 'init', town, 'Testton'], { encoding: 'utf8' }).status, 0);
  const d = path.join(town, 'S4-generate', 'v1.0_2026-09-27_1200');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'internal.svg'), ['<svg viewBox="0 0 297 210">',
    '<line x1="20" y1="50" x2="200" y2="50" stroke="#e41a1c" stroke-width="2"/>',
    `<line x1="20" y1="${y2}" x2="200" y2="${y2}" stroke="#e8141f" stroke-width="2"/>`,
    '</svg>'].join('\n'));
  fs.writeFileSync(path.join(d, 'routes.json'), JSON.stringify({ palette: { A: '#e41a1c', B: '#e8141f' } }));
  return spawnSync(process.execPath, [STAGE, 'commit', 'S4', d, '--outputs', 'internal.svg,routes.json',
    '--force-stamps', '--force-meta', '--force-nolog', '--force-nogen'], { cwd: town, encoding: 'utf8' });
}

test('stage.js commit S4 prints HUES ALIKE for two alike hues that run together (OA-071)', () => {
  const r = commitS4(52);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /HUES ALIKE in internal\.svg: A vs B/);
});

test('stage.js commit S4 CONTROL: the same two hues far apart print nothing', () => {
  const r = commitS4(150);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /HUES ALIKE/);
});
