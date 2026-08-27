# The engine's unit tests

Run them from `C:\u3a St Ives\.claude\skills\make-bus-leaflet` (or wherever this skill is checked out — every command on this page is run from that folder, and none of them takes a parameter):

```bash
npm test
```

That is `node --test`, which finds every `test/*.test.js` file from the package root. **123 tests** as at 2026-08-27, about a second, no network, no data tree, no `Areas/` folder needed.

## Why these exist

Until 2026-08-25 this package's `test` script was `echo "Error: no test specified" && exit 1`, across 23,462 lines of JavaScript and Python. The `gate.sh` byte gates are real and they are green, but they compare the engine's output against the engine's *own previous* output — they are a regression check, and they cannot tell you the previous output was right. This project has been bitten by exactly that: a verification harness once scored 7/7 on a map whose committed data **was** the bug's output. Every engine fault it has actually had was found by a person looking at a printed sheet.

So each test here is one of those faults, written down as a property. The comment above each one says which. Between them they cover the label placer's collision and `mustPlace` behaviour, the footer's measured wrap and its backing plate, the build-warning severities, the ratchet's arithmetic and its distance-to-target reporting, the text-quad geometry the collision metrics are built from, the engine hash, the byte-gate comparison helpers, and the icon recolouring.

## Proving they can fail

A green check that has never been seen to go red proves nothing.

```bash
npm run test:prove-red
```

`tools/prove-red.js` copies `assets/` to a scratch directory, then breaks it on purpose — twenty-five deliberate one-line edits, one per property, each reverted before the next — and runs the relevant suite against the mutated copy expecting it to **fail**. It prints a table of which test objected to which break, and exits 1 if any mutation SURVIVED. Nothing under `assets/` is touched: every file there is vendored into the portal and compared by `status.js`, so an edit in place would surface as portal drift the next morning.

It has already earned its place. On its first run, dropping the file name out of the engine hash survived every assertion in `engine_version.test.js` — the tests checked that the hash moved when a file changed, and never that content could not migrate between two files unnoticed. That test exists now because the mutation run found it missing.

Add `--keep` to leave the scratch copy behind for inspection.

## Proving the BYTE gates can fail — the other half, added 2026-08-27

`prove-red.js` above falsifies the unit suite. It cannot reach the five big generators at all, for the reasons in "What is not covered" below — and those five are exactly what the **byte gate** guards. That gate had never been watched go red for any sheet type: twenty maps all reported PASS, which is the state a real failure has to be spotted through.

```bash
npm run test:prove-red-gates
```

`tools/prove-red-gates.js` runs each generator **unmutated** against a map's tracked `ci-reference/` and requires PASS — the control, because a mutation that "fails" a gate which was already failing proves nothing — then applies one anchored mutation and requires DIFF. Six targets, one per sheet type: internal (town), internal (place, which needs `PLACE_IGNORE`), external, schematic, diagram, boarding. It gates against `ci-reference/` rather than the local `S4-generate` run dir on purpose, because `ci-reference/` is what a fresh CI clone actually has; gating against a run dir that only exists on this laptop would prove the gate works in the one place it is never needed. Nothing under `assets/` is touched — the mutated copy goes to a temp file and is handed to `gate()` by path. It runs in `gates.yml` **ahead of** the `status.js` board, so CI falsifies the gates before trusting them.

Add `--keep` to leave the mutated generators on disk, and `--buses "<path>"` if the data repo is not at `C:\u3a St Ives\Using AI\Buses`.

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

The five biggest generators — `gen_internal.js` (3,846 lines), `gen_boarding.js`, `gen_external_radial.js`, `diagram_internal.js`, `gen_external_places.js` — are top-to-bottom scripts. They read their inputs and exit at load, so nothing in them can be required, and their pure helpers cannot be reached without extracting them into modules first. That extraction is a real refactor with a real blast radius: `gen_internal.js`, `gen_external_radial.js`, `gen_external_busway.js` and `icons.js` are the four files the engine hash covers, and eleven files in this folder are vendored into the portal and compared file-by-file by the drift table in `status.js`. Changing any of them means re-vendoring the portal in the same change.

So the faults that live inside those scripts are **not** tested here yet, and they include some of the best-documented ones:

- the boarding sheet's destination-column overflow, which computed `dests.length - COLS * perCol` — zero for every possible input — while the correct quantity sat unused on the line above;
- the bay-marker collision map, built from the bay markers themselves, so it could never ask whether two bay numbers had landed on each other;
- `pick_route_colour.js`'s rule that a replacement hue is scored on its **worst** separation against every other colour on the sheet, not its distance from the colour being replaced.

The Python half — `boarding_index.py`'s locality rollup, `naptan_stands.py`'s uniqueness test — is untested here for the same reason and would need its own runner.

**The first one landed on 2026-08-26, by a different route than expected.** `lane_normals.js` is not an extraction — nothing was carved out of `gen_internal.js`. It is NEW code, written as a module from the start because the fault it repairs (the lane-bundle mirror behind `design.laneOrientation`) needed a design that could be argued with, and three designs were tried and measured before the right one was found. Its suite is fourteen assertions and six mutations, and four of those mutations are the failed designs: filtering chain edges by angle, letting a chain edge close a cycle, dropping the anchor, losing the `Math.abs`. A suite that survived them would have let the wrong fix through, and one of them DID survive the first draft of the suite — the anchoring test could not fail, because with only two segments the union-find root IS the lowest-index segment.

**And on 2026-08-27 that module's unit tests proved the point in the other direction.** `lane_normals.test.js` exercised `orientSegments(segs, lateral, chain)` with chain pairs in the third argument, which is the module's documented contract — while the only real caller, `gen_internal.js`, concatenated them into the second and passed `[]` as the third. Twelve green assertions over the interface nobody used. Nothing was wrong with the drawn output, but the conflict count the module reports was a mixture of two populations, which made it useless as the basis for a build warning and was only found by going to write that warning. **A unit test proves the module; only a caller proves the wiring.** See [[feedback_assert_through_the_real_interface]].

So the cheaper route into that boundary is: when a generator fault needs new logic, write the new logic as a module rather than as more lines in the script. The re-vendor is owed either way, and this way the fault arrives with a test.

Extracting helpers from the generators, one at a time, each with its test and its re-vendor, is the next step. It is logged in `Development Docs/open-actions.md` rather than left in this file.
