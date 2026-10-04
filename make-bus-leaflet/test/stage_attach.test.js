/*
 * stage_attach.test.js — `stage.js attach` / `detach`, a map build in a worktree.
 *
 * buses-data OA-552, design A. S4-generate, S5-render, S6-verify and _latest are
 * gitignored, so a build in a worktree dies with it unless those folders are
 * junctions onto the main checkout's. The three things that matter, each asked
 * of a REAL git worktree in a scratch repository:
 *
 *   1. what the worktree writes through a junction is in the main checkout;
 *   2. `detach` removes the junctions and leaves every run in the main checkout
 *      (the failure it guards is a recursive delete that follows the link);
 *   3. a folder holding something the main checkout lacks is REFUSED untouched,
 *      and the tracked redteam.json a worktree checks out does not trip it.
 *
 * Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet`, no arguments:
 *     npm test
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR } = require('./_engine');

const STAGE = path.join(ENGINE_DIR, 'stage.js');
const git = (cwd, ...a) => {
  const r = spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'git ' + a.join(' ') + ': ' + r.stderr);
  return r.stdout;
};
const stage = (cwd, ...a) => spawnSync(process.execPath, [STAGE, ...a], { cwd, encoding: 'utf8' });

// A main checkout with one town and a tracked S6 redteam.json, plus a worktree of it.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-attach-'));
  const main = path.join(root, 'main');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(path.join(main, 'Areas', 'Town', 'S6-verify', 'r1'), { recursive: true });
  fs.writeFileSync(path.join(main, 'Areas', 'Town', 'manifest.json'), JSON.stringify({ town: 'Town', stages: {} }) + '\n');
  fs.writeFileSync(path.join(main, 'Areas', 'Town', 'S6-verify', 'r1', 'redteam.json'), '{"a":1}\n');
  fs.writeFileSync(path.join(main, '.gitignore'), 'Areas/**/S4-generate/**\nAreas/**/S5-render/**\nAreas/**/_latest/**\nAreas/**/S6-verify/**\n!Areas/**/S6-verify/**/redteam.json\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'add', '-f', 'Areas/Town/S6-verify/r1/redteam.json');
  git(main, 'commit', '-q', '-m', 'init');
  // A run that exists only in the main checkout, as S4 output always does.
  fs.mkdirSync(path.join(main, 'Areas', 'Town', 'S4-generate', 'v1.0_x'), { recursive: true });
  fs.writeFileSync(path.join(main, 'Areas', 'Town', 'S4-generate', 'v1.0_x', 'internal.svg'), '<svg/>');
  git(main, 'worktree', 'add', '-q', '-b', 'work/t', wt);
  return { root, main, wt, mainTown: path.join(main, 'Areas', 'Town'), wtTown: path.join(wt, 'Areas', 'Town') };
}
const done = (f) => { fs.rmSync(f.root, { recursive: true, force: true }); };

test('attach junctions the four folders; a write in the worktree lands in the main checkout', () => {
  const f = fixture();
  try {
    const r = stage(f.wtTown, 'attach');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    for (const d of ['S4-generate', 'S5-render', 'S6-verify', '_latest']) {
      assert.ok(fs.lstatSync(path.join(f.wtTown, d)).isSymbolicLink(), d + ' is not a link');
    }
    assert.ok(fs.existsSync(path.join(f.wtTown, 'S4-generate', 'v1.0_x', 'internal.svg')), 'the main checkout\'s run is not visible');
    fs.mkdirSync(path.join(f.wtTown, 'S5-render', 'v1.0_y'));
    fs.writeFileSync(path.join(f.wtTown, 'S5-render', 'v1.0_y', 'a.jpg'), 'x');
    assert.ok(fs.existsSync(path.join(f.mainTown, 'S5-render', 'v1.0_y', 'a.jpg')), 'the write did not reach the main checkout');
    assert.ok(fs.existsSync(path.join(f.mainTown, 'S6-verify', 'r1', 'redteam.json')), 'the tracked redteam.json was lost');
    assert.strictEqual(stage(f.wtTown, 'attach').status, 0, 'a second attach is not idempotent');
  } finally { done(f); }
});

test('detach removes only the links — every run is still in the main checkout', () => {
  const f = fixture();
  try {
    assert.strictEqual(stage(f.wtTown, 'attach').status, 0);
    const r = stage(f.wtTown, 'detach');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(f.wtTown, 'S4-generate')), 'the link is still there');
    assert.ok(fs.existsSync(path.join(f.mainTown, 'S4-generate', 'v1.0_x', 'internal.svg')), 'detach emptied the main checkout\'s S4');
    assert.ok(fs.existsSync(path.join(f.mainTown, 'S6-verify', 'r1', 'redteam.json')), 'detach emptied the main checkout\'s S6');
  } finally { done(f); }
});

test('attach refuses a folder holding a file the main checkout lacks, and touches nothing', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.wtTown, 'S4-generate'), { recursive: true });
    fs.writeFileSync(path.join(f.wtTown, 'S4-generate', 'only-here.svg'), 'precious');
    const r = stage(f.wtTown, 'attach');
    assert.notStrictEqual(r.status, 0, 'attach accepted a folder with unsaved output');
    assert.match(r.stdout, /REFUSED S4-generate/);
    assert.strictEqual(fs.readFileSync(path.join(f.wtTown, 'S4-generate', 'only-here.svg'), 'utf8'), 'precious');
    assert.ok(!fs.lstatSync(path.join(f.wtTown, 'S4-generate')).isSymbolicLink());
  } finally { done(f); }
});

test('attach in the main checkout does nothing', () => {
  const f = fixture();
  try {
    const r = stage(f.mainTown, 'attach');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /main checkout/);
    assert.ok(!fs.lstatSync(path.join(f.mainTown, 'S4-generate')).isSymbolicLink());
  } finally { done(f); }
});
