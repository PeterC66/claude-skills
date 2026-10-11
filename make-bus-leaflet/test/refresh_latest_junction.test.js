/*
 * refresh_latest.js — the report search must FOLLOW A JUNCTION.
 *
 * A buses-data worktree attached with `stage.js attach --as <session>` holds
 * S4-generate, S5-render, S6-verify and _latest as directory junctions onto the
 * main checkout. Node's readdirSync withFileTypes reports a junction as a
 * symbolic link, so `isDirectory()` is false for it, and `newestUnder()` used to
 * walk straight past the junctioned S6-verify. Observed 2026-10-11 building
 * Huntingdon v6.0 from `.claude/worktrees/huntingdon-rebuild`: `stage.js commit
 * S6` printed `skipped: ... verification.docx` beside an S6 run that held one,
 * and the same command against the main checkout's real folder copied it.
 *
 * The control is the same town with S6-verify as a real directory, which was
 * green before the fix too. The cycle case is a junction pointing back at the
 * town itself, which a walk that follows links without remembering where it has
 * been would recurse into until the path got too long.
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
// 'junction' on Windows needs no privilege; elsewhere the type is ignored and a
// directory symlink is made, which readdirSync reports the same way.
const link = (target, at) => fs.symlinkSync(target, at, 'junction');
const refresh = (map) => spawnSync(process.execPath, [REFRESH, map, '--no-collect'], { encoding: 'utf8', timeout: 30000 });
const mirrored = (map) => {
  const f = path.join(map, '_latest', 'verification.docx');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};

test('control: a report in a REAL S6-verify reaches the mirror', () => {
  const map = newMap('latest-junction-control-');
  const run = path.join(map, 'S6-verify', '2026-10-11_0707');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'verification.docx'), 'THE-REPORT');
  const r = refresh(map);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(mirrored(map), 'THE-REPORT');
});

test('a report in a JUNCTIONED S6-verify reaches the mirror — the attached-worktree case', () => {
  const main = scratchDir('latest-junction-main-');
  const run = path.join(main, 'S6-verify', '2026-10-11_0707');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'verification.docx'), 'THE-REPORT');

  const map = newMap('latest-junction-wt-');
  link(path.join(main, 'S6-verify'), path.join(map, 'S6-verify'));
  assert.ok(fs.lstatSync(path.join(map, 'S6-verify')).isSymbolicLink(), 'the fixture did not make a link');

  const r = refresh(map);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /skipped:[^\n]*verification\.docx/, 'the junctioned S6-verify was not searched');
  assert.strictEqual(mirrored(map), 'THE-REPORT');
});

test('a junction back to an ancestor is walked once, not for ever', () => {
  const map = newMap('latest-junction-cycle-');
  const run = path.join(map, 'S6-verify', '2026-10-11_0707');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'verification.docx'), 'THE-REPORT');
  // To S6-verify and not to the town: the town holds manifest.json, so the
  // different-map rule would skip a link to it and the guard would go untested.
  // And TWO of them, because one is not a test: the OS refuses to resolve a
  // chain past its own limit, stat fails, and an unguarded walk stops by itself
  // (seen 2026-10-11 with the guard deleted). Two links double the walk at every
  // level, so without the guard it runs into the spawn timeout instead.
  link(path.join(map, 'S6-verify'), path.join(run, 'loop-a'));
  link(path.join(map, 'S6-verify'), path.join(run, 'loop-b'));

  const r = refresh(map);
  assert.strictEqual(r.status, 0, 'refresh_latest did not finish: ' + (r.error ? r.error.message : r.stderr));
  assert.strictEqual(mirrored(map), 'THE-REPORT');
});

test('a junctioned folder holding its own manifest.json is still a different map', () => {
  // OA-329 fault B must survive the change: following a link is not a licence to
  // walk into a nested map just because it arrives by junction.
  const other = newMap('latest-junction-other-map-');
  fs.mkdirSync(path.join(other, 'S6-verify', 'x'), { recursive: true });
  fs.writeFileSync(path.join(other, 'S6-verify', 'x', 'verification.docx'), 'SOMEBODY-ELSES');

  const map = newMap('latest-junction-nested-');
  fs.mkdirSync(path.join(map, 'Places'));
  link(other, path.join(map, 'Places', 'Other'));

  const r = refresh(map);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(mirrored(map), null, 'a nested map reached by junction supplied the report');
});
