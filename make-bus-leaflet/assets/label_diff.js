#!/usr/bin/env node
/*
 * label_diff.js — `gate_lib.labelDiff` as a command, printing JSON (buses-data OA-426).
 *
 * WHY THIS EXISTS AND IS NOT FIVE LINES OF PYTHON. `refresh_town.py` has to decide
 * whether the labels that moved on a rebuilt sheet are the ones its own patch asked
 * for. The label set is not a property of the file it is easy to re-derive: it comes
 * out of `labelSet()`, which knows about tspans, about the version stamp that changes
 * on every build and must be filtered, and about a label that was merely REWRAPPED
 * across two lines rather than lost. A Python copy of that would agree with itself and
 * with nothing else, which is the fault `sheet_registry.js` and `actionable_rows()`
 * were both written to stop. So the one implementation gets a command, and the Python
 * caller reads its answer.
 *
 * Usage, from anywhere, both arguments real paths and neither a placeholder:
 *
 *   node label_diff.js "<old.svg>" "<new.svg>"
 *
 * Prints one JSON object on stdout:
 *
 *   { "lost": [...], "gained": [...], "rewrapped": [{ "label": ..., "as": [...] }] }
 *
 * A MISSING FILE IS AN EMPTY DIFF AND THAT IS `labelDiff`'s OWN BEHAVIOUR, not this
 * file's. It is reproduced here rather than hidden: a caller that treats "no diff" as
 * "nothing changed" would read a mistyped path as a clean sheet, so this prints
 * `missing` beside the diff and the caller is expected to refuse on it. Saying it in
 * the payload is what makes that possible; saying it only in a comment is what made
 * OA-426's own reader ask for a file instead of a regular expression.
 *
 * Exit 0 with the payload, 2 on a usage error. There is no exit code for "labels were
 * lost": what counts as an acceptable diff is the CALLER's question, and this file
 * deliberately does not have an opinion about it.
 *
 * Zero dependencies (Node core only), matching the rest of assets/.
 */
'use strict';
const fs = require('fs');
const { labelDiff } = require('./gate_lib');

function main(argv) {
  const args = argv.filter((a) => a !== '--');
  if (args.length !== 2) {
    console.error('label_diff.js: expected exactly two SVG paths, old then new.');
    console.error('  node label_diff.js "<old.svg>" "<new.svg>"');
    return 2;
  }
  const [oldSvg, newSvg] = args;
  const missing = [oldSvg, newSvg].filter((p) => !fs.existsSync(p));
  const d = labelDiff(oldSvg, newSvg);
  process.stdout.write(JSON.stringify({
    old: oldSvg,
    new: newSvg,
    missing,
    lost: d.lost,
    gained: d.gained,
    rewrapped: d.rewrapped,
  }) + '\n');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
