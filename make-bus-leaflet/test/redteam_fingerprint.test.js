/*
 * redteam_source.js — OA-166: reuse is decided by the SERVICE FACTS, not by when
 * the inputs happened to be pulled.
 *
 * WHAT WENT WRONG, three times, each costing about 100k tokens. The tool asked
 * "has S1 or S2 been re-pulled since this answer was derived?" and treated yes as
 * "the thing being diffed has changed". It is not the same question:
 *
 *   Wisbech, 2026-08-29        a new S1 written only to ADJUDICATE the red team's
 *                              own claim about X46. It said BUY — re-buying a
 *                              blind answer to re-ask a question we had just agreed
 *                              with.
 *   High Wycombe Aldi, 08-29   an S1 re-derived so it would carry frequency fields.
 *                              All 12 services identical on route, operator, days,
 *                              termini and headsigns; only the registration window
 *                              moved, and it LENGTHENED. It said BUY.
 *   Ramsey, 2026-08-31         an S2 that rebuilt routes_paths.json and nothing
 *                              else — drawn geometry, not a service fact. BUY.
 *
 * All three were overridden by hand in a commit note, and all three were right to
 * be. An override that lives in a commit message is not a mechanism, which is the
 * other half of this row: `--reuse-anyway "<reason>"`.
 *
 * redteam_source.js is a CLI with no exports, so every case here spawns it.
 *
 * THE FIXTURE DATES ARE RELATIVE TO TODAY, deliberately. The tool's other rule is
 * a 60-day age window, so a fixture pinned to a literal date would have decided
 * these cases correctly for eight weeks and then started failing for a reason
 * that has nothing to do with what is under test.
 *
 * The two CONTROL tests must stay green. This guard sits in front of the single
 * most expensive thing in the skill, so it has to be shown to PERMIT as well as
 * to refuse — and it has to be shown still to refuse a genuinely stale answer,
 * because a fingerprint that always matches would be worse than the timestamp.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { svc, estate, run, freshRun } = require('./redteam_fixture');

const TWO = [svc('1', 'Whippet', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Daily')];

test('CONTROL: an answer whose S1 has not moved at all is reused', () => {
  const e = estate({ then: TWO });                       // one S1 run, nothing after it
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0, `expected REUSE (0), got ${r.code}\n${r.out}`);
  assert.match(r.out, /REUSE/);
});

test('CONTROL: an answer past the age window is still bought', () => {
  const e = estate({ then: TWO, answerAgeDays: 400 });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 10, `expected BUY (10), got ${r.code}\n${r.out}`);
  assert.match(r.out, /day window/, 'the age window is what should have bought it:\n' + r.out);
});

test('an S1 re-pull that moved no service fact is reused, not re-bought', () => {
  const e = estate({ then: TWO, now: TWO });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0,
    `the inputs were re-pulled and nothing about the answer changed, and it still bought (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /UNCHANGED/);
  assert.match(r.out, /service facts\s+: gtfs-services\.json/);
});

test('a lengthened registration window and a new frequency field are not service facts', () => {
  // Exactly the High Wycombe Aldi case: OA-158 re-derived the file to carry
  // frequency, and the windows moved OUT rather than in, so nothing expires sooner.
  const before = [svc('1', 'Whippet', 'Mon-Sat', { validFrom: '20260721', validTo: '20270421' })];
  const after = [svc('1', 'Whippet', 'Mon-Sat', { validFrom: '20260803', validTo: '20270503', tripsAtTownPerWeekSample: 42 })];
  const e = estate({ then: before, now: after });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0, `a registration window bought a red team (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /UNCHANGED/);
});

test('a changed operator IS a service fact, and the BUY names both S1 runs', () => {
  const e = estate({ then: TWO, now: [svc('1', 'Stagecoach East', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Daily')] });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 10, `expected BUY (10), got ${r.code}\n${r.out}`);
  assert.match(r.out, /CHANGED/);
  assert.match(r.out, /service facts moved between S1 r1 and S1 r2/,
    'the BUY has to name what moved and where, or it is the timestamp rule wearing a new message:\n' + r.out);
});

test('with no services file on either side it says CANNOT TELL and falls back', () => {
  // An absent fingerprint must read as "cannot tell", never as "unchanged" —
  // the expensive answer is the safe one, and the output has to say which rule ran.
  const e = estate({ then: null, now: null });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.match(r.out, /CANNOT TELL/, 'it did not say it was guessing:\n' + r.out);
  assert.match(r.out, /falling back to the S1\/S2 pull timestamp/);
  assert.strictEqual(r.code, 10, `a fingerprint it could not take must not become a REUSE (exit ${r.code}):\n${r.out}`);
});

test('--reuse-anyway overrides a BUY, and the stamp travels with the run', () => {
  const e = estate({ then: TWO, now: [svc('1', 'Stagecoach East', 'Mon-Sat')] });
  const into = freshRun(e.build);
  const r = run(into, ['--build', e.build, '--reuse-anyway', 'the operator change is a rebrand, not a new service']);
  assert.strictEqual(r.code, 0, `--reuse-anyway did not lift the BUY (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /REUSE ANYWAY/);
  assert.match(r.out, /service facts moved between S1 r1 and S1 r2/,
    'an override that hides what it overrode is a bypass:\n' + r.out);
  const j = JSON.parse(fs.readFileSync(path.join(into, 'redteam.json'), 'utf8'));
  assert.match(j._reuseOverride.reason, /rebrand/);
  assert.strictEqual(j._reuseOverride.overrode.length, 1);
  // ...and never into the answer in its own build.
  const own = JSON.parse(fs.readFileSync(path.join(e.answerDir, 'redteam.json'), 'utf8'));
  assert.strictEqual(own._reuseOverride, undefined, 'it stamped the original answer, not the copy');
});

test('--reuse-anyway with no reason is refused', () => {
  const e = estate({ then: TWO, now: [svc('1', 'Stagecoach East', 'Mon-Sat')] });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build, '--reuse-anyway']);
  assert.strictEqual(r.code, 2, `a blank override was accepted (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /needs a reason/);
});

/* OA-270 — the two defects that made the fingerprint unavailable to every place
 * map of the pre-OA-158 era, and unreadable when it WAS available.
 *
 * Eight of the twenty maps carrying a manifest have an S1 run with no services
 * file while an S2 run of the same era has one, and all eight are places: their
 * P1 run wrote `place.json` and `place-candidates.json`, and `gtfs-services.json`
 * landed in P2 minutes later. Looking only in the S1 folder found nothing, so the
 * tool said CANNOT TELL and fell back to the pull timestamp — the exact proxy
 * OA-166 exists to replace — and the fallback then bought a ~100k-token answer.
 */

