/*
 * quality_metrics.js — how a sheet's DROPPED LABELS are counted.
 *
 * This file exists because of the bug it is mostly about. Every generator that
 * can drop a label writes a sidecar beside the sheet and DELETES it when it
 * dropped nothing, so "no file" means zero. quality_metrics.js read that idiom
 * correctly for internal.svg and, for external.svg, turned exactly the same
 * absence into null — UNKNOWN. Fourteen external sheets had counted themselves
 * clean and were being reported as uncountable, which is how the board came to
 * claim "108 dropped labels, 31 of 52 sheets could not count it" while the real
 * figure was 287 and every sheet could count.
 *
 * The other three sheet types were the genuine gap, and each a different one:
 * the schematic and the diagram stranded their sidecar in a workspace subfolder
 * that sync_ci_reference.js skips, and the boarding sheet — which has its own
 * hand-rolled placer rather than labeller.js — wrote nothing at all.
 *
 * So the assertions below are mostly about ABSENCE, and about the difference
 * between the two reasons a count can be missing. Nothing here needs a real
 * town: the drop count is read from a sidecar, not from the artwork.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyse } = require('./_engine.js').load('quality_metrics.js');
const { scratchDir } = require('../assets/scratch');

// The smallest thing analyse() will accept as a sheet. The drop count comes from
// the sidecar, so the artwork only has to parse.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
  + '<text x="20" y="20" font-size="3">Somewhere</text></svg>';

let seq = 0;
function sheet(base, sidecarName, sidecarBody) {
  const dir = scratchDir('qm-drop-' + (seq++) + '-');
  fs.writeFileSync(path.join(dir, base + '.svg'), SVG);
  if (sidecarName) fs.writeFileSync(path.join(dir, sidecarName), sidecarBody);
  return path.join(dir, base + '.svg');
}
const drop = (p) => analyse(p).metrics;

const ONE = JSON.stringify([{ id: 'poi:x', text: 'The Hive', at: [1, 2], reason: 'no candidate clear' }]);

test('an absent sidecar means ZERO on an internal sheet', () => {
  const m = drop(sheet('internal', null, null));
  assert.strictEqual(m.unplacedLabels, 0);
  assert.strictEqual(m.unplacedLabelsState, 'counted');
});

// THE BUG. Same idiom, same absence, and until 2026-08-27 this returned null.
test('an absent sidecar means ZERO on an external sheet too, not UNKNOWN', () => {
  const m = drop(sheet('external', null, null));
  assert.strictEqual(m.unplacedLabels, 0, 'external absence must not read as unknown');
  assert.strictEqual(m.unplacedLabelsState, 'counted');
});

test('every sheet type the board carries can count its drops', () => {
  for (const base of ['internal', 'external', 'internal-schematic', 'internal-diagram', 'boarding']) {
    const m = drop(sheet(base, null, null));
    assert.strictEqual(m.unplacedLabels, 0, base + ' should count zero, not report null');
    assert.strictEqual(m.unplacedLabelsState, 'counted', base + ' should be counted');
  }
});

test('each sheet type reads its OWN sidecar and not a neighbour\'s', () => {
  const cases = [
    ['internal', 'unplaced.json'],
    ['external', 'unplaced-external.json'],
    ['internal-schematic', 'unplaced-schematic.json'],
    ['internal-diagram', 'unplaced-diagram.json'],
    ['boarding', 'unplaced-boarding.json'],
  ];
  for (const [base, file] of cases) {
    assert.strictEqual(drop(sheet(base, file, ONE)).unplacedLabels, 1, base + ' should read ' + file);
    // A sidecar belonging to a different sheet in the same folder must not be
    // picked up: the run dir holds several sheets side by side.
    const other = cases.find(c => c[0] !== base)[1];
    assert.strictEqual(drop(sheet(base, other, ONE)).unplacedLabels, 0,
      base + ' must ignore ' + other);
  }
});

test('the dropped text and reason reach the detail, for a report to name them', () => {
  const r = analyse(sheet('boarding', 'unplaced-boarding.json', ONE));
  assert.strictEqual(r.detail.unplaced.length, 1);
  assert.strictEqual(r.detail.unplaced[0].text, 'The Hive');
  assert.strictEqual(r.detail.unplaced[0].reason, 'no candidate clear');
});

// ABSENT IS NOT DIFFERENT. Two ways to have no number, and reporting them as one
// fact is how a parse failure hides inside a coverage gap.
test('a sidecar that will not parse is UNREADABLE, not zero and not a coverage gap', () => {
  const m = drop(sheet('internal', 'unplaced.json', '{ this is not json'));
  assert.strictEqual(m.unplacedLabels, null, 'a corrupt file must not be counted as zero');
  assert.strictEqual(m.unplacedLabelsState, 'unreadable');
});

test('a sheet type nothing writes a sidecar for is NO-REPORTER, and still not zero', () => {
  const m = drop(sheet('some-future-sheet', null, null));
  assert.strictEqual(m.unplacedLabels, null);
  assert.strictEqual(m.unplacedLabelsState, 'no-reporter',
    'an unknown sheet type must be distinguishable from a corrupt sidecar');
});

// The reason this measure is gated at all: every OTHER number counts something
// wrong that is ON the page, so a placer that drops a label scores better for
// dropping it. A drop has to cost, or the headline can be improved by printing less.
test('dropped labels count as HARD defects', () => {
  const clean = drop(sheet('internal', null, null));
  const lost = drop(sheet('internal', 'unplaced.json', ONE));
  assert.strictEqual(lost.hard - clean.hard, 1, 'a dropped label must raise HARD by one');
});

test('the drop RATE is null when the count is, and never divides by zero', () => {
  assert.strictEqual(drop(sheet('some-future-sheet', null, null)).dropRatePct, null);
  assert.strictEqual(typeof drop(sheet('internal', null, null)).dropRatePct, 'number');
});
