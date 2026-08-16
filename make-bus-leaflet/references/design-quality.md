# Design quality — the `design` and `labels` keys, and the placer behind them

What to read when a sheet looks amateur rather than wrong: labels sitting across route ribbons, symbols fused into blobs, names printed and then erased by the footer band. `%SK%` = the skill's `assets` folder. The plan this implements, with its measured before/after, is `…\Buses\Development Docs\label-and-design-quality-plan_2026-08-15.md`.

## The short version

`routes.json` keys, all opt-in, all defaulting to the pre-2026-08-15 behaviour:

```json
"design": { "footerSafe": true, "spreadIcons": true, "iconInk": "charcoal", "panelScale": true,
            "scaleBar": true, "routeCasing": true, "cornerRadius": 2.0, "badgeFit": true },
"labels": { "engine": "v2" }
```

Every built town carries all of these as of 2026-08-16 (`badgeFit` adopted and rolled out that day). Places do not — they are held to the portal re-vendor (see `changing-the-engine.md` §4).

Measured over the 31 shipped sheets, before → after: **628 → 270 defects** (`node "%SK%\quality_metrics.js" --all`). Fused icon pairs: 110 → 1. Labels printed over a symbol that is not their own: 190 → 82 (the remainder is all place sheets, still on v1). Content buried under the footer band: 12 sheets → 1, and that last one is a place sheet — but note the baseline moved from 271 to 276 when `textUnderFooter` was found to be counting only text *straddling* the plate's edge, so "12 → 0" as this file used to claim was never true. Three of the design keys add ink of their own (a scale bar, its caption, a not-to-scale note, a white casing), so the total is not monotonic and should not be read as one.

**Not every key is judged by that number.** `panelScale`, `scaleBar`, `routeCasing` and `cornerRadius` all moved the artwork and moved the defect count by 0 or +1, because every metric in `quality_metrics.js` is about *labels and ink on the map* — none of them looks at the panel, at line separation, or at corner geometry. Render those and look.

## `design`

| Key | Default | What it does |
|---|---|---|
| `footerSafe` | off | Ends the map frame just above the footer's backing plate instead of at a flat `y=205`. The plate starts at 195.16 mm and is painted last, so a 9.84 mm strip of every sheet used to be drawn and then covered — 12 of 31 sheets had real route ink in it and 9 had erased *text*. The fit is derived from the frame, so the map refits into the space that is actually visible; expect the whole map to shrink by about 6% vertically. |
| `footerGap` | `3.0` | mm of clear air between frame and plate. Not smaller without checking: the terminus exit **arrows** are drawn outside the map's clip group and point 2.6 mm past the frame, so a 1 mm gap leaves their tips under the plate and the ink measure barely moves. |
| `spreadIcons` | off | Pushes POI symbols apart until they are `iconMinSep` apart, capped at `spreadMax` mm from the true position. Hand-placed POIs (`overrides` `pos`/`move`) are pinned and never moved. |
| `iconMinSep` | `3.2` | mm centre-to-centre below which two 4.2 mm symbols read as one blob. |
| `spreadMax` | `2.6` | mm a symbol may be displaced. Displace, don't drop — but not so far that it stops being where the thing is. |
| `dedupeStopsMm` | `30` | External sheets only: two spokes calling at the same village label it once, not twice. |
| `panelScale` | off | One type scale and one heading rhythm for the Services/Key panel. Section below. |
| `badgeFit` | off | Draws a route badge as a **stadium** instead of a disc when its number is wider than the disc. Section below. |
| `iconInk` | off | `"charcoal"` recolours every POI symbol to one neutral, keeping red for the GP cross, so **colour on the sheet means route and nothing else** (G3, Peter, 2026-08-15). Implemented in `icons.js` as a post-pass over the existing drawings, chosen over a redrawn outline set because at 4.2 mm a 0.5 mm outline goes noticeably faint against a ribbon while these solid glyphs hold their weight. Two things it is careful about: a pale fill is a backing plate, not a mark, so it goes white rather than black (the allotments bed); and a symbol that was *already* a neutral grey was drawn light on purpose, so it keeps its tone rather than flattening to charcoal — the industrial estate is context, and a cluster of factories at full charcoal was the heaviest ink on the High Wycombe sheet. |

### `design.badgeFit` — a route number that does not fit its disc

`badge()` draws its text at font-size = the badge **radius**, which is right for one to three narrow characters and wrong for anything wider. The text simply overflowed, on all three badge sizes and on both sheets, so the number read as sitting *on* the roundel rather than in it. Found 2026-08-15 on Ramsey, whose enlarged map made it obvious; it is pre-existing and affects **four of the eight towns** — High Wycombe (`M40` `WW1` `LGW` `LHR` `OXF`), Ramsey (`301S` `301V` `301X`), St Ives (`VL14`), March (`ZIP2`). Beaconsfield, Huntingdon, St Neots and Wisbech have no wide key, and their sheets do not move.

**It is a width problem, not a length one** — which is the whole reason the fix measures with `font_metrics.js` rather than counting characters. High Wycombe's three-letter codes are *worse* than Ramsey's four-character keys:

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
- `panelScale: panelCols row Nmm cannot carry the type scale …` — **High Wycombe fires this and has not been fixed.** Its 22 services in two columns at a 4.9 mm pitch need 5.9 mm. **Do not reach for a third column or smaller type.** High Wycombe is the one triaged town: its map bundles those 22 services into **14 drawn lanes** via `internalCorridors` and colours them as **11 corridors** via `corridorPalette` (rungs 1 and 3, see [complexity-triage.md](complexity-triage.md)), and the panel is the only part of the sheet that ignores it. Fourteen corridor rows with badge stacks fit at the standard pitch; 22 individual rows never will. Tracked as `panelCorridors` in Phase 7 of the plan.

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

**The scorecard does not measure the panel.** Every metric is about the map: ink, collisions, symbols, the frame. `design.panelScale` moved every size and gap in the panel on all eight towns and the total stayed at 271 — that is the tool working as specified, not the change doing nothing. Panel work is judged by rendering the panel and looking at it. (`minTextMm` is the one panel-adjacent measure, and on `panelCols` towns it reports the auto-fitted **badge** text, so it did not move either.)

`node "%SK%\labeller_demo.js" <outdir>` draws a synthetic test page twice — once with the old first-fit placer, once with `labeller.js` — for judging a placer change without moving a real sheet.

## Changing any of this

Never on one town. Every judgement in this document was made by rebuilding all eight and looking at the table:

```bash
node "C:/u3a St Ives/.claude/skills/make-bus-leaflet/assets/preview_design.js" --all --patch '{"design":{"iconInk":"charcoal"}}'
```

`preview_design.js` builds every sheet from the latest committed S4 data with a `routes.json` patch applied, measures before and after, and reports which label strings were gained and lost — writing nothing under `Areas/`. `--render` for JPGs, `--keep` to leave the workspace so a generator can be re-run by hand with `DBG_LABELS=1`. When the numbers look right, `adopt_config.js` commits the patch as a new S3 per town and `rollout.js --force` renders it; the full sequence, and the reason `--force` is not optional, is in [changing-the-engine.md](changing-the-engine.md) §2b.

**One caution, learned the expensive way.** More candidate positions is not obviously better. A third leader ring at 3.9× the nominal gap was added on the theory that more reach means more placements; High Wycombe lost five more names, because the extra reach let low-priority labels claim distant space that higher-value ones then could not use. Any weight or candidate change gets measured across all eight towns, never on the one sheet that motivated it.
