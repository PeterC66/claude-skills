/*
 * refresh_latest.js — WHICH S5 render the `_latest` mirror is taken from
 * (buses-data OA-368).
 *
 * `<map>/_latest/` is the folder a person opens, and `Collected_latests/` is
 * assembled from it, so the render this picks is the one Peter reviews. The
 * manifest is the answer and has always been asked first; what this suite is
 * about is the FALLBACK underneath it, which sorted the directory listing as
 * text — so `v1.9_2026-08-30` beat `v1.19_2026-09-13` and a mirror could be up to
 * 23 builds old while looking exactly like a current one.
 *
 * THE FIXTURE IS THE ESTATE'S OWN FAULT, NOT AN INVENTED ONE. The two run names
 * in the first case are St Neots Co-op's real folders, the pair delivered wrongly
 * on 15 September 2026; the stray `_latest` inside S5-render in the third case is
 * St Neots Town Centre's, found by the 2026-09-16 sweep. A text sort is wrong on
 * 26 of the estate's 40 versioned stage listings and on 0 of its 80 unversioned
 * ones, which is what says the trap is the version prefix rather than sorting.
 *
 * WHY IT SPAWNS RATHER THAN REQUIRES. refresh_latest.js is a CLI whose body is
 * behind `require.main === module` (OA-224 Tier 4.1), so requiring it would run
 * nothing; and the question here is which bytes reached the mirror, which is a
 * property of the artefact rather than of a function's return value.
 *
 * CONTROL here means "green whether or not the fallback is correct": the manifest
 * answering, which is the path every real build takes.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ENGINE_DIR } = require('./_engine');
const { scratchDir } = require('../assets/scratch');

const STAGE = path.join(ENGINE_DIR, 'stage.js');
const REFRESH = path.join(ENGINE_DIR, 'refresh_latest.js');

function newMap(label) {
  const dir = scratchDir(label);
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}

// A render on disk that no stage command has committed — which is the state the
// fallback exists for, and the state the estate is in for every run but one.
function render(map, id, body) {
  const d = path.join(map, 'S5-render', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'internal.jpg'), body);
  return d;
}

const refresh = (map) => spawnSync(process.execPath, [REFRESH, map, '--no-collect'], { encoding: 'utf8' });
const mirrored = (map) => {
  const f = path.join(map, '_latest', 'internal.jpg');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};

test('the mirror comes from v1.19 and not from v1.9 — the St Neots Co-op delivery, verbatim', () => {
  const map = newMap('latest-version-sort-');
  render(map, 'v1.9_2026-08-30_1609', 'THE-FORTNIGHT-OLD-RENDER');
  render(map, 'v1.19_2026-09-13_2027', 'THE-RENDER-WE-ACTUALLY-HAVE');

  const r = refresh(map);
  assert.strictEqual(r.status, 0, 'refresh_latest.js failed: ' + r.stderr);
  assert.strictEqual(mirrored(map), 'THE-RENDER-WE-ACTUALLY-HAVE',
    'the mirror was taken from the run a TEXT sort would pick — v1.9 over v1.19');
});

test('the fallback says out loud that it fired, and names the run it chose', () => {
  // A guess that is right on one laptop and silent everywhere is how this shape
  // shipped four times. The manifest answering is the normal case; this is not,
  // and the operator reading the run should be told which it got.
  const map = newMap('latest-fallback-says-so-');
  render(map, 'v2.9_2026-08-26_1857', 'OLD');
  render(map, 'v2.32_2026-09-13_2028', 'NEW');

  const r = refresh(map);
  assert.strictEqual(r.status, 0, 'refresh_latest.js failed: ' + r.stderr);
  assert.match(r.stderr, /manifest\.json names no committed S5 run/,
    'the fallback fired silently');
  assert.match(r.stderr, /v2\.32_2026-09-13_2028/,
    'the fallback did not name the run it chose');
});

test('a directory that is not a versioned run is not a candidate, even when it is the only one there', () => {
  // St Neots Town Centre really does carry a `_latest` INSIDE its S5-render. It
  // loses a text sort only because `_` sorts before `v`; a folder called `z-old`
  // would have won, and here it is the sole entry, so a listing-based answer has
  // nothing to hide behind.
  const map = newMap('latest-not-a-run-');
  const stray = path.join(map, 'S5-render', '_latest');
  fs.mkdirSync(stray, { recursive: true });
  fs.writeFileSync(path.join(stray, 'internal.jpg'), 'AUGUST-STRAY');

  const r = refresh(map);
  assert.strictEqual(r.status, 0, 'refresh_latest.js failed: ' + r.stderr);
  assert.strictEqual(mirrored(map), null,
    'a folder that is not a `v<N.N>_<ts>` run was copied into the mirror as though it were one');
});

test('CONTROL — the manifest still wins, and a newer render on disk does not override it', () => {
  // The manifest is the answer; the sort below it is only reached when there is
  // no answer. A fix to the fallback that quietly took over from the manifest
  // would pass every case above and be a different bug.
  const map = newMap('latest-manifest-wins-');
  const committed = render(map, 'v1.9_2026-08-30_1609', 'THE-RUN-THE-MANIFEST-NAMES');
  render(map, 'v1.19_2026-09-13_2027', 'A-LATER-RENDER-NOBODY-COMMITTED');
  const c = spawnSync(process.execPath, [STAGE, 'commit', 'S5', committed, '--outputs', 'internal.jpg'],
    { cwd: map, encoding: 'utf8' });
  assert.strictEqual(c.status, 0, 'the S5 commit must succeed: ' + c.stderr);

  const r = refresh(map);
  assert.strictEqual(r.status, 0, 'refresh_latest.js failed: ' + r.stderr);
  assert.strictEqual(mirrored(map), 'THE-RUN-THE-MANIFEST-NAMES',
    'the listing overrode the manifest');
  assert.doesNotMatch(r.stderr, /manifest\.json names no committed S5 run/,
    'the fallback warning fired on a map whose manifest answered');
});
