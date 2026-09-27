'use strict';
/*
 * sync_ci_reference_args.test.js — a mistyped call writes nothing (buses-data OA-451
 * item 3).
 *
 * With no --town/--place, sync_ci_reference.js rewrites every map's tracked golden
 * master. The shared parser ignores a flag it does not know and files a bare word
 * under `_`, so `--help` and a bare folder path were each a whole-estate sync: on
 * 2026-09-23 one stripped `engineCommit` from ten towns' ci-reference/routes.json,
 * and on 2026-09-25 another did the same to seven.
 *
 * The fixture is a one-town estate whose S4 run WOULD be mirrored, and the last test
 * proves it: a correct call does write ci-reference/. So a refused call leaving the
 * folder absent means the refusal came first, not that there was nothing to sync.
 * BUSES_DIR points at the fixture too, so no case can ever reach the laptop's estate.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');

const SCRIPT = path.join(__dirname, '..', 'assets', 'sync_ci_reference.js');

function estate() {
  const root = scratchDir('sync-ci-args-');
  const town = path.join(root, 'Areas', 'Testtown');
  const run = path.join(town, 'S4-generate', 'r1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'routes.json'), '{"engineCommit":"abc"}\n');
  fs.writeFileSync(path.join(town, 'manifest.json'), JSON.stringify({
    stages: { S4: { latest: 'r1', runs: [{ id: 'r1', dir: 'S4-generate/r1', version: '1.0' }] } },
  }));
  return { root, ciRef: path.join(town, 'ci-reference') };
}

function run(root, argv) {
  return spawnSync(process.execPath, [SCRIPT, ...argv], {
    encoding: 'utf8', env: { ...process.env, BUSES_DIR: root },
  });
}

const REFUSED = [
  ['an unknown flag', ['--nonsense']],
  ['an unknown flag beside a good one', ['--town', 'Testtown', '--dry-run']],
  ['a bare folder path', ['Areas/Testtown']],
  ['--town with no name', ['--town']],
  ['--place with no name', ['--place']],
];

for (const [label, argv] of REFUSED) {
  test(`${label} exits 2 and writes no ci-reference`, () => {
    const { root, ciRef } = estate();
    const r = run(root, ['--buses', root, ...argv]);
    assert.strictEqual(r.status, 2, `exit ${r.status}; stdout: ${r.stdout}`);
    assert.match(r.stderr, /Usage:/);
    assert.ok(!fs.existsSync(ciRef), 'ci-reference/ was written');
  });
}

test('--help prints the usage, exits 0 and writes no ci-reference', () => {
  const { root, ciRef } = estate();
  const r = run(root, ['--buses', root, '--help']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.ok(!fs.existsSync(ciRef), 'ci-reference/ was written');
});

test('the fixture is live: a correct call does mirror the S4 run', () => {
  const { root, ciRef } = estate();
  const r = run(root, ['--buses', root, '--town', 'Testtown']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(ciRef, 'routes.json')));
});
