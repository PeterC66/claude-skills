# Design quality — the `design` and `labels` keys, and the placer behind them

What to read when a sheet looks amateur rather than wrong: labels sitting across route ribbons, symbols fused into blobs, names printed and then erased by the footer band. `%SK%` = the skill's `assets` folder. The plan this implements, with its measured before/after, is `…\Buses\Development Docs\label-and-design-quality-plan_2026-08-15.md`.

> **The rules these keys implement are stated in [style-guide.md](style-guide.md)** (2026-08-16, Phase 8 item 2). That document says what a sheet must look like; this one says how each rule is implemented, what it is tuned to, and what it cost to learn. If the two ever disagree, the style guide is the intent and this file is the record — fix whichever is wrong, in the same session.

## The short version

`routes.json` keys, all opt-in, all defaulting to the pre-2026-08-15 behaviour:

```json
"design": { "footerSafe": true, "spreadIcons": true, "iconInk": "charcoal", "iconSet": "grid",
            "panelScale": true, "scaleBar": true, "routeCasing": true, "cornerRadius": 2.0,
            "badgeFit": true, "hubFit": true, "panelCorridors": true, "spokeSpread": true,
            "legendPlace": true, "printSafe": 5 },
"labels": { "engine": "v2" }
```

Every built town carries all of these as of 2026-08-16 (towns at Beaconsfield v1.34, High Wycombe v2.38, Huntingdon v3.32, March v2.32, Ramsey v1.31, St Ives v6.45, St Neots v2.33, Wisbech v1.34, engine `ace07f941f`), **except two, which are town-specific rather than universal**: `panelCorridors` only means anything on a town that declares `internalCorridors` (today just High Wycombe), and `spokeSpread` is carried by **Beaconsfield, Huntingdon, March and Ramsey** — the other four are blocked by legend size, not by the bearing rule. `panelCorridors` also needs `corridorDesc` (and optionally `corridorNote`) beside it. Places carry none of this. **The portal re-vendor is DONE (2026-08-16) and did not change them** — re-vendoring copies the engine, and every key here defaults off, so the places move only when the keys are *adopted* on them. That is Phase 8 items 3b and 4, not this one.

Measured over the 31 shipped sheets, before → after: **628 → 225 defects** (`node "%SK%\quality_metrics.js" --all`), plus **0 artwork buried under a legend**. Ramsey external was the first sheet to reach **0 defects**; Huntingdon external is the first to report **`ok` rather than `warn`**. Fused icon pairs: 110 → 1, and that one is on a place sheet. Labels printed over a symbol that is not their own: 190 → 44. Content buried under the footer band: 12 sheets → 1, and that last one is a place sheet — but note the baseline moved from 271 to 276 when `textUnderFooter` was found to be counting only text *straddling* the plate's edge, so "12 → 0" as this file used to claim was never true. Four of the design keys add ink of their own (a scale bar, its caption, a not-to-scale note, a white casing), so the total is not monotonic and should not be read as one.

**Not every key is judged by that number.** `panelScale`, `scaleBar`, `routeCasing`, `cornerRadius`, `badgeFit`, `hubFit` and `panelCorridors` all moved the artwork and moved the defect count by 0 or ±1, because every metric in `quality_metrics.js` is about *labels and ink on the map* — none of them looks at the panel, at line separation, at corner geometry, or at the inside of a symbol. Render those and look.

## `design`

**This table is the register, and it is gated.** `npm run gate:design-keys` requires every `design.*` key the engine reads to have a row here, and every row to name a key something still reads; `npm run test:prove-red-design-keys` is its falsification, and both run in CI. So **add the row in the same commit as the key** rather than afterwards. It was built on 2026-08-28 because this table had 19 rows against 33 keys — `laneOrientation` had become a DEFAULT the day before and was not in it — and nothing could catch that, because a table with a Default column reads as a complete list whether or not it is one. Where a key has a fuller account further down, the row says *Section below* and points at it; the row is not the place for the whole story, but nothing may be missing from the table.

| Key | Default | What it does |
|---|---|---|
| `footerSafe` | off | Ends the map frame just above the footer's backing plate instead of at a flat `y=205`. The plate starts at 195.16 mm and is painted last, so a 9.84 mm strip of every sheet used to be drawn and then covered — 12 of 31 sheets had real route ink in it and 9 had erased *text*. The fit is derived from the frame, so the map refits into the space that is actually visible; expect the whole map to shrink by about 6% vertically. |
| `footerGap` | `3.0` | mm of clear air between frame and plate. Not smaller without checking: the terminus exit **arrows** are drawn outside the map's clip group and point 2.6 mm past the frame, so a 1 mm gap leaves their tips under the plate and the ink measure barely moves. |
| `spreadIcons` | off | Pushes POI symbols apart until they are `iconMinSep` apart, capped at `spreadMax` mm from the true position. Hand-placed POIs (`overrides` `pos`/`move`) are pinned and never moved. |
| `iconMinSep` | `3.2` | mm centre-to-centre below which two 4.2 mm symbols read as one blob. |
| `spreadMax` | `2.6` | mm a symbol may be displaced. Displace, don't drop — but not so far that it stops being where the thing is. |
| `dedupeStopsMm` | `30` | External sheets only: two spokes calling at the same village label it once, not twice. |
| `panelScale` | off | One type scale and one heading rhythm for the Services/Key panel. Section below. |
| `panelCorridors` | off | One Services row per **drawn lane** rather than per service, wearing the badge stack the map draws, plus a sentence stating the corridor rule. Needs `internalCorridors`; ignored (with a note on stderr) without it. Section below. |
| `spokeSpread` | off | External sheets: spreads the spider's spokes evenly around the hub in their own bearing order, clamped to `maxShift` (default 30°) of the true bearing. `strength` < 1 blends. Section below. |
| `badgeFit` | off | Draws a route badge as a **stadium** instead of a disc when its number is wider than the disc. Section below. |
| `hubFit` | off | External sheets: sizes the hub box from its text instead of from a character count. Section below. |
| `exitDevice` | off | **Built, measured, deliberately off.** One fixed design for every off-map continuation. It costs 15 defects to buy the consistency; see the section below before proposing it again. |
| `iconSet` | off | `"grid"` swaps the twelve POI pictograms for the redrawn set: one 24 × 24 grid, one stroke weight, one corner radius, solid, each with a white casing. Pairs with `iconInk`, does not need it. Section below. |
| `sheetUrl` | off | A short address printed in the footer band — the sheet's route back to the version that is current *now*. Prefixed `https://` for the QR when it has no scheme of its own. Section below. |
| `sheetUrlLabel` | `"Check for a newer version:"` | The words before `sheetUrl`. `false` prints the address alone. |
| `sheetQr` | **`{mm:14}`** | Draws a QR code of `sheetUrl` at the bottom-right of the footer band. **A default since 2026-08-24** — all 20 maps set exactly `{mm:14}` — and it only fires where `sheetUrl` is set, so a sheet with no address to point at still draws no code. `false` refuses it; `{mm, level, target}` tunes it — `mm` is the module area's side (14 from the generators, 16 if you pass a bare `true` and let `footer.js` choose), `level` the error-correction level (`L`/`M`/`Q`/`H`, default `M`), `target` a different URL to encode from the one printed. Section below. |
| `howToUse` | **on** | External sheets: a "How to use this map" panel of plain bullets, worded from the town's own data. **On by default since 2026-08-24**, `false` to refuse it — but each town's own `bullets` stayed explicit, because those are content and not a flag (all 8 keep a hand-picked three of the five derived). `{heading, bullets, at, width, size, headingSize, place}` tunes it. Section below. |
| `printSafe` | off | `5` keeps every drawn thing 5 mm from the trim — footer, placer, panel columns, terminus lozenges — and carries the rest of the 2026-08-16 print check with it. **On all 8 towns; the 5 places do not have it yet.** Section below. |
| `iconInk` | off | `"charcoal"` recolours every POI symbol to one neutral, keeping red for the GP cross, so **colour on the sheet means route and nothing else** (G3, Peter, 2026-08-15). Implemented in `icons.js` as a post-pass over the existing drawings, chosen over a redrawn outline set because at 4.2 mm a 0.5 mm outline goes noticeably faint against a ribbon while these solid glyphs hold their weight. Two things it is careful about: a pale fill is a backing plate, not a mark, so it goes white rather than black (the allotments bed); and a symbol that was *already* a neutral grey was drawn light on purpose, so it keeps its tone rather than flattening to charcoal — the industrial estate is context, and a cluster of factories at full charcoal was the heaviest ink on the High Wycombe sheet. |
| `laneOrientation` | **on** | Orients every corridor's lanes consistently along the street, so co-running services stop crossing for no reason a reader can see (`lane_normals.js`). **A default since 2026-08-27**, and `false` is now the only way to decline it — **St Ives is the single decline**, being the one map whose corridors cannot all be consistently oriented; the engine names that case in `build-warnings.txt` and stays silent on the other seventeen. It cures the **lane mirror**, which `quality_metrics.js` scores identically to a clean bundle, so judge it off the artefact and never off the numbers. `gen_internal.js` requires `lane_normals.js` at load, before it reads anything: the portal must receive both files or neither. |
| `frequencyTiers` | off | Draws how USABLE a service is rather than how many journeys it runs — line weights by tier, plus one Key row per tier actually drawn. **It needs `routes.json`'s `frequency` block**: `FTIER` is null without it, so the key on its own does nothing. On all eight towns since 2026-08-18. **A line weight is a label-placement budget**: 2.4 mm for the frequent tier cost three real place labels, and 2.2 mm recovers two of them at no visible cost to the hierarchy, which is why `quality_gate.js` gates `mapLabels` as a floor. |
| `reserveIcons` | **on under labels v2** | Blocks out a box for each POI symbol so the placer treats a pictogram as real ink rather than empty ground, in two sweeps — honour the symbols first, and relax only where a label would otherwise have nowhere to go. `gen_internal.js` sets it true when `labels.engine` is v2 and the key is absent, and every committed map runs v2, so in practice it is on everywhere; `false` turns it off. |
| `routeCasing` | **on**, `{mm:0.35}` | A white casing under every route line, so a crossing reads as one line passing over another instead of a junction. `false` removes it; `{mm}` sets the width. Section below, with `cornerRadius`. |
| `cornerRadius` | `2.0` | One corner radius on the route lines. `false` gives square corners and `true` means 2.0. Section below. |
| `cornerMinTurn` | `30` | Degrees of turn below which a corner is left unrounded, because a shallow kink is not a corner and rounding it only shortens the line. Section below, with `cornerRadius`. |
| `scaleBar` | **on** | The internal sheet's scale bar. `false` removes it **and** adds *Diagram — not to scale.* to the footer, so switching it off is a statement about the sheet rather than a deletion from it. The engine says so on stderr when the bar cannot be fitted, and the not-to-scale bullet appears only once `false` has been set. |
| `legendPlace` | off | Lets the legend find its own clear ground instead of sitting in a fixed corner, searching against the same reserved boxes the placer uses. Absent leaves it exactly where it has always been. Section below. |
| `labelInkMinContrast` | **`3.5`, on** | A floor on the contrast between a label's ink and the route colour beneath it, so a colour chosen to be SEEN is not also asked to be READ (`inkOnWhite()`). **On by default since 2026-08-24 and NOT byte-inert** — it changes sheets that never asked for it, which is the whole point of the distinction under **Byte-inert**. Section below. |
| `keyCols` | `2` | The Services panel's pictogram columns, clamped to 1—3 (`gen_internal.js`). Eight places have an internal sheet where it does real work, which is worth knowing before a bulk edit: `adopt_config.js --all-places --unset design.keyCols` was once about to strip it from **eleven** places on the strength of a backlog row saying it sat inert in two. |
| `featureLabelAuto` | off | Says `features[].labelPos:"auto"` for the whole sheet: each linear feature's label sites itself on the longest run of its own ink that lands inside the frame, offset clear of the line, on a box that collides with nothing already reserved. Prefer it to a hand-set `{x,y}`, which is a page-mm constant pinned against geometry that moves under it at the next refresh. |
| `limitedKeyLabel` | `"Dashed — certain days only, check times"` | The wording of the external sheet's line-style Key row, which appears by itself whenever a drawn spoke is `limited`. It matches `gen_internal.js`'s `FTIER_LABEL.limited` so both sheets of one map explain the dash in the same words; override it only for a town whose dashed services mean something unusual. |
| `sheetVersion` | off | The published version printed in the footer band, in the hole the QR code left behind. `rollout.js` stamps a **build** identifier here (`build 6.54 · 19 Aug 2026`), which is right for a map built in this tree and wrong on a public sheet — so the portal overrides it at render time with `LEAFLET_SHEET_VERSION`, giving `Map version 5.0` on a published sheet and `Draft 5.0 · <when>` on a download. Do not read this field as what the customer sees. |
| `fixedOrientation` | off | Pins the internal map's rotation to a stated bearing in degrees, so a data refresh cannot quietly re-solve it. **Do not normalise the value into 0—360.** `-66` and `294` are the same bearing to a reader and different floats to the FPU, and the tidy-up moved the artwork: a sheet pinned at `-66` stopped reproducing the same bytes as the identical sheet built from `internalRoads.rotationDeg:-66`, which the byte gate would report as a regression that is nothing of the kind. `freeze_orientation.js` writes the applied angle back. **No map is pinned today** (OA-075). |

