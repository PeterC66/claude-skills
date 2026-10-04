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
 *      and the tracked redteam.json a worktree checks out does not trip it;
 *   4. the output a worktree built is still there once the worktree is REMOVED
 *      (the control asserts it is lost without `attach`, so the test can fail);
 *   5. the per-town lock: one holder per town, two towns at once, a held town
 *      refused before anything is junctioned, an expired lease taken over.
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
    const r = stage(f.wtTown, 'attach', '--as', 'sess-a');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    for (const d of ['S4-generate', 'S5-render', 'S6-verify', '_latest']) {
      assert.ok(fs.lstatSync(path.join(f.wtTown, d)).isSymbolicLink(), d + ' is not a link');
    }
    assert.ok(fs.existsSync(path.join(f.wtTown, 'S4-generate', 'v1.0_x', 'internal.svg')), 'the main checkout\'s run is not visible');
    fs.mkdirSync(path.join(f.wtTown, 'S5-render', 'v1.0_y'));
    fs.writeFileSync(path.join(f.wtTown, 'S5-render', 'v1.0_y', 'a.jpg'), 'x');
    assert.ok(fs.existsSync(path.join(f.mainTown, 'S5-render', 'v1.0_y', 'a.jpg')), 'the write did not reach the main checkout');
    assert.ok(fs.existsSync(path.join(f.mainTown, 'S6-verify', 'r1', 'redteam.json')), 'the tracked redteam.json was lost');
    assert.strictEqual(stage(f.wtTown, 'attach', '--as', 'sess-a').status, 0, 'a second attach is not idempotent');
  } finally { done(f); }
});

test('detach removes only the links — every run is still in the main checkout', () => {
  const f = fixture();
  try {
    assert.strictEqual(stage(f.wtTown, 'attach', '--as', 'sess-a').status, 0);
    const r = stage(f.wtTown, 'detach', '--as', 'sess-a');
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
    const r = stage(f.wtTown, 'attach', '--as', 'sess-a');
    assert.notStrictEqual(r.status, 0, 'attach accepted a folder with unsaved output');
    assert.match(r.stdout, /REFUSED S4-generate/);
    assert.strictEqual(fs.readFileSync(path.join(f.wtTown, 'S4-generate', 'only-here.svg'), 'utf8'), 'precious');
    assert.ok(!fs.lstatSync(path.join(f.wtTown, 'S4-generate')).isSymbolicLink());
  } finally { done(f); }
});

test('attach in the main checkout does nothing', () => {
  const f = fixture();
  try {
    const r = stage(f.mainTown, 'attach', '--as', 'sess-a');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /main checkout/);
    assert.ok(!fs.lstatSync(path.join(f.mainTown, 'S4-generate')).isSymbolicLink());
  } finally { done(f); }
});

test('a build in a worktree survives `git worktree remove`; without attach it does not', () => {
  const f = fixture();
  try {
    // The control: the premise the whole action rests on. Unattached output dies with the worktree.
    fs.mkdirSync(path.join(f.wtTown, 'S5-render', 'v9.9_lost'), { recursive: true });
    fs.writeFileSync(path.join(f.wtTown, 'S5-render', 'v9.9_lost', 'a.jpg'), 'x');
    fs.rmSync(path.join(f.wtTown, 'S5-render'), { recursive: true });
    assert.strictEqual(stage(f.wtTown, 'attach', '--as', 'sess-a').status, 0);
    fs.mkdirSync(path.join(f.wtTown, 'S5-render', 'v9.9_kept'), { recursive: true });
    fs.writeFileSync(path.join(f.wtTown, 'S5-render', 'v9.9_kept', 'a.jpg'), 'x');
    assert.strictEqual(stage(f.wtTown, 'detach', '--as', 'sess-a').status, 0);
    git(f.main, 'worktree', 'remove', '--force', f.wt);
    assert.ok(!fs.existsSync(f.wt), 'the worktree is still there');
    assert.ok(fs.existsSync(path.join(f.mainTown, 'S5-render', 'v9.9_kept', 'a.jpg')), 'the output did not survive the worktree');
    assert.ok(!fs.existsSync(path.join(f.mainTown, 'S5-render', 'v9.9_lost')), 'unattached output appeared in the main checkout from nowhere');
  } finally { done(f); }
});

