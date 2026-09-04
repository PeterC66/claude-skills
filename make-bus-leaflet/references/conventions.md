# Conventions — the engine (`claude-skills`)

The single sheet that settles what a flag is called, what an exit code means, which stream carries what, how a script that changes something asks permission, and which Node this repository runs. It describes what is **already true here** wherever there is a majority practice, and says so plainly where there is not.

It is one of three, one per repository. The other two are `docs/CONVENTIONS.md` in **community-bus-maps** and `Documentation/README - Conventions.md` in **buses-data** — named rather than linked, because a relative link that climbs out of this repository resolves on the one laptop that has all three checked out and 404s for everybody else. Where a rule is shared, all three say the same thing; where a repository genuinely differs, each says its own.

**Writing this page settles the questions. Adopting it is item by item, in OA-224 Tier 3** — a tool that disagrees with this page is not a bug to fix on sight, it is a migration belonging to the item that owns that tool.

## Exit codes

| Code | Means | Example |
|---|---|---|
| `0` | It worked, or the check found nothing wrong | a passing gate |
| `1` | The thing being checked or done FAILED — the answer is "no" | a byte gate that found a difference; a mutation that survived |
| `2` | The SCRIPT was used wrongly, or its own preconditions are not met — "I cannot tell you" | a missing `--buses`; an ambient red that makes a harness's own controls meaningless |
| `3` | The INPUT is not the shape it claims to be | a stage folder that carries none of the outputs its manifest declares |

**The distinction that matters is 1 against 2.** A caller that treats every non-zero as "it failed" reports a missing flag as a broken map. `2` is also what a harness must return when **the room is red before the experiment**: `prove-red-status.js` exits 2 rather than reporting an ambient red in a column, because a control that reddens for the room's reason is not evidence about the subject.

**A check that cannot find its subject must exit non-zero, never report clear.** `check-design-keys.js` fails when a key it names is gone rather than passing on zero rows; a gate that reports PASS over an empty population is the most expensive kind of green.

## Streams

- **stdout carries the answer** — verdicts, counts, the thing a caller might parse.
- **stderr carries the reasons** — refusals, warnings, and anything explaining a non-zero exit.
- **A successful run is allowed to speak.** Do not read stderr only on failure. `gen_internal.js` writes a build warning on a zero exit, and a caller reading stderr only when the exit code is non-zero never saw it — which is how a "must show" that could not be fitted reached a customer silently.
- **The generators' own contract is written down in `assets/strict_guards.js`** (OA-230, 2026-09-02): which stream carries what and what each of `0`, `1`, `2` and `3` means for a generator and for the two pre-stages — including that a pre-stage whose `routes.json` does not opt in exits `0` having written nothing, which is not a failure and must not be reported as one.

## Flags

