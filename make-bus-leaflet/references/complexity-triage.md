# Complexity triage — deciding whether a town can be drawn at all

Run at the **end of S2**, before anything is styled. Answers the question the pipeline never used to ask: *should we be drawing this town, on one sheet, the standard way?*

```
cd <S2 run dir>
node "%SK%\complexity_score.js"
```

Writes `complexity.json` into the run dir and prints a verdict plus a remedy ladder. **Exit 0** = GREEN or AMBER, **exit 2** = RED (suppress with `--no-fail`), exit 1 = could not score.

## Why this exists

High Wycombe (2026-07-28) passed every existing gate — S1 verified 46 services, S2 matched 31 routes to roads with 2 fallbacks, S6 passed — and produced an unusable internal map. The engine did exactly what it was told. Nothing measured whether it *should* have been told to.

The full analysis, the research behind it and the strategy ladder are in `…\Buses\Development Docs\town-complexity-triage-plan_2026-07-28.md`.

## The five metrics

| | Metric | Definition | Why |
|---|---|---|---|
| **R** | drawn lines | lines the internal map will draw (after any bundling) | **the dominant term.** The colour-blind-safe palettes hold ~12 usable hues. Past ~12 the palette repeats and colour stops identifying a route — High Wycombe shipped 12 colours for 31 routes, each reused 2–3× |
| **S** | drawn stops | distinct stops in `routes_intown_atco.json` | label load — ticks and names fighting for the same square centimetre |
| **K5** | congested km² | area of ~111 m cells carrying ≥5 distinct routes | how much of the sheet is illegible |
| **D5** | congestion extent | diagonal of the **largest connected** cluster of those cells | tells a knot from a trunk — see below |
| **P** | POIs selected | points of interest reaching the internal sheet, from `poi_select.js` under the town's own `poi` block | page area claimed before a route line exists — added 2026-08-31, see below |

**P was added because the other four are all about ROUTES, and the variable that was actually breaking the estate's hardest map is not a route variable (2026-08-31, OA-202).** High Wycombe selects 171 POIs against St Ives' 34; its three internal sheets carry 150 of the estate's 206 dropped labels; 98% of every dropped label anywhere on the estate is a POI, and 100% of the numbered place index is. This gate scored that town **GREEN**. An instrument that decides whether a town can be drawn at this size has to be able to see the thing that is breaking the hardest map it has, or the next town is assessed by the same blindness.

Every POI costs page area whether or not it is ever named: `poiMark()` draws the symbol unconditionally and only the *name* is conditional, so each one reserves a 4.2 × 4.2 mm box and a placer anchor before anything else is drawn. The reported `poiFramePct` is that reservation against the 190 × 155.1 mm map frame — 171 symbols claim about a tenth of it, on OpenStreetMap's opinion of what matters. It is a linear function of P because **the frame is the same size for every town**, which is the point: a big town does not get a bigger sheet.

**P is the SELECTED count**, taken before `poiSite()`'s off-frame and `coreBox` exclusions, so it is an upper bound on what a sheet draws. That is the right quantity for a triage gate — the lever the remedy reaches for is fewer INPUTS — but it is not the drawn count and must not be quoted as one. **An absent `osm.json` reports `-`, not `0`**, and is banded on by nothing: a gate that cannot see its subject has to say so rather than score a silent zero and call the town green.

**D5 is the one that changes the remedy.** A compact knot (D5 < 1 km) is what a fisheye `lenses[]` was built for. A trunk corridor (D5 > 3 km) cannot be fixed by a lens at any strength — High Wycombe's congestion is a single 77-cell connected network spanning 6.2 km along the Wycombe valley, where 6–19 services share the same tarmac for kilometres.

## The bands

Any one metric trips the band — deliberately not a blended index, because *which* metric fails determines which remedy to reach for.

| Band | Condition | What to do |
|---|---|---|
| **GREEN** | R ≤ 12 · S ≤ 120 · K5 ≤ 0.50 · D5 ≤ 1.6 · P ≤ 42 | build normally |
| **AMBER** | any one over the green line | apply the ladder, note it in the S2 commit, **continue without pausing** |
| **RED** | R > 18 · S > 200 · K5 > 0.80 · D5 > 3.5 · P > 110 | **stop.** Choose a strategy before building |

**P's two thresholds are sited in the GAPS between real maps, not butted against one.** The eleven maps carrying an internal sheet select, in order: 171, 64, 52, 51, 34, 29, 29, 28, 22, 7, 7. Amber at 42 sits between 34 and 51, clear of both by eight and nine; red at 110 sits in the 64-to-171 chasm, clear by 46 and 61. A threshold a real map sits exactly on is one that flips on noise. That puts **four maps at amber or worse and one at red**, which is the shape a useful threshold has — a band with exactly one member has never had to be right about a second, and is usually wrong about the first the moment a second arrives.

