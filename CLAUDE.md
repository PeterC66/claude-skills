# claude-skills — what a session needs to know before touching this repo

This repository holds the skills. `make-bus-leaflet/assets/` **is the bus-map engine** — every generator, gate and helper that draws a sheet. The data those generators run on is not here; it is in `C:\u3a St Ives\Using AI\Buses` (repo `buses-data`), and the live site that also runs this engine is `C:\Claude\community-bus-maps` (repo `community-bus-maps`).

## The one rule that catches people out

**A generator change is not done when the gate passes. It is done when the portal has been re-vendored.**

Files under `make-bus-leaflet/assets/` and `make-place-bus-leaflet/assets/` exist as byte-for-byte copies in the portal's `engine/`, listed in `community-bus-maps/engine/vendored.json` with a CRLF-normalised SHA-256 each — **the manifest is the count, and this sentence deliberately no longer holds a number.** The skills-side list once said eleven while the tree held sixteen, and one of the five nobody was watching had been stale for four days; this sentence then said "Thirty" on the day it became thirty-one. Edit one here and the portal keeps running the old code until someone copies it across. `status.js` reports the drift; the portal's own `scripts/check-vendored.mjs` reports it from the other side.

Three traps inside that rule, all already paid for:

- **Compare the way the checker compares.** `vendored.json` hashes CRLF-normalised bytes on purpose, so a working tree under `core.autocrlf=true` does not read as wholly drifted. A plain `md5sum` will tell you a file has drifted when only its line endings differ. Use `node scripts/check-vendored.mjs` from the portal root, or `tr -d '\r' | sha256sum`.
- **A NEW module is a hand-off the drift table cannot warn you about.** A file nobody has listed is in neither the manifest nor the portal tree, so it is not a row in either direction. `requireScan()` covers this now, but if you add a module that a vendored generator requires, write its `vendored.json` row **by hand** in the same change — `--update` only restamps rows that already exist.

- **This repository has a `.gitattributes` now, and it is load-bearing** (2026-08-28, OA-073). `core.autocrlf=true` is set on the machine that writes it, and `engine_version.js` hashes the RAW BYTES of every file the entry points reach — so before the rule, one commit gave three different engine versions depending on who had checked it out: `f83987f11b` on this laptop's historical mix of CRLF and LF files, which is the value stamped into all 20 maps, `24ebbec148` in a fresh Windows clone, and `0a32b566d4` in an all-LF tree, which is what Linux CI computes. Every town printed `STALE` in CI against character-for-character the code that drew it. `* text=auto eol=lf` fixes what a checkout writes and the hash now ignores line endings as well, so a checkout made before the rule still reaches the same answer. **Do not remove either half**, and if you ever see the engine version disagree between two machines, that is what has come back.

Read `make-bus-leaflet/references/changing-the-engine.md` §4 before any generator change.

## The gates, and proving they can fail

Run from `make-bus-leaflet`:

```bash
npm test
```

**Read the test count off the run** — it is on the `ℹ tests` line at the foot of the output, and no number appears in this paragraph on purpose. A few seconds, no network and no data tree needed. This line said *123 tests* until 2026-08-28, then *324*, then *352*, all on the same day; it then said *399* for six days while the suite reached 687, which is what a written count does when nothing reads a sentence to check it (the 2026-09-03 review, cross-repo F20). Then the falsification harnesses, which exist because a green check nobody has watched go red proves nothing — and, since 2026-08-27, because a check that has been made *quieter* needs proving it can still go loud:

```bash
npm run test:prove-red
```

Mutates a scratch copy of `assets/` and requires the unit suite to object. **The mutation count is at the foot of that run too, and again no number is written here** — this line said *169* against an actual 260 measured on 2026-09-03, the same fault as the paragraph above and found in the same review.

**Both of these now run in CI**, in the `gates` job of buses-data's `.github/workflows/gates.yml`, which they never had until 2026-08-28. They cost about two minutes together. A harness that only ever runs on the machine its subject was written on proves the check works in the one place it is least needed.

```bash
npm run test:prove-red-gates
```

