/*
 * cli.test.js — the shared argument parser, estate resolver and JSON reader.
 *
 * OA-224 Tier 3.1. Nine scripts each carried their own `parseArgs` and each
 * ended `path.resolve(args.buses || 'C:/u3a St Ives/Using AI/Buses')`. What is
 * worth testing here is not that a parser parses — it is the three things that
 * were wrong before there was one of it:
 *
 *   1. The RESOLUTION ORDER. Flag, then BUSES_DIR, then the laptop. Before this,
 *      the environment variable did not exist for the engine at all: `bus-work`
 *      had the convention and nothing else adopted it, so a machine that is not
 *      this laptop could not run any of them.
 *   2. The CORNER every copy shared. A flag whose next argument is missing,
 *      empty, or itself a flag takes the value `true`. That is what makes
 *      `--apply` work with no special case, and a rewrite that "tidied" it would
 *      silently change nine callers at once.
 *   3. That `cli.js` stays OUT of the engine hash closure. It is required by
 *      tools, never by a generator; the day a generator reaches for it, every map
 *      in the estate goes STALE for a change that moved no ink. Nothing but a
 *      test can hold that line, because the cost does not appear until a rollout.
 *
 * The last one is asserted twice over — once against the closure, once as a
 * source-level check that the five entry points name no parser.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR, load } = require('./_engine');

const cli = load('cli.js');
const { parseArgs, readJson, resolveBuses, resolvePortal, LAPTOP_BUSES, LAPTOP_PORTAL } = cli;

/* Every script the Tier 3.1 migration moved onto cli.js, and the flags each one
 * declared as repeatable. A file that drops off this list without dropping its
 * `require('./cli')` is fine; one that grows a second parser is what the
 * source-level test below is for. */
const MIGRATED_JS = {
  'adopt_config.js': ['town', 'place', 'unset', 'feature-pos', 'set-path'],
  'pick_route_colour.js': [],
  'preview_design.js': ['town', 'unset', 'feature-pos', 'set-path'],
  'rollout.js': ['town'],
  'rollout_places.js': ['place'],
  'status.js': [],
  'stray_outputs.js': [],
  'sync_ci_reference.js': [],
};

const MIGRATED_PY = ['auto_refresh_month.py', 'draft_town.py', 'gtfs_refresh_report.py',
  'gtfs_upcoming.py', 'prune_runs.py', 'scaffold_town.py'];

test('parseArgs: a flag takes the next argument as its value', () => {
  const a = parseArgs(['--town', 'St Ives', '--buses', 'D:/estate']);
  assert.strictEqual(a.town, 'St Ives');
  assert.strictEqual(a.buses, 'D:/estate');
});

test('parseArgs: a flag with nothing after it is true, and so is one followed by another flag', () => {
  assert.strictEqual(parseArgs(['--apply']).apply, true);
  assert.strictEqual(parseArgs(['--apply', '--force']).apply, true);
  assert.strictEqual(parseArgs(['--apply', '--force']).force, true);
  // The corner all nine copies shared: an EMPTY value is falsy and becomes true.
  // Preserved deliberately — see the header.
  assert.strictEqual(parseArgs(['--note', '']).note, true);
});

test('parseArgs: a repeat flag accumulates, and is an empty array when unused', () => {
  const a = parseArgs(['--town', 'A', '--town', 'B', '--apply'], { repeat: ['town', 'place'] });
  assert.deepStrictEqual(a.town, ['A', 'B']);
  assert.deepStrictEqual(a.place, []);
  assert.strictEqual(a.apply, true);
});

test('parseArgs: a repeat flag takes the next argument unconditionally', () => {
  // `--town --apply` is a typo, not a boolean town. The four owners all did this
  // and a value-guard here would turn the typo into a silently empty run.
  assert.deepStrictEqual(parseArgs(['--town', '--apply'], { repeat: ['town'] }).town, ['--apply']);
});

test('parseArgs: anything that is not a flag is positional', () => {
  // 'two' after --apply is that flag's VALUE, not a positional — which is the
  // rule, and worth pinning so a future "tidy" cannot quietly change it.
  assert.deepStrictEqual(parseArgs(['one', 'two', '--apply'])._, ['one', 'two']);
  assert.deepStrictEqual(parseArgs(['one', '--apply', 'two'])._, ['one']);
});

