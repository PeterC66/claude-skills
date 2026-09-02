/*
 * internal_roads_config.js — the ONE reading of routes.json's `internalRoads`.
 *
 * CONTRACT. `internalRoadsConfig(RJ)` returns null when `internalRoads` is
 * exactly `false` — the CLASSIC model, straight chords and no road graph — and
 * otherwise the roads-model config with every default filled in: an absent key
 * and `true` both mean the standard object (DEFAULT ON since 2026-08-04), and an
 * object is merged OVER the defaults, `focus` one level down. It reads no files
 * and writes nothing.
 *
 * WHY THIS FILE EXISTS (OA-230, 2026-09-02; engine F6 of the 2026-09-01 review).
 * gen_internal.js defaulted nine keys and treated an absent key as "on";
 * diagram_internal.js and schematize_internal.js each carried a second reading
 * that defaulted three (stroke, gap, focus) and REFUSED an absent key with exit 1,
 * so the pre-stages disagreed with the generator they exist to feed about what a
 * town with no `internalRoads` block meant. The disagreement was dark on the
 * estate — every schematic town writes the block — which is exactly the kind of
 * divergence that ships one day as a sheet nobody asked for. Three readings are
 * one, and the pre-stages' guard asks the question the generator asks: `false`
 * refuses, because there is no road graph to schematize.
 *
 * IT IS IN THE ENGINE HASH, through gen_internal.js, so a changed default moves
 * every town's stamp — which is right, because a changed default moves ink.
 */
'use strict';

/* gap >= stroke + ~1 mm so bundled lanes read separately (gen_internal.js's header). */
const IR_DEFAULTS = Object.freeze({ stroke: 1.7, gap: 2.8, skeleton: '#e4e4e4', skeletonPad: 1.3,
  contextRoads: true, contextColor: '#f0f0f0', contextWidth: 0.45,
  roadLabelMax: 12, badgeEvery: 70 });
const FOCUS_DEFAULTS = Object.freeze({ coreKm: 1.1, comp: 0.5 });

/* A FOUR-LANE DEFAULT WAS TRIED HERE ON 2026-08-24 AND MEASURED WRONG. Peter asked
 * whether the 2026-08-23 casing ceiling was "in the engine yet" — it was, but absent on
 * every map, so it had never drawn anything. `3*gap + stroke + skeletonPad` = 11.4 mm
 * looked like the obvious default, and on St Ives it is right: 7 segments of 756 clamp,
 * all of them the short round-capped junction stubs that fuse into the grey lobe, and
 * the crop is plainly better. It is wrong everywhere else. Beaconsfield clamps 235 of
 * 897, and they are not stubs — 47 consecutive segments of Station Road carry six real
 * parallel lanes for the length of the street, 46 of Amersham Road carry five, and
 * capping those puts coloured ribbon OUTSIDE the grey along whole corridors. High
 * Wycombe clamps 149, Wisbech 142, March 113.
 *
 * So the ceiling is genuinely per-map and has to be set from that map's own measured
 * distribution — the widest LONG run, not a lane count. `DBG_CASE=2 node gen_internal.js`
 * prints one line per segment (road name, bundle size, drawn lanes, width) and is how
 * the numbers above were got. Left absent here on purpose: an engine default that is
 * right for one town in eight is worse than no default, because it ships as correct.
 * Recorded in Development Docs/review-triage_2026-08-24.md, item 2. */

function internalRoadsConfig(RJ) {
  const raw = RJ ? RJ.internalRoads : undefined;
  if (raw === false) return null;
  const u = (raw && raw !== true) ? raw : {};
  const o = Object.assign({}, IR_DEFAULTS, u);
  o.focus = Object.assign({}, FOCUS_DEFAULTS, u.focus || {});
  return o;
}

module.exports = { IR_DEFAULTS, FOCUS_DEFAULTS, internalRoadsConfig };
