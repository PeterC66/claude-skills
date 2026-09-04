---
name: review-bus-codebases
description: Run the recurring style, standards, consistency, structure and maintainability review of the three BusMaps.uk codebases — buses-data, claude-skills (the engine and satellite skills) and community-bus-maps (the portal) — the same way every time, so each run is comparable with the last. Six read-only reviewers take one slice each from fixed briefs, classify every prior finding as closed, still open or changed before listing new ones, and a measurer prints the standing counts (generator sizes, helper copies, laptop paths, test wiring) as numbers rather than impressions; the consolidating session re-measures the heaviest claims, writes the dated plan and evidence documents into Development Docs, updates the backlog row and re-dates the commitment. Use when asked to "review the codebases", "run the codebase review", "how is the refactor holding", "has the estate drifted", "is it time for the code review", or when the codebase-review commitment on the board falls due. Recommends and records; it does not change code.
---

# Review the bus codebases, the same way every time

**What this is for.** On 2026-09-01 a one-off review found that a refactor's rule had been stated and not followed: the main generator regrew 29% in five days under a rule that said new logic goes in a module. The finding was only possible because somebody compared a number in a headline with `wc -l`. This skill makes that comparison routine. Each run reads the previous run's findings, says which are closed, and prints the same counts, so drift is measured rather than felt. The first run and its plan are `Development Docs\codebase-review_2026-09-01.md` in buses-data (`C:\u3a St Ives\Using AI\Buses`), and the evidence shape every later run copies is its companion `codebase-review-findings_2026-09-01.md`.

**Cadence, decided by Peter on 2026-09-02:** once after each tier of OA-224 lands, and then fortnightly once Tier 5 is done. The chase is a dated entry `codebase-review` in `Development Docs/commitments.json` in buses-data, which the board prints and bus-work ranks; the last step of every run is to re-date it.

**This skill changes no code.** Its output is two documents, a backlog row and a commitment date. If a run finds something that needs fixing now, it files it, claims nothing, and says so in the plan.

## The three codebases

| Repo | Where | What it holds |
|---|---|---|
| buses-data | `C:\u3a St Ives\Using AI\Buses` | map data, the documentation checkers, the backlog, the hooks, CI |
| claude-skills | `C:\u3a St Ives\.claude\skills` | the engine (`make-bus-leaflet/assets/`), the place skill, bus-work, this skill |
| community-bus-maps | `C:\Claude\community-bus-maps` | the portal: `src/`, `scripts/`, `engine/` (vendored copies), workflows |

## Procedure

**1. Start from the last run.** Find the newest `Development Docs/codebase-review-findings_<date>.md` and `codebase-review_<date>.md` in buses-data and read the plan's *Where this stands* table and the backlog row it names (OA-224 as at 2026-09-02). Claim that row with `--claim` before anything else, from the buses-data root, `C:\u3a St Ives\Using AI\Buses`; `OA-224` and the quoted text are the placeholders:

```bash
node "Development Docs/open-actions/assemble.mjs" --claim OA-224 --as "<your session name>, codebase review"
```

**2. Measure before anyone reads a line.** Run the measurer from this skill's folder (`C:\u3a St Ives\.claude\skills\review-bus-codebases`); it takes no placeholders and writes nothing. Save its JSON beside the documents so the next run can diff against it:

```bash
node assets/measure.mjs
```

```bash
node assets/measure.mjs --json > "C:/u3a St Ives/Using AI/Buses/Development Docs/codebase-review-measures_<date>.json"
```

`<date>` is today as `YYYY-MM-DD`. Compare with the previous JSON by eye or with `diff`; a count that rose is a finding before any reviewer has started.

**3. Fan out the six reviewers, in parallel, from the briefs.** The briefs are in [`references/briefs/`](references/briefs/), one per slice, and they are the same text every run apart from the date and the previous findings file you name at the top of each. Give every reviewer the path to the previous findings document and require its three-way classification — CLOSED, STILL OPEN, CHANGED — of every prior finding in its slice before it lists anything NEW. That classification is the point of running the same briefs.

| Brief | Slice |
|---|---|
| [engine-generators.md](references/briefs/engine-generators.md) | the drawing core: generators and drawing modules |
| [engine-pipeline.md](references/briefs/engine-pipeline.md) | stage, gates, Python, tools, tests, the skill's docs |
| [satellite-skills.md](references/briefs/satellite-skills.md) | make-place-bus-leaflet, bus-work, audit-bus-leaflet |
| [portal-src.md](references/briefs/portal-src.md) | the portal's application source, views, container |
| [portal-ops.md](references/briefs/portal-ops.md) | the portal's scripts, vendoring, workflows, changelog, backups |
| [data-repo-and-cross-repo.md](references/briefs/data-repo-and-cross-repo.md) | buses-data's own code, and what only a cross-repo view sees |

Every brief is read-only and says so. Reviewers report in one shape: what to preserve, a findings table with file-and-line or a measured count per row, and the smallest structural moves.

**4. Re-check before the findings drive the plan.** Pick the eight or so claims that carry the most weight and re-measure them yourself against the files. A plan built on an unverified report is the *backlog row is a claim* shape. Record what you re-checked in a table in the plan; the first run's table is the model.

