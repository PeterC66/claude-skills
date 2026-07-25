# Gotchas — make-place-bus-leaflet

Root-caused during the Phase-1 build (St Neots Tesco Extra, 2026-07-21). Check here first.

- **Duplicate route numbers corrupt a chain (FIXED in gtfs_chains).** A GTFS
  `route_short_name` can span unrelated `route_id`s (two operators' "69"). Picking the
  globally-longest trip can select a pattern that never comes near the place — route 69
  first built as a St Ives-area chain with its nearest stop **13 km** away. Fix: build
  chains **only from trips that stop within the service radius** (`longest_trip_per_direction`
  takes the town-stop set). If a route still looks wrong, it's a different collision —
  check its `route_id`s.

- **Sparse GTFS timing-point trips.** Even restricted to place-serving trips, the fullest
  trip can be a **timing-point-only** skeleton (69 came out as 3 stops: St Ives → Papworth
  → Tesco, an 11 km gap with no stops). It renders as a long straight spoke to a distant,
  ambiguously-named end ("Bus Station"). **Cross-check any long/odd external spoke against
  bustimes before printing** — the town skill uses bustimes for stop order precisely to
  avoid this; the place skill trades that for offline GTFS chains and inherits the risk.

- **Two radii, don't conflate them.** `gtfs_chains --near <km>` (service radius, ~0.8) =
  which routes count as serving the place. `derive_walkshed radiusM` (~500) = which stops
  are DRAWN inside. A route can serve (stop 700 m away) without being drawn on the close-up.

- **Fit blow-out / sprawling close-up.** `derive_walkshed maxEdgeKm` too large lets a
  buffer stop sit 2+ km out; `gen_internal` auto-fits to the bbox of ALL drawn stops, so
  the close-up zooms out and the lines sprawl. Keep `maxEdgeKm` ~1.0 and choose `radiusM`
  by stop density. (Tesco: 500 m = 3 routes tight; 800 m = 18/18A in but sprawls; 600 m
  shipped.)

- **Badge-label clipping for 3–4-char route ids.** `61EY` overflows the small legend/panel
  badge (renders "61E"). Use `routes.json` `badgeLabels` (`"61EY":"61"`) — the town skill's
  own mechanism. Unambiguous where there's no plain "61".

- **gen_internal hard-requires osm.json / osm2.json / river_geo.json.** They are parsed
  without try/catch. `build_internal_place.js` writes empty stubs if missing, so a
  POI-less place still renders. Don't delete them from the run dir.

- **Overpass timeouts.** The public Overpass endpoints (and the `bbox` MCP over them)
  time out under load, especially broad `shop`+`way` queries. Narrow the tag list and the
  bbox, or retry. POIs are non-blocking — an empty `osm.json` still renders the map.

- **Edge-of-town superstore internal map — use road-following (Phase 2, default).** A
  bypass Tesco is essentially ONE shared stop plus a couple of loops, so the *classic*
  straight-chord internal map is weak there. `build_internal_place_roads.js` (the default)
  makes the lines follow the streets and fixes it — validated on Tesco Extra v1.1 (sparse)
  and Town Centre v1.1 (dense, no regression). Classic is now only a fallback for a place
  with a **single served stop** (match_routes draws no line, so chords are all you have).

- **Cross-locality place → clipped, off-centre internal map (FIXED, automatic).** The
  town engine's internalRoads fit set is "stops sharing the ANCHOR's ATCO locality
  prefix" (fit the town core, let tails run off-frame). A place walkshed often spans
  MORE than one locality — St Neots Tesco straddles Eynesbury + St Neots
  (`0500HEYNE*` + `0500HSTNS*`), so the prefix fit landed on 3 of 11 drawn stops and the
  map fitted to that fraction (routes clipped at the frame, whole map shoved high).
  `build_internal_place_roads.js` now auto-injects `internalRoads.fitExtra` = **all**
  drawn stops (routes_intown is already walkshed-clipped, so that's the right extent) and
  defaults `fitMargin` to 8 mm for road-tail/arrow clearance. Override either in
  `routes.json` `internalRoads` if you need to.

- **Orphan "River Great Ouse" label (FIXED, automatic).** With NO `features` config,
  gen_internal synthesises a default river feature (a St Ives inheritance) from
  `river_geo.json`. Most places have no river in the walkshed (`river_geo.json = []`), so
  only the hardcoded LABEL rendered — floating with no line. `build_internal_place.js`
  now writes `overrides.json` `{internal:{features:{river:{hide:true}}}}` when there's no
  `features` config and no river geometry (merges, so a hand viewport survives). A place
  that DOES declare a river (Town Centre: `features:['river']` + real `features_geo.json`)
  is untouched.

- **Map sits too high / want it lower on the page.** After the fit fix the map auto-centres
  in the map area, but road tails can make it read slightly high. Nudge it with an
  `overrides.json` frozen viewport: capture the auto fit with `EDITOR_KEYS=1 node gen_internal.js`
  (prints `VIEWPORT {…offY…}` on stderr), add ~12–16 mm to `offY`, and write
  `{internal:{viewport:{…}}}` (commit it as an S3 output so `pull S3` carries it into S4).
  Tesco Extra v1.2 uses `offY+16`. Frozen viewports don't re-fit on a data change — re-author
  if the route network changes.

- **Road-following version stamp = `Map vv1.0`.** gen_internal stamps `· Map v<version>`
  and adds its own leading `v`; the place `routes.json` `version` is `"v1.0"` (also with a
  `v`), so the naive result is a double-`v`. `build_internal_place_roads.js` strips the
  leading `v` from `LEAFLET_VERSION`, giving `Map v1.0`. Also **bump the `version` field**
  when you `--bump` the S4 folder, or the stamp (config version) and folder version drift.

- **stage.js `--based-on` with spaced paths.** `$(stage.js latest S2 | xargs basename)`
  breaks on the space in `…\St Neots Tesco Extra\`. `--based-on` is optional metadata;
  either quote properly or omit it — the commit still succeeds.

---
Added during the Beaconsfield Waitrose build (2026-07-21 — first place leaflet OUTSIDE
the Cambridgeshire GTFS region):

- **A place in another GTFS region is a `--db` switch, not a setup.** `gtfs_chains.py` and
  `gtfs_query.py` take `--db PATH` / `$CAMBS_GTFS_DB`. If the town has already been
  leafletted (so its region sqlite exists — e.g. `_gtfs/buckinghamshire.sqlite`), just
  `export CAMBS_GTFS_DB=<that sqlite>` for the whole session. No region registry / GTFS
  build is needed here — that was the town skill's job. Beaconsfield Waitrose reused the
  Bucks sqlite built for the Beaconsfield *town* leaflet with zero new data work.

- **`aggregate_destinations.js` reads `place.json` from the CWD.** It's an S1 output, so in
  the S2 run dir you must **copy it in first** (`cp <S1>/place.json .`) or it throws ENOENT.
  (The pipeline commits it at S1; nothing auto-pulls it into S2.)

- **Keep `placeTitle` SHORT — it's a fixed 11 pt at x=6 and the Services panel is at
  x=200 mm.** gen_internal doesn't shrink the title to fit, so a long place title overruns
  the panel (and any top feature label). Place titles are naturally longer than the town's
  "Buses within X", so trim to e.g. `"Buses serving Waitrose"` (≈22 chars fits) and let the
  POI labels + the external map carry the town name. Budget ≈ 34 chars before it hits x=200.

- **Don't set the external `note` — it duplicates the subtitle and crosses a spoke.** The
  external subtitle already says "where you can get to, and which buses take you there"; a
  `D.note` repeating that renders as one long line from x=10 that cuts across a top/centre
  spoke (Amersham). Omit `note`. Put any real caveat (e.g. "school services 604/624 also
  call, closed-door — not shown") on the **internal** map via top-level `routes.json`
  `mapNotes:[{text,x,y,size,color}]` in bottom-edge white space instead.

- **Borrow the town's `features_geo.json` instead of re-querying Overpass geometry.** When
  the place is inside an already-built town, the town S2 already has `features_geo.json`
  (river/railway/road polylines) and `roads_geo.json`. Overpass `return_geometry` queries
  time out often; clip the town's feature polyline to ≤~0.9 km of the place point and write
  a place `features_geo.json` (+ a `features` block in `routes.json`) rather than re-pulling.
  Beaconsfield Waitrose reused the town's Chiltern Main Line this way.

- **A nearest-stop distance check is a cheap standalone sanity test.** A route can serve
  the *town* but not the *place*: X74 serves Beaconsfield but its nearest stop to Waitrose
  is 2.6 km (the A355/M40 services), so it's correctly absent from the 0.8 km service radius.
  Before dismissing a "missing" route as a data gap, compute its nearest-stop distance to
  the place — if it's genuinely far, the exclusion is real.

- **Routes that exit toward the panel side (east) collide with the Services/Key panel —
  fix with `internalRoads.rotationDeg`, decisively.** The panel is reserved at x=197–297mm
  (map region is x=6–196). When a place sits on a corridor whose routes run off-frame to the
  **east** (e.g. the Simpson Centre on the A40 Wycombe End, routes continuing to the Old Town
  core / Gerrards Cross), the eastern route fan + terminus badges land at x≈197–202 and
  overprint the panel/Key. `fitMargin` barely helps (the tails are pulled to the frame edge,
  not fitted to stops). The lever is **rotation**: swing the fan up-and-left clear of the
  panel. Be decisive — mild values just *smear* the fan vertically along the panel edge
  (Simpson Centre: -8° and -20° both still overlapped; **-35° cleared it** to top-centre,
  x<180). Set it in `routes.json` `internalRoads.rotationDeg` (0 = north up; the auto PCA
  value is printed as `rotation°` on build). Diagonal corridors read fine.

- **Never rewrite `routes.json` with `python … json.dump` under Git-Bash on Windows.**
  Python opens the file with the platform default codepage (cp1252), so UTF-8 en-dashes
  (`–`, `·`, `—` in route descriptions) are read as `â€"`/`Â·` and written back as mojibake
  that then bakes into the SVG/JPG panel text. Edit config with the Edit/Write tools (UTF-8),
  or if scripting, pass `encoding='utf-8'` on BOTH open() calls and `ensure_ascii=False`.

---
Added during the community-bus-maps **portal integration** of the place engine
(2026-07-25 — the portal now vendors this engine; see below):

- **Re-render after ANY `routes.json` edit, or the S5 SVG goes stale relative to its
  config.** Several worked examples had **drifted**: their shipped `internal.svg`/`external.svg`
  no longer matched the `routes.json` sitting beside them, because config was hand-tweaked
  after the last render without re-running S4/S5. Beaconsfield Waitrose was the clearest —
  the shipped SVG had a `mapNotes` school-services line, a `placeShort`-length title, and a
  rail label at `y=20`, while its stored `routes.json` had **no `mapNotes`**, a *longer*
  `placeTitle`, and `y=18`. This isn't cosmetic: anything that renders **from the stored
  `routes.json`** (a re-render, an audit, or the portal importer below) reproduces the
  **config**, not the stale picture. After editing config, re-run S4→S5 (`--bump`) so the
  folder is internally self-consistent, then eyeball the JPG.

- **The portal (`community-bus-maps`) vendors this engine and renders from `routes.json`.**
  Place render dirs carry NO generators (the town skill copies its generators into each
  town's render dir; this skill doesn't), so the portal keeps a vendored copy in
  `engine/place/` (`gen_internal.js` + `gen_external_places.js` + a `gen_internal_place.js`
  wrapper doing the title fix + `v`-strip) and copies it into each place map's `data/` at
  import. A place's expert framing — the `overrides.json` this skill writes for river-hide
  (and any frozen viewport) — becomes the portal map's `base-overrides.json`, merged UNDER
  the customer's colour/POI edits. Consequence for THIS skill: the portal's `v1.0` baseline
  is whatever the **current** `routes.json` produces — so a drifted payload (above) imports as
  the *config's* map, not the stale shipped one. Keep them in sync. (`npm run verify:place`
  proves the vendored engine reproduces a skill-rendered leaflet byte-for-byte.)
