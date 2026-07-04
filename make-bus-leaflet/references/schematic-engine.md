# The octolinear schematic engine (`internal-schematic.svg`, opt-in)

A third, optional image per town: a **tube-map-style internal map** — every road
corridor reduced to a few straight legs at 0/45/90° (octolinear), the style the
hand-made St Ives leaflet uses. The geographic `internal.svg` stays the primary
deliverable; this is an **additional, opt-in output** that cannot affect the
existing build (first shipped: St Ives v6.3, 2026-07-04).

## Architecture — a geometry pre-stage, NOT a second renderer

`assets/schematize_internal.js` schematizes the **S2 geometry** and re-emits the
same file formats (`routes_paths.json`, `roads_geo.json`, `atco2ll.json`,
`features_geo.json`, `osm*.json`, a derived `routes.json`) into a
`schematic/` workspace subfolder, then runs the **unmodified** `gen_internal.js`
in that workspace and copies the result out as `internal-schematic.svg`.
Badges, corridor bundling, stop ticks, TRIM/termini clusters, road labels, POI
icons, the Services panel — all reused verbatim; only geometry generation is new.

Key mechanics that make the reuse exact:

- **Rotation and the fisheye are baked into the schematized coordinates.** The
  workspace `routes.json` gets `rotationDeg:0` + `focus.comp:1`, so the inner
  gen_internal projection is a pure uniform fit and 45° legs stay exactly 45°.
  The emitted "pseudo lat/lon" are the rotated planar frame re-read as
  lat/lon (centred near 0, so gen_internal's `k=cos(lat0)≈1`, angle-exact).
- **Route `pts` arrays keep their exact length and indices** (every original
  point maps through the solved corridors by arc-length fraction), so the
  existing `stopT {i,t}` stop projections remain valid untouched.
- **Node identity across routes/ways = OSM coords rounded to 6 dp** (matches
  how `match_routes.js` wrote `routes_paths.json` from `roads_geo.json`).
- **POIs, non-network roads and leftover stops** map through an
  inverse-distance-weighted warp field built from the solver-node displacements.
- **Linear features (river)** keep their real **winding shape** — they are NOT
  octolinearised. Each vertex is just pushed through the same displacement
  `warp()` the roads use (lightly thinned by `featureTol`), so the river follows
  the routes' movement and stays on the correct side of them. *(An earlier v6.3
  version 45°-snapped the river and pinned it at road crossings; that distorted
  it enough to cross routes it never meets in reality — St Ives 300/A/B — and a
  45°-legged river reads as a road anyway. Warp-only, winding, fixed both. A
  smooth river among straight routes is a recognised schematic style, e.g. the
  London Underground Thames.)* The schematized river MOVES, so it usually needs
  its own `internalSchematic.features.river.labelPos`/`labelReserve`.

## The solver

1. Union graph of all matched route paths + `keyRoads` ways (keyRoad-only
   geometry clipped to frame+`clipMargin`; route geometry never clipped so
   tails still cross the frame for TRIM/arrows).
2. **Junction-cluster contraction** (runs to a FIXPOINT): junctions closer than
   `mergeJn` mm merge to one node, AND any two junctions/stubs joined by a short
   (< `mergeEdge` mm) graph edge merge too. OSM micro-geometry (roundabouts,
   dual-carriageway splits) creates 1–3 mm cycles that *cannot* close
   octolinearly and would keep visible off-angle residuals; a block that small
   can't be drawn legibly anyway. **Why a fixpoint:** one merge pass can turn a
   route's through-node into a degree-1 dead-end stub (both its neighbours land
   in the same cluster) — the route then folds in-and-out of that stub = a
   visible spike (the St Ives route-300 / Burstellars spike was exactly this: a
   St Audrey's Lane **keyRoad** junction ~21 m off route 300's path). A second
   pass sees the new stub (its short edge is now < `mergeEdge`) and absorbs it.
   Tiny closed rings left over (< `dropLoop` mm around) are deleted. As a final
   safety net after the solve, any leg still solved shorter than `weldLeg` mm has
   its endpoints co-located (welded) so it can't draw as a kink.
3. Corridors = degree-2 chains between junctions; each simplified by
   Douglas-Peucker (`tol` mm), bends closer than `minLeg` pruned.
4. **Twin corridors** (two corridors joining the SAME junction pair):
   near-coincident ones (dual carriageways) are dropped — their nodes ride the
   kept corridor by arc fraction; genuinely separated ones (block loops) get a
   forced mid bend so they can bow. Without this the solver crushes the pair
   toward zero length (two octants demanded between one point pair).
5. Leg bearings snap to the nearest octant; per-junction conflicts resolved by
   re-assigning distinct octants in cyclic bearing order (length-weighted DP),
   iterated to a fixpoint.
