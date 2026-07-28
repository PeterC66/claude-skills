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

### The complexity-remedy keys

From the triage ladder ([complexity-triage.md](complexity-triage.md)). All opt-in;
**absent ⇒ byte-identical**, like every other key here.

#### `internalCorridors` — rung 1, LIVE since P2 (2026-07-28)

```json
"internalCorridors": { "1": ["1A","1B"], "102": ["103","104","105"], "32": ["32A"] }
```
*(also accepted: `{ "<lead>": { "routes": [...] } }`)*

Draw a family of co-running services as **ONE line carrying a vertical stack of badges** instead of
one coloured line each — the internal twin of `external[].routes`. Reach for it when the triage gate
says **R > 12**: the colour-blind-safe palettes hold ~12 usable hues, and past that colour stops
identifying a route at all. High Wycombe: 31 lines → 24 with four families.

The **config key is the lead**. It keys the colour, the overrides and the badge-stack order.

What the generator actually does — worth knowing, because it decides how you use it:

- **Colour.** Every member takes the lead's colour (and `textOn`). Only routes already in `palette`
  are touched, so the palette's key order — and therefore the default `routeOrder` — cannot shift.
  Applied after `overrides.json` `routeColors`, so recolouring the lead moves the whole family.
- **Lane.** The family counts as **one lane** in the corridor-offset maths. Where the members run the
  same road they land on the same centreline and overdraw into a single visible line; where they
  **diverge they simply separate again**, because nothing merged their coordinates. "The bundle must
  split back where the routes diverge" is therefore satisfied *by construction*, not by a rule
  someone has to remember.
- **Badges.** At each badge point only the first family member present draws, and it draws the stack
  of the members co-running *there*. A member alone on a divergent branch is its own group leader and
  still badges that branch — which is what keeps identity on the split.
- **Report.** `corridors_report.json` is written next to `internal.svg` with each member's overlap
  against its weakest sibling, and the run **warns on stderr below 0.6** — the same bar
  `complexity_score.js --overlap` uses to propose a family. **Read it. Drop any family that warns:**
  below that, most of the sheet is two same-coloured lines going different ways, which is worse than
  two colours.

**Pick the same lead as `external[].routes`** for a family that is merged on both sheets, and the
internal and external maps keep the same colour for it. Bundle internally *without* merging
externally and that family's colour correspondence between the two maps is broken — a real cost,
not a detail.

Get the candidate list from `curate_services.js` (see [s2-geometry.md](s2-geometry.md)); it prints a
paste-ready block. **They are candidates, never decisions.**

#### `coreBox` — rung 2, LIVE since P3 (2026-07-28)

```json
"coreBox": { "radius": 600, "label": "town centre", "sublabel": "all routes call here" }
```
*(optional: `at:[x,y]`, `w`, `h`, `fill`, `stroke`, `textSize`)*

Replace the congested town centre with a plain labelled box that routes run **to** and stop at. This
is the single most decisive move on a commercial operator's own big-town map, and it is the **only**
remedy for a trunk-corridor congestion (`D5 > 3 km`) — a fisheye lens cannot help there.

- Route lines are **cut at the boundary**, not hidden under the box, so each visibly runs to it. A
  route that crosses the centre and comes out the other side draws as two runs.
- Stop ticks, POIs, road labels, the anchor label and route badges inside the box are dropped; the
  road skeleton and any linear feature are covered by the opaque box.
- `radius` is in **metres from `anchor`**, matching how `complexity_score.js` models rung 2, so the
  predicted score and the drawn sheet mean the same thing. The page rectangle is derived by
  projecting a real geographic circle of that radius and taking its bounding box — exact under any
  fisheye or `lenses[]`, with no assumption about local scale.

**Two things to check on the first draft.** The focus fisheye *magnifies* the core, so the drawn box
comes out much larger than an unmagnified 600 m would look — cut `internalRoads.focus` (or the
radius) if it swallows the map; decide which of the two owns the centre. And a `features[]`
`labelPos` sited on the town centre will now sit inside the box: the generator **drops that label and
says so on stderr** rather than printing it on the box, so move it.

#### `stopThinning` — rung 2b, LIVE since P3 (2026-07-28)

```json
"stopThinning": true          // or { "minLines": 2, "termini": true, "keep": ["ATCO"], "drop": ["ATCO"] }
```

Draw only the stops that earn their place: those served by `minLines` or more **drawn lines**, plus
every line's two end stops (and always the `anchor`). Counted **per lane**, so a stop served only by
a bundled `1/1A/1B` counts once, not three times.

Label load is independent of route count — a town can clear R, K5 and D5 and still be unreadable
because 300 ticks fight for the same square centimetre — so **the ladder cannot finish without
this**: High Wycombe stays RED on S alone however well rungs 0–2 do. Same rule the gate models, so
prediction and sheet agree. High Wycombe: 320 stops → 164.

#### `corridorPalette` — rung 3, LIVE since P3 (2026-07-28)

```json
"corridorPalette": { "31": ["41"], "34": ["36","37"] }
```
*(same shape as `internalCorridors`)*

Colour by **corridor** rather than by route. Members keep their own line and their own lane — only
the colour is shared — so this is the remedy for routes that follow the same corridor but do **not**
co-run closely enough to bundle (High Wycombe's 31 and 41 overlap 0.40/0.46: one corridor, two real
lines). Identity moves to the badges, so the badge pass **guarantees every colour-shared line at
least one badge**, ignoring collision if it has to: an unidentifiable line is a worse defect than a
crowded one.

**This retires a locked design decision.** "One colour per route, consistent across both maps and
across updates" no longer holds for a town that uses it. Approved 2026-07-28, **bounded to towns
drawing more than 12 lines**, never a default and never inferred — the groups are declared, so a
data refresh cannot silently reshuffle a town's colours.

**Know what it does not do.** It does not reduce how many colours the town uses; it makes the sharing
*mean something*. High Wycombe v1.0's real disease was 12 hues spread arbitrarily over 31 routes —
colour repeated, but at random. So re-assign `palette` so each corridor gets one hue and no two
corridors share one; the generator then **warns about every hue still shared by unrelated groups**,
which is the defect being fixed. With this key set, `complexity_score.js` reports **R as distinct
colour groups** (and `linesDrawn` alongside), because R exists to police the ~12-hue ceiling.

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
