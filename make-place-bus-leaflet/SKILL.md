---
name: make-place-bus-leaflet
description: Create two A4 landscape bus-route leaflet images CENTRED ON A PLACE (a shop, school, station, park, hospital, retail park or town-centre point) rather than a whole town — an INTERNAL close-up ("Buses serving <place>", a tight-zoom map of the immediate bus stops around the place with point-of-interest icons and a Services panel) and an EXTERNAL radial ("Buses from <place>", an AGGREGATED tube-map where each spoke is a place you can REACH and the small badges are the buses that take you there) — plus the service facts. Runs standalone (it pulls its own data for any place, whether or not the town has a leaflet) as resumable dated stages P1 place, P2 geometry, P3 config, P4 generate, P5 render (mapped onto the shared stage.js S1..S6 slots), with auto-versioned images. It REUSES the town skill's engine (gen_internal.js, render.js, stage.js, gtfs_query.py, icons.js, the palettes) unchanged and adds only place-specific tools. Use when asked to make/build/refresh the bus leaflet or bus map for a PLACE / point / landmark (e.g. "make a bus leaflet centred on St Neots Tesco Extra", "buses serving <school>"). For a whole TOWN use make-bus-leaflet instead.
---

# Make the two bus-route leaflet images for a PLACE

This is the **sibling** of `make-bus-leaflet`. That skill leaflets a whole **town**;
this one leaflets a **point** — "the buses at/around this shop / school / station /
park". It is **standalone**: it pulls its own data for any place, whether or not the
town has ever been leafleted (per the planning decision). It **reuses the town
skill's engine** one level down and only adds the place-specific pieces, so nothing
is duplicated and the town skill is **never touched**.