test('resolveBuses: the flag beats the environment, which beats the laptop', () => {
  assert.strictEqual(resolveBuses({ buses: 'E:/flag' }, { BUSES_DIR: 'D:/env' }), path.resolve('E:/flag'));
  assert.strictEqual(resolveBuses({}, { BUSES_DIR: 'D:/env' }), path.resolve('D:/env'));
  assert.strictEqual(resolveBuses({}, {}), path.resolve(LAPTOP_BUSES));
});

test('resolvePortal: the same order, its own names', () => {
  assert.strictEqual(resolvePortal({ portal: 'E:/flag' }, { BUSMAPS_PORTAL: 'D:/env' }), path.resolve('E:/flag'));
  assert.strictEqual(resolvePortal({}, { BUSMAPS_PORTAL: 'D:/env' }), path.resolve('D:/env'));
  assert.strictEqual(resolvePortal({}, {}), path.resolve(LAPTOP_PORTAL));
});

test('resolveBuses: --buses with no path is a usage error, exit 2 on stderr', () => {
  // Spawned rather than called, because the answer IS the exit code. Before the
  // shared resolver this was `path.resolve(true)`, a TypeError and a stack.
  const r = spawnSync(process.execPath, ['-e',
    `require(${JSON.stringify(path.join(ENGINE_DIR, 'cli.js'))}).resolveBuses({ buses: true }, {})`],
    { encoding: 'utf8' });
  assert.strictEqual(r.status, 2, 'a missing value must exit 2 (usage), not 1 (failed)');
  assert.match(r.stderr, /--buses needs a path/);
  assert.strictEqual(r.stdout, '', 'stdout carries the answer; a refusal is not one');
});

test('readJson: it names the file it could not read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
  const bad = path.join(dir, 'broken.json');
  fs.writeFileSync(bad, '{ "a": }');
  assert.throws(() => readJson(bad), /broken\.json is not valid JSON/);
  assert.throws(() => readJson(path.join(dir, 'nope.json')), /nope\.json/);
  // A fallback covers an ABSENT file and nothing else — a fallback that also
  // swallowed a syntax error would hide a corrupt config behind a default.
  assert.deepStrictEqual(readJson(path.join(dir, 'nope.json'), { d: 1 }), { d: 1 });
  assert.throws(() => readJson(bad, { d: 1 }), /not valid JSON/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate_lib.readJson IS cli.readJson — one implementation, not two', () => {
  assert.strictEqual(load('gate_lib.js').readJson, readJson);
});

test('cli.js is outside the engine hash closure', () => {
  // THE LINE THIS TEST HOLDS. engine_version.js hashes the five entry points and
  // everything they require, transitively. A generator that reached for the
  // parser would put all twenty maps STALE for a change that moved no ink, and
  // nothing would say so until the next rollout.
  const { engineFiles, placeEngineFiles } = load('engine_version.js');
  assert.ok(!engineFiles().includes('cli.js'), 'a town entry point now requires cli.js — pass the value in instead');
  assert.ok(!placeEngineFiles().includes('cli.js'), 'a place entry point now requires cli.js');
});

test('the migrated scripts have no parser of their own left', () => {
  for (const [name, repeat] of Object.entries(MIGRATED_JS)) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, name), 'utf8');
    assert.ok(/require\('\.\/cli'\)/.test(src), `${name} does not require ./cli`);
    assert.ok(!/function parseArgs\s*\(/.test(src), `${name} has grown its own parseArgs back`);
    // In CODE. A usage comment may still show the laptop path as an example;
    // what must not survive is a line that RESOLVES to it without asking cli.js.
    const code = src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!code.includes(LAPTOP_BUSES), `${name} still names the laptop in code`);
    if (repeat.length) {
      // The repeat list is an interface: dropping a name here turns `--town A
      // --town B` from two towns into one, silently, on a script that rolls out.
      for (const flag of repeat) {
        assert.ok(new RegExp(`repeat:[^\\]]*'${flag}'`).test(src), `${name} lost its --${flag} repeat`);
      }
    }
  }
});

test('the migrated python scripts resolve through cli.py', () => {
  for (const name of MIGRATED_PY) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, name), 'utf8');
    assert.ok(/^import cli\b/m.test(src), `${name} does not import cli`);
    assert.ok(!/default\s*=\s*r"C:\\u3a/.test(src), `${name} still defaults to the laptop in argparse`);
    assert.ok(/cli\.resolve_buses\(/.test(src), `${name} does not call cli.resolve_buses`);
  }
});
