#!/usr/bin/env node
/*
 * prove-red-build-log.js — break build_log.js's severity contract on purpose,
 * one rule at a time, and prove each break is caught.
 *
 * Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` — the engine's own
 * folder, not the buses-data repository. No placeholders; run it exactly as written:
 *
 *   node tools/prove-red-build-log.js
 *
 * WHY. build_log.js decides whether a build may ship. Every one of its rules is a
 * regex over a MESSAGE, and a regex that has never been watched fail is a green
 * light nobody has earned — the standing lesson on this project, and the reason
 * OA-065 sat open: promoting a warning to BLOCKING is only safe once you have
 * both halves, that it starts green on the real corpus AND that it can still go
 * red. The estate sweep is the first half (52 generator runs on 2026-08-28, zero
 * BLOCKING). This file is the second.
 *
 * THE CONTROL IS NOT DECORATION. Each case carries a NEAR-MISS: a message that
 * looks like the one being caught and must stay WARN. A rule that fires on
 * everything is as useless as one that fires on nothing, and only the near-miss
 * can tell the two apart. It also asserts the COUNT of cases, because a harness
 * that silently stops running some of its cases reports a clean sweep either way.
 */
'use strict';
const path = require('path');
const BL = require(path.join(__dirname, '..', 'assets', 'build_log.js'));

// [name, message that MUST be BLOCKING, near-miss that MUST stay WARN]
const CASES = [
  ['refusal',
   'feature: river label not drawn — no geometry within 40mm',
   'feature: river label drawn at the second-choice spot'],
  ['names nothing',
   'feature: "Railway" names nothing near it (78mm from its own line)',
   'feature: "Railway" is 3mm from its own line'],
  ['under the plate',
   'key: the last two rows run under the footer plate',
   'key: the last two rows run close to the footer plate'],
  ['inside/near the plate (OA-065, promoted 2026-08-28)',
   'mapNotes: "300, 301 and 9 stop at Morrisons" ends at y=190.0, inside/near the footer plate (top 188.1)',
   'mapNotes: "300, 301 and 9 stop at Morrisons" ends at y=170.0, clear of the footer plate (top 188.1)'],
  ['too long for the panel',
   'panel: the Services list is too long for this panel at the row pitch floor',
   'panel: the Services list nearly fills this panel at the row pitch floor'],
  ['past the frame edge',
   'legend: the box is drawn past the frame edge',
   'legend: the box is drawn near the frame edge'],
  ['an uncaught exception',
   'TypeError: Cannot read properties of undefined (reading \'some\')',
   'northArrow: the configured spot is blocked — placed automatically at 191,39'],
  ['a stack frame',
   '    at Object.<anonymous> (C:\\u3a St Ives\\x\\gen_internal.js:1801:14)',
   'labels: 2 could not be placed -> unplaced.json'],
  ['a missing vendored file',
   'gen_internal_place: gen_internal.js is not vendored beside the payload',
   'gen_internal_place: gen_internal.js resolved beside the payload'],
];

// Messages a real build produces every day. NONE may block, or the gate is red
// on the day it is written and will be switched off within the week.
const REAL_WARNINGS = [
  'northArrow: the configured spot is blocked — placed automatically at 191,39 (nearest clear corner).',
  'labels: 2 could not be placed -> unplaced.json ("The Co-operative Food", "Burleigh Hill Community Centre")',
  'panel: service VL14 is badged in the Services panel but draws no line on the map',
  'legend: the configured spot covers 1.1% symbols / 0% route ink — moved 179,22 mm to 185,52 (0.0% / 0%).',
  'howToUse: the configured spot covers 18.9% symbols / 6% route ink — moved -4,-124 mm to 6,30.',
  'spokeSpread: two spokes within 6 degrees — widened to 9',
  'panelScale: rows scaled to 0.94 to fit',
  'panelCorridors: 3 services regrouped into 1 corridor row',
  'fit: the map frame was widened by 2mm to fit the drawn extent',
];

let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log((ok ? '  ok   ' : '  FAIL ') + what); };

console.log(`${CASES.length} rules, each with its near-miss control:`);
for (const [name, red, green] of CASES) {
  say(BL.severity(red) === 'BLOCKING', `${name}: the breaking message blocks`);
  say(BL.severity(green) === 'WARN', `${name}: the near-miss stays WARN`);
}

console.log('\nthe messages a real build writes every day:');
for (const w of REAL_WARNINGS) say(BL.severity(w) === 'WARN', w.slice(0, 72));

console.log('\nthe exit status, which no text rule can reach:');
const died = BL.collect([{ source: 'gen_internal.js', stderr: '', ok: false }]);
say(BL.blocking(died).length === 1, 'a run that exited non-zero and said NOTHING is blocking');
const lived = BL.collect([{ source: 'gen_internal.js', stderr: 'northArrow: moved\n', ok: true }]);
say(BL.blocking(lived).length === 0, 'a clean run that warned is not blocking');
const legacy = BL.collect([{ source: 'gen_internal.js', stderr: 'northArrow: moved\n' }]);
say(BL.blocking(legacy).length === 0, 'a caller that passes no `ok` behaves exactly as before');
const both = BL.collect([{ source: 'gen_internal.js', stderr: 'feature: river not drawn\n', ok: false }]);
say(BL.blocking(both).length === 1, 'a run that both refused and died is ONE blocking entry, not two');

console.log('\nthe harness has not quietly shrunk:');
say(CASES.length === 9, `9 rules under test (found ${CASES.length})`);
say(REAL_WARNINGS.length === 9, `9 real warnings under test (found ${REAL_WARNINGS.length})`);

console.log(bad ? `\n${bad} FAILED` : '\nall green: every rule fires, every near-miss and every real warning does not');
process.exit(bad ? 1 : 0);
