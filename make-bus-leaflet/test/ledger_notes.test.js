/*
 * ledger_notes.js — how a note gets INTO a generated ledger, and when a tool has
 * to refuse to record without one.
 *
 * The fault this module exists for is not a bug in any tool: it is that the prose
 * in `Development Docs/quality-ledger.json` was typed into the generated file by
 * hand, so it arrived at the editor's indent while the writer uses one space, and
 * five commits (099a2b9, bd9693e, bba5946, b82218d, bec2cd7) each rewrote about
 * 460 of that file's 468 lines to land a single paragraph. A ledger whose claim
 * is "raising a ceiling is a reviewable commit" is making a false claim the
 * moment its diff cannot be read.
 *
 * Two ledgers use this — `quality_gate.js` (a per-sheet quality ceiling) and
 * `tools/line-ratchet.js` (a per-file line ceiling). The last group of tests is
 * the one that matters most: an extraction is the module PLUS a check that its
 * callers use it, or deleting the require and pasting the parser back is green
 * everywhere.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ENGINE_DIR, load } = require('./_engine.js');
const LN = load('ledger_notes.js');

/* ---- 1. the grammar ---- */

test('parseNoteArg splits on the FIRST equals, so a note may contain one', () => {
  // "HARD 4 -> 5, drop=5" is the shape a real note takes. Splitting on the last
  // `=` would move the head of the sentence into the key and then refuse it as a
  // key nobody has heard of.
  const n = LN.parseNoteArg('a · internal=ACCEPTED: HARD 4 -> 5, drop=5');
  assert.strictEqual(n.key, 'a · internal');
  assert.strictEqual(n.text, 'ACCEPTED: HARD 4 -> 5, drop=5');
  // A relative path is the other ledger's key, and it survives the same way.
  assert.strictEqual(LN.parseNoteArg('assets/gen_internal.js=it grew').key, 'assets/gen_internal.js');
});

test('parseNoteArg refuses a value that is not "<key>=<text>"', () => {
  for (const bad of ['no equals sign at all', '=text with no key', 'key with no text=', '=', 42, undefined]) {
    assert.throws(() => LN.parseNoteArg(bad), /--note/, JSON.stringify(bad) + ' was accepted');
  }
});

test('a note file is one note per line, and names the line it could not read', () => {
  const parsed = LN.parseNoteFile('# a comment\n\na · internal=first\nb · external=second\n');
  assert.deepStrictEqual(parsed.map(n => n.key), ['a · internal', 'b · external']);
  // A line that cannot be read must NOT be skipped: a silently ignored line is a
  // note somebody believes they supplied, and the refusal then fires at a session
  // looking straight at it.
  assert.throws(() => LN.parseNoteFile('a · internal=fine\nrubbish\n'), /line 2/);
});

test('collectNotes merges the flags and the file, and refuses two notes for one key', () => {
  const merged = LN.collectNotes(['a · internal=from a flag'], 'b · external=from the file\n');
  assert.deepStrictEqual(merged, { 'a · internal': 'from a flag', 'b · external': 'from the file' });
  assert.deepStrictEqual(LN.collectNotes(), {}, 'no notes at all is an empty object, not a throw');
  assert.throws(() => LN.collectNotes(['a=one', 'a=two']), /two notes supplied for the same key/);
  assert.throws(() => LN.collectNotes(['a=one'], 'a=two\n'), /two notes supplied for the same key/,
    'a flag and a file colliding is the same fault as two flags');
});

/* ---- 2. the append ---- */

test('appendNote adds a dated paragraph and keeps what was there', () => {
  const out = LN.appendNote('2026-08-30, the placer round: ...', 'ACCEPTED DELIBERATELY: ...', '2026-09-04');
  assert.strictEqual(out, '2026-08-30, the placer round: ...\n\n2026-09-04, ACCEPTED DELIBERATELY: ...');
  assert.strictEqual(LN.appendNote(null, 'first thing said', '2026-09-04'), '2026-09-04, first thing said',
    'an entry with no note yet gets the paragraph on its own');
  assert.strictEqual(LN.appendNote(undefined, 'x', '2026-09-04'), '2026-09-04, x');
});

test('appendNote does not date a paragraph that already opens with a date', () => {
  const out = LN.appendNote('older', '2026-09-01, measured the day before', '2026-09-04');
  assert.strictEqual(out, 'older\n\n2026-09-01, measured the day before');
});

