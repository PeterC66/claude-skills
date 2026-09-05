---
name: bus-work
description: Show what the BusMaps.uk bus-map system is waiting on — one ranked worklist gathered from the portal (publish reviews, organisation applications, map requests approved and awaiting a build, proposed updates) and from the local map tree (towns whose services change soon per the BODS scan, stale engine renders, missing S6 verification) — then carry the chosen item all the way through: run the right map skill, gate it, and deliver it into the portal with the exact command. Use when asked "what needs doing on the buses / the portal", "what's next", "do the monthly bus refresh", "is there anything waiting in the portal", "build the map someone asked for", "work the bus worklist", or when picking a numbered item from a worklist this skill printed. The entry point for routine BusMaps.uk operations — it replaces reading runbooks R1–R4 to remember which script, which flags, which order.
---

# Work the BusMaps.uk worklist

**Names for the parts and the process.** `C:\u3a St Ives\Using AI\Buses\Documentation\README - Glossary of terms.md` is the shared vocabulary: sheet elements by callout code, and the stage / portal / repo / failure words this skill uses throughout. It also records which of them to translate before writing to a customer — `deliver`, `accept` and `publish` are three different acts, and only publish changes what the public sees.

**The point of this skill: Peter should never have to open a runbook to do the routine month.** Everything the system is waiting on appears in one ranked list, and every item carries its own procedure. If you find yourself telling him to "see R4", you have failed — inline the step instead.

**Where Peter reads about this in his own words.** `Buses\Documentation\README - How to publish a map to the portal.md` (written 2026-08-21) is his plain-English account of the whole lifecycle — the three approval gates, what the publish review is actually asking, deliver vs accept vs publish, and the monthly cycle — and it names this skill as the front door. It is command-free by design and defers to R1/R3/R4 on anything technical. Point him at it when he wants to understand a step rather than execute one; **when a procedure here changes, check whether it changed the story there**, and don't answer him out of R1/R3/R4 when that guide already says it in his register.

## The shape of the system (why the split exists)

| Zone | Where it happens | Why it can't move |
|---|---|---|
| **Know** what needs doing | the portal | it holds the customers, requests and queues |
| **Make** the map | this laptop, S1–S6 | needs live data, network and judgement — the portal is deliberately deterministic, no network, no AI at render time |
| **Deliver** into the portal | `import-map.mjs` / `propose-update.mjs` | writes the portal's SQLite + object store |

This skill is the spine across all three. It does not replace `make-bus-leaflet` / `make-place-bus-leaflet` — it *calls* them, then does everything either side.

## Step 1 — Print the worklist (always start here)

