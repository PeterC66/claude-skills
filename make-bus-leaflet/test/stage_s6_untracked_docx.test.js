/*
 * stage.js commit S6 — name the .docx files it leaves untracked (OA-424, engine half).
 *
 * `.gitignore` re-includes every `*.docx` under Areas/ and Places/, so they are
 * meant to be tracked, and four builds left one off: an S6 run's
 * `disagreements.docx` and the `_latest/verification.docx` mirror. The buses-data
 * pre-commit hook refuses the run-folder case; this is the earlier warning, printed
 * by the commit itself while the person who ran the build is still looking.
 *
 * Every case spawns the CLI in a throwaway git repository. CONTROL means "green
 * whether or not the note is present": the commit still succeeds, and a build whose
 * reports are already tracked prints no note. tools/prove-red-stage-s6-untracked-docx.js
 * cuts the call out of a copy of stage.js and requires every non-CONTROL test to go
 * red and every CONTROL to stay green.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');

function newRepoMap(label) {
  const repo = scratchDir(label);
  assert.strictEqual(spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' }).status, 0, 'git init failed');
  const map = path.join(repo, 'Areas', 'Testton');
  fs.mkdirSync(map, { recursive: true });
  const r = spawnSync(process.execPath, [STAGE, 'init', map, 'Testton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return { repo, map };
}

function s6Run(map, id) {
  const d = path.join(map, 'S6-verify', id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'verification.docx'), 'REPORT');
  fs.writeFileSync(path.join(d, 'disagreements.docx'), 'DISAGREEMENTS');
  return d;
}

function commitS6(map, runDir) {
  return spawnSync(process.execPath, [STAGE, 'commit', 'S6', runDir, '--outputs', 'verification.docx'],
    { cwd: map, encoding: 'utf8' });
}

test('an S6 commit names the untracked disagreements.docx left in its run folder', () => {
  const { map } = newRepoMap('s6-docx-run-');
  const r = commitS6(map, s6Run(map, '2026-10-06_1000'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /NOTE: \d+ \.docx file\(s\) from this S6 are untracked/);
  assert.match(r.stdout, /S6-verify[\/]2026-10-06_1000[\/]disagreements\.docx/);
});

test('an S6 commit names the untracked _latest/verification.docx mirror it just wrote', () => {
  const { map } = newRepoMap('s6-docx-mirror-');
  const r = commitS6(map, s6Run(map, '2026-10-06_1100'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /_latest[\/]verification\.docx/);
});

test('CONTROL — the commit still exits 0 and records the run', () => {
  const { map } = newRepoMap('s6-docx-ctl-ok-');
  const r = commitS6(map, s6Run(map, '2026-10-06_1200'));
  assert.strictEqual(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(map, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.stages.S6.latest, '2026-10-06_1200');
});

test('CONTROL — a build whose reports are already staged prints no note', () => {
  const { repo, map } = newRepoMap('s6-docx-ctl-staged-');
  const run = s6Run(map, '2026-10-06_1300');
  fs.mkdirSync(path.join(map, '_latest'), { recursive: true });
  fs.writeFileSync(path.join(map, '_latest', 'verification.docx'), 'REPORT');
  fs.writeFileSync(path.join(map, '_latest', 'disagreements.docx'), 'DISAGREEMENTS');
  assert.strictEqual(spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' }).status, 0);
  const r = commitS6(map, run);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /NOTE: \d+ \.docx/);
});
