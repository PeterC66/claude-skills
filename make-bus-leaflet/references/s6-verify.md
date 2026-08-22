# Stage 6 — Verify (independent / "antagonistic" pass)

The reliability gate. S6 audits the latest S1–S5 outputs **two ways at once**: an **independent blind red-team re-derivation** of the town's services (a separate sub-agent that never saw our stored data) diffed against our pipeline, **plus** structural / geographic **sanity checks** that don't need the red-team. It writes `verification.json` + `verification.docx` and **fails the build (exit 1) on any HARD finding**. See SKILL.md for the stage model, the manifest, and `stage.js`. `%SK%` = the skill's `assets` folder; `$S6` = the run folder from `stage.js new S6`.

### How independent it actually is (state this honestly; don't oversell a PASS)
The pass is **procedurally blind** (the agent never sees our data, re-derives from scratch), **source-checked** (a second source is required), runs on a **different model** than the orchestrator (step 3 below), and its **primary source is NOT bustimes.org** (the prompt now requires a non-bustimes primary; bustimes may only be used to cross-check, never as the sole or first source — see the prompt). That closes two of the three correlated-error risks this section used to flag as open. What's still true:
- **Shared substrate family.** The red-team is a *different* model but still a Claude model, so architecture-level blind spots (not model-specific ones) can still correlate — a reasoning trap novel to the whole family, rather than one instance's quirk, could still survive.
- The diff and the HARD/SOFT thresholds are **our** code, not an outside standard.

So report a PASS as **"no contradiction found by a blind, second-sourced, different- primary-source, different-model re-check"** — stronger than before, still **not** "independently proven correct". For genuinely independent assurance you'd need a non-Claude checker. Keep the user's expectations calibrated to this in any summary.

S6 is **dated, not versioned** — it verifies whatever the manifest currently points at; re-run it whenever S1–S3 data changes. It changes no drawn output, so it never bumps an image version.

## When to run it
- After a major build (new/changed services, new town) — before relying on the data.
- Whenever the user asks "is this data right / trustworthy?" or to re-verify a town.
- Old towns (March, pre-S6 St Ives manifests) just work: `stage.js` lazily backfills the missing `S6` slot on first touch.

## The two design decisions (LOCKED — do not re-litigate)
1. **Rigour = full blind red-team agent, on a different model, with a non-bustimes primary source.** Spawn a *separate* sub-agent that re-derives S1 from scratch — each service's operator, termini at **both** ends, operating days, and whether it actually serves the town — with **no sight** of our stored `verified-services.json` / `routes.json` / geometry. It returns structured JSON; we diff. (Not self-consistency only; not a mere re-read of our own files.) Two extra constraints beyond the original design, added 2026-08-04 to convert the honesty caveat below from a permanent disclaimer into an actual improvement:
   - **Model:** pass `model:` in the `Agent` call and set it to a **different** Claude model than the one currently orchestrating the build (see step 3). Never Haiku — this pass needs real judgement (operator identity, day-trap reading), not mechanical extraction.
   - **Primary source is NOT bustimes.org.** The prompt below requires the red-team's first/primary source to be something other than bustimes (operator site, Traveline, BODS, council pages); bustimes may only be used as a cross-check, never the sole or first source for a service. This is what removes the "shared primary source" correlated-error risk, not just the "different agent instance" one.
2. **On mismatch = block hard / flag soft.** A finding is **HARD** (blocks the build loudly) only if the displayed leaflet would be *wrong or undrawable*; everything else is **SOFT** (logged for review, never blocks).