/* ---- 3. the refusal ---- */

test('noteFault names the raises that carry no note, and nothing else', () => {
  const rec = ['a', 'b', 'c'];
  assert.deepStrictEqual(LN.noteFault({ recording: rec, mustExplain: ['a', 'b'], notes: {} }),
    { code: 'UNNOTED_RAISE', keys: ['a', 'b'] });
  assert.deepStrictEqual(LN.noteFault({ recording: rec, mustExplain: ['a', 'b'], notes: { a: 'why' } }),
    { code: 'UNNOTED_RAISE', keys: ['b'] });
  assert.strictEqual(LN.noteFault({ recording: rec, mustExplain: ['a', 'b'], notes: { a: 'why', b: 'why' } }), null);
  assert.strictEqual(LN.noteFault({ recording: rec, mustExplain: [], notes: {} }), null,
    'an entry that is not raising a ceiling never needs a note');
  assert.strictEqual(LN.noteFault(), null, 'no arguments at all is not a fault');
});

test('a note is REQUIRED on a raise and ALLOWED anywhere', () => {
  // One-way on purpose: recording why a ceiling came DOWN is worth as much to a
  // later reader as recording why it went up.
  assert.strictEqual(LN.noteFault({ recording: ['a'], mustExplain: [], notes: { a: 'why it improved' } }), null);
});

test('a key the run is not recording is a fault, and is reported BEFORE the missing note', () => {
  // Both fire on a mistyped key: the note attaches to nothing, so the entry it
  // was meant for still counts as unexplained. Reporting the absence sends a
  // session hunting for a note it is holding in its hand, so the order is the
  // whole reason these two checks live in one function.
  const f = LN.noteFault({ recording: ['a'], mustExplain: ['a'], notes: { 'a-typo': 'why' } });
  assert.deepStrictEqual(f, { code: 'NOTE_FOR_NO_ROW', keys: ['a-typo'] });
});

/* ---- 4. the callers ARE the module ---- */

test('quality_gate.js and line-ratchet.js both call ledger_notes.js rather than parsing notes themselves', () => {
  // An extraction is the module PLUS a check that its callers use it. Without
  // this, deleting a require and pasting the parser back would be green
  // everywhere — which is exactly how the same rule came to exist twice before.
  const callers = {
    'quality_gate.js': fs.readFileSync(path.join(ENGINE_DIR, 'quality_gate.js'), 'utf8'),
    'line-ratchet.js': fs.readFileSync(path.join(__dirname, '..', 'tools', 'line-ratchet.js'), 'utf8'),
  };
  for (const [name, src] of Object.entries(callers)) {
    assert.match(src, /require\((?:'\.\/ledger_notes'|'\.\.\/assets\/ledger_notes')\)/, name + ' does not require ledger_notes.js');
    assert.ok(src.includes('collectNotes') && src.includes('noteFault') && src.includes('appendNote'),
      name + ' does not use the shared helpers');
    // The tell of a re-grown copy: the parser's own body, not its name.
    assert.ok(!/indexOf\('='\)/.test(src), name + ' has grown its own "<key>=<text>" parser back');
  }
});

test('nothing else in the engine defines a second copy of these helpers', () => {
  // NARROWER THAN IT WANTED TO BE, and the narrowing is the finding. The first
  // cut looked for `indexOf('=')` across all of assets/ and reported
  // gate_lib.js's `parseSetPath` — a genuinely different parser for a genuinely
  // different flag (`--set-path` takes JSON on the right and a `+` create prefix
  // on the left). A check that fires on correct code gets muted in its first
  // week, so this looks for a re-DEFINITION of these four names instead, which
  // is the actual shape of the fault it guards. The `indexOf('=')` test above
  // still runs, scoped to the two callers, where no other k=v parser belongs.
  const offenders = [];
  for (const f of fs.readdirSync(ENGINE_DIR)) {
    if (!f.endsWith('.js') || f === 'ledger_notes.js') continue;
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (/(function|const|let|var)\s+(parseNoteArg|parseNoteFile|collectNotes|appendNote|noteFault)\b/.test(line)) {
        offenders.push(f + ':' + (i + 1));
      }
    });
  }
  assert.deepStrictEqual(offenders, []);
});
