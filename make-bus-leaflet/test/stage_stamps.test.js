/*
 * stage.js commit S4 — the provenance-stamp guard (OA-161).
 *
 * `rollout_places.js` and `rollout.js` each wrote two stamps into a run's own
 * routes.json between seeding and generating: `engine` (which generator drew
 * this map) and `design.sheetVersion` (the `build N.N · date` the footer
 * prints). A build assembled BY HAND — `stage.js new S4`, `pull`, then the
 * generators — ran neither, and nothing said so at the time. St Neots Town
 * Centre v2.13 shipped on 2026-08-29 with neither stamp.
 *
 * It was caught only because the NEXT version's label diff came back too clean:
 * the build stamp is a text element and it should have changed between two
 * versions. THE BYTE GATE CANNOT CATCH IT — `sync_ci_reference.js` mirrors the
 * S4 run into `ci-reference/` and the gate reproduces the sheet from
 * `ci-reference`, so both sides come from the same unstamped inputs, agree
 * exactly, and it goes green. A gate that regenerates an artefact from its own
 * committed inputs can never notice an input missing from both.
 *
 * So the check has to be a REFUSAL AT A BOUNDARY, and the boundary is the one
 * every route to an S4 passes through — including the hand-built one.
 *
 * CONTROL here means "green whether or not the guard is present": an ordinary
 * stamped commit, a non-S4 stage, and the `stage.js stamps` command that the
 * refusal tells you to run. tools/prove-red-stage-stamps.js cuts the guard out
 * of a copy and requires every non-CONTROL test below to go red and every
 * CONTROL to stay green.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scratchDir } = require('../assets/scratch');

const STAGE = process.env.STAGE_JS || path.join(__dirname, '..', 'assets', 'stage.js');

function newTown() {
  const dir = scratchDir('stage-stamps-');
  const r = spawnSync(process.execPath, [STAGE, 'init', dir, 'Stampton'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'init failed: ' + r.stderr);
  return dir;
}

/** An S4 run dir with a sheet in it and a routes.json carrying whatever `rj` says. */
function s4(town, rj, id) {
  const d = path.join(town, 'S4-generate', id || 'v9.9_2026-08-29_1200');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'internal.svg'), '<svg/>');
  fs.writeFileSync(path.join(d, 'routes.json'),
    JSON.stringify(Object.assign({ version: '9.9', town: 'Stampton' }, rj)));
  return d;
}
const STAMPED = { engine: 'deadbeef01', design: { sheetVersion: 'build 9.9 · 29 Aug 2026' } };

function commit(town, args) {
  return spawnSync(process.execPath, [STAGE, 'commit'].concat(args), { cwd: town, encoding: 'utf8' });
}
function manifest(town) {
  return JSON.parse(fs.readFileSync(path.join(town, 'manifest.json'), 'utf8'));
}

test('CONTROL — an S4 carrying both stamps commits normally', () => {
  const town = newTown();
  const d = s4(town, STAMPED);
  const r = commit(town, ['S4', d, '--outputs', 'internal.svg']);
  assert.strictEqual(r.status, 0, 'the control must pass: ' + r.stderr);
  assert.strictEqual(manifest(town).stages.S4.latest, 'v9.9_2026-08-29_1200');
});

test('CONTROL — the guard is S4-only: an S2 with no stamps anywhere still commits', () => {
  const town = newTown();
  const d = path.join(town, 'S2-geometry', '2026-08-29_1200');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'roads_geo.json'), '{}');
  fs.writeFileSync(path.join(d, 'routes.json'), '{"town":"Stampton"}');
  const r = commit(town, ['S2', d, '--outputs', 'roads_geo.json']);
  assert.strictEqual(r.status, 0, 'an S2 has no sheet to stamp: ' + r.stderr);
});

