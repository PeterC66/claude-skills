/*
 * stage_actors.mjs — who performed the work, read off the manifests
 * (buses-data OA-427, item 3 of R9 of the process review of 2026-09-17).
 *
 * WHAT IT IS FOR. *Human touches per map-month* is the number R9 is judged on,
 * and `routine_numbers.mjs` has printed a refusal in its place since the day it
 * was written: git says "Peter Cooper" for a commit Peter made and for a commit a
 * session made in his name, so no count over the repository can separate them.
 * OA-427 put the distinction where it is actually known — `stage.js commit --by
 * <who>` writes `by` onto the run record at the moment the stage is committed —
 * and this module is the reader that turns those records into the number.
 *
 * A STAGE IS THE RIGHT UNIT, and that is a claim worth stating rather than
 * assuming. A commit is not: one commit can carry six stages or none, and the
 * bulk of a map's cost never reaches git at all, because S4, S5, S6 and `_latest/`
 * are gitignored. A stage is exactly one span of work with one performer, which is
 * why `stage.js` already records its clock and its tokens there.
 *
 * THE VOCABULARY IS THE LOOP'S AND NOTHING HERE INVENTS ONE. A tick is
 * `sched-HHMM` — in the scheduled task, in the claim it writes into an action's
 * front matter, and in `loop/LOCK.d/holder`, whose steal rule is exactly "does the
 * first line start with `sched-`". So `actorKind()` asks the same question the lock
 * asks, and any other name is a session a person started. `stage.js` records the
 * string and refuses to interpret it; the interpretation lives here, in one place,
 * where changing it changes no manifest.
 *
 * WHAT A PERSON-STARTED SESSION COSTS, AND WHY IT COUNTS AS A TOUCH. R9's target
 * is that Peter's part falls to "the sign-off on printed changes and the answers
 * only a person can give". A session he started to build a map is a touch by that
 * measure even though he did not type the commands: it did not happen unless he
 * began it. A tick is not, because nothing began it but the clock.
 *
 * THE DENOMINATOR IS THE DANGEROUS HALF OF THIS FILE. A rate over every map on
 * disk would count as zero every map nobody has touched since the window opened,
 * and would fall reliably towards the target as the estate grew and the work stood
 * still — a metric that improves by doing nothing is worse than none. So the
 * denominator is map-months of ATTRIBUTED work: a map contributes only where it
 * has at least one run in the window carrying an actor, and a map nobody recorded
 * contributes to neither half.
 *
 * AND THE RATE DESCRIBES ATTRIBUTED RUNS ALONE, which is why `coverage` is
 * returned beside it and never omitted. On the day this landed, coverage over the
 * estate was ZERO — no run on disk carried `by`, because the flag did not exist
 * when any of them was committed — so the number is not measured yet and says so
 * with a figure rather than with a paragraph. That is the improvement: the refusal
 * it replaces could not tell "nobody has recorded this" from "nobody can".
 *
 * PURE CORE, INJECTED EDGE, like `refresh_grades.mjs` and `bods_scan.mjs`:
 * `defaultReadManifests` is the only thing that touches the disk and hands back
 * parsed manifests, and `stageActors()` is a function of those and a clock — so the
 * harness can falsify an empty estate, an unparseable manifest, a window boundary
 * and every mix of actors with no `Areas/` folder at all.
 *
 * Zero dependencies (Node core only), matching worklist.mjs.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** The stages a run record can sit under. `stage.js`'s own STAGE_NAME keys. */
export const STAGES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

/**
 * What kind of actor a `by` string names: 'loop', 'session' or 'unrecorded'.
 *
 * THE TEST IS THE LOCK'S, deliberately. `loop/LOCK.d/holder` decides whether a
 * lock may be stolen by asking whether its first line starts with `sched-`, and a
 * second, subtly different rule for the same distinction is how two copies drift.
 */
export function actorKind(by) {
  const s = String(by == null ? '' : by).trim();
  if (!s) return 'unrecorded';
  return /^sched-/i.test(s) ? 'loop' : 'session';
}

/**
 * Every map's manifest, as `[{ name, kind, town, dir, manifest }]`, or `null` when
 * this tree carries no `Areas/` at all (a CI runner, a fixture, a wrong path).
 *
 * THE ENUMERATION IS BORROWED AND NOT REWRITTEN. `gate_lib.js`'s `findTowns` and
 * `findPlaces` already know the three shapes a map takes on disk — `Areas/<Town>`,
 * `Areas/<Town>/Places/<Place>` and `Places/_standalone/<Place>` — and `worklist.mjs`
 * calls exactly those. A fourth copy of that rule here is the shape this project
 * files under *look for the helper before you build it*, and the last time two
 * copies of one rule were allowed to stand, one of them was silently wrong for a
 * fortnight.
 */
