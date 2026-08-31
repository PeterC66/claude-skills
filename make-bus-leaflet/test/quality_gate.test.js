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
const { scratchDir } = require('../assets/scratch');

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

/*
 * targetProgress() — where the ceiling is GOING (technical-audit_2026-08-25 N11).
 *
 * `today` is a parameter in every one of these, deliberately. A test that read
 * the clock would pass in August and fail in November, and the milestone dates
 * here are real ones that will go by.
 */

const rowsOf = (...sheets) => sheets.map((now, i) => ({ key: 's' + i, now }));
const TARGETS = {
  note: 'skipped: a string is not a milestone list',
  baseline: { on: '2026-08-25', hard: 137, drop: 108 },
  hard: [{ by: '2026-10-31', total: 100 }, { by: '2027-01-31', total: 0 }],
  drop: [{ by: '2026-10-31', total: 50 }],
};

test('a ledger with no targets block reports nothing rather than throwing', () => {
  assert.deepStrictEqual(QG.targetProgress(rowsOf(sheet()), undefined, '2026-08-25'), []);
  assert.deepStrictEqual(QG.targetProgress(rowsOf(sheet()), {}, '2026-08-25'), []);
});

test('note and baseline are not mistaken for metrics', () => {
  const p = QG.targetProgress(rowsOf(sheet()), TARGETS, '2026-08-25');
  assert.deepStrictEqual(p.map(x => x.metric).sort(), ['drop', 'hard']);
});

test('the milestone in play is the first one still open', () => {
  const hard = (today) => QG.targetProgress(rowsOf(sheet({ hard: 137 })), TARGETS, today).find(p => p.metric === 'hard');
  assert.strictEqual(hard('2026-08-25').by, '2026-10-31');
  assert.strictEqual(hard('2026-10-31').by, '2026-10-31', 'a milestone due TODAY is still the one in play');
  assert.strictEqual(hard('2026-11-01').by, '2027-01-31', 'the next one takes over the day after');
});

test('a passed final deadline stays the target and reports OVERDUE, not "no target"', () => {
  // The failure this guards is the quiet one: a deadline that goes by and takes
  // the target with it, leaving a board that reports nothing and looks fine.
  const p = QG.targetProgress(rowsOf(sheet({ hard: 40 })), TARGETS, '2027-03-01').find(x => x.metric === 'hard');
  assert.strictEqual(p.by, '2027-01-31');
  assert.strictEqual(p.status, 'overdue');
  assert.ok(p.daysLeft < 0, 'days left should be negative once the date has gone');
  assert.strictEqual(p.perWeek, null, '"per week" means nothing when there are no weeks left');
});

test('a met target is met even before its date', () => {
  const p = QG.targetProgress(rowsOf(sheet({ hard: 90 })), TARGETS, '2026-09-01').find(x => x.metric === 'hard');
  assert.strictEqual(p.status, 'met');
  assert.strictEqual(p.distance, -10);
});

test('distance and the rate it implies are computed from the board total', () => {
  const rows = rowsOf(sheet({ hard: 70 }), sheet({ hard: 67 }));
  const p = QG.targetProgress(rows, TARGETS, '2026-08-25').find(x => x.metric === 'hard');
  assert.strictEqual(p.total, 137);
  assert.strictEqual(p.distance, 37);
  assert.strictEqual(p.daysLeft, 67);
  assert.strictEqual(p.status, 'open');
  assert.strictEqual(p.perWeek, Math.round((37 / (67 / 7)) * 10) / 10);
});

test('a null drop count is UNKNOWN, not zero, in the board total', () => {
  // The whole trap this file already guards per sheet, at board scale: a run
  // that measures less must not report itself closer to target.
  const rows = rowsOf(sheet({ drop: 60 }), sheet({ drop: null }), sheet({ drop: null }));
  const p = QG.targetProgress(rows, TARGETS, '2026-08-25').find(x => x.metric === 'drop');
  assert.strictEqual(p.total, 60, 'nulls summed as zero would still say 60 — the tell is `unknown`');
  assert.strictEqual(p.unknown, 2);
  assert.strictEqual(p.sheets, 3);
});

test('movement since the baseline is reported separately from distance, and can be negative', () => {
  // 130 -> 137 is exactly what the audit found, and "37 to go" cannot say it.
  const worse = QG.targetProgress(rowsOf(sheet({ hard: 140 })), TARGETS, '2026-08-25').find(x => x.metric === 'hard');
  assert.strictEqual(worse.moved, -3, 'a board that got worse must report a negative, not a smaller distance');
  const better = QG.targetProgress(rowsOf(sheet({ hard: 120 })), TARGETS, '2026-08-25').find(x => x.metric === 'hard');
  assert.strictEqual(better.moved, 17);
  const noBase = QG.targetProgress(rowsOf(sheet({ hard: 120 })), { hard: TARGETS.hard }, '2026-08-25')[0];
  assert.strictEqual(noBase.moved, null, 'no baseline means no movement claim');
});

test('targetLines says ADDED when the board went backwards', () => {
  const p = QG.targetProgress(rowsOf(sheet({ hard: 140 })), TARGETS, '2026-08-25');
  const text = QG.targetLines(p).join('\n');
  assert.match(text, /3 ADDED since 2026-08-25/);
  assert.match(text, /HARD/);
});

test('targetLines reports how many sheets could not count a metric', () => {
  const rows = rowsOf(sheet({ drop: 60 }), sheet({ drop: null }));
  const text = QG.targetLines(QG.targetProgress(rows, TARGETS, '2026-08-25')).join('\n');
  assert.match(text, /1 of 2 sheets could not count it/);
});

test('accept() carries the targets block forward', () => {
  // --accept runs after a change that IMPROVED things, which is exactly the run
  // that would otherwise delete the target it just moved towards.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = scratchDir('qg-');
  const ledger = path.join(dir, 'ledger.json');
  fs.writeFileSync(ledger, JSON.stringify({ recorded: '2026-08-25', note: 'keep me', targets: TARGETS, sheets: {} }));
  QG.accept(dir, [{ key: 'a · internal', now: sheet() }], ledger);
  const after = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.deepStrictEqual(after.targets, TARGETS);
  assert.strictEqual(after.note, 'keep me');
  assert.ok(after.sheets['a · internal'], 'the sheet figures should still be re-recorded');
  fs.rmSync(dir, { recursive: true, force: true });
});
