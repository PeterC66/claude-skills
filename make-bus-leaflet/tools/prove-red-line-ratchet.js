#!/usr/bin/env node
/*
 * prove-red-line-ratchet.js — break `line-ratchet.js` on purpose and require it
 * to notice, because a green check that has never been seen to go red proves
 * nothing.
 *
 *   node tools/prove-red-line-ratchet.js
 *
 * Run from `make-bus-leaflet/`. No arguments. Touches nothing outside a scratch
 * folder: it copies the real ledger and every file it names into a scratch tree
 * with the same relative layout, and points the checker there with `--root` and
 * `--ledger`.
 *
 * THE CONTROL COUNTS FOR ITSELF. The control runs the checker unmutated over the
 * real ledger and requires green — and then re-counts every file's lines by its
 * own independent method and requires the checker's printed count to match. A
 * checker that had gone blind to a file, or counted CRLF and LF checkouts
 * differently, would still print a tidy green and would fail here.
 *
 * THE CASES, each reverted before the next:
 *   1. three lines appended to the largest generator        -> RED, names the file and +3
 *   2. a ledger file deleted from the scratch tree           -> RED, MISSING
 *   3. --accept after the growth                             -> GREEN, ledger records the new count
 *   4. lines REMOVED from a file                             -> GREEN, reported as room to ratchet down
 *   5. a CRLF copy of a file                                 -> the same count as the LF original
 *   6. a ledger with no "files"                              -> RED, says so
 *   7. --accept on growth with NO note                       -> REFUSED, and the ledger is untouched
 *   8. --accept on growth WITH a note                        -> GREEN, dated paragraph, two-space indent
 *   9. a note naming a file the ledger does not              -> REFUSED as a typo, not as an absent note
 *  10. --accept on a SHRINK with no note                     -> GREEN; the refusal is one-way
 *
 * A CRASH IS NOT A RED. Each red case asserts the MESSAGE, not just the non-zero
 * exit, and rejects any stderr carrying a stack frame.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scratchDir } = require('../assets/scratch');

const SK = path.join(__dirname, '..');
const CHECKER = path.join(SK, 'tools/line-ratchet.js');
const REAL_LEDGER = path.join(SK, 'tools/line-ratchet.json');

const WORK = scratchDir('prove-red-line-ratchet-');
const ROOT = path.join(WORK, 'root');
const LEDGER = path.join(WORK, 'line-ratchet.json');
fs.mkdirSync(ROOT, { recursive: true });

const real = JSON.parse(fs.readFileSync(REAL_LEDGER, 'utf8'));
const FILES = Object.keys(real.files);
if (!FILES.length) { console.error('prove-red-line-ratchet: the real ledger names no files'); process.exit(1); }
const SRC = (rel) => path.join(SK, rel);
const DST = (rel) => path.join(ROOT, rel);
function seed() {
  for (const rel of FILES) {
    fs.mkdirSync(path.dirname(DST(rel)), { recursive: true });
    fs.copyFileSync(SRC(rel), DST(rel));
  }
  fs.writeFileSync(LEDGER, JSON.stringify(real, null, 2) + '\n');
}
seed();

/*
 * seedLevel — the same files, but a ledger whose ceilings ARE today's counts.
 *
 * Every `--accept` case below needs this, and the reason is a fault this harness
 * acquired on 2026-09-04 rather than one it was born with. Until `--accept`
 * gained the note refusal it recorded whatever it found, so a case could grow one
 * file and reason about that file alone. Now ANY file over its ceiling refuses the
 * whole run — including a file this harness never touched, in an edit belonging to
 * another session, which is the normal state of this checkout. That is exactly how
 * a harness earns a reputation for going red about nothing and stops being read.
 *
 * So the growth cases run against a ledger this harness owns, where the only file
 * out of line is the one the case put out of line. The CONTROL still uses the real
 * ledger — that is where the real estate belongs.
 *
 * AND IT DROPS THE NOTES BLOCK, which is the same fault one turn further on and was
 * found on 2026-09-04 (OA-247), the first day any file carried a real note. `--accept`
 * APPENDS a dated paragraph to whatever note a file already has — correctly, that is
 * the point of it — so case 8, which asserts the note in the ledger is exactly the
 * one it just wrote, started failing about a real note that had nothing to do with
 * it. Three cases depended on the real ledger's CONTENTS rather than on the
 * checker's behaviour, and each of the three broke the first time the estate said
 * something it had never said before. A harness owns its fixture or it does not have
 * one.
 */
function seedLevel() {
  seed();
  const level = { ...real, files: {} };
  delete level.notes;
  for (const rel of FILES) level.files[rel] = myCount(DST(rel));
  fs.writeFileSync(LEDGER, JSON.stringify(level, null, 2) + '\n');
  return level;
}