6. One global dense weighted least squares (Gaussian elimination, a few
   hundred vars): perpendicular-to-octant rows (`dirW`), length rows (`lenW`,
   target = **arc length** — chord targets contract the whole town; arc keeps
   corridors their travelled length and gives the centre air), geography
   springs (`anchorW`).

The script logs any leg > 1.5 mm that ends > 3° off its octant — St Ives ships
with a worst case of ~4.5° on two short legs; anything larger appearing on a
new town means a graph pathology worth investigating (see twin corridors
above, which produced 20–45° before they were handled).

## Config — `routes.json → internalSchematic{}` (absent ⇒ no output, zero effect)

Requires `internalRoads` (the road-skeleton model) to be configured too.

```jsonc
"internalSchematic": {
  "tol": 5,             // corridor simplification tolerance, mm (higher = fewer bends)
  "minLeg": 5,          // minimum leg length, mm
  "dirW": 30, "lenW": 1, "anchorW": 0.08,   // solver weights
  "mergeJn": 2.2,       // junction-contraction radius, mm (0 disables)
  "mergeEdge": 3.5,     // merge junctions joined by a graph edge shorter than this, mm
  "dropLoop": 8,        // delete closed rings smaller than this, mm around
  "weldLeg": 1.6,       // co-locate endpoints of any leg solved shorter than this, mm
  "featureTol": 2,      // river point-thinning tolerance, mm (keeps the winding shape; higher = coarser)
  "clipMargin": 15,     // keyRoad-only geometry kept within frame+margin, mm
  "contextRoads": false,// faint side-street layer (tube-map style = off)
  "workDir": "schematic",
  "internalRoads": {    // overrides merged into the WORKSPACE internalRoads
    "terminiClusterDist": 28   // e.g. St Ives: merge the SE 5A/69 exits into one box
  },
  "features": {         // per-feature label overrides — the warped river moves,
    "river": { "labelPos": {"x":108,"y":190}, "labelReserve": [103,184,150,193] }
  }                     //   so it usually needs its own on-the-water label spot
}
```

Workspace styling defaults (applied by the schematizer, override via
`internalSchematic.internalRoads`): `skeleton:#f6f6f6` (the manual leaflet
draws no grey road casing — near-white keeps only a subtle crossing
separator), `gap:2.4`, `corridor:{dist:0.6,angle:12}` — schematized shared
legs are **exactly coincident**, while distinct streets can end up much closer
than in reality, so the geographic bundling distance (2.4 mm) would fuse
separate streets and blow the casing width up (it did: draft 1's giant grey
blob at the interchange).

## Running it (S4, after the geographic generators)

```
cd <S4 run dir>            # inputs already pulled (S2 + S3 + icons.js)
node "%SK%\schematize_internal.js"
# -> writes ./schematic/ (workspace + debug-skeleton.svg), runs gen_internal
#    there, and copies out ./internal-schematic.svg
node "%SK%\render.js" internal-schematic.svg internal-schematic.jpg   # S5
```

`SCHEMATIZE_ONLY=1` skips the render step (writes just the workspace — useful
with `schematic/debug-skeleton.svg`, which shows the bare solved corridors over
the original geography in grey, for judging the layout without badges/labels).
Debug env vars for chasing a spike/kink: `DBG_NODE="<lat,lon>"` dumps a solved
node's incident legs (octant, solved bearing, length, corridor index);
`DBG_PAIR="<keyA>|<keyB>"` reports two nodes' post-contraction degree, position
and whether they're connected — how the route-300/Burstellars spike was traced
to a degree-1 keyRoad stub.

The **north arrow** and **version stamp** are drawn by the shared
`gen_internal.js` (see its header), not here — but because the schematic's
coords are pre-rotated and run at `rotationDeg:0`, gen_internal can't re-derive
north from its own rotation. The schematizer therefore precomputes the north
screen bearing (from the town's real `rotationDeg`, which the schematic
preserves) and injects it as `internalRoads.northArrow.angle` into the
workspace `routes.json`. So a town only needs `internalRoads.northArrow:{x,y}`
in its own config; both the geographic and schematic maps then show a correct,
identically-oriented arrow.

## Iterating / judging a new town

This is a layout algorithm, not a fixed drawing — judge it **by rendered eye**,
the way St Ives items 1–5 were judged (render → crop → compare against a
tube-map sensibility; SVG text diffs and the residual log alone are not
enough). The sensitive knobs, in order of layout impact: `tol` (bend count —
too low = staircasing, too high = corridors merge into few long diagonals and
the page composition shifts), `anchorW` (geography adherence — raise it if
tails wander into each other), `mergeJn`. Termini label crowding at busy
corners is usually a `terminiClusterDist` override, not a solver problem.