test('an era whose services file landed in S2 is still fingerprinted (OA-270)', () => {
  // Beaconsfield Simpson Centre's shape: S1 2026-07-21_2041 outputs place.json and
  // place-candidates.json only; S2 2026-07-21_2044 outputs gtfs-services.json.
  const e = estate({ then: TWO, now: TWO, thenStage: 'S2' });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0,
    `the older era's services file is in its S2 run and the facts have not moved, and it still bought (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /UNCHANGED/);
  assert.match(r.out, /file from S2 g1/,
    'it must say WHICH run it read the era out of, or the reader cannot check it:\n' + r.out);
});

test('a stop relabel is NAMED, not just reported as CHANGED (OA-270)', () => {
  // The whole difference between Simpson Centre's two eras was one string: NaPTAN
  // appended the hail-and-ride indicator `HaR` to a stop's display name on route
  // 624, a school service neither Beaconsfield place has ever drawn. `CHANGED`
  // alone cannot tell a relabel from a re-route, so the reader could not answer it
  // with --reuse-anyway without redoing by hand what the tool already knows.
  const e = estate({
    then: [svc('624', 'Carousel Buses', '?', { termini: ['Deanfield Avenue', 'Hart Street'] })],
    now: [svc('624', 'Carousel Buses', '?', { termini: ['Deanfield Avenue HaR', 'Hart Street'] })],
  });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 10, `expected BUY (10), got ${r.code}\n${r.out}`);
  assert.match(r.out, /CHANGED/);
  assert.match(r.out, /what moved/, 'it reported that something moved and not what:\n' + r.out);
  assert.match(r.out, /624/);
  assert.match(r.out, /termini/);
  assert.match(r.out, /"Deanfield Avenue" → "Deanfield Avenue HaR"/,
    'the reader has to see both spellings to judge a relabel:\n' + r.out);
});

test('an S2 services file the manifest does not DECLARE is not read (OA-270)', () => {
  /* The dangerous direction. The fix locates a named file by what the manifest's
   * own `outputs` says was written; it does not widen the fingerprint to a
   * geometry stage. A file sitting in an S2 folder that the run record does not
   * claim to have written is not this era's declaration, and reading it anyway
   * would be the widening OA-270 says explicitly not to do. CANNOT TELL is the
   * safe answer, and it buys.
   *
   * NOT NAMED `CONTROL`, though that is what it is in spirit, and the reason is
   * worth the line: prove-red-redteam-fingerprint.js reverts the WHOLE OA-166
   * decision, and the reverted code prints no `CANNOT TELL` at all — there is no
   * fingerprint to fail to take. So this case does go red under that harness and
   * has to be counted with the guards, and calling it a control would make the
   * harness fail with "the revert broke ordinary use". What it guards is a
   * widening rather than a narrowing, which is the direction that fails silently. */
  const e = estate({ then: TWO, now: TWO, thenStage: 'S2', declare: false });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.match(r.out, /CANNOT TELL/, 'it read a file the manifest never declared:\n' + r.out);
  assert.strictEqual(r.code, 10, `an undeclared file became a REUSE (exit ${r.code}):\n${r.out}`);
});

/* OA-332 — a data-only S1 run derives no feed file, so the fingerprint fell onto
 * OUR OWN reply file and bought an answer for agreeing with it.
 *
 * `gtfs-services.json` is preferred over `verified-services.json` because the
 * first is the raw derivation from the feed and it is the WORLD moving that
 * stales a blind answer, not our reply to it. That preference stops holding the
 * moment a map records a decision: the data-only S1 run OA-306 prescribes for
 * declaring a decided register entry pulls no feed, so it writes
 * `verified-services.json` and nothing else, and the era had no feed derivation
 * of its own to find. Nine of the seventeen builds carrying a red-team answer
 * were in that state on 2026-09-13 and five of the estate's six `_reuseOverride`
 * stamps say the same sentence in different words — Huntingdon's 401 corrected to
 * agree with the answer's own note, DIAL-A-RIDE and TIGERONDEMAND arriving from
 * the service-facts register — which is: our data moved TOWARD this answer, so it
 * cannot have changed it.
 *
 * A run that derived nothing from the feed leaves the previous pull's derivation
 * in force, and that is the derivation the era actually has.
 */

const TWO_PLUS_DECIDED = [
  svc('1', 'Whippet', 'Mon-Sat'),
  svc('55', 'Stagecoach East', 'Daily'),
  // The shape of SF-011: a register decision we wrote into our own file. It is in
  // no feed, so no re-derivation from the feed could ever produce it.
  svc('DIAL-A-RIDE', 'FACT Community Transport', 'Mon-Fri'),
];

test('a data-only S1 run does not buy an answer for agreeing with it (OA-332)', () => {
  /* r1 pulled the feed; the answer came next; r2 is the declaration run — it
   * carries our verified set with the decided include written in, and no feed
   * derivation at all. Nothing the answer is about has moved. */
  const e = estate({ then: TWO, now: null, thenVerified: TWO, nowVerified: TWO_PLUS_DECIDED });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 0,
    `a declaration run with no feed derivation bought a ~100k-token answer (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /UNCHANGED/);
  assert.match(r.out, /service facts\s+: gtfs-services\.json/,
    'it fingerprinted our own reply file instead of the feed derivation:\n' + r.out);
  assert.match(r.out, /in force/,
    'a comparison that reached back has to say so, naming the run, or the reader cannot check it:\n' + r.out);
  assert.match(r.out, /from S1 r1/, 'it did not name the run whose derivation is in force:\n' + r.out);
});

