#!/usr/bin/env node
/*
 * line-ratchet.js — the top-to-bottom generators may not GROW without saying so.
 *
 *   node tools/line-ratchet.js             # check every file in the ledger
 *   node tools/line-ratchet.js --accept    # re-record the ledger from today
 *
 * Run from `make-bus-leaflet/`. `--root <dir>` and `--ledger <file>` exist only
 * so `prove-red-line-ratchet.js` can point it at a scratch copy; nothing else
 * should pass them.
 *
 * WHY THIS EXISTS. On 2026-08-27 the refactor (OA-129 Phase 3) cut
 * `gen_internal.js` from 3,933 lines to 2,550 and wrote the rule that came out
 * of it into OA-001 and test/README.md: when a generator needs new logic, write
 * it as a MODULE, not as more lines in the script. Measured from git history on
 * 2026-09-01 the file was 3,293 lines — up 29% in five days across thirteen
 * commits by sessions that had read both documents — and `status.js` had gone
 * from 613 to 1,664 in twenty-five. Nobody broke the rule knowingly; each commit
 * was a legitimate feature and the rule had no instrument. A rule that lives
 * only in prose is a wish (buses-data OA-224, Tier 2.1).
 *
 * WHAT IT DOES. `tools/line-ratchet.json` records a CEILING per file. The check
 * counts each file's lines and fails when any file is above its ceiling, naming
 * the file and both numbers. A file BELOW its ceiling passes and is reported as
 * room to ratchet down. `--accept` rewrites every ceiling to today's count, up
 * or down, and prints what moved — so raising a ceiling is a reviewed change to
 * a tracked file in the SAME COMMIT as the growth, which is the escape hatch:
 * not "you may never add a line" but "adding lines is a decision somebody wrote
 * down", the same shape as `quality_gate.js --accept` and its ledger.
 *
 * LINES ARE COUNTED THE SAME WAY ON EVERY MACHINE. The count is the number of
 * newline-terminated lines after stripping `\r`, plus one for an unterminated
 * last line — so a CRLF checkout and an LF checkout agree, which matters because
 * this repository has held both (see .gitattributes).
 *
 * THIS FILE IS OUTSIDE THE ENGINE HASH. `engine_version.js` hashes the require
 * closure of the entry generators; nothing here is required by any of them, so
 * adding or editing this tool moves no map's `engine` stamp.
 *
 * Exit codes: 0 every file at or under its ceiling; 1 a file is over, missing,
 * or not in the ledger; 2 usage.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf('--' + n); return i < 0 ? null : (argv[i + 1] || null); };
const ROOT = path.resolve(flag('root') || path.join(__dirname, '..'));
const LEDGER = path.resolve(flag('ledger') || path.join(__dirname, 'line-ratchet.json'));
const ACCEPT = argv.includes('--accept');
for (const a of argv) {
  if (a.startsWith('--') && !['--root', '--ledger', '--accept'].includes(a)) {
    console.error('line-ratchet.js: unknown flag ' + a + ' (known: --root <dir>, --ledger <file>, --accept)');
    process.exit(2);
  }
}

function countLines(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  if (raw === '') return 0;
  const n = raw.split('\n').length;
  return raw.endsWith('\n') ? n - 1 : n;
}

let ledger;
try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); }
catch (e) { console.error('line-ratchet.js: cannot read ledger ' + LEDGER + ': ' + e.message); process.exit(1); }
const files = ledger.files && typeof ledger.files === 'object' ? ledger.files : null;
if (!files || !Object.keys(files).length) {
  console.error('line-ratchet.js: the ledger names no files (expected a "files" object of relative path -> ceiling)');
  process.exit(1);
}

const rows = [];
let over = 0, missing = 0, under = 0;
for (const rel of Object.keys(files).sort()) {
  const ceiling = files[rel];
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { rows.push({ rel, ceiling, now: null, verdict: 'MISSING' }); missing++; continue; }
  const now = countLines(abs);
  let verdict = 'OK';
  if (now > ceiling) { verdict = 'OVER'; over++; }
  else if (now < ceiling) { verdict = 'under'; under++; }
  rows.push({ rel, ceiling, now, verdict });
}

const w = Math.max(...rows.map(r => r.rel.length));
for (const r of rows) {
  const now = r.now == null ? '-' : String(r.now);
  console.log(`  ${r.verdict.padEnd(7)} ${r.rel.padEnd(w)}  ${now.padStart(5)} / ${String(r.ceiling).padStart(5)}`
    + (r.verdict === 'OVER' ? `  +${r.now - r.ceiling} over the ceiling` : r.verdict === 'under' ? `  ${r.ceiling - r.now} below (room to ratchet down)` : ''));
}

if (ACCEPT) {
  const next = { ...ledger, recorded: new Date().toISOString().slice(0, 10), files: {} };
  let moved = 0;
  for (const r of rows) {
    if (r.now == null) { console.error(`line-ratchet.js: --accept cannot record ${r.rel}: file is missing`); process.exit(1); }
    next.files[r.rel] = r.now;
    if (r.now !== r.ceiling) { moved++; console.log(`  accepted ${r.rel}: ${r.ceiling} -> ${r.now}`); }
  }
  fs.writeFileSync(LEDGER, JSON.stringify(next, null, 2) + '\n');
  console.log(`line-ratchet: ledger re-recorded, ${rows.length} file(s), ${moved} ceiling(s) moved -> ${path.relative(process.cwd(), LEDGER) || LEDGER}`);
  console.log('  Commit the ledger in the SAME commit as the growth it accepts, and say why in the message.');
  process.exit(0);
}

if (over || missing) {
  console.error(`line-ratchet: RED — ${over} file(s) over the ceiling, ${missing} missing, of ${rows.length}.`);
  console.error('  A generator grew. Either move the new logic into a module (the OA-001 rule), or accept the');
  console.error('  growth deliberately: node tools/line-ratchet.js --accept, committed WITH the change.');
  process.exit(1);
}
console.log(`line-ratchet: ${rows.length} file(s) at or under their ceilings (${under} below, room to ratchet down with --accept).`);
