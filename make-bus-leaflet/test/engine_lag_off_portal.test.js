'use strict';
// engine_lag.js and buses-data OA-607: a map off the portal is held to no ceiling, and a list nobody read drops nobody.
// A file of its own because prove-red.js runs a mutant's suite against a SCRATCH copy of assets/, where
// engine_lag.test.js's real-closure case cannot find make-place-bus-leaflet; every case here builds its own repository.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lag = require('./_engine.js').load('engine_lag.js');

const NOW = Date.UTC(2026, 9, 4, 12);
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

function git(root, args, date) {
  const env = { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) };
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}
/** A scratch repository with an engine file and a non-engine file; returns the root and a committer. */
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginelag-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@example.com']); git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  const commit = (file, text, daysBack) => {
    fs.writeFileSync(path.join(root, file), text);
    git(root, ['add', file]);
    git(root, ['commit', '-q', '-m', file + ' ' + text], daysAgo(daysBack));
    return git(root, ['rev-parse', 'HEAD']);
  };
  return { root, commit, files: { town: [path.join(root, 'gen.js')], place: [path.join(root, 'gen.js'), path.join(root, 'gen_place.js')] } };
}
const clean = (root) => fs.rmSync(root, { recursive: true, force: true });

test('a map off the portal is held to no ceiling and named; a list nobody read holds every map to it', () => {
  const r = repo();
  try {
    const built = r.commit('gen.js', 'v1', 300);
    r.commit('gen.js', 'v2', 70);
    const maps = [{ name: 'On', engineCommit: built }, { name: 'Off', engineCommit: built }];
    const m = lag.measure(maps, { skillsRoot: r.root, files: r.files, nowMs: NOW, listing: { listed: [{ name: 'On', slug: 'on' }], why: null } });
    assert.deepStrictEqual(m.over.map((x) => x.name), ['On']);
    assert.deepStrictEqual(m.offPortal.map((x) => x.name), ['Off']);
    assert.ok(lag.lines(m).some((l) => /1 off the portal, so held to no ceiling.*Off 70d/.test(l)), lag.lines(m).join(' | '));
    const unread = lag.measure(maps, { skillsRoot: r.root, files: r.files, nowMs: NOW, listing: { listed: null, why: '--no-live' } });
    assert.deepStrictEqual(unread.over.map((x) => x.name), ['On', 'Off'], 'a list nobody read drops nobody');
    assert.deepStrictEqual(unread.offPortal, []);
    assert.ok(lag.lines(unread).some((l) => l.includes('portal listing not read (--no-live)')), lag.lines(unread).join(' | '));
  } finally { clean(r.root); }
});

test('with no listing at all the answer is what it was before OA-607', () => {
  const r = repo();
  try {
    const built = r.commit('gen.js', 'v1', 300);
    r.commit('gen.js', 'v2', 70);
    const m = lag.measure([{ name: 'A', engineCommit: built }], { skillsRoot: r.root, files: r.files, nowMs: NOW });
    assert.deepStrictEqual([m.over.map((x) => x.name), m.offPortal, m.listing], [['A'], [], null]);
  } finally { clean(r.root); }
});
