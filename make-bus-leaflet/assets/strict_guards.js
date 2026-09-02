/*
 * strict_guards.js — the STRICT_GUARDS contract, shared by every generator.
 *
 * CONTRACT. A guard that REFUSES to draw something the config asked for calls
 * `refuse(msg)`: the message goes to stderr and the refusal is COUNTED, not
 * thrown, so one run reports every refusal rather than only the first and the
 * artwork is still written — a build that declined something is worth LOOKING
 * at, it is just not worth publishing. At the end of the run the generator
 * calls `report(tail)`, which writes the summary banner and returns true when
 * the run must fail. The CALLER owns the exit, because the two generators end
 * differently on purpose: gen_internal.js sets `process.exitCode` so buffered
 * stdout still flushes, gen_boarding.js calls `process.exit`.
 *
 * WHY THE FLAG. Unset, this is inert: `refuse` still prints, `report` returns
 * false, and every existing caller behaves exactly as it did. It is behind a
 * flag because the byte-identical reproduce gate re-runs the generators over
 * committed fixtures and some of those legitimately carry warnings; a generator
 * that started failing on them would turn that gate red on day one, which is
 * the surest way to get a check muted.
 *
 * WHY IT IS THE EXIT CODE AT ALL. A refusal used to exit 0 — from the process's
 * point of view it succeeded, because declining was the decision. The sheet is
 * wrong and nothing on it says so; only stderr does. rollout.js learned to read
 * that stream on 2026-08-18 and found 21 blocking warnings across 7 of 13 maps.
 * The portal never learned: renderMap.js reads stderr only when the exit status
 * is non-zero, so on the success path — the only path that matters here — the
 * whole stream is discarded unread, and those are the bytes that go public.
 * Making the refusal itself the exit code means every spawn path, present and
 * future, catches it through the error handling it already has.
 *
 * THE STREAM AND EXIT-CODE CONTRACT, in words (OA-230, 2026-09-02; engine F13 and
 * F14 of the codebase review). It was implied by this file and stated nowhere,
 * while the two pre-stages inverted it (progress on stdout, 21 lines to 4) and
 * the portal read stderr only on a non-zero exit. Every generator, the two
 * pre-stages included:
 *
 *   stdout   progress and results for a person reading the run -- counts, what
 *            was written where. A caller may discard it.
 *   stderr   anything a caller must READ: refusals, build warnings, labels that
 *            could not be placed. It is written on a ZERO exit too, so a caller
 *            that reads stderr only on failure has already lost the "must show"
 *            that did not fit.
 *   exit 0   the sheet was written -- or, for a pre-stage whose routes.json does
 *            not opt in (no internalSchematic / internalDiagram), nothing was
 *            asked for: it says so on stdout and writes nothing. That is not a
 *            failure and must not be reported as one.
 *   exit 1   the run failed, or refused under STRICT_GUARDS; the reason is on
 *            stderr. A pre-stage asked to run on the classic model
 *            (internalRoads:false) exits 1: there is no road graph to draw.
 *   exit 2   the invocation was wrong: a missing input, a layout the config asks
 *            for that cannot be drawn at the type floor.
 *   exit 3   gen_boarding.js only: the boarding plan is not configured, or the
 *            stands cannot be named honestly -- declining, not failing.
 *
 * These are the codes references/conventions.md gives every script here; the
 * generators earn the 1-against-2 distinction like everything else.
 *
 * Extracted verbatim from gen_internal.js and gen_boarding.js on 2026-08-27
 * (OA-129 Phase 3). The two copies had drifted only in the wording of the final
 * sentence, which is why `report` takes it as an argument.
 */
'use strict';

const NL = String.fromCharCode(10);

/** True when the caller asked for refusals to be fatal. Read once, at load. */
// DARK, measured 2026-08-27, in the only sense that matters here: 40 runs, both
// generators against all 20 maps with STRICT_GUARDS=1, and NOT ONE MAP REFUSES
// ANYTHING. That is the estate being clean rather than the contract being unused,
// but it does mean no byte gate and no build exercises the refusal path — the
// extraction that created this file was certified by a FORCED refusal (a
// features[] entry keyed at geometry that does not exist), fired identically
// before and after. Do the same after any change here: a guard nobody has seen
// fire is not a guard.
const STRICT_GUARDS = process.env.STRICT_GUARDS === '1';

let count = 0;

/** Record one refusal and say so on stderr. Never throws, never exits. */
function refuse(msg) {
  count++;
  let t = String(msg);
  while (t.length && t.charAt(t.length - 1) === NL) t = t.slice(0, -1);
  process.stderr.write(t + NL);
}

/** How many refusals this run has recorded. */
function refusals() { return count; }

/**
 * Write the summary banner if this run refused anything under STRICT_GUARDS.
 * `tail` is the generator's own closing sentence, without a leading space.
 * Returns true when the caller should fail the run.
 */
function report(tail) {
  if (!(STRICT_GUARDS && count > 0)) return false;
  process.stderr.write('STRICT_GUARDS: ' + count + ' guard'
    + (count === 1 ? '' : 's') + ' ' + tail + NL);
  return true;
}

module.exports = { STRICT_GUARDS, NL, refuse, refusals, report };
