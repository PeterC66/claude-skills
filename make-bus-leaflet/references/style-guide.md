# The BusMaps.uk cartographic style guide — the spec the engine implements

Written 2026-08-16 as Phase 8 item 2 of `label-and-design-quality-plan_2026-08-15.md` (in the Buses repo's `Development Docs`), and cut from [`design-quality.md`](design-quality.md) rather than from a blank page — that file records *how* each rule is implemented and *what it cost to learn*; this one states the rule.

**What this document is for.** Until now the design lived in fourteen `routes.json` keys and one long engine reference, which meant every question of the form "should this sheet look like that?" was answered by reading code. With the spec written down, the line between engine and config falls where it belongs: **a per-town override that fights this spec is a bug in the engine, not a fix** ([[feedback_engine_vs_config_labeling]]). A town may legitimately declare things about *itself* — its services, its corridors, its complexity remedies, its words. It should not have to declare how big a subtitle is.

**What it is not.** Not a wish list, and not a description of the ideal. **Every number here is what the engine draws today**, verified against the shipped sheets on 2026-08-16. Where the engine does not yet meet the rule, it says so and names the gap.

---

## 0. The page

| | |
|---|---|
| Size | **A4 landscape, exactly**: 297 × 210 mm, emitted as 3508 × 2480 px, i.e. 300 dpi |
| Units | **Page millimetres throughout.** The SVG's user units are millimetres; nothing is in pixels or points |
| Print safe margin | **5 mm on all four edges**, measured to *ink* and not to a baseline — descenders count (`design.printSafe`) |
| Type | **Arial** everywhere. Real widths from `font_metrics.js`; never a character count |
| Bleed | None. Sheets are printed borderless, which over-scales by 2–3% — about 3 mm on A4 — which is exactly why the safe margin is not decoration |

**The margin is a floor, not a target.** Route ink is *meant* to run to the frame edge and be trimmed; the 5 mm rule is about **text**. A measure that applied it to ink would report 0 on every sheet and mean nothing.

**Gap:** the five place sheets do not yet honour it. They sit at 2.25–3 mm and pick it up at the portal re-vendor (Phase 8 items 3/3b).

## 1. Type scale

One scale, five steps, geometric:

```
2.45  ·  2.9  ·  3.5  ·  (4.2)  ·  5.0
```

| mm | Used for |
|---|---|
| **5.0** | section heading — `Services`, `Key` |
| **3.5** | route title, single-column and grouped |
| **2.9** | route subtitle, operator group header, Key item, fare note — and a route *title* in a dense multi-column panel, one step down |
| **2.45** | subtitle in a dense multi-column panel |
| **2.4** | map notes, the scale bar's caption, the not-to-scale line |
| 4.2 | a step nothing needs; listed so the 3.5 → 5.0 jump reads as skipping a step rather than as an arbitrary gap |

**2.4 mm is the hard floor and it is a print rule, not a taste one.** Nothing on any sheet may be set smaller; `quality_metrics.js` fails a sheet below it. When something will not fit, the answer is fewer words or more room — **never smaller type**. The one place the engine is allowed to shrink type is a panel subtitle under `printSafe`, and it refuses to go below 2.4 and says so on stderr.

**Rhythm is expressed as clear air between real ink** — cap-top to descender — not as a baseline step, so a 5 mm heading gets the same optical gap over 3.5 mm titles as over 2.9 mm Key items. **Air above a section heading is deliberately larger than air below it**: the heading belongs to what follows it.

## 2. Colour

**Colour on the sheet means route, and nothing else.** That is the whole rule, and every other colour decision follows from protecting it.

- **Routes** wear one hue each from a colour-blind-safe palette — **Tol Bright** by default: `#4477AA` blue, `#66CCEE` cyan, `#228833` green, `#CCBB44` ochre, `#EE6677` red, `#AA3377` purple, `#BBBBBB` grey. Okabe–Ito and the St Ives set are the alternatives.
- **POI symbols are charcoal**, not coloured (`design.iconInk`). The single exception is the **red GP cross**, which is a convention older than this map. The industrial estate stays a lighter neutral because it is *context*, not subject.
- **Water is `#9ec9e8`**, and **no route may wear a colour close to it in both Lab distance and hue.** The engine warns; `pick_route_colour.js` proposes a replacement. Score a candidate against **every other colour on the sheet plus the water** and take the largest *worst-case* separation — a hue can be numerically far from the river and land next to the route it now has to be told apart from.
- **The road skeleton is `#e4e4e4`** — present, and never competing.
- **Furniture is grey**: `#666` for footer and scale bar, `#555` for map notes, `#999` for the validity stamp and the scale bar's own caption.
- **Badge text** is white on dark fills, `#111` on light ones.

**The palette holds about twelve usable hues, and that is the binding constraint on the whole product.** Above ~12 drawn lines, "one colour per route" cannot be honoured and colour stops identifying anything. Two bounded exceptions exist, both opt-in, both from the complexity ladder, and both **must be stated on the sheet**:

- `internalCorridors` — co-running services drawn as one line carrying a badge stack.
- `corridorPalette` — colour identifies a **corridor**; badges carry route identity.

**A sheet that shares a hue must say why it shares it.** One sentence under the services list, in the town's own words. Without it, a reader seeing four hues shared two-to-seven ways can only conclude the palette ran out — which is precisely the impression the remedy exists to prevent.

## 3. Line work

| | |
|---|---|
| Route ribbon | **1.7 mm** |
| Route casing | **0.35 mm** of white, drawn as **its own pass over the whole set** before any colour |
| Corner radius | **2.0 mm**, on turns over 30°, clamped to half of each adjacent segment |
| Road skeleton | sized by the bundle it carries, `#e4e4e4`, plus `skeletonPad` **1.3 mm**; named side roads `#f0f0f0` at 0.45 mm |
| Railway | OS-style: black casing with white blocks laid on top |
| Text halo | **0.7 mm** white, via `paint-order="stroke"`; 0.8 mm on rotated road names |

**The casing is one pass, never per-route.** Per-route, the next route's casing erases the previous route's colour wherever they run close — which is most of a bundle.

**The corner clamp is what makes one radius safe on every model.** On a diagram, a line is straight runs punctuated by deliberate corners; on a geographic sheet, turning is *continuous* because the line follows a real road, and the clamp reduces the fillet to almost nothing on 1.2 mm segments.

## 4. Symbols

- **One 24 × 24 grid**, one stroke weight, one corner radius, one detail level, **solid — not outline** (`design.iconSet:"grid"`).
- **The 20-unit live area maps exactly onto the 4.2 mm box the placer reserves** (`POI_HALF = 2.1`). Mapping the full 24-unit grid onto it instead makes every symbol 20% smaller for padding the placer already provides — and drawing outside it means two symbols the placer scores as clear can still touch.
- **Every glyph carries a 0.34 mm white casing**, laid down as **a separate fattened silhouette before the glyph**, at the same weight and for the same reason as `routeCasing`. Not `paint-order:stroke` per path: per-path casing lets a later part eat an earlier one, and a tree's trunk cuts a white notch out of its own canopy.
- **Centres stay 3.2 mm apart** (`iconMinSep`), displaced by at most 2.6 mm (`spreadMax`). **Displace, never drop** — but not so far that the symbol stops being where the thing is.
- A pale fill inside a glyph is a **backing plate, not a mark**, and stays white when the set is recoloured.

## 5. Labels

- **Point labels are placed by the shared placer** (`labeller.js`), which knows where the route ink is, scores candidate positions, relaxes, wraps to two lines and draws a leader when it must.
- **A label may not sit on route ink, on another label's halo, or on a symbol that is not its own.** Its own symbol is 2.6 mm away by design and is excluded.
- **A road name on its own road is not a defect** — following the line is what it is for. Counted, never mixed into the headline figure.
- **The same place name may not appear twice within 30 mm.**
- **A label the placer cannot place is written to `unplaced.json`, never dropped silently.** A drop is a cost to be counted, not an outcome to be hidden — every other measure counts what is *on* the page, so an unreported drop makes a sheet score better for printing less.
- **More candidate positions is not better.** A third leader ring at 3.9× the nominal gap lost High Wycombe five names, because the extra reach let low-priority labels claim distant space that higher-value ones then could not use.

**A feature's label must sit within 25 mm of that feature's own ink.** Legibility guards are not enough: a label can land somewhere perfectly readable and name nothing.

## 6. Page furniture — and where it is allowed to sit

Furniture is anything pinned in page coordinates rather than to the map: the Services panel, the Key, the operators legend, the north arrow, the scale bar, the footer band, the validity stamp.

**The governing rule: furniture is drawn last and is opaque, so it must claim its space before the artwork is laid out, not after.**

| Device | Rule |
|---|---|
| Services panel | A reserved column. **It must fit the page** — columns × width from the panel's x must land inside the safe margin |
| Key | Below the services list, same panel column |
| Operators legend (external) | **Placed by search, not pinned.** Symbols — lozenges, hub, ticks, badges, names — are a **hard** constraint; route ink is minimised within that, then nearest a frame corner |
| North arrow | **Placed by the engine**, in the blank corner nearest a frame edge, reserving its box before the labels are solved. No town carries a hand-pinned position |
| Scale bar | Placed by the same blank-space search. Its footprint must describe where its caption is actually **anchored** — a caption is centred on the bar and sticks out both sides |
| Footer band | Pinned to the bottom, inside the safe margin, on its own 97%-opaque plate. **The map frame ends above the plate** (`footerSafe`) |
| Map notes | Above the footer plate, `#555`, stacking with the engine's own not-to-scale line so the pair reads as one voice |

**Two harms, ranked, and they must not be combined into one weighted score.** Burying a **named place** is a defect: the reader loses a destination with nothing to say it was ever there. Dimming a **route line** is a warning: the stroke is still legible either side of the box. A weighted sum quietly buys the unacceptable thing whenever it is small enough — the legend placer's first cut put High Wycombe's legend on the hub, because a hub covers less area than three spokes.

**Where nothing qualifies, furniture does not move, and the engine says so.** A legend that cannot be placed clear needs to be *smaller*; moving it somewhere equally bad costs the reader the one thing they had.

## 7. Scale, and saying what is true about it

- A **geographic sheet is fisheyed**: the town core is drawn at true scale and everything beyond it compressed, by a factor of 2 to 3.3 at the core boundary. So the scale bar is sized from the **core** and captioned **`town centre scale`**.
- On a **`coreBox` town** the centre is precisely what is *not* drawn, so the caption becomes **`scale outside the town centre box`**. A device must not name the one part of the page with no map on it.
- A **schematic or diagram carries no scale bar at any size** — those coordinates are solved onto a tube-map grid and hold no real-world distance. They get the words: **`Diagram — not to scale`**.

## 8. Off-map continuations

Today's arrangement — a destination, a badge and an arrowhead, positioned per exit by the placer — **is the spec**, and a single fixed device is explicitly rejected. It was built (`design.exitDevice`), measured at **+15 defects across the eight internal sheets**, and left off. Two facts decide it: straight inboard along the line is *on the route ribbon*, because the line does not stop at the badge; and the clearest space near a frame cut is *outboard*, which is the one direction a device cannot use without the text reading backwards between badge and arrow.

## 9. What the sheet must never do

Every line here is a defect the shipped sheets actually had.

1. **Draw something and then cover it.** Anything under the footer plate, under the legend, or under a panel is worse than absent — it looks like the map failed rather than like the mapmaker chose.
2. **Print inside the 5 mm trim margin.**
3. **Run off the page**: no column, caption, badge or lozenge past the sheet's edge.
4. **Overflow a shape**: no number wider than its badge, no name wider than its lozenge or hub. Measure with real metrics and grow the shape.
5. **Badge a service in the panel with no line on the map** — or, where the line genuinely cannot be drawn, fail to say so in that row.
6. **Label a feature away from that feature.**
7. **Share a hue without saying why.**
8. **Repeat a name within 30 mm.**
9. **Set anything below 2.4 mm.**
10. **Drop a label silently.**

## 10. How this spec is enforced

| | |
|---|---|
| `gen_internal.js` / `gen_external_radial.js` **stderr** | the rules a build can check about itself — a stranded feature label, a panel-only service, a route on the water's colour, a panel row outgrowing its column, a legend with nowhere to go. **Read the build's output, not just its exit code**; a `PALETTE WARNING` printed on every March build for two rollouts with nobody reading it |
| `quality_metrics.js` | measures a finished sheet against the numeric rules above |
| `quality_gate.js` + `status.js` | the ratchet: `HARD` and `drop` as ceilings, **`mapLabels` as a floor**, so no sheet can improve its score by printing less |
| `crop_compare.js` | the other half, and not optional — **render it and look.** The artwork has overruled the numbers twice on this project and confirmed them once |
| `gate.sh` / `status.js` byte gates | prove the generator is deterministic. **They say nothing about whether the sheet is any good** |

**A rule that no tool checks is a rule that will be broken.** Every numbered item in §9 was found either by a person looking at a print or by a measure written after the fact — and the ones found by printing were found because nobody had thought to ask that question, so there was no number to doubt. **The cheapest instrument in the project is a printer.**

---

**Related:** [`design-quality.md`](design-quality.md) — every key, its tuning, and what each one cost to learn. [`complexity-triage.md`](complexity-triage.md) — the remedy ladder, and why a triaged town's sheet must be read against its own config. [`changing-the-engine.md`](changing-the-engine.md) — the invariants and the rollout sequence. [`gotchas.md`](gotchas.md) — the traps.