Let `BW=C:\u3a St Ives\.claude\skills\bus-work\assets` (this skill lives in the bus skills repo alongside `make-bus-leaflet`, and is junctioned into `~\.claude\skills\` like the others).

```powershell
node "%BW%\worklist.mjs"
```

**Any directory.** Unlike everything in [references/playbooks.md](references/playbooks.md), this one does not care where you are: it is invoked by absolute path and reads nothing relative to the working directory. Every command in the playbooks does care, and each carries its own `cd` for that reason.

The same list is on the web at **`/app/admin` → To do** (the admin landing tab) — same ranking, same wording, because both call the portal's `src/worklist/index.js`. The terminal version adds what only this machine can see: failing gates, engine-stale renders, missing S6, and towns with a leaflet but no portal map.

Read-only, safe to run at any time, and safe while the dev server is running (the portal DB is WAL). Add `--json` when you need to act on the fields, `--gates` to also run the full byte-identical gate sweep (slow — a minute or two; only worth it after an engine change or before a batch of deliveries).

**Pass `--session <this session's name>` — the name `ListAgents` gives THIS session, `buses-29` rather than `Claude`.** It is the same name a backlog claim is made under, and without it the conditions block cannot tell your own claim from a neighbour's and says so. That is the one flag worth remembering; everything else has a default.

### Is it safe to do this right now? — the concurrency verdict (OA-221, 2026-09-01)

**Peter can run this at any hour and be told, rather than having to work it out.** Printing the list is read-only; *carrying an item through* writes into a working tree several sessions share, sometimes sweeps the whole estate, and sometimes deploys. So every row carries `SAFE NOW`, `CHECK FIRST` or `BETTER TO DELAY`, and a `CONDITIONS` block above the bands states each contended fact **once** — the three working trees (this one, the engine repo, the portal), which open actions other sessions have claimed today, and what that means. The rows then name what is contended instead of repeating the sentence; an early version printed the full reason on all nineteen rows and buried the titles it was meant to help you read.

**Answer "can I do anything at all right now?" without gathering a single queue** with `node "%BW%\worklist.mjs" --conditions` — it reads three working trees on this disk, never asks a portal anything (so it works with no token configured), and classifies the standing commands that are *not* worklist rows: `--gates`, `push-status.mjs`, `rollout.js --apply`, `quality_gate.js --accept`, `npm run deliver`, `npm run deploy`. `--safe-only` filters the list itself, strictly — a `CHECK FIRST` row is workable and is still hidden by it.

**What the three verdicts mean, and why only two things ever earn a delay.** `git status` cannot say *whose* uncommitted files those are — yours and a neighbour's look identical — so a dirty tree is always `CHECK FIRST`, meaning read what is actually there. `BETTER TO DELAY` is reserved for two recorded faults: an estate-wide sweep while `Areas/`, `Places/` or `ci-reference/` has uncommitted files (the `quality_gate.js --accept` case, which has happened), and a deliver or deploy while the portal checkout is off `main` (it is PR-per-change, so a feature branch is its normal state, and `npm run deploy` ships the checked-out commit).

**A decision is never held back, and that is the most useful thing on the list.** A publish review, an organisation application, a map-request decision, a chase, and a drafted reply Peter has to send touch no working tree at all, so nothing happening on this machine can spoil them. When everything else says wait, those are what to offer.

**It is falsified**, from this folder, no placeholders: `node prove-red-concurrency.mjs`. It builds throwaway git repositories to prove the reading is real, drives the rules over synthetic conditions to prove each verdict both appears and clears, and asserts a clean machine says go — which is the control that stops a rule returning `CHECK FIRST` for ever and passing every red case. It found a real fault on the day it was written: the estate-sweep rule was reading a flag stored beside the paths instead of the paths themselves.

Against a **remote** portal, add `--url https://busmaps.uk --token <OPERATOR_TOKEN>` (or set `BUSMAPS_URL` / `BUSMAPS_TOKEN`). See "Remote portals" below — both reading and delivery work against the live site from this laptop (delivery proven end to end across all 13 sample maps on 2026-08-18). What has **no** laptop path is the operator half: accepting a staged refresh, withdrawing a publish request and changing a map’s outputs are HTTP endpoints needing a signed-in admin session, so they are browser work.

**Which portal you are looking at — it will not guess, since 2026-08-31.** `BUSMAPS_URL` and `BUSMAPS_TOKEN` live in `C:\Claude\community-bus-maps\.env`, which `worklist.mjs` loads for itself, so the bare command reads the **live site** and there is no flag to remember. With neither set and no `--local`, the tool prints the two lines to add and exits 2 rather than opening the dev SQLite. The dev checkout is `--local`, which **beats a configured `BUSMAPS_URL`** — otherwise the flag would do nothing on precisely the machine it exists for. `--local --url` together is a refusal, not a precedence rule. Either credential is live: it belongs in that gitignored `.env`, never in a chat message or a command line that lands in shell history.

**Send the TOKEN, not a cookie — `OPERATOR_TOKEN`, since OA-203 (2026-08-31).** `BUSMAPS_TOKEN` carries the portal's `OPERATOR_TOKEN` in an `Authorization: Bearer` header, and that credential is **read-only**: it admits `GET /api/admin/worklist`, `GET /api/maps` and, since 2026-09-05 (OA-233), `GET /api/maps/:id/poi-tiers` at admin scope and nothing else anywhere — GET only, those three routes only, refused everywhere else, and the portal's own test suite asserts the exact set of places it is consulted. `BUSMAPS_COOKIE` still works and is the fallback for a portal deployed before that change. **Prefer the token, because a `cbm_session` value is a PERSON's live admin login.** Only four portal routes sit behind step-up, so the same string that let this tool print a list could also approve an organisation, invite an admin, revoke anybody's sessions and mail every customer — and it was being kept in a file, renewed indefinitely by its own use. The portal's 2026-08-20 security round had explicitly retired *"the standing admin cookie kept in a file on the laptop"*; this skill put the practice back eleven days later, in the change that stopped it guessing which portal, because nothing in either repository named the other.

**Rotating that token breaks this skill until its copy is updated, and the rotation lives in the other repository.** Run `npm run rotate:secret -- OPERATOR_TOKEN` from `C:\Claude\community-bus-maps` (added 2026-09-01; `docs/DEPLOY.md` §2 *Rotating a token* is the write-up). It generates the replacement on the **host** and deliberately never prints it, so read the new value once out of the host's `.env` and put it into `BUSMAPS_TOKEN` in `C:\Claude\community-bus-maps\.env`. `STATUS_TOKEN` and `push-status.mjs` below are the same story. The rotation script names both of these tools in its preflight, **before** it changes anything, for exactly the reason the paragraph above ends on: this is the class of remedy that goes wrong by living in one repository while the thing it breaks lives in another, and nothing but a written pointer ever catches it.

**And the cookie was never actually short-lived, which is worth knowing before blaming an expiry.** The portal's session window is seven days and **slides on use**, so every live run here renewed it by a week. What kills it is signing out in the browser — the value in `.env` is the very session row that click deletes.

**Demo rows are hidden unless `--demo`, and never share a band with real work.** The seeded customers are all named `... (demo)`; anything carrying that in its title, reason or customer sorts below every real row under its own `DEMO DATA` heading. **A rollup row — one item standing for several records, like the applications queue — is classified by the portal instead**, in `src/worklist/index.js`, which sets `demo` on the item; this tool honours that flag rather than guessing from a sentence that cannot carry the evidence.

**The test for a seeded record is the address, never the name.** RFC 2606 and RFC 6761 reserve `example.com/.net/.org` and the `.example`, `.test`, `.invalid` and `.localhost` TLDs so that they resolve nowhere and accept no mail — so an applicant who cannot be emailed is, by construction, nobody waiting. That rule replaced a guess on 2026-08-31: the eight pending applications on the dev checkout are seven obvious `Test <sector>` rows and one *"Ramsey Town Council"*, and this skill reported that last one to Peter as a real council waiting on him because it lacked a `(demo)` suffix. It is seeded as well, at `clerk@ramsey-tc.example`. **Absence of a demo label is not evidence of realness** — and on a system that also holds genuine correspondence from a real Ramsey adviser (CORR-001), a seeded council of the same town is precisely the row that will be believed. When a queue looks real, check the address before you say so.

Both guards exist because of one run on 2026-08-31: a session asked for "the worklist", got the dev checkout, and presented a demo customer's publish review as the top item in **SOMEONE IS BLOCKED** while the one real item — a member of the public owed a reply — sat fourth. The banner said `LOCAL — dev checkout` throughout, in a box, three lines above. **A header you have to read is not a guard**; the fix had to change which rows exist, not how loudly the mode is announced.

**Occasionally, push the gate results to the portal too:** `node "%BW%\push-status.mjs"` runs `status.js` (the full regenerate-and-diff — a minute or two) and sends the result to `POST /api/admin/status`, so the failing-gate and engine/S6-stale items show at ranks 0/8 of the portal's own To-do tab and `GET /api/admin/worklist`, not only in this terminal. Worth doing after an engine change or before a batch of deliveries — it's a separate, occasional step, not part of the routine "print the worklist" above. Add `--url` + `--token <STATUS_TOKEN>` for a remote portal. **The token travels in an `Authorization: Bearer` header and nowhere else** — the portal stopped accepting `?token=` on 2026-08-25, because Caddy's access log records the full request URI and every use of the query form wrote a live credential in clear into a file that is in no backup and under no retention rule.

**Since 2026-08-25 `status.js` also answers "is any of this actually live?"** Its closing **Deployment** row reads the `X-App-Version` header off busmaps.uk and compares it with `main` in the portal checkout — added because the deployed commit had become unreadable from outside and the site sat a commit behind `main` with nothing able to say so. Three things to know before reacting to it: it is **amber, not red, for twelve hours** after the newest undeployed commit, because a merge is not a deploy; an **unreachable site is never red**, since that is the uptime monitor's question and this row will say `unreachable` and pass; and a **`no-header` row means the live build predates the change**, which is a fact rather than a fault. If it says `BEHIND`, the remedy is `npm run deploy` run from `C:\Claude\community-bus-maps`, not an edit. Skip the row entirely with `--no-live`; prove it can still go red with `--deploy-grace-hours 0` against a deployment that is behind.

Present the result to Peter as a short numbered list — title, who's waiting, age. Do not paste the raw output wholesale; it is written for a terminal, and he wants the decision, not the dump. Lead with the bands in order: **BROKEN → SOMEONE IS BLOCKED → YOUR MOVE → HOUSEKEEPING → WAITING ON OTHERS**. **Say which portal it was in the first line of your answer** — "live portal" or "dev checkout" — because he cannot see the banner and every item below it means something different depending on the answer.

**Say the conditions in that same first line**, in his register and in one clause — "nothing else is running, everything below is workable" or "another session has the portal on a branch, so the two delivery rows can wait". Then carry each row's verdict onto the row you present. He cannot see the terminal, so a verdict you leave in the tool's output is a verdict he does not have.

## Step 2 — Pick one

- If the invocation already names one ("do the St Ives refresh", "build the Waitrose map", "/bus-work 3"), take it and skip the question.
- Otherwise show the list and ask which — **one message, one question**. Recommend the top item unless something lower is obviously more urgent, and say why in a sentence.
- **Prefer a `SAFE NOW` row when the top one is `BETTER TO DELAY`**, and say that is why. A held-back row is not dropped from the list and Peter can still choose it — the verdict is advice with its evidence attached, not a lock — but the recommendation should be something he can finish. If he takes a delayed row anyway, do the thing the reason names first: read the uncommitted files, or get the portal checkout back on `main`.
- If the list is empty, say so plainly and stop. Do not invent work.

## Step 3 — Do it

Load [references/playbooks.md](references/playbooks.md) and follow the playbook for that item's `type`. One item at a time, start to finish, before offering the next.

The types and where each ends up:

| `type` | What it is | Ends with |
|---|---|---|
| `gate` | the engine no longer reproduces a committed map | diagnosed; nothing else ships until it is |
| `review` · `application` · `request-decision` | one of the **three approval gates** | Peter decides in the portal UI — **never decide for him**. An AREA request carries the town's **complexity band** off its newest S2 run, or says UNSCORED with the S1→S2 step that scores it for free (buses-data OA-088); RED is the pipeline's one *not a single-sheet town* verdict, and approval is the quota gate, so the band belongs BEFORE the decision |
| `build` | an approved request with no map yet | map imported, v1.0 verified byte-identical |
| `refresh` | a portal map whose services are changing | proposed update staged for the customer |
| `refresh-local` | a town leaflet with no portal map | new S5 render + `_latest` refreshed |
| `housekeeping` | engine-stale renders, missing S6 | rollout applied / S6 run |
| `awaiting-customer` | staged, they haven't accepted | a nudge, or nothing |
| `draft-unsubmitted` | a version saved and never sent for review | evidence prepared; Peter submits and approves |

## Step 4 — Close out

Every time, without being asked:

1. **Re-run the worklist** and confirm the item is gone. If it is still there, it is not done — say so.
2. Tell Peter what changed in one or two lines: the version number, the map, the customer, what the next actor is.
3. If anything about the *procedure* proved wrong or fiddly, fix it here (this file, the playbooks, or `worklist.mjs`) in the same session rather than leaving it for the next one.

## Rules that override convenience

- **Never decide an approval gate.** Organisation approval, map-request approval, and publish review are Peter's judgement and the system's integrity. Prepare the evidence, summarise it, open the URL — then stop.
- **Never hand-edit a rendered file.** Corrections go through a new version, always.
- **Never relax a gate to make it pass.** A `verify` that says DIFF is information, not an obstacle.
- **If you push something you already know will go red, say so in the commit SUBJECT with `[expected-red]`** (OA-251, 2026-09-05). Each of the six push-triggered workflows across the three repositories sets `run-name` from that marker, so GitHub's "Run failed" email reaches Peter saying *EXPECTED RED - a session predicted this, no action* in its subject line instead of the workflow's name, and he can delete it without opening anything. It is the difference between a mail he has to triage and one he can ignore. **The marker buys six hours and no more** — `ci_state.mjs` ranks a marked red at 8 while it is fresh and at 0 BROKEN afterwards, because a red nobody has cleared by tomorrow is indistinguishable from a red nobody noticed. And it is not the answer to the cross-repo ordering trap: a portal PR opened before `buses-data` is pushed goes truthfully red, and the fix for that is the push order, never a label.
- **`npm run verify` skips silently** when its fixture dir is unset — a green run with no byte counts proves nothing. Require the word PASS *and* byte counts before calling an import verified.
- **PowerShell is the shell.** `FIXTURE_DIR=… npm run …` is bash and silently does nothing here; use `$env:FIXTURE_DIR = "…"; npm run …`. The worklist already emits the PowerShell form.
- **Stop the dev server before any command that writes directly** to a *local* portal (`import-map.mjs`, `propose-update.mjs`, `seed-demo.mjs` run in place). Reading — including this worklist — is fine either way. `npm run deliver` (below) is different: it runs against the live VPS over SSH and stops *that* service itself, briefly, as part of its own sequence — it doesn't touch your local dev server at all.
- **Delivering to the live site is `npm run deliver`, run from the laptop** (item 4, 2026-08-10 — see below). There is no longer a "must run on the machine that hosts the portal" restriction for this. Each call emails the customer and briefly restarts the portal, so a multi-map pass means one of each *per map* — warn them first.
- **The operator actions after delivery are still HTTP endpoints needing an admin `cbm_session` — withdraw a publish request, change a map's outputs, and a single accept/publish are still browser work.** But a *batch* of several already-reviewed maps has a script now: `community-bus-maps/scripts/accept-publish-batch.mjs` (`npm run accept-publish`, added 2026-08-19, PR #54) drives withdraw→accept→submit→approve→live-verify for a named list of staged maps in one run, and sends ONE grouped digest email per customer for the whole batch instead of one "is published" email per map (`suppressNotify` + `POST /api/admin/notify-published-batch` — a batch used to mean N emails to the same inbox, confirmed via `/health?deep=1`'s `customers` count on the 2026-08-19 pilot). **This does not relax the rule above it.** `--reviewed-by "<name>"` is mandatory and the script never looks at a rendered sheet itself — it only executes a decision that has already been made by someone who opened every sheet at full resolution first, same as this skill preparing evidence and stopping before a gate. Two orderings the portal enforces in code and will surprise you otherwise, whether run by hand or through the script: an open publish request makes the accept fail with a **409** until it is withdrawn, and an expert output (`internal_schematic`, `boarding_plan`) cannot be switched on until the map’s live `routes.json` carries its opt-in key — so that toggle is gated on the refresh landing first. **And a third, which the batch script does NOT handle: a map carrying a boarding plan needs a version SAVED between the accept and the submit**, because granting an output renders nothing and this is the one output with no other act to carry the render — run the script on such a map and it publishes it with the sheet missing. See `references/playbooks.md` §*Output toggles*. **For the full step-by-step — where to review (`Collected_latests`, not the portal), the exact command, what every flag means — see `references/playbooks.md` §*bulk-accept-publish*, not this bullet.**

