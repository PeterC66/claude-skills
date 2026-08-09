# The tube-map DIAGRAM engine (`internal-diagram.svg`, opt-in)

A fourth, optional image per town: a **fully abstract tube-map diagram** in the style of the hand-drawn St Ives leaflet ("St Ives Bus Leaflet 260505 Internal.jpg") — the representation Peter's client asked for on 2026-07-10. Where the octolinear **schematic** (schematic-engine.md) preserves each route's real SHAPE and warps it onto 45° angles, the **diagram** preserves only the TOPOLOGY: the sequence of junctions/stops/POIs and which routes share corridors. Every corridor collapses to one (or very few) long straight octolinear runs, leg lengths are normalised tube-map style, there is **no road skeleton**, and only a **curated subset of stops** is shown. First shipped: St Ives v6.6, 2026-07-10 (agreed conventions: current visual language + hand-drawn abstraction; content from stored data only; landscape unless a town needs otherwise; print-readiness deferred — managers pick their preferred map per town later).

## Architecture — same pre-stage pattern as the schematizer

`assets/diagram_internal.js` reads the S2/S3 data, solves the diagram layout, and re-emits the same file formats into a `diagram/` workspace (pseudo lat/lon, `rotationDeg:0`, `comp:1`), then runs the shared `gen_internal.js` there and copies the result out as `internal-diagram.svg`. Opt-in via `routes.json → internalDiagram{}` (absent ⇒ exits, zero effect); requires `internalRoads`.

**Render-side extensions live in `gen_internal.js` behind `if(ID)`, where `ID = RJ.internalDiagramRender`** — a key ONLY the diagram pre-stage writes into its workspace routes.json. It is deliberately NOT the town's own `internalDiagram{}` key: the geographic and schematic builds read the same town routes.json, and keying off it leaked the curated-stops filter into both (caught by an S4 size check in the v6.6 build; see gotchas.md).

## The solver (what differs from schematize_internal.js)

Reused verbatim: projection, junction-cluster contraction (fixpoint), corridor extraction, twin-corridor handling, octant snap + cyclic conflict DP, the LSQ core, weldLeg, the IDW warp field. Different:

