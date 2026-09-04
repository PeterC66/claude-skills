/*
 * line-ratchet.js — the note flags and the refusal, driven through the real CLI.
 *
 * SPAWNED, NOT REQUIRED, and that is forced rather than chosen: `tools/line-ratchet.js`
 * is a script whose whole body is top level and which calls `process.exit()`. The
 * shared grammar it uses is unit-tested in `ledger_notes.test.js`; what is left to
 * check here is the part only this tool decides — which files have to explain
 * themselves (the ones going UP), that the note reaches the ledger through the
 * tool's own writer at the tool's own indent, and that nothing gets past the
 * refusal. So each case builds a scratch root with a real ledger and a real file,
 * runs the tool at it with `--root` and `--ledger`, and reads the file back.
 *
 * `tools/prove-red-line-ratchet.js` covers the same refusal from the other side —
 * it makes the world wrong and requires the tool to go red — and both matter: this
 * file says the tool does the right thing, that one says it can do the wrong one.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scratchDir } = require('../assets/scratch');

const TOOL = path.join(__dirname, '..', 'tools', 'line-ratchet.js');
const SUBJECT = 'assets/subject.js';

// A scratch estate: one file of `lines` lines, and a ledger whose ceiling for it
// is `ceiling`. A ceiling BELOW the real count is a file going up.
function estate({ lines = 10, ceiling = 10, notes = undefined } = {}) {
  const dir = scratchDir('lr-');
  const ledgerPath = path.join(dir, 'line-ratchet.json');
  const root = path.join(dir, 'root');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, SUBJECT), Array.from({ length: lines }, (_, i) => '// ' + i).join('\n') + '\n');
  const ledger = { note: 'scratch', recorded: '2026-09-01', files: { [SUBJECT]: ceiling } };
  if (notes) ledger.notes = notes;
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  return {
    dir, ledgerPath,
    run: (...extra) => {
      const r = spawnSync(process.execPath, [TOOL, '--root', root, '--ledger', ledgerPath, ...extra], { encoding: 'utf8' });
      return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.stderr || '' };
    },
    read: () => JSON.parse(fs.readFileSync(ledgerPath, 'utf8')),
    raw: () => fs.readFileSync(ledgerPath, 'utf8'),
    done: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('--accept REFUSES a file that is OVER its ceiling with no note, and writes nothing', () => {
  const e = estate({ lines: 20, ceiling: 10 });
  const before = e.raw();
  const r = e.run('--accept');
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /REFUSING to --accept/);
  assert.match(r.out, /10 -> 20, \+10/, 'the refusal should name both numbers');
  assert.match(r.out, /no flag that switches this off/);
  assert.strictEqual(e.raw(), before, 'the ledger was rewritten despite the refusal');
  e.done();
});

test('a note lets the raise through, and lands as a dated paragraph in the ledger', () => {
  const e = estate({ lines: 20, ceiling: 10 });
  const r = e.run('--accept', '--note', SUBJECT + '=the eleven new lines are the AW1 branch, and they belong here because X');
  assert.strictEqual(r.code, 0, r.out);
  const after = e.read();
  assert.strictEqual(after.files[SUBJECT], 20, 'the new ceiling should be recorded');
  assert.match(after.notes[SUBJECT], /^\d{4}-\d{2}-\d{2}, the eleven new lines/, 'the note should be dated by the tool');
  e.done();
});

test('a new note is APPENDED to the file\'s existing one, never replacing it', () => {
  // The entry underneath is what says which state the one above was measured
  // from. Losing it turns a history into a single unexplained sentence.
  const e = estate({ lines: 20, ceiling: 10, notes: { [SUBJECT]: '2026-09-01, the first reason' } });
  assert.strictEqual(e.run('--accept', '--note', SUBJECT + '=the second reason').code, 0);
  const note = e.read().notes[SUBJECT];
  assert.match(note, /^2026-09-01, the first reason\n\n\d{4}-\d{2}-\d{2}, the second reason$/, note);
  e.done();
});

test('ratcheting DOWN needs no note, and carries the existing one forward', () => {
  // One-way on purpose. The ratchet makes the expensive direction expensive; a
  // file that shrank has nothing to justify, and its recorded reasoning is still
  // the record of how it got where it was.
  const e = estate({ lines: 5, ceiling: 10, notes: { [SUBJECT]: '2026-09-01, why it was 10' } });
  const r = e.run('--accept');
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(e.read().files[SUBJECT], 5);
  assert.strictEqual(e.read().notes[SUBJECT], '2026-09-01, why it was 10', 'the note was dropped on the way down');
  e.done();
});

test('a note naming a file the ledger does not is refused, and refused FIRST', () => {
  // Both faults fire on a mistyped path: the note attaches to nothing, so the
  // file it was meant for still counts as unexplained. Reporting the absence
  // would send a session hunting for a note it is holding in its hand.
  const e = estate({ lines: 20, ceiling: 10 });
  const r = e.run('--accept', '--note', 'assets/subjekt.js=typo');
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /a note names 1 file\(s\) the ledger does not/);
  assert.match(r.out, /assets\/subjekt\.js/);
  assert.doesNotMatch(r.out, /carry no note/, 'the typo was reported as an absent note');
  e.done();
});

test('two notes for one file are refused rather than one being dropped', () => {
  const e = estate({ lines: 20, ceiling: 10 });
  const r = e.run('--accept', '--note', SUBJECT + '=one', '--note', SUBJECT + '=two');
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /two notes supplied for the same key/);
  e.done();
});

test('--note-file takes the same grammar, and an unreadable line is named not skipped', () => {
  const e = estate({ lines: 20, ceiling: 10 });
  const nf = path.join(e.dir, 'notes.txt');
  fs.writeFileSync(nf, '# the round of today\n\n' + SUBJECT + '=from the file\n');
  assert.strictEqual(e.run('--accept', '--note-file', nf).code, 0);
  assert.match(e.read().notes[SUBJECT], /from the file$/);

  const e2 = estate({ lines: 20, ceiling: 10 });
  fs.writeFileSync(nf, SUBJECT + '=fine\nrubbish\n');
  const r = e2.run('--accept', '--note-file', nf);
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /line 2/);
  e.done(); e2.done();
});

test('--note takes every occurrence, not just the first', () => {
  // `flag()` answers with the first match and would have silently ignored the
  // second file's justification while still letting the run through.
  const e = estate({ lines: 20, ceiling: 10 });
  const other = 'assets/other.js';
  fs.writeFileSync(path.join(e.dir, 'root', other), '// x\n// x\n// x\n');
  const led = e.read(); led.files[other] = 1; fs.writeFileSync(e.ledgerPath, JSON.stringify(led, null, 2) + '\n');
  const r = e.run('--accept', '--note', SUBJECT + '=first', '--note', other + '=second');
  assert.strictEqual(r.code, 0, r.out);
  assert.match(e.read().notes[other], /second$/, 'the second --note was dropped');
  e.done();
});

test('the ledger is written with a TWO-space indent, whatever the note says', () => {
  // The fault the whole feature exists for, in this file's own dialect: the
  // committed ledger is stored at two spaces (the quality ledger is at one), and
  // a note typed in by hand arrives at whichever the editor offered, so the next
  // --accept reformats the file and buries its real change. Neither number is
  // right in general; what matters is that one writer decides it.
  const e = estate({ lines: 20, ceiling: 10 });
  assert.strictEqual(e.run('--accept', '--note', SUBJECT + '=a paragraph').code, 0);
  const lines = e.raw().split('\n');
  assert.strictEqual(lines[1].slice(0, 3), '  "', 'top-level keys must be indented by exactly two spaces, got ' + JSON.stringify(lines[1].slice(0, 5)));
  const filesAt = lines.findIndex(l => l.startsWith('  "files"'));
  assert.ok(filesAt > 0, 'no files block');
  assert.strictEqual(lines[filesAt + 1].slice(0, 5), '    "', 'a file key must be indented by exactly four spaces');
  e.done();
});

test('an unknown flag is still refused, so a mistyped --note-file is not a silent no-note run', () => {
  const e = estate({ lines: 20, ceiling: 10 });
  const r = e.run('--accept', '--noteflie', 'x');
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /unknown flag --noteflie/);
  assert.match(r.out, /--note-file/, 'the known-flag list should now name the note flags');
  e.done();
});

test('the plain check names the note requirement before the command is typed', () => {
  const e = estate({ lines: 20, ceiling: 10 });
  const r = e.run();
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /--accept will REFUSE a file that is OVER without --note/);
  // ...and says nothing of the sort when everything is at or under its ceiling.
  const ok = estate({ lines: 10, ceiling: 10 });
  const r2 = ok.run();
  assert.strictEqual(r2.code, 0, r2.out);
  assert.doesNotMatch(r2.out, /REFUSE/);
  e.done(); ok.done();
});