Mutates each of the five generators and requires the **byte gate** to object — one target per sheet type. This is the one that matters before a refactor, because the byte gate is the only thing guarding the five big generators at all. Since 2026-08-28 it also carries a **portal arm**: four more targets against the two portal fixtures, run through `gate_lib`'s `portalFixtureEnv` so it falsifies the gate `status.js` runs rather than a second copy of it. It takes `--portal <path>` and reports SKIPPED, not silence, when there is no portal to find. **The second portal target mutates a SHARED module rather than an entry generator, and that is the whole point** — the fixture arm had been running the portal's entry generator against the SKILL's modules, so 19 of the 22 vendored files were substituted and four of them could be made to throw on load with the board still reporting PASS. A target list of entry generators alone would have gone green against that.

```bash
npm run test:prove-s6
```

Falsifies the **S6 verification checks** — the third thing neither of the others can reach, because `verify_report.js` is a top-to-bottom script like the generators. Four of its checks were rewritten on 2026-08-27 to stop manufacturing artefacts, and quietening a check and breaking it look identical from outside: fewer findings either way. So every case comes in a **pair** — quiet on the artefact, loud on a real fault of the same kind. 22 assertions; 12 of them go red against the pre-fix engine. It seeds from the **tracked** S1/S2/S3 runs plus `redteam.json`, never from an S6 run folder, because S4/S5/S6 folders are gitignored and a fresh clone has none of them.

```bash
npm run gate:design-keys
npm run test:prove-red-design-keys
```

**Every `design.*` key the engine reads must have a row in the register**, and every row must name a key something still reads — the table under the *design* heading in `references/design-quality.md`. **Add the row in the same commit as the key.** Built 2026-08-28 (OA-142) because the register held **19** rows against **33** keys: six of the missing fourteen were discussed further down the same document, eight appeared nowhere in it, and `design.laneOrientation` had been promoted to a DEFAULT the day before without ever being named there. Nothing could catch it, because **a table with a Default column asserts completeness by construction** — there is no count to disagree with. So the checker prints its two counts even when it passes, and the harness re-counts the population by its own independent walk instead of believing the verdict. It fires in both directions: a key deleted from the engine and left in the document is the same staleness from the other end.

```bash
npm run gate:line-ratchet
npm run test:prove-red-line-ratchet
```

**The top-to-bottom generators may not GROW without saying so** (2026-09-02, buses-data OA-224 Tier 2.1). `tools/line-ratchet.json` records a line-count CEILING for each of the seven generator scripts plus `status.js` and `verify_report.js`, and the check fails when any file is over its ceiling, naming the file and both numbers. It exists because the 27 August refactor cut `gen_internal.js` from 3,933 lines to 2,550 and wrote the rule that new logic goes in a module (OA-001), and by 1 September the file was 3,293 -- up 29% in five days across thirteen commits, every one a legitimate feature, by sessions that had read the rule. A rule that lives only in prose is a wish. **Growing a generator is allowed; growing it silently is not**: when the new lines genuinely belong in the script, run `npm run gate:line-ratchet -- --accept --note "<path>=<why>"` from `make-bus-leaflet` and commit the ledger IN THE SAME COMMIT as the growth, saying why in the message too -- the same shape as `quality_gate.js --accept`, and since 2026-09-04 literally the same code: **`--accept` REFUSES a file that is over its ceiling unless a note is supplied for it, and there is no bypass flag.** The note is appended to that file's entry as a dated paragraph and written by the tool, never typed into the JSON -- five commits to the quality ledger each rewrote about 460 of its 468 lines because the prose there WAS typed in by hand, at an indent the writer does not use. Ratcheting DOWN needs no note. The grammar, the append and the order of the two refusals are `assets/ledger_notes.js`, shared with `quality_gate.js`, and `test/ledger_notes.test.js` asserts both tools still call it. When they do not, write them as a module, which is what the rule always said. Shrinking a file passes and is reported as room to ratchet down. The count strips `\r` first, so CRLF and LF checkouts agree, and the harness re-counts every file by its own method and requires the checker's printed number to match -- its first run failed on that control, over a regex of its own, which is what a control is for. Neither file is in the engine hash.