test('the derivation in force is the NEWEST one, not the oldest (OA-332)', () => {
  /* The dangerous direction. r2 is a genuine re-pull that moved an operator, and
   * r3 is a later declaration run with no feed derivation. Reaching back must
   * land on r2 and buy; reaching back to r1 would answer UNCHANGED about a feed
   * that has moved, which is the one thing this guard exists to prevent. */
  const e = estate({
    then: TWO,
    now: [svc('1', 'Stagecoach East', 'Mon-Sat'), svc('55', 'Stagecoach East', 'Daily')],
    later: null,
    laterVerified: TWO_PLUS_DECIDED,
  });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.strictEqual(r.code, 10,
    `an operator moved in the newest feed derivation and it reused anyway (exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /CHANGED/, 'it did not compare against the newest derivation:\n' + r.out);
  assert.match(r.out, /what moved/);
  assert.match(r.out, /Stagecoach East/, 'the moved operator is not named:\n' + r.out);
});

test('it reaches BACK for a derivation and never forward (OA-332)', () => {
  /* The narrowing that keeps the rule honest. The answer predates every feed
   * derivation this build has: r1 carries none, and r2's was derived after the
   * answer was bought. Comparing an era against a file that did not exist in it
   * would be reading the future, so there is no fingerprint to take and CANNOT
   * TELL is the safe answer — which then buys on the pull timestamp.
   *
   * NOT NAMED `CONTROL`, for the reason the OA-270 widening guard records: the
   * prove-red fixture reverts the whole fingerprint, so the `CANNOT TELL` this
   * asserts on is not printed at all and the case goes red with the guards. */
  const e = estate({ then: null, now: TWO });
  const r = run(freshRun(e.build), ['--dry-run', '--build', e.build]);
  assert.match(r.out, /CANNOT TELL/,
    'it fingerprinted an era against a derivation made after it:\n' + r.out);
  assert.strictEqual(r.code, 10, `reaching forward became a REUSE (exit ${r.code}):\n${r.out}`);
});
