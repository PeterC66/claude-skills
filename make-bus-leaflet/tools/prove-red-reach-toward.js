#!/usr/bin/env node
/*
 * prove-red-reach-toward.js — falsify match_cfg.json's `reachToward` lever (buses-data OA-451 item 5).
 *
 * WHAT IS BEING PROVED. A route whose next stop is a long NON-STOP run away ends its
 * matched line at its last in-box stop, so gen_internal.js draws its "to X" arrow
 * there, mid-map. St Neots East's 905 did: Loves Way, then nothing until Cambridge,
 * 22 km on, and the arrow sat 24 mm short of the frame. `reachExtend` cannot help —
 * it adds whole next stops to the pull, and that stop is a county away.
 * `reachToward: { "<route>": { "start"|"end": <km> } }` carries the line along the
 * road graph toward that stop, bounded in km (reach_toward.js says why).
 *
 * The fixture is synthetic and needs no data tree: one straight east-west road of
 * 31 nodes 200 m apart, two stops on it, and a third stop 20 km further east, off
 * the road graph, where the route goes next.
 *
 * Six cases:
 *   1. default            the fault reproduces: the line ends at the last in-box stop
 *   2. reachToward end    the line carries on along the road about 1 km toward the
 *                         next stop, every edge on the road, and the ticks do not move
 *   3. reachToward start  the same on the other end, the chain run the other way; the
 *                         ticks re-index with the prepended points and stay on the line
 *   4. bounded            the aim point is exactly <km> from the last stop, and never
 *                         past the next stop however large <km> is
 *   5. inert              with the key absent, or naming another route, the output is
 *                         byte-identical to the default
 *   6. PROVE RED          with the lever disabled in a copy of match_routes.js, case 2
 *                         must FAIL. A check never seen to go red proves nothing.
 *
 * Run from C:\Buses\claude-skills\make-bus-leaflet — no placeholders:
 *   npm run test:prove-red-reach-toward
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scratchDir } = require('../assets/scratch');
const { writeBrokenCopy } = require('./lib/broken_copy');
const { aimPoint } = require('../assets/reach_toward');

const MATCH = path.join(__dirname, '..', 'assets', 'match_routes.js');
let failures = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!cond) failures++;
};

// ---- the fixture: a straight road at latitude 52.2 --------------------------
const LAT = 52.2, KX = 111.32 * Math.cos(LAT * Math.PI / 180);   // km per degree of longitude
const STEP = 0.2 / KX;                                           // 200 m of longitude
const N = 31;
const ROAD = {
  id: 1, tags: { name: 'Straight Road', highway: 'primary' },
  nodes: Array.from({ length: N }, (_, i) => 1000 + i),
  geometry: Array.from({ length: N }, (_, i) => [LAT, i * STEP])
};
// the box covers the first ~2 km of road, where the two stops are; the road runs on
const roads_geo = { bbox: [LAT - 0.01, -0.005, LAT + 0.01, 30 * STEP + 0.001], ways: [ROAD] };
const S = {
  STOPA: [LAT, 0],                 // node 0
  STOPB: [LAT, 5 * STEP],          // node 5, 1 km east
  FARC: [LAT, 5 * STEP + 20 / KX]  // 20 km further east: the non-stop run's next stop
};
const EAST = ['STOPA', 'STOPB', 'FARC'], WEST = ['FARC', 'STOPB', 'STOPA'];
const full = chain => ({ directions: [{ name: 'Out', stops: chain }], canonical: [{ name: 'Out', stops: chain }], all: chain });

function run(matchJs, chain, cfg) {
  const d = scratchDir('reachtoward-');
  fs.writeFileSync(path.join(d, 'roads_geo.json'), JSON.stringify(roads_geo));
  fs.writeFileSync(path.join(d, 'atco2ll.json'), JSON.stringify(S));
  fs.writeFileSync(path.join(d, 'atco2name.json'), JSON.stringify(Object.fromEntries(Object.keys(S).map(k => [k, k]))));
  fs.writeFileSync(path.join(d, 'routes_full_atco.json'), JSON.stringify({ X9: full(chain) }));
  fs.writeFileSync(path.join(d, 'routes_intown_atco.json'), JSON.stringify({ X9: chain.filter(a => a !== 'FARC') }));
  if (cfg) fs.writeFileSync(path.join(d, 'match_cfg.json'), JSON.stringify(cfg));
  execFileSync(process.execPath, [matchJs], { cwd: d, env: Object.assign({}, process.env, { LEAFLET_DIR: d }), stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(path.join(d, 'routes_paths.json'), 'utf8'));
}
const kmE = lon => lon * KX;                                     // km east of STOPA
const onRoad = pts => pts.every(p => Math.abs(p[0] - LAT) < 1e-6);
const tickAt = (R, a) => { const o = R.stopT[a]; const p = R.pts[o.i], q = R.pts[o.i + 1] || p; return p[1] + (q[1] - p[1]) * o.t; };

console.log('prove-red-reach-toward: match_cfg.json reachToward (buses-data OA-451 item 5)');
console.log('  fixture: a straight road, two stops 1 km apart, and the next stop 20 km on');
console.log('');

const base = run(MATCH, EAST, null).routes.X9;
const baseEnd = kmE(base.pts[base.pts.length - 1][1]);
ok('1. default reproduces the fault (the line ends at the last in-box stop, which continues)',
   Math.abs(baseEnd - 1) < 0.01 && base.contEnd === true, 'line ends ' + baseEnd.toFixed(3) + ' km east, contEnd ' + base.contEnd);

const on = run(MATCH, EAST, { reachToward: { X9: { end: 1 } } }).routes.X9;
const onEnd = kmE(on.pts[on.pts.length - 1][1]);
ok('2. reachToward end: 1 carries the line ~1 km on along the road, the ticks unmoved',
   Math.abs(onEnd - 2) < 0.15 && onRoad(on.pts) && on.edges.length === on.pts.length - 1 && on.edges.every(e => e)
   && on.contEnd === true && JSON.stringify(on.stopT) === JSON.stringify(base.stopT),
   'line ends ' + onEnd.toFixed(3) + ' km east, ' + on.pts.length + ' pts, ' + on.edges.length + ' edges');

const wBase = run(MATCH, WEST, null).routes.X9;
const wOn = run(MATCH, WEST, { reachToward: { X9: { start: 1 } } }).routes.X9;
const wStart = kmE(wOn.pts[0][1]);
const ticksHeld = ['STOPA', 'STOPB'].every(a => Math.abs(tickAt(wOn, a) - tickAt(wBase, a)) < 1e-9 && wOn.stopT[a].d === wBase.stopT[a].d);
ok('3. reachToward start: 1 does the same on the other end, and the ticks re-index onto the same spot',
   Math.abs(wStart - 2) < 0.15 && onRoad(wOn.pts) && wOn.edges.length === wOn.pts.length - 1 && ticksHeld
   && wOn.stopT.STOPB.i > wBase.stopT.STOPB.i,
   'line starts ' + wStart.toFixed(3) + ' km east, STOPB tick i ' + wBase.stopT.STOPB.i + ' -> ' + wOn.stopT.STOPB.i);

const a1 = aimPoint(S.STOPB, S.FARC, 1.5), a2 = aimPoint(S.STOPB, S.FARC, 500);
ok('4. the aim point is <km> from the last stop, and never past the next stop',
   Math.abs(kmE(a1[1]) - kmE(S.STOPB[1]) - 1.5) < 1e-9 && a2[0] === S.FARC[0] && a2[1] === S.FARC[1]
   && aimPoint(S.STOPB, S.FARC, 0) === null,
   'aim 1.5 km -> ' + (kmE(a1[1]) - kmE(S.STOPB[1])).toFixed(3) + ' km; aim 500 km lands on the stop');

const none = run(MATCH, EAST, {}), other = run(MATCH, EAST, { reachToward: { Z1: { end: 3 } } }), plain = run(MATCH, EAST, null);
ok('5. inert with the key absent or naming another route',
   JSON.stringify(none) === JSON.stringify(plain) && JSON.stringify(other) === JSON.stringify(plain),
   'identical: ' + (JSON.stringify(none) === JSON.stringify(plain)) + ', ' + (JSON.stringify(other) === JSON.stringify(plain)));

// ---- 6. PROVE RED ---------------------------------------------------------
const src = fs.readFileSync(MATCH, 'utf8');
const ANCHOR = 'const RT = (MCFG.reachToward || {})[r];';
if (src.split(ANCHOR).length !== 2) {
  ok('6. PROVE RED — the anchor this harness breaks still exists in match_routes.js', false,
     'the line it edits has moved; rewrite this case rather than deleting it');
} else {
  const broken = writeBrokenCopy(MATCH, ANCHOR, 'const RT = null;', 'match_routes_reachtoward_broken');
  let red = false, why = '';
  try {
    const b = run(broken, EAST, { reachToward: { X9: { end: 1 } } }).routes.X9;
    const e = kmE(b.pts[b.pts.length - 1][1]);
    red = !(Math.abs(e - 2) < 0.15);
    why = 'line ends ' + e.toFixed(3) + ' km east';
  } catch (e) { red = true; why = 'match_routes.js threw'; }
  fs.unlinkSync(broken);
  ok('6. PROVE RED — with the lever disabled, case 2 fails', red, why);
}

console.log('');
console.log(failures ? 'prove-red-reach-toward: ' + failures + ' FAILURE(S)'
                     : 'prove-red-reach-toward: all 6 cases as expected');
process.exit(failures ? 1 : 0);
