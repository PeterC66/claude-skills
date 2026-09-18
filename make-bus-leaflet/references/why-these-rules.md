# Why these rules — the incidents behind `make-bus-leaflet/SKILL.md`

**For:** anyone who has read a locked design decision and wants to know what locked it, or who is about to change one.

`SKILL.md` states each rule and points here; this holds the incident, the measurement and the argument. The split was made on 18 September 2026 by buses-data OA-399, R6 of the 2026-09-17 process review, on the finding that a session read about fifty thousand words before acting and that volume, not any individual rule, is what stops a rule being followed. `bus-work/SKILL.md` was split the same way in [#43](https://github.com/PeterC66/claude-skills/pull/43).

**Nothing below was rewritten in the move**, so the argument survives and the diff is readable.

**This skill turned out to be far more rule-dense than `bus-work`, and that is worth knowing before anybody tries to shrink it again.** `bus-work` lost 31% of its words to this treatment (13,560 to 9,326); this one lost **930 words, 7.7%** (12,135 to 11,205), because *Locked design decisions* is a list of constraints whose evidence is the thing that stops them being silently changed, and a builder mid-run needs both. A dated sentence is not a reliable marker of removable history here: 23% of this file's words sit in a sentence carrying a date or an action reference, and most of those sentences state a rule — *since 2026-09-06 a town writes `notOnLeaflet[]` and nowhere else* is a rule with a date in it, not a story. Every cut below was made bullet by bullet on that judgement.

**A companion, not a second skill.** If you are adding a rule here rather than to `SKILL.md`, you are writing a rule nobody will read.

## The sheet

### The quality baseline that started it

`quality_metrics.js` was written against a measured starting point rather than an impression. Baseline as of 2026-08-15: **658 defects across 31 sheets, every sheet failing at least one check** — see `…\Buses\Development Docs\quality-baseline-scorecard_2026-08-15.md` and the phased plan beside it. It measures text with **real Arial advance widths** (`font_metrics.js`, baked; regenerate with `font_metrics_build.js`) rather than the generators' `length × size × 0.52` guess, which is why its counts moved when nothing on the sheets had.

### One external template, not two

ONE layout ships: **radial** (`gen_external_radial.js`) — a hub with straight spokes. A second, **busway**, drew a guided-busway / P&R corridor for St Ives and was **dropped on 2026-09-02**: St Ives moved to the radial template on 2026-08-03 (with `externalHubLabel` combining its Bus Station and Park & Ride into one hub, which is what Peter preferred), so it was drawn by no committed sheet for a month — and it spent that last day unrunnable, throwing at load, with every gate in the estate green, because nothing ran it.

That is the estate's *dark file* shape, and the cheapest check there is — does the file LOAD — now exists as `test/generator_load.test.js` over a population derived from `engine_version.js`'s lists rather than typed.

### Two spokes that were one spoke, and the panel nothing looked under

Ramsey's 303 and 305 had **identical `stops` arrays**, the same destination and the same journey time, and were drawn as two parallel lines with two `Huntingdon` lozenges side by side; `external[].routes:["303","305"]` merged them and took that sheet from 3 defects to **0**. That is why the composition question comes second: a fan that is too crowded may be a fan drawing one route twice.

**After any spider composition change, look at the legend, the note block and the stamp**: they are pinned in page coordinates, the spokes are not, and Ramsey's Peterborough terminus disappeared under the legend's opaque panel with nothing complaining.

**`quality_metrics.js` now asks that question of ALL THREE page devices and not only the legend** (OA-207, 2026-08-31) — the `design.howToUse` panel was added later with the *identical* rect signature, and `P.rects.find()` returned the legend and stopped, so Wisbech's teal 60 spoke ran under the help panel on the shipped v2.7 with `routeLinesUnderLegend` reading 0. Three of the eight towns turned out to carry route ink under that panel; no symbol is buried on any sheet. A finding now names which box: `route line behind a page panel: #009988 at 232.2,142.1 [under the panel]`, via `--detail`.

**The generator's own message is still the half that lies** — it reports the move and not the residue ("moved 152,-16 mm to 162,142" after leaving 8% of route ink underneath), and fixing that is deferred because `gen_external_radial.js` is inside the engine template hash.

### What the design-quality keys bought, and what they cost

All 8 built towns carry the universal set: **628 → 225 measured defects across the 31 sheets**, and all 21 town sheets now clear the 5 mm print margin. `printSafe` keeps every drawn thing 5 mm from the trim — footer, placer, panel columns, terminus lozenges — after a borderless print showed all 31 sheets putting their credit 3 mm from the edge.

The 5 **places** are still on v1 — the portal re-vendor is done and did not change them, because every key defaults off, so places move only when the keys are *adopted* on them.

**Two keys are conditional, not universal:** `panelCorridors` (+ `corridorDesc`) only on a town with `internalCorridors` (High Wycombe alone), and `spokeSpread` on a crowded spider — **Beaconsfield, Huntingdon, March and Ramsey** carry it; the other four are blocked by legend *size*, not by the bearing rule.

**`design.sheetUrl`, `design.sheetQr` and `design.howToUse` are ADOPTED on all 13 maps** (published 2026-08-19; the skill said "no town carries them yet" until 2026-08-21, which is the stale-claim trap the runbook sweep exists for). They exist because `Map design © BusMaps.uk` is a credit and not a way back to the version that is current now. `sheetQr` draws a QR code at **14mm** — the largest that fits the space the URL line already makes, so it costs the frame nothing further — and `howToUse` settled at **three bullets at 92mm**, the only combination that fits all eight towns. Costs, measured: the QR raises the footer plate and `footerSafe` shrinks the map frame to match, so 15 of 39 sheets lose 1–4 POI/street labels — accepted deliberately, with the reason recorded in `quality-ledger.json`'s own `note` field. Full account: [design-quality.md](design-quality.md).

**Why `design.fixedOrientation` exists** (2026-08-21): PCA re-derives the rotation angle from the stop cloud on **every build**, so a route added or withdrawn next month can swing the whole sheet several degrees — no gate notices, because the sheet is correct either way, but it is obvious to anyone comparing this month's printed copy with last month's. **No map is pinned today.** Numbers are stored unnormalised on purpose — see [gotchas.md](gotchas.md) §"Normalising an angle is not free".

### The version stamp that printed the wrong number

The version *printed on the map* is a data field — `routes.json` `"version"` — separate from the folder name, and branching a new build from an older `routes.json` used to ship maps stamped with the previous version: Beaconsfield v1.1 printed v1.0. Since 2026-07-25 `pull` rewrites the field to match the versioned run dir it lands in, and `commit S4`/`S5` refuses a mismatch rather than recording a build whose maps print the wrong number.

## The data

### A service can be in neither feed

Wisbech's route 68 (FACT's Tesco Bus) is in no BODS extract, on no bustimes page and in no OSM relation, and was found only by a blind S6 red team. Its whole chain was resolved by hand from the operator's own published timetable, with a `source: "operator"` provenance and a tracked row-by-row audit (`manual-chain-68.json`) so the invention can be reviewed rather than re-derived. Route 68's timetable is a PNG a text fetch does not show you, which is why the rule is to download whatever the operator publishes before concluding a service cannot be drawn.

