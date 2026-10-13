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
 *      refused before anything is junctioned, an expired lease taken over;
 *   6. a town folder NAMED on the line is the one used, from any cwd, and an
 *      argument that cannot be honoured is refused, never ignored (2026-10-13);
 *   7. bus-work's remove_worktree.mjs unlinks attach's junctions before git
 *      removes the tree, and refuses a link it did not make. On Windows the
 *      control shows plain `git worktree remove` emptying the main checkout.
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
  // A full manifest, as `init` writes it: a partial one is rewritten by the first stage.js call, and that one
  // modified file is all that made git refuse a plain remove here until 2026-10-13 — a real town's tree is clean.
  assert.strictEqual(spawnSync(process.execPath, [STAGE, 'init', path.join(main, 'Areas', 'Town'), 'Town']).status, 0);
  fs.writeFileSync(path.join(main, 'Areas', 'Town', 'S6-verify', 'r1', 'redteam.json'), '{"a":1}\n');
  fs.writeFileSync(path.join(main, '.gitignore'), 'Areas/**/S4-generate/**\nAreas/**/S5-render/**\nAreas/**/_latest/**\nAreas/**/S6-verify/**\n!Areas/**/S6-verify/**/redteam.json\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'core.autocrlf', 'false');
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

// 6. The named town folder (buses-data 3e177140): `detach --as <s> "<town>"` from the repository root ignored the path.
const links = (town) => ['S4-generate', 'S5-render', 'S6-verify', '_latest'].filter((d) => { try { return fs.lstatSync(path.join(town, d)).isSymbolicLink(); } catch (e) { return false; } });

test('detach honours a named town folder from the repository root, and exits 0 only with no junction left', () => {
  const f = fixture();
  try {
    assert.strictEqual(stage(f.wtTown, 'attach', '--as', 'sess-a').status, 0);
    const r = stage(f.wt, 'detach', '--as', 'sess-a', f.wtTown);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(links(f.wtTown), [], 'a junction is still standing after a detach that exited 0');
    assert.ok(fs.existsSync(path.join(f.mainTown, 'S4-generate', 'v1.0_x', 'internal.svg')));
    assert.ok(!fs.existsSync(path.join(f.mainTown, '.lock.d')), 'the named town\'s lock was not released');
  } finally { done(f); }
});

test('an argument that cannot be honoured is refused with exit 2 and nothing is detached', () => {
  const f = fixture();
  try {
    assert.strictEqual(stage(f.wtTown, 'attach', '--as', 'sess-a').status, 0);
    for (const [why, args, says] of [
      ['a folder with no manifest.json (the repository root)', ['detach', '--as', 'sess-a', f.wt], /no manifest\.json in/],
      ['a folder BELOW the town (no walk up from a typed path)', ['detach', '--as', 'sess-a', path.join(f.wtTown, 'S4-generate')], /no manifest\.json in/],
      ['two folders', ['detach', '--as', 'sess-a', f.wtTown, f.wtTown], /one town folder at most/],
      ['an unknown flag', ['detach', '--as', 'sess-a', '--town', f.wtTown], /unknown flag --town/],
      ['the MAIN checkout\'s town, where nothing is attached', ['detach', '--as', 'sess-a', f.mainTown], /main checkout/],
    ]) {
      const r = stage(f.wtTown, ...args);
      assert.strictEqual(r.status, 2, why + ': exit ' + r.status + ' ' + r.stdout + r.stderr);
      assert.match(r.stderr, says, why);
      assert.strictEqual(links(f.wtTown).length, 4, why + ': a refused detach removed a junction');
    }
    assert.match(stage(f.wt, 'who', f.wtTown).stdout, /held by sess-a/, 'who ignored the named folder');
  } finally { done(f); }
});

// 7. Removing the worktree. The remover is bus-work's, run by path as a session runs it.
const REMOVER = path.join(__dirname, '..', '..', 'bus-work', 'assets', 'remove_worktree.mjs');
const remover = (...a) => spawnSync(process.execPath, [REMOVER, ...a], { encoding: 'utf8' });
const mainRuns = (f) => ['S4-generate/v1.0_x/internal.svg', 'S5-render/v1.0_y/a.jpg', 'S6-verify/r1/redteam.json', 'S6-verify/r1/verification.json', '_latest/a.txt']
  .filter((p) => !fs.existsSync(path.join(f.mainTown, p)));
function attachedWithRuns(f) {
  assert.strictEqual(stage(f.wtTown, 'attach', '--as', 'sess-a').status, 0);
  fs.mkdirSync(path.join(f.wtTown, 'S5-render', 'v1.0_y'));
  fs.writeFileSync(path.join(f.wtTown, 'S5-render', 'v1.0_y', 'a.jpg'), 'x');
  fs.writeFileSync(path.join(f.wtTown, 'S6-verify', 'r1', 'verification.json'), '{}');
  fs.writeFileSync(path.join(f.wtTown, '_latest', 'a.txt'), 'x');
  assert.deepStrictEqual(mainRuns(f), [], 'the fixture did not put every run in the main checkout');
}

test('control (Windows): a plain `git worktree remove` of a clean, still-attached worktree empties the main checkout', { skip: process.platform !== 'win32' && 'git deletes through a junction only on Windows' }, () => {
  const f = fixture();
  try {
    attachedWithRuns(f);
    assert.strictEqual(git(f.wt, 'status', '--porcelain').trim(), '', 'the worktree is not clean, so this control proves nothing');
    git(f.main, 'worktree', 'remove', f.wt);
    assert.ok(mainRuns(f).length > 0, 'git did not delete through the junctions — the hazard remove_worktree.mjs guards is gone, so ask whether it is still needed');
  } finally { done(f); }
});

test('remove_worktree.mjs: report-only touches nothing; --apply unlinks attach\'s junctions, restores the tracked files, removes the tree, and every run is still in the main checkout', () => {
  const f = fixture();
  try {
    attachedWithRuns(f);
    const look = remover(f.wt);
    assert.strictEqual(look.status, 0, look.stdout + look.stderr);
    assert.strictEqual(links(f.wtTown).length, 4, 'report-only unlinked something');
    assert.ok(fs.existsSync(f.wt));
    const r = remover(f.wt, '--apply');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(f.wt), 'the worktree is still there');
    assert.deepStrictEqual(mainRuns(f), [], 'removing the worktree took runs out of the main checkout');
    assert.doesNotMatch(git(f.main, 'worktree', 'list'), /[\/]wt\b/, 'the worktree is still registered');
  } finally { done(f); }
});

test('remove_worktree.mjs refuses a link it did not make, touches nothing, and refuses the main checkout', () => {
  const f = fixture();
  try {
    const elsewhere = path.join(f.root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, 'precious.txt'), 'x');
    fs.symlinkSync(elsewhere, path.join(f.wt, 'borrowed'), 'junction');
    const r = remover(f.wt, '--apply');
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /FOREIGN link\s+borrowed/);
    assert.ok(fs.existsSync(path.join(f.wt, 'borrowed', 'precious.txt')), 'a refused remove unlinked or deleted something');
    assert.ok(fs.existsSync(f.wt));
    fs.unlinkSync(path.join(f.wt, 'borrowed'));
    assert.strictEqual(remover(f.main, '--apply').status, 2, 'the main checkout was not refused');
    assert.strictEqual(remover(f.wt, '--force').status, 2, 'an unknown flag was not refused');
  } finally { done(f); }
});
