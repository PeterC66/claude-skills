'use strict';
/*
 * rollout_args.test.js — a mistyped call reads no estate (buses-data OA-451
 * item 3, carried over from rollout_places_args.test.js).
 *
 * With no --town, rollout.js considers every town. The shared parser
 * ignores a flag it does not know and files a bare word under `_`, so `--help` was a
 * dry run over the whole estate, and a bare town name was the same.
 *
 * The fixture is an empty estate, and the last test is the control: a correct call
 * gets past the guard and reads it, answering "No matching towns". So a refused call
 * that does NOT say that was refused before the estate was read. BUSES_DIR points at
 * the fixture too, so no case can ever reach the laptop's estate.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');

const SCRIPT = path.join(__dirname, '..', 'assets', 'rollout.js');

function run(argv) {
  const root = scratchDir('rollout-args-');
  return spawnSync(process.execPath, [SCRIPT, '--buses', root, ...argv], {
    encoding: 'utf8', env: { ...process.env, BUSES_DIR: root },
  });
}

const REFUSED = [
  ['an unknown flag', ['--nonsense']],
  ['an unknown flag beside a good one', ['--town', 'Somewhere', '--dry-run']],
  ['a bare town name', ['St Ives']],
];

for (const [label, argv] of REFUSED) {
  test(`${label} exits 2 before the estate is read`, () => {
    const r = run(argv);
    assert.strictEqual(r.status, 2, `exit ${r.status}; stdout: ${r.stdout}`);
    assert.match(r.stderr, /Usage:/);
    assert.doesNotMatch(r.stderr, /No matching towns/);
    assert.doesNotMatch(r.stdout, /DRY RUN/);
  });
}

test('--help prints the usage and exits 0 before the estate is read', () => {
  const r = run(['--help']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage:/);
  assert.doesNotMatch(r.stdout, /DRY RUN/);
});

test('the guard is not a wall: a correct call reaches the estate', () => {
  const r = run(['--town', 'Nowhere']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /No matching towns/);
  assert.doesNotMatch(r.stderr, /Usage:/);
});
