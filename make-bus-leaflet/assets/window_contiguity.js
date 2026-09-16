'use strict';
/* S-5b: is the DRAWN WINDOW one unbroken run of the chain's IN-TOWN calls?
 * (OA-048's third instrument, measured over the estate on 2026-09-15 before it
 * was written. The measurement is `Development Docs/s6-window-contiguity_2026-09-15.md`
 * in buses-data, and every number below is read off it.)
 *
 * A MODULE, NOT LINES IN verify_report.js. It was written inline first and put
 * that file 178 lines over its line-ratchet ceiling; the OA-001 rule — logic in a
 * module, wiring in the generator — is what the ratchet exists to enforce, and
 * verify_report.js is outside the engine-hash closure, so moving it costs no map
 * its stamp. verify_report.js keeps the require, the call, and the summary block
 * that reports how much of this ran.
 *
 * WHY A FOURTH QUESTION AT ALL. S-5 asks which way a route leaves town, and it
 * can only ask it of a route with two or more out-of-town buffer stops: 26 of 95
 * displayed routes across the eight towns, none at all on March or High Wycombe.
 * Two instruments for widening it were built and measured on 2026-08-29 and both
 * manufactured findings on correct sheets, for one shared reason — both sides of
 * the comparison come from the same chain, so neither can disagree with the
 * other about a DRAWING error. What CAN be wrong is derive_intown's drawn stop
 * set, and this check asks about that instead: not where the road goes, but
 * whether the window we cut out of it has a hole.
 *
 * WHAT IT ASKS. Take one direction of the chain and keep only its IN-TOWN calls
 * — the stops inside the town's own ATCO prefix / extraCore, which is the set
 * derive_intown selects from. Of those, the sheet draws some. Do the drawn ones
 * occupy an unbroken run, or does the sheet draw A and C and skip B?
 *
 * THE THREE NARROWINGS ARE EACH A REJECTED VERSION, AND SAYING SO IS THE POINT.
 *   1. NOT the whole chain, only its in-town calls. Over the whole chain the
 *      check fires on nine routes and every one is correct: derive_intown draws
 *      the in-town stops plus a buffer stop out of town, and the buffer is not
 *      the chain's next stop, so every intermediate village reads as a hole.
 *      Wisbech's EXCEL scores 72. That is the tool working as designed.
 *   2. PER DIRECTION, not over the drawn set as a whole. A town sheet draws both
 *      sides of the road, so the drawn set spans both directions of the chain
 *      and is contiguous in neither. High Wycombe's 27 draws 53 stops, of which
 *      one direction holds 28.
 *   3. Only a direction that draws NEARLY ALL its in-town calls may raise. The
 *      raw any-direction rule yields two findings on the estate today and one of
 *      them is the rule misreading an editorial decision: St Ives' 301 draws 3
 *      of its 23 in-town calls, because the sheet shows a long through route
 *      thinly on purpose, and every one of the other 20 then reads as a hole. A
 *      sheet that draws nearly all its calls and skips three is claiming to be
 *      complete; a sheet that draws an eighth of them is not claiming anything.
 *
 * THE FLOOR IS A JUDGEMENT BOUNDED BY A MEASUREMENT, AND NOT A MEASURED
 * THRESHOLD. The distinction is here because this comment said the other thing
 * first and was wrong in the way this project has a name for. The first version
 * set the floor at 85% on the ground that, across the 77 routes with NO hole,
 * the worst direction's drawn fraction runs 14, 15 … 69, 84 and then 100 fifty-
 * two times, leaving 85–99 empty. That band is real and it is irrelevant: a
 * route with no hole never reaches the floor, because `gappy` has already
 * filtered it out. The floor was measured over a population it cannot touch —
 * *the subject you named yourself*, in Documentation/failure-shape-memories.json.
 *
 * The population it DOES discriminate over is every gappy direction in the
 * estate, and there are TWO of them: High Wycombe's 27 at 28 of 31 (90%, three
 * holes) and St Ives' 301 at 3 of 23 (13%, twenty). Two points 77 apart admit any
 * floor between them and measure none of them. 0.5 is chosen inside that gap and
 * defended in words a reader can disagree with: a sheet drawing at least half a
 * route's in-town calls is showing that route as a local service, and a hole in
 * it is a hole; a sheet drawing an eighth of them is showing a through service,
 * and the other seven eighths are the editorial decision, not a fault.
 *
 * 85% ALSO FAILED A FALSIFICATION, WHICH IS HOW IT WAS CAUGHT. Deleting one
 * middle in-town call from Ramsey route 32's fully-drawn "New Road" direction —
 * six calls, so the hole leaves 5 of 6 — takes completeness to 83% and the check
 * went silent on a genuine single-stop omission. A fraction floor is harshest on
 * exactly the short chains where one missing stop matters most, and no amount of
 * reasoning about the clean population would have shown that.
 *
 * summary.windowCoverage carries `anyDirectionGappy`, the count BEFORE the floor,
 * so the next reader re-measures this over a bigger population instead of
 * trusting the paragraph above.
 *
 * AN EARLIER VERSION OF NARROWING 3 REQUIRED EVERY DIRECTION TO BE GAPPY, AND IT
 * WAS STRUCTURALLY INCAPABLE OF FIRING. A town service that runs a one-way loop
 * calls at a stop in one direction only, so the other direction has no hole to
 * have — and the commonest real defect, a single omitted stop on a one-way pair,
 * was exactly the case it could never reach. Falsified rather than reasoned: with
 * Ramsey's 0500HRAMS009 deleted from the drawn set of route 32, where it sits
 * between two drawn calls, that rule reported no finding at all, because 32's
 * other direction ("Station Road") does not call there and was clean.
 *
 * WHAT IT BUYS. It runs on 79 of the 96 displayed routes, against S-5's 26 —
 * including all seven of March's, a town whose drawn window nothing has ever
 * checked, and including the ten routes whose chain stops where the drawing
 * stops, which no bearing instrument can ever reach. It is green on all eight
 * towns as it stands, so its first red will be a change rather than a backlog.
 *
 * IT DOES NOT REPLACE S-5 and must not be read as covering it. A route drawn the
 * wrong way out of town has a perfectly contiguous window; this check would call
 * it clean, and S-5's HARD on two or more buffer stops is still the only thing
 * that says otherwise. */

