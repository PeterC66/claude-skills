/*
 * pin_clock.js — is this map behind the engine the ESTATE has adopted? (buses-data OA-574, item A1
 * of the process simplification review of 2026-10-06.)
 *
 * THE CLOCK WAS THE LIVE TEMPLATE, AND IT RAN FASTER THAN ANYONE COULD FOLLOW. status.js and the
 * worklist asked a map "does your `routes.json.engine` equal the template hash computed from the
 * checkout right now?", so every engine commit that touched a hashed file made every map engine-stale
 * and the worklist raised one rebuild row per map. In a month that was 171 engine commits, 26 pin
 * moves, and 73 of 254 map commits that were a re-stamp or a pin-adoption rebuild; most of them moved
 * two footer lines and nothing else. `engine.lock.json` already says which engine the estate has
 * ADOPTED (OA-398, OA-430), and CI judges the portal against it, so there were three clocks and the
 * fastest one set the work.
 *
 * NOW THE PIN IS THE CLOCK. A map is judged against the pinned engine, which moves when somebody runs
 * `engine-pin.mjs --bump` and not when somebody merges a pull request. The answer has five values:
 *
 *   unstamped  — no engine hash in the build at all; judged elsewhere, never "behind".
 *   current    — drawn by the pinned engine.
 *   ahead      — drawn by today's engine, which the pin has not adopted yet. Not behind anything: it
 *                becomes behind only if the pin later moves to something else.
 *   stamp-only — behind the pin, but the weekly shadow rebuild (OA-485) dry-ran the pinned engine over
 *                it AFTER it was built and said STAMP-STALE: every sheet reproduces byte for byte and
 *                only the stamp is old. That is not work, so it is not a row. The byte gate at the
 *                map's own `engineCommit` is untouched and still judges the sheets.
 *   behind     — behind the pin and nobody has shown the rebuild to be stamp-only: a rebuild is owed.
 *
 * WHAT THE SHADOW EVIDENCE MUST BE, TO COUNT. A written claim about a join is only as good as the
 * join, so a STAMP-STALE verdict excuses a map only when (a) the shadow ran on exactly the engine the
 * clock names, (b) it ran after the map was built, and (c) it named the map. Any of the three missing
 * is `behind`, the conservative answer, and the dry run the row already prescribes will say it again.
 *
 * NO PIN, NO CHANGE IN KIND. An estate with no readable `engine.lock.json` (a fixture repository, a
 * scratch estate) is judged against the live template as before: `pin` is null and the clock falls
 * back to it.
 *
 * Pure reads of two files; no git, no network, no clock.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/* { commit, engine, placeEngine } from engine.lock.json, or null when there is no readable pin. */
function readPin(buses) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(buses, 'engine.lock.json'), 'utf8'));
    const str = (v) => (typeof v === 'string' && v ? v : null);
    if (!str(lock.engine) && !str(lock.placeEngine)) return null;
    return { commit: str(lock.commit), engine: str(lock.engine), placeEngine: str(lock.placeEngine) };
  } catch { return null; }
}

/* The shadow rebuild's stamp, reduced to what the clock needs, or null when absent or unreadable
 * (never an exception: the board must not die because a loop file is half-written). */
function readShadow(buses) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(buses, 'loop', 'shadow-rebuild.json'), 'utf8'));
    const ranAtMs = Date.parse(s.ranAt);
    if (!Number.isFinite(ranAtMs) || !s.towns || !s.places) return null;
    const half = (h) => ({
      engine: typeof h.engine === 'string' ? h.engine : null,
      status: new Map((Array.isArray(h.maps) ? h.maps : []).map((m) => [m.name, m.status])),
    });
    return { ranAtMs, town: half(s.towns), place: half(s.places) };
  } catch { return null; }
}

/*
 * kind     'town' | 'place'
 * name     the map's name, as the shadow report keys it
 * mapEngine  the `engine` the map's own routes.json records
 * builtAt  the S4 run's ISO `at`
 * live     the template hash of the checkout asking
 * pin      readPin()'s `engine` or `placeEngine` for this kind, or null
 * shadow   readShadow(), or null
 * strict   true for the one map that must equal the pin exactly (the portal's area-fixture town,
 *          fixture_donor.js, OA-532): no `ahead`, no `stamp-only`
 */
function standing({ kind, name, mapEngine, builtAt, live, pin, shadow, strict = false }) {
  if (!mapEngine || mapEngine === '(none)') return 'unstamped';
  const clock = pin || live;
  if (mapEngine === clock) return 'current';
  if (strict) return 'behind';
  if (live && mapEngine === live) return 'ahead';
  const half = shadow && shadow[kind];
  const builtMs = Date.parse(builtAt);
  if (half && half.engine && half.engine === clock && Number.isFinite(builtMs) && builtMs <= shadow.ranAtMs
    && half.status.get(name) === 'STAMP-STALE') return 'stamp-only';
  return 'behind';
}

module.exports = { readPin, readShadow, standing };