```bash
npm run test:prove-red-route-collision
```

Falsifies the **route-number collision guard** — the one harness here written in Python, and the only one that runs the pre-fix code alongside the current code on purpose. A route NUMBER is not an identity: Wisbech runs two 46s, and `{s["route"]: s for s in services}` turned eleven shipped services into ten entries, so the monthly change scan had been diffing the Lynx 46 every month and had never once checked the Stagecoach East one. Every route still appeared exactly once, which is why nothing found it for months. Each case is a pair — quiet on right data, loud on a fault of the same kind — plus an **inertness** case proving a town with no colliding number gets a byte-identical answer either way, and a case asserting the OLD logic stays SILENT, without which "the tests pass" only says today's code agrees with itself. BODS is stubbed, so it needs no dataset and runs in both workflows. See `assets/index_guard.js` / `.py` and OA-134.

**Nothing may edit `assets/` in place.** Every file there is vendored and hashed; both harnesses work on temp copies for exactly that reason.

The full board, run from `make-bus-leaflet`:

```bash
node assets/status.js --buses "C:/u3a St Ives/Using AI/Buses" --portal "C:/Claude/community-bus-maps"
```

## What cannot be unit-tested, and what to do instead

Five generators are top-to-bottom scripts that read their inputs and exit at load, so nothing in them can be `require`d: `gen_internal.js` (**2,550 lines**, down from 3,933 — a 35% cut, and the named blocks are all out; see the module map below), `gen_boarding.js`, `diagram_internal.js`, `gen_external_radial.js`, `gen_external_places.js`. The Python half has no runner at all.

### The module map — what has come OUT of the generators, and what each piece owns

OA-129 Phase 3 is extracting `gen_internal.js` along the comment banners already in it. Each of these is requireable, tested, and vendored into the portal at `engine/<name>.js` (the engine ROOT, beside `icons.js` — not beside the generator that requires it, because `renderMap.js` passes `SKILL_ASSETS = engine/`).

| Module | Owns | Callers |
|---|---|---|
| `strict_guards.js` | the refusal contract: the flag, the counter, `refuse()`, and the closing banner. `report()` decides but does not exit, because the callers end differently on purpose | `gen_internal.js`, `gen_boarding.js` |
| `poi_select.js` | raw OSM elements → the drawable POI list: classify, industrial, excludeName, unnamed greens, tidy/canon, de-duplication | `gen_internal.js` |
| `fit_set.js` | which stops the frame is scaled to, including the off-path rule | `gen_internal.js` |
| `projection.js` | lat/lon → page mm: planar, PCA rotation, centre fisheye, detail lenses, fit | `gen_internal.js` |
| `svg_primitives.js` | the eight small marks a sheet is drawn out of: `esc`, `gk`, the four badge-width measurements, `badge`/`badgeStack`/`cross`. A factory, because four of them need the town in scope; `out` is passed IN, so the caller keeps the document | `gen_internal.js` |
| `linear_features.js` | river, road, railway, canal: style layering, geometry, the stitch and merge passes, and `drawFeature`. NOT the label — that is `feature_labels.js` below | `gen_internal.js` |
| `label_placer.js` | the shared reserved-box list, both label placers, and the route-ink contrast floor. Owns mutable state deliberately: 31 call sites reserve into one `placed` | `gen_internal.js` |
| `services_panel.js` | the sheet's whole right-hand column: the Services list in its four layouts, the pictogram Key, the frequency-tier rows, the fare note. DRAWS and returns nothing — measured, not assumed: none of the thirty-odd names it declares is read below it | `gen_internal.js` |
| `complexity_ladder.js` | the four rungs that make a big town readable: `internalCorridors` (1), `coreBox` (2), `stopThinning` (2b), `corridorPalette` (3). Three functions, because the rungs are read at two moments — the config read aliases colours IN PLACE, the box needs the projection, `thinKeep` needs the laneKey. Absent ⇒ every derived value is an identity | `gen_internal.js` |
| `north_arrow.js` | the compass, in the three pieces it has to stay in: the angle decides the footprint and must be known early, the position cannot be settled until the ink is stamped, the drawing happens last | `gen_internal.js` |
| `feature_labels.js` | siting the NAME of a river, road, railway or canal, and the four guards — coreBox, panel edge, footer plate, and "is it anywhere near the thing it names". Built LATE, after the auto-label solver, because that is the one thing it cannot be given earlier | `gen_internal.js` |
| `lane_normals.js` | the corridor orientation field behind `design.laneOrientation` | `gen_internal.js` |
| `engine_paths.js` | the ONE way an engine file names a sibling: `engineDep(callerDir)` searches (sibling, then SKILL_ASSETS, then the laptop) and `siblingOf(anchor)` pins to a folder already resolved. A factory, because "sibling" must mean the CALLER's folder — a generator copied beside a copied `icons.js` must find that copy | all four entry generators |
| `page.js` | the sheet itself: `W`/`H` in mm, `RASTER_W`/`RASTER_H` in px, and `svgOpen()`. The two pairs are NOT derivable from each other — 297mm at 300dpi is 3507.87px and the root element says 3508 | all four entry generators, `services_panel.js` |
| `external_primitives.js` | the marks the EXTERNAL sheets share: `line`, `tick`, the badge family, `stampNote`, `hubEdgeFor`, `rayToRectFor`, and both `wrap`s. A factory, and `out` is passed as a CALL because both callers redirect it mid-sheet | `gen_external_radial.js`, `gen_external_places.js` (and `gen_external_busway.js` until it was dropped on 2026-09-02) |
| `labeller.js`, `font_metrics.js`, `footer.js`, `icons.js`, `qr.js` | text placement, metrics, the footer band, the icon set, QR codes | several |

