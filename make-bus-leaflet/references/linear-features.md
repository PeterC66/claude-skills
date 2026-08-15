# Linear features (river / road / railway / canal)

How the internal map draws its 1–3 key linear features in the `make-bus-leaflet` workflow. Chosen in S2, configured in S3 `routes.json`, overridable via `overrides.json` (see `references/overrides.md`).

A town's internal map draws **1–3 key linear features**. They are **config-driven** (no hardcoded river): `routes.json` `features[]` chooses them, S2's `features_geo.json` supplies the geometry, and each is independently straightenable/nudgeable.

- **Choosing (once per town).** For a new town, identify candidates from OSM (river/canal, the main A-road(s), the railway), **list them and ask the user which 1–3 to include**, then lock the choice in `features[]`. Don't re-ask on refreshes — an existing town already carries its list. (No `features[]` at all ⇒ one auto river feature, the legacy fallback.)
- **Config (`routes.json` `features[]`).** Each entry: `{ "key", "type", "label", "labelPos":{x,y}, "labelColor", "labelItalic"?, "labelSize"?, "labelReserve":[x0,y0,x1,y1]?, "style"?:{stroke,width,dash} }`. `key` must match S2's `features_geo.json`. `type` picks the **default style** (override per feature with `style`):

  **`labelPos` is in page mm and is not collision-checked.** Two guards, both of which drop the label and say so on stderr rather than print it in the wrong place: inside the town-centre box (`coreBox`), and **right of the map frame** (x > 196), where it lands in the Services panel — a feature label is drawn outside the map's clip group, so nothing stops it. Wisbech shipped for months with "River Nene" printed across its own route list this way. To move one on a built town, `preview_design.js` and `adopt_config.js` both take **`--feature-pos <key>=<x>,<y>`** (repeatable); `--patch`/`--set` cannot reach `labelPos`, because `features[]` is an array.

  | type | default | notes |
  |---|---|---|
  | `river` | `#9ec9e8`, w3.4 | the protected blue — keep routes off it |
  | `canal` | `#7fb0d8`, w2.4, dashed `3 1.6` | |
  | `railway` | **Ordnance-Survey style**: `#333` black casing w1.5 + bold `tieLen:1.6`/`tieEvery:2.6`/`tieWidth:0.7` **sleeper crossbars**; `minSegLen:3.5` | reads unmistakably as a railway (2026-07-20); `tieEvery`/`tieLen`/`tieWidth` overridable per feature. **`minSegLen`** (page mm) drops polyline segments shorter than that before drawing — a multi-track ECML through a station is mapped as parallel ways + short crossover/point stubs whose ties splay into a mess at the junction throat; dropping the stubs leaves the clean through-line (St Neots v2.1). Verified it doesn't gap Huntingdon's line (its rail is long segments). Set `minSegLen:0` to keep every segment. **Prefer `rail:"chequer"` below for any new or re-rendered town** — the tie symbol is kept only so existing sheets stay byte-identical. |

### `rail:"chequer"` — the recommended railway symbol (2026-08-15)

Set `"style": {"rail": "chequer"}` on a `railway` feature. The line becomes a black casing with **white blocks laid over it as a dash pattern** — the symbol most people already read as "railway" (OS 1:250k, Google, most tourist maps).

**Why it replaces the ties.** The tie symbol is computed per polyline *segment*, restarting its walk inside each one, so tie spacing follows vertex density rather than distance: on geographic geometry the median segment (1.1–2.5 mm) is shorter than the 2.6 mm tie pitch, which left High Wycombe with a 20 mm tie-free stretch beside a clump of ties; on diagram geometry (`featureDamp` warping, turns up to 148°) adjacent ties splay across each other. A dash pattern is laid out by the renderer **along the whole path**, so it cannot bunch, reset at a vertex or splay at a hairpin, whatever the geometry does. It is also two paths per line instead of one-plus-forty.

Choosing it switches on three geometry passes and turns the ties off. Every key stays overridable per feature:

| key | default under `chequer` | what it does |
|---|---|---|
| `width` / `coreWidth` / `coreColor` / `stroke` | 1.6 / 0.88 / `#ffffff` / `#4a4a4a` | casing, block width, block colour, casing colour |
| `chequer` | `"2.3 2.3"` | the dash pattern — block, gap (page mm) |
| `railStitch` | 0.5 | join polylines whose endpoints meet within this, so a line split across several OSM ways becomes one path (the dash phase restarts at each path, so an unstitched join can print a white block across it) |
| `railStitchTurn` | 60 | **reject** a join that turns more than this many degrees — see the gotcha below |
| `railMerge` | 1.5 | drop stretches running within this of a line already kept: the parallel-track pass |
| `railMinRun` | 6 | discard a trimmed stretch shorter than this as a floating fragment |
| `ties` / `minSegLen` | `false` / 0 | the tie symbol and its stub filter, both off — `minSegLen` is no longer needed, and it punched visible gaps in the line |

