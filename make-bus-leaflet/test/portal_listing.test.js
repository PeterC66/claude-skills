'use strict';
// portal_listing.js (buses-data OA-607): is a map on the portal? Three answers, never two.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const pl = require('./_engine.js').load('portal_listing.js');

const LISTING = { listed: [{ name: 'St Ives', slug: 'st-ives' }, { name: 'Aldi, High Wycombe', slug: 'high-wycombe-aldi' }], why: null };

test('isListed: true by name, true by the slug the name makes, false when absent', () => {
  assert.strictEqual(pl.isListed(LISTING, 'St Ives'), true);
  assert.strictEqual(pl.isListed(LISTING, 'High Wycombe Aldi'), true, 'matched by slug when the public name differs');
  assert.strictEqual(pl.isListed(LISTING, 'Soham'), false);
});

test('isListed: a list nobody read is null, never false', () => {
  assert.strictEqual(pl.isListed(null, 'Soham'), null);
  assert.strictEqual(pl.isListed({ listed: null, why: '--no-live' }, 'Soham'), null);
});

test('split: an unlisted map is off; a list nobody read keeps every row on, and says why', () => {
  const rows = [{ name: 'St Ives' }, { name: 'Soham' }];
  const s = pl.split(rows, LISTING);
  assert.deepStrictEqual([s.on.map((r) => r.name), s.off.map((r) => r.name), s.measured], [['St Ives'], ['Soham'], true]);
  const u = pl.split(rows, { listed: null, why: 'could not reach x' });
  assert.deepStrictEqual([u.on.length, u.off.length, u.measured, u.why], [2, 0, false, 'could not reach x']);
});

test('read: --no-live asks nothing; an unreachable site and a non-200 answer are not a list', async () => {
  assert.deepStrictEqual(await pl.read({ noLive: true }), { listed: null, why: '--no-live' });
  const down = await pl.read({ liveUrl: 'http://127.0.0.1:9', timeoutMs: 2000 });
  assert.strictEqual(down.listed, null);
  assert.match(down.why, /could not reach/);
  let status = 500;
  const srv = http.createServer((req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: status === 200, maps: [{ name: 'March', slug: 'march' }] })); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = 'http://127.0.0.1:' + srv.address().port + '/';
    const err = await pl.read({ liveUrl: url });
    assert.strictEqual(err.listed, null, 'a 500 carrying a list is still not the answer');
    status = 200;
    assert.deepStrictEqual((await pl.read({ liveUrl: url })).listed, [{ name: 'March', slug: 'march' }]);
  } finally { srv.close(); }
});