**Only RED pauses.** If AMBER ever starts interrupting an ordinary town the gate will be ignored, which defeats it — the skill's "work autonomously, do not interview the user" rule still holds.

### Calibration (every town built to 2026-07-28)

| Town | R | S | K5 | D5 | Band |
|---|---|---|---|---|---|
| St Ives | 8 | 69 | 0.04 | 0.11 | GREEN |
| March | 7 | 70 | 0.27 | 1.35 | GREEN |
| Huntingdon | 10 | 74 | 0.09 | 0.47 | GREEN |
| Wisbech | 11 | 53 | 0.22 | 1.30 | GREEN |
| St Neots | 9 | 94 | 0.15 | 0.46 | GREEN |
| Beaconsfield | 7 | 49 | 0.54 | 1.34 | **AMBER** (K5) |
| High Wycombe v1.0 | 31 | 320 | 1.21 | 6.18 | **RED** (all four) |
| **High Wycombe v2.1** (ladder applied) | **11** | **91** | **0** | **0** | **GREEN** |

### What P changed, measured 2026-08-31 on every committed map

| Town | P | frame % | Band before P | Band with P |
|---|---|---|---|---|
| High Wycombe | 171 | 10.2% | GREEN | **RED** (P) |
| Huntingdon | 64 | 3.8% | GREEN | **AMBER** (P) |
| Wisbech | 52 | 3.1% | RED (D5) | RED (D5, P) |
| St Neots | 51 | 3.1% | GREEN | **AMBER** (P) |
| St Ives | 34 | 2.0% | GREEN | GREEN |
| Beaconsfield | 29 | 1.7% | AMBER (K5) | AMBER (K5) |
| Ramsey | 29 | 1.7% | GREEN | GREEN |
| March | 22 | 1.3% | GREEN | GREEN |

Three towns changed band and one of them changed to red — which is the falsification this metric needed. A new term that reddened nobody would have proved only that it was inert, and one that reddened everybody would have been muted inside a week.

**The ladder was walked end to end on High Wycombe on 2026-07-28** (rungs 0 → 1 → 2 → 2b → 3, all config) and the town came out **GREEN**, inside the envelope of the six accepted towns. Measured at each rung on the real geometry: rung 0 (drop the 9 sub-cliff services) 31→22 lines; rung 1 (three confirmed families) →14 lanes; rung 2 (600 m core box) K5/D5 →0; rung 2b →91 stops; rung 3 (11 corridor hues) R→11. **No split, no decline** — §1.3's prediction held. What it cost: three `gen_internal.js` fixes the rungs exposed (`coreBox.minRun`, the terminus-row frame clamp, `internalTitleColor`) and about two hours of config, most of it the palette re-assignment, exactly as P3 predicted.

Beaconsfield reading amber is a **true positive**, not a mis-set threshold: its A40/Pyebush corridor is genuinely its most cluttered feature and it already carries a hand-added fisheye lens. Amber means "apply a remedy", which is what happened. The gate suggests bundling 104/105, which takes it green.

**Re-calibrate as towns are added.** Each town's `complexity.json` makes that a data exercise.

## The remedy ladder

**Rung 2c is not like the others, and that is deliberate.** Rungs 0, 1, 2 and 2b are all things this project can do to a town on its own — curate the service list, bundle co-running lines, suppress the core, thin the stops — so each one is re-scored on the real geometry and prints a predicted band. Rung 2c is *ask somebody who lives there which points of interest matter*, and its `after` is **null on purpose**: a modelled saving there would be this project guessing the answer to the one question it has decided it cannot answer, and a number in that column would be quoted. `finalBand` is therefore read off the last rung that was actually modelled, never off the end of the ladder.

Rung 2c prints the command that produces the worksheet to ask with. Run it from the engine's own assets folder (`C:\u3a St Ives\.claude\skills\make-bus-leaflet\assets`); `--map` names a folder under the buses-data checkout and is not a placeholder:

```bash
node poi_worksheet.js --map "Areas/High Wycombe"
```

The answer comes back as `routes.json`'s `poi.tiers` — see [s3-config.md](s3-config.md). A `miss` there is the only lever that reduces P, and it is the only lever that reaches OA-089's 148 unnameable symbols at all: no placer change does, which is that row's own argument.

Cheapest first. The script models rungs 0–2b on the real geometry and prints the predicted score for each; take them in order and stop at the first GREEN.