`railStitch`/`railMerge` are independent of the symbol: setting them with `rail:"ties"` gives today's crossbars on merged geometry, if some town ever wants that.

**What the merge is for.** OSM maps a double-track line as two ways, plus loops, sidings and platform lines, and every one of them was being drawn with its own casing and its own ties. Measured on the shipped sheets before/after: St Neots `internal-diagram` 36 polylines and **1,434 tie strokes → 6 polylines**; Huntingdon 39/576 → 1; High Wycombe 40/180 → 1; Beaconsfield 20/232 → 1.

**The weight was retuned on 2026-08-15** (design-quality plan Phase 6, §3.4): 1.9 mm of `#333` became **1.6 mm of `#4a4a4a`**, with `coreWidth` moving 1.05 → 0.88 to hold the dark edging either side of a white block at 55 % of the casing. The reason is relative, not absolute: the railway is *context* and the bus routes are the *subject*, and the routes are drawn at 1.7 mm — so at 1.9/`#333` the railway was the widest and darkest single line on the sheet. (Total ink was never the problem; clipped to the frame the railway is between 1:4 and 1:16 of the route ink, depending on the town.) The dash pitch was deliberately **not** scaled with the width: it sets the symbol's rhythm along the line, which is what makes it read as a railway at arm's length. Four candidates on all four railway towns, with 300 dpi crops and the ink table: `Development Docs\railway-weight-options_2026-08-15.html` (regenerate with its `.js`). The base `railway` `stroke` stays `#333333`, so towns and places still on the tie symbol are untouched.

**Opting a town in** is a `routes.json` edit and a normal staged refresh (S3 → S4 → S5). Absent the key, output is byte-identical — verified across all 27 gates.

### A label with no line under it

`features_geo.json` is keyed by `key`, so two entries sharing a key silently draw the **same** geometry, and a key with no geometry draws **nothing** while still printing its label. Ramsey shipped both faults at once — two features keyed `canal` against a `features_geo.json` whose `canal` held zero polylines — so "Canal" and "Bevills Leam" floated in the bottom-left corner in italic blue, naming watercourses that are not on the map. `gen_internal.js` now reports both at build time. A label pointing at nothing is worse than no label: either re-run S2 for that feature or drop it from `features[]`.
  | `road` | `#e6a532` amber, w2.8 | A-roads |
  | `generic` | `#999`, w2.2 | anything else |

- **Geometry (S2 `features_geo.json`).** `{ "<key>": [ [[lat,lon],…], … ] }` — an array of polyline segments per feature, projected to the page like the stops. Pulled per feature from the `overpass-feature.txt` template.
- **Overrides (`overrides.json` → `internal.features[key]`).** Each feature is hand-adjustable and the tweak is re-applied on every regenerate: `hide` (drop it), `move{dx,dy}` (nudge feature+label together), **`segments`** (array of page-mm polylines that *replace* the projected geometry — the straighten primitive) or `points` (a single such polyline), `style` (merged over the default), `label{pos|offset,anchor,text,hide}`. See `references/overrides.md` for the worked block.
- **Editor (optional, future):** the drag editor emits `data-kind="feature"` keys under `EDITOR_KEYS=1`, so feature control points *can* be wired into `override-editor.html` the same way as stops; the `segments`/`move` override schema is ready for it. Until then, author feature `segments`/`move` by hand in `overrides.json`.

## Adding (or removing) a feature *later* — to a town already built
Features aren't only a first-build choice; you can add one to an existing town at any time. Because it changes the drawn map, do it as a normal staged refresh, not an edit to a shipped stage:
1. **S2** — new `S2 = stage.js new S2 --bump` (or copy the latest S2 dir). Fetch the new feature's geometry with `overpass-feature.txt` (set `{{NAME}}`/`{{REF}}`, `type` selectors) and **merge it into `features_geo.json`** under a new `key`, keeping the existing features. (If the town currently has *no* `features[]`, also copy its `river_geo.json` in under `key:"river"` so the river survives — once `features[]` exists the legacy river synthesis is off.)
2. **S3** — add the entry to `routes.json` `features[]` (pick `type`, a `label`, and a `labelPos`). Re-copy the current generators; the byte-identical gate still holds because the *old* features are unchanged and the new key only adds geometry.
3. **S4/S5** — rebuild; nudge the new feature's `labelPos`/`segments` via `overrides.json` if needed.

Worked example: **St Ives v3.0** added `{key:"st-audreys", type:"road", label:"St Audrey's Lane"}` to a town that previously relied on the legacy single-river fallback. The river was promoted to an explicit `features[]` entry (matching the legacy style/label) at the same time, and `features_geo.json` now carries both `river` and `st-audreys`.

