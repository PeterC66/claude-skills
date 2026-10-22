---
name: bus-work
description: Show what the BusMaps.uk bus-map system is waiting on — one ranked worklist gathered from the portal (publish reviews, organisation applications, map requests approved and awaiting a build, proposed updates) and from the local map tree (towns whose services change soon per the BODS scan, stale engine renders, missing S6 verification) — then carry the chosen item all the way through: run the right map skill, gate it, and deliver it into the portal with the exact command. Use when asked "what needs doing on the buses / the portal", "what's next", "do the monthly bus refresh", "is there anything waiting in the portal", "build the map someone asked for", "work the bus worklist", or when picking a numbered item from a worklist this skill printed. The entry point for routine BusMaps.uk operations — it replaces reading runbooks R1–R4 to remember which script, which flags, which order.
---

# Work the BusMaps.uk worklist

**Names for the parts and the process.** `C:\Buses\buses-data\Documentation\README - Glossary of terms.md` is the shared vocabulary: sheet elements by callout code, and the stage / portal / repo / failure words this skill uses throughout. It also records which of them to translate before writing to a customer — `deliver`, `accept` and `publish` are three different acts, and only publish changes what the public sees.

**The point of this skill: Peter should never have to open a runbook to do the routine month.** Everything the system is waiting on appears in one ranked list, and every item carries its own procedure. If you find yourself telling him to "see R4", you have failed — inline the step instead.

**Where Peter reads about this in his own words.** `Buses\Documentation\README - How to publish a map to the portal.md` (written 2026-08-21) is his plain-English account of the whole lifecycle — the three approval gates, what the publish review is actually asking, deliver vs accept vs publish, and the monthly cycle — and it names this skill as the front door. It is command-free by design and defers to R1/R3/R4 on anything technical. Point him at it when he wants to understand a step rather than execute one; **when a procedure here changes, check whether it changed the story there**, and don't answer him out of R1/R3/R4 when that guide already says it in his register.

## The shape of the system (why the split exists)

| Zone | Where it happens | Why it can't move |
|---|---|---|
| **Know** what needs doing | the portal | it holds the customers, requests and queues |
| **Make** the map | this laptop, S1–S6 | needs live data, network and judgement — the portal is deliberately deterministic, no network, no AI at render time |
| **Deliver** into the portal | `import-map.mjs` / `propose-update.mjs` | writes the portal's SQLite + object store |

This skill is the spine across all three. It does not replace `make-bus-leaflet` / `make-place-bus-leaflet` — it *calls* them, then does everything either side.

## Asked about ONE map? Use `town_status.mjs`, not the worklist

The worklist answers *what needs doing across the estate*. **"What is the status of Ramsey?" is a different question**, and answering it from the worklist or the board gets it wrong: on 2026-09-10 `status.js` reported `Ramsey 3.9 · PASS PASS PASS · ok` about a map that was returning 404 to the public, had been invisible for thirteen days, and had a correspondent waiting seven days for a reply. Every column was honest — they answer *does the current engine reproduce the committed sheet*, which is not the same question.

```powershell
node "%BW%\town_status.mjs" "Ramsey"
```

**Any directory.** One argument, the map's name — a town, a nested place or a standalone place; it finds all three by looking for `manifest.json` rather than by a list it carries. It joins the four things nothing else crossed: the **build** (version, S6 age, hard/soft), the **live site** (`/api/public/maps` — *published* and *visible* are different facts, and a map with a published version stays hidden while `public_listed` is 0), the **people** (every `Correspondence/CORR-nnn/` thread that declares this map on its `**About:**` line, reported even when nothing is pending), and the **questions we asked a real person and never got back** (`local-decisions.json`).

**It leads with whatever is worst, not with the build.** If a map is invisible to the public, that is its status whatever the gates say.

Exit **0** nothing needs attention · **1** something does · **2** used wrongly, or a fact could not be established. `--offline` skips the site, `--json` gives the same facts without the ordering opinion, `--url` points at another portal.

