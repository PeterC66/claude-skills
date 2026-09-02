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

## Flags

- `--buses <path>` names the map estate; `--town <Name>` / `--place <Name>` names one map; `--portal <path>` names the portal checkout. These are the three that appear everywhere, and a new tool needing an estate uses `--buses` rather than inventing a name.
- **Resolution order for the estate**: `--buses`, then `BUSES_DIR`, then the laptop default. It IS one function as of 2026-09-02 (OA-224 Tier 3.1): [`assets/cli.js`](../assets/cli.js) exports `parseArgs`, `die`, `readJson`, `resolveBuses` and `resolvePortal`, and [`assets/cli.py`](../assets/cli.py) gives the Python half the same order — pass `default=None` to argparse and call `cli.resolve_buses(a.root)`, because a default argparse has already filled in is indistinguishable from one the caller passed and would beat the environment variable it is meant to lose to. Before it, `BUSES_DIR` did not exist for the engine at all: `bus-work` had the convention and nothing else adopted it, so a machine that is not this laptop could run none of the seventeen scripts that now share the resolver. **`cli.js` must stay outside the entry points' require closure** — a generator that required it would move the template hash and put every map STALE for a change that moved no ink; `test/cli.test.js` asserts that against `engineFiles()` and is the only thing holding the line.
- `--apply` (or `--accept` for a ratchet or a ledger) for a **local** mutator: report by default, write only when asked.
- `--dry-run` plus `--yes` for anything touching the **VPS**: the default is to do it, so the safety has to be the confirmation.
- `--quiet` suppresses the per-item chatter and keeps the verdict. `--json` prints the machine-readable form on stdout and nothing else on it.
- Long flags only. A flag that takes a value takes it as the next argument. Keep an old flag working as an alias when you rename one — a flag name is an interface with CI, the runbooks, and a person's memory.

## Naming and scheduling

- `prove-red-<thing>.js` breaks `<thing>` on purpose and requires **each mutation to redden the assertion that names it**, with a control that must stay green. `check-<thing>.js` / `<thing>-gate.js` reads state and reports. `branch-coverage.<module>.js` is a **spec**, passed as an argument to `branch-coverage.js`; it runs nothing on its own.
- **Every runnable tool gets an npm script, and every `test:`/`gate:` script is in `gates.yml` or declared with a reason.** This is not a convention you have to remember: [`tools/check-wiring.js`](../tools/check-wiring.js) (`npm run gate:wiring`) checks it, and it runs in the `unit` job.
- **CI runs a gate THROUGH its npm script, never by rebuilding the command.** A rebuilt command is a second copy of the invocation and the two drift: four python harnesses were `python` in `package.json` and `python3` in the workflow, so `npm run test:prove-red-days-resolution` and the CI step of the same name were different commands until 2026-09-02. `gate:wiring` refuses that shape now.
- **A gate belongs in the suite that fires when its SUBJECT changes.** A check run only in the neighbouring repository turns a violation here into a red run over there, about a change nobody there made.

## Node and Python

**Node 24** — `gates.yml` installs 24 in the `unit` and `docs` jobs, and the `status` job reads the major version off the deployment image so it cannot drift from what actually serves the site. `package.json` here declares **no `engines` block at all**; that is a real gap and it is OA-224 Tier 5's "add `engines` to the engine's `package.json` and one Node 24 pin everywhere". It is named here rather than fixed here.

**`python3`, not `python`.** Both resolve on this laptop; only `python3` resolves on the CI runner, and `python` is Python 2 on some machines. Every python script in `package.json` says `python3`.

## The engine is hashed — prose in `assets/` is not free

A comment added to a file under `assets/` moves the template hash and puts every map in the estate STALE. Write the explanation in `references/` and point at it, unless the comment is genuinely about the line beneath it. `sizeMode` and every other `design.*` key must be in the register or `gate:design-keys` fails.

## Git

**Direct push to `main`** in this repository, like `buses-data` and unlike the portal, which is strictly PR-per-change. Check which convention a repository uses before pushing.

**A generator change is not finished until the portal has been re-vendored and `npm run track:engine` has been run there.** Re-vendoring reaches the portal; tracking reaches the maps already delivered into it. Both are enforced by a gate — see [`changing-the-engine.md`](changing-the-engine.md).

## Documents

Markdown paragraphs are **one continuous line** — never hard-wrap prose. Any script written into a document states the folder to run it from and explains every placeholder, or says there are none. Cite another document's section by **anchor**, not by naming it in prose. `check-tables.mjs --tree` and `check-doc-links.mjs --root` read this repository's documents in this repository's own `gates.yml`, in the `docs` job.
