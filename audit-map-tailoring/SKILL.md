---
name: audit-map-tailoring
description: Audit how much of every BusMaps.uk map is still configured by hand rather than generated — every town and place, every config layer (S3 routes.json, overrides.json, S2 tuning and hand geometry, service decisions, local decisions, the live portal's customer edits) — re-draft every town with today's draft_town.py and compare it key by key with what ships, read who asked for each change from the run notes, and sort every hand-set key into (a) ours, which an engine change could generate, (b) theirs, which the customer should decide through the portal, and (c) facts our feeds cannot settle. Writes a dated record into buses-data's Development Docs and compares it with the previous run, so progress toward "generation automatic, tailoring directed only by the customer" is measured rather than felt. Use when asked to "audit the tailoring", "which maps are hand-configured", "how much is still manual", "has the engine taken over the hand work", "re-run the config audit", or after an engine change meant to remove hand tailoring. Recommends and records; it changes no code and files nothing unless Peter says so.
---

# Audit map tailoring — what is still done by hand, and whose it should be

**What this is for.** Peter's goal, stated on 2026-09-22: *all our generation automatic as far as possible, and any tailoring directed solely by the customer.* This skill measures the distance to that goal and nothing else. The first run and its record are `Development Docs/config-tailoring-audit_2026-09-22.md` in buses-data (`C:\u3a St Ives\Using AI\Buses`); every later run copies its section structure, reads its section 5 list, and says which items are closed, still open or changed before adding new ones.

**When to run it.** After an engine change meant to remove hand tailoring (the items in the previous record's section 7), and before planning the next one. No cadence is set; if Peter sets one, add a dated `config-tailoring-audit` entry to `Development Docs/commitments.json` and re-date it as the last step.

**This skill changes no code and files nothing.** Its output is one dated record, a pointer to it from a live document, and a memory pointer. A finding that needs fixing now is written into the record's recommendation with a ready prompt; Peter decides whether it becomes an action.

## The scripts

All in this skill's `assets/`, all read-only except `draft_towns.mjs` and `draft_places.mjs`, which write only their scratch root. Each takes `--buses <estate root>` (default: `BUSES_DIR`, then the laptop), prints its answer on stdout, and exits 2 on misuse. They require the sibling `make-bus-leaflet/assets` (`gate_lib.js`'s estate walk, `cli.js`), so run them from a checkout that has both. Placeholders below: `<assets folder>` is the `make-bus-leaflet/assets` of the drafter under test; `<scratch root>` is an empty folder outside every repository.

| Script | Answers | Minutes |
|---|---|---|
| `inventory.mjs [--keys] [--json <file>]` | the per-map tailoring table; latest S3 against `ci-reference`; every `overrides.json` and hand chain, live or dead; with `--keys`, every config key and how many maps carry it | <1 |
| `history.mjs [--detail] [--since YYYY-MM-DD]` | every S3 run by cause (keyword-classified), and every run whose note names Peter | <1 |
| `places.mjs [--drafts <scratch root>]` | how many drafted place-destination names survived review — each place's own committed draft, or with `--drafts` the fresh ones `draft_places.mjs` wrote | <1 |
| `draft_places.mjs --assets <place assets folder> --scratch <scratch root>` | re-drafts every place's destination list offline, from its own `ci-reference/` inputs and `_gtfs/naptan.sqlite`; `<place assets folder>` is the `make-place-bus-leaflet/assets` of the drafter under test | <1 |
| `draft_towns.mjs --assets <assets folder> --scratch <scratch root> [--town <Name>]... [--fresh]` | re-drafts every town (from `_gtfs/town_prefixes.json`) into the scratch root; says which reached S3 and why the others stopped | ~2–5 a town |
| `compare_drafts.mjs --scratch <scratch root> [--town <Name>]...` | each draft against the live S3, key by key | <1 |
| `portal_query.mjs` | prints the ONE read-only command Peter runs to list the live portal's customer edits | 0 |

## Procedure

1. **Start in a buses-data worktree** for the record (`git worktree add .claude/worktrees/<name> -b work/<name>` from `C:\u3a St Ives\Using AI\Buses`, then `git config core.hooksPath .githooks` in it), and read the previous record in full — above all its sections 5 and 7.
2. **Get a current drafter.** Make a detached `claude-skills` worktree at `origin/main` and use ITS `make-bus-leaflet/assets` as `<assets folder>`: `git -C "C:/u3a St Ives/.claude/skills" fetch origin`, then `git -C "C:/u3a St Ives/.claude/skills" worktree add --detach "C:/u3a St Ives/.claude/skills-wt/<name>" origin/main`. The shared checkout can be behind — on 2026-09-22 it was one commit short of the drafter fix the audit was meant to measure.
3. **Run the three quick readers** — `inventory.mjs --json <file outside the repo>`, `history.mjs`, `places.mjs` — from this skill's `assets/`.
4. **Re-draft the towns** with `draft_towns.mjs` in the FOREGROUND (the Bash tool's 10-minute limit: pass `--town` in batches of two or three). Then `compare_drafts.mjs`. **Re-draft the places** with `draft_places.mjs` into a second scratch root, and read `places.mjs --drafts <that root>` beside step 3's `places.mjs`: step 3 says how the maps WERE drafted, this says how the current drafter does (OA-438, 2026-09-26: 44 of 92 names survive, against 7).
5. **Ask Peter to run the portal command** that `portal_query.mjs` prints, and read its output from his paste or the Terminal panel. Do not read the laptop's `portal.sqlite` instead.
6. **Read who asked.** For every hand change you are about to describe, read the S3 run's `note` in the map's `manifest.json` (or `history.mjs --detail`). Only a note that names Peter makes a change his.
7. **Sort every finding into the three buckets** below, and against the previous record: closed, still open, changed, new.
8. **Write the record** as `Development Docs/config-tailoring-audit_<date>.md`, same eight sections as the first; point to it from a live document (the previous record's successor line, or the paragraph at the end of section 1 of the local-decisions plan); run the document checks CLAUDE.md lists; commit by pathspec; fast-forward `main`; leave the push to Peter. Add or update the memory pointer `project_config_tailoring_audit_*`.

## The three buckets

The split is the rule in section 1 of buses-data's `Development Docs/local-decisions-to-the-editor-plan_2026-08-25.md`, applied to config keys:

- **(a) Ours** — checkable against a source: layout, collisions, colour separation, which end of a route to name, stale services, defaults the estate has converged on. The engine should generate it and nobody should be asked. The test: could a measurement decide it?
- **(b) Theirs** — only a person who lives there can say: which landmarks, what things are called, how much area, which way up, which remaining services count. It belongs to the customer through the portal, on the landmark-chooser pattern (OA-083).
- **(c) Facts our feeds cannot settle** — a route in no feed, a stop with no coordinates, an operator's current name, a demand-responsive service. It belongs in `service-facts.json` or upstream, and only its DRAWING is local.

## Traps this audit has already fallen into

- **"By hand" is not "by Peter".** Every buses-data commit is authored *Peter Cooper*, sessions included. On 2026-09-22 the first record said *what a person then changed* on Chatteris; Peter had changed only the orientation, and the rest was a session's. Say *typed into a config*, and name Peter only where a run note does — `history.mjs` counts those (26 of 402 on the first run, every one a decision a session then typed).
- **Background loops outlive their stop.** A backgrounded bash loop kept drafting after the task was stopped and mixed two drafter versions in one scratch root. That is why `draft_towns.mjs` runs in the foreground; if you background anything, list the processes by command line after stopping it.
- **S4 fails in a scratch root and that is fine.** Only S3 is compared. A town that stops BEFORE S3 is a finding: RED complexity (Beaconsfield, High Wycombe — the drafter takes every service near the town), or a name the geocoder cannot find (The Shelfords, three parishes).
- **Differences are not all drafter faults.** Services change between a build and today; `internalRoads.termini` start/end is not comparable and is left out; a palette the customer chose is (b), not (a).
- **The cause split is keyword-classified and moves with the classifier.** The first record's 23% "layout by hand" matched the changed-key list as well as the note; `history.mjs` matches the note alone and says 25%. Compare shares between runs of the SAME script, and quote the script's own output rather than retyping it.
- **An `overrides.json` in a superseded S3 run is dead.** Three of four were, on the first run; `inventory.mjs` says which.