- `--buses <path>` names the map estate; `--town <Name>` / `--place <Name>` names one map; `--portal <path>` names the portal checkout. These are the three that appear everywhere, and a new tool needing an estate uses `--buses` rather than inventing a name.
- **Resolution order for the estate**: `--buses`, then `BUSES_DIR`, then the laptop default. It IS one function as of 2026-09-02 (OA-224 Tier 3.1): [`assets/cli.js`](../assets/cli.js) exports `parseArgs`, `die`, `readJson`, `resolveBuses` and `resolvePortal`, and [`assets/cli.py`](../assets/cli.py) gives the Python half the same order — pass `default=None` to argparse and call `cli.resolve_buses(a.root)`, because a default argparse has already filled in is indistinguishable from one the caller passed and would beat the environment variable it is meant to lose to. Before it, `BUSES_DIR` did not exist for the engine at all: `bus-work` had the convention and nothing else adopted it, so a machine that is not this laptop could run none of the seventeen scripts that now share the resolver. **`cli.js` must stay outside the entry points' require closure** — a generator that required it would move the template hash and put every map STALE for a change that moved no ink; `test/cli.test.js` asserts that against `engineFiles()` and is the only thing holding the line.
- `--apply` (or `--accept` for a ratchet or a ledger) for a **local** mutator: report by default, write only when asked.
- **A ledger's prose is an INPUT to `--accept`, never a hand edit** (2026-09-04). Both ratchet ledgers take `--note "<key>=<text>"`, repeatable, and `--note-file <path>` in the same grammar one note per line: `quality_gate.js` keyed by sheet (`Huntingdon · schematic`) and `tools/line-ratchet.js` keyed by relative path (`assets/gen_internal.js`). The note is appended as a dated paragraph by the same function that writes the numbers. It exists because five quality-ledger commits each rewrote about 460 of 468 lines to land one paragraph — a hand-typed note goes in at the editor's indent and the writer uses one space, so the diff that was meant to be the review was the whole file. **If a generated file carries prose, the generator has to be the thing that writes it.** And where the entry justifies making something worse, requiring it is worth more than asking for it: both tools refuse to record a RAISED ceiling that has no note, with no bypass flag, because a flag that switches a justification off is one that gets typed at six o'clock. Ratcheting DOWN never needs one — the ratchet only makes the expensive direction expensive.
- **The grammar and the refusal are ONE implementation**, [`assets/ledger_notes.js`](../assets/ledger_notes.js), because a rule written twice is a rule that drifts. It is outside the engine hash and must stay there. `test/ledger_notes.test.js` asserts both callers actually import it rather than growing their own parser back — an extraction is the module PLUS a check on its callers, and `tools/prove-red.js` breaks that check on purpose to prove it can fail.
- `--dry-run` plus `--yes` for anything touching the **VPS**: the default is to do it, so the safety has to be the confirmation.
- `--quiet` suppresses the per-item chatter and keeps the verdict. `--json` prints the machine-readable form on stdout and nothing else on it.
- Long flags only. A flag that takes a value takes it as the next argument. Keep an old flag working as an alias when you rename one — a flag name is an interface with CI, the runbooks, and a person's memory.

## Enumerating the estate

**There is one walk, and it lives in `gate_lib.js`.** `findTowns`, `findPlaces` and — since 2026-09-02, OA-224 Tier 3.2 — `findSheets` are the only enumerations of what is on the board; `quality_metrics.js` and `quality_gate.js` re-export `findSheets` rather than keeping a copy, and `contact_sheet.js`, `attribution-gate.js` and `prove-lane-mirror.js` import it. Never write a `readdirSync` walk over `Areas/` in a new tool.

**An enumeration is a silent filter.** It does not fail; it answers a smaller question and looks exactly like an answer to the whole one. The same omission — searching `Areas/` alone, so the three maps under `Places/_standalone/` are invisible — was written into this system five times and shipped three, and the last time it meant every board-wide figure `quality_metrics.js` had ever printed was taken over a population three maps short. `test/find_sheets.test.js` now asserts **identity** (`QM.findSheets === QG.findSheets === gate_lib.findSheets`) rather than agreement, because agreement has to be re-established every time either copy is edited and identity cannot be lost without deleting the assignment.

## Naming and scheduling

- `prove-red-<thing>.js` breaks `<thing>` on purpose and requires **each mutation to redden the assertion that names it**, with a control that must stay green. `check-<thing>.js` / `<thing>-gate.js` reads state and reports. `branch-coverage.<module>.js` is a **spec**, passed as an argument to `branch-coverage.js`; it runs nothing on its own.
- **Every runnable tool gets an npm script, and every `test:`/`gate:` script is in `gates.yml` or declared with a reason.** This is not a convention you have to remember: [`tools/check-wiring.js`](../tools/check-wiring.js) (`npm run gate:wiring`) checks it, and it runs in the `unit` job.
- **CI runs a gate THROUGH its npm script, never by rebuilding the command.** A rebuilt command is a second copy of the invocation and the two drift: four python harnesses were `python` in `package.json` and `python3` in the workflow, so `npm run test:prove-red-days-resolution` and the CI step of the same name were different commands until 2026-09-02. `gate:wiring` refuses that shape now.
- **A gate belongs in the suite that fires when its SUBJECT changes.** A check run only in the neighbouring repository turns a violation here into a red run over there, about a change nobody there made.

