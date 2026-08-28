/*
 * build_log.js — the module written after the engine said, in words, that St
 * Ives' river name had been refused and Ramsey's named nothing, and the sheets
 * shipped anyway because rollout.js threw stderr away on the success path.
 *
 * Its contract is two phrases, not a prefix list: anything that says it did not
 * draw something is a refusal, anything that says a label names nothing is the
 * fourth guard. A guard added later must inherit the right severity without
 * anyone editing this file. So these tests use messages the module has never
 * seen, in the wording the contract promises to recognise.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const BL = require('./_engine.js').load('build_log.js');

test('a refusal is BLOCKING, in wording this module has not been shown before', () => {
  assert.strictEqual(BL.severity('sometag: the level crossing was not drawn — no geometry in roads.json'), 'BLOCKING');
});

test('a label that names nothing is BLOCKING', () => {
  assert.strictEqual(BL.severity('feature: "Great Ouse" is 85mm from the nearest matching way and names nothing'), 'BLOCKING');
  assert.strictEqual(BL.severity('feature: the river has no geometry in this extract'), 'BLOCKING');
});

test('ink drawn off the page is BLOCKING, not a tidy-up note', () => {
  // Ely Co-op shipped a Key whose last rows — a whole frequency tier — ran under
  // the footer plate. The ink exists; no reader will ever see it. That was WARN,
  // so nothing stopped, and the sheet went into a review set.
  assert.strictEqual(BL.severity('key: the last 3 rows are under the footer plate'), 'BLOCKING');
  assert.strictEqual(BL.severity('panel: this list is too long for this panel'), 'BLOCKING');
  assert.strictEqual(BL.severity('exit: "to Boxworth" is past the frame edge'), 'BLOCKING');
});

test('an ordinary observation is WARN', () => {
  assert.strictEqual(BL.severity('labeller: 2 labels needed a leader line'), 'WARN');
  assert.strictEqual(BL.severity('footer: the note wrapped to 3 lines'), 'WARN');
});

test('a wrapped message is one entry, and keeps its prefix as the code', () => {
  // The generators wrap a warning that names its own remedy. A parser that split
  // on newlines would report one fault as three and make the log unreadable.
  const stderr = 'feature: "Great Ouse" is 85mm from the nearest matching way\n'
               + '  and names nothing. Set design.riverLabelAt, or remove it.\n';
  const entries = BL.parse(stderr, 'gen_internal');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].code, 'feature');
  assert.strictEqual(entries[0].source, 'gen_internal');
  assert.strictEqual(entries[0].severity, 'BLOCKING', 'severity is judged on the whole message, not the first line');
});

test('two prefixed messages are two entries', () => {
  const entries = BL.parse('a: first thing\nb: second thing\n', 'x');
  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(entries.map(e => e.code), ['a', 'b']);
});

test('collect keeps each run\'s source, and blocking filters to the ones that mean the sheet is wrong', () => {
  const all = BL.collect([
    { source: 'gen_internal', stderr: 'feature: the bypass was not drawn\n' },
    { source: 'gen_external', stderr: 'labeller: 1 label needed a leader line\n' },
  ]);
  assert.strictEqual(all.length, 2);
  const bad = BL.blocking(all);
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].source, 'gen_internal');
});

test('a clean run still says so', () => {
  // A missing file is ambiguous — clean run, or a build predating this module?
  // A file saying "no warnings" is evidence. The wording is the evidence.
  const text = BL.format([]);
  assert.match(text, /No warnings/);
  assert.doesNotMatch(text, /BLOCKING \(/);
});

test('the formatted log leads with the blocking count', () => {
  const text = BL.format(BL.parse('a: the river was not drawn\nb: something tight\n', 'gen'));
  assert.match(text, /2 warnings, 1 blocking\./);
  assert.match(text, /--- BLOCKING \(1\) ---/);
  assert.match(text, /--- WARN \(1\) ---/);
});

test('a mapNotes entry buried in the footer plate is BLOCKING (OA-065)', () => {
  // The engine has said this on three diagram towns and all three shipped: the
  // guard's WORDING differs from the two phrases already in the contract, and a
  // phrase that is not in the list is not in the contract. Promoted 2026-08-28
  // after sweeping all 20 committed maps — 52 generator runs, zero footer-plate
  // messages of any wording — so the gate starts green.
  assert.strictEqual(BL.severity(
    'mapNotes: "300, 301 and 9 stop at Morrisons" ends at y=190.0, inside/near the footer plate (top 188.1)'), 'BLOCKING');
  // ...and the near-miss stays a warning, or the rule fires on everything and
  // says nothing.
  assert.strictEqual(BL.severity(
    'mapNotes: "300, 301 and 9 stop at Morrisons" ends at y=170.0, clear of the footer plate (top 188.1)'), 'WARN');
});

test('a generator that threw is BLOCKING, not the mildest verdict this module has', () => {
  // Every other rule is a text rule, and an uncaught exception is not phrased
  // like a guard. Before 2026-08-28 a stack trace scored WARN — for the one
  // outcome where no sheet exists at all.
  assert.strictEqual(BL.severity("TypeError: Cannot read properties of undefined (reading 'some')"), 'BLOCKING');
  assert.strictEqual(BL.severity('    at Object.<anonymous> (/x/gen_internal.js:1801:14)'), 'BLOCKING');
  assert.strictEqual(BL.severity('gen_internal_place: gen_internal.js is not vendored beside the payload'), 'BLOCKING');
  assert.strictEqual(BL.severity('northArrow: the configured spot is blocked — placed automatically at 191,39'), 'WARN');
});

test('a run that exited non-zero is blocking even if it said NOTHING', () => {
  // The gap no text rule can close: "no message matched" and "no message" are
  // the same thing to a matcher, so a silent death read as a clean run.
  const died = BL.collect([{ source: 'gen_internal.js', stderr: '', ok: false }]);
  assert.strictEqual(BL.blocking(died).length, 1);
  assert.strictEqual(died[0].code, 'exit');
  // A run that both refused and died is ONE blocking entry, not two.
  const both = BL.collect([{ source: 'gen_internal.js', stderr: 'feature: the river was not drawn\n', ok: false }]);
  assert.strictEqual(BL.blocking(both).length, 1);
  // A clean run that warned is not blocking, and a caller that passes no `ok`
  // at all behaves exactly as it did before the key existed.
  assert.strictEqual(BL.blocking(BL.collect([{ source: 'g', stderr: 'northArrow: moved\n', ok: true }])).length, 0);
  assert.strictEqual(BL.blocking(BL.collect([{ source: 'g', stderr: 'northArrow: moved\n' }])).length, 0);
});

test('a message head may carry an underscore', () => {
  // `gen_internal_place:` was not recognised as a head at all, so its entry got
  // an empty code and the next line would have been glued onto it.
  const e = BL.parse('gen_internal_place: it failed\nlabels: 1 dropped\n', 'x');
  assert.strictEqual(e.length, 2);
  assert.deepStrictEqual(e.map(x => x.code), ['gen_internal_place', 'labels']);
});