test('the town lock: attach takes it in the MAIN checkout, a second session is refused, detach gives it back', () => {
  const f = fixture();
  try {
    const lockHolder = path.join(f.mainTown, '.lock.d', 'holder');
    assert.strictEqual(stage(f.wtTown, 'attach', '--as', 'sess-a').status, 0);
    assert.match(fs.readFileSync(lockHolder, 'utf8'), /^sess-a \d{4}-\d\d-\d\dT[\d:.]+Z\nexpires: /);
    assert.ok(!fs.existsSync(path.join(f.wtTown, '.lock.d')), 'the lock was taken in the worktree, where it fences nobody');
    const b = stage(f.mainTown, 'lock', '--as', 'sess-b');
    assert.notStrictEqual(b.status, 0, 'a second session took a held town');
    assert.match(b.stderr + b.stdout, /held by sess-a/);
    assert.match(stage(f.wtTown, 'who').stdout, /held by sess-a/);
    assert.notStrictEqual(stage(f.wtTown, 'unlock', '--as', 'sess-b').status, 0, 'a session released a lock it does not hold');
    assert.strictEqual(stage(f.wtTown, 'detach', '--as', 'sess-a').status, 0);
    assert.ok(!fs.existsSync(path.join(f.mainTown, '.lock.d')), 'detach left the lock');
    assert.strictEqual(stage(f.mainTown, 'lock', '--as', 'sess-b').status, 0, 'the town was not free after release');
  } finally { done(f); }
});

test('a held town is refused BEFORE anything is junctioned; an expired lease is taken over; a second town is free', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.mainTown, '.lock.d'));
    const past = (m) => new Date(Date.now() - m * 60000).toISOString();
    const holder = (taken, expires) => fs.writeFileSync(path.join(f.mainTown, '.lock.d', 'holder'), ['sess-b ' + taken, 'expires: ' + expires, ''].join('\n'));
    holder(past(10), past(-60));
    const r = stage(f.wtTown, 'attach', '--as', 'sess-a');
    assert.notStrictEqual(r.status, 0);
    assert.ok(!fs.existsSync(path.join(f.wtTown, 'S5-render')) || !fs.lstatSync(path.join(f.wtTown, 'S5-render')).isSymbolicLink(), 'a refused attach still junctioned');
    holder(past(300), past(60));
    const t = stage(f.wtTown, 'attach', '--as', 'sess-a');
    assert.strictEqual(t.status, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /took over an expired lease from sess-b/);
    // Two towns at once: another town folder in the same main checkout has its own lock.
    const other = path.join(f.main, 'Areas', 'Other');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'manifest.json'), '{"town":"Other","stages":{}}\n');
    assert.strictEqual(stage(other, 'lock', '--as', 'sess-c').status, 0, 'one town lock fenced another');
  } finally { done(f); }
});

test('heldTowns lists every held town, Places included, and nothing else', () => {
  const f = fixture();
  try {
    const { heldTowns } = require(path.join(ENGINE_DIR, 'town_lock'));
    assert.deepStrictEqual(heldTowns(f.main), []);
    const place = path.join(f.main, 'Places', '_standalone', 'Shop');
    fs.mkdirSync(place, { recursive: true });
    fs.writeFileSync(path.join(place, 'manifest.json'), '{}\n');
    assert.strictEqual(stage(f.mainTown, 'lock', '--as', 'sess-a').status, 0);
    assert.strictEqual(stage(place, 'lock', '--as', 'sess-b').status, 0);
    assert.deepStrictEqual(heldTowns(f.main).map((t) => t.name + ':' + t.holder).sort(), ['Shop:sess-b', 'Town:sess-a']);
  } finally { done(f); }
});
