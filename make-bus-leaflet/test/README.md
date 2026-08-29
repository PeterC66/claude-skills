# The engine's unit tests

Run them from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` (or wherever this skill is checked out — every command on this page is run from that folder, and none of them takes a parameter):

```bash
npm test
```

That is `node --test`, which finds every `test/*.test.js` file from the package root. **430 tests** as at 2026-08-29, about a second and a half, no network, no data tree, no `Areas/` folder needed. That figure moved six times in a fortnight — 114, 170, 227, 246, 303, 324 — so read it off the run rather than off this line.

## Why these exist

Until 2026-08-25 this package's `test` script was `echo "Error: no test specified" && exit 1`, across 23,462 lines of JavaScript and Python. The `gate.sh` byte gates are real and they are green, but they compare the engine's output against the engine's *own previous* output — they are a regression check, and they cannot tell you the previous output was right. This project has been bitten by exactly that: a verification harness once scored 7/7 on a map whose committed data **was** the bug's output. Every engine fault it has actually had was found by a person looking at a printed sheet.

So each test here is one of those faults, written down as a property. The comment above each one says which. Between them they cover the label placer's collision and `mustPlace` behaviour, the footer's measured wrap and its backing plate, the build-warning severities, the ratchet's arithmetic and its distance-to-target reporting, the text-quad geometry the collision metrics are built from, the engine hash, the byte-gate comparison helpers, and the icon recolouring.

**`seed_prev_s4.test.js` is a unit test because it cannot be a data one** (added 2026-08-29, OA-013). It pins the rule the rollout's dry run and its apply now share, and measured on the day, no map on the estate has an S4 input that differs from its stage copy — so the live tree would have reported the broken rule working just as loudly as the fixed one. Its first draft required `../assets/` directly and **both of its prove-red mutations survived**: a suite that resolves its own path never sees the harness's scratch copy, so it is green about code it never ran. Everything here goes through `_engine.js` for exactly that reason.

## Proving they can fail

A green check that has never been seen to go red proves nothing.

```bash
npm run test:prove-red
```

`tools/prove-red.js` copies `assets/` to a scratch directory, then breaks it on purpose — one deliberate one-line edit per property, each reverted before the next — 175 of them as at 2026-08-29, and again, read the count off the run — and runs the relevant suite against the mutated copy expecting it to **fail**. It prints a table of which test objected to which break, and exits 1 if any mutation SURVIVED. Nothing under `assets/` is touched: every file there is vendored into the portal and compared by `status.js`, so an edit in place would surface as portal drift the next morning.

**A survivor is almost always a hole in the suite — but check that it CAN differ before you write a test for it.** On 2026-08-27 a mutation deleting `badgeStack`'s one-element fast path survived because there was nothing to break: with one member `y0` collapses to `y` and `(n-1)/2*pitch` to zero, so the general loop draws identical bytes at every radius. It is an optimisation, not a branch, and the file's own comments were claiming a fork it does not have. An **equivalent mutant** like that gets replaced with an observable one, with a note in `prove-red.js` saying why it is absent, so nobody re-adds it — and the source comment gets corrected too. Two other survivors in that same run were genuine holes, so the default assumption still holds.

It has already earned its place. On its first run, dropping the file name out of the engine hash survived every assertion in `engine_version.test.js` — the tests checked that the hash moved when a file changed, and never that content could not migrate between two files unnoticed. That test exists now because the mutation run found it missing.

Add `--keep` to leave the scratch copy behind for inspection.

## Proving the BYTE gates can fail — the other half, added 2026-08-27

`prove-red.js` above falsifies the unit suite. It cannot reach the five big generators at all, for the reasons in "What is not covered" below — and those five are exactly what the **byte gate** guards. That gate had never been watched go red for any sheet type: twenty maps all reported PASS, which is the state a real failure has to be spotted through.

```bash
npm run test:prove-red-gates
```

`tools/prove-red-gates.js` runs each generator **unmutated** against a map's tracked `ci-reference/` and requires PASS — the control, because a mutation that "fails" a gate which was already failing proves nothing — then applies one anchored mutation and requires DIFF. Six targets, one per sheet type: internal (town), internal (place, which needs `PLACE_IGNORE`), external, schematic, diagram, boarding. It gates against `ci-reference/` rather than the local `S4-generate` run dir on purpose, because `ci-reference/` is what a fresh CI clone actually has; gating against a run dir that only exists on this laptop would prove the gate works in the one place it is never needed. Nothing under `assets/` is touched — the mutated copy goes to a temp file and is handed to `gate()` by path. It runs in `gates.yml` **ahead of** the `status.js` board, so CI falsifies the gates before trusting them.

Add `--keep` to leave the mutated generators on disk, and `--buses "<path>"` if the data repo is not at `C:\u3a St Ives\Using AI\Buses`.

### The three refactor tools

Not tests, and not run by `npm test`: these answer the questions an EXTRACTION asks, and they are here because the same three were rebuilt from scratch twice before being committed. All three run from `make-bus-leaflet/`, with no placeholders.

| Command | Answers |
|---|---|
| `npm run gate:extraction -- --baseline`, then `npm run gate:extraction` | Did any sheet move? 74 verdicts in **27 seconds**, so it is affordable after *every* extraction rather than at the end. Portal drift is reported and never gated — between an engine change and its re-vendor the portal is meant to differ. |
| `npm run gate:branch-coverage -- tools/<spec>.js` | Which branches of the new module do the committed maps actually take? Instruments a scratch copy and runs every map. `tools/branch-coverage.linear_features.js` is a worked spec whose expected answer is in its header. |
| `npm run gate:dark-paths -- --before <old gen.js>` / `-- --after <gen.js>` / `-- --diff` | Did anything move on the two paths no byte gate reads — an `EDITOR_KEYS=1` render, and stderr? All 18 maps with an internal sheet exercise both. |

**Each of them was watched fail before being trusted, and two were wrong first time.** `extraction-gate.js` let `execFileSync` throw, and `status.js` exits 1 whenever the board is red — so the gate died with a stack trace in exactly the situation it exists for; a deliberate one-character edit to the stadium-badge casing now prints **14 of 74** moved, naming every one. `branch-coverage.js` matched its anchors against the wrong line endings and reported **every** branch dark, which is why it now normalises first and refuses outright if nothing is hit at all. The lesson both times: **falsify the harness, not only the check.**

Their working files — the recorded baseline and the two sweeps — are gitignored on purpose. Each is a snapshot of one machine at one moment, and a committed one would be read as authoritative by the next session and quietly compared against a different engine.
# Proving the S6 CHECKS can still fail — the third harness, added 2026-08-27

The other two falsify code that draws. This one falsifies code that **judges**, and it exists for a different reason from either.

On 2026-08-27 four of `verify_report.js`'s checks were rewritten because they were manufacturing findings that looked like defects and were not — across the stored runs the estate went from 34 HARD findings to 12. That is only good news if the checks can still find a real fault, and **the failure mode of fixing a noisy check is a check that no longer says anything at all, which looks exactly like success**: in both cases the report gets shorter. Neither of the other harnesses can see any of this. `prove-red.js` cannot require `verify_report.js` — it is a top-to-bottom script that reads a run directory and exits, the same reason the five generators are out of reach — and `prove-red-gates.js` compares drawn bytes, which a verification check never touches.

```bash
npm run test:prove-s6
```

`tools/prove-s6-checks.js` builds a run directory from real map data, optionally mutates **one input**, runs `verify_report.js` there, and asserts on the resulting `verification.json`. **Every case is a pair**: the artefact must be quiet, *and* a genuine fault of the same kind must still be found. So the direction check must stay silent on a one-buffer-stop route **and** still go HARD on a route reversed on purpose; a truncated chain must be SOFT **and** the identical data must go HARD once the chain is extended one stop past the town boundary; an exclusion naming a different operator must be ignored **and** the same exclusion carrying our own operator must block. 22 assertions in all, and **12 of them go red against the pre-fix engine** — which is what establishes that the assertions are load-bearing rather than decorative.

**It seeds from the tracked S1/S2/S3 runs plus `redteam.json`, never from an S6 run folder.** Copying a stored S6 run is shorter and was the first attempt, but `S4/S5/S6` folders are gitignored: `git ls-files` over one returns `README.md`, `verification.docx` and (since 2026-08-27) `redteam.json`, and nothing else. A harness written that way runs only on the laptop that already has the data. Seeding from the tracked stages is also what a real S6 does — `stage.js pull S1 S2 S3` — and for a place it runs `place_verified_services.js` from the sibling skill first, exactly as the documented place procedure does.

**Because it seeds from `latest`, the inputs can move under the fixtures, and that is deliberate.** Every case that depends on a property of the data asserts that property and throws `fixture assumption broken` rather than quietly passing over data that no longer exhibits the thing being proved. That guard has already earned itself twice: once when route 303's chain ends turned out to span too widely for a reflection to express a reversal, and once when St Neots Town Centre's route 66 stopped being a HARD **because the data had been fixed** — the place gained curated `destinations[]`. Asserting the historic finding would have left this harness a monument to a resolved defect; it now proves the check can be *made* to fire instead.

Add `--keep` to leave the temp directories on disk, and `--buses "<path>"` if the data repo is elsewhere. It runs in `gates.yml` alongside the other two, ahead of the board.

## Prove the build-warning severities can go red

The three harnesses above falsify code that draws and code that judges a finished run. This one falsifies the thing that decides whether a build may **ship at all** — `build_log.js`, which sorts every generator message into WARN or BLOCKING and which `rollout.js` and `rollout_places.js` stop on.

```bash
npm run test:prove-red-build-log
```

`tools/prove-red-build-log.js` breaks each of the nine severity rules on purpose and requires the break to be caught. **Every case carries a NEAR-MISS** — a message that looks like the one being caught and must stay WARN — because a rule that fires on everything is as useless as one that fires on nothing, and only the near-miss separates them. It then replays the nine messages a real build writes every day and requires all nine to stay WARN, and it asserts its own case COUNT, because a harness that has quietly stopped running some of its cases reports a clean sweep either way. It needs no other repository, so it runs in CI as its own step and a cross-repo checkout failure cannot take it down.

It was written on 2026-08-28 with OA-065, which promoted "a mapNotes entry ends inside the footer plate" from WARN to BLOCKING. **Promoting a warning needs both halves**: that it starts green on the real corpus — a sweep of all 20 committed maps, 52 generator runs, zero footer-plate messages of any wording — *and* that it can still go red. The OVERFLOWED rule was watched go red by deleting the new phrase and green by restoring it.

Two things the sweep found beside the row it was run for, and both are the kind that only a sweep finds. A generator that **died** classified as WARN, the mildest verdict the module has, for the one outcome where no sheet exists at all: `severity()` is a text rule, and an uncaught exception is not phrased like a guard. "No message matched" and "no message at all" are the same thing to a matcher. The remedy was not another phrase but a fact no text rule can reach — the process exit status, which the callers already had and were discarding; `collect()` takes `ok` and all 18 run records in the two rollouts now pass it. And a message prefix carrying an underscore (`gen_internal_place:`) was not recognised as a message head at all.

## Prove the lane-mirror measure can tell the two renders apart

```bash
node tools/prove-lane-mirror.js
```

Not a mutation harness. The question OA-118 asked was never "can something be counted" but "would anything notice if a future engine change put the lane mirrors back", so this renders every internal sheet **twice** — as shipped, and with `design.laneOrientation:false`, which is exactly the pre-2026-08-26 behaviour — and asks whether anything separates them.

**It reports three states, not two.** A sheet whose two renders are byte-identical has nothing to see, and scoring that as blindness would libel the measure — *absent is not different*. As at 2026-08-28, on `laneCrossings`: 18 sheets, 15 of which the flip moves, and the measure separates 11 of them. Re-run it rather than quoting it.

**And read what a green here does NOT mean, because this harness has already been green over a wrong measure.** It was written alongside a `laneMirrors` field that was **withdrawn the same day**, once somebody rendered the one site it named and looked: on High Wycombe internal the pre-fix sheet has a textbook mirror — two ribbons swapping sides at a constant 2.9 mm gap — that the measure scored ZERO, because that swap happens as a jump between vertices and a crossing-based test cannot see a mirror that does not cross; and the post-fix sheet, which keeps its lane order the whole way, was the one it flagged. Wrong in both directions at one site, and this harness stayed green throughout. **"The two renders differ" and "the measure is correct" are different claims, and a two-run comparison only tests the first.**

## Prove the route-number collision guard can go red — the sixth harness, and the first in Python, added 2026-08-28

```bash
npm run test:prove-red-route-collision
```

Run from `C:\u3a St Ives\.claude\skills\make-bus-leaflet`; the npm script wraps `python tools/prove-red-route-collision.py` and takes no arguments.

**A route NUMBER is not an identity, and indexing on one is an index AND a silent de-duplication that nothing distinguishes afterwards.** Wisbech runs two route 46s — Stagecoach East to March and Lynx to King's Lynn — so `{s["route"]: s for s in services}` turned eleven shipped services into ten entries. Measured on 2026-08-28: the monthly change scan had been diffing the *Lynx* 46 against BODS every month and had **never once checked the Stagecoach East one**. Nothing threw, nothing was missing, every route appeared exactly once, and the report looked complete — which is the whole difficulty. `verify_report.js` had the identical fault and was fixed on 2026-08-27; this harness exists because the fix needed to be shown to be a fix.

**Each case is a pair — quiet on right data, loud on a fault of the same kind — and one case runs the OLD code deliberately.** `run_pre_fix()` is the pre-2026-08-28 one-winner-per-number logic, kept in the harness rather than deleted with the bug, and the assertion is that it stays **SILENT** on the mutant the current code catches. Without it, "the tests pass" is a statement about today's code agreeing with itself. It also carries an **inertness** case: a town with no colliding number must produce a byte-identical answer either way, so a difference in a real report can never be blamed on the fix in general.

**It found a second fault while being written.** Case 5 shrinks one operator's week in BODS. The old code compared the shipped days against the *folded union* of both 46s, which still spanned Mon–Sat, so a withdrawal of Saturday service by one of two same-numbered operators was invisible — a second silent hole underneath the first, and one nobody had suspected. `fold_gtfs` now keeps per-operator day flags and the check narrows to them whenever a number carries more than one shipped entry.

**It is the first harness here to run Python, and it needed no dataset to do it.** `gtfs_refresh_report.py`'s real input is a 139 MB sqlite that is in no repository, so the obvious harness would have run only on this laptop — a harness as local as its subject. BODS is stubbed with three synthetic services instead and the shipped list is three dicts, which is enough to carry the collision. `ubuntu-latest` already has `python3`, so the CI step needs no `setup-python`. It runs in **both** workflows: as its own step in `claude-skills`, where it needs no cross-repo checkout, and ahead of the unit tests in `buses-data`.

**Its exit code was checked in both directions before it was trusted.** Breaking the fix on purpose makes it print two FAILs and exit 1; restoring it makes it exit 0. A harness whose verdict is computed and then discarded is a harness that is always green — see [[feedback_the_verdict_was_computed_and_discarded]].

The guard itself is `assets/index_guard.js` / `assets/index_guard.py`, unit-tested in `index_guard.test.js`. The cheap form — `assertNoCollision(map, list, what)`, one line, asserting the map's size equals the list's length — is the only thing that tells "indexed" from "silently deduplicated", and it belongs wherever an index is built from a list. The `key` field the data carries (`46`, `46L`) is **not** the protection: measured 2026-08-28, `key` is present on 4 of 8 towns and 0 of 12 places, so on most of the estate `serviceKey()` returns the route number and the behaviour is exactly what it was. See OA-134.

## Prove the ATTRIBUTION gate can go red — added 2026-08-28

```bash
npm run test:prove-red-attribution
```

`tools/prove-red-attribution.js` breaks `tools/attribution-gate.js` once per question that gate claims to answer, which is four: a generator that reads an OSM input and does not credit it (the source half); a shipped `ci-reference` sheet whose SVG has lost the credit its generator still carries (the artefact half — the 2026-08-25 fault as it actually happened, with a correct source and wrong artwork); a committed sheet kind no generator in the gate's table claims to draw (coverage); and an extraction anchor that no longer matches (the gate's own eyesight). That last one matters most: the source half locates each notes block by a text anchor, and a naive implementation whose anchor stops matching finds no credit and no inputs and reports "ok" — **a checker whose failure mode is a pass is worse than no checker.** Nothing under `assets/` or in the Buses repo is touched; the five generators are copied into a temp dir and the gate is pointed at them with `--assets` / `--place-assets`.

## Prove the STATUS BOARD can go red — added 2026-08-28

```bash
npm run test:prove-red-status
```

`tools/prove-red-status.js` falsifies `status.js`'s own exit code rather than any generator. Five cases: an unmutated control; a town stamped with a hash that is not current, which is the gate OA-151 added after it had been computed, printed and dropped for as long as the hash existed; the dated Ramsey exception excusing its own town-and-hash pair; the same exception ceasing to apply the moment the hash changes; and OA-057's completeness column staying green while a place is short of every key. Each case builds a one-town scratch Buses tree from a tracked `ci-reference/` in the temp dir — the form CI actually gates against — so nothing under `Areas/` or `Places/` is touched.

## The rule both of those harnesses are built on: assert the CAUSE, not the colour

**"It went red" and "it went red for this reason" are different claims, and only the second is one a mutation test is entitled to make.** Four of the attribution harness's five cases would have gone red together if the gate merely threw at startup, and a colour-only harness would have scored all four as catches — a confident green about a gate that had stopped working entirely. Both harnesses therefore read the run's output: the board prints its JSON *before* setting the exit code, so a red run is still parseable and the specific town can be checked; the gate's message is matched by regex. Both report a third verdict, `RED, WRONG CAUSE`, distinct from `caught` and `SURVIVED`. It is the same fault the withdrawn lane-mirror detector shipped with — green on a two-run comparison while the field it reported was backwards.

**And the mirror of it on the GREEN side: a case whose subject the run never found is green too.** OA-057's contract case says a place short of every completeness key must not turn the board red — which a board that never enumerated the place satisfies perfectly, and an enumeration silently walking past a map is this repository's most-repeated bug. The case carries an `also` assertion naming what the run must have SEEN: the place present, judged short of all four keys, exit 0 anyway. It was watched report `VACUOUS` with the place removed from the scratch tree.

## Two rules the 2026-08-28 round taught, which apply to every suite here

**A fixture rejected by the wrong rule certifies nothing.** The test written to prove that a *fork* is not a lane mirror passed from the day it was written — and it was passing because a minimum-separation floor rejected the fixture, not because the symmetry test it was written for did. The symmetry test never ran on any fixture at all. Nothing in a green suite can show that; what showed it was a mutation that **deleted the symmetry test and changed no verdict**. The underlying fault was in the measure, not the test: the comparison window was 6 mm and the thing it compares across is tens of millimetres wide, so the probe stopped short of its own discriminator. Size a window from the phenomenon, then print the intermediate values and check the near-miss is rejected for the reason you think.

**Aim a mutation at a term where the two rules actually differ.** The mutation for "a stadium badge is measured as a disc again" was first pointed at the *x* term — and a stadium's `rx` **is** its `max(rx, ry)`, so both rules agree exactly along x and the mutation was a no-op that survived looking like a hole in the suite. It only bites on the *y* term. A surviving mutation is a claim about the suite; check it is not a claim about the mutation.

**A harness that compares two runs cannot tell you either run is right.** `prove-lane-mirror.js` was green on every sheet while the field it was reporting was backwards. Only the artwork settles a question about the artwork — which is what this project has said since the legend-burying finding and the fixed exit device, and it has now been true a third time. Before trusting a new visual measure, render the ONE site it names, at 300 dpi, and look at it. It cost half an hour and it overturned a day's number.

**When a measure is disproved, remove the field — do not soften the name.** `laneMirrors` is gone rather than renamed, and there is an assertion in `quality_metrics_ink.test.js` that the key is absent, so it cannot drift back without somebody deleting a test that explains why. `laneCrossings` stays, because two ribbons crossing at a shallow angle is exactly what that geometry measures and it was never the thing in doubt.

**And the general one, again.** The 15 assertions written for the two new measures passed 15/15 on their first run, and the mutation run then found **three** real holes in them. A new suite asserts what its author believed.

**It found two faults on its first run, both in `status.js`, and neither was in the mutation table.** They came from reading the gate closely enough to write the harness:

- The derived-sheet rows guarded on `routesJson.internalSchematic && exists(<sheet>.svg)`. So a map whose config **asks** for a schematic and whose SVG had gone printed `-`, the same benign dash as a map that never had one. That is the precise trap `judgeNoSheet()` was written for on internal/external/boarding, still open on the other two sheet types.
- Worse: `r.schematic` and `r.diagram` appeared **nowhere** in the `bad` set that computes the exit code. Both columns were computed, printed, and then discarded — a town whose schematic came back DIFF showed DIFF on the board and exited 0, so CI passed. Eight towns draw a schematic and four draw a diagram, so twelve sheet-gates had been decorative for their whole lives.

Both are fixed and both were proven to fire by deleting a real schematic from a scratch copy of Huntingdon and watching the row go `-` → `MISSING` and the exit code go 0 → 1. Both start green on the real estate, so nothing changed colour and nobody learns to ignore a red.

## Adding a test

Load the module through `test/_engine.js`, not with a direct `require('../assets/…')`:

```js
const { Labeller } = require('./_engine.js').load('labeller.js');
```

That indirection is what lets `prove-red.js` point a suite at a mutated copy via the `ENGINE_DIR` environment variable. Unset — which is how `npm test` and CI run — it resolves to the real `assets/`.

Then add a mutation for it to the `MUTATIONS` table in `tools/prove-red.js`: the file, the exact text to replace, what to replace it with, and the suite that should object. The runner checks that the text it is replacing appears **exactly once**, so an anchor that has drifted from the engine is reported as stale rather than silently doing nothing.

## What is not covered, and why

**This section is shrinking, and by design.** Under OA-129 Phase 3 (see `references/changing-the-engine.md`) **eleven modules have been carved out of `gen_internal.js`** and every one is requireable, unit-tested and vendored: `strict_guards.js`, `poi_select.js`, `fit_set.js`, `projection.js`, `svg_primitives.js`, `linear_features.js`, `label_placer.js`, `services_panel.js`, `complexity_ladder.js`, `north_arrow.js` and `feature_labels.js`. The generator is **2,550 lines**, down from 3,933 when the phase began — a 35% cut — and the named blocks are all out. What is left inside it is the main draw.

The five biggest generators — `gen_internal.js` (2,550 lines), `gen_boarding.js`, `gen_external_radial.js`, `diagram_internal.js`, `gen_external_places.js` — are top-to-bottom scripts. They read their inputs and exit at load, so nothing in them can be required, and their pure helpers cannot be reached without extracting them into modules first. That extraction is a real refactor with a real blast radius: **eighteen** files are now inside the engine hash (it follows the requires rather than naming five by hand, as of 2026-08-27), and **twenty-five** in this folder are vendored into the portal and compared file-by-file by the drift table in `status.js`. Changing any of them means re-vendoring the portal in the same change.

So the faults that live inside those scripts are **not** tested here yet, and they include some of the best-documented ones:

- the boarding sheet's destination-column overflow, which computed `dests.length - COLS * perCol` — zero for every possible input — while the correct quantity sat unused on the line above;
- the bay-marker collision map, built from the bay markers themselves, so it could never ask whether two bay numbers had landed on each other;
- `pick_route_colour.js`'s rule that a replacement hue is scored on its **worst** separation against every other colour on the sheet, not its distance from the colour being replaced.

The Python half is thinner than it was: `tools/prove-red-route-collision.py` (2026-08-28) is a real Python runner and it covers `gtfs_refresh_report.py`'s matching logic. It stubs BODS rather than reading a dataset, which is the pattern any further Python test here should copy. What is still untested is `boarding_index.py`'s locality rollup and `naptan_stands.py`'s uniqueness test.

**The first one landed on 2026-08-26, by a different route than expected.** `lane_normals.js` is not an extraction — nothing was carved out of `gen_internal.js`. It is NEW code, written as a module from the start because the fault it repairs (the lane-bundle mirror behind `design.laneOrientation`) needed a design that could be argued with, and three designs were tried and measured before the right one was found. Its suite is fourteen assertions and six mutations, and four of those mutations are the failed designs: filtering chain edges by angle, letting a chain edge close a cycle, dropping the anchor, losing the `Math.abs`. A suite that survived them would have let the wrong fix through, and one of them DID survive the first draft of the suite — the anchoring test could not fail, because with only two segments the union-find root IS the lowest-index segment.

**And on 2026-08-27 that module's unit tests proved the point in the other direction.** `lane_normals.test.js` exercised `orientSegments(segs, lateral, chain)` with chain pairs in the third argument, which is the module's documented contract — while the only real caller, `gen_internal.js`, concatenated them into the second and passed `[]` as the third. Twelve green assertions over the interface nobody used. Nothing was wrong with the drawn output, but the conflict count the module reports was a mixture of two populations, which made it useless as the basis for a build warning and was only found by going to write that warning. **A unit test proves the module; only a caller proves the wiring.** See [[feedback_assert_through_the_real_interface]].

So the cheaper route into that boundary is: when a generator fault needs new logic, write the new logic as a module rather than as more lines in the script. The re-vendor is owed either way, and this way the fault arrives with a test.

**And once a module exists, do not test it evenly — measure which branches the committed maps actually take, and test the zeroes and the ones.** `npm run gate:branch-coverage -- tools/<spec>.js` instruments a scratch copy of the engine and runs every map; where every map takes a branch, the byte gate already covers it and a unit test only repeats it. Done that way the suites here are deliberately lopsided: `services_panel.test.js` is nineteen assertions aimed almost entirely at branches **no map draws**, including `design.panelCols`, a whole Services-panel layout, and the entire `design.panelScale` opt-out; `feature_labels.test.js` is twenty-one aimed mostly at four guards whose every fault path is dark, because each guard was written after a shipped sheet went wrong and a fixed board trips nothing. The inventory of what is dark no longer lives in a backlog row: since OA-136 closed on 2026-08-27, every dark path is noted **at its own site in the engine**, marked `DARK, measured`, so `grep -rn "DARK, measured" assets/` is the register. One item was retired — `cross()` in `svg_primitives.js`, which had no caller anywhere — and the rest are kept as live features a config key selects. The specs that measured them are `tools/branch-coverage.*.js`, one per extracted module; re-run the spec rather than trusting a number, and remember a zero means "no map in the run that was done took it".

**And read a zero twice before believing it.** Dark means "no map in THIS RUN took it", and the run is a choice. `north_arrow.js`'s `angle` branch reported zero and is taken by twelve committed sheets — the probe renders `internal.svg` only, and the schematic and diagram generators inject that key before re-running the generator. Separately, three of `feature_labels.js`'s guard marks were first anchored on the NEXT guard's `if`, i.e. after the `return` they were meant to observe, so those rows could not have been anything but zero. Both look exactly like a finished answer.

Extracting helpers from the generators, one at a time, each with its test and its re-vendor, is the next step. It is logged in `Development Docs/open-actions.md` rather than left in this file.

## A mutation can stop breaking the verdict and start breaking only the report

On 2026-08-28 the badge-overlap rule was made exact, and the per-axis figures `ox`/`oy` stopped deciding anything — they are now what the detail line PRINTS and nothing else. The mutation that had guarded them, "a stadium badge is measured as a disc again", promptly **survived**: the edit still corrupts the numbers a reader sees and no test read them. The temptation is to retire it as an equivalent mutant. It is not one: a report that quietly overstates how badly two marks clash is how the first cut of that measure got believed for a day. The suite now asserts the printed pair on a stadium fixture, and the mutation is caught again. **When a refactor moves a value from the verdict into the report, the mutation aimed at it does not become redundant — it changes what it is testing, and the suite has to follow.**

## Four mutations here defend a DECISION rather than an algorithm

`badgeOverBadge` and `lozengeOverlap` are scored; `labelsOverBadge` is not, because it still stands at 47 and a check that is red on the day it lands gets muted within the week. That is a rule about sequencing, and the two ways to break it are both one-line edits nobody would query in review: quietly unscore one that was folded in, or fold in one that is still red. So `prove-red.js` carries a mutation for each, plus one for charging a `null` sheet a defect it could not measure. **A convention that only exists in a comment is not defended by anything.**

## Prove the REDTEAM-SOURCE ambiguity guard can go red — added 2026-08-29

```bash
npm run test:prove-red-redteam-source
```

`tools/prove-red-redteam-source.js` cuts both OA-141 changes out of a copy of `assets/redteam_source.js` and runs `test/redteam_source.test.js` against it, requiring four guard tests to fail while the two named CONTROL tests hold. The subject is the tool that decides whether an S6 run must **buy** a blind red team — 89k–137k tokens a time — so a refusal that fired on the documented invocation would cost one rather than save one, which is what the CONTROLs are watching for. What the cut restores is the code as it stood on 2026-08-25, when it printed `redteam_source — Beaconsfield` for a place called Beaconsfield Waitrose, answered REUSE, copied the town's answer into the place's folder, and said nothing about any of it. It needs no other repository, so it runs in the `unit` job rather than behind the cross-repo checkout.

## `node --test` speaks TWO formats, and three harnesses here only read one — fixed 2026-08-29

The harness above **failed on its very first CI run, on a completely correct result.** It had done its job — `# pass 2 / # fail 4`, the two CONTROLs green and the four guard tests red — and its PARSER read zero tests out of that, because `node --test` defaults to the `spec` reporter (`✔`/`✖` plus a duration) from Node 22 and to `tap` before it. This laptop runs Node 24; the CI runner is pinned to Node 20.

`prove-red-stage-commit.js` and `prove-red.js` carried the same spec-only parser and the same latent failure, unnoticed because neither has ever run anywhere but a Windows laptop — the harnesses themselves in the shape they exist to catch, [[feedback_a_harness_as_local_as_its_subject]]. All three now pin `--test-reporter=spec` **and** parse either format, proved by running the new harness under each reporter in turn.

**The count assertion is what caught it.** A parser that reads nothing produces a tidy "0 controls, 0 guards", which a verdict alone would have called green. Every harness here that parses another tool's output should assert how many results it found, not only what they said.

## The `unit` CI job — added 2026-08-29

`node --test` had **never run in CI at all**: 30 test files and 423 assertions whose only evidence of passing was somebody remembering to run them on the machine they were written on. They now run in a `unit` job in `gates.yml`, alongside the three falsification harnesses that need no dataset and no built map (`prove-red-build-log`, `prove-red-route-collision`, `prove-red-redteam-source`). It is a **separate job** with no secrets and no cross-repo checkout, for the same reason `buses-data` split out its `docs` job: `CROSS_REPO_PAT2` expires on 22 November 2026, and an expiry should not take 423 tests down with the byte gates.

## Prove the S4 provenance-stamp guard can go red — added 2026-08-29

```bash
npm run test:prove-red-stage-stamps
```

`tools/prove-red-stage-stamps.js` cuts the OA-161 guard out of a copy of `assets/stage.js` and runs `test/stage_stamps.test.js` against it, requiring the **seven** guard tests to fail while the **four** named CONTROL tests hold — an ordinary stamped commit, a non-S4 stage, and the two `stage.js stamps` cases the refusal points at. The subject is the check that stops an S4 committing with no `engine` hash and no `design.sheetVersion`, which the byte gate is structurally incapable of noticing: `ci-reference/` is seeded from the same run the gate reproduces, so both sides come from the same unstamped inputs and agree exactly. It needs no other repository, so it runs in the `unit` job. `prove-red-stage-commit.js` now runs there too, having never run in CI at all.

## A harness that COPIES its subject also tests the copy — found 2026-08-29

Both stage harnesses used to write their broken copy into a temp folder. That worked for as long as `stage.js` had no relative `require`s, and stopped working the moment it gained two (`./sheet_stamps`, `./engine_version`): the copy died in the module loader before `main()` ran, and **all eight tests went red, controls included**. Every case failing is exactly what a falsification harness hopes to see, so the only thing that distinguished *the guard works* from *the file does not load* was the assertion that the CONTROLs must stay green.

Both now write the copy into `assets/` beside its dependencies, under a dotted name, and delete it on `exit`. **The trigger is invisible and routine: adding a `require` to a CLI breaks every harness that relocates it.** After adding one, run the harnesses that copy it. Two more here copy a single file — `prove-red-derive-frequency.js` and `prove-red-redteam-source.js` — and both subjects have no relative requires today, which is the only reason they still work.
