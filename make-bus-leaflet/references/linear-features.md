# Linear features (river / road / railway / canal)

How the internal map draws its 1–3 key linear features in the `make-bus-leaflet` workflow. Chosen in S2, configured in S3 `routes.json`, overridable via `overrides.json` (see `references/overrides.md`).

A town's internal map draws **1–3 key linear features**. They are **config-driven** (no hardcoded river): `routes.json` `features[]` chooses them, S2's `features_geo.json` supplies the geometry, and each is independently straightenable/nudgeable.

- **Choosing (once per town).** For a new town, identify candidates from OSM (river/canal, the main A-road(s), the railway), **list them and ask the user which 1–3 to include**, then lock the choice in `features[]`. Don't re-ask on refreshes — an existing town already carries its list. (No `features[]` at all ⇒ one auto river feature, the legacy fallback.)
- **Config (`routes.json` `features[]`).** Each entry: `{ "key", "type", "label", "labelPos":{x,y}, "labelColor", "labelItalic"?, "labelSize"?, "labelReserve":[x0,y0,x1,y1]?, "style"?:{stroke,width,dash} }`. `key` must match S2's `features_geo.json`. `type` picks the **default style** (override per feature with `style`):

  | type | default | notes |
  |---|---|---|
  | `river` | `#9ec9e8`, w3.4 | the protected blue — keep routes off it |
  | `canal` | `#7fb0d8`, w2.4, dashed `3 1.6` | |
  | `railway` | **Ordnance-Survey style**: `#333` black casing w1.5 + bold `tieLen:1.6`/`tieEvery:2.6`/`tieWidth:0.7` **sleeper crossbars**; `minSegLen:3.5` | reads unmistakably as a railway (2026-07-20); `tieEvery`/`tieLen`/`tieWidth` overridable per feature. **`minSegLen`** (page mm) drops polyline segments shorter than that before drawing — a multi-track ECML through a station is mapped as parallel ways + short crossover/point stubs whose ties splay into a mess at the junction throat; dropping the stubs leaves the clean through-line (St Neots v2.1). Verified it doesn't gap Huntingdon's line (its rail is long segments). Set `minSegLen:0` to keep every segment. |
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

