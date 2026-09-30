'use strict';
/*
 * rollout_report.test.js — the JSON a rollout writes under --json (buses-data OA-485).
 *
 * The report is what a weekly shadow rebuild will count as "clean on today's engine",
 * so the case that matters most is the one that must NOT be clean: a map the rollout
 * never built. A SKIP, an ERROR or a STALE-INPUTS counted as clean would make the
 * count rise exactly when the tool stopped looking.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');
const { ENGINE_DIR, load } = require('./_engine.js');
const { verdictOf, summarise, writeReport } = load('rollout_report.js');

const diff = (o = {}) => ({ lost: [], gained: [], moved: [], rewrapped: [], ...o });

test('a map the gate passed without a build is clean', () => {
  assert.strictEqual(verdictOf({ status: 'UP-TO-DATE' }), 'clean');
  assert.strictEqual(verdictOf({ status: 'STAMP-STALE' }), 'clean');
});

test('a dry run that loses nothing and blocks nothing is clean', () => {
  const r = { status: 'DRY-RUN', anyLost: false, blockers: [], diffs: { 'internal.svg': diff({ gained: ['Mill Road'] }) } };
  assert.strictEqual(verdictOf(r), 'clean');
});

test('a lost label, a blocking warning or a failed build is a regression', () => {
  assert.strictEqual(verdictOf({ status: 'DRY-RUN', anyLost: true, diffs: { 'external.svg': diff({ lost: ['Ely'] }) } }), 'regressed');
  assert.strictEqual(verdictOf({ status: 'DRY-RUN', diffs: { 'external.svg': diff({ lost: ['Ely'] }) } }), 'regressed',
    'the diffs alone must be enough, whatever anyLost says');
  assert.strictEqual(verdictOf({ status: 'DRY-RUN', blockers: [{ source: 'gen', text: 'x' }] }), 'regressed');
  assert.strictEqual(verdictOf({ status: 'REVIEW-NEEDED' }), 'regressed');
  assert.strictEqual(verdictOf({ status: 'FAIL', detail: 'gen_internal.js: boom' }), 'regressed');
});

test('a map the rollout never built is unmeasured, never clean', () => {
  for (const s of ['SKIP', 'ERROR', 'STALE-INPUTS', 'STALE-S3', 'UNRENDERED', 'NOT-STAMP-STALE', 'SOMETHING-NEW']) {
    assert.strictEqual(verdictOf({ status: s }), 'unmeasured', s);
  }
});

test('summarise counts every verdict and names the lost labels', () => {
  const rep = summarise([
    { name: 'A', status: 'UP-TO-DATE' },
    { name: 'B', status: 'DRY-RUN', anyLost: true, blockers: [], warnings: [{ severity: 'WARN' }, { severity: 'INFO' }],
      diffs: { 'internal.svg': diff({ lost: ['X', 'Y'], moved: ['Z'] }) } },
    { name: 'C', status: 'ERROR', detail: 'no manifest' },
    { name: 'D', status: 'STAMP-STALE', town: 'St Neots' },
  ], { kind: 'place', engine: 'abc123', apply: false });
  assert.deepStrictEqual(rep.counts, { total: 4, clean: 2, regressed: 1, unmeasured: 1 });
  assert.strictEqual(rep.tool, 'rollout_places.js');
  assert.strictEqual(rep.engine, 'abc123');
  const b = rep.maps.find(m => m.name === 'B');
  assert.deepStrictEqual([b.lost, b.moved, b.warnings], [2, 1, 1]);
  assert.deepStrictEqual(b.lostLabels, { 'internal.svg': ['X', 'Y'] });
  assert.strictEqual(rep.maps.find(m => m.name === 'C').detail, 'no manifest');
  assert.strictEqual(rep.maps.find(m => m.name === 'D').town, 'St Neots');
});

test('the report carries no clock, so the same results write the same bytes', () => {
  const dir = scratchDir('rollout-report-');
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json');
  const results = [{ name: 'A', status: 'UP-TO-DATE' }];
  writeReport(a, results, { kind: 'town', engine: 'e', apply: false });
  writeReport(b, results, { kind: 'town', engine: 'e', apply: false });
  assert.strictEqual(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'));
});

for (const script of ['rollout.js', 'rollout_places.js']) {
  test(`${script} refuses a bare --json before the estate is read`, () => {
    const root = scratchDir('rollout-report-args-');
    const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, script), '--buses', root, '--json'], {
      encoding: 'utf8', env: { ...process.env, BUSES_DIR: root },
    });
    assert.strictEqual(r.status, 2, `exit ${r.status}; stdout: ${r.stdout}`);
    assert.match(r.stderr, /--json needs a file path/);
    assert.doesNotMatch(r.stdout, /DRY RUN/);
  });
}
