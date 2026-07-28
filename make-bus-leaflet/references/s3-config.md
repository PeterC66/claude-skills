# Stage 3 — Config (+ town-specific generator edits)

Detailed steps for S3 of the `make-bus-leaflet` workflow. See SKILL.md for the stage
model and palettes, `references/linear-features.md` for `features[]`, and
`references/overrides.md` for `overrides.json`. `%SK%` = the skill's `assets` folder.
`$S3` = the S3 run folder.

1. `S3=stage.js new S3`; `cd "$S3"`.
2. Write **`routes.json`** — palette, textOn, operators[], external[] (radial: each `{route,label,days,bearing,side,stops}`), **`features[]`** (the 1–3 linear features chosen in S2 — each `{key,type,label,labelPos{x,y},labelColor,labelItalic,labelSize,labelReserve[x0,y0,x1,y1]}`, optional `style{stroke,width,dash}` to override the per-type default), plus `anchor`/`anchorLabel`/`internalZoom`/`titleColor`/`externalNote` as needed; `busway[]` only for a busway/P&R town. Start from `%SK%\routes.example.radial.json` (ordinary town = March) or `routes.example.busway.json` (St Ives). Feature `type` ∈ river/canal/railway/road/generic sets the default style; `key` must match a key in S2's `features_geo.json`.
3. **Copy the two template generators into `$S3` VERBATIM — no edits.** The generators are **fully config-driven** (2026-06-07): they contain no town literals, so you copy them as-is. Pick the external layout: copy `gen_external_radial.js` (ordinary) or `gen_external_busway.js` (busway) **as `gen_external.js`**; copy `gen_internal.js`. **You do NOT edit them** — not even the `icons.js` require (it self-resolves: `__dirname/icons.js` when run in `%SK%`, else the skill path / `$SKILL_ASSETS`). Everything town-specific lives in `routes.json` (see the key list below). You can also run them **in place** from `%SK%` with the run dir as CWD (no copy) — the only reason to keep a local copy is so the drag editor has one to drive.
   - The templates are **editor-capable** (emit `data-key` under `EDITOR_KEYS=1`, honour `overrides.json`, print the `VIEWPORT` line). After S4, the editor runs **in-place**: `cd` into the S4 run dir and `node "%SK%\edit-server.js" internal|external` (see `references/overrides.md`).
   - **Whenever you change a template, re-run the byte-identical gate** (`%SK%\gate.sh <gen> <S4-datadir> internal|external <committed_svg>`) on **every built town, internal *and* external** — the current gate set is listed in [changing-the-engine.md](changing-the-engine.md) §2 (this line used to say "St Ives v4.0 + March v1.1", the set when there were only two towns) — before shipping — they must stay identical. **Never add a town literal back into a generator; add a `routes.json` key instead** (this is how the external hub label was generalised — see `references/gotchas.md`).
4. **Manual layout (optional):** if you want to straighten routes / nudge labels, create/keep **`overrides.json`** here (see `references/overrides.md`). It's read by the generators and is safe to omit (absent ⇒ pure auto layout). Author it after the first S4/S5 draft using the drag editor, then drop it back in S3.
5. `stage.js commit S3 "$S3" --outputs routes.json,overrides.json,gen_internal.js,gen_external.js` (omit `overrides.json` if none).