Worked example on disk: `…\Buses\Places\St Neots Tesco Extra\` (built end-to-end,
v1.0). Plan of record: `…\Buses\place-bus-leaflet-plan_2026-07-21.md`.

## What this produces (per place)
1. **Internal close-up** — `internal.jpg/.svg`, `Buses serving <place>`: a tight-zoom
   map of the **bus stops in the immediate walkshed** around the place (default 500 m),
   colour-coded per route, with POI pictograms, a **Services** panel and a **Key**.
   Drawn by the town skill's **`gen_internal.js` unchanged**, fed walkshed-clipped
   geometry (the schematize-workspace pattern). **Default = road-following** (Phase 2):
   route lines trace the real street network via the town skill's `internalRoads`
   pipeline (`pull_roads.js` + `match_routes.js`), driven by `PSK/build_internal_place_roads.js`.
   **Classic mode** (straight stop-to-stop chords, `PSK/build_internal_place.js`) remains
   the fallback for places too sparse to map-match (e.g. a single served stop → no line).
2. **External radial** — `external.jpg/.svg`, `Buses from <place>`: an **aggregated**
   tube-map. The place is the hub ("you are here"); each **spoke is a reachable
   destination** (town / interchange / village), and the small badges on it are
   **every route that gets you there**. This is the genuinely new idea vs the town
   skill's one-spoke-per-route external map. Drawn by the new `gen_external_places.js`.
3. **Service facts** — `gtfs-services.json` (operators / days / termini / headsigns),
   straight from BODS. (A full disagreement audit like the town skill's is a later
   add; for now cross-check odd spokes against bustimes by hand — see gotchas.)

Each map is an editable **SVG** rendered to a **300 dpi JPG** (3508×2480), A4 landscape,
auto-versioned `vN.N`, via the shared `render.js`.

## Reuse map — what is shared vs new (read this first)
Let **`TSK` = `C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`** (the TOWN skill's
assets — the shared engine) and **`PSK` = this skill's `assets`**.

| Piece | Where | Status |
|---|---|---|
| `stage.js`, `render.js`, `gtfs_query.py`, `icons.js`, the palettes | `TSK` | **reused verbatim** |
| `gen_internal.js` (internal renderer) | `TSK` | **reused verbatim** — road-following via `PSK/build_internal_place_roads.js`, classic via `PSK/build_internal_place.js` |
| `pull_roads.js` + `match_routes.js` (road skeleton + map-match) | `TSK` | **reused verbatim** for the road-following internal (Phase 2) |
| `bbox` MCP (`search_overpass`) for POIs | — | **reused** |
| Place resolution (geocode a point) | `PSK/resolve_place.py` | **new** (models `bootstrap_town.py`'s geocode) |
| Standalone chain builder from GTFS | `PSK/gtfs_chains.py` | **new** (offline; no bustimes scrape) |
| Walkshed clip (stops within radius) | `PSK/derive_walkshed.js` | **new** (models `derive_intown.js`) |
| Destination aggregation | `PSK/aggregate_destinations.js` | **new** (the core new logic) |
| External renderer (aggregated spokes) | `PSK/gen_external_places.js` | **new** (models `gen_external_radial.js`) |
| Internal wrapper — classic (gen_internal + title) | `PSK/build_internal_place.js` | **new** (models `schematize_internal.js`) |
| Internal wrapper — road-following (pull_roads + match_routes + gen_internal) | `PSK/build_internal_place_roads.js` | **new** (Phase 2; wraps the classic wrapper) |

**Never edit the town skill.** If the internal renderer needs a place-only behaviour,
express it as a config key or in the wrapper, not a `gen_internal.js` edit.

## Stages, folder, versioning (shared `stage.js`)
A place gets its **own folder** `…\Buses\Places\<Place Name>\` with a `manifest.json`.
The place stages **map onto the shared `stage.js` S-slots** (so the versioned,
resumable manifest machinery is reused unchanged):

| Place stage | stage.js slot | Owns |
|---|---|---|
| **P1 place** | `S1` | `place.json`, `place-candidates.json`, `gtfs-services.json` |
| **P2 geometry** | `S2` | `routes_full_atco.json`, `atco2ll.json`, `atco2name.json`, `routes_intown_atco.json`, `osm.json`, `osm2.json`, `river_geo.json`, `walkshed_cfg.json`, `destinations.draft.json` |
| **P3 config** | `S3` | `routes.json` |
| **P4 generate** | `S4` | `internal.svg`, `external.svg` (version `vN.N`) |
| **P5 render** | `S5` | `internal.jpg`, `external.jpg` |

`node "%TSK%\stage.js" <init|new|pull|commit|latest|status>` — same commands as the
town skill (`references/…` there). After S5, copy the JPGs into `<placeDir>\_latest\`.

## Process — the five stages (autonomous; confirm only genuine blockers)
Defaults: walkshed **500 m**; service radius **0.8 km**; palette **Tol Bright**;
data date current. Pause only for: an **ambiguous place** (two "Tesco Extra"), or a
**destination grouping** you can't settle (the draft is always shown for confirmation).

### P1 — Place (resolve the point)
`python "%PSK%\resolve_place.py" "<place>" --town "<town/area>" [--radius-m 500] [--pick N]`
→ `place.json` (chosen feature: name, lat/lon, class/type, walkshedM) + `place-candidates.json`.
**Review the candidate list**; if `ambiguous:true` or the pick is wrong, re-run with
`--pick N`. Then commit S1. (Geocoder = Nominatim, same as the town bootstrap.)

### P2 — Geometry (standalone, from GTFS)
1. `python "%PSK%\gtfs_chains.py" --near "<lat,lon,0.8>" --town "<place>"` → builds, from
   GTFS `stop_times` (offline, all-BODS-operators), `routes_full_atco.json` +
   `atco2ll.json` + `atco2name.json` + `gtfs-services.json`. Only trips that actually
   stop near the place are used (essential — a `route_short_name` can span unrelated
   route_ids; the far one would corrupt the chain). **Sanity-check the printed route
   list** — a route whose chain looks too short (3 timing-point stops) or whose far end
   is implausibly distant is a GTFS artifact to verify against bustimes before printing.
2. `walkshed_cfg.json = {center:[lat,lon], radiusM:500, buf:1, circular:[…], maxEdgeKm:1.0, skipRoutes:[]}`;
   `node "%PSK%\derive_walkshed.js" routes_full_atco.json atco2ll.json walkshed_cfg.json routes_intown_atco.json`
   → the walkshed-clipped display subset for the internal map. **Keep `maxEdgeKm` small
   (~1 km)** or far buffer stops blow out the auto-fit and the close-up sprawls.
3. POIs: `bbox` MCP `search_overpass` over the walkshed bbox → `osm.json`
   (`osm2.json={"elements":[]}`, `river_geo.json=[]` if none). gen_internal hard-requires
   these three files.
4. `node "%PSK%\aggregate_destinations.js" routes_full_atco.json atco2ll.json atco2name.json place.json [clusterKm]`
   → `destinations.draft.json` + a printed table of **reachable places**. Commit S2.

### P3 — Config (curate + confirm)
Assemble `routes.json` from `PSK/routes.example.place.json`: palette + `textOn` (one
colour per route; **never pale-blue/cyan if a river is shown**), `operators`,
`panelOrder`/`internalDesc`, `anchor` (the place's own stop) + `anchorLabel`,
`placeTitle`/`place`/`placeShort`, `badgeLabels` (for 3–4-char route ids like `61EY`→`61`),
and the **curated `destinations[]`** (merge synonym clusters — "Market Square" + "Bus
Station" → "town centre"; relabel raw stop names to town names; mark `limited`/`Thu only`).
Present the destination grouping for confirmation. Commit S3.

### P4 — Generate
`new S4 --bump major` (or `--bump minor` for a re-style at the same data), pull S2+S3, then:
- **Internal (road-following, default):** `TSK=%TSK% node "%PSK%\build_internal_place_roads.js"`
  → runs `pull_roads.js` (→ `roads_geo.json`) + `match_routes.js` (→ `routes_paths.json`)
  over the walkshed, then gen_internal + title fix (→ `internal.svg`). Needs
  `routes_full_atco.json` in the dir (pulled from S2). Requires `internalRoads` in
  `routes.json` (the wrapper defaults it to `true` if absent).
- **Internal (classic fallback):** `TSK=%TSK% node "%PSK%\build_internal_place.js"` — only
  for places too sparse to map-match; make sure `routes.json` has **no** `internalRoads` key.
- **External:** `node "%PSK%\gen_external_places.js"` (→ `external.svg`).
Commit S4 (`--outputs internal.svg,external.svg,roads_geo.json,routes_paths.json`).

### P5 — Render
`new S5`, pull S4, `node "%TSK%\render.js" internal.svg internal.jpg` and the same for
external. **Inspect the JPGs** (open them). Refresh `<placeDir>\_latest\`. Commit S5.

## Locked design decisions (do not silently change)
- **Standalone.** Never require a town build; pull the place's own data. (Consistency
  with an existing town leaflet is not guaranteed and not required.)
- **Two radii.** *Service radius* (~0.8 km, `gtfs_chains --near`) decides which routes
  count as serving the place; *walkshed* (~500 m, `derive_walkshed`) decides which
  stops are DRAWN on the close-up. They differ on purpose — a route may pass 700 m away
  (reachable, shown on the external map) without stopping at the place (not drawn inside).
- **External = reachable places, not routes.** One spoke per destination; all routes to
  it ride as badges. Cluster endpoints geographically, then **draft → human confirms**
  (same "suggest, then ask" rule the town skill uses for features/lenses).
- **Internal = the town `gen_internal.js` unchanged, tight-zoomed** by feeding
  walkshed-clipped stops. Title fixed by the wrapper, not by editing the town gen.
  **Road-following is the default** (Phase 2, `internalRoads` in `routes.json`); classic
  straight chords are the fallback for map-match-impossible places.
- **Config-driven, portal-ready.** No per-place literals in any generator (matches the
  town skill's rule and the portal plan's central/self-serve split: P1/P2 central,
  P3–P5 self-serve). New behaviour → a `routes.json` key.
- **Palettes:** Tol Bright default (see the town skill). One colour per route across both maps.

## Phase 2 — road-following internal map (DONE 2026-07-21)
The Phase-1 classic straight-line internal map zigzagged for **sparse edge-of-town**
places (the Tesco bypass superstore — one shared stop plus a couple of loops drawn as
straight chords). Phase 2 fixes this by reusing the town skill's `internalRoads` pipeline
verbatim: `build_internal_place_roads.js` runs `pull_roads.js` + `match_routes.js` over
the walkshed, then gen_internal draws road-following lines. **No new drawing code** — the
place data was already the right shape (`match_routes` reads `full.canonical[0].stops`,
exactly what `gtfs_chains.py` writes). Validated on **both** the sparse case (Tesco Extra
— night-and-day improvement) and the dense case (Town Centre — also better, no
regression), so road-following is now the **default** internal style.

**Fit + framing (v1.2, automatic):** the wrapper injects `internalRoads.fitExtra` = all
drawn stops so a **cross-locality** place (Tesco straddles Eynesbury + St Neots) frames the
whole walkshed instead of one locality's stops (was clipping routes at the frame), and
defaults `fitMargin` to 8 mm for road-tail clearance. It also auto-hides gen_internal's
default "River Great Ouse" label when the walkshed has no river. To sit a map lower on the
page, freeze an `overrides.json` viewport with a bumped `offY` (Tesco v1.2). See
`references/gotchas.md`. Classic
(`build_internal_place.js`) stays the fallback where map-matching yields no line
(a place with a single served stop). *Remaining phases: one-page flyer (Phase 3); portal
fold-in (Phase 4).*

## Review (end of every session)
Fold lessons into this SKILL / `references/gotchas.md`; record durable state in the
project memory (`project_bus_leaflets.md` / the place-skill memory). Flag out-of-scope
items rather than silently fixing. This step is itself a standing rule.

## Reference files (load on demand)
- **[references/pipeline.md](references/pipeline.md)** — the full P1–P5 command walkthrough with the St Neots Tesco Extra numbers.
- **[references/aggregation.md](references/aggregation.md)** — the destination-aggregation algorithm, clustering, curation rules.
- **[references/internal-reuse.md](references/internal-reuse.md)** — how the internal wrappers reuse `gen_internal.js`: classic-mode fit, required stub files, and the shipped **road-following** build (`build_internal_place_roads.js`).
- **[references/gotchas.md](references/gotchas.md)** — duplicate route numbers, sparse GTFS timing-point trips, radius/fit blow-out, badge-label clipping, Overpass timeouts.
- **Changing engine CODE (either skill's `assets/`)** → the town skill's **`references/changing-the-engine.md`**. It covers both skills: the invariants, the byte-identical gate set, the shared-`gen_internal.js` boundary, and the mandatory re-vendor of `gen_external_places.js` + `gen_internal.js` into the portal's `engine/place/`. A place-engine change is not finished until that hand-off is done.
