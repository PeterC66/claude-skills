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
const { seedPrevS4 } = load('seed_prev_s4.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-prev-s4-'));
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
