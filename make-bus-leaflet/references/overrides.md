# Manual overrides (Tier 1) — straighten routes, nudge labels, re-rotate

The `overrides.json` system for the `make-bus-leaflet` workflow: hand layout that survives data refreshes, the drag editor that authors it, and the maintainer invariants for extending it. `overrides.json` is owned by S3. `%SK%` = the skill's `assets` folder.

Hand adjustments live in **`overrides.json`** (S3-owned, optional). The generators read it and **re-apply it on every regenerate**, so your tuning survives data refreshes. Absent or `{}` ⇒ identical to pure auto layout (verified byte-identical on St Ives + March). **Never hand-edit the generated SVG** — it is overwritten on the next build; put the change in `overrides.json` instead.

All distances are **millimetres on the page** (the SVG `viewBox` is `0 0 297 210`, 1 unit = 1 mm). Keys are stable: stops by **ATCO**, POIs by **`cat:name`** (e.g. `shop:Tesco`), **linear features by their `routes.json` feature `key`**, external branches by **route** (or `route#n` for a route that leaves town on >1 arm), plus fixed names `hub`/`panel`/`note`.

```jsonc
{
  "routeColors": { "69":"#117733" },     // TOP-LEVEL: recolour a route on BOTH maps (e.g. two colours too alike); overrides the palette
  "hiddenOperators": ["Villager Minibus"], // TOP-LEVEL: drop every route belonging to a named routes.json operators[].name
                                          // from BOTH maps (line, badges, panel, legend row). Portal-only in practice — the
                                          // customer's Map Tuning editor writes this key when their org has the operator-
                                          // filter feature enabled (2026-08-03); it's a plain overrides.json key like any other,
                                          // so it works from a hand-authored file too. Absent/empty ⇒ byte-identical.
  "internal": {
    "rotationDeg": -60,                 // override PCA auto-rotation (degrees)
    "viewport": { ... },                // frozen fit; the editor writes this once you hand-place — keeps absolute mm valid across refreshes (don't hand-edit)
    "stops":  { "<ATCO>": { "pos": {"x":120,"y":80} } },          // move the PHYSICAL stop for EVERY route through it
    "routeStops": { "B": { "<ATCO>": { "pos": {"x":100,"y":90} } } }, // PER-ROUTE: move the stop only on route B's line (insulates other routes)
    "routeOffsets": { "9": { "dx":1.5, "dy":-1.5 } },             // lateral spread: nudge a whole route line sideways off a shared corridor
    "align":  [ { "route":"B", "stops":["<ATCO>","<ATCO>","<ATCO>"], "mode":"project", "snap":45 } ], // straighten a run on ONE route (per-route)
    "poiTiers": { "shop:Tesco": { "tier":"miss" },                                     // OA-212: must / may / miss, +"as" to rename
                  "community:The Hive": { "tier":"must", "as":"The Hive" } },
    "pois":   { "shop:Tesco": { "hide":true } ,
                "gp:Health Centre": { "move":{"dx":2,"dy":-1}, "label":{"offset":{"dx":3,"dy":0},"anchor":"start"}, "force":true } },
    "features":{ "river":   { "label":{"offset":{"dx":4,"dy":0}} },                      // by routes.json feature key
                 "railway": { "segments":[ [[60,40],[200,40]] ], "label":{"text":"Cambridge line","pos":{"x":130,"y":38},"anchor":"middle"} }, // straighten + relabel
                 "a1096":   { "move":{"dx":2,"dy":-1} },                                  // nudge feature+label
                 "canal":   { "hide":true, "style":{"stroke":"#003a6b"} } },              // hide / recolour
    "panel":  { "x":205, "y":14 }       // move the Services/Key column
  },
  "external": {                          // radial layout
    "branches": { "302": { "bearing":210, "side":"left", "terminus":{"x":40,"y":150} } },
    "hub":  { "x":150, "y":116 },
    "note": { "x":12, "y":150 }
    // busway layout instead supports: "yMap": { "<route>": <y> }, "note": {...}
  }
}
```
- **`align` is the Tube-map primitive, and it is PER-ROUTE.** Pick a run of stops on one route; they are laid onto the straight line between the run's two extremes (optionally snapped to 45°). **`mode:"project"`** (default) drops each stop perpendicularly onto the line so natural spacing/order is kept; **`mode:"even"`** distributes them equally. Only the listed route moves — a stop shared with another route keeps its position on that other route. Legacy `{from,to}` (no `stops[]`) straightens the whole route-order span between them.
- **Per-route vs global stop moves.** `stops[ATCO]` (and a stop straighten that you intend to share) moves the physical stop for every route; **`routeStops[route][ATCO]`** moves it only on that route's drawn line — this is what stops one route's edit from dragging another that shares the stop. Where routes diverge, the shared stop renders as a tick on each line; where they still coincide, the ticks overlap into one node.
- **`routeColors` is top-level** (not under `internal`/`external`) so a recolour stays consistent across both maps and future refreshes.
- **`pos` is absolute; `move`/label `offset`/`routeOffsets` are relative.** Stops use absolute `pos` (schematic intent); POIs/features/route-offsets use relative deltas so repeated nudges accumulate cleanly.

