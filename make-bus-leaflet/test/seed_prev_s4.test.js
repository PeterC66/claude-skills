'use strict';
/*
 * seed_prev_s4.test.js — the rollout's two seeding paths pick the same winner, and
 * say when there was a choice to make (OA-013).
 *
 * The fault this is written down from: `rollout_places.js` had two seeding loops.
 * The dry run copied every `.json` from the previous S4 unconditionally; the apply
 * pulled S1/S2/S3 first and then copied from the previous S4 only where the file
 * was NOT already there. On 2026-08-24 St Ives Bus Station's dry run reported a
 * clean `GAINED: New Road` from the good `boarding_index.json` in the previous S4,
 * and the apply built from the pre-`excludeRoutes` copy in S2 — putting route 101's
 * withdrawn summer destinations onto a sheet bound for the live portal.
 *
 * It is a UNIT test because it cannot be a data one: measured on 2026-08-29, no map
 * on the estate currently has an S4 input that differs from its stage copy, so the
 * live tree would report the fix working and would have reported the bug working
 * too. The fixture below is the disagreement, built by hand.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./_engine');
const { scratchDir } = require('../assets/scratch');
const { seedPrevS4 } = load('seed_prev_s4.js');

function fixture() {
  const root = scratchDir('seed-prev-s4-');
  const prevS4 = path.join(root, 'prevS4'), dest = path.join(root, 'dest');
  fs.mkdirSync(prevS4); fs.mkdirSync(dest);
  return { root, prevS4, dest };
}
const w = (dir, name, text) => fs.writeFileSync(path.join(dir, name), text);
const r = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('the previous S4 wins over a stage copy that is already there', () => {
  const { prevS4, dest } = fixture();
  w(prevS4, 'boarding_index.json', '{"good":true}');
  w(dest, 'boarding_index.json', '{"stale":true}');       // what `stage.js pull S2` left
  const out = seedPrevS4(dest, prevS4, ['routes.json']);
  assert.equal(r(dest, 'boarding_index.json'), '{"good":true}');
  assert.deepEqual(out.carried, ['boarding_index.json']);
});

test('and it NAMES the file it overwrote, because that is the whole finding', () => {
  const { prevS4, dest } = fixture();
  w(prevS4, 'boarding_index.json', '{"good":true}');
  w(dest, 'boarding_index.json', '{"stale":true}');
  assert.deepEqual(seedPrevS4(dest, prevS4, []).shadowed, ['boarding_index.json']);
});

test('a byte-identical duplicate is not a disagreement and is not reported', () => {
  const { prevS4, dest } = fixture();
  w(prevS4, 'atco2ll.json', '{"same":1}');
  w(dest, 'atco2ll.json', '{"same":1}');
  assert.deepEqual(seedPrevS4(dest, prevS4, []).shadowed, []);
});

test('an empty destination — the dry-run path — carries everything and shadows nothing', () => {
  const { prevS4, dest } = fixture();
  w(prevS4, 'place.json', '{}'); w(prevS4, 'roads_geo.json', '{}');
  const out = seedPrevS4(dest, prevS4, []);
  assert.deepEqual(out.carried, ['place.json', 'roads_geo.json']);
  assert.deepEqual(out.shadowed, []);
});

test('the two paths agree: same previous S4, one destination pre-pulled, same bytes out', () => {
  // This is the property the incident violated, asserted directly rather than
  // inferred from the two branches looking alike.
  const a = fixture(), b = fixture();
  for (const f of [a, b]) {
    w(f.prevS4, 'boarding_index.json', '{"good":true}');
    w(f.prevS4, 'roads_geo.json', '{"fromS4":true}');
  }
  w(b.dest, 'boarding_index.json', '{"stale":true}');     // b is the apply path
  seedPrevS4(a.dest, a.prevS4, []);
  seedPrevS4(b.dest, b.prevS4, []);
  for (const name of ['boarding_index.json', 'roads_geo.json']) {
    assert.equal(r(a.dest, name), r(b.dest, name), `${name} differs between the dry run and the apply`);
  }
});

test('an S3-owned file is never taken from S4, and is reported as skipped', () => {
  const { prevS4, dest } = fixture();
  w(prevS4, 'routes.json', '{"from":"S4"}');
  w(dest, 'routes.json', '{"from":"S3"}');
  const out = seedPrevS4(dest, prevS4, ['routes.json', 'overrides.json']);
  assert.equal(r(dest, 'routes.json'), '{"from":"S3"}');
  assert.deepEqual(out.skipped, ['routes.json']);
  assert.deepEqual(out.carried, []);
});

test('non-JSON files and directories are left alone', () => {
  const { prevS4, dest } = fixture();
  w(prevS4, 'internal.svg', '<svg/>');
  fs.mkdirSync(path.join(prevS4, 'sub'));
  const out = seedPrevS4(dest, prevS4, []);
  assert.deepEqual(out.carried, []);
  assert.equal(fs.existsSync(path.join(dest, 'internal.svg')), false);
});

/*
 * THE SIDECARS — the one class of `.json` in an S4 that is an OUTPUT (2026-09-10).
 *
 * Found in buses-data OA-297 P0-B, when the tube-map diagram was parked and the
 * four towns that drew it were rebuilt without it. `rollout.js` seeds a new build
 * from the previous S4's `.json` files, so `unplaced-diagram.json` was copied into
 * the new Beaconsfield and High Wycombe S4 runs carrying the PREVIOUS run's mtime —
 * a report about a sheet that build never drew, one step short of
 * `sync_ci_reference.js` writing it into the tracked golden master. It was removed
 * by hand on the day; this is the fix.
 *
 * Why it hid: carrying a sidecar forward is INERT while the sheet is still drawn,
 * because the generator overwrites it or unlinks it within the same run. Nothing
 * could go red until a sheet was dropped, and no sheet had ever been dropped before.
 */
