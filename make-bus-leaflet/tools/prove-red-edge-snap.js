#!/usr/bin/env node
/*
 * prove-red-edge-snap.js — falsify match_cfg.json's `edgeSnap` lever (buses-data OA-416).
 *
 * WHAT IS BEING PROVED. match_routes.js snaps a stop to the nearest road-graph NODE
 * within 120 m and never looks at the road between nodes, so a stop on the kerb of a
 * long straight road with few nodes fails the snap and its leg is drawn as a straight
 * chord. Whittlesey's X32 was drawn across the fields from Coates to March that way on
 * 2026-09-24: Grandford Drove (0500FMARC016) is 128 m from the nearest node of the A141
 * Wisbech Road and 9 m from the road itself. `edgeSnap: true` lets such a stop snap to
 * the EDGE, by splitting it with a virtual node.
 *
 * The fixture IS that geometry: the real OSM way 49977440 (A141 Wisbech Road, 24
 * nodes, as pulled for Areas/Whittlesey on 2026-09-24) and the real NaPTAN positions
 * of three March stops, embedded here so the harness needs no data tree. One synthetic
 * stop sits on the way's first node so the chain has somewhere to start.
 *
 * Five cases:
 *   1. default            the fault reproduces: the leg to Grandford Drove is 'unsnapped'
 *   2. edgeSnap           it is gone: no fallback, one edge snap under 20 m, and the
 *                         drawn line passes within 20 m of the stop
 *   3. shared corridor    two routes over the split edge carry the SAME virtual-node
 *                         edge tokens, so the sheet sees one corridor, not two
 *   4. inert              on a chain whose stops all snap to nodes, edgeSnap leaves
 *                         every route and every edge byte-identical, and with the key
 *                         absent the output carries no edgeSnaps field at all
 *   5. PROVE RED          with the lever disabled in a copy of match_routes.js, case 2
 *                         must FAIL. A check never seen to go red proves nothing.
 *
 * Run from C:\u3a St Ives\.claude\skills\make-bus-leaflet — no placeholders:
 *   npm run test:prove-red-edge-snap
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { scratchDir } = require('../assets/scratch');

const MATCH = path.join(__dirname, '..', 'assets', 'match_routes.js');
let failures = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!cond) failures++;
};

// ---- the fixture: the A141 Wisbech Road at Westry, March ---------------------
const A141 = {
  id: 49977440,
  tags: { name: 'Wisbech Road', highway: 'trunk', ref: 'A141' },
  nodes: [1189126959, 3625062092, 1635802597, 4592255884, 4592255880, 8280343920, 7515036284,
    7515042488, 1635802593, 8035156496, 1635802590, 4592255873, 1635802581, 8021753296,
    1635802580, 7238248030, 4592257425, 1635802579, 1635802578, 11872137151, 7835576551,
    270986919, 7835576553, 1643433289],
  geometry: [[52.5744131, 0.0566925], [52.5742542, 0.0568012], [52.5714268, 0.0587357],
    [52.5710492, 0.0589733], [52.5703445, 0.0594166], [52.5699403, 0.059671], [52.5697268, 0.0598053],
    [52.5695088, 0.0599424], [52.5690477, 0.0602325], [52.5689512, 0.0602941], [52.568095, 0.0608409],
    [52.5679134, 0.0609632], [52.5673601, 0.0613419], [52.567226, 0.0614325], [52.5661323, 0.0621713],
    [52.5655855, 0.0625889], [52.5652666, 0.0628324], [52.5650191, 0.0630215], [52.5643483, 0.0635224],
    [52.5640028, 0.0637652], [52.5636591, 0.0640068], [52.5634757, 0.0641357], [52.5633068, 0.0642695],
    [52.5627159, 0.0647376]]
};
const roads_geo = { bbox: [52.555, 0.045, 52.580, 0.075], ways: [A141] };
const S = {
  FIXT0001: [52.5744131, 0.0566925],                               // on the way's first node
  '0500FMARC016': [52.57322965235037, 0.05765326988542521],        // Grandford Drove
  '0500FMARC037': [52.568756683274465, 0.06048365075839418],       // Wisbech Road
  '0500FMARC013': [52.56467843101467, 0.06336150634968536]         // St Mary's Church
};
const WITH = ['FIXT0001', '0500FMARC016', '0500FMARC037', '0500FMARC013'];
const WITHOUT = ['FIXT0001', '0500FMARC037', '0500FMARC013'];
const full = chain => ({ directions: [{ name: 'Out', stops: chain }], canonical: [{ name: 'Out', stops: chain }], all: chain });

function run(matchJs, chain, cfg) {
  const d = scratchDir('edgesnap-');
  fs.writeFileSync(path.join(d, 'roads_geo.json'), JSON.stringify(roads_geo));
  fs.writeFileSync(path.join(d, 'atco2ll.json'), JSON.stringify(S));
  fs.writeFileSync(path.join(d, 'atco2name.json'), JSON.stringify(Object.fromEntries(Object.keys(S).map(k => [k, k]))));
  fs.writeFileSync(path.join(d, 'routes_full_atco.json'), JSON.stringify({ X32: full(chain), R2: full(chain) }));
  fs.writeFileSync(path.join(d, 'routes_intown_atco.json'), JSON.stringify({ X32: chain, R2: chain }));
  if (cfg) fs.writeFileSync(path.join(d, 'match_cfg.json'), JSON.stringify(cfg));
  execFileSync(process.execPath, [matchJs], { cwd: d, env: Object.assign({}, process.env, { LEAFLET_DIR: d }), stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(path.join(d, 'routes_paths.json'), 'utf8'));
}
const mTo = (p, q) => Math.hypot((p[0] - q[0]) * 111320, (p[1] - q[1]) * 111320 * Math.cos(52.57 * Math.PI / 180));
const nearest = (pts, q) => Math.min(...pts.map(p => mTo(p, q)));
const vTokens = r => (r.edges || []).filter(e => e && e.split('>').some(n => +n < 0));

console.log('prove-red-edge-snap: match_cfg.json edgeSnap (buses-data OA-416)');
console.log('  fixture: the A141 Wisbech Road at Westry, and Grandford Drove 128 m from its nearest node');
console.log('');

const base = run(MATCH, WITH, null);
ok('1. default reproduces the fault (the leg to Grandford Drove is unsnapped)',
   base.routes.X32.fallbacks.some(f => f.why === 'unsnapped' && (f.to === '0500FMARC016' || f.from === '0500FMARC016')),
   'fallbacks = ' + JSON.stringify(base.routes.X32.fallbacks.map(f => f.why)));

const on = run(MATCH, WITH, { edgeSnap: true });
const X = on.routes.X32, snaps = on.edgeSnaps || [];
const gap = nearest(X.pts, S['0500FMARC016']);
ok('2. edgeSnap removes it (no fallback, one snap under 20 m, line within 20 m of the stop)',
   X.fallbacks.length === 0 && snaps.length === 1 && snaps[0].stop === '0500FMARC016' && snaps[0].m < 20 && gap < 20,
   'fallbacks=' + X.fallbacks.length + ' snaps=' + JSON.stringify(snaps) + ' line ' + gap.toFixed(1) + ' m from the stop');

const t1 = vTokens(X), t2 = vTokens(on.routes.R2);
ok('3. both routes cross the split edge by the same virtual-node tokens',
   t1.length > 0 && JSON.stringify(t1) === JSON.stringify(t2),
   'X32 ' + JSON.stringify(t1) + '  R2 ' + JSON.stringify(t2));

const plain = run(MATCH, WITHOUT, null), plainOn = run(MATCH, WITHOUT, { edgeSnap: true });
ok('4. inert where every stop snaps, and no edgeSnaps field unless asked for',
   JSON.stringify(plain.routes) === JSON.stringify(plainOn.routes)
   && JSON.stringify(plain.edgeWay) === JSON.stringify(plainOn.edgeWay)
   && !('edgeSnaps' in base) && !('edgeSnaps' in plain),
   'routes identical: ' + (JSON.stringify(plain.routes) === JSON.stringify(plainOn.routes)));

// ---- 5. PROVE RED ---------------------------------------------------------
const src = fs.readFileSync(MATCH, 'utf8');
const ANCHOR = 'const EDGE_SNAP = MCFG.edgeSnap === true;';
if (src.split(ANCHOR).length !== 2) {
  ok('5. PROVE RED — the anchor this harness breaks still exists in match_routes.js', false,
     'the line it edits has moved; rewrite this case rather than deleting it');
} else {
  const broken = path.join(os.tmpdir(), 'match_routes_edgesnap_broken_' + process.pid + '.js');
  fs.writeFileSync(broken, src.replace(ANCHOR, 'const EDGE_SNAP = false;'));
  let red = false, why = '';
  try {
    const b = run(broken, WITH, { edgeSnap: true }).routes.X32;
    red = b.fallbacks.length !== 0;
    why = 'fallbacks = ' + JSON.stringify(b.fallbacks.map(f => f.why));
  } catch (e) { red = true; why = 'match_routes.js threw'; }
  fs.unlinkSync(broken);
  ok('5. PROVE RED — with the lever disabled, case 2 fails', red, why);
}

console.log('');
console.log(failures ? 'prove-red-edge-snap: ' + failures + ' FAILURE(S)'
                     : 'prove-red-edge-snap: all 5 cases as expected');
process.exit(failures ? 1 : 0);
