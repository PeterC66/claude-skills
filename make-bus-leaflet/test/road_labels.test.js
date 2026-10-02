/*
 * road_labels — internalRoads road names, and internalRoads.roadLabelPin (buses-data OA-176).
 *
 * OPT-IN, absent => byte-identical, so the byte gates run only the OFF path: no
 * committed map sets roadLabelPin. What is held here is the rule. A name is
 * gathered from the drawn skeleton, or from roads_geo when no bus uses it, and a
 * pinned name counts as one the town asked for. Placement RESERVES its box and
 * hands back the <text> rather than writing it, so the caller keeps the paint
 * order. And the reason the key exists: a box reserved first wins, so a name
 * placed before the badge pass keeps a spot the badge would otherwise take, which
 * is Ramsey's Great Whyte under laneTrim.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, ENGINE_DIR } = require('./_engine.js');
const { roadLabels } = load('road_labels.js');
const FONT = load('font_metrics.js');

// A 0..200 square frame, no coreBox, and a box register shaped like label_placer's.
function world(IR, SKEL, ways = []) {
  const boxes = [];
  const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const overlaps = (b) => boxes.some((r) => hit(b, r));
  const deps = {
    IR, SKEL, RG: { ways }, XY: (ll) => ll, FONT, iconBoxes: new Set(),
    overlaps, overlapsNoIcons: overlaps,
    inFrame: (p) => p[0] >= 0 && p[0] <= 200 && p[1] >= 0 && p[1] <= 200,
    inCore: () => false,
    reserve: (...b) => boxes.push(b),
    esc: (s) => s,
  };
  return { boxes, overlaps, ...roadLabels(deps) };
}

// One straight road, Great Whyte, a single segment: its centroid is its only spot.
const SKEL = [{ name: 'Great Whyte', p: [100, 100], q: [140, 100] }, { name: null, p: [0, 0], q: [10, 0] }];

test('roadNameAgg gathers by name, pulls a pinned name from roads_geo, and drops an excluded one', () => {
  const ways = [{ tags: { name: 'Oilmills Road' }, geometry: [[20, 20], [60, 20]] },
                { tags: { name: 'High Street' }, geometry: [[30, 30], [50, 30]] }];
  const IR = { roadLabelPin: ['Oilmills Road'], roadLabelInclude: ['High Street'], roadLabelExclude: ['High Street'],
               roadRename: [['Great Whyte', 'Great Whyte (B1040)']] };
  const { roadNameAgg } = world(IR, SKEL, ways);
  const { agg, incl, ren } = roadNameAgg();
  assert.deepStrictEqual(Object.keys(agg).sort(), ['Great Whyte', 'Oilmills Road']);
  assert.strictEqual(agg['Oilmills Road'].len, 40);
  assert.ok(incl.includes('Oilmills Road'), 'a pinned name is one the town asked for');
  assert.strictEqual(ren('Great Whyte'), 'Great Whyte (B1040)');
});

test('without a pin the key changes nothing in the asked-for list', () => {
  const { roadNameAgg } = world({ roadLabelInclude: ['Great Whyte'] }, SKEL);
  assert.deepStrictEqual(roadNameAgg().incl, ['Great Whyte']);
});

test('placeRoadName reserves its box and returns the text without writing it', () => {
  const { roadNameAgg, placeRoadName, boxes } = world({}, SKEL);
  const { agg, ren } = roadNameAgg();
  const r = placeRoadName('Great Whyte', agg['Great Whyte'], ren);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(boxes.length, 1);
  assert.match(r.svg, /^<text x="120\.00" y="100\.00"[^>]*>Great Whyte<\/text>$/);
});

test('the box reserved FIRST wins: a badge before the name drops it, the name before the badge keeps it', () => {
  const badge = [116, 98, 124, 102];   // a route badge on the road's only candidate spot
  {
    const w = world({}, SKEL); const { agg, ren } = w.roadNameAgg();
    w.boxes.push(badge);               // today's order: the badge pass runs first
    const r = w.placeRoadName('Great Whyte', agg['Great Whyte'], ren);
    assert.deepStrictEqual([r.ok, r.anyInFrame], [false, true], 'blocked, not off-frame');
  }
  {
    const w = world({ roadLabelPin: ['Great Whyte'] }, SKEL); const { agg, ren } = w.roadNameAgg();
    const r = w.placeRoadName('Great Whyte', agg['Great Whyte'], ren);   // pinned: before the badges
    assert.strictEqual(r.ok, true);
    assert.strictEqual(w.overlaps(badge), true, 'the badge pass now finds the spot taken and goes elsewhere');
  }
});

test('gen_internal pins before the badge pass, only when the key is set, and paints pinned names in the road-label block', () => {
  const src = fs.readFileSync(path.join(ENGINE_DIR, 'gen_internal.js'), 'utf8');
  const pin = src.indexOf("if(IR && SKEL && (IR.roadLabelPin||[]).length){");
  const badges = src.indexOf('// ---- internalRoads: terminus arrows at the frame cuts');
  const block = src.indexOf('// ---- road-name labels ----');
  assert.ok(pin > 0 && pin < badges && badges < block, `pin ${pin}, badges ${badges}, road-label block ${block}`);
  assert.match(src.slice(block), /let r=ROAD_PINNED\.get\(n\); const pinned=!!\(r&&r\.ok\);\s*if\(!pinned\) r=placeRoadName\(n,a,ren\);\s*if\(r\.ok\) out\(r\.svg\);/);
});