**The method, if you are continuing it, is six steps and three commands** — written up in full in `make-bus-leaflet/references/changing-the-engine.md`, and do not rebuild the tooling, it is committed. Extract, never rewrite: move the block into a module whose parameters are the generator's own variable names, have the script require it through `_dep()`, and prove all 20 maps byte-identical before committing. `npm run gate:extraction -- --baseline` **before the first extraction**, then `npm run gate:extraction` after each — 74 sheet verdicts in 27 seconds, which is what makes it affordable per extraction rather than per session. Watch it go red once yourself before leaning on it: a one-character edit to the stadium-badge casing moves 14 of the 74. **Count the real interface before designing the module, in both directions** — `linear_features.js` looked like a dozen exports and is four, and a name defined *below* the block cannot be passed into a factory built above it. A dependency that points forwards means the boundary is in the wrong place, not that it needs engineering round.

**The template hash follows the requires now, and that is because of this refactor.** `engine_version.js` named five files by hand, and ten extractions moved most of the drawing code into siblings that were on nobody's list — measured 2026-08-27, appending a line to `services_panel.js` moved the hash not at all, and neither did `labeller.js`, which had never been on it. `engineFiles()` walks the transitive closure from the same five entry points, following the four idioms this engine uses to name a sibling (`_dep()`/`_from()`, `path.join(<dir>,'x.js')`, a bare relative require, and the `SKILL_ASSETS` forms). 5 files became 24. **So an extraction no longer has to remember to update it — but a NEW way of writing a require does, and on 2026-09-02 that cost exactly what it says here.** OA-224 Tier 3.4 replaced `path.join(path.dirname(_LABELLER),'dash_fit.js')` with `_from('dash_fit.js')`, an idiom the scanner did not know; `dash_fit.js` fell OUT of the closure in the same edit that put `engine_paths.js` IN, and **the file count stayed at 21**. Only the NAMES showed it. The scanner is now asserted against a fixture naming a module by every idiom, rather than through whatever the estate happens to write — because the test that held the previous widening pinned it THROUGH `dash_fit.js`, and stopped holding anything the moment `dash_fit.js` was reached another way.

