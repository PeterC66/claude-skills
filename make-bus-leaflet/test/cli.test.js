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
  // Not a migration -- new on 2026-09-04 (buses-data OA-240), written onto the
  // shared parser from the start. It is here for its REPEAT flags: --town and
  // --place are how a sweep is narrowed to one map, and losing either turns
  // `--town A --town B` from two maps into one, silently.
  'schematic_crossings.js': ['town', 'place'],
  'status.js': [],
  'stray_outputs.js': [],
  'sync_ci_reference.js': [],
};

// auto_refresh_month.py left this list on 2026-09-18 with the file (buses-data
// OA-091): the monthly auto-applier was retired and its grading moved into
// gtfs_refresh_report.py, which is already here.
const MIGRATED_PY = ['draft_town.py', 'gtfs_refresh_report.py',
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

/*
 * THE CENSUS (OA-232 Tier 2.5, from the review's engine-pipeline M6 and N26).
 *
 * The test above asks whether the NAMED files still use the parser. That is a
 * list, and a list only ever certifies what is on it: on 2026-09-03 the review
 * found six more `argv.indexOf('--x')` bodies under assets/, none of them on it,
 * one of them written the day after cli.js landed. This asks the closed question
 * instead -- does ANY file under assets/ still open-code the idiom -- which is
 * the difference between a helper that exists and a helper that is used.
 *
 * It is the same shape as `engine_indirection.test.js` and as the census in the
 * portal's `test-db-dates.mjs`, and it is the review's own conclusion in one
 * sentence: the unit of an extraction is not the module, it is the module plus
 * the check on its callers.
 *
 * SCOPED TO assets/, not to tools/. The harnesses under tools/ still carry the
 * idiom and are deliberately outside this: several of them build a scratch argv
 * to feed a subject, and one -- render_sweep.js's sibling reasoning -- keeps its
 * own parser because it WHITELISTS its flags and refusing an unknown one is a
 * property worth having. Widening this to tools/ is a separate decision with its
 * own allowlist, not a free tightening.
 */
/*
 * THE CENSUS MATCHED NOTHING IN ITS OWN POPULATION FOR ELEVEN DAYS (the
 * 2026-09-14 review's R1 N31/N32, fixed here as its Tier 1.3).
 *
 * The pattern was `/argv\.indexOf\('--/` -- the idiom spelled with a LITERAL
 * flag. Measured on 2026-09-14: it matched ZERO of the 80 `.js` files under
 * assets/, while three of them open-coded a parser by other spellings. The case
 * below had never been capable of failing where it looked, and it read as a clean
 * bill of health over a folder with offenders in it.
 *
 * ITS CONTROL IS WHAT LET THAT STAND, and the shape is worth more than the fix.
 * The old control pointed at `tools/attribution-gate.js` -- a file in a DIFFERENT
 * FOLDER from the one the census walks. So it proved the regex matched something
 * SOMEWHERE, which was true, and never that it could catch an offender WHERE IT
 * LOOKS, which was false. A control outside the population cannot distinguish "no
 * offenders" from "no matches", and those are the two answers the whole test
 * exists to tell apart. This is the estate's named failure shape *the subject you
 * named yourself*, with the population rather than the identifier as the subject.
 *
 * SO THE CONTROL IS NOW THE ALLOWLIST, and it lives inside the population. Every
 * file in OPEN_CODED must still MATCH an idiom. That single assertion does three
 * jobs at once: it proves each pattern fires on a real file in the real folder;
 * it refuses to let an entry go stale, because migrating a file to cli.js without
 * dropping its entry turns the control red; and it makes the allowlist reviewable
 * as the list of exceptions it is, rather than as a regex nobody re-reads.
 *
 * THE PATTERNS ARE THE IDIOM, NOT ONE SPELLING OF IT. `argv.indexOf(` with any
 * argument -- the flag is routinely a parameter, which is exactly how
 * gen_boarding.js and refresh_area_fixture.js escaped -- and a locally DEFINED
 * parseArgs, which is how render_sweep.js did. Destructuring the shared one
 * (`const { parseArgs } = require('./cli')`) is not a definition and does not
 * match; that is asserted below rather than assumed.
 *
 * STILL SCOPED TO assets/, not to tools/, for the reason the original gave: the
 * harnesses under tools/ build scratch argv to feed a subject. Widening to tools/
 * is a separate decision with its own allowlist, not a free tightening.
 */
const IDIOMS = {
  'argv.indexOf(': /\bargv\.indexOf\s*\(/,
  'a locally defined parseArgs': /function\s+parseArgs\s*\(|const\s+parseArgs\s*=[^=]/,
};

/*
 * The exceptions, each with the reason it is one. An entry here is a claim that
 * the file still carries an idiom -- the control below enforces that -- so this
 * list cannot quietly outlive the thing it excuses.
 */
const OPEN_CODED = {
  'cli.js': 'IS the shared parser. Its own definition of parseArgs is the thing every other file is asked to require.',
  'gen_boarding.js':
    'In the PLACE engine-hash closure (engine_version.js, BOARDING_ENGINE_FILES). Its two-line `val()` reader at :57 is four lines of code, and replacing it with a require would move the place hash and re-stamp every place map for a change that moves no ink. Migrate it inside a change that is already moving that hash.',
  'refresh_area_fixture.js':
    'Not named by the 2026-09-14 review, which measured only that the OLD regex matched nothing and did not enumerate what a correct one would catch. Found by this fix. Outside the hash closure, so it is a free migration whenever somebody wants it — it is here to keep this gate green on the day it landed, not because it deserves an exemption.',
  'render_sweep.js':
    'Keeps its own parser deliberately: it WHITELISTS its flags in an if/else chain, so an unknown flag is refused rather than silently collected. cli.js accepts any flag by design. Refusing a typo on a sweep that renders the estate is a property worth having.',
};

test('no file under assets/ open-codes the argv parser', () => {
  const files = fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js'));
  // The population check. Without it this passes for a readdir that found
  // nothing, which is what an untested census looks like.
  assert.ok(files.length > 50, `the census read only ${files.length} files under assets/`);
  const offenders = files.filter((f) => {
    if (OPEN_CODED[f]) return false;
    const src = fs.readFileSync(path.join(ENGINE_DIR, f), 'utf8');
    return Object.values(IDIOMS).some((re) => re.test(src));
  });
  assert.deepStrictEqual(offenders, [],
    `these open-code the flag parser instead of requiring ./cli.js: ${offenders.join(', ')}\n` +
    'Migrate them, or add an entry to OPEN_CODED saying why not.');
});

test('CONTROL: every allowlisted file still matches an idiom, inside the population', () => {
  /*
   * THIS IS THE CASE THE OLD ONE SHOULD HAVE BEEN. It reads the same folder the
   * census reads, so a pattern that matches nothing there fails HERE rather than
   * passing there. `tools/prove-red.js` runs this suite against a scratch COPY of
   * assets/, and every file named below is inside that copy — the old control
   * read ENOENT under prove-red for exactly the reason it was wrong, because it
   * reached outside assets/ for its subject.
   */
  for (const [name, why] of Object.entries(OPEN_CODED)) {
    const p = path.join(ENGINE_DIR, name);
    assert.ok(fs.existsSync(p), `OPEN_CODED names ${name}, which is not in assets/ — delete the entry`);
    const src = fs.readFileSync(p, 'utf8');
    const hit = Object.entries(IDIOMS).filter(([, re]) => re.test(src)).map(([label]) => label);
    assert.ok(hit.length > 0,
      `${name} no longer carries any open-coded parser — delete its OPEN_CODED entry, ` +
      'and check the remaining entries still cover every pattern.');
    assert.ok(why && why.length > 40, `${name}'s OPEN_CODED reason is too thin to review`);
  }
  // Each pattern must be exercised by at least one live file, or it is a pattern
  // nobody has seen fire. This is what the old control was reaching for.
  for (const [label, re] of Object.entries(IDIOMS)) {
    const fired = Object.keys(OPEN_CODED).some((n) => re.test(fs.readFileSync(path.join(ENGINE_DIR, n), 'utf8')));
    assert.ok(fired, `no file in assets/ exercises the "${label}" pattern — it has never been seen to match`);
  }
});

test('CONTROL: requiring the shared parser is not mistaken for defining one', () => {
  // The widened parseArgs pattern must not fire on the CORRECT idiom, or every
  // migrated file becomes an offender and the census gets muted in a week.
  const correct = "const { parseArgs } = require('./cli');";
  assert.ok(!IDIOMS['a locally defined parseArgs'].test(correct));
  assert.ok(!IDIOMS['argv.indexOf('].test(correct));
  // And it must still fire on the two real definitions.
  assert.ok(IDIOMS['a locally defined parseArgs'].test('function parseArgs(argv) {'));
  assert.ok(IDIOMS['a locally defined parseArgs'].test('const parseArgs = (argv) => {'));
  assert.ok(IDIOMS['argv.indexOf('].test("const i = argv.indexOf('--town');"));
  assert.ok(IDIOMS['argv.indexOf('].test('const i = argv.indexOf(f);'));
});
