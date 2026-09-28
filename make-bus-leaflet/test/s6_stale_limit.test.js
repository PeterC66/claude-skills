/*
 * s6_stale_limit.test.js — the board's fourteen-day limit on a PUBLISHED map's
 * stale S6 (buses-data OA-484 item 2). judge() is pure, so every case feeds it
 * rows in the shape status.js builds and a published list in the shape
 * /api/public/maps returns, and needs no estate and no network.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('./_engine.js').load('s6_stale_limit.js');

const PUB = [{ name: 'St Ives', slug: 'st-ives' }, { name: 'High Wycombe Aldi', slug: 'highwycombe-aldi' }];
const town = (o) => ({ name: 'St Ives', s6: '2026-09-12_0119', s6Stale: true, s6StaleSince: '2026-09-27', ...o });

test('staleSince is the day of the FIRST S1/S2/S3 run after the report, not the newest', () => {
  const m = { stages: {
    S1: { runs: [{ at: '2026-09-11T04:59' }] },
    S2: { runs: [{ at: '2026-09-20T10:00' }] },
    S3: { runs: [{ at: '2026-09-10T16:53' }, { at: '2026-09-27T00:18' }] },
  } };
  assert.strictEqual(L.staleSince(m, '2026-09-12T00:20'), '2026-09-20');
  assert.strictEqual(L.staleSince(m, '2026-09-28T00:00'), null);
});

test('CONTROL: a published stale S6 inside its limit is listed and not red', () => {
  const v = L.judge({ towns: [town()], published: PUB, today: '2026-10-13' });
  assert.strictEqual(v.checked, true);
  assert.deepStrictEqual(v.rows.map(r => [r.map, r.due, r.overdue]), [['St Ives', '2026-10-13', false]]);
  assert.strictEqual(L.isRed(v), false);
});

test('a published stale S6 past its limit is RED', () => {
  const v = L.judge({ towns: [town()], published: PUB, today: '2026-10-14' });
  assert.strictEqual(L.isRed(v), true);
  assert.deepStrictEqual(v.overdue.map(r => r.map), ['St Ives']);
});

test('the clock starts no earlier than the day the limit landed', () => {
  const v = L.judge({ towns: [town({ s6StaleSince: '2026-09-01' })], published: PUB, today: '2026-10-13' });
  assert.strictEqual(v.rows[0].due, '2026-10-13');
  assert.strictEqual(L.isRed(v), false);
});

test('an UNPUBLISHED map past the limit stays a chore', () => {
  const v = L.judge({ towns: [town({ name: 'Chatteris' })], published: PUB, today: '2027-01-01' });
  assert.strictEqual(v.rows.length, 0);
  assert.strictEqual(L.isRed(v), false);
});

test('a place is matched by its public slug when the name differs', () => {
  const place = { name: 'High Wycombe Aldi', s6: 'x', s6Stale: true, s6StaleSince: '2026-09-29' };
  const v = L.judge({ places: [place], published: [{ name: 'Aldi, High Wycombe', slug: 'high-wycombe-aldi' }], today: '2026-10-20' });
  assert.strictEqual(L.isRed(v), true);
});

test('NOT MEASURED (no published list) is never red, and says why', () => {
  const v = L.judge({ towns: [town()], published: null, why: '--no-live', today: '2027-01-01' });
  assert.strictEqual(v.checked, false);
  assert.strictEqual(L.isRed(v), false);
  const out = [];
  L.printSection(v, [town()], [], (s) => out.push(s));
  assert.ok(out.some(s => /S6 LIMIT NOT MEASURED .*--no-live/.test(s)), out.join('\n'));
});

test('measure() with noLive fetches nothing and is not measured', async () => {
  const v = await L.measure({ towns: [town()], places: [], liveUrl: 'http://127.0.0.1:9', noLive: true, today: '2027-01-01' });
  assert.strictEqual(v.checked, false);
});

test('printSection names an overdue map on a RED line', () => {
  const v = L.judge({ towns: [town()], published: PUB, today: '2026-10-14' });
  const out = [];
  L.printSection(v, [town()], [], (s) => out.push(s));
  assert.ok(out.some(s => s.startsWith('  RED S6 St Ives: published')), out.join('\n'));
});
