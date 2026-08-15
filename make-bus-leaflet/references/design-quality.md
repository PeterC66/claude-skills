# Design quality — the `design` and `labels` keys, and the placer behind them

What to read when a sheet looks amateur rather than wrong: labels sitting across route ribbons, symbols fused into blobs, names printed and then erased by the footer band. `%SK%` = the skill's `assets` folder. The plan this implements, with its measured before/after, is `…\Buses\Development Docs\label-and-design-quality-plan_2026-08-15.md`.

## The short version

Three `routes.json` keys, all opt-in, all defaulting to the pre-2026-08-15 behaviour:

```json
"design": { "footerSafe": true, "spreadIcons": true, "iconInk": "charcoal" },
"labels": { "engine": "v2" }
```

Every built town carries all three as of 2026-08-15. Places do not yet — they are held to the portal re-vendor (see `changing-the-engine.md` §4).

Measured over the 31 shipped sheets, before → after: **628 → 270 defects** (`node "%SK%\quality_metrics.js" --all`). Content buried under the footer band: 12 sheets → 0. Fused icon pairs: 110 → 1. Labels printed over a symbol that is not their own: 190 → 81 (the remainder is all place sheets, still on v1).

## `design`

| Key | Default | What it does |
|---|---|---|
| `footerSafe` | off | Ends the map frame just above the footer's backing plate instead of at a flat `y=205`. The plate starts at 195.16 mm and is painted last, so a 9.84 mm strip of every sheet used to be drawn and then covered — 12 of 31 sheets had real route ink in it and 9 had erased *text*. The fit is derived from the frame, so the map refits into the space that is actually visible; expect the whole map to shrink by about 6% vertically. |
| `footerGap` | `3.0` | mm of clear air between frame and plate. Not smaller without checking: the terminus exit **arrows** are drawn outside the map's clip group and point 2.6 mm past the frame, so a 1 mm gap leaves their tips under the plate and the ink measure barely moves. |
| `spreadIcons` | off | Pushes POI symbols apart until they are `iconMinSep` apart, capped at `spreadMax` mm from the true position. Hand-placed POIs (`overrides` `pos`/`move`) are pinned and never moved. |
| `iconMinSep` | `3.2` | mm centre-to-centre below which two 4.2 mm symbols read as one blob. |
| `spreadMax` | `2.6` | mm a symbol may be displaced. Displace, don't drop — but not so far that it stops being where the thing is. |
| `dedupeStopsMm` | `30` | External sheets only: two spokes calling at the same village label it once, not twice. |
| `iconInk` | off | `"charcoal"` recolours every POI symbol to one neutral, keeping red for the GP cross, so **colour on the sheet means route and nothing else** (G3, Peter, 2026-08-15). Implemented in `icons.js` as a post-pass over the existing drawings, chosen over a redrawn outline set because at 4.2 mm a 0.5 mm outline goes noticeably faint against a ribbon while these solid glyphs hold their weight. Two things it is careful about: a pale fill is a backing plate, not a mark, so it goes white rather than black (the allotments bed); and a symbol that was *already* a neutral grey was drawn light on purpose, so it keeps its tone rather than flattening to charcoal — the industrial estate is context, and a cluster of factories at full charcoal was the heaviest ink on the High Wycombe sheet. |

### The north arrow places itself

Also engine-side, and not a key. The arrow is drawn at the very end of the file, so nothing used to know it was there — on High Wycombe it printed straight through route 130's terminus badge and across the railway. Under `labels.engine:"v2"` the engine now **finds it a blank corner** (Peter, 2026-08-15: *"it just needs any blank area"*), so no town needs a hand-pinned position any more and every one of them has had theirs removed.

The search runs in exactly one place it can: **between stamping the ink and solving the labels**. Any earlier and there is no ink to avoid; any later and the labels have taken the blank space. So the arrow gets first pick and the labels work around it, which is the right order — the arrow can go anywhere and a label cannot.

Three details worth knowing:

- **It uses a second, broader occupancy than the labeller's.** `LAB.ink` is deliberately narrow — route ribbons and dark features, the things a *label* must not sit on — and by that measure the River Great Ouse is empty space. The first cut of this parked St Neots' compass in the middle of the river. The arrow's grid counts anything drawn except the two pale road tiers, which cover the whole sheet and would leave nowhere at all.
- **A corner, not the middle.** Among the positions completely clear of ink and of every reserved box, the one nearest a frame corner wins — a compass belongs at the edge of a sheet.
- **A configured `{x,y}` is still honoured when it is clear**, and overruled with a note on stderr when it is not. `northArrow:false` still suppresses it, and an explicit `angle` is still required by the schematic and diagram pre-stages, whose coordinates are pre-rotated.

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

`node "%SK%\labeller_demo.js" <outdir>` draws a synthetic test page twice — once with the old first-fit placer, once with `labeller.js` — for judging a placer change without moving a real sheet.
