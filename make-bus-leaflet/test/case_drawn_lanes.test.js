/*
 * case_drawn_lanes — internalRoads.caseDrawnLanes (buses-data OA-518).
 *
 * The grey road casing is sized on each matched edge from the lanes whose
 * centreline passes near it, so where a short loop collapses under its lane shift
 * the casing traces the whole loop at bundle width round ink that never reaches it
 * (Ely Co-op's lobes at Tesco, St Ives' knot). With the key set to true the casing
 * is drawn along each route's DRAWN line instead, one stroke + pad wide, so
 * co-running lanes fuse into a band and there is no grey without ink.
 *
 * The fixture is High Wycombe Town Centre's S4 inputs (shared with anchor_badge).
 * The test asks the SVG: with the key absent the sheet carries bundle-width
 * single-segment casings; with it on it carries none, every casing is stroke + pad,
 * and no text on the sheet moves, because road labels still read the matched edges.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine.js');
const { internalRoadsConfig } = require(path.join(ENGINE_DIR, 'internal_roads_config.js'));

const FIXTURE = path.join(__dirname, 'fixtures', 'anchor-badge');

function draw(caseDrawnLanes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa518-'));
  for (const f of fs.readdirSync(FIXTURE)) fs.copyFileSync(path.join(FIXTURE, f), path.join(dir, f));
  const rj = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8'));
  if (caseDrawnLanes) rj.internalRoads = { ...rj.internalRoads, caseDrawnLanes: true };
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(rj, null, 2));
  const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, 'gen_internal.js')],
    { cwd: dir, env: { ...process.env, LEAFLET_DIR: dir, SKILL_ASSETS: ENGINE_DIR, OVERRIDES_FILE: '' }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'gen_internal.js failed: ' + String(r.stderr).slice(-400));
  const svg = fs.readFileSync(path.join(dir, 'internal.svg'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { svg, IR: internalRoadsConfig(rj) };
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the bundle loop's casing: one straight segment, round cap, no join
const segCasings = (svg, IR) => [...svg.matchAll(new RegExp('<path d="M[\\d.-]+ [\\d.-]+L[\\d.-]+ [\\d.-]+" fill="none" stroke="' + esc(IR.skeleton) + '" stroke-width="([\\d.]+)" stroke-linecap="round"/>', 'g'))].map(m => +m[1]);
// the drawn-line casing: a polyline, round cap and round join
const laneCasings = (svg, IR) => [...svg.matchAll(new RegExp('<path d="M[^"]*" fill="none" stroke="' + esc(IR.skeleton) + '" stroke-width="([\\d.]+)" stroke-linecap="round" stroke-linejoin="round"/>', 'g'))].map(m => +m[1]);
const texts = svg => [...svg.matchAll(/<text [^>]*>[^<]*<\/text>/g)].map(m => m[0]).sort();

test('caseDrawnLanes absent: the casing is sized by the bundle, as every map before OA-518', () => {
  const { svg, IR } = draw(false);
  const w = segCasings(svg, IR);
  assert.ok(w.length > 50, 'found only ' + w.length + ' segment casings, so the parser is not reading this sheet');
  assert.ok(w.some(x => x > IR.stroke + IR.skeletonPad + IR.gap - 0.01), 'no bundle-width casing on the fixture: it cannot show the key doing anything');
});

test('caseDrawnLanes true: every casing follows a drawn line at stroke + pad, and no text moves', () => {
  const off = draw(false), on = draw(true);
  const cw = +(on.IR.stroke + on.IR.skeletonPad).toFixed(2);
  assert.deepStrictEqual(segCasings(on.svg, on.IR), [], 'bundle-loop casings are still drawn with the key on');
  const w = laneCasings(on.svg, on.IR);
  assert.ok(w.length >= 5, 'found only ' + w.length + ' drawn-line casings');
  assert.deepStrictEqual([...new Set(w)], [cw], 'a drawn-line casing is not stroke + pad wide');
  assert.deepStrictEqual(texts(on.svg), texts(off.svg), 'a label moved: road labels must still read the matched edges');
});