### Why every town names its region explicitly

**A town queried against the wrong region's dataset matches nothing and reports every one of its routes as withdrawn, which reads exactly like a real answer.** That is why there is no default region: with neither `--db` nor `$GTFS_DB`, the ad-hoc scripts fail and list the built regions rather than guessing, and a town whose region is missing or wrong is reported NOT CHECKED rather than diffed. Beaconsfield did exactly that for a month. `$CAMBS_GTFS_DB` still works and warns: it is misnamed for a multi-region system.

**An over-broad NaPTAN block is a reason to use `near` instead of `prefixes`**: Beaconsfield's `040000001` spans 326 stops across Bucks and produced 35 unrelated `[ADD?]` rows until it moved to a 2.5 km radius.

**The operator-name inference is only a fallback.** Whippet's commercial X1 is absent from the feed while nine of its sibling routes are in it, and read `[WITHDRAWN?]` every month until it declared itself with `notInBods`.

**A dialog box is used rather than a toast** for the monthly refresh, because toasts get swallowed by Focus Assist. A region that fails to download is logged and skipped rather than failing the run — its towns simply report NOT CHECKED.

**Place maps are covered in their own right since 2026-08-17.** Unlike towns, place maps are registered nowhere, so `gtfs_places.py` discovers every `manifest.json` under `Areas/*/Places/`, `Places/*/` or `Places/*/*/` and scans each against **its own** `near` radius. Before this, a place was only ever covered as a side effect of its parent town — so a place whose town was not registered got nothing, and the portal seeded a place map's public "changes coming" banner from its town's section: the Aldi map would have advertised High Wycombe's new WW1, which does not serve it.

