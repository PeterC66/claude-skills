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
  leading `v` from `LEAFLET_VERSION`, giving `Map v1.0`. ~~Also **bump the `version` field**
  when you `--bump` the S4 folder~~ — **no longer manual (2026-07-25):** `stage.js pull` now
  rewrites the field to match the versioned run dir, and `stage.js commit S4|S5` refuses a
  mismatch. It preserves the place convention's leading `v` (`"v1.0"` → `"v1.2"`), so the
  double-`v` fix above is unaffected. See the town skill's `references/s3-config.md`.

- **`LEAFLET_VERSION` only reaches the INTERNAL map.** `build_internal_place_roads.js` passes it
  to `gen_internal.js`, but `gen_external_places.js` reads `routes.json` `version` directly — so
  using the env var as a version workaround stamps the two sheets **differently**. That is exactly
  what happened to `St Neots Tesco Extra v1.1` (internal `Map v1.1`, external `v1.0 · Summer 2026`,
  `routes.json` `"v1.0"`) — a superseded run, left as built. Since the field is now kept in step
  automatically, **set the version in `routes.json`, not in the environment.**

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

---
Added during the High Wycombe Aldi (Tannery Road) build (2026-07-30 — the first place
with a **double-digit route count**, 11 drawn services, and 14 external spokes):

- **A chain-store name is almost always ambiguous — always eyeball `place-candidates.json`.**
  "Aldi, High Wycombe" returned three stores; `resolve_place.py`'s auto-pick (first
  place-like class) took **Booker**, not the Tannery Road one asked for. `ambiguous:true`
  fired correctly. Re-run with `--pick N` and then **confirm the postcode in
  `place.json.display`** against the request — that is the cheapest proof you leafleted
  the right branch. Put the "which branch, and which ones you did NOT pick" note in the
  place README; a reader can't tell from the map.

- **`derive_walkshed radiusM` is the in/out lever for a whole route group — set it from the
  measured nearest-stop table, not the 500 m default.** At 500 m the Aldi lost 32/32A/34
  (nearest stop 507 m); 550 m brought all three in for +0 sprawl (`maxEdgeKm` 1.0 still
  caps the tails). Print the per-route nearest-stop distance BEFORE choosing `radiusM` —
  a group sitting 5–10 m outside a round-number radius is the common case, and dropping
  three routes for 7 m is indefensible.

- **`tripsAtTownPerWeekSample` in `gtfs-services.json` is trips-per-PATTERN, not per week —
  never paraphrase it as a frequency.** Route 27 showed `7` and the *town* leaflet calls it
  "a few journeys a week"; the `calendar` table says that 7-trip pattern runs Mon–Fri, i.e.
  **7 journeys every weekday**. Conversely 32A reads "Daily" from the day-flag union while
  the real split is 24 Sunday trips vs 6 across all of Mon–Sat — a Sunday service. Join
  `stop_times → trips → calendar` at the place's own stop and group by day-flags before
  writing any `internalDesc` day/frequency text. (The slim BODS sqlite has no times, so
  trips-per-day-pattern is as fine-grained as it gets — that's enough.)

- **`internalCorridors` must be earned: read `corridors_report.json`, don't assume.** 32 and
  32A have *identical* walkshed stop lists, so bundling them looked obvious — but
  `match_routes` builds from `routes_full_atco.json` `canonical[0].stops`, where 32A adds a
  Hennerton Way/Totteridge loop. The report scored 32A at **57 %** co-running and the engine
  warned; the fix is a distinct colour, not a bundle. The 102/103/104/105/M40/X74 family
  scored 100 % and bundling six routes into one lane is what makes an 11-route close-up
  readable at all.

- **A route absent from `routeOrder`/`palette` is silently NOT drawn — that is the clean way
  to drop a school variant.** 37M map-matches and survives `derive_walkshed`, but omitting
  it from `routeOrder` keeps it off the map without a second S2 run or a `skipRoutes` edit.
  Say so in a `mapNotes` footnote.

- **Name the place with a FORCED POI label, not the anchor label.** Two "Aldi"s 6 mm apart
  (anchor label + POI) reads as a mistake. Use `overrides.json`
  `internal.pois["shop:Aldi"] = {force:true, label:{offset:{dx,dy}, anchor:"start"}}` for the
  store and give the anchor the plain stop name (`"Ford Street stops"`). A manual `offset`
  **skips de-collision entirely**, so pick the offset off a cropped render — the auto
  placement had dropped both the store and the industrial-estate labels as collisions.
  Get the exact POI keys (`shop:Aldi`, `industrial:Tannery Road Ind Est` — post-`poi.tidy`)
  by running `EDITOR_KEYS=1 node gen_internal.js` and grepping `data-kind="poi"`.
  `placeLabel` ignores `label.text`, so the printed text is always the tidied OSM name.

- **Never put "·" (U+00B7) in `anchorLabel`.** The anchor label is drawn with
  `stroke="#fff" stroke-width="0.7" paint-order="stroke"`, and a 0.7 mm white outline around
  a middle dot renders as a small filled **square** at 3.0 pt. Panel text (no halo) is fine.
  Use a plain word, "/" or "(...)".

- **Feature `labelPos` is absolute page mm with NO collision logic — site it off a render.**
  Defaults left "River Wye" floating in empty space and "Chiltern Main Line" nowhere near
  the line. Read the drawn line's position off the JPG (`mm = px/3508*297`, `px/2480*210`)
  and pin the label beside it.

- **Beyond ~8 external spokes, SOLVE the layout; don't nudge bearings.** 14 spokes on A4
  collided every way at first (nodes overlapping each other, the legend and the footnote;
  badge rings touching near the hub). What worked: a throwaway script that mirrors
  `gen_external_places.js` geometry exactly — `wrap(label,13)`, node
  `w=max(20,maxlen*1.95+5)`, `h=5.4+nlines*3.8`, badges at `r=24+i*7.2`, spoke from `r=16`
  to `t-9` — then (1) keep the true-bearing clockwise ORDER but relax to a **min 19° gap**
  (below that the `r=24` badges of adjacent spokes touch), (2) **pin the longest badge row
  to the longest clear ray** (11 badges need ~108 mm, so due west; at its true 296° the
  legend blocks it), (3) allocate each remaining spoke the largest radius whose node box
  clears the page, the reserved blocks and every node placed so far (+2 mm daylight), and
  (4) freeze the result as `terminus{x,y}`. Order-preserving + pinned cost the western trio
  ~26–30° of fidelity, which is normal for a schematic. Node width is driven by the LONGEST
  line, so trimming a `sub` ("Central Bus Station" → "Bus Station") is the cheapest way to
  break a collision.

- **Keep `placeShort` ≤ ~6 characters — the hub box overprints the innermost badges.** The
  hub is `w = max(26, len*2.5+8)` mm wide but badges start at only `r=24`, so anything past
  ~6 chars (`"Aldi Tannery Rd"` → 45.5 mm, half-width 22.8) swallows the first badge of every
  horizontal spoke. `"Aldi"` (26 mm) clears them. The full name is already in the title.

- **Don't set an external `note` (again) and don't fight the hardcoded legend.** `lx=10,
  ly=42` and the footnote at `y=203` are not configurable — treat x 6–106 / y 34–54 and
  y > 199 as no-go zones in the layout solver.
