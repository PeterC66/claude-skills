#!/usr/bin/env node
/*
 * prove-red-via-chain.js — falsify match_cfg.json's `viaChain` lever (OA-193).
 *
 * WHAT IS BEING PROVED, and why a green run of match_routes.js does not prove it.
 * The fault this lever exists for produces `fallbacks: []` and exit 0: a route whose
 * two travel directions run down different streets routes perfectly through the vias
 * it was handed, and it is the TICKS — projected from the other direction — that land
 * hundreds of metres away. Every gate in the estate was green while Ramsey's sheet
 * showed no bus at all from Ramsey to Bury. So the instrument is `projMaxM`, and this
 * harness watches it go both ways on a fixture built to have the property.
 *
 * The fixture is a square one-way loop, 1.1 km on a side, with four roads and no
 * shortcut between them: OUT runs along the north and east sides, BACK along the
 * south and west. Every stop is on the loop; no stop is on both sides of it. That is
 * the whole property under test, and it is why the fixture is a square rather than a
 * copy of Ramsey — Ramsey's geometry is not in a fresh clone, and a harness that
 * skips is a harness nobody watches go red.
 *
 * Five cases:
 *   1. default            the fault reproduces      projMaxM > 900 m
 *   2. viaChain intown    the fault is gone         projMaxM < 60 m
 *   3. intown ends        contStart AND contEnd     both true: a loop leaves twice
 *   4. inert by name      a viaChain naming ANOTHER route leaves this one byte-
 *                         identical to case 1 — the lever cannot move a sheet that
 *                         did not ask for it, which is the claim the estate rests on
 *   5. PROVE RED          with the lever disabled in a copy of match_routes.js,
 *                         case 2 must FAIL. A check that has never been seen to go
 *                         red proves nothing.
 *
 * Run from C:\u3a St Ives\.claude\skills\make-bus-leaflet — no placeholders:
 *   npm run test:prove-red-via-chain
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const MATCH = path.join(__dirname, '..', 'assets', 'match_routes.js');
let failures = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!cond) failures++;
};

// ---- the fixture: a square one-way loop -----------------------------------
const LAT0 = 52.0, LON0 = 0.0;
const DLAT = 0.010;                     // ~1.11 km
const DLON = 0.0162;                    // ~1.11 km at this latitude
const NW = [LAT0 + DLAT, LON0], NE = [LAT0 + DLAT, LON0 + DLON];
const SE = [LAT0, LON0 + DLON], SW = [LAT0, LON0];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dense = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));

function way(id, name, from, to) {
  const geometry = dense(from, to, 10);
  return { id, tags: { name, highway: 'unclassified', oneway: 'no' },
           nodes: geometry.map((_, i) => id * 100 + i), geometry };
}
const roads_geo = {
  bbox: [LAT0 - 0.002, LON0 - 0.003, LAT0 + DLAT + 0.002, LON0 + DLON + 0.003],
  ways: [way(1, 'North Street', NW, NE), way(2, 'East Street', NE, SE),
         way(3, 'South Street', SE, SW), way(4, 'West Street', SW, NW)]
};

// Stops: two on each side of the loop, plus one far terminus at each end of the full
// chain so the drawn portion is a genuine middle slice and the cont flags have work.
const S = {
  FIXT001: lerp(NW, NE, 0.33), FIXT002: lerp(NW, NE, 0.66),   // north  (OUT)
  FIXT003: lerp(NE, SE, 0.33), FIXT004: lerp(NE, SE, 0.66),   // east   (OUT)
  FIXT005: lerp(SE, SW, 0.33), FIXT006: lerp(SE, SW, 0.66),   // south  (BACK)
  FIXT007: lerp(SW, NW, 0.33), FIXT008: lerp(SW, NW, 0.66),   // west   (BACK)
  FARA001: [LAT0 + DLAT + 0.20, LON0],                        // far terminus A
  FARB001: [LAT0 - 0.20, LON0 + DLON]                         // far terminus B
};
const OUT = ['FARA001', 'FIXT001', 'FIXT002', 'FIXT003', 'FIXT004', 'FARB001'];
const BACK = ['FARB001', 'FIXT005', 'FIXT006', 'FIXT007', 'FIXT008', 'FARA001'];
const CHAIN = ['FIXT001', 'FIXT002', 'FIXT003', 'FIXT004', 'FIXT005', 'FIXT006', 'FIXT007', 'FIXT008'];

const routes_full = {
  L1: { directions: [{ name: 'Out', stops: OUT }, { name: 'Back', stops: BACK }],
        canonical: [{ name: 'Out', stops: OUT }], all: OUT.concat(BACK) },
  // a second route, present only so case 4 has another name to point at
  L2: { directions: [{ name: 'Out', stops: OUT }], canonical: [{ name: 'Out', stops: OUT }], all: OUT }
};
const routes_intown = { L1: CHAIN, L2: ['FIXT001', 'FIXT002', 'FIXT003', 'FIXT004'] };

function run(matchJs, cfg) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'viachain-'));
  fs.writeFileSync(path.join(d, 'roads_geo.json'), JSON.stringify(roads_geo));
  fs.writeFileSync(path.join(d, 'atco2ll.json'), JSON.stringify(S));
  fs.writeFileSync(path.join(d, 'atco2name.json'),
    JSON.stringify(Object.fromEntries(Object.keys(S).map(k => [k, k]))));
  fs.writeFileSync(path.join(d, 'routes_full_atco.json'), JSON.stringify(routes_full));
  fs.writeFileSync(path.join(d, 'routes_intown_atco.json'), JSON.stringify(routes_intown));
  if (cfg) fs.writeFileSync(path.join(d, 'match_cfg.json'), JSON.stringify(cfg));
  execFileSync(process.execPath, [matchJs], { cwd: d, env: Object.assign({}, process.env, { LEAFLET_DIR: d }), stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(path.join(d, 'routes_paths.json'), 'utf8'));
}

console.log('prove-red-via-chain: match_cfg.json viaChain (OA-193)');
console.log('  fixture: a 1.1 km square one-way loop, OUT north+east, BACK south+west');
console.log('');

// 500 m is measured, not chosen. This fixture's default build projects its worst
// tick 817 m from the line; the shipped warning in match_routes.js fires at 350.
// 500 sits 1.63x below what the fixture produces and 1.43x above the threshold the
// engine actually ships, so neither a small change to the fixture's proportions nor
// a small change to PROJ_WARN_M turns this case red by accident. Butting it against
// either number is the fragile place.
const L1base = run(MATCH, null).routes.L1;
ok('1. default reproduces the fault (projMaxM > 500 m, and so above the 350 m warning)',
   L1base.projMaxM > 500, 'projMaxM = ' + Math.round(L1base.projMaxM) + ' m');

const L1fix = run(MATCH, { viaChain: { L1: 'intown' } }).routes.L1;
ok('2. viaChain "intown" removes it (projMaxM < 60 m)',
   L1fix.projMaxM < 60, 'projMaxM = ' + Math.round(L1fix.projMaxM) + ' m');

ok('3. a loop leaves the frame at BOTH ends (contStart && contEnd)',
   L1fix.contStart === true && L1fix.contEnd === true,
   'contStart=' + L1fix.contStart + ' contEnd=' + L1fix.contEnd);

const L1other = run(MATCH, { viaChain: { L2: 'intown' } }).routes.L1;
ok('4. naming another route leaves L1 byte-identical to the default',
   JSON.stringify(L1other) === JSON.stringify(L1base),
   'projMaxM = ' + Math.round(L1other.projMaxM) + ' m');

// ---- 5. PROVE RED ---------------------------------------------------------
// Disable the lever the way a careless edit would: make the chain always canonical.
const src = fs.readFileSync(MATCH, 'utf8');
const ANCHOR = "  let vias = (VC === 'intown' && chain.length >= 2 ? chain : can.stops)";
if (src.split(ANCHOR).length !== 2) {
  ok('5. PROVE RED — the anchor this harness breaks still exists in match_routes.js', false,
     'the line it edits has moved; rewrite this case rather than deleting it');
} else {
  const broken = path.join(os.tmpdir(), 'match_routes_broken_' + process.pid + '.js');
  fs.writeFileSync(broken, src.replace(ANCHOR, '  let vias = (can.stops)'));
  let red = false, why = '';
  try {
    const b = run(broken, { viaChain: { L1: 'intown' } }).routes.L1;
    red = !(b.projMaxM < 60);
    why = 'projMaxM = ' + Math.round(b.projMaxM) + ' m';
  } catch (e) { red = true; why = 'match_routes.js threw'; }
  fs.unlinkSync(broken);
  ok('5. PROVE RED — with the lever disabled, case 2 fails', red, why);
}

console.log('');
console.log(failures ? 'prove-red-via-chain: ' + failures + ' FAILURE(S)'
                     : 'prove-red-via-chain: all 5 cases as expected');
process.exit(failures ? 1 : 0);
