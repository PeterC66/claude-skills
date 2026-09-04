#!/usr/bin/env node
/*
 * line-ratchet.js — the top-to-bottom generators may not GROW without saying so.
 *
 *   node tools/line-ratchet.js             # check every file in the ledger
 *   node tools/line-ratchet.js --accept    # re-record the ledger from today
 *   node tools/line-ratchet.js --accept --note "assets/gen_internal.js=why it grew"
 *   node tools/line-ratchet.js --accept --note-file notes.txt
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
 * AND RAISING A CEILING NOW HAS TO SAY WHY (2026-09-04). `--accept` refuses to
 * record a file that is OVER its ceiling unless a note is supplied for it, with
 * no bypass flag; the note is appended to that file's existing ledger note as a
 * dated paragraph and written by this tool rather than typed into the JSON. The
 * whole reasoning, and the five quality-ledger commits that each rewrote 460 of
 * 468 lines because the prose WAS typed in by hand, is at the head of
 * `assets/ledger_notes.js` — which owns the grammar and the refusal so that this
 * tool and `quality_gate.js` cannot drift into two dialects of the same flag.
 * Lowering a ceiling needs no note: the ratchet only makes the expensive
 * direction expensive.
 *
 * THIS FILE IS OUTSIDE THE ENGINE HASH. `engine_version.js` hashes the require
 * closure of the entry generators; nothing here is required by any of them, so
 * adding or editing this tool moves no map's `engine` stamp. `ledger_notes.js`
 * lives in `assets/` because `quality_gate.js` is its other caller, and it is
 * outside the closure for the same reason — `test/engine_version.test.js` holds
 * that, and a require added here cannot change it.
 *
 * Exit codes: 0 every file at or under its ceiling; 1 a file is over, missing,
 * or not in the ledger; 2 usage, which includes a missing or misdirected note.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const NOTES = require('../assets/ledger_notes');

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf('--' + n); return i < 0 ? null : (argv[i + 1] || null); };
// `--note` ACCUMULATES, so it needs its own reader: `flag()` answers with the
// FIRST occurrence, and a run that raises three ceilings passes three notes.
const flagAll = (n) => argv.reduce((acc, a, i) => (a === '--' + n && argv[i + 1] ? acc.concat(argv[i + 1]) : acc), []);
const ROOT = path.resolve(flag('root') || path.join(__dirname, '..'));
const LEDGER = path.resolve(flag('ledger') || path.join(__dirname, 'line-ratchet.json'));
const ACCEPT = argv.includes('--accept');
const KNOWN = ['--root', '--ledger', '--accept', '--note', '--note-file'];
// The whitelist stays, and stays exhaustive: refusing an unknown flag is the
// property that makes a typo'd `--noteflie` a refusal rather than a silent
// no-note run, which is exactly the failure the notes exist to prevent.
for (const a of argv) {
  if (a.startsWith('--') && !KNOWN.includes(a)) {
    console.error('line-ratchet.js: unknown flag ' + a + ' (known: ' + KNOWN.map(f => f + (f === '--accept' ? '' : ' <value>')).join(', ') + ')');
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
  const today = new Date().toISOString().slice(0, 10);

  let notes;
  try {
    const nf = flag('note-file');
    if (argv.includes('--note-file') && !nf) { console.error('line-ratchet.js: --note-file needs a path'); process.exit(2); }
    notes = NOTES.collectNotes(flagAll('note'), nf ? fs.readFileSync(path.resolve(nf), 'utf8') : null);
  } catch (e) { console.error('line-ratchet.js: ' + e.message); process.exit(2); }

  // A missing file is refused BEFORE the note check, and it is the older rule:
  // there is nothing to count, so there is no ceiling to justify either way.
  for (const r of rows) {
    if (r.now == null) { console.error(`line-ratchet.js: --accept cannot record ${r.rel}: file is missing`); process.exit(1); }
  }

  // THE REFUSAL. `mustExplain` is the files going UP — a ceiling being RAISED is
  // the one move this ratchet exists to make expensive, and until now --accept
  // recorded a 3,286 -> 3,400 as readily as a 3,286 -> 3,200. Coming DOWN needs
  // no note. The order of the two faults, and the reason there is no bypass, are
  // noteFault()'s in assets/ledger_notes.js.
  const fault = NOTES.noteFault({
    recording: rows.map(r => r.rel),
    mustExplain: rows.filter(r => r.now > r.ceiling).map(r => r.rel),
    notes,
  });
  if (fault && fault.code === 'NOTE_FOR_NO_ROW') {
    console.error('line-ratchet.js: REFUSING to --accept — a note names ' + fault.keys.length + ' file(s) the ledger does not.');
    for (const k of fault.keys) console.error('  ' + k + '   — no such entry; copy the path from the ledger or from a check run');
    process.exit(2);
  }
  if (fault) {
    console.error(`line-ratchet.js: REFUSING to --accept — ${fault.keys.length} file(s) are OVER their ceiling and carry no note.`);
    for (const k of fault.keys) {
      const r = rows.find(x => x.rel === k);
      console.error(`  ${k}   ${r.ceiling} -> ${r.now}, +${r.now - r.ceiling}`);
    }
    console.error('');
    console.error('Raising a ceiling is the whole thing this ratchet makes expensive: the OA-001 rule is');
    console.error('that new logic goes in a MODULE, and accepting growth instead is a decision. Say why:');
    console.error(`  --note "${fault.keys[0]}=the lines are X, and they belong in the script because Y"`);
    console.error('or put one line per file in a file and pass --note-file <path>.');
    console.error('There is no flag that switches this off. Ratcheting DOWN never needs a note.');
    process.exit(2);
  }

  // `{ ...ledger }` carries `note` and, from 2026-09-04, `notes` forward — the
  // same reason quality_gate.js carries its `targets` block: --accept is the run
  // that would otherwise delete the prose it is being asked to add to.
  const next = { ...ledger, recorded: today, files: {} };
  next.notes = { ...(ledger.notes || {}) };
  let moved = 0;
  for (const r of rows) {
    next.files[r.rel] = r.now;
    if (notes[r.rel]) next.notes[r.rel] = NOTES.appendNote(next.notes[r.rel], notes[r.rel], today);
    if (r.now !== r.ceiling) { moved++; console.log(`  accepted ${r.rel}: ${r.ceiling} -> ${r.now}`); }
  }
  // A file that has left the ledger takes its note with it, or the block becomes
  // a graveyard of paths nothing counts. `rows` is the ledger's own key set, so
  // this only ever drops a note whose file was removed from `files` by hand.
  for (const k of Object.keys(next.notes)) if (!(k in next.files)) delete next.notes[k];
  if (!Object.keys(next.notes).length) delete next.notes;

  /* TWO SPACES, because that is what the committed ledger is stored with and this
   * is the only thing that should ever write it. The indent is not the note
   * author's to get wrong precisely because they never open the file — see the
   * head of assets/ledger_notes.js for the five commits that paid for that rule
   * in the OTHER ledger, which is written at ONE space. Neither number is right
   * in general; what matters is that one writer decides it. */
  fs.writeFileSync(LEDGER, JSON.stringify(next, null, 2) + '\n');
  const noted = Object.keys(notes).length;
  console.log(`line-ratchet: ledger re-recorded, ${rows.length} file(s), ${moved} ceiling(s) moved`
    + (noted ? `, ${noted} dated note(s) appended` : '') + ` -> ${path.relative(process.cwd(), LEDGER) || LEDGER}`);
  console.log('  Commit the ledger in the SAME commit as the growth it accepts, and say why in the message.');
  process.exit(0);
}

if (over || missing) {
  console.error(`line-ratchet: RED — ${over} file(s) over the ceiling, ${missing} missing, of ${rows.length}.`);
  console.error('  A generator grew. Either move the new logic into a module (the OA-001 rule), or accept the');
  console.error('  growth deliberately: node tools/line-ratchet.js --accept, committed WITH the change.');
  // Said here rather than only at the refusal, so the requirement is known before
  // the command is typed rather than after it has been refused.
  if (over) console.error('  --accept will REFUSE a file that is OVER without --note "<path>=<why>". There is no bypass.');
  process.exit(1);
}
console.log(`line-ratchet: ${rows.length} file(s) at or under their ceilings (${under} below, room to ratchet down with --accept).`);
