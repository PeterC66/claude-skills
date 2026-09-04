'use strict';
/*
 * ledger_notes.js — the prose half of a ratchet ledger: how a note gets IN, and
 * when a tool must refuse to record without one.
 *
 * TWO LEDGERS, ONE GRAMMAR. `quality_gate.js` records a per-sheet quality ceiling
 * and `tools/line-ratchet.js` records a per-file line ceiling. Both are generated
 * JSON, both are re-recorded by `--accept`, and in both the number is worthless a
 * month later without the sentence saying what was traded for what. This file is
 * that sentence's route into the file, written once so a fix reaches both — the
 * standing rule here is that a second copy of a rule is a rule that will drift,
 * and `test/ledger_notes.test.js` asserts both callers actually use it rather
 * than growing their own back.
 *
 * WHY IT EXISTS AT ALL. Five commits to `Development Docs/quality-ledger.json` —
 * 099a2b9, bd9693e, bba5946, b82218d, bec2cd7 — each rewrote about 460 of that
 * file's 468 lines to land a single paragraph. The tool was not the problem: the
 * prose was typed into the generated file BY HAND, so it arrived at whatever
 * indent the editor offered while the writer uses one space, and every later
 * `--accept` reformatted the file and buried its real change in the noise. A
 * generated file that people hand-edit to keep readable has stopped being
 * generated, and a ledger whose whole claim is "raising a ceiling is a
 * reviewable commit" is making a false claim the moment its diff cannot be read.
 *
 * So the note is an INPUT and the generator writes it. The person supplying the
 * prose never opens the file, so the indent is not theirs to get wrong.
 *
 * THIS FILE IS OUTSIDE THE ENGINE HASH and must stay there. `engine_version.js`
 * hashes the five entry points and their require closure; its two callers are a
 * gate and a tool, neither of which draws anything, so nothing here can mark a
 * map as built by a different engine. `test/engine_version.test.js` holds that.
 */

/*
 * parseNoteArg — "<key>=<text>" into its two halves, splitting on the FIRST `=`.
 *
 * A ledger key is a sheet name (`Huntingdon · schematic`) or a relative path
 * (`assets/gen_internal.js`) and cannot contain one; a note very well might
 * ("HARD 4 -> 5, drop=5"), and splitting on the LAST `=` would quietly move the
 * head of the sentence into the key and then refuse it as a key nobody knows.
 */
function parseNoteArg(s) {
  if (typeof s !== 'string') throw new Error('--note needs a value of the form "<key>=<text>"');
  const i = s.indexOf('=');
  const key = i < 0 ? '' : s.slice(0, i).trim();
  const text = i < 0 ? '' : s.slice(i + 1).trim();
  if (!key || !text) throw new Error('--note must read "<key>=<text>", not ' + JSON.stringify(s));
  return { key, text };
}

/*
 * parseNoteFile — the same grammar, one note per line. Blank lines and lines
 * beginning `#` are skipped so a file can be annotated and kept between runs;
 * everything else must parse, because a line silently ignored here is a note
 * somebody believes they supplied, and the refusal then fires at a session
 * looking straight at it. One line per note, not a paragraph block: these notes
 * run to several hundred words and the house style for prose in this project is
 * already one continuous line per paragraph.
 */
function parseNoteFile(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    try { out.push(parseNoteArg(line)); }
    catch { throw new Error('line ' + (i + 1) + ' of the note file must read "<key>=<text>", not ' + JSON.stringify(lines[i])); }
  }
  return out;
}

/*
 * collectNotes — the flags and the file into one { key: text }. Pure: it takes
 * the file's TEXT, not its path, so the parsing can be tested without a disk.
 *
 * A duplicate key is REFUSED rather than merged or last-wins. Two notes for one
 * key is a session that has lost track of what it is recording, and silently
 * dropping one of them writes a ceiling whose stated reason is not the reason.
 */
function collectNotes(noteArgs = [], fileText = null) {
  const notes = {};
  const add = ({ key, text }) => {
    if (Object.prototype.hasOwnProperty.call(notes, key)) {
      throw new Error('two notes supplied for the same key: ' + JSON.stringify(key));
    }
    notes[key] = text;
  };
  for (const a of noteArgs || []) add(parseNoteArg(a));
  if (fileText !== null && fileText !== undefined) for (const n of parseNoteFile(fileText)) add(n);
  return notes;
}

/*
 * appendNote — a DATED PARAGRAPH on the end of what the entry already says.
 *
 * Appending, never replacing. A long ledger note is a stack of dated
 * acceptances, and the one underneath is what says which state the one above was
 * measured FROM — the quality ledger's Huntingdon internal row carries three,
 * and the third is only readable because the first two are still there. `\n\n` is
 * the separator the existing entries use.
 *
 * The date is prefixed here rather than left to the caller, because a date typed
 * by hand is a date that can be wrong; text that already opens with an ISO date
 * is left alone so a session recording yesterday's measurement can say so.
 */
const NOTE_SEP = '\n\n';
function appendNote(existing, text, today) {
  const para = /^\d{4}-\d{2}-\d{2}/.test(text) ? text : today + ', ' + text;
  return existing ? existing + NOTE_SEP + para : para;
}

/*
 * noteFault — the refusal, and THERE IS NO BYPASS.
 *
 * `recording` is every key the run is about to write. `mustExplain` is the subset
 * that is RAISING a ceiling — a quality sheet that has REGRESSED, a source file
 * now over its line ceiling. Returns null when the notes are sufficient, or the
 * first fault as { code, keys }.
 *
 * Raising a ceiling is the one move a ratchet exists to make expensive, and until
 * these two tools refused it the only thing between a raise and silence was
 * whether the session remembered to write a sentence. Read either ledger: the
 * entries that carry a note say what was traded for what and are the ones a later
 * session can act on; the entries without are numbers nobody can now explain.
 * There is deliberately no `--force` and no `--no-note` in either caller — a flag
 * that switches a justification off is a flag that gets typed at six o'clock, and
 * the thing being switched off is the only durable record of why it got worse.
 * The note can be one line; it cannot be nothing.
 *
 * THE ORDER OF THE TWO CHECKS IS THE POINT OF PUTTING THEM IN ONE FUNCTION. A
 * mistyped key trips BOTH — the note attaches to nothing, so the entry it was
 * meant for still counts as unexplained — and reporting the absence sends a
 * session hunting for a note it is holding in its hand. Naming the typo is the
 * actionable message, so the stray check comes first, once, for both callers.
 */
function noteFault({ recording = [], mustExplain = [], notes = {} } = {}) {
  const known = new Set(recording);
  const stray = Object.keys(notes).filter(k => !known.has(k));
  if (stray.length) return { code: 'NOTE_FOR_NO_ROW', keys: stray };
  const missing = mustExplain.filter(k => !notes[k]);
  if (missing.length) return { code: 'UNNOTED_RAISE', keys: missing };
  return null;
}

module.exports = { parseNoteArg, parseNoteFile, collectNotes, appendNote, noteFault, NOTE_SEP };
