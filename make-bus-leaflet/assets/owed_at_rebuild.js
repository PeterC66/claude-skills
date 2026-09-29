'use strict';
/*
 * owed_at_rebuild.js — what a map's next rebuild owes to its S3, said out loud.
 *
 * WHY THIS EXISTS (buses-data OA-074 and OA-082, 2026-09-27). On 2026-09-25 Peter
 * ruled that three changes are made "at each map's next rebuild" rather than in a
 * round of their own: recolour a pair of route hues that read alike (OA-071), adopt
 * Ely Co-op's road casing on every town (OA-074), and give each delivered place map
 * its town's route colours (OA-082). All three are edits to S3's routes.json.
 *
 * Neither rebuild path makes them by itself. A ROLLOUT carries S3 unchanged by design,
 * so it can never make one. A FULL rebuild writes a new S3 from the old one, so it
 * makes one only if the session building it has read the row — and on 2026-09-27 St
 * Ives (v6.84) and St Neots (v5.0) were both rebuilt from a new S3, neither took the
 * casing, and St Neots still carried both of its alike-hue pairs. A ruling that waits
 * on somebody remembering it is not applied; it is applied when the rebuild says so.
 *
 * So both paths ask this file: the rollouts print its lines beside HUES ALIKE, and
 * stage.js prints them when an S3 is committed (and HUES ALIKE when an S4 is), which
 * is the moment the session is still in S3 and can act. Reported, NEVER gating: a
 * rebuild made for another reason must not be refused for owing one of these.
 *
 * Kept outside the engine hash, like cli.js: no generator requires it, so adding it
 * moves no map to STALE. seed_palette.js is required lazily, and only for a place.
 */
const fs = require('fs');
const path = require('path');

/* OA-074. The casing Ely Co-op v1.2 adopted on 2026-08-21, which eleven of the place
 * maps carry and no town did on 2026-09-24. */
const CASING = Object.freeze({ stroke: 2, gap: 2.6, skeletonPad: 0.9 });

/* OA-074 exemptions, by Peter's ruling, keyed by the town's folder under `Areas/`. A town
 * here keeps its own casing and is never told it owes Ely's.
 *   St Ives (Peter, 2026-09-29): its hand-tuned stroke 1.7 / gap 2.8 stays. The v6.89 vs
 *   v6.90 crop showed no visible gain from Ely's values, and Westfield Junior moved onto
 *   the A/B ink and lost its A badge, and Houghton Road moved onto ink. */
const CASING_EXEMPT = Object.freeze(new Set(['St Ives']));

/* A place map lives under a `Places` folder, as engine_version.js's isPlaceRun has it. */
const isPlace = (dir) => path.resolve(dir).split(/[\\/]+/).includes('Places');

/* The town a town map is, when `mapDir` is `Areas/<Town>`; null for anything else. */
function areaTown(mapDir) {
  const p = path.resolve(mapDir);
  return path.basename(path.dirname(p)) === 'Areas' ? path.basename(p) : null;
}

/** OA-074: a TOWN whose routes.json draws road casing without Ely's three values. A
 *  place is not asked (eleven carry it already); nor is a town with no
 *  `internalRoads` block, which draws no casing to change; nor a town Peter exempted. */
function casingOwed(mapDir, RJ) {
  if (isPlace(mapDir)) return null;
  if (CASING_EXEMPT.has(areaTown(mapDir))) return null;
  const IR = RJ && RJ.internalRoads;
  if (!IR || typeof IR !== 'object') return null;
  const off = Object.keys(CASING).filter((k) => IR[k] !== CASING[k]);
  if (!off.length) return null;
  const now = Object.keys(CASING).map((k) => (IR[k] === undefined ? 'default' : IR[k])).join(' / ');
  return `road casing stroke / gap / skeletonPad is ${now}, owed ${Object.values(CASING).join(' / ')} in internalRoads `
    + `(buses-data OA-074; Peter, 2026-09-25: at this town's next rebuild, moved ink judged in the crop review)`;
}

/** OA-082: a PLACE under Areas/<Town>/Places/ whose palette seed_palette.js would
 *  change. A standalone place has no town to follow, and a town is not asked. */
function paletteOwed(mapDir, RJ) {
  if (!isPlace(mapDir) || !RJ || !RJ.palette || !Object.keys(RJ.palette).length) return null;
  let seed;
  // The place skill's assets, found the way engine_version.js finds them.
  const psk = process.env.PLACE_SKILL_ASSETS || path.join(__dirname, '..', '..', 'make-place-bus-leaflet', 'assets');
  try { seed = require(path.join(psk, 'seed_palette.js')); }
  catch { return null; }
  const townDir = seed.parentTownDir(mapDir);
  if (!townDir) return null;
  const src = seed.townRoutesPath(townDir);
  if (!src) return null;
  let town;
  try { town = JSON.parse(fs.readFileSync(src.path, 'utf8')); } catch { return null; }
  const out = seed.seedPalette(RJ, town);
  const moves = out.changes.filter((c) => String(c.from).toUpperCase() !== String(c.to).toUpperCase());
  if (!moves.length) return null;
  return `${moves.length} route colour(s) differ from ${path.basename(townDir)}'s: `
    + moves.map((c) => `${c.route} ${c.from} -> ${c.to}`).join(', ')
    + ` (buses-data OA-082; Peter, 2026-09-25: at this place's next refresh, by seed_palette.js --apply in its S3)`;
}

/** Every line owed, for the map at `mapDir` configured by `RJ` (its S3 routes.json). */
function owedLines(mapDir, RJ) {
  return [casingOwed(mapDir, RJ), paletteOwed(mapDir, RJ)].filter(Boolean);
}

module.exports = { owedLines, casingOwed, paletteOwed, CASING, CASING_EXEMPT };
