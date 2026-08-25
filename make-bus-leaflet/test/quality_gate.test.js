/*
 * quality_gate.js judge() — the ratchet's arithmetic, on its own.
 *
 * Two lessons from this project's own history are encoded here. A sheet that
 * prints LESS can improve every other number while doing it, so the label floor
 * has to be judged before the defect counts. And a metric that is ABSENT is not
 * a metric that IMPROVED: `drop` is null when the run could not count dropped
 * labels at all, and a null read as zero would turn "I don't know" into "BETTER".
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const QG = require('./_engine.js').load('quality_gate.js');

const sheet = (o = {}) => Object.assign({ labels: 100, hard: 5, soft: 10, drop: 2, def: 15, all: 15 }, o);

test('a sheet with no ledger row is NEW, not ok', () => {
  const v = QG.judge(sheet(), null);
  assert.strictEqual(v.status, 'NEW');
});

test('printing fewer labels is a REGRESSION even when every other number improves', () => {
  const was = sheet({ labels: 100, hard: 9, drop: 4 });
  const now = sheet({ labels: 88, hard: 2, drop: 0 });
  const v = QG.judge(now, was);
  assert.strictEqual(v.status, 'REGRESSED');
  assert.match(v.why.join(' '), /12 fewer map labels/);
});

test('more hard defects is a REGRESSION; fewer is BETTER', () => {
  assert.strictEqual(QG.judge(sheet({ hard: 6 }), sheet({ hard: 5 })).status, 'REGRESSED');
  assert.strictEqual(QG.judge(sheet({ hard: 4 }), sheet({ hard: 5 })).status, 'BETTER');
});

test('an unknown drop count is not an improvement and not a regression', () => {
  // now.drop === null means the run could not count. Reading that as 0 would
  // report "drop -2" on a sheet nobody measured.
  const was = sheet({ drop: 2 });
  const nowUnknown = sheet({ drop: null });
  assert.strictEqual(QG.judge(nowUnknown, was).status, 'ok');
  assert.deepStrictEqual(QG.judge(nowUnknown, was).why, []);
  // ...and the same in the other direction: a ledger row that never held a drop
  // count must not make today's count look like a rise.
  assert.strictEqual(QG.judge(sheet({ drop: 9 }), sheet({ drop: null })).status, 'ok');
});

test('a real rise in dropped labels is a REGRESSION', () => {
  const v = QG.judge(sheet({ drop: 5 }), sheet({ drop: 2 }));
  assert.strictEqual(v.status, 'REGRESSED');
  assert.match(v.why.join(' '), /dropped 2 -> 5/);
});

test('soft defects move the note, never the verdict', () => {
  // SOFT is reported so it can be read, and deliberately does not fail a build.
  const v = QG.judge(sheet({ soft: 40 }), sheet({ soft: 10 }));
  assert.strictEqual(v.status, 'ok');
  assert.match(v.why.join(' '), /SOFT 10 -> 40/);
});

test('an identical sheet is ok and says nothing', () => {
  const v = QG.judge(sheet(), sheet());
  assert.strictEqual(v.status, 'ok');
  assert.deepStrictEqual(v.why, []);
});

test('sheetKey is stable and distinguishes two sheets of the same town', () => {
  const a = QG.sheetKey('C:/buses/Areas/St Ives/ci-reference/internal.svg');
  const b = QG.sheetKey('C:/buses/Areas/St Ives/ci-reference/external.svg');
  assert.notStrictEqual(a, b, 'internal and external collapsed to one ledger row');
  assert.strictEqual(a, QG.sheetKey('C:/buses/Areas/St Ives/ci-reference/internal.svg'));
});