## Node and Python

**Node 24** — `gates.yml` installs 24 in the `unit` and `docs` jobs, and the `status` job reads the major version off the deployment image so it cannot drift from what actually serves the site. `package.json` here declares `"engines": { "node": ">=24" }`, added by OA-224 Tier 5 in `9ff82bb` with a `//engines` note saying why; this paragraph went on calling that a gap for two days afterwards and was corrected by the 2026-09-03 review (cross-repo F27). The portal's `engines` still says `>=22`, which is looser than anything that is actually tested, and that is the one divergence left.

**`python3`, not `python` — in `package.json` AND in the documents.** Both resolve on this laptop (checked: `python3 --version` and `python --version` both print 3.13.14); only `python3` resolves on the CI runner, and `python` is Python 2 on some machines. The rule used to be scoped to `package.json` and said nothing about prose, so the two `SKILL.md` files and four reference pages documented 27 commands a reader would copy as `python` — the 2026-09-03 review's engine-pipeline N31. They now say `python3`. Note what is NOT covered: the u3a handout skills in this repository still write `python`, deliberately, because they drive the Windows-Store interpreter through a long `AppData` path with its own documented quirks and none of them runs in CI.

## A generator's body lives in `main()`, and its file must LOAD

Every entry generator — the two in `ENGINE_FILES`, the boarding one, both pre-stages, both place ones — ends with:

```js
if (require.main === module) main();
module.exports = { main };
```

