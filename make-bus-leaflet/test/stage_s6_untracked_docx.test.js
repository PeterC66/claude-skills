/*
 * stage.js commit S6 — name the .docx files it leaves untracked (OA-424, engine half).
 *
 * `.gitignore` re-includes every `*.docx` under Areas/ and Places/, so a run's
 * reports are meant to be tracked, and four builds left one off: an S6 run's
 * `disagreements.docx`. The buses-data pre-commit hook refuses that case; this is
 * the earlier warning, printed by the commit itself while the person who ran the
 * build is still looking.
 *
 * THE FIXTURE CARRIES BUSES-DATA'S OWN IGNORE LINES (IGNORE below), because without
 * them it asserted a case that cannot happen. Until 2026-10-13 a case here required
 * the note to name `_latest/verification.docx`, in a repository with no .gitignore;
 * buses-data ignores `Areas/**\/_latest/**` after its `*.docx` re-include, so no map
 * tracks the mirror and the real note never names it. The lines are copied, not
 * read, since no buses-data checkout exists on a CI runner; if that .gitignore
 * changes how Areas/ is ignored, copy it again.
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

// buses-data's .gitignore, the Areas/ lines in their order (read 2026-10-13). The
// order is the point: `_latest/**` comes back AFTER `!Areas/**/*.docx`.
const IGNORE = [
  'Areas/**/S4-generate/**',
  'Areas/**/S5-render/**',
  'Areas/**/S6-verify/**',
  'Areas/**/_latest/**',
  '!Areas/**/',
  '!Areas/**/README.md',
  '!Areas/**/manifest.json',
  '!Areas/**/*.docx',
  'Areas/**/_latest/**',
  '!Areas/**/redteam.json',
].join('\n') + '\n';

function newRepoMap(label) {
  const repo = scratchDir(label);
  assert.strictEqual(spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' }).status, 0, 'git init failed');
  fs.writeFileSync(path.join(repo, '.gitignore'), IGNORE);
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

test('the note lists the run\'s two reports and never the ignored _latest mirror', () => {
  const { map } = newRepoMap('s6-docx-mirror-');
  const r = commitS6(map, s6Run(map, '2026-10-06_1100'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(map, '_latest', 'verification.docx')), 'the commit wrote no mirror, so this case asks nothing');
  assert.match(r.stdout, /NOTE: 2 \.docx file\(s\)/);
  assert.match(r.stdout, /S6-verify[\/]2026-10-06_1100[\/]verification\.docx/);
  assert.doesNotMatch(r.stdout, /_latest[\/]/);
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
  assert.strictEqual(spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' }).status, 0);
  const r = commitS6(map, run);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /NOTE: \d+ \.docx/);
});