## Remote portals — the honest state

**Reading a remote portal works, and since OA-203 it has its own credential.** This tool only ever GETs, so `--url` + `--token <OPERATOR_TOKEN>` gives the same worklist from anywhere, with a read-only token instead of a borrowed sign-in session. `--cookie <cbm_session value>` from a signed-in admin browser remains the fallback for a portal older than that change — see [Step 1 — Print the worklist (always start here)](#step-1--print-the-worklist-always-start-here) above for why the token is the right one to reach for.

**Delivery works too**, via `scripts/deliver-map.mjs` in `community-bus-maps` (`npm run deliver`), not an HTTP endpoint. This is item 4 of `Buses\Development Docs\_archive\foolproofing-plan_2026-08-07.md`, built 2026-08-10 — originally scoped there as `POST /api/admin/ingest`, built instead by extending the SSH-based delivery script that already existed for brand-new maps (GO-LIVE.md §2.1 Phase 1, shipped 2026-08-09): scp the render to the VPS, verify it byte-identical *before the live service is touched*, stop the portal, run the real script (`import-map.mjs` or, new, `propose-update.mjs` when `--map <slug>` is given) inside a throwaway container, restart, `/health?deep=1`. Needs `DEPLOY_HOST`/`DEPLOY_SSH_KEY`/`DEPLOY_APP_DIR` in `community-bus-maps/.env`.

`worklist.mjs` itself already knows this: when it's reading the **live** worklist (`--url`/`BUSMAPS_URL` set), a `refresh` item's printed command is the `npm run deliver -- --map …` form; reading the **local** worklist, it's still the bare `propose-update.mjs` form (no SSH round-trip needed for local dev). If you ever see a bare `propose-update.mjs`/`import-map.mjs` command printed while the worklist is in remote mode, that's a regression — it would silently write to a local `DATA_DIR` and do nothing to the live site.

An admin can also accept/decline a staged refresh straight from the admin console now (2026-08-10) — the **Refreshes** tab (`/app/admin`) carries a link to the map and Accept/Decline buttons, rather than requiring a trip to `/app/maps/:id` or signing in as the customer (unnecessary — an admin already has permission). This is frontend code, so it needs a VPS deploy to reach the live site; it isn't automatic the way `deliver-map.mjs` (laptop-only, no deploy needed) is.

## What feeds the worklist

Nothing here is a new source of truth; it is a join over what already exists.

| Source | Gives |
|---|---|
| the portal's own `src/worklist/index.js` — **imported locally, fetched (`GET /api/admin/worklist`) when remote; never re-implemented** | ranks 1–6 and 9: publish reviews, applications, map requests, awaiting-build, refresh flags, proposed updates. The admin console's To-do tab renders the same call, so the two cannot show different lists |
| `_gtfs/upcoming/upcoming-report_<date>.md` | which towns have service changes coming, matched to maps by the *same rule* `check-upcoming-refreshes.mjs` uses |
| each map's `refresh-reviews.json` | which of those refresh rows have ALREADY been adjudicated against the current scan and found not to need a rebuild. Suppresses the row and says so; a newer scan brings it back |
| each town's `manifest.json` + `routes.json.engine` vs `engine_version.js` | which renders pre-date the current engine, and how stale S6 is |
| `status.js --json` (only under `--gates`, or as pushed by `push-status.mjs`) | the expensive proof: regenerate everything and diff |
| `Correspondence/CORR-nnn/` message headers, and each map's `local-decisions.json` | rank 2 a reply owed to a real person, rank 3 **a reply drafted and not sent**, rank 9 a question asked locally and never answered |
| each town's newest S2 run, `complexity.json` — read by `complexity_band.mjs` | the **complexity band** on an area map request or build row (rank 3/4): GREEN, AMBER, RED with the measure that tripped it, or UNSCORED. The portal cannot score a town (it holds no bus data); this machine can, without spending quota. Peter's guide had promised him this at gate two since 2026-08-21 and nothing did it until 2026-09-05 |
| each AREA map's landmark answer — `GET /api/maps/:id/poi-tiers` when remote (the operator token's third route), the store's `overrides.json` + pack `routes.json` when local — against the town's latest S3 and S4 `routes.json`, compared by the ENGINE's `poi_tiers_sync.js` (OA-233, 2026-09-05) | rank 7 **`landmark-owed-<slug>`**: the portal holds an answer the source lacks; rank 7 **`landmark-unbuilt-<slug>`**: the source carries an answer the latest build has not drawn — the row no byte gate can raise, because the gate reads the build's own config. A portal older than the route is SKIPPED and counted in the header. Playbook `landmarks` |
| `Development Docs/commitments.json` | rank 4 **a dated commitment now OVERDUE**, rank 7 one inside its warning window. Silent outside it |
| `git status` / `git branch` in the three repositories, and the `selected:` line of every open action — read by `concurrency.mjs` | not a rank but a VERDICT on every row: what is safe to start right now, what to look at first, and what to leave until a neighbouring session has finished |
| `gh run list` on each of the three repositories' default branch — read by `ci_state.mjs` (OA-251, 2026-09-05) | rank 0 **`ci-red-<owner>/<repo>`**: that repository's last run in GitHub Actions is still failing, how long it has been failing, and the failing step names. Rank 8 instead, for six hours only, when the triggering commit's subject carries `[expected-red]`. This is the one source whose only other channel was an email to Peter, and that channel was measured dead — see below |