**An unreachable portal is not an invisible map**, and the tool refuses to conflate them: a failed fetch exits 2 saying *"This is NOT a report that the map is missing"*, because the opposite would send somebody to re-publish a map that was never off. Its falsification harness is `prove-red-town-status.mjs` — nine cases, each negative paired with the positive that proves the check can fire at all, including the real bug that paid for it (a thread README naming another map's adviser in prose was reported as correspondence about that map). Run it after touching either file:

```powershell
node "%BW%\prove-red-town-status.mjs"
```

**It runs no byte gate and re-renders nothing** — for gates, vendoring drift and the quality ratchet, that is still `status.js`.

## Step 1 — Print the board AND the worklist, and show Peter both (always start here)

**Peter expects the board every time this skill runs, and has had to ask for it more than once** (2026-09-23: *"once again you did not list the board"*). The board is `status.js` and it answers a different question from the worklist: the worklist ranks what is WAITING, the board shows the STATE of every map — version, engine, gate PASS/DIFF, S6 age, feed staleness, vendoring drift, the quality ratchet, commitments and the deployment. Some of that appears nowhere on the worklist (on 2026-09-23 the FEED STALE booklets were on the board only), and the board is also what corrects the worklist when they disagree (that day the worklist warned of a deploy mismatch that the board's fetch showed was only a stale local clone). So run both, and open the answer with a compact summary of the board — towns, places, portal, deployment, quality, commitments, exit code — before the ranked worklist. Run it from `C:\Buses\claude-skills\make-bus-leaflet` — the engine's own folder, as buses-data's `CLAUDE.md` requires; both arguments are real paths, neither is a placeholder:

```bash
node assets/status.js --buses "C:/Buses/buses-data" --portal "C:/Buses/community-bus-maps"
```

It re-runs every byte gate, so it takes about a minute; start it alongside the worklist rather than after it.

**Never pipe either command through `head` or `tail`; redirect each to a file in the scratchpad and read the file** (2 Oct 2026: `status.js | tail -80` dropped the towns and places tables and the exit code, and `worklist.mjs | head -200` showed 10 of 91 items without saying so). A pipe also loses the board's exit code, so append `echo "exit $?"` to its file. The worklist is about 900 lines: `Grep` its `^\s*(\d+\. |──)` headings for the ranked list, then `Read` the rows you will quote. If any part was not read, say so in the answer.

Let `BW=C:\Buses\claude-skills\bus-work\assets` (this skill lives in the bus skills repo alongside `make-bus-leaflet`, and is junctioned into `~\.claude\skills\` like the others).

```powershell
node "%BW%\worklist.mjs"
```

**Any directory.** Unlike everything in [references/playbooks.md](references/playbooks.md), this one does not care where you are: it is invoked by absolute path and reads nothing relative to the working directory. Every command in the playbooks does care, and each carries its own `cd` for that reason.

The same list is on the web at **`/app/admin` → To do** (the admin landing tab) — same ranking, same wording, because both call the portal's `src/worklist/index.js`. The terminal version adds what only this machine can see: failing gates, engine-stale renders, missing S6, and towns with a leaflet but no portal map.

Read-only, safe to run at any time, and safe while the dev server is running (the portal DB is WAL). The plain board takes about 35 s on this laptop (measured 2026-09-26, buses-data OA-476), and most of that is the stranded-branch sweep in `unpushed_branches.mjs`, which asks git several questions per LOCAL branch in all three repositories — so it grows with the branch count, and before it asked them eight wide it took 118 s and outlived the Bash tool's 120 s limit. If it is creeping back towards that, time it rather than raising the timeout: the per-branch cost is in that file's `POOL` comment. Add `--json` when you need to act on the fields, `--gates` to also run the full byte-identical gate sweep (slow — a minute or two; only worth it after an engine change or before a batch of deliveries). Four more flags change what it reads, and none of them was written down anywhere until 2026-09-28 (codebase review, satellite F16): `--engine <path>` names the claude-skills checkout instead of finding it from this skill's own folder (`BUS_ENGINE_REPO` does the same); `--live <url>` asks another site than `https://busmaps.uk` whether a merged portal change is deployed, where `--no-live` skips that question; `--no-ci` skips the `gh run list` per repository that says whether one is standing red (`BUS_WORKLIST_NO_CI=1` does the same); and `--no-conditions` leaves out the `CONDITIONS` block. The full list is whatever `parseArgs` in `worklist.mjs` reads, which is the one to trust over this sentence.

**Pass `--session <this session's name>` — the name `ListAgents` gives THIS session, `buses-29` rather than `Claude`.** It is the name the loop lock is held under, and without it the `loop-lock` row cannot tell your own lock from a neighbour's and says so. (Backlog claims, which it also used to subtract, were retired by buses-data OA-578: `git log --oneline --since=midnight` shows the same collision.) That is the one flag worth remembering; everything else has a default.

**`--self-id <uuid>` is the second one, and only a scheduled tick needs it** (buses-data OA-294, 2026-09-11). It is this session's own transcript id — the UUID on its scratchpad path, `…\Temp\claude\<project>\<uuid>\scratchpad`, which is the basename of its own `<uuid>.jsonl`. It buys one field, `conditions.peers.quiescentMin`: the age in minutes of the newest turn taken by any session **other than the caller**, which is the only form of the question a session taking a turn can usefully ask. Without the flag that field is `null`, and **`null` means *cannot tell*, never *quiet*** — so does an id matching no transcript, and so does a disk with no other session on it. It is a measurement and nothing scores it or acts on it.

### Is it safe to do this right now? — the concurrency verdict

**Every row carries `SAFE NOW`, `CHECK FIRST` or `BETTER TO DELAY`, and a `CONDITIONS` block above the bands states each contended fact once.** Printing the list is read-only; carrying an item through writes into trees several sessions share, and sometimes deploys. `node "%BW%\worklist.mjs" --conditions` answers *can I do anything at all right now* without gathering a queue; `--safe-only` filters the list strictly, so a workable `CHECK FIRST` row is hidden by it. ([why](references/why-these-rules.md#is-it-safe-to-do-this-right-now--the-concurrency-verdict-oa-221-2026-09-01))

**A dirty tree is `CHECK FIRST`, not a delay** — `git status` cannot say whose files those are. **Only two things earn `BETTER TO DELAY`**: an estate-wide sweep while `Areas/`, `Places/` or `ci-reference/` is dirty, and a deliver or deploy while the portal checkout is off `main`. A modified `Correspondence/**/*.md` that a live `loop/your-move/` hold names is **accounted for** and subtracted, and the block prints the subtraction rather than hiding it.

**A count that could not be taken is never a count of zero.** The conditions block prints `unpushed UNKNOWN` and git's reason. No verdict reads buses-data's unpushed count, because nothing a deliver runs reads buses-data's pushed `main`. ([why](references/why-these-rules.md#is-it-safe-to-do-this-right-now--the-concurrency-verdict-oa-221-2026-09-01))

**A decision is never held back, and that is the most useful thing on the list.** A publish review, an application, a map-request decision, a chase and a drafted reply touch no working tree, so when everything else says wait, those are what to offer.

**A DETACHED portal checkout is asked two questions, because deploy residue and stranded work look alike and only one of them clears itself.** If the detached commit is already on `origin/main`, nothing is stranded: the row reads `CHECK FIRST`, names the worktree holding `main`, and prints the `git -C "<portal>" checkout main` that clears it. If it is not, somebody's commits are sitting on no branch at all and `BETTER TO DELAY` stands. A named feature branch still reads as somebody working. No `origin/main` to compare against, or a git call that failed, reads `COULD NOT LOOK` in as many words and takes the **stricter** verdict, because a refusal read as an absence measures the instrument instead of the subject. The conditions block prints a `detached` line carrying the same finding, and nothing at all over a checkout that is on a branch. ([why](references/why-these-rules.md#a-detached-portal-checkout-oa-387-2026-09-17))


**Falsified** from this folder, no placeholders: `node prove-red-concurrency.mjs`.

### The scheduled loop holds a lock, and this is where you see it

**A tick takes `loop/LOCK.d` before its unit of work, and `loop/` is gitignored, so no `git status` can ever see it.** It is the `loop-lock` resource: a live tick is `BETTER TO DELAY` on every row touching the shared trees. ([why](references/why-these-rules.md#the-scheduled-loop-holds-a-lock-and-this-is-where-you-see-it-oa-287-2026-09-08))

**Take the lock yourself before heavy work** — an S1–S6 build, an estate sweep or rollout, `quality_gate.js --accept`, or an engine change — and not for ordinary document or backlog work, which several sessions must go on doing at once. From the buses repository root, `C:\Buses\buses-data`, with no placeholders:

```bash
mkdir "loop/LOCK.d"
```

Non-zero means somebody holds it. Write `loop/LOCK.d/holder` with **your session name first** — the name `ListAgents` gives this session — then the time, and a second line `expires:` at most ninety minutes ahead. **Releasing is the part you owe**, because a tick never steals from a name that is not a tick's:

```bash
rm -rf loop/LOCK.d
```

Relative, not absolute: both allow rules are written relative, and the absolute form is a fresh permission prompt at the worst possible moment.

**Your own lock reads `SAFE NOW`**, and so does a tick's past its lease, because step 3 of the loop's prompt is where the steal rule lives. A person's lock past its lease is `CHECK FIRST`: nothing will clear it for you. **Falsified**: `node prove-red-loop-lock.mjs`.

### Whether the loop is DOING anything, which is a different question

**A HALTED loop holds no lock, which is exactly what a healthy idle loop looks like.** `loop_runs.mjs` raises one row, `loop-idle`, from the NAMES of the files in `loop/runs/` and nothing else: `-none` stopped before dispatch, `-around` did real work but never reached `buses-data`, and `-missed` is a scheduled run that left no file of its own, written up by a later tick from the scheduler's run list (buses-data OA-408). A `-busy` run stood down only because another tick held a live lock; it neither continues nor breaks the count and is out of the idle ratio altogether. A second row, `loop-silent`, is a chore for the loop that wrote NO file: `readSessionTurns` reads the Buses transcripts, and the row is raised when sessions were working after two scheduled runs that wrote nothing — a false alarm preferred to silence (buses-data OA-408 item 3). **Lateness is measured against the cron line in `loop/README.md`** (buses-data OA-608): a run is late only when a scheduled fire has passed by 90 minutes with no run file since, so the normal nine-hour gap of a three-a-day loop raises nothing. Only a README with no cron line falls back to the median gap between run files, which kept the old hourly cadence for days after OA-577 changed it. ([why](references/why-these-rules.md#and-whether-the-loop-is-doing-anything-which-is-a-different-question-from-whether-it-is-running-oa-288-2026-09-09))

**The row says WHY, from the same `conditions` block printed above the bands**, so it can never contradict it. A forgotten `loop/STOP` or a dirty shared tree is rank 3 in `SOMEONE IS BLOCKED`; a lock held by a person stays at rank 8, because the loop is correctly deferring to somebody at the keyboard. **Two silences are deliberate**: a merely old newest run raises nothing, and the threshold is two consecutive, derived from the median gap between run files. **Falsified**: `node prove-red-loop-runs.mjs` — read its GREEN cases.

**A loop that works can still be working round a request of Peter's.** `loop_ready.mjs` raises `adhoc-not-taken/<file>` at rank 3 for a file in `adhoc/ready/` that is more than three hours old, that two or more recent run files name without taking it, and that the newest run to name it also passed over. It reads *The ad-hoc loop is not taking this*, and it is not a triage row, because a ready/ file is already promoted. It is the one reader that opens run files. It depends on two forms the ad-hoc prompt fixes: the bold `**Feed: adhoc — <file>…**` line of a run that took the file, and `` `<file>` (not due: <why>) `` for one that passed over it (buses-data OA-503). A file sorting after the one an `-adhoc` run's Feed line took is **queued**, not passed over, whatever the run wrote about it, because a run takes one unit in filename order (buses-data OA-638, 2026-10-13: five red rows for files that were only waiting). On 2026-09-28 the ticks named two ready/ files 34 times and took neither, and nothing said so. Since buses-data OA-610 (2026-10-08) the queue is a separate scheduled loop, `adhoc-loop`, with its own folder: the row reads `adhoc/ready/` and the run files in `adhoc/runs/`, and for its 48-hour window `loop/runs/` too, so the move left it blind to nothing. **Falsified**: `node prove-red-loop-ready.mjs`.

### Which portal you are looking at, and what the credential is

**`worklist.mjs` reads the LIVE site by default.** `BUSMAPS_URL` and `BUSMAPS_TOKEN` live in `C:\Buses\community-bus-maps\.env`, which it loads for itself; with neither set and no `--local` it prints the two lines to add and exits 2 rather than opening the dev SQLite. `--local` is the dev checkout and beats a configured `BUSMAPS_URL`; `--local --url` together is a refusal. **`--local` exits 2 naming the path when the database the portal's `src/db/paths.js` resolves to does not exist** — importing the db module would create an empty one and report an empty portal, which is what a stale `DATA_DIR` did for five days in October 2026 (buses-data OA-613); fix `DATA_DIR`/`DB_PATH` in the portal's `.env`. The falsifier is `npm run test:prove-red-local-db`, run from `C:\Buses\claude-skills\bus-work`; it has no placeholders. **Say which portal it was in the first line of your answer to Peter.** ([why](references/why-these-rules.md#remote-portals--the-honest-state))

**Send the TOKEN, not a cookie.** `BUSMAPS_TOKEN` carries the portal's `OPERATOR_TOKEN` as a Bearer header and is read-only over three GET routes; a `cbm_session` value is a PERSON's live admin login and only four portal routes sit behind step-up. Rotate with `npm run rotate:secret -- OPERATOR_TOKEN` from `C:\Buses\community-bus-maps`, which never prints the new value — read it out of the host's `.env`.

**Demo rows are hidden unless `--demo`, and the test for a seeded record is the ADDRESS, never the name.** RFC 2606 and RFC 6761 reserve `example.com` and the `.example`, `.test`, `.invalid` and `.localhost` TLDs, so an applicant who cannot be emailed is nobody waiting. Absence of a demo label is not evidence of realness.

**The operator half is browser work.** Accepting a staged refresh, withdrawing a publish request and changing a map's outputs need a signed-in admin session; reading and delivery both work from this laptop.

## Step 2 — Pick one

- If the invocation already names one ("do the St Ives refresh", "build the Waitrose map", "/bus-work 3"), take it and skip the question.
- Otherwise show the list and ask which — **one message, one question**. Recommend the top item unless something lower is obviously more urgent, and say why in a sentence.
- **Prefer a `SAFE NOW` row when the top one is `BETTER TO DELAY`**, and say that is why. A held-back row is not dropped from the list and Peter can still choose it — the verdict is advice with its evidence attached, not a lock — but the recommendation should be something he can finish. If he takes a delayed row anyway, do the thing the reason names first: read the uncommitted files, or get the portal checkout back on `main`.
- If the list is empty, say so plainly and stop. Do not invent work.

## Step 3 — Do it

**First, unless this item builds or renders a map, do it in a worktree** — `EnterWorktree`, or `git worktree add .claude/worktrees/<name> -b work/<name>` from the repository root (OA-395, R2 of the 2026-09-17 process review: one writer per tree). A `gate` diagnosis, an approval-gate `review`, an `awaiting-customer` nudge and a `draft-unsubmitted` evidence pass all write only tracked files and belong in a worktree. A `build`, a `refresh`, a `refresh-local` and any `housekeeping` that re-renders a sheet write a map's untracked S4–S6 output; an interactive session still starts in a worktree and runs `stage.js attach --as <session>` from the town folder, which takes the town's lock and links those folders into the main checkout (OA-552), while a scheduled tick works in the main checkout under `loop/LOCK.d`. Where a build may run is stated once, in the convention is the *So: what belongs in a worktree* section of buses-data's `Documentation/README - Working in parallel.md` (named rather than linked, because a relative link across a repository boundary 404s for everyone but this laptop).

Load [references/playbooks.md](references/playbooks.md) and follow the playbook for that item's `type`. One item at a time, start to finish, before offering the next.

The types and where each ends up:

| `type` | What it is | Ends with |
|---|---|---|
| `gate` | the engine no longer reproduces a committed map | diagnosed; nothing else ships until it is |
| `review` · `application` · `request-decision` | one of the **three approval gates** | Peter decides in the portal UI — **never decide for him**. An AREA request carries the town's **complexity band** off its newest S2 run, or says UNSCORED with the S1→S2 step that scores it for free (buses-data OA-088); RED is the pipeline's one *not a single-sheet town* verdict, and approval is the quota gate, so the band belongs BEFORE the decision |
| `build` | an approved request with no map yet | map imported, v1.0 verified byte-identical |
| `refresh` | a portal map whose services are changing. Since 2026-10-08 the row carries `effectiveDate`, the earliest date the scan itself wrote into its section ("registered to start" or "registered only to"), and inside its rank the sooner date comes first, undated rows last (`refresh_deadline.mjs`) | proposed update staged for the customer |
| `refresh-local` | a town leaflet with no portal map | new S5 render + `_latest` refreshed |
| `delivery` | **one `undelivered-<slug>` row per portal map whose newest S5 render here post-dates the portal's last delivery of it AND whose ink differs from the live public sheet** (since 2026-10-16; `undelivered.mjs`). Times come first, the portal's `lastDeliveryAt` against the render's `at`, because nothing on the host records which render a delivery came from; then, since 2026-10-19, each live sheet (`/api/public/maps/<slug>`, its `outputs[].svgUrl`) is compared with the same sheet in the newest S5, the pilot wrapper removed and the version stamp blanked, and the row is raised only when one differs, its differing text lines in the `why`. With no public sheet to read, the time test stands and the row says so. A row whose map a `loop/your-move/` hold names is folded into that hold, and a blocked-S6 row an open action owns is folded into that action (`meta.folded`). It covers only maps the live site lists, and a portal that predates the field gives one warning and no rows. A render held on purpose keeps its row until it ships or is superseded; whether it ships is Peter's call, because a delivery mails the customer ([the playbook](references/playbooks.md#delivery--one-undelivered-slug-row-per-map-since-2026-10-16)) | delivered (`npm run deliver`), so `lastDeliveryAt` passes the render |
| `housekeeping` | engine-stale renders -- **one `engine-rebuild-<map>` row per map since 2026-09-22** (buses-data OA-430; since 2026-10-10 the PRINTED board folds them, like the `fresh-pull-<map>` rows, into one row per command listing the maps, while `--json` keeps a row per map for the ticks, `row_groups.mjs`, buses-data OA-608), towns and places alike, and since 2026-10-08 only for a map the live site lists (buses-data OA-607; one off the portal is rebuilt when next activated), because each map is gated against the engine recorded in its own reference and so being behind is a chore a tick can work one at a time -- missing S6, **S6 claims** — a red-team claim about a service with no home, or the queue of `service-facts.json` entries awaiting a decision (buses-data OA-273) — since 2026-09-17 a **deploy pending** on the portal (`deploy-pending`, buses-data OA-396), and since 2026-09-18 the **monthly BODS scan not having run** (`bods-scan-overdue`, buses-data OA-402, R9), and since 2026-09-28 a **refresh that ran and was never committed** (`gtfs-uncommitted`, buses-data OA-505), and since 2026-09-30 **one `fresh-pull-<map>` row per town or place whose stored landmark pull does not ask today's `pois_query()`** (buses-data OA-499, places since item 2; [the playbook](references/playbooks.md#fresh-pull--one-fresh-pull-map-row-per-town-or-place-since-2026-09-30)), and since 2026-10-13 **one `adopt-knobs-<map>` row per town or place whose newest S3 still types a layout the engine now places itself** (buses-data OA-437; a session's, never a tick's; [the playbook](references/playbooks.md#adopt-the-placed-layout--one-adopt-knobs-map-row-per-town-or-place-since-2026-10-13)), and since 2026-10-22 **one `s1-unhoused-<map>` row per town or place whose newest S4 ships an S1 service with no home on the sheet** (buses-data OA-655; written at the map's next S3, never a tick's; [the playbook](references/playbooks.md#give-an-s1-service-a-home--one-s1-unhoused-map-row-per-town-or-place-since-2026-10-22)), and since 2026-10-10 **a portal checkout with no `node_modules`** (`portal-deps`, buses-data OA-567; the repair is `npm --prefix "<portal>" ci`, never a junction). None of these reddens the board any more: each is a chore, and this row is what chases it | rollout applied / S6 run / every claim has a home and the queue is worked one entry at a time / the portal deployed / the monthly refresh re-run / the refresh committed by name / the town re-pulled and rebuilt in stage order / a new S3 that drops the typed layout, rebuilt and accepted / each service's home written in the map's next S3 |
| `awaiting-customer` | staged, they haven't accepted | a nudge, or nothing |
| `draft-unsubmitted` | a version saved and never sent for review | evidence prepared; Peter submits and approves |

## Step 4 — Close out

Every time, without being asked:

1. **Re-run the worklist** and confirm the item is gone. If it is still there, it is not done — say so.
2. Tell Peter what changed in one or two lines: the version number, the map, the customer, what the next actor is.
3. If anything about the *procedure* proved wrong or fiddly, fix it here (this file, the playbooks, or `worklist.mjs`) in the same session rather than leaving it for the next one. **This file keeps a rule sentence and the command for each tool; what a tool asks, refuses and writes goes in [the tool reference](references/tool-reference.md)**, because this file has a word ceiling, `SKILL_WORD_CEILING` in `make-bus-leaflet/test/skill_word_ceiling.test.js`, which `npm test` runs (buses-data OA-646).
4. **End the message with the cost tag**, on a line of its own, so buses-data's `BusMapsUK/ai-cost/measure-ai-tokens.mjs` charges the tokens to the right bucket: `cost-tag: [update:<map>]` for a refresh, rebuild or fix of existing maps (several comma-separated, each by its folder name under `Areas/` or `Places/`), `cost-tag: [setup:<map>]` for a map's first build, `cost-tag: [dev]` for engine, portal or tool code, `cost-tag: [overhead]` for a review, an application, correspondence or anything else.

## Asked whether the LOOP is blocked? Use `loop_health.mjs`, not the worklist

The worklist raises a `loop-idle` row when ticks keep stopping before dispatch, but it does not say why, what dated thing is coming, or whether commits are waiting for a push. `node loop_health.mjs` answers all of it in one read-only pass (buses-data OA-554): a verdict (BLOCKED, AT RISK or CLEAR), each finding as BLOCKING, AT RISK or NOTE with the one move that clears it, and a look-ahead over the dates already written into the action files and `commitments.json`. It exits 1 on a BLOCKING finding and 2 if the directory is not buses-data, so a tick can gate on it. **The backlog is not the loop's supply** (buses-data OA-576, 2026-10-07): the loop does map upkeep only, so the report prints the backlog's counts as information and never as work a tick could take, and a tick that dispatched and found nothing writes `-idle`, which the idle count ignores. Run from `C:\Buses\claude-skills\bus-work\assets`, no placeholders:

```powershell
node loop_health.mjs --buses "C:/Buses/buses-data"
```

**It also answers "could a tick take any work, by its own prompt?"** in a section headed `CAN A TICK DO WORK?` (CAN WORK, NOTHING TO DO or BARRED), and ends with the levers that release the most rows. Add `--deep` for the bus-work feed and for whether the ticks can clear the refreshes in time, and `--no-probes` to skip the spawned commands. What each reading asks is in [the tool reference](references/tool-reference.md#loop_healthmjs-the-deeper-readings).

Its falsification harnesses are `npm run test:prove-red-loop-health` and, for the date, the order and the arithmetic, `npm run test:prove-red-refresh-deadline`, both in `bus-work`; each breaks its module one line at a time and requires the same assertions to go red.

## Committing named paths — `commit_paths.mjs` (buses-data OA-617)

**One script does the sequence every session used to hand-assemble:** stage by name, review the diff, commit by pathspec, read the commit back by content. Write the message to a file with the Write tool (nothing in it then passes through a shell), then run it twice, from anywhere. Placeholders: `<repo>` is the repository or worktree root, `<branch>` the branch it must be on, `<file>` the message file, `<path>` a file inside `<repo>` (never a folder or a pattern), `<token>` what the first run prints. The first run commits nothing and prints the paths, `git diff HEAD` of them and a review token; read the diff, then:

```bash
node "C:/Buses/claude-skills/bus-work/assets/commit_paths.mjs" --repo "<repo>" --branch <branch> --message-file "<file>" -- "<path>" "<path>"
node "C:/Buses/claude-skills/bus-work/assets/commit_paths.mjs" --repo "<repo>" --branch <branch> --message-file "<file>" --apply --reviewed <token> -- "<path>" "<path>"
```

**It refuses, and commits nothing, when** the token no longer matches, a path is a folder, a pattern or outside the repository, somebody else has already staged a named path, or the checkout is not on `<branch>`. **It then reads the commit back by content, and a first line of `COMMITTED <sha> - READ-BACK FAILED` means the commit is already in the history:** repair it with a new commit and never commit again. An untrack or a file-mode change is committed with `--index`, after `git rm --cached "<path>"` or `git update-index --chmod=+x "<path>"`. Exit 0: reported, or committed and read back. 1: a hook refused, or the read-back failed. 2: refused before any commit. 3: git's index is locked, try again. The read-back's rules, the restamp repair and why it never passes `--literal-pathspecs` are in [the tool reference](references/tool-reference.md#commit_pathsmjs-refusals-the-read-back-and---index).

Its tests are `npm run test:commit-paths`, and `npm run test:prove-red-commit-paths` removes or weakens each `@guard:` line of the script in a scratch copy and requires the matching cases to go red. Both are in `bus-work`.

## Before you push — `preflight.mjs` answers *what would go red if I pushed now*

**Run it once per ROUND, before the first push of a change that reaches map data, the engine or a workflow** (buses-data OA-343, from Peter on 2026-09-14: *I want us to avoid the system being in a BROKEN state*). Landing OA-338 left `buses-data` `main` red for about seven hours and met four independent blockers one at a time — byte-gate control diff, portal vendoring drift, the deployment row BEHIND, the portal's own `verify:area` on a stale committed fixture. Every one of them was true before the first push and answerable on this laptop in under two minutes, and three CI round trips were spent discovering them in sequence. From anywhere, with the repository written into the command rather than stated beside it, and with no placeholders:

```bash
node "C:/Buses/claude-skills/bus-work/assets/preflight.mjs" --repo "C:/Buses/buses-data"
```

**Push with `--push`, not a separate `git push`** (buses-data, 2026-10-19). A green answer is about the commit it measured, which the report prints, and a shared `main` can gain another session's commit while the checks run: that night `git push origin main` carried `3c4b5a87`, which no preflight had seen. On exit 0, `--push` pushes exactly the measured commit and reads origin back. If HEAD moved, it pushes nothing and exits 2, so run it again. `push_main.mjs` does the same and exits 3, and its next run carries both.

**Exit codes are this repository's: `0` nothing would go red, `1` something would, `2` it cannot tell you** — an undeclared repository, a branch with no upstream, or a check it could not run — **and `3`, DEFERRED: not yet.** On 3, do not push: the commits wait on local `main` and `push_main.mjs` carries them. `--urgent "<why>"` pushes inside the interval, for a red `main` or a cross-repository pairing only. `--all` forces the full tier and `--json` prints the machine-readable form. `npm run test:prove-red-preflight --prefix "C:/Buses/claude-skills/bus-work"` is the harness. Which checks each tier asks, the four load-bearing properties and how the push interval is paced are in [the tool reference](references/tool-reference.md#preflightmjs-and-push_mainmjs-in-full).

**`push_main.mjs` carries a deferred `main` to origin with no model in the loop**, behind the same preflight. It never passes `--urgent` and never force-pushes, and every `--apply` run also fast-forwards the engine checkout it runs from. Without `--apply` it only reports. From anywhere; the repository is the one placeholder, the buses-data checkout whose local `main` is to be carried:

```bash
node "C:/Buses/claude-skills/bus-work/assets/push_main.mjs" --repo "C:/Buses/buses-data" --apply
```

`npm run test:prove-red-push-main --prefix "C:/Buses/claude-skills/bus-work"` is its harness.

## Closing a session

In an interactive session, finish by running `/close-out` in buses-data: it is the one place the close-out (open actions, leftovers, glossary, lessons, tidy up) is written. An unattended run, such as a loop tick, does not run it and files its leftovers to its own queue.

## Rules that override convenience

- **Never decide an approval gate.** Organisation approval, map-request approval, and publish review are Peter's judgement and the system's integrity. Prepare the evidence, summarise it, open the URL — then stop.
- **The month's ink review is the one gate a session may answer, and only by rule** (2026-10-14, Peter's ask). Run `node ink_review.mjs --scan <scan date> --self-answer --by <session>` from `bus-work/assets`: it prints a verdict per unanswered map and writes nothing; add `--apply` to record them and commit the record. `<scan date>` is the scan the review was drawn from, e.g. 2026-10-01; `<session>` is your session's name. It accepts a map only when every string on every moved sheet is unchanged, the build's inputs are unchanged or differ only by an OA-437 adoption Peter accepted on another map or by a note's `handPlaced` reason or `fact`/`factWords` tag, which move no ink, and every engine commit that touches the moved sheet's generator was already accepted by Peter on another map, with no open hold. Everything else stays `waiting` with a one-line `selfCheck.reason`, which the page and the worklist row show. Two more things count since buses-data OA-659. First, **a ruling of Peter's covers the words it names**: when he rules a value and you rebuild on it, record the ruling on the S3 run before you commit, with `node ink_review.mjs --rule "<map folder>" --s3 <S3 id> --path <path>[,<path>] --said "<his words>" --where "<commit or thread>" --apply`, from the same folder. `<map folder>` is the map's folder under buses-data, such as `Areas/Beaconsfield/Places/Beaconsfield Waitrose`. `<S3 id>` is the S3 run you built from. `<path>` is the routes.json path he ruled, such as `internalDesc.31.1`, and its value is read from that S3 run. Add `--on <date>`, such as 2026-10-18, when you record a ruling after the day he gave it. Commit `manifest.json` with the rebuild. Second, **a delivery Peter queued in `adhoc/` with a sentence starting "Deliver" that names the exact build** (`<map> v<version>` or the full build id) is his accept. The rule is also asked from the newest earlier build Peter accepted on the map, not from the review's before, so a ruling-only rebuild of a map he has already accepted needs no second look. Never answer a map Peter has to see with `--answer --by <session>`: `--answer` is how Peter's own words are recorded, and each one becomes a first sighting that later self-answers stand on. The rule and its limits are in `assets/ink_self_answer.mjs`'s header; the procedure is in `references/playbooks.md` §*refresh*.
- **Never hand-edit a rendered file.** Corrections go through a new version, always.
- **Never relax a gate to make it pass.** A `verify` that says DIFF is information, not an obstacle.
- **If you push something you already know will go red, BEGIN the commit subject with `[expected-red]`** (OA-251, 2026-09-05). `ci_state.mjs` reads it off the run's `displayTitle` — which is the commit subject — and ranks that repository's red row at 8 rather than 0 for six hours, so the next session can see somebody meant it. **At the START, not merely somewhere in the message**, or a commit whose body only *describes* the convention trips it — which is exactly what the first version did. **It changes nothing about the email, and do not try to make it:** GitHub titles a "Run failed" notification from the workflow's static `name:`, so nothing can vary one failure email's subject against another's — measured 2026-09-05 on a deliberate red (run `33970616137`), whose mail reads `[PeterC66/claude-skills] Run failed: Bus leaflet gates - main (5bb4752)`. A `run-name` expression was fitted to all six push-triggered workflows across the three repositories and **removed the same day**: it reached the email's BODY, and Peter's inbox list does not show the body. A line nobody sees is not a signal.
- **`npm run verify` skips silently** when its fixture dir is unset — a green run with no byte counts proves nothing. Require the word PASS *and* byte counts before calling an import verified.
- **PowerShell is the shell.** `FIXTURE_DIR=… npm run …` is bash and silently does nothing here; use `$env:FIXTURE_DIR = "…"; npm run …`. The worklist already emits the PowerShell form.
- **Stop the dev server before any command that writes directly** to a *local* portal (`import-map.mjs`, `propose-update.mjs`, `seed-demo.mjs` run in place). Reading — including this worklist — is fine either way. `npm run deliver` (below) is different: it runs against the live VPS over SSH and stops *that* service itself, briefly, as part of its own sequence — it doesn't touch your local dev server at all.
- **A town's refresh reaches the live site through `stage_refresh.mjs`** (see the `refresh` playbook): it is the only path that enforces the month's ink gate, and it runs `npm run deliver`, which runs the portal's `propose-update.mjs`, as its own internals. `stage_refresh.mjs` stages a place as it stages a town; `npm run deliver` by hand is for a map outside the month's review, and a hand delivery of one IN the review is recorded with `ink_review.mjs --staged` (buses-data OA-573), and `propose-update.mjs` by hand is for local dev only. Each delivery emails the customer and briefly restarts the portal, so a multi-map pass means one of each *per map* — warn them first. **The live portal must already run the engine the renders were drawn with:** step 2 verifies on the host with the host's `engine/`, so a render from a newer re-vendor dies there with `Cannot find module '/app/engine/…'` (St Neots, 2026-10-01, host a96a758 behind origin/main's #452/#455). Since community-bus-maps #458, step 0d checks this before the scp and refuses naming `npm run deploy`; run that from the portal root, then deliver.
- **The operator actions after delivery are still HTTP endpoints needing an admin `cbm_session` — withdraw a publish request, change a map's outputs, and a single accept/publish are still browser work.** But a *batch* of several already-reviewed maps has a script now: `community-bus-maps/scripts/accept-publish-batch.mjs` (`npm run accept-publish`, added 2026-08-19, PR #54) drives withdraw→accept→submit→approve→live-verify for a named list of staged maps in one run, and sends ONE grouped digest email per customer for the whole batch instead of one "is published" email per map (`suppressNotify` + `POST /api/admin/notify-published-batch` — a batch used to mean N emails to the same inbox, confirmed via `/health?deep=1`'s `customers` count on the 2026-08-19 pilot). **This does not relax the rule above it.** `--reviewed-by "<name>"` is mandatory and the script never looks at a rendered sheet itself — it only executes a decision that has already been made by someone who opened every sheet at full resolution first, same as this skill preparing evidence and stopping before a gate. Two orderings the portal enforces in code and will surprise you otherwise, whether run by hand or through the script: an open publish request makes the accept fail with a **409** until it is withdrawn, and an expert output (`internal_schematic`, `boarding_plan`) cannot be switched on until the map’s live `routes.json` carries its opt-in key — so that toggle is gated on the refresh landing first. **And a third, which the batch script does NOT handle: a map carrying a boarding plan needs a version SAVED between the accept and the submit**, because granting an output renders nothing and this is the one output with no other act to carry the render — run the script on such a map and it publishes it with the sheet missing. See `references/playbooks.md` §*Output toggles*. **For the full step-by-step — where to review (`Collected_latests`, not the portal), the exact command, what every flag means — see `references/playbooks.md` §*bulk-accept-publish*, not this bullet.**

## This worklist now has an UNATTENDED consumer, and two of its outputs are load-bearing to it

Since 2026-09-07 a scheduled task in `buses-data` — the design is `loop/README.md` there — works this worklist without a person, one row per timer tick, each tick a fresh session. It depends on two things this skill emits, so **check them before changing either shape**.

**`worklist.mjs --conditions --json`.** The loop reads the per-resource verdicts out of the JSON and stops unless every resource its intended work touches says `safe`. It never reads the exit code, because that command always exits 0. **An unattended run collapses `CHECK FIRST` into stop** — the three bands were written for somebody who can go and read whose uncommitted files those are, and there is nobody. So a verdict that becomes vaguer, or a resource key that is renamed, silently changes what an unattended run will refuse to do. **And the subtraction runs the other way**: since OA-301 the `buses-tree` verdict leaves out a held letter that a `loop/your-move/` hold names, so the JSON can say `safe` while `git status` shows a modified file — a tick that re-reads the tree by hand and treats that as a contradiction has misread the design. The file is in `conditions.repos.buses.accounted`, with the hold's ref, and it is never a tick's to touch. **Since OA-434 (2026-09-22) dirt inside one map or letter folder is fenced as well**: unstaged dirt under one `Areas/<X>/`, `Places/<X>/` or `Correspondence/CORR-nnn/` folder, outside `ci-reference/`, leaves `buses-tree` and is counted by `buses-maps`, which only work that writes into such a folder needs. The JSON's `resources` block gives one verdict per resource, and that block is what a tick reads.

**`rank`, and the fact that rank alone is not enough.** The loop takes the lowest-ranked row it can **finish without a human**, which is a filter this skill does not express: of the twelve rows standing that morning, six were blocked on Peter or on a third party and would have sat at rank 1 for ever — two publication reviews, two drafted-but-unsent replies, questions asked locally, an update waiting on a customer. It also learned the hard way that **a CI red belonging to another session's in-flight vendor inside its grace is not work to pick up.** If a future row type is added whose rank implies actionability it does not have, that is where it will go wrong.

Both rules are stated for the loop in `loop/README.md`; they are repeated here because this is the file somebody edits when they change the worklist, and the coupling is otherwise invisible from this side.

## What feeds the worklist

Nothing here is a new source of truth; it is a join over what already exists. Each source, the ranks it gives, its harness and why it is built the way it is are in [the tool reference](references/tool-reference.md#what-feeds-the-worklist). The rules a session acts on:

- **If a queue is missing from the list, fix the source that owns it** — a portal queue in `community-bus-maps/src/worklist/index.js`, which fixes the admin console at the same time, and a local-tree signal in `worklist.mjs`. Do not work around a gap by reading the admin console separately; that is the habit this skill exists to end.
- **A refresh row you have answered is cleared by recording the answer, not by rebuilding** (buses-data OA-205). A newer scan brings it straight back, re-adjudicating a scan replaces its entry and keeps the old one in `superseded[]`, and adjudicating a town does NOT adjudicate a place inside it. From `C:\Buses\claude-skills\bus-work\assets`, where `--map` is the map's own folder, the one holding `manifest.json`, `--scan` names a report that exists under `_gtfs/upcoming/`, and `<this session's name>` is yours:

```bash
node refresh_review.mjs --map "C:/Buses/buses-data/Areas/High Wycombe" --scan 2026-08-31 --verdict no-rebuild --by <this session's name> --note "what you found, in one sentence"
```

- **`loop/your-move/` is the scheduled loop's whole channel to a person, read by `loop_your_move.mjs`.** A file with a *What is needed* section or a `**Blocks:** <key>` field is a hold, one row each at rank 3; any other file is a draft, all counted on one row at rank 7. Write a `Blocks:` key that contains a space, such as `engine-rebuild-High Wycombe`, in backticks. A decided hold carries `**Decided:**` and `**Revisit when:**` above its ask. Never delete a hold or a draft: it moves to `adhoc/ready/` or `loop/retired/`, and the reason is the record.
- **A hold that asks Peter to edit a tracked file spells the edit out as a `diff` block**, because `adopt.mjs`, the one way a tick commits a file it did not write, commits only an edit equal to that block.
- **A correspondence thread silences its rank-2 row only by declaring itself finished:** a `**Status:**` beginning `dormant`, `closed` or `settled`, with a docstamp on or after the last inbound message. An unsent draft at rank 3 moves only with both `**Held:**` and `**Revisit when:**`, to rank 9. The convention is `Correspondence/README.md` in buses-data.
- **Stranded branches and stalled pull requests are computed, never declared:** `unpushed_branches.mjs` by patch identity, never by ahead-count, and `node pr_sweep.mjs`, run from this skill's `assets/`, which writes `loop/pr-sweep.json` for the board to read.
- **Never remove a worktree with a bare `git worktree remove`.** Run `node remove_worktree.mjs "<worktree path>" --apply` from this skill's `assets/`, where `<worktree path>` is the worktree's root as `git worktree list` prints it; without `--apply` it only reports. The weekly sweep is `node worktree_sweep.mjs` from the same folder, `--apply` to remove, and the same sweep clears the portal tests' scratch from the temp folder with `temp_sweep.mjs`.
- **The weekly document triage and the weekly shadow rebuild** are `node doc_triage.mjs` and `node shadow_rebuild.mjs`, from `C:\Buses\claude-skills\bus-work\assets` with no placeholders. Neither writes into what it reports on, and a half either cannot run is exit 2 and no stamp.
- **The national directory's link check is out of CI on purpose:** `directory.mjs --links` writes `BusMapsUK/bus-map-directory/link-check.json`, and the board only reads it.

Prove the sources can go red, and go quiet, from `C:\Buses\claude-skills\bus-work\assets`:

```bash
node prove-red-correspondence.mjs
node prove-red-commitments.mjs
node prove-red-refresh-review.mjs
node prove-red-loop-your-move.mjs
node prove-red-directory-links.mjs
node prove-red-unpushed-branches.mjs
node prove-red-pr-sweep.mjs
node prove-red-doc-triage.mjs
node prove-red-shadow-rebuild.mjs
```

## Remember the others

Nothing schedules the five routine check-ins (summarise-ticks, summarise-adhocs, bus-work, loop-health, triage), so Peter has to remember them. **Only when Peter has run this by hand in a conversation**, and never when a tick, the morning brief or any other unattended run calls it, end your final message with one line reminding him to run the others occasionally: `/summarise-ticks` (what the scheduled ticks did and raised); `/summarise-adhocs` (the same for the ad-hoc runs); `/loop-health` (whether the loop is blocked); `/triage` (the holds and drafts in `loop/your-move/`). Leave this skill out of the list, and do not run any of them yourself.