## Everything town-specific is a `routes.json` key (the generators have NO town literals)
The config-driven keys the generators read (2026-06-07 — the per-town code edits were all lifted into config; `bootstrap_town.py` drafts most of them):
- **`routeOrder`** — internal draw order (default = palette key order).
- **`panelOrder`** — Services-panel list order (default = `routeOrder`).
- **`orientationRoute`** — route used to orient road-name labels (the town circular, else the longest in-town route).
- **`atcoPrefix`** — in-town stop ATCO prefix the road-label pass filters on (default = `anchor` with trailing digits stripped, e.g. `0500HHUNT`).
- **`internalDesc`** `{route:[title,subtitle]}` — Services-panel text.
- **`badgeLabels`** `{ <route key> : <badge text> }` — optional. The route badge normally draws the route's **key**; this overrides just the drawn text while the key (and its palette/textOn/data files) stay unchanged. Use it whenever the key can't be the badge text: **two different routes that share a number** (key one `46`, the other `46L`/`46S`, and map the second back to `"46"` — the S2 data must be keyed the same as `palette`, so you can't have two `46` keys), or a **lettered / branded** service where the key differs from the blind (Wisbech's First "excel" is keyed `excel` to match the S2 chain, badge `"A"`). Keep the badge text short (1–3 chars) — it sits in a small circle (terminus badges are ~r2.4–3.0). Absent/empty ⇒ badge = key (byte-identical; gated on St Ives/March/Huntingdon). Honoured by all three generators (`gen_internal.js`, `gen_external_radial.js`, `gen_external_busway.js`), incl. the panel and operator-legend badges.
- **`poi`** `{ "industrialKeep": [names…] | "none" | omit(=keep any named), "excludeName": [regex…] (drop POIs whose name matches, case-insensitive), "tidy": [[regex,replacement]…] (ordered suffix tidies), "canon": [[regex,replacement]…] (whole-name canonicalisations) }` — replaces the old hardcoded POI filter/name-tidy block. The generic strip (parentheticals, ` - building`, unnamed greens) stays in code.
- **`stamp`** `{ "notes": ["…","…"], "asOf": "1 Jul 2026", "heading": "Coming soon", "externalAt": [x,y], "internalAt": [x,y] }` — **optional** "coming soon / validity" callout, used to put **advance notice of upcoming changes** on the printed leaflet (from `gtfs_upcoming.py` — see the pre-print gate in [s1-services.md](s1-services.md)). Renders a white-boxed callout: a bold red `heading` (default "Coming soon"), one grey line per `notes` entry (e.g. `"New route 52 begins 2 Sep 2026"`, `"Routes A/B/C times change 19 Jul — check before travel"`), and — if `asOf` is set — a grey `"Timetable correct as at <asOf>"` line (the top title already shows `(from validFrom)`, so `asOf` is only for an explicit "checked on" date). `notes` **or** `asOf` alone is enough; give either. Position defaults to bottom-left (external `[10,188]`, internal `[6,196]`); **review the S5 JPG and set `externalAt`/`internalAt` to clear space** (the box has a white backing so it stays legible over lines, but nudge it off nodes). Honoured by all three generators; **absent ⇒ byte-identical** (gated on St Ives/March). Decide per town each build whether to add it (print-now-with-note) or instead hold and render the future network with `gtfs_query --asof` — see [s1-services.md](s1-services.md).
- **`version`** — the version **printed on the map** (external via `D.version`; internal/diagram via `RJ.version`, unless `LEAFLET_VERSION` overrides). It is a *data* field and is **separate from the `v<N.N>_<ts>` run-folder name**, which is manifest metadata. **You no longer have to remember to bump it** (2026-07-25): `stage.js pull` rewrites it to match the versioned run dir it lands in, and `stage.js commit S4|S5` refuses to record a run whose field disagrees. Formatting is preserved — only the numeric part is rewritten, so a town's `"1.1"`, a place's `"v1.0"` and any suffix (`"1.1 · Summer 2026"`) all survive. Repair an odd one by hand with `stage.js stampver <runDir>`; keep a deliberately-different stamp with `commit --force-version`. Note the guard fires at **commit** time, when the SVGs are already drawn — so a mismatch means *regenerate*, not just edit the field.
- The **external hub label** uses `routes.json` `town` (no longer hardcoded); the radial hub box auto-widens for long town names.

### RESERVED — the complexity-remedy keys (P2/P3, not yet implemented by any generator)

The triage gate ([complexity-triage.md](complexity-triage.md)) recommends these; the generators do
**not** honour them yet. The names and shapes are fixed here so the gate and the generator cannot
drift apart when P2/P3 lands — `complexity_score.js` **already reads `internalCorridors`** and
re-scores a bundled town with it, so a generator that implements a different shape would silently
stop being scored correctly.

- **`internalCorridors`** `{ "<lead route>": ["1","1A","1B"] }` — *(rung 1, P2)* draw the listed
  routes as **one line carrying a stack of badges** instead of one line each. The lead route keys the
  colour and the overrides. Also accepted: `{ "<lead>": { "routes": [...] } }`. **The bundle must
  split back into separate lines where the routes diverge** — `102/103/104/105` share the A40 but not
  their whole length, and a bundle kept merged past the divergence states something false. This is
  the internal twin of `external[].routes`, which already solved the identical problem on the
  external map — read that implementation first.
- **`coreBox`** `{ "radius": 600, "label": "town centre", "at": [x,y] }` — *(rung 2, P3)* replace the
  congested centre with a labelled box; routes terminate at its edge instead of crossing the knot.
  `radius` in metres from `anchor`. Interacts with the existing fisheye `lenses[]` — decide which
  owns the centre.