**A refresh row you have answered can now be cleared without rebuilding the map (buses-data OA-205).** A `refresh` row is a JOIN against the newest scan report, so until 2026-08-31 nothing could clear one except doing the rebuild it asks for — and on 2026-08-31 all 40 High Wycombe items were worked to a conclusion, none of them needed a rebuild, and the row came back unchanged with the same 40 on it. If you adjudicate a scan and the sheet does not need to change, **record it**, from the `bus-work` assets folder (`C:\u3a St Ives\.claude\skills\bus-work\assets`); `--map` is the map's OWN folder, the one holding `manifest.json`, and `--scan` must name a report that exists under `_gtfs/upcoming/` or the command refuses:

```bash
node refresh_review.mjs --map "C:/u3a St Ives/Using AI/Buses/Areas/High Wycombe" --scan 2026-08-31 --verdict no-rebuild --by <this session's name> --note "what you found, in one sentence"
```

The row disappears and the worklist header says how many it suppressed and why — it is never silently dropped. **A newer scan brings it straight back**, because the match is on the scan date and nothing else, and `--verdict rebuild-needed` records the reading without silencing anything. **Adjudicating a town does NOT adjudicate a place inside it**: a place's frame draws a different set of services, so it keeps its own row and its own file.

**The last three sources are read from THIS LAPTOP and are identical in every mode.** Only the portal queues change between `--local` and `--url`: a stale render, an upcoming BODS change and an unsent letter are facts about this disk, not about a portal. So the same correspondence row appearing in a dev run and again in a live run is **correct, and not duplication** — there is one draft on one disk, and it belongs to neither portal. If it ever appeared twice inside a single run, that would be a bug.

