'use strict';
// shadow_count.js (buses-data OA-485 item 3): the board's "clean on today's engine" count.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sc = require('./_engine.js').load('shadow_count.js');

const NOW = Date.UTC(2026, 8, 30, 12);
const report = (tool, maps) => {
  const counts = { total: maps.length, clean: 0, regressed: 0, unmeasured: 0 };
  for (const m of maps) counts[m.verdict]++;
  return { tool, kind: tool === 'rollout.js' ? 'town' : 'place', engine: 'aaaa111111', apply: false, counts, maps };
};
function stampTree(stamp) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowcount-'));
  fs.mkdirSync(path.join(root, 'loop'));
  if (stamp !== undefined) fs.writeFileSync(path.join(root, 'loop', 'shadow-rebuild.json'), typeof stamp === 'string' ? stamp : JSON.stringify(stamp));
  return root;
}
function goodStamp(engine = 'aaaa111111') {
  const towns = report('rollout.js', [{ name: 'March', verdict: 'clean' }, { name: 'Wisbech', verdict: 'regressed' }]);
  const places = report('rollout_places.js', [{ name: 'Ely Co-op', verdict: 'regressed' }, { name: 'Soham Co-op', verdict: 'unmeasured' }]);
  return { ranAt: '2026-09-27T12:00:00.000Z', engine, counts: { clean: 1, regressed: 2, unmeasured: 1, total: 4 }, towns, places };
}
function printed(r, engine) {
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(String(s));
  try { sc.printSection(r, engine); } finally { console.log = orig; }
  return lines.join('\n');
}

test('no stamp is "not on this machine", never a count of zero', () => {
  const root = stampTree();
  try {
    const r = sc.read(root, 'aaaa111111', NOW);
    assert.strictEqual(r.status, 'none');
    assert.match(printed(r, 'aaaa111111'), /not on this machine/);
    assert.doesNotMatch(printed(r, 'aaaa111111'), /0 of/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a stamp that is not JSON, or not a shadow-rebuild stamp, is UNREADABLE and named', () => {
  for (const bad of ['{not json', { counts: { clean: 1 } }, { ...goodStamp(), places: undefined }, { ...goodStamp(), counts: { clean: '1', regressed: 0, unmeasured: 0, total: 1 } }]) {
    const root = stampTree(bad);
    try {
      const r = sc.read(root, 'aaaa111111', NOW);
      assert.strictEqual(r.status, 'UNREADABLE', JSON.stringify(bad).slice(0, 60));
      assert.match(printed(r, 'aaaa111111'), /UNREADABLE/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('a stamp on today\'s engine prints the count, its age and every regressed map', () => {
  const root = stampTree(goodStamp());
  try {
    const r = sc.read(root, 'aaaa111111', NOW);
    assert.strictEqual(r.status, 'read');
    assert.strictEqual(r.onTodaysEngine, true);
    assert.strictEqual(r.ageDays, 3);
    assert.deepStrictEqual(r.counts, { clean: 1, regressed: 2, unmeasured: 1, total: 4 });
    assert.deepStrictEqual(r.regressed, ['Wisbech', 'Ely Co-op']);
    const out = printed(r, 'aaaa111111');
    assert.match(out, /1 of 4 maps clean, 2 regressed, 1 unmeasured — shadow rebuild of 2026-09-27, 3d ago/);
    assert.match(out, /regressed \(look, not fix\): Wisbech, Ely Co-op/);
    assert.doesNotMatch(out, /NOT today's/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a stamp from an older engine says so rather than passing as today\'s count', () => {
  const root = stampTree(goodStamp('bbbb222222'));
  try {
    const r = sc.read(root, 'aaaa111111', NOW);
    assert.strictEqual(r.onTodaysEngine, false);
    assert.match(printed(r, 'aaaa111111'), /on engine bbbb222222, which is NOT today's aaaa111111/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the stamp shadow_rebuild.mjs writes is the one this reads', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bus-work', 'assets', 'shadow_rebuild.mjs'), 'utf8');
  assert.match(src, /const STAMP_NAME = 'shadow-rebuild\.json'/);
  assert.match(src, /path\.join\(buses, 'loop'\)/);
  assert.strictEqual(sc.STAMP, path.join('loop', 'shadow-rebuild.json'));
});