- **`corridorPalette`** `true` — *(rung 3, P3)* colour by corridor family rather than by route, with
  badges carrying route identity. **Approved 2026-07-28 but bounded to towns drawing > 12 lines**,
  and it breaks the internal/external colour correspondence for bundled families, so it is a
  deliberate per-town decision, never a default.

All three must be **opt-in and absent ⇒ byte-identical**, like every other key here.

### Big-town keys (added for High Wycombe, 2026-07-28 — all opt-in, absent ⇒ byte-identical)
A town with 30+ services overruns two fixed budgets: the **height of one Services column** and the
**perimeter of the external frame**. Five keys buy the room back. All were gated on every existing
town, internal *and* external, before use.

- **`panelCols`** `{cols:2, width:48, row:5.0, keyAt:{x,y}}` (`gen_internal.js`) — multi-**column**
  Services panel. Entries fill **column-major**, `cols` columns `width` mm apart from the panel `x`;
  `row` is the row pitch inside the panel only; `keyAt` pins the Key block, which would otherwise
  start below the tallest column and run off the page. Text is drawn smaller than the single-column
  panel (2.9 bold / 2.3 grey), so **keep each title ≤ ~25 chars and each subtitle ≤ ~28** or it
  clips — put the "via" detail on the map, not in the panel. High Wycombe: 34 services in 2 columns.