### `design.exitDevice` — built, measured, and deliberately OFF

Plan §2.5 asked for one design for off-map continuations, on the observation that St Ives draws seven of them four different ways. **It is built and it is not switched on anywhere**, because measuring it showed the premise was wrong. Read this before proposing it again.

**What the four arrangements actually are.** Not arbitrary variation — the placer routing around ink that differs at each exit. Two facts about the geometry decide it:

- **Straight inboard along the line is on the route ribbon.** The line does not stop at the badge; it carries on to the frame cut. So the position that reads best on a diagram — destination, badge, arrowhead, off the page — is the one position guaranteed to be inked.
- **The clearest space near a frame cut is OUTBOARD**, between the badge and the margin, because the map's content thins out at its edge. That is the one direction a device cannot use, since the text would then sit between the badge and the arrow and read backwards.

**Measured across the eight internal sheets**, today = 173 defects:

| device | defects | |
|---|---|---|
| today — placer free, leaders allowed | **173** | |
| no leaders, direction still free | 178 | +5 |
| inboard half only, either perpendicular first | 188 | +15 |
| inboard half only, perpendicular-left first | 188 | +15 |
| straight inboard first (§2.5's literal wording) | 194 | +21 |

Almost all of the rise is `pt/ink`, labels over route ink. Rendered at 300 dpi the picture agrees with the number, which is worth noting because on this project it usually does not: the strict device puts St Ives' "to Bar Hill" across three ribbons and pushes "to Boxworth" onto the frame edge, where today both sit in clear white space on short leaders. It does improve the *uncrowded* exits — B and 9 both go to text-beside-badge with no leader — but a device is only a device if it holds at the crowded ones.

**Decision, Peter, 2026-08-16: leave it alone.** Same shape as Phase 7's colour-group item — the plan expected to have to change something, and the measurement said not to.

**What is in the engine, off:** `design.exitDevice:true` puts the "to X" text on the inboard half, square to the line, no leaders, preferring the perpendiculars; `labeller.js` gained `it.only` (an ordered shortlist of compass keys, with every other position kept as a last resort at `wOffDevice`, so a device can never *drop* a destination — the look is negotiable, the information is not); and `gen_internal.js` warns on stderr when an exit could not take an inboard position. Absent the key, output is byte-identical and all 27 gates pass. **If it is ever revived, the thing to fix first is the badge row, not the text** — every one of these positions is contested because the badge sits 5 mm back along a line that is still drawing.

### `design.iconSet` — the twelve pictograms on one grid

Shipped 2026-08-16, all eight towns. `iconInk` answered G3's *colour* question in August and deliberately left the draughtsmanship; this is that half. The shipped drawings are three visual languages at three stroke weights and three levels of detail — flat glyphs (tree, mortarboard, factory), outlined boxes (GP, pharmacy, allotments) and small illustrations (a trolley with wheels *and* basket bars) — and they differ in size by a third. `gridGlyph` in `%SK%\icons.js` redraws all twelve to four rules, and the rules are the set:

1. **24 × 24 units, 2 units of padding, live area 20 × 20**, keylines square 18 and circle 20 — so a square glyph and a round one look the same *size* rather than measuring the same.
2. **One stroke weight (2.6u) and one corner radius (2u).** Nothing else.
3. **Solid marks**, no limb or gap narrower than the stroke. A 0.5 mm outline at 4.2 mm goes faint against a ribbon; that is what the G3 sheet showed and why the outline first pass was rejected.
4. **The LIVE AREA is the box the engine reserves.** 20u maps to 2·s mm, so at the map's `s = 2.1` a glyph fills the 4.2 mm box `POI_HALF` declares and no ink crosses it.

**Rule 4 is the one with teeth, and it was a genuine pre-existing bug.** The shipped glyphs reach ±2.48 mm in a box the placer treats as ±2.1 — about 18% outside what `reserveIcons` blocks and `iconMinSep` separates — so two symbols the placer scored as clear could still touch, and a label placed against the box edge could still land on ink. Fixing it is where most of the measured gain came from: **labels over a foreign symbol 80 → 44** across the board, High Wycombe's diagram 35 → 20 on its own.

**Every glyph carries a 0.34 mm white casing**, and it is the same device and the same weight as `design.routeCasing`, for the same reason: solid charcoal on a dark route is charcoal on navy. Four of the shipped twelve escaped that only by accident, because they happened to have a white fill. Two things about it:

- **It must be a separate PASS** — a fattened white silhouette of the whole glyph, drawn before the glyph. `paint-order:stroke` per path looks equivalent and is not: a later part's casing eats an earlier part's fill, and the tree's trunk cuts a white notch out of its own canopy.
- **It replaces option D's pale disc** and it also does `spreadIcons`' job at close quarters. At exactly `iconMinSep` the shipped tree and mortarboard fuse into one blob, as do the two figures and the runner, and the museum and the town hall; with a casing the second symbol knocks a clean edge out of the first and the pair still reads as two things.

**`inkify` is not used on this set and must not be.** Its two exceptions are carried across as data instead: red on the GP cross, and a lighter neutral (`#7c7f82`) for the industrial estate, which is context rather than subject — a cluster of factories at full charcoal is the heaviest ink on the High Wycombe sheet. `inkify` infers both from the artwork's luminance, which is a workaround for artwork that was authored in colour; the new set takes one colour parameter.

**One drawing decision worth knowing:** GP and pharmacy are the *same drawing* in charcoal today, two white boxes differing only in red versus green. They are now the same cross in different keylines — square and circle — so the pair survives losing its colour.

Judged on the sheets, not on the number: previewed across all eight towns (209 → 173 on the town sheets, **no label lost anywhere**), then crops of St Ives and High Wycombe compared against the shipped renders at 300 dpi, then the Key panel checked at its own `s = 2.0`. Every rolled-out sheet is byte-identical to the preview it was judged from. The comparison sheet is `…\Buses\Development Docs\icon-set-redraw_2026-08-16.html`; regenerate it with the `.js` beside it.

### `design.badgeFit` — a route number that does not fit its disc

`badge()` draws its text at font-size = the badge **radius**, which is right for one to three narrow characters and wrong for anything wider. The text simply overflowed, on all three badge sizes and on both sheets, so the number read as sitting *on* the roundel rather than in it. Found 2026-08-15 on Ramsey, whose enlarged map made it obvious; it is pre-existing and affects **four of the eight towns** — High Wycombe (`M40`; its `WW1` `LGW` `LHR` `OXF` are prose, not badges — see the correction below), Ramsey (`301S` `301V` `301X`), St Ives (`VL14`), March (`ZIP2`). Beaconsfield, Huntingdon, St Neots and Wisbech have no wide key, and their sheets do not move.

**It is a width problem, not a length one** — which is the whole reason the fix measures with `font_metrics.js` rather than counting characters. High Wycombe's three-letter codes are *worse* than Ramsey's four-character keys:

> **CORRECTION, 2026-08-16, from the §5.3 print.** The table below is right about the type and wrong about which sheet shows it. **On High Wycombe's internal sheet only `M40` ever reaches a badge** — `WW1`, `LGW`, `LHR` and `OXF` appear solely inside prose map notes ("LGW / LHR / OXF (Oxford Bus 'Airline' coaches) call at Handy Cross…", "Speen and WW1 Adams Park (matchdays)"). So `WW1` at 5.87 mm in a 4.8 mm disc, quoted here as the worst case on the board, is a badge that sheet never draws. The feature is still right and still needed — `M40`, Ramsey's `301S`/`301V`/`301X`, St Ives' `VL14` and March's `ZIP2` are all drawn — but **check where a key is actually rendered before citing it as the example**. Measured widths are not evidence that anything on the sheet is that wide.

| key | at r=2.4 (stop) | at r=3.0 (terminus) | at r=4.0 (panel) | disc |
|---|---|---|---|---|
| `WW1` (High Wycombe) | 5.87 | 7.33 | 9.78 | 4.8 / 6.0 / 8.0 |
| `VL14` (St Ives) | 5.74 | 7.17 | 9.56 | ” |
| `301S` (Ramsey) | 5.61 | 7.01 | 9.34 | ” |
| `LGW` `M40` `LHR` `OXF` (High Wycombe) | 4.67–5.60 | | | ” |
| `ZIP2` (March) | 5.07 | 6.34 | 8.45 | ” |
| `X31` — **fits, stays a disc** | 4.27 | 5.34 | 7.12 | ” |

**The fix is the shape, not the type.** Shrinking the font to fit is the smaller change and it fails where it matters most: fitting `301S` inside a 2.4 mm-radius stop badge needs **1.8 mm** type, well under the 2.4 mm print-legibility floor `quality_metrics.js` enforces. So the badge grows sideways into a stadium — what operator maps do with a lettered route number — and the type keeps its size. Overflow is measured against the **diameter** with 0.3 mm of inset, not against a chord: `X31` pokes a hair outside the circle at the corners of its cap band and has always looked fine.

`badgeHalfW(route, rad)` is the one place that decides how wide a badge is, and `badgeXW` is the same number as an **extra over the radius**. Every pitch, clamp and reserve box downstream is written as *the old literal plus that extra*, never recomputed — which is what keeps a town with no wide key bit-for-bit identical rather than merely close. Widened for it: the sprinkled-badge spacing and its two collision tests, the terminus cluster's badge pitch and both frame clamps, the panel and `panelCols` badge columns, and on the external sheet the spoke's badge stack, its terminus-box clearance and the operator legend's column pitch.

Two judgements worth knowing before changing it:

- **The panel gets ONE badge-column width, not one per row.** Sizing each row to its own badge was the first cut and it looked worse than the bug: three pills at the foot of Ramsey's list pushed only their own titles right, giving the panel a ragged title column *and* a ragged badge column at once. A panel is a table — badges centre in one column, every title starts at the same x. `panelCols` warns on stderr if the widened column pushes a title past `panelCols.width`.
- **The terminus label's `own` box is deliberately NOT widened**, though the `reserve` beside it is. `own` is the label's *exemption* from its own badges, so widening it with the pills buys the label permission to sit on them. Measured on Ramsey: widened, `to St Ives` and `to Huntingdon` both came inside and printed over the ribbon (3 → 5 defects); left alone, one keeps a clean spot (3 → 4) and neither is dropped, because both are `mustPlace`.

**What it costs**, previewed across all eight towns (218 → 218 defects, i.e. neutral — and see the note above about what this metric does not measure; badge text is skipped entirely by `quality_metrics.js`, so the fix itself is invisible to it and only the knock-on label movement shows):

| sheet | defects | labels |
|---|---|---|
| High Wycombe internal | 33 → **31** | 80 → 78 — lost `Aldi`, `Hannah Ball`, `Totteridge Road`; gained `Beechview` |
| High Wycombe external | 5 → 6 | — |
| Ramsey internal | 3 → 4 | 32 → 32 |
| Ramsey external | 3 → 3 | 7 → **8** — gained `Colne` |
| every other sheet | unchanged | unchanged |

**Not done, deliberately: `gen_external_places.js`.** It is the one badge-drawing generator left on the old behaviour, because it is vendored to the portal's `engine/place/` and `font_metrics.js` is **not yet vendored there** — adding the require would throw at the portal's require time rather than fail a byte gate (the exact trap recorded in `changing-the-engine.md` §4). No place has a wide key today, and place *internal* sheets get the fix for free through `gen_internal.js`. Do it in Phase 8 alongside the re-vendor. `gen_external_busway.js` is likewise untouched, since §2 keeps it unedited and no town uses it.

### `design.hubFit` — the external hub box, sized from its text

Same defect class as `badgeFit`, found while verifying it. The hub's width was `characters × 2.6 mm + 6`, which measures nothing: at 5.2 mm Arial Bold a real glyph runs 1.16 mm (`I`) to 4.91 mm (`W`). Measured across the eight towns, the padding that formula happened to leave ranged from **−0.18 mm to +4.73 mm a side** — `High Wycombe` overflowed its own box (37.56 mm of text in 37.20 mm) while `St Ives Bus Station/` sat in 4.73 mm of slack.

`hubFit` asks `font_metrics.js` and pads **2.2 mm a side**, near the middle of what the old formula gave, so no hub moves far: +4.8 mm on High Wycombe (the overflow), −5.1 mm on St Ives (the slack), under 2.4 mm either way on the rest, and March does not move at all because it is pinned by the 22 mm floor. The knock-on to watch is that `HUB_W` feeds `HUB_A`, the spoke clear-zone ellipse, so every spoke's start point shifts with the box.

**The terminus lozenges deliberately keep their character-count formula** (`measureNodeWidth`). Measured at the same time, it works: across 312 text lines in nodes on the eight shipped sheets the tightest was Wisbech's `Downham` at 0.88 mm a side and nothing overflowed — its 18 mm floor and +4 padding absorb the error the hub's did not. Changing it would move every lozenge *and* every spoke's badge offset (`_autoOff` derives from it) to fix nothing, so it stays until something actually overflows. The wrap width stays in characters too: where a two-line hub label *breaks* is a layout choice, not a fitting bug.

Previewed across all eight: **218 → 217 defects**, no label lost anywhere, High Wycombe external 6 → 5, St Ives external gains one label.

**After this and `badgeFit`, nothing on any of the 31 shipped sheets overflows the shape that contains it** — 1,327 centred text lines checked against real Arial metrics, 0 overflowing. That check is worth re-running after any change to a badge, lozenge or hub; the trap when writing it is that a bare `width="…"` regex also matches `stroke-width`, and that consecutive `dominant-baseline="central"` text after a shape may be a *neighbour* (the operator legend draws a badge, then the operator's name beside it), so filter on `text-anchor="middle"` and on the text's x matching the shape's centre.

### `design.panelScale` — the panel's type scale and rhythm

The Services/Key panel had accumulated **eleven text sizes with no relation between them** (5 / 4.4 / 4 / 3.5 / 3.2 / 3 / 2.9 / 2.8 / 2.5 / 2.3 / 1.95) and two hand-tuned leadings, `panelRow` for the services list and `keyRow` for the Key, that did not agree with each other or across towns. Its two section headings, which are peers, printed at different sizes with different amounts of air. Uneven panel rhythm is among the fastest amateur tells and is entirely arithmetic to fix (plan §4.4).

**The scale** is a 1.2 ratio anchored on the route title and floored just above the 2.4 mm print-legibility threshold `quality_metrics.js` enforces — the dense two-column subtitle was 2.3 mm and failed it:

| mm | Used for |
|---|---|
| **5.0** | section heading — `Services` and `Key`, now the same size |
| *(4.2)* | a step nothing needs; listed so the 3.5 → 5.0 jump reads as skipping a step |
| **3.5** | route title, single-column and grouped |
| **2.9** | route subtitle, operator group header, Key item, fare note — and the route *title* in a dense `panelCols` panel, one step down |
| **2.45** | subtitle in a dense `panelCols` panel |

Badge text is not on the scale: it is sized from its badge, so it is a symbol, not type. (This line used to claim `badge()` *fitted* the text to its disc. It did not — see `design.badgeFit` below.)

**The rhythm** is one rule for every heading, stated as **clear air between real ink** rather than as a baseline step — so a 5 mm heading gets the same optical gap over 3.5 mm titles as over 2.9 mm Key items, which a fixed baseline step cannot give. Air above a section heading (5.0 mm) is deliberately larger than air below it (3.2 mm), so the heading reads as belonging to the list under it; the operator group header is a lesser break at 3.4 / 2.0. "Ink" means whatever stands highest in the row, which for a route row is the **badge**, not the text — see `gotchas.md`.

`keyRow` is still honoured but no town sets it any more; the two that did (St Ives 3.8, High Wycombe 4.2) have had it dropped, so the Key runs at one pitch everywhere. St Ives' 3.8 was overlapping its own pictograms.

**Two build-time warnings come with it**, because the scale exposes panels that were already over-stuffed rather than quietly shrinking type to fit:

- `panelScale: panelRow Nmm leaves …` — a subtitle and the badge below it are touching. St Ives was at −0.01 mm and moved to `panelRow: 7.2`; the default 8.0 clears with 0.39 mm.
- `panelScale: panelCols row Nmm cannot carry the type scale …` — **High Wycombe used to fire this; `design.panelCorridors` is what fixed it** (2026-08-16), not a third column and not smaller type. The panel was over-stuffed because it listed 22 services that the map had already bundled into 14 lanes. Section below.

### `design.panelCorridors` — the panel carries the map's lanes, not its services

`internalCorridors` (rung 1) draws a family of co-running services as **one line with a stack of badges**, and `corridorPalette` (rung 3) colours by corridor. The Services panel then listed all 22 High Wycombe services as equal, individually-badged rows and silently undid both — which is what forced the 4.9 mm row pitch that sat its subtitles on the descenders of the titles below them. **The panel, not the pitch, was the over-stuffing.** One row per lane takes it to 14 rows at a pitch the type scale can carry, with no third column and no dropped subtitle. The external spider has always worked this way (`external[].routes`).

The words come from **`corridorDesc: {"<lead>": [title, sub, sub…]}`**, `internalDesc`'s twin for a lane. The badges carry the numbers, so the row's words describe where the *corridor* goes — and "these services run together to there" is a claim about the real world, so it is declared, never inferred, exactly as `internalCorridors` itself is. Absent, the lead's own `internalDesc` is used and the engine says so on stderr rather than quietly labelling six services with one service's destination.

**A lane may carry several subtitle lines, and on the big family it must.** Six buses sharing one road through the town still have six destinations beyond it, and the 22-row panel did print all of them; grouping the rows must not quietly drop that. High Wycombe's `102` row is a title plus four lines:

```json
"corridorDesc": {
  "102": ["Loudwater & Beaconsfield", "102 Heathrow · 103 Windsor",
          "104 & M40 Uxbridge · X74 Slough", "105 Amersham & Chesham",
          "Daily; 104, 105, M40 Mon–Sat"]
}
```

**Two layout decisions worth not re-deriving.**

- **A stack of more than one badge takes its own line**, left-aligned at the column edge, with the text below it; a single badge stays beside its title as the panel has always drawn it. Six 5.2 mm discs are 34 mm across and no title survives what is left of a 49 mm column. The alternative — one fixed badge column wide enough for the widest stack — leaves eleven single-badge rows floating 13 mm from their titles.
- **Every title starts at the same x either way.** A panel is a table; that is `badgeFit`'s lesson applied a second time. The hanging stack then reads as the row's heading, which is what a corridor is.

Columns are balanced **by height, not by row count** (a stacked row is roughly twice a plain one, so seven-and-seven would be lopsided), in contiguous runs so a column still reads top to bottom.

Optional sub-keys, all sensibly defaulted: `cols` / `width` (default: whatever `panelCols` says, else one 96 mm column), `badgeR` (2.6 mm in a multi-column panel), `badgeGap` 0.6, `rowGap` 1.6. Four build-time warnings: a stack too wide for its column, a row's text too wide for its column, a lane with no `corridorDesc`, and the list growing into a pinned `panelCols.keyAt`. High Wycombe's Key moved from `y:96` to `y:102` because of the last one.

**Saying the rule on the sheet is part of the same key.** The triage required rung 3 be "stated in the key" and it never was: a reader seeing 22 numbers in 11 hues, four of them shared, can only conclude the palette ran out — which is precisely the impression the rung exists to prevent. The engine now prints one sentence under the services list, worded from what the town actually declares (`internalCorridors` alone, or with `corridorPalette`), overridable as `corridorNote: "…"` and suppressible with `corridorNote: false`.

**What it costs: nothing the scorecard can see** — 269 → 269, because no metric in `quality_metrics.js` looks at the panel. The label-set diff is 14 old panel strings out, 13 new ones in, and every service's destination survives the regrouping. Judge it by rendering the panel.

### `design.spokeSpread` — open the spider's fan (plan §4.2)

A radial spider is a tube map: spoke **length** already carries nothing (every spoke runs to the frame) and the footer says *Diagram — not to scale*. Bearing is the one geographic claim left, and taken literally it wastes the page. Ramsey's spokes left the east and west of the circle empty while three of them fought over a ~40° fan pointing straight down — which is *why* its labels collided.

The target is an **even distribution around the circle in the spokes' own bearing order**, phased by a circular mean of `bearing − k·step` so the whole fan rotates rather than re-orders (an arithmetic mean breaks at the 0°/360° seam, which is exactly where a north-pointing spoke lives). Each spoke is then clamped to `maxShift` of its true bearing.

**The clamp is the honesty control, and 30° is the default deliberately.** A spoke may be nudged to the edge of its compass sector — Ramsey's SSW Huntingdon drawn SW — but it cannot cross into the opposite one, so "which way do I leave town" survives. `strength` < 1 blends toward the true bearings instead, for a town that only wants the fan opened a little. Order is preserved by construction, which is what keeps the sheet readable as a compass. A town with hand-pinned bearings in `overrides.json` should **not** turn this on: those are inputs here and get spread with the rest.

The run prints every spoke's before → after, the smallest resulting gap and the largest shift, and warns when two spokes are still under 18° apart — which the clamp cannot fix and merging can.

**Previewed across all eight towns** (`--patch-file` with `{"design":{"spokeSpread":true}}`), external sheets only. The first preview read the defect column alone and concluded "adopt on six". **That conclusion was wrong, and the way it was wrong is the most useful thing on this page** — see `design.legendPlace` below. The table now carries both numbers:

| town | defects | buried under the legend | verdict |
|---|---|---|---|
| Huntingdon | 2 → **0** | 0 → **0** | **adoptable** — the §4.2 example that started this |
| March | 1 → **0** | 0 → **0** | **adoptable** — gains `Chatteris` |
| Beaconsfield | 3 → **1** | 0 → **0** | **adoptable** — identical label set; its legend relocates 69 mm |
| Wisbech | 3 → 0 | 0 → **12** | no — legend cannot be placed clear |
| St Neots | 1 → 0 | 0 → **10** | no — and it drops `Great Staughton`, `Kimbolton` |
| St Ives | 4 → 3 | 1 → **8** | no — the +3 labels are bought by burying the Hinchingbrooke spoke |
| High Wycombe | 5 → 5 | 0 → **17** | no, twice over: −2 labels, no gain, and the worst occlusion of the eight |
| Ramsey | 0 → 0 | 0 → 0 | adopted 2026-08-16, with the merge below |

The four "no" towns all fail for the *same* reason and it is not the spread: their legends are 78–106 mm wide and cannot be placed clear of every symbol once the spokes fan out. Their remedy is a **smaller legend** (`legendWrap`, `legendAt.box`), not a different bearing rule.

**Adopted 2026-08-16 on Beaconsfield, Huntingdon, March and Ramsey.** The other four stay as they are until their legends get smaller.

### `design.legendPlace` — the legend finds its own clear ground

**The bug this exists for, because it is a pattern and not an incident.** The operators legend is furniture: pinned in page coordinates, drawn *after* the spider, on an opaque panel. It is pushed into `HARD` so the **label placer** dodges it — but the spokes, terminus lozenges and route lines are laid out knowing nothing about it, and simply disappear underneath. The only defence was `legendAt`, a hand-tuned constant, carried by four of the eight towns; the other four sat at the default `10,40` and happened to be clear. **All eight positions were tuned against the current bearings**, so one composition change invalidated every one of them at once: previewing `spokeSpread` buried 62 pieces of artwork across six towns — whole spokes, their destination lozenges, the lot — while `quality_metrics.js` reported the defect totals *falling* on five of the six, because it measures the map and the legend is not the map.

With the key on, the generator measures two occupancies of what it has already drawn and searches on a 1 mm grid (summed-area tables, so a candidate costs four reads rather than tens of thousands):

- **symbols** — every box the artwork has claimed: lozenges, the hub, ticks, badges. Covering one is **disqualifying**, not merely expensive. A symbol is a *place*; bury it and the reader loses a destination with nothing to say it was ever there.
- **route ink** — minimised among the clear positions, then nearest a frame corner, because a page device belongs at the edge of the sheet.

**Scoring the two as one weighted number is the mistake to avoid, and it was made here first.** Ranking by "least symbol area covered" parked High Wycombe's 92×80 mm legend squarely on **the hub** — the town the sheet is about — because that scored better than the three spokes it had been covering. Hence the hard constraint.

**When nothing qualifies, it does not move.** A legend that cannot be placed clear needs to be *smaller*, and shuffling an oversized box to a different bad spot costs the reader the one thing they had — knowing where the legend lives between versions. The run says so:

```
legend: no position on this sheet leaves a 92x81 mm legend clear of every symbol,
and where it sits covers 15.1% of them. Left where it is — shrink it with
legendWrap or legendAt.box, or make room.
```

**On today's board it is a no-op on seven towns and fixes one real defect nobody had seen**: St Ives' legend grazes a terminus lozenge by 0.6%, and the placer finds it clear ground at `188,43`. That agreement between the placer and the new `symbolsUnderLegend` metric, arrived at from opposite directions, is the reason to trust either.

`legendAt` still wins where it is clear, so a town that has hand-placed its legend keeps it.

**Adopted 2026-08-16 on all eight towns.** Board after the rollout: **261 defects across the 31 sheets and 0 buried under a legend**, with Huntingdon external the first sheet to come out `ok` rather than `warn`.

### Merging co-terminating spokes — `external[].routes` (plan §4.3)

Not an engine feature: `external[].routes: ["303","305"]` has always put several services on one spoke with stacked badges, and *which destinations are the same place* is a judgement about the real world. Ramsey is the clearest case there will ever be — **303 and 305 had identical `stops` arrays, the same destination and the same journey time**, differing only in days, and were drawn as two parallel spokes with two `Huntingdon` lozenges side by side. Merging them cost nothing (the day difference moved into `days`, which this sheet does not draw) and bought a lot: Ramsey external went **3 defects → 0**, gained `Old Hurst`, and the four village names now print once each on one spoke instead of being split across two by the 30 mm de-duplicator.

**When two spokes' `stops` arrays are equal, the merge is not a judgement at all — it is a de-duplication.** Check for that before anything else on a crowded spider.

### Blue-cyan belongs to the water (plan §5.2)

Colour on this sheet is supposed to mean **route** and nothing else — the argument that took the colour out of the POI symbols. The river is the one thing allowed to keep a hue anyway, because "the blue line is water" is not a convention a map can opt out of, so the route palette has to stay off it. **Three** towns had put a bus in the river's colour, all three `#66CCEE` against a `#9ec9e8` river at dE 14.6: **St Ives 9**, **Ramsey X31** and **March X32**.

`gen_internal.js` now says so at build time (`PALETTE WARNING route … is drawn in …, which is the colour of the …`) and stops there: which hue a route wears is a config decision, and a route's colour is meant to be stable across updates and across both sheets. **The test is close in Lab *and* close in hue, with near-neutrals excluded** — plain dE flags the `#BBBBBB` limited-service grey at 21.3 purely on lightness, and a grey line is not mistakable for a river.

Fixed in config the same day: St Ives 9 → `#009988` teal (worst separation from anything else on that sheet 14.6 → **39.1**), Ramsey X31 → `#332288` indigo (→ **49.3**), March X32 → `#004488` dark blue (→ **55.8**). Ramsey took indigo rather than teal because its X31 runs *beside* the green 303 for the length of Wood Lane, and teal's worst neighbour there was exactly that green.

**`node "%SK%\pick_route_colour.js" --town "<Town>" --route <key>` does the scoring**: it ranks candidate hues by their **worst** separation against every other colour on that sheet *plus* the drawn water, which is the rule that matters — not distance from the colour being replaced. Then render it, because "runs beside" is not in the numbers.

**How the third town was missed for an hour, which is the part worth remembering.** The sweep that found the first two read `routes.json` `features[]` — and **March has no `features[]`**: it draws its river through `gen_internal.js`'s legacy fallback from `river_geo.json`. The engine's own check reads the *built* feature list and so had been printing the warning on every March build since the check shipped; the scan script written to find the same thing had a hole the engine did not, and the scan was believed over the build output. **A warning is only worth adding if the build output is then read** — and a second implementation of a rule is a second chance to get it wrong. `pick_route_colour.js` carries the same fallback for the same reason.

### Moving a linear feature's label

`preview_design.js` and `adopt_config.js` both take `--feature-pos <key>=<x>,<y>` (page mm, repeatable). `features[]` is an array, so `--patch` / `--set` cannot reach `labelPos` — the same reason `--rail` exists.

Since 2026-08-15 both also take the general form, **`--set-path '<dotted.path>=<json>'`** (repeatable), where a numeric segment indexes an array — `--set-path 'internalDiagram.mapNotes.0.y=189'`, `--set-path 'features.1.style={"width":1.4}'`. It refuses to *create* a missing path, so a typo is an error rather than a new key nothing reads, and it is the same expression in both tools, so what you preview is what you commit. Reach for it instead of adding a fourth one-off flag.

**`drawFeatureLabel` refuses a label sited outside the map, on any of three edges, and reports it on stderr** — inside `coreBox`, right of the frame (it would land in the Services panel: Wisbech had two), and below the frame (it would be buried under the footer plate: Huntingdon, March, Ramsey and St Neots each had one, St Neots on both its sheets). A feature label is drawn *outside* the map's clip group, which is why `design.footerSafe` does not protect it. The footer edge is itself gated on `design.footerSafe` so the five place sheets stay byte-identical until Phase 8.

A per-sheet position for a town that has a diagram variant goes in `internalDiagram.features["<key>"].labelPos` — the geographic and diagram engines put the feature in quite different places, and one `labelPos` will not suit both (St Neots' "East Coast Main Line" needed 129,176 on the geographic sheet and 158,71 on the diagram).

### The north arrow places itself

Also engine-side, and not a key. The arrow is drawn at the very end of the file, so nothing used to know it was there — on High Wycombe it printed straight through route 130's terminus badge and across the railway. Under `labels.engine:"v2"` the engine now **finds it a blank corner** (Peter, 2026-08-15: *"it just needs any blank area"*), so no town needs a hand-pinned position any more and every one of them has had theirs removed.

The search runs in exactly one place it can: **between stamping the ink and solving the labels**. Any earlier and there is no ink to avoid; any later and the labels have taken the blank space. So the arrow gets first pick and the labels work around it, which is the right order — the arrow can go anywhere and a label cannot.

Three details worth knowing:

- **It uses a second, broader occupancy than the labeller's.** `LAB.ink` is deliberately narrow — route ribbons and dark features, the things a *label* must not sit on — and by that measure the River Great Ouse is empty space. The first cut of this parked St Neots' compass in the middle of the river. The arrow's grid counts anything drawn except the two pale road tiers, which cover the whole sheet and would leave nowhere at all.
- **A corner, not the middle.** Among the positions completely clear of ink and of every reserved box, the one nearest a frame corner wins — a compass belongs at the edge of a sheet.
- **A configured `{x,y}` is still honoured when it is clear**, and overruled with a note on stderr when it is not. `northArrow:false` still suppresses it, and an explicit `angle` is still required by the schematic and diagram pre-stages, whose coordinates are pre-rotated.

That search is now a shared helper, `spotSearch(boxOf, wantX, wantY, tol)` — the scale bar is its second caller, and anything else free-floating should be its third rather than a fourth inline loop.

### `design.sheetUrl` / `design.sheetQr` — the route back (benchmark item 2)

The footer used to end at `Map design © BusMaps.uk`. That is a **credit, not a route back**. The portal's whole promise is the monthly refresh, and a printed sheet is a snapshot of one month: the moment it goes on a noticeboard it had no way of telling anyone that a current version exists, and every sheet a council printed was silently a piece of marketing that named us and then gave the reader nowhere to go. The keys close that loop, and they satisfy the ODbL "reasonably calculated to inform" test more convincingly than a bare credit line does (see `uk_map_product_copyright_guide.md` §2).

`sheetUrl` alone prints one bold right-anchored line above the source notes; `sheetQr` draws a code at the bottom-right, its bottom edge on the same ink line as the last footer baseline, with the text column stopping clear of its quiet zone. **`sheetUrl` is still per-map — it is a string, and there is nothing to default it to — but `sheetQr` stopped being opt-in on 2026-08-24** and the two keys are no longer symmetrical. `footer.js` is unchanged in this respect: with no `url` its `qrBox()` still returns null and every number reduces to the arithmetic that was there before, so a sheet that names no address is byte-identical. What changed is that the four generators now hand it `{mm:14}` rather than nothing.

**The encoder is ours** (`assets/qr.js`, no dependencies, byte mode, versions 1–10, all four EC levels). A package would have to be vendored into the portal and kept in step across two repos for one algorithm whose output has to be byte-stable, against invariants 4 (no network at render time) and 5 (deterministic output). The mask is not fixed by fiat: all eight are scored with the standard penalty rules and the lowest wins.

Four things came out of building it that are worth keeping:

- **It scans off the printed artefact, which is the only test that counts.** The 300 dpi JPG decodes on all four sheet types, whole-page and cropped. Photographed at 1600 px across the A4 it still reads; at 1200 px it does not — so a whole-sheet photo works on any modern phone, and pointing the camera at the code (what people actually do) has far more margin.
- **Six modules of quiet zone, not the spec's four.** Of 78 realistic BusMaps URLs rendered at four, OpenCV could not *locate* one of them (Beaconsfield Waitrose at level Q) at any scale; at six it found all 78. The symbol was valid either way. A conformance test would have certified it and a phone would have refused it.
- **A module under 0.40 mm gets a warning on stderr**, naming both remedies (shorter URL, or a bigger `mm`). 16 mm of version 4 is 0.48 mm.
- **The cost is the footer plate, and it is mostly the text line, not the code.** On the internal sheet the plate top moves 193.6 → 185.7 mm; about 6 mm of that is the printed URL line and only 1.9 mm the code, so shrinking the QR buys almost nothing. `footerSafe` ends the map frame above the plate, so dense towns lose a few labels to it — High Wycombe 80 → 77, Beaconsfield 40 → 38, St Ives 41 → 38 — while sparse ones lose none (March 39 → 40, Ramsey and St Neots unchanged). `mapLabels` is a ratchet **floor**, so adopting this on a dense town will legitimately trip `quality_gate.js` and wants `--accept` in the same commit, per the standing rule.

### `design.howToUse` — how to read a spider (benchmark item 3)

TfL puts five plain bullets on every spider map, because a hub-and-spoke diagram is an unfamiliar **form** to most people and our external sheet is nothing but one. `Operators & services` and the Key both say what a mark *means*; neither says how to read the sheet.

The words come from the town's own data rather than a literal, per invariant 1: the hub sentence names whatever `externalHubLabel` says (whitespace-collapsed — it carries a newline for the hub box), the journey-time bullet appears only where the sheet actually has `minutesToDestination`, and the not-to-scale bullet only where `design.scaleBar:false` has switched off the footer's own sentence, so nothing is said twice. `bullets` and `heading` replace the lot.

Three findings from previewing all eight sheets, all of which changed the design:

- **Wide and short, not narrow and tall.** The first column width of 74 mm produced an 81 × 72 mm panel that nothing on St Ives' sheet could clear, so it sat on a terminus lozenge. 92 mm puts most bullets on one line and gives 99 × 49 mm. `buildLegend`'s note wrap learned exactly this on 2026-08-06: it is a page device's **height** that collides, because the spokes fan out horizontally.
- **An optional page device should decline rather than bury.** It reuses `legendSpot`, but not `legendPlace`'s rule for when nothing is clear. The legend stays put and warns, because a sheet with no legend is not a sheet. This panel is not drawn at all — the reader who loses Huntingdon's "St Neots" lozenge under it loses a destination with nothing to say it was ever there, and gains a paragraph telling them to look around the edge of the diagram for the thing that has just been covered up. Huntingdon's sheet did precisely that, first try. A fully-specified `at:{x,y}` is a decision and switches the search off, so a town can still force it.
- **The legend gets first pick**, because it is mandatory and this is not — so it is added to `ART` before the panel searches.

Previewed on all eight: **three towns draw it with zero added defects** (St Ives, March, Ramsey — St Ives' soft count in fact falls 8 → 6), and **five decline it** (Huntingdon, Wisbech, St Neots, Beaconsfield, High Wycombe), whose sheets are unchanged. That is the real finding of item 3, and it contradicts the plan's assumption: our external sheets do **not** all carry usable white space bottom-left. Making room on those five is a composition question — `spokeSpread`, a tighter legend — not a wording one.

## The fit set — `internalRoads.fitMaxOffPath`

Not a `design` key, and not opt-in: engine behaviour, because it is a correctness fix rather than a taste one.

Under `internalRoads` the map is fitted to the town's **core stops**, chosen by ATCO prefix so that out-of-town tails run off the frame edge instead of shrinking the town. But "which parish is this stop in" is not the same question as "does this map draw anything there": the route line comes from the matched road graph, and where the graph ends the line ends. A served stop beyond that end is in the fit and has no ink.

So a core stop further than `fitMaxOffPath` (default **1500 m**) from every drawn path is dropped from the fit, with a note on stderr. Set it to `0` to disable. If fewer than three stops would survive the filter it is ignored entirely — that means the road match is broken, and shrinking the fit to the survivors would hide it.

**The default is measured.** Worst core stop, distance to the nearest drawn line: Beaconsfield/Huntingdon/March/St Ives/St Neots/Wisbech **≤ 79 m**; High Wycombe **929 m**, which is correct — its corridor bundling and `coreBox` move lines away from stops on purpose, so do not "fix" that; Ramsey **2,701 m and up**, six stops on X31 out at Ramsey St Mary's. Nothing lies between 929 m and 2,701 m. Those six were stretching Ramsey's fit box from 75 mm wide to 141 mm: the town drawn 8 % smaller than it needed to be, pushed into the right two-thirds, with the whole left column of the frame holding no route ink at all.

## `design: { scaleBar: true }`

A scale bar on the geographic sheets, and the words **`Diagram — not to scale`** on the schematic, diagram and external ones. Both go through `spotSearch`, so they take a blank corner and the labels work around them; both are reserved before the labels solve.

**Read this before changing the bar, because measuring the projection moved the line between those two cases.** §4.6 of the plan assumed the geographic sheets were to a single scale. They are not. Every town runs the radial fisheye in `compress()`: true scale inside `internalRoads.focus.coreKm`, then `focus.comp` beyond it. Measured across all eight towns on 2026-08-15, `comp` is between **0.30 and 0.50** — the page scale steps by a factor of **2 to 3.3** at the core boundary, and Beaconsfield and St Neots carry a detail lens on top of that. An unqualified bar would be right in the middle of the sheet and wrong by 3× at the edges: the difference between a fifteen-minute walk and a forty-five-minute one, which is worse than no bar at all.

What rescues the device is that the core is not a small disc. Fitted to the frame it is **34–71 mm in radius on a 190 × 162 mm map**, so the true-scale zone covers most of the *page*, even though most of the *content* lies outside it. So the bar is sized from the core scale and captioned **`town centre scale`** whenever the town is actually fisheyed; a town with `comp >= 1` and no lens would get the bar with no caption, because then it really is one scale.

| | |
|---|---|
| distance | the largest of 50/100/200/250/500 m, 1/2/5 km whose bar is ≤ 32 mm and ≥ 14 mm. Today: 500 m on Beaconsfield, High Wycombe, March, Ramsey; 250 m on Huntingdon, St Ives, St Neots, Wisbech |
| scale | `sc / 111320` mm per metre — `sc` is page mm per unit of `planar()`, whose unit is one degree of latitude (isotropic, since `planar()` scales longitude by `cos(lat0)`) |
| position | `spotSearch`; `internalRoads.scaleBar:{x,y}` is honoured when clear |
| not-to-scale | `routes.json` `notToScale`, set by `schematize_internal.js` and `diagram_internal.js` on their **workspace** routes.json. Never set it by hand on a town |
| external sheets | a sentence appended to the second footer note, not a device — a radial spider can never carry a bar, and that sheet already keeps its caveats in the footer. **Keep it short**: a note long enough to wrap adds a line to the footer plate, which moves `FOOTER_PLATE_TOP` and refits every sheet derived from it |

**Why the pre-stages have to say `notToScale` rather than the engine working it out.** The schematic workspace sets `focus:{coreKm:1.1, comp:1}`, so as far as `gen_internal.js` can tell the projection is perfectly uniform — it would compute a confident, meaningless "500 m" from coordinates that were solved onto a tube-map grid and carry topology, not distance. The flag is inert without `design.scaleBar`.

**Needs `labels.engine:"v2"`** for the blank-space search, so the five place sheets ignore the key until Phase 8.

## `design: { routeCasing: true }` and `design: { cornerRadius: 2.0 }`

The tube-map line work (plan §3.1/§3.2). Both opt-in, both on all 8 towns.

**`routeCasing`** puts a white casing under every route line — `true` means 0.35 mm; `{mm, color}` to change it. It is drawn as **its own pass over the whole set**, before any colour. Per-route it does not work at all: the next route's casing erases the previous route's colour wherever they run close, which is most of a bundle. On a *geographic* sheet the grey road skeleton already separates a route from the page, so the casing's job there is at crossings and under the icons and interchange bars; on the *diagram and schematic* the skeleton is deliberately near-white and the casing is the only thing separating adjacent ribbons.

**`cornerRadius`** fillets any corner turning more than `cornerMinTurn` (default 30°) with a quadratic of that radius, **clamped to half of each adjacent segment**. `true` means 2.0 mm.

The clamp is the whole reason one key is safe on every model:

| | vertices turning < 2° | > 45° |
|---|---|---|
| diagram, schematic | 76–78 % | 6–9 % |
| geographic | 20–21 % | 15–16 % |

On a diagram the line is straight runs punctuated by deliberate corners, worth drawing as curves. On a geographic sheet turning is *continuous* because the line follows a real road — there is no corner to round, and the clamp reduces the fillet to almost nothing on 1.2 mm segments.

**What §3.2 got wrong, so nobody re-derives it:** it said the diagram engine "mixes sharp and rounded corners". It does not — every route path in every model is drawn with `stroke-linejoin="round"`. But that rounds a corner by only the stroke's own half-width, 0.85 mm on a 1.7 mm line, which at a 60–90° turn reads as a mitre.

**If you change the radius, re-check the stop ticks.** The fillet moves the *line* but not the ticks, so a tick at a corner could be left off its own route. At 2.0 mm the worst tick-to-line distance across all three models is 0.36 mm against a 0.85 mm half-stroke; a much larger radius would not be free.

## `design: { printSafe: 5 }` — the print check's key

Built 2026-08-16 as Phase 8 item 2b. **It is one key because it is one printing**: Peter printed two sheets borderless and unscaled, and everything below came out of that half-hour. None of it is visible on screen, and no measure on the board could see most of it, which is the reason it is grouped rather than split into six keys nobody would set together.

`5` is the margin in millimetres. **Absent ⇒ every sheet is byte-identical**, as with every other key here.

What it does, in the order it was found:

- **The footer comes inside the margin.** Every sheet ever built put its credit 3 mm from the right trim and its last baseline 4 mm from the bottom. Borderless printing over-scales by 2–3% — about 3 mm on A4 — so what survived was around 1 mm, and whether a given sheet looked right came down to feed tolerance. `footer.js` insets `x0`/`x1`/`bottomY`, **and subtracts the descender**, because a 5 mm margin is a claim about ink and the last line is "Valid from **J**ul**y**". Baseline-only insetting left it at 4.41 mm and the measure still warning.
- **The placer comes inside the margin too**, as four reserved page-edge strips. Fixing the footer alone would have left the worse half: six sheets had a map label tighter than the credit, worst 1.54 mm.
- **The panel is checked against the page.** High Wycombe sits its panel at `x=200` with two 49 mm columns — 298 mm on a 297 mm page — so its second column ran off the sheet, taking a badge with it. The existing row-fits-column warning could never see this: **the row did fit its column; the column did not fit the sheet.** The columns are narrowed to fit and it says so.
- **An over-wide subtitle wraps, and only then shrinks.** "A lane takes as many subtitle lines as it needs" was already this row's design. Shrinking is the fallback for what wrapping cannot help. Title and subtitle are measured **separately** — the first cut took the max of the two, computed a shrink ratio from the bold title's width and applied it to the subtitle, which both fails to fix the overflow and makes the type smaller for nothing.
- **A single-service corridor row stops repeating its own badge.** `internalDesc` titles carry the route number ("33  Totteridge–Desborough") because the ordinary panel is read row by row; in the corridor panel the badge is right beside the title, and the stacked rows — which use `corridorDesc` — never carry it. So the two kinds of row disagreed about what a title is. Dropping the prefix makes them agree, and took High Wycombe's widest title inside its column.
- **The scale bar stops naming what the sheet does not draw.** "town centre scale" is right on a fisheyed town and wrong on a `coreBox` one, where rung 2 deliberately replaces the centre with a labelled box and draws no roads inside it. Such a town gets "scale outside the town centre box".
- **A service badged in the panel with no line on the map says so.** The row's own subtitle gains "· not shown on this map" (`routes.json notShownNote` to change the words). The panel is the sheet's own index of itself, so a row with no line sends the reader hunting for something that is not there.

Two guards ship **ungated**, because they only write to stderr and change no bytes:

- **A feature label far from its own feature.** The three existing guards all refuse a label that lands somewhere it cannot be *read*; none asked whether it lands somewhere it *means* anything. Seven were stranded — Beaconsfield's `A355` 106 mm from the A355, Ramsey's "River Nene (Old Course)" 82 mm from the river **on the sheet whose write-up records it as having been moved onto the river it names**. It was moved out of the corner; nothing checked where it landed. 25 mm, matching `quality_metrics.js`'s `featureLabelMaxMm`, so the build and the gate agree.
- **A panel badge with no drawn line.** Checked from `TRIM[route]`, keyed by route. `quality_metrics.js` asks the same question from the SVG and can only ask it by *colour*, so it misses a route that shares a colour with one that is drawn — it reports Ramsey clean, and the build finds `301X`. **Read the build's stderr for the authoritative list.**

**Cost, measured across all eight towns before adoption:** defect total unchanged at 173, and **9 map labels net** — the footer moving 1 mm up costs that much map height. That is the trade: nine names against all 31 sheets clearing a 5 mm print margin, and High Wycombe's panel no longer running off the paper.

## `labels: { engine: "v2" }`

Hands every point label to `%SK%\labeller.js` — one placer shared by `gen_internal.js` (town internal, place internal, the schematic and diagram pre-stages) and `gen_external_radial.js`. It implies `design.reserveIcons`.

What it changes, in the order it matters:

1. **One occupancy grid.** 0.5 mm cells, fed from the SVG the generator has already emitted (`stampSvg`), so route ribbons, the river, the railway and everything else the sheet actually draws are visible to the placer. The old placers knew only about other text boxes — a label across a coloured ribbon was not a checker bug, the checker believed that space was empty.
2. **Real Arial advance widths** (`font_metrics.js`) instead of `text.length * size * 0.52`, which over-estimates a typical name by about 11% and so refuses space that would have fitted.
3. **Scored candidates, not first-fit.** Ink covered, hard obstacles, cartographic preference (E, W, NE, SE, NW, SW, N, S), distance from its own symbol, and distance to the nearest *other* symbol — the last term is what stops a name reading as if it belongs to the thing next door.
4. **A relaxation pass** (three sweeps). The greedy pass is order-dependent by construction; re-offering each label the whole candidate list with its own box lifted out lets an early bad choice be revisited. This is the step that makes a sheet look placed rather than merely legal.
5. **Two-line wrapping**, split at the space that leaves the halves most equal.
6. **Leader lines** before dropping — capped at `leaderMax` (11 mm), never crossing each other, never drawn through another label.
7. **`unplaced.json`** beside the render, listing anything it still could not fit. Before this, a dropped label left no trace in the SVG at all: the Phase 0 baseline could not measure silent drops, so every figure in it is a lower bound.
8. **Two-phase draw.** Symbols, badges, ticks, road names and the footer plate all claim their space before the first label is positioned, which retires the whole class of "a later thing painted over an earlier label" (St Ives printed `Waitrose` as `Wa▮▮se` under the library icon for months).

### `mustPlace`

Destination labels (`to <somewhere>`) are queued at priority 20 with `mustPlace`, which means: if no clean position exists, take the least-bad one rather than drop. A destination is the answer to the question the sheet exists to answer, and the old placer always printed one. Without this, High Wycombe lost five `to X` labels and St Ives lost `to Boxworth` — a trade of the most valuable text on the page for the least valuable clearance. The cost of an overlapping position is `wHard` (120), so it still prefers any clean spot that exists.

## Tuning

Every weight is in one `DEFAULTS` object at the top of `labeller.js`, so a change is a one-line diff. The two most likely to want moving:

- `wInk` (34) — how much a label minds sitting on a ribbon. Raise it and labels wander further from their symbols; lower it and they sit on the lines.
- `wAmbig` (9) — how much it minds being nearer someone else's symbol than its own.

`DBG_LABELS=1` on `gen_internal.js` prints every label's chosen position, whether it took a leader, and what stayed unplaced.

## Measuring

`node "%SK%\quality_metrics.js" --all [--detail|--json]` scores every `ci-reference` sheet. It is read-only and cannot break a gate. Thresholds live in one `T = {}` object; changing them invalidates the frozen baseline in `quality-baseline-scorecard_2026-08-15.md` and must be called out.

**It now measures what the legend is burying** — `symbolsUnderLegend` (a defect: lozenges, the hub, ticks, badges and names the legend is drawn on top of) and `routeLinesUnderLegend` (a warning: a stroke is still legible either side of the box). This is the one measure here that is about *furniture over artwork* rather than about the map, and it was added on 2026-08-16 after `spokeSpread` hid 62 pieces of artwork with every existing number improving. It moved the frozen baseline **266 → 267** (St Ives external, the 0.6% graze). The same fix corrected the legend detector, which required the box to sit in the top half of the page and so had never seen Beaconsfield's legend at all.

**The scorecard does not measure the panel.** Every metric is about the map: ink, collisions, symbols, the frame. `design.panelScale` moved every size and gap in the panel on all eight towns and the total stayed at 271 — that is the tool working as specified, not the change doing nothing. Panel work is judged by rendering the panel and looking at it. (`minTextMm` is the one panel-adjacent measure, and on `panelCols` towns it reports the auto-fitted **badge** text, so it did not move either.)

**And the other half of measuring is looking, so there is a tool for that too.** `node "%SK%\crop_compare.js" old.svg new.svg out-prefix --at 134,129 --size 40 --label "before|after"` cuts the SAME page region out of two sheets at 300 dpi and stacks them with captions — `--poi 3` instead of `--at` finds the three densest symbol clusters in the new sheet and crops those. Every design key in this file was settled by a crop like that, and twice the crop overruled the numbers. It also holds the one raster trap worth knowing: **never pass `{density:300}` to sharp for these SVGs**, because they already declare their 300 dpi pixel size and a density makes the page 14617 px wide, so a crop silently returns blank paper.

**A crop settles detail; it cannot settle proportion.** `node "%SK%\sheet_pair.js" old.svg new.svg out.png "before|after" [width-px]` stacks two WHOLE sheets, captioned, at page scale. Reach for it whenever a change touches something drawn everywhere — line weight, casing, a palette shift — because the question then is not "does this label clear that line" but "how much of the sheet has this taken over", and a 40 mm crop has no page in it. It was written on 2026-08-17 after the frequency-tier dashed "limited" style looked fine in every crop and was obviously wrong at page scale: 40% of a market town's lanes are limited, so dashing them made Ramsey — which has no frequent lane to anchor it — read as a town whose buses are provisional. The defect numbers moved by one or two either way and said nothing at all.

`node "%SK%\labeller_demo.js" <outdir>` draws a synthetic test page twice — once with the old first-fit placer, once with `labeller.js` — for judging a placer change without moving a real sheet.

## The quality ratchet — `quality_gate.js`, and why it is not a threshold

`node "%SK%\quality_gate.js"` scores every `ci-reference` sheet and compares it with `Development Docs\quality-ledger.json`, which records what each sheet measured when it was last accepted. It exits 1 on any regression, and `status.js` runs it — so every town and place now carries a **Quality** column beside its byte-gate column, and a `REGRESSED` row fails the board. `--accept` re-records the ledger; `--json` for machine use; `status.js --no-quality` skips it.

**Three numbers are gated, and the third is the one that matters.**

| gated as | number | why |
|---|---|---|
| ceiling | `HARD` | the defects where a reader loses something |
| ceiling | `drop` | labels the placer reported dropping, per sheet |
| **floor** | `mapLabels` | **a sheet may not quietly print less** |

`SOFT`, `DEF` and `ALL` are reported and not gated. `DEF` and `ALL` are deliberately excluded until G5 decides which is the headline — gating a number whose definition is under review would settle that question by accident.

**The label FLOOR is the whole point.** Every other measure counts something wrong that is *on* the page, so a placer that drops a label to avoid a collision scores better for dropping it. That is not hypothetical: 94 dropped labels board-wide went uncounted for four sessions while this plan prepared to gate on the total. `drop` closes most of the hole and the floor closes the rest, because a config change can remove a POI outright without the placer ever reporting a drop.

**Why a ledger rather than "gate HARD at 0".** Zero is the destination. The board carries 139 HARD defects, most of them on sheets whose density is an *approved* outcome of the complexity triage, so a flat zero would fail all 31 sheets on day one and be switched off within the hour. The ledger asks the question §6.1 actually asked — can quality get quietly worse — and the answer is no. It also solves the drop allowance for free: High Wycombe sheds 40% of its label candidates because rungs 2 and 2b say a RED town should, and a flat rate ceiling would either fail it or excuse everyone else. Its own recorded figure is the only honest allowance.

**A ceiling with no target has a direction only by accident, so since 2026-08-25 the ledger carries one.** `quality-ledger.json` has a `targets` block — dated milestones for the **board-wide** totals plus a baseline taken the day they were written — and both `quality_gate.js` and `status.js` print a *Distance to target* line under the totals: how far there is to go, how many days are left, the weekly rate that now implies, and how much the board has moved since the baseline. It exists because non-regression alone could not describe what actually happened between 19 and 25 August: the board grew 39 → 52 sheets, every per-sheet number improved, and the accepted total **rose**, 130 → 137 HARD, with the dropped-label figure not moving by a single label. Both readings were true and the file could state neither.

**A target is REPORTED, never gated.** The exit code still depends on regression alone. A check that is red on the day it is written gets muted inside a week, and 137 → 0 is a quarter's work — gating it would redden every run until January and teach everyone to skip the section. `--accept` carries the block forward, which matters more than it sounds: `--accept` runs after a change that *improved* things, so a rebuild-from-scratch would delete the target on the very run that moved towards it.

**And the report says how many sheets could not supply the number — which since 2026-08-27 is none of them.** It used to say `31 of 52 sheets could not count it` beside the drop total, and that line was reporting a bug in `quality_metrics.js` as a gap in the generators. Every generator that can drop a label writes a sidecar beside the sheet and **deletes it when it dropped nothing**, so an absent file means zero; the reader applied that idiom to `internal.svg` and turned exactly the same absence into `null` for `external.svg`. Fourteen external sheets had counted themselves clean and were being recorded as uncountable. The other seventeen were the real gap and each a different one: `schematize_internal.js` and `diagram_internal.js` run `gen_internal.js` in a workspace **subfolder** and copied only the SVG back out, stranding 165 dropped labels where `sync_ci_reference.js` (which skips directories) could never reach them; and `gen_boarding.js`, which has its own hand-rolled occupancy placer rather than `labeller.js`, wrote no file at all and counted only one of its two ways of losing a landmark — 20 lost across the four boarding sheets, of which its own log reported 6. **The honest board is 287 dropped labels and 320 HARD, not 108 and 137.** Summing an unknown as a zero would let a board that measures **less** report itself closer to target, which is the same trap the label floor exists to close, so `null` still means unknown and is still counted separately — it now distinguishes `no-reporter` (a sheet type nothing writes a sidecar for) from `unreadable` (a sidecar that was there and would not parse), because filing a parse failure under a coverage gap is how it would be read as "that sheet type again" and never chased.

**Lowering a ceiling is a commit.** After a change that improves things, `--accept` writes the new figures and the diff on `quality-ledger.json` is the record of what improved. Do it in the same commit as the rollout, never separately, or the ledger stops describing the shipped sheets.

## The PLACE external — the same keys, a different generator (plan Phase 8 item 3b)

Everything above is written about the town sheets, and until 2026-08-16 that is exactly where it stopped. The five place *internal* sheets share `gen_internal.js`, so they inherit these keys the moment a place adopts one. The five place *externals* do not: they are drawn by the place skill's own `gen_external_places.js` — an **aggregated** radial, where a spoke is a reachable DESTINATION and the badges on it are the buses that get you there — and that file referenced **no design key whatsoever**. Re-vendoring the engine could never have lifted them; porting was the only route. They were worth the port: 29 of the places' 52 defects, and the worst rates on the board.

**Ported, with identical names and semantics** so a place and a town mean the same thing by the same key: `printSafe`, `badgeFit`, `hubFit`, `legendPlace`, `spokeSpread`, `scaleBar` (the footer sentence — an aggregated radial can no more carry a bar than a town radial can), and `labels.engine:"v2"` with its `dedupeStopsMm`. Absent config is byte-identical on all five sheets, and each key was proved to exercise only its own branch by building the five with that key alone.

**What the measurement said, before and after.** Every defect on all five sheets was one shape: a stop served by several spokes labelled once per spoke, at a flat 5.2 mm perpendicular offset with no collision detection at all. Simpson Centre printed "Butlers Court Road" three times, Waitrose "St Mary's School" three times, Aldi "The King George V PH" three times, each copy then over route ink with two of them overlapping. **29 → 8 defects, HARD 11 → 0, duplicates and label collisions to zero, no label unplaced on any sheet**, and the only count change is the four duplicate copies the dedupe merged.

**Three things worth carrying forward:**

- **`badgeFit` is byte-identical on all five places even when it is ON**, because no route key on any of them overflows its badge today. It is ported as protection, not as a fix: a place draws its TOWN's route keys, so a place derived from Ramsey (`301S`) or High Wycombe (`WW1`) overflows the day it is built. A flat number here is the key being inert, not absent.
- **`legendPlace` does not earn adoption on the places, and the numbers say so.** This generator already had a legend search of its own, and scored against the same occupancy it puts every sheet at **0% symbols and ≤0.1% route ink**. Keep the key OFF. Keep it in the engine, because the legacy search's obstacle set omits the spoke badge rows entirely and it stops at the first zero-crossing candidate on a coarse 10×6 mm grid — it is clear today because nothing has moved. Re-score it after any composition change.
- **`hubFit` SHRINKS a place hub rather than correcting an overflow.** The legacy width uses `measureText`, a deliberately generous 0.58 em/char estimate written to size a legend panel that must never clip itself; as a box width it leaves **5.00–8.47 mm a side**. Nothing overflowed, so this is map room spent on air — and spent twice, because `HUB_W` feeds `HUB_A` and therefore where every spoke starts. The 26 mm floor stays: "Aldi" is sized by the floor and does not move.

**The one real trap, and it is the same one twice in two sessions.** `printSafe`'s first cut clamped the destination lozenge to `H - PSAFE` — the paper. The bottom edge that matters is **the footer plate**, which is opaque and drawn last, so a box can clear 5 mm of trim and still have its bottom sliced off. Measured on the shipped sheets, **High Wycombe Aldi already had four lozenges reaching 4.74 mm under the plate** and no measure on the board reports it: `textUnderFooter` looks for TEXT, and a lozenge's text sits above its own box bottom, so a buried box with a visible name scores clean. Worse, the `scaleBar` sentence lengthens the footer note and lifts the plate top 1.6 mm, which buried a lozenge on the four sheets that were clear. **Adding ink to fix a margin defect creating a margin defect, again.** The key now clamps to whichever bound is higher up the page, which fixes Aldi's four as well; and the footer notes are therefore built at the TOP of the file, before a spoke is laid out, because the plate top is an input to the artwork and not an afterthought.

## Changing any of this

Never on one town. Every judgement in this document was made by rebuilding all eight and looking at the table:

```bash
node "C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/preview_design.js" --all --patch '{"design":{"iconInk":"charcoal"}}'
```

`preview_design.js` builds every sheet from the latest committed S4 data with a `routes.json` patch applied, measures before and after, and reports which label strings were gained and lost — writing nothing under `Areas/`. `--render` for JPGs, `--keep` to leave the workspace so a generator can be re-run by hand with `DBG_LABELS=1`. When the numbers look right, `adopt_config.js` commits the patch as a new S3 per town and `rollout.js --force` renders it; the full sequence, and the reason `--force` is not optional, is in [changing-the-engine.md](changing-the-engine.md) §2b.

**One caution, learned the expensive way.** More candidate positions is not obviously better. A third leader ring at 3.9× the nominal gap was added on the theory that more reach means more placements; High Wycombe lost five more names, because the extra reach let low-priority labels claim distant space that higher-value ones then could not use. Any weight or candidate change gets measured across all eight towns, never on the one sheet that motivated it.

## Badge overprints, and how to find which pass drew one

`quality_metrics.js` counts two things no measure could express before 2026-08-28: `labelsOverBadge`, a map label printed over a route badge, and `badgeOverBadge`, a badge printed on another badge. Both are **reported and not scored** — they sit in `warns`, they have their own metrics, and they are deliberately absent from `defects`, `hard` and `soft`, because folding them into `hard` before the population is clear would redden every affected sheet on its first run and the check would be muted within the week. Both are `null` rather than `0` on a sheet whose `routes.json` will not parse, because the route palette is the whole discriminator between a badge and a stop tick and “could not tell” must not read as “clean”.

**The badge RADIUS is the attribution, and it saves reading the generator.** Every pass draws at its own size, so the two radii in an overprint say which pass produced it:

| Radius | Which pass drew it |
|---|---|
| **2.4 mm** | the sprinkled badges along a visible line, and the `corridorPalette`/`internalCorridors` guaranteed-badge fallback |
| **2.6 mm** | `drawTermBadges()` — a route that simply ENDS in town |
| **3.0 mm** | the frame-cut terminus rows, where a tail leaves the page |
| **3.4 / 4.0 mm** | the place and area external sheets |

`--detail` prints the half-height of both marks beside each overprint, so `node assets/quality_metrics.js <sheet.svg> --detail` names the responsible pass directly. Run it from this skill's own folder; `<sheet.svg>` is the only placeholder and any committed `ci-reference` sheet will do. Tallying the board this way on 2026-08-28 said that 34 of 57 known overprints involved a 2.6, which is what turned OA-023 from a suspicion into a sized job.

**Test a badge as a BOX, never as a circle**, and take the tolerance from `quality_metrics.js`'s `T.badgeOverlapMm` (0.6 mm) so the generator and the metric cannot disagree about what an overlap is. A radial test is wrong in both directions: under `design.badgeFit` a wide key is a stadium far wider than it is tall, so `hypot < max(rx, ry)` reports tidy neighbours as overprints; and two 2.6 mm discs at dx=5.0, dy=5.0 are 7.07 mm apart yet overlap on both axes, so a radial threshold misses them. A STACK is a box too — its half-height is its member count times the pitch — and a register of bare centres cannot answer the question at all.

**A board-wide figure is only as good as the walk that produced it.** There are three place layouts, and a sweep that searches `Areas/` alone silently omits the three maps under `Places/_standalone/`. `quality_metrics.js`'s own `findSheets()` did exactly that until 2026-08-28, so every board total it had ever printed was taken over 46 sheets when the board has 52; the corrected baseline was 70 badge overprints, not 57. `test/find_sheets.test.js` now pins the invariant that its walk and `quality_gate.js`'s **agree**. If you add a third walk, add it to that test.
