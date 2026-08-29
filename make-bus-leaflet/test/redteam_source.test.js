/*
 * redteam_source.js — the OA-141 ambiguity guard, and saying which build it read.
 *
 * WHAT WENT WRONG. `--build` defaults to two levels above `--into`, which is
 * exactly right from the documented cwd (`<build>/S6-verify/<id>`) and silently
 * wrong from anywhere else. Run from a PLACE's own root it lands on the parent
 * TOWN: on 2026-08-25 it printed `redteam_source — Beaconsfield` for a place
 * called Beaconsfield Waitrose, answered REUSE, and copied the town's answer
 * into the place's folder. Every line of that output was true about a map the
 * operator was not standing in, and nothing said so.
 *
 * redteam_source.js is a CLI with no exports, so every case here spawns it.
 *
 * The two CONTROL tests must stay green. A guard that has only ever been seen
 * to refuse has not been shown to permit, and this one sits in front of the
 * single most expensive thing in the skill — a refusal that fires on the
 * documented invocation would cost a red team, not save one.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// tools/prove-red-redteam-source.js points this at a copy with the OA-141
// changes cut out, so the suite can be watched failing against the code as it
// was on the day the failure happened.
const SRC = process.env.REDTEAM_SOURCE_JS
  || path.join(__dirname, '..', 'assets', 'redteam_source.js');

/* A build is a folder with a manifest.json naming a map. That is the whole
 * shape this tool needs, so the fixtures build exactly that and no more — a
 * fixture carrying a real town's data would be checking the data, not the guard. */
function makeBuild(root, name, opts = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    town: name,
    stages: { S1: { latest: 'r1', runs: [{ id: 'r1', at: '2026-08-01T09:00' }] },
              S2: { latest: 'r1', runs: [{ id: 'r1', at: '2026-08-01T09:00' }] } },
  }, null, 1));
  if (opts.answer) {
    const rd = path.join(dir, 'S6-verify', opts.answer);
    fs.mkdirSync(rd, { recursive: true });
    fs.writeFileSync(path.join(rd, 'redteam.json'),
      JSON.stringify({ derivedAt: opts.derivedAt || '2026-08-20', services: [{ ref: '1' }, { ref: '2' }] }));
  }
  return dir;
}

function run(cwd, args = []) {
  const r = spawnSync(process.execPath, [SRC, '--dry-run', ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* Areas/<Town>/ with Areas/<Town>/Places/<Place>/ inside it — the nesting that
 * makes `../..` mean two different things depending on where you stand. */
function estate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redteam-src-'));
  const town = makeBuild(root, 'Testton', { answer: '2026-08-20_1000', derivedAt: '2026-08-20' });
  const place = makeBuild(path.join(town, 'Places'), 'Testton Co-op');
  const townRun = path.join(town, 'S6-verify', '2026-08-20_1000');
  return { root, town, place, townRun };
}

test('CONTROL: the documented cwd is accepted and decides normally', () => {
  const { townRun } = estate();
  const r = run(townRun);
  assert.ok(r.code === 0 || r.code === 10, `expected a decision, got exit ${r.code}\n${r.out}`);
  assert.ok(!/AMBIGUOUS/.test(r.out), 'the guard fired on the documented invocation:\n' + r.out);
  assert.match(r.out, /redteam_source — Testton/);
});

test('CONTROL: a correctly scoped place is accepted and answers BUY', () => {
  const { place } = estate();
  const r = run(place, ['--build', place]);
  assert.strictEqual(r.code, 10, `expected BUY (10), got ${r.code}\n${r.out}`);
  assert.match(r.out, /redteam_source — Testton Co-op/);
});

test('it names the build it examined, on every run', () => {
  const { townRun, town } = estate();
  const r = run(townRun);
  assert.match(r.out, /build examined\s+: /,
    'the resolved --build path is not in the output; the map NAME alone cannot\n'
    + 'distinguish a place from its parent town, which is the OA-141 failure:\n' + r.out);
  assert.ok(r.out.includes(town), 'the printed path is not the build it read:\n' + r.out);
});

test('from a place root, the defaulted --build is refused rather than guessed', () => {
  const { place } = estate();
  const r = run(place);
  assert.strictEqual(r.code, 2,
    `standing in the place, it answered about the town instead of refusing (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /AMBIGUOUS/);
  // Both candidates must be named, or the message cannot be acted on.
  assert.match(r.out, /Testton Co-op/);
  assert.match(r.out, /"Testton"/);
});

test('an explicit --build naming a different map is refused too', () => {
  const { place, town } = estate();
  const r = run(place, ['--build', town]);
  assert.strictEqual(r.code, 2, `expected a refusal, got exit ${r.code}\n${r.out}`);
  assert.match(r.out, /AMBIGUOUS/);
});

test('--foreign-build permits it, and says out loud whose answer it is', () => {
  const { place, town } = estate();
  const r = run(place, ['--foreign-build']);
  assert.notStrictEqual(r.code, 2, `--foreign-build did not lift the refusal:\n${r.out}`);
  assert.match(r.out, /FOREIGN BUILD/);
  assert.match(r.out, /standing in\s+: Testton Co-op/);
  assert.match(r.out, /answering about\s+: Testton/);
  assert.ok(r.out.includes(town), 'the borrowed build is not named:\n' + r.out);
});