**Ranks 0 and 8 also reach the portal itself** (item 3, 2026-08-08): `push-status.mjs` POSTs the same `status.js --json` output to `POST /api/admin/status`, the portal stores the latest snapshot, and `src/worklist/index.js` folds it into ranks 0/8 there too — so a failing gate or a stale engine shows on the admin console's To-do tab and to a remote reader, not only to whoever last ran `--gates` on this laptop. It is a snapshot, not a stream: stale until the next push. Rank 7 (a BODS-flagged town with no portal map) is not pushed — it still only comes from this tool reading `_gtfs/upcoming` directly.

**Why commitments are in here too, added 2026-08-31, and why they are not the same source.** Correspondence answers *is a real person waiting*. Commitments answer *did we do the thing we said we would*, and the difference is that nothing on disk changes when the answer is no. A letter WE chose to write — the OSMF licensing enquiry, the solicitor instruction — has no thread, no counterparty record and no artefact to interrogate; neither has a credential three months from expiry. `status.js` grew a Commitments section for exactly this and fails the board once a date passes, but a red daily CI run is only a reminder if somebody reads the email, and this project has already had `gates.yml` red for **167 runs across twelve days** without anyone noticing. This puts the same rows on the list you actually work from. **It is deliberately silent until the date is close**, because a worklist that prints an obligation eighty days out is one nobody finishes — the same rule the correspondence source follows when no reply is owed. Retire an entry by DELETING it from the JSON, exactly as a finished OA file is deleted; a list that keeps its dead rows stops being read. Falsified by `node assets/prove-red-commitments.mjs`, which pairs every case: make the state and see the row, clear it and see the row go.