**One real bug found while building the unattended monthly refresh, and worth remembering as a shape:** `gtfs_refresh_report.py` and `gtfs_upcoming.py` both looked for town data at `<root>/<Town>` instead of `<root>/Areas/<Town>`, so the monthly refresh report had been silently empty for every town.

### What NaPTAN carries that GTFS does not, and the two traps

BODS gives five stop columns and no way to tell same-named stops apart — Cambridge's Drummer Street is 14 rows all called `Drummer St Bus Station`. NaPTAN carries the `Indicator` (`Stop E`, `Bay 1`, `opp`), the `Bearing`, the `Street`, the `Landmark` and the NPTG locality, keyed on `ATCOCode`, which **is** GTFS's `stop_id`, so it joins with no lookup table. OGL v3.0, no API key.

**Use the derived `lat`/`lon`, never `Latitude`/`Longitude`** — blank on ~10% of rows nationally and on most of Cambridgeshire's; the build converts `Easting`/`Northing` and records which in `pos_source`. **Gate any stand lettering on the derived `stand` column, never on `Indicator`**, which is populated almost everywhere and usually says `opp` or `near`. Both are spelled out in `_gtfs/README.md`.

How much stand cover exists town by town is measured in `Development Docs/stand-coverage_2026-08-22.md` — short answer, lettering is an authority's policy rather than a national standard: Buckinghamshire letters its on-street town-centre stops, Cambridgeshire letters only its bus stations. **Read that measurement with its own correction, though** — it counts clusters of *same-named* stops, and the 2026-08-22 boarding-plan prototype showed that is not the question the product asks: at St Ives the busiest service boards 47 m away under a different name, so the place scores "fully lettered" and would still misdirect most of its readers (`Development Docs/boarding-plan-product_2026-08-22.md` §7.1). Re-counting against the frame is an open action.

## The run folders

### What a skipped `_latest` refresh cost, twice

**Never copy the JPGs by hand**, and never skip the refresh after hand-patching a file inside an already-committed S5 folder (no version bump) — a skipped or late refresh is exactly what left High Wycombe Aldi and St Neots Town Centre stale on 2026-08-08.

**`stage.js commit S6` now does its own half of this** (buses-data OA-329 fault A, 2026-09-13), because S6 was the one stage with no driver at all: the two rollouts already refresh after their `commit S5`, a person was expected to remember after an S6, and the consequence was **thirteen of twenty maps carrying a superseded `verification.docx`** in the folder whose whole meaning is *current*.

### Why S6 is never pruned, and why pins are load-bearing

**All of S6 is kept**, changed 2026-08-27: it holds the tracked `redteam.json`, and the old keep-newest-only rule had nine S6 folders queued for deletion, **seven of them holding an answer** that costs 89k–137k tokens to buy again.

**Pins are load-bearing:** the portal's `FIXTURE_DIR` points at St Ives `S5-render\v6.6`, two versions behind the newest, so a plain keep-the-newest rule silently breaks the byte-identical gate. S1–S3 are in git so pruning them is recoverable; S4/S5/S6 are not, and the SyncBack mirror drops them at its next run, so run SyncBack *before* `--apply`.

### The two place-naming traps

`draft_town.py`'s `PlaceNamer` reverse-geocodes each stop because GTFS has no locality column and operators publish street-level headsigns — three different Ramsey routes all "terminate at Bus Station". Two ordering traps were hit and fixed: UK Nominatim puts the **district** in `city` (→ "Huntingdonshire"), so admin-looking names are rejected; and `suburb` must stay below town/city or destinations degrade to a district of themselves (Peterborough → "Millfield", Huntingdon → "Hartford").

**The complexity gate must run after `match_routes.js`**, and that is a measurement rather than a preference: Ramsey read GREEN without the road match and AMBER with it, because the gate scores straight-line geometry otherwise and its calibration does not hold.

**The unattended draft was verified end to end on a real new town** — Ramsey, Cambridgeshire, 8 services, AMBER — producing route badges, terminus arrows, road names, north arrow, version stamp and real destinations (March, Peterborough, Huntingdon, St Ives) with journey times, and `status.js` passed it alongside all 7 towns that existed then.
