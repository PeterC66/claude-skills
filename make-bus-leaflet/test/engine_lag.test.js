'use strict';
// engine_lag.js (buses-data OA-485 item 3): how long a map has been drawn by an engine that is not today's.
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

test('a map with no engineCommit, or one this clone lacks, is unknown and never counted inside the ceiling', () => {
  const r = repo();
  try {
    r.commit('gen.js', 'a', 100);
    const m = lag.measure([{ name: 'A', engineCommit: null }, { name: 'B', engineCommit: 'f'.repeat(40) }], { skillsRoot: r.root, files: r.files, nowMs: NOW });
    assert.deepStrictEqual(m.rows.map((x) => x.days), [null, null]);
    assert.strictEqual(m.unknown.length, 2);
    assert.strictEqual(m.measured, 0);
    assert.match(lag.lines(m).join('\n'), /lag unknown for 2/);
  } finally { clean(r.root); }
});

test('lag counts from the first engine change AFTER the map\'s commit, not from the build and not from non-engine commits', () => {
  const r = repo();
  try {
    const built = r.commit('gen.js', 'v1', 200);        // the map was drawn here
    r.commit('README.md', 'docs', 150);                 // draws no ink: not a lag
    r.commit('gen.js', 'v2', 70);                       // the engine moved 70 days ago
    r.commit('gen.js', 'v3', 5);
    const m = lag.measure([{ name: 'A', engineCommit: built }], { skillsRoot: r.root, files: r.files, nowMs: NOW });
    assert.strictEqual(m.rows[0].days, 70);
    assert.strictEqual(m.rows[0].since, daysAgo(70).slice(0, 10));
  } finally { clean(r.root); }
});

test('a map drawn by the newest engine, or behind only over non-engine commits, is 0 days', () => {
  const r = repo();
  try {
    const built = r.commit('gen.js', 'v1', 200);
    r.commit('README.md', 'docs', 150);
    const m = lag.measure([{ name: 'A', engineCommit: built }], { skillsRoot: r.root, files: r.files, nowMs: NOW });
    assert.strictEqual(m.rows[0].days, 0);
    assert.deepStrictEqual(m.over, []);
  } finally { clean(r.root); }
});

test('the ceiling is strict: exactly 60 days is inside, 61 is over, and over is listed worst first', () => {
  const r = repo();
  try {
    const built = r.commit('gen.js', 'v1', 300);
    r.commit('gen.js', 'v2', 60);                        // lag for a map built at v1 starts here
    const m = lag.measure([{ name: 'A', engineCommit: built }], { skillsRoot: r.root, files: r.files, nowMs: NOW });
    assert.strictEqual(m.rows[0].days, 60);
    assert.deepStrictEqual(m.over, [], 'exactly the ceiling is not over');
    const later = lag.measure([{ name: 'A', engineCommit: built }, { name: 'B', engineCommit: built }], { skillsRoot: r.root, files: r.files, nowMs: NOW + 86400000 });
    assert.deepStrictEqual(later.over.map((x) => x.name), ['A', 'B'], 'one day later both are');
    assert.match(lag.lines(later).join('\n'), /2 of 2 maps are past the 60-day engine-lag ceiling.*A 61d/);
  } finally { clean(r.root); }
});

test('a place counts a change to a place-only file; a town does not', () => {
  const r = repo();
  try {
    r.commit('gen.js', 'v1', 200);
    const built = r.commit('gen_place.js', 'p1', 190);
    r.commit('gen_place.js', 'p2', 90);
    const maps = [{ name: 'T', engineCommit: built, place: false }, { name: 'P', engineCommit: built, place: true }];
    const m = lag.measure(maps, { skillsRoot: r.root, files: r.files, nowMs: NOW });
    assert.deepStrictEqual(m.rows.map((x) => x.days), [0, 90]);
    assert.deepStrictEqual(m.over.map((x) => x.name), ['P']);
  } finally { clean(r.root); }
});

test('REGRESSION: the real closures are absolute paths that exist (relative names matched nothing and read as "current")', () => {
  const c = lag.engineClosures();
  for (const kind of ['town', 'place']) {
    assert.ok(c[kind].length > 20, kind + ' closure is not empty');
    for (const f of c[kind]) { assert.ok(path.isAbsolute(f), f + ' is absolute'); assert.ok(fs.existsSync(f), f + ' exists'); }
  }
  assert.ok(c.place.some((f) => path.basename(f) === 'gen_external_places.js'), 'a place is drawn by its place-local generator');
  assert.ok(c.town.every((f) => c.place.includes(f)), 'a place is drawn by the whole town closure too');
});

test('ONE CEILING: the board and loop_health read the constant from engine_lag.js and restate no number', () => {
  assert.strictEqual(lag.CEILING_DAYS, 60);
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
  for (const [file, src] of [['status.js', read('make-bus-leaflet', 'assets', 'status.js')], ['loop_health.mjs', read('bus-work', 'assets', 'loop_health.mjs')]]) {
    assert.doesNotMatch(src, /\b60-day\b|CEILING_DAYS\s*=|ceiling\s*=\s*60/i, file + ' must not restate the ceiling');
  }
  assert.match(read('bus-work', 'assets', 'loop_health.mjs'), /el\.ceiling/, 'loop_health reads the ceiling from the probe output');
  assert.match(read('make-bus-leaflet', 'assets', 'status.js'), /engine_lag/);
});