## The drag editor (click-and-drag authoring)
```
cd <town S4 run dir>                       # has the data jsons + gen_*.js + routes.json
node "%SK%\edit-server.js" internal        # or: external   → opens http://localhost:5179
# (you can also pass the run dir explicitly: node "%SK%\edit-server.js" internal "<run dir>")
```
**Edits preview live but are not written until you Save** — every action re-renders through the generator via `POST /preview` (a temp overrides file, nothing on disk), so you can experiment freely.
- **Drag** a stop / POI / external terminus / hub / **linear feature** (live mm readout). **Drag a route line** to spread it sideways off a shared corridor (`routeOffsets`).
- **Active route** (panel dropdown): sets the route context. With a route active, stop edits go to the **per-route** layer by default (toggle *move stops for this route only*), so straightening or moving a stop on route A leaves route 300 untouched even where they share stops. Clearing it (— none —) makes a stop drag move the physical stop for all routes.
- **Straighten:** shift-click a run of stops on one route (multi-select is restricted to the active route / a shared route), or click two extremes and press **Select all between**, then **Straighten** with **project** (keep spacing — default) or **even**, and the **45° snap** toggle. Writes a per-route `align`.
- **Route colour:** with a route active, the colour picker writes top-level `routeColors` (recolours that route on both maps). **Feature:** select a linear feature → recolour, set label text, or hide. **POI:** Toggle hide — but prefer the **landmark chooser** (`/app/maps/<id>/landmarks`), which writes `poiTiers` instead. The two are not the same: `hide` stops a POI being DRAWN and leaves its 4.2 mm box reserved, while a `miss` tier drops it at selection and actually gives the room back. A control offering to free space by writing `hide` would be lying. **Rotation** slider re-rotates the internal map. **Reset** clears the selected element (incl. per-route stop / route offset / route colour).
- **Undo / redo** (buttons or Ctrl+Z / Ctrl+Y) cover every staged action. **Save** writes `overrides.json`, **freezes the viewport** (first hand-place), and re-bakes. **Discard changes** reloads the last saved state; **Clear all** stages the clean auto layout (recovers a bad *saved* state — Save to persist). A leave warning fires while unsaved. **Zoom**: mouse-wheel (centred on cursor) + drag-pan on empty canvas, or the +/−/fit buttons.
- After Save, copy `overrides.json` into **S3-config** and run S4 (`--bump minor`) → S5 for the real deliverable. *The editor only authors `overrides.json`; the shipped image always comes from `gen_*.js` + `render.js`.*
- **Editor needs element keys**, which the generators emit **only** under `EDITOR_KEYS=1` (the server sets this). Normal builds emit no keys, so the regression gate stays byte-identical. Generators read overrides from `OVERRIDES_FILE` (the preview path) falling back to the run-dir `overrides.json`. The editor's generator copy must be **current** (editor-capable) and have its `icons.js` require pointed at the absolute skill path.

## Extending the override system (maintainer note — lessons from the build)
When you add a new override knob or port the hooks to a new town generator, keep these invariants or you'll break the byte-identical gate:
1. **Every override must be a no-op when absent.** Guard with presence checks (`OV.x!=null`, `||{}`), default to the existing value, and never reorder or reformat existing output. Empty/absent `overrides.json` must reproduce the auto layout *exactly*.
2. **Keys only in editor mode.** Emit `data-key`/`data-kind` solely via `gk(...)` (internal) or the `if(EDK) out('<g …>')` group-wrap (external). Never emit them unconditionally.
3. **When wrapping several existing `out()` lines in one group, join them with newlines** (`[...].join('\n')`) before passing to `gk` — otherwise the non-editor branch collapses three lines into one and the bytes drift (this exact bug hit the anchor marker during the build).
4. **Always re-run the 4-way gate** after any generator edit: St Ives + March × internal + external, each rendered with **no `overrides.json` and no `EDITOR_KEYS`/`OVERRIDES_FILE`**, must be byte-identical to the committed S4 SVGs. Each town holds its **own** generator copy (= current template + that town's small deltas), so the gate is: *town copy + town S4 data + no overrides == committed SVG*. Reusable harness **`%SK%\gate.sh <gen> <S4dir> internal|external <committed.svg>`** (copies the gen + data + `icons.js` into a temp dir, runs it, diffs). **Gate the TEMPLATE against the town's data, not the town's own frozen copy** — the latter passes by construction and proves nothing (2026-07-28; see `changing-the-engine.md` §2/§2a).

**The per-town delta list is HISTORY, not a checklist** (corrected 2026-07-28). It used to read: *St Ives internal = +`5A`/`69` in order/panel-desc/panel-list + absolute icons; St Ives external = 7-branch `yMap`; March = POI/name-tidy/order/ATCO-prefix/loop-`33A`/title/desc/panel*. Every one of those has since migrated into `routes.json` per invariant 1 ("no town literals in a generator"). Verified across all seven built towns: the only town-ish strings left in a town's generator copy are the shared template's own St Ives-derived *defaults* (`riverLabel`, `anchorLabel`, the skill path), identical to the template's. So re-deriving a town copy is now simply **copy the current template in** — then gate, then **re-render the town**, or the shipped map silently keeps the old engine.
5. **Per-route layer & top-level `routeColors` are no-ops when absent.** Route lines draw through `rpos(r,a)` (per-route `routeStops`/`align` ‖ `baseXY`); the divergence-tick loop is guarded `for(const r in routeOv)` and skips ticks within 0.01 mm of base, so it emits nothing without overrides. `routeColors` is merged into palette `C` in **all three** generators (`for(const r in RCOL) C[r]=RCOL[r]`) — empty object ⇒ no change. Keep these guards or the gate breaks.

