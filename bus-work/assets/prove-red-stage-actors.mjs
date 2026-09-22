#!/usr/bin/env node
/* Prove WHO PERFORMED A STAGE can be counted, and can refuse to be (buses-data
 * OA-427, item 3 of R9 of the process review, 2026-09-17).
 *
 * From this folder (C:\u3a St Ives\.claude\skills\bus-work\assets):
 *
 *   node prove-red-stage-actors.mjs
 *
 * Written to the shape prove-red-bods-scan.mjs set: every case is a PAIR, because
 * saying something is only half of it.
 *
 * WHAT IS ACTUALLY AT RISK HERE, and it is not the arithmetic. *Human touches per
 * map-month* is the number R9's whole recommendation is judged on, and until OA-427
 * it was a refusal. The failure that matters is therefore not a wrong rate but a
 * CONFIDENT one: a rate computed over attributed runs, printed without its coverage
 * and read as a rate over the estate. On the day this landed, coverage over 1,211
 * stage runs was zero, so every assertion about the not-measured path below is
 * about the state the estate is genuinely in and not a hypothetical.
 *
 * NO DISK AND NO CLOCK. `stageActors()` takes already-parsed manifests and its
 * `now`, so every case here is a literal — including the window boundary, which is
 * the one thing a harness that used the real clock could never pin down.
 */
import { stageActors, actorKind, actorWhy, runsOf } from './stage_actors.mjs';

