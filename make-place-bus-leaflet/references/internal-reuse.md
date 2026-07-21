# Internal close-up — reusing `gen_internal.js` unchanged (`build_internal_place.js`)

The internal map is the town skill's `gen_internal.js` **run verbatim**, the same way
`schematize_internal.js` / `diagram_internal.js` reuse it: a place-side wrapper prepares
the working directory, runs the shared generator, and post-processes only the one thing
it can't express (the title).

## Why it works with zero renderer changes
`gen_internal.js` **auto-fits to the bounding box of the stops present** in
`routes_intown_atco.json` (in classic mode, the fit set = every stop in every drawn
route). So feeding it a **walkshed-clipped** `routes_intown_atco.json` (from
`derive_walkshed.js`) is what produces the tight zoom — there is no radius/clip knob in
the renderer, and none is needed. This is exactly the mechanism the schematic/diagram
engines rely on; we just clip by distance-from-a-point instead of by locality prefix.

## Two internal styles
**Road-following (default, `build_internal_place_roads.js`)** — the place `routes.json`
carries `"internalRoads": true`, so gen_internal draws lines that trace the street
network (see the road-following section below). This is now the standard build.

**Classic (fallback, `build_internal_place.js`)** — the place `routes.json` **omits
`internalRoads`**, so route lines are drawn straight between stops from `atco2ll.json` —
no `pull_roads.js`/`match_routes.js`/OSM road pipeline. Cheaper, offline; keep it only for
places too sparse to map-match (a single served stop → `match_routes` skips → no line, so
straight chords are all you can draw).

## Files the wrapper needs in the run dir
Required by `gen_internal.js` (hard-parsed): `routes.json`, `atco2ll.json`,
`atco2name.json`, `routes_intown_atco.json`, **`osm.json`**, **`osm2.json`**,
**`river_geo.json`**. The wrapper writes empty stubs for the last three if absent
(`{"elements":[]}`, `{"elements":[]}`, `[]`) so a POI-less place still renders.

## The title fix
`gen_internal.js` hardcodes the title `Buses within <RJ.town>`. The wrapper runs the
generator, then string-replaces that exact emitted token with `RJ.placeTitle` (or
`Buses serving <RJ.placeShort|place>`). So set `RJ.town` to any short phrase (it only
seeds the token to match) and `RJ.placeTitle` to the real title. The town generator is
never edited.

## Command
```bash
TSK="C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets" \
  node "C:/u3a St Ives/.claude/skills/make-place-bus-leaflet/assets/build_internal_place.js"
```
Runs `gen_internal.js` with `cwd` = run dir and `LEAFLET_DIR`/`SKILL_ASSETS` set so it
reads the run dir and resolves `icons.js`. Writes `internal.svg`.

## Road-following internal (Phase 2 — SHIPPED 2026-07-21, `build_internal_place_roads.js`)
Reuses the town skill's `internalRoads` model with **zero new drawing code**. The wrapper:
1. runs `%TSK%/pull_roads.js [marginKm]` → `roads_geo.json` (OSM road graph; bbox sized
   from the walkshed-clipped `routes_intown_atco.json` + margin, default 0.6 km);
2. runs `%TSK%/match_routes.js` → `routes_paths.json` (map-matches each route's canonical
   chain onto the graph, Dijkstra between consecutive in-bbox stops);
3. ensures `routes.json` has `internalRoads` (defaults it to `true` in the build-dir copy
   if the config omitted it — prefer declaring it in the S3 config for reproducibility);
4. delegates to `build_internal_place.js` for the gen_internal run + title fix, so the two
   variants stay DRY.

**Why the place data needs no reshaping:** `match_routes.js` reads
`FULL[r].canonical[0].stops` (line ~115) — exactly the shape `gtfs_chains.py` writes for a
place (`{directions, canonical:[{name,stops}], all}`). The town skill and the place skill
share this full-chain format, so the map-matcher is drop-in.

**Place fit fix (automatic):** the town engine fits internalRoads to stops sharing the
anchor's ATCO locality prefix. A place walkshed routinely spans several localities, so
`build_internal_place_roads.js` injects `internalRoads.fitExtra` = all drawn stops (from
`routes_intown_atco.json`) and defaults `fitMargin` to 8 mm — the map then frames the whole
close-up instead of one locality's stops. Both are overridable in the S3 config.

**Orphan-river fix (automatic):** with no `features` config gen_internal draws a default
"River Great Ouse" label. `build_internal_place.js` suppresses it via a merged
`overrides.json` `features.river.hide` when the walkshed has no river geometry and no
declared features. See `references/gotchas.md` for both, plus the `overrides.json` viewport
nudge used to sit a map lower on the page.

**Version-stamp gotcha:** gen_internal stamps `· Map v<version>` and prefixes its own `v`.
The place `routes.json` stores `version:"v1.0"` (leading `v`), which would render `Map vv1.0`.
The wrapper strips the leading `v` when passing `LEAFLET_VERSION`, so it reads `Map v1.0`.
Bump the `version` field alongside the S4 folder version so folder and stamp agree.

**Command**
```bash
TSK="C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets" \
  node "C:/u3a St Ives/.claude/skills/make-place-bus-leaflet/assets/build_internal_place_roads.js" [marginKm]
```
Needs in the run dir (pulled from S2): `routes.json`, `atco2ll.json`, `atco2name.json`,
`routes_intown_atco.json`, **`routes_full_atco.json`**, and the osm/river stubs. Writes
`roads_geo.json`, `routes_paths.json`, `internal.svg`.

**Validated:** Tesco Extra v1.1 (sparse — dramatic improvement over classic chords) and
St Neots Town Centre v1.1 (dense — also better, no regression). Both matched every route
with **zero map-match fallbacks**; a single-stop route (69 at Tesco) is correctly skipped
(no line, still listed in the Services panel).

## Not pursued (Phase-2 alternative)
A **stops-emphasis renderer** (de-emphasise lines, foreground each stop as a labelled
marker with route badges — "stand here for the 18") was the other option for genuinely
single-stop places. Road-following covered the real cases, so this stays unbuilt; revisit
only if a place has one stop and road-following therefore draws no line.