1. **Graph = routes only.** No keyRoads — the diagram draws no road skeleton (workspace skeleton `#ffffff`; road NAMES still label along the route lines via gen_internal's existing road-label pass, which reads the solved SKEL).
2. **Corridor collapse, not shape simplification.** Each corridor becomes ONE chord; a bend survives only where the net turn at the max-deviation vertex ≥ `bendTurn` (recursive, ≤ `maxBends`). This is what turns wiggly streets into the hand-drawn leaflet's long straight runs.
3. **Tube-map length normalisation.** Leg target = median-preserving power compression `med·(arc/med)^gamma`, clamped to `[edgeMin, edgeMax]` — short legs grow, long legs shrink, spacing evens out. Then a uniform **refit** scales the solved layout onto the map frame.
4. **Pins — the persistent hand-tuning** (`diagram-layout.json`, S3-owned). Pins are FRAME-mm positions of junction nodes. They are applied in a **second, frame-space LSQ after the refit** (same octants, refitted lengths, `anchorW2` holds unpinned parts, `pinW` springs at the pins) — NOT in the first solve, whose coordinates the refit would re-transform (a pin must land exactly where it was dropped; verified ±0.2 mm). If a data refresh changes a node key, a pin re-resolves to the nearest junction within `pinResolveM` metres of its stored `ll` (logged; unresolvable pins are skipped, loudly).
5. **POI placement = nearest-segment snap, not warp.** The diagram's displacements are far too large for IDW warp (draft 1 stranded POIs in emptied space): each POI within `poiSnapDist` of the network keeps its offset RELATIVE to the nearest route segment (offset rotated with the segment); beyond that, warp fallback.
6. **River = crossing-pinned spans, damped.** Each linear-feature polyline is pinned EXACTLY where it crosses the solved network (segment intersections in original space → same param on the solved legs), each span between crossings is similarity-transformed, and perpendicular excursions are damped toward the span chord by `featureDamp` (the tube-map river is a calm band; undamped, a long winding span swung right across the town). No crossings ⇒ warp fallback.

## Config — `routes.json → internalDiagram{}` (absent ⇒ no output)

```jsonc
"internalDiagram": {
  "bendTurn": 50,        // keep a corridor bend only when net turn >= this (deg)
  "maxBends": 3,         // max bends per corridor
  "edgeMin": 8, "edgeMax": 55, "gamma": 0.55,   // leg-length normalisation
  "dirW": 30, "lenW": 1.2, "anchorW": 0.03,     // first-solve weights
  "anchorW2": 0.08, "pinW": 50,                 // pinned frame-space solve
  "mergeJn": 5, "mergeEdge": 6, "dropLoop": 12, "weldLeg": 1.6,
  "poiSnapDist": 22,     // POI keeps its offset to a route segment within this (mm)
  "featureTol": 2, "featureDamp": 0.35,         // river thinning / calming
  "workDir": "diagram",
  "stops": {             // curated stops (the hand-drawn convention)
    "junctionDist": 3,   // stop within this of a junction node => kept
    "poiStopDist": 8,    // stop within this of a DRAWN POI => kept (render-side)
    "include": [], "exclude": []                // ATCO overrides
  },
  "interchanges": [      // tube-style station lozenges (replace the anchor marker)
    { "atco": "0500HSTIV002", "label": "St Ives Bus Station" },
    { "atco": "0500HSTIV071", "label": "St Ives Park & Ride", "size": 2.6 }
  ],
  "loopArrows": ["300"], // direction arrowheads along one-way loops
  "loopArrowEvery": 34,
  "mapNotes": [ { "text": "Only main stops and stops near places of interest are shown",
                  "x": 200, "y": 190, "size": 2.4, "color": "#555" } ],
  "internalRoads": {},   // overrides merged into the WORKSPACE internalRoads
  "features": {}         // per-feature workspace overrides (labelPos etc.)
}
```

Curated-stop rule: termini of each route's drawn chain + stops at junction nodes + `include`, minus `exclude`; PLUS (at render time, since only gen_internal knows the final POI set) any stop within `poiStopDist` of a drawn POI. Auto-kept counts are logged ("curated stops: N kept").

## Hand layout that survives refreshes — two files, two jobs

- **`diagram-layout.json`** (S3-owned) — junction PINS, authored with the pin editor below. Structure: `{ "pins": { "<nodeKey>": {x, y, ll:[lat,lon]} } }`.
- **`diagram-overrides.json`** (S3-owned, optional) — standard Tier-1 `overrides.json` content (POI nudges/hides, label offsets, feature tweaks) in DIAGRAM page-mm; the pre-stage copies it into the workspace as `overrides.json`. Kept separate from the geographic map's overrides.json, whose coordinates would be meaningless here.

Both live in S3-config and are re-applied on every regenerate.

## The pin editor

```
cd <town S4 run dir>                    # data jsons + gen_internal.js + routes.json
node "%SK%\diagram_edit.js" [runDir] [port]     -> http://localhost:5180
```
Shows the RENDERED diagram with a draggable handle on every solved junction. Drop = stage a pin = live re-solve (real render, not a wireframe; ~2 s). Right-click a red (pinned) handle to unpin; "Clear all pins" restores the pure auto layout. Previews run in a temp sandbox; **Save** writes `diagram-layout.json` to the run dir and regenerates for real — then copy it into S3-config (same workflow as overrides.json).

## Running it (S4, after the other generators)

```
cd <S4 run dir>
node "%SK%\diagram_internal.js"      # -> diagram/ workspace + internal-diagram.svg
node "%SK%\render.js" internal-diagram.svg internal-diagram.jpg   # S5
```
`DIAGRAM_ONLY=1` skips the render (workspace + `diagram/debug-skeleton.svg` only). `DIAGRAM_LAYOUT=<file>` points at an alternative pins file (the editor uses this). The workspace also writes `diagram/solved-nodes.json` (junction key → solved x/y/ll — consumed by the editor, handy for debugging).

## Iterating / judging a new town

Judge by rendered eye against the hand-drawn St Ives reference (`S5-render` v6.6's `signoff_diagram_vs_manual.jpg` shows the target standard). Expect the AUTO draft to be topologically right but compositionally imperfect — that is what pins are for; St Ives-quality composition is auto-draft + a handful of pins, not solver tuning. Sensitive knobs, in order: `gamma`/`edgeMin`/`edgeMax` (spacing), `bendTurn` (how much corridors straighten), `mergeJn` (micro-block cleanup), `poiSnapDist`. A town needs `internalRoads` + S2's `roads_geo.json` / `routes_paths.json` first, same as the schematic.

