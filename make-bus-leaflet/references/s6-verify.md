# Stage 6 — Verify (independent / "antagonistic" pass)

The reliability gate. S6 audits the latest S1–S5 outputs **two ways at once**: an
**independent blind red-team re-derivation** of the town's services (a separate
sub-agent that never saw our stored data) diffed against our pipeline, **plus**
structural / geographic **sanity checks** that don't need the red-team. It writes
`verification.json` + `verification.docx` and **fails the build (exit 1) on any HARD
finding**. See SKILL.md for the stage model, the manifest, and `stage.js`. `%SK%` =
the skill's `assets` folder; `$S6` = the run folder from `stage.js new S6`.

### How independent it actually is (state this honestly; don't oversell a PASS)
The pass is **procedurally blind** (the agent never sees our data, re-derives from
scratch) and **source-checked** (a second source is required). It is **not
statistically independent**, on two axes that matter:
- **Shared primary source.** The red-team's primary is bustimes.org — the *same*
  primary our S1 uses. An error *in bustimes itself*, or a misreading both make, is
  only caught if the agent's second source contradicts it.
- **Shared substrate.** The red-team is another instance of the *same model* as the
  orchestrator, so it shares blind spots and reasoning traps (e.g. the "Mon–Fri
  heading hides a separate Saturday timetable" trap) — correlated errors survive.
- The diff and the HARD/SOFT thresholds are **our** code, not an outside standard.

So report a PASS as **"no contradiction found by a blind, second-sourced re-check"**,
**not** "independently proven correct". For genuinely independent assurance you'd need
a disjoint source (Traveline/BODS only, no bustimes) and/or a different checker. Keep
the user's expectations calibrated to this in any summary.

S6 is **dated, not versioned** — it verifies whatever the manifest currently points
at; re-run it whenever S1–S3 data changes. It changes no drawn output, so it never
bumps an image version.

## When to run it
- After a major build (new/changed services, new town) — before relying on the data.
- Whenever the user asks "is this data right / trustworthy?" or to re-verify a town.
- Old towns (March, pre-S6 St Ives manifests) just work: `stage.js` lazily backfills
  the missing `S6` slot on first touch.

## The two design decisions (LOCKED — do not re-litigate)
1. **Rigour = full blind red-team agent.** Spawn a *separate* sub-agent that
   re-derives S1 from scratch — each service's operator, termini at **both** ends,
   operating days, and whether it actually serves the town — using bustimes **plus a
   second independent source**, with **no sight** of our stored
   `verified-services.json` / `routes.json` / geometry. It returns structured JSON; we
   diff. (Not self-consistency only; not a mere re-read of our own files.)
2. **On mismatch = block hard / flag soft.** A finding is **HARD** (blocks the build
   loudly) only if the displayed leaflet would be *wrong or undrawable*; everything
   else is **SOFT** (logged for review, never blocks).

## Procedure
1. `$S6 = stage.js new S6` (dated dir, no version). `cd "$S6"`.
2. **Pull the inputs to diff against:** `stage.js pull S1`, `pull S2`, `pull S3` into
   `$S6`. (They join the run dir alongside the outputs, same as S4/S5.)
3. **Spawn the blind red-team agent** (general-purpose sub-agent) with the *exact
   prompt below*, substituting the town. It must NOT be given any of our data — only
   the town name. It returns a single ```json block. Save that JSON verbatim as
   `redteam.json` in `$S6`. (HTML entities like `&amp;` / `P&amp;R` are fine — the
   engine unescapes them on load.)
   - If the agent returns prose around the JSON, keep only the JSON object.
   - It is acceptable to run the engine **without** `redteam.json` (sanity-only mode,
     `redteamPresent:false`) for a quick structural check, but a real verification
     pass needs the red-team.
4. **Run the diff/sanity engine:** `node "%SK%\verify_report.js"` (reads `$S6`; set
   `VERIFY_DIR` to point elsewhere). It writes `verification.json`, prints a console
   summary, and **exits 1 if any HARD finding**, else 0.
5. **Render the report:** `python "%SK%\gen_verification.py" verification.json` →
   `verification.docx` (mirrors `gen_disagreements.py`; red banner + HARD rows if
   blocked, green banner if PASS).
6. **Act on findings:**
   - **HARD** → the build is not trustworthy. Fix the upstream stage (re-run S1/S2/S3
     as needed) and re-verify. Do **not** ship a leaflet with an open HARD finding.
   - **SOFT** → record them for the user / a follow-up; **do not** silently edit a
     reproduced baseline (per the skill's "record open issues, don't fix" rule). Genuine
     data corrections go through a new S1/S2/S3 run + a version bump, not an in-place edit.
7. `stage.js commit S6 "$S6" --outputs redteam.json,verification.json,verification.docx
   --based-on "S1=…;S2=…;S3=…;S4=…" --note "<headline: N hard / N soft, key flags>"`.

## The exact blind red-team agent prompt
Spawn a `general-purpose` agent with this (replace **`<TOWN, COUNTY>`** and the two
"NOT the …" disambiguators; keep everything else verbatim — the strict-JSON shape is
what `verify_report.js` parses):

> You are an INDEPENDENT verification agent. Your job is to re-derive, from scratch and
> with NO prior assumptions, the complete set of bus services that serve the town of
> **<TOWN, COUNTY>** (NOT <the wrong same-named place>). You have NOT been given anyone
> else's answer; do not trust any number you cannot confirm from a live source. Treat
> this as a red-team audit: assume a previous analyst may have made mistakes, and find
> the ground truth.
>
> **What to determine** — for EVERY bus service that actually picks up/sets down
> passengers in the town, determine: (1) **route** — the public number/letter as
> branded; (2) **operator** — be precise about WHICH operator; (3) **termini** — the two
> end points as a two-element array; (4) **days** — plain words ("Mon-Sat", "Mon & Fri",
> "Daily", "limited / pre-book", …); (5) **servesTown** — true if it genuinely stops
> within the town, false if it only passes nearby. Also list separately any service the
> bustimes locality page associates with the town that does NOT actually serve it (with
> the reason).
>
> **How (use at least TWO independent sources)** — Primary: bustimes.org; start at
> `https://bustimes.org/localities/<slug>` and open each service page for stops/operator/
> termini; watch for *expired* services and ones listed against the locality that don't
> enter town. Second source (REQUIRED): confirm each a different way — the operator's own
> site/timetable, Traveline, Bus Open Data, or the council bus pages. Where two sources
> disagree, say so in `notes`. Watch operating-days traps (a "Mon-Fri" heading can hide a
> separate Saturday timetable = Mon-Sat) and operator identity (a number can be run by
> different operators in different areas).
>
> **Output — STRICT JSON only.** Return ONLY a single fenced ```json code block, no prose,
> exactly this shape:
> ```json
> { "town":"…", "derivedAt":"<ISO date>", "sourcesConsulted":["<url>"],
>   "services":[ {"route":"301","operator":"Dews Coaches","termini":["Ramsey","St Ives"],
>     "days":"Mon-Sat","servesTown":true,"confidence":"high|medium|low",
>     "sources":["bustimes","operator-site|traveline|bods|council"],"notes":"…"} ],
>   "excluded":[ {"route":"101","operator":"…","servesTown":false,"reason":"…"} ] }
> ```
> Include EVERY serving service in `services` and EVERY non-serving/expired one you
> considered in `excluded`. If you cannot confirm a field, give your best value, lower
> `confidence`, and explain in `notes` — never omit a field. No comments inside the JSON;
> it must parse with a strict parser. Be thorough and skeptical — the whole point is that
> you arrive at the answer independently.

## What the engine checks, and how it classifies

### Structural / geographic sanity (no red-team needed)
| Check | Severity | Catches |
|---|---|---|
| Every **displayed** route has full-chain data in `routes_full_atco.json` | **HARD** | a drawn route that would be a stub / undrawable |
| Every **drawn** ATCO (in `routes_intown_atco.json`) has a coord in `atco2ll.json` | **HARD** | orphan stop with no coordinate |
| `routes_full` termini align with S1 declared termini (locality-token match at chain ends) | **HARD** if *neither* terminus matches; **SOFT** if one matches, one is just a naming variant | chain that ends somewhere else entirely vs. "Cambridge"→`CITY` naming |
| **Direction**: the drawn edge stop's bearing from the anchor vs. the terminus bearing | **HARD** > 90° apart (drawn the wrong way); **SOFT** 55–90° (arm worth a look) | a route drawn leaving town toward the wrong side |
| **Counts plausible**: 0 drawn stops, > 80 drawn, or full chain < 2 | **HARD**; **SOFT** at 45–80 drawn | nothing to draw / accidentally drawing the whole chain |

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

Classification is deliberately **cautious about HARD**: terminus/direction checks only
go HARD when the contradiction is unambiguous (no token overlap at all / > 90°), so
naming artifacts (a terminus coded under a parent locality, a route that leaves town on
a different bearing than the straight line to its destination) stay SOFT and never
falsely block a good build.

## Files S6 owns
`redteam.json` (the blind agent's JSON), `verification.json` (classified findings +
summary), `verification.docx` (the rendered reliability report).

## Reusable notes
- The red-team agent can be flaky on operating-days precision but is **excellent at
  operator identity and serves-town** — the two things hardest to self-check. Trust it
  there; treat its `days` as a SOFT prompt to re-read the operator PDF.
- A SOFT `serves-town-conflict` is the highest-value soft finding — it means our own
  data may be wrong about whether a route serves the town. Surface it prominently.
- The locality-token terminus heuristic (place-name first-4-letters ≈ ATCO locality
  code) is robust for matching but **not** for naming: Cambridge stops are coded `CITY`,
  Trumpington P&R is under Cambridge, etc., so expect a few benign SOFT terminus notes.
