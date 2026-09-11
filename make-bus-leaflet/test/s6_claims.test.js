/*
 * s6_claims.js — the status board's S6-claims section. Until 2026-09-10 nothing
 * in this folder read it at all, and the board carried a plain arithmetic lie for
 * as long as SF-015 sat in the register:
 *
 *     register: 15 fact(s), 6 queued, 9 decided
 *     queued: SF-008, SF-011, SF-014, SF-012, SF-013 — questions written down...
 *
 * Six, and five names. The count read `register.queued` — QUEUED REGISTER ENTRIES —
 * and the list read `verdict.queued`, which is a list of CLAIMS an S6 report made
 * that a queued entry happens to answer. Two populations, one sentence. The entry
 * that fell between them was the one nobody would ever be reminded of: OA-004
 * decision 4 makes a fact estate-wide, so a question can be queued about a town
 * whose sheet no red team has read, and no future report will re-raise it.
 *
 * So the assertion that matters here is THE JOIN — the number the `register:` line
 * counts is the number of ids the `queued:` line names — and not any one line's
 * wording. The checker's own half of this is falsified in
 * tools/prove-red-s6-claims.mjs; this file is the BOARD's half, which is where the
 * disagreement was actually visible to a reader.
 *
 * These tests feed printSection a verdict object directly rather than running the
 * checker: the shape of that object is check-s6-claims.mjs's --json contract, and
 * driving it here keeps the board's arithmetic testable on a machine with no
 * estate on it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S6 = require('./_engine.js').load('s6_claims.js');

/* A verdict in the shape check-s6-claims.mjs --json emits. `queuedFacts` is the
 * register's own list; `queued` is the claims list, kept deliberately SHORTER in
 * most fixtures below because that difference is the whole subject. */
function verdict({ queuedFacts = [], queued = [], facts = 0, decided = 0, register = {} } = {}) {
  return {
    reports: 1, claims: queued.length, coveredBy: { 'register-queued': queued.length },
    mapsWithoutReport: [], uncovered: [], queued,
    register: {
      present: true, facts, queued: queuedFacts.length, decided,
      queuedFacts, findings: [], silences: [], owed: [], ...register,
    },
    red: false,
  };
}

const lines = (v) => { const out = []; S6.printSection({ verdict: v, error: null }, (s) => out.push(s)); return out; };
const find = (out, re) => out.find((l) => re.test(l)) || '';

/* The SF-015 shape, reduced: two queued register entries, and only one of them is
 * reached by a claim on any S6 report. */
const SF015 = verdict({
  facts: 3, decided: 1,
  queuedFacts: [
    { id: 'SF-014', route: '61', scope: ['St Neots Tesco Extra'], question: 'is 61 drawn?', claimed: true, maps: ['St Neots Tesco Extra'] },
    { id: 'SF-015', route: 'TIGER', scope: ['March'], question: 'does the Fenland zone cover March?', claimed: false, maps: [] },
  ],
  queued: [{ map: 'St Neots Tesco Extra', route: '61', id: 'SF-014' }],
});

test('THE JOIN: the count on the register line equals the number of ids the queued line names', () => {
  const out = lines(SF015);
  const counted = Number(/(\d+) queued/.exec(find(out, /^ {2}register:/))[1]);
  const named = find(out, /^ {2}queued:/).replace(/^ {2}queued: /, '').split(' — ')[0].split(', ');
  assert.strictEqual(counted, 2);
  assert.strictEqual(named.length, counted, `register line says ${counted}, queued line names ${named.length}: ${named.join(', ')}`);
});

test('the entry no report raises is NAMED, not merely counted', () => {
  assert.match(find(lines(SF015), /^ {2}queued:/), /SF-015/);
});

test('...and it is called out separately, because nothing else will ever raise it again', () => {
  const l = find(lines(SF015), /raised by no S6 report/);
  assert.match(l, /SF-015/);
  assert.doesNotMatch(l, /SF-014/);
});

test('CONTROL: an entry a claim DOES reach is in the list and NOT in the unraised line', () => {
  const out = lines(SF015);
  assert.match(find(out, /^ {2}queued:/), /SF-014/);
  assert.doesNotMatch(find(out, /raised by no S6 report/), /SF-014/);
});

test('CONTROL: claimed:null is "not looked at", not "nobody raised it" — no unraised line at all', () => {
  // --register-only, and every CI run: the coverage half does not run, so the
  // claims list is empty by construction. Reading that emptiness as evidence would
  // report every queued entry as raised by nobody — a negative from a search that
  // was never shown capable of finding anything.
  const out = lines(verdict({
    facts: 2, decided: 0,
    queuedFacts: [
      { id: 'SF-014', route: '61', scope: ['St Neots Tesco Extra'], question: 'q', claimed: null, maps: [] },
      { id: 'SF-015', route: 'TIGER', scope: ['March'], question: 'q', claimed: null, maps: [] },
    ],
    queued: [],
  }));
  assert.match(find(out, /^ {2}queued:/), /SF-014, SF-015/);
  assert.strictEqual(find(out, /raised by no S6 report/), '');
});

test('CONTROL: a register with nothing queued prints no queued line, rather than an empty one', () => {
  const out = lines(verdict({ facts: 2, decided: 2, queuedFacts: [], queued: [] }));
  assert.strictEqual(find(out, /^ {2}queued:/), '');
  assert.strictEqual(find(out, /raised by no S6 report/), '');
  assert.match(find(out, /^ {2}register:/), /0 queued/);
});

test('CONTROL: a queued entry with no claims list at all is still named — the board never depends on the coverage half having run', () => {
  const out = lines(verdict({
    facts: 1, queuedFacts: [{ id: 'SF-008', route: 'TOWN BUS', scope: ['Beaconsfield'], question: 'q', claimed: false, maps: [] }],
    queued: [],
  }));
  assert.match(find(out, /^ {2}queued:/), /SF-008/);
});
