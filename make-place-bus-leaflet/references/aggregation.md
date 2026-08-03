# Destination aggregation — the core new logic (`aggregate_destinations.js`)

The town skill's external map draws **one spoke per route**, each to its terminus. A
place leaflet answers a different question — *"where can I get to from here, and on
what?"* — so this module collapses routes into **reachable destinations**.

## Algorithm
1. **Reachable end-points.** For each route (full both-direction chain from
   `routes_full_atco.json`), take each direction's **terminus** stop. If that end lies
   inside the place walkshed (the route TERMINATES at the place — e.g. 150/61EY at
   Tesco), use the **other** end instead. Drop ends still inside the walkshed (a pure
   local loop with no outside end → reported under `localLoops`, not drawn).
2. **Geographic clustering.** Union-find over the end-points: any two within
   `clusterKm` (default 1.2) merge. This is what makes several stops that are really
   the same place — "Market Square" + "Bus Station" both = the town centre — collapse
   into ONE spoke.
3. **Build destinations.** Per cluster: `name` = most common stop name; `routes` = every
   route reaching it; `bearing` = true bearing from the place to the cluster centroid;
   `distKm` = distance. Sorted nearest-first. Written to `destinations.draft.json`.

## Curation (P3, human) — always required
The draft is a **starting point**, per the skill's "suggest, then confirm" rule. In
`routes.json` `destinations[]`:
- **Merge synonym clusters** the geometry couldn't (two nearby town-centre stops).
- **Relabel** raw stop names to reader-friendly place names ("Drummer St Bus Station" →
  `name:"Cambridge", sub:"Drummer St"`).
- **Mark** infrequent/limited arms (`limited:true` → drawn dashed; `sub:"Thu only"`).
- **Optionally add** `minutesToDestination` (a number, e.g. `26`) — an approximate scheduled
  journey-time line drawn under the destination name (`gen_external_places.js`). Absent =>
  byte-identical. Derive it with `%SK%\gtfs_duration.py <ATCO_PREFIX...> --route <n> --dest <name>`
  (from the town skill's `assets/`, reused unchanged) — see `make-bus-leaflet`'s
  `references/s3-config.md` `external[].minutesToDestination` for how it works and its gaps
  (round-trip services, DRT). The place skill has no `--fill` batch mode of its own yet since
  `destinations[]` is curated by hand; look up each spoke's minutes individually.
- **Drop** implausible spokes (a GTFS timing-point artifact — see gotchas).
- Keep bearings roughly true so the compass layout stays honest; hand-nudge via
  `overrides.json external.branches.<name>.bearing` or `.terminus{x,y}` if two collide.

## St Neots Tesco Extra result (clusterKm 1.2)
```
Market Square           359°   1.9km  18, C2      -> "St Neots town centre"
Newlands Cottages       130°  11.1km  C2          -> keep, "Thu only"
The White Horse         317°  15.1km  150
Bus Station              47°  18.5km  69          -> St Ives dir (verify; sparse trip)
Drummer St Bus Station   91°  26.9km  18, 18A     -> "Cambridge"
Local loops: 61EY
```
Five clean spokes around the compass — a good aggregation from six routes.

## Renderer contract (`gen_external_places.js` reads `routes.json`)
```jsonc
"destinations": [
  { "name":"Cambridge", "sub":"Drummer St", "bearing":91, "routes":["18","18A"],
    "distKm":27, "side":"up"?, "limited":false?, "terminus":{x,y}?,
    "minutesToDestination":26? }
],
"localLoops": [ { "route":"61EY", "label":"Eynesbury local circular (calls at Tesco)" } ]
```
Hub = the place ("you are here"); each spoke drawn at its bearing to a green
destination node; the destination's routes are a row of small badges just outside the
hub. Operator legend + local-loops list top-left. `overrides.json external{}` (hub,
branches, note) is honoured exactly like the town radial's.