| Rung | Remedy | Status |
|---|---|---|
| **0** | curate the service set at the **frequency cliff** | **built (P2)** — `curate_services.js` → `match_cfg.json skipRoutes` + a `mapNotes` line |
| **1** | **bundle co-running families** into one line with a badge stack | **built (P2)** — `routes.json` `internalCorridors`, see [s3-config.md](s3-config.md) |
| **2** | **suppress the core** — a "town centre" box routes terminate at | **built (P3)** — `routes.json` `coreBox` |
| **2b** | thin drawn stops to interchanges + termini | **built (P3)** — `routes.json` `stopThinning` |
| **3** | colour by **corridor**, not by route | **built (P3)** — `routes.json` `corridorPalette`; retires a locked decision, see below |
| **4** | split into area sheets **by route family** | not built (P5, only if a town needs it) |
| **5** | decline the whole-town internal map; ship place-centred leaflets instead | `make-place-bus-leaflet` |

### Applying rungs 0 and 1 — `curate_services.js`

```
cd <S2 run dir>
node "%SK%\curate_services.js"          # report only
node "%SK%\curate_services.js" --apply  # + writes match_cfg.json skipRoutes
```

It spawns `complexity_score.js` rather than re-deriving anything, then turns the two mechanical rungs into the config they need:

| Rung | It gives you | `--apply` writes it? |
|---|---|---|
| 0 | `match_cfg.json` `skipRoutes` for everything below the frequency cliff, **plus** a `routes.json` `mapNotes` line naming those services so the reader still knows they exist | yes (idempotent union) |
| 1 | a paste-ready `routes.json` `internalCorridors` block from the detected families | **no — on purpose** |
| 2 / 2b / 3 | the `coreBox`, `stopThinning` and `corridorPalette` blocks, with each rung's predicted score and the traps that go with it | no |

Rung 1 is not auto-applied because a family is a **claim about the real world**. skipRoutes is reversible and re-measurable; a wrong bundle makes the map assert something false. Confirm each one.

**Once a rung is in `routes.json`, the gate stops proposing it** and scores the town with it applied (`complexity.json` `applied`), so the report always reads "what is still wrong", never "do the thing you already did".

**Rung 0 changes the geometry, so re-run S2 after it:** `curate_services.js --apply` → `match_routes.js` → `complexity_score.js`.

### Reading the ladder output

- **Rung 0** finds the frequency cliff rather than imposing a fixed trips-per-week number. Most towns hand you a natural break: High Wycombe's services run 1–8 trips/week then jump straight to 46, and those below the cliff are exactly its school, works, match-day and market-day services.
- **Rung 1 families are CANDIDATES, not decisions.** Bundling asserts the routes run together. Confirm every family. Two safety nets now exist, and neither replaces looking at the sheet: the generator keeps each member's own geometry, so a bundle **splits back apart wherever the routes diverge** rather than drawing a false merged line; and it writes `corridors_report.json` with each member's overlap against its **weakest** sibling, warning below 0.6. On High Wycombe that check independently rejected the hand-picked `31 / 41` family (0.40 / 0.46) while confirming `1/1A/1B`, `32/32A` and `102/103/104/105` at 1.00 — those three genuinely run identical streets inside the town, and vary only outside the frame.
- **Rung 2's box is sized by the FISHEYE, not by the radius.** `coreBox.radius` is honest metres, but the always-on `internalRoads.focus` magnifies the core, so a 600 m box can come out enormous on the page. Check the S5 JPG; cut `focus` or the radius. Decide which of the two owns the centre — they are two answers to the same problem and a town rarely wants both at full strength.
- **Rung 3 retires a locked design decision** ("one colour per route, consistent across both maps") for big towns only. It also breaks the internal/external colour correspondence for bundled families. Approved in principle 2026-07-28, bounded to R > 12.
- **A colour group is measured too, and by a lower bar than a bundle** (added 2026-08-16). `corridors_report.json` now carries every `corridorPalette` group's mutual overlap alongside the bundles', because "these lines are the same corridor" is a weaker claim than "these lines are one line" — the bar is **half** (`colourShareMin` 0.5), below which most of each line is going somewhere else and a reader following the hue is wrong more often than right. High Wycombe's three groups measure 41→**0.79**, 130→**0.55**, 37→**0.58**: all three earn their hue, and the last two are thin enough to be worth a look on the sheet, which is why the numbers print on every build rather than only when something trips.
- **Rung 3 does not, by itself, use fewer colours** — it makes the sharing *mean something*. High Wycombe v1.0 already had only 12 distinct hues; the defect was that they were spread over 31 routes **at random**, so two unrelated lines looked like one corridor. The work is re-assigning `palette` so each corridor gets one hue; the generator then warns about every hue still shared by unrelated groups (nine of them on the first pass at High Wycombe). With `corridorPalette` set, the gate reports **R as distinct colour groups**, because R exists to police the ~12-hue ceiling.
- **Rung 2b is not optional on a big town.** Stop load is independent of route count, so a town can clear R, K5 and D5 and still be unreadable. High Wycombe stays RED on S alone however well rungs 0–2 do; the ladder only completes with `stopThinning`.
- **The ladder used to stop at the map edge, and the Services panel did not know it had run** (found 2026-08-15, fixed 2026-08-16). High Wycombe's map draws 22 services as **14 lanes in 11 hues** and shows the badge stacks to prove it; its panel listed **22 separate, equal, individually-badged rows** and printed four hues shared 2–7 ways with nothing to explain them — rungs 1 and 3 silently undone in the one place a reader goes to look up a route, and the real reason that panel measured as over-stuffed. **`design.panelCorridors` + `corridorDesc` finish the rung**: one row per drawn lane wearing the map's own badge stack, and a sentence under the list stating the corridor rule, which is the "state it in the key" §9 asked for and never got. See [design-quality.md](design-quality.md). A triaged town should carry both keys — without them its panel reports the *un*-triaged count however its type is set.
- **On a triaged town, read the config before calling anything a defect.** The design-quality diagnosis looked at High Wycombe, saw 102/103/104/105/M40/X74 in one navy, and wrote down "the colour-blind-safe palette is exhausted". It is not — those six are one bundled lane wearing one corridor hue, which is rung 3 working. `complexity.json` `applied` is the fastest way to see what a town has already had done to it.