**4a. A count in a finding must name its POPULATION, not a folder.** The 2026-09-01 run's Tier 2.3 said "the 19 unscheduled `tools/` files". Nine were real: seven were `branch-coverage.<module>.js` spec files passed as an argument to another tool and running nothing on their own, and three were gitignored scratch a `readdirSync` had swept up. Giving any of those ten an npm script would have been wrong, and the session that acted on the row had to re-derive the number before it could start. So when a finding carries a count, write what makes a file a MEMBER — and prefer a count the reviewer got from `git ls-files` over one from a directory listing. Better still, where the count is the subject of the remedy, **ship the check instead of the number**: `npm run gate:wiring` answers that row's question on every CI run, and a number in a document is only ever right on the day it was written.

**4b. "All of X now does Y" is a claim about a JOIN, and prose cannot hold one.** This review's own plan and three separate documents said both engine falsification harnesses ran in CI. One never had — `git log -S "prove-red.js"` over `gates.yml` returned nothing — and it took a check that enumerates both sets to notice, five days later. If a finding or a plan item is about coverage, the deliverable is the enumeration, not the sentence.

**5. Write the two documents** into `Development Docs/` in buses-data, following [consolidation.md](references/briefs/consolidation.md): `codebase-review-findings_<date>.md` holds the six reports as delivered, and `codebase-review_<date>.md` holds the verdict, the re-check table, the findings grouped, the plan in tiers with effort per item, a not-recommended list, how it sits with the backlog, what surprised us, and a *Where this stands* section that later sessions fill in. Paragraphs are one line; every command names its folder; tables are checked by `check-tables.mjs`.

**6. Backlog and commitment.** Update the backlog row's body with what this run found and what is left; file a new row only for work the plan cannot hold. Then re-date the `codebase-review` entry in `Development Docs/commitments.json`: after the next OA-224 tier while tiers remain, otherwise fourteen days from today. Delete-and-re-add is the convention there, not a done flag.

**7. Checks, stamp, commit, memory.** From the buses-data root, `C:\u3a St Ives\Using AI\Buses`, with no placeholders, run the four documentation checkers and the backlog check — two of them live in `claude-skills` since 2026-09-04 (buses-data OA-246) and are named by an absolute path that is real rather than a placeholder, and each reads the repository it is RUN FROM, re-stamp, stage by name, read the staged diff as its own command, and commit with a pathspec. Every command below is run from that folder:

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-tables.mjs"
```

```bash
node "C:/u3a St Ives/.claude/skills/tools/check-doc-links.mjs"
```

```bash
node Documentation/check-doc-coverage.mjs
```

```bash
node "Development Docs/open-actions/assemble.mjs" --check
```

```bash
python3 "C:/Users/Peter/.claude/skills/stamp-docs/scripts/docstamp.py" --all
```

Then write the round into the project memory store (a `project_codebase_review_<date>` entry and a pointer in `MEMORY.md`), and release the claim.

## What the first run taught about running it

- **Six reviewers converge on the same helpers from different directions** (argument parsing, hashing, escaping). When two slices name the same duplication, it goes in the plan once, under the slice that owns the shared module.
- **Reviewers cannot see history.** The regrowth finding came from `git log`, not from reading the file. Step 2 exists so that the measurer, not a reviewer, carries the numbers that change between runs.
- **The heaviest claims were all true, and re-checking them still earned its place**: it is what let the plan say "verified" rather than "reported".
- **A finding that needs no decision should be fixed in the same round**, not planned. The first run's four faults were each under an hour.

## What the second run taught, 2026-09-03

- **The briefs are verbatim, and the consolidating session broke that on the first repeat.** The run added "context you need" to the engine brief — what Tier 3 had landed — and one item in it was wrong: a `wcag.js` that did not exist. The reviewer measured and reported it as a finding instead of taking the brief's word, which is the behaviour the preamble asks for, but the review then had a finding about its own brief. Hand a reviewer the previous findings document and the plan's *Where this stands* table and let it read what landed; do not summarise the round into the brief.
- **The measurer lied first, and about the thing the last round fixed.** Its portal test-wiring metric assumed `npm test` was an `&&` chain; the chain became a runner on 2026-09-02 and the metric reported every test as "not in npm test" the next morning. It was caught because the number was absurd. `measure.mjs` now reproduces the runner's own owned/unowned/excluded split, keeps the old keys so the previous JSON still diffs, and counts laptop paths on CODE lines separately from header comments — because the conventions pages tell every script header to name the folder it runs from, and that made the comment-inclusive count RISE for a virtue. A measure that cannot tell a comment from a fallback cannot tell a convention followed from one broken. The measurer still has no test of its own; the next run should give it one before trusting a new metric.
- **Ask the previous round's session what it still holds before measuring.** Another session was finishing Tier 5 while this run started; a message to it, and its answer that everything was pushed, is what made the baseline describe a settled tree. `ListAgents` shows who is running; the measurer cannot.
- **What to look for on a repeat run: adoption, not extraction.** The second run's headline was that helpers landed in Tier 3 were adopted exactly where a test asserted the callers ARE the helper (one estate walker, the route table) and nowhere else (`confirm()` 0 callers, `NOW_SQL` 0 callers, a script written with its own argv reader the day after the shared one landed). On any run after a refactor, count the callers of each helper the previous plan landed before counting anything new.
