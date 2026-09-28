/*
 * redteam_source.js — it writes only into an S6 run folder.
 *
 * WHAT WENT WRONG. On 2026-09-28 scheduled tick sched-0314 ran
 * `redteam_source.js --build "<place>"` from the buses-data repository ROOT.
 * --into defaults to the cwd, so it wrote redteam-source.json and redteam.json
 * at the root, and the next two calls — for two DIFFERENT places — read that
 * stray record as "ALREADY DECIDED". The OA-141 ambiguity guard could not see
 * it: the root has no manifest above it to disagree with --build.
 *
 * Kept out of redteam_source.test.js on purpose: tools/prove-red-redteam-source.js
 * asserts that file holds exactly 2 CONTROL and 4 guard tests.
 *
 * The CONTROL must stay green: a refusal that fired in the documented run dir
 * would stop every S6 in the estate.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const SRC = process.env.REDTEAM_SOURCE_JS
  || path.join(__dirname, '..', 'assets', 'redteam_source.js');

/* A build with an old answer in one S6 run, and a repository-root-like folder
 * above it — the shape of the 2026-09-28 accident. */
function estate() {
  const root = scratchDir('redteam-cwd-');
  const build = path.join(root, 'Places', 'Testton Co-op');
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(path.join(build, 'manifest.json'), JSON.stringify({
    town: 'Testton Co-op',
    stages: { S1: { latest: 'r1', runs: [{ id: 'r1', at: '2026-08-01T09:00' }] },
              S2: { latest: 'r1', runs: [{ id: 'r1', at: '2026-08-01T09:00' }] } },
  }, null, 1));
  const old = path.join(build, 'S6-verify', '2026-08-20_1000');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'redteam.json'),
    JSON.stringify({ derivedAt: '2026-08-20', services: [{ ref: '1' }] }));
  const fresh = path.join(build, 'S6-verify', '2026-09-28_0900');
  fs.mkdirSync(fresh, { recursive: true });
  return { root, build, fresh };
}

function run(cwd, args) {
  const r = spawnSync(process.execPath, [SRC, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const strays = (dir) => ['redteam.json', 'redteam-source.json'].filter(f => fs.existsSync(path.join(dir, f)));

test('CONTROL: standing in an S6 run folder, it decides and writes its record there', () => {
  const { build, fresh } = estate();
  const r = run(fresh, ['--build', build]);
  assert.ok(r.code === 0 || r.code === 10, `expected a decision, got exit ${r.code}\n${r.out}`);
  assert.ok(strays(fresh).includes('redteam-source.json'), 'no decision record in the run dir:\n' + r.out);
});

test('from a folder that is not an S6 run folder, it refuses and writes nothing', () => {
  const { root, build } = estate();
  const r = run(root, ['--build', build]);
  assert.strictEqual(r.code, 2, `expected a refusal (exit 2), got ${r.code}\n${r.out}`);
  assert.match(r.out, /not an S6 run folder/);
  assert.deepStrictEqual(strays(root), [], 'it wrote into a folder that is not a run dir:\n' + r.out);
});

test('an explicit --into that is not an S6 run folder is refused too', () => {
  const { root, build } = estate();
  const r = run(root, ['--into', build, '--build', build]);
  assert.strictEqual(r.code, 2, `expected a refusal (exit 2), got ${r.code}\n${r.out}`);
  assert.deepStrictEqual(strays(build), [], 'it wrote into the build root:\n' + r.out);
});
