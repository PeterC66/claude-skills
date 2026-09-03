/*
 * staleInputs — has the DATA moved since the S4 a rollout would roll forward? (OA-225)
 *
 * Both rollouts take their CONFIG from the latest S3 and their GEOMETRY from the
 * previous S4's frozen copies, so a map whose S2 has moved gets the new
 * configuration over the old geometry. High Wycombe, 2026-09-01: route 20 in the
 * Services panel, in the palette and in the operator table, and no line on the map,
 * on all four sheets. Nothing in either rollout asked the question; the guard next
 * door in services_panel.js is what spoke up.
 *
 * THE CONTROLS MUST STAY GREEN. A guard that has only ever been seen to refuse has
 * not been shown to permit, and this one is wired in FRONT of the UP-TO-DATE fast
 * path — so a false positive here does not print a spurious warning, it stops the
 * only tool that can re-render the estate. The last control is the real one: the
 * whole estate as it stood on 2026-09-03, all eleven maps clean, measured before
 * the guard was wired in.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./_engine');
const { staleInputs } = load('gate_lib.js');

/* A manifest in the shape stage.js writes. `at` is when a run was COMMITTED and
 * `startedAt` when it began; both are minute-resolution ISO strings, which is what
 * makes the strictness of the comparison below a decision rather than a detail. */
const M = (s4, s2, s3) => ({
  stages: {
    S2: { latest: s2.latest, runs: s2.runs },
    S3: { latest: s3.latest, runs: s3.runs },
    S4: { latest: s4.latest, runs: s4.runs },
  },
});
const run = (id, at, extra = {}) => ({ id, at, ...extra });

// ---- CONTROLS ---------------------------------------------------------------

test('control: an engine-only rollout, where nothing has moved, is permitted', () => {
  const m = M(
    { latest: 'v2.0_b', runs: [run('v2.0_b', '2026-09-02T10:05', { startedAt: '2026-09-02T10:00' })] },
    { latest: 's2a', runs: [run('s2a', '2026-09-01T09:00')] },
    { latest: 's3a', runs: [run('s3a', '2026-09-01T09:30')] });
  assert.deepStrictEqual(staleInputs(m), []);
});

test('control: an S2 committed INSIDE the S4 run that pulled it is not stale', () => {
  /* This is High Wycombe v4.0, exactly: the S4 started 23:08 and the S2 it was
   * built from was committed at 23:08. A >= comparison would refuse a build that
   * was perfectly in step, on the estate's most recently rebuilt town. */
  const m = M(
    { latest: 'v4.0', runs: [run('v4.0', '2026-09-01T23:13', { startedAt: '2026-09-01T23:08' })] },
    { latest: 's2new', runs: [run('s2new', '2026-09-01T23:08')] },
    { latest: 's3new', runs: [run('s3new', '2026-09-01T23:08')] });
  assert.deepStrictEqual(staleInputs(m), []);
});

test('control: basedOn that MATCHES the latest is permitted, and outranks the clock', () => {
  /* The exact signal wins over the inferred one. Here the clock would accuse — the
   * S2 was committed after the S4 started — and basedOn says the S4 was built from
   * that very run, which it was. The id is the fact; the timestamp is the guess. */
  const m = M(
    { latest: 'v9.0', runs: [run('v9.0', '2026-09-02T10:10', { startedAt: '2026-09-02T10:00', basedOn: { S2: 's2x', S3: 's3x' } })] },
    { latest: 's2x', runs: [run('s2x', '2026-09-02T10:04')] },
    { latest: 's3x', runs: [run('s3x', '2026-09-02T10:05')] });
  assert.deepStrictEqual(staleInputs(m), []);
});

test('control: a map with no committed S4 says nothing (the callers report it as SKIP)', () => {
  assert.deepStrictEqual(staleInputs({ stages: { S2: { latest: 'a', runs: [run('a', '2026-09-01T09:00')] } } }), []);
  assert.deepStrictEqual(staleInputs({}), []);
  assert.deepStrictEqual(staleInputs(null), []);
});

test('control: an S4 with no clock and no basedOn accuses nobody', () => {
  /* Every S4 committed before startedAt was recorded — most of the estate's history.
   * Guessing from the run id would be exactly the reasoning this helper exists to
   * avoid, and a guard that fires on absent evidence is a guard that gets --forced. */
  const m = M(
    { latest: 'v1.0', runs: [{ id: 'v1.0' }] },
    { latest: 's2a', runs: [run('s2a', '2026-09-01T09:00')] },
    { latest: 's3a', runs: [run('s3a', '2026-09-01T09:30')] });
  assert.deepStrictEqual(staleInputs(m), []);
});

