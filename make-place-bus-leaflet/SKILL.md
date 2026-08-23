---
name: make-place-bus-leaflet
description: Create two A4 landscape bus-route leaflet images CENTRED ON A PLACE (a shop, school, station, park, hospital, retail park or town-centre point) rather than a whole town — an INTERNAL close-up ("Buses serving <place>", a tight-zoom map of the immediate bus stops around the place with point-of-interest icons and a Services panel) and an EXTERNAL radial ("Buses from <place>", an AGGREGATED tube-map where each spoke is a place you can REACH and the small badges are the buses that take you there) — plus the service facts. Runs standalone (it pulls its own data for any place, whether or not the town has a leaflet) as resumable dated stages P1 place, P2 geometry, P3 config, P4 generate, P5 render (mapped onto the shared stage.js S1..S6 slots), with auto-versioned images. It REUSES the town skill's engine (gen_internal.js, render.js, stage.js, gtfs_query.py, icons.js, the palettes) unchanged and adds only place-specific tools. Use when asked to make/build/refresh the bus leaflet or bus map for a PLACE / point / landmark (e.g. "make a bus leaflet centred on St Neots Tesco Extra", "buses serving <school>"). For a whole TOWN use make-bus-leaflet instead.
---

# Make the two bus-route leaflet images for a PLACE

**Names for the parts.** Place sheets use the town sheets' vocabulary: `C:\u3a St Ives\Using AI\Buses\Documentation\README - Glossary of terms.md`, keyed by callout code to two annotated examples. Use those names rather than inventing place-specific ones.

This is the **sibling** of `make-bus-leaflet`. That skill leaflets a whole **town**; this one leaflets a **point** — "the buses at/around this shop / school / station / park". It is **standalone**: it pulls its own data for any place, whether or not the town has ever been leafleted (per the planning decision). It **reuses the town skill's engine** one level down and only adds the place-specific pieces, so nothing is duplicated and the town skill is **never touched**.

