# The engine's unit tests

Run them from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` (or wherever this skill is checked out — every command on this page is run from that folder, and none of them takes a parameter):

```bash
npm test
```

That is `node --test`, which finds every `test/*.test.js` file from the package root. **324 tests** as at 2026-08-27, about a second and a half, no network, no data tree, no `Areas/` folder needed. That figure moved six times in a fortnight — 114, 170, 227, 246, 303, 324 — so read it off the run rather than off this line.

## Why these exist

Until 2026-08-25 this package's `test` script was `echo "Error: no test specified" && exit 1`, across 23,462 lines of JavaScript and Python. The `gate.sh` byte gates are real and they are green, but they compare the engine's output against the engine's *own previous* output — they are a regression check, and they cannot tell you the previous output was right. This project has been bitten by exactly that: a verification harness once scored 7/7 on a map whose committed data **was** the bug's output. Every engine fault it has actually had was found by a person looking at a printed sheet.

So each test here is one of those faults, written down as a property. The comment above each one says which. Between them they cover the label placer's collision and `mustPlace` behaviour, the footer's measured wrap and its backing plate, the build-warning severities, the ratchet's arithmetic and its distance-to-target reporting, the text-quad geometry the collision metrics are built from, the engine hash, the byte-gate comparison helpers, and the icon recolouring.

## Proving they can fail

A green check that has never been seen to go red proves nothing.

```bash
npm run test:prove-red
```

`tools/prove-red.js` copies `assets/` to a scratch directory, then breaks it on purpose — one deliberate one-line edit per property, each reverted before the next — 143 of them as at 2026-08-27, and again, read the count off the run — and runs the relevant suite against the mutated copy expecting it to **fail**. It prints a table of which test objected to which break, and exits 1 if any mutation SURVIVED. Nothing under `assets/` is touched: every file there is vendored into the portal and compared by `status.js`, so an edit in place would surface as portal drift the next morning.

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

The Python half — `boarding_index.py`'s locality rollup, `naptan_stands.py`'s uniqueness test — is untested here for the same reason and would need its own runner.

**The first one landed on 2026-08-26, by a different route than expected.** `lane_normals.js` is not an extraction — nothing was carved out of `gen_internal.js`. It is NEW code, written as a module from the start because the fault it repairs (the lane-bundle mirror behind `design.laneOrientation`) needed a design that could be argued with, and three designs were tried and measured before the right one was found. Its suite is fourteen assertions and six mutations, and four of those mutations are the failed designs: filtering chain edges by angle, letting a chain edge close a cycle, dropping the anchor, losing the `Math.abs`. A suite that survived them would have let the wrong fix through, and one of them DID survive the first draft of the suite — the anchoring test could not fail, because with only two segments the union-find root IS the lowest-index segment.

**And on 2026-08-27 that module's unit tests proved the point in the other direction.** `lane_normals.test.js` exercised `orientSegments(segs, lateral, chain)` with chain pairs in the third argument, which is the module's documented contract — while the only real caller, `gen_internal.js`, concatenated them into the second and passed `[]` as the third. Twelve green assertions over the interface nobody used. Nothing was wrong with the drawn output, but the conflict count the module reports was a mixture of two populations, which made it useless as the basis for a build warning and was only found by going to write that warning. **A unit test proves the module; only a caller proves the wiring.** See [[feedback_assert_through_the_real_interface]].

So the cheaper route into that boundary is: when a generator fault needs new logic, write the new logic as a module rather than as more lines in the script. The re-vendor is owed either way, and this way the fault arrives with a test.

**And once a module exists, do not test it evenly — measure which branches the committed maps actually take, and test the zeroes and the ones.** `npm run gate:branch-coverage -- tools/<spec>.js` instruments a scratch copy of the engine and runs every map; where every map takes a branch, the byte gate already covers it and a unit test only repeats it. Done that way the suites here are deliberately lopsided: `services_panel.test.js` is nineteen assertions aimed almost entirely at branches **no map draws**, including `design.panelCols`, a whole Services-panel layout, and the entire `design.panelScale` opt-out; `feature_labels.test.js` is twenty-one aimed mostly at four guards whose every fault path is dark, because each guard was written after a shipped sheet went wrong and a fixed board trips nothing. The inventory of what is dark no longer lives in a backlog row: since OA-136 closed on 2026-08-27, every dark path is noted **at its own site in the engine**, marked `DARK, measured`, so `grep -rn "DARK, measured" assets/` is the register. One item was retired — `cross()` in `svg_primitives.js`, which had no caller anywhere — and the rest are kept as live features a config key selects. The specs that measured them are `tools/branch-coverage.*.js`, one per extracted module; re-run the spec rather than trusting a number, and remember a zero means "no map in the run that was done took it".

**And read a zero twice before believing it.** Dark means "no map in THIS RUN took it", and the run is a choice. `north_arrow.js`'s `angle` branch reported zero and is taken by twelve committed sheets — the probe renders `internal.svg` only, and the schematic and diagram generators inject that key before re-running the generator. Separately, three of `feature_labels.js`'s guard marks were first anchored on the NEXT guard's `if`, i.e. after the `return` they were meant to observe, so those rows could not have been anything but zero. Both look exactly like a finished answer.

Extracting helpers from the generators, one at a time, each with its test and its re-vendor, is the next step. It is logged in `Development Docs/open-actions.md` rather than left in this file.