/* A direction must draw at least this share of its own in-town calls before a
 * hole in it means anything — see the comment above for why this is a judgement
 * between two measured points rather than a measured threshold, and for the
 * falsification that rejected 0.85. */
const WINDOW_COMPLETENESS_FLOOR = 0.5;

/**
 * Run S-5b over every displayed route. Everything it reads is handed in from
 * verify_report.js — the displayed set, the town's in-town config, the circular
 * set, the three chain accessors and the stop-name map — and every finding goes
 * back through `add`, so the module holds the instrument and none of the report's
 * state. Returns the coverage counts the summary block reports, and
 * `anyDirGappy`, the count before the floor.
 */
function checkDrawnWindow({ displayed, intownCfg, CIRCULAR, intownByNorm, fullEntry, fullDirections, names, add }) {
  const checked = [], unavailable = [], skipped = [];
  let anyDirGappy = 0;
  const corePrefix = intownCfg.prefix || null;
  const extraCore = new Set(intownCfg.extraCore || []);
  const isCore = a => (corePrefix && a.startsWith(corePrefix)) || extraCore.has(a);
  for (const r of displayed) {
    /* A PLACE declares no in-town prefix, so "in-town call" has no meaning there
     * and this check is unavailable by construction — exactly as S-5 is, and
     * counted rather than passed over in silence for the same reason. */
    if (!corePrefix) { skipped.push({ route: r, reason: 'no-intown-prefix' }); continue; }
    if (CIRCULAR.has(r)) { skipped.push({ route: r, reason: 'circular' }); continue; }
    const seq = intownByNorm(r);
    const fe = fullEntry(r);
    if (!fe || !seq || seq.length < 2) {
      skipped.push({ route: r, reason: !fe ? 'no-full-chain' : 'fewer-than-two-drawn-stops' });
      continue;
    }
    const drawn = new Set(seq);
    const per = [];
    /* fullDirections() returns each direction TWICE on most entries — once from
     * `fe.directions` and once from the identical `fe.canonical` — so an
     * un-deduplicated list double-counts every direction and prints each one
     * twice in the evidence. Keyed on the stop list itself, because two entries
     * with the same stops in the same order ARE the same direction. */
    const seenDir = new Set();
    for (const d of fullDirections(fe)) {
      const sig = d.stops.join(',');
      if (seenDir.has(sig)) continue;
      seenDir.add(sig);
      const core = d.stops.filter(isCore);
      const pos = [];
      core.forEach((a, i) => { if (drawn.has(a)) pos.push(i); });
      // One drawn in-town call has no "between" in which to have a hole.
      if (pos.length < 2) continue;
      const gapStops = [];
      for (let i = pos[0]; i <= pos[pos.length - 1]; i++) if (!drawn.has(core[i])) gapStops.push(core[i]);
      per.push({ dir: d.name || null, inTownCalls: core.length, drawnHere: pos.length,
        completeness: +(pos.length / core.length).toFixed(3), gaps: gapStops.length, gapStops });
    }
    if (!per.length) {
      unavailable.push({ route: r, reason: 'fewer-than-two-in-town-calls-drawn-in-any-direction' });
      continue;
    }
    checked.push(r);
    const gappy = per.filter(p => p.gaps > 0);
    if (gappy.length) anyDirGappy++;
    const speaking = gappy.filter(p => p.completeness >= WINDOW_COMPLETENESS_FLOOR);
    if (speaking.length) {
      const worst = speaking.reduce((a, b) => (b.gaps > a.gaps ? b : a));
      const shown = worst.gapStops.slice(0, 8).map(a => names[a] || a);
      add('soft', 'drawn-window',
        `Route ${r}${worst.dir ? ` (${worst.dir})` : ''}: the sheet draws ${worst.drawnHere} of the ${worst.inTownCalls} in-town calls on this chain — ${Math.round(worst.completeness * 100)}%, so it is drawn as a local service rather than a through one — and yet skips ${worst.gaps} that ${worst.gaps === 1 ? 'lies' : 'lie'} BETWEEN two it does draw: ${shown.join(', ')}${worst.gapStops.length > shown.length ? `, and ${worst.gapStops.length - shown.length} more` : ''}. Either ${worst.gaps === 1 ? 'that stop is' : 'those stops are'} not served and S1 is stale, or the drawn window has a hole in it. Read that stretch on _latest/internal.jpg.`,
        { route: r, directions: per, floor: WINDOW_COMPLETENESS_FLOOR }, r);
    }
  }
  return { checked, unavailable, skipped, anyDirGappy, floor: WINDOW_COMPLETENESS_FLOOR };
}

module.exports = { checkDrawnWindow, WINDOW_COMPLETENESS_FLOOR };
