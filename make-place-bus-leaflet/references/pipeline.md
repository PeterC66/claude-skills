# P1–P5 pipeline — full walkthrough (with the St Neots Tesco Extra numbers)

`%TSK%` = town skill assets (shared engine). `%PSK%` = this skill's assets. Worked example folder: `…\Buses\Areas\St Neots\Places\St Neots Tesco Extra\` (v1.0).

**Every block below runs in ONE shell session, started from the buses-data repository root (`C:\u3a St Ives\Using AI\Buses`).** The first block assigns `$PSK` and `$TSK` — the same two paths `%PSK%` and `%TSK%` name in the prose — and `cd`s into the place's parent folder; each block after it continues where the previous one left off, so the `cd`s accumulate and are not repeated. The only other placeholder is the place name itself, which is the map folder's name exactly as `manifest.json` has it.

```bash
PSK="C:/u3a St Ives/.claude/skills/make-place-bus-leaflet/assets"
TSK="C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets"
cd ".../Buses/Areas/St Neots/Places"   # or Places/_standalone if the town has no area map
node "$TSK/stage.js" init "$PWD/St Neots Tesco Extra" "St Neots Tesco Extra"
cd "St Neots Tesco Extra"
```

## P1 — place  (→ stage.js S1)
```bash
S1=$(node "$TSK/stage.js" new S1); cd "$S1"
python3 "$PSK/resolve_place.py" "Tesco Extra" --town "St Neots" --region "Cambridgeshire" --radius-m 500
#   -> Tesco Extra [shop/supermarket] 52.21023,-0.26990  (chosen)
#   review place-candidates.json; --pick N if the auto-pick is wrong
node "$TSK/stage.js" commit S1 "$S1" --outputs place.json,place-candidates.json,gtfs-services.json
```
`resolve_place.py` auto-picks the first candidate whose OSM class is place-like (shop/amenity/leisure/railway/…). It sets `ambiguous:true` if another candidate shares the name — then confirm with `--pick`. `--region` is **required** and is checked against `_gtfs/regions.json` before any network call: it narrows the geocode *and* becomes the dataset a standalone place is change-scanned against, so there is deliberately no default (OA-025).

