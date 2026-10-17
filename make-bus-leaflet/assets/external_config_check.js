#!/usr/bin/env node
/*
 * external_config_check.js — two routes.json mistakes that draw a wrong external
 * sheet and that neither external generator says a word about.
 *
 *   node assets/external_config_check.js "<path to a routes.json>"
 *
 * Run from `make-bus-leaflet/`. The one argument is the routes.json to read; there
 * are no other parameters. Exit 0 when the config is clear, 1 when it carries either
 * mistake, 2 on a usage error. stdout carries the messages, one per line.
 *
 * WHY THIS EXISTS (buses-data OA-632, from Huntingdon v7.0 under OA-328, 2026-10-12).
 * Each of these cost that build a rebuild cycle, and the engine warned about neither:
 *
 *   1. A spoke's `stops[]` ENDS WITH ITS TERMINUS. `gen_external_radial.js` makes the
 *      list's last name the terminus node and ticks only the names before it; the
 *      terminus box prints `label`, so the last name itself is never printed. A list
 *      written as intermediates only draws one village fewer than it names, `[]`
 *      draws no spoke at all, and a wrong last name cannot be seen on the sheet.
 *   2. `legendAt` is a TOP-LEVEL routes.json key. Both external generators read
 *      `D.legendAt`; written under `design` it is ignored and the legend stays where
 *      `legendPlace` puts it.
 *
 * WHY HERE AND NOT IN THE GENERATOR. `gen_external_radial.js` is hashed and vendored,
 * so one stderr line in it re-stamps every map in the estate and owes the portal a
 * re-vendor (changing-the-engine.md, "price the change by the closure"). This file is
 * in neither set: `build_s4.js` calls it beside `schematic_crossings.js` and files
 * what it says in the run folder's `build-warnings.txt` as WARN. Nothing here changes
 * a byte of any sheet. Keep it out of every generator's require graph, or it joins
 * the hash by closure.
 *
 * HOW "ENDS WITH ITS TERMINUS" IS JUDGED. The generator reads no terminus field, so
 * the only thing to compare the last name with is the spoke's `label`. They agree
 * when one of the last name's words is one of the label's words or a stem of it
 * ("Ely" and "Ely (some journeys)", "Alconbury Weston" and "The Alconburys",
 * "Cambridge (Drummer St)" and "Cambridge"). A label that summarises two places
 * ("Amersham & Chesham") over a spoke that ends at a third will warn, and that is
 * the check working: either the label or the list is not saying what the sheet draws.
 * The rule cannot tell a separate village that extends the label's name ("Marlow
 * Bottom" under "Marlow") from the terminus written in full ("Hinchingbrooke Hospital"
 * under "Hinchingbrooke"), so it lets both through; that one form still needs an eye.
 */
'use strict';
const fs = require('fs');

// Words that carry no place in a label: "Ely (some journeys)", "Ramsey (via Old Hurst)";
// and the generic halves of place names, or "Cadmore End" agrees with "Lane End".
const FILLER = new Set(['the', 'and', 'via', 'some', 'journeys', 'journey', 'only', 'from', 'for',
  'end', 'green', 'common', 'heath', 'hill', 'bottom', 'cross', 'street', 'upper', 'lower',
  'great', 'little', 'north', 'south', 'east', 'west', 'new', 'old']);
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter(w => w.length >= 3 && !FILLER.has(w));
const related = (a, b) => a === b
  || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** Does `last` name the same place as `label`, by the rule in the header? */
function namesTheTerminus(last, label) {
  const L = words(label);
  return words(last).some(w => L.some(l => related(w, l)));
}

/**
 * Every message for one parsed routes.json, in config order. Each begins with a
 * `prefix:` token so build_log.js reads it as one entry, and none uses a phrase that
 * file classifies as BLOCKING: these sheets are wrong in a way only the author can
 * judge, so they are worth reading and never worth stopping a build over.
 */
function externalConfigWarnings(D) {
  const out = [];
  const d = D || {};
  if (d.design && Object.prototype.hasOwnProperty.call(d.design, 'legendAt')) {
    // Worded "legendAt under design" on purpose: check-design-keys.js scans this
    // folder's raw text for the dotted form and would register it as a design key.
    out.push('legend: legendAt under design is ignored. legendAt is a top-level routes.json key; '
      + 'move it up out of design, or the legend stays where legendPlace puts it.');
  }
  const ext = Array.isArray(d.external) ? d.external : [];
  ext.forEach((b, i) => {
    const who = `spoke ${i + 1} (route ${b && b.route}, "${b && b.label}")`;
    const stops = b && Array.isArray(b.stops) ? b.stops : [];
    if (!stops.length) {
      out.push(`spokeStops: ${who} has an empty stops list, so the external sheet has no line for it. `
        + 'stops[] lists the places along the spoke and ends with its terminus.');
      return;
    }
    const last = stops[stops.length - 1];
    if (b.label && !namesTheTerminus(last, b.label)) {
      out.push(`spokeStops: ${who} ends its stops with "${last}", which is not its label. `
        + 'The last name is drawn as the terminus and only the label is printed there, so '
        + `"${last}" does not appear on the sheet. If it is a place before the terminus, add the `
        + 'terminus to the end of stops; if it is the terminus, make the label name it.');
    }
  });
  return out;
}

function main(argv) {
  const file = argv[0];
  if (!file || argv.length > 1) {
    console.error('usage: node assets/external_config_check.js "<path to a routes.json>"');
    return 2;
  }
  let D;
  try { D = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.error(`external_config_check: cannot read ${file}: ${e.message}`);
    return 2;
  }
  const msgs = externalConfigWarnings(D);
  for (const m of msgs) console.log(m);
  return msgs.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { externalConfigWarnings, namesTheTerminus };
