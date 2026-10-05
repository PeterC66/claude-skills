#!/usr/bin/env node
/*
 * poi_shortlist_import.js — turn a customer's reply to the numbered landmark list
 * ("Must show: 3, 7. Drop: 5, 9-11.") into `poi.tiers` entries (buses-data OA-568,
 * slice 3 of 3; slice 1 is poi_shortlist.js, which writes the numbers this reads).
 *
 * WHAT IT DOES AND DOES NOT DO. It reads the `poi-shortlist.json` that slice 1 wrote
 * (`list[]` of `{n, key}`), parses the reply, PRINTS WHAT IT UNDERSTOOD, and with
 * --out writes a tiers patch `{ "<cat>:<name>": "must" | "miss" }`. It never touches a
 * map: the patch is merged through `poi_tiers_sync.js` / the S3 route like any other
 * answer, so the customer's words reach a build only after a person has read this
 * output. Unmarked places are not mentioned, so they stay `may` — silence never means
 * `miss`.
 *
 * WHAT IT REFUSES, rather than guesses. A number on both lists is refused and nothing
 * is written; a number the list does not have is reported and skipped (the customer
 * may be reading an older list); a reply it finds nothing in exits 1. More than
 * MUST_WARN `must` marks is a WARNING, not a refusal: each one takes room from its
 * neighbours and the person reading decides.
 *
 * Words: must-show is `must` / `must show` / `keep`; drop is `drop` / `remove` / `delete`
 * (to `miss`). Numbers are separated by commas, "and" or spaces; `3-5` is a range.
 *
 * Usage — paths are real paths, not placeholders:
 *   node poi_shortlist_import.js --list "<map>/poi-shortlist.json" --reply "Must show: 3, 7. Drop: 5"
 *   node poi_shortlist_import.js --list "<map>/poi-shortlist.json" --reply-file "<a text file>" --out "<patch.json>"
 *   --list <file>        the JSON slice 1 wrote
 *   --reply <text>       the customer's reply, as text
 *   --reply-file <file>  or the reply from a file
 *   --out <file>         write the tiers patch here (default: print only)
 *
 * Zero dependencies; READ-ONLY apart from --out. Not in the engine-hash closure.
 */
'use strict';
const fs = require('fs');

const MUST_WARN = 12;

/* "3, 7 and 9-11" -> [3, 7, 9, 10, 11]; anything that is not a number is ignored. */
function numbersIn(s) {
  const out = [];
  for (const m of String(s).matchAll(/(\d+)\s*[-–]\s*(\d+)|(\d+)/g)) {
    if (m[3]) out.push(+m[3]);
    else { const a = +m[1], b = +m[2]; for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 500; n++) out.push(n); }
  }
  return out;
}

/* The pure parse: reply text in, { must:[n], drop:[n] } out (each sorted, unique). */
function parseReply(text) {
  const out = { must: new Set(), drop: new Set() };
  const re = /\b(must(?:\s*show)?|keep|drop|remove|delete)\b\s*[:\-–=]?\s*([^a-z]*)/gi;
  for (const m of String(text).matchAll(re)) {
    const into = /^(must|keep)/i.test(m[1]) ? out.must : out.drop;
    for (const n of numbersIn(m[2])) into.add(n);
  }
  return { must: [...out.must].sort((a, b) => a - b), drop: [...out.drop].sort((a, b) => a - b) };
}

/* parse + join to the list: { tiers, must:[row], drop:[row], unknown:[n], conflict:[n], warnings:[string] } */
function interpret(list, text) {
  const byN = new Map((list || []).map(r => [r.n, r]));
  const p = parseReply(String(text).replace(/\band\b/gi, ','));
  const conflict = p.must.filter(n => p.drop.includes(n));
  const known = n => byN.has(n) && !conflict.includes(n);
  const unknown = [...new Set([...p.must, ...p.drop])].filter(n => !byN.has(n));
  const must = p.must.filter(known).map(n => byN.get(n));
  const drop = p.drop.filter(known).map(n => byN.get(n));
  const tiers = {};
  for (const r of must) tiers[r.key] = 'must';
  for (const r of drop) tiers[r.key] = 'miss';
  const warnings = [];
  if (must.length > MUST_WARN) warnings.push(must.length + ' places marked must-show (over ' + MUST_WARN
    + '): each one takes room from its neighbours — worth asking which matter most.');
  return { tiers, must, drop, unknown, conflict, warnings };
}

function report(r) {
  const L = [];
  L.push('Understood: ' + r.must.length + ' must show, ' + r.drop.length + ' drop. Everything else stays as it is (may).');
  for (const x of r.must) L.push('  must  ' + x.n + '  ' + x.key);
  for (const x of r.drop) L.push('  drop  ' + x.n + '  ' + x.key);
  if (r.unknown.length) L.push('NOT ON THE LIST, skipped: ' + r.unknown.join(', ') + ' (an older list?)');
  if (r.conflict.length) L.push('ON BOTH LISTS, refused: ' + r.conflict.join(', ') + ' — ask the customer which they meant.');
  for (const w of r.warnings) L.push('WARNING: ' + w);
  return L.join('\n');
}

function main() {   // OA-344: the body is guarded, not re-indented — see test/asset_load.test.js
  const F = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) F[argv[i].slice(2)] = argv[++i];
  const fail = m => { console.error('poi_shortlist_import: ' + m); process.exit(1); };
  if (!F.list) fail('--list "<the poi-shortlist.json slice 1 wrote>" is required');
  if (!F.reply && !F['reply-file']) fail('--reply "<text>" or --reply-file "<file>" is required');
  let doc; try { doc = JSON.parse(fs.readFileSync(F.list, 'utf8')); } catch (e) { fail('cannot read ' + F.list + ': ' + e.message); }
  const text = F.reply || fs.readFileSync(F['reply-file'], 'utf8');
  const r = interpret(doc.list, text);
  console.log(report(r));
  if (!r.must.length && !r.drop.length && !r.conflict.length) fail('nothing understood — expected "Must show: 3, 7. Drop: 5".');
  if (r.conflict.length) { process.exitCode = 1; return; }
  if (F.out) {
    fs.writeFileSync(F.out, JSON.stringify({ map: doc.map, tiers: r.tiers }, null, 2) + '\n');
    console.log('written: ' + F.out);
  }
}

if (require.main === module) main();
module.exports = { main, parseReply, interpret, report, MUST_WARN };
