/*
 * redteam_fixture.js — the scratch estate the redteam_source.js suites build.
 *
 * Moved out of redteam_fingerprint.test.js unchanged when buses-data OA-575 gave
 * the "moved toward the answer" cases a file of their own, so that each prove-red
 * harness runs exactly the cases about the change it reverts. Not a test file:
 * `node --test` collects only `*.test.js`.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

// tools/prove-red-redteam-fingerprint.js (OA-166) and prove-red-redteam-toward.js (OA-575)
// point this at a copy with their change reverted, so a suite can be watched failing against the code as it
// stood on the three days it was wrong.
const SRC = process.env.REDTEAM_SOURCE_JS
  || path.join(__dirname, '..', 'assets', 'redteam_source.js');

const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/* The smallest thing that is a service to this tool: route, operator, days,
 * termini, headsigns. Everything else a real gtfs-services.json carries is
 * passed in by the caller precisely so a test can prove it does NOT count. */
const svc = (route, operator, days, extra = {}) => Object.assign({
  route, operator, days,
  termini: ['Bus Station', 'High Street'],
  headsigns: ['Town Centre'],
}, extra);

/*
 * A build with two S1 runs and one red-team answer between them:
 *
 *      r1 ............ answer ............ r2
 *   (10d ago)         (5d ago)          (2d ago)
 *
 * so the answer's inputs HAVE been re-pulled since it was derived, which is the
 * precondition for every case here. Whether that re-pull moved anything is the
 * only variable, and it is what `then`/`now` say.
 */
function estate(opts = {}) {
  const root = scratchDir('redteam-fp-');
  const dir = path.join(root, 'Testton');
  const runs = [{ id: 'r1', at: day(10) }];
  // A second S1 run exists exactly when the case describes a `now` side — including
  // `now: null`, which is the case where the run exists and carries no services file.
  if ('now' in opts) runs.push({ id: 'r2', at: day(2) });
  /* A THIRD S1 run, for OA-332. A data-only run — the one OA-306 prescribes for
   * declaring a decided register entry — pulls no feed and so derives no
   * `gtfs-services.json`; it writes `verified-services.json` and nothing else.
   * `later: null` is that run, and it becomes the latest, which is the side the
   * tool compares against. */
  if ('later' in opts) runs.push({ id: 'r3', at: day(1) });
  fs.mkdirSync(dir, { recursive: true });
  /* WHERE THE OLDER SIDE'S FILE SITS (OA-270). A place built before OA-158 wrote
   * no services file into its P1/S1 run at all — `gtfs-services.json` landed in
   * the P2/S2 run minutes later. `thenStage: 'S2'` is that era, and `declare`
   * says whether the manifest's `outputs` names the file, which is the only thing
   * the tool is allowed to resolve from. */
  const thenStage = opts.thenStage || 'S1';
  const g1 = { id: 'g1', dir: 'S2-geometry/g1', at: day(10) + 'T09:30' };
  if (thenStage === 'S2' && opts.declare !== false) g1.outputs = ['gtfs-services.json'];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    town: 'Testton',
    stages: {
      S1: { latest: runs[runs.length - 1].id, runs: runs.map(r => ({ id: r.id, dir: 'S1-services/' + r.id, at: r.at + 'T09:00' })) },
      S2: { latest: 'g1', runs: [g1] },
    },
  }, null, 1));
  for (const [id, services] of [['r1', opts.then], ['r2', opts.now], ['r3', opts.later]]) {
    if (!services) continue;
    const rd = (id === 'r1' && thenStage === 'S2')
      ? path.join(dir, 'S2-geometry', 'g1')
      : path.join(dir, 'S1-services', id);
    fs.mkdirSync(rd, { recursive: true });
    fs.writeFileSync(path.join(rd, 'gtfs-services.json'),
      JSON.stringify({ town: 'Testton', services }, null, 1));
  }
  /* `verified-services.json` is OUR file — the feed derivation with our own
   * adjudications written into it — and it is the fingerprint's second choice.
   * A case that supplies it is asking which of the two the tool actually read. */
  for (const [id, services] of [['r1', opts.thenVerified], ['r2', opts.nowVerified], ['r3', opts.laterVerified]]) {
    if (!services) continue;
    const rd = path.join(dir, 'S1-services', id);
    fs.mkdirSync(rd, { recursive: true });
    fs.writeFileSync(path.join(rd, 'verified-services.json'),
      JSON.stringify({ town: 'Testton', services }, null, 1));
  }
  const runId = day(opts.answerAgeDays === undefined ? 5 : opts.answerAgeDays) + '_1000';
  const answerDir = path.join(dir, 'S6-verify', runId);
  fs.mkdirSync(answerDir, { recursive: true });
  fs.writeFileSync(path.join(answerDir, 'redteam.json'), JSON.stringify({
    derivedAt: day(opts.answerAgeDays === undefined ? 5 : opts.answerAgeDays),
    services: opts.answer || [{ ref: '1' }, { ref: '2' }],
  }));
  return { root, build: dir, answerDir };
}

function run(cwd, args = []) {
  const r = spawnSync(process.execPath, [SRC, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// Every case stands in a FRESH S6 run dir inside the build, which is the
// documented cwd and keeps the OA-141 ambiguity guard out of the way.
function freshRun(build) {
  const d = path.join(build, 'S6-verify', day(0) + '_1200');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = { SRC, day, svc, estate, run, freshRun };