const run = (...extra) => {
  const r = spawnSync(process.execPath, [CHECKER, '--root', ROOT, '--ledger', LEDGER, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.stderr || '' };
};
// Independent count: newline-terminated lines, \r ignored, +1 for an unterminated tail.
const myCount = (file) => {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  if (raw === '') return 0;
  return raw.endsWith('\n') ? raw.split('\n').length - 1 : raw.split('\n').length;
};

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.error('  FAIL ' + name + (extra ? '\n       ' + String(extra).trim().split('\n').slice(0, 6).join('\n       ') : '')); }
};
const noStack = (r) => !/^\s+at .*\(.*:\d+:\d+\)/m.test(r.err);

// ---- control: unmutated must be green, and its counts must be OURS ----------
{
  const r = run();
  // THE CONTROL IS ABOUT THE CHECKER, NOT ABOUT THE ESTATE. It used to require
  // the real ledger to be GREEN, which made this harness unrunnable whenever a
  // neighbouring session had a generator mid-growth — a true fact about the
  // estate, reported as a broken harness, on a checkout where concurrent
  // sessions are the norm. What it can honestly require is that the checker's
  // verdict AGREES with an independent count: green exactly when nothing is over.
  const anyOver = FILES.some(rel => myCount(SRC(rel)) > real.files[rel]);
  check(`control: the checker's exit agrees with an independent count (${anyOver ? 'something is over' : 'nothing is over'})`,
    r.code === (anyOver ? 1 : 0), r.out);
  let agree = 0;
  for (const rel of FILES) {
    const n = myCount(SRC(rel));
    // (^|\s), not \b: a path beginning `../` has no word boundary before it, and
    // the first run of this control failed on exactly that file -- which is the
    // control doing its job on its own author.
    const re = new RegExp('(^|\\s)' + rel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\s+' + n + ' /');
    if (re.test(r.out)) agree++;
  }
  check(`control: the checker's printed count matches an independent count for all ${FILES.length} files`, agree === FILES.length, `${agree} of ${FILES.length} agreed\n${r.out}`);
}

// The file with the highest ceiling is the one the ratchet exists for.
const BIG = FILES.reduce((a, b) => (real.files[a] >= real.files[b] ? a : b));

// ---- 1. growth ---------------------------------------------------------------
{
  // seedLevel, not seed: `+3 over the ceiling` is only true if BIG started AT its
  // ceiling, which is a fact about the estate and not about the checker. On
  // 2026-09-04 BIG was +23 over from another session's commit and this case failed
  // saying `+26`, which is the harness reporting a true fact about the tree as its
  // own breakage — exactly what seedLevel exists to stop.
  seedLevel();
  fs.appendFileSync(DST(BIG), '// grown\n// grown\n// grown\n');
  const r = run();
  check('1. three appended lines go RED', r.code === 1, r.out);
  check('1. ... naming the file and the excess', r.out.includes(BIG) && /\+3 over the ceiling/.test(r.out), r.out);
  check('1. ... and it is a verdict, not a crash', noStack(r), r.err);
  seed();
}
// ---- 2. a missing file --------------------------------------------------------
{
  fs.unlinkSync(DST(BIG));
  const r = run();
  check('2. a ledger file missing from disk goes RED', r.code === 1 && /MISSING/.test(r.out) && r.out.includes(BIG), r.out);
  check('2. ... and it is a verdict, not a crash', noStack(r), r.err);
  seed();
}
// ---- 3. --accept records the growth and the check goes green -----------------
{
  seedLevel();   // see seedLevel(): --accept now refuses on ANY file over, ours or not
  fs.appendFileSync(DST(BIG), '// grown\n// grown\n// grown\n');
  const before = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).files[BIG];
  const a = run('--accept', '--note', BIG + '=case 3: the growth this case is about');
  const after = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).files[BIG];
  check('3. --accept exits 0 and says what moved', a.code === 0 && a.out.includes(`accepted ${BIG}: ${before} -> ${before + 3}`), a.out);
  check('3. ... the ledger now carries the new ceiling', after === before + 3, `before ${before}, after ${after}`);
  const r = run();
  check('3. ... and the plain check is green again', r.code === 0, r.out);
  seed();
}
// ---- 4. shrinking is green and reported as room ------------------------------
{
  // Levelled for the same reason the --accept cases are, and this one was exposed
  // before the notes existed: it asserts the whole run is GREEN, so any file over
  // its ceiling anywhere — a neighbouring session's generator, mid-edit — decides
  // it. Found on 2026-09-04 when exactly that happened.
  seedLevel();
  const lines = fs.readFileSync(DST(BIG), 'utf8').split('\n');
  fs.writeFileSync(DST(BIG), lines.slice(0, -6).join('\n') + '\n');
  const r = run();
  check('4. a file BELOW its ceiling is green and named as room to ratchet down', r.code === 0 && /under\s+/.test(r.out) && /room to ratchet down/.test(r.out) && r.out.includes(BIG), r.out);
  seed();
}
// ---- 5. CRLF and LF count the same -------------------------------------------
{
  seedLevel();
  const lf = fs.readFileSync(DST(BIG), 'utf8').replace(/\r/g, '');
  fs.writeFileSync(DST(BIG), lf.replace(/\n/g, '\r\n'));
  const r = run();
  check('5. a CRLF copy counts the same as the LF original (still green)', r.code === 0, r.out);
  seed();
}
// ---- 6. a ledger with nothing in it ------------------------------------------
{
  fs.writeFileSync(LEDGER, JSON.stringify({ note: 'empty' }, null, 2));
  const r = run();
  check('6. a ledger naming no files is RED and says so', r.code === 1 && /names no files/.test(r.out), r.out);
  check('6. ... and it is a verdict, not a crash', noStack(r), r.err);
  seed();
}

