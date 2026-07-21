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

- **Edge-of-town superstore = single-stop place.** A bypass Tesco has essentially ONE
  shared stop plus a couple of residential loops, so the classic internal map is weak
  there (documented Phase-1 limitation; Phase-2 road-following fixes it — see
  internal-reuse.md). Dense town-centre/school places render much better in classic mode.

- **stage.js `--based-on` with spaced paths.** `$(stage.js latest S2 | xargs basename)`
  breaks on the space in `…\St Neots Tesco Extra\`. `--based-on` is optional metadata;
  either quote properly or omit it — the commit still succeeds.