export const defaultReadManifests = ({ busesDir, skillsAssets }) => {
  if (!busesDir || !existsSync(path.join(busesDir, 'Areas'))) return null;
  if (!skillsAssets || !existsSync(path.join(skillsAssets, 'gate_lib.js'))) return null;
  const { findTowns, findPlaces, readJson } = require(path.join(skillsAssets, 'gate_lib.js'));
  const towns = findTowns(busesDir);
  const rows = [
    ...towns.map((t) => ({ name: t.name, kind: 'area', town: null, dir: t.dir })),
    ...findPlaces(towns).map((p) => ({ name: p.name, kind: 'place', town: p.town || null, dir: p.dir })),
  ];
  /* READ THROUGH `gate_lib`'s `readJson` AND NOT INLINE. `worklist.mjs` reads every
   * manifest that way, and the engine package carries a census test asserting that
   * nothing re-implements `JSON.parse(readFileSync(<dir>/manifest.json))` — a rule
   * that exists because several files once did, and one of them was wrong. The
   * `catch` stays: a manifest that will not parse contributes nothing here, because
   * a reader of ACTORS is not the right place to refuse a broken map. */
  return rows.map((r) => {
    let manifest = null;
    try { manifest = readJson(path.join(r.dir, 'manifest.json')); } catch { manifest = null; }
    return { ...r, manifest };
  });
};

/**
 * Flatten one manifest into its committed run records, as
 * `[{ stage, id, at, by, kind, elapsedMin, tokens }]`.
 *
 * `at` IS THE COMMIT INSTANT AND THE RUN ID IS NOT USED FOR IT. `stage.js` writes
 * the id from LOCAL time and `at` from UTC, and it says at length in its own
 * comments that subtracting one from the other is a daylight-saving bug waiting for
 * a March morning. A window test is a subtraction, so it uses `at` alone and drops
 * a record whose `at` will not parse rather than guessing from the folder name.
 */
export function runsOf(manifest) {
  const out = [];
  const stages = (manifest && manifest.stages) || {};
  for (const st of STAGES) {
    const runs = (stages[st] && Array.isArray(stages[st].runs)) ? stages[st].runs : [];
    for (const r of runs) {
      const t = Date.parse(String(r.at || '') + ':00Z');   // isoNow() is 'YYYY-MM-DDTHH:MM', UTC
      if (!Number.isFinite(t)) continue;
      out.push({
        stage: st, id: r.id, at: r.at, ms: t,
        by: r.by == null ? null : String(r.by),
        kind: actorKind(r.by),
        elapsedMin: r.elapsedMin == null ? null : r.elapsedMin,
        tokens: r.tokens == null ? null : r.tokens,
      });
    }
  }
  return out;
}

/**
 * The actor picture over a window, from `defaultReadManifests()`'s output.
 *
 * Returns `{ status, windowDays, runs, attributed, byPerson, byLoop, coverage,
 * mapsAttributed, perMapMonth, maps }`. `status` is 'no-tree' when the reader
 * could not enumerate anything, and 'ok' otherwise — including for an estate with
 * no runs at all, which is a real answer and not an error.
 */
export function stageActors(manifests, { now = Date.now(), windowDays = 30 } = {}) {
  /* ANYTHING THAT IS NOT A LIST OF MANIFESTS IS `no-tree`, not a crash and not an
   * empty estate. `defaultReadManifests` returns null for a tree with no `Areas/`,
   * and a caller assembling a facts object by hand — every stub in the harnesses —
   * leaves the field off entirely. Both mean the same thing to a reader: nothing was
   * consulted. Reporting that as zero touches is the one failure this file exists to
   * prevent, so the guard is on the SHAPE rather than on `null` alone. */
  if (!Array.isArray(manifests)) return { status: 'no-tree', windowDays };
  const since = now - windowDays * 86400000;
  const maps = [];
  let runs = 0, attributed = 0, byPerson = 0, byLoop = 0;
  for (const m of manifests) {
    const inWindow = runsOf(m.manifest).filter((r) => r.ms >= since && r.ms <= now);
    const att = inWindow.filter((r) => r.kind !== 'unrecorded');
    const person = att.filter((r) => r.kind === 'session');
    runs += inWindow.length;
    attributed += att.length;
    byPerson += person.length;
    byLoop += att.length - person.length;
    if (inWindow.length) {
      maps.push({
        name: m.name, kind: m.kind, town: m.town,
        runs: inWindow.length, attributed: att.length,
        byPerson: person.length, byLoop: att.length - person.length,
      });
    }
  }
  /* THE DENOMINATOR, AND THE ONE LINE THAT KEEPS IT HONEST. Only maps with
   * attributed work in the window are map-months; a map with runs nobody named
   * contributes to neither half, so an estate that stops recording shrinks the
   * denominator instead of quietly improving the rate. */
  const mapsAttributed = maps.filter((x) => x.attributed > 0).length;
  const mapMonths = mapsAttributed * (windowDays / 30);
  return {
    status: 'ok', windowDays,
    runs, attributed, byPerson, byLoop,
    coverage: runs ? attributed / runs : null,
    mapsAttributed,
    perMapMonth: mapMonths > 0 ? byPerson / mapMonths : null,
    maps: maps.sort((a, b) => b.runs - a.runs || (a.name < b.name ? -1 : 1)),
  };
}

/**
 * The sentence that says why the number is not there yet, or '' when it is.
 * Kept beside the computation so the refusal and the verdict cannot disagree.
 */
export function actorWhy(a) {
  if (!a || a.status === 'no-tree') {
    return 'No map tree could be read, so no manifest was consulted — this is not a count of zero touches.';
  }
  if (!a.runs) return `No stage was committed in the last ${a.windowDays} days, so there is nothing to attribute.`;
  if (!a.attributed) {
    return `None of the ${a.runs} stage(s) committed in the last ${a.windowDays} days records who performed it. `
      + '`stage.js commit --by <who>` writes that, and every run on disk was committed before the flag existed (OA-427), '
      + 'so this reads as NOT YET RECORDED and never as nobody touched anything.';
  }
  return '';
}
