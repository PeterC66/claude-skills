# P1–P5 pipeline — full walkthrough (with the St Neots Tesco Extra numbers)

`%TSK%` = town skill assets (shared engine). `%PSK%` = this skill's assets.
Worked example folder: `…\Buses\Places\St Neots Tesco Extra\` (v1.0).

```bash
PSK="C:/u3a St Ives/.claude/skills/make-place-bus-leaflet/assets"
TSK="C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets"
cd ".../Buses/Places"
node "$TSK/stage.js" init "$PWD/St Neots Tesco Extra" "St Neots Tesco Extra"
cd "St Neots Tesco Extra"
```

## P1 — place  (→ stage.js S1)
```bash
S1=$(node "$TSK/stage.js" new S1); cd "$S1"
python "$PSK/resolve_place.py" "Tesco Extra" --town "St Neots" --radius-m 500
#   -> Tesco Extra [shop/supermarket] 52.21023,-0.26990  (chosen)
#   review place-candidates.json; --pick N if the auto-pick is wrong
node "$TSK/stage.js" commit S1 "$S1" --outputs place.json,place-candidates.json,gtfs-services.json
```
`resolve_place.py` auto-picks the first candidate whose OSM class is place-like
(shop/amenity/leisure/railway/…). It sets `ambiguous:true` if another candidate shares
the name — then confirm with `--pick`.

## P2 — geometry  (→ S2)
```bash
S2=$(node "$TSK/stage.js" new S2); cd "$S2"
# 1. standalone chains from GTFS (service radius 0.8 km)
python "$PSK/gtfs_chains.py" --near "52.2102330,-0.2698983,0.8" --town "St Neots Tesco Extra"
#   -> 6 routes: 18, 18A, C2, 150, 61EY, 69   (routes_full_atco/atco2ll/atco2name/gtfs-services)
# 2. walkshed clip for the internal map
cat > walkshed_cfg.json <<'EOF'
{ "center":[52.2102330,-0.2698983], "radiusM":600, "buf":1, "circular":["61EY"], "maxEdgeKm":1.0 }
EOF
node "$PSK/derive_walkshed.js" routes_full_atco.json atco2ll.json walkshed_cfg.json routes_intown_atco.json
# 3. POIs via the bbox MCP over the walkshed bbox -> osm.json ; write stubs:
#    osm2.json = {"elements":[]} ; river_geo.json = []   (gen_internal hard-requires all three)
# 4. destination aggregation for the external map
node "$PSK/aggregate_destinations.js" routes_full_atco.json atco2ll.json atco2name.json place.json 1.2
#   -> destinations.draft.json + a printed table of reachable places
node "$TSK/stage.js" commit S2 "$S2" --outputs routes_full_atco.json,atco2ll.json,atco2name.json,routes_intown_atco.json,osm.json,osm2.json,river_geo.json,walkshed_cfg.json,destinations.draft.json
```

**Radius tuning:** at 500 m the Tesco example draws only the 3 routes that stop AT Tesco
(150/61EY/C2 + 69 stub); at 800 m the 18/18A (nearest stop 741 m) come in but the map
sprawls. 600 m + `maxEdgeKm:1.0` is the shipped compromise. Choose per place by stop density.

## P3 — config  (→ S3)
Start from `%PSK%\routes.example.place.json` (this is the worked example's own
`routes.json`). Fill palette/`textOn`, `operators`, `anchor` (`0500HEYNE001` = the Tesco
stop), `placeTitle`, `badgeLabels` (`61EY`→`61`), and the **curated** `destinations[]`
(from the draft — merge synonym clusters, relabel to town names, mark limited/day-only).
```bash
S3=$(node "$TSK/stage.js" new S3); cp routes.json "$S3/"
node "$TSK/stage.js" commit S3 "$S3" --outputs routes.json
```

## P4 — generate  (→ S4, versioned)
```bash
S4=$(node "$TSK/stage.js" new S4 --bump major); cd "$S4"   # --bump minor for a re-style, same data
node "$TSK/stage.js" pull S2 .; node "$TSK/stage.js" pull S3 .
# internal — ROAD-FOLLOWING (default): pull_roads + match_routes + gen_internal + title fix
TSK="$TSK" node "$PSK/build_internal_place_roads.js"   # -> roads_geo.json, routes_paths.json, internal.svg
#   (needs routes_full_atco.json in the dir — comes from `pull S2`; routes.json must have internalRoads,
#    which the wrapper defaults to true. For a genuinely single-stop place fall back to the classic
#    build instead: `TSK="$TSK" node "$PSK/build_internal_place.js"` with NO internalRoads key.)
node "$PSK/gen_external_places.js"                    # external.svg (aggregated spokes)
node "$TSK/stage.js" commit S4 "$S4" --outputs internal.svg,external.svg,roads_geo.json,routes_paths.json
```
Bump the `version` field in `routes.json` (P3) to match the S4 folder version so the
internal map's `· Map vN.N` stamp agrees (the road-following build stamps the version).

## P5 — render  (→ S5)
```bash
S5=$(node "$TSK/stage.js" new S5); cd "$S5"
node "$TSK/stage.js" pull S4 .
node "$TSK/render.js" internal.svg internal.jpg
node "$TSK/render.js" external.svg external.jpg
node "$TSK/stage.js" commit S5 "$S5" --outputs internal.jpg,external.jpg,internal.svg,external.svg
# refresh _latest
mkdir -p "../../St Neots Tesco Extra/_latest"; cp internal.jpg external.jpg "../../St Neots Tesco Extra/_latest/"
```
**Always open the JPGs** and eyeball them (the external map should read as a clean
hub-and-spokes; the internal map should be a tight cluster, not sprawling).
