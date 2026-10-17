/*
 * pick-fixture.js — a borrowed-fixture harness prefers a map the RUNNING engine
 * drew, and falls back to name order (buses-data OA-536).
 *
 * Name order alone handed prove-red-rollout-stamp Beaconsfield, which the pinned
 * engine no longer reproduced, and gates.yml was patched with `--town "St Ives"`.
 * These cases pose a tiny estate in a temp folder — two towns and two places, the
 * first in name order stamped by an OLD engine — and ask the picker with the hash
 * given explicitly, so the answer does not depend on which engine this checkout is.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pickTown, pickPlace } = require('../tools/lib/pick-fixture');

function map(dir, engine) {
  fs.mkdirSync(path.join(dir, 'ci-reference'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'S3-config', 'run1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    stages: { S3: { latest: 'run1', runs: [{ id: 'run1', dir: 'S3-config/run1' }] } },
  }));
  fs.writeFileSync(path.join(dir, 'ci-reference', 'routes.json'), JSON.stringify(engine ? { engine } : {}));
  fs.writeFileSync(path.join(dir, 'ci-reference', 'internal.svg'), '<svg/>');
}

const buses = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-fixture-'));
map(path.join(buses, 'Areas', 'Alpha'), 'oldoldold0');
map(path.join(buses, 'Areas', 'Beta'), 'nownownow0');
map(path.join(buses, 'Places', 'Alpha Place'), 'oldplace00');
map(path.join(buses, 'Places', 'Beta Place'), 'nowplace00');
test.after(() => fs.rmSync(buses, { recursive: true, force: true }));

test('a town drawn by the running engine wins over the first in name order', () => {
  assert.strictEqual(pickTown(buses, null, 't', { engine: 'nownownow0' }).name, 'Beta');
});

test('with no town drawn by the running engine, name order as before', () => {
  assert.strictEqual(pickTown(buses, null, 't', { engine: 'neither000' }).name, 'Alpha');
  assert.strictEqual(pickTown(buses, null, 't', { engine: null }).name, 'Alpha');
});

test('a named town is still the one returned, stamped or not', () => {
  assert.strictEqual(pickTown(buses, 'Alpha', 't', { engine: 'nownownow0' }).name, 'Alpha');
});

test('a place drawn by the running place engine wins over name order', () => {
  assert.strictEqual(pickPlace(buses, null, 't', { engine: 'nowplace00' }).name, 'Beta Place');
  assert.strictEqual(pickPlace(buses, null, 't', { engine: 'neither000' }).name, 'Alpha Place');
});

/* OA-604: a harness whose control rebuilds asks for `requireCurrent`, and then name
 * order is no answer. The refusal exits the process, so it is asked in a child. */
const { spawnSync } = require('node:child_process');
function pickInChild(fn, engine) {
  const lib = path.join(__dirname, '..', 'tools', 'lib', 'pick-fixture');
  const src = `const pf=require(${JSON.stringify(lib)});`
    + `const r=pf.${fn}(${JSON.stringify(buses)},null,'harness',{engine:${JSON.stringify(engine)},requireCurrent:true});`
    + `console.log('PICKED '+r.name);`;
  return spawnSync(process.execPath, ['-e', src], { encoding: 'utf8' });
}

test('requireCurrent still takes the map drawn by the running engine', () => {
  assert.strictEqual(pickTown(buses, null, 't', { engine: 'nownownow0', requireCurrent: true }).name, 'Beta');
  assert.strictEqual(pickPlace(buses, null, 't', { engine: 'nowplace00', requireCurrent: true }).name, 'Beta Place');
});

test('requireCurrent with no map drawn by the running engine refuses by name, never name order', () => {
  for (const [fn, kind] of [['pickTown', 'town'], ['pickPlace', 'place']]) {
    const r = pickInChild(fn, 'neither000');
    assert.strictEqual(r.status, 1, `${fn} should exit 1, got ${r.status}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /PICKED/, `${fn} lent a map the engine did not draw`);
    assert.match(r.stderr, new RegExp(`no ${kind} under .* is stamped by the running engine neither000`));
    assert.match(r.stderr, /OA-604/);
  }
});

test('an unusable map is never preferred for its stamp', () => {
  fs.rmSync(path.join(buses, 'Areas', 'Beta', 'ci-reference', 'internal.svg'));
  try {
    assert.strictEqual(pickTown(buses, null, 't', { engine: 'nownownow0' }).name, 'Alpha');
  } finally {
    fs.writeFileSync(path.join(buses, 'Areas', 'Beta', 'ci-reference', 'internal.svg'), '<svg/>');
  }
});