/* ---- 7-10. the note, and the refusal that needs it (2026-09-04) --------------
 * Case 3 above proves --accept records growth. That is exactly the move this
 * ratchet exists to make expensive, and until these cases it was as cheap as
 * ratcheting down. What follows is the other half: --accept refuses a raise with
 * no reason attached, the reason lands through the tool's own writer at the
 * tool's own indent, and coming DOWN still costs nothing. The grammar itself is
 * ledger_notes.js's and is unit-tested; these are the cases only a real run of
 * this tool can answer. */
const NOTE_TEXT = 'the three lines are the AW1 branch and they belong in the script';

// ---- 7. a raise with no note is refused, and the ledger does not move --------
{
  seedLevel();   // `+3` is the growth this case made, not the growth the estate had
  fs.appendFileSync(DST(BIG), '// grown\n// grown\n// grown\n');
  const before = fs.readFileSync(LEDGER, 'utf8');
  const r = run('--accept');
  check('7. --accept on growth with NO note is REFUSED', r.code === 2, r.out);
  check('7. ... naming the file and both numbers', r.out.includes(BIG) && /-> \d+, \+3/.test(r.out), r.out);
  check('7. ... and says there is no way round it', /no flag that switches this off/.test(r.out), r.out);
  check('7. ... the ledger is byte-identical afterwards', fs.readFileSync(LEDGER, 'utf8') === before);
  check('7. ... and it is a verdict, not a crash', noStack(r), r.err);
  seed();
}
// ---- 8. a raise WITH a note goes through, dated, at the tool's own indent -----
{
  seedLevel();
  fs.appendFileSync(DST(BIG), '// grown\n// grown\n// grown\n');
  const a = run('--accept', '--note', BIG + '=' + NOTE_TEXT);
  check('8. --accept with a note exits 0 and says a note was appended', a.code === 0 && /1 dated note\(s\) appended/.test(a.out), a.out);
  const raw = fs.readFileSync(LEDGER, 'utf8');
  const after = JSON.parse(raw);
  check('8. ... the note is in the ledger, dated by the tool', new RegExp('^\\d{4}-\\d{2}-\\d{2}, ' + NOTE_TEXT + '$').test((after.notes || {})[BIG] || ''), JSON.stringify((after.notes || {})[BIG]));
  // THE FAULT THE WHOLE FEATURE EXISTS FOR. A note typed into the file by hand
  // arrives at the editor's indent, and the next --accept then reformats every
  // line and buries its real change -- five commits to the quality ledger did
  // exactly that. The tool writes it, so the indent is not the author's to get
  // wrong, and this is the assertion that says so.
  check('8. ... written at the tool\'s two-space indent, not the note author\'s',
    raw.split('\n')[1].slice(0, 3) === '  "', JSON.stringify(raw.split('\n')[1].slice(0, 5)));
  seed();
}
// ---- 9. a mistyped path is reported as a typo, not as an absent note ---------
{
  seedLevel();   // so the only file needing a note is the one this case grew
  fs.appendFileSync(DST(BIG), '// grown\n// grown\n// grown\n');
  const r = run('--accept', '--note', BIG + '.typo=' + NOTE_TEXT);
  check('9. a note naming a file the ledger does not is REFUSED', r.code === 2, r.out);
  // Both faults fire on this input and only one of them is useful: reporting the
  // absence sends a session hunting for a note it is holding in its hand.
  check('9. ... as a typo rather than as a missing note',
    /the ledger does not/.test(r.out) && !/carry no note/.test(r.out), r.out);
  check('9. ... and it is a verdict, not a crash', noStack(r), r.err);
  seed();
}
// ---- 10. the refusal is one-way ----------------------------------------------
{
  seedLevel();
  const lines = fs.readFileSync(DST(BIG), 'utf8').split('\n');
  fs.writeFileSync(DST(BIG), lines.slice(0, -6).join('\n') + '\n');
  const r = run('--accept');
  check('10. ratcheting DOWN with no note is still green', r.code === 0, r.out);
  seed();
}

if (failures) { console.error(`prove-red-line-ratchet: ${failures} assertion(s) FAILED`); process.exit(1); }
console.log(`prove-red-line-ratchet: all assertions held — the ratchet can go red, and it counts what we count.`);