let bad = 0, ran = 0;
const check = (label, ok, detail) => { ran++; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail == null ? '' : ' -- ' + detail}`); };

/* A fixed clock and two fixed instants. Nothing here is relative to today. */
const NOW = Date.parse('2026-09-22T12:00:00Z');
const RECENT = '2026-09-20T09:00';                 // 2 days back — inside a 30-day window
const ANCIENT = '2026-07-01T09:00';                // 83 days back — outside it

/** One manifest, from `[stage, at, by]` triples. `by` of null is an unattributed run. */
const manifest = (name, triples, kind = 'area') => ({
  name, kind, town: null, dir: `C:/fixture/${name}`,
  manifest: {
    town: name,
    stages: triples.reduce((acc, [st, at, by], i) => {
      acc[st] = acc[st] || { name: st, runs: [], latest: null };
      const rec = { id: `${st}-run-${i}`, dir: `${st}/run-${i}`, at, outputs: ['x.json'] };
      if (by !== null) rec.by = by;
      acc[st].runs.push(rec);
      acc[st].latest = rec.id;
      return acc;
    }, {}),
  },
});

console.log('\n1. An actor name is classified with the loop\'s own test, and nothing else is');
{
  check('a tick is a tick', actorKind('sched-1252') === 'loop');
  check('and so is one named in the other case, because the lock\'s test is not case-bound here', actorKind('SCHED-0614') === 'loop');
  check('a person-started session is NOT a tick', actorKind('buses-29') === 'session');
  check('nor is a name that merely CONTAINS the word — the rule is the prefix, as the lock reads it', actorKind('rescheduled-run') === 'session');
  check('an absent actor is unrecorded, which is neither of the two', actorKind(null) === 'unrecorded');
  check('and so is a blank one, so whitespace cannot smuggle in a third kind', actorKind('   ') === 'unrecorded');
}

console.log('\n2. The number is there when the record is, and it counts the right half');
{
  const a = stageActors([
    manifest('Alpha', [['S1', RECENT, 'buses-29'], ['S2', RECENT, 'sched-1252'], ['S3', RECENT, 'buses-29']]),
    manifest('Beta', [['S1', RECENT, 'sched-0614'], ['S2', RECENT, 'sched-0614']]),
  ], { now: NOW, windowDays: 30 });
  check('every run in the window is seen', a.runs === 5, String(a.runs));
  check('and every one of them is attributed', a.attributed === 5, String(a.attributed));
  check('two of the five are person-started', a.byPerson === 2, String(a.byPerson));
  check('and three are ticks — the halves add up to the whole', a.byLoop === 3 && a.byPerson + a.byLoop === a.attributed);
  check('both maps have attributed work, so both are map-months', a.mapsAttributed === 2, String(a.mapsAttributed));
  check('the rate is touches over map-months, not over runs', Math.abs(a.perMapMonth - 1) < 1e-9, String(a.perMapMonth));
  check('and coverage is full, which is the thing the rate must be read with', a.coverage === 1);
  check('a map with only ticks still counts as a map-month, and contributes ZERO touches', a.maps.find((m) => m.name === 'Beta').byPerson === 0);
}

console.log('\n3. Not recorded is not zero, which is the whole reason this file exists');
{
  const none = stageActors([
    manifest('Alpha', [['S1', RECENT, null], ['S2', RECENT, null]]),
  ], { now: NOW, windowDays: 30 });
  check('runs are counted even when nobody is named', none.runs === 2, String(none.runs));
  check('but none is attributed', none.attributed === 0);
  check('so the rate is NULL and not 0 — a zero here would read as "nobody touched a map for a month"', none.perMapMonth === null);
  check('and the denominator is empty too, rather than 1 map at zero touches', none.mapsAttributed === 0);
  check('the refusal says how many runs it looked at, which the sentence it replaced could not', /2 stage\(s\)/.test(actorWhy(none)), actorWhy(none));
  check('and it names the flag that would fix it', /--by/.test(actorWhy(none)));

  /* THE MUTATION THAT MATTERS. If an unattributed run were treated as a tick —
   * the natural, wrong default, since the loop does most of the work — the answer
   * would flip from "not recorded" to a confident rate of zero touches. The two
   * must be distinguishable, so this asserts the mutant's answer DIFFERS. */
  const asIfTick = none.runs - none.byPerson;
  check('MUTANT: counting an unrecorded run as a tick would give a confident 0.00, not a refusal', asIfTick === 2 && none.perMapMonth === null);
}

console.log('\n4. The denominator cannot be improved by standing still');
{
  const mixed = [
    manifest('Alpha', [['S1', RECENT, 'buses-29']]),
    manifest('Idle', [['S1', RECENT, null], ['S2', RECENT, null], ['S3', RECENT, null]]),
  ];
  const a = stageActors(mixed, { now: NOW, windowDays: 30 });
  check('only the attributed map is a map-month', a.mapsAttributed === 1, String(a.mapsAttributed));
  check('so the rate is 1.00 and not 0.50', Math.abs(a.perMapMonth - 1) < 1e-9, String(a.perMapMonth));
  check('and coverage says plainly that three quarters of the work is unnamed', Math.abs(a.coverage - 0.25) < 1e-9, String(a.coverage));

  /* The mutant: count every map on disk. That halves the rate for doing nothing
   * at all, and a metric that falls as the estate grows is worse than no metric. */
  const everyMap = a.byPerson / mixed.length;
  check('MUTANT: a denominator of every map would report 0.50 — better, purely for work nobody recorded', Math.abs(everyMap - 0.5) < 1e-9);
}

console.log('\n5. The window is a window, and it is measured off `at` rather than the folder name');
{
  const a = stageActors([
    manifest('Alpha', [['S1', RECENT, 'buses-29'], ['S2', ANCIENT, 'buses-29']]),
  ], { now: NOW, windowDays: 30 });
  check('the run inside the window is counted', a.runs === 1, String(a.runs));
  check('and the 83-day-old one is not', a.byPerson === 1, String(a.byPerson));

  const wide = stageActors([
    manifest('Alpha', [['S1', RECENT, 'buses-29'], ['S2', ANCIENT, 'buses-29']]),
  ], { now: NOW, windowDays: 120 });
  check('widen the window and the old run returns, so the boundary is doing the work', wide.runs === 2 && wide.byPerson === 2);

  /* A record whose `at` will not parse is dropped rather than guessed at from its
   * id — `stage.js` writes the id in LOCAL time and `at` in UTC, and says at
   * length that subtracting one from the other is a March-morning bug. */
  const broken = stageActors([manifest('Alpha', [['S1', 'not-a-date', 'buses-29']])], { now: NOW, windowDays: 30 });
  check('an unparseable `at` is dropped, not guessed from the run id', broken.runs === 0 && broken.attributed === 0);
  check('and a future-dated run is outside the window too, rather than silently counted', stageActors([manifest('A', [['S1', '2027-01-01T09:00', 'buses-29']])], { now: NOW, windowDays: 30 }).runs === 0);
}

console.log('\n6. An estate that cannot be read says so, and is not an estate with no touches');
{
  const gone = stageActors(null, { now: NOW, windowDays: 30 });
  check('a tree with no maps in it is `no-tree`', gone.status === 'no-tree');
  check('and so is a caller that supplied no manifests at all — a stub, not an empty estate', stageActors(undefined, { now: NOW }).status === 'no-tree');
  check('and its refusal says it consulted no manifest, rather than reporting zero', /not a count of zero/.test(actorWhy(gone)), actorWhy(gone));

  const unparseable = stageActors([{ name: 'Alpha', kind: 'area', town: null, dir: 'x', manifest: null }], { now: NOW, windowDays: 30 });
  check('a manifest that would not parse contributes nothing and does not throw', unparseable.status === 'ok' && unparseable.runs === 0);

  const empty = stageActors([], { now: NOW, windowDays: 30 });
  check('an estate with no runs at all is a real answer, not an error', empty.status === 'ok' && empty.runs === 0);
  check('and its sentence says nothing was committed, which is different from nothing being named', /nothing to attribute/.test(actorWhy(empty)), actorWhy(empty));
}

console.log('\n7. `runsOf` reads the manifest shape stage.js actually writes');
{
  const rows = runsOf(manifest('Alpha', [['S1', RECENT, 'buses-29'], ['S6', RECENT, 'sched-1252']]).manifest);
  check('every stage is walked, S6 included', rows.length === 2 && rows.some((r) => r.stage === 'S6'));
  check('the actor travels with the row', rows.find((r) => r.stage === 'S6').by === 'sched-1252');
  check('a manifest with no `stages` key at all yields nothing rather than throwing', runsOf({}).length === 0);
  check('and so does one that is not an object', runsOf(null).length === 0);
}

console.log('');
if (bad) {
  console.log(`FAILED — ${bad} of ${ran} assertions did not hold: who performed a stage is not what stage_actors.mjs says it is.`);
  process.exitCode = 1;
} else {
  console.log(`OK — all ${ran} assertions held: a tick is told from a person-started session by the loop's own prefix test, a touch is counted only where somebody recorded one, an unattributed run reads as NOT RECORDED and never as zero, the denominator counts only maps with attributed work so standing still cannot improve the rate, the window is measured off the UTC commit instant rather than the local run id, and an estate nobody could read says so.`);
}