// ---- THE REFUSALS -----------------------------------------------------------

test('the case that produced OA-225: a new S2 postdating the S4 is refused', () => {
  /* High Wycombe as it stood on 2026-09-01 at 22:40 — previous S4 v2.65 started
   * 08:40, the rebuilt S2 committed at 22:33. Run against the real manifest with
   * `latest` wound back to that moment, the live helper returns exactly this. */
  const m = M(
    { latest: 'v2.65', runs: [run('v2.65', '2026-09-01T08:45', { startedAt: '2026-09-01T08:40' })] },
    { latest: 's2new', runs: [run('s2new', '2026-09-01T22:33')] },
    { latest: 's3old', runs: [run('s3old', '2026-08-31T11:36')] });
  assert.deepStrictEqual(staleInputs(m), [{ stage: 'S2', was: null, now: 's2new', how: 'timestamp' }]);
});

test('a moved S3 is refused too — the config would be new over the old geometry', () => {
  const m = M(
    { latest: 'v2.65', runs: [run('v2.65', '2026-09-01T08:45', { startedAt: '2026-09-01T08:40' })] },
    { latest: 's2old', runs: [run('s2old', '2026-07-28T09:00')] },
    { latest: 's3new', runs: [run('s3new', '2026-09-01T22:35')] });
  assert.deepStrictEqual(staleInputs(m), [{ stage: 'S3', was: null, now: 's3new', how: 'timestamp' }]);
});

test('both stages moving are both named, so the message can say which', () => {
  const m = M(
    { latest: 'v2.65', runs: [run('v2.65', '2026-09-01T08:45', { startedAt: '2026-09-01T08:40' })] },
    { latest: 's2new', runs: [run('s2new', '2026-09-01T22:33')] },
    { latest: 's3new', runs: [run('s3new', '2026-09-01T22:35')] });
  assert.deepStrictEqual(staleInputs(m).map((x) => x.stage), ['S2', 'S3']);
});

test('basedOn that does NOT match the latest is refused, and says what it was built on', () => {
  /* The exact form, which is what every S4 built from this change forward will carry.
   * It also catches the case the clock cannot see: `latest` moved BACKWARDS to an
   * older run, so the build would use an S2 the S4 never saw, committed long before
   * the S4 started. */
  const m = M(
    { latest: 'v9.0', runs: [run('v9.0', '2026-09-02T10:10', { startedAt: '2026-09-02T10:00', basedOn: { S2: 's2new', S3: 's3x' } })] },
    { latest: 's2old', runs: [run('s2old', '2026-07-01T09:00')] },
    { latest: 's3x', runs: [run('s3x', '2026-09-02T09:00')] });
  assert.deepStrictEqual(staleInputs(m), [{ stage: 'S2', was: 's2new', now: 's2old', how: 'basedOn' }]);
});

test('the whole estate as at 2026-09-03 is clean — the guard refuses nothing that works', () => {
  /* The measurement that decided this was safe to put in FRONT of the fast paths.
   * It reads the real manifests rather than a fixture, so it is a statement about
   * the estate and not about this file; a map that develops the fault turns it red
   * here as well as in the tool, which is the point. It is skipped where the data
   * repository is not beside the skills one, which is every CI checkout. */
  const fs = require('node:fs');
  const path = require('node:path');
  const B = process.env.BUSES_DIR || path.join(__dirname, '..', '..', '..', '..', 'Using AI', 'Buses');
  if (!fs.existsSync(path.join(B, 'Areas'))) return;
  const dirs = [];
  for (const a of fs.readdirSync(path.join(B, 'Areas'))) dirs.push(path.join(B, 'Areas', a));
  for (const g of fs.readdirSync(path.join(B, 'Places'))) {
    const gd = path.join(B, 'Places', g);
    if (fs.statSync(gd).isDirectory()) for (const a of fs.readdirSync(gd)) dirs.push(path.join(gd, a));
  }
  const dirty = [];
  let seen = 0;
  for (const d of dirs) {
    const mf = path.join(d, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    seen++;
    const r = staleInputs(JSON.parse(fs.readFileSync(mf, 'utf8')));
    if (r.length) dirty.push(path.basename(d) + ': ' + JSON.stringify(r));
  }
  assert.deepStrictEqual(dirty, []);
  assert.ok(seen >= 11, 'expected at least the 11 maps that existed on 2026-09-03, saw ' + seen);
});