- **`legendWrap`** `{perRow:N}` (`gen_external_radial.js`) — wrap an operator's badge run onto
  further lines. Without it a big operator (Carousel runs 21 of High Wycombe's routes) draws a
  single row straight off the page.
- **`legendAt`** `{x, y, box:{w,h}}` (`gen_external_radial.js`) — move the operator legend, and give
  it an **opaque backing panel**. A large town has a spoke in *every* sector, so there is no empty
  corner for the legend; `box` lets it sit over the map legibly. Size `box` to clear the nearest
  destination lozenge — check the S5 JPG, don't assume.
- **`badgeOffset`** `N` (`gen_external_radial.js`) — mm back from the terminus for the first route
  badge. Default **8**. Raise it (High Wycombe: 13) when wide destination lozenges cover the badge.
  *(This one started life as a changed default and the gate caught it — see [gotchas.md](gotchas.md).)*
- **`external[].routes`** `["104","M40"]` (`gen_external_radial.js`) — **several services sharing one
  spoke** to a destination, badges stacked along the line. The radial runs out of frame perimeter
  long before it runs out of services: ~18 lozenges is the practical A4 maximum, and High Wycombe had
  23 spokes with five destinations reached by two routes each. Merging those five pairs (and keeping
  destination labels to **one short line** — a two-line lozenge is nearly twice as wide) brought it to
  19 spokes that fit. `route` stays the first/primary service; it still keys colour and overrides.

**Sequence that works for a crowded radial:** merge co-terminating routes → shorten every label to one
word → spread bearings by hand so no two lozenges touch → thin the intermediate `stops` on spokes that
run close together → only then place the legend box. Bearings are schematic; bending a spoke 10–15°
off true to open a gap is normal and expected.

Older keys still apply:
- `routes.json` keys read by the generators: `town`, `validFrom`, `version`, `palette`, `textOn`, `operators[]`, `external[]` (radial: each `{route,label,days,bearing,side,stops}`); **`features[]`** (1–3 linear features `{key,type,label,labelPos,labelColor,labelItalic,labelSize,labelReserve,style?}`); plus **`anchor`** (central-interchange ATCO — also the zoom origin), **`anchorLabel`**, **`internalZoom`** `{corePct,comp}`, optional **`titleColor`** / **`externalNote`** / **`riverLabel`** / **`badgeLabels`** (see above), and `busway[]` (busway layout only).
- **Routes drawn = the in-town subset (v4):** `gen_internal.js` reads **`routes_intown_atco.json`** (S2's town-core + edge-buffer display subset) and falls back to `routes_atco.json` for older towns — so a pass-through route traces to the town edge instead of a stub. Adding edge-buffer stops usually means a previously-compact town now **needs `internalZoom`** to compress the out-of-town buffer stops (St Ives v4.0 = `{corePct:0.9, comp:0.18}`; without it the far stops blow the fit out). Tune `intown_cfg.json maxEdgeKm` (S2) first to drop absurdly-far buffers, then `internalZoom` for the rest. After the first draft, **check each `terminiLabels` badge landed on the arm whose destination it names** (a genuinely two-arm route can land it on the wrong arm).
- **Internal clarity options (v3, all opt-in — absent ⇒ byte-identical to the old layout):**
  - **`internalBundle`** `{gap:0.9}` — fan co-running routes into *closely-parallel* lines instead of overlapping (perpendicular per-segment offset; the big visual win). Tune `gap` (mm) per town.
  - **`internalTermini`** `true` + **`terminiLabels`** `{route:"<destination>"}` — draw a route badge + "to <dest>" at each route's out-of-town endpoint (the end farthest from `anchor`); badges auto-separate when two routes share an exit. Only list routes that actually leave town.
- **Busway external is now fully config-driven** (no per-town code delta needed — `yMap` rows auto-distribute, overridable by a `yMap`/`overrides.json` `external.yMap`). Extra busway `external[]` keys: per-branch **`id`** (default = route) so a route can have **two arms** (e.g. `9` main + a `9`/`id:"9v"` village arm; `301` + `301`/`id:"301o"` via Old Hurst); **`limited:true`** dashes the line. Map-level: **`servicesPanel`** `{x?,show?}` (right description panel, E1), **`serviceDesc`** `{route:[title,subtitle]}` (panel text), **`externalLozenges`** `true` (auto: places on ≥2 arms) or `["Place",…]` (explicit interchange lozenges, E2), **`busStationNote`** (note by the Bus Station hub, e.g. the town circular, E6).
- `gen_internal.js` has **no per-town code edits** any more — the old hand-edited bits (`classify`/name-tidy + POI filters → `poi`; `desc{}` → `internalDesc`; draw order → `routeOrder`; panel list → `panelOrder`; title → `town`; road prefix → `atcoPrefix`; orientation loop → `orientationRoute`) are all `routes.json` keys above. Linear features incl. labels are config-driven via `features[]`.
- **River label fallback:** if a town does *not* declare `features[]`, the generator synthesises one river feature from `river_geo.json` and labels it `routes.json`'s **`riverLabel`** (defaults to `River Great Ouse` if absent — set `riverLabel` for any non-Ouse town, e.g. March = `River Nene (old course)`).
- **North arrow is DRAWN BY DEFAULT on every internalRoads map** (2026-07-20, Peter's "north arrow on every map"). It auto-computes the on-screen bearing of north from the map's rotation. Set `internalRoads.northArrow:false` to suppress, or `{x,y,len?,angle?}` to position it (default `{x:14,y:150}` can land under route lines on a busy town — pick a clear spot, e.g. St Neots uses `{x:88,y:48}`). The pure abstract DIAGRAM has no meaningful north and omits it.
- **`internalRoads.termini` single-ended labels self-correct** (2026-07-20): write a route's destination as `end:"X"` OR `start:"X"` without checking which chain-end map-matching cut — a lone tail gets the label wherever its frame-cut is (`false` still suppresses a side). Truncated tails that stop at an interior junction are pulled to the frame edge with S2's `match_cfg.json reachExtend`; a shared "to X" across 2+ differently-coloured routes is drawn in black automatically.
- **Extra fisheye lens(es)** — `internalRoads.lenses:[{center:[lat,lon],radiusKm,mag}]` magnifies a congested cluster (bounded Sarkar–Brown fisheye, boundary fixed → the rest of the map is untouched) on top of the always-on centre `focus`. St Neots v2.0 uses one on the One Leisure/Eynesbury knot (`mag:1.7`). **Standing step:** after a first draft, if the map has a congested spot, *ask the user which area(s) to fish-eye* rather than guessing.
- **`_latest\` folder** — after S5 (and the diagram/S6), run `node "%SK%\refresh_latest.js" "<townDir>"` to copy the newest `internal.jpg`/`external.jpg`/`internal-diagram.jpg`/`disagreements.docx`/`verification.docx` into `<townDir>\_latest\`, so the key deliverables are reachable without digging through dated stage folders. Copies (not links) — robust across moves/zips. It's part of the standard build.
- External: choose **`gen_external_radial.js`** (default) — set `bearing`/`side`/`titleColor`; multi-arm routes (same number twice in `external[]`) get an auto note. Or **`gen_external_busway.js`** for a P&R/busway town — set `busway[]`; rows now auto-distribute (no `yMap` code edit) and the map carries a redesigned right Services panel, intermediate-place lozenges, two-arm support, a Bus Station ↔ P&R link, and built-in label de-collision. The busway generator is St-Ives-shaped; its additive features are config-gated so the only St Ives delta is now data, not code.
