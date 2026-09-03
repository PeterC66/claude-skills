/*
 * stage_module.test.js — stage.js is a MODULE as well as a command, and one
 * manifest reader is the only one.
 *
 * OA-232 Tier 2.4, from the 2026-09-03 codebase review's engine-pipeline N25.
 *
 * WHY THIS EXISTS. `stage.js` is the file every stage boundary in the system
 * spawns, and it exported nothing at all. `require`ing it RAN a stage command —
 * `main()` was called unconditionally at the bottom — so there was no way to ask
 * it a question without starting a process, and seven other files therefore
 * re-implemented `JSON.parse(fs.readFileSync(<dir>/manifest.json))` inline, each
 * with its own idea of what an absent or malformed file means.
 *
 * The review's central finding was that an extraction is the module PLUS a check
 * on its callers, so this file asks both halves:
 *
 *   1. Requiring stage.js RUNS NOTHING and hands back the functions. That is the
 *      same property `generator_load.test.js` holds for the five generators
 *      after OA-224 Tier 4.1, and it is the precondition for everything else.
 *   2. NO FILE UNDER assets/ OR tools/ re-parses manifest.json inline. A list of
 *      the four that were migrated would certify those four; the census is what
 *      notices the fifth.
 *
 * Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet`, no arguments:
 *     npm test
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ENGINE_DIR, load } = require('./_engine');

const stage = load('stage.js');

test('requiring stage.js gives back its functions', () => {
  for (const name of ['findTownDir', 'loadManifest', 'saveManifest', 'emptyStages', 'backfillStages']) {
    assert.strictEqual(typeof stage[name], 'function', `stage.js does not export ${name}`);
  }
  assert.deepStrictEqual(stage.ORDER_OF, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
});

test('requiring stage.js runs NOTHING — no usage, no exit, no folder', () => {
  // A child process, because the require above has already happened in this one
  // and could not tell a silent module from one that printed before we looked.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-module-'));
  const r = spawnSync(process.execPath,
    ['-e', `require(${JSON.stringify(path.join(ENGINE_DIR, 'stage.js'))}); console.log('required');`],
    { cwd: scratch, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `requiring stage.js exited ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.strictEqual(r.stdout.trim(), 'required', `it printed something of its own:\n${r.stdout}`);
  assert.strictEqual(r.stderr.trim(), '', `it wrote to stderr:\n${r.stderr}`);
  assert.deepStrictEqual(fs.readdirSync(scratch), [], 'requiring it created something in the cwd');
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('CONTROL: run as a command with no arguments, it still refuses loudly', () => {
  // Without this, the case above passes for a stage.js whose main() has been
  // deleted rather than guarded — which is the mutation that would look like a
  // tidy-up and take every stage boundary in the system with it.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-cmd-'));
  const r = spawnSync(process.execPath, [path.join(ENGINE_DIR, 'stage.js')],
    { cwd: scratch, encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0, 'stage.js with no command exited 0');
  assert.match(r.stdout + r.stderr, /stage\.js:/);
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('loadManifest reads a manifest, and names the file when it cannot', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-load-'));
  fs.writeFileSync(path.join(scratch, 'manifest.json'), JSON.stringify({ town: 'Nowhereton' }));
  assert.strictEqual(stage.loadManifest(scratch).town, 'Nowhereton');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-load-'));
  assert.throws(() => stage.loadManifest(empty));
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
});

test('findTownDir walks up to the folder holding the manifest', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-find-'));
  const deep = path.join(scratch, 'S4-generate', 'v1.0_2026-09-03_1200');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(scratch, 'manifest.json'), '{}');
  assert.strictEqual(fs.realpathSync(stage.findTownDir(deep)), fs.realpathSync(scratch));
  fs.rmSync(scratch, { recursive: true, force: true });
});

/*
 * THE CENSUS. Same shape as `cli.test.js`'s argv one and the portal's escaper
 * one: the closed question, not a list. `stage.js` itself is the definition and
 * is the only file allowed to spell the read out.
 */
const INLINE_MANIFEST = /JSON\.parse\(\s*fs\.readFileSync\([^)]*manifest\.json/;
const ALLOWED = new Set(['stage.js']);

test('no file re-parses manifest.json inline — loadManifest is the one reader', () => {
  const dirs = [ENGINE_DIR, path.join(__dirname, '..', 'tools')];
  const offenders = [];
  let scanned = 0;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      scanned++;
      if (ALLOWED.has(f)) continue;
      if (INLINE_MANIFEST.test(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        offenders.push(path.basename(dir) + '/' + f);
      }
    }
  }
  // The population check: without it this passes for a readdir that found nothing.
  assert.ok(scanned > 80, `the census read only ${scanned} files across assets/ and tools/`);
  assert.deepStrictEqual(offenders, [],
    `these re-parse manifest.json instead of requiring stage.js's loadManifest: ${offenders.join(', ')}`);
});

test('CONTROL: the census pattern really does match the idiom', () => {
  assert.ok(INLINE_MANIFEST.test("m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));"));
  assert.ok(!INLINE_MANIFEST.test("m = loadManifest(d);"));
});
