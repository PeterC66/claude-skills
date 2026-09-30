'use strict';
/*
 * fixture_donor.test.js — the area fixture's town is judged against the pin
 * (buses-data OA-532).
 *
 * On 2026-09-30 the worklist offered St Ives, the source of
 * `Areas/_portal-fixture/St Ives`, an ordinary engine-rebuild row against the live
 * template, and `rollout.js --apply --rebuild-stale` rebuilt it and put the fixture
 * six files behind. Both tools now ask fixture_donor.js. These cases pin its answer
 * on a scratch estate; each "not the donor" case is the control for the one above it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');
const { fixtureDonor, isFixtureDonor, pinnedEngine } = require('./_engine.js').load('fixture_donor.js');

function estate({ fixtureTown = 'St Ives', pin = 'abc1234567' } = {}) {
  const root = scratchDir('fixture-donor-');
  fs.mkdirSync(path.join(root, 'Areas', 'St Ives'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Areas', 'Ramsey'), { recursive: true });
  if (fixtureTown) fs.mkdirSync(path.join(root, 'Areas', '_portal-fixture', fixtureTown), { recursive: true });
  if (pin !== null) fs.writeFileSync(path.join(root, 'engine.lock.json'), JSON.stringify({ engine: pin }));
  return root;
}

test('the town with a folder under Areas/_portal-fixture is the donor, and carries the pin', () => {
  const root = estate();
  assert.deepStrictEqual(fixtureDonor(root, 'St Ives'), { donor: true, pin: 'abc1234567' });
});

test('control: any other town is not the donor and carries no pin', () => {
  const root = estate();
  assert.deepStrictEqual(fixtureDonor(root, 'Ramsey'), { donor: false, pin: null });
});

test('the donor is derived: recut the fixture from another town and the rule moves with it', () => {
  const root = estate({ fixtureTown: 'Ramsey' });
  assert.strictEqual(isFixtureDonor(root, 'Ramsey'), true);
  assert.strictEqual(isFixtureDonor(root, 'St Ives'), false);
});

test('the fixture folder itself is never a donor town', () => {
  const root = estate();
  assert.strictEqual(isFixtureDonor(root, '_portal-fixture'), false);
});

test('an estate with no pin gives the donor no pin, so callers judge it like any town', () => {
  const root = estate({ pin: null });
  assert.strictEqual(pinnedEngine(root), null);
  assert.deepStrictEqual(fixtureDonor(root, 'St Ives'), { donor: true, pin: null });
});

test('an unreadable pin is no pin, never a throw', () => {
  const root = estate();
  fs.writeFileSync(path.join(root, 'engine.lock.json'), '{ not json');
  assert.strictEqual(pinnedEngine(root), null);
});