**Why correspondence is in here at all, added 2026-08-31.** A reply to the first member of the public who ever wrote in was drafted on the 30th and was still unsent a day later, with eighty commits in between. The backlog work that same message raised was picked up promptly — another session read the open actions, claimed one and released half of it overnight — because the backlog is indexed, checked in CI and read by every session that starts. **The one step nothing could do for him had nothing watching it.** That is the asymmetry: everything Claude can do is picked up by the next session, so the only step with no reminder is the human one, and it is the only step that a person on the other end is actually waiting on. Rank 3 is deliberately in the *someone is blocked* band rather than *your move* — because they are.

Prove it can go red, and go quiet, from `C:\u3a St Ives\.claude\skills\bus-work\assets`:

```bash
node prove-red-correspondence.mjs
node prove-red-commitments.mjs
node prove-red-refresh-review.mjs
```

Every case there is a pair: make the state and see the row, clear the state and see it gone. Appearing is only half of it — a row still nagging about a letter that went out last week is a row that gets ignored, and then so is every row beside it. **The third is the same argument turned round and is the more dangerous half**: a refresh row suppressed by a review that never lifts has been silently deleted, and nobody would find out — so its cases prove a NEWER scan brings the row back with the old review still sitting in the file, and that an unreadable review file fails safe rather than quiet.

If a queue is missing from the list, fix the source that owns it — **a portal queue is fixed in `community-bus-maps/src/worklist/index.js`** (which fixes the admin console at the same time), a local-tree signal in `worklist.mjs`. Do not work around a gap by reading the admin console separately; that is the habit this skill exists to end.

