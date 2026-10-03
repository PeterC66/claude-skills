/*
 * rollout_ratchet.test.js — both rollout tools ask the quality ratchet about a scratch
 * sheet in their dry run, print what it says, and stop an --apply on it (buses-data
 * OA-547, after OA-548 gave rollout_places.js the same).
 *
 * WHY A SOURCE CENSUS. A label that MOVES onto route ink loses nothing in the label-set
 * diff and still costs the ledger a label, so a dry run that only prints LOST said
 * "clean" over a sheet the push preflight's board then turned red. regressionOn itself
 * is tested in quality_gate.test.js and the verdict in rollout_report.test.js; this asks
 * the question those cannot, which is whether each TOOL asks it — the pairing this
 * project has got wrong before, wiring one rollout and leaving its twin.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ENGINE_DIR } = require('./_engine');

const TOOLS = ['rollout.js', 'rollout_places.js'];
const src = (name) => fs.readFileSync(path.join(ENGINE_DIR, name), 'utf8');

// The three patterns below, as data, so the last test can show each one goes red on a
// mutated copy of the source held in memory (nothing on disk is touched).
const ASKS = /regressionOn\(\s*ledger,/;
const REFUSES = /anyRegressed && !FORCE[\s\S]{0,200}?status: 'REVIEW-NEEDED'/;
const PRINTS = /REGRESSED in \$\{file\}/;

for (const tool of TOOLS) {
  test(`${tool} judges the scratch internal and external sheets against the ledger`, () => {
    const s = src(tool);
    assert.match(s, ASKS, `${tool} never asks the ratchet`);
    assert.match(s, /\(internal\|external\)\\\.svg/, `${tool} does not limit the ratchet to the two sheets the ledger records`);
  });

  test(`${tool} stops an --apply on a REGRESSED verdict, as it does on a LOST label`, () => {
    const s = src(tool);
    assert.match(s, REFUSES, `${tool} computes a regression and does not refuse on it`);
  });

  test(`${tool} prints the REGRESSED line and carries anyRegressed on its dry-run result`, () => {
    const s = src(tool);
    assert.match(s, PRINTS, `${tool} does not print the line the loop prompt names`);
    assert.match(s, /status: 'DRY-RUN'[^\n]*anyRegressed/, `${tool}'s dry-run result drops anyRegressed, so the report cannot count it`);
  });
}

test('each pattern goes red on a mutated copy of the source (the census can fail)', () => {
  const s = src('rollout.js');
  assert.ok(!ASKS.test(s.replace(/regressionOn\(/g, 'somethingElse(')), 'asking survives deleting the call');
  assert.ok(!REFUSES.test(s.replace('anyRegressed && !FORCE', 'false && !FORCE')), 'refusing survives disabling the condition');
  assert.ok(!REFUSES.test(s.replace(/status: 'REVIEW-NEEDED'/g, "status: 'DRY-RUN'")), 'refusing survives changing the status');
  assert.ok(!PRINTS.test(s.replace('REGRESSED in', 'moved in')), 'printing survives renaming the line');
});

test('the towns rollout keys the ledger by the folder name, as quality_gate.sheetKey does', () => {
  // sheetKey is "<folder before ci-reference> · <sheet>", so a town's key is its folder
  // name — t.name here — and not a display name.
  assert.match(src('rollout.js'), /regressionOn\(ledger, t\.name \+ ' · '/);
});