## Procedure
1. `$S6 = stage.js new S6` (dated dir, no version). `cd "$S6"`.
2. **Pull the inputs to diff against:** `stage.js pull S1`, `pull S2`, `pull S3` into `$S6`. (They join the run dir alongside the outputs, same as S4/S5.)
3. **Pick a different model, then spawn the blind red-team agent.** `Agent` (`subagent_type: general-purpose`) with the *exact prompt below*, substituting the town, and an explicit `model:` override that differs from whatever model is currently running this build: orchestrating as **Sonnet** → red-team on **Opus**; orchestrating as **Opus** → red-team on **Sonnet**. (If the orchestrator is something else, pick whichever of Sonnet/Opus it *isn't*.) It must NOT be given any of our data — only the town name. It returns a single ```json block. Save that JSON verbatim as `redteam.json` in `$S6`. (HTML entities like `&amp;` / `P&amp;R` are fine — the engine unescapes them on load.)
   - If the agent returns prose around the JSON, keep only the JSON object.
   - It is acceptable to run the engine **without** `redteam.json` (sanity-only mode, `redteamPresent:false`) for a quick structural check, but a real verification pass needs the red-team.
4. **Run the diff/sanity engine:** `node "%SK%\verify_report.js"` (reads `$S6`; set `VERIFY_DIR` to point elsewhere). It writes `verification.json`, prints a console summary, and **exits 1 if any HARD finding**, else 0.
5. **Render the report:** `python "%SK%\gen_verification.py" verification.json` → `verification.docx` (mirrors `gen_disagreements.py`; red banner + HARD rows if blocked, green banner if PASS).
6. **Act on findings:**
   - **HARD** → the build is not trustworthy. Fix the upstream stage (re-run S1/S2/S3 as needed) and re-verify. Do **not** ship a leaflet with an open HARD finding.
   - **SOFT** → record them for the user / a follow-up; **do not** silently edit a reproduced baseline (per the skill's "record open issues, don't fix" rule). Genuine data corrections go through a new S1/S2/S3 run + a version bump, not an in-place edit.
7. `stage.js commit S6 "$S6" --outputs redteam.json,verification.json,verification.docx --based-on "S1=…;S2=…;S3=…;S4=…" --note "<headline: N hard / N soft, key flags>"`.

## The exact blind red-team agent prompt
Spawn a `general-purpose` agent with this (replace **`<TOWN, COUNTY>`** and the two "NOT the …" disambiguators; keep everything else verbatim — the strict-JSON shape is what `verify_report.js` parses):

> You are an INDEPENDENT verification agent. Your job is to re-derive, from scratch and with NO prior assumptions, the complete set of bus services that serve the town of **<TOWN, COUNTY>** (NOT <the wrong same-named place>). You have NOT been given anyone else's answer; do not trust any number you cannot confirm from a live source. Treat this as a red-team audit: assume a previous analyst may have made mistakes, and find the ground truth.
>
> **What to determine** — for EVERY bus service that actually picks up/sets down passengers in the town, determine: (1) **route** — the public number/letter as branded; (2) **operator** — be precise about WHICH operator; (3) **termini** — the two end points as a two-element array; (4) **days** — plain words ("Mon-Sat", "Mon & Fri", "Daily", "limited / pre-book", …); (5) **servesTown** — true if it genuinely stops within the town, false if it only passes nearby. Also list separately any service the bustimes locality page associates with the town that does NOT actually serve it (with the reason).
>
> **How (use at least TWO independent sources) — bustimes.org is NOT your primary source.** Start from a **non-bustimes** source to establish which services serve the town in the first place: the relevant council's bus pages, Traveline, Bus Open Data (BODS), or operators' own network/timetable pages for the area. Only THEN use bustimes.org (`https://bustimes.org/localities/<slug>` and each service's page) as a **cross-check** — to fill in stop-level detail, catch anything your primary source missed, or resolve an ambiguity — never as the source you start from or the one you trust by default. Every service still needs a second, different source confirming it (operator's own site/timetable, Traveline, BODS, council pages — bustimes counts as one of these only if it was not also your primary). Where sources disagree, say so in `notes`, and note in `sources` which one you treated as primary for that service. Watch operating-days traps (a "Mon-Fri" heading can hide a separate Saturday timetable = Mon-Sat) and operator identity (a number can be run by different operators in different areas).
>
> **Output — STRICT JSON only.** Return ONLY a single fenced ```json code block, no prose, exactly this shape: ```json { "town":"…", "derivedAt":"<ISO date>", "sourcesConsulted":["<url>"], "services":[ {"route":"301","operator":"Dews Coaches","termini":["Ramsey","St Ives"], "days":"Mon-Sat","servesTown":true,"confidence":"high|medium|low", "sources":["bustimes","operator-site|traveline|bods|council"],"notes":"…"} ], "excluded":[ {"route":"101","operator":"…","servesTown":false,"reason":"…"} ] } ``` Include EVERY serving service in `services` and EVERY non-serving/expired one you considered in `excluded`. If you cannot confirm a field, give your best value, lower `confidence`, and explain in `notes` — never omit a field. No comments inside the JSON; it must parse with a strict parser. Be thorough and skeptical — the whole point is that you arrive at the answer independently.

## What the engine checks, and how it classifies

### Structural / geographic sanity (no red-team needed)
| Check | Severity | Catches |
|---|---|---|
| Every **displayed** route has full-chain data in `routes_full_atco.json` | **HARD** | a drawn route that would be a stub / undrawable |
| Every **drawn** ATCO (in `routes_intown_atco.json`) has a coord in `atco2ll.json` | **HARD** | orphan stop with no coordinate |
| `routes_full` termini align with S1 declared termini (locality-token match at chain ends) | **HARD** if *neither* terminus matches; **SOFT** if one matches, one is just a naming variant | chain that ends somewhere else entirely vs. "Cambridge"→`CITY` naming |
| **Direction**: the drawn edge stop's bearing from the anchor vs. the terminus bearing | **HARD** > 90° apart (drawn the wrong way); **SOFT** 55–90° (arm worth a look) | a route drawn leaving town toward the wrong side |
| **Counts plausible**: 0 drawn stops, > 80 drawn, or full chain < 2 | **HARD**; **SOFT** at 45–80 drawn | nothing to draw / accidentally drawing the whole chain |
| **Complexity-ladder remedies** — read from S4's `corridors_report.json`, when the town has `internalCorridors` / `corridorPalette` | all **SOFT** | see below |

**Why the ladder checks are SOFT.** They are judgement calls a human signed off, not data errors — but each one is a way the *map* can state something false, which is what S6 is for. Absent file (the normal case) ⇒ no findings.

| Finding | What it means |
|---|---|
| `weak-corridor-bundle` | a bundled family's member co-runs with it over < 60% of its route, so the rest draws as a second same-coloured line going somewhere else. **Drop that family.** |
| `colour-clash` | with `corridorPalette` in force, one hue is used by two unrelated corridor groups — a reader reads one colour as one corridor, so this asserts a corridor that does not exist |
| `palette-exhausted` | more than ~12 distinct colours are drawn; colour no longer identifies a line at all |

### Red-team diff (needs `redteam.json`)
| Diff | Severity | Notes |
|---|---|---|
| Red-team says a service we **include/draw** does **NOT** serve the town | **HARD** | we'd draw a non-serving route |
| Red-team termini match **NEITHER** of our termini for a route | **HARD** | independent terminus contradiction |
| Operator differs | **SOFT** | name/label only (the 5A "Stephensons vs Stagecoach" question lands here) |
| Termini differ on **one** end / naming | **SOFT** | "Hinchingbrooke" vs "Huntingdon / Hinchingbrooke" |
| Operating days differ | **SOFT** | day variants |
| Red-team finds a town service **absent** from our set | **SOFT** `missing-service` | inclusion candidate |
| Red-team lists a **sub-service** we fold into a parent (`variants[].subServices`) | **SOFT** `sub-service` | informational; aliased to the parent so it isn't noise (301S/301V/301X → 301) |
| We mark a route **not** serving town (`notOnLeaflet`) but red-team finds it **does** | **SOFT** `serves-town-conflict` | re-examine (e.g. seasonal weekend service) |
| We have a route the red-team didn't confirm | **SOFT** `not-confirmed` | the red-team may simply have missed it |

Classification is deliberately **cautious about HARD**: terminus/direction checks only go HARD when the contradiction is unambiguous (no token overlap at all / > 90°), so naming artifacts (a terminus coded under a parent locality, a route that leaves town on a different bearing than the straight line to its destination) stay SOFT and never falsely block a good build.

## What survives in git, and what does not (added 2026-08-22)
`buses-data`'s `.gitignore` ignores `Areas/**/S6-verify/**` and `Places/**/S6-verify/**`, re-including only `README.md`, `manifest.json` and `*.docx`. So **`redteam.json` and `verification.json` are NOT tracked** — they live on disk and in the SyncBack mirror only, and a fresh clone of the repo has neither. `verification.docx` is what actually carries a run's verdict into git, which is why step 5 is not optional: an S6 whose report was never rendered leaves nothing behind but a manifest row.

If a run needs a prose note — a place run where the HARD count needs interpreting, say — **name it `README.md`**. That is the keep-rule the ignore file already has (`!Areas/**/README.md`), so the note is preserved without forcing anything past the ignore rules or changing repo policy. Check with `git check-ignore -v <path>` rather than assuming.

## Files S6 owns
`redteam.json` (the blind agent's JSON), `verification.json` (classified findings + summary), `verification.docx` (the rendered reliability report).

## Running S6 on a PLACE, not a town (added 2026-08-08 — St Neots Tesco Extra, first-ever place S6 run)
This engine was built for towns and reads `verified-services.json` as a **required** input — places don't have one (their S1 output is `gtfs-services.json`, a different shape, no `servesTown` flag). Before this, S6 had literally never been run on any place. Two things to know:

1. **Generate the required input first.** Run `node "%PSK%\place_verified_services.js"` (from `make-place-bus-leaflet/assets`) in the S6 dir, after pulling S1 — it adapts `gtfs-services.json` into a `verified-services.json` the engine can read, treating every entry as `servesTown:true` (read as "calls at the place"), since P1's `--near` radius already filtered to stops inside the walkshed.

2. **A place's terminus checks no longer false-positive HARD (fixed 2026-08-22), so a place's HARD count is now readable.** It was not before: St Neots Town Centre came back BLOCKED with 13 hard on 2026-08-21 of which ten were pure artefact, and Tesco Extra's 6 hard were *all* artefact. Those same runs now read 3 hard and 0 hard, with every removed finding re-stated honestly as a SOFT. What changed, and why this is not just a muted check:

   - `place_verified_services.js` now resolves termini through `routes.json`'s curated `destinations[]` where an entry names the route, falls back to the raw GTFS headsign otherwise, and **stamps `terminiSource`** (`destinations` or `gtfs-headsign`) on each service. A town's file has no such field, so towns take none of the branches below.
   - **S-4 (declared terminus vs drawn chain) is downgraded to SOFT for a place, deliberately, because for a place it is structurally circular and asserts nothing.** Both sides come from the same BODS pull — `routes_full_atco.json`'s direction `name` IS the headsign pair — so any scheme resolving a headsign via the drawn chain would pass by construction. The finding now says the check is *unavailable*, which is true, rather than inventing a pass for it.
   - **The red-team terminus check carries the weight for a place, and was rewritten to work.** Instead of comparing our headsign against the red-team's settlement name (which can never match), it asks whether each red-team settlement is a **locality at the ends of our drawn chain**. The red-team is sourced blind, independently of BODS, so this is a real assertion — and it was proven to go HARD on demand by feeding it a terminus our chain does not reach.
   - Where a red-team terminus is unmatched *and* a chain end carries no NaPTAN locality code (a cross-border route — St Neots' 905 ends at Bedford `020035035`), nothing was actually compared, so it is SOFT, not HARD.
   - `naptan_localities.json` (new, in `make-bus-leaflet/assets/`) maps the few locality CODES the 3-character prefix rule cannot reach. Checked against every chain-end locality in the built estate — 27 distinct codes — **`CITY` (Cambridge) was the only irregular one**, confirming the note at the foot of this file. A code with no entry is unverifiable, never a mismatch, so a missing entry cannot manufacture a false HARD. Adding `CITY` also cleared five long-standing false SOFTs on Huntingdon, St Ives and St Neots.

3. **What a place's remaining HARDs mean.** On the St Neots Town Centre run the three survivors are all genuine and all already on the open-actions list: two `no-full-chain` HARDs on routes 112/193, carried deliberately as "not shown" panel rows (a check that still cannot tell a deliberate panel row from missing geometry), and one direction question on route 66 — which the rewritten red-team check independently corroborates, putting 66's red-team terminus (Fenstanton) nowhere near our chain ends (HUNT, STNS). Two independent checks pointing at one route is real signal.

Everything else (red-team diff, direction/count sanity, the ladder checks) behaves normally and is genuinely informative for a place — treat SOFT findings (esp. `missing-service`) as real curation leads, same as for a town.

## Reusable notes
- The red-team agent can be flaky on operating-days precision but is **excellent at operator identity and serves-town** — the two things hardest to self-check. Trust it there; treat its `days` as a SOFT prompt to re-read the operator PDF.
- A SOFT `serves-town-conflict` is the highest-value soft finding — it means our own data may be wrong about whether a route serves the town. Surface it prominently.
- The locality-token terminus heuristic (place-name first-4-letters ≈ ATCO locality code) is robust for matching but **not** for naming: Cambridge stops are coded `CITY`, Trumpington P&R is under Cambridge, etc., so expect a few benign SOFT terminus notes.