Nothing inside `main()` is re-indented when a body moves into one (OA-224 Tier 4.1): the diff has to read as *a scope was added*, or the byte gate is the only thing left that can say the two are the same program. Both callers spawn a generator as a child process (`gate_lib.runGenerator` and the portal's `renderMap.js` both use `spawnSync`), so `require.main === module` holds for every real build.

**The point of it is that a test can now REQUIRE a generator without it drawing a map**, which is what `test/generator_load.test.js` needs. That test exists because `gen_external_busway.js` spent a day throwing `ReferenceError` at load — through a re-vendor and a deploy — with `status.js` PASS, every sheet verdict green, every mutation caught and CI green in three repositories. None of those gates was broken: each asks *does the output still match*, and none can ask it of a generator no map runs. **So when you add an engine entry point, the population it belongs to is `engine_version.js`'s lists, and that test derives its subjects from them rather than from a list typed here.** Do not give a generator a load-time side effect — reading `routes.json`, writing a file, printing — outside `main()`; a mutation in `prove-red.js` exists for exactly that, because a generator that exports `main()` and still draws when required passes every other check in this repository.

## An extraction is the module PLUS a check on its callers

**Ship the caller check in the same commit as the helper.** Measured on 2026-09-03, the day after OA-224 landed a dozen shared helpers: the two that arrived with a test asserting the callers ARE the helper — `gate_lib.findSheets` with an `===` identity test, and the portal's route table — were fully adopted. Every other helper was adopted exactly as far as its author happened to migrate the callers and no further. `cli.parseArgs` had fifteen callers and a test naming eight of them, while six more `argv.indexOf('--x')` bodies sat under `assets/` — one of them written the day after `cli.js` landed. "Use the helper" is a rule; a green test of the helper does not enforce it.

Two shapes of check, and prefer the first where the callers can be enumerated:

- **An identity assertion** — the caller's function IS the helper's, tested with `===`. `find_sheets.test.js` is the model.
- **A census** — no file under a named folder contains the old idiom, outside an allowlist whose every entry carries a REASON. `test/cli.test.js`'s argv census and `test/stage_module.test.js`'s manifest census are the models. Three things make a census honest and it is easy to ship one without them: a **population check** (`scanned > 50`, or the readdir that found nothing passes), a **CONTROL** that the pattern really does match a live example, and a check that **every allowlist entry is still a file that still carries the idiom** — that last one went red on its first run in the portal, on an entry that was widening the allowlist for nothing.

**An allowlist with reasons beats a looser rule.** A blanket "no escaper outside `html.js`" would have been red on day one over five legitimate SVG and XML cases, and a check that is red on day one is muted inside a week.

**And a helper's docstring is what its own check is measured against.** `NOW_SQL` said "what goes in an INSERT/UPDATE", which excluded the `WHERE expires_at > …` comparisons it also owned — so a census over the literal produced false findings and the CENSUS was deleted rather than the sentence, leaving the constant with zero callers. When a check has to be abandoned because it is red on code that is clearly fine, ask which definition is wrong before deleting anything.

## A pure move SPLICES the body; it never retypes it

**Copy the function's text out of the file it is leaving. Do not write it out again from its shape, however small it looks.** OA-232 Tier 3.3 extracted nine functions the two internal pre-stages both carried, and the first draft retyped two of them: `lsq` came out as a dense Gauss-Jordan instead of the flat `Float64Array` forward elimination with its rank-deficiency `continue`, and `dpTol` lost the degenerate-segment arm that stops a zero-length span dividing by zero. Both compiled. Both return plausible numbers for every well-posed system in the estate, so the thirteen byte gates would have said nothing until a town happened to present a loose corridor. It was caught by diffing the new module against the source, which took a minute; measured afterwards over 20,000 random systems, the two `lsq`s differ by a relative 9.2e+5.

**And check the diff is only the parameterisation you meant.** The splice is worth nothing if the edits around it are unreviewed — assert, in a script, that each spliced body is character-identical to its source modulo the substitutions you can name.

## A short module alias can lose to a local of the same name, and `node --check` will not say so

`diagram_internal.js` and `schematize_internal.js` each declare `const RG` — the parsed `roads_geo.json` — INSIDE `main()`. A new module-scope `const RG = require(_dep('road_graph.js'))` was therefore shadowed at every call site, because every call site is inside `main()`, and `RG.graphOps` resolved to the road data. **Shadowing is legal, so `node --check` is silent, the unit tests do not run the pre-stages, and the only thing that objected was the byte gate** — four diagram sheets went `FAIL`.

**Grep the file for the alias before you introduce it**, in a 900-line file especially, and prefer a name that reads as what it is (`roadGraph`) over the two-letter form the file's own data objects already use. The general shape is in the failure-shapes list; the practical rule is that a two-letter alias in a long file is a collision waiting for a gate to find.

## A harness that builds a scratch world derives EVERY population from its subject

`tools/prove-red-redteam-source.js` copies one mutated file into a temp folder and runs the suite against it. On 2026-09-03 its subject gained a `require('./cli.js')` and the harness went `MODULE_NOT_FOUND` — which is the harness working, because a scratch world silently missing a dependency is how a mutation "survives" for the wrong reason. The portal's `prove-red-run-tests.mjs` failed the same day for the same reason, and there the lesson was already written in the file: its EXCLUDED list was parsed out of the runner "so this harness cannot go stale", and its PREFLIGHT list, eight lines above that comment, was typed.

**So: when you add a dependency to anything a harness copies, grep for the harnesses that copy it. And when you write "read off the subject rather than copied" about one list, look at every other list in the same file before you leave.**

## The engine is hashed — prose in `assets/` is not free

A comment added to a file under `assets/` moves the template hash and puts every map in the estate STALE. Write the explanation in `references/` and point at it, unless the comment is genuinely about the line beneath it. `sizeMode` and every other `design.*` key must be in the register or `gate:design-keys` fails.

## Git

**Direct push to `main`** in this repository, like `buses-data` and unlike the portal, which is strictly PR-per-change. Check which convention a repository uses before pushing.

**A generator change is not finished until the portal has been re-vendored and `npm run track:engine` has been run there.** Re-vendoring reaches the portal; tracking reaches the maps already delivered into it. Both are enforced by a gate — see [`changing-the-engine.md`](changing-the-engine.md).

## Documents

Markdown paragraphs are **one continuous line** — never hard-wrap prose. Any script written into a document states the folder to run it from and explains every placeholder, or says there are none. Cite another document's section by **anchor**, not by naming it in prose. `check-tables.mjs --tree` and `check-doc-links.mjs --root` read this repository's documents in this repository's own `gates.yml`, in the `docs` job.
