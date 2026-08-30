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

/* ---- MEASURED, the third severity (OA-118, 2026-08-30) -------------------- */

test('a measurement is its own severity, and not the mildest of the other two', () => {
  // The point of the row: a number the engine records on every build is not a
  // warning, and filing it as one is how a measurement stops being recorded at all.
  assert.strictEqual(BL.severity('measure: lanes on=true segs=1204 lateral=50 components=3 bridges=0 conflicts=0 flipped=3953'), 'MEASURED');
});

test('MEASURED is judged on the PREFIX, and it is judged FIRST', () => {
  // This is the one rule in the file that does not classify on a phrase, and the
  // order matters: a measurement's payload is arbitrary text. If the phrase rules
  // ran first, a count of undrawn labels would be filed as a refusal — the sheet
  // would read as WRONG because something measured it.
  assert.strictEqual(BL.severity('measure: labels total=44 not drawn=3'), 'MEASURED');
  assert.strictEqual(BL.severity('measure: features named nothing=0'), 'MEASURED');
  assert.strictEqual(BL.severity('measure: rows under the footer plate=0'), 'MEASURED');
  // ...and the same words WITHOUT the prefix are still the refusals they were.
  assert.strictEqual(BL.severity('feature: the river was not drawn'), 'BLOCKING');
});

test('a prefix that merely CONTAINS the word measure is not a measurement', () => {
  assert.strictEqual(BL.severity('measurement: 3 labels moved'), 'WARN');
  assert.strictEqual(BL.severity('labeller: we measure: 3 things'), 'WARN');
});

test('the log counts measurements APART from warnings', () => {
  // Or every build reports more faults than it has — and since the lane
  // measurement is unconditional, EVERY build has at least one. A count that
  // inflates the moment a measurement is added is a count nobody trusts the
  // next time it moves.
  const e = BL.collect([{ source: 'gen_internal.js',
    stderr: 'measure: lanes on=true conflicts=0 flipped=3953\n'
          + 'northArrow: the configured spot is blocked — placed automatically\n'
          + 'feature: the river was not drawn\n' }]);
  assert.deepStrictEqual(e.map(x => x.severity), ['MEASURED', 'WARN', 'BLOCKING']);
  const txt = BL.format(e);
  // A blocking entry has always counted as a warning too — "2 warnings, 1
  // blocking" is the existing contract and it is not changed here. What IS new is
  // that the measurement is outside that total rather than inflating it.
  assert.match(txt, /^2 warnings, 1 blocking, and 1 measurement\./m,
    'the measurement is counted apart from the warnings, not added to them');
  assert.match(txt, /--- MEASURED \(1\) ---/);
});

test('a measurement never blocks a build', () => {
  // rollout.js stops on BLOCKING. A build that recorded a number and nothing else
  // is a clean build.
  const e = BL.collect([{ source: 'gen_internal.js', stderr: 'measure: lanes on=false conflicts=0\n', ok: true }]);
  assert.strictEqual(BL.blocking(e).length, 0);
});

test('the lane measurement carries on=, which is what makes its zero mean anything', () => {
  // With laneOrientation off, ORIENT is a stub of zeroes — so `conflicts=0` alone
  // cannot tell "computed and clean" from "never computed". That is a FALSE ZERO
  // of exactly the shape OA-126 names, and `on=` is the half most likely to be
  // dropped as noise. This asserts the format, because the format is the contract.
  const line = 'measure: lanes on=false segs=0 lateral=0 components=0 bridges=0 conflicts=0 flipped=0';
  assert.strictEqual(BL.severity(line), 'MEASURED');
  const e = BL.parse(line + '\n', 'gen_internal.js');
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].code, 'measure');
  assert.match(e[0].text, /\bon=(true|false)\b/,
    'a conflicts count with no on= flag cannot be read; see OA-126');
});

test('the old LANEFIELD wording had no colon, so it was not a message head at all', () => {
  // Had it ever reached the log, parse() would have glued it onto the end of
  // whatever message came before it. That is why the promotion re-worded it
  // rather than simply unhiding it.
  const glued = BL.parse('labeller: 2 leaders\nLANEFIELD on=true conflicts=0\n', 'x');
  assert.strictEqual(glued.length, 1, 'a headless line is swallowed by the message before it');
  const separate = BL.parse('labeller: 2 leaders\nmeasure: lanes on=true conflicts=0\n', 'x');
  assert.strictEqual(separate.length, 2);
  assert.deepStrictEqual(separate.map(x => x.severity), ['WARN', 'MEASURED']);
});