**And measure which branches the 20 maps actually take before deciding what to test — `npm run gate:branch-coverage -- tools/<spec>.js`, and NOT by reading the config.** Reading `routes.json` was tried first and was wrong by seven maps, because a default or a fallback sitting between the file and the branch is exactly where the interesting branches live. Measured properly: no committed map refuses anything, so the whole `STRICT_GUARDS` path is invisible to the gate; six of `projection.js`'s branches are taken by no map at all; `fit_set.js`'s off-path rule is reached by exactly one; the **entire v1 label placer** is dark, every map running v2; and the railway **tie symbol** is drawn by nothing, all six railway maps taking the chequer. Put the tests where the count is zero or one. A test written without that measurement is as likely to duplicate the gate as to complement it — and none of those dark paths is dead code, they are live features today's data does not select.

**DARK MEANS "NO MAP IN THIS RUN TOOK IT", AND THE RUN IS A CHOICE.** Two traps, both hit on 2026-08-27 and both of which read as a finished answer. The probe renders `internal.svg` only, so `north_arrow.js`'s `angle` branch reported ZERO and is taken by **twelve** committed sheets — `schematize_internal.js` and `diagram_internal.js` inject it, because their coordinates are pre-rotated and theta cannot say which way north is. And a mark placed on the NEXT guard's `if` sits after the `return` it was meant to observe: three of `feature_labels.js`'s refusal rows could not have fired whatever the maps did. Re-anchoring them gave the same 17, which is exactly the point — a number that cannot change is not evidence, even when it turns out to be right.

**Two things no byte gate reads, and `npm run gate:dark-paths` compares both before and after an extraction:** **stderr**, and an **`EDITOR_KEYS=1`** render, which is a genuinely different code path — `gk()` emits nothing at all without it. Every one of the 18 maps that has an internal sheet exercises both; the other two of the 20 have no internal sheet to render. (This line said "19 of the 20 write to stderr" until it was re-measured on 2026-08-27 by the tool that now reports it.)

**So when a generator fault needs new logic, write the new logic as a module rather than as more lines in the script.** `lane_normals.js` was created that way and was requireable and tested from the day it existed. The re-vendor is owed either way, and this way the fault arrives with a test.

**But a unit test proves the module; only a caller proves the wiring.** `lane_normals.js` carried twelve green assertions against its documented `(segs, lateral, chain)` contract while `gen_internal.js`, its only caller, passed the chain pairs concatenated into `lateral` and `[]` as the third argument. No byte gate could see it, because the drawn output was unaffected. After extracting or adding a module, check that its caller list is exactly what you think and that the call site passes what the signature says.

## Git in this repo

**PR-per-change to `main`, since 12 September 2026.** `main` is protected: the two `Bus leaflet gates` checks — `unit` and `status` — are required by name, a branch must be **up to date** with `main` before it merges, and **nobody may bypass**, administrators included. A direct `git push origin main` is refused by the server. This repository was direct-push until that date, and the three repositories are no longer alike: `community-bus-maps` has been PR-per-change under the same four settings since 2026-09-03, and `buses-data` is still direct-push because it is private, can never be made public while it holds `Correspondence/`, and pays for every Actions minute. **Check which convention a repo uses before pushing** — they sit side by side in this account and the answer is now different in each.

**Why it changed, and it is not tidiness.** On 2026-09-12 three commits — `09f2c64`, `f21eec3`, `00f6d36` — sat on this shared checkout's `main` unpushed and untested for up to two and a half hours (`09f2c64` for 2 h 34 m). `00f6d36` broke `prove-red-schematic-crossings.js`. A fourth session then pushed its own unrelated commit, `1f98812`, which published all four at once — so the only run that ever saw the break was titled *docstamp --checkout: stamp the worktree you are standing in*, and **the red landed under the wrong commit**. Nothing was wrong with the run; the commit it names simply is not the commit that broke it. A PR tests a change on its own, before it reaches `main`, and that is the whole of the fix.

**A red `main` here does not stay here.** `actions/checkout` fetches this repository with **no `ref:`** from three jobs in the other two repositories — twice in `community-bus-maps/.github/workflows/test.yml` (the hygiene checker, then the document checkers) and once in `buses-data/.github/workflows/gates.yml` (the engine itself) — so each of those runs whatever is on this `main` **at the moment it runs**. A broken `tools/` or a broken generator reddens a sibling under a commit that never touched this repository, and floats a sibling falsely GREEN whenever this side is ahead of what that commit was written against. It is the same mechanism `buses-data`'s CLAUDE.md describes from the other end, and it is why this `main` being green is two other repositories' business.