## P2 — geometry  (→ S2)
```bash
S2=$(node "$TSK/stage.js" new S2); cd "$S2"
cp "$S1/place.json" .                      # aggregate_destinations reads place.json from CWD
# For a place in ANOTHER GTFS region whose town is already built, point --db at its sqlite
# (or `export CAMBS_GTFS_DB=…/buckinghamshire.sqlite` once for the session). No setup needed.
# 1. standalone chains from GTFS (service radius 0.8 km)
python3 "$PSK/gtfs_chains.py" --near "52.2102330,-0.2698983,0.8" --town "St Neots Tesco Extra"  # [--db PATH]
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
node "$TSK/stage.js" commit S2 "$S2" --outputs routes_full_atco.json,atco2ll.json,atco2name.json,routes_intown_atco.json,osm.json,osm2.json,river_geo.json,walkshed_cfg.json,destinations.draft.json,place.json
```
**`place.json` must be in this `--outputs` list** (it's already physically copied into `$S2` above for `aggregate_destinations.js`). `pull` only copies files a stage *declared*, so leaving it off here is how the file dead-ends after S1 — see `references/gotchas.md`.

**Radius tuning:** at 500 m the Tesco example draws only the 3 routes that stop AT Tesco (150/61EY/C2 + 69 stub); at 800 m the 18/18A (nearest stop 741 m) come in but the map sprawls. 600 m + `maxEdgeKm:1.0` is the shipped compromise. Choose per place by stop density.

## P3 — config  (→ S3)
Start from `%PSK%\routes.example.place.json` (this is the worked example's own `routes.json`). Fill palette/`textOn`, `operators`, `anchor` (`0500HEYNE001` = the Tesco stop), `placeTitle`, `badgeLabels` (`61EY`→`61`), and the **curated** `destinations[]` (from the draft — merge synonym clusters, relabel to town names, mark limited/day-only).
```bash
S3=$(node "$TSK/stage.js" new S3); cp routes.json "$S3/"
node "$TSK/stage.js" commit S3 "$S3" --outputs routes.json
```

## P4 — generate  (→ S4, versioned)
**A PULL NO LONGER LETS AN UNDECLARED FILE CLOBBER ONE ALREADY THERE (2026-08-29, OA-164), AND YOU SHOULD STILL READ WHAT IT SAYS.** `pull` copies the whole run FOLDER, while `commit` and the manifest speak only of the outputs a stage DECLARED, so anything else left lying in a run folder rides along on every pull. Beaconsfield Waitrose's S2 folder from 21 July holds a `routes.json` it never declared — the July draft — and pulling S3 and then S2 put that draft on top of five weeks of curated config. The sheet rebuilt clean, the byte gate said PASS, and the external quietly lost every intermediate stop name, every journey time, its QR code and its `checkedAt`: **the byte gate cannot see this, because `ci-reference` is re-synced from the same run and the sheet is then compared against itself.** A declared output still overwrites; an undeclared extra is copied only where the destination has no such file, and every skip prints `kept the file already there`. **If you see that line, the folder it names is dirty — go and look.** Three places carry such a file today. To ask the whole estate at once, run this from anywhere — the path is a real path on this machine, not a placeholder:

```bash
node "C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/stray_outputs.js" --buses "C:/u3a St Ives/Using AI/Buses"
```

It reports only the dangerous direction — an EARLY stage holding a file a LATER stage declares — because a downstream folder holding an upstream file is ordinary and everywhere, and listing those would bury the eight real ones in seven hundred lines. It is **reported, not gated**, and `--strict` exits 1 for whoever wants that once the estate is clean.

```bash
S4=$(node "$TSK/stage.js" new S4 --bump major); cd "$S4"   # --bump minor for a re-style, same data
node "$TSK/stage.js" pull S1 .; node "$TSK/stage.js" pull S2 .; node "$TSK/stage.js" pull S3 .
# pull S1 too, NOT just S2 — place.json is an S1 output; only pulling it in here (rather
# than trusting it rode along inside S2) is what keeps this stage correct even if a future
# S2 commit forgets to list it (see references/gotchas.md).
# internal — ROAD-FOLLOWING (default): pull_roads + match_routes + gen_internal + title fix
TSK="$TSK" node "$PSK/build_internal_place_roads.js"   # -> roads_geo.json, routes_paths.json, internal.svg
#   (needs routes_full_atco.json in the dir — comes from `pull S2`; routes.json must have internalRoads,
#    which the wrapper defaults to true. For a genuinely single-stop place fall back to the classic
#    build instead: `TSK="$TSK" node "$PSK/build_internal_place.js"` with NO internalRoads key.)
node "$PSK/gen_external_places.js"                    # external.svg (aggregated spokes)
node "$TSK/stage.js" commit S4 "$S4" --outputs internal.svg,external.svg,roads_geo.json,routes_paths.json,place.json
```
Bump the `version` field in `routes.json` (P3) to match the S4 folder version so the internal map's `· Map vN.N` stamp agrees (the road-following build stamps the version). **`place.json` must be in the S4 `--outputs` list too** — the portal's `import-map.mjs --kind place` requires it in `--src`, and `pull` never reaches back further than one stage.

## P5 — render  (→ S5)
```bash
S5=$(node "$TSK/stage.js" new S5); cd "$S5"
node "$TSK/stage.js" pull S4 .
node "$TSK/render.js" internal.svg internal.jpg
node "$TSK/render.js" external.svg external.jpg
node "$TSK/stage.js" commit S5 "$S5" --outputs internal.jpg,external.jpg,internal.svg,external.svg,place.json
# refresh _latest (also re-runs collect-maps.ps1 -All — do not replace with a raw cp)
node "$TSK/refresh_latest.js" "../.."
```
**Always open the JPGs** and eyeball them (the external map should read as a clean hub-and-spokes; the internal map should be a tight cluster, not sprawling).

**Mandatory, no exceptions:** run `refresh_latest.js` on the place dir as the last step of *any* change that touches this place's rendered output — not just a fresh P5, but also a hand-patch to a JPG/SVG already sitting inside a committed S5-render folder (no version bump). Skipping it is exactly what left `_latest` and `Collected_latests` stale for High Wycombe Aldi and St Neots Town Centre on 2026-08-08 — the render was correct on disk, but nothing downstream knew.

