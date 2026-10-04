#!/usr/bin/env node
/*
 * fact_notes.js — the demand-responsive lines for a map's `mapNotes`, taken from the register
 * (buses-data OA-437, C4).
 *
 * WHY. Six facts in `service-facts.json` (class "drt": Dial-a-Ride, Tiger on Demand) scope thirteen
 * maps, and each sheet's note block was typed and positioned by hand, one sheet at a time, several
 * times over. The fact is central and the drawing is local (OA-004): the register now holds each fact's
 * `sheetLine`, and this prints the block a map's S3 should carry, so the words are copied from one
 * place and a changed phone number reaches every sheet by re-running this, not by remembering.
 *
 * WHAT IT PRINTS. One `mapNotes` entry: a heading and, under it, one `then` paragraph per in-scope fact,
 * each tagged `fact: "SF-nnn"`. It has no x, y or `at`, so the engine places the whole block by search
 * (note_place.js) as ONE unit. The generator ignores the `fact` tag; it is there so `--check` can join a
 * map's lines back to the register.
 *
 *   node fact_notes.js --name "Chatteris" --facts "<service-facts.json>"
 *   node fact_notes.js --name "Chatteris" --facts "<service-facts.json>" --heading "Also in Chatteris, not drawn on this map:"
 *   node fact_notes.js --check "<routes.json>" --facts "<service-facts.json>" --name "Chatteris"
 *
 * `--name` is the map's name as the register's `scope` spells it — a town's own name, or a place's folder name
 * ("Godmanchester Co-op Cambridge Road"). `--facts` is the register, `service-facts.json` at the root of the
 * buses-data repository. Read-only: it writes nothing. To put the block on a map, hand its output to
 * `adopt_config.js` as the new S3's `mapNotes`, and drop the hand-typed lines it replaces.
 *
 * `--check` reads one routes.json and says whether every in-scope fact has a `fact`-tagged paragraph whose text
 * is the register's `sheetLine` (exit 0), or lists what is missing or drifted (exit 1). A hand-typed line with no
 * tag is not judged: a sheet may still override the default, which is the point of OA-004. Not wired into CI —
 * no stored map carries a tag yet, so there is nothing for it to join; wire it when the first one does.
 *
 * Exit codes: 0 ok, 1 --check found a gap, 2 bad usage or an unreadable file.
 */
'use strict';
const fs = require('fs');

const HEAD = { size: 2.6, color: '#333' }, BODY = { size: 2.4, color: '#555' };

// The drt facts whose scope names this map and that carry a sheet line, in register order.
function factsFor(register, name) {
  const facts = Array.isArray(register) ? register : (register.facts || []);
  return facts.filter(f => f.class === 'drt' && f.sheetLine && Array.isArray(f.scope) && f.scope.includes(name));
}

// The searched block: heading, then each fact's line. Facts that share a line (the three Tiger zones) print once.
function blockFor(register, name, heading) {
  const seen = new Set(), then = [];
  for (const f of factsFor(register, name)) {
    if (seen.has(f.sheetLine)) continue;
    seen.add(f.sheetLine);
    then.push({ fact: f.id, text: f.sheetLine });
  }
  if (!then.length) return null;
  return Object.assign({ text: heading || ('Also serving ' + name + ', not on this map:') }, HEAD, { then: then.map(p => Object.assign(p, BODY)) });
}

// What a routes.json is missing or has drifted on, against the register.
function checkConfig(routes, register, name) {
  const tagged = new Map();
  for (const n of (routes.mapNotes || [])) for (const p of (n.then || [])) if (p.fact) tagged.set(p.fact, p.text);
  const problems = [];
  for (const f of factsFor(register, name)) {
    if (!tagged.has(f.id)) { problems.push(f.id + ' is in scope of ' + name + ' and no tagged paragraph carries it'); continue; }
    if (tagged.get(f.id) !== f.sheetLine) problems.push(f.id + ' has drifted: the sheet says "' + tagged.get(f.id) + '", the register says "' + f.sheetLine + '"');
  }
  return problems;
}

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!/^--(name|facts|heading|check)$/.test(k) || i + 1 >= argv.length) { process.stderr.write('fact_notes: unknown or incomplete argument ' + k + '\n'); return 2; }
    a[k.slice(2)] = argv[++i];
  }
  if (!a.facts || !a.name) { process.stderr.write('fact_notes: --name and --facts are required\n'); return 2; }
  let register, routes;
  try { register = JSON.parse(fs.readFileSync(a.facts, 'utf8')); if (a.check) routes = JSON.parse(fs.readFileSync(a.check, 'utf8')); }
  catch (e) { process.stderr.write('fact_notes: ' + e.message + '\n'); return 2; }
  if (a.check) {
    const problems = checkConfig(routes, register, a.name);
    problems.forEach(p => process.stdout.write(p + '\n'));
    if (!problems.length) process.stdout.write('every in-scope fact is carried and matches the register\n');
    return problems.length ? 1 : 0;
  }
  const block = blockFor(register, a.name, a.heading);
  if (!block) { process.stderr.write('fact_notes: no demand-responsive fact scopes "' + a.name + '"\n'); return 1; }
  process.stdout.write(JSON.stringify(block, null, 2) + '\n');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { factsFor, blockFor, checkConfig };
