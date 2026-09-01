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
  check('control: the real ledger is green against the real files', r.code === 0, r.out);
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
  fs.appendFileSync(DST(BIG), '// grown\n// grown\n// grown\n');
  const before = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).files[BIG];
  const a = run('--accept');
  const after = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).files[BIG];
  check('3. --accept exits 0 and says what moved', a.code === 0 && a.out.includes(`accepted ${BIG}: ${before} -> ${before + 3}`), a.out);
  check('3. ... the ledger now carries the new ceiling', after === before + 3, `before ${before}, after ${after}`);
  const r = run();
  check('3. ... and the plain check is green again', r.code === 0, r.out);
  seed();
}
// ---- 4. shrinking is green and reported as room ------------------------------
{
  const lines = fs.readFileSync(DST(BIG), 'utf8').split('\n');
  fs.writeFileSync(DST(BIG), lines.slice(0, -6).join('\n') + '\n');
  const r = run();
  check('4. a file BELOW its ceiling is green and named as room to ratchet down', r.code === 0 && /under\s+/.test(r.out) && /room to ratchet down/.test(r.out) && r.out.includes(BIG), r.out);
  seed();
}
// ---- 5. CRLF and LF count the same -------------------------------------------
{
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

if (failures) { console.error(`prove-red-line-ratchet: ${failures} assertion(s) FAILED`); process.exit(1); }
console.log(`prove-red-line-ratchet: all assertions held — the ratchet can go red, and it counts what we count.`);