### Which rung, by symptom

| Failing | Diagnosis | First remedy |
|---|---|---|
| R high, K5 low | too many routes, well spread | 0 → 1 |
| K5 high, D5 < 1.5 km | one congested knot | fisheye `lenses[]` (exists today), then 2 |
| K5 high, D5 > 3 km | trunk corridor | 1, then 3 — **a lens will not help** |
| S high alone | label overload | 2b |
| still RED after 0–3 | genuinely too dense | 4, then 5 |

## Do not split a town geographically

Measured on High Wycombe's real geometry, not assumed:

| Split | Lines still present |
|---|---|
| whole town | 31 |
| north half | **31** |
| west half | **31** |
| NW quadrant | **31** |
| south half | 22 |
| east half | 24 |

Every geographic half still contains nearly every route, because a radial town's routes all pass through the centre. An area split cuts *extent*, not *colour count* — so it leaves R untouched, and whichever sheet holds the centre keeps the entire knot. **Split by route family / corridor group.**

## Options

| Flag | Effect |
|---|---|
| `--dir <path>` | score a directory other than the CWD |
| `--json` | machine-readable output only |
| `--no-fail` | never exit non-zero (batch scoring) |
| `--core-radius <m>` | rung-2 probe radius, default 600 |
| `--overlap <0–1>` | rung-1 family mutual-overlap threshold, default 0.6 |

## What the gate counts (and what it used to miscount)

Three things the score has to agree with the *drawn sheet* about — all three were wrong until the first town actually walked the whole ladder (fixed 2026-07-28):

- **S is measured over the DRAWN routes only.** `routes_intown_atco.json` still lists every service S2 scoped, so a town that has taken rung 0 was being charged for the stops of lines it no longer draws. High Wycombe read S=137 against a sheet with 91.
- **A `corridorPalette` family whose lead is also an `internalCorridors` lead was silently ignored**, because bundling renames the lane `<lead>+`. Two of High Wycombe's three corridors vanished and R read 13 instead of 11 — the difference between AMBER and GREEN.
- **The colour-ambiguity line reads the shipped `routes.json` palette**, not S2's draft `palette.json`, and only over drawn routes; where `corridorPalette` is set it says the sharing is **by design** instead of "COLOUR NO LONGER IDENTIFIES A ROUTE", which is the whole point of rung 3.

Re-scoring all seven towns after these fixes reproduces the calibration table above exactly.

## Inputs and the fallback

Reads `routes_paths.json`, `routes_intown_atco.json`, `atco2ll.json`, `intown_cfg.json` (anchor) and optionally `palette.json`. `verified-services.json` (S1) and `routes.json` (S3) are found automatically via the town manifest, so they don't have to be pulled first.

If `routes_paths.json` is absent it falls back to **straight stop-to-stop lines** and says so. That geometry samples far fewer points, so **K5 and D5 under-report** — the calibration table above assumes road-matched paths. Treat a GREEN from the fallback with caution; run `pull_roads.js` + `match_routes.js` first for a real score.

`internalCorridors` in `routes.json` is honoured when it exists, so a town that has already been bundled re-scores correctly rather than being penalised for services it no longer draws separately.