### Several sessions share ONE checkout, and protection does not stop them committing

`C:\u3a St Ives\.claude\skills` is a single working tree that concurrent sessions commit into, and **a checkout can only be on one branch at a time** — so "just make a branch" is not available to two sessions at once: whoever switches switches it for everybody, mid-edit. Protection refuses the *push* and says nothing about the *commit*, so with no convention the 2026-09-12 shape repeats one step earlier — commits pile onto a local `main` that can no longer go anywhere, and the first session to notice has to untangle several sessions' work off it.

**So take a worktree.** Two placeholders, both yours to choose: `<branch-name>` is the branch, and it is used twice below as the directory name too. One self-contained command, from anywhere:

```bash
git -C "C:/u3a St Ives/.claude/skills" worktree add "C:/u3a St Ives/.claude/skills-wt/<branch-name>" -b "<branch-name>"
```

Four things about a worktree of *this* repository, each already paid for somewhere:

- **Run `npm ci` in it, and never junction or copy `node_modules` into it.** The tests live off `make-bus-leaflet/node_modules`, and `git worktree remove --force` follows a junction out of the worktree and empties whatever it points at — which is how the main checkout's copy was emptied once already. Replace `<branch-name>` with the one you chose; from anywhere: `npm --prefix "C:/u3a St Ives/.claude/skills-wt/<branch-name>/make-bus-leaflet" ci`
- **The Skill tool still runs the MAIN checkout, never your worktree.** Every skill folder is junctioned into `C:\Users\Peter\.claude\skills` from `C:\u3a St Ives\.claude\skills`, so invoking `make-bus-leaflet`, or letting a stage tool pick its own engine path, runs the code on `main` and your change is not in it. Call scripts by their absolute path inside the worktree, and give `status.js` the worktree's own `assets/` as its working directory — otherwise you gate the change you did not make, and it reports green about a tree you are not shipping.
- **Stamp with `--checkout`, because nothing will find your documents for you.** `worktrees` is excluded from stamp discovery on purpose — a stamp is an edit, and two sessions once bumped stamps inside each other's worktrees. From inside the worktree, no placeholders: `python "C:/Users/Peter/.claude/skills/stamp-docs/scripts/docstamp.py" --all --checkout .`
- **Remove it when the PR merges**, with `git worktree remove` rather than by deleting the directory, so the administrative entry goes with it. `git -C "C:/u3a St Ives/.claude/skills" worktree list` is the read that says what is actually there.

**Opening the PR.** `gh pr create` from the worktree, then read both checks. `gates.yml` already carried `pull_request: branches: [main]`, so a PR is gated by exactly the workflow a push used to run and this switch needed no workflow change at all. Merge only on green — and the up-to-date rule means a base that has moved asks you to update the branch first, which is the rule the portal has and `buses-data` deliberately does not.

`C:\u3a St Ives\.claude\skills` and `C:\Users\Peter\.claude\skills` are **separate repos with different remotes**, and it is the individual skill *folders* that are junctioned between them, not the tree. Bus and u3a skill work belongs in `C:\u3a St Ives\.claude\skills`; `git status` in the personal checkout stays quiet about it. `token-saver`, `impeccable` and several others live only in the personal one — **this sentence named `stamp-docs` among them until 2026-09-12 and was wrong**, as `git ls-files stamp-docs` here has always answered; it is tracked in this repository and junctioned into the personal one like the rest.

Other sessions run concurrently. Stage by name, never a directory; read `git diff --cached --stat` before committing, as its own command; re-check `git branch --show-current` immediately before you commit — on this shared checkout that last one now also tells you whether you are on `main`, where a commit can no longer be pushed anywhere.

## House style for documents

Markdown paragraphs are **one continuous line** — never hard-wrap prose. Any script written into a document states the folder to run it from and explains every placeholder, or says there are none.