Worked examples on disk (each under its area, `…\Buses\Areas\<Town>\Places\`): **St Neots Tesco Extra** (v1.2, sparse edge-of-town), **St Neots Town Centre** (v1.1, dense), **Beaconsfield Waitrose** and **Beaconsfield Simpson Centre** (first outside Cambridgeshire), **High Wycombe Aldi** (v1.1, the busy case — 11 drawn services, 14 external spokes, solved layout). Plan of record: `…\Buses\Development Docs\place-bus-leaflet-plan_2026-07-21.md`.

## What this produces (per place)
1. **Internal close-up** — `internal.jpg/.svg`, `Buses serving <place>`: a tight-zoom map of the **bus stops in the immediate walkshed** around the place (default 500 m), colour-coded per route, with POI pictograms, a **Services** panel and a **Key**. Drawn by the town skill's **`gen_internal.js` unchanged**, fed walkshed-clipped geometry (the schematize-workspace pattern). **Default = road-following** (Phase 2): route lines trace the real street network via the town skill's `internalRoads` pipeline (`pull_roads.js` + `match_routes.js`), driven by `PSK/build_internal_place_roads.js`. **Classic mode** (straight stop-to-stop chords, `PSK/build_internal_place.js`) remains the fallback for places too sparse to map-match (e.g. a single served stop → no line).
2. **External radial** — `external.jpg/.svg`, `Buses from <place>`: an **aggregated** tube-map. The place is the hub ("you are here"); each **spoke is a reachable destination** (town / interchange / village), and the small badges on it are **every route that gets you there**. This is the genuinely new idea vs the town skill's one-spoke-per-route external map. Drawn by the new `gen_external_places.js`.
3. **Boarding plan** (optional third sheet, Phase 3) — `boarding.jpg/.svg`, *Where to catch your bus in <place>*: an alphabetical destination-to-stand index beside a tight locator. Only where `routes.json` carries a `boardingPlan` block.
4. **Service facts** — `gtfs-services.json` (operators / days / termini / headsigns), straight from BODS. (A full disagreement audit like the town skill's is a later add; for now cross-check odd spokes against bustimes by hand — see gotchas.)

Each map is an editable **SVG** rendered to a **300 dpi JPG** (3508×2480), A4 landscape, auto-versioned `vN.N`, via the shared `render.js`.

## Reuse map — what is shared vs new (read this first)
Let **`TSK` = `C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`** (the TOWN skill's assets — the shared engine) and **`PSK` = this skill's `assets`**.

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
| External spoke layout solver (bearings + termini) | `PSK/solve_external_layout.py` | **new** (2026-07-30; needed once a place has >~8 spokes) |
| Internal "to X" exit labels from the curated destinations | `PSK/derive_termini.js` | **new** (2026-08-21; every place map before this shipped with unlabelled exit arrows) |
| External renderer (aggregated spokes) | `PSK/gen_external_places.js` | **new** (models `gen_external_radial.js`) |
| Boarding-plan stand resolution | `TSK/naptan_stands.py` | **new** (2026-08-22; frame-based, OK/REFUSE) |
| Boarding-plan destination index | `TSK/boarding_index.py` | **new** (2026-08-22; departures only, NPTG rollup) |
| Boarding-plan sheet | `TSK/gen_boarding.js` | **new** (2026-08-22; see Phase 3) |
| Boarding-plan locator context | `TSK/pull_locator.js` | **new** (2026-08-23; OSM buildings/apron/lights — optional, absence is byte-identical) |
| Boarding-plan gate | `TSK/boarding_verify.py` | **new** (2026-08-22; checks NaPTAN + GTFS + the SVG) |
| Internal wrapper — classic (gen_internal + title) | `PSK/build_internal_place.js` | **new** (models `schematize_internal.js`) |
| Internal wrapper — road-following (pull_roads + match_routes + gen_internal) | `PSK/build_internal_place_roads.js` | **new** (Phase 2; wraps the classic wrapper) |

**Never edit the town skill.** If the internal renderer needs a place-only behaviour, express it as a config key or in the wrapper, not a `gen_internal.js` edit.

## Stages, folder, versioning (shared `stage.js`)
A place gets its **own folder** with a `manifest.json`, nested under the area it sits in: `…\Buses\Areas\<Town>\Places\<Place Name>\`. If that town has no area map of its own and probably never will (a rural school, an attraction outside any town we map, a one-off commission), use `…\Buses\Places\_standalone\<Place Name>\` instead. **Keep the town prefix in the folder name** — "High Wycombe Aldi", not "Aldi" — because the name has to stand alone in `manifest.json`'s `"town"` field, in render folder names and in the portal's `renderParent`. The place stages **map onto the shared `stage.js` S-slots** (so the versioned, resumable manifest machinery is reused unchanged):

| Place stage | stage.js slot | Owns |
|---|---|---|
| **P1 place** | `S1` | `place.json`, `place-candidates.json`, `gtfs-services.json` |
| **P2 geometry** | `S2` | `routes_full_atco.json`, `atco2ll.json`, `atco2name.json`, `routes_intown_atco.json`, `osm.json`, `osm2.json`, `river_geo.json`, `walkshed_cfg.json`, `destinations.draft.json`, **`place.json`** (carried — copy in from S1, must be listed in `--outputs`) |
| **P3 config** | `S3` | `routes.json` |
| **P4 generate** | `S4` | `internal.svg`, `external.svg` (version `vN.N`), **`place.json`** (pull S1 explicitly, don't rely on it riding through S2) |
| **P5 render** | `S5` | `internal.jpg`, `external.jpg`, **`place.json`** (required by the portal's `import-map.mjs --kind place`) |

`place.json` is easy to lose: `pull` only copies files a stage *declared* in its own `--outputs`, so it must be re-declared at every stage above or it dead-ends silently (the S4/S5 SVGs/JPGs still render fine without it — the failure only shows up later, in the portal import). See `references/gotchas.md` for the incident this caused.

`node "%TSK%\stage.js" <init|new|pull|commit|latest|status>` — same commands as the town skill (`references/…` there). After S5, copy the JPGs into `<placeDir>\_latest\`.

**The monthly change scan picks the place up by itself — there is nothing to register.** Unlike a town (which S1 must add to `_gtfs/town_prefixes.json` by hand, and which drifts when someone forgets), a place is discovered by `gtfs_places.py` from the `manifest.json` you just created, in any of the three layouts above. It is then scanned against **its own** service radius — the `near` in its `gtfs-services.json`, not its town's, which is the point: High Wycombe's 3.5 km town circle both misses routes reaching the Aldi from outside it and reports town-wide changes that never go near the store. Which dataset it is read from comes from the parent town's `region`, or for a standalone place from `place.json`'s region name; an unregistered region is reported NOT CHECKED with a reason, never passed over silently. Check with `python "%SK%\gtfs_upcoming.py" --list-units`, or `--place "<Place Name>"` for the pre-print gate (prints, writes nothing — the place equivalent of the town skill's `--town`).

## Process — the five stages (autonomous; confirm only genuine blockers)
**Step 0, before P1 and before any rebuild: run the pre-print change scan.**

```bash
python "%SK%\gtfs_upcoming.py" --place "<Place Name>"
```

Run it from the Buses root (`C:\u3a St Ives\Using AI\Buses`); `%SK%` is `C:\Users\Peter\.claude\skills\make-bus-leaflet\assets`, and `<Place Name>` is the place folder's name exactly as `manifest.json` has it (e.g. `St Ives Bus Station`). It prints and writes nothing. **It is listed further up as a capability, and that is why the first St Ives Bus Station build shipped without it** — a tool described is not a tool run. It reports two things no other check will: `[ENDS?]`, a service registered only to a near date, which is how route 101 turned out to be a summer seaside service ending three weeks after the sheet was drawn; and `[CHANGE]`, a timetable registered to start soon, which is how the A/B restructure of 30 August 2026 came to light. Neither is visible in `gtfs-services.json`, because both are facts about `calendar` dates rather than about how often the bus runs today. Act on what it says before drawing, not after.

Defaults: walkshed **500 m**; service radius **0.8 km**; palette **Tol Bright**; data date current. Pause only for: an **ambiguous place** (two "Tesco Extra"), or a **destination grouping** you can't settle (the draft is always shown for confirmation).

### P1 — Place (resolve the point)
`python "%PSK%\resolve_place.py" "<place>" --town "<town/area>" [--radius-m 500] [--pick N]` → `place.json` (chosen feature: name, lat/lon, class/type, walkshedM) + `place-candidates.json`. **Review the candidate list**; if `ambiguous:true` or the pick is wrong, re-run with `--pick N`. Then commit S1. (Geocoder = Nominatim, same as the town bootstrap.) A **chain store is almost always ambiguous** (High Wycombe has three Aldis and the auto-pick took the wrong one) — confirm the **postcode / street in `place.json.display`** against the request, and record in the README which branch you built and which you didn't.

### P2 — Geometry (standalone, from GTFS)
1. `python "%PSK%\gtfs_chains.py" --near "<lat,lon,0.8>" --town "<place>"` → builds, from GTFS `stop_times` (offline, all-BODS-operators), `routes_full_atco.json` + `atco2ll.json` + `atco2name.json` + `gtfs-services.json`. Only trips that actually stop near the place are used (essential — a `route_short_name` can span unrelated route_ids; the far one would corrupt the chain). **Sanity-check the printed route list** — a route whose chain looks too short (3 timing-point stops) or whose far end is implausibly distant is a GTFS artifact to verify against bustimes before printing. Then **print each route's nearest-stop distance to the place** — it decides `radiusM` below, proves a "missing" route really is far away, and feeds the README table. Also join `stop_times → trips → calendar` at the place's own stop and group by day-flags: `gtfs-services.json`'s `tripsAtTownPerWeekSample` is trips-per-**pattern**, so it will mislead any frequency wording you write in P3 (High Wycombe Aldi: "7" meant 7 journeys *every weekday*, and a "Daily" 32A was really a Sunday service).
2. `walkshed_cfg.json = {center:[lat,lon], radiusM:500, buf:1, circular:[…], maxEdgeKm:1.0, skipRoutes:[]}`; `node "%PSK%\derive_walkshed.js" routes_full_atco.json atco2ll.json walkshed_cfg.json routes_intown_atco.json` → the walkshed-clipped display subset for the internal map. **Keep `maxEdgeKm` small (~1 km)** or far buffer stops blow out the auto-fit and the close-up sprawls. Set `radiusM` from the measured distances, not the default — the Aldi needed **550 m** to keep three routes whose nearest stop is 507 m.
3. POIs: `bbox` MCP `search_overpass` over the walkshed bbox → `osm.json` (`osm2.json={"elements":[]}`, `river_geo.json=[]` if none). gen_internal hard-requires these three files.
4. `node "%PSK%\aggregate_destinations.js" routes_full_atco.json atco2ll.json atco2name.json place.json [clusterKm]` → `destinations.draft.json` + a printed table of **reachable places**. Commit S2.

### P3 — Config (curate + confirm)
Assemble `routes.json` from `PSK/routes.example.place.json`: palette + `textOn` (one colour per route; **never pale-blue/cyan if a river is shown**), `operators`, `panelOrder`/`internalDesc`, `anchor` (the place's own stop) + `anchorLabel`, `placeTitle`/`place`/`placeShort`, `badgeLabels` (for 3–4-char route ids like `61EY`→`61`), and the **curated `destinations[]`** (merge synonym clusters — "Market Square" + "Bus Station" → "town centre"; relabel raw stop names to town names; mark `limited`/`Thu only`). Present the destination grouping for confirmation. Once settled, run both fillers (see `references/aggregation.md`) — `python "%TSK%\gtfs_duration.py" <prefixes> --fill-place routes.json` for `minutesToDestination`, then `python "%PSK%\derive_stops.py" routes.json --dir .` for `stops` on single-route spokes (`gen_external_places.js` already draws both).

For a **busy place** (roughly >8 services or >8 destinations) three extra P3 steps:
- **Bundle only what co-runs.** Set `internalCorridors` for routes sharing a corridor, then read the `corridors_report.json` the build prints — a member under the 60 % gate must get its **own colour** instead (32A looked identical to 32 in the walkshed but diverges on the full chain). Six 100 %-co-running routes on one lane is what makes an 11-route close-up work.
- **Drop school variants by omission** — leave e.g. `37M` out of `routeOrder`/`palette` and `gen_internal` skips it; carry it as a `mapNotes` footnote. No S2 re-run needed.
- **Solve the external layout, don't nudge it.** With `bearing` = each destination's TRUE bearing, run `python "%PSK%\solve_external_layout.py" routes.json --pin "<longest-badge-row dest>" --write` → order-preserving bearings ≥19° apart, the long badge row pinned to a clear ray, and a frozen `terminus{x,y}` per node that clears the page, the legend, the footnote and every other node. `--check-only` audits a stored layout. Keep the TRUE bearings in the README — `--write` overwrites `bearing` with the display value.

**Then derive the internal exit labels — this step is not optional.** Run from the S3 run folder (the one holding the `routes.json` you just wrote), with `routes_full_atco.json`, `atco2ll.json`, `atco2name.json` and `place.json` copied in beside it from S2:

```bash
node "%PSK%\derive_termini.js"            # report only — read every row
node "%PSK%\derive_termini.js" --write    # then merge into routes.json
```

`%PSK%` = this skill's `assets` folder. No other arguments are needed; `--force` additionally overwrites entries a human has already hand-set, and `--max-bearing N` (default 35) widens the tolerance for matching an end-stop to a curated destination. It writes `internalRoads.termini`, which is what makes `gen_internal` print "to Chatteris" beside an exit arrow instead of a bare arrowhead. **Every place map built before 2026-08-21 shipped without this** — the engine always supported it, the place pipeline simply never wrote the key, and only the hand-tuned High Wycombe Aldi fixture had it. Read the printed table before `--write`: any row flagged `[bearing off by N deg]` or `[destination does not list this route]` is a guess, and a route that terminates at the place itself is correctly reported as `(terminates at the place)` and written as `false`. Then delete the four copied-in files so S3 commits only `routes.json`.

Commit S3 (`--outputs routes.json,overrides.json` if you wrote overrides).

### P4 — Generate
`new S4 --bump major` (or `--bump minor` for a re-style at the same data), pull S2+S3, then:
- **Internal (road-following, default):** `TSK=%TSK% node "%PSK%\build_internal_place_roads.js"` → runs `pull_roads.js` (→ `roads_geo.json`) + `match_routes.js` (→ `routes_paths.json`) over the walkshed, then gen_internal + title fix (→ `internal.svg`). Needs `routes_full_atco.json` in the dir (pulled from S2). Requires `internalRoads` in `routes.json` (the wrapper defaults it to `true` if absent).
- **Internal (classic fallback):** `TSK=%TSK% node "%PSK%\build_internal_place.js"` — only for places too sparse to map-match; make sure `routes.json` has **no** `internalRoads` key.
- **External:** `node "%PSK%\gen_external_places.js"` (→ `external.svg`). Commit S4 (`--outputs internal.svg,external.svg,roads_geo.json,routes_paths.json`).

### P5 — Render
`new S5`, pull S4, `node "%TSK%\render.js" internal.svg internal.jpg` and the same for external. **Inspect the JPGs** (open them). Commit S5, then `node "%TSK%\refresh_latest.js" "<placeDir>"` — **never** a manual `cp` into `_latest\`; the script also re-runs `collect-maps.ps1 -All` at the Buses root so `Collected_latests` can't drift. Run this same command as the **last step of any edit that touches an already-committed render**, even a hand-patch with no version bump — see the P5 note in `references/pipeline.md` for why this is mandatory.

## Locked design decisions (do not silently change)
- **Standalone.** Never require a town build; pull the place's own data. (Consistency with an existing town leaflet is not guaranteed and not required.)
- **Two radii.** *Service radius* (~0.8 km, `gtfs_chains --near`) decides which routes count as serving the place; *walkshed* (~500 m, `derive_walkshed`) decides which stops are DRAWN on the close-up. They differ on purpose — a route may pass 700 m away (reachable, shown on the external map) without stopping at the place (not drawn inside).
- **External = reachable places, not routes.** One spoke per destination; all routes to it ride as badges. Cluster endpoints geographically, then **draft → human confirms** (same "suggest, then ask" rule the town skill uses for features/lenses).
- **Internal = the town `gen_internal.js` unchanged, tight-zoomed** by feeding walkshed-clipped stops. Title fixed by the wrapper, not by editing the town gen. **Road-following is the default** (Phase 2, `internalRoads` in `routes.json`); classic straight chords are the fallback for map-match-impossible places.
- **Config-driven, portal-ready.** No per-place literals in any generator (matches the town skill's rule and the portal plan's central/self-serve split: P1/P2 central, P3–P5 self-serve). New behaviour → a `routes.json` key.
- **Palettes:** Tol Bright default (see the town skill). One colour per route across both maps.

## Phase 2 — road-following internal map (DONE 2026-07-21)
The Phase-1 classic straight-line internal map zigzagged for **sparse edge-of-town** places (the Tesco bypass superstore — one shared stop plus a couple of loops drawn as straight chords). Phase 2 fixes this by reusing the town skill's `internalRoads` pipeline verbatim: `build_internal_place_roads.js` runs `pull_roads.js` + `match_routes.js` over the walkshed, then gen_internal draws road-following lines. **No new drawing code** — the place data was already the right shape (`match_routes` reads `full.canonical[0].stops`, exactly what `gtfs_chains.py` writes). Validated on **both** the sparse case (Tesco Extra — night-and-day improvement) and the dense case (Town Centre — also better, no regression), so road-following is now the **default** internal style.

**Fit + framing (v1.2, automatic):** the wrapper injects `internalRoads.fitExtra` = all drawn stops so a **cross-locality** place (Tesco straddles Eynesbury + St Neots) frames the whole walkshed instead of one locality's stops (was clipping routes at the frame), and defaults `fitMargin` to 8 mm for road-tail clearance. It also auto-hides gen_internal's default "River Great Ouse" label when the walkshed has no river. To sit a map lower on the page, freeze an `overrides.json` viewport with a bumped `offY` (Tesco v1.2). See `references/gotchas.md`. Classic (`build_internal_place.js`) stays the fallback where map-matching yields no line (a place with a single served stop). *Remaining phases: one-page flyer (Phase 3); portal fold-in (Phase 4).*

## Phase 3 — the BOARDING PLAN, a third sheet (PROTOTYPED 2026-08-22, revised 2026-08-23)

A place can carry a **third sheet**: *"Where to catch your bus in ‹place›"* — `boarding.jpg/.svg`, an alphabetical **destination → which stop to stand at** index beside a tight locator map. It answers the inverse of the other two sheets ("I have decided to go to X; where do I stand?"), and it is the only sheet we make whose error strands a passenger. Plan of record and findings: `…\Buses\Development Docs\boarding-plan-product_2026-08-22.md` (read **§7** first). First built on **St Ives Bus Station** (v1.3, 38 destinations, 4 boarding points).

**Five new tools, all in `TSK` (the town skill's assets) because they are engine-level.** Run them from the S4 dir after `pull`, in this order:

```bash
python "%TSK%\naptan_stands.py" --write                        # which stops can be named, and how
python "%TSK%\boarding_index.py" --db <region.sqlite> --write  # the destination index
node   "%TSK%\pull_locator.js" 300                             # OSM ground context for the locator
node   "%TSK%\gen_boarding.js"                                 # boarding.svg
python "%TSK%\boarding_verify.py" --db <region.sqlite>         # the gate — must PASS
```

`%TSK%` = `C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`; `<region.sqlite>` is the parent town's GTFS database from `_gtfs/regions.json` (e.g. `C:\u3a St Ives\Using AI\Buses\_gtfs\cambridgeshire.sqlite`) — there is no default region, so pass it. `pull_locator.js`'s `300` is a **radius in metres** around the place anchor; 300 comfortably covers any locator frame `gen_boarding.js` can compute (it fits to the stands and grows to the panel aspect, roughly 130–200 m), and it is the only step here that touches the network. Then render with `render.js boarding.svg boarding.jpg` and commit `boarding.svg` and `locator_geo.json` in S4, `boarding.jpg` in S5, as usual.

**`locator_geo.json` is optional and its absence is byte-identical** — skip the pull, or delete the file, and the sheet renders exactly as it did before 2026-08-23. That is deliberate: a place built before the script existed still re-renders, and an Overpass outage costs context rather than a sheet.

**Gated on config, and declining is correct.** The sheet is offered only where `routes.json` carries a `boardingPlan` block — the local stand-in for the portal's `requiresConfig`. `gen_boarding.js` exits non-zero and writes nothing when that key is absent, or when `naptan_stands.py` returned `REFUSE`.

**The rules that are easy to get wrong** (each cost a wrong artefact during the prototype — the paper's §7.3 has the traces):

- **The locator has to look like somewhere.** Streets, markers and one landmark is a diagram, not a place — *"I find it hard to envisage it on the ground"* (Peter, 2026-08-23). At a ~130 m frame the town POI pull has almost nothing inside it: `overpass-pois.txt` asks for supermarkets, libraries, schools and surgeries, and at St Ives the nearest is 138 m away and off the page. Run `pull_locator.js` and draw the built fabric — **building footprints above all**, then the place's own polygon in a warm tint (the bays sit inside a shape the reader is standing in), the car parks, the signalled crossings and the named shopfronts. Rank landmarks by usefulness, not by distance, or a jeweller beats the pub on the corner. Details and the four traps: `references/gotchas.md`.
- **An identical twin is a config problem.** Two variants that match onto the same road edges draw two same-coloured lines with the same badge and no way to tell them apart. Compare `routes_paths.json` `edges` sets pairwise before reaching for `internalCorridors` — which is the obvious tool and the wrong one, because it stacks one badge per co-running member and prints the number three times over. Drop the twin from the drawn config instead, and keep any sibling whose path genuinely differs, badged as itself.
- **The parent-locality rollup must stop at a joint civil parish.** It exists to turn a hamlet into the town a passenger would name, and it does — but "Needingworth" rolled up to **"Holywell-cum-Needingworth"**, which is not a spelling quibble: every stop the 301 serves in that parish is in Needingworth, and Holywell has one stop no bus calls at, so the printed name advertised a village the bus does not reach. `boarding_index.py` v1.1 keeps the child where it is a whole **component** of an "A-cum-B" / "A and B" parent — six names in the entire register. `"Fenton End"` is not a component of `"Pidley cum Fenton"` and still rolls up, which it must.
- **When the gate goes red on a naming change, do not teach it the new rule.** `boarding_verify.py` correctly reported HARD `S-2` on every Needingworth row, because the two files now disagreed about the name. Copying the rollup into the checker would leave it only ever confirming that the generator agrees with itself. It widens what it **accepts** instead — and only for the joint-parish case, not for any un-rolled name, or the sheet could print "Kings Hedges" for Cambridge and pass.
- **The unit is the FRAME, not the name-cluster.** Consider every served stop near the anchor whatever it is called. At St Ives the Cambridge-bound A and B never enter the bus station; they board at an unlettered stop 47 m away. Judging by shared name passes that place as fully lettered and sends every Cambridge passenger to the wrong bay.
- **Read `directions`, never `canonical`.** Every other consumer wants the canonical one-direction chain; a boarding plan is a statement *about* direction and goes blind if it reads it.
- **Departures only.** A stop where a route terminates is not a boarding point. Route 9 departs St Ives Bay 2 and terminates at Bay 1.
- **Two honest label classes.** A lettered bay prints its code; a stop with no code prints its NaPTAN `CommonName`. Never fall back to `Indicator` — "opp" tells a reader nothing.
- **Roll localities to the top of the NPTG tree, keyed on ATCO.** `Orchard Park → Kings Hedges → Cambridge` needs two hops, and `Church End` has five different parents.
- **Frequency comes from `calendar`,** not from counting feed rows.
- **Fit the locator to the stands, not the landmarks,** and use street names for context at that zoom.
- **Prove the gate red before trusting it green:** `boarding_verify.py --self-test`.
- **Nothing on the sheet may be under 2.4 mm** (`MIN_TEXT`), and an adaptive shrink loop must CLAMP to it, not compare — `2.95 - 0.05*11` lands on `2.4000000000000004` and steps straight through. `quality_metrics.js` counts every undersized element as its own hard defect, so one bad default scores once per label (87 on the first run, 84 of them this).
- **Pass `safe` to `footerBand`.** It is opt-in and defaults to null, which puts the credit 3 mm from the trim; every town sheet clears 5 mm.
- **A service can be live in the feed and still wrong to print.** Whippet's 101 to Hunstanton runs 08:25 out and 17:40 back, every day — and its `calendar` ends 13 Sep 2026, because it is a summer seaside service. A sheet stamped "from August 2026" outlives it, and a reader picking one up in October is sent to a bay for a bus that stopped running. **Check `calendar.end_date` on every service before printing, not just its frequency.** `boardingPlan.excludeRoutes: ["101"]` leaves it off the boarding plan (filtered in `boarding_index.py`, which reads `stands.json` and the feed directly and never consults `routeOrder`); the internal needs it removed from `palette`, `textOn`, `internalDesc`, `routeOrder`, `panelOrder`, `internalRoads.termini` **and from `operators`** — an operator left with no routes still prints its heading over nothing.
- **A place map inherits nothing it is not fed.** The town generator draws the place internal unchanged, so the QR, the printed build number, the "to X" exit labels, the frequency tiers and the operator headings in the Services panel are all there — and all silently absent until `routes.json` carries `design.sheetUrl`/`sheetQr`/`sheetUrlLabel`, `design.sheetVersion` (stamped by `rollout_places.js`, never by hand), `internalRoads.termini` (run `PSK\derive_termini.js --write`), **both** `frequency` and `design.frequencyTiers`, and `panelGroups:true`. St Ives Bus Station v1.0 shipped without a single one of them and read as an engine regression. **Diff a new place's `routes.json` keys against its parent town's before building.**
- **The config stage is not always the config.** v1.0's `destinations[]`, `badgeLabels` and `note` were hand-added in the S4 dir and never existed in S3, so a rebuild seeded from S3 would have dropped them silently. **Diff S3's `routes.json` against the latest S4's before starting a new S3**, and seed from whichever is really current.
- **`design.exitDevice` was measured and rejected for the towns on 2026-08-16 — read `make-bus-leaflet/references/design-quality.md` §`design.exitDevice` BEFORE adopting it on a place.** It costs +15 defects across the eight internal sheets and the write-up names the two labels it breaks, "to Bar Hill" and "to Boxworth"; St Ives Bus Station hit those same two on 2026-08-23 and now carries `exitDevice:false`. The 2026-08-21 decision to adopt it across the place maps contradicts that and is unresolved. What the town measurement did NOT catch, and this one did: `quality_metrics.js` scores a label over a route **badge** as zero collisions (`pt/ink` reads the same with the device on and off), and gen_internal's stderr warning fires only for an exit that could take *no* inboard position, not one that took a bad one. **Read exit labels off a 300 dpi crop.**
- **Adding a QR moves the footer plate up by 9 mm**, from 197.17 to 188.10, and anything pinned below the index goes under it. `gen_boarding.js` now builds ONE `FOOTER_OPTS` and passes it to both `footerPlateTop` and `footerBand`, the same rule `gen_internal.js` follows, so the plate the legend dodges is the plate that gets drawn.
- **The "you are here" anchor tick is wrong at an interchange.** It marks the place's own OSM centroid, not a stop, so at a bus station it draws a fifth point that cannot be boarded — 8 mm from Bay 2, clear of every marker, so no overlap test would have caught it. `gen_boarding.js` defaults it off for `place.json` type `bus_station`/`ferry_terminal`; `boardingPlan.anchorTick` overrides.
- **`quality_metrics.js` skips two map-only measures for a `boarding` basename** (panel-only services, duplicate labels) because this sheet draws no route lines and an index repeats stop names by design. If you add another line-less sheet type it will need the same scoping — and re-run the whole ratchet afterwards to prove no other sheet moved.

**Adding any new sheet means editing the delivery path by hand** — `refresh_latest.js`'s `SHEETS` array and `collect-maps.ps1`'s `ValidateSet` and `-All` list. Neither warns when it falls behind, and `boarding.jpg` silently missed `_latest` on first build because of it.

*Remaining: the A1 heads-up posted variant (a genuinely different artwork — see the paper's §6), and the portal `OUTPUTS` entry (step 3, not started).*

## Review (end of every session)
Fold lessons into this SKILL / `references/gotchas.md`; record durable state in the project memory (`project_bus_leaflets.md` / the place-skill memory). Flag out-of-scope items rather than silently fixing. This step is itself a standing rule.

## Reference files (load on demand)
- **[references/pipeline.md](references/pipeline.md)** — the full P1–P5 command walkthrough with the St Neots Tesco Extra numbers.
- **[references/aggregation.md](references/aggregation.md)** — the destination-aggregation algorithm, clustering, curation rules.
- **[references/internal-reuse.md](references/internal-reuse.md)** — how the internal wrappers reuse `gen_internal.js`: classic-mode fit, required stub files, and the shipped **road-following** build (`build_internal_place_roads.js`).
- **[references/gotchas.md](references/gotchas.md)** — duplicate route numbers, sparse GTFS timing-point trips, radius/fit blow-out, badge-label clipping, Overpass timeouts.
- **Changing engine CODE (either skill's `assets/`)** → the town skill's **`references/changing-the-engine.md`**. It covers both skills: the invariants, the byte-identical gate set, the shared-`gen_internal.js` boundary, and the mandatory re-vendor of `gen_external_places.js` + `gen_internal.js` into the portal's `engine/place/`. A place-engine change is not finished until that hand-off is done.

