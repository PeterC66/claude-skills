/*
 * trunk_segments — internalRoads.trunkSegments (buses-data OA-549).
 *
 * OPT-IN, absent => byte-identical, so the byte gates run only the OFF path: no map
 * in either estate fixture sets the key. What is held here is the rule, one fixture
 * per clause: a trunk is MORE than minLanes lanes, at least minLength long; bundles
 * that touch are one trunk and bundles apart are two; a lane is hidden only where it
 * lies along a ribbon; a lane outside a trunk is the polyline it was, and one that
 * meets a trunk gathers into the ribbon; a stack names every route; S6's question
 * fails on a stack that leaves one out; and the generator and S6 are wired to all of it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, ENGINE_DIR } = require('./_engine.js');
const TS = load('trunk_segments.js');

// Lanes along y = 50 from x = 0 to x = 100, one segment per 10 mm. MEM/MEMR say which
// lanes share each segment, the way gen_internal.js builds them.
const street = (y, x0 = 0, x1 = 100) => { const P = []; for (let x = x0; x <= x1; x += 10) P.push([x, y]); return P; };
function corridor(routes, y = 50, opts = {}) {
  const RPP = {}, MEM = {}, MEMR = {};
  for (const r of routes) { RPP[r] = { P: street(y, opts.x0, opts.x1) }; MEM[r] = {}; MEMR[r] = {};
    for (let i = 0; i < RPP[r].P.length - 1; i++) { MEM[r][i] = routes.slice(); MEMR[r][i] = routes.slice(); } }
  return { RPP, MEM, MEMR };
}
const cfg = (o = {}) => TS.trunkConfig(Object.assign({ minLanes: 2, minLength: 8 }, o));
const find = (order, g, c = cfg()) => TS.findTrunks({ order, RPP: g.RPP, MEM: g.MEM, MEMR: g.MEMR, cfg: c, CD: 2.4, gap: 2.8 });

test('the key: absent is off, true takes the defaults, an object overrides them', () => {
  assert.strictEqual(TS.trunkConfig(undefined), null);
  assert.strictEqual(TS.trunkConfig(false), null);
  assert.deepStrictEqual(TS.trunkConfig(true), Object.assign({}, TS.DEFAULTS));
  assert.strictEqual(TS.trunkConfig({ minLanes: 8 }).minLanes, 8);
  assert.strictEqual(TS.trunkConfig({ minLanes: 8 }).width, TS.DEFAULTS.width);
});

test('a trunk is MORE than minLanes lanes: three lanes make one at minLanes 2 and none at minLanes 3', () => {
  const g = corridor(['a', 'b', 'c']);
  const on = find(['a', 'b', 'c'], g);
  assert.strictEqual(on.trunks.length, 1);
  assert.deepStrictEqual(on.trunks[0].routes, ['a', 'b', 'c']);
  assert.ok(on.hidden.b && on.hidden.b[3], 'every lane on the street is hidden inside the trunk');
  assert.strictEqual(find(['a', 'b', 'c'], g, cfg({ minLanes: 3 })).trunks.length, 0);
});

test('a stretch shorter than minLength is not a trunk', () => {
  const g = corridor(['a', 'b', 'c'], 50, { x0: 0, x1: 10 });          // one 10 mm segment
  assert.strictEqual(find(['a', 'b', 'c'], g, cfg({ minLength: 8 })).trunks.length, 1);
  assert.strictEqual(find(['a', 'b', 'c'], g, cfg({ minLength: 12 })).trunks.length, 0);
});

test('bundles that touch are ONE trunk with every route of both; bundles apart are two', () => {
  const near = corridor(['a', 'b', 'c']), other = corridor(['d', 'e', 'f'], 54);
  const g = { RPP: { ...near.RPP, ...other.RPP }, MEM: { ...near.MEM, ...other.MEM }, MEMR: { ...near.MEMR, ...other.MEMR } };
  const one = find(['a', 'b', 'c', 'd', 'e', 'f'], g);
  assert.strictEqual(one.trunks.length, 1);
  assert.deepStrictEqual(one.trunks[0].routes, ['a', 'b', 'c', 'd', 'e', 'f']);
  const far = corridor(['d', 'e', 'f'], 90);
  const g2 = { RPP: { ...near.RPP, ...far.RPP }, MEM: { ...near.MEM, ...far.MEM }, MEMR: { ...near.MEMR, ...far.MEMR } };
  assert.strictEqual(find(['a', 'b', 'c', 'd', 'e', 'f'], g2).trunks.length, 2);
});

test('a lane is hidden only where it lies along a ribbon, not wherever its lane set matches', () => {
  const g = corridor(['a', 'b', 'c']);
  // c also claims the trunk's lane set on a segment 40 mm away: a flicker, not the street
  g.RPP.c.P.push([100, 90], [110, 90]);
  g.MEM.c[10] = ['a', 'b', 'c']; g.MEMR.c[10] = ['a', 'b', 'c'];
  g.MEM.c[11] = ['a', 'b', 'c']; g.MEMR.c[11] = ['a', 'b', 'c'];
  const { hidden } = find(['a', 'b', 'c'], g);
  assert.ok(hidden.c[3]);
  assert.strictEqual(hidden.c[11], undefined);
});

test('a lane that meets no trunk is the same polyline; one that does is cut and gathers into the ribbon', () => {
  const P = street(53);
  assert.strictEqual(TS.laneRuns(P, () => null, cfg(), 1.7)[0], P);
  const t = { polys: [street(50, 30, 70)], span: 5.6 };
  const runs = TS.laneRuns(P, i => (i >= 3 && i < 7 ? t : null), cfg({ width: 4.5, fan: 5 }), 1.7);
  assert.strictEqual(runs.length, 2);
  const tail = runs[0][runs[0].length - 1], head = runs[1][0];
  assert.deepStrictEqual(tail.map(v => +v.toFixed(2)), [30, 51.5]);   // offset 3 squeezed by (4.5-1.7)/5.6
  assert.deepStrictEqual(head.map(v => +v.toFixed(2)), [70, 51.5]);
  assert.deepStrictEqual(runs[0][runs[0].length - 2], [25, 53]);        // the last 5 mm becomes the fan
});

test('a trunk has a stack per free end: ends closer than endMerge pool, an end on another ribbon is a junction', () => {
  const c = cfg({ endMerge: 14, width: 4.5 });
  assert.strictEqual(TS.trunkEnds([street(50, 0, 100)], c).length, 2);
  assert.strictEqual(TS.trunkEnds([street(50, 0, 100), street(60, 0, 100)], c).length, 2);   // 10 mm apart: pooled
  assert.strictEqual(TS.trunkEnds([street(50, 0, 100), [[50, 50], [50, 90]]], c).length, 3); // a branch's root lies on the main ribbon
});

test('a stack is a grid laid along the street', () => {
  const across = TS.stackGrid(19, 2, 7, 0, [1, 0]);
  assert.strictEqual(across.at.length, 19);
  assert.ok(across.hw > across.hh, 'wider than tall along a street that runs across the page');
  const down = TS.stackGrid(19, 2, 7, 0, [0, 1]);
  assert.ok(down.hh > down.hw, 'taller than wide along one that runs down it');
});

const kit = (over = {}) => {
  const drawn = [], svg = [];
  return Object.assign({ drawn, svg, inFrame: () => true, inCore: () => false, badgeClash: () => false, overlaps: () => false,
    hit: (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]), badge: (x, y, r) => drawn.push(r),
    badgeXWs: () => 0, noteBadge() {}, reserve() {}, out: s => svg.push(s), symbols: [], ink: { cover: () => 0 } }, over);
};

test('every stack names every route in its trunk, near the end when it can and on a leader when it must', () => {
  const t = { id: 'T1', routes: ['a', 'b', 'c'], runs: [street(50, 0, 100)] };
  const k = kit();
  TS.placeStacks([t], cfg(), k);
  assert.strictEqual(t.drawnEnds.length, 2);
  for (const e of t.drawnEnds) assert.deepStrictEqual(e.names, ['a', 'b', 'c']);
  assert.strictEqual(k.drawn.length, 6);
  assert.strictEqual(k.svg.length, 0, 'clear paper beside the end needs no leader');
  // ink everywhere within 20 mm of the left end: the stack stands off and a leader joins it
  const t2 = { id: 'T1', routes: ['a', 'b', 'c'], runs: [street(50, 0, 100)] };
  const k2 = kit({ ink: { cover: b => (Math.hypot((b[0] + b[2]) / 2, (b[1] + b[3]) / 2 - 50) < 20 ? 1 : 0) } });
  TS.placeStacks([t2], cfg(), k2);
  assert.ok(Math.hypot(t2.drawnEnds[0].at[0], t2.drawnEnds[0].at[1] - 50) >= 20);
  assert.ok(k2.svg.some(s => /^<path d="M0\.00 50\.00L/.test(s)), 'a leader from the trunk end');
});

test('a route seen leaving the trunk in its colour is a through route, and a stack names only the others', () => {
  const t = { id: 'T1', routes: ['a', 'b', 'c'], runs: [street(50, 0, 100)], polys: [street(50, 0, 100)] };
  TS.markExits([t], 'a', [[[-20, 50], [0, 51]]], cfg());              // a's run ends on the ribbon: it comes out
  TS.markExits([t], 'b', [[[-20, 90], [0, 90]]], cfg());              // b's nearest run ends 40 mm away: unseen
  assert.deepStrictEqual([...t.exits], ['a']);
  const k = kit();
  TS.placeStacks([t], cfg(), k);
  for (const e of t.drawnEnds) assert.deepStrictEqual(e.names, ['b', 'c']);
  const all = { id: 'T2', routes: ['a'], runs: [street(50, 0, 100)], exits: new Set(['a']) };
  TS.placeStacks([all], cfg(), kit());
  assert.deepStrictEqual(all.drawnEnds, [], 'a trunk of through routes draws no stack');
  assert.deepStrictEqual(TS.trunkFindings([{ id: 'T2', routes: ['a'], exits: ['a'], ends: [] }]), []);
  assert.strictEqual(TS.trunkFindings([{ id: 'T2', routes: ['a', 'b'], exits: ['a'], ends: [] }]).length, 1);
});

test('S6: a trunk whose stacks name every route passes, one that leaves a route out fails on that lane', () => {
  const ok = [{ id: 'T1', lanes: ['1', '31'], routes: ['1', '1A', '31'], routesByLane: { 1: ['1', '1A'], 31: ['31'] },
    ends: [{ names: ['1', '1A', '31'] }, { names: ['1', '1A', '31'] }] }];
  assert.deepStrictEqual(TS.trunkFindings(ok), []);
  const gap = JSON.parse(JSON.stringify(ok)); gap[0].ends[1].names = ['1', '31'];
  const f = TS.trunkFindings(gap);
  assert.strictEqual(f.length, 1);
  assert.deepStrictEqual(f[0].missing, ['1A']);
  assert.deepStrictEqual(f[0].lanes, ['1']);
  const one = JSON.parse(JSON.stringify(ok)); one[0].ends.pop();
  assert.match(TS.trunkFindings(one)[0].problem, /drew 1 badge stack/);
  assert.deepStrictEqual(TS.trunkFindings(undefined), []);
});

test('the report records what the badge pass drew, and each lane\'s routes', () => {
  const r = TS.trunkReport([{ id: 'T1', lanes: ['1', '31'], routes: ['1', '1A', '31'], polys: [street(50, 0, 20)],
    drawnEnds: [{ at: [1.234, 5.678], names: ['1', '1A', '31'] }] }], r2 => (r2 === '1A' ? '1' : r2));
  assert.deepStrictEqual(r[0].routesByLane, { 1: ['1', '1A'], 31: ['31'] });
  assert.strictEqual(r[0].lengthMm, 20);
  assert.deepStrictEqual(r[0].ends, [{ at: [1.23, 5.68], names: ['1', '1A', '31'] }]);
});

test('gen_internal.js reads the key from internalRoads, and without it draws every lane as before', () => {
  const src = fs.readFileSync(path.join(ENGINE_DIR, 'gen_internal.js'), 'utf8');
  assert.match(src, /const TS = require\(_dep\('trunk_segments\.js'\)\);/);
  assert.match(src, /const TRUNKCFG=TS\.trunkConfig\(IR&&IR\.trunkSegments\);/);
  assert.match(src, /if\(TRUNKCFG\) TRUNKS=TS\.findTrunks\(/);
  assert.match(src, /const runs=TRUNKS \? .* : clipOutCore\(tr\.pts\);/);
  assert.match(src, /if\(TRUNKS\) rep\.trunks=TS\.trunkReport\(/);
});

test('verify_report.js asks the S6 question, and a gap is HARD', () => {
  const src = fs.readFileSync(path.join(ENGINE_DIR, 'verify_report.js'), 'utf8');
  assert.match(src, /require\('\.\/trunk_segments'\)/);
  assert.match(src, /for \(const f of trunkFindings\(corr\.trunks\)\) add\('hard', 'trunk-stack-incomplete'/);
});
