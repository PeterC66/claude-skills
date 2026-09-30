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
const { verdictOf, summarise, writeReport, hardDefects } = load('rollout_report.js');

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

/* OA-485 item 2: the label diff is a set, so a label that survives but now prints over
 * another is invisible to it. The hard-defect count on both sides is the second question. */
const hd = (before, after) => diff({ hardBefore: before, hardAfter: after });

test('a dry run whose hard-defect count RISES is a regression, even with no label lost', () => {
  assert.strictEqual(verdictOf({ status: 'DRY-RUN', blockers: [], diffs: { 'internal.svg': hd(2, 3) } }), 'regressed');
  assert.strictEqual(verdictOf({ status: 'DRY-RUN', blockers: [], diffs: { 'internal.svg': hd(2, 1), 'external.svg': hd(0, 2) } }), 'regressed',
    'the map total rose, whichever sheet it rose on');
});

test('an equal or falling hard-defect count stays clean', () => {
  assert.strictEqual(verdictOf({ status: 'DRY-RUN', blockers: [], diffs: { 'internal.svg': hd(4, 4) } }), 'clean');
  assert.strictEqual(verdictOf({ status: 'DRY-RUN', blockers: [], diffs: { 'internal.svg': hd(4, 1) } }), 'clean');
});

test('a sheet the measure could not read is never charged, and never excuses the map either', () => {
  assert.strictEqual(verdictOf({ status: 'DRY-RUN', blockers: [], diffs: { 'internal.svg': hd(null, 9) } }), 'clean');
  assert.strictEqual(verdictOf({ status: 'DRY-RUN', blockers: [], diffs: { 'internal.svg': hd(null, 9), 'external.svg': hd(0, 1) } }), 'clean',
    'a partial sum compares different sheet sets, so the map is left out of the comparison');
  const rep = summarise([{ name: 'A', status: 'DRY-RUN', blockers: [], diffs: { 'internal.svg': hd(null, 9) } },
    { name: 'B', status: 'DRY-RUN', blockers: [], diffs: { 'internal.svg': hd(1, 3), 'external.svg': hd(2, 2) } }],
  { kind: 'town', engine: 'e', apply: false });
  assert.deepStrictEqual([rep.maps[0].hardBefore, rep.maps[0].hardAfter], [null, null]);
  assert.deepStrictEqual([rep.maps[1].hardBefore, rep.maps[1].hardAfter, rep.maps[1].verdict], [3, 5, 'regressed']);
});

test('hardDefects measures both sheets with quality_metrics.js, and a missing sheet is null', () => {
  const dir = scratchDir('rollout-hard-');
  const sheet = (name, size) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
      + '<text x="20" y="20" font-size="' + size + '">Somewhere</text></svg>');
    return p;
  };
  // Text far below the print minimum is a hard defect; the same label at a legible size is not.
  assert.deepStrictEqual(hardDefects(sheet('a.svg', 3), sheet('b.svg', 0.5)), { hardBefore: 0, hardAfter: 1 });
  assert.deepStrictEqual(hardDefects(path.join(dir, 'gone.svg'), sheet('c.svg', 3)), { hardBefore: null, hardAfter: 0 });
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
