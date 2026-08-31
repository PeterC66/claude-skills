/*
 * A frame-exit caption keeps a preposition the config author wrote, and gets 'to '
 * when they wrote none.
 *
 * WHY THIS EXISTS. A route running both ways down the same streets leaves the frame
 * once, and 'to X' is the whole truth about that tail. A ONE-WAY LOOP leaves twice,
 * by different roads, and only one of those tails is a departure — so on Ramsey's
 * X31 the caption at the arrival end has to read 'from Peterborough', because a
 * reader standing there cannot catch a bus to Peterborough at all. That was reported
 * by a member of the public (OA-175 §3) and could not be settled until the loop was
 * drawn as a loop (OA-193).
 *
 * WHAT THE BYTE GATES CANNOT SAY ABOUT IT. The gates prove the SECOND clause and
 * only by luck: no committed label in the estate begins with 'to ' or 'from ', so
 * all 39 sheets reproduce byte-for-byte whether the first clause works, is inverted,
 * or was never written. The rule that MATTERS is therefore invisible to every gate
 * this project has, which is what this file is for. It is the shape already named as
 * *satisfied by the other clause*.
 *
 * These are source assertions, like provenance_date.test.js and for the same reason:
 * gen_internal.js runs at require time and needs a whole S2/S3 tree, which the suite
 * does not have and should not grow. The helper is extracted and evaluated, so a
 * mutation to the regex or to the fallback fails here — verified by npm run
 * test:prove-red, which points ENGINE_DIR at a scratch copy it has edited.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS = require('./_engine.js').ENGINE_DIR;
const SRC = fs.readFileSync(path.join(ASSETS, 'gen_internal.js'), 'utf8');

// Extract the one-liner and evaluate it, rather than re-implementing the rule here.
// A test that carried its own copy of the regex would pass while the engine's copy
// was broken, which is the whole failure mode this file is about.
function loadExitCaption() {
  const m = SRC.match(/^const exitCaption = .*$/m);
  assert.ok(m, 'gen_internal.js no longer defines exitCaption on one line — this test must be rewritten, not deleted');
  const body = m[0].replace(/^const exitCaption = /, '').replace(/;\s*$/, '');
  // eslint-disable-next-line no-eval
  return eval('(' + body + ')');
}

test('a label with no preposition is captioned "to X"', () => {
  const exitCaption = loadExitCaption();
  assert.strictEqual(exitCaption('Peterborough'), 'to Peterborough');
  assert.strictEqual(exitCaption('Whittlesey, and March'), 'to Whittlesey, and March');
  assert.strictEqual(exitCaption('St Ives'), 'to St Ives');
});

test('a label that already carries "from" is printed as written', () => {
  const exitCaption = loadExitCaption();
  assert.strictEqual(exitCaption('from Peterborough'), 'from Peterborough');
  assert.strictEqual(exitCaption('From Peterborough'), 'From Peterborough');
});

test('a label that already carries "to" is not doubled', () => {
  const exitCaption = loadExitCaption();
  assert.strictEqual(exitCaption('to Huntingdon'), 'to Huntingdon');
});

test('only a whole leading word counts, so a place beginning with those letters is safe', () => {
  const exitCaption = loadExitCaption();
  // Real British places. Without the \s in the pattern these would print bare, and
  // the sheet would caption an exit "Tonbridge" with no preposition at all.
  assert.strictEqual(exitCaption('Tonbridge'), 'to Tonbridge');
  assert.strictEqual(exitCaption('Fromebridge'), 'to Fromebridge');
  assert.strictEqual(exitCaption('Frome'), 'to Frome');
});

test('every terminus label committed in the estate is still in the fallback branch', () => {
  // The byte-identity claim this change was made under, asserted rather than
  // remembered: if a future config adds a label starting with "to "/"from ", that
  // sheet's bytes move and this test is the place that says so first. It reads the
  // repository beside the engine and skips when it is not there, because a fresh
  // clone of claude-skills alone has no buses-data.
  const BUSES = process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses';
  const areas = path.join(BUSES, 'Areas');
  if (!fs.existsSync(areas)) { console.log('  (skipped: no buses-data at ' + BUSES + ')'); return; }
  const exitCaption = loadExitCaption();
  let checked = 0;
  for (const town of fs.readdirSync(areas)) {
    const p = path.join(areas, town, 'ci-reference', 'routes.json');
    if (!fs.existsSync(p)) continue;
    const rj = JSON.parse(fs.readFileSync(p, 'utf8'));
    const tm = (rj.internalRoads || {}).termini || {};
    const tl = rj.terminiLabels || {};
    const labels = [];
    for (const r of Object.keys(tm)) for (const side of ['start', 'end']) {
      if (typeof tm[r][side] === 'string') labels.push([town + ' ' + r + '.' + side, tm[r][side]]);
    }
    for (const r of Object.keys(tl)) if (typeof tl[r] === 'string') labels.push([town + ' ' + r, tl[r]]);
    for (const [where, label] of labels) {
      checked++;
      if (town === 'Ramsey') continue;      // Ramsey is the map this rule was added for
      assert.strictEqual(exitCaption(label), 'to ' + label,
        where + ' now carries its own preposition — that sheet\'s bytes move, which is fine, but say so');
    }
  }
  assert.ok(checked >= 80, 'expected the estate\'s ~88 terminus labels, found ' + checked);
});
