#!/usr/bin/env node
/*
 * prove-red-journey-line.js — falsify match_routes.js reading journey_weights.json
 * (buses-data OA-452).
 *
 * WHAT IS BEING PROVED. `derive_intown.js` has read journey_weights.json since
 * claude-skills #135 and drops a direction's minority stops from the TICKS. The LINE
 * is match_routes.js's, built from the canonical direction in routes_full_atco.json,
 * and until this harness's change it did not read the file: St Neots v5.0 drew the
 * 18's ticks on the majority pattern and its line down the 7-of-25 Eynesbury working,
 * and needed match_cfg.json viaExclude["18"] set by hand to the same 24 stops
 * (buses-data a4d3cc3e). Nothing failed; the line was simply somewhere else.
 *
 * The fixture is a 2 km straight main road with a 670 m spur north off its middle,
 * and one route whose canonical direction calls at a stop on the tip of the spur — a
 * minority working, as St Neots' station loop was. The instrument is the line's
 * furthest point north of the main road.
 *
 * Five cases:
 *   1. default            no journey_weights.json: the line runs up the spur
 *   2. weights            the file drops the spur stop: the line stays on the road
 *   3. switched off       intown_cfg.json "journeyWeights": false: byte-identical to 1
 *   4. inert by name      a drop listed under ANOTHER direction's name: identical to 1
 *                         — the file cannot move a line it does not name
 *   5. PROVE RED          with the drop disabled in a copy of match_routes.js, case 2
 *                         must FAIL
 *
 * Run from C:\u3a St Ives\.claude\skills\make-bus-leaflet — no placeholders:
 *   npm run test:prove-red-journey-line
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scratchDir } = require('../assets/scratch');
const { writeBrokenCopy } = require('./lib/broken_copy');

const MATCH = path.join(__dirname, '..', 'assets', 'match_routes.js');
let failures = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!cond) failures++;
};

// ---- the fixture: a main road and a spur ----------------------------------
const LAT0 = 52.0, LON0 = 0.0;
const W = [LAT0, LON0], MID = [LAT0, LON0 + 0.015], E = [LAT0, LON0 + 0.030];
const TIP = [LAT0 + 0.006, LON0 + 0.015];            // ~670 m north of the road
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dense = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
function way(id, name, from, to, n) {
  const geometry = dense(from, to, n);
  return { id, tags: { name, highway: 'unclassified' }, nodes: geometry.map((_, i) => id * 100 + i), geometry };
}
// The spur shares the main road's middle node so the graph is connected there.
const west = way(1, 'Main Road', W, MID, 10), east = way(2, 'Main Road', MID, E, 10);
east.nodes[0] = west.nodes[west.nodes.length - 1];
const roads_geo = {
  bbox: [LAT0 - 0.003, LON0 - 0.003, LAT0 + 0.009, LON0 + 0.033],
  ways: [west, east, (() => { const s = way(3, 'Spur Lane', MID, TIP, 8); s.nodes[0] = west.nodes[west.nodes.length - 1]; return s; })()]
};
const S = {
  FIXJ001: lerp(W, MID, 0.2), FIXJ002: lerp(W, MID, 0.8),
  FIXJSPUR: TIP,
  FIXJ003: lerp(MID, E, 0.2), FIXJ004: lerp(MID, E, 0.8),
  FARW001: [LAT0, LON0 - 0.2], FARE001: [LAT0, LON0 + 0.2]
};
const OUT = ['FARW001', 'FIXJ001', 'FIXJ002', 'FIXJSPUR', 'FIXJ003', 'FIXJ004', 'FARE001'];
const BACK = OUT.slice().reverse();
const routes_full = {
  R1: { directions: [{ name: 'West to East', stops: OUT }, { name: 'East to West', stops: BACK }],
        canonical: [{ name: 'West to East', stops: OUT }], all: OUT.concat(BACK) }
};
const routes_intown = { R1: ['FIXJ001', 'FIXJ002', 'FIXJ003', 'FIXJ004'] };
const weights = dirName => ({ R1: { [dirName]: { journeys: 20, drop: ['FIXJSPUR'] } } });

function run(matchJs, files) {
  const d = scratchDir('journeyline-');
  const all = Object.assign({
    'roads_geo.json': roads_geo, 'atco2ll.json': S,
    'atco2name.json': Object.fromEntries(Object.keys(S).map(k => [k, k])),
    'routes_full_atco.json': routes_full, 'routes_intown_atco.json': routes_intown
  }, files || {});
  for (const f in all) fs.writeFileSync(path.join(d, f), JSON.stringify(all[f]));
  execFileSync(process.execPath, [matchJs], { cwd: d, env: Object.assign({}, process.env, { LEAFLET_DIR: d }), stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(path.join(d, 'routes_paths.json'), 'utf8')).routes.R1;
}
const northM = r => Math.round(Math.max(...r.pts.map(p => p[0] - LAT0)) * 111320);

console.log('prove-red-journey-line: match_routes.js reads journey_weights.json (OA-452)');
console.log('  fixture: a 2 km main road, a 670 m spur, one route whose canonical direction calls up the spur');
console.log('');

// 300 m / 30 m: the spur tip is ~670 m north and the road is at 0 m, so each bound
// sits far from both the fault and the fix and a small change to the fixture moves
// neither case across it.
const base = run(MATCH);
ok('1. with no journey_weights.json the line runs up the spur (> 300 m north)', northM(base) > 300, northM(base) + ' m');

const fixd = run(MATCH, { 'journey_weights.json': weights('West to East') });
ok('2. journey_weights.json keeps the line on the main road (< 30 m north)', northM(fixd) < 30, northM(fixd) + ' m');

const off = run(MATCH, { 'journey_weights.json': weights('West to East'), 'intown_cfg.json': { journeyWeights: false } });
ok('3. intown_cfg.json "journeyWeights": false is byte-identical to case 1',
   JSON.stringify(off) === JSON.stringify(base), northM(off) + ' m');

const other = run(MATCH, { 'journey_weights.json': weights('East to West') });
ok('4. a drop under the OTHER direction leaves the canonical line byte-identical to case 1',
   JSON.stringify(other) === JSON.stringify(base), northM(other) + ' m');

// ---- 5. PROVE RED ---------------------------------------------------------
const ANCHOR = '    const jd = jwDrop(r, can.name);';
if (fs.readFileSync(MATCH, 'utf8').split(ANCHOR).length !== 2) {
  ok('5. PROVE RED — the anchor this harness breaks still exists in match_routes.js', false,
     'the line it edits has moved; rewrite this case rather than deleting it');
} else {
  const broken = writeBrokenCopy(MATCH, ANCHOR, '    const jd = new Set();', 'match_routes_jwbroken');
  let red = false, why = '';
  try {
    const b = run(broken, { 'journey_weights.json': weights('West to East') });
    red = !(northM(b) < 30);
    why = northM(b) + ' m';
  } catch (e) { red = true; why = 'match_routes.js threw: ' + String(e.message).split('\n')[0]; }
  fs.unlinkSync(broken);
  ok('5. PROVE RED — with the drop disabled, case 2 fails', red, why);
}

console.log('');
console.log(failures ? 'prove-red-journey-line: ' + failures + ' FAILURE(S)'
                     : 'prove-red-journey-line: all 5 cases as expected');
process.exit(failures ? 1 : 0);
