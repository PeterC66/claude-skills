# Stage 2 — Geometry

Detailed steps for S2 of the `make-bus-leaflet` workflow. See SKILL.md for the stage
model and `stage.js`, and `references/linear-features.md` for the linear-features
concept. `%SK%` = the skill's `assets` folder. `$S2` = the S2 run folder.

S2 now collects the **full route + stop data as standard** (correctness over speed):
every route's complete ordered chain **to its terminus, both directions**, with a name
and lat/lon for **every** stop in those chains. The map draws a derived in-town subset,
but the full record is stored (and is what the verification pass re-checks against).

Three route files come out of S2:
- **`routes_full_atco.json`** — the complete stored record. `{ "<route>": { directions:[{name,stops:[ATCO…]}], canonical:[…], all:[ATCO…] } }`. `directions` is merged across **all** of the route's bustimes sub-services (e.g. 301 + 301V + 301S + 301X); `canonical` is the **first** slug only (the route's primary pattern).
- **`routes_intown_atco.json`** — the **display subset the internal map draws**: each route clipped to the town core + a directional edge buffer (see step 3).
- **`routes_atco.json`** — kept as an **alias of `routes_intown`** (copy it) for back-compat; the generator prefers `routes_intown_atco.json` and falls back to `routes_atco.json` for towns built before this standard.

## Steps

1. `S2=stage.js new S2`; `cd "$S2"`; `stage.js pull S2` to carry forward the previous run's OSM/feature geometry (`osm.json`, `osm2.json`, `features_geo.json`, `river*.json`, `pois.json`) if refreshing an existing town.

2. **Full both-direction chains (bustimes).** Get the service slugs from the locality page:
   `curl -sA "$UA" https://bustimes.org/localities/<slug> | grep -oE '/services/[a-z0-9-]+' | sort -u`.
   Write **`route_slugs.json`** = `{ "<route>": ["<slug>", …] }` (list every sub-service of a route together — the first is the canonical pattern). Then:
   `node "%SK%\pull_routes_full.js" route_slugs.json .`  → `routes_full_atco.json` + `_all_atco.json` (+ `svc_<slug>.html`).
   - The puller splits each service page into per-direction ordered ATCO lists by the `<h2>Place A - Place B</h2>` / `<h2>Place A to Place B</h2>` headers (bustimes uses **both** ` - ` and ` to `), excluding the operator `<h2 itemprop="name">` and the "Possibly similar services" `<h2>` (it stops collecting stops at the first such heading, so links to *other* services don't leak in). A circular shows one unsplit list.

3. **Backfill coords + names for every stop.** `node "%SK%\backfill_coords.js" _all_atco.json "<S,W,N,E>" atco2ll.json atco2name.json` — bbox must cover **all** termini (St Ives's spans Cambridge↔March↔Ramsey↔Huntingdon↔Kimbolton). It pulls OSM `node[highway=bus_stop]["naptan:AtcoCode"]` in the bbox (UA header, else 406), keeps existing entries, and falls back to the bustimes stop page (`#1x/<lat>/<lon>`, `/`-separated) for the handful OSM lacks a NaPTAN node for. Aim for 100 % coverage of `_all_atco.json`.

4. **Derive the in-town display subset.** Write **`intown_cfg.json`** then `node "%SK%\derive_intown.js" routes_full_atco.json atco2ll.json intown_cfg.json routes_intown_atco.json`, and `cp routes_intown_atco.json routes_atco.json`.
   `intown_cfg.json = { "prefix":"0500HSTIV", "extraCore":["0500HHOLY010"], "buf":1, "circular":["300"], "anchor":"0500HSTIV002", "maxEdgeKm":3.5 }`:
   - **core** = stops with the town's ATCO locality `prefix` + named `extraCore` stops (a retail-park stop just outside the locality, e.g. Morrisons `0500HHOLY010`).
   - **buf** = how many stops beyond the core boundary to keep on each arm (1 = a single edge stop that shows direction). At `buf:0` the result reproduces a pre-full-data locality-only sequence.
   - **maxEdgeKm** (with `anchor`) = drop a buffer (non-core) stop if it's farther than this from the anchor, so a route with **no intermediate stop near town** (an express) doesn't draw a long spoke to a village 8 km away. Tune to the actual town edge (~3.5 km for St Ives). Core stops are kept regardless.
   - **circular** = routes whose first stop is appended to close the loop (`300`).
   The deriver uses each route's **canonical** pattern (not minor variants) so e.g. a Saturday-only town loop (301S) doesn't make 301 appear to circle the whole town.

5. **Linear features (1–3 per town)** — unchanged: for each chosen feature run `%SK%\overpass-feature.txt` (fill bbox + the type's selector) → `features_geo.json` keyed by feature key. For a **new town**, list the candidates and **ASK** which 1–3 to include, then lock in S3's `routes.json` `features[]`. Keep using **curl** here (needs `out geom;` way-geometry the MCP may not return). Legacy single-river pull `%SK%\overpass-river.txt` → `river_geo.json` kept as fallback.

6. **POIs (OSM)** — unchanged: `bbox` MCP `search_overpass`, or `%SK%\overpass-pois.txt` → `osm.json` / `osm2.json` (the generator builds POIs from raw OSM via `classify()`, not from `pois.json`).

7. `stage.js commit S2 "$S2" --outputs atco2ll.json,atco2name.json,osm.json,osm2.json,features_geo.json,river_geo.json,routes_full_atco.json,routes_intown_atco.json,routes_atco.json`.

## Notes / gotchas
- The far edge buffer stops can push the map fit out; enable/tune `routes.json` `internalZoom` (S3) to compress everything beyond the town core (St Ives v4.0 uses `{corePct:0.9, comp:0.18}`).
- A two-arm route (e.g. 9 = Hemingfords arm + villages arm) keeps **both** edge buffers, so it correctly fans south into two stubs; the merged bustimes order can zigzag (route serves a retail park then leaves the other way) — that's real and acceptable on a schematic.
- **`match_cfg.json` (internalRoads towns) also carries `reachExtend`** — the fix for a "to X" continuation arrow that lands at an interior junction instead of the frame edge. Shape: `"reachExtend":{ "<route>":{ "start":N, "end":N } }`. After `pull_roads.js` sizes the OSM bbox from the drawn stops, it unions in `N` more of each listed route's real full-chain stops (at the chain's `start`/`end`, matching `contStart`/`contEnd`) so `match_routes.js` has road geometry to trace out past where the fisheye+frame cut the tail. Candidates are filtered through the SAME `viaPrefixes`/`viaExclude` — so if a route's onward MAIN journey uses a prefix those rules currently drop (to exclude a variant loop), **add that main-journey prefix to `viaPrefixes`** too, or the extension is filtered away. Keep `N` small (1–2 — the fisheye pushes the first out-of-town stop well past the frame); check each end with `DBG_TRIM=1` (cut must land on MX0/MX1/MY0/MY1) and watch `roads_geo.json` size/pull time. `routes_intown_atco.json` is untouched — this feeds extra geometry only, not extra drawn stops. See the truncated-tails entry in [gotchas.md](gotchas.md) for the full trap list. (St Ives item-3, 2026-07-04.)
- The terminus badges (`internalTermini` + `terminiLabels`, S3) sit at each route's farthest edge stop. After adding edge buffers, sanity-check that each badge's destination matches the arm it landed on (a route that genuinely splits can land the badge on the wrong arm — fix the label or hand-tidy in the editor).