const { SHEETS, SIDECARS, sidecarFor } = load('sheet_registry.js');

test('a dropped sheet leaves no sidecar behind — the OA-297 P0-B case, at unit size', () => {
  const { prevS4, dest } = fixture();
  w(prevS4, 'unplaced-diagram.json', '[{"text":"Hemingford Grey"}]');   // the parked sheet's last answer
  w(prevS4, 'roads_geo.json', '{"a real input":true}');
  const out = seedPrevS4(dest, prevS4, []);
  assert.equal(fs.existsSync(path.join(dest, 'unplaced-diagram.json')), false,
    'the previous build\'s sidecar was seeded into a run that does not draw that sheet');
  assert.deepEqual(out.carried, ['roads_geo.json']);
  assert.deepEqual(out.sidecars, ['unplaced-diagram.json']);
});

test('EVERY sheet\'s sidecar is refused, including the one no unplaced-* glob would catch', () => {
  // gen_internal.js writes `unplaced.json`, not `unplaced-internal.json`. A fix
  // written as a filename pattern would have carried it forward for ever, and the
  // internal sheet is the one sheet every map has.
  const { prevS4, dest } = fixture();
  for (const name of SIDECARS) w(prevS4, name, '[]');
  const out = seedPrevS4(dest, prevS4, []);
  assert.deepEqual(out.carried, []);
  assert.deepEqual(out.sidecars, [...SIDECARS].sort());
  assert.ok(SIDECARS.has('unplaced.json'), 'the internal sheet\'s sidecar is not in the set');
});

test('and a file that merely LOOKS like one is still carried — the rule is the registry, not a prefix', () => {
  const { prevS4, dest } = fixture();
  w(prevS4, 'unplaced-notes.json', '{"a human wrote this":true}');
  const out = seedPrevS4(dest, prevS4, []);
  assert.deepEqual(out.carried, ['unplaced-notes.json']);
  assert.deepEqual(out.sidecars, []);
});

test('the registry declares a sidecar for every sheet, and no two share one', () => {
  // The join that stops this rotting: a sixth sheet with no `sidecar` would be
  // carried forward silently, which is the bug, and quality_metrics.js would score
  // it `no-reporter`, which reads as a deliberate coverage gap.
  for (const s of SHEETS) assert.equal(typeof s.sidecar, 'string', `sheet "${s.key}" declares no sidecar`);
  assert.equal(SIDECARS.size, SHEETS.length, 'two sheets share a sidecar filename');
});

test('sidecarFor answers by BASENAME, and answers null rather than undefined', () => {
  // The five NAMES are not re-typed here. quality_metrics.js reads them through
  // this same function, and quality_metrics.test.js already states all five
  // independently in "each sheet type reads its OWN sidecar and not a neighbour's"
  // — a third copy in this file would be one more list that has to agree, which is
  // the fault sheet_registry.js exists to prevent.
  for (const s of SHEETS) assert.equal(sidecarFor(s.base), s.sidecar, s.base + ' does not answer its own row');
  assert.equal(sidecarFor('routes'), null,
    'a basename this engine does not draw must answer null — quality_metrics.js tells "no-reporter" from "unreadable" on it');
});
