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

## Classic mode (no `internalRoads`)
The place `routes.json` deliberately **omits `internalRoads`**, so route lines are drawn
straight between stops from `atco2ll.json` — no `pull_roads.js`/`match_routes.js`/OSM
road pipeline. Cheaper, offline, and fine where stops are dense.

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

## Phase-2 road-following (the known limitation's fix)
Classic straight lines zigzag for **sparse edge-of-town** places (few stops, far apart —
the Tesco example). Two ways to lift the internal map to the town-map quality, per the
plan's decision #3 ("two variants"):
1. **Reuse `internalRoads`** — give the place a road-skeleton model: run the town skill's
   `pull_roads.js` + `match_routes.js` over the walkshed bbox to produce
   `roads_geo.json` + `routes_paths.json`, add an `internalRoads` block to the place
   `routes.json`, and gen_internal draws road-following lines (still unchanged). This is
   the biggest Phase-2 item and needs the OSM road pull the classic mode avoids.
2. **Stops-emphasis renderer** — a new place-only generator that de-emphasises lines and
   foregrounds each stop as a labelled marker with route badges ("stand here for the
   18"). Better for single-stop places; more new code.
Ship classic now; pick a Phase-2 route per how the place's stop density renders.