test('CONTROL — `stage.js stamps` writes BOTH stamps and says what it did', () => {
  const town = newTown();
  const d = s4(town, { design: {} });
  const r = spawnSync(process.execPath, [STAGE, 'stamps', d], { cwd: town, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'stamps failed: ' + r.stderr);
  const rj = JSON.parse(fs.readFileSync(path.join(d, 'routes.json'), 'utf8'));
  assert.match(rj.engine, /^[0-9a-f]{10}$/, 'engine hash not written');
  assert.strictEqual(rj.design.sheetVersion, 'build 9.9 · 29 Aug 2026');
  assert.match(r.stdout, /Re-run the generators/, 'must say the sheets are still unstamped');
});

test('CONTROL — `stamps` on an unversioned run dir writes the engine hash and REFUSES to invent a build stamp', () => {
  const town = newTown();
  // A dated, unversioned id — there is no vN.N in it, so no build stamp exists.
  const d = s4(town, { design: {} }, '2026-08-29_1200');
  const r = spawnSync(process.execPath, [STAGE, 'stamps', d], { cwd: town, encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0, 'it must not claim success with one stamp missing');
  assert.match(r.stdout + r.stderr, /not a versioned run dir/);
  const rj = JSON.parse(fs.readFileSync(path.join(d, 'routes.json'), 'utf8'));
  assert.match(rj.engine, /^[0-9a-f]{10}$/, 'the half it CAN do must still have happened');
});

test('an S4 with NEITHER stamp refuses the commit', () => {
  const town = newTown();
  const d = s4(town, { design: {} });
  const r = commit(town, ['S4', d, '--outputs', 'internal.svg']);
  assert.notStrictEqual(r.status, 0, 'an unstamped S4 must not commit');
  assert.match(r.stderr, /2 of the 2 S4 provenance stamps missing/);
  assert.match(r.stderr, /engine/);
  assert.match(r.stderr, /design\.sheetVersion/);
});

test('an S4 missing only the engine hash refuses — the half that rides to the portal', () => {
  const town = newTown();
  const d = s4(town, { design: { sheetVersion: 'build 9.9 · 29 Aug 2026' } });
  const r = commit(town, ['S4', d, '--outputs', 'internal.svg']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /1 of the 2 S4 provenance stamps missing[\s\S]*engine/);
});

test('an S4 missing only design.sheetVersion refuses — the number Peter quotes back', () => {
  const town = newTown();
  const d = s4(town, { engine: 'deadbeef01', design: {} });
  const r = commit(town, ['S4', d, '--outputs', 'internal.svg']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /1 of the 2 S4 provenance stamps missing[\s\S]*design\.sheetVersion/);
});

test('an EMPTY-STRING stamp counts as missing — a key that is present but says nothing', () => {
  const town = newTown();
  const d = s4(town, { engine: '', design: { sheetVersion: '' } });
  const r = commit(town, ['S4', d, '--outputs', 'internal.svg']);
  assert.notStrictEqual(r.status, 0, 'presence of the KEY is not the test — the value is');
  assert.match(r.stderr, /2 of the 2 S4 provenance stamps missing/);
});

test('the refusal names the one command that fixes it', () => {
  const town = newTown();
  const d = s4(town, { design: {} });
  const r = commit(town, ['S4', d, '--outputs', 'internal.svg']);
  assert.match(r.stderr, /stage\.js" stamps/, 'a refusal that does not say what to run is a puzzle');
  assert.match(r.stderr, /RE-RUN THE GENERATORS/, 'stamping after the sheets are drawn is not enough');
});

test('the refused commit leaves the manifest untouched — no half-record', () => {
  const town = newTown();
  const d = s4(town, { design: {} });
  commit(town, ['S4', d, '--outputs', 'internal.svg']);
  assert.strictEqual(manifest(town).stages.S4.latest, null);
  assert.strictEqual(manifest(town).stages.S4.runs.length, 0);
});

test('--force-stamps still records it, but says out loud what it recorded', () => {
  const town = newTown();
  const d = s4(town, { engine: 'deadbeef01', design: {} });
  const r = commit(town, ['S4', d, '--outputs', 'internal.svg', '--force-stamps']);
  assert.strictEqual(r.status, 0, 'the override must work: ' + r.stderr);
  assert.match(r.stdout, /WARNING: committing an S4 with no design\.sheetVersion/);
  assert.strictEqual(manifest(town).stages.S4.latest, 'v9.9_2026-08-29_1200');
});
